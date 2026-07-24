import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Landmark,
  Percent,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import { formatChartCurrency, formatCurrency, formatCurrencyCompact, formatFixed, formatPercent } from '../utils/formatters'

const TAX_TABS = ['Overview', 'Schedule E', 'Deductions', 'Depreciation', 'Property Taxes', 'Documents', 'Estimated Taxes', 'Tax Reports', 'History']

const CATEGORY_COLORS = {
  depreciation: chartColors.purple,
  mortgageInterest: chartColors.primary,
  propertyTax: chartColors.warningStrong,
  operating: chartColors.positive,
  operatingExpenses: chartColors.positive,
  other: chartColors.neutral,
}

function money(value) {
  return formatCurrency(value)
}

function compact(value) {
  return formatCurrencyCompact(value, { threshold: 100_000, kDigits: 1, mDigits: 1 })
}

function KpiCard({ icon: Icon, label, value, note, tone = 'emerald' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${tones[tone] || tones.emerald}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{value}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">{note}</p>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
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

function SavingsTrend({ data }) {
  if (!data.length) return <EmptyState text="Upload tax returns or complete Schedule E history to build the trend." />
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="taxSavingsFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={chartColors.positive} stopOpacity={0.25} />
              <stop offset="95%" stopColor={chartColors.positive} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={52} />
          <Tooltip formatter={(value) => money(value)} contentStyle={chartTooltipStyle(false)} />
          <Legend />
          <Area type="monotone" dataKey="estimatedSavings" name="Estimated Tax Savings" fill="url(#taxSavingsFill)" stroke={chartColors.positive} strokeWidth={2.5} />
          <Area type="monotone" dataKey="estimatedLiability" name="Estimated Tax Liability" fill={chartColors.primaryTint} stroke={chartColors.primary} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function DeductionBars({ categories }) {
  return (
    <div className="space-y-4">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={categories} layout="vertical" margin={{ left: 8, right: 24, top: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chartColors.gridLight} />
            <XAxis type="number" tickFormatter={formatChartCurrency} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={120} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value) => money(value)} contentStyle={chartTooltipStyle(false)} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              {categories.map((row) => <Cell key={row.key} fill={CATEGORY_COLORS[row.key] || chartColors.neutral} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2">
        {categories.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-gray-600 dark:text-neutral-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[row.key] || chartColors.neutral }} />
              {row.label}
            </span>
            <span className="font-medium text-gray-950 dark:text-white">{money(row.value)} <span className="text-xs text-gray-400">({formatPercent(row.percentage, { maximumFractionDigits: 1 })})</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeductionTable({ rows }) {
  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-neutral-800">
        <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-3 text-left">Property</th>
            <th className="px-4 py-3 text-right">Total deductions</th>
            <th className="px-4 py-3 text-right">Depreciation</th>
            <th className="px-4 py-3 text-right">Interest</th>
            <th className="px-4 py-3 text-right">Property tax</th>
            <th className="px-4 py-3 text-right">Operating</th>
            <th className="px-4 py-3 text-right">Taxable income</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
          {rows.map((row) => (
            <tr key={row.propertyId}>
              <td className="px-4 py-3">
                <Link to={`/properties/${row.propertyId}/taxes`} className="font-medium text-gray-950 hover:text-blue-700 dark:text-white dark:hover:text-blue-300">{row.propertyName}</Link>
                <p className="text-xs text-gray-400">{row.location || row.sourceLabel}</p>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-gray-950 dark:text-white">{money(row.totalDeductions)}</td>
              <td className="px-4 py-3 text-right">{money(row.depreciation)}</td>
              <td className="px-4 py-3 text-right">{money(row.mortgageInterest)}</td>
              <td className="px-4 py-3 text-right">{money(row.propertyTax)}</td>
              <td className="px-4 py-3 text-right">{money(row.operatingExpenses)}</td>
              <td className={`px-4 py-3 text-right font-medium ${row.taxableIncome < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(row.taxableIncome)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-neutral-800 dark:text-neutral-400">{text}</div>
}

function StatusList({ count }) {
  const items = [
    ['1098s reviewed', `${count} properties`],
    ['Property taxes reviewed', `${count} properties`],
    ['Depreciation calculated', 'Complete'],
    ['Deduction categories', 'Ready'],
  ]
  return (
    <div className="space-y-3">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-gray-600 dark:text-neutral-300"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {label}</span>
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{value}</span>
        </div>
      ))}
    </div>
  )
}

function ScheduleELines({ lines }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 dark:text-neutral-500">
            <th className="px-3 py-2">Line</th>
            <th className="px-3 py-2 text-right">Filed (return)</th>
            <th className="px-3 py-2 text-right">PropertyLens</th>
            <th className="px-3 py-2 text-right">Variance</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lines.map((line) => (
            <tr key={line.key} className="border-t border-gray-100 dark:border-neutral-800">
              <td className="px-3 py-2 text-gray-600 dark:text-neutral-300"><span className="text-gray-400">{line.lineNumber}</span> · {line.lineItem}</td>
              <td className="px-3 py-2 text-right">{line.filed?.display ?? '—'}</td>
              <td className="px-3 py-2 text-right">{line.computed?.display ?? '—'}</td>
              <td className={`px-3 py-2 text-right ${!line.filed ? 'text-gray-400 dark:text-neutral-500' : line.status === 'Match' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {!line.filed ? '—' : line.status === 'Match' ? '✓ $0' : (line.delta?.display ?? '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScheduleEReconciliation({ properties, year }) {
  const [byProp, setByProp] = useState({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const rentals = (properties || []).filter((p) => String(p.usage_type || 'Rental').toLowerCase() !== 'primary')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all(rentals.map((p) => propAPI.scheduleE(p.id, year).then((r) => [p.id, r.data]).catch(() => [p.id, null])))
      .then((entries) => { if (!cancelled) setByProp(Object.fromEntries(entries)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, year])

  const exportCsv = () => {
    const rows = [['Property', 'Line', 'Item', 'Filed', 'PropertyLens', 'Variance']]
    rentals.forEach((p) => {
      (byProp[p.id]?.lines || []).forEach((line) => {
        rows.push([p.name, line.lineNumber, line.lineItem, line.filed?.value ?? '', line.computed?.value ?? '', line.delta?.value ?? ''])
      })
    })
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    anchor.download = `PropertyLens_Schedule_E_${year}.csv`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Schedule E — filed vs. PropertyLens · {year}</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-neutral-400">Upload a filed return to reconcile past years; export the current year to hand to your preparer.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} className="btn-secondary inline-flex items-center gap-2 text-xs px-2.5 py-1.5"><Download className="h-3.5 w-3.5" />Export CSV</button>
          <Link to="/uploads" className="btn-secondary inline-flex items-center gap-2 text-xs px-2.5 py-1.5"><Upload className="h-3.5 w-3.5" />Upload filed return</Link>
        </div>
      </div>

      {loading ? (
        <div className="card py-8 text-center text-sm text-gray-500 dark:text-neutral-400">Loading Schedule E…</div>
      ) : rentals.length === 0 ? (
        <EmptyState text="No rental properties for Schedule E in this scope." />
      ) : (
        rentals.map((p) => {
          const data = byProp[p.id]
          const net = data?.topStrip?.netScheduleE
          const summary = data?.summary
          const filedNet = (data?.lines || []).find((l) => l.key === 'net_income')?.filed
          const ties = summary?.netDelta?.value === 0
          const open = expanded === p.id
          return (
            <div key={p.id} className="card overflow-hidden p-0">
              <button type="button" onClick={() => setExpanded(open ? null : p.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{p.name}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-neutral-400">{summary?.filedSource || 'No filed Schedule E'}{summary?.linesFiled ? ` · ${summary.linesFiled} filed lines` : ''}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="text-[11px] text-gray-400 dark:text-neutral-500">Net Sch E</div>
                    <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{net?.display ?? '—'}</div>
                  </div>
                  {filedNet ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ties ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                      {ties ? 'Ties filed' : `Δ ${summary?.netDelta?.display}`}
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-neutral-800 dark:text-neutral-400">Not filed</span>
                  )}
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {open ? <div className="border-t border-gray-100 px-4 py-3 dark:border-neutral-800"><ScheduleELines lines={data?.lines || []} /></div> : null}
            </div>
          )
        })
      )}
    </div>
  )
}

export default function TaxCenterPage() {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear() - 1)
  const [activeTab, setActiveTab] = useState('Overview')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    propAPI.portfolioAnalysis({ tax_year: selectedYear, include_primary_residence: false }, { signal: controller.signal })
      .then((response) => setAnalysis(response.data || null))
      .catch((error) => {
        if (error?.code !== 'ERR_CANCELED') toast.error('Failed to load tax center')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [selectedYear])

  const model = analysis?.taxCenter || { rows: [], totals: {}, categories: [], trend: [], assumptions: {} }
  const properties = analysis?.properties || []
  const availableYears = model.availableYears?.length ? model.availableYears : [selectedYear]
  const showTrend = ['Overview', 'Estimated Taxes', 'History'].includes(activeTab)
  const showCategories = ['Overview', 'Deductions'].includes(activeTab)
  const showTable = ['Overview', 'Deductions', 'Depreciation', 'Property Taxes', 'Tax Reports'].includes(activeTab)

  const exportCSV = () => {
    const headers = ['Property', 'Location', 'Tax year', 'Total deductions', 'Depreciation', 'Mortgage interest', 'Property tax', 'Operating expenses', 'Taxable income']
    const lines = [
      headers.join(','),
      ...model.rows.map((row) => [
        row.propertyName,
        row.location,
        selectedYear,
        row.totalDeductions,
        row.depreciation,
        row.mortgageInterest,
        row.propertyTax,
        row.operatingExpenses,
        row.taxableIncome,
      ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `PropertyLens_Tax_Center_${selectedYear}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !analysis) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-[112rem]">
      <div className="space-y-5">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Tax Center</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Track, organize, and optimize your real estate tax position.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary inline-flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4" />
              <span>Tax Year</span>
              <select className="bg-transparent font-medium outline-none" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
              <ChevronDown className="h-4 w-4" />
            </label>
            <button type="button" onClick={exportCSV} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" />
              Export Tax Report
            </button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard icon={ShieldCheck} label="Estimated Tax Savings" value={compact(model.totals.estimatedSavings)} note="based on deductions" tone="emerald" />
          <KpiCard icon={ReceiptText} label="Total Deductions" value={compact(model.totals.totalDeductions)} note={`Tax year ${selectedYear}`} tone="purple" />
          <KpiCard icon={Landmark} label="Depreciation Deduction" value={compact(model.totals.depreciation)} note="non-cash deduction" tone="amber" />
          <KpiCard icon={FileSpreadsheet} label="Taxable Income" value={compact(model.totals.taxableIncome)} note="Schedule E total" tone={model.totals.taxableIncome < 0 ? 'red' : 'blue'} />
          <KpiCard icon={Percent} label="Effective Tax Rate" value={`${formatFixed(model.assumptions?.effectiveTaxRate || 0, 2)}%`} note="planning assumption" tone="emerald" />
          <KpiCard icon={ReceiptText} label="Est. Tax Liability" value={compact(model.totals.estimatedLiability)} note="rough planning value" tone="purple" />
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-neutral-800" aria-label="Tax center views">
          {TAX_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-w-max border-b-2 px-4 py-3 text-sm font-medium ${
                activeTab === tab
                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="space-y-5">
            {showTrend || showCategories ? <div className="grid gap-5 lg:grid-cols-2">
              {showTrend ? (
              <Panel title="Tax Savings Over Time" subtitle="Savings and liability from backend yearly tax rows">
                <SavingsTrend data={model.trend} />
              </Panel>
              ) : null}
              {showCategories ? (
              <Panel title={`Deductions by Category (${selectedYear})`} subtitle="No pie charts; proportional bar breakdown">
                <DeductionBars categories={model.categories} />
              </Panel>
              ) : null}
            </div> : null}

            {showTable ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <Panel title={`Deduction Summary by Property (${selectedYear})`} subtitle="One row per property, export-ready">
                <DeductionTable rows={model.rows} />
                <Link to="/properties" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                  View Property Details
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Panel>
              <div className="space-y-5">
                <Panel title="Depreciation Summary">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">This year deduction</span><span className="font-semibold">{money(model.totals.depreciation)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Mortgage interest</span><span className="font-semibold">{money(model.totals.mortgageInterest)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Property taxes</span><span className="font-semibold">{money(model.totals.propertyTax)}</span></div>
                  </div>
                  <Link to="/properties" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">View Depreciation Schedule <ArrowRight className="h-4 w-4" /></Link>
                </Panel>
                <Panel title="Quick Tax Estimate">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Taxable income</span><span className="font-semibold">{money(model.totals.taxableIncome)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Estimated tax rate</span><span className="font-semibold">{formatFixed(model.assumptions?.effectiveTaxRate || 0, 2)}%</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Estimated liability</span><span className="font-semibold">{money(model.totals.estimatedLiability)}</span></div>
                  </div>
                </Panel>
              </div>
            </div> : null}

            {activeTab === 'Schedule E' ? <ScheduleEReconciliation properties={properties} year={selectedYear} /> : null}
            {activeTab === 'Documents' ? <Panel title="Tax Documents" subtitle="Canonical property documents remain the source of tax values."><Link to="/uploads" className="btn-secondary inline-flex items-center gap-2"><Upload className="h-4 w-4" />Open Documents</Link></Panel> : null}
            {activeTab === 'Estimated Taxes' ? <Panel title="Estimate Status" subtitle="Planning values use the backend tax-rate assumption."><p className="text-sm text-gray-600 dark:text-neutral-300">Estimated liability: <strong>{money(model.totals.estimatedLiability)}</strong> at {formatFixed(model.assumptions?.effectiveTaxRate || 0, 2)}%.</p></Panel> : null}
          </main>

          <aside className="space-y-5">
            <Panel title="Tax Year Overview" action={<span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">On Track</span>}>
              <StatusList count={properties.length} />
            </Panel>
            <Panel title="Tax Planning Opportunities">
              <div className="flex gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"><Sparkles className="h-4 w-4" /></span>
                <div>
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">3 opportunities found</p>
                  <p className="mt-2 text-sm text-gray-500 dark:text-neutral-400">Review depreciation, interest, and property-tax completeness before filing.</p>
                </div>
              </div>
            </Panel>
            <Panel title="Important Dates">
              <div className="space-y-3 text-sm">
                {[
                  ['Q2 Estimated Tax Due', 'Jun 15'],
                  ['Q3 Estimated Tax Due', 'Sep 15'],
                  ['Tax Year End', 'Dec 31'],
                  ['Tax Filing Deadline', 'Apr 15'],
                ].map(([label, date]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="text-gray-600 dark:text-neutral-300">{label}</span>
                    <span className="text-xs text-gray-500">{date}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Tools & Actions">
              <div className="space-y-2">
                {[
                  ['Upload Tax Document', Upload, '/uploads'],
                  ['Download Tax Package', Download, null],
                  ['Open Reports', FileSpreadsheet, '/reports'],
                ].map(([label, Icon, to]) => (
                  to ? (
                    <Link key={label} to={to} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800">
                      <Icon className="h-4 w-4 text-blue-600" /> {label}
                    </Link>
                  ) : (
                    <button key={label} type="button" onClick={exportCSV} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800">
                      <Icon className="h-4 w-4 text-blue-600" /> {label}
                    </button>
                  )
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </PageContainer>
  )
}
