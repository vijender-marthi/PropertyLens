"""Backend-owned property transaction and loan lifecycle resolution."""
from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

import models
from services.canonical_loan import (
    apply_periodic_loan_evidence,
    link_transaction_loan,
    resolve_canonical_loan,
)
from services.property_valuation import apply_default_settlement_total, settlement_cost_breakdown


FINAL_ORIGINATION_CATEGORIES = {"closing_statement", "loan_disclosure", "payoff_statement"}
PERIODIC_CATEGORIES = {"mortgage_statement", "1098"}
SETUP_DELINKED_TAG = "SETUP_DELINKED"


def _currency_exact(value: Any) -> str:
    return f"${float(value):,.2f}"


def _data(document: models.Document) -> Dict[str, Any]:
    try:
        value = json.loads(document.extracted_data or "{}")
    except (TypeError, json.JSONDecodeError):
        value = {}
    return value if isinstance(value, dict) else {}


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


def _date_value(value: Any) -> date:
    normalized = _iso(value)
    try:
        return datetime.strptime(normalized or "9999-12-31", "%Y-%m-%d").date()
    except ValueError:
        return date.max


def _latest_date_value(value: Any) -> date:
    normalized = _iso(value)
    try:
        return datetime.strptime(normalized or "0001-01-01", "%Y-%m-%d").date()
    except ValueError:
        return date.min


def _account(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits


def _accounts_match(left: Any, right: Any) -> bool:
    a, b = _account(left), _account(right)
    if not a or not b:
        return False
    return a == b or (min(len(a), len(b)) >= 6 and (a.startswith(b) or b.startswith(a)))


def _lender(value: Any) -> str:
    text = re.sub(r"\b(NATIONAL ASSOCIATION|N\.A\.?|NA|INC\.?|LLC|LTD\.?|LP)\b", "", str(value or "").upper())
    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def _lenders_match(left: Any, right: Any) -> bool:
    a, b = _lender(left), _lender(right)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _amount_close(left: Any, right: Any, tolerance: float = 2.0) -> bool:
    a, b = _number(left), _number(right)
    return a is not None and b is not None and abs(a - b) <= tolerance


def _purpose(data: Dict[str, Any], document: models.Document) -> str:
    explicit = str(data.get("transaction_purpose") or data.get("loan_purpose") or data.get("purpose") or "").upper()
    if "PURCHASE" in explicit:
        return "PURCHASE"
    if "REFINANCE" in explicit or data.get("prior_loan_payoff_amount"):
        return "REFINANCE"
    if "MODIFICATION" in explicit:
        return "MODIFICATION"
    if "PAYOFF" in explicit or document.doc_category == "payoff_statement":
        return "PAYOFF"
    if "TRANSFER" in explicit:
        return "SERVICER_TRANSFER"
    if document.doc_category in FINAL_ORIGINATION_CATEGORIES and data.get("purchase_price") is not None:
        return "PURCHASE"
    if document.doc_category in PERIODIC_CATEGORIES:
        return "PERIODIC_STATEMENT"
    return "UNKNOWN"


def classify_document(document: models.Document) -> Dict[str, Any]:
    data = _data(document)
    category = (document.doc_category or "").lower()
    if data.get("document_type"):
        document_type = str(data["document_type"]).upper()
    elif category == "closing_statement":
        document_type = "SETTLEMENT_STATEMENT" if data.get("setup_import_role") == "settlement_document" else "CLOSING_DISCLOSURE"
    else:
        document_type = {
            "loan_disclosure": "LOAN_ESTIMATE",
            "mortgage_statement": "MORTGAGE_STATEMENT",
            "1098": "FORM_1098",
            "payoff_statement": "PAYOFF_STATEMENT",
            "escrow_analysis": "ESCROW_ANALYSIS",
            "property_tax": "PROPERTY_TAX_BILL",
        }.get(category, "OTHER")
    purpose = _purpose(data, document)
    if purpose == "PURCHASE":
        role = "ACQUISITION_SOURCE" if document_type == "SETTLEMENT_STATEMENT" else "LOAN_ORIGINATION_SOURCE"
    elif purpose == "REFINANCE":
        role = "PAYOFF_SOURCE" if data.get("prior_loan_payoff_amount") and document_type == "SETTLEMENT_STATEMENT" else "REFINANCE_SOURCE"
    elif purpose == "PAYOFF":
        role = "PAYOFF_SOURCE"
    elif purpose == "PERIODIC_STATEMENT":
        role = "CURRENT_BALANCE_SOURCE" if category == "mortgage_statement" else "SUPPORTING_SOURCE"
    else:
        role = str(data.get("transaction_role") or "SUPPORTING_SOURCE").upper()
    confidence = float(data.get("classification_confidence") or (0.99 if purpose != "UNKNOWN" else 0.65))
    document.document_type = document_type
    document.transaction_purpose = purpose
    document.transaction_role = role
    document.classification_confidence = confidence
    data.update({
        "document_type": document_type,
        "transaction_purpose": purpose,
        "transaction_role": role,
        "classification_confidence": confidence,
    })
    document.extracted_data = json.dumps(data)
    return data


def _transaction_date(data: Dict[str, Any]) -> Optional[str]:
    return _iso(data.get("closing_date") or data.get("settlement_date") or data.get("origination_date"))


def _normalized_identity(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _document_address(data: Dict[str, Any]) -> str:
    return _normalized_identity(" ".join(str(data.get(key) or "") for key in (
        "property_address", "property_city", "property_state", "property_zip",
    )))


def _borrower_identity(data: Dict[str, Any]) -> set[str]:
    return {
        _normalized_identity(data.get(key))
        for key in ("borrower_1", "borrower_2", "borrower_3", "borrower_4", "borrower_name")
        if _normalized_identity(data.get(key))
    }


def _same_transaction(
    left: Tuple[models.Document, Dict[str, Any]],
    right: Tuple[models.Document, Dict[str, Any]],
) -> bool:
    left_doc, left_data = left
    right_doc, right_data = right
    if _purpose(left_data, left_doc) != _purpose(right_data, right_doc):
        return False

    left_address, right_address = _document_address(left_data), _document_address(right_data)
    if left_address and right_address and left_address != right_address:
        return False

    left_date = _transaction_date(left_data)
    right_date = _transaction_date(right_data)
    if left_date and right_date:
        return abs((_date_value(left_date) - _date_value(right_date)).days) <= 14

    for key in ("escrow_number", "file_number", "settlement_file_number"):
        left_value, right_value = _normalized_identity(left_data.get(key)), _normalized_identity(right_data.get(key))
        if left_value and right_value and left_value == right_value:
            return True

    left_account = _loan_doc_account(left_data, left_doc)
    right_account = _loan_doc_account(right_data, right_doc)
    if left_account and right_account and _accounts_match(left_account, right_account):
        return True

    amount_match = _amount_close(
        left_data.get("original_amount") or left_data.get("loan_amount"),
        right_data.get("original_amount") or right_data.get("loan_amount"),
        2.0,
    )
    lender_match = _lenders_match(left_data.get("lender_name"), right_data.get("lender_name"))
    borrower_match = bool(_borrower_identity(left_data) & _borrower_identity(right_data))
    return amount_match and (lender_match or borrower_match)


def _group_transaction_documents(
    classified: List[Tuple[models.Document, Dict[str, Any]]],
) -> List[Tuple[str, str, List[Tuple[models.Document, Dict[str, Any]]]]]:
    groups: List[List[Tuple[models.Document, Dict[str, Any]]]] = []
    candidates = [
        item for item in classified
        if item[0].doc_category in FINAL_ORIGINATION_CATEGORIES
        and _purpose(item[1], item[0]) in {"PURCHASE", "REFINANCE", "MODIFICATION", "PAYOFF"}
    ]
    for item in sorted(candidates, key=lambda entry: (_date_value(_transaction_date(entry[1])), entry[0].id)):
        matching = next((group for group in groups if any(_same_transaction(item, existing) for existing in group)), None)
        if matching is None:
            groups.append([item])
        else:
            matching.append(item)

    result = []
    for group in groups:
        purpose = _purpose(group[0][1], group[0][0])
        dates = sorted(date_value for _doc, data in group if (date_value := _transaction_date(data)))
        anchor = dates[0] if dates else f"document-{min(doc.id for doc, _data in group)}"
        result.append((f"{purpose}:{anchor}", purpose, group))
    return result


def _field_choice(
    documents: Iterable[Tuple[models.Document, Dict[str, Any]]],
    keys: Iterable[str],
    *,
    preferred_types: Tuple[str, ...],
) -> Tuple[Any, Optional[models.Document], Optional[str]]:
    ranked = []
    for document, data in documents:
        value = next((data.get(key) for key in keys if data.get(key) not in (None, "")), None)
        if value is None:
            continue
        dtype = document.document_type or "OTHER"
        rank = preferred_types.index(dtype) if dtype in preferred_types else len(preferred_types) + 10
        ranked.append((rank, document.id, value, document, next(key for key in keys if data.get(key) not in (None, ""))))
    if not ranked:
        return None, None, None
    _rank, _id, value, document, key = sorted(ranked, key=lambda item: (item[0], item[1]))[0]
    return value, document, key


TRANSACTION_FIELDS = {
    "purchase_price": (("purchase_price", "sale_price"), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "borrower_paid_closing_costs": (("closing_costs",), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "down_payment": (("down_payment",), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "cash_to_close": (("cash_to_close", "balance_due_from_buyer"), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "deposit_paid_before_closing": (("deposit_paid_before_closing", "deposit"), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "total_due_from_borrower": (("total_due_from_borrower",), ("CLOSING_DISCLOSURE",)),
    "total_paid_on_behalf_of_borrower": (("total_paid_on_behalf_of_borrower",), ("CLOSING_DISCLOSURE",)),
    "settlement_debit_total": (("settlement_debit_total",), ("SETTLEMENT_STATEMENT",)),
    "settlement_credit_total": (("settlement_credit_total",), ("SETTLEMENT_STATEMENT",)),
    "seller_credits": (("seller_credits", "seller_credit"), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "tax_prorations": (("tax_prorations",), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    "hoa_prorations": (("hoa_prorations", "hoa_annual"), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
}


def _upsert_transaction(
    db,
    prop: models.Property,
    purpose: str,
    docs: List[Tuple[models.Document, Dict[str, Any]]],
    resolution_key: Optional[str] = None,
) -> models.PropertyTransaction:
    closing_date, closing_document, _closing_key = _field_choice(
        docs,
        ("closing_date", "settlement_date", "origination_date"),
        preferred_types=("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT", "LOAN_ESTIMATE"),
    )
    closing_date = _iso(closing_date)
    disbursement_date, disbursement_document, _disbursement_key = _field_choice(
        docs,
        ("disbursement_date",),
        preferred_types=("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT"),
    )
    if disbursement_date in (None, ""):
        disbursement_date = closing_date
        disbursement_document = closing_document
    disbursement_date = _iso(disbursement_date)
    existing = next((
        transaction for transaction in prop.transactions
        if (resolution_key and transaction.resolution_key == resolution_key)
        or (transaction.purpose == purpose
        and (
            transaction.closing_date == closing_date
            or abs((_date_value(transaction.closing_date) - _date_value(closing_date)).days) <= 14
        ))
    ), None)
    transaction = existing or models.PropertyTransaction(
        id=str(uuid.uuid4()), property_id=prop.id, owner_id=prop.owner_id,
        transaction_type=purpose, purpose=purpose,
    )
    preserve_accepted = bool(existing and existing.status == "USER_CONFIRMED")
    if not existing:
        db.add(transaction)
        db.flush()
    transaction.transaction_type = purpose
    if not preserve_accepted:
        transaction.resolution_key = resolution_key or transaction.resolution_key
        transaction.closing_date = closing_date
        transaction.disbursement_date = disbursement_date
        transaction.status = "RESOLVED"
    transaction.confidence = round(min(data.get("classification_confidence", 0.9) for _doc, data in docs), 4)
    db.query(models.TransactionDocumentLink).filter_by(transaction_id=transaction.id).delete(synchronize_session=False)
    selected_by_doc: Dict[int, List[str]] = {}
    if closing_document and _iso(closing_date) == transaction.closing_date:
        selected_by_doc.setdefault(closing_document.id, []).append("closing_date")
    if disbursement_document and _iso(disbursement_date) == transaction.disbursement_date:
        selected_by_doc.setdefault(disbursement_document.id, []).append("disbursement_date")
    for field, (keys, precedence) in TRANSACTION_FIELDS.items():
        value, document, _source_key = _field_choice(docs, keys, preferred_types=precedence)
        if value is not None:
            resolved_value = _number(value)
            if not preserve_accepted:
                setattr(transaction, field, resolved_value)
            if document and getattr(transaction, field, None) == resolved_value:
                selected_by_doc.setdefault(document.id, []).append(field)
    for document, data in docs:
        db.add(models.TransactionDocumentLink(
            id=str(uuid.uuid4()), transaction_id=transaction.id, document_id=document.id,
            source_role=document.transaction_role,
            source_priority=1 if document.document_type == "CLOSING_DISCLOSURE" else 2,
            fields_used=json.dumps(selected_by_doc.get(document.id, [])),
            match_confidence=0.99 if document.document_type in {"CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT"} else float(data.get("classification_confidence") or 0.9),
        ))
    return transaction


def _loan_doc_account(data: Dict[str, Any], document: models.Document) -> str:
    return _account(data.get("account_number") or data.get("loan_id") or document.loan_account_number)


def _loan_doc_account_value(data: Dict[str, Any], document: models.Document) -> str:
    """Preserve the source representation while matching on normalized digits."""
    return str(data.get("account_number") or data.get("loan_id") or document.loan_account_number or "").strip()


def _origination_doc(docs: List[Tuple[models.Document, Dict[str, Any]]]) -> Tuple[models.Document, Dict[str, Any]]:
    ranked = sorted(docs, key=lambda item: (
        0 if item[0].document_type == "CLOSING_DISCLOSURE" else 1,
        item[0].id,
    ))
    return ranked[0]


def _find_canonical_loan(prop: models.Property, docs: List[Tuple[models.Document, Dict[str, Any]]]) -> Optional[models.Loan]:
    origin_doc, origin_data = _origination_doc(docs)
    account = _loan_doc_account(origin_data, origin_doc)
    amount = _number(origin_data.get("original_amount") or origin_data.get("loan_amount"))
    rate = _number(origin_data.get("interest_rate"))
    origin = _iso(origin_data.get("closing_date") or origin_data.get("origination_date") or origin_data.get("settlement_date"))
    candidates = []
    for loan in prop.loans:
        score = 0
        if account and _accounts_match(account, loan.account_number): score += 100
        if amount and _amount_close(amount, loan.original_amount): score += 40
        if rate and _amount_close(rate, loan.interest_rate, 0.01): score += 20
        if origin and _iso(loan.origination_date) == origin: score += 20
        if _lenders_match(origin_data.get("lender_name"), loan.lender_name): score += 10
        score += 5 if loan.account_number else 0
        score += 5 if (loan.interest_rate or 0) > 0 else 0
        if score:
            candidates.append((score, loan.id, loan))
    return sorted(candidates, key=lambda item: (-item[0], -item[1]))[0][2] if candidates else None


def _source_page(document_type: str, field: str) -> Optional[int]:
    if document_type == "CLOSING_DISCLOSURE":
        if field in {
            "cash_to_close", "total_due_from_borrower", "total_paid_on_behalf_of_borrower",
            "cashToClose", "totalDueFromBorrower", "totalPaidOnBehalfOfBorrower",
        }:
            return 3
        if field in {"borrower_paid_closing_costs", "borrowerPaidClosingCosts"}:
            return 2
        return 1
    if document_type == "SETTLEMENT_STATEMENT":
        return 1
    if document_type in {"LOAN_ESTIMATE", "MORTGAGE_STATEMENT", "FORM_1098", "PAYOFF_STATEMENT"}:
        return 1
    return None


def _loan_field_sources(
    origin_docs: List[Tuple[models.Document, Dict[str, Any]]],
    evidence_docs: List[Tuple[models.Document, Dict[str, Any]]],
) -> Dict[str, Tuple[Any, models.Document, str, float]]:
    all_docs = origin_docs + evidence_docs
    fields: Dict[str, Tuple[Any, models.Document, str, float]] = {}
    definitions = {
        "originalAmount": (("original_amount", "loan_amount"), ("CLOSING_DISCLOSURE", "LOAN_ESTIMATE", "SETTLEMENT_STATEMENT")),
        "interestRate": (("interest_rate",), ("CLOSING_DISCLOSURE", "LOAN_ESTIMATE", "MORTGAGE_STATEMENT")),
        "loanTermMonths": (("loan_term_months", "loan_term_years"), ("CLOSING_DISCLOSURE", "LOAN_ESTIMATE")),
        "monthlyPrincipalAndInterest": (("monthly_payment",), ("CLOSING_DISCLOSURE", "LOAN_ESTIMATE", "MORTGAGE_STATEMENT")),
        "originationDate": (("closing_date", "origination_date", "settlement_date"), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
        "disbursementDate": (("disbursement_date",), ("CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT")),
    }
    for field, (keys, precedence) in definitions.items():
        value, document, source_key = _field_choice(origin_docs, keys, preferred_types=precedence)
        if value is not None and document:
            if field == "loanTermMonths" and source_key == "loan_term_years":
                value = int(float(value) * 12)
            fields[field] = (value, document, source_key or field, 0.99 if document.document_type == "CLOSING_DISCLOSURE" else 0.94)
    statements = [item for item in all_docs if item[0].document_type == "MORTGAGE_STATEMENT" and item[1].get("current_balance") is not None]
    if statements:
        document, data = max(statements, key=lambda item: _latest_date_value(item[1].get("statement_date") or item[1].get("payment_due_date")))
        fields["currentBalance"] = (data.get("current_balance"), document, "current_balance", 0.99)
        fields["balanceAsOf"] = (_iso(data.get("statement_date") or data.get("payment_due_date")), document, "statement_date", 0.98)
        if data.get("monthly_payment") is not None:
            fields["currentPayment"] = (data.get("monthly_payment"), document, "monthly_payment", 0.98)
    return fields


def _link_loan_documents(db, loan: models.Loan, sources: Dict[str, Tuple[Any, models.Document, str, float]], docs: List[Tuple[models.Document, Dict[str, Any]]]) -> None:
    db.query(models.LoanDocumentLink).filter_by(loan_id=loan.id).delete(synchronize_session=False)
    fields_by_doc: Dict[int, List[str]] = {}
    for field, (_value, document, _key, _confidence) in sources.items():
        fields_by_doc.setdefault(document.id, []).append(field)
    for document, _data in docs:
        role = document.transaction_role or "SUPPORTING_SOURCE"
        db.add(models.LoanDocumentLink(
            id=str(uuid.uuid4()), loan_id=loan.id, document_id=document.id,
            source_role=role, fields_used=json.dumps(fields_by_doc.get(document.id, [])),
            priority=1 if document.document_type == "CLOSING_DISCLOSURE" else (2 if document.document_type == "SETTLEMENT_STATEMENT" else 3),
            confidence=float(document.classification_confidence or 0.9),
        ))


def _upsert_snapshots(db, loan: models.Loan, docs: List[Tuple[models.Document, Dict[str, Any]]]) -> None:
    for document, data in docs:
        apply_periodic_loan_evidence(db, loan, document, data)


def _merge_duplicate(db, prop: models.Property, duplicate: models.Loan, canonical: models.Loan) -> None:
    if duplicate.id == canonical.id:
        return
    db.query(models.EscrowPayment).filter_by(loan_id=duplicate.id).update({"loan_id": canonical.id}, synchronize_session=False)
    canonical_document_ids = {
        row.document_id for row in db.query(models.LoanDocumentLink).filter_by(loan_id=canonical.id).all()
    }
    for row in db.query(models.LoanDocumentLink).filter_by(loan_id=duplicate.id).all():
        if row.document_id in canonical_document_ids:
            db.delete(row)
        else:
            row.loan_id = canonical.id
            canonical_document_ids.add(row.document_id)
    canonical_snapshot_documents = {
        row.source_document_id
        for row in db.query(models.LoanBalanceSnapshot).filter_by(loan_id=canonical.id).all()
    }
    for row in db.query(models.LoanBalanceSnapshot).filter_by(loan_id=duplicate.id).all():
        if row.source_document_id in canonical_snapshot_documents:
            db.delete(row)
        else:
            row.loan_id = canonical.id
            canonical_snapshot_documents.add(row.source_document_id)
    canonical_transaction_ids = {
        row.transaction_id
        for row in db.query(models.TransactionLoanLink).filter_by(loan_id=canonical.id).all()
    }
    for row in db.query(models.TransactionLoanLink).filter_by(loan_id=duplicate.id).all():
        if row.transaction_id in canonical_transaction_ids:
            db.delete(row)
        else:
            row.loan_id = canonical.id
            canonical_transaction_ids.add(row.transaction_id)
    canonical_segments = {
        (row.normalized_account_number, row.from_date)
        for row in db.query(models.LoanServicerSegment).filter_by(loan_id=canonical.id).all()
    }
    for row in db.query(models.LoanServicerSegment).filter_by(loan_id=duplicate.id).all():
        identity = (row.normalized_account_number, row.from_date)
        if identity in canonical_segments:
            db.delete(row)
        else:
            row.loan_id = canonical.id
            canonical_segments.add(identity)
    db.query(models.LoanResolutionDiscrepancy).filter_by(loan_id=duplicate.id).update({"loan_id": canonical.id}, synchronize_session=False)
    for other in prop.loans:
        if other.replacement_loan_id == duplicate.id: other.replacement_loan_id = canonical.id
        if other.refinanced_into_loan_id == duplicate.id: other.refinanced_into_loan_id = canonical.id
        if other.refinanced_from_loan_id == duplicate.id: other.refinanced_from_loan_id = canonical.id
    alias = db.query(models.LoanResolutionAlias).filter_by(property_id=prop.id, old_loan_id=duplicate.id).first()
    if alias is None:
        db.add(models.LoanResolutionAlias(
            id=str(uuid.uuid4()), property_id=prop.id, old_loan_id=duplicate.id,
            canonical_loan_id=canonical.id, reason="Resolved duplicate document-generated loan",
        ))
    db.delete(duplicate)
    db.flush()


def _apply_acquisition(prop: models.Property, transaction: models.PropertyTransaction) -> None:
    prop.purchase_date = transaction.closing_date or prop.purchase_date
    prop.purchase_price = transaction.purchase_price or prop.purchase_price
    prop.down_payment = transaction.down_payment or prop.down_payment
    prop.cash_to_close = transaction.cash_to_close or prop.cash_to_close
    prop.deposit_paid_before_closing = transaction.deposit_paid_before_closing or prop.deposit_paid_before_closing
    prop.total_due_from_borrower = transaction.total_due_from_borrower or prop.total_due_from_borrower
    prop.total_paid_on_behalf_of_borrower = transaction.total_paid_on_behalf_of_borrower or prop.total_paid_on_behalf_of_borrower
    prop.settlement_debit_total = transaction.settlement_debit_total or prop.settlement_debit_total
    prop.settlement_credit_total = transaction.settlement_credit_total or prop.settlement_credit_total
    settlement_accounting_total = (
        transaction.settlement_debit_total
        if transaction.settlement_debit_total is not None
        else transaction.settlement_credit_total
    )
    if settlement_accounting_total is not None:
        prop.settlement_total_amount = settlement_accounting_total
    acquisition_values = apply_default_settlement_total({
        "purchase_price": prop.purchase_price,
        "settlement_total_amount": prop.settlement_total_amount,
        "closing_costs": transaction.borrower_paid_closing_costs or prop.closing_costs,
    })
    prop.closing_costs = acquisition_values.get("closing_costs") or transaction.borrower_paid_closing_costs or prop.closing_costs
    prop.seller_credits = transaction.seller_credits or prop.seller_credits
    prop.tax_prorations = transaction.tax_prorations or prop.tax_prorations
    prop.hoa_prorations = transaction.hoa_prorations or prop.hoa_prorations


def _acquisition_source_rank(transaction: models.PropertyTransaction) -> int:
    document_types = {link.document.document_type for link in transaction.document_links if link.document is not None}
    if "CLOSING_DISCLOSURE" in document_types:
        return 1
    if "SETTLEMENT_STATEMENT" in document_types:
        return 2
    if "RECORDED_PURCHASE_EVIDENCE" in document_types:
        return 3
    if transaction.status == "USER_CONFIRMED":
        return 4
    return 5


def select_acquisition_transaction(prop: models.Property) -> Optional[models.PropertyTransaction]:
    purchases = [transaction for transaction in prop.transactions if transaction.purpose == "PURCHASE"]
    if not purchases:
        return None
    verified = [transaction for transaction in purchases if _acquisition_source_rank(transaction) <= 4]
    candidates = verified or purchases
    return sorted(candidates, key=lambda transaction: (
        _date_value(transaction.closing_date),
        _acquisition_source_rank(transaction),
        transaction.id,
    ))[0]


def _selected_acquisition_document(transaction: models.PropertyTransaction) -> Optional[models.Document]:
    linked = [link for link in transaction.document_links if link.document is not None]
    ranked = sorted(linked, key=lambda link: (
        {
            "CLOSING_DISCLOSURE": 1,
            "SETTLEMENT_STATEMENT": 2,
            "RECORDED_PURCHASE_EVIDENCE": 3,
        }.get(link.document.document_type, 9),
        link.source_priority or 99,
        link.document.id,
    ))
    return ranked[0].document if ranked else None


def resolve_property_lifecycle(db, prop: models.Property) -> Dict[str, Any]:
    classified = [
        (document, classify_document(document))
        for document in prop.documents
        if SETUP_DELINKED_TAG not in {
            tag.strip() for tag in (document.module_tags or "").split(",") if tag.strip()
        }
    ]
    transaction_groups = _group_transaction_documents(classified)

    resolved_transactions = []
    docs_by_transaction_id: Dict[str, List[Tuple[models.Document, Dict[str, Any]]]] = {}
    for resolution_key, purpose, docs in transaction_groups:
        transaction = _upsert_transaction(db, prop, purpose, docs, resolution_key)
        resolved_transactions.append(transaction)
        docs_by_transaction_id[transaction.id] = docs
    active_transaction_ids = {transaction.id for transaction in resolved_transactions}
    for transaction in list(prop.transactions):
        if transaction.id not in active_transaction_ids and transaction.status != "USER_CONFIRMED":
            db.delete(transaction)
    db.flush()
    db.expire(prop, ["transactions"])

    acquisition = select_acquisition_transaction(prop)
    if acquisition:
        _apply_acquisition(prop, acquisition)

    transaction_docs = docs_by_transaction_id
    resolved_loans: List[models.Loan] = []
    transaction_loan: Dict[str, models.Loan] = {}
    for transaction in sorted(resolved_transactions, key=lambda t: _date_value(t.closing_date)):
        if transaction.purpose not in {"PURCHASE", "REFINANCE"}:
            continue
        docs = transaction_docs.get(transaction.id) or []
        if not docs:
            continue
        origin_document, origin_data = _origination_doc(docs)
        resolution = resolve_canonical_loan(
            db,
            prop,
            origin_data,
            category=origin_document.doc_category,
            document=origin_document,
        )
        loan = resolution.loan
        if loan is None:
            continue
        link_transaction_loan(
            db,
            transaction,
            loan,
            role="REFINANCE_DEBT" if transaction.purpose == "REFINANCE" else "ORIGINATED_DEBT",
            lien_position=1,
        )
        evidence = []
        for document, data in classified:
            if document in [item[0] for item in docs]:
                continue
            account_match = _accounts_match(_loan_doc_account(data, document), loan.account_number or origin_data.get("account_number") or origin_data.get("loan_id"))
            amount_match = _amount_close(data.get("original_amount"), origin_data.get("original_amount"), 2.0)
            rate_match = _amount_close(data.get("interest_rate"), origin_data.get("interest_rate"), 0.01)
            if document.doc_category in PERIODIC_CATEGORIES and (account_match or (amount_match and rate_match)):
                evidence.append((document, data))
        sources = _loan_field_sources(docs, evidence)
        loan.lender_name = origin_data.get("lender_name") or loan.lender_name
        loan.lender_at_origination = origin_data.get("lender_name") or loan.lender_at_origination or loan.lender_name
        loan.current_servicer = (max(evidence, key=lambda item: _latest_date_value(item[1].get("statement_date")))[1].get("lender_name") if evidence else None) or loan.current_servicer or loan.lender_name
        account_value = _loan_doc_account_value(origin_data, origin_document)
        if transaction.purpose == "REFINANCE":
            statement_account = next((
                _loan_doc_account_value(data, document)
                for document, data in evidence
                if document.document_type == "MORTGAGE_STATEMENT" and _loan_doc_account(data, document)
            ), "")
            account_value = statement_account or account_value
        loan.account_number = account_value or loan.account_number
        loan.purpose = transaction.purpose
        loan.status = "OPEN"
        loan.closed_date = None
        loan.closure_reason = None
        loan.original_amount = _number((sources.get("originalAmount") or (origin_data.get("original_amount"),))[0]) or loan.original_amount
        loan.current_balance = loan.original_amount
        loan.interest_rate = _number((sources.get("interestRate") or (origin_data.get("interest_rate"),))[0]) or loan.interest_rate
        loan.monthly_payment = _number((sources.get("monthlyPrincipalAndInterest") or (origin_data.get("monthly_payment"),))[0]) or loan.monthly_payment
        loan.loan_term_years = int((_number((sources.get("loanTermMonths") or (loan.loan_term_years * 12,))[0]) or 360) / 12)
        loan.origination_date = (
            transaction.disbursement_date
            if transaction.purpose == "PURCHASE" and transaction.disbursement_date
            else _iso((sources.get("originationDate") or (transaction.closing_date,))[0])
        )
        loan.disbursement_date = _iso((sources.get("disbursementDate") or (transaction.disbursement_date,))[0])
        loan.servicer_start_date = loan.disbursement_date or loan.origination_date
        loan.source_document_id = origin_document.id
        loan.source_type = "resolved_transaction"
        loan.import_status = "resolved"
        loan.resolution_confidence = transaction.confidence
        if sources.get("currentBalance"):
            loan.current_balance = _number(sources["currentBalance"][0]) or loan.current_balance
            loan.balance_as_of = _iso(sources["balanceAsOf"][0]) if sources.get("balanceAsOf") else None
            loan.current_balance_as_of = loan.balance_as_of
            loan.current_balance_source = "mortgage_statement_reported_balance"
            loan.current_balance_verified = True
            loan.statement_date = loan.balance_as_of
            if sources.get("currentPayment"):
                loan.monthly_payment = _number(sources["currentPayment"][0]) or loan.monthly_payment
        _link_loan_documents(db, loan, sources, docs + evidence)
        _upsert_snapshots(db, loan, evidence)
        resolved_loans.append(loan)
        transaction_loan[transaction.id] = loan

    ordered_transactions = sorted((t for t in resolved_transactions if t.id in transaction_loan), key=lambda t: _date_value(t.disbursement_date or t.closing_date))
    for sequence, transaction in enumerate(ordered_transactions, start=1):
        loan = transaction_loan[transaction.id]
        # Purchase and refinance transactions are separate obligations. A
        # servicing transfer is represented by segments on one canonical loan,
        # never by grouping distinct transaction loans together.
        loan.loan_group_id = None
        loan.servicer_sequence = 1
        loan.is_current_servicer = str(loan.status or "OPEN").upper() not in {"CLOSED", "REFINANCED", "PAID_OFF"}
        if sequence > 1 and transaction.purpose == "REFINANCE":
            prior = transaction_loan[ordered_transactions[sequence - 2].id]
            payoff_doc = next((
                (doc, data) for doc, data in transaction_docs.get(transaction.id, [])
                if data.get("prior_loan_payoff_amount") is not None
                and _lenders_match(data.get("prior_loan_payoff_lender"), prior.lender_name)
            ), None)
            payoff_date = _iso(payoff_doc[1].get("payoff_date")) if payoff_doc else None
            close_date = payoff_date or transaction.disbursement_date or transaction.closing_date
            prior.status = "CLOSED"
            prior.closed_date = close_date
            prior.servicer_end_date = close_date
            prior.closure_reason = "Refinanced"
            prior.transfer_reason = "Refinanced"
            prior.is_current_servicer = False
            prior.refinanced_into_loan_id = loan.id
            prior.replacement_loan_id = loan.id
            loan.refinanced_from_loan_id = prior.id
            if payoff_doc:
                payoff_document, payoff_data = payoff_doc
                prior.current_balance = _number(payoff_data.get("prior_loan_payoff_amount")) or prior.current_balance
                prior.balance_as_of = close_date
                prior.current_balance_as_of = close_date
                prior.current_balance_source = "refinance_settlement_payoff"
                existing_link = next((link for link in prior.document_links if link.document_id == payoff_document.id), None)
                if existing_link is None:
                    db.add(models.LoanDocumentLink(
                        id=str(uuid.uuid4()), loan_id=prior.id, document_id=payoff_document.id,
                        source_role="PAYOFF_SOURCE",
                        fields_used=json.dumps(["currentBalance", "balanceAsOf", "closedDate"]),
                        priority=1, confidence=0.99,
                    ))
                refinance_link = db.query(models.LoanDocumentLink).filter(
                    models.LoanDocumentLink.loan_id == loan.id,
                    models.LoanDocumentLink.document_id == payoff_document.id,
                ).one_or_none()
                if refinance_link is not None:
                    refinance_fields = set(json.loads(refinance_link.fields_used or "[]"))
                    refinance_fields.update({"priorLoanPayoffBalance", "priorLoanPayoffLender", "priorLoanPayoffDate"})
                    refinance_link.fields_used = json.dumps(sorted(refinance_fields))

    canonical_ids = {loan.id for loan in resolved_loans}
    for duplicate in list(prop.loans):
        if duplicate.id in canonical_ids:
            continue
        canonical = next((
            loan for loan in resolved_loans
            if _accounts_match(duplicate.account_number, loan.account_number)
            or (_amount_close(duplicate.original_amount, loan.original_amount, 2.0) and _lenders_match(duplicate.lender_name, loan.lender_name))
            or (
                (duplicate.original_amount or 0) <= 0
                and _lenders_match(duplicate.lender_name, loan.lender_name)
                and duplicate.status in {"CLOSED", "REFINANCED"}
            )
        ), None)
        if canonical:
            _merge_duplicate(db, prop, duplicate, canonical)

    db.flush()
    for transaction in resolved_transactions:
        db.expire(transaction, ["document_links"])
    for loan in resolved_loans:
        db.expire(loan, ["document_links", "balance_snapshots"])
    db.expire(prop, ["transactions", "loans"])
    return lifecycle_dto(prop)


def _document_dto(document: models.Document) -> Dict[str, Any]:
    data = _data(document)
    return {
        "documentId": document.id,
        "name": document.display_name or document.original_filename,
        "originalFilename": document.original_filename,
        "documentType": document.document_type or "OTHER",
        "purpose": document.transaction_purpose or "UNKNOWN",
        "role": document.transaction_role or "SUPPORTING_SOURCE",
        "statementDate": _iso(data.get("statement_date") or data.get("settlement_date") or data.get("closing_date")),
        "openUrl": f"/properties/{document.property_id}/documents",
    }


def _transaction_selected_field(transaction: models.PropertyTransaction, field: str, label: str) -> Optional[Dict[str, Any]]:
    value = getattr(transaction, field, None)
    if value is None:
        return None
    link = next((link for link in transaction.document_links if field in json.loads(link.fields_used or "[]")), None)
    document = link.document if link else None
    page = _source_page(document.document_type, field) if document else None
    selection_type = "EXACT" if document else "BACKEND_EXISTING"
    if document and field == "disbursement_date" and not _data(document).get("disbursement_date"):
        selection_type = "INFERRED"
    return {
        "fieldName": label,
        "field": field,
        "key": field,
        "value": value,
        "display": _currency_exact(value) if isinstance(value, (int, float)) else str(value),
        "sourceDocumentId": document.id if document else None,
        "documentId": document.id if document else None,
        "sourceDocument": document.display_name or document.original_filename if document else None,
        "sourceLabel": (document.document_type or "Document").replace("_", " ").title() if document else "Resolved transaction",
        "page": page,
        "pageNumber": page,
        "confidence": link.match_confidence if link else transaction.confidence,
        "resolution": selection_type,
        "selectionType": selection_type,
        "sourceType": "REPORTED" if document else "BACKEND_EXISTING",
    }


def _settlement_accounting_total_field(transaction: models.PropertyTransaction) -> Optional[Dict[str, Any]]:
    source_field = (
        "settlement_debit_total"
        if transaction.settlement_debit_total is not None
        else "settlement_credit_total"
    )
    selected = _transaction_selected_field(transaction, source_field, "Settlement accounting total")
    if not selected:
        return None
    return {
        **selected,
        "fieldName": "Settlement accounting total",
        "field": "settlement_accounting_total",
        "key": "settlement_accounting_total",
        "sourceField": source_field,
    }


def acquisition_dto(prop: models.Property) -> Optional[Dict[str, Any]]:
    transaction = select_acquisition_transaction(prop)
    if not transaction:
        return None
    selected_document = _selected_acquisition_document(transaction)
    fields = {
        dto_key: _transaction_selected_field(transaction, model_key, label)
        for dto_key, model_key, label in (
            ("purchasePrice", "purchase_price", "Purchase price"),
            ("borrowerPaidClosingCosts", "borrower_paid_closing_costs", "Borrower-paid closing costs"),
            ("downPayment", "down_payment", "Down payment"),
            ("cashToClose", "cash_to_close", "Cash to close"),
            ("depositPaidBeforeClosing", "deposit_paid_before_closing", "Deposit paid before closing"),
            ("totalDueFromBorrower", "total_due_from_borrower", "Total due from borrower"),
            ("totalPaidOnBehalfOfBorrower", "total_paid_on_behalf_of_borrower", "Total paid already/on behalf of borrower"),
            ("settlementDebitTotal", "settlement_debit_total", "Settlement debit total"),
            ("settlementCreditTotal", "settlement_credit_total", "Settlement credit total"),
            ("sellerCredits", "seller_credits", "Seller credits"),
            ("taxProrations", "tax_prorations", "Tax prorations"),
            ("hoaProrations", "hoa_prorations", "HOA prorations"),
        )
    }
    closing_date_source = _transaction_selected_field(transaction, "closing_date", "Purchase date")
    disbursement_date_source = _transaction_selected_field(transaction, "disbursement_date", "Disbursement date")
    settlement_accounting_total = _settlement_accounting_total_field(transaction)
    cost_breakdown = settlement_cost_breakdown(
        transaction.purchase_price,
        settlement_accounting_total.get("value") if settlement_accounting_total else None,
        transaction.borrower_paid_closing_costs,
    )
    selected_fields = [
        item for item in [closing_date_source, disbursement_date_source, *fields.values(), settlement_accounting_total]
        if item is not None
    ]
    return {
        "transactionId": transaction.id,
        "transactionType": "PURCHASE",
        "selectedDocumentId": selected_document.id if selected_document else None,
        "selectionType": "VERIFIED_PURCHASE" if _acquisition_source_rank(transaction) <= 4 else "ESTIMATED_FALLBACK",
        "closingDate": transaction.closing_date,
        "disbursementDate": transaction.disbursement_date,
        "closingDateSource": closing_date_source,
        "disbursementDateSource": disbursement_date_source,
        "settlementAccountingTotal": settlement_accounting_total,
        "closingAndTitleCosts": ({
            "value": cost_breakdown["combined"],
            "display": _currency_exact(cost_breakdown["combined"]),
            "closingCosts": {
                "value": cost_breakdown["closingCosts"],
                "display": _currency_exact(cost_breakdown["closingCosts"]),
            },
            "titleCosts": {
                "value": cost_breakdown["titleCosts"],
                "display": _currency_exact(cost_breakdown["titleCosts"]),
            },
            "sourceType": "CALCULATED",
            "explanation": "Settlement accounting total minus purchase price. The reported closing-cost amount is shown separately; the remainder is title costs.",
        } if cost_breakdown else None),
        "selectedFields": selected_fields,
        **{key: value for key, value in fields.items() if value is not None},
        "documents": [_document_dto(link.document) for link in transaction.document_links],
        "confidence": transaction.confidence,
    }


def _loan_selected_fields(loan: models.Loan) -> List[Dict[str, Any]]:
    field_aliases = {
        "original_amount": "originalAmount",
        "interest_rate": "interestRate",
        "loan_term_years": "loanTermMonths",
        "monthly_payment": "monthlyPrincipalAndInterest",
        "origination_date": "originationDate",
        "disbursement_date": "disbursementDate",
        "current_balance": "currentBalance",
        "finalBalance": "currentBalance",
        "box2Balance": "currentBalance",
        "box2_balance": "currentBalance",
        "balance_as_of": "balanceAsOf",
        "statement_date": "balanceAsOf",
        "monthly_property_tax_escrow": "monthlyPropertyTaxEscrow",
        "monthly_insurance_escrow": "monthlyInsuranceEscrow",
        "monthly_mortgage_insurance": "monthlyMortgageInsurance",
        "monthly_other_escrow": "monthlyOtherEscrow",
        "escrow_amount": "monthlyEscrowTotal",
        "estimated_total_monthly_payment": "estimatedTotalMonthlyPayment",
        "mortgageInterest": "mortgageInterest",
        "interestPaidYtd": "interestPaidYtd",
        "principalPaidYtd": "principalPaidYtd",
    }
    field_values = {
        "originalAmount": (loan.original_amount, "Loan amount"),
        "interestRate": (loan.interest_rate, "Interest rate"),
        "loanTermMonths": (loan.loan_term_years * 12 if loan.loan_term_years else None, "Term"),
        "monthlyPrincipalAndInterest": (loan.monthly_payment, "Monthly principal and interest"),
        "originationDate": (loan.origination_date, "Origination date"),
        "disbursementDate": (loan.disbursement_date, "Disbursement date"),
        "currentBalance": (loan.current_balance, "Current / final balance"),
        "balanceAsOf": (loan.balance_as_of or loan.current_balance_as_of, "Balance as of"),
        "closedDate": (loan.closed_date, "Closed date"),
        "monthlyPropertyTaxEscrow": (loan.monthly_property_tax_escrow, "Monthly property tax escrow"),
        "monthlyInsuranceEscrow": (loan.monthly_insurance_escrow, "Monthly insurance escrow"),
        "monthlyMortgageInsurance": (loan.monthly_mortgage_insurance, "Monthly mortgage insurance"),
        "monthlyOtherEscrow": (loan.monthly_other_escrow, "Other monthly escrow"),
        "monthlyEscrowTotal": (loan.escrow_amount, "Total monthly escrow"),
        "estimatedTotalMonthlyPayment": (loan.estimated_total_monthly_payment, "Estimated total monthly payment"),
    }
    candidates: Dict[str, List[models.LoanDocumentLink]] = {}
    for link in loan.document_links:
        if link.document is None:  # source document was deleted; skip stale link
            continue
        used = json.loads(link.fields_used or "[]")
        if loan.purpose == "REFINANCE" and _data(link.document).get("prior_loan_payoff_amount") is not None:
            used = list(dict.fromkeys([
                *used,
                "priorLoanPayoffBalance",
                "priorLoanPayoffLender",
                "priorLoanPayoffDate",
            ]))
        for field in used:
            normalized = field_aliases.get(field, field)
            candidates.setdefault(normalized, []).append(link)

    result = []
    type_priority = {
        "CLOSING_DISCLOSURE": 1,
        "PAYOFF_STATEMENT": 1,
        "SETTLEMENT_STATEMENT": 2,
        "LOAN_ESTIMATE": 3,
        "MORTGAGE_STATEMENT": 4,
        "FORM_1098": 5,
    }
    for field, links in candidates.items():
        def source_rank(link: models.LoanDocumentLink) -> tuple:
            document_type = link.document.document_type or "OTHER"
            is_selected_balance_source = (
                field in {"currentBalance", "balanceAsOf"}
                and link.document.id == loan.source_document_id
            )
            latest = _latest_date_value(
                _data(link.document).get("statement_date")
                or _data(link.document).get("disbursement_date")
                or _data(link.document).get("closing_date")
            ).toordinal()
            return (
                0 if is_selected_balance_source else 1,
                type_priority.get(document_type, 9),
                -latest if field in {"currentBalance", "balanceAsOf"} else link.document.id,
                link.document.id,
            )

        link = sorted(links, key=source_rank)[0]
        document_data = _data(link.document)
        document_fields = {
            "priorLoanPayoffBalance": (document_data.get("prior_loan_payoff_amount"), "Prior loan payoff"),
            "priorLoanPayoffLender": (document_data.get("prior_loan_payoff_lender"), "Prior lender"),
            "priorLoanPayoffDate": (
                document_data.get("payoff_date") or document_data.get("disbursement_date") or document_data.get("closing_date"),
                "Prior loan payoff date",
            ),
            "mortgageInterest": (document_data.get("mortgage_interest") or document_data.get("box1_interest"), "Mortgage interest"),
            "interestPaidYtd": (document_data.get("interest_paid_ytd"), "Interest paid YTD"),
            "principalPaidYtd": (document_data.get("principal_paid_ytd"), "Principal paid YTD"),
        }
        value, label = field_values.get(field, document_fields.get(field, (None, field)))
        if value is None:
            continue
        selection_type = "EXACT"
        if field in {"closedDate", "priorLoanPayoffDate"} and not document_data.get("payoff_date"):
            selection_type = "INFERRED"
        page = _source_page(link.document.document_type, field)
        result.append({
            "fieldName": label,
            "field": field,
            "key": field,
            "value": value,
            "display": _currency_exact(value) if isinstance(value, (int, float)) and field not in {"interestRate", "loanTermMonths"} else str(value),
            "sourceDocumentId": link.document.id,
            "documentId": link.document.id,
            "sourceDocument": link.document.display_name or link.document.original_filename,
            "sourceLabel": (link.document.document_type or "Document").replace("_", " ").title(),
            "page": page,
            "pageNumber": page,
            "confidence": link.confidence,
            "resolution": selection_type,
            "selectionType": selection_type,
            "sourceType": "REPORTED",
        })

    selected_keys = {item["key"] for item in result}
    for field, (value, label) in field_values.items():
        if field in selected_keys or value is None:
            continue
        is_calculated = field in {"currentBalance", "balanceAsOf"} and "calculat" in str(loan.current_balance_source or "").lower()
        selection_type = "CALCULATED" if is_calculated else "BACKEND_EXISTING"
        result.append({
            "fieldName": label,
            "field": field,
            "key": field,
            "value": value,
            "display": _currency_exact(value) if isinstance(value, (int, float)) and field not in {"interestRate", "loanTermMonths"} else str(value),
            "sourceDocumentId": None,
            "documentId": None,
            "sourceDocument": None,
            "sourceLabel": "Backend loan engine" if is_calculated else "Backend existing record",
            "page": None,
            "pageNumber": None,
            "confidence": loan.resolution_confidence or 1.0,
            "resolution": selection_type,
            "selectionType": selection_type,
            "sourceType": "CALCULATED" if is_calculated else "BACKEND_EXISTING",
        })
    order = {field: index for index, field in enumerate(field_values)}
    order.update({"priorLoanPayoffBalance": 90, "priorLoanPayoffLender": 91, "priorLoanPayoffDate": 92})
    return sorted(result, key=lambda item: (order.get(item["key"], 80), item["key"]))


def _loan_source_details(loan: models.Loan, selected_fields: List[Dict[str, Any]], documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    used_fields = [field for field in selected_fields if field.get("documentId") is not None]
    section_definitions = [
        ("origination", "Origination", {
            "originalAmount", "interestRate", "loanTermMonths", "monthlyPrincipalAndInterest",
            "originationDate", "disbursementDate",
        }),
        ("prior_payoff", "Prior-loan payoff", {
            "priorLoanPayoffBalance", "priorLoanPayoffLender", "priorLoanPayoffDate",
        }),
        ("current_status", "Current status", {
            "currentBalance", "balanceAsOf", "closedDate", "mortgageInterest",
            "interestPaidYtd", "principalPaidYtd",
        }),
        ("payment_escrow", "Payment and escrow", {
            "monthlyPropertyTaxEscrow", "monthlyInsuranceEscrow", "monthlyMortgageInsurance",
            "monthlyOtherEscrow", "monthlyEscrowTotal", "estimatedTotalMonthlyPayment",
        }),
    ]
    assigned = set()
    sections = []
    for key, label, field_keys in section_definitions:
        fields = [field for field in used_fields if field.get("key") in field_keys]
        if fields:
            sections.append({"key": key, "label": label, "fields": fields})
            assigned.update(field.get("key") for field in fields)
    remaining = [field for field in used_fields if field.get("key") not in assigned]
    if remaining:
        sections.append({"key": "other", "label": "Other accepted fields", "fields": remaining})

    return {
        "title": f"{loan.lender_at_origination or loan.lender_name or 'Loan'} {str(loan.purpose or '').lower()} loan".strip(),
        "description": "Only fields used by backend loan resolution are shown.",
        "sections": sections,
        "documents": documents,
    }


def resolved_loan_dto(loan: models.Loan) -> Dict[str, Any]:
    documents = [
        _document_dto(link.document)
        for link in loan.document_links
        # A link may point at an already-deleted document (source removed after
        # the loan was populated). Skip those — the loan keeps its saved values.
        if link.document is not None
        and (
            json.loads(link.fields_used or "[]")
            or link.document.document_type in {"CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT"}
            or (
                link.document.document_type == "MORTGAGE_STATEMENT"
                and _document_dto(link.document).get("statementDate")
            )
        )
    ]
    latest_statement = next((
        doc for doc in sorted(documents, key=lambda item: _latest_date_value(item.get("statementDate")), reverse=True)
        if doc["documentType"] == "MORTGAGE_STATEMENT"
    ), None)
    summary_documents = [
        document for document in documents
        if document.get("purpose") == (loan.purpose or "UNKNOWN")
        or document.get("documentType") == "MORTGAGE_STATEMENT"
    ]
    source_count = len(summary_documents)
    source_types = {document.get("documentType") for document in summary_documents}
    if source_count == 0:
        source_label = "Manual"
    elif {"CLOSING_DISCLOSURE", "SETTLEMENT_STATEMENT"} <= source_types:
        source_label = "Refinance package" if loan.purpose == "REFINANCE" else "Closing + Settlement"
    else:
        source_label = f"{source_count} document{'s' if source_count != 1 else ''}"
    if latest_statement:
        statement_date = _date_value(latest_statement.get("statementDate"))
        source_label = f"Latest statement · {statement_date.strftime('%b %Y') if statement_date != date.max else 'Current'}"
    account = _account(loan.account_number)
    selected_fields = _loan_selected_fields(loan)
    return {
        "loanId": loan.id,
        "propertyId": loan.property_id,
        "lender": loan.lender_at_origination or loan.lender_name,
        "currentServicer": loan.current_servicer or loan.lender_name,
        "loanNumber": loan.account_number,
        "maskedLoanNumber": f"••••{account[-4:]}" if account else None,
        "purpose": loan.purpose or "UNKNOWN",
        "status": "CLOSED" if str(loan.status or "").upper() == "REFINANCED" else loan.status,
        "originationDate": loan.origination_date,
        "disbursementDate": loan.disbursement_date,
        "closedDate": loan.closed_date,
        "closureReason": loan.closure_reason,
        "originalAmount": loan.original_amount,
        "currentBalance": loan.current_balance,
        "balanceAsOf": loan.balance_as_of or loan.current_balance_as_of,
        "currentBalanceSource": loan.current_balance_source,
        "hasReportedCurrentBalance": bool(
            (loan.balance_as_of or loan.current_balance_as_of)
            and str(loan.current_balance_source or "").lower() not in {
                "loan_disclosure_initial_balance", "resolved_transaction"
            }
        ),
        "interestRate": loan.interest_rate,
        "monthlyPrincipalAndInterest": loan.monthly_payment,
        "refinancedIntoLoanId": loan.refinanced_into_loan_id,
        "refinancedFromLoanId": loan.refinanced_from_loan_id,
        "sourceSummary": {"label": source_label, "documentCount": source_count},
        "selectedFields": selected_fields,
        "sourceDetails": _loan_source_details(loan, selected_fields, documents),
        "documents": documents,
        "confidence": loan.resolution_confidence,
    }


def lifecycle_dto(prop: models.Property) -> Dict[str, Any]:
    transactions = sorted(prop.transactions, key=lambda transaction: _date_value(transaction.closing_date))
    selected_acquisition = select_acquisition_transaction(prop)
    resolved_loans = sorted(
        [
            loan for loan in prop.loans
            if loan.import_status == "resolved"
            or (loan.original_amount or 0) > 0
            or bool(loan.account_number)
        ],
        key=lambda loan: _date_value(loan.disbursement_date or loan.origination_date),
    )
    groups = []
    for transaction in transactions:
        if not transaction.document_links:
            continue
        is_selected_acquisition = bool(selected_acquisition and transaction.id == selected_acquisition.id)
        groups.append({
            "transactionId": transaction.id,
            "title": (
                f"Original purchase · {_date_value(transaction.closing_date).strftime('%b %Y')}"
                if transaction.purpose == "PURCHASE"
                else f"Refinance · {_date_value(transaction.closing_date).strftime('%b %Y')}"
            ),
            "purpose": transaction.purpose,
            "usageLabel": "Selected for Property Setup" if is_selected_acquisition else "Used in Loans" if transaction.purpose == "REFINANCE" else "Purchase history",
            "selectedForPropertySetup": is_selected_acquisition,
            "documents": [_document_dto(link.document) for link in transaction.document_links],
        })
    periodic_documents = []
    linked_ids = {doc["documentId"] for loan in resolved_loans for doc in resolved_loan_dto(loan)["documents"]}
    for document in prop.documents:
        if document.id in linked_ids and document.document_type in {"MORTGAGE_STATEMENT", "FORM_1098"}:
            periodic_documents.append(_document_dto(document))
    if periodic_documents:
        groups.append({
            "transactionId": None, "title": "Current loan evidence",
            "purpose": "PERIODIC_STATEMENT", "usageLabel": "Used to update current balance",
            "documents": sorted(periodic_documents, key=lambda item: _date_value(item.get("statementDate"))),
        })
    return {
        "schemaVersion": "property-loan-lifecycle-v1",
        "propertyId": prop.id,
        "acquisition": acquisition_dto(prop),
        "documentGroups": groups,
        "loans": [resolved_loan_dto(loan) for loan in resolved_loans],
    }
