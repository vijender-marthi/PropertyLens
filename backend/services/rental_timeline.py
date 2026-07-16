from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from services.formatters import format_currency, format_percent

MonthKey = Tuple[int, int]
RangeRow = Tuple[date, date, Any]


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _month_key(value: date) -> MonthKey:
    return value.year, value.month


def _month_range(start: date, end: date) -> List[MonthKey]:
    if end < start:
        return []
    year, month = start.year, start.month
    months: List[MonthKey] = []
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return months


def _month_start(month: MonthKey) -> date:
    return date(month[0], month[1], 1)


def _month_end(month: MonthKey) -> date:
    return date(month[0], month[1], calendar.monthrange(month[0], month[1])[1])


def _contiguous_month_runs(months: Set[MonthKey]) -> List[Tuple[MonthKey, MonthKey]]:
    if not months:
        return []
    ordered = sorted(months)
    runs: List[Tuple[MonthKey, MonthKey]] = []
    start = prev = ordered[0]
    for item in ordered[1:]:
        expected = (prev[0] + 1, 1) if prev[1] == 12 else (prev[0], prev[1] + 1)
        if item == expected:
            prev = item
            continue
        runs.append((start, prev))
        start = prev = item
    runs.append((start, prev))
    return runs


def _usage_ranges(prop: Any, usage_type: str, as_of: date) -> List[RangeRow]:
    ranges: List[RangeRow] = []
    expected = usage_type.upper()
    for period in getattr(prop, "usage_periods", []) or []:
        if str(getattr(period, "usage_type", "") or "").upper() != expected:
            continue
        start = _parse_date(getattr(period, "start_date", None))
        if not start:
            continue
        end = _parse_date(getattr(period, "end_date", None)) or as_of
        ranges.append((start, min(end, as_of), period))
    return ranges


def _rental_available_ranges(prop: Any, as_of: date) -> List[RangeRow]:
    ranges = _usage_ranges(prop, "RENTAL", as_of)
    setup_start = _parse_date(getattr(prop, "rental_start_date", None))
    if setup_start:
        setup_end = _parse_date(getattr(prop, "rental_end_date", None)) or as_of
        ranges.append((setup_start, min(setup_end, as_of), None))
    if not ranges and str(getattr(prop, "usage_type", "") or "").lower() == "rental":
        start = _parse_date(getattr(prop, "purchase_date", None))
        end = _parse_date(getattr(prop, "rental_end_date", None)) or as_of
        if start:
            ranges.append((start, min(end, as_of), None))
    return ranges


def _not_rental_ranges(prop: Any, as_of: date) -> List[RangeRow]:
    return _usage_ranges(prop, "NOT_RENTAL", as_of)


def _occupied_ranges(prop: Any, as_of: date) -> List[RangeRow]:
    ranges: List[RangeRow] = []
    for rental in getattr(prop, "rental_periods", []) or []:
        start_year = getattr(rental, "start_year", None)
        start_month = getattr(rental, "start_month", None)
        if not start_year or not start_month:
            continue
        start = date(int(start_year), int(start_month), 1)
        end_year = getattr(rental, "end_year", None)
        end_month = getattr(rental, "end_month", None)
        if end_year and end_month:
            last_day = calendar.monthrange(int(end_year), int(end_month))[1]
            end = date(int(end_year), int(end_month), last_day)
        else:
            end = as_of
        ranges.append((start, min(end, as_of), rental))
    return ranges


def _months_from_ranges(ranges: Iterable[RangeRow]) -> Set[MonthKey]:
    months: Set[MonthKey] = set()
    for start, end, _source in ranges:
        months.update(_month_range(start, end))
    return months


def _rent_by_month(occupied_ranges: Iterable[RangeRow]) -> Dict[MonthKey, float]:
    rent: Dict[MonthKey, float] = {}
    for start, end, rental in occupied_ranges:
        monthly_rent = float(getattr(rental, "monthly_rent", 0) or 0)
        for month in _month_range(start, end):
            rent[month] = max(rent.get(month, 0.0), monthly_rent)
    return rent


def _period_sort_key(period: Any, year: int) -> Tuple[int, int]:
    end_year = int(getattr(period, "end_year", None) or year)
    end_month = int(getattr(period, "end_month", None) or 12)
    return end_year, end_month


def _current_year_lease_periods(prop: Any, year: int) -> List[Any]:
    periods: List[Any] = []
    for period in getattr(prop, "rental_periods", []) or []:
        if not getattr(period, "start_year", None) or not getattr(period, "start_month", None):
            continue
        start_year = int(getattr(period, "start_year"))
        end_year = int(getattr(period, "end_year", None) or year)
        if start_year <= year <= end_year:
            periods.append(period)
    return periods


def _resolve_monthly_rent(prop: Any, year: int) -> Dict[str, Any]:
    leases = _current_year_lease_periods(prop, year)
    if leases:
        latest = max(leases, key=lambda period: _period_sort_key(period, year))
        if getattr(latest, "monthly_rent", None):
            return {
                "monthlyRent": float(getattr(latest, "monthly_rent", 0) or 0),
                "source": "rental_tab",
                "label": getattr(latest, "tenant_name", None) or "Rental tab latest lease",
                "periodId": getattr(latest, "id", None),
            }

    if getattr(prop, "monthly_rent", None):
        return {
            "monthlyRent": float(getattr(prop, "monthly_rent", 0) or 0),
            "source": "property_details",
            "label": "Property details rent per month",
            "periodId": None,
        }

    return {
        "monthlyRent": 0.0,
        "source": "none",
        "label": "No rent entered",
        "periodId": None,
    }


def _period_by_month(occupied_ranges: Iterable[RangeRow]) -> Dict[MonthKey, str]:
    periods: Dict[MonthKey, str] = {}
    for start, end, rental in occupied_ranges:
        start_label = _month_label(_month_key(start))
        has_open_end = not getattr(rental, "end_year", None) or not getattr(rental, "end_month", None)
        end_label = "current" if has_open_end else _month_label(_month_key(end))
        label = f"Lease {start_label} → {end_label}"
        for month in _month_range(start, end):
            periods[month] = label
    return periods


def _month_label(month: MonthKey) -> str:
    return f"{calendar.month_abbr[month[1]]} {month[0]}"


def _months_display(count: int) -> str:
    return f"{count} month{'s' if count != 1 else ''}"


def _longest_run(months: Set[MonthKey]) -> int:
    if not months:
        return 0
    ordered = sorted(months)
    longest = current = 1
    for prev, item in zip(ordered, ordered[1:]):
        next_month = (prev[0] + 1, 1) if prev[1] == 12 else (prev[0], prev[1] + 1)
        if item == next_month:
            current += 1
        else:
            longest = max(longest, current)
            current = 1
    return max(longest, current)


def _status_key(status: str) -> str:
    normalized = str(status or "").lower()
    if normalized == "occupied":
        return "positive"
    if normalized == "vacant":
        return "neutral"
    if "not rental" in normalized:
        return "info"
    return "warning"


def _vacant_gap_ranges(
    available_ranges: List[RangeRow],
    occupied_ranges: List[RangeRow],
    not_rental_ranges: List[RangeRow],
) -> List[Tuple[date, date]]:
    blockers = sorted(
        [(start, end) for start, end, _source in occupied_ranges + not_rental_ranges],
        key=lambda item: item[0],
    )
    gaps: List[Tuple[date, date]] = []
    for available_start, available_end, _source in available_ranges:
        cursor = available_start
        for block_start, block_end in blockers:
            if block_end < cursor or block_start > available_end:
                continue
            if block_start > cursor:
                gaps.append((cursor, block_start - timedelta(days=1)))
            cursor = max(cursor, block_end + timedelta(days=1))
            if cursor > available_end:
                break
        if cursor <= available_end:
            gaps.append((cursor, available_end))
    return gaps


def _period_rows(prop: Any, as_of: date, vacant_ranges: Optional[List[Tuple[date, date]]] = None) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for start, end, rental in _occupied_ranges(prop, as_of):
        months = _month_range(start, end)
        monthly_rent = float(getattr(rental, "monthly_rent", 0) or 0)
        rows.append({
            "id": getattr(rental, "id", None),
            "periodRef": f"occupied:{getattr(rental, 'id', '')}",
            "startDate": start.isoformat(),
            "endDate": None if end == as_of and not getattr(rental, "end_year", None) else end.isoformat(),
            "status": "occupied",
            "statusDisplay": "Occupied",
            "source": "manual",
            "derived": False,
            "editable": True,
            "occupied": True,
            "monthlyRent": monthly_rent,
            "monthlyRentDisplay": format_currency(monthly_rent),
            "months": len(months),
            "monthsDisplay": _months_display(len(months)),
            "notes": getattr(rental, "notes", None),
        })
    for start, end, period in _not_rental_ranges(prop, as_of):
        months = _month_range(start, end)
        rows.append({
            "id": getattr(period, "id", None),
            "periodRef": f"not_rental:{getattr(period, 'id', '')}",
            "startDate": start.isoformat(),
            "endDate": None if end == as_of and not getattr(period, "end_date", None) else end.isoformat(),
            "status": "not_rental",
            "statusDisplay": "Not Rental",
            "source": "manual",
            "derived": False,
            "editable": True,
            "occupied": False,
            "monthlyRent": None,
            "monthlyRentDisplay": "—",
            "months": len(months),
            "monthsDisplay": _months_display(len(months)),
            "notes": getattr(period, "notes", None),
        })
    for start, end in vacant_ranges or []:
        months = _month_range(start, end)
        rows.append({
            "id": f"vacant:{start.isoformat()}:{end.isoformat()}",
            "periodRef": f"vacant:{start.isoformat()}:{end.isoformat()}",
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "status": "vacant",
            "statusDisplay": "Vacant",
            "source": "auto",
            "derived": True,
            "editable": False,
            "occupied": False,
            "monthlyRent": None,
            "monthlyRentDisplay": "—",
            "months": len(months),
            "monthsDisplay": _months_display(len(months)),
            "notes": "Auto vacancy derived from gaps between occupied periods.",
        })
    return sorted(rows, key=lambda row: (row["startDate"], row["status"]))


def _latest_occupied_period(prop: Any) -> Optional[Any]:
    periods = []
    for rental in getattr(prop, "rental_periods", []) or []:
        start_year = getattr(rental, "start_year", None)
        start_month = getattr(rental, "start_month", None)
        if not start_year or not start_month:
            continue
        periods.append((int(start_year), int(start_month), rental))
    if not periods:
        return None
    return sorted(periods, key=lambda item: (item[0], item[1]))[-1][2]


def build_rental_timeline(prop: Any, as_of: Optional[date] = None) -> Dict[str, Any]:
    as_of = as_of or date.today()
    available_ranges = _rental_available_ranges(prop, as_of)
    occupied_ranges = _occupied_ranges(prop, as_of)
    not_rental_ranges = _not_rental_ranges(prop, as_of)

    rental_available_months = _months_from_ranges(available_ranges)
    not_rental_months = _months_from_ranges(not_rental_ranges) & rental_available_months
    performance_available_months = rental_available_months - not_rental_months
    occupied_months = _months_from_ranges(occupied_ranges) & performance_available_months if performance_available_months else set()
    vacant_months = performance_available_months - occupied_months
    vacant_ranges = _vacant_gap_ranges(available_ranges, occupied_ranges, not_rental_ranges)
    rent_by_month = _rent_by_month(occupied_ranges)
    period_by_month = _period_by_month(occupied_ranges)

    occupied_count = len(occupied_months)
    available_count = len(performance_available_months)
    vacant_count = len(vacant_months)
    occupancy_pct = (occupied_count / available_count * 100) if available_count else None
    vacancy_pct = (vacant_count / available_count * 100) if available_count else None
    latest_period = _latest_occupied_period(prop)
    current_status = "Occupied" if latest_period and not getattr(latest_period, "end_year", None) and not getattr(latest_period, "end_month", None) else "Vacant"
    current_rent = float(getattr(latest_period, "monthly_rent", 0) or 0) if latest_period else None
    annual_rent_run_rate = current_rent * 12 if current_rent is not None else None
    average_rent = sum(rent_by_month[m] for m in occupied_months if m in rent_by_month) / occupied_count if occupied_count else None
    rental_since = min(rental_available_months) if rental_available_months else None
    estimated_vacancy_cost = sum((average_rent or 0) for _month in vacant_months)
    longest_vacancy = _longest_run(vacant_months)
    story_lead = (
        f"{format_percent(occupancy_pct) if occupancy_pct is not None else '—'} occupied over {_months_display(available_count)}, "
        f"currently {format_currency(current_rent) if current_rent is not None else '—'}/mo, "
        f"only {_months_display(vacant_count)} vacant since {_month_label(rental_since) if rental_since else '—'}."
    )
    insight_line = (
        f"{'Strong performer' if occupancy_pct is not None and occupancy_pct >= 85 else 'Rental performance needs review'} — "
        f"{format_percent(occupancy_pct) if occupancy_pct is not None else '—'} occupancy, "
        f"longest vacancy {_months_display(longest_vacancy)}, "
        f"~{format_currency(estimated_vacancy_cost)} lost to vacancy."
    )
    hero_kpis = [
        {"label": "Occupancy %", "value": occupancy_pct, "display": format_percent(occupancy_pct) if occupancy_pct is not None else "—"},
        {"label": "Current rent", "value": current_rent, "display": f"{format_currency(current_rent)}/mo" if current_rent is not None else "—"},
        {"label": "Status", "value": current_status, "display": current_status},
        {"label": "Rented since", "value": _month_label(rental_since) if rental_since else None, "display": _month_label(rental_since) if rental_since else "—"},
    ]

    recommendations: List[Dict[str, Any]] = []
    if occupancy_pct is not None and occupancy_pct >= 85:
        recommendations.append({
            "tone": "positive",
            "title": "Occupancy has remained strong.",
            "detail": f"Occupancy is {format_percent(occupancy_pct)} across rental-available months.",
            "recommendation": "Keep recording occupied periods as rent is collected.",
        })
    if vacancy_pct is not None and vacancy_pct > 15:
        recommendations.append({
            "tone": "warning",
            "title": "Derived vacancy is elevated.",
            "detail": f"Derived vacancy is {format_percent(vacancy_pct)}, with estimated lost rent of {format_currency(estimated_vacancy_cost)}.",
            "recommendation": "Review pricing before the next rental-available gap.",
        })
    if not recommendations:
        recommendations.append({
            "tone": "info",
            "title": "Record occupied and not-rental events.",
            "detail": "Vacancy is derived automatically from gaps in rental-available months.",
            "recommendation": "Add occupied periods when rent is collected and not-rental periods when the property leaves the rental market.",
        })

    years = sorted({year for year, _month in rental_available_months | occupied_months | not_rental_months})
    yearly = []
    for year in years:
        year_available = {m for m in performance_available_months if m[0] == year}
        year_occupied = {m for m in occupied_months if m[0] == year}
        year_vacant = {m for m in vacant_months if m[0] == year}
        year_not_rental = {m for m in not_rental_months if m[0] == year}
        rent_received = sum(rent_by_month.get(month, 0.0) for month in year_occupied)
        resolved_rent = _resolve_monthly_rent(prop, year)
        expected_rent = round(len(year_available) * float(resolved_rent["monthlyRent"] or 0), 2)
        rent_received = min(round(rent_received, 2), expected_rent) if expected_rent else round(rent_received, 2)
        vacancy_loss = max(round(expected_rent - rent_received, 2), 0.0)
        yearly.append({
            "year": year,
            "months": [
                {
                    "month": month,
                    "label": calendar.month_abbr[month],
                    "status": "occupied" if (year, month) in year_occupied else ("not_rental" if (year, month) in year_not_rental else ("vacant" if (year, month) in year_vacant else "not_rental")),
                    "startDate": _month_start((year, month)).isoformat(),
                    "endDate": _month_end((year, month)).isoformat(),
                    "canAddPeriod": (year, month) in year_vacant,
                    "monthlyRent": rent_by_month.get((year, month)) if (year, month) in year_occupied else None,
                    "monthlyRentDisplay": format_currency(rent_by_month[(year, month)]) if (year, month) in year_occupied and (year, month) in rent_by_month else "—",
                    "derived": (year, month) in year_vacant,
                    "tooltip": {
                        "month": f"{calendar.month_name[month]} {year}",
                        "status": "Occupied" if (year, month) in year_occupied else ("Not Rental" if (year, month) in year_not_rental else ("Vacant" if (year, month) in year_vacant else "Not Rental")),
                        "monthlyRent": format_currency(rent_by_month[(year, month)]) if (year, month) in year_occupied and (year, month) in rent_by_month else "—",
                        "period": period_by_month.get((year, month)),
                        "note": "Derived vacancy between occupied periods within a rental-available period." if (year, month) in year_vacant else None,
                    },
                }
                for month in range(1, 13)
            ],
            "availableMonths": len(year_available),
            "occupiedMonths": len(year_occupied),
            "vacantMonths": len(year_vacant),
            "notRentalMonths": len(year_not_rental),
            "occupancyPercent": (len(year_occupied) / len(year_available) * 100) if year_available else None,
            "occupancyPercentDisplay": format_percent(len(year_occupied) / len(year_available) * 100) if year_available else "—",
            "rentCollected": rent_received,
            "rentCollectedDisplay": format_currency(rent_received),
            "rentReceived": rent_received,
            "rentReceivedDisplay": format_currency(rent_received),
            "expectedRent": expected_rent,
            "expectedRentDisplay": format_currency(expected_rent),
            "vacancyLoss": vacancy_loss,
            "vacancyLossDisplay": format_currency(vacancy_loss),
            "resolvedMonthlyRent": resolved_rent,
            "rentAssertion": {
                "status": "valid" if rent_received <= expected_rent + 0.01 else "invalid",
                "rule": "received <= expected",
            },
        })

    total_occupied_months = sum(row["occupiedMonths"] for row in yearly)
    total_vacant_months = sum(row["vacantMonths"] for row in yearly)
    total_rent_received = round(sum(row["rentReceived"] for row in yearly), 2)
    total_expected_rent = round(sum(row["expectedRent"] for row in yearly), 2)
    total_vacancy_loss = round(sum(row["vacancyLoss"] for row in yearly), 2)

    return {
        "schemaVersion": "rental-performance.v2",
        "asOfDate": as_of.isoformat(),
        "title": "Rental Performance",
        "subtitle": "How consistently this property has generated rental income.",
        "storyLead": story_lead,
        "heroKpis": hero_kpis,
        "insightLine": insight_line,
        "summary": {
            "rentalSince": {"value": _month_label(rental_since) if rental_since else None, "display": _month_label(rental_since) if rental_since else "—"},
            "currentStatus": {"value": current_status, "display": current_status},
            "occupancyPercent": {"value": occupancy_pct, "display": format_percent(occupancy_pct) if occupancy_pct is not None else "—"},
            "vacancyPercent": {"value": vacancy_pct, "display": format_percent(vacancy_pct) if vacancy_pct is not None else "—"},
            "availableMonths": {"value": available_count, "display": _months_display(available_count)},
            "occupiedMonths": {"value": occupied_count, "display": _months_display(occupied_count)},
            "vacantMonths": {"value": vacant_count, "display": _months_display(vacant_count)},
            "currentRent": {"value": current_rent, "display": format_currency(current_rent) if current_rent is not None else "—"},
            "annualRentRunRate": {"value": annual_rent_run_rate, "display": format_currency(annual_rent_run_rate) if annual_rent_run_rate is not None else "—"},
            "averageRent": {"value": average_rent, "display": format_currency(average_rent) if average_rent is not None else "—"},
        },
        "timeline": yearly,
        "timelineTotals": {
            "label": "Total",
            "occupiedMonths": total_occupied_months,
            "vacantMonths": total_vacant_months,
            "rentReceived": total_rent_received,
            "rentReceivedDisplay": format_currency(total_rent_received),
            "expectedRent": total_expected_rent,
            "expectedRentDisplay": format_currency(total_expected_rent),
            "vacancyLoss": total_vacancy_loss,
            "vacancyLossDisplay": format_currency(total_vacancy_loss),
            "rentAssertion": {
                "status": "valid" if total_rent_received <= total_expected_rent + 0.01 else "invalid",
                "rule": "received <= expected",
            },
        },
        "periods": _period_rows(prop, as_of, vacant_ranges),
        "insights": [
            {"label": "Occupancy %", "value": occupancy_pct, "display": format_percent(occupancy_pct) if occupancy_pct is not None else "—", "tone": "positive" if occupancy_pct and occupancy_pct >= 85 else "neutral"},
            {"label": "Rental Available Months", "value": available_count, "display": _months_display(available_count), "tone": "info"},
            {"label": "Occupied Months", "value": occupied_count, "display": _months_display(occupied_count), "tone": "positive"},
            {"label": "Derived Vacancy Months", "value": vacant_count, "display": _months_display(vacant_count), "tone": "neutral"},
            {"label": "Longest Vacancy", "value": longest_vacancy, "display": _months_display(longest_vacancy), "tone": "warning" if longest_vacancy else "neutral"},
            {"label": "Estimated Vacancy Cost", "value": estimated_vacancy_cost, "display": format_currency(estimated_vacancy_cost), "tone": "warning"},
        ],
        "recommendations": recommendations[:3],
    }
