import models
from routers.properties import _portfolio_income_expense_yearly_trends, _tax_yearly_trends


def test_portfolio_trends_use_lease_and_annual_expense_history(db, user):
    prop = models.Property(
        owner_id=user.id,
        name="Historical Rental",
        address="1 Trend Way",
        usage_type="Rental",
        monthly_rent=3200,
        purchase_date="2020-06-01",
        occupancy_rate=100,
        property_tax=0,
        insurance=0,
    )
    db.add(prop)
    db.flush()
    db.add(models.RentalPeriod(
        property_id=prop.id,
        start_year=2020,
        start_month=7,
        end_year=None,
        end_month=None,
        monthly_rent=3200,
    ))
    for year, tax, insurance in ((2020, 5000, 800), (2021, 10200, 900), (2025, 11000, 1000)):
        db.add(models.AnnualExpense(
            property_id=prop.id,
            owner_id=user.id,
            year=year,
            property_tax=tax,
            insurance=insurance,
            source_status="reported",
        ))
    db.commit()
    db.refresh(prop)

    rows = _portfolio_income_expense_yearly_trends([prop], current_year=2026)
    by_year = {row["year"]: row for row in rows}

    assert by_year[2020]["rental_income"] == 19200
    assert by_year[2020]["operating_expenses"] == 5800
    assert by_year[2021]["rental_income"] == 38400
    assert by_year[2021]["net_operating_income"] == 27300
    assert by_year[2025]["operating_expenses"] == 12000
    assert by_year[2026]["rental_income"] == 38400
    assert by_year[2026]["status"] == "PROJECTED"
    assert by_year[2026]["year_label"] == "2026 Projected"


def test_portfolio_trends_ignore_expenses_before_purchase(db, user):
    prop = models.Property(
        owner_id=user.id,
        name="New Rental",
        address="4 Trend Way",
        usage_type="Rental",
        purchase_date="2023-05-24",
        monthly_rent=2500,
        occupancy_rate=100,
    )
    db.add(prop)
    db.flush()
    db.add(models.AnnualExpense(
        property_id=prop.id,
        owner_id=user.id,
        year=2022,
        property_tax=5000,
        source_status="reported",
    ))
    db.commit()
    db.refresh(prop)

    rows = _portfolio_income_expense_yearly_trends([prop], current_year=2026)

    assert 2022 not in {row["year"] for row in rows}


def test_portfolio_trends_exclude_primary_and_schedule_e_non_operating_costs(db, user):
    rental = models.Property(
        owner_id=user.id,
        name="Rental",
        address="2 Trend Way",
        usage_type="Rental",
        monthly_rent=0,
        occupancy_rate=100,
    )
    primary = models.Property(
        owner_id=user.id,
        name="Home",
        address="3 Trend Way",
        usage_type="Primary",
        monthly_rent=9000,
        occupancy_rate=100,
    )
    db.add_all([rental, primary])
    db.flush()
    db.add(models.TaxReturnEntry(
        property_id=rental.id,
        owner_id=user.id,
        tax_year=2025,
        rents_received=40000,
        total_expenses=30000,
        mortgage_interest=15000,
        depreciation=10000,
    ))
    db.commit()
    db.refresh(rental)
    db.refresh(primary)

    rows = _portfolio_income_expense_yearly_trends([rental, primary], current_year=2026)
    by_year = {row["year"]: row for row in rows}

    assert by_year[2025]["rental_income"] == 40000
    assert by_year[2025]["operating_expenses"] == 5000
    assert by_year[2025]["net_operating_income"] == 35000
    assert all(item["property_id"] != primary.id for row in rows for item in row["properties"])

    tax_rows = _tax_yearly_trends(rental.tax_entries, {rental.id})
    assert tax_rows[0]["operating_expenses"] == 30000
    assert tax_rows[0]["mortgage_interest"] == 15000
    assert tax_rows[0]["depreciation"] == 10000
