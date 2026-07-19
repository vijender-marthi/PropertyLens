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
from datetime import date

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


def _add_1098_with_balance(db, prop, owner_id, year, interest, balance, account="ACCT-1", origination_date=None):
    extracted_data = {
        "tax_year": str(year),
        "mortgage_interest": interest,
        "current_balance": balance,
        "account_number": account,
    }
    if origination_date:
        extracted_data["origination_date"] = origination_date
    doc = models.Document(
        property_id=prop.id, owner_id=owner_id,
        filename=f"1098_{year}_{account}.pdf", original_filename=f"1098_{year}_{account}.pdf",
        file_type="pdf", doc_category="1098", statement_year=year,
        extracted_data=json.dumps(extracted_data),
        loan_account_number=account, file_size=1024,
    )
    db.add(doc)
    db.commit()
    db.refresh(prop)
    return doc


def _add_1098_with_box_aliases(db, prop, owner_id, year, interest, balance, account="ACCT-1"):
    doc = models.Document(
        property_id=prop.id, owner_id=owner_id,
        filename=f"1098_alias_{year}_{account}.pdf", original_filename=f"1098_alias_{year}_{account}.pdf",
        file_type="pdf", doc_category="1098", statement_year=year,
        extracted_data=json.dumps({
            "tax_year": str(year),
            "box1_interest": interest,
            "box2_balance": balance,
            "account_number": account,
        }),
        loan_account_number=account, file_size=1024,
    )
    db.add(doc)
    db.commit()
    db.refresh(prop)
    return doc


def _add_mortgage_statement(
    db,
    prop,
    owner_id,
    year,
    balance,
    account="ACCT-1",
    statement_date="06/11/2026",
    ytd_principal=None,
    ytd_interest=None,
    principal_due=None,
    interest_due=None,
):
    extracted_data = {
        "statement_year": year,
        "statement_date": statement_date,
        "current_balance": balance,
        "account_number": account,
        "principal_paid_ytd": ytd_principal,
        "interest_paid_ytd": ytd_interest,
    }
    if principal_due is not None:
        extracted_data["principal_due"] = principal_due
    if interest_due is not None:
        extracted_data["interest_due"] = interest_due
    doc = models.Document(
        property_id=prop.id, owner_id=owner_id,
        filename=f"statement_{year}_{account}.pdf", original_filename=f"statement_{year}_{account}.pdf",
        file_type="pdf", doc_category="mortgage_statement", statement_year=year,
        extracted_data=json.dumps(extracted_data),
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


class TestPaymentHistory:
    def test_debt_returns_only_persisted_mortgage_statement_snapshots(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "ACCT-1"
        document = _add_mortgage_statement(
            db, prop, user.id, 2026, 275_000,
            statement_date="06/11/2026",
            ytd_principal=4_250,
            ytd_interest=7_600,
        )
        snapshot = models.LoanBalanceSnapshot(
            id=str(uuid.uuid4()),
            loan_id=loan.id,
            property_id=prop.id,
            as_of_date="2026-06-11",
            balance=275_000,
            principal_paid_ytd=4_250,
            interest_paid_ytd=7_600,
            payment=1_800,
            source_document_id=document.id,
        )
        db.add(snapshot)
        db.commit()

        response = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert response.status_code == 200
        assert response.json()["paymentHistoryRows"] == [{
            "rowKey": snapshot.id,
            "loanId": loan.id,
            "lenderName": loan.lender_name or "Loan",
            "accountNumber": "ACCT-1",
            "statementDate": "2026-06-11",
            "payment": 1_800,
            "principalYtd": 4_250,
            "interestYtd": 7_600,
            "balance": 275_000,
            "documentId": document.id,
            "sourceLabel": document.original_filename,
            "sourceType": "Mortgage statement",
        }]


class TestRefinancedLoanRollup:
    def test_closed_refinance_remains_visible_without_counting_as_current_debt(self, client, db, user, prop):
        previous = prop.loans[0]
        previous.status = "REFINANCED"
        previous.closed_date = "2021-07-30"
        previous.current_balance = 290_000
        previous.account_number = None
        previous.interest_rate = 0
        previous.monthly_payment = 0
        previous.principal_due = 0
        previous.interest_due = 0
        current = models.Loan(
            property_id=prop.id,
            lender_name="Current lender",
            loan_type="FIXED",
            status="OPEN",
            original_amount=300_000,
            current_balance=275_000,
            interest_rate=3.0,
            monthly_payment=1_265,
            loan_term_years=30,
            origination_date="2021-07-30",
        )
        db.add(current)
        db.commit()

        response = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert response.status_code == 200
        data = response.json()
        assert len(data["loans"]) == 2
        closed = next(loan for loan in data["loans"] if loan["loan_id"] == previous.id)
        assert closed["current_balance"] == 0
        assert closed["historical_ending_balance"] > 0
        assert closed["payment"]["monthlyPI"] == 0
        assert data["portfolio"]["totalBalance"] == pytest.approx(
            next(loan["current_balance"] for loan in data["loans"] if loan["loan_id"] == current.id)
        )


class TestDocumentedYearsAreNeverOverwritten:
    def test_single_accountless_loan_uses_property_setup_1098_account(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = None
        loan.origination_date = "2021-01-01"
        loan.original_amount = 320_000
        loan.current_balance = 270_000
        loan.interest_rate = 6.0
        loan.monthly_payment = 2_000
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2024, 15_000, 290_000, account="1590237047")

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        row_2024 = next(row for row in resp.json()["loans"][0]["paydown"]["rows"] if row["year"] == 2024)
        assert row_2024["source"] == "1098"
        assert row_2024["sourceDocument"]["documentId"]
        assert row_2024["sourceDocument"]["parsedValues"]["taxYear"] == 2024

    def test_single_loan_uses_1098_when_servicing_account_changed_but_origination_matches(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "1590237047"
        loan.origination_date = "2021-05-27"
        loan.original_amount = 491_000
        loan.current_balance = 491_000
        loan.interest_rate = 3.625
        loan.monthly_payment = 2_239.21
        loan.escrow_amount = 0
        loan.principal_due = 755.98
        loan.interest_due = 1483.23
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2022, 17_478.05, 486_429.72, account="0673619441", origination_date="05/27/2021")
        _add_1098_with_balance(db, prop, user.id, 2023, 17_131.85, 477_037.25, account="0673619441", origination_date="05/27/2021")

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        rows = resp.json()["loans"][0]["paydown"]["rows"]
        row_2022 = next(row for row in rows if row["year"] == 2022)
        assert row_2022["source"] == "1098"
        assert row_2022["interestPaid"] == 17_478.05
        assert row_2022["startBalance"] == 486_429.72
        assert row_2022["endBalance"] == 477_037.25

    def test_single_loan_uses_latest_statement_balance_when_account_changed(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "1590237047"
        loan.origination_date = "2021-05-27"
        loan.original_amount = 491_000
        loan.current_balance = 491_000
        loan.interest_rate = 3.625
        loan.monthly_payment = 2_239.21
        loan.escrow_amount = 0
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2025, 16_400.73, 457_200.97, account="0673619441", origination_date="05/27/2021")
        _add_mortgage_statement(db, prop, user.id, 2026, 441_352.44, account="0673619441")

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        loan_debt = resp.json()["loans"][0]
        assert loan_debt["current_balance"] == 441_352.44
        row_2026 = next(row for row in loan_debt["paydown"]["rows"] if row["year"] == 2026 and not row.get("isFullYearProjection"))
        assert row_2026["source"] == "statement"
        assert row_2026["endBalance"] == 441_352.44
        assert row_2026["principalPaid"] == pytest.approx(row_2026["startBalance"] - row_2026["endBalance"])
        assert row_2026["interestPaid"] > 0

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


class TestLoanPaydownTracking:
    def test_1098_top_up_rebaselines_from_each_year_box2(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "ACCT-1"
        loan.origination_date = "2021-01-01"
        loan.original_amount = 320_000
        loan.current_balance = 270_000
        loan.interest_rate = 6.0
        loan.monthly_payment = 2_000
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2022, 18_000, 300_000)
        _add_1098_with_balance(db, prop, user.id, 2023, 16_800, 285_000)

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        paydown = resp.json()["loans"][0]["paydown"]
        row_2022 = next(row for row in paydown["rows"] if row["year"] == 2022)
        assert row_2022["source"] == "1098"
        assert row_2022["sourceLabel"] == "1098 (box 2 delta + box 1)"
        assert row_2022["startBalance"] == 300_000
        assert row_2022["startingBalance"] == 300_000
        assert row_2022["endBalance"] == 285_000
        assert row_2022["endingBalance"] == 285_000
        assert row_2022["principalPaid"] == 15_000
        assert row_2022["principalRequired"] == row_2022["scheduledPrincipal"]
        assert row_2022["topUp"] == row_2022["extraPrincipal"]
        assert row_2022["interestPaid"] == 18_000
        assert row_2022["endingBalanceMetric"]["sourceType"] == "REPORTED"
        assert row_2022["extraPrincipal"] > 0
        assert row_2022["assertions"]["scheduledPlusTopUpEqualsActual"] is True
        actual_rows = [row for row in paydown["rows"] if not row.get("isFullYearProjection")]
        assert paydown["summary"]["interestPaidToDate"] == pytest.approx(
            sum(row["interestPaid"] or 0 for row in actual_rows)
        )

    def test_1098_box_aliases_populate_principal_and_ending_balance(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "ACCT-1"
        loan.origination_date = "2021-01-01"
        loan.original_amount = 320_000
        loan.current_balance = 270_000
        loan.interest_rate = 6.0
        loan.monthly_payment = 2_000
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_box_aliases(db, prop, user.id, 2024, 15_000, 290_000)
        _add_1098_with_box_aliases(db, prop, user.id, 2025, 14_000, 276_000)

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        row_2024 = next(row for row in resp.json()["loans"][0]["paydown"]["rows"] if row["year"] == 2024)
        assert row_2024["source"] == "1098"
        assert row_2024["principalPaid"] == 14_000
        assert row_2024["principalPaidDisplay"] != "—"
        assert row_2024["endBalance"] == 276_000
        assert row_2024["endingBalanceDisplay"] != "—"
        source_doc = row_2024["sourceDocument"]
        assert source_doc["previewUrl"].endswith(f"/documents?documentId={source_doc['documentId']}")

    def test_1098_interest_implausible_for_balance_rate_is_flagged(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "ACCT-1"
        loan.origination_date = "2021-01-01"
        loan.original_amount = 491_000
        loan.current_balance = 450_000
        loan.interest_rate = 7.625
        loan.monthly_payment = 3_500
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2024, 8_827, 463_000)
        _add_1098_with_balance(db, prop, user.id, 2025, 35_000, 450_000)

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        row_2024 = next(row for row in resp.json()["loans"][0]["paydown"]["rows"] if row["year"] == 2024)
        assert row_2024["source"] == "1098"
        assert row_2024["interestPaid"] == 8_827
        assert row_2024["assertions"]["interestPlausibleForBalanceRate"] is False
        assert any("Parsed interest implausible" in warning for warning in row_2024["warnings"])
        assert row_2024["issueCount"] >= 1
        assert any(issue["code"] == "IMPLAUSIBLE_INTEREST" for issue in row_2024["issues"])
        reconciliation = resp.json()["loans"][0]["paydown"]["reconciliation"]
        assert reconciliation["status"] == "WARNING"
        assert reconciliation["affectedYearCount"] >= 1
        assert any(year["year"] == 2024 for year in reconciliation["years"])

    def test_metric_vault_interest_to_date_matches_paydown_rows(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "ACCT-1"
        loan.origination_date = "2021-01-01"
        loan.original_amount = 320_000
        loan.current_balance = 276_000
        loan.interest_rate = 6.0
        loan.monthly_payment = 2_000
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2024, 17_000, 290_000)
        _add_1098_with_balance(db, prop, user.id, 2025, 16_000, 276_000)

        debt_resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))
        vault_resp = client.get(f"/api/properties/{prop.id}/metric-vault", headers=auth_headers(user.email))

        assert debt_resp.status_code == 200
        assert vault_resp.status_code == 200
        debt_loan = debt_resp.json()["loans"][0]
        actual_rows = [row for row in debt_loan["paydown"]["rows"] if not row.get("isFullYearProjection")]
        row_interest = sum(row["interestPaid"] or 0 for row in actual_rows)
        vault = vault_resp.json()
        loan_metrics = vault["loanMetrics"][str(loan.id)]
        assert vault["loanSummary"]["interestToDate"] == pytest.approx(row_interest)
        assert vault["loanSummary"]["assertions"]["interestToDateMatchesPaydownRows"] is True
        assert vault["metrics"]["loanInterestToDate"]["value"] == pytest.approx(row_interest)
        assert loan_metrics["interestToDate"]["value"] == pytest.approx(row_interest)
        assert loan_metrics["assertions"]["interestToDateMatchesPaydownRows"] is True

    def test_1098_missing_next_box2_marks_top_up_unknown(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "ACCT-1"
        loan.origination_date = "2021-01-01"
        loan.original_amount = 320_000
        loan.current_balance = 270_000
        loan.interest_rate = 6.0
        loan.monthly_payment = 2_000
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_balance(db, prop, user.id, 2024, 15_000, 290_000)

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        row_2024 = next(row for row in resp.json()["loans"][0]["paydown"]["rows"] if row["year"] == 2024)
        assert row_2024["source"] == "1098"
        assert row_2024["topUpKnown"] is True
        assert row_2024["principalPaid"] == 9_000
        assert row_2024["endBalance"] == 281_000
        assert row_2024["endingBalanceSource"] == "calculated"
        assert row_2024["endingBalanceMetric"]["sourceType"] == "CALCULATED"
        assert row_2024["endingBalanceMetric"]["formula"] == "Starting balance − principal paid"
        assert row_2024["assertions"]["principalPaidEqualsPaymentLessInterest"] is True
        assert row_2024["assertions"]["endingBalanceEqualsStartMinusPrincipal"] is True

    def test_missing_origination_date_flags_paydown_without_guessing(self, client, db, user, prop):
        prop.loans[0].origination_date = None
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        paydown = resp.json()["loans"][0]["paydown"]
        assert paydown["rows"] == []
        assert paydown["assertions"]["loanStartDatePresent"] is False
        assert any("Add loan start date" in warning for warning in paydown["summary"]["warnings"])

    def test_closed_loan_paydown_stops_at_closed_date(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "CLOSED-1"
        loan.origination_date = "2023-05-26"
        loan.original_amount = 468_750
        loan.current_balance = 466_681.81
        loan.interest_rate = 7.625
        loan.monthly_payment = 3_317.78
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        loan.status = "CLOSED"
        loan.closed_date = "2024-09-01"
        loan.servicer_end_date = "2024-09-01"
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        loan_debt = resp.json()["loans"][0]
        rows = loan_debt["paydown"]["rows"]
        assert rows
        assert max(row["year"] for row in rows) == 2024
        assert all(row["isCurrentYear"] is False for row in rows)
        assert all("now" not in row["yearLabel"].lower() for row in rows)
        assert all(not row.get("isFullYearProjection") for row in rows)
        assert loan_debt["latest_period"]["year"] == 2024
        assert "2026" not in loan_debt["latest_period"]["label"]
        assert loan_debt["current_year_ytd"]["year"] == 2024
        assert loan_debt["accumulated_interest"] == pytest.approx(
            sum(row["interestPaid"] or 0 for row in rows)
        )

    def test_servicer_transfer_loan_paydown_starts_at_acquisition_date(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.lender_name = "Rocket"
        loan.account_number = "3550379001"
        loan.origination_date = "2023-05-26"
        loan.servicer_start_date = "2024-10-01"
        loan.original_amount = 463_428.32
        loan.current_balance = 438_502.37
        loan.interest_rate = 7.625
        loan.monthly_payment = 4_274.51
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        rows = resp.json()["loans"][0]["paydown"]["rows"]
        assert rows
        assert min(row["year"] for row in rows) == 2024
        assert not any(row["year"] == 2023 for row in rows)

    def test_servicer_transfer_renders_one_logical_loan_with_consolidated_chain(self, client, db, user, prop):
        old_loan = prop.loans[0]
        old_loan.lender_name = "DHi Mortgage Company, Ltd., LP"
        old_loan.account_number = "0064944077"
        old_loan.origination_date = "2023-05-26"
        old_loan.servicer_start_date = "2023-05-26"
        old_loan.servicer_end_date = "2024-09-30"
        old_loan.closed_date = "2024-09-30"
        old_loan.status = "CLOSED"
        old_loan.closure_reason = "Servicing transfer"
        old_loan.transfer_reason = "Servicing transfer"
        old_loan.loan_group_id = None
        old_loan.servicer_sequence = 1
        old_loan.is_current_servicer = False
        old_loan.original_amount = 468_750
        old_loan.current_balance = 461_922
        old_loan.interest_rate = 7.625
        old_loan.monthly_payment = 4_274.51
        old_loan.escrow_amount = 956.73
        old_loan.principal_due = 0
        old_loan.interest_due = 0
        rocket = models.Loan(
            property_id=prop.id,
            lender_name="Rocket",
            account_number="3550379001",
            origination_date="2023-05-26",
            servicer_start_date="2024-10-01",
            original_amount=468_750,
            current_balance=438_502,
            interest_rate=7.625,
            monthly_payment=4_274.51,
            escrow_amount=956.73,
            principal_due=0,
            interest_due=0,
            loan_term_years=30,
            status="OPEN",
            loan_group_id=None,
            servicer_sequence=2,
            transfer_reason="Servicing transfer",
            is_current_servicer=True,
        )
        db.add(rocket)
        db.commit()
        db.refresh(prop)
        _add_1098_with_balance(db, prop, user.id, 2023, 23_800, 468_750, account="0064944077")
        _add_1098_with_balance(db, prop, user.id, 2024, 35_390, 466_329, account="0064944077")
        _add_1098_with_balance(db, prop, user.id, 2025, 34_620, 461_922, account="3550379001")
        _add_1098_with_balance(db, prop, user.id, 2026, 19_670, 446_095, account="3550379001")
        _add_mortgage_statement(
            db, prop, user.id, 2026, 438_502,
            account="3550379001", statement_date="07/15/2026",
            ytd_principal=7_593, ytd_interest=19_670,
        )

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        data = resp.json()
        assert data["portfolio"]["loanCount"] == 1
        assert len(data["loans"]) == 1
        loan = data["loans"][0]
        assert loan["name"] == "Primary mortgage"
        assert loan["account_number"] == "3550379001"
        assert [segment["servicer"] for segment in loan["servicerSegments"]] == [
            "DHi Mortgage Company, Ltd., LP",
            "Rocket",
        ]
        assert loan["servicerSegments"][1]["current"] is True
        rows = [row for row in loan["paydown"]["rows"] if not row.get("isFullYearProjection")]
        by_year = {row["year"]: row for row in rows}
        assert by_year[2023]["servicerDisplay"] == "DHi Mortgage Company, Ltd., LP"
        assert by_year[2024]["servicerDisplay"] == "DHi Mortgage Company, Ltd., LP → Rocket"
        assert by_year[2025]["servicerDisplay"] == "Rocket"
        assert by_year[2026]["servicerDisplay"] == "Rocket"
        assert by_year[2023]["startingBalance"] == 468_750
        assert by_year[2023]["endingBalance"] == 466_329
        assert by_year[2024]["startingBalance"] == 466_329
        assert by_year[2024]["endingBalance"] == 461_922
        assert by_year[2025]["startingBalance"] == 461_922
        assert by_year[2025]["endingBalance"] == 446_095
        assert by_year[2026]["startingBalance"] == 446_095
        assert by_year[2026]["endingBalance"] == 438_502
        assert by_year[2024]["interestPaid"] == pytest.approx(35_390)
        assert not any(issue["code"] == "IMPLAUSIBLE_INTEREST" for row in rows for issue in row["issues"])
        assert loan["payment"]["monthlyPI"] == pytest.approx(3317.78, abs=0.01)
        assert loan["payment"]["amortizedMonthlyPI"] == pytest.approx(3317.78, abs=0.01)
        assert loan["current_balance"] == 438_502
        assert loan["assertions"]["L1_balanceChainContinuous"] is True
        assert loan["assertions"]["L2_transferBoundaryContinuous"] is True
        assert loan["assertions"]["L4_interestPlausible"] is True
        assert loan["assertions"]["L5_paymentPiMatchesAmortization"] is True
        assert loan["assertions"]["L6_singleLogicalCard"] is True
        assert loan["assertions"]["L7_originalMinusPrincipalEqualsCurrentBalance"] is True
        assert data["assertions"]["L3_totalBalanceEqualsSumLoanBalances"] is True
        assert data["assertions"]["L8_interestToDateEqualsSumLoanInterest"] is True

    def test_latest_statement_pi_split_drives_projection_instead_of_total_payment(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.lender_name = "Rocket"
        loan.account_number = "3550379001"
        loan.origination_date = "2023-05-26"
        loan.original_amount = 463_428.32
        loan.current_balance = 438_502.37
        loan.interest_rate = 7.625
        loan.monthly_payment = 4_274.51
        loan.escrow_amount = 950.53
        # Reproduce the polluted persisted split that treated total payment as P&I.
        loan.principal_due = 1_488.19
        loan.interest_due = 2_786.32
        loan.loan_term_years = 30
        db.commit()
        _add_mortgage_statement(
            db,
            prop,
            user.id,
            2026,
            438_502.37,
            account="3550379001",
            statement_date="06/11/2026",
            principal_due=531.46,
            interest_due=2_786.32,
        )

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        loan_debt = resp.json()["loans"][0]
        assert loan_debt["payment"]["monthlyPI"] == pytest.approx(3_317.78, abs=0.01)
        projection = next(
            row for row in loan_debt["paydown"]["rows"]
            if row.get("isFullYearProjection")
        )
        assert 4_000 < projection["scheduledPrincipal"] < 7_000
        assert projection["scheduledPrincipal"] != pytest.approx(17_406, abs=100)

    def test_servicer_transfer_year_includes_same_origination_1098_aliases_once(self, client, db, user, prop):
        old_loan = prop.loans[0]
        old_loan.lender_name = "DHi Mortgage Company, Ltd., LP"
        old_loan.account_number = "230577464"
        old_loan.origination_date = "2023-05-24"
        old_loan.servicer_start_date = "2023-05-26"
        old_loan.servicer_end_date = "2024-09-01"
        old_loan.closed_date = "2024-09-01"
        old_loan.status = "CLOSED"
        old_loan.closure_reason = "Servicing transfer"
        old_loan.transfer_reason = "Servicing transfer"
        old_loan.servicer_sequence = 1
        old_loan.is_current_servicer = False
        old_loan.original_amount = 468_750
        old_loan.current_balance = 466_681.81
        old_loan.interest_rate = 7.625
        old_loan.monthly_payment = 4_274.51
        old_loan.escrow_amount = 956.73
        old_loan.principal_due = 0
        old_loan.interest_due = 0
        rocket = models.Loan(
            property_id=prop.id,
            lender_name="Rocket",
            account_number="3550379001",
            origination_date="2023-05-26",
            servicer_start_date="2024-10-01",
            original_amount=463_428.32,
            current_balance=438_502.37,
            interest_rate=7.625,
            monthly_payment=4_274.51,
            escrow_amount=956.73,
            principal_due=0,
            interest_due=0,
            loan_term_years=30,
            status="OPEN",
            transfer_reason="Servicing transfer",
            is_current_servicer=True,
            servicer_sequence=2,
        )
        db.add(rocket)
        db.commit()
        db.refresh(prop)
        _add_1098_with_balance(db, prop, user.id, 2024, 26_606.53, 466_681.81, account="0064944077", origination_date="2023-05-26")
        _add_1098_with_balance(db, prop, user.id, 2024, 26_606.53, 466_681.81, account="0064944077", origination_date="2023-05-26")
        _add_1098_with_balance(db, prop, user.id, 2024, 8_826.97, 463_428.32, account="3550379001", origination_date="2023-05-26")
        _add_1098_with_balance(db, prop, user.id, 2025, 35_087.66, 462_301.95, account="3550379001", origination_date="2023-05-26")

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        rows = resp.json()["loans"][0]["paydown"]["rows"]
        row_2024 = next(row for row in rows if row["year"] == 2024 and not row.get("isFullYearProjection"))
        assert row_2024["servicerDisplay"] == "DHi Mortgage Company, Ltd., LP → Rocket"
        assert row_2024["interestPaid"] == pytest.approx(35_433.5)
        source_doc = row_2024["sourceDocument"]
        assert source_doc["isCombined1098"] is True
        assert [doc["accountNumber"] for doc in source_doc["combinedDocuments"]] == ["0064944077", "3550379001"]
        assert [doc["box1Interest"] for doc in source_doc["combinedDocuments"]] == [26_606.53, 8_826.97]

    def test_servicer_transfer_includes_origination_year_without_1098(self, client, db, user, prop):
        old_loan = prop.loans[0]
        old_loan.lender_name = "DHI / LoanCare"
        old_loan.account_number = "0064944077"
        old_loan.origination_date = "2023-05-26"
        old_loan.servicer_start_date = "2023-05-26"
        old_loan.servicer_end_date = "2024-09-01"
        old_loan.closed_date = "2024-09-01"
        old_loan.status = "CLOSED"
        old_loan.closure_reason = "Servicing transfer"
        old_loan.transfer_reason = "Servicing transfer"
        old_loan.servicer_sequence = 1
        old_loan.is_current_servicer = False
        old_loan.original_amount = 468_750
        old_loan.current_balance = 463_428
        old_loan.interest_rate = 7.625
        old_loan.monthly_payment = 4_274.51
        old_loan.escrow_amount = 956.73
        old_loan.principal_due = 0
        old_loan.interest_due = 0
        rocket = models.Loan(
            property_id=prop.id,
            lender_name="Rocket",
            account_number="3550379001",
            origination_date="2023-05-26",
            servicer_start_date="2024-10-01",
            original_amount=468_750,
            current_balance=438_502,
            interest_rate=7.625,
            monthly_payment=4_274.51,
            escrow_amount=956.73,
            principal_due=0,
            interest_due=0,
            loan_term_years=30,
            status="OPEN",
            transfer_reason="Servicing transfer",
            is_current_servicer=True,
            servicer_sequence=2,
        )
        db.add(rocket)
        db.commit()
        db.refresh(prop)
        _add_1098_with_balance(db, prop, user.id, 2024, 8_827, 463_428, account="0064944077")
        _add_1098_with_balance(db, prop, user.id, 2025, 35_088, 462_302, account="3550379001")
        _add_mortgage_statement(
            db, prop, user.id, 2026, 438_502,
            account="3550379001", statement_date="07/15/2026",
            ytd_principal=7_593, ytd_interest=16_869,
        )

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        loan = resp.json()["loans"][0]
        rows = [row for row in loan["paydown"]["rows"] if not row.get("isFullYearProjection")]
        by_year = {row["year"]: row for row in rows}
        assert 2023 in by_year
        assert by_year[2023]["servicerDisplay"] == "DHI / LoanCare"
        assert by_year[2023]["startingBalance"] == 468_750
        assert by_year[2023]["endingBalance"] == 463_428
        assert by_year[2023]["sourceDocument"] is None
        assert by_year[2023]["documents"] == []
        assert by_year[2023]["sourceDisplay"] == "Projected from balance checkpoint"
        assert by_year[2024]["servicerDisplay"] == "DHI / LoanCare → Rocket"
        assert by_year[2024]["startingBalance"] == 463_428
        assert by_year[2024]["sourceDocument"]["parsedValues"]["taxYear"] == 2024

    def test_same_year_1098_and_statement_keep_box1_interest_and_statement_principal(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "3550379001"
        loan.origination_date = "2025-01-01"
        loan.original_amount = 462_301.95
        loan.current_balance = 457_576.25
        loan.interest_rate = 7.625
        loan.monthly_payment = 4_324.32
        loan.escrow_amount = 1_006.54
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()
        _add_1098_with_balance(
            db, prop, user.id, 2025, 35_087.66, 462_301.95,
            account="3550379001",
        )
        _add_mortgage_statement(
            db, prop, user.id, 2025, 457_576.25,
            account="3550379001", statement_date="12/16/2025",
            ytd_principal=4_725.70, ytd_interest=35_087.66,
            principal_due=410.26, interest_due=2_907.52,
        )

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        row_2025 = next(
            row for row in resp.json()["loans"][0]["paydown"]["rows"]
            if row["year"] == 2025 and not row.get("isFullYearProjection")
        )
        assert row_2025["source"] == "1098"
        assert row_2025["sourceDisplay"] == "1098 interest + statement balance"
        assert row_2025["interestPaid"] == pytest.approx(35_087.66)
        assert row_2025["principalPaid"] == pytest.approx(4_725.70)
        assert row_2025["principalPaid"] != pytest.approx(410.26)
        assert row_2025["interestPaid"] != pytest.approx(2_907.52)
        assert row_2025["endingBalance"] == pytest.approx(457_576.25)
        assert {doc["docType"] for doc in row_2025["documents"]} == {"1098", "mortgage_statement"}

    def test_current_year_full_projection_is_separate_from_ytd_row(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.account_number = "3550379001"
        loan.origination_date = "2023-05-26"
        loan.servicer_start_date = "2024-10-01"
        loan.original_amount = 463_428.32
        loan.current_balance = 438_502.37
        loan.interest_rate = 7.625
        loan.monthly_payment = 4_274.51
        loan.escrow_amount = 0
        loan.principal_due = 0
        loan.interest_due = 0
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/debt", headers=auth_headers(user.email))

        assert resp.status_code == 200
        current_year = date.today().year
        rows = resp.json()["loans"][0]["paydown"]["rows"]
        ytd_row = next(row for row in rows if row["year"] == current_year and row["isCurrentYear"])
        projected_row = next(row for row in rows if row["yearLabel"] == f"{current_year} Projected")
        assert projected_row["isFullYearProjection"] is True
        assert projected_row["interestPaid"] > ytd_row["interestPaid"]
        assert projected_row["principalPaid"] > ytd_row["principalPaid"]
        assert projected_row["endingBalance"] < ytd_row["endingBalance"]
        assert any(row["yearLabel"] == f"{current_year} Projected" for row in resp.json()["yearlyPrincipalInterestRows"])
