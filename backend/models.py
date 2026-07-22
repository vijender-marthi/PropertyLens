from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Enum,
    UniqueConstraint, Numeric,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum
import uuid


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
    role = Column(String, default="demo")  # demo | premium | admin | superuser
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
    property_type = Column(String, default="single_family")
    property_type_raw = Column(String)
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
    rental_start_date_origin = Column(String)
    recorded_date = Column(String)
    held_period = Column(String)
    purchase_date = Column(String)
    purchase_price = Column(Float, default=0.0)
    down_payment = Column(Float, default=0.0)
    settlement_total_amount = Column(Float, default=0.0)
    closing_costs = Column(Float, default=0.0)
    cash_to_close = Column(Float, default=0.0)
    deposit_paid_before_closing = Column(Float, default=0.0)
    total_due_from_borrower = Column(Float, default=0.0)
    total_paid_on_behalf_of_borrower = Column(Float, default=0.0)
    settlement_debit_total = Column(Float, default=0.0)
    settlement_credit_total = Column(Float, default=0.0)
    seller_credits = Column(Float, default=0.0)
    tax_prorations = Column(Float, default=0.0)
    hoa_prorations = Column(Float, default=0.0)

    # Rental income
    monthly_rent = Column(Float, default=0.0)
    occupancy_rate = Column(Float, default=100.0)  # percentage

    # Legacy expense snapshot. AnnualExpense is the canonical per-year source
    # for setup and year-specific metrics when rows are present.
    property_tax = Column(Float, default=0.0)
    property_tax_history = Column(Text, default="{}")
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
    market_value_source = Column(String, default="estimated_6pct")  # estimated_6pct/manual/appraisal/imported/zillow/redfin
    market_value_updated = Column(String)

    # Free-form note about this property (refinances, events, etc.)
    notes = Column(Text, default="")
    # Per-year notes: JSON string mapping year (str) → note (str)
    year_notes = Column(Text, default="{}")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    @property
    def createdAt(self):
        return self.created_at

    @property
    def updatedAt(self):
        return self.updated_at

    owner = relationship("User", back_populates="properties")
    loans = relationship("Loan", back_populates="property", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="property", cascade="all, delete-orphan")
    rental_periods = relationship(
        "RentalPeriod", back_populates="property",
        cascade="all, delete-orphan", order_by="RentalPeriod.start_year, RentalPeriod.start_month")
    usage_periods = relationship(
        "UsagePeriod", back_populates="property",
        cascade="all, delete-orphan", order_by="UsagePeriod.start_date")
    tax_entries = relationship(
        "TaxReturnEntry", back_populates="property", cascade="all, delete-orphan")
    depreciation_assets = relationship(
        "DepreciationAsset", back_populates="property", cascade="all, delete-orphan")
    annual_expenses = relationship(
        "AnnualExpense", back_populates="property", cascade="all, delete-orphan",
        order_by="AnnualExpense.year")
    escrow_payments = relationship(
        "EscrowPayment", back_populates="property", cascade="all, delete-orphan",
        order_by="EscrowPayment.statement_date")
    escrow_activities = relationship(
        "EscrowActivity", back_populates="property", cascade="all, delete-orphan")
    annual_expense_metrics = relationship(
        "AnnualExpenseMetric", back_populates="property", cascade="all, delete-orphan")
    property_tax_records = relationship(
        "PropertyTaxRecord", back_populates="property", cascade="all, delete-orphan",
        foreign_keys="PropertyTaxRecord.property_id")
    transactions = relationship(
        "PropertyTransaction", back_populates="property", cascade="all, delete-orphan")


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)

    lender_name = Column(String)
    loan_product = Column(String)
    loan_type = Column(String, default=LoanType.FIXED)
    status = Column(String, default="OPEN")
    closed_date = Column(String)
    closure_reason = Column(String)
    replacement_loan_id = Column(Integer)
    loan_group_id = Column(String)
    servicer_sequence = Column(Integer)
    servicer_start_date = Column(String)
    servicer_end_date = Column(String)
    transfer_reason = Column(String)
    is_current_servicer = Column(Boolean, default=True)
    original_amount = Column(Float, nullable=False)
    current_balance = Column(Float, nullable=False)
    interest_rate = Column(Float, nullable=False)  # annual percentage
    rate_note = Column(String)  # e.g. "Until 10/2032 pmt" for ARM intro rates
    monthly_payment = Column(Float, nullable=False)
    estimated_total_monthly_payment = Column(Float, default=0.0)
    extra_monthly_payment = Column(Float, default=0.0)
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
    monthly_property_tax_escrow = Column(Float, default=0.0)
    monthly_insurance_escrow = Column(Float, default=0.0)
    monthly_mortgage_insurance = Column(Float, default=0.0)
    monthly_other_escrow = Column(Float, default=0.0)

    # Import provenance for setup/document-assisted loan creation.
    source_document_id = Column(Integer, ForeignKey("documents.id"))
    source_type = Column(String)
    import_status = Column(String)
    current_balance_source = Column(String)
    current_balance_as_of = Column(String)
    current_balance_verified = Column(Boolean, default=True)
    purpose = Column(String)
    disbursement_date = Column(String)
    balance_as_of = Column(String)
    lender_at_origination = Column(String)
    current_servicer = Column(String)
    refinanced_into_loan_id = Column(Integer)
    refinanced_from_loan_id = Column(Integer)
    resolution_confidence = Column(Float, default=0.0)

    # ARM specific
    arm_initial_period = Column(Integer)  # years before first adjustment
    arm_adjustment_period = Column(Integer)  # how often it adjusts after initial
    arm_cap = Column(Float)  # lifetime rate cap
    arm_margin = Column(Float)  # margin over index
    arm_index = Column(String)  # e.g., "SOFR", "LIBOR"

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property = relationship("Property", back_populates="loans")
    document_links = relationship(
        "LoanDocumentLink", back_populates="loan", cascade="all, delete-orphan")
    balance_snapshots = relationship(
        "LoanBalanceSnapshot", back_populates="loan", cascade="all, delete-orphan",
        order_by="LoanBalanceSnapshot.as_of_date")
    servicer_segments = relationship(
        "LoanServicerSegment", back_populates="loan", cascade="all, delete-orphan",
        order_by="LoanServicerSegment.from_date, LoanServicerSegment.id")
    transaction_links = relationship(
        "TransactionLoanLink", back_populates="loan", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True)  # null = common doc (e.g. tax return)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    record_uuid = Column(String, unique=True, index=True)
    display_name = Column(String)  # human-readable name derived from extracted content, not the uploaded filename
    file_type = Column(String)  # pdf, xlsx, etc.
    doc_category = Column(String)  # mortgage_statement, tax_return, 1099, loan_disclosure, other
    module_tags = Column(String, default="")  # comma-separated module associations, e.g. EXPENSES
    document_type = Column(String)
    transaction_purpose = Column(String)
    transaction_role = Column(String)
    classification_confidence = Column(Float, default=0.0)
    file_size = Column(Integer)
    extracted_data = Column(Text)  # JSON string of parsed data
    markdown_file = Column(String)  # structured markdown generated at parse time
    normalized_text = Column(Text)
    parser_version = Column(String)
    pipeline_status = Column(String)
    conversion_metadata = Column(Text, default="{}")
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


class PropertyTaxRecord(Base):
    """A tax bill as issued. Supplemental bills are intentionally not annual expenses."""
    __tablename__ = "property_tax_records"
    __table_args__ = (
        UniqueConstraint("owner_id", "identity_key", name="uq_property_tax_record_identity"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=True, index=True)
    candidate_property_id = Column(Integer, ForeignKey("properties.id"), nullable=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, unique=True, index=True)
    document_type = Column(String, nullable=False, index=True)
    tax_type = Column(String, nullable=False, index=True)
    issuer = Column(String)
    property_address = Column(String)
    parcel_number = Column(String, index=True)
    tracer_number = Column(String, index=True)
    tax_rate_area = Column(String)
    fiscal_year_label = Column(String, index=True)
    fiscal_period_start = Column(String, index=True)
    fiscal_period_end = Column(String, index=True)
    event_type = Column(String)
    event_date = Column(String)
    supplemental_assessment = Column(Numeric(18, 2))
    total_tax_rate_percent = Column(Numeric(12, 6))
    proration_percent = Column(Numeric(12, 6))
    tax_before_proration = Column(Numeric(18, 2))
    total_amount_billed = Column(Numeric(18, 2))
    payment_status = Column(String)
    identity_key = Column(String, nullable=False, index=True)
    related_event_key = Column(String, index=True)
    structured_json = Column(Text, nullable=False, default="{}")
    validation_json = Column(Text, nullable=False, default="{}")
    parser_name = Column(String)
    parser_version = Column(String)
    classification_confidence = Column(Float, default=0.0)
    property_match_confidence = Column(Float, default=0.0)
    property_match_status = Column(String, default="MATCHED")
    status = Column(String, default="READY")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship(
        "Property", back_populates="property_tax_records", foreign_keys=[property_id])
    document = relationship("Document")
    corrections = relationship(
        "PropertyTaxCorrection", back_populates="record", cascade="all, delete-orphan")


class PropertyTaxCorrection(Base):
    __tablename__ = "property_tax_corrections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_tax_record_id = Column(
        String, ForeignKey("property_tax_records.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    field_path = Column(String, nullable=False)
    original_value_json = Column(Text)
    corrected_value_json = Column(Text)
    reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    record = relationship("PropertyTaxRecord", back_populates="corrections")


class PropertyTransaction(Base):
    """Resolved property event supported by one or more source documents."""
    __tablename__ = "property_transactions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    resolution_key = Column(String, index=True)
    transaction_type = Column(String, nullable=False, index=True)
    purpose = Column(String, nullable=False, index=True)
    closing_date = Column(String, index=True)
    disbursement_date = Column(String, index=True)
    purchase_price = Column(Float)
    appraised_value = Column(Float)
    borrower_paid_closing_costs = Column(Float)
    down_payment = Column(Float)
    cash_to_close = Column(Float)
    deposit_paid_before_closing = Column(Float)
    total_due_from_borrower = Column(Float)
    total_paid_on_behalf_of_borrower = Column(Float)
    settlement_debit_total = Column(Float)
    settlement_credit_total = Column(Float)
    seller_credits = Column(Float)
    tax_prorations = Column(Float)
    hoa_prorations = Column(Float)
    confidence = Column(Float, default=0.0)
    status = Column(String, default="RESOLVED")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship("Property", back_populates="transactions")
    document_links = relationship(
        "TransactionDocumentLink", back_populates="transaction", cascade="all, delete-orphan")
    loan_links = relationship(
        "TransactionLoanLink", back_populates="transaction", cascade="all, delete-orphan")


class TransactionLoanLink(Base):
    """Durable association between an economic transaction and canonical debt."""
    __tablename__ = "transaction_loan_links"
    __table_args__ = (
        UniqueConstraint("transaction_id", "loan_id", name="uq_transaction_loan_link"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = Column(String, ForeignKey("property_transactions.id"), nullable=False, index=True)
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    role = Column(String, default="ORIGINATED_DEBT")
    lien_position = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    transaction = relationship("PropertyTransaction", back_populates="loan_links")
    loan = relationship("Loan", back_populates="transaction_links")


class LoanServicerSegment(Base):
    """A servicing account period belonging to one canonical loan."""
    __tablename__ = "loan_servicer_segments"
    __table_args__ = (
        UniqueConstraint(
            "loan_id", "normalized_account_number", "from_date",
            name="uq_loan_servicer_segment_identity",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    servicer = Column(String)
    account_number = Column(String)
    normalized_account_number = Column(String, nullable=False, default="", index=True)
    from_date = Column(String, nullable=False, default="")
    to_date = Column(String)
    is_current = Column(Boolean, default=True)
    source_document_id = Column(Integer, ForeignKey("documents.id"), index=True)
    confidence = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    loan = relationship("Loan", back_populates="servicer_segments")
    source_document = relationship("Document")


class TransactionDocumentLink(Base):
    __tablename__ = "transaction_document_links"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = Column(String, ForeignKey("property_transactions.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    source_role = Column(String)
    source_priority = Column(Integer, default=99)
    fields_used = Column(Text, default="[]")
    match_confidence = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    transaction = relationship("PropertyTransaction", back_populates="document_links")
    document = relationship("Document")


class LoanDocumentLink(Base):
    __tablename__ = "loan_document_links"
    __table_args__ = (
        UniqueConstraint("loan_id", "document_id", name="uq_loan_document_link"),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    source_role = Column(String)
    fields_used = Column(Text, default="[]")
    priority = Column(Integer, default=99)
    confidence = Column(Float, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    loan = relationship("Loan", back_populates="document_links")
    document = relationship("Document")


class LoanBalanceSnapshot(Base):
    __tablename__ = "loan_balance_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "loan_id", "source_document_id", "as_of_date",
            name="uq_loan_balance_snapshot_source",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    as_of_date = Column(String, nullable=False, index=True)
    balance = Column(Float)
    principal_paid_ytd = Column(Float)
    interest_paid_ytd = Column(Float)
    payment = Column(Float)
    source_document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    loan = relationship("Loan", back_populates="balance_snapshots")
    document = relationship("Document")


class LoanResolutionDiscrepancy(Base):
    __tablename__ = "loan_resolution_discrepancies"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    loan_id = Column(Integer, ForeignKey("loans.id"), index=True)
    transaction_id = Column(String, ForeignKey("property_transactions.id"), index=True)
    field_name = Column(String, nullable=False)
    selected_value = Column(Text)
    conflicting_value = Column(Text)
    selected_document_id = Column(Integer, ForeignKey("documents.id"))
    conflicting_document_id = Column(Integer, ForeignKey("documents.id"))
    difference = Column(Float)
    status = Column(String, default="OPEN")
    reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LoanResolutionAlias(Base):
    __tablename__ = "loan_resolution_aliases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    old_loan_id = Column(Integer, nullable=False, index=True)
    canonical_loan_id = Column(Integer, ForeignKey("loans.id"), nullable=False, index=True)
    reason = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


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


class UsagePeriod(Base):
    """Ownership usage timeline. Drives primary/rental calculations over time."""
    __tablename__ = "usage_periods"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    usage_type = Column(String, nullable=False)  # PRIMARY | RENTAL
    start_date = Column(String, nullable=False)
    end_date = Column(String)  # null = current
    fmv_at_start = Column(Float, default=0.0)
    monthly_rent = Column(Float, default=0.0)
    vacancy_allowance = Column(Float, default=0.0)
    property_management_fee = Column(Float, default=0.0)
    accumulated_depreciation_at_start = Column(Float, default=0.0)
    suspended_losses_at_start = Column(Float, default=0.0)
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship("Property", back_populates="usage_periods")


class AnnualExpense(Base):
    """Per-year annual operating expense inputs for one property."""
    __tablename__ = "annual_expenses"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    property_tax = Column(Float, default=0.0)
    insurance = Column(Float, default=0.0)
    hoa = Column(Float, default=0.0)
    repairs_maintenance = Column(Float, default=0.0)
    property_management = Column(Float, default=0.0)
    utilities = Column(Float, default=0.0)
    vacancy_allowance = Column(Float, default=0.0)
    capex_reserve = Column(Float, default=0.0)
    other = Column(Float, default=0.0)
    property_tax_source = Column(String, default="manual")
    insurance_source = Column(String, default="manual")
    source_status = Column(String, default="manual")
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship("Property", back_populates="annual_expenses")


class EscrowPayment(Base):
    """One annual escrow-analysis snapshot and its tax/insurance projections."""
    __tablename__ = "escrow_payments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    loan_id = Column(Integer, ForeignKey("loans.id"), nullable=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, unique=True, index=True)
    loan_number = Column(String, index=True)
    property_address = Column(String)
    statement_date = Column(String, index=True)
    effective_date = Column(String)
    history_period_start = Column(String)
    history_period_end = Column(String)
    projection_period_start = Column(String)
    projection_period_end = Column(String)
    expense_year = Column(Integer, index=True)
    current_escrow_payment = Column(Float)
    new_escrow_payment = Column(Float)
    servicer = Column(String)
    principal_interest_payment = Column(Float)
    current_total_payment = Column(Float)
    new_total_payment = Column(Float)
    estimated_tax = Column(Float)
    actual_tax = Column(Float)
    estimated_insurance = Column(Float)
    actual_insurance = Column(Float)
    projected_tax = Column(Float)
    projected_insurance = Column(Float)
    projected_total = Column(Float)
    projected_monthly_escrow = Column(Float)
    shortage_amount = Column(Float)
    overage_amount = Column(Float)
    refund_amount = Column(Float)
    projected_minimum_balance = Column(Float)
    required_minimum_balance = Column(Float)
    escrow_cushion = Column(Float)
    selected_payment_option = Column(String)
    estimated_total_disbursement = Column(Float)
    actual_total_disbursement = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship("Property", back_populates="escrow_payments")
    loan = relationship("Loan")
    document = relationship("Document")
    activities = relationship(
        "EscrowActivity", back_populates="escrow_payment", cascade="all, delete-orphan",
        order_by="EscrowActivity.activity_date, EscrowActivity.id")


class EscrowActivity(Base):
    """Normalized escrow ledger row retained for audit and annual allocation."""
    __tablename__ = "escrow_activities"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    escrow_payment_id = Column(String, ForeignKey("escrow_payments.id"), nullable=False, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    activity_date = Column(String, index=True)
    activity_type = Column(String, index=True)
    source_description = Column(String)
    phase = Column(String, index=True)  # HISTORICAL | PROJECTED | PARTIALLY_PROJECTED
    value_status = Column(String)
    estimated_deposit = Column(Float)
    actual_deposit = Column(Float)
    estimated_disbursement = Column(Float)
    actual_disbursement = Column(Float)
    estimated_balance = Column(Float)
    actual_balance = Column(Float)
    required_balance = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    property = relationship("Property", back_populates="escrow_activities")
    escrow_payment = relationship("EscrowPayment", back_populates="activities")
    document = relationship("Document")


class AnnualExpenseMetric(Base):
    """Backend-selected annual value and its complete source/calculation audit."""
    __tablename__ = "annual_expense_metrics"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    expense_type = Column(String, nullable=False, index=True)
    value = Column(Float)
    status = Column(String)
    completeness = Column(String)
    source_type = Column(String)
    source_label = Column(String)
    allocation_method = Column(String)
    coverage_json = Column(Text, default="{}")
    formula = Column(Text)
    inputs_json = Column(Text, default="[]")
    computation = Column(Text)
    document_ids_json = Column(Text, default="[]")
    supporting_document_ids_json = Column(Text, default="[]")
    discrepancies_json = Column(Text, default="[]")
    excluded_rows_json = Column(Text, default="[]")
    confidence = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    property = relationship("Property", back_populates="annual_expense_metrics")


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
    record_uuid = Column(String, unique=True, index=True)
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


class MetricSnapshot(Base):
    """Frozen backend-owned metric/verification payload for auditability."""
    __tablename__ = "metric_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    snapshot_uuid = Column(String, unique=True, index=True, nullable=False)
    snapshot_type = Column(String, index=True, nullable=False) # metric_vault | verification
    schema_version = Column(String)
    payload_json = Column(Text, nullable=False)
    generated_at = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserSharing(Base):
    """One row = user `owner` has granted view access to `shared_with`."""
    __tablename__ = "user_sharing"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    shared_with_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", foreign_keys=[owner_id], back_populates="shares_given")
    shared_with = relationship("User", foreign_keys=[shared_with_id], back_populates="shares_received")


class PayoffScenario(Base):
    """A saved Payoff-planner scenario: the full input set plus a snapshot of
    the headline results at save time, so the user can quickly switch between
    plans and compare them side by side."""
    __tablename__ = "payoff_scenarios"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    inputs = Column(Text, nullable=False)   # JSON: {strategy, lumpSum, extraMonthly, recurringLump, recurringMonth, recurringYears, includePrimary, selectedPropertyIds, selectionExplicit}
    results = Column(Text)                   # JSON: headline snapshot {debtFree, timeSaved, interestSaved, peakMonthly, ...}
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
