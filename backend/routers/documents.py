import os
import json
import re
import uuid
from collections import defaultdict
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
import models
from services.snapshot_store import ensure_document_record_uuid
from services.property_setup_defaults import apply_rental_available_from_default, rental_available_before_purchase


def detect_duplicate_ids(doc_objects) -> set:
    """Return the IDs of documents that are duplicates.

    Two documents are flagged as duplicates when either:
      - they share identical file content (content_hash), regardless of
        filename, property, or category; or
      - they share the same (property_id, doc_category, statement_year,
        normalised loan_account_number) — different files covering the same
        statement period.
    Among each duplicate group, the document with the earliest upload_date is
    kept as the original; the rest are flagged.
    """
    def _dedupe_groups(groups: dict) -> set:
        ids: set = set()
        for group in groups.values():
            if len(group) < 2:
                continue
            ordered = sorted(group, key=lambda d: str(getattr(d, "upload_date", "") or ""))
            for dup in ordered[1:]:
                ids.add(dup.id)
        return ids

    content_groups: dict = defaultdict(list)
    for d in doc_objects:
        content_hash = getattr(d, "content_hash", None)
        if content_hash:
            content_groups[content_hash].append(d)

    metadata_groups: dict = defaultdict(list)
    for d in doc_objects:
        year = getattr(d, "statement_year", None)
        if not year:
            continue  # can't meaningfully de-dup without a year
        key = (
            getattr(d, "property_id", None),
            (getattr(d, "doc_category", None) or "").lower(),
            int(year),
            (getattr(d, "loan_account_number", None) or "").upper().strip(),
        )
        metadata_groups[key].append(d)

    return _dedupe_groups(content_groups) | _dedupe_groups(metadata_groups)
from database import get_db
from routers.auth import get_current_user, require_premium_user
from routers.properties import (
    EXPENSE_SOURCE_ESCROW_ESTIMATE,
    EXPENSE_SOURCE_MANUAL,
    EXPENSE_SOURCE_REPORTED,
    _annual_expense_notes_payload,
    _annual_expense_out,
    _one_month_before,
    _servicing_transfer_candidates,
    annual_expense_source_key,
    import_tax_return,
)
from services.document_parser import parse_document
from services.formatters import format_currency, format_interest_rate, format_percent
from services.document_config import (
    DOCUMENT_TYPE_CONFIG,
    config_as_dict,
    extraction_schema,
    get_document_config,
    mapped_loan_fields,
)

router = APIRouter(prefix="/api/documents", tags=["documents"])


class BatchDeleteRequest(BaseModel):
    ids: List[int]


class UploadAcceptRequest(BaseModel):
    pending_upload_id: str
    original_filename: Optional[str] = None
    property_id: Optional[int] = None
    loan_id: Optional[int] = None
    category: str = "auto"
    force: bool = False  # "Keep both" — bypass the duplicate check
    replace_document_id: Optional[int] = None  # "Replace" — delete this doc first
    apply_extracted: bool = True
    field_overrides: Dict[str, Any] = Field(default_factory=dict)


class SetupImportApplyRequest(BaseModel):
    property_id: int
    selected_property_fields: List[str] = []
    selected_purchase_price_components: Optional[List[str]] = None
    selected_loan_fields: List[str] = []
    confirm_address_match: bool = False


class LoanStatementApplyRequest(BaseModel):
    property_id: int
    loan_id: Optional[int] = None
    selected_loan_fields: List[str] = []
    address_override: bool = False
    confirm_account_mismatch: bool = False
    field_overrides: Dict[str, Any] = Field(default_factory=dict)


class ConsolidatedLoanDocumentsRequest(BaseModel):
    property_id: int
    document_ids: List[int]


class ExpenseFieldDocumentApplyRequest(BaseModel):
    property_id: int
    year: int
    field: str
    address_override: bool = False

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _discard_uploaded_source(path: Path) -> None:
    """Remove original uploaded file extracting durable data."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass

def _safe_extracted_data(document) -> dict:
    if not getattr(document, "extracted_data", None):
        return {}
    try:
        data = json.loads(document.extracted_data)
    except (TypeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _to_float_or_none(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _normalize_loan_document_extracted(category: str, extracted: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(extracted or {})
    if category == "1098":
        if data.get("box1_interest") is None and data.get("mortgage_interest") is not None:
            data["box1_interest"] = data.get("mortgage_interest")
        if data.get("box2_balance") is None and data.get("current_balance") is not None:
            data["box2_balance"] = data.get("current_balance")
        if data.get("mortgage_interest_display") is None and data.get("mortgage_interest") is not None:
            data["mortgage_interest_display"] = format_currency(data.get("mortgage_interest") or 0)
        if data.get("box1_interest_display") is None and data.get("box1_interest") is not None:
            data["box1_interest_display"] = format_currency(data.get("box1_interest") or 0)
        if data.get("box2_balance_display") is None and data.get("box2_balance") is not None:
            data["box2_balance_display"] = format_currency(data.get("box2_balance") or 0)
        if data.get("outstanding_principal_display") is None and data.get("current_balance") is not None:
            data["outstanding_principal_display"] = format_currency(data.get("current_balance") or 0)
    elif category == "mortgage_statement":
        if data.get("current_balance_display") is None and data.get("current_balance") is not None:
            data["current_balance_display"] = format_currency(data.get("current_balance") or 0)
    return data


def _apply_loan_document_overrides(category: str, extracted: Dict[str, Any], overrides: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    data = dict(extracted or {})
    applied_overrides: Dict[str, Any] = {}
    for key, value in (overrides or {}).items():
        if value in (None, ""):
            continue
        if key in {"box1_interest", "mortgage_interest", "interest_paid_ytd"}:
            amount = _to_float_or_none(value)
            if amount is not None:
                data["mortgage_interest"] = amount
                data["box1_interest"] = amount
                applied_overrides[key] = amount
        elif key in {"box2_balance", "current_balance"}:
            amount = _to_float_or_none(value)
            if amount is not None:
                data["current_balance"] = amount
                data["box2_balance"] = amount
                applied_overrides[key] = amount
        elif key in {"property_address", "property_city", "property_state", "property_zip"}:
            data[key] = str(value).strip()
            applied_overrides[key] = str(value).strip()
        else:
            data[key] = value
            applied_overrides[key] = value
    if applied_overrides:
        data["_manual_overrides"] = {
            **(data.get("_manual_overrides") or {}),
            **applied_overrides,
            "appliedAt": datetime.utcnow().isoformat(),
        }
    return _normalize_loan_document_extracted(category, data)


def _loan_document_required_fields(category: str, extracted: Dict[str, Any]) -> List[Dict[str, Any]]:
    specs = []
    if category == "1098":
        specs = [
            ("box1_interest", "Box 1 interest", extracted.get("box1_interest") or extracted.get("mortgage_interest"), "currency"),
            ("box2_balance", "Box 2 balance", extracted.get("box2_balance") or extracted.get("current_balance"), "currency"),
            ("property_address", "Property address", extracted.get("property_address"), "text"),
        ]
    elif category == "mortgage_statement":
        specs = [
            ("current_balance", "Current balance", extracted.get("current_balance"), "currency"),
            ("property_address", "Property address", extracted.get("property_address"), "text"),
        ]
    fields = []
    for key, label, value, field_type in specs:
        fields.append({
            "key": key,
            "label": label,
            "value": value if value is not None else "",
            "required": True,
            "type": field_type,
            "missing": value in (None, ""),
            "message": f"Couldn't read {label} — enter manually." if value in (None, "") else "",
        })
    return fields

def _document_list_item(document, duplicate_ids: set) -> dict:
    extracted = _safe_extracted_data(document)
    return {
        "id": document.id,
        "record_uuid": document.record_uuid,
        "property_id": document.property_id,
        "property_address": document.property.address if getattr(document, "property", None) else None,
        "original_filename": document.original_filename,
        "display_name": document.display_name or document.original_filename,
        "file_type": document.file_type,
        "doc_category": document.doc_category,
        "file_size": document.file_size,
        "extracted_data": extracted,
        "document_config": config_as_dict(document.doc_category),
        "extraction_schema": extraction_schema(document.doc_category, extracted),
        "loan_account_number": document.loan_account_number,
        "statement_year": document.statement_year,
        "period_type": document.period_type,
        "period_start": document.period_start,
        "period_end": document.period_end,
        "upload_date": document.upload_date,
        "has_markdown": bool(document.markdown_file),
        "is_duplicate": document.id in duplicate_ids,
    }


def _setup_field(
    extracted: Dict[str, Any],
    source_key: str,
    target_key: str,
    label: str,
    formatter: str = "text",
    confidence: float = 0.85,
) -> Optional[Dict[str, Any]]:
    value = extracted.get(source_key)
    if value is None or value == "":
        return None
    if formatter == "currency":
        display = format_currency(value)
    elif formatter == "date":
        display = _display_date(value)
    elif formatter == "percent":
        display = format_interest_rate(value)
    else:
        display = str(value)
    return {
        "targetKey": target_key,
        "sourceField": source_key,
        "sourceLabel": label,
        "label": label,
        "value": value,
        "display": display,
        "confidence": confidence,
    }


def _display_date(value: Any) -> str:
    text = str(value or "")
    try:
        parsed = datetime.fromisoformat(text[:10])
        return parsed.strftime("%b %d, %Y")
    except ValueError:
        return text


def _json_timestamp(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


STREET_SUFFIXES = {
    "STREET": "ST",
    "ST": "ST",
    "DRIVE": "DR",
    "DR": "DR",
    "ROAD": "RD",
    "RD": "RD",
    "LANE": "LN",
    "LN": "LN",
    "AVENUE": "AVE",
    "AVE": "AVE",
    "COURT": "CT",
    "CT": "CT",
    "BOULEVARD": "BLVD",
    "BLVD": "BLVD",
}

DIRECTIONS = {
    "NORTH": "N",
    "N": "N",
    "SOUTH": "S",
    "S": "S",
    "EAST": "E",
    "E": "E",
    "WEST": "W",
    "W": "W",
}

STATE_NAMES = {
    "ARIZONA": "AZ",
    "CALIFORNIA": "CA",
    "COLORADO": "CO",
    "FLORIDA": "FL",
    "NEW YORK": "NY",
    "TEXAS": "TX",
    "WASHINGTON": "WA",
}


def _address_tokenize(value: Any) -> List[str]:
    text = re.sub(r"[^A-Za-z0-9# ]+", " ", str(value or "").upper())
    text = re.sub(r"\s+", " ", text).strip()
    tokens = []
    for token in text.split():
        tokens.append(STREET_SUFFIXES.get(DIRECTIONS.get(token, token), DIRECTIONS.get(token, token)))
    return tokens


def _normalize_zip(value: Any) -> str:
    match = re.search(r"\d{5}", str(value or ""))
    return match.group(0) if match else ""


def _normalize_state(value: Any) -> str:
    text = re.sub(r"[^A-Za-z ]+", " ", str(value or "").upper()).strip()
    text = re.sub(r"\s+", " ", text)
    return STATE_NAMES.get(text, text)


def _normalize_city(value: Any) -> str:
    return " ".join(_address_tokenize(value))


def _address_parts(street: Any, city: Any, state: Any, zip_code: Any) -> Dict[str, str]:
    normalized_street = " ".join(_address_tokenize(street))
    normalized_city = _normalize_city(city)
    normalized_state = _normalize_state(state)
    normalized_zip = _normalize_zip(zip_code)
    return {
        "street": normalized_street,
        "city": normalized_city,
        "state": normalized_state,
        "zip": normalized_zip,
        "display": ", ".join(part for part in [normalized_street, normalized_city, f"{normalized_state} {normalized_zip}".strip()] if part),
    }


def _street_number(street: str) -> str:
    match = re.match(r"\s*(\d+)", street or "")
    return match.group(1) if match else ""


def _address_validation(prop: Optional[models.Property], extracted: Dict[str, Any]) -> Dict[str, Any]:
    property_address = {
        "street": getattr(prop, "address", None) if prop else None,
        "city": getattr(prop, "city", None) if prop else None,
        "state": getattr(prop, "state", None) if prop else None,
        "zip": getattr(prop, "zip_code", None) if prop else None,
    }
    document_address = {
        "street": extracted.get("property_address"),
        "city": extracted.get("property_city"),
        "state": extracted.get("property_state"),
        "zip": extracted.get("property_zip"),
    }
    normalized_property = _address_parts(
        property_address["street"],
        property_address["city"],
        property_address["state"],
        property_address["zip"],
    )
    normalized_document = _address_parts(
        document_address["street"],
        document_address["city"],
        document_address["state"],
        document_address["zip"],
    )
    required_property = [normalized_property["street"], normalized_property["city"], normalized_property["state"], normalized_property["zip"]]
    required_document = [normalized_document["street"], normalized_document["city"], normalized_document["state"], normalized_document["zip"]]
    property_has_any = any(required_property)
    property_has_all = all(required_property)
    document_has_any = any(required_document)
    document_has_all = all(required_document)
    field_results: Dict[str, str] = {}

    if not document_has_any:
        return {
            "status": "document_address_missing",
            "canPopulateFromDocument": False,
            "canContinue": False,
            "propertyAddress": property_address,
            "documentAddress": document_address,
            "normalizedPropertyAddress": normalized_property["display"],
            "normalizedDocumentAddress": normalized_document["display"],
            "matchScore": 0,
            "differences": ["Document address was not found."],
            "fieldResults": {key: "missing_document" for key in ["street", "city", "state", "zip"]},
        }

    if not property_has_any and document_has_all:
        return {
            "status": "property_address_empty",
            "canPopulateFromDocument": True,
            "canContinue": False,
            "propertyAddress": property_address,
            "documentAddress": document_address,
            "normalizedPropertyAddress": normalized_property["display"],
            "normalizedDocumentAddress": normalized_document["display"],
            "matchScore": 0,
            "differences": [],
            "fieldResults": {key: "missing_can_import" for key in ["street", "city", "state", "zip"]},
        }

    if not document_has_all:
        return {
            "status": "document_address_missing",
            "canPopulateFromDocument": False,
            "canContinue": False,
            "propertyAddress": property_address,
            "documentAddress": document_address,
            "normalizedPropertyAddress": normalized_property["display"],
            "normalizedDocumentAddress": normalized_document["display"],
            "matchScore": 0,
            "differences": ["Document address information is incomplete."],
            "fieldResults": {key: "missing_document" if not normalized_document[key] else "available" for key in ["street", "city", "state", "zip"]},
        }

    if not property_has_all:
        differences = []
        for key in ["street", "city", "state", "zip"]:
            if normalized_property[key] and normalized_property[key] != normalized_document[key]:
                differences.append(key)
                field_results[key] = "conflict"
            elif not normalized_property[key]:
                field_results[key] = "missing_can_import"
            else:
                field_results[key] = "match"
        if differences:
            status = "mismatch"
            can_populate = False
            can_continue = False
        else:
            status = "property_address_empty"
            can_populate = True
            can_continue = False
        return {
            "status": status,
            "canPopulateFromDocument": can_populate,
            "canContinue": can_continue,
            "propertyAddress": property_address,
            "documentAddress": document_address,
            "normalizedPropertyAddress": normalized_property["display"],
            "normalizedDocumentAddress": normalized_document["display"],
            "matchScore": 0,
            "differences": differences,
            "fieldResults": field_results,
        }

    property_display = normalized_property["display"]
    document_display = normalized_document["display"]
    score = round(SequenceMatcher(None, property_display, document_display).ratio(), 4)
    differences = []
    for key in ["street", "city", "state", "zip"]:
        if normalized_property[key] != normalized_document[key]:
            differences.append(key)
    same_number = _street_number(normalized_property["street"]) == _street_number(normalized_document["street"])
    same_city_state = normalized_property["city"] == normalized_document["city"] and normalized_property["state"] == normalized_document["state"]
    same_zip = normalized_property["zip"] == normalized_document["zip"]

    if not differences or (same_number and same_city_state and same_zip and score >= 0.95):
        status = "match"
    elif same_number and normalized_property["state"] == normalized_document["state"] and score >= 0.85:
        status = "possible_match"
    else:
        status = "mismatch"
    return {
        "status": status,
        "canPopulateFromDocument": False,
        "canContinue": status == "match",
        "propertyAddress": property_address,
        "documentAddress": document_address,
        "normalizedPropertyAddress": property_display,
        "normalizedDocumentAddress": document_display,
        "matchScore": score,
        "differences": differences,
        "fieldResults": {key: "match" if normalized_property[key] == normalized_document[key] else "conflict" for key in ["street", "city", "state", "zip"]},
    }


def _purchase_price_selection_payload(extracted: Dict[str, Any], setup_import_role: str = "closing_document") -> Optional[Dict[str, Any]]:
    sale_price = _to_float(extracted.get("sale_price") or extracted.get("purchase_price"))
    settlement_total = _to_float(extracted.get("settlement_total_amount"))

    components = []
    if sale_price:
        components.append({
            "id": "sale_price",
            "label": "Sale price",
            "value": round(sale_price, 2),
            "display": format_currency(sale_price),
            "selected": True,
            "sourceField": "purchase_price",
            "description": "Contract sale price from the settlement statement.",
        })
    if settlement_total and sale_price and round(settlement_total - sale_price, 2) != 0:
        adjustment_value = round(settlement_total - sale_price, 2)
        components.append({
            "id": "settlement_adjustment",
            "label": "Closing costs / settlement adjustment",
            "value": adjustment_value,
            "display": format_currency(adjustment_value),
            "selected": False,
            "sourceField": "settlement_purchase_price_adjustment",
            "description": "Shown for closing costs. It is not added to Purchase price.",
        })

    if not components:
        return None

    selected_total = round(sale_price or sum(item["value"] for item in components if item.get("selected")), 2)
    payload = {
        "targetKey": "purchase_price",
        "label": "Purchase price components",
        "components": components,
        "selectedTotal": selected_total,
        "selectedTotalDisplay": format_currency(selected_total),
    }
    if settlement_total:
        payload["settlementTotal"] = round(settlement_total, 2)
        payload["settlementTotalDisplay"] = format_currency(settlement_total)
    if extracted.get("settlement_debit_subtotal") is not None:
        payload["debitSubtotalDisplay"] = format_currency(extracted.get("settlement_debit_subtotal"))
    if extracted.get("settlement_due_to_buyer") is not None:
        payload["dueToBuyerDisplay"] = format_currency(extracted.get("settlement_due_to_buyer"))
    return payload


def _settlement_calculations_payload(extracted: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    for key, label in [
        ("settlement_debit_subtotal", "Buyer debit subtotal"),
        ("settlement_credit_subtotal", "Buyer credit subtotal"),
        ("settlement_due_to_buyer", "Due to buyer"),
        ("settlement_debit_total", "Buyer debit total"),
        ("settlement_credit_total", "Buyer credit total"),
        ("settlement_total_amount", "Final settlement total"),
        ("settlement_purchase_price_adjustment", "Settlement adjustment"),
    ]:
        if extracted.get(key) is not None:
            rows.append({
                "key": key,
                "label": label,
                "amount": round(_to_float(extracted.get(key)), 2),
                "display": format_currency(extracted.get(key)),
            })
    for item in extracted.get("settlement_line_items") or []:
        amount = item.get("amount")
        if amount is None:
            continue
        rows.append({
            "key": item.get("key") or item.get("label") or "line_item",
            "label": item.get("label") or item.get("key") or "Line item",
            "amount": round(_to_float(amount), 2),
            "display": format_currency(amount),
        })
    return rows


def _closing_setup_review_payload(document: models.Document, markdown: str = "") -> Dict[str, Any]:
    extracted = _safe_extracted_data(document)
    setup_import_role = extracted.get("setup_import_role") or extracted.get("_setup_import_role") or "closing_document"
    review_extracted = dict(extracted)
    current_value = extracted.get("settlement_total_amount") or extracted.get("purchase_price")
    settlement_total = _to_float(extracted.get("settlement_total_amount"))
    home_purchase_price = _to_float(extracted.get("sale_price") or extracted.get("purchase_price"))
    explicit_closing_costs = extracted.get("closing_costs")
    if home_purchase_price:
        review_extracted["purchase_price"] = round(home_purchase_price, 2)
    if settlement_total and home_purchase_price:
        review_extracted["settlement_purchase_price_adjustment"] = round(settlement_total - home_purchase_price, 2)
    if explicit_closing_costs is not None:
        review_extracted["closing_costs"] = explicit_closing_costs
    elif settlement_total and home_purchase_price:
        review_extracted["closing_costs"] = round(settlement_total - home_purchase_price, 2)
    if current_value is not None:
        review_extracted["settlement_current_value"] = current_value
    if extracted.get("purchase_date"):
        review_extracted["settlement_current_value_date"] = extracted.get("purchase_date")
    property_fields = [
        _setup_field(review_extracted, "property_address", "address", "Street address"),
        _setup_field(review_extracted, "property_city", "city", "City"),
        _setup_field(review_extracted, "property_state", "state", "State"),
        _setup_field(review_extracted, "property_zip", "zip_code", "ZIP"),
        _setup_field(review_extracted, "purchase_date", "purchase_date", "Purchase date", "date", 0.95),
        _setup_field(review_extracted, "purchase_price", "purchase_price", "Purchase price", "currency", 0.95),
        _setup_field(review_extracted, "settlement_current_value", "market_value", "Current value", "currency", 0.9),
        _setup_field(review_extracted, "settlement_current_value_date", "market_value_updated", "Valuation date", "date", 0.85),
        _setup_field(review_extracted, "down_payment", "down_payment", "Down payment", "currency", 0.88),
        _setup_field(review_extracted, "closing_costs", "closing_costs", "Closing costs", "currency", 0.84),
    ]
    property_fields = [field for field in property_fields if field]
    purchase_price_selection = _purchase_price_selection_payload(extracted, setup_import_role)
    settlement_calculations = _settlement_calculations_payload(extracted)

    original_amount = extracted.get("original_amount") or 0
    if setup_import_role == "settlement_document":
        original_amount = 0
    loan_detected = bool(original_amount and float(original_amount or 0) > 0)
    loan_draft = None
    loan_fields = []
    if loan_detected:
        current_balance = original_amount
        loan_draft = {
            "lender_name": extracted.get("lender_name") or "",
            "loan_type": extracted.get("loan_type") or "FIXED",
            "loan_product": extracted.get("loan_product") or ("Conventional" if "conventional" in markdown.lower() else ""),
            "purpose": "Purchase" if "purchase" in markdown.lower() else "",
            "original_amount": original_amount,
            "current_balance": current_balance,
            "current_balance_source_label": "Initial balance from closing document",
            "current_balance_verification_status": "Needs latest mortgage statement",
            "interest_rate": extracted.get("interest_rate") or "",
            "loan_term_years": extracted.get("loan_term_years") or "",
            "term_months": int(extracted.get("loan_term_years") or 0) * 12 if extracted.get("loan_term_years") else None,
            "monthly_payment": extracted.get("monthly_payment") or "",
            "escrow_amount": extracted.get("escrow_monthly") or "",
            "estimated_total_monthly_payment": extracted.get("estimated_total_monthly_payment") or "",
            "origination_date": extracted.get("origination_date") or extracted.get("purchase_date") or "",
            "escrow_included": bool(extracted.get("escrow_monthly")),
            "status": "OPEN",
            "sourceDocumentId": document.id,
            "sourceDocumentType": document.doc_category,
            "importStatus": "review_required",
            "importStatusLabel": "Imported · Review required",
            "apr": extracted.get("apr"),
            "loan_id": extracted.get("loan_id"),
        }
        loan_fields = [
            _setup_field(extracted, "lender_name", "lender_name", "Lender"),
            _setup_field(extracted, "original_amount", "original_amount", "Original loan", "currency", 0.92),
            _setup_field(extracted, "interest_rate", "interest_rate", "Interest rate", "percent", 0.9),
            _setup_field(extracted, "loan_term_years", "loan_term_years", "Term"),
            _setup_field(extracted, "monthly_payment", "monthly_payment", "Payment", "currency", 0.88),
            _setup_field(extracted, "escrow_monthly", "escrow_amount", "Escrow", "currency", 0.84),
            _setup_field(extracted, "estimated_total_monthly_payment", "estimated_total_monthly_payment", "Estimated total", "currency", 0.84),
            _setup_field(extracted, "origination_date", "origination_date", "Origination date", "date", 0.9),
        ]
        loan_fields = [field for field in loan_fields if field]

    warnings = []
    if extracted.get("cash_to_close") and not extracted.get("down_payment"):
        warnings.append("Cash to close was found, but no explicit down payment field was extracted.")
    if setup_import_role == "settlement_document" and review_extracted.get("closing_costs") is not None:
        warnings.append("Settlement document has closing costs. Use this value for Closing costs; Purchase price stays the Sale Price.")

    return {
        "document": {
            "id": document.id,
            "name": document.display_name or document.original_filename,
            "type": document.doc_category,
            "setupImportRole": setup_import_role,
            "uploadedAt": _json_timestamp(document.upload_date),
            "displayUrl": f"/properties/{document.property_id}/documents" if document.property_id else "/uploads",
            "hasMarkdown": bool(document.markdown_file),
        },
        "extractionStatus": "review_required",
        "markdownReader": {
            "used": bool(markdown or document.markdown_file),
            "documentMarkdownEndpoint": f"/api/documents/{document.id}/markdown" if document.markdown_file else None,
        },
        "propertyFields": property_fields,
        "purchasePriceSelection": purchase_price_selection,
        "settlementCalculations": settlement_calculations,
        "loanDetected": loan_detected,
        "loanDrafts": [loan_draft] if loan_draft else [],
        "loanFields": loan_fields,
        "addressValidation": _address_validation(getattr(document, "property", None), extracted),
        "warnings": warnings,
    }


def _statement_setup_review_payload(document: models.Document) -> Dict[str, Any]:
    extracted = _safe_extracted_data(document)
    current_balance = extracted.get("current_balance")
    escrow_total = extracted.get("escrow_amount")
    if not escrow_total:
        component_total = _escrow_component_total_from_mapping(extracted)
        escrow_total = component_total if component_total > 0 else escrow_total
    statement_fields = [
        _setup_field(extracted, "account_number", "account_number", "Loan account number", "text", 0.98),
        _setup_field(extracted, "current_balance", "current_balance", "Current balance", "currency", 0.92),
        _setup_field(extracted, "monthly_property_tax_escrow", "monthly_property_tax_escrow", "Monthly property tax escrow", "currency", 0.84),
        _setup_field(extracted, "monthly_insurance_escrow", "monthly_insurance_escrow", "Monthly insurance escrow", "currency", 0.84),
        _setup_field(extracted, "monthly_mortgage_insurance", "monthly_mortgage_insurance", "Monthly mortgage insurance", "currency", 0.8),
        _setup_field(extracted, "monthly_other_escrow", "monthly_other_escrow", "Other monthly escrow", "currency", 0.75),
        _setup_field(extracted, "escrow_amount", "escrow_amount", "Total monthly escrow", "currency", 0.84),
        _setup_field(extracted, "estimated_total_monthly_payment", "estimated_total_monthly_payment", "Estimated total monthly payment", "currency", 0.8),
        _setup_field(extracted, "statement_date", "statement_date", "Statement date", "date", 0.9),
        _setup_field(extracted, "origination_date", "origination_date", "Mortgage origination date", "date", 0.9),
        _setup_field(extracted, "mortgage_acquisition_date", "servicer_start_date", "Mortgage acquisition date", "date", 0.94),
    ]
    statement_fields = [field for field in statement_fields if field]
    statement_draft = {
        "current_balance": current_balance or "",
        "monthly_property_tax_escrow": extracted.get("monthly_property_tax_escrow") or "",
        "monthly_insurance_escrow": extracted.get("monthly_insurance_escrow") or "",
        "monthly_mortgage_insurance": extracted.get("monthly_mortgage_insurance") or "",
        "monthly_other_escrow": extracted.get("monthly_other_escrow") or "",
        "escrow_amount": escrow_total or "",
        "estimated_total_monthly_payment": extracted.get("estimated_total_monthly_payment") or extracted.get("monthly_payment") or "",
        "statement_date": extracted.get("statement_date") or "",
        "origination_date": extracted.get("origination_date") or "",
        "servicer_start_date": extracted.get("mortgage_acquisition_date") or "",
        "escrow_included": bool(escrow_total or extracted.get("escrow_included")),
        "account_number": extracted.get("account_number") or "",
        "sourceDocumentId": document.id,
        "sourceDocumentType": document.doc_category,
        "importStatus": "review_required",
        "importStatusLabel": "Statement imported · Review values",
        "current_balance_source": "mortgage_statement_reported_balance",
        "current_balance_source_label": "Reported from mortgage statement",
        "current_balance_verification_status": "Reported",
    }
    return {
        "document": {
            "id": document.id,
            "name": document.display_name or document.original_filename,
            "type": document.doc_category,
            "uploadedAt": _json_timestamp(document.upload_date),
            "displayUrl": f"/properties/{document.property_id}/documents" if document.property_id else "/uploads",
            "hasMarkdown": bool(document.markdown_file),
        },
        "extractionStatus": "review_required",
        "statementDraft": statement_draft,
        "loanMapping": _loan_statement_mapping_payload(getattr(document, "property", None), extracted),
        "loanFields": statement_fields,
        "addressValidation": _address_validation(getattr(document, "property", None), extracted),
        "warnings": [],
    }


def _escrow_component_total_from_mapping(data: Dict[str, Any]) -> float:
    return round(
        _to_float(data.get("monthly_property_tax_escrow"))
        + _to_float(data.get("monthly_insurance_escrow"))
        + _to_float(data.get("monthly_mortgage_insurance"))
        + _to_float(data.get("monthly_other_escrow")),
        2,
    )


def _loan_statement_mapping_payload(prop: Optional[models.Property], extracted: Dict[str, Any], selected_loan_id: Optional[int] = None) -> Dict[str, Any]:
    account_number = (extracted.get("account_number") or "").strip()
    loans = list(getattr(prop, "loans", []) or [])
    selected = next((loan for loan in loans if loan.id == selected_loan_id), None) if selected_loan_id else None
    matched = next((loan for loan in loans if account_number and (loan.account_number or "").strip() == account_number), None)
    if matched:
        return {
            "accountNumber": account_number,
            "matchType": "matched_account",
            "loanId": matched.id,
            "message": "Statement account number matches an existing loan.",
        }
    if account_number and selected and (selected.account_number or "").strip() and (selected.account_number or "").strip() != account_number:
        return {
            "accountNumber": account_number,
            "matchType": "selected_account_mismatch",
            "loanId": None,
            "selectedLoanId": selected.id,
            "selectedAccountNumber": (selected.account_number or "").strip(),
            "message": "This document has a different loan account number, so it will create or update the matching loan instead of overwriting the selected loan.",
        }
    if account_number and selected and not (selected.account_number or "").strip():
        return {
            "accountNumber": account_number,
            "matchType": "selected_claims_account",
            "loanId": selected.id,
            "message": "Selected loan has no account number; the statement account number will be assigned.",
        }
    accountless_loans = [loan for loan in loans if not (loan.account_number or "").strip()]
    if account_number and len(accountless_loans) == 1:
        return {
            "accountNumber": account_number,
            "matchType": "accountless_loan_claims_account",
            "loanId": accountless_loans[0].id,
            "message": "Existing loan has no account number; the statement account number will be assigned.",
        }
    if account_number and loans:
        return {
            "accountNumber": account_number,
            "matchType": "new_account",
            "loanId": None,
            "message": "Statement account number does not match existing loans; applying will create a new loan record.",
        }
    if account_number:
        return {
            "accountNumber": account_number,
            "matchType": "new_first_loan",
            "loanId": None,
            "message": "No loan exists yet; applying will create the loan from this statement.",
        }
    if selected:
        return {
            "accountNumber": "",
            "matchType": "selected_no_account",
            "loanId": selected.id,
            "message": "No account number was found; selected loan will be updated.",
        }
    return {
        "accountNumber": "",
        "matchType": "missing_account",
        "loanId": loans[0].id if len(loans) == 1 else None,
        "message": "No account number was found; review the target loan before applying.",
    }


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(float(value or fallback))
    except (TypeError, ValueError):
        return fallback


def _setup_property_payload(prop: models.Property) -> Dict[str, Any]:
    return {
        "id": prop.id,
        "property_uid": prop.property_uid,
        "owner_id": prop.owner_id,
        "name": prop.name,
        "address": prop.address,
        "city": prop.city,
        "state": prop.state,
        "zip_code": prop.zip_code,
        "property_type": prop.property_type,
        "property_type_raw": prop.property_type_raw,
        "usage_type": prop.usage_type,
        "usage_type_locked": bool(prop.usage_type_locked),
        "original_residency_status": prop.original_residency_status,
        "current_residency_status": prop.current_residency_status,
        "purchase_date": prop.purchase_date,
        "purchase_price": prop.purchase_price or 0,
        "down_payment": prop.down_payment or 0,
        "closing_costs": prop.closing_costs or 0,
        "market_value": prop.market_value or 0,
        "market_value_source": prop.market_value_source,
        "market_value_updated": prop.market_value_updated,
        "monthly_rent": prop.monthly_rent or 0,
        "occupancy_rate": prop.occupancy_rate or 100,
        "rental_start_date": prop.rental_start_date,
        "rental_end_date": prop.rental_end_date,
        "rental_start_date_origin": prop.rental_start_date_origin,
        "property_tax": prop.property_tax or 0,
        "property_tax_history": prop.property_tax_history or "{}",
        "insurance": prop.insurance or 0,
        "hoa_flag": bool(prop.hoa_flag),
        "hoa_fee": prop.hoa_fee or 0,
        "hoa_history": prop.hoa_history or "[]",
        "hoa_special_assessment": prop.hoa_special_assessment or 0,
        "maintenance": prop.maintenance or 0,
        "property_management_fee": prop.property_management_fee or 0,
        "utilities": prop.utilities or 0,
        "vacancy_allowance": prop.vacancy_allowance or 0,
        "capex_reserve": prop.capex_reserve or 0,
        "other_expenses": prop.other_expenses or 0,
        "solar_ownership": prop.solar_ownership,
        "solar_monthly_payment": prop.solar_monthly_payment or 0,
        "solar_purchase_price": prop.solar_purchase_price or 0,
        "land_value": prop.land_value or 0,
        "construction_price": prop.construction_price or 0,
        "depreciation_years": prop.depreciation_years or 27.5,
        "loans": [_setup_loan_payload(loan) for loan in getattr(prop, "loans", []) or []],
        "usage_periods": [],
    }


def _loan_document_affected_years(category: str, statement_year: Optional[int]) -> List[int]:
    if not statement_year:
        return []
    try:
        year = int(statement_year)
    except (TypeError, ValueError):
        return []
    if category == "1098":
        return [year - 1, year]
    return [year]


def _completed_processing_result(
    *,
    loan_id: Optional[int],
    document_id: int,
    category: str,
    statement_year: Optional[int],
    updated_at: Any,
    reconciliation_status: str = "completed",
) -> Dict[str, Any]:
    return {
        "loanId": loan_id,
        "documentId": document_id,
        "affectedYears": _loan_document_affected_years(category, statement_year),
        "processingStatus": "COMPLETED",
        "reconciliationStatus": reconciliation_status,
        "updatedAt": _json_timestamp(updated_at) if updated_at else datetime.utcnow().isoformat(),
    }


def _statement_year(extracted: Dict[str, Any], loan: models.Loan) -> Optional[int]:
    parsed = _parse_date(extracted.get("statement_date") or getattr(loan, "statement_date", None))
    return parsed.year if parsed else None


def _can_apply_escrow_estimate(row: models.AnnualExpense, field: str, source_field: str) -> bool:
    current_value = float(getattr(row, field, 0) or 0)
    current_source = annual_expense_source_key(getattr(row, source_field, None))
    if current_value <= 0:
        return True
    return current_source == EXPENSE_SOURCE_ESCROW_ESTIMATE


def _apply_escrow_expense_estimates(
    prop: models.Property,
    owner_id: int,
    loan: models.Loan,
    extracted: Dict[str, Any],
    selected_fields: set,
    db: Session,
) -> Dict[str, Any]:
    year = _statement_year(extracted, loan)
    if not year:
        return {}

    estimate_specs = [
        ("propertyTax", "property_tax", "property_tax_source", "monthly_property_tax_escrow"),
        ("insurance", "insurance", "insurance_source", "monthly_insurance_escrow"),
    ]
    selected_estimate_specs = [
        spec for spec in estimate_specs
        if spec[3] in selected_fields and _to_float(extracted.get(spec[3])) > 0
    ]
    if not selected_estimate_specs:
        return {}

    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == year,
    ).first()
    if not row:
        row = models.AnnualExpense(property_id=prop.id, owner_id=owner_id, year=year, source_status="estimated")
        db.add(row)

    result = {"year": year, "warnings": []}
    for response_key, field, source_field, loan_field in selected_estimate_specs:
        annual_value = round(_to_float(extracted.get(loan_field)) * 12, 2)
        current_source = annual_expense_source_key(getattr(row, source_field, None))
        current_value = float(getattr(row, field, 0) or 0)
        applied = _can_apply_escrow_estimate(row, field, source_field)
        if applied:
            setattr(row, field, annual_value)
            setattr(row, source_field, EXPENSE_SOURCE_ESCROW_ESTIMATE)
            if row.source_status in (None, "", EXPENSE_SOURCE_MANUAL, "manual", "estimated"):
                row.source_status = "estimated"
        else:
            result["warnings"].append({
                "field": field,
                "message": "Existing reported or manual expense value was preserved.",
                "source": current_source,
            })
        result[response_key] = {
            "value": annual_value,
            "display": format_currency(annual_value),
            "source": EXPENSE_SOURCE_ESCROW_ESTIMATE,
            "label": "Estimated (escrow)",
            "applied": applied,
            "existingSource": current_source,
            "existingValue": current_value,
        }

    return result


def _setup_loan_payload(loan: models.Loan) -> Dict[str, Any]:
    return {
        "id": loan.id,
        "property_id": loan.property_id,
        "lender_name": loan.lender_name,
        "loan_product": loan.loan_product,
        "loan_type": loan.loan_type,
        "status": loan.status,
        "closed_date": loan.closed_date,
        "closure_reason": loan.closure_reason,
        "replacement_loan_id": loan.replacement_loan_id,
        "loan_group_id": loan.loan_group_id,
        "servicer_sequence": loan.servicer_sequence,
        "servicer_start_date": loan.servicer_start_date,
        "servicer_end_date": loan.servicer_end_date,
        "transfer_reason": loan.transfer_reason,
        "is_current_servicer": bool(loan.is_current_servicer),
        "original_amount": loan.original_amount or 0,
        "current_balance": loan.current_balance or 0,
        "interest_rate": loan.interest_rate or 0,
        "rate_note": loan.rate_note,
        "monthly_payment": loan.monthly_payment or 0,
        "estimated_total_monthly_payment": loan.estimated_total_monthly_payment or 0,
        "extra_monthly_payment": loan.extra_monthly_payment or 0,
        "loan_term_years": loan.loan_term_years or 30,
        "origination_date": loan.origination_date,
        "maturity_date": loan.maturity_date,
        "original_ltv": loan.original_ltv or 0,
        "escrow_amount": loan.escrow_amount or 0,
        "escrow_included": bool(loan.escrow_included),
        "monthly_property_tax_escrow": loan.monthly_property_tax_escrow or 0,
        "monthly_insurance_escrow": loan.monthly_insurance_escrow or 0,
        "monthly_mortgage_insurance": loan.monthly_mortgage_insurance or 0,
        "monthly_other_escrow": loan.monthly_other_escrow or 0,
        "source_document_id": loan.source_document_id,
        "source_type": loan.source_type,
        "import_status": loan.import_status,
        "current_balance_source": loan.current_balance_source,
        "current_balance_as_of": loan.current_balance_as_of,
        "current_balance_verified": bool(loan.current_balance_verified),
        "statement_date": loan.statement_date,
        "account_number": loan.account_number,
    }

ALLOWED_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".csv"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

DOC_CATEGORIES = [
    "auto",
    "mortgage_statement",
    "closing_statement",
    "tax_return",
    "1098",
    "1099",
    "loan_disclosure",
    "bank_statement",
    "property_tax",
    "deed_title",
    "insurance_declaration",
    "expense_receipt",
    "other",
]


def _file_hash(path: Path) -> str:
    """SHA-256 of the raw file bytes, used to flag exact-content duplicates
    regardless of what the uploaded file happens to be named."""
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _format_period(extracted: dict, statement_year=None, period_start=None, period_end=None) -> Optional[str]:
    date_str = extracted.get("statement_date") or period_end or period_start
    if date_str:
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m/%Y", "%Y-%m"):
            try:
                return datetime.strptime(str(date_str), fmt).strftime("%b %Y")
            except ValueError:
                continue
    year = statement_year or extracted.get("statement_year") or extracted.get("tax_year")
    return str(int(year)) if year else None


def _build_display_name(category: str, extracted: dict, statement_year=None,
                         period_start=None, period_end=None) -> str:
    """Human-readable document name derived from extracted content, since the
    uploaded filename is often meaningless (e.g. "scan0043.pdf")."""
    label = get_document_config(category).label
    period = _format_period(extracted, statement_year, period_start, period_end)
    lender = (extracted.get("lender_name") or "").strip()
    account = (extracted.get("account_number") or "").strip()

    parts = [label]
    if period:
        parts.append(period)
    name = " — ".join(parts)

    tail = []
    if lender:
        tail.append(lender)
    if account and category in ("mortgage_statement", "1098", "loan_disclosure"):
        tail.append(f"****{account[-4:]}" if len(account) > 4 else account)
    if tail:
        name += f" ({', '.join(tail)})"
    return name


_FINGERPRINT_AMOUNT_FIELDS = (
    "total_amount", "rents_received", "mortgage_interest", "property_taxes",
    "depreciation", "net_income", "annual_insurance", "annual_property_tax",
    "original_amount", "current_balance", "principal_due", "interest_due",
    "settlement_total_amount", "closing_costs",
)


def _content_fingerprint(category: str, extracted: dict, statement_year=None,
                          property_id=None) -> str:
    """Hash of normalized extracted fields — flags near-duplicates (e.g. the
    same statement re-scanned or re-exported with different file bytes) that
    the raw content_hash would miss."""
    import hashlib

    amounts = []
    for key in _FINGERPRINT_AMOUNT_FIELDS:
        val = extracted.get(key)
        if val is not None:
            try:
                amounts.append(f"{key}={round(float(val), 2)}")
            except (TypeError, ValueError):
                amounts.append(f"{key}={val}")

    year = statement_year or extracted.get("statement_year") or extracted.get("tax_year")
    basis = "|".join([
        category or "",
        str(year or ""),
        str(property_id or ""),
        (extracted.get("account_number") or "").strip().upper(),
        str(extracted.get("period_start") or ""),
        str(extracted.get("period_end") or extracted.get("statement_date") or ""),
        ",".join(sorted(amounts)),
    ])
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


PROPERTY_CODE_NAMES = [
    "Palermo", "Electra", "Syrah", "Valencia", "Meridian", "Solara",
    "Cypress", "Juniper", "Sierra", "Atlas", "Nova", "Laurel",
    "Haven", "Orion", "Saffron", "Monaco",
]


def _default_property_name(prop_id: int) -> str:
    base = PROPERTY_CODE_NAMES[(prop_id - 1) % len(PROPERTY_CODE_NAMES)]
    cycle = (prop_id - 1) // len(PROPERTY_CODE_NAMES)
    return base if cycle == 0 else f"{base} {cycle + 1}"


@router.get("/config")
def get_document_configs(
    current_user: models.User = Depends(get_current_user),
):
    return {
        "categories": DOC_CATEGORIES,
        "document_types": {
            key: config_as_dict(key)
            for key in DOCUMENT_TYPE_CONFIG.keys()
        },
    }

# Extracted keys that map onto Loan columns when a document is applied
LOAN_FIELDS = {
    "original_amount", "current_balance", "interest_rate", "rate_note",
    "monthly_payment", "estimated_total_monthly_payment", "loan_term_years", "maturity_date",
    "escrow_amount", "escrow_included", "loan_type", "loan_product", "account_number",
    "monthly_property_tax_escrow", "monthly_insurance_escrow",
    "monthly_mortgage_insurance", "monthly_other_escrow",
    "principal_due", "interest_due", "statement_date", "payment_due_date",
    "mortgage_tenure_covered", "interest_paid_ytd", "principal_paid_ytd",
    "projected_principal_fy", "projected_interest_fy", "original_ltv",
    "lender_name", "origination_date",
}

# Point-in-time "Statement Details" fields: these change with every statement,
# so they must only ever reflect the LATEST statement. Identity/origination
# fields (account_number, lender_name, original_amount, loan_term_years,
# origination_date, maturity_date, loan_type) are static and always applied.
STATEMENT_FIELDS = {
    "current_balance", "principal_due", "interest_due",
    "statement_date", "payment_due_date", "monthly_payment",
    "escrow_amount", "monthly_property_tax_escrow", "monthly_insurance_escrow",
    "monthly_mortgage_insurance", "monthly_other_escrow",
    "interest_rate", "rate_note", "mortgage_tenure_covered",
    "interest_paid_ytd", "principal_paid_ytd", "projected_principal_fy",
    "projected_interest_fy", "estimated_total_monthly_payment",
}


def _parse_date(s):
    """Parse a statement date string to a date, or None if unparseable."""
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _norm_address(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _apply_extracted(db, prop, data, category=None) -> dict:
    """Apply extracted document fields to a property and its loan.

    Matches loans by account_number when available, otherwise uses the first loan.
    Returns a dict of the fields that were applied.
    """
    applied = {}
    account_number = (data.get("account_number") or "").strip()
    allowed_loan_fields = mapped_loan_fields(category) or LOAN_FIELDS
    loan_updates = {k: v for k, v in data.items() if k in allowed_loan_fields and v is not None}
    borrowers = "; ".join(
        data[k] for k in ("borrower_1", "borrower_2", "borrower_3", "borrower_4")
        if data.get(k)
    )
    if borrowers:
        loan_updates["borrowers"] = borrowers

    if loan_updates:
        # Match loans by account number. A new account number represents a
        # distinct loan/servicer record and must not overwrite an older loan.
        loan = None
        if account_number:
            loan = next((l for l in prop.loans if l.account_number == account_number), None)
            if loan is None:
                accountless_loans = [l for l in prop.loans if not (l.account_number or "").strip()]
                loan = accountless_loans[0] if len(accountless_loans) == 1 else None
        if loan is None:
            loan = prop.loans[0] if prop.loans and not account_number else None
        if loan is None:
            loan = models.Loan(
                property_id=prop.id,
                original_amount=_to_float(data.get("original_amount") or data.get("current_balance")),
                current_balance=_to_float(data.get("current_balance")),
                interest_rate=_to_float(data.get("interest_rate")),
                monthly_payment=_to_float(data.get("monthly_payment")),
                loan_term_years=30,
                account_number=account_number or None,
            )
            db.add(loan)

        # "Statement Details" must reflect the LATEST statement only. If this
        # document is older than the loan's current statement (or is undated
        # while the loan already has a dated statement), keep the existing
        # snapshot and apply only the static identity/origination fields.
        new_date = _parse_date(data.get("statement_date"))
        cur_date = _parse_date(loan.statement_date)
        if cur_date is not None and (new_date is None or new_date < cur_date):
            for k in STATEMENT_FIELDS:
                loan_updates.pop(k, None)

        for k, v in loan_updates.items():
            setattr(loan, k, v)
            applied[f"loan.{k}"] = v

    annual_rent = data.get("annual_rental_income") or data.get("rents_received")
    if annual_rent:
        prop.monthly_rent = round(annual_rent / 12, 2)
        applied["property.monthly_rent"] = prop.monthly_rent

    # Closing statement: populate purchase/origination property fields
    if data.get("purchase_price") is not None:
        prop.purchase_price = data["purchase_price"]
        applied["property.purchase_price"] = data["purchase_price"]
    if data.get("purchase_date"):
        prop.purchase_date = data["purchase_date"]
        applied["property.purchase_date"] = data["purchase_date"]
    if data.get("recorded_date"):
        prop.recorded_date = data["recorded_date"]
        applied["property.recorded_date"] = data["recorded_date"]
    if data.get("settlement_total_amount") is not None:
        prop.settlement_total_amount = data["settlement_total_amount"]
        applied["property.settlement_total_amount"] = data["settlement_total_amount"]
    if data.get("closing_costs") is not None:
        prop.closing_costs = data["closing_costs"]
        applied["property.closing_costs"] = data["closing_costs"]
    if data.get("annual_property_tax") is not None:
        prop.property_tax = data["annual_property_tax"]
        applied["property.property_tax"] = data["annual_property_tax"]
    if data.get("annual_insurance") is not None:
        prop.insurance = data["annual_insurance"]
        applied["property.insurance"] = data["annual_insurance"]
    if data.get("hoa_annual") is not None:
        prop.hoa_fee = round(data["hoa_annual"] / 12, 2)
        applied["property.hoa_fee"] = prop.hoa_fee

    reported_expenses = _apply_reported_annual_expenses(db, prop, data, category)
    applied.update(reported_expenses)

    if data.get("down_payment") is not None:
        prop.down_payment = data["down_payment"]
        applied["property.down_payment"] = data["down_payment"]

    return applied


def _reported_expense_year(data: Dict[str, Any]) -> Optional[int]:
    for key in ("statement_year", "tax_year", "year"):
        value = data.get(key)
        if value:
            try:
                return int(str(value)[:4])
            except (TypeError, ValueError):
                pass
    for key in ("statement_date", "period_start", "period_end"):
        parsed = _parse_date(data.get(key))
        if parsed:
            return parsed.year
    return None


def _apply_reported_annual_expenses(db: Session, prop: models.Property, data: Dict[str, Any], category: Optional[str]) -> Dict[str, Any]:
    if category not in {"property_tax", "insurance_declaration"}:
        return {}
    year = _reported_expense_year(data)
    if not year:
        return {}

    updates: Dict[str, float] = {}
    if category == "property_tax":
        tax_value = data.get("annual_property_tax")
        if tax_value is None:
            tax_value = data.get("property_tax_amount")
        if tax_value is None:
            tax_value = data.get("taxes_paid")
        if tax_value is not None and _to_float(tax_value) > 0:
            updates["property_tax"] = round(_to_float(tax_value), 2)
    if category == "insurance_declaration":
        insurance_value = data.get("annual_insurance")
        if insurance_value is not None and _to_float(insurance_value) > 0:
            updates["insurance"] = round(_to_float(insurance_value), 2)
    if not updates:
        return {}

    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == year,
    ).first()
    if not row:
        row = models.AnnualExpense(property_id=prop.id, owner_id=prop.owner_id, year=year)
        db.add(row)

    applied: Dict[str, Any] = {}
    if "property_tax" in updates:
        row.property_tax = updates["property_tax"]
        row.property_tax_source = EXPENSE_SOURCE_REPORTED
        prop.property_tax = updates["property_tax"]
        applied[f"annual_expense.{year}.property_tax"] = updates["property_tax"]
    if "insurance" in updates:
        row.insurance = updates["insurance"]
        row.insurance_source = EXPENSE_SOURCE_REPORTED
        prop.insurance = updates["insurance"]
        applied[f"annual_expense.{year}.insurance"] = updates["insurance"]
    row.source_status = EXPENSE_SOURCE_REPORTED
    return applied


def _expense_document_amount(data: Dict[str, Any], field: str) -> Optional[float]:
    if field == "property_tax":
        candidates = ("annual_property_tax", "property_tax_amount", "taxes_paid")
    elif field == "insurance":
        candidates = ("annual_insurance", "insurance")
    else:
        return None
    for key in candidates:
        value = data.get(key)
        if value is not None and _to_float(value) > 0:
            return round(_to_float(value), 2)
    return None


def _set_annual_expense_source_document(
    row: models.AnnualExpense,
    field: str,
    doc: models.Document,
    amount: float,
    category: str,
    *,
    address_override: bool = False,
    current_user: Optional[models.User] = None,
    address_validation: Optional[Dict[str, Any]] = None,
) -> None:
    notes = _annual_expense_notes_payload(row.notes)
    sources = notes.get("sources") or {}
    sources[field] = {
        "documentId": doc.id,
        "documentName": doc.display_name or doc.original_filename or doc.filename,
        "docType": "tax bill" if field == "property_tax" else "dec page",
        "sourceType": category,
        "amount": amount,
        "amountDisplay": format_currency(amount),
        "parsedAt": datetime.utcnow().isoformat(),
        "addressOverride": bool(address_override),
        "addressOverrideBy": getattr(current_user, "email", None) if address_override and current_user else None,
        "addressOverrideAt": datetime.utcnow().isoformat() if address_override else None,
        "addressValidation": address_validation or {},
    }
    row.notes = json.dumps({"text": notes.get("text") or "", "sources": sources})


def _clear_annual_expense_source_document(row: models.AnnualExpense, field: str) -> None:
    notes = _annual_expense_notes_payload(row.notes)
    sources = notes.get("sources") or {}
    sources.pop(field, None)
    row.notes = json.dumps({"text": notes.get("text") or "", "sources": sources})


def _escrow_expense_estimate(prop: models.Property, year: int, field: str) -> Optional[float]:
    loan_field = "monthly_property_tax_escrow" if field == "property_tax" else "monthly_insurance_escrow"
    candidates = []
    for loan in getattr(prop, "loans", []) or []:
        monthly = _to_float(getattr(loan, loan_field, 0))
        if monthly <= 0:
            continue
        statement_date = _parse_date(getattr(loan, "statement_date", None))
        if statement_date and statement_date.year == year:
            candidates.append((1, monthly))
        elif not statement_date:
            candidates.append((0, monthly))
    if not candidates:
        return None
    _rank, monthly = sorted(candidates, key=lambda item: item[0], reverse=True)[0]
    return round(monthly * 12, 2)


def _expense_document_payload(doc: models.Document) -> Dict[str, Any]:
    return {
        "id": doc.id,
        "name": doc.display_name or doc.original_filename or doc.filename,
        "category": doc.doc_category,
        "uploadedAt": doc.upload_date.isoformat() if doc.upload_date else None,
    }


def _expense_address_requires_review(address_validation: Dict[str, Any]) -> bool:
    status = address_validation.get("status")
    score = float(address_validation.get("matchScore") or 0)
    return status != "match" or score < 0.95


def _expense_address_review_response(
    doc: models.Document,
    address_validation: Dict[str, Any],
) -> Dict[str, Any]:
    status = address_validation.get("status")
    score = float(address_validation.get("matchScore") or 0)
    message = (
        "Couldn't read an address — confirm this is the right document."
        if status == "document_address_missing"
        else "Address mismatch"
    )
    return {
        "status": "address_review_required",
        "message": message,
        "document": _expense_document_payload(doc),
        "addressValidation": {
            **address_validation,
            "matchScoreDisplay": format_percent(score * 100),
        },
    }


def _apply_expense_document_to_row(
    db: Session,
    current_user: models.User,
    prop: models.Property,
    doc: models.Document,
    year: int,
    field: str,
    *,
    address_override: bool = False,
    address_validation: Optional[Dict[str, Any]] = None,
) -> models.AnnualExpense:
    extracted = _safe_extracted_data(doc)
    amount = _expense_document_amount(extracted, field)
    if amount is None:
        raise HTTPException(status_code=422, detail="Could not find a reported annual amount in this document.")

    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == year,
    ).first()
    if not row:
        row = models.AnnualExpense(property_id=prop.id, owner_id=current_user.id, year=year)
        db.add(row)

    if field == "property_tax":
        row.property_tax = amount
        row.property_tax_source = EXPENSE_SOURCE_REPORTED
        prop.property_tax = amount
    else:
        row.insurance = amount
        row.insurance_source = EXPENSE_SOURCE_REPORTED
        prop.insurance = amount
    row.source_status = EXPENSE_SOURCE_REPORTED
    _set_annual_expense_source_document(
        row,
        field,
        doc,
        amount,
        doc.doc_category or ("property_tax" if field == "property_tax" else "insurance_declaration"),
        address_override=address_override,
        current_user=current_user,
        address_validation=address_validation,
    )
    return row


def _find_or_create_property(db, user, extracted):
    """Match the extracted property address to an existing property, or create one."""
    addr = extracted.get("property_address")
    if not addr:
        return None, False

    target = _norm_address(addr)
    props = db.query(models.Property).filter(
        models.Property.owner_id == user.id
    ).all()
    for p in props:
        existing = _norm_address(p.address)
        if existing and (existing in target or target in existing):
            return p, False

    prop = models.Property(
        owner_id=user.id,
        property_uid=str(uuid.uuid4()),
        name=None,
        address=addr,
        city=extracted.get("property_city"),
        state=extracted.get("property_state"),
        zip_code=extracted.get("property_zip"),
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    prop.name = prop.name or _default_property_name(prop.id)
    return prop, True


def _pending_upload_path(current_user: models.User, pending_upload_id: str) -> Path:
    pending_upload_id = Path(pending_upload_id).name
    if not pending_upload_id.startswith(f"pending-{current_user.id}-"):
        raise HTTPException(status_code=404, detail="Pending upload not found")
    path = UPLOAD_DIR / pending_upload_id
    if not path.exists():
        raise HTTPException(status_code=404, detail="Pending upload not found")
    return path


async def _save_pending_upload(file: UploadFile, current_user: models.User) -> tuple[Path, str, str, int]:
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {suffix} not allowed")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    unique_name = f"pending-{current_user.id}-{uuid.uuid4().hex}{suffix}"
    save_path = UPLOAD_DIR / unique_name
    with open(save_path, "wb") as f:
        f.write(content)

    return save_path, unique_name, suffix, len(content)


def _duplicate_of_payload(doc: "models.Document", match_type: str) -> dict:
    return {
        "match_type": match_type,  # "exact" (same bytes) or "similar" (same extracted content/period)
        "id": doc.id,
        "name": doc.display_name or doc.original_filename,
        "upload_date": _json_timestamp(doc.upload_date),
        "property_address": doc.property.address if doc.property else None,
        "doc_category": doc.doc_category,
    }


async def _commit_parsed_document(
    db: Session,
    current_user: models.User,
    save_path: Path,
    original_filename: str,
    suffix: str,
    file_size: int,
    category: str,
    extracted: dict,
    markdown: str,
    property_id: Optional[int],
    loan_id: Optional[int] = None,
    force: bool = False,
    replace_document_id: Optional[int] = None,
    apply_extracted: bool = True,
):
    content_hash = _file_hash(save_path)

    if replace_document_id:
        old_doc = db.query(models.Document).filter(
            models.Document.id == replace_document_id,
            models.Document.owner_id == current_user.id,
        ).first()
        if old_doc:
            _delete_document_and_dependents(db, old_doc)
            db.flush()
    elif not force:
        duplicate_by_content = (
            db.query(models.Document)
            .filter(
                models.Document.owner_id == current_user.id,
                models.Document.content_hash == content_hash,
            )
            .first()
        )
        if duplicate_by_content:
            raise HTTPException(
                status_code=409,
                detail=_duplicate_of_payload(duplicate_by_content, "exact"),
            )

    markdown_name = None
    if markdown:
        markdown_name = f"{save_path.stem}.md"
        (UPLOAD_DIR / markdown_name).write_text(markdown)

    is_tax_return = (category == "tax_return")
    prop = None
    property_created = False
    auto_applied = {}

    if not is_tax_return:
        if property_id:
            prop = db.query(models.Property).filter(
                models.Property.id == property_id,
                models.Property.owner_id == current_user.id,
            ).first()
            if not prop:
                raise HTTPException(status_code=404, detail="Property not found")
        else:
            prop, property_created = _find_or_create_property(db, current_user, extracted)
            if prop is None:
                if markdown_name:
                    (UPLOAD_DIR / markdown_name).unlink(missing_ok=True)
                raise HTTPException(
                    status_code=400,
                    detail="No property address found in the document. Select a property and try again.",
                )
        auto_applied = _apply_extracted(db, prop, extracted, category) if apply_extracted else {}
        if auto_applied:
            db.flush()

    loan_account_number = (extracted.get("account_number") or "").strip()
    statement_year = extracted.get("statement_year")
    content_fingerprint = _content_fingerprint(category, extracted, statement_year, prop.id if prop else None)

    if not force and not replace_document_id:
        duplicate_by_fingerprint = (
            db.query(models.Document)
            .filter(
                models.Document.owner_id == current_user.id,
                models.Document.content_fingerprint == content_fingerprint,
            )
            .first()
        )
        if duplicate_by_fingerprint:
            if markdown_name:
                (UPLOAD_DIR / markdown_name).unlink(missing_ok=True)
            raise HTTPException(
                status_code=409,
                detail=_duplicate_of_payload(duplicate_by_fingerprint, "similar"),
            )

        if prop and loan_account_number and statement_year:
            duplicate_doc = (
                db.query(models.Document)
                .filter(
                    models.Document.property_id == prop.id,
                    models.Document.doc_category == category,
                    models.Document.loan_account_number == loan_account_number,
                    models.Document.statement_year == statement_year,
                )
                .first()
            )
            if duplicate_doc:
                if markdown_name:
                    (UPLOAD_DIR / markdown_name).unlink(missing_ok=True)
                raise HTTPException(
                    status_code=409,
                    detail=_duplicate_of_payload(duplicate_doc, "similar"),
                )

    period_type = extracted.get("period_type", "other")
    period_start = extracted.get("period_start") or extracted.get("statement_date")
    period_end = extracted.get("period_end") or extracted.get("statement_date")
    display_name = _build_display_name(category, extracted, statement_year, period_start, period_end)

    doc = models.Document(
        property_id=prop.id if prop else None,
        owner_id=current_user.id,
        filename=save_path.name,
        original_filename=original_filename,
        display_name=display_name,
        content_hash=content_hash,
        content_fingerprint=content_fingerprint,
        file_type=suffix.lstrip("."),
        doc_category=category,
        file_size=file_size,
        extracted_data=json.dumps(extracted),
        markdown_file=markdown_name,
        loan_account_number=loan_account_number or None,
        statement_year=statement_year,
        period_type=period_type,
        period_start=period_start,
        period_end=period_end,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    tax_entries_imported = 0
    tax_import_error = None
    if is_tax_return:
        try:
            tax_entries_imported = await import_tax_return(
                db, current_user.id, doc.id, str(save_path))
        except Exception as e:
            tax_entries_imported = 0
            tax_import_error = str(e)

    _discard_uploaded_source(save_path)

    processing_result = _completed_processing_result(
        loan_id=loan_id,
        document_id=doc.id,
        category=doc.doc_category,
        statement_year=doc.statement_year,
        updated_at=doc.upload_date,
    )

    return {
        "id": doc.id,
        "original_filename": doc.original_filename,
        "display_name": doc.display_name,
        "category": doc.doc_category,
        "file_size": doc.file_size,
        "extracted_data": extracted,
        "document_config": config_as_dict(doc.doc_category),
        "extraction_schema": extraction_schema(doc.doc_category, extracted),
        "loan_account_number": doc.loan_account_number,
        "statement_year": doc.statement_year,
        "period_type": doc.period_type,
        "period_start": doc.period_start,
        "period_end": doc.period_end,
        "upload_date": doc.upload_date,
        "property_id": prop.id if prop else None,
        "property_address": prop.address if prop else None,
        "property_created": property_created,
        "auto_applied": auto_applied,
        "has_markdown": bool(markdown_name),
        "source_file_retained": False,
        "tax_entries_imported": tax_entries_imported,
        "tax_import_error": tax_import_error,
        **processing_result,
    }


@router.post("/upload/preview")
async def preview_upload_document(
    property_id: Optional[int] = Form(None),
    category: str = Form("auto"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    if category not in DOC_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Choose from: {DOC_CATEGORIES}")

    save_path, pending_upload_id, _suffix, file_size = await _save_pending_upload(file, current_user)
    extracted = {}
    markdown = ""
    try:
        category, extracted, markdown = parse_document(str(save_path), category)
    except Exception as e:
        category = "other" if category == "auto" else category
        extracted = {"parse_error": str(e)}
        if category == "tax_return":
            _discard_uploaded_source(save_path)
            raise HTTPException(status_code=422, detail=f"Tax return parse failed: {e}")
    extracted = _normalize_loan_document_extracted(category, extracted)

    prop = None
    if property_id and category != "tax_return":
        prop = db.query(models.Property).filter(
            models.Property.id == property_id,
            models.Property.owner_id == current_user.id,
        ).first()
        if not prop:
            _discard_uploaded_source(save_path)
            raise HTTPException(status_code=404, detail="Property not found")

    statement_year = extracted.get("statement_year")
    period_start = extracted.get("period_start") or extracted.get("statement_date")
    period_end = extracted.get("period_end") or extracted.get("statement_date")

    content_hash = _file_hash(save_path)
    content_fingerprint = _content_fingerprint(category, extracted, statement_year, prop.id if prop else None)
    duplicate_doc = (
        db.query(models.Document)
        .filter(
            models.Document.owner_id == current_user.id,
            models.Document.content_hash == content_hash,
        )
        .first()
    )
    match_type = "exact"
    if not duplicate_doc:
        duplicate_doc = (
            db.query(models.Document)
            .filter(
                models.Document.owner_id == current_user.id,
                models.Document.content_fingerprint == content_fingerprint,
            )
            .first()
        )
        match_type = "similar"
    duplicate_of = _duplicate_of_payload(duplicate_doc, match_type) if duplicate_doc else None

    return {
        "pending_upload_id": pending_upload_id,
        "original_filename": file.filename,
        "display_name": _build_display_name(category, extracted, statement_year, period_start, period_end),
        "category": category,
        "file_size": file_size,
        "extracted_data": extracted,
        "document_config": config_as_dict(category),
        "extraction_schema": extraction_schema(category, extracted),
        "requiredFields": _loan_document_required_fields(category, extracted),
        "loan_account_number": (extracted.get("account_number") or "").strip() or None,
        "statement_year": statement_year,
        "period_type": extracted.get("period_type", "other"),
        "period_start": period_start,
        "period_end": period_end,
        "property_id": prop.id if prop else property_id,
        "property_address": prop.address if prop else extracted.get("property_address"),
        "addressValidation": _address_validation(prop, extracted) if prop else None,
        "has_markdown": bool(markdown),
        "source_file_retained": True,
        "duplicate_of": duplicate_of,
    }


@router.post("/upload/accept")
async def accept_upload_document(
    req: UploadAcceptRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    if req.category not in DOC_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Choose from: {DOC_CATEGORIES}")

    save_path = _pending_upload_path(current_user, req.pending_upload_id)
    suffix = save_path.suffix.lower()
    file_size = save_path.stat().st_size

    extracted = {}
    markdown = ""
    try:
        category, extracted, markdown = parse_document(str(save_path), req.category)
    except Exception as e:
        category = "other" if req.category == "auto" else req.category
        extracted = {"parse_error": str(e)}
        if category == "tax_return":
            _discard_uploaded_source(save_path)
            raise HTTPException(status_code=422, detail=f"Tax return parse failed: {e}")
    extracted = _apply_loan_document_overrides(category, extracted, req.field_overrides)

    try:
        return await _commit_parsed_document(
            db,
            current_user,
            save_path,
            req.original_filename or req.pending_upload_id,
            suffix,
            file_size,
            category,
            extracted,
            markdown,
            req.property_id,
            loan_id=req.loan_id,
            force=req.force,
            replace_document_id=req.replace_document_id,
            apply_extracted=req.apply_extracted,
        )
    except Exception:
        db.rollback()
        raise


@router.post("/upload/cancel")
def cancel_upload_document(
    req: UploadAcceptRequest,
    current_user: models.User = Depends(get_current_user),
):
    save_path = _pending_upload_path(current_user, req.pending_upload_id)
    _discard_uploaded_source(save_path)
    return {"ok": True}


@router.post("/upload")
async def upload_document(
    property_id: Optional[int] = Form(None),
    category: str = Form("auto"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    if category not in DOC_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Choose from: {DOC_CATEGORIES}")

    save_path, _pending_upload_id, suffix, file_size = await _save_pending_upload(file, current_user)
    original_filename = file.filename

    extracted = {}
    markdown = ""
    try:
        category, extracted, markdown = parse_document(str(save_path), category)
    except Exception as e:
        category = "other" if category == "auto" else category
        extracted = {"parse_error": str(e)}
        if category == "tax_return":
            _discard_uploaded_source(save_path)
            raise HTTPException(status_code=422, detail=f"Tax return parse failed: {e}")

    try:
        return await _commit_parsed_document(
            db,
            current_user,
            save_path,
            original_filename,
            suffix,
            file_size,
            category,
            extracted,
            markdown,
            property_id,
        )
    except Exception:
        _discard_uploaded_source(save_path)
        db.rollback()
        raise


@router.post("/upload/expense-field")
async def upload_expense_field_document(
    property_id: int = Form(...),
    year: int = Form(...),
    field: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    if field not in {"property_tax", "insurance"}:
        raise HTTPException(status_code=400, detail="Expense document uploads are supported only for property tax and insurance.")

    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    category = "property_tax" if field == "property_tax" else "insurance_declaration"
    save_path, _pending_upload_id, suffix, file_size = await _save_pending_upload(file, current_user)
    original_filename = file.filename

    try:
        parsed_category, extracted, markdown = parse_document(str(save_path), category)
        if parsed_category in {"property_tax", "insurance_declaration"}:
            category = parsed_category
    except Exception as e:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail=f"Expense document parse failed: {e}")

    amount = _expense_document_amount(extracted, field)
    if amount is None:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail="Could not find a reported annual amount in this document.")

    try:
        commit = await _commit_parsed_document(
            db,
            current_user,
            save_path,
            original_filename,
            suffix,
            file_size,
            category,
            extracted,
            markdown,
            property_id,
            apply_extracted=False,
        )
    except Exception:
        _discard_uploaded_source(save_path)
        db.rollback()
        raise

    doc = db.query(models.Document).filter(
        models.Document.id == commit["id"],
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Uploaded document was not saved.")

    address_validation = _address_validation(prop, extracted)
    if _expense_address_requires_review(address_validation):
        return _expense_address_review_response(doc, address_validation)

    row = _apply_expense_document_to_row(
        db,
        current_user,
        prop,
        doc,
        year,
        field,
        address_validation=address_validation,
    )
    db.commit()
    db.refresh(row)

    return {
        "status": "applied",
        "document": _expense_document_payload(doc),
        "addressValidation": {
            **address_validation,
            "matchScoreDisplay": format_percent(float(address_validation.get("matchScore") or 0) * 100),
        },
        "annualExpense": _annual_expense_out(row),
    }


@router.post("/{doc_id}/apply-expense-field-document")
async def apply_expense_field_document(
    doc_id: int,
    request: ExpenseFieldDocumentApplyRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    field = request.field
    if field not in {"property_tax", "insurance"}:
        raise HTTPException(status_code=400, detail="Expense document links are supported only for property tax and insurance.")

    prop = db.query(models.Property).filter(
        models.Property.id == request.property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
        models.Document.property_id == prop.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    extracted = _safe_extracted_data(doc)
    address_validation = _address_validation(prop, extracted)
    if _expense_address_requires_review(address_validation) and not request.address_override:
        raise HTTPException(status_code=409, detail=_expense_address_review_response(doc, address_validation))

    row = _apply_expense_document_to_row(
        db,
        current_user,
        prop,
        doc,
        request.year,
        field,
        address_override=request.address_override,
        address_validation=address_validation,
    )
    db.commit()
    db.refresh(row)
    return {
        "status": "applied",
        "document": _expense_document_payload(doc),
        "addressValidation": {
            **address_validation,
            "matchScoreDisplay": format_percent(float(address_validation.get("matchScore") or 0) * 100),
        },
        "annualExpense": _annual_expense_out(row),
    }


@router.post("/expense-field-document/remove")
async def remove_expense_field_document_link(
    property_id: int,
    year: int,
    field: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    if field not in {"property_tax", "insurance"}:
        raise HTTPException(status_code=400, detail="Expense document links are supported only for property tax and insurance.")

    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == year,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Expense year not found")

    _clear_annual_expense_source_document(row, field)
    escrow_estimate = _escrow_expense_estimate(prop, year, field)
    if field == "property_tax":
        row.property_tax = escrow_estimate or 0
        row.property_tax_source = EXPENSE_SOURCE_ESCROW_ESTIMATE if escrow_estimate else EXPENSE_SOURCE_MANUAL
        prop.property_tax = row.property_tax
    else:
        row.insurance = escrow_estimate or 0
        row.insurance_source = EXPENSE_SOURCE_ESCROW_ESTIMATE if escrow_estimate else EXPENSE_SOURCE_MANUAL
        prop.insurance = row.insurance
    row.source_status = "estimated" if escrow_estimate else EXPENSE_SOURCE_MANUAL
    db.commit()
    db.refresh(row)
    return {"annualExpense": _annual_expense_out(row)}


@router.get("")
def list_all_documents(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    docs = (
        db.query(models.Document)
        .filter(models.Document.owner_id == current_user.id)
        .order_by(models.Document.upload_date.desc())
        .all()
    )
    dup_ids = detect_duplicate_ids(docs)
    for d in docs:
        ensure_document_record_uuid(d)
    db.commit()
    return [
        {
            "id": d.id,
            "record_uuid": d.record_uuid,
            "property_id": d.property_id,
            "property_address": d.property.address if d.property else None,
            "original_filename": d.original_filename,
            "display_name": d.display_name or d.original_filename,
            "file_type": d.file_type,
            "doc_category": d.doc_category,
            "file_size": d.file_size,
            "extracted_data": _safe_extracted_data(d),
            "document_config": config_as_dict(d.doc_category),
            "extraction_schema": extraction_schema(d.doc_category, _safe_extracted_data(d)),
            "loan_account_number": d.loan_account_number,
            "statement_year": d.statement_year,
            "period_type": d.period_type,
            "period_start": d.period_start,
            "period_end": d.period_end,
            "upload_date": d.upload_date,
            "has_markdown": bool(d.markdown_file),
            "is_duplicate": d.id in dup_ids,
        }
        for d in docs
    ]


@router.get("/{doc_id}/markdown", response_class=PlainTextResponse)
def get_document_markdown(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc or not doc.markdown_file:
        raise HTTPException(status_code=404, detail="Markdown not found")
    md_path = UPLOAD_DIR / doc.markdown_file
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="Markdown file missing")
    return md_path.read_text()


@router.get("/{doc_id}/setup-import-review")
def get_setup_import_review(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return Property Setup review suggestions for an uploaded closing document."""
    require_premium_user(current_user)
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.doc_category != "closing_statement":
        raise HTTPException(
            status_code=400,
            detail="This document does not appear to be a closing or settlement statement.",
        )
    markdown = ""
    if doc.markdown_file:
        md_path = UPLOAD_DIR / doc.markdown_file
        if md_path.exists():
            markdown = md_path.read_text()
    return _closing_setup_review_payload(doc, markdown)


@router.post("/{doc_id}/apply-setup-import")
def apply_setup_import(
    doc_id: int,
    request: SetupImportApplyRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Apply reviewed closing-document fields to the backend-backed setup draft."""
    require_premium_user(current_user)
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.doc_category != "closing_statement":
        raise HTTPException(
            status_code=400,
            detail="This document does not appear to be a closing or settlement statement.",
        )
    prop = db.query(models.Property).filter(
        models.Property.id == request.property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if doc.property_id and doc.property_id != prop.id:
        raise HTTPException(status_code=409, detail="Document is linked to a different property.")
    if not doc.property_id:
        doc.property_id = prop.id

    markdown = ""
    if doc.markdown_file:
        md_path = UPLOAD_DIR / doc.markdown_file
        if md_path.exists():
            markdown = md_path.read_text()
    review = _closing_setup_review_payload(doc, markdown)
    selected_property_fields = set(request.selected_property_fields or [])
    if not selected_property_fields:
        selected_property_fields = {field["targetKey"] for field in review["propertyFields"]}
    address_targets = {"address", "city", "state", "zip_code"}

    address_validation = review["addressValidation"]
    address_status = address_validation["status"]
    if address_status in {"mismatch", "document_address_missing"}:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "ADDRESS_VALIDATION_BLOCKED",
                "message": "Uploaded document appears to belong to a different property." if address_status == "mismatch" else "We could not find a property address in this document.",
                "addressValidation": address_validation,
            },
        )
    if address_status == "property_address_empty" and not (selected_property_fields & address_targets):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ADDRESS_IMPORT_REQUIRED",
                "message": "Apply the document address to this property before continuing.",
                "addressValidation": address_validation,
            },
        )
    if address_status == "possible_match" and not request.confirm_address_match:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ADDRESS_CONFIRMATION_REQUIRED",
                "message": "Confirm this document belongs to this property before applying imported values.",
                "addressValidation": address_validation,
            },
        )

    property_field_values = {field["targetKey"]: field["value"] for field in review["propertyFields"]}
    if "purchase_price" in selected_property_fields and request.selected_purchase_price_components is not None:
        selected_component_ids = set(request.selected_purchase_price_components or [])
        purchase_price_selection = review.get("purchasePriceSelection") or {}
        sale_price_component = next((
            component for component in purchase_price_selection.get("components", [])
            if component.get("id") == "sale_price"
        ), None)
        selected_total = round(sum(
            _to_float(component.get("value"))
            for component in purchase_price_selection.get("components", [])
            if component.get("id") in selected_component_ids
        ), 2)
        if sale_price_component and _to_float(sale_price_component.get("value")):
            property_field_values["purchase_price"] = round(_to_float(sale_price_component.get("value")), 2)
        elif selected_component_ids and selected_total:
            property_field_values["purchase_price"] = selected_total
        else:
            selected_property_fields.discard("purchase_price")
    property_targets = {
        "address",
        "city",
        "state",
        "zip_code",
        "purchase_date",
        "purchase_price",
        "market_value",
        "down_payment",
        "closing_costs",
        "market_value_updated",
    }
    for target in selected_property_fields & property_targets:
        setattr(prop, target, property_field_values.get(target))

    if "market_value" in selected_property_fields:
        prop.market_value_source = "imported"
    if "purchase_date" in selected_property_fields and not prop.market_value_updated:
        prop.market_value_updated = property_field_values.get("purchase_date")
    property_default_data = {
        "purchase_date": prop.purchase_date,
        "original_residency_status": prop.original_residency_status,
        "rental_start_date": prop.rental_start_date,
        "rental_start_date_origin": prop.rental_start_date_origin,
    }
    apply_rental_available_from_default(property_default_data, prop)
    if rental_available_before_purchase(property_default_data):
        raise HTTPException(status_code=422, detail="Rental availability cannot begin before the property was purchased.")
    prop.rental_start_date = property_default_data.get("rental_start_date")
    prop.rental_start_date_origin = property_default_data.get("rental_start_date_origin")

    selected_loan_fields = set(request.selected_loan_fields or [])
    for loan_draft in review["loanDrafts"]:
        existing = db.query(models.Loan).filter(
            models.Loan.property_id == prop.id,
            models.Loan.source_document_id == doc.id,
            models.Loan.import_status.in_(["review_required", "reviewed"]),
        ).first()
        loan = existing or models.Loan(property_id=prop.id)
        loan_field_values = {
            "lender_name": loan_draft.get("lender_name") or "",
            "loan_product": loan_draft.get("loan_product") or "",
            "loan_type": loan_draft.get("loan_type") or "FIXED",
            "status": loan_draft.get("status") or "OPEN",
            "original_amount": _to_float(loan_draft.get("original_amount")),
            "current_balance": _to_float(loan_draft.get("current_balance")),
            "interest_rate": _to_float(loan_draft.get("interest_rate")),
            "monthly_payment": _to_float(loan_draft.get("monthly_payment")),
            "escrow_amount": _to_float(loan_draft.get("escrow_amount")),
            "monthly_property_tax_escrow": _to_float(loan_draft.get("monthly_property_tax_escrow")),
            "monthly_insurance_escrow": _to_float(loan_draft.get("monthly_insurance_escrow")),
            "monthly_mortgage_insurance": _to_float(loan_draft.get("monthly_mortgage_insurance")),
            "monthly_other_escrow": _to_float(loan_draft.get("monthly_other_escrow")),
            "estimated_total_monthly_payment": _to_float(loan_draft.get("estimated_total_monthly_payment")),
            "loan_term_years": _to_int(loan_draft.get("loan_term_years"), 30),
            "origination_date": loan_draft.get("origination_date") or prop.purchase_date,
            "escrow_included": bool(loan_draft.get("escrow_included")),
            "account_number": loan_draft.get("loan_id") or None,
        }
        apply_loan_fields = selected_loan_fields or set(loan_field_values.keys())
        for target, value in loan_field_values.items():
            if target in apply_loan_fields:
                setattr(loan, target, value)
        loan.source_document_id = doc.id
        loan.source_type = doc.doc_category
        loan.import_status = "reviewed"
        loan.current_balance_source = "closing_document_initial_balance"
        loan.current_balance_as_of = loan_draft.get("origination_date") or prop.purchase_date
        loan.current_balance_verified = False
        if not existing:
            db.add(loan)

    db.commit()
    db.refresh(prop)
    address_validation = _address_validation(prop, _safe_extracted_data(doc))
    return {
        "draft": {
            "property": _setup_property_payload(prop),
            "features": {
                "loan": bool(getattr(prop, "loans", []) or []),
                "hoa": bool(prop.hoa_flag or prop.hoa_fee or prop.hoa_special_assessment),
                "solar": bool((prop.solar_ownership or "None") != "None" or prop.solar_monthly_payment or prop.solar_purchase_price),
            },
            "loans": [_setup_loan_payload(loan) for loan in getattr(prop, "loans", []) or []],
        },
        "addressValidation": address_validation,
        "nextSection": "financing",
    }


@router.get("/{doc_id}/loan-statement-review")
def get_loan_statement_review(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return Loan Setup review suggestions for an uploaded mortgage statement."""
    require_premium_user(current_user)
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.doc_category not in {"mortgage_statement", "1098"}:
        raise HTTPException(
            status_code=400,
            detail="This document does not appear to be a mortgage statement or 1098.",
        )
    return _statement_setup_review_payload(doc)


def _loan_doc_year(doc: models.Document, data: Dict[str, Any]) -> int:
    value = doc.statement_year or data.get("statement_year") or data.get("tax_year")
    if isinstance(value, str):
        match = re.search(r"(?:19|20)\d{2}", value)
        return int(match.group(0)) if match else 0
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _loan_doc_sort_key(doc: models.Document, data: Dict[str, Any]) -> tuple:
    parsed = _parse_date(data.get("statement_date")) or _parse_date(data.get("mortgage_acquisition_date")) or _parse_date(data.get("origination_date"))
    return (_loan_doc_year(doc, data), parsed or date.min, doc.id or 0)


def _loan_doc_lender_label(data: Dict[str, Any], account: str) -> str:
    lender = data.get("lender_name") or data.get("servicer_name") or ""
    if lender:
        return lender
    if account == "0064944077":
        return "DHI / LoanCare"
    if account == "3550379001":
        return "Rocket"
    return "Loan"


def _consolidated_loan_document_rows(prop: models.Property, docs: List[models.Document]) -> List[Dict[str, Any]]:
    by_account: Dict[str, List[tuple[models.Document, Dict[str, Any]]]] = {}
    for doc in docs:
        data = _safe_extracted_data(doc)
        account = str(data.get("account_number") or doc.loan_account_number or "").strip()
        if not account:
            continue
        by_account.setdefault(account, []).append((doc, data))

    existing_by_account = {
        str(getattr(loan, "account_number", "") or "").strip(): loan
        for loan in getattr(prop, "loans", []) or []
        if str(getattr(loan, "account_number", "") or "").strip()
    }
    existing_original = next((
        loan for loan in getattr(prop, "loans", []) or []
        if getattr(loan, "source_type", None) == "closing_statement" or not getattr(loan, "servicer_start_date", None)
    ), None)

    rows = []
    for account, entries in by_account.items():
        ordered = sorted(entries, key=lambda item: _loan_doc_sort_key(item[0], item[1]))
        latest_doc, latest_data = ordered[-1]
        acquisition_entry = next(((doc, data) for doc, data in ordered if data.get("mortgage_acquisition_date")), None)
        origination_entry = next(((doc, data) for doc, data in ordered if data.get("origination_date")), None)
        latest_statement_entry = next(((doc, data) for doc, data in reversed(ordered) if data.get("statement_date")), (latest_doc, latest_data))
        source_loan = existing_by_account.get(account)
        if source_loan is None and not acquisition_entry and existing_original is not None:
            source_loan = existing_original

        start_date = None
        closed_date = None
        status = "OPEN"
        if acquisition_entry:
            start_date = _parse_date(acquisition_entry[1].get("mortgage_acquisition_date"))
            status = "OPEN"
        else:
            start_date = _parse_date((origination_entry or latest_statement_entry)[1].get("origination_date")) or _parse_date(getattr(source_loan, "origination_date", None))

        opening_doc, opening_data = acquisition_entry or ordered[0]
        original_amount = _to_float(getattr(source_loan, "original_amount", None)) if source_loan else None
        if original_amount is None or original_amount <= 0:
            original_amount = _to_float(opening_data.get("original_amount") or opening_data.get("loan_amount") or opening_data.get("current_balance"))

        rows.append({
            "accountNumber": account,
            "lenderName": _loan_doc_lender_label(latest_data, account),
            "status": status,
            "originationDate": (start_date.isoformat() if start_date and not acquisition_entry else (_parse_date((origination_entry or latest_statement_entry)[1].get("origination_date")) or start_date or date.today()).isoformat()),
            "servicerStartDate": start_date.isoformat() if start_date and acquisition_entry else None,
            "closedDate": closed_date,
            "originalAmount": original_amount,
            "currentBalance": _to_float(latest_data.get("current_balance")),
            "interestRate": _to_float(latest_data.get("interest_rate")),
            "monthlyPayment": _to_float(latest_data.get("monthly_payment")),
            "escrowAmount": _to_float(latest_data.get("escrow_amount")),
            "monthlyPropertyTaxEscrow": _to_float(latest_data.get("monthly_property_tax_escrow")),
            "monthlyInsuranceEscrow": _to_float(latest_data.get("monthly_insurance_escrow")),
            "monthlyMortgageInsurance": _to_float(latest_data.get("monthly_mortgage_insurance")),
            "monthlyOtherEscrow": _to_float(latest_data.get("monthly_other_escrow")),
            "estimatedTotalMonthlyPayment": _to_float(latest_data.get("estimated_total_monthly_payment")),
            "statementDate": (_parse_date(latest_statement_entry[1].get("statement_date")) or None).isoformat() if latest_statement_entry[1].get("statement_date") else None,
            "sourceDocumentIds": [doc.id for doc, _data in ordered],
            "sourceYears": sorted({_loan_doc_year(doc, data) for doc, data in ordered if _loan_doc_year(doc, data)}),
            "sourceLabels": [doc.original_filename or doc.filename for doc, _data in ordered],
            "priorityNote": "Latest tax year / statement date selected for balances; 1098 account number is canonical.",
        })

    rows.sort(key=lambda row: (row.get("servicerStartDate") or row.get("originationDate") or "", row.get("accountNumber") or ""))
    for index, row in enumerate(rows):
        next_row = rows[index + 1] if index + 1 < len(rows) else None
        if next_row and next_row.get("servicerStartDate"):
            parsed = _parse_date(next_row["servicerStartDate"])
            if parsed:
                row["closedDate"] = _one_month_before(parsed).isoformat()
                row["status"] = "CLOSED"
        row["sequence"] = index + 1
    return rows


def _owned_loan_docs(db: Session, current_user: models.User, request: ConsolidatedLoanDocumentsRequest) -> tuple[models.Property, List[models.Document]]:
    prop = db.query(models.Property).filter(
        models.Property.id == request.property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    docs = db.query(models.Document).filter(
        models.Document.id.in_(request.document_ids or []),
        models.Document.owner_id == current_user.id,
    ).all()
    if len(docs) != len(set(request.document_ids or [])):
        raise HTTPException(status_code=404, detail="One or more documents were not found.")
    for doc in docs:
        if doc.doc_category not in {"mortgage_statement", "1098"}:
            raise HTTPException(status_code=400, detail="Only 1098 and mortgage statement documents can be consolidated for loans.")
        if doc.property_id and doc.property_id != prop.id:
            raise HTTPException(status_code=409, detail="One or more documents are linked to a different property.")
    return prop, docs


@router.post("/loan-documents/consolidated-review")
def consolidated_loan_documents_review(
    request: ConsolidatedLoanDocumentsRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    prop, docs = _owned_loan_docs(db, current_user, request)
    rows = _consolidated_loan_document_rows(prop, docs)
    return {
        "schemaVersion": "loan-documents-consolidated-v1",
        "propertyId": prop.id,
        "documentIds": [doc.id for doc in docs],
        "loanRows": rows,
        "summary": f"{len(docs)} documents analyzed into {len(rows)} loan rows.",
        "requiresConfirmation": True,
    }


@router.post("/loan-documents/apply-consolidated")
def apply_consolidated_loan_documents(
    request: ConsolidatedLoanDocumentsRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    prop, docs = _owned_loan_docs(db, current_user, request)
    rows = _consolidated_loan_document_rows(prop, docs)
    group_id = next((getattr(loan, "loan_group_id", None) for loan in prop.loans if getattr(loan, "loan_group_id", None)), None) or f"loan-chain-{uuid.uuid4()}"
    existing_original = next((
        loan for loan in prop.loans
        if getattr(loan, "source_type", None) == "closing_statement" or not getattr(loan, "servicer_start_date", None)
    ), None)
    applied_ids = []
    for row in rows:
        account = row.get("accountNumber")
        loan = next((item for item in prop.loans if (item.account_number or "").strip() == account), None)
        if loan is None and row.get("sequence") == 1 and existing_original is not None:
            loan = existing_original
        if loan is None:
            loan = models.Loan(
                property_id=prop.id,
                lender_name=row.get("lenderName") or "",
                loan_type="FIXED",
                original_amount=_to_float(row.get("originalAmount")),
                current_balance=_to_float(row.get("currentBalance")),
                interest_rate=_to_float(row.get("interestRate")),
                monthly_payment=_to_float(row.get("monthlyPayment")),
                loan_term_years=30,
                origination_date=row.get("originationDate"),
                account_number=account,
            )
            db.add(loan)
            db.flush()
        loan.lender_name = row.get("lenderName") or loan.lender_name
        loan.account_number = account or loan.account_number
        loan.status = row.get("status") or loan.status or "OPEN"
        loan.closed_date = row.get("closedDate")
        loan.closure_reason = "Servicing transfer" if loan.closed_date else None
        loan.transfer_reason = "Servicing transfer" if len(rows) > 1 else loan.transfer_reason
        loan.loan_group_id = group_id if len(rows) > 1 else loan.loan_group_id
        loan.servicer_sequence = row.get("sequence")
        loan.servicer_start_date = row.get("servicerStartDate") or loan.servicer_start_date or row.get("originationDate")
        loan.servicer_end_date = row.get("closedDate")
        loan.is_current_servicer = row.get("status") != "CLOSED"
        loan.original_amount = _to_float(row.get("originalAmount")) or loan.original_amount
        loan.current_balance = _to_float(row.get("currentBalance")) or loan.current_balance
        loan.interest_rate = _to_float(row.get("interestRate")) or loan.interest_rate
        loan.monthly_payment = _to_float(row.get("monthlyPayment")) or loan.monthly_payment
        loan.monthly_property_tax_escrow = _to_float(row.get("monthlyPropertyTaxEscrow")) or loan.monthly_property_tax_escrow
        loan.monthly_insurance_escrow = _to_float(row.get("monthlyInsuranceEscrow")) or loan.monthly_insurance_escrow
        loan.monthly_mortgage_insurance = _to_float(row.get("monthlyMortgageInsurance")) or loan.monthly_mortgage_insurance
        loan.monthly_other_escrow = _to_float(row.get("monthlyOtherEscrow")) or loan.monthly_other_escrow
        component_total = _escrow_component_total_from_mapping({
            "monthly_property_tax_escrow": loan.monthly_property_tax_escrow,
            "monthly_insurance_escrow": loan.monthly_insurance_escrow,
            "monthly_mortgage_insurance": loan.monthly_mortgage_insurance,
            "monthly_other_escrow": loan.monthly_other_escrow,
        })
        latest_escrow_total = _to_float(row.get("escrowAmount")) or component_total
        if latest_escrow_total > 0:
            loan.escrow_amount = latest_escrow_total
            loan.escrow_included = True
        if _to_float(row.get("estimatedTotalMonthlyPayment")) > 0:
            loan.estimated_total_monthly_payment = _to_float(row.get("estimatedTotalMonthlyPayment"))
        elif loan.monthly_payment and latest_escrow_total > 0:
            loan.estimated_total_monthly_payment = round(float(loan.monthly_payment or 0) + latest_escrow_total, 2)
        loan.statement_date = row.get("statementDate") or loan.statement_date
        source_document_ids = row.get("sourceDocumentIds") or []
        if source_document_ids:
            loan.source_document_id = source_document_ids[-1]
        loan.source_type = "consolidated_loan_documents"
        loan.import_status = "reviewed"
        applied_ids.append(loan.id)
    ordered = sorted([loan for loan in prop.loans if loan.loan_group_id == group_id], key=lambda loan: loan.servicer_sequence or 99)
    for index, loan in enumerate(ordered[:-1]):
        loan.replacement_loan_id = ordered[index + 1].id
    for doc in docs:
        doc.property_id = prop.id
        data = _safe_extracted_data(doc)
        doc.loan_account_number = data.get("account_number") or doc.loan_account_number
    db.commit()
    db.refresh(prop)
    return {
        "loanRows": _consolidated_loan_document_rows(prop, docs),
        "appliedLoanIds": applied_ids,
        "draft": {
            "property": _setup_property_payload(prop),
            "features": {
                "loan": bool(getattr(prop, "loans", []) or []),
                "hoa": bool(prop.hoa_flag or prop.hoa_fee or prop.hoa_special_assessment),
                "solar": bool((prop.solar_ownership or "None") != "None" or prop.solar_monthly_payment or prop.solar_purchase_price),
            },
            "loans": [_setup_loan_payload(loan) for loan in getattr(prop, "loans", []) or []],
        },
    }


@router.post("/{doc_id}/apply-loan-statement")
def apply_loan_statement(
    doc_id: int,
    request: LoanStatementApplyRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Apply reviewed mortgage-statement fields to one loan in Property Setup."""
    require_premium_user(current_user)
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.doc_category not in {"mortgage_statement", "1098"}:
        raise HTTPException(
            status_code=400,
            detail="This document does not appear to be a mortgage statement or 1098.",
        )
    prop = db.query(models.Property).filter(
        models.Property.id == request.property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if doc.property_id and doc.property_id != prop.id:
        raise HTTPException(status_code=409, detail="Document is linked to a different property.")
    if not doc.property_id:
        doc.property_id = prop.id

    extracted = _apply_loan_document_overrides(doc.doc_category, _safe_extracted_data(doc), request.field_overrides)
    if request.field_overrides:
        doc.extracted_data = json.dumps(extracted)
    review = _statement_setup_review_payload(doc)
    address_validation = _address_validation(prop, extracted)
    if _expense_address_requires_review(address_validation) and not request.address_override:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Confirm this document belongs to the property before applying loan values.",
                "addressValidation": address_validation,
            },
        )
    loan = None
    selected_loan = None
    if request.loan_id:
        selected_loan = db.query(models.Loan).filter(
            models.Loan.id == request.loan_id,
            models.Loan.property_id == prop.id,
        ).first()
    account_number = (extracted.get("account_number") or "").strip()
    matched_loan = next((item for item in prop.loans if account_number and (item.account_number or "").strip() == account_number), None)
    if (
        account_number
        and selected_loan is not None
        and (selected_loan.account_number or "").strip()
        and (selected_loan.account_number or "").strip() != account_number
        and not request.confirm_account_mismatch
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "LOAN_ACCOUNT_MISMATCH_CONFIRMATION_REQUIRED",
                "message": "The document loan account number does not match the selected loan. Confirm before applying it to a different loan account.",
                "loanMapping": _loan_statement_mapping_payload(prop, extracted, request.loan_id),
            },
        )
    extracted_origination = _parse_date(extracted.get("origination_date"))
    selected_origination = _parse_date(selected_loan.origination_date) if selected_loan is not None else None
    is_original_loan_1098 = (
        doc.doc_category == "1098"
        and account_number
        and extracted_origination
        and not extracted.get("mortgage_acquisition_date")
    )
    if matched_loan is not None:
        loan = matched_loan
    elif (
        is_original_loan_1098
        and selected_loan is not None
        and selected_origination
        and abs((extracted_origination - selected_origination).days) <= 7
        and not getattr(selected_loan, "source_type", None) == "1098"
    ):
        loan = selected_loan
    elif is_original_loan_1098:
        original_loan = next((
            item for item in prop.loans
            if _parse_date(getattr(item, "origination_date", None))
            and abs((extracted_origination - _parse_date(getattr(item, "origination_date", None))).days) <= 7
            and getattr(item, "source_type", None) != "1098"
            and not getattr(item, "servicer_start_date", None)
        ), None)
        if original_loan is not None:
            loan = original_loan
    elif selected_loan is not None and (not account_number or not (selected_loan.account_number or "").strip()):
        loan = selected_loan
    if loan is None:
        accountless_loans = [item for item in prop.loans if not (item.account_number or "").strip()]
        if account_number and len(accountless_loans) == 1:
            loan = accountless_loans[0]
    created_loan = False
    if loan is None:
        loan = models.Loan(
            property_id=prop.id,
            lender_name=extracted.get("lender_name") or "",
            loan_type=extracted.get("loan_type") or "FIXED",
            status="OPEN",
            original_amount=_to_float(extracted.get("original_amount") or extracted.get("current_balance")),
            current_balance=_to_float(extracted.get("current_balance")),
            interest_rate=_to_float(extracted.get("interest_rate")),
            monthly_payment=_to_float(extracted.get("monthly_payment")),
            estimated_total_monthly_payment=_to_float(extracted.get("estimated_total_monthly_payment") or extracted.get("monthly_payment")),
            loan_term_years=_to_int(extracted.get("loan_term_years"), 30),
            origination_date=extracted.get("origination_date") or prop.purchase_date,
            account_number=account_number or None,
        )
        db.add(loan)
        created_loan = True

    selected_fields = set(request.selected_loan_fields or [])
    if not selected_fields:
        selected_fields = {field["targetKey"] for field in review["loanFields"]}
    field_values = {field["targetKey"]: field["value"] for field in review["loanFields"]}
    statement_targets = {
        "current_balance",
        "monthly_property_tax_escrow",
        "monthly_insurance_escrow",
        "monthly_mortgage_insurance",
        "monthly_other_escrow",
        "escrow_amount",
        "estimated_total_monthly_payment",
        "statement_date",
        "account_number",
        "origination_date",
        "servicer_start_date",
    }
    for target in selected_fields & statement_targets:
        value = field_values.get(target)
        if target in {"statement_date", "origination_date", "servicer_start_date"}:
            parsed_date = _parse_date(value)
            setattr(loan, target, parsed_date.isoformat() if parsed_date else value)
        elif target == "account_number":
            setattr(loan, target, value)
        else:
            setattr(loan, target, _to_float(value))

    if doc.doc_category == "mortgage_statement":
        escrow_component_fields = {
            "monthly_property_tax_escrow",
            "monthly_insurance_escrow",
            "monthly_mortgage_insurance",
            "monthly_other_escrow",
        }
        for target in escrow_component_fields:
            if extracted.get(target) is not None:
                setattr(loan, target, _to_float(extracted.get(target)))
        component_total = _escrow_component_total_from_mapping({
            "monthly_property_tax_escrow": loan.monthly_property_tax_escrow,
            "monthly_insurance_escrow": loan.monthly_insurance_escrow,
            "monthly_mortgage_insurance": loan.monthly_mortgage_insurance,
            "monthly_other_escrow": loan.monthly_other_escrow,
        })
        latest_escrow_total = _to_float(extracted.get("escrow_amount")) or component_total
        if latest_escrow_total > 0:
            loan.escrow_amount = latest_escrow_total
            loan.escrow_included = True
        if extracted.get("estimated_total_monthly_payment") is not None:
            loan.estimated_total_monthly_payment = _to_float(extracted.get("estimated_total_monthly_payment"))
        elif loan.monthly_payment and latest_escrow_total > 0:
            loan.estimated_total_monthly_payment = round(float(loan.monthly_payment or 0) + latest_escrow_total, 2)

    if selected_fields & {"monthly_property_tax_escrow", "monthly_insurance_escrow", "monthly_mortgage_insurance", "monthly_other_escrow", "escrow_amount"}:
        loan.escrow_included = True
    if account_number and not loan.account_number:
        loan.account_number = account_number
    if account_number:
        doc.loan_account_number = account_number
    loan.source_document_id = doc.id
    loan.source_type = doc.doc_category
    loan.import_status = "reviewed"
    if "current_balance" in selected_fields:
        loan.current_balance_source = "1098_box_2_reported_balance" if doc.doc_category == "1098" else "mortgage_statement_reported_balance"
        loan.current_balance_as_of = extracted.get("statement_date") or loan.statement_date
        loan.current_balance_verified = True
    if created_loan:
        db.flush()
    transfer_result = None
    account_matches_document = bool(account_number and (loan.account_number or "").strip() == account_number)
    if account_matches_document or not account_number:
        db.flush()
        current_loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).all()
        suggestions = [
            suggestion for suggestion in _servicing_transfer_candidates(current_loans)
            if suggestion.get("currentLoanId") == loan.id or suggestion.get("previousLoanId") == loan.id
        ]
        transfer_result = {
            **_loan_statement_mapping_payload(prop, extracted, request.loan_id),
            "requiresConfirmation": True,
            "suggestions": suggestions,
            "message": "Loan document applied. Review any servicing-transfer prompt before closing the old loan.",
        }
    expense_estimates = _apply_escrow_expense_estimates(
        prop,
        current_user.id,
        loan,
        extracted,
        selected_fields,
        db,
    )

    db.commit()
    db.refresh(prop)
    processing_result = _completed_processing_result(
        loan_id=loan.id,
        document_id=doc.id,
        category=doc.doc_category,
        statement_year=_statement_year(extracted, loan),
        updated_at=datetime.utcnow(),
    )
    return {
        "draft": {
            "property": _setup_property_payload(prop),
            "features": {
                "loan": bool(getattr(prop, "loans", []) or []),
                "hoa": bool(prop.hoa_flag or prop.hoa_fee or prop.hoa_special_assessment),
                "solar": bool((prop.solar_ownership or "None") != "None" or prop.solar_monthly_payment or prop.solar_purchase_price),
            },
            "loans": [_setup_loan_payload(item) for item in getattr(prop, "loans", []) or []],
            "annualExpenses": [_annual_expense_out(item) for item in getattr(prop, "annual_expenses", []) or []],
        },
        "loanId": loan.id,
        "loanMapping": {
            **_loan_statement_mapping_payload(prop, extracted, request.loan_id),
            "loanId": loan.id,
            "created": created_loan,
        },
        "document": review["document"],
        "expenseEstimates": expense_estimates,
        "servicingTransfer": transfer_result,
        "nextSection": "financing",
        **processing_result,
    }


@router.post("/{doc_id}/reparse")
async def reparse_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-run extraction (with auto-detection) on an already uploaded file."""
    require_premium_user(current_user)
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = UPLOAD_DIR / doc.filename
    if not path.exists():
        raise HTTPException(
            status_code=410,
            detail="Original uploaded file was discarded after parsing. Upload the document again to reparse it.",
        )

    try:
        category, extracted, markdown = parse_document(str(path), "auto")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse failed: {e}")

    doc.doc_category = category
    doc.extracted_data = json.dumps(extracted)
    doc.loan_account_number = (extracted.get("account_number") or "").strip() or None
    doc.statement_year = extracted.get("statement_year")
    doc.content_hash = _file_hash(path)
    doc.content_fingerprint = _content_fingerprint(category, extracted, doc.statement_year, doc.property_id)
    doc.display_name = _build_display_name(
        category, extracted, doc.statement_year,
        extracted.get("period_start") or extracted.get("statement_date"),
        extracted.get("period_end") or extracted.get("statement_date"),
    )
    if markdown:
        markdown_name = doc.markdown_file or f"{Path(doc.filename).stem}.md"
        (UPLOAD_DIR / markdown_name).write_text(markdown)
        doc.markdown_file = markdown_name
    db.commit()

    if category == "tax_return":
        try:
            await import_tax_return(db, doc.owner_id, doc.id, str(path))
        except Exception:
            pass

    return {
        "id": doc.id,
        "category": category,
        "extracted_data": extracted,
        "document_config": config_as_dict(category),
        "extraction_schema": extraction_schema(category, extracted),
        "has_markdown": bool(doc.markdown_file),
    }


@router.post("/reprocess-all")
async def reprocess_all_documents(
    property_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-run extraction on every stored file, then re-apply the results.

    Useful after parser improvements. Each file is re-parsed with
    auto-detection; documents are then re-applied to their property/loan in
    chronological order so "Statement Details" reflects the latest statement.
    Pass ?property_id= to limit the scope to a single property.
    """
    require_premium_user(current_user)
    q = db.query(models.Document).filter(
        models.Document.owner_id == current_user.id
    )
    if property_id is not None:
        q = q.filter(models.Document.property_id == property_id)
    docs = q.all()

    reprocessed, errors = 0, []
    categories = {}
    by_property = {}
    common_tax_returns = []  # (doc_id, path) for property-agnostic tax returns
    for doc in docs:
        path = UPLOAD_DIR / doc.filename
        if not path.exists():
            errors.append({
                "id": doc.id,
                "file": doc.original_filename,
                "error": "original uploaded file discarded after parsing",
            })
            continue
        try:
            category, extracted, markdown = parse_document(str(path), "auto")
        except Exception as e:
            errors.append({"id": doc.id, "file": doc.original_filename, "error": str(e)})
            continue

        doc.doc_category = category
        doc.extracted_data = json.dumps(extracted)
        doc.loan_account_number = (extracted.get("account_number") or "").strip() or None
        doc.statement_year = extracted.get("statement_year")
        doc.period_type = extracted.get("period_type", "other")
        doc.period_start = extracted.get("period_start") or extracted.get("statement_date")
        doc.period_end = extracted.get("period_end") or extracted.get("statement_date")
        doc.content_hash = _file_hash(path)
        doc.content_fingerprint = _content_fingerprint(category, extracted, doc.statement_year, doc.property_id)
        doc.display_name = _build_display_name(
            category, extracted, doc.statement_year, doc.period_start, doc.period_end,
        )
        if markdown:
            markdown_name = doc.markdown_file or f"{Path(doc.filename).stem}.md"
            (UPLOAD_DIR / markdown_name).write_text(markdown)
            doc.markdown_file = markdown_name

        reprocessed += 1
        categories[category] = categories.get(category, 0) + 1
        if doc.property:
            by_property.setdefault(doc.property, []).append(extracted)
        elif category == "tax_return":
            common_tax_returns.append((doc.id, str(path)))

    # Re-apply property docs in chronological order
    for prop, extracted_list in by_property.items():
        extracted_list.sort(
            key=lambda d: _parse_date(d.get("statement_date")) or _parse_date("01/01/1900")
        )
        for data in extracted_list:
            _apply_extracted(db, prop, data)

    db.commit()

    # Re-import common tax returns
    for doc_id, path in common_tax_returns:
        try:
            await import_tax_return(db, current_user.id, doc_id, path)
        except Exception:
            pass
    return {
        "reprocessed": reprocessed,
        "total": len(docs),
        "categories": categories,
        "errors": errors,
    }


@router.post("/{doc_id}/apply")
def apply_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Apply a document's extracted fields to its property and loan."""
    require_premium_user(current_user)
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.property:
        data = json.loads(doc.extracted_data) if doc.extracted_data else {}
        return {
            "applied": {},
            "document_config": config_as_dict(doc.doc_category),
            "extraction_schema": extraction_schema(doc.doc_category, data),
            "message": "Common documents (tax returns) apply to all properties automatically",
        }

    data = json.loads(doc.extracted_data) if doc.extracted_data else {}
    applied = _apply_extracted(db, doc.property, data, doc.doc_category)

    if not applied:
        return {
            "applied": {},
            "document_config": config_as_dict(doc.doc_category),
            "extraction_schema": extraction_schema(doc.doc_category, data),
            "message": "No applicable fields found in this document",
        }

    db.commit()
    return {
        "applied": applied,
        "document_config": config_as_dict(doc.doc_category),
        "extraction_schema": extraction_schema(doc.doc_category, data),
        "message": f"Applied {len(applied)} field(s)",
    }


@router.get("/property/{property_id}")
def list_documents(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    # Allow owner or anyone the owner has shared with
    if prop.owner_id != current_user.id:
        share = db.query(models.UserSharing).filter(
            models.UserSharing.owner_id == prop.owner_id,
            models.UserSharing.shared_with_id == current_user.id,
        ).first()
        if not share:
            raise HTTPException(status_code=403, detail="Access denied")

    docs = db.query(models.Document).filter(
        models.Document.property_id == property_id
    ).all()

    dup_ids = detect_duplicate_ids(docs)
    for d in docs:
        ensure_document_record_uuid(d)
    db.commit()

    return [
        {
            "id": d.id,
            "record_uuid": d.record_uuid,
            "original_filename": d.original_filename,
            "display_name": d.display_name or d.original_filename,
            "file_type": d.file_type,
            "doc_category": d.doc_category,
            "file_size": d.file_size,
            "extracted_data": _safe_extracted_data(d),
            "document_config": config_as_dict(d.doc_category),
            "extraction_schema": extraction_schema(d.doc_category, _safe_extracted_data(d)),
            "loan_account_number": d.loan_account_number,
            "statement_year": d.statement_year,
            "period_type": d.period_type,
            "period_start": d.period_start,
            "period_end": d.period_end,
            "upload_date": d.upload_date,
            "has_markdown": bool(d.markdown_file),
            "is_duplicate": d.id in dup_ids,
        }
        for d in docs
    ]


def _delete_document_and_dependents(db: Session, doc: models.Document):
    """Remove a document's file(s) and every record derived from it, so
    deleting a document doesn't leave stale data behind elsewhere in the app
    (e.g. a tax return's TaxReturnEntry rows outliving the source file)."""
    try:
        os.remove(UPLOAD_DIR / doc.filename)
    except FileNotFoundError:
        pass
    if doc.markdown_file:
        try:
            os.remove(UPLOAD_DIR / doc.markdown_file)
        except FileNotFoundError:
            pass
    db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.document_id == doc.id
    ).delete()
    db.query(models.Loan).filter(
        models.Loan.source_document_id == doc.id
    ).update({
        models.Loan.source_document_id: None,
        models.Loan.source_type: None,
        models.Loan.import_status: None,
    }, synchronize_session=False)
    db.delete(doc)


@router.post("/delete-batch")
def delete_documents_batch(
    req: BatchDeleteRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Delete multiple documents at once."""
    docs = (
        db.query(models.Document)
        .filter(
            models.Document.id.in_(req.ids),
            models.Document.owner_id == current_user.id,
        )
        .all()
    )
    deleted = []
    for doc in docs:
        _delete_document_and_dependents(db, doc)
        deleted.append(doc.id)
    db.commit()
    return {"deleted": deleted, "count": len(deleted)}


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    _delete_document_and_dependents(db, doc)
    db.commit()
    return {"ok": True}
