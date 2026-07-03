"""Required-document checklist for a property.

Generates the expected document slots (one-time / annual / monthly), checks
each against uploaded documents and manually-entered data, and reports gaps.
Mirrors the structure the frontend renders directly, so the checklist logic
lives in exactly one place.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Optional

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _year_of(value) -> Optional[int]:
    if not value:
        return None
    m = re.search(r'(?:19|20)\d{2}', str(value))
    return int(m.group(0)) if m else None


def _parse_date(value) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m/%Y", "%Y-%m"):
        try:
            return datetime.strptime(str(value), fmt)
        except ValueError:
            continue
    return None


def _extracted(doc) -> dict:
    if not doc.extracted_data:
        return {}
    try:
        return json.loads(doc.extracted_data)
    except (TypeError, ValueError):
        return {}


def _doc_year(doc, data: dict) -> Optional[int]:
    dt = _parse_date(data.get("statement_date") or data.get("period_end") or doc.period_end)
    if dt:
        return dt.year
    return _year_of(doc.statement_year or data.get("statement_year") or data.get("tax_year"))


def _doc_month(doc, data: dict) -> Optional[int]:
    dt = _parse_date(
        data.get("statement_date") or data.get("period_end") or doc.period_end
        or data.get("period_start") or doc.period_start
    )
    return dt.month if dt else None


def _slot(key, label, cadence, status, source, detail, year=None, month=None, scope="property"):
    return {
        "key": key,
        "label": label,
        "cadence": cadence,   # one_time | annual | monthly
        "status": status,     # present | missing | expired
        "source": source,
        "detail": detail,
        "year": year,
        "month": month,
        "month_label": MONTH_ABBR[month - 1] if month else None,
        "scope": scope,       # property | portfolio
    }


def build_checklist(prop, docs: list, loans: list, tax_entries: list,
                     rental_periods: list, today: Optional[date] = None) -> dict:
    today = today or date.today()
    current_year, current_month = today.year, today.month

    purchase_dt = _parse_date(prop.purchase_date)
    purchase_year = purchase_dt.year if purchase_dt else (_year_of(prop.purchase_date) or current_year)
    purchase_month = purchase_dt.month if purchase_dt else 1

    by_category: dict[str, list] = {}
    for d in docs:
        by_category.setdefault(d.doc_category, []).append((d, _extracted(d)))

    def docs_of(category):
        return by_category.get(category, [])

    def year_doc(category, year):
        return next((d for d, data in docs_of(category) if _doc_year(d, data) == year), None)

    def month_doc(category, year, month):
        for d, data in docs_of(category):
            if _doc_year(d, data) == year and _doc_month(d, data) == month:
                return d
        return None

    def annual_status(year: int) -> str:
        return "expired" if year < current_year - 1 else "missing"

    def monthly_status(year: int, month: int) -> str:
        months_ago = (current_year - year) * 12 + (current_month - month)
        return "expired" if months_ago > 2 else "missing"

    required: list[dict] = []

    # ---------- ONE-TIME ----------
    has_closing = bool(docs_of("closing_statement"))
    manual_closing = bool(prop.purchase_price or prop.purchase_date or prop.closing_costs)
    required.append(_slot(
        "closing", "Settlement / Closing Statement (HUD-1)", "one_time",
        "present" if has_closing or manual_closing else "missing",
        "Document upload" if has_closing else "Manual/XLS property data" if manual_closing else "Not uploaded",
        "Settlement date, purchase price, total amount, and closing costs — sets cost basis.",
        year=purchase_year,
    ))

    has_deed = bool(docs_of("deed_title"))
    required.append(_slot(
        "deed", "Deed / Title", "one_time",
        "present" if has_deed else "missing",
        "Document upload" if has_deed else "Not uploaded",
        "Recorded deed establishing ownership and title.",
        year=purchase_year,
    ))

    loan_list = loans or []
    if loan_list:
        for loan in loan_list:
            disclosure_docs = docs_of("loan_disclosure")
            has_disclosure = (
                any((d.loan_account_number or data.get("account_number")) == loan.account_number
                    for d, data in disclosure_docs)
                if loan.account_number else bool(disclosure_docs)
            )
            manual_loan = bool(loan.original_amount or loan.interest_rate or loan.monthly_payment)
            required.append(_slot(
                f"loan-disclosure-{loan.id}",
                f"Loan Closing Disclosure ({loan.lender_name or 'Loan'})", "one_time",
                "present" if has_disclosure or manual_loan else "missing",
                "Document upload" if has_disclosure else "Manual/XLS loan data" if manual_loan else "Not uploaded",
                "Lender, product/type, term, rate, and origination terms.",
                year=_year_of(loan.origination_date) or purchase_year,
            ))
    else:
        required.append(_slot(
            "loan-disclosure", "Loan Closing Disclosure", "one_time", "missing",
            "Not uploaded",
            "Lender, product/type, term, rate, and origination terms. No loan on file yet.",
            year=purchase_year,
        ))

    has_basis = bool(prop.land_value or prop.construction_price)
    required.append(_slot(
        "basis-split", "Land vs. Building Basis Split", "one_time",
        "present" if has_basis else "missing",
        "Manual/XLS property data" if has_basis else "Not entered",
        "Land vs. building value split (appraisal or assessor) — drives depreciable basis.",
        year=purchase_year,
    ))

    # ---------- ANNUAL ----------
    last_complete_year = current_year - 1
    annual_years = sorted({
        y for y in range(min(purchase_year, last_complete_year), current_year + 1)
        if y >= purchase_year
    })

    tax_years_present = {e.tax_year for e in tax_entries}
    for year in annual_years:
        has_tax = year in tax_years_present
        required.append(_slot(
            f"tax-return-{year}", "Tax Return (1040 / Schedule E)", "annual",
            "present" if has_tax else annual_status(year),
            "Tax return import (common document)" if has_tax else "Not filed/uploaded",
            "Rental income, expenses, depreciation, and net income for the year.",
            year=year, scope="portfolio",
        ))

        for loan in (loan_list or [None]):
            label = f"Form 1098 ({loan.lender_name or 'Loan'})" if loan else "Form 1098"
            key = f"1098-{year}-{loan.id}" if loan else f"1098-{year}"
            d = year_doc("1098", year)
            has_1098 = d is not None
            required.append(_slot(
                key, label, "annual",
                "present" if has_1098 else annual_status(year),
                "Document upload" if has_1098 else "Not uploaded",
                "Mortgage interest, outstanding principal, and points paid for the year.",
                year=year,
            ))

        has_tax_bill = year_doc("property_tax", year) is not None
        manual_tax = bool(prop.property_tax) and year == last_complete_year
        required.append(_slot(
            f"property-tax-{year}", "Property Tax Bill", "annual",
            "present" if has_tax_bill or manual_tax else annual_status(year),
            "Document upload" if has_tax_bill else "Manual/XLS property data" if manual_tax else "Not uploaded",
            "Annual property tax assessment/payment for the year.",
            year=year,
        ))

        has_insurance = year_doc("insurance_declaration", year) is not None
        manual_insurance = bool(prop.insurance) and year == last_complete_year
        required.append(_slot(
            f"insurance-{year}", "Insurance Policy Declaration", "annual",
            "present" if has_insurance or manual_insurance else annual_status(year),
            "Document upload" if has_insurance else "Manual/XLS property data" if manual_insurance else "Not uploaded",
            "Homeowner/landlord insurance policy declaration page for the year.",
            year=year,
        ))

    # ---------- MONTHLY ----------
    # Capped to the last 24 months of ownership so the grid stays usable
    # for long-held properties.
    window_months = []
    y, m = purchase_year, purchase_month
    while (y, m) <= (current_year, current_month):
        window_months.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    window_months = window_months[-24:]

    def rent_roll_covers(year, month):
        for period in rental_periods:
            start = (period.start_year, period.start_month)
            end = (period.end_year or current_year, period.end_month or current_month)
            if start <= (year, month) <= end:
                return True
        return False

    for year, month in window_months:
        for loan in (loan_list or [None]):
            label = f"Mortgage Statement ({loan.lender_name or 'Loan'})" if loan else "Mortgage Statement"
            key = f"mortgage-{year}-{month}-{loan.id}" if loan else f"mortgage-{year}-{month}"
            d = month_doc("mortgage_statement", year, month)
            has_stmt = d is not None
            required.append(_slot(
                key, label, "monthly",
                "present" if has_stmt else ("missing" if not loan_list else monthly_status(year, month)),
                "Document upload" if has_stmt else "Not uploaded",
                "Balance, due date, rate, escrow, and YTD principal/interest.",
                year=year, month=month,
            ))

        has_rent = rent_roll_covers(year, month)
        required.append(_slot(
            f"rent-{year}-{month}", "Rent Roll / Income Statement", "monthly",
            "present" if has_rent else monthly_status(year, month),
            "Manual rental period" if has_rent else "Not entered",
            "Occupancy/rent coverage for the month.",
            year=year, month=month,
        ))

        d = month_doc("expense_receipt", year, month)
        has_expense = d is not None
        required.append(_slot(
            f"expense-{year}-{month}", "Operating Expense Receipts", "monthly",
            "present" if has_expense else monthly_status(year, month),
            "Document upload" if has_expense else "Not uploaded",
            "Receipts for repairs, supplies, and other deductible operating expenses.",
            year=year, month=month,
        ))

    present = [s for s in required if s["status"] == "present"]
    missing = [s for s in required if s["status"] in ("missing", "expired")]
    completion_pct = round(100 * len(present) / len(required), 1) if required else 100.0

    groups = {
        "one_time": [s for s in required if s["cadence"] == "one_time"],
        "annual": [s for s in required if s["cadence"] == "annual"],
        "monthly": [s for s in required if s["cadence"] == "monthly"],
    }

    return {
        "required": required,
        "present": present,
        "missing": missing,
        "completion_pct": completion_pct,
        "groups": groups,
    }
