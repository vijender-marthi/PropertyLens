"""Debt section: per-loan balance/interest accumulation with a documented-
data-first, projection-for-the-gap fallback.

Waterfall verified here:
  1. Form 1098 (Box 1 interest) wins for any year it covers.
  2. Schedule E (tax return) interest is used only when there's no 1098
     for that property (single-loan) — never blended into a multi-loan
     property without a matching account number.
  3. The undocumented gap (typically the current, in-progress year) is
     projected month-by-month from the loan's last known statement
     (balance, rate, P&I) forward to today — and only that gap, never
     overwriting a year that already has a 1098 or Schedule E figure.
"""
import json
import uuid

import pytest
from tests.conftest import auth_headers
import models
from routers.properties import current_loan_balance


def _add_1098(db, prop, owner_id, year, interest, account="ACCT-1"):
    doc = models.Document(
        property_id=prop.id, owner_id=owner_id,
        filename=f"1098_{year}_{account}.pdf", original_filename=f"1098_{year}_{account}.pdf",
        file_type="pdf", doc_category="1098", statement_year=year,
        extracted_data=json.dumps({
            "tax_year": str(year), "mortgage_interest": interest,
            "current_balance": None, "account_number": account,
        }),
        loan_account_number=account, file_size=1024,
    )
    db.add(doc)
    db.commit()
    db.refresh(prop)
    return doc


class TestSingleLoanNoDocuments:
    def test_fully_projected_matches_current_loan_balance(self, client, user, prop):
        """No 1098s at all -> every year is a gap, projected from origination."""
        resp = client.get(f"/api/properties/{prop.id}/debt",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["loans"]) == 1
        loan_debt = data["loans"][0]
        assert loan_debt["source"] == "projected"
        assert loan_debt["estimated_vs_reported"] == "estimated"
        assert loan_debt["gap_months_projected"] > 0
        assert loan_debt["years"] == []
        assert loan_debt["current_balance"] == pytest.approx(current_loan_balance(prop.loans[0]))
        assert loan_debt["accumulated_interest"] > 0
        assert data["rollup"]["total_current_balance"] == pytest.approx(loan_debt["current_balance"])
        assert data["rollup"]["total_accumulated_interest"] == pytest.approx(loan_debt["accumulated_interest"])


class TestDocumentedYearsAreNeverOverwritten:
    def test_1098_years_used_exactly_gap_only_covers_remainder(self, client, db, user, prop):
        prop.loans[0].account_number = "ACCT-1"
        db.commit()
        for year, interest in [(2020, 20_500), (2021, 20_200), (2022, 19_900)]:
            _add_1098(db, prop, user.id, year, interest)

        resp = client.get(f"/api/properties/{prop.id}/debt",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        loan_debt = resp.json()["loans"][0]

        documented = {y["year"]: y for y in loan_debt["years"]}
        assert documented[2020]["interest"] == pytest.approx(20_500)
        assert documented[2021]["interest"] == pytest.approx(20_200)
        assert documented[2022]["interest"] == pytest.approx(19_900)
        assert all(y["source"] == "1098" for y in documented.values())

        # Total must include the documented years plus a positive projected
        # gap for everything since — not just the documented sum alone.
        documented_sum = sum(y["interest"] for y in documented.values())
        assert loan_debt["accumulated_interest"] > documented_sum
        assert loan_debt["gap_months_projected"] > 0


class TestStatementYtdAnchorsTheGap:
    def test_statement_ytd_used_for_its_own_undocumented_year(self, client, db, user, prop):
        """A statement mid-way through an undocumented year contributes its
        own YTD interest figure instead of a from-scratch amortization
        guess for the months before the statement date."""
        loan = prop.loans[0]
        loan.statement_date = "2025-06-01"
        loan.interest_paid_ytd = 8_000.0
        loan.principal_paid_ytd = 2_200.0
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/debt",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        loan_debt = resp.json()["loans"][0]
        assert loan_debt["last_known_statement_date"] == "2025-06-01"
        assert loan_debt["source"] == "projected"
        assert loan_debt["gap_months_projected"] > 0


class TestMultiLoanAttribution:
    def test_1098_attributed_to_matching_account_only(self, client, db, user, prop):
        """A second loan on the property must not inherit the first loan's
        1098 interest just because both are undocumented for other years."""
        loan_a = prop.loans[0]
        loan_a.account_number = "ACCT-A"
        db.add(models.Loan(
            property_id=prop.id, original_amount=50_000.0, current_balance=45_000.0,
            interest_rate=7.0, monthly_payment=350.0, loan_term_years=15,
            escrow_amount=0.0, interest_due=260.0, principal_due=90.0,
            origination_date="2021-01-01", account_number="ACCT-B",
        ))
        db.commit()
        _add_1098(db, prop, user.id, 2022, 20_000, account="ACCT-A")

        resp = client.get(f"/api/properties/{prop.id}/debt",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["loans"]) == 2
        by_account = {l["account_number"]: l for l in data["loans"]}

        assert by_account["ACCT-A"]["years"] == [
            {"year": 2022, "interest": 20_000.0, "source": "1098"}
        ]
        # ACCT-B has no 1098 of its own -> no documented years, pure projection.
        assert by_account["ACCT-B"]["years"] == []
        assert by_account["ACCT-B"]["source"] == "projected"
