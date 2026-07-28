import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, DoorOpen, TrendingUp, Landmark, PiggyBank } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import { formatChartCurrency } from '../utils/formatters'

// Colour by the sign of a backend money node ({value, display}).
const toneFor = (node) => ((Number(node?.value) || 0) < 0 ? 'negative' : 'positive')

const DEFAULTS = { appreciation: 4, holdYears: 10, marginalTax: 24, capitalGains: 15, sellingCosts: 6 }

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

function StatCard({ icon: Icon, label, value, tone = 'default' }) {
  const toneCls = tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'negative' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-white'
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}{label}
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
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Net sale proceeds · {e.year}</h3>
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
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Lifetime profit if sold in {e.year}</h3>
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

export default function ExitPlannerPage() {
  const [inputs, setInputs] = useState(DEFAULTS)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const debounceRef = useRef(null)

  const update = (patch) => setInputs((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    let active = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      propAPI.exitPlanner({
        appreciation: clampNum(inputs.appreciation, 0, 30),
        marginal_tax: clampNum(inputs.marginalTax, 0, 50),
        capital_gains: clampNum(inputs.capitalGains, 0, 40),
        selling_costs: clampNum(inputs.sellingCosts, 0, 15),
        hold_years: clampNum(inputs.holdYears, 1, 30),
      }).then((res) => {
        if (!active) return
        setData(res.data)
        setError(null)
        setSelectedId((cur) => cur ?? res.data?.properties?.[0]?.id ?? null)
      }).catch(() => { if (active) setError('Could not load the exit plan.') })
        .finally(() => { if (active) setLoading(false) })
    }, 260)
    return () => { active = false }
  }, [inputs])

  const properties = data?.properties || []
  const selected = useMemo(() => properties.find((p) => p.id === selectedId) || properties[0], [properties, selectedId])
  const portfolio = data?.portfolio

  return (
    <PageContainer>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
            <DoorOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />Exit planner
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Project each property forward at your appreciation rate, tally depreciation tax savings by year, and see the net proceeds and final profit after recapture and capital gains.
          </p>
        </div>
        {portfolio ? (
          (() => {
            const pos = toneFor(portfolio.finalProfit) === 'positive'
            const box = pos ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40' : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
            const txt = pos ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
            return (
              <div className={`shrink-0 rounded-xl border px-4 py-2 text-right ${box}`}>
                <div className={`text-[11px] ${txt}`}>Portfolio profit · exit all in {data.assumptions.asOfYear + data.assumptions.holdYears}</div>
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
          ) : selected ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard icon={TrendingUp} label={`Sale price · ${selected.exit.year}`} value={selected.exit.salePrice.display} />
                <StatCard icon={Landmark} label="Net proceeds" value={selected.exit.netProceeds.display} tone={toneFor(selected.exit.netProceeds)} />
                <StatCard icon={PiggyBank} label="Depreciation tax saved" value={selected.exit.depreciationTaxSavings.display} tone="positive" />
                <StatCard icon={DoorOpen} label="Final profit" value={selected.exit.finalProfit.display} tone={toneFor(selected.exit.finalProfit)} />
              </div>

              <div className="card">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{selected.name} — value, equity &amp; loan over time</h2>
                  <div className="flex gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: chartColors.primary }} />value</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: chartColors.positive }} />equity</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: chartColors.danger }} />loan</span>
                  </div>
                </div>
                <ProjectionChart rows={selected.rows} />
              </div>

              <ExitSummary proj={selected} />

              <details className="card-sm">
                <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-white">{selected.name} — year-by-year detail</summary>
                <div className="mt-3"><YearTable rows={selected.rows} /></div>
              </details>
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
                  value={selected?.id ?? ''}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                  disabled={properties.length === 0}
                  aria-label="Property"
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  {properties.length === 0 ? <option value="">No rentals</option> : null}
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.exit.finalProfit.display}</option>
                  ))}
                </select>
              </label>

              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">Assumptions</div>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="Appreciation / yr" value={inputs.appreciation} onChange={(v) => update({ appreciation: v })} min={0} max={30} suffix="%" />
                  <NumField label="Hold" value={inputs.holdYears} onChange={(v) => update({ holdYears: v })} min={1} max={30} suffix="yrs" step />
                  <NumField label="Marginal tax" value={inputs.marginalTax} onChange={(v) => update({ marginalTax: v })} min={0} max={50} suffix="%" />
                  <NumField label="Capital gains" value={inputs.capitalGains} onChange={(v) => update({ capitalGains: v })} min={0} max={40} suffix="%" />
                  <NumField label="Selling costs" value={inputs.sellingCosts} onChange={(v) => update({ sellingCosts: v })} min={0} max={15} suffix="%" />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Long-run home appreciation is typically ~3–4%/yr; depreciation recapture is fixed at the IRS 25%.</p>
            </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}
