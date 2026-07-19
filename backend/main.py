from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy import text
import uuid
import models
from database import engine
from routers import auth, properties, documents, sharing, help as help_router

# Create tables
models.Base.metadata.create_all(bind=engine)

PROPERTY_CODE_NAMES = [
    "Palermo", "Electra", "Syrah", "Valencia", "Meridian", "Solara",
    "Cypress", "Juniper", "Sierra", "Atlas", "Nova", "Laurel",
    "Haven", "Orion", "Saffron", "Monaco",
]


def _default_property_name(prop_id: int) -> str:
    base = PROPERTY_CODE_NAMES[(prop_id - 1) % len(PROPERTY_CODE_NAMES)]
    cycle = (prop_id - 1) // len(PROPERTY_CODE_NAMES)
    return base if cycle == 0 else f"{base} {cycle + 1}"


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


def _canonical_property_type(value: str | None) -> str:
    raw = (value or "").strip()
    normalized = raw.lower().replace("_", " ")
    return PROPERTY_TYPE_ALIASES.get(normalized, raw if raw in PROPERTY_TYPE_ALIASES.values() else "other")

# Lightweight migrations for columns added after the initial schema
MIGRATIONS = {
    "users": {
        "role": "VARCHAR DEFAULT 'demo'",
    },
    "properties": {
	"property_uid": "VARCHAR",
	"name": "VARCHAR",
        "property_type_raw": "VARCHAR",
	"usage_type": "VARCHAR DEFAULT 'Rental'",
"usage_type_locked": "BOOLEAN DEFAULT 0",
"original_residency_status": "VARCHAR",
"current_residency_status": "VARCHAR",
"primary_start_date": "VARCHAR",
"primary_end_date": "VARCHAR",
"rental_start_date": "VARCHAR",
"rental_end_date": "VARCHAR",
"rental_start_date_origin": "VARCHAR",
"recorded_date": "VARCHAR",
        "held_period": "VARCHAR",
        "down_payment": "FLOAT DEFAULT 0.0",
        "settlement_total_amount": "FLOAT DEFAULT 0.0",
"closing_costs": "FLOAT DEFAULT 0.0",
        "cash_to_close": "FLOAT DEFAULT 0.0",
        "deposit_paid_before_closing": "FLOAT DEFAULT 0.0",
        "total_due_from_borrower": "FLOAT DEFAULT 0.0",
        "total_paid_on_behalf_of_borrower": "FLOAT DEFAULT 0.0",
        "settlement_debit_total": "FLOAT DEFAULT 0.0",
        "settlement_credit_total": "FLOAT DEFAULT 0.0",
        "seller_credits": "FLOAT DEFAULT 0.0",
        "tax_prorations": "FLOAT DEFAULT 0.0",
        "hoa_prorations": "FLOAT DEFAULT 0.0",
"hoa_flag": "BOOLEAN DEFAULT 0",
"hoa_history": "TEXT DEFAULT '[]'",
        "hoa_special_assessment": "FLOAT DEFAULT 0.0",
        "solar_ownership": "VARCHAR DEFAULT 'None'",
        "solar_monthly_payment": "FLOAT DEFAULT 0.0",
        "solar_purchase_price": "FLOAT DEFAULT 0.0",
        "property_tax_history": "TEXT DEFAULT '{}'",
        "vacancy_allowance": "FLOAT DEFAULT 0.0",
        "capex_reserve": "FLOAT DEFAULT 0.0",
        "construction_price": "FLOAT DEFAULT 0.0",
    },
    "documents": {
        "record_uuid": "VARCHAR",
        "markdown_file": "VARCHAR",
        "loan_account_number": "VARCHAR",
        "statement_year": "INTEGER",
        "period_type": "VARCHAR DEFAULT 'other'",
        "period_start": "VARCHAR",
        "period_end": "VARCHAR",
        "display_name": "VARCHAR",
        "content_hash": "VARCHAR",
        "content_fingerprint": "VARCHAR",
        "module_tags": "VARCHAR DEFAULT ''",
        "document_type": "VARCHAR",
        "transaction_purpose": "VARCHAR",
        "transaction_role": "VARCHAR",
        "classification_confidence": "FLOAT DEFAULT 0.0",
        "normalized_text": "TEXT",
        "parser_version": "VARCHAR",
        "pipeline_status": "VARCHAR",
        "conversion_metadata": "TEXT DEFAULT '{}'",
    },
    "property_tax_records": {
        "candidate_property_id": "INTEGER",
    },
    "tax_return_entries": {
        "record_uuid": "VARCHAR",
        "days_rented": "INTEGER DEFAULT 0",
"personal_use_days": "INTEGER DEFAULT 0",
"expense_breakdown": "TEXT DEFAULT '{}'",
"depreciation_detail": "TEXT DEFAULT '{}'",
"source_refs": "TEXT DEFAULT '{}'",
"unresolved_fields": "TEXT DEFAULT '[]'",
"confidence": "FLOAT DEFAULT 0.0",
"schedule1_line5_total": "FLOAT",
"schedule1_line5_delta": "FLOAT",
"cash_noi": "FLOAT DEFAULT 0.0",
"tax_pl": "FLOAT DEFAULT 0.0",
"depreciable_basis": "FLOAT DEFAULT 0.0",
"accumulated_depreciation": "FLOAT DEFAULT 0.0",
"remaining_depreciable_basis": "FLOAT DEFAULT 0.0",
"years_remaining": "FLOAT DEFAULT 0.0",
"annual_straight_line_depreciation": "FLOAT DEFAULT 0.0",
},
    "loans": {
        "loan_product": "VARCHAR",
        "rate_note": "VARCHAR",
        "status": "VARCHAR DEFAULT 'OPEN'",
        "closed_date": "VARCHAR",
        "closure_reason": "VARCHAR",
        "replacement_loan_id": "INTEGER",
        "loan_group_id": "VARCHAR",
        "servicer_sequence": "INTEGER",
        "servicer_start_date": "VARCHAR",
        "servicer_end_date": "VARCHAR",
        "transfer_reason": "VARCHAR",
        "is_current_servicer": "BOOLEAN DEFAULT 1",
        "account_number": "VARCHAR",
"borrowers": "VARCHAR",
"principal_due": "FLOAT",
"interest_due": "FLOAT",
"statement_date": "VARCHAR",
"payment_due_date": "VARCHAR",
"mortgage_tenure_covered": "VARCHAR",
"interest_paid_ytd": "FLOAT DEFAULT 0.0",
"principal_paid_ytd": "FLOAT DEFAULT 0.0",
"projected_principal_fy": "FLOAT DEFAULT 0.0",
        "projected_interest_fy": "FLOAT DEFAULT 0.0",
        "estimated_total_monthly_payment": "FLOAT DEFAULT 0.0",
        "extra_monthly_payment": "FLOAT DEFAULT 0.0",
        "original_ltv": "FLOAT DEFAULT 0.0",
	"escrow_included": "BOOLEAN DEFAULT 0",
	"monthly_property_tax_escrow": "FLOAT DEFAULT 0.0",
	"monthly_insurance_escrow": "FLOAT DEFAULT 0.0",
	"monthly_mortgage_insurance": "FLOAT DEFAULT 0.0",
	"monthly_other_escrow": "FLOAT DEFAULT 0.0",
	"source_document_id": "INTEGER",
	"source_type": "VARCHAR",
	"import_status": "VARCHAR",
	"current_balance_source": "VARCHAR",
	"current_balance_as_of": "VARCHAR",
	"current_balance_verified": "BOOLEAN DEFAULT 1",
        "purpose": "VARCHAR",
        "disbursement_date": "VARCHAR",
        "balance_as_of": "VARCHAR",
        "lender_at_origination": "VARCHAR",
        "current_servicer": "VARCHAR",
        "refinanced_into_loan_id": "INTEGER",
        "refinanced_from_loan_id": "INTEGER",
        "resolution_confidence": "FLOAT DEFAULT 0.0",
	},
    "property_transactions": {
        "resolution_key": "VARCHAR",
    },
    "annual_expenses": {
        "property_tax_source": "VARCHAR DEFAULT 'manual'",
        "insurance_source": "VARCHAR DEFAULT 'manual'",
    },
    "escrow_payments": {
        "servicer": "VARCHAR",
        "principal_interest_payment": "FLOAT",
        "current_total_payment": "FLOAT",
        "new_total_payment": "FLOAT",
        "projected_monthly_escrow": "FLOAT",
        "refund_amount": "FLOAT",
        "projected_minimum_balance": "FLOAT",
        "required_minimum_balance": "FLOAT",
        "escrow_cushion": "FLOAT",
        "selected_payment_option": "VARCHAR",
        "estimated_total_disbursement": "FLOAT",
        "actual_total_disbursement": "FLOAT",
    },
	}

TABLE_MIGRATIONS = [
    """
    CREATE TABLE IF NOT EXISTS property_tax_records (
        id VARCHAR PRIMARY KEY,
        property_id INTEGER,
        candidate_property_id INTEGER,
        owner_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL UNIQUE,
        document_type VARCHAR NOT NULL,
        tax_type VARCHAR NOT NULL,
        issuer VARCHAR,
        property_address VARCHAR,
        parcel_number VARCHAR,
        tracer_number VARCHAR,
        tax_rate_area VARCHAR,
        fiscal_year_label VARCHAR,
        fiscal_period_start VARCHAR,
        fiscal_period_end VARCHAR,
        event_type VARCHAR,
        event_date VARCHAR,
        supplemental_assessment NUMERIC(18,2),
        total_tax_rate_percent NUMERIC(12,6),
        proration_percent NUMERIC(12,6),
        tax_before_proration NUMERIC(18,2),
        total_amount_billed NUMERIC(18,2),
        payment_status VARCHAR,
        identity_key VARCHAR NOT NULL,
        related_event_key VARCHAR,
        structured_json TEXT NOT NULL DEFAULT '{}',
        validation_json TEXT NOT NULL DEFAULT '{}',
        parser_name VARCHAR,
        parser_version VARCHAR,
        classification_confidence FLOAT DEFAULT 0.0,
        property_match_confidence FLOAT DEFAULT 0.0,
        property_match_status VARCHAR DEFAULT 'MATCHED',
        status VARCHAR DEFAULT 'READY',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(property_id) REFERENCES properties(id),
        FOREIGN KEY(candidate_property_id) REFERENCES properties(id),
        FOREIGN KEY(owner_id) REFERENCES users(id),
        FOREIGN KEY(document_id) REFERENCES documents(id),
        UNIQUE(owner_id, identity_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS property_tax_corrections (
        id VARCHAR PRIMARY KEY,
        property_tax_record_id VARCHAR NOT NULL,
        owner_id INTEGER NOT NULL,
        field_path VARCHAR NOT NULL,
        original_value_json TEXT,
        corrected_value_json TEXT,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(property_tax_record_id) REFERENCES property_tax_records(id),
        FOREIGN KEY(owner_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS property_transactions (
        id VARCHAR PRIMARY KEY,
        property_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        resolution_key VARCHAR,
        transaction_type VARCHAR NOT NULL,
        purpose VARCHAR NOT NULL,
        closing_date VARCHAR,
        disbursement_date VARCHAR,
        purchase_price FLOAT,
        appraised_value FLOAT,
        borrower_paid_closing_costs FLOAT,
        down_payment FLOAT,
        cash_to_close FLOAT,
        deposit_paid_before_closing FLOAT,
        total_due_from_borrower FLOAT,
        total_paid_on_behalf_of_borrower FLOAT,
        settlement_debit_total FLOAT,
        settlement_credit_total FLOAT,
        seller_credits FLOAT,
        tax_prorations FLOAT,
        hoa_prorations FLOAT,
        confidence FLOAT DEFAULT 0.0,
        status VARCHAR DEFAULT 'RESOLVED',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(owner_id) REFERENCES users (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS transaction_document_links (
        id VARCHAR PRIMARY KEY,
        transaction_id VARCHAR NOT NULL,
        document_id INTEGER NOT NULL,
        source_role VARCHAR,
        source_priority INTEGER DEFAULT 99,
        fields_used TEXT DEFAULT '[]',
        match_confidence FLOAT DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(transaction_id) REFERENCES property_transactions (id),
        FOREIGN KEY(document_id) REFERENCES documents (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS transaction_loan_links (
        id VARCHAR PRIMARY KEY,
        transaction_id VARCHAR NOT NULL,
        loan_id INTEGER NOT NULL,
        role VARCHAR DEFAULT 'ORIGINATED_DEBT',
        lien_position INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(transaction_id) REFERENCES property_transactions (id),
        FOREIGN KEY(loan_id) REFERENCES loans (id),
        UNIQUE(transaction_id, loan_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS loan_servicer_segments (
        id VARCHAR PRIMARY KEY,
        loan_id INTEGER NOT NULL,
        servicer VARCHAR,
        account_number VARCHAR,
        normalized_account_number VARCHAR NOT NULL DEFAULT '',
        from_date VARCHAR NOT NULL DEFAULT '',
        to_date VARCHAR,
        is_current BOOLEAN DEFAULT 1,
        source_document_id INTEGER,
        confidence FLOAT DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(loan_id) REFERENCES loans (id),
        FOREIGN KEY(source_document_id) REFERENCES documents (id),
        UNIQUE(loan_id, normalized_account_number, from_date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS loan_document_links (
        id VARCHAR PRIMARY KEY,
        loan_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        source_role VARCHAR,
        fields_used TEXT DEFAULT '[]',
        priority INTEGER DEFAULT 99,
        confidence FLOAT DEFAULT 0.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(loan_id) REFERENCES loans (id),
        FOREIGN KEY(document_id) REFERENCES documents (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS loan_balance_snapshots (
        id VARCHAR PRIMARY KEY,
        loan_id INTEGER NOT NULL,
        property_id INTEGER NOT NULL,
        as_of_date VARCHAR NOT NULL,
        balance FLOAT,
        principal_paid_ytd FLOAT,
        interest_paid_ytd FLOAT,
        payment FLOAT,
        source_document_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(loan_id) REFERENCES loans (id),
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(source_document_id) REFERENCES documents (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS loan_resolution_discrepancies (
        id VARCHAR PRIMARY KEY,
        property_id INTEGER NOT NULL,
        loan_id INTEGER,
        transaction_id VARCHAR,
        field_name VARCHAR NOT NULL,
        selected_value TEXT,
        conflicting_value TEXT,
        selected_document_id INTEGER,
        conflicting_document_id INTEGER,
        difference FLOAT,
        status VARCHAR DEFAULT 'OPEN',
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(loan_id) REFERENCES loans (id),
        FOREIGN KEY(transaction_id) REFERENCES property_transactions (id),
        FOREIGN KEY(selected_document_id) REFERENCES documents (id),
        FOREIGN KEY(conflicting_document_id) REFERENCES documents (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS loan_resolution_aliases (
        id VARCHAR PRIMARY KEY,
        property_id INTEGER NOT NULL,
        old_loan_id INTEGER NOT NULL,
        canonical_loan_id INTEGER NOT NULL,
        reason VARCHAR,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(canonical_loan_id) REFERENCES loans (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS escrow_payments (
        id VARCHAR PRIMARY KEY,
        property_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        loan_id INTEGER,
        document_id INTEGER NOT NULL UNIQUE,
        loan_number VARCHAR,
        property_address VARCHAR,
        statement_date VARCHAR,
        effective_date VARCHAR,
        history_period_start VARCHAR,
        history_period_end VARCHAR,
        projection_period_start VARCHAR,
        projection_period_end VARCHAR,
        expense_year INTEGER,
        current_escrow_payment FLOAT,
        new_escrow_payment FLOAT,
        estimated_tax FLOAT,
        actual_tax FLOAT,
        estimated_insurance FLOAT,
        actual_insurance FLOAT,
        projected_tax FLOAT,
        projected_insurance FLOAT,
        projected_total FLOAT,
        shortage_amount FLOAT,
        overage_amount FLOAT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(loan_id) REFERENCES loans (id),
        FOREIGN KEY(document_id) REFERENCES documents (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS annual_expenses (
        id INTEGER PRIMARY KEY,
        property_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        year INTEGER NOT NULL,
        property_tax FLOAT DEFAULT 0.0,
        insurance FLOAT DEFAULT 0.0,
        hoa FLOAT DEFAULT 0.0,
        repairs_maintenance FLOAT DEFAULT 0.0,
        property_management FLOAT DEFAULT 0.0,
        utilities FLOAT DEFAULT 0.0,
        vacancy_allowance FLOAT DEFAULT 0.0,
        capex_reserve FLOAT DEFAULT 0.0,
        other FLOAT DEFAULT 0.0,
        property_tax_source VARCHAR DEFAULT 'manual',
        insurance_source VARCHAR DEFAULT 'manual',
        source_status VARCHAR DEFAULT 'manual',
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(property_id) REFERENCES properties (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS escrow_activities (
        id VARCHAR PRIMARY KEY,
        escrow_payment_id VARCHAR NOT NULL,
        property_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        document_id INTEGER NOT NULL,
        activity_date VARCHAR,
        activity_type VARCHAR,
        source_description VARCHAR,
        phase VARCHAR,
        value_status VARCHAR,
        estimated_deposit FLOAT,
        actual_deposit FLOAT,
        estimated_disbursement FLOAT,
        actual_disbursement FLOAT,
        estimated_balance FLOAT,
        actual_balance FLOAT,
        required_balance FLOAT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(escrow_payment_id) REFERENCES escrow_payments (id),
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(document_id) REFERENCES documents (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS annual_expense_metrics (
        id VARCHAR PRIMARY KEY,
        property_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        year INTEGER NOT NULL,
        expense_type VARCHAR NOT NULL,
        value FLOAT,
        status VARCHAR,
        completeness VARCHAR,
        source_type VARCHAR,
        source_label VARCHAR,
        allocation_method VARCHAR,
        coverage_json TEXT DEFAULT '{}',
        formula TEXT,
        inputs_json TEXT DEFAULT '[]',
        computation TEXT,
        document_ids_json TEXT DEFAULT '[]',
        supporting_document_ids_json TEXT DEFAULT '[]',
        discrepancies_json TEXT DEFAULT '[]',
        excluded_rows_json TEXT DEFAULT '[]',
        confidence FLOAT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(property_id) REFERENCES properties (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS usage_periods (
        id INTEGER PRIMARY KEY,
        property_id INTEGER NOT NULL,
        usage_type VARCHAR NOT NULL,
        start_date VARCHAR NOT NULL,
        end_date VARCHAR,
        fmv_at_start FLOAT DEFAULT 0.0,
        monthly_rent FLOAT DEFAULT 0.0,
        vacancy_allowance FLOAT DEFAULT 0.0,
        property_management_fee FLOAT DEFAULT 0.0,
        accumulated_depreciation_at_start FLOAT DEFAULT 0.0,
        suspended_losses_at_start FLOAT DEFAULT 0.0,
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY(property_id) REFERENCES properties (id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS metric_snapshots (
        id INTEGER PRIMARY KEY,
        property_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        snapshot_uuid VARCHAR NOT NULL UNIQUE,
        snapshot_type VARCHAR NOT NULL,
        schema_version VARCHAR,
        payload_json TEXT NOT NULL,
        generated_at VARCHAR,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(property_id) REFERENCES properties (id),
        FOREIGN KEY(owner_id) REFERENCES users (id)
    )
    """,
]
with engine.connect() as conn:
    for ddl in TABLE_MIGRATIONS:
        conn.execute(text(ddl))
    for table, columns in MIGRATIONS.items():
        existing = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))]
        for col, ddl in columns.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
    conn.commit()

# Refinance describes why a debt closed; it is not a separate lifecycle state.
# Keep this idempotent so legacy databases are normalized on every deployment.
with engine.connect() as conn:
    conn.execute(text("""
        UPDATE loans
        SET status = 'CLOSED',
            closure_reason = CASE
                WHEN upper(status) = 'REFINANCED'
                  OR refinanced_into_loan_id IS NOT NULL
                  OR lower(coalesce(transfer_reason, '')) = 'refinanced'
                THEN 'Refinanced'
                WHEN closure_reason IS NULL OR trim(closure_reason) = '' THEN 'Closed'
                ELSE closure_reason
            END
        WHERE upper(status) = 'REFINANCED'
           OR (
                upper(status) = 'CLOSED'
                AND (
                    refinanced_into_loan_id IS NOT NULL
                    OR lower(coalesce(transfer_reason, '')) = 'refinanced'
                )
                AND lower(coalesce(closure_reason, '')) <> 'servicing transfer'
           )
    """))
    conn.commit()

with engine.connect() as conn:
    rows = conn.execute(text("""
        SELECT id, address, property_uid, name
        FROM properties
        WHERE property_uid IS NULL OR property_uid = '' OR name IS NULL OR name = ''
           OR name = address
           OR name = substr(address, 1, instr(address || ',', ',') - 1)
    """)).fetchall()
    for row in rows:
        property_uid = row.property_uid or str(uuid.uuid4())
        name = _default_property_name(row.id)
        conn.execute(
            text("UPDATE properties SET property_uid = :property_uid, name = :name WHERE id = :id"),
            {"property_uid": property_uid, "name": name, "id": row.id},
        )
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_properties_property_uid ON properties(property_uid)"
    ))
    conn.commit()

with engine.connect() as conn:
    rows = conn.execute(text("""
        SELECT id, property_type, property_type_raw
        FROM properties
        WHERE property_type IS NULL
           OR property_type = ''
           OR property_type NOT IN (
                'single_family', 'condominium', 'townhouse', 'duplex',
                'triplex', 'fourplex', 'multi_family', 'apartment',
                'manufactured_home', 'mobile_home', 'cooperative',
                'vacation_home', 'mixed_use_property', 'commercial_residential',
                'land', 'other'
           )
    """)).fetchall()
    for row in rows:
        raw_type = row.property_type or ""
        canonical = _canonical_property_type(raw_type)
        raw_value = row.property_type_raw
        if canonical == "other" and raw_type and raw_type.strip().lower() != "other":
            raw_value = raw_value or raw_type
        conn.execute(
            text("UPDATE properties SET property_type = :property_type, property_type_raw = :property_type_raw WHERE id = :id"),
            {"property_type": canonical, "property_type_raw": raw_value, "id": row.id},
        )
    conn.commit()

# Migration: make documents.property_id nullable and add owner_id.
# SQLite cannot ALTER a column constraint, so we rename → recreate → copy → drop.
with engine.connect() as conn:
    doc_cols = {row[1]: row[3] for row in conn.execute(text("PRAGMA table_info(documents)"))}
    # row[3] is "notnull": 1 = NOT NULL, 0 = nullable
    needs_migration = doc_cols.get("property_id", 0) == 1 or "owner_id" not in doc_cols
    if needs_migration:
        if "owner_id" not in doc_cols:
            conn.execute(text("ALTER TABLE documents ADD COLUMN owner_id INTEGER"))
        conn.execute(text("""
            UPDATE documents SET owner_id = (
                SELECT p.owner_id FROM properties p WHERE p.id = documents.property_id
            ) WHERE owner_id IS NULL
        """))
        # Fallback for any orphaned docs
        conn.execute(text("""
            UPDATE documents SET owner_id = (SELECT id FROM users ORDER BY id LIMIT 1)
            WHERE owner_id IS NULL
        """))
        conn.commit()
        if doc_cols.get("property_id", 0) == 1:
            conn.execute(text("ALTER TABLE documents RENAME TO _documents_old"))
            conn.execute(text("""
                CREATE TABLE documents (
                    id INTEGER PRIMARY KEY,
                    property_id INTEGER REFERENCES properties(id),
        owner_id INTEGER NOT NULL REFERENCES users(id),
        filename VARCHAR NOT NULL,
        original_filename VARCHAR NOT NULL,
        record_uuid VARCHAR,
        file_type VARCHAR,
                    doc_category VARCHAR,
                    file_size INTEGER,
                    extracted_data TEXT,
                    markdown_file VARCHAR,
                    loan_account_number VARCHAR,
                    statement_year INTEGER,
                    period_type VARCHAR DEFAULT 'other',
                    period_start VARCHAR,
                    period_end VARCHAR,
                    display_name VARCHAR,
                    content_hash VARCHAR,
                    content_fingerprint VARCHAR,
                    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("""
                INSERT INTO documents
        (id, property_id, owner_id, filename, original_filename, record_uuid,
         file_type, doc_category, file_size, extracted_data, markdown_file,
         loan_account_number, statement_year, period_type,
         period_start, period_end, upload_date)
      SELECT
        id, property_id, owner_id, filename, original_filename, record_uuid,
        file_type, doc_category, file_size, extracted_data, markdown_file,
                    loan_account_number, statement_year, period_type,
                    period_start, period_end, upload_date
                FROM _documents_old
            """))
            conn.execute(text("DROP TABLE _documents_old"))
            conn.commit()

app = FastAPI(
    title="PropertyLens API",
    description="Real Estate Consolidation & Analytics Platform",
    version="1.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5177", "http://localhost:3000", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(properties.router)
app.include_router(documents.router)
app.include_router(documents.property_tax_router)
app.include_router(sharing.router)
app.include_router(help_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "PropertyLens API"}


# Serve production frontend
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("uploads/"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        file = FRONTEND_DIST / full_path
        if file.is_file():
            return FileResponse(str(file))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
