from datetime import date
from types import SimpleNamespace

import models
from services.rental_timeline import build_rental_timeline
from tests.conftest import auth_headers


def test_rental_timeline_calculates_occupancy_and_vacancy_months_backend_owned():
    prop = SimpleNamespace(
        usage_type="Rental",
        purchase_date="2025-01-01",
        rental_start_date=None,
        usage_periods=[
            SimpleNamespace(
                usage_type="RENTAL",
                start_date="2025-01-01",
                end_date="2025-12-31",
            )
        ],
        rental_periods=[
            SimpleNamespace(
                id=1,
                tenant_name=None,
                start_year=2025,
                start_month=1,
                end_year=2025,
                end_month=3,
                monthly_rent=2000,
                notes=None,
            ),
            SimpleNamespace(
                id=2,
                tenant_name="Optional label",
                start_year=2025,
                start_month=7,
                end_year=2025,
                end_month=12,
                monthly_rent=2200,
                notes="renewal",
            ),
        ],
    )

    timeline = build_rental_timeline(prop, as_of=date(2025, 12, 31))

    assert timeline["summary"]["occupiedMonths"]["value"] == 9
    assert timeline["summary"]["vacantMonths"]["value"] == 3
    assert timeline["summary"]["occupancyPercent"]["display"] == "75%"
    assert timeline["summary"]["vacancyPercent"]["display"] == "25%"
    assert timeline["summary"]["currentStatus"]["display"] == "Vacant"
    assert timeline["summary"]["currentRent"]["display"] == "$2,200"
    assert timeline["timeline"][0]["occupiedMonths"] == 9
    assert timeline["timeline"][0]["vacantMonths"] == 3
    assert timeline["timeline"][0]["rentReceivedDisplay"] == "$19,200"
    assert timeline["timelineTotals"]["occupiedMonths"] == 9
    assert timeline["timelineTotals"]["vacantMonths"] == 3
    assert timeline["timelineTotals"]["rentReceivedDisplay"] == "$19,200"
    assert timeline["timelineTotals"]["expectedRentDisplay"] == "$26,400"
    assert timeline["timelineTotals"]["vacancyLossDisplay"] == "$7,200"
    assert timeline["timelineTotals"]["rentAssertion"]["status"] == "valid"
    assert any(row["status"] == "vacant" and row["derived"] is True for row in timeline["periods"])
    assert timeline["schemaVersion"] == "rental-performance.v2"
    assert timeline["title"] == "Rental Performance"
    assert timeline["timeline"][0]["months"][0]["tooltip"]["status"] == "Occupied"
    assert timeline["storyLead"] == "75% occupied over 12 months, currently $2,200/mo, only 3 months vacant since Jan 2025."
    assert [item["label"] for item in timeline["heroKpis"]] == ["Occupancy %", "Current rent", "Status", "Rented since"]
    assert timeline["insightLine"] == "Rental performance needs review — 75% occupancy, longest vacancy 3 months, ~$6,400 lost to vacancy."
    assert timeline["timeline"][0]["months"][0]["tooltip"]["period"] == "Lease Jan 2025 → Mar 2025"
    assert timeline["timeline"][0]["months"][3]["canAddPeriod"] is True
    assert timeline["timeline"][0]["months"][3]["status"] == "vacant"
    assert [item["label"] for item in timeline["insights"]] == [
        "Occupancy %",
        "Rental Available Months",
        "Occupied Months",
        "Derived Vacancy Months",
        "Longest Vacancy",
        "Estimated Vacancy Cost",
    ]
    assert timeline["recommendations"]
    assert "tenantName" not in timeline["periods"][0]


def test_rental_timeline_rejects_overlapping_period_create(client, db, user, prop):
    db.add(models.RentalPeriod(property_id=prop.id, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000))
    db.commit()

    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "occupied", "start_date": "2025-03-01", "end_date": "2025-04-30", "monthly_rent": 2100},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "RENTAL_PERIOD_OVERLAP"
    assert resp.json()["detail"]["conflicts"][0]["status"] == "occupied"


def test_rental_timeline_accepts_open_ended_occupancy_inside_open_ended_setup_range(client, db, user, prop):
    prop.usage_type = "Mixed Use"
    prop.rental_start_date = "2023-05-24"
    prop.rental_end_date = None
    prop.purchase_date = "2023-05-24"
    db.commit()

    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "occupied", "start_date": "2023-07-01", "end_date": "", "monthly_rent": 3200},
    )

    assert resp.status_code == 200
    assert resp.json()["summary"]["currentStatus"]["display"] == "Occupied"
    occupied = [row for row in resp.json()["periods"] if row["status"] == "occupied"]
    vacancy = [row for row in resp.json()["periods"] if row["status"] == "vacant"]
    assert occupied[0]["startDate"] == "2023-07-01"
    assert occupied[0]["endDate"] is None
    assert any(row["startDate"] == "2023-05-24" and row["endDate"] == "2023-06-30" for row in vacancy)


def test_rental_timeline_rejects_start_before_setup_range_on_start_date(client, db, user, prop):
    prop.rental_start_date = "2023-05-24"
    prop.rental_end_date = None
    db.commit()

    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "occupied", "start_date": "2023-05-01", "end_date": None, "monthly_rent": 3200},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["field"] == "startDate"
    assert resp.json()["detail"]["message"] == "Occupied period cannot begin before May 24, 2023."


def test_rental_timeline_rejects_end_before_start_on_end_date(client, user, prop):
    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "occupied", "start_date": "2025-04-01", "end_date": "2025-03-31", "monthly_rent": 3200},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["field"] == "endDate"
    assert resp.json()["detail"]["message"] == "End date must be on or after the start date."


def test_rental_timeline_rejects_open_ended_occupancy_when_setup_range_is_closed(client, db, user, prop):
    prop.rental_start_date = "2023-05-24"
    prop.rental_end_date = "2026-07-31"
    db.commit()

    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "occupied", "start_date": "2023-07-01", "end_date": "", "monthly_rent": 3200},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["field"] == "endDate"
    assert resp.json()["detail"]["message"] == "Enter an end date on or before Jul 31, 2026."


def test_rental_timeline_accepts_finite_occupied_period_inside_finite_setup_range(client, db, user, prop):
    prop.rental_start_date = "2023-05-24"
    prop.rental_end_date = "2026-07-31"
    db.commit()

    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "occupied", "start_date": "2023-07-01", "end_date": "2026-07-31", "monthly_rent": 3200},
    )

    assert resp.status_code == 200
    assert any(row["status"] == "occupied" and row["startDate"] == "2023-07-01" for row in resp.json()["periods"])


def test_rental_timeline_rejects_manual_vacancy_and_derives_gap(client, db, user, prop):
    db.add(models.RentalPeriod(property_id=prop.id, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000))
    db.commit()

    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "vacant", "start_date": "2025-04-01", "end_date": "2025-05-31", "monthly_rent": 0},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "RENTAL_PERIOD_INVALID"

    dto_prop = SimpleNamespace(
        usage_type="Rental",
        purchase_date="2025-01-01",
        rental_start_date=None,
        usage_periods=[SimpleNamespace(usage_type="RENTAL", start_date="2025-01-01", end_date="2025-05-31")],
        rental_periods=[SimpleNamespace(id=1, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000, notes=None)],
    )
    timeline = build_rental_timeline(dto_prop, as_of=date(2025, 5, 31))
    assert timeline["summary"]["vacantMonths"]["value"] == 2
    assert timeline["timeline"][0]["months"][3]["status"] == "vacant"
    assert timeline["timeline"][0]["months"][3]["derived"] is True
    assert any(row["status"] == "vacant" and row["source"] == "auto" for row in timeline["periods"])


def test_rental_timeline_excludes_not_rental_from_occupancy_denominator():
    prop = SimpleNamespace(
        usage_type="Rental",
        purchase_date="2025-01-01",
        rental_start_date=None,
        usage_periods=[
            SimpleNamespace(usage_type="RENTAL", start_date="2025-01-01", end_date="2025-06-30"),
            SimpleNamespace(usage_type="NOT_RENTAL", start_date="2025-04-01", end_date="2025-05-31", notes="Renovation"),
        ],
        rental_periods=[
            SimpleNamespace(id=1, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000, notes=None),
        ],
    )

    timeline = build_rental_timeline(prop, as_of=date(2025, 6, 30))

    assert timeline["summary"]["availableMonths"]["value"] == 4
    assert timeline["summary"]["occupiedMonths"]["value"] == 3
    assert timeline["summary"]["vacantMonths"]["value"] == 1
    assert timeline["summary"]["occupancyPercent"]["display"] == "75%"
    assert timeline["timeline"][0]["months"][3]["status"] == "not_rental"
    assert any(row["status"] == "not_rental" for row in timeline["periods"])
    assert any(row["status"] == "vacant" and row["derived"] is True for row in timeline["periods"])


def test_rental_timeline_rejects_not_rental_period_create(client, user, prop):
    resp = client.post(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"status": "not_rental", "start_date": "2025-04-01", "end_date": "2025-05-31", "notes": "Renovation"},
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "RENTAL_PERIOD_INVALID"


def test_rental_timeline_current_status_and_rent_derive_from_latest_period():
    prop = SimpleNamespace(
        usage_type="Rental",
        purchase_date="2025-01-01",
        rental_start_date=None,
        usage_periods=[SimpleNamespace(usage_type="RENTAL", start_date="2025-01-01", end_date="2025-12-31")],
        rental_periods=[
            SimpleNamespace(id=1, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000, notes=None),
            SimpleNamespace(id=2, start_year=2025, start_month=7, end_year=2025, end_month=8, monthly_rent=2400, notes=None),
        ],
    )

    timeline = build_rental_timeline(prop, as_of=date(2025, 12, 31))

    assert timeline["summary"]["currentStatus"]["display"] == "Vacant"
    assert timeline["summary"]["currentRent"]["display"] == "$2,400"


def test_rental_timeline_update_excludes_current_record_but_rejects_other_overlap(client, db, user, prop):
    first = models.RentalPeriod(property_id=prop.id, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000)
    second = models.RentalPeriod(property_id=prop.id, start_year=2025, start_month=5, end_year=2025, end_month=6, monthly_rent=2200)
    db.add_all([first, second])
    db.commit()
    db.refresh(first)

    ok = client.put(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"period_ref": f"occupied:{first.id}", "status": "occupied", "start_date": "2025-01-01", "end_date": "2025-04-30", "monthly_rent": 2050},
    )
    assert ok.status_code == 200

    conflict = client.put(
        f"/api/properties/{prop.id}/rental-timeline/periods",
        headers=auth_headers(user.email),
        json={"period_ref": f"occupied:{first.id}", "status": "occupied", "start_date": "2025-01-01", "end_date": "2025-05-31", "monthly_rent": 2050},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "RENTAL_PERIOD_OVERLAP"


def test_rental_timeline_delete_recalculates_metrics(client, db, user, prop):
    period = models.RentalPeriod(property_id=prop.id, start_year=2025, start_month=1, end_year=2025, end_month=3, monthly_rent=2000)
    db.add(period)
    db.commit()
    db.refresh(period)

    resp = client.delete(
        f"/api/properties/{prop.id}/rental-timeline/periods/occupied%3A{period.id}",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    assert resp.json()["summary"]["occupiedMonths"]["value"] == 0
