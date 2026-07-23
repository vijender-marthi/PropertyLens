# Loan Injection Process

How a loan gets created and populated in PropertyLens, the two entry points for
doing it, and the rules that decide which numbers win when several documents
describe the same loan.

---

## 1. Core principle

**A loan is a persistent record. Documents are only a *source of values*.**

- The loan's fields (original amount, rate, term, balance, escrow, dates…) are
  stored on the `loans` row.
- 1098s, mortgage statements, closing disclosures and settlement statements are
  uploaded to *populate* those fields. They are evidence, not the loan itself.
- Deleting documents never deletes or empties the loan. A loan is removed **only**
  when the user explicitly deletes it from the **Loans tab**.
- After import, the user can override any field by hand. Re-uploading a document
  refreshes the values again according to the priority rules below.

This separation is enforced in `_delete_document_and_dependents` (document delete
detaches the loan's links but keeps the loan) and in the loan DTO builders, which
skip links whose source document has been removed.

---

## 2. Data model

| Table | Purpose |
|-------|---------|
| `loans` | The persistent loan record and its current field values. |
| `loan_document_links` | Which documents contributed to a loan, with a **role** and **priority**, and which `fields_used` came from each. |
| `loan_balance_snapshots` | Point-in-time balances reported by mortgage statements (used for the "reported balance" reference and payment history). |
| `loan_servicer_segments` | Servicer-transfer history for one logical loan across lenders. |
| `property_transactions` / `transaction_loan_links` | The purchase/refinance event a loan originated from, rebuilt from closing/settlement documents. |

### Link roles (`loan_document_links.source_role`)

| Role | Meaning | Typical document |
|------|---------|------------------|
| `LOAN_ORIGINATION_SOURCE` / `ACQUISITION_SOURCE` | Establishes the loan's **origination terms** (original amount, rate, term, origination date). | Closing Disclosure / Settlement Statement |
| `REFINANCE_SOURCE` | Establishes a new debt that replaces a prior loan. | Refinance Closing Disclosure |
| `CURRENT_BALANCE_SOURCE` | Reports the **current balance** as of a statement date. | Mortgage statement |
| `SUPPORTING_SOURCE` | Corroborating evidence / annual figures. | Form 1098 |

---

## 3. Document precedence (how values are chosen)

When more than one document can fill the same field, the loan-field resolver
(`_loan_field_sources` in `services/loan_lifecycle.py`) ranks the candidate
documents by type and picks the highest-priority one **per field**:

| Priority | Document type |
|:-------:|---------------|
| 1 | Closing Disclosure · Payoff Statement |
| 2 | Settlement Statement |
| 3 | Loan Estimate |
| 4 | Mortgage Statement |
| 5 | Form 1098 |

Special cases:

- **Current balance** always comes from the **latest mortgage statement** (by
  statement date). It is stored with `current_balance_source =
  mortgage_statement_reported_balance`. A closing/settlement document only seeds
  an *initial* balance (`…_initial_balance`) that a later statement supersedes.
- **Origination terms** (original amount, rate, term, origination date) come
  from the Closing Disclosure / Settlement Statement first.
- **Annual interest (Box 1)** and **year-end outstanding principal (Box 2)** come
  from the 1098, matched to the loan by account number and year.
- Manual edits by the user override document-derived values until the field is
  re-imported.

### How the displayed balance is computed

`current_loan_balance()` returns the outstanding principal **today**, computed
from the loan's own amortization schedule (original amount, rate, term,
origination date) — no statement upload is required. It falls back to the
manually recorded / reported `current_balance` when there isn't enough data to
schedule a payoff. Mortgage statements provide the authoritative reported-balance
reference point and drive the "paid to date / interest to date" figures.

---

## 4. Path A — Injection through Property Setup

Used while first setting up a property. The financing section of the setup form
(`PropertyFormPage.jsx`) collects loan values, usually pre-filled from documents.

### A1. Closing / settlement document → property + loan

```
Upload file
  → POST /documents/upload/preview        (parse, detect type, dedupe check)
  → POST /documents/upload/accept          (persist the Document)
  → GET  /documents/{id}/setup-import-review
        · returns propertyFields (purchase price, closing costs, dates…)
        · returns loanDrafts[]  when the document carries loan terms
  → POST /documents/{id}/apply-setup-import
        · applies chosen property fields
        · seeds a loan draft in the setup form
```

- A **Closing Disclosure** (role `closing_document`) establishes both purchase
  price **and** loan terms.
- A **Settlement Statement** (role `settlement_document`) establishes purchase
  totals; its loan draft is offered for manual review/entry.
- "Buyer's funds to close" + earnest-money "Deposit" are mapped to **down
  payment**.

### A2. 1098 / mortgage statement / loan disclosure in setup

```
Upload file
  → POST /documents/upload/preview
  → POST /documents/upload/accept
  → GET  /documents/{id}/loan-statement-review     (loanFields with values)
  → POST /documents/{id}/apply-loan-statement       (loan_id optional)
```

For multiple loan documents at once, the consolidated flow is used instead:

```
  → POST /documents/loan-documents/consolidated-review
  → POST /documents/loan-documents/apply-consolidated
```

### A3. Finalize

```
  → POST /properties/{id}/setup-finalize
        { property, loans[], annual_expenses[] }
```

This is where the loan drafts in the form are **persisted** as `loans` rows
(created via `_find_setup_loan_match` → new `Loan`, or updated in place). Property
fields (including `solar_ownership`, HOA, etc.) are written here too.

> A loan can also be added manually in the financing section without any
> document — the fields are typed in and persisted on finalize.

---

## 5. Path B — Injection through the Loans tab

Used after the property exists, from **Loans → Add Loan** or the upload button on
an existing loan card (`LoanModal.jsx` / `LoanCard.jsx`).

### B1. Add Loan — manual entry

```
Fill the Add Loan form (vendor, type, amount, balance, rate, term, dates…)
  → POST /properties/{id}/loans        (creates a persistent Loan row)
```

### B2. Add Loan — prefill from a statement

```
"Upload loan statement"
  → POST /documents/upload/preview     (category auto-detected)
  → POST /documents/upload/accept       (reuses an existing copy if duplicate)
  → GET  /documents/{id}/loan-statement-review
        · the reviewed loanFields pre-fill the Add Loan form for confirmation
  → user reviews / edits
  → POST /properties/{id}/loans         (creates the Loan)
```

### B3. Upload a document to an existing loan

From a loan card's upload button, the file is applied directly to that loan:

```
  → POST /documents/upload/preview
  → POST /documents/upload/accept       (loan_id = this loan)
  → GET  /documents/{id}/loan-statement-review
  → POST /documents/{id}/apply-loan-statement   { loan_id, selected_loan_fields }
        · mortgage statement  → updates current balance / escrow / payment
        · 1098                → updates annual interest & year-end principal
        · closing disclosure  → applies origination terms
```

`apply-loan-statement` runs `resolve_canonical_loan`, which matches the document
to the correct existing loan (by account number / amount / rate) and records a
`loan_document_link` with the appropriate role and priority. Periodic documents
(mortgage statement, 1098) never create a new loan — they must attach to one.

---

## 6. Persistence & deletion rules

| Action | Effect on the loan |
|--------|--------------------|
| Delete one document | Loan **kept**. Its link to that document is removed; values already saved on the loan remain. |
| Delete **all** documents | Loan **kept** with all saved values. It simply has no source documents until you upload again. |
| Re-upload a document | Values refresh per the precedence rules; manual overrides are replaced only for the fields that document supplies. |
| Delete the loan (Loans tab) | Loan and all its links, balance snapshots, servicer segments and transaction links are removed. Documents stay on the property so the loan can be re-imported. |

Implementation notes:

- `delete_document` → `_delete_document_and_dependents` nulls the loan's
  `source_document_id` and deletes the document's `loan_document_links`,
  `loan_balance_snapshots`, and `transaction_document_links` so no orphaned link
  is left behind (an orphaned link previously crashed the loan display and made
  the loan appear to vanish on reload).
- Loan DTO builders (`resolved_loan_dto`, `_loan_field_sources`,
  acquisition-source selection) defensively skip links whose document is `None`,
  so any pre-existing orphan is tolerated.
- `delete_loan` cascades the loan's own links/snapshots/segments and also clears
  non-cascaded references (escrow payments, resolution aliases/discrepancies) so
  the loan can be cleanly re-imported afterward.

---

## 7. Endpoint quick reference

| Endpoint | Used by | Purpose |
|----------|---------|---------|
| `POST /documents/upload/preview` | Both paths | Parse & classify a file; dedupe check. |
| `POST /documents/upload/accept` | Both paths | Persist the Document (optionally `loan_id`). |
| `GET /documents/{id}/setup-import-review` | Setup | Property + loan draft from a closing/settlement doc. |
| `POST /documents/{id}/apply-setup-import` | Setup | Apply reviewed property/loan fields to the setup draft. |
| `GET /documents/{id}/loan-statement-review` | Both | Reviewed loan fields from a statement / 1098 / disclosure. |
| `POST /documents/{id}/apply-loan-statement` | Both | Apply loan fields to a specific loan (`loan_id`). |
| `POST /documents/loan-documents/consolidated-review` | Setup | Review several loan docs together. |
| `POST /documents/loan-documents/apply-consolidated` | Setup | Apply the consolidated loan table. |
| `POST /properties/{id}/setup-finalize` | Setup | Persist property + loans + expenses. |
| `POST /properties/{id}/loans` | Loans tab | Create a loan (manual or prefilled). |
| `PUT /properties/{id}/loans/{loanId}` | Loans tab | Edit a loan. |
| `DELETE /properties/{id}/loans/{loanId}` | Loans tab | Explicitly delete a loan. |
| `DELETE /documents/{id}` | Documents tab | Delete a document (loan is kept). |

---

## 8. End-to-end example (Electra)

1. **Setup** — upload the Settlement Statement → purchase price $675,200, down
   payment $170,023.69 (deposit $40,500 + buyer's funds to close $129,523.69),
   loan draft $506,250 @ 6.5% / 30 yr → finalize → **loan created**.
2. **Loans tab** — upload the servicer "Loan Information" statement → current
   balance $496,610.30 as of the statement date (`CURRENT_BALANCE_SOURCE`).
3. **Loans tab** — upload the 2025 Form 1098 → Box 1 interest $32,678.20, Box 2
   year-end principal $505,332.22 (`SUPPORTING_SOURCE`).
4. Displayed balance is amortized forward from origination; statements/1098
   supply reported reference points and interest-to-date.
5. Delete every document → the loan still shows $506,250 / $496,610 / 6.5%.
   Delete the loan from the Loans tab → it is gone; the documents remain.
