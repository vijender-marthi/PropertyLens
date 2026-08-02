import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, DoorOpen, TrendingUp, Landmark, PiggyBank, Info } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import { formatChartCurrency } from '../utils/formatters'

// Colour by the sign of a backend money node ({value, display}).
const toneFor = (node) => ((Number(node?.value) || 0) < 0 ? 'negative' : 'positive')

const DEFAULTS = { appreciation: 4, holdYears: 10, capitalGains: 15, sellingCosts: 6, improvements: 0, filingStatus: 'married_joint', includePrimary: true }

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
  return (
    <details className="group/hint relative inline-flex">
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
              {columns.map((c) => <th key={c.key} className={`px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}
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
        capital_gains: clampNum(inputs.capitalGains, 0, 40),
        selling_costs: clampNum(inputs.sellingCosts, 0, 15),
        hold_years: clampNum(inputs.holdYears, 1, 10),
        improvements: Math.max(0, Number(inputs.improvements) || 0),
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
          {selected ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
              <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Viewing: {selected.name}
              <span className="font-normal text-blue-400/70 dark:text-blue-400/60">· final profit</span>
              <span className={`font-semibold ${toneFor(selected.exit.finalProfit) === 'negative' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{selected.exit.finalProfit.display}</span>
            </div>
          ) : null}
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
          ) : selected ? (
            <>
              {/* Use classification + §121 status */}
              <div className="card-sm flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">{selected.useLabel}</span>
                {selected.sellYears.some((r) => r.section121Eligible) ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    §121 primary-home exclusion applies — up to {selected.exclusionCap.display} tax-free
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    §121 exclusion unavailable — rental, or outside the 2-of-5-year primary window
                  </span>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Cash invested {selected.cashInvested.display}{selected.breakEvenYear ? ` · breaks even in year ${selected.breakEvenYear}` : ''}
                </span>
              </div>

              {/* Section 1: Cash to account */}
              <SellYearTable
                title="Cash to your account — by sell year"
                subtitle="Net cash at closing (sale − selling costs − loan payoff − taxes), and your lifetime gain or loss if you sell that year."
                rows={selected.sellYears}
                columns={[
                  yearCol,
                  { key: 's121', label: '§121', render: (r) => r.section121Eligible ? <span className="text-emerald-600 dark:text-emerald-400">Yes</span> : <span className="text-gray-300 dark:text-gray-600">—</span> },
                  { key: 'salePrice', label: 'Sale price', align: 'right', render: (r) => moneyCell(r.salePrice) },
                  { key: 'loanPayoff', label: 'Loan payoff', align: 'right', render: (r) => moneyCell(r.loanPayoff) },
                  { key: 'netProceeds', label: 'Cash to account', align: 'right', render: (r) => <span className="font-semibold">{moneyCell(r.netProceeds)}</span> },
                  { key: 'gainLoss', label: 'Gain / loss', align: 'right', render: (r) => moneyCell(r.gainLoss, { signed: true }) },
                ]}
              />

              {/* Section 2: Taxable capital gain */}
              <SellYearTable
                title="Taxable capital gain — by sell year"
                subtitle="Total gain, minus the §121 exclusion where it applies, plus depreciation recapture (always taxed at 25%)."
                rows={selected.sellYears}
                columns={[
                  yearCol,
                  { key: 'totalGain', label: 'Total gain', align: 'right', render: (r) => moneyCell(r.totalGain) },
                  { key: 'recapture', label: 'Deprec. recapture', align: 'right', render: (r) => moneyCell(r.recaptureAmount) },
                  { key: 's121excl', label: '§121 excluded', align: 'right', render: (r) => moneyCell(r.section121Excluded) },
                  { key: 'taxable', label: 'Taxable gain', align: 'right', render: (r) => <span className="font-semibold">{moneyCell(r.taxableCapitalGain)}</span> },
                  { key: 'cgtax', label: 'Cap-gains tax', align: 'right', render: (r) => moneyCell(r.capitalGainsTax) },
                  { key: 'rectax', label: 'Recapture tax', align: 'right', render: (r) => moneyCell(r.recaptureTax) },
                ]}
              />

              {/* Section 3: Operating totals through sale */}
              <SellYearTable
                title="Operating totals through sale — by sell year"
                subtitle="Cumulative rental income, mortgage interest, property taxes, expenses and net cash flow you'd have collected by that year."
                rows={selected.sellYears}
                columns={[
                  yearCol,
                  { key: 'rent', label: 'Rent received', align: 'right', render: (r) => moneyCell(r.cumRentReceived) },
                  { key: 'interest', label: 'Mortgage int.', align: 'right', render: (r) => moneyCell(r.cumMortgageInterest) },
                  { key: 'ptax', label: 'Property taxes', align: 'right', render: (r) => moneyCell(r.cumPropertyTaxes) },
                  { key: 'exp', label: 'Expenses', align: 'right', render: (r) => moneyCell(r.cumExpenses) },
                  { key: 'cf', label: 'Net cash flow', align: 'right', render: (r) => moneyCell(r.cumCashFlow, { signed: true }) },
                  { key: 'coc', label: 'Cash-on-cash', align: 'right', render: (r) => <span className="tabular-nums text-gray-500 dark:text-gray-400">{r.cashOnCash?.display ?? '—'}</span> },
                ]}
              />

              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Estimates using simplified §121 rules (2-of-5-year test derived from your Rental section, {selected.exit ? '' : ''}$250k single / $500k married-jointly). Depreciation recapture is always taxed at 25%. Not tax advice — confirm with a tax professional.
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
                  <NumField label="Hold (max)" value={inputs.holdYears} onChange={(v) => update({ holdYears: v })} min={1} max={10} suffix="yrs" step />
                  <NumField label="Capital gains" value={inputs.capitalGains} onChange={(v) => update({ capitalGains: v })} min={0} max={40} suffix="%" />
                  <NumField label="Selling costs" value={inputs.sellingCosts} onChange={(v) => update({ sellingCosts: v })} min={0} max={15} suffix="%" />
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
