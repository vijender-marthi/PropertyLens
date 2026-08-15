import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Home, Info } from 'lucide-react'
import AuditAlerts from '../components/AuditAlerts'
import PageContainer from '../components/PageContainer'
import { HomeTimeline, PropertyFilter } from '../components/PortfolioEquityDashboard'
import { propAPI } from '../services/api'
import { formatCurrency, formatCurrencyCompact } from '../utils/formatters'

const money = (v) => formatCurrency(v || 0)
// Uniform compact: K/M with 2 decimals for any amount >= $1,000 ($49.65K, $491.00K, $2.00M).
const compact = (v) => formatCurrencyCompact(v || 0, { threshold: 1_000, kDigits: 2, mDigits: 2, trim: false })
const num = (v) => (v && typeof v === 'object' ? (v.value ?? 0) : (v ?? 0))
const metric = (kpis, key) => num(kpis?.[key])
const label = (kpis, key, fallback) => kpis?.[key]?.label || fallback

const HOME_TEXT = ['text-blue-500', 'text-teal-500', 'text-indigo-500', 'text-fuchsia-500', 'text-cyan-500', 'text-rose-500']
const HOME_BG = ['bg-blue-500', 'bg-teal-500', 'bg-indigo-500', 'bg-fuchsia-500', 'bg-cyan-500', 'bg-rose-500']

const KIND = {
  fixed: { label: 'Fixed', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  arm: { label: 'ARM', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  balloon: { label: 'Balloon', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
}
const kindOf = (r) => KIND[r.loanKind] || KIND.fixed

function BandHead({ tense, title }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">{tense}</span>
      <h2 className="text-lg font-medium tracking-tight text-gray-950 dark:text-white">{title}</h2>
      <span className="h-px flex-1 self-center bg-gray-200 dark:bg-neutral-800" />
    </div>
  )
}
const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>{children}</div>
)

function monthsUntil(iso) {
  if (!iso) return null
  const d = new Date(String(iso).slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
}

export default function LoansPage() {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState(null)
  const [available, setAvailable] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
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
    const params = { include_primary_residence: true, loan_status: 'Active' }
    if (filtered) { params.selected_property_ids = selectedKey; params.selection_explicit = true }
    propAPI.portfolioAnalysis(params, { signal: controller.signal })
      .then((r) => setAnalysis(r.data || null))
      .catch((e) => { if (e?.code !== 'ERR_CANCELED') toast.error('Failed to load loans') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [selectedKey, allSelected])

  if (loading && !analysis) {
    return <PageContainer><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" /></div></PageContainer>
  }

  const kpis = analysis?.loans?.kpis || {}
  const rows = (analysis?.loans?.allRows || []).filter((r) => r.status === 'Active' && num(r.balance) > 0)

  const balance = metric(kpis, 'totalBalance')
  const monthlyPI = metric(kpis, 'monthlyPI')
  const weightedRate = metric(kpis, 'weightedRate')
  const interestToDate = metric(kpis, 'interestToDate')
  const principalPaid = rows.reduce((s, r) => s + num(r.principalPaid), 0)
  const originalTotal = rows.reduce((s, r) => s + num(r.original), 0)

  // DSCR from income model when available
  const annualNoi = num(analysis?.incomeExpenses?.kpis?.noi)
  const dscr = monthlyPI > 0 && annualNoi > 0 ? annualNoi / (monthlyPI * 12) : null

  const accentById = Object.fromEntries(available.map((p) => [p.id, p.accentIndex ?? 0]))
  const primaryById = Object.fromEntries(available.map((p) => [p.id, p.isPrimary || String(p.type || '').toLowerCase() === 'primary']))
  const HomeLabel = ({ id, name }) => {
    const Icon = primaryById[id] ? Home : Building2
    return <span className="inline-flex items-center gap-1.5"><Icon className={`h-3.5 w-3.5 ${HOME_TEXT[(accentById[id] ?? 0) % HOME_TEXT.length]}`} />{name}</span>
  }

  const arms = rows.filter((r) => r.isArm)
  const balloons = rows.filter((r) => r.isBalloon)
  const nextPayoff = rows.map((r) => r.payoffYear).filter(Boolean).sort((a, b) => a - b)[0]

  // Near-term events (next 36 months): ARM resets, balloons
  const events = []
  arms.forEach((r) => { const m = monthsUntil(r.armResetDate); if (m != null && m <= 36 && m >= -1) events.push({ kind: 'reset', name: r.propertyName, months: m, detail: `${num(r.rate).toFixed(2)}% can adjust${r.armIndex ? ` (${r.armIndex})` : ''}`, when: r.armResetDate }) })
  balloons.forEach((r) => { const m = monthsUntil(r.maturityDate); if (m != null && m <= 36) events.push({ kind: 'balloon', name: r.propertyName, months: m, detail: `${money(num(r.balance))} principal comes due`, when: r.maturityDisplay || r.maturityDate }) })
  events.sort((a, b) => a.months - b.months)
  const soonEvent = events.find((e) => e.months <= 6)

  const progressRows = [...rows].sort((a, b) => num(b.paidPercent) - num(a.paidPercent))

  return (
    <PageContainer className="max-w-[80rem]">
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-1">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Loans</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Your debt as a story — what happened, what's going on, and what's coming.</p>
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

        {/* PAST */}
        <section className="pt-4">
          <BandHead tense="Past" title="What happened" />
          <Card>
            <div className="grid gap-x-10 gap-y-5 lg:grid-cols-[1.35fr_1fr] lg:items-center">
              <p className="text-[17px] leading-relaxed text-gray-800 dark:text-neutral-200">
                You've borrowed <b className="font-semibold">{compact(originalTotal)}</b>, paid it down by <b className="font-semibold">{compact(principalPaid)}</b>, and paid <b className="font-semibold">{compact(interestToDate)}</b> in interest along the way — the real cost of the leverage.
              </p>
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-gray-500 dark:text-neutral-400"><span>Original borrowed → today</span><span className="tabular-nums">{compact(originalTotal)}</span></div>
                <div className="flex h-3.5 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="h-full bg-emerald-500" style={{ width: `${originalTotal ? (principalPaid / originalTotal) * 100 : 0}%` }} />
                  <div className="h-full bg-indigo-500" style={{ width: `${originalTotal ? (balance / originalTotal) * 100 : 0}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-gray-600 dark:text-neutral-300 sm:grid-cols-3 lg:grid-cols-1">
                  <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />Principal paid · <span className="tabular-nums">{compact(principalPaid)}</span></span>
                  <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-indigo-500" />Still owed · <span className="tabular-nums">{compact(balance)}</span></span>
                  <span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />Interest paid to date · <span className="tabular-nums">{compact(interestToDate)}</span></span>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* PRESENT */}
        <section className="pt-6">
          <BandHead tense="Present" title="What's going on" />
          <div className="grid gap-4 lg:grid-cols-[1fr_1.9fr]">
            <Card>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-gray-50 p-3.5 dark:bg-neutral-950/50"><p className="text-xs text-gray-500 dark:text-neutral-400">{label(kpis, 'totalBalance', 'Total loan balance')}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-white">{compact(balance)}</p></div>
                <div className="rounded-xl bg-gray-50 p-3.5 dark:bg-neutral-950/50"><p className="text-xs text-gray-500 dark:text-neutral-400">{label(kpis, 'weightedRate', 'Weighted average interest rate')}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-white">{weightedRate.toFixed(2)}%</p></div>
                <div className="col-span-2 rounded-xl bg-gray-50 p-3.5 dark:bg-neutral-950/50"><p className="text-xs text-gray-500 dark:text-neutral-400">{label(kpis, 'monthlyPI', 'Total monthly P&I')}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-white">{money(monthlyPI)}<span className="text-sm font-normal text-gray-400"> /mo</span></p></div>
              </div>
              {dscr != null ? (
                <div className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${dscr >= 1.2 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                  <span className={`h-2 w-2 rounded-full ${dscr >= 1.2 ? 'bg-emerald-500' : 'bg-amber-500'}`} />Rent covers debt {dscr.toFixed(2)}× · {dscr >= 1.2 ? 'healthy' : 'tight'}
                </div>
              ) : (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600 dark:bg-neutral-800 dark:text-neutral-300"><span className="h-2 w-2 rounded-full bg-gray-400" />{rows.length} active loan{rows.length === 1 ? '' : 's'}</div>
              )}
            </Card>
            <Card>
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase tracking-wide text-gray-400"><th className="pb-2.5 text-left font-medium">Loan</th><th className="pb-2.5 text-right font-medium">Rate</th><th className="pb-2.5 text-right font-medium">Balance</th><th className="pb-2.5 text-right font-medium">Monthly</th></tr></thead>
                <tbody className="tabular-nums">
                  {progressRows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100 dark:border-neutral-800">
                      <td className="py-2.5"><Link to={`/properties/${r.propertyId}/loans`} className="font-medium text-gray-950 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"><HomeLabel id={r.propertyId} name={r.propertyName} /></Link> <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${kindOf(r).cls}`}>{kindOf(r).label}</span><div className="ml-5 text-[11.5px] text-gray-400">{r.lender} · matures {r.payoffYear || '—'}</div></td>
                      <td className="py-2.5 text-right">{num(r.rate).toFixed(2)}%</td>
                      <td className="py-2.5 text-right">{money(num(r.balance))}</td>
                      <td className="py-2.5 text-right">{money(num(r.monthlyPI))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </section>

        {/* PROGRESS */}
        <section className="pt-6">
          <BandHead tense="Progress" title="How much you've paid off" />
          <Card>
            <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
              {progressRows.map((r) => {
                const pct = Math.round(num(r.paidPercent))
                const bg = HOME_BG[(accentById[r.propertyId] ?? 0) % HOME_BG.length]
                return (
                  <div key={r.id}>
                    <div className="mb-1.5 flex items-baseline justify-between"><span className="text-sm font-medium text-gray-900 dark:text-white"><HomeLabel id={r.propertyId} name={r.propertyName} /></span><span className="text-[11.5px] tabular-nums text-gray-400">payoff {r.payoffYear || '—'}</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full border border-gray-100 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-950"><div className={`h-full rounded-full ${bg}`} style={{ width: `${pct}%` }} /></div>
                    <div className="mt-1.5 text-[11.5px] text-gray-500 dark:text-neutral-400"><b className="tabular-nums text-gray-800 dark:text-neutral-200">{compact(num(r.principalPaid))}</b> paid · {pct}% · <b className="tabular-nums text-gray-800 dark:text-neutral-200">{compact(num(r.balance))}</b> to go</div>
                  </div>
                )
              })}
            </div>
          </Card>
        </section>

        {/* FUTURE */}
        <section className="pt-6 pb-4">
          <BandHead tense="Future" title="What's coming" />
          <Card className={soonEvent ? 'border-amber-300 dark:border-amber-900/60' : ''}>
            {soonEvent ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-amber-500 text-white"><AlertTriangle className="h-4 w-4" /></span>
                <div>
                  <div className="text-sm font-semibold text-gray-950 dark:text-white">{soonEvent.name}'s {soonEvent.kind === 'reset' ? 'rate resets' : 'balloon is due'} in {Math.max(0, soonEvent.months)} month{soonEvent.months === 1 ? '' : 's'}</div>
                  <div className="mt-0.5 text-sm text-gray-600 dark:text-neutral-300">{soonEvent.detail}. Plan for it now.</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-emerald-500 text-white"><CheckCircle2 className="h-4 w-4" /></span>
                <div>
                  <div className="text-sm font-semibold text-gray-950 dark:text-white">Nothing changes in the near term</div>
                  <div className="mt-0.5 text-sm text-gray-600 dark:text-neutral-300">
                    {arms.length ? `${arms.length} adjustable-rate loan${arms.length === 1 ? '' : 's'} could adjust, but no reset date is on file. ` : 'Every loan is fixed-rate and amortizing. '}
                    Next payoff: <b>{nextPayoff || '—'}</b>.
                  </div>
                </div>
              </div>
            )}

            {events.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {events.map((e, i) => (
                  <div key={i} className={`rounded-xl border border-gray-200 p-3.5 dark:border-neutral-800 ${e.kind === 'balloon' ? 'border-l-[3px] border-l-rose-500' : 'border-l-[3px] border-l-amber-500'}`}>
                    <div className="text-[11.5px] tabular-nums text-gray-400">{e.when} · {Math.max(0, e.months)} mo</div>
                    <div className="mt-1 text-sm font-semibold text-gray-950 dark:text-white">{e.name} — {e.kind === 'reset' ? 'ARM reset' : 'balloon due'}</div>
                    <div className="mt-1.5 text-[12.5px] text-gray-600 dark:text-neutral-300">{e.detail}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <p className="mt-4 flex items-center gap-1.5 text-xs text-gray-400"><Info className="h-3.5 w-3.5" />Adjustable-rate and balloon loans surface here as their dates approach; fixed loans stay quiet until payoff.</p>
          </Card>
        </section>
      </div>
    </PageContainer>
  )
}
