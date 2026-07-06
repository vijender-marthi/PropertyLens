import { propAPI } from '../services/api'
import { Pencil, Trash2, BarChart2, FileCheck, Calculator as CalcIcon, HelpCircle } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)

const SOURCE_BADGE = {
  '1098':      { label: 'Form 1098',    icon: FileCheck, className: 'bg-green-100 text-green-700' },
  tax_return:  { label: 'Tax Return',   icon: FileCheck, className: 'bg-blue-100 text-blue-700' },
  projected:   { label: 'Projected',    icon: CalcIcon,  className: 'bg-amber-100 text-amber-700' },
  no_data:     { label: 'No Data',      icon: HelpCircle, className: 'bg-gray-100 text-gray-500' },
}

export default function LoanCard({ loan: l, debt, onEdit, onAmortize, onDeleted, propId }) {
  const handleDelete = async () => {
    if (!confirm('Delete this loan?')) return
    await propAPI.deleteLoan(propId, l.id)
    toast.success('Loan deleted')
    onDeleted()
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white">{l.lender_name || 'Loan'}</h4>
          <div className="flex gap-2 mt-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${l.loan_type === 'ARM' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
              {l.loan_type}
            </span>
            {l.maturity_date && (
              <span className="text-xs text-gray-400 dark:text-gray-500">Matures: {l.maturity_date}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onAmortize} className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3">
            <BarChart2 className="w-3.5 h-3.5" /> Amortize
          </button>
          <button onClick={onEdit} className="btn-secondary text-xs p-1.5">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleDelete} className="text-red-500 hover:text-red-700 p-1.5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <LoanMetric label="Original Amount" value={fmt(l.original_amount)} />
        <LoanMetric label="Current Balance" value={fmt(l.current_balance)} />
        <LoanMetric label="Interest Rate" value={`${l.interest_rate}%`} sub={l.rate_note} />
        <LoanMetric label="Monthly Payment" value={fmt(l.monthly_payment)} />
        <LoanMetric label="Escrow/mo" value={fmt(l.escrow_amount)} />
        <LoanMetric label="Total Monthly" value={fmt(l.monthly_payment + l.escrow_amount)} bold />
        <LoanMetric label="Term" value={`${l.loan_term_years} years`} />
        <LoanMetric label="Down Payment" value={fmt(l.down_payment)} />
      </div>

      {(l.account_number || l.borrowers || l.principal_due != null || l.interest_due != null ||
        l.statement_date || l.payment_due_date) && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Latest Statement</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {l.account_number && <LoanMetric label="Account #" value={l.account_number} />}
            {l.statement_date && <LoanMetric label="Statement Date" value={l.statement_date} />}
            {l.payment_due_date && <LoanMetric label="Payment Due" value={l.payment_due_date} />}
            {l.principal_due != null && <LoanMetric label="Principal Portion" value={fmt(l.principal_due)} />}
            {l.interest_due != null && <LoanMetric label="Interest Portion" value={fmt(l.interest_due)} />}
            {l.borrowers && <LoanMetric label="Borrowers" value={l.borrowers} wide />}
          </div>
        </div>
      )}

      {debt && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Debt Accumulation
            </p>
            <DebtSourceBadge source={debt.source} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <LoanMetric label="Balance Today" value={fmt(debt.current_balance)} bold />
            <LoanMetric label="Interest Accumulated" value={fmt(debt.accumulated_interest)} />
            <LoanMetric label="Last Statement" value={debt.last_known_statement_date || '—'} />
            <LoanMetric
              label="Gap Projected"
              value={debt.gap_months_projected > 0 ? `${debt.gap_months_projected} mo` : 'None'}
              sub={debt.rate_assumption_flag ? 'ARM: rate held at last known value' : undefined}
            />
          </div>
          {debt.estimated_vs_reported === 'estimated' && (
            <p className="mt-2 text-xs text-amber-600">
              Some months aren't backed by a 1098 or tax return yet — projected from the last known statement using its rate and payment.
            </p>
          )}
        </div>
      )}

      {l.loan_type === 'ARM' && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-4">
          <LoanMetric label="Initial Period" value={l.arm_initial_period ? `${l.arm_initial_period} yr` : 'N/A'} />
          <LoanMetric label="Adj. Period" value={l.arm_adjustment_period ? `${l.arm_adjustment_period} yr` : 'N/A'} />
          <LoanMetric label="Rate Cap" value={l.arm_cap ? `${l.arm_cap}%` : 'N/A'} />
          <LoanMetric label="Index" value={l.arm_index || 'N/A'} />
        </div>
      )}
    </div>
  )
}

function DebtSourceBadge({ source }) {
  const cfg = SOURCE_BADGE[source] || SOURCE_BADGE.no_data
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  )
}

function LoanMetric({ label, value, bold, sub, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`text-sm ${bold ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-800 dark:text-gray-200'}`}>{value}</p>
      {sub && <p className="text-xs text-amber-600">{sub}</p>}
    </div>
  )
}
