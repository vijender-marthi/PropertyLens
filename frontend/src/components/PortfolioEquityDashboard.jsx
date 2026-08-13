import { useEffect, useMemo, useState } from 'react'
import {
  Building2, Home, ChevronDown, Maximize2, X, TrendingUp, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import PageContainer from './PageContainer'
import { formatCurrency, formatMetricCurrency } from '../utils/formatters'

// ── Visual system (dataviz palette) ─────────────────────────────────────────
const SERIES = {
  blue: '#2a78d6',   // down payment
  aqua: '#1baf7a',   // principal reduction
  green: '#0ca30c',  // appreciation
  slate: '#8b90a0',  // remaining secured debt
  violet: '#4a3aa7', // current market value (total)
}

// ── Formatting helpers ──────────────────────────────────────────────────────
// Per UI_DESIGN_STANDARDS §5, display formatting goes through the shared
// formatter module. Compact metric currency renders e.g. $4.73M / $876.5K.
const compactMoney = (value) => formatMetricCurrency(value)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// ISO date (YYYY-MM-DD) → "Mon YYYY"; falls back to the year when unavailable.
const statementAsOfLabel = (iso, fallbackYear) => {
  if (iso && /^\d{4}-\d{2}/.test(iso)) {
    const [y, mo] = iso.split('-')
    return `${MONTHS[Number(mo) - 1]} ${y}`
  }
  return String(fallbackYear)
}
const fullMoney = (value) => formatCurrency(value)
const pct1 = (fraction) => `${(Number(fraction || 0) * 100).toFixed(1)}%`
// Interest rates carry more precision than other percentages — show 3 decimals.
const ratePct = (percentValue) => `${(Number(percentValue || 0)).toFixed(3)}%`

// All financial calculations (roll-ups, KPIs, waterfall, per-property equity /
// appreciation / cashflow) are computed by the backend. This only renders.

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

const Delta = ({ children, direction = 'up', tone = 'text-emerald-600 dark:text-emerald-400' }) => {
  const Arrow = direction === 'down' ? ArrowDownRight : ArrowUpRight
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${tone}`}>
      <Arrow className="h-3 w-3" aria-hidden="true" />{children}
    </span>
  )
}

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
    <span className={`tabular-nums ${strong ? 'font-semibold ' : ''}${tone || (strong ? 'text-gray-950 dark:text-white' : 'text-gray-700 dark:text-gray-200')}`}>{value}</span>
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
      <line x1={padL} y1={axisY} x2={W - padR} y2={axisY} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
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
export function HomeTimeline({ rows, onSelect, selectedIds }) {
  const withYear = rows.filter((p) => p.buyYear)
  if (!withYear.length) return null
  const isolating = selectedIds && selectedIds.size > 0 && selectedIds.size < withYear.length

  const frac = (p) => p.buyYear + (((p.buyMonth || 1) - 1) / 12)
  const startFrac = Math.min(...withYear.map(frac))
  const domainStart = Math.floor(startFrac)
  const domainEnd = Math.max(...withYear.map((p) => p.buyYear)) + 1
  const span = Math.max(1, domainEnd - domainStart)
  const leftPct = (f) => 5 + ((f - domainStart) / span) * 90
  const monthLabel = (p) => `${MONTHS[(p.buyMonth || 1) - 1]} ${p.buyYear}`

  return (
    <div className="relative px-2 py-1" aria-label="Acquisition timeline">
      <p className="mb-0.5 text-right text-[10px] text-gray-400 dark:text-gray-500">Click a home to filter · ⌘/Ctrl-click to select multiple</p>
      <div className="relative h-20">
        <div className="absolute inset-x-[5%] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" />
        {withYear.map((p) => {
          const primary = p.type === 'primary'
          const active = !isolating || (selectedIds && selectedIds.has(p.id))
          return (
            <button
              key={p.id}
              type="button"
              onClick={(e) => onSelect(p, e.metaKey || e.ctrlKey || e.shiftKey)}
              className={`group absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-opacity focus:outline-none ${active ? '' : 'opacity-35'}`}
              style={{ left: `${leftPct(frac(p))}%` }}
              title={`${p.name} · purchased ${monthLabel(p)} · ⌘/Ctrl-click to multi-select`}
              aria-label={`${p.name}, purchased ${monthLabel(p)}`}
            >
              <span className="mb-1 max-w-[6rem] truncate text-[10px] font-semibold text-gray-600 dark:text-gray-300">{p.name}</span>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white shadow-sm transition group-hover:scale-110 dark:bg-gray-900 ${primary ? 'border-red-400 text-red-500' : 'border-sky-400 text-sky-500'} ${active && isolating ? 'scale-125 ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-gray-900' : ''}`}>
                {primary ? <Home className="h-3.5 w-3.5" aria-hidden="true" /> : <Building2 className="h-3.5 w-3.5" aria-hidden="true" />}
              </span>
              <span className="mt-1 whitespace-nowrap text-[10px] font-medium text-gray-400 dark:text-gray-500">{monthLabel(p)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Cashflow bridge waterfall (income → expenses → NOI → debt → net) ──────────
const CF_UP = '#0ca30c'
const CF_DOWN = '#d63a3a'
const CF_SUB = '#2a78d6'
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
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
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
export function PropertyFilter({ properties, selectedIds, setSelectedIds }) {
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
  const selectAll = () => setSelectedIds(new Set(properties.map((p) => p.id)))
  const clearAll = () => setSelectedIds(new Set())

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
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
              <button type="button" onClick={selectAll} disabled={allSelected} className="text-xs font-medium text-blue-600 hover:underline disabled:cursor-default disabled:text-gray-300 dark:text-blue-400 dark:disabled:text-gray-600">Select all</button>
              <button type="button" onClick={clearAll} disabled={selectedCount === 0} className="text-xs font-medium text-blue-600 hover:underline disabled:cursor-default disabled:text-gray-300 dark:text-blue-400 dark:disabled:text-gray-600">Deselect all</button>
            </div>
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

const TONE = {
  green: 'text-emerald-600 dark:text-emerald-400',
  red: 'text-red-600 dark:text-red-400',
  blue: 'text-sky-600 dark:text-sky-400',
  amber: 'text-amber-600 dark:text-amber-400',
}

/**
 * Reusable Equity & Cashflow dashboard, rendered identically for the whole
 * portfolio or a single property (the caller supplies the scoped data).
 *
 * Props:
 *  - data:       the equity-cashflow response ({ totals, properties, ... }).
 *  - title:      optional heading; when omitted the header row is not rendered.
 *  - headerRight: optional node placed on the header's right (e.g. the filter).
 *  - timeline:   optional node rendered between the equity KPIs and the value band.
 *  - wrap:       wrap in PageContainer (default true); false for embedding in a tab.
 */
export default function PortfolioEquityDashboard({ data, title, headerRight, timeline, wrap = true }) {
  const [period, setPeriod] = useState('monthly')
  const [modal, setModal] = useState(null)

  const rows = data?.properties || []
  const rentals = useMemo(() => rows.filter((p) => p.type === 'rental'), [rows])
  const m = data?.totals
  const factor = period === 'annual' ? (m?.annualFactor || 12) : 1
  const per = period === 'annual' ? '/yr' : '/mo'

  const Wrapper = wrap ? PageContainer : ({ children }) => <div className="space-y-4">{children}</div>

  if (!m) {
    return (
      <Wrapper>
        <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>
      </Wrapper>
    )
  }

  const propWord = m.counts.total === 1 ? 'property' : 'properties'

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
    totalDebt: mk('Debt = Σ Loan Balance  ·  LTV = Loan ÷ Value  ·  Paid off = (Σ Original − Σ Balance) ÷ Σ Original', [
      { label: 'Σ Original loan', display: fullMoney(m.origLoan) },
      { label: 'Σ Loan balance', display: fullMoney(m.loan) },
      { label: 'Σ Current value', display: fullMoney(m.value) },
      { label: 'LTV', display: pct1(m.ltv) },
      { label: 'Price cushion', display: pct1(Math.max(0, m.priceCushion)) },
      { label: 'Paid off', display: pct1(m.paidOff) },
    ]),
    weightedRate: mk('Weighted Rate = Σ(Balance × Rate) ÷ Σ Balance', [
      { label: 'Σ Loan balance', display: fullMoney(m.loan) },
      { label: 'Weighted rate', display: ratePct(m.weightedRate) },
      { label: 'Interest range', display: `${ratePct(m.rateMin)} – ${ratePct(m.rateMax)}` },
      { label: 'Loan types', display: `${m.fixedLoans} fixed · ${m.armLoans} ARM` },
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
    operatingExpenses: mk('Operating Expenses = Σ monthly operating costs (taxes, insurance, mgmt, maintenance, HOA, capex reserve) for rentals', [
      { label: `Operating expenses${per}`, display: fullMoney(-m.opex * factor) },
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
    <Wrapper>
      {title ? (
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-4 dark:border-gray-700 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-950 dark:text-white">{title}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{m.counts.total} {propWord} · {m.counts.rentals} rentals · as of {statementAsOfLabel(m.statementAsOf, m.nowYear)}</p>
          </div>
          {headerRight}
        </header>
      ) : null}

      {timeline}

      {/* ── Band 1: Equity KPI tiles ── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" aria-label="Equity metrics">
        <KpiTile label="Portfolio Value" value={compactMoney(m.value)} valueClass={TONE.blue} metric={metrics.portfolioValue}>
          <Delta>{compactMoney(m.value - m.purchase)} · {pct1(m.growth)} since purchase</Delta>
        </KpiTile>
        <KpiTile label="Total Equity" value={compactMoney(m.equity)} valueClass={m.equity >= 0 ? TONE.green : TONE.red} metric={metrics.totalEquity}>
          <Delta>{pct1(m.equityPct)} of value</Delta>
        </KpiTile>
        <KpiTile label="Total Debt" value={compactMoney(m.loan)} valueClass={TONE.red} metric={metrics.totalDebt}>
          <Delta direction="down" tone={TONE.red}>{pct1(m.ltv)} of value</Delta>
        </KpiTile>
        <KpiTile label="Weighted Interest Rate" value={ratePct(m.weightedRate)} valueClass={TONE.blue} metric={metrics.weightedRate}>
          <span className="block text-gray-500 dark:text-gray-400">{ratePct(m.rateMin)} – {ratePct(m.rateMax)} range</span>
        </KpiTile>
        <KpiTile label="Return on Equity" value={pct1(m.roe)} valueClass={m.roe >= 0 ? TONE.green : TONE.red} metric={metrics.roe}>
          <span className="text-gray-500 dark:text-gray-400">cashflow + paydown</span>
        </KpiTile>
      </section>

      {/* ── Band 2: Equity · Waterfall · Loan & Debt ── */}
      <section className="grid gap-3 lg:grid-cols-[1fr_1.5fr_1fr]" aria-label="Value buildup">
        <SummaryCard title="Equity Summary" onExpand={() => setModal({ kind: 'appreciation' })}>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Portfolio value</span>
            <span className="text-right tabular-nums text-sky-600 dark:text-sky-400">{compactMoney(m.value)}</span>
            <span />

            <span className="text-gray-500 dark:text-gray-400">Loan balance</span>
            <span className="text-right tabular-nums text-red-600 dark:text-red-400">{compactMoney(m.loan)}</span>
            <span className="text-right tabular-nums text-red-600 dark:text-red-400">{pct1(m.ltv)}</span>

            <span className="text-gray-500 dark:text-gray-400">Total equity</span>
            <span className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{compactMoney(m.equity)}</span>
            <span className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{pct1(m.equityPct)}</span>

            <div className="col-span-3 my-1 border-t border-dashed border-gray-200 dark:border-gray-700" />

            <span className="pl-4 text-gray-400">↳ Down payment</span>
            <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{compactMoney(m.waterfall.downPayment)}</span>
            <span />

            <span className="pl-4 text-gray-400">↳ Principal paid</span>
            <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{compactMoney(m.waterfall.principalReduction)}</span>
            <span />

            <span className="pl-4 text-gray-400">↳ Appreciation</span>
            <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{compactMoney(m.waterfall.appreciation)}</span>
            <span />

            <div className="col-span-3 my-1 border-t border-dashed border-gray-200 dark:border-gray-700" />

            <span className="text-gray-500 dark:text-gray-400">Total growth</span>
            <span />
            <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{pct1(m.growth)}</span>

            <span className="text-gray-500 dark:text-gray-400">Annualized growth</span>
            <span />
            <span className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{pct1(m.annualizedWeighted)}</span>
          </div>
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
          <SummaryRow label="Original loan" value={compactMoney(m.origLoan)} />
          <SummaryRow label="Loan balance" value={compactMoney(m.loan)} />
          <SummaryRow label="Principal paid to date" value={compactMoney(m.origLoan - m.loan)} tone="text-emerald-600 dark:text-emerald-400" />
          <SummaryRow label="Weighted rate" value={ratePct(m.weightedRate)} />
          <SummaryRow label="Monthly payment" value={compactMoney(m.payment)} strong />
          <SummaryRow label="↳ Interest" value={compactMoney(m.monthlyInterest)} indent />
          <SummaryRow label="↳ Principal" value={compactMoney(m.monthlyPrincipal)} indent />
          <div className="my-1 border-t border-dashed border-gray-200 dark:border-gray-700" />
          <SummaryRow label="Annual interest" value={compactMoney(m.monthlyInterest * 12)} />
          <SummaryRow label="Annual principal" value={compactMoney(m.monthlyPrincipal * 12)} />
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
            <span className="text-gray-500 dark:text-gray-400">taxes · ins · mgmt · maint</span>
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
          <SummaryCard title={`Cashflow Summary${per}`} onExpand={() => setModal({ kind: 'cashflow' })}>
            <SummaryRow label="Gross rent" value={compactMoney(m.rent * factor)} tone="text-emerald-600 dark:text-emerald-400" />
            <SummaryRow label="Vacancy rate" value={pct1(m.rent ? -m.vacancy / m.rent : 0)} tone="text-red-600 dark:text-red-400" />
            <SummaryRow label="Operating expenses" value={compactMoney(m.opex * factor)} tone="text-red-600 dark:text-red-400" />
            <SummaryRow label="Net operating income" value={compactMoney(m.noi * factor)} strong tone={m.noi >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
            <SummaryRow label="Debt service (P&I)" value={compactMoney(m.debtService * factor)} tone="text-red-600 dark:text-red-400" />
            <div className="my-1 border-t border-dashed border-gray-200 dark:border-gray-700" />
            <SummaryRow label="Net cash flow" value={compactMoney(m.netCashFlow * factor)} strong tone={m.netCashFlow >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
          </SummaryCard>

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
              {!rentals.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-gray-400">No rentals</td></tr>}
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

      <Modal open={modal?.kind === 'appreciation'} title="Equity by Property" wide onClose={() => setModal(null)}>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-xs uppercase text-gray-400">
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="py-2.5 pr-3 text-left font-medium">Property</th>
                <th className="px-3 py-2.5 text-right font-medium">Market Value</th>
                <th className="px-3 py-2.5 text-right font-medium">Purchase</th>
                <th className="px-3 py-2.5 text-right font-medium">Appreciation</th>
                <th className="px-3 py-2.5 text-right font-medium">Growth</th>
                <th className="px-3 py-2.5 text-right font-medium">Years</th>
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
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{p.buyYear ? Math.max(m.nowYear - p.buyYear, 0) : '—'}</td>
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
                <td className="px-3 py-2.5" />
                <td className="py-2.5 pl-3 text-right text-gray-400">—</td>
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
    </Wrapper>
  )
}
