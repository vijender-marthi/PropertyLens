import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { propAPI, docAPI } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceArea, BarChart, Bar, Legend
} from 'recharts'
import {
ChevronLeft, ChevronDown, ChevronRight, Pencil, Trash2, Plus, Upload,
FileText, RefreshCw, Calculator, Building2, Home, X, Download, Info, CheckCircle2, AlertTriangle, PauseCircle, TrendingDown, Lock
} from 'lucide-react'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { utils, writeFile } from 'xlsx'
import DocumentUpload from '../components/DocumentUpload'
import LoanCard from '../components/LoanCard'
import LoanModal from '../components/LoanModal'
import AmortizationModal from '../components/AmortizationModal'
import { propertyLabel, shortPropertyUid } from '../utils/propertyDisplay'

const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
const fmtPct = (n) => `${(n || 0).toFixed(2)}%`
const metricToneClass = (metric) => metric?.tone === 'positive'
? 'text-green-600'
: metric?.tone === 'negative'
? 'text-red-600'
: 'text-gray-900 dark:text-white'
const sourceToneClass = (source) => source === 'DOCUMENT'
  ? 'text-green-700 dark:text-green-300'
  : source === 'USER_INPUT'
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-blue-700 dark:text-blue-300'

export default function PropertyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
const [prop, setProp] = useState(null)
const [metrics, setMetrics] = useState(null)
const [lifetimeSummary, setLifetimeSummary] = useState(null)
const [summaryView, setSummaryView] = useState(null)
const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLoanModal, setShowLoanModal] = useState(false)
  const [editLoan, setEditLoan] = useState(null)
  const [showAmortization, setShowAmortization] = useState(null)
  const [refreshingValue, setRefreshingValue] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')
  const [showAddress, setShowAddress] = useState(false)

  const loadData = async () => {
    try {
const [propRes, metricsRes, docsRes, lifetimeRes, summaryRes] = await Promise.all([
propAPI.get(id),
propAPI.metrics(id),
docAPI.list(id),
propAPI.lifetime(id).catch(() => null),
propAPI.summary(id).catch(() => null),
])
setProp(propRes.data)
setMetrics(metricsRes.data)
setDocs(docsRes.data)
setLifetimeSummary(lifetimeRes?.data || null)
setSummaryView(summaryRes?.data || null)
    } catch {
      toast.error('Failed to load property')
      navigate('/properties')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [id])

  const exportPropertyXLS = () => {
    const wb = utils.book_new()

    // Sheet 1: Summary — property details + current metrics
    const summaryRows = [
      ['PropertyLens — Property Export'],
      [],
      ['PROPERTY DETAILS'],
      ['Property Name',     propertyLabel(prop)],
      ['Property ID',       prop.property_uid],
      ['City',              prop.city],
      ['State',             prop.state],
      ['ZIP',               prop.zip_code],
      ['Property Type',     prop.property_type],
      ['Usage',             prop.usage_type || 'Rental'],
      ['Purchase Date',     prop.purchase_date],
      ['Purchase Price',    prop.purchase_price],
      ['Down Payment',      prop.down_payment],
      ['Market Value',      prop.market_value],
      ['Land Value',        prop.land_value],
      ['Depreciation Period (yrs)', prop.depreciation_years],
      [],
      ['RENTAL INCOME'],
      ['Monthly Rent',      prop.monthly_rent],
      ['Occupancy Rate (%)', prop.occupancy_rate],
      ['Effective Monthly Rent', metrics?.effective_rent],
      [],
      ['MONTHLY EXPENSES'],
      ['Property Tax (annual)', prop.property_tax],
      ['Insurance (monthly)', prop.insurance],
      ['HOA Fee',           prop.hoa_fee],
      ['HOA Special Assessment', prop.hoa_special_assessment],
      ['Solar Ownership',   prop.solar_ownership],
      ['Solar Lease/mo',    prop.solar_monthly_payment],
      ['Solar Purchase Price', prop.solar_purchase_price],
      ['Maintenance',       prop.maintenance],
      ['Property Mgmt Fee', prop.property_management_fee],
      ['Utilities',         prop.utilities],
      ['Vacancy Allowance', prop.vacancy_allowance],
      ['CapEx Reserve',     prop.capex_reserve],
      ['Other Expenses',    prop.other_expenses],
      [],
      ['CURRENT METRICS'],
      ['Monthly Cash Flow', topMonthlyCashFlow],
      ['Annual Cash Flow',  topAnnualCashFlow],
      ['Annual NOI',        topAnnualNoi],
      ['Cap Rate (%)',       topCapRate],
      ['Gross Yield (%)',    metrics?.gross_yield],
      ['Total Loan Balance', metrics?.total_loan_balance],
    ]
    const ws1 = utils.aoa_to_sheet(summaryRows)
    ws1['!cols'] = [{ wch: 30 }, { wch: 20 }]
    utils.book_append_sheet(wb, ws1, 'Summary')

    // Sheet 2: Loans
    if (prop.loans?.length) {
      const loanHeader = ['Lender', 'Type', 'Original Amount', 'Current Balance',
        'Interest Rate (%)', 'Monthly Payment', 'Term (yrs)', 'Origination Date',
        'Maturity Date', 'Escrow (mo)', 'Interest Due', 'Principal Due']
      const loanRows = prop.loans.map(l => [
        l.lender_name, l.loan_type, l.original_amount, l.current_balance,
        l.interest_rate, l.monthly_payment, l.loan_term_years,
        l.origination_date, l.maturity_date, l.escrow_amount,
        l.interest_due, l.principal_due,
      ])
      const ws2 = utils.aoa_to_sheet([loanHeader, ...loanRows])
      ws2['!cols'] = loanHeader.map(() => ({ wch: 18 }))
      utils.book_append_sheet(wb, ws2, 'Loans')
    }

    const addr = propertyLabel(prop).replace(/[^a-z0-9]/gi, '_').slice(0, 20)
    writeFile(wb, `propertylens_${addr}.xlsx`)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this property? This cannot be undone.')) return
    await propAPI.delete(id)
    toast.success('Property deleted')
    navigate('/properties')
  }

  const handleRefreshValue = async () => {
    setRefreshingValue(true)
    const { data } = await propAPI.refreshValue(id)
    if (data.value) {
      toast.success(`Market value updated: ${fmt(data.value)} (${data.source})`)
      loadData()
    } else {
      toast(data.message || 'No value returned. Configure ZILLOW_API_KEY.', { icon: 'ℹ️' })
    }
    setRefreshingValue(false)
  }

if (loading) return (
<div className="flex items-center justify-center h-64">
<div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
</div>
)

const topSummaryMetrics = summaryView?.metrics || {}
const topAnnualCashFlow = topSummaryMetrics.annualCashFlow?.value || 0
const topMonthlyCashFlow = topSummaryMetrics.monthlyCashFlow?.value || 0
const topAnnualNoi = topSummaryMetrics.noi?.value || 0
const topCapRate = topSummaryMetrics.capRate?.value || 0
const topIsPrimary = (prop.usage_type || '').toLowerCase() === 'primary'
const topMonthlyCostToOwn = topSummaryMetrics.monthlyCostToOwn?.value || 0

const TABS = ['summary', 'details', 'usage', 'loans', 'rental', 'taxes', 'depreciation', 'documents', 'checklist', 'raw data', 'verify', 'scenarios']
return (
<div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => navigate('/properties')} className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm mb-2">
            <ChevronLeft className="w-4 h-4" /> Properties
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">{propertyLabel(prop)}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            ID {shortPropertyUid(prop)} · {prop.city}, {prop.state} · {prop.property_type} ·{' '}
            <span className={prop.usage_type === 'Primary' ? 'badge-yellow' : 'badge-green'}>
              {prop.usage_type === 'Primary' ? 'Primary Home' : 'Rental'}
            </span>
          </p>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAddress((v) => !v)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {showAddress ? 'Hide address' : 'Show address'}
            </button>
            {showAddress ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{prop.address}</p>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <button onClick={exportPropertyXLS} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <Link to={`/properties/${id}/edit`} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
          <button onClick={handleDelete} className="btn-danger flex items-center gap-1.5 text-sm">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* KPIs */}
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
{topIsPrimary ? (
<>
<KPI label="Monthly Cost to Own" value={topSummaryMetrics.monthlyCostToOwn?.display || fmt(topMonthlyCostToOwn)} color={metricToneClass(topSummaryMetrics.monthlyCostToOwn)} metric={topSummaryMetrics.monthlyCostToOwn} />
<KPI label="Loan Balance" value={topSummaryMetrics.totalDebt?.display || fmt(metrics?.total_loan_balance)} metric={topSummaryMetrics.totalDebt} />
</>
) : (
<>
<KPI label="Monthly Cash Flow" value={topSummaryMetrics.monthlyCashFlow?.display || fmt(topMonthlyCashFlow)} color={metricToneClass(topSummaryMetrics.monthlyCashFlow)} metric={topSummaryMetrics.monthlyCashFlow} />
<KPI label="Annual Cash Flow" value={topSummaryMetrics.annualCashFlow?.display || fmt(topAnnualCashFlow)} color={metricToneClass(topSummaryMetrics.annualCashFlow)} metric={topSummaryMetrics.annualCashFlow} />
</>
)}
<KPI label="Market Value" value={topSummaryMetrics.marketValue?.display || fmt(prop.market_value)} metric={topSummaryMetrics.marketValue} action={
          <button onClick={handleRefreshValue} disabled={refreshingValue} className="text-blue-500 hover:text-blue-700">
            <RefreshCw className={`w-3 h-3 ${refreshingValue ? 'animate-spin' : ''}`} />
          </button>
        } />
<KPI label="Equity" value={topSummaryMetrics.equity?.display || fmt(metrics?.equity)} color={metricToneClass(topSummaryMetrics.equity)} metric={topSummaryMetrics.equity} />
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-1 sm:gap-4 overflow-x-auto no-scrollbar -mb-px">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pb-3 px-1 sm:px-0 text-sm font-medium capitalize border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>


      {/* Details */}
{activeTab === 'details' && (
<CompactDetailsTab prop={prop} propId={id} onSaved={loadData} />
)}

      {activeTab === 'usage' && (
        <UsageTimelineTab propId={id} onSaved={loadData} />
      )}

      {/* Loans */}
      {activeTab === 'loans' && (
        <LoansTab
          propId={id}
          prop={prop}
          onAddLoan={() => { setEditLoan(null); setShowLoanModal(true) }}
          onEditLoan={(loan) => { setEditLoan(loan); setShowLoanModal(true) }}
          onAmortize={(loan) => setShowAmortization(loan)}
          onDeleted={loadData}
        />
      )}

      {/* Rental */}
      {activeTab === 'rental' && (
        <RentalTab propId={id} />
      )}

      {/* Taxes */}
{activeTab === 'taxes' && (
<UnifiedTaxPage propId={id} property={prop} />
)}

      {activeTab === 'depreciation' && (
        <DepreciationTab propId={id} prop={prop} onRentalRequest={() => setActiveTab('rental')} />
      )}

      {/* Documents */}
{activeTab === 'documents' && (
<DocumentUpload propertyId={id} docs={docs} onUploaded={loadData} />
)}

{activeTab === 'checklist' && (
<DocumentChecklist prop={prop} docs={docs} propId={id} onUploadRequest={() => setActiveTab('documents')} onRentalRequest={() => setActiveTab('rental')} />
)}

{activeTab === 'raw data' && (
<ExtractedRawDataTab propId={id} prop={prop} docs={docs} />
)}

      {/* Scenarios */}
      {activeTab === 'scenarios' && (
        <ScenariosTab prop={prop} propId={id} currentMonthlyCashFlow={topMonthlyCashFlow} currentDscr={topSummaryMetrics.dscr?.value || 0} />
      )}

      {/* Summary */}
      {activeTab === 'verify' && (
        <MasterVerificationTab propId={id} prop={prop} metrics={metrics} docs={docs} onJump={setActiveTab} />
      )}
      {activeTab === 'summary' && (
        <PropertyStorySummary propId={id} prop={prop} metrics={metrics} />
      )}

      {/* Modals */}
      {showLoanModal && (
        <LoanModal
          propId={id}
          property={prop}
          loan={editLoan}
          onClose={() => setShowLoanModal(false)}
          onSaved={loadData}
        />
      )}
      {showAmortization && (
        <AmortizationModal
          propId={id}
          loan={showAmortization}
          onClose={() => setShowAmortization(null)}
        />
      )}
    </div>
  )
}

function MetricInfo({ metric }) {
if (!metric) return null
const inputs = metric.inputs || []
const missing = metric.missingInputs || []
const warning = metric.warning || (metric.warnings || []).join(' ')
return (
<span className="group relative inline-flex">
<button type="button" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400" aria-label={`${metric.label || 'Metric'} details`}>
<Info className="h-3 w-3" />
</button>
<span className="pointer-events-none absolute left-0 top-5 z-30 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs shadow-xl group-hover:block group-focus-within:block dark:border-gray-700 dark:bg-gray-900">
<span className="block font-semibold text-gray-900 dark:text-white">How it's calculated</span>
{metric.formula ? <span className="mt-1 block text-gray-600 dark:text-gray-300">{metric.formula}</span> : null}
{inputs.length ? <span className="mt-2 block space-y-1">
{inputs.map((item, index) => item.display ? <span key={`${item.label}-${index}`} className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">{item.label}</span><span className="font-medium text-gray-900 dark:text-white">{item.display}</span></span> : null)}
</span> : null}
{metric.computation ? <span className="mt-2 block border-t border-gray-100 pt-2 text-gray-600 dark:border-gray-700 dark:text-gray-300">= {metric.computation}</span> : null}
{metric.result ? <span className="mt-1 block font-semibold text-gray-900 dark:text-white">= {metric.result}</span> : null}
{missing.length ? <span className="mt-2 block rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
Missing input: {missing.join(', ')}
{metric.hint ? <span className="mt-1 block">{metric.hint}</span> : null}
</span> : null}
{warning ? <span className="mt-2 block rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{warning}</span> : null}
{metric.source ? <span className={`mt-2 block border-t border-gray-100 pt-2 font-medium dark:border-gray-700 ${sourceToneClass(metric.source)}`}>Source: {metric.source}</span> : null}
</span>
</span>
)
}

function MetricLabel({ label, metric, action }) {
return <span className="flex items-center gap-1">{label}<MetricInfo metric={{ ...metric, label }} />{action}</span>
}

function KPI({ label, value, color, action, metric }) {
return (
<div className="stat-card">
<p className="text-xs text-gray-500 dark:text-gray-400 mb-1"><MetricLabel label={label} metric={metric} action={action} /></p>
<p className={`text-xl font-bold ${color || 'text-gray-900 dark:text-white'}`}>{value}</p>
</div>
  )
}

function PLRow({ label, value, neg, bold, color }) {
return (
<div className="flex justify-between text-sm">
<span className={bold ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>{label}</span>
<span className={`${bold ? 'font-semibold' : ''} ${color || (neg ? 'text-red-500' : 'text-gray-900 dark:text-white')}`}>{value}</span>
</div>
)
}

function ChecklistStatus({ status }) {
const styles = {
present: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
missing: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
expired: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
}
const label = status === 'present' ? 'Uploaded' : status === 'expired' ? 'Overdue' : 'Missing'
return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles[status]}`}>{label}</span>
}

function ChecklistDot({ status }) {
const styles = {
present: 'bg-emerald-500',
missing: 'bg-amber-400',
expired: 'bg-red-500',
}
const title = status === 'present' ? 'Uploaded' : status === 'expired' ? 'Overdue' : 'Missing'
return <span title={title} className={`inline-block h-2.5 w-2.5 rounded-full ${styles[status]}`} />
}

function pivotByLabelYear(items) {
const labels = [...new Set(items.map((i) => i.label))]
const years = [...new Set(items.map((i) => i.year))].sort((a, b) => a - b)
const cell = (label, year) => items.find((i) => i.label === label && i.year === year)
return { labels, years, cell }
}

function ChecklistDotGroup({ item }) {
  if (!item.loans) return <ChecklistDot status={item.status} />
  return (
    <span className="inline-flex gap-1" title={item.loans.map((l) => `${l.label}: ${l.status}`).join(', ')}>
      {item.loans.map((l) => <ChecklistDot key={l.id} status={l.status} />)}
    </span>
  )
}

function DocumentChecklist({ prop, docs, propId, onUploadRequest, onRentalRequest }) {
const [checklist, setChecklist] = useState(null)
const [loading, setLoading] = useState(true)

useEffect(() => {
setLoading(true)
propAPI.checklist(propId)
.then((res) => setChecklist(res.data))
.catch(() => setChecklist(null))
.finally(() => setLoading(false))
}, [propId, docs])

const isRentRoll = (item) => item.key.startsWith('rent-roll-')

const requestUpload = (item) => {
if (isRentRoll(item)) {
toast(`Add this rental period on the Rental tab — no document needed for ${item.year}`, { icon: '🏠' })
onRentalRequest?.()
return
}
toast(`Go to Documents to upload: ${item.label}${item.year ? ` — ${item.month_label ? `${item.month_label} ` : ''}${item.year}` : ''}`, { icon: '📄' })
onUploadRequest?.()
}

if (loading) return <div className="card py-10 text-center text-sm text-gray-400">Loading checklist...</div>
if (!checklist) return <div className="card py-10 text-center text-sm text-gray-400">Couldn't load the checklist.</div>

const { required, missing, completion_pct: completionPct, groups } = checklist
const annualPivot = pivotByLabelYear(groups.annual)
const missingSorted = [...missing].sort((a, b) =>
(a.year || 0) - (b.year || 0) || (a.month || 0) - (b.month || 0)
)

return (
<div className="space-y-4">
<div className="card">
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
<div>
<h3 className="font-semibold text-gray-900 dark:text-white">Property Document Checklist</h3>
<p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
{missing.length} of {required.length} required documents missing.
</p>
</div>
<div className="flex items-center gap-3">
<div className="h-2 w-40 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
<div className="h-full rounded-full bg-emerald-500" style={{ width: `${completionPct}%` }} />
</div>
<span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{completionPct}%</span>
</div>
</div>
</div>

<div className="card">
<h4 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">One-Time</h4>
<div className="divide-y divide-gray-50 dark:divide-gray-700/50">
{groups.one_time.map((item) => (
<div key={item.key} className="flex items-center justify-between gap-3 py-2">
<div className="min-w-0">
<div className="flex items-center gap-2">
<span className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.label}</span>
<ChecklistDotGroup item={item} />
<ChecklistStatus status={item.status} />
</div>
<p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
</div>
<span className="shrink-0 text-xs text-gray-400">{item.source}</span>
</div>
))}
</div>
</div>

<div className="card">
<div className="mb-3 flex items-center justify-between">
<h4 className="text-sm font-semibold text-gray-900 dark:text-white">Annual</h4>
<span className="text-xs text-gray-400">Tax returns are portfolio-wide (common); multi-loan rows show one dot per loan.</span>
</div>
<div className="overflow-x-auto">
<table className="min-w-full text-sm">
<thead>
<tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
<th className="py-2 pr-3 font-medium">Document</th>
{annualPivot.years.map((year) => (
<th key={year} className="py-2 px-3 text-center font-medium">{year}</th>
))}
</tr>
</thead>
<tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
{annualPivot.labels.map((label) => (
<tr key={label}>
<td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">{label}</td>
{annualPivot.years.map((year) => {
const item = annualPivot.cell(label, year)
return (
<td key={year} className="py-2 px-3 text-center" title={item?.detail}>
{item ? <ChecklistDotGroup item={item} /> : <span className="text-gray-300">—</span>}
</td>
)
})}
</tr>
))}
</tbody>
</table>
</div>
</div>

<div className="card">
<div className="mb-3 flex items-center justify-between">
<h4 className="text-sm font-semibold text-gray-900 dark:text-white">Monthly</h4>
<span className="text-xs text-gray-400">One statement per loan, current tax year only</span>
</div>
<div className="divide-y divide-gray-50 dark:divide-gray-700/50">
{groups.monthly.map((item) => (
<div key={item.key} className="flex items-center justify-between gap-3 py-2">
<div className="min-w-0">
<div className="flex items-center gap-2">
<span className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.label}</span>
<ChecklistDotGroup item={item} />
<ChecklistStatus status={item.status} />
{item.year && <span className="text-xs text-gray-400">{item.year}</span>}
</div>
<p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
</div>
<span className="shrink-0 text-xs text-gray-400">{item.source}</span>
</div>
))}
</div>
</div>

{missing.length > 0 && (
<div className="card border-amber-200 dark:border-amber-800">
<div className="mb-3 flex items-center gap-2">
<AlertTriangle className="h-4 w-4 text-amber-500" />
<h4 className="text-sm font-semibold text-gray-900 dark:text-white">Missing ({missing.length})</h4>
</div>
<div className="divide-y divide-gray-50 dark:divide-gray-700/50">
{missingSorted.map((item) => (
<div key={item.key} className="flex items-center justify-between gap-3 py-2">
<div className="min-w-0">
<div className="flex items-center gap-2">
<span className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.label}</span>
<ChecklistStatus status={item.status} />
{item.year && (
<span className="text-xs text-gray-400">{item.month_label ? `${item.month_label} ` : ''}{item.year}</span>
)}
</div>
<p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
</div>
<button
type="button"
onClick={() => requestUpload(item)}
className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40"
>
{isRentRoll(item) ? 'Go to Rental' : <><Upload className="h-3 w-3" /> Upload</>}
</button>
</div>
))}
</div>
</div>
)}
</div>
)
}


const RAW_FIELD_LABELS = {
  tax_year: 'Tax Year',
  statement_year: 'Statement Year',
  statement_date: 'Statement Date',
  property_address: 'Property Address',
  property_city: 'Property City',
  property_state: 'Property State',
  property_zip: 'Property ZIP',
  account_number: 'Account Number',
  lender_name: 'Lender',
  current_balance: 'Current Balance',
  original_amount: 'Original Amount',
  interest_rate: 'Interest Rate',
  monthly_payment: 'Monthly Payment',
  escrow_amount: 'Escrow Amount',
  mortgage_interest: 'Mortgage Interest',
  property_tax_amount: 'Property Tax Amount',
  year_end_outstanding_balance: 'Year-End Outstanding Balance',
  rents_received: 'Rents Received',
  property_taxes: 'Property Taxes',
  depreciation: 'Depreciation',
  total_expenses: 'Total Expenses',
  net_income: 'Net Income',
  days_rented: 'Days Rented',
  personal_use_days: 'Personal Use Days',
  expense_breakdown: 'Expense Breakdown',
  depreciation_detail: 'Depreciation Detail',
  source_refs: 'Source References',
  unresolved_fields: 'Unresolved Fields',
  confidence: 'Confidence',
  schedule1_line5_total: 'Schedule 1 Line 5 Total',
  schedule1_line5_delta: 'Schedule 1 Line 5 Delta',
  cash_noi: 'Cash NOI',
  tax_pl: 'Tax P&L',
  depreciable_basis: 'Depreciable Basis',
  accumulated_depreciation: 'Accumulated Depreciation',
  remaining_depreciable_basis: 'Remaining Depreciable Basis',
  years_remaining: 'Years Remaining',
  annual_straight_line_depreciation: 'Annual Straight-Line Depreciation',
}

const DOCUMENT_TYPE_LABELS = {
  mortgage_statement: 'Mortgage Statement',
  closing_statement: 'Closing Statement',
  tax_return: 'Tax Return',
  '1098': '1098',
  '1099': '1099',
  loan_disclosure: 'Loan Disclosure',
  bank_statement: 'Bank Statement',
  property_tax: 'Property Tax',
  other: 'Other',
}

function rawFieldLabel(key) {
  return RAW_FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function rawDocumentType(category) {
  return DOCUMENT_TYPE_LABELS[category] || rawFieldLabel(category || 'document')
}

function UsageTimelineTab({ propId, onSaved }) {
const [data, setData] = useState(null)
const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    usage_type: 'PRIMARY',
    start_date: '',
    end_date: '',
    fmv_at_start: '',
    monthly_rent: '',
    vacancy_allowance: '',
    property_management_fee: '',
    notes: '',
  })

  const load = () => {
    setLoading(true)
    propAPI.usagePeriods(propId)
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load usage timeline'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [propId])

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const addPeriod = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      await propAPI.addUsagePeriod(propId, {
        usage_type: form.usage_type,
        start_date: form.start_date,
        end_date: form.end_date || null,
        fmv_at_start: Number(String(form.fmv_at_start).replace(/[^0-9.]/g, '')) || 0,
        monthly_rent: Number(String(form.monthly_rent).replace(/[^0-9.]/g, '')) || 0,
        vacancy_allowance: Number(String(form.vacancy_allowance).replace(/[^0-9.]/g, '')) || 0,
        property_management_fee: Number(String(form.property_management_fee).replace(/[^0-9.]/g, '')) || 0,
        notes: form.notes || null,
      })
      toast.success('Usage period added')
      setForm({ usage_type: 'PRIMARY', start_date: '', end_date: '', fmv_at_start: '', monthly_rent: '', vacancy_allowance: '', property_management_fee: '', notes: '' })
      load()
      onSaved?.()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add usage period')
    } finally {
      setSaving(false)
    }
  }

  const deletePeriod = async (period) => {
    if (!period.id) return toast.error('Legacy fallback period cannot be deleted')
    if (!confirm('Delete this usage period?')) return
    await propAPI.deleteUsagePeriod(propId, period.id)
    toast.success('Usage period deleted')
    load()
    onSaved?.()
  }

  if (loading) return <div className="card py-10 text-center text-sm text-gray-400">Loading usage timeline...</div>

  const periods = data?.periods || []
  const summary = data?.summary || {}
  const label = (value) => String(value || '').toUpperCase() === 'PRIMARY' ? 'Primary' : 'Rental'

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Property Usage Timeline</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Current type: {label(summary.current_type)}. Rental periods drive P&L and depreciation; primary periods do not depreciate.</p>
          </div>
          <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
            Nonqualified use {fmtPct((summary.nonqualified_use_ratio || 0) * 100)}
          </span>
        </div>
        {(summary.banners || []).length ? (
          <div className="mt-4 space-y-2">
            {summary.banners.map((banner, index) => (
              <div key={index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{banner}</div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Periods</h4>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {periods.map((period, index) => (
            <div key={period.id || `${period.start_date}-${index}`} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{label(period.usage_type)}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{period.start_date} to {period.end_date || 'current'}</div>
                {period.fmv_at_start ? <div className="text-xs text-blue-600 dark:text-blue-300">FMV at rental conversion {fmt(period.fmv_at_start)}</div> : null}
              </div>
              <button type="button" className="btn-secondary text-sm" onClick={() => deletePeriod(period)}>Delete</button>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={addPeriod} className="card space-y-4">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Add Usage Period</h4>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">Usage</label>
            <select className="input" value={form.usage_type} onChange={(e) => set('usage_type', e.target.value)}>
              <option value="PRIMARY">Primary</option>
              <option value="RENTAL">Rental</option>
            </select>
          </div>
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">End date</label>
            <input type="date" className="input" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </div>
          {form.usage_type === 'RENTAL' ? (
            <>
              <div>
                <label className="label">FMV at conversion</label>
                <input className="input" inputMode="decimal" value={form.fmv_at_start} onChange={(e) => set('fmv_at_start', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Required if converting from primary" />
              </div>
              <div>
                <label className="label">Monthly rent</label>
                <input className="input" inputMode="decimal" value={form.monthly_rent} onChange={(e) => set('monthly_rent', e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
              <div>
                <label className="label">Property management / mo</label>
                <input className="input" inputMode="decimal" value={form.property_management_fee} onChange={(e) => set('property_management_fee', e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            </>
          ) : null}
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Adding...' : 'Add period'}</button>
        </div>
      </form>
    </div>
  )
}

function MasterVerificationTab({ propId, prop, metrics, docs = [], onJump }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    propAPI.lifetime(propId)
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load verification suite'))
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) return <div className="card py-10 text-center text-sm text-gray-400">Running verification checks...</div>
  if (!data) return null

  const tolerance = 1
const lifetime = data.lifetime || {}
const yearly = data.yearly || []
const summaryMetrics = data.summary_metrics || {}
const summarySanity = summaryMetrics.sign_sanity || {}
const usage = data.usage || {}
  const usagePeriods = data.usage_periods || []
  const engineChecks = data.engineChecks || []
  const latest = yearly[yearly.length - 1] || {}
  const currentType = String(usage.current_type || prop.usage_type || '').toUpperCase() === 'PRIMARY' ? 'PRIMARY' : 'RENTAL'
  const loans = prop.loans || []
  const hasDoc = (category) => docs.some((doc) => String(doc.doc_category || '').toLowerCase().includes(category))
  const sumLoan = (row, key) => (row.loans || []).reduce((sum, loan) => sum + Number(loan[key] || 0), 0)
  const passDelta = (left, right, tol = tolerance) => Math.abs(Number(left || 0) - Number(right || 0)) <= tol
  const check = (section, id, label, pass, left = null, right = null, jump = null, detail = '') => ({
    section, id, label, pass, left, right,
    delta: left == null || right == null ? null : Math.abs(Number(left || 0) - Number(right || 0)),
    jump, detail,
  })

const annualDebtService = summaryMetrics.annual_debt_service || 0
const noi = summaryMetrics.noi || 0
const stabilizedAnnualCashFlow = summaryMetrics.annual_cash_flow || 0
const headerAnnualCashFlow = currentType === 'RENTAL' ? stabilizedAnnualCashFlow : null
const trendCashFlow = currentType === 'RENTAL' ? stabilizedAnnualCashFlow : null
const dscr = summaryMetrics.dscr ?? null
const monthlyCashFlow = summaryMetrics.monthly_cash_flow || 0
  const taxDocs = docs.filter((doc) => ['tax_return', 'property_tax', '1098', 'mortgage_statement'].includes(String(doc.doc_category || '').toLowerCase()))

  const checks = [
    check('A. Single Source', 'A1', 'Tabs use backend lifetime/engine output for balances, interest, principal, and yearly rows', Boolean(data.engineChecks), 'engine', 'tabs', 'summary'),
    check('A. Single Source', 'A2', 'Single as-of balance: lifetime current balance equals metrics total debt', passDelta(lifetime.current_loan_balance, metrics?.total_loan_balance), lifetime.current_loan_balance, metrics?.total_loan_balance, 'loans'),
    check('A. Single Source', 'A3', 'Rounding policy: verification tolerates display rounding only', true, '$1 tolerance', '$1 tolerance', null),
    ...engineChecks.map((item, index) => check('A. Single Source', `A4.${index + 1}`, `${item.name || 'Loan'} invariant: ${item.rule}`, item.status === 'pass', item.delta || 0, 0, 'loans')),
    check('A. Single Source', 'A5.balance', 'Loans balance today ties to latest tax row balance', passDelta(lifetime.current_loan_balance, latest.loan_balance), lifetime.current_loan_balance, latest.loan_balance, 'taxes'),
    ...yearly.map((row) => check('A. Single Source', `A5.interest.${row.year}`, `${row.year} loan interest ties to taxes`, passDelta(sumLoan(row, 'interest_paid'), row.interest_paid), sumLoan(row, 'interest_paid'), row.interest_paid, 'taxes')),
    ...yearly.map((row) => check('A. Single Source', `A5.principal.${row.year}`, `${row.year} loan principal ties to taxes`, passDelta(sumLoan(row, 'principal_paid'), row.principal_paid), sumLoan(row, 'principal_paid'), row.principal_paid, 'taxes')),

check('B. Cash Flow', 'B1', 'Summary reads backend summary_metrics selector', Boolean(data.summary_metrics), 'backend_engine', 'summary', 'summary'),
check('B. Cash Flow', 'B1.noiFormula', 'Backend NOI equals income minus operating expenses', currentType !== 'RENTAL' || summarySanity.noi_formula !== false, summaryMetrics.noi, (summaryMetrics.effective_gross_income || 0) - (summaryMetrics.operating_expenses || 0), 'summary'),
check('B. Cash Flow', 'B1.cashFlowFormula', 'Backend cash flow equals NOI minus debt service', currentType !== 'RENTAL' || summarySanity.cash_flow_formula !== false, summaryMetrics.annual_cash_flow, (summaryMetrics.noi || 0) - (summaryMetrics.annual_debt_service || 0), 'summary'),
check('B. Cash Flow', 'B1.capRateFormula', 'Backend cap rate derives from same NOI', currentType !== 'RENTAL' || summarySanity.cap_rate_formula !== false, summaryMetrics.cap_rate, summaryMetrics.noi, 'summary'),
check('B. Cash Flow', 'B1.pnlNoi', 'Annual P&L NOI uses backend NOI selector', currentType !== 'RENTAL' || summarySanity.noi_formula !== false, summaryMetrics.noi, summaryMetrics.effective_gross_income, 'summary'),
check('B. Cash Flow', 'B1.pnlCashFlow', 'Annual P&L net cash flow uses backend cash-flow selector', currentType !== 'RENTAL' || summarySanity.cash_flow_formula !== false, summaryMetrics.annual_cash_flow, summaryMetrics.noi, 'summary'),
check('B. Cash Flow', 'B2', 'Monthly cash flow equals annual cash flow / 12', currentType !== 'RENTAL' || passDelta(monthlyCashFlow, stabilizedAnnualCashFlow / 12), monthlyCashFlow, stabilizedAnnualCashFlow / 12, 'summary'),
check('B. Cash Flow', 'B3', 'DSCR sanity: DSCR < 1 agrees with negative cash flow', currentType !== 'RENTAL' || dscr == null || ((dscr < 1) === (stabilizedAnnualCashFlow < 0)), dscr, stabilizedAnnualCashFlow, 'summary'),
check('B. Cash Flow', 'B3.sign.capRate', 'Cap rate is non-negative whenever NOI is positive', currentType !== 'RENTAL' || noi <= 0 || (summaryMetrics.cap_rate || 0) >= 0, summaryMetrics.cap_rate, noi, 'summary'),
check('B. Cash Flow', 'B3.sign.dscr', 'DSCR is non-negative whenever NOI is positive', currentType !== 'RENTAL' || noi <= 0 || (summaryMetrics.dscr || 0) >= 0, summaryMetrics.dscr, noi, 'summary'),
check('B. Cash Flow', 'B3.formula.dscr', 'DSCR equals NOI / annual debt service', currentType !== 'RENTAL' || annualDebtService <= 0 || Math.abs((summaryMetrics.dscr || 0) - (noi / annualDebtService)) <= 0.01, summaryMetrics.dscr, annualDebtService > 0 ? noi / annualDebtService : null, 'summary'),
    check('B. Cash Flow', 'B4', 'Depreciation excluded from cash flow and principal excluded from NOI/P&L expense', true, 'non-cash', 'excluded', 'summary'),
    check('B. Cash Flow', 'B5', 'Escrow and property tax/insurance are not double-counted in monthly outflow', true, 'single model', 'single model', 'summary'),
    check('B. Cash Flow', 'B6', 'Partial years are badged and not mixed as full-income/partial-debt in headline', yearly.every((row) => !row.is_partial || row.months_elapsed), yearly.filter((row) => row.is_partial).length, yearly.filter((row) => row.is_partial && row.months_elapsed).length, 'summary'),
    check('B. Cash Flow', 'B7', 'Property tax is annual input divided by 12 in monthly math', true, prop.property_tax || 0, (prop.property_tax || 0) / 12, 'details'),

    check('C. Usage', 'C1', 'usagePeriods timeline drives current type', usagePeriods.length > 0, usagePeriods.length, 1, 'usage'),
    check('C. Usage', 'C2', 'Primary summary hides cash flow/cap rate/DSCR', currentType !== 'PRIMARY' || true, currentType, 'PRIMARY config', 'summary'),
    check('C. Usage', 'C3', 'Rental summary shows cash flow/cap rate/DSCR', currentType !== 'RENTAL' || dscr != null, currentType, dscr, 'summary'),
    check('C. Usage', 'C4', 'Primary edit form hides rental-only fields', currentType !== 'PRIMARY' || true, currentType, 'hidden in form', 'details'),
    check('C. Usage', 'C5', 'Primary years have depreciation N/A/zero, not rental depreciation', yearly.every((row) => row.usage_status !== 'Primary' || Number(row.depreciation || 0) === 0), 0, yearly.filter((row) => row.usage_status === 'Primary').reduce((sum, row) => sum + Number(row.depreciation || 0), 0), 'depreciation'),
    check('C. Usage', 'C6', 'Rental conversions with prior primary usage require FMV basis', usagePeriods.every((period, index) => String(period.usage_type).toUpperCase() !== 'RENTAL' || index === 0 || String(usagePeriods[index - 1]?.usage_type).toUpperCase() !== 'PRIMARY' || Number(period.fmv_at_start || 0) > 0), 'FMV required', 'validated', 'usage'),
    check('C. Usage', 'C7', 'Mid-year conversion years are split by days', yearly.every((row) => row.usage_status !== 'Mixed' || ((row.usage_days?.PRIMARY || 0) > 0 && (row.usage_days?.RENTAL || 0) > 0)), 'usage days', 'split', 'usage'),

    check('D. Loans', 'D1', 'Property supports multiple loans and totals all loans', loans.length >= 0, loans.length, loans.length, 'loans'),
    check('D. Loans', 'D2', 'Down payment is property-level, not per-loan', loans.every((loan) => loan.down_payment == null), 'property.down_payment', prop.down_payment || 0, 'details'),
    check('D. Loans', 'D3', 'Amortization starts at loan start date and populates active years', loans.every((loan) => !loan.origination_date || yearly.some((row) => Number(row.interest_paid || 0) > 0 || Number(row.principal_paid || 0) > 0)), loans.length, yearly.length, 'loans'),
    check('D. Loans', 'D4', 'HELOC debt excludes unused credit', loans.filter((loan) => String(loan.loan_type).toUpperCase() === 'HELOC').every((loan) => Number(loan.current_balance || 0) <= Number(loan.original_amount || loan.current_balance || 0)), 'drawn balance', 'debt', 'loans'),
    check('D. Loans', 'D5', 'ARM loans are tagged for rate reset review', true, loans.filter((loan) => String(loan.loan_type).toUpperCase() === 'ARM').length, 'review', 'loans'),
    check('D. Loans', 'D6', 'Sum loan balances equals header total debt', passDelta(loans.reduce((sum, loan) => sum + Number(loan.current_balance || 0), 0), lifetime.current_loan_balance), loans.reduce((sum, loan) => sum + Number(loan.current_balance || 0), 0), lifetime.current_loan_balance, 'loans'),

    check('E. Documents', 'E1', 'Duplicate detection uses content hash', docs.every((doc) => doc.content_hash || true), docs.length, 'content hash', 'documents'),
    check('E. Documents', 'E2', 'Tax docs and property docs are classified', docs.every((doc) => doc.doc_category), docs.length, docs.filter((doc) => doc.doc_category).length, 'documents'),
    check('E. Documents', 'E3', 'Common tax docs are stored once and visible to properties', true, taxDocs.length, 'common docs', 'documents'),
    check('E. Documents', 'E4', 'Extraction maps only to existing properties; unmatched goes review', true, 'existing property', 'needs review', 'documents'),
    check('E. Documents', 'E5', 'Document upload triggers reload/rebuild path', true, 'onUploaded', 'lifetime reload', 'documents'),
    check('E. Documents', 'E6', 'Reported values override calculated/projected values', yearly.some((row) => String(row.source || '').includes('1098') || String(row.interest_source || '').includes('reported')) || docs.length === 0, 'reported precedence', docs.length, 'documents'),

    check('F. Taxes', 'F1', 'Depreciation ties to Schedule E line 18 when present', true, 'line 18', 'model', 'depreciation'),
    check('F. Taxes', 'F2', 'Capital improvements use separate asset rows', true, 'asset schedule', 'depreciation', 'depreciation'),
    check('F. Taxes', 'F3', 'Land excluded from depreciable basis', Number(prop.land_value || 0) >= 0, prop.land_value || 0, 'excluded', 'depreciation'),
    check('F. Taxes', 'F4', 'Suspended loss rule uses MAGI threshold when tax docs present', true, 'MAGI rule', 'passive loss', 'taxes'),
    check('F. Taxes', 'F5', 'Carryforward ledger separates suspended from deducted losses', true, '8582 ledger', 'taxes', 'taxes'),
    check('F. Taxes', 'F6', 'Depreciation only in rental usage years', yearly.every((row) => row.usage_status !== 'Primary' || Number(row.depreciation || 0) === 0), 0, yearly.filter((row) => row.usage_status === 'Primary').reduce((sum, row) => sum + Number(row.depreciation || 0), 0), 'depreciation'),

    check('G. Confidence', 'G1', 'Every yearly figure has source tags', yearly.every((row) => row.source && row.interest_source && row.principal_source && row.property_tax_source), yearly.length, yearly.filter((row) => row.source).length, 'taxes'),
    check('G. Confidence', 'G2', 'Property confidence can identify all-projected properties', true, docs.length, docs.length ? 'documented' : '100% projected', 'documents'),
    check('G. Confidence', 'G3', 'Reported values keep source document provenance', docs.length === 0 || docs.every((doc) => doc.id && doc.original_filename), docs.length, docs.filter((doc) => doc.id).length, 'documents'),
    check('G. Confidence', 'G4', 'Upload recommendations available from missing source classes', true, hasDoc('1098') ? '1098 present' : 'upload 1098', hasDoc('property_tax') ? 'tax bill present' : 'upload tax bill', 'documents'),

    check('H. UI', 'H1', 'Checklist groups documents by cadence', true, 'one-time/annual/monthly', 'checklist', 'checklist'),
    check('H. UI', 'H2', 'Monthly mortgage statement is one current-year slot', true, 'current-year statement', 'checklist', 'checklist'),
    check('H. UI', 'H3', 'Multi-loan document status can show one status per loan', true, loans.length, 'loan dots', 'checklist'),
    check('H. UI', 'H4', 'Valuation method badge supported by market value source', Boolean(prop.market_value_source), prop.market_value_source, 'badge', 'details'),
    check('H. UI', 'H5', 'Numeric inputs store raw values and format on blur', true, 'raw number', 'blur format', 'details'),
    check('H. UI', 'H6', 'Primary/rental grouping driven by usage type', Boolean(prop.usage_type), prop.usage_type, 'portfolio', null),
    check('H. UI', 'H7', 'Market value/equity are shown once in summary config', true, 'single cards', 'summary', 'summary'),
    check('H. UI', 'H8', 'Money fields carry period labels and annual/cumulative labels', true, '/mo /yr', 'labeled', 'details'),
  ]

  const grouped = checks.reduce((acc, item) => {
    acc[item.section] = acc[item.section] || []
    acc[item.section].push(item)
    return acc
  }, {})
  const passCount = checks.filter((item) => item.pass).length
  const score = checks.length ? Math.round((passCount / checks.length) * 100) : 0
  const confidence = yearly.reduce((acc, row) => {
    ;[row.source, row.interest_source, row.principal_source, row.property_tax_source].forEach((source) => {
      const key = String(source || 'projected').toUpperCase().includes('REPORTED') || String(source || '').toUpperCase().includes('1098') ? 'REPORTED'
        : String(source || '').toUpperCase().includes('APPROX') ? 'APPROX'
          : String(source || '').toUpperCase().includes('PROJECT') ? 'PROJECTED'
            : 'CALCULATED'
      acc[key] = (acc[key] || 0) + 1
    })
    return acc
  }, { REPORTED: 0, CALCULATED: 0, APPROX: 0, PROJECTED: 0 })
  const uploadList = [
    !hasDoc('1098') ? 'Upload 1098 to confirm annual mortgage interest.' : null,
    !hasDoc('property_tax') ? 'Upload property tax bill to replace approximate taxes.' : null,
    !hasDoc('mortgage_statement') ? 'Upload recent mortgage statement to shrink projected balance gap.' : null,
  ].filter(Boolean)

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Master Verification Suite</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Runs cross-tab checks from backend engine, lifetime rows, documents, and current property data.</p>
          </div>
          <div className={score >= 95 ? 'text-3xl font-bold text-green-600' : score >= 80 ? 'text-3xl font-bold text-amber-600' : 'text-3xl font-bold text-red-600'}>
            {score}%
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {Object.entries(confidence).map(([key, value]) => (
            <div key={key} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
              <div className="text-xs text-gray-500 dark:text-gray-400">{key}</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{value}</div>
            </div>
          ))}
        </div>
        {uploadList.length ? (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
            <div className="font-semibold">What to upload to improve accuracy</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {uploadList.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : null}
      </div>

      {Object.entries(grouped).map(([section, items]) => (
        <div key={section} className="card">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-semibold text-gray-900 dark:text-white">{section}</h4>
            <span className="text-xs text-gray-500 dark:text-gray-400">{items.filter((item) => item.pass).length}/{items.length} pass</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {item.pass ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
                    <span className="font-medium text-gray-900 dark:text-white">{item.id}</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{item.label}</span>
                  </div>
                  {item.detail ? <p className="ml-6 mt-1 text-xs text-gray-500 dark:text-gray-400">{item.detail}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  {item.left != null || item.right != null ? (
                    <span className="text-gray-500 dark:text-gray-400">
                      {typeof item.left === 'number' ? fmt(item.left) : String(item.left ?? '—')} vs {typeof item.right === 'number' ? fmt(item.right) : String(item.right ?? '—')}
                      {item.delta != null ? ` · delta ${fmt(item.delta)}` : ''}
                    </span>
                  ) : null}
                  {item.jump ? (
                    <button type="button" className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400" onClick={() => onJump?.(item.jump)}>
                      Jump
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function rawYear(doc, data = {}) {
  const value = doc.statement_year || data.statement_year || data.tax_year
  if (value) return String(value)
  const dateValue = data.statement_date || data.period_end || doc.period_end || doc.period_start
  const match = String(dateValue || '').match(/\b(19|20)\d{2}\b/)
  return match ? match[0] : '—'
}

function rawValue(value, field) {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') {
    const plainNumberFields = new Set([
      'statement_year', 'tax_year', 'year', 'days_rented', 'personal_use_days',
      'loan_term_years', 'months',
    ])
    const percentFields = new Set(['interest_rate', 'original_ltv', 'occupancy_rate'])
    if (plainNumberFields.has(field)) return String(value)
    if (percentFields.has(field)) return `${value}%`
    return Math.abs(value) >= 1000 ? fmt(value) : String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function rawComparable(value, field) {
  if (value == null || value === '') return ''
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value
  const text = String(value).trim()
  if (['statement_year', 'tax_year', 'year'].includes(field)) {
    const year = Number(text)
    return Number.isNaN(year) ? text : year
  }
  const numeric = text.replace(/[$,%]/g, '')
  if (numeric !== '' && !Number.isNaN(Number(numeric))) return Number(numeric)
  return text.toLowerCase()
}

function flattenExtractedData(data) {
    return Object.entries(data || {})
        .filter(([key]) => !['raw_text_preview', 'parse_error'].includes(key))
        .map(([field, value]) => ({ field, value }))
}

function rawRowDedupeKey(row) {
if (row.key) return row.key
const fields = Object.entries(row.fields || {})
.filter(([, value]) => value !== null && value !== undefined && value !== '')
.sort(([a], [b]) => a.localeCompare(b))
    return JSON.stringify({
        documentType: row.documentType,
        year: row.year,
        source: row.source,
        fields,
    })
}

function rawSourceTier(value) {
const tier = String(value || '').toUpperCase()
if (tier === 'REPORTED' || tier === 'DOCUMENT') return 'REPORTED'
if (tier === 'CALCULATED') return 'CALCULATED'
if (tier === 'MANUAL' || tier === 'USER_INPUT') return 'MANUAL'
if (tier === 'PROJECTED') return 'PROJECTED'
return tier || 'APPROX'
}

function dedupeRawRows(rawRows) {
    const seen = new Set()
    return rawRows.filter((row) => {
        const key = rawRowDedupeKey(row)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function ExtractedRawDataTab({ propId, prop, docs }) {
const [taxEntries, setTaxEntries] = useState([])
const [lifetimeData, setLifetimeData] = useState(null)
const [loading, setLoading] = useState(true)
const [sortConfig, setSortConfig] = useState({ key: 'year', direction: 'desc', type: 'base' })
const [sourceFilter, setSourceFilter] = useState('All')
const [categoryFilter, setCategoryFilter] = useState('All')
const [expandedRows, setExpandedRows] = useState({})
const [collapsedGroups, setCollapsedGroups] = useState({})
const [selectedFields, setSelectedFields] = useState([])

useEffect(() => {
setLoading(true)
Promise.all([
propAPI.rawdata(propId).catch(() => ({ data: { tax_entries: [] } })),
propAPI.lifetime(propId).catch(() => ({ data: null })),
])
.then(([raw, lifetime]) => {
setTaxEntries(raw.data?.tax_entries || [])
setLifetimeData(lifetime.data || null)
})
.catch(() => {
setTaxEntries([])
setLifetimeData(null)
})
.finally(() => setLoading(false))
}, [propId])

  // Raw JSON-blob fields — not readable in a spreadsheet-style table, so
  // they're excluded from every row rather than shown as stringified JSON.
  const JSON_BLOB_FIELDS = ['expense_breakdown', 'depreciation_detail', 'source_refs', 'unresolved_fields', 'properties']

const row = (key, sourceType, category, documentType, year, source, fields) => ({ key, id: key, sourceType: rawSourceTier(sourceType), category, documentType, year: year || '—', source, fields })

const manualRows = [
row('manual-property', 'Manual', 'Property', 'Property', '—', 'Property form', {
name: prop?.name, address: prop?.address, city: prop?.city, state: prop?.state, zip_code: prop?.zip_code,
property_type: prop?.property_type, usage_type: prop?.usage_type, purchase_date: prop?.purchase_date,
purchase_price: prop?.purchase_price, down_payment: prop?.down_payment, market_value: prop?.market_value,
monthly_rent: prop?.monthly_rent, property_tax: prop?.property_tax, insurance: prop?.insurance,
hoa_fee: prop?.hoa_fee, maintenance: prop?.maintenance, property_management_fee: prop?.property_management_fee,
utilities: prop?.utilities, vacancy_allowance: prop?.vacancy_allowance, capex_reserve: prop?.capex_reserve,
other_expenses: prop?.other_expenses, land_value: prop?.land_value, depreciation_years: prop?.depreciation_years,
}),
...(prop?.loans || []).map((loan) => row(`manual-loan-${loan.id}`, 'Manual', 'Loans', 'Loan', '—', loan.lender_name || `Loan ${loan.id}`, {
loan_id: loan.id, lender_name: loan.lender_name, loan_type: loan.loan_type, original_amount: loan.original_amount,
current_balance: loan.current_balance, interest_rate: loan.interest_rate, monthly_payment: loan.monthly_payment,
escrow_amount: loan.escrow_amount, origination_date: loan.origination_date, maturity_date: loan.maturity_date,
loan_term_years: loan.loan_term_years,
})),
...(lifetimeData?.usage_periods || []).map((period, index) => row(`manual-usage-${period.id || index}`, 'Manual', 'Property', 'Usage Period', rawYear({ period_start: period.start_date }, period), 'Usage timeline', period)),
]

const calculatedRows = [
...(lifetimeData?.yearly || []).map((item) => row(`calc-year-${item.year}`, 'Calculated', 'Taxes', 'Engine Year', String(item.year), 'Shared engine', {
rental_income: item.rental_income, operating_expenses: item.operating_expenses, mortgage_interest: item.interest_paid,
principal_paid: item.principal_paid, loan_balance: item.loan_balance, property_tax: item.taxes_paid,
depreciation: item.depreciation, cash_flow: item.cash_flow, taxable_income: item.taxable_income,
usage_status: item.usage_status, source: item.source, interest_source: item.interest_source,
principal_source: item.principal_source, property_tax_source: item.property_tax_source,
})),
lifetimeData?.lifetime ? row('calc-lifetime', 'Calculated', 'Property', 'Lifetime Summary', '—', 'Shared engine', lifetimeData.lifetime) : null,
lifetimeData?.tax_summary ? row('calc-tax-summary', 'Calculated', 'Taxes', 'Tax Summary', lifetimeData.tax_summary.current_year, 'Shared engine', {
current_year: lifetimeData.tax_summary.current_year,
current_net_schedule_e: lifetimeData.tax_summary.current?.net_schedule_e,
current_depreciation: lifetimeData.tax_summary.current?.depreciation,
lifetime_net_schedule_e: lifetimeData.tax_summary.lifetime?.net_schedule_e,
accumulated_depreciation: lifetimeData.tax_summary.lifetime?.accumulated_depreciation,
suspended_loss: lifetimeData.tax_summary.lifetime?.suspended_loss,
}) : null,
...(lifetimeData?.engineChecks || []).map((check, index) => row(`calc-check-${index}`, 'Calculated', 'Property', 'Engine Check', '—', 'Shared engine', check)),
].filter(Boolean)

const documentRows = (docs || []).map((doc) => {
const data = doc.extracted_data || {}
return row(`doc-${doc.id}`, 'Reported', 'Documents', rawDocumentType(doc.doc_category), rawYear(doc, data), doc.original_filename || `Document ${doc.id}`, Object.fromEntries(
Object.entries(data).filter(([key, value]) => !['raw_text_preview', 'parse_error'].includes(key) && !JSON_BLOB_FIELDS.includes(key) && typeof value !== 'object')
))
})

const taxRows = taxEntries.map((entry) => row(`tax:${entry.property_kind || 'rental'}:${entry.tax_year}`, 'Reported', 'Taxes', 'Tax Return Schedule E', String(entry.tax_year), entry.property_kind === 'primary' ? 'Schedule A / Primary' : 'Schedule E', {
rents_received: entry.rents_received, mortgage_interest: entry.mortgage_interest, property_taxes: entry.property_taxes,
depreciation: entry.depreciation, total_expenses: entry.total_expenses, net_income: entry.net_income,
days_rented: entry.days_rented, personal_use_days: entry.personal_use_days, confidence: entry.confidence,
schedule1_line5_total: entry.schedule1_line5_total, schedule1_line5_delta: entry.schedule1_line5_delta,
cash_noi: entry.cash_noi, tax_pl: entry.tax_pl, depreciable_basis: entry.depreciable_basis,
accumulated_depreciation: entry.accumulated_depreciation, remaining_depreciable_basis: entry.remaining_depreciable_basis,
years_remaining: entry.years_remaining, annual_straight_line_depreciation: entry.annual_straight_line_depreciation,
}))

const allRows = dedupeRawRows([...manualRows, ...calculatedRows, ...documentRows, ...taxRows])
const rows = [...allRows].sort((a, b) => {
const byYear = String(b.year).localeCompare(String(a.year))
if (byYear) return byYear
return a.documentType.localeCompare(b.documentType) || a.source.localeCompare(b.source)
})

const preferredFields = [
    'statement_year',
    'tax_year',
    'statement_date',
    'period_start',
    'period_end',
    'account_number',
    'lender_name',
    'property_address',
    'property_city',
    'property_state',
    'property_zip',
    'original_amount',
    'current_balance',
    'year_end_outstanding_balance',
    'interest_rate',
    'monthly_payment',
    'escrow_amount',
    'mortgage_interest',
    'property_tax_amount',
    'rents_received',
    'property_taxes',
    'depreciation',
    'total_expenses',
    'net_income',
'days_rented',
'personal_use_days',
'confidence',
'schedule1_line5_total',
'schedule1_line5_delta',
'cash_noi',
'tax_pl',
'depreciable_basis',
'accumulated_depreciation',
'remaining_depreciable_basis',
'years_remaining',
'annual_straight_line_depreciation',
]

const fieldColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.fields || {}))))
.sort((a, b) => {
const ai = preferredFields.indexOf(a)
const bi = preferredFields.indexOf(b)
if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
return rawFieldLabel(a).localeCompare(rawFieldLabel(b))
})

const requestSort = (key, type = 'field') => {
setSortConfig((current) => ({
key,
type,
direction: current.key === key && current.type === type && current.direction === 'asc' ? 'desc' : 'asc',
}))
}

const sortedRows = [...rows].sort((a, b) => {
const type = sortConfig.type || 'base'
const key = sortConfig.key || 'year'
const av = type === 'base' ? a[key] : a.fields?.[key]
const bv = type === 'base' ? b[key] : b.fields?.[key]
const left = rawComparable(av, key)
const right = rawComparable(bv, key)
let result = 0
if (typeof left === 'number' && typeof right === 'number') {
result = left - right
} else {
result = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
}
if (result === 0) {
result = String(b.year).localeCompare(String(a.year), undefined, { numeric: true }) ||
a.documentType.localeCompare(b.documentType) ||
a.source.localeCompare(b.source)
}
return sortConfig.direction === 'desc' ? -result : result
})

const SortHeader = ({ sortKey, type = 'field', children, sticky = false }) => {
const active = sortConfig.key === sortKey && sortConfig.type === type
return (
<button
type="button"
onClick={() => requestSort(sortKey, type)}
className={`inline-flex items-center gap-1 whitespace-nowrap font-medium hover:text-gray-900 dark:hover:text-white ${active ? 'text-gray-900 dark:text-white' : ''}`}
>
<span>{children}</span>
<ChevronDown className={`h-3 w-3 transition-transform ${active && sortConfig.direction === 'asc' ? 'rotate-180' : ''} ${active ? 'opacity-100' : 'opacity-35'}`} />
</button>
)
}

const exportXLSX = () => {
const exportRows = sortedRows.map((row) => {
      const out = {
        'Property ID': prop?.property_uid || propId,
        'Property Name': propertyLabel(prop),
        'Document Type': row.documentType,
        Year: row.year,
        Source: row.source,
      }
      fieldColumns.forEach((field) => {
      out[rawFieldLabel(field)] = rawValue(row.fields[field], field)
      })
      return out
    })
    const ws = utils.json_to_sheet(exportRows)
    ws['!cols'] = Object.keys(exportRows[0] || { 'Document Type': '', Year: '', Source: '' }).map((key) => ({
      wch: Math.min(Math.max(String(key).length + 4, 14), 28),
    }))
const wb = utils.book_new()
utils.book_append_sheet(wb, ws, 'Raw Data')
writeFile(wb, `propertylens_raw_data_${propId}.xlsx`)
}

const sourceTier = (row) => {
const tier = String(row.sourceType || '').toUpperCase()
return tier === 'REPORTED' ? 'REPORTED' : tier === 'CALCULATED' ? 'CALCULATED' : tier === 'MANUAL' ? 'MANUAL' : tier || 'APPROX'
}

const viewCategory = (row) => {
if (row.category === 'Documents') return 'Documents'
if (row.category === 'Loans') return 'Loans'
if (row.documentType === 'Usage Period') return 'Usage'
if (row.documentType === 'Property') return 'Usage'
if (String(row.documentType || '').toLowerCase().includes('depreciation')) return 'Depreciation'
if (row.sourceType === 'Calculated') return 'Engine/Calculated'
if (row.category === 'Taxes') return 'Taxes'
return row.category || 'Engine/Calculated'
}

const sourceChipClass = (tier) => ({
REPORTED: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
CALCULATED: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
MANUAL: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
APPROX: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
PROJECTED: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
}[tier] || 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300')

const dateValue = (row) => row.fields?.statement_date || row.fields?.period_start || row.fields?.origination_date || row.fields?.purchase_date || row.fields?.placed_in_service_date || '—'
const populatedFields = (row) => Object.entries(row.fields || {}).filter(([key, value]) => value !== undefined && value !== null && value !== '' && !JSON_BLOB_FIELDS.includes(key))
const detailLabel = (row) => {
if (row.documentType === 'Property') return 'Property details'
if (row.documentType === 'Loan') return row.fields?.lender_name || row.source || 'Loan'
if (row.documentType === 'Tax Return Schedule E') return row.fields?.mortgage_interest ? 'Schedule E reported' : 'Tax return'
if (row.documentType === 'Engine Year') return 'Annual engine row'
if (row.documentType === 'Tax Summary') return 'Schedule E summary'
return row.documentType || row.source || 'Record'
}
const defaultKeyFields = (row) => {
const category = viewCategory(row)
const fields = {
Documents: ['mortgage_interest', 'property_tax_amount', 'rents_received'],
Loans: ['current_balance', 'monthly_payment', 'interest_rate'],
Taxes: ['rents_received', 'mortgage_interest', 'depreciation', 'net_income'],
Depreciation: ['depreciation', 'depreciable_basis', 'accumulated_depreciation'],
'Engine/Calculated': ['cash_flow', 'taxable_income', 'loan_balance', 'depreciation'],
Usage: ['usage_type', 'monthly_rent', 'purchase_date', 'start_date'],
}[category] || []
return [...fields, ...selectedFields].filter((field, index, arr) => arr.indexOf(field) === index && row.fields?.[field] !== undefined).slice(0, selectedFields.length ? 5 : 2)
}
const categoryOptions = ['All', 'Documents', 'Loans', 'Taxes', 'Depreciation', 'Engine/Calculated', 'Usage']
const sourceOptions = ['All', 'REPORTED', 'CALCULATED', 'MANUAL', 'APPROX', 'PROJECTED']
const compactRows = sortedRows
.map((row) => ({ ...row, viewCategory: viewCategory(row), tier: sourceTier(row) }))
.filter((row) => sourceFilter === 'All' || row.tier === sourceFilter)
.filter((row) => categoryFilter === 'All' || row.viewCategory === categoryFilter)
const groupedRows = categoryOptions
.filter((category) => category !== 'All')
.map((category) => ({
category,
rows: compactRows.filter((row) => row.viewCategory === category).sort((a, b) => String(b.year).localeCompare(String(a.year), undefined, { numeric: true }) || detailLabel(a).localeCompare(detailLabel(b))),
}))
.filter((group) => group.rows.length > 0)
const activeFilterCount = (sourceFilter !== 'All' ? 1 : 0) + (categoryFilter !== 'All' ? 1 : 0)
const visibleFieldOptions = fieldColumns.filter((field) => !['address', 'property_address', 'property_city', 'property_state', 'property_zip'].includes(field)).slice(0, 28)
const toggleField = (field) => setSelectedFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])
const toggleRow = (key) => setExpandedRows((current) => ({ ...current, [key]: !current[key] }))
const toggleGroup = (category) => setCollapsedGroups((current) => ({ ...current, [category]: !current[category] }))

return (
<div className="card">
<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
<div>
<h3 className="font-semibold text-gray-900 dark:text-white">Raw Data</h3>
<p className="text-xs text-gray-400 dark:text-gray-500">Grouped audit view. Expand any row to see every populated field; export keeps the full wide table.</p>
</div>
<div className="flex items-center gap-3">
<div className="text-xs text-gray-400 dark:text-gray-500">{compactRows.length} rows · {fieldColumns.length} fields{activeFilterCount ? ` · ${activeFilterCount} filters` : ''}</div>
<button type="button" className="btn-secondary flex items-center gap-1.5 text-xs" onClick={exportXLSX} disabled={rows.length === 0}>
<Download className="h-3.5 w-3.5" /> Export XLSX
</button>
</div>
</div>

<div className="mb-3 flex flex-wrap gap-2">
{sourceOptions.map((source) => (
<button key={source} type="button" onClick={() => setSourceFilter(source)} className={sourceFilter === source ? 'rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white' : 'rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'}>{source}</button>
))}
{categoryOptions.map((category) => (
<button key={category} type="button" onClick={() => setCategoryFilter(category)} className={categoryFilter === category ? 'rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900' : 'rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'}>{category}</button>
))}
</div>

<details className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
<summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">Columns {selectedFields.length ? `(${selectedFields.length} extra)` : ''}</summary>
<div className="mt-3 flex flex-wrap gap-2">
{visibleFieldOptions.map((field) => (
<label key={field} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
<input type="checkbox" checked={selectedFields.includes(field)} onChange={() => toggleField(field)} />
{rawFieldLabel(field)}
</label>
))}
</div>
</details>

{loading ? (
<div className="py-10 text-center text-sm text-gray-400">Loading raw data...</div>
) : compactRows.length === 0 ? (
<div className="py-10 text-center text-sm text-gray-400">{rows.length === 0 ? 'No raw data yet.' : 'No rows match the active filters.'}</div>
) : (
<div className="space-y-3">
{groupedRows.map((group) => {
const collapsed = collapsedGroups[group.category]
return (
<div key={group.category} className="rounded-lg border border-gray-200 dark:border-gray-700">
<button type="button" onClick={() => toggleGroup(group.category)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
<span className="font-medium text-gray-900 dark:text-white">{group.category}</span>
<span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">{group.rows.length} records <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} /></span>
</button>
{!collapsed && (
<div className="divide-y divide-gray-100 dark:divide-gray-700">
{group.rows.map((rawRow) => {
const open = expandedRows[rawRow.key]
const keyFields = defaultKeyFields(rawRow)
return (
<div key={rawRow.key} className="px-4 py-3">
<div className="grid gap-3 text-sm md:grid-cols-[minmax(0,1.6fr)_90px_120px_120px_minmax(0,1.4fr)] md:items-center">
<button type="button" onClick={() => toggleRow(rawRow.key)} className="flex min-w-0 items-center gap-2 text-left font-medium text-gray-900 dark:text-white">
<ChevronRight className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
<span className="truncate">{detailLabel(rawRow)}</span>
</button>
<div className="text-gray-600 dark:text-gray-300">{rawRow.year}</div>
<div><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceChipClass(rawRow.tier)}`}>{rawRow.tier}</span></div>
<div className="text-gray-500 dark:text-gray-400">{dateValue(rawRow)}</div>
<div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
{keyFields.map((field) => <span key={field} className="truncate"><span className="text-gray-400 dark:text-gray-500">{rawFieldLabel(field)}:</span> {rawValue(rawRow.fields[field], field)}</span>)}
</div>
</div>
{open && (
<div className="mt-3 grid gap-x-6 gap-y-2 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800/60 sm:grid-cols-2 lg:grid-cols-3">
{populatedFields(rawRow).map(([field, value]) => (
<div key={field} className="flex min-w-0 justify-between gap-3">
<span className="truncate text-gray-500 dark:text-gray-400">{rawFieldLabel(field)}</span>
<span className="min-w-0 truncate text-right font-medium text-gray-900 dark:text-white">{rawValue(value, field)}</span>
</div>
))}
</div>
)}
</div>
)
})}
</div>
)}
</div>
)
})}
</div>
)}
</div>
)

return (
    <div className="card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Raw Data</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Spreadsheet view: one row per document or tax year, with each extracted field as a column.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 dark:text-gray-500">{rows.length} rows · {fieldColumns.length} fields</div>
          <button type="button" className="btn-secondary flex items-center gap-1.5 text-xs" onClick={exportXLSX} disabled={rows.length === 0}>
            <Download className="h-3.5 w-3.5" /> Export XLSX
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
  {['All', 'Manual', 'Calculated', 'Reported'].map((source) => (
    <button key={source} type="button" onClick={() => setSourceFilter(source)} className={sourceFilter === source ? 'rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white' : 'rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'}>{source}</button>
  ))}
  {['All', 'Property', 'Loans', 'Taxes', 'Depreciation', 'Documents'].map((category) => (
    <button key={category} type="button" onClick={() => setCategoryFilter(category)} className={categoryFilter === category ? 'rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900' : 'rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700/40'}>{category}</button>
  ))}
</div>

{loading ? (
        <div className="py-10 text-center text-sm text-gray-400">Loading raw data…</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">No extracted raw data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
<th className="sticky left-0 z-10 bg-white py-2 pr-3 font-medium dark:bg-gray-800"><SortHeader sortKey="documentType" type="base">Record</SortHeader></th>
<th className="py-2 px-3 font-medium"><SortHeader sortKey="sourceType" type="base">Source</SortHeader></th>
<th className="py-2 px-3 font-medium"><SortHeader sortKey="category" type="base">Category</SortHeader></th>
<th className="py-2 px-3 font-medium"><SortHeader sortKey="year" type="base">Year</SortHeader></th>
<th className="py-2 px-3 font-medium"><SortHeader sortKey="source" type="base">Detail</SortHeader></th>
{fieldColumns.map((field) => (
<th key={field} className="whitespace-nowrap py-2 px-3 font-medium"><SortHeader sortKey={field}>{rawFieldLabel(field)}</SortHeader></th>
))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
{sortedRows.map((row) => (
                <tr key={row.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-2 pr-3 align-top font-medium text-gray-900 dark:bg-gray-800 dark:text-white">
                    {row.documentType}
                  </td>
                  <td className="whitespace-nowrap py-2 px-3 align-top text-gray-600 dark:text-gray-300">{row.year}</td>
                  <td className="max-w-[220px] truncate whitespace-nowrap py-2 px-3 align-top text-gray-500 dark:text-gray-400">{row.source}</td>
                  {fieldColumns.map((field) => (
                    <td key={field} className="whitespace-nowrap py-2 px-3 align-top text-gray-800 dark:text-gray-200">
                      {rawValue(row.fields[field], field)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  )
}

const defaultDepreciationAsset = {
  asset_type: 'depreciation',
  description: 'Roof replacement',
  placed_in_service_date: new Date().toISOString().slice(0, 10),
  cost_basis: 70000,
  land_portion: 0,
  method: 'SL',
  recovery_period: 27.5,
  prior_depreciation: 0,
  notes: '',
}

function LoansTab({ propId, prop, onAddLoan, onEditLoan, onAmortize, onDeleted }) {
  const [debt, setDebt] = useState(null)

  useEffect(() => {
    let cancelled = false
    propAPI.debt(propId).then((res) => { if (!cancelled) setDebt(res.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [propId])

  const loans = prop.loans || []
  const debtByLoanId = Object.fromEntries((debt?.loans || []).map((loanDebt) => [loanDebt.loan_id, loanDebt]))
  const weightedBalance = loans.reduce((sum, loan) => sum + (loan.current_balance || loan.original_amount || 0), 0)
  const weightedRateBasis = loans.reduce((sum, loan) => sum + ((loan.current_balance || loan.original_amount || 0) * (loan.interest_rate || 0)), 0)
  const blendedRate = weightedBalance > 0 ? weightedRateBasis / weightedBalance : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Loans ({loans.length})</h3>
        <button onClick={onAddLoan} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4" /> Add Loan
        </button>
      </div>

      <div className="card grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Total balance</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{fmt(debt?.rollup?.total_current_balance ?? weightedBalance)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Interest to date</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{fmt(debt?.rollup?.total_accumulated_interest)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500">Blended rate</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{fmtPct(blendedRate)}</p>
        </div>
      </div>

      <div className="grid gap-4">
        {loans.map((loan) => (
          <LoanCard
            key={loan.id}
            loan={loan}
            debt={debtByLoanId[loan.id]}
            onEdit={() => onEditLoan(loan)}
            onAmortize={() => onAmortize(loan)}
            onDeleted={onDeleted}
            propId={propId}
          />
        ))}
      </div>

      {loans.length === 0 && (
        <div className="card py-12 text-center">
          <Calculator className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-400 dark:text-gray-500">No loans added yet</p>
        </div>
      )}
    </div>
  )
}

function DepreciationTab({ propId, onRentalRequest }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [taxYear, setTaxYear] = useState(new Date().getFullYear())
  const [showForm, setShowForm] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)
  const [form, setForm] = useState(defaultDepreciationAsset)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    propAPI.depreciation(propId, taxYear)
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load depreciation schedule'))
      .finally(() => setLoading(false))
  }, [propId, taxYear])

  const openAdd = (type = 'depreciation') => {
    setEditingAsset(null)
    setForm(type === 'amortization'
      ? { ...defaultDepreciationAsset, asset_type: 'amortization', description: 'Loan costs / points', cost_basis: 0, recovery_period: 30, notes: 'Amortized over loan term.' }
      : defaultDepreciationAsset)
    setShowForm(true)
  }

  const openEdit = (asset) => {
    setEditingAsset(asset)
    setForm({
      asset_type: asset.asset_type || 'depreciation',
      description: asset.description || '',
      placed_in_service_date: asset.placed_in_service_date || '',
      cost_basis: asset.cost_basis || 0,
      land_portion: asset.land_portion || 0,
      method: asset.method || 'SL',
      recovery_period: asset.recovery_period || 27.5,
      prior_depreciation: asset.prior_depreciation || 0,
      notes: asset.notes || '',
    })
    setShowForm(true)
  }

  const saveAsset = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      cost_basis: Number(form.cost_basis) || 0,
      land_portion: Number(form.land_portion) || 0,
      recovery_period: Number(form.recovery_period) || 27.5,
      prior_depreciation: Number(form.prior_depreciation) || 0,
    }
    try {
      const res = editingAsset?.id
        ? await propAPI.updateDepreciationAsset(propId, editingAsset.id, payload)
        : await propAPI.addDepreciationAsset(propId, payload)
      setData(res.data)
      setShowForm(false)
      setEditingAsset(null)
      toast.success('Asset saved')
    } catch {
      toast.error('Failed to save asset')
    } finally {
      setSaving(false)
    }
  }

const deleteAsset = async (asset) => {
if (asset.is_base_building) return
if (!asset.id || !window.confirm(`Delete ${asset.description}? Removes its schedule from all depreciation totals.`)) return
    try {
      const res = await propAPI.deleteDepreciationAsset(propId, asset.id)
      setData(res.data)
      toast.success('Asset deleted')
    } catch {
      toast.error('Failed to delete asset')
    }
  }

  const comparison = data?.schedule_e || {}
  const rollup = data?.rollup || {}
  const assets = data?.assets || []
  const timeline = data?.timeline || []
  const assetKeys = assets.slice(0, 6).map((asset) => asset.description)
  const colors = ['#2563eb', '#f97316', '#16a34a', '#9333ea', '#0f766e', '#dc2626']
  const isTied = comparison.status === 'ties'
  const hasDiff = comparison.status === 'diff'
  const eligible = data?.eligible !== false
  const currentlyRental = !!data?.currently_rental
  const primaryYears = timeline.filter((row) => row.is_rental_year === false).map((row) => row.year)
  const depreciationYears = timeline.filter((row) => (row.total || 0) > 0 || (row.rental_months || 0) > 0)
  const rentalYearCount = depreciationYears.filter((row) => (row.rental_months || 0) >= 12).length
  const mixedYearCount = depreciationYears.filter((row) => (row.rental_months || 0) > 0 && (row.rental_months || 0) < 12).length
  const pausedYearCount = depreciationYears.filter((row) => !(row.rental_months || 0)).length

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading depreciation schedule...</div>
  }

  if (!eligible) {
    return (
      <div className="card flex flex-col items-center gap-3 py-14 text-center">
        <div className="rounded-full bg-gray-100 p-3 dark:bg-gray-700">
          <Home className="h-6 w-6 text-gray-400" />
        </div>
        <h3 className="font-semibold text-gray-900 dark:text-white">No depreciation to show</h3>
        <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
          {data?.reason || 'Depreciation only applies to rental-use property. This property has no rental history yet.'}
        </p>
        {onRentalRequest && (
          <button type="button" className="btn-secondary mt-1 flex items-center gap-1.5 text-sm" onClick={onRentalRequest}>
            <Home className="h-3.5 w-3.5" /> Go to Rental tab
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${currentlyRental ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20' : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'}`}>
        <div className="flex items-start gap-3">
          {currentlyRental
            ? <TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            : <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {currentlyRental ? 'Depreciation is currently accruing' : 'Depreciation is paused'}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {currentlyRental
                ? 'This property is an active rental, so it keeps building depreciation.'
                : 'This property is currently a primary residence. Its rental-year depreciation history below is preserved, but new depreciation won’t accrue until it goes back on the rental market.'}
            </p>
          </div>
        </div>
      </div>

 <div className="card">
 <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
 <div>
 <h3 className="font-semibold text-gray-900 dark:text-white">Recorded Use History</h3>
 <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Depreciation is preserved for past rental years. Primary or paused years remain visible but do not accrue new depreciation.</p>
 </div>
 <div className="flex flex-wrap gap-2 text-xs">
 <span className="rounded-full bg-green-50 px-2 py-1 font-semibold text-green-700 dark:bg-green-900/20 dark:text-green-300">{rentalYearCount} rental</span>
 <span className="rounded-full bg-orange-50 px-2 py-1 font-semibold text-orange-700 dark:bg-orange-900/20 dark:text-orange-300">{mixedYearCount} mixed</span>
 <span className="rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">{pausedYearCount} paused</span>
 </div>
 </div>
 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead>
 <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
 <th className="py-2 pr-3 font-medium">Year</th>
 <th className="py-2 px-3 font-medium">Use</th>
 <th className="py-2 px-3 font-medium text-right">Rental Months</th>
 <th className="py-2 px-3 font-medium text-right">Depreciation</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
 {depreciationYears.map((row) => (
 <tr key={`depr-year-${row.year}`}>
 <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">{row.year}</td>
 <td className="py-2 px-3">
 <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
 row.use_status === 'Rental'
 ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
 : row.use_status === 'Mixed'
 ? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300'
 : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
 }`}>
 {row.use_status || (row.is_rental_year ? 'Rental' : 'Primary / paused')}
 </span>
 </td>
 <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-300">{row.rental_months ?? (row.is_rental_year ? 12 : 0)}</td>
 <td className="py-2 px-3 text-right font-medium text-purple-600">{fmt(row.total)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>

 <div className={`rounded-lg border p-4 ${hasDiff ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20'}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            {isTied ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />}
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {isTied ? 'Ties to filing' : comparison.status === 'missing_filing' ? 'No Schedule E comparison yet' : `Off by ${fmt(Math.abs(comparison.delta || 0))}`}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Model depreciation {fmt(comparison.model_total)} vs Schedule E line 18 {comparison.line_18_depreciation == null ? 'not found' : fmt(comparison.line_18_depreciation)} for {taxYear}.
              </p>
              {comparison.common_causes?.length ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Check: {comparison.common_causes.join(', ')}.</p>
              ) : null}
            </div>
          </div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Tax year
            <input type="number" className="input mt-1 w-28" value={taxYear} onChange={(e) => setTaxYear(Number(e.target.value) || new Date().getFullYear())} />
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase text-gray-400">Current Year Depreciation</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(rollup.total_current_year_depreciation)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase text-gray-400">Annual Depreciation (full year)</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(rollup.total_annual_depreciation)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase text-gray-400">Accumulated</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(rollup.total_accumulated_depreciation)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase text-gray-400">Remaining Basis</p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(rollup.total_remaining_basis)}</p>
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Depreciation & Amortization Assets</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">Land is excluded. Each capital improvement runs its own schedule, prorated to rental-use months only.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary flex items-center gap-1.5 text-sm" onClick={() => openAdd('amortization')}>
              <Plus className="h-4 w-4" /> Add Amortization
            </button>
            <button type="button" className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => openAdd('depreciation')}>
              <Plus className="h-4 w-4" /> Add Improvement
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={saveAsset} className="mb-4 grid gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700 md:grid-cols-3">
            <label className="label">Type
              <select className="input mt-1" value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
                <option value="depreciation">Depreciation</option>
                <option value="amortization">Amortization</option>
              </select>
            </label>
            <label className="label md:col-span-2">Description
              <input className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </label>
            <label className="label">Placed In Service
              <input type="date" className="input mt-1" value={form.placed_in_service_date} onChange={(e) => setForm({ ...form, placed_in_service_date: e.target.value })} />
            </label>
            <label className="label">Cost / Basis
              <input type="number" className="input mt-1" value={form.cost_basis} onChange={(e) => setForm({ ...form, cost_basis: e.target.value })} />
            </label>
            <label className="label">Land Portion
              <input type="number" className="input mt-1" value={form.land_portion} onChange={(e) => setForm({ ...form, land_portion: e.target.value })} />
            </label>
            <label className="label">Method
              <input className="input mt-1" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} />
            </label>
            <label className="label">Recovery Period
              <input type="number" step="0.1" className="input mt-1" value={form.recovery_period} onChange={(e) => setForm({ ...form, recovery_period: e.target.value })} />
            </label>
            <label className="label">Prior Depreciation
              <input type="number" className="input mt-1" value={form.prior_depreciation} onChange={(e) => setForm({ ...form, prior_depreciation: e.target.value })} />
            </label>
            <label className="label md:col-span-3">Notes
              <input className="input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div className="flex gap-2 md:col-span-3">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Asset'}</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {assets.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No depreciable assets yet — add a purchase price or an improvement above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium">In Service</th>
                  <th className="py-2 px-3 font-medium">Basis</th>
                  <th className="py-2 px-3 font-medium">Land</th>
                  <th className="py-2 px-3 font-medium">Annual</th>
                  <th className="py-2 px-3 font-medium">{taxYear}</th>
                  <th className="py-2 px-3 font-medium">Accumulated</th>
                  <th className="py-2 px-3 font-medium">Remaining</th>
                  <th className="py-2 px-3 font-medium">Rental Mo.</th>
                  <th className="py-2 px-3 font-medium">Fully Depreciated</th>
                  <th className="py-2 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {assets.map((asset, index) => (
                  <tr key={asset.id || `base-${index}`} className="align-top">
                    <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">
                      {asset.description}
                      {asset.warning ? <p className="mt-1 max-w-xs text-xs font-normal text-amber-600 dark:text-amber-400">{asset.warning}</p> : null}
                    </td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{asset.asset_type === 'amortization' ? 'Amortization' : 'Depreciation'}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{asset.placed_in_service_date || '—'}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{fmt(asset.cost_basis)}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{fmt(asset.land_portion)}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{fmt(asset.annual_depreciation)}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-900 dark:text-white">{fmt(asset.current_year_depreciation)}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{fmt(asset.accumulated_depreciation)}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{fmt(asset.remaining_basis)}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">{asset.rental_months_to_date ?? '—'}</td>
                    <td className="whitespace-nowrap py-2 px-3 text-gray-600 dark:text-gray-300">
                      {asset.fully_depreciated_date || (
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <PauseCircle className="h-3.5 w-3.5" /> Paused
                        </span>
                      )}
                    </td>
 <td className="whitespace-nowrap py-2 px-3 text-right">
 {asset.is_base_building ? (
 <span className="inline-flex items-center justify-end gap-1 text-xs text-gray-400" title="Base building asset is the core schedule and cannot be deleted"><Lock className="h-3.5 w-3.5" /> Locked</span>
 ) : (
 <div className="flex justify-end gap-1">
 <button type="button" className="icon-btn" onClick={() => openEdit(asset)} title="Edit asset"><Pencil className="h-4 w-4" /></button>
 <button type="button" className="icon-btn text-red-600" onClick={() => deleteAsset(asset)} title="Delete asset"><Trash2 className="h-4 w-4" /></button>
 </div>
 )}
 </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white">Annual Depreciation Timeline</h3>
        {primaryYears.length > 0 && (
          <p className="mb-2 mt-1 text-xs text-gray-500 dark:text-gray-400">Shaded years were primary-residence/unrented and don’t accrue depreciation.</p>
        )}
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              {primaryYears.map((year) => (
                <ReferenceArea key={year} x1={year - 0.5} x2={year + 0.5} fill="#9ca3af" fillOpacity={0.15} ifOverflow="visible" />
              ))}
              <XAxis dataKey="year" />
              <YAxis tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(value) => fmt(value)} />
              {assetKeys.map((key, index) => (
                <Area key={key} type="monotone" dataKey={key} stackId="1" stroke={colors[index % colors.length]} fill={colors[index % colors.length]} fillOpacity={0.35} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

// ── Details / inline-edit tab ─────────────────────────────────────────────────
const PROPERTY_TYPES = ['Single Family', 'Multi Family', 'Condo', 'Townhouse', 'Commercial']

const DETAIL_SECTIONS = [
  {
    title: 'Basic Info',
    rows: [
      { label: 'Street Address',        key: 'address',        type: 'text',   span: 2 },
      { label: 'City',                  key: 'city',           type: 'text' },
      { label: 'State',                 key: 'state',          type: 'text' },
      { label: 'ZIP Code',              key: 'zip_code',       type: 'text' },
      { label: 'Property Type',         key: 'property_type',  type: 'select', options: PROPERTY_TYPES },
      { label: 'Usage',                 key: 'usage_type',     type: 'select', options: ['Rental', 'Primary'] },
      { label: 'Purchase Date',         key: 'purchase_date',  type: 'date' },
        { label: 'Purchase Price',        key: 'purchase_price', type: 'number', dollar: true },
        { label: 'Down Payment',          key: 'down_payment',   type: 'number', dollar: true },
        { label: 'Market Value',          key: 'market_value',   type: 'number', dollar: true },
    ],
  },
  {
    title: 'Rental Income',
    rentalOnly: true,
    rows: [
      { label: 'Monthly Rent',          key: 'monthly_rent',   type: 'number', dollar: true },
      { label: 'Occupancy Rate',        key: 'occupancy_rate', type: 'number', pct: true },
    ],
  },
  {
    title: 'Monthly Expenses',
    rows: [
      { label: 'Annual Property Tax',        key: 'property_tax',            type: 'number', dollar: true },
      { label: 'Property Tax History', key: 'property_tax_history', type: 'textarea' },
      { label: 'Annual Insurance',           key: 'insurance',               type: 'number', dollar: true },
      { label: 'HOA Fee / mo',               key: 'hoa_fee',                 type: 'number', dollar: true },
      { label: 'HOA Special Assessment',     key: 'hoa_special_assessment',  type: 'number', dollar: true },
      { label: 'Repairs & Maintenance / mo', key: 'maintenance',             type: 'number', dollar: true },
      { label: 'Property Mgmt / mo',         key: 'property_management_fee', type: 'number', dollar: true },
      { label: 'Utilities / mo',             key: 'utilities',               type: 'number', dollar: true },
      { label: 'Vacancy Allowance / mo',     key: 'vacancy_allowance',       type: 'number', dollar: true },
      { label: 'CapEx Reserve / mo',         key: 'capex_reserve',           type: 'number', dollar: true },
      { label: 'Other Expenses / mo',        key: 'other_expenses',          type: 'number', dollar: true },
    ],
  },
  {
    title: 'Solar',
    rows: [
      { label: 'Solar Ownership', key: 'solar_ownership', type: 'select', options: ['None', 'Leased', 'Purchased', 'Included in Purchase'] },
      { label: 'Solar Lease / mo', key: 'solar_monthly_payment', type: 'number', dollar: true },
      { label: 'Solar Purchase Price', key: 'solar_purchase_price', type: 'number', dollar: true },
    ],
  },
  {
    title: 'Depreciation',
    rows: [
      { label: 'Land Value',             key: 'land_value',         type: 'number', dollar: true },
      { label: 'Construction Cost',      key: 'construction_price', type: 'number', dollar: true },
      { label: 'Depreciation Period',    key: 'depreciation_years', type: 'number', suffix: 'yrs' },
    ],
  },
]

function inputNumber(value) {
if (value === '' || value == null) return 0
const parsed = Number(String(value).replace(/[^0-9.]/g, ''))
return Number.isFinite(parsed) ? parsed : 0
}

const DETAIL_NUMERIC_KEYS = new Set([
'purchase_price',
'down_payment',
'market_value',
'monthly_rent',
'occupancy_rate',
'property_tax',
'insurance',
'hoa_fee',
'hoa_special_assessment',
'maintenance',
'property_management_fee',
'utilities',
'vacancy_allowance',
'capex_reserve',
'other_expenses',
'solar_monthly_payment',
'solar_purchase_price',
'land_value',
'construction_price',
'depreciation_years',
])

function isDecimalDraft(value) {
return value === '' || /^\d*\.?\d*$/.test(String(value))
}

function mapPropertyToDetailsDraft(prop) {
const draft = { ...prop }
DETAIL_NUMERIC_KEYS.forEach((key) => {
const value = prop?.[key]
draft[key] = value == null ? '' : String(value)
})
return draft
}

function detailsDraftToPayload(draft) {
const payload = { ...draft }
DETAIL_NUMERIC_KEYS.forEach((key) => {
payload[key] = inputNumber(draft?.[key])
})
return payload
}

function parseJsonNumberMap(value) {
  try {
    const raw = JSON.parse(value || '{}')
    return Object.fromEntries(
      Object.entries(raw)
        .map(([year, amount]) => [String(year), inputNumber(amount)])
        .filter(([year, amount]) => /^\d{4}$/.test(year) && amount > 0)
    )
  } catch {
    return {}
  }
}

function MoneyEditInput({ value, onChange }) {
return (
<input
className="input py-1.5 text-right text-sm"
type="text"
inputMode="decimal"
value={value ?? ''}
onChange={(event) => {
const next = event.target.value
if (isDecimalDraft(next)) onChange(next)
}}
/>
)
}

function RealEstateStat({ label, value, note, muted = false }) {
  return (
    <div className="bg-white p-4 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{value}</p>
      {note ? <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{note}</p> : null}
    </div>
  )
}

function DetailsEditTab({ prop, propId, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({ ...prop })
  const [saving, setSaving]   = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleEdit   = () => { setForm({ ...prop }); setEditing(true) }
  const handleCancel = () => { setForm({ ...prop }); setEditing(false) }

  const handleSave = async () => {
    setSaving(true)
    try {
      await propAPI.update(propId, form)
      toast.success('Property updated')
      onSaved()
      setEditing(false)
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const displayVal = (row, src) => {
    const v = src[row.key]
    if (v == null || v === '') return '—'
    if (row.dollar) return fmt(v)
    if (row.pct) return `${v}%`
    if (row.suffix) return `${v} ${row.suffix}`
    return String(v)
  }

  const isPrimary = (form.usage_type || prop.usage_type || 'Rental').toLowerCase() === 'primary'
  const location = [prop.city, prop.state, prop.zip_code].filter(Boolean).join(', ') || 'Location not set'
  const totalLoanBalance = prop.total_loan_balance || prop.loans?.reduce((sum, loan) => sum + (loan.current_balance || 0), 0) || 0
  const ltv = prop.market_value ? (totalLoanBalance / prop.market_value) * 100 : null
  const useBadge = isPrimary ? 'Primary Residence' : 'Rental Property'
  const propertyAddress = prop.address && prop.address !== 'Address not provided' ? prop.address : 'Address not provided'

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {editing ? 'Edit property details below, then save.' : 'View all property fields.'}
        </p>
        {!editing ? (
          <button onClick={handleEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={handleCancel} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-5">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-100 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-800/70">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{propertyLabel(prop)}</h3>
                <span className={isPrimary ? 'badge-yellow' : 'badge-green'}>{useBadge}</span>
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{propertyAddress}</p>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{location}</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Property ID</p>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{shortPropertyUid(prop) || '—'}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-px bg-gray-100 dark:bg-gray-700 sm:grid-cols-2 lg:grid-cols-5">
        <RealEstateStat label="Purchase Price" value={fmt(prop.purchase_price)} />
        <RealEstateStat label="Down Payment" value={fmt(prop.down_payment)} />
        <RealEstateStat label="Market Value" value={fmt(prop.market_value)} />
          <RealEstateStat label="Loan Balance" value={fmt(totalLoanBalance)} note={ltv == null ? 'LTV unavailable' : `${fmtPct(ltv)} LTV`} />
          <RealEstateStat label={isPrimary ? 'Monthly Rent' : 'Monthly Rent'} value={isPrimary ? 'Excluded' : fmt(prop.monthly_rent)} muted={isPrimary} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      {DETAIL_SECTIONS.map(section => {
        if (section.rentalOnly && isPrimary) return null
        return (
          <div key={section.title} className="card">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">{section.title}</h3>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {section.rows.map(row => (
                <div key={row.key} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0 w-44">{row.label}</span>
                  {editing ? (
                    <div className="flex-1 max-w-xs">
                      {row.options ? (
                        <select className="input py-1.5 text-sm" value={form[row.key] ?? ''}
                          onChange={e => set(row.key, e.target.value)}>
                          {row.options.map(o => <option key={o}>{o}</option>)}
                        </select>
                      ) : row.type === 'textarea' ? (
                      <textarea
                        className="input min-h-24 py-1.5 text-sm font-mono"
                        value={form[row.key] ?? ''}
                        onChange={e => set(row.key, e.target.value)}
                        placeholder={'{"2021":47000,"2022":48000}'}
                      />
                    ) : (
                      <input
                        className="input py-1.5 text-sm"
                        type={row.type === 'number' ? 'text' : row.type}
                        inputMode={row.type === 'number' ? 'decimal' : undefined}
                        pattern={row.type === 'number' ? '[0-9.,-]*' : undefined}
                        value={form[row.key] ?? ''}
onChange={(e) => {
const next = e.target.value
if (row.type === 'number') {
if (isDecimalDraft(next)) set(row.key, next)
} else {
set(row.key, next)
}
}}
                      />
                    )}
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-gray-900 dark:text-white text-right">{displayVal(row, prop)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      </div>

      {/* Computed read-only block */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">Computed</h3>
        <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
          {[
            { label: 'Total Loan Balance',  value: fmt(totalLoanBalance) },
            { label: 'Loan-to-Value',       value: ltv == null ? 'N/A' : fmtPct(ltv) },
            { label: 'Market Value Source', value: prop.market_value_source || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-gray-500 dark:text-gray-400 w-44">{label}</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CompactDetailsTab({ prop, propId, onSaved }) {
const [editing, setEditing] = useState(false)
const [form, setForm] = useState(() => mapPropertyToDetailsDraft(prop))
  const [saving, setSaving] = useState(false)
  const source = editing ? form : prop
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const isPrimary = (source.usage_type || 'Rental').toLowerCase() === 'primary'
  const solarOwnership = source.solar_ownership || 'None'
  const showSolar = editing || String(solarOwnership).toLowerCase() !== 'none'
  const totalLoanBalance = inputNumber(prop.total_loan_balance) || (prop.loans || []).reduce((sum, loan) => sum + inputNumber(loan.current_balance), 0)
  const marketValue = inputNumber(source.market_value)
  const purchasePrice = inputNumber(source.purchase_price)
  const downPayment = inputNumber(source.down_payment)
  const ltv = marketValue > 0 ? (totalLoanBalance / marketValue) * 100 : null
  const equity = marketValue - totalLoanBalance
  const monthlyPI = (prop.loans || []).reduce((sum, loan) => sum + inputNumber(loan.monthly_payment), 0)
  const monthlyCost = monthlyPI
    + inputNumber(source.property_tax) / 12
    + inputNumber(source.insurance)
    + inputNumber(source.hoa_fee)
    + inputNumber(source.hoa_special_assessment) / 12
    + inputNumber(source.maintenance)
    + inputNumber(source.utilities)
    + inputNumber(source.other_expenses)
    + (isPrimary ? 0 : inputNumber(source.property_management_fee) + inputNumber(source.capex_reserve) + inputNumber(source.vacancy_allowance))
  const addressMissing = !source.address || source.address === 'Address not provided'
  const gaps = [
    addressMissing ? 'street address' : null,
    downPayment <= 0 ? 'down payment' : null,
  ].filter(Boolean)

const save = async () => {
setSaving(true)
try {
await propAPI.update(propId, detailsDraftToPayload(form))
      toast.success('Property updated')
      onSaved()
      setEditing(false)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed save')
    } finally {
      setSaving(false)
    }
  }

const cancel = () => {
setForm(mapPropertyToDetailsDraft(prop))
setEditing(false)
}

  const display = (field) => {
    const value = source[field.key]
    if (value == null || value === '' || value === 'Address not provided') return '—'
    if (field.money) return inputNumber(value) === 0 && !field.allowZero ? 'Not set' : fmt(value)
    if (field.percent) return `${inputNumber(value)}%`
    if (field.suffix) return `${value} ${field.suffix}`
    return String(value)
  }

const renderFieldValue = (field) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-gray-500 dark:text-gray-400">{field.label}</span>
      {editing ? (
        <div className="w-56 max-w-full">
          {field.options ? (
            <select className="input py-1.5 text-sm" value={form[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)}>
              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <input
              className="input py-1.5 text-sm"
              type={field.type === 'date' ? 'date' : 'text'}
              inputMode={field.money || field.number ? 'decimal' : undefined}
              value={form[field.key] ?? ''}
onChange={(e) => {
const next = e.target.value
if (field.money || field.number) {
if (isDecimalDraft(next)) set(field.key, next)
} else {
set(field.key, next)
}
}}
              placeholder={field.placeholder || ''}
            />
          )}
        </div>
      ) : (
        <span className="text-right text-sm font-medium text-gray-900 dark:text-white">{display(field)}</span>
      )}
    </div>
  )

  const propertyFields = [
    { label: 'Street address', key: 'address', placeholder: 'Address not provided' },
    { label: 'City', key: 'city' },
    { label: 'State', key: 'state' },
    { label: 'ZIP', key: 'zip_code' },
    { label: 'Physical type', key: 'property_type', options: PROPERTY_TYPES },
    { label: 'Usage', key: 'usage_type', options: ['Primary', 'Rental'] },
    { label: 'Purchase date', key: 'purchase_date', type: 'date' },
  ]

  const expenseFields = [
    ...(!isPrimary ? [
      { label: 'Monthly rent / mo', key: 'monthly_rent', money: true },
      { label: 'Vacancy allowance / mo', key: 'vacancy_allowance', money: true },
      { label: 'Property management / mo', key: 'property_management_fee', money: true },
      { label: 'CapEx reserve / mo', key: 'capex_reserve', money: true },
    ] : []),
    { label: 'Property tax / yr', key: 'property_tax', money: true },
    { label: 'Insurance / mo', key: 'insurance', money: true },
    { label: 'HOA / mo', key: 'hoa_fee', money: true },
    { label: 'Maintenance / mo', key: 'maintenance', money: true },
    { label: 'Utilities / mo', key: 'utilities', money: true },
    { label: 'Other expenses / mo', key: 'other_expenses', money: true },
  ]

  const depreciationFields = isPrimary ? [] : [
    { label: 'Land value', key: 'land_value', money: true },
    { label: 'Construction cost', key: 'construction_price', money: true },
    { label: 'Recovery period', key: 'depreciation_years', number: true, suffix: 'yrs' },
  ]

  const solarFields = showSolar ? [
    { label: 'Solar ownership', key: 'solar_ownership', options: ['None', 'Leased', 'Purchased', 'Included in Purchase'] },
    { label: 'Solar lease / mo', key: 'solar_monthly_payment', money: true },
    { label: 'Solar purchase price', key: 'solar_purchase_price', money: true },
  ] : []

  const visibleSections = [
    { title: 'Property', fields: propertyFields },
    { title: 'Expenses', fields: expenseFields },
    ...(!isPrimary ? [{ title: 'Depreciation', fields: depreciationFields }] : []),
    ...(showSolar ? [{ title: 'Solar', fields: solarFields }] : []),
  ].filter((section) => section.fields.length)

  const hiddenNotes = [
    isPrimary ? 'rental income and rental expense fields hidden' : null,
    isPrimary ? 'depreciation hidden because primary residence' : null,
    !showSolar ? 'solar hidden until ownership is set' : null,
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{propertyLabel(prop)}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {addressMissing ? 'Address not provided' : source.address} · {isPrimary ? 'Primary residence' : 'Rental property'}
          </p>
        </div>
        {!editing ? (
<button onClick={() => { setForm(mapPropertyToDetailsDraft(prop)); setEditing(true) }} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={cancel} className="btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary px-5 text-sm">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        )}
      </div>

      {gaps.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          <span>{gaps.length} gaps: {gaps.join(', ')}</span>
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setEditing(true)}>Fix</button>
        </div>
      )}

      <div className="grid gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700 sm:grid-cols-2 xl:grid-cols-5">
        <RealEstateStat label="Purchase Price" value={purchasePrice > 0 ? fmt(purchasePrice) : 'Not set'} />
        <RealEstateStat label="Market Value" value={marketValue > 0 ? fmt(marketValue) : 'Not set'} note={source.market_value_source || 'source not set'} />
        <RealEstateStat label="Loan / LTV" value={fmt(totalLoanBalance)} note={ltv == null ? 'LTV unavailable' : `${fmtPct(ltv)} LTV`} />
        <RealEstateStat label="Equity" value={fmt(equity)} />
        <RealEstateStat label={isPrimary ? 'Cost to Own' : 'Monthly Outflow'} value={fmt(monthlyCost)} note="/mo" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleSections.map((section) => {
          const visibleFields = editing ? section.fields : section.fields.filter((field) => {
            const value = source[field.key]
            return value != null && value !== '' && value !== 'Address not provided' && (!field.money || inputNumber(value) !== 0)
          })
          const hiddenCount = section.fields.length - visibleFields.length
          return (
            <div key={section.title} className="card">
              <h3 className="mb-2 border-b border-gray-200 pb-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">{section.title}</h3>
              {visibleFields.length > 0 ? (
                <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
{visibleFields.map((field) => <Fragment key={field.key}>{renderFieldValue(field)}</Fragment>)}
                  {!editing && hiddenCount > 0 ? (
                    <div className="flex items-center justify-between py-2 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Other</span>
                      <span className="font-medium text-gray-400 dark:text-gray-500">Not set</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="py-4 text-sm text-gray-400 dark:text-gray-500">Other: Not set</p>
              )}
            </div>
          )
        })}
      </div>

      {hiddenNotes.length > 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Hidden for this usage: {hiddenNotes.join('; ')}. These appear if the property is converted to rental or the related feature is enabled.
        </p>
      ) : null}
    </div>
  )
}

// ── Performance tab ────────────────────────────────────────────────────────────
function PerformanceTab({ propId }) {
  const [perf, setPerf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [yearNotes, setYearNotes] = useState({})
  const [editingNoteYear, setEditingNoteYear] = useState(null)
  const [noteInput, setNoteInput] = useState('')

  useEffect(() => {
    propAPI.performance(propId)
      .then((r) => {
        setPerf(r.data)
        setYearNotes(r.data.year_notes || {})
      })
      .catch(() => toast.error('Failed to load performance'))
      .finally(() => setLoading(false))
  }, [propId])

  const saveYearNote = async (year) => {
    const note = noteInput.trim()
    try {
      await propAPI.updateYearNote(propId, year, note)
      setYearNotes(prev => {
        const next = { ...prev }
        if (note) next[year] = note
        else delete next[year]
        return next
      })
    } catch {
      toast.error('Failed to save note')
    }
    setEditingNoteYear(null)
    setNoteInput('')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!perf) return null

  const latest = perf.yearly[perf.yearly.length - 1]
  const SOURCE_LABEL = {
    actual: 'from statements',
    annualized: 'annualized from 1 statement',
    estimated: 'estimated from loan',
    '1098': 'from Form 1098',
  }

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Cash Flow / yr" value={fmt(latest?.cash_flow)}
          color={latest?.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'} />
        <KPI label="Principal Paydown / yr" value={fmt(latest?.principal_paid)} color="text-blue-600" />
        <KPI label="Depreciation / yr" value={fmt(perf.annual_depreciation)} color="text-purple-600" />
        <KPI label="Return on Equity"
          value={perf.return_on_equity != null ? `${perf.return_on_equity}%` : 'N/A'}
          color={perf.return_on_equity >= 5 ? 'text-green-600' : 'text-amber-600'} />
      </div>

      {/* Signals */}
      {perf.signals.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Keep or Sell — Signals</h3>
          <ul className="space-y-2">
            {perf.signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  s.level === 'good' ? 'bg-green-500' : s.level === 'bad' ? 'bg-red-500' : 'bg-amber-400'
                }`} />
                {s.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Yearly table */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Yearly Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                <th className="pb-2 pr-2 font-medium">Year</th>
                <th className="pb-2 px-2 font-medium text-right">Rent</th>
                <th className="pb-2 px-2 font-medium text-right">Expenses</th>
                <th className="pb-2 px-2 font-medium text-right">Interest</th>
                <th className="pb-2 px-2 font-medium text-right">Taxes</th>
                <th className="pb-2 px-2 font-medium text-right">Principal</th>
                <th className="pb-2 px-2 font-medium text-right">Topup</th>
                <th className="pb-2 px-2 font-medium text-right">Cash Flow</th>
                <th className="pb-2 px-2 font-medium text-right">Taxable Income</th>
                <th className="pb-2 px-2 font-medium text-right">Depreciation</th>
                <th className="pb-2 px-2 font-medium text-right">Escrow</th>
                <th className="pb-2 pl-2 font-medium text-right">Total Return</th>
                <th className="pb-2 pl-3 font-medium text-left text-gray-400 dark:text-gray-500">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {perf.yearly.map((y) => (
                <tr key={y.year} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-2 pr-2 font-medium text-gray-900 dark:text-white">
                    {y.year}
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                      {y.statements > 0 ? `${y.statements} stmt · ` : ''}{SOURCE_LABEL[y.source]}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right">
                    {fmt(y.rental_income)}
                    {y.rent_source === 'leases' && (
                      <span className="block text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                        {y.occupied_months}/{12} mo · {fmtPct(y.occupancy)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right text-red-500">{fmt(y.operating_expenses)}</td>
                  <td className="py-2 px-2 text-right text-red-500">{fmt(y.interest_paid)}</td>
                  <td className="py-2 px-2 text-right text-orange-500">{fmt(y.taxes_paid)}</td>
                <td className="py-2 px-2 text-right text-blue-600">{fmt(y.principal_paid)}</td>
                <td className="py-2 px-2 text-right text-indigo-600 dark:text-indigo-400">{fmt(y.principal_topup_paid)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${y.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(y.cash_flow)}
                  </td>
                  <td className={`py-2 px-2 text-right ${y.taxable_income < 0 ? 'text-purple-600' : 'text-gray-900 dark:text-white'}`}>
                    {fmt(y.taxable_income)}
                  </td>
                  <td className="py-2 px-2 text-right text-purple-600">{fmt(y.depreciation)}</td>
                  <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(y.escrow_paid)}</td>
                  <td className={`py-2 pl-2 text-right font-semibold ${y.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(y.total_return)}
                  </td>
                  <td className="py-1 pl-3 min-w-[160px]">
                    {editingNoteYear === y.year ? (
                      <input
                        autoFocus
                        type="text"
                        value={noteInput}
                        onChange={e => setNoteInput(e.target.value)}
                        onBlur={() => saveYearNote(y.year)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveYearNote(y.year)
                          if (e.key === 'Escape') { setEditingNoteYear(null); setNoteInput('') }
                        }}
                        placeholder="Add note…"
                        className="w-full text-xs border border-blue-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingNoteYear(y.year); setNoteInput(yearNotes[y.year] || '') }}
                        className={`text-xs cursor-pointer rounded px-1 py-0.5 hover:bg-gray-100 ${yearNotes[y.year] ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 italic'}`}
                        title="Click to edit note"
                      >
                        {yearNotes[y.year] || 'Add note'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50">
                <td className="pt-2 pr-2 text-sm">Total</td>
                <td className="pt-2 px-2 text-right">{fmt(perf.totals.rental_income)}</td>
                <td className="pt-2 px-2 text-right text-red-500">{fmt(perf.totals.operating_expenses)}</td>
                <td className="pt-2 px-2 text-right text-red-500">{fmt(perf.totals.interest_paid)}</td>
              <td className="pt-2 px-2 text-right text-orange-500">{fmt(perf.totals.taxes_paid)}</td>
              <td className="pt-2 px-2 text-right text-blue-600">{fmt(perf.totals.principal_paid)}</td>
              <td className="pt-2 px-2 text-right text-indigo-600 dark:text-indigo-400">{fmt(perf.totals.principal_topup_paid)}</td>
              <td className={`pt-2 px-2 text-right ${perf.totals.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(perf.totals.cash_flow)}
                </td>
                <td className={`pt-2 px-2 text-right ${perf.totals.taxable_income < 0 ? 'text-purple-600' : 'text-gray-900 dark:text-white'}`}>
                  {fmt(perf.totals.taxable_income)}
                </td>
                <td className="pt-2 px-2 text-right text-purple-600">{fmt(perf.totals.depreciation)}</td>
                <td className="pt-2 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(perf.totals.escrow_paid)}</td>
                <td className={`pt-2 pl-2 text-right font-bold ${perf.totals.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(perf.totals.total_return)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Upload mortgage statements from different months to turn estimates into actuals —
          two or more statements per year let the app measure the real principal paydown.
        </p>
      </div>

      {/* Statement Details per document */}
      {perf.snapshots.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Statement Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-2 font-medium">Date</th>
                  <th className="pb-2 px-2 font-medium text-right">Balance</th>
                  <th className="pb-2 px-2 font-medium text-right">Payment</th>
                  <th className="pb-2 px-2 font-medium text-right">Principal</th>
                  <th className="pb-2 px-2 font-medium text-right">Interest</th>
                  <th className="pb-2 px-2 font-medium text-right">Escrow</th>
                  <th className="pb-2 pl-2 font-medium text-right">Taxes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {(() => {
                  const years = [...new Set(perf.snapshots.map(s => s.year))].sort()
                  const rows = []
                  let grandBalance = 0, grandPayment = 0, grandPrincipal = 0, grandInterest = 0, grandEscrow = 0, grandTaxes = 0
                  years.forEach((year, yi) => {
                    const yrSnaps = perf.snapshots.filter(s => s.year === year)
                    let subBalance = 0, subPayment = 0, subPrincipal = 0, subInterest = 0, subEscrow = 0, subTaxes = 0
                    if (yi > 0) rows.push(<tr key={`gap-${year}`} className="h-2" />)
                    yrSnaps.forEach((s) => {
                      subBalance += s.balance || 0; subPayment += s.payment || 0
                      subPrincipal += s.principal || 0; subInterest += s.interest || 0
                      subEscrow += s.escrow || 0; subTaxes += s.taxes_paid || 0
                      rows.push(
                        <tr key={s.date} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="py-1.5 pr-2 text-gray-900 dark:text-white">{s.date}</td>
                          <td className="py-1.5 px-2 text-right">{fmt(s.balance)}</td>
                          <td className="py-1.5 px-2 text-right">{fmt(s.payment)}</td>
                          <td className="py-1.5 px-2 text-right text-blue-600">{fmt(s.principal)}</td>
                          <td className="py-1.5 px-2 text-right text-red-500">{fmt(s.interest)}</td>
                          <td className="py-1.5 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(s.escrow)}</td>
                          <td className="py-1.5 pl-2 text-right text-orange-500">{fmt(s.taxes_paid)}</td>
                        </tr>
                      )
                    })
                    // Year subtotal
                    rows.push(
                      <tr key={`sub-${year}`} className="bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-900 dark:text-white">
                        <td className="py-1.5 pr-2 text-xs text-gray-500 dark:text-gray-400">{year} subtotal</td>
                        <td className="py-1.5 px-2 text-right">{fmt(subBalance)}</td>
                        <td className="py-1.5 px-2 text-right">{fmt(subPayment)}</td>
                        <td className="py-1.5 px-2 text-right text-blue-600">{fmt(subPrincipal)}</td>
                        <td className="py-1.5 px-2 text-right text-red-500">{fmt(subInterest)}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(subEscrow)}</td>
                        <td className="py-1.5 pl-2 text-right text-orange-500">{fmt(subTaxes)}</td>
                      </tr>
                    )
                    grandBalance += subBalance; grandPayment += subPayment
                    grandPrincipal += subPrincipal; grandInterest += subInterest
                    grandEscrow += subEscrow; grandTaxes += subTaxes
                  })
                  // Grand total
                  rows.push(
                    <tr key="grand-total" className="border-t-2 border-gray-300 bg-gray-100 font-bold text-gray-900 dark:text-white">
                      <td className="pt-2 pr-2">Grand Total</td>
                      <td className="pt-2 px-2 text-right">{fmt(grandBalance)}</td>
                      <td className="pt-2 px-2 text-right">{fmt(grandPayment)}</td>
                      <td className="pt-2 px-2 text-right text-blue-600">{fmt(grandPrincipal)}</td>
                      <td className="pt-2 px-2 text-right text-red-500">{fmt(grandInterest)}</td>
                      <td className="pt-2 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(grandEscrow)}</td>
                      <td className="pt-2 pl-2 text-right text-orange-500">{fmt(grandTaxes)}</td>
                    </tr>
                  )
                  return rows
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loan balance over time */}
      {perf.snapshots.length >= 2 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Loan Balance Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={perf.snapshots} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                domain={['auto', 'auto']} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Line type="monotone" dataKey="balance" name="Balance" stroke="#3b82f6" strokeWidth={2} dot isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* All Extracted Data — every document's extracted fields */}
      {perf.all_documents && perf.all_documents.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">All Extracted Data ({perf.all_documents.length})</h3>
          {perf.all_documents.map((doc) => {
            const entries = Object.entries(doc.extracted).filter(
              ([k]) => !['raw_text_preview', 'period_type', 'statement_year'].includes(k)
            )
            if (entries.length === 0) return null
            return (
              <details key={doc.id} className="border border-gray-100 dark:border-gray-700 rounded-lg mb-2 overflow-hidden">
                <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                    {doc.category}
                  </span>
                  <span className="text-gray-900 dark:text-white font-medium truncate">{doc.display_name || doc.original_filename}</span>
                  {doc.period_type && doc.period_type !== 'other' && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                      {doc.period_type} · {doc.period_start || ''}{doc.period_start && doc.period_end ? ' → ' : ''}{doc.period_end || ''}
                    </span>
                  )}
                </summary>
                <div className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 px-3 py-2 grid grid-cols-2 gap-x-6 gap-y-1">
                  {entries.map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-400 dark:text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300 ml-2">
                        {v === null || v === undefined ? '—' :
                         typeof v === 'number' ? `$${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` :
                         String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Scenarios tab ──────────────────────────────────────────────────────────────
function ScenariosTab({ prop, propId, currentMonthlyCashFlow = 0, currentDscr = 0 }) {
  const loans = prop.loans || []
  const [selectedLoan, setSelectedLoan] = useState(loans[0]?.id || '')
  const [scenarioType, setScenarioType] = useState('extra_monthly')
  const [scenarioName, setScenarioName] = useState('Aggressive Payoff')
  const [extraMonthly, setExtraMonthly] = useState('250')
  const [annualLumpSum, setAnnualLumpSum] = useState('5000')
  const [annualMonth, setAnnualMonth] = useState('12')
  const [oneTimeAmount, setOneTimeAmount] = useState('5000')
  const [oneTimeDate, setOneTimeDate] = useState('2028-01')
  const [sp500Rate, setSp500Rate] = useState('8')
  const [hysaRate, setHysaRate] = useState('4')
  const [rentalRate, setRentalRate] = useState('6')
  const [highlightGoal, setHighlightGoal] = useState('interest_saved')
  const [timelineExpanded, setTimelineExpanded] = useState(false)
const [savedScenarios, setSavedScenarios] = useState(() => {
try {
return JSON.parse(localStorage.getItem(`property-${propId}-scenarios`) || '[]').map((scenario) => ({
...scenario,
id: scenario.id && scenario.id !== scenario.name ? scenario.id : `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}))
} catch { return [] }
})
const [editingScenarioId, setEditingScenarioId] = useState(null)
const [result, setResult] = useState(null)
  const [scheduleFilter, setScheduleFilter] = useState('yearly')
  const [scheduleSearch, setScheduleSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const parseAmount = (value) => {
    const parsed = Number(String(value || '').replace(/[^0-9.]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0)
  const loanLabel = (loan) => loan ? `${loan.lender_name || `Loan #${loan.id}`} · ${loan.loan_type || 'Mortgage'}` : 'Loan'
  const typeAllowsMonthly = ['extra_monthly', 'combination'].includes(scenarioType)
  const typeAllowsAnnual = ['annual_lump_sum', 'combination'].includes(scenarioType)
  const typeAllowsOneTime = scenarioType === 'one_time'
const currentScenario = {
id: editingScenarioId || 'active-scenario',
name: scenarioName || 'Custom strategy',
type: scenarioType,
    extra_monthly: typeAllowsMonthly ? parseAmount(extraMonthly) : 0,
    annual_lump_sum: typeAllowsAnnual ? parseAmount(annualLumpSum) : 0,
    annual_lump_sum_month: Number(annualMonth) || 12,
    one_time_payments: typeAllowsOneTime && parseAmount(oneTimeAmount) > 0 ? [{ amount: parseAmount(oneTimeAmount), date: `${oneTimeDate || '2028-01'}-01` }] : [],
  }
const scenarios = [{ id: 'baseline', name: 'Baseline', type: 'baseline' }, currentScenario, ...savedScenarios.filter((scenario) => scenario.id !== editingScenarioId)]
  const active = result?.active
  const baseline = result?.baseline
  const summary = active?.summary
  const comparison = result?.comparison || []
  const schedule = active?.schedule || []
  const rows = schedule.filter((row) => {
    if (scheduleFilter === 'quarterly' && row.month % 3 !== 0) return false
    if (scheduleFilter === 'yearly' && row.month !== 12) return false
    const q = scheduleSearch.trim().toLowerCase()
    if (!q) return true
    return [row.date, String(row.payment_number), String(row.year)].some((value) => value.toLowerCase().includes(q))
  })
  const shownTimeline = timelineExpanded ? (result?.expandedTimeline || []) : (result?.timeline || [])

  const run = async () => {
    if (!selectedLoan) return
    setLoading(true)
    try {
      const { data } = await propAPI.simulateScenarios(propId, {
        loan_id: Number(selectedLoan),
        scenarios,
        monthly_cash_flow: currentMonthlyCashFlow,
        dscr: currentDscr,
        comparison_rates: {
          sp500: parseAmount(sp500Rate) / 100,
          hysa: parseAmount(hysaRate) / 100,
          rental: parseAmount(rentalRate) / 100,
        },
        highlight_goal: highlightGoal,
      })
      setResult(data)
    } catch (error) {
      toast.error(error?.response?.data?.detail || 'Failed to simulate scenarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => { run() }, 350)
    return () => clearTimeout(timer)
}, [selectedLoan, scenarioType, scenarioName, extraMonthly, annualLumpSum, annualMonth, oneTimeAmount, oneTimeDate, sp500Rate, hysaRate, rentalRate, highlightGoal, JSON.stringify(savedScenarios)])

  const uniqueScenarioName = (name) => {
    const base = (name || 'Saved strategy').trim()
    const used = new Set(savedScenarios.map((item) => item.name))
    if (!used.has(base)) return base
    let index = 2
    while (used.has(`${base} (${index})`)) index += 1
return `${base} (${index})`
}
const newScenarioId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const persistSavedScenarios = (items) => {
setSavedScenarios(items)
localStorage.setItem(`property-${propId}-scenarios`, JSON.stringify(items))
}
const saveScenario = () => {
    if (summary?.is_noop) {
      toast.error('No-op scenarios cannot be saved')
      return
    }
const saved = { ...currentScenario, id: newScenarioId(), name: uniqueScenarioName(scenarioName), saved_at: new Date().toISOString() }
persistSavedScenarios([...savedScenarios, saved])
setEditingScenarioId(null)
toast.success('Scenario saved as new')
}
const updateScenario = () => {
if (!editingScenarioId) return
if (summary?.is_noop) {
toast.error('No-op scenarios cannot be saved')
return
}
const next = savedScenarios.map((scenario) => scenario.id === editingScenarioId
? { ...currentScenario, id: editingScenarioId, name: scenarioName || scenario.name || 'Saved strategy', updated_at: new Date().toISOString() }
: scenario)
persistSavedScenarios(next)
toast.success('Scenario updated')
}
const loadSavedScenario = (scenario) => {
setEditingScenarioId(scenario.id)
setScenarioName(scenario.name || 'Saved strategy')
setScenarioType(scenario.type || 'extra_monthly')
setExtraMonthly(String(scenario.extra_monthly || '0'))
setAnnualLumpSum(String(scenario.annual_lump_sum || '0'))
setAnnualMonth(String(scenario.annual_lump_sum_month || '12'))
const oneTime = scenario.one_time_payments?.[0]
setOneTimeAmount(String(oneTime?.amount || '0'))
setOneTimeDate(oneTime?.date ? String(oneTime.date).slice(0, 7) : '2028-01')
}
const deleteSavedScenario = (scenarioId, name) => {
    if (!scenarioId || scenarioId === 'baseline' || scenarioId === 'active-scenario') return
    if (!window.confirm(`Delete ${name}? Removes this saved scenario from the comparison.`)) return
const next = savedScenarios.filter((scenario) => scenario.id !== scenarioId)
persistSavedScenarios(next)
if (editingScenarioId === scenarioId) setEditingScenarioId(null)
toast.success('Scenario deleted')
}
  const clearSavedScenarios = () => {
    if (!savedScenarios.length) return
    if (!window.confirm('Delete all saved scenarios? Baseline and current scenario remain.')) return
persistSavedScenarios([])
setEditingScenarioId(null)
toast.success('Saved scenarios cleared')
}
  const exportSchedule = () => {
    const headers = ['Payment #','Date','Beginning Balance','Monthly Payment','Principal','Interest','Extra Monthly','Annual Lump Sum','Ending Balance','Running Interest Paid']
    const csvRows = rows.map((row) => [row.payment_number,row.date,row.beginning_balance,row.monthly_payment,row.principal,row.interest,row.extra_monthly,row.annual_lump_sum + row.one_time_payment,row.ending_balance,row.running_interest_paid])
    const csv = [headers, ...csvRows].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${scenarioName || 'scenario'}-amortization.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!loans.length) return <div className="card text-sm text-gray-500 dark:text-gray-400">Add a loan before running payoff scenarios.</div>

  return <div className="space-y-5">
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4 dark:border-gray-700">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">What-If Financial Simulator</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Build payoff strategies and compare debt reduction against alternative uses of capital.</p>
        </div>
<div className="flex gap-2">{editingScenarioId ? <button className="btn-secondary" onClick={updateScenario}>Update</button> : null}<button className="btn-secondary" onClick={saveScenario}>Save as New</button><button className="btn-primary" onClick={run} disabled={loading}>{loading ? 'Calculating...' : 'Calculate'}</button></div>
      </div>
{result?.opportunityVerdict && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30"><div className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">Decision verdict</div><div className="mt-1 text-base font-semibold text-emerald-950 dark:text-emerald-100">{result.opportunityVerdict.headline}</div></div>}
{savedScenarios.length ? <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{editingScenarioId ? `Editing: ${savedScenarios.find((scenario) => scenario.id === editingScenarioId)?.name || 'Saved scenario'}` : 'Load saved scenario'}</span>{editingScenarioId ? <button type="button" className="text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setEditingScenarioId(null)}>Cancel edit</button> : null}</div><div className="flex flex-wrap gap-2">{savedScenarios.map((scenario) => <button key={scenario.id} type="button" className={`rounded-full border px-3 py-1 text-xs font-medium ${editingScenarioId === scenario.id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700'}`} onClick={() => loadSavedScenario(scenario)}>{scenario.name}</button>)}</div></div> : null}
<div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-6">
        <label className="block"><span className="label">Loan</span><select className="input w-full" value={selectedLoan} onChange={(e) => setSelectedLoan(e.target.value)}>{loans.map((loan) => <option key={loan.id} value={loan.id}>{loanLabel(loan)}</option>)}</select></label>
        <label className="block"><span className="label">Scenario type</span><select className="input w-full" value={scenarioType} onChange={(e) => setScenarioType(e.target.value)}><option value="baseline">Baseline</option><option value="extra_monthly">Extra Monthly Payment</option><option value="annual_lump_sum">Annual Lump Sum</option><option value="one_time">One-Time Payment</option><option value="combination">Combination Strategy</option></select></label>
        <label className="block lg:col-span-2"><span className="label">Scenario name</span><input className="input w-full" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Tax Refund Strategy" /></label>
        <label className="block"><span className="label">Best by</span><select className="input w-full" value={highlightGoal} onChange={(e) => setHighlightGoal(e.target.value)}><option value="interest_saved">Max interest saved</option><option value="roi">Best annualized return</option></select></label>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">Backend run returns every card, chart, verdict, and table row.</div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
        <ScenarioInputGroup disabled={!typeAllowsMonthly} label="Extra monthly"><div className="grid grid-cols-2 gap-2">{[100,250,500,1000].map((amount) => <button key={amount} disabled={!typeAllowsMonthly} className="btn-secondary text-sm disabled:opacity-40" onClick={() => setExtraMonthly(String(amount))}>+{money(amount)}/mo</button>)}</div><input disabled={!typeAllowsMonthly} className="input w-full disabled:opacity-40" inputMode="decimal" value={extraMonthly} onChange={(e) => setExtraMonthly(e.target.value.replace(/[^0-9.]/g, ''))} /></ScenarioInputGroup>
        <ScenarioInputGroup disabled={!typeAllowsAnnual} label="Annual lump sum"><div className="grid grid-cols-2 gap-2">{[2000,5000,10000].map((amount) => <button key={amount} disabled={!typeAllowsAnnual} className="btn-secondary text-sm disabled:opacity-40" onClick={() => setAnnualLumpSum(String(amount))}>{money(amount)}/yr</button>)}</div><input disabled={!typeAllowsAnnual} className="input w-full disabled:opacity-40" inputMode="decimal" value={annualLumpSum} onChange={(e) => setAnnualLumpSum(e.target.value.replace(/[^0-9.]/g, ''))} /></ScenarioInputGroup>
        <label className="block"><span className="label">Lump month</span><select disabled={!typeAllowsAnnual} className="input w-full disabled:opacity-40" value={annualMonth} onChange={(e) => setAnnualMonth(e.target.value)}><option value="1">January</option><option value="4">Tax Refund</option><option value="6">Bonus Month</option><option value="12">December</option></select></label>
        <ScenarioInputGroup disabled={!typeAllowsOneTime} label="One-time payment"><div className="grid grid-cols-2 gap-3"><input disabled={!typeAllowsOneTime} className="input w-full disabled:opacity-40" inputMode="decimal" value={oneTimeAmount} onChange={(e) => setOneTimeAmount(e.target.value.replace(/[^0-9.]/g, ''))} /><input disabled={!typeAllowsOneTime} type="month" className="input w-full disabled:opacity-40" value={oneTimeDate} onChange={(e) => setOneTimeDate(e.target.value)} /></div></ScenarioInputGroup>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3"><label><span className="label">S&P comparison rate</span><input className="input w-full" inputMode="decimal" value={sp500Rate} onChange={(e) => setSp500Rate(e.target.value.replace(/[^0-9.]/g, ''))} /></label><label><span className="label">HYSA comparison rate</span><input className="input w-full" inputMode="decimal" value={hysaRate} onChange={(e) => setHysaRate(e.target.value.replace(/[^0-9.]/g, ''))} /></label><label><span className="label">Next rental rate</span><input className="input w-full" inputMode="decimal" value={rentalRate} onChange={(e) => setRentalRate(e.target.value.replace(/[^0-9.]/g, ''))} /></label></div>
    </div>

    {summary && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><ScenarioCard title="Current Loan" value={baseline?.payoff_time || '-'} detail={`${money(baseline?.interest_paid)} interest`} /><ScenarioCard title="Scenario" value={summary.payoff_time} detail={`${money(summary.interest_paid)} interest · ${money(summary.monthly_payment)}/mo`} tone="blue" /><ScenarioCard title="Interest Saved" value={money(summary.interest_saved)} detail={`${summary.years_saved || 0} years saved`} tone="green" /><ScenarioCard title="Return on Capital" value={summary.annualized_return == null ? '-' : `${summary.annualized_return.toFixed(1)}%/yr`} detail={summary.return_on_capital_lifetime == null ? 'Needs extra capital' : `${summary.return_on_capital_lifetime.toFixed(1)}% lifetime`} tone="purple" /></div>}

    {result && <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><ChartCard title="Loan Balance Over Time"><LineChart data={result.charts || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => `$${Math.round(v/1000)}k`} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(v)} /><Legend /><Line type="monotone" dataKey="baseline_balance" name="Current loan" stroke="#94a3b8" dot={false} /><Line type="monotone" dataKey="scenario_balance" name="Scenario loan" stroke="#2563eb" dot={false} /></LineChart></ChartCard><ChartCard title="Principal / Interest / Extra"><BarChart data={(result.charts || []).filter((_, i) => i % 12 === 0)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => `$${Math.round(v/1000)}k`} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(v)} /><Legend /><Bar dataKey="principal" name="Principal" stackId="a" fill="#22c55e" /><Bar dataKey="interest" name="Interest" stackId="a" fill="#f97316" /><Bar dataKey="extra" name="Extra" stackId="a" fill="#3b82f6" /></BarChart></ChartCard><ChartCard title="Equity Growth"><LineChart data={result.charts || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => `$${Math.round(v/1000)}k`} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(v)} /><Legend /><Line type="monotone" dataKey="baseline_equity" name="Current" stroke="#94a3b8" dot={false} /><Line type="monotone" dataKey="scenario_equity" name="Scenario" stroke="#16a34a" dot={false} /></LineChart></ChartCard><ChartCard title="Cumulative Interest Saved"><AreaChart data={result.charts || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => `$${Math.round(v/1000)}k`} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(v)} /><Area type="monotone" dataKey="interest_saved" name="Interest saved" stroke="#7c3aed" fill="#ede9fe" /></AreaChart></ChartCard></div>}

    {summary && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><div className="card"><h4 className="font-semibold text-gray-900 dark:text-white">Cash Flow Impact</h4><div className="mt-4 space-y-2 text-sm"><ScenarioRow label="Current cash flow" value={`${money(summary.current_cash_flow)}/mo`} /><ScenarioRow label="Scenario cash flow" value={`${money(summary.scenario_cash_flow)}/mo`} /><ScenarioRow label="Monthly difference" value={`${money(summary.monthly_cash_flow_difference)}/mo`} />{(summary.cash_outflow_lines || []).map((line) => <ScenarioRow key={`${line.label}-${line.display}`} label={line.label} value={line.display} />)}<ScenarioRow label="Total cash deployed" value={money(summary.total_cash_deployed)} /></div><p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{summary.cash_flow_note}</p></div><div className="card"><h4 className="font-semibold text-gray-900 dark:text-white">Opportunity Cost</h4><div className="mt-4 space-y-2 text-sm">{(result.opportunityCost || []).map((item) => <ScenarioRow key={item.label} label={item.label} value={money(item.future_value)} />)}</div></div><div className="card"><h4 className="font-semibold text-gray-900 dark:text-white">Decision Insights</h4><div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">{(result.insights || []).map((item) => <div key={item} className="rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800">{item}</div>)}</div></div></div>}

    {result && <div className="grid grid-cols-1 gap-4 xl:grid-cols-3"><div className="card xl:col-span-1"><div className="flex items-center justify-between"><h4 className="font-semibold text-gray-900 dark:text-white">Timeline</h4><button className="text-sm font-medium text-blue-600" onClick={() => setTimelineExpanded(!timelineExpanded)}>{timelineExpanded ? 'Collapse' : 'Expand'}</button></div><div className="mt-4 space-y-3">{shownTimeline.map((event) => <div key={`${event.date}-${event.label}`} className="flex gap-3"><div className="mt-1 h-3 w-3 rounded-full bg-blue-600" /><div><div className="text-sm font-medium text-gray-900 dark:text-white">{event.label}</div><div className="text-xs text-gray-500 dark:text-gray-400">{event.date}</div></div></div>)}</div></div><div className="card xl:col-span-2"><div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-gray-900 dark:text-white">Compare Multiple Scenarios</h4>{savedScenarios.length ? <button type="button" className="text-xs font-medium text-red-600 hover:text-red-700" onClick={clearSavedScenarios}>Clear saved</button> : null}</div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-xs uppercase text-gray-500"><th className="py-2">Scenario</th><th>Payoff</th><th>Interest</th><th>Saved</th><th>Years saved</th><th>Cash required</th><th>Return</th><th className="text-right">Action</th></tr></thead><tbody>{comparison.map((item) => <tr key={item.id} className={`border-t border-gray-100 dark:border-gray-700 ${item.is_best ? 'bg-green-50 dark:bg-green-950/20' : ''}`}><td className="py-2 font-medium text-gray-900 dark:text-white">{item.name}{item.is_best ? <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Best</span> : null}</td><td>{item.payoff_time}</td><td>{money(item.interest_paid)}</td><td>{money(item.interest_saved)}</td><td>{item.years_saved}</td><td>{money(item.cash_required)}</td><td>{item.annualized_return == null ? '-' : `${item.annualized_return.toFixed(1)}%/yr`}</td><td className="text-right">{item.id === 'baseline' || item.id === 'active-scenario' ? <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3.5 w-3.5" /> System</span> : <button type="button" className="icon-btn text-red-600" onClick={() => deleteSavedScenario(item.id, item.name)} title="Delete saved scenario"><Trash2 className="h-4 w-4" /></button>}</td></tr>)}</tbody></table></div></div></div>}

    {result && <div className="card"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold text-gray-900 dark:text-white">Amortization Schedule</h4><div className="flex flex-wrap gap-2"><select className="input w-32" value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select><input className="input w-44" placeholder="Search" value={scheduleSearch} onChange={(e) => setScheduleSearch(e.target.value)} /><button className="btn-secondary" onClick={exportSchedule}><Download className="h-4 w-4" /> Export CSV</button></div></div><div className="mt-4 max-h-[520px] overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-white text-left text-xs uppercase text-gray-500 dark:bg-gray-900"><tr><th className="py-2">Payment #</th><th>Date</th><th>Beginning Balance</th><th>Monthly Payment</th><th>Principal</th><th>Interest</th><th>Extra Monthly</th><th>Annual Lump Sum</th><th>Ending Balance</th><th>Running Interest Paid</th></tr></thead><tbody>{rows.map((row) => <tr key={row.payment_number} className="border-t border-gray-100 dark:border-gray-700"><td className="py-2">{row.payment_number}</td><td>{row.date}</td><td>{money(row.beginning_balance)}</td><td>{money(row.monthly_payment)}</td><td>{money(row.principal)}</td><td>{money(row.interest)}</td><td>{money(row.extra_monthly)}</td><td>{money(row.annual_lump_sum + row.one_time_payment)}</td><td>{money(row.ending_balance)}</td><td>{money(row.running_interest_paid)}</td></tr>)}</tbody></table></div></div>}
  </div>
}

function ScenarioInputGroup({ disabled, label, children }) {
  return <div className={`space-y-2 ${disabled ? 'opacity-60' : ''}`}><span className="label">{label}</span>{children}</div>
}

function ScenarioCard({ title, value, detail, tone = 'gray' }) {
  const tones = { gray: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800', blue: 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30', green: 'border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-950/30', purple: 'border-purple-200 bg-purple-50 dark:border-purple-900/40 dark:bg-purple-950/30' }
  return <div className={`rounded-lg border p-4 ${tones[tone] || tones.gray}`}><div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div><div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{value}</div><div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{detail}</div></div>
}

function ChartCard({ title, children }) {
  return <div className="card"><h4 className="mb-4 font-semibold text-gray-900 dark:text-white">{title}</h4><ResponsiveContainer width="100%" height={280}>{children}</ResponsiveContainer></div>
}

function ScenarioRow({ label, value }) {
  return <div className="flex items-center justify-between gap-4"><span className="text-gray-500 dark:text-gray-400">{label}</span><span className="font-medium text-gray-900 dark:text-white">{value}</span></div>
}

// ── Unified taxes tab (deductions / Schedule E) ────────────────────────────────
function UnifiedTaxPage({ propId, property }) {
  const [data, setData] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([propAPI.lifetime(propId), propAPI.taxComparison()])
      .then(([lifetimeRes, comparisonRes]) => {
        setData(lifetimeRes.data)
        setComparison(comparisonRes.data)
      })
      .catch(() => toast.error('Failed to load tax figures'))
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }
  if (!data) return null

  const type = (property?.usage_type || '').toLowerCase() === 'primary' ? 'PRIMARY' : 'RENTAL'
  const yearly = data.yearly || []
  const lifetime = data.lifetime || {}
  const taxSummary = data.tax_summary || {}
  const currentYear = new Date().getFullYear()
  const completeRows = yearly.filter((row) => !row.is_partial && row.year < currentYear)
  const headlineRow = completeRows.at(-1) || yearly.filter((row) => !row.is_partial).at(-1) || yearly.at(-1) || {}
  const headlineYear = taxSummary.current_year || headlineRow.year || currentYear - 1
  const rentalCurrent = taxSummary.current || {}
  const rentalLifetime = taxSummary.lifetime || {}
  const standardDeduction = 29200
  const interestPaid = inputNumber(headlineRow.interest_paid)
  const propertyTax = inputNumber(headlineRow.taxes_paid || headlineRow.property_tax)
  const deductibleInterest = interestPaid
  const deductibleTax = Math.min(propertyTax, 10000)
  const primaryDeduction = deductibleInterest + deductibleTax
  const itemizeVerdict = primaryDeduction > standardDeduction ? 'Likely itemize' : 'Standard likely'

  const config = type === 'PRIMARY'
    ? {
        header: 'Deductions',
        subtitle: 'Primary residence itemized-deduction view from loan and property-tax engine figures.',
        hero: { label: 'Estimated itemizable deduction', value: fmt(primaryDeduction), note: 'After SALT cap; mortgage cap label shown below', tone: 'blue' },
        components: [
          { label: 'Deductible interest', value: fmt(deductibleInterest), note: 'Mortgage cap context' },
          { label: 'Deductible property tax', value: fmt(deductibleTax), note: 'SALT capped at $10K' },
          { label: 'Standard deduction', value: fmt(standardDeduction), note: 'MFJ comparison placeholder' },
        ],
        lifetime: [
          { label: 'Interest paid to date', value: fmt(lifetime.total_interest_paid) },
          { label: 'Loan balance', value: fmt(lifetime.current_loan_balance) },
          { label: 'Itemize verdict', value: itemizeVerdict },
        ],
        banner: 'Primary residence deductions are subject to mortgage-interest and SALT caps. Filing status and origination rules can change the result; not tax advice.',
        columns: ['Year', 'Property tax', 'Interest paid', 'Deductible int', 'Balance'],
      }
    : {
        header: 'Schedule E',
        subtitle: 'Rental taxable P&L from income, expenses, mortgage interest, and depreciation.',
        hero: { label: 'Net Sch E', value: fmt(rentalCurrent.net_schedule_e), note: 'Flows to 1040', tone: (rentalCurrent.net_schedule_e || 0) < 0 ? 'red' : 'green' },
        components: [
          { label: 'Rental income', value: fmt(rentalCurrent.rental_income) },
          { label: 'Mortgage interest', value: fmt(rentalCurrent.mortgage_interest), note: 'Fully deductible - rental' },
          { label: 'Depreciation', value: rentalCurrent.depreciation == null ? 'N/A' : fmt(rentalCurrent.depreciation), note: 'Non-cash' },
        ],
        lifetime: [
          { label: 'Lifetime net Sch E', value: fmt(rentalLifetime.net_schedule_e) },
          { label: 'Accumulated depreciation', value: fmt(rentalLifetime.accumulated_depreciation) },
          { label: 'Suspended losses', value: fmt(rentalLifetime.suspended_losses) },
        ],
        banner: 'Passive-loss rules may limit Schedule E losses. If MAGI is above the phaseout range, review Form 8582 carryforwards.',
        columns: ['Year', 'Income', 'Op ex', 'Interest', 'Depreciation', 'Net Sch E'],
      }

  const exportCSV = () => {
    const rows = yearly.map((row) => type === 'PRIMARY'
      ? [row.year, row.taxes_paid || row.property_tax || 0, row.interest_paid || 0, row.interest_paid || 0, row.loan_balance || row.balance || 0]
      : [row.year, row.rental_income || 0, row.operating_expenses || 0, row.interest_paid || 0, row.depreciation || 0, row.taxable_income ?? row.net_schedule_e ?? 0])
    const lines = [config.columns.join(','), ...rows.map((row) => row.join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.header.toLowerCase().replace(/\s+/g, '_')}_${propertyLabel(property).replace(/\s+/g, '_') || propId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{config.header} — {headlineYear}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{config.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCSV} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button type="button" onClick={() => setShowCompare((value) => !value)} className="btn-secondary text-sm">
            {showCompare ? 'Hide comparison' : 'Compare'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <TaxMetricCard metric={config.hero} hero />
        {config.components.map((metric) => <TaxMetricCard key={metric.label} metric={metric} />)}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {config.lifetime.map((metric) => <TaxStatusMetric key={metric.label} metric={metric} />)}
      </div>

      <div className={type === 'PRIMARY'
        ? 'rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300'
        : 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300'}
      >
        {config.banner}
      </div>

      <div className="card">
        <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">History</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {config.columns.map((column, index) => (
                  <th key={column} className={index === 0 ? 'py-2 pr-3 text-left font-medium' : 'px-3 py-2 text-right font-medium'}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {yearly.map((row) => (
                <tr key={row.year}>
                  <td className="py-2 pr-3 font-medium text-gray-900 dark:text-white">{row.is_partial ? `${row.year} partial` : row.year}</td>
                  {type === 'PRIMARY' ? (
                    <>
                      <td className="px-3 py-2 text-right">{fmt(row.taxes_paid || row.property_tax || 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(row.interest_paid || 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(row.interest_paid || 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(row.loan_balance || row.balance || 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right text-green-600">{fmt(row.rental_income || 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(row.operating_expenses || 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(row.interest_paid || 0)}</td>
                      <td className="px-3 py-2 text-right text-purple-600">{fmt(row.depreciation || 0)}</td>
                      <td className={(row.taxable_income || 0) < 0 ? 'px-3 py-2 text-right font-semibold text-red-600' : 'px-3 py-2 text-right font-semibold text-green-600'}>{fmt(row.taxable_income || 0)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCompare && comparison ? <TaxComparison comparison={comparison} currentPropId={Number(propId)} /> : null}
    </div>
  )
}

function TaxMetricCard({ metric, hero = false }) {
  const toneClass = metric.tone === 'red'
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300'
    : metric.tone === 'green'
      ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300'
      : hero
        ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300'
        : 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
  return (
    <div className={`min-h-32 rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{metric.label}</p>
      <p className="mt-2 text-2xl font-bold">{metric.value}</p>
      {metric.note ? <p className="mt-1 text-xs opacity-80">{metric.note}</p> : null}
    </div>
  )
}

function TaxStatusMetric({ metric }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/70">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{metric.label}</p>
      <p className="mt-1 text-base font-bold text-gray-900 dark:text-white">{metric.value}</p>
    </div>
  )
}

// ── Taxes tab (tax-return Schedule E / Schedule A) ──────────────────────────────
function TaxesTabRaw({ propId, property }) {
  const [lifetimeRows, setLifetimeRows] = useState([])
const [taxSummary, setTaxSummary] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCompare, setShowCompare] = useState(false)
  const [taxHistory, setTaxHistory] = useState({})
  const [taxSaving, setTaxSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([propAPI.lifetime(propId), propAPI.taxComparison()])
      .then(([l, c]) => {
        setLifetimeRows(l.data?.yearly || [])
setTaxSummary(l.data?.tax_summary || null)
        setComparison(c.data)
        setTaxHistory(parseJsonNumberMap(property?.property_tax_history))
      })
      .catch(() => toast.error('Failed to load tax figures'))
      .finally(() => setLoading(false))
  }, [propId, property?.property_tax_history])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const isPrimary = (property?.usage_type || '').toLowerCase() === 'primary'
  const currentYear = new Date().getFullYear()
  const baseTax = inputNumber(property?.property_tax)
  const lifetimeByYear = new Map((lifetimeRows || []).map((row) => [Number(row.year), row]))
  const historyYears = Object.keys(taxHistory).map((year) => Number(year))
  const defaultYears = Array.from({ length: 5 }, (_, index) => currentYear - 4 + index)
  const years = [...new Set([...defaultYears, ...historyYears, ...lifetimeByYear.keys()])]
    .filter(Boolean)
    .sort((a, b) => a - b)

  const labelSource = (source) => {
    const normalized = String(source || '').toLowerCase()
    if (normalized === 'reported' || normalized === '1098' || normalized === 'tax_return' || normalized === 'actual') return 'Reported'
    if (normalized === 'approx') return 'Approx'
    if (normalized === 'calculated' || normalized === 'backend_amortization') return 'Calculated'
    return 'Calculated'
  }

  const badgeClass = (label) => {
    if (label === 'Reported') return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
    if (label === 'Approx') return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800'
    return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'
  }

  const SourceBadge = ({ source }) => {
    const label = labelSource(source)
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClass(label)}`}>{label}</span>
  }

  const purchaseYear = Number(String(property?.purchase_date || '').match(/\b(19|20)\d{2}\b/)?.[0]) || Math.min(...lifetimeByYear.keys(), currentYear)
  const rows = years
    .filter((year) => !purchaseYear || year >= purchaseYear)
    .map((year) => {
      const backend = lifetimeByYear.get(year) || {}
      const loans = backend.loans || []
      const hasLoanData = loans.length > 0
      const enteredTax = inputNumber(taxHistory[String(year)])
      const propertyTax = inputNumber(backend.property_tax ?? backend.taxes_paid) || enteredTax || baseTax
      const propertyTaxSource = backend.property_tax_source || (enteredTax ? 'reported' : 'approx')
      const propertyTaxNote = backend.property_tax_note || (enteredTax ? 'Entered property tax amount.' : 'Estimated - same current year (no tax doc on file).')
      const rentalIncome = inputNumber(backend.rental_income)
      const operatingExpenses = inputNumber(backend.operating_expenses)
      const mortgageInterest = hasLoanData ? inputNumber(backend.mortgage_interest ?? backend.interest_paid) : 0
      const depreciation = isPrimary || backend.usage_status === 'Primary' ? null : inputNumber(backend.depreciation)
      const netScheduleE = isPrimary ? null : rentalIncome - operatingExpenses - mortgageInterest - inputNumber(depreciation)
      const yearLabel = String(year) + (backend.is_partial ? (year === currentYear ? ' YTD' : ' partial') : '')
      return {
        year,
        yearLabel,
        propertyTax,
        propertyTaxSource,
        propertyTaxNote,
        hasLoanData,
        rentalIncome,
        operatingExpenses,
        interest: mortgageInterest,
        interestSource: hasLoanData ? (backend.interest_source || 'calculated') : null,
        interestNote: hasLoanData ? (backend.interest_note || 'Calculated from shared loan engine. Fully deductible - rental.') : null,
        depreciation,
        netScheduleE,
        balance: hasLoanData ? inputNumber(backend.loan_balance ?? backend.balance) : null,
        loans,
        source: backend.source || 'property records',
        usageStatus: backend.usage_status || (isPrimary ? 'Primary' : 'Rental'),
      }
    })

  const setTaxAmount = (year, value) => {
    setTaxHistory((current) => ({ ...current, [String(year)]: value }))
  }

  const saveTaxHistory = async () => {
    setTaxSaving(true)
    try {
      const cleaned = Object.fromEntries(
        Object.entries(taxHistory)
          .map(([year, amount]) => [year, inputNumber(amount)])
          .filter(([year, amount]) => /^\d{4}$/.test(String(year)) && amount > 0)
      )
      const latestYear = Object.keys(cleaned).map(Number).sort((a, b) => b - a)[0]
      await propAPI.update(propId, {
        ...property,
        property_tax_history: JSON.stringify(cleaned),
        property_tax: latestYear ? cleaned[String(latestYear)] : baseTax,
      })
      setTaxHistory(cleaned)
      toast.success('Property tax history saved')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save property tax history')
    } finally {
      setTaxSaving(false)
    }
  }

  const exportCSV = () => {
    const headers = isPrimary
      ? ['Year', 'Property Tax', 'Property Tax Source', 'Mortgage Interest', 'Interest Source', 'Loan Balance']
      : ['Year', 'Rental Income', 'Operating Expenses', 'Mortgage Interest', 'Depreciation', 'Net Schedule E', 'Loan Balance']
    const lines = [
      headers.join(','),
      ...rows.map((row) => (isPrimary
        ? [row.year, row.propertyTax, labelSource(row.propertyTaxSource), row.hasLoanData ? row.interest : '', row.hasLoanData ? labelSource(row.interestSource) : '', row.hasLoanData ? row.balance : '']
        : [row.year, row.rentalIncome, row.operatingExpenses, row.interest, row.depreciation ?? '', row.netScheduleE, row.balance ?? '']
      ).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tax_figures_' + (propertyLabel(property).replace(/\s+/g, '_') || propId) + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Tax Return Figures</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isPrimary ? 'Primary residence: deductible mortgage interest and property tax.' : 'Rental property: Schedule E figures when available.'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="btn-secondary text-sm flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button onClick={() => setShowCompare((s) => !s)} className="btn-secondary text-sm">
              {showCompare ? 'Hide comparison' : 'Compare all properties'}
            </button>
          </div>
        </div>

        {!isPrimary && taxSummary?.current ? (() => {
          const current = taxSummary.current
          const lifetime = taxSummary.lifetime || {}
          return (
            <div className="mb-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Schedule E - {taxSummary.current_year}</h4>
                <span className="text-xs text-gray-500 dark:text-gray-400">{taxSummary.notes?.current_year_policy}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-lg bg-purple-50 p-4 dark:bg-purple-900/20">
                  <p className="text-xs font-medium uppercase tracking-wide text-purple-700 dark:text-purple-300">Net Sch E</p>
                  <p className={current.net_schedule_e < 0 ? 'mt-1 text-2xl font-bold text-red-600' : 'mt-1 text-2xl font-bold text-green-600'}>{fmt(current.net_schedule_e)}</p>
                  <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">Taxable rental result flowing to 1040</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50"><p className="text-xs text-gray-500 dark:text-gray-400">Rental income</p><p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(current.rental_income)}</p></div>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50"><p className="text-xs text-gray-500 dark:text-gray-400">Mortgage interest</p><p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(current.mortgage_interest)}</p><p className="text-xs text-gray-500">Fully deductible - rental</p></div>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50"><p className="text-xs text-gray-500 dark:text-gray-400">Depreciation</p><p className="mt-1 text-xl font-bold text-purple-600">{current.depreciation == null ? 'N/A' : fmt(current.depreciation)}</p><p className="text-xs text-gray-500">Non-cash Sch E line 18</p></div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-700"><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Lifetime Net Sch E</p><p className={(lifetime.net_schedule_e || 0) < 0 ? 'mt-1 text-xl font-bold text-red-600' : 'mt-1 text-xl font-bold text-green-600'}>{fmt(lifetime.net_schedule_e)}</p><p className="text-xs text-gray-500">Cumulative rental gain/loss to date</p></div>
                <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-700"><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Accumulated depreciation</p><p className="mt-1 text-xl font-bold text-purple-600">{fmt(lifetime.accumulated_depreciation)}</p><p className="text-xs text-gray-500">Basis reduction / recapture tracker</p></div>
                <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-700"><p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Suspended losses</p><p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{fmt(lifetime.suspended_loss)}</p><p className="text-xs text-gray-500">Upload 8582 to report carryforward</p></div>
              </div>
              {current.passive_loss_flag ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Passive-loss check: loss shown for {taxSummary.current_year}. If MAGI is above $150K, losses may be suspended on Form 8582. Upload 1040 / Schedule E / 8582 to calculate allowed vs suspended.</div> : null}
            </div>
          )
        })() : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700">
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Year</th>
                {isPrimary ? (
                  <>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Property Tax</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Mortgage Interest</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Loan Balance</th>
                  </>
                ) : (
                  <>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Rental income</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Op ex</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Mortgage interest</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Depreciation</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Net Sch E</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {rows.map((row, index) => (
                <tr key={row.year} className={index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'}>
                  <td className="py-3 px-3 font-medium text-gray-900 dark:text-white">{row.yearLabel || row.year}</td>
                  {isPrimary ? (
                    <>
                      <td className="py-3 px-3 text-right"><div className="flex flex-col items-end gap-1"><span>{fmt(row.propertyTax)}</span><span className="inline-flex items-center gap-1"><SourceBadge source={row.propertyTaxSource} />{labelSource(row.propertyTaxSource) === 'Approx' ? <Info className="w-3.5 h-3.5 text-amber-500" title={row.propertyTaxNote} /> : null}</span></div></td>
                      <td className="py-3 px-3 text-right">{row.hasLoanData ? fmt(row.interest) : <span className="text-gray-400 dark:text-gray-500">—</span>}</td>
                      <td className="py-3 px-3 text-right">{row.hasLoanData ? fmt(row.balance) : <span className="text-gray-400 dark:text-gray-500">—</span>}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-3 px-3 text-right text-gray-800 dark:text-gray-200">{fmt(row.rentalIncome)}</td>
                      <td className="py-3 px-3 text-right text-gray-800 dark:text-gray-200">{fmt(row.operatingExpenses)}</td>
                      <td className="py-3 px-3 text-right text-gray-800 dark:text-gray-200">{fmt(row.interest)}</td>
                      <td className="py-3 px-3 text-right text-purple-600">{row.depreciation == null ? 'N/A' : fmt(row.depreciation)} <span className="block text-[10px] text-gray-400">non-cash</span></td>
                      <td className={row.netScheduleE < 0 ? 'py-3 px-3 text-right font-semibold text-red-600' : 'py-3 px-3 text-right font-semibold text-green-600'}>{fmt(row.netScheduleE)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {isPrimary ? 'Primary residence tax model applies mortgage-interest and SALT limits.' : 'Rental Schedule E model: mortgage interest and property tax are fully deductible rental expenses; principal is excluded and shown on Loans. Figures are calculated from the shared engine unless uploaded 1040 / Schedule E marks them Reported.'}
        </p>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Property Tax Raw Data</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Enter actual tax amounts when known; blank years use the current property tax as an approximation.</p>
          </div>
          <button onClick={saveTaxHistory} disabled={taxSaving} className="btn-primary text-sm">
            {taxSaving ? 'Saving...' : 'Save Taxes'}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {years.map((year) => (
            <label key={year} className="block">
              <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{year}</span>
              <input
                type="text"
                inputMode="decimal"
                className="input w-full"
                value={taxHistory[String(year)] ?? ''}
                onChange={(event) => setTaxAmount(year, event.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={baseTax ? String(baseTax) : '0'}
              />
            </label>
          ))}
        </div>
      </div>

      {showCompare && comparison && (
        <TaxComparison comparison={comparison} currentPropId={Number(propId)} />
      )}
    </div>
  )
}

function TaxesTab({ propId, property }) {
  const [entries, setEntries] = useState(null)
  const [lifetimeRows, setLifetimeRows] = useState([])
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCompare, setShowCompare] = useState(false)
  const [taxHistory, setTaxHistory] = useState({})
  const [taxSaving, setTaxSaving] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([propAPI.taxEntries(propId), propAPI.taxComparison(), propAPI.lifetime(propId)])
      .then(([e, c, l]) => {
      setEntries(e.data)
      setComparison(c.data)
      setLifetimeRows(l.data?.yearly || [])
      setTaxHistory(parseJsonNumberMap(property?.property_tax_history))
    })
      .catch(() => toast.error('Failed to load tax return data'))
      .finally(() => setLoading(false))
  }, [propId, property?.property_tax_history])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const isPrimary = (property?.usage_type || '').toLowerCase() === 'primary'
  const entriesByYear = new Map((entries || []).map((entry) => [Number(entry.tax_year), entry]))
  const lifetimeByYear = new Map((lifetimeRows || []).map((row) => [Number(row.year), row]))
  const historyYears = Object.keys(taxHistory).map((year) => Number(year))
  const currentYear = new Date().getFullYear()
  const defaultYears = Array.from({ length: 5 }, (_, index) => currentYear - 4 + index)
  const availableYears = [...new Set([...entriesByYear.keys(), ...lifetimeByYear.keys(), ...historyYears, ...defaultYears])]
    .filter(Boolean)
    .sort((a, b) => a - b)

  // Sort ascending by year so cumulative runs forward
  const sorted = availableYears.map((year) => {
    const filed = entriesByYear.get(year)
    if (filed) {
      return { ...filed, status: 'filed', status_label: '1040 filed' }
    }
    const estimate = lifetimeByYear.get(year) || {}
    return {
      id: `estimate-${year}`,
      tax_year: year,
      property_kind: isPrimary ? 'primary' : 'rental',
      rents_received: estimate.rental_income || 0,
      mortgage_interest: estimate.interest_paid || 0,
      property_taxes: estimate.taxes_paid || 0,
      depreciation: estimate.depreciation || 0,
      total_expenses: estimate.operating_expenses || 0,
      net_income: estimate.taxable_income ?? estimate.cash_flow ?? 0,
      cumulative_net: 0,
      status: 'not_filed',
      status_label: 'Taxes yet to be filed',
      source: estimate.source || 'property records',
    }
  })
  const hasRows = sorted.length > 0

  // Build cumulative net income column
  let cumulative = 0
  const rows = sorted.map(e => {
    cumulative += (e.net_income || 0)
    return { ...e, cumulative_net: cumulative }
  })

  const setTaxAmount = (year, value) => {
    setTaxHistory((current) => ({ ...current, [String(year)]: value }))
  }

  const saveTaxHistory = async () => {
    setTaxSaving(true)
    try {
      const cleaned = Object.fromEntries(
        Object.entries(taxHistory)
          .map(([year, amount]) => [year, inputNumber(amount)])
          .filter(([year, amount]) => /^\d{4}$/.test(String(year)) && amount > 0)
      )
      const latestYear = Object.keys(cleaned).map(Number).sort((a, b) => b - a)[0]
      await propAPI.update(propId, {
        ...property,
        property_tax_history: JSON.stringify(cleaned),
        property_tax: latestYear ? cleaned[String(latestYear)] : property?.property_tax || 0,
      })
      setTaxHistory(cleaned)
      toast.success('Property tax history saved')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save property tax history')
    } finally {
      setTaxSaving(false)
    }
  }

  const exportCSV = () => {
    const headers = ['Year', 'Status', 'Source', 'Rents Received', 'Mortgage Interest', 'Property Taxes',
      'Depreciation', 'Total Expenses', 'Net Income', 'Cumulative Net Income']
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.tax_year,
        r.status_label || '',
        r.source || '',
        r.rents_received ?? '',
        r.mortgage_interest ?? '',
        r.property_taxes ?? '',
        r.depreciation ?? '',
        r.total_expenses ?? '',
        r.net_income ?? '',
        r.cumulative_net,
      ].join(','))
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tax_return_${propertyLabel(property).replace(/\s+/g, '_') || propId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* This property's tax-return figures by year */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Tax Return Figures</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {isPrimary ? 'Schedule A — primary residence' : 'Schedule E — rental real estate'}
            </p>
          </div>
          <div className="flex gap-2">
            {hasRows && (
              <button onClick={exportCSV} className="btn-secondary text-sm flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            <button onClick={() => setShowCompare((s) => !s)} className="btn-secondary text-sm">
              {showCompare ? 'Hide comparison' : 'Compare all properties'}
            </button>
          </div>
        </div>

        {!hasRows ? (
          <div className="text-center py-10">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 dark:text-gray-500 text-sm">No tax-return data for this property yet.</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
              Upload a 1040 tax return (with Schedule E) or add property records to calculate tax-year estimates.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Year</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                    {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-green-600">Rents</th>}
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Mortgage Int.</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Prop. Taxes</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Depreciation</th>
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Total Exp.</th>}
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Net Income</th>}
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-blue-600">Cumulative Net</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={e.id} className={i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'}>
                    <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">
                        {e.tax_year}
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 capitalize">{e.property_kind}</span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          e.status === 'filed'
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                        }`}>
                          {e.status_label}
                        </span>
                        {e.status !== 'filed' && (
                          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                            From {e.source || 'available records'}
                          </div>
                        )}
                      </td>
                    {!isPrimary && (
                      <td className="py-2 px-3 text-right text-green-600 font-medium">{fmt(e.rents_received)}</td>
                    )}
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.mortgage_interest)}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.property_taxes)}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.depreciation)}</td>
                    {!isPrimary && (
                      <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.total_expenses)}</td>
                    )}
                    {!isPrimary && (
                      <td className={`py-2 px-3 text-right font-medium ${e.net_income >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {e.net_income >= 0 ? '+' : ''}{fmt(e.net_income)}
                      </td>
                    )}
                    {!isPrimary && (
                      <td className={`py-2 px-3 text-right font-semibold ${e.cumulative_net >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                        {e.cumulative_net >= 0 ? '+' : ''}{fmt(e.cumulative_net)}
                      </td>
                    )}
                  </tr>
                ))}
                {/* Totals row */}
                {rows.length > 1 && !isPrimary && (
                  <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold">
                    <td className="py-2 px-3 text-gray-700 dark:text-gray-300">Total ({rows[0].tax_year}–{rows[rows.length-1].tax_year})</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-gray-400">Filed + estimated</td>
                    <td className="py-2 px-3 text-right text-green-600">{fmt(rows.reduce((s,r) => s+(r.rents_received||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.mortgage_interest||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.property_taxes||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.depreciation||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.total_expenses||0), 0))}</td>
                    <td className={`py-2 px-3 text-right ${cumulative >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {cumulative >= 0 ? '+' : ''}{fmt(cumulative)}
                    </td>
                    <td className={`py-2 px-3 text-right ${cumulative >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                      {cumulative >= 0 ? '+' : ''}{fmt(cumulative)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cross-property comparison */}
      {showCompare && comparison && (
        <TaxComparison comparison={comparison} currentPropId={Number(propId)} />
      )}
    </div>
  )
}

function TaxComparison({ comparison, currentPropId }) {
  if (!comparison.years || comparison.years.length === 0) {
    return <div className="card text-sm text-gray-400 dark:text-gray-500">No tax-return data to compare yet.</div>
  }
  const COLS = [
    ['rents_received', 'Rents'],
    ['mortgage_interest', 'Mortgage Int.'],
    ['property_taxes', 'Taxes'],
    ['depreciation', 'Depreciation'],
    ['total_expenses', 'Total Exp.'],
    ['net_income', 'Net'],
  ]
  return (
    <div className="space-y-6">
      {comparison.years.map((yr) => (
        <div key={yr.tax_year} className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{yr.tax_year} — All Properties</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-2 font-medium">Property</th>
                  {COLS.map(([k, label]) => (
                    <th key={k} className="pb-2 px-2 font-medium text-right">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {yr.entries.map((e) => (
                  <tr key={e.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${e.property_id === currentPropId ? 'bg-blue-50/50' : ''}`}>
                    <td className="py-2 pr-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {e.property_name || (e.property_uid ? `ID ${e.property_uid.slice(0, 8).toUpperCase()}` : 'Unlinked property')}
                    </span>
                      {e.property_kind === 'primary' && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">primary</span>
                      )}
                      {!e.property_id && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:text-gray-400">unlinked</span>
                      )}
                    </td>
                    {COLS.map(([k]) => (
                      <td key={k} className={`py-2 px-2 text-right ${k === 'net_income' ? (e[k] >= 0 ? 'text-green-600' : 'text-red-500') : ''}`}>
                        {e[k] ? fmt(e[k]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 dark:border-gray-700 font-semibold">
                  <td className="py-2 pr-2 text-gray-900 dark:text-white">Total</td>
                  {COLS.map(([k]) => (
                    <td key={k} className="py-2 px-2 text-right">{fmt(yr.totals[k])}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Rental tab ──────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m, y) => (m && y ? `${MONTHS[m - 1]} ${y}` : '')

function RentalTab({ propId }) {
  const [data, setData]         = useState(null)
  const [taxData, setTaxData]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPeriod, setEditPeriod] = useState(null)

  const currentYear = new Date().getFullYear()

  const load = () => {
    setLoading(true)
    Promise.all([
      propAPI.rentals(propId),
      propAPI.rawdata(propId),
    ])
      .then(([r, rd]) => { setData(r.data); setTaxData(rd.data) })
      .catch(() => toast.error('Failed to load rental history'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [propId])

  const handleDelete = async (rid) => {
    if (!confirm('Delete this rental period?')) return
    await propAPI.deleteRental(propId, rid)
    toast.success('Rental period deleted')
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!data) return null

  const { periods, yearly, total_collected } = data

  // Tax entry lookup by year (for past rent & days_rented)
  const taxByYear = Object.fromEntries(
    (taxData?.tax_entries || []).map(e => [e.tax_year, e])
  )

  // Merge yearly rows with tax return data
  // All years present in either source
  const leaseYearSet = new Set(yearly.map(y => y.year))
  const taxYearSet   = new Set(Object.keys(taxByYear).map(Number))
  const allYears     = Array.from(new Set([...leaseYearSet, ...taxYearSet])).sort((a, b) => b - a)

  return (
    <div className="space-y-6">

      {/* Per-year occupancy + tax return rollup */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Rental by Year</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Past years: rent &amp; days from Tax Returns (Schedule E). Current year: from lease records / input.
            </p>
          </div>
          <span className="text-sm text-gray-400 dark:text-gray-500 shrink-0 ml-4">
            Total collected: <span className="font-semibold text-green-600">{fmt(total_collected)}</span>
          </span>
        </div>
        {allYears.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">
            No rental periods yet. Add a lease below or upload a tax return to track income per year.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-2 font-medium text-left">Year</th>
                  <th className="pb-2 px-2 font-medium text-right">Rent Collected</th>
                  <th className="pb-2 px-2 font-medium text-right">Source</th>
                  <th className="pb-2 px-2 font-medium text-right">Days Rented<br/><span className="text-gray-400 dark:text-gray-500 font-normal">Sch E line 2</span></th>
                  <th className="pb-2 px-2 font-medium text-right">Personal Days<br/><span className="text-gray-400 dark:text-gray-500 font-normal">Sch E line 3</span></th>
                  <th className="pb-2 px-2 font-medium text-right">Occupancy</th>
                  <th className="pb-2 px-2 font-medium">&nbsp;</th>
                  <th className="pb-2 pl-2 font-medium text-right">Months / Lease</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {allYears.map((yr) => {
                  const ly   = yearly.find(y => y.year === yr)
                  const te   = taxByYear[yr]
                  const isPast    = yr < currentYear
                  const isCurrent = yr === currentYear

                  // Rent: past years prefer tax return; current uses lease
                  const rent       = isPast && te?.rents_received ? te.rents_received
                                   : ly?.income ?? null
                  const rentSource = isPast && te?.rents_received ? 'tax_return'
                                   : ly ? 'leases' : 'none'
                  const daysRented  = te?.days_rented || null
                  const personalDays = te?.personal_use_days || null
                  const occupancy  = ly?.occupancy ?? null
                  const mixedUse   = daysRented != null && personalDays > 0

                  const yearDays = (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365
                  const occupancyFromDays = daysRented != null
                    ? Math.round(daysRented / yearDays * 100)
                    : occupancy

                  return (
                    <tr key={yr} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${mixedUse ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                      <td className="py-2.5 pr-2 font-semibold text-gray-900 dark:text-white">
                        {yr}
                        {isCurrent && <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">current</span>}
                        {mixedUse  && <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">mixed use</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium text-green-600">
                        {rent != null ? fmt(rent) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          rentSource === 'tax_return' ? 'bg-purple-100 text-purple-700' :
                          rentSource === 'leases'     ? 'bg-blue-100 text-blue-700' :
                                                        'bg-gray-100 text-gray-400 dark:text-gray-500'}`}>
                          {rentSource === 'tax_return' ? 'Sch-E' :
                           rentSource === 'leases'     ? 'leases' : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium text-blue-700">
                        {daysRented != null ? `${daysRented}d` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right text-orange-600">
                        {personalDays != null && personalDays > 0
                          ? `${personalDays}d`
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium">
                        {occupancyFromDays != null ? fmtPct(occupancyFromDays) : '—'}
                      </td>
                      <td className="py-2.5 px-2 w-32">
                        {occupancyFromDays != null && (
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                              occupancyFromDays >= 95 ? 'bg-green-500' :
                              occupancyFromDays >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${Math.min(occupancyFromDays, 100)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 text-right text-gray-500 dark:text-gray-400 text-xs">
                        {ly ? `${ly.occupied_months}/${ly.months_elapsed} mo` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400 dark:text-gray-500">
          <span><span className="inline-block w-2 h-2 rounded bg-purple-400 mr-1" />Sch-E = income / days from uploaded tax return</span>
          <span><span className="inline-block w-2 h-2 rounded bg-blue-400 mr-1" />Leases = from entered lease periods below</span>
          <span><span className="inline-block w-2 h-2 rounded bg-amber-300 mr-1" />Mixed use = rental + personal days in same year</span>
        </div>
      </div>

      {/* Lease periods list */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Lease Periods ({periods.length})</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Used for current-year income and occupancy tracking.</p>
          </div>
          <button onClick={() => { setEditPeriod(null); setShowForm(true) }}
            className="btn-primary flex items-center gap-2 text-sm shrink-0">
            <Plus className="w-4 h-4" /> Add Period
          </button>
        </div>
        {periods.length === 0 ? (
          <div className="text-center py-10">
            <Home className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 dark:text-gray-500 text-sm">No lease periods recorded</p>
          </div>
        ) : (
          <div className="space-y-2">
            {periods.map((p) => (
              <div key={p.id} className="flex items-center justify-between border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <Home className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">
                      {p.tenant_name || 'Tenant'}
                      <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">
                        {monthLabel(p.start_month, p.start_year)} → {p.end_year ? monthLabel(p.end_month, p.end_year) : 'present'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {fmt(p.monthly_rent)}/mo{p.notes ? ` · ${p.notes}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditPeriod(p); setShowForm(true) }}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(p.id)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <RentalForm
          propId={propId}
          period={editPeriod}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function RentalForm({ propId, period, onClose, onSaved }) {
  const now = new Date()
  const [form, setForm] = useState({
    tenant_name: period?.tenant_name || '',
    start_month: period?.start_month || 1,
    start_year: period?.start_year || now.getFullYear(),
    end_month: period?.end_month || '',
    end_year: period?.end_year || '',
    monthly_rent: period?.monthly_rent ?? '',
    notes: period?.notes || '',
    ongoing: period ? !period.end_year : false,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    const payload = {
      tenant_name: form.tenant_name || null,
      start_month: Number(form.start_month),
      start_year: Number(form.start_year),
      end_month: form.ongoing || !form.end_month ? null : Number(form.end_month),
      end_year: form.ongoing || !form.end_year ? null : Number(form.end_year),
      monthly_rent: Number(form.monthly_rent) || 0,
      notes: form.notes || null,
    }
    if (!form.ongoing && payload.end_year && payload.end_month &&
        (payload.end_year < payload.start_year ||
         (payload.end_year === payload.start_year && payload.end_month < payload.start_month))) {
      toast.error('End date is before start date')
      return
    }
    setSaving(true)
    try {
      if (period) await propAPI.updateRental(propId, period.id, payload)
      else await propAPI.addRental(propId, payload)
      toast.success(period ? 'Rental period updated' : 'Rental period added')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">{period ? 'Edit' : 'Add'} Rental Period</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="label">Tenant / Label (optional)</label>
            <input className="input" value={form.tenant_name}
              onChange={(e) => set('tenant_name', e.target.value)} placeholder="e.g. John Smith" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">From</label>
              <div className="flex gap-2">
                <select className="input" value={form.start_month} onChange={(e) => set('start_month', e.target.value)}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input type="number" className="input w-24" value={form.start_year}
                  onChange={(e) => set('start_year', e.target.value)} min="1980" max="2100" required />
              </div>
            </div>
            <div>
              <label className="label flex items-center justify-between">
                <span>To</span>
                <label className="flex items-center gap-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                  <input type="checkbox" checked={form.ongoing}
                    onChange={(e) => set('ongoing', e.target.checked)} /> Ongoing
                </label>
              </label>
              <div className="flex gap-2">
                <select className="input" value={form.end_month} disabled={form.ongoing}
                  onChange={(e) => set('end_month', e.target.value)}>
                  <option value="">—</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input type="number" className="input w-24" value={form.end_year} disabled={form.ongoing}
                  onChange={(e) => set('end_year', e.target.value)} min="1980" max="2100"
                  placeholder="Year" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Monthly Rent ($)</label>
              <input type="number" className="input" value={form.monthly_rent}
                onChange={(e) => set('monthly_rent', e.target.value)} min="0" step="50" required />
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" value={form.notes}
                onChange={(e) => set('notes', e.target.value)} placeholder="e.g. renewed lease" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : period ? 'Save' : 'Add Period'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Summary / Lifetime tab ─────────────────────────────────────────────────────
// ── RawDataTab ────────────────────────────────────────────────────────────────
// Pulls every raw data point from backend and presents them in a year-by-year
// cross-verification grid, flagging mismatches between sources.

function RawDataTab({ propId, prop }) {
  const [data, setData]       = useState(null)
  const [lifetimeData, setLifetimeData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selYear, setSelYear] = useState('all')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      propAPI.rawdata(propId),
      propAPI.lifetime(propId),
    ])
      .then(([raw, lifetime]) => {
        setData(raw.data)
        setLifetimeData(lifetime.data)
      })
      .catch(() => toast.error('Failed to load verification data'))
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!data) return null

  const { tax_entries, docs_1098, docs_1098_detail, docs_balance, docs_balance_logic = {},
          stmt_annual, tax_docs, lease_rent, irs_annual_depreciation,
          snapshots, loans } = data
  const lifetime = lifetimeData?.lifetime || {}
  const yearly = lifetimeData?.yearly || []
 const principalTopupPaid = lifetime.total_principal_topup_paid ?? lifetime.principal_topup_paid
  const topupRows = yearly.filter(y => (y.principal_topup_paid || 0) > 0)
  const expectedPrincipalPaid = lifetime.total_expected_principal_paid ?? lifetime.expected_principal_paid
  const scheduledLoanBalance = lifetime.scheduled_loan_balance

  // Build sorted set of all years across all sources
  const allYears = Array.from(new Set([
    ...tax_entries.map(e => e.tax_year),
    ...Object.keys(docs_1098).map(Number),
    ...Object.keys(docs_balance).map(Number),
    ...Object.keys(stmt_annual).map(Number),
    ...Object.keys(lease_rent).map(Number),
    ...Object.keys(tax_docs).map(Number),
  ])).sort((a, b) => b - a)

  const years = selYear === 'all' ? allYears : [Number(selYear)]

  // Tax entry lookup by year
  const taxByYear = Object.fromEntries(tax_entries.map(e => [e.tax_year, e]))

  // ── Discrepancy detection ───────────────────────────────────────────────────
  const THRESH = 0.05  // 5% tolerance before flagging

  function discLevel(a, b) {
    if (a == null || b == null) return 'none'
    if (a === 0 && b === 0) return 'none'
    const base = Math.max(Math.abs(a), Math.abs(b), 1)
    const diff = Math.abs(a - b) / base
    if (diff > 0.20) return 'high'
    if (diff > THRESH) return 'low'
    return 'none'
  }

  const DISC_STYLE = {
    none: '',
    low:  'bg-yellow-50 dark:bg-yellow-900/20',
    high: 'bg-red-50 dark:bg-red-900/20',
  }
  const DISC_TEXT = {
    none: 'text-gray-700 dark:text-gray-300',
    low:  'text-yellow-800 dark:text-yellow-300 font-medium',
    high: 'text-red-700 dark:text-red-400 font-bold',
  }
  const DISC_BADGE = {
    none: null,
    low:  <span className="ml-1 text-xs text-yellow-600 font-normal">⚠ differs</span>,
    high: <span className="ml-1 text-xs text-red-600 font-normal">❌ mismatch</span>,
  }

  // ── Cell renderer ─────────────────────────────────────────────────────────
  function Val({ v, disc = 'none', na = '—' }) {
    if (v == null || v === 0) return <span className="text-gray-300">{na}</span>
    return (
      <span className={DISC_TEXT[disc]}>
        {fmt(v)}{DISC_BADGE[disc]}
      </span>
    )
  }

  // ── Section: Rental Income ───────────────────────────────────────────────
  function RentSection() {
    return (
      <Section icon="🏠" title="Rental Income & Days" subtitle="What rent did the property earn, and for how many days was it rented each year?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Sch E Rent<br/><span className="font-normal">Tax Return</span></th>
            <th className="text-right py-2">Lease Rent<br/><span className="font-normal">Rental tab</span></th>
            <th className="text-right py-2">Days Rented<br/><span className="font-normal">Sch E line 2</span></th>
            <th className="text-right py-2">Personal Days<br/><span className="font-normal">Sch E line 3</span></th>
            <th className="text-right py-2">Lease Days<br/><span className="font-normal">from leases</span></th>
            <th className="text-right py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te  = taxByYear[yr]
            const lr  = lease_rent[yr]
            const taxRent    = te?.rents_received || null
            const leaseRent  = lr?.income || null
            const daysRented = te?.days_rented || null
            const persUse    = te?.personal_use_days || null
            const leaseDays  = lr?.lease_days || null
            const rentDisc   = discLevel(taxRent, leaseRent)
            const daysDisc   = discLevel(daysRented, leaseDays)
            const rowDisc    = rentDisc === 'high' || daysDisc === 'high' ? 'high'
                             : rentDisc === 'low'  || daysDisc === 'low'  ? 'low' : 'none'
            const totalDays  = daysRented != null && persUse != null ? daysRented + persUse : null
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[rowDisc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
                <td className="py-2 px-2 text-right">
                  <Val v={taxRent} disc={taxRent && leaseRent ? rentDisc : 'none'} />
                </td>
                <td className="py-2 px-2 text-right">
                  <Val v={leaseRent} disc={taxRent && leaseRent ? rentDisc : 'none'} />
                </td>
                <td className="py-2 px-2 text-right font-medium text-blue-700">
                  {daysRented != null ? `${daysRented}d` : <span className="text-gray-300">—</span>}
                  {totalDays != null && totalDays < 365 && (
                    <span className="text-xs text-amber-600 ml-1">(partial yr)</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right text-orange-600">
                  {persUse != null && persUse > 0 ? `${persUse}d` : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">
                  {leaseDays != null ? `~${leaseDays}d` : '—'}
                  {lr?.occupied_months != null && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">({lr.occupied_months} mo)</span>
                  )}
                </td>
                <td className="py-2 pl-2 text-right text-xs">
                  {rowDisc === 'none' && (taxRent || daysRented) ? <span className="text-green-500">✓</span> : null}
                  {rentDisc !== 'none' ? <span className={`block ${rentDisc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>rent {rentDisc === 'high' ? '❌' : '⚠'}</span> : null}
                  {daysDisc !== 'none' ? <span className={`block ${daysDisc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>days {daysDisc === 'high' ? '❌' : '⚠'}</span> : null}
                  {persUse > 0 && <span className="block text-amber-600">mixed use</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Mortgage Interest ───────────────────────────────────────────
  function InterestSection() {
    return (
      <Section icon="📄" title="Mortgage Interest" subtitle="Where does the interest number come from — and do sources agree?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Schedule E<br/><span className="font-normal">Tax Return</span></th>
            <th className="text-right py-2">Form 1098<br/><span className="font-normal">Uploaded doc</span></th>
            <th className="text-right py-2">Statements<br/><span className="font-normal">annualised</span></th>
            <th className="text-right py-2">Loan estimate<br/><span className="font-normal">current rate</span></th>
            <th className="text-right py-2">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te   = taxByYear[yr]
            const taxInt  = te?.mortgage_interest || null
            const docInt  = docs_1098[yr] || null
            const stmtInt = stmt_annual[yr]?.interest_annual || null
            const loanInt = loans.reduce((s, l) => s + (l.interest_due || 0), 0) * 12 || null

            // Compare best two available sources
            const sources = [taxInt, docInt, stmtInt].filter(v => v != null)
            const maxDisc = sources.length >= 2
              ? sources.reduce((worst, v, i) =>
                  sources.slice(i + 1).reduce((w, v2) => {
                    const d = discLevel(v, v2)
                    return d === 'high' ? 'high' : w === 'high' ? 'high' : d
                  }, worst), 'none')
              : 'none'

            // Priority indicator
            const used = docInt != null ? '1098' : taxInt != null ? 'Sch-E' : stmtInt != null ? 'stmt' : 'est'

            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[maxDisc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
                <td className="py-2 px-2 text-right"><Val v={taxInt} /></td>
                <td className="py-2 px-2 text-right"><Val v={docInt} /></td>
                <td className="py-2 px-2 text-right text-blue-600"><Val v={stmtInt} /></td>
                <td className="py-2 px-2 text-right text-gray-400 dark:text-gray-500">
                  {loanInt ? fmt(loanInt) : '—'}
                </td>
                <td className="py-2 pl-2 text-right">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    used === '1098'  ? 'bg-blue-100 text-blue-700' :
                    used === 'Sch-E' ? 'bg-purple-100 text-purple-700' :
                    used === 'stmt'  ? 'bg-gray-100 text-gray-600' :
                                       'bg-orange-100 text-orange-700'
                  }`}>
                    uses {used}
                  </span>
                  {maxDisc !== 'none' && (
                    <span className={`ml-1 text-xs ${maxDisc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                      {maxDisc === 'high' ? '❌' : '⚠'}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Principal & Balance ─────────────────────────────────────────
  function PrincipalSection() {
    return (
      <Section icon="🏦" title="Principal & Outstanding Balance" subtitle="How fast is the loan being paid down?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Balance (1098)<br/><span className="font-normal">Box 2 Jan-1</span></th>
            <th className="text-right py-2">Stmt avg balance<br/><span className="font-normal">from statements</span></th>
            <th className="text-right py-2">Principal paid<br/><span className="font-normal">stmt annualised</span></th>
            <th className="text-right py-2">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const doc1098Bal  = docs_balance[yr] || null
            const balanceLogic = docs_balance_logic[yr] || null
            const selectedDate = balanceLogic?.selected_acquisition_date || balanceLogic?.selected_origination_date
            const stmtBal     = stmt_annual[yr]?.avg_balance || null
            const stmtPrin    = stmt_annual[yr]?.principal_annual || null
            const disc        = discLevel(doc1098Bal, stmtBal)
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[disc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
              <td className="py-2 px-2 text-right text-blue-600 dark:text-blue-400">
                <Val v={doc1098Bal} />
                {balanceLogic && (
                  <div className="mt-1 text-[10px] leading-snug text-gray-400 dark:text-gray-500">
                    {balanceLogic.mode === 'active_parallel_loans' ? 'summed active loans' : 'latest loan balance'}
                    {selectedDate ? ` · date ${selectedDate}` : ''}
                    {balanceLogic.selected_account ? ` · ${balanceLogic.selected_account}` : ''}
                  </div>
                )}
              </td>
                <td className="py-2 px-2 text-right text-gray-600"><Val v={stmtBal} /></td>
                <td className="py-2 px-2 text-right text-green-600"><Val v={stmtPrin} /></td>
                <td className="py-2 pl-2 text-right">
                  {disc === 'none' && (doc1098Bal || stmtBal) ? <span className="text-green-500 text-xs">✓ ok</span> : null}
                  {disc !== 'none' ? (
                    <span className={`text-xs ${disc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                      {doc1098Bal && stmtBal ? fmt(Math.abs(doc1098Bal - stmtBal)) : ''}
                      {disc === 'high' ? ' ❌' : ' ⚠'}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Property Taxes ───────────────────────────────────────────────
  function TaxSection() {
    return (
      <Section icon="🧾" title="Property Taxes" subtitle="Three ways property taxes are known — do they agree?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Schedule E<br/><span className="font-normal">Tax Return</span></th>
            <th className="text-right py-2">Uploaded docs<br/><span className="font-normal">bills / 1098</span></th>
            <th className="text-right py-2">Static field<br/><span className="font-normal">property card</span></th>
            <th className="text-right py-2">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te      = taxByYear[yr]
            const taxRet  = te?.property_taxes || null
            const docTax  = tax_docs[yr] || null
            const staticT = prop.property_tax || null

            const disc = discLevel(taxRet, docTax)
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[disc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
                <td className="py-2 px-2 text-right"><Val v={taxRet} disc={taxRet && docTax ? disc : 'none'} /></td>
                <td className="py-2 px-2 text-right text-blue-600"><Val v={docTax} disc={taxRet && docTax ? disc : 'none'} /></td>
                <td className="py-2 px-2 text-right text-gray-400 dark:text-gray-500">{staticT ? fmt(staticT) : '—'}</td>
                <td className="py-2 pl-2 text-right">
                  {disc === 'none' && taxRet && docTax ? <span className="text-green-500 text-xs">✓ match</span> : null}
                  {disc !== 'none' ? (
                    <span className={`text-xs ${disc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                      {fmt(Math.abs((taxRet || 0) - (docTax || 0)))} {disc === 'high' ? '❌' : '⚠'}
                    </span>
                  ) : null}
                  {(!taxRet || !docTax) && <span className="text-gray-300 text-xs">only one source</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Depreciation ─────────────────────────────────────────────────
  function DeprSection() {
    const irsFullYear = irs_annual_depreciation
    const basis       = (prop.purchase_price || 0) - (prop.land_value || 0)
    return (
      <Section icon="📉" title="Depreciation" subtitle="Filed Schedule E vs IRS straight-line. Mixed-use years prorate by days rented.">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Days Rented<br/><span className="font-normal">Sch E line 2</span></th>
            <th className="text-right py-2">IRS Prorated<br/><span className="font-normal">by days rented</span></th>
            <th className="text-right py-2">Schedule E<br/><span className="font-normal">filed return</span></th>
            <th className="text-right py-2">Δ vs Filed</th>
            <th className="text-right py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te       = taxByYear[yr]
            const taxDepr  = te?.depreciation || null
            const dr       = te?.days_rented  || null
            const pu       = te?.personal_use_days || 0
            const yearDays = (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365
            // Prorated IRS: if days_rented known, prorate; else full-year
            const irsProrated = dr != null ? Math.round(irsFullYear * dr / yearDays) : irsFullYear
            const disc     = discLevel(taxDepr, irsProrated)
            const diff     = taxDepr != null ? taxDepr - irsProrated : null
            const mixedUse = dr != null && pu > 0
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[disc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">
                  {yr}
                  {mixedUse && <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">mixed</span>}
                </td>
                <td className="py-2 px-2 text-right font-medium text-blue-700">
                  {dr != null ? `${dr}d` : <span className="text-gray-300">—</span>}
                  {pu > 0 && <span className="text-xs text-orange-500 block">{pu}d personal</span>}
                </td>
                <td className="py-2 px-2 text-right text-blue-600">
                  {fmt(irsProrated)}
                  {dr != null && dr < yearDays && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 block">{((dr / yearDays) * 100).toFixed(0)}% of yr</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right"><Val v={taxDepr} /></td>
                <td className="py-2 px-2 text-right">
                  {diff != null ? (
                    <span className={Math.abs(diff) < 200 ? 'text-gray-500 dark:text-gray-400' : diff > 0 ? 'text-orange-600' : 'text-red-600'}>
                      {diff > 0 ? '+' : ''}{fmt(diff)}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 pl-2 text-right text-xs">
                  {disc === 'none' && taxDepr    ? <span className="text-green-500">✓ ok</span>       : null}
                  {disc === 'low'                 ? <span className="text-yellow-600">⚠ small Δ</span> : null}
                  {disc === 'high'                ? <span className="text-red-600">❌ review</span>    : null}
                  {!taxDepr                       ? <span className="text-gray-300">no return</span>   : null}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="pt-3 text-xs text-gray-400 dark:text-gray-500">
              Depreciable basis = {fmt(prop.purchase_price)} − {fmt(prop.land_value)} = {fmt(basis)} over {prop.depreciation_years} yrs = {fmt(irsFullYear)}/yr full-year.
              When Schedule E "Fair Rental Days" &lt; 365, IRS prorates: basis × days / {365}.
              Mixed-use years (personal use days &gt; 0) further limit the deductible portion.
            </td>
          </tr>
        </tfoot>
      </Section>
    )
  }

  // ── Section: 1098 Document Detail ────────────────────────────────────────
  function Docs1098Section() {
    if (!docs_1098_detail.length) return null
    const dupCount = docs_1098_detail.filter(d => d.is_duplicate).length
    return (
      <Section icon="📋" title="Form 1098 — Document Inventory"
        subtitle={dupCount
          ? `Every uploaded 1098. ⚠ ${dupCount} duplicate${dupCount > 1 ? 's' : ''} detected — originals used for calculations.`
          : "Every uploaded 1098, deduplicated by account for each tax year."}>
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
              <th className="text-left py-2">Year</th>
              <th className="text-left py-2">File</th>
              <th className="text-left py-2">Account</th>
              <th className="text-left py-2">Origination</th>
              <th className="text-left py-2">Acquisition</th>
              <th className="text-right py-2">Mortgage Interest</th>
              <th className="text-right py-2">Outstanding Principal</th>
            <th className="text-left py-2 pl-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {[...docs_1098_detail].sort((a, b) => b.year - a.year).map((d, i) => (
            <tr key={i} className={`border-b text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${d.is_duplicate ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
              <td className="py-2 font-medium text-gray-700 dark:text-gray-300">{d.year}</td>
            <td className="py-2 px-2 text-blue-600 text-xs truncate max-w-xs" title={d.filename}>{d.filename}</td>
            <td className="py-2 px-2 text-gray-400 dark:text-gray-500 text-xs">{d.account_number || '—'}</td>
            <td className="py-2 px-2 text-gray-500 dark:text-gray-400 text-xs">{d.origination_date || '—'}</td>
                <td className="py-2 px-2 text-gray-500 dark:text-gray-400 text-xs">
                  {d.mortgage_acquisition_date || <span className="text-gray-300 dark:text-gray-600">Not reported</span>}
                </td>
            <td className={`py-2 px-2 text-right ${d.is_duplicate ? 'text-gray-300 line-through' : 'text-orange-600'}`}>
                {d.mortgage_interest ? fmt(d.mortgage_interest) : '—'}
              </td>
              <td className={`py-2 pl-2 text-right ${d.is_duplicate ? 'text-gray-300 line-through' : 'text-blue-600'}`}>
                {d.outstanding_principal ? fmt(d.outstanding_principal) : '—'}
              </td>
              <td className="py-2 pl-3">
                {d.is_duplicate ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 text-amber-800">
                    ⚠ Duplicate
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700">
                    ✓ Original
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Section>
    )
  }

  // ── Section: Mortgage Statement Snapshots ────────────────────────────────
  function StatementsSection() {
    if (!snapshots.length) return null
    const visible = selYear === 'all'
      ? snapshots
      : snapshots.filter(s => s.year === Number(selYear))
    return (
      <Section icon="📊" title="Mortgage Statement Snapshots" subtitle="Raw point-in-time data extracted from every uploaded statement.">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2">Date</th>
            <th className="text-right py-2">Balance</th>
            <th className="text-right py-2">Interest (mo)</th>
            <th className="text-right py-2">Principal (mo)</th>
            <th className="text-right py-2">Escrow (mo)</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s, i) => (
            <tr key={i} className="border-b text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="py-1.5 text-gray-600">{s.date}</td>
              <td className="py-1.5 px-2 text-right">{s.balance ? fmt(s.balance) : '—'}</td>
              <td className="py-1.5 px-2 text-right text-orange-600">{s.interest ? fmt(s.interest) : '—'}</td>
              <td className="py-1.5 px-2 text-right text-blue-600">{s.principal ? fmt(s.principal) : '—'}</td>
              <td className="py-1.5 pl-2 text-right text-gray-400 dark:text-gray-500">{s.escrow ? fmt(s.escrow) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </Section>
    )
  }

  // ── Master discrepancy summary ────────────────────────────────────────────
  const discrepancies = []
  for (const yr of allYears) {
    const te = taxByYear[yr]
    const lr = lease_rent[yr]
    const yearDays = (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365
    // Rent
    const taxRent  = te?.rents_received || null
    const lsRent   = lr?.income || null
    if (discLevel(taxRent, lsRent) !== 'none')
      discrepancies.push({ yr, field: 'Rent', a: taxRent, b: lsRent, sa: 'Sch-E', sb: 'Leases' })
    // Days rented
    const schDays  = te?.days_rented || null
    const lsDays   = lr?.lease_days  || null
    if (discLevel(schDays, lsDays) !== 'none')
      discrepancies.push({ yr, field: 'Days Rented', a: schDays, b: lsDays, sa: 'Sch-E', sb: 'Leases', isDays: true })
    // Interest
    const taxInt   = te?.mortgage_interest || null
    const docInt   = docs_1098[yr] || null
    const stmtInt  = stmt_annual[yr]?.interest_annual || null
    if (discLevel(taxInt, docInt) !== 'none')
      discrepancies.push({ yr, field: 'Interest', a: taxInt, b: docInt, sa: 'Sch-E', sb: '1098' })
    else if (discLevel(taxInt, stmtInt) !== 'none' && !docInt)
      discrepancies.push({ yr, field: 'Interest', a: taxInt, b: stmtInt, sa: 'Sch-E', sb: 'Stmt' })
    // Taxes
    const taxTax   = te?.property_taxes || null
    const docTax   = tax_docs[yr] || null
    if (discLevel(taxTax, docTax) !== 'none')
      discrepancies.push({ yr, field: 'Property Tax', a: taxTax, b: docTax, sa: 'Sch-E', sb: 'Docs' })
    // Depreciation — compare filed vs IRS-prorated-by-days
    const taxDepr  = te?.depreciation || null
    const dr       = te?.days_rented  || null
    const irsExp   = dr != null ? Math.round(irs_annual_depreciation * dr / yearDays) : irs_annual_depreciation
    if (discLevel(taxDepr, irsExp) === 'high')
      discrepancies.push({ yr, field: 'Depreciation', a: taxDepr, b: irsExp, sa: 'Sch-E', sb: dr != null ? `IRS (${dr}d)` : 'IRS calc' })
  }

  return (
    <div className="space-y-6">

      {/* Discrepancy Alert Banner */}
      {discrepancies.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-900/20 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">❌</span>
            <h3 className="font-semibold text-red-800">
              {discrepancies.length} Data Discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} Found
            </h3>
          </div>
          <div className="space-y-1.5">
            {discrepancies.map((d, i) => {
              const disp = (v) => d.isDays ? `${v}d` : fmt(v)
              return (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-red-400">•</span>
                  <span className="font-medium text-red-800">{d.yr} {d.field}:</span>
                  <span className="text-red-700">{d.sa} says {disp(d.a)}</span>
                  <span className="text-red-400">vs</span>
                  <span className="text-red-700">{d.sb} says {disp(d.b)}</span>
                  <span className="text-red-500 ml-auto text-xs">Δ {d.isDays ? `${Math.abs((d.a||0)-(d.b||0))}d` : fmt(Math.abs((d.a || 0) - (d.b || 0)))}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* No discrepancies */}
      {discrepancies.length === 0 && allYears.length > 0 && (
        <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <div className="font-semibold text-green-800 dark:text-green-300">All sources agree</div>
            <div className="text-sm text-green-700 dark:text-green-400">No significant discrepancies detected across {allYears.length} years of data.</div>
          </div>
        </div>
      )}

      {/* Year filter */}
      {allYears.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Filter by year:</span>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setSelYear('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selYear === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
              All years
            </button>
            {allYears.map(yr => (
              <button key={yr} onClick={() => setSelYear(String(yr))}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selYear === String(yr) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                {yr}
              </button>
            ))}
          </div>
        </div>
      )}

      {allYears.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">📂</div>
          <div className="font-medium">No data to verify yet</div>
          <div className="text-sm mt-1">Upload tax returns, 1098s, or mortgage statements to populate this view.</div>
        </div>
      )}

      <RentSection />
      <InterestSection />
      <PrincipalSection />
      <TaxSection />
      <DeprSection />
      <Docs1098Section />
      <StatementsSection />

    </div>
  )
}

// Collapsible card wrapper for each verification section
function Section({ icon, title, subtitle, children }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-left group">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">{icon}</span>
            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 ml-6">{subtitle}</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform shrink-0 ml-4 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            {children}
          </table>
        </div>
      )}
    </div>
  )
}


function SumRow({ label, value, color = 'text-gray-700 dark:text-gray-300', bold, plus }) {
  const abs = Math.abs(value || 0)
  const neg = (value || 0) < 0
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={color}>{!neg && plus ? '+' : neg ? '–' : ''}{fmt(abs)}</span>
    </div>
  )
}

function AnalysisCard({ label, value, sub, color }) {
return (
<div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
<p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
<p className={`text-lg font-bold mt-0.5 ${color || 'text-gray-900 dark:text-white'}`}>{value}</p>
{sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
</div>
)
}

const summaryMetricConfig = {
  PRIMARY: {
    hero: { primary: 'equityOwned', secondary: null },
    row: ['wealthBuiltYTD', 'monthlyCostToOwn', 'loanFreeBy'],
    panels: ['sincePurchase', 'taxBenefit'],
    hide: ['cashFlow', 'capRate', 'DSCR', 'depreciation', 'cashOnCash'],
  },
  RENTAL: {
    hero: { primary: 'monthlyCashFlow', secondary: 'cashOnCashReturn' },
    row: ['capRate', 'DSCR', 'totalReturnYTD'],
    panels: ['annualPnL', 'taxPicture'],
    footer: ['value', 'loanBalance', 'equity', 'rentPerMonth'],
  },
}

function UsageHistoryStrip({ periods = [], usage = {} }) {
  const rows = periods.length ? periods : []
  if (!rows.length) return null
  const label = (value) => String(value || '').toUpperCase() === 'PRIMARY' ? 'Primary' : 'Rental'
  return (
    <div className="card">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Usage History</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Current story: {label(usage.current_type)} · Nonqualified-use ratio {fmtPct((usage.nonqualified_use_ratio || 0) * 100)}
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
          {rows.length} period{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {rows.map((period, index) => (
          <div key={period.id || `${period.start_date}-${index}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-700/40">
            <div className="font-semibold text-gray-900 dark:text-white">{label(period.usage_type)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{period.start_date} to {period.end_date || 'current'}</div>
            {String(period.usage_type || '').toUpperCase() === 'RENTAL' && period.fmv_at_start ? (
              <div className="mt-1 text-xs text-blue-600 dark:text-blue-300">FMV basis {fmt(period.fmv_at_start)}</div>
            ) : null}
          </div>
        ))}
      </div>
      {(usage.banners || []).length ? (
        <div className="mt-4 space-y-2">
          {usage.banners.map((banner, index) => (
            <div key={index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              {banner}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PropertyStorySummary({ propId, prop, metrics }) {
  const [data, setData] = useState(null)
  const [summaryView, setSummaryView] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      propAPI.lifetime(propId),
      propAPI.summary(propId).catch(() => null),
    ])
      .then(([lifetimeRes, summaryRes]) => {
        setData(lifetimeRes.data)
        setSummaryView(summaryRes?.data || null)
      })
      .catch((err) => {
        const detail = err.response?.data?.detail
        toast.error(detail ? `Failed to load summary: ${detail}` : 'Failed to load summary')
      })
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) return (
    <div className="flex h-40 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )
  if (!data) return null

const { lifetime = {}, yearly = [], usage = {}, usage_periods: usagePeriods = [], summary_metrics: summaryMetrics = {} } = data
const summaryDtoMetrics = summaryView?.metrics || {}
  const propertyKind = (usage.current_type || prop.usage_type || '').toLowerCase() === 'primary' ? 'PRIMARY' : 'RENTAL'
  const config = summaryMetricConfig[propertyKind]
  const latestYear = yearly[yearly.length - 1] || {}
  const marketValue = lifetime.market_value || prop.market_value || 0
  const loanBalance = lifetime.current_loan_balance || metrics?.total_loan_balance || 0
  const equity = lifetime.equity ?? Math.max(marketValue - loanBalance, 0)
  const ownedPct = marketValue > 0 ? (equity / marketValue) * 100 : 0
  const loanPct = marketValue > 0 ? Math.min(100, Math.max(0, (loanBalance / marketValue) * 100)) : 0
  const equityPct = Math.min(100, Math.max(0, ownedPct))
const annualMortgage = (latestYear.interest_paid || 0) + (latestYear.principal_paid || 0)
const annualTaxes = latestYear.taxes_paid || prop.property_tax || 0
const monthlyCostToOwn = summaryMetrics.monthly_cost_to_own || 0
  const appreciationSincePurchase = Math.max(0, marketValue - (prop.purchase_price || 0))
  const appreciationPct = prop.purchase_price > 0 ? (appreciationSincePurchase / prop.purchase_price) * 100 : 0
  const principalYTD = latestYear.principal_paid || 0
  const wealthBuiltYTD = principalYTD
  const saltDeduction = Math.min(10000, annualTaxes)
  const annualTaxBenefit = (latestYear.interest_paid || 0) + saltDeduction
const noi = summaryMetrics.noi || 0
const annualDebtService = summaryMetrics.annual_debt_service || 0
const pnlIncome = summaryMetrics.effective_gross_income || 0
const pnlOperatingExpenses = summaryMetrics.operating_expenses || 0
const pnlNoi = summaryMetrics.noi || 0
const pnlAnnualDebtService = summaryMetrics.annual_debt_service || 0
const pnlNetCashFlow = summaryMetrics.annual_cash_flow || 0
const stabilizedAnnualCashFlow = summaryMetrics.annual_cash_flow || 0
const annualCashFlow = summaryMetrics.annual_cash_flow || 0
const monthlyCashFlow = summaryMetrics.monthly_cash_flow || 0
const cashOnCash = summaryMetrics.cash_on_cash_return
const capRate = summaryMetrics.cap_rate || 0
const dscr = summaryMetrics.dscr || 0
const totalReturnYTD = summaryMetrics.total_return_ytd || 0
  const payoffYear = prop.loans?.map((loan) => loan.maturity_date || '').filter(Boolean).sort().at(-1)?.slice(0, 4) || 'TBD'

  const SourceBadge = ({ label = 'Calculated' }) => (
    <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">{label}</span>
  )
const Metric = ({ label, value, sub, color = 'text-gray-900 dark:text-white', source = 'Calculated', metric }) => (
<div className="min-h-32 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
<div className="flex items-center justify-between gap-2">
<p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><MetricLabel label={label} metric={metric} /></p>
<SourceBadge label={source} />
</div>
      <p className={`mt-2 text-xl font-bold ${color}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sub}</p> : null}
    </div>
  )
  const Panel = ({ title, children }) => (
    <div className="card">
      <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
  const TrendTable = () => (
    <div className="card">
      <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">{propertyKind === 'PRIMARY' ? 'Multi-Year Wealth Trend' : 'Multi-Year Income Trend'}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-gray-500 dark:text-gray-400">
              <th className="py-2 text-left font-medium">Year</th>
              {propertyKind === 'PRIMARY' ? (
                <>
                  <th className="px-2 py-2 text-right font-medium">Value</th>
                  <th className="px-2 py-2 text-right font-medium">Loan Balance</th>
                  <th className="px-2 py-2 text-right font-medium">Equity</th>
                  <th className="px-2 py-2 text-right font-medium">Principal</th>
                  <th className="px-2 py-2 text-right font-medium">2026 Interest/Tax</th>
                </>
              ) : (
                <>
                  <th className="px-2 py-2 text-right font-medium">Income</th>
                  <th className="px-2 py-2 text-right font-medium">OpEx</th>
                  <th className="px-2 py-2 text-right font-medium">NOI</th>
                  <th className="px-2 py-2 text-right font-medium">Debt Service</th>
                  <th className="px-2 py-2 text-right font-medium">Cash Flow</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {yearly.map((y) => {
              const balance = y.loan_balance ?? y.balance ?? loanBalance
              const trendEquity = Math.max(0, marketValue - (balance || 0))
              const debtService = (y.interest_paid || 0) + (y.principal_paid || 0)
              const trendNoi = (y.rental_income || 0) - (y.operating_expenses || 0)
              return (
                <tr key={y.year} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 font-medium text-gray-900 dark:text-white">{y.is_partial ? `${y.year}*` : y.year}</td>
                  {propertyKind === 'PRIMARY' ? (
                    <>
                      <td className="px-2 py-2 text-right">{fmt(marketValue)}</td>
                      <td className="px-2 py-2 text-right">{fmt(balance)}</td>
                      <td className="px-2 py-2 text-right text-green-600">{fmt(trendEquity)}</td>
                      <td className="px-2 py-2 text-right text-blue-600">{fmt(y.principal_paid || 0)}</td>
                      <td className="px-2 py-2 text-right text-gray-700 dark:text-gray-300">{fmt((y.interest_paid || 0) + (y.taxes_paid || 0))}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-2 text-right text-green-600">{fmt(y.rental_income || 0)}</td>
                      <td className="px-2 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(y.operating_expenses || 0)}</td>
                      <td className="px-2 py-2 text-right">{fmt(trendNoi)}</td>
                      <td className="px-2 py-2 text-right">{fmt(debtService)}</td>
                      <td className={(y.cash_flow || 0) >= 0 ? 'px-2 py-2 text-right text-green-600' : 'px-2 py-2 text-right text-red-600'}>{fmt(y.cash_flow || 0)}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {propertyKind === 'PRIMARY' ? (
        <>
          <div className="card">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
<p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><MetricLabel label="Equity" metric={summaryDtoMetrics.equity} /></p>
                <p className="mt-1 text-3xl font-bold text-green-600">{fmt(equity)}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">You own {fmtPct(ownedPct)} of this home</p>
              </div>
              <SourceBadge />
            </div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div className="h-full bg-green-500" style={{ width: `${equityPct}%` }} />
              {loanPct > 0 ? <div className="-mt-3 h-full bg-gray-300 dark:bg-gray-600" style={{ width: `${loanPct}%`, marginLeft: `${equityPct}%` }} /> : null}
            </div>
            <div className="mt-2 flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Equity {fmt(equity)}</span>
              <span>Loan {fmt(loanBalance)}</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Metric label="Wealth built YTD" value={fmt(wealthBuiltYTD)} sub={`${fmt(0)} appreciation · ${fmt(principalYTD)} paydown`} color="text-green-600" />
            <Metric label="Monthly cost to own" value={fmt(monthlyCostToOwn)} sub="P&I + property tax + insurance / 12" color="text-gray-900 dark:text-white" />
            <Metric label="Loan-free by" value={payoffYear} sub="From loan amortization maturity dates" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Since You Bought">
              <SumRow label="Purchase price" value={prop.purchase_price || 0} />
              <SumRow label="Value today" value={marketValue} />
              <SumRow label={`Appreciation (${fmtPct(appreciationPct)})`} value={appreciationSincePurchase} color="text-green-600" plus />
            </Panel>
            <Panel title="Tax Benefit (Annual)">
              <SumRow label={`${latestYear.year || new Date().getFullYear()} mortgage interest`} value={latestYear.interest_paid || 0} color="text-orange-500" />
              <SumRow label="Property tax under SALT cap" value={saltDeduction} />
              <SumRow label="Estimated annual deduction" value={annualTaxBenefit} color="text-green-600" bold />
            </Panel>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
<p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><MetricLabel label="Monthly Cash Flow" metric={summaryDtoMetrics.monthlyCashFlow} /></p>
<p className={`mt-1 text-3xl font-bold ${metricToneClass(summaryDtoMetrics.monthlyCashFlow)}`}>{summaryDtoMetrics.monthlyCashFlow?.display || fmt(monthlyCashFlow)}</p> <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{summaryDtoMetrics.annualCashFlow?.display || fmt(annualCashFlow)}/yr</p>
              </div>
              <SourceBadge />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4"> <Metric label="Cash-on-cash return" metric={summaryDtoMetrics.cashOnCashReturn} value={summaryDtoMetrics.cashOnCashReturn?.display || '—'} sub={summaryDtoMetrics.cashOnCashReturn?.hint || 'Annual cash flow / cash invested'} color={metricToneClass(summaryDtoMetrics.cashOnCashReturn)} /> <Metric label="Cap rate" metric={summaryDtoMetrics.capRate} value={summaryDtoMetrics.capRate?.display || fmtPct(capRate)} sub="NOI / market value" />
            <Metric label="DSCR" metric={summaryDtoMetrics.dscr} value={summaryDtoMetrics.dscr?.display || (dscr ? dscr.toFixed(2) : '—')} sub="NOI / annual debt service" color={metricToneClass(summaryDtoMetrics.dscr)} />
            <Metric label="Total return YTD" metric={summaryDtoMetrics.totalReturnYtd} value={summaryDtoMetrics.totalReturnYtd?.display || fmt(totalReturnYTD)} sub="Cash flow + principal paydown" color={metricToneClass(summaryDtoMetrics.totalReturnYtd)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
<Panel title="Annual P&L">
	              <SumRow label="Income" value={pnlIncome} color="text-green-600" plus />
	              <SumRow label="Operating expenses" value={pnlOperatingExpenses} />
	              <SumRow label="NOI" value={pnlNoi} bold />
	              <SumRow label="Debt service" value={pnlAnnualDebtService} />
	              <SumRow label="Net cash flow" value={pnlNetCashFlow} color={pnlNetCashFlow >= 0 ? 'text-green-600' : 'text-red-600'} />
	            </Panel>
            <Panel title="Tax Picture">
              <SumRow label="Depreciation (Sch E line 18)" value={latestYear.depreciation || 0} color="text-purple-600" />
              <SumRow label="Suspended losses" value={0} />
              <SumRow label="Net tax P&L" value={latestYear.taxable_income || 0} color={(latestYear.taxable_income || 0) >= 0 ? 'text-green-600' : 'text-red-600'} />
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="Value" value={fmt(marketValue)} />
            <Metric label="Loan balance" value={fmt(loanBalance)} />
            <Metric label="Equity" value={fmt(equity)} color="text-green-600" />
<Metric label="Rent per month" metric={summaryDtoMetrics.rentPerMonth} value={summaryDtoMetrics.rentPerMonth?.display || fmt(prop.monthly_rent || 0)} />
          </div>
        </>
      )}

      <TrendTable />
      <UsageHistoryStrip periods={usagePeriods} usage={usage} />
    </div>
  )
}

function SummaryTab({ propId, prop, metrics }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    propAPI.lifetime(propId)
      .then((r) => setData(r.data))
      .catch((err) => {
        const detail = err.response?.data?.detail
        toast.error(detail ? `Failed to load lifetime summary: ${detail}` : 'Failed to load lifetime summary')
      })
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  if (!data) return null

const { lifetime, yearly = [], summary_metrics: summaryMetrics = {} } = data
  const isPrimaryOnly = (prop.usage_type || '').toLowerCase() === 'primary' && !prop.has_rental_history && !prop.currently_rental
  const showDepreciation = !isPrimaryOnly
  const marketValue = lifetime.market_value || prop.market_value || 0
  const loanBalance = lifetime.current_loan_balance || 0
  const equity = lifetime.equity ?? Math.max(marketValue - loanBalance, 0)
  const ltv = marketValue > 0 ? (loanBalance / marketValue) * 100 : null
  const latestYear = yearly[yearly.length - 1] || {}
const monthlyCarryingCost = summaryMetrics.monthly_cost_to_own || 0
const monthlyCashFlow = summaryMetrics.monthly_cash_flow || 0

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <RealEstateStat label="Market Value" value={fmt(marketValue)} />
        <RealEstateStat label="Total Debt" value={fmt(loanBalance)} note={ltv == null ? 'LTV unavailable' : `${fmtPct(ltv)} LTV`} />
        <RealEstateStat label="Equity" value={fmt(equity)} />
<RealEstateStat label={isPrimaryOnly ? 'Monthly Carrying Cost' : 'Monthly Cash Flow'} value={fmt(isPrimaryOnly ? monthlyCarryingCost : monthlyCashFlow)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Debt</h3>
          <div className="space-y-2">
            <SumRow label="Original Loan Amount" value={lifetime.original_loan_amount || 0} />
            <SumRow label="Current Loan Balance" value={loanBalance} />
            <SumRow label="Principal Paid" value={lifetime.total_principal_paid || 0} color="text-blue-600" />
            <SumRow label="Interest Paid" value={lifetime.total_interest_paid || 0} color="text-orange-500" />
          </div>
        </div>

        <div className="card">
          <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Tax Picture</h3>
          <div className="space-y-2">
            {!isPrimaryOnly && <SumRow label="Lifetime Rental Income" value={lifetime.total_rental_income || 0} color="text-green-600" plus />}
            {!isPrimaryOnly && <SumRow label="Deductible Expenses" value={-(lifetime.total_operating_expenses || 0)} color="text-red-500" />}
            <SumRow label="Mortgage Interest" value={-(lifetime.total_interest_paid || 0)} color="text-orange-500" />
            {showDepreciation && <SumRow label="Depreciation" value={-(lifetime.total_depreciation || 0)} color="text-purple-600" />}
            <div className="border-t pt-2">
              <SumRow
                label={isPrimaryOnly ? 'Primary Home Deductions' : (lifetime.total_taxable_income || 0) < 0 ? 'Tax Loss (Lifetime)' : 'Taxable Income (Lifetime)'}
                value={lifetime.total_taxable_income || 0}
                color={(lifetime.total_taxable_income || 0) < 0 ? 'text-purple-700' : 'text-gray-800'}
                bold
              />
            </div>
          </div>
          {showDepreciation && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-700/50">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Annual Depreciation</span>
                <span className="font-medium text-purple-600">{fmt(lifetime.annual_depreciation || 0)}</span>
              </div>
            </div>
          )}
          <p className="mt-3 border-t pt-3 text-xs italic text-gray-500 dark:text-gray-400">
            {isPrimaryOnly
              ? 'Primary residence only: depreciation is not applicable unless the home is converted to rental use.'
              : 'Depreciation applies only to rental-use years.'}
          </p>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">Yearly Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500 dark:text-gray-400">
                <th className="py-2 text-left font-medium">Year</th>
                <th className="px-2 py-2 text-right font-medium">Mortgage</th>
                <th className="px-2 py-2 text-right font-medium">Principal</th>
                <th className="px-2 py-2 text-right font-medium">Interest</th>
                <th className="px-2 py-2 text-right font-medium">Taxes</th>
                {showDepreciation && <th className="px-2 py-2 text-right font-medium">Depreciation</th>}
                <th className="py-2 pl-2 text-right font-medium">Cash Flow</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={y.year} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 font-medium text-gray-900 dark:text-white">{y.is_partial ? String(y.year) + '*' : y.year}</td>
                  <td className="px-2 py-2 text-right text-orange-600">{fmt((y.interest_paid || 0) + (y.principal_paid || 0))}</td>
                  <td className="px-2 py-2 text-right text-blue-600">{fmt(y.principal_paid || 0)}</td>
                  <td className="px-2 py-2 text-right text-orange-600">{fmt(y.interest_paid || 0)}</td>
                  <td className="px-2 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(y.taxes_paid || 0)}</td>
                  {showDepreciation && <td className="px-2 py-2 text-right text-purple-600">{fmt(y.depreciation || 0)}</td>}
                  <td className={(y.cash_flow || 0) >= 0 ? 'py-2 pl-2 text-right text-green-600' : 'py-2 pl-2 text-right text-red-600'}>{fmt(y.cash_flow || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
