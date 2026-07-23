import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CalendarClock, PiggyBank, TimerReset, Info, Home, Flag, Bookmark, Save, Download, Plus, X, Check, Trophy, GitCompare, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { formatCurrency } from '../utils/formatters'

// Per-session persistence of the inputs.
const STORAGE_KEY = 'payoffPlanner.inputs.v2'
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DEFAULT_INPUTS = {
  strategy: 'avalanche',
  lumpSum: 0,
  extraMonthly: 0,
  extraMonthlyYears: 0, // 0 = for the whole payoff; N = only the first N years
  recurringLump: 0,
  recurringMonth: 12, // December
  recurringYears: 10,
  includePrimary: false,
  // null => use the backend default selection (rentals in, primary out).
  // An array => explicit selection of property ids to include.
  selectedIds: null,
}

// Coerce an arbitrary parsed object (from storage or a saved scenario) into a
// valid, clamped inputs shape.
function normalizeInputs(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_INPUTS }
  return {
    strategy: parsed.strategy === 'snowball' ? 'snowball' : 'avalanche',
    lumpSum: clamp(Number(parsed.lumpSum) || 0, 0, 300_000),
    extraMonthly: clamp(Number(parsed.extraMonthly) || 0, 0, 8_000),
    extraMonthlyYears: clamp(Math.round(Number(parsed.extraMonthlyYears) || 0), 0, 30),
    recurringLump: clamp(Number(parsed.recurringLump) || 0, 0, 100_000),
    recurringMonth: clamp(Number(parsed.recurringMonth) || 12, 1, 12),
    recurringYears: clamp(Number(parsed.recurringYears) || 10, 1, 30),
    includePrimary: Boolean(parsed.includePrimary),
    selectedIds: Array.isArray(parsed.selectedIds)
      ? parsed.selectedIds.map(Number).filter(Number.isFinite)
      : null,
  }
}

function loadInputs() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_INPUTS }
    return normalizeInputs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_INPUTS }
  }
}

// Compact, order-independent signature so we can tell whether the live inputs
// still match a saved scenario.
function inputsSignature(inp) {
  const n = normalizeInputs(inp)
  return JSON.stringify({
    strategy: n.strategy,
    lumpSum: n.lumpSum,
    extraMonthly: n.extraMonthly,
    extraMonthlyYears: n.extraMonthlyYears,
    recurringLump: n.recurringLump,
    recurringMonth: n.recurringMonth,
    recurringYears: n.recurringYears,
    includePrimary: n.includePrimary,
    selectedIds: n.selectedIds ? [...n.selectedIds].sort((a, b) => a - b) : null,
  })
}

// Snapshot the headline results for a scenario, with numeric fields for ranking.
function buildSnapshot(report) {
  const c = report?.cards
  if (!c) return null
  return {
    debtFreeDate: c.debtFree?.date ?? null,
    debtFreeDisplay: c.debtFree?.display ?? null,
    allPayOff: Boolean(c.debtFree?.allPayOff),
    debtFreeMonth: Number.isFinite(report?.debtFreeMonth) ? report.debtFreeMonth : null,
    interestSavedDisplay: c.interestSaved?.display ?? null,
    interestSavedValue: Number.isFinite(c.interestSaved?.value) ? c.interestSaved.value : null,
    timeSavedDisplay: c.timeSaved?.display ?? null,
    timeSavedValue: Number.isFinite(c.timeSaved?.value) ? c.timeSaved.value : null,
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function usd(value) {
  // Whole-dollar currency via the shared formatter (identical output for the
  // non-negative amounts used here).
  return formatCurrency(Math.round(Number(value) || 0))
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
      const selectionExplicit = Array.isArray(inputs.selectedIds)
      propAPI
        .payoffPlanner({
          strategy: inputs.strategy,
          lump_sum: inputs.lumpSum,
          extra_monthly: inputs.extraMonthly,
          extra_monthly_years: inputs.extraMonthlyYears,
          recurring_lump: inputs.recurringLump,
          recurring_month: inputs.recurringMonth,
          recurring_years: inputs.recurringYears,
          include_primary: inputs.includePrimary,
          selection_explicit: selectionExplicit,
          selected_property_ids: selectionExplicit ? inputs.selectedIds.join(',') : '',
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

  // ---- Saved scenarios ----
  const [scenarios, setScenarios] = useState([])
  const [activeScenarioId, setActiveScenarioId] = useState(null)
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [exportView, setExportView] = useState(null) // {mode, columns} while printing
  const [inputsOpen, setInputsOpen] = useState(true)   // right-side Plan inputs panel
  const [scenariosOpen, setScenariosOpen] = useState(false) // top-right Scenarios widget

  const refreshScenarios = () =>
    propAPI.listScenarios().then((r) => setScenarios(r.data || [])).catch(() => {})

  useEffect(() => { refreshScenarios() }, [])

  const currentSig = useMemo(() => inputsSignature(inputs), [inputs])
  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) || null
  const activeMatches = activeScenario ? inputsSignature(activeScenario.inputs) === currentSig : false

  const saveScenario = async (name) => {
    setScenarioBusy(true)
    try {
      const res = await propAPI.createScenario({ name, inputs, results: buildSnapshot(report) })
      await refreshScenarios()
      setActiveScenarioId(res.data.id)
      setSaveOpen(false)
      toast.success(`Saved “${res.data.name}”`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not save the plan.')
    } finally { setScenarioBusy(false) }
  }

  const updateActiveScenario = async () => {
    if (!activeScenario) return
    setScenarioBusy(true)
    try {
      await propAPI.updateScenario(activeScenario.id, { inputs, results: buildSnapshot(report) })
      await refreshScenarios()
      toast.success(`Updated “${activeScenario.name}”`)
    } catch {
      toast.error('Could not update the plan.')
    } finally { setScenarioBusy(false) }
  }

  const applyScenario = (sc) => {
    setInputs(normalizeInputs(sc.inputs))
    setActiveScenarioId(sc.id)
  }

  const deleteScenario = async (id) => {
    setScenarioBusy(true)
    try {
      await propAPI.deleteScenario(id)
      if (activeScenarioId === id) setActiveScenarioId(null)
      await refreshScenarios()
    } catch {
      toast.error('Could not delete the plan.')
    } finally { setScenarioBusy(false) }
  }

  // Columns for the comparison / export: the live "current plan" first, then
  // each saved scenario (skipping the one that equals the current plan).
  const compareColumns = useMemo(() => {
    const cols = []
    if (report?.cards) {
      cols.push({
        id: '__current__',
        name: activeMatches && activeScenario ? activeScenario.name : 'Current plan',
        inputs: normalizeInputs(inputs),
        snapshot: buildSnapshot(report),
        current: true,
      })
    }
    scenarios.forEach((s) => {
      if (activeMatches && activeScenario && s.id === activeScenario.id) return
      cols.push({ id: s.id, name: s.name, inputs: normalizeInputs(s.inputs), snapshot: s.results || null, savedAt: s.updatedAt || s.createdAt })
    })
    return cols
  }, [report, scenarios, inputs, activeMatches, activeScenario])

  // Print flow for export: render the print doc, then trigger the browser dialog.
  useEffect(() => {
    if (!exportView) return
    const done = () => setExportView(null)
    window.addEventListener('afterprint', done, { once: true })
    const t = setTimeout(() => window.print(), 80)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [exportView])

  const exportSingle = () => {
    const col = compareColumns.find((c) => c.current) || compareColumns[0]
    if (!col) { toast.error('Nothing to export yet.'); return }
    setExportView({ mode: 'single', columns: [col] })
  }
  const exportCompare = () => {
    if (compareColumns.length < 2) { toast.error('Save at least one plan to compare.'); return }
    setExportView({ mode: 'compare', columns: compareColumns })
  }

  // Toggle a property in/out of the plan. The first toggle promotes the
  // selection from "backend default" (null) to an explicit id list seeded from
  // whatever is currently included, so nothing else silently changes.
  const toggleProperty = (id) => {
    setInputs((prev) => {
      const base = Array.isArray(prev.selectedIds)
        ? prev.selectedIds
        : (report?.properties || []).filter((p) => p.included).map((p) => p.id)
      const set = new Set(base)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, selectedIds: [...set] }
    })
  }

  return (
    <PageContainer>
      <div className="pp-screen space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Payoff planner</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Model an avalanche or snowball payoff across your rental portfolio. Freed principal &amp; income
            cascade from each cleared loan into the next.
          </p>
        </div>
        {/* Top-right controls: Scenarios widget + collapse toggle for Plan inputs */}
        <div className="flex shrink-0 items-center gap-2 self-start">
          <ScenarioWidget
            open={scenariosOpen}
            onToggle={() => setScenariosOpen((v) => !v)}
            scenarios={scenarios}
            activeScenario={activeScenario}
            activeMatches={activeMatches}
            busy={scenarioBusy}
            onSave={() => setSaveOpen(true)}
            onUpdate={updateActiveScenario}
            onApply={(s) => { applyScenario(s); setScenariosOpen(false) }}
            onDelete={deleteScenario}
            onCompare={() => setCompareOpen((v) => !v)}
            compareOpen={compareOpen}
            compareColumns={compareColumns}
            onExportCompare={exportCompare}
            onExport={exportSingle}
            canExport={Boolean(report?.cards)}
          />
          <button type="button" onClick={() => setInputsOpen((v) => !v)} aria-pressed={inputsOpen}
            className="btn-secondary text-xs px-2.5 py-1.5" title={inputsOpen ? 'Collapse the inputs panel for a bigger view' : 'Show the inputs panel'}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{inputsOpen ? 'Hide inputs' : 'Show inputs'}</span>
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Results (left) */}
        <div className="order-2 min-w-0 flex-1 space-y-6 lg:order-1">
          {/* Active saved-plan indicator — sits at the top-right of the metrics
              line; shows which plan the results reflect and updates on
              apply/save/modify. */}
          {activeScenario ? (
            <div className="flex justify-end">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                activeMatches
                  ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
              }`}>
                <Bookmark className="h-3 w-3" aria-hidden="true" />
                {activeMatches ? <>Viewing plan: <span className="font-semibold">{activeScenario.name}</span></>
                               : <><span className="font-semibold">{activeScenario.name}</span> · modified (unsaved changes)</>}
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="card flex items-center gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <ResultsPanel report={report} loading={loading && !report} />
        </div>

        {/* Collapse/expand handle at the boundary (desktop) — makes it obvious
            the inputs panel can slide away and back. */}
        <button
          type="button"
          onClick={() => setInputsOpen((v) => !v)}
          aria-label={inputsOpen ? 'Collapse inputs panel' : 'Expand inputs panel'}
          aria-expanded={inputsOpen}
          title={inputsOpen ? 'Collapse inputs' : 'Expand inputs'}
          className="hidden shrink-0 self-start rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-700 lg:sticky lg:top-4 lg:order-2 lg:flex lg:h-16 lg:w-6 lg:items-center lg:justify-center dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {inputsOpen ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
        </button>

        {/* Control panel (right) — slides/minimizes for a bigger results view */}
        <aside className={`order-1 lg:order-3 lg:shrink-0 lg:transition-[width,opacity] lg:duration-300 lg:ease-in-out ${
          inputsOpen ? 'lg:w-80 lg:opacity-100' : 'hidden lg:block lg:w-0 lg:overflow-hidden lg:opacity-0'
        }`}>
          <div className="lg:sticky lg:top-4 lg:w-80">
            <ControlPanel
              inputs={inputs}
              update={update}
              portfolio={report?.portfolio}
              properties={report?.properties}
              toggleProperty={toggleProperty}
              loading={loading}
              onCollapse={() => setInputsOpen(false)}
            />
          </div>
        </aside>
      </div>
      </div>

      {saveOpen ? (
        <SaveDialog
          busy={scenarioBusy}
          defaultName={suggestScenarioName(inputs, scenarios)}
          onCancel={() => setSaveOpen(false)}
          onSave={saveScenario}
        />
      ) : null}

      {exportView ? <ScenarioPrintDoc view={exportView} /> : null}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        .pp-print { display: block !important; }
        .pp-print, .pp-print * { visibility: visible !important; }
        .pp-print { position: absolute; left: 0; top: 0; width: 100%; }
        @page { margin: 14mm; }
      }`}</style>
    </PageContainer>
  )
}

// Suggest a distinct default name for a new scenario.
function suggestScenarioName(inputs, scenarios) {
  const used = new Set((scenarios || []).map((s) => (s.name || '').toLowerCase()))
  const base =
    inputs.extraMonthly >= 1500 || inputs.lumpSum >= 50_000 ? 'Aggressive'
    : inputs.extraMonthly === 0 && inputs.lumpSum === 0 && inputs.recurringLump === 0 ? 'Baseline'
    : inputs.recurringLump > 0 ? 'Recurring bonus'
    : 'Plan'
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; i < 50; i += 1) {
    const cand = `${base} ${i}`
    if (!used.has(cand.toLowerCase())) return cand
  }
  return base
}

// ---------------------------------------------------------------------------
// Control panel
// ---------------------------------------------------------------------------
function ControlPanel({ inputs, update, portfolio, properties, toggleProperty, loading, onCollapse }) {
  const props = properties || []
  const explicit = Array.isArray(inputs.selectedIds)
  const selectedSet = explicit ? new Set(inputs.selectedIds) : null
  const isIncluded = (p) => (selectedSet ? selectedSet.has(p.id) : p.included)
  const includedCount = props.filter(isIncluded).length
  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Plan inputs</h2>
        <div className="flex items-center gap-2">
          {loading ? <span className="text-[11px] text-gray-400">Updating…</span> : null}
          {onCollapse ? (
            <button type="button" onClick={onCollapse} aria-label="Collapse inputs panel" title="Collapse for a bigger view"
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
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
      <div className="space-y-3 rounded-lg border border-gray-100 p-3 dark:border-gray-700/70">
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
        {inputs.extraMonthly > 0 ? (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">For (years)</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={inputs.extraMonthlyYears}
                onFocus={(e) => e.target.select()}
                onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); update({ extraMonthlyYears: v === '' ? 0 : clamp(parseInt(v, 10), 0, 30) }) }}
                aria-label="Extra monthly contribution number of years"
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </label>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {inputs.extraMonthlyYears > 0
                ? `${usd(inputs.extraMonthly)}/mo for ${inputs.extraMonthlyYears} year${inputs.extraMonthlyYears > 1 ? 's' : ''}`
                : `${usd(inputs.extraMonthly)}/mo until debt-free`}
              {inputs.extraMonthlyYears > 0 ? (
                <span className="text-gray-400 dark:text-gray-500"> · {usd(inputs.extraMonthly * 12 * inputs.extraMonthlyYears)} total planned</span>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-gray-400 dark:text-gray-500">Set a target of years, or leave 0 to contribute until you’re debt-free.</p>
        )}
      </div>

      {/* Recurring lump sum */}
      <div className="space-y-3 rounded-lg border border-gray-100 p-3 dark:border-gray-700/70">
        <SliderField
          label="Recurring lump sum"
          value={inputs.recurringLump}
          min={0}
          max={100_000}
          step={5_000}
          display={usd(inputs.recurringLump)}
          onChange={(v) => update({ recurringLump: v })}
        />
        {inputs.recurringLump > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">Every</span>
                <select
                  value={inputs.recurringMonth}
                  onChange={(e) => update({ recurringMonth: Number(e.target.value) })}
                  aria-label="Recurring lump sum month"
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">For (years)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={inputs.recurringYears}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); update({ recurringYears: v === '' ? 1 : clamp(parseInt(v, 10), 1, 30) }) }}
                  aria-label="Recurring lump sum number of years"
                  className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {usd(inputs.recurringLump)} every {MONTHS[inputs.recurringMonth - 1]} for {inputs.recurringYears} year{inputs.recurringYears > 1 ? 's' : ''}
              <span className="text-gray-400 dark:text-gray-500"> · {usd(inputs.recurringLump * inputs.recurringYears)} total planned</span>
            </p>
          </>
        ) : (
          <p className="text-[11px] text-gray-400 dark:text-gray-500">Set an amount to add it every year in a chosen month.</p>
        )}
      </div>

      {/* Properties in plan */}
      {props.length ? (
        <fieldset>
          <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-gray-700 dark:text-gray-300">
            <span>Properties in plan</span>
            <span className="text-[10px] font-normal text-gray-400">{includedCount}/{props.length}</span>
          </legend>
          <div className="space-y-0.5">
            {props.map((p) => (
              <PropertyToggle key={p.id} prop={p} on={isIncluded(p)} onToggle={() => toggleProperty(p.id)} />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">Toggle any property — the primary home is off by default.</p>
        </fieldset>
      ) : null}

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

function PropertyToggle({ prop, on, onToggle }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/40">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">{prop.name}</span>
          {prop.isPrimary ? (
            <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">Primary</span>
          ) : null}
        </div>
        <span className="block text-[11px] text-gray-400 dark:text-gray-500">
          {prop.balanceDisplay}{prop.loanCount > 1 ? ` · ${prop.loanCount} loans` : ''}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? 'Exclude' : 'Include'} ${prop.name}`}
        onClick={onToggle}
        className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          on ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
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
  // Balances/rates are a point-in-time snapshot; label the boxes so a user
  // returning months later knows when these values were current.
  const asOf = report.startDate ? new Date(report.startDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null
  const hasLoans = (report.portfolio?.loanCount || 0) > 0

  if (!hasLoans) {
    return (
      <div className="card text-center text-sm text-gray-500 dark:text-gray-400">
        No loans in the payoff plan. Add rental debt, or include a property (like your primary home) under “Properties in plan.”
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
        </div>
        <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
          Each home clears at its point on the timeline — the dotted line in the home's colour maps it to its year. The green flag is when you're debt-free with your plan; the red flag is your original (no-extra) date.
        </p>

        {/* Message boxes → curved connectors → home icons → dotted colour map → one timeline */}
        <div className="flex w-full items-stretch">
          {timeline.map((row) => (
            <ChartCard key={`${row.order}-${row.name}`} row={row} asOf={asOf} />
          ))}
        </div>
        <PayoffTimeline report={report} timeline={timeline} />

        {/* Legend (bottom) */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-[10px] text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
          <span className="flex items-center gap-1.5"><Flag className="h-3 w-3 text-green-600 dark:text-green-400" />debt-free with your plan</span>
          <span className="flex items-center gap-1.5"><Flag className="h-3 w-3 text-red-500" />without extra</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-4 rounded-full bg-blue-500" />years with your plan</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-red-400" />extra on original schedule</span>
        </div>
      </div>

      {/* Payment rollover — the cascade shown as coins stacking up */}
      {(report.rollover || []).length > 1 ? (
        <div className="card">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Payment rollover</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5"><Coin own order={2} /> its own payment</span>
              <span className="flex items-center gap-1.5"><Coin order={1} /> freed from a cleared home (its colour)</span>
            </div>
          </div>
          <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
            When a loan clears, its monthly payment becomes a coin that rolls onto the next. Each amount is shown <span className="font-medium">net of that home&apos;s operating expenses</span> (property tax, insurance, HOA, management, solar) — the leftover that actually rolls forward, split by source home.
          </p>
          <ol className="space-y-3.5">
            {report.rollover.map((step) => (
              <RolloverStep key={`${step.order}-${step.name}`} step={step} maxMonthly={report.rolloverMaxMonthlyNet || 1} />
            ))}
          </ol>
        </div>
      ) : null}
    </>
  )
}

// A coin is coloured by the home the money comes from: the target's own payment
// (solid, current home's colour) plus lighter coins in the colour of each
// already-cleared home whose freed payment now rolls into this target.
function Coin({ own = false, order, never = false, title }) {
  const hex = homeAccent(order, never).hex
  const style = own
    ? { backgroundColor: hex, color: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' }
    : { backgroundColor: `${hex}26`, color: hex, boxShadow: `inset 0 0 0 1px ${hex}66` }
  return (
    <span
      title={title}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
      style={style}
    >
      $
    </span>
  )
}

// Tooltip for a coin: shows the net amount, and the gross P&I minus this home's
// operating expenses when any were deducted.
function coinTitle(c) {
  const who = c.own ? `${c.name} · your payment` : `from ${c.name}`
  if (Number(c.opex) > 0) return `${who}: ${usd(c.gross)} − ${usd(c.opex)} op ex = ${c.display}/mo net`
  return `${who}: ${c.display}/mo`
}

function RolloverStep({ step, maxMonthly }) {
  const never = step.neverPaysOff
  const monthly = Number(step.rollingPaymentNet) || 0
  const coins = step.coins || []
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-200">
        {step.order}
      </span>
      <div className="min-w-0 flex-1">
        {/* Property name (left) + monthly-payment box bar opposite it (right).
            Bar length is proportional to the monthly firepower attacking this
            home; each box is a source — your own payment, or a payment that
            rolled in from a cleared home (matched to the coins, left to right). */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{step.name}</div>
            <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">{never ? 'Never clears' : `clears ${step.payoffDate}`}</div>
          </div>
          {monthly > 0 ? (
            /* A capped fraction of the row (not a fixed size), so the bar stays
               narrow and every row lines up on the same right edge whatever the
               panel width. */
            <div className="flex w-2/5 max-w-[15rem] shrink-0 items-center gap-2">
              <div
                className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-md bg-gray-100 ring-1 ring-inset ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
                title={`${step.name}: ${step.rollingPaymentNetDisplay}/mo attacking this loan (net of operating expenses)`}
              >
                <div className="absolute inset-y-0 left-0 flex" style={{ width: `${Math.max((monthly / maxMonthly) * 100, 2)}%` }}>
                  {coins.map((c, i) => {
                    const hex = homeAccent(c.order, c.own && never).hex
                    const segPct = monthly > 0 ? (Number(c.amount) || 0) / monthly * 100 : 0
                    return (
                      <div
                        key={`${c.name}-${i}`}
                        className="h-full border-r border-white/70 last:border-r-0 dark:border-gray-900/50"
                        style={{ width: `${segPct}%`, backgroundColor: c.own ? hex : `${hex}B3` }}
                        title={coinTitle(c)}
                      />
                    )
                  })}
                </div>
              </div>
              <span className="w-[4.5rem] shrink-0 text-right text-[10px] font-medium tabular-nums text-gray-400 dark:text-gray-500">{step.rollingPaymentNetDisplay}/mo</span>
            </div>
          ) : null}
        </div>

        {/* Monthly rollover story — the coins that stack up as loans clear. */}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {step.coins.map((coin, idx) => (
            <Coin key={`${coin.name}-${idx}`} own={coin.own} order={coin.order} never={coin.own && never} title={coinTitle(coin)} />
          ))}
          <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">=</span>
          <span className="text-xs font-semibold text-gray-900 dark:text-white tabular-nums">{step.rollingPaymentNetDisplay}/mo</span>
          {step.freedCount > 0 ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              ({step.freedPaymentNetDisplay}/mo rolled in from {step.freedCount} cleared)
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
function ChartCard({ row, asOf }) {
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
          {asOf ? <div className="text-[9px] font-normal leading-tight text-gray-400 dark:text-gray-500">as of {asOf}</div> : null}
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

// One merged timeline. Message boxes (above) curve down to their home icons,
// which sit just above a single axis; a dotted line in each home's colour maps
// the icon to its exact year. The axis carries the year ticks, the blue "with
// your plan" span, the green Debt-free flag (slides as inputs change) and the
// fixed red Original flag.
const PT = { H: 212, HOME_Y: 88, AXIS_Y: 134 } // container geometry (px)

function PayoffTimeline({ report, timeline }) {
  const axis = report.baselineMonth || 1
  const greenPct = Math.max(0, Math.min((report.debtFreeMonth / axis) * 100, 100))
  const start = new Date(report.startDate)
  const startYear = start.getFullYear()
  const startMonth = start.getMonth()
  const totalYears = Math.ceil(axis / 12)
  const step = totalYears > 20 ? 5 : totalYears > 10 ? 2 : 1
  const ticks = []
  for (let y = startYear; ; y += 1) {
    const months = (y - startYear) * 12 - startMonth
    if (months > axis + 0.5) break
    if (months >= 0) ticks.push({ year: y, pct: (months / axis) * 100, labeled: y % step === 0 })
  }
  const n = timeline.length || 1
  const clampPct = (p) => Math.max(1.5, Math.min(Number(p) || 0, 100))
  const savedLabel = report.cards?.timeSaved?.display
  const hasSaved = (report.cards?.timeSaved?.value || 0) > 0 && report.debtFreeMonth < report.baselineMonth

  return (
    <div className="relative mt-1 w-full" style={{ height: PT.H }}>
      {/* Curved card→home connectors (#5) + dotted colour map home→timeline (#4) */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 100 ${PT.H}`} preserveAspectRatio="none" aria-hidden="true">
        {timeline.map((row, i) => {
          const cardX = ((i + 0.5) / n) * 100
          const homeX = clampPct(row.planPct)
          const hex = homeAccent(row.order, row.verdict?.neverPaysOff).hex
          const yTop = PT.HOME_Y - 18
          const mid = yTop / 2
          return (
            <g key={`${row.order}-${row.name}`}>
              <path d={`M ${cardX} 0 C ${cardX} ${mid}, ${homeX} ${mid}, ${homeX} ${yTop}`} fill="none" stroke={hex} strokeWidth="1.5" strokeOpacity="0.6" vectorEffect="non-scaling-stroke" />
              <line x1={homeX} y1={PT.HOME_Y + 18} x2={homeX} y2={PT.AXIS_Y} stroke={hex} strokeWidth="1.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>

      {/* Home icons, hugging the timeline (#2) */}
      {timeline.map((row) => (
        <span key={`${row.order}-${row.name}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${clampPct(row.planPct)}%`, top: PT.HOME_Y }}>
          <HomeNode row={row} />
        </span>
      ))}

      {/* Single merged axis (#1) */}
      <div className="absolute inset-x-0" style={{ top: PT.AXIS_Y }}>
        <div className="absolute inset-x-0 h-1 -translate-y-1/2 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="absolute -translate-y-1/2 border-t-2 border-dashed border-red-400" style={{ left: `${greenPct}%`, right: 0 }} />
        <div className="absolute left-0 h-1 -translate-y-1/2 rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${greenPct}%` }} />

        {/* Today */}
        <span className="absolute left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400" />

        {/* Year ticks + labels below the line */}
        {ticks.map((t) => (
          <div key={t.year} className="absolute top-1.5 flex -translate-x-1/2 flex-col items-center" style={{ left: `${t.pct}%` }}>
            <span className={`w-px ${t.labeled ? 'h-2.5 bg-gray-300 dark:bg-gray-600' : 'h-1.5 bg-gray-200 dark:bg-gray-700'}`} />
            {t.labeled ? <span className="mt-1 text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{t.year}</span> : null}
          </div>
        ))}

        {/* Saved-time pill over the gap */}
        {hasSaved ? (
          <div className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(greenPct + 100) / 2}%`, top: -20 }}>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:bg-green-900/50 dark:text-green-300">← {savedLabel} sooner</span>
          </div>
        ) : null}

        {/* Green debt-free flag (slides). Its label right-/left-aligns near the
            edges so it never runs out of the frame. */}
        <span className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-green-500 bg-white shadow-sm transition-[left] duration-500 dark:bg-gray-900" style={{ left: `${greenPct}%` }}>
          <Flag className="h-3 w-3 text-green-600 dark:text-green-400" />
        </span>
        <div className="absolute whitespace-nowrap transition-[left] duration-500" style={{ left: `${greenPct}%`, top: 40, transform: `translateX(${greenPct >= 85 ? '-100%' : greenPct <= 15 ? '0%' : '-50%'})` }}>
          <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">Debt-free </span>
          <span className="text-[10px] text-gray-600 dark:text-gray-300">{report.cards.debtFree.date}</span>
        </div>

        {/* Red original flag — only when it differs from the debt-free date
            (with savings). In default mode the two coincide, so one flag is
            enough and the duplicate is hidden. */}
        {hasSaved ? (
          <>
            <span className="absolute right-0 flex h-6 w-6 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-red-500 bg-white shadow-sm dark:bg-gray-900">
              <Flag className="h-3 w-3 text-red-500" />
            </span>
            <div className="absolute right-0 whitespace-nowrap text-right" style={{ top: 56 }}>
              <span className="text-[10px] font-semibold text-red-500">Original </span>
              <span className="text-[10px] text-gray-600 dark:text-gray-300">{report.baselineDate}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scenarios: toolbar, compare, save dialog, print doc
// ---------------------------------------------------------------------------
const strategyLabel = (s) => (s === 'snowball' ? 'Snowball' : 'Avalanche')

function scenarioInputRows(inp) {
  const rec = inp.recurringLump > 0
    ? `${usd(inp.recurringLump)} · ${MONTHS[(inp.recurringMonth || 12) - 1].slice(0, 3)} ×${inp.recurringYears}y`
    : '—'
  return {
    strategy: strategyLabel(inp.strategy),
    extra: inp.extraMonthly ? `${usd(inp.extraMonthly)}/mo${inp.extraMonthlyYears > 0 ? ` · ${inp.extraMonthlyYears}y` : ''}` : '—',
    lump: inp.lumpSum ? usd(inp.lumpSum) : '—',
    recurring: rec,
    properties: Array.isArray(inp.selectedIds) ? `${inp.selectedIds.length} selected` : 'Default',
  }
}

// Indices of the best column for a given snapshot key. dir 'min' (earlier) or 'max'.
function bestIndices(columns, key, dir) {
  const vals = columns.map((c) => (c.snapshot && Number.isFinite(c.snapshot[key]) ? c.snapshot[key] : null))
  const valid = vals.filter((v) => v !== null)
  if (valid.length < 2) return new Set()
  const best = dir === 'min' ? Math.min(...valid) : Math.max(...valid)
  const out = new Set()
  vals.forEach((v, i) => { if (v === best) out.add(i) })
  return out
}

// Colour-coded scenario action buttons so each purpose is recognisable at a
// glance: green = save/create, amber = update, violet = compare, sky = export.
const TINT_BTN = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed'
const TINT = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/50',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/50',
}

// Compact Scenarios control that lives in the top-right corner. Collapsed it is
// a single pill (with a saved-count badge and a "modified" dot); clicking it
// opens a dropdown with the save/compare/export actions and the saved chips.
function ScenarioWidget({ open, onToggle, scenarios, activeScenario, activeMatches, busy, onSave, onUpdate, onApply, onDelete, onCompare, compareOpen, compareColumns, onExportCompare, onExport, canExport }) {
  const modified = Boolean(activeScenario && !activeMatches)
  const showCompare = compareOpen && (compareColumns || []).length > 0
  return (
    <div className="relative">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="btn-secondary text-xs px-2.5 py-1.5" title="Saved plans">
        <span className="relative flex">
          <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
          {modified ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
        </span>
        <span className="hidden sm:inline">Saved plans</span>
        {scenarios.length ? (
          <span className="rounded-full bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">{scenarios.length}</span>
        ) : null}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open ? (
        <div className={`absolute right-0 z-30 mt-2 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-4 shadow-xl transition-[width] dark:border-gray-700 dark:bg-gray-800 ${showCompare ? 'w-[44rem]' : 'w-[26rem]'}`}>
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
              <Bookmark className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />Saved plans
            </span>
            {modified ? <span className="text-[11px] text-amber-600 dark:text-amber-400">“{activeScenario.name}” modified</span> : null}
          </div>

          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            {modified ? (
              <button type="button" onClick={onUpdate} disabled={busy} className={`${TINT_BTN} ${TINT.amber}`}>
                <Save className="h-3.5 w-3.5" aria-hidden="true" />Update
              </button>
            ) : null}
            <button type="button" onClick={onSave} disabled={busy || !canExport} className={`${TINT_BTN} ${TINT.emerald}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />Save
            </button>
            <button type="button" onClick={onCompare} disabled={!scenarios.length} aria-pressed={compareOpen}
              className={`${TINT_BTN} ${TINT.violet} ${compareOpen ? 'ring-2 ring-violet-500/40' : ''}`}>
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />Compare
            </button>
            <button type="button" onClick={onExport} disabled={!canExport} className={`${TINT_BTN} ${TINT.sky}`}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />Export
            </button>
          </div>

          <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700/70">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Entries{scenarios.length ? ` · ${scenarios.length}` : ''}
            </p>
            {scenarios.length ? (
              <div className="flex flex-wrap gap-2">
                {scenarios.map((s) => {
                  const isActive = activeScenario?.id === s.id && activeMatches
                  return (
                    <span key={s.id}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                        isActive
                          ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                      }`}>
                      {isActive ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                      <button type="button" onClick={() => onApply(s)} className="font-medium" title="Apply this plan">{s.name}</button>
                      <button type="button" onClick={() => onDelete(s.id)} disabled={busy} aria-label={`Delete ${s.name}`}
                        className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400">
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500">No saved plans yet. Tune the inputs, then “Save” to keep this plan and compare it against others.</p>
            )}
          </div>

          {showCompare ? <ComparePanel columns={compareColumns} onExport={onExportCompare} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function ComparePanel({ columns, onExport }) {
  if (!columns.length) return null
  const bestDebt = bestIndices(columns, 'debtFreeMonth', 'min')
  const bestTime = bestIndices(columns, 'timeSavedValue', 'max')
  const bestInterest = bestIndices(columns, 'interestSavedValue', 'max')
  const rows = columns.map((c) => ({ col: c, io: scenarioInputRows(c.inputs) }))

  const cell = 'px-3 py-2.5 text-sm whitespace-nowrap border-t border-gray-100 dark:border-gray-700/70'
  const bestCls = 'bg-green-50 font-semibold text-green-700 dark:bg-green-950/40 dark:text-green-300'
  const outcome = (label, pick, best) => (
    <tr>
      <th scope="row" className={`${cell} text-left font-normal text-gray-500 dark:text-gray-400`}>{label}</th>
      {rows.map((r, i) => (
        <td key={r.col.id} className={`${cell} ${best.has(i) ? bestCls : 'text-gray-900 dark:text-gray-100'}`}>
          <span className="inline-flex items-center gap-1">
            {best.has(i) ? <Trophy className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {pick(r.col) || '—'}
          </span>
        </td>
      ))}
    </tr>
  )

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700/70">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 dark:text-white">
          <GitCompare className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />Compare plans
        </h3>
        <button type="button" onClick={onExport} className="btn-secondary text-xs px-2.5 py-1.5">
          <Download className="h-3.5 w-3.5" aria-hidden="true" />Export comparison
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 dark:text-gray-500">Metric</th>
              {rows.map((r) => (
                <th key={r.col.id} className="px-3 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                  {r.col.name}{r.col.current ? <span className="ml-1 text-[10px] font-normal text-blue-600 dark:text-blue-400">live</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcome('Strategy', (c) => scenarioInputRows(c.inputs).strategy, new Set())}
            {outcome('Extra / month', (c) => scenarioInputRows(c.inputs).extra, new Set())}
            {outcome('One-time lump', (c) => scenarioInputRows(c.inputs).lump, new Set())}
            {outcome('Recurring', (c) => scenarioInputRows(c.inputs).recurring, new Set())}
            {outcome('Properties', (c) => scenarioInputRows(c.inputs).properties, new Set())}
            {outcome('Debt-free date', (c) => c.snapshot?.debtFreeDisplay || c.snapshot?.debtFreeDate, bestDebt)}
            {outcome('Time saved', (c) => c.snapshot?.timeSavedDisplay, bestTime)}
            {outcome('Interest saved', (c) => c.snapshot?.interestSavedDisplay, bestInterest)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        <Info className="h-3 w-3" aria-hidden="true" />
        Best value in each outcome row is highlighted. Saved columns show the results captured when you saved them.
      </p>
    </div>
  )
}

function SaveDialog({ busy, defaultName, onCancel, onSave }) {
  const [name, setName] = useState(defaultName || '')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const submit = (e) => { e.preventDefault(); const n = name.trim(); if (n) onSave(n) }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Save plan">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800">
        <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">Save plan</h3>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">Keeps the current inputs and results so you can switch back and compare.</p>
        <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">Name</label>
        <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder="Aggressive"
          className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-sm">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}

// Print-only document (single scenario or comparison). Hidden on screen; the
// page's @media print rules reveal it and hide the app chrome.
function ScenarioPrintDoc({ view }) {
  const { mode, columns } = view
  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const outcomeRows = [
    ['Strategy', (c) => scenarioInputRows(c.inputs).strategy],
    ['Extra / month', (c) => scenarioInputRows(c.inputs).extra],
    ['One-time lump', (c) => scenarioInputRows(c.inputs).lump],
    ['Recurring', (c) => scenarioInputRows(c.inputs).recurring],
    ['Properties', (c) => scenarioInputRows(c.inputs).properties],
    ['Debt-free date', (c) => c.snapshot?.debtFreeDisplay || c.snapshot?.debtFreeDate || '—'],
    ['Time saved', (c) => c.snapshot?.timeSavedDisplay || '—'],
    ['Interest saved', (c) => c.snapshot?.interestSavedDisplay || '—'],
  ]
  return (
    <div className="pp-print hidden" style={{ color: '#111', background: '#fff' }}>
      <div style={{ borderBottom: '2px solid #111', paddingBottom: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Payoff planner — {mode === 'compare' ? 'plan comparison' : columns[0]?.name || 'plan'}</div>
        <div style={{ fontSize: 12, color: '#555' }}>PropertyLens · generated {now}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #999' }}>Metric</th>
            {columns.map((c) => (
              <th key={c.id} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #999', fontWeight: 700 }}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outcomeRows.map(([label, pick]) => (
            <tr key={label}>
              <td style={{ padding: '6px 8px', borderBottom: '1px solid #ddd', color: '#555' }}>{label}</td>
              {columns.map((c) => (
                <td key={c.id} style={{ padding: '6px 8px', borderBottom: '1px solid #ddd' }}>{pick(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 10, color: '#888', marginTop: 12 }}>
        Results reflect each plan as saved. Balances and rates are a point-in-time snapshot from your loan data.
      </p>
    </div>
  )
}

