import json
import uuid
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date, datetime
import models
from database import get_db
from routers.auth import get_current_user
from services.loan_calculator import (
    amortization_schedule, payoff_analysis, arm_schedule,
    depreciation_schedule, monthly_payment
)
from services.property_valuation import get_property_value
from services.checklist import build_checklist

router = APIRouter(prefix="/api/properties", tags=["properties"])

PROPERTY_CODE_NAMES = [
    "Palermo", "Electra", "Syrah", "Valencia", "Meridian", "Solara",
    "Cypress", "Juniper", "Sierra", "Atlas", "Nova", "Laurel",
    "Haven", "Orion", "Saffron", "Monaco",
]


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoanBase(BaseModel):
    lender_name: Optional[str] = None
    loan_product: Optional[str] = None
    loan_type: str = "FIXED"
    original_amount: float
    current_balance: float
    interest_rate: float
    rate_note: Optional[str] = None
    monthly_payment: float
    estimated_total_monthly_payment: float = 0.0
    loan_term_years: int
    origination_date: Optional[str] = None
    maturity_date: Optional[str] = None
    original_ltv: float = 0.0
    escrow_amount: float = 0.0
    escrow_included: bool = False
    down_payment: float = 0.0
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


class LoanOut(LoanBase):
    id: int
    property_id: int

    class Config:
        from_attributes = True


class PropertyBase(BaseModel):
    name: Optional[str] = None
    address: str
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    property_type: str = "Single Family"
    usage_type: str = "Rental"  # Rental | Primary
    original_residency_status: Optional[str] = None
    current_residency_status: Optional[str] = None
    primary_start_date: Optional[str] = None
    primary_end_date: Optional[str] = None
    rental_start_date: Optional[str] = None
    rental_end_date: Optional[str] = None
    recorded_date: Optional[str] = None
    held_period: Optional[str] = None
    purchase_date: Optional[str] = None
    purchase_price: float = 0.0
    settlement_total_amount: float = 0.0
    closing_costs: float = 0.0
    monthly_rent: float = 0.0
    occupancy_rate: float = 100.0
    property_tax: float = 0.0
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
    market_value_source: str = "manual"


class PropertyCreate(PropertyBase):
    loans: Optional[List[LoanBase]] = []


class PropertyOut(PropertyBase):
    id: int
    property_uid: str
    owner_id: int
    usage_type_locked: bool = False
    loans: List[LoanOut] = []
    market_value_updated: Optional[str] = None

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
    usage_type: str
    monthly_rent: float
    market_value: float
    total_loan_balance: float
    monthly_mortgage: float
    monthly_cash_flow: float
    equity: float
    shared_by_name: Optional[str] = None
    shared_by_email: Optional[str] = None


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

def _depreciable_basis(prop) -> float:
    construction_price = getattr(prop, "construction_price", 0) or 0
    if construction_price > 0:
        return construction_price
    return (getattr(prop, "purchase_price", 0) or 0) * 0.75


def compute_property_metrics(prop: models.Property) -> dict:
    total_loan_balance = sum(l.current_balance for l in prop.loans)

    # monthly_payment on the loan stores the full PITI payment from the statement.
    # escrow_amount is the taxes+insurance portion bundled into that payment.
    # We separate them so the dashboard shows:
    #   Mortgage P&I  = payment – escrow   (debt service only)
    #   Operating Exp = property_tax + insurance + HOA + maintenance + …
    monthly_piti   = sum(l.monthly_payment for l in prop.loans)
    monthly_escrow = sum(l.escrow_amount   for l in prop.loans)
    # P&I only (never negative — covers the case where escrow wasn't populated)
    monthly_mortgage = max(monthly_piti - monthly_escrow, 0)

    is_primary    = (prop.usage_type or "Rental").lower() == "primary"
    effective_rent = 0.0 if is_primary else prop.monthly_rent * (prop.occupancy_rate / 100)

    # Full operating expenses — taxes, insurance, HOA, maintenance, etc.
    # Property tax and insurance are annual fields prorated into monthly expenses.
    # If lender escrow is higher, count only missing escrow to avoid double-counting.
    property_tax_monthly = (prop.property_tax or 0) / 12
    insurance_monthly = (prop.insurance or 0) / 12
    escrow_expense = max(monthly_escrow - property_tax_monthly - insurance_monthly, 0)
    tax_ins_monthly = property_tax_monthly + insurance_monthly + escrow_expense
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
    monthly_expenses  = tax_ins_monthly + other_operating
    monthly_cash_flow = effective_rent - monthly_mortgage - monthly_expenses

    equity             = prop.market_value - total_loan_balance
    depreciable        = _depreciable_basis(prop)
    annual_depreciation = depreciable / prop.depreciation_years if prop.depreciation_years else 0

    # NOI = Gross Rent − Operating Expenses (no debt service)
    annual_noi = (effective_rent - monthly_expenses) * 12

    return {
        "total_loan_balance":    round(total_loan_balance, 2),
        "monthly_piti":          round(monthly_piti, 2),
        "monthly_escrow":        round(monthly_escrow, 2),
        "monthly_mortgage":      round(monthly_mortgage, 2),   # P&I only
        "property_tax_monthly":  round(property_tax_monthly, 2),
        "insurance_monthly":     round(insurance_monthly, 2),
        "escrow_expense":        round(escrow_expense, 2),
        "tax_ins_monthly":       round(tax_ins_monthly, 2),
        "solar_monthly":         round(solar_monthly, 2),
        "monthly_expenses":      round(monthly_expenses, 2),
        "effective_rent":        round(effective_rent, 2),
        "monthly_cash_flow":     round(monthly_cash_flow, 2),
        "annual_cash_flow":      round(monthly_cash_flow * 12, 2),
        "equity":                round(equity, 2),
        "annual_depreciation":   round(annual_depreciation, 2),
        "monthly_depreciation":  round(annual_depreciation / 12, 2),
        "annual_noi":            round(annual_noi, 2),
        "cap_rate":  round(annual_noi / prop.market_value * 100, 2) if prop.market_value else 0,
        "gross_yield": round((effective_rent * 12) / prop.market_value * 100, 2) if prop.market_value else 0,
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


def _mid_month_depreciation_for_year(
    basis: float,
    placed_in_service: Optional[str],
    recovery_period: float,
    tax_year: int,
) -> float:
    if basis <= 0 or recovery_period <= 0:
        return 0.0
    placed = _parse_iso_date(placed_in_service) or date(tax_year, 1, 1)
    total_months = recovery_period * 12
    start = placed.year * 12 + (placed.month - 1) + 0.5
    end = start + total_months
    year_start = tax_year * 12
    year_end = year_start + 12
    months = max(0.0, min(end, year_end) - max(start, year_start))
    return round((basis / total_months) * months, 2)


def _fully_depreciated_date(placed_in_service: Optional[str], recovery_period: float) -> Optional[str]:
    placed = _parse_iso_date(placed_in_service)
    if not placed or recovery_period <= 0:
        return None
    return _add_months(placed, int(round(recovery_period * 12))).isoformat()


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


def _serialize_depreciation_asset(asset, prop, tax_year: int, is_base_building: bool = False) -> Dict[str, Any]:
    basis = max((asset.get("cost_basis") or 0.0) - (asset.get("land_portion") or 0.0), 0.0)
    recovery_period = asset.get("recovery_period") or 27.5
    annual = round(basis / recovery_period, 2) if recovery_period else 0.0
    current = _mid_month_depreciation_for_year(
        basis,
        asset.get("placed_in_service_date"),
        recovery_period,
        tax_year,
    )
    prior = asset.get("prior_depreciation") or 0.0
    accumulated = round(prior + sum(
        _mid_month_depreciation_for_year(
            basis,
            asset.get("placed_in_service_date"),
            recovery_period,
            year,
        )
        for year in range((_parse_iso_date(asset.get("placed_in_service_date")) or date(tax_year, 1, 1)).year, tax_year + 1)
    ), 2)
    remaining = round(max(basis - accumulated, 0.0), 2)
    return {
        **asset,
        "depreciable_basis": round(basis, 2),
        "annual_depreciation": annual,
        "current_year_depreciation": current,
        "accumulated_depreciation": min(accumulated, round(basis, 2)),
        "remaining_basis": remaining,
        "fully_depreciated_date": _fully_depreciated_date(asset.get("placed_in_service_date"), recovery_period),
        "is_base_building": is_base_building,
        "warning": _asset_warning(asset.get("asset_type", "depreciation"), asset.get("description", ""), prop.property_type),
    }


def _depreciation_schedule_payload(prop, tax_year: Optional[int] = None) -> Dict[str, Any]:
    tax_year = tax_year or date.today().year
    base_basis = _depreciable_basis(prop)
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
        }, prop, tax_year, True))

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
        }, prop, tax_year, False))

    filed = next((e.depreciation for e in prop.tax_entries if e.tax_year == tax_year and e.property_kind == "rental"), None)
    model_total = round(sum(a["current_year_depreciation"] for a in assets if a["asset_type"] == "depreciation"), 2)
    amortization_total = round(sum(a["current_year_depreciation"] for a in assets if a["asset_type"] == "amortization"), 2)
    delta = None if filed is None else round(model_total - (filed or 0.0), 2)

    start_years = [
        (_parse_iso_date(a.get("placed_in_service_date")) or date(tax_year, 1, 1)).year
        for a in assets
    ]
    end_year = max([tax_year] + [
        (_parse_iso_date(a.get("fully_depreciated_date")) or date(tax_year, 1, 1)).year
        for a in assets
    ])
    start_year = min(start_years + [tax_year])
    timeline = []
    for year in range(start_year, min(end_year, start_year + 40) + 1):
        row = {"year": year, "total": 0.0}
        for asset in assets:
            value = _mid_month_depreciation_for_year(
                asset["depreciable_basis"],
                asset.get("placed_in_service_date"),
                asset.get("recovery_period") or 27.5,
                year,
            )
            row[asset["description"]] = value
            row["total"] = round(row["total"] + value, 2)
        timeline.append(row)

    common_causes = []
    if delta not in (None, 0):
        common_causes = [
            "Mid-month convention first/last year proration",
            "Missing capital improvement asset",
            "Land/building split differs from filed return",
        ]

    return {
        "tax_year": tax_year,
        "assets": assets,
        "timeline": timeline,
        "rollup": {
            "total_annual_depreciation": round(sum(a["annual_depreciation"] for a in assets if a["asset_type"] == "depreciation"), 2),
            "total_current_year_depreciation": model_total,
            "total_accumulated_depreciation": round(sum(a["accumulated_depreciation"] for a in assets if a["asset_type"] == "depreciation"), 2),
            "total_remaining_basis": round(sum(a["remaining_basis"] for a in assets if a["asset_type"] == "depreciation"), 2),
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
        m = compute_property_metrics(p)
        return PropertySummary(
            id=p.id,
            property_uid=p.property_uid,
            name=p.name or _default_property_name(p.address, p.id),
            address=p.address,
            city=p.city,
            state=p.state,
            property_type=p.property_type,
            usage_type=p.usage_type or "Rental",
            monthly_rent=0 if (p.usage_type or "").lower() == "primary" else p.monthly_rent,
            market_value=p.market_value,
            total_loan_balance=m["total_loan_balance"],
            monthly_mortgage=m["monthly_mortgage"],
            monthly_cash_flow=m["monthly_cash_flow"],
            equity=m["equity"],
            shared_by_name=shared_by_user.name if shared_by_user else None,
            shared_by_email=shared_by_user.email if shared_by_user else None,
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
    data = prop_in.model_dump(exclude={"loans"})
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

    db.commit()
    db.refresh(prop)
    return prop


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


@router.get("/{prop_id}", response_model=PropertyOut)
def get_property(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_accessible_property(prop_id, db, current_user)


@router.put("/{prop_id}", response_model=PropertyOut)
def update_property(
    prop_id: int,
    prop_in: PropertyBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(
        models.Property.id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    data = prop_in.model_dump()
    data["name"] = data.get("name") or _default_property_name(data.get("address"), prop.id)
    if data.get("usage_type") != prop.usage_type:
        prop.usage_type_locked = True
    for k, v in data.items():
        setattr(prop, k, v)
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


def _parse_statement_date(s: str):
    for f in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m/%Y"):
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
    tax_1098_entries = {}
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
                "principal": data.get("principal_due"),
                "interest": data.get("interest_due"),
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
        # Collect tax data. 1098 real-estate taxes are preferred over
        # property-tax documents for the same year; do not count both.
        tax_val = data.get("property_tax_amount") or data.get("taxes_paid")
        if tax_val:
            if d.doc_category == "mortgage_statement":
                # Monthly amount -> annualize
                annual_tax = round(tax_val * 12, 2)
            elif d.doc_category == "1098":
                # Annual amount. Key by account so transfer-year 1098s from
                # different servicers can both contribute, while duplicate
                # uploads for the same account collapse.
                annual_tax = round(tax_val, 2)
                acct = d.loan_account_number or data.get("account_number")
                tax_1098_entries.setdefault(year, []).append((acct, annual_tax))
                continue
            else:
                # Already annual (tax bill, tax return, 1098, 1099, etc.)
                annual_tax = round(tax_val, 2)
            tax_fallback_by_year[year] = max(tax_fallback_by_year.get(year, 0), annual_tax)
    snapshots.sort(key=lambda s: s["date"])
    tax_1098_by_year = {
        y: _dedup_interest(entries) for y, entries in tax_1098_entries.items()
    }
    tax_by_year = {
        **tax_fallback_by_year,
        **tax_1098_by_year,
    }
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


def _statement_end_month_for_year(snapshots: list, year: int) -> int:
    dates = [
        _parse_statement_date(s.get("date"))
        for s in snapshots
        if s.get("year") == year and s.get("date")
    ]
    dates = [d for d in dates if d]
    return max((d.month for d in dates), default=12)


def _rental_income_by_year(prop: models.Property) -> dict:
    """Per-year rental income & occupancy from the property's RentalPeriod
    rows. An open-ended period runs through the current month; future months
    are never counted. Returns {year: {income, occupied_months,
    months_elapsed, occupancy}}."""
    now = datetime.now()
    result = {}
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
            yr = result.setdefault(y, {"income": 0.0, "occupied_months": 0})
            yr["income"] += rp.monthly_rent or 0
            yr["occupied_months"] += 1
            m += 1
            if m > 12:
                m, y = 1, y + 1
    for y, d in result.items():
        months_elapsed = now.month if y == now.year else 12
        d["months_elapsed"] = months_elapsed
        d["income"] = round(d["income"], 2)
        d["occupancy"] = round(
            min(d["occupied_months"] / months_elapsed * 100, 100), 1
        ) if months_elapsed else 0
    return result


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
        else:
            interest_paid = round(sum(l.interest_due or 0 for l in prop.loans) * months_owned, 2)

        if year in interest_by_year:
            interest_paid = interest_by_year[year]
            if source != "actual":
                source = "1098"
        elif year in tax_return_interest_by_year:
            interest_paid = tax_return_interest_by_year[year]
            source = "tax_return"

        # Use actual taxes: document extracts first, then filed tax return, then static field.
        year_tax = tax_by_year.get(year) or _prop_tax_by_year.get(year)
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
            year_rent = rinfo["income"]
            occupied_months = rinfo["occupied_months"]
            occupancy = rinfo["occupancy"]
            rent_source = "leases"
        else:
            year_rent = 0.0
            occupied_months = None
            occupancy = None
            rent_source = "none"

        # Depreciation: Schedule E filed value (highest trust) > days-rented proration
        # > IRS mid-month purchase-year convention > full-year straight-line.
        # "days_rented" from Schedule E lines 2/3 handles mixed-use years
        # (e.g. 6 months primary + 6 months rental) automatically.
        _days_rented = days_rented_by_year.get(year)
        if tax_return_depr_by_year.get(year):
            year_depreciation = tax_return_depr_by_year[year]
        elif _days_rented:
            # IRS: depreciation is only allowed on the rental portion of the year.
            # For a calendar year (365 or 366 days) use the actual days rented.
            import calendar as _cal
            year_days = 366 if _cal.isleap(year) else 365
            year_depreciation = round(annual_depreciation * _days_rented / year_days, 2)
        elif purchase_year and year == purchase_year and prop.purchase_date:
            # IRS mid-month convention: residential rental placed in service in
            # month M → available months = (12 - M + 0.5)
            try:
                _pd = datetime.strptime(prop.purchase_date[:10], '%Y-%m-%d')
                _months = 12 - _pd.month + 0.5
                year_depreciation = annual_depreciation * _months / 12
            except Exception:
                year_depreciation = annual_depreciation
        else:
            year_depreciation = annual_depreciation

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
            f"Negative cash flow of ${abs(latest['cash_flow']):,.0f}/yr — rent doesn't cover the mortgage and expenses."})
    if latest and latest["taxable_income"] < 0 and annual_rent > 0:
        signals.append({"level": "good", "text":
            f"Paper loss of ${abs(latest['taxable_income']):,.0f}/yr (interest + depreciation) may offset other income at tax time."})
    if latest and latest["principal_paid"] > 0:
        signals.append({"level": "good", "text":
            f"Building ${latest['principal_paid']:,.0f}/yr in equity through principal paydown."})
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
    data_years = ({s["year"] for s in snapshots} | set(tax_by_year)
                  | set(interest_by_year) | set(rental_by_year)
                  | set(balance_by_year) | set(tax_return_rent_by_year)
                  | set(tax_return_depr_by_year))

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

    current_year = datetime.now().year
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
        else:
            interest_paid = round(sum(l.interest_due or 0 for l in prop.loans) * months_owned, 2)

        # Form 1098 reports exact annual interest — prefer it over estimates
        if year in interest_by_year:
            interest_paid = interest_by_year[year]
            if source != "actual":
                source = "1098"
        elif year in tax_return_interest_by_year:
            interest_paid = tax_return_interest_by_year[year]
            source = "tax_return"

        # Use actual taxes: document extracts first, then filed tax return, then static field.
        year_tax = tax_by_year.get(year) or _prop_tax_by_year.get(year)
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
            year_rent = rinfo["income"]
            occupied_months = rinfo["occupied_months"]
            occupancy = rinfo["occupancy"]
            rent_source = "leases"
        else:
            year_rent = 0.0
            occupied_months = None
            occupancy = None
            rent_source = "none"

        # Depreciation: tax return (Schedule E line 18) > IRS mid-month calculation
        if tax_return_depr_by_year.get(year):
            year_depreciation = tax_return_depr_by_year[year]
        elif purchase_year and year == purchase_year and prop.purchase_date:
            try:
                _pd = datetime.strptime(prop.purchase_date[:10], '%Y-%m-%d')
                _months = 12 - _pd.month + 0.5
                year_depreciation = annual_depreciation * _months / 12
            except Exception:
                year_depreciation = annual_depreciation
        else:
            year_depreciation = annual_depreciation

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
            "depreciation": round(year_depreciation, 2),
            "cash_flow": cash_flow,
            "taxable_income": taxable_income,
            "source": source,
            "statements": len(ss),
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
    _current_bal   = round(metrics["total_loan_balance"], 2)
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

    lifetime = {
        "years_owned": years_owned,
        "purchase_year": purchase_year,
        "years_filled": len(yearly_details),
        "total_rental_income": round(sum(y["rental_income"] for y in yearly_details), 2),
        "total_operating_expenses": round(sum(y["operating_expenses"] for y in yearly_details), 2),
        "total_interest_paid": round(sum(y["interest_paid"] for y in yearly_details), 2),
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

    return {"lifetime": lifetime, "yearly": yearly_details}


@router.get("/{prop_id}/rawdata")
def get_raw_data(
    prop_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return every raw data point we hold for a property, grouped by source,
    so the frontend can render a side-by-side cross-verification view.

    Sources:
      tax_entries  — TaxReturnEntry rows extracted from uploaded Schedule E
      docs_1098    — exact mortgage interest from Form 1098 (per year, per account)
      docs_balance — outstanding principal at Jan-1 from Form 1098 Box 2
      stmt_annual  — annualised figures from monthly mortgage statements
      tax_docs     — property-tax amounts extracted from any uploaded document
      lease_rent   — income / occupancy derived from entered RentalPeriod records
      snapshots    — every raw statement row (date, balance, interest, principal)
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
    deduped_tax_entries = {}
    for entry in tax_entries:
        key = (
            entry.property_id,
            entry.tax_year,
            entry.property_kind or "",
            (entry.address or "").strip().lower(),
        )
        deduped_tax_entries[key] = entry
    tax_entries = sorted(
        deduped_tax_entries.values(),
        key=lambda entry: (entry.tax_year or 0, entry.id or 0),
    )

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

    return {
        "tax_entries": [
            {
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
                "current_balance": l.current_balance,
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
    rental = db.query(models.RentalPeriod).join(models.Property).filter(
        models.RentalPeriod.id == rental_id,
        models.RentalPeriod.property_id == prop_id,
        models.Property.owner_id == current_user.id,
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
    rental = db.query(models.RentalPeriod).join(models.Property).filter(
        models.RentalPeriod.id == rental_id,
        models.RentalPeriod.property_id == prop_id,
        models.Property.owner_id == current_user.id,
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

@router.post("/{prop_id}/loans", response_model=LoanOut)
def add_loan(
    prop_id: int,
    loan_in: LoanBase,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    prop = db.query(models.Property).filter(
        models.Property.id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    loan = models.Loan(property_id=prop_id, **loan_in.model_dump())
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
    loan = db.query(models.Loan).join(models.Property).filter(
        models.Loan.id == loan_id,
        models.Loan.property_id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    for k, v in loan_in.model_dump().items():
        setattr(loan, k, v)
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
    loan = db.query(models.Loan).join(models.Property).filter(
        models.Loan.id == loan_id,
        models.Loan.property_id == prop_id,
        models.Property.owner_id == current_user.id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()
    return {"ok": True}


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

    schedule = amortization_schedule(
        loan.current_balance, loan.interest_rate,
        loan.loan_term_years, extra_monthly
    )
    analysis = payoff_analysis(
        loan.current_balance, loan.interest_rate,
        loan.loan_term_years, extra_monthly
    )
    return {"schedule": schedule, "analysis": analysis}


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


# ── Dashboard ─────────────────────────────────────────────────────────────────

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
        sum(l.current_balance for l in p.loans) for p in props
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
    total_annual_noi = 0.0
    total_monthly_cf = 0.0
    for p in props:
        m = compute_property_metrics(p)
        total_monthly_rent += m["effective_rent"]
        total_annual_noi += m["annual_noi"]
        total_monthly_cf += m["monthly_cash_flow"]
        _orig_loans = [l for l in p.loans if (l.original_amount or 0) > 0]
        prop_original_loan = sum(l.original_amount for l in _orig_loans)
        prop_principal_paid = sum(l.original_amount - (l.current_balance or 0) for l in _orig_loans)
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
            "hoa_fee": p.hoa_fee or 0,
            "hoa_history": p.hoa_history or "[]",
            "hoa_special_assessment": p.hoa_special_assessment or 0,
            "solar_ownership": p.solar_ownership or "None",
            "solar_monthly_payment": p.solar_monthly_payment or 0,
            "solar_purchase_price": p.solar_purchase_price or 0,
            "monthly_rent": p.monthly_rent,
            "market_value": p.market_value,
            "purchase_price": p.purchase_price or 0,
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
                    "current_balance": l.current_balance,
                    "interest_rate": l.interest_rate,
                    "monthly_payment": l.monthly_payment,
                    "escrow_amount": l.escrow_amount,
                    "loan_term_years": l.loan_term_years,
                    "maturity_date": l.maturity_date,
                    "down_payment": l.down_payment or 0,
                }
                for l in p.loans
            ]
        })

    total_purchase_price = sum(p.purchase_price or 0 for p in props)

    # Debt metrics (only include loans where original_amount was recorded)
    all_loans = [l for p in props for l in p.loans]
    loans_with_original = [l for l in all_loans if (l.original_amount or 0) > 0]
    total_original_loan = sum(l.original_amount for l in loans_with_original)
    total_principal_paid = sum(l.original_amount - (l.current_balance or 0) for l in loans_with_original)

    # Weighted average interest rate = Σ(balance × rate) / Σ(balance)
    balance_sum = sum(l.current_balance or 0 for l in all_loans)
    weighted_avg_rate = round(
        sum((l.current_balance or 0) * (l.interest_rate or 0) for l in all_loans) / balance_sum, 2
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
    yearly_trends_by_year: dict[int, dict] = {}
    for entry in tax_entries:
        if entry.property_id not in prop_ids:
            continue
        row = yearly_trends_by_year.setdefault(entry.tax_year, {
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
    yearly_trends = []
    for row in sorted(yearly_trends_by_year.values(), key=lambda r: r["year"]):
        yearly_trends.append({
            **row,
            "rental_income": round(row["rental_income"], 2),
            "mortgage_interest": round(row["mortgage_interest"], 2),
            "property_taxes": round(row["property_taxes"], 2),
            "operating_expenses": round(row["operating_expenses"], 2),
            "depreciation": round(row["depreciation"], 2),
            "net_income": round(row["net_income"], 2),
        })

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

    return {
        "dashboard": dashboard_model,
        "total_properties": total_properties,
        "total_monthly_rent": round(total_monthly_rent, 2),
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
        "properties": properties_detail,
    }
