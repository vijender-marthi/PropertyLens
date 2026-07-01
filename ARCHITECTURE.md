# PropertyLens Architecture

## Rule

All parsing, calculations, comparisons, merge decisions, and database field mappings live in the backend.

The frontend must not implement business logic. React renders backend-provided data, labels, statuses, and display metadata only.

## Flow

```text
UI/UX
  -> API client
  -> Backend controller/router
  -> Manager/service layer
  -> Database
```

## Responsibilities

### UI/UX

Allowed:

- Render fields returned by API responses.
- Send user input to backend APIs.
- Render backend-provided labels, table rows, status text, warnings, and mappings.
- Format simple presentation values only when the backend already provides the value meaning.

Not allowed:

- Parsing uploaded documents.
- Deciding which document value wins.
- Calculating portfolio, property, tax, loan, depreciation, cash flow, or verification metrics.
- Comparing sources or determining mismatch severity.
- Mapping document fields to database fields.
- Deciding whether balances should be summed, deduplicated, or selected from latest document.

### API Client

The frontend service layer is a thin transport wrapper.

Required document APIs:

- `GET /api/documents/config`
  Returns all backend-owned document type configs, UI labels, field mappings, merge rules, and verification roles.
- `POST /api/documents/upload`
  Uploads a document and returns parsed data, document config, extraction schema, and backend-applied fields.
- `POST /api/documents/{doc_id}/reparse`
  Re-runs backend parsing and returns parsed data plus backend mapping/schema.
- `POST /api/documents/{doc_id}/apply`
  Applies backend-approved fields and returns applied fields plus mapping/schema.
- `GET /api/properties/{prop_id}/rawdata`
  Returns backend-prepared verification data. React should render these rows, not recompute them.

### Controller/Router

Controllers validate request shape, permissions, and route to service/manager functions.

Examples:

- `backend/routers/documents.py`
  Handles upload, list, reparse, apply, delete.
- `backend/routers/properties.py`
  Handles property metrics, performance, lifetime, raw verification data.

Controllers should not accumulate new business rules. When a route needs logic, move it into a service/manager module.

### Manager/Service Layer

Services own the business process.

Current backend-owned services:

- `backend/services/document_parser.py`
  Extracts fields from uploaded documents.
- `backend/services/document_config.py`
  Defines document type configs, field mappings, database targets, merge strategies, and verification roles.

Required pattern for every document type:

```text
document category
  -> parser extracts normalized source fields
  -> config maps source fields to database/UI fields
  -> service applies merge strategy
  -> service builds verification values/statuses
  -> controller returns render-ready API response
```

### Database

Database stores normalized state and raw source evidence:

- `properties`
- `loans`
- `documents`
- `tax_return_entries`
- `rental_periods`

Uploaded documents keep `extracted_data` as source evidence. Normalized fields are written only through backend mapping rules.

## Document Config Contract

Each document type must define:

- `category`
- `label`
- `scope`
- `fields`
- `verification`
- `notes`

Each field mapping must define:

- `source`: parser output field.
- `target`: database field path, or `null` for verification-only values.
- `label`: UI label from backend.
- `merge`: backend merge strategy.
- `verify_role`: how the value participates in verification.
- `notes`: optional backend explanation.

Example:

```json
{
  "source": "current_balance",
  "target": null,
  "label": "Box 2 Outstanding Principal",
  "merge": "latest_loan_balance",
  "verify_role": "1098_balance"
}
```

## Calculation Ownership

Backend owns all calculations:

- Monthly cash flow.
- Expense prorating.
- Depreciation basis and annual depreciation.
- Property tax and insurance treatment.
- Escrow treatment.
- Mortgage interest totals.
- Principal and outstanding balance decisions.
- Source discrepancy detection.
- Duplicate document detection.
- Refinance-year handling.
- Verification status and warning text.

React must not calculate these values. If a page needs a value, add it to an API response.

## Document Processing Rules

### General

Every uploaded document follows the same backend process:

1. Detect or accept document category.
2. Parse document into normalized source fields.
3. Load document config for the category.
4. Build extraction schema from config and parsed fields.
5. Apply only mapped fields to database.
6. Apply category-specific merge rules.
7. Store raw extracted data on the document.
8. Return parsed data, schema, applied fields, and verification metadata to the UI.

### Mortgage Statement

Mortgage statements are point-in-time snapshots. Latest statement date wins for current loan fields.

### Form 1098

Form 1098 is annual. Box 1 interest can combine old and new refinance lenders for the same year.

Box 2 outstanding principal is not summed unless backend evidence shows multiple active loans at the same time. In refinance cases, backend uses Box 3 Mortgage Origination Date and Box 11 Mortgage Acquisition Date to select the latest loan balance.

### Tax Return / Schedule E

Tax return data creates or updates `TaxReturnEntry` rows by year and property. Schedule E values are preferred filed-source values for annual rent, mortgage interest, property tax, depreciation, expenses, and net income.

### Closing Statement

Closing statements set acquisition and basis fields such as purchase price, purchase date, taxes, insurance, HOA, original loan amount, and down payment.

## API Response Shape

Document APIs should include:

```json
{
  "extracted_data": {},
  "document_config": {},
  "extraction_schema": [],
  "auto_applied": {},
  "verification": {}
}
```

Property verification APIs should include backend-prepared rows:

```json
{
  "verify": {
    "sections": [
      {
        "key": "principal_balance",
        "title": "Principal & Outstanding Balance",
        "rows": []
      }
    ],
    "issues": []
  }
}
```

The frontend should map these rows to tables directly.

## Adding a New Document Type

1. Add parser logic in `backend/services/document_parser.py`.
2. Add field mappings in `backend/services/document_config.py`.
3. Add service merge/verification logic if needed.
4. Return mapping/schema in the API response.
5. Update React only to render new backend fields, not to calculate them.

