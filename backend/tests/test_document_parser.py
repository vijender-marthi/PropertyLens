from services import document_parser
from services.document_parser import extract_excel_data, parse_1098, parse_closing_statement, parse_document, parse_mortgage_statement


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
    assert data["closing_costs"] == 14491.23
    assert data["closing_costs_source"] == "settlement_total_minus_purchase_price"
    assert any(item["key"] == "broker_rebate" for item in data["settlement_line_items"])


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
