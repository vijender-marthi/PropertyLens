import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const componentSource = readFileSync(new URL('./LoanCard.jsx', import.meta.url), 'utf8')
const loanYearTableSource = componentSource.slice(
  componentSource.indexOf('function LoanYearTable('),
  componentSource.indexOf('function moneyDisplay('),
)

assert.equal(loanYearTableSource.includes('const [expandedRows, setExpandedRows] = useState({})'), true)
assert.equal(loanYearTableSource.includes('setExpandedRows((current) => ({ ...defaults, ...current }))'), false)
assert.equal(loanYearTableSource.includes('loanYearHasTransfer(row) && loanYearDetailRows(row, rows).length'), false)
assert.equal(loanYearTableSource.includes('aria-expanded={expanded}'), true)
assert.equal(loanYearTableSource.includes('toggleRow(rowKey)'), true)

console.log('loan card year table collapse tests passed')
