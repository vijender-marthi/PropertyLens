from datetime import date

from services.property_valuation import (
    AUTO_MARKET_VALUE_SOURCE,
    apply_default_market_price,
    apply_default_settlement_total,
    estimate_market_price,
    settlement_cost_breakdown,
)


def test_market_price_compounds_six_percent_by_calendar_year():
    estimate = estimate_market_price(625000, "2023-05-24", as_of=date(2026, 7, 17))

    assert estimate == {
        "value": 744385.0,
        "source": AUTO_MARKET_VALUE_SOURCE,
        "asOfDate": "2026-07-17",
        "purchaseYear": 2023,
        "years": 3,
        "annualRate": 0.06,
    }


def test_market_price_starts_at_purchase_price_in_purchase_year():
    estimate = estimate_market_price(625000, "2026-01-15", as_of=date(2026, 7, 17))

    assert estimate["value"] == 625000
    assert estimate["years"] == 0


def test_manual_market_price_is_not_overwritten():
    data = {
        "purchase_price": 625000,
        "purchase_date": "2023-05-24",
        "market_value": 800000,
        "market_value_source": "manual",
        "market_value_updated": "2026-07-01",
    }

    assert apply_default_market_price(data.copy()) == data


def test_automatic_market_price_is_recalculated_when_purchase_changes():
    data = {
        "purchase_price": 625000,
        "purchase_date": "2023-05-24",
        "market_value": 1,
        "market_value_source": AUTO_MARKET_VALUE_SOURCE,
    }

    result = apply_default_market_price(data)

    assert result["market_value"] == 744385.0
    assert result["market_value_source"] == AUTO_MARKET_VALUE_SOURCE


def test_missing_settlement_total_is_not_fabricated():
    result = apply_default_settlement_total({
        "purchase_price": 625000,
        "closing_costs": 14491.23,
        "settlement_total_amount": 0,
    })

    assert result["settlement_total_amount"] == 0
    assert result["closing_costs"] == 14491.23


def test_reported_settlement_total_resolves_combined_closing_and_title_costs():
    result = apply_default_settlement_total({
        "purchase_price": 625000,
        "closing_costs": 12000,
        "settlement_total_amount": 639491.23,
    })

    assert result["settlement_total_amount"] == 639491.23
    assert result["closing_costs"] == 14491.23


def test_settlement_cost_breakdown_separates_reported_closing_from_title_remainder():
    assert settlement_cost_breakdown(1_210_000, 1_223_978.95, 10_629.87) == {
        "combined": 13_978.95,
        "closingCosts": 10_629.87,
        "titleCosts": 3_349.08,
    }
