import { propAPI } from '../services/api'
import { Pencil, Trash2, BarChart2, FileCheck, Calculator as CalcIcon, HelpCircle } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
}).format(n || 0)

const fmtPct = (n) => `${Number(n || 0).toFixed(2)}%`

const SOURCE_BADGE = {
  '1098': { label: 'Form 1098', icon: FileCheck, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  tax_return: { label: 'Tax Return', icon: FileCheck, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  projected: { label: 'Projected', icon: CalcIcon, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  calculated: { label: 'Calculated', icon: CalcIcon, className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  no_data: { label: 'No Data', icon: HelpCircle, className: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300' },
}

export default function LoanCard({ loan: l, debt, onEdit, onAmortize, onDeleted, propId }) {
  const handleDelete = async () => {
    if (!confirm('Delete loan?')) return
    await propAPI.deleteLoan(propId, l.id)
    toast.success('Loan deleted')
    onDeleted()
  }

  const balance = debt?.current_balance ?? l.current_balance ?? l.original_amount
  const payment = l.monthly_payment || debt?.monthly_payment || 0
  const term = l.loan_term_years ? `${l.loan_term_years} yr` : l.term_years ? `${l.term_years} yr` : '—'
  const source = debt?.source || (debt?.gap_months_projected > 0 ? 'projected' : 'calculated')
  const status = debt?.gap_months_projected > 0 ? `Projected · ${debt.gap_months_projected}mo gap` : SOURCE_BADGE[source]?.label || 'Calculated'
  const latest = debt?.latest_period || {}
  const latestPrincipal = latest.principal ?? debt?.latest_principal ?? 0
  const latestInterest = latest.interest ?? debt?.latest_interest ?? 0
  const latestLabel = latest.label || `Latest month (${new Date().getFullYear()})`
  const latestSource = latest.source || source
  const ytd = debt?.current_year_ytd || null
  const interestToDate = debt?.accumulated_interest ?? 0

  return (
    <div className="card flex min-h-[210px] flex-col justify-between">
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate font-semibold text-gray-900 dark:text-white">{l.lender_name || l.loan_name || 'Loan'}</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.loan_type === 'ARM' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                {l.loan_type || 'Fixed'} · {fmtPct(l.interest_rate)}
              </span>
              <DebtSourceBadge source={source} labelOverride={status} />
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onAmortize} className="icon-btn" title="Amortize">
              <BarChart2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={onEdit} className="icon-btn" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={handleDelete} className="icon-btn text-red-500" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <LoanMetric label="Balance" value={fmt(balance)} bold />
          <LoanMetric label="Original" value={fmt(l.original_amount)} />
          <LoanMetric label="Payment / mo" value={fmt(payment)} />
          <LoanMetric label="Term" value={term} />
          <LoanMetric label="Matures" value={l.maturity_date || '—'} />
        </div>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-3 text-sm dark:border-gray-700">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-gray-700 dark:text-gray-300">{latestLabel}:</span>
          <span className="font-medium text-blue-600 dark:text-blue-400">{fmt(latestPrincipal)} principal /mo</span>
          <span className="text-gray-400"> · </span>
          <span className="font-medium text-orange-600 dark:text-orange-400">{fmt(latestInterest)} interest /mo</span>
          <span className="text-gray-400"> · </span>
          <DebtSourceBadge source={latestSource} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {ytd ? <span>{ytd.year} YTD: principal {fmt(ytd.principal)} · interest {fmt(ytd.interest)}</span> : null}
          <span>Interest to date {fmt(interestToDate)}</span>
        </div>
      </div>
    </div>
  )
}

function DebtSourceBadge({ source, labelOverride }) {
  const cfg = SOURCE_BADGE[source] || SOURCE_BADGE.no_data
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {labelOverride || cfg.label}
    </span>
  )
}

function LoanMetric({ label, value, bold }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`truncate text-sm ${bold ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-800 dark:text-gray-200'}`}>{value}</p>
    </div>
  )
}
