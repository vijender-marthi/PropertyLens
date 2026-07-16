from datetime import date
from typing import Any, Dict, Optional


RENTAL_START_AUTO_PURCHASE_DATE = "auto_purchase_date"
RENTAL_START_USER_ENTERED = "user_entered"
RENTAL_START_DOCUMENT_IMPORT = "document_import"
RENTAL_START_BACKEND_EXISTING = "backend_existing"


def _get(source: Optional[Any], key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def original_residency_is_rental(value: Any) -> bool:
    return str(value or "").strip().lower() == "rental"


def parse_iso_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def apply_rental_available_from_default(data: Dict[str, Any], existing: Optional[Any] = None) -> Dict[str, Any]:
    """Default rental_start_date from purchase_date for properties acquired as rentals.

    The origin flag prevents a later purchase-date edit from overwriting a user-entered
    rental availability date.
    """
    purchase_date = data.get("purchase_date")
    rental_start = data.get("rental_start_date")
    original_residency = data.get("original_residency_status")
    incoming_origin = data.get("rental_start_date_origin")
    existing_origin = _get(existing, "rental_start_date_origin")
    origin = incoming_origin or existing_origin
    existing_purchase = _get(existing, "purchase_date")
    existing_rental_start = _get(existing, "rental_start_date")

    if not purchase_date:
        if origin == RENTAL_START_AUTO_PURCHASE_DATE:
            data["rental_start_date"] = None
            data["rental_start_date_origin"] = None
        return data

    if not original_residency_is_rental(original_residency):
        if origin == RENTAL_START_AUTO_PURCHASE_DATE:
            data["rental_start_date"] = None
            data["rental_start_date_origin"] = None
        return data

    if not rental_start:
        data["rental_start_date"] = purchase_date
        data["rental_start_date_origin"] = RENTAL_START_AUTO_PURCHASE_DATE
        return data

    if (
        origin == RENTAL_START_AUTO_PURCHASE_DATE
        and existing_purchase
        and existing_rental_start
        and str(rental_start)[:10] == str(existing_rental_start)[:10]
        and str(existing_rental_start)[:10] == str(existing_purchase)[:10]
        and str(purchase_date)[:10] != str(existing_purchase)[:10]
    ):
        data["rental_start_date"] = purchase_date
        data["rental_start_date_origin"] = RENTAL_START_AUTO_PURCHASE_DATE
        return data

    if not origin and rental_start:
        data["rental_start_date_origin"] = RENTAL_START_BACKEND_EXISTING
    return data


def rental_available_before_purchase(data: Dict[str, Any]) -> bool:
    purchase = parse_iso_date(data.get("purchase_date"))
    rental_start = parse_iso_date(data.get("rental_start_date"))
    return bool(purchase and rental_start and rental_start < purchase)
