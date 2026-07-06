"""Depreciation only applies to rental-use property. Verifies:
  1. A property that has always been a primary residence shows nothing in
     the Depreciation section.
  2. A property that switched rental -> primary -> rental -> primary only
     accrues depreciation for the years it was actually a rental, and
     retains the depreciation history from its rental years even while
     currently primary.
"""
import uuid

from tests.conftest import auth_headers
import models


def _make_property(db, user, usage_type="Rental"):
    p = models.Property(
        owner_id=user.id,
        property_uid=str(uuid.uuid4()),
        name="Switching Property",
        address="456 Test Ave",
        city="Testville",
        state="TX",
        purchase_date="2018-01-01",
        purchase_price=300_000.0,
        market_value=350_000.0,
        monthly_rent=0.0,
        occupancy_rate=0.0,
        property_tax=4_000.0,
        insurance=1_000.0,
        hoa_history="[]",
        hoa_special_assessment=0.0,
        solar_ownership="None",
        solar_monthly_payment=0.0,
        solar_purchase_price=0.0,
        land_value=60_000.0,
        depreciation_years=27.5,
        usage_type=usage_type,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


class TestAlwaysPrimaryHasNoDepreciation:
    def test_depreciation_endpoint_not_eligible(self, client, db, user):
        prop = _make_property(db, user, usage_type="Primary")

        resp = client.get(f"/api/properties/{prop.id}/depreciation",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert data["eligible"] is False
        assert data["assets"] == []
        assert data["timeline"] == []
        assert data["rollup"]["total_current_year_depreciation"] == 0.0

    def test_lifetime_yearly_depreciation_is_zero(self, client, db, user):
        prop = _make_property(db, user, usage_type="Primary")

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        for row in resp.json()["yearly"]:
            assert row["depreciation"] == 0.0


class TestSwitchingRentalPrimaryHistory:
    def test_only_rental_years_accrue_depreciation(self, client, db, user):
        prop = _make_property(db, user, usage_type="Primary")
        # Rented 2018-2019, lived in it 2020-2021, rented again 2022-2023,
        # back to primary since 2024 (usage_type reflects the current state).
        db.add(models.RentalPeriod(
            property_id=prop.id, start_year=2018, start_month=1,
            end_year=2019, end_month=12, monthly_rent=2_000.0,
        ))
        db.add(models.RentalPeriod(
            property_id=prop.id, start_year=2022, start_month=1,
            end_year=2023, end_month=12, monthly_rent=2_200.0,
        ))
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/depreciation",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert data["eligible"] is True
        assert data["currently_rental"] is False  # primary again since 2024

        timeline_by_year = {row["year"]: row for row in data["timeline"]}
        assert timeline_by_year[2018]["total"] > 0
        assert timeline_by_year[2019]["total"] > 0
        assert timeline_by_year[2020]["total"] == 0
        assert timeline_by_year[2021]["total"] == 0
        assert timeline_by_year[2022]["total"] > 0
        assert timeline_by_year[2023]["total"] > 0

        assert timeline_by_year[2018]["is_rental_year"] is True
        assert timeline_by_year[2020]["is_rental_year"] is False

        # Past rental history is preserved even though the property is
        # primary right now.
        building = next(a for a in data["assets"] if a["description"] == "Building")
        assert building["accumulated_depreciation"] > 0

    def test_lifetime_endpoint_zeroes_out_primary_years(self, client, db, user):
        prop = _make_property(db, user, usage_type="Primary")
        db.add(models.RentalPeriod(
            property_id=prop.id, start_year=2018, start_month=1,
            end_year=2019, end_month=12, monthly_rent=2_000.0,
        ))
        db.commit()

        resp = client.get(f"/api/properties/{prop.id}/lifetime",
                          headers=auth_headers(user.email))
        assert resp.status_code == 200
        rows = {r["year"]: r for r in resp.json()["yearly"]}
        if 2018 in rows:
            assert rows[2018]["depreciation"] > 0
        if 2020 in rows:
            assert rows[2020]["depreciation"] == 0.0
