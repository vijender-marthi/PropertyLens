"""Regression: filed Schedule E data must survive losing its property link.

A TaxReturnEntry is designed to outlive its property association — an unmatched
filed row is stored with property_id=NULL and surfaced in the Tax Center for the
user to assign later. Historically `Property.tax_entries` used a
`delete-orphan` cascade, so SQLAlchemy silently DELETED the filed row the moment
its property association was cleared (a re-import that no longer matched, or an
unassign), wiping the Tax Center's "filed" column. These tests lock in that the
row survives disassociation while still being cleaned up on property deletion.
"""
import json
import models


def _mk_entry(db, prop, user, year=2024):
    e = models.TaxReturnEntry(
        owner_id=user.id,
        property_id=prop.id,
        tax_year=year,
        address="123 Test St",
        property_kind="rental",
        rents_received=36000.0,
        net_income=5000.0,
        expense_breakdown=json.dumps({}),
    )
    db.add(e)
    db.commit()
    return e.id


def test_unmatch_via_fk_keeps_entry(db, prop, user):
    """Nulling the FK column (what _upsert_tax_entry does) keeps the row."""
    entry_id = _mk_entry(db, prop, user)
    rec = db.query(models.TaxReturnEntry).get(entry_id)
    _ = prop.tax_entries          # load the parent collection
    rec.property_id = None
    db.commit()
    assert db.query(models.TaxReturnEntry).get(entry_id) is not None


def test_unmatch_via_relationship_keeps_entry(db, prop, user):
    """Clearing the relationship attribute must NOT delete the filed row."""
    entry_id = _mk_entry(db, prop, user)
    rec = db.query(models.TaxReturnEntry).get(entry_id)
    parent = rec.property         # load many-to-one
    _ = parent.tax_entries        # load one-to-many
    rec.property = None           # clear the relationship attribute
    db.commit()
    assert db.query(models.TaxReturnEntry).get(entry_id) is not None, (
        "entry wiped by delete-orphan cascade on relationship clear"
    )


def test_property_delete_still_removes_entries(db, prop, user):
    """`cascade=all` must still delete tax entries when the PROPERTY is deleted."""
    entry_id = _mk_entry(db, prop, user)
    prop_obj = db.query(models.Property).get(prop.id)
    db.delete(prop_obj)
    db.commit()
    assert db.query(models.TaxReturnEntry).get(entry_id) is None, (
        "deleting the property should still remove its linked tax entries"
    )
