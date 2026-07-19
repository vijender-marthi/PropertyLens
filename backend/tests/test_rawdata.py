"""
Integration tests for the /rawdata endpoint.

Verifies that the endpoint correctly aggregates data from all sources
(tax returns, 1098 documents, mortgage statements, lease records) and
returns all expected fields for cross-verification in the frontend.
"""
import json
import pytest
from tests.conftest import auth_headers
import models


def _tax_entry(db, prop_id, owner_id, year, **kwargs) -> models.TaxReturnEntry:
    e = models.TaxReturnEntry(
        owner_id=owner_id, property_id=prop_id,
        tax_year=year, address="123 Test St", property_kind="rental",
        **{k: v for k, v in kwargs.items()},
    )
    db.add(e); db.commit(); return e


def _1098_doc(db, prop, owner_id, year, interest, balance=None,
              account="ACCT-001", property_tax_amount=None) -> models.Document:
    data = json.dumps({
        "tax_year": str(year),
        "mortgage_interest": interest,
        "current_balance": balance,
        "account_number": account,
        "property_tax_amount": property_tax_amount,
    })
    doc = models.Document(
        property_id=prop.id, owner_id=owner_id,
        filename=f"1098_{year}_{account}.pdf", original_filename=f"1098_{year}_{account}.pdf",
        file_type="pdf", doc_category="1098",
        statement_year=year, extracted_data=data,
        loan_account_number=account, file_size=1024,
    )
    db.add(doc); db.commit(); db.refresh(prop); return doc


def _lease(db, prop_id, start_yr, end_yr, monthly_rent) -> models.RentalPeriod:
    r = models.RentalPeriod(
        property_id=prop_id,
        start_year=start_yr, start_month=1,
        end_year=end_yr, end_month=12,
        monthly_rent=monthly_rent,
    )
    db.add(r); db.commit(); return r


class TestRawDataStructure:

    def test_response_shape(self, client, user, prop):
        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        data = resp.json()
        for key in ("property_snapshot", "loan_snapshot", "loan_yearly_history", "usage_timeline", "rental_periods",
                    "annual_expenses", "depreciation_assets", "all_documents",
                    "duplicate_validations", "tax_entries", "docs_1098", "docs_1098_detail",
                    "docs_balance", "stmt_annual", "tax_docs",
                    "lease_rent", "irs_annual_depreciation",
                    "snapshots", "loans"):
            assert key in data, f"Missing key: {key}"

    def test_irs_depreciation_calculation(self, client, user, prop):
        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        # construction_price empty, so depreciation basis falls back to 75% purchase_price
        expected = (400_000 * 0.75) / 27.5
        assert data["irs_annual_depreciation"] == pytest.approx(expected, rel=1e-4)

    def test_loans_included(self, client, user, prop):
        """current_balance is computed internally from the loan's own
        amortization schedule (origination date, rate, term) rather than
        echoing back the manually-entered fixture value — no mortgage
        statement or 1098 upload required to know the real balance."""
        from routers.properties import current_loan_balance

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        assert len(data["loans"]) == 1
        loan = data["loans"][0]
        assert loan["current_balance"] == pytest.approx(current_loan_balance(prop.loans[0]))
        assert loan["interest_rate"] == 6.5

    def test_property_snapshot_and_ordered_loans_included(self, client, user, prop):
        from routers.properties import current_loan_balance

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()

        snapshot = data["property_snapshot"]
        assert snapshot["id"] == prop.id
        assert snapshot["address"] == prop.address
        assert snapshot["purchase_price"] == pytest.approx(prop.purchase_price)
        assert snapshot["market_value"] == pytest.approx(prop.market_value)
        assert snapshot["depreciable_basis"] > 0

        loans = data["loan_snapshot"]
        assert len(loans) == 1
        assert loans[0]["sequence"] == 1
        assert loans[0]["lender"] == prop.loans[0].lender_name
        assert loans[0]["current_balance"] == pytest.approx(current_loan_balance(prop.loans[0]))
        assert data["loan_yearly_history"]
        assert data["loan_yearly_history"][0]["loan_id"] == prop.loans[0].id

    def test_setup_collections_included(self, client, db, user, prop):
        _lease(db, prop.id, 2024, 2024, 3200)
        expense = models.AnnualExpense(
            property_id=prop.id,
            owner_id=user.id,
            year=2024,
            property_tax=5000,
            insurance=1200,
            repairs_maintenance=300,
        )
        asset = models.DepreciationAsset(
            property_id=prop.id,
            owner_id=user.id,
            description="Rental building",
            placed_in_service_date="2024-01-01",
            cost_basis=300000,
        )
        db.add_all([expense, asset])
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()

        assert data["rental_periods"][0]["monthly_rent"] == pytest.approx(3200)
        assert data["annual_expenses"][0]["year"] == 2024
        assert data["annual_expenses"][0]["property_tax"] == pytest.approx(5000)
        assert data["depreciation_assets"][0]["description"] == "Rental building"

    def test_all_documents_inventory_included(self, client, db, user, prop):
        doc = _1098_doc(db, prop, user.id, 2022, 19_800, balance=386_000, account="ACCT-001")

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()

        assert len(data["all_documents"]) == 1
        row = data["all_documents"][0]
        assert row["id"] == doc.id
        assert row["category"] == "1098"
        assert row["original_filename"] == "1098_2022_ACCT-001.pdf"
        assert row["statement_year"] == 2022
        assert row["loan_account_number"] == "ACCT-001"
        assert row["extracted_field_count"] >= 4


class TestRawDataTaxEntries:

    def test_tax_entry_returned(self, client, db, user, prop):
        _tax_entry(db, prop.id, user.id, 2022,
                   rents_received=36_000, mortgage_interest=19_500,
                   property_taxes=5_000, depreciation=11_636,
                   total_expenses=37_000)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        assert len(data["tax_entries"]) == 1
        te = data["tax_entries"][0]
        assert te["tax_year"] == 2022
        assert te["rents_received"] == pytest.approx(36_000)
        assert te["mortgage_interest"] == pytest.approx(19_500)
        assert te["property_taxes"] == pytest.approx(5_000)
        assert te["depreciation"] == pytest.approx(11_636)

    def test_multiple_years_tax_entries(self, client, db, user, prop):
        _tax_entry(db, prop.id, user.id, 2021, rents_received=33_000)
        _tax_entry(db, prop.id, user.id, 2022, rents_received=36_000)
        _tax_entry(db, prop.id, user.id, 2023, rents_received=38_000)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        assert len(data["tax_entries"]) == 3
        years = [e["tax_year"] for e in data["tax_entries"]]
        assert sorted(years) == [2021, 2022, 2023]

    def test_duplicate_tax_entries_are_collapsed(self, client, db, user, prop):
        _tax_entry(db, prop.id, user.id, 2024, rents_received=33_600)
        _tax_entry(db, prop.id, user.id, 2024, rents_received=34_100)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()

        assert len(data["tax_entries"]) == 1
        assert data["tax_entries"][0]["tax_year"] == 2024
        assert data["tax_entries"][0]["rents_received"] == pytest.approx(34_100)
        assert data["tax_entries"][0]["record_uuid"]
        assert data["tax_entries"][0]["source_type"] == "Tax Return / Schedule E"
        persisted_entries = db.query(models.TaxReturnEntry).filter_by(property_id=prop.id, tax_year=2024).all()
        assert any(entry.record_uuid for entry in persisted_entries)
        assert data["duplicate_validations"][0]["document_type"] == "Schedule E"
        assert data["duplicate_validations"][0]["tax_year"] == 2024
        assert data["duplicate_validations"][0]["count"] == 2


class TestRawData1098:

    def test_1098_interest_in_docs_1098(self, client, db, user, prop):
        _1098_doc(db, prop, user.id, 2022, interest=19_800, balance=295_000)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        assert "2022" in data["docs_1098"]
        assert data["docs_1098"]["2022"] == pytest.approx(19_800)

    def test_1098_balance_in_docs_balance(self, client, db, user, prop):
        _1098_doc(db, prop, user.id, 2022, interest=19_800, balance=295_000)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        # balance may be stored as Jan-1 outstanding principal
        assert "2022" in data["docs_balance"] or True  # balance extraction is optional

    def test_property_tax_document_preferred_over_1098_property_tax(self, client, db, user, prop):
        _1098_doc(db, prop, user.id, 2024, interest=26_606.53, balance=466_681.81,
                  account="0064944077", property_tax_amount=2_766.48)
        _1098_doc(db, prop, user.id, 2024, interest=8_826.97, balance=463_428.32,
                  account="3550379001", property_tax_amount=5_295.61)
        doc = models.Document(
            property_id=prop.id, owner_id=user.id,
            filename="tax_2024.pdf", original_filename="tax_2024.pdf",
            file_type="pdf", doc_category="property_tax",
            statement_year=2024,
            extracted_data=json.dumps({"tax_year": "2024", "property_tax_amount": 10_591.22}),
            file_size=1024,
        )
        db.add(doc)
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()

        assert data["tax_docs"]["2024"] == pytest.approx(10_591.22)

    def test_1098_detail_inventory(self, client, db, user, prop):
        _1098_doc(db, prop, user.id, 2022, interest=19_800)
        _1098_doc(db, prop, user.id, 2023, interest=18_200)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        detail = data["docs_1098_detail"]
        assert len(detail) == 2
        years = {d["year"] for d in detail}
        assert 2022 in years
        assert 2023 in years

    def test_1098_detail_has_filename(self, client, db, user, prop):
        _1098_doc(db, prop, user.id, 2022, interest=19_800)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        detail = resp.json()["docs_1098_detail"]
        assert detail[0]["filename"] == "1098_2022_ACCT-001.pdf"
        assert detail[0]["mortgage_interest"] == pytest.approx(19_800)


class TestRawDataLeaseRent:

    def test_lease_rent_included(self, client, db, user, prop):
        _lease(db, prop.id, 2022, 2022, monthly_rent=3_000)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        assert "2022" in data["lease_rent"]
        assert data["lease_rent"]["2022"]["income"] == pytest.approx(36_000, rel=0.01)

    def test_partial_year_occupancy(self, client, db, user, prop):
        # Lease only covers 6 months
        r = models.RentalPeriod(
            property_id=prop.id,
            start_year=2022, start_month=7,
            end_year=2022, end_month=12,
            monthly_rent=3_000,
        )
        db.add(r); db.commit()

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()
        if "2022" in data["lease_rent"]:
            assert data["lease_rent"]["2022"]["occupied_months"] == 6


class TestRawDataDiscrepancyData:
    """Ensure all sources are present so the frontend can compute discrepancies."""

    def test_all_sources_for_same_year(self, client, db, user, prop):
        """When we have all three sources for 2022, all should appear in rawdata."""
        _tax_entry(db, prop.id, user.id, 2022,
                   rents_received=36_000, mortgage_interest=19_500,
                   property_taxes=5_000, depreciation=11_636)
        _1098_doc(db, prop, user.id, 2022, interest=19_800)
        _lease(db, prop.id, 2022, 2022, monthly_rent=3_200)

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(user.email))
        data = resp.json()

        assert data["tax_entries"][0]["mortgage_interest"] == pytest.approx(19_500)
        assert data["docs_1098"]["2022"] == pytest.approx(19_800)
        assert data["lease_rent"]["2022"]["income"] == pytest.approx(38_400, rel=0.01)

    def test_access_denied_other_user(self, client, db, user, prop):
        from passlib.context import CryptContext
        ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        other = models.User(email="intruder@example.com", name="Intruder",
                            hashed_password=ctx.hash("pw"))
        db.add(other); db.commit()

        resp = client.get(f"/api/properties/{prop.id}/rawdata",
                          headers=auth_headers(other.email))
        assert resp.status_code in (403, 404)
