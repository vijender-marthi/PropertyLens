import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Building2, ChevronDown, CircleDollarSign, Download, Landmark, ReceiptText, RefreshCw, WalletCards } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { formatCurrency, formatPercent } from '../utils/formatters'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'

const VIEW_TABS = ['Overview', 'Income', 'Expenses', 'By Property', 'Monthly Trends', 'Year Over Year']

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function Panel({ children, className = '' }) {
  return <section className={`min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>{children}</section>
}

function Metric({ icon: Icon, label, value, note, tone = 'blue', percentage = false }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  }
  return (
    <Panel className="p-4">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{percentage ? formatPercent(value) : formatCurrency(value)}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-500">{note}</p>
        </div>
      </div>
    </Panel>
  )
}

function ScopeControls({ properties, excludedIds, onToggle, onSelectAll }) {
  const selected = properties.length - excludedIds.size
  return (
    <Panel className="h-fit p-4">
      <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Controls</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Changing selection refreshes portfolio metrics from the backend.</p>
      <button type="button" onClick={onSelectAll} className="mt-4 flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
        <span>{selected === properties.length ? `All properties (${properties.length})` : `${selected} selected`}</span><ChevronDown className="h-4 w-4" />
      </button>
      <div className="mt-3 space-y-1 border-b border-gray-100 pb-4 dark:border-neutral-800">
        {properties.map((property) => {
          const checked = !excludedIds.has(property.id)
          const primary = String(property.usage_type || '').toLowerCase() === 'primary'
          return (
            <label key={property.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
              <input type="checkbox" checked={checked} onChange={() => onToggle(property.id)} className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="min-w-0 flex-1 truncate">{property.name || property.address || `Property ${property.id}`}</span>
              {primary ? <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">Home</span> : null}
            </label>
          )
        })}
      </div>
      <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-neutral-950">
        <p className="text-xs font-semibold text-gray-700 dark:text-neutral-200">Data scope</p>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-neutral-400">Rental income and operating metrics exclude primary-residence activity by default.</p>
      </div>
    </Panel>
  )
}

function EmptyState() {
  return (
    <Panel className="p-10 text-center">
      <ReceiptText className="mx-auto h-9 w-9 text-gray-300 dark:text-neutral-600" />
      <h2 className="mt-3 text-base font-semibold text-gray-950 dark:text-white">No rental records yet</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-neutral-400">Add a rental period or upload an expense document from a property to build this portfolio view.</p>
      <Link to="/properties" className="btn-primary mt-5 inline-flex items-center gap-2">Open Properties <ArrowRight className="h-4 w-4" /></Link>
    </Panel>
  )
}

function AnnualTrend({ rows }) {
  if (!rows.length) return <p className="grid h-64 place-items-center text-sm text-gray-500 dark:text-neutral-400">No annual history is available yet.</p>
  const ordered = [...rows].sort((left, right) => Number(left.year) - Number(right.year))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={ordered} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barCategoryGap="24%" barGap={4}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="year_label" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} interval={0} />
          <YAxis tickFormatter={(value) => formatCurrency(value)} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={70} />
          <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
          <ReferenceLine y={0} stroke={chartColors.muted} />
          <Bar dataKey="rental_income" name="Income" fill={chartColors.positiveSoft} radius={[4, 4, 0, 0]} minPointSize={2} maxBarSize={48} />
          <Bar dataKey="operating_expenses" name="Operating expenses" fill={chartColors.negativeSoft} radius={[4, 4, 0, 0]} minPointSize={2} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function NetIncomeTrend({ rows }) {
  if (!rows.length) return <p className="grid h-64 place-items-center text-sm text-gray-500 dark:text-neutral-400">No annual history is available yet.</p>
  const ordered = [...rows].sort((left, right) => Number(left.year) - Number(right.year))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={ordered} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="year_label" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} interval={0} />
          <YAxis tickFormatter={(value) => formatCurrency(value)} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={70} />
          <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} />
          <ReferenceLine y={0} stroke={chartColors.muted} />
          <Line type="monotone" dataKey="net_operating_income" name="Net operating income" stroke={chartColors.primary} strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function IncomeExpensesPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [excludedIds, setExcludedIds] = useState(new Set())
  const [activeTab, setActiveTab] = useState('Overview')

  const load = useCallback((excluded = excludedIds) => {
    setLoading(true)
    setError('')
    const available = data?.filterContext?.availableProperties || []
    const selected = available.filter((property) => !excluded.has(property.id)).map((property) => property.id)
    propAPI.portfolioAnalysis({
      selected_property_ids: available.length ? selected.join(',') : '',
      selection_explicit: Boolean(available.length),
      include_primary_residence: false,
    })
      .then((response) => setData(response.data || {}))
      .catch(() => setError('Unable to load income and expense data.'))
      .finally(() => setLoading(false))
  }, [excludedIds])

  useEffect(() => { load() }, [load])

  const model = data?.incomeExpenses || {}
  const kpis = model.kpis || {}
  const controls = data?.filterContext?.availableProperties || []
  const properties = model.properties || []
  const yearly = useMemo(() => model.yearlySeries || [], [model.yearlySeries])
  const cashFlowMargin = kpis.cashFlowMargin?.value
  const toggleProperty = (id) => setExcludedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const selectAll = () => setExcludedIds((current) => current.size ? new Set() : new Set(controls.map((property) => property.id)))

  if (loading && !data) {
    return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div></PageContainer>
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-start sm:justify-between dark:border-neutral-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Income & Expenses</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Track rental income and operating costs across your properties.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => load()} className="btn-secondary inline-flex items-center gap-2" disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          <Link to="/reports" className="btn-secondary inline-flex items-center gap-2"><Download className="h-4 w-4" /> Export Report</Link>
        </div>
      </div>

      {error ? <Panel className="border-red-200 p-4 text-sm text-red-700 dark:border-red-900/70 dark:text-red-300">{error}</Panel> : null}
      <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-neutral-800" aria-label="Income and expense views">
        {VIEW_TABS.map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`min-w-max border-b-2 px-4 py-3 text-sm font-medium ${activeTab === tab ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300' : 'border-transparent text-gray-500 dark:text-neutral-400'}`}>
            {tab}
          </button>
        ))}
      </nav>
      {!error && !properties.length && !controls.length ? <EmptyState /> : null}

      {!error && !properties.length && controls.length ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_13rem]">
          <EmptyState />
          <ScopeControls properties={controls} excludedIds={excludedIds} onToggle={toggleProperty} onSelectAll={selectAll} />
        </div>
      ) : null}

      {!error && properties.length ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="min-w-0 space-y-4">
            {activeTab !== 'By Property' && activeTab !== 'Monthly Trends' ? <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
              <Metric icon={CircleDollarSign} label="Total Income" value={kpis.income?.value} note="Current monthly rental income" tone="emerald" />
              <Metric icon={ReceiptText} label="Operating Expenses" value={kpis.operatingExpenses?.value} note="Monthly operating costs" tone="red" />
              <Metric icon={BarChart3} label="Net Operating Income" value={kpis.noi?.value} note="Income after operating expenses" tone="blue" />
              <Metric icon={WalletCards} label="Cash Flow (After Debt)" value={kpis.cashFlow?.value} note="After principal and interest" tone="violet" />
              <Metric icon={Landmark} label="Cash Flow Margin" value={cashFlowMargin} note="Backend portfolio ratio" tone="amber" percentage />
            </div> : null}

            {['Overview', 'Income', 'Expenses', 'Year Over Year'].includes(activeTab) ? <div className="grid gap-4 xl:grid-cols-2">
              <Panel className="p-5">
                <div className="mb-4"><h2 className="text-base font-semibold text-gray-950 dark:text-white">Income vs Expenses</h2><p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Calendar-year income and operating expense records.</p></div>
                <AnnualTrend rows={yearly} />
              </Panel>
              <Panel className="p-5">
                <div className="mb-4"><h2 className="text-base font-semibold text-gray-950 dark:text-white">Net Operating Income Trend</h2><p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Calendar-year income less operating expenses; the current year is projected.</p></div>
                <NetIncomeTrend rows={yearly} />
              </Panel>
            </div> : null}

            {activeTab === 'Monthly Trends' ? <Panel className="p-10 text-center"><h2 className="text-base font-semibold text-gray-950 dark:text-white">Monthly history unavailable</h2><p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">The backend currently stores annual history and current monthly values, so no monthly trend is drawn.</p></Panel> : null}

            {['Overview', 'Income', 'Expenses', 'By Property'].includes(activeTab) ? <Panel className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
                <div><h2 className="text-base font-semibold text-gray-950 dark:text-white">Income & Expenses by Property</h2><p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Current backend-selected monthly values.</p></div>
                <Link to="/properties" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300">Manage properties <ArrowRight className="h-4 w-4" /></Link>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[58rem] w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400"><tr><th className="px-5 py-3">Property</th><th className="px-4 py-3 text-right">Income</th><th className="px-4 py-3 text-right">Expenses</th><th className="px-4 py-3 text-right">NOI</th><th className="px-4 py-3 text-right">Debt Service</th><th className="px-5 py-3 text-right">Cash Flow</th></tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">
                    {properties.map((property) => <tr key={property.id} className="hover:bg-gray-50/70 dark:hover:bg-neutral-800/40"><td className="px-5 py-3"><Link to={`/properties/${property.id}/summary`} className="inline-flex items-center gap-2 font-semibold text-gray-950 hover:text-blue-700 dark:text-white dark:hover:text-blue-300"><Building2 className="h-4 w-4 text-gray-400" />{property.name || property.address || `Property ${property.id}`}</Link><p className="mt-0.5 pl-6 text-xs text-gray-500 dark:text-neutral-400">{[property.city, property.state].filter(Boolean).join(', ')}</p></td><td className="px-4 py-3 text-right font-medium text-emerald-700 dark:text-emerald-300">{formatCurrency(property.income)}</td><td className="px-4 py-3 text-right">{formatCurrency(property.operatingExpenses)}</td><td className="px-4 py-3 text-right">{formatCurrency(property.noi)}</td><td className="px-4 py-3 text-right">{formatCurrency(property.debtService)}</td><td className={`px-5 py-3 text-right font-semibold ${number(property.cashFlow) < 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{formatCurrency(property.cashFlow)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </Panel> : null}
          </div>
          <ScopeControls properties={controls} excludedIds={excludedIds} onToggle={toggleProperty} onSelectAll={selectAll} />
        </div>
      ) : null}
    </PageContainer>
  )
}
