"""Golden checks for the Master Verification Suite.

These pin the high-risk regressions surfaced in the UI Verify tab:
cross-tab loan/tax tie-outs, stabilized cash-flow period consistency, and
multi-year amortization from loan start date.
"""

import datetime as dt

import pytest

from tests.conftest import auth_headers
from routers.properties import compute_property_metrics


def test_a5_lifetime_loan_tax_tie_outs(client, user, prop):
    resp = client.get(f"/api/properties/{prop.id}/lifetime", headers=auth_headers(user.email))
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    yearly = payload["yearly"]
    latest = yearly[-1]

    assert payload["lifetime"]["current_loan_balance"] == pytest.approx(latest["loan_balance"], abs=1)

    for row in yearly:
        loan_interest = sum(loan.get("interest_paid", 0) for loan in row.get("loans", []))
        loan_principal = sum(loan.get("principal_paid", 0) for loan in row.get("loans", []))
        assert loan_interest == pytest.approx(row["interest_paid"], abs=1)
        assert loan_principal == pytest.approx(row["principal_paid"], abs=1)


def test_b2_stabilized_cash_flow_uses_full_year_debt_service(prop):
    metrics = compute_property_metrics(prop)
    annual_debt_service = metrics["monthly_mortgage"] * 12
    stabilized_annual = metrics["annual_noi"] - annual_debt_service
    stabilized_monthly = stabilized_annual / 12

    assert metrics["annual_cash_flow"] == pytest.approx(stabilized_annual, abs=1)
    assert metrics["monthly_cash_flow"] == pytest.approx(stabilized_monthly, abs=1)
    assert stabilized_monthly == pytest.approx(stabilized_annual / 12, abs=1)


def test_d3_amortization_populates_every_active_year(client, db, user, prop):
    loan = prop.loans[0]
    loan.origination_date = "2022-01-01"
    loan.original_amount = 320_000
    loan.current_balance = 0
    loan.interest_rate = 6.5
    loan.monthly_payment = 2_023
    loan.principal_due = None
    loan.interest_due = None
    db.commit()

    resp = client.get(f"/api/properties/{prop.id}/lifetime", headers=auth_headers(user.email))
    assert resp.status_code == 200, resp.text
    rows = [row for row in resp.json()["yearly"] if 2022 <= row["year"] <= dt.date.today().year]

    assert rows
    assert all(row["interest_paid"] > 0 for row in rows)
    assert all(row["principal_paid"] > 0 for row in rows)
