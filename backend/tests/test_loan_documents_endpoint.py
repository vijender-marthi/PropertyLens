from datetime import datetime, timedelta
import json

from jose import jwt

import models


SECRET_KEY = "propertylens-secret-key-change-in-production"
ALGORITHM = "HS256"


def auth_headers(email: str) -> dict:
    payload = {"sub": email, "exp": datetime.utcnow() + timedelta(hours=1)}
    return {"Authorization": f"Bearer {jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)}"}


def test_edit_loan_documents_returns_backend_matched_statement_details(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="linked-loan-statements",
        name="Linked Statements",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    loan = models.Loan(
        property_id=prop.id,
        lender_name="Rocket",
        loan_type="FIXED",
        status="OPEN",
        original_amount=463428.32,
        current_balance=438502,
        interest_rate=7.625,
        monthly_payment=3280,
        loan_term_years=30,
        origination_date="2023-05-24",
        account_number="3550379001",
    )
    db.add(loan)
    db.flush()
    statement = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="rocket-june-2026.pdf",
        original_filename="Rocket June 2026.pdf",
        display_name="Mortgage Statement — June 2026 (****9001)",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        loan_account_number="3550379001",
        statement_year=2026,
        extracted_data=json.dumps({
            "account_number": "3550379001",
            "statement_date": "06/16/2026",
            "current_balance": 438502,
            "principal_paid_ytd": 20219.73,
            "interest_paid_ytd": 20130.22,
            "escrow_amount": 951.25,
        }),
    )
    db.add(statement)
    db.commit()

    response = client.get(
        f"/api/properties/{prop.id}/loans/{loan.id}/documents",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    linked = payload["documents"][0]
    assert linked["documentId"] == statement.id
    assert linked["accountNumber"] == "3550379001"
    assert linked["endBalance"] == 438502
    assert linked["ytdPrincipal"] == 20219.73
    assert linked["ytdInterest"] == 20130.22
    assert linked["monthlyEscrow"] == 951.25


def test_edit_loan_documents_excludes_other_account(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="linked-loan-account-filter",
        name="Account Filter",
        address="1 Main St",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    loan = models.Loan(
        property_id=prop.id,
        lender_name="First Lender",
        loan_type="FIXED",
        status="OPEN",
        original_amount=300000,
        current_balance=290000,
        interest_rate=5,
        monthly_payment=1600,
        loan_term_years=30,
        account_number="11112222",
    )
    other_loan = models.Loan(
        property_id=prop.id,
        lender_name="Second Lender",
        loan_type="FIXED",
        status="OPEN",
        original_amount=100000,
        current_balance=95000,
        interest_rate=6,
        monthly_payment=700,
        loan_term_years=30,
        account_number="99998888",
    )
    db.add_all([loan, other_loan])
    db.flush()
    db.add(models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="other.pdf",
        original_filename="Other loan.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        loan_account_number="99998888",
        statement_year=2026,
        extracted_data=json.dumps({"account_number": "99998888", "statement_date": "06/01/2026", "current_balance": 95000}),
    ))
    db.commit()

    response = client.get(
        f"/api/properties/{prop.id}/loans/{loan.id}/documents",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    assert response.json()["documents"] == []
