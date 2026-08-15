import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2, Home, Plus, Search } from 'lucide-react'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { homeTypeLabel } from '../config/propertySetupPresentation'
import { propertyLabel } from '../utils/propertyDisplay'
import { formatMetricCurrency } from '../utils/formatters'

const ACCENT = ['#3b82f6', '#14b8a6', '#6366f1', '#d946ef', '#06b6d4', '#f43f5e']
const HEALTH = { ok: '#16a34a', watch: '#d97706', action: '#dc2626' }

const isPrimary = (p) => (p.usage_type || '').toLowerCase() === 'primary'
const mval = (m) => (m && typeof m === 'object' ? (m.value ?? 0) : (m ?? 0))
const compact = (v) => formatMetricCurrency(v || 0)

function healthTier(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('review') || s.includes('action') || s.includes('critical')) return 'action'
  if (s.includes('watch') || s.includes('warning') || s.includes('needs')) return 'watch'
  return 'ok'
}

function normalize(property, healthRow) {
  const m = property.metrics || {}
  return {
    id: property.id,
    property,
    name: healthRow?.property || propertyLabel(property),
    city: property.city || '',
    state: property.state || '',
    type: homeTypeLabel(property.property_type, property.property_type_raw) || 'Property',
    primary: isPrimary(property),
    health: healthTier(healthRow?.status || property.health_status || 'stable'),
    value: mval(healthRow?.marketValue || m.marketValue),
    equity: mval(healthRow?.equity || m.equity),
    cashFlow: mval(healthRow?.monthlyCashFlow || m.monthlyCashFlow),
  }
}

function PropertyCard({ r, accent }) {
  const Icon = r.primary ? Home : Building2
  const pct = r.value > 0 ? Math.max(0, Math.min(100, Math.round(r.equity / r.value * 100))) : 0
  return (
    <Link to={`/properties/${r.id}`} className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-emerald-400 dark:border-neutral-800 dark:bg-neutral-900">
      <span className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: HEALTH[r.health] }} title={r.health} />
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl" style={{ backgroundColor: `${accent}22`, color: accent }}><Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} /></span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-gray-950 dark:text-white">{r.name}</p>
          <p className="text-xs text-gray-400">{[r.city, r.state].filter(Boolean).join(', ') || r.type}</p>
          <span className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${r.primary ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'}`}>{r.primary ? 'Primary' : 'Rental'}</span>
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 tabular-nums dark:border-neutral-800">
        <div><p className="text-[10.5px] text-gray-400">Value</p><p className="mt-0.5 text-sm font-semibold">{compact(r.value)}</p></div>
        <div><p className="text-[10.5px] text-gray-400">Equity</p><p className="mt-0.5 text-sm font-semibold">{compact(r.equity)}</p></div>
        <div><p className="text-[10.5px] text-gray-400">Cash flow</p><p className={`mt-0.5 text-sm font-semibold ${r.cashFlow < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{compact(r.cashFlow)}<span className="text-[10px] font-normal text-gray-400">/mo</span></p></div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: accent }} /></div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-gray-400"><span>{pct}% owned</span><span>{100 - pct}% financed</span></div>
    </Link>
  )
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [dashboardData, setDashboardData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [attention, setAttention] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.allSettled([propAPI.list(), propAPI.dashboard()])
      .then(([p, d]) => {
        if (p.status === 'fulfilled') setProperties(p.value.data || [])
        else toast.error('Failed to load properties')
        if (d.status === 'fulfilled') setDashboardData(d.value.data || null)
      })
      .finally(() => setLoading(false))
  }, [])

  const healthById = useMemo(() => {
    const rows = dashboardData?.executive_dashboard?.propertyHealth || []
    return new Map(rows.map((row) => [row.id, row]))
  }, [dashboardData])

  const records = useMemo(() => properties.map((p) => normalize(p, healthById.get(p.id))), [properties, healthById])
  const accentByRank = useMemo(() => {
    const rank = {}
    ;[...records].sort((a, b) => a.id - b.id).forEach((r, i) => { rank[r.id] = i % ACCENT.length })
    return rank
  }, [records])

  const q = query.trim().toLowerCase()
  const match = (r) => (!q || `${r.name} ${r.city} ${r.state} ${r.type}`.toLowerCase().includes(q)) && (!attention || r.health !== 'ok')
  const primaries = records.filter((r) => r.primary && match(r)).sort((a, b) => a.name.localeCompare(b.name))
  const rentals = records.filter((r) => !r.primary && match(r)).sort((a, b) => a.name.localeCompare(b.name))

  const totals = records.reduce((a, r) => ({ value: a.value + r.value, equity: a.equity + r.equity, cf: a.cf + r.cashFlow }), { value: 0, equity: 0, cf: 0 })
  const attentionCount = records.filter((r) => r.health !== 'ok').length

  if (loading && !properties.length) {
    return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div></PageContainer>
  }

  return (
    <PageContainer>
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Portfolio Manager</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Every property at a glance — value, equity, and what it's earning.</p>
          </div>
          <Link to="/properties/new" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"><Plus className="h-4 w-4" /> Add property</Link>
        </div>

        <div className="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-4">
          {[['Properties', String(records.length)], ['Portfolio value', compact(totals.value)], ['Total equity', compact(totals.equity)], ['Monthly cash flow', compact(totals.cf)]].map(([k, v], i) => (
            <div key={k} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-xs text-gray-500 dark:text-neutral-400">{k}</p>
              <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${i === 3 && totals.cf < 0 ? 'text-red-600' : 'text-gray-950 dark:text-white'}`}>{v}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, address, or city" className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-white" />
          </div>
          {attentionCount > 0 ? (
            <button type="button" onClick={() => setAttention((a) => !a)} aria-pressed={attention} className={`rounded-full border px-3.5 py-2 text-sm transition ${attention ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-300'}`}>Needs attention · {attentionCount}</button>
          ) : null}
        </div>

        {primaries.length ? (
          <>
            <div className="flex items-center gap-2 pt-5 text-xs font-semibold uppercase tracking-wide text-gray-400"><Home className="h-4 w-4" /> Primary residence <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-normal normal-case dark:border-neutral-700">{primaries.length}</span></div>
            <div className="grid gap-3.5 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {primaries.map((r) => <PropertyCard key={r.id} r={r} accent={ACCENT[accentByRank[r.id] ?? 0]} />)}
            </div>
          </>
        ) : null}

        <div className="flex items-center gap-2 pt-5 text-xs font-semibold uppercase tracking-wide text-gray-400"><Building2 className="h-4 w-4" /> Rentals <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-normal normal-case dark:border-neutral-700">{rentals.length}</span></div>
        <div className="grid gap-3.5 pt-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          {rentals.map((r) => <PropertyCard key={r.id} r={r} accent={ACCENT[accentByRank[r.id] ?? 0]} />)}
          <Link to="/properties/new" className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-gray-300 text-gray-500 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-neutral-700 dark:text-neutral-400">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"><Plus className="h-5 w-5" /></span>
            <span className="text-sm font-medium">Add property</span>
            <span className="text-[11.5px] text-gray-400">Primary or rental</span>
          </Link>
        </div>
      </div>
    </PageContainer>
  )
}
