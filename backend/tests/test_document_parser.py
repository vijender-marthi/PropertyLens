from services import document_parser
from services.document_parser import detect_category, extract_excel_data, parse_1098, parse_closing_statement, parse_document, parse_escrow_analysis, parse_insurance_declaration, parse_loan_disclosure, parse_mortgage_statement


def test_closing_purchase_date_falls_back_to_date_issued_for_purchase_doc():
    text = """
    Loan Estimate
    DATE ISSUED 07/26/2022 PURPOSE Purchase
    PROPERTY
    10308 E San Salvador Dr
    Scottsdale, AZ 85258
    SALE PRICE $1,000,000.00
    """

    data = parse_closing_statement(text)

    assert data["purchase_date"] == "2022-07-26"
    assert data["origination_date"] == "2022-07-26"
    assert data["purchase_date_source"] == "date_issued_purchase_document"
    assert data["setup_import_role"] == "closing_document"


def test_alta_settlement_statement_extracts_final_total_calculation():
    text = """
    ALTA Settlement Statement
    Settlement Date : September 20, 2024
    Borrower: Pavani Donepudi
    Seller: Richmond American Homes of Maryland Inc.
    Property Location: 911 Osprey Dr, Lathrop, CA 95330
    Sale Price $625,000.00
    Deposit : $148,050.23
    Loan Amount $468,750.00
    Initial Deposit retained by Seller $30,000.00
    Origination Fee $1,295.00
    0.25% of Loan Amount (Points) $1,171.88
    Escrow Fee $2,000.00
    Broker Rebate $5,600.00
    Subtotals 638,810.23 638,810.23
    Due To Buyer 681.00 681.00 Totals 681.00 639,491.23 639,491.23
    """

    data = parse_closing_statement(text)

    assert data["purchase_price"] == 625000
    assert data["sale_price"] == 625000
    assert data["deposit"] == 148050.23
    assert data["original_amount"] == 468750
    assert data["settlement_debit_subtotal"] == 638810.23
    assert data["settlement_credit_subtotal"] == 638810.23
    assert data["settlement_due_to_buyer"] == 681
    assert data["settlement_debit_total"] == 639491.23
    assert data["settlement_credit_total"] == 639491.23
    assert data["settlement_total_amount"] == 639491.23
    assert data["settlement_purchase_price_adjustment"] == 14491.23
    assert "closing_costs" not in data
    assert data["setup_import_role"] == "settlement_document"
    assert any(item["key"] == "broker_rebate" for item in data["settlement_line_items"])


def test_refinance_settlement_extracts_prior_loan_payoff():
    text = """
    ALTA Settlement Statement
    Property Address: 3619 Palermo Way, Dublin, CA 94568
    Lender: JPMorgan Chase Bank, N.A.
    Settlement Date: 7/30/2021
    Loan Amount $933,904.00

    Payoff(s)
    to Bank of America, N.A
    $935,238.74
    Payoff Balance
    """

    data = parse_closing_statement(text)

    assert data["prior_loan_payoff_lender"] == "Bank of America, N.A"
    assert data["prior_loan_payoff_amount"] == 935238.74
    assert any(
        item["key"] == "prior_loan_payoff_amount"
        for item in data["settlement_line_items"]
    )


def test_estimated_buyer_statement_uses_real_loan_amount_not_date_fragment():
    text = """
    ESTIMATED BUYER'S STATEMENT
    Settlement Date: April 12, 2019
    Property: 3619 Palermo Way
              Dublin, CA 94568
    Lender: Bank of America, N.A.
            Loan Number: 289608533

    FINANCIAL CONSIDERATION
    Sale Price of Property                                                                         1,210,000.00
    Deposit                                                                                                               36,300.00
    Loan Amount                            Bank of America, N.A.                                                         968,000.00

    Calculating Cash to Close
    Down Payment/Funds from Borrower                         $242,000.00          $242,000.00
    Cash to Close                                            $256,498.00          $216,849.07
    """

    data = parse_closing_statement(text)

    assert data["purchase_price"] == 1210000
    assert data["original_amount"] == 968000
    assert data["loan_amount"] == 968000
    assert data["loan_amount"] != 4.12
    assert data["property_address"] == "3619 Palermo Way"
    assert data["property_city"] == "Dublin"
    assert data["property_state"] == "CA"
    assert data["property_zip"] == "94568"
    assert data["setup_import_role"] == "settlement_document"


def test_refinance_closing_disclosure_is_normalized_as_loan_disclosure():
    text = """
    Closing Disclosure
    Closing Date  07/30/2021  Purpose  Refinance
    Settlement Agent Amrock Title California Inc. JPMorgan Chase Bank, N.A.
    Lender
    Property 3619 Palermo Way □VAO ____
    Dublin, CA 94568
    Loan Type  Conventional
    Loan ID #  1368496008-5678387
    Loan Term  30 years
    Loan Amount $933,904 NO
    Interest Rate 2.875% NO
    Monthly Principal & Interest $3,874.70 NO
    """

    assert detect_category(text) == "loan_disclosure"
    data = parse_loan_disclosure(text)

    assert data["lender_name"] == "JPMorgan Chase Bank, N.A"
    assert data["account_number"] == "1368496008-5678387"
    assert data["loan_purpose"] == "Refinance"
    assert data["loan_product"] == "Conventional"
    assert data["property_address"] == "3619 Palermo Way"
    assert data["property_city"] == "Dublin"
    assert data["original_amount"] == 933904
    assert data["current_balance"] == 933904
    assert data["interest_rate"] == 2.875
    assert data["monthly_payment"] == 3874.70
    assert data["origination_date"] == "2021-07-30"
    assert data["current_balance_verified"] is False


def test_purchase_closing_disclosure_retains_category_and_extracts_loan_terms():
    text = """
    Closing Disclosure
    Closing Date 04/11/2019 Purpose Purchase
    Lender BANK OF AMERICA, N.A. MIC #
    Property 3619 Palermo Way
    Dublin, CA 94568
    Loan ID # 289608533
    Sale Price $1,210,000.00
    Loan Term 30 years
    $968,000
    Loan Amount NO
    4.125% NO
    Interest Rate
    Monthly Principal & Interest $4,691.41 NO
    """

    data = parse_loan_disclosure(text)

    assert detect_category(text) == "closing_statement"
    assert data["lender_name"] == "BANK OF AMERICA, N.A"
    assert data["account_number"] == "289608533"
    assert data["original_amount"] == 968000
    assert data["interest_rate"] == 4.125
    assert data["monthly_payment"] == 4691.41


def test_mortgage_statement_extracts_paid_year_to_date_breakdown():
    text = """
    Mortgage Loan statement
    Loan number 3550379001
    Statement date 06/11/2026
    Interest bearing principal balance: $438,502.37
    Paid year to date
    Principal: $20,219.73
    Interest: $20,130.22
    Escrow amount (taxes & insurance): $6,796.73
    Optional insurance: $0.00
    Advances on your behalf: $0.00
    Fees: $0.00
    Partial payment (unapplied): $0.00
    Total paid year to date: $47,146.68
    """

    data = parse_mortgage_statement(text)

    assert data["principal_paid_ytd"] == 20219.73
    assert data["interest_paid_ytd"] == 20130.22
    assert data["escrow_paid_ytd"] == 6796.73


def test_chase_mortgage_statement_extracts_two_column_ytd_and_wrapped_address():
    text = """
    Mortgage Statement
    Statement date 12/10/2025
    Mortgage information Past payments breakdown Explanation of amount due
    Paid since Paid
    last statement year-to-date
    Account number 1523597980 Principal $1,195.11
    Property address 10308 E San Salvador Dr Interest $3,160.79
    Principal $1,190.03 $13,261.70
    Scottsdale, AZ 85258
    Interest $3,165.87 $35,103.20
    Total $4,355.90 $48,364.90
    Original principal balance $800,000.00
    Unpaid principal balance $740,086.53
    Maturity date 09/2052
    Interest rate (Until 10/2032) 5.12500%
    Total payment due on 01/01/2026 $4,355.90
    JPMorgan Chase Bank, N.A. Member FDIC.
    """

    data = parse_mortgage_statement(text)

    assert data["property_address"] == "10308 E San Salvador Dr"
    assert data["property_city"] == "Scottsdale"
    assert data["property_state"] == "AZ"
    assert data["property_zip"] == "85258"
    assert data["lender_name"] == "JPMorgan Chase Bank, N.A."
    assert data["account_number"] == "1523597980"
    assert data["original_amount"] == 800000
    assert data["current_balance"] == 740086.53
    assert data["principal_due"] == 1195.11
    assert data["interest_due"] == 3160.79
    assert data["principal_paid_last_statement"] == 1190.03
    assert data["principal_paid_ytd"] == 13261.70
    assert data["interest_paid_last_statement"] == 3165.87
    assert data["interest_paid_ytd"] == 35103.20
    assert data["total_paid_ytd"] == 48364.90


def test_loan_estimate_is_not_misclassified_by_closing_disclosure_boilerplate():
    text = """
    Loan Estimate
    Save this Loan Estimate to compare with your Closing Disclosure.
    DATE ISSUED 07/26/2022
    APPLICANTS Example Borrower
    PROPERTY 10308 E San Salvador Dr
    Scottsdale, AZ 85258
    SALE PRICE $1,000,000
    LOAN TERM
    30 years
    PURPOSE Purchase
    PRODUCT 10/6mo Adjustable Rate
    LOAN TYPE Conventional
    LOAN ID# 1523597980-6924317
    LENDER: JPMorgan Chase Bank, N.A.
    Loan Amount $800,000
    Interest Rate 5.125%
    Principal & Interest $4,355.90
    Estimated Escrow + 0
    Estimated Taxes, Insurance & Assessments $440
    In escrow? NO
    $9,633 Includes Loan Costs and Other Costs
    Estimated Closing Costs
    $209,633 Includes Closing Costs
    Estimated Cash to Close
    beginning of 121st month
    every 6 months after first change
    Index + Margin 30-day Average SOFR + 2.75%
    Minimum/Maximum Interest Rate 2.75% / 10.125%
    """

    assert detect_category(text) == "loan_disclosure"
    data = parse_loan_disclosure(text)

    assert data["document_type"] == "LOAN_ESTIMATE"
    assert data["issued_date"] == "2022-07-26"
    assert "origination_date" not in data
    assert data["property_address"] == "10308 E San Salvador Dr"
    assert data["property_city"] == "Scottsdale"
    assert data["account_number"] == "1523597980-6924317"
    assert data["loan_purpose"] == "Purchase"
    assert data["loan_product"] == "Conventional"
    assert data["loan_type"] == "ARM"
    assert data["arm_product"] == "10/6 ARM"
    assert data["loan_term_years"] == 30
    assert data["original_amount"] == 800000
    assert data["purchase_price"] == 1000000
    assert data["down_payment"] == 200000
    assert data["closing_costs"] == 9633
    assert data["cash_to_close"] == 209633
    assert data["interest_rate"] == 5.125
    assert data["monthly_payment"] == 4355.90
    assert data["escrow_included"] is False
    assert data["estimated_non_escrow_property_costs_monthly"] == 440
    assert data["arm_first_change_month"] == 121
    assert data["arm_adjustment_frequency_months"] == 6
    assert data["arm_margin"] == 2.75
    assert data["minimum_interest_rate"] == 2.75
    assert data["maximum_interest_rate"] == 10.125

    from services.canonical_loan import accounts_match
    assert accounts_match("1523597980-6924317", "1523597980")


def test_1098_extracts_account_dates_and_real_estate_taxes():
    text = """
    For calendar year 2024
    1 Mortgage interest received from payer(s)/borrower(s) $ 8,826.97
    2 Outstanding mortgage principal 3 Mortgage origination date
    $ 463,428.32 05/26/2023
    3550379001
    Account number (see instructions)
    10 Other
    11 Mortgage acquisition date
    10/01/2024
    Property Taxes $5,295.61
    """

    data = parse_1098(text)

    assert data["account_number"] == "3550379001"
    assert data["origination_date"] == "05/26/2023"
    assert data["mortgage_acquisition_date"] == "10/01/2024"
    assert data["property_tax_amount"] == 5295.61


def test_excel_import_normalizes_principal_and_topup_columns(tmp_path):
    import openpyxl

    path = tmp_path / "mortgage.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([
        "Property", "Lender", "Loan Account Number", "Calendar Year",
        "Mortgage Interest Received", "Outstanding Mortgage Principal",
        "Property Taxes Paid", "Year End Outstanding balance",
        "Principal Paid down", "Cum Principal Paid Down",
        "Expected Principal Paid Down", "Topup",
    ])
    ws.append([
        "Syrah", "Chase", "1392931056", 2026,
        "17,715.61", "1,239,344.80", None, "1,222,607.75",
        "16,737.05", "161,392.25", "145,222.18", "16,170.07",
    ])
    wb.save(path)

    data = extract_excel_data(str(path))

    assert data["account_number"] == "1392931056"
    assert data["tax_year"] == 2026
    assert data["mortgage_interest"] == 17715.61
    assert data["current_balance"] == 1239344.80
    assert data["year_end_outstanding_balance"] == 1222607.75
    assert data["principal_paid_down"] == 16737.05
    assert data["cumulative_principal_paid"] == 161392.25
    assert data["expected_principal_paid"] == 145222.18
    assert data["principal_topup_paid"] == 16170.07
    assert data["parsed_rows"][0]["property_name"] == "Syrah"


def test_parse_document_uses_markitdown_text_for_1098_spreadsheet(monkeypatch, tmp_path):
    path = tmp_path / "form-1098.xlsx"
    path.write_text("placeholder")
    markitdown_text = """
    Form 1098 Mortgage Interest Statement
    For calendar year 2024
    Property Address: 10575 East Mission Lane
    Scottsdale, AZ 85258
    1 Mortgage interest received from payer(s)/borrower(s) $8,826.97
    2 Outstanding mortgage principal $463,428.32
    10 Other Real estate taxes paid $5,295.61
    """

    monkeypatch.setattr(document_parser, "_markitdown_text", lambda _path: markitdown_text)

    category, data, markdown = parse_document(str(path), "auto")

    assert category == "1098"
    assert data["mortgage_interest"] == 8826.97
    assert data["current_balance"] == 463428.32
    assert data["property_tax_amount"] == 5295.61
    assert data["property_address"] == "10575 East Mission Lane"
    assert markdown


def test_mortgage_statement_extracts_account_number_and_latest_balance():
    text = """
    Mortgage Statement
    Statement Date 06/11/2026
    Payment Due Date 07/01/2026
    Property Address: 911 OSPREY DRIVE, LATHROP, CA 95330
    Mortgage Account Number 3550379001
    Unpaid Principal Balance $438,502.37
    Interest Rate 7.625%
    Amount Due
    $4,274.51
    Escrow (taxes and insurance) $1,913.46
    Taxes: $887.47
    Insurance: $69.26
    Mortgage Insurance: $0.00
    Principal: $531.46
    Interest: $2,786.32
    """

    data = parse_mortgage_statement(text)

    assert data["account_number"] == "3550379001"
    assert data["property_address"] == "911 OSPREY DRIVE"
    assert data["current_balance"] == 438502.37
    assert data["monthly_payment"] == 4274.51
    assert data["escrow_amount"] == 1913.46
    assert data["monthly_property_tax_escrow"] == 887.47
    assert data["monthly_insurance_escrow"] == 69.26
    assert data["monthly_other_escrow"] == 956.73
    assert data["interest_rate"] == 7.625
    assert data["statement_year"] == 2026


def test_parse_document_rejects_empty_pdf_text(monkeypatch, tmp_path):
    path = tmp_path / "scan.pdf"
    path.write_text("placeholder")
    monkeypatch.setattr(document_parser, "extract_pdf_text", lambda _path: "")

    try:
        parse_document(str(path), "auto")
    except ValueError as exc:
        assert "no readable text" in str(exc)
    else:
        raise AssertionError("Expected unreadable PDF to fail before creating an empty parse result.")


def test_parse_escrow_analysis_extracts_payment_change_and_tax_insurance_periods():
    text = """
    Annual Escrow Account Disclosure Statement
    Loan Number: 3550379001
    Property Address: 911 Osprey Drive
    Lathrop, CA 95330-0000
    Statement Date: 01/14/2026
    New Payment Effective Date: 03/01/2026
    Current Escrow Payment $1,006.54
    New Escrow Payment $956.73
    Escrow Account History 03/01/2025 through 02/28/2026
    Estimated Tax $10,591.22 Actual Tax $10,620.41
    Estimated Insurance $815.15 Actual Insurance $831.15
    Escrow Account Projection 03/01/2026 through 02/28/2027
    County Tax $10,649.60
    Hazard Insurance $831.15
    Total Escrow $11,480.75
    """

    data = parse_escrow_analysis(text)

    assert data["loan_number"] == "3550379001"
    assert data["property_address"] == "911 Osprey Drive"
    assert data["statement_date"] == "2026-01-14"
    assert data["effective_date"] == "2026-03-01"
    assert data["expense_year"] == 2026
    assert data["current_escrow_payment"] == 1006.54
    assert data["new_escrow_payment"] == 956.73
    assert data["estimated_tax"] == 10591.22
    assert data["actual_tax"] == 10620.41
    assert data["estimated_insurance"] == 815.15
    assert data["actual_insurance"] == 831.15
    assert data["projected_tax"] == 10649.60
    assert data["projected_insurance"] == 831.15
    assert data["projected_total"] == 11480.75


def test_parse_annual_year_end_statement_extracts_escrow_disbursement_activity():
    text = """
    Annual Statement
    Notice Date: February 23, 2026
    Loan Number: 8210134813
    Property Address: 1763 ELECTRA WAY Credits since last statement:
    MANTECA CA 95337
    This statement covers activity from January 01, 2025 to December 31, 2025

    (cid:159) Unpaid Principal Balance as of 12-31-2025 $499,612.34
    (cid:159) Amount Paid to Interest $32,678.20
    (cid:159) Aggregate of payments applied towards principal $5,719.88
    (cid:159) Amount Paid to Principal & Interest (P&I) $38,398.08
    (cid:159) Amount Deposited into Escrow $10,291.48
    (cid:159) Amount Disbursed from Escrow ($11,214.00)
    (cid:159) Current Escrow Balance $6,070.33

    Transaction Activity
    03-07-2025 Homeowners Insurance Premium ($99.81) $0.00 $0.00 ($99.81) $0.00 $0.00
    03-10-2025 Payment $4,051.08 $467.65 $2,732.19 $851.24 $0.00 $0.00
    03-20-2025 County Taxes ($1,684.08) $0.00 $0.00 ($1,684.08) $0.00 $0.00
    07-30-2025 Escrow Refund ($5,968.16) $0.00 $0.00 ($5,968.16) $0.00 $0.00
    08-29-2025 Homeowners Insurance Premium ($933.15) $0.00 $0.00 ($933.15) $0.00 $0.00
    11-10-2025 Payment $4,066.40 $488.30 $2,711.54 $866.56 $0.00 $0.00
    11-18-2025 County Taxes ($2,528.80) $0.00 $0.00 ($2,528.80) $0.00 $0.00
    """

    assert detect_category(text) == "escrow_analysis"
    data = parse_escrow_analysis(text)

    assert data["loan_number"] == "8210134813"
    assert data["property_address"] == "1763 ELECTRA WAY"
    assert data["property_city"] == "MANTECA"
    assert data["property_state"] == "CA"
    assert data["property_zip"] == "95337"
    assert data["statement_date"] == "2026-02-23"
    assert data["expense_year"] == 2025
    assert data["history_period_start"] == "2025-01-01"
    assert data["history_period_end"] == "2025-12-31"
    assert data["current_balance"] == 499612.34
    assert data["mortgage_interest"] == 32678.20
    assert data["principal_paid_ytd"] == 5719.88
    assert data["actual_total_disbursement"] == 11214.00
    assert data["actual_tax"] == 4212.88
    assert data["actual_insurance"] == 1032.96
    assert data["current_escrow_payment"] == 866.56
    assert len(data["activities"]) == 7
    assert sum(1 for row in data["activities"] if row["activity_type"] == "PROPERTY_TAX") == 2
    assert sum(1 for row in data["activities"] if row["activity_type"] == "HOMEOWNERS_INSURANCE") == 2
    assert any(row["activity_type"] == "OVERAGE_REFUND" for row in data["activities"])
    assert any(
        row["activity_type"] == "ESCROW_DEPOSIT" and row["actual_deposit"] == 866.56
        for row in data["activities"]
    )


def test_insurance_declaration_detection_and_annual_premium():
    text = """
    Homeowners Insurance Declarations Page
    Property Address: 911 Osprey Drive
    Lathrop, CA 95330
    Policy Period: March 1, 2026 to March 1, 2027
    Total Annual Policy Premium $1,245.60
    """

    assert detect_category(text) == "insurance_declaration"
    data = parse_insurance_declaration(text)
    assert data["annual_insurance"] == 1245.60
    assert data["period_start"] == "2026-03-01"
    assert data["period_end"] == "2027-03-01"
    assert data["statement_year"] == 2026


# ── Form 1098 regression: PennyMac IRS substitute-form grid layout ──────────
# pdfminer/OCR renders this grid with spaceless labels and the value wrapped
# onto a different line than its label (Box 2's value lands *after* the Box 3
# label). The parser must still read each box by value, not by line position.
def _pennymac_1098_substitute(year, box1, box2, box10, origination="09-20-2024"):
    return f"""January 13, {int(year) + 1}
PENNYMACLOANSERVICES,LLC
PO BOX514387
LOSANGELES,CA90051-4387
RECIPIENT'S/LENDER'S TIN PAYER'S/BORROWER'S TIN 1 Mortgageinterestreceivedfrompayer(s)/borrower(s)* CopyB
26-2049351 XXX-XX-5790 {box1} For Payer/
Borrower
PAYER'S/BORROWER'S name 2 Outstandingmortgage 3 Mortgageoriginationdate
principal Theinformationinboxes
{box2} {origination} 1through9and11is
4Refundofoverpaid 5Mortgageinsurance andisbeingfurnishedto
interest premiums
$0.00
6 Pointspaidonpurchaseofprincipalresidence negligencepenaltyor
$0.00 othersanctionmaybe
Street address(including apt.no.) overstatedadeductionfor
7 Ifaddressofpropertysecuringmortgageisthesameas thismortgageinterestor
3619 PALERMO WAY PAYER'S/BORROWER'Saddress,theboxischecked,orthe
Cityortown,stateorprovince,country,andZIPorforeignpostalcode 8Addressordescriptionofpropertysecuringmortgage becauseyoudidn'treport
DUBLIN, CA 94568-7327
9 Numberofpropertiessecuringthe 10 Other - Real Estate Taxes 1763 ELECTRA WAY item.
mortgage Paid MANTECA, CA 95337
1 {box10} 11 Mortgage acquisition date
Accountnumber(seeinstructions)
8210134813
Form 1098 (Keep for your records) www.irs.gov/Form1098 Department of the Treasury - Internal Revenue Service
For calendar year
{year}
"""


def test_1098_pennymac_2024_substitute_form_extracts_all_boxes():
    data = parse_1098(_pennymac_1098_substitute("2024", "$5,481.90", "$506,250.00", "$1,684.08"))
    assert data["mortgage_interest"] == 5481.90
    assert data["current_balance"] == 506250.00
    assert data["property_tax_amount"] == 1684.08
    assert data["account_number"] == "8210134813"
    assert data["property_address"] == "1763 ELECTRA WAY"
    assert data["property_city"] == "MANTECA"
    assert data["property_state"] == "CA"
    assert data["property_zip"] == "95337"
    assert data["statement_year"] == 2024


def test_1098_pennymac_2025_substitute_form_extracts_all_boxes():
    data = parse_1098(_pennymac_1098_substitute("2025", "$32,678.20", "$505,332.22", "$4,212.88"))
    assert data["mortgage_interest"] == 32678.20
    assert data["current_balance"] == 505332.22
    assert data["property_tax_amount"] == 4212.88
    assert data["account_number"] == "8210134813"
    assert data["property_address"] == "1763 ELECTRA WAY"
    assert data["property_city"] == "MANTECA"
    assert data["property_state"] == "CA"
    assert data["property_zip"] == "95337"
    assert data["statement_year"] == 2025


def test_1098_box8_address_excludes_statement_noise():
    # The property address must come from Box 8 only — never absorb servicer
    # statement text like "Credits since last statement".
    data = parse_1098(_pennymac_1098_substitute("2025", "$32,678.20", "$505,332.22", "$4,212.88"))
    assert "Credits" not in (data.get("property_address") or "")
    assert "statement" not in (data.get("property_address") or "").lower()


def test_mortgage_statement_ytd_reads_year_to_date_column_not_prior():
    # PennyMac "Past Payments Breakdown" is a two-column table: the first amount
    # on each row is the prior statement, the second is year-to-date. The parser
    # must read the YTD column, not the prior one.
    text = """
    Mortgage Statement
    Statement Date 06/10/2026
    Property Address: 1763 ELECTRA WAY, MANTECA, CA 95337
    Mortgage Account Number 8210134813
    Unpaid Principal Balance $496,610.30
    Interest Rate 6.500%
    Past Payments Breakdown As of Last Stmt Paid Year to Date
    Principal: $507.12 $3,002.04
    Interest: $2,692.72 $16,197.00
    Escrow (Taxes & Insurance): $499.22 $4,464.68
    Fees: $0.00 $0.00
    Suspense*: $0.00 $0.00
    Total: $3,699.06 $23,663.72
    """
    data = parse_mortgage_statement(text)
    assert data["principal_paid_ytd"] == 3002.04
    assert data["interest_paid_ytd"] == 16197.00
    assert data["escrow_paid_ytd"] == 4464.68
    assert data["total_paid_ytd"] == 23663.72
    # Prior-statement column preserved separately, never confused with YTD.
    assert data["principal_paid_last_statement"] == 507.12
    assert data["interest_paid_last_statement"] == 2692.72


def test_mortgage_statement_ytd_handles_reversed_column_order():
    # Some servicers put Year-to-Date first, prior second — column order is read
    # from the header, so YTD is still mapped correctly.
    text = """
    Past Payments Breakdown Paid Year to Date Since Last Statement
    Principal: $3,002.04 $507.12
    Interest: $16,197.00 $2,692.72
    Total: $23,663.72 $3,699.06
    """
    data = parse_mortgage_statement(text)
    assert data["principal_paid_ytd"] == 3002.04
    assert data["interest_paid_ytd"] == 16197.00
    assert data["principal_paid_last_statement"] == 507.12


def test_1098_fails_loud_when_box2_missing_but_box1_present():
    # Box 1 present, Box 2 absent -> never silently return null; fail loudly.
    text = """
    1 Mortgage interest received from payer(s)/borrower(s) $5,481.90
    3 Mortgage origination date 09-20-2024
    Account number (see instructions)
    8210134813
    """
    import pytest
    with pytest.raises(ValueError) as exc:
        parse_1098(text)
    assert "Box 2" in str(exc.value)
