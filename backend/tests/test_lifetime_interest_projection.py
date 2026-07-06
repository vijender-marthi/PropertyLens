"""Lifetime summary: total interest paid must fall back to an amortization
projection when a loan has no 1098, tax return, or mortgage-statement
interest on file — e.g. a property whose loan was entered manually (via the
Add Property form) and never had a statement document uploaded, so
`interest_due`/`principal_due` are both None.

Before this fix, `total_interest_paid` silently reported $0 for such a loan
even though its rate and balance were known and a real interest figure could
be projected from them.
"""
from tests.conftest import auth_headers
import models


class TestLifetimeInterestProjectedWithoutDocuments:
    def test_no_statement_data_still_projects_nonzero_interest(self, client, db, user, prop):
        loan = prop.loans[0]
        loan.interest_due = None
        loan.principal_due = None
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        lifetime = resp.json()["lifetime"]

        assert lifetime["total_interest_paid"] > 0
        assert lifetime["total_principal_paid"] > 0
