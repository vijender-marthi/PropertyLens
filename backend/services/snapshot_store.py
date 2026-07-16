from __future__ import annotations

import json
import uuid
from typing import Any, Dict

import models


RAW_RECORD_UUID_NAMESPACE = uuid.UUID("39fd6f11-5bd1-4de5-9d1c-e66e44218ce5")


def raw_record_uuid(*parts: Any) -> str:
    stable_key = ":".join(str(part or "none").strip().lower() for part in parts)
    return str(uuid.uuid5(RAW_RECORD_UUID_NAMESPACE, stable_key))


def ensure_document_record_uuid(document: models.Document) -> str:
    if not getattr(document, "record_uuid", None):
        document.record_uuid = raw_record_uuid("document", document.id, document.property_id, document.owner_id)
    return document.record_uuid


def ensure_tax_entry_record_uuid(entry: models.TaxReturnEntry) -> str:
    if not getattr(entry, "record_uuid", None):
        entry.record_uuid = raw_record_uuid(
            "schedule_e",
            entry.property_id,
            entry.tax_year,
            entry.document_id or "logical",
            entry.id,
        )
    return entry.record_uuid


def save_property_snapshot(
    db,
    *,
    prop: models.Property,
    snapshot_type: str,
    payload: Dict[str, Any],
) -> models.MetricSnapshot:
    snapshot = models.MetricSnapshot(
        property_id=prop.id,
        owner_id=prop.owner_id,
        snapshot_uuid=str(uuid.uuid4()),
        snapshot_type=snapshot_type,
        schema_version=payload.get("schemaVersion") or payload.get("schema_version"),
        payload_json=json.dumps(payload, default=str, sort_keys=True),
        generated_at=payload.get("generatedAt") or payload.get("generated_at"),
    )
    db.add(snapshot)
    db.flush()
    payload["snapshotUuid"] = snapshot.snapshot_uuid
    return snapshot
