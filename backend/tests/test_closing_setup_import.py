from types import SimpleNamespace
from datetime import datetime, timedelta
import json

import models
from jose import jwt
from routers.documents import (
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
    assert any(field["targetKey"] == "market_value" for field in review["propertyFields"])
    assert any(field["targetKey"] == "escrow_amount" for field in review["loanFields"])


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
    assert selection["settlementTotal"] == 639491.23
    assert selection["selectedTotal"] == 625000
    assert [component["id"] for component in selection["components"]] == ["sale_price", "settlement_adjustment"]
    assert selection["components"][1]["selected"] is False
    purchase_field = next(field for field in review["propertyFields"] if field["targetKey"] == "purchase_price")
    current_value = next(field for field in review["propertyFields"] if field["targetKey"] == "market_value")
    closing_costs = next(field for field in review["propertyFields"] if field["targetKey"] == "closing_costs")
    assert purchase_field["value"] == 625000
    assert current_value["value"] == 639491.23
    assert closing_costs["value"] == 14491.23
    assert any(row["key"] == "settlement_total_amount" for row in review["settlementCalculations"])


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
    current_value = next(field for field in review["propertyFields"] if field["targetKey"] == "market_value")
    closing_costs = next(field for field in review["propertyFields"] if field["targetKey"] == "closing_costs")
    assert purchase_field["value"] == 625000
    assert current_value["value"] == 639491.23
    assert closing_costs["value"] == 14491.23
    assert any("Settlement document has closing costs" in warning for warning in review["warnings"])


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
        }),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    response = client.post(
        f"/api/documents/{document.id}/apply-setup-import",
        json={
            "property_id": prop.id,
            "selected_property_fields": ["purchase_price", "market_value", "closing_costs"],
            "selected_purchase_price_components": ["sale_price", "settlement_adjustment"],
            "selected_loan_fields": [],
            "confirm_address_match": False,
        },
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    db.refresh(prop)
    assert prop.purchase_price == 625000
    assert prop.market_value == 639491.23
    assert prop.market_value_source == "imported"
    assert prop.closing_costs == 14491.23


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
            "monthly_property_tax_escrow": 510,
            "monthly_insurance_escrow": 125.5,
            "monthly_mortgage_insurance": 0,
            "monthly_other_escrow": 64.5,
            "escrow_amount": 700,
            "statement_date": "2026-06-30",
        }),
    )

    review = _statement_setup_review_payload(document)

    assert review["document"]["id"] == 8
    assert review["statementDraft"]["current_balance_source"] == "mortgage_statement_reported_balance"
    assert review["statementDraft"]["current_balance_source_label"] == "Reported from mortgage statement"
    assert any(field["targetKey"] == "current_balance" for field in review["loanFields"])
    assert any(field["targetKey"] == "monthly_property_tax_escrow" for field in review["loanFields"])


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
            "monthly_mortgage_insurance": 0,
            "monthly_other_escrow": 64.5,
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
    updated = payload["draft"]["loans"][0]
    assert updated["current_balance"] == 482123.45
    assert updated["current_balance_source"] == "mortgage_statement_reported_balance"
    assert updated["current_balance_verified"] is True
    assert updated["monthly_property_tax_escrow"] == 510
    assert updated["monthly_insurance_escrow"] == 125.5
    assert updated["monthly_other_escrow"] == 64.5
    assert updated["escrow_amount"] == 700
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


def test_apply_loan_statement_creates_new_loan_when_account_differs(client, db, user):
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
    assert payload["loanId"] != old_loan.id
    assert payload["loanMapping"]["created"] is True
    db.refresh(old_loan)
    assert old_loan.account_number == "OLD-LOAN-1"
    new_loan = db.query(models.Loan).filter(
        models.Loan.property_id == prop.id,
        models.Loan.account_number == "3550379001",
    ).one()
    assert new_loan.current_balance == 438502.37
    assert new_loan.source_document_id == document.id
    assert new_loan.current_balance_source == "mortgage_statement_reported_balance"


def test_apply_1098_acquisition_date_starts_new_servicer_and_closes_previous(client, db, user):
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
    suggestion = payload["servicingTransfer"]["suggestions"][0]
    assert suggestion["previousLoanId"] == old_loan.id
    assert suggestion["currentLoanId"] == new_loan.id
    assert suggestion["proposedClosedDate"] == "2023-12-15"
    db.refresh(old_loan)
    db.refresh(new_loan)
    assert old_loan.status == "OPEN"
    assert old_loan.closed_date is None
    assert new_loan.servicer_start_date == "2024-01-15"
    assert new_loan.is_current_servicer is True


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


def test_osprey_1098_sequence_consolidates_to_two_valid_loan_accounts(client, db, user):
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
            "tax_year": "2024",
            "statement_year": 2024,
            "statement_date": "12/31/2024",
            "mortgage_interest": 8826.97,
            "current_balance": 463428.32,
            "origination_date": "05/26/2023",
            "mortgage_acquisition_date": "10/01/2024",
        }),
    )
    db.add_all([loancare_doc, rocket_doc])
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

    loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).order_by(models.Loan.account_number).all()
    assert [loan.account_number for loan in loans] == ["0064944077", "3550379001"]
    original = next(loan for loan in loans if loan.account_number == "0064944077")
    rocket = next(loan for loan in loans if loan.account_number == "3550379001")
    assert original.status == "OPEN"
    assert original.closed_date is None
    assert rocket.status == "OPEN"
    assert rocket.servicer_start_date == "2024-10-01"
    assert rocket.closed_date is None

    suggestions = client.get(
        f"/api/properties/{prop.id}/loans/servicing-transfer-suggestions",
        headers=auth_headers(user.email),
    )
    assert suggestions.status_code == 200
    suggestion = suggestions.json()["suggestions"][0]
    assert suggestion["previousLoanId"] == original.id
    assert suggestion["currentLoanId"] == rocket.id
    assert suggestion["proposedClosedDate"] == "2024-09-01"

    group_response = client.post(
        f"/api/properties/{prop.id}/loans/group-servicing-transfer",
        json={
            "previous_loan_id": original.id,
            "current_loan_id": rocket.id,
            "closed_date": suggestion["proposedClosedDate"],
        },
        headers=auth_headers(user.email),
    )
    assert group_response.status_code == 200
    db.refresh(original)
    db.refresh(rocket)
    assert original.status == "CLOSED"
    assert original.closed_date == "2024-09-01"
    assert original.servicer_end_date == "2024-09-01"
    assert rocket.status == "OPEN"
    assert rocket.servicer_start_date == "2024-10-01"
    assert rocket.closed_date is None
    assert original.replacement_loan_id == rocket.id
    assert original.loan_group_id == rocket.loan_group_id


def test_apply_new_account_document_infers_refinance_replacement(client, db, user):
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

    assert response.status_code == 200
    payload = response.json()
    new_loan = db.query(models.Loan).filter(
        models.Loan.property_id == prop.id,
        models.Loan.account_number == "NEW-LOAN-9",
    ).one()
    suggestion = payload["servicingTransfer"]["suggestions"][0]
    assert suggestion["type"] == "refinance"
    assert suggestion["proposedClosedDate"] == "2024-09-15"
    assert payload["loanId"] == new_loan.id
    db.refresh(old_loan)
    db.refresh(new_loan)
    assert old_loan.status == "OPEN"
    assert old_loan.closed_date is None
    group_response = client.post(
        f"/api/properties/{prop.id}/loans/group-servicing-transfer",
        json={
            "previous_loan_id": old_loan.id,
            "current_loan_id": new_loan.id,
            "closed_date": suggestion["proposedClosedDate"],
        },
        headers=auth_headers(user.email),
    )
    assert group_response.status_code == 200
    db.refresh(old_loan)
    db.refresh(new_loan)
    assert old_loan.status == "REFINANCED"
    assert old_loan.closed_date == "2024-09-15"
    assert old_loan.replacement_loan_id == new_loan.id
    assert new_loan.status == "OPEN"
    assert old_loan.loan_group_id == new_loan.loan_group_id


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
    assert confirmed.json()["loanId"] != selected_loan.id


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
            "selected_loan_fields": [
                "monthly_property_tax_escrow",
                "monthly_insurance_escrow",
                "statement_date",
            ],
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
