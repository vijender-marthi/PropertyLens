"""
Demo user seed script.
Creates user demo@propertylens.com / finNumbers with 5 properties (4 rentals + 1 primary),
6 years of tax return entries, rental periods, and document records.
Safe to re-run — exits early if demo user already exists.
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, engine, Base
from models import User, Property, Loan, TaxReturnEntry, Document, RentalPeriod
from passlib.context import CryptContext

Base.metadata.create_all(bind=engine)
db = SessionLocal()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
DEMO_EMAIL = "demo@propertylens.com"

# ── Guard: skip if already seeded ─────────────────────────────────────────────
if db.query(User).filter(User.email == DEMO_EMAIL).first():
    print("Demo user already exists — skipping.")
    db.close()
    sys.exit(0)

# ── Helpers ───────────────────────────────────────────────────────────────────

def pmt(principal, annual_rate, years):
    """Monthly P&I payment."""
    r = annual_rate / 12
    n = years * 12
    return principal * r * (1 + r)**n / ((1 + r)**n - 1)


def balance_after(principal, annual_rate, years, payments_made):
    """Remaining balance after N payments."""
    r = annual_rate / 12
    N = years * 12
    return principal * ((1 + r)**N - (1 + r)**payments_made) / ((1 + r)**N - 1)


def annual_interest_in_year(principal, annual_rate, years, purchase_month, calendar_year, purchase_year):
    """
    Total mortgage interest paid in `calendar_year`.
    First payment is month after purchase_month in purchase_year.
    """
    r = annual_rate / 12
    mp = pmt(principal, annual_rate, years)

    # payment number 1 = purchase_month+1 of purchase_year
    # figure out which payment numbers fall in calendar_year
    first_payment_offset = (calendar_year - purchase_year) * 12 - purchase_month
    # payment # that corresponds to Jan of calendar_year
    first_pmt_in_year = first_payment_offset + 1   # 1-indexed
    last_pmt_in_year  = first_pmt_in_year + 11

    if last_pmt_in_year < 1 or first_pmt_in_year > years * 12:
        return 0.0

    first_pmt_in_year = max(1, first_pmt_in_year)
    last_pmt_in_year  = min(years * 12, last_pmt_in_year)

    total_interest = 0.0
    for pmt_num in range(first_pmt_in_year, last_pmt_in_year + 1):
        bal = balance_after(principal, annual_rate, years, pmt_num - 1)
        total_interest += bal * r

    return round(total_interest, 2)


def depr_first_year(basis, month_placed):
    """IRS mid-month convention: basis / 27.5 × (12.5 - month) / 12."""
    return round(basis / 27.5 * (12.5 - month_placed) / 12, 2)


def depr_full_year(basis):
    return round(basis / 27.5, 2)

# ── User ──────────────────────────────────────────────────────────────────────
demo = User(
    email=DEMO_EMAIL,
    name="Alex & Jordan Chen",
    hashed_password=pwd_context.hash("finNumbers"),
)
db.add(demo)
db.flush()
uid = demo.id
print(f"Created demo user id={uid}")

# ── Properties ────────────────────────────────────────────────────────────────

PROPS = [
    # (address, city, state, zip, type, usage, purchase_date, purchase_price,
    #  market_value, land_value,
    #  monthly_rent, occupancy,
    #  prop_tax_annual, insurance_annual, hoa, maintenance, mgmt_fee, utilities, capex, other)
    dict(
        address="4821 Oak Meadow Ln", city="San Jose", state="CA", zip_code="95120",
        property_type="Single Family", usage_type="Primary",
        purchase_date="2018-03-15", purchase_price=1_350_000,
        market_value=1_780_000, land_value=340_000,
        monthly_rent=0, occupancy_rate=100,
        property_tax=16_875, insurance=3_200,
        hoa_fee=0, maintenance=450, property_management_fee=0,
        utilities=0, vacancy_allowance=0, capex_reserve=0, other_expenses=0,
    ),
    dict(
        address="1247 Magnolia Ave", city="Fremont", state="CA", zip_code="94538",
        property_type="Single Family", usage_type="Rental",
        purchase_date="2018-06-10", purchase_price=895_000,
        market_value=1_165_000, land_value=225_000,
        monthly_rent=4_200, occupancy_rate=100,
        property_tax=11_200, insurance=2_400,
        hoa_fee=0, maintenance=400, property_management_fee=420,
        utilities=0, vacancy_allowance=0, capex_reserve=300, other_expenses=50,
    ),
    dict(
        address="8934 Pinnacle Peak Rd", city="Scottsdale", state="AZ", zip_code="85255",
        property_type="Single Family", usage_type="Rental",
        purchase_date="2020-09-22", purchase_price=685_000,
        market_value=935_000, land_value=165_000,
        monthly_rent=3_400, occupancy_rate=100,
        property_tax=4_800, insurance=2_000,
        hoa_fee=275, maintenance=300, property_management_fee=340,
        utilities=0, vacancy_allowance=0, capex_reserve=250, other_expenses=50,
    ),
    dict(
        address="6512 Windhaven Pkwy", city="Plano", state="TX", zip_code="75093",
        property_type="Single Family", usage_type="Rental",
        purchase_date="2022-03-18", purchase_price=595_000,
        market_value=740_000, land_value=130_000,
        monthly_rent=2_900, occupancy_rate=100,
        property_tax=9_500, insurance=2_200,
        hoa_fee=150, maintenance=280, property_management_fee=290,
        utilities=0, vacancy_allowance=0, capex_reserve=220, other_expenses=50,
    ),
    dict(
        address="3205 Grayhawk Ln", city="Frisco", state="TX", zip_code="75034",
        property_type="Single Family", usage_type="Rental",
        purchase_date="2023-07-08", purchase_price=645_000,
        market_value=715_000, land_value=150_000,
        monthly_rent=3_100, occupancy_rate=100,
        property_tax=10_800, insurance=2_400,
        hoa_fee=200, maintenance=300, property_management_fee=310,
        utilities=0, vacancy_allowance=0, capex_reserve=240, other_expenses=50,
    ),
]

prop_objs = []
for p in PROPS:
    obj = Property(
        owner_id=uid,
        address=p["address"], city=p["city"], state=p["state"], zip_code=p["zip_code"],
        property_type=p["property_type"], usage_type=p["usage_type"],
        purchase_date=p["purchase_date"], purchase_price=p["purchase_price"],
        market_value=p["market_value"], market_value_source="manual",
        land_value=p["land_value"], depreciation_years=27.5,
        monthly_rent=p["monthly_rent"], occupancy_rate=p["occupancy_rate"],
        property_tax=p["property_tax"], insurance=p["insurance"],
        hoa_fee=p["hoa_fee"], maintenance=p["maintenance"],
        property_management_fee=p["property_management_fee"],
        utilities=p["utilities"], vacancy_allowance=p["vacancy_allowance"],
        capex_reserve=p["capex_reserve"], other_expenses=p["other_expenses"],
    )
    db.add(obj)
    prop_objs.append(obj)

db.flush()
p_sj, p_fr, p_sc, p_pl, p_tx = prop_objs
print(f"Created 5 properties: ids={[o.id for o in prop_objs]}")

# ── Loans ─────────────────────────────────────────────────────────────────────
#
# (purchase_month, purchase_year) used for amortization helpers
LOAN_META = [
    # San Jose primary: $1,080,000 @ 4.125% 30yr, Wells Fargo, Mar 2018
    dict(prop=p_sj, lender="Wells Fargo",  loan_type="FIXED",
         original=1_080_000, rate=0.04125, years=30,
         purchase_month=3, purchase_year=2018,
         orig_date="2018-03-15", maturity="2048-04-01",
         escrow=900, down=270_000,
         account="WF-7842163", borrowers="Alex Chen; Jordan Chen"),
    # Fremont: $716,000 @ 4.375% 30yr, Chase, Jun 2018
    dict(prop=p_fr, lender="JPMorgan Chase", loan_type="FIXED",
         original=716_000, rate=0.04375, years=30,
         purchase_month=6, purchase_year=2018,
         orig_date="2018-06-10", maturity="2048-07-01",
         escrow=850, down=179_000,
         account="CSE-4419027", borrowers="Alex Chen; Jordan Chen"),
    # Scottsdale: $548,000 @ 2.875% 30yr, US Bank, Sep 2020
    dict(prop=p_sc, lender="US Bank",       loan_type="FIXED",
         original=548_000, rate=0.02875, years=30,
         purchase_month=9, purchase_year=2020,
         orig_date="2020-09-22", maturity="2050-10-01",
         escrow=620, down=137_000,
         account="USB-2930847", borrowers="Alex Chen; Jordan Chen"),
    # Plano: $476,000 @ 4.875% 30yr, Rocket Mortgage, Mar 2022
    dict(prop=p_pl, lender="Rocket Mortgage", loan_type="FIXED",
         original=476_000, rate=0.04875, years=30,
         purchase_month=3, purchase_year=2022,
         orig_date="2022-03-18", maturity="2052-04-01",
         escrow=710, down=119_000,
         account="RM-6671294", borrowers="Alex Chen; Jordan Chen"),
    # Frisco: $516,000 @ 7.125% 30yr, PennyMac, Jul 2023
    dict(prop=p_tx, lender="PennyMac",      loan_type="FIXED",
         original=516_000, rate=0.07125, years=30,
         purchase_month=7, purchase_year=2023,
         orig_date="2023-07-08", maturity="2053-08-01",
         escrow=760, down=129_000,
         account="PM-5583812", borrowers="Alex Chen; Jordan Chen"),
]

CURRENT_YEAR, CURRENT_MONTH = 2026, 6
loan_objs = []
for lm in LOAN_META:
    payments_made = (CURRENT_YEAR - lm["purchase_year"]) * 12 + (CURRENT_MONTH - lm["purchase_month"])
    payments_made = max(0, payments_made)
    curr_bal = balance_after(lm["original"], lm["rate"], lm["years"], payments_made)
    mp = pmt(lm["original"], lm["rate"], lm["years"])
    # Interest/principal split for latest payment
    prev_bal = balance_after(lm["original"], lm["rate"], lm["years"], max(0, payments_made - 1))
    int_due = round(prev_bal * (lm["rate"] / 12), 2)
    prin_due = round(mp - int_due, 2)

    loan = Loan(
        property_id=lm["prop"].id,
        lender_name=lm["lender"], loan_type=lm["loan_type"],
        original_amount=lm["original"], current_balance=round(curr_bal, 2),
        interest_rate=lm["rate"] * 100,
        monthly_payment=round(mp, 2), loan_term_years=lm["years"],
        origination_date=lm["orig_date"], maturity_date=lm["maturity"],
        account_number=lm["account"], borrowers=lm["borrowers"],
        escrow_amount=lm["escrow"], down_payment=lm["down"],
        principal_due=prin_due, interest_due=int_due,
        statement_date=f"{CURRENT_YEAR}-{CURRENT_MONTH:02d}-01",
        payment_due_date=f"{CURRENT_YEAR}-{CURRENT_MONTH:02d}-15",
    )
    db.add(loan)
    loan_objs.append((lm, loan))

db.flush()
print(f"Created {len(loan_objs)} loans")

# ── Rental Periods ────────────────────────────────────────────────────────────
rental_periods = [
    # Fremont CA — 3 tenants, rents grew from $3,800 → $4,200
    (p_fr, "Tenant A", 2018, 6,  2020, 5,  3_800),
    (p_fr, "Tenant B", 2020, 6,  2022, 5,  4_000),
    (p_fr, "Tenant C", 2022, 6,  None, None, 4_200),
    # Scottsdale AZ — 2 tenants
    (p_sc, "Tenant A", 2020, 10, 2022, 9,  3_100),
    (p_sc, "Tenant B", 2022, 10, None, None, 3_400),
    # Plano TX — 2 tenants
    (p_pl, "Tenant A", 2022, 4,  2024, 3,  2_650),
    (p_pl, "Tenant B", 2024, 4,  None, None, 2_900),
    # Frisco TX — 1 tenant (ongoing)
    (p_tx, "Tenant A", 2023, 8,  None, None, 3_100),
]
for (prop, name, sy, sm, ey, em, rent) in rental_periods:
    db.add(RentalPeriod(property_id=prop.id, tenant_name=name,
                        start_year=sy, start_month=sm,
                        end_year=ey, end_month=em,
                        monthly_rent=rent))
db.flush()
print(f"Created {len(rental_periods)} rental periods")

# ── Tax Return Entries (Schedule E) ──────────────────────────────────────────
#
# Each rental property gets an entry for every year it was owned.
# Rents use the historical rent × months rented that year.
# Interest is computed from amortization.
# Depreciation uses IRS mid-month first year, full year thereafter.
# Operating expenses = prop_tax + insurance + repairs + mgmt + supplies

def rent_for_year(prop_key, year):
    """Historical effective rent for the year."""
    rents = {
        "fremont": {
            2018: 3_800 * 7,   # Jun-Dec (first month is purchase month, 7 months rented)
            2019: 3_800 * 12,
            2020: 3_800 * 6 + 4_000 * 6,
            2021: 4_000 * 12,
            2022: 4_000 * 6 + 4_200 * 6,
            2023: 4_200 * 12,
            2024: 4_200 * 12,
        },
        "scottsdale": {
            2020: 3_100 * 3,   # Oct-Dec
            2021: 3_100 * 12,
            2022: 3_100 * 9 + 3_400 * 3,
            2023: 3_400 * 12,
            2024: 3_400 * 12,
        },
        "plano": {
            2022: 2_650 * 9,   # Apr-Dec
            2023: 2_650 * 12,
            2024: 2_650 * 9 + 2_900 * 3,
        },
        "frisco": {
            2023: 3_100 * 5,   # Aug-Dec
            2024: 3_100 * 12,
        },
    }
    return rents.get(prop_key, {}).get(year, 0)


def ops_for_year(prop_key, year):
    """Non-interest, non-depreciation operating expenses on Schedule E."""
    base = {
        "fremont":    {"tax": 11_200, "ins": 2_400, "repairs": 4_200, "mgmt_pct": 0.10, "other": 600},
        "scottsdale": {"tax":  4_800, "ins": 2_000, "repairs": 3_400, "mgmt_pct": 0.10, "other": 500, "hoa": 3_300},
        "plano":      {"tax":  9_500, "ins": 2_200, "repairs": 3_100, "mgmt_pct": 0.10, "other": 500, "hoa": 1_800},
        "frisco":     {"tax": 10_800, "ins": 2_400, "repairs": 2_800, "mgmt_pct": 0.10, "other": 600, "hoa": 2_400},
    }
    b = base[prop_key]
    rent = rent_for_year(prop_key, year)
    total = b["tax"] + b["ins"] + b["repairs"] + round(rent * b["mgmt_pct"]) + b["other"]
    total += b.get("hoa", 0)
    return total


ENTRIES = []

# --- Fremont CA (purchased Jun 2018) ---
fr_lm = LOAN_META[1]
fr_basis = (895_000 - 225_000)
for year in range(2018, 2025):
    rent = rent_for_year("fremont", year)
    if not rent:
        continue
    interest = annual_interest_in_year(fr_lm["original"], fr_lm["rate"], fr_lm["years"],
                                        fr_lm["purchase_month"], year, fr_lm["purchase_year"])
    if year == 2018:
        depr = depr_first_year(fr_basis, 6)
    else:
        depr = depr_full_year(fr_basis)
    ops = ops_for_year("fremont", year)
    total_exp = round(interest + depr + ops, 2)
    net = round(rent - total_exp, 2)
    ENTRIES.append(TaxReturnEntry(
        owner_id=uid, property_id=p_fr.id,
        tax_year=year, address="1247 Magnolia Ave, Fremont, CA 94538",
        property_kind="rental",
        rents_received=rent, mortgage_interest=interest,
        property_taxes=11_200, depreciation=depr,
        total_expenses=total_exp, net_income=net,
    ))

# --- Scottsdale AZ (purchased Sep 2020) ---
sc_lm = LOAN_META[2]
sc_basis = (685_000 - 165_000)
for year in range(2020, 2025):
    rent = rent_for_year("scottsdale", year)
    if not rent:
        continue
    interest = annual_interest_in_year(sc_lm["original"], sc_lm["rate"], sc_lm["years"],
                                        sc_lm["purchase_month"], year, sc_lm["purchase_year"])
    if year == 2020:
        depr = depr_first_year(sc_basis, 9)
    else:
        depr = depr_full_year(sc_basis)
    ops = ops_for_year("scottsdale", year)
    total_exp = round(interest + depr + ops, 2)
    net = round(rent - total_exp, 2)
    ENTRIES.append(TaxReturnEntry(
        owner_id=uid, property_id=p_sc.id,
        tax_year=year, address="8934 Pinnacle Peak Rd, Scottsdale, AZ 85255",
        property_kind="rental",
        rents_received=rent, mortgage_interest=interest,
        property_taxes=4_800, depreciation=depr,
        total_expenses=total_exp, net_income=net,
    ))

# --- Plano TX (purchased Mar 2022) ---
pl_lm = LOAN_META[3]
pl_basis = (595_000 - 130_000)
for year in range(2022, 2025):
    rent = rent_for_year("plano", year)
    if not rent:
        continue
    interest = annual_interest_in_year(pl_lm["original"], pl_lm["rate"], pl_lm["years"],
                                        pl_lm["purchase_month"], year, pl_lm["purchase_year"])
    if year == 2022:
        depr = depr_first_year(pl_basis, 3)
    else:
        depr = depr_full_year(pl_basis)
    ops = ops_for_year("plano", year)
    total_exp = round(interest + depr + ops, 2)
    net = round(rent - total_exp, 2)
    ENTRIES.append(TaxReturnEntry(
        owner_id=uid, property_id=p_pl.id,
        tax_year=year, address="6512 Windhaven Pkwy, Plano, TX 75093",
        property_kind="rental",
        rents_received=rent, mortgage_interest=interest,
        property_taxes=9_500, depreciation=depr,
        total_expenses=total_exp, net_income=net,
    ))

# --- Frisco TX (purchased Jul 2023) ---
tx_lm = LOAN_META[4]
tx_basis = (645_000 - 150_000)
for year in range(2023, 2025):
    rent = rent_for_year("frisco", year)
    if not rent:
        continue
    interest = annual_interest_in_year(tx_lm["original"], tx_lm["rate"], tx_lm["years"],
                                        tx_lm["purchase_month"], year, tx_lm["purchase_year"])
    if year == 2023:
        depr = depr_first_year(tx_basis, 7)
    else:
        depr = depr_full_year(tx_basis)
    ops = ops_for_year("frisco", year)
    total_exp = round(interest + depr + ops, 2)
    net = round(rent - total_exp, 2)
    ENTRIES.append(TaxReturnEntry(
        owner_id=uid, property_id=p_tx.id,
        tax_year=year, address="3205 Grayhawk Ln, Frisco, TX 75034",
        property_kind="rental",
        rents_received=rent, mortgage_interest=interest,
        property_taxes=10_800, depreciation=depr,
        total_expenses=total_exp, net_income=net,
    ))

for e in ENTRIES:
    db.add(e)
db.flush()
print(f"Created {len(ENTRIES)} tax return entries across {len({e.tax_year for e in ENTRIES})} years")

# Print summary table
print("\n  Year | Property                          | Rent      | Interest  | Depr     | Net Income")
print("  -----|-----------------------------------|-----------|-----------|----------|----------")
for e in ENTRIES:
    addr_short = e.address.split(",")[0][:34]
    print(f"  {e.tax_year} | {addr_short:<34} | ${e.rents_received:>8,.0f} | ${e.mortgage_interest:>8,.0f} | ${e.depreciation:>7,.0f} | ${e.net_income:>10,.0f}")

# ── Document Records (loan disclosures + tax returns + mortgage statements) ───
import json

docs = []

# Loan Disclosure — one per property at purchase
loan_disclosures = [
    (p_sj, "2018-03-15", "Loan_Disclosure_San_Jose_CA_2018.pdf",    "WF-7842163",  2018),
    (p_fr, "2018-06-10", "Loan_Disclosure_Fremont_CA_2018.pdf",     "CSE-4419027", 2018),
    (p_sc, "2020-09-22", "Loan_Disclosure_Scottsdale_AZ_2020.pdf",  "USB-2930847", 2020),
    (p_pl, "2022-03-18", "Loan_Disclosure_Plano_TX_2022.pdf",       "RM-6671294",  2022),
    (p_tx, "2023-07-08", "Loan_Disclosure_Frisco_TX_2023.pdf",      "PM-5583812",  2023),
]
for (prop, date, fname, acct, yr) in loan_disclosures:
    docs.append(Document(
        property_id=prop.id, owner_id=uid,
        filename=f"demo_{fname}", original_filename=fname,
        file_type="pdf", doc_category="loan_disclosure",
        file_size=245_000,
        loan_account_number=acct, statement_year=yr,
        period_type="other", period_start=date, period_end=date,
        extracted_data=json.dumps({"demo": True, "note": "Demo loan disclosure document"}),
    ))

# Annual Federal Tax Returns — one per year (2018–2024)
for yr in range(2018, 2025):
    docs.append(Document(
        property_id=None, owner_id=uid,
        filename=f"demo_Federal_Tax_Return_{yr}.pdf",
        original_filename=f"Federal_Tax_Return_{yr}.pdf",
        file_type="pdf", doc_category="tax_return",
        file_size=580_000 + yr * 100,
        statement_year=yr, period_type="yearly",
        period_start=f"{yr}-01-01", period_end=f"{yr}-12-31",
        extracted_data=json.dumps({
            "demo": True,
            "tax_year": yr,
            "filing_status": "Married Filing Jointly",
            "gross_income": 420_000 + (yr - 2018) * 10_000,
        }),
    ))

# Annual Mortgage Statements — one per active loan per year
stmt_loans = [
    # (prop, account, lender, purchase_year, start_year, end_year)
    (p_sj, "WF-7842163",  "Wells Fargo",       2018, 2018, 2025),
    (p_fr, "CSE-4419027", "JPMorgan Chase",     2018, 2018, 2025),
    (p_sc, "USB-2930847", "US Bank",            2020, 2020, 2025),
    (p_pl, "RM-6671294",  "Rocket Mortgage",    2022, 2022, 2025),
    (p_tx, "PM-5583812",  "PennyMac",           2023, 2023, 2025),
]
for (prop, acct, lender, py, start_yr, end_yr) in stmt_loans:
    for yr in range(start_yr, end_yr):
        docs.append(Document(
            property_id=prop.id, owner_id=uid,
            filename=f"demo_Mortgage_Statement_{acct}_{yr}.pdf",
            original_filename=f"Mortgage_Statement_{lender.replace(' ','_')}_{yr}.pdf",
            file_type="pdf", doc_category="mortgage_statement",
            file_size=125_000,
            loan_account_number=acct, statement_year=yr,
            period_type="yearly",
            period_start=f"{yr}-01-01", period_end=f"{yr}-12-31",
            extracted_data=json.dumps({"demo": True, "lender": lender, "year": yr}),
        ))

for d in docs:
    db.add(d)
db.flush()
print(f"\nCreated {len(docs)} document records "
      f"({sum(1 for d in docs if d.doc_category=='loan_disclosure')} loan disclosures, "
      f"{sum(1 for d in docs if d.doc_category=='tax_return')} tax returns, "
      f"{sum(1 for d in docs if d.doc_category=='mortgage_statement')} mortgage statements)")

# ── Commit ────────────────────────────────────────────────────────────────────
db.commit()
db.close()
print("\n✓ Demo user seeded successfully.")
print(f"  Login: {DEMO_EMAIL} / finNumbers")
print("  Properties: 4 rentals + 1 primary home across CA, AZ, TX")
print(f"  Tax entries: {len(ENTRIES)} rows covering 2018–2024")
