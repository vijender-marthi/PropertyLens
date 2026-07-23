from services.portfolio_analysis import build_portfolio_analysis
from tests.conftest import auth_headers
import models


def _property(prop_id=1, *, usage_type="Rental"):
    return {
        "id": prop_id,
        "name": f"Property {prop_id}",
        "address": f"{prop_id} Main St",
        "city": "Lathrop",
        "state": "CA",
        "usage_type": usage_type,
        "market_value": 625000,
        "purchase_price": 500000,
        "down_payment": 100000,
        "closing_costs": 10000,
        "monthly_rent": 3500,
        "effective_rent": 3200,
        "monthly_expenses": 700,
        "monthly_mortgage": 1800,
        "monthly_cash_flow": 700,
        "annual_noi": 30000,
        "property_tax_annual": 9000,
        "insurance_monthly": 150,
        "total_loan_balance": 390000,
        "equity": 235000,
    }


def _debt(status="OPEN"):
    return {
        "yearlyPrincipalInterestRows": [{
            "rowKey": "10-2025-actual",
            "loanId": 10,
            "lenderName": "Primary mortgage",
            "year": 2025,
            "yearLabel": "2025",
            "startingBalance": 393200,
            "principalPaid": 3200,
            "scheduledPrincipal": 3000,
            "topUp": 200,
            "interestPaid": 6400,
            "endingBalance": 390000,
            "sourceLabel": "1098",
        }],
        "paymentHistoryRows": [{
            "rowKey": "snapshot-1",
            "loanId": 10,
            "lenderName": "Primary mortgage",
            "statementDate": "2025-06-15",
            "payment": 1800,
            "principalYtd": 3200,
            "interestYtd": 6400,
            "balance": 390000,
            "documentId": 99,
            "sourceLabel": "Mortgage Statement — Jun 2025",
            "sourceType": "Mortgage statement",
        }],
        "loans": [{
            "loan_id": 10,
            "name": "Primary mortgage",
            "status": status,
            "originalAmount": 400000,
            "currentBalance": 390000,
            "interest_rate": 4.0,
            "payment": {"monthlyPI": 1800},
            "current_year_ytd": {"principal": 3200, "interest": 6400},
            "accumulated_interest": 20000,
            "paydown": {"rows": [{
                "year": 2025,
                "endingBalance": 390000,
                "principalPaid": 3200,
                "interestPaid": 6400,
                "sourceLabel": "1098",
            }]},
        }],
    }


def _analysis(debt=None):
    return build_portfolio_analysis(
        properties=[_property()],
        debts={1: debt or _debt()},
        schedules={1: {"history": [{
            "year": 2025,
            "rentalIncome": {"value": 38400},
            "operatingExpenses": {"value": 8400},
            "mortgageInterest": {"value": 12000},
            "depreciation": {"value": 15000},
            "propertyTax": {"value": 9000},
            "totalExpenses": {"value": 44400},
            "netScheduleE": {"value": -6000},
            "sourceLabel": "Schedule E",
        }] }},
        yearly_trends=[{
            "year": 2025,
            "year_label": "2025",
            "rental_income": 38400,
            "operating_expenses": 8400,
            "net_operating_income": 30000,
            "status": "REPORTED",
        }],
        selected_year=2025,
        filter_context={"loanStatus": "Active", "selectedPropertyIds": [1]},
        as_of_date="2026-07-18",
    )


def test_portfolio_contract_reconciles_shared_financial_definitions():
    result = _analysis()

    assert result["schemaVersion"] == "portfolio-analysis.v1"
    assert result["incomeExpenses"]["kpis"]["noi"]["value"] == 2500.0
    assert result["incomeExpenses"]["kpis"]["cashFlow"]["value"] == 700.0
    assert result["analytics"]["cashFlowWaterfall"]["finalValue"] == 700.0
    assert result["reconciliation"]["loanBalance"] == 390000.0
    assert result["reconciliation"]["analyticsLoanBalance"] == 390000.0
    assert all(result["reconciliation"]["assertions"].values())
    assert result["loans"]["amortizationRows"] == [{
        "rowKey": "10-2025-actual",
        "loanId": 10,
        "lenderName": "Primary mortgage",
        "year": 2025,
        "yearLabel": "2025",
        "startingBalance": 393200,
        "principalPaid": 3200,
        "scheduledPrincipal": 3000,
        "topUp": 200,
        "interestPaid": 6400,
        "endingBalance": 390000,
        "sourceLabel": "1098",
        "propertyId": 1,
        "propertyName": "Property 1",
        "address": "1 Main St, Lathrop, CA",
    }]
    assert result["loans"]["paymentHistoryRows"] == [{
        "rowKey": "snapshot-1",
        "loanId": 10,
        "lenderName": "Primary mortgage",
        "statementDate": "2025-06-15",
        "payment": 1800,
        "principalYtd": 3200,
        "interestYtd": 6400,
        "balance": 390000,
        "documentId": 99,
        "sourceLabel": "Mortgage Statement — Jun 2025",
        "sourceType": "Mortgage statement",
        "propertyId": 1,
        "propertyName": "Property 1",
        "address": "1 Main St, Lathrop, CA",
    }]


def test_dashboard_presentation_reconciles_kpis_waterfall_and_capital_structure():
    result = _analysis()
    analytics = result["analytics"]
    dashboard = analytics["dashboard"]

    assert [item["metricKey"] for item in dashboard["topMetrics"]] == [
        "portfolioValue",
        "totalEquity",
        "monthlyCashFlow",
        "cashOnCash",
        "annualNoi",
        "dscr",
    ]
    assert [step["key"] for step in dashboard["cashFlowWaterfall"]["steps"]] == [
        "grossIncome",
        "vacancyLoss",
        "operatingExpenses",
        "noi",
        "debtService",
        "netCashFlow",
    ]
    assert dashboard["cashFlowWaterfall"]["finalValue"] == analytics["kpis"]["monthlyCashFlow"]["value"]
    assert sum(item["value"] for item in dashboard["capitalStructure"]["segments"]) == analytics["kpis"]["portfolioValue"]["value"]
    assert dashboard["expenseBreakdown"]["total"] == result["incomeExpenses"]["kpis"]["operatingExpenses"]["value"] * 12
    assert all(dashboard["assertions"].values())


def test_dashboard_bottom_metrics_include_backend_calculation_inputs():
    result = _analysis()
    analytics = result["analytics"]
    metrics = {
        **analytics["dashboardMetrics"],
        **analytics["kpis"],
        **result["incomeExpenses"]["kpis"],
    }

    for key in ("propertyCount", "occupancy", "income", "averageMonthlyExpense", "noi", "ytdCashFlow"):
        assert metrics[key]["formula"]
        assert metrics[key]["inputs"]
        assert all("value" in item and "unit" in item for item in metrics[key]["inputs"])


def test_dashboard_property_ranking_and_trend_are_backend_ordered():
    second = _property(2)
    second["monthly_cash_flow"] = -200
    second["down_payment"] = 125000
    result = build_portfolio_analysis(
        properties=[_property(), second],
        debts={1: _debt(), 2: _debt()},
        schedules={},
        yearly_trends=[
            {"year": 2025, "rental_income": 76000, "operating_expenses": 18000, "status": "REPORTED"},
            {"year": 2024, "rental_income": 70000, "operating_expenses": 17000, "status": "REPORTED"},
        ],
        selected_year=2025,
        filter_context={"loanStatus": "Active", "selectedPropertyIds": [1, 2]},
        as_of_date="2026-07-18",
    )
    dashboard = result["analytics"]["dashboard"]

    assert dashboard["propertyPerformance"]["rows"][0]["id"] == 1
    assert [row["period"] for row in dashboard["cashFlowTrend"]["series"]] == ["2024", "2025"]
    assert dashboard["assertions"]["propertyPerformanceIsBackendRanked"] is True
    assert dashboard["assertions"]["trendIsChronological"] is True


def test_dashboard_empty_scope_has_alert_and_metric_empty_states():
    result = build_portfolio_analysis(
        properties=[],
        debts={},
        schedules={},
        yearly_trends=[],
        selected_year=2025,
        filter_context={"loanStatus": "Active", "selectedPropertyIds": []},
        as_of_date="2026-07-18",
    )
    dashboard = result["analytics"]["dashboard"]

    assert dashboard["alerts"]["items"] == []
    assert dashboard["propertyPerformance"]["rows"] == []
    assert dashboard["expenseBreakdown"]["items"] == []
    assert result["analytics"]["kpis"]["cashOnCash"]["status"] == "UNAVAILABLE"


def test_closed_loans_do_not_count_as_current_debt_or_create_now_projection():
    result = _analysis(_debt(status="CLOSED"))

    assert result["loans"]["kpis"]["totalBalance"]["value"] == 0.0
    assert result["loans"]["balanceSeries"] == []
    assert result["loans"]["amortizationRows"] == []
    assert result["loans"]["paymentHistoryRows"] == []
    assert result["analytics"]["kpis"]["totalDebt"]["value"] == 0.0


def test_unavailable_history_and_dti_are_not_fabricated():
    result = _analysis()

    assert result["loans"]["kpis"]["averageDti"]["value"] is None
    assert result["loans"]["kpis"]["averageDti"]["status"] == "UNAVAILABLE"
    assert result["analytics"]["occupancySeries"] == []
    assert result["analytics"]["equitySeries"] == [{
        "period": "2026-07-18",
        "marketValue": 625000.0,
        "loanBalance": 390000.0,
        "equity": 235000.0,
        "status": "CURRENT_SNAPSHOT",
    }]


def test_forecast_is_backend_calculated_from_current_rental_run_rate():
    forecast = _analysis()["analytics"]["forecast"]

    assert forecast["status"] == "PROJECTED"
    assert forecast["baseYear"] == 2026
    assert forecast["horizonYears"] == 5
    assert forecast["rentalPropertyCount"] == 1
    assert forecast["series"][0] == {
        "year": 2026,
        "period": "2026",
        "rentalIncome": 38400.0,
        "operatingExpenses": 8400.0,
        "noi": 30000.0,
        "debtService": 21600.0,
        "cashFlow": 8400.0,
        "status": "BASELINE_RUN_RATE",
    }
    assert forecast["series"][1]["rentalIncome"] == 39552.0
    assert forecast["series"][1]["operatingExpenses"] == 8652.0
    assert forecast["series"][1]["cashFlow"] == 9300.0
    assert forecast["kpis"]["cumulativeCashFlow"]["value"] == sum(
        row["cashFlow"] for row in forecast["series"][1:]
    )
    assert forecast["methodology"]["confidence"] == "MEDIUM"


def test_forecast_is_unavailable_without_rental_income():
    primary = _property(usage_type="Primary")
    result = build_portfolio_analysis(
        properties=[primary],
        debts={primary["id"]: _debt()},
        schedules={},
        yearly_trends=[],
        selected_year=2025,
        filter_context={"loanStatus": "Active", "selectedPropertyIds": [primary["id"]]},
        as_of_date="2026-07-18",
    )

    assert result["analytics"]["forecast"]["status"] == "UNAVAILABLE"
    assert result["analytics"]["forecast"]["series"] == []


def test_tax_category_percentages_are_backend_owned_and_reconcile():
    tax = _analysis()["taxCenter"]

    assert tax["assertions"]["categoryTotalEqualsDeductions"] is True
    assert round(sum(row["percentage"] for row in tax["categories"]), 2) == 100.0
    assert tax["rows"][0]["taxableIncome"] == -6000.0


def test_portfolio_endpoint_applies_primary_residence_filter(client, db, user, prop):
    prop.usage_type = "Rental"
    primary = models.Property(
        owner_id=user.id,
        name="Primary Home",
        address="2 Home St",
        usage_type="Primary",
        market_value=700000,
    )
    db.add(primary)
    db.commit()

    response = client.get(
        "/api/properties/analysis/portfolio?include_primary_residence=false",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["filterContext"]["selectedPropertyIds"] == [prop.id]
    assert {row["id"] for row in payload["filterContext"]["availableProperties"]} == {prop.id, primary.id}


def test_portfolio_endpoint_honors_explicit_empty_selection(client, user, prop):
    response = client.get(
        "/api/properties/analysis/portfolio?selection_explicit=true&selected_property_ids=",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["filterContext"]["selectedPropertyIds"] == []
    assert payload["analytics"]["kpis"]["portfolioValue"]["value"] == 0.0
    assert payload["loans"]["rows"] == []
