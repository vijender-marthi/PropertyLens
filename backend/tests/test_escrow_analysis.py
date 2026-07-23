import models
from tests.conftest import auth_headers


def test_escrow_analysis_upload_saves_uuid_record_and_applies_backend_precedence(client, db, user, prop, monkeypatch):
    from routers import documents as documents_router

    loan = prop.loans[0]
    loan.account_number = "3550379001"
    prop.zip_code = "75001"
    existing = models.AnnualExpense(
        property_id=prop.id,
        owner_id=user.id,
        year=2026,
        property_tax=12000,
        insurance=0,
        property_tax_source="manual",
        insurance_source="manual",
        source_status="manual",
    )
    db.add(existing)
    db.commit()

    extracted = {
        "loan_number": "3550379001",
        "property_address": "123 Test St",
        "property_city": "Testville",
        "property_state": "TX",
        "property_zip": "75001",
        "statement_date": "2026-01-14",
        "effective_date": "2026-03-01",
        "expense_year": 2026,
        "current_escrow_payment": 1006.54,
        "new_escrow_payment": 956.73,
        "estimated_tax": 10591.22,
        "actual_tax": 10620.41,
        "estimated_insurance": 815.15,
        "actual_insurance": 831.15,
        "projected_tax": 10649.60,
        "projected_insurance": 831.15,
        "projected_total": 11480.75,
    }
    monkeypatch.setattr(
        documents_router,
        "parse_document",
        lambda _path, _category: ("escrow_analysis", extracted, "# Escrow Analysis"),
    )

    response = client.post(
        "/api/documents/upload/escrow-analysis",
        data={"property_id": prop.id},
        files={"file": ("escrow-2026.pdf", b"%PDF escrow", "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["escrowPayment"]["loanId"] == loan.id
    assert body["escrowPayment"]["newEscrowPayment"] == 956.73
    assert body["expenseApplication"]["preserved"] == []
    assert body["expenseApplication"]["applied"] == {"property_tax": 10649.6, "homeowners_insurance": 831.15}

    payment = db.query(models.EscrowPayment).one()
    assert len(payment.id) == 36
    assert payment.document_id is not None
    db.refresh(existing)
    assert existing.property_tax == 10649.6
    assert existing.insurance == 831.15
    assert existing.property_tax_source == "escrow-estimate"
    assert existing.insurance_source == "escrow-estimate"

    listing = client.get(
        f"/api/documents/property/{prop.id}/escrow-payments",
        headers=auth_headers(user.email),
    )
    assert listing.status_code == 200
    assert listing.json()[0]["documentName"] == "Annual Escrow Analysis — Jan 2026"

    repeated = client.post(
        "/api/documents/upload/escrow-analysis",
        data={"property_id": prop.id},
        files={"file": ("renamed-escrow-2026.pdf", b"%PDF escrow", "application/pdf")},
        headers=auth_headers(user.email),
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["status"] == "reused"
    assert db.query(models.Document).count() == 1
    assert db.query(models.EscrowPayment).count() == 1


def test_common_expense_upload_detects_property_tax_and_document_year(client, db, user, prop, monkeypatch):
    from routers import documents as documents_router

    prop.zip_code = "75001"
    db.commit()
    extracted = {
        "property_address": "123 Test St",
        "property_city": "Testville",
        "property_state": "TX",
        "property_zip": "75001",
        "tax_year": "2025",
        "statement_year": 2025,
        "taxes_paid": 6789.12,
        "property_tax_amount": 6789.12,
        "period_type": "yearly",
    }
    monkeypatch.setattr(
        documents_router,
        "parse_document",
        lambda _path, _category: ("property_tax", extracted, "# Property Tax"),
    )

    response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": ("tax.pdf", b"%PDF property tax", "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["detectedField"] == "property_tax"
    assert body["expenseYear"] == 2025
    assert body["expenseApplication"]["applied"] == ["property_tax"]
    row = db.query(models.AnnualExpense).filter_by(property_id=prop.id, year=2025).one()
    assert row.property_tax == 6789.12
    assert row.property_tax_source == "reported"


def test_common_expense_upload_uses_insurance_coverage_period_without_ui_year(client, db, user, prop, monkeypatch):
    from routers import documents as documents_router

    prop.zip_code = "75001"
    db.commit()
    extracted = {
        "property_address": "123 Test St",
        "property_city": "Testville",
        "property_state": "TX",
        "property_zip": "75001",
        "period_start": "2024-08-15",
        "period_end": "2025-08-15",
        "annual_insurance": 1840.25,
        "period_type": "yearly",
    }
    monkeypatch.setattr(
        documents_router,
        "parse_document",
        lambda _path, _category: ("insurance_declaration", extracted, "# Insurance"),
    )

    response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": ("insurance.pdf", b"%PDF insurance", "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["detectedField"] == "insurance"
    assert body["expenseYear"] == 2024
    row = db.query(models.AnnualExpense).filter_by(property_id=prop.id, year=2024).one()
    assert row.insurance == 1840.25


def test_common_expense_upload_uses_escrow_projection_period_over_statement_year(client, db, user, prop, monkeypatch):
    from routers import documents as documents_router

    loan = prop.loans[0]
    loan.account_number = "3550379001"
    prop.zip_code = "75001"
    db.commit()
    extracted = {
        "loan_number": "3550379001",
        "property_address": "123 Test St",
        "property_city": "Testville",
        "property_state": "TX",
        "property_zip": "75001",
        "statement_date": "2025-12-20",
        "statement_year": 2025,
        "projection_period_start": "2026-01-01",
        "projection_period_end": "2026-12-31",
        "new_escrow_payment": 950.00,
        "projected_tax": 9000.00,
        "projected_insurance": 1200.00,
    }
    monkeypatch.setattr(
        documents_router,
        "parse_document",
        lambda _path, _category: ("escrow_analysis", extracted, "# Escrow Analysis"),
    )

    response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": ("escrow.pdf", b"%PDF escrow period", "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["escrowPayment"]["expenseYear"] == 2026
    row = db.query(models.AnnualExpense).filter_by(property_id=prop.id, year=2026).one()
    assert row.property_tax == 9000.00
    assert row.insurance == 1200.00


def test_calendar_year_allocation_uses_actual_withdrawals_and_excludes_deposits(client, db, user, prop, monkeypatch):
    from routers import documents as documents_router

    prop.zip_code = "75001"
    prop.loans[0].account_number = "3550379001"
    db.commit()
    extracted = {
        "loan_number": "3550379001",
        "property_address": "123 Test St",
        "property_city": "Testville",
        "property_state": "TX",
        "property_zip": "75001",
        "statement_date": "2026-01-14",
        "statement_year": 2026,
        "effective_date": "2026-03-01",
        "expense_year": 2026,
        "history_period_start": "2025-03-01",
        "history_period_end": "2026-02-28",
        "projection_period_start": "2026-03-01",
        "projection_period_end": "2027-02-28",
        "current_escrow_payment": 1006.54,
        "new_escrow_payment": 956.73,
        "actual_tax": 10620.41,
        "actual_insurance": 831.15,
        "projected_tax": 10649.60,
        "projected_insurance": 831.15,
        "activities": [
            {"activity_date": "2025-03-01", "activity_type": "ESCROW_DEPOSIT", "source_description": "Deposit", "phase": "HISTORICAL", "value_status": "ACTUAL", "actual_deposit": 1006.54},
            {"activity_date": "2025-03-01", "activity_type": "PROPERTY_TAX", "source_description": "County tax withdrawal", "phase": "HISTORICAL", "value_status": "ACTUAL", "actual_disbursement": 5295.61},
            {"activity_date": "2025-05-01", "activity_type": "HOMEOWNERS_INSURANCE", "source_description": "Homeowners insurance withdrawal", "phase": "HISTORICAL", "value_status": "ACTUAL", "actual_disbursement": 831.15},
            {"activity_date": "2025-11-01", "activity_type": "PROPERTY_TAX", "source_description": "County tax withdrawal", "phase": "HISTORICAL", "value_status": "ACTUAL", "actual_disbursement": 5324.80},
            {"activity_date": "2026-02-01", "activity_type": "ESCROW_DEPOSIT", "source_description": "Deposit", "phase": "PARTIALLY_PROJECTED", "value_status": "NOT_REMITTED"},
            {"activity_date": "2026-03-01", "activity_type": "PROPERTY_TAX", "source_description": "County tax withdrawal", "phase": "PROJECTED", "value_status": "PROJECTED", "estimated_disbursement": 5324.80},
            {"activity_date": "2026-05-01", "activity_type": "HOMEOWNERS_INSURANCE", "source_description": "Homeowners insurance withdrawal", "phase": "PROJECTED", "value_status": "PROJECTED", "estimated_disbursement": 831.15},
            {"activity_date": "2026-11-01", "activity_type": "PROPERTY_TAX", "source_description": "County tax withdrawal", "phase": "PROJECTED", "value_status": "PROJECTED", "estimated_disbursement": 5324.80},
        ],
    }
    monkeypatch.setattr(documents_router, "parse_document", lambda *_: ("escrow_analysis", extracted, "# Escrow"))

    response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": ("escrow-2026.pdf", b"%PDF calendar allocation", "application/pdf")},
        headers=auth_headers(user.email),
    )
    assert response.status_code == 200, response.text

    view = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email)).json()
    row_2025 = next(row for row in view["rows"] if row["year"] == 2025)
    tax = row_2025["propertyTax"]["metric"]
    insurance = row_2025["insurance"]["metric"]
    assert row_2025["propertyTax"]["value"] == 10620.41
    assert row_2025["insurance"]["value"] == 831.15
    assert tax["status"] == "ACTUAL"
    assert tax["completeness"] == "COMPLETE"
    assert tax["allocationMethod"] == "TRANSACTION_DATE"
    assert tax["computation"] == "$5,295.61 + $5,324.80 = $10,620.41"
    assert tax["coverage"]["observedInstallments"] == 2
    assert insurance["value"] == 831.15
    assert all(item["value"] != 1006.54 for item in tax["inputs"])

    docs = client.get(f"/api/documents/property/{prop.id}", headers=auth_headers(user.email)).json()
    assert any(doc["doc_category"] == "escrow_analysis" for doc in docs)

    tax_bill = {
        "property_address": "123 Test St", "property_city": "Testville",
        "property_state": "TX", "property_zip": "75001", "tax_year": 2025,
        "statement_year": 2025, "property_tax_amount": 10800.00,
    }
    monkeypatch.setattr(documents_router, "parse_document", lambda *_: ("property_tax", tax_bill, "# Tax Bill"))
    tax_response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": ("tax-2025.pdf", b"%PDF supporting tax bill", "application/pdf")},
        headers=auth_headers(user.email),
    )
    assert tax_response.status_code == 200, tax_response.text
    refreshed = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email)).json()
    refreshed_tax = next(row for row in refreshed["rows"] if row["year"] == 2025)["propertyTax"]["metric"]
    assert refreshed_tax["value"] == 10620.41
    assert refreshed_tax["sourceType"] == "ESCROW_DISBURSEMENT"
    assert refreshed_tax["sourceLabel"] == "Escrow + Tax Bill"
    assert len(refreshed_tax["supportingDocumentIds"]) == 1
    assert refreshed_tax["discrepancies"][0]["difference"] == 179.59
