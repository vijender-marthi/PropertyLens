"""Regression: derived 'Vacant · auto' rows must not duplicate.

Rental availability can be described by more than one overlapping source — a
RENTAL usage period AND the property's rental_start_date both cover the same
span. The vacancy-gap walk previously ran once per overlapping availability
range and emitted the SAME gap multiple times, so the Rental timeline showed
duplicate 'Vacant · auto' rows (worse after each edit that re-introduced an
overlap). build_rental_timeline now unions the availability ranges first.
"""
from datetime import date
from types import SimpleNamespace

from services.rental_timeline import build_rental_timeline, _merge_date_ranges


def _rental(i, sy, sm, ey, em, rent):
    return SimpleNamespace(id=i, tenant_name=None, start_year=sy, start_month=sm,
                           end_year=ey, end_month=em, monthly_rent=rent, notes=None)


def _fake_prop():
    return SimpleNamespace(
        # Two OVERLAPPING availability sources for the same span:
        usage_periods=[SimpleNamespace(id=1, usage_type="RENTAL",
                                       start_date="2021-05-20", end_date=None,
                                       monthly_rent=0, notes="")],
        rental_start_date="2021-06-01",
        rental_end_date=None,
        usage_type="Rental",
        purchase_date="2021-05-27",
        monthly_rent=3200.0,
        # Occupied periods leaving a single Aug–Nov 2022 gap.
        rental_periods=[
            _rental(6, 2021, 6, 2022, 7, 2900.0),
            _rental(7, 2022, 12, 2023, 12, 3200.0),
        ],
    )


def test_merge_date_ranges_unions_overlaps():
    merged = _merge_date_ranges([
        (date(2021, 5, 20), date(2024, 1, 1)),
        (date(2021, 6, 1), date(2024, 1, 1)),
    ])
    assert merged == [(date(2021, 5, 20), date(2024, 1, 1))]


def test_vacant_rows_are_not_duplicated():
    tl = build_rental_timeline(_fake_prop(), as_of=date(2024, 1, 1))
    vacant = [p for p in tl["periods"] if p["status"] == "vacant"]
    spans = [(p["startDate"], p["endDate"]) for p in vacant]

    # The Aug–Nov 2022 gap must appear exactly once.
    assert spans.count(("2022-08-01", "2022-11-30")) == 1, spans
    # No vacant span may be duplicated at all.
    assert len(spans) == len(set(spans)), f"duplicate vacant rows: {spans}"
