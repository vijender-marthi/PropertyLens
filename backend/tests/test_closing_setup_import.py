from types import SimpleNamespace
from datetime import datetime, timedelta
import json

import models
import pytest
from jose import jwt
from routers.documents import (
    _account_numbers_match,
    _address_validation,
    _apply_loan_document_overrides,
    _closing_setup_review_payload,
    _duplicate_of_payload,
    _loan_document_required_fields,
    _normalize_loan_document_extracted,
    _statement_setup_review_payload,
)
from services.document_parser import parse_closing_statement, parse_mortgage_statement


SECRET_KEY = "propertylens-secret-key-change-in-production"
ALGORITHM = "HS256"


def test_extended_disclosure_account_matches_statement_base_account():
    assert _account_numbers_match("1368496008-5678387", "1368496008")
    assert _account_numbers_match("1368496008", "1368496008-5678387")
    assert not _account_numbers_match("1368496008", "1392931056")


def auth_headers(email: str) -> dict:
    payload = {"sub": email, "exp": datetime.utcnow() + timedelta(hours=1)}
    return {"Authorization": f"Bearer {jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)}"}


def test_closing_statement_down_payment_is_not_cash_to_close():
    text = """Closing Disclosure
Closing Date 5/27/2021
Sale Price $655,000
Loan Amount $491,000
Down Payment/Funds from Borrower $164,000.00
Cash to Close $165,984.70
Borrower-Paid Closing Costs $8,415.28
Lender Better Mortgage Corporation LoanID# 123456789
Interest Rate 3.625%
Principal & Interest $2,239.21
Loan Term 30 years
Estimated Escrow + 775.04
"""

    data = parse_closing_statement(text)

    assert data["purchase_date"] == "2021-05-27"
    assert data["purchase_price"] == 655000
    assert data["original_amount"] == 491000
    assert data["down_payment"] == 164000
    assert data["cash_to_close"] == 165984.70
    assert data["down_payment"] != data["cash_to_close"]
    assert data["closing_costs"] == 8415.28
    assert data["interest_rate"] == 3.625
    assert data["loan_term_years"] == 30
    assert data["monthly_payment"] == 2239.21
    assert data["escrow_monthly"] == 775.04
    assert data["estimated_total_monthly_payment"] == 3014.25


def test_settlement_last_totals_line_is_final_settlement_total():
    text = """Final Settlement Statement
Sale Price $625,000.00
Closing Costs $14,491.23
Totals $625,000.00 $639,491.23
"""

    data = parse_closing_statement(text)

    assert data["purchase_price"] == 625000
    assert data["settlement_total_amount"] == 639491.23
    assert data["settlement_total_source"] == "settlement_credit_total"
    assert data["closing_costs"] == 14491.23


def test_settlement_total_is_not_fabricated_from_purchase_price_plus_closing_costs():
    text = """Settlement Statement
Sale Price $625,000.00
Borrower-Paid Closing Costs $14,491.23
"""

    data = parse_closing_statement(text)

    assert "settlement_total_amount" not in data
    assert data["closing_costs"] == 14491.23


def test_setup_import_review_uses_stored_document_data():
    document = SimpleNamespace(
        id=7,
        property_id=3,
        display_name="Closing Disclosure.pdf",
        original_filename="Closing Disclosure.pdf",
        doc_category="closing_statement",
        upload_date="2026-07-12T00:00:00",
        markdown_file="closing.md",
        extracted_data="""{
          "purchase_date": "2021-05-27",
          "purchase_price": 655000,
          "down_payment": 164000,
          "closing_costs": 8415.28,
          "original_amount": 491000,
          "interest_rate": 3.625,
          "loan_term_years": 30,
          "monthly_payment": 2239.21,
          "escrow_monthly": 775.04,
          "estimated_total_monthly_payment": 3014.25
        }""",
    )

    review = _closing_setup_review_payload(document, "Closing Disclosure markdown")

    assert review["markdownReader"]["used"] is True
    assert review["document"]["id"] == 7
    assert review["loanDetected"] is True
    assert review["loanDrafts"][0]["original_amount"] == 491000
    assert review["loanDrafts"][0]["current_balance_source_label"] == "Initial balance from closing document"
    assert any(field["targetKey"] == "purchase_price" for field in review["propertyFields"])
    assert not any(field["targetKey"] == "market_value" for field in review["propertyFields"])
    assert any(field["targetKey"] == "escrow_amount" for field in review["loanFields"])


def test_setup_review_derives_missing_final_settlement_total_for_existing_document():
    document = SimpleNamespace(
        id=8,
        property_id=3,
        display_name="Settlement Statement.pdf",
        original_filename="Settlement Statement.pdf",
        doc_category="closing_statement",
        upload_date="2026-07-12T00:00:00",
        markdown_file="settlement.md",
        extracted_data=json.dumps({
            "setup_import_role": "settlement_document",
            "purchase_price": 625000,
            "closing_costs": 14491.23,
        }),
    )

    review = _closing_setup_review_payload(document, "Settlement Statement")

    assert not any(field["targetKey"] == "settlement_total_amount" for field in review["propertyFields"])
    assert not any(row["key"] == "settlement_total_amount" for row in review["settlementCalculations"])


def test_setup_import_review_exposes_purchase_price_components():
    document = SimpleNamespace(
        id=9,
        property_id=4,
        display_name="ALTA Settlement Statement.pdf",
        original_filename="ALTA Settlement Statement.pdf",
        doc_category="closing_statement",
        upload_date="2026-07-12T00:00:00",
        markdown_file="alta.md",
        extracted_data=json.dumps({
            "property_address": "911 Osprey Dr",
            "property_city": "Lathrop",
            "property_state": "CA",
            "property_zip": "95330",
            "purchase_price": 625000,
            "sale_price": 625000,
            "settlement_debit_subtotal": 638810.23,
            "settlement_credit_subtotal": 638810.23,
            "settlement_due_to_buyer": 681,
            "settlement_debit_total": 639491.23,
            "settlement_credit_total": 639491.23,
            "settlement_total_amount": 639491.23,
            "settlement_purchase_price_adjustment": 14491.23,
        }),
    )

    review = _closing_setup_review_payload(document, "ALTA Settlement Statement markdown")

    selection = review["purchasePriceSelection"]
    assert "settlementTotal" not in selection
    assert selection["selectedTotal"] == 625000
    assert [component["id"] for component in selection["components"]] == ["sale_price"]
    purchase_field = next(field for field in review["propertyFields"] if field["targetKey"] == "purchase_price")
    assert purchase_field["value"] == 625000
    accounting_field = next(field for field in review["propertyFields"] if field["targetKey"] == "settlement_total_amount")
    assert accounting_field["label"] == "Settlement accounting total"
    assert accounting_field["value"] == 639491.23
    assert not any(field["targetKey"] == "market_value" for field in review["propertyFields"])
    assert not any(field["targetKey"] == "cash_to_close" for field in review["propertyFields"])
    accounting_total = next(row for row in review["settlementCalculations"] if row["key"] == "settlement_total_amount")
    assert accounting_total["label"] == "Settlement accounting total"
    assert accounting_total["amount"] == 639491.23


def test_settlement_document_review_uses_final_total_without_loan_details():
    document = SimpleNamespace(
        id=10,
        property_id=4,
        display_name="Settlement Statement.pdf",
        original_filename="Settlement Statement.pdf",
        doc_category="closing_statement",
        upload_date="2026-07-12T00:00:00",
        markdown_file="settlement.md",
        extracted_data=json.dumps({
            "setup_import_role": "settlement_document",
            "property_address": "911 Osprey Dr",
            "property_city": "Lathrop",
            "property_state": "CA",
            "property_zip": "95330",
            "purchase_price": 625000,
            "original_amount": 468750,
            "settlement_total_amount": 639491.23,
            "purchase_date": "2023-05-24",
        }),
    )

    review = _closing_setup_review_payload(document, "Final Settlement Statement")

    assert review["document"]["setupImportRole"] == "settlement_document"
    assert review["loanDetected"] is False
    assert review["loanDrafts"] == []
    selection = review["purchasePriceSelection"]
    assert selection["components"][0]["id"] == "sale_price"
    assert selection["selectedTotal"] == 625000
    purchase_field = next(field for field in review["propertyFields"] if field["targetKey"] == "purchase_price")
    assert purchase_field["value"] == 625000
    assert not any(field["targetKey"] == "settlement_total_amount" for field in review["propertyFields"])
    assert not any(field["targetKey"] == "market_value" for field in review["propertyFields"])
    assert not any(field["targetKey"] == "settlement_debit_total" for field in review["propertyFields"])
    assert any(row["key"] == "settlement_total_amount" for row in review["settlementCalculations"])


def test_duplicate_payload_is_json_serializable():
    document = SimpleNamespace(
        id=32,
        display_name="Closing Statement",
        original_filename="closing.pdf",
        upload_date=datetime(2026, 7, 12, 15, 41, 41),
        property=SimpleNamespace(address="10575 E MISSION LN"),
        doc_category="closing_statement",
    )

    payload = _duplicate_of_payload(document, "exact")

    assert payload["upload_date"] == "2026-07-12T15:41:41"
    json.dumps(payload)


def test_1098_preview_required_fields_use_existing_extraction_aliases():
    extracted = _normalize_loan_document_extracted("1098", {
        "mortgage_interest": 8826.97,
        "current_balance": 463428.32,
        "property_address": "",
    })

    required = _loan_document_required_fields("1098", extracted)
    by_key = {field["key"]: field for field in required}

    assert by_key["box1_interest"]["value"] == 8826.97
    assert by_key["box1_interest"]["missing"] is False
    assert by_key["box2_balance"]["value"] == 463428.32
    assert by_key["box2_balance"]["missing"] is False
    assert by_key["property_address"]["missing"] is True
    assert "enter manually" in by_key["property_address"]["message"]


def test_1098_accept_overrides_preserve_existing_document_model_fields():
    extracted = _apply_loan_document_overrides("1098", {}, {
        "box1_interest": "$8,826.97",
        "box2_balance": "$463,428.32",
        "property_address": "10575 East Mission Lane",
    })

    assert extracted["mortgage_interest"] == 8826.97
    assert extracted["box1_interest"] == 8826.97
    assert extracted["current_balance"] == 463428.32
    assert extracted["box2_balance"] == 463428.32
    assert extracted["property_address"] == "10575 East Mission Lane"


def test_address_validation_matches_lane_suffix_and_zip4():
    prop = SimpleNamespace(
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        zip_code="85258-1234",
    )
    extracted = {
        "property_address": "10575 East Mission Lane",
        "property_city": "SCOTTSDALE",
        "property_state": "Arizona",
        "property_zip": "85258",
    }

    result = _address_validation(prop, extracted)

    assert result["status"] == "match"
    assert result["normalizedPropertyAddress"] == result["normalizedDocumentAddress"]


def test_address_validation_allows_empty_property_address_to_import_document_address():
    prop = SimpleNamespace(address="", city="", state="", zip_code="")
    extracted = {
        "property_address": "911 Osprey Dr",
        "property_city": "Lathrop",
        "property_state": "CA",
        "property_zip": "95330",
    }

    result = _address_validation(prop, extracted)

    assert result["status"] == "property_address_empty"
    assert result["canPopulateFromDocument"] is True
    assert result["canContinue"] is False
    assert result["fieldResults"]["street"] == "missing_can_import"
    assert result["fieldResults"]["zip"] == "missing_can_import"


def test_address_validation_allows_partial_matching_address_to_import_missing_fields():
    prop = SimpleNamespace(address="", city="", state="CA", zip_code="")
    extracted = {
        "property_address": "911 Osprey Dr",
        "property_city": "Lathrop",
        "property_state": "CA",
        "property_zip": "95330",
    }

    result = _address_validation(prop, extracted)

    assert result["status"] == "property_address_empty"
    assert result["fieldResults"]["state"] == "match"
    assert result["fieldResults"]["street"] == "missing_can_import"


def test_address_validation_rejects_partial_conflicting_address():
    prop = SimpleNamespace(address="", city="", state="AZ", zip_code="")
    extracted = {
        "property_address": "911 Osprey Dr",
        "property_city": "Lathrop",
        "property_state": "CA",
        "property_zip": "95330",
    }

    result = _address_validation(prop, extracted)

    assert result["status"] == "mismatch"
    assert result["fieldResults"]["state"] == "conflict"


def test_address_validation_rejects_different_street_number():
    prop = SimpleNamespace(
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        zip_code="85258",
    )
    extracted = {
        "property_address": "10576 East Mission Lane",
        "property_city": "Scottsdale",
        "property_state": "AZ",
        "property_zip": "85258",
    }

    result = _address_validation(prop, extracted)

    assert result["status"] == "mismatch"


def test_apply_setup_import_allows_audited_override_when_document_address_is_missing(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="palermo-address-override",
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
        property_type="single_family",
        usage_type="Primary",
        purchase_price=0,
        market_value=0,
    )
    db.add(prop)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="palermo-settlement.pdf",
        original_filename="Palermo Settlement Statement.pdf",
        display_name="Palermo Settlement Statement.pdf",
        file_type="pdf",
        doc_category="closing_statement",
        file_size=100,
        extracted_data=json.dumps({"purchase_price": 1210000, "purchase_date": "2019-04-12"}),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    blocked = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_price", "purchase_date"],
            "selected_loan_fields": [],
            "address_override": False,
        },
        headers=auth_headers(user.email),
    )
    assert blocked.status_code == 422

    response = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_price", "purchase_date"],
            "selected_loan_fields": [],
            "address_override": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    assert response.json()["addressValidation"]["status"] == "manual_override"
    db.refresh(document)
    override = json.loads(document.extracted_data)["_address_override"]
    assert override["propertyId"] == prop.id
    assert override["normalizedPropertyAddress"] == "3619 PALERMO WAY, DUBLIN, CA 94568"


def test_apply_setup_import_persists_imported_loan(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="mission-lane",
        name="MISSION",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        zip_code="85258",
        property_type="single_family",
        usage_type="Rental",
        purchase_price=0,
        market_value=0,
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="closing.pdf",
        original_filename="Closing Disclosure.pdf",
        display_name="Closing Disclosure.pdf",
        file_type="pdf",
        doc_category="closing_statement",
        file_size=100,
        extracted_data=json.dumps({
            "property_address": "10575 East Mission Lane",
            "property_city": "Scottsdale",
            "property_state": "AZ",
            "property_zip": "85258-0001",
            "purchase_date": "2021-05-27",
            "purchase_price": 655000,
            "down_payment": 164000,
            "closing_costs": 8415.28,
            "lender_name": "Better Mortgage Corporation",
            "loan_type": "FIXED",
            "loan_product": "Conventional",
            "original_amount": 491000,
            "interest_rate": 3.625,
            "loan_term_years": 30,
            "monthly_payment": 2239.21,
            "escrow_monthly": 775.04,
            "estimated_total_monthly_payment": 3014.25,
            "origination_date": "2021-05-27",
        }),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    response = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_date", "purchase_price", "down_payment", "closing_costs"],
            "selected_loan_fields": [],
            "confirm_address_match": False,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["addressValidation"]["status"] == "match"
    assert payload["draft"]["features"]["loan"] is True
    assert len(payload["draft"]["loans"]) == 1
    assert payload["draft"]["loans"][0]["lender_name"] == "Better Mortgage Corporation"
    assert payload["draft"]["loans"][0]["original_amount"] == 491000
    assert payload["draft"]["loans"][0]["current_balance_source"] == "closing_document_initial_balance"
    assert payload["draft"]["loans"][0]["current_balance_verified"] is False

    repeat_response = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_date", "purchase_price", "down_payment", "closing_costs"],
            "selected_loan_fields": [],
            "confirm_address_match": False,
        },
        headers=auth_headers(user.email),
    )

    assert repeat_response.status_code == 200
    assert db.query(models.Loan).filter(models.Loan.property_id == prop.id).count() == 1

    duplicate_document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="closing-copy.pdf",
        original_filename="Closing Disclosure Copy.pdf",
        display_name="Closing Disclosure Copy.pdf",
        file_type="pdf",
        doc_category="closing_statement",
        file_size=100,
        extracted_data=document.extracted_data,
    )
    db.add(duplicate_document)
    db.commit()
    db.refresh(duplicate_document)

    duplicate_response = client.post(
        f"/api/documents/{duplicate_document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_date", "purchase_price", "down_payment", "closing_costs"],
            "selected_loan_fields": [],
            "confirm_address_match": False,
        },
        headers=auth_headers(user.email),
    )

    assert duplicate_response.status_code == 200
    assert db.query(models.Loan).filter(models.Loan.property_id == prop.id).count() == 1
    loan = db.query(models.Loan).filter(models.Loan.property_id == prop.id).one()
    assert loan.source_document_id == document.id
    assert loan.original_amount == 491000
    linked_document_ids = {
        link.document_id
        for link in db.query(models.LoanDocumentLink).filter(models.LoanDocumentLink.loan_id == loan.id).all()
    }
    assert linked_document_ids == {document.id, duplicate_document.id}


def test_apply_setup_import_uses_selected_purchase_price_components(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
        purchase_price=0,
        market_value=0,
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="alta.pdf",
        original_filename="ALTA Settlement Statement.pdf",
        display_name="ALTA Settlement Statement.pdf",
        file_type="pdf",
        doc_category="closing_statement",
        file_size=100,
        extracted_data=json.dumps({
            "property_address": "911 Osprey Dr",
            "property_city": "Lathrop",
            "property_state": "CA",
            "property_zip": "95330",
            "purchase_price": 625000,
            "sale_price": 625000,
            "settlement_total_amount": 639491.23,
            "settlement_purchase_price_adjustment": 14491.23,
            "purchase_date": "2023-05-24",
        }),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    response = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_date", "purchase_price", "settlement_total_amount", "closing_costs"],
            "selected_purchase_price_components": ["sale_price", "settlement_adjustment"],
            "selected_loan_fields": [],
            "confirm_address_match": False,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    db.refresh(prop)
    assert prop.purchase_price == 625000
    assert prop.settlement_total_amount == 0
    assert prop.market_value == 744385.0
    assert prop.market_value_source == "estimated_6pct"
    assert prop.closing_costs == 0


def test_apply_setup_import_populates_empty_property_address(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="empty-address",
        name="EMPTY",
        address="",
        city="",
        state="",
        zip_code="",
        property_type="single_family",
        usage_type="Rental",
        original_residency_status="Rental",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="closing-empty.pdf",
        original_filename="Closing Disclosure.pdf",
        display_name="Closing Disclosure.pdf",
        file_type="pdf",
        doc_category="closing_statement",
        file_size=100,
        extracted_data=json.dumps({
            "property_address": "911 Osprey Dr",
            "property_city": "Lathrop",
            "property_state": "CA",
            "property_zip": "95330",
            "purchase_date": "2021-05-27",
            "purchase_price": 655000,
        }),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    response = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["address", "city", "state", "zip_code", "purchase_date", "purchase_price"],
            "selected_loan_fields": [],
            "confirm_address_match": False,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["addressValidation"]["status"] == "match"
    assert payload["draft"]["property"]["address"] == "911 Osprey Dr"
    assert payload["draft"]["property"]["city"] == "Lathrop"
    assert payload["draft"]["property"]["state"] == "CA"
    assert payload["draft"]["property"]["zip_code"] == "95330"
    assert payload["draft"]["property"]["rental_start_date"] == "2021-05-27"
    assert payload["draft"]["property"]["rental_start_date_origin"] == "auto_purchase_date"


def test_mortgage_statement_extracts_balance_and_escrow_components():
    text = """Mortgage Statement
Statement Date 06/30/2026
Loan Number 123456789
Unpaid Principal Balance $482,123.45
Property Taxes: $510.00
Homeowners Insurance $125.50
Mortgage Insurance: $0.00
Escrow Amount $700.00
Total Payment $2,950.00
"""

    data = parse_mortgage_statement(text)

    assert data["current_balance"] == 482123.45
    assert data["statement_date"] == "06/30/2026"
    assert data["monthly_property_tax_escrow"] == 510
    assert data["monthly_insurance_escrow"] == 125.5
    assert data["monthly_mortgage_insurance"] == 0
    assert data["monthly_other_escrow"] == 64.5
    assert data["escrow_amount"] == 700
    assert data["escrow_included"] is True


def test_statement_setup_review_returns_reported_fields():
    document = SimpleNamespace(
        id=8,
        property_id=3,
        display_name="Mortgage Statement.pdf",
        original_filename="Mortgage Statement.pdf",
        doc_category="mortgage_statement",
        upload_date="2026-07-12T00:00:00",
        markdown_file="statement.md",
        extracted_data=json.dumps({
            "current_balance": 482123.45,
            "monthly_payment": 2239.21,
            "monthly_property_tax_escrow": 510,
            "monthly_insurance_escrow": 125.5,
            "monthly_mortgage_insurance": 50,
            "monthly_other_escrow": 14.5,
            "escrow_amount": 700,
            "statement_date": "2026-06-30",
        }),
    )

    review = _statement_setup_review_payload(document)

    assert review["document"]["id"] == 8
    assert review["statementDraft"]["current_balance_source"] == "mortgage_statement_reported_balance"
    assert review["statementDraft"]["current_balance_source_label"] == "Reported from mortgage statement"
    assert any(field["targetKey"] == "current_balance" for field in review["loanFields"])
    assert not any("escrow" in field["targetKey"] for field in review["loanFields"])
    assert not any(field["targetKey"] == "estimated_total_monthly_payment" for field in review["loanFields"])
    assert "escrow_amount" not in review["statementDraft"]


def test_apply_loan_statement_updates_reported_balance_and_clears_initial_warning(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="statement-prop",
        name="MISSION",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        zip_code="85258",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    loan = models.Loan(
        property_id=prop.id,
        lender_name="Better Mortgage Corporation",
        loan_type="FIXED",
        original_amount=491000,
        current_balance=491000,
        interest_rate=3.625,
        monthly_payment=2239.21,
        loan_term_years=30,
        current_balance_source="closing_document_initial_balance",
        current_balance_verified=False,
    )
    db.add(loan)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="statement.pdf",
        original_filename="Mortgage Statement.pdf",
        display_name="Mortgage Statement.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        extracted_data=json.dumps({
            "current_balance": 482123.45,
            "monthly_property_tax_escrow": 510,
            "monthly_insurance_escrow": 125.5,
            "monthly_mortgage_insurance": 50,
            "monthly_other_escrow": 14.5,
            "escrow_amount": 700,
            "statement_date": "2026-06-30",
        }),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": loan.id,
            "selected_loan_fields": [
                "current_balance",
                "statement_date",
            ],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    updated = payload["draft"]["loans"][0]
    assert updated["current_balance"] == 482123.45
    assert updated["current_balance_source"] == "mortgage_statement_reported_balance"
    assert updated["current_balance_verified"] is True
    assert updated["monthly_property_tax_escrow"] == 510
    assert updated["monthly_insurance_escrow"] == 125.5
    assert updated["monthly_mortgage_insurance"] == 50
    assert updated["monthly_other_escrow"] == 14.5
    assert updated["escrow_amount"] == 700
    assert updated["estimated_total_monthly_payment"] == 2939.21
    estimates = payload["expenseEstimates"]
    assert estimates["year"] == 2026
    assert estimates["propertyTax"]["value"] == 6120
    assert estimates["propertyTax"]["source"] == "escrow-estimate"
    assert estimates["propertyTax"]["applied"] is True
    assert estimates["insurance"]["value"] == 1506
    assert estimates["insurance"]["source"] == "escrow-estimate"
    assert estimates["insurance"]["applied"] is True
    annual = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == 2026,
    ).one()
    assert annual.property_tax == 6120
    assert annual.property_tax_source == "escrow-estimate"
    assert annual.insurance == 1506
    assert annual.insurance_source == "escrow-estimate"
    source_details = json.loads(annual.notes)["sources"]
    assert source_details["property_tax"]["documentId"] == document.id
    assert source_details["property_tax"]["docType"] == "mortgage statement"
    assert source_details["insurance"]["documentId"] == document.id


def test_apply_latest_statement_updates_matching_current_servicer_escrow(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey-escrow-current",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
        purchase_date="2023-05-24",
        purchase_price=625000,
    )
    db.add(prop)
    db.flush()
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI / LoanCare",
        account_number="0064944077",
        status="CLOSED",
        closed_date="2024-09-01",
        closure_reason="Servicing transfer",
        transfer_reason="Servicing transfer",
        is_current_servicer=False,
        servicer_sequence=1,
        servicer_start_date="2023-05-26",
        servicer_end_date="2024-09-01",
        origination_date="2023-05-24",
        original_amount=468750,
        current_balance=466682,
        interest_rate=7.625,
        monthly_payment=3318,
        loan_term_years=30,
        escrow_included=True,
        escrow_amount=0,
    )
    rocket = models.Loan(
        property_id=prop.id,
        lender_name="Rocket",
        account_number="3550379001",
        status="OPEN",
        is_current_servicer=True,
        servicer_sequence=2,
        servicer_start_date="2024-10-01",
        origination_date="2023-05-26",
        original_amount=463428,
        current_balance=438502,
        interest_rate=7.625,
        monthly_payment=4275,
        loan_term_years=30,
    )
    db.add_all([old_loan, rocket])
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="rocket_latest_statement.pdf",
        original_filename="Rocket Latest Mortgage Statement.pdf",
        display_name="Rocket Latest Mortgage Statement.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        extracted_data=json.dumps({
            "account_number": "3550379001",
            "current_balance": 438502,
            "monthly_property_tax_escrow": 887.47,
            "monthly_insurance_escrow": 186.26,
            "monthly_mortgage_insurance": 0,
            "monthly_other_escrow": 839.73,
            "escrow_amount": 1913.46,
            "estimated_total_monthly_payment": 6188.46,
            "statement_date": "2026-06-30",
        }),
    )
    db.add(document)
    db.commit()

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": old_loan.id,
            "selected_loan_fields": ["current_balance", "statement_date"],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    db.refresh(old_loan)
    db.refresh(rocket)
    assert old_loan.escrow_amount == 0
    assert rocket.escrow_included is True
    assert rocket.monthly_property_tax_escrow == 887.47
    assert rocket.monthly_insurance_escrow == 186.26
    assert rocket.monthly_other_escrow == 839.73
    assert rocket.escrow_amount == 1913.46
    assert rocket.estimated_total_monthly_payment == 6188.46


def test_apply_loan_statement_adds_servicer_segment_without_creating_debt(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey-transfer",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage",
        loan_type="FIXED",
        status="CLOSED",
        closed_date="2024-12-31",
        closure_reason="Servicing transfer",
        original_amount=468750,
        current_balance=450000,
        interest_rate=7.625,
        monthly_payment=3317.78,
        loan_term_years=30,
        account_number="OLD-LOAN-1",
    )
    db.add(old_loan)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="latest-statement.pdf",
        original_filename="911 Osprey Dr - Latest Mortgage Statement - June 2026.pdf",
        display_name="Latest Mortgage Statement.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        loan_account_number="3550379001",
        extracted_data=json.dumps({
            "property_address": "911 OSPREY DRIVE",
            "property_city": "Lathrop",
            "property_state": "CA",
            "property_zip": "95330",
            "account_number": "3550379001",
            "current_balance": 438502.37,
            "monthly_payment": 4274.51,
            "escrow_amount": 1913.46,
            "monthly_property_tax_escrow": 887.47,
            "monthly_insurance_escrow": 69.26,
            "monthly_mortgage_insurance": 0,
            "monthly_other_escrow": 956.73,
            "interest_rate": 7.625,
            "statement_date": "2026-06-11",
        }),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": old_loan.id,
            "selected_loan_fields": [
                "account_number",
                "current_balance",
                "monthly_property_tax_escrow",
                "monthly_insurance_escrow",
                "monthly_mortgage_insurance",
                "monthly_other_escrow",
                "escrow_amount",
                "statement_date",
            ],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["loanId"] == old_loan.id
    assert payload["loanMapping"]["created"] is False
    db.refresh(old_loan)
    assert old_loan.account_number == "3550379001"
    assert old_loan.status == "OPEN"
    assert old_loan.current_balance == 438502.37
    assert old_loan.source_document_id == document.id
    assert old_loan.current_balance_source == "mortgage_statement_reported_balance"
    assert db.query(models.Loan).filter(models.Loan.property_id == prop.id).count() == 1
    assert db.query(models.LoanBalanceSnapshot).filter_by(
        loan_id=old_loan.id,
        source_document_id=document.id,
    ).count() == 1


def test_apply_refinance_disclosure_creates_distinct_opening_loan(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="palermo-refinance-disclosure",
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
        property_type="single_family",
        usage_type="Primary Residence",
    )
    db.add(prop)
    db.flush()
    purchase_loan = models.Loan(
        property_id=prop.id,
        lender_name="Bank of America",
        loan_type="FIXED",
        status="OPEN",
        original_amount=968000,
        current_balance=940000,
        interest_rate=4.125,
        monthly_payment=4690,
        loan_term_years=30,
        origination_date="2019-04-12",
        account_number="289608533",
    )
    db.add(purchase_loan)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="palermo-2021-refinance-disclosure.pdf",
        original_filename="3619 Palermo Way - 2021 Refinance - Loan Disclosure Document.pdf",
        display_name="2021 Refinance Loan Disclosure.pdf",
        file_type="pdf",
        doc_category="loan_disclosure",
        file_size=100,
        loan_account_number="1368496008-5678387",
        extracted_data=json.dumps({
            "property_address": "3619 Palermo Way",
            "property_city": "Dublin",
            "property_state": "CA",
            "property_zip": "94568",
            "lender_name": "JPMorgan Chase Bank, N.A",
            "account_number": "1368496008-5678387",
            "loan_purpose": "Refinance",
            "loan_product": "Conventional",
            "loan_type": "FIXED",
            "original_amount": 933904,
            "current_balance": 933904,
            "interest_rate": 2.875,
            "loan_term_years": 30,
            "monthly_payment": 3874.70,
            "origination_date": "2021-07-30",
            "current_balance_source": "loan_disclosure_initial_balance",
            "current_balance_verified": False,
        }),
    )
    db.add(document)
    db.commit()

    review_response = client.get(
        f"/api/documents/{document.id}/loan-statement-review",
        headers=auth_headers(user.email),
    )
    assert review_response.status_code == 200
    review = review_response.json()
    assert review["document"]["type"] == "loan_disclosure"
    assert review["statementDraft"]["account_number"] == "1368496008-5678387"
    assert review["statementDraft"]["current_balance_verification_status"] == "Needs latest mortgage statement"
    assert {field["targetKey"] for field in review["loanFields"]} >= {
        "lender_name",
        "account_number",
        "original_amount",
        "current_balance",
        "interest_rate",
        "loan_product",
        "loan_term_years",
        "monthly_payment",
        "origination_date",
    }

    apply_response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "selected_loan_fields": [field["targetKey"] for field in review["loanFields"]],
            "address_override": False,
        },
        headers=auth_headers(user.email),
    )

    assert apply_response.status_code == 200
    db.refresh(purchase_loan)
    assert purchase_loan.account_number == "289608533"
    assert purchase_loan.current_balance == 940000
    loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).all()
    assert len(loans) == 2
    refinance = next(loan for loan in loans if loan.account_number == "1368496008-5678387")
    assert refinance.lender_name == "JPMorgan Chase Bank, N.A"
    assert refinance.loan_product == "Conventional"
    assert refinance.original_amount == 933904
    assert refinance.current_balance == 933904
    assert refinance.interest_rate == 2.875
    assert refinance.monthly_payment == 3874.70
    assert refinance.origination_date == "2021-07-30"
    assert refinance.source_document_id == document.id
    assert refinance.source_type == "resolved_transaction"
    db.refresh(purchase_loan)
    assert purchase_loan.status == "CLOSED"
    assert purchase_loan.closed_date == "2021-07-30"
    assert purchase_loan.refinanced_into_loan_id == refinance.id
    assert refinance.refinanced_from_loan_id == purchase_loan.id
    assert refinance.current_balance_source == "loan_disclosure_initial_balance"
    assert refinance.current_balance_verified is False


def test_purchase_closing_disclosure_with_loan_terms_is_accepted_in_loan_review(client, db, user, prop):
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="palermo-2019-purchase-closing-disclosure.pdf",
        original_filename="3619 Palermo Way - 2019 Purchase - Original Loan disclosure - BOA.pdf",
        display_name="2019 Purchase Closing Disclosure.pdf",
        file_type="pdf",
        doc_category="closing_statement",
        file_size=100,
        extracted_data=json.dumps({
            "property_address": "3619 Palermo Way",
            "property_city": "Dublin",
            "property_state": "CA",
            "property_zip": "94568",
            "lender_name": "BANK OF AMERICA, N.A",
            "loan_id": "289608533",
            "original_amount": 968000,
            "interest_rate": 4.125,
            "loan_term_years": 30,
            "monthly_payment": 4691.41,
            "loan_type": "FIXED",
            "origination_date": "2019-04-11",
        }),
    )
    db.add(document)
    db.commit()

    response = client.get(
        f"/api/documents/{document.id}/loan-statement-review",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    review = response.json()
    assert review["document"]["type"] == "closing_statement"
    assert review["statementDraft"]["account_number"] == "289608533"
    fields = {field["targetKey"]: field["value"] for field in review["loanFields"]}
    assert fields["lender_name"] == "BANK OF AMERICA, N.A"
    assert fields["original_amount"] == 968000
    assert fields["current_balance"] == 968000
    assert fields["interest_rate"] == 4.125
    assert fields["loan_term_years"] == 30
    assert fields["monthly_payment"] == 4691.41


def test_apply_1098_updates_matched_existing_account_without_closing_other_debt(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey-1098-transfer",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=450000,
        interest_rate=7.625,
        monthly_payment=3317.78,
        loan_term_years=30,
        origination_date="2023-05-24",
        account_number="230577464",
    )
    new_loan = models.Loan(
        property_id=prop.id,
        lender_name="Rocket",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=438502.37,
        interest_rate=7.625,
        monthly_payment=4274.51,
        loan_term_years=30,
        origination_date="2023-05-26",
        account_number="3550379001",
    )
    db.add_all([old_loan, new_loan])
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="1098.pdf",
        original_filename="Rocket 1098.pdf",
        display_name="Rocket 1098.pdf",
        file_type="pdf",
        doc_category="1098",
        file_size=100,
        loan_account_number="3550379001",
        statement_year=2024,
        extracted_data=json.dumps({
            "account_number": "3550379001",
            "lender_name": "Rocket",
            "tax_year": "2024",
            "statement_year": 2024,
            "statement_date": "12/31/2024",
            "mortgage_interest": 12000,
            "current_balance": 438502.37,
            "origination_date": "05/26/2023",
            "mortgage_acquisition_date": "01/15/2024",
        }),
    )
    db.add(document)
    db.commit()

    review = client.get(
        f"/api/documents/{document.id}/loan-statement-review",
        headers=auth_headers(user.email),
    )
    assert review.status_code == 200
    fields = {field["targetKey"]: field for field in review.json()["loanFields"]}
    assert fields["servicer_start_date"]["value"] == "01/15/2024"

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": old_loan.id,
            "selected_loan_fields": [
                "account_number",
                "current_balance",
                "statement_date",
                "origination_date",
                "servicer_start_date",
            ],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["loanId"] == new_loan.id
    assert payload["servicingTransfer"]["suggestions"] == []
    db.refresh(old_loan)
    db.refresh(new_loan)
    assert old_loan.status == "OPEN"
    assert old_loan.closed_date is None
    assert new_loan.servicer_start_date == "2024-01-15"
    assert new_loan.is_current_servicer is True
    snapshot = db.query(models.LoanBalanceSnapshot).filter_by(
        loan_id=new_loan.id,
        source_document_id=document.id,
    ).one()
    assert snapshot.as_of_date == "2024-01-01"
    assert snapshot.interest_paid_ytd == 12000


def test_apply_1098_account_number_consolidates_original_closing_loan(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey-1098-out-of-order",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=468750,
        interest_rate=7.625,
        monthly_payment=3317.78,
        loan_term_years=30,
        origination_date="2023-05-24",
        account_number="230577464",
    )
    db.add(old_loan)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="loancare-1098.pdf",
        original_filename="LoanCare 1098.pdf",
        display_name="LoanCare 1098.pdf",
        file_type="pdf",
        doc_category="1098",
        file_size=100,
        loan_account_number="0064944077",
        statement_year=2024,
        extracted_data=json.dumps({
            "account_number": "0064944077",
            "lender_name": "LoanCare",
            "tax_year": "2024",
            "statement_year": 2024,
            "statement_date": "12/31/2024",
            "mortgage_interest": 26606.53,
            "current_balance": 466681.81,
            "origination_date": "05/26/23",
        }),
    )
    db.add(document)
    db.commit()

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": old_loan.id,
            "selected_loan_fields": [
                "account_number",
                "current_balance",
                "statement_date",
                "origination_date",
            ],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    db.refresh(old_loan)
    loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).all()
    assert len(loans) == 1
    assert old_loan.account_number == "0064944077"
    assert old_loan.current_balance == 466681.81
    assert old_loan.source_type == "1098"


def test_osprey_1098_sequence_updates_one_canonical_loan_with_servicer_segments(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey-two-loan-chain",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    original = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=468750,
        interest_rate=7.625,
        monthly_payment=3317.78,
        loan_term_years=30,
        origination_date="2023-05-24",
        account_number="230577464",
        source_type="closing_statement",
    )
    db.add(original)
    db.flush()
    loancare_doc = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="loancare-1098.pdf",
        original_filename="LoanCare 1098.pdf",
        display_name="LoanCare 1098.pdf",
        file_type="pdf",
        doc_category="1098",
        file_size=100,
        loan_account_number="0064944077",
        statement_year=2024,
        extracted_data=json.dumps({
            "account_number": "0064944077",
            "tax_year": "2024",
            "statement_year": 2024,
            "statement_date": "12/31/2024",
            "mortgage_interest": 26606.53,
            "current_balance": 466681.81,
            "origination_date": "05/26/23",
        }),
    )
    rocket_doc = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="rocket-1098.pdf",
        original_filename="Rocket 1098.pdf",
        display_name="Rocket 1098.pdf",
        file_type="pdf",
        doc_category="1098",
        file_size=100,
        loan_account_number="3550379001",
        statement_year=2024,
        extracted_data=json.dumps({
            "account_number": "3550379001",
            "lender_name": "Rocket",
            "tax_year": "2024",
            "statement_year": 2024,
            "statement_date": "12/31/2024",
            "mortgage_interest": 8826.97,
            "current_balance": 463428.32,
            "origination_date": "05/26/2023",
            "mortgage_acquisition_date": "10/01/2024",
        }),
    )
    rocket_2025_doc = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="rocket-2025-1098.pdf",
        original_filename="Rocket 2025 1098.pdf",
        display_name="Rocket 2025 1098.pdf",
        file_type="pdf",
        doc_category="1098",
        file_size=100,
        loan_account_number="3550379001",
        statement_year=2025,
        extracted_data=json.dumps({
            "account_number": "3550379001",
            "lender_name": "Rocket",
            "tax_year": "2025",
            "statement_year": 2025,
            "statement_date": "12/31/2025",
            "mortgage_interest": 35088.0,
            "current_balance": 462302.0,
            "origination_date": "05/26/2023",
            "mortgage_acquisition_date": "10/01/2024",
        }),
    )
    db.add_all([loancare_doc, rocket_doc, rocket_2025_doc])
    db.commit()

    loancare_response = client.post(
        f"/api/documents/{loancare_doc.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "selected_loan_fields": ["account_number", "current_balance", "statement_date", "origination_date"],
            "address_override": True,
        },
        headers=auth_headers(user.email),
    )
    assert loancare_response.status_code == 200

    rocket_response = client.post(
        f"/api/documents/{rocket_doc.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "selected_loan_fields": [
                "account_number",
                "current_balance",
                "statement_date",
                "origination_date",
                "servicer_start_date",
            ],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )
    assert rocket_response.status_code == 200

    rocket_2025_response = client.post(
        f"/api/documents/{rocket_2025_doc.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "selected_loan_fields": [
                "account_number",
                "current_balance",
                "statement_date",
                "origination_date",
                "servicer_start_date",
            ],
            "address_override": True,
        },
        headers=auth_headers(user.email),
    )
    assert rocket_2025_response.status_code == 200

    loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).order_by(models.Loan.account_number).all()
    assert len(loans) == 1
    loan = loans[0]
    assert loan.account_number == "3550379001"
    assert loan.status == "OPEN"
    assert loan.closed_date is None
    assert loan.current_balance == 462302.0
    assert loan.current_balance_as_of == "2025-01-01"
    assert db.query(models.LoanBalanceSnapshot).filter_by(loan_id=loan.id).count() == 3
    segments = db.query(models.LoanServicerSegment).filter_by(loan_id=loan.id).order_by(
        models.LoanServicerSegment.from_date,
    ).all()
    assert [segment.account_number for segment in segments] == [
        "230577464",
        "0064944077",
        "3550379001",
    ]

    debt_response = client.get(
        f"/api/properties/{prop.id}/debt",
        headers=auth_headers(user.email),
    )
    assert debt_response.status_code == 200
    loan_payload = debt_response.json()["loans"][0]
    rows = {row["year"]: row for row in loan_payload["paydown"]["rows"] if not row.get("isFullYearProjection")}
    assert loan_payload["original_amount"] == pytest.approx(468750)
    assert "→" in rows[2024]["servicerDisplay"]
    assert rows[2024]["interestPaid"] == pytest.approx(26606.53 + 8826.97)
    assert rows[2024]["endingBalance"] == pytest.approx(rows[2025]["startingBalance"])
    assert rows[2024]["endingBalance"] == pytest.approx(462302.0)
    assert rows[2024]["principalPaid"] == pytest.approx(466681.81 - 462302.0)
    combined_1098 = [doc for doc in rows[2024]["documents"] if doc["docType"] == "1098"]
    assert len(combined_1098) == 1
    assert combined_1098[0]["combinedDocumentIds"] == [loancare_doc.id, rocket_doc.id]


def test_periodic_statement_cannot_establish_materially_different_refinance(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="osprey-refinance-inference",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="Original Bank",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=450000,
        interest_rate=7.625,
        monthly_payment=3317.78,
        loan_term_years=30,
        origination_date="2023-05-24",
        account_number="OLD-LOAN-1",
    )
    db.add(old_loan)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="new-refi-statement.pdf",
        original_filename="New Refinance Statement.pdf",
        display_name="New Refinance Statement.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        loan_account_number="NEW-LOAN-9",
        extracted_data=json.dumps({
            "account_number": "NEW-LOAN-9",
            "lender_name": "New Bank",
            "current_balance": 440000,
            "original_amount": 440000,
            "interest_rate": 6.5,
            "monthly_payment": 2781,
            "loan_term_years": 30,
            "origination_date": "2024-10-15",
            "statement_date": "2024-11-01",
        }),
    )
    db.add(document)
    db.commit()

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": old_loan.id,
            "selected_loan_fields": [
                "account_number",
                "current_balance",
                "statement_date",
                "origination_date",
            ],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CANONICAL_LOAN_REQUIRED"
    db.refresh(old_loan)
    assert old_loan.status == "OPEN"
    assert old_loan.closed_date is None
    assert db.query(models.Loan).filter(models.Loan.property_id == prop.id).count() == 1
    assert db.query(models.LoanDocumentLink).filter_by(document_id=document.id).count() == 0


def test_apply_1098_requires_confirmation_when_selected_loan_account_differs(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="account-mismatch-confirm",
        name="OSPREY",
        address="911 Osprey Dr",
        city="Lathrop",
        state="CA",
        zip_code="95330",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    selected_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=466000,
        interest_rate=7.625,
        monthly_payment=3317.78,
        loan_term_years=30,
        origination_date="2023-05-26",
        account_number="0064944077",
    )
    db.add(selected_loan)
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="rocket-1098.pdf",
        original_filename="Rocket 1098.pdf",
        display_name="Rocket 1098.pdf",
        file_type="pdf",
        doc_category="1098",
        file_size=100,
        loan_account_number="3550379001",
        statement_year=2024,
        extracted_data=json.dumps({
            "account_number": "3550379001",
            "lender_name": "Rocket",
            "tax_year": "2024",
            "statement_year": 2024,
            "statement_date": "12/31/2024",
            "mortgage_interest": 8826.97,
            "current_balance": 463428.32,
            "origination_date": "05/26/2023",
            "mortgage_acquisition_date": "10/01/2024",
        }),
    )
    db.add(document)
    db.commit()

    blocked = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": selected_loan.id,
            "selected_loan_fields": ["account_number", "current_balance", "statement_date", "origination_date", "servicer_start_date"],
            "address_override": True,
        },
        headers=auth_headers(user.email),
    )

    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "LOAN_ACCOUNT_MISMATCH_CONFIRMATION_REQUIRED"

    confirmed = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": selected_loan.id,
            "selected_loan_fields": ["account_number", "current_balance", "statement_date", "origination_date", "servicer_start_date"],
            "address_override": True,
            "confirm_account_mismatch": True,
        },
        headers=auth_headers(user.email),
    )

    assert confirmed.status_code == 200
    assert confirmed.json()["loanId"] == selected_loan.id
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 1
    assert db.query(models.LoanBalanceSnapshot).filter_by(
        loan_id=selected_loan.id,
        source_document_id=document.id,
    ).count() == 1


def test_apply_loan_statement_does_not_overwrite_manual_expenses(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="statement-manual-prop",
        name="MISSION",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        zip_code="85258",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    loan = models.Loan(
        property_id=prop.id,
        lender_name="Better Mortgage Corporation",
        loan_type="FIXED",
        original_amount=491000,
        current_balance=491000,
        interest_rate=3.625,
        monthly_payment=2239.21,
        loan_term_years=30,
    )
    row = models.AnnualExpense(
        property_id=prop.id,
        owner_id=user.id,
        year=2026,
        property_tax=7000,
        insurance=1800,
        property_tax_source="manual",
        insurance_source="reported",
    )
    db.add_all([loan, row])
    db.flush()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="statement.pdf",
        original_filename="Mortgage Statement.pdf",
        display_name="Mortgage Statement.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        extracted_data=json.dumps({
            "monthly_property_tax_escrow": 510,
            "monthly_insurance_escrow": 125.5,
            "statement_date": "2026-06-30",
        }),
    )
    db.add(document)
    db.commit()

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": loan.id,
            "selected_loan_fields": ["statement_date"],
            "address_override": True,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["expenseEstimates"]["propertyTax"]["applied"] is False
    assert payload["expenseEstimates"]["insurance"]["applied"] is False
    db.refresh(row)
    assert row.property_tax == 7000
    assert row.property_tax_source == "manual"
    assert row.insurance == 1800
    assert row.insurance_source == "reported"


def test_apply_loan_statement_requires_address_confirmation(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="statement-address-gate",
        name="MISSION",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        zip_code="85258",
        property_type="single_family",
        usage_type="Rental",
    )
    db.add(prop)
    db.flush()
    loan = models.Loan(
        property_id=prop.id,
        lender_name="Better Mortgage Corporation",
        loan_type="FIXED",
        original_amount=491000,
        current_balance=491000,
        interest_rate=3.625,
        monthly_payment=2239.21,
        loan_term_years=30,
    )
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="statement.pdf",
        original_filename="Mortgage Statement.pdf",
        display_name="Mortgage Statement.pdf",
        file_type="pdf",
        doc_category="mortgage_statement",
        file_size=100,
        extracted_data=json.dumps({
            "current_balance": 482123.45,
            "statement_date": "2026-06-30",
        }),
    )
    db.add_all([loan, document])
    db.commit()

    response = client.post(
        f"/api/documents/{document.id}/apply-loan-statement",
        json={
            "property_id": prop.id,
            "loan_id": loan.id,
            "selected_loan_fields": ["current_balance", "statement_date"],
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "addressValidation" in detail
    assert detail["addressValidation"]["status"] == "document_address_missing"
