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

    Two documents are considered duplicates when they share the same
    (property_id, doc_category, statement_year, normalised loan_account_number).
    Among each duplicate group, the document with the earliest upload_date is
    kept as the original; the rest are flagged.

    For documents without a statement_year (e.g., lease agreements), no
    duplicate detection is performed.
    """
    groups: dict = defaultdict(list)
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
        groups[key].append(d)

    duplicate_ids: set = set()
    for group in groups.values():
        if len(group) < 2:
            continue
        # Sort ascending by upload_date; earliest is the original
        ordered = sorted(group, key=lambda d: str(getattr(d, "upload_date", "") or ""))
        for dup in ordered[1:]:
            duplicate_ids.add(dup.id)
    return duplicate_ids
from database import get_db
from routers.auth import get_current_user
from routers.properties import import_tax_return
from services.document_parser import parse_document

router = APIRouter(prefix="/api/documents", tags=["documents"])


class BatchDeleteRequest(BaseModel):
    ids: List[int]

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".csv"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

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
    "other",
]

# Extracted keys that map onto Loan columns when a document is applied
LOAN_FIELDS = {
    "original_amount", "current_balance", "interest_rate", "rate_note",
    "monthly_payment", "loan_term_years", "maturity_date",
    "escrow_amount", "loan_type", "account_number",
    "principal_due", "interest_due", "statement_date", "payment_due_date",
    "lender_name", "origination_date",
}

# Point-in-time "Statement Details" fields: these change with every statement,
# so they must only ever reflect the LATEST statement. Identity/origination
# fields (account_number, lender_name, original_amount, loan_term_years,
# origination_date, maturity_date, loan_type) are static and always applied.
STATEMENT_FIELDS = {
    "current_balance", "principal_due", "interest_due",
    "statement_date", "payment_due_date", "monthly_payment",
    "escrow_amount", "interest_rate", "rate_note",
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


def _apply_extracted(db, prop, data) -> dict:
    """Apply extracted document fields to a property and its loan.

    Matches loans by account_number when available, otherwise uses the first loan.
    Returns a dict of the fields that were applied.
    """
    applied = {}
    account_number = (data.get("account_number") or "").strip()
    loan_updates = {k: v for k, v in data.items() if k in LOAN_FIELDS and v is not None}
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
        address=addr,
        city=extracted.get("property_city"),
        state=extracted.get("property_state"),
        zip_code=extracted.get("property_zip"),
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    return prop, True


@router.post("/upload")
async def upload_document(
    property_id: Optional[int] = Form(None),
    category: str = Form("auto"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if category not in DOC_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category. Choose from: {DOC_CATEGORIES}")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {suffix} not allowed")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    unique_name = f"{uuid.uuid4().hex}{suffix}"
    save_path = UPLOAD_DIR / unique_name
    with open(save_path, "wb") as f:
        f.write(content)

    extracted = {}
    markdown = ""
    try:
        category, extracted, markdown = parse_document(str(save_path), category)
    except Exception as e:
        category = "other" if category == "auto" else category
        extracted = {"parse_error": str(e)}

    markdown_name = None
    if markdown:
        markdown_name = f"{Path(unique_name).stem}.md"
        (UPLOAD_DIR / markdown_name).write_text(markdown)

    # Tax returns are common to all properties — never tied to a single one.
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
                os.remove(save_path)
                if markdown_name:
                    (UPLOAD_DIR / markdown_name).unlink(missing_ok=True)
                raise HTTPException(
                    status_code=400,
                    detail="No property address found in the document. Select a property and try again.",
                )
        auto_applied = _apply_extracted(db, prop, extracted)
        if auto_applied:
            db.flush()

    # Deduplication (property docs only — key: account + year)
    loan_account_number = (extracted.get("account_number") or "").strip()
    statement_year = extracted.get("statement_year")
    if prop and loan_account_number and statement_year:
        duplicate_doc = (
            db.query(models.Document)
            .filter(
                models.Document.property_id == prop.id,
                models.Document.loan_account_number == loan_account_number,
                models.Document.statement_year == statement_year,
            )
            .first()
        )
        if duplicate_doc:
            os.remove(save_path)
            if markdown_name:
                (UPLOAD_DIR / markdown_name).unlink(missing_ok=True)
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A document for loan account {loan_account_number}, "
                    f"year {statement_year} already exists "
                    f"(uploaded {duplicate_doc.upload_date.strftime('%Y-%m-%d') if duplicate_doc.upload_date else 'N/A'}). "
                    f"Upload a different statement period or delete the existing document first."
                ),
            )

    period_type = extracted.get("period_type", "other")
    period_start = extracted.get("period_start") or extracted.get("statement_date")
    period_end = extracted.get("period_end") or extracted.get("statement_date")

    doc = models.Document(
        property_id=prop.id if prop else None,
        owner_id=current_user.id,
        filename=unique_name,
        original_filename=file.filename,
        file_type=suffix.lstrip("."),
        doc_category=category,
        file_size=len(content),
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
    if is_tax_return:
        try:
            tax_entries_imported = import_tax_return(
                db, current_user.id, doc.id, str(save_path))
        except Exception:
            tax_entries_imported = 0

    return {
        "id": doc.id,
        "original_filename": doc.original_filename,
        "category": doc.doc_category,
        "file_size": doc.file_size,
        "extracted_data": extracted,
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
        "tax_entries_imported": tax_entries_imported,
    }


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
    return [
        {
            "id": d.id,
            "property_id": d.property_id,
            "property_address": d.property.address if d.property else None,
            "original_filename": d.original_filename,
            "file_type": d.file_type,
            "doc_category": d.doc_category,
            "file_size": d.file_size,
            "extracted_data": json.loads(d.extracted_data) if d.extracted_data else {},
            "loan_account_number": d.loan_account_number,
            "statement_year": d.statement_year,
            "period_type": d.period_type,
            "period_start": d.period_start,
            "period_end": d.period_end,
            "upload_date": d.upload_date,
            "has_markdown": bool(d.markdown_file),
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
def reparse_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Re-run extraction (with auto-detection) on an already uploaded file."""
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = UPLOAD_DIR / doc.filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file missing")

    try:
        category, extracted, markdown = parse_document(str(path), "auto")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse failed: {e}")

    doc.doc_category = category
    doc.extracted_data = json.dumps(extracted)
    doc.loan_account_number = (extracted.get("account_number") or "").strip() or None
    doc.statement_year = extracted.get("statement_year")
    if markdown:
        markdown_name = doc.markdown_file or f"{Path(doc.filename).stem}.md"
        (UPLOAD_DIR / markdown_name).write_text(markdown)
        doc.markdown_file = markdown_name
    db.commit()

    if category == "tax_return":
        try:
            import_tax_return(db, doc.owner_id, doc.id, str(path))
        except Exception:
            pass

    return {
        "id": doc.id,
        "category": category,
        "extracted_data": extracted,
        "has_markdown": bool(doc.markdown_file),
    }


@router.post("/reprocess-all")
def reprocess_all_documents(
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
            errors.append({"id": doc.id, "file": doc.original_filename, "error": "stored file missing"})
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
            import_tax_return(db, current_user.id, doc_id, path)
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
    doc = db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.owner_id == current_user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.property:
        return {"applied": {}, "message": "Common documents (tax returns) apply to all properties automatically"}

    data = json.loads(doc.extracted_data) if doc.extracted_data else {}
    applied = _apply_extracted(db, doc.property, data)

    if not applied:
        return {"applied": {}, "message": "No applicable fields found in this document"}

    db.commit()
    return {"applied": applied, "message": f"Applied {len(applied)} field(s)"}


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
            "file_type": d.file_type,
            "doc_category": d.doc_category,
            "file_size": d.file_size,
            "extracted_data": json.loads(d.extracted_data) if d.extracted_data else {},
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
        try:
            os.remove(UPLOAD_DIR / doc.filename)
        except FileNotFoundError:
            pass
        if doc.markdown_file:
            try:
                os.remove(UPLOAD_DIR / doc.markdown_file)
            except FileNotFoundError:
                pass
        db.delete(doc)
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

    # Delete file(s)
    try:
        os.remove(UPLOAD_DIR / doc.filename)
    except FileNotFoundError:
        pass
    if doc.markdown_file:
        try:
            os.remove(UPLOAD_DIR / doc.markdown_file)
        except FileNotFoundError:
            pass

    db.delete(doc)
    db.commit()
    return {"ok": True}
