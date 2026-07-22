import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom'
import { propAPI, docAPI } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceArea, BarChart, Bar, Legend
} from 'recharts'
import {
ChevronLeft, ChevronDown, ChevronRight, Pencil, Trash2, Plus, Upload,
FileText, Building2, Home, X, Download, Info, CheckCircle2, AlertTriangle, PauseCircle, TrendingDown, Lock,
LayoutDashboard, Landmark, KeyRound, ReceiptText, SlidersHorizontal, Files, HeartPulse, ClipboardList, ListChecks, Table2, GitBranch
} from 'lucide-react'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { utils, writeFile } from 'xlsx'
import DocumentUpload from '../components/DocumentUpload'
import DataTable from '../components/DataTable'
import LoanCard from '../components/LoanCard'
import LoanModal from '../components/LoanModal'
import AmortizationModal from '../components/AmortizationModal'
import PageContainer from '../components/PageContainer'
import MetricCard from '../components/metrics/MetricCard'
import MetricKPI from '../components/metrics/MetricKPI'
import RentalPropertySummary, { RentalPropertySummaryHeader } from '../components/RentalPropertySummary'
import PrimaryPropertySummary from '../components/PrimaryPropertySummary'
import { useAuth } from '../hooks/useAuth'
import { propertyTabs } from '../config/propertyTabs'
import { homeTypeLabel } from '../config/propertySetupPresentation'
import { propertyLabel } from '../utils/propertyDisplay'
import { formatChartCurrency, formatCurrency as fmt, formatCurrencyCompact, formatInterestRate, formatMetricCurrency as fmtKMB, formatDate, formatMonthYear, formatNumber, formatPercent as fmtPct, formatYear, formatRatio, rawExportValue } from '../utils/formatters'
import { chartColors, chartTypography } from '../utils/chartTokens'

const CURRENT_YEAR = new Date().getFullYear()
const EXPENSE_FIELDS = [
  { key: 'property_tax', label: 'Property tax / yr' },
  { key: 'insurance', label: 'Insurance / yr' },
  { key: 'hoa', label: 'HOA / yr' },
  { key: 'repairs_maintenance', label: 'Repairs and maintenance / yr' },
  { key: 'property_management', label: 'Property management / yr' },
  { key: 'utilities', label: 'Utilities / yr' },
  { key: 'vacancy_allowance', label: 'Vacancy allowance / yr' },
  { key: 'capex_reserve', label: 'CapEx reserve / yr' },
  { key: 'other', label: 'Other / yr' },
]

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

const PROPERTY_TAB_ICONS = {
  LayoutDashboard,
  Landmark,
  KeyRound,
  ReceiptText,
  TrendingDown,
  SlidersHorizontal,
  Files,
  HeartPulse,
  ClipboardList,
  ListChecks,
  Table2,
}

function PropertyTabIcon({ name }) {
  const Icon = PROPERTY_TAB_ICONS[name] || LayoutDashboard
  return <Icon className="h-4 w-4" aria-hidden="true" />
}

const PROPERTY_TAB_METRICS = {
  summary: [
    { label: 'Market value', key: 'marketValue' },
    { label: 'Equity', key: 'equity' },
    { label: 'Monthly cash flow', key: 'monthlyCashFlow', hideForPrimary: true },
    { label: 'Cost to own', key: 'monthlyCostToOwn' },
  ],
  loans: [
    { label: 'Total loan', key: 'loanTotalOriginal', subLabel: 'original borrowed', display: (metric) => formatCurrencyCompact(metric?.value, { threshold: 100_000, kDigits: 0, mDigits: 1 }) },
    { label: 'Total balance', key: 'loanTotalBalance', subLabel: 'owed today', display: (metric) => formatCurrencyCompact(metric?.value, { threshold: 100_000, kDigits: 1, mDigits: 1 }) },
    { label: 'Paid to date', key: 'loanPrincipalPaidToDate', subLabel: 'principal', display: (metric) => fmt(metric?.value) },
    { label: 'Interest to date', key: 'loanInterestToDate', subLabel: 'paid so far', display: (metric) => fmt(metric?.value) },
    { label: 'Interest', key: 'loanInterestRateSummary', subLabel: '' },
  ],
  rental: [
    { label: 'Monthly rent', key: 'rentPerMonth', hideForPrimary: true },
    { label: 'NOI', key: 'noi', hideForPrimary: true },
    { label: 'Cap rate', key: 'capRate', hideForPrimary: true },
    { label: 'DSCR', key: 'dscr', hideForPrimary: true },
  ],
  taxes: [],
  depreciation: [],
}

function metricDisplayText(metric, fallback = '—') {
  return metric?.displayValue ?? metric?.display ?? metric?.fullDisplayValue ?? metric?.fullDisplay ?? fallback
}

function propertyIsPrimary(prop) {
  const currentUse = String(prop?.current_residency_status || '').toLowerCase()
  if (currentUse.includes('rental')) return false
  if (currentUse.includes('primary')) return true
  const usage = String(prop?.usage_type || prop?.usage || '').toLowerCase()
  return usage.includes('primary') && !prop?.currently_rental
}

function PropertyTabMetrics({ activeTab, metricVault, isPrimary }) {
  const metrics = metricVault?.metrics || {}
  const items = (PROPERTY_TAB_METRICS[activeTab] || [])
    .filter((item) => !(isPrimary && item.hideForPrimary))

  if (!items.length) return null

  const gridClass = items.length === 5
    ? 'lg:grid-cols-5'
    : items.length === 3
      ? 'lg:grid-cols-3'
      : 'lg:grid-cols-4'

  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${gridClass}`} aria-label={`${activeTab} metrics`}>
      {items.map((item) => (
        <MetricKPI
          key={`${activeTab}-${item.label}`}
          label={item.label}
          metric={item.key ? metrics[item.key] : null}
          fallbackValue="—"
          subLabel={item.subLabel}
          displayValue={item.display ? item.display(metrics[item.key]) : undefined}
          backendOwned
        />
      ))}
    </div>
  )
}

function inputNumber(value) {
  if (value === '' || value == null) return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function numberOrEmpty(value) {
  return value === 0 || value ? String(value) : ''
}

function apiErrorMessage(err, fallback = 'Save failed') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || item?.message)
      .filter(Boolean)
      .join(' ') || fallback
  }
  return err?.message || fallback
}

function documentDisplayDate(value) {
  if (!value) return 'now'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function blankAnnualExpense(year = CURRENT_YEAR) {
  return {
    id: null,
    year,
    property_tax: '',
    insurance: '',
    hoa: '',
    repairs_maintenance: '',
    property_management: '',
    utilities: '',
    vacancy_allowance: '',
    capex_reserve: '',
    other: '',
    property_tax_source: 'manual',
    insurance_source: 'manual',
    property_tax_source_label: 'Manual',
    insurance_source_label: 'Manual',
    source_status: 'manual',
    notes: '',
  }
}

function normalizeAnnualExpense(row, year = CURRENT_YEAR) {
  return {
    ...blankAnnualExpense(year),
    ...row,
    year: Number(row?.year || year),
    property_tax: numberOrEmpty(row?.property_tax),
    insurance: numberOrEmpty(row?.insurance),
    hoa: numberOrEmpty(row?.hoa),
    repairs_maintenance: numberOrEmpty(row?.repairs_maintenance),
    property_management: numberOrEmpty(row?.property_management),
    utilities: numberOrEmpty(row?.utilities),
    vacancy_allowance: numberOrEmpty(row?.vacancy_allowance),
    capex_reserve: numberOrEmpty(row?.capex_reserve),
    other: numberOrEmpty(row?.other),
    property_tax_source: row?.property_tax_source || 'manual',
    insurance_source: row?.insurance_source || 'manual',
    property_tax_source_label: row?.property_tax_source_label || '',
    insurance_source_label: row?.insurance_source_label || '',
  }
}

function annualExpensePayload(row, year = CURRENT_YEAR) {
  return {
    year: Number(row?.year || year),
    property_tax: inputNumber(row?.property_tax),
    insurance: inputNumber(row?.insurance),
    hoa: inputNumber(row?.hoa),
    repairs_maintenance: inputNumber(row?.repairs_maintenance),
    property_management: inputNumber(row?.property_management),
    utilities: inputNumber(row?.utilities),
    vacancy_allowance: inputNumber(row?.vacancy_allowance),
    capex_reserve: inputNumber(row?.capex_reserve),
    other: inputNumber(row?.other),
    property_tax_source: row?.property_tax_source || 'manual',
    insurance_source: row?.insurance_source || 'manual',
    source_status: row?.source_status || 'manual',
    notes: row?.notes || '',
  }
}

function annualExpenseSourceBadge(row, key) {
  if (!['property_tax', 'insurance'].includes(key)) return null
  const sourceKey = row?.[`${key}_source`] || ''
  if (!sourceKey || !inputNumber(row?.[key])) return null
  const label = row?.[`${key}_source_label`]
    || (sourceKey === 'escrow-estimate' ? 'Estimated (escrow)' : sourceKey === 'reported' ? 'Reported' : 'Manual')
  return {
    label: sourceKey === 'escrow-estimate' ? 'Estimated (escrow)' : label,
    tone: sourceKey === 'escrow-estimate' ? 'estimate' : sourceKey === 'reported' ? 'reported' : 'manual',
    title: label,
  }
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

function RealEstateStat({ label, value, note, muted = false }) {
  return (
    <div className={`rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60 ${muted ? 'opacity-70' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{note}</p> : null}
    </div>
  )
}

function setupDetailText(value) {
  if (value === null || value === undefined || value === '') return 'Not provided'
  return String(value)
}

function setupDetailMoney(value) {
  if (value === null || value === undefined || value === '') return 'Not provided'
  return fmt(value)
}

function setupDetailDate(value) {
  if (!value) return 'Not provided'
  return formatDate(value)
}

function setupFlagEnabled(value) {
  return Boolean(value)
}

function SetupDetailField({ label, value }) {
  return (
    <div className="min-w-0 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-gray-900 dark:text-white">{value}</dd>
    </div>
  )
}

function SetupDetailsSection({ title, children }) {
  return (
    <section className="min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>
      <dl className="mt-3 rounded-xl border border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900">
        {children}
      </dl>
    </section>
  )
}

function SetupFlagPill({ enabled, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
      enabled
        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800'
        : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700'
    }`}>
      {label}: {enabled ? 'Yes' : 'No'}
    </span>
  )
}

function PropertySetupDetailsTab({ prop }) {
  const hasLoan = Array.isArray(prop?.loans) ? prop.loans.length > 0 : setupFlagEnabled(prop?.has_loan)
  const hasHoa = setupFlagEnabled(prop?.hoa_flag || prop?.hoa_fee || prop?.hoa_special_assessment || (prop?.hoa_history && prop.hoa_history !== '[]'))
  const hasSolar = setupFlagEnabled((prop?.solar_ownership || 'None') !== 'None' || prop?.solar_monthly_payment || prop?.solar_purchase_price)
  const currentResidency = prop?.current_residency_status || prop?.usage_type

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-5 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Property setup</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Details</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Read-only view of the first Property Setup page.</p>
        </div>
        <Link to={`/properties/${prop.id}/edit`} className="btn-secondary inline-flex items-center gap-1.5 text-sm">
          <Pencil className="h-3.5 w-3.5" /> Edit setup
        </Link>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <SetupDetailsSection title="Basics">
          <SetupDetailField label="Property name" value={setupDetailText(prop?.name)} />
          <SetupDetailField label="Home Type" value={setupDetailText(homeTypeLabel(prop?.property_type, prop?.property_type_raw))} />
          <SetupDetailField label="Original Residency Status" value={setupDetailText(prop?.original_residency_status)} />
          <SetupDetailField label="Current Residency Status" value={setupDetailText(currentResidency)} />
          <SetupDetailField label="Street" value={setupDetailText(prop?.address)} />
          <SetupDetailField label="City" value={setupDetailText(prop?.city)} />
          <SetupDetailField label="State" value={setupDetailText(prop?.state)} />
          <SetupDetailField label="ZIP code" value={setupDetailText(prop?.zip_code)} />
        </SetupDetailsSection>

        <div className="grid gap-6">
          <SetupDetailsSection title="Purchase">
            <SetupDetailField label="Purchase date" value={setupDetailDate(prop?.purchase_date)} />
            <SetupDetailField label="Purchase price" value={setupDetailMoney(prop?.purchase_price)} />
            <SetupDetailField label="Down payment" value={setupDetailMoney(prop?.down_payment)} />
            <SetupDetailField label="Closing costs" value={setupDetailMoney(prop?.closing_costs)} />
            <SetupDetailField label="Final settlement total" value={setupDetailMoney(prop?.settlement_total_amount)} />
          </SetupDetailsSection>

          <SetupDetailsSection title="Valuation">
            <SetupDetailField label="Market Price" value={setupDetailMoney(prop?.market_value)} />
            <SetupDetailField label="Valuation source" value={setupDetailText(prop?.market_value_source)} />
            <SetupDetailField label="Valuation date" value={setupDetailDate(prop?.market_value_updated)} />
          </SetupDetailsSection>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">This property has</h3>
            <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <SetupFlagPill enabled={hasLoan} label="Loan" />
              <SetupFlagPill enabled={hasHoa} label="HOA" />
              <SetupFlagPill enabled={hasSolar} label="Solar" />
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

export default function PropertyDetailPage() {
const { id, tab: routeTab } = useParams()
const navigate = useNavigate()
const location = useLocation()
const [prop, setProp] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [metricVault, setMetricVault] = useState(null)
  const [lifetimeSummary, setLifetimeSummary] = useState(null)
const [summaryView, setSummaryView] = useState(null)
const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLoanModal, setShowLoanModal] = useState(false)
  const [editLoan, setEditLoan] = useState(null)
  const [showAmortization, setShowAmortization] = useState(null)
  const [activeTab, setActiveTab] = useState('summary')
const [showAddress, setShowAddress] = useState(() => new URLSearchParams(location.search).get('showDetails') === 'true')
const tabRefs = useRef({})

  const loadData = async () => {
    try {
      const [propRes, metricsRes, docsRes, lifetimeRes, summaryRes, vaultRes] = await Promise.all([
        propAPI.get(id),
        propAPI.metrics(id),
        docAPI.list(id).catch(() => ({ data: [] })),
        propAPI.lifetime(id).catch(() => null),
        propAPI.summary(id).catch(() => null),
        propAPI.metricVault(id).catch(() => null),
      ])
      setProp(propRes.data)
      setMetrics(metricsRes.data)
setDocs(Array.isArray(docsRes.data) ? docsRes.data : [])
      setLifetimeSummary(lifetimeRes?.data || null)
      setSummaryView(summaryRes?.data || null)
      setMetricVault(vaultRes?.data || null)
    } catch {
      toast.error('Failed to load property')
      navigate('/properties')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [id])

useEffect(() => {
  const params = new URLSearchParams(location.search)
  if (routeTab === 'usage') {
    navigate(`/properties/${id}/rental${location.search || ''}`, { replace: true })
    setActiveTab('rental')
    return
  }
  if (params.get('showDetails') === 'true') setShowAddress(true)
  const nextTab = propertyTabs.find((tab) => tab.path === routeTab || tab.id === routeTab)
  setActiveTab(nextTab?.id || 'summary')
}, [id, routeTab, location.search, navigate])

useEffect(() => {
  tabRefs.current[activeTab]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
}, [activeTab])

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
      ['Property Type',     homeTypeLabel(prop.property_type, prop.property_type_raw)],
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

if (loading) return (
<div className="flex items-center justify-center h-64">
<div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
</div>
)

if (!prop) return (
<div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
Property details are unavailable.
</div>
)

const topSummaryMetrics = summaryView?.metrics || {}
const topVaultMetrics = metricVault?.metrics || {}
const topMonthlyCashFlow = topSummaryMetrics.monthlyCashFlow?.value || 0
const topIsPrimary = propertyIsPrimary(prop)
const rentalSummaryActive = activeTab === 'summary' && !topIsPrimary
const primarySummaryActive = activeTab === 'summary' && topIsPrimary
const documentCount = docs.length
const dataHealthStatus = prop.data_health || prop.dataHealth || metrics?.data_health || metrics?.dataHealth || metricVault?.dataHealth
const dataHealthIssueCount = Number(prop.data_health_issue_count ?? prop.dataHealthIssueCount ?? metrics?.data_health_issue_count ?? metrics?.dataHealthIssueCount ?? metricVault?.dataHealthIssueCount ?? 0)
const dataHealthHasIssues = dataHealthIssueCount > 0 || (dataHealthStatus && !['complete', 'healthy', 'ok', 'stable', '—'].includes(String(dataHealthStatus).toLowerCase()))
const checklistMissingCount = Number(prop.checklist_missing_count ?? prop.checklistMissingCount ?? metrics?.checklist_missing_count ?? metrics?.checklistMissingCount ?? metricVault?.checklistMissingCount ?? 0)
const tabBadgeFor = (tab) => {
  if (tab.id === 'documents' && documentCount > 0) return { type: 'count', label: String(documentCount), ariaLabel: `${documentCount} document${documentCount === 1 ? '' : 's'}` }
  if (tab.id === 'verify' && dataHealthHasIssues) return { type: 'dot', label: dataHealthIssueCount > 0 ? String(dataHealthIssueCount) : '', ariaLabel: dataHealthIssueCount > 0 ? `${dataHealthIssueCount} data health issue${dataHealthIssueCount === 1 ? '' : 's'}` : 'Data health issues' }
  if (tab.id === 'checklist' && checklistMissingCount > 0) return { type: 'count', label: String(checklistMissingCount), ariaLabel: `${checklistMissingCount} missing checklist item${checklistMissingCount === 1 ? '' : 's'}` }
  return null
}


return (
<PageContainer>
      {/* Header */}
      <RentalPropertySummaryHeader
        prop={prop}
        presentation={topIsPrimary ? metricVault?.primarySummary : metricVault?.rentalSummary}
        metrics={metricVault?.metrics}
        expanded={showAddress}
        onToggleDetails={() => setShowAddress((value) => !value)}
        badgeFallback={topIsPrimary ? 'Primary Residence' : 'Rental Property'}
      />

      {/* Tabs — scrollable on mobile */}
      <div className="border-b border-gray-200 dark:border-gray-700">
<nav className="-mb-px flex gap-1 overflow-x-auto no-scrollbar sm:gap-2" role="tablist" aria-label="Property sections">
{propertyTabs.map((tab, index) => {
const previousGroup = propertyTabs[index - 1]?.group
const showSeparator = index > 0 && previousGroup !== tab.group
const isActive = activeTab === tab.id
const isUtility = tab.group === 'utility'
const badge = tabBadgeFor(tab)
return (
<Fragment key={tab.id}>
{showSeparator ? <span aria-hidden="true" className="mx-2 mb-3 hidden w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-700 sm:inline-block" /> : null}
<button
type="button"
role="tab"
aria-selected={isActive}
ref={(node) => { tabRefs.current[tab.id] = node }}
onClick={() => navigate(`/properties/${id}/${tab.path}${location.search || ''}`)}
className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2 pb-3 pt-1 text-sm font-medium whitespace-nowrap transition-colors ${
isActive
? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
: isUtility
? 'border-transparent text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-white'
: 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
}`}
>
<PropertyTabIcon name={tab.icon} />
<span>{tab.label}</span>
{badge?.type === 'count' ? (
<span className="ml-0.5 rounded-full border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-gray-500 dark:border-gray-700 dark:text-gray-300" aria-label={badge.ariaLabel}>
{badge.label}
</span>
) : null}
{badge?.type === 'dot' ? (
<span className="ml-0.5 inline-flex h-2 w-2 rounded-full bg-red-500" role="img" aria-label={badge.ariaLabel} title={badge.ariaLabel} />
) : null}
</button>
</Fragment>
)})}
</nav>
      </div>

{!rentalSummaryActive && !primarySummaryActive ? <PropertyTabMetrics activeTab={activeTab} metricVault={metricVault} isPrimary={topIsPrimary} /> : null}


{activeTab === 'rental' && (
<UsageTimelineTab propId={id} prop={prop} onSaved={loadData} />
)}

{activeTab === 'expenses' && (
<ExpensesTab propId={id} />
)}

      {/* Loans */}
      {activeTab === 'loans' && (
<LoansTab
propId={id}
prop={prop}
metricVault={metricVault}
onAddLoan={() => { setEditLoan(null); setShowLoanModal(true) }}
          onEditLoan={(loan) => { setEditLoan(loan); setShowLoanModal(true) }}
          onAmortize={(loan) => setShowAmortization(loan)}
          onDeleted={loadData}
        />
      )}

      {/* Rental */}
{/* Taxes */}
{activeTab === 'taxes' && (
<UnifiedTaxPage propId={id} property={prop} />
)}

{activeTab === 'depreciation' && (
<DepreciationTabExact propId={id} onRentalRequest={() => setActiveTab('rental')} />
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
<DataHealthTab propId={id} onJump={setActiveTab} />
)}

{activeTab === 'details' && (
<PropertySetupDetailsTab prop={prop} />
)}

      {activeTab === 'summary' && (
        rentalSummaryActive ? (
          <RentalPropertySummary
            metricVault={metricVault}
            onJump={(tab) => navigate(`/properties/${id}/${propertyTabs.find((item) => item.id === tab)?.path || tab}`)}
            waterfall={<ValueWaterfallStoryChart waterfall={metricVault?.rentalSummary?.waterfall} onJump={setActiveTab} showTitle={false} />}
          />
        ) : (
          <PrimaryPropertySummary
            metricVault={metricVault}
            waterfall={<ValueWaterfallStoryChart waterfall={metricVault?.primarySummary?.waterfall} onJump={setActiveTab} showTitle={false} />}
          />
        )
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
</PageContainer>
)
}

const GENERIC_METRIC_TEXT = [
  'how it\'s calculated',
  'provided by backend engine',
  'value entered calculated by backend',
  'calculated by backend',
  'backend engine',
]
const GENERIC_METRIC_SOURCES = new Set(['CALCULATED', 'USER_INPUT', 'DOCUMENT', 'APPROX', 'PROJECTED'])

function cleanMetricText(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (GENERIC_METRIC_TEXT.some((phrase) => lower === phrase || lower.includes(phrase))) return ''
  return text
}

function usefulMetricInput(item) {
  if (!item || !cleanMetricText(item.label)) return null
  const display = item.display ?? (item.value === null || item.value === undefined ? null : fmt(item.value))
  if (!display) return null
  return { label: item.label, display }
}

function usefulMetricSource(source) {
  const text = cleanMetricText(source)
  if (!text || GENERIC_METRIC_SOURCES.has(text.toUpperCase())) return ''
  return text
}

function metricHasUsefulInfo({ formula, inputs, computation, result, missing, warning, hint, source }) {
  return Boolean(
    cleanMetricText(formula) ||
    (inputs || []).some(usefulMetricInput) ||
    cleanMetricText(computation) ||
    cleanMetricText(result) ||
    (missing || []).length ||
    cleanMetricText(warning) ||
    cleanMetricText(hint) ||
    usefulMetricSource(source)
  )
}

function MetricInfo({ metric }) {
  if (!metric) return null
  const inputs = (metric.inputs || []).map(usefulMetricInput).filter(Boolean)
  const missing = metric.missingInputs || []
  const warning = cleanMetricText(metric.warning || (metric.warnings || []).join(' '))
  const hint = cleanMetricText(metric.hint)
  const formula = cleanMetricText(metric.formula)
  const computation = cleanMetricText(metric.computation)
  const result = cleanMetricText(metric.result)
  const source = usefulMetricSource(metric.source)
  const updatedAt = cleanMetricText(metric.updatedAt || metric.updated_at || metric.lastUpdated || metric.last_updated)
  const confidence = cleanMetricText(metric.confidenceLabel || metric.confidence_level || metric.confidence)
  const sourceOnly = source && !formula && !inputs.length && !computation && !result && !missing.length && !warning && !hint
  const isMarketValue = String(metric.label || '').toLowerCase() === 'market value'

  if (!metricHasUsefulInfo({ formula, inputs, computation, result, missing, warning, hint, source }) || (isMarketValue && sourceOnly && !updatedAt && !confidence)) return null

  return (
    <span className="group relative inline-flex">
      <button type="button" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400" aria-label={`${metric.label || 'Metric'} details`}>
        <Info className="h-3 w-3" />
      </button>
      <span className="absolute left-0 top-5 z-30 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs shadow-xl group-hover:block group-focus-within:block dark:border-gray-700 dark:bg-gray-900">
        <span className="block font-semibold text-gray-900 dark:text-white">Metric details</span>
        {formula ? <span className="mt-1 block text-gray-600 dark:text-gray-300">{formula}</span> : null}
        {inputs.length ? <span className="mt-2 block space-y-1">
          {inputs.map((item, index) => <span key={`${item.label}-${index}`} className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">{item.label}</span><span className="font-medium text-gray-900 dark:text-white">{item.display}</span></span>)}
        </span> : null}
        {computation ? <span className="mt-2 block border-t border-gray-100 pt-2 text-gray-600 dark:border-gray-700 dark:text-gray-300">{computation}</span> : null}
        {result ? <span className="mt-1 block font-semibold text-gray-900 dark:text-white">{result}</span> : null}
        {missing.length ? <span className="mt-2 block rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Missing input: {missing.join(', ')}{hint ? <span className="mt-1 block">{hint}</span> : null}</span> : null}
        {warning ? <span className="mt-2 block rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{warning}</span> : null}
        {source ? <span className={`mt-2 block border-t border-gray-100 pt-2 font-medium dark:border-gray-700 ${sourceToneClass(source)}`}>{isMarketValue && source.toLowerCase().includes('manual') && updatedAt ? `Manual market value entered by user. Last updated: ${updatedAt}.` : `Source: ${source}`}</span> : null}
        {updatedAt && !(isMarketValue && source.toLowerCase().includes('manual')) ? <span className="mt-1 block text-gray-500 dark:text-gray-400">Last updated: {updatedAt}</span> : null}
        {confidence ? <span className="mt-1 block text-gray-500 dark:text-gray-400">Confidence: {confidence}</span> : null}
      </span>
    </span>
  )
}

function MetricLabel({ label, metric, action }) {
  return <span className="flex items-center gap-1">{label}<MetricInfo metric={{ ...metric, label }} />{action}</span>
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
const annualChecklistRows = annualPivot.labels.map((label) => ({ label }))
const annualChecklistColumns = [
{ id: 'document', header: 'Document', accessor: 'label', sortable: false, cellClassName: 'font-medium text-gray-900 dark:text-white' },
...annualPivot.years.map((year) => ({
id: `year-${year}`,
header: String(year),
sortable: false,
align: 'center',
render: (row) => {
const item = annualPivot.cell(row.label, year)
return item ? <ChecklistDotGroup item={item} /> : <span className="text-gray-300">—</span>
},
cellClassName: 'text-center',
})),
]
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
<DataTable
columns={annualChecklistColumns}
rows={annualChecklistRows}
getRowKey={(row) => row.label}
/>
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

function businessRawRecordLabel(documentType, year, statementDate, fields = {}) {
const type = String(documentType || 'Document')
const month = fields.statement_month || fields.month || monthFromDate(statementDate)
if (/mortgage statement/i.test(type) && month && year && year !== '—') return `${type} (${month} ${year})`
if (/closing/i.test(type)) return 'Closing Disclosure'
if (/loan/i.test(type) && !/1098/i.test(type)) return 'Loan Details'
if (year && year !== '—') return `${type} (${year})`
return type
}

function monthFromDate(value) {
if (!value) return ''
const date = new Date(value)
if (Number.isNaN(date.getTime())) return ''
return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.getMonth()] || ''
}

function formatTimelineDate(value) {
  if (!value) return 'current'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function normalizeTimelineError(error) {
  const detail = error?.response?.data?.detail
  if (!detail || typeof detail === 'string') return { message: detail || 'Failed to save rental timeline period', conflicts: [] }
  return { message: detail.message || 'Failed to save rental timeline period', conflicts: detail.conflicts || [] }
}

function UsageTimelineTab({ propId, onSaved }) {
  const emptyTimelineForm = { period_ref: null, status: 'occupied', start_date: '', end_date: '', monthly_rent: '', notes: '' }
  const [timeline, setTimeline] = useState(null)
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [timelineSaving, setTimelineSaving] = useState(false)
  const [timelineForm, setTimelineForm] = useState(emptyTimelineForm)
  const [timelineError, setTimelineError] = useState(null)
  const [timelineFormOpen, setTimelineFormOpen] = useState(false)
  const editingTimeline = Boolean(timelineForm.period_ref)

  const loadRentalTimeline = () => {
    setTimelineLoading(true)
    propAPI.rentalTimeline(propId)
      .then((res) => setTimeline(res.data))
      .catch(() => toast.error('Failed to load rental performance'))
      .finally(() => setTimelineLoading(false))
  }

  useEffect(() => {
    loadRentalTimeline()
  }, [propId])

  const setTimelineField = (key, value) => {
    setTimelineError(null)
    setTimelineForm((current) => ({ ...current, [key]: value }))
  }

  const resetTimelineForm = () => {
    setTimelineForm(emptyTimelineForm)
    setTimelineError(null)
    setTimelineFormOpen(false)
  }

  const startAddTimelinePeriod = (dates = {}) => {
    setTimelineError(null)
    setTimelineFormOpen(true)
    setTimelineForm({
      ...emptyTimelineForm,
      start_date: dates.startDate || '',
      end_date: dates.endDate || '',
    })
  }

  const editTimelinePeriod = (period) => {
    if (!period?.editable) return
    setTimelineError(null)
    setTimelineFormOpen(true)
    setTimelineForm({
      period_ref: period.periodRef,
      status: 'occupied',
      start_date: period.startDate || '',
      end_date: period.endDate || '',
      monthly_rent: period.monthlyRent || '',
      notes: period.notes || '',
    })
  }

  const deleteTimelinePeriod = async (period) => {
    if (!period?.periodRef) return
    try {
      const res = await propAPI.deleteRentalTimelinePeriod(propId, period.periodRef)
      setTimeline(res.data)
      if (timelineForm.period_ref === period.periodRef) resetTimelineForm()
      toast.success('Rental period deleted')
      onSaved?.()
    } catch (err) {
      toast.error(normalizeTimelineError(err).message)
    }
  }

  const submitTimelinePeriod = async (event) => {
    event.preventDefault()
    setTimelineError(null)
    if (!timelineForm.start_date) {
      setTimelineError({ message: 'Start date is required.', conflicts: [] })
      return
    }
    const payload = {
      period_ref: timelineForm.period_ref,
      status: 'occupied',
      start_date: timelineForm.start_date,
      end_date: timelineForm.end_date || null,
      monthly_rent: Number(String(timelineForm.monthly_rent).replace(/[^0-9.]/g, '')) || 0,
      notes: timelineForm.notes || null,
    }
    setTimelineSaving(true)
    try {
      const res = editingTimeline
        ? await propAPI.updateRentalTimelinePeriod(propId, payload)
        : await propAPI.createRentalTimelinePeriod(propId, payload)
      setTimeline(res.data)
      resetTimelineForm()
      toast.success(editingTimeline ? 'Rental period updated' : 'Rental period added')
      onSaved?.()
    } catch (err) {
      const parsed = normalizeTimelineError(err)
      setTimelineError(parsed)
      toast.error(parsed.message)
    } finally {
      setTimelineSaving(false)
    }
  }

  const statusLabel = (status) => {
    if (status === 'occupied') return 'Occupied'
    if (status === 'not_rental') return 'Not Rental'
    if (status === 'vacant') return 'Vacant'
    return status || '—'
  }

  const statusBadgeClass = (status) => {
    const normalized = String(status || '').toLowerCase().replace(' ', '_')
    if (normalized === 'occupied') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60'
    if (normalized === 'vacant') return 'bg-gray-100 text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-700'
    if (normalized === 'not_rental') return 'bg-gray-50 text-gray-500 ring-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:ring-gray-800'
    return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/60'
  }

  const monthClass = (status) => {
    if (status === 'occupied') return 'border-emerald-500 bg-emerald-500 shadow-sm shadow-emerald-500/20'
    if (status === 'vacant') return 'border-gray-300 bg-gray-300 dark:border-gray-600 dark:bg-gray-600'
    return 'border-gray-300 bg-transparent opacity-40 dark:border-gray-700'
  }

  const monthAriaLabel = (month) => {
    const tooltip = month.tooltip || {}
    return [
      tooltip.month,
      tooltip.status,
      tooltip.monthlyRent && tooltip.monthlyRent !== '—' ? tooltip.monthlyRent : null,
      tooltip.period,
      tooltip.note,
    ].filter(Boolean).join(' · ')
  }

  const monthTooltipText = (month, year) => {
    const tooltip = month.tooltip || {}
    const status = tooltip.status || statusLabel(month.status)
    const rent = status === 'Occupied' ? (tooltip.monthlyRent || month.monthlyRentDisplay || '—') : '$0'
    return `${month.label || 'Month'} ${year} — ${status} · ${rent}`
  }

  const renderTimelineForm = () => (
    <form onSubmit={submitTimelinePeriod} className="rounded-md bg-gray-50 p-2.5 dark:bg-gray-900">
      <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{editingTimeline ? 'Edit occupancy period' : '+ Add occupancy period'}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Record occupied periods only. Vacancy is derived from gaps.</p>
        </div>
        {editingTimeline ? <button type="button" className="btn-secondary text-xs" onClick={resetTimelineForm}>Cancel editing</button> : null}
      </div>
      <div className="grid gap-2.5 md:grid-cols-4">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={timelineForm.start_date} onChange={(event) => setTimelineField('start_date', event.target.value)} required />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={timelineForm.end_date} onChange={(event) => setTimelineField('end_date', event.target.value)} />
        </div>
        <div>
          <label className="label">Rent</label>
          <input className="input" inputMode="decimal" value={timelineForm.monthly_rent} onChange={(event) => setTimelineField('monthly_rent', event.target.value)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={timelineForm.notes} onChange={(event) => setTimelineField('notes', event.target.value)} />
        </div>
      </div>
      {timelineError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
          <p className="font-semibold">Date conflict</p>
          <p className="mt-1">{timelineError.message}</p>
          {timelineError.conflicts?.length ? (
            <div className="mt-2 space-y-2">
              {timelineError.conflicts.map((conflict) => (
                <div key={conflict.periodRef || conflict.periodId} className="rounded-md bg-white/70 p-2 dark:bg-gray-900/50">
                  <p className="font-medium capitalize">{String(conflict.status || '').replace('_', ' ')}</p>
                  <p>{conflict.display}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2.5 flex justify-end gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={resetTimelineForm}>Cancel</button>
        <button type="submit" className="btn-primary text-sm" disabled={timelineSaving}>{timelineSaving ? 'Saving...' : editingTimeline ? 'Save changes' : 'Add occupancy period'}</button>
      </div>
    </form>
  )

  const historyRows = [
    ...(timeline?.periods || []),
    ...(timelineFormOpen ? [{ kind: 'form', periodRef: editingTimeline ? '__edit_form__' : '__add_form__' }] : []),
  ]

  const historyColumns = [
    { id: 'from', header: 'From', render: (period) => formatTimelineDate(period.startDate) },
    { id: 'to', header: 'To', render: (period) => formatTimelineDate(period.endDate) },
    {
      id: 'status',
      header: 'Status',
      render: (period) => (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusBadgeClass(period.status)}`}>
          {period.derived ? `${period.statusDisplay || statusLabel(period.status)} · derived` : period.statusDisplay || statusLabel(period.status)}
        </span>
      ),
    },
    { id: 'rent', header: 'Rent', align: 'right', render: (period) => period.status === 'occupied' ? period.monthlyRentDisplay || '—' : '—' },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      sortable: false,
      render: (period) => period.editable ? (
        <div className="inline-flex gap-2">
          <button type="button" className="text-blue-600 hover:underline" onClick={() => editTimelinePeriod(period)}>Edit</button>
          <button type="button" className="text-red-600 hover:underline" onClick={() => deleteTimelinePeriod(period)}>Delete</button>
        </div>
      ) : <span className="text-xs text-gray-400">Read-only</span>,
    },
  ]

  if (timelineLoading) {
    return <div className="card py-10 text-center text-sm text-gray-400">Loading rental performance...</div>
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{timeline?.title || 'Rental Performance'}</h3>
            <p className="mt-2 text-xl font-semibold leading-snug text-gray-950 dark:text-white">{timeline?.storyLead || timeline?.subtitle || 'How consistently this property has generated rental income.'}</p>
          </div>
          <span className="w-fit rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">As of {timeline?.asOfDate || '—'}</span>
        </div>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {(timeline?.heroKpis || []).map((item) => (
            <div key={item.label} className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
              {item.label === 'Status' ? (
                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ${statusBadgeClass(item.value)}`}>{item.display || '—'}</span>
              ) : (
                <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{item.display || '—'}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">Occupancy Timeline</h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Vacancy is backend-derived from gaps between occupied periods inside rental-available months.</p>
          </div>
          <button type="button" className="btn-primary text-sm" onClick={() => startAddTimelinePeriod()}>+ Add period</button>
        </div>
        {(timeline?.timeline || []).length ? (
          <div className="overflow-hidden rounded-lg border border-gray-100 dark:border-gray-700">
            <div className="grid min-h-9 grid-cols-[minmax(360px,0.48fr)_minmax(0,0.52fr)] items-center bg-gray-50 text-xs font-medium text-gray-500 dark:bg-gray-700/80 dark:text-gray-400">
              <div className="grid grid-cols-[0.7fr_0.9fr_0.8fr_1.2fr_1.2fr] items-center gap-3 px-3 py-2">
                <span>Year</span>
                <span className="text-right">Occupied</span>
                <span className="text-right">Vacant</span>
                <span className="text-right">Received</span>
                <span className="text-right">Expected</span>
              </div>
              <div className="grid grid-cols-12 items-center px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500" aria-hidden="true">
                {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/60">
              {timeline.timeline.map((year) => (
                <div key={year.year} className="grid min-h-9 grid-cols-[minmax(360px,0.48fr)_minmax(0,0.52fr)] items-center">
                  <div className="grid grid-cols-[0.7fr_0.9fr_0.8fr_1.2fr_1.2fr] items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{year.year}</span>
                    <span className="text-right font-semibold text-emerald-600 dark:text-emerald-300">{year.occupiedMonths}</span>
                    <span className="text-right text-gray-500 dark:text-gray-400">{year.vacantMonths}</span>
                    <span className="text-right font-semibold text-emerald-600 dark:text-emerald-300">{year.rentReceivedDisplay || year.rentCollectedDisplay || '—'}</span>
                    <span className="text-right font-semibold text-gray-900 dark:text-white">{year.expectedRentDisplay || '—'}</span>
                  </div>
                  <div className="grid w-full grid-cols-12 overflow-hidden px-3" aria-label={`${year.year} rental occupancy timeline`}>
                    {year.months.map((month) => {
                      const tooltip = monthTooltipText(month, year.year)
                      const ariaLabel = monthAriaLabel(month)
                      const clickable = Boolean(month.canAddPeriod)
                      return (
                        <button
                          key={`${year.year}-${month.month}`}
                          type="button"
                          title={tooltip}
                          aria-label={ariaLabel || tooltip}
                          onClick={() => clickable && startAddTimelinePeriod({ startDate: month.startDate, endDate: month.endDate })}
                          className={`group flex min-w-0 items-center justify-center rounded-md py-2 outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-blue-500 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <span className={`h-2.5 w-2.5 rounded-full border transition-all duration-150 group-hover:ring-4 group-hover:ring-blue-500/15 group-focus-visible:ring-4 group-focus-visible:ring-blue-500/20 ${monthClass(month.status)}`} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {timeline?.timelineTotals ? (
                <div className="grid min-h-9 grid-cols-[minmax(360px,0.48fr)_minmax(0,0.52fr)] items-center bg-gray-50 font-semibold dark:bg-gray-800/60">
                  <div className="grid grid-cols-[0.7fr_0.9fr_0.8fr_1.2fr_1.2fr] items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-gray-900 dark:text-white">{timeline.timelineTotals.label || 'Total'}</span>
                    <span className="text-right text-emerald-600 dark:text-emerald-300">{timeline.timelineTotals.occupiedMonths}</span>
                    <span className="text-right text-gray-600 dark:text-gray-300">{timeline.timelineTotals.vacantMonths}</span>
                    <span className="text-right text-emerald-600 dark:text-emerald-300">{timeline.timelineTotals.rentReceivedDisplay || '—'}</span>
                    <span className="text-right text-gray-900 dark:text-white">{timeline.timelineTotals.expectedRentDisplay || '—'}</span>
                  </div>
                  <div className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400">
                    Vacancy loss {timeline.timelineTotals.vacancyLossDisplay || '—'}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400 dark:border-gray-700">No rental timeline recorded.</div>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Occupied</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" /> Vacant</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-gray-300 opacity-40 dark:border-gray-700" /> Not Rental</span>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-base font-semibold text-gray-900 dark:text-white">Occupancy History</h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Entered occupied periods plus backend-derived vacancy gaps.</p>
          </div>
          {editingTimeline ? <button type="button" className="btn-secondary text-sm" onClick={resetTimelineForm}>Cancel editing</button> : null}
        </div>
        <DataTable
          columns={historyColumns}
          rows={historyRows}
          getRowKey={(row) => row.periodRef}
          renderFullWidthRow={(row) => row.kind === 'form' ? renderTimelineForm() : null}
          emptyMessage="No occupancy history recorded."
        />
      </section>

      <section className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-4 text-sm font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:text-emerald-100">
        {timeline?.insightLine || 'Rental performance insight unavailable.'}
      </section>
    </div>
  )
}

function LoansTab({ propId, prop, metricVault, onAddLoan, onEditLoan, onAmortize, onDeleted }) {
  const [debt, setDebt] = useState(null)
  const [uploadingLoanId, setUploadingLoanId] = useState(null)
  const [highlightedLoanYears, setHighlightedLoanYears] = useState({})
  const [showClosedLoans, setShowClosedLoans] = useState(false)
  const debtRefreshVersion = useRef(0)

  const refreshDebt = async () => {
    const version = debtRefreshVersion.current + 1
    debtRefreshVersion.current = version
    const res = await propAPI.debt(propId)
    if (debtRefreshVersion.current === version) setDebt(res.data)
    return res.data
  }

  const highlightAffectedYears = (loanId, years = []) => {
    const cleanYears = years.filter((year) => year !== null && year !== undefined)
    if (!loanId || !cleanYears.length) return
    setHighlightedLoanYears((current) => ({ ...current, [loanId]: cleanYears }))
    window.setTimeout(() => {
      setHighlightedLoanYears((current) => {
        const next = { ...current }
        delete next[loanId]
        return next
      })
    }, 2500)
  }

  useEffect(() => {
    let cancelled = false
    const version = debtRefreshVersion.current + 1
    debtRefreshVersion.current = version
    propAPI.debt(propId).then((res) => {
      if (!cancelled && debtRefreshVersion.current === version) setDebt(res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [propId])

  const previewLoanDocumentUpload = async (loan, file) => {
    if (!file || !loan) return null
    const fd = new FormData()
    fd.append('property_id', propId)
    fd.append('category', 'auto')
    fd.append('file', file)
    try {
      const preview = await docAPI.previewUpload(fd)
      return preview.data
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Loan document preview failed'))
      return null
    }
  }

  const checkForServicingTransfer = async (loanId) => {
    if (!loanId) return
    try {
      const res = await propAPI.loanTransferSuggestions(propId)
      const suggestions = res.data?.suggestions || []
      const match = suggestions.find(
        (suggestion) => suggestion.previousLoanId === loanId || suggestion.currentLoanId === loanId
      )
      if (!match) return
      const confirmed = window.confirm(
        `${match.message || 'This looks like a servicer transfer.'}\n\nMerge "${match.previousLoanLabel}" and "${match.currentLoanLabel}" into one loan?`
      )
      if (!confirmed) return
      await propAPI.groupServicingTransfer(propId, {
        previous_loan_id: match.previousLoanId,
        current_loan_id: match.currentLoanId,
        closed_date: match.proposedClosedDate,
      })
      await Promise.all([
        Promise.resolve(onDeleted?.()),
        refreshDebt().catch(() => {}),
      ])
      toast.success('Servicer transfer merged into one loan.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not merge servicer transfer'))
    }
  }

  const applyLoanDocumentUpload = async (loan, preview, options = {}) => {
    if (!loan || !preview?.pending_upload_id) return false
    setUploadingLoanId(loan.id)
    try {
      const accepted = await docAPI.acceptUpload({
        pending_upload_id: preview.pending_upload_id,
        original_filename: preview.original_filename,
        property_id: propId,
        loan_id: loan.id,
        category: preview.category || 'mortgage_statement',
        apply_extracted: false,
        field_overrides: options.fieldOverrides || {},
        force: options.duplicateAction === 'keep',
        replace_document_id: options.duplicateAction === 'replace' ? preview.duplicate_of?.id : undefined,
      })
      const documentCategory = accepted.data?.doc_category || accepted.data?.category || preview.category
      let processingResult = accepted.data || {}
      let successMessage = 'Loan document uploaded.'
      // Mortgage statements, closing disclosures and loan disclosures all carry
      // loan terms — review and apply them to this loan so the upload actually
      // imports (a scanned closing statement simply applies whatever parsed).
      if (['mortgage_statement', 'closing_statement', 'loan_disclosure'].includes(documentCategory)) {
        const review = await docAPI.loanStatementReview(accepted.data.id)
        const selectedFields = (review.data?.loanFields || []).map((field) => field.targetKey)
        const applied = await docAPI.applyLoanStatement(accepted.data.id, {
          property_id: propId,
          loan_id: loan.id,
          selected_loan_fields: selectedFields,
          address_override: Boolean(options.addressOverride),
          field_overrides: options.fieldOverrides || {},
        })
        processingResult = applied.data || processingResult
        const estimates = applied.data?.expenseEstimates || {}
        const estimatedParts = [
          estimates.propertyTax?.applied ? `property tax ${estimates.propertyTax.display}` : null,
          estimates.insurance?.applied ? `insurance ${estimates.insurance.display}` : null,
        ].filter(Boolean)
        const appliedLabel = documentCategory === 'mortgage_statement' ? 'Mortgage statement applied.' : 'Loan document applied.'
        successMessage = estimatedParts.length
          ? `Statement applied. Estimated ${estimates.year} ${estimatedParts.join(' and ')} from escrow.`
          : appliedLabel
      } else if (documentCategory === '1098') {
        successMessage = '1098 imported. Loan history updated.'
      }
      if (processingResult.processingStatus && processingResult.processingStatus !== 'COMPLETED') {
        throw new Error('Loan document processing did not complete.')
      }
      await Promise.all([
        Promise.resolve(onDeleted?.()),
        refreshDebt().catch(() => {}),
      ])
      highlightAffectedYears(processingResult.loanId || loan.id, processingResult.affectedYears || [])
      toast.success(successMessage)
      await checkForServicingTransfer(processingResult.loanId || loan.id)
      return true
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Loan document upload failed'))
      return false
    } finally {
      setUploadingLoanId(null)
    }
  }

  const logicalLoans = debt?.loans || []
  const isClosedLoan = (loan) => ['CLOSED', 'REFINANCED', 'PAID_OFF'].includes(String(loan.status || '').toUpperCase())
  const activeLoans = logicalLoans
    .filter((loan) => !isClosedLoan(loan))
    .sort((left, right) => String(right.disbursementDate || right.origination_date || '').localeCompare(String(left.disbursementDate || left.origination_date || '')))
  const closedLoans = logicalLoans
    .filter(isClosedLoan)
    .sort((left, right) => String(right.closed_date || '').localeCompare(String(left.closed_date || '')))
  const refinanceChains = debt?.refinanceChains || []
  const loanMetricRows = metricVault?.loanMetrics || {}

  const renderLoanCard = (loan) => (
    <LoanCard
      key={loan.logicalLoanId || loan.id}
      loan={loan}
      debt={loan}
      metrics={loanMetricRows[String(loan.id)]}
      onEdit={() => onEditLoan(loan)}
      onAmortize={() => onAmortize(loan)}
      onPreviewStatement={(file) => previewLoanDocumentUpload(loan, file)}
      onAcceptStatement={(preview, options) => applyLoanDocumentUpload(loan, preview, options)}
      onDeleted={async () => {
        await Promise.resolve(onDeleted?.())
        await refreshDebt().catch(() => {})
      }}
      propId={propId}
      uploadingStatement={uploadingLoanId === loan.id}
      highlightedYears={highlightedLoanYears[loan.id] || []}
      closed={isClosedLoan(loan)}
    />
  )

  return (
    <div className="space-y-5">
      {refinanceChains.map((chain) => (
        <LoanRefinanceChain key={chain.chainId} chain={chain} />
      ))}
      <div className="grid gap-4">
        {activeLoans.map(renderLoanCard)}
      </div>

      {closedLoans.length ? (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-neutral-700/70 dark:bg-neutral-900">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-neutral-800/60"
            onClick={() => setShowClosedLoans((current) => !current)}
            aria-expanded={showClosedLoans}
          >
            <span>
              <span className="block text-sm font-semibold text-gray-950 dark:text-white">Closed loan history</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                {closedLoans.length} {closedLoans.length === 1 ? 'loan' : 'loans'} closed or refinanced
              </span>
            </span>
            <ChevronDown className={`h-5 w-5 text-gray-500 transition-transform ${showClosedLoans ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showClosedLoans ? <div className="grid gap-4 border-t border-gray-200 p-4 dark:border-neutral-700/70">{closedLoans.map(renderLoanCard)}</div> : null}
        </section>
      ) : null}

      <button
        type="button"
        onClick={onAddLoan}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-5 text-center text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-600 dark:bg-neutral-900/90 dark:text-neutral-500 dark:hover:border-neutral-400 dark:hover:text-neutral-300"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add a loan - a HELOC or second mortgage stacks here as its own card with its own year table. The portfolio strip sums all loans.
      </button>
    </div>
  )
}

function LoanRefinanceChain({ chain }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" aria-label="Loan refinance history">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-950 dark:text-white">
        <GitBranch className="h-4 w-4 text-gray-400" aria-hidden="true" />
        Loan history
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        {(chain.nodes || []).map((node, index) => (
          <Fragment key={node.loanId}>
            {index > 0 ? <ChevronRight className="hidden h-5 w-5 shrink-0 text-gray-300 md:block" aria-hidden="true" /> : null}
            <div className="min-w-0 flex-1 rounded-md bg-gray-50 px-3 py-2.5 dark:bg-gray-950">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{node.lender}</p>
                <span className={`text-xs font-medium ${node.status === 'OPEN' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}`}>{node.statusLabel}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{node.periodDisplay}</p>
              <p className="mt-1 text-xs font-medium text-gray-700 dark:text-gray-300">{node.originalAmountDisplay} · {node.rateDisplay}</p>
              {node.status === 'OPEN' ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Current balance {node.currentBalanceDisplay}</p> : null}
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  )
}

function LoanPortfolioMetric({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-900 dark:bg-neutral-950/95">
      <p className="text-xs font-medium text-gray-500 dark:text-neutral-500">{label}</p>
      <p className={`mt-1 truncate text-xl font-semibold ${tone === 'positive' ? 'text-emerald-600 dark:text-emerald-500' : 'text-gray-950 dark:text-white'}`}>{value}</p>
    </div>
  )
}

function ExpenseSourceBadge({ source }) {
  const tier = source?.tier || 'MANUAL'
  const label = source?.label || 'Manual'
  const className = tier === 'REPORTED'
    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
    : tier === 'ESTIMATE'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
      : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

function ExpenseFieldSourceBadge({ source }) {
  if (!source?.label) return null
  const className = source.tone === 'reported'
    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'
    : source.tone === 'estimate'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
      : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`} title={source.title}>
      {source.label}
    </span>
  )
}

function ExpenseCommentBadge({ comments = [] }) {
  if (!comments.length) return <span className="text-xs text-gray-400">—</span>
  const first = comments[0]
  const label = comments.length === 1 ? first.label || 'Review' : `${comments.length} comments`
  const title = comments.map((comment) => comment.message || comment.label).filter(Boolean).join('\n')
  return (
    <span
      className="inline-flex max-w-52 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
      title={title}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  )
}

function ExpenseSourceDialog({ row, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const metrics = row?.source?.metrics || []
  if (!row || !metrics.length) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/35 p-4" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${row.year} expense source details`}
        className="max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-900">
          <div>
            <h3 className="font-semibold text-gray-950 dark:text-white">{row.year} Expense Sources</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Backend-selected values and calendar-year allocation</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close source details" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          {metrics.map((metric) => {
            const title = metric.expenseType === 'PROPERTY_TAX' ? 'Property Tax' : 'Homeowners Insurance'
            const coverage = metric.coverage || {}
            const allDocuments = [...(metric.documents || []), ...(metric.supportingDocuments || [])]
            return (
              <section key={metric.expenseType} className="rounded-md border border-gray-200 p-4 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-gray-950 dark:text-white">{row.year} {title}</h4>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{metric.sourceLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-gray-950 dark:text-white">{metric.display}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{metric.status?.replaceAll('_', ' ')} · {metric.completeness}</p>
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                  <div><dt className="text-gray-500">Calendar year</dt><dd className="mt-1 font-medium text-gray-900 dark:text-white">Jan 1 – Dec 31, {row.year}</dd></div>
                  {coverage.sourcePeriodStart && coverage.sourcePeriodEnd ? <div><dt className="text-gray-500">Source period</dt><dd className="mt-1 font-medium text-gray-900 dark:text-white">{formatDate(coverage.sourcePeriodStart)} – {formatDate(coverage.sourcePeriodEnd)}</dd></div> : null}
                  <div><dt className="text-gray-500">Confidence</dt><dd className="mt-1 font-medium text-gray-900 dark:text-white">{metric.confidence == null ? 'Not provided' : `${Math.round(metric.confidence * 100)}%`}</dd></div>
                </dl>
                {metric.inputs?.length ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Included</p>
                    <div className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                      {metric.inputs.map((input, index) => <div key={`${input.date}-${index}`} className="flex items-center justify-between gap-4 px-3 py-2 text-sm"><span className="text-gray-600 dark:text-gray-300">{input.date ? `${formatDate(input.date)} · ` : ''}{input.label}</span><strong className="text-gray-950 dark:text-white">{input.display}</strong></div>)}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 rounded-md bg-gray-50 p-3 text-xs dark:bg-gray-800/60">
                  <p className="font-semibold text-gray-900 dark:text-white">Calculation</p>
                  <p className="mt-1 text-gray-600 dark:text-gray-300">{metric.computation || metric.formula}</p>
                  <p className="mt-1 text-gray-500">Allocation: {metric.allocationMethod?.replaceAll('_', ' ')}</p>
                </div>
                {metric.discrepancies?.length ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">{metric.discrepancies.map((item, index) => <p key={index}>Supporting source differs by {fmt(Math.abs(item.difference || 0))}.</p>)}</div> : null}
                {allDocuments.length ? <div className="mt-4"><p className="text-xs font-semibold uppercase text-gray-500">Source documents</p><div className="mt-2 flex flex-wrap gap-2">{allDocuments.map((document) => <a key={document.id} href={document.previewUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-gray-700 dark:text-blue-300 dark:hover:bg-gray-800"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{document.name}</span></a>)}</div></div> : null}
              </section>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ExpensesTab({ propId }) {
  const [data, setData] = useState(null)
  const [annualRows, setAnnualRows] = useState([])
  const [sourceRow, setSourceRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedYear, setExpandedYear] = useState(null)
  const [editingYear, setEditingYear] = useState(null)
  const [editorRow, setEditorRow] = useState(null)
  const [saving, setSaving] = useState(false)
  const [escrowUploading, setEscrowUploading] = useState(false)
  const [addressReview, setAddressReview] = useState(null)
  const escrowInputRef = useRef(null)

  const loadExpenses = () => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      propAPI.expensesView(propId),
      propAPI.annualExpenses(propId).catch(() => ({ data: [] })),
    ])
      .then(([viewResponse, annualResponse]) => {
        if (!active) return
        setData(viewResponse.data)
        setAnnualRows((annualResponse.data || []).map((row) => normalizeAnnualExpense(row)))
        setExpandedYear(null)
      })
      .catch((err) => {
        if (!active) return
        setError(err.response?.data?.detail?.message || err.response?.data?.detail || err.message || 'Expenses are unavailable.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }

  useEffect(() => {
    return loadExpenses()
  }, [propId])

  const availableYears = data?.rows?.map((row) => row.year) || [CURRENT_YEAR]
  const selectedEditorRow = editorRow || blankAnnualExpense(editingYear || data?.currentYear || CURRENT_YEAR)
  const refreshAfterMutation = async () => {
    const [viewResponse, annualResponse] = await Promise.all([
      propAPI.expensesView(propId),
      propAPI.annualExpenses(propId).catch(() => ({ data: [] })),
    ])
    setData(viewResponse.data)
    setAnnualRows((annualResponse.data || []).map((row) => normalizeAnnualExpense(row)))
    return { view: viewResponse.data, annualRows: annualResponse.data || [] }
  }

  const rowForYear = (year) => annualRows.find((row) => Number(row.year) === Number(year)) || blankAnnualExpense(year)
  const toggleExpandedYear = (year) => {
    const nextYear = Number(year)
    const isClosing = Number(expandedYear) === nextYear
    if (editingYear) closeEditor(false)
    setExpandedYear(isClosing ? null : nextYear)
  }
  const openEditor = (year = data?.currentYear || CURRENT_YEAR) => {
    const nextYear = Number(year)
    setEditingYear(nextYear)
    setExpandedYear(nextYear)
    setEditorRow(rowForYear(nextYear))
    setAddressReview(null)
  }
  const closeEditor = (collapse = true) => {
    const yearToCollapse = editingYear
    setEditingYear(null)
    setEditorRow(null)
    setAddressReview(null)
    setUploadTarget(null)
    if (collapse && yearToCollapse) setExpandedYear(null)
  }
  const updateEditorField = (key, value) => {
    setEditorRow((current) => {
      const base = current || blankAnnualExpense(editingYear || CURRENT_YEAR)
      const sourcePatch = key === 'property_tax'
        ? { property_tax_source: 'manual', property_tax_source_label: 'Manual' }
        : key === 'insurance'
          ? { insurance_source: 'manual', insurance_source_label: 'Manual' }
          : {}
      return { ...base, [key]: value, ...sourcePatch, source_status: base.source_status || 'manual' }
    })
  }
  const changeEditorYear = (year) => openEditor(Number(year))
  const copyPriorYear = () => {
    const previousYear = Number(editingYear) - 1
    const previous = annualRows.find((row) => Number(row.year) === previousYear)
    const hasValues = previous && EXPENSE_FIELDS.some((field) => inputNumber(previous[field.key]) > 0)
    if (!hasValues) {
      toast.error(`No ${previousYear} expenses to copy.`)
      return
    }
    setEditorRow({
      ...blankAnnualExpense(editingYear),
      ...EXPENSE_FIELDS.reduce((values, field) => ({ ...values, [field.key]: previous[field.key] || '' }), {}),
      year: Number(editingYear),
      source_status: 'manual',
    })
    toast.success(`Copied ${previousYear} expenses.`)
  }
  const saveExpense = async () => {
    if (!editingYear) return
    setSaving(true)
    try {
      await propAPI.upsertAnnualExpense(propId, editingYear, annualExpensePayload(selectedEditorRow, editingYear))
      await refreshAfterMutation()
      toast.success(`${editingYear} expenses saved.`)
      closeEditor()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save expenses'))
    } finally {
      setSaving(false)
    }
  }
  const handleEscrowUpload = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setEscrowUploading(true)
    let imported = 0
    let preserved = 0
    const failures = []
    try {
      for (const file of files) {
        const formData = new FormData()
        formData.append('property_id', propId)
        formData.append('file', file)
        try {
          const response = await docAPI.uploadExpenseDocument(formData)
          if (response.data?.status === 'address_review_required') {
            setAddressReview({
              ...response.data,
              field: response.data.detectedField,
              year: response.data.expenseYear,
            })
            continue
          }
          imported += 1
          preserved += response.data?.expenseApplication?.preserved?.length || 0
        } catch (err) {
          failures.push(`${file.name}: ${apiErrorMessage(err, 'Upload failed')}`)
        }
      }
      if (imported) {
        await refreshAfterMutation()
        const preservedText = preserved ? ` ${preserved} existing expense value${preserved === 1 ? ' was' : 's were'} preserved.` : ''
        toast.success(`${imported} expense document${imported === 1 ? '' : 's'} imported and assigned by document period.${preservedText}`)
      }
      if (failures.length) toast.error(failures.join(' '))
    } finally {
      setEscrowUploading(false)
      if (escrowInputRef.current) escrowInputRef.current.value = ''
    }
  }
  const acceptAddressReview = async () => {
    if (!addressReview?.document?.id) return
    try {
      const response = await docAPI.applyExpenseFieldDocument(addressReview.document.id, {
        property_id: propId,
        year: addressReview.year || editingYear,
        field: addressReview.field,
        address_override: true,
      })
      await refreshAfterMutation()
      setEditorRow(normalizeAnnualExpense(response.data.annualExpense))
      setAddressReview(null)
      toast.success('Address confirmed and document applied.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not apply document'))
    }
  }
  const removeAddressReview = async () => {
    if (!addressReview?.document?.id) {
      setAddressReview(null)
      return
    }
    try {
      await docAPI.delete(addressReview.document.id)
      setAddressReview(null)
      toast.success('Document removed.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not remove document'))
    }
  }
  const removeExpenseDocument = async (field) => {
    if (!editingYear) return
    try {
      const response = await docAPI.removeExpenseFieldDocument({
        property_id: propId,
        year: editingYear,
        field,
      })
      await refreshAfterMutation()
      setEditorRow(normalizeAnnualExpense(response.data.annualExpense))
      toast.success('Document link removed.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not remove document link'))
    }
  }
  const renderExpenseValue = (component) => (
    component?.value == null
      ? <span className="text-gray-400 dark:text-gray-500">—</span>
      : component.display
  )
  const renderExpenseEditor = (row) => {
    if (Number(editingYear) !== Number(row.year)) return null
    return (
      <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 dark:border-blue-900/50 dark:bg-blue-950/10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-white">Edit {editingYear} expenses</h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Save updates this year and refreshes the expense engine.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="detail-expense-year" className="text-xs font-medium text-gray-500 dark:text-gray-400">Year</label>
            <select id="detail-expense-year" className="input h-9 max-w-32 text-sm" value={editingYear} onChange={(event) => changeEditorYear(event.target.value)}>
              {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <button type="button" className="btn-secondary text-sm" onClick={copyPriorYear}>Copy prior year</button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {EXPENSE_FIELDS.map((field) => {
            const source = annualExpenseSourceBadge(selectedEditorRow, field.key)
            return (
              <div key={field.key}>
                <label className="label" htmlFor={`expense-${field.key}`}>{field.label}</label>
                <div className="relative">
                  <input
                    id={`expense-${field.key}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={selectedEditorRow[field.key] || ''}
                    onChange={(event) => updateEditorField(field.key, event.target.value)}
                    className="input pr-3"
                  />
                </div>
                <div className="mt-1 min-h-5">
                  <ExpenseFieldSourceBadge source={source} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-blue-100 pt-4 dark:border-blue-900/40">
          <button type="button" className="btn-secondary text-sm" onClick={() => closeEditor()} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary text-sm" onClick={saveExpense} disabled={saving}>
            {saving ? 'Saving...' : 'Save expenses'}
          </button>
        </div>
      </div>
    )
  }
  const renderExpenseBreakdown = (row) => (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{row.year} category breakdown</p>
        <button
          type="button"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
          onClick={() => openEditor(row.year)}
        >
          Edit
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(row.components || []).map((component) => (
          <div key={`${row.year}-${component.key}`} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/60">
            <span className="text-gray-500 dark:text-gray-400">{component.label}</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 dark:text-white">{renderExpenseValue(component)}</span>
              <ExpenseSourceBadge source={component.source} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />)}
        </div>
        <div className="card h-64 animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 dark:border-red-900/70 dark:bg-red-950/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">Expenses unavailable</h2>
            <p className="mt-1 text-sm text-red-700 dark:text-red-200">{displayText(error, 'Unable to load expenses right now.')}</p>
          </div>
        </div>
      </div>
    )
  }

  const metrics = data?.metrics || {}
  const metricItems = [
    { label: 'Operating expenses /yr', metric: metrics.operatingExpenses },
    { label: 'Largest category', metric: metrics.largestCategory, subLabel: metrics.largestCategory?.key ? `${metrics.largestCategory.label} · ${metrics.largestCategory.percentDisplay}` : null },
    { label: 'Expense ratio', metric: metrics.expenseRatio, hidden: metrics.expenseRatio?.hidden },
    { label: 'In escrow', metric: metrics.inEscrow },
  ].filter((item) => !item.hidden)

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${metricItems.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {metricItems.map((item) => (
          <MetricKPI key={item.label} label={item.label} metric={item.metric} subLabel={item.subLabel} backendOwned />
        ))}
      </div>

      <section className="card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-gray-900 dark:text-white">By year</h3>
              <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">All years</span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Years without entered expenses show a dash and aren't counted as $0. Upload escrow analyses, property-tax statements, or insurance declarations here.</p>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex shrink-0 items-center gap-2 px-3 py-2 text-sm"
            onClick={() => escrowInputRef.current?.click()}
            disabled={escrowUploading}
            title="Upload expense documents"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{escrowUploading ? 'Importing...' : 'Upload'}</span>
          </button>
        </div>
        <input
          ref={escrowInputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls"
          className="sr-only"
          onChange={(event) => handleEscrowUpload(event.target.files)}
        />
        {addressReview ? (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <p className="font-semibold">Confirm document address</p>
            <p className="mt-1 text-xs">{addressReview.addressValidation?.normalizedDocumentAddress || 'No address found'} · {addressReview.expenseYear || addressReview.year}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
              <button type="button" className="text-blue-700 hover:underline dark:text-blue-300" onClick={acceptAddressReview}>Same property — apply</button>
              <button type="button" className="text-red-700 hover:underline dark:text-red-300" onClick={removeAddressReview}>Remove document</button>
            </div>
          </div>
        ) : null}

        <DataTable
          rows={data?.rows || []}
          columns={[
            {
              id: 'expand',
              header: '',
              sortable: false,
              render: (row) => {
                const isOpen = Number(expandedYear) === Number(row.year)
                const Icon = isOpen ? ChevronDown : ChevronRight
                return (
                  <button
                    type="button"
                    className="inline-flex rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                    aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${row.year} expenses`}
                    aria-expanded={isOpen}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleExpandedYear(row.year)
                    }}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </button>
                )
              },
            },
            { id: 'year', header: 'Year', align: 'center', accessor: 'year', cellClassName: 'font-medium text-gray-900 dark:text-white', render: (row) => row.isCurrent ? `${row.year} · current` : row.year },
            { id: 'property_tax', header: 'Prop. tax', align: 'right', render: (row) => renderExpenseValue(row.propertyTax) },
            { id: 'insurance', header: 'Insurance', align: 'right', render: (row) => renderExpenseValue(row.insurance) },
            { id: 'hoa', header: 'HOA', align: 'right', render: (row) => renderExpenseValue(row.hoa) },
            { id: 'repairs', header: 'Repairs & maintenance', align: 'right', render: (row) => renderExpenseValue(row.repairs) },
            { id: 'otherOperating', header: 'Other operating', align: 'right', render: (row) => renderExpenseValue(row.otherOperatingExpenses) },
            { id: 'total', header: 'Total', align: 'right', accessor: 'total', cellClassName: 'font-semibold text-gray-900 dark:text-white', render: (row) => row.total == null ? <span className="text-gray-400 dark:text-gray-500">—</span> : row.totalDisplay },
            {
              id: 'status',
              header: 'Status',
              align: 'right',
              accessor: 'status',
              render: (row) => (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleExpandedYear(row.year)
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
                >
                  {row.status}
                </button>
              ),
            },
            {
              id: 'source',
              header: 'Source',
              render: (row) => row.source?.metrics?.length ? (
                <button
                  type="button"
                  className="inline-flex max-w-44 items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                  onClick={(event) => { event.stopPropagation(); setSourceRow(row) }}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{row.source.label}</span>
                </button>
              ) : <span className="text-xs text-gray-400">Manual</span>,
            },
            {
              id: 'comments',
              header: 'Comments',
              render: (row) => <ExpenseCommentBadge comments={row.comments || []} />,
            },
            {
              id: 'actions',
              header: 'Actions',
              align: 'right',
              sortable: false,
              render: (row) => Number(editingYear) === Number(row.year) ? (
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Editing</span>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    openEditor(row.year)
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300"
                >
                  Edit
                </button>
              ),
            },
          ]}
          getRowKey={(row) => row.year}
          defaultSort={{ id: 'year', direction: 'asc' }}
          getRowProps={(row) => {
            const baseClass = Number(editingYear) === Number(row.year)
              ? 'bg-blue-100/70 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-950/30'
              : row.isCurrent
                ? 'bg-blue-50/60 hover:bg-blue-50/80 dark:bg-blue-950/20 dark:hover:bg-blue-950/30'
                : 'odd:bg-white even:bg-gray-50/40 hover:bg-gray-50 dark:odd:bg-transparent dark:even:bg-gray-800/20 dark:hover:bg-gray-700/40'
            return {
              className: `${baseClass} cursor-pointer`,
              onClick: () => toggleExpandedYear(row.year),
            }
          }}
          renderExpandedRow={(row) => expandedYear === row.year ? (
            Number(editingYear) === Number(row.year) ? renderExpenseEditor(row) : renderExpenseBreakdown(row)
          ) : null}
          emptyMessage="No expense years available."
        />
      </section>
      <ExpenseSourceDialog row={sourceRow} onClose={() => setSourceRow(null)} />
    </div>
  )
}

const defaultDepreciationAsset = {
  asset_type: 'depreciation',
  description: '',
  placed_in_service_date: '',
  cost_basis: 0,
  land_portion: 0,
  method: 'SL',
  recovery_period: 27.5,
  prior_depreciation: 0,
  notes: '',
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
const depreciationMetrics = data?.metrics || {}
const assets = data?.assets || []
  const timeline = data?.timeline || []
  const assetKeys = assets.slice(0, 6).map((asset) => asset.description)
  const colors = [chartColors.primary, chartColors.warning, chartColors.success, chartColors.purpleStrong, chartColors.teal, chartColors.dangerStrong]
  const isTied = comparison.status === 'ties'
  const hasDiff = comparison.status === 'diff'
  const eligible = data?.eligible !== false
  const currentlyRental = !!data?.currently_rental
  const primaryYears = timeline.filter((row) => row.is_rental_year === false).map((row) => row.year)
  const depreciationYears = timeline.filter((row) => (row.total || 0) > 0 || (row.rental_months || 0) > 0)
const rentalYearCount = depreciationYears.filter((row) => (row.rental_months || 0) >= 12).length
const mixedYearCount = depreciationYears.filter((row) => (row.rental_months || 0) > 0 && (row.rental_months || 0) < 12).length
const pausedYearCount = depreciationYears.filter((row) => !(row.rental_months || 0)).length
const depreciationYearColumns = [
{ id: 'year', header: 'Year', accessor: 'year', align: 'center', cellClassName: 'font-medium text-gray-900 dark:text-white' },
{
id: 'use_status',
header: 'Use',
accessor: 'use_status',
render: (row) => (
<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
row.use_status === 'Rental'
? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
: row.use_status === 'Mixed'
? 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300'
: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}`}>
{row.use_status || (row.is_rental_year ? 'Rental' : 'Primary / paused')}
</span>
),
cellClassName: 'text-gray-700 dark:text-gray-200',
},
{ id: 'rental_months', header: 'Rental Months', accessor: 'rental_months', render: (row) => row.rental_months ?? (row.is_rental_year ? 12 : 0), align: 'right', cellClassName: 'text-gray-600 dark:text-gray-300' },
{ id: 'total', header: 'Depreciation', accessor: 'total', render: (row) => fmt(row.total), align: 'right', cellClassName: 'font-medium text-purple-600' },
]
const depreciationAssetColumns = [
{
id: 'asset',
header: 'Asset',
accessor: 'description',
render: (asset) => (
<>
<p className="font-medium text-gray-900 dark:text-white">{asset.description}</p>
{asset.warning ? <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{asset.warning}</p> : null}
</>
),
cellClassName: 'min-w-48',
},
{ id: 'asset_type', header: 'Type', accessor: 'asset_type', render: (asset) => asset.asset_type === 'amortization' ? 'Amortization' : 'Depreciation', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'placed_in_service_date', header: 'In Service', accessor: 'placed_in_service_date', render: (asset) => asset.placed_in_service_date || '—', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'cost_basis', header: 'Basis', accessor: 'cost_basis', render: (asset) => fmt(asset.cost_basis), align: 'right', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'land_portion', header: 'Land', accessor: 'land_portion', render: (asset) => fmt(asset.land_portion), align: 'right', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'annual_depreciation', header: 'Annual', accessor: 'annual_depreciation', render: (asset) => fmt(asset.annual_depreciation), align: 'right', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'current_year_depreciation', header: String(taxYear), accessor: 'current_year_depreciation', render: (asset) => fmt(asset.current_year_depreciation), align: 'right', cellClassName: 'whitespace-nowrap text-gray-900 dark:text-white' },
{ id: 'accumulated_depreciation', header: 'Accumulated', accessor: 'accumulated_depreciation', render: (asset) => fmt(asset.accumulated_depreciation), align: 'right', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'remaining_basis', header: 'Remaining', accessor: 'remaining_basis', render: (asset) => fmt(asset.remaining_basis), align: 'right', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'rental_months', header: 'Rental Mo.', accessor: 'rental_months', render: (asset) => asset.rental_months ?? 0, align: 'right', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{ id: 'fully_depreciated', header: 'Fully Depreciated', accessor: 'fully_depreciated', render: (asset) => asset.fully_depreciated ? 'Yes' : 'No', align: 'center', cellClassName: 'whitespace-nowrap text-gray-600 dark:text-gray-300' },
{
id: 'actions',
header: '',
sortable: false,
render: (asset) => (
<div className="flex justify-end gap-1">
<button type="button" className="icon-btn" onClick={() => openEdit(asset)} title="Edit asset"><Pencil className="h-4 w-4" /></button>
<button type="button" className="icon-btn text-red-600" onClick={() => deleteAsset(asset)} title="Delete asset"><Trash2 className="h-4 w-4" /></button>
</div>
),
align: 'right',
cellClassName: 'whitespace-nowrap',
},
]

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
<DataTable
columns={depreciationYearColumns}
rows={depreciationYears}
getRowKey={(row) => `depr-year-${row.year}`}
defaultSort={{ id: 'year', direction: 'asc' }}
/>
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
<p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{depreciationMetrics.currentYearDepreciation?.displayValue || fmtKMB(rollup.total_current_year_depreciation, { threshold: 1000 })}</p>
</div>
<div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
<p className="text-xs font-medium uppercase text-gray-400">Annual Depreciation (full year)</p>
<p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{depreciationMetrics.annualDepreciation?.displayValue || fmtKMB(rollup.total_annual_depreciation, { threshold: 1000 })}</p>
</div>
<div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
<p className="text-xs font-medium uppercase text-gray-400">Accumulated</p>
<p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{depreciationMetrics.accumulatedDepreciation?.displayValue || fmtKMB(rollup.total_accumulated_depreciation, { threshold: 1000 })}</p>
</div>
<div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
<p className="text-xs font-medium uppercase text-gray-400">Remaining Basis</p>
<p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{depreciationMetrics.remainingBasis?.displayValue || fmtKMB(rollup.total_remaining_basis, { threshold: 1000 })}</p>
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
<div className="py-10 text-center text-sm text-gray-400">No depreciable assets yet — add purchase price or improvement above.</div>
) : (
<DataTable
columns={depreciationAssetColumns}
rows={assets}
getRowKey={(asset) => asset.id || `${asset.description}-${asset.placed_in_service_date || 'asset'}`}
defaultSort={{ id: 'placed_in_service_date', direction: 'asc' }}
/>
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
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.borderLight} />
              {primaryYears.map((year) => (
                <ReferenceArea key={year} x1={year - 0.5} x2={year + 0.5} fill={chartColors.muted} fillOpacity={0.15} ifOverflow="visible" />
              ))}
              <XAxis dataKey="year" />
              <YAxis tickFormatter={formatChartCurrency} />
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

function DepreciationTabExact({ propId, onRentalRequest }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    type: 'Roof',
    cost: '',
    placed_in_service_date: '',
    recovery_period: '27.5',
  })

  const loadDepreciation = () => {
    setLoading(true)
    propAPI.depreciation(propId)
      .then((res) => setData(res.data))
      .catch(() => toast.error('Failed to load depreciation schedule'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadDepreciation()
  }, [propId])

  const saveImprovement = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await propAPI.addDepreciationAsset(propId, {
        asset_type: 'depreciation',
        description: form.type,
        placed_in_service_date: form.placed_in_service_date,
        cost_basis: Number(form.cost) || 0,
        land_portion: 0,
        method: 'SL',
        recovery_period: Number(form.recovery_period) || 27.5,
        prior_depreciation: 0,
        notes: '',
      })
      setData(res.data)
      setShowModal(false)
      setForm({ type: 'Roof', cost: '', placed_in_service_date: '', recovery_period: '27.5' })
      toast.success('Improvement added')
    } catch {
      toast.error('Failed to add improvement')
    } finally {
      setSaving(false)
    }
  }

  const deleteImprovement = async (asset) => {
    if (asset.is_base_building || !asset.id) return
    if (!window.confirm(`Delete ${asset.description}?`)) return
    try {
      const res = await propAPI.deleteDepreciationAsset(propId, asset.id)
      setData(res.data)
      toast.success('Improvement deleted')
    } catch {
      toast.error('Failed to delete improvement')
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading depreciation schedule...</div>
  }

  if (data?.eligible === false) {
    return (
      <div className="card flex flex-col items-center gap-3 py-14 text-center">
        <div className="rounded-full bg-gray-100 p-3 dark:bg-gray-700">
          <Home className="h-6 w-6 text-gray-400" />
        </div>
        <p className="font-medium text-gray-900 dark:text-white">Not accruing — {data?.reason || 'no rental history'}</p>
        {onRentalRequest && (
          <button type="button" className="btn-secondary mt-1 flex items-center gap-1.5 text-sm" onClick={onRentalRequest}>
            <Home className="h-3.5 w-3.5" /> Go to Rental tab
          </button>
        )}
      </div>
    )
  }

  const hero = data?.hero || {}
  const assets = data?.assets || []
  const timeline = data?.timeline || []
  const timelineAssetKeys = data?.timeline_asset_keys || assets.map((asset) => asset.description)
  const assetColors = [chartColors.sky, chartColors.warning, chartColors.purpleStrong, chartColors.success, chartColors.rose, chartColors.cyan]
  const nonRentalYears = timeline.filter((row) => !row.is_rental_year).map((row) => row.year)
  const statusText = data?.status_line?.text || (data?.currently_rental ? 'Active rental — accruing' : 'Not accruing — property is not currently an active rental')
  const StatusIcon = data?.currently_rental ? TrendingDown : PauseCircle

  const heroCells = [
    {
      label: `You deduct this year (${data?.tax_year || CURRENT_YEAR})`,
      metric: hero.currentYearDeduction,
      subtext: 'flows to Schedule E line 18',
      valueClass: 'text-gray-950 dark:text-white',
      voice: true,
    },
    {
      label: 'Banked so far',
      metric: hero.accumulatedDepreciation,
      subtext: 'accumulated',
      valueClass: 'text-gray-950 dark:text-white',
    },
    {
      label: 'Recapture at sale',
      metric: hero.recaptureAtSale,
      subtext: '25% of banked',
      valueClass: 'text-amber-700 dark:text-amber-300',
    },
    {
      label: 'Remaining',
      metric: hero.remainingBasis,
      subtext: `${hero.yearsLeft ?? '—'} yrs left`,
      valueClass: 'text-gray-950 dark:text-white',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
        <StatusIcon className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <span>{statusText}</span>
      </div>

      <div className="grid overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-2 xl:grid-cols-4">
        {heroCells.map((cell, index) => (
          <div key={cell.label} className={`p-4 ${index ? 'border-t border-gray-200 dark:border-gray-700 sm:border-l sm:border-t-0' : ''}`}>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{cell.label}</p>
            <p
              className={`mt-2 text-2xl font-medium ${cell.valueClass}`}
              style={cell.voice ? { fontFamily: 'var(--font-voice)' } : undefined}
            >
              {cell.metric?.displayValue || cell.metric?.fullDisplayValue || '—'}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{cell.subtext}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-gray-900 dark:text-white">What&apos;s depreciating</h3>
          <button type="button" className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowModal(true)}>
            <Plus className="h-4 w-4" /> Add improvement
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">In service</th>
                <th className="px-3 py-2 text-right">Basis</th>
                <th className="px-3 py-2 text-right">Annual</th>
                <th className="px-3 py-2 text-right">Accumulated</th>
                <th className="px-3 py-2 text-right">actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {assets.map((asset) => (
                <tr key={asset.id || `asset-${asset.description}`} className="text-gray-700 dark:text-gray-200">
                  <td className="px-3 py-3">
                    <p className="font-medium text-gray-900 dark:text-white">{asset.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{asset.recovery_period || 27.5}-yr</p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{asset.placed_in_service_date || '—'}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">{fmt(asset.depreciable_basis ?? asset.cost_basis)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">{fmt(asset.annual_depreciation)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">{fmt(asset.accumulated_depreciation)}</td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      className="icon-btn"
                      title={asset.is_base_building ? 'Building asset is derived from the property' : 'Delete improvement'}
                      onClick={() => deleteImprovement(asset)}
                      disabled={asset.is_base_building}
                    >
                      {asset.is_base_building ? '...' : <Trash2 className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white">Deduction each year — flat, straight-line</h3>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.borderLight} />
              {nonRentalYears.map((year) => (
                <ReferenceArea key={year} x1={year - 0.5} x2={year + 0.5} fill={chartColors.muted} fillOpacity={0.16} ifOverflow="visible" />
              ))}
              <XAxis dataKey="year" />
              <YAxis tickFormatter={formatChartCurrency} />
              <Tooltip formatter={(value) => fmt(value)} />
              <Legend />
              {timelineAssetKeys.map((key, index) => (
                <Area
                  key={key}
                  type="stepAfter"
                  dataKey={key}
                  name={key}
                  stackId="depreciation"
                  stroke={assetColors[index % assetColors.length]}
                  fill={assetColors[index % assetColors.length]}
                  fillOpacity={0.45}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveImprovement} className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add improvement</h3>
              <button type="button" className="icon-btn" onClick={() => setShowModal(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="label">Type
                <select className="input mt-1" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option>Roof</option>
                  <option>Renovation</option>
                  <option>HVAC</option>
                  <option>Appliances</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="label">Cost
                <input type="number" min="0" step="0.01" className="input mt-1" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} required />
              </label>
              <label className="label">In-service date
                <input type="date" className="input mt-1" value={form.placed_in_service_date} onChange={(e) => setForm({ ...form, placed_in_service_date: e.target.value })} required />
              </label>
              <label className="label">Recovery period
                <select className="input mt-1" value={form.recovery_period} onChange={(e) => setForm({ ...form, recovery_period: e.target.value })}>
                  <option value="27.5">27.5</option>
                  <option value="5">5</option>
                  <option value="7">7</option>
                  <option value="15">15</option>
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

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
const money = fmt
const setScenarioAmounts = ({ type = 'combination', name = 'Custom strategy', extra = 0, annual = 0, annualMonthValue = 12, oneTime = 0, oneTimeMonth = '2028-01', sp500 = 8, hysa = 4, rental = 6, goal = 'interest_saved' }) => {
setScenarioType(type)
setScenarioName(name)
setExtraMonthly(String(extra))
setAnnualLumpSum(String(annual))
setAnnualMonth(String(annualMonthValue))
setOneTimeAmount(String(oneTime))
setOneTimeDate(oneTimeMonth)
setSp500Rate(String(sp500))
setHysaRate(String(hysa))
setRentalRate(String(rental))
setHighlightGoal(goal)
}
const presets = [
{ id: 'conservative', label: 'Conservative', config: { name: 'Conservative Plan', type: 'combination', extra: 100, annual: 2000, oneTime: 0, sp500: 6, hysa: 4, rental: 5 } },
{ id: 'balanced', label: 'Balanced', config: { name: 'Balanced Plan', type: 'combination', extra: 250, annual: 5000, oneTime: 5000, sp500: 8, hysa: 4, rental: 6 } },
{ id: 'aggressive', label: 'Aggressive', config: { name: 'Aggressive Payoff', type: 'combination', extra: 750, annual: 10000, oneTime: 10000, sp500: 8, hysa: 4, rental: 7 } },
{ id: 'debt-free', label: 'Debt Free ASAP', config: { name: 'Debt Free ASAP', type: 'combination', extra: 1500, annual: 20000, oneTime: 25000, sp500: 7, hysa: 4, rental: 6, goal: 'interest_saved' } },
{ id: 'invest', label: 'Invest Instead', config: { name: 'Invest Instead', type: 'baseline', extra: 0, annual: 0, oneTime: 0, sp500: 9, hysa: 4, rental: 7, goal: 'roi' } },
]
const activePresetId = presets.find((preset) => (
  scenarioName === preset.config.name
  && scenarioType === preset.config.type
  && parseAmount(extraMonthly) === preset.config.extra
  && parseAmount(annualLumpSum) === preset.config.annual
  && parseAmount(oneTimeAmount) === preset.config.oneTime
))?.id
const loanLabel = (loan) => loan ? `${loan.lender_name || `Loan #${loan.id}`} · ${loan.loan_type || 'Mortgage'}` : 'Loan'
const selectedLoanRecord = loans.find((loan) => String(loan.id) === String(selectedLoan))
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
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Scenario simulator</h3>
            {loading ? <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">Updating live...</span> : <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 dark:bg-green-950/40 dark:text-green-300">Live simulator</span>}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Compare payoff strategies, cash deployed, interest saved, and investing alternatives using backend scenario results.</p>
        </div>
        <div className="grid gap-2 text-xs text-gray-500 sm:grid-cols-3 lg:min-w-[28rem]">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
            <p className="font-semibold uppercase tracking-wide">Loan</p>
            <p className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{loanLabel(selectedLoanRecord)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
            <p className="font-semibold uppercase tracking-wide">Strategy</p>
            <p className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">{scenarioName || 'Custom strategy'}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
            <p className="font-semibold uppercase tracking-wide">Saved</p>
            <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{savedScenarios.length}</p>
          </div>
        </div>
      </div>
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Decision verdict</div>
              <div className="mt-1 text-lg font-semibold text-emerald-950 dark:text-emerald-100">{result?.opportunityVerdict?.headline || 'Adjust the controls to compare payoff and investing outcomes.'}</div>
            </div>
          </div>
        </div>
        {summary ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <ScenarioCard title="Payoff time" value={summary.payoff_time} detail={`${money(summary.interest_paid)} interest`} tone="blue" />
            <ScenarioCard title="Interest saved" value={money(summary.interest_saved)} detail={`${summary.years_saved || 0} years saved`} tone="green" />
            <ScenarioCard title="Return on capital" value={summary.annualized_return == null ? '-' : `${formatNumber(summary.annualized_return, { maximumFractionDigits: 1 })}%/yr`} detail={summary.return_on_capital_lifetime == null ? 'Needs capital' : `${formatNumber(summary.return_on_capital_lifetime, { maximumFractionDigits: 1 })}% lifetime`} tone="purple" />
            <ScenarioCard title="Capital used" value={money(summary.total_cash_deployed)} detail={summary.cash_flow_note || 'Backend scenario total'} />
          </div>
        ) : null}
        {result ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="Loan Balance Over Time"><LineChart data={result.charts || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={chartTypography.tick} /><YAxis tickFormatter={formatChartCurrency} tick={chartTypography.tick} /><Tooltip formatter={(v) => money(v)} /><Legend /><Line type="monotone" dataKey="baseline_balance" name="Current loan" stroke={chartColors.mutedAxis} dot={false} /><Line type="monotone" dataKey="scenario_balance" name="Scenario loan" stroke={chartColors.primary} dot={false} /></LineChart></ChartCard>
            <ChartCard title="Principal / Interest / Extra"><BarChart data={(result.charts || []).filter((_, i) => i % 12 === 0)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={chartTypography.tick} /><YAxis tickFormatter={formatChartCurrency} tick={chartTypography.tick} /><Tooltip formatter={(v) => money(v)} /><Legend /><Bar dataKey="principal" name="Principal" stackId="a" fill={chartColors.principal} /><Bar dataKey="interest" name="Interest" stackId="a" fill={chartColors.warning} /><Bar dataKey="extra" name="Extra" stackId="a" fill={chartColors.primarySoft} /></BarChart></ChartCard>
          </div>
        ) : null}
      </div>

      <aside className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:sticky xl:top-4">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Scenario builder</h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Tune inputs; results refresh automatically.</p>
        </div>
        <div className="max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto p-4">
          <ScenarioControlGroup title="Presets">
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => <button key={preset.id} type="button" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${activePresetId === preset.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:text-blue-300'}`} onClick={() => setScenarioAmounts(preset.config)}>{preset.label}</button>)}
            </div>
          </ScenarioControlGroup>
          <ScenarioControlGroup title="Scenario">
            <label className="block"><span className="label">Loan</span><select className="input h-9 w-full text-sm" value={selectedLoan} onChange={(e) => setSelectedLoan(e.target.value)}>{loans.map((loan) => <option key={loan.id} value={loan.id}>{loanLabel(loan)}</option>)}</select></label>
            <label className="block"><span className="label">Name</span><input className="input h-9 w-full text-sm" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Tax Refund Strategy" /></label>
            <label className="block"><span className="label">Strategy</span><select className="input h-9 w-full text-sm" value={scenarioType} onChange={(e) => setScenarioType(e.target.value)}><option value="baseline">Baseline</option><option value="extra_monthly">Extra Monthly Payment</option><option value="annual_lump_sum">Annual Lump Sum</option><option value="one_time">One-Time Payment</option><option value="combination">Combination Strategy</option></select></label>
          </ScenarioControlGroup>
          <ScenarioControlGroup title="Payoff">
            <ScenarioSlider disabled={!typeAllowsMonthly} label="Extra/mo" value={parseAmount(extraMonthly)} min={0} max={3000} step={25} display={`${money(parseAmount(extraMonthly))}/mo`} onChange={(value) => setExtraMonthly(String(value))} />
            <ScenarioSlider disabled={!typeAllowsAnnual} label="Annual lump" value={parseAmount(annualLumpSum)} min={0} max={50000} step={500} display={`${money(parseAmount(annualLumpSum))}/yr`} onChange={(value) => setAnnualLumpSum(String(value))} />
            <label className="block"><span className="label">Lump month</span><select disabled={!typeAllowsAnnual} className="input h-9 w-full text-sm disabled:opacity-40" value={annualMonth} onChange={(e) => setAnnualMonth(e.target.value)}><option value="1">January</option><option value="4">Tax Refund</option><option value="6">Bonus Month</option><option value="12">December</option></select></label>
            <ScenarioSlider disabled={!typeAllowsOneTime} label="One-time" value={parseAmount(oneTimeAmount)} min={0} max={100000} step={1000} display={money(parseAmount(oneTimeAmount))} onChange={(value) => setOneTimeAmount(String(value))} footer={<input disabled={!typeAllowsOneTime} type="month" className="input mt-2 h-9 w-full text-sm disabled:opacity-40" value={oneTimeDate} onChange={(e) => setOneTimeDate(e.target.value)} />} />
          </ScenarioControlGroup>
          <ScenarioControlGroup title="Compare vs investing">
            <label className="block"><span className="label">Best by</span><select className="input h-9 w-full text-sm" value={highlightGoal} onChange={(e) => setHighlightGoal(e.target.value)}><option value="interest_saved">Max interest saved</option><option value="roi">Best annualized return</option></select></label>
            <ScenarioSlider label="Invest return" value={parseAmount(sp500Rate)} min={0} max={14} step={0.25} display={`${formatNumber(parseAmount(sp500Rate), { maximumFractionDigits: 2 })}%`} onChange={(value) => setSp500Rate(String(value))} />
            <ScenarioSlider label="HYSA" value={parseAmount(hysaRate)} min={0} max={8} step={0.1} display={`${formatNumber(parseAmount(hysaRate), { maximumFractionDigits: 2 })}%`} onChange={(value) => setHysaRate(String(value))} />
            <ScenarioSlider label="Next rental" value={parseAmount(rentalRate)} min={0} max={14} step={0.25} display={`${formatNumber(parseAmount(rentalRate), { maximumFractionDigits: 2 })}%`} onChange={(value) => setRentalRate(String(value))} />
          </ScenarioControlGroup>
          {savedScenarios.length ? <ScenarioControlGroup title={editingScenarioId ? 'Editing saved' : 'Saved'}><div className="flex flex-wrap gap-2">{savedScenarios.map((scenario) => <button key={scenario.id} type="button" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${editingScenarioId === scenario.id ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700'}`} onClick={() => loadSavedScenario(scenario)}>{scenario.name}</button>)}</div>{editingScenarioId ? <button type="button" className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setEditingScenarioId(null)}>Cancel edit</button> : null}</ScenarioControlGroup> : null}
          <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
            {editingScenarioId ? <button className="btn-secondary mb-2 w-full justify-center" onClick={updateScenario}>Update scenario</button> : null}
            <button className="btn-primary w-full justify-center" onClick={saveScenario}>Save as scenario</button>
          </div>
        </div>
      </aside>
    </div>

    {result && <div className="grid grid-cols-1 gap-4 xl:grid-cols-3"><div className="card xl:col-span-1"><div className="flex items-center justify-between"><h4 className="font-semibold text-gray-900 dark:text-white">Timeline</h4><button className="text-sm font-medium text-blue-600" onClick={() => setTimelineExpanded(!timelineExpanded)}>{timelineExpanded ? 'Collapse' : 'Expand'}</button></div><div className="mt-4 space-y-3">{shownTimeline.map((event) => <div key={`${event.date}-${event.label}`} className="flex gap-3"><div className="mt-1 h-3 w-3 rounded-full bg-blue-600" /><div><div className="text-sm font-medium text-gray-900 dark:text-white">{event.label}</div><div className="text-xs text-gray-500 dark:text-gray-400">{event.date}</div></div></div>)}</div></div><div className="card xl:col-span-2"><div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-gray-900 dark:text-white">Compare Multiple Scenarios</h4>{savedScenarios.length ? <button type="button" className="text-xs font-medium text-red-600 hover:text-red-700" onClick={clearSavedScenarios}>Clear saved</button> : null}</div><DataTable
columns={[
{ id: 'name', header: 'Scenario', cellClassName: 'font-medium text-gray-900 dark:text-white', render: (item) => <>{item.name}{item.is_best ? <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Best</span> : null}</> },
{ id: 'payoff_time', header: 'Payoff', accessor: 'payoff_time', sortable: false },
{ id: 'interest_paid', header: 'Interest', accessor: 'interest_paid', align: 'right', render: (item) => money(item.interest_paid) },
{ id: 'interest_saved', header: 'Saved', accessor: 'interest_saved', align: 'right', render: (item) => money(item.interest_saved) },
{ id: 'years_saved', header: 'Years saved', accessor: 'years_saved', align: 'right' },
{ id: 'cash_required', header: 'Cash required', accessor: 'cash_required', align: 'right', render: (item) => money(item.cash_required) },
{ id: 'annualized_return', header: 'Return', accessor: 'annualized_return', align: 'right', render: (item) => item.annualized_return == null ? '-' : `${formatNumber(item.annualized_return, { maximumFractionDigits: 1 })}%/yr` },
{ id: 'action', header: 'Action', align: 'right', sortable: false, render: (item) => item.id === 'baseline' || item.id === 'active-scenario' ? <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3.5 w-3.5" /> System</span> : <button type="button" className="icon-btn text-red-600" onClick={() => deleteSavedScenario(item.id, item.name)} title="Delete saved scenario"><Trash2 className="h-4 w-4" /></button> },
]}
rows={comparison}
getRowKey={(item) => item.id}
getRowProps={(item) => ({ className: `border-t border-gray-100 dark:border-gray-700 ${item.is_best ? 'bg-green-50 dark:bg-green-950/20' : ''}` })}
/></div></div>}

    {result && <div className="card"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold text-gray-900 dark:text-white">Amortization Schedule</h4><div className="flex flex-wrap gap-2"><select className="input w-32" value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select><input className="input w-44" placeholder="Search" value={scheduleSearch} onChange={(e) => setScheduleSearch(e.target.value)} /><button className="btn-secondary" onClick={exportSchedule}><Download className="h-4 w-4" /> Export CSV</button></div></div><DataTable
className="mt-4 max-h-[520px] overflow-auto"
columns={[
{ id: 'payment_number', header: 'Payment #', accessor: 'payment_number', align: 'center' },
{ id: 'date', header: 'Date', accessor: 'date' },
{ id: 'beginning_balance', header: 'Beginning Balance', accessor: 'beginning_balance', align: 'right', render: (row) => money(row.beginning_balance) },
{ id: 'monthly_payment', header: 'Monthly Payment', accessor: 'monthly_payment', align: 'right', render: (row) => money(row.monthly_payment) },
{ id: 'principal', header: 'Principal', accessor: 'principal', align: 'right', render: (row) => money(row.principal) },
{ id: 'interest', header: 'Interest', accessor: 'interest', align: 'right', render: (row) => money(row.interest) },
{ id: 'extra_monthly', header: 'Extra Monthly', accessor: 'extra_monthly', align: 'right', render: (row) => money(row.extra_monthly) },
{ id: 'annual_lump_sum', header: 'Annual Lump Sum', align: 'right', sortValue: (row) => (row.annual_lump_sum || 0) + (row.one_time_payment || 0), render: (row) => money((row.annual_lump_sum || 0) + (row.one_time_payment || 0)) },
{ id: 'ending_balance', header: 'Ending Balance', accessor: 'ending_balance', align: 'right', render: (row) => money(row.ending_balance) },
{ id: 'running_interest_paid', header: 'Running Interest Paid', accessor: 'running_interest_paid', align: 'right', render: (row) => money(row.running_interest_paid) },
]}
rows={rows}
getRowKey={(row) => row.payment_number}
defaultSort={{ id: 'payment_number', direction: 'asc' }}
getRowProps={() => ({ className: 'border-t border-gray-100 dark:border-gray-700' })}
/></div>}
  </div>
}

function ScenarioInputGroup({ disabled, label, children }) {
return <div className={`space-y-2 ${disabled ? 'opacity-60' : ''}`}><span className="label">{label}</span>{children}</div>
}

function ScenarioControlGroup({ title, children }) {
  return (
    <section className="border-t border-gray-200 pt-3 first:border-t-0 first:pt-0 dark:border-gray-800">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function ScenarioSlider({ disabled = false, label, value, min, max, step, display, onChange, footer }) {
const pct = max > min ? ((Number(value || 0) - min) / (max - min)) * 100 : 0
return (
<div className={disabled ? 'opacity-55' : ''}>
<div className="mb-1 flex items-center justify-between gap-3 text-xs">
<span className="font-medium text-gray-700 dark:text-gray-300">{label}</span>
<span className="font-semibold text-gray-950 dark:text-white">{disabled ? 'Off' : display}</span>
</div>
<input disabled={disabled} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer accent-blue-600 disabled:cursor-not-allowed" aria-label={label} />
<div className="mt-1 flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500"><span>{typeof min === 'number' && min >= 100 ? fmt(min) : min}</span><span>{Math.round(Math.max(0, Math.min(100, pct)))}%</span><span>{typeof max === 'number' && max >= 100 ? fmt(max) : max}</span></div>
{footer}
</div>
)
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
  const [scheduleE, setScheduleE] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCompare, setShowCompare] = useState(false)
  const [expandedRows, setExpandedRows] = useState({})

  useEffect(() => {
    setLoading(true)
    Promise.all([propAPI.lifetime(propId), propAPI.taxComparison(), propAPI.scheduleE(propId)])
      .then(([lifetimeRes, comparisonRes, scheduleRes]) => {
        setData(lifetimeRes.data)
        setComparison(comparisonRes.data)
        setScheduleE(scheduleRes.data)
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
  const scheduleHistory = scheduleE?.history || []
  const selectedYear = scheduleE?.selectedYear || taxSummary.current_year
  const selectedScheduleRow = scheduleHistory.find((row) => row.year === selectedYear && row.kind !== 'total')
  const projectedScheduleRow = scheduleHistory.find((row) => row.kind === 'projected_current_year')
  const totalScheduleRow = scheduleHistory.find((row) => row.kind === 'total')
  const completeRows = yearly.filter((row) => !row.is_partial && row.year < currentYear)
  const headlineRow = completeRows.at(-1) || yearly.filter((row) => !row.is_partial).at(-1) || yearly.at(-1) || {}
  const headlineYear = selectedYear || headlineRow.year || currentYear - 1
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
hero: { label: 'Estimated itemizable deduction', value: fmtKMB(primaryDeduction, { threshold: 1000 }), note: 'After SALT cap; mortgage cap label shown below', tone: 'blue' },
        components: [
{ label: 'Deductible interest', value: fmtKMB(deductibleInterest, { threshold: 1000 }), note: 'Mortgage cap context' },
{ label: 'Deductible property tax', value: fmtKMB(deductibleTax, { threshold: 1000 }), note: 'SALT capped at $10,000' },
{ label: 'Standard deduction', value: fmtKMB(standardDeduction, { threshold: 1000 }), note: 'MFJ comparison placeholder' },
        ],
        lifetime: [
 { label: 'Interest paid to date', value: fmtKMB(lifetime.total_interest_paid, { threshold: 1000 }) },
 { label: 'Loan balance', value: fmtKMB(lifetime.current_loan_balance, { threshold: 1000 }) },
          { label: 'Itemize verdict', value: itemizeVerdict },
        ],
        banner: 'Primary residence deductions are subject to mortgage-interest and SALT caps. Filing status and origination rules can change the result; not tax advice.',
        columns: ['Year', 'Property tax', 'Interest paid', 'Deductible int', 'Balance'],
      }
    : {
        header: 'Schedule E',
        subtitle: 'Rental taxable P&L from income, expenses, mortgage interest, and depreciation.',
hero: { label: 'Net Sch E', value: selectedScheduleRow?.netScheduleE?.display || fmtKMB(rentalCurrent.net_schedule_e, { threshold: 1000 }), note: 'Flows to 1040', tone: (selectedScheduleRow?.netScheduleE?.value ?? rentalCurrent.net_schedule_e ?? 0) < 0 ? 'red' : 'green' },
        components: [
{ label: 'Rental income', value: selectedScheduleRow?.rentalIncome?.display || fmtKMB(rentalCurrent.rental_income, { threshold: 1000 }) },
{ label: 'Mortgage interest', value: selectedScheduleRow?.mortgageInterest?.display || fmtKMB(rentalCurrent.mortgage_interest, { threshold: 1000 }), note: 'Fully deductible - rental' },
{ label: 'Depreciation', value: selectedScheduleRow?.depreciation?.display || (rentalCurrent.depreciation == null ? 'N/A' : fmtKMB(rentalCurrent.depreciation, { threshold: 1000 })), note: 'Non-cash' },
        ],
        lifetime: [
 { label: 'Accumulated net Sch E', value: totalScheduleRow?.netScheduleE?.display || fmtKMB(rentalLifetime.net_schedule_e, { threshold: 1000 }) },
 { label: 'Accumulated depreciation', value: totalScheduleRow?.depreciation?.display || fmtKMB(rentalLifetime.accumulated_depreciation, { threshold: 1000 }) },
 { label: 'Suspended losses', value: fmtKMB(rentalLifetime.suspended_losses, { threshold: 1000 }) },
        ],
        banner: 'Passive-loss rules may limit Schedule E losses. If MAGI is above the phaseout range, review Form 8582 carryforwards.',
        columns: ['Year', 'Income', 'Op ex', 'Interest', 'Depreciation', 'Net Sch E'],
      }

  const exportCSV = () => {
    const sourceRows = type === 'PRIMARY' || !scheduleHistory.length
      ? yearly.map((row) => [row.year, row.taxes_paid || row.property_tax || 0, row.interest_paid || 0, row.interest_paid || 0, row.loan_balance || row.balance || 0])
      : scheduleHistory.map((row) => [
          row.label || row.year,
          row.sourceLabel || '',
          row.rentalIncome?.value ?? 0,
          row.operatingExpenses?.value ?? 0,
          row.mortgageInterest?.value ?? 0,
          row.depreciation?.value ?? 0,
          row.netScheduleE?.value ?? 0,
        ])
    const headers = type === 'PRIMARY' || !scheduleHistory.length ? config.columns : ['Year', 'Source', 'Rental income', 'Operating expenses', 'Mortgage interest', 'Depreciation', 'Net Sch E']
    const lines = [headers.join(','), ...sourceRows.map((row) => row.join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.header.toLowerCase().replace(/\s+/g, '_')}_${propertyLabel(property).replace(/\s+/g, '_') || propId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleExpanded = (rowKey) => setExpandedRows((current) => ({ ...current, [rowKey]: !current[rowKey] }))
  const rentalHistoryRows = scheduleHistory.length ? scheduleHistory : yearly.map((row) => ({
    year: row.year,
    label: row.is_partial ? `${row.year} partial` : String(row.year),
    kind: row.is_partial ? 'partial' : 'year',
    sourceLabel: row.is_partial ? 'Partial' : 'Computed',
    rentalIncome: { value: row.rental_income || 0, display: fmt(row.rental_income || 0) },
    operatingExpenses: { value: row.operating_expenses || 0, display: fmt(row.operating_expenses || 0) },
    mortgageInterest: { value: row.interest_paid || 0, display: fmt(row.interest_paid || 0) },
    depreciation: { value: row.depreciation || 0, display: fmt(row.depreciation || 0) },
    netScheduleE: { value: row.taxable_income ?? row.net_schedule_e ?? 0, display: fmt(row.taxable_income ?? row.net_schedule_e ?? 0) },
  }))

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Taxes</p>
          <h3 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">{config.header} - {headlineYear}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{config.subtitle}</p>
          {projectedScheduleRow ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {projectedScheduleRow.label} is a full-year estimate. Expand it in History to see now vs projected remainder.
            </p>
          ) : null}
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
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Schedule E history</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">One backend-owned yearly view. Current year expands into now and projected remainder.</p>
          </div>
          {totalScheduleRow ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right dark:border-gray-700 dark:bg-gray-800/70">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Accumulated net</p>
              <p className={`text-base font-semibold ${(totalScheduleRow.netScheduleE?.value || 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>{totalScheduleRow.netScheduleE?.display}</p>
            </div>
          ) : null}
        </div>
        {type === 'PRIMARY' ? (
          <DataTable
            columns={[
              { id: 'year', header: 'Year', align: 'center', sortValue: (row) => row.year, cellClassName: 'font-medium text-gray-900 dark:text-white', render: (row) => row.is_partial ? `${row.year} partial` : row.year },
              { id: 'property_tax', header: 'Property Tax', align: 'right', sortValue: (row) => row.taxes_paid || row.property_tax || 0, render: (row) => fmt(row.taxes_paid || row.property_tax || 0) },
              { id: 'mortgage_interest', header: 'Mortgage Interest', align: 'right', accessor: 'interest_paid', render: (row) => fmt(row.interest_paid || 0) },
              { id: 'deductible_interest', header: 'Deductible Interest', align: 'right', accessor: 'interest_paid', render: (row) => fmt(row.interest_paid || 0) },
              { id: 'loan_balance', header: 'Loan Balance', align: 'right', sortValue: (row) => row.loan_balance || row.balance || 0, render: (row) => fmt(row.loan_balance || row.balance || 0) },
            ]}
            rows={yearly}
            getRowKey={(row) => row.year}
            defaultSort={{ id: 'year', direction: 'asc' }}
          />
        ) : (
          <DataTable
            columns={[
              {
                id: 'year',
                header: 'Year',
                align: 'center',
                sortValue: (row) => row.year,
                cellClassName: 'font-medium text-gray-900 dark:text-white',
                render: (row) => (
                  <button
                    type="button"
                    disabled={!row.detailRows?.length}
                    onClick={() => row.detailRows?.length && toggleExpanded(row.year)}
                    className={`inline-flex items-center justify-center gap-1.5 ${row.detailRows?.length ? 'text-blue-700 hover:text-blue-800 dark:text-blue-300' : ''}`}
                  >
                    {row.detailRows?.length ? (expandedRows[row.year] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
                    <span>{row.label || row.year}</span>
                  </button>
                ),
              },
              { id: 'source', header: 'Source', sortable: false, render: (row) => row.sourceLabel || '—' },
              { id: 'rental_income', header: 'Rental Income', align: 'right', sortValue: (row) => row.rentalIncome?.value ?? 0, cellClassName: 'text-green-600', render: (row) => row.rentalIncome?.display ?? '—' },
              { id: 'operating_expenses', header: 'Operating Expenses', align: 'right', sortValue: (row) => row.operatingExpenses?.value ?? 0, render: (row) => row.operatingExpenses?.display ?? '—' },
              { id: 'mortgage_interest', header: 'Mortgage Interest', align: 'right', sortValue: (row) => row.mortgageInterest?.value ?? 0, render: (row) => row.mortgageInterest?.display ?? '—' },
              { id: 'depreciation', header: 'Depreciation', align: 'right', sortValue: (row) => row.depreciation?.value ?? 0, cellClassName: 'text-purple-600', render: (row) => row.depreciation?.display ?? '—' },
              { id: 'taxable_income', header: 'Taxable Income', align: 'right', sortValue: (row) => row.netScheduleE?.value ?? 0, render: (row) => <span className={(row.netScheduleE?.value || 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{row.netScheduleE?.display ?? '—'}</span> },
            ]}
            rows={rentalHistoryRows}
            getRowKey={(row) => `${row.kind || 'year'}-${row.year}`}
            getRowProps={(row) => row.kind === 'total'
              ? { className: 'bg-gray-100 font-semibold dark:bg-gray-800/80' }
              : row.kind === 'projected_current_year'
                ? { className: 'bg-amber-50/70 dark:bg-amber-950/10' }
                : {}}
            renderExpandedRow={(row) => (row.detailRows?.length && expandedRows[row.year] ? (
              <div className="overflow-auto rounded-lg border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-900/40">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Line</th>
                      <th className="px-3 py-2 text-left font-medium">Source</th>
                      <th className="px-3 py-2 text-right font-medium">Rental income</th>
                      <th className="px-3 py-2 text-right font-medium">Operating expenses</th>
                      <th className="px-3 py-2 text-right font-medium">Mortgage interest</th>
                      <th className="px-3 py-2 text-right font-medium">Depreciation</th>
                      <th className="px-3 py-2 text-right font-medium">Taxable income</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {row.detailRows.map((detail) => (
                      <tr key={detail.kind}>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{detail.label}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{detail.sourceLabel || '—'}</td>
                        <td className="px-3 py-2 text-right text-green-600">{detail.metrics?.rentsReceived?.display ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.operatingExpenses?.display ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.mortgageInterest?.display ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-purple-600">{detail.metrics?.depreciation?.display ?? '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium ${(detail.metrics?.netScheduleE?.value || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{detail.metrics?.netScheduleE?.display ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null)}
            defaultSort={{ id: 'year', direction: 'asc' }}
          />
        )}
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

function TaxesTab({ propId }) {
  const navigate = useNavigate()
  const [scheduleE, setScheduleE] = useState(null)
  const [selectedYear, setSelectedYear] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCompare, setShowCompare] = useState(false)
  const [expandedCurrentYear, setExpandedCurrentYear] = useState(false)
  const [expandedTaxHistoryRows, setExpandedTaxHistoryRows] = useState({})

  useEffect(() => {
    setLoading(true)
    Promise.all([propAPI.scheduleE(propId, selectedYear), propAPI.taxComparison()])
      .then(([scheduleRes, comparisonRes]) => {
        setScheduleE(scheduleRes.data)
        setComparison(comparisonRes.data)
        if (!selectedYear && scheduleRes.data?.selectedYear) {
          setSelectedYear(scheduleRes.data.selectedYear)
        }
      })
      .catch(() => toast.error('Failed to load Schedule E data'))
      .finally(() => setLoading(false))
  }, [propId, selectedYear])

  if (loading) return (
    <div className="flex h-40 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  const topStrip = scheduleE?.topStrip || {}
  const summary = scheduleE?.summary || {}
  const scheduleLines = scheduleE?.lines || []
  const historyRows = scheduleE?.history || []
  const availableYears = scheduleE?.availableYears || []
  const currentYearBreakdown = scheduleE?.currentYearBreakdown
  const statusClass = (status) => {
    if (status === 'Match') return 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
    if (status === 'Delta') return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Schedule E reconciliation</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Computed PropertyLens lines compared with the filed return for the selected year.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availableYears.length ? (
              <select
                value={selectedYear || scheduleE?.selectedYear || ''}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                className="form-input py-2 text-sm"
                aria-label="Select tax year"
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            ) : null}
            <button onClick={() => navigate(`/properties/${propId}/documents`)} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Upload className="h-3.5 w-3.5" /> Upload filed Sch E
            </button>
            <button onClick={() => setShowCompare((s) => !s)} className="btn-secondary text-sm">
              {showCompare ? 'Hide comparison' : 'Compare all properties'}
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricKPI label="Deductible interest" metric={topStrip.deductibleInterest} backendOwned />
          <MetricKPI label="Property tax" metric={topStrip.propertyTax} backendOwned />
          <MetricKPI label="Depreciation" metric={topStrip.depreciation} backendOwned />
          <MetricKPI label="Net Sch E" metric={topStrip.netScheduleE} backendOwned />
        </div>

        {currentYearBreakdown ? (
          <div className="mb-5 rounded-lg border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/30">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-medium text-gray-900 dark:text-white">Current-year total</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">{currentYearBreakdown.summary}</p>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                As of {formatDate(currentYearBreakdown.asOfDate)}
              </span>
            </div>
            <DataTable
              columns={[
                {
                  id: 'label',
                  header: 'Line',
                  sortable: false,
                  render: (row) => (
                    <button
                      type="button"
                      onClick={() => row.expandable && setExpandedCurrentYear((value) => !value)}
                      className={`inline-flex items-center gap-2 font-medium ${row.expandable ? 'text-blue-700 hover:text-blue-800 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}
                    >
                      {row.expandable ? (expandedCurrentYear ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="h-4 w-4" />}
                      <span>{row.label}</span>
                    </button>
                  ),
                },
                { id: 'source', header: 'Source', sortable: false, render: (row) => row.sourceLabel || '—' },
                { id: 'rents', header: 'Rents', align: 'right', sortValue: (row) => row.metrics?.rentsReceived?.value ?? 0, render: (row) => row.metrics?.rentsReceived?.display ?? '—' },
                { id: 'interest', header: 'Interest', align: 'right', sortValue: (row) => row.metrics?.mortgageInterest?.value ?? 0, render: (row) => row.metrics?.mortgageInterest?.display ?? '—' },
                { id: 'propertyTax', header: 'Property tax', align: 'right', sortValue: (row) => row.metrics?.propertyTax?.value ?? 0, render: (row) => row.metrics?.propertyTax?.display ?? '—' },
                { id: 'depreciation', header: 'Depreciation', align: 'right', sortValue: (row) => row.metrics?.depreciation?.value ?? 0, render: (row) => row.metrics?.depreciation?.display ?? '—' },
                { id: 'netScheduleE', header: 'Net Sch E', align: 'right', sortValue: (row) => row.metrics?.netScheduleE?.value ?? 0, render: (row) => row.metrics?.netScheduleE?.display ?? '—' },
              ]}
              rows={currentYearBreakdown.rows || []}
              getRowKey={(row) => row.kind}
              renderExpandedRow={(row) => (row.expandable && expandedCurrentYear ? (
                <div className="overflow-auto rounded-lg border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-900/40">
                  <table className="min-w-full text-sm">
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {(currentYearBreakdown.detailRows || []).map((detail) => (
                        <tr key={detail.kind}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{detail.label}</td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{detail.sourceLabel}</td>
                          <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.rentsReceived?.display ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.mortgageInterest?.display ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.propertyTax?.display ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.depreciation?.display ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{detail.metrics?.netScheduleE?.display ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null)}
              tableWrapperClassName="overflow-auto"
            />
          </div>
        ) : null}

        {!scheduleLines.length ? (
          <div className="py-10 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-400 dark:text-gray-500">No Schedule E data is available yet.</p>
          </div>
        ) : (
          <DataTable
            columns={[
              { id: 'lineNumber', header: 'Line#', align: 'center', accessor: 'lineNumber', cellClassName: 'font-medium text-gray-900 dark:text-white' },
              { id: 'lineItem', header: 'Line item', accessor: 'lineItem', cellClassName: 'font-medium text-gray-900 dark:text-white' },
              { id: 'computed', header: 'Computed', align: 'right', sortValue: (row) => row.computed?.value ?? 0, render: (row) => row.computed?.display ?? '—' },
              { id: 'filed', header: 'Filed', align: 'right', sortValue: (row) => row.filed?.value ?? null, render: (row) => row.filed?.display ?? '—' },
              { id: 'delta', header: 'Delta', align: 'right', sortValue: (row) => row.delta?.value ?? 0, render: (row) => row.delta?.display ?? '—' },
              {
                id: 'status',
                header: 'Status',
                sortable: false,
                render: (row) => <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(row.status)}`}>{row.status}</span>,
              },
            ]}
            rows={scheduleLines}
            getRowKey={(row) => `${row.lineNumber}-${row.key}`}
            defaultSort={{ id: 'lineNumber', direction: 'asc' }}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card xl:col-span-1">
          <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Filed reconciliation</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-gray-400">Lines matched</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{summary.linesMatched ?? 0} of {summary.linesFiled ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-gray-400">Net delta</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{summary.netDelta?.display ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-gray-400">Filed source</dt>
              <dd className="max-w-[12rem] truncate text-right font-medium text-gray-900 dark:text-white" title={summary.filedSource || ''}>{summary.filedSource || '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="card xl:col-span-2">
          <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Lifetime tax position</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricKPI label="Lifetime net Sch E" metric={summary.lifetimeNetScheduleE} backendOwned />
            <MetricKPI label="Accumulated depreciation" metric={summary.accumulatedDepreciation} backendOwned />
            <MetricKPI label="Suspended losses" metric={summary.suspendedLosses} backendOwned />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Schedule E history</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">Top strip, line table, and history use the same backend Schedule E values.</p>
        </div>
        <DataTable
          columns={[
            {
              id: 'year',
              header: 'Year',
              align: 'center',
              sortValue: (row) => row.year,
              cellClassName: 'font-medium text-gray-900 dark:text-white',
              render: (row) => (
                <button
                  type="button"
                  disabled={!row.detailRows?.length}
                  onClick={() => row.detailRows?.length && setExpandedTaxHistoryRows((current) => ({ ...current, [row.year]: !current[row.year] }))}
                  className={`inline-flex items-center justify-center gap-1.5 ${row.detailRows?.length ? 'text-blue-700 hover:text-blue-800 dark:text-blue-300' : ''}`}
                >
                  {row.detailRows?.length ? (expandedTaxHistoryRows[row.year] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
                  <span>{row.label || row.year}</span>
                </button>
              ),
            },
            { id: 'source', header: 'Source', sortable: false, render: (row) => row.sourceLabel || '—' },
            { id: 'deductibleInterest', header: 'Deductible interest', align: 'right', sortValue: (row) => row.deductibleInterest?.value ?? 0, render: (row) => row.deductibleInterest?.display ?? '—' },
            { id: 'propertyTax', header: 'Property tax', align: 'right', sortValue: (row) => row.propertyTax?.value ?? 0, render: (row) => row.propertyTax?.display ?? '—' },
            { id: 'depreciation', header: 'Depreciation', align: 'right', sortValue: (row) => row.depreciation?.value ?? 0, render: (row) => row.depreciation?.display ?? '—' },
            { id: 'netScheduleE', header: 'Net Sch E', align: 'right', sortValue: (row) => row.netScheduleE?.value ?? 0, render: (row) => row.netScheduleE?.display ?? '—' },
          ]}
          rows={historyRows}
          getRowKey={(row) => row.year}
          getRowProps={(row) => row.kind === 'total'
            ? { className: 'bg-gray-100 font-semibold dark:bg-gray-800/80' }
            : row.kind === 'projected_current_year'
              ? { className: 'bg-amber-50/70 dark:bg-amber-950/10' }
              : {}}
          renderExpandedRow={(row) => (row.detailRows?.length && expandedTaxHistoryRows[row.year] ? (
            <div className="overflow-auto rounded-lg border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-900/40">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Line</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-right font-medium">Deductible interest</th>
                    <th className="px-3 py-2 text-right font-medium">Property tax</th>
                    <th className="px-3 py-2 text-right font-medium">Depreciation</th>
                    <th className="px-3 py-2 text-right font-medium">Net Sch E</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {row.detailRows.map((detail) => (
                    <tr key={detail.kind}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{detail.label}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{detail.sourceLabel || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.mortgageInterest?.display ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.propertyTax?.display ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">{detail.metrics?.depreciation?.display ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{detail.metrics?.netScheduleE?.display ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null)}
          defaultSort={{ id: 'year', direction: 'asc' }}
        />
      </div>

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
      <DataTable
        columns={[
          {
            id: 'property',
            header: 'Property',
            sortable: false,
            render: (row) => row.isTotal ? (
              <span className="font-semibold text-gray-900 dark:text-white">Total</span>
            ) : (
              <>
                <span className="font-medium text-gray-900 dark:text-white">
                  {row.property_name || (row.property_uid ? `ID ${row.property_uid.slice(0, 8).toUpperCase()}` : 'Unlinked property')}
                </span>
                {row.property_kind === 'primary' ? (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">primary</span>
                ) : null}
                {!row.property_id ? (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:text-gray-400">unlinked</span>
                ) : null}
              </>
            ),
          },
          ...COLS.map(([key, label]) => ({
            id: key,
            header: label,
            align: 'right',
            sortable: false,
            render: (row) => {
              const value = row.isTotal ? row.totals?.[key] : row[key]
              const tone = key === 'net_income' && !row.isTotal
                ? value >= 0 ? 'text-green-600' : 'text-red-500'
                : ''
              return <span className={tone}>{value != null ? fmt(value) : '—'}</span>
            },
          })),
        ]}
        rows={[...yr.entries, { id: `total-${yr.tax_year}`, isTotal: true, totals: yr.totals }]}
        getRowKey={(row) => row.id}
        getRowProps={(row) => ({
          className: row.isTotal
            ? 'border-t-2 border-gray-200 bg-gray-50 font-semibold dark:border-gray-700 dark:bg-gray-700/50'
            : `hover:bg-gray-50 dark:hover:bg-gray-700/50 ${row.property_id === currentPropId ? 'bg-blue-50/50' : ''}`,
        })}
      />
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
<DataTable
columns={[
{ id: 'year', header: 'Year', align: 'center', accessor: 'year', cellClassName: 'font-medium text-gray-900 dark:text-white' },
{ id: 'rent', header: 'Rent Collected', align: 'right', accessor: 'rent', cellClassName: 'font-medium text-green-600', render: (row) => row.rent != null ? fmt(row.rent) : <span className="text-gray-300">—</span> },
{ id: 'source', header: 'Source', align: 'right', sortable: false, render: (row) => <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${row.rentSource === 'tax_return' ? 'bg-purple-100 text-purple-700' : row.rentSource === 'leases' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400 dark:text-gray-500'}`}>{row.rentSource === 'tax_return' ? 'Sch-E' : row.rentSource === 'leases' ? 'leases' : '—'}</span> },
{ id: 'days_rented', header: 'Days Rented', align: 'right', accessor: 'daysRented', cellClassName: 'font-medium text-blue-700', render: (row) => row.daysRented != null ? `${row.daysRented}d` : <span className="text-gray-300">—</span> },
{ id: 'personal_days', header: 'Personal Days', align: 'right', accessor: 'personalDays', cellClassName: 'text-orange-600', render: (row) => row.personalDays != null && row.personalDays > 0 ? `${row.personalDays}d` : <span className="text-gray-300">—</span> },
{ id: 'occupancy', header: 'Occupancy', align: 'right', accessor: 'occupancyFromDays', cellClassName: 'font-medium', render: (row) => row.occupancyFromDays != null ? fmtPct(row.occupancyFromDays) : '—' },
{ id: 'occupancy_bar', header: '', sortable: false, render: (row) => row.occupancyFromDays != null ? <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${row.occupancyFromDays >= 95 ? 'bg-green-500' : row.occupancyFromDays >= 70 ? 'bg-blue-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, row.occupancyFromDays)}%` }} /></div> : null },
{ id: 'lease_summary', header: 'Months / Lease', align: 'right', sortable: false, render: (row) => <div className="text-right text-xs text-gray-500 dark:text-gray-400">{row.leaseSummary}</div> },
]}
rows={allYears.map((yr) => {
const tax = taxByYear.get(yr)
const leasePeriods = periodsByYear.get(yr) || []
const rent = tax?.rents_received ?? leasePeriods.reduce((sum, p) => sum + (p.rent || p.monthly_rent || 0) * (p.months || 0), 0)
const rentSource = tax?.rents_received != null ? 'tax_return' : leasePeriods.length ? 'leases' : null
const daysRented = tax?.days_rented ?? tax?.fair_rental_days
const personalDays = tax?.personal_use_days
const yearDays = yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0) ? 366 : 365
const occupancyFromDays = daysRented != null ? Math.round(daysRented / yearDays * 100) : null
const leaseSummary = leasePeriods.length ? `${leasePeriods.length} period${leasePeriods.length === 1 ? '' : 's'}` : '—'
return { year: yr, rent, rentSource, daysRented, personalDays, occupancyFromDays, leaseSummary }
})}
getRowKey={(row) => row.year}
defaultSort={{ id: 'year', direction: 'asc' }}
/>
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

// Legacy RawDataTab verification grid removed. The active Verify tab now renders backend-owned verification DTOs.

function rawDataValueText(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '—'
  }
}

function rawDataColumn(id, header, options = {}) {
  return {
    id,
    header,
    accessor: id,
    render: (row, value) => <span className="break-words">{rawDataValueText(value)}</span>,
    exportValue: (row) => rawDataValueText(row[id]),
    searchValue: (row) => rawDataValueText(row[id]),
    ...options,
  }
}

function rawDataYearLabel(year) {
  return year === null || year === undefined || year === '' ? 'Not annual' : String(year)
}

function rawDataRecordSearchText(row, columns) {
  return columns.map((column) => rawDataValueText(row[column.id])).join(' ').toLowerCase()
}

function rawDataTypeLabel(row) {
  return row.record_type || row.expense_type || row.source_type || row.loan_type || row.asset_type || row.usage_type || row.period_type || 'Other'
}

function rawDataGroup(id, title, description, columns, rows) {
  const sortedRows = [...rows].sort((left, right) => {
    const leftYear = Number(left.year || 99999)
    const rightYear = Number(right.year || 99999)
    if (leftYear !== rightYear) return leftYear - rightYear
    return String(left.document || left.lender || left.date || '').localeCompare(String(right.document || right.lender || right.date || ''))
  })
  return {
    id,
    title,
    description,
    columns,
    rows: sortedRows.map((row, index) => ({ ...row, id: row.id || `${id}-${index}` })),
  }
}

function rawDataFieldRows(recordType, values, fields) {
  return fields.map(([key, label]) => ({
    id: `${recordType}-${key}`,
    record_type: recordType,
    field: label,
    value: values?.[key],
    data_key: key,
    year: null,
  }))
}

const RAW_FIELD_VALUE_COLUMNS = [
  rawDataColumn('field', 'Field'),
  rawDataColumn('value', 'Value'),
  rawDataColumn('data_key', 'Data key'),
]

function rawDataRecordGroups(payload) {
  if (!payload) return []
  const groups = []

  if (payload.property_snapshot) {
    const property = payload.property_snapshot
    groups.push(rawDataGroup(
      'property-details',
      'Property details',
      'Identity, address, property type, and current use shown in Property Setup.',
      RAW_FIELD_VALUE_COLUMNS,
      rawDataFieldRows('Property', property, [
        ['id', 'Property ID'], ['property_uid', 'Property UID'], ['name', 'Property name'],
        ['address', 'Street'], ['city', 'City'], ['state', 'State'], ['zip_code', 'ZIP code'],
        ['property_type', 'Property type'], ['usage_type', 'Usage'],
        ['original_residency_status', 'Original residency'], ['current_residency_status', 'Current residency'],
        ['primary_start_date', 'Primary start'], ['primary_end_date', 'Primary end'],
        ['rental_start_date', 'Rental start'], ['rental_end_date', 'Rental end'], ['notes', 'Notes'],
      ]),
    ))
    groups.push(rawDataGroup(
      'purchase-valuation',
      'Purchase & valuation',
      'Purchase, settlement, and current market-value fields shown for this property.',
      RAW_FIELD_VALUE_COLUMNS,
      rawDataFieldRows('Purchase and valuation', property, [
        ['purchase_date', 'Purchase date'], ['purchase_price', 'Purchase price'],
        ['down_payment', 'Down payment'], ['settlement_total_amount', 'Final settlement total'],
        ['closing_costs', 'Closing costs'], ['market_value', 'Market price'],
        ['market_value_source', 'Valuation source'], ['market_value_updated', 'Valuation date'],
        ['land_value', 'Land value'], ['construction_price', 'Building basis'],
        ['depreciable_basis', 'Depreciable basis'],
      ]),
    ))
    groups.push(rawDataGroup(
      'operating-setup',
      'Operating setup',
      'Current rental and recurring expense assumptions from Property Setup.',
      RAW_FIELD_VALUE_COLUMNS,
      rawDataFieldRows('Operating setup', property, [
        ['monthly_rent', 'Monthly rent'], ['occupancy_rate', 'Occupancy rate'],
        ['property_tax', 'Property tax'], ['insurance', 'Insurance'],
        ['hoa_flag', 'Has HOA'], ['hoa_fee', 'HOA fee'], ['solar_ownership', 'Solar ownership'],
        ['maintenance', 'Maintenance'], ['property_management_fee', 'Property management fee'],
        ['utilities', 'Utilities'], ['vacancy_allowance', 'Vacancy allowance'],
        ['capex_reserve', 'CapEx reserve'], ['other_expenses', 'Other expenses'],
        ['depreciation_years', 'Depreciation years'], ['irs_annual_depreciation', 'Annual depreciation'],
      ]),
    ))
  }

  const loanSnapshotRows = payload.loan_snapshot || []
  if (loanSnapshotRows.length) {
    groups.push(rawDataGroup(
      'loan-snapshot',
      'Loans',
      'All debts and servicer records shown on the Loans tab, with active loans first.',
      [
        rawDataColumn('sequence', 'Order', { align: 'center' }),
        rawDataColumn('status', 'Status'),
        rawDataColumn('is_current_servicer', 'Current?', { align: 'center' }),
        rawDataColumn('lender', 'Lender'),
        rawDataColumn('account_number', 'Loan #'),
        rawDataColumn('loan_type', 'Type'),
        rawDataColumn('loan_group_id', 'Loan group'),
        rawDataColumn('servicer_sequence', 'Servicer seq', { align: 'center' }),
        rawDataColumn('servicer_start_date', 'Servicer start'),
        rawDataColumn('servicer_end_date', 'Servicer end'),
        rawDataColumn('transfer_reason', 'Transfer reason'),
        rawDataColumn('closed_date', 'Closed date'),
        rawDataColumn('closure_reason', 'Closure reason'),
        rawDataColumn('original_amount', 'Original amount', { align: 'right' }),
        rawDataColumn('current_balance', 'Current balance', { align: 'right' }),
        rawDataColumn('stored_current_balance', 'Stored balance', { align: 'right' }),
        rawDataColumn('current_balance_source', 'Balance source'),
        rawDataColumn('current_balance_as_of', 'Balance as of'),
        rawDataColumn('interest_rate', 'Rate', { align: 'right' }),
        rawDataColumn('monthly_payment', 'P&I / mo', { align: 'right' }),
        rawDataColumn('estimated_total_monthly_payment', 'Total payment / mo', { align: 'right' }),
        rawDataColumn('escrow_amount', 'Escrow / mo', { align: 'right' }),
        rawDataColumn('loan_term_years', 'Term', { align: 'right' }),
        rawDataColumn('origination_date', 'Origination'),
        rawDataColumn('maturity_date', 'Maturity'),
        rawDataColumn('statement_date', 'Statement date'),
        rawDataColumn('principal_due', 'Principal due', { align: 'right' }),
        rawDataColumn('interest_due', 'Interest due', { align: 'right' }),
        rawDataColumn('interest_paid_ytd', 'Interest YTD', { align: 'right' }),
        rawDataColumn('principal_paid_ytd', 'Principal YTD', { align: 'right' }),
        rawDataColumn('source_type', 'Source'),
      ],
      loanSnapshotRows.map((row) => ({ ...row, year: rawDataYearLabel(row.statement_date || row.origination_date).match(/(?:19|20)\d{2}/)?.[0] || null })),
    ))
  }

  const loanYearRows = payload.loan_yearly_history || []
  if (loanYearRows.length) {
    groups.push(rawDataGroup(
      'loan-yearly-history',
      'Loan by year',
      'The same backend-calculated annual balance chain shown on the Loans tab.',
      [
        rawDataColumn('year_label', 'Year'),
        rawDataColumn('loan_order', 'Loan order', { align: 'center' }),
        rawDataColumn('lender', 'Lender'),
        rawDataColumn('account_number', 'Loan #'),
        rawDataColumn('loan_status', 'Loan status'),
        rawDataColumn('start_balance', 'Start balance', { align: 'right' }),
        rawDataColumn('principal_paid', 'Principal', { align: 'right' }),
        rawDataColumn('scheduled_principal', 'Scheduled principal', { align: 'right' }),
        rawDataColumn('top_up', 'Top-up', { align: 'right' }),
        rawDataColumn('interest_paid', 'Interest', { align: 'right' }),
        rawDataColumn('end_balance', 'End balance', { align: 'right' }),
        rawDataColumn('source', 'Source'),
        rawDataColumn('issue_count', 'Issues', { align: 'center' }),
        rawDataColumn('comments', 'Notes'),
      ],
      loanYearRows.map((row) => ({ ...row, record_type: row.is_projection ? 'Projected' : 'Annual' })),
    ))
  }

  const usageRows = payload.usage_timeline || []
  if (usageRows.length) {
    groups.push(rawDataGroup(
      'usage-timeline',
      'Usage timeline',
      'Primary/rental usage periods that drive tax and rental calculations.',
      [
        rawDataColumn('usage_type', 'Usage'),
        rawDataColumn('start_date', 'Start date'),
        rawDataColumn('end_date', 'End date'),
        rawDataColumn('fmv_at_start', 'FMV at start', { align: 'right' }),
        rawDataColumn('monthly_rent', 'Monthly rent', { align: 'right' }),
        rawDataColumn('vacancy_allowance', 'Vacancy', { align: 'right' }),
        rawDataColumn('property_management_fee', 'Mgmt fee', { align: 'right' }),
        rawDataColumn('accumulated_depreciation_at_start', 'Accum depreciation', { align: 'right' }),
        rawDataColumn('suspended_losses_at_start', 'Suspended losses', { align: 'right' }),
        rawDataColumn('notes', 'Notes'),
      ],
      usageRows.map((row) => ({ ...row, year: String(row.start_date || '').match(/(?:19|20)\d{2}/)?.[0] || null })),
    ))
  }

  const rentalPeriodRows = payload.rental_periods || []
  if (rentalPeriodRows.length) {
    groups.push(rawDataGroup(
      'rental-periods',
      'Rental periods',
      'Lease/rental periods used to derive yearly rent and occupancy.',
      [
        rawDataColumn('tenant_name', 'Tenant / label'),
        rawDataColumn('start_year', 'Start year', { align: 'center' }),
        rawDataColumn('start_month', 'Start month', { align: 'center' }),
        rawDataColumn('end_year', 'End year', { align: 'center' }),
        rawDataColumn('end_month', 'End month', { align: 'center' }),
        rawDataColumn('monthly_rent', 'Monthly rent', { align: 'right' }),
        rawDataColumn('notes', 'Notes'),
      ],
      rentalPeriodRows.map((row) => ({ ...row, year: row.start_year })),
    ))
  }

  const annualExpenseRows = payload.annual_expenses || []
  if (annualExpenseRows.length) {
    groups.push(rawDataGroup(
      'annual-expenses',
      'Annual expenses',
      'Yearly operating expense rows from setup, documents, or projections.',
      [
        rawDataColumn('year', 'Year', { align: 'center' }),
        rawDataColumn('property_tax', 'Property tax', { align: 'right' }),
        rawDataColumn('insurance', 'Insurance', { align: 'right' }),
        rawDataColumn('hoa', 'HOA', { align: 'right' }),
        rawDataColumn('repairs_maintenance', 'Repairs', { align: 'right' }),
        rawDataColumn('property_management', 'Mgmt', { align: 'right' }),
        rawDataColumn('utilities', 'Utilities', { align: 'right' }),
        rawDataColumn('vacancy_allowance', 'Vacancy', { align: 'right' }),
        rawDataColumn('capex_reserve', 'CapEx', { align: 'right' }),
        rawDataColumn('other', 'Other', { align: 'right' }),
        rawDataColumn('total', 'Total expenses', { align: 'right' }),
        rawDataColumn('property_tax_source', 'Tax source'),
        rawDataColumn('property_tax_source_label', 'Tax source label'),
        rawDataColumn('insurance_source', 'Insurance source'),
        rawDataColumn('insurance_source_label', 'Insurance source label'),
        rawDataColumn('source_status', 'Status'),
        rawDataColumn('notes', 'Notes'),
      ],
      annualExpenseRows,
    ))
  }

  const depreciationAssetRows = payload.depreciation_assets || []
  if (depreciationAssetRows.length) {
    groups.push(rawDataGroup(
      'depreciation-assets',
      'Depreciation assets',
      'Asset-level depreciation and amortization setup rows.',
      [
        rawDataColumn('asset_type', 'Type'),
        rawDataColumn('description', 'Description'),
        rawDataColumn('placed_in_service_date', 'Placed in service'),
        rawDataColumn('cost_basis', 'Cost basis', { align: 'right' }),
        rawDataColumn('land_portion', 'Land portion', { align: 'right' }),
        rawDataColumn('method', 'Method'),
        rawDataColumn('recovery_period', 'Recovery period', { align: 'right' }),
        rawDataColumn('prior_depreciation', 'Prior depreciation', { align: 'right' }),
        rawDataColumn('notes', 'Notes'),
      ],
      depreciationAssetRows.map((row) => ({ ...row, year: String(row.placed_in_service_date || '').match(/(?:19|20)\d{2}/)?.[0] || null })),
    ))
  }

  const taxRows = (payload.tax_entries || []).map((entry, index) => ({
    id: `schedule-e-${entry.id || index}`,
    year: entry.tax_year,
    document: entry.document_name,
    rents_received: entry.rents_received,
    mortgage_interest: entry.mortgage_interest,
    property_taxes: entry.property_taxes,
    depreciation: entry.depreciation,
    total_expenses: entry.total_expenses,
    net_income: entry.net_income,
    days_rented: entry.days_rented,
    personal_use_days: entry.personal_use_days,
    confidence: entry.confidence,
    import_date: entry.import_date,
  }))
  if (taxRows.length) {
    groups.push(rawDataGroup(
      'tax-history',
      'Tax history',
      'Annual rental-tax values displayed in the Taxes area, with source provenance.',
      [
        rawDataColumn('year', 'Year', { align: 'center' }),
        rawDataColumn('document', 'Source'),
        rawDataColumn('rents_received', 'Rents', { align: 'right' }),
        rawDataColumn('mortgage_interest', 'Mortgage interest', { align: 'right' }),
        rawDataColumn('property_taxes', 'Property taxes', { align: 'right' }),
        rawDataColumn('depreciation', 'Depreciation', { align: 'right' }),
        rawDataColumn('total_expenses', 'Total expenses', { align: 'right' }),
        rawDataColumn('net_income', 'Net income', { align: 'right' }),
        rawDataColumn('days_rented', 'Days rented', { align: 'center' }),
        rawDataColumn('personal_use_days', 'Personal days', { align: 'center' }),
        rawDataColumn('confidence', 'Confidence', { align: 'right' }),
        rawDataColumn('import_date', 'Source date'),
      ],
      taxRows,
    ))
  }

  const leaseRows = Object.entries(payload.lease_rent || {}).map(([year, values]) => ({
    id: `lease-${year}`,
    year,
    income: values?.income,
    occupied_months: values?.occupied_months,
    occupancy: values?.occupancy,
    lease_days: values?.lease_days,
  }))
  if (leaseRows.length) {
    groups.push(rawDataGroup(
      'annual-rental-income',
      'Annual rental income',
      'Yearly rental income and occupancy displayed across Rental, Expenses, and Taxes.',
      [
        rawDataColumn('year', 'Year', { align: 'center' }),
        rawDataColumn('income', 'Income', { align: 'right' }),
        rawDataColumn('occupied_months', 'Occupied months', { align: 'right' }),
        rawDataColumn('occupancy', 'Occupancy', { align: 'right' }),
        rawDataColumn('lease_days', 'Lease days', { align: 'right' }),
      ],
      leaseRows,
    ))
  }

  const validationRows = (payload.duplicate_validations || []).map((validation, index) => ({
    id: `duplicate-validation-${index}`,
    year: validation.tax_year,
    document_type: validation.document_type,
    source_identity: validation.source_identity,
    count: validation.count,
    status: validation.status,
    message: validation.message,
  }))
  if (validationRows.length || payload.irs_annual_depreciation !== undefined) {
    groups.push(rawDataGroup(
      'data-validation',
      'Data validation',
      'Backend checks and derived values that help explain discrepancies in the property tables.',
      [
        rawDataColumn('year', 'Year', { align: 'center' }),
        rawDataColumn('document_type', 'Type'),
        rawDataColumn('source_identity', 'Source identity'),
        rawDataColumn('count', 'Count', { align: 'right' }),
        rawDataColumn('status', 'Status'),
        rawDataColumn('message', 'Message'),
        rawDataColumn('irs_annual_depreciation', 'IRS annual depreciation', { align: 'right' }),
      ],
      [
        ...validationRows,
        ...(payload.irs_annual_depreciation !== undefined ? [{
          id: 'irs-annual-depreciation',
          year: null,
          document_type: 'IRS depreciation model',
          irs_annual_depreciation: payload.irs_annual_depreciation,
        }] : []),
      ],
    ))
  }

  return groups
}

function rawDataSheetName(name, usedNames) {
  const base = String(name || 'Raw data').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Raw data'
  let candidate = base
  let index = 2
  while (usedNames.has(candidate)) {
    const suffix = ` ${index}`
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`
    index += 1
  }
  usedNames.add(candidate)
  return candidate
}

function exportRawDataWorkbook(groups, propId, query) {
  const wb = utils.book_new()
  const usedNames = new Set()
  groups.forEach((group) => {
    const rows = query
      ? group.rows.filter((row) => rawDataRecordSearchText(row, group.columns).includes(query))
      : group.rows
    if (!rows.length) return
    const headers = group.columns.map((column) => column.header)
    const body = rows.map((row) => group.columns.map((column) => rawDataValueText(row[column.id])))
    const ws = utils.aoa_to_sheet([headers, ...body])
    utils.book_append_sheet(wb, ws, rawDataSheetName(group.title, usedNames))
  })
  if (!wb.SheetNames.length) {
    const ws = utils.aoa_to_sheet([['No raw data records']])
    utils.book_append_sheet(wb, ws, 'Raw data')
  }
  writeFile(wb, `property-${propId}-data-workbook.xlsx`)
}

function rawDataMobileRecordLabel(row, index) {
  return row.year_label || row.year || row.field || row.name || row.lender || row.description || row.tenant_name || row.usage_type || `Record ${index + 1}`
}

function RawDataMobileRecords({ group, rows }) {
  if (!rows.length) {
    return <div className="p-6 text-center text-sm text-gray-400">No records match the current filters.</div>
  }
  const isFieldValueTable = group.columns.some((column) => column.id === 'field') && group.columns.some((column) => column.id === 'value')
  if (isFieldValueTable) {
    return (
      <dl className="divide-y divide-gray-100 px-4 dark:divide-gray-800 md:hidden">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[minmax(7rem,42%)_1fr] gap-3 py-3">
            <dt className="min-w-0">
              <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">{row.field}</span>
              <span className="mt-0.5 block break-all text-[10px] text-gray-400 dark:text-gray-500">{row.data_key}</span>
            </dt>
            <dd className="min-w-0 break-words text-right text-sm font-medium text-gray-900 dark:text-gray-100">{rawDataValueText(row.value)}</dd>
          </div>
        ))}
      </dl>
    )
  }
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden">
      {rows.map((row, index) => (
        <details key={row.id} className="group px-4 py-1" open={rows.length === 1}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 marker:content-none">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{rawDataMobileRecordLabel(row, index)}</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{rawDataTypeLabel(row)}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl className="grid grid-cols-1 gap-x-4 border-t border-gray-100 py-2 dark:border-gray-800 sm:grid-cols-2">
            {group.columns.map((column) => {
              const value = row[column.id]
              return (
                <div key={column.id} className="grid grid-cols-[minmax(7rem,42%)_1fr] gap-3 border-b border-gray-50 py-2.5 last:border-0 dark:border-gray-800/70 sm:block">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">{column.header}</dt>
                  <dd className="min-w-0 break-words text-right text-sm text-gray-900 dark:text-gray-100 sm:mt-1 sm:text-left">
                    {column.render ? column.render(row, value) : rawDataValueText(value)}
                  </dd>
                </div>
              )
            })}
          </dl>
        </details>
      ))}
    </div>
  )
}

function ExtractedRawDataTab({ propId }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activeGroupId, setActiveGroupId] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    propAPI.rawdata(propId)
      .then((resp) => {
        if (active) setPayload(resp.data || {})
      })
      .catch((err) => {
        if (!active) return
        setError(err.response?.data?.detail?.message || err.response?.data?.detail || err.message || 'Raw data is unavailable.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [propId])

  if (loading) {
    return (
      <div className="card">
        <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-4 h-48 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 dark:border-red-900/70 dark:bg-red-950/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">Raw data unavailable</h2>
            <p className="mt-1 text-sm text-red-700 dark:text-red-200">{rawDataValueText(error)}</p>
          </div>
        </div>
      </div>
    )
  }

  const groups = rawDataRecordGroups(payload)
  const activeGroup = groups.find((group) => group.id === activeGroupId) || groups[0]
  const normalizedQuery = query.trim().toLowerCase()
  const recordCount = groups.reduce((sum, group) => sum + group.rows.length, 0)
  const activeRows = activeGroup?.rows || []
  const yearOptions = [...new Set(activeRows.map((row) => rawDataYearLabel(row.year)))].sort((left, right) => {
    if (left === 'Not annual') return 1
    if (right === 'Not annual') return -1
    return Number(left) - Number(right)
  })
  const typeOptions = [...new Set(activeRows.map((row) => rawDataTypeLabel(row)).filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)))
  const visibleRows = activeRows.filter((row) => {
    const matchesSearch = !normalizedQuery || rawDataRecordSearchText(row, activeGroup.columns).includes(normalizedQuery)
    const matchesYear = yearFilter === 'all' || rawDataYearLabel(row.year) === yearFilter
    const matchesType = typeFilter === 'all' || rawDataTypeLabel(row) === typeFilter
    return matchesSearch && matchesYear && matchesType
  })

  return (
    <section className="min-w-0 space-y-4">
      <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Raw data</p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">Property data workbook</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Application data shown across this property: setup fields, loans, rental activity, expenses, taxes, and depreciation. Uploaded-document inventory remains in Documents.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[24rem] sm:text-right">
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Tables</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{groups.length}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Records</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{recordCount}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Visible</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{visibleRows.length}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 sm:hidden">
        <label htmlFor="raw-data-table" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">Data table</label>
        <select
          id="raw-data-table"
          value={activeGroup?.id || ''}
          onChange={(event) => {
            setActiveGroupId(event.target.value)
            setYearFilter('all')
            setTypeFilter('all')
          }}
          className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          {groups.map((group) => <option key={group.id} value={group.id}>{group.title} ({group.rows.length})</option>)}
        </select>
      </div>
      <div className="mt-5 hidden gap-2 overflow-x-auto pb-1 sm:flex">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => {
              setActiveGroupId(group.id)
              setYearFilter('all')
              setTypeFilter('all')
            }}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium transition ${activeGroup?.id === group.id ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:text-white'}`}
          >
            {group.title}
            <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{group.rows.length}</span>
          </button>
        ))}
      </div>
      </div>

      {activeGroup ? (
        <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 p-4 dark:border-gray-800">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{activeGroup.title}</h3>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{activeGroup.description}</p>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search table"
                  className="col-span-2 h-9 min-w-0 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:min-w-56 sm:w-auto"
                />
                <select
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                  className="h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:px-3"
                >
                  <option value="all">All years</option>
                  {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  className="h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:px-3"
                >
                  <option value="all">All record types</option>
                  {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => exportRawDataWorkbook([{ ...activeGroup, rows: visibleRows }], propId, '')}
                  className="h-9 rounded-lg border border-gray-200 px-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 sm:px-3"
                >
                  Export sheet
                </button>
                <button
                  type="button"
                  onClick={() => exportRawDataWorkbook(groups, propId, normalizedQuery)}
                  className="h-9 rounded-lg border border-gray-200 px-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 sm:px-3"
                >
                  Export workbook
                </button>
              </div>
            </div>
          </div>

          <RawDataMobileRecords group={activeGroup} rows={visibleRows} />
          <div className="hidden min-w-0 md:block">
            <DataTable
              rows={visibleRows}
              columns={activeGroup.columns}
              getRowKey={(row) => row.id}
              defaultSort={activeGroup.columns.some((column) => column.id === 'year') ? { id: 'year', direction: 'asc' } : null}
              tableWrapperClassName="max-w-full overflow-auto rounded-none border-0"
              className="min-w-0 p-0"
              emptyMessage="No records match the current filters."
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900">
          No property data records are available.
        </div>
      )}
    </section>
  )
}

const DATA_HEALTH_TAB_KEY_MAP = {
  usage: 'rental',
}

function displayText(value, fallback = '—') {
  if (value == null || value === '') return fallback
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    return value.display || value.displayValue || value.label || value.message || value.value || fallback
  }
  return fallback
}

function dataHealthSeverityClasses(severity) {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200'
  if (severity === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200'
  return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-200'
}

function DataHealthTab({ propId, onJump }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    propAPI.verification(propId)
      .then((resp) => {
        if (!active) return
        setData(resp.data?.dataHealth || null)
      })
      .catch((err) => {
        if (!active) return
        setError(err.response?.data?.detail?.message || err.response?.data?.detail || err.message || 'Data health is unavailable.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [propId])

  const goToIssue = (issue) => {
    const tabKey = issue?.primaryAction?.tabKey
    if (!tabKey) return
    onJump(DATA_HEALTH_TAB_KEY_MAP[tabKey] || tabKey)
  }

  if (loading) {
    return (
      <div className="card">
        <div className="h-5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 dark:border-red-900/70 dark:bg-red-950/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-300" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">Data health unavailable</h2>
            <p className="mt-1 text-sm text-red-700 dark:text-red-200">{displayText(error, 'Unable to load data health right now.')}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Data health</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Unavailable</p>
      </div>
    )
  }

  const summary = data.summary || {}
  const groups = data.groups || []
  const fastestFix = data.fastestFix

  return (
    <div className="space-y-5">
      <section className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Data health</p>
            <h2 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{displayText(data.title, 'Data health')}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{displayText(data.subtitle, 'See what needs review.')}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">Score</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{displayText(summary.score)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">Status</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{displayText(summary.status)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">Checks</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{displayText(summary.checksPassed)}</div>
            </div>
          </div>
        </div>

        {fastestFix && (
          <div className="mt-5 flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/70 dark:bg-blue-950/30 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{displayText(fastestFix.fastestFixLabel, 'Fastest fix')}</p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-200">{displayText(fastestFix.summary)}</p>
            </div>
            <button type="button" className="btn-secondary w-fit" onClick={() => goToIssue({ primaryAction: fastestFix.primaryAction })}>
              {displayText(fastestFix.primaryAction?.label, 'Open details')}
            </button>
          </div>
        )}
      </section>

      {groups.map((group) => (
        <section key={group.key} className="card">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{displayText(group.label)}</h3>
            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {(group.issues || []).length}
            </span>
          </div>

          {(group.issues || []).length === 0 ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No items in this group.</p>
          ) : (
            <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
              {(group.issues || []).map((issue) => (
                <article key={issue.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${dataHealthSeverityClasses(issue.severity)}`}>
                          {displayText(issue.status)}
                        </span>
                        {issue.confidenceLabel && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">{displayText(issue.confidenceLabel)} confidence</span>
                        )}
                      </div>
                      <h4 className="mt-2 text-base font-semibold text-gray-900 dark:text-white">{displayText(issue.title)}</h4>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{displayText(issue.summary)}</p>
                      {issue.shortExplanation && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{displayText(issue.shortExplanation)}</p>
                      )}
                    </div>
                    {issue.primaryAction?.label && (
                      <button type="button" className="btn-secondary w-fit shrink-0" onClick={() => goToIssue(issue)}>
                        {displayText(issue.primaryAction.label)}
                        <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Expected</div>
                      <div className="mt-1 font-medium text-gray-900 dark:text-white">{displayText(issue.shouldBe)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Actual</div>
                      <div className="mt-1 font-medium text-gray-900 dark:text-white">{displayText(issue.actually)}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Difference</div>
                      <div className="mt-1 font-medium text-gray-900 dark:text-white">{displayText(issue.difference)}</div>
                    </div>
                  </div>

                  {(issue.recommendedSteps || []).length > 0 && (
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-500 dark:text-gray-400">
                      {issue.recommendedSteps.map((step, index) => <li key={`${issue.id}-step-${index}`}>{displayText(step)}</li>)}
                    </ol>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function SumRow({ label, value, color = 'text-gray-700 dark:text-gray-300', bold, plus }) {
  if (typeof value === 'string') {
    return (
      <div className={`flex justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className={color}>{plus && !value.startsWith('-') ? '+' : ''}{value}</span>
      </div>
    )
  }
const abs = Math.abs(value || 0)
const neg = (value || 0) < 0
return (
<div className={`flex justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
<span className="text-gray-500 dark:text-gray-400">{label}</span>
<span className={color}>{!neg && plus ? '+' : neg ? '–' : ''}{fmtKMB(abs, { threshold: 1000 })}</span>
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

const equityStoryTone = {
  acquisition_cash: 'var(--chart-equity-cash)',
  principal_reduction: 'var(--chart-equity-owner)',
  remaining_secured_debt: 'var(--chart-equity-debt)',
  cash: 'var(--chart-equity-cash)',
  equity: 'var(--chart-equity-owner)',
  debt: 'var(--chart-equity-debt)',
  appreciation: 'var(--chart-equity-appreciation)',
  total: 'var(--chart-equity-total)',
}

const waterfallStoryTone = {
  acquisition_cash: chartColors.primarySoft,
  principal_reduction: chartColors.warningStrong,
  remaining_secured_debt: chartColors.mutedAxis,
  appreciation: chartColors.positiveSoft,
  total: chartColors.purple,
}

function EquityStoryCharts({ story, onJump }) {
const nodes = story?.waterfall?.series || []
const acquisitionCash = nodes.find((node) => node.key === 'acquisitionCashContribution')
const principalReduction = nodes.find((node) => node.key === 'principalReductionSinceAcquisition')
const appreciation = nodes.find((node) => node.key === 'appreciation')
const securedDebt = nodes.find((node) => node.key === 'currentPropertyDebt')
const assetRows = [acquisitionCash, principalReduction, appreciation?.value >= 0 ? appreciation : null].filter(Boolean)
const liabilityRows = [securedDebt, appreciation?.value < 0 ? { ...appreciation, label: 'Market value loss' } : null].filter(Boolean)
return (
<div className="grid items-stretch gap-5 lg:grid-cols-[minmax(180px,0.7fr)_minmax(0,2.4fr)_minmax(180px,0.7fr)]">
<EquityStorySidePanel title="Equity" rows={assetRows} icon={Home} tone="asset" emptyLabel="No asset values available" />
<div className="min-w-0 lg:order-none"><ValueWaterfallStoryChart waterfall={story?.waterfall} onJump={onJump} /></div>
<EquityStorySidePanel title="Loans & losses" rows={liabilityRows} icon={TrendingDown} tone="liability" emptyLabel="No liabilities or losses" />
</div>
)
}

function EquityStorySidePanel({ title, rows, icon: Icon, tone, emptyLabel }) {
  const accent = tone === 'asset'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
    : 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
  return (
    <aside className="border-y border-gray-200 py-4 dark:border-gray-700 lg:self-center">
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${accent}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
      </div>
      <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
        {rows.length ? rows.map((row) => (
          <div key={row.key} className="py-3 first:pt-0 last:pb-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">{row.label}</p>
            <p className="mt-1 text-base font-semibold text-gray-900 dark:text-white">{row.fullDisplay || row.display}</p>
          </div>
        )) : <p className="text-sm text-gray-500 dark:text-gray-400">{emptyLabel}</p>}
      </div>
    </aside>
  )
}

function EquityStorySection({ story, onJump }) {
return (
<section className="space-y-3">
<div>
<h3 className="text-lg font-semibold text-gray-900 dark:text-white">Equity Story</h3>
<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">How today’s property value was built and how much you own.</p>
</div>
<EquityStoryCharts story={story} onJump={onJump} />
</section>
)
}

function StoryUnavailable({ reason, action, onJump }) {
  return (
    <div className="grid min-h-44 place-items-center rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
      <div>
        <p>{reason || 'This chart is unavailable.'}</p>
        {action?.label ? <button type="button" className="btn-secondary mt-3 text-sm" onClick={() => action.tabKey && onJump?.(action.tabKey)}>{action.label}</button> : null}
      </div>
    </div>
  )
}

function OwnershipStoryChart({ ownership, onJump }) {
  const segments = ownership?.segments || []
  const status = ownership?.status
  if (status === 'negative_equity') {
    return (
      <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-700">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{ownership.title}</h4>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{ownership.explanation}</p>
        <div className="mt-4 space-y-2">
          {(ownership.comparison || []).map((row) => <div key={row.key} className="flex justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800"><span className="text-gray-500 dark:text-gray-400">{row.label}</span><span className={`font-semibold ${row.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{row.display}</span></div>)}
        </div>
        {ownership.recommendedAction?.label ? <button type="button" className="btn-secondary mt-4 text-sm" onClick={() => ownership.recommendedAction.tabKey && onJump?.(ownership.recommendedAction.tabKey)}>{ownership.recommendedAction.label}</button> : null}
      </div>
    )
  }
  if (status !== 'available') {
    return <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-700"><h4 className="text-sm font-semibold text-gray-900 dark:text-white">{ownership?.title || 'Who owns property value today'}</h4><StoryUnavailable reason={ownership?.unavailableReason} action={ownership?.recommendedAction} onJump={onJump} /></div>
  }
  let offset = 25
  const radius = 44
  const circumference = 2 * Math.PI * radius
  return (
    <div className="rounded-lg border border-gray-100 p-4 dark:border-gray-700">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{ownership.title}</h4>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="relative h-36 w-36 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={ownership.explanation || ownership.title}>
            <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" className="text-gray-100 dark:text-gray-800" strokeWidth="18" />
            {segments.map((segment) => {
              const length = ((segment.percent || 0) / 100) * circumference
              const color = equityStoryTone[segment.tone] || equityStoryTone.equity
              const circle = <circle key={segment.key} cx="60" cy="60" r={radius} fill="none" stroke={color} strokeWidth="18" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />
              offset += length
              return circle
            })}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-xs text-gray-500 dark:text-gray-400">{ownership.centerLabel?.label || 'Estimated value'}</div><div className="text-sm font-semibold text-gray-900 dark:text-white">{ownership.centerLabel?.display || '—'}</div></div></div>
        </div>
        <div className="w-full space-y-2">
          {segments.map((segment) => <div key={segment.key} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 text-gray-600 dark:text-gray-300"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: equityStoryTone[segment.tone] || equityStoryTone.equity }} />{segment.label}</span><span className="font-semibold text-gray-900 dark:text-white">{segment.display} <span className="text-gray-500 dark:text-gray-400">· {segment.percentDisplay}</span></span></div>)}
        </div>
      </div>
      {ownership.explanation ? <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{ownership.explanation}</p> : null}
    </div>
  )
}

function wrapWaterfallLabel(label) {
  const words = String(label || '').split(' ')
  if (words.length <= 1) return [label]
  if (words.length === 2) return words
  return [words.slice(0, -1).join(' '), words.at(-1)]
}

function formatWaterfallBarLabel(display) {
  return typeof display === 'string' ? display.replace(/^\+/, '') : display
}

function ValueWaterfallStoryChart({ waterfall, onJump, showTitle = true }) {
  if (waterfall?.status !== 'available') {
    return <div className="min-w-0 py-1">{showTitle ? <ChartInfoTitle title={waterfall?.title || 'Purchase Price to Current Market Value'} details={waterfall?.subtitle} /> : null}<StoryUnavailable reason={waterfall?.unavailableReason} action={waterfall?.recommendedAction} onJump={onJump} /></div>
  }
  const nodes = waterfall.series || []
  const chartHeight = 400
  const chartWidth = 680
  const left = 58
  const right = 24
  const top = 28
  const bottom = 104
  const plotHeight = chartHeight - top - bottom
  const barWidth = 48
  const gap = 56
  const nodeValues = nodes.flatMap((node) => [node.startValue ?? node.start ?? 0, node.endValue ?? node.end ?? 0])
  const minValue = Math.min(0, ...nodeValues)
  const maxValue = Math.max(1, ...nodeValues)
  const axisMin = minValue < 0 ? minValue * 1.08 : 0
  const axisMax = maxValue * 1.08
  const axisRange = Math.max(axisMax - axisMin, 1)
  const y = (value) => top + ((axisMax - (value || 0)) / axisRange) * plotHeight
  const ticks = [axisMin, axisMin + axisRange / 2, axisMax]
  const barCenter = (index) => left + index * (barWidth + gap) + barWidth / 2
  const barX = (index) => left + index * (barWidth + gap)
  const nodeById = Object.fromEntries(nodes.map((node, index) => [node.id || node.key, { node, index }]))
  const srSummary = waterfall.screenReaderSummary || `${waterfall.title}. ${nodes.map((node) => `${node.label}: ${node.fullDisplay || node.display}`).join(', ')}.`
  return (
    <div className="min-w-0 py-1">
      {showTitle ? <ChartInfoTitle title={waterfall.title || 'Purchase Price to Current Market Value'} details={waterfall.subtitle} /> : null}
      <p className="sr-only">{srSummary}</p>
      <div className="mx-auto mt-4 max-w-[760px] overflow-x-auto">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="mx-auto min-w-[680px]" role="img" aria-label={waterfall.title}>
          {ticks.map((tick) => <g key={tick}><line x1={left - 6} x2={chartWidth - right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-gray-100 dark:text-gray-800" /><text x={0} y={y(tick) + 4} className="fill-gray-500 text-[11px] dark:fill-gray-400">{fmtKMB(tick)}</text></g>)}
          {nodes.map((node, index) => {
            const startValue = node.startValue ?? node.start ?? 0
            const endValue = node.endValue ?? node.end ?? 0
            const isTotal = Boolean(node.isTotal ?? node.total)
            const topY = y(Math.max(startValue, endValue))
            const bottomY = y(Math.min(startValue, endValue))
            const x = barX(index)
            const next = nodes[index + 1]
            const nextIsTotal = Boolean(next?.isTotal ?? next?.total)
            const connectorY = y(endValue)
            const labelLines = wrapWaterfallLabel(node.label)
            return <g key={node.id || node.key} tabIndex="0" aria-label={`${node.label}. ${node.fullDisplay || node.display}. ${node.tooltip?.role || ''}.`}><title>{`${node.label}\nAmount: ${node.fullDisplay || node.display}\n${isTotal ? 'Current market value' : `Cumulative value after this step: ${node.tooltip?.cumulativeValue || node.fullDisplay || node.display}`}`}</title><rect x={x} y={topY} width={isTotal ? barWidth + 8 : barWidth} height={Math.max(5, bottomY - topY)} rx="3" fill={waterfallStoryTone[node.semanticType] || waterfallStoryTone[node.tone] || waterfallStoryTone.total} /><text x={x + (isTotal ? barWidth + 8 : barWidth) / 2} y={topY - 8} textAnchor="middle" className="fill-gray-900 text-[11px] font-semibold dark:fill-white">{formatWaterfallBarLabel(node.display)}</text>{labelLines.map((line, lineIndex) => <text key={line} x={x + (isTotal ? barWidth + 8 : barWidth) / 2} y={chartHeight - 70 + lineIndex * 12} textAnchor="middle" className="fill-gray-500 text-[11px] dark:fill-gray-400">{line}</text>)}{next && !nextIsTotal ? <line x1={x + (isTotal ? barWidth + 8 : barWidth)} x2={barX(index + 1)} y1={connectorY} y2={connectorY} stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeDasharray="3 3" /> : null}</g>
          })}
          {(waterfall.annotations || []).map((annotation) => {
            const start = nodeById[annotation.startBarId]
            const end = nodeById[annotation.endBarId]
            if (!start || !end) return null
            const x1 = barCenter(start.index)
            const x2 = barCenter(end.index)
            const yBase = chartHeight - 30
            const colorClass = annotation.semanticType === 'appreciation' ? 'fill-emerald-600 text-emerald-500' : 'fill-gray-500 text-gray-400'
            return <g key={`${annotation.startBarId}-${annotation.endBarId}`}><path d={`M ${x1} ${yBase - 14} V ${yBase - 4} H ${x2} V ${yBase - 14}`} fill="none" stroke="currentColor" className={annotation.semanticType === 'appreciation' ? 'text-emerald-500' : 'text-gray-400'} strokeWidth="1" /><text x={(x1 + x2) / 2} y={yBase + 12} textAnchor="middle" className={`${colorClass} text-[11px]`}>{annotation.label}</text></g>
          })}
        </svg>
      </div>
    </div>
  )
}

function ChartInfoTitle({ title, details }) {
  return (
    <div className="flex items-center justify-center gap-2 text-center">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
      {details ? (
        <span className="group relative inline-flex">
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:border-blue-300 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-300"
            aria-label={`${title} details`}
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="pointer-events-none absolute left-1/2 top-7 z-20 w-72 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs font-medium leading-5 text-gray-600 opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {details}
          </span>
        </span>
      ) : null}
    </div>
  )
}

function PropertyStorySummary({ propId, prop, metrics, metricVault, onJump }) {
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
const vaultMetrics = metricVault?.metrics || {}
const equityStory = metricVault?.charts?.equityStory
const metricDisplay = (metric, fallback = '—') => metric?.displayValue ?? metric?.display ?? fallback
  const propertyKind = (usage.current_type || prop.usage_type || '').toLowerCase() === 'primary' ? 'PRIMARY' : 'RENTAL'
  const config = summaryMetricConfig[propertyKind]
  const latestYear = yearly[yearly.length - 1] || {}
  const marketValue = lifetime.market_value || prop.market_value || 0
const loanBalance = metrics?.total_loan_balance ?? summaryDtoMetrics.totalDebt?.value ?? lifetime.current_loan_balance ?? 0
const equity = metrics?.equity ?? summaryDtoMetrics.equity?.value ?? lifetime.equity ?? Math.max(marketValue - loanBalance, 0)
const ownedPct = marketValue > 0 ? (equity / marketValue) * 100 : 0
const equityColorClass = 'text-green-600'
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
  const trendRows = metricVault?.yearlyMetrics?.length ? metricVault.yearlyMetrics : yearly
  const TrendTable = () => (
    <div className="card">
      <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">{propertyKind === 'PRIMARY' ? 'Multi-Year Wealth Trend' : 'Multi-Year Income Trend'}</h3>
<DataTable
columns={propertyKind === 'PRIMARY' ? [
{ id: 'year', header: 'Year', align: 'center', sortValue: (row) => row.year, cellClassName: 'font-medium text-gray-900 dark:text-white', render: (row) => row.isPartial || row.is_partial ? `${row.year}*` : row.year },
{ id: 'value', header: 'Value', align: 'right', sortValue: () => marketValue, render: (row) => row.marketValueDisplay || fmt(marketValue) },
{ id: 'loan_balance', header: 'Loan Balance', align: 'right', sortValue: (row) => row.loan_balance ?? row.balance ?? loanBalance, render: (row) => row.loanBalanceDisplay || fmt(row.loan_balance ?? row.balance ?? loanBalance) },
{ id: 'equity', header: 'Equity', align: 'right', cellClassName: 'text-green-600', sortValue: (row) => Math.max(0, marketValue - ((row.loan_balance ?? row.balance ?? loanBalance) || 0)), render: (row) => row.equityDisplay || fmt(Math.max(0, marketValue - ((row.loan_balance ?? row.balance ?? loanBalance) || 0))) },
{ id: 'principal', header: 'Principal', align: 'right', accessor: 'principal_paid', cellClassName: 'text-blue-600', render: (row) => row.principalPaidDisplay || fmt(row.principal_paid || 0) },
{ id: 'interest_tax', header: '2026 Interest/Tax', align: 'right', sortValue: (row) => (row.interest_paid || 0) + (row.taxes_paid || 0), render: (row) => row.interestTaxDisplay || fmt((row.interest_paid || 0) + (row.taxes_paid || 0)) },
] : [
{ id: 'year', header: 'Year', align: 'center', sortValue: (row) => row.year, cellClassName: 'font-medium text-gray-900 dark:text-white', render: (row) => row.isPartial || row.is_partial ? `${row.year}*` : row.year },
{ id: 'income', header: 'Income', align: 'right', accessor: 'rental_income', cellClassName: 'text-green-600', render: (row) => row.incomeDisplay || fmt(row.rental_income || 0) },
{ id: 'opex', header: 'OpEx', align: 'right', accessor: 'operating_expenses', render: (row) => row.operatingExpensesDisplay || fmt(row.operating_expenses || 0) },
{ id: 'noi', header: 'NOI', align: 'right', sortValue: (row) => (row.rental_income || 0) - (row.operating_expenses || 0), render: (row) => row.noiDisplay || fmt((row.rental_income || 0) - (row.operating_expenses || 0)) },
{ id: 'debt_service', header: 'Debt Service', align: 'right', sortValue: (row) => (row.interest_paid || 0) + (row.principal_paid || 0), render: (row) => row.debtServiceDisplay || fmt((row.interest_paid || 0) + (row.principal_paid || 0)) },
{ id: 'cash_flow', header: 'Cash Flow', align: 'right', accessor: 'cash_flow', render: (row) => <span className={((row.cashFlow ?? row.cash_flow) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{row.cashFlowDisplay || fmt(row.cash_flow || 0)}</span> },
]}
rows={trendRows}
getRowKey={(row) => row.year}
defaultSort={{ id: 'year', direction: 'asc' }}
getRowProps={() => ({ className: 'border-b border-gray-100 dark:border-gray-700/50' })}
/>
    </div>
  )

  return (
    <div className="space-y-6">
      {propertyKind === 'PRIMARY' ? (
        <>
          <div className="card">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
<p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><MetricLabel label="Equity" metric={vaultMetrics.equity || summaryDtoMetrics.equity} /></p>
<p className={`mt-1 text-3xl font-bold ${equityColorClass}`}>{metricDisplay(vaultMetrics.equity || summaryDtoMetrics.equity, fmtKMB(equity))}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">You own {fmtPct(ownedPct)} of this home</p>
              </div>
              <SourceBadge />
            </div>
<EquityStorySection story={equityStory} onJump={onJump} />
</div>

<div className="grid gap-4 lg:grid-cols-2">
<Panel title="Since You Bought">
		              <SumRow label="Purchase price" value={metricDisplay(vaultMetrics.purchasePrice, fmtKMB(prop.purchase_price || 0))} />
		              <SumRow label="Value today" value={metricDisplay(vaultMetrics.marketValue || summaryDtoMetrics.marketValue, fmtKMB(marketValue))} />
	              <SumRow label={`Appreciation (${fmtPct(appreciationPct)})`} value={fmtKMB(appreciationSincePurchase)} color="text-green-600" plus />
	            </Panel>
<Panel title="Tax Benefit (Annual)">
	              <SumRow label={`${latestYear.year || new Date().getFullYear()} mortgage interest`} value={fmtKMB(latestYear.interest_paid || 0)} color="text-orange-500" />
	              <SumRow label="Property tax under SALT cap" value={fmtKMB(saltDeduction)} />
	              <SumRow label="Estimated annual deduction" value={fmtKMB(annualTaxBenefit)} color="text-green-600" bold />
	            </Panel>
          </div>
        </>
      ) : (
        <>
<section className="card">
<h3 className="mb-4 font-semibold text-gray-900 dark:text-white">Monthly Operating Snapshot</h3>
<div className="grid gap-4 md:grid-cols-2">
<div className="rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
<p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><MetricLabel label="Rent per Month" metric={vaultMetrics.rentPerMonth || summaryDtoMetrics.rentPerMonth} /></p>
<p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{metricDisplay(vaultMetrics.rentPerMonth || summaryDtoMetrics.rentPerMonth, fmt(prop.monthly_rent || 0))}</p>
<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Current occupied rent</p>
</div>
<div className="rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
<p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"><MetricLabel label="Monthly Cash Flow" metric={vaultMetrics.monthlyCashFlow || summaryDtoMetrics.monthlyCashFlow} /></p>
<p className={`mt-1 text-2xl font-semibold ${metricToneClass(vaultMetrics.monthlyCashFlow || summaryDtoMetrics.monthlyCashFlow)}`}>{metricDisplay(vaultMetrics.monthlyCashFlow || summaryDtoMetrics.monthlyCashFlow, fmt(monthlyCashFlow))}</p>
<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{metricDisplay(vaultMetrics.annualCashFlow || summaryDtoMetrics.annualCashFlow, fmt(annualCashFlow))}/year</p>
</div>
</div>
</section>

<div className="grid gap-4 md:grid-cols-4">
<MetricCard metric={vaultMetrics.cashOnCashReturn || summaryDtoMetrics.cashOnCashReturn} label="Cash-on-cash return" fallbackValue={summaryDtoMetrics.cashOnCashReturn?.display || '—'} note={(vaultMetrics.cashOnCashReturn || summaryDtoMetrics.cashOnCashReturn)?.hint || 'Annual cash flow / cash invested'} backendOwned />
<MetricCard metric={vaultMetrics.capRate || summaryDtoMetrics.capRate} label="Cap rate" fallbackValue={summaryDtoMetrics.capRate?.display || fmtPct(capRate)} note="NOI / market value" backendOwned />
<MetricCard metric={vaultMetrics.dscr || summaryDtoMetrics.dscr} label="DSCR" fallbackValue={summaryDtoMetrics.dscr?.display || (dscr ? formatRatio(dscr) : '—')} note="NOI / annual debt service" backendOwned />
<MetricCard metric={vaultMetrics.totalReturnYtd || summaryDtoMetrics.totalReturnYtd} label="Total return YTD" fallbackValue={summaryDtoMetrics.totalReturnYtd?.value != null ? fmtKMB(summaryDtoMetrics.totalReturnYtd.value) : fmtKMB(totalReturnYTD)} note="Cash flow + principal paydown" backendOwned />
</div>

<EquityStorySection story={equityStory} onJump={onJump} />

<div className="grid gap-4 lg:grid-cols-2">
<Panel title="Annual P&L">
<SumRow label="Income" value={vaultMetrics.effectiveGrossIncome?.displayValue || pnlIncome} color="text-green-600" plus />
<SumRow label="Operating expenses" value={vaultMetrics.operatingExpenses?.displayValue || pnlOperatingExpenses} />
<SumRow label="NOI" value={vaultMetrics.noi?.displayValue || pnlNoi} bold />
<SumRow label="Debt service" value={vaultMetrics.annualDebtService?.displayValue || pnlAnnualDebtService} />
<SumRow label="Net cash flow" value={vaultMetrics.annualCashFlow?.displayValue || pnlNetCashFlow} color={(vaultMetrics.annualCashFlow?.value ?? pnlNetCashFlow) >= 0 ? 'text-green-600' : 'text-red-600'} />
</Panel>
<Panel title="Tax Picture">
<SumRow label="Depreciation (Sch E line 18)" value={vaultMetrics.depreciation?.displayValue || latestYear.depreciation || 0} color="text-purple-600" />
<SumRow label="Suspended losses" value={vaultMetrics.suspendedLosses?.displayValue || 0} />
<SumRow label="Net tax P&L" value={vaultMetrics.taxableIncome?.displayValue || latestYear.taxable_income || 0} color={(vaultMetrics.taxableIncome?.value ?? latestYear.taxable_income ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'} />
</Panel>
</div>
        </>
      )}

<TrendTable />
{propertyKind !== 'PRIMARY' ? <UsageHistoryStrip periods={usagePeriods} usage={usage} /> : null}
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
  const isPrimaryOnly = (prop.usage_type || '').toLowerCase() === 'primary' && !prop.currently_rental
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
<RealEstateStat label="Market Value" value={fmtKMB(marketValue)} />
<RealEstateStat label="Total Debt" value={fmtKMB(loanBalance)} note={ltv == null ? 'LTV unavailable' : `${fmtPct(ltv)} LTV`} />
<RealEstateStat label="Equity" value={fmtKMB(equity)} />
<RealEstateStat label={isPrimaryOnly ? 'Monthly Carrying Cost' : 'Monthly Cash Flow'} value={`${fmtKMB(isPrimaryOnly ? monthlyCarryingCost : monthlyCashFlow, { threshold: 1000 })} / mo`} />
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
<DataTable
columns={[
{ id: 'year', header: 'Year', align: 'center', sortValue: (row) => row.year, cellClassName: 'font-medium text-gray-900 dark:text-white', render: (row) => row.is_partial ? `${row.year}*` : row.year },
{ id: 'mortgage', header: 'Mortgage', align: 'right', sortValue: (row) => (row.interest_paid || 0) + (row.principal_paid || 0), cellClassName: 'text-orange-600', render: (row) => fmt((row.interest_paid || 0) + (row.principal_paid || 0)) },
{ id: 'principal', header: 'Principal', align: 'right', accessor: 'principal_paid', cellClassName: 'text-blue-600', render: (row) => fmt(row.principal_paid || 0) },
{ id: 'interest', header: 'Interest', align: 'right', accessor: 'interest_paid', cellClassName: 'text-orange-600', render: (row) => fmt(row.interest_paid || 0) },
{ id: 'taxes', header: 'Taxes', align: 'right', accessor: 'taxes_paid', render: (row) => fmt(row.taxes_paid || 0) },
{ id: 'depreciation', header: 'Depreciation', align: 'right', accessor: 'depreciation', hidden: !showDepreciation, cellClassName: 'text-purple-600', render: (row) => fmt(row.depreciation || 0) },
{ id: 'cash_flow', header: 'Cash Flow', align: 'right', accessor: 'cash_flow', render: (row) => <span className={(row.cash_flow || 0) >= 0 ? 'text-green-600' : 'text-red-600'}>{fmt(row.cash_flow || 0)}</span> },
]}
rows={yearly}
getRowKey={(row) => row.year}
defaultSort={{ id: 'year', direction: 'asc' }}
/>
</div>
    </div>
  )
}
