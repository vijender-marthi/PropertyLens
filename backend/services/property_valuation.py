"""Resolve automatic and externally sourced property valuations."""
from datetime import date, datetime
import httpx
from typing import Optional, Dict, Any


DEFAULT_ANNUAL_APPRECIATION_RATE = 0.06
AUTO_MARKET_VALUE_SOURCE = "estimated_6pct"


def _purchase_year(value: Any) -> Optional[int]:
    if not value:
        return None
    if isinstance(value, (date, datetime)):
        return value.year
    raw = str(value).strip()
    for parser in (
        lambda: datetime.fromisoformat(raw.replace("Z", "+00:00")),
        lambda: datetime.strptime(raw, "%m/%d/%Y"),
    ):
        try:
            return parser().year
        except (TypeError, ValueError):
            continue
    return None


def estimate_market_price(
    purchase_price: Any,
    purchase_date: Any,
    *,
    as_of: Optional[date] = None,
) -> Dict[str, Any]:
    """Compound purchase price by 6% for each calendar year of ownership."""
    price = float(purchase_price or 0)
    target_date = as_of or date.today()
    purchase_year = _purchase_year(purchase_date)
    years = max(target_date.year - purchase_year, 0) if purchase_year else 0
    value = round(price * ((1 + DEFAULT_ANNUAL_APPRECIATION_RATE) ** years), 2) if price > 0 else 0.0
    return {
        "value": value,
        "source": AUTO_MARKET_VALUE_SOURCE,
        "asOfDate": target_date.isoformat(),
        "purchaseYear": purchase_year,
        "years": years,
        "annualRate": DEFAULT_ANNUAL_APPRECIATION_RATE,
    }


def apply_default_market_price(data: Dict[str, Any], *, existing_source: Optional[str] = None) -> Dict[str, Any]:
    """Apply the automatic estimate unless an explicit valuation overrides it."""
    source = str(data.get("market_value_source") or existing_source or AUTO_MARKET_VALUE_SOURCE).strip().lower()
    current_value = float(data.get("market_value") or 0)
    explicit_sources = {"manual", "appraisal", "imported", "zillow", "redfin"}
    if current_value > 0 and source in explicit_sources:
        return data

    estimate = estimate_market_price(data.get("purchase_price"), data.get("purchase_date"))
    if estimate["value"] > 0:
        data["market_value"] = estimate["value"]
        data["market_value_source"] = AUTO_MARKET_VALUE_SOURCE
        data["market_value_updated"] = estimate["asOfDate"]
    return data


def apply_default_settlement_total(data: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve combined closing/title costs from reported settlement accounting."""
    purchase_price = float(data.get("purchase_price") or 0)
    settlement_total = float(
        data.get("settlement_total_amount")
        or data.get("settlement_debit_total")
        or data.get("settlement_credit_total")
        or 0
    )
    if purchase_price > 0 and settlement_total >= purchase_price:
        data["settlement_total_amount"] = settlement_total
        data["closing_costs"] = round(settlement_total - purchase_price, 2)
    return data


def settlement_cost_breakdown(
    purchase_price: Any,
    settlement_total: Any,
    reported_closing_costs: Any,
) -> Optional[Dict[str, float]]:
    purchase = float(purchase_price or 0)
    settlement = float(settlement_total or 0)
    if purchase <= 0 or settlement < purchase:
        return None
    combined = round(settlement - purchase, 2)
    reported_closing = min(max(float(reported_closing_costs or 0), 0), combined)
    return {
        "combined": combined,
        "closingCosts": round(reported_closing, 2),
        "titleCosts": round(combined - reported_closing, 2),
    }


async def get_zillow_estimate(address: str, city: str, state: str, zip_code: str) -> Optional[Dict[str, Any]]:
    """
    Fetch Zestimate via Zillow's unofficial API / RapidAPI wrapper.
    Requires ZILLOW_API_KEY env variable with a RapidAPI key.
    Falls back gracefully if not configured.
    """
    import os
    api_key = os.getenv("ZILLOW_API_KEY")
    if not api_key:
        return None

    full_address = f"{address}, {city}, {state} {zip_code}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://zillow-com1.p.rapidapi.com/property",
                params={"address": full_address},
                headers={
                    "X-RapidAPI-Key": api_key,
                    "X-RapidAPI-Host": "zillow-com1.p.rapidapi.com",
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                zestimate = data.get("zestimate") or data.get("price")
                return {
                    "value": zestimate,
                    "source": "zillow",
                    "raw": data,
                }
    except Exception as e:
        print(f"Zillow API error: {e}")
    return None


async def get_redfin_estimate(address: str, city: str, state: str) -> Optional[Dict[str, Any]]:
    """
    Redfin doesn't have a public API. This is a placeholder.
    In production, use a scraping service or data vendor.
    """
    return None


async def get_property_value(
    address: str, city: str, state: str, zip_code: str
) -> Dict[str, Any]:
    """Try Zillow first, then Redfin, return None value if both fail."""
    result = await get_zillow_estimate(address, city, state, zip_code)
    if result and result.get("value"):
        return result

    result = await get_redfin_estimate(address, city, state)
    if result and result.get("value"):
        return result

    return {"value": None, "source": "not_available", "message": "No API key configured. Set ZILLOW_API_KEY env variable."}
