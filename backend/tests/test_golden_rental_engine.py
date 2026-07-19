"""Golden-file property for engine correctness.

The numbers in this test are hand-computed for "Golden Test Rental" and should
not move unless the product definition changes.
"""

from types import SimpleNamespace
import json

import pytest

from routers.properties import compute_property_metrics
from services.property_engine import build_property_engine, monthly_principal_interest


def _loan(**overrides):
    data = {
        "id": 1,
        "lender_name": "Golden Loan",
        "loan_type": "FIXED",
        "original_amount": 400_000.0,
        "current_balance": 0.0,
        "interest_rate": 6.0,
        "loan_term_years": 30,
        "origination_date": "2024-01-01",
        "monthly_payment": monthly_principal_interest(400_000, 6.0, 30),
        "escrow_amount": 0.0,
        "extra_monthly_payment": 0.0,
        "principal_due": None,
        "interest_due": None,
        "documents": [],
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def _property(**overrides):
    loan = _loan()
    prop = SimpleNamespace(
        id=999,
        property_uid="golden-rental",
        name="Golden Test Rental",
        property_type="Single Family",
        usage_type="Rental",
        purchase_date="2024-01-01",
        purchase_price=500_000.0,
        land_value=100_000.0,
        down_payment=100_000.0,
        closing_costs=10_000.0,
        market_value=550_000.0,
        monthly_rent=3_000.0,
        occupancy_rate=95.0,
        property_tax=6_000.0,
        insurance=1_200.0,
        hoa_fee=0.0,
        maintenance=200.0,
        property_management_fee=0.0,
        utilities=0.0,
        vacancy_allowance=0.0,
        capex_reserve=0.0,
        other_expenses=0.0,
        solar_ownership="None",
        solar_monthly_payment=0.0,
        depreciation_years=27.5,
        rental_periods=[],
        usage_periods=[
            SimpleNamespace(
                usage_type="RENTAL",
                start_date="2024-01-01",
                end_date=None,
                fmv_at_start=0.0,
            )
        ],
        loans=[loan],
    )
    for key, value in overrides.items():
        setattr(prop, key, value)
    for item in prop.loans:
        item.property = prop
    return prop


def _passive_allowance(magi, active_participation=True):
    if not active_participation:
        return 0
    return max(0, min(25_000, 25_000 - max(0, magi - 100_000) * 0.5))


def test_golden_rental_expected_outputs():
    prop = _property()
    loan = prop.loans[0]
    engine = build_property_engine(prop, as_of=__import__("datetime").date(2024, 12, 31))
    row_2024 = engine.annual_rows(loan)[0]
    metrics = compute_property_metrics(prop)
    depreciation = engine.depreciation(2024)

    assert loan.monthly_payment == pytest.approx(2_398.20, abs=0.01)
    assert row_2024["mortgage_paid"] == pytest.approx(28_778.35, abs=2)
    assert row_2024["interest_paid"] == pytest.approx(23_866, abs=2)
    assert row_2024["principal_paid"] == pytest.approx(4_912, abs=2)
    assert row_2024["ending_balance"] == pytest.approx(395_088, abs=2)
    assert loan.original_amount - row_2024["principal_paid"] == pytest.approx(row_2024["ending_balance"], abs=2)

    gross_rent = prop.monthly_rent * 12
    vacancy = gross_rent * 0.05
    egi = gross_rent - vacancy
    operating_expenses = prop.property_tax + prop.insurance + prop.maintenance * 12
    noi = egi - operating_expenses

    assert gross_rent == pytest.approx(36_000, abs=2)
    assert vacancy == pytest.approx(1_800, abs=2)
    assert egi == pytest.approx(34_200, abs=2)
    assert operating_expenses == pytest.approx(9_600, abs=2)
    assert metrics["annual_noi"] == pytest.approx(24_600, abs=2)
    assert noi == pytest.approx(24_600, abs=2)

    annual_cash_flow = noi - row_2024["mortgage_paid"]
    monthly_cash_flow = annual_cash_flow / 12
    assert annual_cash_flow == pytest.approx(-4_178.35, abs=2)
    assert monthly_cash_flow == pytest.approx(-348.20, abs=2)
    assert monthly_cash_flow == pytest.approx(annual_cash_flow / 12, abs=0.01)
    assert operating_expenses == pytest.approx(prop.property_tax + prop.insurance + prop.maintenance * 12, abs=2)

    cap_rate = noi / prop.market_value * 100
    dscr = noi / row_2024["mortgage_paid"]
    cash_invested = prop.down_payment + prop.closing_costs
    cash_on_cash = annual_cash_flow / cash_invested * 100
    assert cap_rate == pytest.approx(4.47, abs=0.01)
    assert dscr == pytest.approx(0.855, abs=0.001)
    assert (dscr < 1) == (annual_cash_flow < 0)
    assert cash_invested == pytest.approx(110_000, abs=2)
    assert cash_on_cash == pytest.approx(-3.80, abs=0.02)

    assert depreciation["basis"] == pytest.approx(400_000, abs=2)
    assert depreciation["full_year_amount"] == pytest.approx(14_545.45, abs=0.01)
    assert depreciation["amount"] == pytest.approx(13_939, abs=2)
    assert depreciation["accumulated"] == pytest.approx(13_939, abs=2)

    taxable_income = egi - operating_expenses - row_2024["interest_paid"] - depreciation["amount"]
    passive_allowance = _passive_allowance(90_000, True)
    allowed_loss = min(abs(taxable_income), passive_allowance)
    suspended_loss = max(0, abs(taxable_income) - allowed_loss)
    assert taxable_income == pytest.approx(-13_205, abs=2)
    assert passive_allowance == pytest.approx(25_000, abs=2)
    assert allowed_loss == pytest.approx(13_205, abs=2)
    assert suspended_loss == 0
    assert annual_cash_flow != pytest.approx(taxable_income, abs=2)

    equity = prop.market_value - row_2024["ending_balance"]
    ltv = row_2024["ending_balance"] / prop.market_value * 100
    assert equity == pytest.approx(154_912, abs=2)
    assert ltv == pytest.approx(71.8, abs=0.1)

    assert engine.balance_today(loan) == pytest.approx(row_2024["ending_balance"], abs=0.01)
    assert engine.annual_interest(loan, 2024) == pytest.approx(row_2024["interest_paid"], abs=0.01)
    assert engine.annual_principal(loan, 2024) == pytest.approx(row_2024["principal_paid"], abs=0.01)


def test_golden_rental_negative_edges():
    no_land = _property(land_value=0.0)
    no_land_dep = build_property_engine(no_land, as_of=__import__("datetime").date(2024, 12, 31)).depreciation(2024)
    assert no_land_dep["basis"] == pytest.approx(500_000, abs=2)
    assert "land not split" in no_land_dep["warning"]

    no_down = _property(down_payment=None)
    cash_on_cash = None if no_down.down_payment is None else -4_178.35 / (no_down.down_payment + no_down.closing_costs) * 100
    assert cash_on_cash is None

    primary = _property(usage_type="Primary", usage_periods=[SimpleNamespace(usage_type="PRIMARY", start_date="2024-01-01", end_date=None)])
    primary_dep = build_property_engine(primary, as_of=__import__("datetime").date(2024, 12, 31)).depreciation(2024)
    assert primary_dep["applicable"] is False
    assert primary_dep["amount"] is None

    missing_start = _property()
    missing_start.loans[0].origination_date = None
    engine = build_property_engine(missing_start, as_of=__import__("datetime").date(2024, 12, 31))
    assert any(check["rule"] == "startDate is required for amortization" and check["status"] == "warn" for check in engine.invariant_checks())
    assert engine.build_schedule(missing_start.loans[0]) == []

    partial = _property()
    partial_engine = build_property_engine(partial, as_of=__import__("datetime").date(2024, 6, 30))
    partial_row = partial_engine.annual_rows(partial.loans[0])[0]
    annualized_debt_service = partial_row["mortgage_paid"] / partial_row["months"] * 12
    assert partial_row["months"] == 6
    assert annualized_debt_service == pytest.approx(28_778.35, abs=2)


def test_balance_today_prefers_latest_single_loan_statement_balance():
    prop = _property()
    loan = prop.loans[0]
    loan.current_balance = loan.original_amount
    loan.account_number = "SETUP-ACCOUNT"
    prop.documents = [SimpleNamespace(
        id=91,
        doc_category="mortgage_statement",
        loan_account_number="STATEMENT-ACCOUNT",
        period_start=None,
        period_end=None,
        extracted_data=json.dumps({
            "statement_date": "2026-06-15",
            "current_balance": 351_234.56,
            "account_number": "STATEMENT-ACCOUNT",
        }),
    )]

    engine = build_property_engine(prop, as_of=__import__("datetime").date(2026, 7, 19))

    assert engine.balance_today(loan) == pytest.approx(351_234.56, abs=0.01)
