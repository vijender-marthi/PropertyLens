import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, DoorOpen, TrendingUp, Landmark, PiggyBank, Info, Home, Receipt, Wallet, Coins, Percent, Repeat, Wrench, FileText, Tag, ChevronRight } from 'lucide-react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Table2, BarChart3 } from 'lucide-react'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import { formatChartCurrency, formatCurrency } from '../utils/formatters'

// Colour by the sign of a backend money node ({value, display}).
const toneFor = (node) => ((Number(node?.value) || 0) < 0 ? 'negative' : 'positive')

// Pre-tax view — cash and profit with no capital-gains or recapture tax deducted.
const preCash = (r) => r.salePrice.value - r.sellingCosts.value - r.loanPayoff.value
const preProfit = (r) => preCash(r) + r.cumCashFlow.value - r.cashInvested.value
const asNode = (v) => ({ value: v, display: formatCurrency(v) })

const DEFAULTS = { appreciation: 4, holdYears: 10, capitalGains: 15, sellingCosts: 6, improvements: 0, rentGrowth: 3, filingStatus: 'married_joint', includePrimary: true }

function clampNum(v, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

// Numeric field the user types into (mobile keypad, no spinner).
function NumField({ label, value, onChange, min, max, suffix, step = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex items-center rounded-md border border-gray-200 bg-white px-2 py-1.5 focus-within:border-blue-400 dark:border-gray-700 dark:bg-gray-900">
        <input
          type="text"
          inputMode={step ? 'numeric' : 'decimal'}
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const raw = e.target.value.replace(step ? /[^0-9]/g : /[^0-9.]/g, '')
            onChange(raw)
          }}
          onBlur={() => onChange(String(clampNum(value, min, max)))}
          aria-label={label}
          className="w-full bg-transparent text-[13px] text-gray-900 outline-none dark:text-white"
        />
        {suffix ? <span className="ml-1 text-[11px] text-gray-400">{suffix}</span> : null}
      </div>
    </label>
  )
}

function MetricHint({ text, label }) {
  if (!text) return null
  // Only one info popover open at a time — opening this one closes the others.
  const closeOthers = (event) => {
    if (event.currentTarget.open) {
      document.querySelectorAll('details[data-metric-hint]').forEach((el) => {
        if (el !== event.currentTarget) el.open = false
      })
    }
  }
  return (
    <details data-metric-hint onToggle={closeOthers} className="group/hint relative inline-flex">
      <summary className="inline-flex cursor-pointer list-none rounded text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-gray-200"
        aria-label={`What is ${label}?`}>
        <Info className="h-3 w-3" aria-hidden="true" />
      </summary>
      <div className="absolute left-0 top-full z-30 mt-1 hidden w-60 rounded-lg border border-gray-200 bg-white p-2.5 text-left text-[11px] font-normal leading-snug text-gray-600 shadow-lg group-open/hint:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" role="tooltip">
        {text}
      </div>
    </details>
  )
}

function StatCard({ icon: Icon, label, value, tone = 'default', info }) {
  const toneCls = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'negative' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-white'
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}{label}
        <MetricHint text={info} label={label} />
      </div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  )
}

function ExitSummary({ proj }) {
  const e = proj.exit
  // op: '+' = added to profit, '-' = subtracted, undefined = a plain figure.
  // For an added line whose value is negative (e.g. cash flow that was a loss),
  // show its own "−" and colour it red instead of a confusing "+ −$…".
  const line = (label, node, op) => {
    const v = Number(node?.value) || 0
    let prefix = ''
    let cls = 'text-gray-900 dark:text-white'
    if (op === '-') { prefix = '−'; cls = 'text-red-600 dark:text-red-400' }
    else if (op === '+') {
      if (v < 0) { prefix = ''; cls = 'text-red-600 dark:text-red-400' }
      else { prefix = '+'; cls = 'text-emerald-600 dark:text-emerald-400' }
    }
    return (
      <div className="flex justify-between py-1 text-sm">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className={`tabular-nums ${cls}`}>{prefix}{node.display}</span>
      </div>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Sale math */}
      <div className="card-sm">
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Net sale proceeds · year {e.year}</h3>
        {line('Sale price', e.salePrice)}
        {line('Selling costs', e.sellingCosts, '-')}
        {line('Pay off remaining loan', e.loanPayoff, '-')}
        {line(`Depreciation recapture (25% of ${e.accumulatedDepreciation.display})`, e.recaptureTax, '-')}
        {line('Capital gains tax', e.capitalGainsTax, '-')}
        <div className="mt-1 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold dark:border-gray-700">
          <span className="text-gray-900 dark:text-white">Net proceeds</span>
          <span className={`tabular-nums ${toneFor(e.netProceeds) === 'negative' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{e.netProceeds.display}</span>
        </div>
      </div>
      {/* Lifetime profit */}
      <div className="card-sm">
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Lifetime profit if sold in year {e.year}</h3>
        {line('Net sale proceeds', e.netProceeds)}
        {line('Cumulative cash flow', e.cumulativeCashFlow, '+')}
        {line('Depreciation tax savings', e.depreciationTaxSavings, '+')}
        {line('Original cash invested', proj.originalInvested, '-')}
        <div className="mt-1 flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold dark:border-gray-700">
          <span className="text-gray-900 dark:text-white">Final profit</span>
          <span className={`tabular-nums ${toneFor(e.finalProfit) === 'negative' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{e.finalProfit.display}</span>
        </div>
      </div>
    </div>
  )
}

function YearTable({ rows }) {
  return (
    <div className="table-scroll">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="text-right text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            <th className="px-3 py-2 text-left">Year</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Loan</th>
            <th className="px-3 py-2">Equity</th>
            <th className="px-3 py-2">Depr. tax saved</th>
            <th className="px-3 py-2">Cash flow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.offset} className={`border-t border-gray-100 text-right dark:border-gray-800 ${r.offset === rows.length - 1 ? 'font-semibold' : ''}`}>
              <td className="px-3 py-2 text-left text-gray-600 dark:text-gray-300">{r.year}{r.offset === 0 ? ' (now)' : ''}{r.offset === rows.length - 1 ? ' · exit' : ''}</td>
              <td className="px-3 py-2 text-gray-900 dark:text-white">{r.valueDisplay}</td>
              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.loanBalanceDisplay}</td>
              <td className="px-3 py-2 text-gray-900 dark:text-white">{r.equityDisplay}</td>
              <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">{r.depreciationTaxSavingsDisplay}</td>
              <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">{r.cashFlowDisplay}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProjectionChart({ rows }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="exitValueFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.24} />
              <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="year" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={52} tickFormatter={formatChartCurrency} />
          <Tooltip formatter={(value) => formatChartCurrency(value)} contentStyle={chartTooltipStyle(false)} />
          <Area type="monotone" dataKey="value" name="Market value" stroke={chartColors.primary} strokeWidth={2} fill="url(#exitValueFill)" dot={false} />
          <Line type="monotone" dataKey="equity" name="Equity" stroke={chartColors.positive} strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="loanBalance" name="Loan" stroke={chartColors.danger} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function moneyCell(node, { signed = false } = {}) {
  const v = Number(node?.value) || 0
  const cls = signed
    ? (v < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')
    : 'text-gray-900 dark:text-white'
  return <span className={`tabular-nums ${cls}`}>{node?.display ?? '—'}</span>
}

function SellYearTable({ title, subtitle, rows, columns }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {columns.map((c) => <th key={c.key} className={`px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : ''} ${c.headClass || ''}`}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.yearNumber} className="border-t border-gray-100 dark:border-gray-800">
                {columns.map((c) => <td key={c.key} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const yearCol = { key: 'year', label: 'Sell in', render: (r) => <span className="whitespace-nowrap font-medium text-gray-900 dark:text-white">Yr {r.yearNumber} · {r.year}</span> }

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p> : null}
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  )
}

function ExitCharts({ rows, breakEven }) {
  const data = rows.map((r) => ({
    label: `Yr ${r.yearNumber}`,
    gainLoss: r.gainLoss.value,
    salePrice: r.salePrice.value,
    cash: r.netProceeds.value,
    excluded: r.section121Excluded.value,
    taxable: r.taxableCapitalGain.value,
    recapture: r.recaptureAmount.value,
  }))
  const tip = (v) => formatCurrency(v)
  const axis = { tick: chartTypography.smallMutedTick, axisLine: false, tickLine: false }
  return (
    <div className="space-y-4">
      <ChartCard title="Lifetime gain / loss if sold in year N"
        subtitle={`Green = profit, red = loss.${breakEven ? ` Breaks even in year ${breakEven}.` : ''}`}>
        <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={52} tickFormatter={formatChartCurrency} />
          <Tooltip formatter={tip} contentStyle={chartTooltipStyle(false)} />
          <ReferenceLine y={0} stroke={chartColors.mutedAxis} />
          <Bar dataKey="gainLoss" name="Gain / loss" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.gainLoss < 0 ? chartColors.danger : chartColors.positive} />)}
          </Bar>
        </BarChart>
      </ChartCard>

      <ChartCard title="Sale price vs. cash to your account"
        subtitle="How much of each year's sale price you actually keep after loan payoff and taxes.">
        <ComposedChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={52} tickFormatter={formatChartCurrency} />
          <Tooltip formatter={tip} contentStyle={chartTooltipStyle(false)} />
          <Legend />
          <Area type="monotone" dataKey="salePrice" name="Sale price" stroke={chartColors.primary} fill={chartColors.primary} fillOpacity={0.12} strokeWidth={2} />
          <Bar dataKey="cash" name="Cash to account" fill={chartColors.positive} radius={[3, 3, 0, 0]} barSize={16} />
        </ComposedChart>
      </ChartCard>

      <ChartCard title="Capital gain — excluded vs. taxable vs. recapture"
        subtitle="§121 shelters part of the gain; depreciation recapture is always taxable.">
        <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={52} tickFormatter={formatChartCurrency} />
          <Tooltip formatter={tip} contentStyle={chartTooltipStyle(false)} />
          <Legend />
          <Bar dataKey="excluded" name="§121 excluded" stackId="g" fill={chartColors.positive} />
          <Bar dataKey="taxable" name="Taxable gain" stackId="g" fill={chartColors.warning || '#f59e0b'} />
          <Bar dataKey="recapture" name="Deprec. recapture" stackId="g" fill={chartColors.danger} />
        </BarChart>
      </ChartCard>
    </div>
  )
}

function Waterfall({ row }) {
  const sale = row.salePrice.value
  const costs = row.sellingCosts.value
  const loan = row.loanPayoff.value
  const cash = preCash(row)
  const flow = row.cumCashFlow.value
  const invested = row.cashInvested.value
  const profit = preProfit(row)
  const c1 = sale - costs, c2 = c1 - loan, af = cash + flow
  const bars = [
    { l: 'Sale', v: sale, col: '#378ADD', bot: 0, top: sale, end: sale },
    { l: 'Costs', v: costs, sub: true, col: '#BA7517', bot: c1, top: sale, end: c1 },
    { l: 'Loan', v: loan, sub: true, col: '#7F77DD', bot: c2, top: c1, end: c2 },
    { l: 'Cash', v: cash, col: '#1D9E75', bot: 0, top: cash, end: cash },
    { l: 'Cash flow', v: Math.abs(flow), sub: flow < 0, col: flow < 0 ? '#E24B4A' : '#639922', bot: Math.min(cash, af), top: Math.max(cash, af), end: af },
    { l: 'Invested', v: invested, sub: true, col: '#888780', bot: af - invested, top: af, end: af - invested },
    { l: 'Profit', v: profit, col: profit < 0 ? '#E24B4A' : '#639922', bot: Math.min(profit, 0), top: Math.max(profit, 0), end: profit },
  ]
  const W = 700, H = 210, topPad = 24, botPad = 30, n = bars.length
  const colW = W / n, bw = colW * 0.6
  const maxLvl = Math.max(...bars.map((b) => b.top))
  const minLvl = Math.min(0, ...bars.map((b) => b.bot))
  const span = (maxLvl - minLvl) || 1
  const scale = (H - topPad - botPad) / span
  const y = (lvl) => (H - botPad) - (lvl - minLvl) * scale
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-gray-400 dark:text-gray-500" style={{ height: 'auto' }} role="img" aria-label="Sale price to profit waterfall">
      {bars.map((b, i) => {
        const x = i * colW + (colW - bw) / 2
        const yTop = y(b.top), h = Math.max((b.top - b.bot) * scale, 2)
        return (
          <g key={i}>
            {i < n - 1 ? <line x1={x + bw} y1={y(b.end)} x2={(i + 1) * colW + (colW - bw) / 2} y2={y(b.end)} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="3 3" /> : null}
            <rect x={x} y={yTop} width={bw} height={h} rx="2.5" fill={b.col} />
            <text x={x + bw / 2} y={yTop - 6} textAnchor="middle" fontSize="11" fill="currentColor">{b.sub ? '−' : ''}{formatChartCurrency(b.v)}</text>
            <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="currentColor">{b.l}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Breakdown({ row, sellingCostsPct, isPrimary }) {
  const cash = asNode(preCash(row))
  const profit = asNode(preProfit(row))
  const Line = ({ icon: Icon, label, node, op, strong, indent, note, info }) => {
    const v = Number(node?.value) || 0
    let prefix = '', cls = 'text-gray-900 dark:text-white'
    if (op === '-') { prefix = '− '; cls = 'text-red-600 dark:text-red-400' }
    else if (op === '+') { if (v < 0) { prefix = ''; cls = 'text-red-600 dark:text-red-400' } else { prefix = '+ '; cls = 'text-emerald-600 dark:text-emerald-400' } }
    return (
      <div className={`flex items-center gap-2 py-1 ${indent ? 'pl-5 text-[13px]' : 'text-sm'}`}>
        <Icon className={`${indent ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-blue-500 dark:text-blue-400`} aria-hidden="true" />
        <span className={strong ? 'font-medium text-blue-700 dark:text-blue-300' : indent ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-300'}>{label}</span>
        {note ? <span className="hidden text-[11px] text-gray-400 dark:text-gray-500 sm:inline">· {note}</span> : null}
        <MetricHint text={info} label={label} />
        <span className={`ml-auto tabular-nums ${strong ? 'font-semibold text-gray-900 dark:text-white' : cls}`}>{prefix}{node?.display ?? '—'}</span>
      </div>
    )
  }
  // Expandable parent line: click to reveal indented sub-items below it.
  const GroupLine = ({ icon: Icon, label, node, op, info, note, indent, children }) => {
    let prefix = '', cls = 'text-gray-900 dark:text-white'
    if (op === '-') { prefix = '− '; cls = 'text-red-600 dark:text-red-400' }
    return (
      <details className="group/gl">
        <summary className={`flex cursor-pointer list-none items-center gap-2 py-1 ${indent ? 'pl-5 text-[13px]' : 'text-sm'}`}>
          <ChevronRight className={`${indent ? 'h-3 w-3' : 'h-3.5 w-3.5'} shrink-0 text-gray-400 transition-transform group-open/gl:rotate-90`} aria-hidden="true" />
          <Icon className={`${indent ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-blue-500 dark:text-blue-400`} aria-hidden="true" />
          <span className={indent ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-300'}>{label}</span>
          {note ? <span className="hidden text-[11px] text-gray-400 dark:text-gray-500 sm:inline">· {note}</span> : null}
          <MetricHint text={info} label={label} />
          <span className={`ml-auto tabular-nums ${cls}`}>{prefix}{node?.display ?? '—'}</span>
        </summary>
        <div className={`${indent ? 'ml-8' : 'ml-[9px]'} border-l border-gray-100 dark:border-gray-800`}>
          {children}
        </div>
      </details>
    )
  }
  const ACCENTS = {
    blue: { border: 'border-blue-200 dark:border-blue-900/50', head: 'bg-blue-50 dark:bg-blue-950/30', chip: 'bg-blue-600 text-white', title: 'text-blue-700 dark:text-blue-300' },
    amber: { border: 'border-amber-200 dark:border-amber-900/50', head: 'bg-amber-50 dark:bg-amber-950/30', chip: 'bg-amber-500 text-white', title: 'text-amber-700 dark:text-amber-300' },
    emerald: { border: 'border-emerald-200 dark:border-emerald-900/50', head: 'bg-emerald-50 dark:bg-emerald-950/30', chip: 'bg-emerald-600 text-white', title: 'text-emerald-700 dark:text-emerald-300' },
  }
  const Block = ({ n, title, subtitle, accent, children }) => {
    const a = ACCENTS[accent]
    return (
      <div className={`rounded-xl border ${a.border}`}>
        <div className={`flex flex-wrap items-center gap-x-2 rounded-t-xl px-3 py-2 ${a.head}`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${a.chip}`}>{n}</span>
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${a.title}`}>{title}</span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">· {subtitle}</span>
        </div>
        <div className="px-3 py-2">{children}</div>
      </div>
    )
  }
  return (
    <div className="mt-4 space-y-2.5">
      <Block n="1" accent="blue" title="Cash at closing" subtitle="what you walk away with at the sale">
        <Line icon={TrendingUp} label="Sale price" node={row.salePrice} strong info="Projected market value in the sale year — today's value grown at your appreciation rate each year." />
        <Line icon={Receipt} label={`Selling costs (${Math.round(sellingCostsPct)}%)`} node={row.sellingCosts} op="-" info={`Agent commissions, closing costs and fees — about ${Math.round(sellingCostsPct)}% of the sale price.`} />
        <Line icon={Landmark} label="Loan payoff" node={row.loanPayoff} op="-" info="The remaining mortgage balance you pay off at closing." />
        <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
        <Line icon={Wallet} label="Cash to your account" node={cash} strong info="Sale price − selling costs − loan payoff." />
      </Block>

      {isPrimary ? (
        <Block n="2" accent="amber" title="While you owned it" subtitle="mortgage & costs — not counted in your home's profit">
          <GroupLine icon={Landmark} label="Mortgage payments" node={row.cumMortgagePayment} info="Total principal + interest paid over ownership. Shown for reference — a primary residence's profit isn't reduced by what you paid to live there.">
            <Line icon={Coins} label="Principal paid" node={asNode((row.cumMortgagePayment?.value || 0) - (row.cumMortgageInterest?.value || 0))} indent info="The part of your payments that reduced the loan balance." />
            <Line icon={Percent} label="Interest paid" node={row.cumMortgageInterest} indent info="The interest portion of your mortgage payments." />
          </GroupLine>
          <GroupLine icon={Wrench} label="Operating expenses" node={row.cumExpenses} info="Insurance, HOA, maintenance and property taxes over ownership. Reference only — not subtracted from your home's profit.">
            <Line icon={Landmark} label="Property taxes" node={row.cumPropertyTaxes} indent info="Property taxes paid over the ownership period." />
            <Line icon={Wrench} label="Other expenses" node={asNode((row.cumExpenses?.value || 0) - (row.cumPropertyTaxes?.value || 0))} indent info="Insurance, HOA, management and maintenance over the ownership period." />
          </GroupLine>
        </Block>
      ) : (
        <Block n="2" accent="amber" title="Cash flow while you owned it" subtitle="rent minus costs over the years">
          <Line icon={Repeat} label="Cumulative cash flow" node={row.cumCashFlow} op="+" info="Net rental cash over the full ownership: rent − operating expenses − mortgage payments. The three lines below sum to this." />
          <Line icon={Home} label="Rent received" node={row.cumRentReceived} op="+" indent info="Total rent collected over the ownership period." />
          <GroupLine icon={Wrench} label="Operating expenses" node={row.cumExpenses} op="-" indent info="Insurance, HOA, management, maintenance and property taxes over ownership.">
            <Line icon={Landmark} label="Property taxes" node={row.cumPropertyTaxes} indent info="Property taxes paid over the ownership period." />
            <Line icon={Wrench} label="Other expenses" node={asNode((row.cumExpenses?.value || 0) - (row.cumPropertyTaxes?.value || 0))} indent info="Insurance, HOA, management and maintenance over the ownership period." />
          </GroupLine>
          <GroupLine icon={Landmark} label="Mortgage payments" node={row.cumMortgagePayment} op="-" indent info="Total principal + interest paid over the ownership period.">
            <Line icon={Coins} label="Principal paid" node={asNode((row.cumMortgagePayment?.value || 0) - (row.cumMortgageInterest?.value || 0))} indent info="The part of your payments that reduced the loan balance." />
            <Line icon={Percent} label="Interest paid" node={row.cumMortgageInterest} indent info="The interest portion of your mortgage payments." />
          </GroupLine>
        </Block>
      )}

      <Block n="3" accent="emerald" title="Your return" subtitle="profit after the capital you put in">
        <Line icon={Coins} label="Cash invested" node={row.cashInvested} op="-" info="Your original down payment + closing costs (plus any improvements) — the capital you put in." />
        <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
        <Line icon={DoorOpen} label="Lifetime profit" node={profit} strong info={isPrimary ? "Cash to your account − cash invested. Pre-tax. Mortgage and running costs aren't subtracted for a home you live in." : "Cash to your account + cumulative cash flow − cash invested. Pre-tax."} />
      </Block>
    </div>
  )
}

function ProfitTrend({ rows, selected }) {
  const data = rows.map((r) => ({ label: `Yr ${r.yearNumber}`, profit: preProfit(r) }))
  const selLabel = `Yr ${selected}`
  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ left: 0, right: 4, top: 6, bottom: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <XAxis dataKey="label" hide />
          <ReferenceLine y={0} stroke={chartColors.mutedAxis} />
          <ReferenceLine x={selLabel} stroke={chartColors.primary} strokeDasharray="3 3" />
          <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={chartTooltipStyle(false)} labelStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="profit" stroke={chartColors.primary} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function PortfolioSummary({ properties, onPick }) {
  const rows = properties.map((p) => {
    const y1 = p.sellYears[0]
    let best = y1
    for (const r of p.sellYears) if (preProfit(r) > preProfit(best)) best = r
    return { id: p.id, name: p.name, now: preProfit(y1), saleNow: y1.salePrice.value, invested: y1.cashInvested.value, bestYr: best.yearNumber, bestCal: best.year, bestProfit: preProfit(best) }
  }).sort((a, b) => b.now - a.now)
  const totalNow = rows.reduce((s, r) => s + r.now, 0)
  const totalSale = rows.reduce((s, r) => s + r.saleNow, 0)
  const totalInvested = rows.reduce((s, r) => s + r.invested, 0)
  const inBlack = rows.filter((r) => r.now >= 0).length
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.now)))
  const Kpi = ({ label, value, tone }) => (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone === 'neg' ? 'text-red-600 dark:text-red-400' : tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white'}`}>{value}</div>
    </div>
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Lifetime profit · sell all now" value={formatCurrency(totalNow)} tone={totalNow < 0 ? 'neg' : 'pos'} />
        <Kpi label="Total sale value" value={formatCurrency(totalSale)} />
        <Kpi label="Capital invested" value={formatCurrency(totalInvested)} />
        <Kpi label="Profitable" value={`${inBlack} of ${rows.length}`} />
      </div>

      <div className="card">
        <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">Lifetime profit by property · if sold today</h2>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Pre-tax. Click a property to open its plan.</p>
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r.id)} className="flex w-full items-center gap-3 text-left">
              <span className="w-24 shrink-0 truncate text-[13px] text-gray-600 dark:text-gray-300">{r.name}</span>
              <span className="relative h-4 flex-1 rounded bg-gray-100/70 dark:bg-gray-800/40">
                <span className="absolute top-0 h-4 rounded" style={{ left: 0, width: `${Math.abs(r.now) / maxAbs * 100}%`, background: r.now < 0 ? '#E24B4A' : '#1D9E75' }} />
              </span>
              <span className={`w-20 shrink-0 text-right text-[13px] tabular-nums ${r.now < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatChartCurrency(r.now)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Best time to sell</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                <th className="px-2 py-1.5 font-medium">Property</th>
                <th className="px-2 py-1.5 font-medium">Best year</th>
                <th className="px-2 py-1.5 text-right font-medium">Profit then</th>
                <th className="px-2 py-1.5 text-right font-medium">Vs. now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1.5 text-gray-900 dark:text-white">{r.name}</td>
                  <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">{r.bestCal} · yr {r.bestYr}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.bestProfit)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.bestProfit - r.now < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{(r.bestProfit - r.now >= 0 ? '+' : '')}{formatChartCurrency(r.bestProfit - r.now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500">Pre-tax lifetime profit if sold in year 1 (today) vs. the best sell year for each property. Estimates, not advice.</p>
    </>
  )
}

export default function ExitPlannerPage() {
  const [inputs, setInputs] = useState(DEFAULTS)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [sellYear, setSellYear] = useState(null)
  const debounceRef = useRef(null)

  const update = (patch) => setInputs((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    let active = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      propAPI.exitPlanner({
        appreciation: clampNum(inputs.appreciation, 0, 30),
        capital_gains: clampNum(inputs.capitalGains, 0, 40),
        selling_costs: clampNum(inputs.sellingCosts, 0, 15),
        hold_years: clampNum(inputs.holdYears, 1, 10),
        improvements: Math.max(0, Number(inputs.improvements) || 0),
        rent_growth: clampNum(inputs.rentGrowth, 0, 15),
        filing_status: inputs.filingStatus,
        include_primary_residence: inputs.includePrimary,
      }).then((res) => {
        if (!active) return
        setData(res.data)
        setError(null)
        setSelectedId((cur) => {
          const ids = (res.data?.properties || []).map((p) => p.id)
          return cur && ids.includes(cur) ? cur : ids[0] ?? null
        })
      }).catch(() => { if (active) setError('Could not load the exit plan.') })
        .finally(() => { if (active) setLoading(false) })
    }, 260)
    return () => { active = false }
  }, [inputs])

  const properties = data?.properties || []
  const isPortfolio = selectedId === 'all'
  const selected = useMemo(() => (isPortfolio ? null : (properties.find((p) => p.id === selectedId) || properties[0])), [properties, selectedId, isPortfolio])
  const portfolio = data?.portfolio

  // Default the sell-year to the break-even year (the decision point), or the
  // last year; keep the user's choice if still valid for the selected property.
  useEffect(() => {
    if (!selected) return
    const years = selected.sellYears.map((r) => r.yearNumber)
    setSellYear((cur) => (cur && years.includes(cur) ? cur : (selected.breakEvenYear || years[years.length - 1])))
  }, [selected])

  const row = selected ? (selected.sellYears.find((r) => r.yearNumber === sellYear) || selected.sellYears[0]) : null
  const maxSale = selected ? Math.max(...selected.sellYears.map((r) => r.salePrice.value)) : 0
  const breakEvenYear = selected ? (selected.sellYears.find((r) => preProfit(r) >= 0)?.yearNumber ?? null) : null

  return (
    <PageContainer>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
            <DoorOpen className="h-4 w-4" aria-hidden="true" /> Exit planner
          </div>
          <h1 className="mt-1 truncate text-2xl font-bold text-gray-900 dark:text-white">
            {isPortfolio ? 'Portfolio' : (selected ? selected.name : 'Exit planner')}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {isPortfolio
              ? 'Lifetime sell profit across every property, and the best year to sell each.'
              : selected
                ? `${selected.useLabel} · year-by-year sale price, cash flow and pre-tax profit.`
                : 'Project each property forward and see the cash to your account and profit by sell year.'}
          </p>
        </div>
        {portfolio ? (
          (() => {
            const pos = toneFor(portfolio.finalProfit) === 'positive'
            const box = pos ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40' : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
            const txt = pos ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
            return (
              <div className={`shrink-0 rounded-xl border px-4 py-2 text-right ${box}`}>
                <div className={`text-[11px] ${txt}`}>Portfolio profit · exit all in year {data.assumptions.asOfYear + data.assumptions.holdYears}</div>
                <div className={`text-xl font-bold tabular-nums ${txt}`}>{portfolio.finalProfit.display}</div>
                <div className={`text-[11px] ${txt} opacity-80`}>{portfolio.propertyCount} propert{portfolio.propertyCount === 1 ? 'y' : 'ies'}</div>
              </div>
            )
          })()
        ) : null}
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Results (left) */}
        <div className="order-2 min-w-0 flex-1 space-y-6 lg:order-1">
          {error ? (
            <div className="card flex items-center gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="card py-10 text-center text-sm text-gray-500 dark:text-gray-400">Projecting exit scenarios…</div>
          ) : properties.length === 0 ? (
            <div className="card py-10 text-center text-sm text-gray-500 dark:text-gray-400">No rental properties to plan an exit for.</div>
          ) : isPortfolio ? (
            <PortfolioSummary properties={properties} onPick={setSelectedId} />
          ) : selected && row ? (
            <>
              {/* Verdict strip */}
              <div className="card-sm flex flex-wrap items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                  <DoorOpen className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-500 dark:text-gray-400">{selected.name} · {selected.useLabel}</div>
                  <div className="text-base font-semibold text-gray-900 dark:text-white">If you sell in year {row.yearNumber} · {row.year}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">Lifetime profit (pre-tax)</div>
                  <div className={`text-xl font-bold tabular-nums ${preProfit(row) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{formatCurrency(preProfit(row))}</div>
                </div>
              </div>

              {/* Profit trend + year buttons — the control, up top */}
              <div className="card">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Lifetime profit by sell year</h2>
                  {breakEvenYear ? <span className="text-xs text-gray-500 dark:text-gray-400">breaks even in year {breakEvenYear}</span> : null}
                </div>
                <ProfitTrend rows={selected.sellYears} selected={row.yearNumber} />
                <div className="mt-3">
                  <div className="mb-1.5 text-[11px] text-gray-500 dark:text-gray-400">Sell in year</div>
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${selected.sellYears.length}, minmax(0, 1fr))` }}>
                    {selected.sellYears.map((r) => {
                      const on = r.yearNumber === row.yearNumber
                      return (
                        <button key={r.yearNumber} type="button" onClick={() => setSellYear(r.yearNumber)}
                          className={`rounded-md border py-1.5 text-xs font-medium transition-colors ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:text-blue-300'}`}>
                          Yr {r.yearNumber}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Waterfall — detail for the picked year */}
              <div className="card">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Sale price to profit</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">where year {row.yearNumber}&apos;s sale price goes</span>
                </div>
                <Waterfall row={row} maxSale={maxSale} />
                <Breakdown row={row} sellingCostsPct={data.assumptions.sellingCosts} isPrimary={selected.isPrimary} />
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Rent received', v: row.cumRentReceived.display },
                    { label: 'Mortgage interest', v: row.cumMortgageInterest.display },
                    { label: 'Operating expenses', v: row.cumExpenses.display },
                    { label: 'Cash-on-cash', v: row.cashOnCash?.display ?? '—' },
                  ].map((c) => (
                    <div key={c.label} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{c.label}</div>
                      <div className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{c.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Year-by-year table — all sell years */}
              <details className="card-sm" open>
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <Table2 className="h-4 w-4" /> Profit if you sell in each year
                </summary>
                <div className="mt-3">
                  <SellYearTable
                    rows={selected.sellYears}
                    columns={[
                      yearCol,
                      { key: 'salePrice', label: 'Sale price', align: 'right', headClass: 'text-blue-600 dark:text-blue-300', render: (r) => moneyCell(r.salePrice) },
                      { key: 'sellingCosts', label: 'Selling costs', align: 'right', headClass: 'text-blue-600 dark:text-blue-300', render: (r) => moneyCell(r.sellingCosts) },
                      { key: 'loanPayoff', label: 'Loan payoff', align: 'right', headClass: 'text-blue-600 dark:text-blue-300', render: (r) => moneyCell(r.loanPayoff) },
                      { key: 'cash', label: 'Cash to account', align: 'right', headClass: 'text-blue-600 dark:text-blue-300', render: (r) => <span className="font-semibold">{moneyCell(asNode(preCash(r)))}</span> },
                      { key: 'flow', label: 'Cash flow', align: 'right', headClass: 'text-amber-600 dark:text-amber-300', render: (r) => moneyCell(r.cumCashFlow, { signed: true }) },
                      { key: 'invested', label: 'Invested', align: 'right', headClass: 'text-emerald-600 dark:text-emerald-300', render: (r) => moneyCell(r.cashInvested) },
                      { key: 'profit', label: 'Profit', align: 'right', headClass: 'text-emerald-600 dark:text-emerald-300', render: (r) => <span className="font-semibold">{moneyCell(asNode(preProfit(r)), { signed: true })}</span> },
                    ]}
                  />
                </div>
              </details>

              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Pre-tax view — sale proceeds and profit before capital-gains or depreciation-recapture tax. Estimates, not advice.
              </p>
            </>
          ) : null}
        </div>

        {/* Control panel (right, sticky) — property + assumptions */}
        <aside className="order-1 lg:order-2 lg:w-80 lg:shrink-0">
          <div className="space-y-4 lg:sticky lg:top-4">
            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Exit plan</h2>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">Property</span>
                <select
                  value={isPortfolio ? 'all' : (selected?.id ?? '')}
                  onChange={(e) => { const v = e.target.value; setSelectedId(v === 'all' ? 'all' : Number(v)) }}
                  disabled={properties.length === 0}
                  aria-label="Property"
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  {properties.length === 0 ? <option value="">No rentals</option> : null}
                  <option value="all">All properties · portfolio</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.exit.finalProfit.display}</option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Assumptions</div>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Appreciation / yr" value={inputs.appreciation} onChange={(v) => update({ appreciation: v })} min={0} max={30} suffix="%" />
                  <NumField label="Hold (max)" value={inputs.holdYears} onChange={(v) => update({ holdYears: v })} min={1} max={10} suffix="yrs" step />
                  <NumField label="Capital gains" value={inputs.capitalGains} onChange={(v) => update({ capitalGains: v })} min={0} max={40} suffix="%" />
                  <NumField label="Selling costs" value={inputs.sellingCosts} onChange={(v) => update({ sellingCosts: v })} min={0} max={15} suffix="%" />
                  <NumField label="Rent growth / yr" value={inputs.rentGrowth} onChange={(v) => update({ rentGrowth: v })} min={0} max={15} suffix="%" />
                  <NumField label="Remodel / improv. ($)" value={inputs.improvements} onChange={(v) => update({ improvements: v })} min={0} max={5000000} step />
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">Filing status (§121 exclusion)</span>
                <select
                  value={inputs.filingStatus}
                  onChange={(e) => update({ filingStatus: e.target.value })}
                  aria-label="Filing status"
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="married_joint">Married filing jointly — $500k tax-free</option>
                  <option value="single">Single — $250k tax-free</option>
                </select>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={inputs.includePrimary}
                  onChange={(e) => update({ includePrimary: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                />
                Include primary home
              </label>

              <p className="text-[11px] text-gray-400 dark:text-gray-500">Primary vs rental and the §121 2-of-5-year eligibility are read from each property's Rental section. Depreciation recapture is always taxed at 25%. Estimates, not tax advice.</p>
            </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}
