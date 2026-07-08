import models
from tests.conftest import auth_headers


def test_duplicate_upload_hash_is_content_based(tmp_path):
    from routers.documents import _file_hash

    first = tmp_path / "statement-a.pdf"
    second = tmp_path / "renamed-statement.pdf"
    first.write_bytes(b"same mortgage statement bytes")
    second.write_bytes(b"same mortgage statement bytes")

    assert _file_hash(first) == _file_hash(second)


def test_tax_return_upload_reports_import_error(client, db, user, monkeypatch):
    from routers import documents as documents_router

    def fake_parse_document(path, category):
        return (
            "tax_return",
            {
                "tax_year": 2025,
                "statement_year": 2025,
                "property_count": 1,
                "rental_count": 1,
                "period_type": "yearly",
            },
            "",
        )

    def fake_import_tax_return(db, owner_id, document_id, filepath):
        raise ValueError("Schedule E rows could not be matched")

    monkeypatch.setattr(documents_router, "parse_document", fake_parse_document)
    monkeypatch.setattr(documents_router, "import_tax_return", fake_import_tax_return)

    resp = client.post(
        "/api/documents/upload",
        data={"category": "tax_return"},
        files={"file": ("return.pdf", b"%PDF fake tax return", "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["category"] == "tax_return"
    assert body["tax_entries_imported"] == 0
    assert body["tax_import_error"] == "Schedule E rows could not be matched"

    doc = db.query(models.Document).filter_by(owner_id=user.id).one()
    assert doc.doc_category == "tax_return"


def test_tax_return_upload_parse_failure_returns_422(client, db, user, monkeypatch):
    from routers import documents as documents_router

    def fake_parse_document(path, category):
        raise RuntimeError("PDF text could not be extracted")

    monkeypatch.setattr(documents_router, "parse_document", fake_parse_document)

    resp = client.post(
        "/api/documents/upload",
        data={"category": "tax_return"},
        files={"file": ("return.pdf", b"%PDF fake tax return", "application/pdf")},
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tax return parse failed: PDF text could not be extracted"
    assert db.query(models.Document).count() == 0
