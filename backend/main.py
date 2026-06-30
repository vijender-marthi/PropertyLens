from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy import text
import models
from database import engine
from routers import auth, properties, documents, sharing

# Create tables
models.Base.metadata.create_all(bind=engine)

# Lightweight migrations for columns added after the initial schema
MIGRATIONS = {
    "properties": {
        "usage_type": "VARCHAR DEFAULT 'Rental'",
        "vacancy_allowance": "FLOAT DEFAULT 0.0",
        "capex_reserve": "FLOAT DEFAULT 0.0",
        "land_price": "FLOAT DEFAULT 0.0",
        "construction_price": "FLOAT DEFAULT 0.0",
    },
    "documents": {
        "markdown_file": "VARCHAR",
        "loan_account_number": "VARCHAR",
        "statement_year": "INTEGER",
        "period_type": "VARCHAR DEFAULT 'other'",
        "period_start": "VARCHAR",
        "period_end": "VARCHAR",
    },
    "tax_return_entries": {
        "days_rented": "INTEGER DEFAULT 0",
        "personal_use_days": "INTEGER DEFAULT 0",
    },
    "loans": {
        "rate_note": "VARCHAR",
        "account_number": "VARCHAR",
        "borrowers": "VARCHAR",
        "principal_due": "FLOAT",
        "interest_due": "FLOAT",
        "statement_date": "VARCHAR",
        "payment_due_date": "VARCHAR",
    },
}
with engine.connect() as conn:
    for table, columns in MIGRATIONS.items():
        existing = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))]
        for col, ddl in columns.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
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
                    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("""
                INSERT INTO documents
                    (id, property_id, owner_id, filename, original_filename,
                     file_type, doc_category, file_size, extracted_data, markdown_file,
                     loan_account_number, statement_year, period_type,
                     period_start, period_end, upload_date)
                SELECT
                    id, property_id, owner_id, filename, original_filename,
                    file_type, doc_category, file_size, extracted_data, markdown_file,
                    loan_account_number, statement_year, period_type,
                    period_start, period_end, upload_date
                FROM _documents_old
            """))
            conn.execute(text("DROP TABLE _documents_old"))
            conn.commit()

app = FastAPI(
    title="RentalProps API",
    description="Real Estate Consolidation & Analytics Platform",
    version="1.0.0",
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


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "RentalProps API"}


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
