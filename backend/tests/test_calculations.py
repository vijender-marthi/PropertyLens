"""
Unit tests for pure calculation functions in routers/properties.py.

These tests do NOT touch the database — they construct lightweight
namespace objects to drive the functions directly.
"""
import pytest
from types import SimpleNamespace
from routers.properties import (
 build_summary_dto,
 compute_property_metrics,
 _build_executive_dashboard,
 _build_portfolio_report,
 _principal_from_1098,
    _principal_from_1098_segments,
    _scheduled_principal_cumulative,
    _statement_end_month_for_year,
    _dedup_balance,
)
from services.loan_calculator import payoff_analysis


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
        id=1,
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
        principal_due=0.0,
        interest_due=0.0,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_cash_flow_uses_pi_debt_service_and_operating_expense_escrow_items_once():
    prop = _make_prop(
        monthly_rent=3_200.0,
        property_tax=6_120.0,
        insurance=1_506.0,
        loans=[
            _make_loan(
                monthly_payment=3_014.25,
                escrow_amount=775.04,
                principal_due=0.0,
                interest_due=0.0,
            )
        ],
    )

    metrics = compute_property_metrics(prop)

    expected_monthly_pi = 3_014.25 - 775.04
    expected_operating_expenses = 6_120.0 + 1_506.0
    assert metrics["annual_debt_service"] == pytest.approx(expected_monthly_pi * 12)
    assert metrics["monthly_expenses"] * 12 == pytest.approx(expected_operating_expenses)
    assert metrics["monthly_cash_flow"] == pytest.approx(3_200.0 - expected_monthly_pi - (expected_operating_expenses / 12))


class TestComputePropertyMetrics:

    def test_effective_rent_uses_occupancy(self):
        prop = _make_prop(monthly_rent=4_000.0, occupancy_rate=90.0)
        m = compute_property_metrics(prop)
        assert m["effective_rent"] == pytest.approx(3_600.0)

    def test_summary_dto_uses_backend_summary_metrics_for_returns(self):
        prop = _make_prop(
            monthly_rent=3_200.0,
            market_value=700_000.0,
            property_tax=2_057.0,
            insurance=1_200.0,
            down_payment=0.0,
            closing_costs=0.0,
        )
        summary_metrics = {
            "noi": 35_143.0,
            "annual_debt_service": 68_813.0,
            "annual_cash_flow": -33_670.0,
            "monthly_cash_flow": -2_805.83,
            "monthly_cost_to_own": 5_734.42,
            "cap_rate": 5.02,
            "dscr": 0.51,
            "cash_on_cash_return": None,
            "total_return_ytd": -33_670.0,
        }

        dto = build_summary_dto(prop, summary_metrics)

        assert dto["source"] == "backend_engine"
        assert dto["metrics"]["monthlyCashFlow"]["display"] == "-$2,806"
        assert dto["metrics"]["annualCashFlow"]["display"] == "-$33,670"
        assert dto["metrics"]["noi"]["display"] == "$35,143"
        assert dto["metrics"]["capRate"]["display"] == "5.02%"
        assert dto["metrics"]["dscr"]["display"] == "0.51"
        assert dto["metrics"]["capRate"]["tone"] == "positive"
        assert dto["metrics"]["dscr"]["tone"] == "positive"
        assert dto["metrics"]["capRate"]["formula"] == "NOI ÷ market value"
        assert dto["metrics"]["capRate"]["computation"] == "$35,143 ÷ $700K"
        assert dto["metrics"]["capRate"]["result"] == "5.02%"
        assert dto["metrics"]["cashOnCashReturn"]["computation"] is None
        assert dto["metrics"]["cashOnCashReturn"]["result"] is None
        assert "downPayment" in dto["metrics"]["cashOnCashReturn"]["missingInputs"]
        assert dto["metrics"]["cashOnCashReturn"]["hint"] == "Enter down payment to calculate"
        for metric in dto["metrics"].values():
            assert metric.get("formula") != "Provided by " + "backend engine."
            assert metric.get("source") in {"CALCULATED", "DOCUMENT", "USER_INPUT", "ESTIMATED"}
        assert dto["signSanity"]["cap_rate_non_negative_when_noi_positive"] is True
        assert dto["signSanity"]["dscr_non_negative_when_noi_positive"] is True

    def test_summary_dto_canonical_monthly_cash_flow_display(self):
        prop = _make_prop(
         monthly_rent=3_200.0,
         market_value=700_000.0,
         property_tax=4_020.0,
         insurance=0.0,
         down_payment=0.0,
         closing_costs=0.0,
        )
        summary_metrics = {
         "annual_debt_service": 32_475.0,
         "monthly_cost_to_own": 3_041.25,
         "cash_on_cash_return": None,
         "total_return_ytd": 1_905.0,
        }

        dto = build_summary_dto(prop, summary_metrics)

        assert dto["raw"]["annual_cash_flow"] == pytest.approx(1_905.0)
        assert dto["raw"]["monthly_cash_flow"] == pytest.approx(158.75)
        assert dto["metrics"]["monthlyCashFlow"]["value"] == pytest.approx(158.75)
        assert dto["metrics"]["monthlyCashFlow"]["display"] == "$159"
        assert dto["metrics"]["monthlyCashFlow"]["result"] == "$159/mo"
        assert dto["metrics"]["annualCashFlow"]["display"] == "$1,905"

    def test_payoff_analysis_returns_single_consistent_result_object(self):
        analysis = payoff_analysis(
            principal=440_446.34,
            annual_rate=3.625,
            years=30,
            extra_monthly=500,
            base_monthly_payment=2_705.80,
        )

        assert analysis["monthly_payment"] == pytest.approx(3_205.80, abs=0.01)
        assert analysis["total_interest"] > 0
        assert analysis["payoff_time"]
        assert analysis["months_to_payoff"] > 0
        assert analysis["interest_saved"] == pytest.approx(
            analysis["base_total_interest"] - analysis["total_interest"],
            abs=0.01,
        )


class TestExecutiveDashboardAggregator:
    def _model(self):
        return {
            "properties": [
                {
                    "id": 1,
                    "name": "Syrah",
                    "monthly_rent": 3_000.0,
                    "effective_rent": 3_900.0,
                    "monthly_cash_flow": -2_090.0,
                    "monthly_mortgage": 2_700.0,
                    "annual_noi": 24_000.0,
                    "market_value": 700_000.0,
                    "total_loan_balance": 440_446.0,
                    "equity": 259_554.0,
                },
                {
                    "id": 2,
                    "name": "Electra",
                    "monthly_rent": 0.0,
                    "effective_rent": 0.0,
                    "monthly_cash_flow": 100.0,
                    "monthly_mortgage": 900.0,
                    "annual_noi": 12_000.0,
                    "market_value": 0.0,
                    "total_loan_balance": 125_000.0,
                    "equity": -125_000.0,
                },
            ],
            "primary_properties": [{"id": 3, "name": "Primary"}],
            "excluded_count": 1,
            "total_market_value": 700_000.0,
            "total_loan_balance": 565_446.0,
            "total_equity": 134_554.0,
            "total_monthly_rent": 3_900.0,
            "total_monthly_cash_flow": -1_990.0,
            "total_annual_noi": 36_000.0,
            "annual_debt_service": 43_200.0,
            "portfolio_dscr": 0.83,
            "weighted_avg_rate": 6.75,
            "primary_market_value": 800_000.0,
            "primary_equity": 350_000.0,
            "primary_loan_balance": 450_000.0,
            "primary_monthly_cost": 3_100.0,
            "total_appreciation_gain": 100_000.0,
            "total_principal_paid": 25_000.0,
        }

    def test_scope_invalid_occupancy_and_action_priority(self):
        dashboard = _build_executive_dashboard(self._model(), [], as_of_date="2026-07-10")

        assert dashboard["scope"]["includedRentalProperties"] == 2
        assert dashboard["scope"]["excludedProperties"] == 1
        occupancy = dashboard["dataQuality"]["checks"][0]
        assert occupancy["status"] == "data_issue"
        assert occupancy["display"] == "Unavailable"
        assert "incompatible periods" in occupancy["reason"]
        critical_actions = dashboard["attention"]["groups"][0]["actions"]
        assert critical_actions[0]["title"] == "Syrah is losing $2,090 per month"

    def test_ltv_equity_and_precision_are_backend_owned(self):
        dashboard = _build_executive_dashboard(self._model(), [], as_of_date="2026-07-10")
        electra = next(row for row in dashboard["propertyHealth"] if row["property"] == "Electra")

        assert electra["ltv"]["status"] == "data_issue"
        assert electra["ltv"]["display"] == "Unavailable"
        assert electra["equity"]["value"] == -125_000.0
        assert electra["equity"]["display"] == "-$125,000"
        assert dashboard["stories"][2]["metrics"][1]["display"] == "6.750%"

    def test_portfolio_report_contract_is_backend_owned(self):
        dashboard = _build_executive_dashboard(self._model(), [], as_of_date="2026-07-10")
        report = _build_portfolio_report(self._model(), dashboard, [], owner_name="Vijay")

        assert report["schemaVersion"] == "portfolio-report.v1"
        assert report["cover"]["preparedFor"] == "Vijay"
        assert report["executiveSummary"]["primaryMetric"]["key"] == "portfolioValue"
        assert [section["title"] for section in report["stories"]] == [
            "Cash Flow Story",
            "Wealth Creation Story",
            "Debt & Financing Story",
            "Tax Benefits Story",
        ]
        assert report["appendix"]["tables"][0]["id"] == "property-performance"

    def test_portfolio_report_preserves_backend_action_priority(self):
        dashboard = _build_executive_dashboard(self._model(), [], as_of_date="2026-07-10")
        report = _build_portfolio_report(self._model(), dashboard, [], owner_name="Vijay")

        assert report["recommendedNextSteps"][0]["issue"] == dashboard["attention"]["groups"][0]["actions"][0]["title"]
        assert report["recommendedNextSteps"][0]["financialImpact"] == dashboard["attention"]["groups"][0]["actions"][0]["financialImpact"]
        assert report["risks"][0]["recommendation"]

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

    def test_escrow_not_counted_as_parallel_operating_expense(self):
        loan = _make_loan(monthly_payment=4_274.51, escrow_amount=1_913.46)
        prop = _make_prop(
            monthly_rent=3_200.0,
            property_tax=0.0,
            insurance=0.0,
            loans=[loan],
        )
        m = compute_property_metrics(prop)
        assert m["monthly_mortgage"] == pytest.approx(2_361.05)
        assert m["tax_ins_monthly"] == pytest.approx(0.0)
        assert m["monthly_expenses"] == pytest.approx(0.0)
        assert m["monthly_cash_flow"] == pytest.approx(838.95)

    def test_property_tax_is_prorated_monthly_into_expenses(self):
        prop = _make_prop(
            monthly_rent=3_000.0,
            property_tax=12_000.0,
            insurance=0.0,
            loans=[],
        )
        m = compute_property_metrics(prop)
        assert m["property_tax_monthly"] == pytest.approx(1_000.0)
        assert m["monthly_expenses"] == pytest.approx(1_000.0)
        assert m["monthly_cash_flow"] == pytest.approx(2_000.0)

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

    def test_back_amortize_negative_estimate_returns_none(self):
        loan = _make_loan(
            current_balance=466_681.81,
            interest_rate=6.5,
            monthly_payment=1_000.0,
        )

        result = _principal_from_1098({2024: 466_681.81}, 2023, loans=[loan])

        assert result is None

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


class TestDedupBalance:
    def test_single_loan_duplicate_balances_are_not_summed(self):
        loan = _make_loan(current_balance=465_055.0)
        result = _dedup_balance(
            [
                ("ACCT-001", 465_055.0),
                ("ACCT-001-COPY", 465_055.0),
            ],
            loans=[loan],
        )

        assert result == pytest.approx(465_055.0)

    def test_multiple_loans_can_sum_distinct_account_balances(self):
        loans = [
            _make_loan(current_balance=300_000.0),
            _make_loan(current_balance=165_055.0),
        ]
        result = _dedup_balance(
            [
                ("ACCT-001", 300_000.0),
                ("ACCT-002", 165_055.0),
            ],
            loans=loans,
        )

        assert result == pytest.approx(465_055.0)

    def test_refinance_balances_use_latest_loan_not_sum(self):
        result = _dedup_balance(
            [
                {
                    "account": "OLD-LOAN",
                    "balance": 455_000.0,
                    "origination_date": "01/15/2020",
                    "mortgage_acquisition_date": "01/15/2020",
                },
                {
                    "account": "NEW-LOAN",
                    "balance": 475_110.0,
                    "origination_date": "08/20/2024",
                    "mortgage_acquisition_date": "08/20/2024",
                },
            ],
            loans=[_make_loan(current_balance=475_110.0)],
        )

        assert result == pytest.approx(475_110.0)


class TestSegmented1098Principal:
    def test_prior_year_uses_next_year_first_segment_not_latest_transfer_balance(self):
        balance_by_year = {
            2023: 468_750.00,
            2024: 463_428.32,
        }
        balance_logic_by_year = {
            2024: {
                "mode": "latest_loan_balance",
                "entries": [
                    {
                        "account": "64944077",
                        "balance": 466_681.81,
                        "origination_date": "05/26/2023",
                    },
                    {
                        "account": "3550379001",
                        "balance": 463_428.32,
                        "origination_date": "05/26/2023",
                    },
                ]
            }
        }

        result = _principal_from_1098_segments(
            balance_by_year,
            balance_logic_by_year,
            2023,
        )

        assert result == pytest.approx(2_068.19)

    def test_osprey_2024_servicer_transfer_principal_uses_both_segments(self):
        balance_by_year = {
            2024: 463_428.32,  # latest active 2024 balance: Rocket
            2025: 462_201.95,
        }
        balance_logic_by_year = {
            2024: {
                "entries": [
                    {
                        "account": "64944077",
                        "balance": 466_681.81,
                        "origination_date": "05/26/2023",
                    },
                    {
                        "account": "3550379001",
                        "balance": 463_428.32,
                        "origination_date": "05/26/2023",
                    },
                ]
            }
        }

        result = _principal_from_1098_segments(
            balance_by_year,
            balance_logic_by_year,
            2024,
        )

        # LoanCare segment: 466,681.81 - 463,428.32 = 3,253.49
        # Rocket segment: 463,428.32 - 462,201.95 = 1,226.37
        assert result == pytest.approx(4_479.86)

    def test_direct_1098_delta_not_zero_when_payment_fields_missing(self):
        result = _principal_from_1098(
            {2024: 463_428.32, 2025: 462_201.95},
            2024,
            loans=[_make_loan(monthly_payment=0.0, interest_rate=6.5)],
        )

        assert result == pytest.approx(1_226.37)

    def test_current_year_uses_latest_statement_when_next_1098_missing(self):
        balance_by_year = {
            2026: 457_576.25,
        }
        balance_logic_by_year = {
            2026: {
                "entries": [
                    {
                        "account": "3550379001",
                        "balance": 457_576.25,
                        "origination_date": "05/26/2023",
                    },
                ]
            }
        }

        result = _principal_from_1098_segments(
            balance_by_year,
            balance_logic_by_year,
            2026,
            statement_balance_by_year={2026: 438_502.37},
        )

        assert result == pytest.approx(19_073.88)


class TestPrincipalTopup:
    def test_statement_end_month_accepts_stored_iso_dates(self):
        snapshots = [{"year": 2026, "date": "2026-06-11", "balance": 438_502.37}]

        assert _statement_end_month_for_year(snapshots, 2026) == 6

    def test_osprey_expected_principal_and_topup_use_amortization_schedule(self):
        loan = _make_loan(
            original_amount=468_750.0,
            monthly_payment=4_274.51,
            escrow_amount=1_913.46,
            principal_due=531.46,
            interest_due=2_786.32,
            interest_rate=7.625,
            loan_term_years=30,
            origination_date="05/26/2023",
        )

        expected_cumulative = _scheduled_principal_cumulative(loan, 2026, 6)
        actual_cumulative = 30_247.63

        assert expected_cumulative == pytest.approx(13_674.91, abs=0.02)
        assert round(actual_cumulative - expected_cumulative, 2) == pytest.approx(16_572.72, abs=0.02)

    def test_syrah_expected_principal_schedule_excludes_topup(self):
        loan = _make_loan(
            original_amount=1_384_000.0,
            monthly_payment=5_742.11,
            escrow_amount=0.0,
            interest_rate=2.875,
            loan_term_years=30,
            origination_date="09/01/2021",
        )

        assert _scheduled_principal_cumulative(loan, 2021) == pytest.approx(4_858.37, abs=0.02)
        assert _scheduled_principal_cumulative(loan, 2022) == pytest.approx(34_501.98, abs=0.05)
        assert _scheduled_principal_cumulative(loan, 2025) == pytest.approx(128_715.63, abs=0.15)
        assert _scheduled_principal_cumulative(loan, 2026, 6) == pytest.approx(145_222.18, abs=0.15)

    def test_syrah_cumulative_topup_is_actual_minus_expected(self):
        actual_cumulative = 161_392.25
        expected_cumulative = 145_222.18

        assert round(actual_cumulative - expected_cumulative, 2) == pytest.approx(16_170.07)
