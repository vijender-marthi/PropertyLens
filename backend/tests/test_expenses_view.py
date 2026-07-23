from datetime import date

import models
from tests.conftest import auth_headers


def test_expenses_view_uses_resolved_current_year_opex(client, db, user, prop):
    current_year = date.today().year
    row = models.AnnualExpense(
        property_id=prop.id,
        owner_id=user.id,
        year=current_year,
        property_tax=6100,
        insurance=1500,
        repairs_maintenance=900,
        property_management=1200,
        utilities=600,
        vacancy_allowance=400,
        capex_reserve=800,
        other=100,
        property_tax_source="reported",
        insurance_source="escrow_estimate",
    )
    db.add(row)
    prop.purchase_date = f"{current_year - 2}-05-01"
    db.commit()

    resp = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email))

    assert resp.status_code == 200
    data = resp.json()
    assert data["metrics"]["operatingExpenses"]["value"] == 11600
    assert data["metrics"]["largestCategory"]["key"] == "property_tax"
    assert data["assertions"]["tabTotalMatchesResolvedOpex"] is True
    current = next(item for item in data["rows"] if item["year"] == current_year)
    assert current["status"] == "Current"
    assert current["propertyTax"]["source"]["tier"] == "REPORTED"
    assert current["insurance"]["source"]["tier"] == "ESTIMATE"


def test_expenses_view_keeps_blank_years_blank(client, db, user, prop):
    current_year = date.today().year
    prop.purchase_date = f"{current_year - 1}-01-01"
    db.commit()

    resp = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email))

    assert resp.status_code == 200
    data = resp.json()
    prior = next(item for item in data["rows"] if item["year"] == current_year - 1)
    assert prior["status"] == "Not entered"
    assert prior["total"] is None
    assert prior["propertyTax"]["display"] == "—"


def test_expenses_view_distinguishes_entered_zero_from_not_entered(client, db, user, prop):
    current_year = date.today().year
    year = current_year - 1
    prop.purchase_date = f"{year}-01-01"
    db.add(models.AnnualExpense(
        property_id=prop.id,
        owner_id=user.id,
        year=year,
        property_tax=0,
        insurance=0,
        repairs_maintenance=0,
        property_management=0,
        utilities=0,
        vacancy_allowance=0,
        capex_reserve=0,
        other=0,
    ))
    db.commit()

    resp = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email))

    assert resp.status_code == 200
    row = next(item for item in resp.json()["rows"] if item["year"] == year)
    assert row["status"] == "Entered"
    assert row["propertyTax"]["display"] == "$0"
    assert row["totalDisplay"] == "$0"


def test_expenses_view_reports_escrow_and_hides_rental_ratio_for_primary(client, db, user, prop):
    prop.usage_type = "Primary"
    prop.loans[0].monthly_property_tax_escrow = 500
    prop.loans[0].monthly_insurance_escrow = 125
    db.commit()

    resp = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email))

    assert resp.status_code == 200
    data = resp.json()
    assert data["isPrimaryResidence"] is True
    assert data["metrics"]["expenseRatio"]["hidden"] is True
    assert data["metrics"]["inEscrow"]["value"] == 7500


def test_expenses_view_flags_material_property_tax_year_over_year_changes(client, db, user, prop):
    current_year = date.today().year
    prop.purchase_date = f"{current_year - 3}-01-01"
    for year, tax in [
        (current_year - 3, 24757),
        (current_year - 2, 25074),
        (current_year - 1, 12607),
    ]:
        db.add(models.AnnualExpense(
            property_id=prop.id,
            owner_id=user.id,
            year=year,
            property_tax=tax,
            insurance=2000,
            hoa=1440,
            property_tax_source="reported",
        ))
    db.commit()

    resp = client.get(f"/api/properties/{prop.id}/expenses-view", headers=auth_headers(user.email))

    assert resp.status_code == 200
    rows = {row["year"]: row for row in resp.json()["rows"]}
    assert rows[current_year - 2]["comments"] == []
    drop_row = rows[current_year - 1]
    assert drop_row["comments"][0]["type"] == "PROPERTY_TAX_YOY_VARIANCE"
    assert drop_row["comments"][0]["previousValue"] == 25074
    assert drop_row["comments"][0]["currentValue"] == 12607
    assert "dropped" in drop_row["comments"][0]["message"]
    assert drop_row["commentSummary"] == "Review property tax"
