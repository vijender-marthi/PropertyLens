"""One-time backfill: rebuild Schedule E (TaxReturnEntry) rows from each tax
return document's already-stored ``extracted_data``.

Why this exists
---------------
Historically ``Property.tax_entries`` used a ``delete-orphan`` cascade, so any
time a filed Schedule E row lost its link to a property, SQLAlchemy silently
DELETED it — wiping the Tax Center's "filed" column even though the source
document (and its correct parsed ``extracted_data``) was still on file. That
cascade is fixed in ``models.py``, but returns uploaded *before* the fix have no
rows left. This script re-persists them from the stored parse — no re-upload,
no re-parse of the PDF (which is discarded after upload anyway).

It is idempotent: ``import_tax_return_from_parsed`` upserts on
owner/year/property, so running it twice will not create duplicates.

Run it with the fixed code active (i.e. after these changes are deployed and the
API server has reloaded), so freshly-restored rows are not wiped again:

    cd backend
    python backfill_schedule_e.py            # backfill every owner
    python backfill_schedule_e.py --owner 1  # a single owner
    python backfill_schedule_e.py --dry-run  # report only, write nothing

Always back up the DB first (it prints the path it is writing to).
"""
import argparse
import json
from collections import Counter

from database import SessionLocal, DB_PATH
import models
from routers.properties import import_tax_return_from_parsed


def backfill(owner_id=None, dry_run=False):
    db = SessionLocal()
    try:
        q = db.query(models.Document).filter(models.Document.doc_category == "tax_return")
        if owner_id is not None:
            q = q.filter(models.Document.owner_id == owner_id)
        docs = q.order_by(models.Document.id).all()

        print(f"Database: {DB_PATH}")
        print(f"{'DRY RUN — ' if dry_run else ''}backfilling {len(docs)} tax-return document(s)\n")

        total = 0
        for doc in docs:
            data = json.loads(doc.extracted_data or "{}")
            if not data.get("properties"):
                print(f"  doc {doc.id} ({doc.statement_year}): no stored Schedule E rows — skipped")
                continue
            try:
                n = import_tax_return_from_parsed(db, doc.owner_id, doc.id, data)
                total += n
                print(f"  doc {doc.id} ({doc.statement_year}): {'would import' if dry_run else 'imported'} {n} row(s)")
            except Exception as exc:  # noqa: BLE001 — report and continue
                print(f"  doc {doc.id} ({doc.statement_year}): ERROR {type(exc).__name__}: {exc}")

        if dry_run:
            db.rollback()

        rows = db.query(models.TaxReturnEntry)
        if owner_id is not None:
            rows = rows.filter(models.TaxReturnEntry.owner_id == owner_id)
        rows = rows.all()
        by_year = Counter(r.tax_year for r in rows)
        matched = Counter(r.tax_year for r in rows if r.property_id)
        print("\nSchedule E entries by year (matched / total):")
        for y in sorted(by_year):
            print(f"   {y}: {matched[y]}/{by_year[y]}")
        print(f"\n{'Would import' if dry_run else 'Imported'} {total} row(s) total.")
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--owner", type=int, default=None, help="Restrict to one owner_id")
    ap.add_argument("--dry-run", action="store_true", help="Report only; write nothing")
    args = ap.parse_args()
    backfill(owner_id=args.owner, dry_run=args.dry_run)
