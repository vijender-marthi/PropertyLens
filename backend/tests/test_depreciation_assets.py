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


def test_add_roof_improvement_uses_independent_prorated_schedule(client, user, prop):
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
    assert roof["current_year_depreciation"] == pytest.approx(1272.73, abs=0.01)


def test_depreciation_spec_assertions_for_multi_year_residential_rental(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="mission-depreciation-test",
        name="Mission Lane",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        purchase_date="2023-05-24",
        purchase_price=625_000,
        market_value=700_000,
        monthly_rent=3_200,
        occupancy_rate=100,
        property_tax=6_000,
        insurance=1_200,
        hoa_history="[]",
        hoa_special_assessment=0,
        solar_ownership="None",
        solar_monthly_payment=0,
        solar_purchase_price=0,
        land_value=0,
        depreciation_years=27.5,
        usage_type="Rental",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)

    resp = client.get(
        f"/api/properties/{prop.id}/depreciation?tax_year=2026",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    annual = round(625_000 / 27.5, 2)
    first_year = round(annual * 7.5 / 12, 2)
    expected_accumulated = round(first_year + annual * 3, 2)
    building = next(a for a in data["assets"] if a["description"] == "Building")
    assert building["annual_depreciation"] == pytest.approx(annual, abs=0.01)
    assert data["hero"]["currentYearDeduction"]["value"] == pytest.approx(annual, abs=0.01)
    assert building["accumulated_depreciation"] == pytest.approx(expected_accumulated, abs=0.01)
    assert data["hero"]["accumulatedDepreciation"]["value"] == pytest.approx(expected_accumulated, abs=0.01)
    assert data["hero"]["recaptureAtSale"]["value"] == pytest.approx(expected_accumulated * 0.25, abs=0.01)
    assert data["hero"]["remainingBasis"]["value"] == pytest.approx(625_000 - expected_accumulated, abs=0.01)
    timeline_by_year = {row["year"]: row for row in data["timeline"]}
    assert timeline_by_year[2023]["Building"] == pytest.approx(first_year, abs=0.01)
    assert timeline_by_year[2024]["Building"] == pytest.approx(annual, abs=0.01)
    assert timeline_by_year[2025]["Building"] == pytest.approx(annual, abs=0.01)
    assert timeline_by_year[2026]["Building"] == pytest.approx(annual, abs=0.01)
    assert timeline_by_year[2051]["Building"] == pytest.approx(0, abs=0.01)
    assert all(assertion["passed"] for key, assertion in data["assertions"].items() if key != "A7")
    assert "enter land value" in data["flags"]


def test_improvement_timeline_starts_in_service_year_as_stacked_segment(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="mission-roof-test",
        name="Mission Lane Roof",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        purchase_date="2023-05-24",
        purchase_price=625_000,
        market_value=700_000,
        monthly_rent=3_200,
        occupancy_rate=100,
        property_tax=6_000,
        insurance=1_200,
        hoa_history="[]",
        hoa_special_assessment=0,
        solar_ownership="None",
        solar_monthly_payment=0,
        solar_purchase_price=0,
        land_value=0,
        depreciation_years=27.5,
        usage_type="Rental",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)

    resp = client.post(
        f"/api/properties/{prop.id}/depreciation-assets",
        headers=auth_headers(user.email),
        json={
            "asset_type": "depreciation",
            "description": "Roof",
            "placed_in_service_date": "2026-07-01",
            "cost_basis": 34_540,
            "land_portion": 0,
            "method": "SL",
            "recovery_period": 27.5,
            "prior_depreciation": 0,
            "notes": "",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    roof = next(a for a in data["assets"] if a["description"] == "Roof")
    assert roof["annual_depreciation"] == pytest.approx(1256, abs=0.01)
    timeline_by_year = {row["year"]: row for row in data["timeline"]}
    assert timeline_by_year[2025]["Roof"] == pytest.approx(0, abs=0.01)
    assert timeline_by_year[2026]["Roof"] == pytest.approx(628, abs=0.01)
    assert timeline_by_year[2027]["Roof"] == pytest.approx(1256, abs=0.01)
    assert "Building" in data["timeline_asset_keys"]
    assert "Roof" in data["timeline_asset_keys"]
    assert data["assertions"]["A2"]["passed"] is True
    assert data["assertions"]["A6"]["passed"] is True


def test_depreciation_excludes_land_value_assertion(client, db, user):
    prop = models.Property(
        owner_id=user.id,
        property_uid="mission-land-test",
        name="Mission Lane With Land",
        address="10575 E Mission Ln",
        city="Scottsdale",
        state="AZ",
        purchase_date="2023-05-24",
        purchase_price=625_000,
        market_value=700_000,
        monthly_rent=3_200,
        occupancy_rate=100,
        property_tax=6_000,
        insurance=1_200,
        hoa_history="[]",
        hoa_special_assessment=0,
        solar_ownership="None",
        solar_monthly_payment=0,
        solar_purchase_price=0,
        land_value=125_000,
        depreciation_years=27.5,
        usage_type="Rental",
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)

    resp = client.get(
        f"/api/properties/{prop.id}/depreciation?tax_year=2026",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()
    building = next(a for a in data["assets"] if a["description"] == "Building")
    assert building["depreciable_basis"] == pytest.approx(500_000)
    assert data["rollup"]["depreciable_basis"] != pytest.approx(625_000)
    assert data["assertions"]["A7"]["passed"] is True


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
