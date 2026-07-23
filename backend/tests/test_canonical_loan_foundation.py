import json

import models
from routers.documents import _apply_extracted
from services.canonical_loan import (
    apply_periodic_loan_evidence,
    link_transaction_loan,
    resolve_canonical_loan,
)


def _document(db, prop, user, category, data, filename="source.pdf"):
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename=filename,
        original_filename=filename,
        display_name=filename,
        file_type="pdf",
        doc_category=category,
        extracted_data=json.dumps(data),
        loan_account_number=data.get("account_number"),
    )
    db.add(document)
    db.flush()
    return document


def test_new_servicer_account_is_a_segment_of_selected_canonical_loan(db, user, prop):
    loan = prop.loans[0]
    loan.lender_name = "DHI Mortgage"
    loan.current_servicer = "DHI Mortgage"
    loan.account_number = "0064944077"
    loan.origination_date = "2023-05-24"
    document = _document(db, prop, user, "mortgage_statement", {
        "transaction_purpose": "PERIODIC_STATEMENT",
        "lender_name": "Rocket Mortgage",
        "account_number": "3550379001",
        "statement_date": "2024-10-15",
        "servicer_start_date": "2024-10-01",
        "current_balance": 461922,
        "interest_rate": 6.5,
    })

    result = resolve_canonical_loan(
        db, prop, json.loads(document.extracted_data), category=document.doc_category,
        document=document, selected_loan_id=loan.id,
    )
    db.flush()

    assert result.action == "SERVICER_TRANSFER"
    assert result.loan.id == loan.id
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 1
    segments = db.query(models.LoanServicerSegment).filter_by(loan_id=loan.id).order_by(
        models.LoanServicerSegment.from_date
    ).all()
    assert [(segment.servicer, segment.account_number) for segment in segments] == [
        ("DHI Mortgage", "0064944077"),
        ("Rocket Mortgage", "3550379001"),
    ]
    assert segments[0].is_current is False
    assert segments[0].to_date == "2024-09-30"
    assert segments[1].is_current is True


def test_reapplying_same_document_is_idempotent(db, user, prop):
    loan = prop.loans[0]
    loan.account_number = "11110000"
    document = _document(db, prop, user, "mortgage_statement", {
        "account_number": "11110000",
        "statement_date": "2026-06-30",
        "current_balance": 295000,
    })
    data = json.loads(document.extracted_data)

    first = resolve_canonical_loan(db, prop, data, category=document.doc_category, document=document)
    db.flush()
    second = resolve_canonical_loan(db, prop, data, category=document.doc_category, document=document)
    db.flush()

    assert first.loan.id == second.loan.id == loan.id
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 1
    assert db.query(models.LoanDocumentLink).filter_by(
        loan_id=loan.id, document_id=document.id
    ).count() == 1
    assert db.query(models.LoanServicerSegment).filter_by(loan_id=loan.id).count() == 1


def test_non_loan_document_cannot_create_debt(db, user, prop):
    original_count = db.query(models.Loan).filter_by(property_id=prop.id).count()
    document = _document(db, prop, user, "escrow_analysis", {
        "loan_number": "ESCROW-ONLY-4077",
        "account_number": "ESCROW-ONLY-4077",
        "estimated_tax": 12000,
    })

    result = resolve_canonical_loan(
        db, prop, json.loads(document.extracted_data), category=document.doc_category,
        document=document,
    )
    db.flush()

    assert result.action == "UNRESOLVED"
    assert result.loan is None
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == original_count


def test_generic_document_apply_does_not_create_a_loan(db, prop):
    prop.loans.clear()
    db.flush()

    applied = _apply_extracted(db, prop, {
        "account_number": "NEW-STATEMENT-ACCOUNT",
        "statement_date": "2026-06-30",
        "current_balance": 295000,
        "monthly_payment": 1900,
    }, category="mortgage_statement")
    db.flush()

    assert not any(key.startswith("loan.") for key in applied)
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 0


def test_explicit_refinance_creates_distinct_canonical_debt(db, user, prop):
    purchase_loan = prop.loans[0]
    purchase_loan.account_number = "PURCHASE-1"
    document = _document(db, prop, user, "loan_disclosure", {
        "transaction_purpose": "REFINANCE",
        "lender_name": "Refinance Bank",
        "account_number": "REFI-2",
        "original_amount": 290000,
        "current_balance": 290000,
        "interest_rate": 5.25,
        "monthly_principal_and_interest": 1601.12,
        "loan_term_years": 30,
        "origination_date": "2025-02-01",
    })

    result = resolve_canonical_loan(
        db, prop, json.loads(document.extracted_data), category=document.doc_category,
        document=document, selected_loan_id=purchase_loan.id,
    )
    db.flush()

    assert result.action == "NEW_REFINANCE"
    assert result.loan.id != purchase_loan.id
    assert result.loan.purpose == "REFINANCE"
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 2


def test_transaction_to_loan_link_is_durable_and_idempotent(db, user, prop):
    transaction = models.PropertyTransaction(
        property_id=prop.id,
        owner_id=user.id,
        transaction_type="PURCHASE",
        purpose="PURCHASE",
        closing_date="2020-01-01",
    )
    db.add(transaction)
    db.flush()
    loan = prop.loans[0]

    first = link_transaction_loan(db, transaction, loan, lien_position=1)
    db.flush()
    second = link_transaction_loan(db, transaction, loan, lien_position=1)
    db.flush()

    assert first.id == second.id
    assert db.query(models.TransactionLoanLink).filter_by(
        transaction_id=transaction.id, loan_id=loan.id
    ).count() == 1


def test_periodic_snapshots_are_idempotent_and_latest_reported_balance_wins(db, user, prop):
    loan = prop.loans[0]
    loan.account_number = "CANONICAL-1001"
    older = _document(db, prop, user, "mortgage_statement", {
        "account_number": "CANONICAL-1001",
        "statement_date": "2025-12-31",
        "current_balance": 280000,
        "principal_paid_ytd": 8000,
        "interest_paid_ytd": 14000,
    }, filename="older.pdf")
    latest = _document(db, prop, user, "mortgage_statement", {
        "account_number": "CANONICAL-1001",
        "statement_date": "2026-06-30",
        "current_balance": 270000,
        "principal_paid_ytd": 5000,
        "interest_paid_ytd": 7000,
    }, filename="latest.pdf")

    for document in (latest, older, older):
        data = json.loads(document.extracted_data)
        resolution = resolve_canonical_loan(
            db, prop, data, category=document.doc_category, document=document,
            allow_create=False,
        )
        apply_periodic_loan_evidence(db, resolution.loan, document, data)
    db.flush()

    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 1
    assert db.query(models.LoanBalanceSnapshot).filter_by(loan_id=loan.id).count() == 2
    assert loan.current_balance == 270000
    assert loan.current_balance_as_of == "2026-06-30"
    assert loan.current_balance_source == "mortgage_statement_reported_balance"


def test_1098_wins_same_date_snapshot_tie_break(db, user, prop):
    loan = prop.loans[0]
    loan.account_number = "CANONICAL-1001"
    statement = _document(db, prop, user, "mortgage_statement", {
        "account_number": "CANONICAL-1001",
        "statement_date": "2026-01-01",
        "current_balance": 270000,
    }, filename="statement.pdf")
    form_1098 = _document(db, prop, user, "1098", {
        "account_number": "CANONICAL-1001",
        "tax_year": "2026",
        "box2_balance": 265000,
        "mortgage_interest": 12000,
    }, filename="1098.pdf")

    for document in (statement, form_1098):
        data = json.loads(document.extracted_data)
        resolution = resolve_canonical_loan(
            db, prop, data, category=document.doc_category, document=document,
            allow_create=False,
        )
        apply_periodic_loan_evidence(db, resolution.loan, document, data)
    db.flush()

    assert loan.current_balance == 265000
    assert loan.current_balance_as_of == "2026-01-01"
    assert loan.current_balance_source == "1098_box_2_reported_balance"
