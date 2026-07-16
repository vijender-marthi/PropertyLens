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
	},
    "annual_expenses": {
        "property_tax_source": "VARCHAR DEFAULT 'manual'",
        "insurance_source": "VARCHAR DEFAULT 'manual'",
    },
	}

TABLE_MIGRATIONS = [
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
