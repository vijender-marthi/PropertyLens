import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { docAPI, propAPI } from '../services/api'
import DataTable from './DataTable'
import { formatDate, formatInterestRate, formatMonthYear } from '../utils/formatters'
import {
  BarChart2,
  Calculator as CalcIcon,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  FileCheck,
  FileText,
  HelpCircle,
  Info,
  Pencil,
  Power,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'

const SOURCE_BADGE = {
  '1098': {
    label: 'Form 1098',
    icon: FileCheck,
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  tax_return: {
    label: 'Tax Return',
    icon: FileCheck,
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  projected: {
    label: 'Projected',
    icon: CalcIcon,
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  statement: {
    label: 'Dec stmt',
    icon: FileCheck,
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  reported: {
    label: 'Reported',
    icon: FileCheck,
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
  calculated: {
    label: 'Calculated',
    icon: CalcIcon,
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  },
  no_data: {
    label: 'No Data',
    icon: HelpCircle,
    className: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
  },
}

export default function LoanCard({ loan: l, debt, metrics = {}, onEdit, onAmortize, onPreviewStatement, onAcceptStatement, onDeleted, propId, closed = false, uploadingStatement = false, highlightedYears = [] }) {
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadPreview, setUploadPreview] = useState(null)
  const [uploadFileName, setUploadFileName] = useState('')
  const [previewingUpload, setPreviewingUpload] = useState(false)
  const [addressConfirmed, setAddressConfirmed] = useState(false)
  const [fieldOverrides, setFieldOverrides] = useState({})
  const [duplicateChoice, setDuplicateChoice] = useState('keep')
  const [selectedIssueYear, setSelectedIssueYear] = useState(null)
  const statusMeta = metrics.status || {}
  const statusLabel = l.status === 'CLOSED' || closed ? 'Closed' : 'Open'
  const projectedMonths = Number(statusMeta.gapMonthsProjected ?? debt?.gap_months_projected ?? 0)
  const loanName = l.name || l.loan_name || l.lender_name || 'Primary mortgage'
  const rateDisplay = l.rateDisplay || metrics.rate?.displayValue || formatInterestRate(l.interest_rate)
  const rateTypeLabel = l.rateType === 'arm' || String(l.loan_type || '').toUpperCase() === 'ARM' ? 'ARM' : 'Fixed'
  const term = l.termDisplay || (l.loan_term_years ? `${l.loan_term_years}-yr` : '—')
  const originationDate = l.originationDateDisplay || formatDate(l.origination_date || l.start_date)
  const maturity = l.maturityDateDisplay || formatDate(l.maturity_date)
  const servicerSegments = l.servicerSegments || debt?.servicerSegments || []
  const paydown = debt?.paydown || null
  const paydownRows = paydown?.rows || []
  const reconciliation = paydown?.reconciliation || {}
  const reconciliationYears = reconciliation.years || []
  const selectedIssueRow = reconciliationYears.find((item) => item.year === selectedIssueYear)
  useEffect(() => {
    if (!selectedIssueYear) return
    const stillHasIssues = reconciliationYears.some((item) => item.year === selectedIssueYear && item.issueCount > 0)
    if (!stillHasIssues) setSelectedIssueYear(null)
  }, [reconciliationYears, selectedIssueYear])
  const openIssueModal = (year) => {
    setSelectedIssueYear(year)
  }
  const handleOpenUploadModal = () => {
    setUploadPreview(null)
    setUploadFileName('')
    setAddressConfirmed(false)
    setFieldOverrides({})
    setDuplicateChoice('keep')
    setShowUploadModal(true)
  }
  const handleCloseUploadModal = () => {
    if (uploadingStatement || previewingUpload) return
    setShowUploadModal(false)
    setUploadPreview(null)
    setUploadFileName('')
    setAddressConfirmed(false)
    setFieldOverrides({})
    setDuplicateChoice('keep')
  }
  const handlePreviewUpload = async (file) => {
    if (!file) return
    setPreviewingUpload(true)
    setUploadFileName(file.name)
    try {
      const preview = await onPreviewStatement?.(file)
      if (preview) {
        setUploadPreview(preview)
        setAddressConfirmed(false)
        setFieldOverrides({})
        setDuplicateChoice('keep')
      }
    } finally {
      setPreviewingUpload(false)
    }
  }
  const handleAcceptUpload = async () => {
    if (!uploadPreview) return
    const propertyAddress = uploadPreview.addressValidation?.propertyAddress || {}
    const addressOverrideFields = addressConfirmed ? {
      property_address: propertyAddress.street || propertyAddress.address || '',
      property_city: propertyAddress.city || '',
      property_state: propertyAddress.state || '',
      property_zip: propertyAddress.zip || propertyAddress.zip_code || '',
    } : {}
    const applied = await onAcceptStatement?.(uploadPreview, {
      addressOverride: addressConfirmed,
      duplicateAction: uploadPreview.duplicate_of ? duplicateChoice : null,
      fieldOverrides: {
        ...fieldOverrides,
        ...Object.fromEntries(Object.entries(addressOverrideFields).filter(([, value]) => String(value || '').trim())),
      },
    })
    if (applied) {
      setShowUploadModal(false)
      setUploadPreview(null)
      setUploadFileName('')
      setAddressConfirmed(false)
      setFieldOverrides({})
      setDuplicateChoice('keep')
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete loan? This removes its schedule from loan totals.')) return
    await propAPI.deleteLoan(propId, l.id)
    toast.success('Loan deleted')
    onDeleted()
  }

  const handleClose = async () => {
    if (!confirm(`Close ${l.lender_name || 'loan'}? This marks it paid off and excludes it from active loan totals.`)) return
    await propAPI.updateLoan(propId, l.id, {
      ...l,
      status: 'CLOSED',
      current_balance: 0,
    })
    toast.success('Loan closed')
    onDeleted()
  }

  const handleRemoveDocument = async (documentId) => {
    if (!documentId) return
    if (!confirm('Remove this document? The loan year will return to projected values where no other source is available.')) return
    await docAPI.delete(documentId)
    toast.success('Document removed')
    onDeleted()
  }

  return (
    <div className={closed ? 'card border-gray-200 bg-gray-50 dark:bg-gray-800/50' : 'card'}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
            {loanName}
          </h4>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            originated {originationDate} · matures {maturity}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                rateTypeLabel === 'ARM'
                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              }`}
            >
              {rateDisplay} {rateTypeLabel.toLowerCase()}
            </span>
            {projectedMonths > 0 ? <ProjectedBadge months={projectedMonths} helpText={statusMeta.projectedGapHelp} /> : null}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                closed
                  ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={handleOpenUploadModal} className="icon-btn" title="Upload statement or 1098" disabled={uploadingStatement}>
            <Upload className="h-4 w-4" />
          </button>
          <button type="button" onClick={onAmortize} className="icon-btn" title="Amortize">
            <BarChart2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onEdit} className="icon-btn" title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          {!closed ? (
            <button type="button" onClick={handleClose} className="icon-btn" title="Close loan">
              <Power className="h-4 w-4" />
            </button>
          ) : null}
          <button type="button" onClick={handleDelete} className="icon-btn text-red-500" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ServicerTimeline segments={servicerSegments} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <LoanMetric label="Balance" value={l.currentBalanceDisplay || debt?.remaining_balance_display || metrics.balance?.displayValue || '—'} bold />
        <LoanMetric label="Original" value={l.originalAmountDisplay || metrics.originalAmount?.displayValue || '—'} />
        <LoanMetric label="Payment / mo" value={l.payment?.monthlyPIDisplay || metrics.paymentMonthly?.displayValue || '—'} />
        <LoanMetric label="Rate" value={rateDisplay || '—'} />
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white">By year</h5>
          </div>
          <button type="button" onClick={handleOpenUploadModal} className="btn-secondary flex items-center gap-1.5 text-xs" disabled={uploadingStatement}>
            <Upload className="h-3.5 w-3.5" />
            {uploadingStatement ? 'Uploading...' : 'Upload 1098 / statement'}
          </button>
        </div>
        <DataTable
          rows={paydownRows}
          columns={[
            {
              id: 'year',
              header: 'Year',
              align: 'center',
              accessor: 'year',
              cellClassName: 'font-medium text-gray-900 dark:text-white',
              render: (row) => row.yearLabel || (row.isCurrentYear ? `${row.year} · now` : row.year),
            },
            { id: 'servicer', header: 'Servicer', accessor: 'servicerDisplay' },
            { id: 'start', header: 'Starting balance', align: 'right', accessor: 'startingBalanceDisplay' },
            { id: 'principal_paid', header: 'Principal paid', align: 'right', accessor: 'principalPaidDisplay' },
            { id: 'interest_paid', header: 'Interest paid', align: 'right', accessor: 'interestPaidDisplay' },
            {
              id: 'end',
              header: 'Ending balance',
              align: 'right',
              accessor: 'endingBalanceDisplay',
              render: (row) => (
                <div className="inline-flex items-center justify-end gap-1.5">
                  <span>{row.endingBalanceDisplay || '—'}</span>
                  <CalculatedEndingBalanceIcon metric={row.endingBalanceMetric} />
                </div>
              ),
            },
            {
              id: 'source',
              header: 'Source',
              sortable: false,
              render: (row) => <DebtSourceBadge source={row.source} labelOverride={sourceBadgeLabel(row)} />,
            },
            {
              id: 'notes',
              header: 'Notes',
              sortable: false,
              render: (row) => (
                <IssueBadge
                  row={row}
                  reconciliationYear={reconciliationYears.find((item) => item.year === row.year)}
                  isOpen={selectedIssueYear === row.year}
                  onClick={() => openIssueModal(row.year)}
                />
              ),
            },
          ]}
          getRowKey={(row) => row.rowKey || row.year}
          defaultSort={{ id: 'year', direction: 'asc' }}
          emptyMessage="No loan years available."
          tableWrapperClassName="overflow-x-auto"
          getRowProps={(row) => {
            if (selectedIssueYear === row.year) return { className: 'bg-amber-50 ring-1 ring-inset ring-amber-200 transition-colors dark:bg-amber-950/20 dark:ring-amber-900' }
            if (highlightedYears.includes(row.year)) return { className: 'bg-blue-50 ring-1 ring-inset ring-blue-200 transition-colors dark:bg-blue-950/20 dark:ring-blue-900' }
            return row.sourceTier === 'PROJECTED' ? { className: 'bg-amber-50/60 hover:bg-amber-50/80 dark:bg-amber-950/10 dark:hover:bg-amber-950/20' } : {}
          }}
        />
      </div>
      {selectedIssueRow ? (
        <LoanIssueModal
          year={selectedIssueRow.year}
          issueCount={selectedIssueRow.issueCount}
          issues={selectedIssueRow.issues || []}
          onClose={() => setSelectedIssueYear(null)}
          onManageDocuments={() => {
            window.location.href = `/properties/${propId}/documents`
          }}
          onOpenYearDetails={() => setSelectedIssueYear(null)}
        />
      ) : null}
      {showUploadModal ? (
        <LoanDocumentUploadModal
          fileName={uploadFileName}
          preview={uploadPreview}
          previewing={previewingUpload}
          accepting={uploadingStatement}
          addressConfirmed={addressConfirmed}
          onAddressConfirmedChange={setAddressConfirmed}
          fieldOverrides={fieldOverrides}
          onFieldOverridesChange={setFieldOverrides}
          duplicateChoice={duplicateChoice}
          onDuplicateChoiceChange={setDuplicateChoice}
          onPreview={handlePreviewUpload}
          onCancel={handleCloseUploadModal}
          onAccept={handleAcceptUpload}
        />
      ) : null}
    </div>
  )
}

function ProjectedBadge({ months, helpText }) {
  return (
    <span className="group relative inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <CalcIcon className="h-3 w-3" />
      Projected · {months}mo
      <Info className="h-3 w-3" />
      <span className="pointer-events-none absolute left-0 top-6 z-20 hidden w-72 rounded-lg border border-amber-200 bg-white p-3 text-xs leading-relaxed text-gray-700 shadow-lg group-hover:block dark:border-amber-800 dark:bg-gray-900 dark:text-gray-200">
        {helpText || `${months} months have no 1098 or statement on file. Values are projected from the last known statement using the loan's rate and payment. Upload a recent statement to replace projected months with reported figures.`}
      </span>
    </span>
  )
}

function DebtSourceBadge({ source, labelOverride }) {
  const cfg = SOURCE_BADGE[source] || SOURCE_BADGE.no_data
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {labelOverride || cfg.label}
      <Icon className="h-3 w-3" />
    </span>
  )
}

function ServicerTimeline({ segments = [] }) {
  if (!segments.length) return null
  return (
    <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800/60">
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" aria-label="Servicer timeline">
        {segments.map((segment, index) => (
          <div
            key={`${segment.loanId || segment.servicer}-${segment.from || index}`}
            className={index % 2 === 0 ? 'bg-blue-500' : 'bg-emerald-500'}
            style={{ width: `${segment.widthPercent || 0}%` }}
            title={`${segment.servicer || 'Servicer'} · ${segment.dateRangeDisplay || ''}`}
          />
        ))}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {segments.map((segment, index) => (
          <div key={`${segment.loanId || segment.servicer}-label-${index}`} className="min-w-0 text-xs">
            <div className="flex items-center gap-2">
              <span className={index % 2 === 0 ? 'h-2 w-2 rounded-full bg-blue-500' : 'h-2 w-2 rounded-full bg-emerald-500'} aria-hidden="true" />
              <span className="truncate font-semibold text-gray-900 dark:text-white">
                {segment.servicer || 'Servicer'}{segment.current ? ' · current' : ''}
              </span>
            </div>
            <p className="mt-0.5 truncate text-gray-500 dark:text-gray-400">
              {segment.dateRangeDisplay || '—'}{segment.accountNumber ? ` · #${segment.accountNumber}` : ''}
            </p>
            {segment.transferDateDisplay ? (
              <p className="mt-0.5 text-gray-500 dark:text-gray-400">Transfer {segment.transferDateDisplay}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function IssueBadge({ row, reconciliationYear, isOpen, onClick }) {
  const issueCount = Number(row.issueCount ?? reconciliationYear?.issueCount ?? 0)
  const status = String(reconciliationYear?.status || row.reconciliationStatus || row.status || '').toUpperCase()
  const hasBlockingIssue = (reconciliationYear?.issues || []).some((issue) => String(issue.severity || '').toUpperCase() === 'BLOCKING' || issue.blocking)

  if (hasBlockingIssue || status === 'BLOCKING' || status === 'ERROR') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300"
        aria-expanded={isOpen}
        aria-label={`Open ${row.year} blocking reconciliation issues`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Blocking
      </button>
    )
  }

  if (issueCount > 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
        aria-expanded={isOpen}
        aria-label={`Open ${row.year} loan reconciliation issues`}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {issueCount} {issueCount === 1 ? 'Issue' : 'Issues'}
      </button>
    )
  }

  if (status === 'WARNING' || status === 'REVIEW') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
        aria-expanded={isOpen}
        aria-label={`Open ${row.year} reconciliation review`}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Needs Review
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      Reconciled
    </span>
  )
}

function LoanIssueModal({ year, issueCount, issues, onClose, onManageDocuments, onOpenYearDetails }) {
  const severityCounts = issues.reduce((counts, issue) => {
    const label = severityLabel(issue.severity)
    counts[label] = (counts[label] || 0) + 1
    return counts
  }, {})

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loan-issue-modal-title"
      aria-describedby="loan-issue-modal-description"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                <h3 id="loan-issue-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  {year} Loan Reconciliation
                </h3>
              </div>
              <p id="loan-issue-modal-description" className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {issueCount} {issueCount === 1 ? 'issue requires' : 'issues require'} review
              </p>
            </div>
            <button type="button" onClick={onClose} className="icon-btn" aria-label="Close loan reconciliation issues">
              <X className="h-4 w-4" />
            </button>
          </div>
          {Object.keys(severityCounts).length ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {Object.entries(severityCounts).map(([severity, count]) => (
                <span key={severity} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${severityClassName(severity)}`}>
                  {severity}: {count}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-3">
            {issues.length ? issues.map((issue, index) => (
              <IssueCard key={issue.code || `${year}-issue-${index}`} issue={issue} index={index} />
            )) : (
              <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                No issue details were provided by the backend.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-700 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn-secondary" onClick={onManageDocuments}>Manage Documents</button>
          <button type="button" className="btn-primary" onClick={onOpenYearDetails}>Open Year Details</button>
        </div>
      </div>
    </div>
  )
}

function IssueCard({ issue, index }) {
  const [expanded, setExpanded] = useState(false)
  const severity = severityLabel(issue.severity)
  const Icon = severityIcon(severity)
  const values = issue.values || issue.metrics || []
  const recommendation = issue.recommendation || issue.recommendedAction || issue.nextStep

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${severityIconClassName(severity)}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h4 className="font-semibold text-gray-900 dark:text-white">{issue.title || 'Loan reconciliation issue'}</h4>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${severityClassName(severity)}`}>
              {severity}
            </span>
          </div>
          {issue.message || issue.description ? (
            <p className="mt-2 leading-relaxed text-gray-600 dark:text-gray-300">{issue.description || issue.message}</p>
          ) : null}
          {values.length ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Comparison</p>
              <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                {values.map((value) => (
                  <div key={`${issue.code || index}-${value.label}`} className="min-w-0 rounded-md bg-gray-50 p-2 dark:bg-gray-800">
                    <dt className="text-xs text-gray-500 dark:text-gray-400">{value.label}</dt>
                    <dd className="mt-1 font-semibold text-gray-900 dark:text-white">{value.display || value.value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {recommendation ? (
            <div className="mt-3 rounded-md bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              <p className="font-semibold">Recommendation</p>
              <p className="mt-1">{recommendation}</p>
            </div>
          ) : null}
          {(issue.formula || issue.inputs?.length || issue.backendExplanation || issue.sourceDocuments?.length) ? (
            <div className="mt-3">
              <button type="button" className="text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300" onClick={() => setExpanded((current) => !current)}>
                {expanded ? 'Hide Details' : 'Show Details'}
              </button>
              {expanded ? <IssueDetails issue={issue} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function IssueDetails({ issue }) {
  return (
    <div className="mt-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {issue.formula ? (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">Formula</p>
          <p className="mt-1">{issue.formula}</p>
        </div>
      ) : null}
      {issue.inputs?.length ? (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">Inputs</p>
          <dl className="mt-1 grid gap-2 sm:grid-cols-2">
            {issue.inputs.map((input) => (
              <div key={input.label}>
                <dt>{input.label}</dt>
                <dd className="font-semibold text-gray-900 dark:text-white">{input.display || input.value || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {issue.backendExplanation ? (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">Backend explanation</p>
          <p className="mt-1">{issue.backendExplanation}</p>
        </div>
      ) : null}
      {issue.sourceDocuments?.length ? (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">Source documents</p>
          <ul className="mt-1 space-y-1">
            {issue.sourceDocuments.map((doc) => (
              <li key={doc.id || doc.name}>{doc.name || doc.displayName || 'Source document'}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function severityLabel(value) {
  const normalized = String(value || '').toUpperCase()
  if (normalized === 'INFO' || normalized === 'INFORMATION') return 'Information'
  if (normalized === 'IMPORTANT' || normalized === 'ERROR' || normalized === 'HIGH') return 'Important'
  if (normalized === 'BLOCKING' || normalized === 'BLOCKER') return 'Blocking'
  return 'Review'
}

function severityClassName(severity) {
  if (severity === 'Information') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (severity === 'Important') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  if (severity === 'Blocking') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
}

function severityIconClassName(severity) {
  if (severity === 'Information') return 'text-blue-600 dark:text-blue-300'
  if (severity === 'Important') return 'text-orange-600 dark:text-orange-300'
  if (severity === 'Blocking') return 'text-red-600 dark:text-red-300'
  return 'text-amber-600 dark:text-amber-300'
}

function severityIcon(severity) {
  if (severity === 'Information') return Info
  if (severity === 'Blocking') return X
  return AlertTriangle
}

function CalculatedEndingBalanceIcon({ metric }) {
  if (metric?.sourceType !== 'CALCULATED') return null
  const explanation = metric.calculationExplanation || 'This balance was calculated by the backend loan engine because no direct year-end balance was available from the selected source.'
  const formula = metric.formula
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:bg-gray-100 focus:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:hover:bg-gray-800 dark:hover:text-gray-200 dark:focus:bg-gray-800"
        aria-label="Calculated ending balance"
      >
        <CalcIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className="pointer-events-none absolute right-0 top-6 z-30 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs leading-relaxed text-gray-700 shadow-lg group-hover:block group-focus-within:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
        <span className="block font-semibold text-gray-900 dark:text-white">Calculated ending balance</span>
        <span className="mt-1 block">{explanation}</span>
        {formula ? <span className="mt-2 block text-gray-500 dark:text-gray-400">{formula}</span> : null}
      </span>
    </span>
  )
}

function sourceBadgeLabel(row) {
  if (row.source === '1098') return '1098'
  if (row.source === 'statement') return 'Dec stmt'
  if (row.source === 'projected') return 'Projected'
  return row.sourceDisplay || row.sourceLabel || SOURCE_BADGE[row.source]?.label || 'Source'
}

function rowSourceDocuments(row) {
  if (Array.isArray(row.documents) && row.documents.length) return row.documents
  return row.sourceDocument ? [row.sourceDocument] : []
}

function rowPreviewUrl(row) {
  const commentPreview = row.comments?.find((comment) => comment.previewUrl)?.previewUrl
  if (commentPreview) return commentPreview
  return rowSourceDocuments(row).find((document) => document.previewUrl)?.previewUrl
}

function SourceCell({ row, openSourceYear, setOpenSourceYear, uploadingStatement, onReplace, onRemove }) {
  const anchorRef = useRef(null)
  const rowKey = row.rowKey || row.year
  const isOpen = openSourceYear === rowKey

  return (
    <div className="inline-flex">
      <button
        ref={anchorRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpenSourceYear((current) => current === rowKey ? null : rowKey)
        }}
        className="inline-flex items-center gap-1"
        aria-expanded={isOpen}
        aria-label={`Source details for ${row.yearLabel || row.year}`}
      >
        <DebtSourceBadge source={row.source} labelOverride={sourceBadgeLabel(row)} />
        <ChevronDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
      </button>
      {isOpen ? (
        <SourcePopover
          anchorRef={anchorRef}
          row={row}
          uploadingStatement={uploadingStatement}
          onReplace={onReplace}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  )
}

function SourcePopover({ anchorRef, row, uploadingStatement, onReplace, onRemove }) {
  const documents = rowSourceDocuments(row)
  const popoverRef = useRef(null)
  const [position, setPosition] = useState(null)

  useEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = 288
      const margin = 8
      const popoverHeight = popoverRef.current?.offsetHeight || (documents.length ? 132 : 104)
      const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin)
      const belowTop = rect.bottom + 6
      const top = belowTop + popoverHeight > window.innerHeight - margin
        ? Math.max(margin, rect.top - popoverHeight - 6)
        : belowTop
      setPosition({ top, left, width })
    }
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, documents.length])

  if (typeof document === 'undefined') return null
  return (
    createPortal(<div
      ref={popoverRef}
      style={position ? { top: position.top, left: position.left, width: position.width } : { visibility: 'hidden', width: 288 }}
      className="fixed z-[100] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg dark:border-gray-700 dark:bg-gray-900"
      onClick={(event) => event.stopPropagation()}
    >
      {documents.length ? (
        <div className="space-y-3">
          {documents.map((document) => (
            <div key={document.documentId || document.filename} className="min-w-0">
              <div className="flex items-center gap-2">
                <FileCheck className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100" title={document.filename}>
                  {document.filename}
                </span>
              </div>
              <div className="ml-6 mt-1 flex flex-wrap items-center gap-2">
                {document.previewUrl ? (
                  <a
                    href={document.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
                  >
                    Preview
                  </a>
                ) : null}
                <button type="button" onClick={(event) => { event.stopPropagation(); onReplace() }} disabled={uploadingStatement} className="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:text-white">
                  Replace
                </button>
                {document.documentId ? (
                  <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(document.documentId) }} className="text-xs font-medium text-red-500 hover:text-red-600">
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">No source document for this projected row.</p>
          <button type="button" onClick={(event) => { event.stopPropagation(); onReplace() }} disabled={uploadingStatement} className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400">
            {uploadingStatement ? 'Uploading...' : 'Upload 1098 / statement'}
          </button>
        </div>
      )}
    </div>, document.body)
  )
}

function LoanMetric({ label, value, bold }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`truncate text-sm ${bold ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-800 dark:text-gray-200'}`}>
        {value}
      </p>
    </div>
  )
}

function LoanHighlightCard({ label, value, tone }) {
  const valueClass = tone === 'topup'
    ? 'text-emerald-600 dark:text-emerald-300'
    : tone === 'principal'
      ? 'text-blue-600 dark:text-blue-300'
      : tone === 'interest'
        ? 'text-orange-600 dark:text-orange-300'
        : 'text-gray-900 dark:text-white'
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
      <p className="truncate text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 truncate text-2xl font-medium leading-tight ${valueClass}`}>{value || '—'}</p>
    </div>
  )
}

function LoanDocumentUploadModal({
  fileName,
  preview,
  previewing,
  accepting,
  addressConfirmed,
  onAddressConfirmedChange,
  fieldOverrides = {},
  onFieldOverridesChange,
  duplicateChoice = 'keep',
  onDuplicateChoiceChange,
  onPreview,
  onCancel,
  onAccept,
}) {
  const addressValidation = preview?.addressValidation || {}
  const addressStatus = addressValidation.status
  const addressNeedsConfirmation = Boolean(preview) && addressStatus !== 'match'
  const parseError = preview?.extracted_data?.parse_error
  const duplicate = preview?.duplicate_of
  const requiredFields = preview?.requiredFields || []
  const requiredFieldValue = (field) => fieldOverrides[field.key] ?? field.value ?? ''
  const addressRequirementSatisfiedByOverride = addressConfirmed && addressNeedsConfirmation
  const requiresManualAddressEntry = (field) => (
    field.key === 'property_address'
    && !addressRequirementSatisfiedByOverride
    && !String(requiredFieldValue(field) ?? '').trim()
  )
  const visibleRequiredFields = requiredFields.filter((field) => field.key !== 'property_address' || requiresManualAddressEntry(field))
  const requiredFieldsSatisfied = requiredFields.every((field) => {
    if (field.key === 'property_address' && addressRequirementSatisfiedByOverride) return true
    return String(requiredFieldValue(field) ?? '').trim()
  })
  const canAccept = Boolean(preview) && !parseError && !previewing && !accepting && requiredFieldsSatisfied && (!addressNeedsConfirmation || addressConfirmed)
  const extracted = preview?.extracted_data || {}
  const isForm1098 = preview?.category === '1098'
  const isStatement = preview?.category === 'mortgage_statement'
  const fields = isForm1098
    ? [
        ['Doc type', '1098'],
        ['Tax year', preview?.statement_year || extracted.tax_year || extracted.statement_year || '—'],
        ['Box 1 interest', extracted.box1_interest_display || extracted.interest_paid_display || extracted.mortgage_interest_display || extracted.box1Interest || extracted.box1_interest || extracted.interest_paid || '—'],
        ['Box 2 balance', extracted.box2_balance_display || extracted.outstanding_principal_display || extracted.box2Balance || extracted.box2_balance || extracted.outstanding_principal || '—'],
      ]
    : [
        ['Doc type', isStatement ? 'Mortgage statement' : preview?.document_config?.label || preview?.category || 'Document'],
        ['Tax year', preview?.statement_year || extracted.tax_year || extracted.statement_year || '—'],
        ['Current balance', extracted.current_balance_display || extracted.current_balance || '—'],
        ['YTD principal', extracted.principal_paid_ytd_display || extracted.principal_paid_ytd || '—'],
        ['YTD interest', extracted.interest_paid_ytd_display || extracted.interest_paid_ytd || '—'],
      ]

  const handleFile = (file) => onPreview?.(file)
  const handleOverrideChange = (key, value) => {
    onFieldOverridesChange?.({
      ...fieldOverrides,
      [key]: value,
    })
  }
  const handleDrop = (event) => {
    event.preventDefault()
    handleFile(event.dataTransfer.files?.[0])
  }
  const addressLine = (address, fallback) => {
    const text = [
      address?.street || address?.address,
      address?.city,
      [address?.state, address?.zip || address?.zip_code].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ')
    return text || fallback || '—'
  }
  const propertyAddressText = addressLine(addressValidation.propertyAddress, addressValidation.normalizedPropertyAddress)
  const documentAddressText = addressLine(addressValidation.documentAddress, addressValidation.normalizedDocumentAddress)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="loan-doc-upload-title">
      <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 id="loan-doc-upload-title" className="text-lg font-semibold text-gray-900 dark:text-white">Upload 1098 / statement</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">The backend parses the file, detects the document type and year, and verifies the address before anything is applied.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close upload modal" disabled={previewing || accepting}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="h-6 w-6 text-gray-400" aria-hidden="true" />
            <span className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{previewing ? 'Parsing document...' : 'Drag and drop a PDF or spreadsheet'}</span>
            <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">or browse for PDF, XLS, or XLSX</span>
            <input
              type="file"
              accept=".pdf,.xlsx,.xls"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0])}
              disabled={previewing || accepting}
            />
          </label>

          {preview ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/70">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white" title={fileName || preview.original_filename}>{fileName || preview.original_filename}</p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{preview.display_name || preview.category}</p>
                </div>
                <AddressStatusBadge validation={addressValidation} confirmed={addressConfirmed} />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {fields.map(([label, value]) => (
                  <div key={label} className="rounded-md border border-gray-100 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-gray-900 dark:text-white">{String(value || '—')}</p>
                  </div>
                ))}
              </div>

              {parseError ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  We couldn't read this document. Upload a text-readable PDF/spreadsheet or try a clearer scan.
                </div>
              ) : null}

              {visibleRequiredFields.length ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Required before applying</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {visibleRequiredFields.map((field) => {
                      const value = requiredFieldValue(field)
                      const missing = !String(value ?? '').trim()
                      return (
                        <label key={field.key} className={field.key === 'property_address' ? 'sm:col-span-2' : ''}>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{field.label}</span>
                          <input
                            type="text"
                            inputMode={field.type === 'currency' ? 'decimal' : undefined}
                            value={value}
                            onChange={(event) => handleOverrideChange(field.key, event.target.value)}
                            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-950 dark:text-white ${
                              missing ? 'border-amber-300 dark:border-amber-700' : 'border-gray-200 dark:border-gray-700'
                            }`}
                            aria-invalid={missing}
                            aria-describedby={missing ? `${field.key}-missing-note` : undefined}
                          />
                          {missing ? (
                            <p id={`${field.key}-missing-note`} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                              {field.message || `Couldn't read ${field.label} — enter manually.`}
                            </p>
                          ) : null}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {addressNeedsConfirmation ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  <p className="font-semibold">{addressStatus === 'document_address_missing' ? "Couldn't read an address" : 'Address needs confirmation'}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="font-medium">Property address</p>
                      <p>{propertyAddressText}</p>
                    </div>
                    <div>
                      <p className="font-medium">On-document address</p>
                      <p>{documentAddressText}</p>
                    </div>
                  </div>
                  <label className="mt-3 flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={addressConfirmed}
                      onChange={(event) => onAddressConfirmedChange?.(event.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Same address — accept
                  </label>
                </div>
              ) : null}

              {duplicate ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-3 text-xs dark:border-gray-700 dark:bg-gray-900">
                  <p className="font-semibold text-gray-900 dark:text-white">Possible duplicate document</p>
                  <p className="mt-1 text-gray-600 dark:text-gray-300">
                    {duplicate.name || 'Existing document'} is already linked for this loan/year. Choose how to handle this upload.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-medium ${
                      duplicateChoice === 'replace' ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'
                    }`}>
                      <input
                        type="radio"
                        name="loan-document-duplicate-choice"
                        value="replace"
                        checked={duplicateChoice === 'replace'}
                        onChange={(event) => onDuplicateChoiceChange?.(event.target.value)}
                        className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Replace existing
                    </label>
                    <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-medium ${
                      duplicateChoice === 'keep' ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'
                    }`}>
                      <input
                        type="radio"
                        name="loan-document-duplicate-choice"
                        value="keep"
                        checked={duplicateChoice === 'keep'}
                        onChange={(event) => onDuplicateChoiceChange?.(event.target.value)}
                        className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Keep both, use newest
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel} disabled={previewing || accepting}>Cancel</button>
          <button type="button" className="btn-primary text-sm" onClick={onAccept} disabled={!canAccept}>
            {accepting ? 'Applying...' : 'Accept and apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddressStatusBadge({ validation, confirmed }) {
  if (!validation) return null
  if (validation.status === 'match') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Address confirmed
      </span>
    )
  }
  if (confirmed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Address confirmed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      Address review
    </span>
  )
}

function formatMaturity(value) {
  return formatMonthYear(value)
}

function formatTerm(loan, fallbackYears) {
  const start = parseDate(loan.origination_date || loan.start_date)
  const maturity = parseDate(loan.maturity_date)
  if (start && maturity && maturity > start) {
    const months = (maturity.getFullYear() - start.getFullYear()) * 12 + maturity.getMonth() - start.getMonth()
    const years = Math.floor(months / 12)
    const remainingMonths = months % 12
    if (years > 0 && remainingMonths > 0) return `${years} yr ${remainingMonths} mo`
    if (years > 0) return `${years}-yr`
    if (months > 0) return `${months} mo`
  }
  return fallbackYears ? `${fallbackYears}-yr` : '—'
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value || 0), min), max)
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}
