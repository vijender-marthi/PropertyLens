"""
Integration tests for Schedule E (tax return) data priority logic.

Verifies that:
  1. TaxReturnEntry.mortgage_interest overrides statement-based interest
     when no Form 1098 document is present.
  2. TaxReturnEntry.total_expenses (minus interest and depreciation) is used
     as operating_expenses when available, replacing static field estimates.
  3. A Form 1098 document still takes priority over Schedule E interest.
  4. Years with no tax return fall back to the static field / statement values.

Tests call the /api/properties/{id}/lifetime endpoint and inspect the
returned `yearly` array.
"""
import json
import pytest
from tests.conftest import auth_headers
import models


# ---------------------------------------------------------------------------
# Helpers to create DB fixtures
# ---------------------------------------------------------------------------

def _add_tax_entry(db, prop_id: int, owner_id: int, year: int, *,
                   mortgage_interest=0.0, property_taxes=0.0,
                   depreciation=0.0, total_expenses=0.0,
                   rents_received=0.0) -> models.TaxReturnEntry:
    entry = models.TaxReturnEntry(
        owner_id=owner_id,
        property_id=prop_id,
        tax_year=year,
        address="123 Test St",
        property_kind="rental",
        mortgage_interest=mortgage_interest,
        property_taxes=property_taxes,
        depreciation=depreciation,
        total_expenses=total_expenses,
        rents_received=rents_received,
    )
    db.add(entry)
    db.commit()
    return entry


def _add_1098_doc(db, prop: models.Property, owner_id: int, year: int,
                  mortgage_interest: float) -> models.Document:
    """Create a minimal Form 1098 document with extracted mortgage interest."""
    data = json.dumps({
        "tax_year": str(year),
        "mortgage_interest": mortgage_interest,
        "current_balance": None,
        "account_number": "TEST-ACCT-001",
    })
    doc = models.Document(
        property_id=prop.id,
        owner_id=owner_id,
        filename=f"1098_{year}.pdf",
        original_filename=f"1098_{year}.pdf",
        file_type="pdf",
        doc_category="1098",
        statement_year=year,
        extracted_data=data,
        loan_account_number="TEST-ACCT-001",
        file_size=1024,
    )
    db.add(doc)
    db.commit()
    db.refresh(prop)  # refresh so prop.documents is up-to-date
    return doc


def _get_year(yearly: list, year: int) -> dict:
    return next((y for y in yearly if y["year"] == year), None)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestScheduleEInterestPriority:
    """Schedule E mortgage_interest should override statement-based estimates."""

    def test_schedule_e_interest_used_when_no_1098(self, client, db, user, prop):
        """Without a 1098 document, mortgage_interest from TaxReturnEntry wins."""
        _add_tax_entry(
            db, prop.id, user.id, 2022,
            rents_received=36_000.0,
            mortgage_interest=21_500.0,   # actual figure from Schedule E
            total_expenses=0.0,           # no full opex override
        )

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200, resp.text
        data = resp.json()

        row = _get_year(data["yearly"], 2022)
        assert row is not None, "Year 2022 missing from yearly data"
        assert row["interest_paid"] == pytest.approx(21_500.0), (
            f"Expected Schedule E interest 21 500, got {row['interest_paid']}"
        )

    def test_1098_document_overrides_schedule_e(self, client, db, user, prop):
        """A Form 1098 document must take priority over TaxReturnEntry interest."""
        _add_tax_entry(
            db, prop.id, user.id, 2022,
            rents_received=36_000.0,
            mortgage_interest=21_500.0,   # Schedule E says 21 500
        )
        _add_1098_doc(db, prop, user.id, 2022, mortgage_interest=19_800.0)  # 1098 says 19 800

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        row = _get_year(resp.json()["yearly"], 2022)
        assert row["interest_paid"] == pytest.approx(19_800.0), (
            f"Expected 1098 interest 19 800 to win, got {row['interest_paid']}"
        )

    def test_no_tax_entry_falls_back_to_loan_estimate(self, client, db, user, prop):
        """Without any tax entry or 1098, interest comes from loan.interest_due."""
        # Add a rent period so the year appears
        db.add(models.RentalPeriod(
            property_id=prop.id,
            start_year=2021, start_month=1,
            end_year=2021,   end_month=12,
            monthly_rent=3_000.0,
        ))
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        row = _get_year(resp.json()["yearly"], 2021)
        if row is None:
            pytest.skip("Year 2021 not generated — need purchase_date before 2021")
        # interest_due on the loan is 1 625/mo; annualized = 19 500
        assert row["interest_paid"] == pytest.approx(1_625.0 * 12, rel=0.05)


class TestScheduleEExpensesPriority:
    """Schedule E total_expenses (minus interest+depreciation) should
    replace the static field estimate for operating_expenses."""

    def test_schedule_e_opex_replaces_static_fields(self, client, db, user, prop):
        """
        Static fields: property_tax=6000/yr, insurance=1200/yr, maintenance=0
        → static opex = 7200

        Schedule E total_expenses=10000, mortgage_interest=6000, depreciation=1000
        → opex from Schedule E = 10000 - 6000 - 1000 = 3000

        The API should return 3000, not 7200.
        """
        _add_tax_entry(
            db, prop.id, user.id, 2022,
            rents_received=36_000.0,
            total_expenses=10_000.0,
            mortgage_interest=6_000.0,
            depreciation=1_000.0,
            property_taxes=500.0,
        )

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        row = _get_year(resp.json()["yearly"], 2022)
        assert row is not None
        # Schedule E opex = 10000 - 6000 - 1000 = 3000
        assert row["operating_expenses"] == pytest.approx(3_000.0, abs=10), (
            f"Expected Schedule E opex 3000, got {row['operating_expenses']}"
        )

    def test_static_fields_used_when_no_total_expenses(self, client, db, user, prop):
        """When total_expenses is 0/None, static field calculation applies."""
        # Add a tax entry but with no total_expenses
        _add_tax_entry(
            db, prop.id, user.id, 2022,
            rents_received=36_000.0,
            mortgage_interest=6_000.0,
            # total_expenses = 0 → no override
        )

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        row = _get_year(resp.json()["yearly"], 2022)
        assert row is not None
        # Static opex = property_tax 6000 + insurance 1200 = 7200 (no other expenses on fixture)
        assert row["operating_expenses"] == pytest.approx(7_200.0, abs=50), (
            f"Expected static opex ~7200, got {row['operating_expenses']}"
        )

    def test_schedule_e_opex_never_negative(self, client, db, user, prop):
        """If interest+depreciation exceed total_expenses, opex is clamped to 0."""
        _add_tax_entry(
            db, prop.id, user.id, 2022,
            rents_received=36_000.0,
            total_expenses=5_000.0,
            mortgage_interest=4_500.0,
            depreciation=1_000.0,   # total > total_expenses
        )

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        row = _get_year(resp.json()["yearly"], 2022)
        assert row["operating_expenses"] >= 0, (
            f"Operating expenses should not be negative: {row['operating_expenses']}"
        )


class TestScheduleERentPriority:
    """Existing behavior: rents_received from TaxReturnEntry overrides lease records."""

    def test_tax_return_rent_takes_priority(self, client, db, user, prop):
        # Lease says $3 000/mo but Schedule E says $31 000 for the year
        db.add(models.RentalPeriod(
            property_id=prop.id,
            start_year=2022, start_month=1,
            end_year=2022,   end_month=12,
            monthly_rent=3_000.0,
        ))
        _add_tax_entry(
            db, prop.id, user.id, 2022,
            rents_received=31_000.0,
        )
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        row = _get_year(resp.json()["yearly"], 2022)
        assert row["rental_income"] == pytest.approx(31_000.0)
        assert row["rent_source"] == "tax_return"


class TestLifetimeSummaryStructure:
    """Smoke tests for the lifetime summary response shape."""

    def test_lifetime_keys_present(self, client, user, prop):
        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert "lifetime" in data
        assert "yearly" in data
        lt = data["lifetime"]
        for key in ("total_rental_income", "total_operating_expenses",
                    "total_interest_paid", "total_principal_paid",
                      "total_cash_flow", "total_taxable_income",
                      "total_depreciation", "equity", "market_value",
                      "current_loan_balance"):
            assert key in lt, f"Missing lifetime key: {key}"

    def test_zero_balance_without_documents_does_not_create_fake_paydown(self, client, db, user, prop):
        for loan in prop.loans:
            loan.current_balance = 0.0
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        lt = resp.json()["lifetime"]
        assert lt["total_principal_paid"] == 0.0
        assert lt["principal_paid_source"] == "missing_balance_evidence"
        assert lt["principal_paid_note"]

    def test_yearly_row_keys_present(self, client, db, user, prop):
        _add_tax_entry(db, prop.id, user.id, 2022, rents_received=36_000.0)
        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        rows = resp.json()["yearly"]
        if not rows:
            pytest.skip("No yearly rows returned")
        row = rows[0]
        for key in ("year", "rental_income", "operating_expenses",
                    "interest_paid", "principal_paid", "cash_flow",
                    "taxable_income", "depreciation", "taxes_paid"):
            assert key in row, f"Missing yearly key: {key}"

    def test_404_for_other_user_property(self, client, db, user, prop):
        """Cannot access another user's property."""
        from passlib.context import CryptContext
        ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        other = models.User(email="other@example.com", name="Other",
                            hashed_password=ctx.hash("pw"))
        db.add(other)
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(other.email))
        # Backend returns 403 (not 404) to avoid leaking property existence
        assert resp.status_code in (403, 404)
