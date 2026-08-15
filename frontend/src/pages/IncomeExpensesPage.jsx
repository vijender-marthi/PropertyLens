import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronRight } from 'lucide-react'
import AuditAlerts from '../components/AuditAlerts'
import { HomeAccentProvider, HomeName } from '../components/HomeLabel'
import PageContainer from '../components/PageContainer'
import { HomeTimeline, PropertyFilter } from '../components/PortfolioEquityDashboard'
import { propAPI } from '../services/api'
import { formatCurrency, formatCurrencyCompact } from '../utils/formatters'

const money = (v) => formatCurrency(v || 0)
// Uniform compact: K/M with 2 decimals for any amount >= $1,000.
const compact = (v) => formatCurrencyCompact(v || 0, { threshold: 1_000, kDigits: 2, mDigits: 2, trim: false })
const num = (v) => (v && typeof v === 'object' ? (v.value ?? 0) : (v ?? 0))
const flowCls = (v) => (v < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')

function Seg({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`rounded-md px-3 py-1.5 text-sm transition ${value === o.value ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:text-gray-900 dark:text-neutral-300'}`}>{o.label}</button>
      ))}
    </div>
  )
}

export default function IncomeExpensesPage() {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [group, setGroup] = useState('property')
  const [period, setPeriod] = useState('mo')
  const [open, setOpen] = useState({})
  const navigate = useNavigate()

  const selectedKey = useMemo(() => Array.from(selectedIds).sort((a, b) => a - b).join(','), [selectedIds])
  const allSelected = available.length > 0 && selectedIds.size === available.length
  const filtered = available.length > 0 && !allSelected && selectedIds.size > 0

  useEffect(() => {
    propAPI.portfolioEquityCashflow({})
      .then((r) => { const a = r.data?.availableProperties || []; setAvailable(a); setSelectedIds(new Set(a.map((p) => p.id))) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const params = { include_primary_residence: false }
    if (filtered) { params.selected_property_ids = selectedKey; params.selection_explicit = true }
    propAPI.portfolioAnalysis(params, { signal: controller.signal })
      .then((r) => setAnalysis(r.data || null))
      .catch((e) => { if (e?.code !== 'ERR_CANCELED') toast.error('Failed to load income and expenses') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [selectedKey, allSelected])

  if (loading && !analysis) {
    return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div></PageContainer>
  }

  const model = analysis?.incomeExpenses || {}
  const kpis = model.kpis || {}
  const rows = model.properties || []
  const yearly = model.yearlySeries || []
  const normById = Object.fromEntries((analysis?.properties || []).map((p) => [p.id, p]))

  // property/kpi values are monthly; yearly series is annual
  const sm = (v) => (period === 'yr' ? v * 12 : v)
  const sa = (v) => (period === 'mo' ? v / 12 : v)
  const unit = period === 'yr' ? '/yr' : '/mo'

  const kIncome = num(kpis.income), kOp = num(kpis.operatingExpenses), kDebt = num(kpis.debtService), kCash = num(kpis.cashFlow)

  const tiles = [
    { k: 'Income', v: money(sm(kIncome)), sub: unit, dot: 'bg-emerald-500' },
    { k: 'Operating expenses', v: money(sm(kOp)), sub: unit, dot: 'bg-amber-500' },
    { k: 'Debt service (P&I)', v: money(sm(kDebt)), sub: unit, dot: 'bg-gray-400' },
    { k: 'Net cash flow', v: money(sm(kCash)), sub: unit, flow: kCash },
  ]

  const totals = rows.reduce((a, r) => ({ income: a.income + num(r.income), op: a.op + num(r.operatingExpenses), debt: a.debt + num(r.debtService), cf: a.cf + num(r.cashFlow) }), { income: 0, op: 0, debt: 0, cf: 0 })

  return (
    <PageContainer className="max-w-[80rem]">
      <HomeAccentProvider available={available}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Income &amp; Expenses</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">What each property earns, what it costs, and what's left — cash flow.</p>
          </div>
          <div className="flex items-center gap-2">
            {available.length > 1 ? <PropertyFilter properties={available} selectedIds={selectedIds} setSelectedIds={setSelectedIds} /> : null}
            <AuditAlerts model={analysis?.taxCenter} onCta={() => navigate('/tax-center')} />
          </div>
        </div>

        {available.length > 1 ? (
          <HomeTimeline rows={available} selectedIds={selectedIds} onSelect={(home, additive) => setSelectedIds((cur) => {
            if (additive) { const n = new Set(cur); if (n.has(home.id)) n.delete(home.id); else n.add(home.id); return n.size ? n : new Set(available.map((p) => p.id)) }
            return cur.size === 1 && cur.has(home.id) ? new Set(available.map((p) => p.id)) : new Set([home.id])
          })} />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2"><span className="text-[11.5px] uppercase tracking-wide text-gray-400">View</span><Seg value={group} onChange={setGroup} options={[{ value: 'property', label: 'By property' }, { value: 'year', label: 'By year' }]} /></div>
          <div className="flex items-center gap-2"><span className="text-[11.5px] uppercase tracking-wide text-gray-400">Period</span><Seg value={period} onChange={setPeriod} options={[{ value: 'mo', label: 'Monthly' }, { value: 'yr', label: 'Annual' }]} /></div>
        </div>

        <div className="grid gap-3 pt-2 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.k} className={`rounded-xl border p-4 shadow-sm ${t.flow != null ? (t.flow < 0 ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20') : 'border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}`}>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400">{t.dot ? <span className={`h-2 w-2 rounded-sm ${t.dot}`} /> : null}{t.k}</div>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${t.flow != null ? flowCls(t.flow) : 'text-gray-950 dark:text-white'}`}>{t.v}<span className="text-sm font-normal text-gray-400"> {t.sub}</span></p>
            </div>
          ))}
        </div>

        {/* BY PROPERTY */}
        {group === 'property' ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-neutral-950"><tr>
                <th className="px-4 py-3 text-left font-medium">Property</th>
                <th className="px-4 py-3 text-right font-medium">Income</th>
                <th className="px-4 py-3 text-right font-medium">Operating</th>
                <th className="px-4 py-3 text-right font-medium">Debt (P&amp;I)</th>
                <th className="px-4 py-3 text-right font-medium">Net cash flow</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {rows.map((r) => {
                  const cf = num(r.cashFlow), isOpen = !!open[r.id]
                  const nm = normById[r.id] || {}
                  const tax = num(nm.property_tax_monthly), ins = num(nm.insurance_monthly)
                  const other = Math.max(num(r.operatingExpenses) - tax - ins, 0)
                  return (
                    <Fragment key={r.id}>
                      <tr className="cursor-pointer border-t border-gray-100 bg-white hover:bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60" onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                        <td className="px-4 py-3"><span className="flex items-center gap-1.5">{isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}<Link to={`/properties/${r.id}/income`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-950 hover:text-emerald-700 dark:text-white dark:hover:text-emerald-400"><HomeName id={r.id} name={r.name} /></Link></span><span className="ml-5 text-[11.5px] text-gray-400">{[r.city, r.state].filter(Boolean).join(', ')}</span></td>
                        <td className="px-4 py-3 text-right">{money(sm(num(r.income)))}</td>
                        <td className="px-4 py-3 text-right">{money(sm(num(r.operatingExpenses)))}</td>
                        <td className="px-4 py-3 text-right">{money(sm(num(r.debtService)))}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${flowCls(cf)}`}>{money(sm(cf))}</td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-gray-50/70 dark:bg-neutral-950/40"><td colSpan={5} className="px-4 py-3">
                          <div className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
                            <div>
                              <p className="mb-1 text-[10.5px] uppercase tracking-wide text-gray-400">Operating expenses {unit}</p>
                              {[['Property tax', tax], ['Insurance', ins], ['Other operating (repairs, mgmt, HOA, utilities)', other]].map(([l, v]) => (
                                <div key={l} className="flex justify-between border-b border-gray-100 py-1 text-[12.5px] dark:border-neutral-800"><span className="text-gray-500 dark:text-neutral-400">{l}</span><span>{v ? money(sm(v)) : '—'}</span></div>
                              ))}
                            </div>
                            <div>
                              <p className="mb-1 text-[10.5px] uppercase tracking-wide text-gray-400">Flow</p>
                              {[['Rental income', num(r.income)], ['− Operating expenses', num(r.operatingExpenses)], ['= NOI (before debt)', num(r.noi)], ['− Debt service', num(r.debtService)]].map(([l, v]) => (
                                <div key={l} className="flex justify-between border-b border-gray-100 py-1 text-[12.5px] dark:border-neutral-800"><span className="text-gray-500 dark:text-neutral-400">{l}</span><span>{money(sm(v))}</span></div>
                              ))}
                              <div className="flex justify-between py-1.5 text-[12.5px]"><span className="font-medium text-gray-900 dark:text-white">= Net cash flow</span><span className={`font-semibold ${flowCls(cf)}`}>{money(sm(cf))}</span></div>
                            </div>
                          </div>
                        </td></tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot><tr className="border-t border-gray-200 bg-gray-50 font-semibold dark:border-neutral-700 dark:bg-neutral-950/50">
                <td className="px-4 py-3 text-left">Portfolio total</td>
                <td className="px-4 py-3 text-right">{money(sm(totals.income))}</td>
                <td className="px-4 py-3 text-right">{money(sm(totals.op))}</td>
                <td className="px-4 py-3 text-right">{money(sm(totals.debt))}</td>
                <td className={`px-4 py-3 text-right ${flowCls(totals.cf)}`}>{money(sm(totals.cf))}</td>
              </tr></tfoot>
            </table>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-neutral-950"><tr>
                <th className="px-4 py-3 text-left font-medium">Tax year</th>
                <th className="px-4 py-3 text-right font-medium">Income</th>
                <th className="px-4 py-3 text-right font-medium">Operating</th>
                <th className="px-4 py-3 text-right font-medium">NOI (before debt)</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {yearly.map((y) => {
                  const noi = num(y.net_operating_income)
                  return (
                    <tr key={y.year} className="border-t border-gray-100 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                      <td className="px-4 py-3 font-medium text-gray-950 dark:text-white">{y.year_label || y.year}</td>
                      <td className="px-4 py-3 text-right">{money(sa(num(y.rental_income)))}</td>
                      <td className="px-4 py-3 text-right">{money(sa(num(y.operating_expenses)))}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${flowCls(noi)}`}>{money(sa(noi))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 pb-4 text-xs text-gray-400">
          {group === 'property'
            ? 'Cash flow = income − operating expenses − mortgage (P&I). Click a property for its expense split and the flow to NOI. Depreciation is a tax deduction, not cash, so it lives in the Tax Center — not here.'
            : 'Portfolio income, expenses, and NOI by year (after-debt cash flow isn’t tracked historically per year — see the By property view for current cash flow). Values shown ' + (period === 'yr' ? 'annually' : 'as a monthly average') + '.'}
        </p>
      </div>
      </HomeAccentProvider>
    </PageContainer>
  )
}
