import json
import re

import models
from tests.conftest import auth_headers


def test_verification_response_is_page_ready(client, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data = resp.json()

    assert data["schemaVersion"]
    assert data["verificationRunId"]
    assert data["generatedAt"]
    assert data["summary"]["totalChecks"]["value"] == len(data["issues"])
    assert data["summary"]["totalChecks"]["display"]
    assert data["summary"]["discrepancyCount"]["display"]
    assert data["availableFilters"]["sortOptions"]
    assert data["defaultSortKey"] == "priority"

    issue = data["issues"][0]
    assert issue["id"]
    assert issue["code"]
    assert issue["title"]
    assert issue["description"]
    assert issue["status"]["key"] in {"passed", "failed", "warning", "not_evaluated"}
    assert issue["severity"]["key"] in {"critical", "warning", "info"}
    assert issue["severity"]["rank"] >= 1
    assert issue["category"]["key"]
    assert issue["comparison"]["primaryValue"]["display"]
    assert issue["comparison"]["secondaryValue"]["display"]
    assert "display" in issue["comparison"]["delta"]
    assert issue["whyItMatters"]
    assert issue["source"]["tabKey"]
    assert issue["confidence"]["key"]
    assert issue["provenance"]
    assert issue["technicalDetails"]
    assert "priority" in issue["sortKeys"]
    assert "yearAsc" in issue["sortKeys"]


def test_verification_sort_options_are_backend_owned(client, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )
    assert resp.status_code == 200
    data = resp.json()
    sort_options = data["availableFilters"]["sortOptions"]
    by_key = {option["key"]: option for option in sort_options}

    assert by_key["priority"]["direction"] == "asc"
    assert by_key["priority"]["valueType"] == "number"
    assert by_key["absoluteDelta"]["direction"] == "desc"
    assert by_key["year"]["label"] == "Newest year"
    assert by_key["year"]["direction"] == "desc"
    assert by_key["yearAsc"]["label"] == "Oldest year"
    assert by_key["yearAsc"]["direction"] == "asc"
    assert by_key["code"]["valueType"] == "string"

    for issue in data["issues"]:
        assert "yearAsc" in issue["sortKeys"]


def test_verification_summary_counts_are_backend_owned(client, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )

    data = resp.json()
    issues = data["issues"]
    passed = [issue for issue in issues if issue["status"]["key"] == "passed"]
    active = [issue for issue in issues if issue["status"]["key"] in {"failed", "warning"}]

    assert data["summary"]["passedChecks"]["value"] == len(passed)
    assert data["summary"]["discrepancyCount"]["value"] == len(active)
    assert data["summary"]["calculatedCount"]["value"] == len(issues)


def test_verification_snapshot_is_persisted(client, db, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    body = resp.json()
    snapshot = db.query(models.MetricSnapshot).filter_by(
        property_id=prop.id,
        snapshot_type="verification",
        snapshot_uuid=body["snapshotUuid"],
    ).first()
    assert snapshot is not None
    assert snapshot.schema_version == body["schemaVersion"]


def test_metric_vault_snapshot_is_persisted(client, db, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/metric-vault",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    body = resp.json()
    snapshot = db.query(models.MetricSnapshot).filter_by(
        property_id=prop.id,
        snapshot_type="metric_vault",
        snapshot_uuid=body["snapshotUuid"],
    ).first()
    assert snapshot is not None


def test_metric_vault_includes_backend_equity_story(client, db, user, prop):
    prop.purchase_price = 400_000
    prop.down_payment = 80_000
    prop.market_value = 500_000
    prop.loans[0].original_amount = 320_000
    prop.loans[0].current_balance = 300_000
    db.commit()

    resp = client.get(
        f"/api/properties/{prop.id}/metric-vault",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    story = resp.json()["charts"]["equityStory"]
    assert story["hero"]["value"] == 200_000
    assert story["hero"]["ownershipPercentDisplay"] == "40.00%"
    assert story["ownership"]["status"] == "available"
    assert sum(segment["value"] for segment in story["ownership"]["segments"]) == story["definitions"]["currentMarketValue"]
    assert story["waterfall"]["status"] == "available"
    assert [node["key"] for node in story["waterfall"]["series"]] == [
        "acquisitionCashContribution",
        "principalReductionSinceAcquisition",
        "currentPropertyDebt",
        "appreciation",
        "currentMarketValue",
    ]
    assert all(check["passes"] for check in story["waterfall"]["validation"]["checks"])



def test_metric_vault_equity_story_handles_negative_equity(client, db, user, prop):
    prop.purchase_price = 500_000
    prop.down_payment = 100_000
    prop.market_value = 450_000
    prop.loans[0].original_amount = 400_000
    prop.loans[0].current_balance = 500_000
    db.commit()

    resp = client.get(
        f"/api/properties/{prop.id}/metric-vault",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    story = resp.json()["charts"]["equityStory"]
    assert story["ownership"]["status"] == "negative_equity"
    assert "exceeds the estimated property value" in story["ownership"]["explanation"]
    assert story["ownership"]["comparison"][2]["key"] == "equityShortfall"


def test_metric_vault_equity_story_refinance_uses_purchase_debt_once(client, db, user, prop):
    prop.purchase_price = 400_000
    prop.down_payment = 80_000
    prop.market_value = 520_000
    prop.loans[0].loan_type = "REFINANCE"
    prop.loans[0].original_amount = 380_000
    prop.loans[0].current_balance = 310_000
    db.commit()

    resp = client.get(
        f"/api/properties/{prop.id}/metric-vault",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    story = resp.json()["charts"]["equityStory"]
    assert story["ownership"]["status"] == "available"
    assert story["waterfall"]["status"] == "available"
    assert story["definitions"]["acquisitionDebt"] == 320_000
    assert story["definitions"]["principalReductionSinceAcquisition"] == 10_000
    assert all(check["passes"] for check in story["waterfall"]["validation"]["checks"])


def test_verification_includes_backend_source_comparison_issues(client, db, user, prop):
    tax_entry = models.TaxReturnEntry(
        owner_id=user.id,
        property_id=prop.id,
        tax_year=2024,
        address=prop.address,
        property_kind="rental",
        rents_received=24_000,
        mortgage_interest=10_000,
        property_taxes=4_000,
        depreciation=6_000,
    )
    lease = models.RentalPeriod(
        property_id=prop.id,
        start_year=2024,
        start_month=1,
        end_year=2024,
        end_month=12,
        monthly_rent=3_000,
    )
    doc = models.Document(
        property_id=prop.id,
        owner_id=user.id,
        filename="1098_2024.pdf",
        original_filename="1098_2024.pdf",
        file_type="pdf",
        doc_category="1098",
        statement_year=2024,
        extracted_data=json.dumps({"tax_year": 2024, "mortgage_interest": 16_000, "current_balance": 290_000}),
        loan_account_number="ACCT-1",
    )
    db.add_all([tax_entry, lease, doc])
    db.commit()

    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    issues = resp.json()["issues"]
    codes = {issue["code"] for issue in issues}
    assert "SRC.rent.2024" in codes
    assert "SRC.interest.2024" in codes

    rent_issue = next(issue for issue in issues if issue["code"] == "SRC.rent.2024")
    assert rent_issue["category"]["key"] == "source_comparison"
    assert rent_issue["comparison"]["primaryValue"]["display"] == "$24,000"
    assert rent_issue["comparison"]["secondaryValue"]["display"] == "$36,000"
    assert rent_issue["source"]["tabKey"] == "usage"


def test_data_health_contract_is_customer_facing(client, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data_health = resp.json()["dataHealth"]

    assert data_health["title"] == "Data Health"
    assert data_health["subtitle"] == "See what is complete, what needs review, and what is missing."
    assert data_health["summary"]["status"]
    assert data_health["summary"]["checksPassed"]["display"]
    assert data_health["fastestFix"]["rootCauseIssueId"]
    assert data_health["fastestFix"]["primaryAction"]["label"]

    assert [group["key"] for group in data_health["groups"]] == [
        "must_fix",
        "review",
        "missing_documents",
        "looks_good",
    ]

    issues = [issue for group in data_health["groups"] for issue in group["issues"]]
    assert issues
    issue = issues[0]
    assert issue["title"]
    assert not re.match(r"^(A\d+|L\d+|SRC\.)", issue["title"])
    assert issue["primaryAction"]["label"]
    assert issue["primaryAction"]["tabKey"]
    assert issue["recommendedSteps"]
    assert "ruleCode" in issue["technical"]
    assert "assertion" in issue["technical"]


def test_data_health_technical_codes_stay_in_metadata(client, user, prop):
    resp = client.get(
        f"/api/properties/{prop.id}/verification",
        headers=auth_headers(user.email),
    )

    assert resp.status_code == 200
    data_health = resp.json()["dataHealth"]
    issues = [issue for group in data_health["groups"] for issue in group["issues"]]

    for issue in issues:
        normal_text = " ".join(
            str(issue.get(key) or "")
            for key in ["title", "summary", "shortExplanation", "whyItMatters", "status"]
        )
        assert "SRC." not in normal_text
        assert "Metric Vault" not in normal_text
        assert "Backend verification engine" not in normal_text
        assert issue["technical"].get("ruleCode")
