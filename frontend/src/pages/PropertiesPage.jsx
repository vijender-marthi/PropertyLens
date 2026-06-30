import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { propAPI } from '../services/api'
import { Building2, Plus, MapPin, TrendingUp, TrendingDown, Upload } from 'lucide-react'
import toast from 'react-hot-toast'

const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)

export default function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    propAPI.list()
      .then((r) => setProperties(r.data))
      .catch(() => toast.error('Failed to load properties'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Properties</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{properties.length} rental {properties.length === 1 ? 'property' : 'properties'}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/uploads" className="btn-secondary flex items-center gap-2"
            title="Upload a mortgage statement — the property and loan are created automatically">
            <Upload className="w-4 h-4" /> Add from Statement
          </Link>
          <Link to="/properties/new" className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Property
          </Link>
        </div>
      </div>

      {properties.length === 0 ? (
        <div className="text-center py-20 card">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">No properties yet</h2>
          <p className="text-gray-400 dark:text-gray-500 mb-6">
            Drop a mortgage statement and we'll create the property and loan for you —
            or add one manually
          </p>
          <div className="flex justify-center gap-3">
            <Link to="/uploads" className="btn-primary flex items-center gap-2">
              <Upload className="w-4 h-4" /> Upload Mortgage Statement
            </Link>
            <Link to="/properties/new" className="btn-secondary">Add Manually</Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p, i) => (
            <PropertyCard key={p.id} property={p} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

const TILE_COLORS = [
  'bg-white dark:bg-gray-800',
  'bg-gray-50 dark:bg-gray-800',
]

function PropertyCard({ property: p, index = 0 }) {
  const tileBg = TILE_COLORS[index % TILE_COLORS.length]
  const positive = p.monthly_cash_flow >= 0

  return (
    <Link to={`/properties/${p.id}`} className={`card hover:shadow-md transition-shadow block ${tileBg}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">{p.address}</h3>
          <p className="text-sm text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3" /> {p.city}, {p.state}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
          <span className="badge-blue">{p.property_type}</span>
          <span className={p.usage_type === 'Primary' ? 'badge-yellow' : 'badge-green'}>
            {p.usage_type === 'Primary' ? 'Primary Home' : 'Rental'}
          </span>
          {p.shared_by_name && (
            <span className="text-xs bg-purple-50 text-purple-700 border border-purple-100 rounded px-1.5 py-0.5">
              {p.shared_by_name}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Metric label="Monthly Rent" value={fmt(p.monthly_rent)} />
        <Metric label="Mortgage/mo" value={fmt(p.monthly_mortgage)} />
        <Metric label="Market Value" value={fmt(p.market_value)} />
        <Metric label="Loan Balance" value={fmt(p.total_loan_balance)} />
      </div>

      <div className={`mt-4 flex items-center gap-1.5 text-sm font-semibold ${positive ? 'text-green-600' : 'text-red-600'}`}>
        {positive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        {fmt(p.monthly_cash_flow)}/mo cash flow
      </div>
    </Link>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}
