import { useEffect, useMemo, useState } from 'react'
import { propAPI } from '../services/api'
import { X } from 'lucide-react'
import { chartColors, chartTypography, referenceLineLabel } from '../utils/chartTokens'
import DataTable from './DataTable'
import { formatChartCurrency, formatCurrency as fmt, formatDate, formatMonthYear } from '../utils/formatters'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import toast from 'react-hot-toast'

const yearsMonths = (months) => {
  const total = Math.max(0, Number(months || 0))
  const years = Math.floor(total / 12)
  const rest = total % 12
  if (!years) return `${rest} mo`
  if (!rest) return `${years} yr`
  return `${years} yr ${rest} mo`
}

export default function AmortizationModal({ propId, loan, onClose }) {
  const [data, setData] = useState(null)
  const [debtLoan, setDebtLoan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const [extraMonthly, setExtraMonthly] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const debtRes = await propAPI.debt(propId)
        if (cancelled) return
        setDebtLoan((debtRes.data?.loans || []).find((item) => item.loan_id === loan.id) || null)
      } catch {
        if (!cancelled) toast.error('Failed to load loan debt details')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [propId, loan.id])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const amortizationRes = await propAPI.amortization(propId, loan.id, extraMonthly)
        if (!cancelled) setData(amortizationRes.data)
      } catch {
        if (!cancelled) toast.error('Failed to load amortization')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [propId, loan.id, extraMonthly])

  const full = data?.fullAmortization || {}
  const amortizationMetrics = data?.metrics || {}
  const schedule = full.schedule || []
  const nextRows = showFull ? schedule.slice(1) : full.next12 || []
  const payoffComparison = data?.payoffComparison || {}
  const payoffSummary = payoffComparison.summary || {}
  const payoffChartData = useMemo(() => (payoffComparison.chart || []).map((row) => ({
    ...row,
    year: new Date(`${row.date}T00:00:00`).getFullYear(),
  })), [payoffComparison.chart])
  const lender = loan.lender_name || loan.loan_name || 'Loan'
  const projected = Boolean(amortizationMetrics.warning) || Number(debtLoan?.gap_months_projected || 0) > 0 || debtLoan?.estimated_vs_reported === 'estimated'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 dark:bg-gray-900/80">
      <div className="flex h-full w-full max-w-6xl flex-col bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Amortization: {lender}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Full projection from loan start to maturity.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {loading ? <p className="text-sm text-gray-400">Loading amortization...</p> : null}

        <div className="grid gap-3 md:grid-cols-4">
          <DebtMetric label={amortizationMetrics.balanceToday?.label || 'Balance today'} value={amortizationMetrics.balanceToday?.displayValue || fmt(full.currentBalance ?? debtLoan?.current_balance ?? loan.current_balance)} />
          <DebtMetric label={amortizationMetrics.interestAccumulated?.label || 'Interest accumulated'} value={amortizationMetrics.interestAccumulated?.displayValue || fmt(debtLoan?.accumulated_interest)} />
          <DebtMetric label={amortizationMetrics.lastStatement?.label || 'Last statement'} value={amortizationMetrics.lastStatement?.displayValue || debtLoan?.last_known_statement_date || debtLoan?.statement_date || '—'} />
          <DebtMetric label={amortizationMetrics.gapProjected?.label || 'Gap projected'} value={amortizationMetrics.gapProjected?.displayValue || (debtLoan?.gap_months_projected > 0 ? `${debtLoan.gap_months_projected} mo` : 'None')} tone={amortizationMetrics.gapProjected?.tone === 'warn' || debtLoan?.gap_months_projected > 0 ? 'warn' : undefined} />
        </div>

          {projected ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          {amortizationMetrics.warning || 'Projected from last statement using entered loan terms. Upload a recent statement to replace projected months with reported figures.'}
            </div>
          ) : null}

          <div className="card">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">Payoff comparison</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Outstanding balance over time, generated by the backend payoff engine.</p>
              </div>
              <label className="min-w-[240px] text-sm font-medium text-gray-700 dark:text-gray-200">
                <span className="mb-1 flex items-center justify-between gap-3">
                  <span>Extra / mo</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{fmt(extraMonthly)}</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="25"
                  value={extraMonthly}
                  onChange={(event) => setExtraMonthly(Number(event.target.value))}
                  className="w-full accent-blue-600"
                />
              </label>
            </div>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={payoffChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                  <XAxis
                    dataKey="month"
                    type="number"
                    domain={[0, 'dataMax']}
                    tickFormatter={(month) => yearForMonth(full.startDate, month)}
                    tick={chartTypography.tick}
                  />
                  <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.tick} />
                  <Tooltip
                    formatter={(value, name) => [fmt(value), name === 'regularBalance' ? 'Regular schedule' : 'Extra-payment schedule']}
                    labelFormatter={(month, rows) => {
                      const row = rows?.[0]?.payload
                      return row ? `Month ${row.month} · ${formatDate(row.date)}` : `Month ${month}`
                    }}
                  />
                  <Legend iconSize={10} />
                  <ReferenceLine
                    x={full.monthsElapsed}
                    stroke={chartColors.axisText}
                    strokeDasharray="3 3"
                    label={referenceLineLabel(`We are here · ${formatDate(full.weAreHereDate)}`)}
                  />
                  <ReferenceLine
                    x={payoffComparison.regular?.months}
                    stroke={chartColors.axisText}
                    strokeDasharray="2 4"
                    label={referenceLineLabel('Regular payoff')}
                  />
                  {extraMonthly > 0 ? (
                    <ReferenceLine
                      x={payoffComparison.extra?.months}
                      stroke={chartColors.success}
                      strokeDasharray="2 4"
                      label={referenceLineLabel(`Saved ${payoffSummary.timeSavedDisplay || '—'}`)}
                    />
                  ) : null}
                  <Line type="monotone" dataKey="regularBalance" name="Regular schedule" stroke={chartColors.primary} dot={false} strokeWidth={2.5} connectNulls={false} />
                  <Line type="monotone" dataKey="extraBalance" name="Extra-payment schedule" stroke={chartColors.success} strokeDasharray="6 4" dot={false} strokeWidth={2.5} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm dark:border-blue-900/60 dark:bg-blue-950/20 sm:grid-cols-3">
              <DebtMetric label="Time saved" value={extraMonthly > 0 ? payoffSummary.timeSavedDisplay || '—' : '—'} tone={extraMonthly > 0 && payoffSummary.timeSavedMonths > 0 ? 'good' : undefined} />
              <DebtMetric label="Interest saved" value={extraMonthly > 0 ? payoffSummary.interestSavedDisplay || '—' : '—'} tone={extraMonthly > 0 && payoffSummary.interestSaved > 0 ? 'good' : undefined} />
              <DebtMetric label="Paid-off date" value={extraMonthly > 0 ? payoffSummary.paidOffDateDisplay || '—' : '—'} />
            </div>
          </div>

        <div className="grid gap-3 md:grid-cols-4">
          <DebtMetric label={amortizationMetrics.loanStarted?.label || 'Loan started'} value={amortizationMetrics.loanStarted?.displayValue || formatDate(full.startDate)} />
          <DebtMetric label={amortizationMetrics.maturityDate?.label || 'Maturity date'} value={amortizationMetrics.maturityDate?.displayValue || `${formatDate(full.maturityDate)} (${Math.round((full.termMonths || 0) / 12)} yrs)`} />
          <DebtMetric label={amortizationMetrics.monthsElapsed?.label || 'Months elapsed'} value={amortizationMetrics.monthsElapsed?.displayValue || `${full.monthsElapsed || 0} months`} />
          <DebtMetric label={amortizationMetrics.monthsRemaining?.label || 'Months remaining'} value={amortizationMetrics.monthsRemaining?.displayValue || `${full.monthsRemaining || 0} months (${yearsMonths(full.monthsRemaining)})`} />
        </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {showFull ? 'Full amortization schedule' : 'Amortization schedule (next 12 months)'}
              </h3>
              <button type="button" className="text-sm font-medium text-blue-600 dark:text-blue-400" onClick={() => setShowFull((value) => !value)}>
                {showFull ? 'Show next 12 months' : 'View full amortization schedule'}
              </button>
            </div>
            <AmortizationTable rows={nextRows} />
          </div>
        </div>
      </div>
    </div>
  )
}

function yearForMonth(startDate, month) {
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return ''
  const date = new Date(start)
  date.setMonth(start.getMonth() + Number(month || 0))
  return date.getFullYear()
}

function AmortizationTable({ rows }) {
  const columns = [
    {
      id: 'date',
      header: 'Date',
      accessor: 'date',
      sortValue: (row) => row.date,
      render: (row) => formatMonthYear(row.date),
      cellClassName: 'font-medium text-gray-900 dark:text-white',
    },
    { id: 'payment', header: 'Payment', accessor: 'payment', align: 'right', render: (row) => fmt(row.payment) },
    { id: 'principal', header: 'Principal', accessor: 'principal', align: 'right', render: (row) => fmt(row.principal), cellClassName: 'text-blue-600' },
    { id: 'interest', header: 'Interest', accessor: 'interest', align: 'right', render: (row) => fmt(row.interest), cellClassName: 'text-orange-600' },
    { id: 'balance', header: 'Balance', accessor: 'balance', align: 'right', render: (row) => fmt(row.balance), cellClassName: 'font-medium text-gray-900 dark:text-white' },
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => String(row.monthIndex) + '-' + String(row.date)}
      defaultSort={{ id: 'date', direction: 'asc' }}
      emptyMessage="No amortization rows available."
      exportFilename="amortization-schedule.csv"
    />
  )
}
function DebtMetric({ label, value, tone }) {
  const color = tone === 'warn'
    ? 'text-amber-700 dark:text-amber-300'
    : tone === 'good'
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-900 dark:text-white'
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${color}`}>{value}</p>
    </div>
  )
}
