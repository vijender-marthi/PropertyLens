from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from services.formatters import format_currency, format_number, format_percent
from services.property_engine import build_property_engine
from services.annual_usage_engine import annual_usage_by_year


def _num(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _year(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(str(value)[:4])
    except (TypeError, ValueError):
        return None


def _load_json(value: Any) -> Dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value) or {}
    except (TypeError, ValueError):
        return {}


def _disc_delta(a: Optional[float], b: Optional[float], *, min_abs: float = 1.0, pct: float = 0.05) -> Optional[float]:
    if a is None or b is None:
        return None
    delta = round(a - b, 2)
    base = max(abs(a), abs(b), 1.0)
    if abs(delta) < min_abs and abs(delta) / base < pct:
        return None
    return delta


def _days_in_year(year: int) -> int:
    return 366 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 365


def _display(value: Any, *, kind: str = "currency") -> Dict[str, Any]:
    if value is None:
        return {"value": None, "display": "Not available"}
    if isinstance(value, str):
        return {"value": value, "display": value}
    if kind == "percent":
        return {"value": value, "display": format_percent(value)}
    if kind == "number":
        return {"value": value, "display": format_number(value)}
    return {"value": value, "display": format_currency(value)}


def _delta_display(delta: Optional[float], *, kind: str = "currency") -> Dict[str, Any]:
    if delta is None:
        return {"value": None, "display": "Not applicable", "direction": "not_applicable"}
    direction = "equal"
    if delta > 0:
        direction = "higher"
    elif delta < 0:
        direction = "lower"
    return {
        "value": round(delta, 2),
        "display": _display(abs(delta), kind=kind)["display"],
        "direction": direction,
    }


def _status(pass_: bool, severity_key: str) -> Dict[str, str]:
    if pass_:
        return {"key": "passed", "label": "Passed"}
    return {"key": "failed" if severity_key == "critical" else "warning", "label": "Failed" if severity_key == "critical" else "Warning"}


def _severity(key: str) -> Dict[str, Any]:
    labels = {"critical": "Critical", "warning": "Warning", "info": "Info"}
    ranks = {"critical": 1, "warning": 2, "info": 3}
    return {"key": key, "label": labels.get(key, "Info"), "rank": ranks.get(key, 3)}


def _issue(
    *,
    code: str,
    title: str,
    description: str,
    category_key: str,
    category_label: str,
    pass_: bool,
    severity_key: str,
    primary_label: str,
    primary_value: Any,
    secondary_label: str,
    secondary_value: Any,
    delta: Optional[float],
    summary: str,
    why: str,
    actions: Optional[List[Dict[str, Any]]] = None,
    source: Optional[Dict[str, Any]] = None,
    year: Optional[int] = None,
    priority: int = 100,
    value_kind: str = "currency",
    provenance: Optional[List[Dict[str, Any]]] = None,
    technical: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    status = _status(pass_, severity_key)
    severity = _severity("info" if pass_ else severity_key)
    primary = _display(primary_value, kind=value_kind)
    secondary = _display(secondary_value, kind=value_kind)
    delta_dto = _delta_display(delta, kind=value_kind)
    return {
        "id": f"{code.lower().replace('.', '-')}-{year or 'all'}",
        "code": code,
        "title": title,
        "description": description,
        "status": status,
        "severity": severity,
        "category": {"key": category_key, "label": category_label},
        "year": year,
        "summary": summary,
        "comparison": {
            "primaryLabel": primary_label,
            "primaryValue": primary,
            "secondaryLabel": secondary_label,
            "secondaryValue": secondary,
            "delta": delta_dto,
            "statusLabel": status["label"],
        },
        "comparisonRows": [
            {
                "id": "main",
                "label": title,
                "primaryValue": primary,
                "secondaryValue": secondary,
                "delta": delta_dto,
            }
        ],
        "whyItMatters": why,
        "recommendedActions": actions or [],
        "source": source,
        "confidence": {"key": "high", "label": "High", "explanation": "Calculated by the backend verification engine from current property inputs."},
        "provenance": provenance or [{"id": "engine", "label": "Backend verification engine", "sourceType": "System Calculated"}],
        "technicalDetails": technical or [
            {"key": "check_id", "label": "Check ID", "displayValue": code},
            {"key": "tolerance", "label": "Tolerance", "displayValue": "$1 unless otherwise noted"},
        ],
        "sortKeys": {
            "priority": priority,
            "absoluteDelta": abs(delta) if delta is not None else None,
            "year": year,
            "yearAsc": year,
            "code": code,
        },
    }


def _counts(options: Iterable[Dict[str, Any]], key_path: str) -> List[Dict[str, Any]]:
    counts: Dict[str, Dict[str, Any]] = {}
    for issue in options:
        value = issue
        for part in key_path.split("."):
            value = value.get(part, {}) if isinstance(value, dict) else {}
        key = value.get("key") if isinstance(value, dict) else None
        label = value.get("label") if isinstance(value, dict) else None
        if not key:
            continue
        counts.setdefault(key, {"key": key, "label": label or key.title(), "count": 0, "order": value.get("rank", 99)})
        counts[key]["count"] += 1
    return sorted(counts.values(), key=lambda item: (item.get("order", 99), item["label"]))


def _plain_issue_title(issue: Dict[str, Any]) -> str:
    code = str(issue.get("code") or "")
    title = str(issue.get("title") or "")
    if code == "A2":
        return "Loan balance is shown two different ways"
    if code == "B2":
        return "Monthly and annual cash flow do not match"
    if code == "R1":
        return "Total return does not match its supporting values"
    if code.startswith("SRC.tax."):
        year = issue.get("year")
        return f"{year} property tax values disagree" if year else "Property tax values disagree"
    if code.startswith("SRC.interest."):
        year = issue.get("year")
        return f"{year} mortgage interest values disagree" if year else "Mortgage interest values disagree"
    if code.startswith("SRC.days."):
        return "Rental days need review"
    if code.startswith("SRC.depreciation."):
        return "Depreciation values disagree"
    if code.startswith("DOC."):
        return "A supporting document needs review"
    if "loan" in title.lower() and ("balance" in title.lower() or "invariant" in title.lower()):
        return "Your loan balance does not add up"
    return title.replace(" ties ", " matches ").replace(" equals ", " matches ")


def _issue_group(issue: Dict[str, Any]) -> str:
    code = str(issue.get("code") or "")
    status = issue.get("status", {}).get("key")
    severity = issue.get("severity", {}).get("key")
    category = issue.get("category", {}).get("key")
    if status == "passed":
        return "looks_good"
    if code.startswith("DOC.") or category == "documents":
        return "missing_documents"
    if severity == "critical":
        return "must_fix"
    return "review"


def _route_for_issue(prop: Any, issue: Dict[str, Any]) -> Dict[str, Any]:
    tab_key = (issue.get("source") or {}).get("tabKey")
    label = (issue.get("source") or {}).get("label")
    if not tab_key:
        category = issue.get("category", {}).get("key")
        tab_key = "documents" if category == "documents" else "loans" if category == "loans" else "summary"
    action_labels = {
        "loans": "Open Loans",
        "documents": "Upload document",
        "usage": "Open Usage",
        "taxes": "Open Taxes",
        "depreciation": "Open Depreciation",
        "summary": "Open Summary",
    }
    return {
        "label": action_labels.get(tab_key, label or "Open details"),
        "route": f"/properties/{getattr(prop, 'id', '')}",
        "tabKey": tab_key,
    }


def _recommended_steps(issue: Dict[str, Any]) -> List[str]:
    tab_key = (issue.get("source") or {}).get("tabKey")
    category = issue.get("category", {}).get("key")
    if tab_key == "loans" or category == "loans":
        return [
            "Open the Loans tab",
            "Compare the loan terms with your latest mortgage statement",
            "Correct the value that does not match",
        ]
    if tab_key == "documents" or category == "documents":
        return [
            "Open the Documents tab",
            "Upload the requested supporting document",
            "Re-check Data Health after the document is processed",
        ]
    if tab_key == "usage":
        return [
            "Open the Usage tab",
            "Review rental and personal-use days",
            "Correct the period or upload the source document",
        ]
    if tab_key == "taxes":
        return [
            "Open the Taxes tab",
            "Compare the value with the filed Schedule E or source document",
            "Correct the source record that does not match",
        ]
    return [
        "Open the related property section",
        "Compare the displayed value with your source document",
        "Correct the value that does not match",
    ]


def _customer_issue_text(issue: Dict[str, Any], group: str, title: str) -> Dict[str, str]:
    category = issue.get("category", {}).get("key")
    if group == "looks_good":
        return {
            "summary": "This area checked automatically and no issue was found.",
            "shortExplanation": "No action is needed right now.",
            "whyItMatters": "Verified data helps keep property reports and recommendations reliable.",
        }
    if group == "missing_documents":
        return {
            "summary": "A supporting document is missing or needs review.",
            "shortExplanation": "Upload the document so projected figures can be replaced with sourced values.",
            "whyItMatters": "Missing documents can reduce confidence in reports, taxes, and property metrics.",
        }
    if category == "loans":
        return {
            "summary": "Loan values from related property records do not agree.",
            "shortExplanation": "Review the latest loan statement and update the value that does not match.",
            "whyItMatters": "Loan differences may make equity, LTV, payoff timing, and interest totals inaccurate.",
        }
    if category in {"taxes", "source_comparison"}:
        return {
            "summary": "Values from two source records do not agree.",
            "shortExplanation": "Compare the source records and correct the value that does not match.",
            "whyItMatters": "Source mismatches can affect tax reporting, operating expenses, NOI, and cash flow.",
        }
    if category == "cash_flow":
        return {
            "summary": "Cash-flow values do not reconcile with their supporting values.",
            "shortExplanation": "Review the income, expense, and debt-service values used for this property.",
            "whyItMatters": "Cash-flow differences can affect performance reports and recommendations.",
        }
    return {
        "summary": title,
        "shortExplanation": "Review the related property data and correct the value that does not match.",
        "whyItMatters": "This can affect the accuracy of property metrics and reports.",
    }


def _customer_issue(prop: Any, issue: Dict[str, Any]) -> Dict[str, Any]:
    comparison = issue.get("comparison") or {}
    group = _issue_group(issue)
    severity = "critical" if group == "must_fix" else "warning" if group == "review" else "info" if group == "missing_documents" else "ok"
    title = _plain_issue_title(issue)
    text = _customer_issue_text(issue, group, title)
    action = _route_for_issue(prop, issue)
    technical = {
        "ruleCode": issue.get("code"),
        "assertion": issue.get("title"),
        "category": issue.get("category"),
        "comparison": comparison,
        "technicalDetails": issue.get("technicalDetails") or [],
        "provenance": issue.get("provenance") or [],
    }
    return {
        "id": issue.get("id"),
        "category": issue.get("category", {}).get("key"),
        "severity": severity,
        "group": group,
        "title": title,
        "summary": text["summary"],
        "shortExplanation": text["shortExplanation"],
        "whyItMatters": text["whyItMatters"],
        "shouldBe": comparison.get("primaryValue"),
        "actually": comparison.get("secondaryValue"),
        "difference": comparison.get("delta"),
        "impact": comparison.get("delta", {}).get("display") if comparison.get("delta") else None,
        "status": "Checked automatically" if group == "looks_good" else "Needs attention",
        "recommendedSteps": _recommended_steps(issue),
        "primaryAction": action,
        "estimatedMinutes": 2 if action.get("tabKey") in {"loans", "documents"} else 5,
        "confidence": "high",
        "confidenceLabel": "High",
        "confidenceExplanation": "We found this issue by comparing validated property data sources.",
        "technical": technical,
    }


def _build_data_health(prop: Any, issues: List[Dict[str, Any]], *, generated_at: str) -> Dict[str, Any]:
    customer_issues = [_customer_issue(prop, issue) for issue in issues]
    failed = [issue for issue in customer_issues if issue["group"] != "looks_good"]
    must_fix = [issue for issue in customer_issues if issue["group"] == "must_fix"]
    review = [issue for issue in customer_issues if issue["group"] == "review"]
    missing = [issue for issue in customer_issues if issue["group"] == "missing_documents"]
    looks_good = [issue for issue in customer_issues if issue["group"] == "looks_good"]
    total = len(customer_issues)
    passed = len(looks_good)
    score_value = round((passed / total) * 100) if total else 100
    source_counts = {"reported": 0, "calculated": total, "projected": 0}
    root = (must_fix or review or missing or [None])[0]
    fastest_fix = None
    if root:
        related_count = sum(1 for issue in failed if issue.get("category") == root.get("category")) - 1
        fastest_fix = {
            "rootCauseIssueId": root["id"],
            "relatedIssueCount": max(related_count, 0),
            "fastestFixLabel": root["primaryAction"]["label"],
            "summary": f"Fastest fix: {root['primaryAction']['label']}. Correcting it may clear {max(related_count, 0)} related issue{'s' if related_count != 1 else ''}.",
            "primaryAction": root["primaryAction"],
        }
    return {
        "title": "Data Health",
        "subtitle": "See what is complete, what needs review, and what is missing.",
        "summary": {
            "score": {"value": score_value, "display": f"{score_value}%"},
            "status": "Looks good" if not failed else "Needs attention",
            "checksPassed": {"value": passed, "display": f"{passed} of {total} checks passed"},
            "mustFixCount": {"value": len(must_fix), "display": str(len(must_fix))},
            "reviewCount": {"value": len(review), "display": str(len(review))},
            "missingDocumentCount": {"value": len(missing), "display": str(len(missing))},
            "lastChecked": generated_at,
            "sourcesChecked": {
                **source_counts,
                "display": f"{source_counts['reported']} reported · {source_counts['calculated']} calculated · {source_counts['projected']} projected",
            },
        },
        "fastestFix": fastest_fix,
        "groups": [
            {"key": "must_fix", "label": "Must fix", "issues": must_fix},
            {"key": "review", "label": "Review", "issues": review},
            {"key": "missing_documents", "label": "Missing documents", "issues": missing},
            {"key": "looks_good", "label": "Looks good", "issues": looks_good},
        ],
    }


def _verification_sources(prop: Any, lifetime_summary: Dict[str, Any]) -> Dict[str, Any]:
    tax_by_year: Dict[int, Any] = {}
    for entry in getattr(prop, "tax_entries", []) or []:
        year = _year(getattr(entry, "tax_year", None))
        if year is not None:
            current = tax_by_year.get(year)
            if not current or int(getattr(entry, "id", 0) or 0) >= int(getattr(current, "id", 0) or 0):
                tax_by_year[year] = entry

    lease_by_year: Dict[int, Dict[str, Any]] = {}
    for lease in getattr(prop, "rental_periods", []) or []:
        start = _year(getattr(lease, "start_year", None))
        end = _year(getattr(lease, "end_year", None)) or start
        rent = _num(getattr(lease, "monthly_rent", None)) or 0
        if not start:
            continue
        for year in range(start, end + 1):
            start_month = int(getattr(lease, "start_month", 1) or 1) if year == start else 1
            end_month = int(getattr(lease, "end_month", 12) or 12) if year == end else 12
            months = max(0, end_month - start_month + 1)
            row = lease_by_year.setdefault(year, {"income": 0.0, "occupied_months": 0})
            row["income"] += rent * months
            row["occupied_months"] += months

    annual_usage = annual_usage_by_year(prop)
    for year, row in lease_by_year.items():
        row["income"] = round(row["income"], 2)
        row["lease_days"] = (annual_usage.get(year) or {}).get("leaseCoveredDays")

    doc_interest: Dict[int, float] = {}
    doc_balance: Dict[int, float] = {}
    doc_tax: Dict[int, float] = {}
    statement_interest: Dict[int, List[float]] = {}
    statement_balance: Dict[int, List[float]] = {}
    doc_keys: Dict[str, int] = {}
    duplicate_1098: List[Dict[str, Any]] = []

    for doc in getattr(prop, "documents", []) or []:
        data = _load_json(getattr(doc, "extracted_data", None))
        year = _year(data.get("tax_year") or data.get("statement_year") or getattr(doc, "statement_year", None) or data.get("statement_date"))
        if year is None:
            continue
        category = str(getattr(doc, "doc_category", "") or "").lower()
        account = getattr(doc, "loan_account_number", None) or data.get("account_number") or "unknown"
        if category == "1098":
            key = f"{year}:{account}"
            doc_keys[key] = doc_keys.get(key, 0) + 1
            if doc_keys[key] > 1:
                duplicate_1098.append({"year": year, "filename": getattr(doc, "original_filename", None) or getattr(doc, "filename", None), "account": account})
            interest = _num(data.get("mortgage_interest"))
            balance = _num(data.get("current_balance") or data.get("outstanding_principal"))
            if interest is not None:
                doc_interest[year] = round(doc_interest.get(year, 0.0) + interest, 2)
            if balance is not None:
                doc_balance[year] = round(doc_balance.get(year, 0.0) + balance, 2)
            tax = _num(data.get("property_tax_amount") or data.get("taxes_paid"))
            if tax is not None:
                doc_tax[year] = max(doc_tax.get(year, 0.0), round(tax, 2))
        elif category == "property_tax":
            tax = _num(data.get("property_tax_amount") or data.get("taxes_paid"))
            if tax is not None:
                doc_tax[year] = max(doc_tax.get(year, 0.0), round(tax, 2))
        elif category == "mortgage_statement":
            interest = _num(data.get("interest") or data.get("interest_paid") or data.get("interest_due"))
            balance = _num(data.get("balance") or data.get("current_balance") or data.get("ending_balance"))
            if interest is not None:
                statement_interest.setdefault(year, []).append(interest)
            if balance is not None:
                statement_balance.setdefault(year, []).append(balance)

    statement_annual = {
        year: round(sum(values) / max(len(values), 1) * 12, 2)
        for year, values in statement_interest.items()
        if values
    }
    statement_avg_balance = {
        year: round(sum(values) / max(len(values), 1), 2)
        for year, values in statement_balance.items()
        if values
    }

    return {
        "tax": tax_by_year,
        "leases": lease_by_year,
        "doc_interest": doc_interest,
        "doc_balance": doc_balance,
        "doc_tax": doc_tax,
        "statement_interest": statement_annual,
        "statement_balance": statement_avg_balance,
        "duplicate_1098": duplicate_1098,
        "yearly": {int(row.get("year")): row for row in lifetime_summary.get("yearly", []) or [] if row.get("year")},
    }


def _append_source_comparison_issues(prop: Any, lifetime_summary: Dict[str, Any], issues: List[Dict[str, Any]]) -> None:
    sources = _verification_sources(prop, lifetime_summary)
    all_years = sorted(set(sources["tax"]) | set(sources["leases"]) | set(sources["doc_interest"]) | set(sources["doc_tax"]) | set(sources["statement_interest"]) | set(sources["yearly"]))
    priority = 100

    for year in all_years:
        tax_entry = sources["tax"].get(year)
        lease = sources["leases"].get(year)
        yearly = sources["yearly"].get(year) or {}

        tax_rent = _num(getattr(tax_entry, "rents_received", None)) if tax_entry else None
        lease_rent = _num((lease or {}).get("income"))
        delta = _disc_delta(tax_rent, lease_rent, min_abs=100, pct=0.05)
        if delta is not None:
            issues.append(_issue(
                code=f"SRC.rent.{year}",
                title="Rental income differs across sources",
                description="Schedule E rental income and lease-derived income do not agree.",
                category_key="source_comparison",
                category_label="Source Comparison",
                pass_=False,
                severity_key="warning",
                primary_label="Schedule E rent",
                primary_value=tax_rent,
                secondary_label="Lease income",
                secondary_value=lease_rent,
                delta=delta,
                summary="The backend compared filed rental income to lease-derived income for the same year.",
                why="Rent mismatches can affect NOI, Schedule E taxable income, and return metrics.",
                source={"label": f"Open Usage {year}", "tabKey": "usage", "year": year},
                year=year,
                priority=priority,
            ))
            priority += 1

        days_rented = _num(getattr(tax_entry, "days_rented", None)) if tax_entry else None
        lease_days = _num((lease or {}).get("lease_days"))
        delta = _disc_delta(days_rented, lease_days, min_abs=3, pct=0.05)
        if delta is not None:
            issues.append(_issue(
                code=f"SRC.days.{year}",
                title="Rental days differ across sources",
                description="Schedule E fair rental days and lease-derived rental days do not agree.",
                category_key="usage",
                category_label="Usage",
                pass_=False,
                severity_key="warning",
                primary_label="Schedule E days",
                primary_value=days_rented,
                secondary_label="Lease days",
                secondary_value=lease_days,
                delta=delta,
                summary="The backend compared filed fair-rental days to lease coverage for the year.",
                why="Rental days drive mixed-use depreciation and tax treatment.",
                source={"label": f"Open Usage {year}", "tabKey": "usage", "year": year},
                year=year,
                priority=priority,
                value_kind="number",
            ))
            priority += 1

        tax_interest = _num(getattr(tax_entry, "mortgage_interest", None)) if tax_entry else None
        doc_interest = sources["doc_interest"].get(year)
        stmt_interest = sources["statement_interest"].get(year)
        compare_interest = doc_interest if doc_interest is not None else stmt_interest
        compare_label = "Form 1098 interest" if doc_interest is not None else "Statement annualized interest"
        delta = _disc_delta(tax_interest, compare_interest, min_abs=100, pct=0.05)
        if delta is not None:
            issues.append(_issue(
                code=f"SRC.interest.{year}",
                title="Mortgage interest differs across sources",
                description="Schedule E mortgage interest does not agree with uploaded interest sources.",
                category_key="taxes",
                category_label="Taxes",
                pass_=False,
                severity_key="warning",
                primary_label="Schedule E interest",
                primary_value=tax_interest,
                secondary_label=compare_label,
                secondary_value=compare_interest,
                delta=delta,
                summary="The backend compared filed mortgage interest against the best available uploaded source.",
                why="Mortgage-interest mismatches can change Schedule E taxable income and cash-flow explanations.",
                source={"label": f"Open Taxes {year}", "tabKey": "taxes", "year": year},
                year=year,
                priority=priority,
            ))
            priority += 1

        tax_property_tax = _num(getattr(tax_entry, "property_taxes", None)) if tax_entry else None
        doc_property_tax = sources["doc_tax"].get(year)
        delta = _disc_delta(tax_property_tax, doc_property_tax, min_abs=25, pct=0.05)
        if delta is not None:
            issues.append(_issue(
                code=f"SRC.property_tax.{year}",
                title="Property tax differs across sources",
                description="Schedule E property tax and uploaded property-tax sources do not agree.",
                category_key="taxes",
                category_label="Taxes",
                pass_=False,
                severity_key="warning",
                primary_label="Schedule E property tax",
                primary_value=tax_property_tax,
                secondary_label="Uploaded property tax",
                secondary_value=doc_property_tax,
                delta=delta,
                summary="The backend compared filed property tax to uploaded tax documents for the year.",
                why="Property-tax mismatches affect operating expenses, NOI, and taxable income.",
                source={"label": f"Open Taxes {year}", "tabKey": "taxes", "year": year},
                year=year,
                priority=priority,
            ))
            priority += 1

        tax_depr = _num(getattr(tax_entry, "depreciation", None)) if tax_entry else None
        model_depr = _num(yearly.get("depreciation"))
        delta = _disc_delta(tax_depr, model_depr, min_abs=100, pct=0.05)
        if delta is not None:
            issues.append(_issue(
                code=f"SRC.depreciation.{year}",
                title="Depreciation differs from model",
                description="Schedule E depreciation and backend model depreciation do not agree.",
                category_key="depreciation",
                category_label="Depreciation",
                pass_=False,
                severity_key="warning",
                primary_label="Schedule E depreciation",
                primary_value=tax_depr,
                secondary_label="Backend model depreciation",
                secondary_value=model_depr,
                delta=delta,
                summary="The backend compared filed depreciation against the modeled depreciation for the same year.",
                why="Depreciation mismatches affect taxable income, accumulated depreciation, and recapture estimates.",
                source={"label": f"Open Depreciation {year}", "tabKey": "depreciation", "year": year},
                year=year,
                priority=priority,
            ))
            priority += 1

    for duplicate in sources["duplicate_1098"]:
        year = duplicate.get("year")
        issues.append(_issue(
            code=f"DOC.1098.duplicate.{year}",
            title="Duplicate Form 1098 detected",
            description="Multiple Form 1098 uploads appear to represent the same loan account and tax year.",
            category_key="documents",
            category_label="Documents",
            pass_=False,
            severity_key="warning",
            primary_label="Duplicate document",
            primary_value=duplicate.get("filename") or "Uploaded document",
            secondary_label="Account",
            secondary_value=duplicate.get("account") or "Unknown",
            delta=None,
            summary="The backend detected more than one 1098 for the same account and tax year.",
            why="Duplicate 1098s can double-count mortgage interest or loan balances if not deduplicated.",
            source={"label": "Open Documents", "tabKey": "documents", "year": year},
            year=year,
            priority=priority,
            value_kind="number",
            provenance=[{"id": "documents", "label": "Uploaded documents", "sourceType": "Uploaded Document"}],
        ))
        priority += 1


def build_property_verification_response(
    prop: Any,
    metrics: Dict[str, Any],
    lifetime_summary: Dict[str, Any],
    metric_vault: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    engine = build_property_engine(prop)
    summary = lifetime_summary.get("summary_metrics") or {}
    lifetime = lifetime_summary.get("lifetime") or {}
    vault_metrics = (metric_vault or {}).get("metrics") or {}
    issues: List[Dict[str, Any]] = []

    total_debt = float(metrics.get("total_loan_balance", 0) or 0)
    lifetime_balance = float(lifetime.get("current_loan_balance", 0) or 0)
    balance_delta = round(lifetime_balance - total_debt, 2)
    issues.append(_issue(
        code="A2",
        title="Single as-of loan balance",
        description="Lifetime current balance should match the total debt used by property metrics.",
        category_key="single_source",
        category_label="Single Source",
        pass_=abs(balance_delta) <= 1,
        severity_key="critical",
        primary_label="Lifetime engine",
        primary_value=lifetime_balance,
        secondary_label="Metric Vault total debt",
        secondary_value=total_debt,
        delta=balance_delta,
        summary="The backend compares the lifetime balance and Metric Vault total debt at the same as-of date.",
        why="Two current loan balances cause equity, LTV, payoff, and return metrics to disagree.",
        actions=[{"id": "open_loans", "label": "Review loans", "actionKey": "open_tab", "enabled": True}],
        source={"label": "Open Loans", "tabKey": "loans"},
        priority=10,
    ))

    noi = float(summary.get("noi", summary.get("annual_noi", 0)) or 0)
    income = float(summary.get("effective_gross_income", 0) or 0)
    opex = float(summary.get("operating_expenses", 0) or 0)
    noi_expected = round(income - opex, 2)
    noi_delta = round(noi - noi_expected, 2)
    issues.append(_issue(
        code="B1",
        title="NOI uses one operating-expense definition",
        description="NOI must equal effective gross income minus operating expenses.",
        category_key="cash_flow",
        category_label="Cash Flow",
        pass_=abs(noi_delta) <= 1,
        severity_key="critical",
        primary_label="NOI",
        primary_value=noi,
        secondary_label="Income minus operating expenses",
        secondary_value=noi_expected,
        delta=noi_delta,
        summary="The backend verifies that the NOI shown in cards, P&L, cap rate, and DSCR uses the same operating-expense value.",
        why="A second NOI path can make cap rate, DSCR, cash flow, and P&L contradict each other.",
        actions=[{"id": "open_summary", "label": "Review summary", "actionKey": "open_tab", "enabled": True}],
        source={"label": "Open Summary", "tabKey": "summary"},
        priority=20,
    ))

    annual_cash_flow = float(summary.get("annual_cash_flow", 0) or 0)
    monthly_cash_flow = float(summary.get("monthly_cash_flow", 0) or 0)
    cash_delta = round((monthly_cash_flow * 12) - annual_cash_flow, 2)
    issues.append(_issue(
        code="B2",
        title="Monthly cash flow ties to annual cash flow",
        description="Monthly cash flow multiplied by 12 must equal annual cash flow.",
        category_key="cash_flow",
        category_label="Cash Flow",
        pass_=abs(cash_delta) <= 2,
        severity_key="warning",
        primary_label="Monthly cash flow × 12",
        primary_value=monthly_cash_flow * 12,
        secondary_label="Annual cash flow",
        secondary_value=annual_cash_flow,
        delta=cash_delta,
        summary="The backend verifies monthly and annual cash-flow displays are two presentations of the same metric.",
        why="If monthly and annual cash flow drift, users cannot trust header, P&L, and return metrics.",
        source={"label": "Open Summary", "tabKey": "summary"},
        priority=30,
    ))

    total_return = vault_metrics.get("totalReturnYtd") or {}
    total_inputs = sum(float(item.get("value") or 0) for item in total_return.get("inputs") or [])
    total_value = float(total_return.get("value") or 0)
    total_delta = round(total_value - total_inputs, 2)
    issues.append(_issue(
        code="R1",
        title="Total return equals its listed inputs",
        description="Total return is additive and must equal the sum of the backend-provided input rows.",
        category_key="returns",
        category_label="Returns",
        pass_=abs(total_delta) <= 1,
        severity_key="critical",
        primary_label="Total return value",
        primary_value=total_value,
        secondary_label="Sum of inputs",
        secondary_value=total_inputs,
        delta=total_delta,
        summary="The backend checks that total return value, computation, and displayed inputs all come from one calculation.",
        why="This prevents impossible tooltips where the inputs add to one value but the card shows another.",
        source={"label": "Open Summary", "tabKey": "summary"},
        priority=40,
        provenance=[{"id": "metric_vault", "label": "Metric Vault totalReturnYtd", "sourceType": "System Calculated"}],
    ))

    for index, check in enumerate(engine.invariant_checks()):
        delta = check.get("delta")
        status = check.get("status")
        passed = status == "pass"
        code = f"L{index + 1}"
        issues.append(_issue(
            code=code,
            title=check.get("rule") or "Loan invariant",
            description="Loan amortization invariant returned by the backend engine.",
            category_key="loans",
            category_label="Loans",
            pass_=passed,
            severity_key="warning",
            primary_label="Actual",
            primary_value=delta,
            secondary_label="Expected",
            secondary_value=0 if delta is not None else None,
            delta=delta,
            summary="The backend loan engine verifies amortization inputs and balances for this loan.",
            why="Loan invariant failures can make balances, payoff timing, principal paid, and interest totals unreliable.",
            actions=[{"id": f"open_loan_{check.get('loan_id') or index}", "label": "Review loan", "actionKey": "open_tab", "enabled": True}],
            source={"label": "Open Loans", "tabKey": "loans", "entityId": str(check.get("loan_id") or "")},
            priority=50 + index,
            provenance=[{"id": f"loan_{check.get('loan_id') or index}", "label": check.get("name") or "Loan", "sourceType": "Backend amortization engine"}],
            technical=[{"key": "engine_status", "label": "Engine status", "displayValue": str(status or "unknown")}],
        ))

    _append_source_comparison_issues(prop, lifetime_summary, issues)

    issues = sorted(issues, key=lambda item: (item["sortKeys"]["priority"], item["code"]))
    total_checks = len(issues)
    passed_checks = sum(1 for issue in issues if issue["status"]["key"] == "passed")
    failed = [issue for issue in issues if issue["status"]["key"] in {"failed", "warning"}]
    critical_count = sum(1 for issue in failed if issue["severity"]["key"] == "critical")
    warning_count = sum(1 for issue in failed if issue["severity"]["key"] == "warning")
    score = round((passed_checks / total_checks) * 100) if total_checks else None
    generated_at = datetime.now(timezone.utc).isoformat()
    data_health = _build_data_health(prop, issues, generated_at=generated_at)

    return {
        "schemaVersion": "2026-07-verify-v1",
        "propertyId": str(getattr(prop, "id", "")),
        "verificationRunId": str(uuid4()),
        "generatedAt": generated_at,
        "freshness": {"key": "current", "label": "Current"},
        "summary": {
            "score": _display(score, kind="percent") if score is not None else _display(None, kind="percent"),
            "totalChecks": _display(total_checks, kind="number"),
            "passedChecks": _display(passed_checks, kind="number"),
            "discrepancyCount": _display(len(failed), kind="number"),
            "criticalCount": _display(critical_count, kind="number"),
            "warningCount": _display(warning_count, kind="number"),
            "reportedCount": _display(0, kind="number"),
            "calculatedCount": _display(total_checks, kind="number"),
            "approximateCount": _display(0, kind="number"),
            "projectedCount": _display(0, kind="number"),
        },
        "availableFilters": {
            "severities": [{"key": "all", "label": "All", "count": len(failed), "order": 0}, *_counts(failed, "severity")],
            "categories": [{"key": "all", "label": "All", "count": len(failed), "order": 0}, *_counts(issues, "category")],
            "statuses": [{"key": "active", "label": "Active", "count": len(failed), "order": 0}, *_counts(issues, "status")],
            "sortOptions": [
                {"key": "priority", "label": "Priority", "direction": "asc", "valueType": "number"},
                {"key": "absoluteDelta", "label": "Largest delta", "direction": "desc", "valueType": "number"},
                {"key": "year", "label": "Newest year", "direction": "desc", "valueType": "number"},
                {"key": "yearAsc", "label": "Oldest year", "direction": "asc", "valueType": "number"},
                {"key": "code", "label": "Verification code", "direction": "asc", "valueType": "string"},
            ],
        },
        "defaultSortKey": "priority",
        "dataHealth": data_health,
        "issues": issues,
    }
