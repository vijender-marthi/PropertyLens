# PropertyLens Architecture Constitution

This constitution is mandatory for all PropertyLens changes. It protects the Metric Vault architecture and separates backend business ownership from frontend rendering.

## 1. Backend Owns Business Calculations

The frontend must never calculate, reconcile, or infer financial business metrics, including:

- NOI
- Cap rate
- Cash flow
- Equity
- LTV
- Appreciation
- ROI
- Total return
- Mortgage payment
- Amortization
- Loan payoff
- Taxable income
- Depreciation
- Remaining basis
- Tax impact
- Financial recommendations

The frontend may only display values returned by backend APIs. When a UI needs a metric that an API does not provide, extend the backend API or DTO instead of recreating the formula in React.

## 2. Frontend Responsibilities

Frontend code is responsible for:

- Rendering backend-provided data
- User input and interaction state
- Client-side form validation for basic input shape
- Navigation and route state
- Loading, empty, stale, and error states
- Presentation and accessibility
- Calling APIs through approved clients
- Display formatting through the approved shared formatter only

Frontend code must not determine business truth, official status, severity, financial thresholds, or source authority.

## 3. Backend Responsibilities

Backend code owns:

- Calculations
- Validation
- Data normalization
- Metric definitions
- Formula descriptions
- Source lineage
- Business rules
- Scenario calculations
- Data reconciliation
- Audit metadata
- Metric Vault snapshots
- Verification and discrepancy classification

## 4. API-First Rule

- Frontend must not query the database directly.
- Frontend must not import backend engine modules.
- All data must cross defined API contracts.
- API response DTOs must be typed, documented, and versioned when shape changes are material.
- Business values must not be recomputed in the UI.
- Backend DTOs should provide raw values for machine use and display values for human use where needed.

## 5. Metric DTO Standard

Metric APIs should use this shape or an explicitly compatible version:

```json
{
  "value": 965313,
  "display": "$965K",
  "source": "calculated",
  "formula": "Market Value - Loan Balance",
  "inputs": [
    {
      "label": "Market Value",
      "value": 1800000,
      "display": "$1,800,000"
    },
    {
      "label": "Loan Balance",
      "value": 834687,
      "display": "$834,687"
    }
  ],
  "computation": "$1,800,000 - $834,687",
  "result": "$965,313",
  "asOfDate": "2026-07-09",
  "confidence": 1
}
```

DTO fields:

- `value`: raw value for sorting, exports, accessibility, or machine use.
- `display`: backend-owned user-facing value when semantics matter.
- `source`: reported, manual, imported, calculated, projected, approximate, or another approved source key.
- `formula`: plain-language formula when calculated.
- `inputs`: backend-selected source values.
- `computation`: human-readable computation string.
- `result`: full precision display string.
- `asOfDate`: date the value applies to.
- `confidence`: backend-owned confidence score or label.

## 6. Frozen Engine Rule

Engine formulas and DTO contracts are protected. UI feature work must not modify engine logic.

Any engine change requires:

- Explicit business-rule update
- Backend tests
- Migration impact review
- Documented approval
- Change-log entry
- API compatibility review

## 7. Verification Rule

The backend is the single source of truth for verification checks, statuses, severities, deltas, tolerances, explanations, recommendations, source navigation, provenance, confidence, and official counts.

Frontend Verify screens may render, search, filter, sort using backend-provided keys, manage selection, and navigate through structured backend metadata. They must not reconstruct verification details from loans, taxes, raw data, yearly, or summary endpoints.

