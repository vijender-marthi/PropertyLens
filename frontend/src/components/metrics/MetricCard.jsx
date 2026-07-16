import { Info } from 'lucide-react'

function hasUsefulTooltip(metric) {
  if (!metric) return false
  return Boolean(
    metric.fullDisplayValue ||
    metric.formula ||
    metric.computation ||
    metric.source ||
    metric.status ||
    metric.lastUpdated ||
    (metric.inputs || []).length
  )
}

function toneClass(metric) {
  if (metric?.tone === 'positive') return 'text-green-600'
  if (metric?.tone === 'negative') return 'text-red-600'
  return 'text-gray-900 dark:text-white'
}

function sourceLabel(source) {
return titleCaseMetricText(source || 'Calculated')
}

function titleCaseMetricText(value) {
return String(value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

function metricDisplay(metric) {
  return metric?.displayValue ?? metric?.display
}

export default function MetricCard({ metric, label, fallbackValue, note, muted = false, backendOwned = false }) {
  const display = backendOwned && metric ? (metricDisplay(metric) ?? '—') : (metricDisplay(metric) ?? fallbackValue ?? '—')
  const period = metric?.period ? ` / ${metric.period}` : ''
  const title = label || metric?.label || 'Metric'
  const tooltip = hasUsefulTooltip(metric)

  return (
    <div className="group relative bg-white p-4 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{title}</p>
        {tooltip ? (
          <div className="relative">
            <Info className="h-3.5 w-3.5 text-gray-400" />
<div className="pointer-events-none absolute right-0 z-30 mt-2 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs normal-case tracking-normal text-gray-600 shadow-lg group-hover:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
              {metric.fullDisplayValue ? (
                <div className="mb-2 flex justify-between gap-3">
                  <span className="text-gray-400">Full value</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{metric.fullDisplayValue}</span>
                </div>
              ) : null}
              {metric.formula ? <p className="mb-2 font-medium text-gray-900 dark:text-white">{metric.formula}</p> : null}
              {(metric.inputs || []).length ? (
                <div className="mb-2 space-y-1">
                  {metric.inputs.map((input) => (
                    <div key={`${input.label}-${input.display}`} className="flex justify-between gap-3">
                      <span>{input.label}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{input.display ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {metric.computation ? <p className="mb-2 text-gray-500 dark:text-gray-400">{metric.computation}</p> : null}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                {metric.source ? <span>{sourceLabel(metric.source)}</span> : null}
{metric.status ? <span>{titleCaseMetricText(metric.status)}</span> : null}
                {metric.lastUpdated ? <span>{metric.lastUpdated}</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <p className={`mt-1 text-lg font-bold ${muted ? 'text-gray-400 dark:text-gray-500' : toneClass(metric)}`}>
        {display}{period}
      </p>
      {note ? <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{note}</p> : null}
    </div>
  )
}
