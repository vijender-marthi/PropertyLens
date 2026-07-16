# PropertyLens Domain Rules

This document records financial terms and formulas currently implemented or expected in PropertyLens. Do not invent or change formulas while editing this document. Formula inconsistencies must be flagged for separate review.

Primary backend sources inspected for this version:

- `backend/services/property_engine.py`
- `backend/services/metric_vault.py`
- `backend/services/loan_calculator.py`
- `backend/services/verification_vault.py`
- `backend/routers/properties.py`

## Domain Metric Register

| Metric | Definition | Formula / Current Source | Inputs | Source Priority | Null Handling | Sign Convention | Unit | Precision | API Field | Display Behavior | Type |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Purchase Price | Acquisition price for a property. | Stored property value. | Property purchase price. | Manual/property record. | Missing remains unavailable. | Positive asset value. | USD | Whole dollars. | `purchase_price` / metric DTO. | Compact on cards, full in tables. | Manual/reported |
| Market Value | Current estimated or manual property value. | Stored property value or backend metric snapshot. | Property market value. | Manual/valuation source, backend calculated snapshot. | Missing remains unavailable. | Positive asset value. | USD | Whole dollars. | `market_value`, `marketValue`. | Compact on cards, full in tables. | Manual/calculated |
| Loan Balance | Current outstanding debt. | Backend loan schedule, imported mortgage data, or Metric Vault debt metric. | Loans, mortgage statements, payment schedule. | Imported/reported, loan schedule, calculated. | Missing remains unavailable, not zero unless reported. | Positive liability value. | USD | Whole dollars. | `loan_balance`, `loanBalance`. | Compact on cards, full in tables. | Reported/calculated |
| Equity | Owner equity in the property. | Backend currently calculates as Market Value minus Loan Balance, with Metric Vault using non-negative equity in some contexts. | Market value, loan balance. | Calculated by backend. | Missing inputs should produce unavailable or backend-defined fallback. | Positive equity unless backend explicitly reports negative equity. | USD | Whole dollars. | `equity`. | Compact on cards, full in tables. | Calculated |
| LTV | Loan-to-value ratio. | Loan Balance divided by Market Value. | Loan balance, market value. | Calculated by backend. | Missing or zero market value remains unavailable. | Positive percentage. | Percent | Up to two decimals unless contract says otherwise. | `ltv`, `loanToValue`. | Percent display. | Calculated |
| NOI | Net operating income before debt service. | Backend annual income minus operating expenses where implemented. | Rent/income, operating expenses. | Tax return, imported documents, backend calculation. | Missing values stay unavailable unless backend applies documented fallback. | Positive income, negative loss. | USD/year | Whole dollars. | `noi`. | Compact on cards, full in tables. | Calculated |
| Cap Rate | Yield before debt service. | NOI divided by Market Value. | NOI, market value. | Calculated by backend. | Missing or zero market value remains unavailable. | Positive or negative percentage. | Percent | Up to two decimals. | `capRate`. | Percent display. | Calculated |
| Cash Flow | Income remaining after operating costs and debt service. | Backend Metric Vault currently uses yearly row cash flow or income minus operating expenses minus debt service. | Income, operating expenses, debt service. | Backend metric/yearly data. | Backend-owned fallback only. | Positive inflow, negative outflow. | USD | Whole dollars. | `cashFlow`, `monthly_cash_flow`. | Compact on cards when metric, full in tables. | Calculated |
| Principal Paid | Loan principal reduction over a period. | Backend loan schedule / imported payment data. | Loan amortization rows, mortgage documents. | Reported/imported, calculated schedule. | Missing remains unavailable. | Positive paid amount. | USD | Whole dollars. | `principal_paid`. | Full in tables, compact in cards if applicable. | Reported/calculated |
| Interest Paid | Loan interest paid over a period. | Backend loan schedule, Form 1098, or mortgage statements. | 1098, mortgage documents, amortization rows. | Reported tax/mortgage source preferred where available. | Missing remains unavailable. | Positive paid amount. | USD | Whole dollars. | `interest_paid`, `mortgage_interest`. | Full in tables. | Reported/calculated |
| Depreciation | Non-cash tax deduction for depreciable basis. | Backend property engine depreciation method and tax entries. | Basis, depreciation years, service date, tax entries. | Tax return reported values, backend schedule. | Missing basis/life remains unavailable or backend default as documented. | Positive deduction. | USD/year | Whole dollars. | `depreciation`. | Full in tables, compact in cards. | Reported/calculated |
| Remaining Basis | Undepreciated basis. | Backend depreciation schedule. | Depreciable basis, accumulated depreciation. | Calculated by backend. | Missing inputs remain unavailable. | Positive basis. | USD | Whole dollars. | `remaining_basis`. | Compact on cards, full in tables. | Calculated |
| Taxable Income | Tax income/loss after deductible expenses and depreciation. | Schedule E net income or backend tax calculation. | Rental income, expenses, interest, depreciation. | Tax return reported value preferred. | Missing stays unavailable. | Positive taxable income, negative tax loss. | USD/year | Whole dollars. | `taxable_income`, `net_income`. | Full in tables. | Reported/calculated |
| Total Return | Overall return measure from backend metric snapshot. | Backend Metric Vault currently uses yearly row total return or cash flow plus principal in some contexts. | Cash flow, principal, appreciation or backend row values. | Backend metric snapshot. | Backend-owned fallback only. | Positive gain, negative loss. | USD or percent by endpoint. | Endpoint-specific. | `totalReturn`, `totalReturnYtd`. | Compact for currency cards, percent for return rates. | Calculated |
| Cost to Own | Monthly outflow for ownership. | Backend/property form uses loan payments, tax, insurance, HOA, and other monthly costs where available. | Loan payment, property tax, insurance, HOA, other costs. | Backend calculation or form preview. | Missing components remain unavailable or zero only if backend declares zero. | Positive monthly cost. | USD/month | Whole dollars or one decimal compact in cards. | `monthlyCostToOwn`, `costToOwn`. | Compact monthly card display, full in tables. | Calculated |
| Appreciation | Change in property value. | Market Value minus Purchase Price. | Market value, purchase price. | Calculated by backend. | Missing inputs remain unavailable. | Positive gain, negative loss. | USD / Percent | Whole dollars / up to two decimals. | `appreciation`. | Compact on cards, full in tables. | Calculated |
| Loan Start Date | Start date of a loan. | Stored loan field. | Loan record. | Manual/imported. | Missing remains unavailable. | Not applicable. | Date | `MMM DD, YYYY`. | `start_date`. | Date formatter. | Reported/manual |
| Maturity Date | End date of a loan. | Stored loan field or calculated from term. | Start date, term, loan record. | Manual/imported, backend calculation. | Missing remains unavailable. | Not applicable. | Date | `MMM DD, YYYY`. | `maturity_date`. | Date formatter. | Manual/calculated |
| Amortization | Loan payment schedule over time. | `backend/services/loan_calculator.py`. | Principal, rate, term, payment date, extra payments. | Backend calculation. | Missing required loan inputs should fail validation or remain unavailable. | Balances positive, paid amounts positive. | USD/time | Whole dollars. | Loan schedule DTOs. | Full in tables, compact chart axes. | Calculated |

## Known Formula Review Items

- Some Metric Vault contexts clamp equity to non-negative while other financial views may need to show negative equity. Review before changing.
- `totalReturn` has endpoint-specific meanings. Standardize through Metric Vault DTOs before adding new UI.
- Form live previews may calculate temporary user-input projections. These are allowed only as editable form preview behavior and must not be presented as authoritative backend metrics.

