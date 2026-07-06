"""Regression coverage for the Uploads page's quick "Loan Details" entry
form (UploadsPage.jsx `handleLoanSave`). That form only exposes four
inputs — original amount, current balance, interest rate, monthly P&I —
but the backend's LoanBase schema requires `original_amount`,
`current_balance`, `interest_rate`, `monthly_payment`, and
`loan_term_years` on every create/update. A prior bug sent the loan
amount under the wrong key (`original_loan_amount`) and never sent
`loan_term_years` at all, so every save 422'd and the amount never
persisted. These tests pin the payload shape the frontend actually
sends now, so a future schema change that breaks this contract fails
loudly instead of silently 422ing again.
"""
from tests.conftest import auth_headers


class TestManualLoanEntryPayloadShape:
    def test_add_loan_with_quick_entry_payload_succeeds(self, client, db, user):
        import models
        prop = models.Property(owner_id=user.id, property_uid="test-uid-1",
                                name="Quick Entry Test", address="1 Test St",
                                usage_type="Rental")
        db.add(prop)
        db.commit()
        db.refresh(prop)

        payload = {
            "loan_type": "Fixed",
            "interest_rate": 6.5,
            "original_amount": 500000,
            "current_balance": 480000,
            "monthly_payment": 3160.34,
            "loan_term_years": 30,
        }
        resp = client.post(f"/api/properties/{prop.id}/loans", json=payload,
                            headers=auth_headers(user.email))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["original_amount"] == 500000
        assert body["current_balance"] == 480000

    def test_update_loan_preserves_fields_not_in_quick_entry_form(self, client, db, user, prop):
        """Updating via the quick-entry form must not wipe out fields the
        form doesn't expose (escrow, account number, statement data, etc.),
        since PUT /loans/{id} fully replaces the record."""
        loan = prop.loans[0]
        loan.escrow_amount = 450.0
        loan.account_number = "ACCT-999"
        db.commit()
        db.refresh(loan)

        # Fetch through the API, same as the frontend does (properties.find(...).loans[0])
        prop_resp = client.get(f"/api/properties/{prop.id}", headers=auth_headers(user.email))
        existing = prop_resp.json()["loans"][0]
        payload = {
            **existing,
            "loan_type": "Fixed",
            "interest_rate": 7.0,
            "original_amount": 320000,
            "current_balance": 295000,
            "monthly_payment": 2100.0,
            "loan_term_years": loan.loan_term_years or 30,
        }
        payload.pop("id", None)
        payload.pop("property_id", None)

        resp = client.put(f"/api/properties/{prop.id}/loans/{loan.id}", json=payload,
                           headers=auth_headers(user.email))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["current_balance"] == 295000
        assert body["escrow_amount"] == 450.0
        assert body["account_number"] == "ACCT-999"
