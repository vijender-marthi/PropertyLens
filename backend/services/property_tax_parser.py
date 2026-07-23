"""Structured parser for county property-tax documents converted by MarkItDown."""
from __future__ import annotations

import hashlib
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from services.document_conversion import ConvertedDocument

PARSER_NAME = "property-tax-markitdown"
PARSER_VERSION = "1.1.0"
MONEY = Decimal("0.01")


def _decimal(value: str | None) -> Decimal | None:
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", value)
    if not cleaned or cleaned in {"-", "."}:
        return None
    try:
        return Decimal(cleaned).quantize(MONEY, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return None


def _iso_date(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value.strip().replace(",", ""))
    for fmt in ("%B %d %Y", "%b %d %Y", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(cleaned, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _search(pattern: str, text: str, flags: int = re.I | re.S) -> str | None:
    match = re.search(pattern, text, flags)
    return match.group(1).strip() if match else None


def _section(text: str, start: str, end: str | None = None) -> str:
    start_match = re.search(start, text, re.I)
    if not start_match:
        return ""
    tail = text[start_match.end():]
    if end:
        end_match = re.search(end, tail, re.I)
        if end_match:
            tail = tail[:end_match.start()]
    return tail


def _money_strings(text: str) -> list[str]:
    return re.findall(r"\$\s*([\d,]+\.\d{2})", text)


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


def classify_property_tax_document(converted: ConvertedDocument) -> dict[str, Any]:
    text = converted.text
    fiscal = bool(re.search(r"For Fiscal Year Beginning.+?and Ending", text, re.I | re.S))
    supplemental = bool(re.search(r"\bSupplemental Property Tax (?:Statement|Bill)\b", text, re.I))
    regular = bool(re.search(r"\bSecured Property Tax Statement\b", text, re.I))
    billed_total = bool(re.search(r"\bTotal Amount Billed\b", text, re.I))
    parcel = bool(re.search(r"(?:Parcel|APN)\s*(?:No\.?|Number|#)?", text, re.I))
    score = (0.45 if supplemental else 0) + (0.35 if regular else 0) + (0.30 if fiscal else 0) + (0.15 if parcel else 0)
    score += 0.10 if billed_total else 0
    score += 0.05 if re.search(r"CHANGE OF (?:OWNERSHIP|NEW CONSTRUCTION)", text, re.I) else 0
    document_type = "supplemental_property_tax_bill" if supplemental and fiscal else "property_tax_bill"
    reasons = [name for name, present in {
        "supplemental statement language": supplemental,
        "secured property-tax statement language": regular,
        "total amount billed": billed_total,
        "authoritative fiscal-year range": fiscal,
        "parcel identity": parcel,
        "ownership or construction event": bool(re.search(r"CHANGE OF (?:OWNERSHIP|NEW CONSTRUCTION)", text, re.I)),
    }.items() if present]
    return {
        "supported": score >= 0.65,
        "document_category": "property_tax",
        "document_type": document_type,
        "confidence": round(min(score, 0.99), 2),
        "classification_reasons": reasons,
        "signals": {
            "supplemental": supplemental,
            "regular_secured": regular,
            "billed_total": billed_total,
            "fiscal_range": fiscal,
            "parcel": parcel,
        },
    }


def parse_property_tax_document(converted: ConvertedDocument) -> dict[str, Any]:
    text = converted.text.replace("\u00a0", " ")
    classification = classify_property_tax_document(converted)
    if not classification["supported"]:
        raise ValueError("This PDF is not a supported property-tax bill")

    fiscal_match = re.search(
        r"For Fiscal Year Beginning\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+and Ending\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})",
        text,
        re.I,
    )
    if not fiscal_match:
        raise ValueError("Authoritative fiscal-year range was not found")
    fiscal_start = _iso_date(fiscal_match.group(1))
    fiscal_end = _iso_date(fiscal_match.group(2))
    if not fiscal_start or not fiscal_end:
        raise ValueError("Fiscal-year dates could not be normalized")

    parcel = _search(r"Parcel\s*(?:No\.?|Number|#)?\s*[:#]?\s*([0-9-]{5,})", text)
    tracer = _search(r"Tracer\s*(?:No\.?|Number|#)?\s*[:#]?\s*([0-9-]{5,})", text)
    tra = _search(r"(?:TRA|Tax Rate Area)\s*(?:No\.?|Number|#)?\s*[:#]?\s*([0-9-]{3,})", text)
    address = _search(r"(?:Location of Property|Property Location)\s*:?\s*(?:\n+\s*)?([^\n|]+)", text)
    if not address:
        address = _search(r"Location\s*[:#]?\s*([^\n|]+)", text)
    address = re.sub(r"\s+", " ", address or "").strip(" |-:") or None

    event_type = None
    event_date = None
    event_match = re.search(
        r"CHANGE\s+OF\s+(OWNERSHIP|NEW\s+CONSTRUCTION).*?([A-Za-z]+\s+\d{1,2},?\s+\d{4})",
        text, re.I | re.S)
    if event_match:
        event_name = re.sub(r"\s+", "_", event_match.group(1).upper())
        event_type = f"CHANGE_OF_{event_name}"
        event_date = _iso_date(event_match.group(2))
    else:
        # MarkItDown can reorder cells in the bill's event table as
        # "CHANGE OF APRIL | OWNERSHIP | 12, 2019".
        split_event = re.search(
            r"CHANGE\s+OF\s+([A-Za-z]+).*?(OWNERSHIP|NEW\s+CONSTRUCTION).*?(\d{1,2},?\s+\d{4})",
            text, re.I | re.S)
        if split_event:
            event_name = re.sub(r"\s+", "_", split_event.group(2).upper())
            event_type = f"CHANGE_OF_{event_name}"
            event_date = _iso_date(f"{split_event.group(1)} {split_event.group(3)}")

    value_section = _section(text, r"SUPPLEMENTAL VALUE", r"TAX CALCULATION")
    values: dict[str, dict[str, Decimal | None]] = {}
    for label in ("LAND", "IMPROVEMENTS", "TOTAL"):
        match = re.search(
            rf"(?:^|\n)[^\n|]*\b{label}\b[^\n]*?\$?\s*([\d,]+(?:\.\d{{2}})?)\s+\$?\s*([\d,]+(?:\.\d{{2}})?)\s+\$?\s*([\d,]+(?:\.\d{{2}})?)",
            value_section,
            re.I,
        )
        if match:
            values[label.lower()] = {
                "new_assessed_value": _decimal(match.group(1)),
                "prior_assessed_value": _decimal(match.group(2)),
                "supplemental_assessment": _decimal(match.group(3)),
            }

    rate_match = re.search(r"TOTAL\s+AD\s+VALOREM[^\n]*?([\d.]+)\s*%", text, re.I)
    total_rate = Decimal(rate_match.group(1)) if rate_match else None
    tax_section = _section(text, r"Tax Computation Worksheet", r"(?:Messages|IMPORTANT MESSAGES)")
    percentage_values = [Decimal(v) for v in re.findall(r"([\d.]+)\s*%", tax_section)]
    proration = next((v for v in percentage_values if v <= Decimal("100") and v != total_rate), None)
    due_values = [_decimal(v) for v in _money_strings(tax_section)]
    due_values = [v for v in due_values if v is not None]
    tax_line = re.search(
        r"[\d.]+\s*%\s*\$\s*([\d,]+\.\d{2})\s+[\d.]+\s*%\s*\$\s*([\d,]+\.\d{2})",
        tax_section)
    parsed_tax_before_proration = _decimal(tax_line.group(1)) if tax_line else None
    total_due_match = re.search(r"TOTAL\s+AMOUNT\s+DUE[^$]*\$\s*([\d,]+\.\d{2})", text, re.I | re.S)
    billed_section = _section(text, r"First Installment", r"Tax-Rate Breakdown")
    billed_values = [_decimal(value) for value in _money_strings(billed_section)]
    billed_values = [value for value in billed_values if value is not None]
    total_due = _decimal(total_due_match.group(1)) if total_due_match else (
        billed_values[0] if billed_values else (due_values[-1] if due_values else None)
    )

    installment_section = (
        _section(text, r"This supplemental property tax bill is IN ADDITION TO", r"TAX-RATE BREAKDOWN")
        if classification["document_type"].startswith("supplemental")
        else billed_section
    )
    installment_amounts = [_decimal(v) for v in _money_strings(installment_section)]
    installment_amounts = [v for v in installment_amounts if v is not None]
    if total_due and installment_amounts and installment_amounts[0] == total_due:
        installment_amounts = installment_amounts[1:]
    paid_dates = [_iso_date(v) for v in re.findall(r"PAID\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})", installment_section, re.I)]
    installments = []
    for index, amount in enumerate(installment_amounts[:2]):
        paid_date = paid_dates[index] if index < len(paid_dates) else None
        installments.append({
            "installment": index + 1,
            "amount": amount,
            "due_date": None,
            "paid_date": paid_date,
            "payment_date": paid_date,
            "status": "paid" if paid_date else "due",
        })

    agencies = []
    rate_section = _section(
        text,
        r"TAX-RATE BREAKDOWN",
        r"SUPPLEMENTAL VALUE" if classification["document_type"].startswith("supplemental")
        else r"Fixed Charges and/or Special Assessments",
    )
    for line in rate_section.splitlines():
        match = re.search(
            r"^\s*\|?\s*([^|$]+?)\s*\|.*?([\d.]+)\s*%.*?\$\s*([\d,]+\.\d{2})",
            line)
        if match:
            agencies.append({
                "agency": re.sub(r"\s+", " ", match.group(1)).strip(),
                "rate_percent": Decimal(match.group(2)),
                "amount": _decimal(match.group(3)),
            })

    ad_valorem_match = re.search(
        r"TOTAL\s+AD\s+VALOREM[^\n]*?\$\s*([\d,]+\.\d{2})", text, re.I)
    fixed_charges_match = re.search(
        r"Total Fixed Charges and/or Special Assessments[^\n]*?\$\s*([\d,]+\.\d{2})", text, re.I)
    total_ad_valorem = _decimal(ad_valorem_match.group(1)) if ad_valorem_match else None
    total_fixed_charges = _decimal(fixed_charges_match.group(1)) if fixed_charges_match else None

    assessment = values.get("total", {}).get("supplemental_assessment")
    tax_amount = None
    if assessment is not None and total_rate is not None:
        tax_amount = (assessment * total_rate / Decimal("100")).quantize(MONEY, rounding=ROUND_HALF_UP)
    tax_amount = parsed_tax_before_proration or tax_amount

    fiscal_label = f"{fiscal_start[:4]}-{fiscal_end[:4]}"
    issuer = "Alameda County Treasurer-Tax Collector" if re.search(r"ALAMEDA COUNTY", text, re.I) else None
    identity_key = "|".join([
        classification["document_type"], fiscal_start, fiscal_end, parcel or "", tracer or "",
        format(total_due or Decimal("0"), ".2f"),
    ]).upper()
    related_event_key = "|".join([parcel or "", event_type or "", event_date or ""]).upper()

    extraction_warnings = list(converted.warnings)
    if not installments:
        extraction_warnings.append("Installment table could not be reconstructed")
    if not agencies:
        extraction_warnings.append("Tax-rate table could not be reconstructed")
    field_confidences = {
        "fiscal_period": 0.99,
        "property_address": 0.98 if address else 0.0,
        "parcel_number": 0.99 if parcel else 0.0,
        "tracer_number": 0.99 if tracer else 0.0,
        "total_amount_billed": 0.99 if total_due is not None else 0.0,
        "installments": 0.97 if len(installments) == 2 else 0.4 if installments else 0.0,
        "assessment": (
            0.97 if assessment is not None
            else 0.99 if classification["document_type"] == "property_tax_bill"
            else 0.0
        ),
    }
    assessment_schema = {
        "land_new_value": values.get("land", {}).get("new_assessed_value"),
        "land_roll_value": values.get("land", {}).get("prior_assessed_value"),
        "land_supplemental_amount": values.get("land", {}).get("supplemental_assessment"),
        "improvement_new_value": values.get("improvements", {}).get("new_assessed_value"),
        "improvement_roll_value": values.get("improvements", {}).get("prior_assessed_value"),
        "improvement_supplemental_amount": values.get("improvements", {}).get("supplemental_assessment"),
        "total_new_value": values.get("total", {}).get("new_assessed_value"),
        "total_roll_value": values.get("total", {}).get("prior_assessed_value"),
        "gross_assessment": assessment,
        "net_assessment": assessment,
        "supplemental_assessment": assessment,
    }
    result = {
        "parser_name": PARSER_NAME,
        "parser_version": PARSER_VERSION,
        "classification": classification,
        "document_type": classification["document_type"],
        "tax_type": "SUPPLEMENTAL" if classification["document_type"].startswith("supplemental") else "REGULAR",
        "issuer": issuer,
        "issuer_details": {
            "county": "Alameda" if issuer else None,
            "agency_name": issuer,
            "state": "CA" if issuer else None,
        },
        "property": {
            "raw_address": address,
            "normalized_address": address.upper() if address else None,
            "parcel_number": parcel,
            "parcel_comparison_key": re.sub(r"\D", "", parcel or "") or None,
            "tracer_number": tracer,
            "tax_rate_area": tra,
        },
        "property_address": address,
        "parcel_number": parcel,
        "tracer_number": tracer,
        "tax_rate_area": tra,
        "fiscal_year_label": fiscal_label,
        "fiscal_period_start": fiscal_start,
        "fiscal_period_end": fiscal_end,
        "statement_year": int(fiscal_start[:4]),
        "period": {
            "fiscal_year_label": fiscal_label,
            "fiscal_year_start": fiscal_start,
            "fiscal_year_end": fiscal_end,
            "tax_year": int(fiscal_start[:4]),
        },
        "event_type": event_type,
        "event_date": event_date,
        "event": {"event_type": event_type.lower() if event_type else None, "event_date": event_date},
        "assessment_values": values,
        "assessment": assessment_schema,
        "supplemental_assessment": assessment,
        "total_tax_rate_percent": total_rate,
        "tax_before_proration": tax_amount,
        "proration_percent": proration,
        "total_amount_billed": total_due,
        "annual_property_tax": total_due,
        "total_ad_valorem_tax": total_ad_valorem,
        "total_fixed_charges": total_fixed_charges,
        "tax_calculation": {
            "total_tax_rate_percent": total_rate,
            "tax_amount_before_proration": tax_amount,
            "proration_factor_percent": proration,
            "total_amount_due": total_due,
            "total_amount_billed": total_due,
        },
        "installments": installments,
        "agency_rates": agencies,
        "taxing_agencies": agencies,
        "payment_status": "paid" if installments and all(i["status"] == "paid" for i in installments) else "unpaid",
        "identity_key": hashlib.sha256(identity_key.encode()).hexdigest(),
        "related_event_key": hashlib.sha256(related_event_key.encode()).hexdigest() if related_event_key.strip("|") else None,
        "conversion": converted.metadata(),
        "extraction": {
            "parser_name": PARSER_NAME,
            "parser_version": PARSER_VERSION,
            "confidence": min(field_confidences.values()) if field_confidences else 0.0,
            "warnings": extraction_warnings,
            "field_confidences": field_confidences,
            "source_pages": {},
        },
    }
    return _json_value(result)


def validate_property_tax_document(data: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    checks: list[dict[str, Any]] = []
    total = _decimal(data.get("total_amount_billed"))
    installments = [_decimal(row.get("amount")) for row in data.get("installments", [])]
    installments = [value for value in installments if value is not None]
    installment_sum = sum(installments, Decimal("0")).quantize(MONEY)
    if total is not None and installments and abs(total - installment_sum) > MONEY:
        errors.append("Installments do not reconcile to the total amount billed")
    if total is not None and installments:
        difference = abs(total - installment_sum)
        checks.append({
            "name": "installments_equal_total",
            "status": "passed" if difference <= MONEY else "failed",
            "difference": format(difference, ".2f"),
        })

    values = data.get("assessment_values") or {}
    land = _decimal((values.get("land") or {}).get("supplemental_assessment"))
    improvements = _decimal((values.get("improvements") or {}).get("supplemental_assessment"))
    assessment_total = _decimal((values.get("total") or {}).get("supplemental_assessment"))
    if land is not None and improvements is not None and assessment_total is not None:
        difference = abs((land + improvements) - assessment_total)
        if difference > MONEY:
            errors.append("Assessment components do not reconcile to the supplemental assessment")
        checks.append({
            "name": "assessment_components_equal_total",
            "status": "passed" if difference <= MONEY else "failed",
            "difference": format(difference, ".2f"),
        })

    assessment = _decimal(data.get("supplemental_assessment"))
    rate = data.get("total_tax_rate_percent")
    before_proration = _decimal(data.get("tax_before_proration"))
    if assessment is not None and rate is not None and before_proration is not None:
        expected = (assessment * Decimal(str(rate)) / Decimal("100")).quantize(MONEY, rounding=ROUND_HALF_UP)
        if abs(expected - before_proration) > MONEY:
            warnings.append("Assessment multiplied by the tax rate differs from the parsed tax amount")
    proration = data.get("proration_percent")
    if before_proration is not None and proration is not None and total is not None:
        expected_due = (
            before_proration * Decimal(str(proration)) / Decimal("100")
        ).quantize(MONEY, rounding=ROUND_HALF_UP)
        difference = abs(expected_due - total)
        if difference > Decimal("0.02"):
            errors.append("Prorated tax does not reconcile to the total amount billed")
        checks.append({
            "name": "prorated_tax_equals_total",
            "status": "passed" if difference <= Decimal("0.02") else "failed",
            "difference": format(difference, ".2f"),
        })

    agency_rows = [
        _decimal(row.get("amount")) for row in data.get("agency_rates", [])
        if not str(row.get("agency") or "").upper().startswith(("TOTAL", "GROSS"))
    ]
    agency_rows = [value for value in agency_rows if value is not None]
    agency_sum = sum(agency_rows, Decimal("0")).quantize(MONEY)
    total_ad_valorem = _decimal(data.get("total_ad_valorem_tax"))
    agency_target = total_ad_valorem or total
    if agency_target is not None and agency_rows and abs(agency_sum - agency_target) > Decimal("0.02"):
        errors.append("Agency tax amounts do not reconcile to the ad valorem tax total")
    if agency_target is not None and agency_rows:
        difference = abs(agency_sum - agency_target)
        checks.append({
            "name": "agency_amounts_equal_ad_valorem_total",
            "status": "passed" if difference <= Decimal("0.02") else "failed",
            "difference": format(difference, ".2f"),
        })

    fixed_charges = _decimal(data.get("total_fixed_charges"))
    if total is not None and total_ad_valorem is not None and fixed_charges is not None:
        difference = abs((total_ad_valorem + fixed_charges) - total)
        if difference > Decimal("0.02"):
            errors.append("Ad valorem tax and fixed charges do not reconcile to the total amount billed")
        checks.append({
            "name": "ad_valorem_plus_fixed_charges_equal_total",
            "status": "passed" if difference <= Decimal("0.02") else "failed",
            "difference": format(difference, ".2f"),
        })

    if not data.get("property_address"):
        errors.append("Property address was not extracted")
    if not data.get("parcel_number"):
        warnings.append("Parcel number was not extracted")
    if not data.get("tracer_number"):
        warnings.append("Tracer number was not extracted")
    return {
        "valid": not errors,
        "is_valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "check_values": {
            "installment_sum": format(installment_sum, ".2f") if installments else None,
            "total_amount_billed": data.get("total_amount_billed"),
            "agency_sum": format(agency_sum, ".2f") if agency_rows else None,
        },
    }
