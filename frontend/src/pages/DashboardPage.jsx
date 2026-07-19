import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Home,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { formatCurrencyCompact, formatCurrency, formatPercent, formatRatio } from '../utils/formatters'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'

const KPI_ICONS = {
  portfolioValue: Home,
  totalEquity: Landmark,
  monthlyNetCashFlow: WalletCards,
  portfolioLtv: ShieldCheck,
  annualNoi: BarChart3,
  propertiesNeedingAttention: AlertCircle,
}

function num(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function money(value) {
  return formatCurrencyCompact(value, { threshold: 100_000, kDigits: 1, mDigits: 2 })
}

function metricValue(metric) {
  if (!metric) return '—'
  if (metric.unit === 'percent') return formatPercent(metric.value)
  if (metric.unit === 'ratio') return formatRatio(metric.value)
  if (metric.unit === 'count') return String(metric.value ?? 0)
  return metric.display || metric.fullDisplay || money(metric.value)
}

function metricTone(metric) {
  if (metric?.status === 'data_issue') return 'text-amber-700 bg-amber-50 ring-amber-100'
  if (num(metric?.value) < 0) return 'text-red-700 bg-red-50 ring-red-100'
  return 'text-blue-700 bg-blue-50 ring-blue-100'
}

function DashboardCard({ children, className = '' }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>
      {children}
    </section>
  )
}

function KpiCard({ metric }) {
  const Icon = KPI_ICONS[metric?.key] || BarChart3
  return (
    <DashboardCard className="p-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${metricTone(metric)}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">{metric?.label || 'Metric'}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{metricValue(metric)}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-500">{metric?.reason || metric?.description || 'Current portfolio signal'}</p>
        </div>
      </div>
    </DashboardCard>
  )
}

function FilterBar({ properties, excludedIds, setExcludedIds }) {
  const includedCount = properties.filter((property) => !excludedIds.has(property.id)).length
  const toggle = (id) => {
    setExcludedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <DashboardCard className="p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Property Filter</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-neutral-300">{includedCount} of {properties.length} properties included in this executive view</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => setExcludedIds(new Set())}>Select all</button>
          {properties.map((property) => {
            const selected = !excludedIds.has(property.id)
            return (
              <button
                key={property.id}
                type="button"
                onClick={() => toggle(property.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-gray-200 bg-white text-gray-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400'
                }`}
              >
                <span className={`h-3.5 w-3.5 rounded border ${selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`} />
                {property.address || property.name || `Property ${property.id}`}
              </button>
            )
          })}
        </div>
      </div>
    </DashboardCard>
  )
}

function HealthGauge({ dashboard }) {
  const checks = dashboard.dataQuality?.checks || []
  const healthRows = dashboard.propertyHealth || []
  const stable = healthRows.filter((row) => row.status === 'Stable').length
  const score = healthRows.length ? Math.round((stable / healthRows.length) * 10 * 10) / 10 : dashboard.dataQualityStatus === 'Complete' ? 9 : 7
  const pct = Math.max(0, Math.min(100, score * 10))
  const label = score >= 8 ? 'Strong' : score >= 6 ? 'Watch' : 'Needs Review'

  return (
    <DashboardCard className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">Portfolio Health</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Executive readiness score</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${score >= 8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{label}</span>
      </div>
      <div className="mt-5 flex items-center gap-5">
        <div
          className="grid h-32 w-32 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(${score >= 8 ? '#10b981' : '#f59e0b'} ${pct}%, #e5e7eb ${pct}%)` }}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white dark:bg-neutral-900">
            <div className="text-center">
              <p className="text-3xl font-semibold text-gray-950 dark:text-white">{score}</p>
              <p className="text-xs text-gray-500">/10</p>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {[
            ['Cash Flow', dashboard.overview?.find((metric) => metric.key === 'monthlyNetCashFlow')?.display],
            ['Data Quality', dashboard.dataQualityStatus],
            ['Properties', `${dashboard.scope?.includedRentalProperties || 0} rentals`],
            ['Validation', checks[0]?.display || checks[0]?.reason || 'Current'],
          ].map(([labelText, value]) => (
            <div key={labelText} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-500 dark:text-neutral-400">{labelText}</span>
              <span className="font-semibold text-gray-800 dark:text-neutral-100">{value || '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </DashboardCard>
  )
}

function StorySummary({ dashboard }) {
  const stories = dashboard.stories || []
  const cashFlow = stories.find((story) => story.key === 'cashFlow') || stories[0]
  const firstAction = (dashboard.attention?.groups || []).flatMap((group) => group.actions || [])[0]
  const headline = cashFlow?.chart?.insight || cashFlow?.explanation || 'Portfolio summary is available from backend metrics.'
  const why = firstAction?.whyItMatters || cashFlow?.chart?.recommendation || 'The dashboard is showing current portfolio movement from rent, operating expenses, and debt service.'

  return (
    <DashboardCard className="p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI Story</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-950 dark:text-white">Tell me what’s happening.</h2>
          <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-neutral-200">{headline}</p>
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400">Tell me why it’s happening.</p>
            <p className="mt-1 text-sm leading-6 text-gray-700 dark:text-neutral-200">{why}</p>
          </div>
        </div>
      </div>
    </DashboardCard>
  )
}

function Waterfall({ dashboard }) {
  const nodes = dashboard.stories?.find((story) => story.key === 'cashFlow')?.chart?.nodes || []
  const max = Math.max(...nodes.map((node) => Math.abs(num(node.value || node.runningTotal))), 1)
  if (!nodes.length) return <EmptyBlock label="Cash flow story unavailable" />
  return (
    <DashboardCard className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">Cash Flow</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Monthly path from rent to net cash flow</p>
        </div>
        <Link to="/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
          Analyze
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="space-y-3">
        {nodes.map((node) => {
          const negative = node.tone === 'negative'
          const width = Math.max(6, Math.abs(num(node.value || node.runningTotal)) / max * 100)
          return (
            <div key={node.key || node.label} className={`grid grid-cols-[8.5rem_1fr_5rem] items-center gap-3 text-xs ${node.total ? 'border-t border-gray-100 pt-3 font-semibold dark:border-neutral-800' : ''}`}>
              <span className="text-gray-600 dark:text-neutral-300">{node.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
                <div className={`h-full rounded-full ${negative ? 'bg-red-500' : node.total ? 'bg-blue-500' : 'bg-emerald-500'}`} style={{ width: `${width}%` }} />
              </div>
              <span className={`text-right font-semibold ${negative ? 'text-red-600' : 'text-gray-950 dark:text-white'}`}>{node.display || node.runningDisplay}</span>
            </div>
          )
        })}
      </div>
    </DashboardCard>
  )
}

function PropertyRanking({ rows }) {
  const sorted = (rows || []).slice().sort((a, b) => num(b.monthlyCashFlow?.value) - num(a.monthlyCashFlow?.value))
  return (
    <DashboardCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">Property Performance Ranking</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Fast scan for daily attention</p>
        </div>
        <Link to="/properties" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Property</th>
              <th className="px-3 py-2 text-right font-semibold">Cash Flow</th>
              <th className="px-3 py-2 text-right font-semibold">DSCR</th>
              <th className="px-3 py-2 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
            {sorted.map((row, index) => (
              <tr key={row.id || row.property}>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${index < 3 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{index + 1}</span>
                    <span className="font-medium text-gray-900 dark:text-neutral-100">{row.property}</span>
                  </div>
                </td>
                <td className={`px-3 py-3 text-right font-semibold ${num(row.monthlyCashFlow?.value) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{row.monthlyCashFlow?.display || '—'}</td>
                <td className="px-3 py-3 text-right text-gray-700 dark:text-neutral-300">{metricValue(row.dscr)}</td>
                <td className="px-3 py-3 text-right">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'Stable' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardCard>
  )
}

function AllocationBars({ properties }) {
  const total = properties.reduce((sum, property) => sum + num(property.market_value), 0)
  if (!properties.length) return <EmptyBlock label="No property allocation data" />
  return (
    <DashboardCard className="p-5">
      <h2 className="text-base font-semibold text-gray-950 dark:text-white">Portfolio Allocation</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">By property value, shown without pie charts</p>
      <div className="mt-4 space-y-3">
        {properties.slice().sort((a, b) => num(b.market_value) - num(a.market_value)).map((property) => {
          const pct = total ? num(property.market_value) / total * 100 : 0
          return (
            <div key={property.id || property.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-gray-700 dark:text-neutral-200">{property.name || property.address || `Property ${property.id}`}</span>
                <span className="text-gray-500">{pct.toFixed(1)}% · {money(property.market_value)}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-neutral-800">
                <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.max(3, pct)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </DashboardCard>
  )
}

function CashFlowTrend({ trends }) {
  const rows = (trends || []).map((row) => ({ year: row.year, cashFlow: num(row.net_income), income: num(row.rental_income) }))
  if (!rows.length) return <EmptyBlock label="No trend data available" />
  return (
    <DashboardCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">Cash Flow Trend</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Yearly net rental income trend</p>
        </div>
        <Link to="/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300">Deep analysis <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
            <XAxis dataKey="year" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} tickFormatter={(value) => formatCurrencyCompact(value)} />
            <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} />
            <Line type="monotone" dataKey="cashFlow" name="Net Income" stroke={chartColors.primary} strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </DashboardCard>
  )
}

function AttentionPanel({ dashboard }) {
  const actions = (dashboard.attention?.groups || []).flatMap((group) => group.actions || [])
  return (
    <DashboardCard className="p-5">
      <h2 className="text-base font-semibold text-gray-950 dark:text-white">What Needs Attention</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Prioritized backend recommendations</p>
      <div className="mt-4 space-y-3">
        {actions.length ? actions.slice(0, 4).map((action) => (
          <div key={action.id} className={`rounded-lg border p-3 ${action.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-950' : action.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-blue-200 bg-blue-50 text-blue-950'}`}>
            <p className="text-sm font-semibold">{action.title}</p>
            <p className="mt-1 text-xs opacity-80">{action.scope} · {action.financialImpact}</p>
            {action.primaryAction?.href ? <Link to={action.primaryAction.href} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold">Review <ArrowRight className="h-3.5 w-3.5" /></Link> : null}
          </div>
        )) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mb-2 h-4 w-4" />
            No urgent actions in the selected portfolio scope.
          </div>
        )}
      </div>
    </DashboardCard>
  )
}

function ScenarioPanel() {
  const assumptions = [
    ['Interest Rate', '5.50%'],
    ['Rent Increase', '5%'],
    ['Vacancy Rate', '3%'],
    ['Maintenance', '10%'],
    ['Property Tax', '4%'],
  ]
  return (
    <DashboardCard className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-950 dark:text-white">Scenario Snapshot</h2>
        <Link to="/analytics" className="text-xs font-semibold text-blue-700 dark:text-blue-300">Open</Link>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Fast what-if controls. Deep scenario work lives in Analytics.</p>
      <div className="mt-4 space-y-2">
        {assumptions.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-neutral-800">
            <span className="text-gray-500 dark:text-neutral-400">{label}</span>
            <span className="font-semibold text-gray-900 dark:text-neutral-100">{value}</span>
          </div>
        ))}
      </div>
      <Link to="/analytics" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
        Run Analysis
        <ArrowRight className="h-4 w-4" />
      </Link>
    </DashboardCard>
  )
}

function EmptyBlock({ label }) {
  return <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400 dark:border-neutral-700">{label}</div>
}

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [excludedIds, setExcludedIds] = useState(new Set())

  const excludedKey = useMemo(() => Array.from(excludedIds).sort((a, b) => a - b).join(','), [excludedIds])

  useEffect(() => {
    setLoading(true)
    propAPI.dashboard(excludedKey)
      .then((response) => setData(response.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false))
  }, [excludedKey])

  const dashboard = data?.executive_dashboard
  const portfolio = data?.dashboard || {}
  const filterProperties = portfolio.filter_properties || []

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </PageContainer>
    )
  }

  if (!dashboard) {
    return (
      <PageContainer>
        <div className="rounded-xl border border-amber-200 bg-amber-50 py-12 text-center text-amber-950">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-semibold">Dashboard unavailable</h1>
          <p className="mt-1 text-sm">The backend dashboard view model could not be loaded.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-[112rem]">
      <div className="space-y-5">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Portfolio Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">30-second executive summary: what happened, why it happened, and what needs attention.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4" />
              {dashboard.asOfDate || 'Current'}
              <ChevronDown className="h-4 w-4" />
            </button>
            <Link to="/analytics" className="btn-primary inline-flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" />
              Deep Analysis
            </Link>
          </div>
        </header>

        <FilterBar properties={filterProperties} excludedIds={excludedIds} setExcludedIds={setExcludedIds} />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {(dashboard.overview || []).map((metric) => <KpiCard key={metric.key || metric.label} metric={metric} />)}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr_1fr]">
              <HealthGauge dashboard={dashboard} />
              <StorySummary dashboard={dashboard} />
              <Waterfall dashboard={dashboard} />
            </div>
            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <PropertyRanking rows={dashboard.propertyHealth || []} />
              <AllocationBars properties={portfolio.properties || []} />
            </div>
            <CashFlowTrend trends={data?.yearly_trends || []} />
          </main>
          <aside className="space-y-5">
            <AttentionPanel dashboard={dashboard} />
            <ScenarioPanel />
          </aside>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
          <span className="font-semibold">Dashboard vs Analytics:</span> Dashboard is the executive summary for daily use. Analytics is the investigation page for interactive charting, comparisons, and deeper monthly review.
        </div>
      </div>
    </PageContainer>
  )
}
