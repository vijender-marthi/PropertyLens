import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { acquisitionFieldSources } from './propertySetupPresentation.js'

const acquisitionSources = acquisitionFieldSources({
  acquisition: {
    selectedFields: [
      {
        key: 'purchase_price',
        field: 'purchase_price',
        documentId: 41,
        sourceDocument: 'Purchase Closing Disclosure.pdf',
        sourceLabel: 'Closing Disclosure',
        page: 1,
        confidence: 0.99,
        selectionType: 'EXACT',
      },
      {
        key: 'settlement_accounting_total',
        field: 'settlement_accounting_total',
        documentId: 42,
        sourceDocument: 'Buyer Settlement Statement.pdf',
        sourceLabel: 'Settlement Statement',
      },
      {
        key: 'cash_to_close',
        field: 'cash_to_close',
        documentId: null,
        sourceLabel: 'Resolved transaction',
      },
    ],
  },
})

assert.deepEqual(Object.keys(acquisitionSources), ['purchase_price', 'settlement_accounting_total'])
assert.deepEqual(acquisitionSources.purchase_price, {
  label: 'from Closing Disclosure',
  tone: 'reported',
  title: 'Closing Disclosure source details',
  documentId: 41,
  documentName: 'Purchase Closing Disclosure.pdf',
  page: 1,
  confidence: 0.99,
  selectionType: 'EXACT',
  sourceField: 'purchase_price',
})
assert.equal(acquisitionSources.settlement_accounting_total.documentId, 42)
assert.equal(acquisitionSources.settlement_accounting_total.sourceField, 'settlement_accounting_total')

const pageSource = readFileSync(new URL('../pages/PropertyFormPage.jsx', import.meta.url), 'utf8')

assert.equal(pageSource.includes('docAPI.delinkSetup(documentId)'), true)
assert.equal(pageSource.includes('propertySetupDisplayDocuments(loanLifecycle, settlementDocuments)'), true)
assert.equal(pageSource.includes('settlementReviewSummaries'), true)
assert.equal(pageSource.includes("doc.doc_category === 'closing_statement' && !(doc.module_tags || []).includes('SETUP_DELINKED')"), true)
assert.equal(pageSource.includes("title: 'Uploaded setup documents', usageLabel: 'Review imported fields'"), false)
assert.equal(pageSource.includes('setSettlementSources(acquisitionFieldSources(lifecycle))'), true)
assert.equal(pageSource.includes('function FieldSourceDetails'), true)
assert.equal(pageSource.includes('settlementSourcesFromDocument'), false)
assert.equal(pageSource.includes('label="Cash to close"'), false)
assert.equal(pageSource.includes('label="Settlement accounting total"'), true)
assert.equal(pageSource.includes("loanLifecycle?.acquisition?.settlementAccountingTotal?.display || (form.settlement_total_amount ? formatCurrency(toNumber(form.settlement_total_amount)) : '—')"), true)
assert.equal(pageSource.includes('label="Closing & title costs"'), true)
assert.equal(pageSource.includes('remaining title costs'), true)
assert.equal(pageSource.includes('loanFieldMatch'), true)
assert.equal(pageSource.includes('Object.entries(errors).filter'), true)
assert.equal(pageSource.includes('originalResidencyShowsRental(form.original_residency_status)'), true)
assert.equal(pageSource.includes("header: 'Source'"), true)
assert.equal(pageSource.includes('resolved.sourceSummary?.label'), true)
assert.equal(pageSource.includes('setLoanSourceDetails(resolved)'), true)
assert.equal(pageSource.includes('function LoanSourceDetailsDialog'), true)
assert.equal(pageSource.includes('details?.sections || []'), true)
assert.equal(pageSource.includes("field.selectionType || 'exact'"), true)
assert.equal(pageSource.includes('loanSourceDetails.selectedFields || []'), false)
assert.equal(pageSource.includes('ORIGINAL_RESIDENCY_OPTIONS.map'), true)
assert.equal(pageSource.includes('CURRENT_RESIDENCY_OPTIONS.map'), true)
assert.equal(pageSource.includes("const CURRENT_RESIDENCY_OPTIONS = [\n  { value: 'Primary', label: 'Primary Residence' },\n  { value: 'Rental', label: 'Rental' },\n]"), true)

console.log('property setup document-group tests passed')
