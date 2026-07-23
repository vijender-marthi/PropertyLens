import json

import models
from services.loan_lifecycle import (
    _group_transaction_documents,
    classify_document,
    resolve_property_lifecycle,
)


def _document(db, prop, user, filename, category, data):
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


def test_document_classification_assigns_backend_type_purpose_and_role(db, user, prop):
    cases = [
        ("purchase.pdf", "closing_statement", {
            "document_type": "CLOSING_DISCLOSURE", "transaction_purpose": "PURCHASE",
        }, ("CLOSING_DISCLOSURE", "PURCHASE", "LOAN_ORIGINATION_SOURCE")),
        ("settlement.pdf", "closing_statement", {
            "setup_import_role": "settlement_document", "transaction_purpose": "PURCHASE",
        }, ("SETTLEMENT_STATEMENT", "PURCHASE", "ACQUISITION_SOURCE")),
        ("refinance.pdf", "loan_disclosure", {
            "transaction_purpose": "REFINANCE",
        }, ("LOAN_ESTIMATE", "REFINANCE", "REFINANCE_SOURCE")),
        ("statement.pdf", "mortgage_statement", {}, (
            "MORTGAGE_STATEMENT", "PERIODIC_STATEMENT", "CURRENT_BALANCE_SOURCE",
        )),
        ("interest.pdf", "1098", {}, ("FORM_1098", "PERIODIC_STATEMENT", "SUPPORTING_SOURCE")),
        ("payoff.pdf", "payoff_statement", {}, ("PAYOFF_STATEMENT", "PAYOFF", "PAYOFF_SOURCE")),
    ]

    for filename, category, data, expected in cases:
        document = _document(db, prop, user, filename, category, data)
        classify_document(document)
        assert (document.document_type, document.transaction_purpose, document.transaction_role) == expected


def test_purchase_and_refinance_packages_group_separately(db, user, prop):
    common_address = {
        "property_address": "123 Test Street",
        "property_city": "Testville",
        "property_state": "TX",
        "property_zip": "75001",
        "borrower_1": "Test Borrower",
    }
    documents = [
        _document(db, prop, user, "purchase-cd.pdf", "closing_statement", {
            **common_address,
            "document_type": "CLOSING_DISCLOSURE",
            "transaction_purpose": "PURCHASE",
            "closing_date": "2019-04-11",
            "disbursement_date": "2019-04-12",
            "lender_name": "Bank of America, N.A.",
            "account_number": "289608533",
            "original_amount": 968000,
        }),
        _document(db, prop, user, "purchase-settlement.pdf", "closing_statement", {
            **common_address,
            "document_type": "SETTLEMENT_STATEMENT",
            "setup_import_role": "settlement_document",
            "transaction_purpose": "PURCHASE",
            "settlement_date": "2019-04-12",
            "lender_name": "Bank of America, N.A.",
            "original_amount": 968000,
        }),
        _document(db, prop, user, "refinance-cd.pdf", "closing_statement", {
            **common_address,
            "document_type": "CLOSING_DISCLOSURE",
            "transaction_purpose": "REFINANCE",
            "closing_date": "2021-07-30",
            "disbursement_date": "2021-08-04",
            "lender_name": "JPMorgan Chase Bank, N.A.",
            "original_amount": 933904,
        }),
        _document(db, prop, user, "refinance-settlement.pdf", "closing_statement", {
            **common_address,
            "document_type": "SETTLEMENT_STATEMENT",
            "setup_import_role": "settlement_document",
            "transaction_purpose": "REFINANCE",
            "settlement_date": "2021-07-30",
            "disbursement_date": "2021-08-04",
            "lender_name": "JPMorgan Chase Bank, N.A.",
            "original_amount": 933904,
            "prior_loan_payoff_amount": 935238.74,
        }),
        _document(db, prop, user, "statement.pdf", "mortgage_statement", {
            **common_address,
            "statement_date": "2026-06-10",
            "account_number": "1368496008",
            "current_balance": 830014.14,
        }),
    ]
    classified = [(document, classify_document(document)) for document in documents]

    groups = _group_transaction_documents(classified)

    assert [(purpose, [doc.original_filename for doc, _data in docs]) for _key, purpose, docs in groups] == [
        ("PURCHASE", ["purchase-cd.pdf", "purchase-settlement.pdf"]),
        ("REFINANCE", ["refinance-cd.pdf", "refinance-settlement.pdf"]),
    ]


def test_resolution_persists_idempotent_transaction_document_links(db, user, prop):
    prop.loans.clear()
    purchase_data = {
        "property_address": "123 Test St",
        "property_city": "Testville",
        "property_state": "TX",
        "transaction_purpose": "PURCHASE",
        "purchase_price": 400000,
        "original_amount": 320000,
        "lender_name": "Purchase Bank",
        "interest_rate": 6.5,
        "monthly_payment": 2023,
        "loan_term_years": 30,
    }
    _document(db, prop, user, "closing.pdf", "closing_statement", {
        **purchase_data,
        "document_type": "CLOSING_DISCLOSURE",
        "closing_date": "2020-01-01",
    })
    _document(db, prop, user, "settlement.pdf", "closing_statement", {
        **purchase_data,
        "document_type": "SETTLEMENT_STATEMENT",
        "setup_import_role": "settlement_document",
        "settlement_date": "2020-01-02",
    })

    first = resolve_property_lifecycle(db, prop)
    db.flush()
    second = resolve_property_lifecycle(db, prop)
    db.flush()

    transactions = db.query(models.PropertyTransaction).filter_by(property_id=prop.id).all()
    assert len(transactions) == 1
    assert transactions[0].resolution_key == "PURCHASE:2020-01-01"
    assert db.query(models.TransactionDocumentLink).filter_by(transaction_id=transactions[0].id).count() == 2
    assert first["documentGroups"][0]["transactionId"] == second["documentGroups"][0]["transactionId"]
    assert first["acquisition"]["disbursementDate"] == "2020-01-01"
    assert first["acquisition"]["disbursementDateSource"]["sourceDocument"] == "closing.pdf"
    assert first["acquisition"]["disbursementDateSource"]["selectionType"] == "INFERRED"


def test_conflicting_property_addresses_do_not_group(db, user, prop):
    first = _document(db, prop, user, "first.pdf", "closing_statement", {
        "document_type": "CLOSING_DISCLOSURE",
        "transaction_purpose": "PURCHASE",
        "property_address": "123 Test St",
        "closing_date": "2020-01-01",
    })
    second = _document(db, prop, user, "second.pdf", "closing_statement", {
        "document_type": "SETTLEMENT_STATEMENT",
        "transaction_purpose": "PURCHASE",
        "property_address": "999 Other Rd",
        "settlement_date": "2020-01-02",
    })

    groups = _group_transaction_documents([
        (first, classify_document(first)),
        (second, classify_document(second)),
    ])

    assert len(groups) == 2


def test_refinance_transaction_does_not_overwrite_acquisition_fields(db, user, prop):
    prop.loans.clear()
    purchase = _document(db, prop, user, "purchase.pdf", "closing_statement", {
        "document_type": "CLOSING_DISCLOSURE",
        "transaction_purpose": "PURCHASE",
        "property_address": "123 Test St",
        "closing_date": "2019-04-11",
        "disbursement_date": "2019-04-12",
        "purchase_price": 400000,
        "closing_costs": 8000,
        "down_payment": 80000,
        "cash_to_close": 76000,
        "original_amount": 320000,
        "interest_rate": 4.125,
        "monthly_payment": 1550,
        "lender_name": "Purchase Bank",
    })
    _document(db, prop, user, "refinance.pdf", "closing_statement", {
        "document_type": "CLOSING_DISCLOSURE",
        "transaction_purpose": "REFINANCE",
        "property_address": "123 Test St",
        "closing_date": "2021-07-30",
        "disbursement_date": "2021-08-04",
        "purchase_price": 525000,
        "closing_costs": 12000,
        "cash_to_close": 900,
        "original_amount": 300000,
        "interest_rate": 2.875,
        "monthly_payment": 1250,
        "lender_name": "Refinance Bank",
    })

    payload = resolve_property_lifecycle(db, prop)
    db.flush()

    assert payload["acquisition"]["selectedDocumentId"] == purchase.id
    assert prop.purchase_date == "2019-04-11"
    assert prop.purchase_price == 400000
    assert prop.closing_costs == 8000
    assert prop.down_payment == 80000
    assert prop.cash_to_close == 76000
