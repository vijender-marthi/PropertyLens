import pytest

import models
from tests.conftest import auth_headers


def test_depreciation_schedule_includes_base_building(client, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/depreciation?tax_year=2024",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    building = next(a for a in data["assets"] if a["description"] == "Building")
    assert building["is_base_building"] is True
    assert building["depreciable_basis"] == pytest.approx(320_000)
    assert building["annual_depreciation"] == pytest.approx(11_636.36, abs=0.01)
    assert data["rollup"]["total_current_year_depreciation"] > 0


def test_add_roof_improvement_uses_independent_mid_month_schedule(client, user, prop):
    resp = client.post(
        f"/api/properties/{prop.id}/depreciation-assets",
        headers=auth_headers(user.email),
        json={
            "asset_type": "depreciation",
            "description": "Roof replacement",
            "placed_in_service_date": "2024-07-10",
            "cost_basis": 70_000,
            "land_portion": 0,
            "method": "SL",
            "recovery_period": 27.5,
            "prior_depreciation": 0,
            "notes": "",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    roof = next(a for a in data["assets"] if a["description"] == "Roof replacement")
    assert roof["depreciable_basis"] == pytest.approx(70_000)
    assert roof["annual_depreciation"] == pytest.approx(2545.45, abs=0.01)
    assert roof["warning"]

    resp = client.get(
        f"/api/properties/{prop.id}/depreciation?tax_year=2024",
        headers=auth_headers(user.email),
    )
    roof = next(a for a in resp.json()["assets"] if a["description"] == "Roof replacement")
    assert roof["current_year_depreciation"] == pytest.approx(1166.67, abs=0.01)


def test_schedule_e_comparison_flags_delta(client, db, user, prop):
    db.add(models.TaxReturnEntry(
        owner_id=user.id,
        property_id=prop.id,
        tax_year=2024,
        address=prop.address,
        property_kind="rental",
        depreciation=10_000,
    ))
    db.commit()

    resp = client.get(
        f"/api/properties/{prop.id}/depreciation?tax_year=2024",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    comparison = resp.json()["schedule_e"]
    assert comparison["line_18_depreciation"] == pytest.approx(10_000)
    assert comparison["status"] == "diff"
    assert comparison["delta"] != 0
