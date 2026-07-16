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

export default function MetricKPI({ metric, label, fallbackValue, subLabel, action, backendOwned = false }) {
  const title = label || metric?.label || 'Metric'
  const display = backendOwned && metric ? (metricDisplay(metric) ?? '—') : (metricDisplay(metric) ?? fallbackValue ?? '—')
  const tooltip = hasUsefulTooltip(metric)
  const supportingText = subLabel ?? metric?.subtitle

  return (
    <div className="stat-card group relative">
      <div className="mb-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <span>{title}</span>
        {tooltip ? (
          <span className="relative inline-flex">
            <Info className="h-3.5 w-3.5 text-gray-400" />
<span className="pointer-events-none absolute left-0 z-30 mt-5 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs normal-case tracking-normal text-gray-600 shadow-lg group-hover:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
              {metric.fullDisplayValue ? (
                <span className="mb-2 flex justify-between gap-3">
                  <span className="text-gray-400">Full value</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{metric.fullDisplayValue}</span>
                </span>
              ) : null}
              {metric.formula ? <span className="mb-2 block font-medium text-gray-900 dark:text-white">{metric.formula}</span> : null}
              {(metric.inputs || []).length ? (
                <span className="mb-2 block space-y-1">
                  {metric.inputs.map((input) => (
                    <span key={`${input.label}-${input.display}`} className="flex justify-between gap-3">
                      <span>{input.label}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{input.display ?? '—'}</span>
                    </span>
                  ))}
                </span>
              ) : null}
              {metric.computation ? <span className="mb-2 block text-gray-500 dark:text-gray-400">{metric.computation}</span> : null}
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                {metric.source ? <span>{sourceLabel(metric.source)}</span> : null}
{metric.status ? <span>{titleCaseMetricText(metric.status)}</span> : null}
                {metric.lastUpdated ? <span>{metric.lastUpdated}</span> : null}
              </span>
            </span>
          </span>
        ) : null}
        {action}
      </div>
      <p className={`text-xl font-bold ${toneClass(metric)}`}>{display}</p>
      {supportingText ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{supportingText}</p> : null}
    </div>
  )
}
