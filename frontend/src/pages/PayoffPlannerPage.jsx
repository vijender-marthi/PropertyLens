import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CalendarClock, PiggyBank, TimerReset, Info, Home, Flag } from 'lucide-react'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'

// Per-session persistence of the four inputs.
const STORAGE_KEY = 'payoffPlanner.inputs.v1'
const DEFAULT_INPUTS = {
  strategy: 'avalanche',
  lumpSum: 0,
  extraMonthly: 0,
  includePrimary: false,
}

function loadInputs() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_INPUTS }
    const parsed = JSON.parse(raw)
    return {
      strategy: parsed.strategy === 'snowball' ? 'snowball' : 'avalanche',
      lumpSum: clamp(Number(parsed.lumpSum) || 0, 0, 300_000),
      extraMonthly: clamp(Number(parsed.extraMonthly) || 0, 0, 8_000),
      includePrimary: Boolean(parsed.includePrimary),
    }
  } catch {
    return { ...DEFAULT_INPUTS }
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function usd(value) {
  const amount = Math.round(Number(value) || 0)
  return `$${amount.toLocaleString('en-US')}`
}

export default function PayoffPlannerPage() {
  const [inputs, setInputs] = useState(loadInputs)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  // Persist inputs per session.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(inputs))
    } catch {
      /* ignore storage failures */
    }
  }, [inputs])

  // Live recompute on any input change (debounced so slider drags stay smooth).
  useEffect(() => {
    let active = true
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      propAPI
        .payoffPlanner({
          strategy: inputs.strategy,
          lump_sum: inputs.lumpSum,
          extra_monthly: inputs.extraMonthly,
          include_primary: inputs.includePrimary,
        })
        .then((res) => {
          if (active) {
            setReport(res.data)
            setError(null)
          }
        })
        .catch(() => {
          if (active) setError('Could not load the payoff plan. Please try again.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 220)
    return () => {
      active = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inputs])

  const update = (patch) => setInputs((prev) => ({ ...prev, ...patch }))

  return (
    <PageContainer>
      <header>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Payoff planner</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Model an avalanche or snowball payoff across your rental portfolio. Freed principal &amp; income
          cascade from each cleared loan into the next.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Results (left) */}
        <div className="space-y-6 order-2 lg:order-1">
          {error ? (
            <div className="card flex items-center gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <ResultsPanel report={report} loading={loading && !report} />
        </div>

        {/* Control panel (right, sticky) */}
        <aside className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-4">
            <ControlPanel
              inputs={inputs}
              update={update}
              portfolio={report?.portfolio}
              loading={loading}
            />
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}

// ---------------------------------------------------------------------------
// Control panel
// ---------------------------------------------------------------------------
function ControlPanel({ inputs, update, portfolio, loading }) {
  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Plan inputs</h2>
        {loading ? <span className="text-[11px] text-gray-400">Updating…</span> : null}
      </div>

      {/* Strategy */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">Strategy</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700/60" role="radiogroup" aria-label="Payoff strategy">
          {[
            { key: 'avalanche', label: 'Avalanche', hint: 'Highest rate first' },
            { key: 'snowball', label: 'Snowball', hint: 'Smallest balance first' },
          ].map((opt) => {
            const active = inputs.strategy === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ strategy: opt.key })}
                className={`rounded-md px-2 py-1.5 text-center transition-colors ${
                  active
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <span className="block text-[13px] font-semibold">{opt.label}</span>
                <span className="block text-[10px] text-gray-400 dark:text-gray-500">{opt.hint}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Lump sum */}
      <SliderField
        label="One-time lump sum"
        value={inputs.lumpSum}
        min={0}
        max={300_000}
        step={5_000}
        display={usd(inputs.lumpSum)}
        note="Applied to the first target in month 1"
        onChange={(v) => update({ lumpSum: v })}
      />

      {/* Extra monthly */}
      <SliderField
        label="Extra monthly contribution"
        value={inputs.extraMonthly}
        min={0}
        max={8_000}
        step={100}
        display={`${usd(inputs.extraMonthly)}/mo`}
        note="Recurring external cash added to the attack pool"
        onChange={(v) => update({ extraMonthly: v })}
      />

      {/* Include primary */}
      <label className="flex cursor-pointer items-start justify-between gap-3">
        <span>
          <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">Include primary residence</span>
          <span className="block text-[11px] text-gray-400 dark:text-gray-500">Off by default — rentals only</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={inputs.includePrimary}
          aria-label="Include primary residence"
          onClick={() => update({ includePrimary: !inputs.includePrimary })}
          className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
            inputs.includePrimary ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
              inputs.includePrimary ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </label>

      {portfolio ? (
        <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <div className="flex justify-between">
            <span>Loans in plan</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{portfolio.loanCount}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Total debt</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{portfolio.totalDebtDisplay}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Monthly NOI pool</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{portfolio.noiSumDisplay}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SliderField({ label, value, min, max, step, display, note, onChange }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-600 dark:bg-gray-700"
        aria-label={label}
      />
      {note ? <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{note}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
function ResultsPanel({ report, loading }) {
  if (loading) {
    return (
      <div className="card flex items-center justify-center py-16 text-sm text-gray-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="ml-3">Simulating payoff…</span>
      </div>
    )
  }
  if (!report) return null

  const { cards, story, timeline, warnings } = report
  const hasLoans = (report.portfolio?.loanCount || 0) > 0

  if (!hasLoans) {
    return (
      <div className="card text-center text-sm text-gray-500 dark:text-gray-400">
        No rental loans found for a payoff plan. Add rental debt, or enable “Include primary residence.”
      </div>
    )
  }

  return (
    <>
      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricTile
          icon={CalendarClock}
          label={cards.debtFree.label}
          value={cards.debtFree.display}
          sub={cards.debtFree.allPayOff ? `Debt-free ${cards.debtFree.date}` : 'Some loans never clear'}
          tone={cards.debtFree.allPayOff ? 'default' : 'warn'}
        />
        <MetricTile
          icon={PiggyBank}
          label={cards.interestSaved.label}
          value={cards.interestSaved.display}
          sub="from your contributions"
          tone="positive"
        />
        <MetricTile
          icon={TimerReset}
          label={cards.timeSaved.label}
          value={cards.timeSaved.display}
          sub={`Without extra: ${cards.timeSaved.baselineDisplay}`}
          tone="positive"
        />
      </div>

      {/* Story line */}
      <div className="card-sm flex items-start gap-2 bg-blue-50/60 dark:bg-blue-950/30">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p className="text-sm text-gray-700 dark:text-gray-200">{story}</p>
      </div>

      {/* Explain a zero-savings result so it doesn't read as broken */}
      {report.savingsNote ? (
        <div className="card-sm flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <p>{report.savingsNote}</p>
        </div>
      ) : null}

      {/* Warnings */}
      {(warnings || []).map((w) => (
        <div key={w} className="card-sm flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {w}
        </div>
      ))}

      {/* Horizontal payoff timeline — homes clear left to right, fits the window */}
      <div className="card">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Payoff timeline</h2>
          <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5"><Flag className="h-3 w-3 text-green-600 dark:text-green-400" />with your plan</span>
            <span className="flex items-center gap-1.5"><Flag className="h-3 w-3 text-red-500" />without extra</span>
          </div>
        </div>
        <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
          The green flag is when you're debt-free with your plan; the red flag is your original (no-extra) date. Slide the lump sum or extra to watch the gap open.
        </p>

        {/* Proportional outcome ruler: green flag moves as inputs change */}
        <OutcomeRuler report={report} />

        {/* Homes as detail cards (even), each connected by a leader line down to
            its true time position on the axis — which lines up with the year scale. */}
        <div className="mt-2 w-full">
          <div className="flex w-full items-stretch">
            {timeline.map((row) => (
              <ChartCard key={`${row.order}-${row.name}`} row={row} />
            ))}
          </div>
          <div className="relative h-12">
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {timeline.map((row, i) => (
                <line
                  key={`${row.order}-${row.name}`}
                  x1={((i + 0.5) / timeline.length) * 100}
                  y1="0"
                  x2={Math.max(1.5, Math.min(Number(row.planPct) || 0, 100))}
                  y2="72"
                  stroke={homeAccent(row.order, row.verdict?.neverPaysOff).hex}
                  strokeOpacity="0.5"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className="absolute inset-x-0 h-0.5 -translate-y-1/2 rounded bg-blue-200 dark:bg-blue-900/70" style={{ top: '72%' }} />
            <span className="absolute left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400" style={{ top: '72%' }} />
            {timeline.map((row) => (
              <span
                key={`${row.order}-${row.name}`}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${Math.max(1.5, Math.min(Number(row.planPct) || 0, 100))}%`, top: '72%' }}
              >
                <HomeNode row={row} />
              </span>
            ))}
          </div>
        </div>

        {/* Yearly time scale — shares the axis above, so nodes line up with years */}
        <YearScale report={report} />
      </div>

      {/* Payment rollover — the cascade shown as coins stacking up */}
      {(report.rollover || []).length > 1 ? (
        <div className="card">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Payment rollover</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5"><Coin own /> its own payment</span>
              <span className="flex items-center gap-1.5"><Coin /> freed from a cleared loan</span>
            </div>
          </div>
          <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
            When a loan clears, its monthly payment becomes a coin that rolls onto the next — so the money attacking each loan grows one coin at a time.
          </p>
          <ol className="space-y-3.5">
            {report.rollover.map((step) => (
              <RolloverStep key={`${step.order}-${step.name}`} step={step} />
            ))}
          </ol>
        </div>
      ) : null}
    </>
  )
}

function Coin({ own = false, title }) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1 ${
        own
          ? 'bg-blue-500 text-white ring-blue-600'
          : 'bg-green-100 text-green-700 ring-green-300 dark:bg-green-900/50 dark:text-green-300 dark:ring-green-700'
      }`}
    >
      $
    </span>
  )
}

function RolloverStep({ step }) {
  const never = step.neverPaysOff
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-200">
        {step.order}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{step.name}</span>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{never ? 'Never clears' : `clears ${step.payoffDate}`}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {step.coins.map((coin, idx) => (
            <Coin key={`${coin.name}-${idx}`} own={coin.own} title={`${coin.name}: ${coin.display}/mo`} />
          ))}
          <span className="ml-2 text-xs font-semibold text-gray-900 dark:text-white tabular-nums">{step.rollingPaymentDisplay}/mo</span>
          {step.freedCount > 0 ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              ({step.freedPaymentDisplay}/mo rolled in from {step.freedCount} cleared)
            </span>
          ) : (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">(first target)</span>
          )}
        </div>
      </div>
    </li>
  )
}

function MetricTile({ icon: Icon, label, value, sub, tone = 'default' }) {
  const valueTone =
    tone === 'positive'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-900 dark:text-white'
  return (
    <div className="stat-card">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Icon className="h-3.5 w-3.5 text-gray-400" />
        <span>{label}</span>
      </div>
      <p className={`text-xl font-bold ${valueTone}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sub}</p> : null}
    </div>
  )
}

// Distinct accent per home so each station is easy to tell apart. Full static
// class names (Tailwind can't see dynamically built strings).
const HOME_ACCENTS = [
  { ring: 'border-blue-500',    icon: 'text-blue-500',    badge: 'bg-blue-500',    line: 'bg-blue-300 dark:bg-blue-700',       hex: '#3b82f6' },
  { ring: 'border-teal-500',    icon: 'text-teal-500',    badge: 'bg-teal-500',    line: 'bg-teal-300 dark:bg-teal-700',       hex: '#14b8a6' },
  { ring: 'border-indigo-500',  icon: 'text-indigo-500',  badge: 'bg-indigo-500',  line: 'bg-indigo-300 dark:bg-indigo-700',   hex: '#6366f1' },
  { ring: 'border-fuchsia-500', icon: 'text-fuchsia-500', badge: 'bg-fuchsia-500', line: 'bg-fuchsia-300 dark:bg-fuchsia-700', hex: '#d946ef' },
  { ring: 'border-cyan-500',    icon: 'text-cyan-500',    badge: 'bg-cyan-500',    line: 'bg-cyan-300 dark:bg-cyan-700',       hex: '#06b6d4' },
  { ring: 'border-rose-500',    icon: 'text-rose-500',    badge: 'bg-rose-500',    line: 'bg-rose-300 dark:bg-rose-700',       hex: '#f43f5e' },
]
const HOME_AMBER = { ring: 'border-amber-400', icon: 'text-amber-500', badge: 'bg-amber-500', line: 'bg-amber-300 dark:bg-amber-700', hex: '#f59e0b' }

function homeAccent(order, never) {
  return never ? HOME_AMBER : HOME_ACCENTS[(((order || 1) - 1) % HOME_ACCENTS.length + HOME_ACCENTS.length) % HOME_ACCENTS.length]
}

// A home-icon node placed at the home's true time position on the axis.
// Hovering it shows the reason (why this home clears where it does).
function HomeNode({ row }) {
  const never = row.verdict?.neverPaysOff
  const accent = homeAccent(row.order, never)
  return (
    <span className={`group/node relative z-10 flex h-9 w-9 cursor-help items-center justify-center rounded-full border-2 bg-white shadow-sm dark:bg-gray-900 ${accent.ring}`}>
      <Home className={`h-4 w-4 ${accent.icon}`} />
      <span className={`absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white ${accent.badge}`}>
        {row.order}
      </span>
      {row.reason ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2.5 text-left text-[11px] font-normal leading-snug text-gray-600 shadow-lg group-hover/node:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
        >
          <span className="mb-1 block font-semibold text-gray-900 dark:text-white">{row.name} · {never ? 'Never clears' : row.payoffDate}</span>
          {row.reason}
        </span>
      ) : null}
    </span>
  )
}

// Evenly-spaced detail card (connected to its time-positioned node by a leader).
// All cards share the same height; hover the node below for the reason.
function ChartCard({ row }) {
  const never = row.verdict?.neverPaysOff
  const belowMarket = row.verdict?.belowMarket
  const accent = homeAccent(row.order, never)
  return (
    <div className="min-w-0 flex-1 px-1">
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className={`h-1 w-full shrink-0 ${accent.badge}`} />
        <div className="flex flex-1 flex-col px-1.5 py-1.5">
          <div className="truncate text-[13px] font-semibold text-gray-900 dark:text-white" title={row.name}>{row.name}</div>
          <div className={`mt-0.5 whitespace-nowrap text-xs font-semibold ${never ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-100'}`}>
            {never ? 'Never clears' : row.payoffDate}
          </div>
          <div className="mt-0.5 text-[10px] font-medium tabular-nums text-gray-600 dark:text-gray-300">{row.rateDisplay}</div>
          <div className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400" title={row.balanceDisplay}>{row.balanceCompact || row.balanceDisplay}</div>
          <div className="mt-auto flex flex-wrap justify-center gap-1 pt-1">
            {row.earlierLabel ? (
              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">{row.earlierLabel} earlier</span>
            ) : null}
            {belowMarket ? (
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">below mkt</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// Year scale along the bottom, sharing the outcome ruler's axis (Today →
// Original/baseline). Ticks at each year; the blue highlight marks the years
// your plan covers, the rest are the extra years on the original schedule.
function YearScale({ report }) {
  const axis = report.baselineMonth || 1
  const start = new Date(report.startDate)
  const startYear = start.getFullYear()
  const startMonth = start.getMonth()
  const greenPct = Math.max(0, Math.min((report.debtFreeMonth / axis) * 100, 100))
  const totalYears = Math.ceil(axis / 12)
  const step = totalYears > 20 ? 5 : totalYears > 10 ? 2 : 1

  const ticks = []
  for (let y = startYear; ; y += 1) {
    const months = (y - startYear) * 12 - startMonth
    if (months > axis + 0.5) break
    if (months >= 0) ticks.push({ year: y, pct: (months / axis) * 100, labeled: y % step === 0 })
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700/60">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4 rounded-full bg-blue-500" />years with your plan</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-red-400" />extra years on original schedule</span>
      </div>
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="absolute top-1.5 h-0 border-t-2 border-dashed border-red-400" style={{ left: `${greenPct}%`, right: 0 }} />
        <div className="absolute left-0 top-1.5 h-1 rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${greenPct}%` }} />
        <span className="absolute left-0 top-1.5 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-green-500 bg-white transition-[left] duration-500 dark:bg-gray-900" style={{ left: `${greenPct}%` }} />
        {ticks.map((t) => (
          <div key={t.year} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${t.pct}%` }}>
            <span className={`w-px ${t.labeled ? 'h-3 bg-gray-400 dark:bg-gray-500' : 'h-1.5 bg-gray-300 dark:bg-gray-600'}`} />
            {t.labeled ? <span className="mt-1 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{t.year}</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

// Proportional ruler: Today → blue plan span → green Debt-free flag → dashed red
// segment → red Original flag. The red flag is fixed (the no-contribution
// baseline); the green flag slides left as the lump sum / extra grow, so the gap
// (the time saved) opens up live.
function OutcomeRuler({ report }) {
  const axis = report.baselineMonth || 1
  const greenLeft = Math.max(3, Math.min((report.debtFreeMonth / axis) * 100, 99))
  const savedLabel = report.cards?.timeSaved?.display
  const hasSaved = (report.cards?.timeSaved?.value || 0) > 0 && report.debtFreeMonth < report.baselineMonth

  if (!hasSaved) {
    return (
      <div className="mb-2 rounded-lg border border-gray-100 bg-gray-50/70 px-4 py-3 text-center text-xs text-gray-500 dark:border-gray-700/60 dark:bg-gray-800/40 dark:text-gray-400">
        On your current schedule you're debt-free{' '}
        <span className="font-semibold text-gray-700 dark:text-gray-200">{report.cards.debtFree.date}</span>. Add a lump sum or extra monthly and the green flag slides earlier.
      </div>
    )
  }

  const gapMid = (greenLeft + 100) / 2
  const LINE = '3.1rem'  // vertical position of the axis within the box
  return (
    <div className="mb-2 rounded-lg border border-gray-100 bg-gray-50/70 px-6 dark:border-gray-700/60 dark:bg-gray-800/40">
      <div className="relative h-28">
        {/* base + coloured segments */}
        <div className="absolute inset-x-0 h-1 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" style={{ top: LINE }} />
        <div className="absolute left-0 h-1 -translate-y-1/2 rounded-full bg-blue-500 transition-[width] duration-500" style={{ top: LINE, width: `${greenLeft}%` }} />
        <div className="absolute -translate-y-1/2 border-t-2 border-dashed border-red-400 transition-all duration-500" style={{ top: LINE, left: `${greenLeft}%`, right: 0 }} />

        {/* saved gap bracket + pill (above the line) */}
        <div className="absolute h-2 border-x-2 border-t-2 border-green-400/70 transition-all duration-500" style={{ top: '2.05rem', left: `${greenLeft}%`, right: 0 }} />
        <div className="absolute -translate-x-1/2 whitespace-nowrap transition-[left] duration-500" style={{ top: '0.7rem', left: `${gapMid}%` }}>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:bg-green-900/50 dark:text-green-300">← {savedLabel} sooner</span>
        </div>

        {/* Today */}
        <span className="absolute left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400" style={{ top: LINE }} />
        <span className="absolute left-0 text-[10px] text-gray-400" style={{ top: '3.9rem' }}>Today</span>

        {/* Green debt-free flag (slides) + label on row 1 */}
        <span className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-green-500 bg-white shadow-sm transition-[left] duration-500 dark:bg-gray-900" style={{ top: LINE, left: `${greenLeft}%` }}>
          <Flag className="h-3 w-3 text-green-600 dark:text-green-400" />
        </span>
        <div className="absolute -translate-x-1/2 whitespace-nowrap text-center transition-[left] duration-500" style={{ top: '3.9rem', left: `${greenLeft}%` }}>
          <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">Debt-free </span>
          <span className="text-[10px] text-gray-600 dark:text-gray-300">{report.cards.debtFree.date}</span>
        </div>

        {/* Red original flag (fixed at right) + label on row 2 */}
        <span className="absolute right-0 flex h-6 w-6 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-red-500 bg-white shadow-sm dark:bg-gray-900" style={{ top: LINE }}>
          <Flag className="h-3 w-3 text-red-500" />
        </span>
        <div className="absolute right-0 whitespace-nowrap text-right" style={{ top: '5.2rem' }}>
          <span className="text-[10px] font-semibold text-red-500">Original </span>
          <span className="text-[10px] text-gray-600 dark:text-gray-300">{report.baselineDate}</span>
        </div>
      </div>
    </div>
  )
}

