import json
from datetime import date

import models
from services.annual_usage_engine import build_annual_usage_records
from tests.conftest import auth_headers


AS_OF = date(2026, 7, 10)


def _by_year(prop):
    return {row["year"]: row for row in build_annual_usage_records(prop, as_of=AS_OF)}


def _tax(db, user, prop, year, rent=0, days=None, personal=None, explicit_fields=None):
    entry = models.TaxReturnEntry(
        owner_id=user.id,
        property_id=prop.id,
        tax_year=year,
        address=prop.address,
        property_kind="rental",
        rents_received=rent,
        days_rented=days,
        personal_use_days=personal,
        source_refs=json.dumps({field: {"source": "test"} for field in (explicit_fields or [])}),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    db.refresh(prop)
    return entry


def _lease(db, prop, start_year, start_month, end_year=None, end_month=None):
    lease = models.RentalPeriod(
        property_id=prop.id,
        start_year=start_year,
        start_month=start_month,
        end_year=end_year,
        end_month=end_month,
        monthly_rent=2_900,
    )
    db.add(lease)
    db.commit()
    db.refresh(prop)
    return lease


def test_missing_schedule_e_days_remain_unknown(db, user, prop):
    _tax(db, user, prop, 2025, rent=17_400)

    row = _by_year(prop)[2025]

    assert row["rentReceived"]["value"] == 17_400
    assert row["rentalDays"]["value"] is None
    assert row["rentalDays"]["status"] == "unknown"
    assert row["display"]["rentalDays"] == "—"


def test_explicit_schedule_e_zero_remains_zero(db, user, prop):
    _tax(db, user, prop, 2025, rent=17_400, days=0, explicit_fields=["days_rented"])

    row = _by_year(prop)[2025]

    assert row["rentalDays"]["value"] == 0
    assert row["rentalDays"]["source"] == "schedule_e"
    assert row["rentalDays"]["status"] == "reported"
    assert any(issue["type"] == "rent_with_zero_days" for issue in row["discrepancies"])


def test_row_uses_schedule_e_for_rent_and_leases_for_rental_days(db, user, prop):
    _tax(db, user, prop, 2025, rent=17_400)
    _lease(db, prop, 2025, 1, 2025, 3)
    _lease(db, prop, 2025, 10, 2026, 4)

    row = _by_year(prop)[2025]

    assert row["rentReceived"] == {"value": 17_400, "source": "schedule_e", "status": "reported"}
    assert row["rentalDays"]["value"] == 182
    assert row["rentalDays"]["source"] == "leases"
    assert row["rentalDays"]["status"] == "calculated"
    assert row["coverageDisplay"] == "6 of 12 months"


def test_lease_spanning_calendar_years(db, prop):
    _lease(db, prop, 2025, 10, 2026, 4)

    rows = _by_year(prop)

    assert rows[2025]["leaseCoveredDays"] == 92
    assert rows[2026]["leaseCoveredDays"] == 120


def test_open_ended_current_lease_stops_at_as_of_date(db, prop):
    _lease(db, prop, 2026, 1)

    row = _by_year(prop)[2026]

    assert row["rentalDays"]["value"] == 191
    assert row["display"]["rentalDays"] == "191 days YTD"
    assert row["coverageDisplay"] == "7 of 7 elapsed months"


def test_overlapping_leases_are_merged(db, prop):
    _lease(db, prop, 2025, 1, 2025, 3)
    _lease(db, prop, 2025, 3, 2025, 4)

    row = _by_year(prop)[2025]

    assert row["rentalDays"]["value"] == 120
    assert any(issue["type"] == "overlapping_leases" for issue in row["discrepancies"])


def test_adjacent_leases_do_not_create_vacancy_day(db, prop):
    _lease(db, prop, 2025, 1, 2025, 3)
    _lease(db, prop, 2025, 4, 2025, 6)

    row = _by_year(prop)[2025]

    assert row["rentalDays"]["value"] == 181
    assert not any(issue["type"] == "overlapping_leases" for issue in row["discrepancies"])


def test_future_lease_dates_are_not_counted_as_actual(db, user, prop):
    _tax(db, user, prop, 2026, rent=10_000)
    _lease(db, prop, 2026, 8, 2026, 12)

    row = _by_year(prop)[2026]

    assert row["leaseCoveredDays"] == 0
    assert row["rentalDays"]["value"] is None
    assert any(issue["type"] == "rent_with_unknown_days" for issue in row["discrepancies"])


def test_leap_year_full_calendar_lease(db, prop):
    _lease(db, prop, 2024, 1, 2024, 12)

    row = _by_year(prop)[2024]

    assert row["calendarDays"] == 366
    assert row["rentalDays"]["value"] == 366


def test_usage_periods_endpoint_returns_canonical_annual_usage(client, db, user, prop):
    _tax(db, user, prop, 2025, rent=17_400)
    _lease(db, prop, 2025, 1, 2025, 3)
    _lease(db, prop, 2025, 10, 2025, 12)

    resp = client.get(
        f"/api/properties/{prop.id}/usage-periods",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    row = next(item for item in resp.json()["annual_usage"] if item["year"] == 2025)
    assert row["rentReceived"]["source"] == "schedule_e"
    assert row["rentalDays"]["value"] == 182
    assert row["rentalDays"]["source"] == "leases"
    assert row["rentalDays"]["status"] == "calculated"
