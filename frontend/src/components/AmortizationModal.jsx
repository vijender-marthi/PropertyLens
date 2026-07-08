import { useEffect, useMemo, useState } from 'react'
import { propAPI } from '../services/api'
import { X } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'

const fmt = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(n || 0)

export default function AmortizationModal({ propId, loan, onClose }) {
  const [extra, setExtra] = useState(0)
  const [payoff, setPayoff] = useState(null)
  const [debtLoan, setDebtLoan] = useState(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('annual')

  const load = async (extraAmt = extra) => {
    setLoading(true)
    try {
      const [payoffRes, debtRes] = await Promise.all([
        propAPI.amortization(propId, loan.id, extraAmt),
        propAPI.debt(propId),
      ])
      setPayoff(payoffRes.data)
      setDebtLoan((debtRes.data?.loans || []).find((item) => item.loan_id === loan.id) || null)
    } catch {
      toast.error('Failed to load amortization')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(0) }, [propId, loan.id])

  const annualRows = debtLoan?.scheduled_years || []
  const chartData = useMemo(() => payoff?.schedule?.filter((_, index) => index % 12 === 0) || [], [payoff])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 dark:bg-gray-900/80">
      <div className="flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Amortize: {loan.lender_name || loan.loan_name || 'Loan'}</h2>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Full schedule and projection detail from the shared amortization engine.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {loading && <p className="text-sm text-gray-400">Loading amortization...</p>}

          <div className="grid gap-3 md:grid-cols-4">
            <DebtMetric label="Balance today" value={fmt(debtLoan?.current_balance ?? loan.current_balance)} />
            <DebtMetric label="Interest accumulated" value={fmt(debtLoan?.accumulated_interest)} />
            <DebtMetric label="Last statement" value={debtLoan?.last_known_statement_date || '—'} />
            <DebtMetric label="Gap projected" value={debtLoan?.gap_months_projected > 0 ? `${debtLoan.gap_months_projected} mo` : 'None'} tone={debtLoan?.gap_months_projected > 0 ? 'warn' : undefined} />
          </div>

          {debtLoan?.estimated_vs_reported === 'estimated' || debtLoan?.gap_months_projected > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              Projected from last statement using entered loan terms. Upload a recent statement to replace projected months with reported figures.
              {debtLoan?.rate_assumption_flag ? ' ARM rate is held at the entered/latest rate until a reset schedule is entered.' : ''}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-gray-200 p-1 dark:border-gray-700">
              <button type="button" onClick={() => setView('annual')} className={view === 'annual' ? 'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white' : 'px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300'}>Annual schedule</button>
              <button type="button" onClick={() => setView('payoff')} className={view === 'payoff' ? 'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white' : 'px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300'}>Payoff simulator</button>
            </div>

            {view === 'payoff' ? (
              <div className="flex items-end gap-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Extra / mo
                  <input type="number" className="input mt-1 w-32" value={extra} onChange={(e) => setExtra(Number(e.target.value) || 0)} />
                </label>
                <button type="button" onClick={() => load(extra)} disabled={loading} className="btn-primary text-sm">Recalculate</button>
              </div>
            ) : null}
          </div>

          {view === 'annual' ? (
            <AnnualSchedule rows={annualRows} />
          ) : (
            <PayoffView payoff={payoff} chartData={chartData} />
          )}
        </div>
      </div>
    </div>
  )
}

function AnnualSchedule({ rows }) {
  if (!rows.length) {
    return <div className="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-gray-700">No active loan schedule available. Enter start date and loan terms to build amortization.</div>
  }

  return (
    <div className="overflow-auto rounded-lg border border-gray-100 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/80">
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
            <th className="px-3 py-2 font-medium">Year</th>
            <th className="px-3 py-2 text-right font-medium">Mortgage</th>
            <th className="px-3 py-2 text-right font-medium">Interest</th>
            <th className="px-3 py-2 text-right font-medium">Principal</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-700/60">
          {rows.map((row) => (
            <tr key={row.year} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
              <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{row.year}</td>
              <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{fmt(row.mortgage_paid)}</td>
              <td className="px-3 py-2 text-right text-orange-600">{fmt(row.interest_paid)}</td>
              <td className="px-3 py-2 text-right text-blue-600">{fmt(row.principal_paid)}</td>
              <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{fmt(row.ending_balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PayoffView({ payoff, chartData }) {
  if (!payoff) return null
  const analysis = payoff.analysis || {}
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <DebtMetric label="Monthly payment" value={fmt(analysis.monthly_payment)} />
        <DebtMetric label="Total interest" value={fmt(analysis.total_interest)} />
<DebtMetric label="Payoff time" value={analysis.payoff_time || '—'} />
        <DebtMetric label="Interest saved" value={fmt(analysis.interest_saved)} tone="good" />
      </div>
      {chartData.length > 0 ? (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tickFormatter={(month) => `Yr ${Math.round(month / 12)}`} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => fmt(value)} labelFormatter={(month) => `Month ${month}`} />
              <Legend iconSize={10} />
              <Area type="monotone" dataKey="balance" name="Balance" stroke="#3b82f6" fill="#eff6ff" strokeWidth={2} />
              <Area type="monotone" dataKey="total_interest_paid" name="Cumulative interest" stroke="#ef4444" fill="#fef2f2" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
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
