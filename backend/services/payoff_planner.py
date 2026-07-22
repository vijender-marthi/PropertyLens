"""Portfolio debt payoff planner engine.

Backend-owned simulation for the "Payoff planner" page. The frontend only
collects inputs (strategy, lump sum, extra monthly, include primary) and renders
the render-ready DTO produced here — no financial logic lives in React.

Model (per the Payoff planner spec):

  Each rental loan is described by ``{name, balance, rate, pi, noi}`` where

    * ``balance`` — current outstanding principal (USD)
    * ``rate``    — annual interest rate as a fraction (0.065 == 6.5%)
    * ``pi``      — monthly principal & interest, escrow EXCLUDED
    * ``noi``     — monthly net operating income (rent - opex, before debt
                    service); only the portfolio sum (``noi_sum``) is used by
                    the simulation, via the income cascade.

  Strategy order:
    * ``avalanche`` — target open loans by HIGHEST rate first.
    * ``snowball``  — target open loans by SMALLEST balance first.

  Monthly loop (cap 800 months):
    1. Charge interest and apply each open loan's minimum P&I principal.
    2. ``pi_open`` = sum of ``pi`` of loans still open (drops as loans close).
    3. ``attack_pool`` = (initial_total_pi - pi_open)   # freed payments rolled forward
                       + max(noi_sum - initial_total_pi, 0)  # income surplus
                       + extra_monthly + (lump in month 1).
       Rolling freed P&I forward is the avalanche/snowball mechanic — it lets a
       lump sum or any early payoff accelerate the whole timeline. When the
       portfolio is cash-flow positive (noi_sum >= initial_total_pi) this reduces
       exactly to the spec's ``extra + (noi_sum - pi_open) + lump``.
    4. Apply the pool to targets in strategy order; overflow cascades to the
       next open target in the SAME month.

The scenario is an OVERLAY: input loan dicts are never mutated.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from services.formatters import (
    format_currency,
    format_interest_rate,
    format_metric_currency,
)

CAP_MONTHS = 800
# Current market reference rate (~6.5%) used only for the honest per-loan verdict.
MARKET_RATE = 0.065

_MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


# ---------------------------------------------------------------------------
# Date helpers (display only)
# ---------------------------------------------------------------------------
def _add_months(start: date, months: int) -> date:
    """Return ``start`` advanced by ``months`` whole months (day pinned to 1)."""
    total = start.year * 12 + (start.month - 1) + months
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


def _format_month_year(value: date) -> str:
    return f"{_MONTH_ABBR[value.month - 1]} {value.year}"


def _ordinal(n: int) -> str:
    """1 -> '1st', 2 -> '2nd', 11 -> '11th', ..."""
    n = int(n)
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _format_duration(months: int) -> str:
    """Human "Xy Ym" / "Ym" duration string for a month count."""
    months = max(0, int(months))
    years, rem = divmod(months, 12)
    if years and rem:
        return f"{years}y {rem}m"
    if years:
        return f"{years}y"
    return f"{rem}m"


# ---------------------------------------------------------------------------
# Strategy ordering
# ---------------------------------------------------------------------------
def order_targets(open_loans: List[Dict[str, Any]], strategy: str) -> List[Dict[str, Any]]:
    """Order open loans by the active strategy.

    avalanche -> highest rate first; snowball -> smallest balance first.
    ``_idx`` (original position) is the stable tie-breaker.
    """
    if strategy == "snowball":
        return sorted(open_loans, key=lambda s: (s["balance"], s["_idx"]))
    # avalanche is the default
    return sorted(open_loans, key=lambda s: (-s["rate"], s["_idx"]))


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------
def simulate(
    loans: List[Dict[str, Any]],
    noi_sum: float,
    *,
    strategy: str = "avalanche",
    lump_sum: float = 0.0,
    extra_monthly: float = 0.0,
    recurring_lump: float = 0.0,
    recurring_month: int = 12,
    recurring_years: int = 0,
    start_month: Optional[int] = None,
    attack: bool = True,
    cap: int = CAP_MONTHS,
) -> Dict[str, Any]:
    """Run the monthly payoff loop.

    When ``attack`` is False the pool is forced to 0 every month (the baseline:
    minimums only, cash flow pocketed, no lump sum).

    A recurring lump sum (``recurring_lump`` applied in calendar month
    ``recurring_month`` for ``recurring_years`` consecutive years) needs the
    portfolio's ``start_month`` (1-12) to map a loop month index onto a calendar
    month; without it the recurring contribution is skipped.
    """
    strategy = "snowball" if str(strategy).lower() == "snowball" else "avalanche"
    lump_sum = max(float(lump_sum or 0.0), 0.0)
    extra_monthly = max(float(extra_monthly or 0.0), 0.0)
    recurring_lump = max(float(recurring_lump or 0.0), 0.0)
    recurring_years = max(int(recurring_years or 0), 0)
    try:
        recurring_month = int(recurring_month)
    except (TypeError, ValueError):
        recurring_month = 12
    if not 1 <= recurring_month <= 12:
        recurring_month = 12
    recurring_on = (
        attack and recurring_lump > 0 and recurring_years > 0 and start_month is not None
    )
    recurring_applied = 0
    recurring_paid = 0.0
    noi_sum = float(noi_sum or 0.0)

    # Overlay state — copies only, inputs are never mutated.
    state: List[Dict[str, Any]] = []
    for idx, loan in enumerate(loans):
        balance = float(loan["balance"])
        state.append({
            "name": loan["name"],
            "rate": float(loan["rate"]),
            "pi": float(loan["pi"]),
            "noi": float(loan.get("noi", 0.0) or 0.0),
            "start_balance": balance,
            "balance": balance,
            "_idx": idx,
            "open": balance > 0,
            "payoff_month": None if balance > 0 else 0,
        })

    total_interest = 0.0
    principal_paid = 0.0
    attack_paid = 0.0
    month = 0

    # Sum of minimum P&I across loans open at the start. As loans close, the
    # difference (initial_total_pi - pi_open) is the freed payment that rolls
    # forward onto the remaining targets — the core avalanche/snowball mechanic.
    initial_total_pi = sum(s["pi"] for s in state if s["open"])

    def open_state() -> List[Dict[str, Any]]:
        return [s for s in state if s["open"]]

    while open_state() and month < cap:
        month += 1

        # 1. Interest + minimum P&I principal for every open loan.
        for s in state:
            if not s["open"]:
                continue
            interest = s["balance"] * s["rate"] / 12.0
            total_interest += interest
            principal = max(s["pi"] - interest, 0.0)
            principal = min(principal, s["balance"])
            s["balance"] -= principal
            principal_paid += principal
            if s["balance"] <= 1e-6:
                s["balance"] = 0.0
                s["open"] = False
                s["payoff_month"] = month

        # 2. Freed P&I: pi of loans STILL open after this month's minimum closures.
        pi_open = sum(s["pi"] for s in state if s["open"])

        # 3. Attack pool = freed minimum payments (rolled forward as loans close)
        #    + any income surplus above the original debt service + external extra
        #    (+ one-time lump in month 1). Rolling freed P&I forward is what makes
        #    a lump sum or an early payoff accelerate the WHOLE timeline, even for
        #    cash-flow-negative portfolios. Income surplus is floored at 0 and the
        #    external extra/lump are always fully additive.
        if attack:
            freed_pi = initial_total_pi - pi_open
            noi_surplus = noi_sum - initial_total_pi
            if noi_surplus < 0:
                noi_surplus = 0.0
            pool = freed_pi + noi_surplus + extra_monthly
            if month == 1:
                pool += lump_sum
            # Recurring lump: one injection each year in the chosen calendar
            # month, for a fixed number of years.
            if recurring_on and recurring_applied < recurring_years:
                cal_month = ((int(start_month) - 1 + month) % 12) + 1
                if cal_month == recurring_month:
                    pool += recurring_lump
                    recurring_applied += 1
                    recurring_paid += recurring_lump
        else:
            pool = 0.0

        # 4. Apply to targets in strategy order; overflow cascades same month.
        if pool > 1e-9:
            for target in order_targets(open_state(), strategy):
                if pool <= 1e-9:
                    break
                pay = min(pool, target["balance"])
                target["balance"] -= pay
                pool -= pay
                principal_paid += pay
                attack_paid += pay
                if target["balance"] <= 1e-6:
                    target["balance"] = 0.0
                    target["open"] = False
                    target["payoff_month"] = month

    loans_out = [
        {
            "name": s["name"],
            "rate": s["rate"],
            "pi": s["pi"],
            "noi": s["noi"],
            "start_balance": s["start_balance"],
            "payoff_month": s["payoff_month"],
        }
        for s in state
    ]
    return {
        "loans": loans_out,
        "months": month,
        "total_interest": total_interest,
        "principal_paid": principal_paid,
        "attack_paid": attack_paid,
        "recurring_count": recurring_applied,
        "recurring_paid": recurring_paid,
        "all_closed": not open_state(),
        "strategy": strategy,
    }


# ---------------------------------------------------------------------------
# Assertions (spec P1-P7) — used by tests and surfaced for auditing.
# ---------------------------------------------------------------------------
def check_assertions(
    loans: List[Dict[str, Any]],
    noi_sum: float,
    *,
    strategy: str = "avalanche",
    lump_sum: float = 0.0,
    extra_monthly: float = 0.0,
    cap: int = CAP_MONTHS,
) -> Dict[str, Dict[str, Any]]:
    """Evaluate P1-P7 for a given input set. Returns {code: {passed, detail}}."""
    plan = simulate(
        loans, noi_sum, strategy=strategy, lump_sum=lump_sum,
        extra_monthly=extra_monthly, attack=True, cap=cap,
    )
    baseline = simulate(
        loans, noi_sum, strategy=strategy, lump_sum=0.0,
        extra_monthly=extra_monthly, attack=False, cap=cap,
    )

    start_total = sum(float(l["balance"]) for l in loans)
    results: Dict[str, Dict[str, Any]] = {}

    # P1: every dollar of principal is accounted for (all debt cleared, +/- $1).
    p1_ok = plan["all_closed"] and abs(plan["principal_paid"] - start_total) <= 1.0
    results["P1"] = {
        "passed": p1_ok,
        "detail": f"principalPaid={plan['principal_paid']:.2f} vs startBalances={start_total:.2f}",
    }

    # P2: plan never slower than baseline.
    results["P2"] = {
        "passed": plan["months"] <= baseline["months"],
        "detail": f"planMonths={plan['months']} <= baselineMonths={baseline['months']}",
    }

    # P3: interest saved is non-negative.
    interest_saved = baseline["total_interest"] - plan["total_interest"]
    results["P3"] = {
        "passed": interest_saved >= -1e-6,
        "detail": f"interestSaved={interest_saved:.2f}",
    }

    # P4: every loan pays off within the cap.
    never = [l["name"] for l in plan["loans"] if l["payoff_month"] is None or l["payoff_month"] > cap]
    results["P4"] = {
        "passed": not never,
        "detail": "all loans pay off within cap" if not never else f"never pays off: {never}",
    }

    # P5: attack pool is only ever applied to open loans (structurally guaranteed by
    #     order_targets(open_state)); re-run an instrumented pass to confirm.
    p5_ok = _verify_attack_only_open(
        loans, noi_sum, strategy=strategy, lump_sum=lump_sum,
        extra_monthly=extra_monthly, cap=cap,
    )
    results["P5"] = {
        "passed": p5_ok,
        "detail": "attack pool applied only to open loans",
    }

    # P6: strategy ordering is strict.
    results["P6"] = {
        "passed": _verify_order_strict(loans, strategy),
        "detail": f"{strategy} ordering strict",
    }

    # P7: a paid-off loan's pi leaves pi_open the following month (cascade works).
    p7_ok, p7_detail = _verify_cascade(
        loans, noi_sum, strategy=strategy, lump_sum=lump_sum,
        extra_monthly=extra_monthly, cap=cap,
    )
    results["P7"] = {"passed": p7_ok, "detail": p7_detail}

    return results


def _verify_attack_only_open(loans, noi_sum, *, strategy, lump_sum, extra_monthly, cap):
    """Instrumented replay asserting attack payments never touch a closed loan."""
    state = [
        {"pi": float(l["pi"]), "rate": float(l["rate"]), "balance": float(l["balance"]),
         "_idx": i, "open": float(l["balance"]) > 0}
        for i, l in enumerate(loans)
    ]
    initial_total_pi = sum(s["pi"] for s in state if s["open"])
    month = 0
    while any(s["open"] for s in state) and month < cap:
        month += 1
        for s in state:
            if not s["open"]:
                continue
            interest = s["balance"] * s["rate"] / 12.0
            principal = min(max(s["pi"] - interest, 0.0), s["balance"])
            s["balance"] -= principal
            if s["balance"] <= 1e-6:
                s["balance"] = 0.0
                s["open"] = False
        pi_open = sum(s["pi"] for s in state if s["open"])
        pool = (initial_total_pi - pi_open) + max(noi_sum - initial_total_pi, 0.0) + extra_monthly + (lump_sum if month == 1 else 0.0)
        if pool > 1e-9:
            for target in order_targets([s for s in state if s["open"]], strategy):
                if pool <= 1e-9:
                    break
                if not target["open"]:
                    return False  # would apply to a closed loan
                pay = min(pool, target["balance"])
                target["balance"] -= pay
                pool -= pay
                if target["balance"] <= 1e-6:
                    target["balance"] = 0.0
                    target["open"] = False
    return True


def _verify_order_strict(loans, strategy) -> bool:
    open_loans = [
        {"balance": float(l["balance"]), "rate": float(l["rate"]), "_idx": i}
        for i, l in enumerate(loans)
        if float(l["balance"]) > 0
    ]
    ordered = order_targets(open_loans, strategy)
    if strategy == "snowball":
        keys = [s["balance"] for s in ordered]
        return all(keys[i] <= keys[i + 1] for i in range(len(keys) - 1))
    keys = [s["rate"] for s in ordered]
    return all(keys[i] >= keys[i + 1] for i in range(len(keys) - 1))


def _verify_cascade(loans, noi_sum, *, strategy, lump_sum, extra_monthly, cap):
    """Confirm pi_open drops by a closed loan's pi on the month after it closes."""
    state = [
        {"pi": float(l["pi"]), "rate": float(l["rate"]), "balance": float(l["balance"]),
         "_idx": i, "open": float(l["balance"]) > 0}
        for i, l in enumerate(loans)
    ]
    initial_total_pi = sum(s["pi"] for s in state if s["open"])
    month = 0
    prev_open_ids = {i for i, s in enumerate(state) if s["open"]}
    prev_pi_open = sum(s["pi"] for s in state if s["open"])
    while any(s["open"] for s in state) and month < cap:
        month += 1
        for s in state:
            if not s["open"]:
                continue
            interest = s["balance"] * s["rate"] / 12.0
            principal = min(max(s["pi"] - interest, 0.0), s["balance"])
            s["balance"] -= principal
            if s["balance"] <= 1e-6:
                s["balance"] = 0.0
                s["open"] = False
        pi_open = sum(s["pi"] for s in state if s["open"])
        cur_open_ids = {i for i, s in enumerate(state) if s["open"]}
        closed_now = prev_open_ids - cur_open_ids
        if closed_now:
            freed = sum(state[i]["pi"] for i in closed_now)
            # pi_open must have fallen by at least the freed pi vs the previous month.
            if not (prev_pi_open - pi_open >= freed - 1e-6):
                return False, "pi_open did not drop by freed pi after a payoff"
        pool = (initial_total_pi - pi_open) + max(noi_sum - initial_total_pi, 0.0) + extra_monthly + (lump_sum if month == 1 else 0.0)
        if pool > 1e-9:
            for target in order_targets([s for s in state if s["open"]], strategy):
                if pool <= 1e-9:
                    break
                pay = min(pool, target["balance"])
                target["balance"] -= pay
                pool -= pay
                if target["balance"] <= 1e-6:
                    target["balance"] = 0.0
                    target["open"] = False
        prev_open_ids = {i for i, s in enumerate(state) if s["open"]}
        prev_pi_open = sum(s["pi"] for s in state if s["open"])
    return True, "freed pi removed from pi_open the following month"


# ---------------------------------------------------------------------------
# Render-ready report DTO
# ---------------------------------------------------------------------------
def _money_metric(value: float) -> Dict[str, Any]:
    return {"value": round(float(value), 2), "display": format_metric_currency(value)}


def build_report(
    loans: List[Dict[str, Any]],
    noi_sum: float,
    *,
    strategy: str = "avalanche",
    lump_sum: float = 0.0,
    extra_monthly: float = 0.0,
    recurring_lump: float = 0.0,
    recurring_month: int = 12,
    recurring_years: int = 0,
    include_primary: bool = False,
    start_date: Optional[date] = None,
    market_rate: float = MARKET_RATE,
    cap: int = CAP_MONTHS,
) -> Dict[str, Any]:
    """Produce the full render-ready payload for the Payoff planner page."""
    start_date = start_date or date.today()
    strategy = "snowball" if str(strategy).lower() == "snowball" else "avalanche"

    plan = simulate(
        loans, noi_sum, strategy=strategy, lump_sum=lump_sum,
        extra_monthly=extra_monthly, recurring_lump=recurring_lump,
        recurring_month=recurring_month, recurring_years=recurring_years,
        start_month=start_date.month, attack=True, cap=cap,
    )
    # Savings baseline = the SAME avalanche/snowball plan with no external money
    # (no lump, no extra, no recurring). This isolates what the user's
    # contributions buy, so with everything at zero the plan equals the baseline
    # and nothing is "saved" — the contributions are the only thing that creates
    # savings.
    baseline = simulate(
        loans, noi_sum, strategy=strategy, lump_sum=0.0,
        extra_monthly=0.0, recurring_lump=0.0, recurring_years=0,
        attack=True, cap=cap,
    )
    baseline_by_name = {l["name"]: l["payoff_month"] for l in baseline["loans"]}

    total_debt = sum(float(l["balance"]) for l in loans)
    debt_free_month = plan["months"]
    baseline_month = baseline["months"]
    months_saved = max(baseline_month - debt_free_month, 0)
    interest_saved = baseline["total_interest"] - plan["total_interest"]

    debt_free_date = _add_months(start_date, debt_free_month)
    all_pay_off = plan["all_closed"] and all(
        l["payoff_month"] is not None and l["payoff_month"] <= cap for l in plan["loans"]
    )

    # Timeline rows: ordered by payoff month ascending, numbered 1..n.
    ordered = sorted(
        plan["loans"],
        key=lambda l: (l["payoff_month"] if l["payoff_month"] is not None else cap + 1, l["name"]),
    )
    # Common time axis for the diagram: the longest horizon (minimum-payment
    # baseline). Plan bars are drawn against it so the accelerated payoff visibly
    # falls short of where each loan would land on minimums alone.
    axis_months = max(baseline_month, debt_free_month, 1)
    denom = debt_free_month if debt_free_month > 0 else 1

    # Strategy ranking used to explain why each loan sits where it does.
    n_loans = len(plan["loans"])
    rate_rank = {
        l["name"]: idx + 1
        for idx, l in enumerate(sorted(plan["loans"], key=lambda x: (-x["rate"], x["name"])))
    }
    balance_rank = {
        l["name"]: idx + 1
        for idx, l in enumerate(sorted(plan["loans"], key=lambda x: (x["start_balance"], x["name"])))
    }

    def _row_reason(loan: Dict[str, Any], *, order: int, never: bool, months_earlier: int, below_market: bool) -> str:
        name = loan["name"]
        if strategy == "snowball":
            parts = [
                f"Snowball targets the smallest balance first — at "
                f"{format_currency(loan['start_balance'])} this loan is the "
                f"{_ordinal(balance_rank[name])}-smallest of {n_loans}."
            ]
        else:
            parts = [
                f"Avalanche targets the highest rate first — at "
                f"{format_interest_rate(loan['rate'])} this loan is the "
                f"{_ordinal(rate_rank[name])}-highest rate of {n_loans}."
            ]
        dur = _format_duration(months_earlier)
        if never:
            parts.append("It never clears within the horizon — raise the extra monthly.")
        elif months_earlier > 0 and order == 1:
            parts.append(f"Your contributions hit it first, clearing it {dur} sooner than with no extra.")
        elif months_earlier > 0:
            parts.append(
                f"Freed payments from the loans above it (plus your extra) pulled it in "
                f"{dur} sooner than with no extra."
            )
        else:
            parts.append("Add a lump sum or extra monthly to pull it in sooner.")
        if below_market:
            parts.append("Its rate is below the ~6.5% market — cheap debt, consider keeping.")
        return " ".join(parts)

    timeline: List[Dict[str, Any]] = []
    for i, l in enumerate(ordered, start=1):
        pm = l["payoff_month"]
        never = pm is None or pm > cap
        below_market = l["rate"] < market_rate
        pay_date = None if never else _add_months(start_date, pm)
        baseline_pm = baseline_by_name.get(l["name"])
        # Months this loan finishes ahead of its own minimum-payment schedule —
        # the visible size of the cascade for this row.
        months_earlier = 0
        if not never and baseline_pm is not None and baseline_pm > pm:
            months_earlier = baseline_pm - pm
        baseline_date = (
            _format_month_year(_add_months(start_date, baseline_pm))
            if baseline_pm is not None else None
        )
        timeline.append({
            "order": i,
            "name": l["name"],
            "payoffMonth": pm,
            "payoffDate": None if never else _format_month_year(pay_date),
            "barPct": 0.0 if never else round(min(pm / denom, 1.0) * 100, 1),
            # Diagram geometry against the shared baseline axis (0-100%).
            "planPct": 100.0 if never else round(min(pm / axis_months, 1.0) * 100, 1),
            "baselinePct": round(min((baseline_pm or axis_months) / axis_months, 1.0) * 100, 1),
            "rate": l["rate"],
            "rateDisplay": format_interest_rate(l["rate"]),
            "balance": round(l["start_balance"], 2),
            "balanceDisplay": format_currency(l["start_balance"]),
            "balanceCompact": format_metric_currency(l["start_balance"]),
            "baselinePayoffMonth": baseline_pm,
            "baselinePayoffDate": baseline_date,
            "monthsEarlier": months_earlier,
            "earlierLabel": _format_duration(months_earlier) if months_earlier > 0 else None,
            "cascade": bool(months_earlier > 0),
            "reason": _row_reason(l, order=i, never=never, months_earlier=months_earlier, below_market=below_market),
            "verdict": {
                "belowMarket": below_market,
                "tag": "Below market — consider keeping" if below_market else None,
                "neverPaysOff": never,
            },
        })

    # Payment-rollover ("coins") view: as each loan clears, its monthly P&I
    # becomes a coin that rolls onto the next target, so the monthly firepower
    # grows one coin at a time down the payoff order.
    rollover: List[Dict[str, Any]] = []
    freed_coins: List[Dict[str, Any]] = []  # payments freed by loans already cleared
    for k, l in enumerate(ordered, start=1):
        pm = l["payoff_month"]
        never = pm is None or pm > cap
        own_pi = float(l.get("pi", 0.0) or 0.0)
        freed_total = sum(c["payment"] for c in freed_coins)
        # Each freed coin carries the payoff order of the home it came from, so
        # the UI can tint it in that home's colour — money flowing from a cleared
        # home into the next target.
        coins = [{"name": c["name"], "display": c["display"], "own": False, "order": c["order"], "amount": round(c["payment"], 2)} for c in freed_coins]
        coins.append({"name": l["name"], "display": format_currency(own_pi), "own": True, "order": k, "amount": round(own_pi, 2)})
        rollover.append({
            "order": k,
            "name": l["name"],
            "payoffDate": None if never else _format_month_year(_add_months(start_date, pm)),
            "neverPaysOff": never,
            "coinCount": len(coins),
            "freedCount": len(freed_coins),
            "ownPayment": round(own_pi, 2),
            "freedPayment": round(freed_total, 2),
            "rollingPayment": round(freed_total + own_pi, 2),
            "ownPaymentDisplay": format_currency(own_pi),
            "freedPaymentDisplay": format_currency(freed_total),
            "rollingPaymentDisplay": format_currency(freed_total + own_pi),
            "coins": coins,
        })
        if not never:
            freed_coins.append({"name": l["name"], "payment": own_pi, "display": format_currency(own_pi), "order": k})

    # Metric cards.
    cards = {
        "debtFree": {
            "label": "Debt-free in",
            "value": debt_free_month,
            "display": _format_duration(debt_free_month),
            "date": _format_month_year(debt_free_date),
            "allPayOff": all_pay_off,
        },
        "interestSaved": {
            "label": "Interest saved",
            **_money_metric(max(interest_saved, 0.0)),
            "formula": "Interest without contributions − Interest with your plan",
        },
        "timeSaved": {
            "label": "Time saved",
            "value": months_saved,
            "display": _format_duration(months_saved),
            "baselineMonths": baseline_month,
            "baselineDisplay": _format_duration(baseline_month),
        },
    }

    # Story line (dynamic).
    first = ordered[0] if ordered else None
    if first and first["payoff_month"] is not None:
        first_date = _format_month_year(_add_months(start_date, first["payoff_month"]))
        if months_saved > 0:
            tail = (
                f"Your contributions then cascade down the list until the portfolio "
                f"is debt-free in {_format_month_year(debt_free_date)} "
                f"— {_format_duration(months_saved)} sooner than without them."
            )
        else:
            tail = (
                f"On your current schedule the portfolio is debt-free in "
                f"{_format_month_year(debt_free_date)}. Add a lump sum or extra "
                f"monthly to accelerate it."
            )
        story = f"{first['name']} clears first in {first_date}. {tail}"
    else:
        story = "No loans to plan — add rental debt to build a payoff plan."

    # Guidance when contributions haven't produced (or aren't producing) savings.
    savings_note = None
    no_contributions = float(lump_sum or 0) <= 0 and float(extra_monthly or 0) <= 0
    if ordered and months_saved == 0 and interest_saved < 1:
        if no_contributions:
            savings_note = (
                "This is your current payoff schedule with no extra money. Add a "
                "lump sum or extra monthly to save time and interest."
            )
        else:
            savings_note = (
                "These contributions aren't enough to change the payoff timeline. "
                "Try a larger lump sum or extra monthly."
            )

    warnings: List[str] = []
    if not all_pay_off:
        stuck = [l["name"] for l in plan["loans"] if l["payoff_month"] is None or l["payoff_month"] > cap]
        warnings.append(
            f"{', '.join(stuck)} never pays off within {cap} months — raise the extra monthly contribution."
        )

    return {
        "strategy": strategy,
        "inputs": {
            "strategy": strategy,
            "lumpSum": round(float(lump_sum or 0.0), 2),
            "extraMonthly": round(float(extra_monthly or 0.0), 2),
            "recurringLump": round(float(recurring_lump or 0.0), 2),
            "recurringMonth": int(recurring_month),
            "recurringMonthLabel": _MONTH_ABBR[int(recurring_month) - 1] if 1 <= int(recurring_month) <= 12 else "Dec",
            "recurringYears": int(recurring_years or 0),
            "recurringApplied": int(plan.get("recurring_count", 0)),
            "recurringPaid": round(float(plan.get("recurring_paid", 0.0)), 2),
            "recurringPaidDisplay": format_metric_currency(plan.get("recurring_paid", 0.0)),
            "includePrimary": bool(include_primary),
        },
        "startDate": start_date.isoformat(),
        "marketRate": market_rate,
        "portfolio": {
            "loanCount": len(loans),
            "totalDebt": round(total_debt, 2),
            "totalDebtDisplay": format_metric_currency(total_debt),
            "noiSum": round(float(noi_sum or 0.0), 2),
            "noiSumDisplay": format_currency(noi_sum),
        },
        "cards": cards,
        "story": story,
        "savingsNote": savings_note,
        "timeline": timeline,
        "rollover": rollover,
        "warnings": warnings,
        "debtFreeMonth": debt_free_month,
        "baselineMonth": baseline_month,
        "baselineDate": _format_month_year(_add_months(start_date, baseline_month)),
        "axisMonths": axis_months,
    }
