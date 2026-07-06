from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Enum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class LoanType(str, enum.Enum):
    FIXED = "FIXED"
    ARM = "ARM"


class PropertyType(str, enum.Enum):
    SINGLE_FAMILY = "Single Family"
    MULTI_FAMILY = "Multi Family"
    CONDO = "Condo"
    TOWNHOUSE = "Townhouse"
    COMMERCIAL = "Commercial"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="demo")  # demo | admin | superuser
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    properties = relationship("Property", back_populates="owner")
    shares_given = relationship(
        "UserSharing", foreign_keys="UserSharing.owner_id", back_populates="owner"
    )
    shares_received = relationship(
        "UserSharing", foreign_keys="UserSharing.shared_with_id", back_populates="shared_with"
    )


class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Basic info
    property_uid = Column(String, unique=True, index=True)
    name = Column(String)
    address = Column(String, nullable=False)
    city = Column(String)
    state = Column(String)
    zip_code = Column(String)
    property_type = Column(String, default=PropertyType.SINGLE_FAMILY)
    usage_type = Column(String, default="Rental")  # Rental | Primary
    # True once the user has explicitly changed Usage themselves — locks out
    # the tax-return importer's "latest primary home" auto-detection so a
    # later return can't silently flip it back.
    usage_type_locked = Column(Boolean, default=False)
    original_residency_status = Column(String)
    current_residency_status = Column(String)
    primary_start_date = Column(String)
    primary_end_date = Column(String)
    rental_start_date = Column(String)
    rental_end_date = Column(String)
    recorded_date = Column(String)
    held_period = Column(String)
    purchase_date = Column(String)
    purchase_price = Column(Float, default=0.0)
    settlement_total_amount = Column(Float, default=0.0)
    closing_costs = Column(Float, default=0.0)

    # Rental income
    monthly_rent = Column(Float, default=0.0)
    occupancy_rate = Column(Float, default=100.0)  # percentage

    # Expenses (monthly)
    property_tax = Column(Float, default=0.0)
    insurance = Column(Float, default=0.0)
    hoa_flag = Column(Boolean, default=False)
    hoa_fee = Column(Float, default=0.0)
    hoa_history = Column(Text, default="[]")  # JSON: [{year, monthly_fee}]
    hoa_special_assessment = Column(Float, default=0.0)
    solar_ownership = Column(String, default="None")  # None | Leased | Purchased | Included in Purchase
    solar_monthly_payment = Column(Float, default=0.0)
    solar_purchase_price = Column(Float, default=0.0)
    maintenance = Column(Float, default=0.0)
    property_management_fee = Column(Float, default=0.0)
    utilities = Column(Float, default=0.0)
    vacancy_allowance = Column(Float, default=0.0)   # monthly $ reserve for vacancy periods
    capex_reserve = Column(Float, default=0.0)        # monthly $ reserve for capital expenditures
    other_expenses = Column(Float, default=0.0)

    # Depreciation
    land_value = Column(Float, default=0.0)  # excluded from depreciation
    construction_price = Column(Float, default=0.0)
    depreciation_years = Column(Float, default=27.5)  # 27.5 for residential

    # Market value (from Zillow/Redfin or manual)
    market_value = Column(Float, default=0.0)
    market_value_source = Column(String, default="manual")  # manual/zillow/redfin
    market_value_updated = Column(String)

    # Free-form note about this property (refinances, events, etc.)
    notes = Column(Text, default="")
    # Per-year notes: JSON string mapping year (str) → note (str)
    year_notes = Column(Text, default="{}")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    owner = relationship("User", back_populates="properties")
    loans = relationship("Loan", back_populates="property", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="property", cascade="all, delete-orphan")
    rental_periods = relationship(
        "RentalPeriod", back_populates="property",
        cascade="all, delete-orphan", order_by="RentalPeriod.start_year, RentalPeriod.start_month")
    tax_entries = relationship(
        "TaxReturnEntry", back_populates="property", cascade="all, delete-orphan")
    depreciation_assets = relationship(
        "DepreciationAsset", back_populates="property", cascade="all, delete-orphan")


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)

    lender_name = Column(String)
    loan_product = Column(String)
    loan_type = Column(String, default=LoanType.FIXED)
    original_amount = Column(Float, nullable=False)
    current_balance = Column(Float, nullable=False)
    interest_rate = Column(Float, nullable=False)  # annual percentage
    rate_note = Column(String)  # e.g. "Until 10/2032 pmt" for ARM intro rates
    monthly_payment = Column(Float, nullable=False)
    estimated_total_monthly_payment = Column(Float, default=0.0)
    loan_term_years = Column(Integer, nullable=False)
    origination_date = Column(String)
    maturity_date = Column(String)
    original_ltv = Column(Float, default=0.0)

    # From the latest mortgage statement
    account_number = Column(String)
    borrowers = Column(String)  # "Name 1; Name 2"
    principal_due = Column(Float)  # principal portion of current payment
    interest_due = Column(Float)  # interest portion of current payment
    statement_date = Column(String)
    payment_due_date = Column(String)
    mortgage_tenure_covered = Column(String)
    interest_paid_ytd = Column(Float, default=0.0)
    principal_paid_ytd = Column(Float, default=0.0)
    projected_principal_fy = Column(Float, default=0.0)
    projected_interest_fy = Column(Float, default=0.0)

    # Escrow
    escrow_included = Column(Boolean, default=False)
    escrow_amount = Column(Float, default=0.0)  # monthly taxes+insurance in escrow

    # ARM specific
    arm_initial_period = Column(Integer)  # years before first adjustment
    arm_adjustment_period = Column(Integer)  # how often it adjusts after initial
    arm_cap = Column(Float)  # lifetime rate cap
    arm_margin = Column(Float)  # margin over index
    arm_index = Column(String)  # e.g., "SOFR", "LIBOR"

    # Down payment
    down_payment = Column(Float, default=0.0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property = relationship("Property", back_populates="loans")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True)  # null = common doc (e.g. tax return)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    display_name = Column(String)  # human-readable name derived from extracted content, not the uploaded filename
    file_type = Column(String)  # pdf, xlsx, etc.
    doc_category = Column(String)  # mortgage_statement, tax_return, 1099, loan_disclosure, other
    file_size = Column(Integer)
    extracted_data = Column(Text)  # JSON string of parsed data
    markdown_file = Column(String)  # structured markdown generated at parse time
    content_hash = Column(String, index=True)  # sha256 of raw file bytes; flags exact-content duplicates regardless of filename
    content_fingerprint = Column(String, index=True)  # sha256 of normalized extracted fields; flags near-duplicates (re-scan/re-export of the same statement)

    # Deduplication and loan tracking
    loan_account_number = Column(String, index=True)  # extracted from document
    statement_year = Column(Integer, index=True)  # year from statement_date
    period_type = Column(String, default="other")  # monthly, quarterly, half_yearly, yearly, other
    period_start = Column(String)  # statement period start date
    period_end = Column(String)  # statement period end date

    upload_date = Column(DateTime(timezone=True), server_default=func.now())

    property = relationship("Property", back_populates="documents", foreign_keys=[property_id])


class RentalPeriod(Base):
    """A tenancy/lease covering a span of months. Years aren't always fully
    occupied, so income and occupancy are derived from these periods rather
    than a single static monthly rent. An open-ended period (no end month/
    year) is treated as ongoing through the current month."""
    __tablename__ = "rental_periods"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)

    tenant_name = Column(String)  # optional label
    start_year = Column(Integer, nullable=False)
    start_month = Column(Integer, nullable=False)  # 1-12
    end_year = Column(Integer)   # null = ongoing
    end_month = Column(Integer)  # null = ongoing (1-12)
    monthly_rent = Column(Float, nullable=False, default=0.0)
    notes = Column(String)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property = relationship("Property", back_populates="rental_periods")


class DepreciationAsset(Base):
    """Asset-level depreciation/amortization schedule item for one property."""
    __tablename__ = "depreciation_assets"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    asset_type = Column(String, default="depreciation")  # depreciation | amortization
    description = Column(String, nullable=False)
    placed_in_service_date = Column(String)
    cost_basis = Column(Float, default=0.0)
    land_portion = Column(Float, default=0.0)
    method = Column(String, default="SL")
    recovery_period = Column(Float, default=27.5)
    prior_depreciation = Column(Float, default=0.0)
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship("Property", back_populates="depreciation_assets")


class TaxReturnEntry(Base):
    """Per-property figures extracted from a tax return (Schedule E rentals +
    Schedule A primary home), for year-over-year and cross-property comparison.

    Privacy: we deliberately store NO SSNs and NO taxpayer names — only the
    property address/label and its financial line items. `property_id` is null
    for addresses that don't match a managed property (e.g. foreign condos),
    which are kept for comparison only."""
    __tablename__ = "tax_return_entries"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    property_id = Column(Integer, ForeignKey("properties.id"))  # null = unmatched
    document_id = Column(Integer, ForeignKey("documents.id"))   # source return

    tax_year = Column(Integer, nullable=False)
    address = Column(String)
    property_kind = Column(String, default="rental")  # rental | primary

    rents_received = Column(Float, default=0.0)
    mortgage_interest = Column(Float, default=0.0)
    property_taxes = Column(Float, default=0.0)
    depreciation = Column(Float, default=0.0)
    total_expenses = Column(Float, default=0.0)
    net_income = Column(Float, default=0.0)
    expense_breakdown = Column(Text, default="{}")
    depreciation_detail = Column(Text, default="{}")
    source_refs = Column(Text, default="{}")
    unresolved_fields = Column(Text, default="[]")
    confidence = Column(Float, default=0.0)
    schedule1_line5_total = Column(Float)
    schedule1_line5_delta = Column(Float)
    cash_noi = Column(Float, default=0.0)
    tax_pl = Column(Float, default=0.0)
    depreciable_basis = Column(Float, default=0.0)
    accumulated_depreciation = Column(Float, default=0.0)
    remaining_depreciable_basis = Column(Float, default=0.0)
    years_remaining = Column(Float, default=0.0)
    annual_straight_line_depreciation = Column(Float, default=0.0)
    # Schedule E "Fair Rental Days" / "Personal Use Days" (lines 2 & 3)
    days_rented = Column(Integer, default=0)       # days property was rented
    personal_use_days = Column(Integer, default=0) # days owner personally used it

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property = relationship("Property", back_populates="tax_entries")


class UserSharing(Base):
    """One row = user `owner` has granted view access to `shared_with`."""
    __tablename__ = "user_sharing"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    shared_with_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", foreign_keys=[owner_id], back_populates="shares_given")
    shared_with = relationship("User", foreign_keys=[shared_with_id], back_populates="shares_received")
