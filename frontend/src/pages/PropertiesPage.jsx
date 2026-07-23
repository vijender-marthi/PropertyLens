import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  Home,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react'
import toast from 'react-hot-toast'
import PageContainer from '../components/PageContainer'
import DataTable from '../components/DataTable'
import ConfirmDialog from '../components/ConfirmDialog'
import MetricCard from '../components/metrics/MetricCard'
import { propAPI } from '../services/api'
import { homeTypeLabel } from '../config/propertySetupPresentation'
import { propertyLabel, shortPropertyUid } from '../utils/propertyDisplay'
import { formatMetricCurrency } from '../utils/formatters'

const GROUP_OPTIONS = [
  { key: 'state', label: 'State' },
  { key: 'city', label: 'City' },
  { key: 'health', label: 'Health' },
  { key: 'cashFlow', label: 'Cash Flow' },
  { key: 'recommendation', label: 'Recommendation' },
]

const HEALTH_OPTIONS = ['All health', 'Stable', 'Needs Review', 'Watch', 'Action Required']

function metricDisplay(metric, fallback = '—') {
  return metric?.display ?? metric?.fullDisplay ?? fallback
}

function metricFullDisplay(metric, fallback = '—') {
  return metric?.fullDisplay ?? metricDisplay(metric, fallback)
}

function isPrimaryResidence(property) {
  return (property.usage_type || '').toLowerCase() === 'primary'
}

function healthTone(record) {
  const status = (record.healthStatus || record.healthKey || '').toLowerCase()
  if (status.includes('review') || status.includes('action') || status.includes('critical')) return 'action'
  if (status.includes('watch') || status.includes('warning') || status.includes('needs')) return 'watch'
  return 'healthy'
}

function toneClasses(tone) {
  if (tone === 'action') return 'border-l-red-500'
  if (tone === 'watch') return 'border-l-amber-500'
  return 'border-l-emerald-500'
}

function badgeClasses(tone) {
  if (tone === 'action') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/20 dark:text-red-200'
  if (tone === 'watch') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-200'
}

function cashFlowGroup(record) {
  const value = record.cashFlowMetric?.value
  if (value === null || value === undefined) return 'Unavailable'
  if (value < 0) return 'Negative Cash Flow'
  if (value === 0) return 'Break Even'
  return 'Positive Cash Flow'
}

function searchText(record) {
  return [
    record.name,
    record.city,
    record.state,
    record.healthStatus,
    record.recommendation,
    metricDisplay(record.cashFlowMetric),
    metricDisplay(record.equityMetric),
    metricDisplay(record.ltvMetric),
    metricDisplay(record.dscrMetric),
    metricDisplay(record.noiMetric),
  ].filter(Boolean).join(' ').toLowerCase()
}

function buildSparklinePoints(values) {
  if (!Array.isArray(values) || values.length < 2) return ''
  const numbers = values.map((item) => Number(item?.value ?? item)).filter((item) => Number.isFinite(item))
  if (numbers.length < 2) return ''
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const span = max - min || 1
  return numbers.map((value, index) => {
    const x = (index / (numbers.length - 1)) * 100
    const y = 30 - ((value - min) / span) * 24
    return `${x},${y}`
  }).join(' ')
}

function normalizeProperty(property, healthRow) {
  const metrics = property.metrics || {}
  return {
    id: property.id,
    property,
    name: healthRow?.property || propertyLabel(property),
    city: property.city || '—',
    state: property.state || 'Unassigned',
    type: homeTypeLabel(property.property_type, property.property_type_raw) || 'Property',
    propertyUid: property.property_uid ? shortPropertyUid(property) : null,
    healthStatus: healthRow?.status || property.health_status || 'Stable',
    healthKey: healthRow?.status || property.health_status || 'stable',
    recommendation: healthRow?.action || property.recommendation || 'Open property',
    cashFlowMetric: healthRow?.monthlyCashFlow || metrics.monthlyCashFlow,
    equityMetric: healthRow?.equity || metrics.equity,
    ltvMetric: healthRow?.ltv || metrics.loanToValue || metrics.ltv,
    dscrMetric: healthRow?.dscr || metrics.dscr,
    noiMetric: metrics.annualNoi || metrics.noi,
    monthlyHousingCostMetric: metrics.monthlyCostToOwn || metrics.monthlyHousingCost,
    marketValueMetric: metrics.marketValue,
    sparkline: healthRow?.cashFlowSparkline || property.cash_flow_sparkline || property.monthly_cash_flow_series,
    dataHealth: healthRow?.dataHealth || property.data_health || '—',
  }
}

function groupRecords(records, groupBy) {
  const groups = new Map()
  records.forEach((record) => {
    let key = record.state
    if (groupBy === 'city') key = record.city
    if (groupBy === 'health') key = record.healthStatus
    if (groupBy === 'cashFlow') key = cashFlowGroup(record)
    if (groupBy === 'recommendation') key = record.recommendation || 'No recommendation'
    const label = key || 'Unassigned'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(record)
  })
  return [...groups.entries()]
    .map(([label, items]) => ({
      label,
      items: items.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function PropertiesShell({ children }) {
  return <PageContainer>{children}</PageContainer>
}

function Sparkline({ values }) {
  const points = buildSparklinePoints(values)
  if (!points) return <div className="h-8 rounded bg-gray-50 dark:bg-gray-800" aria-hidden="true" />
  return (
    <svg className="h-8 w-full" viewBox="0 0 100 32" role="img" aria-label="12-month cash flow sparkline" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-blue-500" />
    </svg>
  )
}

function PropertyCard({ record, onDelete }) {
  const tone = healthTone(record)
  const property = record.property

  const deleteProperty = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onDelete?.(property)
  }

  return (
    <Link
      to={`/properties/${record.id}`}
      className={`block rounded-lg border border-l-4 border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800 ${toneClasses(tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            <h3 className="truncate font-semibold text-gray-900 dark:text-white">{record.name}</h3>
          </div>
          <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{[record.city, record.state].filter((item) => item && item !== '—' && item !== 'Unassigned').join(', ') || 'Location not set'}</span>
          </p>
          {record.propertyUid ? <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">ID {record.propertyUid}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClasses(tone)}`}>{record.healthStatus}</span>
          {onDelete ? (
            <button
              type="button"
              onClick={deleteProperty}
              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              title="Delete property"
              aria-label={`Delete ${record.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <MetricBlock label="Cash Flow" value={metricDisplay(record.cashFlowMetric)} suffix={record.cashFlowMetric ? '/mo' : null} />
        <MetricBlock label="Equity" value={metricFullDisplay(record.equityMetric)} />
        <MetricBlock label="LTV" value={metricDisplay(record.ltvMetric)} />
      </div>

      <div className="mt-4">
        <Sparkline values={record.sparkline} />
      </div>

      <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Recommendation</p>
        <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{record.recommendation}</p>
      </div>

      <div className="mt-4 inline-flex text-sm font-semibold text-blue-600 dark:text-blue-300">
        Open Property
      </div>
    </Link>
  )
}

function MetricBlock({ label, value, suffix }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
        {value}
        {suffix ? <span className="ml-0.5 text-xs font-medium text-gray-400 dark:text-gray-500">{suffix}</span> : null}
      </p>
    </div>
  )
}

function PrimaryResidenceSection({ records, columns, getRowProps }) {
  if (!records.length) return null
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 dark:border-amber-900/70 dark:bg-amber-950/10">
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
        <Home className="h-4 w-4" aria-hidden="true" />
        Primary Home
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs dark:bg-amber-900/40">{records.length}</span>
      </div>
      <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">Tracked separately from rental portfolio income and expense metrics.</p>
      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={records}
          getRowKey={(record) => record.id}
          getRowProps={getRowProps}
          emptyMessage="No primary homes available."
        />
      </div>
    </section>
  )
}

export default function PropertiesPage() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [checklistSummary, setChecklistSummary] = useState(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [viewMode, setViewMode] = useState('table')
  const [groupBy, setGroupBy] = useState('state')
  const [healthFilter, setHealthFilter] = useState('All health')
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const refreshProperties = () => {
    propAPI.list()
      .then((response) => setProperties(response.data || []))
      .catch(() => toast.error('Failed to refresh properties'))
    propAPI.checklistSummary()
      .then((response) => setChecklistSummary(response.data))
      .catch(() => setChecklistSummary(null))
    propAPI.dashboard()
      .then((response) => setDashboardData(response.data || null))
      .catch(() => setDashboardData(null))
  }

  useEffect(() => {
    setLoading(true)
    Promise.allSettled([propAPI.list(), propAPI.checklistSummary(), propAPI.dashboard()])
      .then(([propertyResult, checklistResult, dashboardResult]) => {
        if (propertyResult.status === 'fulfilled') setProperties(propertyResult.value.data || [])
        else toast.error('Failed to load properties')
        if (checklistResult.status === 'fulfilled') setChecklistSummary(checklistResult.value.data)
        if (dashboardResult.status === 'fulfilled') setDashboardData(dashboardResult.value.data || null)
      })
      .finally(() => setLoading(false))
  }, [])

  const healthById = useMemo(() => {
    const rows = dashboardData?.executive_dashboard?.propertyHealth || []
    return new Map(rows.map((row) => [row.id, row]))
  }, [dashboardData])

  const records = useMemo(
    () => properties.map((property) => normalizeProperty(property, healthById.get(property.id))),
    [properties, healthById],
  )

  const rentalRecords = useMemo(
    () => records.filter((record) => !isPrimaryResidence(record.property)),
    [records],
  )

  const primaryRecords = useMemo(
    () => records.filter((record) => isPrimaryResidence(record.property)).sort((left, right) => left.name.localeCompare(right.name)),
    [records],
  )

  const filteredRentalRecords = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase()
    return rentalRecords.filter((record) => {
      const matchesHealth = healthFilter === 'All health' || record.healthStatus === healthFilter
      const matchesSearch = !loweredQuery || searchText(record).includes(loweredQuery)
      return matchesHealth && matchesSearch
    })
  }, [rentalRecords, query, healthFilter])

  const groupedRecords = useMemo(() => groupRecords(filteredRentalRecords, groupBy), [filteredRentalRecords, groupBy])

  const dashboard = dashboardData?.dashboard || {}
  const overviewMetrics = dashboardData?.executive_dashboard?.overview || []
  const overviewByKey = new Map(overviewMetrics.map((metric) => [metric.key, metric]))
  const monthlyCashFlow = overviewByKey.get('monthlyNetCashFlow')
  const loanBalanceMetric = { label: 'Loan Balance', display: formatMetricCurrency(dashboard.total_loan_balance) }
  const totalPropertiesMetric = { label: 'Total Properties', display: String(properties.length) }

  const handleDeleteProperty = (property) => setDeleteTarget(property)

  const confirmDeleteProperty = async () => {
    if (!deleteTarget?.id) return
    setDeleting(true)
    try {
      await propAPI.delete(deleteTarget.id)
      toast.success('Property deleted')
      setDeleteTarget(null)
      refreshProperties()
    } catch {
      toast.error('Failed to delete property')
    } finally {
      setDeleting(false)
    }
  }

  const propertyRowProps = (record) => ({
    role: 'link',
    tabIndex: 0,
    'aria-label': `Open ${record.name}`,
    onClick: () => navigate(`/properties/${record.id}`),
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        navigate(`/properties/${record.id}`)
      }
    },
    className: 'cursor-pointer odd:bg-white even:bg-gray-50/40 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:odd:bg-transparent dark:even:bg-gray-800/20 dark:hover:bg-blue-950/20',
  })

  const propertyNameColumn = {
    id: 'property',
    header: 'Property',
    render: (record) => (
      <div>
        <span className="font-semibold text-gray-900 dark:text-white">{record.name}</span>
        <p className="text-xs text-gray-500 dark:text-gray-400">{record.type}</p>
      </div>
    ),
    sortValue: (record) => record.name,
    searchValue: (record) => searchText(record),
    cellClassName: 'min-w-56',
  }

  const actionColumn = {
    id: 'actions',
    header: 'Actions',
    sortable: false,
    align: 'right',
    render: (record) => (
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            navigate(`/properties/${record.id}/edit`)
          }}
          className="rounded-md p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
          title={`Edit ${record.name}`}
          aria-label={`Edit ${record.name}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            handleDeleteProperty(record.property)
          }}
          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-300"
          title={`Delete ${record.name}`}
          aria-label={`Delete ${record.name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    ),
  }

  const tableColumns = [
    propertyNameColumn,
    { id: 'city', header: 'City', accessor: 'city', sortValue: (record) => record.city },
    { id: 'cashFlow', header: 'Cash Flow', align: 'right', render: (record) => metricDisplay(record.cashFlowMetric), sortValue: (record) => record.cashFlowMetric?.value },
    { id: 'equity', header: 'Equity', align: 'right', render: (record) => metricFullDisplay(record.equityMetric), sortValue: (record) => record.equityMetric?.value },
    { id: 'ltv', header: 'LTV', align: 'right', render: (record) => metricDisplay(record.ltvMetric), sortValue: (record) => record.ltvMetric?.value },
    { id: 'dscr', header: 'DSCR', align: 'right', render: (record) => metricDisplay(record.dscrMetric), sortValue: (record) => record.dscrMetric?.value },
    { id: 'noi', header: 'NOI', align: 'right', render: (record) => metricDisplay(record.noiMetric), sortValue: (record) => record.noiMetric?.value },
    { id: 'health', header: 'Health', render: (record) => <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClasses(healthTone(record))}`}>{record.healthStatus}</span>, sortValue: (record) => record.healthStatus },
    { id: 'recommendation', header: 'Recommendation', accessor: 'recommendation', cellClassName: 'min-w-48' },
    actionColumn,
  ]

  const primaryColumns = [
    {
      ...propertyNameColumn,
      render: (record) => (
        <div>
          <span className="font-semibold text-gray-900 dark:text-white">{record.name}</span>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {[record.city, record.state].filter((item) => item && item !== '—' && item !== 'Unassigned').join(', ') || 'Location not set'}
          </p>
        </div>
      ),
    },
    { id: 'city', header: 'City', accessor: 'city', sortValue: (record) => record.city },
    { id: 'marketValue', header: 'Market Value', align: 'right', render: (record) => metricFullDisplay(record.marketValueMetric), sortValue: (record) => record.marketValueMetric?.value },
    { id: 'equity', header: 'Equity', align: 'right', render: (record) => metricFullDisplay(record.equityMetric), sortValue: (record) => record.equityMetric?.value },
    { id: 'ltv', header: 'LTV', align: 'right', render: (record) => metricDisplay(record.ltvMetric), sortValue: (record) => record.ltvMetric?.value },
    { id: 'housingCost', header: 'Housing Cost', align: 'right', render: (record) => metricDisplay(record.monthlyHousingCostMetric), sortValue: (record) => record.monthlyHousingCostMetric?.value },
    { id: 'health', header: 'Health', render: (record) => <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClasses(healthTone(record))}`}>{record.healthStatus}</span>, sortValue: (record) => record.healthStatus },
    actionColumn,
  ]

  if (loading) {
    return (
      <PropertiesShell>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </PropertiesShell>
    )
  }

  return (
    <PropertiesShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Portfolio Manager</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {rentalRecords.length} rental {rentalRecords.length === 1 ? 'property' : 'properties'}
            {primaryRecords.length > 0 ? ` · ${primaryRecords.length} primary residence${primaryRecords.length === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800" aria-label="Property view mode">
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${viewMode === 'cards' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              onClick={() => setViewMode('cards')}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              Cards
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              onClick={() => setViewMode('table')}
            >
              <List className="h-4 w-4" aria-hidden="true" />
              Table
            </button>
          </div>
          <Link to="/uploads" className="btn-secondary flex items-center gap-2" title="Upload documents to update property and loan data">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Add Statement
          </Link>
          <Link to="/properties/new" className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Property
          </Link>
        </div>
      </div>

      {properties.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <MetricCard metric={overviewByKey.get('portfolioValue')} label="Market Value" fallbackValue={formatMetricCurrency(dashboard.total_market_value)} backendOwned />
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <MetricCard metric={loanBalanceMetric} backendOwned />
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <MetricCard metric={monthlyCashFlow} label="Rental Cash Flow" backendOwned />
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <MetricCard metric={totalPropertiesMetric} backendOwned />
          </div>
        </div>
      ) : null}

      {checklistSummary?.total_missing > 0 ? (
        <div className="card flex flex-col gap-3 border-amber-200 dark:border-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {checklistSummary.total_missing} document{checklistSummary.total_missing === 1 ? '' : 's'} missing across your portfolio
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {checklistSummary.properties
                  .filter((property) => property.missing_count > 0)
                  .slice(0, 4)
                  .map((property) => `${property.name || property.address} (${property.missing_count})`)
                  .join(' · ')}
                {checklistSummary.properties.filter((property) => property.missing_count > 0).length > 4 ? ' · ...' : ''}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {properties.length === 0 ? (
        <div className="card py-20 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" aria-hidden="true" />
          <h2 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-200">No properties yet</h2>
          <p className="mx-auto mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
            Upload a mortgage statement to create property and loan records, or add a property manually.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/uploads" className="btn-primary flex items-center gap-2">
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload Mortgage Statement
            </Link>
            <Link to="/properties/new" className="btn-secondary">Add Manually</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <PrimaryResidenceSection records={primaryRecords} columns={primaryColumns} getRowProps={propertyRowProps} />

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-800 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-gray-950 dark:text-white">Rental portfolio</h2>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{filteredRentalRecords.length}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review cash flow, equity, leverage, and data health in one list.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" />
                  <span className="sr-only">Search properties</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search properties"
                    className="w-56 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </label>
                <label>
                  <span className="sr-only">Filter by health</span>
                  <select
                    value={healthFilter}
                    onChange={(event) => setHealthFilter(event.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    {HEALTH_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                {viewMode === 'cards' ? (
                  <label>
                    <span className="sr-only">Organize property grid</span>
                    <select
                      value={groupBy}
                      onChange={(event) => setGroupBy(event.target.value)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    >
                      {GROUP_OPTIONS.map((option) => <option key={option.key} value={option.key}>Group by {option.label}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>

            {filteredRentalRecords.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">No rental properties match the current filters.</div>
            ) : viewMode === 'table' ? (
              <div className="p-3 sm:p-4">
                <DataTable
                  columns={tableColumns}
                  rows={filteredRentalRecords}
                  getRowKey={(record) => record.id}
                  getRowProps={propertyRowProps}
                  emptyMessage="No rental properties match the current filters."
                />
              </div>
            ) : (
              <div className="space-y-6 p-5">
                {groupedRecords.map((group) => (
                  <div key={group.label} className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-2 dark:border-gray-700">
                      <MapPin className="h-4 w-4 text-gray-400" aria-hidden="true" />
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">{group.label}</h3>
                      <span className="text-sm text-gray-400">({group.items.length})</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {group.items.map((record) => <PropertyCard key={record.id} record={record} onDelete={handleDeleteProperty} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete property?"
        description={`“${deleteTarget ? propertyLabel(deleteTarget) : 'This property'}” and its related records will be permanently removed. This action cannot be undone.`}
        confirmLabel="Delete property"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteProperty}
      />
    </PropertiesShell>
  )
}
