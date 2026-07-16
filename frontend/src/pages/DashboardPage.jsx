import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle,
  ChevronDown,
  DollarSign,
  Home,
  Landmark,
  Shield,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import DataTable from '../components/DataTable'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'

const storyAccent = 'text-blue-700'

const severityClass = {
  critical: 'border-red-200 bg-red-50 text-red-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  info: 'border-blue-200 bg-blue-50 text-blue-950',
}

function metricText(metric) {
  return metric?.display ?? metric?.fullDisplay ?? '—'
}

function metricFullText(metric) {
  return metric?.fullDisplay ?? metricText(metric)
}

function DashboardShell({ children }) {
  return <PageContainer>{children}</PageContainer>
}

function MetricEvidence({ metric, large = false }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metric?.label || 'Metric'}</p>
      <p className={`${large ? 'text-3xl' : 'text-xl'} mt-2 font-semibold text-slate-950`}>{metricText(metric)}</p>
      {metric?.reason ? <p className="mt-2 text-xs text-amber-700">{metric.reason}</p> : null}
    </div>
  )
}

function HeroCover({ dashboard }) {
  const overview = dashboard.overview || []
  const portfolioValue = overview.find((metric) => metric.key === 'portfolioValue') || overview[0]
  const netWorth = overview.find((metric) => metric.key === 'totalEquity') || overview[1]
  const cashFlow = overview.find((metric) => metric.key === 'monthlyNetCashFlow') || overview[2]
  const health = overview.find((metric) => metric.key === 'propertiesNeedingAttention') || overview[5]
  const summary = dashboard.stories?.[0]?.chart?.insight || dashboard.stories?.[0]?.explanation || 'Backend portfolio story is unavailable.'

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 shadow-sm">
      <div className="grid gap-8 p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">PropertyLens Portfolio Review</p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 lg:text-5xl">Your rental portfolio, explained like an investment brief.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">{summary}</p>
          <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
            <span>{dashboard.scope?.includedRentalProperties ?? 0} rental properties included</span>
            <span>{dashboard.scope?.excludedProperties ?? 0} excluded</span>
            <span>As of {dashboard.asOfDate || '—'}</span>
            <span>Last refresh {dashboard.lastRefresh || '—'}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{dashboard.dataQualityStatus || '—'}</span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricEvidence metric={portfolioValue} large />
          <MetricEvidence metric={netWorth} large />
          <MetricEvidence metric={cashFlow} />
          <MetricEvidence metric={{ label: 'Overall Health', display: dashboard.dataQualityStatus || metricText(health), reason: health?.reason }} />
        </div>
      </div>
    </section>
  )
}

function ChangeStrip({ dashboard }) {
  const changes = dashboard.changes || (dashboard.overview || []).slice(0, 4).map((metric) => ({
    key: metric.key,
    label: metric.label,
    display: metric.display,
    direction: metric.status === 'data_issue' ? 'needs review' : 'current',
    description: metric.description || 'Backend change comparison unavailable.',
  }))
  return (
    <section className="space-y-4">
      <EditorialHeader eyebrow="What changed since last review" title="Current movement signals" subtitle="These cards render backend change DTOs when available; otherwise they show current backend signals." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {changes.map((item) => (
          <div key={item.key || item.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.display || '—'}</p>
            <p className="mt-2 text-sm text-slate-500">{item.direction || item.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function EditorialHeader({ eyebrow, title, subtitle }) {
  return (
    <div className="max-w-3xl">
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${storyAccent}`}>{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p> : null}
    </div>
  )
}

function WaterfallVisual({ chart }) {
  const nodes = chart?.nodes || []
  if (!nodes.length) return <EmptyVisual />
  return (
    <div className="space-y-3">
      {nodes.map((node) => (
        <div key={node.key || node.label} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3 text-sm">
          <span className="font-medium text-slate-600">{node.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${node.tone === 'negative' ? 'bg-red-500' : node.tone === 'tax' ? 'bg-purple-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(8, Math.min(100, Math.abs(Number(node.runningTotal || node.value || 0)) / Math.max(...nodes.map((item) => Math.abs(Number(item.runningTotal || item.value || 0))), 1) * 100))}%` }} />
          </div>
          <span className="text-right font-semibold text-slate-950">{node.runningDisplay || node.display}</span>
        </div>
      ))}
    </div>
  )
}

function StackedEquityVisual({ chart }) {
  const rows = chart?.series || []
  if (!rows.length) return <EmptyVisual />
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.id || row.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">{row.label}</span>
            <span className="font-semibold text-slate-950">{row.totalDisplay}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
            {(row.segments || []).map((segment) => (
              <span key={segment.key} className={segment.key === 'appreciation' ? 'bg-emerald-500' : segment.key === 'principalPaydown' ? 'bg-blue-500' : 'bg-slate-400'} style={{ width: `${Math.max(4, Math.min(100, Number(segment.value || 0) / Math.max(Number(row.total || 1), 1) * 100))}%` }} title={`${segment.label}: ${segment.display}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DebtSpectrumVisual({ chart }) {
  const loans = chart?.loans || []
  if (!loans.length) return <EmptyVisual />
  return (
    <div className="space-y-3">
      {loans.map((loan) => (
        <div key={loan.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-slate-950">{loan.property}</p>
              <p className="text-xs text-slate-500">{loan.lender} · {loan.balanceDisplay}</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${loan.tone === 'negative' ? 'bg-red-50 text-red-700' : loan.tone === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{loan.rateDisplay}</span>
          </div>
          {loan.refinanceCandidate ? <p className="mt-2 text-xs font-medium text-red-700">Refinance candidate</p> : null}
        </div>
      ))}
    </div>
  )
}

function TrendVisual({ chart }) {
  const series = chart?.series || chart || []
  if (!Array.isArray(series) || !series.length) return <EmptyVisual />
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        {chart?.type === 'portfolio_area' ? (
          <AreaChart data={series}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
            <XAxis dataKey="year" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} />
            <Tooltip contentStyle={chartTooltipStyle(false)} />
            <Area type="monotone" dataKey="portfolioValue" name="Portfolio Value" fill={chartColors.primarySoft} stroke={chartColors.primary} />
            <Line type="monotone" dataKey="equity" name="Equity" stroke={chartColors.success} dot={false} />
          </AreaChart>
        ) : (
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
            <XAxis dataKey="year" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} />
            <Tooltip contentStyle={chartTooltipStyle(false)} />
            <Bar dataKey="rentalIncome" name="Rental Income" fill={chartColors.positiveSoft} radius={[3, 3, 0, 0]} />
            <Bar dataKey="netIncome" name="Net Income" fill={chartColors.primary} radius={[3, 3, 0, 0]} />
            <Bar dataKey="depreciation" name="Depreciation" fill={chartColors.purple} radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function RankingVisual({ rows }) {
  if (!rows?.length) return <EmptyVisual />
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 12, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chartColors.gridLight} />
          <XAxis type="number" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="property" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={110} />
          <Tooltip contentStyle={chartTooltipStyle(false)} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {rows.map((row) => <Cell key={row.id || row.property} fill={row.tone === 'negative' ? chartColors.negative : chartColors.primary} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function EmptyVisual() {
  return <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">Backend chart unavailable</div>
}

function StoryChart({ story }) {
  const chart = story.chart
  if (chart?.type === 'waterfall') return <WaterfallVisual chart={chart} />
  if (chart?.type === 'stacked_equity') return <StackedEquityVisual chart={chart} />
  if (chart?.type === 'debt_spectrum') return <DebtSpectrumVisual chart={chart} />
  if (chart?.type === 'tax_grouped' || chart?.type === 'portfolio_area') return <TrendVisual chart={chart} />
  if (Array.isArray(chart)) return <RankingVisual rows={chart} />
  return <EmptyVisual />
}

function StoryChapter({ story }) {
  const chart = story.chart || {}
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">{story.question || story.title}</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{chart.title || story.title}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">{chart.narrative || story.explanation}</p>
          <blockquote className="mt-5 border-l-4 border-blue-600 pl-4 text-sm font-medium leading-6 text-slate-800">{chart.insight || story.explanation}</blockquote>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(story.metrics || []).slice(0, 4).map((metric) => <MetricEvidence key={metric.key || metric.label} metric={metric} />)}
          </div>
          <div className="mt-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Recommendation</p>
            <p className="mt-1">{chart.recommendation || 'Backend recommendation unavailable.'}</p>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="mb-4 text-sm font-semibold text-slate-700">{chart.subtitle || 'Backend chart'}</p>
          <StoryChart story={story} />
        </div>
      </div>
    </article>
  )
}

function ActionGroup({ group }) {
  if (!group?.actions?.length) return null
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-950">{group.label}</h3>
      {group.actions.map((action) => (
        <div key={action.id} className={`rounded-xl border p-4 ${severityClass[action.severity] || severityClass.info}`}>
          <p className="text-sm font-semibold">{action.title}</p>
          <p className="mt-1 text-xs opacity-80">{action.scope} · {action.financialImpact}</p>
          <p className="mt-2 text-sm opacity-90">{action.whyItMatters}</p>
          {action.primaryAction?.href ? (
            <Link className="mt-3 inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline" to={action.primaryAction.href}>
              {action.primaryAction.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PortfolioCoach({ dashboard }) {
  const firstAction = (dashboard.attention?.groups || []).flatMap((group) => group.actions || [])[0]
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">AI Portfolio Coach</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{firstAction?.title || 'No urgent portfolio action is currently prioritized.'}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">{firstAction?.whyItMatters || 'Backend recommendations will appear here when the portfolio has a prioritized action.'}</p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">Impact: {firstAction?.financialImpact || '—'}</span>
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700">Confidence: backend-prioritized</span>
            {firstAction?.primaryAction?.href ? <Link className="rounded-full bg-blue-700 px-3 py-1 font-semibold text-white" to={firstAction.primaryAction.href}>{firstAction.primaryAction.label}</Link> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [excludedIds, setExcludedIds] = useState(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)

  const excludedKey = Array.from(excludedIds).sort((a, b) => a - b).join(',')

  useEffect(() => {
    setLoading(true)
    propAPI.dashboard(excludedKey)
      .then((response) => setData(response.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false))
  }, [excludedKey])

  const dashboard = data?.executive_dashboard
  const filterProperties = data?.dashboard?.filter_properties || []

  const healthColumns = [
    { id: 'property', header: 'Property', accessor: 'property', cellClassName: 'font-medium text-slate-950' },
    { id: 'cashFlow', header: 'Monthly Cash Flow', align: 'right', render: (row) => metricFullText(row.monthlyCashFlow) },
    { id: 'dscr', header: 'DSCR', align: 'right', render: (row) => metricText(row.dscr) },
    { id: 'ltv', header: 'LTV', align: 'right', render: (row) => metricText(row.ltv) },
    { id: 'equity', header: 'Equity', align: 'right', render: (row) => metricFullText(row.equity) },
    { id: 'status', header: 'Status', accessor: 'status' },
    { id: 'action', header: 'Action', render: (row) => row.id ? <Link className="text-sm font-medium text-blue-700" to={`/properties/${row.id}`}>{row.action}</Link> : row.action },
  ]

  if (loading) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </DashboardShell>
    )
  }

  if (!dashboard) {
    return (
      <DashboardShell>
        <div className="rounded-xl border border-amber-200 bg-amber-50 py-12 text-center text-amber-950">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-semibold">Dashboard unavailable</h1>
          <p className="mt-1 text-sm">The backend dashboard view model could not be loaded.</p>
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell>
      <div className="space-y-10">
        <div className="flex justify-end print:hidden">
          <div className="relative">
            <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setFiltersOpen((open) => !open)}>
              <Building2 className="h-4 w-4" />
              Properties
              <ChevronDown className="h-4 w-4" />
            </button>
            {filtersOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Included properties</span>
                  <button type="button" className="text-xs font-medium text-blue-700" onClick={() => setExcludedIds(new Set())}>Show all</button>
                </div>
                <div className="max-h-80 overflow-auto py-1">
                  {filterProperties.map((property) => {
                    const excluded = excludedIds.has(property.id)
                    return (
                      <label key={property.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!excluded}
                          onChange={() => setExcludedIds((current) => {
                            const next = new Set(current)
                            if (next.has(property.id)) next.delete(property.id)
                            else next.add(property.id)
                            return next
                          })}
                        />
                        <span>
                          <span className="block font-medium text-slate-950">{property.address || `Property ${property.id}`}</span>
                          <span className="block text-xs text-slate-500">{property.city}, {property.state}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <HeroCover dashboard={dashboard} />
        <ChangeStrip dashboard={dashboard} />

        <section className="space-y-5">
          <EditorialHeader eyebrow="Investment stories" title="The five questions every investor should ask" subtitle="Each chapter is built from backend-generated narratives, chart DTOs, recommendations, and metrics." />
          <div className="space-y-5">
            {(dashboard.stories || []).map((story) => <StoryChapter key={story.key} story={story} />)}
          </div>
        </section>

        <section className="space-y-5">
          <EditorialHeader eyebrow="Property leaders" title="Which properties are leading, and which are dragging?" subtitle="Backend property health rows provide the supporting evidence." />
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <DataTable columns={healthColumns} rows={dashboard.propertyHealth || []} getRowKey={(row) => row.id || row.property} emptyMessage="No rental properties in scope." />
          </div>
        </section>

        <PortfolioCoach dashboard={dashboard} />

        <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-950">
            <Home className="h-4 w-4 text-amber-500" />
            {dashboard.primaryResidence?.title || 'Primary Residence'}
          </summary>
          <p className="mt-2 text-sm text-slate-500">{dashboard.primaryResidence?.description}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(dashboard.primaryResidence?.metrics || []).map((metric) => <MetricEvidence key={metric.key} metric={metric} />)}
          </div>
        </details>

        <section className="space-y-4">
          <EditorialHeader eyebrow="Data quality" title="Can I trust the report?" subtitle="Backend validation status for dashboard metrics." />
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              {dashboard.dataQuality?.status === 'Complete' ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-amber-500" />}
              <p className="font-semibold text-slate-950">{dashboard.dataQuality?.status || '—'}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(dashboard.dataQuality?.checks || []).map((metric) => <MetricEvidence key={metric.key} metric={metric} />)}
            </div>
          </div>
        </section>
      </div>
    </DashboardShell>
  )
}
