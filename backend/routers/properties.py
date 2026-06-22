import json
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
import models
from database import get_db
from routers.auth import get_current_user
from services.loan_calculator import (
    amortization_schedule, payoff_analysis, arm_schedule,
    depreciation_schedule, monthly_payment
)
from services.property_valuation import get_property_value

router = APIRouter(prefix="/api/properties", tags=["properties"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoanBase(BaseModel):
    lender_name: Optional[str] = None
    loan_type: str = "FIXED"
    original_amount: float
    current_balance: float
    interest_rate: float
    rate_note: Optional[str] = None
    monthly_payment: float
    loan_term_years: int
    origination_date: Optional[str] = None
    maturity_date: Optional[str] = None
    escrow_amount: float = 0.0
    down_payment: float = 0.0
    account_number: Optional[str] = None
    borrowers: Optional[str] = None
    principal_due: Optional[float] = None
    interest_due: Optional[float] = None
    statement_date: Optional[str] = None
    payment_due_date: Optional[str] = None
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
    address: str
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    property_type: str = "Single Family"
    usage_type: str = "Rental"  # Rental | Primary
    purchase_date: Optional[str] = None
    purchase_price: float = 0.0
    monthly_rent: float = 0.0
    occupancy_rate: float = 100.0
    property_tax: float = 0.0
    insurance: float = 0.0
    hoa_fee: float = 0.0
    maintenance: float = 0.0
    property_management_fee: float = 0.0
    utilities: float = 0.0
    vacancy_allowance: float = 0.0
    capex_reserve: float = 0.0
    other_expenses: float = 0.0
    land_value: float = 0.0
    depreciation_years: float = 27.5
    market_value: float = 0.0
    market_value_source: str = "manual"


class PropertyCreate(PropertyBase):
    loans: Optional[List[LoanBase]] = []


class PropertyOut(PropertyBase):
    id: int
    owner_id: int
    loans: List[LoanOut] = []
    market_value_updated: Optional[str] = None

    class Config:
        from_attributes = True


class PropertySummary(BaseModel):
    id: int
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
    tax_year: int
    address: Optional[str]
    property_kind: str
    rents_received: float
    mortgage_interest: float
    property_taxes: float
    depreciation: float
    total_expenses: float
    net_income: float

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
    # Escrow is NOT a separate line; it is accounted for via property_tax + insurance.
    tax_ins_monthly = prop.property_tax / 12 + prop.insurance / 12
    other_operating = (
        prop.hoa_fee + prop.maintenance +
        prop.property_management_fee + prop.utilities +
        prop.vacancy_allowance + prop.capex_reserve +
        prop.other_expenses
    )
    monthly_expenses  = tax_ins_monthly + other_operating
    monthly_cash_flow = effective_rent - monthly_mortgage - monthly_expenses

    equity             = prop.market_value - total_loan_balance
    depreciable        = prop.purchase_price - prop.land_value
    annual_depreciation = depreciable / prop.depreciation_years if prop.depreciation_years else 0

    # NOI = Gross Rent − Operating Expenses (no debt service)
    annual_noi = (effective_rent - monthly_expenses) * 12

    return {
        "total_loan_balance":    round(total_loan_balance, 2),
        "monthly_piti":          round(monthly_piti, 2),
        "monthly_escrow":        round(monthly_escrow, 2),
        "monthly_mortgage":      round(monthly_mortgage, 2),   # P&I only
        "tax_ins_monthly":       round(tax_ins_monthly, 2),
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
    prop = models.Property(
        owner_id=current_user.id,
        **prop_in.model_dump(exclude={"loans"})
    )
    db.add(prop)
    db.flush()

    for loan_data in (prop_in.loans or []):
        loan = models.Loan(property_id=prop.id, **loan_data.model_dump())
        db.add(loan)

    db.commit()
    db.refresh(prop)
    return prop


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
    for k, v in prop_in.model_dump().items():
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
    for f in ("%m/%d/%Y", "%m/%d/%y", "%m/%Y"):
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
    tax_by_year = {}
    interest_entries = {}  # year -> list of (account_or_None, interest)
    balance_entries = {}   # year -> list of (account_or_None, balance)
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
                    (acct, round(data["current_balance"], 2)))
        # Collect tax data from any document type
        tax_val = data.get("property_tax_amount") or data.get("taxes_paid")
        if tax_val:
            if d.doc_category == "mortgage_statement":
                # Monthly amount -> annualize
                annual_tax = round(tax_val * 12, 2)
            else:
                # Already annual (tax bill, tax return, 1098, 1099, etc.)
                annual_tax = round(tax_val, 2)
            tax_by_year[year] = max(tax_by_year.get(year, 0), annual_tax)
    snapshots.sort(key=lambda s: s["date"])
    interest_by_year = {
        y: _dedup_interest(entries) for y, entries in interest_entries.items()
    }
    balance_by_year = {
        y: _dedup_interest(entries) for y, entries in balance_entries.items()
    }
    return snapshots, tax_by_year, interest_by_year, balance_by_year


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


def _principal_from_1098(balance_by_year: dict, year: int) -> Optional[float]:
    """Compute principal paid DURING `year` from 1098 Box 2 balances.

    1098 Box 2 is the outstanding principal as of Jan 1 of the reporting year.
    Principal paid during year Y  =  balance_on_Jan1_Y  −  balance_on_Jan1_(Y+1).
    We need BOTH this year's and next year's 1098 to compute the delta.
    Returns None when either boundary is missing.
    """
    curr = balance_by_year.get(year)
    nxt = balance_by_year.get(year + 1)
    if curr is None or nxt is None:
        return None
    return round(curr - nxt, 2)


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
                    "depreciation", "total_expenses", "net_income")


def import_tax_return(db: Session, owner_id: int, document_id, filepath: str) -> int:
    """Parse a 1040 return and upsert per-property tax entries (Schedule E
    rentals + Schedule A primary). Matches each address to a managed property;
    unmatched addresses are kept with property_id=None for comparison. Stores
    no SSNs or names. Returns the number of entries imported."""
    from services.document_parser import parse_tax_return_properties

    parsed = parse_tax_return_properties(filepath)
    year = parsed.get("tax_year")
    if not year:
        return 0

    props = db.query(models.Property).filter(
        models.Property.owner_id == owner_id).all()
    primary_prop = next(
        (p for p in props if (p.usage_type or "").lower() == "primary"), None)

    count = 0
    for entry in parsed.get("properties", []):
        kind = entry.get("property_kind", "rental")
        if kind == "primary":
            matched = primary_prop
            address = matched.address if matched else "Primary Residence"
        else:
            matched = _match_property(entry.get("address"), props)
            address = entry.get("address")

        existing = db.query(models.TaxReturnEntry).filter_by(
            owner_id=owner_id, tax_year=year,
            property_kind=kind, address=address).first()
        rec = existing or models.TaxReturnEntry(
            owner_id=owner_id, tax_year=year,
            property_kind=kind, address=address)
        rec.property_id = matched.id if matched else None
        rec.document_id = document_id
        for f in TAX_ENTRY_FIELDS:
            setattr(rec, f, entry.get(f, 0.0) or 0.0)
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
    snapshots, tax_by_year, interest_by_year, balance_by_year = _collect_doc_history(prop)
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
    if prop.purchase_date:
        m = re.search(r'(?:19|20)\d{2}', prop.purchase_date)
        if m:
            purchase_year = int(m.group(0))
    if purchase_year:
        year_set = {y for y in year_set if y >= purchase_year}

    yearly = []
    for year in sorted(year_set):
        ss = [s for s in snapshots if s["year"] == year]
        # Principal: prefer 1098 balance delta (most accurate), then
        # mortgage-statement balance delta, then annualized, then estimated
        p1098 = _principal_from_1098(balance_by_year, year)
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
            principal_paid = round((ss[-1]["principal"] or 0) * 12, 2)
            source = "annualized"
        else:
            principal_paid = round(sum(l.principal_due or 0 for l in prop.loans) * 12, 2)
            source = "estimated"

        # Interest: always from 1098 when available
        if ss and not p1098:
            # Annualized interest from mortgage statement snapshots
            interest_paid = round(sum(s["interest"] or 0 for s in ss) / len(ss) * 12, 2)
            if source == "estimated":
                source = "annualized"
        elif ss:
            interest_paid = round(sum(s["interest"] or 0 for s in ss) / len(ss) * 12, 2)
        else:
            interest_paid = round(sum(l.interest_due or 0 for l in prop.loans) * 12, 2)

        if year in interest_by_year:
            interest_paid = interest_by_year[year]
            if source != "actual":
                source = "1098"

        # Use actual taxes from documents for this year when available; this
        # also feeds operating expenses so each year reflects its own data
        # instead of repeating the property's static estimate.
        year_tax = tax_by_year.get(year)
        op_property_tax = year_tax if year_tax is not None else prop.property_tax
        operating_expenses = round(annual_other_op + prop.insurance + op_property_tax, 2)
        taxes_paid = round(year_tax if year_tax is not None else prop.property_tax, 2)

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

        # Depreciation: tax return (Schedule E line 18) > IRS mid-month calculation
        if tax_return_depr_by_year.get(year):
            year_depreciation = tax_return_depr_by_year[year]
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
            "escrow_paid": escrow_paid,
            "taxes_paid": taxes_paid,
            "depreciation": round(year_depreciation, 2),
            "cash_flow": cash_flow,
            "taxable_income": taxable_income,
            "total_return": round(cash_flow + principal_paid, 2),
            "statements": len(ss),
            "source": source,
        })

    totals = {
        k: round(sum(y[k] for y in yearly), 2)
        for k in ("rental_income", "operating_expenses", "interest_paid",
                  "principal_paid", "escrow_paid", "taxes_paid",
                  "depreciation", "cash_flow",
                  "taxable_income", "total_return")
    }

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
    snapshots, tax_by_year, interest_by_year, balance_by_year = _collect_doc_history(prop)
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
    yearly_details = []
    for year in range(purchase_year, end_year + 1):
        ss = [s for s in snapshots if s["year"] == year]
        # Principal: prefer 1098 balance delta (most accurate), then
        # mortgage-statement balance delta, then annualized, then estimated
        p1098 = _principal_from_1098(balance_by_year, year)
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
            principal_paid = round((ss[-1]["principal"] or 0) * 12, 2)
            source = "annualized"
        elif (has_documents or year in interest_by_year or year in tax_by_year
              or year in rental_by_year or year == current_year
              or year in balance_by_year or year in tax_return_rent_by_year):
            principal_paid = round(sum(l.principal_due or 0 for l in prop.loans) * 12, 2)
            source = "estimated"
        else:
            continue

        # Interest from mortgage statements or loan estimate
        if ss:
            interest_paid = round(sum(s["interest"] or 0 for s in ss) / len(ss) * 12, 2)
        else:
            interest_paid = round(sum(l.interest_due or 0 for l in prop.loans) * 12, 2)

        # Form 1098 reports exact annual interest — prefer it over estimates
        if year in interest_by_year:
            interest_paid = interest_by_year[year]
            if source != "actual":
                source = "1098"

        # Per-year actuals from documents so each year reflects its own data
        year_tax = tax_by_year.get(year)
        op_property_tax = year_tax if year_tax is not None else prop.property_tax
        operating_expenses = round(annual_other_op + prop.insurance + op_property_tax, 2)
        taxes_paid = round(year_tax if year_tax is not None else prop.property_tax, 2)

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

    lifetime = {
        "years_owned": years_owned,
        "purchase_year": purchase_year,
        "years_filled": len(yearly_details),
        "total_rental_income": round(sum(y["rental_income"] for y in yearly_details), 2),
        "total_operating_expenses": round(sum(y["operating_expenses"] for y in yearly_details), 2),
        "total_interest_paid": round(sum(y["interest_paid"] for y in yearly_details), 2),
        "total_principal_paid": round(sum(y["principal_paid"] for y in yearly_details), 2),
        "total_escrow_paid": round(sum(y["escrow_paid"] for y in yearly_details), 2),
        "total_taxes_paid": round(sum(y["taxes_paid"] for y in yearly_details), 2),
        "total_depreciation": round(sum(y["depreciation"] for y in yearly_details), 2),
        "total_cash_flow": round(sum(y["cash_flow"] for y in yearly_details), 2),
        "total_taxable_income": round(sum(y["taxable_income"] for y in yearly_details), 2),
        "total_return": round(
            sum(y["cash_flow"] + y["principal_paid"] for y in yearly_details), 2),
        "current_loan_balance": round(metrics["total_loan_balance"], 2),
        "market_value": prop.market_value,
        "equity": round(metrics["equity"], 2),
        "purchase_price": prop.purchase_price or 0,
        "annual_depreciation": annual_depreciation,
        "monthly_rent": prop.monthly_rent,
    }

    return {"lifetime": lifetime, "yearly": yearly_details}


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

    years = {}
    for e in entries:
        years.setdefault(e.tax_year, []).append(TaxEntryOut.model_validate(e))
    result = []
    for year in sorted(years, reverse=True):
        rows = years[year]
        totals = {
            f: round(sum(getattr(r, f) for r in rows), 2) for f in TAX_ENTRY_FIELDS
        }
        result.append({"tax_year": year, "entries": rows, "totals": totals})
    return {"years": result}


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

    props = own_props + shared_props

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
    for p in props:
        m = compute_property_metrics(p)
        total_monthly_rent += m["effective_rent"]
        total_annual_noi += m["annual_noi"]
        _orig_loans = [l for l in p.loans if (l.original_amount or 0) > 0]
        prop_original_loan = sum(l.original_amount for l in _orig_loans)
        prop_principal_paid = sum(l.original_amount - (l.current_balance or 0) for l in _orig_loans)
        properties_detail.append({
            "id": p.id,
            "address": p.address,
            "city": p.city,
            "state": p.state,
            "property_type": p.property_type,
            "usage_type": p.usage_type or "Rental",
            **m,
            "monthly_rent": p.monthly_rent,
            "market_value": p.market_value,
            "purchase_price": p.purchase_price or 0,
            "original_loan_amount": round(prop_original_loan, 2),
            "principal_paid": round(prop_principal_paid, 2),
            "interest_paid": round(interest_by_prop.get(p.id, 0.0), 2),
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

    return {
        "total_properties": total_properties,
        "total_monthly_rent": round(total_monthly_rent, 2),
        "total_market_value": round(total_market_value, 2),
        "total_loan_balance": round(total_loan_balance, 2),
        "total_monthly_mortgage": round(total_monthly_mortgage, 2),
        "total_equity": round(total_equity, 2),
        "total_monthly_cash_flow": round(total_monthly_rent - total_monthly_mortgage, 2),
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
        "properties": properties_detail,
    }
