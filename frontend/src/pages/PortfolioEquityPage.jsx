import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Building2, Home, ChevronDown, Maximize2, X, TrendingUp, ArrowUpRight,
} from 'lucide-react'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { formatCurrency } from '../utils/formatters'

// ── Visual system (dataviz palette) ─────────────────────────────────────────
const SERIES = {
  blue: '#2a78d6',   // down payment
  aqua: '#1baf7a',   // principal reduction
  green: '#0ca30c',  // appreciation
  slate: '#8b90a0',  // remaining secured debt
  violet: '#4a3aa7', // current market value (total)
}

// ── Formatting helpers ──────────────────────────────────────────────────────
const compactMoney = (value) => {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`
  return `${sign}$${abs.toFixed(0)}`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fullMoney = (value) => formatCurrency(value)
const pct1 = (fraction) => `${(Number(fraction || 0) * 100).toFixed(1)}%`
// Interest rates carry more precision than other percentages — show 3 decimals.
const ratePct = (percentValue) => `${(Number(percentValue || 0)).toFixed(3)}%`

// All financial calculations (roll-ups, KPIs, waterfall, per-property equity /
// appreciation / cashflow) are computed by the backend. This page only renders.

// ── LTV risk-zone meter ──────────────────────────────────────────────────────
function LtvMeter({ ltv }) {
  const clamped = Math.max(0, Math.min(1, ltv))
  return (
    <div className="mt-1.5">
      <div className="relative h-2 w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 flex">
          <div className="h-full" style={{ width: '60%', background: 'rgba(12,163,12,0.35)' }} />
          <div className="h-full" style={{ width: '15%', background: 'rgba(217,152,20,0.40)' }} />
          <div className="h-full" style={{ width: '25%', background: 'rgba(214,58,58,0.40)' }} />
        </div>
        <div
          className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded-full bg-gray-900 dark:bg-white"
          style={{ left: `calc(${(clamped * 100).toFixed(1)}% - 2px)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

function ltvBand(ltv) {
  if (ltv < 0.60) return { label: 'Low leverage', tone: 'text-emerald-600 dark:text-emerald-400' }
  if (ltv <= 0.75) return { label: 'Moderate leverage', tone: 'text-amber-600 dark:text-amber-400' }
  return { label: 'High leverage', tone: 'text-red-600 dark:text-red-400' }
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
// `metric` (optional): hovering anywhere on the tile reveals the formula + the
// input values used to derive the number; it hides when the pointer leaves.
function KpiTile({ label, value, valueClass, metric, children }) {
  return (
    <div className="group relative rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-700">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueClass || 'text-gray-950 dark:text-white'}`}>{value}</p>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{children}</div>
      {metric ? (
        <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-gray-600 shadow-xl group-hover:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          {metric.formula ? <p className="font-semibold leading-5 text-gray-900 dark:text-white">{metric.formula}</p> : null}
          {metric.inputs?.length ? (
            <dl className="mt-2 space-y-1.5">
              {metric.inputs.map((input, index) => (
                <div key={`${input.label}-${index}`} className="flex items-start justify-between gap-3">
                  <dt>{input.label}</dt>
                  <dd className="text-right font-semibold tabular-nums text-gray-900 dark:text-white">{input.display}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const Delta = ({ children, tone = 'text-emerald-600 dark:text-emerald-400' }) => (
  <span className={`inline-flex items-center gap-0.5 font-medium ${tone}`}>
    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />{children}
  </span>
)

// ── Clickable summary card ────────────────────────────────────────────────────
function SummaryCard({ title, onExpand, children }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand() } }}
      className="group flex cursor-pointer flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        <Maximize2 className="h-4 w-4 text-gray-400 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
      </div>
      <div className="mt-3 space-y-1.5">{children}</div>
    </div>
  )
}

const SummaryRow = ({ label, value, strong, indent, tone }) => (
  <div className={`flex items-center justify-between text-sm ${indent ? 'pl-4' : ''}`}>
    <span className={`${indent ? 'text-gray-400' : 'text-gray-500 dark:text-gray-400'}`}>{label}</span>
    <span className={`tabular-nums ${strong ? 'font-semibold text-gray-950 dark:text-white' : tone || 'text-gray-700 dark:text-gray-200'}`}>{value}</span>
  </div>
)

// ── Value-buildup waterfall (inline SVG) ─────────────────────────────────────
function ValueWaterfall({ wf, large = false }) {
  const max = wf.currentValue
  if (!max || max <= 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-gray-400">Add purchase prices and market values to see the value buildup.</div>
  }
  const W = 760, H = large ? 460 : 380
  const padL = 44, padR = 20, padT = 46, padB = large ? 96 : 84
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const colW = plotW / 5
  const barW = colW * 0.52

  const c1 = wf.downPayment
  const c2 = c1 + wf.principalReduction
  const c3 = c2 + wf.appreciation
  const bars = [
    { label: 'Down payment', value: wf.downPayment, color: SERIES.blue, start: 0, end: c1 },
    { label: 'Principal reduction', value: wf.principalReduction, color: SERIES.aqua, start: c1, end: c2 },
    { label: 'Appreciation', value: wf.appreciation, color: SERIES.green, start: c2, end: c3 },
    { label: 'Remaining secured debt', value: wf.remainingDebt, color: SERIES.slate, start: c3, end: c3 + wf.remainingDebt },
    { label: 'Current market value', value: wf.currentValue, color: SERIES.violet, start: 0, end: wf.currentValue, total: true },
  ]
  const y = (v) => padT + plotH * (1 - v / max)
  const colX = (i) => padL + i * colW + (colW - barW) / 2
  const axisY = padT + plotH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Value buildup waterfall" className="select-none">
      {/* baseline */}
      <line x1={padL} y1={axisY} x2={W - padR} y2={axisY} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />

      {/* dashed connectors between build bars */}
      {[0, 1, 2].map((i) => {
        const yy = y(bars[i].end)
        return <line key={`c${i}`} x1={colX(i) + barW} y1={yy} x2={colX(i + 1)} y2={yy} className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="1" strokeDasharray="4 3" />
      })}

      {bars.map((b, i) => {
        const top = Math.max(b.start, b.end)
        const bottom = Math.min(b.start, b.end)
        const ry = y(top)
        const rh = Math.max(2, ((top - bottom) / max) * plotH)
        return (
          <g key={b.label}>
            <rect x={colX(i)} y={ry} width={barW} height={rh} rx="4" fill={b.color} opacity={b.total ? 0.92 : 0.85} />
            <text x={colX(i) + barW / 2} y={ry - 8} textAnchor="middle" className="fill-gray-700 dark:fill-gray-200" fontSize="12.5" fontWeight="600">{compactMoney(b.value)}</text>
          </g>
        )
      })}

      {/* Total equity bracket under bars 1–3 */}
      {(() => {
        const x1 = colX(0)
        const x2 = colX(2) + barW
        const by = axisY + 16
        return (
          <g>
            <line x1={x1} y1={by} x2={x2} y2={by} className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="1" />
            <line x1={x1} y1={by} x2={x1} y2={by - 5} className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="1" />
            <line x1={x2} y1={by} x2={x2} y2={by - 5} className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="1" />
            <text x={(x1 + x2) / 2} y={by + 16} textAnchor="middle" className="fill-gray-600 dark:fill-gray-300" fontSize="12" fontWeight="600">Total equity · {compactMoney(wf.totalEquity)}</text>
          </g>
        )
      })()}

      {/* Owed marker under bar 4 */}
      <text x={colX(3) + barW / 2} y={axisY + 22} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize="12" fontWeight="600">Owed · {compactMoney(wf.owed)}</text>
    </svg>
  )
}

function WaterfallLegend() {
  const items = [
    ['Down payment', SERIES.blue],
    ['Principal reduction', SERIES.aqua],
    ['Appreciation', SERIES.green],
    ['Remaining debt', SERIES.slate],
    ['Market value', SERIES.violet],
  ]
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
        </span>
      ))}
    </div>
  )
}

// ── Acquisition timeline: a home icon at each purchase year ──────────────────
// The line runs from the first purchase to the current year, so homes spread
// evenly (payoff years, which can be decades out, don't stretch the scale).
function HomeTimeline({ rows, onSelect }) {
  const withYear = rows.filter((p) => p.buyYear)
  if (!withYear.length) return null

  // Month-precision position: fractional year = year + (month-1)/12.
  const frac = (p) => p.buyYear + (((p.buyMonth || 1) - 1) / 12)
  const startFrac = Math.min(...withYear.map(frac))
  const domainStart = Math.floor(startFrac)
  // End the line one year past the last purchase.
  const domainEnd = Math.max(...withYear.map((p) => p.buyYear)) + 1
  const span = Math.max(1, domainEnd - domainStart)
  const leftPct = (f) => 5 + ((f - domainStart) / span) * 90
  const monthLabel = (p) => `${MONTHS[(p.buyMonth || 1) - 1]} ${p.buyYear}`

  return (
    <div className="relative px-2 py-1" aria-label="Acquisition timeline">
      <div className="relative h-12">
        {/* colored timeline line */}
        <div className="absolute inset-x-[5%] top-[22px] h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-400 opacity-80 dark:from-sky-500 dark:via-emerald-500 dark:to-amber-500" />
        {/* home markers */}
        {withYear.map((p) => {
          const primary = p.type === 'primary'
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className="group absolute top-[22px] z-10 -translate-x-1/2 -translate-y-1/2 focus:outline-none"
              style={{ left: `${leftPct(frac(p))}%` }}
              title={`${p.name} · purchased ${monthLabel(p)}`}
              aria-label={`${p.name}, purchased ${monthLabel(p)}`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white shadow-sm transition group-hover:scale-110 dark:bg-gray-900 ${primary ? 'border-red-400 text-red-500' : 'border-sky-400 text-sky-500'}`}>
                <Home className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="absolute left-1/2 top-[26px] -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-gray-400 dark:text-gray-500">{monthLabel(p)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Per-home details rendered inside the shared modal (compact font), grouped
// into Acquisition → Today → Loan with value coloring.
function HomeDetails({ home }) {
  const GREEN = 'text-emerald-600 dark:text-emerald-400'
  const RED = 'text-red-600 dark:text-red-400'
  const BLUE = 'text-blue-600 dark:text-blue-400'

  const downPayment = home.purchase - home.origLoan
  const loanToPurchase = home.purchase ? home.origLoan / home.purchase : 0
  const ltv = home.value ? home.loan / home.value : (home.ltv || 0)
  const cleared = home.origLoan - home.loan
  const clearedPct = home.origLoan ? cleared / home.origLoan : 0
  const purchased = home.buyMonth ? `${MONTHS[home.buyMonth - 1]} ${home.buyYear}` : home.buyYear

  const Row = ({ label, value, tone }) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`tabular-nums font-semibold ${tone || 'text-gray-900 dark:text-white'}`}>{value}</span>
    </div>
  )
  const Section = ({ title, children }) => (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )

  return (
    <div className="grid gap-5 text-[13px] sm:grid-cols-3">
      <Section title="Acquisition">
        <Row label="Purchased" value={purchased} />
        <Row label="Purchase price" value={fullMoney(home.purchase)} tone={BLUE} />
        <Row label="Down payment" value={fullMoney(downPayment)} tone={GREEN} />
        <Row label="Original loan" value={fullMoney(home.origLoan)} tone={RED} />
        <Row label="Loan / purchase" value={pct1(loanToPurchase)} />
      </Section>
      <Section title="Today">
        <Row label="Current value" value={fullMoney(home.value)} tone={BLUE} />
        <Row label="Loan balance" value={fullMoney(home.loan)} tone={RED} />
        <Row label="Equity" value={fullMoney(home.equity)} tone={GREEN} />
        <Row label="LTV" value={pct1(ltv)} tone={ltvBand(ltv).tone} />
      </Section>
      <Section title="Loan">
        <Row label="Interest rate" value={ratePct(home.rate)} tone={BLUE} />
        <Row label="Payoff year" value={home.payoffYear || '—'} />
        <Row label="Principal cleared" value={fullMoney(cleared)} tone={GREEN} />
        <Row label="% cleared" value={pct1(clearedPct)} tone={GREEN} />
      </Section>
    </div>
  )
}

// ── Cashflow bridge waterfall (income → expenses → NOI → debt → net) ──────────
const CF_UP = '#0ca30c'      // rental income (increase)
const CF_DOWN = '#d63a3a'    // expenses / debt service (decrease)
const CF_SUB = '#2a78d6'     // NOI subtotal
function CashflowWaterfall({ cf, large = false }) {
  const bars = [
    { key: 'rent', short: 'Rental', long: 'Rental income', start: 0, end: cf.rentalIncome, value: cf.rentalIncome, color: CF_UP },
    { key: 'opex', short: 'OpEx', long: 'Operating exp.', start: cf.rentalIncome, end: cf.noi, value: cf.operatingExpenses, color: CF_DOWN },
    { key: 'noi', short: 'NOI', long: 'Net op. income', start: 0, end: cf.noi, value: cf.noi, color: CF_SUB, total: true },
    { key: 'debt', short: 'Debt', long: 'Debt service', start: cf.noi, end: cf.netCashFlow, value: cf.debtService, color: CF_DOWN },
    { key: 'net', short: 'Net CF', long: 'Net cash flow', start: 0, end: cf.netCashFlow, value: cf.netCashFlow, color: cf.netCashFlow >= 0 ? CF_UP : CF_DOWN, total: true },
  ]
  const levels = bars.flatMap((b) => [b.start, b.end]).concat(0)
  const domainMax = Math.max(...levels)
  const domainMin = Math.min(...levels)
  const range = domainMax - domainMin
  if (!range) {
    return <div className="flex h-48 items-center justify-center text-sm text-gray-400">Add rental income and expenses to see the cashflow bridge.</div>
  }

  const W = large ? 660 : 420
  const H = large ? 380 : 200
  const padL = large ? 20 : 12
  const padR = large ? 20 : 12
  const padT = large ? 44 : 26
  const padB = large ? 44 : 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const colW = plotW / bars.length
  const barW = colW * (large ? 0.5 : 0.46)
  const y = (v) => padT + plotH * ((domainMax - v) / range)
  const colX = (i) => padL + i * colW + (colW - barW) / 2
  const zeroY = y(0)
  const valueFont = large ? 13 : 9.5
  const labelFont = large ? 12 : 9

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Cashflow bridge waterfall" className={`mx-auto mt-2 block select-none ${large ? '' : 'max-w-[380px]'}`}>
      {/* zero baseline */}
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
      {/* dashed connectors at the running level */}
      {[0, 1, 2, 3].map((i) => {
        const yy = y(bars[i].end)
        return <line key={`c${i}`} x1={colX(i) + barW} y1={yy} x2={colX(i + 1)} y2={yy} className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="1" strokeDasharray="4 3" />
      })}
      {bars.map((b, i) => {
        const top = Math.max(b.start, b.end)
        const bottom = Math.min(b.start, b.end)
        const ry = y(top)
        const rh = Math.max(2, ((top - bottom) / range) * plotH)
        return (
          <g key={b.key}>
            <rect x={colX(i)} y={ry} width={barW} height={rh} rx={large ? 4 : 3} fill={b.color} opacity={b.total ? 0.92 : 0.82} />
            <text x={colX(i) + barW / 2} y={ry - (large ? 7 : 5)} textAnchor="middle" className="fill-gray-700 dark:fill-gray-200" fontSize={valueFont} fontWeight="600">{compactMoney(b.value)}</text>
            <text x={colX(i) + barW / 2} y={H - (large ? 14 : 9)} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400" fontSize={labelFont}>{large ? b.long || b.short : b.short}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Shared modal ─────────────────────────────────────────────────────────────
function Modal({ open, title, wide, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className={`relative z-10 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Property filter (checkbox list, primary first, all selected by default) ──
function PropertyFilter({ properties, selectedIds, setSelectedIds }) {
  const [open, setOpen] = useState(false)
  const ordered = useMemo(() => {
    return [...properties].sort((a, b) => {
      if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }, [properties])

  const total = properties.length
  const selectedCount = properties.filter((p) => selectedIds.has(p.id)).length
  const allSelected = total > 0 && selectedCount === total
  const label = total === 0 ? 'No properties'
    : allSelected ? `All properties (${total})`
      : selectedCount === 0 ? 'No properties selected'
        : `${selectedCount} of ${total} selected`

  const toggle = (id) => setSelectedIds((cur) => {
    const next = new Set(cur)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
            <div className="max-h-72 overflow-y-auto p-1.5">
              {ordered.length ? ordered.map((p) => {
                const primary = !!p.isPrimary
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{p.name}</span>
                    <span className={`flex shrink-0 items-center gap-1 text-[11px] font-medium ${primary ? 'text-red-500' : 'text-gray-400'}`}>
                      {primary ? <Home className="h-3.5 w-3.5" aria-hidden="true" /> : <Building2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      {primary ? 'Primary' : 'Rental'}
                    </span>
                  </label>
                )
              }) : <p className="px-3 py-4 text-center text-xs text-gray-400">No properties available</p>}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

// ── Table helpers ────────────────────────────────────────────────────────────
const signedMoney = (v) => {
  const n = Number(v) || 0
  const cls = n < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'
  return <span className={`tabular-nums ${cls}`}>{fullMoney(n)}</span>
}
const ltvPill = (ltv) => {
  const tone = ltv < 0.50 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
    : ltv <= 0.65 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
      : 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>{pct1(ltv)}</span>
}
// Gain/loss coloring: positive green, negative red.
const gainMoney = (v) => {
  const n = Number(v) || 0
  const cls = n >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return <span className={`tabular-nums ${cls}`}>{fullMoney(n)}</span>
}
const gainPct = (fraction) => {
  const n = Number(fraction) || 0
  const cls = n >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return <span className={`tabular-nums ${cls}`}>{pct1(n)}</span>
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PortfolioEquityPage() {
  const [data, setData] = useState(null)
  const [available, setAvailable] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [period, setPeriod] = useState('monthly') // 'monthly' | 'annual'
  const [modal, setModal] = useState(null) // { kind }
  const initialized = useRef(false)

  const selectedKey = useMemo(() => Array.from(selectedIds).sort((a, b) => a - b).join(','), [selectedIds])

  useEffect(() => {
    let active = true
    setLoading(true)
    propAPI.portfolioEquityCashflow({
      selected_property_ids: initialized.current ? selectedKey : '',
      selection_explicit: initialized.current,
    })
      .then((res) => {
        if (!active) return
        setData(res.data)
        setAvailable(res.data?.availableProperties || [])
        if (!initialized.current) {
          initialized.current = true
          setSelectedIds(new Set((res.data?.availableProperties || []).map((p) => p.id)))
        }
      })
      .catch(() => { if (active) toast.error('Failed to load portfolio equity dashboard') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedKey])

  const rows = data?.properties || []
  const rentals = useMemo(() => rows.filter((p) => p.type === 'rental'), [rows])
  const m = data?.totals
  const factor = period === 'annual' ? (m?.annualFactor || 12) : 1
  const per = period === 'annual' ? '/yr' : '/mo'

  if ((loading && !data) || !m) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>
      </PageContainer>
    )
  }

  const capRateFlag = m.weightedRate > m.capRate * 100
  const band = ltvBand(m.ltv)

  // Value coloring: green = good/income, red = liability/expense/negative,
  // blue = informational, amber = caution.
  const TONE = {
    green: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    blue: 'text-blue-600 dark:text-blue-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }

  // Hover-tooltip descriptors: the formula + the actual input values used.
  const mk = (formula, inputs) => ({ formula, inputs })
  const metrics = {
    portfolioValue: mk('Portfolio Value = Σ Current Market Value  ·  Growth = (Σ Value − Σ Purchase) ÷ Σ Purchase', [
      { label: 'Σ Current value', display: fullMoney(m.value) },
      { label: 'Σ Purchase price', display: fullMoney(m.purchase) },
      { label: 'Growth', display: pct1(m.growth) },
    ]),
    totalEquity: mk('Equity = Σ Value − Σ Loan  ·  % of value = Equity ÷ Value', [
      { label: 'Σ Current value', display: fullMoney(m.value) },
      { label: 'Σ Loan balance', display: fullMoney(m.loan) },
      { label: 'Total equity', display: fullMoney(m.equity) },
      { label: '% of value', display: pct1(m.equityPct) },
    ]),
    totalDebt: mk('Debt = Σ Loan Balance  ·  Paid off = (Σ Original − Σ Balance) ÷ Σ Original', [
      { label: 'Σ Original loan', display: fullMoney(m.origLoan) },
      { label: 'Σ Loan balance', display: fullMoney(m.loan) },
      { label: 'Paid off', display: pct1(m.paidOff) },
    ]),
    ltv: mk('LTV = Σ Loan ÷ Σ Value  ·  Cushion = 1 − (Loan ÷ 0.80) ÷ Value', [
      { label: 'Σ Loan balance', display: fullMoney(m.loan) },
      { label: 'Σ Current value', display: fullMoney(m.value) },
      { label: 'Portfolio LTV', display: pct1(m.ltv) },
      { label: 'Price cushion', display: pct1(Math.max(0, m.priceCushion)) },
    ]),
    weightedRate: mk('Weighted Rate = Σ(Balance × Rate) ÷ Σ Balance', [
      { label: 'Σ Loan balance', display: fullMoney(m.loan) },
      { label: 'Weighted rate', display: ratePct(m.weightedRate) },
      { label: 'Monthly interest', display: fullMoney(m.monthlyInterest) },
      { label: 'Portfolio cap rate', display: pct1(m.capRate) },
    ]),
    roe: mk('ROE = (Annual Net Cash Flow + Annual Principal Paydown) ÷ Equity', [
      { label: 'Annual net cash flow', display: fullMoney(m.netCashFlow * 12) },
      { label: 'Annual principal paydown', display: fullMoney(m.monthlyPrincipal * 12) },
      { label: 'Current equity', display: fullMoney(m.equity) },
      { label: 'Return on equity', display: pct1(m.roe) },
    ]),
    rentalIncome: mk(`Rental Income = Σ Scheduled Rent (rentals${per})`, [
      { label: 'Rentals', display: String(m.counts.rentals) },
      { label: `Scheduled rent${per}`, display: fullMoney(m.rent * factor) },
      { label: `Vacancy loss${per}`, display: fullMoney(m.vacancy * factor) },
      { label: `Effective (EGI)${per}`, display: fullMoney(m.egi * factor) },
    ]),
    operatingExpenses: mk(`Operating Expenses = −Σ OpEx  ·  Expense ratio = |OpEx| ÷ EGI`, [
      { label: `Operating expenses${per}`, display: fullMoney(-m.opex * factor) },
      { label: `Effective gross income${per}`, display: fullMoney(m.egi * factor) },
      { label: 'Expense ratio', display: pct1(m.expenseRatio) },
    ]),
    noi: mk('Net Operating Income = EGI + OpEx  (before debt service)', [
      { label: `Effective gross income${per}`, display: fullMoney(m.egi * factor) },
      { label: `Operating expenses${per}`, display: fullMoney(m.opex * factor) },
      { label: `Net operating income${per}`, display: fullMoney(m.noi * factor) },
    ]),
    netCashFlow: mk('Net Cash Flow = Rental Income + Vacancy + OpEx + Debt Service', [
      { label: `Scheduled rent${per}`, display: fullMoney(m.rent * factor) },
      { label: `Vacancy${per}`, display: fullMoney(m.vacancy * factor) },
      { label: `Operating expenses${per}`, display: fullMoney(m.opex * factor) },
      { label: `Debt service${per}`, display: fullMoney(m.debtService * factor) },
      { label: `Net cash flow${per}`, display: fullMoney(m.netCashFlow * factor) },
    ]),
    capRate: mk('Portfolio Cap Rate = Annual NOI ÷ Rental Market Value', [
      { label: 'Annual NOI', display: fullMoney(m.noi * 12) },
      { label: 'Rental market value', display: fullMoney(m.rentalValue) },
      { label: 'Portfolio cap rate', display: pct1(m.capRate) },
    ]),
    equityYield: mk('Equity Yield = Annual Net Cash Flow ÷ Current Equity', [
      { label: 'Annual net cash flow', display: fullMoney(m.netCashFlow * 12) },
      { label: 'Current equity', display: fullMoney(m.equity) },
      { label: 'Equity yield', display: pct1(m.equityYield) },
    ]),
  }

  return (
    <PageContainer>
      {/* Header + property filter */}
      <header className="flex flex-col gap-4 border-b border-gray-200 pb-4 dark:border-gray-700 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950 dark:text-white">Portfolio Equity &amp; Cashflow</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{m.counts.total} properties · {m.counts.rentals} rentals · as of {m.nowYear}</p>
        </div>
        <PropertyFilter properties={available} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />
      </header>

      {/* ── Band 1: Equity KPI tiles ── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Equity metrics">
        <KpiTile label="Portfolio Value" value={compactMoney(m.value)} valueClass={TONE.blue} metric={metrics.portfolioValue}>
          <Delta>{pct1(m.growth)} growth</Delta>
        </KpiTile>
        <KpiTile label="Total Equity" value={compactMoney(m.equity)} valueClass={m.equity >= 0 ? TONE.green : TONE.red} metric={metrics.totalEquity}>
          <Delta>{pct1(m.equityPct)} of value</Delta>
        </KpiTile>
        <KpiTile label="Total Debt" value={compactMoney(m.loan)} valueClass={TONE.red} metric={metrics.totalDebt}>
          <Delta>{pct1(m.paidOff)} paid off</Delta>
        </KpiTile>
        <KpiTile label="Portfolio LTV" value={pct1(m.ltv)} valueClass={band.tone} metric={metrics.ltv}>
          <LtvMeter ltv={m.ltv} />
          <span className={`mt-1 block ${band.tone}`}>{band.label} · ~{pct1(Math.max(0, m.priceCushion))} price cushion</span>
        </KpiTile>
        <KpiTile label="Weighted Interest Rate" value={ratePct(m.weightedRate)} valueClass={capRateFlag ? TONE.amber : TONE.blue} metric={metrics.weightedRate}>
          <span className={capRateFlag ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}>
            {capRateFlag ? '▲ above' : 'vs'} {pct1(m.capRate)} cap rate
          </span>
        </KpiTile>
        <KpiTile label="Return on Equity" value={pct1(m.roe)} valueClass={m.roe >= 0 ? TONE.green : TONE.red} metric={metrics.roe}>
          <span className="text-gray-500 dark:text-gray-400">cashflow + paydown</span>
        </KpiTile>
      </section>

      {/* ── Acquisition timeline ── */}
      <HomeTimeline rows={rows} onSelect={(home) => setModal({ kind: 'home', home })} />

      {/* ── Band 2: Appreciation · Waterfall · Loan & Debt ── */}
      <section className="grid gap-3 lg:grid-cols-[1fr_1.5fr_1fr]" aria-label="Value buildup">
        <SummaryCard title="Appreciation Summary" onExpand={() => setModal({ kind: 'appreciation' })}>
          <SummaryRow label="Portfolio value" value={fullMoney(m.value)} />
          <SummaryRow label="Purchase price" value={fullMoney(m.purchase)} />
          <SummaryRow label="Total appreciation" value={fullMoney(m.value - m.purchase)} strong tone="text-emerald-600 dark:text-emerald-400" />
          <SummaryRow label="Total growth" value={pct1(m.growth)} />
          <SummaryRow label="Annualized growth" value={pct1(m.annualizedWeighted)} strong />
        </SummaryCard>

        <div
          role="button"
          tabIndex={0}
          onClick={() => setModal({ kind: 'waterfall' })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal({ kind: 'waterfall' }) } }}
          className="group flex cursor-pointer flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Value Buildup</h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 opacity-0 transition group-hover:opacity-100"><Maximize2 className="h-3.5 w-3.5" /> enlarge</span>
          </div>
          <ValueWaterfall wf={m.waterfall} />
          <WaterfallLegend />
        </div>

        <SummaryCard title="Loan &amp; Debt Summary" onExpand={() => setModal({ kind: 'loans' })}>
          <SummaryRow label="Original loans" value={fullMoney(m.origLoan)} />
          <SummaryRow label="Current balance" value={fullMoney(m.loan)} />
          <SummaryRow label="Principal paid to date" value={fullMoney(m.origLoan - m.loan)} tone="text-emerald-600 dark:text-emerald-400" />
          <SummaryRow label="Weighted rate" value={ratePct(m.weightedRate)} />
          <SummaryRow label="Monthly payment" value={fullMoney(m.payment)} strong />
          <SummaryRow label="↳ Interest" value={fullMoney(m.monthlyInterest)} indent />
          <SummaryRow label="↳ Principal" value={fullMoney(m.monthlyPrincipal)} indent />
          <div className="my-1 border-t border-dashed border-gray-200 dark:border-gray-700" />
          <SummaryRow label={`YTD interest paid (${m.monthsElapsed} mo)`} value={fullMoney(m.ytdInterest)} />
          <SummaryRow label={`YTD principal paid (${m.monthsElapsed} mo)`} value={fullMoney(m.ytdPrincipal)} />
        </SummaryCard>
      </section>

      {/* ── Band 3: Cashflow (rentals only) ── */}
      <section aria-label="Cashflow" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-gray-500" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Cashflow <span className="text-sm font-normal text-gray-400">· rentals only</span></h2>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm dark:border-gray-700 dark:bg-gray-800">
            {['monthly', 'annual'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={`rounded-md px-3 py-1 font-medium capitalize transition ${period === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <KpiTile label={`Rental Income${per}`} value={compactMoney(m.rent * factor)} valueClass={TONE.green} metric={metrics.rentalIncome}>
            <span className="text-gray-500 dark:text-gray-400">scheduled rent</span>
          </KpiTile>
          <KpiTile label={`Operating Expenses${per}`} value={compactMoney(-m.opex * factor)} valueClass={TONE.red} metric={metrics.operatingExpenses}>
            <span className="text-gray-500 dark:text-gray-400">{pct1(m.expenseRatio)} of EGI</span>
          </KpiTile>
          <KpiTile label={`Net Operating Income${per}`} value={compactMoney(m.noi * factor)} valueClass={m.noi >= 0 ? TONE.green : TONE.red} metric={metrics.noi}>
            <span className="text-gray-500 dark:text-gray-400">before debt service</span>
          </KpiTile>
          <KpiTile label={`Net Cashflow${per}`} value={compactMoney(m.netCashFlow * factor)} valueClass={m.netCashFlow >= 0 ? TONE.green : TONE.red} metric={metrics.netCashFlow}>
            <span className={m.netCashFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{m.netCashFlow >= 0 ? 'positive' : 'negative'}</span>
          </KpiTile>
          <KpiTile label="Portfolio Cap Rate" value={pct1(m.capRate)} valueClass={TONE.blue} metric={metrics.capRate}>
            <span className="text-gray-500 dark:text-gray-400">annual NOI / rental value</span>
          </KpiTile>
          <KpiTile label="Equity Yield" value={pct1(m.equityYield)} valueClass={m.equityYield >= 0 ? TONE.green : TONE.red} metric={metrics.equityYield}>
            <span className="text-gray-500 dark:text-gray-400">cash flow / equity</span>
          </KpiTile>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Cashflow summary (click to expand into per-property table) */}
          <SummaryCard title={`Cashflow Summary${per}`} onExpand={() => setModal({ kind: 'cashflow' })}>
            <SummaryRow label="Gross rent" value={fullMoney(m.rent * factor)} />
            <SummaryRow label="Vacancy rate" value={pct1(m.rent ? -m.vacancy / m.rent : 0)} tone="text-red-600 dark:text-red-400" />
            <SummaryRow label="Operating expenses" value={fullMoney(m.opex * factor)} tone="text-red-600 dark:text-red-400" />
            <SummaryRow label="Net operating income" value={fullMoney(m.noi * factor)} strong />
            <SummaryRow label="Debt service (P&I)" value={fullMoney(m.debtService * factor)} tone="text-red-600 dark:text-red-400" />
            <div className="my-1 border-t border-dashed border-gray-200 dark:border-gray-700" />
            <SummaryRow label="Net cash flow" value={fullMoney(m.netCashFlow * factor)} strong tone={m.netCashFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
          </SummaryCard>

          {/* Cashflow waterfall: rental income → opex → NOI → debt service → net cash flow */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setModal({ kind: 'cfwaterfall' })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModal({ kind: 'cfwaterfall' }) } }}
            className="group flex cursor-pointer flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Cashflow Bridge{per}</h3>
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 opacity-0 transition group-hover:opacity-100"><Maximize2 className="h-3.5 w-3.5" /> enlarge</span>
            </div>
            <CashflowWaterfall
              cf={{
                rentalIncome: m.egi * factor,
                operatingExpenses: m.opex * factor,
                noi: m.noi * factor,
                debtService: m.debtService * factor,
                netCashFlow: m.netCashFlow * factor,
              }}
            />
          </div>
        </div>
      </section>

      {/* ── Modals ── */}
      <Modal open={modal?.kind === 'waterfall'} title="Value Buildup" wide onClose={() => setModal(null)}>
        <ValueWaterfall wf={m.waterfall} large />
        <WaterfallLegend />
      </Modal>

      <Modal open={modal?.kind === 'cfwaterfall'} title={`Cashflow Bridge${per}`} wide onClose={() => setModal(null)}>
        <CashflowWaterfall
          large
          cf={{
            rentalIncome: m.egi * factor,
            operatingExpenses: m.opex * factor,
            noi: m.noi * factor,
            debtService: m.debtService * factor,
            netCashFlow: m.netCashFlow * factor,
          }}
        />
        <p className="mt-2 text-center text-xs text-gray-400">Rental income (net of vacancy) → operating expenses → NOI → debt service → net cash flow</p>
      </Modal>

      <Modal open={modal?.kind === 'home'} title={modal?.home?.name || 'Property'} wide onClose={() => setModal(null)}>
        {modal?.home ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <Home className={`h-4 w-4 ${modal.home.type === 'primary' ? 'text-red-500' : 'text-blue-500'}`} aria-hidden="true" />
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${modal.home.type === 'primary' ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300'}`}>{modal.home.type === 'primary' ? 'Primary' : 'Rental'}</span>
            </div>
            <HomeDetails home={modal.home} />
          </>
        ) : null}
      </Modal>

      <Modal open={modal?.kind === 'cashflow'} title={`Cashflow by property${per}`} wide onClose={() => setModal(null)}>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-xs uppercase text-gray-400">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="py-2.5 pr-3 text-left font-medium">Property</th>
                <th className="px-3 py-2.5 text-right font-medium">Rent</th>
                <th className="px-3 py-2.5 text-right font-medium">Vacancy %</th>
                <th className="px-3 py-2.5 text-right font-medium">OpEx</th>
                <th className="px-3 py-2.5 text-right font-medium">Debt (P&amp;I)</th>
                <th className="py-2.5 pl-3 text-right font-medium">Net CF</th>
              </tr>
            </thead>
            <tbody>
              {rentals.map((p) => {
                const net = p.netCashFlow * factor
                return (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-200">{p.name}</td>
                    <td className="px-3 py-2.5 text-right">{signedMoney(p.rent * factor)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600 dark:text-red-400">{pct1(p.rent ? -p.vacancy / p.rent : 0)}</td>
                    <td className="px-3 py-2.5 text-right">{signedMoney(p.opex * factor)}</td>
                    <td className="px-3 py-2.5 text-right">{signedMoney(p.debtService * factor)}</td>
                    <td className={`py-2.5 pl-3 text-right font-semibold tabular-nums ${net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fullMoney(net)}</td>
                  </tr>
                )
              })}
              {!rentals.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-gray-400">No rentals selected</td></tr>}
            </tbody>
            {rentals.length ? (
              <tfoot>
                <tr className="border-t border-gray-200 font-semibold dark:border-gray-700">
                  <td className="py-2.5 pr-3 text-gray-900 dark:text-white">Total</td>
                  <td className="px-3 py-2.5 text-right">{signedMoney(m.rent * factor)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-red-600 dark:text-red-400">{pct1(m.rent ? -m.vacancy / m.rent : 0)}</td>
                  <td className="px-3 py-2.5 text-right">{signedMoney(m.opex * factor)}</td>
                  <td className="px-3 py-2.5 text-right">{signedMoney(m.debtService * factor)}</td>
                  <td className={`py-2.5 pl-3 text-right tabular-nums ${m.netCashFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fullMoney(m.netCashFlow * factor)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Modal>

      <Modal open={modal?.kind === 'appreciation'} title="Appreciation by property" wide onClose={() => setModal(null)}>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-xs uppercase text-gray-400">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="py-2.5 pr-3 text-left font-medium">Property</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 text-right font-medium">Purchase</th>
                <th className="px-3 py-2.5 text-right font-medium">Appreciation</th>
                <th className="px-3 py-2.5 text-right font-medium">Growth</th>
                <th className="py-2.5 pl-3 text-right font-medium">Annualized</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                  <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-200">{p.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fullMoney(p.value)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fullMoney(p.purchase)}</td>
                  <td className="px-3 py-2.5 text-right">{gainMoney(p.appreciation)}</td>
                  <td className="px-3 py-2.5 text-right">{gainPct(p.growth)}</td>
                  <td className="py-2.5 pl-3 text-right">{gainPct(p.annualized)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold dark:border-gray-700">
                <td className="py-2.5 pr-3 text-gray-900 dark:text-white">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fullMoney(m.value)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fullMoney(m.purchase)}</td>
                <td className="px-3 py-2.5 text-right">{gainMoney(m.value - m.purchase)}</td>
                <td className="px-3 py-2.5 text-right">{gainPct(m.growth)}</td>
                <td className="py-2.5 pl-3 text-right">{gainPct(m.annualizedWeighted)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Modal>

      <Modal open={modal?.kind === 'loans'} title="Loans by property" wide onClose={() => setModal(null)}>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-xs uppercase text-gray-400">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="py-2.5 pr-3 text-left font-medium">Property</th>
                <th className="px-3 py-2.5 text-right font-medium">Orig. Loan</th>
                <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                <th className="px-3 py-2.5 text-left font-medium">Type</th>
                <th className="px-3 py-2.5 text-right font-medium">Payment</th>
                <th className="px-3 py-2.5 text-right font-medium">Payoff</th>
                <th className="py-2.5 pl-3 text-right font-medium">LTV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                  <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-200">{p.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fullMoney(p.origLoan)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fullMoney(p.loan)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{ratePct(p.rate)}</td>
                  <td className="px-3 py-2.5 text-left text-gray-500 dark:text-gray-400">{p.loanType}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{fullMoney(p.payment)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{p.payoffYear || '—'}</td>
                  <td className="py-2.5 pl-3 text-right">{ltvPill(p.ltv)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold dark:border-gray-700">
                <td className="py-2.5 pr-3 text-gray-900 dark:text-white">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fullMoney(m.origLoan)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fullMoney(m.loan)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{ratePct(m.weightedRate)}</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right tabular-nums">{fullMoney(m.payment)}</td>
                <td className="px-3 py-2.5" />
                <td className="py-2.5 pl-3 text-right">{ltvPill(m.ltv)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Modal>
    </PageContainer>
  )
}
