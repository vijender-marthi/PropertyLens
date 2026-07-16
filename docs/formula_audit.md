# Formula Audit

This audit was created for the Help Center formula-catalog migration. It identifies the current source of truth and known drift without changing historical calculated values.

| Metric | Current Backend Formula | Current Frontend Formula | Expected Formula | Difference | Risk | Files Affected | Recommended Fix |
|---|---|---|---|---|---|---|---|
| Help Center formulas | Backend formulas are distributed across `property_engine`, `metric_vault`, document parsing, and property router DTO helpers. | Legacy `HelpPage.jsx` hardcoded formula text, examples, tags, and an XLSX mapping export. | Frontend renders formula definitions from `/api/help/formulas`. | Help documentation duplicated backend formula knowledge in React. | Formula drift between Help, tooltips, and backend engine behavior. | `frontend/src/pages/HelpPage.jsx`, `backend/services/formula_catalog.py`, `backend/routers/help.py` | Use the backend formula catalog as the only Help definition source. |
| Summary and loan metrics | `compute_property_metrics` and Metric Vault DTOs own current values; loan calculations are backend-owned. | Some legacy components still contain fallback display math when backend-owned DTOs are unavailable. | Displayed metrics should use backend DTO values and stable metric keys. | Known standards debt remains outside this Help Center change. | Fallbacks can drift from engine values if activated. | `frontend/src/pages/PropertyDetailPage.jsx`, `frontend/src/components/LoanCard.jsx` | Continue the Metric Vault migration separately. Do not change historical calculations as part of Help redesign. |
| Escrow, tax, and insurance | `resolve_annual_operating_expenses` and related source-resolution helpers choose annual expense sources and keep debt service as P&I-only. | Frontend renders source badges and document controls. | Catalog documents escrow as a payment mechanism, not a duplicate final property expense. | Catalog now documents the backend source-precedence rule. | Users may interpret escrow as an added expense without documentation. | `backend/routers/properties.py`, `backend/services/formula_catalog.py` | Keep source precedence in backend and reuse catalog text in Help and tooltips. |
| Depreciation | Backend depreciation endpoint computes per-asset straight-line schedules, accumulated depreciation, remaining basis, and assertions. | Depreciation tab renders backend values and chart rows. | Catalog describes land exclusion, asset-specific recovery periods, partial-year convention, accumulated depreciation, and remaining basis. | Documentation added; engine values unchanged. | Low after depreciation assertion tests; missing basis inputs can still make values unavailable. | `backend/routers/properties.py`, `backend/services/formula_catalog.py` | Surface backend missing-basis flags where applicable. |

## Notes

- The frontend still has known formula-related standards debt listed in `docs/standards/CURRENT_VIOLATIONS.md`.
- This migration does not silently recalculate existing property, loan, tax, rental, expense, or depreciation values.
- Formula catalog text is backend metadata. It is not a calculation engine and does not execute formulas.
