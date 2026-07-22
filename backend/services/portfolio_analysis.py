"""Canonical portfolio analysis DTOs shared by portfolio-facing pages.

This module is deliberately framework-free.  Routes resolve persisted source
records into normalized property, debt, tax, and annual-flow dictionaries; the
functions below perform Decimal-safe aggregation and return display-ready chart
contracts.  React components must not reconstruct these calculations.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional

from services.formatters import format_currency, format_metric_currency


MONEY = Decimal("0.01")
RATE = Decimal("0.0001")
CLOSED_STATUSES = {"CLOSED", "REFINANCED", "PAID_OFF"}


def _compact_money(value: float, *, signed: bool = False) -> str:
    display = format_metric_currency(value)
    if signed and value > 0:
        return f"+{display}"
    return display


def _months_display(value: int) -> str:
    n = int(value or 0)
    return f"{n} month" if n == 1 else f"{n} months"


def _story_node(key: str, label: str, value: float, start: float, end: float, tone: str, *, total: bool = False, signed: bool = True) -> Dict[str, Any]:
    """A single waterfall node in the Home Summary "value buildup" format."""
    return {
        "id": key,
        "key": key,
        "label": label,
        "value": value,
        "display": _compact_money(value, signed=signed and not total),
        "fullDisplay": format_currency(value),
        "startValue": start,
        "endValue": end,
        "start": start,
        "end": end,
        "isTotal": total,
        "total": total,
        "semanticType": tone,
        "tone": tone,
        "tooltip": {
            "label": label,
            "amount": format_currency(value),
            "cumulativeValue": format_currency(end),
            "role": "Total portfolio value" if total else "Bridge component",
        },
    }


def _portfolio_value_buildup_story(*, purchase_price, down_payment, current_debt, current_market_value, appreciation, as_of) -> Dict[str, Any]:
    """Portfolio-wide "Value Buildup Over Time" waterfall (market-value story).

    Same node/annotation shape as the primary Home Summary chart so the two
    render identically. Reconciles by construction:
      down payment + principal reduction + remaining debt = purchase price
      purchase price + appreciation                       = market value
    """
    pp = float(purchase_price or 0)
    dp = float(down_payment or 0)
    debt = float(current_debt or 0)
    mv = float(current_market_value or 0)
    appr = float(appreciation or 0)
    acquisition_debt = max(pp - dp, 0.0)
    principal_reduction = acquisition_debt - debt

    if pp <= 0 or mv <= 0:
        return {
            "status": "unavailable",
            "title": "Value Buildup Over Time",
            "subtitle": "How your portfolio value has grown",
            "series": [],
            "annotations": [],
            "unavailableReason": "Add purchase prices and current market values to see how portfolio value was built.",
        }

    cumulative = 0.0
    series = []
    for key, label, value, tone in [
        ("acquisitionCashContribution", "Down payment", dp, "acquisition_cash"),
        ("principalReductionSinceAcquisition", "Principal reduction", principal_reduction, "principal_reduction"),
        ("currentPropertyDebt", "Remaining secured debt", debt, "remaining_secured_debt"),
        ("appreciation", "Appreciation", appr, "appreciation"),
    ]:
        start = cumulative
        end = cumulative + value
        series.append(_story_node(key, label, value, start, end, tone, signed=key != "acquisitionCashContribution"))
        cumulative = end
    series.append(_story_node("currentMarketValue", "Current market value", mv, 0.0, mv, "total", total=True, signed=False))
    return {
        "status": "available",
        "title": "Value Buildup Over Time",
        "subtitle": "How your portfolio value has grown",
        "screenReaderSummary": f"Current portfolio market value is {format_currency(mv)}. It consists of a {format_currency(dp)} down payment, {format_currency(principal_reduction)} principal reduction, {format_currency(debt)} remaining secured debt, and {format_currency(appr)} appreciation.",
        "series": series,
        "annotations": [
            {"startBarId": "acquisitionCashContribution", "endBarId": "currentPropertyDebt", "label": f"Purchase price · {format_metric_currency(pp)}", "semanticType": "acquisition"},
            {"startBarId": "appreciation", "endBarId": "appreciation", "label": f"Gain {_compact_money(appr, signed=True)}", "semanticType": "appreciation"},
        ],
        "period": as_of,
    }


def _d(value: Any) -> Decimal:
    if value in (None, "", "—"):
        return Decimal("0")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _money(value: Any) -> float:
    return float(_d(value).quantize(MONEY, rounding=ROUND_HALF_UP))


def _rate(value: Any) -> float:
    return float(_d(value).quantize(RATE, rounding=ROUND_HALF_UP))


def _metric(
    key: str,
    label: str,
    value: Optional[Any],
    *,
    unit: str = "currency",
    formula: str,
    inputs: Optional[List[Dict[str, Any]]] = None,
    included: Optional[List[str]] = None,
    excluded: Optional[List[str]] = None,
    status: str = "CALCULATED",
    period: Optional[str] = None,
    source: str = "Persisted property records",
) -> Dict[str, Any]:
    numeric = None if value is None else (_rate(value) if unit in {"percent", "rate", "ratio"} else _money(value))
    return {
        "key": key,
        "label": label,
        "value": numeric,
        "unit": unit,
        "status": status,
        "formula": formula,
        "inputs": inputs or [],
        "included": included or [],
        "excluded": excluded or [],
        "period": period,
        "source": source,
        "lastCalculatedAt": datetime.utcnow().isoformat() + "Z",
    }


def _metric_value(row: Optional[Dict[str, Any]], key: str) -> Decimal:
    if not row:
        return Decimal("0")
    value = row.get(key)
    if isinstance(value, dict):
        value = value.get("value")
    return _d(value)


def _active(loan: Dict[str, Any]) -> bool:
    return str(loan.get("status") or "OPEN").upper() not in CLOSED_STATUSES


def _loan_row(property_row: Dict[str, Any], loan: Dict[str, Any]) -> Dict[str, Any]:
    payment = loan.get("payment") or {}
    current_ytd = loan.get("current_year_ytd") or {}
    balance = _d(loan.get("currentBalance", loan.get("current_balance")))
    original = _d(loan.get("originalAmount", loan.get("original_amount")))
    principal = _d(loan.get("principal_paid"))
    if not principal and original and balance:
        principal = max(original - balance, Decimal("0"))
    return {
        "id": f"{property_row.get('id')}-{loan.get('loan_id') or loan.get('id') or loan.get('logicalLoanId')}",
        "propertyId": property_row.get("id"),
        "propertyName": property_row.get("name") or property_row.get("address") or f"Property {property_row.get('id')}",
        "address": ", ".join(str(item) for item in (property_row.get("address"), property_row.get("city"), property_row.get("state")) if item),
        "loanId": loan.get("loan_id") or loan.get("id"),
        "lender": loan.get("lender_name") or loan.get("name") or "Loan",
        "account": loan.get("account_number"),
        "loanType": loan.get("loan_type") or loan.get("loan_product") or "Loan",
        "balance": _money(balance),
        "original": _money(original),
        "rate": _rate(loan.get("interest_rate")),
        "monthlyPI": _money(payment.get("monthlyPI", loan.get("monthly_payment"))),
        "principalPaid": _money(principal),
        "paidPercent": _rate((principal / original * 100) if original else 0),
        "principalYtd": _money(current_ytd.get("principal")),
        "interestYtd": _money(current_ytd.get("interest")),
        "interestToDate": _money(loan.get("accumulated_interest")),
        "nextPayment": loan.get("payment_due_date") or loan.get("statement_date") or loan.get("maturityDateDisplay"),
        "status": "Active" if _active(loan) else "Closed",
        "source": loan.get("source") or "Loan record",
        "sourceStatus": loan.get("estimated_vs_reported") or "reported",
        "servicerSegments": loan.get("servicerSegments") or [],
        "paydownRows": (loan.get("paydown") or {}).get("rows") or [],
    }


def _loan_analysis(
    properties: List[Dict[str, Any]],
    debts: Dict[int, Dict[str, Any]],
    as_of: str,
    *,
    loan_status: str = "Active",
) -> Dict[str, Any]:
    rows = [
        _loan_row(prop, loan)
        for prop in properties
        for loan in ((debts.get(prop.get("id")) or {}).get("loans") or [])
    ]
    active = [row for row in rows if row["status"] == "Active"]
    total_balance = sum((_d(row["balance"]) for row in active), Decimal("0"))
    total_payment = sum((_d(row["monthlyPI"]) for row in active), Decimal("0"))
    principal_ytd = sum((_d(row["principalYtd"]) for row in active), Decimal("0"))
    interest_ytd = sum((_d(row["interestYtd"]) for row in active), Decimal("0"))
    interest_to_date = sum((_d(row["interestToDate"]) for row in active), Decimal("0"))
    weighted_rate = (
        sum((_d(row["balance"]) * _d(row["rate"]) for row in active), Decimal("0")) / total_balance
        if total_balance else None
    )

    snapshots: Dict[int, Decimal] = defaultdict(Decimal)
    snapshot_sources: Dict[int, set] = defaultdict(set)
    for row in active:
        for period in row["paydownRows"]:
            if period.get("isFullYearProjection"):
                continue
            year = period.get("year")
            ending = period.get("endingBalance")
            if year is None or ending is None:
                continue
            snapshots[int(year)] += _d(ending)
            snapshot_sources[int(year)].add(str(period.get("sourceLabel") or period.get("source") or "Loan schedule"))
    balance_series = [
        {"period": str(year), "value": _money(value), "status": "REPORTED", "sources": sorted(snapshot_sources[year])}
        for year, value in sorted(snapshots.items())
    ]
    if not balance_series and total_balance:
        balance_series = [{"period": as_of[:4], "value": _money(total_balance), "status": "CURRENT", "sources": ["Current loan balance"]}]

    mix: Dict[str, Decimal] = defaultdict(Decimal)
    for row in active:
        mix[row["loanType"]] += _d(row["balance"])

    normalized_status = str(loan_status or "Active").strip().lower()
    display_rows = rows if normalized_status == "all" else [
        row for row in rows if row["status"].lower() == normalized_status
    ]
    displayed_loan_ids = {
        (row["propertyId"], row["loanId"])
        for row in display_rows
    }
    amortization_rows = []
    for prop in properties:
        property_id = prop.get("id")
        debt = debts.get(property_id) or {}
        for schedule_row in debt.get("yearlyPrincipalInterestRows") or []:
            loan_id = schedule_row.get("loanId")
            if (property_id, loan_id) not in displayed_loan_ids:
                continue
            amortization_rows.append({
                **schedule_row,
                "propertyId": property_id,
                "propertyName": prop.get("name") or prop.get("address") or f"Property {property_id}",
                "address": ", ".join(str(item) for item in (prop.get("address"), prop.get("city"), prop.get("state")) if item),
            })
    amortization_rows.sort(key=lambda row: (
        str(row.get("propertyName") or ""),
        int(row.get("year") or 0),
        bool(row.get("isFullYearProjection")),
    ))
    payment_history_rows = []
    for prop in properties:
        property_id = prop.get("id")
        debt = debts.get(property_id) or {}
        for payment_row in debt.get("paymentHistoryRows") or []:
            loan_id = payment_row.get("loanId")
            if (property_id, loan_id) not in displayed_loan_ids:
                continue
            payment_history_rows.append({
                **payment_row,
                "propertyId": property_id,
                "propertyName": prop.get("name") or prop.get("address") or f"Property {property_id}",
                "address": ", ".join(str(item) for item in (prop.get("address"), prop.get("city"), prop.get("state")) if item),
            })
    payment_history_rows.sort(key=lambda row: (
        str(row.get("statementDate") or ""),
        str(row.get("propertyName") or ""),
    ), reverse=True)
    return {
        "rows": display_rows,
        "allRows": rows,
        "amortizationRows": amortization_rows,
        "paymentHistoryRows": payment_history_rows,
        "kpis": {
            "totalBalance": _metric("totalBalance", "Total Loan Balance", total_balance, formula="Sum of current balances for active logical loans", inputs=[{"label": "Active loans", "value": len(active)}], excluded=["Closed, paid-off, refinanced, and superseded loans"], period=as_of),
            "monthlyPI": _metric("monthlyPI", "Total Monthly P&I", total_payment, formula="Sum of principal-and-interest payments for active logical loans", excluded=["Escrow, taxes, insurance, HOA"], period=as_of),
            "weightedRate": _metric("weightedRate", "Weighted Average Interest Rate", weighted_rate, unit="rate", formula="Σ(current balance × note rate) ÷ Σ(current balance)", period=as_of),
            "principalYtd": _metric("principalYtd", "Principal Paid YTD", principal_ytd, formula="Sum of current-year principal across active logical-loan paydown rows", period=as_of[:4]),
            "interestYtd": _metric("interestYtd", "Interest Paid YTD", interest_ytd, formula="Sum of current-year interest across active logical-loan paydown rows", period=as_of[:4]),
            "interestToDate": _metric("interestToDate", "Interest Paid to Date", interest_to_date, formula="Sum of reported and projected interest across active logical-loan paydown rows", period=as_of),
            "loanCount": _metric("loanCount", "Active Loans", len(active), unit="count", formula="Count of active logical loans", period=as_of),
            "averageDti": _metric("averageDti", "Average DTI", None, unit="ratio", formula="Monthly debt obligations ÷ verified gross monthly income", status="UNAVAILABLE", source="Gross borrower income is not stored"),
        },
        "balanceSeries": balance_series,
        "debtMix": [
            {
                "key": key,
                "label": key,
                "value": _money(value),
                "percentage": _rate(value / total_balance * 100) if total_balance else 0,
            }
            for key, value in sorted(mix.items()) if value > 0
        ],
        "assertions": {
            "totalBalanceEqualsRows": abs(_money(total_balance) - sum(row["balance"] for row in active)) <= 0.01,
            "weightedRateUsesActiveBalance": weighted_rate is None or total_balance > 0,
        },
    }


def _selected_schedule_row(schedule: Dict[str, Any], year: int) -> Optional[Dict[str, Any]]:
    history = schedule.get("history") or []
    return next((row for row in history if row.get("year") == year and row.get("kind") != "total"), None)


def _tax_analysis(properties: List[Dict[str, Any]], schedules: Dict[int, Dict[str, Any]], selected_year: int) -> Dict[str, Any]:
    rows = []
    available_years = set()
    for prop in properties:
        if str(prop.get("usage_type") or "Rental").lower() == "primary":
            continue
        schedule = schedules.get(prop.get("id")) or {}
        available_years.update(int(row["year"]) for row in schedule.get("history") or [] if row.get("year") and int(row["year"]) < 9999)
        selected = _selected_schedule_row(schedule, selected_year)
        total_expenses = _metric_value(selected, "totalExpenses")
        interest = _metric_value(selected, "mortgageInterest")
        depreciation = _metric_value(selected, "depreciation")
        property_tax = _metric_value(selected, "propertyTax")
        operating = _metric_value(selected, "operatingExpenses")
        if not operating and total_expenses:
            operating = max(total_expenses - interest - depreciation - property_tax, Decimal("0"))
        deductions = total_expenses if total_expenses else operating + interest + depreciation + property_tax
        rows.append({
            "propertyId": prop.get("id"),
            "propertyName": prop.get("name") or prop.get("address") or f"Property {prop.get('id')}",
            "location": ", ".join(str(item) for item in (prop.get("city"), prop.get("state")) if item),
            "rentalIncome": _money(_metric_value(selected, "rentalIncome")),
            "operatingExpenses": _money(operating),
            "mortgageInterest": _money(interest),
            "depreciation": _money(depreciation),
            "propertyTax": _money(property_tax),
            "totalDeductions": _money(deductions),
            "taxableIncome": _money(_metric_value(selected, "netScheduleE")),
            "sourceLabel": (selected or {}).get("sourceLabel") or "No source data",
            "status": "REPORTED" if selected else "UNAVAILABLE",
        })

    def total(key: str) -> Decimal:
        return sum((_d(row[key]) for row in rows), Decimal("0"))

    effective_rate = Decimal("18.7")
    totals = {key: _money(total(key)) for key in ("rentalIncome", "operatingExpenses", "mortgageInterest", "depreciation", "propertyTax", "totalDeductions", "taxableIncome")}
    totals["estimatedLiability"] = _money(max(total("taxableIncome"), Decimal("0")) * effective_rate / 100)
    totals["estimatedSavings"] = _money(max(total("totalDeductions"), Decimal("0")) * effective_rate / 100)
    categories = [
        {
            "key": key,
            "label": label,
            "value": totals[key],
            "percentage": _rate(_d(totals[key]) / _d(totals["totalDeductions"]) * 100) if totals["totalDeductions"] else 0,
        }
        for key, label in (
            ("depreciation", "Depreciation"),
            ("mortgageInterest", "Mortgage Interest"),
            ("propertyTax", "Property Taxes"),
            ("operatingExpenses", "Other Operating Expenses"),
        ) if totals[key] > 0
    ]

    trend = []
    for year in sorted(available_years):
        deductions = Decimal("0")
        taxable = Decimal("0")
        for schedule in schedules.values():
            selected = _selected_schedule_row(schedule or {}, year)
            deductions += _metric_value(selected, "totalExpenses")
            taxable += _metric_value(selected, "netScheduleE")
        trend.append({
            "period": str(year),
            "estimatedSavings": _money(max(deductions, Decimal("0")) * effective_rate / 100),
            "estimatedLiability": _money(max(taxable, Decimal("0")) * effective_rate / 100),
            "status": "ESTIMATED",
        })

    return {
        "selectedYear": selected_year,
        "availableYears": sorted(available_years, reverse=True),
        "rows": rows,
        "totals": totals,
        "categories": categories,
        "trend": trend,
        "assumptions": {"effectiveTaxRate": _rate(effective_rate), "label": "Planning assumption", "status": "ESTIMATED"},
        "assertions": {"categoryTotalEqualsDeductions": abs(sum(_d(item["value"]) for item in categories) - _d(totals["totalDeductions"])) <= MONEY},
    }


def _income_analysis(properties: List[Dict[str, Any]], yearly: List[Dict[str, Any]], as_of: str) -> Dict[str, Any]:
    rentals = [prop for prop in properties if str(prop.get("usage_type") or "Rental").lower() != "primary"]
    income = sum((_d(prop.get("effective_rent")) for prop in rentals), Decimal("0"))
    expenses = sum((_d(prop.get("monthly_expenses")) for prop in rentals), Decimal("0"))
    debt_service = sum((_d(prop.get("monthly_mortgage")) for prop in rentals), Decimal("0"))
    noi = income - expenses
    cash_flow = noi - debt_service
    margin = (cash_flow / income * 100) if income else None
    property_rows = [{
        "id": prop.get("id"),
        "name": prop.get("name") or prop.get("address") or f"Property {prop.get('id')}",
        "address": prop.get("address"),
        "city": prop.get("city"),
        "state": prop.get("state"),
        "income": _money(prop.get("effective_rent")),
        "operatingExpenses": _money(prop.get("monthly_expenses")),
        "noi": _money(_d(prop.get("effective_rent")) - _d(prop.get("monthly_expenses"))),
        "debtService": _money(prop.get("monthly_mortgage")),
        "cashFlow": _money(prop.get("monthly_cash_flow")),
        "status": "REPORTED" if prop.get("metrics") else "CALCULATED",
    } for prop in rentals]
    return {
        "kpis": {
            "income": _metric("income", "Total Income", income, formula="Sum of effective monthly rental income", inputs=[{"label": "Effective monthly rental income", "value": _money(income), "unit": "currency"}, {"label": "Rental properties", "value": len(rentals), "unit": "count"}], excluded=["Primary-residence activity"], period=as_of[:7]),
            "operatingExpenses": _metric("operatingExpenses", "Operating Expenses", expenses, formula="Property tax + insurance + HOA + repairs + maintenance + management + utilities + other operating costs", excluded=["Debt service, capital expenditures, depreciation"], period=as_of[:7]),
            "noi": _metric("noi", "Net Operating Income", noi, formula="Gross rental income − operating expenses", inputs=[{"label": "Gross rental income", "value": _money(income), "unit": "currency"}, {"label": "Operating expenses", "value": _money(expenses), "unit": "currency"}], excluded=["Debt service, capital expenditures, depreciation"], period=as_of[:7]),
            "debtService": _metric("debtService", "Debt Service", debt_service, formula="Sum of principal-and-interest payments", excluded=["Escrow"], period=as_of[:7]),
            "cashFlow": _metric("cashFlow", "Cash Flow After Debt", cash_flow, formula="NOI − debt service", period=as_of[:7]),
            "cashFlowMargin": _metric("cashFlowMargin", "Cash Flow Margin", margin, unit="percent", formula="Net cash flow ÷ rental income", status="UNAVAILABLE" if margin is None else "CALCULATED", period=as_of[:7]),
        },
        "properties": property_rows,
        "yearlySeries": yearly,
        "assertions": {
            "noiEqualsIncomeLessOperatingExpenses": abs(noi - (income - expenses)) <= MONEY,
            "cashFlowEqualsNoiLessDebtService": abs(cash_flow - (noi - debt_service)) <= MONEY,
        },
    }


def _forecast(properties: List[Dict[str, Any]], income: Dict[str, Any], as_of: str) -> Dict[str, Any]:
    """Build a deterministic five-year rental operating forecast.

    Forecast assumptions live in the backend contract so every client renders
    the same values and formulas. Primary-residence activity remains excluded.
    """
    rentals = [prop for prop in properties if str(prop.get("usage_type") or "Rental").lower() != "primary"]
    base_year = int(as_of[:4])
    base_income = _d(income["kpis"]["income"]["value"]) * 12
    base_expenses = _d(income["kpis"]["operatingExpenses"]["value"]) * 12
    base_debt_service = _d(income["kpis"]["debtService"]["value"]) * 12
    if not rentals or base_income <= 0:
        return {
            "status": "UNAVAILABLE",
            "reason": "Add an active rental lease or rental-income record to create a portfolio forecast.",
            "series": [],
            "assumptions": [],
            "kpis": {},
        }

    assumptions = {
        "rentGrowth": Decimal("3.00"),
        "expenseInflation": Decimal("3.00"),
        "debtServiceGrowth": Decimal("0.00"),
        "horizonYears": 5,
    }
    series = []
    for offset in range(assumptions["horizonYears"] + 1):
        income_growth = (Decimal("1") + assumptions["rentGrowth"] / 100) ** offset
        expense_growth = (Decimal("1") + assumptions["expenseInflation"] / 100) ** offset
        debt_growth = (Decimal("1") + assumptions["debtServiceGrowth"] / 100) ** offset
        projected_income = base_income * income_growth
        projected_expenses = base_expenses * expense_growth
        projected_debt = base_debt_service * debt_growth
        projected_noi = projected_income - projected_expenses
        projected_cash_flow = projected_noi - projected_debt
        series.append({
            "year": base_year + offset,
            "period": str(base_year + offset),
            "rentalIncome": _money(projected_income),
            "operatingExpenses": _money(projected_expenses),
            "noi": _money(projected_noi),
            "debtService": _money(projected_debt),
            "cashFlow": _money(projected_cash_flow),
            "status": "BASELINE_RUN_RATE" if offset == 0 else "PROJECTED",
        })

    future_rows = series[1:]
    ending = series[-1]
    base_cash_flow = _d(series[0]["cashFlow"])
    ending_cash_flow = _d(ending["cashFlow"])
    cash_flow_growth = (
        (ending_cash_flow / base_cash_flow - 1) * 100
        if base_cash_flow > 0 else None
    )
    return {
        "status": "PROJECTED",
        "reason": None,
        "baseYear": base_year,
        "horizonYears": assumptions["horizonYears"],
        "rentalPropertyCount": len(rentals),
        "series": series,
        "assumptions": [
            {"key": "rentGrowth", "label": "Annual rent growth", "value": _rate(assumptions["rentGrowth"]), "unit": "percent", "source": "Backend planning assumption"},
            {"key": "expenseInflation", "label": "Annual expense inflation", "value": _rate(assumptions["expenseInflation"]), "unit": "percent", "source": "Backend planning assumption"},
            {"key": "debtServiceGrowth", "label": "Annual debt-service growth", "value": _rate(assumptions["debtServiceGrowth"]), "unit": "percent", "source": "Active-loan P&I held constant"},
        ],
        "kpis": {
            "endingCashFlow": _metric("endingCashFlow", f"{ending['year']} Cash Flow", ending_cash_flow, formula="Projected NOI − projected principal-and-interest debt service", period=str(ending["year"]), source="Backend forecast"),
            "endingNoi": _metric("endingNoi", f"{ending['year']} NOI", ending["noi"], formula="Projected rental income − projected operating expenses", period=str(ending["year"]), source="Backend forecast"),
            "cumulativeCashFlow": _metric("cumulativeCashFlow", "Five-Year Cash Flow", sum((_d(row["cashFlow"]) for row in future_rows), Decimal("0")), formula="Sum of projected annual cash flow for the five forecast years", period=f"{future_rows[0]['year']}-{future_rows[-1]['year']}", source="Backend forecast"),
            "cashFlowGrowth": _metric("cashFlowGrowth", "Cash Flow Growth", cash_flow_growth, unit="percent", formula="(Final forecast cash flow ÷ baseline cash flow − 1) × 100", status="UNAVAILABLE" if cash_flow_growth is None else "CALCULATED", period=f"{base_year}-{ending['year']}", source="Backend forecast"),
        },
        "methodology": {
            "baseline": "Current monthly rental operating values annualized by the backend",
            "incomeFormula": "Prior-year rental income × (1 + rent growth)",
            "expenseFormula": "Prior-year operating expenses × (1 + expense inflation)",
            "cashFlowFormula": "Rental income − operating expenses − P&I debt service",
            "excluded": ["Primary-residence activity", "Escrow deposits", "Depreciation", "Capital expenditures", "Income taxes"],
            "confidence": "MEDIUM",
        },
    }


def _analytics(properties: List[Dict[str, Any]], income: Dict[str, Any], loans: Dict[str, Any], as_of: str) -> Dict[str, Any]:
    rentals = [prop for prop in properties if str(prop.get("usage_type") or "Rental").lower() != "primary"]
    portfolio_value = sum((_d(prop.get("market_value")) for prop in properties), Decimal("0"))
    total_debt = _d(loans["kpis"]["totalBalance"]["value"])
    equity = portfolio_value - total_debt
    annual_noi = _d(income["kpis"]["noi"]["value"]) * 12
    annual_cash_flow = _d(income["kpis"]["cashFlow"]["value"]) * 12
    annual_debt = _d(income["kpis"]["debtService"]["value"]) * 12
    cash_invested = sum((_d(prop.get("down_payment")) + _d(prop.get("closing_costs")) for prop in rentals), Decimal("0"))
    cap_rate = annual_noi / portfolio_value * 100 if portfolio_value else None
    coc = annual_cash_flow / cash_invested * 100 if cash_invested else None
    dscr = annual_noi / annual_debt if annual_debt else None
    ltv = total_debt / portfolio_value * 100 if portfolio_value else None
    scheduled_rent = sum((_d(prop.get("monthly_rent")) for prop in rentals), Decimal("0"))
    effective_rent = sum(
        (_d(prop.get("monthly_rent")) * min(max(_d(prop.get("occupancy_rate")), Decimal("0")), Decimal("100")) / 100
         for prop in rentals),
        Decimal("0"),
    )
    # Occupancy over time: occupied months ÷ months available for rent, summed
    # across the rental portfolio. Each rental's occupied/available months are
    # derived upstream from its tenancy (RentalPeriod) records against the window
    # it has been available for rent — gaps between leases count as vacant, and a
    # rental with an active tenancy counts as occupied even if monthly_rent is
    # blank on the record. Falls back to occupancy_rate only when a rental has no
    # timeline data at all.
    available_months = sum(int(prop.get("occupancy_available_months") or 0) for prop in rentals)
    occupied_months = sum(int(prop.get("occupancy_occupied_months") or 0) for prop in rentals)
    vacant_months = max(available_months - occupied_months, 0)
    if available_months > 0:
        occupancy = Decimal(occupied_months) / Decimal(available_months) * 100
    elif rentals:
        # No timeline anywhere — fall back to the average occupancy_rate field.
        rates = [min(max(_d(p.get("occupancy_rate")), Decimal("0")), Decimal("100")) for p in rentals]
        occupancy = sum(rates, Decimal("0")) / len(rates) if rates else None
    else:
        occupancy = None

    gross = _d(income["kpis"]["income"]["value"])
    scheduled_gross = sum((_d(prop.get("monthly_rent")) for prop in rentals), Decimal("0"))
    vacancy_loss = max(scheduled_gross - gross, Decimal("0"))
    opex = _d(income["kpis"]["operatingExpenses"]["value"])
    monthly_noi = _d(income["kpis"]["noi"]["value"])
    debt = _d(income["kpis"]["debtService"]["value"])
    net = _d(income["kpis"]["cashFlow"]["value"])
    waterfall = [
        {"key": "grossIncome", "label": "Gross Rental Income", "value": _money(scheduled_gross), "type": "start", "runningTotal": _money(scheduled_gross)},
        {"key": "vacancyLoss", "label": "Vacancy Loss", "value": _money(-vacancy_loss), "type": "decrease", "runningTotal": _money(gross)},
        {"key": "operatingExpenses", "label": "Operating Expenses", "value": _money(-opex), "type": "decrease", "runningTotal": _money(monthly_noi)},
        {"key": "noi", "label": "NOI", "value": _money(monthly_noi), "type": "subtotal", "runningTotal": _money(monthly_noi)},
        {"key": "debtService", "label": "Debt Service", "value": _money(-debt), "type": "decrease", "runningTotal": _money(net)},
        {"key": "netCashFlow", "label": "Net Cash Flow", "value": _money(net), "type": "total", "runningTotal": _money(net)},
    ]

    property_rows = []
    for prop in rentals:
        monthly_cf = _d(prop.get("monthly_cash_flow"))
        invested = _d(prop.get("down_payment")) + _d(prop.get("closing_costs"))
        cash_on_cash = None if not invested else _rate(monthly_cf * 12 / invested * 100)
        property_rows.append({
            "id": prop.get("id"),
            "label": prop.get("name") or prop.get("address") or f"Property {prop.get('id')}",
            "cashFlow": _money(monthly_cf),
            "cashOnCash": cash_on_cash,
            "capRate": None if not _d(prop.get("market_value")) else _rate(_d(prop.get("annual_noi")) / _d(prop.get("market_value")) * 100),
            "marketValue": _money(prop.get("market_value")),
            "loanBalance": _money(prop.get("total_loan_balance")),
            "equity": _money(prop.get("equity")),
            "noi": _money(prop.get("annual_noi")),
            "x": _money(monthly_cf),
            "y": cash_on_cash,
        })
    property_rows.sort(key=lambda row: (row["cashOnCash"] is not None, row["cashOnCash"] or -999999), reverse=True)

    expense_totals = {
        "propertyTax": sum((_d(prop.get("property_tax_annual")) for prop in rentals), Decimal("0")),
        "insurance": sum((_d(prop.get("insurance_monthly")) * 12 for prop in rentals), Decimal("0")),
    }
    annual_operating = _d(income["kpis"]["operatingExpenses"]["value"]) * 12
    classified_expenses = expense_totals["propertyTax"] + expense_totals["insurance"]
    expense_category_conflict = classified_expenses > annual_operating
    if expense_category_conflict:
        expense_breakdown = ([{
            "key": "unreconciled",
            "label": "Operating Expenses",
            "value": _money(annual_operating),
            "percentage": 100.0,
            "status": "UNRECONCILED",
        }] if annual_operating > 0 else [])
    else:
        expense_totals["other"] = annual_operating - classified_expenses
        expense_breakdown = [
            {"key": key, "label": label, "value": _money(value), "percentage": _rate(value / annual_operating * 100) if annual_operating else 0}
            for key, label, value in (
                ("propertyTax", "Property Tax", expense_totals["propertyTax"]),
                ("insurance", "Insurance", expense_totals["insurance"]),
                ("other", "Other Operating Expenses", expense_totals["other"]),
            ) if value > 0
        ]

    insight_message = (
        "Selected properties produce positive monthly cash flow after principal-and-interest debt service."
        if net >= 0
        else "Selected properties produce negative monthly cash flow after principal-and-interest debt service; review operating expenses and active-loan payments."
    )

    debt_by_year: Dict[int, Decimal] = defaultdict(Decimal)
    for loan in loans.get("allRows") or []:
        for row in loan.get("paydownRows") or []:
            if row.get("isFullYearProjection"):
                continue
            if row.get("year"):
                debt_by_year[int(row["year"])] += _d(row.get("principalPaid")) + _d(row.get("interestPaid"))
    cash_flow_series = []
    for row in sorted(income.get("yearlySeries") or [], key=lambda item: int(item.get("year") or 0)):
        year = int(row.get("year") or 0)
        annual_income = _d(row.get("rental_income"))
        annual_expenses = _d(row.get("operating_expenses"))
        annual_year_debt = debt_by_year.get(year, Decimal("0"))
        cash_flow_series.append({
            "period": str(year),
            "income": _money(annual_income),
            "operatingExpenses": _money(annual_expenses),
            "noi": _money(annual_income - annual_expenses),
            "debtService": _money(annual_year_debt) if annual_year_debt else None,
            "cashFlow": _money(annual_income - annual_expenses - annual_year_debt) if annual_year_debt else None,
            "status": row.get("status") or "REPORTED",
            "sources": row.get("sources") or [],
        })

    equity_series = [{
        "period": as_of,
        "marketValue": _money(portfolio_value),
        "loanBalance": _money(total_debt),
        "equity": _money(equity),
        "status": "CURRENT_SNAPSHOT",
    }]
    performance_summary = [
        {"key": "rentalIncome", "label": "Rental Income", "value": _money(gross * 12), "note": "Annual run-rate"},
        {"key": "noi", "label": "NOI", "value": _money(annual_noi), "note": "Income after operating expenses"},
        {"key": "operatingExpenses", "label": "Operating Expenses", "value": _money(opex * 12), "note": "Annual run-rate"},
        {"key": "cashFlow", "label": "Total Cash Flow", "value": _money(annual_cash_flow), "note": "After debt service"},
        {"key": "principalReduction", "label": "Principal Reduction YTD", "value": loans["kpis"]["principalYtd"]["value"], "note": "Logical loan paydown rows"},
        {"key": "interestPaid", "label": "Interest Paid to Date", "value": loans["kpis"]["interestToDate"]["value"], "note": "1098, statement, and amortization sources"},
    ]

    total_purchase_price = sum((_d(prop.get("purchase_price")) for prop in properties), Decimal("0"))
    total_appreciation = portfolio_value - total_purchase_price
    principal_reduction = sum((_d(row.get("principalPaid")) for row in loans.get("allRows") or [] if row.get("status") == "Active"), Decimal("0"))
    total_down_payment = sum((_d(prop.get("down_payment")) for prop in properties), Decimal("0"))
    total_cash_invested = sum((_d(prop.get("down_payment")) + _d(prop.get("closing_costs")) for prop in properties), Decimal("0"))

    # ── Value Buildup Over Time (market-value story waterfall) ───────────────
    # Aggregated across every selected property (home + rentals), in the SAME
    # node format the primary Home Summary's value-buildup chart uses so the two
    # render identically. Market value is decomposed as:
    #   down payment + principal reduction + remaining secured debt = purchase
    #   price;  + appreciation = current market value
    # Every step is defined by a difference, so the bars reconcile by
    # construction to the purchase price and current market value.
    value_buildup = _portfolio_value_buildup_story(
        purchase_price=total_purchase_price,
        down_payment=total_down_payment,
        current_debt=total_debt,
        current_market_value=portfolio_value,
        appreciation=total_appreciation,
        as_of=as_of,
    )
    rental_count = len(rentals)
    primary_count = len(properties) - rental_count
    average_expense = opex / rental_count if rental_count else None
    latest_cash_flow_row = next((row for row in reversed(cash_flow_series) if row.get("cashFlow") is not None), None)
    latest_cash_flow = latest_cash_flow_row.get("cashFlow") if latest_cash_flow_row else None

    chart_values = [
        value
        for step in waterfall
        for value in (_d(step.get("chartStart", 0)), _d(step.get("runningTotal")))
    ]
    chart_min = min([Decimal("0"), *chart_values])
    chart_max = max([Decimal("1"), *chart_values])
    chart_range = chart_max - chart_min or Decimal("1")
    previous_total = Decimal("0")
    waterfall_steps = []
    for step in waterfall:
        step_type = step["type"]
        running_total = _d(step["runningTotal"])
        if step_type in {"start", "total", "subtotal"}:
            start_value = Decimal("0")
            end_value = running_total
        else:
            start_value = previous_total
            end_value = running_total
        high = max(start_value, end_value)
        low = min(start_value, end_value)
        waterfall_steps.append({
            **step,
            "startValue": _money(start_value),
            "endValue": _money(end_value),
            "topPercent": _rate((chart_max - high) / chart_range * 100),
            "heightPercent": _rate(max((high - low) / chart_range * 100, Decimal("1.5"))),
        })
        previous_total = running_total

    health_checks = [
        {"key": "cashFlow", "label": "Positive monthly cash flow", "passes": net >= 0, "display": _money(net)},
        {"key": "loanReconciliation", "label": "Loan balances reconcile", "passes": bool(loans.get("assertions", {}).get("totalBalanceEqualsRows")), "display": _money(total_debt)},
        {"key": "dscr", "label": "DSCR is at least 1.25", "passes": dscr is not None and dscr >= Decimal("1.25"), "display": _rate(dscr) if dscr is not None else None},
    ]
    passed_health_checks = sum(1 for check in health_checks if check["passes"])
    health_score = _rate(100 * Decimal(passed_health_checks) / Decimal(len(health_checks))) if health_checks else None

    alerts = []
    negative_properties = [row for row in property_rows if _d(row.get("cashFlow")) < 0]
    if negative_properties:
        alerts.append({
            "key": "negativeCashFlow",
            "severity": "WARNING",
            "title": "Negative property cash flow",
            "message": f"{len(negative_properties)} selected rental {'property has' if len(negative_properties) == 1 else 'properties have'} negative monthly cash flow.",
            "href": "/income-expenses",
            "actionLabel": "View",
        })
    if occupancy is not None and occupancy < Decimal("90"):
        alerts.append({
            "key": "lowOccupancy",
            "severity": "WARNING",
            "title": "Low portfolio occupancy",
            "message": f"Rental occupancy is {_rate(occupancy)}%, below the 90% review threshold.",
            "href": "/analytics",
            "actionLabel": "View",
        })
    if ltv is not None and ltv > Decimal("75"):
        alerts.append({
            "key": "highLtv",
            "severity": "IMPORTANT",
            "title": "High portfolio leverage",
            "message": f"Debt to value is {_rate(ltv)}% for the selected properties.",
            "href": "/loans",
            "actionLabel": "View",
        })
    if expense_category_conflict:
        alerts.append({
            "key": "expenseCategoryConflict",
            "severity": "WARNING",
            "title": "Expense categories need reconciliation",
            "message": "Property tax and insurance sources exceed the accepted operating-expense total for the selected scope.",
            "href": "/income-expenses",
            "actionLabel": "View",
        })
    if not alerts and properties:
        alerts.append({
            "key": "portfolioStable",
            "severity": "INFORMATION",
            "title": "Portfolio metrics are stable",
            "message": "No high-priority financial exceptions were detected for the selected scope.",
            "href": "/analytics",
            "actionLabel": "View",
        })

    dashboard_metrics = {
        "totalPurchasePrice": _metric("totalPurchasePrice", "Total Purchase Price", total_purchase_price, formula="Sum of purchase prices for selected properties", period=as_of),
        "appreciation": _metric("appreciation", "Appreciation", total_appreciation, formula="Selected portfolio value − selected purchase prices", period=as_of),
        "principalReduction": _metric("principalReduction", "Principal Reduction", principal_reduction, formula="Sum of lifetime principal reduction for active selected loans", period=as_of),
        "cashInvested": _metric("cashInvested", "Cash Invested", total_cash_invested, formula="Selected down payments + selected closing costs", period=as_of),
        "averageMonthlyExpense": _metric("averageMonthlyExpense", "Average Monthly Expense", average_expense, formula="Rental operating expenses ÷ selected rental property count", inputs=[{"label": "Monthly operating expenses", "value": _money(opex), "unit": "currency"}, {"label": "Rental properties", "value": rental_count, "unit": "count"}], status="UNAVAILABLE" if average_expense is None else "CALCULATED", period=as_of[:7]),
        "propertyCount": _metric("propertyCount", "Properties", len(properties), unit="count", formula="Rental properties + primary residences", inputs=[{"label": "Rental properties", "value": rental_count, "unit": "count"}, {"label": "Primary residences", "value": primary_count, "unit": "count"}], period=as_of),
        "rentalCount": _metric("rentalCount", "Rental Properties", rental_count, unit="count", formula="Count of selected rental properties", period=as_of),
        "primaryCount": _metric("primaryCount", "Primary Residences", primary_count, unit="count", formula="Count of selected primary residences", period=as_of),
        "ytdCashFlow": _metric("ytdCashFlow", "YTD Cash Flow", latest_cash_flow, formula="Rental income − operating expenses − debt service", inputs=([{"label": "Rental income", "value": latest_cash_flow_row.get("income"), "unit": "currency"}, {"label": "Operating expenses", "value": latest_cash_flow_row.get("operatingExpenses"), "unit": "currency"}, {"label": "Debt service", "value": latest_cash_flow_row.get("debtService"), "unit": "currency"}] if latest_cash_flow_row else []), status="UNAVAILABLE" if latest_cash_flow is None else "CALCULATED", period=(latest_cash_flow_row.get("period") if latest_cash_flow_row else as_of[:4])),
    }

    dashboard = {
        "header": {
            "title": "Portfolio",
            "subtitle": "Real-time overview of your selected investment properties",
            "asOfDate": as_of,
        },
        "topMetrics": [
            {"metricKey": "portfolioValue", "label": "Total Market Value", "icon": "home", "tone": "blue"},
            {"metricKey": "totalEquity", "label": "Total Equity", "icon": "equity", "tone": "green"},
            {"metricKey": "monthlyCashFlow", "label": "Monthly Cash Flow", "icon": "cashFlow", "tone": "teal", "seriesKey": "cashFlow"},
            {"metricKey": "cashOnCash", "label": "Cash-on-Cash Return", "icon": "percent", "tone": "orange"},
            {"metricKey": "annualNoi", "label": "Total NOI Annual", "icon": "analytics", "tone": "purple", "seriesKey": "noi"},
            {"metricKey": "dscr", "label": "Portfolio DSCR", "icon": "ratio", "tone": "cyan"},
        ],
        "assets": {
            "title": "Equity",
            "rows": [
                {"label": "Total Purchase Price", "metricKey": "totalPurchasePrice"},
                {"label": "Appreciation", "metricKey": "appreciation", "tone": "positive"},
                {"label": "Principal Reduction", "metricKey": "principalReduction", "tone": "positive"},
                {"label": "Cash Invested", "metricKey": "cashInvested"},
            ],
            "totalMetricKey": "totalEquity",
        },
        "health": {
            "title": "Portfolio Health",
            "score": health_score,
            "scoreDisplay": f"{health_score:.0f}" if health_score is not None else "—",
            "status": "GOOD" if health_score is not None and health_score >= 66 else "REVIEW",
            "checks": health_checks,
            "href": "/analytics",
        },
        "valueBuildup": value_buildup,
        "cashFlowWaterfall": {
            "title": "Cash Flow Waterfall (Monthly)",
            "subtitle": "How rental income flows through expenses and debt service",
            "steps": waterfall_steps,
            "finalValue": _money(net),
            "period": as_of[:7],
            "reconciliation": [
                {"label": "Gross Income", "value": _money(scheduled_gross)},
                {"label": "Total Expenses", "value": _money(vacancy_loss + opex)},
                {"label": "NOI", "value": _money(monthly_noi)},
                {"label": "Debt Service", "value": _money(debt)},
                {"label": "Net Cash Flow", "value": _money(net), "tone": "positive" if net >= 0 else "negative"},
            ],
        },
        "liabilities": {
            "title": "Loans",
            "rows": [
                {"label": "Total Loan Balance", "metricSource": "loans", "metricKey": "totalBalance"},
                {"label": "Average Interest Rate", "metricSource": "loans", "metricKey": "weightedRate"},
                {"label": "Monthly Debt Service", "metricSource": "loans", "metricKey": "monthlyPI"},
                {"label": "Number of Active Loans", "metricSource": "loans", "metricKey": "loanCount"},
            ],
            "totalMetricKey": "ltv",
        },
        "capitalStructure": {
            "title": "Capital Structure",
            "totalValue": _money(portfolio_value),
            "segments": [
                {"key": "equity", "label": "Equity", "value": _money(equity), "percentage": _rate(equity / portfolio_value * 100) if portfolio_value else 0, "tone": "positive"},
                {"key": "liabilities", "label": "Loans", "value": _money(total_debt), "percentage": _rate(total_debt / portfolio_value * 100) if portfolio_value else 0, "tone": "negative"},
            ],
        },
        "cashFlowTrend": {"title": "Cash Flow Trend", "period": "Yearly", "series": cash_flow_series},
        "expenseBreakdown": {"title": "Expense Breakdown (YTD)", "items": expense_breakdown, "total": _money(sum((_d(item["value"]) for item in expense_breakdown), Decimal("0")))},
        "propertyPerformance": {"title": "Property Performance", "rows": property_rows},
        "alerts": {"title": "Alerts & Insights", "items": alerts[:4]},
        "bottomMetrics": [
            {"metricKey": "propertyCount", "label": "Properties", "detail": f"{rental_count} rentals, {primary_count} primary", "scope": "combined", "icon": "properties"},
            {"metricKey": "occupancy", "label": "Occupancy Rate", "detail": "Rental portfolio only", "scope": "rental", "icon": "occupancy"},
            {"metricKey": "income", "metricSource": "income", "label": "Monthly Income", "detail": "Gross rental income", "scope": "rental", "icon": "income"},
            {"metricKey": "averageMonthlyExpense", "label": "Average Monthly Expense", "detail": "Per rental property", "scope": "rental", "icon": "expenses"},
            {"metricKey": "noi", "metricSource": "income", "label": "Monthly NOI", "detail": "Rental portfolio only", "scope": "rental", "icon": "noi"},
            {"metricKey": "ytdCashFlow", "label": "YTD Cash Flow", "detail": "After debt service", "scope": "rental", "icon": "cashFlow"},
        ],
        "assertions": {
            "waterfallFinalMatchesMonthlyCashFlow": abs(_d(waterfall_steps[-1]["runningTotal"]) - net) <= MONEY,
            "valueBuildupReconcilesToMarketValue": (
                value_buildup.get("status") != "available"
                or abs(_d(value_buildup["series"][-2]["endValue"]) - _d(value_buildup["series"][-1]["value"])) <= MONEY
            ),
            "capitalStructureMatchesPortfolioValue": abs(equity + total_debt - portfolio_value) <= MONEY,
            "expenseBreakdownMatchesOperatingExpenses": abs(sum((_d(item["value"]) for item in expense_breakdown), Decimal("0")) - annual_operating) <= MONEY,
            "propertyPerformanceIsBackendRanked": property_rows == sorted(property_rows, key=lambda row: (row["cashOnCash"] is not None, row["cashOnCash"] or -999999), reverse=True),
            "trendIsChronological": cash_flow_series == sorted(cash_flow_series, key=lambda row: row["period"]),
        },
    }

    return {
        "kpis": {
            "portfolioValue": _metric("portfolioValue", "Portfolio Value", portfolio_value, formula="Sum of current market values for selected properties", period=as_of),
            "totalEquity": _metric("totalEquity", "Total Equity", equity, formula="Portfolio market value − active loan balances", period=as_of),
            "totalDebt": loans["kpis"]["totalBalance"],
            "monthlyCashFlow": income["kpis"]["cashFlow"],
            "annualNoi": _metric("annualNoi", "Annual NOI", annual_noi, formula="Annual rental income − annual operating expenses", excluded=["Debt service, capital expenditures, depreciation"], period=as_of[:4]),
            "cashOnCash": _metric("cashOnCash", "Cash-on-Cash Return", coc, unit="percent", formula="Annual pre-tax cash flow ÷ total cash invested", status="UNAVAILABLE" if coc is None else "CALCULATED", period=as_of[:4]),
            "capRate": _metric("capRate", "Portfolio Cap Rate", cap_rate, unit="percent", formula="Annual NOI ÷ current market value", status="UNAVAILABLE" if cap_rate is None else "CALCULATED", period=as_of),
            "dscr": _metric("dscr", "Debt Service Coverage Ratio", dscr, unit="ratio", formula="Annual NOI ÷ annual principal-and-interest debt service", status="UNAVAILABLE" if dscr is None else "CALCULATED", period=as_of[:4]),
            "ltv": _metric("ltv", "Loan-to-Value", ltv, unit="percent", formula="Active loan balance ÷ current market value", status="UNAVAILABLE" if ltv is None else "CALCULATED", period=as_of),
            "occupancy": _metric("occupancy", "Occupancy", occupancy, unit="percent", formula="Occupied months ÷ months available for rent, across all rentals", inputs=[{"label": "Available for rent", "value": available_months, "unit": "months", "display": _months_display(available_months)}, {"label": "Occupied", "value": occupied_months, "unit": "months", "display": _months_display(occupied_months)}, {"label": "Vacant", "value": vacant_months, "unit": "months", "display": _months_display(vacant_months)}], status="UNAVAILABLE" if occupancy is None else "CALCULATED", period=as_of[:7]),
            "principalPaid": loans["kpis"]["principalYtd"],
            "interestPaid": loans["kpis"]["interestToDate"],
        },
        "cashFlowWaterfall": {"steps": waterfall, "period": as_of[:7], "finalValue": _money(net)},
        "propertyPerformance": property_rows,
        "performanceSummary": performance_summary,
        "performanceMatrix": {"points": property_rows, "quadrants": {"x": 0, "y": 5}},
        "cashFlowSeries": cash_flow_series,
        "expenseBreakdown": expense_breakdown,
        "equitySeries": equity_series,
        "occupancySeries": [],
        "loanBalanceSeries": loans["balanceSeries"],
        "debtMix": loans["debtMix"],
        "insights": [{"key": "cashFlow", "message": insight_message, "status": "DETERMINISTIC", "period": as_of[:7]}],
        "forecast": _forecast(properties, income, as_of),
        "scenario": {"status": "UNAVAILABLE", "reason": "Run and save a scenario to compare it with the baseline.", "baseline": None, "scenario": None},
        "dashboardMetrics": dashboard_metrics,
        "dashboard": dashboard,
        "assertions": {
            "waterfallEqualsCashFlow": abs(_d(waterfall[-1]["runningTotal"]) - net) <= MONEY,
            "loansReconcile": abs(total_debt - _d(loans["kpis"]["totalBalance"]["value"])) <= MONEY,
            "incomeReconciles": abs(monthly_noi - _d(income["kpis"]["noi"]["value"])) <= MONEY,
        },
    }


def build_portfolio_analysis(
    *,
    properties: List[Dict[str, Any]],
    debts: Dict[int, Dict[str, Any]],
    schedules: Dict[int, Dict[str, Any]],
    yearly_trends: List[Dict[str, Any]],
    selected_year: int,
    filter_context: Dict[str, Any],
    as_of_date: Optional[str] = None,
) -> Dict[str, Any]:
    as_of = as_of_date or date.today().isoformat()
    loans = _loan_analysis(
        properties,
        debts,
        as_of,
        loan_status=str(filter_context.get("loanStatus") or "Active"),
    )
    income = _income_analysis(properties, yearly_trends, as_of)
    tax = _tax_analysis(properties, schedules, selected_year)
    analytics = _analytics(properties, income, loans, as_of)
    return {
        "schemaVersion": "portfolio-analysis.v1",
        "filterContext": filter_context,
        "asOfDate": as_of,
        "properties": properties,
        "loans": loans,
        "taxCenter": tax,
        "incomeExpenses": income,
        "analytics": analytics,
        "reconciliation": {
            "loanBalance": loans["kpis"]["totalBalance"]["value"],
            "analyticsLoanBalance": analytics["kpis"]["totalDebt"]["value"],
            "noi": income["kpis"]["noi"]["value"],
            "analyticsNoi": analytics["kpis"]["annualNoi"]["value"],
            "netCashFlow": income["kpis"]["cashFlow"]["value"],
            "waterfallFinal": analytics["cashFlowWaterfall"]["finalValue"],
            "assertions": {
                "loanBalanceMatchesAnalytics": analytics["assertions"]["loansReconcile"],
                "incomeNoiMatchesAnalytics": analytics["assertions"]["incomeReconciles"],
                "cashFlowMatchesWaterfall": analytics["assertions"]["waterfallEqualsCashFlow"],
            },
        },
    }
