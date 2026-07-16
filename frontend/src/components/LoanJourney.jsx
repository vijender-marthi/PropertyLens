import { Fragment } from 'react'
import { ArrowRight, CheckCircle2, Landmark, RefreshCw } from 'lucide-react'
import { formatDate } from '../utils/formatters'

function loanStatusLabel(status) {
  const normalized = String(status || 'OPEN').toUpperCase()
  if (normalized === 'PAID_OFF') return 'Paid off'
  return normalized.charAt(0) + normalized.slice(1).toLowerCase().replace('_', ' ')
}

function normalizeLoanJourneyItem(item) {
  return {
    id: item.loanId || item.id,
    lender: item.lender || item.lender_name,
    accountNumber: item.accountNumber || item.account_number,
    status: item.status,
    startDate: item.startDate || item.servicer_start_date || item.origination_date,
    endDate: item.endDate || item.closed_date || item.servicer_end_date,
    current: Boolean(item.current || item.is_current_servicer),
    transferReason: item.transfer_reason,
    closureReason: item.closure_reason,
  }
}

function transitionBetween(transitions, fromItem, toItem) {
  const fromAccount = fromItem?.accountNumber || fromItem?.account_number
  const toAccount = toItem?.accountNumber || toItem?.account_number
  const fromLender = fromItem?.lender || fromItem?.lender_name
  const toLender = toItem?.lender || toItem?.lender_name
  return (transitions || []).find((transition) => (
    (transition.fromAccount && transition.toAccount && transition.fromAccount === fromAccount && transition.toAccount === toAccount)
    || (transition.fromLender === fromLender && transition.toLender === toLender)
    || (transition.date && transition.date === (toItem?.startDate || toItem?.servicer_start_date))
  )) || null
}

function transitionPresentation(transition, fromItem = {}) {
  const reason = String(transition?.type || fromItem.transferReason || fromItem.closureReason || fromItem.status || '').toLowerCase()
  const refinance = reason.includes('refinance') || reason.includes('refinanced')
  return refinance
    ? {
        Icon: RefreshCw,
        label: 'Refinance',
        className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200',
        lineClassName: 'bg-blue-200 dark:bg-blue-900/70',
      }
    : {
        Icon: ArrowRight,
        label: 'Mortgage Servicer Change',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
        lineClassName: 'bg-emerald-200 dark:bg-emerald-900/70',
      }
}

export default function LoanJourney({ items = [], transitions = [], compact = false, className = '' }) {
  const normalizedItems = items.map(normalizeLoanJourneyItem)
  if (!normalizedItems.length) return null

  return (
    <div className={`mt-4 overflow-x-auto pb-1 ${className}`}>
      <div className={`flex min-w-max items-stretch ${compact ? 'gap-2' : 'gap-3'}`}>
        {normalizedItems.map((item, index) => {
          const next = normalizedItems[index + 1]
          const transition = next ? transitionBetween(transitions, item, next) : null
          const presentation = next ? transitionPresentation(transition, item) : null
          const StageIcon = item.current ? CheckCircle2 : Landmark
          return (
            <Fragment key={`${item.id || index}-${item.accountNumber || ''}`}>
              <div className={`min-w-[260px] rounded-lg border bg-white/80 p-3 shadow-sm dark:bg-gray-950/40 ${item.current ? 'border-blue-300 ring-1 ring-blue-200 dark:border-blue-800 dark:ring-blue-950' : 'border-gray-200 dark:border-gray-800'}`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.current ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'}`}>
                    <StageIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{item.lender || 'Loan'}{item.current ? ' · Current' : ''}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>#{item.accountNumber || '—'}</span>
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{loanStatusLabel(item.status)}</span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                      {item.startDate ? formatDate(item.startDate) : '—'} <span className="text-gray-400">→</span> {item.endDate ? formatDate(item.endDate) : 'Present'}
                    </p>
                  </div>
                </div>
              </div>
              {next ? (
                <div className="flex w-28 shrink-0 flex-col items-center justify-center px-1">
                  <div className={`mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${presentation.className}`}>
                    <presentation.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {presentation.label}
                  </div>
                  <div className={`h-0.5 w-full ${presentation.lineClassName}`} />
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
