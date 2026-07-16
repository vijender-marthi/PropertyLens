# Current Standards Violations

This report records known standards debt at the time the standards framework was introduced. These items must not be expanded. New code should satisfy the standards even when nearby legacy code does not.

## Critical

- Frontend pages still contain some financial derivations and fallback calculations, especially in `frontend/src/pages/PropertyDetailPage.jsx`, `frontend/src/pages/DashboardPage.jsx`, `frontend/src/pages/ReportsPage.jsx`, and form-preview code in `frontend/src/pages/PropertyFormPage.jsx`.
- Some frontend views still assemble metric notes, fallback values, and chart data from local objects instead of exclusively rendering backend Metric Vault DTOs.
- These formula-related issues are flagged for separate Metric Vault migration review. Do not silently change backend formulas or UI calculations while addressing visual tasks.

## High

- Shared formatter adoption is mostly in place for UI number formatting. Direct `Intl.NumberFormat`, `.toLocaleString()`, and `.toFixed()` display calls are currently restricted to the approved formatter utility.
- Some chart and tooltip styling still uses inline Recharts props and hardcoded style objects in `frontend/src/pages/DashboardPage.jsx`, `frontend/src/pages/PropertyDetailPage.jsx`, and `frontend/src/components/AmortizationModal.jsx`.
- Some report and dashboard components still use local aliases such as `reportMoney` or `fmtAxis`. These aliases call the shared formatter today, but new code should prefer clear formatter imports and avoid page-level formatting abstractions.

## Medium

- Hardcoded hex colors remain in dashboard/property chart definitions, landing page styles, upload status maps, and report KPIs.
- Inline font-size props remain in dashboard/property chart tick and tooltip definitions.
- Several table-like layouts are implemented directly in page components. A shared DataTable migration is still needed before strict enforcement can block all custom tables.
- Some forms still use page-local numeric preview behavior. This should be consolidated into shared form fields over time.

## Low

- The landing page includes static marketing metrics such as `$3.8M`. These are not business calculations but should still use shared display conventions if made dynamic.
- README legacy formula examples may not fully match Metric Vault terminology. The canonical rule is now `docs/standards/DOMAIN_RULES.md`.

## Baseline Commands

Useful audit commands:

```bash
rg -n "toLocaleString\\(|Intl\\.NumberFormat|\\.toFixed\\(" frontend/src -g '!frontend/src/utils/formatters.js'
rg -n "fontSize\\s*:|#[0-9a-fA-F]{3,8}" frontend/src/pages frontend/src/components
rg -n "capRate|cashFlow|loanBalance|totalReturn|depreciation|taxBenefit|equity|LTV|NOI" frontend/src backend/services backend/routers
```

## Required Follow-Up

1. Continue moving frontend financial fallback calculations into backend Metric Vault DTOs.
2. Introduce or finish a shared DataTable component before blocking all custom table markup.
3. Move chart colors and typography into tokens before enabling hard failure for every color/font violation.
4. Keep `npm run standards:check` passing and expand it as debt is retired.

## Progress Log

- Chart tokens introduced in `frontend/src/utils/chartTokens.js`.
- `frontend/src/components/AmortizationModal.jsx` and `frontend/src/components/LoanCard.jsx` no longer contain local chart hex colors or inline chart font-size props.
- Standards warning baseline reduced from 425 to 414.
- Shared `DataTable` introduced in `frontend/src/components/DataTable.jsx`.
- `frontend/src/components/AmortizationModal.jsx` amortization schedule migrated to `DataTable`.
- Metric display components now support `backendOwned` rendering.
- Primary Property Details KPI and Details metric cards now avoid locally calculated fallback display when a backend Metric Vault DTO is present.
- Summary tab metric cards now use backend-owned DTO display for Metric Vault and summary DTO values where available.
- Shared metric components now support both `displayValue` and `display` DTO fields.
- Verify tab sorting now uses backend-provided sort option metadata (`direction`, `valueType`) instead of frontend check-specific sort rules.
- Verification backend tests now assert sort option metadata and issue sort-key coverage.
- Verify comparison details now use shared `DataTable` and render backend-provided comparison display strings unchanged.
- Reports page no longer uses the local `reportMoney` display-formatting alias; report KPI values call the shared formatter directly.
- Admin users table migrated to shared `DataTable` with search, sorting, and current-view CSV export.
- Document upload preview field and per-property Schedule E tables migrated shared `DataTable`; preview confidence display now uses shared `formatPercent`.
- Uploads page preview field and per-property Schedule E tables migrated shared `DataTable`.
- Property Details usage income table migrated shared `DataTable` with Year ascending default sort.
- Property Details depreciation recorded-use history table migrated shared `DataTable` with Year ascending default sort.
- Property Details depreciation asset table migrated shared `DataTable` with in-service date ascending default sort.
- Reports property performance table migrated shared `DataTable` while preserving rental portfolio total row.
- Reports cash-flow yearly trends and debt loan-detail tables migrated shared `DataTable`; Reports page has no custom table markup left.
- Dashboard loan summary table migrated shared `DataTable`.
- Shared `DataTable` now supports optional row props; Dashboard property performance table migrated while preserving row navigation.
- Dashboard Property Health table migrated shared `DataTable` while preserving primary/rental row presentation.
- Dashboard net income heatmap matrix migrated shared `DataTable`; Dashboard page has no custom table markup left.
- Property Details checklist annual document matrix migrated shared `DataTable`.
- Property Details tax comparison "All Properties" table migrated shared `DataTable`; shared `DataTable` now exposes `getRowProps`.
- Property Details Summary yearly performance table migrated shared `DataTable` with Year ascending default sort.
- Property Details tax summary primary/rental yearly model table migrated shared `DataTable` with Year ascending default sort.
- Raw Data normal UI/export now hides technical identifiers and engine/audit metadata; records use business-friendly document labels.
- Property Details remaining Raw Data, Scenario, Tax History, Rental by Year, and Summary trend tables migrated shared `DataTable`; page-level custom table markup retired.
- Dashboard inline font-size chart and micro-visual typography warnings retired through shared chart typography tokens and utility classes.
- Property Details chart inline font-size warnings retired through shared chart typography tokens; pages/components now have no `fontSize` matches.

- Dashboard chart and micro-visual hardcoded hex/rgba color warnings retired through shared chart color tokens.

- Landing page hardcoded hex/rgba palette warnings retired through shared landing design tokens.

- Property Details chart hardcoded hex color warnings retired through shared chart color tokens.

- Reports page hardcoded KPI color warnings retired through shared chart color tokens.

- Uploads page hardcoded color warnings retired through shared chart color tokens.
