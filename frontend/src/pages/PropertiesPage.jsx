import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, Home, MapPin, Plus, Trash2, TrendingDown, TrendingUp, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { propAPI } from '../services/api'
import { propertyLabel, shortPropertyUid } from '../utils/propertyDisplay'

const fmt = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0)

export default function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [checklistSummary, setChecklistSummary] = useState(null)

  useEffect(() => {
    setLoading(true)
    propAPI.list()
      .then((r) => setProperties(r.data || []))
      .catch(() => toast.error('Failed to load properties'))
      .finally(() => setLoading(false))
    propAPI.checklistSummary()
      .then((r) => setChecklistSummary(r.data))
      .catch(() => setChecklistSummary(null))
}, [])

const refreshProperties = () => {
propAPI.list()
.then((r) => setProperties(r.data || []))
.catch(() => toast.error('Failed refresh properties'))
propAPI.checklistSummary()
.then((r) => setChecklistSummary(r.data))
.catch(() => setChecklistSummary(null))
}

const handleDeleteProperty = async (property) => {
if (!confirm(`Delete ${propertyLabel(property)}? This cannot be undone.`)) return
try {
await propAPI.delete(property.id)
toast.success('Property deleted')
refreshProperties()
} catch (err) {
toast.error(err.response?.data?.detail || 'Failed delete property')
}
}

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

const primaryProperties = useMemo(
() => properties
.filter((p) => (p.usage_type || '').toLowerCase() === 'primary')
.sort((a, b) => propertyLabel(a).localeCompare(propertyLabel(b))),
[properties]
)

const rentalGroups = useMemo(() => {
const rentals = properties
.filter((p) => (p.usage_type || 'Rental').toLowerCase() !== 'primary')
.sort((a, b) => {
const stateA = (a.state || '').trim()
const stateB = (b.state || '').trim()
if (!stateA && stateB) return 1
if (stateA && !stateB) return -1
return stateA.localeCompare(stateB) || propertyLabel(a).localeCompare(propertyLabel(b))
})

const groups = []
rentals.forEach((property) => {
const key = (property.state || '').trim() || 'Unassigned'
let group = groups[groups.length - 1]
if (!group || group.state !== key) {
group = { state: key, properties: [] }
groups.push(group)
}
group.properties.push(property)
})
return groups
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

      {checklistSummary?.total_missing > 0 && (
        <div className="card flex flex-col gap-3 border-amber-200 dark:border-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {checklistSummary.total_missing} document{checklistSummary.total_missing === 1 ? '' : 's'} missing across your portfolio
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {checklistSummary.properties
                  .filter((p) => p.missing_count > 0)
                  .slice(0, 4)
                  .map((p) => `${p.name || p.address} (${p.missing_count})`)
                  .join(' · ')}
                {checklistSummary.properties.filter((p) => p.missing_count > 0).length > 4 ? ' · …' : ''}
              </p>
            </div>
          </div>
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
        <div className="space-y-8">
          {primaryProperties.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Home className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">Primary Residence</h2>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{primaryProperties.length}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
{primaryProperties.map((property) => (
<PropertyCard key={property.id} property={property} featured onDelete={handleDeleteProperty} />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-green-600" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">Rental Properties</h2>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/20 dark:text-green-300">{summary.rentalCount}</span>
            </div>
            {rentalGroups.length === 0 ? (
              <div className="card py-8 text-center text-sm text-gray-400">No rental properties yet.</div>
            ) : (
              <div className="space-y-6">
                {rentalGroups.map((group) => (
                  <div key={group.state}>
                    <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 dark:border-gray-700">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">{group.state}</h3>
                      <span className="text-sm text-gray-400">({group.properties.length})</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
{group.properties.map((property) => (
<PropertyCard key={property.id} property={property} onDelete={handleDeleteProperty} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
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

function PropertyCard({ property: p, featured = false, onDelete }) {
  const isPrimary = (p.usage_type || '').toLowerCase() === 'primary'
const isMixedUse = p.residency_status === 'Mixed' || (isPrimary && p.has_rental_history)
const positive = (p.monthly_cash_flow || 0) >= 0
const deleteProperty = (event) => {
event.preventDefault()
event.stopPropagation()
onDelete?.(p)
}

return (
<Link
to={`/properties/${p.id}`}
className={`card block transition-shadow hover:shadow-md ${featured ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10' : 'dark:hover:border-gray-600'}`}
>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-gray-900 dark:text-white">{propertyLabel(p)}</h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{[p.city, p.state].filter(Boolean).join(', ') || 'Location not set'}</span>
          </p>
          {p.property_uid ? (
            <p className="mt-1 text-xs font-medium text-gray-400 dark:text-gray-500">ID {shortPropertyUid(p)}</p>
          ) : null}
        </div>
<div className="flex shrink-0 flex-col items-end gap-1">
{onDelete ? (
<button
type="button"
onClick={deleteProperty}
className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
title="Delete property"
aria-label={`Delete ${propertyLabel(p)}`}
>
<Trash2 className="h-4 w-4" />
</button>
) : null}
<span className="badge-blue">{p.property_type || 'Property'}</span>
          <span className={isMixedUse ? 'badge-yellow' : isPrimary ? 'badge-yellow' : 'badge-green'}>
            {isMixedUse ? 'Mixed Use' : isPrimary ? 'Primary Home' : 'Rental'}
          </span>
          {isMixedUse ? (
            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
              Rental & Primary
            </span>
          ) : null}
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
