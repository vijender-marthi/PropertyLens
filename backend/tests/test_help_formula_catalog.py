from services.formula_catalog import FORMULA_DEFINITIONS


def test_help_formula_catalog_returns_required_pages(client):
    response = client.get("/api/help/formulas")

    assert response.status_code == 200
    payload = response.json()
    page_keys = {page["pageKey"] for page in payload["pages"]}
    assert {
        "summary",
        "loans",
        "rental",
        "expenses",
        "taxes",
        "depreciation",
        "scenarios",
        "portfolio",
        "documents",
        "reconciliation",
        "conventions",
    }.issubset(page_keys)
    assert payload["version"] == "v1"
    assert payload["formulas"]


def test_formula_definitions_have_stable_metric_keys_and_ids():
    keys = set()
    for formula in FORMULA_DEFINITIONS:
        assert formula["metricKey"]
        assert formula["formulaDefinitionId"] == f"{formula['metricKey']}:v1"
        assert formula["metricKey"] not in keys
        keys.add(formula["metricKey"])
        assert formula["name"]
        assert formula["shortDefinition"]
        assert formula["formulaLines"]
        assert formula["inputDefinitions"]
        assert formula["sourceType"] in {
            "reported",
            "calculated",
            "derived",
            "projected",
            "estimated",
            "manual",
            "mixed",
        }


def test_help_formula_catalog_filters_by_page(client):
    response = client.get("/api/help/formulas", params={"page": "loans"})

    assert response.status_code == 200
    formulas = response.json()["formulas"]
    assert formulas
    assert {formula["pageKey"] for formula in formulas} == {"loans"}
    assert any(formula["metricKey"] == "loan.current_balance" for formula in formulas)


def test_help_formula_catalog_searches_business_terms(client):
    response = client.get("/api/help/formulas", params={"q": "cash flow"})

    assert response.status_code == 200
    formulas = response.json()["formulas"]
    keys = {formula["metricKey"] for formula in formulas}
    assert "property.monthly_cash_flow" in keys
    assert "property.annual_cash_flow" in keys


def test_help_formula_catalog_filters_by_source_type(client):
    response = client.get("/api/help/formulas", params={"sourceType": "projected"})

    assert response.status_code == 200
    formulas = response.json()["formulas"]
    assert formulas
    assert all(formula["sourceType"] == "projected" for formula in formulas)
