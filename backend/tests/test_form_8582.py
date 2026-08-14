import models
from tests.conftest import auth_headers
from routers.properties import _special_allowance


def test_special_allowance_phaseout():
    assert _special_allowance(0) == 25000
    assert _special_allowance(100000) == 25000
    assert _special_allowance(130000) == 10000     # 25000 - 50% of 30000
    assert _special_allowance(150000) == 0
    assert _special_allowance(200000) == 0


def test_form_8582_rolls_passive_losses_forward(client, db, user):
    # Low rent + full depreciation ⇒ a passive loss the special allowance limits.
    prop = models.Property(
        owner_id=user.id,
        property_uid="f8582-loss-test",
        name="Loss Lane",
        address="1 Loss Lane",
        city="Scottsdale",
        state="AZ",
        purchase_date="2022-05-10",
        purchase_price=625_000,
        market_value=700_000,
        monthly_rent=1_500,
        occupancy_rate=100,
        property_tax=6_000,
        insurance=1_200,
        hoa_history="[]",
        hoa_special_assessment=0,
        solar_ownership="None",
        solar_monthly_payment=0,
        solar_purchase_price=0,
        land_value=0,
        depreciation_years=27.5,
        usage_type="Rental",
    )
    db.add(prop)
    db.commit()

    resp = client.get(
        "/api/properties/analysis/form-8582?magi=130000",
        headers=auth_headers(user.email),
    )
    assert resp.status_code == 200
    data = resp.json()

    assert data["specialAllowance"] == 10000
    assert data["magi"] == 130000
    assert isinstance(data["series"], list) and data["series"]
    assert isinstance(data["rows"], list)

    totals = data["totals"]
    # Allowed loss is bounded by the special allowance and never negative.
    assert 0 <= totals["allowedThisYear"] <= data["specialAllowance"]
    # Suspended losses carry forward (<= 0), and the roll-forward is internally
    # consistent: total loss = allowed + carryforward.
    assert totals["carryforwardToNext"] <= 0
    assert abs(totals["totalLoss"] + totals["allowedThisYear"] - totals["carryforwardToNext"]) < 1

    # Every series year keeps the allowed loss within the allowance.
    for point in data["series"]:
        assert 0 <= point["allowed"] <= data["specialAllowance"] + 0.01
