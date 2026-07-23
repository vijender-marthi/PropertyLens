import os
import json
import logging
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
from services.property_valuation import apply_default_market_price, apply_default_settlement_total
from services.expense_source_engine import replace_escrow_activities, rebuild_annual_expenses, metric_dto
from services.loan_lifecycle import (
    SETUP_DELINKED_TAG,
    classify_document,
    lifecycle_dto,
    resolve_property_lifecycle,
)
from services.canonical_loan import apply_periodic_loan_evidence, resolve_canonical_loan


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
from services.document_conversion import MarkItDownConverter
from services.property_tax_parser import (
    PARSER_NAME as PROPERTY_TAX_PARSER_NAME,
    PARSER_VERSION as PROPERTY_TAX_PARSER_VERSION,
    classify_property_tax_document,
    parse_property_tax_document,
    validate_property_tax_document,
)
from services.formatters import format_currency, format_interest_rate, format_percent
from services.document_config import (
    DOCUMENT_TYPE_CONFIG,
    config_as_dict,
    extraction_schema,
    get_document_config,
    mapped_loan_fields,
)

router = APIRouter(prefix="/api/documents", tags=["documents"])
property_tax_router = APIRouter(prefix="/api/properties", tags=["property taxes"])
property_tax_logger = logging.getLogger("propertylens.property_tax_pipeline")


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
    address_override: bool = False


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


class PropertyTaxCorrectionRequest(BaseModel):
    field_path: str
    value: Any
    reason: Optional[str] = None

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
    elif category in {"loan_disclosure", "closing_statement"}:
        if not data.get("account_number") and data.get("loan_id"):
            data["account_number"] = str(data.get("loan_id")).strip()
        if data.get("original_amount") is None and data.get("loan_amount") is not None:
            data["original_amount"] = data.get("loan_amount")
        if data.get("current_balance") is None and data.get("original_amount") is not None:
            data["current_balance"] = data.get("original_amount")
            data["current_balance_source"] = "loan_disclosure_initial_balance"
            data["current_balance_verified"] = False
    return data


def _is_supported_loan_document(category: str, extracted: Dict[str, Any]) -> bool:
    # Closing/settlement statements are loan-bearing documents even when
    # extraction is incomplete (e.g. a scanned PDF). Allow them through so the
    # review opens with whatever parsed and the user can fill the rest by hand,
    # instead of dead-ending on a "no supported loan terms" error.
    return category in {"mortgage_statement", "1098", "loan_disclosure", "closing_statement"}


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


def _closing_address_validation(document: models.Document, extracted: Dict[str, Any]) -> Dict[str, Any]:
    validation = _address_validation(getattr(document, "property", None), extracted)
    override = extracted.get("_address_override") or {}
    prop = getattr(document, "property", None)
    normalized_property = validation.get("normalizedPropertyAddress") or ""
    override_matches_property = (
        str(override.get("propertyId") or "") == str(getattr(prop, "id", "") or "")
        and override.get("normalizedPropertyAddress") == normalized_property
    )
    if validation.get("status") == "document_address_missing" and override_matches_property:
        return {
            **validation,
            "status": "manual_override",
            "canContinue": True,
            "overrideApplied": True,
            "overrideAppliedAt": override.get("appliedAt"),
            "overrideAppliedBy": override.get("appliedBy"),
        }
    return validation


def _purchase_price_selection_payload(extracted: Dict[str, Any], setup_import_role: str = "closing_document") -> Optional[Dict[str, Any]]:
    sale_price = _to_float(extracted.get("sale_price") or extracted.get("purchase_price"))

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
        ("settlement_total_amount", "Settlement accounting total"),
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
    home_purchase_price = _to_float(extracted.get("sale_price") or extracted.get("purchase_price"))
    explicit_closing_costs = extracted.get("closing_costs")
    if home_purchase_price:
        review_extracted["purchase_price"] = round(home_purchase_price, 2)
    if explicit_closing_costs is not None:
        review_extracted["closing_costs"] = explicit_closing_costs
    settlement_accounting_total = extracted.get("settlement_debit_total")
    if settlement_accounting_total is None:
        settlement_accounting_total = extracted.get("settlement_credit_total")
    if settlement_accounting_total is not None:
        review_extracted["settlement_accounting_total"] = settlement_accounting_total
    parsed_purpose = str(extracted.get("transaction_purpose") or "").upper()
    is_acquisition = parsed_purpose == "PURCHASE" or (
        parsed_purpose in {"", "UNKNOWN"}
        and home_purchase_price is not None
        and extracted.get("prior_loan_payoff_amount") is None
    )
    property_fields = [
        _setup_field(review_extracted, "property_address", "address", "Street address"),
        _setup_field(review_extracted, "property_city", "city", "City"),
        _setup_field(review_extracted, "property_state", "state", "State"),
        _setup_field(review_extracted, "property_zip", "zip_code", "ZIP"),
        _setup_field(review_extracted, "purchase_date", "purchase_date", "Purchase date", "date", 0.95),
        _setup_field(review_extracted, "purchase_price", "purchase_price", "Purchase price", "currency", 0.95),
        _setup_field(review_extracted, "down_payment", "down_payment", "Down payment", "currency", 0.88),
        _setup_field(review_extracted, "closing_costs", "closing_costs", "Closing costs", "currency", 0.84),
        _setup_field(review_extracted, "deposit_paid_before_closing", "deposit_paid_before_closing", "Deposit paid before closing", "currency", 0.94),
        _setup_field(review_extracted, "total_due_from_borrower", "total_due_from_borrower", "Total due from borrower", "currency", 0.99),
        _setup_field(review_extracted, "total_paid_on_behalf_of_borrower", "total_paid_on_behalf_of_borrower", "Total paid already/on behalf", "currency", 0.96),
        _setup_field(review_extracted, "settlement_accounting_total", "settlement_total_amount", "Settlement accounting total", "currency", 0.99),
    ]
    property_fields = [
        field for field in property_fields
        if field and (is_acquisition or field["targetKey"] in {"address", "city", "state", "zip_code"})
    ]
    purchase_price_selection = _purchase_price_selection_payload(review_extracted, setup_import_role)
    settlement_calculations = _settlement_calculations_payload(review_extracted)

    original_amount = _to_float(extracted.get("original_amount") or extracted.get("loan_amount")) or 0
    if setup_import_role == "settlement_document":
        # Settlement statements describe the purchase totals, not the loan, so
        # they never seed a loan draft (the loan comes from the closing
        # disclosure).
        original_amount = 0
    # A closing disclosure always establishes a loan. Surface a draft even when
    # extraction was incomplete (e.g. a scanned statement) so the user can fill
    # the terms manually instead of hitting a dead end when re-importing.
    loan_detected = setup_import_role != "settlement_document"
    loan_draft = None
    loan_fields = []
    if loan_detected:
        current_balance = original_amount or ""
        loan_draft = {
            "lender_name": extracted.get("lender_name") or "",
            "loan_type": extracted.get("loan_type") or "FIXED",
            "loan_product": extracted.get("loan_product") or ("Conventional" if "conventional" in markdown.lower() else ""),
            "purpose": "Purchase" if "purchase" in markdown.lower() else "",
            "original_amount": original_amount or "",
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
        "addressValidation": _closing_address_validation(document, extracted),
        "warnings": warnings,
    }


def _statement_setup_review_payload(document: models.Document) -> Dict[str, Any]:
    extracted = _normalize_loan_document_extracted(document.doc_category, _safe_extracted_data(document))
    is_disclosure = document.doc_category in {"loan_disclosure", "closing_statement"}
    current_balance = extracted.get("current_balance")
    statement_fields = [
        _setup_field(extracted, "lender_name", "lender_name", "Lender", "text", 0.94),
        _setup_field(extracted, "account_number", "account_number", "Loan account number", "text", 0.98),
        _setup_field(extracted, "original_amount", "original_amount", "Original loan amount", "currency", 0.96) if is_disclosure else None,
        _setup_field(extracted, "current_balance", "current_balance", "Opening balance", "currency", 0.9) if is_disclosure else _setup_field(extracted, "current_balance", "current_balance", "Current balance", "currency", 0.92),
        _setup_field(extracted, "interest_rate", "interest_rate", "Interest rate", "percent", 0.95),
        _setup_field(extracted, "loan_type", "loan_type", "Loan type", "text", 0.94) if is_disclosure else None,
        _setup_field(extracted, "loan_product", "loan_product", "Loan product", "text", 0.88) if is_disclosure else None,
        _setup_field(extracted, "transaction_purpose", "purpose", "Purpose", "text", 0.9) if is_disclosure else None,
        _setup_field(extracted, "loan_term_years", "loan_term_years", "Term", "text", 0.95) if is_disclosure else None,
        _setup_field(extracted, "monthly_payment", "monthly_payment", "Monthly principal & interest", "currency", 0.95),
        _setup_field(extracted, "principal_due", "principal_due", "Current payment principal", "currency", 0.96),
        _setup_field(extracted, "interest_due", "interest_due", "Current payment interest", "currency", 0.96),
        _setup_field(extracted, "principal_paid_ytd", "principal_paid_ytd", "Principal paid YTD", "currency", 0.98),
        _setup_field(extracted, "interest_paid_ytd", "interest_paid_ytd", "Interest paid YTD", "currency", 0.98),
        _setup_field(extracted, "statement_date", "statement_date", "Statement date", "date", 0.9),
        _setup_field(extracted, "payment_due_date", "payment_due_date", "Payment due date", "date", 0.9),
        _setup_field(extracted, "maturity_date", "maturity_date", "Maturity date", "date", 0.9),
        _setup_field(extracted, "origination_date", "origination_date", "Mortgage origination date", "date", 0.9),
        _setup_field(extracted, "mortgage_acquisition_date", "servicer_start_date", "Mortgage acquisition date", "date", 0.94),
    ]
    statement_fields = [field for field in statement_fields if field]
    statement_draft = {
        "current_balance": current_balance or "",
        "statement_date": extracted.get("statement_date") or "",
        "origination_date": extracted.get("origination_date") or "",
        "servicer_start_date": extracted.get("mortgage_acquisition_date") or "",
        "account_number": extracted.get("account_number") or "",
        "sourceDocumentId": document.id,
        "sourceDocumentType": document.doc_category,
        "importStatus": "review_required",
        "importStatusLabel": "Statement imported · Review values",
        "current_balance_source": "loan_disclosure_initial_balance" if is_disclosure else "mortgage_statement_reported_balance",
        "current_balance_source_label": "Opening balance from loan disclosure" if is_disclosure else "Reported from mortgage statement",
        "current_balance_verification_status": "Needs latest mortgage statement" if is_disclosure else "Reported",
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
        "warnings": ["Loan disclosure values establish opening loan terms. Current balance, YTD principal, and interest require a 1098 or mortgage statement."] if is_disclosure else [],
    }


def _escrow_component_total_from_mapping(data: Dict[str, Any]) -> float:
    return round(
        _to_float(data.get("monthly_property_tax_escrow"))
        + _to_float(data.get("monthly_insurance_escrow"))
        + _to_float(data.get("monthly_mortgage_insurance"))
        + _to_float(data.get("monthly_other_escrow")),
        2,
    )


def _normalized_monthly_escrow_total(data: Dict[str, Any]) -> float:
    """Return the single monthly escrow total.

    Some statements provide both a total escrow payment and component lines
    including mortgage insurance. The total already includes those components,
    so callers must not add mortgage insurance again.
    """
    reported_total = _to_float(data.get("escrow_amount"))
    component_total = _escrow_component_total_from_mapping(data)
    return round(reported_total if reported_total > 0 else component_total, 2)


def _normalized_total_monthly_payment(data: Dict[str, Any], monthly_pi: Any = None) -> float:
    reported_total = _to_float(data.get("estimated_total_monthly_payment"))
    if reported_total > 0:
        return reported_total
    pi_payment = _to_float(monthly_pi if monthly_pi is not None else data.get("monthly_payment"))
    escrow_total = _normalized_monthly_escrow_total(data)
    return round(pi_payment + escrow_total, 2) if pi_payment > 0 and escrow_total > 0 else pi_payment


def _loan_statement_mapping_payload(prop: Optional[models.Property], extracted: Dict[str, Any], selected_loan_id: Optional[int] = None) -> Dict[str, Any]:
    account_number = (extracted.get("account_number") or "").strip()
    loans = list(getattr(prop, "loans", []) or [])
    selected = next((loan for loan in loans if loan.id == selected_loan_id), None) if selected_loan_id else None
    matched = next((loan for loan in loans if _account_numbers_match(loan.account_number, account_number)), None)
    if matched:
        return {
            "accountNumber": account_number,
            "matchType": "matched_account",
            "loanId": matched.id,
            "message": "Statement account number matches an existing loan.",
        }
    if account_number and selected and (selected.account_number or "").strip() and not _account_numbers_match(selected.account_number, account_number):
        purpose = str(extracted.get("transaction_purpose") or extracted.get("loan_purpose") or "").upper()
        if purpose == "REFINANCE":
            return {
                "accountNumber": account_number,
                "matchType": "refinance_candidate",
                "loanId": None,
                "selectedLoanId": selected.id,
                "selectedAccountNumber": (selected.account_number or "").strip(),
                "message": "Refinance detected. Applying this document will add the replacement loan and close the prior open loan on the refinance disbursement date.",
            }
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


def _normalized_account(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _account_numbers_match(left: Any, right: Any) -> bool:
    """Match canonical accounts and disclosure IDs carrying a sub-account suffix."""
    left_account = _normalized_account(left)
    right_account = _normalized_account(right)
    if not left_account or not right_account:
        return False
    if left_account == right_account:
        return True
    shorter, longer = sorted((left_account, right_account), key=len)
    return len(shorter) >= 8 and longer.startswith(shorter)


def _amount_close(left: Any, right: Any, tolerance: float = 1.0) -> bool:
    left_amount = _to_float(left)
    right_amount = _to_float(right)
    return bool(left_amount and right_amount and abs(left_amount - right_amount) <= tolerance)


def _same_date(left: Any, right: Any) -> bool:
    left_date = _parse_date(left)
    right_date = _parse_date(right)
    return bool(left_date and right_date and left_date == right_date)


def _find_existing_setup_import_loan(prop: models.Property, doc: models.Document, loan_values: Dict[str, Any]) -> Optional[models.Loan]:
    """Find the purchase loan represented by a closing document import.

    Re-applying a setup/closing document may use a newly uploaded duplicate
    document, so source_document_id alone is not enough. Prefer exact source
    linkage, then account number, then the stable purchase-loan fingerprint
    from closing disclosures: origination date + original amount + rate.
    """
    loans = list(getattr(prop, "loans", []) or [])
    if not loans:
        return None

    linked = next((
        loan for loan in loans
        if getattr(loan, "source_document_id", None) == doc.id
        and getattr(loan, "import_status", None) in {"review_required", "reviewed", None}
    ), None)
    if linked:
        return linked

    account = _normalized_account(loan_values.get("account_number"))
    if account:
        by_account = next((loan for loan in loans if _account_numbers_match(getattr(loan, "account_number", None), account)), None)
        if by_account:
            return by_account

    origination_date = loan_values.get("origination_date")
    original_amount = loan_values.get("original_amount")
    interest_rate = loan_values.get("interest_rate")
    candidates = [
        loan for loan in loans
        if _same_date(getattr(loan, "origination_date", None), origination_date)
        and _amount_close(getattr(loan, "original_amount", None), original_amount, tolerance=2.0)
    ]
    if len(candidates) == 1:
        return candidates[0]

    rate_candidates = [
        loan for loan in candidates
        if not interest_rate or _amount_close(getattr(loan, "interest_rate", None), interest_rate, tolerance=0.01)
    ]
    if len(rate_candidates) == 1:
        return rate_candidates[0]

    closing_candidates = [
        loan for loan in loans
        if getattr(loan, "source_type", None) == doc.doc_category
        and _amount_close(getattr(loan, "original_amount", None), original_amount, tolerance=2.0)
        and (not interest_rate or _amount_close(getattr(loan, "interest_rate", None), interest_rate, tolerance=0.01))
    ]
    if len(closing_candidates) == 1:
        return closing_candidates[0]

    return None


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
        "settlement_total_amount": prop.settlement_total_amount or 0,
        "cash_to_close": prop.cash_to_close or 0,
        "deposit_paid_before_closing": prop.deposit_paid_before_closing or 0,
        "total_due_from_borrower": prop.total_due_from_borrower or 0,
        "total_paid_on_behalf_of_borrower": prop.total_paid_on_behalf_of_borrower or 0,
        "settlement_debit_total": prop.settlement_debit_total or 0,
        "settlement_credit_total": prop.settlement_credit_total or 0,
        "seller_credits": prop.seller_credits or 0,
        "tax_prorations": prop.tax_prorations or 0,
        "hoa_prorations": prop.hoa_prorations or 0,
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
    document: models.Document,
    extracted: Dict[str, Any],
    db: Session,
) -> Dict[str, Any]:
    year = _statement_year(extracted, loan)
    if not year:
        return {}

    estimate_specs = [
        ("propertyTax", "property_tax", "property_tax_source", "monthly_property_tax_escrow"),
        ("insurance", "insurance", "insurance_source", "monthly_insurance_escrow"),
    ]
    available_estimate_specs = [
        spec for spec in estimate_specs
        if _to_float(extracted.get(spec[3])) > 0
    ]
    if not available_estimate_specs:
        return {}

    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == year,
    ).first()
    if not row:
        row = models.AnnualExpense(property_id=prop.id, owner_id=owner_id, year=year, source_status="estimated")
        db.add(row)

    result = {"year": year, "warnings": []}
    for response_key, field, source_field, loan_field in available_estimate_specs:
        annual_value = round(_to_float(extracted.get(loan_field)) * 12, 2)
        current_source = annual_expense_source_key(getattr(row, source_field, None))
        current_value = float(getattr(row, field, 0) or 0)
        applied = _can_apply_escrow_estimate(row, field, source_field)
        if applied:
            setattr(row, field, annual_value)
            setattr(row, source_field, EXPENSE_SOURCE_ESCROW_ESTIMATE)
            _set_annual_expense_source_document(
                row,
                field,
                document,
                annual_value,
                "mortgage_statement",
            )
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
        "purpose": loan.purpose,
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
    allowed_loan_fields = mapped_loan_fields(category) if category else LOAN_FIELDS
    loan_updates = {k: v for k, v in data.items() if k in allowed_loan_fields and v is not None}
    borrowers = "; ".join(
        data[k] for k in ("borrower_1", "borrower_2", "borrower_3", "borrower_4")
        if data.get(k)
    )
    if borrowers:
        loan_updates["borrowers"] = borrowers

    if loan_updates:
        # Generic extraction may enrich an existing debt, but canonical loan
        # creation belongs to the transaction resolver after the document is
        # persisted and classified.
        loan = None
        if account_number:
            loan = next((l for l in prop.loans if l.account_number == account_number), None)
            if loan is None:
                accountless_loans = [l for l in prop.loans if not (l.account_number or "").strip()]
                loan = accountless_loans[0] if len(accountless_loans) == 1 else None
        if loan is None:
            loan = prop.loans[0] if prop.loans and not account_number else None
        if loan is None:
            loan_updates = {}

        # "Statement Details" must reflect the LATEST statement only. If this
        # document is older than the loan's current statement (or is undated
        # while the loan already has a dated statement), keep the existing
        # snapshot and apply only the static identity/origination fields.
        if loan is not None:
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

    # Only an acquisition transaction may populate immutable purchase fields.
    is_purchase_transaction = str(data.get("transaction_purpose") or "").upper() == "PURCHASE"
    if is_purchase_transaction and data.get("purchase_price") is not None:
        prop.purchase_price = data["purchase_price"]
        applied["property.purchase_price"] = data["purchase_price"]
    purchase_date = data.get("purchase_date") or data.get("closing_date")
    if is_purchase_transaction and purchase_date:
        prop.purchase_date = purchase_date
        applied["property.purchase_date"] = purchase_date
    if data.get("recorded_date"):
        prop.recorded_date = data["recorded_date"]
        applied["property.recorded_date"] = data["recorded_date"]
    if is_purchase_transaction and data.get("closing_costs") is not None:
        prop.closing_costs = data["closing_costs"]
        applied["property.closing_costs"] = data["closing_costs"]
    if is_purchase_transaction:
        for target in (
            "down_payment", "cash_to_close", "deposit_paid_before_closing",
            "total_due_from_borrower", "total_paid_on_behalf_of_borrower",
            "settlement_debit_total", "settlement_credit_total", "seller_credits",
            "tax_prorations", "hoa_prorations",
        ):
            if data.get(target) is not None:
                setattr(prop, target, data[target])
                applied[f"property.{target}"] = data[target]
    if is_purchase_transaction and (data.get("purchase_price") is not None or purchase_date):
        valuation_data = {
            "purchase_price": prop.purchase_price,
            "purchase_date": prop.purchase_date,
            "market_value": prop.market_value,
            "market_value_source": prop.market_value_source,
            "market_value_updated": prop.market_value_updated,
        }
        apply_default_market_price(valuation_data, existing_source=prop.market_value_source)
        prop.market_value = valuation_data["market_value"]
        prop.market_value_source = valuation_data["market_value_source"]
        prop.market_value_updated = valuation_data.get("market_value_updated")
        applied["property.market_value"] = prop.market_value
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
        "docType": (
            "escrow analysis"
            if category == "escrow_analysis"
            else "mortgage statement"
            if category == "mortgage_statement"
            else "tax bill"
            if field == "property_tax"
            else "insurance document"
        ),
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


def _escrow_payment_out(row: models.EscrowPayment) -> Dict[str, Any]:
    return {
        "id": row.id,
        "propertyId": row.property_id,
        "loanId": row.loan_id,
        "documentId": row.document_id,
        "loanNumber": row.loan_number,
        "propertyAddress": row.property_address,
        "statementDate": row.statement_date,
        "effectiveDate": row.effective_date,
        "historyPeriodStart": row.history_period_start,
        "historyPeriodEnd": row.history_period_end,
        "projectionPeriodStart": row.projection_period_start,
        "projectionPeriodEnd": row.projection_period_end,
        "expenseYear": row.expense_year,
        "currentEscrowPayment": row.current_escrow_payment,
        "newEscrowPayment": row.new_escrow_payment,
        "servicer": row.servicer,
        "principalInterestPayment": row.principal_interest_payment,
        "currentTotalPayment": row.current_total_payment,
        "newTotalPayment": row.new_total_payment,
        "estimatedTax": row.estimated_tax,
        "actualTax": row.actual_tax,
        "estimatedInsurance": row.estimated_insurance,
        "actualInsurance": row.actual_insurance,
        "projectedTax": row.projected_tax,
        "projectedInsurance": row.projected_insurance,
        "projectedTotal": row.projected_total,
        "projectedMonthlyEscrow": row.projected_monthly_escrow,
        "shortageAmount": row.shortage_amount,
        "overageAmount": row.overage_amount,
        "refundAmount": row.refund_amount,
        "projectedMinimumBalance": row.projected_minimum_balance,
        "requiredMinimumBalance": row.required_minimum_balance,
        "escrowCushion": row.escrow_cushion,
        "selectedPaymentOption": row.selected_payment_option,
        "estimatedTotalDisbursement": row.estimated_total_disbursement,
        "actualTotalDisbursement": row.actual_total_disbursement,
        "documentName": (row.document.display_name or row.document.original_filename or row.document.filename) if row.document else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }


def _escrow_account_matches(loan_account: Any, document_account: Any) -> bool:
    loan_digits = re.sub(r'\D', '', str(loan_account or ''))
    document_raw = str(document_account or '').upper()
    document_digits = re.sub(r'\D', '', document_raw)
    if not loan_digits or not document_digits:
        return False
    if loan_digits == document_digits:
        return True
    if 'X' in document_raw or '*' in document_raw:
        return len(document_digits) >= 4 and loan_digits.endswith(document_digits[-4:])
    return _account_numbers_match(loan_digits, document_digits)


def _apply_escrow_analysis(
    db: Session,
    current_user: models.User,
    prop: models.Property,
    doc: models.Document,
    extracted: Dict[str, Any],
) -> tuple[models.EscrowPayment, Optional[models.AnnualExpense], Dict[str, Any]]:
    loan_number = extracted.get('loan_number') or extracted.get('account_number')
    loan = next((item for item in prop.loans if _escrow_account_matches(item.account_number, loan_number)), None)
    payment = db.query(models.EscrowPayment).filter(models.EscrowPayment.document_id == doc.id).first()
    if not payment and extracted.get('statement_date'):
        dated_payments = db.query(models.EscrowPayment).filter(
            models.EscrowPayment.property_id == prop.id,
            models.EscrowPayment.statement_date == extracted.get('statement_date'),
        ).all()
        payment = next(
            (item for item in dated_payments if _escrow_account_matches(item.loan_number, loan_number)),
            None,
        )
    if not payment:
        payment = models.EscrowPayment(
            id=str(uuid.uuid4()),
            property_id=prop.id,
            owner_id=current_user.id,
            document_id=doc.id,
        )
        db.add(payment)
    else:
        payment.document_id = doc.id

    payment.loan_id = loan.id if loan else None
    payment.loan_number = loan_number
    payment.property_address = ', '.join(filter(None, [
        extracted.get('property_address'),
        extracted.get('property_city'),
        extracted.get('property_state'),
        extracted.get('property_zip'),
    ]))
    for model_field, extracted_field in (
        ('statement_date', 'statement_date'),
        ('effective_date', 'effective_date'),
        ('history_period_start', 'history_period_start'),
        ('history_period_end', 'history_period_end'),
        ('projection_period_start', 'projection_period_start'),
        ('projection_period_end', 'projection_period_end'),
        ('expense_year', 'expense_year'),
        ('current_escrow_payment', 'current_escrow_payment'),
        ('new_escrow_payment', 'new_escrow_payment'),
        ('servicer', 'servicer'),
        ('principal_interest_payment', 'principal_interest_payment'),
        ('current_total_payment', 'current_total_payment'),
        ('new_total_payment', 'new_total_payment'),
        ('estimated_tax', 'estimated_tax'),
        ('actual_tax', 'actual_tax'),
        ('estimated_insurance', 'estimated_insurance'),
        ('actual_insurance', 'actual_insurance'),
        ('projected_tax', 'projected_tax'),
        ('projected_insurance', 'projected_insurance'),
        ('projected_total', 'projected_total'),
        ('projected_monthly_escrow', 'projected_monthly_escrow'),
        ('shortage_amount', 'shortage_amount'),
        ('overage_amount', 'overage_amount'),
        ('refund_amount', 'refund_amount'),
        ('projected_minimum_balance', 'projected_minimum_balance'),
        ('required_minimum_balance', 'required_minimum_balance'),
        ('escrow_cushion', 'escrow_cushion'),
        ('selected_payment_option', 'selected_payment_option'),
        ('estimated_total_disbursement', 'estimated_total_disbursement'),
        ('actual_total_disbursement', 'actual_total_disbursement'),
    ):
        setattr(payment, model_field, extracted.get(extracted_field))
    db.flush()
    replace_escrow_activities(db, payment, extracted)
    db.flush()
    metrics = rebuild_annual_expenses(db, prop)
    affected_years = sorted({metric.year for metric in metrics if doc.id in json.loads(metric.document_ids_json or '[]')})
    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == (affected_years[-1] if affected_years else int(extracted.get('expense_year') or 0)),
    ).first() if (affected_years or extracted.get('expense_year')) else None
    result = {
        "applied": {metric.expense_type.lower(): metric.value for metric in metrics if metric.year in affected_years},
        "preserved": [],
        "loanMatched": bool(loan),
        "affectedYears": affected_years,
    }
    return payment, row, result


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
    db.flush()
    if prop and category in FINAL_LOAN_LIFECYCLE_CATEGORIES:
        db.expire(prop, ["documents", "loans", "transactions"])
        resolve_property_lifecycle(db, prop)
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


async def _store_escrow_analysis_upload(
    db: Session,
    current_user: models.User,
    prop: models.Property,
    save_path: Path,
    original_filename: str,
    suffix: str,
    file_size: int,
    category: str,
    extracted: Dict[str, Any],
    markdown: str,
) -> Dict[str, Any]:
    property_id = prop.id
    required = ('loan_number', 'statement_date')
    missing = [field for field in required if not extracted.get(field)]
    if missing or not any(extracted.get(field) is not None for field in ('new_escrow_payment', 'projected_tax', 'projected_insurance', 'actual_tax', 'actual_insurance')):
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail="Could not find the loan, statement date, and escrow tax or insurance details in this document.")

    address_validation = _address_validation(prop, extracted)
    if address_validation.get('status') not in {'match', 'possible_match'}:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail="Escrow analysis property address does not match this property.")

    try:
        content_hash = _file_hash(save_path)
        doc = db.query(models.Document).filter(
            models.Document.owner_id == current_user.id,
            models.Document.content_hash == content_hash,
        ).first()
        reused_document = bool(doc)
        if doc and doc.property_id not in {None, property_id}:
            raise HTTPException(status_code=409, detail="This escrow statement is already linked to another property.")
        if doc:
            _discard_uploaded_source(save_path)
            doc.property_id = property_id
            doc.doc_category = category
            doc.module_tags = "EXPENSES"
            doc.extracted_data = json.dumps(extracted)
            doc.statement_year = extracted.get('statement_year')
            doc.statement_date = extracted.get('statement_date')
            doc.loan_account_number = extracted.get('loan_number') or extracted.get('account_number')
            doc.period_type = extracted.get('period_type') or 'yearly'
            doc.period_start = extracted.get('history_period_start') or extracted.get('statement_date')
            doc.period_end = extracted.get('projection_period_end') or extracted.get('statement_date')
            doc.display_name = _build_display_name(
                category,
                extracted,
                doc.statement_year,
                doc.period_start,
                doc.period_end,
            )
        else:
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
            doc = db.query(models.Document).filter(models.Document.id == commit['id']).first()
        doc.module_tags = "EXPENSES"
        payment, annual_row, result = _apply_escrow_analysis(db, current_user, prop, doc, extracted)
        db.commit()
        db.refresh(payment)
        if annual_row:
            db.refresh(annual_row)
        return {
            "status": "reused" if reused_document else "applied",
            "escrowPayment": _escrow_payment_out(payment),
            "annualExpense": _annual_expense_out(annual_row) if annual_row else None,
            "expenseApplication": result,
            "addressValidation": address_validation,
        }
    except Exception:
        db.rollback()
        _discard_uploaded_source(save_path)
        raise


@router.post("/upload/escrow-analysis")
async def upload_escrow_analysis(
    property_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    save_path, _pending_upload_id, suffix, file_size = await _save_pending_upload(file, current_user)
    original_filename = file.filename
    try:
        category, extracted, markdown = parse_document(str(save_path), "escrow_analysis")
    except Exception as exc:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail=f"Escrow analysis parse failed: {exc}")
    return await _store_escrow_analysis_upload(
        db,
        current_user,
        prop,
        save_path,
        original_filename,
        suffix,
        file_size,
        category,
        extracted,
        markdown,
    )


def _expense_document_year(extracted: Dict[str, Any], fallback_year: Optional[int]) -> int:
    for value in (
        extracted.get('tax_year'),
        extracted.get('expense_year'),
        extracted.get('effective_date'),
        extracted.get('projection_period_start'),
        extracted.get('period_start'),
        extracted.get('statement_year'),
        extracted.get('history_period_end'),
        extracted.get('statement_date'),
    ):
        match = re.search(r'(?:19|20)\d{2}', str(value or ''))
        if match:
            return int(match.group(0))
    # Kept only for backwards compatibility with older API clients. The
    # property-wide uploader never supplies a UI-selected year.
    if fallback_year:
        return int(fallback_year)
    raise HTTPException(status_code=422, detail="Could not determine the expense year from this document.")


def _normalized_address_parts(value: Optional[str]) -> set[str]:
    normalized = re.sub(r"[^A-Z0-9 ]", " ", (value or "").upper())
    replacements = {"STREET": "ST", "DRIVE": "DR", "ROAD": "RD", "AVENUE": "AVE"}
    return {replacements.get(part, part) for part in normalized.split() if part}


def _property_tax_match(prop: models.Property, parsed: Dict[str, Any], db: Session) -> Dict[str, Any]:
    parsed_parts = _normalized_address_parts(parsed.get("property_address"))
    street_parts = _normalized_address_parts(prop.address)
    city_parts = _normalized_address_parts(prop.city)
    street_score = len(parsed_parts & street_parts) / max(len(street_parts), 1)
    city_score = 1.0 if city_parts and city_parts.issubset(parsed_parts) else 0.0
    score = min(1.0, street_score * 0.8 + city_score * 0.2)

    parcel = parsed.get("parcel_number")
    if parcel:
        known_parcel = db.query(models.PropertyTaxRecord).filter(
            models.PropertyTaxRecord.property_id == prop.id,
            models.PropertyTaxRecord.parcel_number == parcel,
        ).first()
        if known_parcel:
            score = max(score, 0.99)
    status = "MATCHED" if score >= 0.8 else "NEEDS_REVIEW"
    return {
        "status": status,
        "confidence": round(score, 2),
        "selectedPropertyAddress": ", ".join(filter(None, [prop.address, prop.city, prop.state, prop.zip_code])),
        "documentAddress": parsed.get("property_address"),
        "signals": {"streetTokenScore": round(street_score, 2), "cityMatch": bool(city_score)},
    }


def _property_tax_record_out(record: models.PropertyTaxRecord, duplicate_status: Optional[str] = None) -> Dict[str, Any]:
    parsed = json.loads(record.structured_json or "{}")
    validation = json.loads(record.validation_json or "{}")
    return {
        "id": record.id,
        "documentId": record.document_id,
        "propertyId": record.property_id,
        "candidatePropertyId": record.candidate_property_id,
        "documentType": record.document_type,
        "taxType": record.tax_type,
        "issuer": record.issuer,
        "propertyAddress": record.property_address,
        "parcelNumber": record.parcel_number,
        "tracerNumber": record.tracer_number,
        "taxRateArea": record.tax_rate_area,
        "fiscalYear": record.fiscal_year_label,
        "fiscalPeriodStart": record.fiscal_period_start,
        "fiscalPeriodEnd": record.fiscal_period_end,
        "eventType": record.event_type,
        "eventDate": record.event_date,
        "supplementalAssessment": str(record.supplemental_assessment) if record.supplemental_assessment is not None else None,
        "totalTaxRatePercent": str(record.total_tax_rate_percent) if record.total_tax_rate_percent is not None else None,
        "prorationPercent": str(record.proration_percent) if record.proration_percent is not None else None,
        "taxBeforeProration": str(record.tax_before_proration) if record.tax_before_proration is not None else None,
        "totalAmountBilled": str(record.total_amount_billed) if record.total_amount_billed is not None else None,
        "paymentStatus": record.payment_status,
        "status": record.status,
        "propertyMatchStatus": record.property_match_status,
        "propertyMatchConfidence": record.property_match_confidence,
        "classificationConfidence": record.classification_confidence,
        "parser": {"name": record.parser_name, "version": record.parser_version},
        "data": parsed,
        "validation": validation,
        "duplicateStatus": duplicate_status,
        "createdAt": _json_timestamp(record.created_at),
    }


def _property_tax_annual_expense_payload(
    db: Session,
    prop: models.Property,
    record: models.PropertyTaxRecord,
    parsed: Dict[str, Any],
) -> Dict[str, Any]:
    """Return the annual rows changed by one structured tax document."""
    years = {
        int(match.group(0))
        for installment in parsed.get("installments") or []
        if (match := re.match(
            r"(?:19|20)\d{2}",
            str(installment.get("payment_date") or installment.get("paid_date") or ""),
        ))
    }
    if not years:
        source_year = parsed.get("statement_year") or record.fiscal_period_start
        match = re.search(r"(?:19|20)\d{2}", str(source_year or ""))
        if match:
            years.add(int(match.group(0)))
    rows = (
        db.query(models.AnnualExpense)
        .filter(
            models.AnnualExpense.property_id == prop.id,
            models.AnnualExpense.year.in_(sorted(years)),
        )
        .order_by(models.AnnualExpense.year)
        .all()
        if years else []
    )
    annual_expenses = [_annual_expense_out(row) for row in rows]
    return {
        "annualExpenseApplied": bool(annual_expenses),
        "annualExpenses": annual_expenses,
        "annualExpense": annual_expenses[-1] if annual_expenses else None,
    }


async def _store_structured_property_tax_upload(
    db: Session,
    current_user: models.User,
    selected_property: models.Property,
    save_path: Path,
    original_filename: str,
    suffix: str,
    file_size: int,
    address_override: bool = False,
    replace_document_id: Optional[int] = None,
    document_type_hint: Optional[str] = None,
    user_notes: Optional[str] = None,
) -> Dict[str, Any]:
    content_hash = _file_hash(save_path)
    if replace_document_id:
        replaced = db.query(models.Document).filter(
            models.Document.id == replace_document_id,
            models.Document.owner_id == current_user.id,
        ).first()
        if not replaced:
            _discard_uploaded_source(save_path)
            raise HTTPException(status_code=404, detail="Replacement document not found")
        _delete_document_and_dependents(db, replaced)
        db.flush()
    duplicate_doc = db.query(models.Document).filter(
        models.Document.owner_id == current_user.id,
        models.Document.content_hash == content_hash,
    ).first()
    reusable_document = None
    if duplicate_doc:
        record = db.query(models.PropertyTaxRecord).filter(
            models.PropertyTaxRecord.document_id == duplicate_doc.id,
        ).first()
        if record:
            _discard_uploaded_source(save_path)
            property_tax_logger.info(
                "property_tax_duplicate decision=exact document_id=%s property_id=%s checksum=%s",
                duplicate_doc.id, duplicate_doc.property_id, content_hash)
            result = _property_tax_record_out(record, "EXACT")
            applied = (
                record.property_id == selected_property.id
                and record.status == "READY"
                and record.document_type == "property_tax_bill"
            )
            if applied:
                parsed = json.loads(record.structured_json or "{}")
                rebuild_annual_expenses(db, selected_property)
                db.flush()
                result.update(_property_tax_annual_expense_payload(db, selected_property, record, parsed))
                db.commit()
            else:
                result.update({"annualExpenseApplied": False, "annualExpenses": [], "annualExpense": None})
            return result
        if duplicate_doc.property_id not in {None, selected_property.id}:
            _discard_uploaded_source(save_path)
            raise HTTPException(status_code=409, detail="This property-tax document is already linked to another property.")
        # A document first uploaded from the Documents tab may predate the
        # structured tax record. Reuse and upgrade that canonical document
        # rather than forcing the user to apply it manually or creating a copy.
        reusable_document = duplicate_doc

    converted = MarkItDownConverter().convert(save_path)
    classification = classify_property_tax_document(converted)
    if not classification["supported"]:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail={
            "message": "This PDF is not a supported property-tax document.",
            "classification": classification,
        })
    parsed = parse_property_tax_document(converted)
    if document_type_hint and document_type_hint != parsed["document_type"]:
        parsed["extraction"]["warnings"].append(
            f"Document type hint '{document_type_hint}' differed from backend classification")
    if user_notes:
        parsed["user_notes"] = user_notes
    validation = validate_property_tax_document(parsed)
    semantic_duplicate = db.query(models.PropertyTaxRecord).filter(
        models.PropertyTaxRecord.owner_id == current_user.id,
        models.PropertyTaxRecord.identity_key == parsed["identity_key"],
    ).first()
    if semantic_duplicate:
        _discard_uploaded_source(save_path)
        property_tax_logger.info(
            "property_tax_duplicate decision=semantic record_id=%s property_id=%s checksum=%s",
            semantic_duplicate.id, semantic_duplicate.property_id, content_hash)
        result = _property_tax_record_out(semantic_duplicate, "SEMANTIC")
        applied = (
            semantic_duplicate.property_id == selected_property.id
            and semantic_duplicate.status == "READY"
            and semantic_duplicate.document_type == "property_tax_bill"
        )
        if applied:
            existing_parsed = json.loads(semantic_duplicate.structured_json or "{}")
            rebuild_annual_expenses(db, selected_property)
            db.flush()
            result.update(_property_tax_annual_expense_payload(
                db, selected_property, semantic_duplicate, existing_parsed,
            ))
            db.commit()
        else:
            result.update({"annualExpenseApplied": False, "annualExpenses": [], "annualExpense": None})
        return result

    match = _property_tax_match(selected_property, parsed, db)
    attach = match["status"] == "MATCHED" or address_override
    match_status = "OVERRIDDEN" if address_override and match["status"] != "MATCHED" else match["status"]
    markdown_name = f"{save_path.stem}.md"
    (UPLOAD_DIR / markdown_name).write_text(converted.markdown)
    display_prefix = (
        "Supplemental Property Tax Bill"
        if parsed["document_type"].startswith("supplemental")
        else "Property Tax Bill"
    )
    display_name = f"{display_prefix} · {parsed['fiscal_year_label']}"
    record_uuid = str(uuid.uuid4())
    doc = reusable_document or models.Document(owner_id=current_user.id, filename=save_path.name, original_filename=original_filename)
    doc.property_id = selected_property.id if attach else None
    doc.filename = save_path.name
    doc.original_filename = original_filename
    doc.record_uuid = doc.record_uuid or record_uuid
    doc.display_name = display_name
    doc.file_type = suffix.lstrip(".")
    doc.doc_category = "property_tax"
    doc.module_tags = "EXPENSES,DOCUMENTS"
    doc.document_type = parsed["document_type"]
    doc.classification_confidence = classification["confidence"]
    doc.file_size = file_size
    doc.extracted_data = json.dumps(parsed)
    doc.markdown_file = markdown_name
    doc.normalized_text = converted.text
    doc.parser_version = PROPERTY_TAX_PARSER_VERSION
    doc.pipeline_status = "NEEDS_REVIEW" if not validation["valid"] or not attach else "COMPLETED"
    doc.conversion_metadata = json.dumps(converted.metadata())
    doc.content_hash = content_hash
    doc.content_fingerprint = parsed["identity_key"]
    doc.statement_year = parsed["statement_year"]
    doc.period_type = "fiscal_year"
    doc.period_start = parsed["fiscal_period_start"]
    doc.period_end = parsed["fiscal_period_end"]
    if reusable_document is None:
        db.add(doc)
    db.flush()
    record = models.PropertyTaxRecord(
        property_id=selected_property.id if attach else None,
        candidate_property_id=selected_property.id,
        owner_id=current_user.id,
        document_id=doc.id,
        document_type=parsed["document_type"],
        tax_type=parsed["tax_type"],
        issuer=parsed.get("issuer"),
        property_address=parsed.get("property_address"),
        parcel_number=parsed.get("parcel_number"),
        tracer_number=parsed.get("tracer_number"),
        tax_rate_area=parsed.get("tax_rate_area"),
        fiscal_year_label=parsed.get("fiscal_year_label"),
        fiscal_period_start=parsed.get("fiscal_period_start"),
        fiscal_period_end=parsed.get("fiscal_period_end"),
        event_type=parsed.get("event_type"),
        event_date=parsed.get("event_date"),
        supplemental_assessment=parsed.get("supplemental_assessment"),
        total_tax_rate_percent=parsed.get("total_tax_rate_percent"),
        proration_percent=parsed.get("proration_percent"),
        tax_before_proration=parsed.get("tax_before_proration"),
        total_amount_billed=parsed.get("total_amount_billed"),
        payment_status=parsed.get("payment_status"),
        identity_key=parsed["identity_key"],
        related_event_key=parsed.get("related_event_key"),
        structured_json=json.dumps(parsed),
        validation_json=json.dumps(validation),
        parser_name=PROPERTY_TAX_PARSER_NAME,
        parser_version=PROPERTY_TAX_PARSER_VERSION,
        classification_confidence=classification["confidence"],
        property_match_confidence=match["confidence"],
        property_match_status=match_status,
        status="NEEDS_REVIEW" if not validation["valid"] or not attach else "READY",
    )
    db.add(record)
    annual_expense_applied = False
    if attach and validation["valid"] and parsed["document_type"] == "property_tax_bill":
        rebuild_annual_expenses(db, selected_property)
        annual_expense_applied = True
    db.commit()
    db.refresh(record)
    result = _property_tax_record_out(record)
    result["propertyMatch"] = match
    result["sourceFileRetained"] = True
    result["annualExpenseApplied"] = annual_expense_applied
    if annual_expense_applied:
        result.update(_property_tax_annual_expense_payload(db, selected_property, record, parsed))
    else:
        result.update({"annualExpenses": [], "annualExpense": None})
    tax_record = dict(result)
    result.update({
        "document": {
            "id": doc.id,
            "filename": doc.original_filename,
            "status": doc.pipeline_status.lower(),
        },
        "classification": parsed["classification"],
        "property_match": {
            "property_id": record.property_id,
            "confidence": match["confidence"],
            "method": "address_and_context" if attach else "manual_review",
            **match,
        },
        "tax_record": tax_record,
        "warnings": parsed.get("extraction", {}).get("warnings", []) + validation.get("warnings", []),
        "requires_review": record.status == "NEEDS_REVIEW",
        "pipeline": [
            {"stage": stage, "status": "completed"}
            for stage in ("uploaded", "converted", "classified", "parsed", "validated", "persisted")
        ],
    })
    property_tax_logger.info(
        "property_tax_persisted document_id=%s property_id=%s filename=%s checksum=%s converter=%s parser=%s classification=%s duration_ms=%s warnings=%s validation_failures=%s match=%s",
        doc.id, record.property_id, original_filename, content_hash,
        converted.converter_version, PROPERTY_TAX_PARSER_VERSION,
        parsed["document_type"], converted.duration_ms,
        len(result["warnings"]), len(validation.get("errors", [])), match_status)
    return result


@property_tax_router.post("/{property_id}/documents/property-tax")
async def upload_structured_property_tax(
    property_id: int,
    file: UploadFile = File(...),
    address_override: bool = Form(False),
    document_type_hint: Optional[str] = Form(None),
    replace_document_id: Optional[int] = Form(None),
    user_notes: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    save_path, _pending, suffix, file_size = await _save_pending_upload(file, current_user)
    try:
        return await _store_structured_property_tax_upload(
            db, current_user, prop, save_path, file.filename, suffix, file_size,
            address_override, replace_document_id, document_type_hint, user_notes)
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail=f"Property-tax processing failed: {exc}") from exc


@property_tax_router.get("/{property_id}/property-taxes")
def list_structured_property_taxes(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    records = db.query(models.PropertyTaxRecord).filter(
        (
            (models.PropertyTaxRecord.property_id == property_id)
            | (models.PropertyTaxRecord.candidate_property_id == property_id)
        ),
        models.PropertyTaxRecord.owner_id == current_user.id,
    ).order_by(
        models.PropertyTaxRecord.fiscal_period_start,
        models.PropertyTaxRecord.tracer_number,
    ).all()
    return {"propertyId": property_id, "items": [_property_tax_record_out(row) for row in records]}


@property_tax_router.post("/{property_id}/property-taxes/{record_id}/corrections")
def correct_structured_property_tax(
    property_id: int,
    record_id: str,
    req: PropertyTaxCorrectionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    record = db.query(models.PropertyTaxRecord).filter(
        models.PropertyTaxRecord.id == record_id,
        (
            (models.PropertyTaxRecord.property_id == property_id)
            | (models.PropertyTaxRecord.candidate_property_id == property_id)
        ),
        models.PropertyTaxRecord.owner_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Property-tax record not found")
    data = json.loads(record.structured_json or "{}")
    target = data
    parts = [part for part in req.field_path.split(".") if part]
    if not parts:
        raise HTTPException(status_code=422, detail="Correction field path is required")
    for part in parts[:-1]:
        if not isinstance(target.get(part), dict):
            target[part] = {}
        target = target[part]
    original = target.get(parts[-1])
    target[parts[-1]] = req.value
    correction = models.PropertyTaxCorrection(
        property_tax_record_id=record.id,
        owner_id=current_user.id,
        field_path=req.field_path,
        original_value_json=json.dumps(original),
        corrected_value_json=json.dumps(req.value),
        reason=req.reason,
    )
    record.structured_json = json.dumps(data)
    record.validation_json = json.dumps(validate_property_tax_document(data))
    record.status = "CORRECTED"
    db.add(correction)
    db.commit()
    db.refresh(record)
    return _property_tax_record_out(record)


@property_tax_router.post("/{property_id}/property-taxes/{record_id}/confirm-match")
def confirm_structured_property_tax_match(
    property_id: int,
    record_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    record = db.query(models.PropertyTaxRecord).filter(
        models.PropertyTaxRecord.id == record_id,
        models.PropertyTaxRecord.candidate_property_id == property_id,
        models.PropertyTaxRecord.owner_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Property-tax review item not found")
    record.property_id = property_id
    record.property_match_status = "CONFIRMED"
    record.status = "READY" if json.loads(record.validation_json or "{}").get("valid") else "NEEDS_REVIEW"
    record.document.property_id = property_id
    if record.status == "READY" and record.document_type == "property_tax_bill":
        prop = db.query(models.Property).filter(
            models.Property.id == property_id,
            models.Property.owner_id == current_user.id,
        ).first()
        if prop:
            rebuild_annual_expenses(db, prop)
    db.commit()
    db.refresh(record)
    return _property_tax_record_out(record)


@router.post("/upload/expense-document")
async def upload_expense_document(
    property_id: int = Form(...),
    year: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Detect and apply escrow, property-tax, or insurance documents."""
    require_premium_user(current_user)
    prop = db.query(models.Property).filter(
        models.Property.id == property_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    save_path, _pending_upload_id, suffix, file_size = await _save_pending_upload(file, current_user)
    original_filename = file.filename
    # Fiscal supplemental bills are retained as dedicated records and do not
    # flow into the regular annual operating-expense updater below.
    try:
        converted_tax = MarkItDownConverter().convert(save_path)
        tax_classification = classify_property_tax_document(converted_tax)
    except Exception:
        tax_classification = {"supported": False}
    if tax_classification.get("supported"):
        try:
            result = await _store_structured_property_tax_upload(
                db, current_user, prop, save_path, original_filename, suffix, file_size)
            result["status"] = "applied"
            is_supplemental = result.get("documentType", "").startswith("supplemental")
            result["document"] = {
                "id": result["documentId"],
                "name": f"{'Supplemental Property Tax Bill' if is_supplemental else 'Property Tax Bill'} · {result['fiscalYear']}",
                "category": "property_tax",
            }
            result["detectedField"] = "supplemental_property_tax" if is_supplemental else "property_tax"
            return result
        except Exception:
            db.rollback()
            _discard_uploaded_source(save_path)
            raise
    try:
        category, extracted, markdown = parse_document(str(save_path), "auto")
    except Exception as exc:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail=f"Expense document parse failed: {exc}")

    if category == 'escrow_analysis':
        period_year = _expense_document_year(extracted, None)
        extracted['expense_year'] = period_year
        extracted.setdefault('statement_year', period_year)
        return await _store_escrow_analysis_upload(
            db,
            current_user,
            prop,
            save_path,
            original_filename,
            suffix,
            file_size,
            category,
            extracted,
            markdown,
        )

    field_by_category = {
        'property_tax': 'property_tax',
        'insurance_declaration': 'insurance',
    }
    field = field_by_category.get(category)
    if not field:
        _discard_uploaded_source(save_path)
        raise HTTPException(
            status_code=422,
            detail="This is not a supported escrow analysis, property-tax statement, or insurance declaration.",
        )
    expense_year = _expense_document_year(extracted, year)
    amount = _expense_document_amount(extracted, field)
    if amount is None:
        _discard_uploaded_source(save_path)
        raise HTTPException(status_code=422, detail=f"Could not find a reported annual {field.replace('_', ' ')} amount in this document.")

    try:
        content_hash = _file_hash(save_path)
        doc = db.query(models.Document).filter(
            models.Document.owner_id == current_user.id,
            models.Document.content_hash == content_hash,
        ).first()
        reused_document = bool(doc)
        if doc and doc.property_id not in {None, property_id}:
            raise HTTPException(status_code=409, detail="This expense document is already linked to another property.")
        if doc:
            _discard_uploaded_source(save_path)
            doc.property_id = property_id
            doc.doc_category = category
            doc.module_tags = "EXPENSES"
            doc.extracted_data = json.dumps(extracted)
            doc.statement_year = expense_year
            doc.display_name = _build_display_name(category, extracted, expense_year)
        else:
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
            doc = db.query(models.Document).filter(models.Document.id == commit['id']).first()

        doc.module_tags = "EXPENSES"

        address_validation = _address_validation(prop, extracted)
        if _expense_address_requires_review(address_validation):
            db.commit()
            return {
                **_expense_address_review_response(doc, address_validation),
                "detectedField": field,
                "expenseYear": expense_year,
            }

        row = db.query(models.AnnualExpense).filter(
            models.AnnualExpense.property_id == prop.id,
            models.AnnualExpense.year == expense_year,
        ).first()
        preserved = bool(row and float(getattr(row, field, 0) or 0) > 0)
        if not preserved:
            row = _apply_expense_document_to_row(
                db,
                current_user,
                prop,
                doc,
                expense_year,
                field,
                address_validation=address_validation,
            )
        db.flush()
        rebuild_annual_expenses(db, prop)
        db.commit()
        if row:
            db.refresh(row)
        return {
            "status": "reused" if reused_document else "applied",
            "document": _expense_document_payload(doc),
            "detectedField": field,
            "expenseYear": expense_year,
            "annualExpense": _annual_expense_out(row) if row else None,
            "expenseApplication": {
                "applied": [] if preserved else [field],
                "preserved": [field] if preserved else [],
            },
            "addressValidation": address_validation,
        }
    except Exception:
        db.rollback()
        _discard_uploaded_source(save_path)
        raise


@router.get("/property/{property_id}/escrow-payments")
def list_escrow_payments(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(models.Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if prop.owner_id != current_user.id:
        share = db.query(models.UserSharing).filter(
            models.UserSharing.owner_id == prop.owner_id,
            models.UserSharing.shared_with_id == current_user.id,
        ).first()
        if not share:
            raise HTTPException(status_code=403, detail="Access denied")
    rows = db.query(models.EscrowPayment).filter(
        models.EscrowPayment.property_id == property_id,
    ).order_by(models.EscrowPayment.statement_date.desc()).all()
    return [_escrow_payment_out(row) for row in rows]


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
            "module_tags": [tag for tag in (d.module_tags or "").split(",") if tag],
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
    if address_status == "mismatch":
        raise HTTPException(
            status_code=422,
            detail={
                "code": "ADDRESS_VALIDATION_BLOCKED",
                "message": "Uploaded document appears to belong to a different property.",
                "addressValidation": address_validation,
            },
        )
    if address_status == "document_address_missing":
        normalized_property = _address_parts(prop.address, prop.city, prop.state, prop.zip_code)
        property_address_complete = all(normalized_property[key] for key in ["street", "city", "state", "zip"])
        if not request.address_override or not property_address_complete:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "ADDRESS_VALIDATION_BLOCKED",
                    "message": "We could not find a property address in this document.",
                    "addressValidation": address_validation,
                },
            )
        extracted = _safe_extracted_data(doc)
        extracted["_address_override"] = {
            "propertyId": prop.id,
            "normalizedPropertyAddress": normalized_property["display"],
            "appliedBy": current_user.email,
            "appliedAt": datetime.utcnow().isoformat(),
        }
        doc.extracted_data = json.dumps(extracted)
        address_validation = _closing_address_validation(doc, extracted)
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
        "settlement_total_amount",
        "cash_to_close",
        "deposit_paid_before_closing",
        "total_due_from_borrower",
        "total_paid_on_behalf_of_borrower",
        "settlement_debit_total",
        "settlement_credit_total",
        "market_value",
        "down_payment",
        "closing_costs",
        "market_value_updated",
    }
    for target in selected_property_fields & property_targets:
        if target in property_field_values:
            setattr(prop, target, property_field_values[target])

    if "market_value" in selected_property_fields:
        prop.market_value_source = "imported"
    valuation_data = {
        "purchase_price": prop.purchase_price,
        "purchase_date": prop.purchase_date,
        "market_value": prop.market_value,
        "market_value_source": prop.market_value_source,
        "market_value_updated": prop.market_value_updated,
    }
    apply_default_market_price(valuation_data, existing_source=prop.market_value_source)
    prop.market_value = valuation_data["market_value"]
    prop.market_value_source = valuation_data["market_value_source"]
    prop.market_value_updated = valuation_data.get("market_value_updated")
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
        resolution_data = {
            **_safe_extracted_data(doc),
            **loan_field_values,
            "transaction_purpose": "PURCHASE",
        }
        resolution = resolve_canonical_loan(
            db,
            prop,
            resolution_data,
            category=doc.doc_category,
            document=doc,
        )
        loan = resolution.loan
        if loan is None:
            raise HTTPException(
                status_code=422,
                detail="The purchase loan could not be resolved from this document.",
            )
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

    tags = {tag.strip() for tag in (doc.module_tags or "").split(",") if tag.strip()}
    tags.discard(SETUP_DELINKED_TAG)
    doc.module_tags = ",".join(sorted(tags))
    db.flush()
    db.expire(prop, ["loans"])
    resolve_property_lifecycle(db, prop)
    db.commit()
    db.refresh(prop)
    address_validation = _closing_address_validation(doc, _safe_extracted_data(doc))
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


FINAL_LOAN_LIFECYCLE_CATEGORIES = {
    "closing_statement", "loan_disclosure", "mortgage_statement", "1098",
}


def _lifecycle_property(db: Session, property_id: int, current_user: models.User) -> models.Property:
    prop = db.query(models.Property).filter(models.Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if prop.owner_id != current_user.id:
        share = db.query(models.UserSharing).filter(
            models.UserSharing.owner_id == prop.owner_id,
            models.UserSharing.shared_with_id == current_user.id,
        ).first()
        if not share:
            raise HTTPException(status_code=403, detail="Access denied")
    return prop


@router.get("/property/{property_id}/lifecycle")
def get_property_lifecycle(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _lifecycle_property(db, property_id, current_user)
    return lifecycle_dto(prop)


@router.post("/{doc_id}/delink-setup")
def delink_document_from_setup(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Remove source associations while preserving accepted values and the stored document."""
    require_premium_user(current_user)
    document = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not document.property_id:
        raise HTTPException(status_code=409, detail="Document is not linked to a property setup.")
    prop = _lifecycle_property(db, document.property_id, current_user)

    transaction_ids = [
        row.transaction_id
        for row in db.query(models.TransactionDocumentLink).filter_by(document_id=document.id).all()
    ]
    db.query(models.TransactionDocumentLink).filter_by(document_id=document.id).delete(
        synchronize_session=False,
    )
    db.query(models.LoanDocumentLink).filter_by(document_id=document.id).delete(
        synchronize_session=False,
    )
    db.query(models.LoanBalanceSnapshot).filter_by(source_document_id=document.id).delete(
        synchronize_session=False,
    )
    db.query(models.LoanServicerSegment).filter_by(source_document_id=document.id).delete(
        synchronize_session=False,
    )
    for loan in prop.loans:
        if loan.source_document_id == document.id:
            loan.source_document_id = None

    tags = {tag.strip() for tag in (document.module_tags or "").split(",") if tag.strip()}
    tags.add(SETUP_DELINKED_TAG)
    document.module_tags = ",".join(sorted(tags))
    db.flush()
    for transaction_id in transaction_ids:
        transaction = db.get(models.PropertyTransaction, transaction_id)
        if transaction:
            transaction.status = "USER_CONFIRMED"
    db.flush()
    db.expire(prop, ["transactions", "loans", "documents"])
    refreshed_draft = lifecycle_dto(prop)
    db.commit()
    return {
        "status": "delinked",
        "documentId": document.id,
        "documentPreserved": True,
        "draft": refreshed_draft,
    }


@router.post("/property/{property_id}/resolve-lifecycle")
def resolve_property_lifecycle_endpoint(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    require_premium_user(current_user)
    prop = _lifecycle_property(db, property_id, current_user)
    result = resolve_property_lifecycle(db, prop)
    db.commit()
    db.refresh(prop)
    return result


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
    if not _is_supported_loan_document(doc.doc_category, _safe_extracted_data(doc)):
        raise HTTPException(
            status_code=400,
            detail="This document does not contain supported loan terms, a mortgage statement, or Form 1098 data.",
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
    for document in docs:
        classify_document(document)
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
    for document in docs:
        classify_document(document)
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
            source_document = db.get(models.Document, (row.get("sourceDocumentIds") or [None])[-1])
            source_data = _safe_extracted_data(source_document) if source_document else {}
            resolution = resolve_canonical_loan(
                db,
                prop,
                source_data,
                category=source_document.doc_category if source_document else "",
                document=source_document,
                selected_loan_id=existing_original.id if existing_original else None,
                allow_create=False,
            )
            loan = resolution.loan
        if loan is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "CANONICAL_LOAN_REQUIRED",
                    "message": "Select an existing loan before applying periodic loan documents.",
                },
            )
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
        escrow_payload = {
            "monthly_property_tax_escrow": loan.monthly_property_tax_escrow,
            "monthly_insurance_escrow": loan.monthly_insurance_escrow,
            "monthly_mortgage_insurance": loan.monthly_mortgage_insurance,
            "monthly_other_escrow": loan.monthly_other_escrow,
            "escrow_amount": row.get("escrowAmount"),
        }
        latest_escrow_total = _normalized_monthly_escrow_total(escrow_payload)
        if latest_escrow_total > 0:
            loan.escrow_amount = latest_escrow_total
            loan.escrow_included = True
        if _to_float(row.get("estimatedTotalMonthlyPayment")) > 0:
            loan.estimated_total_monthly_payment = _to_float(row.get("estimatedTotalMonthlyPayment"))
        elif loan.monthly_payment and latest_escrow_total > 0:
            loan.estimated_total_monthly_payment = _normalized_total_monthly_payment(escrow_payload, loan.monthly_payment)
        loan.statement_date = row.get("statementDate") or loan.statement_date
        source_document_ids = row.get("sourceDocumentIds") or []
        if source_document_ids:
            loan.source_document_id = source_document_ids[-1]
        loan.source_type = "consolidated_loan_documents"
        loan.import_status = "reviewed"
        for source_document_id in row.get("sourceDocumentIds") or []:
            source_document = db.get(models.Document, source_document_id)
            if source_document:
                apply_periodic_loan_evidence(
                    db,
                    loan,
                    source_document,
                    _safe_extracted_data(source_document),
                )
        if loan.id not in applied_ids:
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
    if not _is_supported_loan_document(doc.doc_category, _safe_extracted_data(doc)):
        raise HTTPException(
            status_code=400,
            detail="This document does not contain supported loan terms, a mortgage statement, or Form 1098 data.",
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
    doc.extracted_data = json.dumps(extracted)
    extracted = classify_document(doc)
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
    selected_loan = None
    if request.loan_id:
        selected_loan = db.query(models.Loan).filter(
            models.Loan.id == request.loan_id,
            models.Loan.property_id == prop.id,
        ).first()
    account_number = (extracted.get("account_number") or "").strip()
    if (
        account_number
        and selected_loan is not None
        and (selected_loan.account_number or "").strip()
        and not _account_numbers_match(selected_loan.account_number, account_number)
        and str(extracted.get("transaction_purpose") or extracted.get("loan_purpose") or "").upper() != "REFINANCE"
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
    is_periodic = doc.doc_category in {"mortgage_statement", "1098"}
    resolution = resolve_canonical_loan(
        db,
        prop,
        extracted,
        category=doc.doc_category,
        document=doc,
        selected_loan_id=request.loan_id,
        allow_create=not is_periodic,
    )
    loan = resolution.loan
    if loan is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CANONICAL_LOAN_REQUIRED",
                "message": "Select the existing loan this document supports. A statement or Form 1098 cannot create a new loan.",
                "loanMapping": _loan_statement_mapping_payload(prop, extracted, request.loan_id),
            },
        )
    created_loan = resolution.created
    if (
        is_periodic
        and resolution.action == "SERVICER_TRANSFER"
        and str(loan.closure_reason or "").lower() == "servicing transfer"
    ):
        loan.status = "OPEN"
        loan.closed_date = None
        loan.closure_reason = None
        loan.servicer_end_date = None

    selected_fields = set(request.selected_loan_fields or [])
    if not selected_fields:
        selected_fields = {field["targetKey"] for field in review["loanFields"]}
    field_values = {field["targetKey"]: field["value"] for field in review["loanFields"]}
    statement_targets = {
        "lender_name",
        "original_amount",
        "interest_rate",
        "loan_type",
        "loan_product",
        "loan_term_years",
        "monthly_payment",
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
        "maturity_date",
        "servicer_start_date",
        "purpose",
    }
    for target in selected_fields & statement_targets:
        value = field_values.get(target)
        if is_periodic and target in {"current_balance", "statement_date"}:
            continue
        if target in {"statement_date", "origination_date", "maturity_date", "servicer_start_date"}:
            parsed_date = _parse_date(value)
            if (
                doc.doc_category == "mortgage_statement"
                and target == "servicer_start_date"
                and parsed_date
                and parsed_date == _parse_date(extracted.get("statement_date"))
            ):
                continue
            setattr(loan, target, parsed_date.isoformat() if parsed_date else value)
        elif target in {"account_number", "lender_name", "loan_type", "loan_product", "purpose"}:
            setattr(loan, target, value)
        elif target == "loan_term_years":
            setattr(loan, target, _to_int(value, 30))
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
        escrow_payload = {
            "monthly_property_tax_escrow": loan.monthly_property_tax_escrow,
            "monthly_insurance_escrow": loan.monthly_insurance_escrow,
            "monthly_mortgage_insurance": loan.monthly_mortgage_insurance,
            "monthly_other_escrow": loan.monthly_other_escrow,
            "escrow_amount": extracted.get("escrow_amount"),
        }
        latest_escrow_total = _normalized_monthly_escrow_total(escrow_payload)
        if latest_escrow_total > 0:
            loan.escrow_amount = latest_escrow_total
            loan.escrow_included = True
        if extracted.get("estimated_total_monthly_payment") is not None:
            loan.estimated_total_monthly_payment = _to_float(extracted.get("estimated_total_monthly_payment"))
        elif loan.monthly_payment and latest_escrow_total > 0:
            loan.estimated_total_monthly_payment = _normalized_total_monthly_payment(escrow_payload, loan.monthly_payment)

    if selected_fields & {"monthly_property_tax_escrow", "monthly_insurance_escrow", "monthly_mortgage_insurance", "monthly_other_escrow", "escrow_amount"}:
        loan.escrow_included = True
    if account_number and not loan.account_number:
        loan.account_number = account_number
    if account_number:
        doc.loan_account_number = account_number
    loan.import_status = "reviewed"
    if not is_periodic:
        loan.source_document_id = doc.id
        loan.source_type = doc.doc_category
        if "current_balance" in selected_fields:
            loan.current_balance_source = "loan_disclosure_initial_balance"
            loan.current_balance_as_of = extracted.get("origination_date") or loan.origination_date
            loan.current_balance_verified = False
    if created_loan:
        db.flush()
    if is_periodic:
        apply_periodic_loan_evidence(
            db,
            loan,
            doc,
            extracted,
            selected_fields=selected_fields,
        )
    transfer_result = {
        **_loan_statement_mapping_payload(prop, extracted, request.loan_id),
        "requiresConfirmation": False,
        "suggestions": [],
        "resolutionAction": resolution.action,
        "message": "Periodic evidence was attached to the canonical loan." if is_periodic else "Loan origination was resolved.",
    }
    expense_estimates = _apply_escrow_expense_estimates(
        prop,
        current_user.id,
        loan,
        doc,
        extracted,
        db,
    )

    refinance_applied = False
    if not is_periodic:
        db.flush()
        db.expire(prop, ["documents", "loans", "transactions"])
        lifecycle = resolve_property_lifecycle(db, prop)
        refinance_applied = any(
            item.get("purpose") == "REFINANCE" and item.get("status") == "OPEN"
            for item in lifecycle.get("loans", [])
        )

    db.commit()
    db.refresh(prop)
    processing_result = _completed_processing_result(
        loan_id=loan.id,
        document_id=doc.id,
        category=doc.doc_category,
        statement_year=doc.statement_year or _statement_year(extracted, loan),
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
        "refinanceApplied": refinance_applied,
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
    # Keep the denormalized lifecycle columns synchronized with the newly
    # extracted payload. Otherwise a reparsed Loan Estimate can retain stale
    # Closing Disclosure semantics from its prior parser version.
    extracted = classify_document(doc)
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
    escrow_reprocess = []
    expense_properties = set()
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
            if category == "escrow_analysis":
                escrow_reprocess.append((doc.property, doc, extracted))
                expense_properties.add(doc.property)
            elif category in {"property_tax", "insurance_declaration"}:
                expense_properties.add(doc.property)
        elif category == "tax_return":
            common_tax_returns.append((doc.id, str(path)))

    # Re-apply property docs in chronological order
    for prop, extracted_list in by_property.items():
        extracted_list.sort(
            key=lambda d: _parse_date(d.get("statement_date")) or _parse_date("01/01/1900")
        )
        for data in extracted_list:
            _apply_extracted(db, prop, data)

    for prop, doc, extracted in escrow_reprocess:
        _apply_escrow_analysis(db, current_user, prop, doc, extracted)
    for prop in expense_properties:
        rebuild_annual_expenses(db, prop)

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
            "module_tags": [tag for tag in (d.module_tags or "").split(",") if tag],
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
    property_record = doc.property
    db.query(models.EscrowActivity).filter(
        models.EscrowActivity.document_id == doc.id
    ).delete(synchronize_session=False)
    db.query(models.EscrowPayment).filter(
        models.EscrowPayment.document_id == doc.id
    ).delete(synchronize_session=False)
    tax_records = db.query(models.PropertyTaxRecord).filter(
        models.PropertyTaxRecord.document_id == doc.id
    ).all()
    for tax_record in tax_records:
        db.query(models.PropertyTaxCorrection).filter(
            models.PropertyTaxCorrection.property_tax_record_id == tax_record.id
        ).delete(synchronize_session=False)
        db.delete(tax_record)
    db.query(models.Loan).filter(
        models.Loan.source_document_id == doc.id
    ).update({
        models.Loan.source_document_id: None,
        models.Loan.source_type: None,
        models.Loan.import_status: None,
    }, synchronize_session=False)
    # Documents are only a *source* of values. The loan (and its saved field
    # values) must outlive its source documents — a loan is removed only when
    # the user explicitly deletes it from the Loans tab. So detach every link
    # that points at this document; leaving them orphaned makes the loan's DTO
    # crash on a null document and the loan appears to vanish on reload.
    db.query(models.LoanDocumentLink).filter(
        models.LoanDocumentLink.document_id == doc.id
    ).delete(synchronize_session=False)
    db.query(models.LoanBalanceSnapshot).filter(
        models.LoanBalanceSnapshot.source_document_id == doc.id
    ).delete(synchronize_session=False)
    db.query(models.TransactionDocumentLink).filter(
        models.TransactionDocumentLink.document_id == doc.id
    ).delete(synchronize_session=False)
    db.query(models.LoanServicerSegment).filter(
        models.LoanServicerSegment.source_document_id == doc.id
    ).update({models.LoanServicerSegment.source_document_id: None}, synchronize_session=False)
    db.delete(doc)
    db.flush()
    if property_record:
        rebuild_annual_expenses(db, property_record)


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
