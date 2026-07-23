"""Reparse and resolve one property's acquisition and loan lifecycle.

Examples:
    python reprocess_property_lifecycle.py --property-id 19 \
        --source-archive /path/to/original/files
    python reprocess_property_lifecycle.py --all

The command is idempotent. Existing document IDs and original files are retained;
duplicate loan rows are merged through the canonical lifecycle resolver.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import models
from database import SessionLocal
from services.document_parser import parse_document
from services.loan_lifecycle import lifecycle_dto, resolve_property_lifecycle


UPLOAD_DIR = Path(__file__).parent / "uploads"


def _source_path(document: models.Document, source_archive: Path | None) -> Path | None:
    uploaded = UPLOAD_DIR / document.filename
    if uploaded.exists():
        return uploaded
    if source_archive and document.original_filename:
        archived = source_archive / document.original_filename
        if archived.exists():
            return archived
    return None


def _update_document(document: models.Document, source: Path) -> None:
    category, extracted, _markdown = parse_document(str(source), "auto")
    document.doc_category = category
    document.extracted_data = json.dumps(extracted)
    document.loan_account_number = (extracted.get("account_number") or "").strip() or None
    document.statement_year = extracted.get("statement_year")
    document.period_type = extracted.get("period_type", "other")
    document.period_start = extracted.get("period_start") or extracted.get("statement_date")
    document.period_end = extracted.get("period_end") or extracted.get("statement_date")


def _summary(prop: models.Property) -> dict:
    dto = lifecycle_dto(prop)
    return {
        "propertyId": prop.id,
        "property": prop.name,
        "acquisition": dto.get("acquisition"),
        "documentGroups": dto.get("documentGroups", []),
        "loans": dto.get("loans", []),
    }


def reprocess_property(
    db,
    prop: models.Property,
    *,
    source_archive: Path | None = None,
    reparse_documents: bool = True,
) -> dict:
    """Reparse available sources and rebuild one canonical lifecycle."""
    reparsed = []
    missing = []
    if reparse_documents:
        for document in prop.documents:
            source = _source_path(document, source_archive)
            if source is None:
                missing.append({"documentId": document.id, "filename": document.original_filename})
                continue
            _update_document(document, source)
            reparsed.append({"documentId": document.id, "filename": document.original_filename})

    db.flush()
    db.expire(prop, ["documents", "loans", "transactions"])
    result = resolve_property_lifecycle(db, prop)
    db.flush()
    db.expire(prop, ["documents", "loans", "transactions"])
    output = _summary(prop)
    output["reparsed"] = reparsed
    output["missingSourceFiles"] = missing
    output["resolvedLoanCount"] = len(result.get("loans", []))
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--property-id", type=int)
    scope.add_argument("--all", action="store_true")
    parser.add_argument("--source-archive", type=Path)
    parser.add_argument(
        "--skip-reparse",
        action="store_true",
        help="Resolve from stored extracted data without reparsing source files.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        query = db.query(models.Property).order_by(models.Property.id)
        if args.property_id is not None:
            query = query.filter(models.Property.id == args.property_id)
        properties = query.all()
        if not properties and args.property_id is not None:
            raise SystemExit(f"Property {args.property_id} was not found")

        results = []
        failures = []
        for prop in properties:
            try:
                output = reprocess_property(
                    db,
                    prop,
                    source_archive=args.source_archive,
                    reparse_documents=not args.skip_reparse,
                )
                results.append(output)
                if args.dry_run:
                    db.rollback()
                else:
                    db.commit()
            except Exception as exc:
                db.rollback()
                failures.append({"propertyId": prop.id, "error": str(exc)})

        print(json.dumps({
            "status": "completed" if not failures else "completed_with_errors",
            "dryRun": args.dry_run,
            "processedPropertyCount": len(results),
            "failedPropertyCount": len(failures),
            "properties": results,
            "failures": failures,
        }, indent=2, default=str))
        if failures:
            raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
