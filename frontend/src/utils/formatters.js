const CURRENCY = 'USD'
const EMPTY = '—'

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function trimFixed(value, digits = 2) {
  return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

function fixed(value, digits = 2) {
  return Number(value).toFixed(digits)
}

function formatWithCommas(value, options = {}) {
  return new Intl.NumberFormat('en-US', options).format(value)
}

function sign(value) {
  return value < 0 ? '-' : ''
}

export function formatCurrency(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  const abs = Math.abs(number)
  return `${sign(number)}${formatWithCommas(abs, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
  })}`
}

export function formatCurrencyCompact(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  const abs = Math.abs(number)
  const prefix = sign(number)
  const threshold = options.threshold ?? 100_000
  if (abs < threshold) return formatCurrency(number, options)
 if (abs < 1_000_000) return `${prefix}$${trimFixed(abs / 1_000, options.kDigits ?? 0)}K`
 if (abs < 10_000_000) return `${prefix}$${trimFixed(abs / 1_000_000, options.mDigits ?? 1)}M`
 if (abs < 1_000_000_000) return `${prefix}$${formatWithCommas(Math.round(abs / 1_000_000))}M`
  return `${prefix}$${trimFixed(abs / 1_000_000_000, options.bDigits ?? 1)}B`
}

export function formatMetricCurrency(value, options = {}) {
 return formatCurrencyCompact(value, { threshold: 100_000, kDigits: 1, mDigits: 2, ...options })
}

export function formatMonthlyCurrency(value, options = {}) {
  return formatCurrency(value, options)
}

export function formatChartCurrency(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  const abs = Math.abs(number)
  const prefix = sign(number)
  if (abs < 1_000) return `${prefix}$${Math.round(abs)}`
  if (abs < 1_000_000) return `${prefix}$${Math.round(abs / 1_000)}K`
  if (abs < 10_000_000) return `${prefix}$${trimFixed(abs / 1_000_000, 1)}M`
  if (abs < 1_000_000_000) return `${prefix}$${Math.round(abs / 1_000_000)}M`
  return `${prefix}$${trimFixed(abs / 1_000_000_000, 1)}B`
}

export function formatChartNumber(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  const abs = Math.abs(number)
  const prefix = sign(number)
  if (abs < 1_000) return `${prefix}${Math.round(abs)}`
  if (abs < 1_000_000) return `${prefix}${Math.round(abs / 1_000)}K`
  if (abs < 10_000_000) return `${prefix}${trimFixed(abs / 1_000_000, 1)}M`
  if (abs < 1_000_000_000) return `${prefix}${Math.round(abs / 1_000_000)}M`
  return `${prefix}${trimFixed(abs / 1_000_000_000, 1)}B`
}

// Compact money used by Analytics tiles: $1.2M / $340K / $500. Relocated here
// (an allowed formatter module) verbatim so the output is byte-for-byte the same.
export function formatCompactMoney(value) {
  const amount = Number(value)
  const n = Number.isFinite(amount) ? amount : 0
  const abs = Math.abs(n)
  const sgn = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sgn}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${sgn}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return `${sgn}$${Math.round(abs).toLocaleString()}`
}

// Percent that keeps a fixed number of digits (does NOT scale <1 values, unlike
// formatPercent). Preserves the exact prior UI output, e.g. 22.50%.
export function formatPlainPercent(value, digits = 2) {
  const parsed = Number(value)
  const n = Number.isFinite(parsed) ? parsed : 0
  return `${n.toFixed(digits).replace(/\.00$/, '')}%`
}

// Fixed-decimal number as a string — a centralised stand-in for a bare
// value.toFixed(n) in UI code (identical output).
export function formatFixed(value, digits = 2) {
  return Number(value).toFixed(digits)
}

export function formatInterestRate(value) {
  const number = numberOrNull(value)
  if (number === null) return EMPTY
  const rate = Math.abs(number) > 0 && Math.abs(number) < 1 ? number * 100 : number
  return `${rate.toFixed(3)}%`
}

export function formatPercent(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  const percent = Math.abs(number) > 0 && Math.abs(number) < 1 ? number * 100 : number
  return `${trimFixed(percent, options.maximumFractionDigits ?? 2)}%`
}

export function formatRatio(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  return `${trimFixed(number, options.maximumFractionDigits ?? 2)}${options.suffix ?? ''}`
}

export function formatDate(value, options = {}) {
  if (!value) return options.empty ?? EMPTY
  const date = value instanceof Date
    ? value
    : options.includeTime
      ? new Date(value)
      : new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return options.empty ?? EMPTY
  if (options.includeTime) {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
}

export function formatMonthYear(value, options = {}) {
  if (!value) return options.empty ?? EMPTY
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return options.empty ?? EMPTY
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function formatYear(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  return String(Math.trunc(number))
}

export function formatInteger(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  return formatWithCommas(Math.round(number))
}

export function formatNumber(value, options = {}) {
  const number = numberOrNull(value)
  if (number === null) return options.empty ?? EMPTY
  return formatWithCommas(number, {
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  })
}

export function formatExtractedFieldValue(key, value, allData = {}) {
  if (key === 'schedule1_line5_delta' && (value === null || value === undefined) && allData.schedule1_line5_total == null) {
    return 'n/a'
  }
  // Parser provenance is retained in extracted data for auditing, but the
  // document review presents the financial value that will be applied.
  if (key === 'down_payment_source' && allData.down_payment != null) {
    return formatCurrency(allData.down_payment)
  }
  if (value === null || value === undefined || value === '') return EMPTY
  if (typeof value === 'number') return /year$/i.test(key) ? formatInteger(value) : formatNumber(value)
  return String(value)
}

export function formatFileSize(bytes, options = {}) {
  const number = numberOrNull(bytes)
  if (number === null) return options.empty ?? EMPTY
  if (number < 1024) return `${Math.round(number)} B`
  if (number < 1024 * 1024) return `${trimFixed(number / 1024, 1)} KB`
  return `${trimFixed(number / 1024 / 1024, 1)} MB`
}

export function rawExportValue(value) {
  return value ?? ''
}
