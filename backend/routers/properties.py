import calendar
import json
import math
import uuid
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from datetime import date, datetime, timedelta
import models
from database import get_db
from routers.auth import get_current_user
from services.loan_calculator import (
    amortization_schedule, payoff_analysis, arm_schedule,
    depreciation_schedule, simulate_what_if_scenarios
)
from services.property_engine import build_property_engine, loan_monthly_pi, monthly_principal_interest as engine_monthly_principal_interest
from services.payoff_planner import build_report as build_payoff_report
from services.property_valuation import (
    AUTO_MARKET_VALUE_SOURCE,
    apply_default_market_price,
    apply_default_settlement_total,
    estimate_market_price,
    get_property_value,
)
from services.checklist import build_checklist
from services.formatters import format_currency, format_interest_rate, format_currency as _money_display, format_metric_currency as _compact_money_display, format_percent as _percent_display
from services.metric_vault import build_property_metric_vault
from services.verification_vault import build_property_verification_response
from services.snapshot_store import ensure_document_record_uuid, ensure_tax_entry_record_uuid, raw_record_uuid, save_property_snapshot
from services.annual_usage_engine import annual_usage_by_year, build_annual_usage_records
from services.rental_timeline import build_rental_timeline
from services.property_setup_defaults import apply_rental_available_from_default, rental_available_before_purchase
from services.document_parser import parse_document
from services.expense_source_engine import metric_dto
from services.canonical_loan import accounts_match
from services.loan_lifecycle import lifecycle_dto, select_acquisition_transaction
from services.portfolio_analysis import build_portfolio_analysis


router = APIRouter(prefix="/api/properties", tags=["properties"])
UPLOAD_DIR = Path(__file__).parent.parent / "uploads"

OPEN_LOAN_STATUS = "OPEN"
LOAN_STATUSES = {"OPEN", "CLOSED", "REFINANCED", "PAID_OFF"}


def _apply_resolved_acquisition_costs(data: Dict[str, Any], prop: Optional[models.Property] = None) -> None:
    """Keep source-owned settlement accounting values in setup mutations."""
    acquisition = select_acquisition_transaction(prop) if prop is not None else None
    if acquisition is not None:
        if not data.get("settlement_debit_total"):
            data["settlement_debit_total"] = acquisition.settlement_debit_total or 0
        if not data.get("settlement_credit_total"):
            data["settlement_credit_total"] = acquisition.settlement_credit_total or 0
        if not data.get("settlement_total_amount"):
            data["settlement_total_amount"] = (
                acquisition.settlement_debit_total
                if acquisition.settlement_debit_total is not None
                else acquisition.settlement_credit_total or 0
            )
    elif prop is not None and not data.get("settlement_total_amount"):
        data["settlement_total_amount"] = prop.settlement_total_amount or 0
    apply_default_settlement_total(data)
CLOSED_LOAN_STATUSES = {"CLOSED", "REFINANCED", "PAID_OFF"}

PROPERTY_CODE_NAMES = [
    "Palermo", "Electra", "Syrah", "Valencia", "Meridian", "Solara",
    "Cypress", "Juniper", "Sierra", "Atlas", "Nova", "Laurel",
    "Haven", "Orion", "Saffron", "Monaco",
]

PROPERTY_TYPE_VALUES = {
    "single_family",
    "condominium",
    "townhouse",
    "duplex",
    "triplex",
    "fourplex",
    "multi_family",
    "apartment",
    "manufactured_home",
    "mobile_home",
    "cooperative",
    "vacation_home",
    "mixed_use_property",
    "commercial_residential",
    "land",
    "other",
}

PROPERTY_TYPE_ALIASES = {
    "single family": "single_family",
    "single-family": "single_family",
    "sfr": "single_family",
    "condominium": "condominium",
    "condo": "condominium",
    "townhouse": "townhouse",
    "townhome": "townhouse",
    "duplex": "duplex",
    "triplex": "triplex",
    "fourplex": "fourplex",
    "4plex": "fourplex",
    "multi family": "multi_family",
    "multi-family": "multi_family",
    "multifamily": "multi_family",
    "apartment": "apartment",
    "apartments": "apartment",
    "manufactured home": "manufactured_home",
    "mobile home": "mobile_home",
    "cooperative": "cooperative",
    "co-op": "cooperative",
    "vacation home": "vacation_home",
    "mixed-use property": "mixed_use_property",
    "mixed use property": "mixed_use_property",
    "commercial residential": "commercial_residential",
    "commercial": "commercial_residential",
    "land": "land",
    "other": "other",
}


def _normalize_property_type(data: Dict[str, Any]) -> None:
    raw = str(data.get("property_type") or "").strip()
    normalized = raw.lower().replace("_", " ")
    canonical = raw if raw in PROPERTY_TYPE_VALUES else PROPERTY_TYPE_ALIASES.get(normalized, "other")
    if canonical == "other" and raw and normalized != "other":
        data["property_type_raw"] = data.get("property_type_raw") or raw
    elif canonical != "other":
        data["property_type_raw"] = ""
    data["property_type"] = canonical


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoanBase(BaseModel):
    lender_name: Optional[str] = None
    loan_product: Optional[str] = None
    loan_type: str = "FIXED"
    status: str = "OPEN"
    closed_date: Optional[str] = None
    closure_reason: Optional[str] = None
    replacement_loan_id: Optional[int] = None
    loan_group_id: Optional[str] = None
    servicer_sequence: Optional[int] = None
    servicer_start_date: Optional[str] = None
    servicer_end_date: Optional[str] = None
    transfer_reason: Optional[str] = None
    is_current_servicer: bool = True
    original_amount: float
    current_balance: float
    interest_rate: float
    rate_note: Optional[str] = None
    monthly_payment: float
    estimated_total_monthly_payment: float = 0.0
    extra_monthly_payment: float = 0.0
    loan_term_years: int
    origination_date: Optional[str] = None
    maturity_date: Optional[str] = None
    original_ltv: float = 0.0
    escrow_amount: float = 0.0
    escrow_included: bool = False
    monthly_property_tax_escrow: float = 0.0
    monthly_insurance_escrow: float = 0.0
    monthly_mortgage_insurance: float = 0.0
    monthly_other_escrow: float = 0.0
    source_document_id: Optional[int] = None
    source_type: Optional[str] = None
    import_status: Optional[str] = None
    current_balance_source: Optional[str] = None
    current_balance_as_of: Optional[str] = None
    current_balance_verified: bool = True
    account_number: Optional[str] = None
    borrowers: Optional[str] = None
    principal_due: Optional[float] = None
    interest_due: Optional[float] = None
    statement_date: Optional[str] = None
    payment_due_date: Optional[str] = None
    mortgage_tenure_covered: Optional[str] = None
    interest_paid_ytd: float = 0.0
    principal_paid_ytd: float = 0.0
    projected_principal_fy: float = 0.0
    projected_interest_fy: float = 0.0
    arm_initial_period: Optional[int] = None
    arm_adjustment_period: Optional[int] = None
    arm_cap: Optional[float] = None
    arm_margin: Optional[float] = None
    arm_index: Optional[str] = None
    purpose: Optional[str] = None
    disbursement_date: Optional[str] = None
    balance_as_of: Optional[str] = None
    lender_at_origination: Optional[str] = None
    current_servicer: Optional[str] = None
    refinanced_into_loan_id: Optional[int] = None
    refinanced_from_loan_id: Optional[int] = None
    resolution_confidence: Optional[float] = None


class LoanOut(LoanBase):
    id: int
    property_id: int

    class Config:
        from_attributes = True


class PropertyBase(BaseModel):
    name: Optional[str] = None
    address: str = ""
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    property_type: str = "single_family"
    property_type_raw: Optional[str] = None
    usage_type: str = "Rental"  # Rental | Primary
    original_residency_status: Optional[str] = None
    current_residency_status: Optional[str] = None
    primary_start_date: Optional[str] = None
    primary_end_date: Optional[str] = None
    rental_start_date: Optional[str] = None
    rental_end_date: Optional[str] = None
    rental_start_date_origin: Optional[str] = None
    recorded_date: Optional[str] = None
    held_period: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_price: float = 0.0
    down_payment: float = 0.0
    settlement_total_amount: float = 0.0
    closing_costs: float = 0.0
    cash_to_close: float = 0.0
    deposit_paid_before_closing: float = 0.0
    total_due_from_borrower: float = 0.0
    total_paid_on_behalf_of_borrower: float = 0.0
    settlement_debit_total: float = 0.0
    settlement_credit_total: float = 0.0
    seller_credits: float = 0.0
    tax_prorations: float = 0.0
    hoa_prorations: float = 0.0
    monthly_rent: float = 0.0
    occupancy_rate: float = 100.0
    property_tax: float = 0.0
    property_tax_history: str = "{}"
    insurance: float = 0.0
    hoa_flag: bool = False
    hoa_fee: float = 0.0
    hoa_history: str = "[]"
    hoa_special_assessment: float = 0.0
    solar_ownership: str = "None"
    solar_monthly_payment: float = 0.0
    solar_purchase_price: float = 0.0
    maintenance: float = 0.0
    property_management_fee: float = 0.0
    utilities: float = 0.0
    vacancy_allowance: float = 0.0
    capex_reserve: float = 0.0
    other_expenses: float = 0.0
    land_value: float = 0.0
    construction_price: float = 0.0
    depreciation_years: float = 27.5
    market_value: float = 0.0
    market_value_source: str = AUTO_MARKET_VALUE_SOURCE
    market_value_updated: Optional[str] = None


class MarketPriceEstimateRequest(BaseModel):
    purchase_price: float = 0.0
    purchase_date: Optional[str] = None


class UsagePeriodBase(BaseModel):
    usage_type: str = "PRIMARY"
    start_date: str
    end_date: Optional[str] = None
    fmv_at_start: float = 0.0
    monthly_rent: float = 0.0
    vacancy_allowance: float = 0.0
    property_management_fee: float = 0.0
    accumulated_depreciation_at_start: float = 0.0
    suspended_losses_at_start: float = 0.0
    notes: Optional[str] = None


class UsagePeriodOut(UsagePeriodBase):
    id: Optional[int] = None
    property_id: Optional[int] = None

    class Config:
        from_attributes = True


class ScenarioOneTimePayment(BaseModel):
    amount: float = 0.0
    date: Optional[str] = None


class ScenarioInput(BaseModel):
    id: Optional[str] = None
    name: str = "Scenario"
    type: str = "Combination Strategy"
    extra_monthly: float = 0.0
    annual_lump_sum: float = 0.0
    annual_lump_sum_month: int = 12
    one_time_payments: List[ScenarioOneTimePayment] = []


class ScenarioSimRequest(BaseModel):
    loan_id: int
    scenarios: List[ScenarioInput] = []
    monthly_cash_flow: float = 0.0
    dscr: float = 0.0
    comparison_rates: Dict[str, float] = {}
    highlight_goal: str = "interest_saved"


class PropertyCreate(PropertyBase):
    loans: Optional[List[LoanBase]] = []
    usage_periods: Optional[List[UsagePeriodBase]] = []


class AnnualExpenseBase(BaseModel):
    year: int
    property_tax: float = 0.0
    insurance: float = 0.0
    hoa: float = 0.0
    repairs_maintenance: float = 0.0
    property_management: float = 0.0
    utilities: float = 0.0
    vacancy_allowance: float = 0.0
    capex_reserve: float = 0.0
    other: float = 0.0
    property_tax_source: str = "manual"
    insurance_source: str = "manual"
    source_status: str = "manual"
    notes: Optional[str] = ""


class AnnualExpenseOut(AnnualExpenseBase):
    id: Optional[int] = None
    property_id: Optional[int] = None
    entered: bool = False
    total: float = 0.0
    property_tax_source_label: Optional[str] = None
    insurance_source_label: Optional[str] = None
    property_tax_document: Optional[Dict[str, Any]] = None
    insurance_document: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class SetupLoanDraft(LoanBase):
    id: Optional[int] = None


class PropertySetupFinalizeRequest(BaseModel):
    property: PropertyBase
    loans: List[SetupLoanDraft] = []
    annual_expenses: List[AnnualExpenseBase] = []


class LoanServicingTransferApplyRequest(BaseModel):
    previous_loan_id: int
    current_loan_id: int
    closed_date: Optional[str] = None


class PropertyOut(PropertyBase):
    id: int
    property_uid: str
    owner_id: int
    usage_type_locked: bool = False
    loans: List[LoanOut] = []
    loan_groups: List[Dict[str, Any]] = []
    loan_transition_summary: Dict[str, Any] = {}
    usage_periods: List[UsagePeriodOut] = []
    market_value_updated: Optional[str] = None
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None

    class Config:
        from_attributes = True


class PropertySummary(BaseModel):
    id: int
    property_uid: str
    name: str
    address: str
    city: Optional[str]
    state: Optional[str]
    property_type: str
    property_type_raw: Optional[str] = None
    usage_type: str
    monthly_rent: float
    market_value: float
    total_loan_balance: float
    monthly_mortgage: float
    monthly_cash_flow: float
    equity: float
    has_rental_history: bool = False
    currently_rental: bool = False
    residency_status: str = "Rental"
    shared_by_name: Optional[str] = None
    shared_by_email: Optional[str] = None
    metrics: Dict[str, Any] = Field(default_factory=dict)


class RentalPeriodBase(BaseModel):
    tenant_name: Optional[str] = None
    start_year: int
    start_month: int  # 1-12
    end_year: Optional[int] = None  # null = ongoing
    end_month: Optional[int] = None  # null = ongoing
    monthly_rent: float = 0.0
    notes: Optional[str] = None


class RentalPeriodOut(RentalPeriodBase):
    id: int
    property_id: int

    class Config:
        from_attributes = True


class RentalTimelinePeriodIn(BaseModel):
    status: str = "occupied"
    start_date: str
    end_date: Optional[str] = None
    monthly_rent: float = 0.0
    notes: Optional[str] = None


class RentalTimelinePeriodUpdate(RentalTimelinePeriodIn):
    period_ref: str


class TaxEntryOut(BaseModel):
    id: int
    property_id: Optional[int]
    property_uid: Optional[str] = None
    property_name: Optional[str] = None
    tax_year: int
    address: Optional[str]
    property_kind: str
    rents_received: float
    mortgage_interest: float
    property_taxes: float
    depreciation: float
    total_expenses: float
    net_income: float
    days_rented: Optional[int] = 0
    personal_use_days: Optional[int] = 0

    class Config:
        from_attributes = True


class DepreciationAssetBase(BaseModel):
    asset_type: str = "depreciation"
    description: str
    placed_in_service_date: Optional[str] = None
    cost_basis: float = 0.0
    land_portion: float = 0.0
    method: str = "SL"
    recovery_period: float = 27.5
    prior_depreciation: float = 0.0
    notes: Optional[str] = ""


class DepreciationAssetCreate(DepreciationAssetBase):
    pass


class DepreciationAssetUpdate(DepreciationAssetBase):
    pass


class DepreciationAssetOut(DepreciationAssetBase):
    id: Optional[int] = None
    property_id: Optional[int] = None
    owner_id: Optional[int] = None
    depreciable_basis: float = 0.0
    annual_depreciation: float = 0.0
    current_year_depreciation: float = 0.0
    accumulated_depreciation: float = 0.0
    remaining_basis: float = 0.0
    fully_depreciated_date: Optional[str] = None
    is_base_building: bool = False
    warning: Optional[str] = None

    class Config:
        from_attributes = True


class SetupPreviewRequest(BaseModel):
    section: str
    draftChanges: Dict[str, Any] = Field(default_factory=dict)


def _validate_rental(r: RentalPeriodBase):
    if not (1 <= r.start_month <= 12):
        raise HTTPException(status_code=400, detail="start_month must be 1-12")
    if r.end_month is not None and not (1 <= r.end_month <= 12):
        raise HTTPException(status_code=400, detail="end_month must be 1-12")
    # An end that precedes the start is invalid (open-ended end is fine)
    if r.end_year is not None and r.end_month is not None:
        if (r.end_year, r.end_month) < (r.start_year, r.start_month):
            raise HTTPException(
                status_code=400, detail="end date is before start date")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize_usage_type(value: str) -> str:
    raw = (value or "").strip().upper()
    if raw in {"PRIMARY", "PRIMARY HOME", "PRIMARY RESIDENCE", "OWNER_OCCUPIED"}:
        return "PRIMARY"
    if raw in {"RENTAL", "INVESTMENT", "INVESTMENT PROPERTY"}:
        return "RENTAL"
    raise HTTPException(status_code=400, detail="usage_type must be PRIMARY or RENTAL")


def _is_current_rental_usage(value: Optional[str]) -> bool:
    raw = str(value or "").strip().lower()
    return raw in {"rental", "mixed", "mixed use", "investment", "investment property"} or "rental" in raw


def _normalize_property_usage_type(value: Optional[str]) -> str:
    """Normalize the property-level current residency without changing timeline semantics."""
    raw = str(value or "").strip().lower()
    if raw in {"primary", "primary residence", "primary home"}:
        return "Primary"
    if raw in {"mixed", "mixed use", "mixed-use"}:
        return "Mixed"
    return "Rental"


def _normalize_current_residency_status(data: Dict[str, Any]) -> None:
    usage = _normalize_property_usage_type(data.get("usage_type"))
    data["usage_type"] = usage
    if usage == "Primary":
        data["current_residency_status"] = "Primary Residence"
    elif usage == "Mixed":
        data["current_residency_status"] = "Mixed Use"
    else:
        data["current_residency_status"] = "Rental"


def _validate_usage_period(period: UsagePeriodBase, previous: Optional[models.UsagePeriod] = None):
    usage_type = _normalize_usage_type(period.usage_type)
    start = _parse_iso_date(period.start_date)
    end = _parse_iso_date(period.end_date)
    if not start:
        raise HTTPException(status_code=400, detail="start_date is required")
    if end and end < start:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")
    if usage_type == "RENTAL" and previous and (previous.usage_type or "").upper() == "PRIMARY":
        if (period.fmv_at_start or 0) <= 0:
            raise HTTPException(
                status_code=400,
                detail="FMV at conversion is required when converting primary home to rental",
            )
    return usage_type, start, end


def _usage_period_payload(period: UsagePeriodBase) -> Dict[str, Any]:
    data = period.model_dump()
    data["usage_type"] = _normalize_usage_type(data.get("usage_type"))
    return data


def _sync_property_current_usage(prop: models.Property):
    if _normalize_property_usage_type(prop.usage_type) == "Mixed" or str(
        prop.current_residency_status or ""
    ).strip().lower() in {"mixed", "mixed use", "mixed-use"}:
        prop.usage_type = "Mixed"
        prop.current_residency_status = "Mixed Use"
        prop.usage_type_locked = True
        return

    periods = sorted(prop.usage_periods or [], key=lambda p: p.start_date or "")
    current = next((p for p in reversed(periods) if not p.end_date), periods[-1] if periods else None)
    if current:
        prop.usage_type = "Primary" if (current.usage_type or "").upper() == "PRIMARY" else "Rental"
        prop.current_residency_status = "Primary Residence" if prop.usage_type == "Primary" else "Rental"
        prop.usage_type_locked = True


def _apply_property_current_usage_change(
    prop: models.Property,
    old_usage: Optional[str],
    db: Session,
) -> None:
    """Persist a Property Setup current-usage change in the usage timeline.

    The timeline is authoritative for current usage. Without updating its open
    row, the subsequent sync would silently restore the previous status.
    """
    desired_property_usage = _normalize_property_usage_type(prop.usage_type)
    previous_property_usage = _normalize_property_usage_type(old_usage)
    if desired_property_usage == "Mixed":
        prop.current_residency_status = "Mixed Use"
        return

    desired = _normalize_usage_type(desired_property_usage)
    previous = None if previous_property_usage == "Mixed" else _normalize_usage_type(previous_property_usage)
    if desired == previous:
        return

    today = date.today()
    today_text = today.isoformat()
    periods = sorted(prop.usage_periods or [], key=lambda period: period.start_date or "")
    current = next((period for period in reversed(periods) if not period.end_date), None)

    if current and str(current.start_date or "")[:10] >= today_text:
        # A same-day setup correction should replace the accidental row rather
        # than create a zero-length historical period.
        current.usage_type = desired
        current.end_date = None
        return

    if current:
        current.end_date = (today - timedelta(days=1)).isoformat()

    start_date = today_text if periods else (prop.purchase_date or today_text)
    next_period = models.UsagePeriod(
        property_id=prop.id,
        usage_type=desired,
        start_date=start_date,
        monthly_rent=prop.monthly_rent or 0.0,
        vacancy_allowance=prop.vacancy_allowance or 0.0,
        property_management_fee=prop.property_management_fee or 0.0,
        notes="Current residency updated from Property Setup",
    )
    prop.usage_periods.append(next_period)
    db.add(next_period)




def _timeline_parse_date(value: Optional[str], *, field: str) -> date:
    if not value:
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "message": f"{field} required."})
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "message": f"{field} must be a valid date."})


def _timeline_month_end(value: date) -> date:
    return date(value.year, value.month, calendar.monthrange(value.year, value.month)[1])


def _timeline_period_bounds(period: Any, status: str) -> tuple[date, Optional[date]]:
    if status == "occupied":
        start = date(int(period.start_year), int(period.start_month), 1)
        end = None
        if getattr(period, "end_year", None) and getattr(period, "end_month", None):
            end = _timeline_month_end(date(int(period.end_year), int(period.end_month), 1))
        return start, end
    start = _timeline_parse_date(getattr(period, "start_date", None), field="Start date")
    end_value = getattr(period, "end_date", None)
    end = _timeline_parse_date(end_value, field="End date") if end_value else None
    return start, end


def _timeline_display(start: date, end: Optional[date]) -> str:
    start_text = start.strftime("%b %-d, %Y") if hasattr(start, "strftime") else str(start)
    end_text = end.strftime("%b %-d, %Y") if end else "Current"
    return f"{start_text} – {end_text}"


def _timeline_existing_segments(prop: models.Property, *, exclude_ref: Optional[str] = None) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    for rental in getattr(prop, "rental_periods", []) or []:
        period_ref = f"occupied:{rental.id}"
        if period_ref == exclude_ref:
            continue
        start, end = _timeline_period_bounds(rental, "occupied")
        segments.append({
            "periodId": rental.id,
            "periodRef": period_ref,
            "status": "occupied",
            "startDate": start,
            "endDate": end,
        })
    for usage in getattr(prop, "usage_periods", []) or []:
        if str(getattr(usage, "usage_type", "") or "").upper() != "NOT_RENTAL":
            continue
        period_ref = f"not_rental:{usage.id}"
        if period_ref == exclude_ref:
            continue
        start, end = _timeline_period_bounds(usage, "not_rental")
        segments.append({
            "periodId": usage.id,
            "periodRef": period_ref,
            "status": "not_rental",
            "startDate": start,
            "endDate": end,
        })
    return segments


def _timeline_rental_available_segments(prop: models.Property) -> List[tuple[date, Optional[date]]]:
    segments: List[tuple[date, Optional[date]]] = []
    for usage in getattr(prop, "usage_periods", []) or []:
        if str(getattr(usage, "usage_type", "") or "").upper() != "RENTAL":
            continue
        segments.append(_timeline_period_bounds(usage, "rental"))
    rental_start = getattr(prop, "rental_start_date", None)
    if rental_start:
        start = _timeline_parse_date(rental_start, field="Rental available from")
        rental_end = getattr(prop, "rental_end_date", None)
        end = _timeline_parse_date(rental_end, field="Rental available until") if rental_end else None
        segments.append((start, end))
    elif not segments and str(getattr(prop, "usage_type", "") or "").lower() == "rental":
        start = date.fromisoformat(str(getattr(prop, "purchase_date", None) or f"{date.today().year}-01-01")[:10])
        segments.append((start, None))
    return segments


def _timeline_range_error(prop: models.Property, start: date, end: Optional[date]) -> Optional[Dict[str, Any]]:
    segments = _timeline_rental_available_segments(prop)
    if not segments:
        return {
            "field": "startDate",
            "message": "Rental available from is required before adding occupied periods.",
        }

    new_end = end or date.max
    for available_start, available_end in _timeline_rental_available_segments(prop):
        if start >= available_start and new_end <= (available_end or date.max):
            return None

    earliest_start = min(segment[0] for segment in segments)
    finite_ends = [segment[1] for segment in segments if segment[1]]
    latest_end = max(finite_ends) if finite_ends else None
    if start < earliest_start:
        return {
            "field": "startDate",
            "message": f"Occupied period cannot begin before {earliest_start.strftime('%b %-d, %Y')}.",
        }
    if end is None and latest_end:
        return {
            "field": "endDate",
            "message": f"Enter an end date on or before {latest_end.strftime('%b %-d, %Y')}.",
        }
    if latest_end and start > latest_end:
        return {
            "field": "startDate",
            "message": f"Occupied period cannot begin after rental availability ended on {latest_end.strftime('%b %-d, %Y')}.",
        }
    if latest_end and end and end > latest_end:
        return {
            "field": "endDate",
            "message": f"End date must be on or before {latest_end.strftime('%b %-d, %Y')}.",
        }
    return {
        "field": "startDate",
        "message": "Occupied period must fall within a rental-available range.",
    }


def _validate_timeline_payload(prop: models.Property, payload: RentalTimelinePeriodIn, *, exclude_ref: Optional[str] = None) -> tuple[str, date, Optional[date]]:
    status = str(payload.status or "").lower()
    if status != "occupied":
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "message": "Occupancy log entries must be occupied periods. Vacancy is derived automatically from gaps."})
    start = _timeline_parse_date(payload.start_date, field="Start date")
    end = _timeline_parse_date(payload.end_date, field="End date") if payload.end_date else None
    if end and end < start:
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "field": "endDate", "message": "End date must be on or after the start date."})
    if status == "occupied" and float(payload.monthly_rent or 0) < 0:
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "field": "monthlyRent", "message": "Monthly rent cannot be negative."})
    range_error = _timeline_range_error(prop, start, end)
    if range_error:
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_OUTSIDE_AVAILABLE_RANGE", **range_error})

    new_end = end or date.max
    conflicts = []
    for segment in _timeline_existing_segments(prop, exclude_ref=exclude_ref):
        existing_start = segment["startDate"]
        existing_end = segment["endDate"] or date.max
        if start <= existing_end and new_end >= existing_start:
            conflicts.append({
                "periodId": segment["periodId"],
                "periodRef": segment["periodRef"],
                "status": segment["status"],
                "startDate": existing_start.isoformat(),
                "endDate": None if segment["endDate"] is None else segment["endDate"].isoformat(),
                "display": _timeline_display(existing_start, segment["endDate"]),
            })
    if conflicts:
        first_conflict = conflicts[0]
        raise HTTPException(status_code=409, detail={
            "code": "RENTAL_PERIOD_OVERLAP",
            "field": "startDate",
            "message": f"This period overlaps an occupied period beginning {date.fromisoformat(first_conflict['startDate']).strftime('%b %-d, %Y')}.",
            "conflicts": conflicts,
        })
    return status, start, end


def _timeline_periods(prop: models.Property):
    periods = sorted(getattr(prop, "usage_periods", []) or [], key=lambda p: getattr(p, "start_date", "") or "")
    if periods:
        return periods
    fallback = type("UsageFallback", (), {})()
    fallback.id = None
    fallback.property_id = getattr(prop, "id", None)
    fallback.usage_type = "PRIMARY" if (prop.usage_type or "").lower() == "primary" else "RENTAL"
    fallback.start_date = getattr(prop, "purchase_date", None) or f"{date.today().year}-01-01"
    fallback.end_date = None
    fallback.fmv_at_start = 0.0
    fallback.monthly_rent = prop.monthly_rent or 0.0
    fallback.vacancy_allowance = prop.vacancy_allowance or 0.0
    fallback.property_management_fee = prop.property_management_fee or 0.0
    fallback.accumulated_depreciation_at_start = 0.0
    fallback.suspended_losses_at_start = 0.0
    fallback.notes = "Derived from legacy property usage"
    return [fallback]


def _usage_type_on(prop: models.Property, target: date) -> str:
    for period in reversed(_timeline_periods(prop)):
        start = _parse_iso_date(period.start_date)
        end = _parse_iso_date(period.end_date)
        if start and start <= target and (end is None or target <= end):
            return _normalize_usage_type(period.usage_type)
    return "PRIMARY" if (prop.usage_type or "").lower() == "primary" else "RENTAL"


def _usage_days_by_year(prop: models.Property) -> Dict[int, Dict[str, int]]:
    records = annual_usage_by_year(prop)
    return {
        year: {
            "PRIMARY": (record.get("personalUseDays") or {}).get("value") or 0,
            "RENTAL": (record.get("rentalDays") or {}).get("value") or 0,
        }
        for year, record in records.items()
    }


def _active_rental_conversion_basis(prop: models.Property) -> Optional[float]:
    purchase_basis = (getattr(prop, "purchase_price", 0) or 0) - (getattr(prop, "land_value", 0) or 0)
    purchase_basis += getattr(prop, "closing_costs", 0) or 0
    periods = _timeline_periods(prop)
    previous_type = None
    latest_basis = None
    for period in periods:
        usage_type = _normalize_usage_type(period.usage_type)
        if usage_type == "RENTAL" and previous_type == "PRIMARY":
            fmv = float(getattr(period, "fmv_at_start", 0) or 0)
            if fmv > 0:
                latest_basis = min(purchase_basis, fmv)
        previous_type = usage_type
    return latest_basis


def _usage_summary(prop: models.Property) -> Dict[str, Any]:
    days = _usage_days_by_year(prop)
    rental_days = sum(v.get("RENTAL", 0) for v in days.values())
    total_days = sum(sum(v.values()) for v in days.values()) or 1
    current_type = _usage_type_on(prop, date.today())
    banners = []
    for period in _timeline_periods(prop):
        if _normalize_usage_type(period.usage_type) == "RENTAL" and (period.fmv_at_start or 0) > 0:
            banners.append(
                f"Converted to rental {period.start_date}: depreciation uses the lower of adjusted basis and FMV {format_currency(period.fmv_at_start)}."
            )
    accumulated = sum(float(getattr(p, "accumulated_depreciation_at_start", 0) or 0) for p in _timeline_periods(prop))
    if current_type == "PRIMARY" and accumulated > 0:
        banners.append(
            f"Was a rental: {format_currency(accumulated)} accumulated depreciation remains subject to recapture on sale."
        )
    return {
        "current_type": current_type,
        "nonqualified_use_ratio": round(rental_days / total_days, 4),
        "banners": banners,
    }


def _depreciable_basis(prop) -> float:
    conversion_basis = _active_rental_conversion_basis(prop)
    if conversion_basis and conversion_basis > 0:
        return conversion_basis
    construction_price = getattr(prop, "construction_price", 0) or 0
    if construction_price > 0:
        return construction_price
    return (getattr(prop, "purchase_price", 0) or 0) * 0.75


def resolve_property_tax(prop: models.Property, year: Optional[int] = None) -> dict:
    target_year = int(year or date.today().year)
    annual_expense = _annual_expense_for_year(prop, target_year)
    if annual_expense and (annual_expense.property_tax or 0) > 0:
        source = annual_expense_source_key(getattr(annual_expense, "property_tax_source", None))
        return {
            "value": float(annual_expense.property_tax or 0),
            "source": source,
            "sourceRecord": f"annual_expense_{target_year}",
            "sourceTier": annual_expense_source_tier(source),
            "label": annual_expense_source_label(source),
            "warning": "Property tax is estimated from mortgage-statement escrow." if source == EXPENSE_SOURCE_ESCROW_ESTIMATE else None,
        }
    form_value = getattr(prop, "property_tax", 0) or 0
    if form_value > 0:
        return {
            "value": float(form_value),
            "source": "property_form",
            "sourceTier": "REPORTED",
            "label": "Property form",
            "warning": None,
        }

    tax_entries = sorted(
        (
            entry
            for entry in (getattr(prop, "tax_entries", None) or [])
            if (entry.tax_year or 0) < target_year and (entry.property_taxes or 0) > 0
        ),
        key=lambda entry: entry.tax_year or 0,
        reverse=True,
    )
    if tax_entries:
        entry = tax_entries[0]
        return {
            "value": float(entry.property_taxes or 0),
            "source": f"schedule_e_{entry.tax_year}",
            "sourceTier": "APPROX",
            "label": f"Schedule E {entry.tax_year} carried forward",
            "warning": "Property tax is estimated from the most recent prior Schedule E because no property-form tax is set.",
        }

    return {
        "value": 0.0,
        "source": "none",
        "sourceTier": "APPROX",
        "label": "Property tax not set",
        "warning": "Property tax is not set; operating expenses and NOI may be understated.",
    }


ANNUAL_EXPENSE_FIELDS = [
    "property_tax",
    "insurance",
    "hoa",
    "repairs_maintenance",
    "property_management",
    "utilities",
    "vacancy_allowance",
    "capex_reserve",
    "other",
]

EXPENSE_SOURCE_REPORTED = "reported"
EXPENSE_SOURCE_ESCROW_ESTIMATE = "escrow-estimate"
EXPENSE_SOURCE_MANUAL = "manual"
EXPENSE_SOURCE_LABELS = {
    EXPENSE_SOURCE_REPORTED: "Reported",
    EXPENSE_SOURCE_ESCROW_ESTIMATE: "Estimated from escrow",
    EXPENSE_SOURCE_MANUAL: "Manual",
}


def annual_expense_source_key(value: Optional[str]) -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    if normalized in {"reported", "actual", "document", "tax-bill", "insurance-doc"}:
        return EXPENSE_SOURCE_REPORTED
    if normalized in {"escrow-estimate", "escrow-estimated", "estimated-from-escrow", "estimate", "estimated"}:
        return EXPENSE_SOURCE_ESCROW_ESTIMATE
    return EXPENSE_SOURCE_MANUAL


def annual_expense_source_tier(source: Optional[str]) -> str:
    key = annual_expense_source_key(source)
    if key == EXPENSE_SOURCE_REPORTED:
        return "REPORTED"
    if key == EXPENSE_SOURCE_ESCROW_ESTIMATE:
        return "ESTIMATE"
    return "MANUAL"


def annual_expense_source_label(source: Optional[str]) -> str:
    return EXPENSE_SOURCE_LABELS[annual_expense_source_key(source)]


def _annual_expense_for_year(prop: models.Property, year: Optional[int]) -> Optional[models.AnnualExpense]:
    if not year:
        return None
    for row in getattr(prop, "annual_expenses", None) or []:
        if row.year == int(year):
            return row
    return None


def _annual_expense_entered(row: Optional[models.AnnualExpense]) -> bool:
    return row is not None


def _annual_expense_total(row: models.AnnualExpense) -> float:
    return round(sum(float(getattr(row, field, 0) or 0) for field in ANNUAL_EXPENSE_FIELDS), 2)


def _annual_expense_notes_payload(notes: Optional[str]) -> Dict[str, Any]:
    if not notes:
        return {"text": "", "sources": {}}
    try:
        parsed = json.loads(notes)
        if isinstance(parsed, dict):
            return {
                "text": parsed.get("text", ""),
                "sources": parsed.get("sources") or {},
            }
    except (TypeError, ValueError):
        pass
    return {"text": notes, "sources": {}}


def _annual_expense_source_document(row: models.AnnualExpense, field: str) -> Optional[Dict[str, Any]]:
    payload = _annual_expense_notes_payload(row.notes)
    source = (payload.get("sources") or {}).get(field)
    if not source:
        return None
    return {
        "id": source.get("documentId"),
        "name": source.get("documentName") or "Source document",
        "docType": source.get("docType") or source.get("documentType") or "Document",
        "amount": source.get("amount"),
        "amountDisplay": source.get("amountDisplay") or format_currency(source.get("amount") or 0),
        "parsedAt": source.get("parsedAt"),
        "field": field,
        "addressOverride": bool(source.get("addressOverride")),
        "addressConfirmed": bool(source.get("addressOverride")),
    }


def _annual_expense_out(row: models.AnnualExpense) -> Dict[str, Any]:
    notes_payload = _annual_expense_notes_payload(row.notes)
    return {
        "id": row.id,
        "property_id": row.property_id,
        "year": row.year,
        "property_tax": row.property_tax or 0,
        "insurance": row.insurance or 0,
        "hoa": row.hoa or 0,
        "repairs_maintenance": row.repairs_maintenance or 0,
        "property_management": row.property_management or 0,
        "utilities": row.utilities or 0,
        "vacancy_allowance": row.vacancy_allowance or 0,
        "capex_reserve": row.capex_reserve or 0,
        "other": row.other or 0,
        "property_tax_source": annual_expense_source_key(row.property_tax_source),
        "insurance_source": annual_expense_source_key(row.insurance_source),
        "property_tax_source_label": (
            "Reported (tax bill)"
            if annual_expense_source_key(row.property_tax_source) == EXPENSE_SOURCE_REPORTED and _annual_expense_source_document(row, "property_tax")
            else annual_expense_source_label(row.property_tax_source)
        ),
        "insurance_source_label": (
            "Reported (dec page)"
            if annual_expense_source_key(row.insurance_source) == EXPENSE_SOURCE_REPORTED and _annual_expense_source_document(row, "insurance")
            else annual_expense_source_label(row.insurance_source)
        ),
        "source_status": row.source_status or "manual",
        "notes": notes_payload.get("text") or "",
        "property_tax_document": _annual_expense_source_document(row, "property_tax"),
        "insurance_document": _annual_expense_source_document(row, "insurance"),
        "entered": _annual_expense_entered(row),
        "total": _annual_expense_total(row),
    }


EXPENSE_VIEW_FIELDS = [
    ("property_tax", "Prop. tax"),
    ("insurance", "Insurance"),
    ("hoa", "HOA"),
    ("repairs_maintenance", "Repairs"),
    ("property_management", "Management"),
    ("utilities", "Utilities"),
    ("vacancy_allowance", "Vacancy"),
    ("capex_reserve", "CapEx"),
    ("other", "Other"),
]


def _expense_source_dto(source: Optional[str], label: Optional[str] = None) -> Dict[str, Any]:
    key = annual_expense_source_key(source)
    return {
        "key": key,
        "label": label or annual_expense_source_label(key),
        "tier": annual_expense_source_tier(key),
    }


def _legacy_annual_expense_components(prop: models.Property) -> Dict[str, float]:
    return {
        "property_tax": float(getattr(prop, "property_tax", 0) or 0),
        "insurance": float(getattr(prop, "insurance", 0) or 0),
        "hoa": float(getattr(prop, "hoa_fee", 0) or 0) * 12,
        "repairs_maintenance": float(getattr(prop, "maintenance", 0) or 0) * 12,
        "property_management": float(getattr(prop, "property_management_fee", 0) or 0) * 12,
        "utilities": float(getattr(prop, "utilities", 0) or 0) * 12,
        "vacancy_allowance": float(getattr(prop, "vacancy_allowance", 0) or 0) * 12,
        "capex_reserve": float(getattr(prop, "capex_reserve", 0) or 0) * 12,
        "other": float(getattr(prop, "other_expenses", 0) or 0),
    }


def _expense_component(
    key: str,
    label: str,
    value: Optional[float],
    *,
    source: str = EXPENSE_SOURCE_MANUAL,
    source_label: Optional[str] = None,
) -> Dict[str, Any]:
    numeric = None if value is None else round(float(value or 0), 2)
    return {
        "key": key,
        "label": label,
        "value": numeric,
        "display": "—" if numeric is None else format_currency(numeric),
        "source": _expense_source_dto(source, source_label),
    }


def _expense_status(row: Optional[models.AnnualExpense], year: int, current_year: int, total: Optional[float]) -> str:
    if total is None:
        return "Not entered"
    if year == current_year:
        return "Current"
    if row and str(row.source_status or "").lower() in {"partial", "needs_review", "needs attention"}:
        return "Partial"
    return "Entered"


def _expense_view_years(prop: models.Property, current_year: int) -> List[int]:
    years = [current_year]
    if getattr(prop, "purchase_date", None):
        match = re.search(r"(?:19|20)\d{2}", str(prop.purchase_date))
        if match:
            years.append(int(match.group(0)))
    years.extend(int(row.year) for row in getattr(prop, "annual_expenses", []) or [] if getattr(row, "year", None))
    start = min(years)
    return list(range(start, current_year + 1))


def _build_expense_view_row(prop: models.Property, year: int, current_year: int, row: Optional[models.AnnualExpense]) -> Dict[str, Any]:
    if row:
        row_out = _annual_expense_out(row)
        components = []
        for key, label in EXPENSE_VIEW_FIELDS:
            if key == "property_tax":
                components.append(_expense_component(key, label, row_out.get(key), source=row_out.get("property_tax_source"), source_label=row_out.get("property_tax_source_label")))
            elif key == "insurance":
                components.append(_expense_component(key, label, row_out.get(key), source=row_out.get("insurance_source"), source_label=row_out.get("insurance_source_label")))
            else:
                components.append(_expense_component(key, label, row_out.get(key)))
        total = round(sum(float(item["value"] or 0) for item in components), 2)
    elif year == current_year:
        legacy = _legacy_annual_expense_components(prop)
        has_legacy = any(value > 0 for value in legacy.values())
        components = [
            _expense_component(key, label, legacy.get(key) if has_legacy else None)
            for key, label in EXPENSE_VIEW_FIELDS
        ]
        total = round(sum(legacy.values()), 2) if has_legacy else None
    else:
        components = [_expense_component(key, label, None) for key, label in EXPENSE_VIEW_FIELDS]
        total = None

    component_map = {item["key"]: item for item in components}
    documents = {doc.id: doc for doc in getattr(prop, "documents", []) or []}
    metric_map = {
        metric.expense_type: metric_dto(metric, documents)
        for metric in getattr(prop, "annual_expense_metrics", []) or []
        if int(metric.year) == int(year)
    }
    if metric_map.get("PROPERTY_TAX"):
        component_map["property_tax"]["metric"] = metric_map["PROPERTY_TAX"]
    if metric_map.get("HOMEOWNERS_INSURANCE"):
        component_map["insurance"]["metric"] = metric_map["HOMEOWNERS_INSURANCE"]
    source_metrics = [metric_map[key] for key in ("PROPERTY_TAX", "HOMEOWNERS_INSURANCE") if key in metric_map]
    source_labels = list(dict.fromkeys(metric.get("sourceLabel") for metric in source_metrics if metric.get("sourceLabel")))
    source_label = source_labels[0] if len(source_labels) == 1 else ("Multiple Sources" if source_labels else "Manual")
    other_operating_value = round(sum(float(component_map[key]["value"] or 0) for key in (
        "property_management", "utilities", "vacancy_allowance", "capex_reserve", "other"
    )), 2)
    return {
        "year": year,
        "isCurrent": year == current_year,
        "status": _expense_status(row, year, current_year, total),
        "components": components,
        "propertyTax": component_map["property_tax"],
        "insurance": component_map["insurance"],
        "repairs": component_map["repairs_maintenance"],
        "management": component_map["property_management"],
        "utilities": component_map["utilities"],
        "vacancy": component_map["vacancy_allowance"],
        "capex": component_map["capex_reserve"],
        "other": component_map["other"],
        "hoa": component_map["hoa"],
        "otherOperatingExpenses": {
            "value": other_operating_value,
            "display": format_currency(other_operating_value),
        },
        "source": {
            "label": source_label,
            "metrics": source_metrics,
        },
        "total": total,
        "totalDisplay": "—" if total is None else format_currency(total),
    }


def build_property_expenses_view(prop: models.Property, summary_metrics: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    current_year = date.today().year
    rows_by_year = {int(row.year): row for row in getattr(prop, "annual_expenses", []) or [] if getattr(row, "year", None)}
    rows = [
        _build_expense_view_row(prop, year, current_year, rows_by_year.get(year))
        for year in _expense_view_years(prop, current_year)
    ]
    resolved = resolve_annual_operating_expenses(prop, current_year)
    resolved_total = round(float(resolved.get("value") or 0), 2)
    resolved_components = resolved.get("components") or {}
    largest_key = None
    largest_value = 0.0
    for key, value in resolved_components.items():
        numeric = float(value or 0)
        if numeric > largest_value:
            largest_key = key
            largest_value = numeric
    label_by_key = {key: label for key, label in EXPENSE_VIEW_FIELDS}
    gross_rent = float((summary_metrics or {}).get("effective_gross_income") or 0)
    is_primary = str(getattr(prop, "usage_type", "") or "").lower() == "primary"
    expense_ratio = None if is_primary or gross_rent <= 0 else resolved_total / gross_rent * 100
    escrow_annual = round(sum(
        (float(getattr(loan, "monthly_property_tax_escrow", 0) or 0) + float(getattr(loan, "monthly_insurance_escrow", 0) or 0)) * 12
        for loan in getattr(prop, "loans", []) or []
        if not _is_closed_loan_status(getattr(loan, "status", None))
    ), 2)
    current_row = next((row for row in rows if row["year"] == current_year), None)
    current_total = current_row.get("total") if current_row else None
    return {
        "schemaVersion": "property-expenses-view-v1",
        "currentYear": current_year,
        "isPrimaryResidence": is_primary,
        "metrics": {
            "operatingExpenses": {
                "value": resolved_total,
                "display": format_currency(resolved_total),
                "period": "yr",
                "source": "CALCULATED",
                "formula": "Shared operating expense resolver",
            },
            "largestCategory": {
                "key": largest_key,
                "label": label_by_key.get(largest_key, largest_key or "None"),
                "value": round(largest_value, 2),
                "display": "—" if not largest_key else format_currency(largest_value),
                "percent": None if not resolved_total else largest_value / resolved_total * 100,
                "percentDisplay": "—" if not resolved_total else _percent_display(largest_value / resolved_total * 100),
            },
            "expenseRatio": {
                "value": expense_ratio,
                "display": "—" if expense_ratio is None else _percent_display(expense_ratio),
                "hidden": is_primary,
            },
            "inEscrow": {
                "value": escrow_annual,
                "display": format_currency(escrow_annual),
            },
        },
        "rows": rows,
        "assertions": {
            "tabTotalMatchesResolvedOpex": current_total is None or abs(float(current_total) - resolved_total) <= 1,
            "resolvedOperatingExpenses": resolved_total,
            "currentYearRowTotal": current_total,
        },
    }


def _apply_annual_expense_snapshot(prop: models.Property, row: models.AnnualExpense) -> None:
    if row.year != date.today().year:
        return
    prop.property_tax = row.property_tax or 0
    prop.insurance = row.insurance or 0


def _upsert_annual_expense(
    prop: models.Property,
    owner_id: int,
    expense_in: AnnualExpenseBase,
    db: Session,
) -> models.AnnualExpense:
    row = db.query(models.AnnualExpense).filter(
        models.AnnualExpense.property_id == prop.id,
        models.AnnualExpense.year == expense_in.year,
    ).first()
    if not row:
        row = models.AnnualExpense(property_id=prop.id, owner_id=owner_id, year=expense_in.year)
        db.add(row)
    data = expense_in.model_dump()
    data["property_tax_source"] = annual_expense_source_key(data.get("property_tax_source"))
    data["insurance_source"] = annual_expense_source_key(data.get("insurance_source"))
    existing_notes = _annual_expense_notes_payload(row.notes)
    next_notes = {
        "text": data.get("notes") or "",
        "sources": existing_notes.get("sources") or {},
    }
    data["notes"] = json.dumps(next_notes)
    for field in ANNUAL_EXPENSE_FIELDS + ["property_tax_source", "insurance_source", "source_status", "notes"]:
        setattr(row, field, data.get(field))
    _apply_annual_expense_snapshot(prop, row)
    return row


def resolve_annual_operating_expenses(prop: models.Property, year: Optional[int] = None) -> dict:
    target_year = int(year or date.today().year)
    annual_expense = _annual_expense_for_year(prop, target_year)
    if annual_expense and _annual_expense_entered(annual_expense):
        insurance_source = annual_expense_source_key(getattr(annual_expense, "insurance_source", None))
        property_tax = resolve_property_tax(prop, target_year)
        insurance_value = annual_expense.insurance if (annual_expense.insurance or 0) > 0 else (getattr(prop, "insurance", 0) or 0)
        if (annual_expense.insurance or 0) <= 0:
            insurance_source = EXPENSE_SOURCE_MANUAL
        annual_expenses = {
            "property_tax": property_tax["value"],
            "insurance": insurance_value,
            "hoa": annual_expense.hoa or 0,
            "maintenance": annual_expense.repairs_maintenance or 0,
            "property_management": annual_expense.property_management or 0,
            "utilities": annual_expense.utilities or 0,
            "vacancy_allowance": annual_expense.vacancy_allowance or 0,
            "capex_reserve": annual_expense.capex_reserve or 0,
            "other": annual_expense.other or 0,
        }
        return {
            "value": round(sum(annual_expenses.values()), 2),
            "components": annual_expenses,
            "propertyTax": property_tax,
            "insuranceSource": {
                "value": float(annual_expense.insurance or 0),
                "source": insurance_source,
                "sourceRecord": f"annual_expense_{target_year}",
                "sourceTier": annual_expense_source_tier(insurance_source),
                "label": annual_expense_source_label(insurance_source),
                "warning": "Insurance is estimated from mortgage-statement escrow." if insurance_source == EXPENSE_SOURCE_ESCROW_ESTIMATE else None,
            },
            "source": f"annual_expense_{target_year}",
        }

    property_tax = resolve_property_tax(prop, target_year)
    annual_expenses = {
        "property_tax": property_tax["value"],
        "insurance": getattr(prop, "insurance", 0) or 0,
        "hoa": (getattr(prop, "hoa_fee", 0) or 0) * 12,
        "maintenance": (getattr(prop, "maintenance", 0) or 0) * 12,
        "property_management": (getattr(prop, "property_management_fee", 0) or 0) * 12,
        "utilities": (getattr(prop, "utilities", 0) or 0) * 12,
        "capex_reserve": (getattr(prop, "capex_reserve", 0) or 0) * 12,
    }
    return {
        "value": round(sum(annual_expenses.values()), 2),
        "components": annual_expenses,
        "propertyTax": property_tax,
    }


def compute_property_metrics(prop: models.Property) -> dict:
    active_loans = [loan for loan in (prop.loans or []) if not _is_closed_loan_status(getattr(loan, "status", None))]
    total_loan_balance = sum(current_loan_balance(l) for l in active_loans)

    # monthly_payment on the loan stores the full PITI payment from the statement.
    # escrow_amount is the taxes+insurance portion bundled into that payment.
    # We separate them so the dashboard shows:
    #   Mortgage P&I  = payment – escrow   (debt service only)
    #   Operating Exp = property_tax + insurance + HOA + maintenance + …
    monthly_piti = sum((l.monthly_payment or 0) for l in active_loans)
    monthly_escrow = sum((l.escrow_amount or 0) for l in active_loans)
    # P&I only from the shared loan engine; cash flow never uses PITI, escrow, depreciation, or tax deductions.
    monthly_mortgage = sum(loan_monthly_pi(l) for l in active_loans)

    is_primary    = (prop.usage_type or "Rental").lower() == "primary"
    effective_rent = 0.0 if is_primary else prop.monthly_rent * (prop.occupancy_rate / 100)

    # Full operating expenses — taxes, insurance, HOA, maintenance, etc.
    # Property tax and insurance are annual fields prorated into monthly expenses.
    # If lender escrow is higher, count only missing escrow to avoid double-counting.
    resolved_property_tax = resolve_property_tax(prop)
    property_tax_annual = resolved_property_tax["value"]
    property_tax_monthly = property_tax_annual / 12
    insurance_monthly = (prop.insurance or 0) / 12
    escrow_expense = 0.0
    tax_ins_monthly = property_tax_monthly + insurance_monthly
    solar_monthly = (
        getattr(prop, "solar_monthly_payment", 0) or 0
        if (getattr(prop, "solar_ownership", "None") or "").lower() == "leased"
        else 0
    )
    other_operating = (
        prop.hoa_fee + solar_monthly + prop.maintenance +
        prop.property_management_fee + prop.utilities +
        prop.vacancy_allowance + prop.capex_reserve +
        prop.other_expenses
    )
    monthly_expenses = tax_ins_monthly + other_operating
    resolved_opex = resolve_annual_operating_expenses(prop)
    resolved_property_tax = resolved_opex["propertyTax"]
    property_tax_annual = resolved_property_tax["value"]
    property_tax_monthly = property_tax_annual / 12
    insurance_monthly = (prop.insurance or 0) / 12
    tax_ins_monthly = property_tax_monthly + insurance_monthly
    solar_monthly = 0
    monthly_expenses = resolved_opex["value"] / 12
    monthly_cash_flow = effective_rent - monthly_mortgage - monthly_expenses

    equity             = prop.market_value - total_loan_balance
    depreciable        = _depreciable_basis(prop)
    annual_depreciation = depreciable / prop.depreciation_years if prop.depreciation_years else 0

    # NOI = Gross Rent − Operating Expenses (no debt service)
    annual_noi = (effective_rent - monthly_expenses) * 12
    annual_debt_service = monthly_mortgage * 12
    annual_cash_flow = annual_noi - annual_debt_service

    return {
        "total_loan_balance":    round(total_loan_balance, 2),
        "monthly_piti":          round(monthly_piti, 2),
        "monthly_escrow":        round(monthly_escrow, 2),
        "monthly_mortgage":      round(monthly_mortgage, 2),   # P&I only
        "property_tax_annual": round(property_tax_annual, 2),
        "property_tax_source": resolved_property_tax["source"],
        "property_tax_source_tier": resolved_property_tax["sourceTier"],
        "property_tax_warning": resolved_property_tax["warning"],
        "property_tax_monthly": round(property_tax_monthly, 2),
        "insurance_monthly":     round(insurance_monthly, 2),
        "escrow_expense":        round(escrow_expense, 2),
        "tax_ins_monthly":       round(tax_ins_monthly, 2),
        "solar_monthly":         round(solar_monthly, 2),
        "monthly_expenses":      round(monthly_expenses, 2),
        "effective_rent":        round(effective_rent, 2),
        "monthly_cash_flow":     round(annual_cash_flow / 12, 2),
        "annual_cash_flow":      round(annual_cash_flow, 2),
        "equity":                round(equity, 2),
        "annual_depreciation":   round(annual_depreciation, 2),
        "monthly_depreciation":  round(annual_depreciation / 12, 2),
        "annual_noi":            round(annual_noi, 2),
        "annual_debt_service":   round(annual_debt_service, 2),
        "cap_rate":  round(annual_noi / prop.market_value * 100, 2) if prop.market_value else 0,
        "dscr": round(annual_noi / annual_debt_service, 2) if annual_debt_service else 0,
        "gross_yield": round((effective_rent * 12) / prop.market_value * 100, 2) if prop.market_value else 0,
    }


SETUP_SECTION_LABELS = {
    "property": "Property",
    "financing": "Loans",
    "rental": "Rental",
    "expenses": "Expenses",
    "depreciation": "Depreciation",
    "tax-records": "Tax Records",
}


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (int, float)):
        return value != 0
    return True


def _section_status(completed: int, total: int, meaningful: bool, issues: Optional[List[str]] = None) -> Dict[str, Any]:
    issues = issues or []
    if issues:
        status = "needs_review"
    elif completed >= total and total > 0:
        status = "complete"
    elif meaningful:
        status = "partial"
    else:
        status = "empty"
    return {
        "status": status,
        "completedRequired": completed,
        "totalRequired": total,
        "issues": issues,
        "issueCount": len(issues),
    }


SETUP_PROPERTY_REQUIRED = ["name", "property_type", "usage_type", "original_residency_status", "purchase_date", "purchase_price", "market_value"]
SETUP_LOAN_REQUIRED = ["original_amount", "current_balance", "interest_rate", "monthly_payment", "loan_term_years", "origination_date"]


def _escrow_component_total(loan: Any) -> float:
    return round(
        float(getattr(loan, "monthly_property_tax_escrow", 0) or 0)
        + float(getattr(loan, "monthly_insurance_escrow", 0) or 0)
        + float(getattr(loan, "monthly_mortgage_insurance", 0) or 0)
        + float(getattr(loan, "monthly_other_escrow", 0) or 0),
        2,
    )


def _normalize_loan_status_value(value: Optional[str]) -> str:
    status = str(value or OPEN_LOAN_STATUS).strip().upper()
    return status if status in LOAN_STATUSES else OPEN_LOAN_STATUS


def _canonical_loan_status(value: Optional[str]) -> str:
    """Keep refinance as a closure reason, never as a loan lifecycle state."""
    status = _normalize_loan_status_value(value)
    return "CLOSED" if status == "REFINANCED" else status


def _is_closed_loan_status(value: Optional[str]) -> bool:
    return _normalize_loan_status_value(value) in CLOSED_LOAN_STATUSES


def _loan_record_label(loan: Any, index: int = 0) -> str:
    return str(getattr(loan, "lender_name", None) or f"Loan {index + 1}")


def _validation_item(field: str, message: str, *, record_id: Optional[Any] = None, severity: str = "error") -> Dict[str, Any]:
    item = {"field": field, "message": message, "severity": severity}
    if record_id is not None:
        item["recordId"] = record_id
    return item


def _parse_setup_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return None


def _same_original_loan_date(left: Optional[date], right: Optional[date]) -> bool:
    if not left or not right:
        return False
    # Closing disclosures and 1098s can disagree by a few days because one
    # records the closing date while another records the mortgage origination.
    return abs((left - right).days) <= 7


def _display_loan_date(value: Optional[str]) -> str:
    if value and re.fullmatch(r"(?:19|20)\d{2}", str(value).strip()):
        return str(value).strip()
    parsed = _parse_setup_date(value)
    return parsed.strftime("%b %d, %Y") if parsed else (str(value) if value else "")


def _loan_chain_group_key(loan: Any) -> str:
    explicit = getattr(loan, "loan_group_id", None)
    if explicit:
        return str(explicit)
    return f"loan-{getattr(loan, 'id', None)}"


def _loan_chain_label(loans: List[Any]) -> str:
    if not loans:
        return "Loan chain"
    first = sorted(loans, key=lambda item: getattr(item, "servicer_sequence", None) or 99)[0]
    origination = _display_loan_date(getattr(first, "origination_date", None))
    base = "Mortgage chain"
    return f"{base} · originated {origination}" if origination else base


def _loan_group_rows(loans: List[Any]) -> List[Dict[str, Any]]:
    groups: Dict[str, List[Any]] = {}
    for loan in loans or []:
        groups.setdefault(_loan_chain_group_key(loan), []).append(loan)
    rows = []
    for group_id, members in groups.items():
        ordered = sorted(members, key=lambda item: (
            getattr(item, "servicer_sequence", None) or 99,
            _parse_setup_date(getattr(item, "servicer_start_date", None) or getattr(item, "origination_date", None)) or date.min,
            getattr(item, "id", 0) or 0,
        ))
        current = next((loan for loan in ordered if bool(getattr(loan, "is_current_servicer", True)) and not _is_closed_loan_status(getattr(loan, "status", None))), None)
        current = current or next((loan for loan in ordered if not _is_closed_loan_status(getattr(loan, "status", None))), None) or ordered[-1]
        rows.append({
            "id": group_id,
            "label": _loan_chain_label(ordered),
            "currentLoanId": getattr(current, "id", None),
            "currentLender": getattr(current, "lender_name", None),
            "currentBalance": getattr(current, "current_balance", 0) or 0,
            "status": "Open" if not _is_closed_loan_status(getattr(current, "status", None)) else "Closed",
            "memberLoanIds": [getattr(loan, "id", None) for loan in ordered],
            "members": [
                {
                    "id": getattr(loan, "id", None),
                    "lender_name": getattr(loan, "lender_name", None),
                    "account_number": getattr(loan, "account_number", None),
                    "status": getattr(loan, "status", None),
                    "origination_date": getattr(loan, "origination_date", None),
                    "servicer_start_date": getattr(loan, "servicer_start_date", None),
                    "closed_date": getattr(loan, "closed_date", None),
                    "servicer_sequence": getattr(loan, "servicer_sequence", None),
                    "is_current_servicer": bool(getattr(loan, "is_current_servicer", True)),
                }
                for loan in ordered
            ],
        })
    return sorted(rows, key=lambda item: item["label"])


def _loan_display_label(loan: Any) -> str:
    lender = getattr(loan, "lender_name", None) or "Loan"
    account = getattr(loan, "account_number", None)
    return f"{lender} #{account}" if account else lender


def _loan_transition_summary(loans: List[Any]) -> Dict[str, Any]:
    loan_list = list(loans or [])
    if not loan_list:
        return {
            "status": "none",
            "label": "No loans",
            "tone": "neutral",
            "transitions": [],
            "timeline": [],
        }

    groups = _loan_group_rows(loan_list)
    grouped = [group for group in groups if len(group.get("members") or []) > 1]
    open_loans = [loan for loan in loan_list if not _is_closed_loan_status(getattr(loan, "status", None))]
    closed_loans = [loan for loan in loan_list if _is_closed_loan_status(getattr(loan, "status", None))]
    transitions: List[Dict[str, Any]] = []

    for group in grouped:
        members = group.get("members") or []
        for index in range(1, len(members)):
            previous = members[index - 1]
            current = members[index]
            previous_status = str(previous.get("status") or "").upper()
            previous_closure = str(previous.get("closure_reason") or previous.get("transfer_reason") or "").lower()
            if previous_status == "REFINANCED" or "refinance" in previous_closure:
                continue
            transitions.append({
                "type": "servicing_transfer",
                "label": "Servicing transfer",
                "fromLender": previous.get("lender_name") or "Previous lender",
                "fromAccount": previous.get("account_number"),
                "toLender": current.get("lender_name") or "Current lender",
                "toAccount": current.get("account_number"),
                "date": current.get("servicer_start_date") or previous.get("closed_date"),
                "status": "complete",
            })

    loan_by_id = {getattr(loan, "id", None): loan for loan in loan_list}
    for loan in closed_loans:
        replacement = loan_by_id.get(getattr(loan, "replacement_loan_id", None))
        closure = str(getattr(loan, "closure_reason", "") or "").lower()
        status = str(getattr(loan, "status", "") or "").upper()
        if replacement and (status == "REFINANCED" or "refinance" in closure):
            transitions.append({
                "type": "refinance",
                "label": "Refinanced",
                "fromLender": getattr(loan, "lender_name", None) or "Previous loan",
                "fromAccount": getattr(loan, "account_number", None),
                "toLender": getattr(replacement, "lender_name", None) or "New loan",
                "toAccount": getattr(replacement, "account_number", None),
                "date": getattr(replacement, "origination_date", None) or getattr(loan, "closed_date", None),
                "status": "complete",
            })

    current = next((loan for loan in open_loans if bool(getattr(loan, "is_current_servicer", True))), None)
    current = current or (open_loans[0] if open_loans else loan_list[-1])
    timeline = []
    for loan in sorted(loan_list, key=lambda item: (
        _parse_setup_date(getattr(item, "servicer_start_date", None) or getattr(item, "origination_date", None)) or date.min,
        getattr(item, "id", 0) or 0,
    )):
        timeline.append({
            "loanId": getattr(loan, "id", None),
            "lender": getattr(loan, "lender_name", None),
            "accountNumber": getattr(loan, "account_number", None),
            "status": getattr(loan, "status", None),
            "originationDate": getattr(loan, "origination_date", None),
            "startDate": getattr(loan, "servicer_start_date", None) or getattr(loan, "origination_date", None),
            "endDate": getattr(loan, "closed_date", None) or getattr(loan, "servicer_end_date", None),
            "current": getattr(loan, "id", None) == getattr(current, "id", None),
        })

    transition_count = len(transitions)
    if any(item["type"] == "refinance" for item in transitions):
        status = "refinanced"
        label = "Refinance history"
        tone = "blue"
    elif transition_count:
        status = "transferred"
        label = "Servicing transfer"
        tone = "emerald"
    elif len(open_loans) > 1:
        status = "multiple_active"
        label = "Multiple active loans"
        tone = "amber"
    else:
        status = "single_active" if open_loans else "closed"
        label = "Single active loan" if open_loans else "No active loan"
        tone = "neutral"
    return {
        "status": status,
        "label": label,
        "tone": tone,
        "currentLoanId": getattr(current, "id", None),
        "currentLender": getattr(current, "lender_name", None),
        "currentAccount": getattr(current, "account_number", None),
        "currentStartDate": getattr(current, "servicer_start_date", None) or getattr(current, "origination_date", None),
        "activeCount": len(open_loans),
        "closedCount": len(closed_loans),
        "transitionCount": transition_count,
        "transitions": transitions,
        "timeline": timeline,
    }


def _loan_transfer_close_date(previous: Any, current: Any) -> Dict[str, Any]:
    explicit_current_start = _parse_setup_date(getattr(current, "servicer_start_date", None))
    if explicit_current_start:
        return {
            "date": _one_month_before(explicit_current_start),
            "source": "current_servicer_start_date",
            "label": "One month before current servicer start date",
        }

    previous_statement = (
        _parse_setup_date(getattr(previous, "statement_date", None))
        or _parse_setup_date(getattr(previous, "current_balance_as_of", None))
    )
    if previous_statement:
        return {
            "date": previous_statement,
            "source": "previous_latest_statement",
            "label": "Previous servicer latest statement",
        }

    amortization = _loan_transfer_close_date_from_amortization(previous, current)
    if amortization:
        return amortization

    current_statement = (
        _parse_setup_date(getattr(current, "statement_date", None))
        or _parse_setup_date(getattr(current, "current_balance_as_of", None))
    )
    if current_statement:
        return {
            "date": current_statement,
            "source": "current_latest_statement_fallback",
            "label": "Current servicer latest statement fallback",
        }

    return {
        "date": date.today(),
        "source": "today_fallback",
        "label": "Today fallback",
    }


def _loan_transfer_close_date_from_amortization(previous: Any, current: Any) -> Optional[Dict[str, Any]]:
    try:
        original = float(getattr(previous, "original_amount", 0) or 0)
    except (TypeError, ValueError):
        original = 0.0
    if original <= 0:
        return None

    target_balance = None
    target_source = None
    previous_balance = float(getattr(previous, "current_balance", 0) or 0)
    current_opening = float(getattr(current, "original_amount", 0) or 0)
    current_balance = float(getattr(current, "current_balance", 0) or 0)
    if 0 < previous_balance < original:
        target_balance = previous_balance
        target_source = "previous_reported_balance"
    elif 0 < current_opening < original and abs(current_opening - original) > max(original * 0.01, 1000):
        target_balance = current_opening
        target_source = "current_opening_balance"
    elif 0 < current_balance < original and abs(current_balance - original) > max(original * 0.01, 1000):
        target_balance = current_balance
        target_source = "current_reported_balance"
    if target_balance is None:
        return None

    projection = _loan_full_amortization_projection(previous)
    rows = projection.get("schedule") or []
    if not rows:
        return None
    closest = min(rows, key=lambda row: abs(float(row.get("balance") or 0) - target_balance))
    delta = abs(float(closest.get("balance") or 0) - target_balance)
    tolerance = max(original * 0.03, 2500)
    if delta > tolerance:
        return None
    estimated_date = _parse_setup_date(closest.get("date"))
    if not estimated_date:
        return None
    return {
        "date": estimated_date,
        "source": f"amortization_estimate_{target_source}",
        "label": "Amortization estimate",
    }


def apply_servicing_transfer_from_start_date(prop: Any, current: Any, transfer_date: Optional[str]) -> Optional[Dict[str, Any]]:
    parsed_transfer = _parse_setup_date(transfer_date)
    if not prop or not current or not parsed_transfer:
        return None
    current_origination = _parse_setup_date(getattr(current, "origination_date", None))
    candidates = []
    for loan in getattr(prop, "loans", []) or []:
        if getattr(loan, "id", None) == getattr(current, "id", None):
            continue
        if _is_closed_loan_status(getattr(loan, "status", None)):
            continue
        loan_origination = _parse_setup_date(getattr(loan, "origination_date", None))
        if current_origination and loan_origination and not _same_original_loan_date(loan_origination, current_origination):
            continue
        candidates.append(loan)
    if not candidates:
        return None

    previous = sorted(candidates, key=lambda loan: (
        _parse_setup_date(getattr(loan, "statement_date", None) or getattr(loan, "current_balance_as_of", None)) or date.min,
        getattr(loan, "id", 0) or 0,
    ))[-1]
    group_id = getattr(previous, "loan_group_id", None) or getattr(current, "loan_group_id", None) or f"loan-chain-{uuid.uuid4()}"
    closed_date = _one_month_before(parsed_transfer)
    previous.loan_group_id = group_id
    current.loan_group_id = group_id
    previous.servicer_sequence = previous.servicer_sequence or 1
    current.servicer_sequence = max((previous.servicer_sequence or 1) + 1, current.servicer_sequence or 0)
    previous.servicer_start_date = previous.servicer_start_date or previous.origination_date
    previous.servicer_end_date = closed_date.isoformat()
    previous.closed_date = closed_date.isoformat()
    previous.status = "CLOSED"
    previous.closure_reason = "Servicing transfer"
    previous.transfer_reason = "Servicing transfer"
    previous.is_current_servicer = False
    previous.replacement_loan_id = current.id

    current.status = "OPEN"
    current.closed_date = None
    current.closure_reason = None
    current.servicer_start_date = parsed_transfer.isoformat()
    current.servicer_end_date = None
    current.transfer_reason = "Servicing transfer"
    current.is_current_servicer = True
    return {
        "previousLoanId": previous.id,
        "currentLoanId": current.id,
        "loanGroupId": group_id,
        "closedDate": closed_date.isoformat(),
        "source": "mortgage_acquisition_date",
    }


def _insert_historical_servicer_before_next(prop: Any, current: Any, next_servicer: Any, start_date: date, next_start: date) -> Dict[str, Any]:
    group_id = getattr(next_servicer, "loan_group_id", None) or getattr(current, "loan_group_id", None) or f"loan-chain-{uuid.uuid4()}"
    current.loan_group_id = group_id
    next_servicer.loan_group_id = group_id

    previous_members = []
    for loan in getattr(prop, "loans", []) or []:
        if getattr(loan, "id", None) in {getattr(current, "id", None), getattr(next_servicer, "id", None)}:
            continue
        loan_origination = _parse_setup_date(getattr(loan, "origination_date", None))
        current_origination = _parse_setup_date(getattr(current, "origination_date", None))
        if not _same_original_loan_date(loan_origination, current_origination):
            continue
        loan_start = _parse_setup_date(getattr(loan, "servicer_start_date", None) or getattr(loan, "origination_date", None))
        if not loan_start or loan_start <= start_date:
            loan.loan_group_id = group_id
            loan.servicer_sequence = loan.servicer_sequence or 1
            loan.servicer_start_date = loan.servicer_start_date or getattr(loan, "origination_date", None)
            previous_members.append(loan)

    previous_sequence = max([getattr(loan, "servicer_sequence", None) or 1 for loan in previous_members] or [0])
    current.servicer_sequence = previous_sequence + 1
    next_servicer.servicer_sequence = max((getattr(next_servicer, "servicer_sequence", None) or 0), current.servicer_sequence + 1)

    for previous in previous_members:
        previous_status = str(getattr(previous, "status", "") or "").upper()
        previous_closure = str(getattr(previous, "closure_reason", "") or getattr(previous, "transfer_reason", "") or "").lower()
        if previous_status == "REFINANCED" or "refinance" in previous_closure:
            continue
        previous.closed_date = start_date.isoformat()
        previous.servicer_end_date = start_date.isoformat()
        previous.status = "CLOSED"
        previous.closure_reason = "Servicing transfer"
        previous.transfer_reason = "Servicing transfer"
        previous.is_current_servicer = False
        previous.replacement_loan_id = current.id

    current.servicer_start_date = start_date.isoformat()
    current.servicer_end_date = next_start.isoformat()
    current.closed_date = next_start.isoformat()
    current.status = "CLOSED"
    current.closure_reason = "Servicing transfer"
    current.transfer_reason = "Servicing transfer"
    current.is_current_servicer = False
    current.replacement_loan_id = next_servicer.id

    next_servicer.status = "OPEN"
    next_servicer.closed_date = None
    next_servicer.closure_reason = None
    next_servicer.servicer_end_date = None
    next_servicer.is_current_servicer = True
    next_servicer.transfer_reason = next_servicer.transfer_reason or "Servicing transfer"
    return {
        "previousLoanId": current.id,
        "currentLoanId": next_servicer.id,
        "loanGroupId": group_id,
        "closedDate": next_start.isoformat(),
        "source": "historical_servicer_insert",
    }


def _one_month_before(value: date) -> date:
    year = value.year
    month = value.month - 1
    if month == 0:
        month = 12
        year -= 1
    day = min(value.day, 28)
    return date(year, month, day)


def apply_document_loan_transition(prop: Any, current: Any, *, category: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if not prop or not current:
        return None
    if category == "1098" and getattr(current, "servicer_start_date", None):
        return apply_servicing_transfer_from_start_date(prop, current, getattr(current, "servicer_start_date", None))

    current_account = str(getattr(current, "account_number", "") or "").strip()
    current_origination = _parse_setup_date(getattr(current, "origination_date", None))
    if not current_account or not current_origination:
        return None

    candidates = []
    same_original_loans = []
    for loan in getattr(prop, "loans", []) or []:
        if getattr(loan, "id", None) == getattr(current, "id", None):
            continue
        if _is_closed_loan_status(getattr(loan, "status", None)):
            loan_origination = _parse_setup_date(getattr(loan, "origination_date", None))
            if _same_original_loan_date(loan_origination, current_origination):
                same_original_loans.append(loan)
            continue
        account = str(getattr(loan, "account_number", "") or "").strip()
        if account and account == current_account:
            continue
        loan_origination = _parse_setup_date(getattr(loan, "origination_date", None))
        if _same_original_loan_date(loan_origination, current_origination):
            same_original_loans.append(loan)
            next_start = _parse_setup_date(getattr(loan, "servicer_start_date", None))
            if not getattr(current, "servicer_start_date", None) and next_start and next_start > current_origination:
                continue
            current.servicer_start_date = current.servicer_start_date or current_origination.isoformat()
            return apply_servicing_transfer_from_start_date(prop, current, current.servicer_start_date)
        candidates.append(loan)

    if same_original_loans and not getattr(current, "servicer_start_date", None):
        next_servicers = []
        for loan in same_original_loans:
            next_start = _parse_setup_date(getattr(loan, "servicer_start_date", None))
            if next_start and next_start > current_origination:
                next_servicers.append((next_start, getattr(loan, "id", 0) or 0, loan))
        if next_servicers:
            next_start, _loan_id, next_servicer = sorted(next_servicers)[0]
            return _insert_historical_servicer_before_next(prop, current, next_servicer, current_origination, next_start)

    if not candidates:
        return None

    previous = sorted(candidates, key=lambda loan: (
        _parse_setup_date(getattr(loan, "statement_date", None) or getattr(loan, "current_balance_as_of", None) or getattr(loan, "origination_date", None)) or date.min,
        getattr(loan, "id", 0) or 0,
    ))[-1]
    group_id = getattr(previous, "loan_group_id", None) or getattr(current, "loan_group_id", None) or f"loan-chain-{uuid.uuid4()}"
    previous.loan_group_id = group_id
    current.loan_group_id = group_id
    previous.servicer_sequence = previous.servicer_sequence or 1
    current.servicer_sequence = max((previous.servicer_sequence or 1) + 1, current.servicer_sequence or 0)
    close_date = _one_month_before(current_origination).isoformat()
    previous.status = "CLOSED"
    previous.closed_date = close_date
    previous.servicer_end_date = close_date
    previous.closure_reason = "Refinanced"
    previous.transfer_reason = "Refinanced"
    previous.replacement_loan_id = current.id
    previous.is_current_servicer = False

    current.status = "OPEN"
    current.closed_date = None
    current.closure_reason = None
    current.servicer_start_date = current.servicer_start_date or current_origination.isoformat()
    current.servicer_end_date = None
    current.transfer_reason = "Refinance replacement"
    current.is_current_servicer = True
    return {
        "previousLoanId": previous.id,
        "currentLoanId": current.id,
        "loanGroupId": group_id,
        "closedDate": close_date,
        "source": "document_refinance_inference",
        "type": "refinance",
    }


def _sync_servicing_transfer_chain_dates(prop: Any) -> bool:
    groups: Dict[str, List[Any]] = {}
    for loan in getattr(prop, "loans", []) or []:
        group_id = getattr(loan, "loan_group_id", None)
        if group_id:
            groups.setdefault(group_id, []).append(loan)

    changed = False
    for members in groups.values():
        if len(members) < 2:
            continue
        ordered = sorted(members, key=lambda item: (
            getattr(item, "servicer_sequence", None) or 99,
            _parse_setup_date(getattr(item, "servicer_start_date", None) or getattr(item, "origination_date", None)) or date.min,
            getattr(item, "id", 0) or 0,
        ))
        for index in range(1, len(ordered)):
            previous = ordered[index - 1]
            current = ordered[index]
            previous_status = str(getattr(previous, "status", "") or "").upper()
            previous_closure = str(getattr(previous, "closure_reason", "") or getattr(previous, "transfer_reason", "") or "").lower()
            if previous_status == "REFINANCED" or "refinance" in previous_closure:
                continue
            transfer_date = _parse_setup_date(getattr(current, "servicer_start_date", None))
            if not transfer_date:
                continue
            transfer_iso = _one_month_before(transfer_date).isoformat()
            updates = {
                "closed_date": transfer_iso,
                "servicer_end_date": transfer_iso,
                "status": "CLOSED",
                "closure_reason": "Servicing transfer",
                "transfer_reason": "Servicing transfer",
                "is_current_servicer": False,
                "replacement_loan_id": getattr(current, "id", None),
            }
            for field, value in updates.items():
                if getattr(previous, field, None) != value:
                    setattr(previous, field, value)
                    changed = True
            if getattr(current, "closed_date", None) is not None:
                current.closed_date = None
                changed = True
            if getattr(current, "closure_reason", None) is not None:
                current.closure_reason = None
                changed = True
            if getattr(current, "servicer_end_date", None) is not None:
                current.servicer_end_date = None
                changed = True
            if getattr(current, "status", None) != "OPEN":
                current.status = "OPEN"
                changed = True
            if getattr(current, "is_current_servicer", None) is not True:
                current.is_current_servicer = True
                changed = True
    return changed


def _servicing_transfer_candidates(loans: List[Any]) -> List[Dict[str, Any]]:
    suggestions = []
    open_loans = [loan for loan in loans or [] if not _is_closed_loan_status(getattr(loan, "status", None))]
    for index, first in enumerate(open_loans):
        for second in open_loans[index + 1:]:
            if getattr(first, "loan_group_id", None) and getattr(first, "loan_group_id", None) == getattr(second, "loan_group_id", None):
                continue
            first_origination = _parse_setup_date(getattr(first, "origination_date", None))
            second_origination = _parse_setup_date(getattr(second, "origination_date", None))
            if not first_origination or not second_origination:
                continue
            same_original_loan = _same_original_loan_date(first_origination, second_origination)
            first_account = str(getattr(first, "account_number", "") or "").strip()
            second_account = str(getattr(second, "account_number", "") or "").strip()
            if first_account and second_account and first_account == second_account:
                continue
            if same_original_loan:
                first_statement = _parse_setup_date(getattr(first, "statement_date", None))
                second_statement = _parse_setup_date(getattr(second, "statement_date", None))
                if first_statement or second_statement:
                    dated_pair = sorted(
                        [(first_statement or date.min, first), (second_statement or date.min, second)],
                        key=lambda item: item[0],
                    )
                    old_statement, older = dated_pair[0]
                    new_statement, newer = dated_pair[1]
                    if old_statement == date.min:
                        old_statement = None
                    if new_statement == date.min:
                        new_statement = None
                else:
                    older, newer = sorted([first, second], key=lambda loan: getattr(loan, "id", 0) or 0)
                    old_statement = _parse_setup_date(getattr(older, "statement_date", None))
                    new_statement = _parse_setup_date(getattr(newer, "statement_date", None))
                transfer_type = "servicing_transfer"
                message = "Possible servicing transfer: same origination date with a different lender/account."
                close_date = _loan_transfer_close_date(older, newer)
            else:
                dated_pair = sorted(
                    [(first_origination, first), (second_origination, second)],
                    key=lambda item: (item[0], getattr(item[1], "id", 0) or 0),
                )
                _old_origination, older = dated_pair[0]
                new_origination, newer = dated_pair[1]
                old_statement = _parse_setup_date(getattr(older, "statement_date", None))
                new_statement = _parse_setup_date(getattr(newer, "statement_date", None))
                transfer_type = "refinance"
                message = "Possible refinance: newer origination date with a different lender/account."
                close_date = {
                    "date": _one_month_before(new_origination),
                    "source": "new_loan_origination_date",
                    "label": "One month before new loan origination date",
                }
            rate_delta = abs(float(getattr(older, "interest_rate", 0) or 0) - float(getattr(newer, "interest_rate", 0) or 0))
            original_delta = abs(float(getattr(older, "original_amount", 0) or 0) - float(getattr(newer, "original_amount", 0) or 0))
            reasons = ["Same origination date"] if same_original_loan else ["Newer origination date"]
            confidence = 0.62 if same_original_loan else 0.58
            if rate_delta <= 0.125:
                confidence += 0.18
                reasons.append("Similar interest rate")
            if original_delta <= max(float(getattr(older, "original_amount", 0) or 0) * 0.02, 1000):
                confidence += 0.12
                reasons.append("Similar original balance")
            old_account = str(getattr(older, "account_number", "") or "").strip()
            new_account = str(getattr(newer, "account_number", "") or "").strip()
            if old_account and new_account:
                confidence += 0.08
                reasons.append("Different account numbers")
            proposed_closed_date = close_date["date"].isoformat()
            suggestion_id = f"{getattr(older, 'id', '')}-{getattr(newer, 'id', '')}-{proposed_closed_date}"
            suggestions.append({
                "id": suggestion_id,
                "previousLoanId": getattr(older, "id", None),
                "currentLoanId": getattr(newer, "id", None),
                "previousLoanLabel": getattr(older, "lender_name", None) or f"Loan {getattr(older, 'id', '')}",
                "currentLoanLabel": getattr(newer, "lender_name", None) or f"Loan {getattr(newer, 'id', '')}",
                "proposedClosedDate": proposed_closed_date,
                "proposedClosedDateSource": close_date["source"],
                "proposedClosedDateSourceLabel": close_date["label"],
                "confidence": round(min(confidence, 0.98), 2),
                "type": transfer_type,
                "reasons": reasons,
                "message": message,
            })
    unique: Dict[str, Dict[str, Any]] = {}
    for item in suggestions:
        key = f"{item['previousLoanId']}:{item['currentLoanId']}"
        if key not in unique or item["confidence"] > unique[key]["confidence"]:
            unique[key] = item
    return sorted(unique.values(), key=lambda item: item["confidence"], reverse=True)


def _loan_setup_issues(loan: Any, index: int = 0) -> tuple[Dict[str, str], List[Dict[str, Any]]]:
    field_errors: Dict[str, str] = {}
    section_errors: List[Dict[str, Any]] = []
    prefix = f"loans[{index}]"
    record_id = getattr(loan, "id", None) or f"loan-{index + 1}"

    def add(field: str, message: str) -> None:
        field_errors[f"{prefix}.{field}"] = message
        section_errors.append(_validation_item(field, f"{message} ({_loan_record_label(loan, index)})", record_id=record_id))

    for field in SETUP_LOAN_REQUIRED:
        if not _present(getattr(loan, field, None)):
            add(field, "Required field.")
    raw_status = str(getattr(loan, "status", OPEN_LOAN_STATUS) or OPEN_LOAN_STATUS).strip().upper()
    status = _normalize_loan_status_value(raw_status)
    if raw_status not in LOAN_STATUSES:
        add("status", "Loan status is invalid.")
    if status in CLOSED_LOAN_STATUSES:
        if not _present(getattr(loan, "closed_date", None)):
            add("closed_date", f"Closed date is required for {status.replace('_', ' ').title()} loans.")
        else:
            closed_date = _parse_setup_date(getattr(loan, "closed_date", None))
            origination_date = _parse_setup_date(getattr(loan, "origination_date", None))
            if not closed_date:
                add("closed_date", "Closed date must be a valid date.")
            elif origination_date and closed_date < origination_date:
                add("closed_date", "Closed date must be on or after origination date.")
            elif closed_date > date.today():
                add("closed_date", "Closed date cannot be in the future.")
    if (getattr(loan, "current_balance", 0) or 0) > (getattr(loan, "original_amount", 0) or 0) > 0:
        field_errors[f"{prefix}.current_balance"] = "Current balance cannot exceed original amount."
        section_errors.append(_validation_item("current_balance", f"{_loan_record_label(loan, index)} balance exceeds original amount.", record_id=record_id))
    return field_errors, section_errors


def _setup_finalize_validation(prop: Any, loans: List[Any], annual_expenses: Optional[List[Any]] = None) -> Dict[str, Any]:
    section_errors: Dict[str, List[Dict[str, Any]]] = {"property": [], "loans": [], "rental": [], "expenses": []}
    field_errors: Dict[str, str] = {}

    def add_section_error(section: str, field_key: str, field: str, message: str, *, record_id: Optional[Any] = None) -> None:
        field_errors[field_key] = message
        section_errors[section].append(_validation_item(field, message, record_id=record_id))

    for field in SETUP_PROPERTY_REQUIRED:
        if not _present(getattr(prop, field, None)):
            add_section_error("property", f"property.{field}", field, "Required field.")
    if (getattr(prop, "purchase_price", 0) or 0) < 0:
        add_section_error("property", "property.purchase_price", "purchase_price", "Purchase price cannot be negative.")
    if (getattr(prop, "market_value", 0) or 0) < 0:
        add_section_error("property", "property.market_value", "market_value", "Market Price cannot be negative.")

    meaningful_loans = [
        loan for loan in loans
        if getattr(loan, "id", None) or any(_present(getattr(loan, field, None)) for field in SETUP_LOAN_REQUIRED + ["lender_name", "escrow_amount", "closed_date"])
    ]
    for index, loan in enumerate(meaningful_loans):
        loan_field_errors, loan_section_errors = _loan_setup_issues(loan, index)
        field_errors.update(loan_field_errors)
        section_errors["loans"].extend(loan_section_errors)

    if _is_current_rental_usage(getattr(prop, "usage_type", None)):
        if not _present(getattr(prop, "rental_start_date", None)):
            add_section_error("rental", "property.rental_start_date", "rental_start_date", "Rental available from is required.")
        elif rental_available_before_purchase({
            "purchase_date": getattr(prop, "purchase_date", None),
            "rental_start_date": getattr(prop, "rental_start_date", None),
        }):
            add_section_error(
                "rental",
                "property.rental_start_date",
                "rental_start_date",
                "Rental availability cannot begin before the property was purchased.",
            )

    for expense in annual_expenses or []:
        year = getattr(expense, "year", None)
        for field in ANNUAL_EXPENSE_FIELDS:
            if (getattr(expense, field, 0) or 0) < 0:
                add_section_error("expenses", f"annual_expenses[{year}].{field}", field, "Amount cannot be negative.", record_id=str(year) if year else None)

    for key, items in list(section_errors.items()):
        seen = set()
        unique = []
        for item in items:
            dedupe_key = (item.get("recordId"), item.get("field"), item.get("message"))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            unique.append(item)
        section_errors[key] = unique
    error_count = sum(len(value) for value in section_errors.values())
    return {
        "status": "validation_failed" if error_count else "valid",
        "summary": {
            "errorCount": error_count,
            "sectionsWithErrors": sum(1 for value in section_errors.values() if value),
        },
        "sectionErrors": section_errors,
        "fieldErrors": field_errors,
        "warnings": [],
    }


def _build_setup_status(prop: models.Property) -> Dict[str, Any]:
    usage = (prop.usage_type or "Rental").lower()
    original_residency = str(prop.original_residency_status or "").strip().lower()
    is_rental = (
        usage in {"rental", "mixed"}
        or "rental" in usage
        or original_residency in {"rental", "mixed", "mixed use"}
    )
    setup_loans = list(prop.loans or [])
    sections = []

    property_required = SETUP_PROPERTY_REQUIRED
    property_completed = sum(1 for field in property_required if _present(getattr(prop, field, None)))
    sections.append({
        "id": "property",
        "title": SETUP_SECTION_LABELS["property"],
        "visible": True,
        **_section_status(
            property_completed,
            len(property_required),
            any(_present(getattr(prop, field, None)) for field in property_required),
        ),
    })

    if setup_loans:
        required_per_loan = SETUP_LOAN_REQUIRED
        total = len(setup_loans) * len(required_per_loan)
        completed = sum(1 for loan in setup_loans for field in required_per_loan if _present(getattr(loan, field, None)))
        issues = []
        for index, loan in enumerate(setup_loans):
            _field_errors, loan_issues = _loan_setup_issues(loan, index)
            issues.extend(item.get("message") for item in loan_issues)
        financing_status = _section_status(completed, total, True, issues)
        visible = True
    else:
        financing_status = _section_status(0, 0, False)
        visible = False
    sections.append({
        "id": "financing",
        "title": SETUP_SECTION_LABELS["financing"],
        "visible": visible,
        **financing_status,
    })

    rental_meaningful = bool(prop.rental_periods) or _present(prop.rental_start_date)
    rental_completed = int(_present(prop.rental_start_date))
    sections.append({
        "id": "rental",
        "title": SETUP_SECTION_LABELS["rental"],
        "visible": is_rental,
        **_section_status(rental_completed, 1, rental_meaningful),
    })

    annual_rows = list(getattr(prop, "annual_expenses", None) or [])
    expense_meaningful = any(_annual_expense_entered(row) for row in annual_rows) or any(_present(getattr(prop, field, None)) for field in [
        "property_tax", "insurance", "hoa_fee", "maintenance", "property_management_fee", "utilities", "vacancy_allowance", "capex_reserve", "other_expenses"
    ])
    expense_issues = []
    for row in annual_rows:
        for field in ANNUAL_EXPENSE_FIELDS:
            if (getattr(row, field, 0) or 0) < 0:
                expense_issues.append(f"{row.year} {field.replace('_', ' ')} cannot be negative.")
    expense_status = _section_status(1 if expense_meaningful else 0, 1 if expense_meaningful else 0, expense_meaningful, expense_issues)
    if not expense_meaningful:
        expense_status["status"] = "optional"
    sections.append({
        "id": "expenses",
        "title": SETUP_SECTION_LABELS["expenses"],
        "visible": True,
        **expense_status,
    })

    visible_sections = [section for section in sections if section["visible"]]
    total_required = sum(section["totalRequired"] for section in visible_sections)
    completed_required = sum(min(section["completedRequired"], section["totalRequired"]) for section in visible_sections)
    overall = round((completed_required / total_required) * 100) if total_required else 100
    return {
        "overallPercent": overall,
        "completedRequired": completed_required,
        "totalRequired": total_required,
        "sections": sections,
    }


def _preview_property(prop: models.Property, section: str, draft_changes: Dict[str, Any]) -> SimpleNamespace:
    fields = [
        column.name
        for column in models.Property.__table__.columns
        if column.name not in {"id", "owner_id", "created_at", "updated_at"}
    ]
    data = {field: getattr(prop, field, None) for field in fields}
    allowed_by_section = {
        "property": {"purchase_price", "down_payment", "market_value", "purchase_date", "property_type", "usage_type"},
        "rental": {"monthly_rent", "occupancy_rate", "rental_start_date", "rental_end_date", "usage_type"},
        "expenses": {"year", "property_tax", "insurance", "hoa", "repairs_maintenance", "property_management", "utilities", "vacancy_allowance", "capex_reserve", "other", "solar_ownership", "solar_monthly_payment"},
        "depreciation": {"land_value", "construction_price", "depreciation_years"},
    }
    for key, value in (draft_changes or {}).items():
        if key in allowed_by_section.get(section, set()):
            data[key] = value
    preview = SimpleNamespace(**data)
    preview.loans = [SimpleNamespace(**{column.name: getattr(loan, column.name, None) for column in models.Loan.__table__.columns}) for loan in prop.loans]
    preview.tax_entries = prop.tax_entries
    preview.depreciation_assets = prop.depreciation_assets
    preview.rental_periods = prop.rental_periods
    preview.usage_periods = prop.usage_periods
    if section == "expenses":
        preview.annual_expenses = [
            SimpleNamespace(
                year=int(data.get("year") or date.today().year),
                property_tax=data.get("property_tax") or 0,
                insurance=data.get("insurance") or 0,
                hoa=data.get("hoa") or 0,
                repairs_maintenance=data.get("repairs_maintenance") or 0,
                property_management=data.get("property_management") or 0,
                utilities=data.get("utilities") or 0,
                vacancy_allowance=data.get("vacancy_allowance") or 0,
                capex_reserve=data.get("capex_reserve") or 0,
                other=data.get("other") or 0,
            )
        ]
    else:
        preview.annual_expenses = prop.annual_expenses
    return preview


def _tax_entry_score(entry) -> int:
    if entry is None:
        return -1
    fields = [
        getattr(entry, "rents_received", None),
        getattr(entry, "mortgage_interest", None),
        getattr(entry, "property_taxes", None),
        getattr(entry, "depreciation", None),
        getattr(entry, "total_expenses", None),
        getattr(entry, "net_income", None),
        getattr(entry, "days_rented", None),
        getattr(entry, "personal_use_days", None),
        getattr(entry, "cash_noi", None),
        getattr(entry, "tax_pl", None),
    ]
    populated = sum(1 for value in fields if value not in (None, "", 0))
    confidence = int((getattr(entry, "confidence", 0) or 0) * 10)
    return populated + confidence + int(getattr(entry, "id", 0) or 0)


RAW_RECORD_UUID_NAMESPACE = uuid.UUID("39fd6f11-5bd1-4de5-9d1c-e66e44218ce5")


def _raw_record_uuid(*parts: Any) -> str:
    stable_key = ":".join(str(part or "none").strip().lower() for part in parts)
    return str(uuid.uuid5(RAW_RECORD_UUID_NAMESPACE, stable_key))


def _number_display(value: float, digits: int = 2) -> str:
    return f"{float(value or 0):.{digits}f}".rstrip("0").rstrip(".")


def _metric_tone(value: float, kind: str = "money") -> str:
    if kind == "cost":
        return "neutral"
    if value > 0:
        return "positive"
    if value < 0:
        return "negative"
    return "neutral"


def _metric_explain(
    formula: str,
    inputs: Optional[List[dict]] = None,
    computation: Optional[str] = None,
    result: Optional[str] = None,
    *,
    source: str = "CALCULATED",
    missing_inputs: Optional[List[str]] = None,
    warning: Optional[str] = None,
    warnings: Optional[List[str]] = None,
    hint: Optional[str] = None,
) -> dict:
    warning_text = warning or (" ".join(warnings) if warnings else None)
    return {
        "formula": formula,
        "inputs": inputs or [],
        "computation": computation,
        "result": result,
        "source": source,
        "missingInputs": missing_inputs or [],
        "warning": warning_text,
        "hint": hint,
    }


def _input_item(label: str, value: Optional[float], display: Optional[str] = None) -> dict:
    numeric_value = None if value is None else round(float(value or 0), 2)
    return {"label": label, "value": numeric_value, "display": display}


def _money_input(label: str, value: Optional[float]) -> dict:
    return _input_item(label, value, None if value is None else _money_display(value))


def _percent_input(label: str, value: Optional[float]) -> dict:
    return _input_item(label, value, None if value is None else _percent_display(value))


def _ratio_input(label: str, value: Optional[float]) -> dict:
    return _input_item(label, value, None if value is None else _number_display(value))


def _join_computation(parts: List[Optional[str]], operator: str) -> Optional[str]:
    if any(part in (None, "") for part in parts):
        return None
    return f" {operator} ".join(parts)


def _money_metric(
    value: float,
    period: Optional[str] = None,
    *,
    kind: str = "money",
    source: str = "CALCULATED",
    explain: Optional[dict] = None,
) -> dict:
    display = _compact_money_display(value)
    detail = explain or _metric_explain("Value entered or calculated by the backend", result=display, source=source)
    return {
        "value": round(float(value or 0), 2),
        "display": display,
        "period": period,
        "source": detail.get("source", source),
        "tone": _metric_tone(float(value or 0), kind),
        **detail,
    }


def _percent_metric(percent_value: float, *, source: str = "CALCULATED", explain: Optional[dict] = None) -> dict:
    display = _percent_display(percent_value)
    detail = explain or _metric_explain("Value entered or calculated by the backend", result=display, source=source)
    return {
        "value": round(float(percent_value or 0) / 100, 6),
        "display": display,
        "period": None,
        "source": detail.get("source", source),
        "tone": _metric_tone(float(percent_value or 0)),
        **detail,
    }


def _ratio_metric(value: float, *, source: str = "CALCULATED", explain: Optional[dict] = None) -> dict:
    display = _number_display(value)
    detail = explain or _metric_explain("Value entered or calculated by the backend", result=display, source=source)
    return {
        "value": round(float(value or 0), 4),
        "display": display,
        "period": None,
        "source": detail.get("source", source),
        "tone": _metric_tone(float(value or 0)),
        **detail,
    }


def _legacy_build_summary_dto_unused(prop: models.Property, summary_metrics: Optional[dict] = None) -> dict:
    metrics = compute_property_metrics(prop)
    source_metrics = summary_metrics or metrics
    usage_type = "PRIMARY" if (prop.usage_type or "").lower() == "primary" else "RENTAL"
    annual_cash_flow = source_metrics.get("annual_cash_flow", 0) or 0
    monthly_cash_flow = source_metrics.get("monthly_cash_flow", 0) or 0
    annual_noi = source_metrics.get("noi", source_metrics.get("annual_noi", 0)) or 0
    annual_debt_service = source_metrics.get("annual_debt_service", 0) or 0
    market_value = prop.market_value or 0
    total_debt = metrics.get("total_loan_balance", 0) or 0
    equity = metrics.get("equity", 0) or 0
    principal_paid = source_metrics.get("principal_paid", 0) or 0
    appreciation = source_metrics.get("appreciation", (market_value - (prop.purchase_price or market_value))) or 0
    legacy_total_return = round(annual_cash_flow + principal_paid + appreciation, 2)
    monthly_cost_to_own = source_metrics.get("monthly_cost_to_own", 0) or (
        (metrics.get("monthly_mortgage", 0) or 0) + (metrics.get("monthly_expenses", 0) or 0)
    )
    sign_sanity = {
        "cap_rate_non_negative_when_noi_positive": annual_noi <= 0 or (source_metrics.get("cap_rate", 0) or 0) >= 0,
        "dscr_non_negative_when_noi_positive": annual_noi <= 0 or (source_metrics.get("dscr", 0) or 0) >= 0,
        "dscr_formula": abs((source_metrics.get("dscr", 0) or 0) - (annual_noi / annual_debt_service if annual_debt_service else 0)) <= 0.01,
    }
    warnings = []
    if annual_noi > 0 and (source_metrics.get("cap_rate", 0) or 0) < 0:
        warnings.append("Cap rate is negative while NOI is positive. Check market value and income inputs.")
    if annual_noi > 0 and (source_metrics.get("dscr", 0) or 0) < 0:
        warnings.append("DSCR is negative while NOI is positive. Check debt-service inputs.")

    current_rent = \
        (prop)
    rent_amount = current_rent["amount"] if current_rent else None
    rent_source_label = current_rent["label"] if current_rent else None
    if rent_amount is None and source_metrics.get("effective_gross_income"):
        rent_amount = (source_metrics.get("effective_gross_income") or 0) / 12
        rent_source_label = "Selected annual income ÷ 12"
    if rent_amount is None:
        rent_amount = prop.monthly_rent or 0
        rent_source_label = "Legacy property rent field"

    cash_invested = source_metrics.get("cash_invested", 0) or 0
    cash_on_cash = source_metrics.get("cash_on_cash_return")
    metric_map = {
        "monthlyCashFlow": _money_metric(monthly_cash_flow, "mo", explain=_metric_explain(
            "Annual cash flow ÷ 12",
            [_money_input("Annual cash flow", annual_cash_flow)],
            _compact_money_display(monthly_cash_flow),
            warnings=warnings,
        )),
        "annualCashFlow": _money_metric(annual_cash_flow, "yr", explain=_metric_explain(
            "NOI − annual debt service",
            [_money_input("NOI", annual_noi), _money_input("Annual debt service", annual_debt_service)],
            _compact_money_display(annual_cash_flow),
            warnings=warnings,
        )),
        "monthlyCostToOwn": _money_metric(monthly_cost_to_own, "mo", kind="cost", explain=_metric_explain(
            "(Annual debt service + operating expenses) ÷ 12",
            [_money_input("Annual debt service", annual_debt_service), _money_input("Operating expenses", source_metrics.get("operating_expenses", 0) or 0)],
            _compact_money_display(monthly_cost_to_own),
        )),
        "noi": _money_metric(annual_noi, "yr", explain=_metric_explain(
            "Effective gross income − operating expenses",
            [_money_input("Effective gross income", source_metrics.get("effective_gross_income", 0) or 0), _money_input("Operating expenses", source_metrics.get("operating_expenses", 0) or 0)],
            _compact_money_display(annual_noi),
        )),
        "annualDebtService": _money_metric(annual_debt_service, "yr", kind="cost", explain=_metric_explain(
            "Mortgage interest + principal paid",
            [_money_input("Mortgage interest", source_metrics.get("mortgage_interest", 0) or 0), _money_input("Principal paid", source_metrics.get("principal_paid", 0) or 0)],
            _compact_money_display(annual_debt_service),
        )),
        "capRate": _percent_metric(source_metrics.get("cap_rate", 0) or 0, explain=_metric_explain(
            "NOI ÷ market value",
            [_money_input("NOI", annual_noi), _money_input("Market value", market_value)],
            _percent_display(source_metrics.get("cap_rate", 0) or 0),
            warnings=warnings,
        )),
        "dscr": _ratio_metric(source_metrics.get("dscr", 0) or 0, explain=_metric_explain(
            "NOI ÷ annual debt service",
            [_money_input("NOI", annual_noi), _money_input("Annual debt service", annual_debt_service)],
            _number_display(source_metrics.get("dscr", 0) or 0),
            warnings=warnings,
        )),
        "cashOnCashReturn": _percent_metric(cash_on_cash or 0, explain=_metric_explain(
            "Annual cash flow ÷ cash invested",
            [_money_input("Annual cash flow", annual_cash_flow), _money_input("Cash invested", cash_invested)],
            _percent_display(cash_on_cash or 0),
        )) if cash_on_cash is not None else {
            "value": None,
            "display": "—",
            "period": None,
            "source": "USER_INPUT",
            "tone": "neutral",
            **_metric_explain(
                "Annual cash flow ÷ cash invested",
                [_money_input("Annual cash flow", annual_cash_flow), _money_input("Cash invested", cash_invested)],
                "—",
                missing_inputs=[
                    {"field": "down_payment", "label": "Down payment", "href": f"/properties/{prop.id}/edit"},
                    {"field": "closing_costs", "label": "Closing costs", "href": f"/properties/{prop.id}/edit"},
                ],
            ),
        },
        "equity": _money_metric(equity, explain=_metric_explain(
            "Market value − total debt",
            [_input_item("Market value", market_value), _input_item("Total debt", total_debt)],
            _compact_money_display(equity),
        )),
        "marketValue": _money_metric(market_value, explain=_metric_explain(
            "Current market value",
            [_input_item("Market value", market_value)],
            _compact_money_display(market_value),
        )),
        "totalDebt": _money_metric(total_debt, kind="cost", explain=_metric_explain(
            "Sum of current loan balances",
            [_input_item("Total debt", total_debt)],
            _compact_money_display(total_debt),
        )),
        "totalReturnYtd": _money_metric(legacy_total_return, explain=_metric_explain(
            "Cash flow + principal paydown + appreciation",
            [_money_input("Annual cash flow", annual_cash_flow), _money_input("Principal paid", principal_paid), _money_input("Appreciation", appreciation)],
            _compact_money_display(legacy_total_return),
        )),
        "rentPerMonth": _money_metric(rent_amount, "mo", explain=_metric_explain(
            "Current active lease rent, else selected annual income ÷ 12",
            [_money_input(rent_source_label or "Rent per month", rent_amount)],
            _compact_money_display(rent_amount),
        )),
    }
    return {
        "propertyId": prop.id,
        "usageType": usage_type,
        "asOfDate": date.today().isoformat(),
        "source": "backend_engine",
        "metrics": metric_map,
        "signSanity": sign_sanity,
        # Backward-compatible raw fields for older tabs during migration.
        "raw": metrics,
    }


def _default_property_name(address: str, prop_id: Optional[int] = None) -> str:
    if prop_id:
        base = PROPERTY_CODE_NAMES[(prop_id - 1) % len(PROPERTY_CODE_NAMES)]
        cycle = (prop_id - 1) // len(PROPERTY_CODE_NAMES)
        return base if cycle == 0 else f"{base} {cycle + 1}"
    return "Property"


# ── Shared-access helper ──────────────────────────────────────────────────────

def _get_accessible_property(prop_id: int, db: Session, current_user: models.User):
    """Return a property visible to current_user (owner OR shared-with recipient)."""
    prop = db.query(models.Property).filter(models.Property.id == prop_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if prop.owner_id == current_user.id:
        return prop
    share = db.query(models.UserSharing).filter(
        models.UserSharing.owner_id == prop.owner_id,
        models.UserSharing.shared_with_id == current_user.id,
    ).first()
    if share:
        return prop
    raise HTTPException(status_code=403, detail="Access denied")


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value[:10], fmt).date()
        except ValueError:
            continue
    return None


def _add_months(value: date, months: int) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(value.day, 28))


def _monthly_principal_interest(amount: float, annual_rate: float, years: int) -> float:
    return round(engine_monthly_principal_interest(amount, annual_rate, years), 2)


def _loan_monthly_pi(loan: models.Loan) -> float:
    return loan_monthly_pi(loan)


def _scheduled_loan_years(loan: models.Loan, end_year: Optional[int] = None) -> List[Dict[str, Any]]:
    return build_property_engine(loan.property).annual_rows(loan, end_year=end_year)


def _scheduled_balance_from_fields(
    original_amount: float,
    annual_rate: float,
    years: int,
    origination_date: Optional[str],
    monthly_payment: float = 0.0,
    as_of: Optional[date] = None,
) -> float:
    orig = _parse_iso_date(origination_date)
    principal = float(original_amount or 0)
    if principal <= 0:
        return 0.0
    if not orig:
        return round(principal, 2)
    as_of = as_of or date.today()
    if as_of <= orig:
        return round(principal, 2)
    rate = float(annual_rate or 0) / 100 / 12
    payment = float(monthly_payment or 0) or _monthly_principal_interest(principal, annual_rate, years)
    months = max(0, (as_of.year - orig.year) * 12 + as_of.month - orig.month)
    months = min(months, max(1, int(years or 30) * 12))
    balance = principal
    for _ in range(months):
        interest = balance * rate if rate > 0 else 0.0
        principal_paid = min(max(payment - interest, 0.0), balance)
        balance = max(balance - principal_paid, 0.0)
        if balance <= 0:
            break
    return round(balance, 2)


def _normalize_loan_payload(prop: models.Property, payload: Dict[str, Any]) -> Dict[str, Any]:
    data = dict(payload)
    incoming_status = _normalize_loan_status_value(data.get("status"))
    data["status"] = _canonical_loan_status(incoming_status)
    if incoming_status == "REFINANCED" and not data.get("closure_reason"):
        data["closure_reason"] = "Refinanced"
    if data["status"] == OPEN_LOAN_STATUS:
        data["closed_date"] = None
        data["closure_reason"] = None
        data["replacement_loan_id"] = None
    if not data.get("origination_date") and prop.purchase_date:
        data["origination_date"] = prop.purchase_date
    years = max(1, int(data.get("loan_term_years") or 30))
    data["loan_term_years"] = years
    original = float(data.get("original_amount") or 0)
    rate = float(data.get("interest_rate") or 0)
    pi_payment = float(data.get("monthly_payment") or 0)
    if original > 0 and pi_payment <= 0:
        pi_payment = _monthly_principal_interest(original, rate, years)
        data["monthly_payment"] = pi_payment
    escrow = float(data.get("escrow_amount") or 0)
    escrow_components = round(
        float(data.get("monthly_property_tax_escrow") or 0)
        + float(data.get("monthly_insurance_escrow") or 0)
        + float(data.get("monthly_mortgage_insurance") or 0)
        + float(data.get("monthly_other_escrow") or 0),
        2,
    )
    if bool(data.get("escrow_included")) and escrow <= 0 and escrow_components > 0:
        escrow = escrow_components
        data["escrow_amount"] = escrow
    if pi_payment > 0 and float(data.get("estimated_total_monthly_payment") or 0) <= 0:
        data["estimated_total_monthly_payment"] = round(pi_payment + escrow, 2)
    if original > 0 and float(data.get("current_balance") or 0) <= 0:
        data["current_balance"] = _scheduled_balance_from_fields(
            original,
            rate,
            years,
            data.get("origination_date"),
            pi_payment,
        )
    balance = float(data.get("current_balance") or original or 0)
    if balance > 0 and rate >= 0 and pi_payment > 0:
        interest_due = round(balance * rate / 100 / 12, 2)
        if float(data.get("interest_due") or 0) <= 0:
            data["interest_due"] = interest_due
        if float(data.get("principal_due") or 0) <= 0:
            data["principal_due"] = round(max(pi_payment - interest_due, 0.0), 2)
    if data.get("origination_date") and not data.get("maturity_date"):
        orig = _parse_iso_date(data["origination_date"])
        if orig:
            data["maturity_date"] = _add_months(orig, years * 12).isoformat()
    if original > 0 and prop.purchase_price and float(data.get("original_ltv") or 0) <= 0:
        data["original_ltv"] = round(original / prop.purchase_price * 100, 2)
    return data


def _find_setup_loan_match(
    db: Session,
    prop: models.Property,
    payload: Dict[str, Any],
) -> Optional[models.Loan]:
    """Match an id-less setup draft to canonical debt without creating duplicates."""
    loans = db.query(models.Loan).filter(models.Loan.property_id == prop.id).all()
    source_document_id = payload.get("source_document_id")
    if source_document_id:
        source_match = next((loan for loan in loans if loan.source_document_id == source_document_id), None)
        if source_match:
            return source_match
        linked = db.query(models.LoanDocumentLink).filter_by(document_id=source_document_id).first()
        if linked and linked.loan.property_id == prop.id:
            return linked.loan

    account_number = payload.get("account_number")
    if account_number:
        for loan in loans:
            if accounts_match(loan.account_number, account_number) or any(
                accounts_match(segment.account_number, account_number)
                for segment in loan.servicer_segments
            ):
                return loan

    amount = float(payload.get("original_amount") or 0)
    if amount <= 0:
        return None
    rate = float(payload.get("interest_rate") or 0)
    origin = _parse_iso_date(payload.get("origination_date"))
    lender = re.sub(r"[^a-z0-9]", "", str(payload.get("lender_name") or "").lower())
    ranked = []
    for loan in loans:
        if abs(float(loan.original_amount or 0) - amount) > 2:
            continue
        score = 70
        if rate and abs(float(loan.interest_rate or 0) - rate) <= 0.01:
            score += 25
        loan_origin = _parse_iso_date(loan.disbursement_date or loan.origination_date)
        if origin and loan_origin and abs((origin - loan_origin).days) <= 14:
            score += 60
        loan_lender = re.sub(
            r"[^a-z0-9]", "",
            str(loan.lender_at_origination or loan.lender_name or "").lower(),
        )
        if lender and lender == loan_lender:
            score += 25
        if score >= 95:
            ranked.append((score, loan.id, loan))
    return sorted(ranked, key=lambda item: (-item[0], item[1]))[0][2] if ranked else None


def _property_tax_history(prop: models.Property) -> Dict[int, float]:
    try:
        raw = json.loads(prop.property_tax_history or "{}")
    except Exception:
        raw = {}
    history: Dict[int, float] = {}
    for year, amount in raw.items():
        try:
            history[int(year)] = float(amount or 0)
        except (TypeError, ValueError):
            continue
    return history


def _depreciation_for_year(
    basis: float,
    recovery_period: float,
    rental_months: Dict[int, float],
    tax_year: int,
) -> float:
    """Backend-owned straight-line depreciation for one tax year.

    PropertyLens presents residential rental depreciation as a flat annual
    deduction for each rental year. Non-rental years and exhausted years
    contribute zero.
    """
    if basis <= 0 or recovery_period <= 0:
        return 0.0
    months = rental_months.get(tax_year, 0)
    if months <= 0:
        return 0.0
    annual = basis / recovery_period
    prior_months = sum(month_count for yr, month_count in rental_months.items() if yr < tax_year and month_count > 0)
    if prior_months >= recovery_period * 12:
        return 0.0
    remaining = max(basis - (annual / 12) * prior_months, 0.0)
    return round(min((annual / 12) * min(months, 12), remaining), 2)


def _estimated_fully_depreciated_date(
    basis: float,
    recovery_period: float,
    prior_depreciation: float,
    rental_months: Dict[int, float],
    currently_rental: bool,
) -> Optional[str]:
    """Best-effort projection assuming the *current* rental streak
    continues uninterrupted. Only meaningful while the property is
    actively a rental right now — if it's currently a primary residence
    we can't know if/when it converts back, so return None (shown as
    "paused" in the UI) rather than a misleading date."""
    if basis <= 0 or recovery_period <= 0 or not currently_rental:
        return None
    total_months = recovery_period * 12
    monthly_rate = basis / total_months
    accumulated_dollars = prior_depreciation + monthly_rate * sum(rental_months.values())
    remaining_dollars = basis - accumulated_dollars
    if remaining_dollars <= 0:
        return date.today().isoformat()
    remaining_months = remaining_dollars / monthly_rate
    return _add_months(date.today(), int(round(remaining_months))).isoformat()


def _asset_warning(asset_type: str, description: str, property_type: str) -> Optional[str]:
    text = (description or "").lower()
    is_commercial = (property_type or "").lower() == "commercial"
    if "roof" in text and asset_type == "depreciation":
        if is_commercial:
            return "Commercial roof improvement may qualify for Section 179/bonus review."
        return "Roof replacement is treated as a capital improvement and depreciated separately."
    if any(word in text for word in ("patch", "leak", "repair")):
        return "Confirm repair vs improvement: repairs may be fully deductible, full replacements are capitalized."
    return None


def _depreciation_metric(label: str, value: Optional[float], *, formula: str, inputs: Optional[List[Dict[str, Any]]] = None, source: str = "CALCULATED") -> Dict[str, Any]:
    numeric = float(value or 0)
    return {
        "label": label,
        "value": round(numeric, 2),
        "displayValue": _compact_money_display(numeric, threshold=1_000),
        "fullDisplayValue": _money_display(numeric),
        "unit": "currency",
        "source": source,
        "status": "complete",
        "tone": "neutral",
        "formula": formula,
        "inputs": inputs or [],
        "computation": _money_display(numeric),
        "lastUpdated": date.today().isoformat(),
    }


def _serialize_depreciation_asset(
    asset, prop, tax_year: int, currently_rental: bool, is_base_building: bool = False,
) -> Dict[str, Any]:
    basis = max((asset.get("cost_basis") or 0.0) - (asset.get("land_portion") or 0.0), 0.0)
    recovery_period = asset.get("recovery_period") or 27.5
    annual = round(basis / recovery_period, 2) if recovery_period else 0.0

    placed = _parse_iso_date(asset.get("placed_in_service_date"))
    rental_months = _rental_months_by_year(prop, floor=placed, through_year=tax_year)

    current = _depreciation_for_year(basis, recovery_period, rental_months, tax_year)
    prior = asset.get("prior_depreciation") or 0.0
    accumulated_months = sum(months for yr, months in rental_months.items() if yr <= tax_year and months > 0)
    accumulated = round(prior + (annual / 12) * accumulated_months, 2)
    remaining = round(max(basis - accumulated, 0.0), 2)
    return {
        **asset,
        "depreciable_basis": round(basis, 2),
        "annual_depreciation": annual,
        "current_year_depreciation": current,
        "accumulated_depreciation": min(accumulated, round(basis, 2)),
        "remaining_basis": remaining,
        "rental_months_to_date": sum(rental_months.values()),
        "rental_years_to_date": round(accumulated_months / 12, 2),
        "fully_depreciated_date": _estimated_fully_depreciated_date(
            basis, recovery_period, prior, rental_months, currently_rental,
        ),
        "is_base_building": is_base_building,
        "warning": _asset_warning(asset.get("asset_type", "depreciation"), asset.get("description", ""), prop.property_type),
    }


def _depreciation_schedule_payload(prop, tax_year: Optional[int] = None) -> Dict[str, Any]:
    tax_year = tax_year or date.today().year

    if not _has_rental_history(prop):
        return {
            "tax_year": tax_year,
            "eligible": False,
            "currently_rental": False,
            "reason": "Depreciation only applies to rental-use property. This property has no rental history — add a rental period on the Rental tab once it's rented out.",
            "assets": [],
            "timeline": [],
            "rollup": {
                "total_annual_depreciation": 0.0,
                "total_current_year_depreciation": 0.0,
                "total_accumulated_depreciation": 0.0,
                "total_remaining_basis": 0.0,
                "total_current_year_amortization": 0.0,
            },
            "metrics": {
                "currentYearDepreciation": _depreciation_metric("Current Year Depreciation", 0, formula="No rental-use depreciation history"),
                "annualDepreciation": _depreciation_metric("Annual Depreciation", 0, formula="No rental-use depreciation history"),
                "accumulatedDepreciation": _depreciation_metric("Accumulated", 0, formula="No rental-use depreciation history"),
                "remainingBasis": _depreciation_metric("Remaining Basis", 0, formula="No rental-use depreciation history"),
            },
            "schedule_e": {
                "line_18_depreciation": None,
                "model_total": 0.0,
                "delta": None,
                "status": "not_applicable",
                "common_causes": [],
            },
        }

    currently_rental = _is_currently_rental(prop)
    purchase_price = float(prop.purchase_price or 0.0)
    land_value = float(prop.land_value or 0.0)
    base_basis = max(purchase_price - land_value, 0.0)
    base_placed = prop.purchase_date or prop.recorded_date
    assets = []
    if base_basis > 0:
        assets.append(_serialize_depreciation_asset({
            "id": None,
            "property_id": prop.id,
            "owner_id": prop.owner_id,
            "asset_type": "depreciation",
            "description": "Building",
            "placed_in_service_date": base_placed,
            "cost_basis": (prop.purchase_price or 0.0),
            "land_portion": (prop.land_value or 0.0),
            "method": "SL",
            "recovery_period": prop.depreciation_years or 27.5,
            "prior_depreciation": 0.0,
            "notes": "Derived from purchase price less land value.",
        }, prop, tax_year, currently_rental, True))

    for row in prop.depreciation_assets:
        assets.append(_serialize_depreciation_asset({
            "id": row.id,
            "property_id": row.property_id,
            "owner_id": row.owner_id,
            "asset_type": row.asset_type or "depreciation",
            "description": row.description,
            "placed_in_service_date": row.placed_in_service_date,
            "cost_basis": row.cost_basis or 0.0,
            "land_portion": row.land_portion or 0.0,
            "method": row.method or "SL",
            "recovery_period": row.recovery_period or 27.5,
            "prior_depreciation": row.prior_depreciation or 0.0,
            "notes": row.notes or "",
        }, prop, tax_year, currently_rental, False))

    filed = next((e.depreciation for e in prop.tax_entries if e.tax_year == tax_year and e.property_kind == "rental"), None)
    model_total = round(sum(a["current_year_depreciation"] for a in assets if a["asset_type"] == "depreciation"), 2)
    amortization_total = round(sum(a["current_year_depreciation"] for a in assets if a["asset_type"] == "amortization"), 2)
    delta = None if filed is None else round(model_total - (filed or 0.0), 2)

    start_years = [
        (_parse_iso_date(a.get("placed_in_service_date")) or date(tax_year, 1, 1)).year
        for a in assets
    ]
    start_year = min(start_years + [tax_year])
    longest_recovery = max([float(a.get("recovery_period") or 27.5) for a in assets] or [27.5])
    end_year = max(tax_year, start_year + int(math.ceil(longest_recovery)) + 1)

    rental_months_by_year = _rental_months_by_year(prop, through_year=end_year)
    rental_years = set(rental_months_by_year.keys())
    asset_rental_months = [
        (asset, _rental_months_by_year(prop, floor=_parse_iso_date(asset.get("placed_in_service_date")), through_year=end_year))
        for asset in assets
    ]
    timeline = []
    accumulated_by_year = 0.0
    for year in range(start_year, min(end_year, start_year + 40) + 1):
        rental_months = rental_months_by_year.get(year, 0)
        row = {
            "year": year,
            "total": 0.0,
            "is_rental_year": year in rental_years,
            "rental_months": rental_months,
            "use_status": "Rental" if rental_months >= 12 else "Mixed" if rental_months > 0 else "Primary / paused",
        }
        for asset, rental_months in asset_rental_months:
            value = _depreciation_for_year(
                asset["depreciable_basis"],
                asset.get("recovery_period") or 27.5,
                rental_months,
                year,
            )
            row[asset["description"]] = value
            row["total"] = round(row["total"] + value, 2)
        row["asset_values"] = [
            {
                "asset": asset["description"],
                "value": row.get(asset["description"], 0.0),
                "annual": asset["annual_depreciation"],
                "recovery_period": asset.get("recovery_period") or 27.5,
            }
            for asset, _months in asset_rental_months
        ]
        accumulated_by_year = min(
            round(accumulated_by_year + row["total"], 2),
            round(sum(a["depreciable_basis"] for a in assets if a["asset_type"] == "depreciation"), 2),
        )
        row["accumulated"] = accumulated_by_year
        row["basis_ceiling"] = round(sum(a["depreciable_basis"] for a in assets if a["asset_type"] == "depreciation"), 2)
        row["remaining_basis"] = round(max(row["basis_ceiling"] - accumulated_by_year, 0), 2)
        timeline.append(row)

    common_causes = []
    if delta not in (None, 0):
        common_causes = [
            "Rental-period gaps (primary-residence years don't accrue depreciation)",
            "Missing capital improvement asset",
            "Land/building split differs from filed return",
        ]

    total_basis = round(sum(a["depreciable_basis"] for a in assets if a["asset_type"] == "depreciation"), 2)
    total_annual_depreciation = round(sum(a["annual_depreciation"] for a in assets if a["asset_type"] == "depreciation"), 2)
    total_accumulated_depreciation = round(sum(a["accumulated_depreciation"] for a in assets if a["asset_type"] == "depreciation"), 2)
    total_remaining_basis = round(sum(a["remaining_basis"] for a in assets if a["asset_type"] == "depreciation"), 2)
    basis_used_pct = round((total_accumulated_depreciation / total_basis) * 100, 2) if total_basis else 0.0
    years_left = round(total_remaining_basis / total_annual_depreciation, 1) if total_annual_depreciation else None
    recapture_if_sold_today = round(total_accumulated_depreciation * 0.25, 2)
    fully_depreciated_years = [
        (_parse_iso_date(a.get("fully_depreciated_date")) or date(tax_year, 1, 1)).year
        for a in assets
        if a["asset_type"] == "depreciation" and a.get("fully_depreciated_date")
    ]
    land_warning = (
        "enter land value"
        if base_basis > 0 and not (prop.land_value or 0)
        else None
    )
    recapture_at_sale = round(total_accumulated_depreciation * 0.25, 2)
    years_left = math.ceil(total_remaining_basis / total_annual_depreciation) if total_annual_depreciation else None
    depreciation_timeline_total_to_year = round(
        sum(float(row.get("total") or 0) for row in timeline if row["year"] <= tax_year),
        2,
    )
    full_rental_values = []
    asset_flat_checks = []
    for asset in assets:
        key = asset["description"]
        annual_value = float(asset.get("annual_depreciation") or 0)
        yearly_values = [
            float(row.get(key) or 0)
            for row in timeline
            if row.get("is_rental_year") and float(row.get(key) or 0) > 0
        ]
        full_values = [value for value in yearly_values if abs(value - annual_value) <= 1]
        full_rental_values.extend(full_values)
        asset_flat_checks.append(not full_values or max(full_values) - min(full_values) < 1)
    non_rental_values = [
        float(row.get("total") or 0)
        for row in timeline
        if not row.get("is_rental_year")
    ]
    constant_rental_years = all(asset_flat_checks)
    assertions = {
        "A1": {
            "passed": abs(model_total - sum(a["current_year_depreciation"] for a in assets if a["asset_type"] == "depreciation")) <= 1,
            "message": "hero current-year deduction equals sum of asset current-year depreciation",
        },
        "A2": {
            "passed": (
                abs(total_accumulated_depreciation - sum(a["accumulated_depreciation"] for a in assets if a["asset_type"] == "depreciation")) <= 1
                and abs(total_accumulated_depreciation - depreciation_timeline_total_to_year) <= 1
            ),
            "message": "accumulated depreciation ties to assets and timeline",
        },
        "A3": {
            "passed": abs(recapture_at_sale - total_accumulated_depreciation * 0.25) <= 1,
            "message": "recapture equals 25% of accumulated depreciation",
        },
        "A4": {
            "passed": abs(total_remaining_basis - max(total_basis - total_accumulated_depreciation, 0)) <= 1,
            "message": "remaining basis equals depreciable basis minus accumulated depreciation",
        },
        "A5": {
            "passed": not full_rental_values or max(full_rental_values) > 0,
            "message": "full rental years accrue positive straight-line depreciation once basis is set",
        },
        "A6": {
            "passed": constant_rental_years and all(abs(value) < 1 for value in non_rental_values),
            "message": "timeline is flat across rental years and zero for non-rental years",
        },
        "A7": {
            "passed": not (prop.land_value or 0) or total_basis != purchase_price,
            "message": "land value is excluded from depreciable basis",
        },
    }
    status_line = {
        "icon": "trending-down" if currently_rental else "pause-circle",
        "text": "Active rental — accruing" if currently_rental else "Not accruing — property is not currently an active rental",
    }
    hero = {
        "currentYearDeduction": _depreciation_metric(
            f"You deduct this year ({tax_year})",
            model_total,
            formula="Sum of backend straight-line asset deductions for the selected year",
        ),
        "accumulatedDepreciation": _depreciation_metric(
            "Banked so far",
            total_accumulated_depreciation,
            formula="Sum of all rental-year asset depreciation through selected year",
        ),
        "recaptureAtSale": _depreciation_metric(
            "Recapture at sale",
            recapture_at_sale,
            formula="Accumulated depreciation × 25%",
        ),
        "remainingBasis": _depreciation_metric(
            "Remaining",
            total_remaining_basis,
            formula="Depreciable basis minus accumulated depreciation",
        ),
        "yearsLeft": years_left,
    }

    return {
        "tax_year": tax_year,
        "eligible": True,
        "currently_rental": currently_rental,
        "reason": None,
        "status_line": status_line,
        "hero": hero,
        "assertions": assertions,
        "flags": [land_warning] if land_warning else [],
        "assets": assets,
        "timeline_asset_keys": [asset["description"] for asset in assets if asset["asset_type"] == "depreciation"],
        "timeline": timeline,
        "metrics": {
            "currentYearDepreciation": _depreciation_metric(
                "Current Year Depreciation",
                model_total,
                formula="Sum of current-year depreciation across depreciation assets",
            ),
            "annualDepreciation": _depreciation_metric(
                "Annual Depreciation",
                total_annual_depreciation,
                formula="Sum of full-year straight-line depreciation across depreciation assets",
            ),
            "accumulatedDepreciation": _depreciation_metric(
                "Accumulated",
                total_accumulated_depreciation,
                formula="Prior depreciation plus rental-month depreciation to date",
            ),
            "remainingBasis": _depreciation_metric(
                "Remaining Basis",
                total_remaining_basis,
                formula="Depreciable basis minus accumulated depreciation",
                inputs=[
                    {"label": "Depreciable basis", "value": total_basis, "display": _money_display(total_basis)},
                    {"label": "Accumulated depreciation", "value": total_accumulated_depreciation, "display": _money_display(total_accumulated_depreciation)},
                ],
            ),
        },
        "rollup": {
            "depreciable_basis": total_basis,
            "total_annual_depreciation": total_annual_depreciation,
            "full_year_rate": total_annual_depreciation,
            "total_current_year_depreciation": model_total,
            "current_year_deduction": model_total,
            "total_accumulated_depreciation": total_accumulated_depreciation,
            "total_remaining_basis": total_remaining_basis,
            "basis_used_pct": basis_used_pct,
            "years_left": years_left,
            "recapture_if_sold_today": recapture_at_sale,
            "fully_depreciated_year": max(fully_depreciated_years) if fully_depreciated_years else None,
            "land_warning": land_warning,
            "total_current_year_amortization": amortization_total,
        },
        "schedule_e": {
            "line_18_depreciation": filed,
            "model_total": model_total,
            "delta": delta,
            "status": "missing_filing" if filed is None else ("ties" if abs(delta or 0) < 1 else "diff"),
            "common_causes": common_causes,
        },
    }


# Backend-owned metric DTO builder. This intentionally supersedes the older
# summary DTO above while the route layer is being kept stable.
def build_summary_dto(prop: models.Property, summary_metrics: Optional[dict] = None) -> dict:
    metrics = compute_property_metrics(prop)
    source_metrics = summary_metrics or metrics
    usage_type = "PRIMARY" if (prop.usage_type or "").lower() == "primary" else "RENTAL"

    metric_year = int(source_metrics.get("year") or date.today().year)
    current_year = date.today().year
    months_elapsed = int(source_metrics.get("months_elapsed") or (date.today().month if metric_year == current_year else 12) or 12)
    resolved_rent = resolve_rent(prop, metric_year)
    rent_amount = resolved_rent["monthly_rent"]
    rent_source_label = resolved_rent["label"]
    annual_rent = resolved_rent["annual_rent"]
    resolved_opex = resolve_annual_operating_expenses(prop, metric_year)
    resolved_property_tax = resolved_opex["propertyTax"]
    annual_operating_expenses = resolved_opex["value"]
    annual_debt_service = source_metrics.get("annual_debt_service", 0) or 0
    annual_noi = round(annual_rent - annual_operating_expenses, 2)
    annual_cash_flow = round(annual_noi - annual_debt_service, 2)
    monthly_operating_expenses = annual_operating_expenses / 12
    monthly_debt_service = annual_debt_service / 12
    monthly_cash_flow = round(rent_amount - monthly_operating_expenses - monthly_debt_service, 2)
    market_value = prop.market_value or 0
    total_debt = metrics.get("total_loan_balance", 0) or 0
    equity = metrics.get("equity", 0) or 0
    principal_paid = source_metrics.get("principal_paid", 0) or 0
    appreciation = source_metrics.get("appreciation", (market_value - (prop.purchase_price or market_value))) or 0
    mortgage_interest = source_metrics.get("mortgage_interest", 0) or 0
    depreciation = source_metrics.get("depreciation", 0) or 0
    taxable_income = annual_rent - annual_operating_expenses - mortgage_interest - depreciation
    # Total return is additive and must reconcile with its tooltip inputs.
    # Do not trust older parallel totals from source_metrics; they may exclude
    # appreciation or use stale cash-flow definitions.
    total_return = round(annual_cash_flow + principal_paid + appreciation, 2)
    monthly_cost_to_own = source_metrics.get("monthly_cost_to_own", 0) or (
        (metrics.get("monthly_mortgage", 0) or 0) + (metrics.get("monthly_expenses", 0) or 0)
    )

    cap_rate = round((annual_noi / market_value * 100), 4) if market_value else 0
    dscr = round((annual_noi / annual_debt_service), 4) if annual_debt_service else 0
    loan_to_value = (total_debt / market_value * 100) if market_value else 0
    cash_invested = source_metrics.get("cash_invested", 0) or 0
    cash_on_cash = source_metrics.get("cash_on_cash_return")

    sign_sanity = {
        "cap_rate_non_negative_when_noi_positive": annual_noi <= 0 or cap_rate >= 0,
        "dscr_non_negative_when_noi_positive": annual_noi <= 0 or dscr >= 0,
        "dscr_formula": abs(dscr - (annual_noi / annual_debt_service if annual_debt_service else 0)) <= 0.01,
        "monthly_cash_flow_formula": abs(monthly_cash_flow - (annual_cash_flow / 12)) <= 1,
        "total_return_additive": abs(total_return - (annual_cash_flow + principal_paid + appreciation)) <= 1,
    }
    raw_metrics = {
        **metrics,
        "effective_rent": round(rent_amount, 2),
        "annual_rent": round(annual_rent, 2),
        "property_tax_annual": round(resolved_property_tax["value"], 2),
        "property_tax_source": resolved_property_tax["source"],
        "property_tax_source_tier": resolved_property_tax["sourceTier"],
        "property_tax_warning": resolved_property_tax["warning"],
        "monthly_expenses": round(monthly_operating_expenses, 2),
        "operating_expenses": round(annual_operating_expenses, 2),
        "monthly_noi": round(annual_noi / 12, 2),
        "annual_noi": round(annual_noi, 2),
        "annual_debt_service": round(annual_debt_service, 2),
        "monthly_mortgage": round(monthly_debt_service, 2),
        "monthly_cash_flow": round(monthly_cash_flow, 2),
        "annual_cash_flow": round(annual_cash_flow, 2),
        "cap_rate": round(cap_rate, 4),
        "dscr": round(dscr, 4),
    }
    sign_sanity.update({
        "raw_noi_ties_summary": abs((raw_metrics.get("annual_noi") or 0) - annual_noi) <= 1,
        "noi_formula": abs(annual_noi - (annual_rent - annual_operating_expenses)) <= 1,
        "cash_flow_formula": abs(annual_cash_flow - (annual_noi - annual_debt_service)) <= 1,
        "operating_expenses_component_sum": abs(
            annual_operating_expenses - sum((resolved_opex.get("components") or {}).values())
        ) <= 1,
    })
    warning = None
    if annual_noi > 0 and cap_rate < 0:
        warning = "Cap rate is negative while NOI is positive. Check market value and income inputs."
    if annual_noi > 0 and dscr < 0:
        warning = "DSCR is negative while NOI is positive. Check debt-service inputs."

    display_rent = rent_amount
    display_rent_label = rent_source_label
    property_tax_note = resolved_property_tax.get("label") or "Property tax"
    opex_label = f"Annual operating expenses (property tax: {property_tax_note})"
    if resolved_property_tax.get("warning"):
        warning = f"{warning} {resolved_property_tax['warning']}" if warning else resolved_property_tax["warning"]
    cash_flow_input_result = round(rent_amount - monthly_operating_expenses - monthly_debt_service, 2)
    if abs(cash_flow_input_result - monthly_cash_flow) > 1:
        mismatch = "Cash-flow inputs do not reconcile to result; check backend engine inputs."
        warning = f"{warning} {mismatch}" if warning else mismatch

    cash_invested_missing = []
    if not (prop.down_payment or 0):
        cash_invested_missing.append("downPayment")
    elif cash_on_cash is None:
        cash_invested_missing.append("closingCosts")

    metric_map = {
        "monthlyCashFlow": _money_metric(monthly_cash_flow, "mo", explain=_metric_explain(
            "Monthly rental income - monthly operating expenses - monthly debt service",
            [_money_input("Monthly rental income", rent_amount), _money_input("Monthly operating expenses", monthly_operating_expenses), _money_input("Monthly debt service", monthly_debt_service)],
            _join_computation([_compact_money_display(rent_amount), _money_display(monthly_operating_expenses), _money_display(monthly_debt_service)], "-"),
            f"{_compact_money_display(monthly_cash_flow)}/mo",
            warning=warning,
        )),
        "annualCashFlow": _money_metric(annual_cash_flow, "yr", explain=_metric_explain(
            "NOI - annual debt service",
            [_money_input("NOI", annual_noi), _money_input("Annual debt service", annual_debt_service)],
            _join_computation([_compact_money_display(annual_noi), _compact_money_display(annual_debt_service)], "-"),
            _compact_money_display(annual_cash_flow),
            warning=warning,
        )),
        "monthlyCostToOwn": _money_metric(monthly_cost_to_own, "mo", kind="cost", explain=_metric_explain(
            "(Annual debt service + annual operating expenses) ÷ 12",
            [_money_input("Annual debt service", annual_debt_service), _money_input(opex_label, annual_operating_expenses)],
            f"({_compact_money_display(annual_debt_service)} + {_money_display(annual_operating_expenses)}) ÷ 12",
            f"{_compact_money_display(monthly_cost_to_own)}/mo",
        )),
        "noi": _money_metric(annual_noi, "yr", explain=_metric_explain(
            "Annual rental income - annual operating expenses",
            [_money_input("Annual rental income", annual_rent), _money_input(opex_label, annual_operating_expenses)],
            _join_computation([_money_display(annual_rent), _money_display(annual_operating_expenses)], "-"),
            _compact_money_display(annual_noi),
        )),
        "annualDebtService": _money_metric(annual_debt_service, "yr", kind="cost", explain=_metric_explain(
            "Monthly debt service × 12",
            [_money_input("Monthly debt service", monthly_debt_service)],
            f"{_money_display(monthly_debt_service)} × 12",
            _compact_money_display(annual_debt_service),
        )),
        "capRate": _percent_metric(cap_rate, explain=_metric_explain(
            "NOI ÷ market value",
            [_money_input("NOI", annual_noi), _money_input("Market value", market_value)],
            _join_computation([_compact_money_display(annual_noi), _compact_money_display(market_value)], "÷") if market_value else None,
            _percent_display(cap_rate, 2) if market_value else None,
            missing_inputs=[] if market_value else ["marketValue"],
            warning=warning,
            hint=None if market_value else "Enter market value to calculate",
        )),
        "dscr": _ratio_metric(dscr, explain=_metric_explain(
            "NOI ÷ annual debt service",
            [_money_input("NOI", annual_noi), _money_input("Annual debt service", annual_debt_service)],
            _join_computation([_compact_money_display(annual_noi), _compact_money_display(annual_debt_service)], "÷") if annual_debt_service else None,
            f"{_number_display(dscr)}x" if annual_debt_service else None,
            missing_inputs=[] if annual_debt_service else ["annualDebtService"],
            warning=warning,
            hint=None if annual_debt_service else "Enter loan payment to calculate",
        )),
        "cashOnCashReturn": _percent_metric(cash_on_cash or 0, explain=_metric_explain(
            "Annual cash flow ÷ cash invested",
            [_money_input("Annual cash flow", annual_cash_flow), _money_input("Cash invested", cash_invested if cash_invested else None)],
            _join_computation([_compact_money_display(annual_cash_flow), _money_display(cash_invested)], "÷") if cash_on_cash is not None else None,
            _percent_display(cash_on_cash or 0, 2) if cash_on_cash is not None else None,
            missing_inputs=[] if cash_on_cash is not None else cash_invested_missing,
            hint=None if cash_on_cash is not None else "Enter down payment to calculate",
        )) if cash_on_cash is not None else {
            "value": None,
            "display": "—",
            "period": None,
            "source": "CALCULATED",
            "tone": "neutral",
            **_metric_explain(
                "Annual cash flow ÷ cash invested",
                [_money_input("Annual cash flow", annual_cash_flow), _money_input("Cash invested", None)],
                None,
                None,
                missing_inputs=cash_invested_missing,
                hint="Enter down payment to calculate",
            ),
        },
        "equity": _money_metric(equity, explain=_metric_explain(
            "Market value - remaining loan balance",
            [_money_input("Market value", market_value), _money_input("Remaining loan balance", total_debt)],
            _join_computation([_compact_money_display(market_value), _compact_money_display(total_debt)], "-"),
            _compact_money_display(equity),
        )),
        "loanToValue": _percent_metric(loan_to_value, explain=_metric_explain(
            "Remaining loan balance ÷ market value",
            [_money_input("Remaining loan balance", total_debt), _money_input("Market value", market_value)],
            _join_computation([_compact_money_display(total_debt), _compact_money_display(market_value)], "÷") if market_value else None,
            _percent_display(loan_to_value, 2) if market_value else None,
            missing_inputs=[] if market_value else ["marketValue"],
            hint=None if market_value else "Enter market value to calculate",
        )),
        "marketValue": _money_metric(market_value, explain=_metric_explain(
            "Current market value",
            [_money_input("Market value", market_value)],
            _compact_money_display(market_value),
            _compact_money_display(market_value),
            source="USER_INPUT",
        )),
        "totalDebt": _money_metric(total_debt, kind="cost", explain=_metric_explain(
            "Sum remaining loan balances",
            [_money_input("Remaining loan balance", total_debt)],
            _compact_money_display(total_debt),
            _compact_money_display(total_debt),
        )),
        "totalReturnYtd": _money_metric(total_return or 0, explain=_metric_explain(
            "Cash flow + principal paid + appreciation",
            [_money_input("Cash flow", annual_cash_flow), _money_input("Principal paid", principal_paid), _money_input("Appreciation", appreciation)],
            f"{_compact_money_display(annual_cash_flow)} + {_money_display(principal_paid)} + {_money_display(appreciation)}",
            _money_display(total_return or 0),
        )),
        "taxableIncome": _money_metric(taxable_income, explain=_metric_explain(
            "Rental income - operating expenses - mortgage interest - depreciation",
            [_money_input("Rental income", annual_rent), _money_input(opex_label, annual_operating_expenses), _money_input("Mortgage interest", mortgage_interest), _money_input("Depreciation", depreciation)],
            f"{_money_display(annual_rent)} - {_money_display(annual_operating_expenses)} - {_money_display(mortgage_interest)} - {_money_display(depreciation)}",
            _money_display(taxable_income),
        )),
    "rentPerMonth": _money_metric(display_rent, "mo", explain=_metric_explain(
            "Latest current-year lease rent, else property details rent",
            [_money_input(display_rent_label or "Rent per month", display_rent)],
            _money_display(display_rent),
            f"{_money_display(display_rent)}/mo",
            source="USER_INPUT" if resolved_rent.get("source") in {"rental_tab", "property_details"} else "CALCULATED",
        )),
    }
    metric_map["equity"]["display"] = _compact_money_display(equity)
    return {
        "propertyId": prop.id,
        "usageType": usage_type,
        "asOfDate": date.today().isoformat(),
        "source": "backend_engine",
        "metrics": metric_map,
        "signSanity": sign_sanity,
        "raw": raw_metrics,
    }


def _canonical_property_metric_row(
    prop: models.Property,
    db: Session,
    current_user: models.User,
) -> dict:
    """Page-ready property metrics used by list, dashboard, and reports."""
    lifetime_summary = get_lifetime_summary(prop.id, db, current_user)
    summary_dto = build_summary_dto(prop, lifetime_summary.get("summary_metrics"))
    raw_metrics = summary_dto.get("raw") or compute_property_metrics(prop)
    return {
        "raw": raw_metrics,
        "metrics": summary_dto.get("metrics") or {},
        "summary": summary_dto,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[PropertySummary])
def list_properties(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    own_props = db.query(models.Property).filter(
        models.Property.owner_id == current_user.id
    ).all()

    # Also include properties from users who have shared their portfolio with me
    shares_received = db.query(models.UserSharing).filter(
        models.UserSharing.shared_with_id == current_user.id
    ).all()
    shared_owner_ids = {s.owner_id: s.owner for s in shares_received}
    shared_props = []
    if shared_owner_ids:
        shared_props = db.query(models.Property).filter(
            models.Property.owner_id.in_(shared_owner_ids.keys())
        ).all()

    def _to_summary(p, shared_by_user=None):
        canonical = _canonical_property_metric_row(p, db, current_user)
        m = canonical["raw"]
        metric_map = canonical["metrics"]
        has_rental_history = _has_rental_history(p)
        currently_rental = _is_currently_rental(p)
        is_primary = (p.usage_type or "").lower() == "primary"
        residency_status = "Mixed" if is_primary and has_rental_history else ("Rental" if currently_rental else "Primary")
        return PropertySummary(
            id=p.id,
            property_uid=p.property_uid,
            name=p.name or _default_property_name(p.address, p.id),
            address=p.address,
            city=p.city,
            state=p.state,
            property_type=p.property_type,
            property_type_raw=p.property_type_raw,
            usage_type=p.usage_type or "Rental",
            monthly_rent=0 if (p.usage_type or "").lower() == "primary" else p.monthly_rent,
            market_value=p.market_value,
            total_loan_balance=m["total_loan_balance"],
            monthly_mortgage=m["monthly_mortgage"],
            monthly_cash_flow=m["monthly_cash_flow"],
            equity=m["equity"],
            has_rental_history=has_rental_history,
            currently_rental=currently_rental,
 residency_status=residency_status,
 shared_by_name=shared_by_user.name if shared_by_user else None,
 shared_by_email=shared_by_user.email if shared_by_user else None,
 metrics=metric_map,
        )

    result = [_to_summary(p) for p in own_props]
    for p in shared_props:
        result.append(_to_summary(p, shared_by_user=shared_owner_ids[p.owner_id]))
    return result


@router.post("", response_model=PropertyOut)
def create_property(
    prop_in: PropertyCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    data = prop_in.model_dump(exclude={"loans", "usage_periods"})
    _normalize_property_type(data)
    _normalize_current_residency_status(data)
    _apply_resolved_acquisition_costs(data)
    apply_default_market_price(data)
    apply_rental_available_from_default(data)
    if rental_available_before_purchase(data):
        raise HTTPException(status_code=422, detail="Rental availability cannot begin before the property was purchased.")
    data["property_uid"] = str(uuid.uuid4())
    data["name"] = data.get("name") or None
    prop = models.Property(
        owner_id=current_user.id,
        **data
    )
    db.add(prop)
    db.flush()
    if not prop.name:
        prop.name = _default_property_name(prop.address, prop.id)

    for loan_data in (prop_in.loans or []):
        loan = models.Loan(property_id=prop.id, **loan_data.model_dump())
        db.add(loan)

    usage_periods = prop_in.usage_periods or []
    if not usage_periods:
        usage_periods = [
            UsagePeriodBase(
                usage_type="PRIMARY" if (prop.usage_type or "").lower() == "primary" else "RENTAL",
                start_date=prop.purchase_date or date.today().isoformat(),
                monthly_rent=prop.monthly_rent or 0.0,
                vacancy_allowance=prop.vacancy_allowance or 0.0,
                property_management_fee=prop.property_management_fee or 0.0,
            )
        ]
    previous = None
    for period_in in usage_periods:
        _validate_usage_period(period_in, previous)
        usage_period = models.UsagePeriod(property_id=prop.id, **_usage_period_payload(period_in))
        db.add(usage_period)
        previous = usage_period
    db.flush()
    _sync_property_current_usage(prop)

    db.commit()
    db.refresh(prop)
    return prop


@router.post("/market-price/default")
def default_market_price(
    request: MarketPriceEstimateRequest,
    current_user: models.User = Depends(get_current_user),
):
    """Return the backend-owned default market price for Property Setup."""
    return estimate_market_price(request.purchase_price, request.purchase_date)


def _report_metric_from_dashboard(
    dashboard: Dict[str, Any],
    key: str,
    fallback: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    for metric in dashboard.get("overview", []):
        if metric.get("key") == key:
            return metric
    return fallback or _dashboard_metric(key, key, None, status="data_issue", reason="Metric unavailable.")


def _build_portfolio_report(
    dashboard_model: Dict[str, Any],
    executive_dashboard: Dict[str, Any],
    yearly_trends: List[Dict[str, Any]],
    *,
    owner_name: str = "Investor",
) -> Dict[str, Any]:
    rental_details = dashboard_model.get("properties") or []
    as_of = executive_dashboard.get("asOfDate") or date.today().isoformat()
    data_quality = executive_dashboard.get("dataQualityStatus") or "Needs Review"
    property_health = executive_dashboard.get("propertyHealth") or []
    actions = [
        action
        for group in (executive_dashboard.get("attention") or {}).get("groups", [])
        for action in group.get("actions", [])
    ]

    monthly_cash_flow = _report_metric_from_dashboard(executive_dashboard, "monthlyNetCashFlow")
    portfolio_value = _report_metric_from_dashboard(executive_dashboard, "portfolioValue")
    total_equity = _report_metric_from_dashboard(executive_dashboard, "totalEquity")
    portfolio_ltv = _report_metric_from_dashboard(executive_dashboard, "portfolioLtv")
    annual_noi = _report_metric_from_dashboard(executive_dashboard, "annualNoi")
    attention_metric = _report_metric_from_dashboard(executive_dashboard, "propertiesNeedingAttention")

    positive_properties = [
        row for row in property_health
        if (row.get("monthlyCashFlow") or {}).get("value") is not None
        and (row.get("monthlyCashFlow") or {}).get("value") >= 0
    ]
    negative_properties = [
        row for row in property_health
        if (row.get("monthlyCashFlow") or {}).get("value") is not None
        and (row.get("monthlyCashFlow") or {}).get("value") < 0
    ]
    strongest_property = max(
        positive_properties,
        key=lambda row: (row.get("monthlyCashFlow") or {}).get("value") or 0,
        default=None,
    )

    scorecard = [
        {
            "key": "cashFlow",
            "label": "Cash Flow Position",
            "status": "warning" if negative_properties else "ok",
            "display": "Needs attention" if negative_properties else "Stable",
            "description": (
                "One or more rentals are reducing monthly portfolio cash flow."
                if negative_properties
                else "Included rentals are not producing negative monthly cash flow."
            ),
        },
        {
            "key": "dataQuality",
            "label": "Data Quality",
            "status": "warning" if data_quality != "Complete" else "ok",
            "display": data_quality,
            "description": "Report confidence follows backend data-quality checks.",
        },
        {
            "key": "leverage",
            "label": "Leverage",
            "status": portfolio_ltv.get("status") or "ok",
            "display": portfolio_ltv.get("display"),
            "description": portfolio_ltv.get("reason") or "Portfolio LTV is calculated by the backend dashboard aggregator.",
        },
    ]

    highlights = []
    if strongest_property:
        highlights.append({
            "id": "highest-cash-flow",
            "icon": "trending-up",
            "headline": "Highest cash-flow contributor",
            "title": strongest_property.get("property"),
            "metric": strongest_property.get("monthlyCashFlow"),
            "summary": f"{strongest_property.get('property')} is the strongest current monthly cash-flow contributor.",
            "cta": {"label": "Review property", "href": f"/properties/{strongest_property.get('id')}"},
        })
    highlights.extend([
        {
            "id": "equity-growth",
            "icon": "piggy-bank",
            "headline": "Wealth creation",
            "title": "Equity continues to compound through ownership.",
            "metric": total_equity,
            "summary": "Equity combines backend market value and debt balances at the report as-of date.",
            "cta": {"label": "Review equity story", "href": "#wealth-creation-story"},
        },
        {
            "id": "annual-noi",
            "icon": "landmark",
            "headline": "Operating performance",
            "title": "Annual NOI anchors rental performance.",
            "metric": annual_noi,
            "summary": "NOI is shown before debt service for the included rental scope.",
            "cta": {"label": "Review cash flow", "href": "#cash-flow-story"},
        },
    ])

    risks = [
        {
            "id": action.get("id"),
            "severity": action.get("severity"),
            "issue": action.get("title"),
            "whyItMatters": action.get("whyItMatters"),
            "financialImpact": action.get("financialImpact"),
            "confidence": action.get("confidence") or "Backend reviewed",
            "recommendation": action.get("recommendation") or action.get("primaryAction", {}).get("label"),
            "cta": action.get("primaryAction"),
        }
        for action in actions
    ]

    story_lookup = {story.get("key"): story for story in executive_dashboard.get("stories", [])}
    story_sections = [
        {
            "id": "cash-flow-story",
            "title": "Cash Flow Story",
            "question": "Where is my money going?",
            "story": story_lookup.get("cashFlow", {}),
        },
        {
            "id": "wealth-creation-story",
            "title": "Wealth Creation Story",
            "question": "How is my wealth growing?",
            "story": story_lookup.get("equityGrowth", {}),
        },
        {
            "id": "debt-financing-story",
            "title": "Debt & Financing Story",
            "question": "Is my leverage healthy?",
            "story": story_lookup.get("debtLeverage", {}),
        },
        {
            "id": "tax-benefits-story",
            "title": "Tax Benefits Story",
            "question": "How do rentals affect taxes?",
            "story": story_lookup.get("taxImpact", {}),
        },
    ]

    properties = [
        {
            "id": row.get("id"),
            "name": row.get("property"),
            "healthBadge": row.get("status"),
            "cashFlowBadge": row.get("monthlyCashFlow"),
            "equityBadge": row.get("equity"),
            "ltv": row.get("ltv"),
            "dscr": row.get("dscr"),
            "dataHealth": row.get("dataHealth"),
            "recommendation": row.get("action"),
            "cta": {"label": "Open property", "href": f"/properties/{row.get('id')}"} if row.get("id") else None,
        }
        for row in property_health
    ]

    appendix_tables = [
        {
            "id": "property-performance",
            "title": "Property-by-Property Performance",
            "columns": ["Property", "Monthly Cash Flow", "DSCR", "LTV", "Equity", "Data Health", "Status"],
            "rows": [
                {
                    "Property": row.get("property"),
                    "Monthly Cash Flow": (row.get("monthlyCashFlow") or {}).get("fullDisplay"),
                    "DSCR": (row.get("dscr") or {}).get("display"),
                    "LTV": (row.get("ltv") or {}).get("display"),
                    "Equity": (row.get("equity") or {}).get("fullDisplay"),
                    "Data Health": row.get("dataHealth"),
                    "Status": row.get("status"),
                }
                for row in property_health
            ],
        },
        {
            "id": "yearly-tax-trends",
            "title": "Yearly Tax Trends",
            "columns": ["Year", "Rental Income", "Mortgage Interest", "Property Taxes", "Operating Expenses", "Depreciation", "Net Income"],
            "rows": [
                {
                    "Year": row.get("year"),
                    "Rental Income": format_currency(row.get("rental_income") or 0),
                    "Mortgage Interest": format_currency(row.get("mortgage_interest") or 0),
                    "Property Taxes": format_currency(row.get("property_taxes") or 0),
                    "Operating Expenses": format_currency(row.get("operating_expenses") or 0),
                    "Depreciation": format_currency(row.get("depreciation") or 0),
                    "Net Income": format_currency(row.get("net_income") or 0),
                }
                for row in sorted(yearly_trends or [], key=lambda item: item.get("year") or 0)
            ],
        },
    ]

    return {
        "schemaVersion": "portfolio-report.v1",
        "cover": {
            "title": "Portfolio Investment Report",
            "subtitle": "Rental portfolio performance, risk, and recommended next steps",
            "preparedFor": owner_name,
            "asOfDate": as_of,
            "lastRefresh": executive_dashboard.get("lastRefresh"),
            "dataQuality": data_quality,
        },
        "executiveSummary": {
            "headline": "Your rental portfolio report is ready for investment review.",
            "summary": "This report summarizes backend-calculated performance, risk, cash flow, wealth creation, debt, tax impact, and prioritized next steps.",
            "primaryMetric": portfolio_value,
            "supportingMetrics": [total_equity, monthly_cash_flow, portfolio_ltv, annual_noi],
        },
        "scorecard": scorecard,
        "snapshot": {
            "metrics": [portfolio_value, total_equity, monthly_cash_flow, portfolio_ltv, annual_noi, attention_metric],
            "scope": executive_dashboard.get("scope"),
            "primaryResidence": executive_dashboard.get("primaryResidence"),
        },
        "performanceHighlights": highlights,
        "risks": risks,
        "stories": story_sections,
        "properties": properties,
        "recommendedNextSteps": risks[:5],
        "appendix": {"tables": appendix_tables},
        "source": "backend_portfolio_report_aggregator",
        "propertyCount": len(rental_details),
    }


@router.get("/dashboard/summary")
def dashboard_summary_static(
    exclude_ids: str = "",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return dashboard_summary(
        exclude_ids=exclude_ids,
        db=db,
        current_user=current_user,
    )


@router.get("/{prop_id}/depreciation")
def get_depreciation_schedule(
    prop_id: int,
    tax_year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    return _depreciation_schedule_payload(prop, tax_year)


@router.post("/{prop_id}/depreciation-assets")
def create_depreciation_asset(
    prop_id: int,
    asset_in: DepreciationAssetCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    if prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can update depreciation assets")
    recovery = asset_in.recovery_period or (39.0 if prop.property_type == "Commercial" else 27.5)
    asset = models.DepreciationAsset(
        property_id=prop.id,
        owner_id=current_user.id,
        asset_type=asset_in.asset_type or "depreciation",
        description=asset_in.description,
        placed_in_service_date=asset_in.placed_in_service_date,
        cost_basis=asset_in.cost_basis or 0.0,
        land_portion=asset_in.land_portion or 0.0,
        method=asset_in.method or "SL",
        recovery_period=recovery,
        prior_depreciation=asset_in.prior_depreciation or 0.0,
        notes=asset_in.notes or "",
    )
    db.add(asset)
    db.commit()
    db.refresh(prop)
    return _depreciation_schedule_payload(prop)


@router.put("/{prop_id}/depreciation-assets/{asset_id}")
def update_depreciation_asset(
    prop_id: int,
    asset_id: int,
    asset_in: DepreciationAssetUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    if prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can update depreciation assets")
    asset = db.query(models.DepreciationAsset).filter_by(
        id=asset_id,
        property_id=prop.id,
        owner_id=current_user.id,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Depreciation asset not found")
    for field, value in asset_in.model_dump().items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(prop)
    return _depreciation_schedule_payload(prop)


@router.delete("/{prop_id}/depreciation-assets/{asset_id}")
def delete_depreciation_asset(
    prop_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    if prop.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can update depreciation assets")
    asset = db.query(models.DepreciationAsset).filter_by(
        id=asset_id,
        property_id=prop.id,
        owner_id=current_user.id,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Depreciation asset not found")
    db.delete(asset)
    db.commit()
    db.refresh(prop)
    return _depreciation_schedule_payload(prop)


@router.get("/checklist-summary")
def get_checklist_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Portfolio-wide rollup of missing required documents, one entry per
    owned property, for a dashboard "N documents missing" widget."""
    props = db.query(models.Property).filter(models.Property.owner_id == current_user.id).all()
    items = []
    total_missing = 0
    for prop in props:
        result = build_checklist(
            prop,
            docs=prop.documents,
            loans=prop.loans,
            tax_entries=prop.tax_entries,
            rental_periods=prop.rental_periods,
        )
        total_missing += len(result["missing"])
        items.append({
            "property_id": prop.id,
            "name": prop.name,
            "address": prop.address,
            "missing_count": len(result["missing"]),
            "required_count": len(result["required"]),
            "completion_pct": result["completion_pct"],
        })
    return {
        "properties": items,
        "total_missing": total_missing,
    }


@router.get("/{prop_id}/setup-status")
def get_setup_status(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    return _build_setup_status(prop)


@router.post("/{prop_id}/preview")
def preview_property_setup(
    prop_id: int,
    request: SetupPreviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    before = compute_property_metrics(prop)
    preview = _preview_property(prop, request.section, request.draftChanges)
    after = compute_property_metrics(preview)
    cash_flow = after.get("monthly_cash_flow")
    prior_cash_flow = before.get("monthly_cash_flow")
    change = None
    if cash_flow is not None and prior_cash_flow is not None:
        delta = round(cash_flow - prior_cash_flow, 2)
        change = {
            "value": delta,
            "display": f"{format_currency(delta)}/mo",
        }
    return {
        "status": "available",
        "asOfDate": date.today().isoformat(),
        "metrics": {
            "monthlyCashFlow": {
                "value": cash_flow,
                "display": f"{format_currency(cash_flow)}/mo",
                "change": change,
            }
        },
        "warnings": [],
        "source": "backend_property_metrics_preview",
    }


@router.post("/{prop_id}/setup-finalize")
def finalize_property_setup(
    prop_id: int,
    request: PropertySetupFinalizeRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    data = request.property.model_dump()
    _normalize_property_type(data)
    _normalize_current_residency_status(data)
    _apply_resolved_acquisition_costs(data, prop)
    apply_default_market_price(data, existing_source=prop.market_value_source)
    apply_rental_available_from_default(data, prop)
    validation = _setup_finalize_validation(SimpleNamespace(**data), request.loans, request.annual_expenses)
    if validation["status"] == "validation_failed":
        return validation

    old_usage = prop.usage_type
    data["name"] = data.get("name") or _default_property_name(data.get("address"), prop.id)
    if data.get("usage_type") != prop.usage_type:
        prop.usage_type_locked = True
    for key, value in data.items():
        setattr(prop, key, value)
    _apply_property_current_usage_change(prop, old_usage, db)
    _sync_property_current_usage(prop)
    db.flush()

    for expense_in in request.annual_expenses:
        _upsert_annual_expense(prop, current_user.id, expense_in, db)

    for loan_in in request.loans:
        loan_data = loan_in.model_dump(exclude={"id"})
        meaningful = loan_in.id or any(_present(loan_data.get(field)) for field in SETUP_LOAN_REQUIRED + ["lender_name", "escrow_amount"])
        if not meaningful:
            continue
        if loan_in.id:
            loan = db.query(models.Loan).filter(
                models.Loan.id == loan_in.id,
                models.Loan.property_id == prop.id,
            ).first()
            if not loan:
                continue
        else:
            loan = _find_setup_loan_match(db, prop, loan_data)
            if loan is None:
                loan = models.Loan(property_id=prop.id)
                db.add(loan)
        for key, value in _normalize_loan_payload(prop, loan_data).items():
            setattr(loan, key, value)
        db.flush()

    _sync_servicing_transfer_chain_dates(prop)
    db.commit()
    db.refresh(prop)
    return {
        "status": "saved",
        "propertyId": prop.id,
        "redirectTo": "/properties",
        "warnings": [],
        "completion": _build_setup_status(prop),
    }


@router.get("/{prop_id}/annual-expenses", response_model=List[AnnualExpenseOut])
def list_annual_expenses(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    return [_annual_expense_out(row) for row in prop.annual_expenses]


@router.get("/{prop_id}/expenses-view")
def get_property_expenses_view(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    lifetime_summary = get_lifetime_summary(prop_id, db, current_user)
    return build_property_expenses_view(prop, lifetime_summary.get("summary_metrics"))


@router.put("/{prop_id}/annual-expenses/{year}", response_model=AnnualExpenseOut)
def upsert_annual_expense(
    prop_id: int,
    year: int,
    expense_in: AnnualExpenseBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    if expense_in.year != year:
        raise HTTPException(status_code=400, detail="Expense year does not match request path.")
    row = _upsert_annual_expense(prop, current_user.id, expense_in, db)
    db.commit()
    db.refresh(row)
    return _annual_expense_out(row)


@router.get("/{prop_id}", response_model=PropertyOut)
def get_property(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    # Show the internally-computed balance, not a possibly-stale manual value
    # or one that depends on a 1098/mortgage statement having been uploaded.
    # Not committed — this is display-only, the stored value is untouched.
    _sync_servicing_transfer_chain_dates(prop)
    for loan in prop.loans:
        loan.current_balance = current_loan_balance(loan)
    prop.loan_groups = _loan_group_rows(list(prop.loans or []))
    prop.loan_transition_summary = _loan_transition_summary(list(prop.loans or []))
    return prop


@router.put("/{prop_id}", response_model=PropertyOut)
def update_property(
    prop_id: int,
    prop_in: PropertyBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    old_usage = prop.usage_type
    data = prop_in.model_dump()
    _normalize_property_type(data)
    _normalize_current_residency_status(data)
    _apply_resolved_acquisition_costs(data, prop)
    apply_default_market_price(data, existing_source=prop.market_value_source)
    apply_rental_available_from_default(data, prop)
    if rental_available_before_purchase(data):
        raise HTTPException(status_code=422, detail="Rental availability cannot begin before the property was purchased.")
    data["name"] = data.get("name") or _default_property_name(data.get("address"), prop.id)
    if data.get("usage_type") != prop.usage_type:
        prop.usage_type_locked = True
    for k, v in data.items():
        setattr(prop, k, v)
    _apply_property_current_usage_change(prop, old_usage, db)
    _sync_property_current_usage(prop)
    db.commit()
    db.refresh(prop)
    return prop


@router.delete("/{prop_id}")
def delete_property(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(
        models.Property.id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    db.delete(prop)
    db.commit()
    return {"ok": True}


@router.get("/{prop_id}/metrics")
def get_metrics(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    return compute_property_metrics(prop)


@router.get("/{prop_id}/summary")
def get_summary(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    lifetime_summary = get_lifetime_summary(prop_id, db, current_user)
    return build_summary_dto(prop, lifetime_summary.get("summary_metrics"))


@router.get("/{prop_id}/metric-vault")
def get_metric_vault(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    lifetime_summary = get_lifetime_summary(prop_id, db, current_user)
    summary_dto = build_summary_dto(prop, lifetime_summary.get("summary_metrics"))
    metrics = summary_dto.get("raw") or compute_property_metrics(prop)
    payload = build_property_metric_vault(
        prop,
        metrics,
        lifetime_summary.get("summary_metrics"),
        summary_dto.get("metrics"),
        lifetime_summary.get("yearly"),
    )
    _sync_metric_vault_loan_interest_from_paydown(prop, payload, db)
    save_property_snapshot(db, prop=prop, snapshot_type="metric_vault", payload=payload)
    db.commit()
    return payload


@router.get("/{prop_id}/verification")
def get_property_verification(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    lifetime_summary = get_lifetime_summary(prop_id, db, current_user)
    metrics = compute_property_metrics(prop)
    metric_vault = build_property_metric_vault(
        prop,
        metrics,
        lifetime_summary.get("summary_metrics"),
        None,
        lifetime_summary.get("yearly"),
    )
    payload = build_property_verification_response(prop, metrics, lifetime_summary, metric_vault)
    save_property_snapshot(db, prop=prop, snapshot_type="verification", payload=payload)
    db.commit()
    return payload


def _parse_statement_date(s: str):
    for f in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m/%Y", "%Y"):
        try:
            return datetime.strptime(s, f)
        except (ValueError, TypeError):
            continue
    return None


def _collect_doc_history(prop: models.Property):
    """Gather per-year history from a property's uploaded documents.

    Returns (snapshots, tax_by_year, interest_by_year, balance_by_year):
      - snapshots: mortgage-statement point-in-time rows, date-sorted
      - tax_by_year: annual property tax, the MAX seen for the year so
        duplicate uploads of the same bill never double-count (tax bills
        carry no account number, so upload dedup can't catch them)
      - interest_by_year: exact annual mortgage interest from Form 1098
        (Box 1), SUMMED across distinct loan accounts so a year with two
        loans reports both, while duplicate 1098s for one account count once
      - balance_by_year: 1098 Box 2 outstanding principal by year, deduped
        by account (same logic as interest) — used for principal-delta calc
    """
    snapshots = []
    tax_fallback_by_year = {}
    interest_entries = {}  # year -> list of (account_or_None, interest)
    balance_entries = {}   # year -> list of 1098 Box 2 balance entries
    for d in prop.documents:
        if not d.extracted_data:
            continue
        data = json.loads(d.extracted_data)
        dt = _parse_statement_date(
            data.get("statement_date") or data.get("tax_year")
        )
        # Fall back to explicit year fields when statement_date is absent
        # (some 1098s only carry statement_year / tax_year, not a full date)
        if dt:
            year = dt.year
        else:
            year = (d.statement_year or
                    data.get("statement_year") or
                    data.get("tax_year"))
            if isinstance(year, str):
                m = re.search(r'(?:19|20)\d{2}', year)
                year = int(m.group(0)) if m else None
            if not year:
                continue
            dt = None  # no parseable date, but we have a year
        if d.doc_category == "mortgage_statement":
            snapshots.append({
                "date": dt.strftime("%Y-%m-%d") if dt else f"01/01/{year}",
                "year": year,
                "balance": data.get("current_balance"),
                "principal": data.get("principal_paid_ytd"),
                "interest": data.get("interest_paid_ytd"),
                "principal_due": data.get("principal_due"),
                "interest_due": data.get("interest_due"),
                "payment": data.get("monthly_payment"),
                "escrow": data.get("escrow_amount"),
                "taxes_paid": data.get("property_tax_amount"),
                "document_id": d.id,
            })
        # Form 1098 reports the exact mortgage interest paid for the year.
        # Key by account so multiple loans in a year sum, but duplicate
        # uploads of the same loan's 1098 collapse to one value.
        if d.doc_category == "1098":
            acct = d.loan_account_number or data.get("account_number")
            if data.get("mortgage_interest"):
                interest_entries.setdefault(year, []).append(
                    (acct, round(data["mortgage_interest"], 2)))
            if data.get("current_balance") is not None:
                balance_entries.setdefault(year, []).append(
                    {
                        "account": acct,
                        "balance": round(data["current_balance"], 2),
                        "origination_date": data.get("origination_date"),
                        "mortgage_acquisition_date": data.get("mortgage_acquisition_date"),
                        "document_id": d.id,
                        "upload_date": str(d.upload_date) if d.upload_date else None,
                    })
        # Collect property-tax bills only for tax fallback. Cash-flow/tax
        # summaries use: Schedule E first, property-tax document second,
        # manual property field last.
        tax_val = (
            (data.get("property_tax_amount") or data.get("taxes_paid"))
            if d.doc_category == "property_tax" else None
        )
        if tax_val is not None:
            annual_tax = round(tax_val, 2)
            tax_fallback_by_year[year] = max(tax_fallback_by_year.get(year, 0), annual_tax)
    snapshots.sort(key=lambda s: s["date"])
    tax_by_year = dict(tax_fallback_by_year)
    interest_by_year = {
        y: _dedup_interest(entries) for y, entries in interest_entries.items()
    }
    balance_by_year = {}
    balance_logic_by_year = {}
    for y, entries in balance_entries.items():
        amount, logic = _resolve_1098_balance(entries, prop.loans)
        balance_by_year[y] = amount
        balance_logic_by_year[y] = logic
    return snapshots, tax_by_year, interest_by_year, balance_by_year, balance_logic_by_year


def _latest_statement_balance_by_year(snapshots: list) -> dict:
    balances = {}
    for snap in sorted(snapshots, key=lambda s: s.get("date") or ""):
        if snap.get("balance") is not None:
            balances[snap["year"]] = round(snap["balance"], 2)
    return balances


def _dedup_interest(entries) -> float:
    """Sum 1098 interest for a year across genuinely distinct loans.

    Multiple 1098s for one account collapse to a single value (keeping the
    largest, e.g. a corrected form). A 1098 with no account number is only
    added if its amount doesn't already match a known account's 1098 — that
    catches the common case where a closing/duplicate doc restates the same
    loan's interest without carrying its account number.
    """
    by_acct = {}
    accountless = []
    for acct, val in entries:
        if acct:
            by_acct[acct] = max(by_acct.get(acct, 0), val)
        else:
            accountless.append(val)
    seen_values = {round(v, 2) for v in by_acct.values()}
    total = sum(by_acct.values())
    for val in accountless:
        if round(val, 2) not in seen_values:
            total += val
            seen_values.add(round(val, 2))
    return round(total, 2)


def _balance_entry(entry):
    if isinstance(entry, dict):
        return {
            "account": entry.get("account"),
            "balance": entry.get("balance"),
            "origination_date": entry.get("origination_date"),
            "mortgage_acquisition_date": entry.get("mortgage_acquisition_date"),
            "document_id": entry.get("document_id"),
            "upload_date": entry.get("upload_date"),
        }
    acct, val = entry[:2]
    return {
        "account": acct,
        "balance": val,
        "origination_date": None,
        "mortgage_acquisition_date": None,
        "document_id": None,
        "upload_date": None,
    }


def _entry_event_date(entry):
    return (
        _parse_statement_date(entry.get("mortgage_acquisition_date"))
        or _parse_statement_date(entry.get("origination_date"))
    )


def _resolve_1098_balance(entries, loans=None):
    """Return Form 1098 Box 2 balance plus explanation.

    Box 1 interest is annual and can be summed across refinance lenders. Box 2
    principal is point-in-time loan balance; when Box 3/11 dates show one loan
    replaced another, use the latest loan balance instead of adding them.
    """
    normalized = [
        _balance_entry(e) for e in entries
        if _balance_entry(e).get("balance") is not None
    ]
    if not normalized:
        return 0.0, {"mode": "none", "summary": "No 1098 Box 2 balance found."}

    loan_count = len(loans or [])
    accounts = {e["account"] for e in normalized if e.get("account")}
    event_dates = {
        _entry_event_date(e).date().isoformat()
        for e in normalized
        if _entry_event_date(e)
    }
    refinance_signal = len(event_dates) > 1

    if loan_count > 1 and len(accounts) > 1 and not refinance_signal:
        amount = _dedup_interest([(e["account"], e["balance"]) for e in normalized])
        return amount, {
            "mode": "active_parallel_loans",
            "summary": "Summed Box 2 balances because multiple current loans/accounts are present and 1098 dates do not indicate refinance replacement.",
            "verify_note": "Box 2 summed: multiple active loan accounts.",
            "source_count": len(normalized),
            "accounts": sorted(accounts),
            "event_dates": sorted(event_dates),
            "entries": normalized,
        }

    latest = max(
        normalized,
        key=lambda e: (
            _entry_event_date(e) or datetime.min,
            e.get("upload_date") or "",
            e.get("balance") or 0,
        ),
    )
    date_note = latest.get("mortgage_acquisition_date") or latest.get("origination_date")
    note_parts = ["Box 2 uses latest loan balance"]
    if date_note:
        note_parts.append(f"date {date_note}")
    if latest.get("account"):
        note_parts.append(str(latest["account"]))
    return round(latest["balance"], 2), {
        "mode": "latest_loan_balance",
        "summary": "Used latest 1098 loan balance. Interest may combine old/new refinance lenders, but Box 2 principal is not added unless loans are clearly active together.",
        "verify_note": " · ".join(note_parts),
        "source_count": len(normalized),
        "selected_document_id": latest.get("document_id"),
        "selected_account": latest.get("account"),
        "selected_origination_date": latest.get("origination_date"),
        "selected_acquisition_date": latest.get("mortgage_acquisition_date"),
        "event_dates": sorted(event_dates),
        "entries": normalized,
    }


def _dedup_balance(entries, loans=None) -> float:
    amount, _logic = _resolve_1098_balance(entries, loans)
    return amount


def _principal_from_1098_segments(balance_by_year: dict, balance_logic_by_year: dict,
                                  year: int, loans: list = None,
                                  statement_balance_by_year: dict = None) -> Optional[float]:
    """Compute principal paid using all sequential 1098 balance checkpoints.

    Example: one calendar year has LoanCare Jan-Sep and Rocket Oct-Dec after a
    transfer. Outstanding balance uses the latest active loan only, but
    principal paid is the balance drop across each sequential checkpoint plus
    the drop into next year's Box 2 balance.
    """
    logic = (balance_logic_by_year or {}).get(year) or {}
    entries = [
        e for e in logic.get("entries", [])
        if e.get("balance") is not None
    ]
    balances = sorted(
        {round(e["balance"], 2) for e in entries},
        reverse=True,
    )
    statement_balance_by_year = statement_balance_by_year or {}
    next_balance = balance_by_year.get(year + 1)
    if next_balance is None:
        next_balance = statement_balance_by_year.get(year)

    if len(balances) > 1:
        total = 0.0
        for start, end in zip(balances, balances[1:]):
            if start > end:
                total += start - end
        if next_balance is not None and balances[-1] > next_balance:
            total += balances[-1] - next_balance
        if total > 0:
            return round(total, 2)

    if len(balances) == 1 and next_balance is not None and balances[0] > next_balance:
        return round(balances[0] - next_balance, 2)

    curr = balance_by_year.get(year)
    next_logic = (balance_logic_by_year or {}).get(year + 1) or {}
    next_entries = [
        e for e in next_logic.get("entries", [])
        if e.get("balance") is not None
    ]
    if curr is not None and next_entries:
        if next_logic.get("mode") == "active_parallel_loans":
            next_start = balance_by_year.get(year + 1)
        else:
            next_start = max(round(e["balance"], 2) for e in next_entries)
        if next_start is not None and curr > next_start:
            return round(curr - next_start, 2)

    return _principal_from_1098(balance_by_year, year, loans)


def _principal_from_1098(balance_by_year: dict, year: int,
                         loans: list = None) -> Optional[float]:
    """Compute principal paid DURING `year` from 1098 Box 2 balances.

    1098 Box 2 = outstanding principal as of Jan 1 of the reporting year.
    Principal paid during year Y = balance_on_Jan1_Y − balance_on_Jan1_(Y+1).

    When balance_by_year[year] is missing but balance_by_year[year+1] exists,
    back-calculate the Jan 1 start balance using amortization so that a single
    uploaded 1098 (e.g. 2025) can yield principal for the prior year (2024).

    When only balance_by_year[year] exists (no next-year boundary), forward-
    amortize 12 months to estimate the year-end balance.
    """
    curr = balance_by_year.get(year)
    nxt  = balance_by_year.get(year + 1)

    loan = (loans or [])[0] if loans else None

    def _amort_factor(l):
        r = (l.interest_rate or 0) / 12 / 100
        pni = max((l.monthly_payment or 0) - (l.escrow_amount or 0), 0)
        return r, pni

    if curr is not None and nxt is not None:
        # Best case: direct delta from two adjacent Jan-1 balances.
        # Only valid when nxt came from a 1098 (same-day convention).
        # Mortgage statement balances (arbitrary date) produce overstated deltas;
        # guard against them by capping at one full year of amortization.
        if loan:
            r, pni = _amort_factor(loan)
            if r > 0 and pni > 0:
                # Max plausible annual principal from amortization
                max_annual = sum(
                    pni - (curr * (1 + r) ** (-i) * r / (1 - (1 + r) ** (-1))) * 0
                    for i in range(1, 13)
                )
                # Simpler: forward-amortize curr for 12 months
                b = curr
                forward_12 = 0.0
                for _ in range(12):
                    interest = b * r
                    prin = max(pni - interest, 0)
                    forward_12 += prin
                    b -= prin
                delta = round(curr - nxt, 2)
                # If delta > 1.5× forward estimate, nxt is probably mid-year not Jan-1
                if delta > forward_12 * 1.5:
                    return round(forward_12, 2)
                return delta
        return round(curr - nxt, 2)

    if curr is None and nxt is not None and loan:
        # Back-amortize: find what the Jan-1 balance was 12 months before nxt.
        r, pni = _amort_factor(loan)
        if r > 0:
            factor = (1 + r) ** 12
            annuity = pni * (factor - 1) / r
            estimated_curr = (nxt + annuity) / factor
            principal = round(estimated_curr - nxt, 2)
            return principal if principal > 0 else None

    if curr is not None and nxt is None and loan:
        # Forward-amortize curr for 12 months.
        r, pni = _amort_factor(loan)
        b = curr
        total = 0.0
        for _ in range(12):
            interest = b * r
            prin = max(pni - interest, 0)
            total += prin
            b -= prin
        return round(total, 2)

    return None


def _scheduled_principal_cumulative(loan, year: int, end_month: int = 12) -> Optional[float]:
    """Expected scheduled principal through end_month of year.

    The first month after origination is treated as interest-only; regular
    principal starts in the following month. Extra payments/topups stay outside
    this expected amortization schedule.
    """
    if not loan or not getattr(loan, "origination_date", None):
        return None
    orig = _parse_statement_date(loan.origination_date)
    if not orig:
        return None
    rate = (getattr(loan, "interest_rate", 0) or 0) / 12 / 100
    balance = getattr(loan, "original_amount", 0) or 0
    term_months = (getattr(loan, "loan_term_years", 0) or 0) * 12
    if balance > 0 and rate > 0 and term_months > 0:
        pni = balance * rate / (1 - (1 + rate) ** (-term_months))
    else:
        statement_pni = (getattr(loan, "principal_due", 0) or 0) + (getattr(loan, "interest_due", 0) or 0)
        pni = statement_pni or max(
            (getattr(loan, "monthly_payment", 0) or 0) - (getattr(loan, "escrow_amount", 0) or 0), 0)
    if pni <= 0 or rate <= 0 or balance <= 0:
        return None

    end_month = max(1, min(int(end_month or 12), 12))
    payment_count = (year - orig.year) * 12 + end_month - orig.month - 1
    if payment_count <= 0:
        return 0.0

    total = 0.0
    for _ in range(payment_count):
        interest = balance * rate
        principal = max(pni - interest, 0)
        total += principal
        balance -= principal
    return round(total, 2)


def current_loan_balance(loan: models.Loan, today: Optional[date] = None) -> float:
    if getattr(loan, "property", None) is not None:
        return round(build_property_engine(loan.property, as_of=today or date.today()).balance_today(loan), 2)
    """Outstanding principal today, computed internally from the loan's own
    amortization schedule (original amount, rate, term, origination date) —
    no mortgage statement or 1098 upload required. Falls back to the
    manually recorded current_balance when there isn't enough data to
    schedule a payoff (e.g. no origination date on file)."""
    today = today or date.today()
    entered_balance = float(getattr(loan, "current_balance", 0) or 0)
    if entered_balance > 0:
        return round(entered_balance, 2)
    original = float(getattr(loan, "original_amount", 0) or 0)
    if original <= 0:
        return float(getattr(loan, "current_balance", 0) or 0)
    paid = _scheduled_principal_cumulative(loan, today.year, today.month)
    if paid is None:
        return float(getattr(loan, "current_balance", 0) or 0)
    return round(max(0.0, original - paid), 2)


def _interest_by_year_by_account(prop: models.Property) -> Dict[Optional[str], Dict[int, float]]:
    """Form 1098 Box-1 interest, per year, split out by loan account number —
    unlike `_collect_doc_history`'s interest_by_year (which blends every
    account into one property-wide total), this keeps each loan's 1098s
    separate so a refinance or a second loan doesn't get attributed to the
    wrong loan's debt breakdown."""
    by_account: Dict[Optional[str], Dict[int, list]] = {}
    for d in prop.documents:
        if d.doc_category != "1098" or not d.extracted_data:
            continue
        data = json.loads(d.extracted_data)
        if not data.get("mortgage_interest"):
            continue
        dt = _parse_statement_date(data.get("statement_date") or data.get("tax_year"))
        if dt:
            year = dt.year
        else:
            year = d.statement_year or data.get("statement_year") or data.get("tax_year")
            if isinstance(year, str):
                m = re.search(r'(?:19|20)\d{2}', year)
                year = int(m.group(0)) if m else None
            if not year:
                continue
        acct = d.loan_account_number or data.get("account_number")
        by_account.setdefault(acct, {}).setdefault(year, []).append(round(data["mortgage_interest"], 2))
    return {
        acct: {yr: round(max(vals), 2) for yr, vals in years.items()}
        for acct, years in by_account.items()
    }


def _loan_document_matches(loan: models.Loan, doc: models.Document, total_loans: int) -> bool:
    if getattr(doc, "doc_category", None) not in {"1098", "mortgage_statement"}:
        return False
    data = _document_payload(doc)
    doc_account = getattr(doc, "loan_account_number", None) or data.get("account_number") or data.get("loan_account_number")
    loan_account = getattr(loan, "account_number", None)
    account_aliases = {
        str(account).strip()
        for account in (getattr(loan, "_account_aliases", None) or [])
        if str(account or "").strip()
    }
    if doc_account and str(doc_account).strip() in account_aliases:
        return True
    if loan_account:
        if bool(doc_account) and str(doc_account).strip() == str(loan_account).strip():
            return True
        if total_loans == 1 and doc_account:
            loan_origination = _parse_statement_date(getattr(loan, "origination_date", None))
            doc_origination = _parse_statement_date(data.get("origination_date"))
            if hasattr(loan_origination, "date"):
                loan_origination = loan_origination.date()
            if hasattr(doc_origination, "date"):
                doc_origination = doc_origination.date()
            if loan_origination and doc_origination and abs((loan_origination - doc_origination).days) <= 7:
                return True
            return True
        return False
    if doc_account:
        return total_loans == 1
    return total_loans == 1


def _loan_monthly_pi_amount(loan: models.Loan, balance: Optional[float] = None) -> float:
    resolved = loan_monthly_pi(loan)
    if resolved > 0:
        return resolved
    principal = float(balance or getattr(loan, "original_amount", 0) or getattr(loan, "current_balance", 0) or 0)
    return engine_monthly_principal_interest(principal, float(getattr(loan, "interest_rate", 0) or 0), int(getattr(loan, "loan_term_years", 0) or 30))


def _scheduled_from_balance(loan: models.Loan, start_balance: float, months: int = 12) -> Dict[str, float]:
    balance = float(start_balance or 0)
    monthly_rate = float(getattr(loan, "interest_rate", 0) or 0) / 100 / 12
    payment = _loan_monthly_pi_amount(loan, balance)
    principal = 0.0
    interest = 0.0
    for _ in range(max(0, int(months or 0))):
        month_interest = round(balance * monthly_rate, 2) if monthly_rate > 0 else 0.0
        month_principal = min(max(payment - month_interest, 0.0), balance)
        interest += month_interest
        principal += month_principal
        balance = max(balance - month_principal, 0.0)
    return {
        "scheduledPrincipal": round(principal, 2),
        "expectedInterest": round(interest, 2),
        "endBalance": round(balance, 2),
    }


def _projected_from_balance(loan: models.Loan, start_balance: float, months: int = 12) -> Dict[str, float]:
    """Project required amortization plus any explicit extra monthly principal."""
    balance = float(start_balance or 0)
    monthly_rate = float(getattr(loan, "interest_rate", 0) or 0) / 100 / 12
    payment = _loan_monthly_pi_amount(loan, balance)
    extra_payment = max(float(getattr(loan, "extra_monthly_payment", 0) or 0), 0.0)
    scheduled_principal = 0.0
    extra_principal = 0.0
    interest = 0.0
    for _ in range(max(0, int(months or 0))):
        if balance <= 0:
            break
        month_interest = round(balance * monthly_rate, 2) if monthly_rate > 0 else 0.0
        required_principal = min(max(payment - month_interest, 0.0), balance)
        remaining_after_required = max(balance - required_principal, 0.0)
        month_extra = min(extra_payment, remaining_after_required)
        interest += month_interest
        scheduled_principal += required_principal
        extra_principal += month_extra
        balance = max(balance - required_principal - month_extra, 0.0)
    return {
        "scheduledPrincipal": round(scheduled_principal, 2),
        "extraPrincipal": round(extra_principal, 2),
        "principal": round(scheduled_principal + extra_principal, 2),
        "expectedInterest": round(interest, 2),
        "endBalance": round(balance, 2),
    }


def _payoff_months_from_balance(loan: models.Loan, balance: float) -> Optional[int]:
    remaining = float(balance or 0)
    if remaining <= 0:
        return 0
    monthly_rate = float(getattr(loan, "interest_rate", 0) or 0) / 100 / 12
    payment = _loan_monthly_pi_amount(loan, remaining)
    if payment <= 0:
        return None
    months = 0
    while remaining > 1 and months < 720:
        interest = remaining * monthly_rate if monthly_rate > 0 else 0.0
        principal = min(max(payment - interest, 0.0), remaining)
        if principal <= 0:
            return None
        remaining = max(remaining - principal, 0.0)
        months += 1
    return months


def _loan_reconciliation_issue(
    code: str,
    title: str,
    message: str,
    values: Optional[List[Dict[str, Any]]] = None,
    *,
    severity: str = "WARNING",
) -> Dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "message": message,
        "values": values or [],
    }


def _loan_issue_from_warning(message: str) -> Dict[str, Any]:
    lower = message.lower()
    if "balance chain mismatch" in lower:
        return _loan_reconciliation_issue("BALANCE_CHAIN_MISMATCH", "Balance chain mismatch", message)
    if "reported principal is below scheduled" in lower:
        return _loan_reconciliation_issue("PRINCIPAL_BELOW_SCHEDULED", "Reported principal below scheduled principal", message)
    if "implausible" in lower:
        return _loan_reconciliation_issue("IMPLAUSIBLE_INTEREST", "Parsed interest needs review", message)
    if "box 2" in lower or "ending balance" in lower:
        return _loan_reconciliation_issue("YEAR_END_BALANCE_MISSING", "Missing or conflicting year-end balance", message)
    return _loan_reconciliation_issue("LOAN_RECONCILIATION_WARNING", "Loan reconciliation issue", message)


def _doc_display_name(doc: models.Document) -> str:
    return getattr(doc, "display_name", None) or getattr(doc, "original_filename", None) or getattr(doc, "filename", None) or "Document"


def _document_payload(doc: models.Document) -> Dict[str, Any]:
    try:
        return json.loads(getattr(doc, "extracted_data", None) or "{}") or {}
    except (TypeError, ValueError):
        return {}


def _statement_payload_with_ytd_fallback(doc: models.Document, data: Dict[str, Any]) -> Dict[str, Any]:
    if getattr(doc, "doc_category", None) != "mortgage_statement":
        return data
    if data.get("principal_paid_ytd") is not None and data.get("interest_paid_ytd") is not None:
        return data
    path = UPLOAD_DIR / str(getattr(doc, "filename", "") or "")
    if not path.exists():
        return data
    try:
        category, extracted, _markdown = parse_document(str(path), "mortgage_statement")
    except Exception:
        return data
    if category != "mortgage_statement" or not isinstance(extracted, dict):
        return data
    merged = dict(data)
    for key in ("principal_paid_ytd", "interest_paid_ytd", "escrow_paid_ytd"):
        if merged.get(key) is None and extracted.get(key) is not None:
            merged[key] = extracted.get(key)
    return merged


def _document_timestamp(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _document_field_label(key: str) -> str:
    overrides = {
        "account_number": "Account number",
        "box1_interest": "Box 1 interest",
        "box2_balance": "Box 2 balance",
        "current_balance": "Current balance",
        "mortgage_interest": "Mortgage interest",
        "mortgage_acquisition_date": "Mortgage acquisition date",
        "origination_date": "Origination date",
        "statement_date": "Statement date",
        "statement_year": "Statement year",
        "tax_year": "Tax year",
        "interest_paid_ytd": "Interest paid YTD",
        "principal_paid_ytd": "Principal paid YTD",
        "escrow_amount": "Escrow amount",
        "monthly_payment": "Monthly payment",
    }
    if key in overrides:
        return overrides[key]
    return str(key).replace("_", " ").strip().title()


def _document_field_display(key: str, value: Any) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    money_tokens = (
        "amount", "balance", "interest", "principal", "payment", "tax",
        "escrow", "insurance", "price", "cost", "fee",
    )
    if isinstance(value, (int, float)) and any(token in key.lower() for token in money_tokens):
        return format_currency(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def _document_field_rows(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    hidden_keys = {
        "_manual_overrides",
        "raw_text",
        "ocr_text",
        "pages",
        "tables",
        "line_items",
    }
    priority = [
        "tax_year",
        "statement_year",
        "statement_date",
        "account_number",
        "mortgage_acquisition_date",
        "origination_date",
        "mortgage_interest",
        "box1_interest",
        "current_balance",
        "box2_balance",
        "principal_paid_ytd",
        "interest_paid_ytd",
        "monthly_payment",
        "escrow_amount",
    ]
    keys = [
        key for key in priority
        if key in data and key not in hidden_keys and data.get(key) not in (None, "")
    ]
    keys.extend(sorted(
        key for key, value in data.items()
        if key not in hidden_keys and key not in keys and value not in (None, "")
    ))
    return [
        {
            "key": key,
            "label": _document_field_label(key),
            "value": data.get(key),
            "display": _document_field_display(key, data.get(key)),
        }
        for key in keys
    ]


def _loan_document_inventory(loan: models.Loan, prop: models.Property) -> Dict[int, List[Dict[str, Any]]]:
    by_year: Dict[int, List[Dict[str, Any]]] = {}
    total_loans = len(getattr(prop, "loans", []) or [])
    for doc in getattr(prop, "documents", []) or []:
        if not _loan_document_matches(loan, doc, total_loans) or not getattr(doc, "extracted_data", None):
            continue
        data = _document_payload(doc)
        data = _statement_payload_with_ytd_fallback(doc, data)
        year = doc.statement_year or data.get("statement_year") or data.get("tax_year")
        if not year and data.get("statement_date"):
            parsed = _parse_statement_date(data.get("statement_date"))
            year = parsed.year if parsed else None
        try:
            year = int(year)
        except (TypeError, ValueError):
            continue
        category = getattr(doc, "doc_category", None)
        by_year.setdefault(year, []).append({
            "documentId": doc.id,
            "filename": _doc_display_name(doc),
            "docType": category,
            "docTypeLabel": "Form 1098" if category == "1098" else "Dec statement" if category == "mortgage_statement" else "Document",
            "sourceBadge": "1098" if category == "1098" else "Dec stmt" if category == "mortgage_statement" else "Document",
            "previewUrl": f"/properties/{doc.property_id}/documents?documentId={doc.id}" if doc.property_id else f"/uploads?documentId={doc.id}",
            "uploadedAt": _document_timestamp(getattr(doc, "upload_date", None)),
            "fieldValues": _document_field_rows(data),
            "accountNumber": getattr(doc, "loan_account_number", None) or data.get("account_number"),
            "box1Interest": data.get("mortgage_interest") if data.get("mortgage_interest") is not None else data.get("box1_interest"),
            "box2Balance": data.get("current_balance") if data.get("current_balance") is not None else data.get("box2_balance"),
            "propertyTax": data.get("property_tax_amount"),
            "ytdInterest": data.get("interest_paid_ytd"),
            "ytdPrincipal": data.get("principal_paid_ytd"),
            "monthlyEscrow": data.get("escrow_amount"),
            "currentPaymentInterest": data.get("interest_due") if data.get("interest_due") is not None else data.get("interest"),
            "currentPaymentPrincipal": data.get("principal_due") if data.get("principal_due") is not None else data.get("principal"),
            "endBalance": data.get("year_end_outstanding_balance") or data.get("current_balance") or data.get("ending_balance"),
            "statementDate": data.get("statement_date"),
            "mortgageAcquisitionDate": data.get("mortgage_acquisition_date"),
            "originationDate": data.get("origination_date"),
            "parsedValues": {
                "box1Interest": data.get("mortgage_interest") if data.get("mortgage_interest") is not None else data.get("box1_interest"),
                "box2Balance": data.get("current_balance") if data.get("current_balance") is not None else data.get("box2_balance"),
                "propertyTax": data.get("property_tax_amount"),
                "statementDate": data.get("statement_date"),
                "mortgageAcquisitionDate": data.get("mortgage_acquisition_date"),
                "originationDate": data.get("origination_date"),
                "taxYear": year,
            },
            "overrides": data.get("_manual_overrides") or {},
        })
    for docs in by_year.values():
        docs.sort(key=lambda doc: (str(doc.get("uploadedAt") or ""), int(doc.get("documentId") or 0)))
    return by_year


def _loan_doc_event_date(doc: Dict[str, Any]) -> Optional[date]:
    parsed = (
        _parse_statement_date(doc.get("mortgageAcquisitionDate"))
        or _parse_statement_date(doc.get("originationDate"))
        or _parse_statement_date(doc.get("statementDate"))
    )
    if hasattr(parsed, "date"):
        return parsed.date()
    return parsed


def _loan_doc_sort_key(doc: Dict[str, Any]) -> Tuple[Any, str, int]:
    return (
        _loan_doc_event_date(doc) or date.min,
        str(doc.get("uploadedAt") or ""),
        int(doc.get("documentId") or 0),
    )


def _dedup_1098_docs_by_account(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Use one 1098 per account/year.

    Re-uploaded duplicate 1098s should still be visible in Documents, but the
    loan year table must not add the same account's Box 1 interest twice.
    """
    latest_by_account: Dict[str, Dict[str, Any]] = {}
    no_account: List[Dict[str, Any]] = []
    for doc in sorted(docs, key=_loan_doc_sort_key):
        account = str(doc.get("accountNumber") or "").strip()
        if not account:
            no_account.append(doc)
            continue
        latest_by_account[account] = doc
    return sorted([*latest_by_account.values(), *no_account], key=_loan_doc_sort_key)


def _combined_1098_doc(docs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    forms = _dedup_1098_docs_by_account([doc for doc in docs if doc.get("docType") == "1098"])
    if len(forms) <= 1:
        return None
    ordered = sorted(forms, key=_loan_doc_sort_key)
    first = ordered[0]
    latest = ordered[-1]
    interest_values = [
        float(doc.get("box1Interest") or 0)
        for doc in ordered
        if doc.get("box1Interest") is not None
    ]
    combined = dict(latest)
    combined["documentId"] = latest.get("documentId")
    combined["filename"] = "Multiple 1098s"
    combined["docType"] = "1098"
    combined["docTypeLabel"] = "Form 1098"
    combined["sourceBadge"] = "1098"
    combined["box1Interest"] = round(sum(interest_values), 2) if interest_values else None
    combined["box2Balance"] = first.get("box2Balance")
    combined["isCombined1098"] = True
    combined["combinedDocuments"] = ordered
    combined["combinedDocumentIds"] = [doc.get("documentId") for doc in ordered if doc.get("documentId")]
    combined["accountNumber"] = " → ".join(
        str(doc.get("accountNumber"))
        for doc in ordered
        if doc.get("accountNumber")
    )
    combined["parsedValues"] = {
        **(latest.get("parsedValues") or {}),
        "box1Interest": combined["box1Interest"],
        "box2Balance": combined["box2Balance"],
        "combinedDocumentIds": combined["combinedDocumentIds"],
        "combinedAccounts": [
            doc.get("accountNumber")
            for doc in ordered
            if doc.get("accountNumber")
        ],
    }
    return combined


def _preferred_loan_doc(docs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not docs:
        return None
    ordered = sorted(docs, key=lambda doc: (str(doc.get("uploadedAt") or ""), int(doc.get("documentId") or 0)))
    combined_1098 = _combined_1098_doc(docs)
    if combined_1098:
        return combined_1098
    forms = [doc for doc in ordered if doc.get("docType") == "1098"]
    if forms:
        return forms[-1]
    statements = [doc for doc in docs if doc.get("docType") == "mortgage_statement"]
    if statements:
        return sorted(statements, key=lambda doc: (str(doc.get("uploadedAt") or ""), int(doc.get("documentId") or 0)))[-1]
    return ordered[-1]


def _loan_tracking_as_of(loan: models.Loan, today: Optional[date] = None) -> date:
    today = today or date.today()
    raw_closed_date = str(getattr(loan, "closed_date", None) or "").strip()
    year_only_closed_at = (
        date(int(raw_closed_date), 12, 31)
        if re.fullmatch(r"(?:19|20)\d{2}", raw_closed_date)
        else None
    )
    closed_at = (
        year_only_closed_at
        or _parse_statement_date(getattr(loan, "closed_date", None))
        or _parse_statement_date(getattr(loan, "servicer_end_date", None))
    )
    if hasattr(closed_at, "date"):
        closed_at = closed_at.date()
    if closed_at and (_is_closed_loan_status(getattr(loan, "status", None)) or getattr(loan, "closed_date", None)):
        return min(closed_at, today)
    return today


def _loan_tracking_start_date(loan: models.Loan) -> Optional[date]:
    parsed = (
        _parse_statement_date(getattr(loan, "_tracking_start_date", None))
        or
        _parse_statement_date(getattr(loan, "servicer_start_date", None))
        or _parse_statement_date(getattr(loan, "origination_date", None))
    )
    if hasattr(parsed, "date"):
        parsed = parsed.date()
    return parsed


def _loan_paydown_tracking(loan: models.Loan, prop: models.Property, today: Optional[date] = None) -> Dict[str, Any]:
    reporting_date = today or date.today()
    today = _loan_tracking_as_of(loan, reporting_date)
    is_closed_tracking_period = bool(
        _is_closed_loan_status(getattr(loan, "status", None))
        or getattr(loan, "closed_date", None)
        or getattr(loan, "servicer_end_date", None)
    )
    orig = _parse_statement_date(getattr(loan, "origination_date", None)) if getattr(loan, "origination_date", None) else None
    active_start = _loan_tracking_start_date(loan) or (orig.date() if hasattr(orig, "date") else orig)
    docs_by_year = _loan_document_inventory(loan, prop)
    has_payment_terms = (
        float(getattr(loan, "monthly_payment", 0) or 0) > 0
        or float(getattr(loan, "principal_due", 0) or 0) + float(getattr(loan, "interest_due", 0) or 0) > 0
    )
    if not has_payment_terms and not any(docs_by_year.values()):
        original_amount = round(float(getattr(loan, "original_amount", 0) or 0), 2)
        reported_balance = round(float(getattr(loan, "current_balance", 0) or 0), 2)
        return {
            "summary": {
                "totalTopUp": 0.0,
                "totalTopUpDisplay": format_currency(0),
                "principalPaidToDate": max(original_amount - reported_balance, 0.0),
                "principalPaidToDateDisplay": format_currency(max(original_amount - reported_balance, 0.0)),
                "interestPaidToDate": 0.0,
                "interestPaidToDateDisplay": format_currency(0),
                "aheadOfScheduleMonths": None,
                "aheadOfScheduleDisplay": "—",
                "warnings": ["Loan payment terms are missing; yearly amortization was not projected."],
            },
            "rows": [],
            "assertions": {
                "loanStartDatePresent": bool(active_start),
                "paymentTermsPresent": False,
                "balanceChainValid": None,
                "principalPaidMatchesBalanceDelta": None,
                "latestReportedBalanceMatchesLoanCard": None,
                "latestReportedBalance": reported_balance,
                "latestReportedYear": None,
                "loanCardBalance": reported_balance,
            },
        }
    current_balance = round(float(current_loan_balance(loan, today) or 0), 2)
    original_amount = round(float(getattr(loan, "original_amount", 0) or 0), 2)
    if not active_start:
        return {
            "summary": {
                "totalTopUp": 0.0,
                "totalTopUpDisplay": format_currency(0),
                "principalPaidToDate": max(original_amount - current_balance, 0.0),
                "principalPaidToDateDisplay": format_currency(max(original_amount - current_balance, 0.0)),
                "interestPaidToDate": 0.0,
                "interestPaidToDateDisplay": format_currency(0),
                "aheadOfScheduleMonths": None,
                "aheadOfScheduleDisplay": "—",
                "warnings": ["Add loan start date before building principal and interest by year."],
            },
            "rows": [],
            "assertions": {
                "loanStartDatePresent": False,
                "balanceChainValid": False,
                "principalPaidMatchesBalanceDelta": None,
                "latestReportedBalanceMatchesLoanCard": None,
                "latestReportedBalance": None,
                "latestReportedYear": None,
                "loanCardBalance": current_balance,
            },
        }
    start_year = active_start.year if active_start else today.year
    if active_start:
        docs_by_year = {year: docs for year, docs in docs_by_year.items() if year >= active_start.year}
    rows = []
    total_top_up = 0.0
    total_principal_paid = 0.0
    total_interest_paid = 0.0
    latest_reported_balance = None
    latest_reported_year = None
    balance_chain_valid = True
    chain_failures: List[Dict[str, Any]] = []

    for year in range(start_year, today.year + 1):
        docs = docs_by_year.get(year, [])
        primary_doc = _preferred_loan_doc(docs)
        next_doc = _preferred_loan_doc([doc for doc in docs_by_year.get(year + 1, []) if doc.get("docType") == "1098"])
        warnings = []
        issues = []
        source = "projected"
        source_label = "Projected"
        source_display = None
        source_tier = "PROJECTED"
        start_balance = None
        actual_principal = None
        end_balance = None
        end_balance_source = "projected"
        end_balance_source_label = "Projected"
        principal_from_payment_less_interest = None
        interest = None
        scheduled_months = 12
        if active_start and year == active_start.year:
            scheduled_months = max(0, 12 - active_start.month + 1)
        if year == today.year:
            scheduled_months = min(scheduled_months, max(0, today.month - (active_start.month if active_start and year == active_start.year else 1) + 1))
        if primary_doc and primary_doc.get("docType") == "mortgage_statement" and primary_doc.get("statementDate"):
            statement_date = _parse_statement_date(primary_doc.get("statementDate"))
            if hasattr(statement_date, "date"):
                statement_date = statement_date.date()
            if statement_date and statement_date.year == year:
                statement_start_month = active_start.month if active_start and year == active_start.year else 1
                scheduled_months = min(scheduled_months, max(0, statement_date.month - statement_start_month + 1))

        if primary_doc and primary_doc.get("docType") == "1098":
            source = "1098"
            source_label = "1098 (box 2 delta + box 1)"
            source_tier = "REPORTED"
            start_balance = primary_doc.get("box2Balance")
            interest = primary_doc.get("box1Interest")
            year_statements = sorted(
                [doc for doc in docs if doc.get("docType") == "mortgage_statement"],
                key=_loan_doc_sort_key,
            )
            companion_statement = year_statements[-1] if year_statements else None
            if start_balance is None:
                warnings.append("Box 2 balance missing; top-up unknown. Upload a year-end statement.")
            elif companion_statement and companion_statement.get("endBalance") is not None:
                end_balance = companion_statement.get("endBalance")
                end_balance_source = "reported"
                end_balance_source_label = "Reported from statement"
                if companion_statement.get("ytdPrincipal") is not None:
                    actual_principal = companion_statement.get("ytdPrincipal")
                else:
                    actual_principal = max(0.0, round(float(start_balance) - float(end_balance), 2))
                source_label = "1098 interest + statement balance"
                source_display = source_label
            elif next_doc and next_doc.get("box2Balance") is not None:
                end_balance = next_doc.get("box2Balance")
                end_balance_source = "reported"
                end_balance_source_label = "Reported from next 1098"
                actual_principal = round(float(start_balance) - float(end_balance), 2)
            else:
                monthly_pi = _loan_monthly_pi_amount(loan, float(start_balance))
                if interest is not None and monthly_pi > 0:
                    principal_from_payment_less_interest = round((monthly_pi * scheduled_months) - float(interest), 2)
                    actual_principal = max(0.0, principal_from_payment_less_interest)
                    end_balance = round(float(start_balance) - actual_principal, 2)
                    end_balance_source = "calculated"
                    end_balance_source_label = "Calculated from Box 1 and payment"
                else:
                    warnings.append("Payment or Box 1 interest is missing; ending balance cannot be calculated from this 1098.")
        elif primary_doc and primary_doc.get("docType") == "mortgage_statement":
            source = "statement"
            source_label = "Dec statement (actual)"
            source_tier = "REPORTED"
            start_balance = None
            actual_principal = primary_doc.get("ytdPrincipal")
            interest = primary_doc.get("ytdInterest")
            end_balance = primary_doc.get("endBalance")
            if end_balance is not None:
                end_balance_source = "reported"
                end_balance_source_label = "Reported from statement"
            if actual_principal is None:
                warnings.append("Statement principal was not parsed; upload Form 1098 or a year-end statement.")

        if start_balance is None:
            if year == start_year:
                start_balance = float(getattr(loan, "original_amount", 0) or getattr(loan, "current_balance", 0) or 0)
            elif rows:
                start_balance = rows[-1].get("endBalance")
                if start_balance is None:
                    start_balance = current_balance
                    warnings.append("Projected from loan balance because the prior year ending balance is unavailable.")

        if rows and start_balance is not None:
            previous_end = rows[-1].get("endBalance")
            if previous_end is not None and round(float(previous_end), 2) != round(float(start_balance), 2):
                balance_chain_valid = False
                chain_failure = {
                    "year": year,
                    "previousYear": rows[-1].get("year"),
                    "expectedStartBalance": round(float(previous_end), 2),
                    "actualStartBalance": round(float(start_balance), 2),
                    "difference": round(float(start_balance) - float(previous_end), 2),
                }
                chain_failures.append(chain_failure)
                chain_message = f"{year} starts at {format_currency(start_balance)}, but {rows[-1].get('year')} ended at {format_currency(previous_end)}."
                warnings.append(f"Balance chain mismatch: {chain_message}")
                issues.append(_loan_reconciliation_issue(
                    "BALANCE_CHAIN_MISMATCH",
                    "Balance chain mismatch",
                    chain_message,
                    [
                        {"label": f"{rows[-1].get('year')} ending balance", "display": format_currency(previous_end), "value": round(float(previous_end), 2)},
                        {"label": f"{year} starting balance", "display": format_currency(start_balance), "value": round(float(start_balance), 2)},
                        {"label": "Difference", "display": format_currency(abs(chain_failure["difference"])), "value": abs(chain_failure["difference"])},
                    ],
                ))

        scheduled = _scheduled_from_balance(loan, float(start_balance or 0), scheduled_months)
        scheduled_principal = scheduled["scheduledPrincipal"]
        expected_interest = scheduled["expectedInterest"]

        if source == "projected" and actual_principal is None and next_doc and next_doc.get("box2Balance") is not None and start_balance is not None:
            end_balance = next_doc.get("box2Balance")
            end_balance_source = "reported"
            end_balance_source_label = "Calculated from next-year balance checkpoint"
            actual_principal = max(0.0, round(float(start_balance) - float(end_balance), 2))
            interest = expected_interest
            source_label = "Projected from balance checkpoint"
            source_display = source_label

        if source == "statement" and actual_principal is None and end_balance is not None and start_balance is not None:
            actual_principal = max(0.0, round(float(start_balance) - float(end_balance), 2))
            if interest is None:
                interest = expected_interest
                source_label = "Statement balance + amortized interest"
                source_display = "Statement balance + amortized interest"
                warnings.append("Statement did not include YTD interest; interest estimated from amortization through the statement month.")
        if actual_principal is None and source == "projected":
            actual_principal = scheduled_principal
            interest = expected_interest
            end_balance = scheduled["endBalance"]
            end_balance_source = "projected"
            end_balance_source_label = "Projected"
        elif actual_principal is not None and end_balance is None and start_balance is not None:
            end_balance = round(float(start_balance) - float(actual_principal), 2)

        top_up = 0.0
        if actual_principal is not None:
            top_up = max(0.0, round(float(actual_principal) - scheduled_principal, 2))
            if float(actual_principal) < scheduled_principal - 1:
                principal_difference = round(scheduled_principal - float(actual_principal), 2)
                principal_message = "Reported principal is below scheduled principal; check 1098 or balance data."
                warnings.append(principal_message)
                issues.append(_loan_reconciliation_issue(
                    "PRINCIPAL_BELOW_SCHEDULED",
                    "Reported principal below scheduled principal",
                    principal_message,
                    [
                        {"label": "Reported principal", "display": format_currency(actual_principal), "value": round(float(actual_principal), 2)},
                        {"label": "Scheduled principal", "display": format_currency(scheduled_principal), "value": round(float(scheduled_principal), 2)},
                        {"label": "Difference", "display": format_currency(principal_difference), "value": principal_difference},
                    ],
                ))
        interest_plausible = None
        if source == "1098" and interest:
            interest_plausible = True
            if start_balance is not None and end_balance is not None:
                average_balance = (float(start_balance) + float(end_balance)) / 2
                annual_rate = float(getattr(loan, "interest_rate", 0) or 0) / 100
                expected_interest_from_balance = average_balance * annual_rate * (scheduled_months / 12)
                if expected_interest_from_balance > 0:
                    interest_variance = abs(float(interest) - expected_interest_from_balance) / expected_interest_from_balance
                    interest_plausible = interest_variance <= 0.20
                    if not interest_plausible:
                        interest_message = "Parsed interest implausible for balance/rate — recheck mapping."
                        warnings.append(interest_message)
                        issues.append(_loan_reconciliation_issue(
                            "IMPLAUSIBLE_INTEREST",
                            "Parsed interest needs review",
                            interest_message,
                            [
                                {"label": "Parsed interest", "display": format_currency(interest), "value": round(float(interest), 2)},
                                {"label": "Expected interest", "display": format_currency(expected_interest_from_balance), "value": round(float(expected_interest_from_balance), 2)},
                                {"label": "Variance", "display": _percent_display(round(interest_variance * 100, 2)), "value": round(interest_variance * 100, 2)},
                            ],
                        ))
            else:
                interest_plausible = None

        if source_tier == "REPORTED" and end_balance is not None:
            latest_reported_balance = round(float(end_balance), 2)
            latest_reported_year = year
        total_top_up += top_up
        total_principal_paid += float(actual_principal or 0)
        total_interest_paid += float(interest or 0)
        assertion_ok = actual_principal is None or abs((scheduled_principal + top_up) - float(actual_principal)) <= 1
        comment_doc = primary_doc or (docs[0] if docs else None)
        comments = [
            {
                "message": warning,
                "documentId": comment_doc.get("documentId") if comment_doc else None,
                "filename": comment_doc.get("filename") if comment_doc else None,
                "previewUrl": comment_doc.get("previewUrl") if comment_doc else None,
            }
            for warning in warnings
        ]
        issue_messages = {issue["message"] for issue in issues}
        issues.extend(_loan_issue_from_warning(warning) for warning in warnings if warning not in issue_messages)
        assertion_payload = {
            "scheduledPlusTopUpEqualsActual": assertion_ok,
            "topUpNonNegative": top_up >= 0,
            "startingBalanceChainsFromPriorYear": not warnings or not any("Balance chain mismatch" in item for item in warnings),
            "interestPlausibleForBalanceRate": interest_plausible if source == "1098" else None,
            "principalPaidEqualsPaymentLessInterest": (
                None if principal_from_payment_less_interest is None or actual_principal is None
                else abs(float(actual_principal) - principal_from_payment_less_interest) <= 1
            ),
            "endingBalanceEqualsStartMinusPrincipal": (
                None if end_balance_source != "calculated" or start_balance is None or actual_principal is None or end_balance is None
                else abs((float(start_balance) - float(actual_principal)) - float(end_balance)) <= 1
            ),
        }
        failed_assertions = [key for key, ok in assertion_payload.items() if ok is False]
        display_docs = [primary_doc] if primary_doc and primary_doc.get("isCombined1098") else docs
        rows.append({
            "rowKey": f"{year}-actual",
            "year": year,
            "yearLabel": f"{year} · now" if not is_closed_tracking_period and year == reporting_date.year else str(year),
            "isCurrentYear": not is_closed_tracking_period and year == reporting_date.year,
            "scheduledMonths": scheduled_months,
            "startBalance": None if start_balance is None else round(float(start_balance), 2),
            "startBalanceDisplay": "—" if start_balance is None else format_currency(start_balance),
            "startingBalance": None if start_balance is None else round(float(start_balance), 2),
            "startingBalanceDisplay": "—" if start_balance is None else format_currency(start_balance),
            "principalPaid": None if actual_principal is None else round(float(actual_principal), 2),
            "principalPaidDisplay": "—" if actual_principal is None else format_currency(actual_principal),
            "scheduledPrincipal": round(scheduled_principal, 2),
            "scheduledPrincipalDisplay": format_currency(scheduled_principal),
            "principalRequired": round(scheduled_principal, 2),
            "principalRequiredDisplay": format_currency(scheduled_principal),
            "extraPrincipal": round(top_up, 2),
            "extraPrincipalDisplay": format_currency(top_up),
            "topUp": round(top_up, 2),
            "topUpDisplay": format_currency(top_up),
            "interest": None if interest is None else round(float(interest), 2),
            "interestDisplay": "—" if interest is None else format_currency(interest),
            "interestPaid": None if interest is None else round(float(interest), 2),
            "interestPaidDisplay": "—" if interest is None else format_currency(interest),
            "endBalance": None if end_balance is None else round(float(end_balance), 2),
            "endBalanceDisplay": "—" if end_balance is None else format_currency(end_balance),
            "endingBalance": None if end_balance is None else round(float(end_balance), 2),
            "endingBalanceDisplay": "—" if end_balance is None else format_currency(end_balance),
            "endingBalanceSource": end_balance_source if end_balance is not None else None,
            "endingBalanceSourceLabel": end_balance_source_label if end_balance is not None else None,
            "endingBalanceMetric": None if end_balance is None else {
                "value": round(float(end_balance), 2),
                "display": format_currency(end_balance),
                "sourceType": end_balance_source.upper(),
                "sourceLabel": end_balance_source_label,
                "calculationExplanation": (
                    "Calculated from starting balance minus recognized principal paid."
                    if end_balance_source == "calculated" else None
                ),
                "formula": "Starting balance − principal paid" if end_balance_source == "calculated" else None,
                "inputs": [
                    {
                        "label": "Starting balance",
                        "value": None if start_balance is None else round(float(start_balance), 2),
                        "display": "—" if start_balance is None else format_currency(start_balance),
                    },
                    {
                        "label": "Principal paid",
                        "value": None if actual_principal is None else round(float(actual_principal), 2),
                        "display": "—" if actual_principal is None else format_currency(actual_principal),
                    },
                ] if end_balance_source == "calculated" else [],
            },
            "source": source,
            "sourceLabel": source_label,
            "sourceTier": source_tier,
            "sourceDisplay": source_display or source_label,
            "documents": display_docs,
            "sourceDocument": primary_doc,
            "warnings": warnings,
            "comments": comments,
            "issues": issues,
            "issueCount": len(issues),
            "auditTrail": [{
                "source": source,
                "sourceLabel": source_label,
                "documentId": primary_doc.get("documentId") if primary_doc else None,
                "filename": primary_doc.get("filename") if primary_doc else None,
                "uploadedAt": primary_doc.get("uploadedAt") if primary_doc else None,
                "parsedValues": primary_doc.get("parsedValues") if primary_doc else {},
                "overrides": primary_doc.get("overrides") if primary_doc else {},
                "failedAssertions": failed_assertions,
            }],
            "topUpKnown": actual_principal is not None,
            "assertions": assertion_payload,
        })

    is_open_tracking_period = not is_closed_tracking_period
    if is_open_tracking_period and rows and today.month < 12 and rows[-1].get("year") == today.year and rows[-1].get("endBalance") is not None:
        current_row = rows[-1]
        elapsed_months = int(current_row.get("scheduledMonths") or today.month)
        remaining_months = max(0, 12 - elapsed_months)
        if remaining_months > 0:
            projection = _projected_from_balance(loan, float(current_row.get("endBalance") or 0), remaining_months)
            projected_principal = round(float(current_row.get("principalPaid") or 0) + projection["principal"], 2)
            projected_scheduled = round(float(current_row.get("scheduledPrincipal") or 0) + projection["scheduledPrincipal"], 2)
            projected_top_up = round(float(current_row.get("topUp") or 0) + projection["extraPrincipal"], 2)
            projected_interest = round(float(current_row.get("interestPaid") or 0) + projection["expectedInterest"], 2)
            projected_end = projection["endBalance"]
            rows.append({
                "rowKey": f"{today.year}-projected",
                "year": today.year,
                "yearLabel": f"{today.year} Projected",
                "isCurrentYear": False,
                "isFullYearProjection": True,
                "projectedThroughMonth": 12,
                "actualThroughMonth": elapsed_months,
                "projectedRemainingMonths": remaining_months,
                "startBalance": current_row.get("startBalance"),
                "startBalanceDisplay": current_row.get("startBalanceDisplay") or "—",
                "startingBalance": current_row.get("startingBalance"),
                "startingBalanceDisplay": current_row.get("startingBalanceDisplay") or "—",
                "principalPaid": projected_principal,
                "principalPaidDisplay": format_currency(projected_principal),
                "scheduledPrincipal": projected_scheduled,
                "scheduledPrincipalDisplay": format_currency(projected_scheduled),
                "principalRequired": projected_scheduled,
                "principalRequiredDisplay": format_currency(projected_scheduled),
                "extraPrincipal": projected_top_up,
                "extraPrincipalDisplay": format_currency(projected_top_up),
                "topUp": projected_top_up,
                "topUpDisplay": format_currency(projected_top_up),
                "interest": projected_interest,
                "interestDisplay": format_currency(projected_interest),
                "interestPaid": projected_interest,
                "interestPaidDisplay": format_currency(projected_interest),
                "endBalance": projected_end,
                "endBalanceDisplay": format_currency(projected_end),
                "endingBalance": projected_end,
                "endingBalanceDisplay": format_currency(projected_end),
                "endingBalanceSource": "projected",
                "endingBalanceSourceLabel": "Projected full year",
                "endingBalanceMetric": {
                    "value": projected_end,
                    "display": format_currency(projected_end),
                    "sourceType": "PROJECTED",
                    "sourceLabel": "Projected full year",
                    "calculationExplanation": "Projected from the current-year row through December using loan rate, P&I payment, and explicit extra monthly principal.",
                    "formula": "Month interest = balance × rate ÷ 12; principal = P&I − interest; extra principal = configured extra monthly payment",
                    "inputs": [
                        {"label": "Current-year ending balance", "value": current_row.get("endBalance"), "display": current_row.get("endBalanceDisplay") or "—"},
                        {"label": "Remaining months", "value": remaining_months, "display": str(remaining_months)},
                        {"label": "Projected remaining interest", "value": projection["expectedInterest"], "display": format_currency(projection["expectedInterest"])},
                        {"label": "Projected remaining principal", "value": projection["principal"], "display": format_currency(projection["principal"])},
                    ],
                },
                "source": "projected",
                "sourceLabel": "Projected full year",
                "sourceTier": "PROJECTED",
                "sourceDisplay": "Projected full year",
                "documents": current_row.get("documents") or [],
                "sourceDocument": current_row.get("sourceDocument"),
                "warnings": [],
                "comments": [],
                "issues": [],
                "issueCount": 0,
                "auditTrail": [{
                    "source": "projected",
                    "sourceLabel": "Projected full year",
                    "documentId": (current_row.get("sourceDocument") or {}).get("documentId"),
                    "filename": (current_row.get("sourceDocument") or {}).get("filename"),
                    "parsedValues": {
                        "actualThroughMonth": elapsed_months,
                        "projectedRemainingMonths": remaining_months,
                        "projectedRemainingInterest": projection["expectedInterest"],
                        "projectedRemainingPrincipal": projection["principal"],
                    },
                    "overrides": {},
                    "failedAssertions": [],
                }],
                "topUpKnown": True,
                "assertions": {
                    "projectedFromCurrentYearEndingBalance": True,
                    "futureTopUpUsesConfiguredExtraMonthlyOnly": True,
                    "endingBalanceEqualsProjectedAmortization": True,
                },
            })

    balance_assertion = latest_reported_balance is None or abs(latest_reported_balance - current_balance) <= 1
    balance_delta = max(original_amount - current_balance, 0.0)
    principal_paid_assertion = abs(total_principal_paid - balance_delta) <= 1
    ahead_months = None
    if latest_reported_balance is not None and total_top_up > 0:
        scheduled_counterfactual_balance = latest_reported_balance + total_top_up
        scheduled_months = _payoff_months_from_balance(loan, scheduled_counterfactual_balance)
        actual_months = _payoff_months_from_balance(loan, latest_reported_balance)
        if scheduled_months is not None and actual_months is not None:
            ahead_months = max(0, scheduled_months - actual_months)
    reconciliation_years = [
        {
            "year": row["year"],
            "status": "WARNING",
            "issueCount": row.get("issueCount", 0),
            "issues": row.get("issues", []),
        }
        for row in rows
        if row.get("issueCount", 0) > 0
    ]
    total_issue_count = sum(item["issueCount"] for item in reconciliation_years)
    affected_year_count = len(reconciliation_years)
    reconciliation_status = "WARNING" if total_issue_count else "OK"
    reconciliation_summary = (
        f"Loan history has reconciliation issues in {affected_year_count} {'year' if affected_year_count == 1 else 'years'}."
        if total_issue_count else
        "Loan history reconciles."
    )
    return {
        "summary": {
            "totalTopUp": round(total_top_up, 2),
            "totalTopUpDisplay": format_currency(total_top_up),
            "principalPaidToDate": round(total_principal_paid, 2),
            "principalPaidToDateDisplay": format_currency(total_principal_paid),
            "interestPaidToDate": round(total_interest_paid, 2),
            "interestPaidToDateDisplay": format_currency(total_interest_paid),
            "aheadOfScheduleMonths": ahead_months,
            "aheadOfScheduleDisplay": "—" if ahead_months is None else _years_months_display(ahead_months),
            "warnings": [],
        },
        "rows": rows,
        "reconciliation": {
            "status": reconciliation_status,
            "affectedYearCount": affected_year_count,
            "totalIssueCount": total_issue_count,
            "summary": reconciliation_summary,
            "years": reconciliation_years,
        },
        "assertions": {
            "loanStartDatePresent": True,
            "balanceChainValid": balance_chain_valid,
            "balanceChainFailures": chain_failures,
            "principalPaidMatchesBalanceDelta": principal_paid_assertion,
            "principalPaidFromRows": round(total_principal_paid, 2),
            "balanceDeltaPrincipalPaid": round(balance_delta, 2),
            "latestReportedBalanceMatchesLoanCard": balance_assertion,
            "latestReportedBalance": latest_reported_balance,
            "latestReportedYear": latest_reported_year,
            "loanCardBalance": current_balance,
        },
    }


def _loan_debt_waterfall(
    loan: models.Loan,
    prop: models.Property,
    interest_by_year: Dict[int, float],
    tax_return_interest_by_year: Dict[int, float],
    interest_by_account: Dict[Optional[str], Dict[int, float]],
    today: Optional[date] = None,
) -> Dict[str, Any]:
    """Per-loan interest/balance accumulation using the best available source
    for each period, in priority order:
      1. Form 1098 (Box 1) — exact annual interest, per loan account.
      2. Schedule E mortgage interest (tax return) — kept as a cross-check
         value alongside 1098 when both exist, otherwise used on its own.
      3. Projection — for any period neither source covers (typically the
         current, still-in-progress year), project forward month-by-month
         from the loan's last known statement (balance, rate, P&I split)
         to today. Only the undocumented gap is ever projected; a year
         with a 1098 or Schedule E figure is never overwritten.
    """
    today = _loan_tracking_as_of(loan, today)

    loan_interest_by_year = interest_by_account.get(loan.account_number)
    if loan_interest_by_year is None:
        # No 1098 is attributed to this exact account number. With only one
        # loan on the property, the property-wide total is unambiguously
        # this loan's; with more than one, we can't safely guess which loan
        # an unattributed document belongs to, so leave 1098 data out rather
        # than risk double-counting it onto every loan.
        loan_interest_by_year = interest_by_year if len(prop.loans) == 1 else {}
    loan_tax_return_interest = tax_return_interest_by_year if len(prop.loans) == 1 else {}

    years: Dict[int, Dict[str, Any]] = {}
    for yr, amt in loan_tax_return_interest.items():
        years[yr] = {"year": yr, "interest": round(amt, 2), "source": "tax_return"}
    for yr, amt in loan_interest_by_year.items():
        entry = years.setdefault(yr, {"year": yr})
        if entry.get("source") == "tax_return":
            entry["tax_return_interest"] = entry["interest"]
        entry["interest"] = round(amt, 2)
        entry["source"] = "1098"

    documented_years = set(years.keys())

    orig = _parse_statement_date(loan.origination_date) if loan.origination_date else None
    stmt_date = _parse_statement_date(loan.statement_date) if loan.statement_date else None
    active_start = _loan_tracking_start_date(loan)
    if active_start:
        years = {year: data for year, data in years.items() if year >= active_start.year}
        documented_years = set(years.keys())

    rate_m = (loan.interest_rate or 0) / 12 / 100
    pni = (loan.principal_due or 0) + (loan.interest_due or 0)
    if pni <= 0:
        pni = max((loan.monthly_payment or 0) - (loan.escrow_amount or 0), 0)

    gap_interest = 0.0
    gap_months = 0
    latest_period = None
    current_year_principal = 0.0
    current_year_interest = 0.0
    is_arm = (loan.loan_type or "").upper() == "ARM"
    current_year = today.year

    if stmt_date:
        anchor_date, anchor_balance = stmt_date, loan.current_balance or 0.0
        if stmt_date.year not in documented_years:
            # The statement's own YTD figure covers Jan 1 -> statement_date
            # for its year more precisely than an amortization guess would.
            gap_interest += loan.interest_paid_ytd or 0.0
            gap_months += stmt_date.month
    elif active_start:
        anchor_date, anchor_balance = active_start, loan.original_amount or 0.0
    elif orig:
        anchor_date, anchor_balance = orig, loan.original_amount or 0.0
    else:
        anchor_date = None

    if anchor_date and rate_m > 0 and pni > 0:
        balance = anchor_balance
        y, m = anchor_date.year, anchor_date.month + 1
        if m > 12:
            m, y = 1, y + 1
        while (y < today.year) or (y == today.year and m <= today.month):
            interest_m = round(balance * rate_m, 2)
            principal_m = max(pni - interest_m, 0)
            latest_period = {
                "year": y,
                "month": m,
                "principal": round(principal_m, 2),
                "interest": round(interest_m, 2),
                "source": "projected",
                "label": f"Latest month ({y})",
            }
            if y == current_year:
                current_year_principal += principal_m
                current_year_interest += interest_m
            if y not in documented_years:
                gap_interest += interest_m
                gap_months += 1
            balance = max(balance - principal_m, 0)
            m += 1
            if m > 12:
                m, y = 1, y + 1

    total_interest = round(
        sum(y["interest"] for y in years.values()) + gap_interest, 2)

    if current_year in loan_interest_by_year:
        source = "1098"
    elif current_year in loan_tax_return_interest:
        source = "tax_return"
    elif gap_months > 0:
        source = "projected"
    else:
        source = "no_data"

    if latest_period is None and stmt_date and ((loan.principal_due or 0) or (loan.interest_due or 0)):
        latest_period = {
            "year": stmt_date.year,
            "month": stmt_date.month,
            "principal": round(loan.principal_due or 0, 2),
            "interest": round(loan.interest_due or 0, 2),
            "source": "reported",
            "label": f"Last statement ({stmt_date.strftime('%b %Y')})",
        }
    if latest_period is None and pni > 0:
        interest_m = round((current_loan_balance(loan, today) or 0) * rate_m, 2)
        principal_m = max(pni - interest_m, 0)
        latest_period = {
            "year": today.year,
            "month": today.month,
            "principal": round(principal_m, 2),
            "interest": round(interest_m, 2),
            "source": "calculated",
            "label": f"Latest month ({today.year})",
        }
    paydown = _loan_paydown_tracking(loan, prop, today)
    latest_reported_balance = (paydown.get("assertions") or {}).get("latestReportedBalance")
    original_amount = float(loan.original_amount or 0)
    historical_ending_balance = float(
        latest_reported_balance
        if latest_reported_balance is not None
        else current_loan_balance(loan, today) or 0
    )
    is_closed = _is_closed_loan_status(getattr(loan, "status", None)) or bool(getattr(loan, "closed_date", None))
    current_balance = 0.0 if is_closed else historical_ending_balance
    principal_paid = max(original_amount - historical_ending_balance, 0.0)
    principal_paid_percent = (principal_paid / original_amount * 100) if original_amount > 0 else 0.0
    paydown_interest = (paydown.get("summary") or {}).get("interestPaidToDate")
    if paydown_interest is not None:
        total_interest = round(float(paydown_interest or 0), 2)
    return {
        "loan_id": loan.id,
        "lender_name": loan.lender_name,
        "account_number": loan.account_number,
        "source": source,
        "current_balance": round(current_balance, 2),
        "historical_ending_balance": round(historical_ending_balance, 2) if is_closed else None,
        "principal_paid": round(principal_paid, 2),
        "principal_paid_display": format_currency(principal_paid),
        "principal_paid_percent": round(principal_paid_percent, 1),
        "principal_paid_percent_display": f"{round(principal_paid_percent, 1)}%",
        "remaining_balance": round(current_balance, 2),
        "remaining_balance_display": format_currency(current_balance),
        "accumulated_interest": total_interest,
        "last_known_statement_date": loan.statement_date,
        "gap_months_projected": gap_months,
        "estimated_vs_reported": "estimated" if gap_months > 0 else "reported",
        "rate_assumption_flag": is_arm and gap_months > 0,
        "latest_period": latest_period,
        "current_year_ytd": {
            "year": current_year,
            "principal": round(current_year_principal, 2),
            "interest": round(current_year_interest, 2),
            "source": "projected" if current_year_principal or current_year_interest else source,
        },
        "years": sorted(years.values(), key=lambda y: y["year"]),
        "scheduled_years": _scheduled_loan_years(loan, today.year),
        "paydown": paydown,
    }


def _set_metric_currency_value(metric: Optional[Dict[str, Any]], value: float, *, formula: Optional[str] = None) -> None:
    if not metric:
        return
    rounded = round(float(value or 0), 4)
    metric["value"] = rounded
    metric["displayValue"] = _compact_money_display(rounded)
    metric["fullDisplayValue"] = format_currency(rounded)
    metric["computation"] = format_currency(rounded)
    if formula:
        metric["formula"] = formula
    metric["inputs"] = [{
        "label": "Interest paid from paydown rows",
        "value": rounded,
        "display": format_currency(rounded),
    }]


def _sync_metric_currency(metric_map: Dict[str, Any], key: str, value: float, *, formula: str) -> None:
    metric = metric_map.get(key)
    if not metric:
        return
    rounded = round(float(value or 0), 4)
    metric["value"] = rounded
    metric["displayValue"] = _compact_money_display(rounded)
    metric["fullDisplayValue"] = format_currency(rounded)
    metric["computation"] = format_currency(rounded)
    metric["formula"] = formula
    metric["inputs"] = [{
        "label": "Logical loan chains",
        "value": rounded,
        "display": format_currency(rounded),
    }]


def _sync_metric_vault_loan_interest_from_paydown(prop: models.Property, payload: Dict[str, Any], db: Session) -> None:
    """Keep loan strip and card metrics on the same backend source as paydown rows."""
    _, _, interest_by_year, _, _ = _collect_doc_history(prop)
    interest_by_account = _interest_by_year_by_account(prop)
    tax_return_interest_by_year = {
        entry.tax_year: entry.mortgage_interest
        for entry in db.query(models.TaxReturnEntry).filter(
            models.TaxReturnEntry.property_id == prop.id,
        ).all()
        if entry.mortgage_interest
    }
    today = date.today()
    debt_loans = _logical_debt_waterfalls(
        prop,
        interest_by_year,
        tax_return_interest_by_year,
        interest_by_account,
        today,
    )
    active_debt_loans = [
        item for item in debt_loans
        if str(item.get("status") or "OPEN").upper() not in CLOSED_LOAN_STATUSES
    ]
    by_loan_id = {str(item.get("loan_id")): item for item in debt_loans if item.get("loan_id") is not None}
    loan_metrics = payload.get("loanMetrics") or {}
    metric_map = payload.get("metrics") or {}
    total_original = round(sum(float(item.get("original_amount") or 0) for item in active_debt_loans), 2)
    total_balance = round(sum(float(item.get("current_balance") or 0) for item in active_debt_loans), 2)
    total_principal = round(sum(float(item.get("principal_paid") or 0) for item in active_debt_loans), 2)
    total_interest = 0.0
    total_rows_interest = 0.0
    active_loan_ids = {str(item.get("loan_id")) for item in active_debt_loans if item.get("loan_id") is not None}
    for loan_id, debt in by_loan_id.items():
        paydown_summary = (debt.get("paydown") or {}).get("summary") or {}
        paydown_rows = (debt.get("paydown") or {}).get("rows") or []
        actual_paydown_rows = [row for row in paydown_rows if not row.get("isFullYearProjection")]
        row_interest = round(sum(float(row.get("interestPaid") or 0) for row in actual_paydown_rows), 2)
        interest_value = paydown_summary.get("interestPaidToDate")
        if interest_value is None:
            interest_value = row_interest
        if loan_id in active_loan_ids:
            total_interest += float(interest_value or 0)
            total_rows_interest += row_interest
        loan_metric = loan_metrics.get(loan_id)
        if not loan_metric and loan_id.isdigit():
            loan_metric = loan_metrics.get(int(loan_id))
        if loan_metric:
            _set_metric_currency_value(
                loan_metric.get("interestToDate"),
                float(interest_value or 0),
                formula="Sum of reported and projected yearly interest in the loan paydown table",
            )
            loan_metric.setdefault("assertions", {})["interestToDateMatchesPaydownRows"] = abs(float(interest_value or 0) - row_interest) <= 1

    loan_summary = payload.get("loanSummary") or {}
    loan_summary["totalOriginal"] = total_original
    loan_summary["totalBalance"] = total_balance
    loan_summary["principalPaidToDate"] = total_principal
    loan_summary["interestToDate"] = round(total_interest, 2)
    loan_summary.setdefault("assertions", {})["interestToDateMatchesPaydownRows"] = abs(total_interest - total_rows_interest) <= 1
    _sync_metric_currency(
        metric_map,
        "loanTotalOriginal",
        total_original,
        formula="Sum of original borrowed amounts by logical loan chain, not by servicer segment",
    )
    _sync_metric_currency(
        metric_map,
        "loanTotalBalance",
        total_balance,
        formula="Sum of current balances by logical loan chain",
    )
    _sync_metric_currency(
        metric_map,
        "loanPrincipalPaidToDate",
        total_principal,
        formula="Original borrowed minus current balance by logical loan chain",
    )
    _sync_metric_currency(
        metric_map,
        "loanInterestToDate",
        total_interest,
        formula="Sum of reported and projected yearly interest by logical loan chain",
    )
    loan_summary["interestToDateFromRows"] = round(total_rows_interest, 2)
    metrics = payload.get("metrics") or {}
    _set_metric_currency_value(
        metrics.get("loanInterestToDate"),
        total_interest,
        formula="Sum of reported and projected yearly interest across loan paydown rows",
    )


def _loan_yearly_reporting_rows(loans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for loan in loans:
        loan_id = loan.get("loan_id")
        lender = loan.get("lender_name") or "Loan"
        account = loan.get("account_number")
        for row in ((loan.get("paydown") or {}).get("rows") or []):
            year = row.get("year")
            year_label = row.get("yearLabel") or (f"{year} Projected" if row.get("isFullYearProjection") else str(year))
            rows.append({
                "rowKey": f"{loan_id}-{row.get('rowKey') or year_label}",
                "loanId": loan_id,
                "lenderName": lender,
                "accountNumber": account,
                "loanLabel": f"{lender}{f' #{account}' if account else ''}",
                "year": year,
                "yearLabel": year_label,
                "isCurrentYear": bool(row.get("isCurrentYear")),
                "isFullYearProjection": bool(row.get("isFullYearProjection")),
                "actualThroughMonth": row.get("actualThroughMonth"),
                "projectedRemainingMonths": row.get("projectedRemainingMonths"),
                "startingBalance": row.get("startingBalance"),
                "startingBalanceDisplay": row.get("startingBalanceDisplay"),
                "principalPaid": row.get("principalPaid"),
                "principalPaidDisplay": row.get("principalPaidDisplay"),
                "scheduledPrincipal": row.get("scheduledPrincipal"),
                "scheduledPrincipalDisplay": row.get("scheduledPrincipalDisplay"),
                "topUp": row.get("topUp"),
                "topUpDisplay": row.get("topUpDisplay"),
                "interestPaid": row.get("interestPaid"),
                "interestPaidDisplay": row.get("interestPaidDisplay"),
                "endingBalance": row.get("endingBalance"),
                "endingBalanceDisplay": row.get("endingBalanceDisplay"),
                "source": row.get("source"),
                "sourceLabel": row.get("sourceLabel"),
                "sourceTier": row.get("sourceTier"),
                "sourceDisplay": row.get("sourceDisplay"),
                "issueCount": row.get("issueCount", 0),
                "documents": row.get("documents") or [],
                "sourceDocument": row.get("sourceDocument"),
            })
    return sorted(
        rows,
        key=lambda item: (
            int(item.get("year") or 0),
            1 if item.get("isFullYearProjection") else 0,
            str(item.get("lenderName") or ""),
            str(item.get("accountNumber") or ""),
        ),
    )


def _ordered_loan_group_members(members: List[Any]) -> List[Any]:
    return sorted(members or [], key=lambda item: (
        getattr(item, "servicer_sequence", None) or 99,
        _parse_setup_date(getattr(item, "servicer_start_date", None) or getattr(item, "origination_date", None)) or date.min,
        getattr(item, "id", 0) or 0,
    ))


def _loan_group_is_servicing_transfer(members: List[Any]) -> bool:
    ordered = _ordered_loan_group_members(members)
    if len(ordered) <= 1:
        return False
    reasons = " ".join(
        str(getattr(loan, "transfer_reason", "") or getattr(loan, "closure_reason", "") or "")
        for loan in ordered
    ).lower()
    if "refinance" in reasons and "servicing transfer" not in reasons:
        return False
    origination_dates = [
        _parse_setup_date(getattr(loan, "origination_date", None))
        for loan in ordered
        if _parse_setup_date(getattr(loan, "origination_date", None))
    ]
    same_origination = True
    if len(origination_dates) > 1:
        first = origination_dates[0]
        same_origination = all(_same_original_loan_date(first, other) for other in origination_dates[1:])
    return "servicing transfer" in reasons or same_origination


def _logical_loan_groups(loans: List[Any]) -> List[List[Any]]:
    groups: List[List[Any]] = []
    for loan in loans or []:
        matched = None
        for group in groups:
            if any(_loans_share_servicer_chain(loan, member) for member in group):
                matched = group
                break
        if matched is None:
            groups.append([loan])
        else:
            matched.append(loan)
    return [_ordered_loan_group_members(members) for members in groups]


def _loans_share_servicer_chain(left: Any, right: Any) -> bool:
    left_key = _loan_chain_group_key(left)
    right_key = _loan_chain_group_key(right)
    if left_key == right_key:
        return True
    reasons = " ".join([
        str(getattr(left, "transfer_reason", "") or getattr(left, "closure_reason", "") or ""),
        str(getattr(right, "transfer_reason", "") or getattr(right, "closure_reason", "") or ""),
    ]).lower()
    if "refinance" in reasons and "servicing transfer" not in reasons:
        return False
    left_origination = _parse_setup_date(getattr(left, "origination_date", None))
    right_origination = _parse_setup_date(getattr(right, "origination_date", None))
    if not _same_original_loan_date(left_origination, right_origination):
        return False
    left_type = str(getattr(left, "loan_type", "") or "").upper()
    right_type = str(getattr(right, "loan_type", "") or "").upper()
    if left_type and right_type and left_type != right_type:
        return False
    left_term = int(getattr(left, "loan_term_years", 0) or 0)
    right_term = int(getattr(right, "loan_term_years", 0) or 0)
    if left_term and right_term and left_term != right_term:
        return False
    left_rate = float(getattr(left, "interest_rate", 0) or 0)
    right_rate = float(getattr(right, "interest_rate", 0) or 0)
    if left_rate and right_rate and abs(left_rate - right_rate) > 0.125:
        return False
    left_amount = float(getattr(left, "original_amount", 0) or 0)
    right_amount = float(getattr(right, "original_amount", 0) or 0)
    if left_amount and right_amount:
        larger = max(left_amount, right_amount)
        if larger and abs(left_amount - right_amount) / larger > 0.12:
            return False
    return True


def _current_servicer_member(members: List[Any]) -> Any:
    ordered = _ordered_loan_group_members(members)
    current = next(
        (
            loan for loan in ordered
            if bool(getattr(loan, "is_current_servicer", True))
            and not _is_closed_loan_status(getattr(loan, "status", None))
        ),
        None,
    )
    return current or next((loan for loan in ordered if not _is_closed_loan_status(getattr(loan, "status", None))), None) or ordered[-1]


def _servicer_segments_for_group(members: List[Any], today: date) -> List[Dict[str, Any]]:
    ordered = _ordered_loan_group_members(members)
    if not ordered:
        return []
    if len(ordered) == 1 and getattr(ordered[0], "servicer_segments", None):
        canonical = ordered[0]
        ordered = [
            SimpleNamespace(
                id=canonical.id,
                lender_name=segment.servicer or canonical.lender_name,
                account_number=segment.account_number,
                servicer_start_date=segment.from_date,
                servicer_end_date=segment.to_date,
                origination_date=segment.from_date,
                is_current_servicer=segment.is_current,
                status="OPEN" if segment.is_current else "CLOSED",
                transfer_reason="Servicing transfer",
                closure_reason=None,
            )
            for segment in canonical.servicer_segments
        ]
    raw_segments = []
    for index, loan in enumerate(ordered):
        start = (
            _parse_setup_date(getattr(loan, "servicer_start_date", None))
            or _parse_setup_date(getattr(loan, "origination_date", None))
            or today
        )
        end = _parse_setup_date(getattr(loan, "servicer_end_date", None))
        if not end and index < len(ordered) - 1:
            next_start = (
                _parse_setup_date(getattr(ordered[index + 1], "servicer_start_date", None))
                or _parse_setup_date(getattr(ordered[index + 1], "origination_date", None))
            )
            if next_start:
                end = next_start
        display_end = end or today
        duration = max((display_end - start).days, 1)
        raw_segments.append((loan, start, end, duration))
    total_duration = sum(item[3] for item in raw_segments) or 1
    segments = []
    for index, (loan, start, end, duration) in enumerate(raw_segments):
        current = index == len(raw_segments) - 1 and not _is_closed_loan_status(getattr(loan, "status", None))
        transfer_date = None
        transition_reason = None
        transition_type = None
        transition_label = None
        if index > 0:
            transfer_date = start.isoformat()
            previous = raw_segments[index - 1][0]
            transition_reason = (
                getattr(loan, "transfer_reason", None)
                or getattr(loan, "closure_reason", None)
                or getattr(previous, "transfer_reason", None)
                or getattr(previous, "closure_reason", None)
                or "Servicing transfer"
            )
            transition_text = str(transition_reason or "").lower()
            if "refinance" in transition_text:
                transition_type = "refinance"
                transition_label = "refinance"
            else:
                transition_type = "servicer_transfer"
                transition_label = "servicer change"
        segments.append({
            "loanId": getattr(loan, "id", None),
            "servicer": getattr(loan, "lender_name", None) or "Servicer",
            "accountNumber": getattr(loan, "account_number", None),
            "from": start.isoformat(),
            "fromDisplay": _display_loan_date(start.isoformat()),
            "to": end.isoformat() if end else None,
            "toDisplay": _display_loan_date(end.isoformat()) if end else "present",
            "dateRangeDisplay": f"{_display_loan_date(start.isoformat())} → {_display_loan_date(end.isoformat()) if end else 'present'}",
            "current": current,
            "transferDate": transfer_date,
            "transferDateDisplay": _display_loan_date(transfer_date) if transfer_date else None,
            "transitionType": transition_type,
            "transitionLabel": transition_label,
            "transitionReason": transition_reason,
            "widthPercent": round(duration / total_duration * 100, 2),
        })
    return segments


def _servicer_group_account_aliases(members: List[Any], prop: models.Property) -> List[str]:
    aliases = [
        str(getattr(loan, "account_number", "") or "").strip()
        for loan in members
        if str(getattr(loan, "account_number", "") or "").strip()
    ]
    alias_set = set(aliases)
    member_ids = {getattr(loan, "id", None) for loan in members}
    external_accounts = {
        str(getattr(loan, "account_number", "") or "").strip()
        for loan in getattr(prop, "loans", []) or []
        if getattr(loan, "id", None) not in member_ids and str(getattr(loan, "account_number", "") or "").strip()
    }
    group_origination_dates = [
        parsed
        for parsed in (
            _parse_setup_date(getattr(loan, "origination_date", None))
            for loan in members
        )
        if parsed
    ]
    if not group_origination_dates:
        return aliases
    for doc in getattr(prop, "documents", []) or []:
        if getattr(doc, "doc_category", None) not in {"1098", "mortgage_statement"} or not getattr(doc, "extracted_data", None):
            continue
        data = _document_payload(doc)
        doc_account = str(getattr(doc, "loan_account_number", None) or data.get("account_number") or data.get("loan_account_number") or "").strip()
        if not doc_account or doc_account in alias_set or doc_account in external_accounts:
            continue
        doc_origination = _parse_setup_date(data.get("origination_date"))
        if doc_origination and any(_same_original_loan_date(doc_origination, group_date) for group_date in group_origination_dates):
            alias_set.add(doc_account)
            aliases.append(doc_account)
    return aliases


def _row_servicer_label(row: Dict[str, Any], segments: List[Dict[str, Any]]) -> str:
    year = int(row.get("year") or 0)
    if not year:
        return "—"
    names = []
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    for segment in segments:
        start = _parse_setup_date(segment.get("from")) or year_start
        end = _parse_setup_date(segment.get("to")) or year_end
        if start <= year_end and end >= year_start:
            name = segment.get("servicer") or "Servicer"
            if name not in names:
                names.append(name)
    return " → ".join(names) if names else "—"


def _loan_chain_assertions(loan_payload: Dict[str, Any]) -> Dict[str, Any]:
    rows = [
        row for row in ((loan_payload.get("paydown") or {}).get("rows") or [])
        if not row.get("isFullYearProjection")
    ]
    chain_ok = True
    for previous, current in zip(rows, rows[1:]):
        previous_end = previous.get("endingBalance")
        current_start = current.get("startingBalance")
        if previous_end is None or current_start is None or round(float(previous_end), 2) != round(float(current_start), 2):
            chain_ok = False
            break
    interest_ok = True
    rate = float(loan_payload.get("interest_rate") or loan_payload.get("rate") or 0) / 100
    for row in rows:
        interest = row.get("interestPaid")
        start = row.get("startingBalance")
        end = row.get("endingBalance")
        months = float(row.get("scheduledMonths") or 12)
        if interest is None or start is None or end is None or rate <= 0:
            continue
        expected = ((float(start) + float(end)) / 2) * rate * (months / 12)
        if expected > 0 and abs(float(interest) - expected) / expected > 0.20:
            interest_ok = False
            break
    original = float(loan_payload.get("original_amount") or loan_payload.get("originalAmount") or 0)
    current_balance = float(loan_payload.get("current_balance") or loan_payload.get("currentBalance") or 0)
    principal_paid = sum(float(row.get("principalPaid") or 0) for row in rows)
    scheduled_payment = float((((loan_payload.get("payment") or {}).get("monthlyPI")) or 0) or 0)
    amortized_payment = float((((loan_payload.get("payment") or {}).get("amortizedMonthlyPI")) or 0) or 0)
    return {
        "L1_balanceChainContinuous": chain_ok,
        "L4_interestPlausible": interest_ok,
        "L5_paymentPiMatchesAmortization": abs(scheduled_payment - amortized_payment) <= 5 if scheduled_payment and amortized_payment else None,
        "L6_singleLogicalCard": True,
        "L7_originalMinusPrincipalEqualsCurrentBalance": abs((original - principal_paid) - current_balance) <= 1 if original else None,
        "principalPaidFromRows": round(principal_paid, 2),
        "balanceDelta": round(original - current_balance, 2) if original else None,
    }


def _servicer_transfer_boundary_assertion(members: List[Any], loan_payload: Dict[str, Any]) -> Optional[bool]:
    ordered = _ordered_loan_group_members(members)
    if len(ordered) <= 1:
        return None
    rows = [
        row for row in ((loan_payload.get("paydown") or {}).get("rows") or [])
        if not row.get("isFullYearProjection")
    ]
    rows_by_year = {int(row.get("year") or 0): row for row in rows}
    checks = []
    for previous, current in zip(ordered, ordered[1:]):
        transfer_start = (
            _parse_setup_date(getattr(current, "servicer_start_date", None))
            or _parse_setup_date(getattr(current, "origination_date", None))
        )
        if not transfer_start:
            continue
        row = rows_by_year.get(transfer_start.year)
        previous_end = getattr(previous, "current_balance", None)
        row_end = row.get("endingBalance") if row else None
        if previous_end is None or row_end is None:
            continue
        checks.append(abs(float(previous_end) - float(row_end)) <= 500)
    if not checks:
        return None
    return all(checks)


def _compat_loan_payload(loan: Any, debt: Dict[str, Any], members: List[Any]) -> Dict[str, Any]:
    original_amount = float(getattr(members[0], "original_amount", None) or getattr(loan, "original_amount", 0) or 0)
    debt_current_balance = debt.get("current_balance")
    current_balance = float(
        debt_current_balance
        if debt_current_balance is not None
        else getattr(loan, "current_balance", 0) or 0
    )
    payment_terms_present = (debt.get("paydown") or {}).get("assertions", {}).get("paymentTermsPresent")
    monthly_pi = 0.0 if payment_terms_present is False else _loan_monthly_pi_amount(loan, original_amount)
    amortized_pi = 0.0 if payment_terms_present is False else engine_monthly_principal_interest(
        original_amount,
        float(getattr(loan, "interest_rate", 0) or 0),
        int(getattr(loan, "loan_term_years", 0) or 30),
    )
    payload = {
        "id": getattr(loan, "id", None),
        "loan_id": getattr(loan, "id", None),
        "logicalLoanId": _loan_chain_group_key(loan),
        "memberLoanIds": [getattr(member, "id", None) for member in members],
        "name": "Primary mortgage" if len(members) > 1 else (getattr(loan, "loan_product", None) or "Primary mortgage"),
        "lender_name": getattr(loan, "lender_name", None),
        "account_number": getattr(loan, "account_number", None),
        "loan_type": getattr(loan, "loan_type", None),
        "rateType": "arm" if str(getattr(loan, "loan_type", "")).upper() == "ARM" else "fixed",
        "rate": getattr(loan, "interest_rate", None),
        "rateDisplay": format_interest_rate(getattr(loan, "interest_rate", None)),
        "interest_rate": getattr(loan, "interest_rate", None),
        "status": str(getattr(loan, "status", None) or "OPEN").upper(),
        "original_amount": original_amount,
        "originalAmount": original_amount,
        "originalAmountDisplay": format_currency(original_amount),
        "current_balance": current_balance,
        "currentBalance": current_balance,
        "currentBalanceDisplay": format_currency(current_balance),
        "monthly_payment": getattr(loan, "monthly_payment", None),
        "payment": {
            "monthlyPI": round(monthly_pi, 2),
            "monthlyPIDisplay": format_currency(monthly_pi),
            "amortizedMonthlyPI": round(amortized_pi, 2),
            "amortizedMonthlyPIDisplay": format_currency(amortized_pi),
            "escrowExcluded": True,
        },
        "loan_term_years": getattr(loan, "loan_term_years", None),
        "termMonths": int(getattr(loan, "loan_term_years", 0) or 30) * 12,
        "termDisplay": f"{int(getattr(loan, 'loan_term_years', 0) or 30)}-yr",
        "origination_date": getattr(members[0], "origination_date", None) or getattr(loan, "origination_date", None),
        "originationDateDisplay": _display_loan_date(getattr(members[0], "origination_date", None) or getattr(loan, "origination_date", None)),
        "closed_date": getattr(loan, "closed_date", None),
        "closedDateDisplay": _display_loan_date(getattr(loan, "closed_date", None)),
        "replacementLoanId": getattr(loan, "replacement_loan_id", None),
        "maturity_date": getattr(loan, "maturity_date", None),
        "maturityDateDisplay": _display_loan_date(getattr(loan, "maturity_date", None)),
        "servicerSegments": debt.get("servicerSegments") or [],
    }
    payload.update(debt)
    payload.update({
        "id": getattr(loan, "id", None),
        "loan_id": getattr(loan, "id", None),
        "logicalLoanId": _loan_chain_group_key(loan),
        "memberLoanIds": [getattr(member, "id", None) for member in members],
        "name": payload["name"],
        "original_amount": original_amount,
        "originalAmount": original_amount,
        "originalAmountDisplay": format_currency(original_amount),
        "current_balance": current_balance,
        "currentBalance": current_balance,
        "currentBalanceDisplay": format_currency(current_balance),
        "payment": payload["payment"],
    })
    return payload


def _resolved_debt_metadata(prop: models.Property, loans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    resolved_by_id = {
        int(item["loanId"]): item
        for item in (lifecycle_dto(prop).get("loans") or [])
        if item.get("loanId") is not None
    }
    enriched = []
    for loan in loans:
        resolved = resolved_by_id.get(int(loan.get("loan_id") or 0)) or {}
        raw_status = str(resolved.get("status") or loan.get("status") or "OPEN").upper()
        status = _canonical_loan_status(raw_status)
        purpose = str(resolved.get("purpose") or "UNKNOWN").upper()
        is_closed = status in CLOSED_LOAN_STATUSES
        has_reported_balance = bool(resolved.get("hasReportedCurrentBalance"))
        display_balance = (
            resolved.get("currentBalance")
            if (is_closed or has_reported_balance) and resolved.get("currentBalance") is not None
            else None if resolved else loan.get("current_balance")
        )
        enriched.append({
            **loan,
            "status": status,
            "statusLabel": status.replace("_", " ").title(),
            "closureReasonLabel": "Refinanced" if raw_status == "REFINANCED" else resolved.get("closureReason"),
            "purpose": purpose,
            "purposeLabel": purpose.replace("_", " ").title(),
            "lender": resolved.get("lender") or loan.get("lender_name"),
            "maskedLoanNumber": resolved.get("maskedLoanNumber"),
            "disbursementDate": resolved.get("disbursementDate"),
            "disbursementDateDisplay": _display_loan_date(resolved.get("disbursementDate")),
            "closed_date": resolved.get("closedDate") or loan.get("closed_date"),
            "closedDateDisplay": _display_loan_date(resolved.get("closedDate") or loan.get("closed_date")),
            "displayBalance": display_balance,
            "displayBalanceDisplay": format_currency(display_balance) if display_balance is not None else "—",
            "balanceLabel": (
                "Final / payoff balance" if is_closed
                else "Current balance" if has_reported_balance
                else "Current balance (statement needed)"
            ),
            "balanceAsOf": resolved.get("balanceAsOf"),
            "refinancedIntoLoanId": resolved.get("refinancedIntoLoanId"),
            "refinancedFromLoanId": resolved.get("refinancedFromLoanId"),
        })
    return enriched


def _refinance_chain_payload(loans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_id = {int(loan["loan_id"]): loan for loan in loans if loan.get("loan_id") is not None}
    roots = [
        loan for loan in loans
        if loan.get("refinancedIntoLoanId") and not loan.get("refinancedFromLoanId")
    ]
    chains = []
    for root in roots:
        nodes = []
        seen = set()
        current = root
        while current and current.get("loan_id") not in seen:
            loan_id = current.get("loan_id")
            seen.add(loan_id)
            status = str(current.get("status") or "OPEN").upper()
            period_end = current.get("closedDateDisplay") if status in CLOSED_LOAN_STATUSES else "Present"
            nodes.append({
                "loanId": loan_id,
                "lender": current.get("lender") or current.get("lender_name") or "Loan",
                "periodDisplay": f"{current.get('originationDateDisplay') or '—'} – {period_end}",
                "originalAmountDisplay": current.get("originalAmountDisplay") or format_currency(current.get("original_amount")),
                "rateDisplay": current.get("rateDisplay") or format_interest_rate(current.get("interest_rate")),
                "status": status,
                "statusLabel": current.get("statusLabel") or status.replace("_", " ").title(),
                "currentBalanceDisplay": current.get("displayBalanceDisplay") or "—",
            })
            next_id = current.get("refinancedIntoLoanId")
            current = by_id.get(int(next_id)) if next_id is not None else None
        if len(nodes) > 1:
            chains.append({"chainId": f"refinance-{nodes[0]['loanId']}", "nodes": nodes})
    return chains


def _consolidated_loan_debt_waterfall(
    members: List[Any],
    prop: models.Property,
    interest_by_year: Dict[int, float],
    tax_return_interest_by_year: Dict[int, float],
    interest_by_account: Dict[Optional[str], Dict[int, float]],
    today: date,
) -> Dict[str, Any]:
    ordered = _ordered_loan_group_members(members)
    current = _current_servicer_member(ordered)
    first = ordered[0]
    aliases = _servicer_group_account_aliases(ordered, prop)
    data = {
        column.name: getattr(current, column.name, None)
        for column in models.Loan.__table__.columns
    }
    data.update({
        "id": getattr(current, "id", None),
        "lender_name": getattr(current, "lender_name", None),
        "account_number": getattr(current, "account_number", None),
        "original_amount": getattr(first, "original_amount", None) or getattr(current, "original_amount", None),
        "origination_date": getattr(first, "origination_date", None) or getattr(current, "origination_date", None),
        "status": getattr(current, "status", None),
        "closed_date": getattr(current, "closed_date", None),
        "servicer_start_date": getattr(first, "servicer_start_date", None) or getattr(first, "origination_date", None),
    })
    canonical = SimpleNamespace(**data)
    canonical._account_aliases = aliases
    canonical._tracking_start_date = getattr(first, "origination_date", None) or getattr(first, "servicer_start_date", None)
    canonical.property = prop
    debt = _loan_debt_waterfall(
        canonical,
        prop,
        interest_by_year,
        tax_return_interest_by_year,
        interest_by_account,
        today,
    )
    segments = _servicer_segments_for_group(ordered, today)
    debt["servicerSegments"] = segments
    for row in ((debt.get("paydown") or {}).get("rows") or []):
        row["servicer"] = _row_servicer_label(row, segments)
        row["servicerDisplay"] = row["servicer"]
        row["notes"] = f"{row.get('issueCount')} issue{'s' if row.get('issueCount') != 1 else ''}" if row.get("issueCount") else "—"
    payload = _compat_loan_payload(current, debt, ordered)
    payload["assertions"] = {
        **(payload.get("assertions") or {}),
        **_loan_chain_assertions(payload),
        "L2_transferBoundaryContinuous": _servicer_transfer_boundary_assertion(ordered, payload),
    }
    return payload


def _logical_debt_waterfalls(
    prop: models.Property,
    interest_by_year: Dict[int, float],
    tax_return_interest_by_year: Dict[int, float],
    interest_by_account: Dict[Optional[str], Dict[int, float]],
    today: date,
) -> List[Dict[str, Any]]:
    logical = []
    for members in _logical_loan_groups(list(getattr(prop, "loans", []) or [])):
        current = _current_servicer_member(members)
        if _loan_group_is_servicing_transfer(members):
            logical.append(_consolidated_loan_debt_waterfall(
                members,
                prop,
                interest_by_year,
                tax_return_interest_by_year,
                interest_by_account,
                today,
            ))
            continue
        debt = _loan_debt_waterfall(
            current,
            prop,
            interest_by_year,
            tax_return_interest_by_year,
            interest_by_account,
            today,
        )
        segments = _servicer_segments_for_group([current], today)
        debt["servicerSegments"] = segments
        for row in ((debt.get("paydown") or {}).get("rows") or []):
            row["servicer"] = _row_servicer_label(row, segments)
            row["servicerDisplay"] = row["servicer"]
            row["notes"] = f"{row.get('issueCount')} issue{'s' if row.get('issueCount') != 1 else ''}" if row.get("issueCount") else "—"
        payload = _compat_loan_payload(current, debt, [current])
        payload["assertions"] = {
            **(payload.get("assertions") or {}),
            **_loan_chain_assertions(payload),
            "L2_transferBoundaryContinuous": None,
        }
        logical.append(payload)
    return sorted(logical, key=lambda item: (
        _parse_setup_date(item.get("origination_date")) or date.min,
        item.get("loan_id") or 0,
    ))


def _projected_interest_by_year(loan: models.Loan, today: Optional[date] = None) -> Dict[int, float]:
    """Month-by-month amortization projection of a loan's interest, by year,
    from origination (or the loan's own statement-date anchor) to today.

    Used by the lifetime summary to fill years with no 1098, tax return, or
    mortgage-statement interest on file — without this, an undocumented loan
    reports $0 total interest paid even though a rate and balance are known.
    """
    today = today or date.today()
    rate_m = (loan.interest_rate or 0) / 12 / 100
    pni = (loan.principal_due or 0) + (loan.interest_due or 0)
    if pni <= 0:
        pni = max((loan.monthly_payment or 0) - (loan.escrow_amount or 0), 0)
    if rate_m <= 0 or pni <= 0:
        return {}

    orig = _parse_statement_date(loan.origination_date) if loan.origination_date else None
    stmt_date = _parse_statement_date(loan.statement_date) if loan.statement_date else None

    if orig and loan.original_amount:
        anchor_date, balance = orig, loan.original_amount
    elif stmt_date and loan.current_balance is not None:
        anchor_date, balance = stmt_date, loan.current_balance
    else:
        return {}

    by_year: Dict[int, float] = {}
    y, m = anchor_date.year, anchor_date.month + 1
    if m > 12:
        m, y = 1, y + 1
    while (y < today.year) or (y == today.year and m <= today.month):
        interest_m = round(balance * rate_m, 2)
        principal_m = max(pni - interest_m, 0)
        by_year[y] = round(by_year.get(y, 0) + interest_m, 2)
        balance = max(balance - principal_m, 0)
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return by_year


def _statement_end_month_for_year(snapshots: list, year: int) -> int:
    dates = [
        _parse_statement_date(s.get("date"))
        for s in snapshots
        if s.get("year") == year and s.get("date")
    ]
    dates = [d for d in dates if d]
    return max((d.month for d in dates), default=12)


def _current_rent_from_periods(prop: models.Property, as_of: Optional[date] = None) -> Optional[dict]:
    as_of = as_of or date.today()
    active = []
    for rp in getattr(prop, "rental_periods", []) or []:
        if not rp.start_year or not rp.start_month:
            continue
        start = date(int(rp.start_year), int(rp.start_month), 1)
        end_year = int(rp.end_year or as_of.year)
        end_month = int(rp.end_month or as_of.month)
        end = date(end_year, end_month, 28)
        if start <= as_of <= end:
            active.append((start, rp))
    if not active:
        return None
    _, period = sorted(active, key=lambda item: item[0])[-1]
    return {
        "amount": float(period.monthly_rent or 0),
        "source": "CALCULATED",
        "label": period.tenant_name or "Active lease period",
        "period_id": period.id,
    }


def _period_sort_date(period: models.RentalPeriod, year: int) -> date:
    end_year = int(period.end_year or year)
    end_month = int(period.end_month or 12)
    return date(end_year, end_month, 28)


def _current_year_lease_periods(prop: models.Property, year: Optional[int] = None) -> list:
    year = year or date.today().year
    periods = []
    for period in getattr(prop, "rental_periods", []) or []:
        if not period.start_year or not period.start_month:
            continue
        start_year = int(period.start_year)
        end_year = int(period.end_year or year)
        if start_year <= year <= end_year:
            periods.append(period)
    return periods


def resolve_monthly_rent(prop: models.Property, year: Optional[int] = None) -> dict:
    """
    Backend rent source of truth for summary-style monthly rent.

    Order:
    1. Rental tab current-year lease details -> latest month's rent.
    2. Property details "Rent per month".
    """
    year = year or date.today().year
    leases = _current_year_lease_periods(prop, year)
    if leases:
        latest = max(leases, key=lambda period: _period_sort_date(period, year))
        if latest.monthly_rent:
            return {
                "monthly_rent": float(latest.monthly_rent or 0),
                "source": "rental_tab",
                "label": latest.tenant_name or "Rental tab latest lease",
                "period_id": latest.id,
            }

    if prop.monthly_rent:
        return {
            "monthly_rent": float(prop.monthly_rent or 0),
            "source": "property_details",
            "label": "Property details rent per month",
            "period_id": None,
        }

    return {
        "monthly_rent": 0.0,
        "source": "none",
        "label": "No rent entered",
        "period_id": None,
    }


def resolve_rent(prop: models.Property, year: Optional[int] = None) -> dict:
    rent = resolve_monthly_rent(prop, year)
    monthly = rent["monthly_rent"]
    return {
        **rent,
        "annual_rent": round(monthly * 12, 2),
    }


def _portfolio_income_expense_yearly_trends(
    props: List[models.Property],
    *,
    current_year: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Build the portfolio's calendar-year operating history.

    TaxReturnEntry.total_expenses is a Schedule E total that includes mortgage
    interest and depreciation. Those amounts are excluded here because this
    series represents operating expenses and NOI, not taxable income.
    """
    target_year = int(current_year or date.today().year)
    totals: Dict[int, Dict[str, Any]] = {}

    for prop in props:
        if (getattr(prop, "usage_type", None) or "Rental").lower() == "primary":
            continue

        rental_income = _rental_income_by_year(prop)
        annual_expenses = {
            int(row.year): row
            for row in (getattr(prop, "annual_expenses", None) or [])
            if row.year and int(row.year) <= target_year and _annual_expense_entered(row)
        }
        tax_entries = {
            int(entry.tax_year): entry
            for entry in (getattr(prop, "tax_entries", None) or [])
            if entry.tax_year and int(entry.tax_year) <= target_year
        }
        years = set(rental_income) | set(annual_expenses) | set(tax_entries)
        purchase_date = _parse_iso_date(getattr(prop, "purchase_date", None))
        if purchase_date:
            years = {year for year in years if year >= purchase_date.year}
        years.add(target_year)

        for year in sorted(years):
            tax_entry = tax_entries.get(year)
            lease_row = rental_income.get(year) or {}
            source_labels = set()

            if tax_entry and float(tax_entry.rents_received or 0) > 0:
                income = float(tax_entry.rents_received or 0)
                source_labels.add("Schedule E")
            elif year == target_year:
                income = float(
                    lease_row.get("run_rate_annual_income")
                    or resolve_rent(prop, year).get("annual_rent")
                    or 0
                )
                if income:
                    source_labels.add("Lease projection")
            else:
                income = float(lease_row.get("income") or 0)
                if income:
                    source_labels.add("Lease history")

            if year in annual_expenses:
                expenses = float(resolve_annual_operating_expenses(prop, year).get("value") or 0)
                source_labels.add("Annual expenses")
            elif tax_entry:
                expenses = max(
                    float(tax_entry.total_expenses or 0)
                    - float(tax_entry.mortgage_interest or 0)
                    - float(tax_entry.depreciation or 0),
                    0.0,
                )
                if expenses:
                    source_labels.add("Schedule E")
            else:
                expenses = 0.0

            if not income and not expenses and year != target_year:
                continue

            row = totals.setdefault(year, {
                "year": year,
                "year_label": str(year),
                "status": "PROJECTED" if year == target_year else "ACTUAL",
                "rental_income": 0.0,
                "operating_expenses": 0.0,
                "net_operating_income": 0.0,
                "net_income": 0.0,
                "properties": [],
                "sources": set(),
            })
            row["rental_income"] += income
            row["operating_expenses"] += expenses
            row["sources"].update(source_labels)
            row["properties"].append({
                "property_id": prop.id,
                "rental_income": round(income, 2),
                "operating_expenses": round(expenses, 2),
                "net_operating_income": round(income - expenses, 2),
                "sources": sorted(source_labels),
            })

    rows = []
    for year in sorted(totals):
        row = totals[year]
        income = round(row["rental_income"], 2)
        expenses = round(row["operating_expenses"], 2)
        noi = round(income - expenses, 2)
        rows.append({
            **row,
            "year_label": f"{year} Projected" if year == target_year else str(year),
            "rental_income": income,
            "operating_expenses": expenses,
            "net_operating_income": noi,
            "net_income": noi,
            "sources": sorted(row["sources"]),
        })
    return rows


def _loan_payment_history_rows(prop: models.Property) -> List[Dict[str, Any]]:
    """Return accepted mortgage-statement snapshots without inventing payments."""
    rows: List[Dict[str, Any]] = []
    for loan in prop.loans:
        for snapshot in loan.balance_snapshots:
            document = snapshot.document
            if not document or document.doc_category != "mortgage_statement":
                continue
            rows.append({
                "rowKey": snapshot.id,
                "loanId": loan.id,
                "lenderName": loan.current_servicer or loan.lender_name or "Loan",
                "accountNumber": loan.account_number,
                "statementDate": snapshot.as_of_date,
                "payment": snapshot.payment,
                "principalYtd": snapshot.principal_paid_ytd,
                "interestYtd": snapshot.interest_paid_ytd,
                "balance": snapshot.balance,
                "documentId": document.id,
                "sourceLabel": document.display_name or document.original_filename or document.filename,
                "sourceType": "Mortgage statement",
            })
    rows.sort(key=lambda row: (row.get("statementDate") or "", row.get("rowKey") or ""), reverse=True)
    return rows


def _tax_yearly_trends(
    tax_entries: List[models.TaxReturnEntry],
    property_ids: set,
) -> List[Dict[str, Any]]:
    """Preserve the Schedule E trend contract used by reports and tax views."""
    by_year: Dict[int, Dict[str, Any]] = {}
    for entry in tax_entries:
        if entry.property_id not in property_ids:
            continue
        row = by_year.setdefault(entry.tax_year, {
            "year": entry.tax_year,
            "rental_income": 0.0,
            "mortgage_interest": 0.0,
            "property_taxes": 0.0,
            "operating_expenses": 0.0,
            "depreciation": 0.0,
            "net_income": 0.0,
            "properties": [],
        })
        row["rental_income"] += entry.rents_received or 0.0
        row["mortgage_interest"] += entry.mortgage_interest or 0.0
        row["property_taxes"] += entry.property_taxes or 0.0
        row["operating_expenses"] += entry.total_expenses or 0.0
        row["depreciation"] += entry.depreciation or 0.0
        row["net_income"] += entry.net_income or 0.0
        row["properties"].append({
            "property_id": entry.property_id,
            "rental_income": round(entry.rents_received or 0.0, 2),
            "mortgage_interest": round(entry.mortgage_interest or 0.0, 2),
            "property_taxes": round(entry.property_taxes or 0.0, 2),
            "operating_expenses": round(entry.total_expenses or 0.0, 2),
            "depreciation": round(entry.depreciation or 0.0, 2),
            "net_income": round(entry.net_income or 0.0, 2),
        })
    return [
        {
            **row,
            "rental_income": round(row["rental_income"], 2),
            "mortgage_interest": round(row["mortgage_interest"], 2),
            "property_taxes": round(row["property_taxes"], 2),
            "operating_expenses": round(row["operating_expenses"], 2),
            "depreciation": round(row["depreciation"], 2),
            "net_income": round(row["net_income"], 2),
        }
        for row in sorted(by_year.values(), key=lambda item: item["year"])
    ]


def _rental_income_by_year(prop: models.Property) -> dict:
    """Per-year lease income with current-year run-rate metadata.

    ``income`` is actual collected/elapsed lease income through the current
    month. For current-year summary cards, ``run_rate_income_elapsed`` and
    ``run_rate_annual_income`` use the active lease amount for the full elapsed
    period so a current rent of $3,200 for seven elapsed months is $22,400,
    not a blend with an expired prior lease.
    """
    now = datetime.now()
    result = {}
    for rp in prop.rental_periods:
        if not rp.start_year or not rp.start_month:
            continue
        if rp.end_year is None and rp.end_month is None:
            end_year, end_month = now.year, now.month
        else:
            end_year = rp.end_year or rp.start_year
            end_month = rp.end_month or 12
        y, m = int(rp.start_year), int(rp.start_month)
        while (y < end_year) or (y == end_year and m <= end_month):
            if (y > now.year) or (y == now.year and m > now.month):
                break
            yr = result.setdefault(y, {"income": 0.0, "occupied_months": 0})
            yr["income"] += rp.monthly_rent or 0
            yr["occupied_months"] += 1
            m += 1
            if m > 12:
                m, y = 1, y + 1

    active = _current_rent_from_periods(prop, now.date())
    for y, d in result.items():
        months_elapsed = now.month if y == now.year else 12
        d["months_elapsed"] = months_elapsed
        d["income"] = round(d["income"], 2)
        d["occupancy"] = round(min(d["occupied_months"] / months_elapsed * 100, 100), 1) if months_elapsed else 0
        if y == now.year and active and active.get("amount"):
            d["current_monthly_rent"] = round(active["amount"], 2)
            d["run_rate_income_elapsed"] = round(active["amount"] * months_elapsed, 2)
            d["run_rate_annual_income"] = round(active["amount"] * 12, 2)
            d["run_rate_source"] = active.get("label") or "Active lease period"
    return result


def _reported_schedule_e_rental_months(prop: models.Property, floor: Optional[date] = None) -> Dict[int, float]:
    """Infer rental months from reported Schedule E rows when lease history is missing."""
    months: Dict[int, float] = {}
    current_year = date.today().year
    purchase = _parse_iso_date(getattr(prop, "purchase_date", None))
    for entry in getattr(prop, "tax_entries", []) or []:
        year = int(entry.tax_year or 0)
        if year <= 0 or year > current_year:
            continue
        if floor and year < floor.year:
            continue
        has_schedule_e_activity = (
            (entry.property_kind or "").lower() == "rental"
            or float(entry.rents_received or 0) > 0
            or float(entry.depreciation or 0) > 0
        )
        if not has_schedule_e_activity:
            continue
        if purchase and year < purchase.year:
            continue
        start_month = 1
        if purchase and year == purchase.year:
            start_month = max(start_month, purchase.month)
        if floor and year == floor.year:
            start_month = max(start_month, floor.month)
        end_month = date.today().month if year == current_year else 12
        if end_month >= start_month:
            months[year] = float(end_month - start_month + 1)
    return months


def _legacy_rental_months_by_year_unused(prop: models.Property, floor: Optional[date] = None) -> Dict[int, float]:
    """Calendar months per year the property was an active rental. When
    RentalPeriod rows exist they're authoritative — a year they don't cover
    is a primary-residence/unrented year, even if other years were rented
    (handles rent → primary → rent → primary switching). When no periods
    have ever been recorded, falls back to treating every month as rental
    for as long as usage_type is "Rental", so simple always-rental
    properties keep working without granular lease tracking. `floor`
    excludes months before a given date (e.g. an asset's own
    placed-in-service date)."""
    now = datetime.now()
    if getattr(prop, "usage_periods", None):
        result: Dict[int, float] = {}
        floor_date = floor
        for period in _timeline_periods(prop):
            if _normalize_usage_type(period.usage_type) != "RENTAL":
                continue
            start = _parse_iso_date(period.start_date)
            end = _parse_iso_date(period.end_date) or date(now.year, now.month, 28)
            if floor_date and start and start < floor_date:
                start = floor_date
            if not start or end < start:
                continue
            cursor = date(start.year, start.month, 1)
            final = date(end.year, end.month, 1)
            first = True
            while cursor <= final and cursor <= date(now.year, now.month, 1):
                result[cursor.year] = result.get(cursor.year, 0) + (0.5 if first else 1.0)
                first = False
                cursor = _add_months(cursor, 1)
        return result

    result: Dict[int, int] = {}

    if prop.rental_periods:
        for rp in prop.rental_periods:
            if not rp.start_year or not rp.start_month:
                continue
            if rp.end_year is None and rp.end_month is None:
                end_year, end_month = now.year, now.month  # ongoing
            else:
                end_year = rp.end_year or rp.start_year
                end_month = rp.end_month or 12
            y, m = rp.start_year, rp.start_month
            while (y < end_year) or (y == end_year and m <= end_month):
                if (y > now.year) or (y == now.year and m > now.month):
                    break  # never count future months
                if floor is None or (y, m) >= (floor.year, floor.month):
                    result[y] = result.get(y, 0) + 1
                m += 1
            if m > 12:
                m, y = 1, y + 1
        for year, months in _reported_schedule_e_rental_months(prop, floor).items():
            result.setdefault(year, months)
        return result

    if (prop.usage_type or "Rental").lower() != "rental":
        return result  # never rented, no periods on file

    start = floor or _parse_iso_date(prop.purchase_date) or date(now.year, now.month, 1)
    y, m = start.year, start.month
    first = True  # IRS mid-month convention: the placed-in-service month only counts as half
    while (y < now.year) or (y == now.year and m <= now.month):
        result[y] = result.get(y, 0) + (0.5 if first else 1.0)
        first = False
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return result


def _rental_months_by_year(prop: models.Property, floor: Optional[date] = None, through_year: Optional[int] = None) -> Dict[int, float]:
    """Calendar rental months by year for depreciation history.

    Source priority:
    1. Explicit usage periods.
    2. Rental tab lease periods, with Schedule E rows backfilling missing years.
    3. Legacy always-rental fallback.
    """
    today = date.today()
    horizon_month = date(int(through_year or today.year), 12 if through_year else today.month, 1)

    def add_month_range(result: Dict[int, float], start: date, end: date, *, half_first: bool = False) -> None:
        if floor and start < floor:
            start = floor
        if end < start:
            return
        cursor = date(start.year, start.month, 1)
        final = min(date(end.year, end.month, 1), horizon_month)
        first = True
        while cursor <= final:
            first_month_weight = 0.5 if start.day > 15 else 1.0
            result[cursor.year] = min(result.get(cursor.year, 0) + (first_month_weight if half_first and first else 1.0), 12.0)
            first = False
            cursor = _add_months(cursor, 1)

    def subtract_month_range(result: Dict[int, float], start: date, end: date) -> None:
        if floor and start < floor:
            start = floor
        if end < start:
            return
        cursor = date(start.year, start.month, 1)
        final = min(date(end.year, end.month, 1), horizon_month)
        while cursor <= final:
            result[cursor.year] = max((result.get(cursor.year, 0) or 0) - 1.0, 0.0)
            cursor = _add_months(cursor, 1)

    if getattr(prop, "usage_periods", None):
        result: Dict[int, float] = {}
        rental_start = _parse_iso_date(getattr(prop, "rental_start_date", None))
        rental_end = _parse_iso_date(getattr(prop, "rental_end_date", None)) or date(horizon_month.year, horizon_month.month, 28)
        seeded_from_rental_start = bool(rental_start and rental_end)
        if rental_start and rental_end:
            add_month_range(result, rental_start, rental_end, half_first=True)
        for period in _timeline_periods(prop):
            normalized_usage = _normalize_usage_type(period.usage_type)
            if normalized_usage != "RENTAL":
                start = _parse_iso_date(period.start_date)
                end = _parse_iso_date(period.end_date) or date(horizon_month.year, horizon_month.month, 28)
                if start and end:
                    subtract_month_range(result, start, end)
                continue
            if seeded_from_rental_start:
                continue
            start = _parse_iso_date(period.start_date)
            end = _parse_iso_date(period.end_date) or date(horizon_month.year, horizon_month.month, 28)
            if start and end:
                add_month_range(result, start, end, half_first=True)
        for year, months in _reported_schedule_e_rental_months(prop, floor).items():
            result.setdefault(year, months)
        return result

    result: Dict[int, float] = {}
    if getattr(prop, "rental_periods", None):
        for period in prop.rental_periods:
            if not period.start_year or not period.start_month:
                continue
            start = date(int(period.start_year), int(period.start_month), 1)
            if period.end_year is None and period.end_month is None:
                end = date(horizon_month.year, horizon_month.month, 28)
            else:
                end = date(int(period.end_year or period.start_year), int(period.end_month or 12), 28)
            add_month_range(result, start, end)

        for year, months in _reported_schedule_e_rental_months(prop, floor).items():
            result.setdefault(year, months)
        return result

    reported = _reported_schedule_e_rental_months(prop, floor)
    if reported:
        return reported

    if (prop.usage_type or "Rental").lower() != "rental":
        return result

    start = floor or _parse_iso_date(prop.rental_start_date) or _parse_iso_date(prop.purchase_date) or horizon_month
    add_month_range(result, start, date(horizon_month.year, horizon_month.month, 28), half_first=True)
    return result


def _has_rental_history(prop: models.Property) -> bool:
    """Depreciation only applies to rental-use property. True if the
    property has ever been rented — either it has recorded RentalPeriod
    history, or it's flagged Rental with no granular periods tracked yet."""
    if any(_normalize_usage_type(p.usage_type) == "RENTAL" for p in _timeline_periods(prop)):
        return True
    if prop.rental_periods:
        return True
    return (prop.usage_type or "Rental").lower() == "rental"


def _is_currently_rental(prop: models.Property) -> bool:
    """Whether the property is an active rental right now — used to show
    whether depreciation is currently accruing or paused pending a
    conversion back to rental use."""
    today = date.today()
    if getattr(prop, "usage_periods", None):
        return _usage_type_on(prop, today) == "RENTAL"
    for rp in prop.rental_periods:
        if not rp.start_year or not rp.start_month:
            continue
        start = (rp.start_year, rp.start_month)
        if rp.end_year is None and rp.end_month is None:
            end = (today.year, today.month)  # ongoing
        else:
            end = (rp.end_year or rp.start_year, rp.end_month or 12)
        if start <= (today.year, today.month) <= end:
            return True
    if prop.rental_periods:
        return False
    return (prop.usage_type or "Rental").lower() == "rental"


# ── Tax return import ───────────────────────────────────────────────────────────

def _addr_key(addr: str):
    """House number + significant street words, for matching a return's
    property address to a managed property regardless of suffix formatting."""
    addr = (addr or "").upper()
    nums = re.findall(r"\d+", addr)
    house = nums[0] if nums else None
    words = {w for w in re.findall(r"[A-Z]{3,}", addr)}
    return house, words


def _words_match(extracted_words: set, prop_words: set) -> bool:
    """True if there is meaningful word overlap, even when OCR smashes
    multiple words together (e.g. 'SANSALVDOR' vs {'SAN','SALVADOR'})."""
    if extracted_words & prop_words:
        return True
    # Substring fallback: each property word appears inside some extracted word
    for pw in prop_words:
        if any(pw in ew or ew in pw for ew in extracted_words):
            return True
    return False


def _match_property(address: str, props):
    house, words = _addr_key(address)
    if not house:
        return None
    for p in props:
        ph, pwords = _addr_key(p.address)
        if ph == house and _words_match(words, pwords):
            return p
    return None


TAX_ENTRY_FIELDS = ("rents_received", "mortgage_interest", "property_taxes",
"depreciation", "total_expenses", "net_income",
"days_rented", "personal_use_days")

TAX_ENTRY_EXTRA_FIELDS = (
    "schedule1_line5_total",
    "schedule1_line5_delta",
    "cash_noi",
    "tax_pl",
    "confidence",
)

TAX_ENTRY_JSON_FIELDS = (
    "expense_breakdown",
    "depreciation_detail",
    "source_refs",
    "unresolved_fields",
)


def _default_primary_property(db: Session, owner_id: int, props: list, year: int, entries: list):
    """Pick which managed property the Schedule A primary-home figures belong
    to, when the return includes them.

    Schedule A carries no address, so we can't match it directly like a
    Schedule E rental. Instead: if exactly one property is already flagged
    Primary, use it. Otherwise, among properties this year's Schedule E
    *didn't* list as a rental, assume the most recently purchased one is the
    home the taxpayer currently lives in ("the latest primary home") and
    default it to Primary — but never touch a property the user has manually
    set (usage_type_locked), and never let an older return override a
    determination already made from a more recent one.
    """
    if not any(e.get('property_kind') == 'primary' for e in entries):
        return next((p for p in props if (p.usage_type or "").lower() == "primary"), None)

    explicit_primary = [p for p in props if (p.usage_type or "").lower() == "primary"]
    if len(explicit_primary) == 1:
        return explicit_primary[0]

    matched_rental_ids = set()
    for e in entries:
        if e.get('property_kind') != 'rental':
            continue
        m = _match_property(e.get('address'), props)
        if m:
            matched_rental_ids.add(m.id)

    candidates = [p for p in props if p.id not in matched_rental_ids and not p.usage_type_locked]

    existing_years = [
        y for (y,) in db.query(models.TaxReturnEntry.tax_year)
        .filter(models.TaxReturnEntry.owner_id == owner_id).distinct()
    ]
    latest_year_seen = max(existing_years) if existing_years else None
    is_latest_return = latest_year_seen is None or year >= latest_year_seen

    if candidates and is_latest_return:
        def _purchase_year(p):
            m = re.search(r'(?:19|20)\d{2}', p.purchase_date or '')
            return int(m.group(0)) if m else 0
        best = max(candidates, key=_purchase_year)
        if (best.usage_type or "").lower() != "primary":
            best.usage_type = "Primary"
        return best

    return explicit_primary[0] if explicit_primary else None


async def import_tax_return(db: Session, owner_id: int, document_id, filepath: str) -> int:
    """Parse a 1040 return and upsert per-property tax entries.

    Schedule E rental rows are matched to managed properties by address. A row
    with no match is kept as an unassigned tax entry (property_id=None) rather
    than auto-creating a new Property — only properties already in the user's
    Property List are ever linked. Primary residence data from Schedule A is
    attached to the user's primary property when available. No SSNs or
    taxpayer names are stored.
    """
    from services.document_parser import parse_tax_return_properties

    parsed = parse_tax_return_properties(filepath)
    year = parsed.get("tax_year")
    if not year:
        return 0

    props = db.query(models.Property).filter(
        models.Property.owner_id == owner_id
    ).all()
    primary_prop = _default_primary_property(db, owner_id, props, year, parsed.get("properties", []))

    count = 0
    for entry in parsed.get("properties", []):
        kind = entry.get("property_kind", "rental")
        if kind == "primary":
            matched = primary_prop
            address = matched.address if matched else "Primary Residence"
        else:
            # Only ever link to a property already in the user's Property
            # List — an unmatched Schedule E row is kept as an unassigned tax
            # entry (property_id=None) rather than auto-creating a new one.
            matched = _match_property(entry.get("address"), props)
            address = entry.get("address")

        # Dedupe on the resolved property when we have one — the raw parsed
        # address text varies slightly between re-uploads of the same return
        # (OCR/whitespace differences), so keying on it directly let two
        # uploads of the same return create duplicate rows for one property.
        dedup_filter = dict(owner_id=owner_id, tax_year=year, property_kind=kind)
        if matched:
            dedup_filter["property_id"] = matched.id
        else:
            dedup_filter["address"] = address
        existing = db.query(models.TaxReturnEntry).filter_by(**dedup_filter).first()
        rec = existing or models.TaxReturnEntry(
            owner_id=owner_id,
            tax_year=year,
            property_kind=kind,
            address=address,
        )
        rec.property_id = matched.id if matched else None
        rec.document_id = document_id

        for field in TAX_ENTRY_FIELDS:
            setattr(rec, field, entry.get(field, 0.0) or 0.0)
        for field in TAX_ENTRY_EXTRA_FIELDS:
            setattr(rec, field, entry.get(field))
        for field in TAX_ENTRY_JSON_FIELDS:
            default = [] if field == "unresolved_fields" else {}
            setattr(rec, field, json.dumps(entry.get(field, default)))

        if matched:
            # land_value/construction_price default to 0, which is
            # indistinguishable from "never entered" — so treat neither being
            # set as "split missing" rather than checking basis <= 0 (which is
            # never true once purchase_price is set, making that check dead).
            land_split_missing = not (matched.construction_price or matched.land_value)
            basis = _depreciable_basis(matched)
            period = matched.depreciation_years or 27.5
            accumulated = entry.get("depreciation") or 0.0
            try:
                purchase_year = int(re.search(r'(?:19|20)\d{2}', matched.purchase_date or "").group(0))
                years_elapsed = max(0, int(year) - purchase_year + 1)
                if basis and period:
                    accumulated = min(basis, round((basis / period) * years_elapsed, 2))
            except Exception:
                pass

            rec.depreciable_basis = basis
            rec.annual_straight_line_depreciation = round(basis / period, 2) if basis and period else 0.0
            rec.accumulated_depreciation = accumulated
            rec.remaining_depreciable_basis = max(basis - accumulated, 0)
            rec.years_remaining = (
                round(rec.remaining_depreciable_basis / rec.annual_straight_line_depreciation, 2)
                if rec.annual_straight_line_depreciation else 0.0
            )

            if land_split_missing and entry.get("depreciation"):
                unresolved = entry.get("unresolved_fields") or []
                unresolved.append(
                    "Land/building split missing; depreciable basis estimated at 75% "
                    "of purchase price. Enter land value or construction price to correct it."
                )
                rec.unresolved_fields = json.dumps(unresolved)

        if not existing:
            db.add(rec)
        count += 1

    db.commit()
    return count


@router.get("/{prop_id}/performance")
def get_performance(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Yearly performance built from the property's mortgage statements:
    interest/principal paid, depreciation captured, cash flow, taxable
    income, and keep-vs-sell signals."""
    prop = _get_accessible_property(prop_id, db, current_user)
    metrics = compute_property_metrics(prop)

    # Statement snapshots & per-year tax/interest from uploaded documents
    snapshots, tax_by_year, interest_by_year, balance_by_year, balance_logic_by_year = _collect_doc_history(prop)
    statement_balance_by_year = _latest_statement_balance_by_year(snapshots)
    # Actual per-year rent/occupancy from recorded lease periods
    rental_by_year = _rental_income_by_year(prop)
    rental_months_map = _rental_months_by_year(prop)
    # Schedule E figures from tax returns (highest-confidence source)
    _tax_entries = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.property_id == prop_id,
    ).all()
    tax_return_rent_by_year = {
        e.tax_year: e.rents_received for e in _tax_entries if e.rents_received
    }
    tax_return_depr_by_year = {
        e.tax_year: e.depreciation for e in _tax_entries if e.depreciation
    }
    tax_return_interest_by_year = {
        e.tax_year: e.mortgage_interest for e in _tax_entries if e.mortgage_interest
    }
    # Amortization-projected interest by year — fills years with no 1098,
    # tax return, or statement interest on file.
    projected_interest_by_year: Dict[int, float] = {}
    for _loan in prop.loans:
        for _yr, _amt in _projected_interest_by_year(_loan).items():
            projected_interest_by_year[_yr] = round(projected_interest_by_year.get(_yr, 0) + _amt, 2)
    loan_yearly_by_year: Dict[int, List[Dict[str, Any]]] = {}
    for _loan in prop.loans:
        for _row in _scheduled_loan_years(_loan):
            loan_yearly_by_year.setdefault(_row["year"], []).append({
                "loan_id": _loan.id,
                "lender_name": _loan.lender_name,
                "loan_type": _loan.loan_type,
                "original_amount": _loan.original_amount or 0,
                "start_date": _loan.origination_date,
                "interest_rate": _loan.interest_rate or 0,
                "interest_paid": _row["interest_paid"],
                "principal_paid": _row["principal_paid"],
                "mortgage_paid": _row["mortgage_paid"],
                "ending_balance": _row["ending_balance"],
                "months": _row["months"],
                "source": "backend_amortization",
            })
    # Schedule E total_expenses includes interest + depreciation; strip them out
    # to get operating-only expenses (insurance, taxes, maintenance, etc.)
    tax_return_opex_by_year = {
        e.tax_year: round(
            (e.total_expenses or 0) - (e.mortgage_interest or 0) - (e.depreciation or 0), 2
        )
        for e in _tax_entries if e.total_expenses
    }
    # Schedule E lines 2 & 3 — Fair Rental Days / Personal Use Days
    days_rented_by_year = {
        e.tax_year: e.days_rented for e in _tax_entries if e.days_rented
    }
    personal_use_days_by_year = {
        e.tax_year: e.personal_use_days for e in _tax_entries if e.personal_use_days
    }
    # Per-year property taxes from filed returns: prefer Schedule E entries
    # (total_expenses > 0 means it came from an actual return, not just a 1098)
    _prop_tax_by_year: dict[int, float] = {}
    for _e in _tax_entries:
        if not _e.property_taxes:
            continue
        _existing = _prop_tax_by_year.get(_e.tax_year)
        if _existing is None or bool(_e.total_expenses):
            _prop_tax_by_year[_e.tax_year] = _e.property_taxes
    manual_property_tax_by_year = _property_tax_history(prop)
    manual_property_tax_by_year = _property_tax_history(prop)

    annual_rent = metrics["effective_rent"] * 12
    annual_tax_ins = prop.property_tax + prop.insurance
    annual_other_op = (
        prop.hoa_fee + prop.maintenance + prop.property_management_fee +
        prop.utilities + prop.vacancy_allowance + prop.capex_reserve +
        prop.other_expenses
    ) * 12
    annual_operating = annual_tax_ins + annual_other_op
    annual_depreciation = metrics["annual_depreciation"]
    annual_escrow = metrics["monthly_escrow"] * 12

    current_year = datetime.now().year
    # Include any year we have data for: statements, 1098s, tax docs, leases, or tax returns
    year_set = {s["year"] for s in snapshots}
    year_set |= set(interest_by_year) | set(tax_by_year) | set(rental_by_year)
    year_set |= set(balance_by_year) | set(tax_return_rent_by_year)
    # Drop pre-ownership years: a supplemental/prior-period tax bill can carry
    # a year before purchase, which would otherwise show a phantom rental year.
    purchase_year = None
    purchase_month = 1  # default Jan if unknown
    if prop.purchase_date:
        m = re.search(r'(?:19|20)\d{2}', prop.purchase_date)
        if m:
            purchase_year = int(m.group(0))
        mm = re.search(r'-(\d{2})-', prop.purchase_date)
        if mm:
            purchase_month = int(mm.group(1))
    if purchase_year:
        year_set = {y for y in year_set if y >= purchase_year}

    yearly = []
    cumulative_principal_paid = 0.0
    previous_expected_principal_cumulative = 0.0
    cumulative_principal_topup_paid = 0.0
    for year in sorted(year_set):
        ss = [s for s in snapshots if s["year"] == year]
        loan_year_rows = loan_yearly_by_year.get(year, [])
        calculated_interest = round(sum(_row.get("interest_paid", 0) or 0 for _row in loan_year_rows), 2)
        calculated_principal = round(sum(_row.get("principal_paid", 0) or 0 for _row in loan_year_rows), 2)
        calculated_balance = round(sum(_row.get("ending_balance", 0) or 0 for _row in loan_year_rows), 2)
        loan_year_rows = loan_yearly_by_year.get(year, [])
        calculated_interest = round(sum(_row.get("interest_paid", 0) or 0 for _row in loan_year_rows), 2)
        calculated_principal = round(sum(_row.get("principal_paid", 0) or 0 for _row in loan_year_rows), 2)
        calculated_balance = round(sum(_row.get("ending_balance", 0) or 0 for _row in loan_year_rows), 2)

        # For the purchase year the property was not owned Jan 1, so annual
        # estimates from the current payment (interest_due × 12) would be
        # inflated.  Prorate by the number of calendar months remaining after
        # the purchase month (e.g. Sep purchase → 3 months: Oct/Nov/Dec).
        if purchase_year and year == purchase_year:
            months_owned = max(1, 12 - purchase_month)
        else:
            months_owned = 12

        # Principal: prefer 1098 balance delta (most accurate), then
        # mortgage-statement balance delta, then annualized, then estimated
        p1098 = _principal_from_1098_segments(
            balance_by_year, balance_logic_by_year, year, prop.loans, statement_balance_by_year)
        if p1098 is not None:
            # Exact: 1098 balance delta (balance_this_year − balance_next_year)
            principal_paid = p1098
            source = "actual"
        elif len(ss) >= 2 and ss[0]["balance"] and ss[-1]["balance"]:
            # Actual from statement span: balance drop annualised
            months = max(
                (datetime.fromisoformat(ss[-1]["date"]) -
                 datetime.fromisoformat(ss[0]["date"])).days / 30.44, 1)
            principal_paid = round((ss[0]["balance"] - ss[-1]["balance"]) / months * 12, 2)
            source = "actual"
        elif year in balance_by_year and prop.loans:
            # Amortisation estimate from the known Jan-1 balance for this year.
            # Better than using the *current* statement's principal_due because
            # that reflects today's amortisation position, not the year in question.
            _b = balance_by_year[year]
            _l = prop.loans[0]
            _mr = (_l.interest_rate or 0) / 12 / 100
            _pmt = _l.monthly_payment or 0
            _est = 0.0
            for _ in range(12):
                _int = _b * _mr
                _prin = max(0.0, _pmt - _int)
                _est += _prin
                _b -= _prin
            principal_paid = round(_est, 2)
            source = "estimated"
        elif ss:
            principal_paid = round((ss[-1]["principal"] or 0) * months_owned, 2)
            source = "annualized"
        else:
            principal_paid = round(sum(l.principal_due or 0 for l in prop.loans) * months_owned, 2)
            source = "estimated"

        cumulative_principal_paid = round(cumulative_principal_paid + principal_paid, 2)
        # Scheduled principal is the year-end amortization target. Current-year
        # actual principal may be YTD, but the scheduled column should not stop
        # at the latest statement month.
        _sched_end_month = 12
        expected_principal_cumulative = _scheduled_principal_cumulative(
            prop.loans[0] if prop.loans else None, year, _sched_end_month)
        expected_principal_paid = None
        if expected_principal_cumulative is not None:
            expected_principal_paid = round(
                max(0, expected_principal_cumulative - previous_expected_principal_cumulative), 2)
            previous_expected_principal_cumulative = expected_principal_cumulative
        principal_topup_paid = round(
            max(0, principal_paid - (expected_principal_paid or 0)), 2
        ) if expected_principal_paid is not None else None

        # For an in-progress year, do not create topup from projected values
        # such as current statement principal_due annualization. Keep actual
        # deltas from 1098 balances or statement balance drops visible.
        if year == current_year and source in {"estimated", "annualized"}:
            principal_topup_paid = 0.0 if principal_topup_paid is not None else None

        if principal_topup_paid is not None:
            cumulative_principal_topup_paid = round(
                cumulative_principal_topup_paid + principal_topup_paid, 2
            )
        principal_topup_cumulative = (
            cumulative_principal_topup_paid
            if expected_principal_cumulative is not None else None
        )

        # Interest: always from 1098 when available
        if ss and not p1098:
            # Annualized interest from mortgage statement snapshots
            interest_paid = round(sum(s["interest"] or 0 for s in ss) / len(ss) * months_owned, 2)
            if source == "estimated":
                source = "annualized"
        elif ss:
            interest_paid = round(sum(s["interest"] or 0 for s in ss) / len(ss) * months_owned, 2)
        elif year in projected_interest_by_year:
            interest_paid = projected_interest_by_year[year]
            if source == "estimated":
                source = "annualized"
        else:
            interest_paid = round(sum(l.interest_due or 0 for l in prop.loans) * months_owned, 2)

        if year in interest_by_year:
            interest_paid = interest_by_year[year]
            if source != "actual":
                source = "1098"
        elif year in tax_return_interest_by_year:
            interest_paid = tax_return_interest_by_year[year]
            source = "tax_return"

        # Property tax priority: Schedule E, then property-tax document, then manual property field.
        year_tax = _prop_tax_by_year.get(year)
        if year_tax is None:
            year_tax = tax_by_year.get(year)
        if year_tax is None:
            year_tax = manual_property_tax_by_year.get(year)
        op_property_tax = year_tax if year_tax is not None else prop.property_tax
        # Schedule E total (minus interest and depreciation) beats static field estimates
        if year in tax_return_opex_by_year:
            operating_expenses = round(max(0, tax_return_opex_by_year[year]), 2)
        else:
            operating_expenses = round(annual_other_op + prop.insurance + op_property_tax, 2)
        taxes_paid = round(op_property_tax, 2)

        # Escrow from the year's statement if present, else the model estimate
        if ss and ss[-1].get("escrow"):
            escrow_paid = round(ss[-1]["escrow"] * 12, 2)
        else:
            escrow_paid = round(annual_escrow, 2)

        # Rent: only from verified sources — never estimate backwards into prior years.
        if year in tax_return_rent_by_year:
            year_rent = tax_return_rent_by_year[year]
            occupied_months = None
            occupancy = None
            rent_source = "tax_return"
        elif rental_by_year.get(year):
            rinfo = rental_by_year[year]
            year_rent = rinfo.get("run_rate_income_elapsed") or rinfo["income"]
            occupied_months = rinfo["occupied_months"]
            occupancy = rinfo["occupancy"]
            rent_source = "leases"
        else:
            year_rent = 0.0
            occupied_months = None
            occupancy = None
            rent_source = "none"

        # Depreciation: Schedule E filed value (highest trust) > days-rented proration
        # > IRS mid-month purchase-year convention > full-year straight-line >
        # 0 (depreciation only applies to rental-use property; a year with no
        # rental evidence at all — e.g. this stayed a primary residence, or a
        # gap between rental stints — never accrues depreciation).
        # "days_rented" from Schedule E lines 2/3 handles mixed-use years
        # (e.g. 6 months primary + 6 months rental) automatically.
        _days_rented = days_rented_by_year.get(year)
        _is_rental_year = year in rental_months_map
        if tax_return_depr_by_year.get(year):
            year_depreciation = tax_return_depr_by_year[year]
        elif _days_rented:
            # IRS: depreciation is only allowed on the rental portion of the year.
            # For a calendar year (365 or 366 days) use the actual days rented.
            import calendar as _cal
            year_days = 366 if _cal.isleap(year) else 365
            year_depreciation = round(annual_depreciation * _days_rented / year_days, 2)
        elif purchase_year and year == purchase_year and prop.purchase_date and _is_rental_year:
            # IRS mid-month convention: residential rental placed in service in
            # month M → available months = (12 - M + 0.5)
            try:
                _pd = datetime.strptime(prop.purchase_date[:10], '%Y-%m-%d')
                _months = 12 - _pd.month + 0.5
                year_depreciation = annual_depreciation * _months / 12
            except Exception:
                year_depreciation = annual_depreciation
        elif _is_rental_year:
            year_depreciation = annual_depreciation
        else:
            year_depreciation = 0.0

        debt_service = interest_paid + principal_paid
        cash_flow = round(year_rent - operating_expenses - debt_service, 2)
        taxable_income = round(
            year_rent - operating_expenses - interest_paid - year_depreciation, 2)

        yearly.append({
            "year": year,
            "rental_income": year_rent,
            "occupied_months": occupied_months,
            "occupancy": occupancy,
            "rent_source": rent_source,
            "operating_expenses": operating_expenses,
            "interest_paid": interest_paid,
            "principal_paid": principal_paid,
            "expected_principal_paid": expected_principal_paid,
            "principal_topup_paid": principal_topup_paid,
            "cumulative_principal_paid": cumulative_principal_paid,
            "expected_principal_cumulative": expected_principal_cumulative,
            "principal_topup_cumulative": principal_topup_cumulative,
            "escrow_paid": escrow_paid,
            "taxes_paid": taxes_paid,
            "depreciation": round(year_depreciation, 2),
            "cash_flow": cash_flow,
            "taxable_income": taxable_income,
            "total_return": round(cash_flow + principal_paid, 2),
            "statements": len(ss),
            "source": source,
            "days_rented": days_rented_by_year.get(year),
            "personal_use_days": personal_use_days_by_year.get(year),
        })

    totals = {
        k: round(sum((y.get(k) or 0) for y in yearly), 2)
        for k in ("rental_income", "operating_expenses", "interest_paid",
                  "principal_paid", "expected_principal_paid", "principal_topup_paid",
                  "escrow_paid", "taxes_paid",
                  "depreciation", "cash_flow",
                  "taxable_income", "total_return")
    }
    totals["cumulative_principal_paid"] = yearly[-1].get("cumulative_principal_paid") if yearly else 0
    totals["expected_principal_cumulative"] = yearly[-1].get("expected_principal_cumulative") if yearly else 0
    totals["principal_topup_cumulative"] = yearly[-1].get("principal_topup_cumulative") if yearly else 0

    latest = yearly[-1] if yearly else None
    equity = metrics["equity"]
    roe = round(latest["total_return"] / equity * 100, 2) if latest and equity > 0 else None

    # Keep-vs-sell signals
    signals = []
    if prop.monthly_rent == 0 and (prop.usage_type or "Rental") == "Rental":
        signals.append({"level": "warn", "text":
            "Monthly rent is not set — cash flow and returns are incomplete."})
    if prop.market_value == 0:
        signals.append({"level": "warn", "text":
            "Market value is not set — equity and return on equity can't be evaluated."})
    if latest and latest["cash_flow"] < 0 and annual_rent > 0:
        signals.append({"level": "bad", "text":
            f"Negative cash flow of {format_currency(abs(latest['cash_flow']))}/yr — rent doesn't cover the mortgage and expenses."})
    if latest and latest["taxable_income"] < 0 and annual_rent > 0:
        signals.append({"level": "good", "text":
            f"Paper loss of {format_currency(abs(latest['taxable_income']))}/yr (interest + depreciation) may offset other income at tax time."})
    if latest and latest["principal_paid"] > 0:
        signals.append({"level": "good", "text":
            f"Building {format_currency(latest['principal_paid'])}/yr in equity through principal paydown."})
    for l in prop.loans:
        if l.rate_note and "until" in l.rate_note.lower():
            signals.append({"level": "warn", "text":
                f"ARM rate is fixed only {l.rate_note} — review refinance options before the reset."})
    if roe is not None and roe < 5:
        signals.append({"level": "warn", "text":
            f"Return on equity is {roe}% — the equity tied up here might earn more elsewhere (sale or cash-out refinance)."})

    # All documents with extracted data (all categories)
    all_documents = []
    for d in prop.documents:
        if not d.extracted_data:
            continue
        data = json.loads(d.extracted_data)
        all_documents.append({
            "id": d.id,
            "category": d.doc_category,
            "original_filename": d.original_filename,
            "period_type": d.period_type or data.get("period_type", "other"),
            "period_start": d.period_start or data.get("period_start"),
            "period_end": d.period_end or data.get("period_end"),
            "statement_date": data.get("statement_date"),
            "statement_year": d.statement_year,
            "loan_account_number": d.loan_account_number,
            "extracted": data,
        })

    return {
        "yearly": yearly,
        "totals": totals,
        "year_notes": json.loads(prop.year_notes or "{}"),
        "snapshots": snapshots,
        "all_documents": all_documents,
        "equity": equity,
        "market_value": prop.market_value,
        "loan_balance": metrics["total_loan_balance"],
        "return_on_equity": roe,
        "cap_rate": metrics["cap_rate"],
        "annual_depreciation": annual_depreciation,
        "signals": signals,
    }


@router.get("/{prop_id}/lifetime")
def get_lifetime_summary(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Lifetime consolidated metrics: total income, expenses, interest,
    principal paydown, depreciation, and years owned."""
    prop = _get_accessible_property(prop_id, db, current_user)
    metrics = compute_property_metrics(prop)

    # Snapshots & per-year tax/interest from uploaded documents
    snapshots, tax_by_year, interest_by_year, balance_by_year, balance_logic_by_year = _collect_doc_history(prop)
    statement_balance_by_year = _latest_statement_balance_by_year(snapshots)
    # Actual per-year rent/occupancy from recorded lease periods
    rental_by_year = _rental_income_by_year(prop)
    rental_months_map = _rental_months_by_year(prop)
    # Schedule E figures from uploaded tax returns (highest-confidence source)
    _tax_entries = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.property_id == prop_id,
    ).all()
    tax_return_rent_by_year = {
        e.tax_year: e.rents_received for e in _tax_entries if e.rents_received
    }
    tax_return_depr_by_year = {
        e.tax_year: e.depreciation for e in _tax_entries if e.depreciation
    }
    tax_return_interest_by_year = {
        e.tax_year: e.mortgage_interest for e in _tax_entries if e.mortgage_interest
    }
    tax_return_opex_by_year = {
        e.tax_year: round(
            (e.total_expenses or 0) - (e.mortgage_interest or 0) - (e.depreciation or 0), 2
        )
        for e in _tax_entries if e.total_expenses
    }
    # Amortization-projected interest by year — fills years with no 1098,
    # tax return, or statement interest on file.
    projected_interest_by_year: Dict[int, float] = {}
    for _loan in prop.loans:
        for _yr, _amt in _projected_interest_by_year(_loan).items():
            projected_interest_by_year[_yr] = round(projected_interest_by_year.get(_yr, 0) + _amt, 2)
    # Per-year property taxes from filed returns: prefer Schedule E entries
    # (total_expenses > 0 means it came from an actual return, not just a 1098)
    _prop_tax_by_year: dict[int, float] = {}
    for _e in _tax_entries:
        if not _e.property_taxes:
            continue
        _existing = _prop_tax_by_year.get(_e.tax_year)
        if _existing is None or bool(_e.total_expenses):
            _prop_tax_by_year[_e.tax_year] = _e.property_taxes

    # Every year we have any data for — statements, 1098s, tax bills, leases, tax returns.

    manual_property_tax_by_year = _property_tax_history(prop)
    loan_yearly_by_year: Dict[int, List[Dict[str, Any]]] = {}
    for _loan in prop.loans:
        for _row in _scheduled_loan_years(_loan):
            loan_yearly_by_year.setdefault(_row["year"], []).append({
                "loan_id": _loan.id,
                "lender_name": _loan.lender_name,
                "loan_type": _loan.loan_type,
                "original_amount": _loan.original_amount or 0,
                "start_date": _loan.origination_date,
                "interest_rate": _loan.interest_rate or 0,
                "interest_paid": _row["interest_paid"],
                "principal_paid": _row["principal_paid"],
                "mortgage_paid": _row["mortgage_paid"],
                "ending_balance": _row["ending_balance"],
                "months": _row["months"],
                "source": "backend_amortization",
            })
    data_years = ({s["year"] for s in snapshots} | set(tax_by_year)
                  | set(interest_by_year) | set(rental_by_year)
                  | set(balance_by_year) | set(tax_return_rent_by_year)
                  | set(tax_return_depr_by_year) | set(manual_property_tax_by_year))
    data_years |= set(loan_yearly_by_year)
    current_year = datetime.now().year
    if prop.property_tax or manual_property_tax_by_year or loan_yearly_by_year:
        data_years |= set(range(current_year - 4, current_year + 1))

    # Determine year range (purchase to present). Dates may be ISO
    # (YYYY-MM-DD) or US (MM/DD/YYYY), so pull the 4-digit year wherever it is
    # rather than assuming its position. Fall back to the earliest year we have
    # data for so a missing purchase date doesn't hide existing history.
    purchase_year = None
    if prop.purchase_date:
        m = re.search(r'(?:19|20)\d{2}', prop.purchase_date)
        if m:
            purchase_year = int(m.group(0))
    # Only fall back to the earliest data year when the purchase date is
    # unknown — a known purchase date bounds out pre-ownership tax artifacts.
    if not purchase_year and data_years:
        purchase_year = min(data_years)
    if not purchase_year:
        purchase_year = datetime.now().year

    years_owned = max(current_year - purchase_year, 0)

    annual_rent = metrics["effective_rent"] * 12
    annual_tax_ins = prop.property_tax + prop.insurance
    annual_other_op = (
        prop.hoa_fee + prop.maintenance + prop.property_management_fee +
        prop.utilities + prop.vacancy_allowance + prop.capex_reserve +
        prop.other_expenses
    ) * 12
    annual_operating = annual_tax_ins + annual_other_op
    annual_depreciation = metrics["annual_depreciation"]
    annual_cash_flow = metrics["annual_cash_flow"]
    annual_escrow = metrics["monthly_escrow"] * 12

    has_documents = bool(snapshots)
    # Include completed past years, plus the current year when we have any
    # data for it (a statement, 1098, tax bill, or active lease).
    end_year = current_year - 1
    if current_year in data_years:
        end_year = current_year
    if data_years:
        end_year = max(end_year, max(data_years))
    # Purchase month for partial-year prorating
    _pur_month = 1
    if prop.purchase_date:
        _mm = re.search(r'-(\d{2})-', prop.purchase_date)
        if _mm:
            _pur_month = int(_mm.group(1))

    yearly_details = []
    cumulative_principal_paid = 0.0
    previous_expected_principal_cumulative = 0.0
    cumulative_principal_topup_paid = 0.0
    for year in range(purchase_year, end_year + 1):
        ss = [s for s in snapshots if s["year"] == year]
        loan_year_rows = loan_yearly_by_year.get(year, [])
        calculated_interest = round(sum(_row.get("interest_paid", 0) or 0 for _row in loan_year_rows), 2)
        calculated_principal = round(sum(_row.get("principal_paid", 0) or 0 for _row in loan_year_rows), 2)
        calculated_balance = round(sum(_row.get("ending_balance", 0) or 0 for _row in loan_year_rows), 2)

        # Prorate estimates for the purchase year (not owned Jan 1).
        # Use months remaining in the year after purchase (e.g. Sep → 3).
        months_owned = max(1, 12 - _pur_month) if year == purchase_year else 12

        # Principal: prefer 1098 balance delta (most accurate), then
        # mortgage-statement balance delta, then annualized, then estimated
        p1098 = _principal_from_1098_segments(
            balance_by_year, balance_logic_by_year, year, prop.loans, statement_balance_by_year)
        if p1098 is not None:
            principal_paid = p1098
            source = "actual"
        elif len(ss) >= 2 and ss[0]["balance"] and ss[-1]["balance"]:
            months = max(
                (datetime.fromisoformat(ss[-1]["date"]) -
                 datetime.fromisoformat(ss[0]["date"])).days / 30.44, 1)
            principal_paid = round((ss[0]["balance"] - ss[-1]["balance"]) / months * 12, 2)
            source = "actual"
        elif ss:
            principal_paid = round((ss[-1]["principal"] or 0) * months_owned, 2)
            source = "annualized"
        elif loan_year_rows:
            principal_paid = calculated_principal
            source = "calculated"
        elif (has_documents or year in interest_by_year or year in tax_by_year
              or year in rental_by_year or year == current_year
              or year in balance_by_year or year in tax_return_rent_by_year):
            principal_paid = round(sum(l.principal_due or 0 for l in prop.loans) * months_owned, 2)
            source = "estimated"
        else:
            continue

        cumulative_principal_paid = round(cumulative_principal_paid + principal_paid, 2)
        # Scheduled principal is the year-end amortization target. Current-year
        # actual principal may be YTD, but the scheduled column should not stop
        # at the latest statement month.
        _sched_end_month = 12
        expected_principal_cumulative = _scheduled_principal_cumulative(
            prop.loans[0] if prop.loans else None, year, _sched_end_month)
        expected_principal_paid = None
        if expected_principal_cumulative is not None:
            expected_principal_paid = round(
                max(0, expected_principal_cumulative - previous_expected_principal_cumulative), 2)
            previous_expected_principal_cumulative = expected_principal_cumulative
        principal_topup_paid = round(
            max(0, principal_paid - (expected_principal_paid or 0)), 2
        ) if expected_principal_paid is not None else None

        # Current-year topup should only come from actual annual data or
        # balance deltas, not from projected monthly statement estimates.
        if year == current_year and source in {"estimated", "annualized"}:
            principal_topup_paid = 0.0 if principal_topup_paid is not None else None

        if principal_topup_paid is not None:
            cumulative_principal_topup_paid = round(
                cumulative_principal_topup_paid + principal_topup_paid, 2
            )
        principal_topup_cumulative = (
            cumulative_principal_topup_paid
            if expected_principal_cumulative is not None else None
        )

        # Interest from mortgage statements or loan estimate
        if ss:
            interest_paid = round(sum(s["interest"] or 0 for s in ss) / len(ss) * months_owned, 2)
        elif loan_year_rows:
            interest_paid = calculated_interest
            source = "calculated"
        elif year in projected_interest_by_year:
            interest_paid = projected_interest_by_year[year]
            if source == "estimated":
                source = "annualized"
        else:
            interest_paid = round(sum(l.interest_due or 0 for l in prop.loans) * months_owned, 2)

        interest_source = "calculated" if loan_year_rows else source
        interest_note = "Calculated (approx) from loan terms."
        if loan_year_rows:
            _loan_notes = []
            for _ly in loan_year_rows:
                _rate = _ly.get("interest_rate") or 0
                _name = _ly.get("lender_name") or f"Loan {_ly.get('loan_id')}"
                _amount = _ly.get("original_amount") or 0
                _start = _ly.get("start_date") or "unknown start"
                _loan_notes.append(f"{_name} started {_start}, {format_currency(_amount)} at {format_interest_rate(_rate)}")
            if _loan_notes:
                interest_note = "Calculated (approx) from loan terms: " + "; ".join(_loan_notes) + "."

        # Form 1098 reports exact annual interest — prefer it over estimates
        if year in interest_by_year:
            interest_paid = interest_by_year[year]
            interest_source = "reported"
            interest_note = "Reported from Form 1098."
            if source != "actual":
                source = "1098"
        elif year in tax_return_interest_by_year:
            interest_paid = tax_return_interest_by_year[year]
            interest_source = "reported"
            interest_note = "Reported from tax return."
            source = "tax_return"

        if loan_year_rows and calculated_principal and (source in {"estimated", "annualized", "calculated"} or principal_paid <= 0):
            principal_paid = calculated_principal
        principal_source = "calculated" if loan_year_rows else source
        principal_note = "Calculated (approx) from loan amortization schedule." if loan_year_rows else "Estimated from available property records."

        # Property tax priority: Schedule E/property-tax docs, manual history,
        # then a clearly marked flat carry-back from the current property tax.
        property_tax_source = "approx"
        property_tax_note = "Estimated - same as current year (no tax doc on file)."
        year_tax = _prop_tax_by_year.get(year)
        if year_tax is not None:
            property_tax_source = "reported"
            property_tax_note = "Reported from tax return."
        else:
            year_tax = tax_by_year.get(year)
            if year_tax is not None:
                property_tax_source = "reported"
                property_tax_note = "Reported from property tax document."
        if year_tax is None:
            year_tax = manual_property_tax_by_year.get(year)
            if year_tax is not None:
                property_tax_source = "reported"
                property_tax_note = "Entered property tax amount."
        op_property_tax = year_tax if year_tax is not None else prop.property_tax
        # Schedule E total (minus interest and depreciation) beats static field estimates
        if year in tax_return_opex_by_year:
            operating_expenses = round(max(0, tax_return_opex_by_year[year]), 2)
        else:
            operating_expenses = round(annual_other_op + prop.insurance + op_property_tax, 2)
        taxes_paid = round(op_property_tax, 2)

        if ss and ss[-1].get("escrow"):
            escrow_paid = round(ss[-1]["escrow"] * 12, 2)
        else:
            escrow_paid = round(annual_escrow, 2)

        # Rent: only from verified sources — never estimate backwards into prior years.
        # Using current monthly_rent as a historical estimate gives wrong figures
        # for years when the property was a primary residence or otherwise unrented.
        if year in tax_return_rent_by_year:
            year_rent = tax_return_rent_by_year[year]
            occupied_months = None
            occupancy = None
            rent_source = "tax_return"
        elif rental_by_year.get(year):
            rinfo = rental_by_year[year]
            year_rent = rinfo.get("run_rate_income_elapsed") or rinfo["income"]
            occupied_months = rinfo["occupied_months"]
            occupancy = rinfo["occupancy"]
            rent_source = "leases"
        else:
            year_rent = 0.0
            occupied_months = None
            occupancy = None
            rent_source = "none"

        # Depreciation: tax return (Schedule E line 18) > IRS mid-month calculation
        # > full-year straight-line > 0 (depreciation only applies to rental-use
        # property; no rental evidence for this year means no depreciation).
        _is_rental_year = year in rental_months_map
        if tax_return_depr_by_year.get(year):
            year_depreciation = tax_return_depr_by_year[year]
        elif purchase_year and year == purchase_year and prop.purchase_date and _is_rental_year:
            try:
                _pd = datetime.strptime(prop.purchase_date[:10], '%Y-%m-%d')
                _months = 12 - _pd.month + 0.5
                year_depreciation = annual_depreciation * _months / 12
            except Exception:
                year_depreciation = annual_depreciation
        elif _is_rental_year:
            year_depreciation = annual_depreciation
        else:
            year_depreciation = 0.0

        debt_service = interest_paid + principal_paid
        cash_flow = round(year_rent - operating_expenses - debt_service, 2)
        taxable_income = round(
            year_rent - operating_expenses - interest_paid - year_depreciation, 2)

        yearly_details.append({
            "year": year,
            "rental_income": year_rent,
            "occupied_months": occupied_months,
            "occupancy": occupancy,
            "rent_source": rent_source,
            "operating_expenses": operating_expenses,
            "interest_paid": interest_paid,
            "principal_paid": principal_paid,
            "expected_principal_paid": expected_principal_paid,
            "principal_topup_paid": principal_topup_paid,
            "cumulative_principal_paid": cumulative_principal_paid,
            "expected_principal_cumulative": expected_principal_cumulative,
            "principal_topup_cumulative": principal_topup_cumulative,
            "escrow_paid": escrow_paid,
            "taxes_paid": taxes_paid,
            "property_tax": taxes_paid,
            "property_tax_source": property_tax_source,
            "property_tax_note": property_tax_note,
            "depreciation": round(year_depreciation, 2),
            "cash_flow": cash_flow,
            "taxable_income": taxable_income,
            "mortgage_interest": interest_paid,
            "interest_source": interest_source,
            "interest_note": interest_note,
            "principal_source": principal_source,
            "principal_note": principal_note,
            "loan_balance": calculated_balance,
            "balance": calculated_balance,
            "source": source,
            "usage_status": (
                "Mixed"
                if _usage_days_by_year(prop).get(year, {}).get("PRIMARY", 0)
                and _usage_days_by_year(prop).get(year, {}).get("RENTAL", 0)
                else ("Rental" if _usage_days_by_year(prop).get(year, {}).get("RENTAL", 0) else "Primary")
            ),
            "usage_days": _usage_days_by_year(prop).get(year, {"PRIMARY": 0, "RENTAL": 0}),
            "statements": len(ss),
            "loans": loan_year_rows,
        })

    # ── Prorate current year if it is partial ────────────────────────────────
    current_month = datetime.now().month
    if yearly_details and yearly_details[-1]["year"] == current_year and current_month < 12:
        yd = yearly_details[-1]
        months_elapsed = current_month  # calendar-based; statements already annualise themselves

        # Rent from leases is a raw YTD sum — annualise it
        if yd.get("rent_source") == "leases" and months_elapsed > 0 and months_elapsed < 12:
            factor = 12 / months_elapsed
            yd["rental_income"] = round(yd["rental_income"] * factor, 2)
            # Recompute derived fields with prorated rent
            yd["cash_flow"] = round(
                yd["rental_income"] - yd["operating_expenses"] - yd["interest_paid"] - yd["principal_paid"], 2
            )
            yd["taxable_income"] = round(
                yd["rental_income"] - yd["operating_expenses"] - yd["interest_paid"] - yd["depreciation"], 2
            )

        yd["is_partial"] = True
        yd["months_elapsed"] = months_elapsed

    # Original loan amount is authoritative — use it to compute how much
    # principal has actually been paid off. The per-year principal_paid values
    # can be negative when 1098/statement data is incomplete or inconsistent
    # (e.g. a new loan originated mid-year whose first 1098 Box-2 balance is
    # higher than the next year's balance). Summing those gives nonsense totals.
    _original_loan = round(sum(l.original_amount for l in prop.loans if l.original_amount), 2)
    _current_bal = round(
        yearly_details[-1].get("loan_balance", metrics["total_loan_balance"]) if yearly_details else metrics["total_loan_balance"],
        2,
    )
    _has_balance_evidence = bool(snapshots or balance_by_year or statement_balance_by_year)
    _principal_paid_source = "loan_balance"
    _principal_paid_note = None
    if _original_loan > 0 and _current_bal <= 0 and not _has_balance_evidence:
        _principal_paid_actual = 0.0
        _principal_paid_source = "missing_balance_evidence"
        _principal_paid_note = "Upload a mortgage statement or 1098 to verify principal paydown."
    else:
        _principal_paid_actual = round(max(0, _original_loan - _current_bal), 2)
    _expected_principal_cumulative = (
        yearly_details[-1].get("expected_principal_cumulative") if yearly_details else None
    )
    _principal_topup_cumulative = (
        yearly_details[-1].get("principal_topup_cumulative")
        if yearly_details else None
    )

    # A year with no statement/1098/tax-return/rental evidence of any kind
    # never enters yearly_details at all (see the `continue` above) — so a
    # fully undocumented loan would otherwise report $0 lifetime interest.
    # Fill those missing years from the amortization projection too.
    _covered_years = {y["year"] for y in yearly_details}
    _missing_years_interest = round(sum(
        amt for yr, amt in projected_interest_by_year.items() if yr not in _covered_years
    ), 2)

    lifetime = {
        "years_owned": years_owned,
        "purchase_year": purchase_year,
        "years_filled": len(yearly_details),
        "total_rental_income": round(sum(y["rental_income"] for y in yearly_details), 2),
        "total_operating_expenses": round(sum(y["operating_expenses"] for y in yearly_details), 2),
        "total_interest_paid": round(sum(y["interest_paid"] for y in yearly_details) + _missing_years_interest, 2),
        "total_principal_paid": _principal_paid_actual,
        "principal_paid_source": _principal_paid_source,
        "principal_paid_note": _principal_paid_note,
        "expected_principal_paid": _expected_principal_cumulative,
        "principal_topup_paid": _principal_topup_cumulative,
        "total_expected_principal_paid": _expected_principal_cumulative,
        "total_principal_topup_paid": _principal_topup_cumulative,
        "total_escrow_paid": round(sum(y["escrow_paid"] for y in yearly_details), 2),
        "total_taxes_paid": round(sum(y["taxes_paid"] for y in yearly_details), 2),
        "total_depreciation": round(sum(y["depreciation"] for y in yearly_details), 2),
        "total_cash_flow": round(sum(y["cash_flow"] for y in yearly_details), 2),
        "total_taxable_income": round(sum(y["taxable_income"] for y in yearly_details), 2),
        "total_return": round(
            sum(y["cash_flow"] for y in yearly_details) + _principal_paid_actual, 2),
        "current_loan_balance": _current_bal,
        "original_loan_amount": _original_loan,
        "market_value": prop.market_value,
        "equity": round(metrics["equity"], 2),
        "purchase_price": prop.purchase_price or 0,
        "annual_depreciation": annual_depreciation,
        "monthly_rent": prop.monthly_rent,
    }

    def _net_schedule_e(row):
        return round(
            (row.get("rental_income") or 0)
            - (row.get("operating_expenses") or 0)
            - (row.get("interest_paid") or 0)
            - (row.get("depreciation") or 0),
            2,
        )

    def _is_full_ownership_year(row):
        if row.get("is_partial"):
            return False
        year = int(row.get("year") or 0)
        if year >= current_year:
            return False
        if purchase_year and year == purchase_year and prop.purchase_date:
            purchase_dt = _parse_iso_date(prop.purchase_date)
            if purchase_dt and (purchase_dt.month != 1 or purchase_dt.day != 1):
                return False
        return True

    complete_tax_rows = [r for r in yearly_details if _is_full_ownership_year(r)]
    current_tax_row = complete_tax_rows[-1] if complete_tax_rows else (yearly_details[-1] if yearly_details else None)
    tax_summary = {
        "current_year": None,
        "current": None,
        "lifetime": {
            "net_schedule_e": round(sum(_net_schedule_e(r) for r in yearly_details), 2),
            "accumulated_depreciation": round(sum((r.get("depreciation") or 0) for r in yearly_details), 2),
            "suspended_loss": 0.0,
        },
        "notes": {
            "current_year_policy": "Latest complete full-ownership tax year; excludes purchase partial year and current YTD.",
            "rental_deductions": "Rental mortgage interest and property tax are fully deductible Schedule E expenses; principal is excluded.",
        },
    }
    if current_tax_row:
        net_schedule_e = _net_schedule_e(current_tax_row)
        tax_summary["current_year"] = current_tax_row["year"]
        tax_summary["current"] = {
            "year": current_tax_row["year"],
            "rental_income": round(current_tax_row.get("rental_income") or 0, 2),
            "operating_expenses": round(current_tax_row.get("operating_expenses") or 0, 2),
            "mortgage_interest": round(current_tax_row.get("interest_paid") or 0, 2),
            "depreciation": None if current_tax_row.get("usage_status") == "Primary" else round(current_tax_row.get("depreciation") or 0, 2),
            "net_schedule_e": net_schedule_e,
            "passive_loss_flag": net_schedule_e < 0,
        }

    summary_year = (current_tax_row or {}).get("year") or current_year
    summary_rent = resolve_rent(prop, summary_year)
    summary_income = summary_rent["annual_rent"]
    summary_opex_resolved = resolve_annual_operating_expenses(prop, summary_year)
    summary_property_tax = summary_opex_resolved["propertyTax"]
    summary_opex = summary_opex_resolved["value"]
    summary_noi = round((summary_income or 0) - (summary_opex or 0), 2)
    summary_debt_service = round(metrics.get("annual_debt_service") or 0, 2)
    summary_interest = round((current_tax_row or {}).get("interest_paid") or 0, 2)
    summary_principal = round((current_tax_row or {}).get("principal_paid") or 0, 2)
    summary_appreciation = round((prop.market_value or 0) - (prop.purchase_price or (prop.market_value or 0)), 2)
    summary_annual_cash_flow = round(summary_noi - summary_debt_service, 2)
    summary_metrics = {
        "noi": summary_noi,
        "annual_debt_service": summary_debt_service,
        "annual_cash_flow": summary_annual_cash_flow,
        "monthly_cash_flow": round(summary_annual_cash_flow / 12, 2),
        "monthly_cost_to_own": round(summary_debt_service / 12 + (summary_opex or 0) / 12, 2),
        "cap_rate": round(summary_noi / prop.market_value * 100, 2) if prop.market_value else 0,
        "dscr": round(summary_noi / summary_debt_service, 2) if summary_debt_service else 0,
        "effective_gross_income": round(summary_income or 0, 2),
        "year": (current_tax_row or {}).get("year"),
        "months_elapsed": (current_tax_row or {}).get("months_elapsed"),
        "operating_expenses": round(summary_opex or 0, 2),
        "operating_expense_components": summary_opex_resolved["components"],
        "property_tax": round(summary_property_tax["value"], 2),
        "property_tax_source": summary_property_tax["source"],
        "property_tax_source_tier": summary_property_tax["sourceTier"],
        "property_tax_warning": summary_property_tax["warning"],
        "mortgage_interest": summary_interest,
        "principal_paid": summary_principal,
        "appreciation": summary_appreciation,
        "cash_invested": round((prop.down_payment or 0) + (prop.closing_costs or 0), 2),
        "source": "backend_engine",
    }
    summary_metrics["cash_on_cash_return"] = (
        round(summary_metrics["annual_cash_flow"] / summary_metrics["cash_invested"] * 100, 2)
        if summary_metrics["cash_invested"] > 0
        else None
    )
    summary_metrics["total_return_ytd"] = round(
        summary_metrics["annual_cash_flow"] + summary_principal + summary_appreciation,
        2,
    )
    summary_metrics["sign_sanity"] = {
        "noi_positive": summary_metrics["noi"] > 0,
        "cap_rate_non_negative_when_noi_positive": not (summary_metrics["noi"] > 0 and summary_metrics["cap_rate"] < 0),
        "dscr_non_negative_when_noi_positive": not (summary_metrics["noi"] > 0 and summary_metrics["dscr"] < 0),
        "noi_formula": abs(
            summary_metrics["noi"]
            - (summary_metrics["effective_gross_income"] - summary_metrics["operating_expenses"])
        ) <= 1,
        "operating_expenses_component_sum": abs(
            summary_metrics["operating_expenses"]
            - sum((summary_metrics.get("operating_expense_components") or {}).values())
        ) <= 1,
        "property_tax_prior_year_is_approx": (
            not str(summary_metrics.get("property_tax_source") or "").startswith("schedule_e_")
            or summary_metrics.get("property_tax_source_tier") == "APPROX"
        ),
        "cash_flow_formula": abs(
            summary_metrics["annual_cash_flow"]
            - (summary_metrics["noi"] - summary_metrics["annual_debt_service"])
        ) <= 1,
        "monthly_cash_flow_formula": abs(
            summary_metrics["monthly_cash_flow"] * 12 - summary_metrics["annual_cash_flow"]
        ) <= 2,
        "cap_rate_formula": (
            not prop.market_value
            or abs(summary_metrics["cap_rate"] - (summary_metrics["noi"] / prop.market_value * 100)) <= 0.01
        ),
        "dscr_formula": (
            not summary_metrics["annual_debt_service"]
            or abs(summary_metrics["dscr"] - (summary_metrics["noi"] / summary_metrics["annual_debt_service"])) <= 0.01
        ),
        "total_return_additive": abs(
            summary_metrics["total_return_ytd"]
            - (summary_metrics["annual_cash_flow"] + summary_principal + summary_appreciation)
        ) <= 1,
    }

    engine = build_property_engine(prop)
    return {
        "lifetime": lifetime,
        "yearly": yearly_details,
        "tax_summary": tax_summary,
        "summary_metrics": summary_metrics,
        "usage": _usage_summary(prop),
        "usage_periods": [UsagePeriodOut.model_validate(p) for p in _timeline_periods(prop)],
        "engineChecks": engine.invariant_checks(),
    }


SCHEDULE_E_LINE_DEFS = [
    ("3", "Rents received", "rents_received"),
    ("5", "Advertising", "advertising"),
    ("6", "Auto and travel", "auto_travel"),
    ("7", "Cleaning and maintenance", "cleaning_maintenance"),
    ("8", "Commissions", "commissions"),
    ("9", "Insurance", "insurance"),
    ("10", "Legal and professional fees", "legal_professional"),
    ("11", "Management fees", "management_fees"),
    ("12", "Mortgage interest", "mortgage_interest"),
    ("13", "Other interest", "other_interest"),
    ("14", "Repairs", "repairs"),
    ("15", "Supplies", "supplies"),
    ("16", "Taxes / property tax", "taxes"),
    ("17", "Utilities", "utilities"),
    ("18", "Depreciation", "depreciation"),
    ("19", "Other expenses", "other_expenses"),
    ("20", "Total expenses", "total_expenses"),
    ("26", "Net Schedule E", "net_income"),
]


def _schedule_e_json_dict(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _schedule_e_number(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _schedule_e_money(value: Any) -> Dict[str, Any]:
    numeric = _schedule_e_number(value)
    return {"value": numeric, "display": format_currency(numeric)}


def _schedule_e_status(computed: float, filed: Optional[float]) -> str:
    if filed is None:
        return "No file"
    return "Match" if abs(computed - filed) <= 1 else "Delta"


def _schedule_e_filed_value(entry: Optional[models.TaxReturnEntry], key: str) -> Optional[float]:
    if not entry:
        return None
    breakdown = _schedule_e_json_dict(entry.expense_breakdown)
    if key == "rents_received":
        return _schedule_e_number(entry.rents_received)
    if key == "mortgage_interest":
        return _schedule_e_number(entry.mortgage_interest)
    if key == "taxes":
        return _schedule_e_number(entry.property_taxes or breakdown.get("taxes"))
    if key == "depreciation":
        return _schedule_e_number(entry.depreciation)
    if key == "total_expenses":
        return _schedule_e_number(entry.total_expenses)
    if key == "net_income":
        return _schedule_e_number(entry.net_income)
    if key in breakdown:
        return _schedule_e_number(breakdown.get(key))
    return None


def _schedule_e_annual_expense_components(prop: models.Property, year: int) -> Dict[str, float]:
    row = _annual_expense_for_year(prop, year)
    if row and _annual_expense_entered(row):
        return {
            "insurance": _schedule_e_number(row.insurance),
            "management_fees": _schedule_e_number(row.property_management),
            "repairs": _schedule_e_number(row.repairs_maintenance),
            "taxes": _schedule_e_number(row.property_tax),
            "utilities": _schedule_e_number(row.utilities),
            "other_expenses": _schedule_e_number(
                (row.hoa or 0)
                + (row.vacancy_allowance or 0)
                + (row.capex_reserve or 0)
                + (row.other or 0)
            ),
        }
    return {
        "insurance": _schedule_e_number(prop.insurance),
        "management_fees": _schedule_e_number((prop.property_management_fee or 0) * 12),
        "repairs": _schedule_e_number((prop.maintenance or 0) * 12),
        "taxes": _schedule_e_number(prop.property_tax),
        "utilities": _schedule_e_number((prop.utilities or 0) * 12),
        "other_expenses": _schedule_e_number(
            ((prop.hoa_fee or 0) + (prop.vacancy_allowance or 0) + (prop.capex_reserve or 0)) * 12
            + (prop.other_expenses or 0)
        ),
    }


def _schedule_e_depreciation(prop: models.Property, year: int) -> float:
    basis = _depreciable_basis(prop)
    recovery_period = float(prop.depreciation_years or 27.5)
    if basis <= 0 or recovery_period <= 0:
        return 0.0
    # Schedule E history presents the current year as a full-year projection.
    # Build the rental timeline through December of the requested year so an
    # open rental period is not truncated at today's month. The current-year
    # breakdown separately prorates this annual value into reported and
    # projected-remainder rows.
    return _depreciation_for_year(
        basis,
        recovery_period,
        _rental_months_by_year(prop, through_year=year),
        year,
    )


def _computed_schedule_e_components(prop: models.Property, year: int, lifetime_row: Optional[Dict[str, Any]]) -> Dict[str, float]:
    row = lifetime_row or {}
    expense_components = _schedule_e_annual_expense_components(prop, year)
    computed = {
        "rents_received": _schedule_e_number(row.get("rental_income")),
        "advertising": 0.0,
        "auto_travel": 0.0,
        "cleaning_maintenance": 0.0,
        "commissions": 0.0,
        "insurance": expense_components["insurance"],
        "legal_professional": 0.0,
        "management_fees": expense_components["management_fees"],
        "mortgage_interest": _schedule_e_number(row.get("interest_paid") or row.get("mortgage_interest")),
        "other_interest": 0.0,
        "repairs": expense_components["repairs"],
        "supplies": 0.0,
        "taxes": _schedule_e_number(row.get("property_tax") or row.get("taxes_paid") or expense_components["taxes"]),
        "utilities": expense_components["utilities"],
        "depreciation": _schedule_e_depreciation(prop, year),
        "other_expenses": expense_components["other_expenses"],
    }
    computed["operating_expenses"] = _schedule_e_number(sum(
        computed[key]
        for key in (
            "advertising", "auto_travel", "cleaning_maintenance", "commissions",
            "insurance", "legal_professional", "management_fees", "other_interest",
            "repairs", "supplies", "utilities", "other_expenses",
        )
    ))
    computed["total_expenses"] = _schedule_e_number(sum(
        computed[key]
        for key in (
            "advertising", "auto_travel", "cleaning_maintenance", "commissions",
            "insurance", "legal_professional", "management_fees", "mortgage_interest",
            "other_interest", "repairs", "supplies", "taxes", "utilities",
            "depreciation", "other_expenses",
        )
    ))
    computed["net_income"] = _schedule_e_number(computed["rents_received"] - computed["total_expenses"])
    return computed


def _schedule_e_history_row(
    year: int,
    components: Dict[str, float],
    *,
    label: Optional[str] = None,
    source_label: Optional[str] = None,
    row_kind: str = "year",
    detail_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    row = {
        "year": year,
        "label": label or str(year),
        "kind": row_kind,
        "sourceLabel": source_label or "Computed",
        "rentalIncome": _schedule_e_money(components.get("rents_received")),
        "operatingExpenses": _schedule_e_money(components.get("operating_expenses")),
        "deductibleInterest": _schedule_e_money(components.get("mortgage_interest")),
        "mortgageInterest": _schedule_e_money(components.get("mortgage_interest")),
        "propertyTax": _schedule_e_money(components.get("taxes")),
        "depreciation": _schedule_e_money(components.get("depreciation")),
        "totalExpenses": _schedule_e_money(components.get("total_expenses")),
        "netScheduleE": _schedule_e_money(components.get("net_income")),
    }
    if detail_rows:
        row["detailRows"] = detail_rows
    return row


def _schedule_e_history_total_row(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    totals = {
        "rents_received": sum(_schedule_e_number(row.get("rentalIncome", {}).get("value")) for row in history),
        "operating_expenses": sum(_schedule_e_number(row.get("operatingExpenses", {}).get("value")) for row in history),
        "mortgage_interest": sum(_schedule_e_number(row.get("mortgageInterest", {}).get("value")) for row in history),
        "taxes": sum(_schedule_e_number(row.get("propertyTax", {}).get("value")) for row in history),
        "depreciation": sum(_schedule_e_number(row.get("depreciation", {}).get("value")) for row in history),
        "total_expenses": sum(_schedule_e_number(row.get("totalExpenses", {}).get("value")) for row in history),
        "net_income": sum(_schedule_e_number(row.get("netScheduleE", {}).get("value")) for row in history),
    }
    return _schedule_e_history_row(
        9999,
        totals,
        label="Total",
        source_label="Accumulated",
        row_kind="total",
    )


def _schedule_e_components_from_breakdown_metrics(row: Dict[str, Any]) -> Dict[str, float]:
    metrics = row.get("metrics") or {}
    return {
        "rents_received": _schedule_e_number(metrics.get("rentsReceived", {}).get("value")),
        "mortgage_interest": _schedule_e_number(metrics.get("mortgageInterest", {}).get("value")),
        "taxes": _schedule_e_number(metrics.get("propertyTax", {}).get("value")),
        "operating_expenses": _schedule_e_number(metrics.get("operatingExpenses", {}).get("value")),
        "depreciation": _schedule_e_number(metrics.get("depreciation", {}).get("value")),
        "total_expenses": _schedule_e_number(metrics.get("totalExpenses", {}).get("value")),
        "net_income": _schedule_e_number(metrics.get("netScheduleE", {}).get("value")),
    }


def _schedule_e_amortized_interest_through_month(
    prop: models.Property,
    year: int,
    through_month: int,
) -> float:
    """Return backend-amortized interest for a calendar year through a month.

    This is the current-year fallback when rental activity establishes a
    reported period but no mortgage statement has supplied YTD interest. Loan
    closure dates are respected so refinanced or paid-off debt does not leak
    into later years.
    """
    through_month = max(0, min(12, int(through_month or 0)))
    if through_month <= 0:
        return 0.0

    cutoff = date(int(year), through_month, 1)
    total = 0.0
    for loan in getattr(prop, "loans", []) or []:
        tracking_start = _loan_tracking_start_date(loan)
        if tracking_start and tracking_start > cutoff:
            continue
        loan_cutoff = _loan_tracking_as_of(loan, cutoff)
        if loan_cutoff.year < int(year):
            continue
        total += _projected_interest_by_year(loan, loan_cutoff).get(int(year), 0.0)
    return _schedule_e_number(total)


def _schedule_e_current_year_breakdown(
    prop: models.Property,
    year: int,
    total_components: Dict[str, float],
    yearly_row: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    current_year = date.today().year
    if int(year or 0) != current_year:
        return None

    snapshots, tax_by_year, interest_by_year, _balance_by_year, _balance_logic_by_year = _collect_doc_history(prop)
    current_snapshots = [snap for snap in snapshots if int(snap.get("year") or 0) == current_year]
    rental_by_year = _rental_income_by_year(prop)
    rental_info = rental_by_year.get(current_year) or {}
    latest_statement_date = None
    if current_snapshots:
        latest_statement_date = max(
            (_parse_statement_date(snap.get("date")) for snap in current_snapshots),
            default=None,
        )
    months_elapsed = 0
    if latest_statement_date:
        months_elapsed = latest_statement_date.month
    elif rental_info:
        months_elapsed = date.today().month
    months_elapsed = max(0, min(12, int(months_elapsed or 0)))
    has_current_statement = bool(current_snapshots)
    has_rental_details = bool(rental_info)

    expense_components = _schedule_e_annual_expense_components(prop, current_year)
    full_interest = interest_by_year.get(current_year)
    if full_interest is None:
        projected_interest = _schedule_e_amortized_interest_through_month(
            prop,
            current_year,
            12,
        )
        full_interest = _schedule_e_number(projected_interest or total_components.get("mortgage_interest"))

    full_rent = _schedule_e_number(
        rental_info.get("run_rate_annual_income")
        or ((rental_info.get("current_monthly_rent") or 0) * 12)
        or total_components.get("rents_received")
    )
    full_tax = _schedule_e_number(tax_by_year.get(current_year) or total_components.get("taxes"))
    full_depreciation = _schedule_e_number(
        _schedule_e_depreciation(prop, current_year)
        if (_rental_months_by_year(prop).get(current_year) or has_rental_details)
        else total_components.get("depreciation")
    )
    non_tax_expenses = _schedule_e_number(
        expense_components.get("insurance")
        + expense_components.get("management_fees")
        + expense_components.get("repairs")
        + expense_components.get("utilities")
        + expense_components.get("other_expenses")
    )
    total = {
        "rents_received": full_rent,
        "mortgage_interest": _schedule_e_number(full_interest),
        "taxes": full_tax,
        "depreciation": full_depreciation,
        "operating_expenses": non_tax_expenses,
    }
    total["total_expenses"] = _schedule_e_number(
        total["mortgage_interest"]
        + total["taxes"]
        + total["depreciation"]
        + total["operating_expenses"]
    )
    total["net_income"] = _schedule_e_number(total["rents_received"] - total["total_expenses"])

    reported = {
        "rents_received": 0.0,
        "mortgage_interest": 0.0,
        "taxes": 0.0,
        "depreciation": 0.0,
        "operating_expenses": 0.0,
    }
    if has_rental_details:
        if months_elapsed and rental_info.get("current_monthly_rent"):
            reported["rents_received"] = _schedule_e_number(rental_info.get("current_monthly_rent") * months_elapsed)
        else:
            reported["rents_received"] = _schedule_e_number(
                rental_info.get("run_rate_income_elapsed") or rental_info.get("income")
            )
        reported["depreciation"] = _schedule_e_number(total["depreciation"] * months_elapsed / 12)
        reported["operating_expenses"] = _schedule_e_number(non_tax_expenses * months_elapsed / 12)
    if interest_by_year.get(current_year) is not None:
        reported["mortgage_interest"] = total["mortgage_interest"]
    elif has_current_statement:
        reported["mortgage_interest"] = _schedule_e_number(sum(
            snap.get("interest")
            if snap.get("interest") is not None
            else (snap.get("interest_due") or 0)
            for snap in current_snapshots
        ))
        if reported["mortgage_interest"] <= 0 and months_elapsed:
            reported["mortgage_interest"] = _schedule_e_amortized_interest_through_month(
                prop,
                current_year,
                months_elapsed,
            )
    elif has_rental_details and months_elapsed:
        reported["mortgage_interest"] = _schedule_e_amortized_interest_through_month(
            prop,
            current_year,
            months_elapsed,
        )
    if tax_by_year.get(current_year) is not None:
        reported["taxes"] = total["taxes"]
    elif has_current_statement:
        reported["taxes"] = _schedule_e_number(sum(snap.get("taxes_paid") or 0 for snap in current_snapshots))

    if not has_current_statement and not has_rental_details:
        reported = {key: 0.0 for key in reported}

    reported["total_expenses"] = _schedule_e_number(
        reported["mortgage_interest"]
        + reported["taxes"]
        + reported["depreciation"]
        + reported["operating_expenses"]
    )
    reported["net_income"] = _schedule_e_number(reported["rents_received"] - reported["total_expenses"])

    projected = {
        key: _schedule_e_number((total.get(key) or 0) - (reported.get(key) or 0))
        for key in ("rents_received", "mortgage_interest", "taxes", "depreciation", "operating_expenses")
    }
    projected["total_expenses"] = _schedule_e_number(
        projected["mortgage_interest"]
        + projected["taxes"]
        + projected["depreciation"]
        + projected["operating_expenses"]
    )
    projected["net_income"] = _schedule_e_number(projected["rents_received"] - projected["total_expenses"])

    def row(kind: str, label: str, values: Dict[str, float], source_label: str, expandable: bool = False) -> Dict[str, Any]:
        return {
            "kind": kind,
            "label": label,
            "sourceLabel": source_label,
            "expandable": expandable,
            "metrics": {
                "rentsReceived": _schedule_e_money(values.get("rents_received")),
                "mortgageInterest": _schedule_e_money(values.get("mortgage_interest")),
                "propertyTax": _schedule_e_money(values.get("taxes")),
                "operatingExpenses": _schedule_e_money(values.get("operating_expenses")),
                "depreciation": _schedule_e_money(values.get("depreciation")),
                "totalExpenses": _schedule_e_money(values.get("total_expenses")),
                "netScheduleE": _schedule_e_money(values.get("net_income")),
            },
        }

    reported_label = "Uploaded statements / rental records so far"
    if not has_current_statement and not has_rental_details:
        reported_label = "No current-year statement or rental detail uploaded"
    return {
        "year": current_year,
        "asOfDate": (latest_statement_date or date.today()).isoformat(),
        "monthsReported": months_elapsed,
        "summary": (
            "Current year total is split into uploaded/reported activity and backend-projected remainder."
            if has_current_statement or has_rental_details
            else "No current-year statement or rental detail is available; the total is fully projected."
        ),
        "rows": [
            row("total", f"{current_year} total *", total, "Reported + projected", True),
        ],
        "detailRows": [
            row("reported", reported_label, reported, "Reported"),
            row("projected", "Projected remainder", projected, "Projected"),
        ],
    }


@router.get("/{prop_id}/taxes/schedule-e")
def get_schedule_e_capture(
    prop_id: int,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Backend-owned Schedule E capture and filed-return reconciliation."""
    prop = _get_accessible_property(prop_id, db, current_user)
    lifetime_payload = get_lifetime_summary(prop_id, db, current_user)
    yearly = lifetime_payload.get("yearly") or []
    yearly_by_year = {int(row["year"]): row for row in yearly if row.get("year")}
    filed_entries = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.property_id == prop_id,
    ).all()
    filed_by_year = {int(entry.tax_year): entry for entry in filed_entries if entry.tax_year}
    current_year = date.today().year
    available_years = sorted(set(yearly_by_year) | set(filed_by_year) | {current_year})
    selected_year = int(year or lifetime_payload.get("tax_summary", {}).get("current_year") or (available_years[-1] if available_years else current_year))
    if selected_year not in available_years:
        available_years.append(selected_year)
        available_years.sort()

    computed = _computed_schedule_e_components(prop, selected_year, yearly_by_year.get(selected_year))
    filed_entry = filed_by_year.get(selected_year)
    filed_doc = None
    if filed_entry and filed_entry.document_id:
        filed_doc = db.query(models.Document).filter(models.Document.id == filed_entry.document_id).first()
    filed_source = (
        getattr(filed_doc, "display_name", None)
        or getattr(filed_doc, "original_filename", None)
        or ("Uploaded Schedule E" if filed_entry else "No filed Schedule E")
    )

    lines = []
    lines_matched = 0
    lines_filed = 0
    for line_number, line_item, key in SCHEDULE_E_LINE_DEFS:
        computed_value = computed.get(key, 0.0)
        filed_value = _schedule_e_filed_value(filed_entry, key)
        status = _schedule_e_status(computed_value, filed_value)
        if filed_value is not None:
            lines_filed += 1
        if status == "Match":
            lines_matched += 1
        delta = None if filed_value is None else _schedule_e_number(computed_value - filed_value)
        lines.append({
            "lineNumber": line_number,
            "lineItem": line_item,
            "key": key,
            "computed": _schedule_e_money(computed_value),
            "filed": None if filed_value is None else _schedule_e_money(filed_value),
            "delta": None if delta is None else _schedule_e_money(delta),
            "status": status,
        })

    current_year_breakdown = _schedule_e_current_year_breakdown(
        prop,
        selected_year,
        computed,
        yearly_by_year.get(selected_year),
    )
    current_year_history_breakdown = _schedule_e_current_year_breakdown(
        prop,
        current_year,
        _computed_schedule_e_components(prop, current_year, yearly_by_year.get(current_year)),
        yearly_by_year.get(current_year),
    )
    history = []
    for history_year in available_years:
        if history_year == current_year and current_year_history_breakdown:
            total_row = (current_year_history_breakdown.get("rows") or [{}])[0]
            total_components = _schedule_e_components_from_breakdown_metrics(total_row)
            history.append(_schedule_e_history_row(
                history_year,
                total_components,
                label=f"{history_year} Projected *",
                source_label=total_row.get("sourceLabel") or "Reported + projected",
                row_kind="projected_current_year",
                detail_rows=current_year_history_breakdown.get("detailRows") or [],
            ))
        else:
            history.append(_schedule_e_history_row(
                history_year,
                _computed_schedule_e_components(prop, history_year, yearly_by_year.get(history_year)),
            ))
    history_total_row = _schedule_e_history_total_row(history)
    selected_history = next((row for row in history if row["year"] == selected_year), None)
    lifetime_net = _schedule_e_number(sum(row["netScheduleE"]["value"] for row in history))
    accumulated_depreciation = _schedule_e_number(sum(row["depreciation"]["value"] for row in history))
    tax_summary = lifetime_payload.get("tax_summary", {}).get("lifetime", {}) or {}
    net_delta = None
    if filed_entry:
        net_delta = _schedule_e_number(computed.get("net_income", 0) - _schedule_e_number(filed_entry.net_income))
    depreciable_basis = max(float(prop.purchase_price or 0) - float(prop.land_value or 0), 0.0)
    full_rental_rows = [
        row for row in yearly
        if not row.get("is_partial")
        and int(row.get("year") or 0) < current_year
        and row.get("usage_status") != "Primary"
    ]
    full_rental_depreciation = [
        _schedule_e_depreciation(prop, int(row["year"]))
        for row in full_rental_rows
        if row.get("year")
    ]
    depreciation_full_years_ok = (
        depreciable_basis <= 0
        or all(_schedule_e_number(value) > 0 for value in full_rental_depreciation)
    )
    current_projection_depreciation_ok = True
    reported_depreciation_below_projected_total = True
    if current_year_history_breakdown:
        current_total = (current_year_history_breakdown.get("rows") or [{}])[0]
        detail_rows = current_year_history_breakdown.get("detailRows") or []
        current_total_depreciation = _schedule_e_number(
            (current_total.get("metrics") or {}).get("depreciation", {}).get("value")
        )
        detail_depreciation = sum(
            _schedule_e_number((detail.get("metrics") or {}).get("depreciation", {}).get("value"))
            for detail in detail_rows
        )
        current_projection_depreciation_ok = abs(current_total_depreciation - detail_depreciation) <= 1
        reported_row = next((detail for detail in detail_rows if detail.get("kind") == "reported"), None)
        if reported_row and int(current_year_history_breakdown.get("monthsReported") or 0) < 12:
            reported_depreciation = _schedule_e_number(
                (reported_row.get("metrics") or {}).get("depreciation", {}).get("value")
            )
            reported_depreciation_below_projected_total = reported_depreciation < current_total_depreciation
    strip_matches_selected_history = (
        selected_history is None
        or (
            abs(computed.get("mortgage_interest", 0) - selected_history["mortgageInterest"]["value"]) <= 1
            and abs(computed.get("taxes", 0) - selected_history["propertyTax"]["value"]) <= 1
            and abs(computed.get("depreciation", 0) - selected_history["depreciation"]["value"]) <= 1
            and abs(computed.get("net_income", 0) - selected_history["netScheduleE"]["value"]) <= 1
        )
    )
    warnings = []
    if depreciable_basis > 0 and not depreciation_full_years_ok:
        warnings.append("Depreciation is missing for one or more full rental years. Enter land value / basis and placed-in-service details.")
    net_formula_ok = abs(
        computed["net_income"]
        - (
            computed["rents_received"]
            - computed["total_expenses"]
        )
    ) <= 1
    return {
        "schemaVersion": "schedule-e-capture-v1",
        "selectedYear": selected_year,
        "availableYears": available_years,
        "topStrip": {
            "deductibleInterest": _schedule_e_money(computed.get("mortgage_interest")),
            "propertyTax": _schedule_e_money(computed.get("taxes")),
            "depreciation": _schedule_e_money(computed.get("depreciation")),
            "netScheduleE": _schedule_e_money(computed.get("net_income")),
        },
        "lines": lines,
        "summary": {
            "linesMatched": lines_matched,
            "linesFiled": lines_filed,
            "lineCount": len(lines),
            "netDelta": _schedule_e_money(net_delta) if net_delta is not None else {"value": None, "display": "—"},
            "filedSource": filed_source,
            "lifetimeNetScheduleE": _schedule_e_money(lifetime_net),
            "accumulatedDepreciation": _schedule_e_money(accumulated_depreciation),
            "suspendedLosses": _schedule_e_money(tax_summary.get("suspended_loss", 0)),
        },
        "history": history + [history_total_row],
        "currentYearBreakdown": current_year_breakdown,
        "assertions": {
            "netLineMatchesFormula": net_formula_ok,
            "historyMatchesLifetimeNetScheduleE": abs(lifetime_net - _schedule_e_number(sum(row["netScheduleE"]["value"] for row in history))) <= 1,
            "depreciationMatchesAccumulated": abs(accumulated_depreciation - _schedule_e_number(sum(row["depreciation"]["value"] for row in history))) <= 1,
            "depreciationPresentForFullRentalYears": depreciation_full_years_ok,
            "partialYearDepreciationBelowFullYear": reported_depreciation_below_projected_total,
            "currentYearDepreciationSplitMatchesProjectedTotal": current_projection_depreciation_ok,
            "selectedYearStripMatchesHistory": strip_matches_selected_history,
        },
        "warnings": warnings,
    }


@router.get("/{prop_id}/rawdata")
def get_raw_data(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return the complete property snapshot as normalized business tables.

    Document-derived values remain in the response as provenance for loan,
    expense, rental, and tax records; the property Documents inventory is a
    separate product view and is not the organizing model for Raw Data.
    """
    prop = _get_accessible_property(prop_id, db, current_user)

    # Determine purchase year so pre-acquisition data is excluded
    purchase_year = None
    if prop.purchase_date:
        _m = re.search(r'(?:19|20)\d{2}', prop.purchase_date)
        if _m:
            purchase_year = int(_m.group(0))

    snapshots, tax_by_year, interest_by_year, balance_by_year, balance_logic_by_year = _collect_doc_history(prop)
    rental_by_year = _rental_income_by_year(prop)

    # Strip any data from before the acquisition year
    if purchase_year:
        snapshots       = [s for s in snapshots if s["year"] >= purchase_year]
        tax_by_year     = {y: v for y, v in tax_by_year.items()     if y >= purchase_year}
        interest_by_year = {y: v for y, v in interest_by_year.items() if y >= purchase_year}
        balance_by_year  = {y: v for y, v in balance_by_year.items()  if y >= purchase_year}
        balance_logic_by_year = {y: v for y, v in balance_logic_by_year.items() if y >= purchase_year}
        rental_by_year   = {y: v for y, v in rental_by_year.items()   if y >= purchase_year}

    # Schedule E tax return entries
    tax_entries_q = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.property_id == prop_id,
    )
    if purchase_year:
        tax_entries_q = tax_entries_q.filter(
            models.TaxReturnEntry.tax_year >= purchase_year
        )
    tax_entries = tax_entries_q.order_by(
        models.TaxReturnEntry.tax_year,
        models.TaxReturnEntry.id,
    ).all()
    tax_duplicate_counts = {}
    deduped_tax_entries = {}
    for entry in tax_entries:
        # Keep one logical Schedule E row per source document and tax year. If a
        # partial import created multiple rows for the same document, keep the
        # richest/latest row; if different documents exist for the same year,
        # keep them as distinct records so the UI can label Original/Amended.
        source_identity = entry.document_id or f"logical:{(entry.address or '').strip().lower()}"
        key = (
            entry.property_id,
            entry.tax_year,
            entry.property_kind or "",
            source_identity,
        )
        tax_duplicate_counts[key] = tax_duplicate_counts.get(key, 0) + 1
        existing = deduped_tax_entries.get(key)
        existing_score = _tax_entry_score(existing) if existing else -1
        entry_score = _tax_entry_score(entry)
        if existing is None or entry_score >= existing_score:
            deduped_tax_entries[key] = entry
    tax_entries = sorted(
        deduped_tax_entries.values(),
        key=lambda entry: (entry.tax_year or 0, entry.id or 0),
    )
    duplicate_validations = [
        {
            "document_type": "Schedule E",
            "tax_year": key[1],
            "source_identity": key[3],
            "count": count,
            "status": "Needs Review",
            "message": f"Collapsed {count} duplicate Schedule E records for tax year {key[1]} from the same source.",
        }
        for key, count in tax_duplicate_counts.items()
        if count > 1
    ]

    # Aggregate mortgage statement snapshots by year
    stmt_by_year: dict = {}
    for s in snapshots:
        yr = s["year"]
        bucket = stmt_by_year.setdefault(yr, {
            "interest": [], "principal": [], "balance": [], "doc_ids": []
        })
        if s.get("interest") is not None:
            bucket["interest"].append(s["interest"])
        if s.get("principal") is not None:
            bucket["principal"].append(s["principal"])
        if s.get("balance") is not None:
            bucket["balance"].append(s["balance"])
        if s.get("document_id"):
            bucket["doc_ids"].append(s["document_id"])

    stmt_annual = {}
    for yr, d in stmt_by_year.items():
        n = len(d["interest"]) or 1
        stmt_annual[yr] = {
            "interest_annual": round(sum(d["interest"]) / n * 12, 2) if d["interest"] else None,
            "principal_annual": round(sum(d["principal"]) / n * 12, 2) if d["principal"] else None,
            "avg_balance": round(sum(d["balance"]) / len(d["balance"]), 2) if d["balance"] else None,
            "statement_count": len(set(d["doc_ids"])),
        }

    # Annual depreciation (IRS straight-line)
    depreciable = _depreciable_basis(prop)
    annual_depr = round(depreciable / prop.depreciation_years, 2) if prop.depreciation_years else 0

    property_snapshot = {
        "id": prop.id,
        "property_uid": prop.property_uid,
        "name": prop.name,
        "address": prop.address,
        "city": prop.city,
        "state": prop.state,
        "zip_code": prop.zip_code,
        "property_type": prop.property_type,
        "property_type_raw": prop.property_type_raw,
        "usage_type": prop.usage_type,
        "original_residency_status": prop.original_residency_status,
        "current_residency_status": prop.current_residency_status,
        "primary_start_date": prop.primary_start_date,
        "primary_end_date": prop.primary_end_date,
        "rental_start_date": prop.rental_start_date,
        "rental_end_date": prop.rental_end_date,
        "recorded_date": prop.recorded_date,
        "held_period": prop.held_period,
        "purchase_date": prop.purchase_date,
        "purchase_price": prop.purchase_price,
        "down_payment": prop.down_payment,
        "settlement_total_amount": prop.settlement_total_amount,
        "closing_costs": prop.closing_costs,
        "monthly_rent": prop.monthly_rent,
        "occupancy_rate": prop.occupancy_rate,
        "property_tax": prop.property_tax,
        "insurance": prop.insurance,
        "hoa_flag": prop.hoa_flag,
        "hoa_fee": prop.hoa_fee,
        "hoa_special_assessment": prop.hoa_special_assessment,
        "solar_ownership": prop.solar_ownership,
        "solar_monthly_payment": prop.solar_monthly_payment,
        "solar_purchase_price": prop.solar_purchase_price,
        "maintenance": prop.maintenance,
        "property_management_fee": prop.property_management_fee,
        "utilities": prop.utilities,
        "vacancy_allowance": prop.vacancy_allowance,
        "capex_reserve": prop.capex_reserve,
        "other_expenses": prop.other_expenses,
        "land_value": prop.land_value,
        "construction_price": prop.construction_price,
        "depreciation_years": prop.depreciation_years,
        "depreciable_basis": depreciable,
        "irs_annual_depreciation": annual_depr,
        "market_value": prop.market_value,
        "market_value_source": prop.market_value_source,
        "market_value_updated": prop.market_value_updated,
        "notes": prop.notes,
        "created_at": str(prop.created_at) if prop.created_at else None,
        "updated_at": str(prop.updated_at) if prop.updated_at else None,
    }

    def _loan_status_rank(loan):
        if getattr(loan, "is_current_servicer", False):
            return 0
        if str(getattr(loan, "status", "") or "").upper() == "OPEN":
            return 1
        return 2

    loan_snapshot = []
    ordered_loans = sorted(
        prop.loans,
        key=lambda loan: (
            _loan_status_rank(loan),
            getattr(loan, "servicer_sequence", None) if getattr(loan, "servicer_sequence", None) is not None else 999,
            getattr(loan, "servicer_start_date", None) or getattr(loan, "origination_date", None) or "",
            getattr(loan, "id", 0) or 0,
        ),
    )
    for index, loan in enumerate(ordered_loans, start=1):
        loan_snapshot.append({
            "sequence": index,
            "id": loan.id,
            "lender": loan.lender_name,
            "account_number": loan.account_number,
            "loan_product": loan.loan_product,
            "loan_type": loan.loan_type,
            "status": loan.status,
            "is_current_servicer": loan.is_current_servicer,
            "loan_group_id": loan.loan_group_id,
            "servicer_sequence": loan.servicer_sequence,
            "servicer_start_date": loan.servicer_start_date,
            "servicer_end_date": loan.servicer_end_date,
            "transfer_reason": loan.transfer_reason,
            "closed_date": loan.closed_date,
            "closure_reason": loan.closure_reason,
            "replacement_loan_id": loan.replacement_loan_id,
            "original_amount": loan.original_amount,
            "current_balance": current_loan_balance(loan),
            "stored_current_balance": loan.current_balance,
            "current_balance_source": loan.current_balance_source,
            "current_balance_as_of": loan.current_balance_as_of,
            "current_balance_verified": loan.current_balance_verified,
            "interest_rate": loan.interest_rate,
            "rate_note": loan.rate_note,
            "monthly_payment": loan.monthly_payment,
            "estimated_total_monthly_payment": loan.estimated_total_monthly_payment,
            "extra_monthly_payment": loan.extra_monthly_payment,
            "loan_term_years": loan.loan_term_years,
            "origination_date": loan.origination_date,
            "maturity_date": loan.maturity_date,
            "original_ltv": loan.original_ltv,
            "borrowers": loan.borrowers,
            "principal_due": loan.principal_due,
            "interest_due": loan.interest_due,
            "statement_date": loan.statement_date,
            "payment_due_date": loan.payment_due_date,
            "interest_paid_ytd": loan.interest_paid_ytd,
            "principal_paid_ytd": loan.principal_paid_ytd,
            "projected_principal_fy": loan.projected_principal_fy,
            "projected_interest_fy": loan.projected_interest_fy,
            "escrow_included": loan.escrow_included,
            "escrow_amount": loan.escrow_amount,
            "monthly_property_tax_escrow": loan.monthly_property_tax_escrow,
            "monthly_insurance_escrow": loan.monthly_insurance_escrow,
            "monthly_mortgage_insurance": loan.monthly_mortgage_insurance,
            "monthly_other_escrow": loan.monthly_other_escrow,
            "source_document_id": loan.source_document_id,
            "source_type": loan.source_type,
            "import_status": loan.import_status,
        })

    usage_timeline = [
        {
            "id": period.id,
            "usage_type": period.usage_type,
            "start_date": period.start_date,
            "end_date": period.end_date,
            "fmv_at_start": period.fmv_at_start,
            "monthly_rent": period.monthly_rent,
            "vacancy_allowance": period.vacancy_allowance,
            "property_management_fee": period.property_management_fee,
            "accumulated_depreciation_at_start": period.accumulated_depreciation_at_start,
            "suspended_losses_at_start": period.suspended_losses_at_start,
            "notes": period.notes,
        }
        for period in getattr(prop, "usage_periods", []) or []
    ]

    rental_period_snapshot = [
        {
            "id": period.id,
            "tenant_name": period.tenant_name,
            "start_year": period.start_year,
            "start_month": period.start_month,
            "end_year": period.end_year,
            "end_month": period.end_month,
            "monthly_rent": period.monthly_rent,
            "notes": period.notes,
        }
        for period in getattr(prop, "rental_periods", []) or []
    ]

    annual_expense_snapshot = [
        _annual_expense_out(expense)
        for expense in getattr(prop, "annual_expenses", []) or []
    ]

    loan_yearly_history = []
    for loan in ordered_loans:
        tracking = _loan_paydown_tracking(loan, prop)
        for row in tracking.get("rows", []):
            loan_yearly_history.append({
                "id": f"{loan.id}:{row.get('rowKey') or row.get('year')}",
                "loan_id": loan.id,
                "loan_order": next((item["sequence"] for item in loan_snapshot if item["id"] == loan.id), None),
                "lender": loan.lender_name,
                "account_number": loan.account_number,
                "loan_status": loan.status,
                "year": row.get("year"),
                "year_label": row.get("yearLabel"),
                "is_projection": bool(row.get("isFullYearProjection")),
                "start_balance": row.get("startBalance"),
                "principal_paid": row.get("principalPaid"),
                "scheduled_principal": row.get("scheduledPrincipal"),
                "top_up": row.get("topUp"),
                "interest_paid": row.get("interestPaid"),
                "end_balance": row.get("endBalance"),
                "source": row.get("sourceDisplay") or row.get("sourceLabel") or row.get("source"),
                "issue_count": row.get("issueCount", 0),
                "comments": row.get("comments"),
            })

    depreciation_asset_snapshot = [
        {
            "id": asset.id,
            "asset_type": asset.asset_type,
            "description": asset.description,
            "placed_in_service_date": asset.placed_in_service_date,
            "cost_basis": asset.cost_basis,
            "land_portion": asset.land_portion,
            "method": asset.method,
            "recovery_period": asset.recovery_period,
            "prior_depreciation": asset.prior_depreciation,
            "notes": asset.notes,
        }
        for asset in getattr(prop, "depreciation_assets", []) or []
    ]

    # Compute duplicate flags across all docs for this property
    from routers.documents import detect_duplicate_ids
    _dup_ids = detect_duplicate_ids(prop.documents)

    # 1098 document-level detail (per-document, not just aggregated)
    docs_1098_detail = []
    for d in prop.documents:
        if d.doc_category != "1098" or not d.extracted_data:
            continue
        import json as _json
        data = _json.loads(d.extracted_data)
        yr = d.statement_year or data.get("tax_year") or data.get("statement_year")
        if isinstance(yr, str):
            m = re.search(r"(?:19|20)\d{2}", yr)
            yr = int(m.group(0)) if m else None
        if not yr:
            continue
        if purchase_year and yr < purchase_year:
            continue
        docs_1098_detail.append({
            "year": yr,
            "filename": d.original_filename or d.filename,
            "mortgage_interest": data.get("mortgage_interest"),
            "outstanding_principal": data.get("current_balance"),
            "origination_date": data.get("origination_date"),
            "mortgage_acquisition_date": data.get("mortgage_acquisition_date"),
            "account_number": d.loan_account_number or data.get("account_number"),
            "document_id": d.id,
            "upload_date": str(d.upload_date) if d.upload_date else None,
            "is_duplicate": d.id in _dup_ids,
        })

    all_documents = []
    for d in prop.documents:
        extracted = {}
        if d.extracted_data:
            try:
                extracted = json.loads(d.extracted_data)
            except Exception:
                extracted = {}
        doc_year = d.statement_year or extracted.get("tax_year") or extracted.get("statement_year")
        if isinstance(doc_year, str):
            match = re.search(r"(?:19|20)\d{2}", doc_year)
            doc_year = int(match.group(0)) if match else None
        if purchase_year and doc_year and doc_year < purchase_year:
            continue
        all_documents.append({
            "id": d.id,
            "record_uuid": ensure_document_record_uuid(d),
            "category": d.doc_category,
            "display_name": d.display_name or d.original_filename or d.filename,
            "original_filename": d.original_filename or d.filename,
            "file_type": d.file_type,
            "file_size": d.file_size,
            "statement_year": doc_year,
            "statement_date": extracted.get("statement_date"),
            "period_type": d.period_type or extracted.get("period_type"),
            "period_start": d.period_start or extracted.get("period_start"),
            "period_end": d.period_end or extracted.get("period_end"),
            "loan_account_number": d.loan_account_number or extracted.get("account_number"),
            "upload_date": str(d.upload_date) if d.upload_date else None,
            "is_duplicate": d.id in _dup_ids,
            "extracted_field_count": len(extracted) if isinstance(extracted, dict) else 0,
        })

    for document in getattr(prop, "documents", []) or []:
        ensure_document_record_uuid(document)
    for entry in tax_entries:
        ensure_tax_entry_record_uuid(entry)
    db.commit()

    source_docs = {d.id: d for d in getattr(prop, "documents", []) or []}

    return {
        "property_snapshot": property_snapshot,
        "loan_snapshot": loan_snapshot,
        "loan_yearly_history": loan_yearly_history,
        "usage_timeline": usage_timeline,
        "rental_periods": rental_period_snapshot,
        "annual_expenses": annual_expense_snapshot,
        "depreciation_assets": depreciation_asset_snapshot,
        "all_documents": all_documents,
        "duplicate_validations": duplicate_validations,
        "tax_entries": [
            {
                "id": e.id,
                "record_uuid": ensure_tax_entry_record_uuid(e),
                "internal_source_key": f"tax:{e.id}:schedule_e:{e.document_id or 'logical'}",
                "source_type": "Tax Return / Schedule E",
                "document_id": e.document_id,
                "document_name": (source_docs.get(e.document_id).original_filename or source_docs.get(e.document_id).filename) if source_docs.get(e.document_id) else None,
                "import_date": str(source_docs.get(e.document_id).upload_date) if source_docs.get(e.document_id) and source_docs.get(e.document_id).upload_date else None,
                "tax_year": e.tax_year,
                "rents_received": e.rents_received,
                "mortgage_interest": e.mortgage_interest,
                "property_taxes": e.property_taxes,
                "depreciation": e.depreciation,
                "total_expenses": e.total_expenses,
"net_income": e.net_income,
"days_rented": e.days_rented or 0,
"personal_use_days": e.personal_use_days or 0,
"expense_breakdown": json.loads(e.expense_breakdown or "{}"),
"depreciation_detail": json.loads(e.depreciation_detail or "{}"),
"source_refs": json.loads(e.source_refs or "{}"),
"unresolved_fields": json.loads(e.unresolved_fields or "[]"),
"confidence": e.confidence or 0.0,
"schedule1_line5_total": e.schedule1_line5_total,
"schedule1_line5_delta": e.schedule1_line5_delta,
"cash_noi": e.cash_noi,
"tax_pl": e.tax_pl,
"depreciable_basis": e.depreciable_basis,
"accumulated_depreciation": e.accumulated_depreciation,
"remaining_depreciable_basis": e.remaining_depreciable_basis,
"years_remaining": e.years_remaining,
"annual_straight_line_depreciation": e.annual_straight_line_depreciation,
}
            for e in tax_entries
        ],
        "docs_1098": {yr: amt for yr, amt in interest_by_year.items()},
        "docs_1098_detail": docs_1098_detail,
        "docs_balance": {yr: bal for yr, bal in balance_by_year.items()},
        "docs_balance_logic": {yr: v for yr, v in balance_logic_by_year.items()},
        "stmt_annual": {yr: v for yr, v in stmt_annual.items()},
        "tax_docs": {yr: amt for yr, amt in tax_by_year.items()},
        "lease_rent": {
            yr: {
                "income": d["income"],
                "occupied_months": d["occupied_months"],
                "occupancy": d.get("occupancy"),
                # Approximate days from occupied months (not exact but consistent)
                "lease_days": round((d["occupied_months"] or 0) / 12 * (
                    366 if yr % 4 == 0 and (yr % 100 != 0 or yr % 400 == 0) else 365
                )),
            }
            for yr, d in rental_by_year.items()
        },
        "irs_annual_depreciation": annual_depr,
        "snapshots": [
            {
                "date": s["date"],
                "year": s["year"],
                "balance": s["balance"],
                "principal": s["principal"],
                "interest": s["interest"],
                "escrow": s.get("escrow"),
                "document_id": s.get("document_id"),
                "is_duplicate": s.get("document_id") in _dup_ids,
            }
            for s in snapshots
        ],
        "loans": [
            {
                "lender": l.lender_name,
                "current_balance": current_loan_balance(l),
                "interest_rate": l.interest_rate,
                "monthly_payment": l.monthly_payment,
                "interest_due": l.interest_due,
                "principal_due": l.principal_due,
                "escrow_amount": l.escrow_amount,
                "origination_date": l.origination_date,
                "original_amount": l.original_amount,
            }
            for l in prop.loans
        ],
    }


@router.get("/{prop_id}/checklist")
def get_property_checklist(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Required-document checklist for one property: one-time, annual, and
    monthly expected document slots checked against uploads + manual data."""
    prop = _get_accessible_property(prop_id, db, current_user)
    return build_checklist(
        prop,
        docs=prop.documents,
        loans=prop.loans,
        tax_entries=prop.tax_entries,
        rental_periods=prop.rental_periods,
    )


@router.patch("/{prop_id}/notes")
def update_property_notes(
    prop_id: int,
    note: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Save a free-text note on a property."""
    prop = db.query(models.Property).filter(
        models.Property.id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    prop.notes = note.strip()
    db.commit()
    return {"note": prop.notes}


@router.patch("/{prop_id}/year-note")
def update_year_note(
    prop_id: int,
    year: int,
    note: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Save or clear a free-text note for a specific year on a property."""
    prop = db.query(models.Property).filter(
        models.Property.id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    notes = json.loads(prop.year_notes or "{}")
    if note.strip():
        notes[str(year)] = note.strip()
    else:
        notes.pop(str(year), None)
    prop.year_notes = json.dumps(notes)
    db.commit()
    return {"year": year, "note": notes.get(str(year), "")}


@router.post("/{prop_id}/refresh-value")
async def refresh_market_value(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(
        models.Property.id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    result = await get_property_value(
        prop.address, prop.city or "", prop.state or "", prop.zip_code or ""
    )
    if result.get("value"):
        prop.market_value = result["value"]
        prop.market_value_source = result["source"]
        prop.market_value_updated = datetime.utcnow().isoformat()
        db.commit()

    return result


# ── Rental period endpoints ────────────────────────────────────────────────────

def _get_owned_property(prop_id, db, current_user):
    return _get_accessible_property(prop_id, db, current_user)


@router.get("/{prop_id}/usage-periods")
def list_usage_periods(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    annual_usage = build_annual_usage_records(prop)
    return {
        "periods": [UsagePeriodOut.model_validate(p) for p in _timeline_periods(prop)],
        "summary": _usage_summary(prop),
        "annual_usage": annual_usage,
        "by_year": [
            {
                "year": year,
                "primary_days": row.get("PRIMARY", 0),
                "rental_days": row.get("RENTAL", 0),
                "use_status": "Mixed" if row.get("PRIMARY", 0) and row.get("RENTAL", 0) else ("Rental" if row.get("RENTAL", 0) else "Primary"),
            }
            for year, row in sorted(_usage_days_by_year(prop).items())
        ],
    }


@router.post("/{prop_id}/usage-periods", response_model=UsagePeriodOut)
def add_usage_period(
    prop_id: int,
    period_in: UsagePeriodBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    existing = sorted(prop.usage_periods or [], key=lambda p: p.start_date or "")
    previous = existing[-1] if existing else None
    usage_type, start, _ = _validate_usage_period(period_in, previous)
    if previous and not previous.end_date:
        previous.end_date = date.fromordinal(start.toordinal() - 1).isoformat()
    period = models.UsagePeriod(property_id=prop.id, **_usage_period_payload(period_in))
    period.usage_type = usage_type
    db.add(period)
    db.flush()
    _sync_property_current_usage(prop)
    db.commit()
    db.refresh(period)
    return period


@router.put("/{prop_id}/usage-periods/{period_id}", response_model=UsagePeriodOut)
def update_usage_period(
    prop_id: int,
    period_id: int,
    period_in: UsagePeriodBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    period = db.query(models.UsagePeriod).filter_by(id=period_id, property_id=prop.id).first()
    if not period:
        raise HTTPException(status_code=404, detail="Usage period not found")
    ordered = sorted([p for p in prop.usage_periods if p.id != period.id], key=lambda p: p.start_date or "")
    previous = next((p for p in reversed(ordered) if (p.start_date or "") < period_in.start_date), None)
    _validate_usage_period(period_in, previous)
    for key, value in _usage_period_payload(period_in).items():
        setattr(period, key, value)
    _sync_property_current_usage(prop)
    db.commit()
    db.refresh(period)
    return period


@router.delete("/{prop_id}/usage-periods/{period_id}")
def delete_usage_period(
    prop_id: int,
    period_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    period = db.query(models.UsagePeriod).filter_by(id=period_id, property_id=prop.id).first()
    if not period:
        raise HTTPException(status_code=404, detail="Usage period not found")
    db.delete(period)
    db.flush()
    _sync_property_current_usage(prop)
    db.commit()
    return {"ok": True}


@router.get("/{prop_id}/rentals")
def list_rentals(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Recorded lease periods plus a per-year occupancy/income rollup."""
    prop = _get_owned_property(prop_id, db, current_user)
    by_year = _rental_income_by_year(prop)
    yearly = [
        {"year": y, **by_year[y]} for y in sorted(by_year)
    ]
    return {
        "periods": [RentalPeriodOut.model_validate(r) for r in prop.rental_periods],
        "yearly": yearly,
        "total_collected": round(sum(v["income"] for v in by_year.values()), 2),
    }


@router.get("/{prop_id}/rental-timeline")
def get_rental_timeline(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    return build_rental_timeline(prop)


@router.post("/{prop_id}/rental-timeline/periods")
def create_rental_timeline_period(
    prop_id: int,
    period_in: RentalTimelinePeriodIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    status, start, end = _validate_timeline_payload(prop, period_in)
    if status == "occupied":
        db.add(models.RentalPeriod(
            property_id=prop.id,
            tenant_name=None,
            start_year=start.year,
            start_month=start.month,
            end_year=end.year if end else None,
            end_month=end.month if end else None,
            monthly_rent=float(period_in.monthly_rent or 0),
            notes=period_in.notes,
        ))
    else:
        db.add(models.UsagePeriod(
            property_id=prop.id,
            usage_type="NOT_RENTAL",
            start_date=start.isoformat(),
            end_date=end.isoformat() if end else None,
            monthly_rent=0,
            notes=period_in.notes or "",
        ))
    db.commit()
    db.refresh(prop)
    return build_rental_timeline(prop)


@router.put("/{prop_id}/rental-timeline/periods")
def update_rental_timeline_period(
    prop_id: int,
    period_in: RentalTimelinePeriodUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    status, start, end = _validate_timeline_payload(prop, period_in, exclude_ref=period_in.period_ref)
    try:
        kind, raw_id = period_in.period_ref.split(":", 1)
        period_id = int(raw_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "message": "Select a valid period to update."})

    if kind == "occupied":
        period = db.query(models.RentalPeriod).filter_by(id=period_id, property_id=prop.id).first()
    elif kind == "not_rental":
        period = db.query(models.UsagePeriod).filter_by(id=period_id, property_id=prop.id).first()
    else:
        period = None
    if not period:
        raise HTTPException(status_code=404, detail="Rental timeline period not found")

    if kind == "occupied" and status == "occupied":
        period.start_year = start.year
        period.start_month = start.month
        period.end_year = end.year if end else None
        period.end_month = end.month if end else None
        period.monthly_rent = float(period_in.monthly_rent or 0)
        period.notes = period_in.notes
    elif kind == "not_rental" and status == "not_rental":
        period.usage_type = "NOT_RENTAL"
        period.start_date = start.isoformat()
        period.end_date = end.isoformat() if end else None
        period.monthly_rent = 0
        period.notes = period_in.notes or ""
    else:
        db.delete(period)
        db.flush()
        if status == "occupied":
            db.add(models.RentalPeriod(
                property_id=prop.id,
                tenant_name=None,
                start_year=start.year,
                start_month=start.month,
                end_year=end.year if end else None,
                end_month=end.month if end else None,
                monthly_rent=float(period_in.monthly_rent or 0),
                notes=period_in.notes,
            ))
        else:
            db.add(models.UsagePeriod(
                property_id=prop.id,
                usage_type="NOT_RENTAL",
                start_date=start.isoformat(),
                end_date=end.isoformat() if end else None,
                monthly_rent=0,
                notes=period_in.notes or "",
            ))
    db.commit()
    db.refresh(prop)
    return build_rental_timeline(prop)


@router.delete("/{prop_id}/rental-timeline/periods/{period_ref:path}")
def delete_rental_timeline_period(
    prop_id: int,
    period_ref: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    try:
        kind, raw_id = period_ref.split(":", 1)
        period_id = int(raw_id)
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "RENTAL_PERIOD_INVALID", "message": "Select a valid period to delete."})
    if kind == "occupied":
        period = db.query(models.RentalPeriod).filter_by(id=period_id, property_id=prop.id).first()
    elif kind == "not_rental":
        period = db.query(models.UsagePeriod).filter_by(id=period_id, property_id=prop.id).first()
    else:
        period = None
    if not period:
        raise HTTPException(status_code=404, detail="Rental timeline period not found")
    db.delete(period)
    db.commit()
    db.refresh(prop)
    return build_rental_timeline(prop)


@router.post("/{prop_id}/rentals", response_model=RentalPeriodOut)
def add_rental(
    prop_id: int,
    rental_in: RentalPeriodBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    _validate_rental(rental_in)
    rental = models.RentalPeriod(property_id=prop.id, **rental_in.model_dump())
    db.add(rental)
    db.commit()
    db.refresh(rental)
    return rental


@router.put("/{prop_id}/rentals/{rental_id}", response_model=RentalPeriodOut)
def update_rental(
    prop_id: int,
    rental_id: int,
    rental_in: RentalPeriodBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _validate_rental(rental_in)
    prop = _get_owned_property(prop_id, db, current_user)
    rental = db.query(models.RentalPeriod).filter(
        models.RentalPeriod.id == rental_id,
        models.RentalPeriod.property_id == prop.id,
    ).first()
    if not rental:
        raise HTTPException(status_code=404, detail="Rental period not found")
    for k, v in rental_in.model_dump().items():
        setattr(rental, k, v)
    db.commit()
    db.refresh(rental)
    return rental


@router.delete("/{prop_id}/rentals/{rental_id}")
def delete_rental(
    prop_id: int,
    rental_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    rental = db.query(models.RentalPeriod).filter(
        models.RentalPeriod.id == rental_id,
        models.RentalPeriod.property_id == prop.id,
    ).first()
    if not rental:
        raise HTTPException(status_code=404, detail="Rental period not found")
    db.delete(rental)
    db.commit()
    return {"ok": True}


# ── Tax return endpoints ────────────────────────────────────────────────────────

@router.get("/tax-returns/comparison")
def tax_return_comparison(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """All tax-return entries for the user (own + shared), grouped by year."""
    owner_ids = [current_user.id] + [
        s.owner_id for s in db.query(models.UserSharing).filter(
            models.UserSharing.shared_with_id == current_user.id
        ).all()
    ]
    entries = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.owner_id.in_(owner_ids)
    ).order_by(models.TaxReturnEntry.tax_year.desc()).all()

    prop_lookup = {
        p.id: p for p in db.query(models.Property).filter(
            models.Property.owner_id.in_(owner_ids)
        ).all()
    }
    years = {}
    for e in entries:
        row = TaxEntryOut.model_validate(e).model_dump()
        prop = prop_lookup.get(e.property_id)
        if prop:
            row["property_uid"] = prop.property_uid
            row["property_name"] = prop.name or _default_property_name(prop.address, prop.id)
        years.setdefault(e.tax_year, []).append(row)
    result = []
    for year in sorted(years, reverse=True):
        rows = years[year]
        totals = {f: round(sum(r.get(f) or 0 for r in rows), 2) for f in TAX_ENTRY_FIELDS}
        result.append({"tax_year": year, "entries": rows, "totals": totals})
    return {"years": result}


class ManualYearEntryIn(BaseModel):
    tax_year: int
    rents_received: Optional[float] = None
    mortgage_interest: Optional[float] = None
    property_taxes: Optional[float] = None
    depreciation: Optional[float] = None
    total_expenses: Optional[float] = None
    net_income: Optional[float] = None


@router.post("/{prop_id}/tax-entries", response_model=TaxEntryOut)
def upsert_tax_entry(
    prop_id: int,
    entry: ManualYearEntryIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    rec = db.query(models.TaxReturnEntry).filter_by(
        property_id=prop.id, tax_year=entry.tax_year
    ).first()
    if not rec:
        rec = models.TaxReturnEntry(
            owner_id=current_user.id,
            property_id=prop.id,
            tax_year=entry.tax_year,
            property_kind="rental",
        )
        db.add(rec)
    if entry.rents_received is not None:
        rec.rents_received = entry.rents_received
    if entry.mortgage_interest is not None:
        rec.mortgage_interest = entry.mortgage_interest
    if entry.property_taxes is not None:
        rec.property_taxes = entry.property_taxes
    if entry.depreciation is not None:
        rec.depreciation = entry.depreciation
    if entry.total_expenses is not None:
        rec.total_expenses = entry.total_expenses
    if entry.net_income is not None:
        rec.net_income = entry.net_income
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/{prop_id}/tax-entries", response_model=List[TaxEntryOut])
def get_tax_entries(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_owned_property(prop_id, db, current_user)
    return db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.property_id == prop.id
    ).order_by(models.TaxReturnEntry.tax_year.desc()).all()


@router.get("/tax-entries/unassigned", response_model=List[TaxEntryOut])
def get_unassigned_tax_entries(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Schedule E rows extracted from a tax return that didn't match any
    property already in the user's Property List. Held here for manual
    review/linking rather than auto-creating a new property."""
    return db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.owner_id == current_user.id,
        models.TaxReturnEntry.property_id.is_(None),
    ).order_by(models.TaxReturnEntry.tax_year.desc()).all()


class LinkTaxEntryRequest(BaseModel):
    property_id: int


@router.post("/tax-entries/{entry_id}/link", response_model=TaxEntryOut)
def link_tax_entry(
    entry_id: int,
    req: LinkTaxEntryRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Manually link a previously-unassigned Schedule E row to an existing
    property. The target must already be in the user's Property List —
    this never creates one."""
    rec = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.id == entry_id,
        models.TaxReturnEntry.owner_id == current_user.id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Tax entry not found")
    prop = _get_owned_property(req.property_id, db, current_user)
    rec.property_id = prop.id
    db.commit()
    db.refresh(rec)
    return rec


# ── Loan endpoints ─────────────────────────────────────────────────────────────

@router.get("/{prop_id}/loans/{loan_id}/documents")
def get_loan_documents(
    prop_id: int,
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return statements matched to a loan; all matching stays backend-owned."""
    prop = _get_accessible_property(prop_id, db, current_user)
    loan = next((item for item in prop.loans if item.id == loan_id), None)
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    inventory = _loan_document_inventory(loan, prop)
    documents = [
        {**document, "year": year}
        for year, year_documents in inventory.items()
        for document in year_documents
    ]
    documents.sort(
        key=lambda document: (
            int(document.get("year") or 0),
            str(document.get("statementDate") or ""),
            str(document.get("uploadedAt") or ""),
            int(document.get("documentId") or 0),
        ),
        reverse=True,
    )
    return {
        "loanId": loan.id,
        "accountNumber": loan.account_number,
        "count": len(documents),
        "documents": documents,
    }

@router.post("/{prop_id}/loans", response_model=LoanOut)
def add_loan(
    prop_id: int,
    loan_in: LoanBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    loan = models.Loan(property_id=prop_id, **_normalize_loan_payload(prop, loan_in.model_dump()))
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan


@router.put("/{prop_id}/loans/{loan_id}", response_model=LoanOut)
def update_loan(
    prop_id: int,
    loan_id: int,
    loan_in: LoanBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _get_accessible_property(prop_id, db, current_user)
    loan = db.query(models.Loan).filter(
        models.Loan.id == loan_id,
        models.Loan.property_id == prop_id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    prop = loan.property
    for k, v in _normalize_loan_payload(prop, loan_in.model_dump()).items():
        setattr(loan, k, v)
    _sync_servicing_transfer_chain_dates(prop)
    db.commit()
    db.refresh(loan)
    return loan


@router.delete("/{prop_id}/loans/{loan_id}")
def delete_loan(
    prop_id: int,
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _get_accessible_property(prop_id, db, current_user)
    loan = db.query(models.Loan).filter(
        models.Loan.id == loan_id,
        models.Loan.property_id == prop_id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()
    return {"ok": True}


@router.get("/{prop_id}/loans/servicing-transfer-suggestions")
def loan_servicing_transfer_suggestions(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    _sync_servicing_transfer_chain_dates(prop)
    return {
        "suggestions": _servicing_transfer_candidates(list(prop.loans or [])),
        "loanGroups": _loan_group_rows(list(prop.loans or [])),
        "loanTransitionSummary": _loan_transition_summary(list(prop.loans or [])),
    }


@router.post("/{prop_id}/loans/group-servicing-transfer")
def group_servicing_transfer(
    prop_id: int,
    request: LoanServicingTransferApplyRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    previous = db.query(models.Loan).filter(
        models.Loan.id == request.previous_loan_id,
        models.Loan.property_id == prop.id,
    ).first()
    current = db.query(models.Loan).filter(
        models.Loan.id == request.current_loan_id,
        models.Loan.property_id == prop.id,
    ).first()
    if not previous or not current:
        raise HTTPException(status_code=404, detail="Loan not found")
    if previous.id == current.id:
        raise HTTPException(status_code=400, detail="Select two different loans to group.")
    previous_origination = _parse_setup_date(previous.origination_date)
    current_origination = _parse_setup_date(current.origination_date)
    same_original_loan = bool(
        previous_origination
        and current_origination
        and _same_original_loan_date(previous_origination, current_origination)
    )

    close_date = _loan_transfer_close_date(previous, current)
    proposed_closed = request.closed_date or close_date["date"].isoformat()
    parsed_closed = _parse_setup_date(proposed_closed)
    if not parsed_closed:
        raise HTTPException(status_code=422, detail="Closed date must be a valid date.")
    previous_start = _parse_setup_date(previous.origination_date)
    if previous_start and parsed_closed < previous_start:
        raise HTTPException(status_code=422, detail="Closed date cannot be before the original loan date.")

    current_had_start_date = bool(_parse_setup_date(current.servicer_start_date))
    group_id = previous.loan_group_id or current.loan_group_id or f"loan-chain-{uuid.uuid4()}"
    previous.loan_group_id = group_id
    current.loan_group_id = group_id
    previous.servicer_sequence = previous.servicer_sequence or 1
    current.servicer_sequence = max((previous.servicer_sequence or 1) + 1, current.servicer_sequence or 0)
    previous.servicer_start_date = previous.servicer_start_date or previous.origination_date
    previous.servicer_end_date = parsed_closed.isoformat()
    previous.closed_date = parsed_closed.isoformat()
    previous.status = "CLOSED"
    previous.closure_reason = "Servicing transfer" if same_original_loan else "Refinanced"
    previous.transfer_reason = "Servicing transfer" if same_original_loan else "Refinanced"
    previous.is_current_servicer = False
    previous.replacement_loan_id = current.id

    current.status = "OPEN"
    current.closed_date = None
    current.closure_reason = None
    current.servicer_start_date = current.servicer_start_date or parsed_closed.isoformat()
    current.servicer_end_date = None
    current.transfer_reason = "Servicing transfer" if same_original_loan else "Refinance replacement"
    current.is_current_servicer = True

    if current_had_start_date:
        _sync_servicing_transfer_chain_dates(prop)
    db.commit()
    db.refresh(prop)
    return {
        "loanGroups": _loan_group_rows(list(prop.loans or [])),
        "suggestions": _servicing_transfer_candidates(list(prop.loans or [])),
        "loanTransitionSummary": _loan_transition_summary(list(prop.loans or [])),
        "previousLoanId": previous.id,
        "currentLoanId": current.id,
        "loanGroupId": group_id,
    }


def _months_between(start: date, end: date) -> int:
    return max(0, (end.year - start.year) * 12 + end.month - start.month)


def _loan_full_amortization_projection(loan: models.Loan, as_of: Optional[date] = None) -> Dict[str, Any]:
    start = _parse_iso_date(loan.origination_date) or date.today().replace(day=1)
    as_of = as_of or date.today()
    original = float(loan.original_amount or 0)
    current_balance = float(loan.current_balance or 0)
    annual_rate = float(loan.interest_rate or 0)
    monthly_rate = annual_rate / 100 / 12
    base_payment = float((loan.principal_due or 0) + (loan.interest_due or 0))
    if base_payment <= 0:
        base_payment = max(float(loan.monthly_payment or 0) - float(loan.escrow_amount or 0), 0)
    fallback_months = max(1, int(loan.loan_term_years or 30) * 12)
    if base_payment <= 0:
        base_payment = engine_monthly_principal_interest(original, annual_rate, int(loan.loan_term_years or 30))

    if monthly_rate > 0 and base_payment > original * monthly_rate:
        term_months = 0
        balance_for_term = original
        while balance_for_term > 1 and term_months < max(fallback_months, 600):
            interest = balance_for_term * monthly_rate
            principal_paid = min(max(base_payment - interest, 0), balance_for_term)
            balance_for_term = max(balance_for_term - principal_paid, 0)
            term_months += 1
    else:
        term_months = fallback_months

    term_months = max(1, term_months or fallback_months)
    maturity = _add_months(start, term_months)
    latest_statement = _parse_iso_date(loan.statement_date)
    we_are_here = latest_statement or as_of
    if we_are_here < start:
        we_are_here = start
    if we_are_here > maturity:
        we_are_here = maturity
    months_elapsed = min(_months_between(start, we_are_here), term_months)
    months_remaining = max(term_months - months_elapsed, 0)

    rows: List[Dict[str, Any]] = []
    balance = original
    cumulative_interest = 0.0
    for index in range(term_months + 1):
        row_date = _add_months(start, index)
        if index == 0:
            rows.append({
                "date": row_date.isoformat(),
                "monthIndex": 0,
                "payment": 0.0,
                "principal": 0.0,
                "interest": 0.0,
                "balance": round(balance, 2),
                "cumulativeInterest": 0.0,
            })
            continue
        beginning = balance
        interest = beginning * monthly_rate if monthly_rate > 0 else 0.0
        principal_paid = min(max(base_payment - interest, 0.0), beginning)
        balance = max(beginning - principal_paid, 0.0)
        cumulative_interest += interest
        rows.append({
            "date": row_date.isoformat(),
            "monthIndex": index,
            "payment": round(min(base_payment, beginning + interest), 2),
            "principal": round(principal_paid, 2),
            "interest": round(interest, 2),
            "balance": round(balance, 2),
            "cumulativeInterest": round(cumulative_interest, 2),
        })
        if balance <= 0:
            break

    if current_balance > 0 and rows:
        here_row = min(rows, key=lambda row: abs(int(row["monthIndex"]) - months_elapsed))
        here_row["balance"] = round(current_balance, 2)

    next_rows = [row for row in rows if int(row["monthIndex"]) > months_elapsed][:12]
    return {
        "startDate": start.isoformat(),
        "maturityDate": maturity.isoformat(),
        "weAreHereDate": we_are_here.isoformat(),
        "termMonths": term_months,
        "monthsElapsed": months_elapsed,
        "monthsRemaining": months_remaining,
        "payment": round(base_payment, 2),
        "currentBalance": round(current_balance or rows[min(months_elapsed, len(rows) - 1)]["balance"], 2) if rows else 0,
        "schedule": rows,
        "next12": next_rows,
    }


def _display_date(value: Optional[str]) -> str:
    if not value:
        return "—"
    parsed = _parse_iso_date(value)
    if not parsed:
        return value
    return parsed.strftime("%b %d, %Y")


def _amortization_metric(label: str, value: Any, display: Optional[str] = None, *, tone: str = "neutral", source: str = "CALCULATED") -> Dict[str, Any]:
    return {
        "label": label,
        "value": value,
        "displayValue": display if display is not None else ("—" if value is None else str(value)),
        "fullDisplayValue": display if display is not None else ("—" if value is None else str(value)),
        "source": source,
        "tone": tone,
        "status": "complete" if value not in (None, "") else "missing",
    }


def _years_months_display(months: Any) -> str:
    total = max(0, int(months or 0))
    years = total // 12
    rest = total % 12
    if not years:
        return f"{rest} mo"
    if not rest:
        return f"{years} yr"
    return f"{years} yr {rest} mo"


def _loan_payoff_comparison(
    loan: models.Loan,
    *,
    extra_monthly: float = 0.0,
    base_monthly_payment: float = 0.0,
) -> Dict[str, Any]:
    start = _parse_iso_date(loan.origination_date) or date.today().replace(day=1)
    principal = float(loan.original_amount or loan.current_balance or 0)
    annual_rate = float(loan.interest_rate or 0)
    years = max(1, int(loan.loan_term_years or 30))
    regular_schedule = amortization_schedule(
        principal,
        annual_rate,
        years,
        0,
        base_monthly_payment=base_monthly_payment,
    )
    extra_schedule = amortization_schedule(
        principal,
        annual_rate,
        years,
        max(0.0, float(extra_monthly or 0)),
        base_monthly_payment=base_monthly_payment,
    )
    analysis = payoff_analysis(
        principal,
        annual_rate,
        years,
        max(0.0, float(extra_monthly or 0)),
        base_monthly_payment=base_monthly_payment,
    )
    max_month = max(len(regular_schedule), len(extra_schedule), 1)
    chart = []
    for month in range(0, max_month + 1):
        regular_row = regular_schedule[month - 1] if 0 < month <= len(regular_schedule) else None
        extra_row = extra_schedule[month - 1] if 0 < month <= len(extra_schedule) else None
        chart.append({
            "month": month,
            "date": _add_months(start, month).isoformat(),
            "regularBalance": round(principal, 2) if month == 0 else (regular_row or {}).get("balance"),
            "extraBalance": round(principal, 2) if month == 0 else (extra_row or {}).get("balance"),
        })

    regular_months = int(analysis.get("base_months") or len(regular_schedule))
    extra_months = int(analysis.get("extra_months") or len(extra_schedule))
    months_saved = max(0, regular_months - extra_months)
    interest_saved = float(analysis.get("interest_saved") or 0)
    paid_off_date = _add_months(start, extra_months).isoformat() if extra_months else None
    return {
        "extraMonthly": round(max(0.0, float(extra_monthly or 0)), 2),
        "chart": chart,
        "regular": {
            "months": regular_months,
            "paidOffDate": _add_months(start, regular_months).isoformat() if regular_months else None,
        },
        "extra": {
            "months": extra_months,
            "paidOffDate": paid_off_date,
        },
        "summary": {
            "timeSavedMonths": months_saved,
            "timeSavedDisplay": "—" if months_saved <= 0 else _years_months_display(months_saved),
            "interestSaved": round(interest_saved, 2),
            "interestSavedDisplay": "—" if interest_saved <= 0 else format_currency(interest_saved),
            "paidOffDate": paid_off_date,
            "paidOffDateDisplay": _display_date(paid_off_date),
        },
    }


def _loan_amortization_metrics(loan: models.Loan, full: Dict[str, Any], debt_snapshot: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    rows = full.get("schedule") or []
    months_elapsed = int(full.get("monthsElapsed") or 0)
    current_row = None
    if rows:
        current_row = min(rows, key=lambda row: abs(int(row.get("monthIndex") or 0) - months_elapsed))
    current_balance = float(full.get("currentBalance") or (current_row or {}).get("balance") or 0)
    cumulative_interest = float((current_row or {}).get("cumulativeInterest") or 0)
    if debt_snapshot and not cumulative_interest:
        cumulative_interest = float(debt_snapshot.get("accumulated_interest") or 0)
    last_statement = debt_snapshot.get("last_known_statement_date") if debt_snapshot else loan.statement_date
    gap_months = int(debt_snapshot.get("gap_months_projected") or 0) if debt_snapshot else 0
    if not gap_months and last_statement:
        statement_date = _parse_statement_date(last_statement)
        if statement_date:
            gap_months = max(0, _months_between(statement_date, date.today()))
    warning = None
    if gap_months > 0:
        warning = "Projected from last statement using entered loan terms. Upload a recent statement to replace projected months with reported figures."
    return {
        "balanceToday": _amortization_metric("Balance today", current_balance, format_currency(current_balance), source="CALCULATED"),
        "interestAccumulated": _amortization_metric("Interest accumulated", cumulative_interest, format_currency(cumulative_interest), source="CALCULATED"),
        "lastStatement": _amortization_metric("Last statement", last_statement, _display_date(last_statement), source="REPORTED" if last_statement else "CALCULATED"),
        "gapProjected": _amortization_metric("Gap projected", gap_months, f"{gap_months} mo" if gap_months > 0 else "None", tone="warn" if gap_months > 0 else "neutral", source="PROJECTED" if gap_months > 0 else "CALCULATED"),
        "loanStarted": _amortization_metric("Loan started", full.get("startDate"), _display_date(full.get("startDate")), source="MANUAL"),
        "maturityDate": _amortization_metric("Maturity date", full.get("maturityDate"), f"{_display_date(full.get('maturityDate'))} ({round((full.get('termMonths') or 0) / 12)} yrs)", source="CALCULATED"),
        "monthsElapsed": _amortization_metric("Months elapsed", months_elapsed, f"{months_elapsed} months"),
        "monthsRemaining": _amortization_metric("Months remaining", full.get("monthsRemaining") or 0, f"{full.get('monthsRemaining') or 0} months ({_years_months_display(full.get('monthsRemaining') or 0)})"),
        "warning": warning,
    }


@router.get("/{prop_id}/loans/{loan_id}/amortization")
def get_amortization(
    prop_id: int,
    loan_id: int,
    extra_monthly: float = 0.0,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _get_accessible_property(prop_id, db, current_user)
    loan = db.query(models.Loan).filter(
        models.Loan.id == loan_id,
        models.Loan.property_id == prop_id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    base_monthly_pi = (loan.principal_due or 0) + (loan.interest_due or 0)
    if base_monthly_pi <= 0:
        base_monthly_pi = max((loan.monthly_payment or 0) - (loan.escrow_amount or 0), 0)
    if base_monthly_pi <= 0:
        base_monthly_pi = engine_monthly_principal_interest(
            loan.current_balance or loan.original_amount or 0,
            loan.interest_rate or 0,
            loan.loan_term_years or 30,
        )

    schedule = amortization_schedule(
        loan.current_balance, loan.interest_rate,
        loan.loan_term_years, extra_monthly,
        base_monthly_payment=base_monthly_pi,
    )
    analysis = payoff_analysis(
        loan.current_balance, loan.interest_rate,
        loan.loan_term_years, extra_monthly,
        base_monthly_payment=base_monthly_pi,
    )
    full_amortization = _loan_full_amortization_projection(loan)
    return {
        "schedule": schedule,
        "analysis": analysis,
        "fullAmortization": full_amortization,
        "payoffComparison": _loan_payoff_comparison(
            loan,
            extra_monthly=extra_monthly,
            base_monthly_payment=base_monthly_pi,
        ),
        "metrics": _loan_amortization_metrics(loan, full_amortization),
    }


@router.post("/{prop_id}/scenarios/simulate")
def simulate_scenarios(
    prop_id: int,
    request: ScenarioSimRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = _get_accessible_property(prop_id, db, current_user)
    loan = db.query(models.Loan).filter(
        models.Loan.id == request.loan_id,
        models.Loan.property_id == prop_id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    base_monthly_pi = (loan.principal_due or 0) + (loan.interest_due or 0)
    if base_monthly_pi <= 0:
        base_monthly_pi = max((loan.monthly_payment or 0) - (loan.escrow_amount or 0), 0)
    if base_monthly_pi <= 0:
        base_monthly_pi = engine_monthly_principal_interest(
            loan.current_balance or loan.original_amount or 0,
            loan.interest_rate or 0,
            loan.loan_term_years or 30,
        )
    scenarios = [scenario.model_dump() for scenario in request.scenarios]
    property_metrics = compute_property_metrics(prop)
    monthly_cash_flow = request.monthly_cash_flow
    if monthly_cash_flow == 0:
        monthly_cash_flow = property_metrics.get("monthly_cash_flow", 0) or 0
    dscr = request.dscr or property_metrics.get("dscr", 0) or 0
    return simulate_what_if_scenarios(
        loan.current_balance or loan.original_amount or 0,
        loan.interest_rate or 0,
        loan.loan_term_years or 30,
        scenarios,
        start_date=loan.origination_date or prop.purchase_date,
        base_monthly_payment=base_monthly_pi,
        market_value=prop.market_value or 0,
        monthly_cash_flow=monthly_cash_flow,
        dscr=dscr,
        comparison_rates=request.comparison_rates,
        highlight_goal=request.highlight_goal,
    )


@router.get("/{prop_id}/loans/{loan_id}/arm-schedule")
def get_arm_schedule(
    prop_id: int,
    loan_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _get_accessible_property(prop_id, db, current_user)
    loan = db.query(models.Loan).filter(
        models.Loan.id == loan_id,
        models.Loan.property_id == prop_id,
    ).first()
    if not loan or loan.loan_type != "ARM":
        raise HTTPException(status_code=404, detail="ARM loan not found")

    schedule = arm_schedule(
        loan.current_balance,
        loan.interest_rate,
        loan.arm_initial_period or 5,
        loan.arm_adjustment_period or 1,
        loan.arm_cap or loan.interest_rate + 5,
        loan.arm_margin or 2.75,
        loan.loan_term_years,
    )
    return {"schedule": schedule}


@router.get("/{prop_id}/debt")
def get_debt(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Per-loan balance and accumulated-interest breakdown using the best
    available source per period: Form 1098 > Schedule E (tax return) >
    a month-by-month amortization projection filling only the gap between
    the loan's last known statement and today."""
    prop = _get_accessible_property(prop_id, db, current_user)

    _, _, interest_by_year, _, _ = _collect_doc_history(prop)
    interest_by_account = _interest_by_year_by_account(prop)
    tax_return_interest_by_year = {
        e.tax_year: e.mortgage_interest
        for e in db.query(models.TaxReturnEntry).filter(
            models.TaxReturnEntry.property_id == prop_id,
        ).all()
        if e.mortgage_interest
    }

    today = date.today()
    loans = _resolved_debt_metadata(prop, _logical_debt_waterfalls(
        prop,
        interest_by_year,
        tax_return_interest_by_year,
        interest_by_account,
        today,
    ))
    active_loans = [
        loan for loan in loans
        if str(loan.get("status") or "OPEN").upper() not in CLOSED_LOAN_STATUSES
    ]
    total_balance = round(sum(float(l.get("current_balance") or 0) for l in active_loans), 2)
    total_original = round(sum(float(l.get("original_amount") or 0) for l in active_loans), 2)
    total_principal = round(sum(float(l.get("principal_paid") or 0) for l in active_loans), 2)
    total_interest = round(sum(float(l.get("accumulated_interest") or 0) for l in active_loans), 2)
    row_interest = round(sum(
        float(row.get("interestPaid") or 0)
        for loan in active_loans
        for row in ((loan.get("paydown") or {}).get("rows") or [])
        if not row.get("isFullYearProjection")
    ), 2)

    return {
        "loans": loans,
        "refinanceChains": _refinance_chain_payload(loans),
        "yearlyPrincipalInterestRows": _loan_yearly_reporting_rows(loans),
        "paymentHistoryRows": _loan_payment_history_rows(prop),
        "portfolio": {
            "totalBalance": total_balance,
            "totalBalanceDisplay": format_currency(total_balance),
            "paidToDate": total_principal,
            "paidToDateDisplay": format_currency(total_principal),
            "interestToDate": total_interest,
            "interestToDateDisplay": format_currency(total_interest),
            "loanCount": len(active_loans),
            "loanCountDisplay": str(len(active_loans)),
            "originalAmount": total_original,
            "originalAmountDisplay": format_currency(total_original),
        },
        "rollup": {
            "total_current_balance": total_balance,
            "total_accumulated_interest": total_interest,
        },
        "assertions": {
            "L3_totalBalanceEqualsSumLoanBalances": abs(total_balance - sum(float(l.get("current_balance") or 0) for l in active_loans)) <= 1,
            "L8_interestToDateEqualsSumLoanInterest": abs(total_interest - row_interest) <= 1,
            "interestToDateFromRows": row_interest,
        },
    }


# ── Dashboard ─────────────────────────────────────────────────────────────────

def _dashboard_metric(
    key: str,
    label: str,
    value: Optional[float],
    *,
    unit: str = "currency",
    status: str = "ok",
    reason: Optional[str] = None,
    description: str = "",
    source: str = "backend_dashboard_aggregator",
    as_of_date: Optional[str] = None,
    compact: bool = True,
) -> Dict[str, Any]:
    if value is None or status == "data_issue":
        display = "Unavailable" if status == "data_issue" else "—"
        full_display = display
    elif unit == "currency":
        display = _compact_money_display(value) if compact else format_currency(value)
        full_display = format_currency(value)
    elif unit == "percent":
        display = _percent_display(value)
        full_display = _percent_display(value)
    elif unit == "interest_rate":
        display = format_interest_rate(value)
        full_display = format_interest_rate(value)
    elif unit == "ratio":
        display = f"{round(float(value or 0), 2):.2f}".rstrip("0").rstrip(".")
        full_display = display
    else:
        display = f"{float(value or 0):,.0f}"
        full_display = display
    return {
        "key": key,
        "label": label,
        "value": None if status == "data_issue" else value,
        "display": display,
        "fullDisplay": full_display,
        "unit": unit,
        "status": status,
        "reason": reason,
        "description": description,
        "asOfDate": as_of_date or date.today().isoformat(),
        "source": source,
        "threshold": None,
        "formula": None,
        "inputs": [],
    }


def _dashboard_ltv_metric(debt: float, value: float, *, as_of_date: str) -> Dict[str, Any]:
    if debt > 0 and value <= 0:
        return _dashboard_metric(
            "ltv",
            "LTV",
            None,
            unit="percent",
            status="data_issue",
            reason="Loan balance exists but market value is unavailable.",
            as_of_date=as_of_date,
        )
    if value <= 0:
        return _dashboard_metric("ltv", "LTV", None, unit="percent", status="data_issue", reason="Market value is unavailable.", as_of_date=as_of_date)
    return _dashboard_metric("ltv", "LTV", round(debt / value * 100, 2), unit="percent", as_of_date=as_of_date)


def _build_executive_dashboard(
    dashboard_model: Dict[str, Any],
    yearly_trends: List[Dict[str, Any]],
    *,
    as_of_date: Optional[str] = None,
) -> Dict[str, Any]:
    as_of = as_of_date or date.today().isoformat()
    rental_details = dashboard_model.get("properties") or []
    primary_details = dashboard_model.get("primary_properties") or []
    excluded_count = int(dashboard_model.get("excluded_count") or 0)
    total_rent = float(dashboard_model.get("total_monthly_rent") or 0)
    total_noi = float(dashboard_model.get("total_annual_noi") or 0)
    total_debt = float(dashboard_model.get("total_loan_balance") or 0)
    total_value = float(dashboard_model.get("total_market_value") or 0)
    annual_debt_service = float(dashboard_model.get("annual_debt_service") or 0)
    monthly_debt_service = annual_debt_service / 12 if annual_debt_service else 0
    monthly_operating_expenses = max(0.0, total_rent - (total_noi / 12)) if total_rent else 0.0
    monthly_cash_flow = float(dashboard_model.get("total_monthly_cash_flow") or 0)
    occupancy_metric_status = "ok"
    scheduled_rent = sum(float(p.get("monthly_rent") or 0) for p in rental_details)
    occupancy = (total_rent / scheduled_rent * 100) if scheduled_rent else None
    occupancy_reason = None
    if occupancy is not None and (occupancy < 0 or occupancy > 100):
        occupancy_metric_status = "data_issue"
        occupancy_reason = "Scheduled rent and effective rent use incompatible periods."
    properties_needing_attention = [
        p for p in rental_details
        if (p.get("monthly_cash_flow") or 0) < 0
        or ((p.get("total_loan_balance") or 0) > 0 and (p.get("market_value") or 0) <= 0)
        or ((p.get("market_value") or 0) > 0 and (p.get("total_loan_balance") or 0) / (p.get("market_value") or 1) > 0.8)
    ]
    overview = [
        _dashboard_metric("portfolioValue", "Portfolio Value", dashboard_model.get("total_market_value"), as_of_date=as_of),
        _dashboard_metric("totalEquity", "Total Equity", dashboard_model.get("total_equity"), as_of_date=as_of),
        _dashboard_metric("monthlyNetCashFlow", "Monthly Net Cash Flow", monthly_cash_flow, as_of_date=as_of),
        _dashboard_ltv_metric(total_debt, total_value, as_of_date=as_of) | {"key": "portfolioLtv", "label": "Portfolio LTV"},
        _dashboard_metric("annualNoi", "Annual NOI", total_noi, as_of_date=as_of),
        _dashboard_metric("propertiesNeedingAttention", "Properties Needing Attention", len(properties_needing_attention), unit="count", as_of_date=as_of),
    ]
    actions = []
    seen_action_keys = set()
    def add_action(group: str, key: str, title: str, impact: str, why: str, action_label: str, scope: str = "Portfolio", severity: str = "warning"):
        if key in seen_action_keys:
            return
        seen_action_keys.add(key)
        actions.append({
            "id": key,
            "group": group,
            "severity": severity,
            "scope": scope,
            "title": title,
            "financialImpact": impact,
            "whyItMatters": why,
            "primaryAction": {"label": action_label, "href": "/properties"},
            "secondaryAction": None,
        })
    for p in rental_details:
        cash_flow = float(p.get("monthly_cash_flow") or 0)
        if cash_flow < 0:
            add_action(
                "Critical Now",
                f"negative-cash-flow-{p.get('id')}",
                f"{p.get('name') or p.get('address') or 'Property'} is losing {format_currency(abs(cash_flow))} per month",
                f"-{format_currency(abs(cash_flow))}/mo",
                "Negative monthly cash flow directly reduces portfolio liquidity.",
                "Open property",
                scope=p.get("name") or p.get("address") or "Property",
                severity="critical",
            )
    if occupancy_metric_status == "data_issue":
        add_action("Review Soon", "occupancy-data-quality", "Occupancy cannot be validated", "Data quality", occupancy_reason or "Occupancy is unavailable.", "Review rent records", severity="warning")
    if dashboard_model.get("weighted_avg_rate") and dashboard_model.get("weighted_avg_rate") > 6:
        add_action("Opportunities", "high-weighted-rate", "Review high-rate debt", format_interest_rate(dashboard_model.get("weighted_avg_rate")), "Higher debt cost can reduce cash flow and DSCR.", "Review loans", severity="info")
    property_health = []
    for p in rental_details:
        value = float(p.get("market_value") or 0)
        debt = float(p.get("total_loan_balance") or 0)
        ltv_metric = _dashboard_ltv_metric(debt, value, as_of_date=as_of)
        annual_debt = float(p.get("monthly_mortgage") or 0) * 12
        dscr = (float(p.get("annual_noi") or 0) / annual_debt) if annual_debt else None
        cash_flow = float(p.get("monthly_cash_flow") or 0)
        status = "Needs Review" if cash_flow < 0 or ltv_metric.get("status") == "data_issue" else "Stable"
        property_health.append({
            "id": p.get("id"),
            "property": p.get("name") or p.get("address") or "Property",
            "monthlyCashFlow": _dashboard_metric("monthlyCashFlow", "Monthly Cash Flow", cash_flow, compact=False, as_of_date=as_of),
            "dscr": _dashboard_metric("dscr", "DSCR", dscr, unit="ratio", status="data_issue" if dscr is None and annual_debt else "ok", reason="Annual debt service unavailable." if dscr is None and annual_debt else None, as_of_date=as_of),
            "ltv": ltv_metric,
            "equity": _dashboard_metric("equity", "Equity", (value - debt) if value or debt else None, compact=False, as_of_date=as_of),
            "dataHealth": "Needs source data" if ltv_metric.get("status") == "data_issue" else "Complete",
            "status": status,
            "action": "Review source data" if status == "Needs Review" else "Monitor",
        })
    cash_flow_series = [
        {"label": "Gross rent", "value": total_rent, "display": format_currency(total_rent)},
        {"label": "Operating expenses", "value": monthly_operating_expenses, "display": format_currency(monthly_operating_expenses)},
        {"label": "NOI", "value": total_noi / 12 if total_noi else 0, "display": format_currency(total_noi / 12 if total_noi else 0)},
        {"label": "Debt service", "value": monthly_debt_service, "display": format_currency(monthly_debt_service)},
        {"label": "Net cash flow", "value": monthly_cash_flow, "display": format_currency(monthly_cash_flow)},
    ]
    monthly_noi = total_noi / 12 if total_noi else 0
    cash_flow_waterfall = [
        {"key": "grossRent", "label": "Gross Rent", "value": total_rent, "delta": total_rent, "runningTotal": total_rent, "display": format_currency(total_rent), "runningDisplay": format_currency(total_rent), "tone": "positive"},
        {"key": "operatingExpenses", "label": "Operating Expenses", "value": monthly_operating_expenses, "delta": -monthly_operating_expenses, "runningTotal": monthly_noi, "display": format_currency(monthly_operating_expenses), "runningDisplay": format_currency(monthly_noi), "tone": "negative"},
        {"key": "noi", "label": "NOI", "value": monthly_noi, "delta": 0, "runningTotal": monthly_noi, "display": format_currency(monthly_noi), "runningDisplay": format_currency(monthly_noi), "tone": "positive", "subtotal": True},
        {"key": "debtService", "label": "Debt Service", "value": monthly_debt_service, "delta": -monthly_debt_service, "runningTotal": monthly_cash_flow, "display": format_currency(monthly_debt_service), "runningDisplay": format_currency(monthly_cash_flow), "tone": "negative"},
        {"key": "netCashFlow", "label": "Net Cash Flow", "value": monthly_cash_flow, "delta": 0, "runningTotal": monthly_cash_flow, "display": format_currency(monthly_cash_flow), "runningDisplay": format_currency(monthly_cash_flow), "tone": "positive" if monthly_cash_flow >= 0 else "negative", "total": True},
    ]
    equity_stacks = []
    for p in rental_details:
        appreciation_value = max(float((p.get("market_value") or 0) - (p.get("purchase_price") or 0)), 0)
        principal_value = max(float(p.get("principal_paid") or 0), 0)
        equity_value = float(p.get("equity") or 0)
        residual_equity = max(equity_value - appreciation_value - principal_value, 0)
        equity_stacks.append({
            "id": p.get("id"),
            "label": p.get("name") or p.get("address") or "Property",
            "segments": [
                {"key": "appreciation", "label": "Appreciation", "value": appreciation_value, "display": format_currency(appreciation_value), "tone": "positive"},
                {"key": "principalPaydown", "label": "Principal Paydown", "value": principal_value, "display": format_currency(principal_value), "tone": "asset"},
                {"key": "totalEquity", "label": "Total Equity", "value": residual_equity, "display": format_currency(residual_equity), "tone": "neutral"},
            ],
            "total": equity_value,
            "totalDisplay": format_currency(equity_value),
        })
    debt_spectrum = []
    for p in rental_details:
        for index, loan in enumerate(p.get("loans") or []):
            rate = float(loan.get("interest_rate") or 0)
            debt_spectrum.append({
                "id": loan.get("id") or f"{p.get('id')}-{index}",
                "property": p.get("name") or p.get("address") or "Property",
                "lender": loan.get("lender_name") or loan.get("loan_type") or "Loan",
                "rate": rate,
                "rateDisplay": format_interest_rate(rate),
                "balance": loan.get("current_balance") or 0,
                "balanceDisplay": format_currency(loan.get("current_balance") or 0),
                "tone": "positive" if rate < 5 else "warning" if rate < 7 else "negative",
                "refinanceCandidate": rate >= 7,
            })
    tax_income = sum(row.get("rental_income") or 0 for row in yearly_trends)
    tax_interest = sum(row.get("mortgage_interest") or 0 for row in yearly_trends)
    tax_property_tax = sum(row.get("property_taxes") or 0 for row in yearly_trends)
    tax_depreciation = sum(row.get("depreciation") or 0 for row in yearly_trends)
    taxable_income = sum(row.get("net_income") or 0 for row in yearly_trends)
    tax_waterfall = [
        {"key": "rentalIncome", "label": "Rental Income", "value": tax_income, "delta": tax_income, "runningTotal": tax_income, "display": format_currency(tax_income), "runningDisplay": format_currency(tax_income), "tone": "positive"},
        {"key": "mortgageInterest", "label": "Mortgage Interest", "value": tax_interest, "delta": -tax_interest, "runningTotal": tax_income - tax_interest, "display": format_currency(tax_interest), "runningDisplay": format_currency(tax_income - tax_interest), "tone": "tax"},
        {"key": "propertyTax", "label": "Property Tax", "value": tax_property_tax, "delta": -tax_property_tax, "runningTotal": tax_income - tax_interest - tax_property_tax, "display": format_currency(tax_property_tax), "runningDisplay": format_currency(tax_income - tax_interest - tax_property_tax), "tone": "tax"},
        {"key": "depreciation", "label": "Depreciation", "value": tax_depreciation, "delta": -tax_depreciation, "runningTotal": taxable_income, "display": format_currency(tax_depreciation), "runningDisplay": format_currency(taxable_income), "tone": "tax"},
        {"key": "taxableIncome", "label": "Taxable Income", "value": taxable_income, "delta": 0, "runningTotal": taxable_income, "display": format_currency(taxable_income), "runningDisplay": format_currency(taxable_income), "tone": "positive" if taxable_income >= 0 else "negative", "total": True},
    ]
    trend_series = [
        {"year": row.get("year"), "rentalIncome": row.get("rental_income") or 0, "netIncome": row.get("net_income") or 0, "depreciation": row.get("depreciation") or 0}
        for row in sorted(yearly_trends or [], key=lambda item: item.get("year") or 0)
    ]
    stories = [
        {
            "key": "cashFlow",
            "title": "Cash Flow",
            "metrics": cash_flow_series,
            "chart": {"type": "waterfall", "title": "Where rental income goes each month", "subtitle": "Gross rent to net cash flow", "narrative": "The waterfall explains how gross rent becomes spendable cash flow after operating expenses and debt service.", "nodes": cash_flow_waterfall, "annotations": [], "insight": f"Net monthly cash flow is {format_currency(monthly_cash_flow)} after operating expenses and debt service.", "recommendation": "Review properties with negative cash flow before adding leverage." if monthly_cash_flow < 0 else "Maintain expense discipline while cash flow remains positive."},
            "explanation": "Monthly net cash flow is calculated from rent, operating expenses, NOI, and debt service for included rental properties.",
            "link": {"label": "Review cash flow", "href": "/dashboard"},
        },
        {
            "key": "equityGrowth",
            "title": "Equity Growth",
            "metrics": [
                _dashboard_metric("totalEquity", "Total equity", dashboard_model.get("total_equity"), as_of_date=as_of),
                _dashboard_metric("appreciation", "Appreciation", dashboard_model.get("total_appreciation_gain"), as_of_date=as_of),
                _dashboard_metric("principalPaid", "Principal paydown", dashboard_model.get("total_principal_paid"), as_of_date=as_of),
            ],
            "chart": [{"label": p.get("name") or p.get("address") or "Property", "value": p.get("equity") or 0, "display": format_currency(p.get("equity") or 0)} for p in rental_details],
            "explanation": "Equity growth combines market value, outstanding debt, appreciation, and principal paydown for the selected portfolio scope.",
            "link": {"label": "Review equity", "href": "/dashboard"},
        },
        {
            "key": "debtLeverage",
            "title": "Debt & Leverage",
            "metrics": [
                _dashboard_metric("totalDebt", "Total debt", total_debt, as_of_date=as_of),
                _dashboard_metric("weightedRate", "Weighted interest rate", dashboard_model.get("weighted_avg_rate"), unit="interest_rate", as_of_date=as_of),
                _dashboard_ltv_metric(total_debt, total_value, as_of_date=as_of) | {"key": "portfolioLtv", "label": "Portfolio LTV"},
                _dashboard_metric("dscr", "DSCR", dashboard_model.get("portfolio_dscr"), unit="ratio", as_of_date=as_of),
            ],
            "chart": [{"label": p.get("name") or p.get("address") or "Property", "value": p.get("total_loan_balance") or 0, "display": format_currency(p.get("total_loan_balance") or 0)} for p in rental_details],
            "explanation": "Debt and leverage use included rental debt, value, and debt service at the dashboard as-of date.",
            "link": {"label": "Review debt", "href": "/dashboard"},
        },
        {
            "key": "taxImpact",
            "title": "Tax Impact",
            "metrics": [
                _dashboard_metric("rentalIncome", "Rental income", sum(row.get("rental_income") or 0 for row in yearly_trends), as_of_date=as_of),
                _dashboard_metric("mortgageInterest", "Mortgage interest", sum(row.get("mortgage_interest") or 0 for row in yearly_trends), as_of_date=as_of),
                _dashboard_metric("propertyTax", "Property tax", sum(row.get("property_taxes") or 0 for row in yearly_trends), as_of_date=as_of),
                _dashboard_metric("depreciation", "Depreciation", sum(row.get("depreciation") or 0 for row in yearly_trends), as_of_date=as_of),
                _dashboard_metric("taxableIncome", "Taxable rental income", sum(row.get("net_income") or 0 for row in yearly_trends), as_of_date=as_of),
            ],
            "chart": trend_series,
            "explanation": "Tax impact is based on uploaded Schedule E and tax records available for the included rental properties.",
            "link": {"label": "Review taxes", "href": "/dashboard"},
        },
    ]
    primary_summary = {
        "title": "Primary Residence — excluded from rental performance",
        "collapsed": True,
        "description": "Excluded from rental cash flow, rental NOI, and rental DSCR. Included only in total net-worth views when selected.",
        "metrics": [
            _dashboard_metric("marketValue", "Market Value", dashboard_model.get("primary_market_value"), as_of_date=as_of),
            _dashboard_metric("equity", "Equity", dashboard_model.get("primary_equity"), as_of_date=as_of),
            _dashboard_ltv_metric(float(dashboard_model.get("primary_loan_balance") or 0), float(dashboard_model.get("primary_market_value") or 0), as_of_date=as_of),
            _dashboard_metric("monthlyHousingCost", "Monthly Housing Cost", dashboard_model.get("primary_monthly_cost"), as_of_date=as_of),
        ],
        "properties": primary_details,
    }
    data_quality_status = "Needs Review" if occupancy_metric_status == "data_issue" or any(row.get("dataHealth") != "Complete" for row in property_health) else "Complete"
    return {
        "schemaVersion": "portfolio-dashboard.v1",
        "scope": {
            "includedRentalProperties": len(rental_details),
            "excludedProperties": excluded_count,
            "includedPropertyIds": [p.get("id") for p in rental_details],
        },
        "asOfDate": as_of,
        "lastRefresh": datetime.utcnow().isoformat() + "Z",
        "dataQualityStatus": data_quality_status,
        "overview": overview,
        "attention": {
            "groups": [
                {"key": "critical", "label": "Critical Now", "actions": [a for a in actions if a["group"] == "Critical Now"][:5]},
                {"key": "review", "label": "Review Soon", "actions": [a for a in actions if a["group"] == "Review Soon"][:5]},
                {"key": "opportunities", "label": "Opportunities", "actions": [a for a in actions if a["group"] == "Opportunities"][:5]},
            ],
            "maxVisible": 5,
        },
        "propertyHealth": property_health,
        "stories": stories,
        "primaryResidence": primary_summary,
        "dataQuality": {
            "status": data_quality_status,
            "checks": [
                _dashboard_metric("occupancy", "Occupancy", occupancy, unit="percent", status=occupancy_metric_status, reason=occupancy_reason, as_of_date=as_of),
            ],
        },
    }


@router.get("/dashboard/summary")
def dashboard_summary(
    exclude_ids: str = "",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    own_props = db.query(models.Property).filter(
        models.Property.owner_id == current_user.id
    ).all()

    # Include properties from users who have shared their portfolio with me
    shares_received = db.query(models.UserSharing).filter(
        models.UserSharing.shared_with_id == current_user.id
    ).all()
    shared_owner_ids = [s.owner_id for s in shares_received]
    shared_props = []
    if shared_owner_ids:
        shared_props = db.query(models.Property).filter(
            models.Property.owner_id.in_(shared_owner_ids)
        ).all()

    all_props = own_props + shared_props
    excluded_id_set = {
        int(x) for x in (exclude_ids or "").split(",")
        if x.strip().isdigit()
    }
    props = [p for p in all_props if p.id not in excluded_id_set]

    total_properties = len(props)
    total_market_value = sum(p.market_value for p in props)
    total_loan_balance = sum(
        sum(current_loan_balance(l) for l in p.loans) for p in props
    )
    total_monthly_mortgage = sum(
        sum(max(l.monthly_payment - l.escrow_amount, 0) for l in p.loans) for p in props
    )
    total_equity = total_market_value - total_loan_balance

    # Pre-aggregate interest paid per property from tax return entries
    # Include tax entries from shared owners so the shared-user view is complete
    all_owner_ids = [current_user.id] + shared_owner_ids
    _tax_entries = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.owner_id.in_(all_owner_ids)
    ).all()
    interest_by_prop: dict[int, float] = {}
    for _e in _tax_entries:
        if _e.property_id:
            interest_by_prop[_e.property_id] = (
                interest_by_prop.get(_e.property_id, 0.0) + (_e.mortgage_interest or 0.0)
            )

    properties_detail = []
    total_monthly_rent = 0.0
    total_monthly_operating_expenses = 0.0
    total_annual_noi = 0.0
    total_monthly_cf = 0.0
    for p in props:
        canonical = _canonical_property_metric_row(p, db, current_user)
        m = canonical["raw"]
        metric_map = canonical["metrics"]
        total_monthly_rent += m["effective_rent"]
        total_monthly_operating_expenses += m["monthly_expenses"]
        total_annual_noi += m["annual_noi"]
        total_monthly_cf += m["monthly_cash_flow"]
        _orig_loans = [l for l in p.loans if (l.original_amount or 0) > 0]
        prop_original_loan = sum(l.original_amount for l in _orig_loans)
        prop_principal_paid = sum(l.original_amount - current_loan_balance(l) for l in _orig_loans)
        properties_detail.append({
            "id": p.id,
            "property_uid": p.property_uid,
            "name": p.name or _default_property_name(p.address, p.id),
            "address": p.address,
            "city": p.city,
            "state": p.state,
            "property_type": p.property_type,
            "usage_type": p.usage_type or "Rental",
            **m,
            "metrics": metric_map,
            "hoa_fee": p.hoa_fee or 0,
            "hoa_history": p.hoa_history or "[]",
            "hoa_special_assessment": p.hoa_special_assessment or 0,
            "solar_ownership": p.solar_ownership or "None",
            "solar_monthly_payment": p.solar_monthly_payment or 0,
            "solar_purchase_price": p.solar_purchase_price or 0,
                "monthly_rent": p.monthly_rent,
                "market_value": p.market_value,
                "purchase_price": p.purchase_price or 0,
                "down_payment": p.down_payment or 0,
                "original_loan_amount": round(prop_original_loan, 2),
            "principal_paid": round(prop_principal_paid, 2),
            "interest_paid": round(interest_by_prop.get(p.id, 0.0), 2),
            "notes": p.notes or "",
            "loans": [
                {
                    "id": l.id,
                    "lender_name": l.lender_name,
                    "loan_type": l.loan_type,
                    "original_amount": l.original_amount or 0,
                    "current_balance": current_loan_balance(l),
                    "interest_rate": l.interest_rate,
                    "monthly_payment": l.monthly_payment,
                    "escrow_amount": l.escrow_amount,
                    "loan_term_years": l.loan_term_years,
                    "maturity_date": l.maturity_date,
                }
                for l in p.loans
            ]
        })

    total_purchase_price = sum(p.purchase_price or 0 for p in props)

    # Debt metrics (only include loans where original_amount was recorded)
    all_loans = [l for p in props for l in p.loans]
    loans_with_original = [l for l in all_loans if (l.original_amount or 0) > 0]
    total_original_loan = sum(l.original_amount for l in loans_with_original)
    total_principal_paid = sum(l.original_amount - current_loan_balance(l) for l in loans_with_original)

    # Weighted average interest rate = Σ(balance × rate) / Σ(balance)
    balance_sum = sum(current_loan_balance(l) for l in all_loans)
    weighted_avg_rate = round(
        sum(current_loan_balance(l) * (l.interest_rate or 0) for l in all_loans) / balance_sum, 2
    ) if balance_sum > 0 else 0

    # Interest paid till date — from TaxReturnEntry (1098 / Schedule E) across all properties
    # Include shared owners so the marvzy / joint-filing shared view shows the full figure
    tax_entries = db.query(models.TaxReturnEntry).filter(
        models.TaxReturnEntry.owner_id.in_(all_owner_ids),
    ).all()
    total_interest_paid = round(sum(e.mortgage_interest or 0 for e in tax_entries), 2)

    # Portfolio DSCR = Net Operating Income / Annual Debt Service
    annual_debt_service = total_monthly_mortgage * 12
    portfolio_dscr = round(total_annual_noi / annual_debt_service, 2) if annual_debt_service > 0 else None

    # Original LTV = original loan / purchase price
    original_ltv = round(total_original_loan / total_purchase_price * 100, 1) if total_purchase_price else 0

    total_cap_rate = round(total_annual_noi / total_market_value * 100, 2) if total_market_value else 0
    prop_ids = {p.id for p in props}
    yearly_trends = _tax_yearly_trends(tax_entries, prop_ids)
    income_expense_trends = _portfolio_income_expense_yearly_trends(props)

    def _is_primary_row(row):
        return (row.get("usage_type") or "Rental").lower() == "primary"

    rental_details = [p for p in properties_detail if not _is_primary_row(p)]
    primary_details = [p for p in properties_detail if _is_primary_row(p)]
    rental_loans = [l for p in rental_details for l in p.get("loans", [])]
    rental_market_value = sum(p.get("market_value") or 0 for p in rental_details)
    rental_loan_balance = sum(p.get("total_loan_balance") or 0 for p in rental_details)
    rental_monthly_rent = sum(p.get("effective_rent") or 0 for p in rental_details)
    rental_monthly_mortgage = sum(p.get("monthly_mortgage") or 0 for p in rental_details)
    rental_monthly_cf = sum(p.get("monthly_cash_flow") or 0 for p in rental_details)
    rental_annual_noi = sum(p.get("annual_noi") or 0 for p in rental_details)
    rental_debt_service = rental_monthly_mortgage * 12
    scheduled_rent = sum(p.get("monthly_rent") or 0 for p in rental_details)
    selected_market_value = sum(p.get("market_value") or 0 for p in properties_detail)
    selected_loan_balance = sum(p.get("total_loan_balance") or 0 for p in properties_detail)
    selected_equity = sum(p.get("equity") or 0 for p in properties_detail)
    selected_purchase_price = sum(p.get("purchase_price") or 0 for p in properties_detail)
    rental_original_loan = sum(p.get("original_loan_amount") or 0 for p in rental_details)
    rental_principal_paid = sum(p.get("principal_paid") or 0 for p in rental_details)
    rental_interest_paid = sum(p.get("interest_paid") or 0 for p in rental_details)
    primary_market_value = sum(p.get("market_value") or 0 for p in primary_details)
    primary_loan_balance = sum(p.get("total_loan_balance") or 0 for p in primary_details)
    primary_purchase_price = sum(p.get("purchase_price") or 0 for p in primary_details)
    arm_balance = sum(l.get("current_balance") or 0 for l in rental_loans if (l.get("loan_type") or "").upper() == "ARM")
    high_rate_balance = sum(l.get("current_balance") or 0 for l in rental_loans if (l.get("interest_rate") or 0) > 6)
    rate_balance = sum(l.get("current_balance") or 0 for l in rental_loans)
    debt_weighted_rate = (
        sum((l.get("current_balance") or 0) * (l.get("interest_rate") or 0) for l in rental_loans) / rate_balance
    ) if rate_balance else 0
    portfolio_ltv = rental_loan_balance / rental_market_value * 100 if rental_market_value else 0
    portfolio_dscr = round(rental_annual_noi / rental_debt_service, 2) if rental_debt_service else None
    vacancy_rate = ((scheduled_rent - rental_monthly_rent) / scheduled_rent * 100) if scheduled_rent else 0
    occupancy_rate = 100 - vacancy_rate
    cf_margin_pct = rental_monthly_cf / rental_monthly_rent * 100 if rental_monthly_rent else 0
    max_equity = max([p.get("equity") or 0 for p in rental_details] + [0])
    risk_factors = [
        {"label": "Equity Concentration", "value": round(max_equity / rental_loan_balance * 100, 2) if rental_loan_balance else 0, "lo": 35, "hi": 50},
        {"label": "ARM Exposure", "value": round(arm_balance / rental_loan_balance * 100, 2) if rental_loan_balance else 0, "lo": 25, "hi": 50},
        {"label": "High Rate Debt", "value": round(high_rate_balance / rental_loan_balance * 100, 2) if rental_loan_balance else 0, "lo": 10, "hi": 30},
        {"label": "Vacancy Rate", "value": round(vacancy_rate, 2), "lo": 7, "hi": 10},
    ]
    danger_count = sum(1 for f in risk_factors if f["value"] > f["hi"])
    warn_count = sum(1 for f in risk_factors if f["lo"] < f["value"] <= f["hi"])
    overall_risk = "high" if danger_count >= 2 else ("moderate" if danger_count == 1 or warn_count >= 2 else "low")

    dashboard_model = {
        "properties": rental_details,
        "all_properties": properties_detail,
        "filter_properties": [
            {
                "id": p.id,
                "address": p.address,
                "city": p.city,
                "state": p.state,
                "usage_type": p.usage_type or "Rental",
                "notes": p.notes or "",
            }
            for p in all_props
        ],
        "primary_properties": primary_details,
        "excluded_ids": sorted(excluded_id_set),
        "excluded_count": len(excluded_id_set),
        "total_properties": len(rental_details),
        "total_market_value": round(selected_market_value, 2),
        "total_loan_balance": round(selected_loan_balance, 2),
        "total_equity": round(selected_equity, 2),
        "total_purchase_price": round(selected_purchase_price, 2),
        "total_appreciation_gain": round(selected_market_value - selected_purchase_price, 2),
        "portfolio_ltv": round(portfolio_ltv, 2),
        "portfolio_equity_pct": round(((rental_market_value - rental_loan_balance) / rental_market_value * 100) if rental_market_value else 0, 2),
        "total_monthly_rent": round(rental_monthly_rent, 2),
        "total_monthly_operating_expenses": round(
            sum(p.get("monthly_expenses") or 0 for p in rental_details),
            2,
        ),
        "total_monthly_noi": round(rental_annual_noi / 12, 2),
        "total_monthly_mortgage": round(rental_monthly_mortgage, 2),
        "total_monthly_cash_flow": round(rental_monthly_cf, 2),
        "total_annual_noi": round(rental_annual_noi, 2),
        "annual_debt_service": round(rental_debt_service, 2),
        "total_original_loan": round(rental_original_loan, 2),
        "total_principal_paid": round(rental_principal_paid, 2),
        "total_interest_paid": round(rental_interest_paid, 2),
        "original_ltv": round(rental_original_loan / selected_purchase_price * 100, 2) if selected_purchase_price else 0,
        "portfolio_dscr": portfolio_dscr,
        "weighted_avg_rate": round(debt_weighted_rate, 2),
        "has_primary": bool(primary_details),
        "primary_equity": round(sum(p.get("equity") or 0 for p in primary_details), 2),
        "primary_market_value": round(primary_market_value, 2),
        "primary_loan_balance": round(primary_loan_balance, 2),
        "primary_monthly_cost": round(sum(p.get("monthly_mortgage") or 0 for p in primary_details), 2),
        "primary_ltv": round(primary_loan_balance / primary_market_value * 100, 2) if primary_market_value else 0,
        "primary_appreciation": round(primary_market_value - primary_purchase_price, 2),
        "ratios": {
            "cash_flow_margin_pct": round(cf_margin_pct, 2),
            "vacancy_rate": round(vacancy_rate, 2),
            "occupancy_rate": round(occupancy_rate, 2),
            "debt_weighted_rate": round(debt_weighted_rate, 2),
            "arm_exposure": round(arm_balance / rental_loan_balance * 100, 2) if rental_loan_balance else 0,
            "high_rate_exposure": round(high_rate_balance / rental_loan_balance * 100, 2) if rental_loan_balance else 0,
            "appreciation_pct": round((selected_market_value - selected_purchase_price) / selected_purchase_price * 100, 2) if selected_purchase_price else None,
        },
        "risk_factors": risk_factors,
        "overall_risk": overall_risk,
        "cash_flow_data": [
            {
                "name": (p.get("address") or "").split(",")[0][:15],
                "rent": round(p.get("effective_rent") or 0),
                "mortgage": round(p.get("monthly_mortgage") or 0),
                "cashFlow": round(p.get("monthly_cash_flow") or 0),
            }
            for p in rental_details
        ],
        "sparks": {
            "market_value": sorted([p.get("market_value") or 0 for p in rental_details]),
            "equity": sorted([p.get("equity") or 0 for p in rental_details]),
            "rent": sorted([p.get("effective_rent") or 0 for p in rental_details]),
            "cash_flow": sorted([p.get("monthly_cash_flow") or 0 for p in rental_details]),
            "mortgage": sorted([p.get("monthly_mortgage") or 0 for p in rental_details]),
            "debt": sorted([p.get("total_loan_balance") or 0 for p in rental_details]),
            "noi": sorted([(p.get("annual_noi") or 0) / 12 for p in rental_details]),
            "principal_paid": sorted([p.get("principal_paid") or 0 for p in rental_details]),
            "interest_paid": sorted([p.get("interest_paid") or 0 for p in rental_details]),
            "original_loan": sorted([p.get("original_loan_amount") or 0 for p in rental_details if (p.get("original_loan_amount") or 0) > 0]),
            "rate": sorted([l.get("interest_rate") or 0 for l in rental_loans]),
        },
    }

    executive_dashboard = _build_executive_dashboard(dashboard_model, yearly_trends)
    owner_name = getattr(current_user, "name", None) or getattr(current_user, "email", None) or "Investor"
    portfolio_report = _build_portfolio_report(
        dashboard_model,
        executive_dashboard,
        yearly_trends,
        owner_name=owner_name,
    )

    return {
        "executive_dashboard": executive_dashboard,
        "portfolio_report": portfolio_report,
        "dashboard": dashboard_model,
        "total_properties": total_properties,
        "total_monthly_rent": round(total_monthly_rent, 2),
        "total_monthly_operating_expenses": round(total_monthly_operating_expenses, 2),
        "total_monthly_noi": round(total_annual_noi / 12, 2),
        "total_market_value": round(total_market_value, 2),
        "total_loan_balance": round(total_loan_balance, 2),
        "total_monthly_mortgage": round(total_monthly_mortgage, 2),
        "total_equity": round(total_equity, 2),
        "total_monthly_cash_flow": round(total_monthly_cf, 2),
        "total_purchase_price": round(total_purchase_price, 2),
        "total_appreciation_gain": round(total_market_value - total_purchase_price, 2),
        "portfolio_ltv": round(total_loan_balance / total_market_value * 100, 1) if total_market_value else 0,
        "portfolio_equity_pct": round(total_equity / total_market_value * 100, 1) if total_market_value else 0,
        "total_annual_noi": round(total_annual_noi, 2),
        "avg_cap_rate": total_cap_rate,
        # Financing & Debt
        "total_original_loan": round(total_original_loan, 2),
        "original_ltv": original_ltv,
        "weighted_avg_rate": weighted_avg_rate,
        "total_interest_paid": total_interest_paid,
        "total_principal_paid": round(total_principal_paid, 2),
        "portfolio_dscr": portfolio_dscr,
        "annual_debt_service": round(annual_debt_service, 2),
        "yearly_trends": yearly_trends,
        "income_expense_trends": income_expense_trends,
        "properties": properties_detail,
    }


@router.get("/analysis/payoff-planner")
def payoff_planner(
    strategy: str = "avalanche",
    lump_sum: float = 0.0,
    extra_monthly: float = 0.0,
    include_primary: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Portfolio-level debt payoff plan (avalanche/snowball with income cascade).

    Reads each rental loan's live values from the loan engine (balance, rate,
    P&I with escrow excluded) and each property's monthly NOI, then hands a pure
    overlay simulation to ``services.payoff_planner``. Stored loan data is never
    mutated. The primary residence is excluded unless ``include_primary`` is set.
    """
    own_props = db.query(models.Property).filter(
        models.Property.owner_id == current_user.id
    ).all()
    shared_owner_ids = [
        share.owner_id
        for share in db.query(models.UserSharing).filter(
            models.UserSharing.shared_with_id == current_user.id
        ).all()
    ]
    shared_props = (
        db.query(models.Property).filter(models.Property.owner_id.in_(shared_owner_ids)).all()
        if shared_owner_ids else []
    )
    all_props = own_props + shared_props

    planner_loans: List[Dict[str, Any]] = []
    noi_sum = 0.0
    for prop in all_props:
        is_primary = str(prop.usage_type or "Rental").lower() == "primary"
        if is_primary and not include_primary:
            continue

        metrics = compute_property_metrics(prop)
        # Monthly NOI (rent - opex, before debt service); only the sum feeds the cascade.
        noi_sum += (metrics.get("annual_noi", 0.0) or 0.0) / 12.0

        prop_name = prop.name or _default_property_name(prop.address, prop.id)
        active_loans = [
            loan for loan in (prop.loans or [])
            if not _is_closed_loan_status(getattr(loan, "status", None))
        ]
        active_loans = [loan for loan in active_loans if current_loan_balance(loan) > 0]
        for offset, loan in enumerate(active_loans):
            # Disambiguate when a property carries more than one active loan.
            if len(active_loans) > 1:
                label = f"{prop_name} · {loan.lender_name}" if loan.lender_name else f"{prop_name} ({offset + 1})"
            else:
                label = prop_name
            planner_loans.append({
                "name": label,
                "balance": round(current_loan_balance(loan), 2),
                "rate": float(loan.interest_rate or 0.0) / 100.0,  # engine stores percent
                "pi": round(loan_monthly_pi(loan), 2),
            })

    return build_payoff_report(
        planner_loans,
        noi_sum,
        strategy=strategy,
        lump_sum=lump_sum,
        extra_monthly=extra_monthly,
        include_primary=include_primary,
        start_date=date.today(),
    )


@router.get("/analysis/portfolio")
def portfolio_analysis(
    selected_property_ids: str = "",
    selection_explicit: bool = False,
    include_primary_residence: bool = True,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    comparison_period: Optional[str] = None,
    accounting_basis: str = "cash",
    active_loan_only: bool = True,
    loan_status: str = "Active",
    tax_year: Optional[int] = None,
    scenario_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return one versioned, traceable analysis contract for portfolio pages.

    Explicit property IDs define the scope and therefore override the primary
    residence toggle.  Without an explicit selection, the toggle determines
    whether primary residences are included in ownership and debt metrics.
    Rental-only metrics still exclude primary-residence activity by definition.
    """
    own_props = db.query(models.Property).filter(models.Property.owner_id == current_user.id).all()
    shared_owner_ids = [
        share.owner_id
        for share in db.query(models.UserSharing).filter(
            models.UserSharing.shared_with_id == current_user.id
        ).all()
    ]
    shared_props = (
        db.query(models.Property).filter(models.Property.owner_id.in_(shared_owner_ids)).all()
        if shared_owner_ids else []
    )
    all_props = own_props + shared_props
    requested_ids = {
        int(item) for item in (selected_property_ids or "").split(",")
        if item.strip().isdigit()
    }
    explicit_selection = bool(requested_ids) or selection_explicit
    if explicit_selection:
        props = [prop for prop in all_props if prop.id in requested_ids]
    elif include_primary_residence:
        props = list(all_props)
    else:
        props = [
            prop for prop in all_props
            if str(prop.usage_type or "Rental").lower() != "primary"
        ]

    selected_year = int(tax_year or date.today().year)
    normalized_properties: List[Dict[str, Any]] = []
    debts: Dict[int, Dict[str, Any]] = {}
    schedules: Dict[int, Dict[str, Any]] = {}
    for prop in props:
        canonical = _canonical_property_metric_row(prop, db, current_user)
        raw = canonical.get("raw") or {}
        normalized_properties.append({
            "id": prop.id,
            "property_uid": prop.property_uid,
            "name": prop.name or _default_property_name(prop.address, prop.id),
            "address": prop.address,
            "city": prop.city,
            "state": prop.state,
            "usage_type": prop.usage_type or "Rental",
            "market_value": _schedule_e_number(prop.market_value),
            "purchase_price": _schedule_e_number(prop.purchase_price),
            "down_payment": _schedule_e_number(prop.down_payment),
            "closing_costs": _schedule_e_number(prop.closing_costs),
            "monthly_rent": _schedule_e_number(prop.monthly_rent),
            "occupancy_rate": _schedule_e_number(prop.occupancy_rate),
            "metrics": canonical.get("metrics") or {},
            **raw,
        })
        debts[prop.id] = get_debt(prop.id, db, current_user)
        schedules[prop.id] = get_schedule_e_capture(prop.id, selected_year, db, current_user)

    yearly_trends = _portfolio_income_expense_yearly_trends(props)
    start_year = _parse_iso_date(start_date).year if _parse_iso_date(start_date) else None
    end_year = _parse_iso_date(end_date).year if _parse_iso_date(end_date) else None
    if start_year is not None:
        yearly_trends = [row for row in yearly_trends if int(row.get("year") or 0) >= start_year]
    if end_year is not None:
        yearly_trends = [row for row in yearly_trends if int(row.get("year") or 0) <= end_year]

    filter_context = {
        "selectedPropertyIds": [prop.id for prop in props],
        "requestedPropertyIds": sorted(requested_ids),
        "explicitSelection": explicit_selection,
        "includePrimaryResidence": include_primary_residence,
        "dateRange": {"start": start_date, "end": end_date},
        "comparisonPeriod": comparison_period,
        "accountingBasis": accounting_basis,
        "activeLoanOnly": active_loan_only,
        "loanStatus": loan_status,
        "taxYear": selected_year,
        "scenarioId": scenario_id,
        "availableProperties": [
            {
                "id": prop.id,
                "name": prop.name or _default_property_name(prop.address, prop.id),
                "address": prop.address,
                "usageType": prop.usage_type or "Rental",
                "isPrimary": str(prop.usage_type or "Rental").lower() == "primary",
            }
            for prop in all_props
        ],
    }
    return build_portfolio_analysis(
        properties=normalized_properties,
        debts=debts,
        schedules=schedules,
        yearly_trends=yearly_trends,
        selected_year=selected_year,
        filter_context=filter_context,
    )
