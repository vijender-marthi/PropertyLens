import json
import uuid
from datetime import datetime, timedelta

import models
from jose import jwt
from reprocess_property_lifecycle import reprocess_property
from services.loan_lifecycle import resolve_property_lifecycle


def auth_headers(email):
    token = jwt.encode(
        {"sub": email, "exp": datetime.utcnow() + timedelta(hours=1)},
        "propertylens-secret-key-change-in-production",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _document(db, prop, user, name, category, data):
    document = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename=name,
        original_filename=name,
        display_name=name,
        file_type="pdf",
        doc_category=category,
        extracted_data=json.dumps(data),
        loan_account_number=data.get("account_number"),
        statement_year=data.get("statement_year"),
    )
    db.add(document)
    db.flush()
    return document


def _palermo(db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid=str(uuid.uuid4()),
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
        usage_type="Primary",
    )
    db.add(prop)
    db.flush()
    purchase_common = {
        "transaction_purpose": "PURCHASE",
        "property_address": "3619 Palermo Way",
        "property_city": "Dublin",
        "property_state": "CA",
        "property_zip": "94568",
        "purchase_price": 1_210_000,
        "original_amount": 968_000,
        "lender_name": "Bank of America, N.A.",
    }
    _document(db, prop, user, "purchase-closing.pdf", "closing_statement", {
        **purchase_common,
        "document_type": "CLOSING_DISCLOSURE",
        "closing_date": "2019-04-11",
        "disbursement_date": "2019-04-12",
        "interest_rate": 4.125,
        "monthly_payment": 4691.41,
        "loan_term_years": 30,
        "closing_costs": 10629.87,
        "down_payment": 242000,
        "cash_to_close": 216849.07,
        "total_due_from_borrower": 1221149.07,
        "account_number": "289608533",
    })
    _document(db, prop, user, "purchase-settlement.pdf", "closing_statement", {
        **purchase_common,
        "document_type": "SETTLEMENT_STATEMENT",
        "closing_date": "2019-04-12",
        "disbursement_date": "2019-04-12",
        "cash_to_close": 216849.07,
        "settlement_debit_total": 1223978.95,
        "settlement_credit_total": 1223978.95,
    })
    refinance_common = {
        "transaction_purpose": "REFINANCE",
        "closing_date": "2021-07-30",
        "disbursement_date": "2021-08-04",
        "original_amount": 933904,
        "lender_name": "JPMorgan Chase Bank, N.A.",
    }
    _document(db, prop, user, "refinance-closing.pdf", "closing_statement", {
        **refinance_common,
        "document_type": "CLOSING_DISCLOSURE",
        "interest_rate": 2.875,
        "monthly_payment": 3874.70,
        "loan_term_years": 30,
    })
    _document(db, prop, user, "refinance-settlement.pdf", "closing_statement", {
        **refinance_common,
        "document_type": "SETTLEMENT_STATEMENT",
        "prior_loan_payoff_lender": "Bank of America, N.A.",
        "prior_loan_payoff_amount": 935238.74,
        "cash_to_close": 918.70,
    })
    for statement_date, balance in (("2025-12-10", 841236.60), ("2026-06-10", 830014.14)):
        _document(db, prop, user, f"statement-{statement_date}.pdf", "mortgage_statement", {
            "document_type": "MORTGAGE_STATEMENT",
            "transaction_purpose": "PERIODIC_STATEMENT",
            "statement_date": statement_date,
            "account_number": "1368496008",
            "original_amount": 933904,
            "current_balance": balance,
            "interest_rate": 2.875,
            "monthly_payment": 3874.70,
            "lender_name": "JPMorgan Chase Bank, N.A.",
        })
    for lender, amount, rate in (
        ("Bank of America, N.A.", 968000, 4.125),
        ("Bank of America, N.A.", 0, 0),
        ("JPMorgan Chase Bank, N.A.", 933904, 2.875),
        ("BANK OF AMERICA, N.A.", 968000, 4.125),
    ):
        db.add(models.Loan(
            property_id=prop.id,
            lender_name=lender,
            original_amount=amount,
            current_balance=amount,
            interest_rate=rate,
            monthly_payment=0,
            loan_term_years=30,
            status="REFINANCED" if amount == 0 else "OPEN",
        ))
    db.commit()
    db.refresh(prop)
    return prop


def test_resolver_groups_documents_into_two_real_loans(db, user):
    prop = _palermo(db, user)

    result = resolve_property_lifecycle(db, prop)
    db.commit()

    assert result["acquisition"]["purchasePrice"]["value"] == 1_210_000
    assert result["acquisition"]["closingDate"] == "2019-04-11"
    assert result["acquisition"]["disbursementDate"] == "2019-04-12"
    assert result["acquisition"]["borrowerPaidClosingCosts"]["value"] == 10629.87
    assert result["acquisition"]["downPayment"]["value"] == 242000
    assert result["acquisition"]["cashToClose"]["value"] == 216849.07
    assert result["acquisition"]["totalDueFromBorrower"]["value"] == 1221149.07
    assert result["acquisition"]["settlementDebitTotal"]["value"] == 1223978.95
    assert result["acquisition"]["settlementCreditTotal"]["value"] == 1223978.95
    assert result["acquisition"]["settlementAccountingTotal"]["value"] == 1223978.95
    assert result["acquisition"]["settlementAccountingTotal"]["sourceField"] == "settlement_debit_total"
    assert result["acquisition"]["selectionType"] == "VERIFIED_PURCHASE"
    acquisition_sources = {
        item["key"]: item for item in result["acquisition"]["selectedFields"]
    }
    assert len(acquisition_sources) == len(result["acquisition"]["selectedFields"])
    assert acquisition_sources["purchase_price"]["sourceDocument"] == "purchase-closing.pdf"
    assert acquisition_sources["purchase_price"]["page"] == 1
    assert acquisition_sources["borrower_paid_closing_costs"]["sourceDocument"] == "purchase-closing.pdf"
    assert acquisition_sources["borrower_paid_closing_costs"]["page"] == 2
    assert acquisition_sources["cash_to_close"]["sourceDocument"] == "purchase-closing.pdf"
    assert acquisition_sources["cash_to_close"]["page"] == 3
    assert acquisition_sources["settlement_debit_total"]["sourceDocument"] == "purchase-settlement.pdf"
    assert acquisition_sources["settlement_credit_total"]["sourceDocument"] == "purchase-settlement.pdf"
    assert acquisition_sources["settlement_accounting_total"]["sourceDocument"] == "purchase-settlement.pdf"
    assert acquisition_sources["closing_date"]["sourceDocument"] == "purchase-closing.pdf"
    assert acquisition_sources["disbursement_date"]["sourceDocument"] == "purchase-closing.pdf"
    assert all(item["selectionType"] == "EXACT" for item in acquisition_sources.values())
    assert all(
        {"field", "value", "documentId", "sourceLabel", "page", "confidence", "selectionType"}
        <= item.keys()
        for item in acquisition_sources.values()
    )
    selected_document = db.get(models.Document, result["acquisition"]["selectedDocumentId"])
    assert selected_document.original_filename == "purchase-closing.pdf"
    assert prop.purchase_date == "2019-04-11"
    assert prop.purchase_price == 1_210_000
    assert prop.closing_costs == 13978.95
    assert prop.down_payment == 242000
    assert prop.cash_to_close == 216849.07
    assert prop.total_due_from_borrower == 1221149.07
    assert prop.settlement_debit_total == 1223978.95
    assert prop.settlement_credit_total == 1223978.95
    assert prop.settlement_total_amount == 1223978.95
    assert result["acquisition"]["closingAndTitleCosts"] == {
        "value": 13978.95,
        "display": "$13,978.95",
        "closingCosts": {"value": 10629.87, "display": "$10,629.87"},
        "titleCosts": {"value": 3349.08, "display": "$3,349.08"},
        "sourceType": "CALCULATED",
        "explanation": "Settlement accounting total minus purchase price. The reported closing-cost amount is shown separately; the remainder is title costs.",
    }
    assert len(result["loans"]) == 2
    boa, chase = result["loans"]
    assert boa["status"] == "CLOSED"
    assert boa["originationDate"] == "2019-04-12"
    assert boa["closedDate"] == "2021-08-04"
    assert boa["currentBalance"] == 935238.74
    assert chase["status"] == "OPEN"
    assert chase["originalAmount"] == 933904
    assert chase["currentBalance"] == 830014.14
    assert chase["balanceAsOf"] == "2026-06-10"
    assert chase["refinancedFromLoanId"] == boa["loanId"]
    assert boa["refinancedIntoLoanId"] == chase["loanId"]
    assert boa["sourceSummary"] == {"label": "Closing + Settlement", "documentCount": 2}
    assert chase["sourceSummary"] == {"label": "Latest statement · Jun 2026", "documentCount": 4}
    assert [section["label"] for section in chase["sourceDetails"]["sections"]] == [
        "Origination", "Prior-loan payoff", "Current status",
    ]
    assert {document["name"] for document in chase["sourceDetails"]["documents"]} == {
        "refinance-closing.pdf", "refinance-settlement.pdf",
        "statement-2025-12-10.pdf", "statement-2026-06-10.pdf",
    }
    assert all(
        field["documentId"] is not None
        for section in chase["sourceDetails"]["sections"]
        for field in section["fields"]
    )
    boa_sources = {item["key"]: item for item in boa["selectedFields"]}
    chase_sources = {item["key"]: item for item in chase["selectedFields"]}
    assert len(boa_sources) == len(boa["selectedFields"])
    assert len(chase_sources) == len(chase["selectedFields"])
    assert boa_sources["currentBalance"]["sourceDocument"] == "refinance-settlement.pdf"
    assert boa_sources["balanceAsOf"]["sourceDocument"] == "refinance-settlement.pdf"
    assert boa_sources["closedDate"]["sourceDocument"] == "refinance-settlement.pdf"
    assert boa_sources["closedDate"]["selectionType"] == "INFERRED"
    assert chase_sources["originalAmount"]["sourceDocument"] == "refinance-closing.pdf"
    assert chase_sources["interestRate"]["sourceDocument"] == "refinance-closing.pdf"
    assert chase_sources["monthlyPrincipalAndInterest"]["sourceDocument"] == "refinance-closing.pdf"
    assert chase_sources["priorLoanPayoffBalance"]["sourceDocument"] == "refinance-settlement.pdf"
    assert chase_sources["priorLoanPayoffLender"]["sourceDocument"] == "refinance-settlement.pdf"
    assert chase_sources["currentBalance"]["sourceDocument"] == "statement-2026-06-10.pdf"
    assert chase_sources["balanceAsOf"]["sourceDocument"] == "statement-2026-06-10.pdf"
    assert chase_sources["currentBalance"]["selectionType"] == "EXACT"
    assert chase_sources["currentBalance"]["sourceType"] == "REPORTED"
    assert all(
        {"field", "value", "documentId", "sourceLabel", "page", "confidence", "selectionType"}
        <= item.keys()
        for item in chase_sources.values()
    )
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 2
    snapshots = db.query(models.LoanBalanceSnapshot).filter_by(loan_id=chase["loanId"]).order_by(
        models.LoanBalanceSnapshot.as_of_date
    ).all()
    assert [(row.as_of_date, row.balance) for row in snapshots] == [
        ("2025-12-10", 841236.60),
        ("2026-06-10", 830014.14),
    ]
    canonical_loans = db.query(models.Loan).filter_by(property_id=prop.id).all()
    assert all((loan.original_amount or 0) > 0 for loan in canonical_loans)
    assert all((loan.interest_rate or 0) > 0 for loan in canonical_loans)
    assert all(
        not loan.closed_date or not loan.origination_date or loan.closed_date >= loan.origination_date
        for loan in canonical_loans
    )
    assert db.query(models.LoanResolutionAlias).filter_by(property_id=prop.id).count() == 2
    transaction_links = db.query(models.TransactionLoanLink).join(
        models.PropertyTransaction,
        models.TransactionLoanLink.transaction_id == models.PropertyTransaction.id,
    ).filter(models.PropertyTransaction.property_id == prop.id).all()
    assert len(transaction_links) == 2
    linked = {
        link.transaction.purpose: link.loan_id
        for link in transaction_links
    }
    assert linked == {
        "PURCHASE": boa["loanId"],
        "REFINANCE": chase["loanId"],
    }


def test_debt_api_renders_two_resolved_accounts_and_refinance_chain(client, db, user):
    prop = _palermo(db, user)
    resolve_property_lifecycle(db, prop)
    db.commit()

    response = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

    assert response.status_code == 200
    payload = response.json()
    assert payload["portfolio"]["loanCount"] == 1
    assert len(payload["loans"]) == 2
    boa, chase = payload["loans"]
    assert boa["lender"] == "Bank of America, N.A."
    assert boa["purpose"] == "PURCHASE"
    assert boa["status"] == "CLOSED"
    assert boa["statusLabel"] == "Closed"
    assert boa["closureReasonLabel"] == "Refinanced"
    assert boa["displayBalance"] == 935238.74
    assert boa["balanceLabel"] == "Final / payoff balance"
    assert chase["lender"] == "JPMorgan Chase Bank, N.A."
    assert chase["purpose"] == "REFINANCE"
    assert chase["status"] == "OPEN"
    assert chase["displayBalance"] == 830014.14
    assert chase["balanceLabel"] == "Current balance"
    assert len(payload["refinanceChains"]) == 1
    chain = payload["refinanceChains"][0]["nodes"]
    assert [node["loanId"] for node in chain] == [boa["loan_id"], chase["loan_id"]]
    assert [node["status"] for node in chain] == ["CLOSED", "OPEN"]


def test_resolver_is_idempotent(db, user):
    prop = _palermo(db, user)
    first = resolve_property_lifecycle(db, prop)
    db.commit()
    second = resolve_property_lifecycle(db, prop)
    db.commit()

    assert [loan["loanId"] for loan in first["loans"]] == [loan["loanId"] for loan in second["loans"]]
    assert db.query(models.PropertyTransaction).filter_by(property_id=prop.id).count() == 2
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 2
    assert db.query(models.TransactionLoanLink).join(
        models.PropertyTransaction,
        models.TransactionLoanLink.transaction_id == models.PropertyTransaction.id,
    ).filter(models.PropertyTransaction.property_id == prop.id).count() == 2


def test_reprocessing_job_is_idempotent_and_preserves_document_ids(db, user):
    prop = _palermo(db, user)
    document_ids = sorted(document.id for document in prop.documents)

    first = reprocess_property(db, prop, reparse_documents=False)
    db.commit()
    first_loan_ids = [loan["loanId"] for loan in first["loans"]]

    second = reprocess_property(db, prop, reparse_documents=False)
    db.commit()

    assert first["resolvedLoanCount"] == 2
    assert [loan["loanId"] for loan in second["loans"]] == first_loan_ids
    assert sorted(document.id for document in prop.documents) == document_ids
    assert db.query(models.PropertyTransaction).filter_by(property_id=prop.id).count() == 2
    assert db.query(models.Loan).filter_by(property_id=prop.id).count() == 2


def test_lifecycle_api_returns_backend_resolved_sources(client, db, user):
    prop = _palermo(db, user)
    resolve_property_lifecycle(db, prop)
    db.commit()

    response = client.get(f"/api/documents/property/{prop.id}/lifecycle", headers=auth_headers(user.email))

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["loans"]) == 2
    assert payload["documentGroups"][0]["usageLabel"] == "Selected for Property Setup"
    assert payload["loans"][1]["sourceSummary"]["documentCount"] == 4
    assert payload["loans"][0]["sourceSummary"]["label"] == "Closing + Settlement"
    assert payload["loans"][1]["sourceSummary"]["label"] == "Latest statement · Jun 2026"


def test_setup_delink_preserves_document_values_and_excludes_future_resolution(client, db, user):
    prop = _palermo(db, user)
    resolved = resolve_property_lifecycle(db, prop)
    db.commit()
    purchase_closing = db.query(models.Document).filter_by(
        property_id=prop.id,
        original_filename="purchase-closing.pdf",
    ).one()
    accepted_purchase_date = prop.purchase_date
    accepted_purchase_price = prop.purchase_price
    accepted_loan_ids = [loan["loanId"] for loan in resolved["loans"]]

    response = client.post(
        f"/api/documents/{purchase_closing.id}/delink-setup",
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "delinked"
    assert payload["documentPreserved"] is True
    db.expire_all()
    assert db.get(models.Document, purchase_closing.id) is not None
    assert "SETUP_DELINKED" in (db.get(models.Document, purchase_closing.id).module_tags or "")
    assert db.query(models.TransactionDocumentLink).filter_by(document_id=purchase_closing.id).count() == 0
    assert db.query(models.LoanDocumentLink).filter_by(document_id=purchase_closing.id).count() == 0
    db.refresh(prop)
    assert prop.purchase_date == accepted_purchase_date
    assert prop.purchase_price == accepted_purchase_price
    assert [loan["loanId"] for loan in payload["draft"]["loans"]] == accepted_loan_ids
    assert all(
        document["documentId"] != purchase_closing.id
        for group in payload["draft"]["documentGroups"]
        for document in group["documents"]
    )

    resolve_response = client.post(
        f"/api/documents/property/{prop.id}/resolve-lifecycle",
        headers=auth_headers(user.email),
    )

    assert resolve_response.status_code == 200
    db.expire_all()
    assert db.get(models.Document, purchase_closing.id) is not None
    db.refresh(prop)
    assert prop.purchase_date == accepted_purchase_date
    assert prop.purchase_price == accepted_purchase_price
    assert all(
        document["documentId"] != purchase_closing.id
        for group in resolve_response.json()["documentGroups"]
        for document in group["documents"]
    )
