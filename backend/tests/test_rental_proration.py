"""Day-level rental proration: partial first/last months are prorated by day,
full months stay at the full monthly rent (monthly_rent itself is never changed).
"""
from datetime import date
import models
from routers.properties import _rental_income_by_year, _prorate_income_by_month


def test_partial_month_prorated_by_day():
    # Oct 7 → Oct 31 = 25 of 31 days → 2950 * 25/31 = 2379.03
    rows = list(_prorate_income_by_month(date(2025, 10, 7), date(2026, 4, 30), 2950.0, date(2026, 8, 9)))
    by_month = {(y, m): (round(frac, 4), inc) for y, m, frac, inc in rows}
    assert by_month[(2025, 10)] == (0.8065, 2379.03)
    assert by_month[(2026, 4)] == (1.0, 2950.0)          # April fully covered
    assert by_month[(2025, 11)] == (1.0, 2950.0)          # full month


def test_rental_income_by_year_prorates(db, prop, user):
    db.add(models.RentalPeriod(
        property_id=prop.id, start_year=2025, start_month=10, start_day=7,
        end_year=2026, end_month=4, end_day=30, monthly_rent=2950.0,
    ))
    db.commit()
    by_year = _rental_income_by_year(prop)
    # 2025: Oct(2379.03) + Nov + Dec = 8279.03
    assert round(by_year[2025]["income"], 2) == 8279.03
    # 2026: Jan–Apr full = 11800
    assert round(by_year[2026]["income"], 2) == 11800.0


def test_monthly_rent_field_unchanged(db, prop, user):
    """Proration is derived; the stored monthly_rent stays the full amount."""
    rp = models.RentalPeriod(
        property_id=prop.id, start_year=2025, start_month=10, start_day=7,
        end_year=2025, end_month=10, end_day=31, monthly_rent=2950.0,
    )
    db.add(rp)
    db.commit()
    assert rp.monthly_rent == 2950.0
