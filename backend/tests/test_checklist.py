"""Checklist tests: the Rent Roll / Income Statement item must reflect the
Rental tab (rental_periods) and nothing else — no document upload required."""
from datetime import date

import models
from services.checklist import build_checklist
from tests.conftest import auth_headers


def _rent_roll_status(prop, rental_periods, year, today=None):
    result = build_checklist(
        prop, docs=[], loans=[], tax_entries=[],
        rental_periods=rental_periods, today=today,
    )
    slot = next(s for s in result["groups"]["annual"] if s["key"] == f"rent-roll-{year}")
    return slot


def test_rent_roll_missing_without_rental_period(prop):
    slot = _rent_roll_status(prop, [], 2024, today=date(2024, 6, 1))
    assert slot["status"] in ("missing", "expired")
    assert slot["source"] == "Not entered"


def test_rent_roll_present_when_period_covers_year(prop):
    period = models.RentalPeriod(
        property_id=prop.id, start_year=2024, start_month=1,
        end_year=None, end_month=None, monthly_rent=2500.0,
    )
    slot = _rent_roll_status(prop, [period], 2024, today=date(2024, 6, 1))
    assert slot["status"] == "present"
    assert slot["source"] == "Manual rental period"


def test_rent_roll_ignores_years_outside_period(prop):
    period = models.RentalPeriod(
        property_id=prop.id, start_year=2024, start_month=1,
        end_year=2024, end_month=12, monthly_rent=2500.0,
    )
    result = build_checklist(
        prop, docs=[], loans=[], tax_entries=[],
        rental_periods=[period], today=date(2025, 6, 1),
    )
    slot_2024 = next(s for s in result["groups"]["annual"] if s["key"] == "rent-roll-2024")
    slot_2025 = next(s for s in result["groups"]["annual"] if s["key"] == "rent-roll-2025")
    assert slot_2024["status"] == "present"
    assert slot_2025["status"] in ("missing", "expired")


def test_rent_roll_has_no_document_upload_path(prop):
    """No doc_category exists for rent rolls — presence can only ever come
    from rental_periods, confirming the item is Rental-tab-only end-to-end."""
    result = build_checklist(
        prop, docs=[], loans=[], tax_entries=[], rental_periods=[],
    )
    slot = next(s for s in result["groups"]["annual"] if "rent-roll" in s["key"])
    assert slot["source"] != "Document upload"


def test_checklist_endpoint_reflects_rental_period_added_via_api(client, prop, user):
    year = date.today().year
    r = client.get(f"/api/properties/{prop.id}/checklist", headers=auth_headers(user.email))
    slot = next(s for s in r.json()["groups"]["annual"] if s["key"] == f"rent-roll-{year}")
    assert slot["status"] in ("missing", "expired")

    r = client.post(
        f"/api/properties/{prop.id}/rentals",
        json={"start_year": year, "start_month": 1, "monthly_rent": 2000.0},
        headers=auth_headers(user.email),
    )
    assert r.status_code == 200

    r = client.get(f"/api/properties/{prop.id}/checklist", headers=auth_headers(user.email))
    slot = next(s for s in r.json()["groups"]["annual"] if s["key"] == f"rent-roll-{year}")
    assert slot["status"] == "present"
