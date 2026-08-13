import assert from 'node:assert/strict'

import {
  formatCurrency,
  formatCurrencyCompact,
  formatExtractedFieldValue,
  formatInterestRate,
  formatMetricCurrency,
  formatPercent,
  formatYear,
} from './formatters.js'

assert.equal(formatCurrencyCompact(99999), '$99,999')
assert.equal(formatCurrencyCompact(100000), '$100K')
assert.equal(formatCurrencyCompact(456201), '$456K')
assert.equal(formatCurrencyCompact(1210000), '$1.2M')
assert.equal(formatCurrency(1210000), '$1,210,000')
assert.equal(formatInterestRate(2.875), '2.875%')
assert.equal(formatInterestRate(5), '5.000%')
assert.equal(formatPercent(46.37), '46.37%')
assert.equal(formatMetricCurrency(1210000), '$1.21M')
assert.equal(formatMetricCurrency(1800000), '$1.80M')
assert.equal(formatMetricCurrency(2000000), '$2.00M')
assert.equal(formatMetricCurrency(834687), '$834.69K')
assert.equal(formatMetricCurrency(965313), '$965.31K')
assert.equal(`${formatMetricCurrency(7890, { threshold: 1000 })} / mo`, '$7.89K / mo')
assert.equal(formatYear(2021), '2021')
assert.equal(formatPercent(0.4637), '46.37%')
assert.equal(formatInterestRate(0.0675), '6.750%')
assert.equal(
  formatExtractedFieldValue(
    'down_payment_source',
    'purchase_price_minus_loan_amount_reconciled_to_cash_to_close',
    { down_payment: 200000 },
  ),
  '$200,000',
)

console.log('formatter display tests passed')
