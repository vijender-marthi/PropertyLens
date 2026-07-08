"""Backend-owned document field mappings and merge rules.

The frontend should render these results only. Parsing, field ownership,
database targets, and comparison semantics live here so every document type
has an explicit process.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass(frozen=True)
class FieldMapping:
    source: str
    target: str | None
    label: str
    merge: str = "latest_non_null"
    verify_role: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class DocumentTypeConfig:
    category: str
    label: str
    scope: str
    fields: tuple[FieldMapping, ...]
    verification: str
    notes: str


DOCUMENT_TYPE_CONFIG: dict[str, DocumentTypeConfig] = {
    "mortgage_statement": DocumentTypeConfig(
        category="mortgage_statement",
        label="Mortgage Statement",
        scope="property",
        verification="monthly_statement_snapshot",
        notes="Statement fields update the loan only when the statement date is newer than the existing loan statement date.",
        fields=(
            FieldMapping("property_address", "property.address", "Property Address", "match_only", "property_match"),
            FieldMapping("account_number", "loan.account_number", "Loan Account Number", "identity", "loan_match"),
            FieldMapping("lender_name", "loan.lender_name", "Lender", "identity"),
            FieldMapping("loan_product", "loan.loan_product", "Loan Product", "identity"),
            FieldMapping("current_balance", "loan.current_balance", "Current Balance", "latest_statement", "statement_balance"),
            FieldMapping("interest_rate", "loan.interest_rate", "Interest Rate", "latest_statement"),
            FieldMapping("monthly_payment", "loan.monthly_payment", "Monthly Payment", "latest_statement"),
            FieldMapping("estimated_total_monthly_payment", "loan.estimated_total_monthly_payment", "Estimated Total Monthly Payment", "latest_statement"),
            FieldMapping("principal_due", "loan.principal_due", "Principal Due", "latest_statement", "statement_principal"),
            FieldMapping("interest_due", "loan.interest_due", "Interest Due", "latest_statement", "statement_interest"),
            FieldMapping("escrow_amount", "loan.escrow_amount", "Escrow Amount", "latest_statement", "statement_escrow"),
            FieldMapping("escrow_included", "loan.escrow_included", "Escrow Included", "latest_statement", "statement_escrow"),
            FieldMapping("principal_paid_ytd", "loan.principal_paid_ytd", "Principal Paid YTD", "latest_statement"),
            FieldMapping("interest_paid_ytd", "loan.interest_paid_ytd", "Interest Paid YTD", "latest_statement"),
            FieldMapping("projected_principal_fy", "loan.projected_principal_fy", "Projected Principal FY", "latest_statement"),
            FieldMapping("projected_interest_fy", "loan.projected_interest_fy", "Projected Interest FY", "latest_statement"),
            FieldMapping("mortgage_tenure_covered", "loan.mortgage_tenure_covered", "Mortgage Tenure Covered", "latest_statement"),
            FieldMapping("property_tax_amount", None, "Property Tax Amount", "verify_only", "tax_document"),
            FieldMapping("statement_date", "loan.statement_date", "Statement Date", "latest_statement"),
            FieldMapping("payment_due_date", "loan.payment_due_date", "Payment Due Date", "latest_statement"),
        ),
    ),
    "1098": DocumentTypeConfig(
        category="1098",
        label="Form 1098 Mortgage Interest Statement",
        scope="property",
        verification="annual_interest_and_box2_balance",
        notes="Box 1 interest may combine old and new lenders in a refinance year. Box 2 principal balance uses the latest loan by Box 3/11 dates unless multiple active loans are clearly present.",
        fields=(
            FieldMapping("tax_year", "document.statement_year", "Tax Year", "identity", "year"),
            FieldMapping("account_number", "loan.account_number", "Account Number", "identity", "loan_match"),
            FieldMapping("lender_name", "loan.lender_name", "Lender", "identity"),
            FieldMapping("mortgage_interest", None, "Box 1 Mortgage Interest", "sum_distinct_accounts", "1098_interest"),
            FieldMapping("current_balance", None, "Box 2 Outstanding Principal", "latest_loan_balance", "1098_balance"),
            FieldMapping("origination_date", "loan.origination_date", "Box 3 Mortgage Origination Date", "identity", "loan_timeline"),
            FieldMapping("mortgage_acquisition_date", None, "Box 11 Mortgage Acquisition Date", "verify_only", "loan_timeline"),
            FieldMapping("mortgage_insurance", None, "Box 5 Mortgage Insurance Premiums", "verify_only"),
            FieldMapping("points_paid", None, "Box 6 Points Paid", "verify_only"),
            FieldMapping("property_tax_amount", None, "Box 10 Real Estate Taxes Paid", "verify_only", "tax_document"),
        ),
    ),
    "tax_return": DocumentTypeConfig(
        category="tax_return",
        label="Tax Return / Schedule E",
        scope="portfolio",
        verification="annual_tax_return_entries",
        notes="Schedule E creates TaxReturnEntry rows per property. It is the preferred filed source for rents, taxes, depreciation, and deductible interest.",
        fields=(
            FieldMapping("tax_year", "tax_return_entries.tax_year", "Tax Year", "identity", "year"),
            FieldMapping("rents_received", "tax_return_entries.rents_received", "Rents Received", "upsert_year_property", "rental_income"),
            FieldMapping("mortgage_interest", "tax_return_entries.mortgage_interest", "Mortgage Interest", "upsert_year_property", "tax_interest"),
            FieldMapping("property_taxes", "tax_return_entries.property_taxes", "Property Taxes", "upsert_year_property", "tax_expense"),
            FieldMapping("depreciation", "tax_return_entries.depreciation", "Depreciation", "upsert_year_property", "depreciation"),
            FieldMapping("total_expenses", "tax_return_entries.total_expenses", "Total Expenses", "upsert_year_property", "operating_expense"),
            FieldMapping("net_income", "tax_return_entries.net_income", "Net Income", "upsert_year_property", "net_income"),
            FieldMapping("days_rented", "tax_return_entries.days_rented", "Days Rented", "upsert_year_property", "occupancy"),
            FieldMapping("personal_use_days", "tax_return_entries.personal_use_days", "Personal Use Days", "upsert_year_property", "occupancy"),
        ),
    ),
    "closing_statement": DocumentTypeConfig(
        category="closing_statement",
        label="Closing Statement",
        scope="property",
        verification="acquisition_basis",
        notes="Closing statement sets acquisition fields and down payment/original loan fields when present.",
        fields=(
            FieldMapping("purchase_price", "property.purchase_price", "Purchase Price", "authoritative"),
            FieldMapping("purchase_date", "property.purchase_date", "Purchase Date", "authoritative"),
            FieldMapping("purchase_date_source", None, "Purchase Date Source", "verify_only"),
            FieldMapping("recorded_date", "property.recorded_date", "Recorded Date", "authoritative"),
            FieldMapping("settlement_total_amount", "property.settlement_total_amount", "Total Amount", "authoritative"),
            FieldMapping("closing_costs", "property.closing_costs", "Closing Costs", "authoritative"),
            FieldMapping("annual_property_tax", "property.property_tax", "Annual Property Tax", "authoritative", "tax_document"),
            FieldMapping("annual_insurance", "property.insurance", "Annual Insurance", "authoritative", "insurance"),
            FieldMapping("hoa_annual", "property.hoa_fee", "Annual HOA", "annual_to_monthly"),
            FieldMapping("original_amount", "loan.original_amount", "Original Loan Amount", "identity"),
            FieldMapping("down_payment", "property.down_payment", "Down Payment", "identity"),
            FieldMapping("original_ltv", "loan.original_ltv", "Original LTV", "identity"),
            FieldMapping("loan_product", "loan.loan_product", "Loan Product", "identity"),
            FieldMapping("escrow_included", "loan.escrow_included", "Escrow Included", "identity"),
        ),
    ),
    "1099": DocumentTypeConfig(
        category="1099",
        label="Form 1099",
        scope="property",
        verification="annual_income",
        notes="1099 forms are verification inputs for annual income; they do not overwrite property rent by themselves.",
        fields=(
            FieldMapping("tax_year", "document.statement_year", "Tax Year", "identity", "year"),
            FieldMapping("rents_received", None, "Reported Income", "verify_only", "rental_income"),
        ),
    ),
    "property_tax": DocumentTypeConfig(
        category="property_tax",
        label="Property Tax Bill",
        scope="property",
        verification="annual_property_tax",
        notes="Property tax documents verify yearly tax expense; duplicate bills for one year use the max amount, not a sum.",
        fields=(
            FieldMapping("tax_year", "document.statement_year", "Tax Year", "identity", "year"),
            FieldMapping("property_tax_amount", None, "Property Tax Amount", "max_per_year", "tax_document"),
        ),
    ),
    "loan_disclosure": DocumentTypeConfig(
        category="loan_disclosure",
        label="Loan Disclosure",
        scope="property",
        verification="loan_terms",
        notes="Loan disclosure owns origination loan terms; later mortgage statements own current payment/balance snapshots.",
        fields=(
            FieldMapping("account_number", "loan.account_number", "Account Number", "identity", "loan_match"),
            FieldMapping("original_amount", "loan.original_amount", "Original Amount", "identity"),
            FieldMapping("interest_rate", "loan.interest_rate", "Interest Rate", "identity"),
            FieldMapping("loan_term_years", "loan.loan_term_years", "Loan Term Years", "identity"),
            FieldMapping("origination_date", "loan.origination_date", "Origination Date", "identity"),
            FieldMapping("maturity_date", "loan.maturity_date", "Maturity Date", "identity"),
        ),
    ),
    "bank_statement": DocumentTypeConfig(
        category="bank_statement",
        label="Bank Statement",
        scope="property",
        verification="cash_activity",
        notes="Bank statements are retained as source documents; extracted fields are verification-only until explicit transaction import exists.",
        fields=(),
    ),
    "deed_title": DocumentTypeConfig(
        category="deed_title",
        label="Deed / Title",
        scope="property",
        verification="source_document",
        notes="Stored for the ownership/title checklist; no automatic database writes.",
        fields=(),
    ),
    "insurance_declaration": DocumentTypeConfig(
        category="insurance_declaration",
        label="Insurance Policy Declaration",
        scope="property",
        verification="annual_insurance",
        notes="Insurance declarations verify the annual homeowner/landlord insurance premium for the checklist.",
        fields=(
            FieldMapping("tax_year", "document.statement_year", "Tax Year", "identity", "year"),
            FieldMapping("annual_insurance", "property.insurance", "Annual Insurance", "verify_only", "insurance"),
        ),
    ),
    "expense_receipt": DocumentTypeConfig(
        category="expense_receipt",
        label="Operating Expense Receipt",
        scope="property",
        verification="source_document",
        notes="Stored for the monthly operating-expense checklist; no automatic database writes.",
        fields=(),
    ),
    "other": DocumentTypeConfig(
        category="other",
        label="Other Document",
        scope="property",
        verification="source_document",
        notes="Stored for review; no automatic database writes.",
        fields=(),
    ),
}


def get_document_config(category: str | None) -> DocumentTypeConfig:
    return DOCUMENT_TYPE_CONFIG.get(category or "other", DOCUMENT_TYPE_CONFIG["other"])


def config_as_dict(category: str | None) -> dict[str, Any]:
    cfg = get_document_config(category)
    return {
        **asdict(cfg),
        "fields": [asdict(f) for f in cfg.fields],
    }


def mapped_loan_fields(category: str | None) -> set[str]:
    fields = set()
    for field in get_document_config(category).fields:
        if field.target and field.target.startswith("loan."):
            fields.add(field.target.split(".", 1)[1])
    return fields


def mapped_property_fields(category: str | None) -> dict[str, str]:
    fields = {}
    for field in get_document_config(category).fields:
        if field.target and field.target.startswith("property."):
            fields[field.source] = field.target.split(".", 1)[1]
    return fields


def extraction_schema(category: str | None, data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for field in get_document_config(category).fields:
        rows.append({
            "source": field.source,
            "target": field.target,
            "label": field.label,
            "merge": field.merge,
            "verify_role": field.verify_role,
            "value": data.get(field.source),
            "present": data.get(field.source) is not None,
            "notes": field.notes,
        })
    return rows
