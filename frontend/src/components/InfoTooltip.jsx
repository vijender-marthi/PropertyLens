import { Info } from 'lucide-react'
import { formatCurrency, formatInteger, formatInterestRate, formatPercent, formatRatio } from '../utils/formatters'

function displayValue(item, fallbackUnit) {
  if (item?.display !== null && item?.display !== undefined) return item.display

  const unit = item?.unit || fallbackUnit
  if (unit === 'rate' || unit === 'interest_rate') return formatInterestRate(item?.value)
  if (unit === 'percent') return formatPercent(item?.value)
  if (unit === 'ratio') return formatRatio(item?.value)
  if (unit === 'count') return formatInteger(item?.value)
  if (unit === 'months') {
    const n = Math.round(Number(item?.value) || 0)
    return `${n} ${n === 1 ? 'month' : 'months'}`
  }
  return formatCurrency(item?.value)
}

export default function InfoTooltip({ metric, label }) {
  if (!metric) return null

  const inputs = metric.inputs || []
  const hasDetails = metric.formula || inputs.length || metric.source || metric.period
  if (!hasDetails) return null

  return (
    <details className="group/info relative inline-flex">
      <summary
        className="inline-flex cursor-pointer list-none rounded text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label={`How ${label || metric.label || 'this metric'} is calculated`}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </summary>
      <div
        className="absolute right-0 z-30 mt-2 hidden w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case tracking-normal text-gray-600 shadow-lg group-open/info:block group-hover/info:block dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
        role="tooltip"
      >
        {metric.formula ? <p className="font-semibold text-gray-900 dark:text-white">{metric.formula}</p> : null}
        {inputs.length ? (
          <dl className="mt-2 space-y-1.5">
            {inputs.map((input, index) => (
              <div key={`${input.label}-${index}`} className="flex items-start justify-between gap-3">
                <dt>{input.label}</dt>
                <dd className="text-right font-semibold text-gray-900 dark:text-white">{displayValue(input, metric.unit)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="mt-2 text-gray-400">
          {[metric.source, metric.period].filter(Boolean).join(' · ')}
        </p>
      </div>
    </details>
  )
}
