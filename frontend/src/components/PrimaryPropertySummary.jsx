import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatChartCurrency } from '../utils/formatters'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import {
  SummaryIcon,
  TopMetricCard,
  metricFullDisplay,
  ValueListCard,
} from './RentalPropertySummary'

function OwnershipCard({ section, metrics }) {
  const total = metrics?.[section?.totalMetricKey]
  return (
    <section className="flex min-h-56 flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <SummaryIcon name={section.icon} tone={section.tone} />
        <h3 className="text-xs font-bold uppercase text-gray-700">{section.title}</h3>
      </div>
      {section.status === 'unavailable' ? (
        <div className="grid flex-1 place-items-center px-2 text-center text-sm text-gray-500">{section.unavailableReason || 'Unavailable'}</div>
      ) : (
        <dl className="mt-4 flex-1">
          {(section.rows || []).map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-sm">
              <dt className="text-gray-600">{row.label}</dt>
              <dd className={`font-semibold ${row.tone === 'positive' ? 'text-green-700' : 'text-gray-900'}`}>{metricFullDisplay(metrics?.[row.metricKey])}</dd>
            </div>
          ))}
        </dl>
      )}
      {section.totalMetricKey ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm font-bold text-green-700">
          <span>{section.totalLabel}</span>
          <span>{metricFullDisplay(total)}</span>
        </div>
      ) : null}
    </section>
  )
}

function WealthTrend({ data }) {
  const series = data?.series || []
  return (
    <section className="min-h-56 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <SummaryIcon name="gain" tone="purple" />
        <h3 className="text-xs font-bold uppercase text-gray-700">{data?.title || 'Multi-Year Equity Trend'}</h3>
      </div>
      <div className="mt-3 h-40">
        {series.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="primary-equity-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartColors.gridLight} vertical={false} />
              <XAxis dataKey="year" tick={chartTypography.mutedTick} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.mutedTick} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value, _name, item) => [item.payload.equityDisplay, 'Equity']} contentStyle={chartTooltipStyle(false)} />
              <Area type="monotone" dataKey="equity" stroke={chartColors.primary} strokeWidth={2} fill="url(#primary-equity-fill)" dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : <div className="grid h-full place-items-center text-sm text-gray-500">Equity history unavailable</div>}
      </div>
    </section>
  )
}

export default function PrimaryPropertySummary({ metricVault, waterfall }) {
  const presentation = metricVault?.primarySummary
  const metrics = metricVault?.metrics || {}
  if (!presentation) return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Primary residence summary unavailable.</div>

  return (
    <div className="space-y-4" data-testid="primary-property-summary">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Primary residence metrics">
        {(presentation.topMetrics || []).map((config) => (
          <TopMetricCard key={config.metricKey} config={config} metric={metrics[config.metricKey]} supportingMetric={metrics[config.supportingMetricKey]} />
        ))}
      </section>

      <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(15rem,0.9fr)_minmax(32rem,2.2fr)_minmax(15rem,0.9fr)]">
        <ValueListCard section={presentation.valueBuildup} metrics={metrics} tone="asset" />
        <section className="h-full min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase text-gray-900">Value Buildup Over Time</h2>
              <p className="mt-1 text-xs text-gray-500">How your property value has grown</p>
            </div>
            <select className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700" aria-label="Value buildup period" defaultValue="all">
              <option value="all">All Time</option>
            </select>
          </div>
          {waterfall}
        </section>
        <ValueListCard section={presentation.loanInformation} metrics={metrics} tone="liability" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" aria-label="Ownership story">
        {(presentation.ownershipSections || []).map((section) => <OwnershipCard key={section.key} section={section} metrics={metrics} />)}
        <WealthTrend data={presentation.wealthTrend} />
      </section>

    </div>
  )
}
