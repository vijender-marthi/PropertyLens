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
    address = Column(String, nullable=False)
    city = Column(String)
    state = Column(String)
    zip_code = Column(String)
    property_type = Column(String, default=PropertyType.SINGLE_FAMILY)
    usage_type = Column(String, default="Rental")  # Rental | Primary
    purchase_date = Column(String)
    purchase_price = Column(Float, default=0.0)

    # Rental income
    monthly_rent = Column(Float, default=0.0)
    occupancy_rate = Column(Float, default=100.0)  # percentage

    # Expenses (monthly)
    property_tax = Column(Float, default=0.0)
    insurance = Column(Float, default=0.0)
    hoa_fee = Column(Float, default=0.0)
    maintenance = Column(Float, default=0.0)
    property_management_fee = Column(Float, default=0.0)
    utilities = Column(Float, default=0.0)
    vacancy_allowance = Column(Float, default=0.0)   # monthly $ reserve for vacancy periods
    capex_reserve = Column(Float, default=0.0)        # monthly $ reserve for capital expenditures
    other_expenses = Column(Float, default=0.0)

    # Depreciation
    land_value = Column(Float, default=0.0)  # excluded from depreciation
    land_price = Column(Float, default=0.0)
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


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)

    lender_name = Column(String)
    loan_type = Column(String, default=LoanType.FIXED)
    original_amount = Column(Float, nullable=False)
    current_balance = Column(Float, nullable=False)
    interest_rate = Column(Float, nullable=False)  # annual percentage
    rate_note = Column(String)  # e.g. "Until 10/2032 pmt" for ARM intro rates
    monthly_payment = Column(Float, nullable=False)
    loan_term_years = Column(Integer, nullable=False)
    origination_date = Column(String)
    maturity_date = Column(String)

    # From the latest mortgage statement
    account_number = Column(String)
    borrowers = Column(String)  # "Name 1; Name 2"
    principal_due = Column(Float)  # principal portion of current payment
    interest_due = Column(Float)  # interest portion of current payment
    statement_date = Column(String)
    payment_due_date = Column(String)

    # Escrow
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
    file_type = Column(String)  # pdf, xlsx, etc.
    doc_category = Column(String)  # mortgage_statement, tax_return, 1099, loan_disclosure, other
    file_size = Column(Integer)
    extracted_data = Column(Text)  # JSON string of parsed data
    markdown_file = Column(String)  # structured markdown generated at parse time

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
