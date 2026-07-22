import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  ChevronDown,
  Check,
  CircleDollarSign,
  Download,
  Gauge,
  Home,
  Landmark,
  Percent,
  ReceiptText,
  Scale,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import InfoTooltip from '../components/InfoTooltip'
import { propAPI } from '../services/api'
import { formatCurrency, formatCurrencyCompact, formatPercent, formatRatio } from '../utils/formatters'
import { chartColorRamps, chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'

// Softer positive/negative fills for dashboard charts (lighter than the default
// dark green/red so they read well on both light and dark cards).
const POS = '#34d399' // emerald-400 — equity / positive
const DEBT = chartColors.mutedAxis // slate — liabilities (neutral, not alarming)

const ICONS = {
  home: Home,
  equity: Landmark,
  cashFlow: CircleDollarSign,
  percent: Percent,
  analytics: BarChart3,
  ratio: Scale,
  properties: Building2,
  occupancy: Gauge,
  income: CircleDollarSign,
  expenses: ReceiptText,
  noi: TrendingUp,
}

// Cohesive, restrained palette: a cool jewel-tone sweep (indigo → violet → sky
// → teal → emerald) with a single warm amber accent, all at one weight with
// soft tinted chips in dark mode. Aligns with the Value Buildup waterfall.
const TONES = {
  blue: { icon: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300', stroke: chartColors.primary },
  green: { icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300', stroke: POS },
  teal: { icon: 'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300', stroke: chartColors.cyan },
  orange: { icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300', stroke: chartColors.warning },
  purple: { icon: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300', stroke: chartColors.purple },
  cyan: { icon: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300', stroke: chartColors.primarySoft },
}

function metricDisplay(metric) {
  if (!metric || metric.value === null || metric.value === undefined) return '—'
  if (metric.unit === 'percent' || metric.unit === 'rate') return formatPercent(metric.value)
  if (metric.unit === 'ratio') return formatRatio(metric.value)
  if (metric.unit === 'count') return String(metric.value)
  return formatCurrencyCompact(metric.value, { threshold: 100_000, kDigits: 1, mDigits: 2 })
}

function metricFullDisplay(metric) {
  if (!metric || metric.value === null || metric.value === undefined) return '—'
  if (metric.unit === 'percent' || metric.unit === 'rate') return formatPercent(metric.value)
  if (metric.unit === 'ratio') return formatRatio(metric.value)
  if (metric.unit === 'count') return String(metric.value)
  return formatCurrency(metric.value)
}

function DashboardCard({ children, className = '' }) {
  return <section className={`rounded-xl border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</section>
}

function KpiCard({ config, metric, trendSeries }) {
  const Icon = ICONS[config.icon] || BarChart3
  const tone = TONES[config.tone] || TONES.blue
  return (
    <DashboardCard className="min-h-28 overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone.icon}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase text-gray-500">{config.label}</p>
          <p className={`mt-1 truncate text-xl font-bold ${metric?.value < 0 ? 'text-rose-500 dark:text-rose-400' : config.tone === 'green' || config.tone === 'teal' ? 'text-emerald-500 dark:text-emerald-400' : 'text-gray-950'}`}>{metricDisplay(metric)}</p>
          <p className="mt-1 text-xs text-gray-500">{metric?.period || metric?.status || 'Current selection'}</p>
        </div>
      </div>
      {config.seriesKey && trendSeries?.length > 1 ? (
        <div className="mt-2 h-7 border-t border-gray-100 pt-1" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendSeries}><Line type="monotone" dataKey={config.seriesKey} stroke={tone.stroke} strokeWidth={2} dot={false} /></LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </DashboardCard>
  )
}

function PortfolioFilters({ context, scope, setScope, selectedIds, setSelectedIds, reportHref }) {
  const [open, setOpen] = useState(false)
  const available = context?.availableProperties || []

  const toggleProperty = (id) => {
    setScope('custom')
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = () => { setScope('all'); setSelectedIds(new Set()) }
  const selectRentals = () => { setScope('rentals'); setSelectedIds(new Set()) }
  const clearSelection = () => { setScope('all'); setSelectedIds(new Set()) }

  const firstName = available.find((property) => selectedIds.has(property.id))?.name
  const label =
    scope === 'all' ? `All properties (${available.length})`
      : scope === 'rentals' ? 'Rentals only'
        : selectedIds.size === 0 ? 'Select properties'
          : selectedIds.size === 1 ? (firstName || '1 property')
            : `${selectedIds.size} properties selected`

  const quickOptions = [
    { key: 'all', label: 'All properties', hint: String(available.length), onSelect: selectAll },
    { key: 'rentals', label: 'Rentals only', hint: '', onSelect: selectRentals },
  ]

  return (
    <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="input flex h-10 min-w-[13rem] items-center justify-between gap-2 text-left text-sm"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open ? (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900" role="listbox" aria-label="Select properties">
              <div className="p-1.5">
                {quickOptions.map((option) => {
                  const active = scope === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={option.onSelect}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${active ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                    >
                      <span>{option.label}</span>
                      <span className="flex items-center gap-2">
                        {option.hint ? <span className="text-xs text-gray-400">{option.hint}</span> : null}
                        {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Or pick individually</span>
                {scope === 'custom' && selectedIds.size > 0 ? (
                  <button type="button" onClick={clearSelection} className="text-xs font-medium text-blue-600 hover:underline">Clear</button>
                ) : null}
              </div>
              <div className="max-h-56 overflow-y-auto px-1.5 pb-1.5">
                {available.length ? available.map((property) => {
                  const checked = scope === 'custom' && selectedIds.has(property.id)
                  return (
                    <label key={property.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                      <input type="checkbox" checked={checked} onChange={() => toggleProperty(property.id)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{property.name || property.address}</span>
                    </label>
                  )
                }) : <p className="px-3 py-4 text-center text-xs text-gray-400">No properties available</p>}
              </div>
              <div className="border-t border-gray-100 p-2 dark:border-gray-800">
                <button type="button" onClick={() => setOpen(false)} className="btn-primary h-9 w-full text-sm">Done</button>
              </div>
            </div>
          </>
        ) : null}
      </div>
      <Link to={reportHref} className="btn-secondary inline-flex h-10 items-center justify-center gap-2 text-sm"><Download className="h-4 w-4" aria-hidden="true" />Export Report</Link>
    </div>
  )
}

function SummaryPanel({ section, resolveMetric, kind }) {
  const total = resolveMetric('analytics', section.totalMetricKey)
  return (
    <DashboardCard className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{section.title}</h2>
        <span className="text-base font-bold text-gray-950">{kind === 'assets' ? metricDisplay(resolveMetric('analytics', 'portfolioValue')) : metricDisplay(resolveMetric('loans', 'totalBalance'))}</span>
      </div>
      <dl className="px-4">
        {(section.rows || []).map((row) => {
          const metric = resolveMetric(row.metricSource || (kind === 'assets' ? 'dashboard' : 'analytics'), row.metricKey)
          return <div key={row.label} className="flex items-center justify-between gap-3 border-t border-gray-100 py-3 first:border-t-0"><dt className="text-sm text-gray-600">{row.label}</dt><dd className={`text-right text-sm font-semibold ${row.tone === 'positive' ? 'text-emerald-500 dark:text-emerald-400' : 'text-gray-900'}`}>{metricFullDisplay(metric)}</dd></div>
        })}
      </dl>
      <div className={`flex items-center justify-between px-4 py-3 text-sm font-bold ${kind === 'assets' ? 'bg-green-50 text-emerald-500 dark:text-emerald-400' : 'bg-red-50 text-rose-500 dark:text-rose-400'}`}>
        <span>{kind === 'assets' ? 'Total Equity' : 'Debt to Value (LTV)'}</span><span>{metricDisplay(total)}</span>
      </div>
    </DashboardCard>
  )
}

function PortfolioHealth({ data }) {
  return (
    <DashboardCard className="p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title}</h2>
      <div className="mt-4 flex items-center gap-4">
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${POS} ${data.score || 0}%, ${chartColors.trackLight} ${data.score || 0}%)` }}>
          <div className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-white text-center"><div><p className="text-2xl font-bold text-gray-950">{data.scoreDisplay}</p><p className="text-[10px] font-semibold uppercase text-emerald-500 dark:text-emerald-400">{data.status}</p></div></div>
        </div>
        <ul className="min-w-0 flex-1 space-y-2">
          {(data.checks || []).map((check) => <li key={check.key} className="flex items-start gap-2 text-xs text-gray-600"><Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${check.passes ? 'text-emerald-500 dark:text-emerald-400' : 'text-amber-600'}`} aria-hidden="true" />{check.label}</li>)}
        </ul>
      </div>
      <Link to={data.href || '/analytics'} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">View Full Health Check <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </DashboardCard>
  )
}

function waterfallSignedValue(step) {
  const value = Number(step?.value || 0)
  if (step?.type === 'decrease') return -Math.abs(value)
  return value
}

function CashFlowWaterfall({ data }) {
  const steps = data.steps || []
  const maxAmount = Math.max(...steps.map((step) => Math.abs(waterfallSignedValue(step))), 1)

  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Cash flow (Monthly)</h2>
          <p className="mt-1 text-xs text-gray-500">{data.subtitle}</p>
        </div>
        <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">Monthly</span>
      </div>
      <div className="mt-4">
        {/* Chart holds only the bars + value labels; category labels live in
            their own row below so they never overlap the values. */}
        <div className="relative h-56 rounded-lg border border-gray-100 bg-gray-50 px-3 pb-2 pt-5">
          <div className="absolute left-3 right-3 top-1/2 h-px bg-gray-300" aria-hidden="true" />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-500">0</div>
          <div className="grid h-full items-stretch gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, 1)}, minmax(3.5rem, 1fr))` }}>
            {steps.map((step) => {
              const signedValue = waterfallSignedValue(step)
              const isNegative = signedValue < 0
              const heightPercent = Math.max(3, (Math.abs(signedValue) / maxAmount) * 44)
              const barTop = isNegative ? 50 : 50 - heightPercent
              const valueTop = isNegative ? 50 + heightPercent + 2 : Math.max(1, 50 - heightPercent - 9)
              const toneClass = step.type === 'total' ? 'bg-blue-600' : isNegative ? 'bg-rose-400' : 'bg-emerald-400'
              const valueColor = step.type === 'total' ? 'text-blue-700' : isNegative ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'
              return (
                <div key={step.key} className="relative min-w-0">
                  <p className={`absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold tabular-nums ${valueColor}`} style={{ top: `${valueTop}%` }}>
                    {formatCurrencyCompact(signedValue)}
                  </p>
                  <div
                    className={`absolute left-1/2 w-3/5 -translate-x-1/2 rounded-sm ${toneClass}`}
                    style={{ top: `${barTop}%`, height: `${heightPercent}%` }}
                    title={`${step.label}: ${formatCurrency(signedValue)}`}
                  />
                </div>
              )
            })}
          </div>
        </div>
        <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, 1)}, minmax(3.5rem, 1fr))` }}>
          {steps.map((step) => (
            <p key={step.key} className="px-0.5 text-center text-[11px] leading-tight text-gray-600">{step.label}</p>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Positive cash flow</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" />Negative cash flow</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />Net result</span>
        </div>
      </div>
      <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-5">
        {(data.reconciliation || []).map((item) => <div key={item.label} className="bg-white px-3 py-3"><p className="text-xs text-gray-500">{item.label}</p><p className={`mt-1 text-sm font-bold ${item.tone === 'negative' ? 'text-rose-500 dark:text-rose-400' : item.tone === 'positive' ? 'text-emerald-500 dark:text-emerald-400' : 'text-gray-900'}`}>{formatCurrency(item.value)}</p></div>)}
      </div>
      <Link to="/analytics?tab=cash-flow" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">View Cash Flow Analysis <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </DashboardCard>
  )
}

// Same palette + geometry as the primary Home Summary "Value Buildup Over Time"
// chart, so the portfolio version renders pixel-for-pixel identically.
const waterfallStoryTone = {
  acquisition_cash: chartColors.primarySoft,
  principal_reduction: chartColors.warningStrong,
  remaining_secured_debt: chartColors.mutedAxis,
  appreciation: chartColors.positiveSoft,
  total: chartColors.purple,
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

function ValueBuildupWaterfall({ data }) {
  const available = data?.status === 'available'
  const nodes = available ? (data.series || []) : []
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

  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title || 'Value Buildup Over Time'}</h2>
          <p className="mt-1 text-xs text-gray-500">{data.subtitle}</p>
        </div>
        <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">All Time</span>
      </div>
      {available ? (
        <div className="mt-4 overflow-x-auto">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="mx-auto min-w-[680px]" role="img" aria-label={data.title}>
            {ticks.map((tick) => <g key={tick}><line x1={left - 6} x2={chartWidth - right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-gray-100 dark:text-gray-800" /><text x={0} y={y(tick) + 4} className="fill-gray-500 text-[11px] dark:fill-gray-400">{formatCurrencyCompact(tick)}</text></g>)}
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
              return (
                <g key={node.id || node.key}>
                  <title>{`${node.label}\nAmount: ${node.fullDisplay || node.display}\n${isTotal ? 'Current market value' : `Cumulative value after this step: ${node.tooltip?.cumulativeValue || node.fullDisplay || node.display}`}`}</title>
                  <rect x={x} y={topY} width={isTotal ? barWidth + 8 : barWidth} height={Math.max(5, bottomY - topY)} rx="3" fill={waterfallStoryTone[node.semanticType] || waterfallStoryTone[node.tone] || waterfallStoryTone.total} />
                  <text x={x + (isTotal ? barWidth + 8 : barWidth) / 2} y={topY - 8} textAnchor="middle" className="fill-gray-900 text-[11px] font-semibold dark:fill-white">{formatWaterfallBarLabel(node.display)}</text>
                  {labelLines.map((line, lineIndex) => <text key={line} x={x + (isTotal ? barWidth + 8 : barWidth) / 2} y={chartHeight - 70 + lineIndex * 12} textAnchor="middle" className="fill-gray-500 text-[11px] dark:fill-gray-400">{line}</text>)}
                  {next && !nextIsTotal ? <line x1={x + (isTotal ? barWidth + 8 : barWidth)} x2={barX(index + 1)} y1={connectorY} y2={connectorY} stroke="currentColor" className="text-gray-300 dark:text-gray-600" strokeDasharray="3 3" /> : null}
                </g>
              )
            })}
            {(data.annotations || []).map((annotation) => {
              const start = nodeById[annotation.startBarId]
              const end = nodeById[annotation.endBarId]
              if (!start || !end) return null
              const x1 = barCenter(start.index)
              const x2 = barCenter(end.index)
              const yBase = chartHeight - 30
              const colorClass = annotation.semanticType === 'appreciation' ? 'fill-emerald-600 text-emerald-500' : 'fill-gray-500 text-gray-400'
              return (
                <g key={`${annotation.startBarId}-${annotation.endBarId}`}>
                  <path d={`M ${x1} ${yBase - 14} V ${yBase - 4} H ${x2} V ${yBase - 14}`} fill="none" stroke="currentColor" className={annotation.semanticType === 'appreciation' ? 'text-emerald-500' : 'text-gray-400'} strokeWidth="1" />
                  <text x={(x1 + x2) / 2} y={yBase + 12} textAnchor="middle" className={`${colorClass} text-[11px]`}>{annotation.label}</text>
                </g>
              )
            })}
          </svg>
        </div>
      ) : (
        <div className="mt-4 grid h-56 place-items-center rounded-lg border border-gray-100 bg-gray-50 px-6 text-center text-sm text-gray-500">
          {data.unavailableReason || 'Add purchase prices and market values to see how portfolio value was built.'}
        </div>
      )}
    </DashboardCard>
  )
}

function CapitalStructure({ data }) {
  const equity = data.segments?.find((item) => item.key === 'equity')
  return (
    <DashboardCard className="p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title}</h2>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${POS} ${equity?.percentage || 0}%, ${DEBT} ${equity?.percentage || 0}%)` }}>
          <div className="grid h-14 w-14 place-items-center rounded-full bg-white text-center"><div><p className="text-sm font-bold text-gray-950">{formatCurrencyCompact(data.totalValue)}</p><p className="text-[10px] text-gray-500">Total</p></div></div>
        </div>
        <dl className="w-full space-y-2.5">{(data.segments || []).map((item) => <div key={item.key} className="flex items-center justify-between gap-2 text-xs"><dt className="flex min-w-0 items-center gap-2 text-gray-600"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === 'positive' ? 'bg-emerald-400' : 'bg-slate-400'}`} /><span className="truncate">{item.label}</span></dt><dd className="whitespace-nowrap text-right font-semibold text-gray-900">{formatPercent(item.percentage)} · {formatCurrencyCompact(item.value)}</dd></div>)}</dl>
      </div>
    </DashboardCard>
  )
}

function CashFlowTrend({ data }) {
  const series = data.series || []
  return (
    <DashboardCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title}</h2><span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">{data.period || 'Monthly'}</span></div>
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-gray-500"><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-400" />Net Cash Flow</span><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-blue-600" />Debt Service</span></div>
      <div className="mt-3 h-52">{series.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{ left: -16, right: 8, top: 8 }}><CartesianGrid stroke={chartColors.gridLight} vertical={false} /><XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} /><YAxis tickFormatter={formatCurrencyCompact} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} /><Line type="monotone" dataKey="cashFlow" name="Net Cash Flow" stroke={POS} strokeWidth={2} dot={{ r: 3 }} /><Line type="monotone" dataKey="debtService" name="Debt Service" stroke={chartColors.primary} strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer> : <EmptyState label="Cash-flow history unavailable" />}</div>
      <Link to="/analytics?tab=cash-flow" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">View Cash Flow Analysis <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </DashboardCard>
  )
}

function ExpenseBreakdown({ data }) {
  const colors = chartColorRamps.blue.concat(chartColorRamps.amber)
  return (
    <DashboardCard className="p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title}</h2>
      <div className="mt-3 grid min-h-52 grid-cols-[8rem_1fr] items-center gap-3">
        <div className="relative h-32 w-32">{data.items?.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.items} dataKey="value" nameKey="label" innerRadius={38} outerRadius={58}>{data.items.map((item, index) => <Cell key={item.key} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} /></PieChart></ResponsiveContainer> : null}<div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-sm font-bold text-gray-950">{formatCurrencyCompact(data.total)}</p><p className="text-xs text-gray-500">Total</p></div></div></div>
        <ul className="space-y-2">{(data.items || []).map((item, index) => <li key={item.key} className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 text-gray-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} /><span className="truncate">{item.label}</span></span><span className="font-semibold text-gray-900">{formatPercent(item.percentage)}</span></li>)}</ul>
      </div>
      <Link to="/income-expenses" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">View Expense Details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </DashboardCard>
  )
}

function PropertyPerformance({ data }) {
  return (
    <DashboardCard className="p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title}</h2>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-gray-200 text-xs text-gray-500"><th className="py-2 text-left font-semibold">Property</th><th className="py-2 text-right font-semibold">Cash Flow</th><th className="py-2 text-right font-semibold">CoC Return</th></tr></thead><tbody>{(data.rows || []).map((row) => <tr key={row.id} className="border-b border-gray-100 last:border-0"><td className="max-w-36 truncate py-2 font-medium text-gray-900">{row.label}</td><td className={`py-2 text-right font-semibold ${row.cashFlow < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}`}>{formatCurrency(row.cashFlow)}</td><td className={`py-2 text-right font-semibold ${row.cashOnCash !== null && row.cashOnCash < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400'}`}>{row.cashOnCash === null ? '—' : formatPercent(row.cashOnCash)}</td></tr>)}</tbody></table></div>
      <Link to="/properties" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">View All Properties <ArrowRight className="h-3.5 w-3.5" /></Link>
    </DashboardCard>
  )
}

function AlertsPanel({ data }) {
  return (
    <DashboardCard className="p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{data.title}</h2>
      <div className="mt-3 divide-y divide-gray-100">{data.items?.length ? data.items.map((item) => <div key={item.key} className="flex items-start gap-3 py-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${item.severity === 'WARNING' || item.severity === 'IMPORTANT' ? 'bg-red-50 text-rose-500 dark:text-rose-400' : 'bg-blue-50 text-blue-600'}`}><AlertTriangle className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-gray-900">{item.title}</p><p className="mt-1 text-xs leading-5 text-gray-500">{item.message}</p></div><Link to={item.href} className="text-xs font-semibold text-blue-600">{item.actionLabel}</Link></div>) : <EmptyState label="No high-priority alerts" />}</div>
      <Link to="/analytics" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600">View All Alerts <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
    </DashboardCard>
  )
}

function BottomStrip({ items, resolveMetric }) {
  return <section className="grid gap-px overflow-visible rounded-xl border border-gray-200 bg-gray-200 shadow-sm sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Portfolio operating metrics">{items.map((item) => { const Icon = ICONS[item.icon] || ShieldCheck; const metric = resolveMetric(item.metricSource || (item.scope === 'rental' && ['income', 'noi'].includes(item.metricKey) ? 'income' : item.metricKey === 'occupancy' ? 'analytics' : 'dashboard'), item.metricKey); return <div key={item.label} className="flex min-h-20 items-center gap-3 bg-white px-4 py-3"><Icon className="h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><p className="text-xs font-semibold uppercase text-gray-500">{item.label}</p><InfoTooltip metric={metric} label={item.label} /></div><p className="mt-1 text-base font-bold text-gray-950">{metricDisplay(metric)}</p><p className="mt-1 truncate text-xs text-gray-500">{item.detail}</p></div></div>})}</section>
}

function EmptyState({ label }) {
  return <div className="grid h-full min-h-24 place-items-center text-center text-sm text-gray-500">{label}</div>
}

export default function DashboardPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('all')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [startDate, setStartDate] = useState(`${today.slice(0, 4)}-01-01`)
  const [endDate, setEndDate] = useState(today)

  const selectedKey = useMemo(() => Array.from(selectedIds).sort((a, b) => a - b).join(','), [selectedIds])
  const reportHref = useMemo(() => {
    const params = new URLSearchParams({
      selected_property_ids: scope === 'custom' ? selectedKey : '',
      selection_explicit: String(scope === 'custom'),
      include_primary_residence: String(scope !== 'rentals'),
      start_date: startDate,
      end_date: endDate,
    })
    return `/reports?${params.toString()}`
  }, [scope, selectedKey, startDate, endDate])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const request = {
      selected_property_ids: scope === 'custom' ? selectedKey : '',
      selection_explicit: scope === 'custom',
      include_primary_residence: scope !== 'rentals',
      start_date: startDate || undefined,
      end_date: endDate || undefined,
    }
    setLoading(true)
    propAPI.portfolioAnalysis(request, { signal: controller.signal })
      .then((response) => {
        if (active) setData(response.data)
      })
      .catch((error) => {
        if (active && error?.code !== 'ERR_CANCELED') toast.error('Failed to load portfolio dashboard')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [scope, selectedKey, startDate, endDate])

  const analytics = data?.analytics
  const dashboard = analytics?.dashboard
  const dashboardMetrics = analytics?.dashboardMetrics || {}
  const resolveMetric = (source, key) => {
    if (source === 'loans') return data?.loans?.kpis?.[key]
    if (source === 'income') return data?.incomeExpenses?.kpis?.[key]
    if (source === 'dashboard') return dashboardMetrics[key]
    return analytics?.kpis?.[key]
  }

  if (loading && !data) return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div></PageContainer>
  if (!dashboard) return <PageContainer><DashboardCard className="p-10 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-amber-500" /><h1 className="mt-3 text-lg font-semibold text-gray-900">Portfolio dashboard unavailable</h1><p className="mt-1 text-sm text-gray-500">The backend did not return a dashboard presentation.</p></DashboardCard></PageContainer>

  return (
    <PageContainer className="max-w-[112rem]">
      <div className="space-y-4" data-testid="portfolio-dashboard">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div><h1 className="text-2xl font-bold text-gray-950">{dashboard.header.title}</h1><p className="mt-1 text-sm text-gray-500">{dashboard.header.subtitle}</p></div>
          <PortfolioFilters context={data.filterContext} scope={scope} setScope={setScope} selectedIds={selectedIds} setSelectedIds={setSelectedIds} reportHref={reportHref} />
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Portfolio metrics">{dashboard.topMetrics.map((config) => <KpiCard key={config.metricKey} config={config} metric={resolveMetric('analytics', config.metricKey)} trendSeries={dashboard.cashFlowTrend.series} />)}</section>

        <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2.2fr)_minmax(0,0.9fr)]">
          <div className="space-y-4"><SummaryPanel section={dashboard.assets} resolveMetric={resolveMetric} kind="assets" /><PortfolioHealth data={dashboard.health} /></div>
          {dashboard.valueBuildup ? (
            <ValueBuildupWaterfall data={dashboard.valueBuildup} />
          ) : (
            <CashFlowWaterfall data={dashboard.cashFlowWaterfall} />
          )}
          <div className="space-y-4"><SummaryPanel section={dashboard.liabilities} resolveMetric={resolveMetric} kind="liabilities" /><CapitalStructure data={dashboard.capitalStructure} /></div>
        </section>

        <BottomStrip items={dashboard.bottomMetrics} resolveMetric={resolveMetric} />

        <section className="grid items-stretch gap-4 md:grid-cols-2 2xl:grid-cols-4"><CashFlowTrend data={dashboard.cashFlowTrend} /><ExpenseBreakdown data={dashboard.expenseBreakdown} /><PropertyPerformance data={dashboard.propertyPerformance} /><AlertsPanel data={dashboard.alerts} /></section>
      </div>
    </PageContainer>
  )
}
