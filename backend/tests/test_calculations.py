"""
Unit tests for pure calculation functions in routers/properties.py.

These tests do NOT touch the database — they construct lightweight
namespace objects to drive the functions directly.
"""
import pytest
from types import SimpleNamespace
from routers.properties import compute_property_metrics, _principal_from_1098


# ---------------------------------------------------------------------------
# compute_property_metrics
# ---------------------------------------------------------------------------

def _make_prop(**overrides):
    """Minimal Property-like namespace for compute_property_metrics."""
    defaults = dict(
        monthly_rent=3_000.0,
        occupancy_rate=100.0,
        market_value=500_000.0,
        purchase_price=400_000.0,
        land_value=80_000.0,
        depreciation_years=27.5,
        property_tax=6_000.0,    # annual
        insurance=1_200.0,       # annual
        hoa_fee=0.0,
        maintenance=0.0,
        property_management_fee=0.0,
        utilities=0.0,
        vacancy_allowance=0.0,
        capex_reserve=0.0,
        other_expenses=0.0,
        usage_type="Rental",
        loans=[],
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _make_loan(**overrides):
    defaults = dict(
        current_balance=300_000.0,
        monthly_payment=2_023.0,
        escrow_amount=0.0,
        interest_rate=6.5,
        principal_due=398.0,
        interest_due=1_625.0,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestComputePropertyMetrics:

    def test_effective_rent_uses_occupancy(self):
        prop = _make_prop(monthly_rent=4_000.0, occupancy_rate=90.0)
        m = compute_property_metrics(prop)
        assert m["effective_rent"] == pytest.approx(3_600.0)

    def test_primary_home_zero_rent(self):
        prop = _make_prop(monthly_rent=3_000.0, usage_type="Primary")
        m = compute_property_metrics(prop)
        assert m["effective_rent"] == 0.0
        # NOI = (0 - monthly_ops) * 12; monthly_ops = (6000+1200)/12 = 600
        assert m["annual_noi"] == pytest.approx(-(600.0 * 12), rel=1e-3)

    def test_equity_calculation(self):
        loan = _make_loan(current_balance=250_000.0)
        prop = _make_prop(market_value=500_000.0, loans=[loan])
        m = compute_property_metrics(prop)
        assert m["equity"] == pytest.approx(250_000.0)

    def test_monthly_cash_flow_positive(self):
        # Rent $3 000, PI $600/mo, monthly ops < rent → positive CF
        loan = _make_loan(current_balance=100_000.0, monthly_payment=600.0)
        prop = _make_prop(
            monthly_rent=3_000.0,
            loans=[loan],
            property_tax=0.0,
            insurance=0.0,
        )
        m = compute_property_metrics(prop)
        assert m["monthly_cash_flow"] == pytest.approx(2_400.0)

    def test_monthly_cash_flow_negative(self):
        loan = _make_loan(current_balance=300_000.0, monthly_payment=2_023.0)
        prop = _make_prop(
            monthly_rent=2_000.0,    # rent < mortgage + expenses
            property_tax=6_000.0,
            insurance=1_200.0,
            loans=[loan],
        )
        m = compute_property_metrics(prop)
        assert m["monthly_cash_flow"] < 0

    def test_annual_depreciation(self):
        prop = _make_prop(
            purchase_price=400_000.0,
            land_value=80_000.0,
            depreciation_years=27.5,
        )
        m = compute_property_metrics(prop)
        expected = (400_000 * 0.75) / 27.5
        assert m["annual_depreciation"] == pytest.approx(expected, rel=1e-4)

    def test_annual_depreciation_uses_construction_price(self):
        prop = _make_prop(
            purchase_price=400_000.0,
            construction_price=280_000.0,
            depreciation_years=27.5,
        )
        m = compute_property_metrics(prop)
        expected = 280_000 / 27.5
        assert m["annual_depreciation"] == pytest.approx(expected, rel=1e-4)

    def test_cap_rate_no_debt(self):
        # NOI = (rent - monthly_ops) * 12; cap rate = NOI / market_value
        prop = _make_prop(
            monthly_rent=3_000.0,
            market_value=500_000.0,
            property_tax=6_000.0,
            insurance=1_200.0,
        )
        m = compute_property_metrics(prop)
        monthly_ops = (6_000 + 1_200) / 12
        annual_noi = (3_000 - monthly_ops) * 12
        expected_cap_rate = annual_noi / 500_000 * 100
        assert m["cap_rate"] == pytest.approx(expected_cap_rate, rel=1e-4)

    def test_escrow_stripped_from_mortgage(self):
        # escrow_amount is the taxes+insurance bundled in the payment.
        # monthly_mortgage should be payment − escrow (P&I only).
        loan = _make_loan(monthly_payment=2_500.0, escrow_amount=500.0)
        prop = _make_prop(loans=[loan])
        m = compute_property_metrics(prop)
        assert m["monthly_mortgage"] == pytest.approx(2_000.0)

    def test_multiple_loans(self):
        l1 = _make_loan(current_balance=200_000.0, monthly_payment=1_300.0)
        l2 = _make_loan(current_balance=100_000.0, monthly_payment=700.0)
        prop = _make_prop(market_value=500_000.0, loans=[l1, l2])
        m = compute_property_metrics(prop)
        assert m["total_loan_balance"] == pytest.approx(300_000.0)
        assert m["equity"] == pytest.approx(200_000.0)
        assert m["monthly_mortgage"] == pytest.approx(2_000.0)

    def test_zero_market_value_cap_rate(self):
        prop = _make_prop(market_value=0.0)
        m = compute_property_metrics(prop)
        assert m["cap_rate"] == 0


# ---------------------------------------------------------------------------
# _principal_from_1098
# ---------------------------------------------------------------------------

class TestPrincipalFrom1098:

    def test_direct_delta_two_adjacent_years(self):
        # Jan-1 2022 balance = 300 000, Jan-1 2023 balance = 293 000
        # Principal paid in 2022 = 7 000
        result = _principal_from_1098({2022: 300_000, 2023: 293_000}, 2022)
        assert result == pytest.approx(7_000.0)

    def test_forward_amortize_no_next_year(self):
        # Only current-year balance known — forward-amortize 12 months.
        loan = _make_loan(
            current_balance=300_000.0,
            interest_rate=6.0,
            monthly_payment=1_799.0,
        )
        result = _principal_from_1098({2023: 300_000}, 2023, loans=[loan])
        # Expected ~$3 600 principal in first year of 6% 30-yr mortgage
        assert result is not None
        assert 3_000 < result < 5_000

    def test_back_amortize_no_current_year(self):
        # Only next-year balance known — back-amortize to find current year.
        loan = _make_loan(
            current_balance=296_000.0,
            interest_rate=6.0,
            monthly_payment=1_799.0,
        )
        result = _principal_from_1098({2024: 296_000}, 2023, loans=[loan])
        assert result is not None
        assert result > 0

    def test_no_data_returns_none(self):
        result = _principal_from_1098({}, 2023)
        assert result is None

    def test_capped_implausible_delta(self):
        # If curr - nxt is unrealistically large (statement mid-year, not Jan-1),
        # the function should cap at the forward-amortized estimate.
        loan = _make_loan(
            current_balance=300_000.0,
            interest_rate=6.0,
            monthly_payment=1_799.0,
        )
        # Make nxt implausibly small — delta >> one year of amortization
        result = _principal_from_1098({2022: 300_000, 2023: 100_000}, 2022, loans=[loan])
        # Should NOT return 200 000 — that's many years of principal
        assert result < 20_000
