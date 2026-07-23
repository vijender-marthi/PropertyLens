import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const componentSource = readFileSync(new URL('./PrimaryPropertySummary.jsx', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../pages/PropertyDetailPage.jsx', import.meta.url), 'utf8')
const backendSource = readFileSync(new URL('../../../backend/services/metric_vault.py', import.meta.url), 'utf8')
const referenceUrl = new URL('../../../docs/ui-reference/primary-property-summary.png', import.meta.url)

assert.equal(existsSync(referenceUrl), true)
assert.equal(componentSource.includes('data-testid="primary-property-summary"'), true)
assert.equal(componentSource.includes('PrimaryPropertySummaryHeader'), false)
assert.equal(componentSource.includes('presentation.topMetrics'), true)
assert.equal(componentSource.includes('Value Buildup Over Time'), true)
assert.equal(componentSource.includes('presentation.valueBuildup'), true)
assert.equal(componentSource.includes('presentation.loanInformation'), true)
assert.equal(componentSource.includes('presentation.ownershipSections'), true)
assert.equal(componentSource.includes('presentation.wealthTrend'), true)
assert.equal(componentSource.includes('presentation.facts'), false)
assert.equal(componentSource.includes('presentation.notice'), false)
assert.equal(componentSource.includes('ValueListCard'), true)
assert.equal(componentSource.includes('tone="asset"'), true)
assert.equal(componentSource.includes('tone="liability"'), true)
assert.equal(componentSource.includes('xl:grid-cols-[minmax(15rem,0.9fr)_minmax(32rem,2.2fr)_minmax(15rem,0.9fr)]'), true)
assert.equal(pageSource.includes("const primarySummaryActive = activeTab === 'summary' && topIsPrimary"), true)
assert.equal(pageSource.includes("if (currentUse.includes('rental')) return false"), true)
assert.equal(pageSource.includes("if (currentUse.includes('primary')) return true"), true)
assert.equal(pageSource.includes("badgeFallback={topIsPrimary ? 'Primary Residence' : 'Rental Property'}"), true)
assert.equal(pageSource.includes('waterfall={metricVault?.primarySummary?.waterfall}'), true)
assert.ok(
  pageSource.indexOf('<RentalPropertySummaryHeader') < pageSource.indexOf('role="tablist"'),
  'property tabs must remain below the primary residence header',
)
assert.equal(backendSource.includes('def _primary_summary_presentation('), true)
assert.equal(backendSource.includes('"primarySummary": primary_summary'), true)
assert.equal(backendSource.includes('"title": "Liabilities"'), true)
assert.equal(backendSource.includes('"label": "Debt to Value (LTV)", "metricKey": "loanToValue"'), true)
assert.equal(backendSource.includes('"totalLabel": "Total Equity"'), true)
assert.equal(backendSource.includes('"totalMetricKey": "loanToValue"'), true)
assert.equal(backendSource.includes('"facts": []'), true)
assert.equal(backendSource.includes('"notice": None'), true)

for (const rentalMetric of ['Cash-on-Cash Return', 'Cap Rate', 'Rental NOI', 'Occupancy Rate', 'Monthly Cash Flow']) {
  assert.equal(componentSource.includes(rentalMetric), false, `Primary summary renders rental KPI: ${rentalMetric}`)
}

for (const forbidden of [
  'marketValue -',
  'loanBalance /',
  'annualCashFlow /',
  'monthlyPayment +',
  'Math.max(',
  'Math.min(',
]) {
  assert.equal(componentSource.includes(forbidden), false, `Primary summary contains frontend financial calculation: ${forbidden}`)
}

console.log('primary property summary presentation tests passed')
