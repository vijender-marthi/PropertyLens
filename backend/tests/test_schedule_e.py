"""
Integration tests for Schedule E (tax return) data priority logic.

Verifies that:
  1. TaxReturnEntry.mortgage_interest overrides statement-based interest
     when no Form 1098 document is present.
  2. TaxReturnEntry.total_expenses (minus interest and depreciation) is used
     as operating_expenses when available, replacing static field estimates.
  3. A Form 1098 document still takes priority over Schedule E interest.
  4. Years with no tax return, 1098, or statement fall back to an
     amortization projection from the loan's rate and balance.

Tests call the /api/properties/{id}/lifetime endpoint and inspect the
returned `yearly` array.
"""
import json
from datetime import date
import pytest
from tests.conftest import auth_headers
import models


# ---------------------------------------------------------------------------
# Helpers to create DB fixtures
# ---------------------------------------------------------------------------

def _add_tax_entry(db, prop_id: int, owner_id: int, year: int, *,
                   mortgage_interest=0.0, property_taxes=0.0,
                   depreciation=0.0, total_expenses=0.0,
                   rents_received=0.0, net_income=0.0,
                   expense_breakdown=None, document_id=None) -> models.TaxReturnEntry:
    entry = models.TaxReturnEntry(
        owner_id=owner_id,
        property_id=prop_id,
        document_id=document_id,
        tax_year=year,
        address="123 Test St",
        property_kind="rental",
        mortgage_interest=mortgage_interest,
        property_taxes=property_taxes,
        depreciation=depreciation,
        total_expenses=total_expenses,
        rents_received=rents_received,
        net_income=net_income,
        expense_breakdown=json.dumps(expense_breakdown or {}),
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

class TestScheduleECaptureEndpoint:
    def test_top_strip_line_table_and_history_use_same_backend_values(self, client, user, prop):
        resp = client.get(
            f"/api/properties/{prop.id}/taxes/schedule-e?year=2023",
            headers=auth_headers(user.email),
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        lines = {row["key"]: row for row in data["lines"]}
        history = {row["year"]: row for row in data["history"]}

        assert data["topStrip"]["deductibleInterest"]["value"] == lines["mortgage_interest"]["computed"]["value"]
        assert data["topStrip"]["propertyTax"]["value"] == lines["taxes"]["computed"]["value"]
        assert data["topStrip"]["depreciation"]["value"] == lines["depreciation"]["computed"]["value"]
        assert data["topStrip"]["netScheduleE"]["value"] == lines["net_income"]["computed"]["value"]
        assert history[2023]["mortgageInterest"]["value"] == data["topStrip"]["deductibleInterest"]["value"]
        assert history[2023]["propertyTax"]["value"] == data["topStrip"]["propertyTax"]["value"]
        assert history[2023]["depreciation"]["value"] == data["topStrip"]["depreciation"]["value"]
        assert lines["taxes"]["computed"]["display"] != "—"
        assert lines["depreciation"]["computed"]["value"] > 0
        assert data["assertions"]["netLineMatchesFormula"] is True
        assert data["assertions"]["depreciationPresentForFullRentalYears"] is True
        assert data["assertions"]["selectedYearStripMatchesHistory"] is True

    def test_partial_year_depreciation_is_less_than_full_rental_year(self, client, user, prop):
        current_year = date.today().year

        resp = client.get(
            f"/api/properties/{prop.id}/taxes/schedule-e?year={current_year}",
            headers=auth_headers(user.email),
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        history = {row["year"]: row for row in data["history"]}
        full_year = current_year - 1
        assert history[full_year]["depreciation"]["value"] > 0
        assert history[current_year]["depreciation"]["value"] < history[full_year]["depreciation"]["value"]
        assert data["assertions"]["partialYearDepreciationBelowFullYear"] is True

    def test_current_year_breakdown_splits_reported_and_projected_rows(self, client, db, user, prop):
        current_year = date.today().year
        db.add(models.RentalPeriod(
            property_id=prop.id,
            tenant_name="Current tenant",
            start_year=current_year,
            start_month=1,
            monthly_rent=3_200,
        ))
        db.add(models.Document(
            property_id=prop.id,
            owner_id=user.id,
            filename="current-statement.pdf",
            original_filename="Current statement.pdf",
            file_type="pdf",
            doc_category="mortgage_statement",
            file_size=1024,
            statement_year=current_year,
            period_type="monthly",
            extracted_data=json.dumps({
                "statement_date": f"06/15/{current_year}",
                "interest_due": 1500.0,
                "principal_due": 500.0,
                "current_balance": 295000.0,
                "property_tax_amount": 500.0,
            }),
        ))
        db.commit()

        resp = client.get(
            f"/api/properties/{prop.id}/taxes/schedule-e?year={current_year}",
            headers=auth_headers(user.email),
        )

        assert resp.status_code == 200, resp.text
        breakdown = resp.json()["currentYearBreakdown"]
        assert breakdown["year"] == current_year
        assert breakdown["monthsReported"] == 6
        assert breakdown["rows"][0]["kind"] == "total"
        assert breakdown["rows"][0]["expandable"] is True
        detail = {row["kind"]: row for row in breakdown["detailRows"]}
        assert detail["reported"]["metrics"]["rentsReceived"]["value"] == 19200.0
        assert detail["reported"]["metrics"]["mortgageInterest"]["value"] == 1500.0
        assert detail["reported"]["metrics"]["propertyTax"]["value"] == 500.0
        assert detail["projected"]["metrics"]["rentsReceived"]["value"] > 0

    def test_current_year_breakdown_is_fully_projected_without_statement_or_rental_details(self, client, user, prop):
        current_year = date.today().year

        resp = client.get(
            f"/api/properties/{prop.id}/taxes/schedule-e?year={current_year}",
            headers=auth_headers(user.email),
        )

        assert resp.status_code == 200, resp.text
        breakdown = resp.json()["currentYearBreakdown"]
        detail = {row["kind"]: row for row in breakdown["detailRows"]}
        assert breakdown["monthsReported"] == 0
        assert detail["reported"]["metrics"]["mortgageInterest"]["value"] == 0.0
        assert detail["reported"]["metrics"]["netScheduleE"]["value"] == 0.0
        assert detail["projected"]["metrics"]["mortgageInterest"]["value"] == breakdown["rows"][0]["metrics"]["mortgageInterest"]["value"]

    def test_filed_schedule_e_values_reconcile_by_line(self, client, db, user, prop):
        doc = models.Document(
            property_id=prop.id,
            owner_id=user.id,
            filename="schedule-e-2023.pdf",
            original_filename="Filed Schedule E 2023.pdf",
            display_name="Filed Schedule E 2023.pdf",
            file_type="pdf",
            doc_category="tax_return",
            statement_year=2023,
            file_size=1024,
        )
        db.add(doc)
        db.commit()
        _add_tax_entry(
            db,
            prop.id,
            user.id,
            2023,
            document_id=doc.id,
            rents_received=36_000,
            mortgage_interest=19_000,
            property_taxes=6_000,
            depreciation=11_636.36,
            total_expenses=39_000,
            net_income=-3_000,
            expense_breakdown={
                "insurance": 1_200,
                "repairs": 900,
                "taxes": 6_000,
                "mortgage_interest": 19_000,
                "depreciation": 11_636.36,
            },
        )

        resp = client.get(
            f"/api/properties/{prop.id}/taxes/schedule-e?year=2023",
            headers=auth_headers(user.email),
        )

        assert resp.status_code == 200, resp.text
        data = resp.json()
        lines = {row["key"]: row for row in data["lines"]}
        assert lines["rents_received"]["filed"]["value"] == 36_000
        assert lines["mortgage_interest"]["filed"]["value"] == 19_000
        assert lines["taxes"]["filed"]["value"] == 6_000
        assert lines["net_income"]["status"] in {"Match", "Delta"}
        assert data["summary"]["filedSource"] == "Filed Schedule E 2023.pdf"
        assert data["summary"]["linesFiled"] > 0

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

    def test_no_tax_entry_falls_back_to_amortization_projection(self, client, db, user, prop):
        """Without any tax entry, 1098, or statement for the year, interest is
        projected from the loan's own amortization schedule (rate + balance)
        rather than annualizing the latest known monthly interest_due —
        which would misrepresent a past year using today's interest amount."""
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
        # Loan: $320,000 @ 6.5%, originated 2020-01-01 — amortized interest
        # for full-year 2021 comes out to ~$20,475, not a flat $1,625 x 12.
        assert row["interest_paid"] == pytest.approx(20_475.27, rel=0.01)


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
        """current_balance is no longer authoritative for this figure: the
        balance is derived from the loan's own amortization schedule, so a
        bad manual value (e.g. zeroed out with no supporting statement)
        can't fake a full payoff."""
        from routers.properties import current_loan_balance

        for loan in prop.loans:
            loan.current_balance = 0.0
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        lt = resp.json()["lifetime"]

        expected_paid = round(sum(
            l.original_amount - current_loan_balance(l) for l in prop.loans if l.original_amount
        ), 2)
        assert lt["total_principal_paid"] == pytest.approx(expected_paid)
        assert 0 < lt["total_principal_paid"] < prop.loans[0].original_amount
        assert lt["principal_paid_source"] == "loan_balance"

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
