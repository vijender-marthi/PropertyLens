import hashlib
from pathlib import Path

import pytest

import models
from services.document_conversion import ConvertedDocument, MarkItDownConverter
from services.property_tax_parser import (
    classify_property_tax_document,
    parse_property_tax_document,
    validate_property_tax_document,
)
from tests.conftest import auth_headers


FIXTURE_DIR = Path("/Users/vijender/Development/Projects/RentalProps/OneDrive_1_6-15-2026")
FIXTURES = [
    FIXTURE_DIR / "3619 Palermo Way - Property Taxes Supp 1 - 2019.pdf",
    FIXTURE_DIR / "3619 Palermo Way - Property Taxes Supp 2 - 2019.pdf",
]
REGULAR_FIXTURES = [
    FIXTURE_DIR / "3619 Palermo Way - Property Taxes - 2024.pdf",
    FIXTURE_DIR / "3619 Palermo Way - Property Taxes - 2025.pdf",
]


@pytest.mark.parametrize(
    "index,expected",
    [
        (0, {
            "fiscal_year_label": "2018-2019",
            "tracer_number": "73693800",
            "supplemental_assessment": "259367.00",
            "total_amount_billed": "549.64",
            "installments": ["274.82", "274.82"],
        }),
        (1, {
            "fiscal_year_label": "2019-2020",
            "tracer_number": "73693900",
            "supplemental_assessment": "240359.00",
            "total_amount_billed": "2999.42",
            "installments": ["1499.71", "1499.71"],
        }),
    ],
)
def test_markitdown_palermo_supplemental_fixtures(index, expected):
    if not FIXTURES[index].exists():
        pytest.skip("Local Palermo property-tax fixture is unavailable")
    converted = MarkItDownConverter().convert(FIXTURES[index])
    parsed = parse_property_tax_document(converted)

    assert classify_property_tax_document(converted)["document_type"] == "supplemental_property_tax_bill"
    assert parsed["fiscal_year_label"] == expected["fiscal_year_label"]
    assert parsed["parcel_number"] == "985-63-57"
    assert parsed["tracer_number"] == expected["tracer_number"]
    assert parsed["property_address"] == "3619 PALERMO WAY, DUBLIN"
    assert parsed["event_type"] == "CHANGE_OF_OWNERSHIP"
    assert parsed["event_date"] == "2019-04-12"
    assert parsed["supplemental_assessment"] == expected["supplemental_assessment"]
    assert parsed["total_amount_billed"] == expected["total_amount_billed"]
    assert [row["amount"] for row in parsed["installments"]] == expected["installments"]
    assert parsed["assessment"]["total_new_value"] == "1210000.00"
    assert parsed["total_tax_rate_percent"] in {"1.2466", "1.2479"}
    assert parsed["payment_status"] == "paid"
    assert validate_property_tax_document(parsed)["valid"] is True


@pytest.mark.parametrize(
    "index,expected",
    [
        (0, {
            "fiscal_year_label": "2023-2024",
            "total": "17542.50",
            "ad_valorem": "16312.84",
            "fixed_charges": "1229.66",
            "installments": [
                ("2023-10-28", "8771.25"),
                ("2024-03-08", "8771.25"),
            ],
        }),
        (1, {
            "fiscal_year_label": "2024-2025",
            "total": "17725.26",
            "ad_valorem": "16464.38",
            "fixed_charges": "1260.88",
            "installments": [
                ("2024-11-19", "8862.63"),
                ("2024-12-27", "8862.63"),
            ],
        }),
    ],
)
def test_markitdown_palermo_regular_secured_tax_fixtures(index, expected):
    if not REGULAR_FIXTURES[index].exists():
        pytest.skip("Local Palermo regular property-tax fixture is unavailable")
    converted = MarkItDownConverter().convert(REGULAR_FIXTURES[index])
    classification = classify_property_tax_document(converted)
    parsed = parse_property_tax_document(converted)

    assert classification["supported"] is True
    assert classification["document_type"] == "property_tax_bill"
    assert parsed["fiscal_year_label"] == expected["fiscal_year_label"]
    assert parsed["property_address"] == "3619 PALERMO WAY, DUBLIN"
    assert parsed["total_amount_billed"] == expected["total"]
    assert parsed["total_ad_valorem_tax"] == expected["ad_valorem"]
    assert parsed["total_fixed_charges"] == expected["fixed_charges"]
    assert [
        (row["payment_date"], row["amount"]) for row in parsed["installments"]
    ] == expected["installments"]
    assert validate_property_tax_document(parsed)["valid"] is True


def test_regular_tax_bills_populate_calendar_year_expenses_by_payment_date(
    client, db, user, tmp_path, monkeypatch
):
    if not all(path.exists() for path in REGULAR_FIXTURES):
        pytest.skip("Local Palermo regular property-tax fixtures are unavailable")
    from routers import documents as documents_router

    monkeypatch.setattr(documents_router, "UPLOAD_DIR", tmp_path)
    prop = models.Property(
        owner_id=user.id,
        property_uid="palermo-regular-tax-fixture",
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
        usage_type="Primary",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)

    for fixture in REGULAR_FIXTURES:
        response = client.post(
            "/api/documents/upload/expense-document",
            data={"property_id": prop.id},
            files={"file": (fixture.name, fixture.read_bytes(), "application/pdf")},
            headers=auth_headers(user.email),
        )
        assert response.status_code == 200, response.text
        assert response.json()["annualExpenseApplied"] is True
        assert response.json()["detectedField"] == "property_tax"
        assert response.json()["annualExpenses"]
        assert response.json()["annualExpense"]["property_tax"] > 0

    rows = {
        row.year: row for row in db.query(models.AnnualExpense).filter_by(property_id=prop.id).all()
    }
    assert rows[2023].property_tax == pytest.approx(8771.25)
    assert rows[2024].property_tax == pytest.approx(26496.51)

    metrics = {
        row.year: row for row in db.query(models.AnnualExpenseMetric).filter_by(
            property_id=prop.id,
            expense_type="PROPERTY_TAX",
        ).all()
    }
    assert metrics[2023].allocation_method == "TRANSACTION_DATE"
    assert metrics[2024].allocation_method == "TRANSACTION_DATE"


def test_expense_upload_reuses_documents_tab_tax_file_and_returns_applied_rows(
    client, db, user, tmp_path, monkeypatch
):
    if not REGULAR_FIXTURES[0].exists():
        pytest.skip("Local Palermo regular property-tax fixture is unavailable")
    from routers import documents as documents_router

    monkeypatch.setattr(documents_router, "UPLOAD_DIR", tmp_path)
    prop = models.Property(
        owner_id=user.id,
        property_uid="palermo-existing-doc-tax-fixture",
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
        usage_type="Primary",
    )
    source = REGULAR_FIXTURES[0].read_bytes()
    existing = models.Document(
        owner_id=user.id,
        property_id=prop.id,
        filename="discarded-source.pdf",
        original_filename=REGULAR_FIXTURES[0].name,
        file_type="pdf",
        doc_category="property_tax",
        content_hash=hashlib.sha256(source).hexdigest(),
        extracted_data="{}",
    )
    db.add(prop)
    db.flush()
    existing.property_id = prop.id
    db.add(existing)
    db.commit()
    existing_id = existing.id

    response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": (REGULAR_FIXTURES[0].name, source, "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["annualExpenseApplied"] is True
    assert body["annualExpenses"]
    assert body["annualExpense"]["property_tax"] == pytest.approx(8771.25)
    assert body["document"]["id"] == existing_id
    assert db.query(models.Document).count() == 1
    assert db.query(models.PropertyTaxRecord).count() == 1


def test_portal_banner_does_not_override_authoritative_fiscal_period():
    converted = ConvertedDocument(
        markdown="""
2025-26 2nd Installment Taxes Was Due 04/10/2026
Supplemental Property Tax Statement
For Fiscal Year Beginning July 1, 2018 and Ending June 30, 2019
Parcel Number: 985-63-57
Tracer Number: 73693800
Location of Property:
3619 PALERMO WAY, DUBLIN
This supplemental property tax bill is IN ADDITION TO CHANGE OF APRIL OWNERSHIP 12, 2019
First Installment Second Installment Total Amount Billed
PAID DEC 8, 2019 PAID DEC 8, 2019
$549.64
$274.82 $274.82
Tax-Rate Breakdown
| TOTAL AD VALOREM TAX (AV TAX) | | 1.2466% | | | $549.64 |
Supplemental Value Computation Worksheet
LAND $363,000.00 $285,190.00 $77,810.00
IMPROVEMENTS $847,000.00 $665,443.00 $181,557.00
TOTAL $1,210,000.00 $950,633.00 $259,367.00
Tax Computation Worksheet
GROSS ASSESSMENT $259,367.00 1.2466% $3,233.26 17.00% $549.64
TOTAL AMOUNT DUE $549.64
Messages
""",
        text="""
2025-26 2nd Installment Taxes Was Due 04/10/2026
Supplemental Property Tax Statement
For Fiscal Year Beginning July 1, 2018 and Ending June 30, 2019
Parcel Number: 985-63-57
Tracer Number: 73693800
Location of Property:
3619 PALERMO WAY, DUBLIN
This supplemental property tax bill is IN ADDITION TO CHANGE OF APRIL OWNERSHIP 12, 2019
First Installment Second Installment Total Amount Billed
PAID DEC 8, 2019 PAID DEC 8, 2019
$549.64
$274.82 $274.82
Tax-Rate Breakdown
| TOTAL AD VALOREM TAX (AV TAX) | | 1.2466% | | | $549.64 |
Supplemental Value Computation Worksheet
LAND $363,000.00 $285,190.00 $77,810.00
IMPROVEMENTS $847,000.00 $665,443.00 $181,557.00
TOTAL $1,210,000.00 $950,633.00 $259,367.00
Tax Computation Worksheet
GROSS ASSESSMENT $259,367.00 1.2466% $3,233.26 17.00% $549.64
TOTAL AMOUNT DUE $549.64
Messages
""",
        page_count=1,
        filename="fixture.pdf",
        converter="Microsoft MarkItDown",
        converter_version="test",
    )
    parsed = parse_property_tax_document(converted)
    assert parsed["fiscal_year_label"] == "2018-2019"
    assert parsed["statement_year"] == 2018


def test_related_supplemental_bills_are_not_semantic_duplicates():
    if not all(path.exists() for path in FIXTURES):
        pytest.skip("Local Palermo property-tax fixtures are unavailable")
    parsed = [parse_property_tax_document(MarkItDownConverter().convert(path)) for path in FIXTURES]
    assert parsed[0]["related_event_key"] == parsed[1]["related_event_key"]
    assert parsed[0]["identity_key"] != parsed[1]["identity_key"]


def test_property_tax_api_persists_both_bills_without_annual_expense(
    client, db, user, tmp_path, monkeypatch
):
    if not all(path.exists() for path in FIXTURES):
        pytest.skip("Local Palermo property-tax fixtures are unavailable")
    from routers import documents as documents_router

    monkeypatch.setattr(documents_router, "UPLOAD_DIR", tmp_path)
    prop = models.Property(
        owner_id=user.id,
        property_uid="palermo-tax-fixture",
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
        usage_type="Primary",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)

    for fixture in FIXTURES:
        response = client.post(
            f"/api/properties/{prop.id}/documents/property-tax",
            files={"file": (fixture.name, fixture.read_bytes(), "application/pdf")},
            headers=auth_headers(user.email),
        )
        assert response.status_code == 200, response.text
        assert response.json()["annualExpenseApplied"] is False
        assert response.json()["propertyMatchStatus"] == "MATCHED"

    response = client.get(
        f"/api/properties/{prop.id}/property-taxes",
        headers=auth_headers(user.email),
    )
    assert response.status_code == 200
    assert [row["fiscalYear"] for row in response.json()["items"]] == ["2018-2019", "2019-2020"]
    assert db.query(models.PropertyTaxRecord).count() == 2
    assert db.query(models.Document).count() == 2
    assert db.query(models.AnnualExpense).count() == 0

    duplicate = client.post(
        f"/api/properties/{prop.id}/documents/property-tax",
        files={"file": (FIXTURES[0].name, FIXTURES[0].read_bytes(), "application/pdf")},
        headers=auth_headers(user.email),
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicateStatus"] == "EXACT"
    assert db.query(models.PropertyTaxRecord).count() == 2


def test_malformed_installment_table_returns_warning_not_invented_values():
    converted = ConvertedDocument(
        markdown="""
Supplemental Property Tax Statement
For Fiscal Year Beginning July 1, 2018 and Ending June 30, 2019
Parcel Number: 985-63-57
Tracer Number: 73693800
Location of Property:
3619 PALERMO WAY, DUBLIN
This supplemental property tax bill is IN ADDITION TO the regular bill.
Tax-Rate Breakdown
Supplemental Value Computation Worksheet
TOTAL $1,210,000.00 $950,633.00 $259,367.00
Tax Computation Worksheet
GROSS ASSESSMENT $259,367.00 1.2466% $3,233.26 17.00% $549.64
TOTAL AMOUNT DUE $549.64
Messages
""",
        text="""
Supplemental Property Tax Statement
For Fiscal Year Beginning July 1, 2018 and Ending June 30, 2019
Parcel Number: 985-63-57
Tracer Number: 73693800
Location of Property:
3619 PALERMO WAY, DUBLIN
This supplemental property tax bill is IN ADDITION TO the regular bill.
Tax-Rate Breakdown
Supplemental Value Computation Worksheet
TOTAL $1,210,000.00 $950,633.00 $259,367.00
Tax Computation Worksheet
GROSS ASSESSMENT $259,367.00 1.2466% $3,233.26 17.00% $549.64
TOTAL AMOUNT DUE $549.64
Messages
""",
        page_count=1,
        filename="malformed.pdf",
        converter="Microsoft MarkItDown",
        converter_version="test",
    )
    parsed = parse_property_tax_document(converted)
    assert parsed["installments"] == []
    assert parsed["extraction"]["field_confidences"]["installments"] == 0.0
    assert "Installment table could not be reconstructed" in parsed["extraction"]["warnings"]


def test_property_mismatch_is_persisted_for_review_without_attachment(
    client, db, user, tmp_path, monkeypatch
):
    if not FIXTURES[0].exists():
        pytest.skip("Local Palermo property-tax fixture is unavailable")
    from routers import documents as documents_router

    monkeypatch.setattr(documents_router, "UPLOAD_DIR", tmp_path)
    other = models.Property(
        owner_id=user.id,
        property_uid="wrong-property",
        name="Other",
        address="100 Different Road",
        city="Oakland",
        state="CA",
        zip_code="94612",
    )
    db.add(other)
    db.commit()
    db.refresh(other)

    response = client.post(
        f"/api/properties/{other.id}/documents/property-tax",
        files={"file": (FIXTURES[0].name, FIXTURES[0].read_bytes(), "application/pdf")},
        headers=auth_headers(user.email),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["requires_review"] is True
    assert body["propertyId"] is None
    assert body["candidatePropertyId"] == other.id
    assert body["propertyMatchStatus"] == "NEEDS_REVIEW"

    record = db.query(models.PropertyTaxRecord).one()
    document = db.query(models.Document).one()
    assert record.property_id is None
    assert document.property_id is None
    assert db.query(models.Document).count() == 1
    assert db.query(models.AnnualExpense).count() == 0


def test_common_expenses_upload_uses_structured_supplemental_pipeline(
    client, db, user, tmp_path, monkeypatch
):
    if not FIXTURES[0].exists():
        pytest.skip("Local Palermo property-tax fixture is unavailable")
    from routers import documents as documents_router

    monkeypatch.setattr(documents_router, "UPLOAD_DIR", tmp_path)
    prop = models.Property(
        owner_id=user.id,
        property_uid="palermo-common-upload",
        name="Palermo",
        address="3619 Palermo Way",
        city="Dublin",
        state="CA",
        zip_code="94568",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)
    response = client.post(
        "/api/documents/upload/expense-document",
        data={"property_id": prop.id},
        files={"file": (FIXTURES[0].name, FIXTURES[0].read_bytes(), "application/pdf")},
        headers=auth_headers(user.email),
    )
    assert response.status_code == 200, response.text
    assert response.json()["detectedField"] == "supplemental_property_tax"
    assert db.query(models.PropertyTaxRecord).count() == 1
    assert db.query(models.AnnualExpense).count() == 0
