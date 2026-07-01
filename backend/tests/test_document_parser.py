from services.document_parser import extract_excel_data, parse_1098, parse_closing_statement


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
