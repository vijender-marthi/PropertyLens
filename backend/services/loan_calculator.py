"""Loan amortization scenario calculations."""

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from services.formatters import format_currency as _fmt_money, format_interest_rate


def monthly_payment(principal: float, annual_rate: float, years: int) -> float:
    """Calculate standard monthly principal-and-interest payment."""
    principal = float(principal or 0)
    years = max(1, int(years or 30))
    if principal <= 0:
        return 0.0
    if annual_rate == 0:
        return principal / (years * 12)
    r = float(annual_rate or 0) / 100 / 12
    n = years * 12
    return principal * (r * (1 + r) ** n) / ((1 + r) ** n - 1)


def amortization_schedule(
    principal: float,
    annual_rate: float,
    years: int,
    extra_monthly: float = 0.0,
    start_date: Optional[str] = None,
    base_monthly_payment: float = 0.0,
) -> List[Dict[str, Any]]:
    """Generate one amortization run used by both chart and stats."""
    del start_date
    principal = float(principal or 0)
    annual_rate = float(annual_rate or 0)
    years = max(1, int(years or 30))
    extra_monthly = float(extra_monthly or 0)
    r = annual_rate / 100 / 12
    n = years * 12
    base_payment = (
        float(base_monthly_payment)
        if base_monthly_payment and base_monthly_payment > 0
        else monthly_payment(principal, annual_rate, years)
    )
    total_payment = base_payment + extra_monthly
    balance = principal
    schedule = []
    total_interest = 0.0

    for month in range(1, n + 1):
        if balance <= 0:
            break
        interest = balance * r
        if total_payment <= interest and balance > 0:
            break
        principal_paid = min(max(total_payment - interest, 0.0), balance)
        balance = max(balance - principal_paid, 0.0)
        total_interest += interest
        schedule.append({
            "month": month,
            "payment": round(total_payment, 2),
            "principal": round(principal_paid, 2),
            "interest": round(interest, 2),
            "balance": round(balance, 2),
            "total_interest_paid": round(total_interest, 2),
        })
        if balance == 0:
            break

    return schedule


def payoff_analysis(
    principal: float,
    annual_rate: float,
    years: int,
    extra_monthly: float = 0.0,
    base_monthly_payment: float = 0.0,
) -> Dict[str, Any]:
    """Compare baseline and accelerated payoff from one backend engine."""
    base_schedule = amortization_schedule(
        principal,
        annual_rate,
        years,
        0,
        base_monthly_payment=base_monthly_payment,
    )
    accelerated_schedule = amortization_schedule(
        principal,
        annual_rate,
        years,
        extra_monthly,
        base_monthly_payment=base_monthly_payment,
    )
    base_months = len(base_schedule)
    accelerated_months = len(accelerated_schedule)
    base_interest = base_schedule[-1]["total_interest_paid"] if base_schedule else 0.0
    accelerated_interest = (
        accelerated_schedule[-1]["total_interest_paid"] if accelerated_schedule else 0.0
    )
    baseline_payment = (
        float(base_monthly_payment)
        if base_monthly_payment and base_monthly_payment > 0
        else (base_schedule[0]["payment"] if base_schedule else 0.0)
    )
    total_payment = baseline_payment + float(extra_monthly or 0)
    is_paid_off = bool(accelerated_schedule and accelerated_schedule[-1]["balance"] <= 0)
    payoff_time = None
    if is_paid_off:
        payoff_years = accelerated_months // 12
        payoff_months = accelerated_months % 12
        payoff_time = (
            f"{payoff_years} yr {payoff_months} mo"
            if payoff_months
            else f"{payoff_years} yr"
        )

    return {
        "base_months": base_months,
        "extra_months": accelerated_months,
        "months_to_payoff": accelerated_months if is_paid_off else None,
        "payoff_time": payoff_time,
        "months_saved": base_months - accelerated_months,
        "years_saved": round((base_months - accelerated_months) / 12, 1),
        "base_total_interest": round(base_interest, 2),
        "extra_total_interest": round(accelerated_interest, 2),
        "total_interest": round(accelerated_interest, 2),
        "interest_saved": round(base_interest - accelerated_interest, 2),
        "base_monthly_payment": round(baseline_payment, 2),
        "monthly_payment": round(total_payment, 2),
        "extra_payment": round(float(extra_monthly or 0), 2),
        "is_amortizing": is_paid_off,
    }


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(value.day, 28))


def _parse_start_date(value: Optional[str]) -> date:
    if not value:
        return date.today().replace(day=1)
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value[:10], fmt).date().replace(day=1)
        except ValueError:
            continue
    return date.today().replace(day=1)


def _fmt_payoff(months: int) -> str:
    years = months // 12
    rem = months % 12
    return f"{years} yr {rem} mo" if rem else f"{years} yr"


def _scenario_extra_for_month(month_date: date, scenario: Dict[str, Any]) -> Dict[str, float]:
    extra_monthly = float(scenario.get("extra_monthly") or 0)
    annual_lump_sum = float(scenario.get("annual_lump_sum") or 0)
    annual_month = int(scenario.get("annual_lump_sum_month") or 12)
    one_time_payments = scenario.get("one_time_payments") or []
    one_time = 0.0
    for payment in one_time_payments:
        amount = float(payment.get("amount") or 0)
        payment_date = _parse_start_date(payment.get("date"))
        if amount > 0 and payment_date.year == month_date.year and payment_date.month == month_date.month:
            one_time += amount
    annual = annual_lump_sum if annual_lump_sum > 0 and month_date.month == annual_month else 0.0
    return {
        "extra_monthly": extra_monthly,
        "annual_lump_sum": annual,
        "one_time": one_time,
        "total_extra": extra_monthly + annual + one_time,
    }


def scenario_schedule(
    principal: float,
    annual_rate: float,
    years: int,
    scenario: Optional[Dict[str, Any]] = None,
    *,
    start_date: Optional[str] = None,
    base_monthly_payment: float = 0.0,
    market_value: float = 0.0,
) -> List[Dict[str, Any]]:
    scenario = scenario or {}
    principal = float(principal or 0)
    annual_rate = float(annual_rate or 0)
    years = max(1, int(years or 30))
    rate = annual_rate / 100 / 12
    base_payment = float(base_monthly_payment or 0) or monthly_payment(principal, annual_rate, years)
    balance = principal
    start = _parse_start_date(start_date)
    rows: List[Dict[str, Any]] = []
    running_interest = 0.0
    max_months = years * 12 + 360
    for payment_number in range(1, max_months + 1):
        if balance <= 0:
            break
        current_date = _add_months(start, payment_number - 1)
        beginning_balance = balance
        interest = beginning_balance * rate
        extras = _scenario_extra_for_month(current_date, scenario)
        scheduled_principal = max(base_payment - interest, 0.0)
        total_principal = min(scheduled_principal + extras["total_extra"], beginning_balance)
        if base_payment <= interest and extras["total_extra"] <= 0:
            break
        ending_balance = max(beginning_balance - total_principal, 0.0)
        running_interest += interest
        equity = max(float(market_value or 0) - ending_balance, 0.0) if market_value else 0.0
        rows.append({
            "payment_number": payment_number,
            "date": current_date.isoformat(),
            "year": current_date.year,
            "month": current_date.month,
            "beginning_balance": round(beginning_balance, 2),
            "monthly_payment": round(base_payment + extras["extra_monthly"], 2),
            "principal": round(total_principal, 2),
            "interest": round(interest, 2),
            "extra_monthly": round(extras["extra_monthly"], 2),
            "annual_lump_sum": round(extras["annual_lump_sum"], 2),
            "one_time_payment": round(extras["one_time"], 2),
            "ending_balance": round(ending_balance, 2),
            "running_interest_paid": round(running_interest, 2),
            "equity": round(equity, 2),
        })
        balance = ending_balance
    return rows


def simulate_what_if_scenarios(
    principal: float,
    annual_rate: float,
    years: int,
    scenarios: List[Dict[str, Any]],
    *,
    start_date: Optional[str] = None,
    base_monthly_payment: float = 0.0,
    market_value: float = 0.0,
    monthly_cash_flow: float = 0.0,
    dscr: float = 0.0,
    comparison_rates: Optional[Dict[str, float]] = None,
    highlight_goal: str = "interest_saved",
) -> Dict[str, Any]:
    rates = {
        "sp500": float((comparison_rates or {}).get("sp500", 0.08) or 0.08),
        "hysa": float((comparison_rates or {}).get("hysa", 0.04) or 0.04),
        "rental": float((comparison_rates or {}).get("rental", 0.06) or 0.06),
    }
    goal = highlight_goal if highlight_goal in {"interest_saved", "roi"} else "interest_saved"
    seen_names: Dict[str, int] = {}

    def clean_scenario(raw: Dict[str, Any], index: int) -> Dict[str, Any]:
        scenario = dict(raw or {})
        scenario_type = (scenario.get("type") or "combination").lower()
        if scenario_type == "baseline":
            scenario.update({"extra_monthly": 0, "annual_lump_sum": 0, "one_time_payments": []})
        elif scenario_type == "extra_monthly":
            scenario.update({"annual_lump_sum": 0, "one_time_payments": []})
        elif scenario_type == "annual_lump_sum":
            scenario.update({"extra_monthly": 0, "one_time_payments": []})
        elif scenario_type == "one_time":
            scenario.update({"extra_monthly": 0, "annual_lump_sum": 0})
        name = (scenario.get("name") or scenario.get("type") or f"Scenario {index}").strip()
        count = seen_names.get(name, 0)
        seen_names[name] = count + 1
        scenario["name"] = f"{name} ({count + 1})" if count else name
        scenario["type"] = scenario_type
        return scenario

    baseline = clean_scenario({"id": "baseline", "name": "Baseline", "type": "baseline"}, 0)
    all_scenarios = [baseline] + [
        clean_scenario(scenario, index + 1)
        for index, scenario in enumerate(scenarios)
        if scenario.get("id") != "baseline"
    ]

    schedules: Dict[str, List[Dict[str, Any]]] = {}
    for index, scenario in enumerate(all_scenarios):
        sid = scenario.get("id") or f"scenario-{index}"
        schedules[sid] = scenario_schedule(
            principal,
            annual_rate,
            years,
            scenario,
            start_date=start_date,
            base_monthly_payment=base_monthly_payment,
            market_value=market_value,
        )

    baseline_rows = schedules["baseline"]
    baseline_interest = sum(row["interest"] for row in baseline_rows)
    baseline_months = len(baseline_rows)
    comparison = []
    scenario_details: Dict[str, Dict[str, Any]] = {}
    base_payment = float(base_monthly_payment or 0) or monthly_payment(principal, annual_rate, years)

    for index, scenario in enumerate(all_scenarios):
        sid = scenario.get("id") or f"scenario-{index}"
        rows = schedules[sid]
        total_interest = sum(row["interest"] for row in rows)
        cash_required = sum(row["extra_monthly"] + row["annual_lump_sum"] + row["one_time_payment"] for row in rows)
        months_saved = baseline_months - len(rows)
        interest_saved = baseline_interest - total_interest
        lifetime_return = (interest_saved / cash_required * 100) if cash_required > 0 else None
        payoff_years = max(len(rows) / 12, 1)
        annualized_return = None
        if cash_required > 0 and interest_saved > -cash_required:
            annualized_return = ((1 + (interest_saved / cash_required)) ** (1 / payoff_years) - 1) * 100
        max_monthly_extra = max((row["extra_monthly"] for row in rows), default=0)
        annual_lump = float(scenario.get("annual_lump_sum") or 0)
        annual_month = int(scenario.get("annual_lump_sum_month") or 12)
        one_time_payments = scenario.get("one_time_payments") or []
        one_time_total = sum(float(payment.get("amount") or 0) for payment in one_time_payments)
        month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        outflow_lines = []
        if max_monthly_extra > 0:
            outflow_lines.append({"label": "Monthly outflow required", "value": round(max_monthly_extra, 2), "display": f"{_fmt_money(max_monthly_extra)}/mo"})
        if annual_lump > 0:
            outflow_lines.append({"label": "Annual outflow required", "value": round(annual_lump, 2), "display": f"{_fmt_money(annual_lump)}/yr every {month_names[annual_month]}"})
        for payment in one_time_payments:
            amount = float(payment.get("amount") or 0)
            if amount > 0:
                outflow_lines.append({"label": "One-time outflow required", "value": round(amount, 2), "display": f"{_fmt_money(amount)} on {(payment.get('date') or '-')[:7]}"})
        scenario_cash_flow = monthly_cash_flow - max_monthly_extra
        if max_monthly_extra > 0:
            cash_flow_note = "Confirm this monthly delta fits your reserves."
        elif annual_lump > 0:
            cash_flow_note = f"Confirm the {_fmt_money(annual_lump)} lump fits your reserves or savings."
        elif one_time_total > 0:
            cash_flow_note = f"Confirm the {_fmt_money(one_time_total)} one-time payment fits your reserves or savings."
        else:
            cash_flow_note = "No extra outflow in this scenario."
        summary = {
            "id": sid,
            "name": scenario.get("name") or scenario.get("type") or "Scenario",
            "type": scenario.get("type") or "custom",
            "is_noop": cash_required <= 0 and sid != "baseline",
            "remaining_balance": rows[-1]["ending_balance"] if rows else principal,
            "loan_paid_off": rows[-1]["date"] if rows else None,
            "months_to_payoff": len(rows),
            "payoff_time": _fmt_payoff(len(rows)) if rows else "-",
            "interest_paid": round(total_interest, 2),
            "interest_saved": round(interest_saved, 2),
            "years_saved": round(months_saved / 12, 1),
            "months_saved": months_saved,
            "monthly_payment": round(base_payment + max_monthly_extra, 2),
            "return_on_capital_lifetime": round(lifetime_return, 2) if lifetime_return is not None else None,
            "annualized_return": round(annualized_return, 2) if annualized_return is not None else None,
            "effective_roi": round(lifetime_return, 2) if lifetime_return is not None else None,
            "cash_required": round(cash_required, 2),
            "current_cash_flow": round(monthly_cash_flow, 2),
            "scenario_cash_flow": round(scenario_cash_flow, 2),
            "monthly_cash_flow_difference": round(-max_monthly_extra, 2),
            "cash_flow_after": round(scenario_cash_flow, 2),
            "cash_flow_difference": round(-max_monthly_extra, 2),
            "cash_outflow_lines": outflow_lines,
            "total_cash_deployed": round(cash_required, 2),
            "cash_flow_note": cash_flow_note,
        }
        yearly_by_year: Dict[int, Dict[str, float]] = {}
        for row in rows:
            bucket = yearly_by_year.setdefault(row["year"], {"principal": 0.0, "interest": 0.0, "extra": 0.0, "ending_balance": row["ending_balance"], "running_interest": row["running_interest_paid"]})
            bucket["principal"] += row["principal"]
            bucket["interest"] += row["interest"]
            bucket["extra"] += row["extra_monthly"] + row["annual_lump_sum"] + row["one_time_payment"]
            bucket["ending_balance"] = row["ending_balance"]
            bucket["running_interest"] = row["running_interest_paid"]
        yearly = [{"year": year, **{key: round(value, 2) for key, value in values.items()}} for year, values in sorted(yearly_by_year.items())]
        comparison.append(summary)
        scenario_details[sid] = {"summary": summary, "schedule": rows, "yearly": yearly}

    active_id = all_scenarios[-1].get("id") or f"scenario-{len(all_scenarios)-1}"
    active_rows = schedules[active_id]
    chart_data = []
    for idx in range(max(len(baseline_rows), len(active_rows))):
        base = baseline_rows[idx] if idx < len(baseline_rows) else (baseline_rows[-1] if baseline_rows else None)
        active = active_rows[idx] if idx < len(active_rows) else (active_rows[-1] if active_rows else None)
        if not base and not active:
            continue
        chart_data.append({
            "payment_number": idx + 1,
            "date": (active or base)["date"],
            "baseline_balance": base["ending_balance"] if base and idx < len(baseline_rows) else 0,
            "scenario_balance": active["ending_balance"] if active and idx < len(active_rows) else 0,
            "baseline_interest": base["running_interest_paid"] if base else baseline_interest,
            "scenario_interest": active["running_interest_paid"] if active else scenario_details[active_id]["summary"]["interest_paid"],
            "interest_saved": round((base["running_interest_paid"] if base else baseline_interest) - (active["running_interest_paid"] if active else scenario_details[active_id]["summary"]["interest_paid"]), 2),
            "baseline_equity": base["equity"] if base else market_value,
            "scenario_equity": active["equity"] if active else market_value,
            "principal": active["principal"] if active else 0,
            "interest": active["interest"] if active else 0,
            "extra": (active["extra_monthly"] + active["annual_lump_sum"] + active["one_time_payment"]) if active else 0,
        })

    active_summary = scenario_details[active_id]["summary"]
    years_to_payoff = max(active_summary["months_to_payoff"] / 12, 1)
    cash_required = active_summary["cash_required"]
    opportunity = [{"label": "Extra mortgage payment", "future_value": round(active_summary["interest_saved"], 2), "rate": None}]
    for key, label in [("sp500", "S&P 500"), ("hysa", "HYSA"), ("rental", "Buy another rental")]:
        rate = rates[key]
        future_value = cash_required * ((1 + rate) ** years_to_payoff)
        opportunity.append({"label": f"{label} @ {rate * 100:.1f}%", "future_value": round(future_value, 2), "rate": rate})

    best_investment = max(opportunity[1:], key=lambda item: item["future_value"]) if len(opportunity) > 1 else None
    payoff_value = active_summary["interest_saved"]
    investing_wins = bool(best_investment and best_investment["future_value"] > payoff_value)
    verdict_diff = (best_investment["future_value"] - payoff_value) if best_investment else 0
    sp500_value = next((item["future_value"] for item in opportunity if item["label"].startswith("S&P 500")), 0)
    verdict = {
        "winner": "Investing" if investing_wins else "Paying down",
        "headline": (
            f"Paying down a {annual_rate:.2f}% loan saves {_fmt_money(payoff_value)}; "
            f"investing the same {_fmt_money(cash_required)} at {rates['sp500'] * 100:.1f}% earns {_fmt_money(sp500_value)}. "
            f"{'Investing' if investing_wins else 'Paying down'} wins by {_fmt_money(abs(verdict_diff))}."
        ),
        "loan_rate": annual_rate,
        "cash_required": cash_required,
        "payoff_value": round(payoff_value, 2),
        "best_investment": best_investment,
        "difference": round(abs(verdict_diff), 2),
    }

    non_baseline = [item for item in comparison if item["id"] != "baseline" and not item.get("is_noop")]
    best = None
    if non_baseline:
        best = max(
            non_baseline,
            key=lambda item: item["interest_saved"] if goal == "interest_saved" else (item.get("annualized_return") or -999999),
        )
    for item in comparison:
        item["is_best"] = bool(best and item["id"] == best["id"])

    insights = [verdict["headline"]]
    if monthly_cash_flow < 0:
        insights.append(f"Property loses {_fmt_money(abs(monthly_cash_flow))}/mo (DSCR {dscr:.2f}) - payoff does not fix cash flow unless operations improve.")
    break_even_rate = active_summary["annualized_return"]
    if break_even_rate is not None:
        insights.append(f"Break-even: paying down beats investing only when your alternative return is below about {break_even_rate:.1f}% annually.")
    if active_summary["cash_flow_difference"] <= -500:
        insights.append("This strategy is aggressive because it materially reduces monthly cash flow.")
    elif active_summary["cash_required"] > 0:
        insights.append("This strategy is conservative if the extra capital is already reserved for debt reduction.")

    timeline = []
    expanded_timeline = []
    annual_groups: Dict[tuple, Dict[str, Any]] = {}
    for row in active_rows:
        if row["annual_lump_sum"] > 0:
            key = (row["annual_lump_sum"], row["month"])
            bucket = annual_groups.setdefault(key, {"amount": row["annual_lump_sum"], "month": row["month"], "start": row["date"], "end": row["date"], "count": 0, "total": 0.0})
            bucket["end"] = row["date"]
            bucket["count"] += 1
            bucket["total"] += row["annual_lump_sum"]
            expanded_timeline.append({"date": row["date"], "label": f"Annual lump sum {_fmt_money(row['annual_lump_sum'])}", "type": "annual_lump_sum"})
        if row["one_time_payment"] > 0:
            event = {"date": row["date"], "label": f"One-time payment {_fmt_money(row['one_time_payment'])}", "type": "one_time"}
            timeline.append(event)
            expanded_timeline.append(event)
    month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    for group in annual_groups.values():
        start_year = group["start"][:4]
        end_year = group["end"][:4]
        timeline.append({
            "date": group["start"],
            "label": f"{_fmt_money(group['amount'])}/yr every {month_names[group['month']]} {start_year}-{end_year} ({group['count']}x, {_fmt_money(group['total'])})",
            "type": "annual_lump_sum",
        })
    if active_summary["loan_paid_off"]:
        payoff_event = {"date": active_summary["loan_paid_off"], "label": "Paid off", "type": "payoff"}
        timeline.append(payoff_event)
        expanded_timeline.append(payoff_event)

    return {
        "baseline": comparison[0],
        "activeScenarioId": active_id,
        "comparison": comparison,
        "scenarios": scenario_details,
        "active": scenario_details[active_id],
        "charts": chart_data,
        "timeline": sorted(timeline, key=lambda item: item["date"]),
        "expandedTimeline": sorted(expanded_timeline, key=lambda item: item["date"]),
        "opportunityCost": opportunity,
        "opportunityVerdict": verdict,
        "insights": insights,
        "highlightGoal": goal,
        "comparisonRates": rates,
        "scheduleFilters": ["monthly", "quarterly", "yearly"],
    }

def arm_schedule(
    principal: float,
    initial_rate: float,
    initial_period_years: int,
    adjustment_period_years: int,
    rate_cap: float,
    margin: float,
    total_years: int,
    rate_adjustments: List[float] = None,
) -> List[Dict[str, Any]]:
    """ARM amortization schedule with rate adjustments."""
    del margin
    schedule = []
    balance = float(principal or 0)
    current_rate = float(initial_rate or 0)
    total_interest = 0.0
    adjustment_period_years = max(1, int(adjustment_period_years or 1))
    total_years = max(1, int(total_years or 30))

    if rate_adjustments is None:
        rate_adjustments = [
            min(current_rate + 2 * (i + 1), rate_cap)
            for i in range(total_years // adjustment_period_years + 1)
        ]

    initial_months = max(0, int(initial_period_years or 0) * 12)
    for month in range(1, total_years * 12 + 1):
        if balance <= 0:
            break
        if month > initial_months:
            adj_num = (month - initial_months - 1) // (adjustment_period_years * 12)
            if adj_num < len(rate_adjustments):
                current_rate = rate_adjustments[adj_num]
        r = current_rate / 100 / 12
        remaining_months = total_years * 12 - month + 1
        payment = balance / remaining_months if r == 0 else (
            balance * (r * (1 + r) ** remaining_months)
            / ((1 + r) ** remaining_months - 1)
        )
        interest = balance * r
        principal_paid = max(payment - interest, 0.0)
        balance = max(balance - principal_paid, 0.0)
        total_interest += interest
        schedule.append({
            "month": month,
            "rate": round(current_rate, 3),
            "payment": round(payment, 2),
            "principal": round(principal_paid, 2),
            "interest": round(interest, 2),
            "balance": round(balance, 2),
            "total_interest_paid": round(total_interest, 2),
        })

    return schedule


def depreciation_schedule(
    property_value: float,
    land_value: float,
    depreciation_years: int = 27,
) -> Dict[str, Any]:
    """Annual depreciation for rental property (straight-line)."""
    depreciable_basis = float(property_value or 0) - float(land_value or 0)
    depreciation_years = max(1, int(depreciation_years or 27))
    annual_depreciation = depreciable_basis / depreciation_years
    return {
        "depreciable_basis": round(depreciable_basis, 2),
        "annual_depreciation": round(annual_depreciation, 2),
        "monthly_depreciation": round(annual_depreciation / 12, 2),
        "depreciation_years": depreciation_years,
    }
