from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from services.formatters import format_currency, format_interest_rate, format_metric_currency, format_percent
from services.property_engine import build_property_engine, monthly_principal_interest, parse_date


def _tone(value: Optional[float], *, positive_is_good: bool = True) -> str:
    if value is None or abs(float(value or 0)) < 0.005:
        return "neutral"
    is_positive = float(value) > 0
    return "positive" if is_positive == positive_is_good else "negative"


def _source(source: Optional[str]) -> str:
    raw = str(source or "").strip().lower()
    if raw in {"manual", "user", "user_input", "property_form"}:
        return "MANUAL"
    if raw in {"document", "reported", "schedule_e", "tax_return"} or raw.startswith("schedule_e_"):
        return "REPORTED"
    if raw in {"approx", "estimated"}:
        return "APPROX"
    if raw in {"projected", "projection"}:
        return "PROJECTED"
    return "CALCULATED"


def _input(label: str, value: Optional[float], unit: str = "currency") -> Dict[str, Any]:
    if value is None:
        display = "—"
    elif unit == "percent":
        display = format_percent(value)
    elif unit == "interestRate":
        display = format_interest_rate(value)
    elif unit == "ratio":
        display = f"{float(value or 0):.2f}".rstrip("0").rstrip(".")
    else:
        display = format_currency(value)
    return {"label": label, "value": value, "display": display}


def metric_dto(
    *,
    metric_key: str,
    label: str,
    value: Optional[float],
    unit: str = "currency",
    period: Optional[str] = None,
    source: str = "CALCULATED",
    status: str = "complete",
    tone: Optional[str] = None,
    formula: Optional[str] = None,
    inputs: Optional[List[Dict[str, Any]]] = None,
    computation: Optional[str] = None,
    last_updated: Optional[str] = None,
    positive_is_good: bool = True,
) -> Dict[str, Any]:
    if value is None:
        display = "—"
        full_display = "—"
    elif unit == "percent":
        display = format_percent(value)
        full_display = display
    elif unit == "interestRate":
        display = format_interest_rate(value)
        full_display = display
    elif unit == "ratio":
        display = f"{float(value or 0):.2f}".rstrip("0").rstrip(".")
        full_display = display
    else:
        display = format_metric_currency(value, threshold=1_000 if period == "mo" else 100_000)
        full_display = format_currency(value)

    return {
        "metricKey": metric_key,
        "formulaDefinitionId": f"{metric_key}:v1",
        "label": label,
        "value": None if value is None else round(float(value), 4),
        "displayValue": display,
        "fullDisplayValue": full_display,
        "unit": unit,
        "period": period,
        "source": _source(source),
        "status": status,
        "tone": tone or _tone(value, positive_is_good=positive_is_good),
        "formula": formula,
        "inputs": inputs or [],
        "computation": computation,
        "lastUpdated": last_updated or date.today().isoformat(),
    }


def _legacy_metric_dto(metric_key: str, label: str, legacy: Optional[Dict[str, Any]], unit: str = "currency") -> Optional[Dict[str, Any]]:
    if not legacy:
        return None
    value = legacy.get("value")
    display = legacy.get("display") or legacy.get("result") or "—"
    if unit == "currency" and value is not None:
        full_display = format_currency(value)
    else:
        full_display = legacy.get("result") or display
    return {
        "metricKey": metric_key,
        "formulaDefinitionId": f"{metric_key}:v1",
        "label": label,
        "value": value,
        "displayValue": display,
        "fullDisplayValue": full_display,
        "unit": unit,
        "period": legacy.get("period"),
        "source": _source(legacy.get("source")),
        "status": "warn" if legacy.get("warning") else "complete",
        "tone": legacy.get("tone") or _tone(value),
        "formula": legacy.get("formula"),
        "inputs": legacy.get("inputs") or [],
        "computation": legacy.get("computation"),
        "lastUpdated": date.today().isoformat(),
        "result": legacy.get("result"),
        "warning": legacy.get("warning"),
        "hint": legacy.get("hint"),
        "missingInputs": legacy.get("missingInputs") or [],
    }


def _yearly_display_row(row: Dict[str, Any], market_value: float) -> Dict[str, Any]:
    loan_balance = float(row.get("loan_balance", row.get("balance", 0)) or 0)
    equity = max(0.0, float(market_value or 0) - loan_balance)
    interest = float(row.get("interest_paid", 0) or 0)
    principal = float(row.get("principal_paid", 0) or 0)
    debt_service = interest + principal
    interest_tax = interest + float(row.get("taxes_paid", 0) or 0)
    income = float(row.get("rental_income", 0) or 0)
    opex = float(row.get("operating_expenses", 0) or 0)
    noi = income - opex
    cash_flow = float(row.get("cash_flow", income - opex - debt_service) or 0)
    total_return = float(row.get("total_return", cash_flow + principal) or 0)

    return {
        "year": row.get("year"),
        "isPartial": bool(row.get("is_partial")),
        "usageStatus": row.get("usage_status"),
        "marketValue": market_value,
        "marketValueDisplay": format_currency(market_value),
        "loanBalance": loan_balance,
        "loanBalanceDisplay": format_currency(loan_balance),
        "equity": equity,
        "equityDisplay": format_currency(equity),
        "principalPaid": principal,
        "principalPaidDisplay": format_currency(principal),
        "interestTax": interest_tax,
        "interestTaxDisplay": format_currency(interest_tax),
        "income": income,
        "incomeDisplay": format_currency(income),
        "operatingExpenses": opex,
        "operatingExpensesDisplay": format_currency(opex),
        "noi": noi,
        "noiDisplay": format_currency(noi),
        "debtService": debt_service,
        "debtServiceDisplay": format_currency(debt_service),
        "cashFlow": cash_flow,
        "cashFlowDisplay": format_currency(cash_flow),
        "cashFlowTone": _tone(cash_flow),
        "totalReturn": total_return,
        "totalReturnDisplay": format_currency(total_return),
        "depreciation": float(row.get("depreciation", 0) or 0),
        "depreciationDisplay": format_currency(row.get("depreciation", 0) or 0),
        "taxableIncome": float(row.get("taxable_income", 0) or 0),
        "taxableIncomeDisplay": format_currency(row.get("taxable_income", 0) or 0),
        "source": _source(row.get("source")),
    }


def _money_display(value: Optional[float]) -> Dict[str, Any]:
    if value is None:
        return {"value": None, "display": "—", "fullDisplay": "—"}
    return {"value": value, "display": format_currency(value), "fullDisplay": format_currency(value)}


def _percent_display_value(value: Optional[float]) -> str:
    return "—" if value is None else f"{value:.2f}%"


def _loan_is_secured_debt(loan: Any) -> bool:
    status = str(getattr(loan, "status", "") or getattr(loan, "loan_status", "") or "OPEN").upper()
    return status not in {"CLOSED", "PAID_OFF"}


def _loan_is_refinance_or_secondary(loan: Any) -> bool:
    text = " ".join(str(getattr(loan, attr, "") or "") for attr in ["loan_type", "loan_product", "lender_name", "notes"]).lower()
    return any(token in text for token in ["refi", "refinance", "cash-out", "cash out", "heloc", "second", "2nd", "line of credit"])


def _action(label: str, tab_key: str) -> Dict[str, str]:
    return {"label": label, "tabKey": tab_key}


def _compact_money(value: float, *, signed: bool = False) -> str:
    display = format_metric_currency(value)
    if signed and value > 0:
        return f"+{display}"
    if signed and value < 0:
        return display.replace("-", "−", 1)
    return display


def _story_node(key: str, label: str, value: float, start: float, end: float, tone: str, total: bool = False, signed: bool = True) -> Dict[str, Any]:
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
            "role": "Total property value" if total else "Bridge component",
        },
    }


def _equity_story(prop: Any, market_value: float, current_property_debt: float) -> Dict[str, Any]:
    tolerance = 1.0
    property_use_type = str(getattr(prop, "usage_type", "rental") or "rental").lower()
    use_label = "Your home equity" if property_use_type == "primary" else "Your property equity" if property_use_type == "mixed" else "Your ownership stake"
    purchase_price = float(getattr(prop, "purchase_price", 0) or 0)
    acquisition_cash = float(getattr(prop, "down_payment", 0) or 0)
    current_market_value = float(market_value or 0)
    current_debt = float(current_property_debt or 0)
    # Acquisition debt is the financed portion of the purchase, not the sum of
    # every note that has ever existed. Summing a closed purchase mortgage and
    # its refinance double-counts the same debt and incorrectly hides the chart.
    acquisition_debt = round(max(purchase_price - acquisition_cash, 0.0), 2)
    current_equity = round(current_market_value - current_debt, 2) if current_market_value else None
    ownership_percent = (current_equity / current_market_value * 100) if current_market_value and current_equity is not None else None
    appreciation = round(current_market_value - purchase_price, 2) if current_market_value and purchase_price else None
    principal_reduction = round(acquisition_debt - current_debt, 2) if acquisition_debt or current_debt else None

    hero_value = current_equity if current_equity is not None else None
    hero = {
        **_money_display(hero_value),
        "ownershipPercent": ownership_percent,
        "ownershipPercentDisplay": _percent_display_value(ownership_percent),
        "headline": f"{format_currency(hero_value)} · you own {_percent_display_value(ownership_percent)}" if hero_value is not None else "Equity unavailable",
    }

    ownership: Dict[str, Any]
    if not current_market_value:
        ownership = {
            "status": "unavailable",
            "title": "Who owns the property value today",
            "segments": [],
            "centerLabel": {"label": "Estimated value", "display": "—"},
            "unavailableReason": "Add a current market value to calculate equity.",
            "recommendedAction": _action("Add Market Value", "details"),
            "explanation": "Current market value is required before ownership can be shown.",
            "validation": {"status": "unavailable", "difference": None, "tolerance": tolerance},
        }
    elif current_debt > current_market_value:
        shortfall = round(current_market_value - current_debt, 2)
        ownership = {
            "status": "negative_equity",
            "title": "Who owns the property value today",
            "segments": [],
            "centerLabel": {"label": "Estimated value", "display": format_currency(current_market_value)},
            "comparison": [
                {"key": "currentMarketValue", "label": "Estimated property value", **_money_display(current_market_value)},
                {"key": "currentPropertyDebt", "label": "Secured debt", **_money_display(current_debt)},
                {"key": "equityShortfall", "label": "Equity shortfall", **_money_display(shortfall)},
            ],
            "unavailableReason": None,
            "recommendedAction": _action("Review Loans", "loans"),
            "explanation": f"Secured debt currently exceeds the estimated property value by {format_currency(abs(shortfall))}.",
            "validation": {"status": "negative_equity", "difference": shortfall, "tolerance": tolerance},
        }
    else:
        debt_pct = (current_debt / current_market_value * 100) if current_market_value else None
        diff = round((current_equity or 0) + current_debt - current_market_value, 2)
        ownership = {
            "status": "available" if abs(diff) <= tolerance else "unavailable",
            "title": "Who owns the property value today",
            "segments": [
                {"key": "ownerEquity", "label": use_label, "value": current_equity, "display": format_currency(current_equity), "fullDisplay": format_currency(current_equity), "percent": ownership_percent, "percentDisplay": _percent_display_value(ownership_percent), "tone": "equity"},
                {"key": "securedDebt", "label": "Secured debt", "value": current_debt, "display": format_currency(current_debt), "fullDisplay": format_currency(current_debt), "percent": debt_pct, "percentDisplay": _percent_display_value(debt_pct), "tone": "debt"},
            ],
            "centerLabel": {"label": "Estimated value", "display": format_currency(current_market_value)},
            "unavailableReason": None if abs(diff) <= tolerance else "Current equity and secured debt do not reconcile to market value.",
            "recommendedAction": None if abs(diff) <= tolerance else _action("Review Loans", "loans"),
            "explanation": f"{use_label} is {format_currency(current_equity)} of the estimated {format_currency(current_market_value)} value.",
            "validation": {"status": "valid" if abs(diff) <= tolerance else "invalid", "difference": diff, "tolerance": tolerance},
        }

    waterfall_unavailable_reason = None
    waterfall_action = None
    if not current_market_value:
        waterfall_unavailable_reason = "Add a current market value to calculate equity."
        waterfall_action = _action("Add Market Value", "details")
    elif not purchase_price:
        waterfall_unavailable_reason = "Add the purchase price to see how value was created."
        waterfall_action = _action("Edit Property Details", "details")
    elif not acquisition_cash:
        waterfall_unavailable_reason = "Add acquisition financing details to complete the value breakdown."
        waterfall_action = _action("Edit Property Details", "details")
    validation_checks = []
    if not waterfall_unavailable_reason:
        validation_checks = [
            {"key": "acquisitionFunding", "label": "Acquisition cash + acquisition debt = purchase price", "difference": round(acquisition_cash + acquisition_debt - purchase_price, 2)},
            {"key": "debtBridge", "label": "Principal reduction + current debt = acquisition debt", "difference": round((principal_reduction or 0) + current_debt - acquisition_debt, 2)},
            {"key": "valueBridge", "label": "Purchase price + appreciation = market value", "difference": round(purchase_price + (appreciation or 0) - current_market_value, 2)},
            {"key": "equity", "label": "Market value - current debt = current equity", "difference": round(current_market_value - current_debt - (current_equity or 0), 2)},
            {"key": "equityContribution", "label": "Acquisition cash + principal reduction + appreciation = current equity", "difference": round(acquisition_cash + (principal_reduction or 0) + (appreciation or 0) - (current_equity or 0), 2)},
        ]
        for check in validation_checks:
            check["passes"] = abs(check["difference"]) <= tolerance
        if not all(check["passes"] for check in validation_checks):
            waterfall_unavailable_reason = "Acquisition funding and current debt do not reconcile yet."
            waterfall_action = _action("Review Loans", "loans")

    if waterfall_unavailable_reason:
        waterfall = {
            "status": "unavailable",
            "title": "Purchase Price to Current Market Value",
 "subtitle": f"The first three components make up the original purchase price of {format_metric_currency(purchase_price)}; appreciation adds {_compact_money(appreciation or 0, signed=True)} to reach {format_metric_currency(current_market_value)}.",
            "series": [],
            "annotations": [],
            "validation": {"status": "unavailable", "difference": None, "tolerance": tolerance, "checks": validation_checks},
            "unavailableReason": waterfall_unavailable_reason,
            "recommendedAction": waterfall_action,
        }
    else:
        cumulative = 0.0
        series = []
        for key, label, value, tone in [
            ("acquisitionCashContribution", "Acquisition cash", acquisition_cash, "acquisition_cash"),
            ("principalReductionSinceAcquisition", "Principal reduction", principal_reduction or 0, "principal_reduction"),
            ("currentPropertyDebt", "Remaining secured debt", current_debt, "remaining_secured_debt"),
            ("appreciation", "Appreciation", appreciation or 0, "appreciation"),
        ]:
            start = cumulative
            end = cumulative + value
            series.append(_story_node(key, label, value, start, end, tone, signed=key != "acquisitionCashContribution"))
            cumulative = end
        series.append(_story_node("currentMarketValue", "Current market value", current_market_value, 0, current_market_value, "total", total=True, signed=False))
        waterfall = {
            "status": "available",
            "title": "Purchase Price to Current Market Value",
 "subtitle": f"The first three components make up the original purchase price of {format_metric_currency(purchase_price)}; appreciation adds {_compact_money(appreciation or 0, signed=True)} to reach {format_metric_currency(current_market_value)}.",
 "screenReaderSummary": f"Current market value is {format_currency(current_market_value)}. It consists of {format_currency(acquisition_cash)} acquisition cash, {format_currency(principal_reduction or 0)} principal reduction, {format_currency(current_debt)} remaining secured debt, and {format_currency(appreciation or 0)} appreciation.",
            "series": series,
            "annotations": [
                {"startBarId": "acquisitionCashContribution", "endBarId": "currentPropertyDebt", "label": f"Purchase price · {format_metric_currency(purchase_price)}", "semanticType": "acquisition"},
                {"startBarId": "appreciation", "endBarId": "appreciation", "label": f"Gain {_compact_money(appreciation or 0, signed=True)}", "semanticType": "appreciation"},
            ],
            "validation": {"status": "valid", "difference": 0, "tolerance": tolerance, "checks": validation_checks},
            "unavailableReason": None,
            "recommendedAction": None,
        }

    return {
        "propertyUseType": property_use_type,
        "asOfDate": date.today().isoformat(),
        "hero": hero,
        "definitions": {
            "purchasePrice": purchase_price,
            "acquisitionCashContribution": acquisition_cash,
            "acquisitionDebt": acquisition_debt,
            "currentMarketValue": current_market_value,
            "currentPropertyDebt": current_debt,
            "principalReductionSinceAcquisition": principal_reduction,
            "appreciation": appreciation,
            "currentEquity": current_equity,
        },
        "waterfall": waterfall,
        "ownership": ownership,
    }

def _is_closed_loan(loan: Any, balance: float) -> bool:
    status = str(getattr(loan, "status", "") or getattr(loan, "loan_status", "") or "").upper()
    if status in {"CLOSED", "PAID_OFF"}:
        return True
    return balance <= 1 and bool(getattr(loan, "maturity_date", None))


def _loan_summary(prop: Any) -> Dict[str, Any]:
    engine = build_property_engine(prop)
    today = date.today()
    open_loans = []
    closed_count = 0
    for loan in getattr(prop, "loans", []) or []:
        balance = float(engine.balance_today(loan) or 0)
        if _is_closed_loan(loan, balance):
            closed_count += 1
        else:
            open_loans.append((loan, balance))

    total_original = sum(float(getattr(loan, "original_amount", 0) or 0) for loan, _ in open_loans)
    total_balance = sum(balance for _, balance in open_loans)
    principal_paid_to_date = sum(
        max(float(getattr(loan, "original_amount", 0) or 0) - balance, 0.0)
        for loan, balance in open_loans
    )
    interest_to_date = 0.0
    for loan, _ in open_loans:
        interest_to_date += sum(row.interest for row in engine.build_schedule(loan) if row.month <= today)

    rates = [
        float(getattr(loan, "interest_rate", 0) or 0)
        for loan, _ in open_loans
        if getattr(loan, "interest_rate", None) is not None
    ]
    rate_types = sorted({
        str(getattr(loan, "rate_type", "") or getattr(loan, "loan_type", "") or "fixed").strip().upper()
        for loan, _ in open_loans
        if str(getattr(loan, "rate_type", "") or getattr(loan, "loan_type", "") or "").strip()
    })
    rate_type_label = " + ".join("ARM" if value in {"ARM", "ADJUSTABLE"} else value.lower() for value in rate_types) or "fixed rate"
    if len(rates) == 1:
        rate_display = f"{format_interest_rate(rates[0])} {rate_type_label}"
    elif len(rates) > 1:
        rate_display = f"{format_interest_rate(min(rates))}–{format_interest_rate(max(rates))}"
    else:
        rate_display = "—"
    balance_check_difference = round(total_original - principal_paid_to_date - total_balance, 2)

    return {
        "openCount": len(open_loans),
        "closedCount": closed_count,
        "totalCount": len(open_loans) + closed_count,
        "totalOriginal": round(total_original, 2),
        "totalBalance": round(total_balance, 2),
        "principalPaidToDate": round(principal_paid_to_date, 2),
        "interestToDate": round(interest_to_date, 2),
        "rateDisplay": rate_display,
        "rateTypeDisplay": rate_type_label,
        "balanceCheck": {
            "status": "valid" if abs(balance_check_difference) <= 1 else "mismatch",
            "difference": balance_check_difference,
            "tolerance": 1,
            "formula": "totalLoan − paidToDate = totalBalance",
        },
    }


def _term_months(loan: Any) -> int:
    raw = getattr(loan, "term_months", None) or getattr(loan, "tenure_months", None)
    if raw:
        try:
            return max(1, int(raw))
        except Exception:
            pass
    years = getattr(loan, "loan_term_years", None) or getattr(loan, "tenure_years", None) or 30
    try:
        return max(1, int(float(years) * 12))
    except Exception:
        return 360


def _months_between(start: Optional[date], end: Optional[date]) -> int:
    if not start or not end:
        return 0
    return max(0, (end.year - start.year) * 12 + (end.month - start.month))


def _loan_status_metadata(loan: Any, balance: float, schedule: List[Any], today: date) -> Dict[str, Any]:
    original = float(getattr(loan, "original_amount", 0) or 0)
    payment = float(getattr(loan, "monthly_payment", 0) or 0)
    rate = float(getattr(loan, "interest_rate", 0) or 0)
    term_months = _term_months(loan)
    term_years = max(1, round(term_months / 12))
    start_date = parse_date(getattr(loan, "origination_date", None) or getattr(loan, "start_date", None))
    maturity_date = parse_date(getattr(loan, "maturity_date", None))
    months_elapsed = min(term_months, _months_between(start_date, today)) if start_date else 0
    months_remaining = max(term_months - months_elapsed, 0)
    paid_amount = max(original - balance, 0.0) if original > 0 else 0.0
    paid_percent = min(max((paid_amount / original) * 100, 0.0), 100.0) if original > 0 else 0.0
    elapsed_percent = min(max((months_elapsed / term_months) * 100, 0.0), 100.0) if term_months else 0.0
    computed_payment = monthly_principal_interest(original, rate, term_years)
    payment_delta = payment - computed_payment if payment and computed_payment else 0.0
    payment_mismatch = bool(payment and computed_payment and abs(payment_delta) > 2)
    payoff_row = next((row for row in schedule if float(getattr(row, "balance", 0) or 0) <= 1), None)
    payoff_date = getattr(payoff_row, "month", None) if payoff_row else None
    maturity_delta_months = _months_between(payoff_date, maturity_date) if payoff_date and maturity_date else 0
    maturity_mismatch = bool(payoff_date and maturity_date and abs(maturity_delta_months) > 3)
    gap_months = int(getattr(loan, "gap_months_projected", 0) or 0)
    if not gap_months:
        gap_months = max(0, int(getattr(loan, "projected_months", 0) or 0))

    warnings: List[Dict[str, Any]] = []
    if payment_mismatch:
        warnings.append({
            "type": "payment_mismatch",
            "message": (
                f"Payment mismatch: computed {format_currency(computed_payment)} from "
                f"original/rate/term vs entered {format_currency(payment)}."
            ),
            "computedPayment": round(computed_payment, 2),
            "enteredPayment": round(payment, 2),
            "delta": round(payment_delta, 2),
        })
    if maturity_mismatch:
        warnings.append({
            "type": "maturity_mismatch",
            "message": (
                f"Payoff mismatch: schedule reaches zero around {payoff_date.year}, "
                f"but maturity is {maturity_date.year}."
            ),
            "payoffDate": payoff_date.isoformat(),
            "maturityDate": maturity_date.isoformat(),
            "deltaMonths": maturity_delta_months,
        })

    return {
        "status": "CLOSED" if str(getattr(loan, "status", "") or "").upper() == "CLOSED" else "OPEN",
        "startDate": start_date.isoformat() if start_date else None,
        "maturityDate": maturity_date.isoformat() if maturity_date else None,
        "termMonths": term_months,
        "monthsElapsed": months_elapsed,
        "monthsRemaining": months_remaining,
        "paidAmount": round(paid_amount, 2),
        "paidPercent": round(paid_percent, 4),
        "elapsedPercent": round(elapsed_percent, 4),
        "computedPayment": round(computed_payment, 2),
        "paymentDelta": round(payment_delta, 2),
        "paymentMismatch": payment_mismatch,
        "payoffDate": payoff_date.isoformat() if payoff_date else None,
        "maturityMismatch": maturity_mismatch,
        "gapMonthsProjected": gap_months,
        "projectedGapHelp": (
            f"{gap_months} months have no 1098 or statement on file — projected from the last known "
            "statement using the loan's rate and payment. Upload a recent statement to replace projected "
            "months with reported figures."
        ) if gap_months > 0 else None,
        "warnings": warnings,
    }


def _loan_metric_rows(prop: Any) -> Dict[str, Dict[str, Any]]:
    engine = build_property_engine(prop)
    today = date.today()
    rows: Dict[str, Dict[str, Any]] = {}
    for loan in getattr(prop, "loans", []) or []:
        loan_id = str(getattr(loan, "id", "") or "")
        if not loan_id:
            continue
        balance = float(engine.balance_today(loan) or 0)
        original = float(getattr(loan, "original_amount", 0) or 0)
        payment = float(getattr(loan, "monthly_payment", 0) or 0)
        rate = float(getattr(loan, "interest_rate", 0) or 0)
        latest_interest = round(balance * (rate / 100 / 12), 2) if balance and rate else float(getattr(loan, "interest_due", 0) or 0)
        latest_principal = max(payment - latest_interest, 0.0) if payment else float(getattr(loan, "principal_due", 0) or 0)
        schedule = engine.build_schedule(loan)
        interest_to_date = sum(row.interest for row in schedule if row.month <= today)
        rows[loan_id] = {
            "balance": metric_dto(
                metric_key=f"loan:{loan_id}:balance",
                label="Balance",
                value=balance,
                source="CALCULATED",
                formula="Current balance from reported loan balance or amortization schedule",
                inputs=[_input("Balance", balance)],
                computation=format_currency(balance),
                positive_is_good=False,
            ),
            "originalAmount": metric_dto(
                metric_key=f"loan:{loan_id}:originalAmount",
                label="Original",
                value=original,
                source="MANUAL",
                formula="Original loan amount entered for this loan",
                inputs=[_input("Original amount", original)],
                computation=format_currency(original),
                positive_is_good=False,
            ),
            "paymentMonthly": metric_dto(
                metric_key=f"loan:{loan_id}:paymentMonthly",
                label="Payment / mo",
                value=payment,
                period="mo",
                source="MANUAL",
                formula="Monthly payment entered for this loan",
                inputs=[_input("Monthly payment", payment)],
                computation=format_currency(payment),
                positive_is_good=False,
            ),
            "rate": metric_dto(
                metric_key=f"loan:{loan_id}:rate",
                label="Rate",
                value=rate,
                unit="interestRate",
                source="MANUAL",
                formula="Interest rate entered for this loan",
                inputs=[_input("Interest rate", rate, "interestRate")],
                computation=format_interest_rate(rate),
                positive_is_good=False,
            ),
            "latestPrincipal": metric_dto(
                metric_key=f"loan:{loan_id}:latestPrincipal",
                label="Latest principal",
                value=latest_principal,
                period="mo",
                source="CALCULATED",
                formula="Latest modeled monthly principal amount",
                inputs=[_input("Monthly payment", payment), _input("Latest interest", latest_interest)],
                computation=f"{format_currency(payment)} − {format_currency(latest_interest)}",
            ),
            "latestInterest": metric_dto(
                metric_key=f"loan:{loan_id}:latestInterest",
                label="Latest interest",
                value=latest_interest,
                period="mo",
                source="CALCULATED",
                formula="Current balance × monthly interest rate",
                inputs=[_input("Balance", balance), _input("Rate", rate, "interestRate")],
                computation=None,
                positive_is_good=False,
            ),
            "interestToDate": metric_dto(
                metric_key=f"loan:{loan_id}:interestToDate",
                label="Interest to Date",
                value=interest_to_date,
                source="CALCULATED",
                formula="Accumulated amortization interest through the as-of date",
                inputs=[_input("Interest to date", interest_to_date)],
                computation=format_currency(interest_to_date),
                positive_is_good=False,
            ),
            "status": _loan_status_metadata(loan, balance, schedule, today),
        }
    return rows


def build_property_metric_vault(
    prop: Any,
    metrics: Dict[str, Any],
    summary_metrics: Optional[Dict[str, Any]] = None,
    legacy_metrics: Optional[Dict[str, Any]] = None,
    yearly: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    summary = summary_metrics or {}
    market_value = float(getattr(prop, "market_value", 0) or 0)
    purchase_price = float(getattr(prop, "purchase_price", 0) or 0)
    down_payment = float(getattr(prop, "down_payment", 0) or 0)
    loan_balance = float(metrics.get("total_loan_balance", 0) or 0)
    equity = float(metrics.get("equity", market_value - loan_balance) or 0)
    ltv = (loan_balance / market_value * 100) if market_value else None
    monthly_cost = float(summary.get("monthly_cost_to_own") or ((metrics.get("monthly_mortgage", 0) or 0) + (metrics.get("monthly_expenses", 0) or 0)))
    monthly_rent = 0.0 if str(getattr(prop, "usage_type", "") or "").lower() == "primary" else float(getattr(prop, "monthly_rent", 0) or 0)
    noi = float(summary.get("noi", summary.get("annual_noi", metrics.get("annual_noi", 0))) or 0)
    cash_flow = float(summary.get("annual_cash_flow", metrics.get("annual_cash_flow", 0)) or 0)
    income = float(summary.get("effective_gross_income", summary.get("annual_rent", 0)) or 0)
    operating_expenses = float(summary.get("operating_expenses", (metrics.get("monthly_expenses", 0) or 0) * 12) or 0)
    annual_debt_service = float(summary.get("annual_debt_service", metrics.get("annual_debt_service", 0)) or 0)
    depreciation = float(summary.get("depreciation", metrics.get("annual_depreciation", 0)) or 0)
    taxable_income = float(summary.get("taxable_income", income - operating_expenses - float(summary.get("mortgage_interest", 0) or 0) - depreciation) or 0)
    loan_summary = _loan_summary(prop)
    loan_metrics = _loan_metric_rows(prop)

    market_source = getattr(prop, "market_value_source", None) or "manual"

    metric_map = {
        "purchasePrice": metric_dto(
            metric_key="purchasePrice",
            label="Purchase Price",
            value=purchase_price,
            source="MANUAL",
            formula="Entered purchase price",
            inputs=[_input("Purchase price", purchase_price)],
            computation=format_currency(purchase_price),
        ),
        "downPayment": metric_dto(
            metric_key="downPayment",
            label="Down Payment",
            value=down_payment,
            source="MANUAL",
            formula="Entered down payment",
            inputs=[_input("Down payment", down_payment)],
            computation=format_currency(down_payment),
        ),
        "marketValue": metric_dto(
            metric_key="marketValue",
            label="Market Value",
            value=market_value,
            source=market_source,
            formula="Manual market value entered by user" if _source(market_source) == "MANUAL" else "Current market value",
            inputs=[_input("Market value", market_value)],
            computation=format_currency(market_value),
        ),
        "loanBalance": metric_dto(
            metric_key="loanBalance",
            label="Loan Balance",
            value=loan_balance,
            source="CALCULATED",
            formula="Sum of active loan balances",
            inputs=[_input("Loan balance", loan_balance)],
            computation=format_currency(loan_balance),
            positive_is_good=False,
        ),
        "ltv": metric_dto(
            metric_key="ltv",
            label="LTV",
            value=ltv,
            unit="percent",
            source="CALCULATED",
            formula="Loan balance ÷ market value",
            inputs=[_input("Loan balance", loan_balance), _input("Market value", market_value)],
            computation=f"{format_currency(loan_balance)} ÷ {format_currency(market_value)}" if market_value else None,
            positive_is_good=False,
        ),
        "equity": metric_dto(
            metric_key="equity",
            label="Equity",
            value=equity,
            source="CALCULATED",
            formula="Market value − loan balance",
            inputs=[_input("Market value", market_value), _input("Loan balance", loan_balance)],
            computation=f"{format_currency(market_value)} − {format_currency(loan_balance)}",
        ),
        "monthlyCostToOwn": metric_dto(
            metric_key="monthlyCostToOwn",
            label="Monthly Cost to Own",
            value=monthly_cost,
            period="mo",
            source="CALCULATED",
            formula="Monthly debt service + monthly operating expenses",
            inputs=[
                _input("Monthly debt service", metrics.get("monthly_mortgage", 0) or 0),
                _input("Monthly operating expenses", metrics.get("monthly_expenses", 0) or 0),
            ],
            computation=f"{format_currency(metrics.get('monthly_mortgage', 0) or 0)} + {format_currency(metrics.get('monthly_expenses', 0) or 0)}",
            positive_is_good=False,
        ),
        "rentPerMonth": metric_dto(
            metric_key="rentPerMonth",
            label="Monthly Rent",
            value=monthly_rent,
            period="mo",
            source="MANUAL",
            formula="Resolved monthly rent",
            inputs=[_input("Monthly rent", monthly_rent)],
            computation=format_currency(monthly_rent),
        ),
        "noi": metric_dto(
            metric_key="noi",
            label="NOI",
            value=noi,
            period="yr",
            source="CALCULATED",
            formula="Effective gross income − operating expenses",
            inputs=[
                _input("Effective gross income", summary.get("effective_gross_income", 0) or 0),
                _input("Operating expenses", summary.get("operating_expenses", metrics.get("monthly_expenses", 0) * 12) or 0),
            ],
            computation=None,
        ),
        "annualCashFlow": metric_dto(
            metric_key="annualCashFlow",
            label="Annual Cash Flow",
            value=cash_flow,
            period="yr",
            source="CALCULATED",
            formula="NOI − annual debt service",
            inputs=[
                _input("NOI", noi),
                _input("Annual debt service", summary.get("annual_debt_service", metrics.get("annual_debt_service", 0)) or 0),
            ],
            computation=None,
        ),
        "effectiveGrossIncome": metric_dto(
            metric_key="effectiveGrossIncome",
            label="Income",
            value=income,
            period="yr",
            source="CALCULATED",
            formula="Resolved annual rental income",
            inputs=[_input("Income", income)],
            computation=format_currency(income),
        ),
        "operatingExpenses": metric_dto(
            metric_key="operatingExpenses",
            label="Operating Expenses",
            value=operating_expenses,
            period="yr",
            source="CALCULATED",
            formula="Property tax + insurance + HOA + maintenance + management + utilities + capex reserve",
            inputs=[_input("Operating expenses", operating_expenses)],
            computation=format_currency(operating_expenses),
            positive_is_good=False,
        ),
        "annualDebtService": metric_dto(
            metric_key="annualDebtService",
            label="Debt Service",
            value=annual_debt_service,
            period="yr",
            source="CALCULATED",
            formula="Annual principal and interest across active loans",
            inputs=[_input("Annual debt service", annual_debt_service)],
            computation=format_currency(annual_debt_service),
            positive_is_good=False,
        ),
        "depreciation": metric_dto(
            metric_key="depreciation",
            label="Depreciation",
            value=depreciation,
            period="yr",
            source="CALCULATED",
            formula="Depreciation engine amount for the selected tax year",
            inputs=[_input("Depreciation", depreciation)],
            computation=format_currency(depreciation),
            positive_is_good=False,
        ),
        "suspendedLosses": metric_dto(
            metric_key="suspendedLosses",
            label="Suspended Losses",
            value=float(summary.get("suspended_losses", 0) or 0),
            period="yr",
            source="CALCULATED",
            formula="Passive losses suspended for the year",
            inputs=[_input("Suspended losses", float(summary.get("suspended_losses", 0) or 0))],
            computation=format_currency(float(summary.get("suspended_losses", 0) or 0)),
            positive_is_good=False,
        ),
        "taxableIncome": metric_dto(
            metric_key="taxableIncome",
            label="Net Tax P&L",
            value=taxable_income,
            period="yr",
            source="CALCULATED",
            formula="Rental income − operating expenses − mortgage interest − depreciation",
            inputs=[
                _input("Rental income", income),
                _input("Operating expenses", operating_expenses),
                _input("Mortgage interest", float(summary.get("mortgage_interest", 0) or 0)),
                _input("Depreciation", depreciation),
            ],
            computation=None,
        ),
        "loanTotalBalance": metric_dto(
            metric_key="loanTotalBalance",
            label="Total Balance",
            value=loan_summary["totalBalance"],
            source="CALCULATED",
            formula="Sum of active loan balances",
            inputs=[_input("Active loan balances", loan_summary["totalBalance"])],
            computation=format_currency(loan_summary["totalBalance"]),
            positive_is_good=False,
        ),
        "loanTotalOriginal": metric_dto(
            metric_key="loanTotalOriginal",
            label="Total Loan",
            value=loan_summary["totalOriginal"],
            source="CALCULATED",
            formula="Sum of active original loan amounts",
            inputs=[_input("Original loan amounts", loan_summary["totalOriginal"])],
            computation=format_currency(loan_summary["totalOriginal"]),
            positive_is_good=False,
        ),
        "loanInterestToDate": metric_dto(
            metric_key="loanInterestToDate",
            label="Interest to Date",
            value=loan_summary["interestToDate"],
            source="CALCULATED",
            formula="Interest accumulated through the as-of date across active loans",
            inputs=[_input("Interest to date", loan_summary["interestToDate"])],
            computation=format_currency(loan_summary["interestToDate"]),
            positive_is_good=False,
        ),
        "loanPrincipalPaidToDate": metric_dto(
            metric_key="loanPrincipalPaidToDate",
            label="Paid to Date",
            value=loan_summary["principalPaidToDate"],
            source="CALCULATED",
            formula="Original principal minus backend-resolved current balance for each active loan",
            inputs=[_input("Principal paid", loan_summary["principalPaidToDate"])],
            computation=format_currency(loan_summary["principalPaidToDate"]),
            positive_is_good=True,
        ),
        "loanCount": {
            "metricKey": "loanCount",
            "label": "Loan Count",
            "value": loan_summary["totalCount"],
            "displayValue": str(loan_summary["totalCount"]),
            "fullDisplayValue": str(loan_summary["totalCount"]),
            "unit": "count",
            "period": None,
            "source": "CALCULATED",
            "status": "complete",
            "tone": "neutral",
            "formula": "Count of open and closed loan records",
            "inputs": [],
            "computation": str(loan_summary["totalCount"]),
            "lastUpdated": date.today().isoformat(),
        },
        "loanInterestRateSummary": {
            "metricKey": "loanInterestRateSummary",
            "label": "Interest",
            "value": None,
            "displayValue": loan_summary["rateDisplay"],
            "fullDisplayValue": loan_summary["rateDisplay"],
            "unit": "interestRate",
            "period": None,
            "source": "CALCULATED",
            "status": loan_summary["balanceCheck"]["status"],
            "tone": "neutral",
            "formula": "Single loan shows rate and type; multiple loans show min–max rate range.",
            "inputs": [],
            "computation": loan_summary["rateDisplay"],
            "lastUpdated": date.today().isoformat(),
            "subtitle": loan_summary["rateTypeDisplay"],
        },
    }

    legacy_specs = {
        "monthlyCashFlow": ("Monthly Cash Flow", "currency"),
        "annualCashFlow": ("Annual Cash Flow", "currency"),
        "monthlyCostToOwn": ("Monthly Cost to Own", "currency"),
        "noi": ("NOI", "currency"),
        "annualDebtService": ("Annual Debt Service", "currency"),
        "capRate": ("Cap Rate", "percent"),
        "dscr": ("DSCR", "ratio"),
        "cashOnCashReturn": ("Cash-on-Cash Return", "percent"),
        "loanToValue": ("LTV", "percent"),
        "totalReturnYtd": ("Total Return YTD", "currency"),
        "taxableIncome": ("Taxable Income", "currency"),
        "rentPerMonth": ("Monthly Rent", "currency"),
    }
    for key, (label, unit) in legacy_specs.items():
        normalized = _legacy_metric_dto(key, label, (legacy_metrics or {}).get(key), unit)
        if normalized:
            metric_map[key] = normalized

    yearly_rows = [_yearly_display_row(row, market_value) for row in (yearly or [])]
    latest_year = yearly_rows[-1] if yearly_rows else {}
    return_on_equity = (latest_year.get("totalReturn", 0) / equity * 100) if equity else None
    if latest_year:
        metric_map["performanceCashFlow"] = metric_dto(
            metric_key="performanceCashFlow",
            label="Cash Flow / yr",
            value=latest_year.get("cashFlow"),
            period="yr",
            source=latest_year.get("source", "CALCULATED"),
            formula="Annual income − operating expenses − debt service",
            inputs=[
                _input("Income", latest_year.get("income")),
                _input("Operating expenses", latest_year.get("operatingExpenses")),
                _input("Debt service", latest_year.get("debtService")),
            ],
            computation=None,
        )
        metric_map["performancePrincipalPaydown"] = metric_dto(
            metric_key="performancePrincipalPaydown",
            label="Principal Paydown / yr",
            value=latest_year.get("principalPaid"),
            period="yr",
            source=latest_year.get("source", "CALCULATED"),
            formula="Principal paid during the latest modeled year",
            inputs=[_input("Principal paid", latest_year.get("principalPaid"))],
            computation=latest_year.get("principalPaidDisplay"),
        )
        metric_map["annualDepreciation"] = metric_dto(
            metric_key="annualDepreciation",
            label="Depreciation / yr",
            value=latest_year.get("depreciation"),
            period="yr",
            source=latest_year.get("source", "CALCULATED"),
            formula="Depreciation for the latest modeled year",
            inputs=[_input("Depreciation", latest_year.get("depreciation"))],
            computation=latest_year.get("depreciationDisplay"),
            positive_is_good=False,
        )
        metric_map["returnOnEquity"] = metric_dto(
            metric_key="returnOnEquity",
            label="Return on Equity",
            value=return_on_equity,
            unit="percent",
            source="CALCULATED",
            formula="Total return ÷ equity",
            inputs=[_input("Total return", latest_year.get("totalReturn")), _input("Equity", equity)],
            computation=f"{latest_year.get('totalReturnDisplay')} ÷ {format_currency(equity)}" if equity else None,
        )

    metric_map["totalDebt"] = metric_map["loanBalance"]
    metric_map["loanToValue"] = metric_map.get("loanToValue") or metric_map["ltv"]

    return {
        "propertyId": getattr(prop, "id", None),
        "asOfDate": date.today().isoformat(),
        "schemaVersion": 1,
        "metrics": metric_map,
        "charts": {
            "equityStory": _equity_story(prop, market_value, loan_balance),
        },
        "yearlyMetrics": yearly_rows,
        "loanSummary": loan_summary,
        "loanMetrics": loan_metrics,
    }
