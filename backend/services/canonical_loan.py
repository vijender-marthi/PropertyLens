"""Canonical loan identity resolution for document-driven mutations.

This service decides identity only. Financial field selection and calculations
remain in their existing backend engines.
"""
from __future__ import annotations

import re
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Mapping, Optional

import models


LOAN_DOCUMENT_CATEGORIES = {
    "closing_statement",
    "loan_disclosure",
    "mortgage_statement",
    "1098",
}
PERIODIC_CATEGORIES = {"mortgage_statement", "1098"}
LOAN_EVIDENCE_PRIORITY = {
    "1098": 30,
    "mortgage_statement": 20,
    "loan_disclosure": 10,
    "closing_statement": 10,
    "payoff_statement": 10,
}


@dataclass(frozen=True)
class CanonicalLoanResolution:
    action: str
    loan: Optional[models.Loan]
    created: bool = False
    servicer_segment_created: bool = False
    confidence: float = 0.0
    explanation: str = ""


def normalize_account(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def accounts_match(left: Any, right: Any) -> bool:
    a, b = normalize_account(left), normalize_account(right)
    if not a or not b:
        return False
    return a == b or (
        min(len(a), len(b)) >= 6
        and (a.startswith(b) or b.startswith(a) or a.endswith(b) or b.endswith(a))
    )


def _number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace("$", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _iso(value: Any) -> Optional[str]:
    if not value:
        return None
    raw = str(value).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return raw[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", raw) else None


def _purpose(data: Mapping[str, Any], category: str) -> str:
    value = str(
        data.get("transaction_purpose")
        or data.get("loan_purpose")
        or data.get("purpose")
        or ""
    ).upper()
    if "REFINANCE" in value or data.get("prior_loan_payoff_amount") is not None:
        return "REFINANCE"
    if "PURCHASE" in value:
        return "PURCHASE"
    if "TRANSFER" in value:
        return "SERVICER_TRANSFER"
    if category in PERIODIC_CATEGORIES:
        return "PERIODIC_STATEMENT"
    return "UNKNOWN"


def _document_date(data: Mapping[str, Any]) -> Optional[str]:
    return _iso(
        data.get("servicer_start_date")
        or data.get("mortgage_acquisition_date")
        or data.get("origination_date")
        or data.get("closing_date")
        or data.get("statement_date")
    )


def _same_origination(loan: models.Loan, data: Mapping[str, Any]) -> bool:
    amount = _number(data.get("original_amount") or data.get("loan_amount"))
    rate = _number(data.get("interest_rate"))
    amount_match = amount is None or abs(float(loan.original_amount or 0) - amount) <= 500
    rate_match = rate is None or abs(float(loan.interest_rate or 0) - rate) <= 0.01
    return amount_match and rate_match


def _strong_new_debt(data: Mapping[str, Any], category: str) -> bool:
    purpose = _purpose(data, category)
    if purpose == "REFINANCE":
        return True
    return bool(
        category == "loan_disclosure"
        and data.get("origination_date")
        and _number(data.get("original_amount") or data.get("loan_amount"))
        and _number(data.get("interest_rate")) is not None
    )


def _loan_for_account(loans: list[models.Loan], account_number: str) -> Optional[models.Loan]:
    if not account_number:
        return None
    for loan in loans:
        if accounts_match(loan.account_number, account_number):
            return loan
        if any(accounts_match(segment.account_number, account_number) for segment in loan.servicer_segments):
            return loan
    return None


def _origination_candidate(
    loans: list[models.Loan],
    data: Mapping[str, Any],
    *,
    purpose: str,
    document: Optional[models.Document],
) -> Optional[models.Loan]:
    amount = _number(data.get("original_amount") or data.get("loan_amount"))
    rate = _number(data.get("interest_rate"))
    origin = _iso(data.get("origination_date") or data.get("closing_date") or data.get("disbursement_date"))
    lender = normalize_account(data.get("lender_name"))
    ranked = []
    for loan in loans:
        loan_purpose = str(loan.purpose or "").upper()
        if purpose in {"PURCHASE", "REFINANCE"} and loan_purpose and loan_purpose != purpose:
            continue
        score = 0
        if document and loan.source_document_id == document.id:
            score += 200
        if amount is not None and abs(float(loan.original_amount or 0) - amount) <= 2:
            score += 70
        if rate is not None and abs(float(loan.interest_rate or 0) - rate) <= 0.01:
            score += 25
        loan_origin = _iso(loan.disbursement_date or loan.origination_date)
        if origin and loan_origin:
            try:
                if abs((datetime.fromisoformat(origin).date() - datetime.fromisoformat(loan_origin).date()).days) <= 14:
                    score += 60
            except ValueError:
                pass
        if lender and lender == normalize_account(loan.lender_at_origination or loan.lender_name):
            score += 25
        if score >= 70:
            ranked.append((score, loan.id, loan))
    return sorted(ranked, key=lambda item: (-item[0], item[1]))[0][2] if ranked else None


def _resolve_alias(db, prop_id: int, loan_id: Optional[int]) -> Optional[int]:
    if not loan_id:
        return None
    alias = db.query(models.LoanResolutionAlias).filter_by(
        property_id=prop_id,
        old_loan_id=loan_id,
    ).order_by(models.LoanResolutionAlias.created_at.desc()).first()
    return alias.canonical_loan_id if alias else loan_id


def _ensure_document_link(
    db,
    loan: models.Loan,
    document: Optional[models.Document],
    role: str,
) -> Optional[models.LoanDocumentLink]:
    if document is None:
        return None
    existing = db.query(models.LoanDocumentLink).filter_by(
        loan_id=loan.id,
        document_id=document.id,
    ).first()
    if existing is None:
        existing = models.LoanDocumentLink(
            id=str(uuid.uuid4()),
            loan_id=loan.id,
            document_id=document.id,
            source_role=role,
            fields_used="[]",
            priority=1 if role in {"LOAN_ORIGINATION_SOURCE", "REFINANCE_SOURCE"} else 10,
            confidence=0.99,
        )
        db.add(existing)
    return existing


def _periodic_snapshot_date(
    document: models.Document,
    data: Mapping[str, Any],
) -> Optional[str]:
    if document.doc_category == "1098":
        raw_year = document.statement_year or data.get("statement_year") or data.get("tax_year")
        match = re.search(r"(?:19|20)\d{2}", str(raw_year or ""))
        return f"{match.group(0)}-01-01" if match else None
    return _iso(data.get("statement_date") or data.get("period_end"))


def _snapshot_source_priority(snapshot: models.LoanBalanceSnapshot) -> int:
    category = snapshot.document.doc_category if snapshot.document else ""
    return LOAN_EVIDENCE_PRIORITY.get(category, 0)


def refresh_reported_loan_balance(db, loan: models.Loan) -> Optional[models.LoanBalanceSnapshot]:
    """Select the newest accepted reported balance without frontend fallback logic."""
    snapshots = db.query(models.LoanBalanceSnapshot).filter(
        models.LoanBalanceSnapshot.loan_id == loan.id,
        models.LoanBalanceSnapshot.balance.isnot(None),
    ).all()
    if not snapshots:
        return None
    latest = max(
        snapshots,
        key=lambda row: (
            row.as_of_date or "",
            _snapshot_source_priority(row),
            row.created_at.isoformat() if row.created_at else "",
            row.id,
        ),
    )
    existing_as_of = _iso(loan.balance_as_of or loan.current_balance_as_of)
    if existing_as_of and existing_as_of > latest.as_of_date and str(loan.current_balance_source or "").endswith("reported_balance"):
        return latest
    loan.current_balance = latest.balance
    loan.balance_as_of = latest.as_of_date
    loan.current_balance_as_of = latest.as_of_date
    category = latest.document.doc_category if latest.document else ""
    loan.current_balance_source = (
        "mortgage_statement_reported_balance"
        if category == "mortgage_statement"
        else "1098_box_2_reported_balance"
    )
    loan.current_balance_verified = True
    loan.statement_date = latest.as_of_date
    loan.source_document_id = latest.source_document_id
    loan.source_type = category or loan.source_type
    return latest


def apply_periodic_loan_evidence(
    db,
    loan: models.Loan,
    document: models.Document,
    data: Mapping[str, Any],
    *,
    selected_fields: Optional[set[str]] = None,
) -> Optional[models.LoanBalanceSnapshot]:
    """Persist one accepted statement/1098 as canonical loan evidence."""
    if document.doc_category not in PERIODIC_CATEGORIES:
        return None
    selected_fields = selected_fields or set()
    as_of_date = _periodic_snapshot_date(document, data)
    if not as_of_date:
        return None

    balance = _number(data.get("box2_balance") if document.doc_category == "1098" else data.get("current_balance"))
    if balance is None:
        balance = _number(data.get("current_balance") if document.doc_category == "1098" else None)
    if selected_fields and not ({"current_balance", "box2_balance"} & selected_fields):
        balance = None
    interest = _number(
        data.get("mortgage_interest")
        or data.get("box1_interest")
        or data.get("interest_paid_ytd")
    )
    principal = _number(data.get("principal_paid_ytd"))
    payment = _number(data.get("monthly_principal_and_interest") or data.get("monthly_payment"))

    snapshot = db.query(models.LoanBalanceSnapshot).filter_by(
        loan_id=loan.id,
        source_document_id=document.id,
    ).first()
    if snapshot is None:
        snapshot = models.LoanBalanceSnapshot(
            id=str(uuid.uuid4()),
            loan_id=loan.id,
            property_id=loan.property_id,
            source_document_id=document.id,
            as_of_date=as_of_date,
        )
        db.add(snapshot)
    snapshot.as_of_date = as_of_date
    snapshot.balance = balance
    snapshot.principal_paid_ytd = principal
    snapshot.interest_paid_ytd = interest
    snapshot.payment = payment

    role = "CURRENT_BALANCE_SOURCE" if document.doc_category == "mortgage_statement" else "SUPPORTING_SOURCE"
    link = _ensure_document_link(db, loan, document, role)
    used_fields = set(selected_fields)
    if balance is not None:
        used_fields.add("currentBalance" if document.doc_category == "mortgage_statement" else "box2Balance")
        used_fields.add("balanceAsOf")
    if interest is not None:
        used_fields.add("interestPaidYtd" if document.doc_category == "mortgage_statement" else "mortgageInterest")
    if principal is not None:
        used_fields.add("principalPaidYtd")
    link.source_role = role
    link.fields_used = json.dumps(sorted(used_fields))
    link.priority = 1 if document.doc_category == "1098" else 2 if document.doc_category == "mortgage_statement" else 3
    link.confidence = 0.99
    db.flush()
    refresh_reported_loan_balance(db, loan)
    return snapshot


def ensure_servicer_segment(
    db,
    loan: models.Loan,
    data: Mapping[str, Any],
    document: Optional[models.Document] = None,
) -> bool:
    account = str(data.get("account_number") or data.get("loan_id") or "").strip()
    servicer = str(data.get("servicer") or data.get("lender_name") or loan.current_servicer or loan.lender_name or "").strip()
    normalized = normalize_account(account)
    if not normalized and not servicer:
        return False

    # Preserve legacy servicing identity before a new account replaces the
    # compatibility columns on Loan.
    legacy_account = str(loan.account_number or "").strip()
    if (
        not loan.servicer_segments
        and legacy_account
        and normalized
        and not accounts_match(legacy_account, normalized)
    ):
        db.add(models.LoanServicerSegment(
            id=str(uuid.uuid4()),
            loan=loan,
            servicer=loan.current_servicer or loan.lender_name,
            account_number=legacy_account,
            normalized_account_number=normalize_account(legacy_account),
            from_date=loan.servicer_start_date or loan.origination_date or "",
            to_date=None,
            is_current=True,
            source_document_id=loan.source_document_id,
            confidence=1.0,
        ))
        db.flush()

    from_date = _document_date(data) or loan.servicer_start_date or loan.origination_date or ""
    normalized_servicer = re.sub(r"[^A-Z0-9]", "", servicer.upper())
    matching = next((
        segment for segment in loan.servicer_segments
        if (
            normalized and accounts_match(segment.normalized_account_number, normalized)
        ) or (
            not normalized
            and not segment.normalized_account_number
            and segment.from_date == from_date
            and re.sub(r"[^A-Z0-9]", "", str(segment.servicer or "").upper()) == normalized_servicer
        )
    ), None)
    if matching:
        matching.servicer = servicer or matching.servicer
        matching.account_number = account or matching.account_number
        matching.is_current = True
        matching.source_document_id = document.id if document else matching.source_document_id
        for segment in loan.servicer_segments:
            if segment.id != matching.id:
                segment.is_current = False
        loan.account_number = account or loan.account_number
        loan.current_servicer = servicer or loan.current_servicer
        return False

    current = next((segment for segment in loan.servicer_segments if segment.is_current), None)
    if current and from_date and current.from_date and from_date > current.from_date:
        try:
            current.to_date = (datetime.strptime(from_date, "%Y-%m-%d").date() - timedelta(days=1)).isoformat()
        except ValueError:
            current.to_date = from_date
        current.is_current = False

    db.add(models.LoanServicerSegment(
        id=str(uuid.uuid4()),
        loan=loan,
        servicer=servicer or None,
        account_number=account or None,
        normalized_account_number=normalized,
        from_date=from_date,
        is_current=True,
        source_document_id=document.id if document else None,
        confidence=0.99 if normalized else 0.8,
    ))
    loan.account_number = account or loan.account_number
    loan.current_servicer = servicer or loan.current_servicer or loan.lender_name
    loan.servicer_start_date = from_date or loan.servicer_start_date
    loan.is_current_servicer = True
    return True


def link_transaction_loan(
    db,
    transaction: models.PropertyTransaction,
    loan: models.Loan,
    *,
    role: str = "ORIGINATED_DEBT",
    lien_position: Optional[int] = None,
) -> models.TransactionLoanLink:
    existing = db.query(models.TransactionLoanLink).filter_by(
        transaction_id=transaction.id,
        loan_id=loan.id,
    ).one_or_none()
    if existing:
        existing.role = role
        existing.lien_position = lien_position if lien_position is not None else existing.lien_position
        return existing
    link = models.TransactionLoanLink(
        id=str(uuid.uuid4()),
        transaction_id=transaction.id,
        loan_id=loan.id,
        role=role,
        lien_position=lien_position,
    )
    db.add(link)
    return link


def _close_prior_open_loan_for_refinance(
    loans: list[models.Loan],
    replacement: models.Loan,
    data: Mapping[str, Any],
) -> None:
    """Close the unambiguous predecessor when a disclosure establishes new debt.

    A refinance disclosure is sufficient to establish a replacement obligation.
    If the property has exactly one other open debt, retain it as history and
    close it on the refinance funding/closing date. A payoff document may later
    replace its balance with the reported payoff amount.
    """
    prior_candidates = [
        loan for loan in loans
        if loan.id != replacement.id and str(loan.status or "OPEN").upper() == "OPEN"
    ]
    if len(prior_candidates) != 1:
        return
    prior = prior_candidates[0]
    close_date = _iso(data.get("disbursement_date") or data.get("closing_date") or data.get("origination_date"))
    prior.status = "CLOSED"
    prior.closed_date = close_date or prior.closed_date
    prior.servicer_end_date = close_date or prior.servicer_end_date
    prior.closure_reason = "Refinanced"
    prior.transfer_reason = "Refinanced"
    prior.is_current_servicer = False
    prior.refinanced_into_loan_id = replacement.id
    prior.replacement_loan_id = replacement.id
    replacement.refinanced_from_loan_id = prior.id


def resolve_canonical_loan(
    db,
    prop: models.Property,
    data: Mapping[str, Any],
    *,
    category: str,
    document: Optional[models.Document] = None,
    selected_loan_id: Optional[int] = None,
    allow_create: bool = True,
) -> CanonicalLoanResolution:
    """Resolve a document to canonical debt before applying extracted values."""
    if category not in LOAN_DOCUMENT_CATEGORIES:
        return CanonicalLoanResolution(
            "UNRESOLVED", None, explanation="Document category does not establish or update debt."
        )

    account = str(data.get("account_number") or data.get("loan_id") or "").strip()
    purpose = _purpose(data, category)
    loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).all()
    selected_id = _resolve_alias(db, prop.id, selected_loan_id)
    selected = next((loan for loan in loans if loan.id == selected_id), None)

    if document is not None:
        existing_link = db.query(models.LoanDocumentLink).filter_by(document_id=document.id).first()
        if existing_link and existing_link.loan.property_id == prop.id:
            return CanonicalLoanResolution(
                "UPDATE_EXISTING", existing_link.loan, confidence=1.0,
                explanation="Document is already linked to canonical debt.",
            )

    matched = _loan_for_account(loans, account)
    if matched:
        _ensure_document_link(db, matched, document, "CURRENT_BALANCE_SOURCE")
        created_segment = ensure_servicer_segment(db, matched, data, document)
        return CanonicalLoanResolution(
            "UPDATE_EXISTING", matched, servicer_segment_created=created_segment,
            confidence=1.0, explanation="Servicing account already belongs to this loan.",
        )

    if (
        purpose == "PERIODIC_STATEMENT"
        and selected
        and not _strong_new_debt(data, category)
        and _same_origination(selected, data)
    ):
        _ensure_document_link(db, selected, document, "CURRENT_BALANCE_SOURCE")
        created_segment = ensure_servicer_segment(db, selected, data, document)
        return CanonicalLoanResolution(
            "SERVICER_TRANSFER" if created_segment else "UPDATE_EXISTING",
            selected,
            servicer_segment_created=created_segment,
            confidence=0.99,
            explanation="The user-selected debt received evidence from a new servicing account.",
        )

    active = [loan for loan in loans if str(loan.status or "OPEN").upper() == "OPEN"]
    if purpose == "PERIODIC_STATEMENT" and len(active) == 1 and not _strong_new_debt(data, category):
        candidate = active[0]
        if _same_origination(candidate, data):
            _ensure_document_link(db, candidate, document, "CURRENT_BALANCE_SOURCE")
            created_segment = ensure_servicer_segment(db, candidate, data, document)
            return CanonicalLoanResolution(
                "SERVICER_TRANSFER" if created_segment else "UPDATE_EXISTING",
                candidate,
                servicer_segment_created=created_segment,
                confidence=0.9,
                explanation="Periodic evidence matches the property's only active debt.",
            )

    origination_match = _origination_candidate(
        loans, data, purpose=purpose, document=document,
    )
    if origination_match is not None:
        _ensure_document_link(
            db, origination_match, document,
            "REFINANCE_SOURCE" if purpose == "REFINANCE" else "LOAN_ORIGINATION_SOURCE",
        )
        created_segment = ensure_servicer_segment(db, origination_match, data, document)
        return CanonicalLoanResolution(
            "UPDATE_EXISTING", origination_match,
            servicer_segment_created=created_segment,
            confidence=0.99,
            explanation="Origination terms match existing canonical debt.",
        )

    if not allow_create:
        return CanonicalLoanResolution(
            "UNRESOLVED", None, confidence=0.0,
            explanation="No canonical loan matched and creation was disabled.",
        )

    amount = _number(data.get("original_amount") or data.get("loan_amount") or data.get("current_balance"))
    rate = _number(data.get("interest_rate"))
    if purpose == "PERIODIC_STATEMENT" and not (amount and rate is not None and data.get("origination_date")):
        return CanonicalLoanResolution(
            "UNRESOLVED", None, confidence=0.0,
            explanation="Periodic evidence lacks enough origination data to establish new debt.",
        )

    loan = models.Loan(
        property_id=prop.id,
        lender_name=str(data.get("lender_name") or data.get("servicer") or ""),
        loan_type=str(data.get("loan_type") or "FIXED"),
        status="OPEN",
        original_amount=amount or 0.0,
        current_balance=_number(data.get("current_balance")) or amount or 0.0,
        interest_rate=rate or 0.0,
        monthly_payment=_number(data.get("monthly_principal_and_interest") or data.get("monthly_payment")) or 0.0,
        loan_term_years=int(_number(data.get("loan_term_years")) or 30),
        origination_date=_iso(data.get("origination_date") or data.get("closing_date")),
        account_number=account or None,
        purpose="REFINANCE" if purpose == "REFINANCE" else "PURCHASE" if purpose == "PURCHASE" else "UNKNOWN",
        source_document_id=document.id if document else None,
        source_type=category,
        import_status="reviewed",
    )
    db.add(loan)
    db.flush()
    _ensure_document_link(
        db, loan, document,
        "REFINANCE_SOURCE" if purpose == "REFINANCE" else "LOAN_ORIGINATION_SOURCE",
    )
    if purpose == "REFINANCE":
        _close_prior_open_loan_for_refinance(loans, loan, data)
    created_segment = ensure_servicer_segment(db, loan, data, document)
    return CanonicalLoanResolution(
        "NEW_REFINANCE" if purpose == "REFINANCE" else "NEW_LOAN",
        loan,
        created=True,
        servicer_segment_created=created_segment,
        confidence=0.99 if purpose in {"PURCHASE", "REFINANCE"} else 0.75,
        explanation="Document establishes a distinct debt obligation.",
    )
