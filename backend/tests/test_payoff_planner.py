"""Payoff planner engine tests — assertions P1-P7 plus the worked cascade example.

These tests exercise the pure backend simulation in
``services.payoff_planner`` and do NOT import the FastAPI app, so they run even
while the repository checkpoint has unrelated broken app imports. A ``__main__``
runner is included so the suite can be executed directly:

    python3 tests/test_payoff_planner.py
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.payoff_planner import (  # noqa: E402
    build_report,
    check_assertions,
    simulate,
)

# Worked example from the spec (5 rentals). rate is an annual fraction.
EXAMPLE_LOANS = [
    {"name": "Osprey",  "balance": 438_500.0, "rate": 0.07625, "pi": 3318.0, "noi": 3088.0},
    {"name": "Mission", "balance": 460_000.0, "rate": 0.065,   "pi": 2900.0, "noi": 3540.0},
    {"name": "Heron",   "balance": 500_000.0, "rate": 0.060,   "pi": 3200.0, "noi": 3680.0},
    {"name": "Lark",    "balance": 410_000.0, "rate": 0.0575,  "pi": 2700.0, "noi": 2700.0},
    {"name": "Wren",    "balance": 380_000.0, "rate": 0.045,   "pi": 2500.0, "noi": 3550.0},
]
NOI_SUM = sum(l["noi"] for l in EXAMPLE_LOANS)  # 16558
TOTAL_DEBT = sum(l["balance"] for l in EXAMPLE_LOANS)  # 2,188,500


# ---------------------------------------------------------------------------
# Assertions P1-P7 across strategies and input combinations.
# ---------------------------------------------------------------------------
_CASES = [
    ("avalanche", 100_000.0, 3000.0),
    ("snowball", 100_000.0, 3000.0),
    ("avalanche", 0.0, 0.0),
    ("snowball", 0.0, 0.0),
    ("avalanche", 300_000.0, 8000.0),
    ("snowball", 50_000.0, 1500.0),
]


def test_p1_all_principal_cleared():
    for strategy, lump, extra in _CASES:
        r = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        assert r["P1"]["passed"], (strategy, lump, extra, r["P1"]["detail"])


def test_p2_plan_not_slower_than_baseline():
    for strategy, lump, extra in _CASES:
        r = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        assert r["P2"]["passed"], (strategy, lump, extra, r["P2"]["detail"])


def test_p3_interest_saved_non_negative():
    for strategy, lump, extra in _CASES:
        r = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        assert r["P3"]["passed"], (strategy, lump, extra, r["P3"]["detail"])


def test_p4_every_loan_pays_off():
    for strategy, lump, extra in _CASES:
        r = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        assert r["P4"]["passed"], (strategy, lump, extra, r["P4"]["detail"])


def test_p5_attack_never_hits_closed_loan():
    for strategy, lump, extra in _CASES:
        r = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        assert r["P5"]["passed"], (strategy, lump, extra, r["P5"]["detail"])


def test_p6_strategy_order_strict():
    ava = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy="avalanche", lump_sum=100_000, extra_monthly=3000)
    snow = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy="snowball", lump_sum=100_000, extra_monthly=3000)
    assert ava["P6"]["passed"], ava["P6"]["detail"]
    assert snow["P6"]["passed"], snow["P6"]["detail"]


def test_p7_cascade_frees_pi():
    for strategy, lump, extra in _CASES:
        r = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        assert r["P7"]["passed"], (strategy, lump, extra, r["P7"]["detail"])


# ---------------------------------------------------------------------------
# Behavioural checks tied to the spec.
# ---------------------------------------------------------------------------
def test_avalanche_targets_osprey_first():
    """Highest-rate loan (Osprey, 7.625%) must clear first under avalanche."""
    plan = simulate(EXAMPLE_LOANS, NOI_SUM, strategy="avalanche", lump_sum=100_000, extra_monthly=3000)
    by_name = {l["name"]: l["payoff_month"] for l in plan["loans"]}
    assert by_name["Osprey"] == min(by_name.values())


def test_snowball_targets_smallest_balance_first():
    """Smallest balance (Wren, 380k) must clear first under snowball."""
    plan = simulate(EXAMPLE_LOANS, NOI_SUM, strategy="snowball", lump_sum=100_000, extra_monthly=3000)
    by_name = {l["name"]: l["payoff_month"] for l in plan["loans"]}
    assert by_name["Wren"] == min(by_name.values())


def test_cascade_beats_standalone_schedule():
    """Later loans must pay off faster than their own minimum-only schedule."""
    plan = simulate(EXAMPLE_LOANS, NOI_SUM, strategy="avalanche", lump_sum=100_000, extra_monthly=3000)
    baseline = simulate(EXAMPLE_LOANS, NOI_SUM, strategy="avalanche", attack=False)
    plan_by = {l["name"]: l["payoff_month"] for l in plan["loans"]}
    base_by = {l["name"]: l["payoff_month"] for l in baseline["loans"]}
    for name in plan_by:
        assert plan_by[name] <= base_by[name]
    assert plan["months"] < baseline["months"]


def test_inputs_not_mutated():
    before = [dict(l) for l in EXAMPLE_LOANS]
    simulate(EXAMPLE_LOANS, NOI_SUM, strategy="avalanche", lump_sum=100_000, extra_monthly=3000)
    assert EXAMPLE_LOANS == before


def test_below_market_verdict_tag():
    report = build_report(EXAMPLE_LOANS, NOI_SUM, strategy="avalanche", lump_sum=100_000, extra_monthly=3000)
    tags = {row["name"]: row["verdict"]["belowMarket"] for row in report["timeline"]}
    # Below 6.5% market: Heron(6.0), Lark(5.75), Wren(4.5). Not: Osprey(7.625), Mission(6.5).
    assert tags["Heron"] and tags["Lark"] and tags["Wren"]
    assert not tags["Osprey"] and not tags["Mission"]


# ---------------------------------------------------------------------------
# Standalone runner (works despite unrelated broken app imports).
# ---------------------------------------------------------------------------
def _run_standalone():
    fixed_start = date(2026, 7, 1)
    print("=" * 70)
    print("PAYOFF PLANNER — ASSERTIONS P1-P7")
    print("=" * 70)

    all_ok = True
    for strategy, lump, extra in _CASES:
        res = check_assertions(EXAMPLE_LOANS, NOI_SUM, strategy=strategy, lump_sum=lump, extra_monthly=extra)
        row_ok = all(v["passed"] for v in res.values())
        all_ok = all_ok and row_ok
        flags = " ".join(f"{k}:{'PASS' if v['passed'] else 'FAIL'}" for k, v in sorted(res.items()))
        print(f"  {strategy:9s} lump={lump:>9,.0f} extra={extra:>6,.0f}  {flags}")

    print("-" * 70)
    print(f"  RESULT: {'ALL ASSERTIONS PASS' if all_ok else 'FAILURES PRESENT'}")

    print()
    print("=" * 70)
    print("WORKED EXAMPLE — lump 100k, extra 3k, AVALANCHE")
    print(f"  Total debt: ${TOTAL_DEBT:,.0f}   NOIsum: ${NOI_SUM:,.0f}")
    print("=" * 70)
    report = build_report(
        EXAMPLE_LOANS, NOI_SUM, strategy="avalanche",
        lump_sum=100_000, extra_monthly=3000, start_date=fixed_start,
    )
    baseline_month = report["baselineMonth"]
    print(f"  {'#':>2} {'Loan':8s} {'Rate':>8s} {'Balance':>12s} "
          f"{'Payoff mo':>9s} {'Date':>9s}  Note")
    for row in report["timeline"]:
        note = row["verdict"]["tag"] or ("cascade" if row["cascade"] else "")
        print(f"  {row['order']:>2} {row['name']:8s} {row['rateDisplay']:>8s} "
              f"{row['balanceDisplay']:>12s} {str(row['payoffMonth']):>9s} "
              f"{str(row['payoffDate']):>9s}  {note}")
    print("-" * 70)
    print(f"  Debt-free month (plan):     {report['debtFreeMonth']}  "
          f"({report['cards']['debtFree']['display']}, {report['cards']['debtFree']['date']})")
    print(f"  Baseline (minimums only):   {baseline_month}  "
          f"({report['cards']['timeSaved']['baselineDisplay']})")
    print(f"  Time saved:                 {report['cards']['timeSaved']['display']}")
    print(f"  Interest saved:             {report['cards']['interestSaved']['display']}")
    print(f"  Story: {report['story']}")

    if not all_ok:
        sys.exit(1)


if __name__ == "__main__":
    _run_standalone()
