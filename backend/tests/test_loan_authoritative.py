"""The Loans table is the single source of truth for a loan.

A loan keeps links to all of its documents (1098s, mortgage statements, closing
statements, ...), but its field values live on the loans row. Deleting a
document only removes that one link — it never deletes the loan or its values,
and the loan display never crashes on a link whose document is gone. A loan is
removed only when the user explicitly deletes it from the Loans tab.
"""
import json
import uuid

import models
from routers.documents import _delete_document_and_dependents
from tests.conftest import auth_headers


def _add_document(db, prop, category, filename):
    doc = models.Document(
        property_id=prop.id,
        owner_id=prop.owner_id,
        filename=f"{uuid.uuid4()}.pdf",
        original_filename=filename,
        doc_category=category,
        extracted_data=json.dumps({"account_number": "8210134813"}),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def _link(db, loan, doc, role, fields):
    link = models.LoanDocumentLink(
        id=str(uuid.uuid4()),
        loan_id=loan.id,
        document_id=doc.id,
        source_role=role,
        fields_used=json.dumps(fields),
        priority=1,
        confidence=0.99,
    )
    db.add(link)
    db.commit()
    return link


def test_loan_survives_deleting_one_of_its_documents(db, prop):
    loan = prop.loans[0]
    closing = _add_document(db, prop, "closing_statement", "Closing.pdf")
    stmt = _add_document(db, prop, "mortgage_statement", "Statement.pdf")
    f1098 = _add_document(db, prop, "1098", "1098-2024.pdf")
    _link(db, loan, closing, "ACQUISITION_SOURCE", ["originalAmount"])
    _link(db, loan, stmt, "CURRENT_BALANCE_SOURCE", ["currentBalance"])
    _link(db, loan, f1098, "SUPPORTING_SOURCE", ["mortgageInterest"])

    # The loan links to all three documents.
    assert db.query(models.LoanDocumentLink).filter_by(loan_id=loan.id).count() == 3

    # Delete the 1098 — only its link should go; the loan and its values stay.
    _delete_document_and_dependents(db, db.get(models.Document, f1098.id))
    db.commit()
    db.expire_all()

    kept = db.get(models.Loan, loan.id)
    assert kept is not None
    assert kept.original_amount == 320_000.0
    assert kept.current_balance == 300_000.0
    assert kept.interest_rate == 6.5
    remaining_docs = {
        lk.document_id for lk in db.query(models.LoanDocumentLink).filter_by(loan_id=loan.id)
    }
    assert remaining_docs == {closing.id, stmt.id}   # 1098 link removed, others kept


def test_loan_survives_deleting_all_its_documents(db, prop):
    loan = prop.loans[0]
    for cat, name in (("closing_statement", "Closing.pdf"),
                      ("mortgage_statement", "Statement.pdf"),
                      ("1098", "1098.pdf")):
        doc = _add_document(db, prop, cat, name)
        _link(db, loan, doc, "SUPPORTING_SOURCE", ["mortgageInterest"])

    for doc in list(prop.documents):
        _delete_document_and_dependents(db, doc)
    db.commit()
    db.expire_all()

    kept = db.get(models.Loan, loan.id)
    assert kept is not None
    assert kept.original_amount == 320_000.0
    assert kept.current_balance == 300_000.0
    assert db.query(models.LoanDocumentLink).filter_by(loan_id=loan.id).count() == 0


def test_debt_endpoint_tolerates_orphaned_document_link(client, db, prop, user):
    """A pre-existing link pointing at a deleted document must not crash the
    loan display (older data can carry these orphans)."""
    loan = prop.loans[0]
    db.add(models.LoanDocumentLink(
        id=str(uuid.uuid4()),
        loan_id=loan.id,
        document_id=999999,   # no such document
        source_role="SUPPORTING_SOURCE",
        fields_used=json.dumps(["mortgageInterest"]),
        priority=1,
        confidence=0.99,
    ))
    db.commit()

    res = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))
    assert res.status_code == 200
    loans = res.json().get("loans") or []
    assert any(
        (l.get("original_amount") or l.get("originalAmount")) == 320_000.0
        for l in loans
    )


def test_only_explicit_delete_removes_loan(client, db, prop, user):
    loan_id = prop.loans[0].id
    res = client.delete(
        f"/api/properties/{prop.id}/loans/{loan_id}",
        headers=auth_headers(user.email),
    )
    assert res.status_code == 200
    db.expire_all()
    assert db.get(models.Loan, loan_id) is None
