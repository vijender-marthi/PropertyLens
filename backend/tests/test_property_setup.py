from datetime import date
import json

import models
from routers.properties import _build_setup_status, resolve_annual_operating_expenses
from services.property_setup_defaults import apply_rental_available_from_default
from tests.conftest import auth_headers


def test_setup_status_excludes_hidden_financing_for_cash_property(client, db, user, prop):
    prop.loans.clear()
    prop.name = "Cash Property"
    prop.address = "1 Cash Way"
    prop.purchase_date = "2024-01-01"
    prop.purchase_price = 500000
    prop.market_value = 550000
    db.commit()

    resp = client.get(
        f"/api/properties/{prop.id}/setup-status",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    financing = next(section for section in data["sections"] if section["id"] == "financing")
    assert financing["visible"] is False
    assert data["totalRequired"] == sum(
        section["totalRequired"] for section in data["sections"] if section["visible"]
    )


def test_consolidated_property_setup_1098_links_source_document_to_loan(client, db, user, prop):
    loan = prop.loans[0]
    loan.account_number = None
    loan.origination_date = "2021-05-27"
    loan.original_amount = 491_000
    db.commit()
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="better_1098_2025.pdf",
        original_filename="better_1098_2025.pdf",
        file_type="pdf",
        doc_category="1098",
        statement_year=2025,
        loan_account_number="1590237047",
        extracted_data=json.dumps({
            "tax_year": "2025",
            "statement_year": 2025,
            "account_number": "1590237047",
            "lender_name": "Better Mortgage Corporation",
            "mortgage_interest": 16_337,
            "current_balance": 444_949,
            "origination_date": "2021-05-27",
        }),
        file_size=1024,
    )
    db.add(document)
    db.commit()

    response = client.post(
        "/api/documents/loan-documents/apply-consolidated",
        json={"property_id": prop.id, "document_ids": [document.id]},
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    db.refresh(loan)
    assert loan.account_number == "1590237047"
    assert loan.source_document_id == document.id
    assert loan.source_type == "consolidated_loan_documents"


def test_setup_status_marks_existing_financing_partial(prop):
    data = _build_setup_status(prop)

    financing = next(section for section in data["sections"] if section["id"] == "financing")
    assert financing["visible"] is True
    assert financing["status"] in {"partial", "complete", "needs_review"}
    assert financing["totalRequired"] > 0


def test_property_system_timestamps_are_exposed_and_not_editable(client, user, prop):
    response = client.get(
        f"/api/properties/{prop.id}",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["createdAt"]
    original_created = data["createdAt"]
    payload = {**data, "name": "Timestamp Check", "createdAt": "1999-01-01T00:00:00", "updatedAt": "1999-01-01T00:00:00"}

    update = client.put(
        f"/api/properties/{prop.id}",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert update.status_code == 200
    updated = update.json()
    assert updated["name"] == "Timestamp Check"
    assert updated["createdAt"] == original_created
    assert updated["createdAt"] != "1999-01-01T00:00:00"
    assert updated["updatedAt"] != "1999-01-01T00:00:00"


def test_rental_acquisition_defaults_rental_available_from_purchase_date(client, db, user, prop):
    payload = _finalize_payload(prop)
    payload["property"]["original_residency_status"] = "Rental"
    payload["property"]["purchase_date"] = "2023-05-24"
    payload["property"]["rental_start_date"] = None
    payload["property"]["rental_start_date_origin"] = None

    response = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "saved"
    db.refresh(prop)
    assert prop.rental_start_date == "2023-05-24"
    assert prop.rental_start_date_origin == "auto_purchase_date"


def test_primary_acquisition_does_not_default_rental_available_from(client, user, prop):
    payload = _finalize_payload(prop)
    payload["property"]["original_residency_status"] = "Primary Residence"
    payload["property"]["purchase_date"] = "2023-05-24"
    payload["property"]["rental_start_date"] = None
    payload["property"]["rental_start_date_origin"] = None

    response = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "validation_failed"
    assert data["fieldErrors"]["property.rental_start_date"] == "Rental available from is required."


def test_rental_available_from_origin_preserves_manual_and_updates_auto():
    data = {
        "original_residency_status": "Rental",
        "purchase_date": "2024-02-01",
        "rental_start_date": "2024-01-01",
        "rental_start_date_origin": "auto_purchase_date",
    }
    existing = type("Existing", (), {
        "purchase_date": "2024-01-01",
        "rental_start_date": "2024-01-01",
        "rental_start_date_origin": "auto_purchase_date",
    })()

    apply_rental_available_from_default(data, existing)

    assert data["rental_start_date"] == "2024-02-01"

    manual = {
        "original_residency_status": "Rental",
        "purchase_date": "2024-02-01",
        "rental_start_date": "2024-03-01",
        "rental_start_date_origin": "user_entered",
    }
    apply_rental_available_from_default(manual, existing)
    assert manual["rental_start_date"] == "2024-03-01"


def test_clearing_purchase_date_clears_only_untouched_auto_rental_start():
    data = {
        "original_residency_status": "Rental",
        "purchase_date": None,
        "rental_start_date": "2024-01-01",
        "rental_start_date_origin": "auto_purchase_date",
    }

    apply_rental_available_from_default(data)

    assert data["rental_start_date"] is None
    assert data["rental_start_date_origin"] is None


def test_rental_available_from_cannot_precede_purchase_date(client, user, prop):
    payload = _finalize_payload(prop)
    payload["property"]["purchase_date"] = "2024-02-01"
    payload["property"]["rental_start_date"] = "2024-01-01"
    payload["property"]["rental_start_date_origin"] = "user_entered"

    response = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    data = response.json()
    assert data["status"] == "validation_failed"
    assert data["fieldErrors"]["property.rental_start_date"] == "Rental availability cannot begin before the property was purchased."


def test_preview_uses_backend_metrics_and_does_not_persist(client, user, prop):
    before_rent = prop.monthly_rent
    resp = client.post(
        f"/api/properties/{prop.id}/preview",
        json={"section": "rental", "draftChanges": {"monthly_rent": before_rent + 500}},
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "available"
    assert data["source"] == "backend_property_metrics_preview"
    assert data["metrics"]["monthlyCashFlow"]["display"].endswith("/mo")

    persisted = client.get(
        f"/api/properties/{prop.id}",
        headers=auth_headers(user.email),
    ).json()
    assert persisted["monthly_rent"] == before_rent


def test_servicing_transfer_suggestion_groups_same_origination_loans(client, db, user, prop):
    prop.loans.clear()
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage Company, Ltd., LP",
        account_number="230577464",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=468750,
        interest_rate=7.625,
        monthly_payment=3318,
        loan_term_years=30,
        origination_date="2023-05-24",
        statement_date="2024-12-31",
    )
    new_loan = models.Loan(
        property_id=prop.id,
        lender_name="Rocket",
        account_number="3550379001",
        loan_type="FIXED",
        status="OPEN",
        original_amount=468750,
        current_balance=438502,
        interest_rate=7.625,
        monthly_payment=4275,
        loan_term_years=30,
        origination_date="2023-05-24",
        statement_date="2026-06-01",
    )
    db.add_all([old_loan, new_loan])
    db.commit()

    suggestions = client.get(
        f"/api/properties/{prop.id}/loans/servicing-transfer-suggestions",
        headers=auth_headers(user.email),
    )

    assert suggestions.status_code == 200
    data = suggestions.json()
    assert len(data["suggestions"]) == 1
    suggestion = data["suggestions"][0]
    assert suggestion["previousLoanLabel"] == "DHI Mortgage Company, Ltd., LP"
    assert suggestion["currentLoanLabel"] == "Rocket"
    assert suggestion["proposedClosedDate"] == "2024-12-31"
    assert suggestion["proposedClosedDateSource"] == "previous_latest_statement"

    grouped = client.post(
        f"/api/properties/{prop.id}/loans/group-servicing-transfer",
        json={
            "previous_loan_id": suggestion["previousLoanId"],
            "current_loan_id": suggestion["currentLoanId"],
            "closed_date": suggestion["proposedClosedDate"],
        },
        headers=auth_headers(user.email),
    )

    assert grouped.status_code == 200
    result = grouped.json()
    assert result["loanGroupId"]
    assert result["suggestions"] == []
    assert len(result["loanGroups"]) == 1
    assert result["loanGroups"][0]["currentLender"] == "Rocket"
    assert result["loanGroups"][0]["memberLoanIds"] == [old_loan.id, new_loan.id]

    db.refresh(old_loan)
    db.refresh(new_loan)
    assert old_loan.status == "CLOSED"
    assert old_loan.closed_date == "2024-12-31"
    assert old_loan.closure_reason == "Servicing transfer"
    assert old_loan.is_current_servicer is False
    assert old_loan.replacement_loan_id == new_loan.id
    assert new_loan.status == "OPEN"
    assert new_loan.closed_date is None
    assert new_loan.is_current_servicer is True
    assert old_loan.loan_group_id == new_loan.loan_group_id


def test_grouped_servicing_transfer_closes_previous_one_month_before_next_acquisition_date(client, db, user, prop):
    prop.loans.clear()
    group_id = "loan-chain-osprey"
    old_loan = models.Loan(
        property_id=prop.id,
        lender_name="DHI Mortgage Company, Ltd., LP",
        account_number="230577464",
        loan_type="FIXED",
        status="CLOSED",
        closed_date="2026-06-11",
        closure_reason="Servicing transfer",
        loan_group_id=group_id,
        servicer_sequence=1,
        servicer_start_date="2023-05-24",
        servicer_end_date="2026-06-11",
        is_current_servicer=False,
        original_amount=468750,
        current_balance=468750,
        interest_rate=7.625,
        monthly_payment=3318,
        loan_term_years=30,
        origination_date="2023-05-24",
    )
    current_loan = models.Loan(
        property_id=prop.id,
        lender_name="Rocket",
        account_number="3550379001",
        loan_type="FIXED",
        status="OPEN",
        loan_group_id=group_id,
        servicer_sequence=2,
        servicer_start_date="2024-10-01",
        is_current_servicer=True,
        original_amount=438502,
        current_balance=438502,
        interest_rate=7.625,
        monthly_payment=4275,
        loan_term_years=30,
        origination_date="2023-05-26",
    )
    db.add_all([old_loan, current_loan])
    db.commit()

    payload = {
        "lender_name": current_loan.lender_name,
        "loan_type": current_loan.loan_type,
        "status": "OPEN",
        "loan_group_id": group_id,
        "servicer_sequence": 2,
        "servicer_start_date": "2024-10-01",
        "is_current_servicer": True,
        "original_amount": current_loan.original_amount,
        "current_balance": current_loan.current_balance,
        "interest_rate": current_loan.interest_rate,
        "monthly_payment": current_loan.monthly_payment,
        "loan_term_years": current_loan.loan_term_years,
        "origination_date": current_loan.origination_date,
        "account_number": current_loan.account_number,
    }
    response = client.put(
        f"/api/properties/{prop.id}/loans/{current_loan.id}",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    db.refresh(old_loan)
    db.refresh(current_loan)
    assert old_loan.closed_date == "2024-09-01"
    assert old_loan.servicer_end_date == "2024-09-01"
    assert old_loan.replacement_loan_id == current_loan.id
    assert current_loan.closed_date is None


def _finalize_payload(prop, **overrides):
    current_year = date.today().year
    payload = {
        "property": {
            "name": prop.name,
            "address": prop.address,
            "city": prop.city,
            "state": prop.state,
            "zip_code": prop.zip_code,
            "property_type": prop.property_type,
            "usage_type": prop.usage_type,
            "original_residency_status": prop.original_residency_status or prop.usage_type,
            "purchase_date": prop.purchase_date,
            "purchase_price": prop.purchase_price,
            "market_value": prop.market_value,
            "rental_start_date": prop.rental_start_date or prop.purchase_date,
            "property_tax": prop.property_tax,
            "insurance": prop.insurance,
        },
        "loans": [
            {
                "id": loan.id,
                "lender_name": loan.lender_name,
                "loan_type": loan.loan_type or "FIXED",
                "status": loan.status or "OPEN",
                "closed_date": getattr(loan, "closed_date", None),
                "closure_reason": getattr(loan, "closure_reason", None),
                "replacement_loan_id": getattr(loan, "replacement_loan_id", None),
                "original_amount": loan.original_amount,
                "current_balance": loan.current_balance,
                "interest_rate": loan.interest_rate,
                "monthly_payment": loan.monthly_payment,
                "estimated_total_monthly_payment": loan.estimated_total_monthly_payment or loan.monthly_payment,
                "extra_monthly_payment": loan.extra_monthly_payment or 0,
                "loan_term_years": loan.loan_term_years,
                "origination_date": loan.origination_date,
                "escrow_amount": loan.escrow_amount or 0,
                "escrow_included": bool(loan.escrow_included),
            }
            for loan in prop.loans
        ],
        "annual_expenses": [
            {
                "year": current_year,
                "property_tax": 5200,
                "insurance": 1800,
                "hoa": 0,
                "repairs_maintenance": 1200,
                "property_management": 0,
                "utilities": 600,
                "vacancy_allowance": 900,
                "capex_reserve": 1500,
                "other": 250,
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_finalize_setup_rejects_blocking_errors_without_redirect(client, user, prop):
    payload = _finalize_payload(prop)
    payload["loans"][0]["interest_rate"] = 0

    resp = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "validation_failed"
    assert data["summary"]["errorCount"] >= 1
    assert "loans[0].interest_rate" in data["fieldErrors"]
    assert data["sectionErrors"]["loans"][0]["field"] == "interest_rate"
    assert "redirectTo" not in data


def test_open_loan_does_not_require_closed_date(client, user, prop):
    payload = _finalize_payload(prop, annual_expenses=[])
    payload["loans"][0]["status"] = "OPEN"
    payload["loans"][0]["closed_date"] = None

    resp = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "saved", resp.json()


def test_closed_loan_requires_closed_date(client, user, prop):
    payload = _finalize_payload(prop)
    payload["loans"][0]["status"] = "REFINANCED"
    payload["loans"][0]["closed_date"] = None

    resp = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    data = resp.json()
    assert data["status"] == "validation_failed"
    assert data["fieldErrors"]["loans[0].closed_date"].startswith("Closed date is required")


def test_closed_date_before_origination_fails(client, user, prop):
    payload = _finalize_payload(prop)
    payload["loans"][0]["status"] = "PAID_OFF"
    payload["loans"][0]["origination_date"] = "2024-01-01"
    payload["loans"][0]["closed_date"] = "2023-12-31"

    resp = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    data = resp.json()
    assert data["status"] == "validation_failed"
    assert data["fieldErrors"]["loans[0].closed_date"] == "Closed date must be on or after origination date."


def test_finalize_setup_saves_existing_property_and_returns_redirect(client, db, user, prop):
    payload = _finalize_payload(prop)
    payload["property"]["name"] = "Final Mission"
    payload["loans"][0]["escrow_included"] = True
    payload["loans"][0]["monthly_property_tax_escrow"] = 300
    payload["loans"][0]["monthly_insurance_escrow"] = 100
    payload["loans"][0]["escrow_amount"] = 400
    payload["loans"][0]["estimated_total_monthly_payment"] = payload["loans"][0]["monthly_payment"] + 400

    resp = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "saved"
    assert data["propertyId"] == prop.id
    assert data["redirectTo"] == "/properties"
    db.refresh(prop)
    assert prop.name == "Final Mission"
    assert prop.loans[0].escrow_included is True
    assert prop.loans[0].monthly_property_tax_escrow == 300


def test_closed_servicer_transfer_does_not_require_current_escrow(client, db, user, prop):
    old_loan = prop.loans[0]
    old_loan.status = "CLOSED"
    old_loan.closed_date = "2024-09-01"
    old_loan.origination_date = "2023-05-24"
    old_loan.closure_reason = "Servicing transfer"
    old_loan.transfer_reason = "Servicing transfer"
    old_loan.is_current_servicer = False
    old_loan.escrow_included = True
    old_loan.escrow_amount = 0
    current_loan = models.Loan(
        property_id=prop.id,
        lender_name="Rocket",
        account_number="3550379001",
        status="OPEN",
        is_current_servicer=True,
        original_amount=468750,
        current_balance=438502,
        interest_rate=7.625,
        monthly_payment=4275,
        loan_term_years=30,
        origination_date="2023-05-24",
        escrow_included=True,
        escrow_amount=1913.46,
        monthly_property_tax_escrow=887.47,
        monthly_insurance_escrow=186.26,
        monthly_other_escrow=839.73,
        estimated_total_monthly_payment=6188.46,
    )
    db.add(current_loan)
    db.commit()
    payload = _finalize_payload(prop)
    for loan in payload["loans"]:
        if loan["id"] == old_loan.id:
            loan["escrow_included"] = True
            loan["escrow_amount"] = 0
        if loan["id"] == current_loan.id:
            loan["escrow_included"] = True
            loan["escrow_amount"] = 1913.46
            loan["monthly_property_tax_escrow"] = 887.47
            loan["monthly_insurance_escrow"] = 186.26
            loan["monthly_other_escrow"] = 839.73

    resp = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "saved", resp.json()


def test_annual_expenses_save_by_year_and_drive_current_year_completion(client, db, user, prop):
    current_year = date.today().year
    payload = {
        "year": current_year,
        "property_tax": 6000,
        "insurance": 2100,
        "hoa": 3600,
        "repairs_maintenance": 2400,
        "property_management": 1200,
        "utilities": 900,
        "vacancy_allowance": 1000,
        "capex_reserve": 1800,
        "other": 300,
    }

    resp = client.put(
        f"/api/properties/{prop.id}/annual-expenses/{current_year}",
        json=payload,
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    saved = resp.json()
    assert saved["entered"] is True
    assert saved["total"] == 19300

    status = client.get(
        f"/api/properties/{prop.id}/setup-status",
        headers=auth_headers(user.email),
    ).json()
    expenses = next(section for section in status["sections"] if section["id"] == "expenses")
    assert expenses["status"] == "complete"

    db.refresh(prop)
    resolved = resolve_annual_operating_expenses(prop, current_year)
    assert resolved["value"] == 19300
    assert resolved["source"] == f"annual_expense_{current_year}"


def test_empty_and_prior_year_expenses_do_not_block_setup_save(client, user, prop):
    current_year = date.today().year
    prior_year = current_year - 1
    resp = client.put(
        f"/api/properties/{prop.id}/annual-expenses/{prior_year}",
        json={
            "year": prior_year,
            "property_tax": 5000,
            "insurance": 1500,
        },
        headers=auth_headers(user.email),
    )
    assert resp.status_code == 200

    finalize_payload = _finalize_payload(prop, annual_expenses=[{"year": prior_year, "property_tax": 5000, "insurance": 1500}])
    final = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=finalize_payload,
        headers=auth_headers(user.email),
    )

    assert final.status_code == 200
    data = final.json()
    assert data["status"] == "saved"

    empty_finalize_payload = _finalize_payload(prop, annual_expenses=[])
    empty_final = client.post(
        f"/api/properties/{prop.id}/setup-finalize",
        json=empty_finalize_payload,
        headers=auth_headers(user.email),
    )
    assert empty_final.status_code == 200
    assert empty_final.json()["status"] == "saved"
