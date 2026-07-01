import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Home, MapPin, Plus, TrendingDown, TrendingUp, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { propAPI } from '../services/api'

const fmt = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0)

export default function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    propAPI.list()
      .then((r) => setProperties(r.data || []))
      .catch(() => toast.error('Failed to load properties'))
      .finally(() => setLoading(false))
  }, [])

  const summary = useMemo(() => {
    const rental = properties.filter((p) => (p.usage_type || 'Rental').toLowerCase() !== 'primary')
    const primary = properties.filter((p) => (p.usage_type || '').toLowerCase() === 'primary')
    return {
      rentalCount: rental.length,
      primaryCount: primary.length,
      marketValue: properties.reduce((sum, p) => sum + (p.market_value || 0), 0),
      loanBalance: properties.reduce((sum, p) => sum + (p.total_loan_balance || 0), 0),
      monthlyCashFlow: rental.reduce((sum, p) => sum + (p.monthly_cash_flow || 0), 0),
    }
  }, [properties])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Properties</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {summary.rentalCount} rental {summary.rentalCount === 1 ? 'property' : 'properties'}
            {summary.primaryCount > 0 ? ` · ${summary.primaryCount} primary residence` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/uploads"
            className="btn-secondary flex items-center gap-2"
            title="Upload documents to update property and loan data"
          >
            <Upload className="h-4 w-4" />
            Add Statement
          </Link>
          <Link to="/properties/new" className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Property
          </Link>
        </div>
      </div>

      {properties.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="Market Value" value={fmt(summary.marketValue)} />
          <SummaryTile label="Loan Balance" value={fmt(summary.loanBalance)} />
          <SummaryTile
            label="Rental Cash Flow"
            value={fmt(summary.monthlyCashFlow)}
            tone={summary.monthlyCashFlow >= 0 ? 'positive' : 'negative'}
            suffix="/mo"
          />
          <SummaryTile label="Total Properties" value={String(properties.length)} />
        </div>
      )}

      {properties.length === 0 ? (
        <div className="card py-20 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" />
          <h2 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-200">No properties yet</h2>
          <p className="mx-auto mb-6 max-w-md text-sm text-gray-500 dark:text-gray-400">
            Upload a mortgage statement to create property and loan records, or add a property manually.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/uploads" className="btn-primary flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload Mortgage Statement
            </Link>
            <Link to="/properties/new" className="btn-secondary">
              Add Manually
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value, suffix, tone }) {
  const color = tone === 'negative'
    ? 'text-red-600 dark:text-red-400'
    : tone === 'positive'
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-900 dark:text-white'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>
        {value}
        {suffix ? <span className="ml-1 text-sm font-medium text-gray-400 dark:text-gray-500">{suffix}</span> : null}
      </p>
    </div>
  )
}

function PropertyCard({ property: p }) {
  const isPrimary = (p.usage_type || '').toLowerCase() === 'primary'
  const positive = (p.monthly_cash_flow || 0) >= 0

  return (
    <Link
      to={`/properties/${p.id}`}
      className="card block transition-shadow hover:shadow-md dark:hover:border-gray-600"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-gray-900 dark:text-white">{p.address}</h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{[p.city, p.state].filter(Boolean).join(', ') || 'Location not set'}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="badge-blue">{p.property_type || 'Property'}</span>
          <span className={isPrimary ? 'badge-yellow' : 'badge-green'}>
            {isPrimary ? 'Primary Home' : 'Rental'}
          </span>
          {p.shared_by_name ? (
            <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
              {p.shared_by_name}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric label={isPrimary ? 'Monthly Rent' : 'Monthly Rent'} value={isPrimary ? 'Excluded' : fmt(p.monthly_rent)} muted={isPrimary} />
        <Metric label="Mortgage/mo" value={fmt(p.monthly_mortgage)} />
        <Metric label="Market Value" value={fmt(p.market_value)} />
        <Metric label="Loan Balance" value={fmt(p.total_loan_balance)} />
      </div>

      {!isPrimary ? (
        <div className={`mt-4 flex items-center gap-1.5 text-sm font-semibold ${positive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {fmt(p.monthly_cash_flow)}/mo cash flow
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-gray-500 dark:text-gray-400">
          <Home className="h-4 w-4" />
          Excluded from rental metrics
        </div>
      )}
    </Link>
  )
}

function Metric({ label, value, muted = false }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  )
}
