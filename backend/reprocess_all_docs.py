"""
Reprocess all uploaded documents for all users.
Run from the backend/ directory:
    source venv/bin/activate && python3 reprocess_all_docs.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
from pathlib import Path
from database import SessionLocal
import models
from services.document_parser import parse_document
from routers.documents import _apply_extracted, _parse_date
from routers.properties import import_tax_return
import json

UPLOAD_DIR = Path(__file__).parent / "uploads"


async def main():
    db = SessionLocal()

    try:
        users = db.query(models.User).all()
        print(f"Found {len(users)} users\n")

        grand_total = 0
        grand_errors = []

        for user in users:
            docs = db.query(models.Document).filter(models.Document.owner_id == user.id).all()
            print(f"=== User: {user.email} ({len(docs)} documents) ===")

            reprocessed = 0
            errors = []
            categories: dict[str, int] = {}
            by_property: dict = {}
            common_tax_returns = []

            for doc in docs:
                path = UPLOAD_DIR / doc.filename
                if not path.exists():
                    errors.append(f"  MISSING FILE: doc_id={doc.id} file={doc.original_filename}")
                    continue
                try:
                    category, extracted, markdown = parse_document(str(path), "auto")
                except Exception as e:
                    errors.append(f"  PARSE ERROR: doc_id={doc.id} file={doc.original_filename}: {e}")
                    continue

                doc.doc_category = category
                doc.extracted_data = json.dumps(extracted)
                doc.loan_account_number = (extracted.get("account_number") or "").strip() or None
                doc.statement_year = extracted.get("statement_year")
                doc.period_type = extracted.get("period_type", "other")
                doc.period_start = extracted.get("period_start") or extracted.get("statement_date")
                doc.period_end = extracted.get("period_end") or extracted.get("statement_date")

                if markdown:
                    markdown_name = doc.markdown_file or f"{Path(doc.filename).stem}.md"
                    (UPLOAD_DIR / markdown_name).write_text(markdown)
                    doc.markdown_file = markdown_name

                reprocessed += 1
                categories[category] = categories.get(category, 0) + 1

                if doc.property:
                    by_property.setdefault(doc.property, []).append(extracted)
                elif category == "tax_return":
                    common_tax_returns.append((doc.id, str(path)))

            # Re-apply property docs in chronological order
            for prop, extracted_list in by_property.items():
                extracted_list.sort(
                    key=lambda d: _parse_date(d.get("statement_date")) or _parse_date("01/01/1900")
                )
                for data in extracted_list:
                    _apply_extracted(db, prop, data)

            db.commit()

            # Re-import common (property-agnostic) tax returns
            for doc_id, fpath in common_tax_returns:
                try:
                    await import_tax_return(db, user.id, doc_id, fpath)
                except Exception as e:
                    errors.append(f"  TAX IMPORT ERROR: doc_id={doc_id}: {e}")

            print(f"  Reprocessed: {reprocessed} / {len(docs)}")
            print(f"  By category: {categories}")
            if errors:
                print("  Errors:")
                for e in errors:
                    print(e)
            else:
                print("  No errors.")
            print()

            grand_total += reprocessed
            grand_errors.extend(errors)

        print(f"=== DONE: {grand_total} documents reprocessed ===")
        if grand_errors:
            print(f"{len(grand_errors)} error(s):")
            for e in grand_errors:
                print(e)

    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
