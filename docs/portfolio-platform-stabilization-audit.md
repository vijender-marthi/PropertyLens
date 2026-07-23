# Portfolio Platform Stabilization Audit

Date: 2026-07-18

## Scope

This audit covers the portfolio Loans, Tax Center, Analytics, and Income & Expenses pages. It does not change property-level loan amortization, document parsing, escrow allocation, or depreciation rules.

## Shared Backend Contract

All four pages now consume `GET /api/properties/analysis/portfolio`, schema `portfolio-analysis.v1`.

The request contract supports:

- selected property IDs;
- explicit empty selection;
- primary-residence inclusion;
- date range and comparison period;
- accounting basis;
- active-loan and loan-status filters;
- tax year;
- scenario ID.

The response includes traceable metric DTOs with formula, inputs, included/excluded scope, period, source, status, and calculation timestamp. Chart series and category percentages are produced by the backend.

## Canonical Definitions

| Metric | Backend definition |
| --- | --- |
| Operating expenses | Property tax + insurance + HOA + repairs/maintenance + management + utilities + other operating costs; excludes debt service, capital expenditures, and depreciation |
| NOI | Effective rental income - operating expenses |
| Debt service | Principal and interest only; escrow is excluded |
| Cash flow after debt | NOI - principal-and-interest debt service |
| Cash-on-cash return | Annual pre-tax cash flow / down payment plus closing costs |
| Cap rate | Annual NOI / current market value |
| DSCR | Annual NOI / annual principal-and-interest debt service |
| LTV | Active logical-loan balance / current market value |
| Equity | Current market value - active logical-loan balance |

## Audit Results

| Area | Previous risk | Stabilized behavior |
| --- | --- | --- |
| Loans | Frontend totals, synthetic balance trend, hard-coded DTI | Backend active-loan totals, weighted rate, P&I, reported paydown series; DTI is unavailable without verified income |
| Loan lifecycle | Closed/refinanced debt could leak into current totals | Closed, refinanced, and paid-off loans are excluded from active balance and payment KPIs |
| Tax Center | Frontend deduction/tax calculations and category percentages | Backend Schedule E aggregation, category percentages, trend, assumptions, and reconciliation assertion |
| Income & Expenses | Inconsistent property filtering | Shared explicit selection contract; rental metrics exclude primary-residence activity by definition |
| Analytics | Synthetic equity/occupancy history and frontend ranking/math | Backend waterfall, performance points/ranking, expense percentages, and current equity snapshot; absent history is shown as unavailable |
| Filters | Empty selection could silently become all properties | Explicit empty selection is represented and tested |
| Current-year Schedule E | Statement `interest_due` could be dropped when YTD interest was absent | Reported current-payment interest is retained as the documented fallback |

## Reconciliation Assertions

The backend response includes assertions for:

- active loan balance equals Analytics debt;
- Income & Expenses NOI equals the Analytics NOI input;
- Income & Expenses cash flow equals the final waterfall value;
- loan row balances equal the active loan KPI;
- tax categories equal total deductions;
- waterfall running total equals cash flow.

## Deliberate Unavailable States

- DTI remains unavailable until verified borrower gross income is stored.
- Historical occupancy is not drawn until period snapshots exist.
- Equity growth is not inferred from a current value; a current snapshot is returned instead.
- Forecast and scenario tabs show backend-provided unavailable reasons until persisted assumptions/scenarios exist.
- Monthly Income & Expenses history is not fabricated from annual rows.

## Verification

- Backend full suite: `289 passed`.
- Focused portfolio/Schedule E suite: `24 passed`.
- Frontend production build: passed.
- Frontend formatter standards test: passed.

## Residual Engineering Work

- The shared endpoint currently resolves property debt and Schedule E payloads per property in one request. Add batched repository queries before materially increasing portfolio size.
- The frontend production bundle is approximately 2 MB before gzip. Route-level code splitting should be handled as a separate performance change.
- CSV exports remain page-specific client downloads. Move them to a backend export endpoint when audit-stamped, server-generated files are required.
