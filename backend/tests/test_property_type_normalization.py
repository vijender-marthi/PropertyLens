from routers.properties import _normalize_property_type


def test_property_type_legacy_labels_normalize_to_stable_keys():
    data = {"property_type": "SFR", "property_type_raw": None}

    _normalize_property_type(data)

    assert data["property_type"] == "single_family"
    assert data["property_type_raw"] == ""


def test_property_type_unknown_values_preserve_raw_label():
    data = {"property_type": "Carriage House", "property_type_raw": None}

    _normalize_property_type(data)

    assert data["property_type"] == "other"
    assert data["property_type_raw"] == "Carriage House"


def test_property_type_other_preserves_entered_supporting_text():
    data = {"property_type": "other", "property_type_raw": "Guest house"}

    _normalize_property_type(data)

    assert data["property_type"] == "other"
    assert data["property_type_raw"] == "Guest house"
