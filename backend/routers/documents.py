import os
import json
import re
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
import models


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
from routers.properties import import_tax_return
from services.document_parser import parse_document
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
    category: str = "auto"
    force: bool = False  # "Keep both" — bypass the duplicate check
    replace_document_id: Optional[int] = None  # "Replace" — delete this doc first

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _discard_uploaded_source(path: Path) -> None:
    """Remove the original uploaded file after extracting durable data."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass

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
    "escrow_amount", "interest_rate", "rate_note", "mortgage_tenure_covered",
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
        # Match loan by account_number or use the first loan
        loan = None
        if account_number:
            loan = next((l for l in prop.loans if l.account_number == account_number), None)
        if loan is None:
            loan = prop.loans[0] if prop.loans else None
        if loan is None:
            loan = models.Loan(
                property_id=prop.id,
                original_amount=0, current_balance=0,
                interest_rate=0, monthly_payment=0,
                loan_term_years=30,
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

    # Down payment from closing statement → write to the matching loan
    if data.get("down_payment") is not None and prop.loans:
        # Match the loan by original_amount if possible; else use first loan
        target_loan = next(
            (l for l in prop.loans
             if data.get("original_amount") and abs((l.original_amount or 0) - data["original_amount"]) < 100),
            prop.loans[0],
        )
        target_loan.down_payment = data["down_payment"]
        applied["loan.down_payment"] = data["down_payment"]

    return applied


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
        "upload_date": doc.upload_date,
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
    force: bool = False,
    replace_document_id: Optional[int] = None,
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
        auto_applied = _apply_extracted(db, prop, extracted, category)
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
        "loan_account_number": (extracted.get("account_number") or "").strip() or None,
        "statement_year": statement_year,
        "period_type": extracted.get("period_type", "other"),
        "period_start": period_start,
        "period_end": period_end,
        "property_id": prop.id if prop else property_id,
        "property_address": prop.address if prop else extracted.get("property_address"),
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
            force=req.force,
            replace_document_id=req.replace_document_id,
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
    return [
        {
            "id": d.id,
            "property_id": d.property_id,
            "property_address": d.property.address if d.property else None,
            "original_filename": d.original_filename,
            "display_name": d.display_name or d.original_filename,
            "file_type": d.file_type,
            "doc_category": d.doc_category,
            "file_size": d.file_size,
            "extracted_data": json.loads(d.extracted_data) if d.extracted_data else {},
            "document_config": config_as_dict(d.doc_category),
            "extraction_schema": extraction_schema(d.doc_category, json.loads(d.extracted_data) if d.extracted_data else {}),
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

    return [
        {
            "id": d.id,
            "original_filename": d.original_filename,
            "display_name": d.display_name or d.original_filename,
            "file_type": d.file_type,
            "doc_category": d.doc_category,
            "file_size": d.file_size,
            "extracted_data": json.loads(d.extracted_data) if d.extracted_data else {},
            "document_config": config_as_dict(d.doc_category),
            "extraction_schema": extraction_schema(d.doc_category, json.loads(d.extracted_data) if d.extracted_data else {}),
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
