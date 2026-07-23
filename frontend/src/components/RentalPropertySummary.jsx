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
import {
  BadgeDollarSign,
  CalendarDays,
  Check,
  CircleDollarSign,
  Gauge,
  Home,
  KeyRound,
  Landmark,
  Lightbulb,
  MapPin,
  Percent,
  ReceiptText,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { homeTypeLabel } from '../config/propertySetupPresentation'
import { formatChartCurrency, formatDate } from '../utils/formatters'
import { chartColorRamps, chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'

const ICONS = {
  home: Home,
  equity: Landmark,
  'cash-flow': CircleDollarSign,
  percent: Percent,
  target: Target,
  ratio: Scale,
  'rental-income': BadgeDollarSign,
  'operating-expenses': ReceiptText,
  noi: TrendingUp,
  'debt-service': WalletCards,
  occupancy: Gauge,
  calendar: CalendarDays,
  'map-pin': MapPin,
  receipt: ReceiptText,
  shield: ShieldCheck,
  key: KeyRound,
  bank: Landmark,
  gain: TrendingUp,
  wallet: WalletCards,
}

const TONES = {
  blue: { icon: 'bg-blue-50 text-blue-600', value: 'text-gray-950' },
  green: { icon: 'bg-green-50 text-green-600', value: 'text-green-700' },
  teal: { icon: 'bg-teal-50 text-teal-600', value: 'text-green-700' },
  orange: { icon: 'bg-orange-50 text-orange-600', value: 'text-gray-950' },
  purple: { icon: 'bg-purple-50 text-purple-600', value: 'text-gray-950' },
  cyan: { icon: 'bg-cyan-50 text-cyan-700', value: 'text-gray-950' },
}

export function metricDisplay(metric) {
  return metric?.displayValue ?? metric?.display ?? '—'
}

export function metricFullDisplay(metric) {
  return metric?.fullDisplayValue ?? metric?.fullDisplay ?? metricDisplay(metric)
}

function metricTone(metric, configuredTone) {
  if (metric?.tone === 'negative') return 'text-red-600'
  if (metric?.tone === 'positive') return 'text-green-700'
  return TONES[configuredTone]?.value || 'text-gray-950'
}

export function SummaryIcon({ name, tone = 'blue', className = '' }) {
  const Icon = ICONS[name] || Home
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${TONES[tone]?.icon || TONES.blue.icon} ${className}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  )
}

export function RentalPropertySummaryHeader({ prop, presentation, metrics, expanded, onToggleDetails, badgeFallback = 'Rental Property' }) {
  const header = presentation?.header || {}
  const occupancy = metrics?.[header.occupancyMetricKey]
  const address = [prop?.address, prop?.city, prop?.state, prop?.zip_code].filter(Boolean).join(', ')
  const purchaseDate = prop?.purchase_date || header.purchaseDate
  const status = header.currentStatus || header.status || prop?.current_residency_status || prop?.usage_type || '—'

  return (
    <header className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold uppercase text-green-700">
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            {header.badge || badgeFallback}
          </span>
          <h1 className="truncate text-lg font-bold text-gray-950 sm:text-xl">{prop?.name || 'Rental property'}</h1>
          <button
            type="button"
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
            aria-expanded={expanded}
            aria-controls="rental-property-header-details"
            onClick={onToggleDetails}
          >
            {expanded ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
        <div className="flex shrink-0 items-center">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2.5 text-[11px] font-medium text-orange-700">
            As of {header.asOfDate ? formatDate(header.asOfDate) : '—'}
            <CalendarDays className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
          </span>
        </div>
      </div>
      {expanded ? (
        <div id="rental-property-header-details" className="mt-3 border-t border-gray-100 pt-3 text-xs">
          <p className="text-gray-600"><span className="font-medium text-gray-500">Address</span><span className="mx-2 text-gray-300">·</span><span className="font-semibold text-gray-900">{address || 'Address unavailable'}</span></p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            <div className="flex items-center gap-1.5"><dt className="text-gray-500">Property type</dt><dd className="font-semibold text-gray-900">{homeTypeLabel(prop?.property_type, prop?.property_type_raw) || '—'}</dd></div>
            <div className="flex items-center gap-1.5"><dt className="text-gray-500">Purchased</dt><dd className="font-semibold text-gray-900">{purchaseDate ? formatDate(purchaseDate) : '—'}</dd></div>
            <div className="flex items-center gap-1.5"><dt className="text-gray-500">Status</dt><dd className="font-semibold text-gray-900">{status}</dd></div>
            {header.occupancyMetricKey ? <div className="flex items-center gap-1.5"><dt className="text-gray-500">Occupancy</dt><dd className="font-semibold text-gray-900">{metricDisplay(occupancy)}</dd></div> : null}
          </dl>
        </div>
      ) : null}
    </header>
  )
}

export function TopMetricCard({ config, metric, supportingMetric }) {
  return (
    <article className="min-h-24 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <SummaryIcon name={config.icon} tone={config.tone} />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-gray-500">{metric?.label || config.metricKey}</p>
          <p className={`mt-1 truncate text-xl font-bold ${metricTone(metric, config.tone)}`}>{metricDisplay(metric)}</p>
          <p className="mt-1 text-xs text-gray-500">{supportingMetric ? `${metricFullDisplay(supportingMetric)}${config.supportingText ? ` ${config.supportingText}` : ''}` : config.supportingText || metric?.subtitle || '—'}</p>
        </div>
      </div>
    </article>
  )
}

export function ValueListCard({ section, metrics, tone, onJump }) {
  const total = metrics?.[section?.totalMetricKey]
  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_minmax(7.5rem,auto)] gap-3">
      <section className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <SummaryIcon name={tone === 'asset' ? 'home' : 'debt-service'} tone={tone === 'asset' ? 'green' : 'orange'} />
            <h2 className="text-sm font-bold uppercase text-gray-900">{section?.title}</h2>
          </div>
          {tone === 'asset' ? <span className="text-base font-bold text-gray-950">{metricDisplay(total)}</span> : <span className="text-base font-bold text-gray-950">{metricDisplay(metrics?.loanBalance)}</span>}
        </div>
        <dl className="space-y-0 px-4 pb-3">
          {(section?.rows || []).map((row) => {
            const metric = row.metricKey ? metrics?.[row.metricKey] : null
            const display = row.dataType === 'date' && row.value ? formatDate(row.value) : metricDisplay(metric) !== '—' ? metricDisplay(metric) : row.display || '—'
            return (
              <div key={row.label} className="flex items-center justify-between gap-3 border-t border-gray-100 py-2.5 first:border-t-0">
                <dt className="text-sm text-gray-600">{row.label}</dt>
                <dd className={`text-right text-sm font-semibold ${row.tone === 'positive' ? 'text-green-700' : 'text-gray-900'}`}>{display}</dd>
              </div>
            )
          })}
        </dl>
        <div className={`mt-auto flex items-center justify-between px-4 py-3 ${tone === 'asset' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          <span className="text-sm font-bold">{tone === 'asset' ? 'Total Equity' : 'Debt to Value (LTV)'}</span>
          <span className="text-base font-bold">{metricDisplay(total)}</span>
        </div>
      </section>
      <section className="h-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900"><Lightbulb className="h-4 w-4 text-green-600" aria-hidden="true" />{tone === 'asset' ? 'Equity Highlights' : 'Loan Highlights'}</h3>
        <ul className="mt-3 space-y-2">
          {(section?.highlights || []).map((item) => (
            <li key={item.text} className="flex items-start gap-2 text-xs leading-5 text-gray-600">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden="true" />
              <button type="button" className="text-left hover:text-blue-600" onClick={() => item.tabKey && onJump?.(item.tabKey)}>{item.text}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function OperationalMetricCard({ config, metric, annualMetric }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <SummaryIcon name={config.icon} tone={config.tone} />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-gray-500">{metric?.label || config.metricKey}</p>
          <p className={`mt-1 whitespace-nowrap text-lg font-bold ${metricTone(metric, config.tone)}`}>{metricDisplay(metric)}{metric?.period === 'mo' ? <span className="text-xs font-medium text-gray-500"> / mo</span> : null}</p>
          <p className="mt-1 text-xs text-gray-500">{annualMetric ? `${metricFullDisplay(annualMetric)} / year` : config.secondaryText || '—'}</p>
        </div>
      </div>
    </article>
  )
}

function CashFlowTrend({ data, onJump }) {
  const series = data?.series || []
  return (
    <section className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold uppercase text-gray-900">{data?.title || 'Cash Flow Trend'}</h3>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500"><span>{data?.period || 'Annual'}</span><span className="flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-600" />Net Cash Flow</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-600" />Debt Service</span></span></div>
      <div className="mt-3 h-44">
        {series.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={chartColors.gridLight} vertical={false} />
              <XAxis dataKey="year" tick={chartTypography.mutedTick} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.mutedTick} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value, name, item) => [name === 'cashFlow' ? item.payload.cashFlowDisplay : item.payload.debtServiceDisplay, name === 'cashFlow' ? 'Cash flow' : 'Debt service']} contentStyle={chartTooltipStyle(false)} />
              <Line type="monotone" dataKey="cashFlow" stroke={chartColors.positive} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="debtService" stroke={chartColors.primary} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="grid h-full place-items-center text-sm text-gray-500">Trend unavailable</div>}
      </div>
      <button type="button" onClick={() => onJump?.('rental')} className="mt-auto inline-flex items-center gap-1 self-start pt-3 text-xs font-semibold text-blue-600 hover:text-blue-700">View Cash Flow Analysis <span aria-hidden="true">→</span></button>
    </section>
  )
}

function ExpenseBreakdown({ data, metrics, onJump }) {
  const items = data?.items || []
  const colors = chartColorRamps.blue.concat(chartColorRamps.amber)
  return (
    <section className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold uppercase text-gray-900">{data?.title || 'Expense Breakdown'}</h3>
      <div className="mt-3 grid min-h-44 grid-cols-[8rem_1fr] items-center gap-3">
        <div className="relative h-32 w-32">
          {items.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={items} dataKey="value" nameKey="label" innerRadius={38} outerRadius={58} paddingAngle={1}>{items.map((item, index) => <Cell key={item.key} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={(value, name, item) => [item.payload.display, name]} contentStyle={chartTooltipStyle(false)} /></PieChart>
            </ResponsiveContainer>
          ) : null}
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-sm font-bold text-gray-950">{metricDisplay(metrics?.[data?.totalMetricKey])}</p><p className="text-xs text-gray-500">Total</p></div></div>
        </div>
        <ul className="space-y-1.5">
          {items.length ? items.map((item, index) => <li key={item.key} className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 text-gray-600"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} /><span className="truncate">{item.label}</span></span><span className="whitespace-nowrap font-semibold text-gray-900">{item.display}</span></li>) : <li className="text-sm text-gray-500">Expense data unavailable</li>}
        </ul>
      </div>
      <button type="button" onClick={() => onJump?.('expenses')} className="mt-auto inline-flex items-center gap-1 self-start pt-3 text-xs font-semibold text-blue-600 hover:text-blue-700">View Expense Details <span aria-hidden="true">→</span></button>
    </section>
  )
}

function AnnualPnl({ data, metrics, onJump }) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold uppercase text-gray-900">{data?.title || 'Annual P&L Summary'}</h3>
      <dl className="mt-3">
        {(data?.rows || []).map((row) => {
          const metric = metrics?.[row.metricKey]
          const tone = row.toneFromMetric ? metric?.tone : row.tone
          return <div key={row.label} className={`flex items-center justify-between gap-3 border-t border-gray-100 py-2 text-sm first:border-t-0 ${row.metricKey === 'annualCashFlow' ? 'rounded-lg bg-green-50 px-2' : ''}`}><dt className="text-gray-600">{row.label}</dt><dd className={`font-bold ${tone === 'positive' ? 'text-green-700' : tone === 'negative' ? 'text-red-600' : 'text-gray-900'}`}>{metricFullDisplay(metric)}</dd></div>
        })}
      </dl>
      <button type="button" onClick={() => onJump?.('taxes')} className="mt-auto inline-flex items-center gap-1 self-start pt-3 text-xs font-semibold text-blue-600 hover:text-blue-700">View Full P&amp;L Statement <span aria-hidden="true">→</span></button>
    </section>
  )
}

function KeyInsights({ data, onJump }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase text-gray-900"><Lightbulb className="h-4 w-4 text-blue-600" aria-hidden="true" />{data?.title || 'Key Insights'}</h3>
      <ul className="mt-3 space-y-3">
        {(data?.items || []).map((item) => <li key={item.text}><button type="button" onClick={() => item.tabKey && onJump?.(item.tabKey)} className="flex w-full items-start gap-2 text-left text-xs leading-5 text-gray-600 hover:text-blue-600"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{item.text}</button></li>)}
      </ul>
    </section>
  )
}

export default function RentalPropertySummary({ metricVault, onJump, waterfall }) {
  const presentation = metricVault?.rentalSummary
  const metrics = metricVault?.metrics || {}
  if (!presentation) return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Rental summary unavailable.</div>

  return (
    <div className="space-y-4" data-testid="rental-property-summary">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Rental property metrics">
        {(presentation.topMetrics || []).map((config) => <TopMetricCard key={config.metricKey} config={config} metric={metrics[config.metricKey]} supportingMetric={metrics[config.supportingMetricKey]} />)}
      </section>

      <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(15rem,0.9fr)_minmax(32rem,2.2fr)_minmax(15rem,0.9fr)]">
        <ValueListCard section={presentation.assets} metrics={metrics} tone="asset" onJump={onJump} />
        <div className="h-full min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2">
            <h2 className="text-sm font-bold uppercase text-gray-900">Value Buildup Over Time</h2><p className="mt-1 text-xs text-gray-500">How your property value has grown</p>
          </div>
          {waterfall}
        </div>
        <ValueListCard section={presentation.liabilities} metrics={metrics} tone="liability" onJump={onJump} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" aria-label="Rental operating metrics">
        {(presentation.operationalMetrics || []).map((config) => <OperationalMetricCard key={config.metricKey} config={config} metric={metrics[config.metricKey]} annualMetric={metrics[config.annualMetricKey]} />)}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CashFlowTrend data={presentation.cashFlowTrend} onJump={onJump} />
        <ExpenseBreakdown data={presentation.expenseBreakdown} metrics={metrics} onJump={onJump} />
        <AnnualPnl data={presentation.annualPnl} metrics={metrics} onJump={onJump} />
        <KeyInsights data={presentation.insights} onJump={onJump} />
      </section>
    </div>
  )
}
