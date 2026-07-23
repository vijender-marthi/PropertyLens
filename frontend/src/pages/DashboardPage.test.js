import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const pageSource = readFileSync(new URL('./DashboardPage.jsx', import.meta.url), 'utf8')
const backendSource = readFileSync(new URL('../../../backend/services/portfolio_analysis.py', import.meta.url), 'utf8')
const referenceUrl = new URL('../../../docs/ui-reference/portfolio-dashboard.png', import.meta.url)

assert.equal(existsSync(referenceUrl), true)
assert.equal(pageSource.includes('data-testid="portfolio-dashboard"'), true)
assert.equal(pageSource.includes('propAPI.portfolioAnalysis(request, { signal: controller.signal })'), true)
assert.equal(pageSource.includes("include_primary_residence: scope !== 'rentals'"), true)
assert.equal(pageSource.includes("selection_explicit: scope === 'custom'"), true)
assert.equal(pageSource.includes('selected_property_ids'), true)
assert.equal(pageSource.includes('start_date'), true)
assert.equal(pageSource.includes('end_date'), true)
assert.equal(pageSource.includes('reportHref={reportHref}'), true)
assert.equal(pageSource.includes('dashboard.topMetrics.map'), true)
assert.equal(pageSource.includes('dashboard.cashFlowWaterfall'), true)
assert.equal(pageSource.includes('dashboard.capitalStructure'), true)
assert.equal(pageSource.includes('dashboard.propertyPerformance'), true)
assert.equal(pageSource.includes('dashboard.expenseBreakdown'), true)
assert.equal(pageSource.includes('dashboard.alerts'), true)
assert.equal(pageSource.includes('dashboard.bottomMetrics'), true)
assert.equal(pageSource.includes('<InfoTooltip metric={metric} label={item.label} />'), true)
assert.equal(pageSource.indexOf('<BottomStrip items={dashboard.bottomMetrics}') < pageSource.indexOf('<CashFlowTrend data={dashboard.cashFlowTrend}'), true)
assert.equal(pageSource.includes('xl:grid-cols-[minmax(15rem,0.9fr)_minmax(34rem,2.2fr)_minmax(15rem,0.9fr)]'), true)
assert.equal(backendSource.includes('"waterfallFinalMatchesMonthlyCashFlow"'), true)
assert.equal(backendSource.includes('"capitalStructureMatchesPortfolioValue"'), true)
assert.equal(backendSource.includes('"expenseBreakdownMatchesOperatingExpenses"'), true)

for (const forbidden of [
  '.reduce(',
  'market_value)',
  'monthly_cash_flow)',
  'runningTotal +',
  'cashFlow -',
  'loanBalance /',
  'portfolioValue -',
]) {
  assert.equal(pageSource.includes(forbidden), false, `Dashboard contains frontend financial calculation: ${forbidden}`)
}

console.log('portfolio dashboard presentation tests passed')
