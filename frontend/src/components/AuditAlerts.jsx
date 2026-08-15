import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Lightbulb, Sparkles } from 'lucide-react'
import { formatCurrency } from '../utils/formatters'

const money = (v) => formatCurrency(v)

// Derive tax audit triggers / optimization alerts from the portfolio tax model
// (portfolioAnalysis.taxCenter). Pure — safe to call on any page that has it.
export function buildTaxTriggers(model) {
  if (!model) return []
  const triggers = []
  const rows = model.rows || []
  const passive = rows.filter((r) => (r.taxableIncome || 0) < 0)
  const passiveTotal = passive.reduce((s, r) => s + (r.taxableIncome || 0), 0)
  const years = model.years || []
  const latest = years.length ? years[years.length - 1] : null
  if (latest != null) {
    for (const p of model.propertyLedger || []) {
      const d = (p.byYear || {})[String(latest)]
      if (!d) continue
      if ((d.propertyTax || 0) === 0) triggers.push({ type: 'warning', title: `Missing property tax — ${p.propertyName}`, body: `No property tax on file for ${latest}. Add the bill to capture the deduction.` })
      if ((d.insurance || 0) === 0) triggers.push({ type: 'warning', title: `Missing insurance — ${p.propertyName}`, body: `No insurance premium on file for ${latest}.` })
    }
  }
  if (passiveTotal < 0) triggers.push({ type: 'optimization', title: 'Passive losses may be suspended', body: `${passive.length} propert${passive.length === 1 ? 'y' : 'ies'} show passive losses totaling ${money(passiveTotal)}. Form 8582 may carry them forward unless you qualify as a real-estate professional.`, cta: 'Review Form 8582' })
  if ((model.totals?.depreciation || 0) > 0) triggers.push({ type: 'optimization', title: 'Depreciation is sheltering income', body: `${money(model.totals.depreciation)} of non-cash depreciation reduces taxable income in this scope.` })
  const warnings = triggers.filter((t) => t.type === 'warning')
  const opts = triggers.filter((t) => t.type !== 'warning')
  return [...warnings, ...opts].slice(0, 6)
}

// Compact "Alerts" bell that opens a dropdown of audit triggers. `onCta` fires
// when a trigger's action is clicked (e.g. navigate to the Form 8582 view).
export default function AuditAlerts({ model, onCta }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggers = buildTaxTriggers(model)
  const warnCount = triggers.filter((t) => t.type === 'warning').length
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const badgeCls = warnCount > 0 ? 'bg-amber-500 text-white' : triggers.length > 0 ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-700'
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${triggers.length} audit alerts`}
        className="relative inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800">
        <Bell className="h-4 w-4" /> Alerts
        {triggers.length > 0 ? <span className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-semibold ${badgeCls}`}>{triggers.length}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[22rem] max-h-[75vh] overflow-auto rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300"><Sparkles className="h-3.5 w-3.5" /></span>
            <h3 className="text-sm font-semibold text-gray-950 dark:text-white">AI audit triggers &amp; optimization alerts</h3>
          </div>
          {triggers.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-gray-500 dark:text-neutral-400">All clear — deductions look complete for this scope.</div>
          ) : (
            <div className="space-y-2">
              {triggers.map((t, i) => {
                const warn = t.type === 'warning'
                const Icon = warn ? AlertTriangle : Lightbulb
                return (
                  <div key={i} className={`flex gap-2.5 rounded-lg border p-2.5 ${warn ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20' : 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20'}`}>
                    <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${warn ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}><Icon className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${warn ? 'bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200' : 'bg-blue-200/70 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200'}`}>{warn ? 'Warning' : 'Optimization'}</span>
                      <p className="mt-1 text-sm font-medium text-gray-950 dark:text-white">{t.title}</p>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-neutral-300">{t.body}</p>
                      {t.cta ? <button type="button" onClick={() => { onCta?.(); setOpen(false) }} className="mt-1.5 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300">{t.cta} →</button> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
