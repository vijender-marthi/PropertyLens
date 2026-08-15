import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowDownToLine, Building2, Home, RefreshCw, Star, TrendingDown } from 'lucide-react'
import AuditAlerts from '../components/AuditAlerts'
import PageContainer from '../components/PageContainer'
import { HomeTimeline, PropertyFilter } from '../components/PortfolioEquityDashboard'
import { propAPI } from '../services/api'
import { formatCurrency, formatCurrencyCompact, formatFixed } from '../utils/formatters'

const money = (v) => formatCurrency(v || 0)
const compact = (v) => formatCurrencyCompact(v || 0, { threshold: 1_000, kDigits: 2, mDigits: 2, trim: false })
const num = (v) => (v && typeof v === 'object' ? (v.value ?? 0) : (v ?? 0))
const APPRECIATION = 0.06 // the app's standard 6%/yr market-value assumption

const HOME_TONE = ['text-blue-500', 'text-teal-500', 'text-indigo-500', 'text-fuchsia-500', 'text-cyan-500', 'text-rose-500']
const RETURN_PARTS = [
  { key: 'cf', label: 'Cash flow', bg: 'bg-emerald-500', sw: 'bg-emerald-500' },
  { key: 'pay', label: 'Principal paydown', bg: 'bg-blue-500', sw: 'bg-blue-500' },
  { key: 'apr', label: 'Appreciation', bg: 'bg-violet-500', sw: 'bg-violet-500' },
  { key: 'tax', label: 'Tax savings', bg: 'bg-amber-500', sw: 'bg-amber-500' },
]

function BandHead({ tag, title }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">{tag}</span>
      <h2 className="text-lg font-medium tracking-tight text-gray-950 dark:text-white">{title}</h2>
      <span className="h-px flex-1 self-center bg-gray-200 dark:bg-neutral-800" />
    </div>
  )
}
const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>{children}</div>
)

export default function AnalyticsPage() {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [sortKey, setSortKey] = useState('roe')
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
      .catch((e) => { if (e?.code !== 'ERR_CANCELED') toast.error('Failed to load analytics') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [selectedKey, allSelected])

  const accentById = useMemo(() => Object.fromEntries(available.map((p) => [p.id, p.accentIndex ?? 0])), [available])
  const primaryById = useMemo(() => Object.fromEntries(available.map((p) => [p.id, p.isPrimary || String(p.type || '').toLowerCase() === 'primary'])), [available])

  if (loading && !analysis) {
    return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" /></div></PageContainer>
  }

  const analytics = analysis?.analytics || {}
  const perf = analytics.propertyPerformance || []
  const taxRate = num(analysis?.taxCenter?.assumptions?.effectiveTaxRate) || 18.7
  const taxByProp = Object.fromEntries((analysis?.taxCenter?.rows || []).map((r) => [r.propertyId, r.totalDeductions]))
  const paydownByProp = {}
  ;(analysis?.loans?.allRows || []).forEach((l) => { if (l.status === 'Active') paydownByProp[l.propertyId] = (paydownByProp[l.propertyId] || 0) + num(l.principalYtd) })

  const rows = perf.map((p) => {
    const cf = num(p.cashFlow) * 12
    const pay = paydownByProp[p.id] || 0
    const apr = num(p.marketValue) * APPRECIATION
    const tax = (taxByProp[p.id] || 0) * taxRate / 100
    const total = cf + pay + apr + tax
    const equity = num(p.equity)
    return { id: p.id, name: p.label, equity, marketValue: num(p.marketValue), coc: num(p.cashOnCash), cap: num(p.capRate), cf, pay, apr, tax, total, roe: equity > 0 ? (total / equity) * 100 : 0 }
  })

  const T = rows.reduce((a, r) => ({ cf: a.cf + r.cf, pay: a.pay + r.pay, apr: a.apr + r.apr, tax: a.tax + r.tax, equity: a.equity + r.equity }), { cf: 0, pay: 0, apr: 0, tax: 0, equity: 0 })
  const totalReturn = T.cf + T.pay + T.apr + T.tax
  const roe = T.equity > 0 ? (totalReturn / T.equity) * 100 : 0
  const parts = { cf: T.cf, pay: T.pay, apr: T.apr, tax: T.tax }
  const posSum = RETURN_PARTS.reduce((s, p) => s + Math.max(parts[p.key], 0), 0) || 1

  const HomeLabel = ({ id, name }) => {
    const Icon = primaryById[id] ? Home : Building2
    return <span className="inline-flex items-center gap-1.5"><Icon className={`h-3.5 w-3.5 ${HOME_TONE[(accentById[id] ?? 0) % HOME_TONE.length]}`} />{name}</span>
  }

  const sorted = [...rows].sort((a, b) => (sortKey === 'name' ? a.name.localeCompare(b.name) : b[sortKey] - a[sortKey]))
  const rankByRoe = [...rows].sort((a, b) => b.roe - a.roe).map((r) => r.id)

  // opportunities
  const loanRows = (analysis?.loans?.allRows || []).filter((l) => l.status === 'Active' && num(l.balance) > 0)
  const refi = loanRows.filter((l) => num(l.rate) > 6).map((l) => ({ l, save: num(l.balance) * (num(l.rate) - 6.5) / 100 })).sort((a, b) => b.save - a.save)[0]
  const worst = [...rows].sort((a, b) => a.cf - b.cf)[0]
  const best = [...rows].sort((a, b) => b.coc - a.coc)[0]

  return (
    <PageContainer className="max-w-[80rem]">
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Analytics</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Not what your portfolio is — what it's actually earning, and what to do next.</p>
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

        {/* REAL RETURN */}
        <section className="pt-4">
          <BandHead tag="Real return" title="What you actually made this year" />
          <Card>
            <div className="flex flex-wrap items-end gap-8">
              <div><p className={`text-4xl font-semibold tabular-nums ${totalReturn < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{compact(totalReturn)}</p><p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">on {compact(T.equity)} of equity</p></div>
              <div className="text-sm text-gray-500 dark:text-neutral-400">Return on equity<br /><b className="text-2xl font-semibold text-violet-600 dark:text-violet-400">{formatFixed(roe, 1)}%</b></div>
              <p className="max-w-sm text-xs text-gray-400">Cash flow is roughly break-even — appreciation, loan paydown, and tax savings do the real work. The number no other page shows you.</p>
            </div>
            <div className="mt-4 flex h-6 overflow-hidden rounded-lg border border-gray-100 dark:border-neutral-800">
              {RETURN_PARTS.map((p) => <div key={p.key} className={`h-full ${p.bg}`} style={{ width: `${Math.max(parts[p.key], 0) / posSum * 100}%` }} title={p.label} />)}
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {RETURN_PARTS.map((p) => (
                <div key={p.key}>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400"><span className={`h-2.5 w-2.5 rounded-sm ${p.sw}`} />{p.label}</div>
                  <div className={`mt-1 text-lg font-semibold tabular-nums ${parts[p.key] < 0 ? 'text-red-600' : 'text-gray-950 dark:text-white'}`}>{compact(parts[p.key])}</div>
                  <div className="text-[11.5px] text-gray-400">{totalReturn ? Math.round(parts[p.key] / totalReturn * 100) : 0}% of return</div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* SCORECARD */}
        <section className="pt-6">
          <BandHead tag="Scorecard" title="Which property is pulling its weight" />
          <Card className="!p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-400"><tr>
                  <th className="px-4 py-3" />
                  <th className="cursor-pointer px-4 py-3 text-left font-medium" onClick={() => setSortKey('name')}>Property</th>
                  <th className="cursor-pointer px-4 py-3 text-right font-medium" onClick={() => setSortKey('equity')}>Equity</th>
                  <th className="cursor-pointer px-4 py-3 text-right font-medium" onClick={() => setSortKey('coc')}>Cash-on-cash</th>
                  <th className="cursor-pointer px-4 py-3 text-right font-medium" onClick={() => setSortKey('cap')}>Cap rate</th>
                  <th className="cursor-pointer px-4 py-3 text-right font-medium" onClick={() => setSortKey('total')}>Total return</th>
                  <th className={`cursor-pointer px-4 py-3 text-right font-medium ${sortKey === 'roe' ? 'text-violet-600 dark:text-violet-400' : ''}`} onClick={() => setSortKey('roe')}>ROE</th>
                </tr></thead>
                <tbody className="tabular-nums">
                  {sorted.map((r) => {
                    const rank = rankByRoe.indexOf(r.id) + 1
                    return (
                      <tr key={r.id} className="border-t border-gray-100 dark:border-neutral-800">
                        <td className="px-4 py-3"><span className={`inline-grid h-6 w-6 place-items-center rounded-full text-[11.5px] font-semibold ${rank === 1 ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-neutral-300'}`}>{rank}</span></td>
                        <td className="px-4 py-3"><Link to={`/properties/${r.id}`} className="font-medium text-gray-950 hover:text-violet-600 dark:text-white dark:hover:text-violet-400"><HomeLabel id={r.id} name={r.name} /></Link></td>
                        <td className="px-4 py-3 text-right">{compact(r.equity)}</td>
                        <td className={`px-4 py-3 text-right ${r.coc < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatFixed(r.coc, 1)}%</td>
                        <td className="px-4 py-3 text-right">{formatFixed(r.cap, 1)}%</td>
                        <td className="px-4 py-3 text-right">{compact(r.total)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-violet-600 dark:text-violet-400">{formatFixed(r.roe, 1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* OPPORTUNITIES */}
        <section className="pt-6 pb-4">
          <BandHead tag="Opportunities" title="Ranked by dollar impact" />
          <div className="grid gap-3 md:grid-cols-2">
            {refi ? (
              <Op icon={RefreshCw} tone="blue" title={`Refinance ${refi.l.propertyName} (${num(refi.l.rate).toFixed(2)}% → 6.5%)`} body={`Highest rate in the portfolio. Refinancing the ${compact(num(refi.l.balance))} balance would cut interest materially.`} impact={`~${compact(refi.save)}/yr saved`} />
            ) : null}
            {refi ? (
              <Op icon={ArrowDownToLine} tone="violet" title={`Send extra principal to ${refi.l.propertyName}`} body="Highest rate = best debt-avalanche target. Extra principal here retires it years early and saves the most interest." impact="best interest ROI" />
            ) : null}
            {worst && worst.cf < 0 ? (
              <Op icon={TrendingDown} tone="rose" title={`${worst.name} bleeds ${compact(-worst.cf)}/yr`} body="Biggest cash-flow drag. Check rent vs. market and the expense ratio — a small rent bump can flip it positive." impact={`${compact(-worst.cf)}/yr to fix`} />
            ) : null}
            {best ? (
              <Op icon={Star} tone="emerald" title={`${best.name} is your cash workhorse`} body={`Best cash-on-cash at ${formatFixed(best.coc, 1)}%. If you buy again, buy more like this one.`} impact={`${formatFixed(best.coc, 1)}% cash-on-cash`} />
            ) : null}
          </div>
          <p className="mt-4 text-xs text-gray-400">Estimates. Appreciation uses the app's 6%/yr assumption; refinance assumes a 6.5% market rate; tax savings use the {formatFixed(taxRate, 1)}% planning rate. Real return = cash flow + principal paydown + appreciation + tax savings.</p>
        </section>
      </div>
    </PageContainer>
  )
}

const OP_TONE = {
  blue: { bl: 'border-l-blue-500', ic: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  violet: { bl: 'border-l-violet-500', ic: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  rose: { bl: 'border-l-rose-500', ic: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  emerald: { bl: 'border-l-emerald-500', ic: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
}
function Op({ icon: Icon, tone, title, body, impact }) {
  const t = OP_TONE[tone] || OP_TONE.blue
  return (
    <div className={`flex gap-3 rounded-xl border border-l-[3px] border-gray-200 p-4 dark:border-neutral-800 ${t.bl}`}>
      <span className={`grid h-8 w-8 flex-none place-items-center rounded-lg ${t.ic}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-950 dark:text-white">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-gray-600 dark:text-neutral-300">{body}</p>
        <p className="mt-2 font-mono text-sm font-semibold text-gray-900 dark:text-white">{impact}</p>
      </div>
    </div>
  )
}
