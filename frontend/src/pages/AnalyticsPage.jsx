import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { formatCurrency, formatCompactMoney, formatPlainPercent, formatFixed } from '../utils/formatters'
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  FileDown,
  Home,
  Landmark,
  LineChart as LineChartIcon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'

const ANALYTICS_TABS = [
  { id: 'overview', label: 'Overview', icon: CheckCircle2 },
  { id: 'cashflow', label: 'Cash Flow', icon: WalletCards },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'equity', label: 'Equity', icon: TrendingUp },
  { id: 'loans', label: 'Loans', icon: Landmark },
  { id: 'forecast', label: 'Forecast', icon: LineChartIcon },
  { id: 'scenarios', label: 'Scenario Analysis', icon: Target },
]

const EXPENSE_COLORS = {
  propertyTax: chartColors.primary,
  insurance: chartColors.positive,
  maintenance: chartColors.warningSoft,
  management: chartColors.danger,
  utilities: chartColors.purple,
  other: chartColors.neutral,
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// Thin wrappers over the shared formatter module (identical output) so the
// direct number-formatting lives in the allowed formatter file.
const compactMoney = (value) => formatCompactMoney(numberValue(value))
const fullMoney = (value) => formatCurrency(numberValue(value))
const percent = (value, digits = 2) => formatPlainPercent(numberValue(value), digits)

function propertyName(row) {
  // propertyPerformance rows carry the name in `label`; others use `name`.
  return row?.name || row?.label || row?.address || `Property ${row?.id || ''}`.trim()
}

function analyticsModel(data) {
  const analytics = data?.analytics || {}
  const kpis = analytics.kpis || {}
  const incomeKpis = data?.incomeExpenses?.kpis || {}
  const loanKpis = data?.loans?.kpis || {}
  return {
    portfolioValue: kpis.portfolioValue?.value,
    totalEquity: kpis.totalEquity?.value,
    monthlyCashFlow: kpis.monthlyCashFlow?.value,
    annualNoi: kpis.annualNoi?.value,
    capRate: kpis.capRate?.value,
    cashOnCash: kpis.cashOnCash?.value,
    dscr: kpis.dscr?.value,
    grossRent: incomeKpis.income?.value,
    operatingExpenses: incomeKpis.operatingExpenses?.value,
    debtService: incomeKpis.debtService?.value,
    noiMonthly: incomeKpis.noi?.value,
    netCash: incomeKpis.cashFlow?.value,
    expenseBreakdown: analytics.expenseBreakdown || [],
    trendRows: analytics.cashFlowSeries || [],
    propertyRows: analytics.propertyPerformance || [],
    performanceSummary: analytics.performanceSummary || [],
    totalDebt: loanKpis.totalBalance?.value,
    occupancy: kpis.occupancy?.value,
    principalPaid: kpis.principalPaid?.value,
    interestPaid: kpis.interestPaid?.value,
    waterfall: analytics.cashFlowWaterfall?.steps || [],
    equitySeries: analytics.equitySeries || [],
    occupancySeries: analytics.occupancySeries || [],
    matrixQuadrants: analytics.performanceMatrix?.quadrants || { x: 0, y: 5 },
    insights: analytics.insights || [],
    forecast: analytics.forecast || {},
    scenario: analytics.scenario || {},
    asOfDate: data?.asOfDate,
  }
}

function KpiCard({ icon: Icon, label, value, delta, tone = 'green' }) {
  const toneClass = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  }[tone] || 'bg-gray-50 text-gray-700 ring-gray-100'
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ${toneClass}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{value}</p>
          <p className={`mt-2 text-xs font-medium ${String(delta || '').startsWith('-') ? 'text-red-600' : 'text-emerald-600'}`}>
            {delta || 'Current period'}
          </p>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function CashFlowWaterfall({ model }) {
  const rows = model.waterfall
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1)
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key} className={`grid grid-cols-[8.5rem_1fr_5.5rem] items-center gap-3 text-xs ${row.type === 'total' ? 'border-t border-gray-100 pt-3 font-semibold dark:border-neutral-800' : ''}`}>
          <span className="text-gray-600 dark:text-neutral-300">{row.label}</span>
          <div className="relative h-4 rounded bg-gray-100 dark:bg-neutral-800">
            <div
              className={`absolute top-0 h-4 rounded ${row.value >= 0 ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-red-500'}`}
              style={{ width: `${Math.max(4, Math.abs(row.value) / max * 50)}%` }}
            />
            <span className="absolute left-1/2 top-0 h-4 border-l border-gray-300 dark:border-neutral-600" />
          </div>
          <span className={`text-right font-semibold ${row.value >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{fullMoney(row.value)}</span>
        </div>
      ))}
    </div>
  )
}

function CashFlowByProperty({ rows }) {
  const max = Math.max(...rows.map((row) => Math.abs(row.cashFlow)), 1)
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id || row.label} className="grid grid-cols-[9rem_5rem_1fr_4rem] items-center gap-3 text-xs">
          <span className="truncate font-medium text-gray-700 dark:text-neutral-200" title={propertyName(row)}>{row.label}</span>
          <span className={`text-right font-semibold ${row.cashFlow >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-600 dark:text-red-300'}`}>{compactMoney(row.cashFlow)}</span>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-neutral-800">
            <div className={`h-2 rounded-full ${row.cashFlow >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.max(4, Math.abs(row.cashFlow) / max * 100)}%` }} />
          </div>
          <span className={`text-right ${row.cashOnCash == null || row.cashOnCash >= 0 ? 'text-gray-500 dark:text-neutral-400' : 'text-red-600 dark:text-red-300'}`}>{row.cashOnCash == null ? 'N/A' : percent(row.cashOnCash, 1)}</span>
        </div>
      ))}
    </div>
  )
}

function PerformanceSummary({ model }) {
  const rows = model.performanceSummary
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_6rem_5.5rem] items-center gap-3 border-b border-gray-100 py-2 text-xs last:border-0 dark:border-neutral-800">
          <span className="font-medium text-gray-700 dark:text-neutral-200">{row.label}</span>
          <span className="text-right font-semibold text-gray-950 dark:text-white">{compactMoney(row.value)}</span>
          <span className="text-right text-gray-500 dark:text-neutral-500">{row.note}</span>
        </div>
      ))}
    </div>
  )
}

function CashFlowTrend({ data }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} tickFormatter={compactMoney} />
          <Tooltip formatter={(value) => fullMoney(value)} contentStyle={chartTooltipStyle(false)} />
          <Line type="monotone" dataKey="cashFlow" name="Cash Flow" stroke={chartColors.positive} strokeWidth={2.5} dot={{ r: 3 }} />
          <ReferenceLine y={0} stroke={chartColors.neutralLight} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function OccupancyTrend({ model }) {
  const rows = model.occupancySeries
  if (!rows.length) return <EmptyState label="Historical occupancy is unavailable for the selected scope." />
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="occupancyFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.26} />
              <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={40} tickFormatter={(value) => `${value}%`} />
          <Tooltip formatter={(value) => percent(value, 1)} contentStyle={chartTooltipStyle(false)} />
          <Area type="monotone" dataKey="occupancy" name="Occupancy" stroke={chartColors.primary} strokeWidth={2.5} fill="url(#occupancyFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ExpenseBreakdown({ rows }) {
  if (!rows.length) return <EmptyState label="No operating expense data available." />
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800">
        {rows.map((row) => (
          <span key={row.key} style={{ width: `${row.percentage}%`, backgroundColor: EXPENSE_COLORS[row.key] || chartColors.neutral }} title={`${row.label}: ${fullMoney(row.value)}`} />
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[0.75rem_1fr_5.5rem_3.5rem] items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: EXPENSE_COLORS[row.key] || chartColors.neutral }} />
            <span className="text-gray-600 dark:text-neutral-300">{row.label}</span>
            <span className="text-right font-semibold text-gray-950 dark:text-white">{compactMoney(row.value)}</span>
            <span className="text-right text-gray-500 dark:text-neutral-500">{percent(row.percentage, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceMatrix({ rows, quadrants }) {
  const data = rows.filter((row) => row.x != null && row.y != null)
  if (!data.length) return <EmptyState label="Cash-on-cash inputs are unavailable for this scope." />
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ left: 0, right: 16, top: 10, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.gridLight} />
          <XAxis type="number" dataKey="x" name="Monthly Cash Flow" tick={chartTypography.smallMutedTick} tickFormatter={compactMoney} axisLine={false} tickLine={false} />
          <YAxis type="number" dataKey="y" name="Cash on Cash" tick={chartTypography.smallMutedTick} tickFormatter={(value) => `${value}%`} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value, name) => (name === 'Monthly Cash Flow' ? fullMoney(value) : percent(value, 1))} labelFormatter={(_, payload) => payload?.[0]?.payload?.label || 'Property'} contentStyle={chartTooltipStyle(false)} />
          <ReferenceLine x={quadrants.x} stroke={chartColors.neutralLight} />
          <ReferenceLine y={quadrants.y} stroke={chartColors.neutralLight} />
          <Scatter data={data} name="Properties">
            {data.map((row) => <Cell key={row.id || row.label} fill={row.x < quadrants.x ? chartColors.danger : row.y >= quadrants.y ? chartColors.positive : chartColors.primary} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

function EquityGrowth({ model }) {
  const rows = model.equitySeries
  if (rows.length < 2) return <EmptyState label="Historical valuation snapshots are unavailable; only the current equity snapshot is stored." />
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} tickFormatter={compactMoney} />
          <Tooltip formatter={(value) => fullMoney(value)} contentStyle={chartTooltipStyle(false)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="marketValue" name="Market Value" fill={chartColors.positiveTint} stroke={chartColors.positive} />
          <Line type="monotone" dataKey="loanBalance" name="Loan Balance" stroke={chartColors.danger} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="equity" name="Equity" stroke={chartColors.primary} strokeWidth={2.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function TopPerformers({ rows }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <Link key={row.id || row.label} to={row.id ? `/properties/${row.id}` : '/properties'} className="grid grid-cols-[1.5rem_1fr_4.5rem_5rem] items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-gray-50 dark:hover:bg-neutral-800">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${index < 3 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{index + 1}</span>
          <span className="truncate font-medium text-gray-800 dark:text-neutral-100">{propertyName(row)}</span>
          <span className={row.cashOnCash == null || row.cashOnCash >= 0 ? 'text-right text-emerald-700 dark:text-emerald-300' : 'text-right text-red-600 dark:text-red-300'}>{row.cashOnCash == null ? 'N/A' : percent(row.cashOnCash, 1)}</span>
          <span className={row.cashFlow >= 0 ? 'text-right font-semibold text-emerald-700 dark:text-emerald-300' : 'text-right font-semibold text-red-600 dark:text-red-300'}>{compactMoney(row.cashFlow)}</span>
        </Link>
      ))}
    </div>
  )
}

function ControlsPanel({ filterProperties, selectedIds, setSelectedIds, includePrimary, setIncludePrimary }) {
  const allSelected = filterProperties.length > 0 && selectedIds.size === filterProperties.length
  const toggle = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <Panel title="Analysis Controls">
      <div className="space-y-5">
        <div>
          <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200">Property Selection</label>
          <button type="button" className="mt-2 flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-neutral-700">
            <span>{allSelected ? `All Properties (${filterProperties.length})` : `${selectedIds.size} selected`}</span>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </button>
        </div>
        <div className="max-h-64 space-y-2 overflow-auto pr-1">
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelectedIds(allSelected ? new Set() : new Set(filterProperties.map((row) => row.id)))}
              className="rounded border-gray-300 text-blue-600"
            />
            Select All
          </label>
          {filterProperties.map((row) => (
            <label key={row.id} className="flex items-start gap-2 text-xs text-gray-600 dark:text-neutral-300">
              <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggle(row.id)} className="mt-0.5 rounded border-gray-300 text-blue-600" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{row.address || row.name || `Property ${row.id}`}</span>
                <span className="block text-gray-400">{row.usageType || 'Rental'}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-4 dark:border-neutral-800">
          <span className="text-xs font-medium text-gray-700 dark:text-neutral-200">Include Primary Residence</span>
          <button
            type="button"
            onClick={() => setIncludePrimary((value) => !value)}
            className={`flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${includePrimary ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-neutral-700'}`}
            aria-pressed={includePrimary}
          >
            <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${includePrimary ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 dark:text-neutral-200">Time Period</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className="input text-xs" value="Current" readOnly />
            <input className="input text-xs" value="YTD" readOnly />
          </div>
        </div>
      </div>
    </Panel>
  )
}

function InsightPanel({ model }) {
  const insight = model.insights[0]
  return (
    <Panel title={`AI Insight (${new Date(model.asOfDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`}>
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-100">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm leading-6 text-gray-700 dark:text-neutral-200">
            {insight?.message || 'No deterministic insight is available for the selected scope.'}
          </p>
          <Link to="/reports" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">
            View All Insights
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </Panel>
  )
}

function QuickActions() {
  const actions = [
    { label: 'Run What-If Analysis', icon: RefreshCw, to: '/reports' },
    { label: 'Compare Properties', icon: SlidersHorizontal, to: '/properties' },
    { label: 'Export Custom Report', icon: FileDown, to: '/reports' },
    { label: 'Track Goals', icon: Target, to: '/dashboard' },
    { label: 'Benchmark Portfolio', icon: ShieldCheck, to: '/reports' },
  ]
  return (
    <Panel title="Quick Actions">
      <div className="space-y-2">
        {actions.map(({ label, icon: Icon, to }) => (
          <Link key={label} to={to} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-blue-700 dark:bg-neutral-800">
              <Icon className="h-4 w-4" />
            </span>
            {label}
          </Link>
        ))}
      </div>
    </Panel>
  )
}

function EmptyState({ label }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-4 text-center dark:border-neutral-700 dark:bg-neutral-800/40">
      <LineChartIcon className="h-5 w-5 text-gray-300 dark:text-neutral-600" aria-hidden="true" />
      <span className="text-xs leading-snug text-gray-400 dark:text-neutral-400">{label}</span>
    </div>
  )
}

function ForecastView({ forecast }) {
  if (forecast?.status !== 'PROJECTED' || !forecast?.series?.length) {
    return (
      <Panel title="Forecast" subtitle="Five-year rental operating outlook">
        <EmptyState label={forecast?.reason || 'No forecast is available for the selected properties.'} />
      </Panel>
    )
  }

  const kpis = forecast.kpis || {}
  const metricValue = (key) => kpis[key]?.value
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={WalletCards} label={kpis.endingCashFlow?.label || 'Ending Cash Flow'} value={compactMoney(metricValue('endingCashFlow'))} delta="After P&I debt service" tone="green" />
        <KpiCard icon={Building2} label={kpis.endingNoi?.label || 'Ending NOI'} value={compactMoney(metricValue('endingNoi'))} delta="Before debt service" tone="blue" />
        <KpiCard icon={CalendarDays} label="Five-Year Cash Flow" value={compactMoney(metricValue('cumulativeCashFlow'))} delta={kpis.cumulativeCashFlow?.period} tone="violet" />
        <KpiCard icon={TrendingUp} label="Cash Flow Growth" value={metricValue('cashFlowGrowth') == null ? '—' : percent(metricValue('cashFlowGrowth'), 1)} delta={`vs ${forecast.baseYear} run-rate`} tone="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
        <Panel title="Five-Year Outlook" subtitle="Rental operations and after-debt cash flow">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={forecast.series} margin={{ left: 0, right: 14, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
                <XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
                <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={58} tickFormatter={compactMoney} />
                <Tooltip formatter={(value) => fullMoney(value)} contentStyle={chartTooltipStyle(false)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="rentalIncome" name="Rental Income" fill={chartColors.positiveTint} stroke={chartColors.positive} fillOpacity={0.45} />
                <Line type="monotone" dataKey="operatingExpenses" name="Operating Expenses" stroke={chartColors.danger} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="noi" name="NOI" stroke={chartColors.primary} strokeWidth={2.5} />
                <Line type="monotone" dataKey="cashFlow" name="Cash Flow" stroke={chartColors.purple} strokeWidth={2.5} />
                <ReferenceLine y={0} stroke={chartColors.neutralLight} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Forecast Assumptions" subtitle={`${forecast.rentalPropertyCount} rental ${forecast.rentalPropertyCount === 1 ? 'property' : 'properties'} selected`}>
          <div className="space-y-3">
            {(forecast.assumptions || []).map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3 text-sm last:border-0 dark:border-neutral-800">
                <div>
                  <p className="font-medium text-gray-700 dark:text-neutral-200">{row.label}</p>
                  <p className="mt-1 text-xs text-gray-400">{row.source}</p>
                </div>
                <span className="font-semibold text-gray-950 dark:text-white">{percent(row.value, 1)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4 text-xs leading-5 text-gray-500 dark:border-neutral-800 dark:text-neutral-400">
            <p>{forecast.methodology?.baseline}</p>
            <p className="mt-2">Confidence: <span className="font-semibold text-gray-700 dark:text-neutral-200">{forecast.methodology?.confidence || '—'}</span></p>
          </div>
        </Panel>
      </div>

      <Panel title="Annual Forecast" subtitle="Backend-calculated values; baseline is shown for comparison">
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-800">
          <table className="min-w-[52rem] w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 text-left">Year</th>
                <th className="px-4 py-3 text-right">Rental income</th>
                <th className="px-4 py-3 text-right">Operating expenses</th>
                <th className="px-4 py-3 text-right">NOI</th>
                <th className="px-4 py-3 text-right">P&I debt service</th>
                <th className="px-4 py-3 text-right">Cash flow</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
              {forecast.series.map((row) => (
                <tr key={row.year} className={row.status === 'BASELINE_RUN_RATE' ? 'bg-blue-50/50 dark:bg-blue-950/10' : ''}>
                  <td className="px-4 py-3 font-semibold text-gray-950 dark:text-white">{row.year}</td>
                  <td className="px-4 py-3 text-right">{fullMoney(row.rentalIncome)}</td>
                  <td className="px-4 py-3 text-right">{fullMoney(row.operatingExpenses)}</td>
                  <td className="px-4 py-3 text-right font-medium">{fullMoney(row.noi)}</td>
                  <td className="px-4 py-3 text-right">{fullMoney(row.debtService)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.cashFlow >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{fullMoney(row.cashFlow)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-neutral-400">{row.status === 'BASELINE_RUN_RATE' ? 'Current run-rate' : 'Projected'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-neutral-400">
          Excludes {(forecast.methodology?.excluded || []).join(', ').toLowerCase()}.
        </p>
      </Panel>
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [includePrimary, setIncludePrimary] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const initializedSelection = useRef(false)

  const filterProperties = data?.filterContext?.availableProperties || []
  const selectedKey = useMemo(() => {
    if (!filterProperties.length || !initializedSelection.current) return ''
    return filterProperties
      .filter((row) => selectedIds.has(row.id) && (includePrimary || !row.isPrimary))
      .map((row) => row.id)
      .sort((a, b) => a - b)
      .join(',')
  }, [filterProperties, includePrimary, selectedIds])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    propAPI.portfolioAnalysis({
      selected_property_ids: selectedKey,
      selection_explicit: initializedSelection.current,
      include_primary_residence: includePrimary,
    }, { signal: controller.signal })
      .then((response) => {
        setData(response.data)
        const filters = response.data?.filterContext?.availableProperties || []
        if (!initializedSelection.current) {
          setSelectedIds(new Set(filters.map((row) => row.id)))
          initializedSelection.current = true
        }
      })
      .catch((error) => {
        if (error?.code !== 'ERR_CANCELED') toast.error('Failed to load analytics')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [includePrimary, selectedKey])

  const model = useMemo(() => analyticsModel(data), [data])

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </PageContainer>
    )
  }

  if (!data) {
    return (
      <PageContainer>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
          Analytics are unavailable.
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-[112rem]">
      <div className="space-y-5">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Analytics</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Deep insights and performance analytics for your real estate portfolio</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4" />
              Current Period
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" />
              Export Report
            </button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-0 dark:border-neutral-800" aria-label="Analytics views">
          {ANALYTICS_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex min-w-max items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${
                activeTab === id
                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard icon={Home} label="Total Portfolio Value" value={compactMoney(model.portfolioValue)} delta={`As of ${model.asOfDate}`} tone="green" />
          <KpiCard icon={WalletCards} label="Net Monthly Cash Flow" value={compactMoney(model.monthlyCashFlow)} delta="Current scope" tone="green" />
          <KpiCard icon={Building2} label="Annual NOI" value={compactMoney(model.annualNoi)} delta="YTD run-rate" tone="violet" />
          <KpiCard icon={Target} label="Cash on Cash Return" value={model.cashOnCash == null ? '—' : percent(model.cashOnCash, 2)} delta={model.cashOnCash == null ? 'Cash invested unavailable' : 'Annualized'} tone="amber" />
          <KpiCard icon={BarChart3} label="Portfolio Cap Rate" value={model.capRate == null ? '—' : percent(model.capRate, 2)} delta="NOI / value" tone="blue" />
          <KpiCard icon={ShieldCheck} label="Debt Coverage Ratio" value={model.dscr ? formatFixed(model.dscr, 2) : '—'} delta="NOI / debt service" tone="green" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <main className="space-y-5">
            {['overview', 'cashflow', 'performance'].includes(activeTab) ? <div className="grid gap-5 lg:grid-cols-3">
              <Panel title="Cash Flow" subtitle="Monthly selected scope">
                <CashFlowWaterfall model={model} />
              </Panel>
              <Panel title="Cash Flow by Property" subtitle="Monthly cash flow and cash-on-cash return">
                <CashFlowByProperty rows={model.propertyRows} />
                <Link to="/properties" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                  View Full Report
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Panel>
              <Panel title="Performance Summary" subtitle="Portfolio run-rate">
                <PerformanceSummary model={model} />
              </Panel>
            </div> : null}

            {['overview', 'cashflow'].includes(activeTab) ? <div className="grid gap-5 lg:grid-cols-3">
              <Panel title="Net Cash Flow Over Time" subtitle="Tax-year trend where available">
                <CashFlowTrend data={model.trendRows} />
              </Panel>
              <Panel title="Occupancy Rate Trend" subtitle="Selected portfolio occupancy">
                <OccupancyTrend model={model} />
              </Panel>
              <Panel title="Expense Breakdown" subtitle="Operating expenses, no pie charts">
                <ExpenseBreakdown rows={model.expenseBreakdown} />
                <Link to="/properties" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                  View Expense Report
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Panel>
            </div> : null}

            {['overview', 'performance', 'equity'].includes(activeTab) ? <div className="grid gap-5 lg:grid-cols-3">
              <Panel title="Property Performance Matrix" subtitle="Cash flow vs cash-on-cash return">
                <PerformanceMatrix rows={model.propertyRows} quadrants={model.matrixQuadrants} />
              </Panel>
              <Panel title="Equity Growth" subtitle="Market value, debt, and equity trend">
                <EquityGrowth model={model} />
              </Panel>
              <Panel title="Top Performers" subtitle="Ranked by cash-on-cash return">
                <TopPerformers rows={model.propertyRows} />
                <Link to="/properties" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                  View All Properties
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Panel>
            </div> : null}

            {activeTab === 'loans' ? (
              <Panel title="Loan Analysis" subtitle="Active logical loans only; servicer transfers remain one debt chain.">
                <PerformanceSummary model={model} />
                <Link to="/loans" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                  Open Loans
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Panel>
            ) : null}

            {activeTab === 'forecast' ? (
              <ForecastView forecast={model.forecast} />
            ) : null}

            {activeTab === 'scenarios' ? (
              <Panel title="Scenario Analysis" subtitle="Saved baseline and scenario comparison">
                <EmptyState label={model.scenario.reason || 'No saved scenario is available.'} />
              </Panel>
            ) : null}
          </main>

          <aside className="space-y-5">
            <ControlsPanel
              filterProperties={filterProperties}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              includePrimary={includePrimary}
              setIncludePrimary={setIncludePrimary}
            />
            <InsightPanel model={model} />
            <QuickActions />
          </aside>
        </div>
      </div>
    </PageContainer>
  )
}
