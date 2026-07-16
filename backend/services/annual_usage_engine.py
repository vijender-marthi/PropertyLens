from __future__ import annotations

import calendar
import json
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


@dataclass(frozen=True)
class DateRange:
    start: date
    end: date
    source: str
    label: str = ""


def parse_iso_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _normalize_usage_type(value: Any) -> str:
    raw = str(value or "").strip().upper()
    return "PRIMARY" if raw in {"PRIMARY", "PERSONAL", "OWNER"} else "RENTAL"


def _days_in_year(year: int) -> int:
    return 366 if calendar.isleap(year) else 365


def _days_between(start: date, end: date) -> Set[date]:
    if end < start:
        return set()
    first = start.toordinal()
    return {date.fromordinal(first + offset) for offset in range((end - start).days + 1)}


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _split_by_year(range_: DateRange, as_of: date, floor: Optional[date] = None) -> Iterable[Tuple[int, Set[date]]]:
    start = max(range_.start, floor) if floor else range_.start
    end = min(range_.end, as_of)
    if end < start:
        return []

    pieces: List[Tuple[int, Set[date]]] = []
    for year in range(start.year, end.year + 1):
        segment_start = max(start, date(year, 1, 1))
        segment_end = min(end, date(year, 12, 31), as_of)
        if segment_end >= segment_start:
            pieces.append((year, _days_between(segment_start, segment_end)))
    return pieces


def _rental_period_ranges(prop: Any, as_of: date) -> List[DateRange]:
    ranges: List[DateRange] = []
    for lease in getattr(prop, "rental_periods", []) or []:
        start_year = getattr(lease, "start_year", None)
        start_month = getattr(lease, "start_month", None)
        if not start_year or not start_month:
            continue

        start = date(int(start_year), int(start_month), 1)
        end_year = getattr(lease, "end_year", None)
        end_month = getattr(lease, "end_month", None)
        if end_year:
            end = _month_end(int(end_year), int(end_month or 12))
        else:
            end = as_of

        if end >= start:
            ranges.append(DateRange(start=start, end=end, source="leases", label=getattr(lease, "tenant_name", "") or "Lease"))
    return ranges


def _usage_period_ranges(prop: Any, as_of: date) -> Tuple[List[DateRange], List[DateRange]]:
    rental: List[DateRange] = []
    personal: List[DateRange] = []
    for period in getattr(prop, "usage_periods", []) or []:
        start = parse_iso_date(getattr(period, "start_date", None))
        if not start:
            continue
        end = parse_iso_date(getattr(period, "end_date", None)) or as_of
        if end < start:
            continue
        target = personal if _normalize_usage_type(getattr(period, "usage_type", None)) == "PRIMARY" else rental
        target.append(DateRange(start=start, end=end, source="usage_period"))
    return rental, personal


def _fallback_usage_period(prop: Any, as_of: date) -> Tuple[List[DateRange], List[DateRange]]:
    start = parse_iso_date(getattr(prop, "purchase_date", None)) or date(as_of.year, 1, 1)
    usage_type = _normalize_usage_type(getattr(prop, "usage_type", None))
    fallback = DateRange(start=start, end=as_of, source="property_usage")
    return ([fallback], []) if usage_type == "RENTAL" else ([], [fallback])


def _source_refs(entry: Any) -> Dict[str, Any]:
    try:
        refs = getattr(entry, "source_refs", None)
        return json.loads(refs) if refs else {}
    except (TypeError, ValueError):
        return {}


def _explicit_int(entry: Any, field: str) -> Optional[int]:
    if not entry:
        return None
    value = getattr(entry, field, None)
    if value is None:
        return None
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        return None
    if numeric != 0:
        return numeric

    refs = _source_refs(entry)
    if field in refs or refs.get("explicit_zero_fields", []) and field in refs.get("explicit_zero_fields", []):
        return 0
    return None


def _money_field(value: Any, source: Optional[str], status: str) -> Dict[str, Any]:
    return {"value": value, "source": source, "status": status}


def _day_field(value: Optional[int], source: Optional[str], status: str, *, ytd: bool = False) -> Dict[str, Any]:
    if value is None:
        display = "—"
    else:
        display = f"{value} day{'s' if value != 1 else ''}{' YTD' if ytd else ''}"
    return {"value": value, "source": source, "status": status, "display": display}


def _months_covered(days: Set[date]) -> Set[Tuple[int, int]]:
    return {(day.year, day.month) for day in days}


def _coverage_display(days: Set[date], year: int, as_of: date) -> str:
    months = len(_months_covered(days))
    denominator = as_of.month if year == as_of.year else 12
    suffix = " elapsed months" if year == as_of.year else " months"
    return f"{months} of {denominator}{suffix}"


def _calendar_days_for_year(year: int, as_of: date, floor: Optional[date]) -> Tuple[date, date, int]:
    start = date(year, 1, 1)
    if floor and floor.year == year:
        start = max(start, floor)
    end = min(date(year, 12, 31), as_of) if year == as_of.year else date(year, 12, 31)
    return start, end, max((end - start).days + 1, 0)


def _build_issue(type_: str, message: str, severity: str = "review") -> Dict[str, Any]:
    return {"type": type_, "severity": severity, "message": message}


def build_annual_usage_records(prop: Any, *, as_of: Optional[date] = None, floor: Optional[date] = None) -> List[Dict[str, Any]]:
    """Build canonical annual usage records.

    Date convention: lease and usage period starts and ends are inclusive.
    Open-ended/current records stop at ``as_of``. Future lease days are not
    counted as actual rental days.
    """

    as_of = as_of or date.today()
    lease_ranges = _rental_period_ranges(prop, as_of)
    usage_rental_ranges, personal_ranges = _usage_period_ranges(prop, as_of)
    if not usage_rental_ranges and not personal_ranges:
        usage_rental_ranges, personal_ranges = _fallback_usage_period(prop, as_of)

    lease_by_year: Dict[int, Set[date]] = {}
    rental_use_by_year: Dict[int, Set[date]] = {}
    personal_by_year: Dict[int, Set[date]] = {}
    years: Set[int] = set()
    overlap_issues: List[Dict[str, Any]] = []

    def add_range(target: Dict[int, Set[date]], range_: DateRange) -> None:
        for year, days in _split_by_year(range_, as_of, floor):
            years.add(year)
            existing = target.setdefault(year, set())
            if existing & days and range_.source == "leases":
                overlap_issues.append(_build_issue("overlapping_leases", "Lease date ranges overlap and were merged so rental days are not double-counted."))
            existing.update(days)

    for range_ in lease_ranges:
        add_range(lease_by_year, range_)
    for range_ in usage_rental_ranges:
        add_range(rental_use_by_year, range_)
    for range_ in personal_ranges:
        add_range(personal_by_year, range_)

    tax_entries = list(getattr(prop, "tax_entries", []) or [])
    for entry in tax_entries:
        year = getattr(entry, "tax_year", None)
        if year:
            years.add(int(year))

    records: List[Dict[str, Any]] = []
    for year in sorted(years):
        period_start, period_end, calendar_days = _calendar_days_for_year(year, as_of, floor)
        if calendar_days <= 0:
            continue

        tax_entry = next((entry for entry in tax_entries if int(getattr(entry, "tax_year", 0) or 0) == year), None)
        rent_value = getattr(tax_entry, "rents_received", None) if tax_entry else None
        reported_rental_days = _explicit_int(tax_entry, "days_rented")
        reported_personal_days = _explicit_int(tax_entry, "personal_use_days")

        lease_days = {day for day in lease_by_year.get(year, set()) if period_start <= day <= period_end}
        rental_use_days = {day for day in rental_use_by_year.get(year, set()) if period_start <= day <= period_end}
        personal_days = {day for day in personal_by_year.get(year, set()) if period_start <= day <= period_end}
        issues = list(overlap_issues)

        overlap = lease_days & personal_days
        if overlap:
            lease_days -= overlap
            issues.append(_build_issue("rental_personal_overlap", "Rental and personal-use dates overlap and need review.", "must_fix"))

        if reported_rental_days is not None:
            canonical_rental_days = reported_rental_days
            rental_source = "schedule_e"
            rental_status = "reported"
        elif lease_days:
            canonical_rental_days = len(lease_days)
            rental_source = "leases"
            rental_status = "calculated"
        else:
            canonical_rental_days = None
            rental_source = None
            rental_status = "unknown"

        if reported_personal_days is not None:
            canonical_personal_days = reported_personal_days
            personal_source = "schedule_e"
            personal_status = "reported"
        elif personal_days:
            canonical_personal_days = len(personal_days)
            personal_source = "usage_period"
            personal_status = "calculated"
        else:
            canonical_personal_days = None
            personal_source = None
            personal_status = "unknown"

        if canonical_rental_days is not None and canonical_personal_days is not None:
            if canonical_rental_days + canonical_personal_days > calendar_days:
                issues.append(_build_issue("usage_days_exceed_calendar", "Rental and personal-use days exceed available calendar days.", "must_fix"))
        if reported_rental_days is not None and lease_days and abs(reported_rental_days - len(lease_days)) > 3:
            issues.append(_build_issue("reported_lease_days_disagree", "Reported rental days and lease-derived rental days differ."))
        if rent_value and canonical_rental_days == 0:
            issues.append(_build_issue("rent_with_zero_days", "Rent was reported with zero rental days. Review Schedule E occupancy days.", "must_fix"))
        if rent_value and canonical_rental_days is None:
            issues.append(_build_issue("rent_with_unknown_days", "Rent was reported, but no reliable rental-day source is available."))
        if lease_days and canonical_rental_days is None:
            issues.append(_build_issue("lease_days_not_selected", "Lease coverage exists but rental days could not be selected."))

        vacant_days = None
        if canonical_rental_days is not None or canonical_personal_days is not None:
            vacant_days = max(calendar_days - (canonical_rental_days or 0) - (canonical_personal_days or 0), 0)

        ytd = year == as_of.year
        coverage = _coverage_display(lease_days, year, as_of) if lease_days else "Not reported"
        records.append({
            "year": year,
            "calendarDays": calendar_days,
            "rentReceived": _money_field(rent_value, "schedule_e" if rent_value is not None else None, "reported" if rent_value is not None else "unknown"),
            "rentalDays": _day_field(canonical_rental_days, rental_source, rental_status, ytd=ytd),
            "personalUseDays": _day_field(canonical_personal_days, personal_source, personal_status, ytd=ytd),
            "vacantDays": vacant_days,
            "unavailableDays": 0,
            "rentalPercent": round((canonical_rental_days / calendar_days) * 100, 2) if canonical_rental_days is not None and calendar_days else None,
            "rentalUsePeriodDays": len(rental_use_days),
            "leaseCoveredDays": len(lease_days),
            "reportedRentalDays": reported_rental_days,
            "reportedPersonalUseDays": reported_personal_days,
            "canonicalRentalDays": canonical_rental_days,
            "coverageDisplay": coverage,
            "source": rental_source,
            "status": rental_status,
            "asOfDate": as_of.isoformat(),
            "display": {
                "rentalDays": _day_field(canonical_rental_days, rental_source, rental_status, ytd=ytd)["display"],
                "personalUseDays": _day_field(canonical_personal_days, personal_source, personal_status, ytd=ytd)["display"],
                "coverage": coverage,
                "rentalUse": f"{_day_field(canonical_rental_days, rental_source, rental_status, ytd=ytd)['display']} ({coverage})",
            },
            "discrepancies": issues,
        })
    return records


def annual_usage_by_year(prop: Any, *, as_of: Optional[date] = None, floor: Optional[date] = None) -> Dict[int, Dict[str, Any]]:
    return {record["year"]: record for record in build_annual_usage_records(prop, as_of=as_of, floor=floor)}

