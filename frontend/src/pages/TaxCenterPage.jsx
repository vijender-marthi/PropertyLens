import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Files,
  History,
  Home,
  Landmark,
  Lightbulb,
  Percent,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Umbrella,
  Upload,
  Wallet,
} from 'lucide-react'

const SCHEDULE_E_LINE_DECOR = {
  rents_received: { Icon: Home, fg: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  mortgage_interest: { Icon: Landmark, fg: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  other_interest: { Icon: Landmark, fg: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  taxes: { Icon: ReceiptText, fg: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  depreciation: { Icon: TrendingDown, fg: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/40' },
  total_expenses: { Icon: Files, fg: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800/60' },
  net_income: { Icon: FileText, fg: 'text-gray-700 dark:text-gray-200', bg: 'bg-gray-100 dark:bg-gray-800/70' },
}
const scheduleELineDecor = (key) => SCHEDULE_E_LINE_DECOR[key] || { Icon: null, fg: 'text-gray-400', bg: 'bg-gray-100 dark:bg-neutral-800' }
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { exportTaxWorkbook } from '../utils/taxExport'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import { formatChartCurrency, formatCurrency, formatCurrencyCompact, formatFixed, formatPercent } from '../utils/formatters'

const TAX_TABS = ['Overview', 'Deduction Summary', 'Schedule E', 'Schedule E Compare', 'Form 8582']

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

const DEDUCTION_COLUMNS = {
  totalDeductions: { header: 'Total deductions', get: (r) => money(r.totalDeductions), className: () => 'font-semibold text-gray-950 dark:text-white' },
  depreciation: { header: 'Depreciation', get: (r) => money(r.depreciation) },
  mortgageInterest: { header: 'Interest', get: (r) => money(r.mortgageInterest) },
  propertyTax: { header: 'Property tax', get: (r) => money(r.propertyTax) },
  operatingExpenses: { header: 'Operating', get: (r) => money(r.operatingExpenses) },
  taxableIncome: { header: 'Taxable income', get: (r) => money(r.taxableIncome), className: (r) => `font-medium ${r.taxableIncome < 0 ? 'text-red-600' : 'text-emerald-600'}` },
}
const ALL_DEDUCTION_COLUMNS = ['totalDeductions', 'depreciation', 'mortgageInterest', 'propertyTax', 'operatingExpenses', 'taxableIncome']

function DeductionTable({ rows, columns = ALL_DEDUCTION_COLUMNS }) {
  const cols = columns.filter((id) => DEDUCTION_COLUMNS[id])
  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-neutral-800">
        <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-3 text-left">Property</th>
            {cols.map((id) => <th key={id} className="px-4 py-3 text-right">{DEDUCTION_COLUMNS[id].header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
          {rows.map((row) => (
            <tr key={row.propertyId}>
              <td className="px-4 py-3">
                <Link to={`/properties/${row.propertyId}/taxes`} className="font-medium text-gray-950 hover:text-blue-700 dark:text-white dark:hover:text-blue-300">{row.propertyName}</Link>
                <p className="text-xs text-gray-400">{row.location || row.sourceLabel}</p>
              </td>
              {cols.map((id) => {
                const col = DEDUCTION_COLUMNS[id]
                const cls = col.className ? col.className(row) : ''
                return <td key={id} className={`px-4 py-3 text-right ${cls}`}>{col.get(row)}</td>
              })}
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

function ScheduleELines({ lines, showCompare = true }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 dark:text-neutral-500">
            <th className="px-3 py-2">Line</th>
            {showCompare ? <th className="px-3 py-2 text-right">Filed (return)</th> : null}
            <th className="px-3 py-2 text-right">PropertyLens</th>
            {showCompare ? <th className="px-3 py-2 text-right">Variance</th> : null}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lines.map((line) => {
            const decor = scheduleELineDecor(line.key)
            const LineIcon = decor.Icon
            return (
            <tr key={line.key} className="border-t border-gray-100 dark:border-neutral-800">
              <td className="px-3 py-2 text-gray-600 dark:text-neutral-300">
                <span className="inline-flex items-center gap-2">
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${decor.bg}`}>
                    {LineIcon ? <LineIcon className={`h-3 w-3 ${decor.fg}`} /> : <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />}
                  </span>
                  <span><span className="text-gray-400">{line.lineNumber}</span> · {line.lineItem}</span>
                </span>
              </td>
              {showCompare ? <td className="px-3 py-2 text-right">{line.filed?.display ?? '—'}</td> : null}
              <td className="px-3 py-2 text-right">{line.computed?.display ?? '—'}</td>
              {showCompare ? (
                <td className={`px-3 py-2 text-right ${!line.filed ? 'text-gray-400 dark:text-neutral-500' : line.status === 'Match' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {!line.filed ? '—' : line.status === 'Match' ? '✓ $0' : (line.delta?.display ?? '—')}
                </td>
              ) : null}
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ScheduleEReconciliation({ properties, year }) {
  const [selYear, setSelYear] = useState(year)
  const [byProp, setByProp] = useState({})
  const [unmatched, setUnmatched] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const probedRef = useRef(false)
  const didMountRef = useRef(false)
  const rentals = useMemo(() => (properties || []).filter((p) => String(p.usage_type || 'Rental').toLowerCase() !== 'primary'), [properties])
  const nowYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 8 }, (_, i) => nowYear - i)

  // Follow the Tax Center's top year selector. On first mount the probe below
  // picks the latest filed year; after that, changing the top year drives the
  // reconciliation directly (no probe override).
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    setSelYear(year)
  }, [year])

  // Only show properties actually owned during the selected tax year — a home
  // bought in 2024 has no 2023 Schedule E, so it's hidden for 2023.
  const ownedRentals = rentals.filter((p) => byProp[p.id]?.ownedInSelectedYear !== false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all(rentals.map((p) => propAPI.scheduleE(p.id, selYear).then((r) => [p.id, r.data]).catch(() => [p.id, null])))
      .then((entries) => { if (!cancelled) setByProp(Object.fromEntries(entries)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rentals, selYear, reloadKey])

  useEffect(() => {
    let cancelled = false
    propAPI.scheduleEUnmatched(selYear).then((r) => { if (!cancelled) setUnmatched(r.data?.entries || []) }).catch(() => { if (!cancelled) setUnmatched([]) })
    return () => { cancelled = true }
  }, [selYear, reloadKey])

  const [debug, setDebug] = useState(null)
  const [showDebug, setShowDebug] = useState(false)
  useEffect(() => {
    let cancelled = false
    propAPI.scheduleEDebug().then((r) => { if (!cancelled) setDebug(r.data) }).catch(() => { if (!cancelled) setDebug(null) })
    return () => { cancelled = true }
  }, [reloadKey])

  const assign = (entryId, propertyId) => {
    if (!propertyId) return
    propAPI.scheduleEAssign(entryId, Number(propertyId))
      .then(() => setReloadKey((k) => k + 1))
      .catch(() => toast.error('Could not assign the filed return.'))
  }

  const ignore = (entryId) => {
    propAPI.scheduleEIgnore(entryId)
      .then(() => { toast.success('Filed row ignored.'); setReloadKey((k) => k + 1) })
      .catch(() => toast.error('Could not ignore the filed row.'))
  }

  const anyFiled = rentals.some((p) => (byProp[p.id]?.summary?.linesFiled || 0) > 0)

  // If nothing is filed for the selected year, probe recent years once and jump
  // to the most recent year that actually has a filed return.
  useEffect(() => {
    if (loading || anyFiled || probedRef.current || rentals.length === 0) return
    probedRef.current = true
    let cancelled = false
    ;(async () => {
      for (const y of yearOptions) {
        if (y === selYear) continue
        try {
          const results = await Promise.all(rentals.map((p) => propAPI.scheduleE(p.id, y).then((r) => r.data?.summary?.linesFiled || 0).catch(() => 0)))
          if (!cancelled && results.some((n) => n > 0)) { setSelYear(y); return }
        } catch { /* ignore */ }
      }
    })()
    return () => { cancelled = true }
  }, [loading, anyFiled, rentals, selYear, yearOptions])

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
    anchor.download = `PropertyLens_Schedule_E_${selYear}.csv`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Schedule E — filed vs. PropertyLens</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-neutral-400">Pick the tax year your filed return covers to reconcile it; export any year to hand to your preparer.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={selYear} onChange={(e) => setSelYear(Number(e.target.value))} aria-label="Tax year"
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" onClick={exportCsv} className="btn-secondary inline-flex items-center gap-2 text-xs px-2.5 py-1.5"><Download className="h-3.5 w-3.5" />Export CSV</button>
          <Link to="/uploads" className="btn-secondary inline-flex items-center gap-2 text-xs px-2.5 py-1.5"><Upload className="h-3.5 w-3.5" />Upload filed return</Link>
        </div>
      </div>

      {!loading && rentals.length > 0 && !anyFiled && unmatched.length === 0 ? (
        <div className="card-sm flex items-start gap-2 border border-amber-200 bg-amber-50 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No filed return found for {selYear}. If you uploaded one, pick the tax year it actually covers (returns are usually a year or two back), or re-upload it under <Link to="/uploads" className="underline">Documents</Link>.</span>
        </div>
      ) : null}

      {unmatched.length > 0 ? (
        <div className="card border border-amber-200 dark:border-amber-900/60">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <AlertTriangle className="h-4 w-4 text-amber-500" />Filed rows not yet linked to a property
          </h4>
          <p className="mb-3 mt-0.5 text-xs text-gray-500 dark:text-neutral-400">These Schedule E rows were read from your return but their address didn&apos;t match a property. <strong>Assign</strong> one to a property to reconcile it, or <strong>Ignore</strong> it to drop a row you don&apos;t track (e.g. a property not in your portfolio).</p>
          <div className="space-y-2">
            {unmatched.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 dark:border-neutral-800">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-800 dark:text-neutral-100">{u.address}</div>
                  <div className="text-xs text-gray-500 dark:text-neutral-400">{u.taxYear} · rents {u.rentsReceived.display} · net {u.netIncome.display}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select defaultValue="" onChange={(e) => assign(u.id, e.target.value)} aria-label={`Assign ${u.address} to a property`}
                    className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                    <option value="" disabled>Assign to property…</option>
                    {rentals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => ignore(u.id)}
                    title="Ignore this filed row — remove it from Schedule E"
                    className="rounded-md border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-500 hover:border-red-300 hover:text-red-600 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-red-800 dark:hover:text-red-400">
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="card py-8 text-center text-sm text-gray-500 dark:text-neutral-400">Loading Schedule E…</div>
      ) : ownedRentals.length === 0 ? (
        <EmptyState text={`No rental properties owned in ${selYear} for Schedule E in this scope.`} />
      ) : (
        ownedRentals.map((p) => {
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
              {open ? <div className="border-t border-gray-100 px-4 py-3 dark:border-neutral-800"><ScheduleELines lines={data?.lines || []} showCompare={selYear < new Date().getFullYear()} /></div> : null}
            </div>
          )
        })
      )}

      <div className="card">
        <button type="button" onClick={() => setShowDebug((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs font-semibold text-gray-500 dark:text-neutral-400">
          <span>Diagnostics — what's actually stored ({debug?.entryCount ?? 0} tax entr{(debug?.entryCount ?? 0) === 1 ? 'y' : 'ies'})</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showDebug ? 'rotate-180' : ''}`} />
        </button>
        {showDebug ? (
          <div className="mt-3 space-y-3 text-xs">
            {!debug || debug.entryCount === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                No Schedule E tax entries are stored in your account at all. That means the <strong>Import</strong> step on the Documents page hasn't successfully saved any rows yet — open a tax return there, expand it, and click Import.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {(debug.byYear || []).map((y) => (
                    <button key={y.year} type="button" onClick={() => setSelYear(y.year)}
                      className={`rounded-full border px-2.5 py-1 font-medium ${y.year === selYear ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-gray-200 text-gray-600 dark:border-neutral-700 dark:text-neutral-300'}`}>
                      {y.year}: {y.total} row{y.total === 1 ? '' : 's'} ({y.matched} linked, {y.unmatched} unmatched)
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse">
                    <thead>
                      <tr className="text-left text-gray-400 dark:text-neutral-500">
                        <th className="py-1 pr-3 font-medium">Year</th>
                        <th className="py-1 pr-3 font-medium">Return address</th>
                        <th className="py-1 pr-3 font-medium">Linked property</th>
                        <th className="py-1 pr-3 text-right font-medium">Rents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(debug.entries || []).map((e) => (
                        <tr key={e.id} className="border-t border-gray-100 dark:border-neutral-800">
                          <td className="py-1 pr-3 tabular-nums">{e.taxYear}</td>
                          <td className="py-1 pr-3 text-gray-600 dark:text-neutral-300">{e.address || '—'}</td>
                          <td className="py-1 pr-3">
                            {e.linkedName
                              ? <span className="text-emerald-600 dark:text-emerald-400">{e.linkedName}</span>
                              : <span className="text-amber-600 dark:text-amber-400">unmatched</span>}
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums">{formatCurrency(e.rentsReceived)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-neutral-500">Click a year chip to jump the reconciliation there. Rows shown as “unmatched” won’t appear per-property until linked — use the mapping dropdowns on the Documents page and re-Import.</p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// eslint-disable-next-line no-unused-vars
function TaxCenterPageLegacy() {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear() - 1)
  const [activeTab, setActiveTab] = useState('Overview')

  const isAllYears = selectedYear === 'all'

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    propAPI.portfolioAnalysis({ tax_year: isAllYears ? undefined : selectedYear, all_years: isAllYears, include_primary_residence: false }, { signal: controller.signal })
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
  const availableYears = model.availableYears?.length ? model.availableYears : (isAllYears ? [] : [selectedYear])
  const yearLabel = isAllYears ? 'All years' : selectedYear
  const showTrend = ['Overview', 'Estimated Taxes', 'History'].includes(activeTab)
  const showCategories = ['Overview', 'Deductions'].includes(activeTab)
  const showTable = ['Overview', 'Deductions', 'Depreciation', 'Property Taxes', 'Tax Reports'].includes(activeTab)
  // Per-tab focus: the Depreciation and Property Taxes tabs show only their own
  // column; the broader tabs show the full deduction breakdown.
  const deductionTableColumns = activeTab === 'Depreciation'
    ? ['depreciation']
    : activeTab === 'Property Taxes'
      ? ['propertyTax']
      : ALL_DEDUCTION_COLUMNS
  const deductionTableTitle = activeTab === 'Depreciation'
    ? 'Depreciation by Property'
    : activeTab === 'Property Taxes'
      ? 'Property Tax by Property'
      : 'Deduction Summary by Property'

  const exportCSV = () => {
    const headers = ['Property', 'Location', 'Tax year', 'Total deductions', 'Depreciation', 'Mortgage interest', 'Property tax', 'Operating expenses', 'Taxable income']
    const lines = [
      headers.join(','),
      ...model.rows.map((row) => [
        row.propertyName,
        row.location,
        yearLabel,
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
    anchor.download = `PropertyLens_Tax_Center_${isAllYears ? 'All_years' : selectedYear}.csv`
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
            <label className="btn-secondary relative inline-flex cursor-pointer items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4" />
              <span>Tax Year</span>
              <span className="font-medium tabular-nums">{yearLabel}</span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
              <select
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={isAllYears ? 'all' : selectedYear}
                onChange={(event) => setSelectedYear(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                aria-label="Tax year"
              >
                <option value="all">All years</option>
                {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <button type="button" onClick={exportCSV} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" />
              Export Tax Report
            </button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard icon={ShieldCheck} label="Estimated Tax Savings" value={compact(model.totals.estimatedSavings)} note="based on deductions" tone="emerald" />
          <KpiCard icon={ReceiptText} label="Total Deductions" value={compact(model.totals.totalDeductions)} note={isAllYears ? 'All years combined' : `Tax year ${selectedYear}`} tone="purple" />
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
            {showTable ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <Panel title={`${deductionTableTitle} (${yearLabel})`} subtitle="One row per property, export-ready">
                <DeductionTable rows={model.rows} columns={deductionTableColumns} />
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

            {showTrend || showCategories ? <div className="grid gap-5 lg:grid-cols-2">
              {showTrend ? (
              <Panel title="Tax Savings Over Time" subtitle="Savings and liability from backend yearly tax rows">
                <SavingsTrend data={model.trend} />
              </Panel>
              ) : null}
              {showCategories ? (
              <Panel title={`Deductions by Category (${yearLabel})`} subtitle="No pie charts; proportional bar breakdown">
                <DeductionBars categories={model.categories} />
              </Panel>
              ) : null}
            </div> : null}

            {activeTab === 'Schedule E' ? <ScheduleEReconciliation properties={properties} year={isAllYears ? (availableYears[0] || (new Date().getFullYear() - 1)) : selectedYear} /> : null}
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

// ============================================================================
// Redesigned Tax Center — 5 tabs, per-tab toolbars, all calculations backend.
// ============================================================================

const mnum = (x) => (x && typeof x === 'object' ? (x.value ?? 0) : (x ?? 0))
const mdisp = (x) => (x && typeof x === 'object' ? (x.display ?? money(x.value)) : money(x))
const heroCompact = (v) => formatCurrencyCompact(v, { threshold: 1_000, kDigits: 1, mDigits: 2 })

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`rounded-md px-3 py-1.5 text-sm transition ${value === opt.value ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:text-gray-900 dark:text-neutral-300'}`}
        >{opt.label}</button>
      ))}
    </div>
  )
}

function Toolbar({ children }) {
  return <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">{children}</div>
}

function Field({ label, children }) {
  return <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-neutral-400">{label}{children}</label>
}

const selectCls = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-normal normal-case text-gray-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
const exportBtnCls = 'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700'

function ExportButton({ onClick, label = 'Export to Excel' }) {
  return <button type="button" onClick={onClick} className={exportBtnCls}><FileSpreadsheet className="h-4 w-4" /> {label}</button>
}

// ---- Hero KPI row -----------------------------------------------------------
function TaxKpis({ totals, assumptions, scopeLabel }) {
  const taxable = totals.taxableIncome || 0
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4 shadow-sm dark:border-emerald-500/70 dark:bg-emerald-950/30">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /><span className="text-xs font-medium uppercase tracking-wide">Estimated tax savings</span></div>
        <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-700 dark:text-emerald-200">{heroCompact(totals.estimatedSavings)}</p>
        <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">deductions × {formatFixed(assumptions?.effectiveTaxRate || 0, 1)}%</p>
      </div>
      <KpiCard icon={ReceiptText} label="Total deductions" value={compact(totals.totalDeductions)} note={scopeLabel} tone="purple" />
      <KpiCard icon={Landmark} label="Depreciation" value={compact(totals.depreciation)} note="non-cash" tone="amber" />
      <KpiCard icon={Percent} label="Mortgage interest" value={compact(totals.mortgageInterest)} note="de-duplicated" tone="blue" />
      <div className={`rounded-xl border p-4 shadow-sm ${taxable < 0 ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30' : 'border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}`}>
        <div className={`flex items-center gap-2 ${taxable < 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-neutral-400'}`}><FileSpreadsheet className="h-5 w-5" /><span className="text-xs font-medium uppercase tracking-wide">Net taxable income</span></div>
        <p className={`mt-2 text-2xl font-semibold tracking-tight ${taxable < 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-950 dark:text-white'}`}>{compact(taxable)}</p>
        <p className={`mt-1 text-xs ${taxable < 0 ? 'text-red-500/80 dark:text-red-300/70' : 'text-gray-500 dark:text-neutral-400'}`}>Schedule E total</p>
      </div>
      <KpiCard icon={Scale} label="Est. tax liability" value={compact(totals.estimatedLiability)} note="rough planning" tone={totals.estimatedLiability > 0 ? 'amber' : 'emerald'} />
    </div>
  )
}

// ---- AI Audit Triggers & Optimization Alerts --------------------------------
function buildTriggers(model) {
  const triggers = []
  const rows = model.rows || []
  const passive = rows.filter((r) => (r.taxableIncome || 0) < 0)
  const passiveTotal = passive.reduce((s, r) => s + (r.taxableIncome || 0), 0)
  const years = model.years || []
  const latest = years.length ? years[years.length - 1] : null
  if (latest != null) {
    for (const p of model.propertyLedger || []) {
      const d = (p.byYear || {})[String(latest)]
      if (!d) continue
      if ((d.propertyTax || 0) === 0) triggers.push({ type: 'warning', title: `Missing property tax — ${p.propertyName}`, body: `No property tax on file for ${latest}. Add the bill to capture the deduction.` })
      if ((d.insurance || 0) === 0) triggers.push({ type: 'warning', title: `Missing insurance — ${p.propertyName}`, body: `No insurance premium on file for ${latest}.` })
    }
  }
  if (passiveTotal < 0) triggers.push({ type: 'optimization', title: 'Passive losses may be suspended', body: `${passive.length} propert${passive.length === 1 ? 'y' : 'ies'} show passive losses totaling ${money(passiveTotal)}. Form 8582 may carry them forward unless you qualify as a real-estate professional.`, cta: 'Review Form 8582' })
  if ((model.totals?.depreciation || 0) > 0) triggers.push({ type: 'optimization', title: 'Depreciation is sheltering income', body: `${money(model.totals.depreciation)} of non-cash depreciation reduces taxable income in this scope.` })
  const warnings = triggers.filter((t) => t.type === 'warning')
  const opts = triggers.filter((t) => t.type !== 'warning')
  return [...warnings, ...opts].slice(0, 6)
}

function AuditTriggersPanel({ model, onGoto }) {
  const triggers = buildTriggers(model)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300"><Sparkles className="h-4 w-4" /></span>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">AI audit triggers &amp; optimization alerts</h2>
        </div>
        <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">{triggers.length} found</span>
      </div>
      {triggers.length === 0 ? <EmptyState text="No audit triggers — deductions look complete for this scope." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {triggers.map((t, i) => {
            const warn = t.type === 'warning'
            const Icon = warn ? AlertTriangle : Lightbulb
            return (
              <div key={i} className={`flex gap-3 rounded-xl border p-3 ${warn ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20' : 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20'}`}>
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${warn ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${warn ? 'bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200' : 'bg-blue-200/70 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200'}`}>{warn ? 'Warning' : 'Optimization'}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-gray-950 dark:text-white">{t.title}</p>
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-neutral-300">{t.body}</p>
                  {t.cta ? <button type="button" onClick={() => onGoto?.('Form 8582')} className="mt-1.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300">{t.cta} →</button> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---- Deduction summary (property or year) -----------------------------------
function DeductionSummary({ model, group, yearLabel, selectedYear }) {
  if (group === 'year') {
    const rows = model.byYear || []
    return (
      <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
        <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-neutral-800">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
            <tr><th className="px-4 py-3 text-left">Tax year</th><th className="px-4 py-3 text-right">Total ded.</th><th className="px-4 py-3 text-right">Depreciation</th><th className="px-4 py-3 text-right">Interest</th><th className="px-4 py-3 text-right">Property tax</th><th className="px-4 py-3 text-right">Operating</th><th className="px-4 py-3 text-right">Taxable inc.</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white tabular-nums dark:divide-neutral-800 dark:bg-neutral-900">
            {rows.map((r) => (
              <tr key={r.year} className={selectedYear !== 'all' && Number(selectedYear) === r.year ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''}>
                <td className="px-4 py-3 font-medium text-gray-950 dark:text-white">{r.year}</td>
                <td className="px-4 py-3 text-right font-semibold">{money(r.totalDeductions)}</td>
                <td className="px-4 py-3 text-right">{money(r.depreciation)}</td>
                <td className="px-4 py-3 text-right">{money(r.mortgageInterest)}</td>
                <td className="px-4 py-3 text-right">{money(r.propertyTax)}</td>
                <td className="px-4 py-3 text-right">{money(r.operatingExpenses)}</td>
                <td className={`px-4 py-3 text-right font-medium ${r.taxableIncome < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(r.taxableIncome)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <DeductionTable rows={model.rows || []} />
}

// ---- Property financials ledger (expandable) --------------------------------
const LEDGER_LINES = [
  ['rentalIncome', 'Rental income', Home],
  ['mortgageInterest', 'Mortgage interest', Landmark],
  ['propertyTax', 'Property tax', ReceiptText],
  ['insurance', 'Insurance', Umbrella],
  ['operatingExpenses', 'Operating', Wallet],
  ['depreciation', 'Depreciation', TrendingDown],
]
function PropertyLedger({ model }) {
  const [open, setOpen] = useState({})
  const years = model.years || []
  const ledger = model.propertyLedger || []
  const rowsById = Object.fromEntries((model.rows || []).map((r) => [r.propertyId, r]))
  if (!ledger.length) return <EmptyState text="No rental property financials for this scope." />
  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
          <tr><th className="px-4 py-3 text-left">Property</th><th className="px-4 py-3 text-right">Property tax</th><th className="px-4 py-3 text-right">Insurance</th><th className="px-4 py-3 text-right">Operating</th><th className="px-4 py-3 text-right">Total ded.</th><th className="px-2 py-3" /></tr>
        </thead>
        <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-neutral-800">
          {ledger.map((p) => {
            const totals = rowsById[p.propertyId] || {}
            const isOpen = !!open[p.propertyId]
            const yearsWithData = years.filter((y) => (p.byYear || {})[String(y)])
            return (
              <Fragment key={p.propertyId}>
                <tr className="cursor-pointer bg-white hover:bg-gray-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/60" onClick={() => setOpen((o) => ({ ...o, [p.propertyId]: !o[p.propertyId] }))}>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 font-medium text-gray-950 dark:text-white">{isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}{p.propertyName}</span>
                    <span className="ml-5 text-xs text-gray-400">{p.location}</span>
                  </td>
                  <td className="px-4 py-3 text-right">{money(totals.propertyTax)}</td>
                  <td className="px-4 py-3 text-right">{money((totals.operatingExpenses != null) ? sumLedger(p, 'insurance') : 0)}</td>
                  <td className="px-4 py-3 text-right">{money(totals.operatingExpenses)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{money(totals.totalDeductions)}</td>
                  <td className="px-2 py-3 text-right text-xs text-gray-400">{yearsWithData.length} yr</td>
                </tr>
                {isOpen ? (
                  <tr className="bg-gray-50/70 dark:bg-neutral-950/40">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                            <tr><th className="py-1 pr-3 text-left">Line</th>{yearsWithData.map((y) => <th key={y} className="py-1 pl-3 text-right">{y}</th>)}</tr>
                          </thead>
                          <tbody className="tabular-nums">
                            {LEDGER_LINES.map(([key, label, Icon]) => (
                              <tr key={key} className="border-t border-gray-100 dark:border-neutral-800">
                                <td className="py-1.5 pr-3 text-gray-600 dark:text-neutral-300"><span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-gray-400" />{label}</span></td>
                                {yearsWithData.map((y) => <td key={y} className="py-1.5 pl-3 text-right text-gray-700 dark:text-neutral-200">{money((p.byYear[String(y)] || {})[key])}</td>)}
                              </tr>
                            ))}
                            <tr className="border-t border-gray-200 dark:border-neutral-700">
                              <td className="py-1.5 pr-3 font-medium text-gray-900 dark:text-white">Net (Sch E)</td>
                              {yearsWithData.map((y) => { const t = (p.byYear[String(y)] || {}).taxableIncome || 0; return <td key={y} className={`py-1.5 pl-3 text-right font-medium ${t < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(t)}</td> })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
function sumLedger(p, key) { return Object.values(p.byYear || {}).reduce((s, d) => s + (d[key] || 0), 0) }

// ---- Property taxes / Insurance matrix widget -------------------------------
function MatrixWidget({ title, kind, icon: Icon, data, years, selectedYear }) {
  const rows = data || []
  const cols = years || []
  const isTax = kind === 'tax'
  const hi = (y) => (selectedYear !== 'all' && Number(selectedYear) === y)
  const tagCls = isTax ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
  const colTotal = (y) => rows.reduce((s, p) => s + ((p.byYear || {})[String(y)] || 0), 0)
  return (
    <Panel title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-gray-400" />{title}</span>} action={<span className={`rounded-full px-2 py-0.5 text-xs ${tagCls}`}>by year</span>} subtitle="Deductible amount per property, per rental year">
      {rows.length === 0 ? <EmptyState text={`No ${title.toLowerCase()} for this scope.`} /> : (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
              <tr><th className="px-3 py-2.5 text-left">Property</th>{cols.map((y) => <th key={y} className={`px-3 py-2.5 text-right ${hi(y) ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{y}</th>)}<th className="px-3 py-2.5 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-neutral-800">
              {rows.map((p) => {
                let total = 0
                return (
                  <tr key={p.propertyId}>
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{p.propertyName}</td>
                    {cols.map((y) => { const v = (p.byYear || {})[String(y)]; if (v != null) total += v; return <td key={y} className={`px-3 py-2 text-right ${hi(y) ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''} ${v == null ? 'text-gray-300 dark:text-neutral-600' : 'text-gray-700 dark:text-neutral-200'}`}>{v == null ? '—' : money(v)}</td> })}
                    <td className="px-3 py-2 text-right font-medium">{money(total)}</td>
                  </tr>
                )
              })}
              <tr className="border-t border-gray-200 bg-gray-50 font-medium dark:border-neutral-700 dark:bg-neutral-950/40">
                <td className="px-3 py-2.5">Total</td>{cols.map((y) => <td key={y} className={`px-3 py-2.5 text-right ${hi(y) ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>{money(colTotal(y))}</td>)}<td className="px-3 py-2.5 text-right">{money(cols.reduce((s, y) => s + colTotal(y), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ---- Single-property chart (modernized) -------------------------------------
function SinglePropertyChart({ model }) {
  const ledger = model.propertyLedger || []
  const [pid, setPid] = useState(ledger[0]?.propertyId)
  useEffect(() => { if (!ledger.find((p) => p.propertyId === pid)) setPid(ledger[0]?.propertyId) }, [ledger, pid])
  const prop = ledger.find((p) => p.propertyId === pid) || ledger[0]
  if (!prop) {
    return <Panel title="Single-property view" subtitle="Deductible interest and depreciation over the rental years"><EmptyState text="No rental property in this scope." /></Panel>
  }
  const years = model.years || []
  const data = years.filter((y) => prop.byYear[String(y)]).map((y) => ({ year: String(y), interest: (prop.byYear[String(y)] || {}).mortgageInterest || 0, depreciation: (prop.byYear[String(y)] || {}).depreciation || 0 }))
  const sum = (k) => data.reduce((s, d) => s + (d[k] || 0), 0)
  const netTotal = years.reduce((s, y) => s + ((prop.byYear[String(y)] || {}).taxableIncome || 0), 0)
  return (
    <Panel title="Single-property view" subtitle="Deductible interest and depreciation over the rental years" action={(
      <select className={selectCls} value={pid} onChange={(e) => setPid(Number(e.target.value))}>
        {ledger.map((p) => <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>)}
      </select>
    )}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-neutral-950/40"><p className="text-xs text-gray-500 dark:text-neutral-400">Rental years</p><p className="mt-1 text-lg font-semibold text-gray-950 dark:text-white">{data.length}</p></div>
        <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30"><p className="text-xs text-blue-700 dark:text-blue-300">Total interest</p><p className="mt-1 text-lg font-semibold text-blue-700 dark:text-blue-200">{compact(sum('interest'))}</p></div>
        <div className="rounded-lg bg-purple-50 p-3 dark:bg-purple-950/30"><p className="text-xs text-purple-700 dark:text-purple-300">Total depreciation</p><p className="mt-1 text-lg font-semibold text-purple-700 dark:text-purple-200">{compact(sum('depreciation'))}</p></div>
        <div className={`rounded-lg p-3 ${netTotal < 0 ? 'bg-red-50 dark:bg-red-950/30' : 'bg-emerald-50 dark:bg-emerald-950/30'}`}><p className={`text-xs ${netTotal < 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>Net (Sch E)</p><p className={`mt-1 text-lg font-semibold ${netTotal < 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-200'}`}>{compact(netTotal)}</p></div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="spInterestFill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} /><stop offset="95%" stopColor={chartColors.primary} stopOpacity={0.03} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
            <XAxis dataKey="year" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={52} />
            <Tooltip formatter={(v, n) => [money(v), n === 'interest' ? 'Mortgage interest' : 'Depreciation']} contentStyle={chartTooltipStyle(false)} />
            <Legend />
            <Area type="monotone" dataKey="interest" name="Mortgage interest" stroke={chartColors.primary} strokeWidth={2.5} fill="url(#spInterestFill)" />
            <Area type="monotone" dataKey="depreciation" name="Depreciation" stroke={chartColors.purple} strokeWidth={2} fill={chartColors.primaryTint} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

// ---- Overview tab -----------------------------------------------------------
function OverviewTab({ model, group, yearLabel, selectedYear, onGoto }) {
  return (
    <div className="space-y-5">
      <AuditTriggersPanel model={model} onGoto={onGoto} />
      <Panel title={`Deduction summary by ${group === 'year' ? 'year' : 'property'} (${yearLabel})`} subtitle="One row per property or year — the year/group toggle drives this">
        <DeductionSummary model={model} group={group} yearLabel={yearLabel} selectedYear={selectedYear} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <MatrixWidget title="Property taxes" kind="tax" icon={ReceiptText} data={model.propertyTaxByYear} years={model.years} selectedYear={selectedYear} />
        <MatrixWidget title="Insurance" kind="insurance" icon={Umbrella} data={model.insuranceByYear} years={model.years} selectedYear={selectedYear} />
      </div>
      <SinglePropertyChart model={model} />
      <Panel title="Property financials ledger" subtitle="Click a property to expand its taxes, insurance, and operating costs over time">
        <PropertyLedger model={model} />
      </Panel>
      <Panel title="Deductions by category" subtitle="Proportional breakdown"><DeductionBars categories={model.categories || []} /></Panel>
    </div>
  )
}

// ---- Schedule E tab ---------------------------------------------------------
function ScheduleETab({ properties }) {
  const rentals = properties.filter((p) => !p.isPrimary && String(p.usageType || 'Rental').toLowerCase() !== 'primary')
  const [scope, setScope] = useState('all')
  const [propId, setPropId] = useState(rentals[0]?.id)
  const nowYear = new Date().getFullYear()
  const [year, setYear] = useState(nowYear - 1)
  const [dataByProp, setDataByProp] = useState({})
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (!rentals.find((p) => p.id === propId)) setPropId(rentals[0]?.id) }, [rentals, propId])
  const targets = scope === 'single' ? rentals.filter((p) => p.id === propId) : rentals
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all(targets.map((p) => propAPI.scheduleE(p.id, year).then((r) => [p.id, r.data]).catch(() => [p.id, null])))
      .then((entries) => { if (active) setDataByProp(Object.fromEntries(entries)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scope, propId, year, properties.length])

  const doExport = () => {
    const sheets = targets.map((p) => {
      const lines = (dataByProp[p.id]?.lines) || []
      return {
        name: `${p.name} ${year}`,
        meta: [['Property', `${p.name}${p.address ? ` · ${p.address}` : ''}`], ['Tax year', String(year)], ['Form', 'Schedule E (Form 1040)']],
        headers: ['Line', 'Description', 'Amount'],
        rows: lines.map((l) => [String(l.lineNumber), l.lineItem, mnum(l.computed)]),
      }
    }).filter((s) => s.rows.length)
    if (!sheets.length) { toast.error('No Schedule E data to export'); return }
    exportTaxWorkbook(scope === 'single' ? `ScheduleE_${targets[0]?.name || 'property'}_${year}` : `ScheduleE_AllProperties_${year}`, sheets)
  }

  return (
    <div>
      <Toolbar>
        <Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'All properties' }, { value: 'single', label: 'Single property' }]} />
        {scope === 'single' ? <select className={selectCls} value={propId} onChange={(e) => setPropId(Number(e.target.value))}>{rentals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : null}
        <Field label="Tax year"><select className={selectCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 8 }, (_, i) => nowYear - i).map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
        <div className="ml-auto"><ExportButton onClick={doExport} /></div>
      </Toolbar>
      {loading && !Object.keys(dataByProp).length ? <EmptyState text="Loading Schedule E…" /> : (
        <div className="space-y-4">
          {targets.map((p) => {
            const lines = (dataByProp[p.id]?.lines) || []
            if (!lines.length) return null
            return (
              <Panel key={p.id} title={p.name} subtitle={`${p.address || ''} · tax year ${year}`}>
                <ScheduleELines lines={lines} showCompare={false} />
              </Panel>
            )
          })}
          {targets.every((p) => !((dataByProp[p.id]?.lines) || []).length) ? <EmptyState text={`No Schedule E entries for ${year} in this scope.`} /> : null}
        </div>
      )}
    </div>
  )
}

// ---- Schedule E compare tab -------------------------------------------------
function ScheduleECompareTab({ properties }) {
  const rentals = properties.filter((p) => !p.isPrimary && String(p.usageType || 'Rental').toLowerCase() !== 'primary')
  const [scope, setScope] = useState('single')
  const [propId, setPropId] = useState(rentals[0]?.id)
  const nowYear = new Date().getFullYear()
  const [year, setYear] = useState(nowYear - 1)
  const [dataByProp, setDataByProp] = useState({})
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (!rentals.find((p) => p.id === propId)) setPropId(rentals[0]?.id) }, [rentals, propId])
  const targets = scope === 'single' ? rentals.filter((p) => p.id === propId) : rentals
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all(targets.map((p) => propAPI.scheduleE(p.id, year).then((r) => [p.id, r.data]).catch(() => [p.id, null])))
      .then((entries) => { if (active) setDataByProp(Object.fromEntries(entries)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scope, propId, year, properties.length])

  const netOf = (lines) => { const l = (lines || []).find((x) => x.key === 'net_income'); return l ? { filed: mnum(l.filed), computed: mnum(l.computed), hasFiled: l.filed != null } : { filed: 0, computed: 0, hasFiled: false } }

  const doExport = () => {
    const sheets = targets.map((p) => {
      const lines = (dataByProp[p.id]?.lines) || []
      return {
        name: `${p.name} ${year}`,
        meta: [['Property', `${p.name}${p.address ? ` · ${p.address}` : ''}`], ['Tax year', String(year)], ['Comparison', 'Filed 1040 vs PropertyLens · comparison only']],
        headers: ['Line', 'Description', 'Filed 1040', 'PropertyLens', 'Difference'],
        rows: lines.map((l) => [String(l.lineNumber), l.lineItem, l.filed != null ? mnum(l.filed) : '—', mnum(l.computed), l.delta != null ? mnum(l.delta) : '—']),
      }
    }).filter((s) => s.rows.length)
    if (!sheets.length) { toast.error('No comparison data to export'); return }
    exportTaxWorkbook(scope === 'single' ? `ScheduleE_Compare_${targets[0]?.name || 'property'}_${year}` : `ScheduleE_Compare_AllProperties_${year}`, sheets)
  }

  return (
    <div>
      <Toolbar>
        <Segmented value={scope} onChange={setScope} options={[{ value: 'single', label: 'Single property' }, { value: 'all', label: 'All properties' }]} />
        {scope === 'single' ? <select className={selectCls} value={propId} onChange={(e) => setPropId(Number(e.target.value))}>{rentals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : null}
        <Field label="Filed year"><select className={selectCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 8 }, (_, i) => nowYear - i).map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => toast('Upload a filed 1040 Schedule E on the Documents page', { icon: '↥' })} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"><Upload className="h-4 w-4" /> Upload filed 1040</button>
          <ExportButton onClick={doExport} />
        </div>
      </Toolbar>
      <p className="mb-3 text-xs text-gray-500 dark:text-neutral-400">Comparison only — filed figures never replace PropertyLens values.</p>
      {loading && !Object.keys(dataByProp).length ? <EmptyState text="Loading comparison…" /> : (
        scope === 'all' ? (
          <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-neutral-800">
              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400"><tr><th className="px-4 py-3 text-left">Property</th><th className="px-4 py-3 text-right">Filed net (L26)</th><th className="px-4 py-3 text-right">PropertyLens net</th><th className="px-4 py-3 text-right">Difference</th><th className="px-4 py-3 text-right">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-neutral-800">
                {rentals.map((p) => { const n = netOf(dataByProp[p.id]?.lines); const d = n.filed - n.computed; return (
                  <tr key={p.id}><td className="px-4 py-3 font-medium text-gray-950 dark:text-white">{p.name}</td>
                    <td className="px-4 py-3 text-right">{n.hasFiled ? money(n.filed) : '—'}</td>
                    <td className="px-4 py-3 text-right">{money(n.computed)}</td>
                    <td className={`px-4 py-3 text-right ${!n.hasFiled ? 'text-gray-400' : Math.abs(d) < 1 ? 'text-emerald-600' : 'text-amber-600'}`}>{n.hasFiled ? money(d) : '—'}</td>
                    <td className="px-4 py-3 text-right">{!n.hasFiled ? <span className="text-xs text-gray-400">No filed return</span> : Math.abs(d) < 1 ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Matches</span> : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Review</span>}</td>
                  </tr>
                ) })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4">
            {targets.map((p) => {
              const lines = (dataByProp[p.id]?.lines) || []
              if (!lines.length) return <EmptyState key={p.id} text={`No Schedule E for ${p.name} in ${year}.`} />
              return <Panel key={p.id} title={p.name} subtitle={`Filed 1040 vs PropertyLens · ${year}`}><ScheduleELines lines={lines} showCompare /></Panel>
            })}
          </div>
        )
      )}
    </div>
  )
}

// ---- Form 8582 tab ----------------------------------------------------------
function Form8582Tab({ selectedPropertyIds }) {
  const nowYear = new Date().getFullYear()
  const [year, setYear] = useState(nowYear - 1)
  const [magi, setMagi] = useState(130000)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    propAPI.form8582({ tax_year: year, magi, ...(selectedPropertyIds ? { selected_property_ids: selectedPropertyIds, selection_explicit: true } : {}) })
      .then((r) => { if (active) setData(r.data) })
      .catch(() => { if (active) toast.error('Failed to load Form 8582') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [year, magi, selectedPropertyIds])

  const doExport = () => {
    if (!data) return
    exportTaxWorkbook(`Form8582_${year}`, [{
      name: `Form 8582 ${year}`,
      meta: [['Form', 'Form 8582 — passive activity loss limitations'], ['Tax year', String(year)], ['MAGI', String(Math.round(magi))], ['Special allowance', String(Math.round(data.specialAllowance))]],
      headers: ['Property', 'Current-year loss', 'Prior unallowed', 'Total loss', 'Allowed', 'Carryforward'],
      rows: (data.rows || []).map((r) => [r.propertyName, r.currentLoss, r.priorUnallowed, r.totalLoss, r.allowed, r.carryforward]),
      total: ['Portfolio total', data.totals.passiveLossThisYear, data.totals.priorCarryforward, data.totals.totalLoss, data.totals.allowedThisYear, data.totals.carryforwardToNext],
    }])
  }

  const availableYears = data?.availableYears?.length ? data.availableYears : [year]
  const t = data?.totals || {}
  const series = (data?.series || []).map((s) => ({ year: String(s.year), carryforward: s.carryforward, allowed: s.allowed }))
  return (
    <div>
      <Toolbar>
        <Field label="Tax year"><select className={selectCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>{availableYears.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
        <Field label="MAGI"><input type="number" step="1000" className={`${selectCls} w-32`} value={magi} onChange={(e) => setMagi(Number(e.target.value) || 0)} /></Field>
        <div className="ml-auto"><ExportButton onClick={doExport} /></div>
      </Toolbar>
      {loading && !data ? <EmptyState text="Loading Form 8582…" /> : !data ? <EmptyState text="No passive activity data." /> : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={TrendingDown} label="Passive loss this year" value={compact(t.passiveLossThisYear)} note={`tax year ${data.taxYear}`} tone="red" />
            <KpiCard icon={History} label="Prior-year carryforward" value={compact(t.priorCarryforward)} note="suspended" tone="amber" />
            <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4 shadow-sm dark:border-emerald-500/70 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-5 w-5" /><span className="text-xs font-medium uppercase tracking-wide">Allowed this year</span></div>
              <p className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-200">{compact(t.allowedThisYear)}</p>
              <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">special allowance {money(data.specialAllowance)}</p>
            </div>
            <KpiCard icon={ArrowRight} label="Carryforward to next year" value={compact(t.carryforwardToNext)} note="suspended losses" tone="purple" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Panel title="Passive loss by property" subtitle={`Allocated against the ${money(data.specialAllowance)} special allowance`}>
              <div className="overflow-auto rounded-lg border border-gray-200 dark:border-neutral-800">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-neutral-800">
                  <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400"><tr><th className="px-4 py-3 text-left">Property</th><th className="px-4 py-3 text-right">Current loss</th><th className="px-4 py-3 text-right">Prior unallowed</th><th className="px-4 py-3 text-right">Total loss</th><th className="px-4 py-3 text-right">Allowed</th><th className="px-4 py-3 text-right">Carryforward</th></tr></thead>
                  <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-neutral-800">
                    {(data.rows || []).map((r) => (
                      <tr key={r.propertyId}><td className="px-4 py-3"><span className="font-medium text-gray-950 dark:text-white">{r.propertyName}</span>{r.rentalMonths < 12 ? <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{r.rentalMonths} mo</span> : null}</td>
                        <td className="px-4 py-3 text-right text-red-600">{money(r.currentLoss)}</td><td className="px-4 py-3 text-right text-red-600">{money(r.priorUnallowed)}</td><td className="px-4 py-3 text-right text-red-600">{money(r.totalLoss)}</td>
                        <td className="px-4 py-3 text-right text-emerald-600">{money(r.allowed)}</td><td className="px-4 py-3 text-right text-red-600">{money(r.carryforward)}</td></tr>
                    ))}
                    <tr className="border-t border-gray-200 bg-gray-50 font-medium dark:border-neutral-700 dark:bg-neutral-950/40"><td className="px-4 py-3">Portfolio total</td><td className="px-4 py-3 text-right text-red-600">{money(t.passiveLossThisYear)}</td><td className="px-4 py-3 text-right text-red-600">{money(t.priorCarryforward)}</td><td className="px-4 py-3 text-right text-red-600">{money(t.totalLoss)}</td><td className="px-4 py-3 text-right text-emerald-600">{money(t.allowedThisYear)}</td><td className="px-4 py-3 text-right text-red-600">{money(t.carryforwardToNext)}</td></tr>
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="8582 worksheet" subtitle="Parts I–II">
              <div className="space-y-2 text-sm">
                {[['1a Net income (passive)', money(0)], ['1b Net loss (passive)', money(t.passiveLossThisYear)], ['1c Prior unallowed', money(t.priorCarryforward)], ['1d Combine', money(t.totalLoss)], ['Special allowance cap', money(25000)], ['MAGI phaseout', magi > 100000 ? money(-Math.min(25000, (magi - 100000) * 0.5)) : money(0)], ['Line 10 · special allowance', money(data.specialAllowance)], ['Allowed loss', money(t.allowedThisYear)], ['Unallowed → carryforward', money(t.carryforwardToNext)]].map(([k, v], i) => (
                  <div key={i} className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-0 dark:border-neutral-800"><span className="text-gray-500 dark:text-neutral-400">{k}</span><span className="font-medium tabular-nums text-gray-950 dark:text-white">{v}</span></div>
                ))}
              </div>
            </Panel>
          </div>
          <Panel title="Carryforward — year over year" subtitle="Roll-forward of suspended losses against the special allowance">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
                  <XAxis dataKey="year" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v, n) => [money(v), n === 'carryforward' ? 'Carryforward balance' : 'Allowed that year']} contentStyle={chartTooltipStyle(false)} />
                  <ReferenceLine y={0} stroke={chartColors.neutral} />
                  <Legend />
                  <Bar dataKey="carryforward" name="Carryforward balance" fill={chartColors.dangerStrong || chartColors.warningStrong} radius={[0, 0, 4, 4]} />
                  <Line type="monotone" dataKey="allowed" name="Allowed that year" stroke={chartColors.positive} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <p className="text-xs text-gray-500 dark:text-neutral-400">{data.assumptions?.label || 'Planning estimate'} — the $25,000 special allowance drops 50% of MAGI over $100,000 and is gone at $150,000. Rental-period and partial-year aware. Planning only.</p>
        </div>
      )}
    </div>
  )
}

// ---- Page orchestrator ------------------------------------------------------
export default function TaxCenterPage() {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Overview')
  const [year, setYear] = useState('all')
  const [group, setGroup] = useState('property')
  const isAll = year === 'all'

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    propAPI.portfolioAnalysis({ tax_year: isAll ? undefined : year, all_years: isAll, include_primary_residence: false }, { signal: controller.signal })
      .then((r) => setAnalysis(r.data || null))
      .catch((e) => { if (e?.code !== 'ERR_CANCELED') toast.error('Failed to load tax center') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [year])

  const model = analysis?.taxCenter || { rows: [], byYear: [], propertyLedger: [], totals: {}, categories: [], trend: [], assumptions: {}, years: [], availableYears: [] }
  const properties = analysis?.properties || []
  const availableYears = model.availableYears?.length ? model.availableYears : []
  const yearLabel = isAll ? 'All years' : year
  const showGlobalBar = tab === 'Overview' || tab === 'Deduction Summary'

  if (loading && !analysis) {
    return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div></PageContainer>
  }

  return (
    <PageContainer className="max-w-[112rem]">
      <div className="space-y-5">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Tax Center</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Every deduction, by year and by property — with the lifetime picture in one place.</p>
          </div>
        </header>

        {tab === 'Overview' ? <TaxKpis totals={model.totals} assumptions={model.assumptions} scopeLabel={isAll ? 'Lifetime · all years' : `Tax year ${year}`} /> : null}

        <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-neutral-800" aria-label="Tax center views">
          {TAX_TABS.map((name) => (
            <button key={name} type="button" onClick={() => setTab(name)} className={`min-w-max border-b-2 px-4 py-3 text-sm font-medium ${tab === name ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-100'}`}>{name}</button>
          ))}
        </nav>

        {showGlobalBar ? (
          <Toolbar>
            <Field label="Tax year"><select className={selectCls} value={isAll ? 'all' : year} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">All years</option>{availableYears.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
            <Field label="Group by"><Segmented value={group} onChange={setGroup} options={[{ value: 'property', label: 'Property' }, { value: 'year', label: 'Year' }]} /></Field>
            <span className="ml-auto text-xs text-gray-500 dark:text-neutral-400">Showing {isAll ? 'all years combined' : `tax year ${year}`} · {properties.filter((p) => !p.isPrimary).length} rentals</span>
          </Toolbar>
        ) : null}

        {tab === 'Overview' ? <OverviewTab model={model} group={group} yearLabel={yearLabel} selectedYear={year} onGoto={setTab} /> : null}
        {tab === 'Deduction Summary' ? (
          <Panel title={`Deduction summary by ${group === 'year' ? 'year' : 'property'} (${yearLabel})`} subtitle="Export-ready, one row per property or year">
            <DeductionSummary model={model} group={group} yearLabel={yearLabel} selectedYear={year} />
          </Panel>
        ) : null}
        {tab === 'Schedule E' ? <ScheduleETab properties={properties} /> : null}
        {tab === 'Schedule E Compare' ? <ScheduleECompareTab properties={properties} /> : null}
        {tab === 'Form 8582' ? <Form8582Tab selectedPropertyIds={null} /> : null}
      </div>
    </PageContainer>
  )
}
