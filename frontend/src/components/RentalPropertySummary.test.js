import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const componentSource = readFileSync(new URL('./RentalPropertySummary.jsx', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../pages/PropertyDetailPage.jsx', import.meta.url), 'utf8')
const backendSource = readFileSync(new URL('../../../backend/services/metric_vault.py', import.meta.url), 'utf8')
const referenceUrl = new URL('../../../docs/ui-reference/rental-property-summary.png', import.meta.url)

assert.equal(existsSync(referenceUrl), true)
assert.equal(componentSource.includes('data-testid="rental-property-summary"'), true)
assert.equal(componentSource.includes("{prop?.name || 'Rental property'}"), true)
assert.equal(componentSource.includes("[prop?.address, prop?.city, prop?.state, prop?.zip_code]"), true)
assert.equal(componentSource.includes('Property type'), true)
assert.equal(componentSource.includes('Purchased'), true)
assert.equal(componentSource.includes('Status'), true)
assert.equal(componentSource.includes('Occupancy'), true)
assert.equal(componentSource.includes("{expanded ? 'Hide Details' : 'Show Details'}"), true)
assert.equal(componentSource.includes('rental-summary-compare'), false)
assert.equal(pageSource.includes('presentation={topIsPrimary ? metricVault?.primarySummary : metricVault?.rentalSummary}'), true)
assert.equal(componentSource.includes('presentation.topMetrics'), true)
assert.equal(componentSource.includes('2xl:grid-cols-6'), true)
assert.equal(componentSource.includes('Value buildup period'), true)
assert.equal(componentSource.includes('View Cash Flow Analysis'), true)
assert.equal(componentSource.includes('View Expense Details'), true)
assert.equal(componentSource.includes('View Full P&amp;L Statement'), true)
assert.equal(componentSource.includes('presentation.operationalMetrics'), true)
assert.equal(componentSource.includes('presentation.cashFlowTrend'), true)
assert.equal(componentSource.includes('presentation.expenseBreakdown'), true)
assert.equal(componentSource.includes('presentation.annualPnl'), true)
assert.equal(componentSource.includes('presentation.insights'), true)
assert.equal(componentSource.includes('presentation.facts'), false)
assert.equal(componentSource.includes('aria-label="Property facts"'), false)
assert.equal(componentSource.includes("metric?.displayValue ?? metric?.display ?? '—'"), true)
assert.equal(componentSource.includes("metric?.tone === 'negative'"), true)
assert.equal(componentSource.includes('xl:grid-cols-[minmax(15rem,0.9fr)_minmax(32rem,2.2fr)_minmax(15rem,0.9fr)]'), true)
assert.equal(componentSource.includes('grid-rows-[minmax(0,1fr)_minmax(7.5rem,auto)]'), true)
assert.equal(pageSource.includes("const rentalSummaryActive = activeTab === 'summary' && !topIsPrimary"), true)
assert.equal(pageSource.includes('rentalSummaryActive ? ('), true)
assert.equal(pageSource.includes('<PrimaryPropertySummary'), true)
assert.equal(pageSource.includes('waterfall={metricVault?.rentalSummary?.waterfall}'), true)
assert.equal(pageSource.includes("display.replace(/^\\+/, '')"), true)
assert.equal(pageSource.includes("acquisition_cash: '#4F86E8'"), true)
assert.equal(pageSource.includes("principal_reduction: '#D99A2B'"), true)
assert.equal(pageSource.includes("remaining_secured_debt: '#94A3B8'"), true)
assert.equal(pageSource.includes("appreciation: '#12A594'"), true)
assert.equal(pageSource.includes("total: '#675DD8'"), true)
assert.ok(
  pageSource.indexOf('<RentalPropertySummaryHeader') < pageSource.indexOf('role="tablist"'),
  'property tabs must remain below the rental summary header',
)
assert.equal(componentSource.includes('aria-label="Rental property metrics"'), true)
assert.equal(componentSource.includes('Value Buildup Over Time'), true)
assert.equal(componentSource.includes('Asset Highlights'), true)
assert.equal(componentSource.includes('Liability Highlights'), true)
assert.equal(componentSource.includes('aria-label="Rental operating metrics"'), true)
assert.equal(backendSource.includes('def _rental_summary_presentation('), true)
assert.equal(backendSource.includes('"rentalSummary": rental_summary'), true)
assert.equal(backendSource.includes('"metricKey": "loanBalance", "icon": "debt-service"'), true)
assert.equal(backendSource.includes('"label": "Original loan amount", "metricKey": "loanTotalOriginal"'), true)

for (const forbidden of [
  'marketValue -',
  'loanBalance /',
  'annualCashFlow /',
  'monthlyCashFlow *',
  'Math.max(',
  'Math.min(',
]) {
  assert.equal(componentSource.includes(forbidden), false, `Rental summary contains frontend financial fallback: ${forbidden}`)
}

console.log('rental property summary presentation tests passed')
