import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  HelpCircle,
  Home,
  KeyRound,
  Landmark,
  Plus,
  Receipt,
  Upload,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import DataTable from '../components/DataTable'
import LoanJourney from '../components/LoanJourney'
import { docAPI, propAPI } from '../services/api'
import {
  HOME_TYPE_OPTIONS,
  homeTypeLabel,
  normalizeHomeType,
  propertySetupFlagRows,
  propertySetupSections,
} from '../config/propertySetupPresentation'
import { formatCurrency, formatDate, formatInterestRate } from '../utils/formatters'

const LOAN_TYPES = ['FIXED', 'ARM', 'HELOC']
const LOAN_STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'REFINANCED', label: 'Refinanced' },
  { value: 'PAID_OFF', label: 'Paid Off' },
]
const CLOSED_LOAN_STATUSES = new Set(['CLOSED', 'REFINANCED', 'PAID_OFF'])
const LOAN_CLOSURE_REASONS = ['Refinance', 'Paid off', 'Sold property', 'Loan modification', 'Other']
const CURRENT_YEAR = new Date().getFullYear()
const REQUIRED_FIELDS = new Set(['name', 'property_type', 'original_residency_status', 'usage_type', 'purchase_price', 'purchase_date', 'market_value'])
const HOME_TYPE_VALUES = new Set(HOME_TYPE_OPTIONS.map((option) => option.value))
const SETTLEMENT_FIELD_DEFS = [
  { sourceKey: 'purchase_date', targetKey: 'purchase_date', label: 'Purchase date' },
  { sourceKey: 'settlement_total_amount', targetKey: 'market_value', label: 'Settlement total' },
  { sourceKey: 'purchase_price', targetKey: 'market_value', label: 'Purchase price' },
  { sourceKey: 'settlement_total_amount', targetKey: 'purchase_price', label: 'Settlement total' },
  { sourceKey: 'purchase_price', targetKey: 'purchase_price', label: 'Purchase price' },
  { sourceKey: 'purchase_date', targetKey: 'market_value_updated', label: 'Settlement date' },
  { sourceKey: 'closing_costs', targetKey: 'closing_costs', label: 'Closing costs' },
  { sourceKey: 'down_payment', targetKey: 'down_payment', label: 'Down payment' },
  { sourceKey: 'valuation_date', targetKey: 'market_value_updated', label: 'Valuation date' },
  { sourceKey: 'appraisal_date', targetKey: 'market_value_updated', label: 'Valuation date' },
]
const RESIDENCY_OPTIONS = [
  { value: 'Primary', label: 'Primary Residence', originalValue: 'Primary Residence' },
  { value: 'Rental', label: 'Rental', originalValue: 'Rental' },
  { value: 'Mixed', label: 'Mixed Use', originalValue: 'Mixed Use' },
]

const SETUP_SECTIONS = propertySetupSections
const EXPENSE_FIELDS = [
  { key: 'property_tax', label: 'Property tax / yr' },
  { key: 'insurance', label: 'Insurance / yr' },
  { key: 'hoa', label: 'HOA / yr', feature: 'hasHoa' },
  { key: 'repairs_maintenance', label: 'Repairs and maintenance / yr' },
  { key: 'property_management', label: 'Property management / yr' },
  { key: 'utilities', label: 'Utilities / yr' },
  { key: 'vacancy_allowance', label: 'Vacancy allowance / yr' },
  { key: 'capex_reserve', label: 'CapEx reserve / yr' },
  { key: 'other', label: 'Other / yr' },
]

const DEFAULT_PROPERTY = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  property_type: 'single_family',
  property_type_raw: '',
  usage_type: 'Rental',
  original_residency_status: '',
  current_residency_status: 'Vacant',
  purchase_date: '',
  purchase_price: '',
  down_payment: '',
  closing_costs: '',
  market_value: '',
  market_value_source: 'manual',
  market_value_updated: '',
  monthly_rent: '',
  occupancy_rate: 100,
  rental_start_date: '',
  rental_end_date: '',
  rental_start_date_origin: '',
  property_tax: '',
  insurance: '',
  hoa_flag: false,
  hoa_fee: '',
  hoa_history: '[]',
  hoa_special_assessment: '',
  maintenance: '',
  property_management_fee: '',
  utilities: '',
  vacancy_allowance: '',
  capex_reserve: '',
  other_expenses: '',
  solar_ownership: 'None',
  solar_monthly_payment: '',
  solar_purchase_price: '',
  land_value: '',
  construction_price: '',
  depreciation_years: 27.5,
}

const blankLoan = () => ({
  id: null,
  lender_name: '',
  account_number: '',
  loan_type: 'FIXED',
  status: 'OPEN',
  closed_date: '',
  closure_reason: '',
  replacement_loan_id: '',
  loan_group_id: '',
  servicer_sequence: '',
  servicer_start_date: '',
  servicer_end_date: '',
  transfer_reason: '',
  is_current_servicer: true,
  original_amount: '',
  current_balance: '',
  interest_rate: '',
  monthly_payment: '',
  estimated_total_monthly_payment: '',
  extra_monthly_payment: '',
  loan_term_years: '30',
  origination_date: '',
  escrow_amount: '',
  escrow_included: false,
  monthly_property_tax_escrow: '',
  monthly_insurance_escrow: '',
  monthly_mortgage_insurance: '',
  monthly_other_escrow: '',
  statement_date: '',
  source_document_id: null,
  sourceDocumentId: null,
  source_type: '',
  import_status: '',
  importStatusLabel: '',
  current_balance_source: '',
  current_balance_as_of: '',
  current_balance_verified: true,
  current_balance_source_label: '',
  current_balance_verification_status: '',
})

const blankRentalPeriod = () => ({
  period_ref: null,
  status: 'occupied',
  start_date: '',
  end_date: '',
  monthly_rent: '',
  notes: '',
})

const blankAnnualExpense = (year = CURRENT_YEAR) => ({
  id: null,
  year,
  property_tax: '',
  insurance: '',
  hoa: '',
  repairs_maintenance: '',
  property_management: '',
  utilities: '',
  vacancy_allowance: '',
  capex_reserve: '',
  other: '',
  property_tax_source: 'manual',
  insurance_source: 'manual',
  property_tax_source_label: 'Manual',
  insurance_source_label: 'Manual',
  source_status: 'manual',
  notes: '',
  entered: false,
  total: 0,
})

function rentalPeriodValue(period, camelKey, snakeKey) {
  return period?.[camelKey] ?? period?.[snakeKey] ?? ''
}

function rentalPeriodRef(period) {
  return rentalPeriodValue(period, 'periodRef', 'period_ref')
}

  function rentalPeriodMonthlyRent(period) {
    return period?.monthlyRentDisplay || formatCurrency(toNumber(rentalPeriodValue(period, 'monthlyRent', 'monthly_rent')))
  }

  function rentalSummaryLine(timeline) {
    const status = timeline?.summary?.currentStatus?.display || 'Vacant'
    const rent = timeline?.summary?.currentRent?.display
    const normalized = String(status || '').toLowerCase()
    const statusText = normalized === 'occupied' ? 'Currently occupied' : 'Currently vacant'
    return rent && rent !== '—' ? `${statusText} · ${rent}/mo` : statusText
  }

function normalizeHash(hash) {
  const raw = (hash || '').replace(/^#/, '')
  const [section] = raw.split('?')
  return SETUP_SECTIONS.some((item) => item.id === section) ? section : 'property'
}

function toNumber(value) {
  if (value === '' || value == null) return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function numberOrEmpty(value) {
  return value === 0 || value ? String(value) : ''
}

function normalizeAnnualExpense(row, year = CURRENT_YEAR) {
  return {
    ...blankAnnualExpense(year),
    ...row,
    year: Number(row?.year || year),
    property_tax: numberOrEmpty(row?.property_tax),
    insurance: numberOrEmpty(row?.insurance),
    hoa: numberOrEmpty(row?.hoa),
    repairs_maintenance: numberOrEmpty(row?.repairs_maintenance),
    property_management: numberOrEmpty(row?.property_management),
    utilities: numberOrEmpty(row?.utilities),
    vacancy_allowance: numberOrEmpty(row?.vacancy_allowance),
    capex_reserve: numberOrEmpty(row?.capex_reserve),
    other: numberOrEmpty(row?.other),
    property_tax_source: row?.property_tax_source || 'manual',
    insurance_source: row?.insurance_source || 'manual',
    property_tax_source_label: row?.property_tax_source_label || '',
    insurance_source_label: row?.insurance_source_label || '',
    entered: Boolean(row?.entered),
    total: toNumber(row?.total),
  }
}

function annualExpensePayload(row, year = CURRENT_YEAR) {
  return {
    year: Number(row?.year || year),
    property_tax: toNumber(row?.property_tax),
    insurance: toNumber(row?.insurance),
    hoa: toNumber(row?.hoa),
    repairs_maintenance: toNumber(row?.repairs_maintenance),
    property_management: toNumber(row?.property_management),
    utilities: toNumber(row?.utilities),
    vacancy_allowance: toNumber(row?.vacancy_allowance),
    capex_reserve: toNumber(row?.capex_reserve),
    other: toNumber(row?.other),
    property_tax_source: row?.property_tax_source || 'manual',
    insurance_source: row?.insurance_source || 'manual',
    source_status: row?.source_status || 'manual',
    notes: row?.notes || '',
  }
}

function annualExpenseSourceBadge(row, key) {
  if (!['property_tax', 'insurance'].includes(key)) return null
  const sourceKey = row?.[`${key}_source`] || ''
  if (!sourceKey || !toNumber(row?.[key])) return null
  const label = row?.[`${key}_source_label`]
    || (sourceKey === 'escrow-estimate' ? 'Estimated (escrow)' : sourceKey === 'reported' ? 'Reported' : 'Manual')
  return {
    label: sourceKey === 'escrow-estimate' ? 'Estimated (escrow)' : label,
    tone: sourceKey === 'escrow-estimate' ? 'estimate' : sourceKey === 'reported' ? 'reported' : 'manual',
    title: label,
  }
}

function apiErrorMessage(err, fallback = 'Save failed') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || item?.message)
      .filter(Boolean)
      .join(' ')
      || fallback
  }
  return fallback
}

function duplicateDocumentFromError(err) {
  const detail = err?.response?.data?.detail
  if (err?.response?.status !== 409 || !detail || typeof detail !== 'object' || !detail.id) return null
  return {
    id: detail.id,
    name: detail.name || 'Existing document',
    matchType: detail.match_type || 'similar',
    uploadDate: detail.upload_date || '',
    propertyAddress: detail.property_address || '',
    category: detail.doc_category || '',
  }
}

function originalResidencyFromUsage(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'primary' || normalized === 'primary residence') return 'Primary Residence'
  if (normalized === 'mixed' || normalized === 'mixed use') return 'Mixed Use'
  return 'Rental'
}

function setupImportRole(document) {
  const role = document?.setupImportRole || document?.extracted_data?.setup_import_role || document?.extracted_data?._setup_import_role
  if (role === 'settlement_document' || role === 'closing_document') return role
  return document?.extracted_data?.original_amount || document?.extracted_data?.loan_amount ? 'closing_document' : 'settlement_document'
}

function setupImportRoleLabel(document) {
  return setupImportRole(document) === 'settlement_document' ? 'Settlement document' : 'Closing document'
}

function settlementDocumentsFromDocuments(documents) {
  return [...documents]
    .filter((doc) => doc.doc_category === 'closing_statement')
    .sort((left, right) => new Date(right.upload_date || 0) - new Date(left.upload_date || 0))
}

function latestSettlementDocument(documents) {
  return settlementDocumentsFromDocuments(documents)[0] || null
}

function settlementSourcesFromDocument(document, property) {
  if (!document?.extracted_data || !property) return {}
  return SETTLEMENT_FIELD_DEFS.reduce((sources, { sourceKey, targetKey }) => {
    if (sources[targetKey]) return sources
    const extractedValue = document.extracted_data[sourceKey]
    if (extractedValue == null || extractedValue === '') return sources
    const propertyValue = property[targetKey]
    const matches = targetKey === 'purchase_date'
      ? normalizeDateInput(propertyValue) === normalizeDateInput(extractedValue)
      : toNumber(propertyValue) === toNumber(extractedValue)
    if (matches) {
      sources[targetKey] = {
        documentId: document.id,
        documentName: document.display_name || document.original_filename,
        sourceField: sourceKey,
      }
    }
    return sources
  }, {})
}

function selectedPurchasePriceComponentIds(selection) {
  if (!selection?.components?.length) return []
  return selection.components
    .filter((component) => component.selected)
    .map((component) => component.id)
}

function loanStatementSourcesFromLoan(loan) {
  if (!loan?.source_document_id || loan.source_type !== 'mortgage_statement') return {}
  const source = {
    label: 'from statement',
    title: 'Reported from mortgage statement',
    documentName: loan.sourceDocumentName || 'mortgage statement',
  }
  return {
    current_balance: source,
    monthly_property_tax_escrow: source,
    monthly_insurance_escrow: source,
    monthly_mortgage_insurance: source,
    monthly_other_escrow: source,
    escrow_amount: source,
    estimated_total_monthly_payment: source,
    statement_date: source,
  }
}

function initialValuationDateOrigin(prop) {
  if (!prop?.market_value_updated) return 'auto_purchase_date'
  return 'backend_existing'
}

function isOriginalResidencyRental(value) {
  return String(value || '').trim().toLowerCase() === 'rental'
}

function documentDisplayDate(value) {
  return value ? formatDate(value) : ''
}

function normalizeDateInput(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return raw
  const [, month, day, year] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function isDecimalDraft(value) {
  return value === '' || /^-?\d*\.?\d*$/.test(String(value))
}

function statusLabel(status) {
  if (status === 'complete') return 'Complete'
  if (status === 'partial') return 'Partial'
  if (status === 'needs_review') return 'Needs review'
  return 'Empty'
}

function sectionPresentation(sectionId) {
  return SETUP_SECTIONS.find((section) => section.id === sectionId) || SETUP_SECTIONS[0]
}

const SECTION_ICONS = {
  Home,
  Landmark,
  KeyRound,
  Receipt,
  Calculator,
}

function SectionIcon({ icon, className = 'h-4 w-4' }) {
  const Icon = SECTION_ICONS[icon] || Home
  return <Icon className={className} aria-hidden="true" />
}

function Field({ label, children, error, helper, emphasis = false, required = false, source, fieldKey }) {
  const sourceToneClass = source?.tone === 'estimate'
    ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
    : source?.tone === 'reported'
      ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
      : source?.tone === 'manual'
        ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
        : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
  return (
    <div className={emphasis ? 'md:col-span-1' : undefined} data-field-key={fieldKey || undefined}>
      <label className={`mb-1.5 flex items-center gap-1.5 text-sm font-medium ${emphasis ? 'text-gray-950 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
        <span>{label}{required ? <span className="ml-0.5 text-red-600" aria-label="required">*</span> : null}</span>
        {helper ? (
          <HelpCircle
            className="h-3.5 w-3.5 text-gray-400"
            aria-label={`${label}: ${helper}`}
          >
            <title>{helper}</title>
          </HelpCircle>
        ) : null}
        {source ? (
          <span
            className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${sourceToneClass}`}
            title={source.documentName ? `Imported from ${source.documentName}` : source.title || 'Imported from source document'}
          >
            {source.label || 'from settlement'}
          </span>
        ) : null}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p> : null}
    </div>
  )
}

function TextInput({ label, value, onChange, type = 'text', error, helper, placeholder, emphasis = false, required = false, source, fieldKey }) {
  return (
    <Field label={label} error={error} helper={helper} emphasis={emphasis} required={required} source={source} fieldKey={fieldKey}>
      <input
        className={`h-11 w-full rounded-lg border bg-gray-100 px-3 text-sm text-gray-950 outline-none transition-colors duration-150 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-600 ${emphasis ? 'font-semibold' : 'font-medium'} ${error ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`}
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
      />
    </Field>
  )
}

function MoneyInput({ label, value, onChange, error, helper, emphasis = false, required = false, source, fieldKey }) {
  const [focused, setFocused] = useState(false)
  const displayValue = focused || value === '' || value == null ? (value ?? '') : formatCurrency(toNumber(value))
  return (
    <Field label={label} error={error} helper={helper} emphasis={emphasis} required={required} source={source} fieldKey={fieldKey}>
      <div className={`flex h-11 items-center rounded-lg border bg-gray-100 transition-colors duration-150 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:bg-gray-950 ${error ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`}>
        <input
          className={`w-full rounded-lg border-0 bg-transparent px-3 text-sm text-gray-950 outline-none dark:text-white ${emphasis ? 'font-semibold' : 'font-medium'}`}
          type="text"
          inputMode="decimal"
          value={displayValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const next = event.target.value.replace(/[$,\s]/g, '')
            if (isDecimalDraft(next)) onChange(next)
          }}
          aria-invalid={Boolean(error)}
        />
      </div>
    </Field>
  )
}

function PercentInput({ label, value, onChange, error, helper, emphasis = false, required = false, source, fieldKey }) {
  return (
    <Field label={label} error={error} helper={helper} emphasis={emphasis} required={required} source={source} fieldKey={fieldKey}>
      <div className={`flex h-11 items-center rounded-lg border bg-gray-100 transition-colors duration-150 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:bg-gray-950 ${error ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`}>
        <input
          className={`w-full rounded-l-lg border-0 bg-transparent px-3 text-sm text-gray-950 outline-none dark:text-white ${emphasis ? 'font-semibold' : 'font-medium'}`}
          type="text"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(event) => {
            const next = event.target.value
            if (isDecimalDraft(next)) onChange(next)
          }}
          aria-invalid={Boolean(error)}
        />
        <span className="px-3 text-gray-500 dark:text-gray-400">%</span>
      </div>
    </Field>
  )
}

function SelectInput({ label, value, onChange, children, error, helper, emphasis = false, required = false, source, fieldKey }) {
  return (
    <Field label={label} error={error} helper={helper} emphasis={emphasis} required={required} source={source} fieldKey={fieldKey}>
      <select className={`h-11 w-full rounded-lg border bg-gray-100 px-3 text-sm text-gray-950 outline-none transition-colors duration-150 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:bg-gray-950 dark:text-white ${emphasis ? 'font-semibold' : 'font-medium'} ${error ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`} value={value ?? ''} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)}>
        {children}
      </select>
    </Field>
  )
}

function FeatureToggle({ row, checked, onChange }) {
  return (
    <label className="group cursor-pointer">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="inline-flex min-w-20 items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:text-blue-700 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:peer-checked:border-blue-400 dark:peer-checked:bg-blue-950/50 dark:peer-checked:text-blue-300">
        {row.title}
      </span>
    </label>
  )
}

function SaveStatusChip({ state, dirty }) {
  const saving = state === 'Saving'
  const failed = state === 'Save failed'
  const warning = state === 'Validation warning'
  const label = saving ? 'Saving' : failed ? 'Save failed' : warning ? 'Review' : dirty ? 'Unsaved' : 'Saved'
  const className = failed
    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
    : warning || dirty || saving
      ? 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/60 dark:bg-yellow-950/30 dark:text-yellow-300'
      : 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`} aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${failed ? 'bg-red-500' : warning || dirty || saving ? 'bg-yellow-500' : 'bg-green-500'}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function PropertySetupRecords({ title, description, children }) {
  if (!children) return null
  return (
    <section className="border-t border-gray-200 pt-5 dark:border-gray-800">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-gray-950 dark:text-white">{title}</h3>
        {description ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function PropertySetupEditor({ title, description, children }) {
  return (
    <section className="border-t border-gray-200 pt-5 first:border-t-0 first:pt-0 dark:border-gray-800">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-gray-950 dark:text-white">{title}</h3>
        {description ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function SetupSubsection({ title, children }) {
  return (
    <section className="border-t border-gray-200 pt-4 first:border-t-0 first:pt-0 dark:border-gray-800">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h4>
      {children}
    </section>
  )
}

function PropertySetupFooter({ isFinalSection, nextSection, saving, onCancel, onSaveDraft, onSaveProperty, onNext }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {isFinalSection ? (
          <button type="button" className="btn-primary" onClick={onSaveProperty} disabled={saving}>
            Save Property
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={onSaveDraft} disabled={saving}>
              Save Draft
            </button>
            <button type="button" className="btn-primary flex items-center justify-center gap-2" onClick={onNext} disabled={!nextSection}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const setupStepIcons = {
  Home,
  Landmark,
  KeyRound,
  Receipt,
}

function SetupStepIcon({ name }) {
  const Icon = setupStepIcons[name] || Home
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
}

function PropertySetupTabs({ sections, activeSection, statusById, loansCount, errorCountsBySection = {}, onSelect }) {
  const tabRefs = useRef({})
  useEffect(() => {
    tabRefs.current[activeSection]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeSection])
  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <nav className="flex overflow-x-auto px-4 py-3 sm:px-5" role="tablist" aria-label="Property form sections">
        {sections.map((section, index) => {
          const status = statusById.get(section.id)
          const active = activeSection === section.id
          const errorCount = errorCountsBySection[section.id] || 0
          const label = section.id === 'financing' && loansCount ? `${section.title} (${loansCount})` : section.title
          const complete = status?.status === 'complete'
          const state = active ? 'current' : complete ? 'complete' : 'upcoming'
          const connectorComplete = complete
          return (
            <div key={section.id} className="flex shrink-0 items-center">
              <button
                ref={(node) => { tabRefs.current[section.id] = node }}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(section.id)}
                className={`flex min-w-[10rem] items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  state === 'complete'
                    ? 'border-green-200 bg-green-50 text-green-800 hover:border-green-300 dark:border-green-900/70 dark:bg-green-950/30 dark:text-green-200'
                    : state === 'current'
                      ? 'border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-300 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-200'
                      : 'border-transparent bg-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white'
                }`}
              >
                <SetupStepIcon name={section.icon} />
                <span className="whitespace-nowrap">{label}</span>
                <span className="ml-auto inline-flex items-center">
                  {state === 'complete' ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white" aria-label={`${section.title}: Complete`}>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  ) : (
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-semibold ${
                        state === 'current'
                          ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-200'
                          : 'border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                      }`}
                      aria-label={`${section.title}: ${state === 'current' ? 'Current step' : 'Upcoming step'} ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                  )}
                  {errorCount ? <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300" aria-label={`${section.title}: ${errorCount} errors`}>● {errorCount}</span> : null}
                </span>
                {status?.status === 'partial' ? <span className="sr-only">{section.title}: Partial</span> : null}
                {status?.status === 'needs_review' ? <span className="sr-only">{section.title}: Needs review</span> : null}
                {!['complete', 'partial', 'needs_review'].includes(status?.status) ? <span className="sr-only">{section.title}: Empty</span> : null}
              </button>
              {index < sections.length - 1 ? (
                <span aria-hidden="true" className={`h-px w-8 shrink-0 ${connectorComplete ? 'bg-green-300 dark:bg-green-800' : 'bg-gray-200 dark:bg-gray-800'}`} />
              ) : null}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

function PropertySetupSection({
  tabs,
  activePresentation,
  status,
  saveState,
  dirty,
  records,
  editor,
  footer,
  headingRef,
}) {
  return (
    <section aria-labelledby="active-section-heading" className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {tabs}
      <div className="p-4 sm:p-5">
      <div className="mb-6 flex flex-col gap-4 border-b border-gray-200 pb-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
            <SectionIcon icon={activePresentation.icon} className="h-4 w-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="active-section-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-gray-950 outline-none dark:text-white">
                {activePresentation.title}
              </h2>
              <SaveStatusChip state={saveState} dirty={dirty} />
            </div>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">{activePresentation.subtitle}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Fields marked <span className="font-semibold text-red-600">*</span> are required.</p>
          </div>
        </div>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{statusLabel(status)}</span>
      </div>

      <div className="space-y-5">
        {records}
        {editor}
      </div>

      {footer}
      </div>
    </section>
  )
}

function propertyPayload(form) {
  return {
    name: form.name || undefined,
    address: form.address?.trim() || '',
    city: form.city || '',
    state: form.state || '',
    zip_code: form.zip_code || '',
    property_type: normalizeHomeType(form.property_type),
    property_type_raw: normalizeHomeType(form.property_type) === 'other' ? form.property_type_raw || '' : '',
    usage_type: form.usage_type || 'Rental',
    original_residency_status: form.original_residency_status || null,
    current_residency_status: form.current_residency_status || null,
    purchase_date: normalizeDateInput(form.purchase_date),
    purchase_price: toNumber(form.purchase_price),
    down_payment: toNumber(form.down_payment),
    closing_costs: toNumber(form.closing_costs),
    market_value: toNumber(form.market_value),
    market_value_source: form.market_value_source || 'manual',
    market_value_updated: normalizeDateInput(form.market_value_updated),
    monthly_rent: toNumber(form.monthly_rent),
    occupancy_rate: toNumber(form.occupancy_rate) || 100,
    rental_start_date: normalizeDateInput(form.rental_start_date),
    rental_end_date: normalizeDateInput(form.rental_end_date),
    rental_start_date_origin: form.rental_start_date_origin || null,
    property_tax: toNumber(form.property_tax),
    insurance: toNumber(form.insurance),
    hoa_flag: Boolean(form.hoa_flag),
    hoa_fee: toNumber(form.hoa_fee),
    hoa_history: form.hoa_history || '[]',
    hoa_special_assessment: toNumber(form.hoa_special_assessment),
    maintenance: toNumber(form.maintenance),
    property_management_fee: toNumber(form.property_management_fee),
    utilities: toNumber(form.utilities),
    vacancy_allowance: toNumber(form.vacancy_allowance),
    capex_reserve: toNumber(form.capex_reserve),
    other_expenses: toNumber(form.other_expenses),
    solar_ownership: form.solar_ownership || 'None',
    solar_monthly_payment: toNumber(form.solar_monthly_payment),
    solar_purchase_price: toNumber(form.solar_purchase_price),
    land_value: toNumber(form.land_value),
    construction_price: toNumber(form.construction_price),
    depreciation_years: toNumber(form.depreciation_years) || (normalizeHomeType(form.property_type) === 'commercial_residential' ? 39 : 27.5),
  }
}

function loanPayload(loan) {
  return {
    lender_name: loan.lender_name || '',
    loan_type: loan.loan_type || 'FIXED',
    account_number: String(loan.account_number || '').trim(),
    status: loan.status || 'OPEN',
    closed_date: CLOSED_LOAN_STATUSES.has(loan.status) ? normalizeDateInput(loan.closed_date) : null,
    closure_reason: CLOSED_LOAN_STATUSES.has(loan.status) ? loan.closure_reason || '' : '',
    replacement_loan_id: CLOSED_LOAN_STATUSES.has(loan.status) && loan.replacement_loan_id ? Number(loan.replacement_loan_id) : null,
    loan_group_id: loan.loan_group_id || null,
    servicer_sequence: loan.servicer_sequence ? Number(loan.servicer_sequence) : null,
    servicer_start_date: normalizeDateInput(loan.servicer_start_date),
    servicer_end_date: normalizeDateInput(loan.servicer_end_date),
    transfer_reason: loan.transfer_reason || '',
    is_current_servicer: loan.is_current_servicer !== false,
    original_amount: toNumber(loan.original_amount),
    current_balance: toNumber(loan.current_balance),
    interest_rate: toNumber(loan.interest_rate),
    monthly_payment: toNumber(loan.monthly_payment),
    estimated_total_monthly_payment: toNumber(loan.estimated_total_monthly_payment || loan.monthly_payment),
    extra_monthly_payment: toNumber(loan.extra_monthly_payment),
    loan_term_years: Math.max(1, Math.round(toNumber(loan.loan_term_years) || 30)),
    origination_date: normalizeDateInput(loan.origination_date),
    escrow_amount: toNumber(loan.escrow_amount),
    escrow_included: Boolean(loan.escrow_included),
    monthly_property_tax_escrow: toNumber(loan.monthly_property_tax_escrow),
    monthly_insurance_escrow: toNumber(loan.monthly_insurance_escrow),
    monthly_mortgage_insurance: toNumber(loan.monthly_mortgage_insurance),
    monthly_other_escrow: toNumber(loan.monthly_other_escrow),
    statement_date: normalizeDateInput(loan.statement_date),
    source_document_id: loan.source_document_id || loan.sourceDocumentId || null,
    source_type: loan.source_type || loan.sourceDocumentType || '',
    import_status: loan.import_status || loan.importStatus || '',
    current_balance_source: loan.current_balance_source || '',
    current_balance_as_of: normalizeDateInput(loan.current_balance_as_of),
    current_balance_verified: loan.current_balance_verified !== false,
  }
}

export default function PropertyFormPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [propertyId, setPropertyId] = useState(id || null)
  const [activeSection, setActiveSection] = useState(() => normalizeHash(location.hash))
  const [form, setForm] = useState(DEFAULT_PROPERTY)
  const [loans, setLoans] = useState([])
  const [loanGroups, setLoanGroups] = useState([])
  const [loanTransferSuggestions, setLoanTransferSuggestions] = useState([])
  const [loanTransferApplying, setLoanTransferApplying] = useState(null)
  const [loanTransferCloseDates, setLoanTransferCloseDates] = useState({})
  const [loanEditorIndex, setLoanEditorIndex] = useState(null)
  const [rentalTimeline, setRentalTimeline] = useState(null)
  const [rentalDraft, setRentalDraft] = useState(blankRentalPeriod())
  const [rentalDeleteTarget, setRentalDeleteTarget] = useState(null)
  const [expenseRows, setExpenseRows] = useState([])
  const [expenseYear, setExpenseYear] = useState(CURRENT_YEAR)
  const [setupStatus, setSetupStatus] = useState(null)
  const [flags, setFlags] = useState({ hasFinancing: false, hasHoa: false, hasSolar: false })
  const [dirtySection, setDirtySection] = useState(null)
  const [pendingSection, setPendingSection] = useState(null)
  const [sectionState, setSectionState] = useState({})
  const [errors, setErrors] = useState({})
  const [finalValidation, setFinalValidation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState({ status: 'idle' })
  const [settlementSources, setSettlementSources] = useState({})
  const [settlementUploading, setSettlementUploading] = useState(false)
  const [settlementReview, setSettlementReview] = useState(null)
  const [settlementDocuments, setSettlementDocuments] = useState([])
  const [settlementDocument, setSettlementDocument] = useState(null)
  const [loanStatementUploading, setLoanStatementUploading] = useState(false)
  const [loanStatementReview, setLoanStatementReview] = useState(null)
  const [loanConsolidatedReview, setLoanConsolidatedReview] = useState(null)
  const [loanStatementConflict, setLoanStatementConflict] = useState(null)
  const [settlementAddressValidation, setSettlementAddressValidation] = useState(null)
  const [settlementAddressConfirmed, setSettlementAddressConfirmed] = useState(false)
  const [settlementDelinkConfirm, setSettlementDelinkConfirm] = useState(false)
  const [escrowDisableTarget, setEscrowDisableTarget] = useState(null)
  const [expenseUploadTarget, setExpenseUploadTarget] = useState(null)
  const [expenseUploading, setExpenseUploading] = useState(false)
  const [expenseAddressReview, setExpenseAddressReview] = useState(null)
  const [valuationDateOrigin, setValuationDateOrigin] = useState('auto_purchase_date')
  const [rentalAvailableFromOrigin, setRentalAvailableFromOrigin] = useState('backend_existing')
  const activeHeadingRef = useRef(null)
  const previewRequestRef = useRef(0)
  const settlementInputRef = useRef(null)
  const settlementUploadRoleRef = useRef('closing_document')
  const loanStatementInputRef = useRef(null)
  const expenseDocumentInputRef = useRef(null)
  const unsavedPrimaryActionRef = useRef(null)

  const statusById = useMemo(() => {
    const map = new Map((setupStatus?.sections || []).map((section) => [section.id, section]))
    SETUP_SECTIONS.forEach((section) => {
      if (!map.has(section.id)) {
        map.set(section.id, { id: section.id, title: section.title, status: 'empty', completedRequired: 0, totalRequired: 0, visible: true })
      }
    })
    return map
  }, [setupStatus])

  const visibleSections = useMemo(() => SETUP_SECTIONS.filter((section) => {
    if (section.id === 'financing') return flags.hasFinancing || loans.length > 0
    if (section.id === 'rental') return String(form.usage_type || '').toLowerCase() !== 'primary'
    return statusById.get(section.id)?.visible !== false
  }), [flags.hasFinancing, form.usage_type, loans.length, statusById])
  const setupErrorCounts = useMemo(() => tabErrorCounts(finalValidation), [finalValidation])

  const activeVisibleSections = visibleSections.length ? visibleSections : [SETUP_SECTIONS[0]]
  const nextSection = activeVisibleSections.find((section) => activeVisibleSections.findIndex((item) => item.id === section.id) > activeVisibleSections.findIndex((item) => item.id === activeSection))
  const setupProgress = useMemo(() => {
    const total = activeVisibleSections.length
    if (!total) return { percent: 0, complete: 0, total: 0 }
    const complete = activeVisibleSections.filter((section) => statusById.get(section.id)?.status === 'complete').length
    const completedRequired = activeVisibleSections.reduce((sum, section) => sum + (statusById.get(section.id)?.completedRequired || 0), 0)
    const totalRequired = activeVisibleSections.reduce((sum, section) => sum + (statusById.get(section.id)?.totalRequired || 0), 0)
    const percent = totalRequired > 0
      ? Math.round((completedRequired / totalRequired) * 100)
      : Math.round((complete / total) * 100)
    return { percent, complete, total }
  }, [activeVisibleSections, statusById])
  const expenseYears = useMemo(() => {
    const parsed = Date.parse(form.purchase_date)
    const purchaseYear = Number.isNaN(parsed) ? CURRENT_YEAR : new Date(parsed).getFullYear()
    const startYear = Math.min(purchaseYear, CURRENT_YEAR)
    return Array.from({ length: CURRENT_YEAR - startYear + 1 }, (_, index) => startYear + index)
  }, [form.purchase_date])
  const selectedExpenseRow = useMemo(() => (
    expenseRows.find((row) => Number(row.year) === Number(expenseYear)) || blankAnnualExpense(expenseYear)
  ), [expenseRows, expenseYear])

  useEffect(() => {
    setActiveSection(normalizeHash(location.hash))
  }, [location.hash])

  useEffect(() => {
    activeHeadingRef.current?.focus()
  }, [activeSection])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      propAPI.get(id),
      propAPI.setupStatus(id),
      propAPI.rentalTimeline(id).catch(() => ({ data: null })),
      propAPI.annualExpenses(id).catch(() => ({ data: [] })),
      docAPI.list(id).catch(() => ({ data: [] })),
    ])
      .then(([propertyResponse, statusResponse, rentalResponse, expenseResponse, documentResponse]) => {
        hydrateProperty(propertyResponse.data)
        setSetupStatus(statusResponse.data)
        setRentalTimeline(rentalResponse.data)
        setExpenseRows((expenseResponse.data || []).map((row) => normalizeAnnualExpense(row)))
          const setupDocuments = settlementDocumentsFromDocuments(documentResponse.data || [])
	        const settlement = setupDocuments[0] || null
          setSettlementDocuments(setupDocuments)
	        setSettlementDocument(settlement)
	        setSettlementSources(settlementSourcesFromDocument(settlement, propertyResponse.data))
	        if (settlement?.id) {
	          docAPI.setupImportReview(settlement.id)
	            .then((reviewResponse) => {
	              setSettlementAddressValidation(reviewResponse.data.addressValidation || null)
	              setSettlementAddressConfirmed(reviewResponse.data.addressValidation?.status === 'match')
	            })
	            .catch(() => {})
	        }
          propAPI.loanTransferSuggestions(id)
            .then((response) => {
              setLoanTransferSuggestions(response.data.suggestions || [])
              setLoanGroups(response.data.loanGroups || [])
            })
            .catch(() => setLoanTransferSuggestions([]))
	      })
      .catch(() => toast.error('Failed to load property setup'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!propertyId || !['property', 'rental', 'expenses'].includes(activeSection)) return undefined
    if (dirtySection !== activeSection) return undefined
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    const controller = new AbortController()
    setPreview((current) => ({ ...current, status: 'updating' }))
    const handle = setTimeout(() => {
      propAPI.preview(propertyId, { section: activeSection, draftChanges: previewDraft(activeSection) }, { signal: controller.signal })
        .then((response) => {
          if (previewRequestRef.current === requestId) setPreview({ status: 'available', data: response.data })
        })
        .catch((err) => {
          if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return
          if (previewRequestRef.current === requestId) setPreview({ status: 'failed' })
        })
    }, 350)
    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [activeSection, dirtySection, form, propertyId, expenseRows, expenseYear])

  function hydrateProperty(prop) {
    setPropertyId(String(prop.id))
    setForm({
      ...DEFAULT_PROPERTY,
      ...prop,
      property_type: normalizeHomeType(prop.property_type),
      property_type_raw: normalizeHomeType(prop.property_type) === 'other' ? prop.property_type_raw || prop.property_type || '' : prop.property_type_raw || '',
      purchase_date: normalizeDateInput(prop.purchase_date),
      purchase_price: numberOrEmpty(prop.purchase_price),
      down_payment: numberOrEmpty(prop.down_payment),
      closing_costs: numberOrEmpty(prop.closing_costs),
      market_value: numberOrEmpty(prop.market_value),
      market_value_updated: normalizeDateInput(prop.market_value_updated),
      original_residency_status: prop.original_residency_status || originalResidencyFromUsage(prop.usage_type),
      monthly_rent: numberOrEmpty(prop.monthly_rent),
      rental_start_date: normalizeDateInput(prop.rental_start_date),
      rental_end_date: normalizeDateInput(prop.rental_end_date),
      rental_start_date_origin: prop.rental_start_date_origin || (prop.rental_start_date ? 'backend_existing' : ''),
      property_tax: numberOrEmpty(prop.property_tax),
      insurance: numberOrEmpty(prop.insurance),
      hoa_fee: numberOrEmpty(prop.hoa_fee),
      hoa_special_assessment: numberOrEmpty(prop.hoa_special_assessment),
      maintenance: numberOrEmpty(prop.maintenance),
      property_management_fee: numberOrEmpty(prop.property_management_fee),
      utilities: numberOrEmpty(prop.utilities),
      vacancy_allowance: numberOrEmpty(prop.vacancy_allowance),
      capex_reserve: numberOrEmpty(prop.capex_reserve),
      other_expenses: numberOrEmpty(prop.other_expenses),
      solar_monthly_payment: numberOrEmpty(prop.solar_monthly_payment),
      solar_purchase_price: numberOrEmpty(prop.solar_purchase_price),
      land_value: numberOrEmpty(prop.land_value),
      construction_price: numberOrEmpty(prop.construction_price),
      depreciation_years: numberOrEmpty(prop.depreciation_years || 27.5),
      current_residency_status: prop.current_residency_status || 'Vacant',
    })
    setValuationDateOrigin(initialValuationDateOrigin(prop))
    setRentalAvailableFromOrigin(prop.rental_start_date_origin || (prop.rental_start_date ? 'backend_existing' : 'auto_purchase_date'))
    const loadedLoans = (prop.loans || []).map((loan) => ({
      ...blankLoan(),
      ...loan,
      account_number: String(loan.account_number || '').trim(),
      original_amount: numberOrEmpty(loan.original_amount),
      current_balance: numberOrEmpty(loan.current_balance),
      closed_date: normalizeDateInput(loan.closed_date),
      closure_reason: loan.closure_reason || '',
      replacement_loan_id: loan.replacement_loan_id || '',
      loan_group_id: loan.loan_group_id || '',
      servicer_sequence: numberOrEmpty(loan.servicer_sequence),
      servicer_start_date: normalizeDateInput(loan.servicer_start_date),
      servicer_end_date: normalizeDateInput(loan.servicer_end_date),
      transfer_reason: loan.transfer_reason || '',
      is_current_servicer: loan.is_current_servicer !== false,
      interest_rate: numberOrEmpty(loan.interest_rate),
      monthly_payment: numberOrEmpty(loan.monthly_payment),
      estimated_total_monthly_payment: numberOrEmpty(loan.estimated_total_monthly_payment),
      extra_monthly_payment: numberOrEmpty(loan.extra_monthly_payment),
	      loan_term_years: numberOrEmpty(loan.loan_term_years || 30),
	      origination_date: normalizeDateInput(loan.origination_date),
		      escrow_amount: numberOrEmpty(loan.escrow_amount),
	      escrow_included: Boolean(loan.escrow_included),
	      monthly_property_tax_escrow: numberOrEmpty(loan.monthly_property_tax_escrow),
	      monthly_insurance_escrow: numberOrEmpty(loan.monthly_insurance_escrow),
	      monthly_mortgage_insurance: numberOrEmpty(loan.monthly_mortgage_insurance),
	      monthly_other_escrow: numberOrEmpty(loan.monthly_other_escrow),
	      statement_date: normalizeDateInput(loan.statement_date),
		      source_document_id: loan.source_document_id || null,
	      sourceDocumentId: loan.source_document_id || loan.sourceDocumentId || null,
	      source_type: loan.source_type || '',
	      import_status: loan.import_status || '',
	      importStatusLabel: loan.import_status === 'reviewed' ? 'Imported · Review imported values' : loan.importStatusLabel || loan.status || 'OPEN',
	      current_balance_source: loan.current_balance_source || '',
	      current_balance_as_of: normalizeDateInput(loan.current_balance_as_of),
	      current_balance_verified: loan.current_balance_verified !== false,
	      current_balance_source_label: loan.current_balance_source === 'closing_document_initial_balance' ? 'Initial balance from closing document' : loan.current_balance_source === 'mortgage_statement_reported_balance' ? 'Reported from mortgage statement' : loan.current_balance_source_label || '',
	      current_balance_verification_status: loan.current_balance_verified === false ? 'Needs latest mortgage statement' : loan.current_balance_source === 'mortgage_statement_reported_balance' ? 'Reported' : loan.current_balance_verification_status || '',
    }))
    setLoans(loadedLoans)
    setLoanGroups(prop.loan_groups || [])
    setLoanEditorIndex(null)
    setFlags({
      hasFinancing: loadedLoans.length > 0,
      hasHoa: Boolean(prop.hoa_flag || toNumber(prop.hoa_fee) || toNumber(prop.hoa_special_assessment) || prop.hoa_history !== '[]'),
      hasSolar: Boolean((prop.solar_ownership || 'None') !== 'None' || toNumber(prop.solar_monthly_payment) || toNumber(prop.solar_purchase_price)),
    })
  }

  function previewDraft(sectionId) {
    if (sectionId === 'property') {
      return {
        purchase_price: toNumber(form.purchase_price),
        down_payment: toNumber(form.down_payment),
        market_value: toNumber(form.market_value),
        usage_type: form.usage_type,
        property_type: form.property_type,
      }
    }
    if (sectionId === 'rental') {
      return {
        monthly_rent: toNumber(form.monthly_rent),
        occupancy_rate: toNumber(form.occupancy_rate) || 100,
        usage_type: form.usage_type,
      }
    }
    if (sectionId === 'expenses') {
      const row = selectedExpenseRow
      return {
        ...annualExpensePayload(row, expenseYear),
        hoa: flags.hasHoa ? toNumber(row.hoa) : 0,
        solar_ownership: flags.hasSolar ? form.solar_ownership : 'None',
        solar_monthly_payment: flags.hasSolar ? toNumber(form.solar_monthly_payment) : 0,
      }
    }
    return {}
  }

  function setField(key, value, section = activeSection, options = {}) {
    let nextRentalOrigin = rentalAvailableFromOrigin
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'property_type') {
        const normalizedType = normalizeHomeType(value)
        next.property_type = normalizedType
        if (normalizedType !== 'other') next.property_type_raw = ''
      }
      if (key === 'usage_type' && !current.original_residency_status) {
        next.original_residency_status = originalResidencyFromUsage(value)
      }
      if (key === 'purchase_date') {
        const nextPurchaseDate = normalizeDateInput(value)
        const currentAutoDate = normalizeDateInput(current.purchase_date)
        const currentValuationDate = normalizeDateInput(current.market_value_updated)
        const currentRentalDate = normalizeDateInput(current.rental_start_date)
        next.purchase_date = nextPurchaseDate
        if (!currentValuationDate || (valuationDateOrigin === 'auto_purchase_date' && currentValuationDate === currentAutoDate)) {
          next.market_value_updated = nextPurchaseDate
        }
        if (isOriginalResidencyRental(current.original_residency_status)) {
          if (nextPurchaseDate && (!currentRentalDate || (rentalAvailableFromOrigin === 'auto_purchase_date' && currentRentalDate === currentAutoDate))) {
            next.rental_start_date = nextPurchaseDate
            next.rental_start_date_origin = 'auto_purchase_date'
            nextRentalOrigin = 'auto_purchase_date'
          } else if (!nextPurchaseDate && rentalAvailableFromOrigin === 'auto_purchase_date') {
            next.rental_start_date = ''
            next.rental_start_date_origin = ''
            nextRentalOrigin = 'auto_purchase_date'
          }
        }
      }
      if (key === 'original_residency_status') {
        const currentRentalDate = normalizeDateInput(current.rental_start_date)
        const purchaseDate = normalizeDateInput(current.purchase_date)
        if (isOriginalResidencyRental(value) && purchaseDate && (!currentRentalDate || rentalAvailableFromOrigin === 'auto_purchase_date')) {
          next.rental_start_date = purchaseDate
          next.rental_start_date_origin = 'auto_purchase_date'
          nextRentalOrigin = 'auto_purchase_date'
        } else if (!isOriginalResidencyRental(value) && rentalAvailableFromOrigin === 'auto_purchase_date') {
          next.rental_start_date = ''
          next.rental_start_date_origin = ''
          nextRentalOrigin = 'auto_purchase_date'
        }
      }
      if (key === 'rental_start_date') {
        next.rental_start_date = normalizeDateInput(value)
        next.rental_start_date_origin = options.fromSettlement ? 'document_import' : 'user_entered'
        nextRentalOrigin = next.rental_start_date_origin
      }
      if (key === 'market_value_updated') {
        next.market_value_updated = normalizeDateInput(value)
      }
      return next
    })
    if (key === 'market_value_updated') {
      setValuationDateOrigin(options.fromSettlement ? 'imported_document' : 'user_entered')
    }
    if (key === 'purchase_date') {
      const currentValuationDate = normalizeDateInput(form.market_value_updated)
      const currentAutoDate = normalizeDateInput(form.purchase_date)
      const willAutoFill = !currentValuationDate || (valuationDateOrigin === 'auto_purchase_date' && currentValuationDate === currentAutoDate)
      setValuationDateOrigin((current) => (willAutoFill ? 'auto_purchase_date' : current))
    }
    setRentalAvailableFromOrigin(nextRentalOrigin)
    setDirtySection(section)
    setFinalValidation(null)
    setErrors((current) => ({
      ...current,
      [key]: undefined,
      market_value_updated: key === 'purchase_date' ? undefined : current.market_value_updated,
      rental_start_date: ['purchase_date', 'original_residency_status', 'rental_start_date'].includes(key) ? undefined : current.rental_start_date,
    }))
    if (!options.fromSettlement) {
      setSettlementSources((current) => {
        if (!current[key]) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  function requiredPropertyErrors() {
    const requiredMissing = {}
    ;['name', 'property_type', 'original_residency_status', 'usage_type', 'purchase_price', 'purchase_date', 'market_value'].forEach((field) => {
      const value = form[field]
      if (String(value ?? '').trim() === '' || (['purchase_price', 'market_value'].includes(field) && toNumber(value) <= 0)) {
        requiredMissing[field] = 'Required field.'
      }
    })
    return requiredMissing
  }

  function validateSection(sectionId, { final = false } = {}) {
    const next = {}
    let requiredMissing = {}
    const prompts = {}
    if (sectionId === 'property') {
      requiredMissing = requiredPropertyErrors()
      const normalizedHomeType = normalizeHomeType(form.property_type)
      if (!HOME_TYPE_VALUES.has(normalizedHomeType)) next.property_type = 'Select an approved home type.'
      if (normalizedHomeType === 'other' && !String(form.property_type_raw || '').trim()) next.property_type_raw = 'Describe the home type.'
      if (toNumber(form.purchase_price) < 0) next.purchase_price = 'Purchase price cannot be negative.'
      if (toNumber(form.market_value) < 0) next.market_value = 'Current value cannot be negative.'
      if (form.purchase_date && Number.isNaN(Date.parse(form.purchase_date))) next.purchase_date = 'Enter a valid purchase date.'
      if (form.market_value_updated && Number.isNaN(Date.parse(form.market_value_updated))) next.market_value_updated = 'Enter a valid valuation date.'
      if (
        form.purchase_date
        && form.market_value_updated
        && !Number.isNaN(Date.parse(form.purchase_date))
        && !Number.isNaN(Date.parse(form.market_value_updated))
        && new Date(form.market_value_updated) < new Date(form.purchase_date)
      ) {
        next.market_value_updated = 'Valuation date cannot be earlier than purchase date.'
      }
      if (toNumber(form.market_value) > 0 && !form.market_value_updated) {
        prompts.market_value_updated = 'Add a valuation date when current value is provided.'
      }
    }
    if (sectionId === 'financing') {
      loans.forEach((loan, index) => {
        if (toNumber(loan.original_amount) < 0) next[`loan_${index}_original_amount`] = 'Original amount cannot be negative.'
        if (toNumber(loan.current_balance) > toNumber(loan.original_amount) && toNumber(loan.original_amount) > 0) next[`loan_${index}_current_balance`] = 'Balance cannot exceed original amount.'
        if (toNumber(loan.interest_rate) < 0 || toNumber(loan.interest_rate) > 100) next[`loan_${index}_interest_rate`] = 'Rate must be between 0 and 100.'
      })
    }
    if (sectionId === 'rental') {
      if (form.rental_start_date && Number.isNaN(Date.parse(form.rental_start_date))) next.rental_start_date = 'Enter a valid rental available from date.'
      if (
        form.purchase_date
        && form.rental_start_date
        && !Number.isNaN(Date.parse(form.purchase_date))
        && !Number.isNaN(Date.parse(form.rental_start_date))
        && new Date(form.rental_start_date) < new Date(form.purchase_date)
      ) {
        next.rental_start_date = 'Rental availability cannot begin before the property was purchased.'
      }
      if (rentalDraft.start_date && Number.isNaN(Date.parse(rentalDraft.start_date))) next.rental_start = 'Enter a valid start date.'
      if (rentalDraft.end_date && Number.isNaN(Date.parse(rentalDraft.end_date))) next.rental_end = 'Enter a valid end date.'
    }
    if (sectionId === 'expenses') {
      EXPENSE_FIELDS.forEach(({ key }) => {
        if (toNumber(selectedExpenseRow[key]) < 0) next[key] = 'Amount cannot be negative.'
      })
    }
    const displayErrors = { ...requiredMissing, ...prompts, ...next }
    setErrors(displayErrors)
    const hasBlockingErrors = Object.keys(next).length > 0
    const hasRequiredWarnings = Object.keys(requiredMissing).length > 0
    return {
      canSave: !hasBlockingErrors && (!final || !hasRequiredWarnings),
      hasBlockingErrors,
      hasRequiredWarnings,
    }
  }

  async function ensurePropertyRecord() {
    if (propertyId) return propertyId
    const response = await propAPI.create(propertyPayload(form))
    hydrateProperty(response.data)
    window.history.replaceState(null, '', `/properties/${response.data.id}/edit#${activeSection}`)
    return String(response.data.id)
  }

  async function refreshSetupStatus(targetId = propertyId) {
    if (!targetId) return
    const response = await propAPI.setupStatus(targetId)
    setSetupStatus(response.data)
  }

  async function refreshLoanTransferSuggestions(targetId = propertyId) {
    if (!targetId) return null
    try {
      const response = await propAPI.loanTransferSuggestions(targetId)
      const suggestions = response.data.suggestions || []
      setLoanTransferSuggestions(suggestions)
      setLoanTransferCloseDates((current) => {
        const next = {}
        suggestions.forEach((suggestion) => {
          next[suggestion.id] = current[suggestion.id] || suggestion.proposedClosedDate || ''
        })
        return next
      })
      setLoanGroups(response.data.loanGroups || [])
      return response.data
    } catch {
      setLoanTransferSuggestions([])
      setLoanTransferCloseDates({})
      return null
    }
  }

  async function refreshPropertyDraft(targetId = propertyId, options = {}) {
    if (!targetId) return null
    const [propertyResponse, statusResponse, expenseResponse, documentResponse] = await Promise.all([
      propAPI.get(targetId),
      propAPI.setupStatus(targetId),
      propAPI.annualExpenses(targetId).catch(() => ({ data: [] })),
      docAPI.list(targetId).catch(() => ({ data: [] })),
    ])
    hydrateProperty(propertyResponse.data)
    setSetupStatus(statusResponse.data)
    setExpenseRows((expenseResponse.data || []).map((row) => normalizeAnnualExpense(row)))
    const setupDocuments = settlementDocumentsFromDocuments(documentResponse.data || [])
    const settlement = setupDocuments[0] || null
    setSettlementDocuments(setupDocuments)
    setSettlementDocument(settlement)
    setSettlementSources(settlementSourcesFromDocument(settlement, propertyResponse.data))
    await refreshLoanTransferSuggestions(targetId)
    if (options.focusImportedLoanDocumentId) {
      const index = (propertyResponse.data.loans || []).findIndex((loan) => loan.source_document_id === options.focusImportedLoanDocumentId)
      if (index >= 0) setLoanEditorIndex(index)
    }
    return propertyResponse.data
  }

	  async function saveSection(sectionId = activeSection, options = {}) {
    const final = Boolean(options.final)
    if (final) {
      const requiredMissing = requiredPropertyErrors()
      if (Object.keys(requiredMissing).length) {
        setErrors((current) => ({ ...current, ...requiredMissing }))
        setSectionState((current) => ({ ...current, property: 'Validation warning' }))
        toast.error('Complete required fields before saving the property.')
        return null
      }
    }
    const validation = validateSection(sectionId, { final })
    if (!validation.canSave) {
      setSectionState((current) => ({ ...current, [sectionId]: 'Validation warning' }))
      if (final) toast.error('Complete required fields before saving the property.')
      return null
    }
    setSectionState((current) => ({ ...current, [sectionId]: 'Saving' }))
    try {
      let targetId = propertyId
      if (sectionId === 'property') {
        if (targetId) {
          const response = await propAPI.update(targetId, propertyPayload(form))
          hydrateProperty(response.data)
        } else {
          targetId = await ensurePropertyRecord()
        }
      } else {
        targetId = await ensurePropertyRecord()
        if (sectionId === 'financing') await saveFinancing(targetId)
        if (sectionId === 'rental') await saveRental(targetId)
        if (sectionId === 'expenses') await saveAnnualExpense(targetId)
      }
      await refreshSetupStatus(targetId)
      setDirtySection((current) => (current === sectionId ? null : current))
      setSectionState((current) => ({ ...current, [sectionId]: 'Saved' }))
      toast.success(`${SETUP_SECTIONS.find((section) => section.id === sectionId)?.title} saved`)
      return targetId
    } catch (err) {
      setSectionState((current) => ({ ...current, [sectionId]: 'Save failed' }))
      const detail = err.response?.data?.detail
      if (sectionId === 'rental' && detail && typeof detail === 'object') {
        const message = detail.message || 'Rental period could not be saved.'
        const fieldKey = detail.field === 'endDate'
          ? 'rental_end'
          : detail.field === 'monthlyRent'
            ? 'rental_monthly_rent'
            : 'rental_start'
        setErrors((current) => ({ ...current, [fieldKey]: message }))
      }
      toast.error(apiErrorMessage(err, 'Save failed'))
      return null
    }
	  }

  function finalizeErrorKey(key) {
    return String(key || '')
      .replace(/^property\./, '')
      .replace(/^rental_start_date$/, 'rental_start_date')
      .replace(/^loans\[(\d+)\]\./, 'loan_$1_')
      .replace(/^annual_expenses\[\d+\]\./, '')
  }

  function uiSectionId(section) {
    return section === 'loans' ? 'financing' : section
  }

  function backendSectionId(section) {
    return section === 'financing' ? 'loans' : section
  }

  function sectionErrorItems(payload, sectionId) {
    const sectionErrors = payload?.sectionErrors || {}
    const backendId = backendSectionId(sectionId)
    const items = sectionErrors[sectionId] || sectionErrors[backendId] || []
    return items.map((item) => (typeof item === 'string' ? { message: item, severity: 'error' } : item))
  }

  function allSectionErrorItems(payload) {
    const sectionOrder = ['property', 'financing', 'rental', 'expenses']
    return sectionOrder.flatMap((section) => sectionErrorItems(payload, section).map((item) => ({ section, item })))
  }

  function tabErrorCounts(payload) {
    if (!payload) return {}
    return ['property', 'financing', 'rental', 'expenses'].reduce((counts, section) => {
      const count = sectionErrorItems(payload, section).filter((item) => (item.severity || 'error') === 'error').length
      if (count) counts[section] = count
      return counts
    }, {})
  }

  function firstErrorFieldKey(payload, targetSection) {
    const fieldErrors = payload?.fieldErrors || {}
    const entries = Object.entries(fieldErrors)
    const fieldToSection = (key) => {
      if (key.startsWith('loans[')) return 'financing'
      if (key.startsWith('annual_expenses[')) return 'expenses'
      if (key.includes('rental_start_date') || key.includes('rental_end_date')) return 'rental'
      if (key.includes('property_tax') || key.includes('insurance')) return 'expenses'
      return 'property'
    }
    const match = entries.find(([key]) => fieldToSection(key) === targetSection)
    return match ? finalizeErrorKey(match[0]) : null
  }

  function focusFirstError(fieldKey) {
    if (!fieldKey) return
    window.setTimeout(() => {
      const wrapper = Array.from(document.querySelectorAll('[data-field-key]')).find((node) => node.getAttribute('data-field-key') === fieldKey)
      const focusTarget = wrapper?.querySelector('input, select, textarea, button')
      if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (focusTarget) focusTarget.focus({ preventScroll: true })
    }, 180)
  }

  function firstErrorSection(payload) {
    const fieldErrors = payload?.fieldErrors || {}
    const sectionOrder = ['property', 'financing', 'rental', 'expenses']
    const fieldToSection = (key) => {
      if (key.startsWith('loans[')) return 'financing'
      if (key.startsWith('annual_expenses[')) return 'expenses'
      if (key.includes('rental_start_date') || key.includes('rental_end_date')) return 'rental'
      if (key.includes('property_tax') || key.includes('insurance')) return 'expenses'
      return 'property'
    }
    return sectionOrder.find((section) => sectionErrorItems(payload, section).length)
      || sectionOrder.find((section) => Object.keys(fieldErrors).some((key) => fieldToSection(key) === section))
      || 'property'
  }

  async function savePropertyFinal() {
    setSectionState((current) => ({ ...current, [activeSection]: 'Saving' }))
    try {
      const targetId = propertyId || await ensurePropertyRecord()
      const response = await propAPI.finalizeSetup(targetId, {
        property: propertyPayload(form),
        loans: loans.map((loan) => ({ id: loan.id || null, ...loanPayload(loan) })),
        annual_expenses: currentExpenseRowsForSave().map((row) => annualExpensePayload(row, row.year)),
      })
      const payload = response.data
      if (payload.status === 'validation_failed') {
        const mappedErrors = Object.fromEntries(Object.entries(payload.fieldErrors || {}).map(([key, value]) => [finalizeErrorKey(key), value]))
        setErrors(mappedErrors)
        setFinalValidation(payload)
        const targetSection = firstErrorSection(payload)
        setSectionState((current) => ({ ...current, [activeSection]: 'Validation warning', [targetSection]: 'Validation warning' }))
        const errorCount = payload.summary?.errorCount || Object.keys(payload.fieldErrors || {}).length || allSectionErrorItems(payload).length
        toast.error(`${errorCount || 'Some'} items need attention before this property can be saved.`)
        navigateToSection(targetSection, false)
        focusFirstError(firstErrorFieldKey(payload, targetSection))
        return null
      }
      setFinalValidation(null)
      setErrors({})
      toast.success('Property saved.')
      navigate(payload.redirectTo || '/properties')
      return targetId
    } catch (err) {
      setSectionState((current) => ({ ...current, [activeSection]: 'Save failed' }))
      toast.error(apiErrorMessage(err, 'Save failed'))
      return null
    }
  }

	  async function saveFinancing(targetId) {
    const meaningfulLoans = loans.filter((loan) => loan.id || loan.lender_name || toNumber(loan.original_amount) || toNumber(loan.current_balance))
    for (const loan of meaningfulLoans) {
      const payload = loanPayload(loan)
      if (loan.id) await propAPI.updateLoan(targetId, loan.id, payload)
      else await propAPI.addLoan(targetId, payload)
    }
    const response = await propAPI.get(targetId)
    hydrateProperty(response.data)
  }

  async function saveRental(targetId) {
	    await propAPI.update(targetId, propertyPayload(form))
	    if (rentalDraft.start_date) {
	      const payload = {
	        status: 'occupied',
	        start_date: normalizeDateInput(rentalDraft.start_date),
        end_date: normalizeDateInput(rentalDraft.end_date) || null,
        monthly_rent: toNumber(rentalDraft.monthly_rent),
        notes: rentalDraft.notes || '',
      }
      const response = rentalDraft.period_ref
        ? await propAPI.updateRentalTimelinePeriod(targetId, { ...payload, period_ref: rentalDraft.period_ref })
        : await propAPI.createRentalTimelinePeriod(targetId, payload)
      setRentalTimeline(response.data)
      setRentalDraft(blankRentalPeriod())
    } else {
      const response = await propAPI.rentalTimeline(targetId)
      setRentalTimeline(response.data)
    }
  }

  function updateExpenseField(key, value) {
    setExpenseRows((current) => {
      const existing = current.find((row) => Number(row.year) === Number(expenseYear)) || blankAnnualExpense(expenseYear)
      const sourcePatch = key === 'property_tax'
        ? { property_tax_source: 'manual', property_tax_source_label: 'Manual' }
        : key === 'insurance'
          ? { insurance_source: 'manual', insurance_source_label: 'Manual' }
          : {}
      const nextRow = { ...existing, [key]: value, ...sourcePatch, year: Number(expenseYear), source_status: existing.source_status || 'manual' }
      const others = current.filter((row) => Number(row.year) !== Number(expenseYear))
      return [...others, nextRow].sort((left, right) => Number(left.year) - Number(right.year))
    })
    setDirtySection('expenses')
    setFinalValidation(null)
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function currentExpenseRowsForSave() {
    const row = expenseRows.find((item) => Number(item.year) === Number(expenseYear)) || blankAnnualExpense(expenseYear)
    const normalized = { ...row, year: Number(expenseYear) }
    const others = expenseRows.filter((item) => Number(item.year) !== Number(expenseYear))
    return [...others, normalized].sort((left, right) => Number(left.year) - Number(right.year))
  }

  async function saveAnnualExpense(targetId) {
    const payload = annualExpensePayload(selectedExpenseRow, expenseYear)
    const response = await propAPI.upsertAnnualExpense(targetId, expenseYear, payload)
    replaceExpenseRow(response.data)
  }

  function replaceExpenseRow(row) {
    setExpenseRows((current) => {
      const saved = normalizeAnnualExpense(row)
      const others = current.filter((item) => Number(item.year) !== Number(saved.year))
      return [...others, saved].sort((left, right) => Number(left.year) - Number(right.year))
    })
  }

  function openExpenseDocumentUpload(field) {
    setExpenseUploadTarget(field)
    expenseDocumentInputRef.current?.click()
  }

  async function handleExpenseDocumentUpload(file) {
    if (!file || !expenseUploadTarget || !propertyId) return
    const formData = new FormData()
    formData.append('property_id', propertyId)
    formData.append('year', String(expenseYear))
    formData.append('field', expenseUploadTarget)
    formData.append('file', file)
    setExpenseUploading(true)
    try {
      const response = await docAPI.uploadExpenseField(formData)
      if (response.data?.status === 'address_review_required') {
        setExpenseAddressReview({ ...response.data, field: expenseUploadTarget, year: expenseYear })
        toast.error(response.data?.message || 'Address confirmation required')
        return
      }
      replaceExpenseRow(response.data.annualExpense)
      const fieldLabel = expenseUploadTarget === 'property_tax' ? 'property tax' : 'insurance'
      toast.success(`Reported ${fieldLabel} imported from document.`)
      setDirtySection(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Expense document upload failed'))
    } finally {
      setExpenseUploading(false)
      setExpenseUploadTarget(null)
      if (expenseDocumentInputRef.current) expenseDocumentInputRef.current.value = ''
    }
  }

  async function acceptExpenseAddressReview() {
    if (!expenseAddressReview?.document?.id || !propertyId) return
    try {
      const response = await docAPI.applyExpenseFieldDocument(expenseAddressReview.document.id, {
        property_id: propertyId,
        year: expenseAddressReview.year || expenseYear,
        field: expenseAddressReview.field,
        address_override: true,
      })
      replaceExpenseRow(response.data.annualExpense)
      setExpenseAddressReview(null)
      toast.success('Address confirmed and document applied.')
      setDirtySection(null)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not apply document'))
    }
  }

  async function removeExpenseAddressReview() {
    if (!expenseAddressReview?.document?.id) {
      setExpenseAddressReview(null)
      return
    }
    try {
      await docAPI.delete(expenseAddressReview.document.id)
      setExpenseAddressReview(null)
      toast.success('Document removed.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not remove document'))
    }
  }

  async function removeExpenseDocument(field) {
    if (!propertyId) return
    try {
      const response = await docAPI.removeExpenseFieldDocument({
        property_id: propertyId,
        year: expenseYear,
        field,
      })
      replaceExpenseRow(response.data.annualExpense)
      toast.success('Document link removed.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not remove document link'))
    }
  }

  function copyPriorExpenseYear() {
    const previousYear = Number(expenseYear) - 1
    const previous = expenseRows.find((row) => Number(row.year) === previousYear)
    if (!previous) {
      toast.error(`No ${previousYear} expenses to copy.`)
      return
    }
    setExpenseRows((current) => {
      const copied = {
        ...blankAnnualExpense(expenseYear),
        ...EXPENSE_FIELDS.reduce((values, field) => ({ ...values, [field.key]: previous[field.key] || '' }), {}),
        year: Number(expenseYear),
        source_status: 'manual',
      }
      const others = current.filter((row) => Number(row.year) !== Number(expenseYear))
      return [...others, copied].sort((left, right) => Number(left.year) - Number(right.year))
    })
    setDirtySection('expenses')
    toast.success(`Copied ${previousYear} expenses.`)
  }

  function navigateToSection(sectionId, checkDirty = true) {
    if (!sectionId) return
    if (checkDirty && dirtySection && dirtySection !== sectionId) {
      setPendingSection(sectionId)
      return
    }
    const url = propertyId ? `/properties/${propertyId}/edit#${sectionId}` : `/properties/new#${sectionId}`
    navigate(url)
  }

  function requestCancel() {
    if (dirtySection === activeSection) {
      setPendingSection('__cancel__')
      return
    }
    navigate('/properties')
  }

  async function savePendingAndContinue() {
    const target = pendingSection
    if (!target || !dirtySection) return
    const saved = await saveSection(dirtySection)
    setPendingSection(null)
    if (!saved) return
    if (target === '__cancel__') navigate('/properties')
    else navigateToSection(target, false)
  }

	  function handleNextSection() {
	    validateSection(activeSection, { final: false })
	    if (activeSection === 'property' && blocksPropertyNext()) return
	    navigateToSection(nextSection?.id)
	  }

	  function blocksPropertyNext() {
	    if (!settlementDocument || !settlementAddressValidation) return false
	    const status = settlementAddressValidation.status
	    if (status === 'match') return false
	    if (status === 'possible_match' && settlementAddressConfirmed) return false
	    if (status === 'property_address_empty') {
	      toast.error('Apply the document address to this property before continuing.')
	      return true
	    }
	    if (status === 'mismatch') {
	      toast.error('Uploaded document appears to belong to a different property.')
	      return true
	    }
	    if (status === 'document_address_missing' || status === 'missing') {
	      toast.error('We could not find a property address in this document.')
	      return true
	    }
	    toast.error('Confirm this document belongs to this property before continuing.')
	    return true
	  }

  async function discardPendingAndContinue() {
    const target = pendingSection
    if (propertyId) {
      const response = await propAPI.get(propertyId)
      hydrateProperty(response.data)
      if (dirtySection === 'rental') setRentalDraft(blankRentalPeriod())
    }
    setDirtySection(null)
    setPendingSection(null)
    if (target === '__cancel__') navigate('/properties')
    else if (target) navigateToSection(target, false)
  }

  function toggleFlag(flag, enabled) {
    if (flag === 'hasFinancing' && !enabled && loans.length > 0) {
      toast.error('Loan records exist. Remove or close them before marking this property as debt-free.')
      return
    }
    if (flag === 'hasHoa' && !enabled && (toNumber(form.hoa_fee) || toNumber(form.hoa_special_assessment) || form.hoa_history !== '[]')) {
      toast.error('HOA data exists. It will be preserved; review it before disabling HOA fields.')
    }
    if (flag === 'hasSolar' && !enabled && ((form.solar_ownership || 'None') !== 'None' || toNumber(form.solar_monthly_payment) || toNumber(form.solar_purchase_price))) {
      toast.error('Solar data exists. It will be preserved; review it before disabling solar fields.')
    }
    setFlags((current) => ({ ...current, [flag]: enabled }))
    setDirtySection(activeSection)
  }

  function addLoan() {
    setFlags((current) => ({ ...current, hasFinancing: true }))
    setLoans((current) => {
      const next = [...current, blankLoan()]
      setLoanEditorIndex(next.length - 1)
      return next
    })
    setDirtySection('financing')
  }

  async function removeLoan(loan, index) {
    if (loan.id && propertyId) {
      await propAPI.deleteLoan(propertyId, loan.id)
      toast.success('Loan removed')
      await refreshSetupStatus(propertyId)
    }
	    setLoans((current) => current.filter((_, itemIndex) => itemIndex !== index))
	    setLoanEditorIndex(null)
	    setDirtySection('financing')
      if (propertyId) await refreshLoanTransferSuggestions(propertyId)
	  }

  async function applyLoanTransferSuggestion(suggestion) {
    if (!propertyId || !suggestion) return
    setLoanTransferApplying(suggestion.id)
    try {
      await propAPI.groupServicingTransfer(propertyId, {
        previous_loan_id: suggestion.previousLoanId,
        current_loan_id: suggestion.currentLoanId,
        closed_date: loanTransferCloseDates[suggestion.id] || suggestion.proposedClosedDate,
      })
      await refreshPropertyDraft(propertyId)
      toast.success('Loan servicing transfer grouped.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not group loans'))
    } finally {
      setLoanTransferApplying(null)
    }
  }

	  function updateLoan(index, key, value) {
	    setLoans((current) => current.map((loan, itemIndex) => (itemIndex === index ? { ...loan, [key]: value } : loan)))
	    setDirtySection('financing')
	    setFinalValidation(null)
	    setErrors((current) => ({ ...current, [`loan_${index}_${key}`]: undefined }))
	  }

  function loanHasEscrowValues(loan) {
    return ['escrow_amount', 'monthly_property_tax_escrow', 'monthly_insurance_escrow', 'monthly_mortgage_insurance', 'monthly_other_escrow', 'estimated_total_monthly_payment']
      .some((field) => toNumber(loan?.[field]) > 0)
  }

  function toggleLoanEscrow(index, checked) {
    const loan = loans[index]
    if (!checked && loanHasEscrowValues(loan)) {
      setEscrowDisableTarget(index)
      return
    }
    updateLoan(index, 'escrow_included', checked)
  }

  function disableEscrow(index, { clear = false } = {}) {
    setLoans((current) => current.map((loan, itemIndex) => {
      if (itemIndex !== index) return loan
      const next = { ...loan, escrow_included: false }
      if (clear) {
        next.escrow_amount = ''
        next.monthly_property_tax_escrow = ''
        next.monthly_insurance_escrow = ''
        next.monthly_mortgage_insurance = ''
        next.monthly_other_escrow = ''
        next.estimated_total_monthly_payment = ''
      }
      return next
    }))
    setEscrowDisableTarget(null)
    setDirtySection('financing')
  }

  function editRentalPeriod(period) {
    setRentalDraft({
      period_ref: rentalPeriodRef(period),
      status: rentalPeriodValue(period, 'status', 'status') || 'occupied',
      start_date: rentalPeriodValue(period, 'startDate', 'start_date'),
      end_date: rentalPeriodValue(period, 'endDate', 'end_date'),
      monthly_rent: numberOrEmpty(rentalPeriodValue(period, 'monthlyRent', 'monthly_rent')),
      notes: rentalPeriodValue(period, 'notes', 'notes'),
    })
    setDirtySection('rental')
  }

  async function deleteRentalPeriod(periodRef) {
    if (!propertyId) return
    const response = await propAPI.deleteRentalTimelinePeriod(propertyId, periodRef)
    setRentalTimeline(response.data)
    setRentalDeleteTarget(null)
    await refreshSetupStatus(propertyId)
  }

  function openSettlementUpload(role) {
    settlementUploadRoleRef.current = role
    settlementInputRef.current?.click()
  }

  async function handleSettlementUpload(file) {
    if (!file) return
    const setupImportRole = settlementUploadRoleRef.current || 'closing_document'
    setSettlementUploading(true)
    try {
      const targetId = propertyId || await ensurePropertyRecord()
      const formData = new FormData()
      formData.append('property_id', targetId)
      formData.append('category', 'closing_statement')
      formData.append('file', file)
      const previewResponse = await docAPI.previewUpload(formData)
      const preview = previewResponse.data
      if (preview.category !== 'closing_statement') {
        await docAPI.cancelUpload({
          pending_upload_id: preview.pending_upload_id,
          original_filename: preview.original_filename,
          property_id: targetId,
          category: preview.category,
        }).catch(() => {})
        toast.error('This document does not appear to be a closing or settlement statement.')
        return
      }
      const acceptResponse = await docAPI.acceptUpload({
        pending_upload_id: preview.pending_upload_id,
        original_filename: preview.original_filename,
        property_id: targetId,
        category: preview.category,
        apply_extracted: false,
        field_overrides: { setup_import_role: setupImportRole },
      })
      await loadSettlementReview(acceptResponse.data.id, { openReview: true })
      toast.success(`${setupImportRoleLabel({ extracted_data: { setup_import_role: setupImportRole } })} uploaded. Review extracted fields before applying.`)
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.id) {
        setSettlementDocument(detail)
        setSettlementDocuments((current) => current.some((doc) => doc.id === detail.id) ? current : [detail, ...current])
        toast.error('This document may already be uploaded. Review the existing document in Documents.')
      } else {
        toast.error(apiErrorMessage(err, 'Settlement upload failed'))
      }
    } finally {
      setSettlementUploading(false)
      settlementUploadRoleRef.current = 'closing_document'
      if (settlementInputRef.current) settlementInputRef.current.value = ''
    }
  }

  async function loadSettlementReview(documentId, { openReview = true } = {}) {
    const response = await docAPI.setupImportReview(documentId)
    const review = response.data
    const addressFieldResultByTarget = {
      address: review.addressValidation?.fieldResults?.street,
      city: review.addressValidation?.fieldResults?.city,
      state: review.addressValidation?.fieldResults?.state,
      zip_code: review.addressValidation?.fieldResults?.zip,
    }
      const document = review.document
      setSettlementDocument(document)
      setSettlementDocuments((current) => current.some((doc) => doc.id === document.id) ? current.map((doc) => doc.id === document.id ? { ...doc, ...document } : doc) : [document, ...current])
      setSettlementAddressValidation(review.addressValidation || null)
      setSettlementAddressConfirmed(review.addressValidation?.status === 'match')
      const hasPurchasePriceSelection = Boolean(review.purchasePriceSelection?.components?.length)
      const reviewFields = (review.propertyFields || [])
        .filter((field) => !(hasPurchasePriceSelection && field.targetKey === 'purchase_price'))
        .map((field) => ({
      sourceKey: field.sourceField,
      targetKey: field.targetKey,
      label: field.label,
      selected: ['address', 'city', 'state', 'zip_code'].includes(field.targetKey)
        ? addressFieldResultByTarget[field.targetKey] === 'missing_can_import'
        : true,
      value: String(field.value ?? ''),
      display: field.display,
      currentValue: form[field.targetKey],
      currentDisplay: ['purchase_date', 'market_value_updated'].includes(field.targetKey)
        ? (form[field.targetKey] ? formatDate(form[field.targetKey]) : '')
        : ['purchase_price', 'market_value', 'down_payment', 'closing_costs'].includes(field.targetKey)
          ? (toNumber(form[field.targetKey]) ? formatCurrency(toNumber(form[field.targetKey])) : '')
          : (form[field.targetKey] || ''),
      sourceLabel: field.sourceLabel || field.label,
      confidence: field.confidence,
    }))
    const purchasePriceSelection = hasPurchasePriceSelection ? {
      ...review.purchasePriceSelection,
      components: review.purchasePriceSelection.components.map((component) => ({
        ...component,
        selected: component.selected !== false,
      })),
    } : null
    const loanDraft = (review.loanDrafts || [])[0]
    const loanSuggestion = loanDraft ? {
      lender_name: loanDraft.lender_name || '',
      account_number: loanDraft.account_number || loanDraft.loan_id || '',
      loan_type: loanDraft.loan_type || 'FIXED',
      loan_product: loanDraft.loan_product || '',
      status: loanDraft.status || 'OPEN',
      original_amount: numberOrEmpty(loanDraft.original_amount),
      current_balance: numberOrEmpty(loanDraft.current_balance),
      current_balance_source_label: loanDraft.current_balance_source_label,
      current_balance_verification_status: loanDraft.current_balance_verification_status,
      interest_rate: numberOrEmpty(loanDraft.interest_rate),
      monthly_payment: numberOrEmpty(loanDraft.monthly_payment),
      escrow_amount: numberOrEmpty(loanDraft.escrow_amount),
      estimated_total_monthly_payment: numberOrEmpty(loanDraft.estimated_total_monthly_payment),
      loan_term_years: numberOrEmpty(loanDraft.loan_term_years || 30),
      origination_date: normalizeDateInput(loanDraft.origination_date),
	      escrow_included: Boolean(loanDraft.escrow_included),
	      source_document_id: loanDraft.sourceDocumentId,
	      sourceDocumentId: loanDraft.sourceDocumentId,
	      source_type: loanDraft.sourceDocumentType,
	      import_status: loanDraft.importStatus,
	      importStatus: loanDraft.importStatus,
	      importStatusLabel: loanDraft.importStatusLabel,
	      current_balance_source: 'closing_document_initial_balance',
	      current_balance_as_of: normalizeDateInput(loanDraft.origination_date),
	      current_balance_verified: false,
	    } : null
    if (loanSuggestion) {
      setFlags((current) => ({ ...current, hasFinancing: true }))
      if (!loans.some((loan) => loan.id || loan.sourceDocumentId === loanSuggestion.sourceDocumentId || loan.lender_name || toNumber(loan.original_amount))) {
        setLoans([{ ...blankLoan(), ...loanSuggestion }])
        setLoanEditorIndex(0)
      }
    }
    if (openReview) {
      setSettlementReview({
        document,
        fields: reviewFields,
        purchasePriceSelection,
        settlementCalculations: review.settlementCalculations || [],
	        loanSuggestion,
	        loanFields: review.loanFields || [],
	        addressValidation: review.addressValidation || null,
	        addressConfirmed: review.addressValidation?.status === 'match',
	        warnings: review.warnings || [],
	      })
	    }
	    return review
	  }

  function updateSettlementReviewField(targetKey, selected) {
    setSettlementReview((current) => current ? {
      ...current,
      fields: current.fields.map((field) => field.targetKey === targetKey ? { ...field, selected } : field),
    } : current)
  }

  function updatePurchasePriceComponent(componentId, selected) {
    setSettlementReview((current) => current?.purchasePriceSelection ? {
      ...current,
      purchasePriceSelection: {
        ...current.purchasePriceSelection,
        components: current.purchasePriceSelection.components.map((component) => (
          component.id === componentId ? { ...component, selected } : component
        )),
      },
    } : current)
  }

  async function applySettlementReview() {
	    if (!settlementReview) return
	    const selectedFields = settlementReview.fields.filter((field) => field.selected)
      const selectedPurchaseComponents = selectedPurchasePriceComponentIds(settlementReview.purchasePriceSelection)
      const selectedPropertyFieldKeys = selectedFields.map((field) => field.targetKey)
      if (settlementReview.purchasePriceSelection && selectedPurchaseComponents.length) selectedPropertyFieldKeys.push('purchase_price')
	    try {
	      const targetId = propertyId || await ensurePropertyRecord()
	      const response = await docAPI.applySetupImport(settlementReview.document.id, {
	        property_id: Number(targetId),
	        selected_property_fields: selectedPropertyFieldKeys,
          selected_purchase_price_components: settlementReview.purchasePriceSelection ? selectedPurchaseComponents : undefined,
	        selected_loan_fields: [],
	        confirm_address_match: settlementAddressConfirmed,
	      })
	      const nextAddressValidation = response.data.addressValidation || settlementReview.addressValidation || null
	      setSettlementAddressValidation(nextAddressValidation)
	      setSettlementAddressConfirmed(nextAddressValidation?.status === 'match')
	      await refreshPropertyDraft(targetId, { focusImportedLoanDocumentId: settlementReview.document.id })
	      if (selectedFields.some((field) => ['market_value', 'market_value_updated'].includes(field.targetKey))) setValuationDateOrigin('imported_document')
	      else if (selectedFields.some((field) => field.targetKey === 'purchase_date')) setValuationDateOrigin('auto_purchase_date')
	      setErrors((current) => {
	        const next = { ...current }
	        selectedFields.forEach((field) => { delete next[field.targetKey] })
	        return next
	      })
	      setDirtySection(null)
	      setSettlementReview(null)
	      toast.success(settlementReview.loanSuggestion ? 'Imported property and loan details applied.' : 'Imported property details applied.')
	    } catch (err) {
	      const detail = err.response?.data?.detail
	      if (detail?.addressValidation) {
	        setSettlementAddressValidation(detail.addressValidation)
	        setSettlementReview((current) => current ? { ...current, addressValidation: detail.addressValidation } : current)
	      }
	      toast.error(detail?.message || (typeof detail === 'string' ? detail : 'Could not apply imported values'))
	    }
	  }

  async function acceptLoanDocumentUpload(file, targetId) {
    const formData = new FormData()
    formData.append('property_id', targetId)
    formData.append('category', 'auto')
    formData.append('file', file)
    const previewResponse = await docAPI.previewUpload(formData)
    const preview = previewResponse.data
    if (!['mortgage_statement', '1098'].includes(preview.category)) {
      await docAPI.cancelUpload({
        pending_upload_id: preview.pending_upload_id,
        original_filename: preview.original_filename,
        property_id: targetId,
        category: preview.category,
      }).catch(() => {})
      throw new Error(`${preview.original_filename || file.name} is not a mortgage statement or 1098.`)
    }
    try {
      const acceptResponse = await docAPI.acceptUpload({
        pending_upload_id: preview.pending_upload_id,
        original_filename: preview.original_filename,
        property_id: targetId,
        category: preview.category,
        apply_extracted: false,
      })
      return { documentId: acceptResponse.data.id, preview, reusedExisting: false }
    } catch (err) {
      const duplicate = duplicateDocumentFromError(err)
      if (!duplicate) throw err
      await docAPI.cancelUpload({
        pending_upload_id: preview.pending_upload_id,
        original_filename: preview.original_filename,
        property_id: targetId,
        category: preview.category,
      }).catch(() => {})
      return { documentId: duplicate.id, preview, duplicate, reusedExisting: true }
    }
  }

  async function handleLoanStatementUpload(filesInput) {
    const files = Array.from(filesInput || []).filter(Boolean)
    if (!files.length) return
    setLoanStatementUploading(true)
    setLoanStatementConflict(null)
    setLoanConsolidatedReview(null)
    let targetId = propertyId
    let preview = null
    try {
      targetId = targetId || await ensurePropertyRecord()
      const accepted = []
      for (const file of files) {
        const result = await acceptLoanDocumentUpload(file, targetId)
        preview = result.preview
        accepted.push(result)
      }
      const reusedCount = accepted.filter((item) => item.reusedExisting).length
      if (accepted.length === 1) {
        await loadLoanStatementReview(accepted[0].documentId, { openReview: true })
        toast.success(reusedCount
          ? 'Existing loan document loaded. Review extracted fields before applying.'
          : `${accepted[0].preview.category === '1098' ? '1098' : 'Mortgage statement'} uploaded. Review extracted fields before applying.`)
        return
      }
      const documentIds = [...new Set(accepted.map((item) => item.documentId))]
      const reviewResponse = await docAPI.consolidatedLoanReview({
        property_id: Number(targetId),
        document_ids: documentIds,
      })
      setLoanStatementReview(null)
      setLoanConsolidatedReview(reviewResponse.data)
      toast.success(reusedCount
        ? `${documentIds.length} loan documents analyzed, including ${reusedCount} already uploaded. Review the consolidated loan table before applying.`
        : `${documentIds.length} loan documents uploaded. Review the consolidated loan table before applying.`)
    } catch (err) {
      const duplicate = duplicateDocumentFromError(err)
      if (duplicate) {
        setLoanStatementConflict({
          ...duplicate,
          pendingUpload: preview ? {
            pending_upload_id: preview.pending_upload_id,
            original_filename: preview.original_filename,
            property_id: targetId,
            category: preview.category,
          } : null,
        })
      } else {
        toast.error(err.message || apiErrorMessage(err, 'Loan document upload failed'))
      }
    } finally {
      setLoanStatementUploading(false)
      if (loanStatementInputRef.current) loanStatementInputRef.current.value = ''
    }
  }

  async function loadLoanStatementReview(documentId, { openReview = true } = {}) {
    const response = await docAPI.loanStatementReview(documentId)
    const review = response.data
    const fields = (review.loanFields || []).map((field) => {
      const currentLoan = loanEditorIndex != null ? loans[loanEditorIndex] : null
      return {
        sourceKey: field.sourceField,
        targetKey: field.targetKey,
        label: field.label,
        selected: true,
        value: String(field.value ?? ''),
        display: field.display,
        currentValue: currentLoan?.[field.targetKey],
        currentDisplay: ['current_balance', 'monthly_property_tax_escrow', 'monthly_insurance_escrow', 'monthly_mortgage_insurance', 'monthly_other_escrow', 'escrow_amount', 'estimated_total_monthly_payment'].includes(field.targetKey)
          ? (toNumber(currentLoan?.[field.targetKey]) ? formatCurrency(toNumber(currentLoan?.[field.targetKey])) : '')
          : ['statement_date', 'origination_date', 'servicer_start_date'].includes(field.targetKey)
            ? (currentLoan?.[field.targetKey] ? formatDate(currentLoan[field.targetKey]) : '')
            : (currentLoan?.[field.targetKey] || ''),
        sourceLabel: field.sourceLabel || field.label,
        confidence: field.confidence,
      }
    })
    if (openReview) {
      setLoanStatementConflict(null)
      setLoanStatementReview({
        document: review.document,
        fields,
        statementDraft: review.statementDraft || {},
        loanMapping: review.loanMapping || null,
        accountMismatchConfirmed: false,
        warnings: review.warnings || [],
      })
    }
    return review
  }

  async function replaceDuplicateLoanStatement() {
    if (!loanStatementConflict?.pendingUpload) return
    setLoanStatementUploading(true)
    try {
      const acceptResponse = await docAPI.acceptUpload({
        ...loanStatementConflict.pendingUpload,
        apply_extracted: false,
        replace_document_id: loanStatementConflict.id,
      })
      await loadLoanStatementReview(acceptResponse.data.id, { openReview: true })
      setLoanStatementConflict(null)
      toast.success('Existing loan document replaced. Review extracted fields before applying.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not replace existing loan document'))
    } finally {
      setLoanStatementUploading(false)
    }
  }

  function updateLoanStatementReviewField(targetKey, selected) {
    setLoanStatementReview((current) => current ? {
      ...current,
      fields: current.fields.map((field) => field.targetKey === targetKey ? { ...field, selected } : field),
    } : current)
  }

  async function applyLoanStatementReview() {
    if (!loanStatementReview) return
    try {
      const targetId = propertyId || await ensurePropertyRecord()
      const response = await docAPI.applyLoanStatement(loanStatementReview.document.id, {
        property_id: Number(targetId),
        loan_id: loanEditorIndex != null ? loans[loanEditorIndex]?.id || null : null,
        selected_loan_fields: loanStatementReview.fields.filter((field) => field.selected).map((field) => field.targetKey),
        address_override: true,
        confirm_account_mismatch: Boolean(loanStatementReview.accountMismatchConfirmed),
      })
      await refreshPropertyDraft(targetId, { focusImportedLoanDocumentId: loanStatementReview.document.id })
      const appliedLoanIndex = (response.data.draft?.loans || []).findIndex((loan) => loan.id === response.data.loanId)
      if (appliedLoanIndex >= 0) setLoanEditorIndex(appliedLoanIndex)
      setLoanStatementReview(null)
      setDirtySection(null)
      const estimates = response.data.expenseEstimates || {}
      const estimatedParts = [
        estimates.propertyTax?.applied ? `property tax ${estimates.propertyTax.display}` : null,
        estimates.insurance?.applied ? `insurance ${estimates.insurance.display}` : null,
      ].filter(Boolean)
      if (estimatedParts.length) {
        toast.success(`Estimated ${estimates.year} ${estimatedParts.join(' and ')} from escrow — upload your tax bill to confirm.`)
      } else if (response.data.servicingTransfer) {
        toast.success('Loan document applied. Review the old-loan close date prompt before grouping.')
      } else {
        toast.success(`${loanStatementReview.document?.type === '1098' ? '1098' : 'Mortgage statement'} values applied.`)
      }
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail?.code === 'LOAN_ACCOUNT_MISMATCH_CONFIRMATION_REQUIRED') {
        setLoanStatementReview((current) => current ? { ...current, loanMapping: detail.loanMapping || current.loanMapping } : current)
      }
      toast.error(apiErrorMessage(err, 'Could not apply loan document'))
    }
  }

  const activePresentation = sectionPresentation(activeSection)
  const progressPercent = setupProgress.percent
  const propertyHeaderName = form.name || 'New property'
  const isFinalSection = activeVisibleSections.findIndex((section) => section.id === activeSection) === activeVisibleSections.length - 1
  const activeDirty = dirtySection === activeSection
  const unsavedSectionTitle = SETUP_SECTIONS.find((section) => section.id === dirtySection)?.title || activePresentation.title

  useEffect(() => {
    if (!pendingSection) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPendingSection(null)
      }
    }
    window.setTimeout(() => unsavedPrimaryActionRef.current?.focus(), 0)
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pendingSection])

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950 dark:bg-gray-950 dark:text-white">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur dark:bg-gray-950/95">
        <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <button type="button" onClick={() => navigate('/properties')} className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-500 transition-colors duration-150 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200">
                <ChevronLeft className="h-4 w-4" /> Properties
              </button>
              <div className="flex flex-wrap items-end gap-3">
                <h1 className="truncate text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">Property Setup</h1>
                <span className="pb-1 text-sm text-gray-500 dark:text-gray-400">{propertyHeaderName}</span>
                <span className="pb-1 text-sm font-medium text-blue-700 dark:text-blue-300">Setup {progressPercent}% complete · {setupProgress.complete} of {setupProgress.total} sections complete</span>
                <span className="pb-0.5"><SaveStatusChip state={sectionState[activeSection]} dirty={activeDirty} /></span>
              </div>
            </div>
          </div>
        </header>
      </div>

      {loading ? (
        <div className="mx-auto mt-8 max-w-7xl px-5 text-sm text-gray-500 dark:text-gray-400 sm:px-8">Loading property setup...</div>
      ) : (
        <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <PropertySetupSection
            tabs={(
              <PropertySetupTabs
                sections={visibleSections}
                activeSection={activeSection}
                statusById={statusById}
                loansCount={loans.length}
                errorCountsBySection={setupErrorCounts}
                onSelect={navigateToSection}
              />
            )}
            activePresentation={activePresentation}
            status={statusById.get(activeSection)?.status}
            saveState={sectionState[activeSection]}
            dirty={activeDirty}
            records={renderSectionRecords(activeSection)}
            editor={renderSectionEditor(activeSection)}
            headingRef={activeHeadingRef}
            footer={(
              <PropertySetupFooter
                isFinalSection={isFinalSection}
                nextSection={nextSection}
                saving={sectionState[activeSection] === 'Saving'}
                onCancel={requestCancel}
                onSaveDraft={() => saveSection(activeSection)}
	                onSaveProperty={savePropertyFinal}
                onNext={handleNextSection}
              />
            )}
          />
        </main>
      )}

      {pendingSection ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/45 px-4 py-5 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="unsaved-setup-title" aria-describedby="unsaved-setup-description">
          <div className="w-full max-w-[540px] rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <div className="p-7 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <h2 id="unsaved-setup-title" className="text-xl font-semibold text-gray-950 dark:text-white">Unsaved changes</h2>
              </div>
              <div id="unsaved-setup-description" className="mt-4 space-y-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
                <p>
                  You have unsaved changes in the <span className="font-medium text-gray-950 dark:text-white">{unsavedSectionTitle}</span> section.
                </p>
                <p>Save them before leaving this section?</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-gray-100 px-7 py-5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <button type="button" className="order-3 inline-flex w-fit items-center rounded-lg px-0 py-2 text-sm font-medium text-red-600 transition-colors duration-150 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/30 dark:text-red-400 dark:hover:text-red-300 sm:order-1" onClick={discardPendingAndContinue}>
                Discard changes
              </button>
              <div className="order-1 flex flex-col gap-2 sm:order-2 sm:flex-row sm:justify-end sm:gap-3">
                <button type="button" className="btn-secondary justify-center" onClick={() => setPendingSection(null)}>
                  Stay here
                </button>
                <button ref={unsavedPrimaryActionRef} type="button" className="btn-primary justify-center" onClick={savePendingAndContinue}>
                  Save &amp; continue
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

	      {rentalDeleteTarget ? (
	        <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="delete-rental-period-title">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <h2 id="delete-rental-period-title" className="text-lg font-semibold text-gray-900 dark:text-white">Delete occupancy period?</h2>
	            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">This removes the selected occupied period. Backend vacancy will be recalculated from the remaining gaps.</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setRentalDeleteTarget(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={() => deleteRentalPeriod(rentalPeriodRef(rentalDeleteTarget))}>Delete Period</button>
            </div>
          </div>
	        </div>
	      ) : null}

      {escrowDisableTarget !== null ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="disable-escrow-title">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <h2 id="disable-escrow-title" className="text-lg font-semibold text-gray-900 dark:text-white">Disable escrow?</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">The current escrow details will be hidden but preserved unless you clear them.</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setEscrowDisableTarget(null)}>Keep Escrow</button>
              <button type="button" className="btn-secondary" onClick={() => disableEscrow(escrowDisableTarget, { clear: false })}>Disable and Preserve</button>
              <button type="button" className="btn-primary" onClick={() => disableEscrow(escrowDisableTarget, { clear: true })}>Disable and Clear</button>
            </div>
          </div>
        </div>
      ) : null}
	    </div>
	  )

  function validationSummary() {
    return Object.keys(errors).length ? (
      <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" role="alert">
        Review the highlighted fields before saving.
      </div>
    ) : null
  }

  function finalValidationSummary() {
    if (!finalValidation) return null
    const items = allSectionErrorItems(finalValidation)
    if (!items.length) return null
    const count = finalValidation.summary?.errorCount || items.length
    const grouped = items.reduce((acc, { section, item }) => {
      const title = SETUP_SECTIONS.find((candidate) => candidate.id === section)?.title || section
      acc[title] = acc[title] || []
      acc[title].push(item.message || 'Review this item.')
      return acc
    }, {})
    return (
      <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200" role="alert">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-semibold">{count} items need attention before this property can be saved.</p>
            <div className="mt-2 space-y-2">
              {Object.entries(grouped).map(([section, messages]) => (
                <div key={section}>
                  <p className="font-medium">{section}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {messages.map((message, index) => <li key={`${section}-${index}`}>{message}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="btn-secondary shrink-0 text-sm" onClick={() => {
            const targetSection = firstErrorSection(finalValidation)
            navigateToSection(targetSection, false)
            focusFirstError(firstErrorFieldKey(finalValidation, targetSection))
          }}>
            Go to first error
          </button>
        </div>
      </div>
    )
  }

  function renderSectionRecords(sectionId) {
    if (sectionId === 'financing') return renderFinancingRecords()
    if (sectionId === 'expenses') return renderExpenseHistoryRecords()
    return null
  }

  function renderSectionEditor(sectionId) {
    const body = (() => {
      if (sectionId === 'property') return renderPropertySection()
      if (sectionId === 'financing') return renderFinancingEditor()
      if (sectionId === 'rental') return renderRentalEditor()
      if (sectionId === 'expenses') return <PropertySetupEditor title={`Edit ${expenseYear} Expenses`} description="Edit the selected annual expense row. Current-year expenses complete setup; prior years remain optional.">{renderExpensesSection()}</PropertySetupEditor>
      return null
    })()
    return (
      <>
        {finalValidationSummary()}
        {validationSummary()}
        {body}
      </>
    )
  }

  function renderPropertySection() {
    return (
      <div className="space-y-4">
        <SetupSubsection title="Basics">
          <div className="grid gap-4 md:grid-cols-3">
            <TextInput fieldKey="name" label="Property name" value={form.name} onChange={(value) => setField('name', value, 'property')} error={errors.name} helper="Use the name you recognize across dashboards." required={REQUIRED_FIELDS.has('name')} source={settlementSources.name} />
            <SelectInput
              label="Home Type"
              value={normalizeHomeType(form.property_type)}
              onChange={(value) => setField('property_type', value, 'property')}
              error={errors.property_type}
              fieldKey="property_type"
              helper="The physical type of property."
              required={REQUIRED_FIELDS.has('property_type')}
            >
              {HOME_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </SelectInput>
            <SelectInput
              label="Original Residency Status"
              value={form.original_residency_status || ''}
              onChange={(value) => setField('original_residency_status', value, 'property')}
              error={errors.original_residency_status}
              fieldKey="original_residency_status"
              helper="How the property was originally acquired or first used."
              required={REQUIRED_FIELDS.has('original_residency_status')}
            >
              <option value="">Select status</option>
              {RESIDENCY_OPTIONS.map((option) => <option key={option.originalValue} value={option.originalValue}>{option.label}</option>)}
            </SelectInput>
            <SelectInput
              label="Current Residency Status"
              value={form.usage_type}
              onChange={(value) => setField('usage_type', value, 'property')}
              error={errors.usage_type}
              fieldKey="usage_type"
              helper="How the property is being used today."
              required={REQUIRED_FIELDS.has('usage_type')}
            >
              {RESIDENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </SelectInput>
            <TextInput label="Street" value={form.address} onChange={(value) => setField('address', value, 'property')} />
            {normalizeHomeType(form.property_type) === 'other' ? (
              <TextInput label="Other Home Type" value={form.property_type_raw} onChange={(value) => setField('property_type_raw', value, 'property')} error={errors.property_type_raw} />
            ) : null}
            <TextInput label="City" value={form.city} onChange={(value) => setField('city', value, 'property')} />
            <TextInput label="State" value={form.state} onChange={(value) => setField('state', value, 'property')} />
            <TextInput label="ZIP code" value={form.zip_code} onChange={(value) => setField('zip_code', value, 'property')} />
          </div>
        </SetupSubsection>

        <SetupSubsection title="Purchase">
          {renderSettlementUploadPanel()}
          <div className="mb-4 flex items-center gap-3 text-xs font-medium text-gray-400 dark:text-gray-500">
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
            <span>or enter manually</span>
            <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <TextInput fieldKey="purchase_date" label="Purchase date" type="date" value={form.purchase_date} onChange={(value) => setField('purchase_date', value, 'property')} error={errors.purchase_date} required={REQUIRED_FIELDS.has('purchase_date')} source={settlementSources.purchase_date} />
            <MoneyInput fieldKey="purchase_price" label="Purchase price" value={form.purchase_price} onChange={(value) => setField('purchase_price', value, 'property')} error={errors.purchase_price} helper="Original contract price, excluding later improvements." emphasis required={REQUIRED_FIELDS.has('purchase_price')} source={settlementSources.purchase_price} />
            <MoneyInput label="Down payment" value={form.down_payment} onChange={(value) => setField('down_payment', value, 'property')} error={errors.down_payment} helper="Cash contribution at purchase." source={settlementSources.down_payment} />
            <MoneyInput label="Closing costs" value={form.closing_costs} onChange={(value) => setField('closing_costs', value, 'property')} error={errors.closing_costs} source={settlementSources.closing_costs} />
          </div>
        </SetupSubsection>

        <SetupSubsection title="Valuation">
          <div className="grid gap-4 md:grid-cols-3">
            <MoneyInput fieldKey="market_value" label="Current value" value={form.market_value} onChange={(value) => setField('market_value', value, 'property')} error={errors.market_value} helper="Used for equity and LTV calculations." emphasis required={REQUIRED_FIELDS.has('market_value')} source={settlementSources.market_value} />
            <SelectInput label="Valuation source" value={form.market_value_source} onChange={(value) => setField('market_value_source', value, 'property')} helper="Manual, appraisal, or imported estimate.">
              <option value="manual">Manual</option>
              <option value="appraisal">Appraisal</option>
              <option value="imported">Imported estimate</option>
            </SelectInput>
            <TextInput label="Valuation date" type="date" value={form.market_value_updated} onChange={(value) => setField('market_value_updated', value, 'property')} error={errors.market_value_updated} helper="The date associated with the current market value. It initially defaults to the purchase date and can be updated." source={settlementSources.market_value_updated} />
          </div>
        </SetupSubsection>

        <SetupSubsection title="This property has">
          <div className="flex flex-wrap gap-2">
            {propertySetupFlagRows.map((row) => (
              <FeatureToggle key={row.id} row={row} checked={Boolean(flags[row.id])} onChange={(checked) => toggleFlag(row.id, checked)} />
            ))}
          </div>
        </SetupSubsection>
      </div>
    )
  }

  function renderSettlementUploadPanel() {
    const hasDocuments = settlementDocuments.length > 0
    const documentUrl = propertyId ? `/properties/${propertyId}/documents` : '/uploads'
    return (
      <div className={`mb-4 rounded-lg border p-3 ${hasDocuments ? 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950/40' : 'border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/20'}`}>
        <input
          ref={settlementInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv"
          className="sr-only"
          onChange={(event) => handleSettlementUpload(event.target.files?.[0])}
        />
        {hasDocuments ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Uploaded setup documents</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Review any document and choose exactly which fields it should populate.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={() => openSettlementUpload('closing_document')} disabled={settlementUploading}>
                  <Upload className="h-4 w-4" />
                  {settlementUploading ? 'Uploading...' : 'Upload Closing'}
                </button>
                <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={() => openSettlementUpload('settlement_document')} disabled={settlementUploading}>
                  <Upload className="h-4 w-4" />
                  {settlementUploading ? 'Uploading...' : 'Upload Settlement'}
                </button>
              </div>
            </div>
            <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-950/30">
              {settlementDocuments.map((document) => {
                const active = settlementDocument?.id === document.id
                const role = setupImportRole(document)
                const documentName = document.display_name || document.original_filename
                const hasAddressIssue = active && ['mismatch', 'missing', 'document_address_missing'].includes(settlementAddressValidation?.status)
                return (
                  <div key={document.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white" title={documentName}>{documentName}</p>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-300">{setupImportRoleLabel(document)}</span>
                          {active ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">Selected</span> : null}
                          {hasAddressIssue ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                              {settlementAddressValidation.status === 'mismatch' ? 'Address mismatch' : 'Address unconfirmed'}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {role === 'settlement_document' ? 'Final closing price and valuation fields' : 'Purchase details, valuation fields, and loan terms'}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                      <button type="button" className="text-blue-700 hover:underline dark:text-blue-300" onClick={() => navigate(document.displayUrl || documentUrl)}>Open</button>
                      <button type="button" className="text-blue-700 hover:underline dark:text-blue-300" onClick={() => loadSettlementReview(document.id, { openReview: true })}>Review import</button>
                      <button type="button" className="text-gray-600 hover:underline dark:text-gray-300" onClick={() => {
                        setSettlementDocument(document)
                        setSettlementDelinkConfirm(true)
                      }}>Delink</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-950 dark:text-white">Upload setup documents</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Closing documents can include loan terms. Settlement documents provide final closing price.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => openSettlementUpload('closing_document')} disabled={settlementUploading}>
                <Upload className="h-4 w-4" />
                {settlementUploading ? 'Uploading...' : 'Upload Closing'}
              </button>
              <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => openSettlementUpload('settlement_document')} disabled={settlementUploading}>
                <Upload className="h-4 w-4" />
                {settlementUploading ? 'Uploading...' : 'Upload Settlement'}
              </button>
            </div>
          </div>
        )}
        {settlementDelinkConfirm ? (
          <div className="mt-3 rounded-md border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900">
            <p className="font-semibold text-gray-950 dark:text-white">Delink this document?</p>
            <p className="mt-1 text-gray-600 dark:text-gray-300">The document will remain in Documents, but it will no longer be linked as the source for this setup form.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => setSettlementDelinkConfirm(false)}>Cancel</button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
	                  setSettlementDocument(null)
                    setSettlementDocuments((current) => current.filter((document) => document.id !== settlementDocument?.id))
	                  setSettlementReview(null)
	                  setSettlementSources({})
	                  setSettlementAddressValidation(null)
	                  setSettlementAddressConfirmed(false)
	                  setSettlementDelinkConfirm(false)
	                }}
              >
                Delink Document
              </button>
            </div>
          </div>
        ) : null}
        {settlementReview ? renderSettlementReview() : null}
      </div>
    )
  }

	  function renderSettlementReview() {
	    const addressValidation = settlementReview?.addressValidation || settlementAddressValidation
	    const addressStatus = addressValidation?.status
	    const addressBlocksApply = addressStatus === 'mismatch' || addressStatus === 'document_address_missing' || addressStatus === 'missing' || (addressStatus === 'possible_match' && !settlementAddressConfirmed)
	    const addressStatusLabel = {
	      match: 'Address confirmed',
	      possible_match: 'Please confirm',
	      property_address_empty: 'Ready to add',
	      document_address_missing: 'Address not found',
	      missing: 'Address not found',
	      mismatch: 'Mismatch',
	    }[addressStatus] || 'Needs review'
	    const addressStatusClass = addressStatus === 'match'
	      ? 'text-green-700 dark:text-green-300'
	      : addressStatus === 'possible_match' || addressStatus === 'property_address_empty'
	        ? 'text-yellow-700 dark:text-yellow-300'
	        : 'text-red-700 dark:text-red-300'
      const purchasePriceSelection = settlementReview.purchasePriceSelection
      const calculationRows = settlementReview.settlementCalculations || []
	    return (
	      <div className="mt-4 border-t border-blue-200 pt-4 dark:border-blue-900/60">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
	            <p className="text-sm font-semibold text-gray-950 dark:text-white">Property details found</p>
	            <p className="text-sm text-gray-600 dark:text-gray-300">Review extracted values before applying them to the form.</p>
          </div>
          {propertyId ? (
            <button type="button" className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300" onClick={() => navigate(`/properties/${propertyId}/documents`)}>
              Open document
            </button>
          ) : null}
        </div>
	        {addressValidation ? (
	          <div className="mb-4 rounded-md border border-gray-200 bg-white/70 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/30">
	            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Address check</p>
	            <div className="grid gap-3 sm:grid-cols-3">
	              <div>
	                <p className="text-xs text-gray-500 dark:text-gray-400">Property Setup</p>
	                <p className="font-medium text-gray-950 dark:text-white">{addressValidation.normalizedPropertyAddress || 'No address entered'}</p>
	              </div>
	              <div>
	                <p className="text-xs text-gray-500 dark:text-gray-400">Closing document</p>
	                <p className="font-medium text-gray-950 dark:text-white">{addressValidation.normalizedDocumentAddress || 'Missing address'}</p>
	              </div>
	              <div>
	                <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
	                <p className={`font-medium ${addressStatusClass}`}>{addressStatusLabel}</p>
	              </div>
	            </div>
	            {addressStatus === 'property_address_empty' ? (
	              <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">Property address found in the document. Apply this address to the property before continuing.</p>
	            ) : null}
	            {addressStatus === 'possible_match' ? (
	              <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
	                <input
	                  type="checkbox"
	                  checked={settlementAddressConfirmed}
	                  onChange={(event) => {
	                    setSettlementAddressConfirmed(event.target.checked)
	                    setSettlementReview((current) => current ? { ...current, addressConfirmed: event.target.checked } : current)
	                  }}
	                />
	                I confirm this document belongs to this property.
	              </label>
	            ) : null}
	            {addressStatus === 'mismatch' && addressValidation.differences?.length ? (
	              <p className="mt-2 text-xs text-red-700 dark:text-red-300">Different fields: {addressValidation.differences.join(', ')}</p>
	            ) : null}
	            {['mismatch', 'missing', 'document_address_missing'].includes(addressStatus) ? (
	              <p className="mt-3 text-sm text-red-700 dark:text-red-300">
	                {addressStatus === 'mismatch' ? 'This document appears to belong to a different property.' : 'We could not find a property address in this document.'}
	              </p>
	            ) : null}
	          </div>
	        ) : null}
        {purchasePriceSelection ? (
          <div className="mb-4 rounded-md border border-gray-200 bg-white/70 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/30">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-950 dark:text-white">{purchasePriceSelection.label || 'Purchase price components'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Purchase price uses Sale Price. Settlement adjustments are shown for Closing costs.</p>
              </div>
              {purchasePriceSelection.settlementTotalDisplay ? (
                <div className="text-left sm:text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Statement final total</p>
                  <p className="font-semibold text-gray-950 dark:text-white">{purchasePriceSelection.settlementTotalDisplay}</p>
                </div>
              ) : null}
            </div>
            <div className="divide-y divide-gray-100 rounded-md border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
              {purchasePriceSelection.components.map((component) => (
                <label key={component.id} className="flex cursor-pointer items-start gap-3 p-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={Boolean(component.selected)}
                    onChange={(event) => updatePurchasePriceComponent(component.id, event.target.checked)}
                  />
                  <span className="flex-1">
                    <span className="block font-medium text-gray-950 dark:text-white">{component.label}</span>
                    <span className="block text-gray-700 dark:text-gray-200">{component.display}</span>
                    {component.description ? <span className="block text-xs text-gray-500 dark:text-gray-400">{component.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
            {purchasePriceSelection.debitSubtotalDisplay || purchasePriceSelection.dueToBuyerDisplay ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {purchasePriceSelection.debitSubtotalDisplay ? (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Debit subtotal</p>
                    <p className="font-medium text-gray-900 dark:text-white">{purchasePriceSelection.debitSubtotalDisplay}</p>
                  </div>
                ) : null}
                {purchasePriceSelection.dueToBuyerDisplay ? (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Due to buyer</p>
                    <p className="font-medium text-gray-900 dark:text-white">{purchasePriceSelection.dueToBuyerDisplay}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {settlementReview.warnings?.length ? (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            {settlementReview.warnings.map((warning, index) => (
              <p key={`${warning}-${index}`}>{warning}</p>
            ))}
          </div>
        ) : null}
		        <div className="divide-y divide-blue-200 rounded-md border border-blue-200 bg-white/70 dark:divide-blue-900/60 dark:border-blue-900/60 dark:bg-gray-950/30">
	          {settlementReview.fields.map((field) => {
            const different = field.currentDisplay && field.currentDisplay !== field.display
            return (
              <label key={field.targetKey} className="flex cursor-pointer items-start gap-3 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={field.selected}
                  onChange={(event) => updateSettlementReviewField(field.targetKey, event.target.checked)}
                />
                <span className="flex-1">
                  <span className="block font-medium text-gray-950 dark:text-white">{field.label}</span>
                  <span className="block text-gray-700 dark:text-gray-200">{field.display}</span>
                  {different ? <span className="block text-xs text-yellow-700 dark:text-yellow-300">Different from current value: {field.currentDisplay}</span> : null}
                </span>
              </label>
            )
          })}
	        </div>
        {calculationRows.length ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-gray-950 dark:text-white">Settlement calculations</p>
            <DataTable
              rows={calculationRows}
              getRowKey={(row, index) => `${row.key}-${index}`}
              tableWrapperClassName="overflow-auto"
              columns={[
                { id: 'label', header: 'Field', accessor: 'label', sortable: false },
                { id: 'display', header: 'Amount', accessor: 'display', align: 'right', sortable: false },
              ]}
            />
          </div>
        ) : null}
	        {settlementReview.loanSuggestion ? (
	          <div className="mt-4">
	            <p className="mb-2 text-sm font-semibold text-gray-950 dark:text-white">Loan details found</p>
	            <div className="grid gap-2 rounded-md border border-blue-200 bg-white/70 p-3 text-sm dark:border-blue-900/60 dark:bg-gray-950/30 sm:grid-cols-2">
	              {(settlementReview.loanFields || []).map((field) => (
	                <div key={`${field.targetKey}-${field.sourceField}`} className="min-w-0">
	                  <p className="text-xs text-gray-500 dark:text-gray-400">{field.label}</p>
	                  <p className="truncate font-medium text-gray-900 dark:text-white">{field.display}</p>
	                </div>
	              ))}
	            </div>
	            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">Loan details were detected and staged in Loans as review required.</p>
	          </div>
	        ) : null}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => setSettlementReview(null)}>Keep current values</button>
	          <button type="button" className="btn-primary" onClick={applySettlementReview} disabled={addressBlocksApply}>Apply selected values</button>
	        </div>
	      </div>
    )
  }

  function renderFinancingRecords() {
    const loanStatusLabel = (status) => LOAN_STATUS_OPTIONS.find((option) => option.value === status)?.label || status || 'Open'
    const loanLifecycleText = (loan) => {
      const label = loanStatusLabel(loan.status || 'OPEN')
      return CLOSED_LOAN_STATUSES.has(loan.status) && loan.closed_date ? `${label} ${formatDate(loan.closed_date)}` : label
    }
    return (
      <PropertySetupRecords title="Existing Loans" description="Review existing loans before editing or adding a loan.">
        {loanTransferSuggestions.length ? (
          <div className="mb-4 space-y-2">
            {loanTransferSuggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm dark:border-yellow-900/60 dark:bg-yellow-950/20">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-yellow-900 dark:text-yellow-100">{suggestion.message}</p>
                    <p className="mt-1 text-yellow-800 dark:text-yellow-200">
                      {suggestion.previousLoanLabel} can be closed and grouped with {suggestion.currentLoanLabel}.
                    </p>
                    {suggestion.proposedClosedDateSourceLabel ? (
                      <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">Close date source: {suggestion.proposedClosedDateSourceLabel}</p>
                    ) : null}
                    {suggestion.reasons?.length ? (
                      <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-300">{suggestion.reasons.join(' · ')}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:min-w-56">
                    <label className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
                      Old loan closed date
                      <input
                        type="date"
                        className="mt-1 h-10 w-full rounded-md border border-yellow-200 bg-white px-2 text-sm text-gray-950 dark:border-yellow-900/60 dark:bg-gray-950 dark:text-white"
                        value={loanTransferCloseDates[suggestion.id] || suggestion.proposedClosedDate || ''}
                        onChange={(event) => setLoanTransferCloseDates((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => applyLoanTransferSuggestion(suggestion)}
                      disabled={loanTransferApplying === suggestion.id}
                    >
                      {loanTransferApplying === suggestion.id ? 'Grouping...' : 'Accept close date'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {loanGroups.some((group) => (group.members || []).length > 1) ? (
          <div className="mb-4 space-y-2">
            {loanGroups.filter((group) => (group.members || []).length > 1).map((group) => (
              <div key={group.id} className="rounded-md border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-950/30">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-gray-950 dark:text-white">{group.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Current servicer: {group.currentLender || '—'} · Balance {formatCurrency(toNumber(group.currentBalance))}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{group.status}</span>
                </div>
                <LoanJourney items={group.members || []} compact />
              </div>
            ))}
          </div>
        ) : null}
        {!loans.length ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
            No loans recorded. Add your first loan below.
          </div>
        ) : (
          <DataTable
            rows={loans.map((loan, index) => ({ ...loan, draftIndex: index }))}
            getRowKey={(loan, index) => loan.id || `new-${index}`}
            getRowProps={(loan) => ({
              className: CLOSED_LOAN_STATUSES.has(loan.status) ? 'opacity-70' : undefined,
            })}
            columns={[
              { id: 'lender_name', header: 'Lender', render: (loan) => loan.lender_name || 'New loan' },
              { id: 'account_number', header: 'Loan #', render: (loan) => loan.account_number || '—' },
              { id: 'status', header: 'Status', render: (loan) => loanLifecycleText(loan) },
              { id: 'origination_date', header: 'Origination Date', render: (loan) => loan.origination_date ? formatDate(loan.origination_date) : '—' },
              { id: 'servicer_start_date', header: 'Acquisition Date', render: (loan) => loan.servicer_start_date ? formatDate(loan.servicer_start_date) : '—' },
              { id: 'closed_date', header: 'Closed Date', render: (loan) => loan.closed_date ? formatDate(loan.closed_date) : '—' },
	              { id: 'original_amount', header: 'Original Amount', align: 'right', render: (loan) => formatCurrency(toNumber(loan.original_amount)) },
	              { id: 'current_balance', header: 'Current/Final Balance', align: 'right', render: (loan) => formatCurrency(toNumber(loan.current_balance)) },
	              { id: 'interest_rate', header: 'Rate', align: 'right', render: (loan) => formatInterestRate(toNumber(loan.interest_rate)) },
	              { id: 'monthly_payment', header: 'P&I / mo', align: 'right', render: (loan) => formatCurrency(toNumber(loan.monthly_payment)) },
	              { id: 'escrow_amount', header: 'Escrow / mo', align: 'right', render: (loan) => loan.escrow_included ? formatCurrency(toNumber(loan.escrow_amount)) : '—' },
              { id: 'actions', header: 'Actions', sortable: false, render: (loan) => <div className="flex justify-end gap-3"><button type="button" className="text-blue-600 hover:underline" onClick={() => setLoanEditorIndex(loan.draftIndex)}>Edit</button><button type="button" className="text-red-600 hover:underline" onClick={() => removeLoan(loan, loan.draftIndex)}>Delete</button></div> },
            ]}
          />
        )}
      </PropertySetupRecords>
    )
  }

  function renderLoanStatementUploadPanel(loan = null) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
        <input
          ref={loanStatementInputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,.csv"
          className="sr-only"
          onChange={(event) => handleLoanStatementUpload(event.target.files)}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-950 dark:text-white">Upload multiple loan documents</p>
            {loan?.source_type === 'mortgage_statement' ? (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Select one or more 1098 forms or mortgage statements. Latest statement values are marked as reported and remain editable.</p>
            ) : (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Select one or more 1098 forms or mortgage statements. We will analyze the documents together and ask you to confirm the consolidated loan table before applying.</p>
            )}
          </div>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => loanStatementInputRef.current?.click()} disabled={loanStatementUploading}>
            <Upload className="h-4 w-4" />
            {loanStatementUploading ? 'Uploading...' : 'Upload 1098s / statements'}
          </button>
        </div>
        {loanStatementConflict ? renderLoanStatementConflict() : null}
        {loanConsolidatedReview ? renderLoanConsolidatedReview() : null}
        {loanStatementReview ? renderLoanStatementReview() : null}
      </div>
    )
  }

  function renderLoanStatementConflict() {
    const matchLabel = loanStatementConflict.matchType === 'exact' ? 'Exact duplicate' : 'Possible duplicate'
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-amber-900 dark:text-amber-100">{matchLabel} already uploaded</p>
            <p className="mt-1 truncate text-xs font-medium text-amber-800 dark:text-amber-200" title={loanStatementConflict.name}>
              {loanStatementConflict.name}
            </p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {loanStatementConflict.uploadDate ? `Uploaded ${documentDisplayDate(loanStatementConflict.uploadDate)}` : 'Existing document'}{loanStatementConflict.propertyAddress ? ` · ${loanStatementConflict.propertyAddress}` : ''}
            </p>
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Replace the existing document with this upload to continue.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setLoanStatementConflict(null)} disabled={loanStatementUploading}>
              Cancel
            </button>
            <button type="button" className="btn-primary text-xs" onClick={replaceDuplicateLoanStatement} disabled={loanStatementUploading || !loanStatementConflict.pendingUpload}>
              {loanStatementUploading ? 'Replacing...' : 'Replace existing document'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  async function applyLoanConsolidatedReview() {
    if (!loanConsolidatedReview) return
    try {
      const targetId = propertyId || await ensurePropertyRecord()
      const response = await docAPI.applyConsolidatedLoanDocuments({
        property_id: Number(targetId),
        document_ids: loanConsolidatedReview.documentIds || [],
      })
      await refreshPropertyDraft(targetId)
      const firstApplied = response.data.appliedLoanIds?.[0]
      if (firstApplied) {
        const appliedLoanIndex = (response.data.draft?.loans || []).findIndex((loan) => loan.id === firstApplied)
        if (appliedLoanIndex >= 0) setLoanEditorIndex(appliedLoanIndex)
      }
      setLoanConsolidatedReview(null)
      setDirtySection(null)
      toast.success('Consolidated loan documents applied.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not apply consolidated loan documents'))
    }
  }

  function renderLoanConsolidatedReview() {
    const rows = loanConsolidatedReview?.loanRows || []
    return (
      <div className="mt-4 border-t border-blue-200 pt-4 dark:border-blue-900/60">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-950 dark:text-white">Consolidated loan table</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{loanConsolidatedReview.summary}</p>
          </div>
          <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">Confirm before applying</span>
        </div>
        <DataTable
          rows={rows}
          getRowKey={(row) => row.accountNumber}
          columns={[
            { id: 'accountNumber', header: 'Loan #', accessor: 'accountNumber', cellClassName: 'font-medium text-gray-900 dark:text-white' },
            { id: 'lenderName', header: 'Lender', accessor: 'lenderName' },
            { id: 'status', header: 'Status', accessor: 'status' },
            { id: 'originationDate', header: 'Origination', render: (row) => row.originationDate ? formatDate(row.originationDate) : '—' },
            { id: 'servicerStartDate', header: 'Start', render: (row) => row.servicerStartDate ? formatDate(row.servicerStartDate) : '—' },
            { id: 'closedDate', header: 'Closed', render: (row) => row.closedDate ? formatDate(row.closedDate) : '—' },
            { id: 'originalAmount', header: 'Original', align: 'right', render: (row) => row.originalAmount ? formatCurrency(row.originalAmount) : '—' },
            { id: 'currentBalance', header: 'Balance', align: 'right', render: (row) => row.currentBalance ? formatCurrency(row.currentBalance) : '—' },
            { id: 'sourceYears', header: 'Years', render: (row) => (row.sourceYears || []).join(', ') || '—' },
          ]}
          defaultSort={{ id: 'sequence', direction: 'asc' }}
        />
        <div className="mt-3 rounded-md border border-gray-200 bg-white/70 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-300">
          Latest tax year or statement date wins for balances. 1098 account numbers are treated as canonical loan numbers. Original loan amount is preserved from the derived closing/loan value when available.
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => setLoanConsolidatedReview(null)}>Keep current loans</button>
          <button type="button" className="btn-primary" onClick={applyLoanConsolidatedReview}>Apply consolidated loan table</button>
        </div>
      </div>
    )
  }

  function renderLoanStatementReview() {
    const mapping = loanStatementReview.loanMapping
    const accountMismatchBlocksApply = mapping?.matchType === 'selected_account_mismatch' && !loanStatementReview.accountMismatchConfirmed
    return (
      <div className="mt-4 border-t border-blue-200 pt-4 dark:border-blue-900/60">
        <p className="mb-2 text-sm font-semibold text-gray-950 dark:text-white">{loanStatementReview.document?.type === '1098' ? '1098 values found' : 'Mortgage statement values found'}</p>
        {mapping ? (
          <div className={`mb-3 rounded-md border p-3 text-sm ${
            mapping.matchType === 'selected_account_mismatch'
              ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'
              : 'border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-950/30'
          }`}>
            <p className="font-medium text-gray-950 dark:text-white">{mapping.accountNumber ? `Loan account ${mapping.accountNumber}` : 'Loan account not found'}</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{mapping.message}</p>
            {mapping.matchType === 'selected_account_mismatch' && mapping.selectedAccountNumber ? (
              <>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Selected loan account: {mapping.selectedAccountNumber}</p>
                <label className="mt-3 flex items-start gap-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(loanStatementReview.accountMismatchConfirmed)}
                    onChange={(event) => setLoanStatementReview((current) => current ? { ...current, accountMismatchConfirmed: event.target.checked } : current)}
                  />
                  I confirm this document belongs to loan account {mapping.accountNumber} and should not overwrite account {mapping.selectedAccountNumber}.
                </label>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {loanStatementReview.fields.map((field) => {
            const different = field.currentDisplay && field.currentDisplay !== field.display
            return (
              <label key={`${field.targetKey}-${field.sourceKey}`} className="flex gap-2 rounded-md border border-blue-100 bg-white/70 p-2 text-sm dark:border-blue-900/60 dark:bg-gray-950/30">
                <input type="checkbox" checked={field.selected} onChange={(event) => updateLoanStatementReviewField(field.targetKey, event.target.checked)} />
                <span className="min-w-0">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{field.label}</span>
                  <span className="block truncate font-medium text-gray-900 dark:text-white">{field.display}</span>
                  {different ? <span className="block text-xs text-yellow-700 dark:text-yellow-300">Different from current value: {field.currentDisplay}</span> : null}
                </span>
              </label>
            )
          })}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={() => setLoanStatementReview(null)}>Keep current values</button>
          <button type="button" className="btn-primary" onClick={applyLoanStatementReview} disabled={accountMismatchBlocksApply}>Apply selected values</button>
        </div>
      </div>
    )
  }

  function renderFinancingEditor() {
    const loan = loanEditorIndex != null ? loans[loanEditorIndex] : null
    const statementSources = loanStatementSourcesFromLoan(loan)
    const statusRequiresClosedDate = CLOSED_LOAN_STATUSES.has(loan?.status)
    const otherOpenLoans = loanEditorIndex != null
      ? loans.some((candidate, index) => index !== loanEditorIndex && (candidate.status || 'OPEN') === 'OPEN')
      : false
    return (
      <PropertySetupEditor title={loan ? 'Edit Loan' : 'Add Loan'} description="Loan records remain saved through the loan API.">
        {!loan ? (
          <div className="space-y-4">
            {renderLoanStatementUploadPanel()}
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
              <span>Prefer manual entry? Add a loan record and enter the values yourself.</span>
              <button type="button" className="btn-primary flex items-center justify-center gap-1.5" onClick={addLoan}>
                <Plus className="h-4 w-4" /> Add Loan Manually
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {renderLoanStatementUploadPanel(loan)}
            {otherOpenLoans && (loan.status || 'OPEN') === 'OPEN' ? (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-900/60 dark:bg-yellow-950/20 dark:text-yellow-200">
                This property already has an open loan. Close or refinance the prior loan if this new loan replaces it.
              </div>
            ) : null}
            <div className="flex justify-end">
              <button type="button" className="btn-secondary text-sm" onClick={() => setLoanEditorIndex(null)}>Cancel</button>
            </div>
	            <SetupSubsection title="Loan Details">
	              <div className="grid gap-4 md:grid-cols-3">
	                <TextInput label="Lender" value={loan.lender_name} onChange={(value) => updateLoan(loanEditorIndex, 'lender_name', value)} />
	                <TextInput label="Loan Account Number" value={loan.account_number} onChange={(value) => updateLoan(loanEditorIndex, 'account_number', value)} />
	                <SelectInput label="Loan Type" value={loan.loan_type} onChange={(value) => updateLoan(loanEditorIndex, 'loan_type', value)}>
	                  {LOAN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
	                </SelectInput>
	                <SelectInput label="Status" value={loan.status || 'OPEN'} onChange={(value) => updateLoan(loanEditorIndex, 'status', value)}>
	                  {LOAN_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
	                </SelectInput>
	                <MoneyInput fieldKey={`loan_${loanEditorIndex}_original_amount`} label="Original Loan Amount" value={loan.original_amount} onChange={(value) => updateLoan(loanEditorIndex, 'original_amount', value)} error={errors[`loan_${loanEditorIndex}_original_amount`]} />
	                <div>
	                  <MoneyInput fieldKey={`loan_${loanEditorIndex}_current_balance`} label="Current Balance" value={loan.current_balance} onChange={(value) => updateLoan(loanEditorIndex, 'current_balance', value)} error={errors[`loan_${loanEditorIndex}_current_balance`]} source={statementSources.current_balance} />
	                  {loan.current_balance_source_label ? (
	                    <p className={`mt-1 text-xs ${loan.current_balance_source === 'mortgage_statement_reported_balance' ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}`}>{loan.current_balance_source_label}. {loan.current_balance_verification_status}</p>
	                  ) : null}
	                </div>
	                <PercentInput fieldKey={`loan_${loanEditorIndex}_interest_rate`} label="Interest Rate" value={loan.interest_rate} onChange={(value) => updateLoan(loanEditorIndex, 'interest_rate', value)} error={errors[`loan_${loanEditorIndex}_interest_rate`]} />
	                <TextInput fieldKey={`loan_${loanEditorIndex}_loan_term_years`} label="Term" value={loan.loan_term_years} onChange={(value) => updateLoan(loanEditorIndex, 'loan_term_years', value.replace(/[^0-9]/g, ''))} error={errors[`loan_${loanEditorIndex}_loan_term_years`]} />
	                <TextInput fieldKey={`loan_${loanEditorIndex}_origination_date`} label="Origination Date" type="date" value={loan.origination_date} onChange={(value) => updateLoan(loanEditorIndex, 'origination_date', value)} error={errors[`loan_${loanEditorIndex}_origination_date`]} />
	                <TextInput fieldKey={`loan_${loanEditorIndex}_servicer_start_date`} label="Mortgage Acquisition Date" type="date" value={loan.servicer_start_date} onChange={(value) => updateLoan(loanEditorIndex, 'servicer_start_date', value)} />
	                <MoneyInput fieldKey={`loan_${loanEditorIndex}_monthly_payment`} label="Monthly Principal & Interest" value={loan.monthly_payment} onChange={(value) => updateLoan(loanEditorIndex, 'monthly_payment', value)} error={errors[`loan_${loanEditorIndex}_monthly_payment`]} />
	                {statusRequiresClosedDate ? (
	                  <>
	                    <TextInput fieldKey={`loan_${loanEditorIndex}_closed_date`} label="Closed Date" type="date" value={loan.closed_date} onChange={(value) => updateLoan(loanEditorIndex, 'closed_date', value)} error={errors[`loan_${loanEditorIndex}_closed_date`]} required />
	                    <SelectInput label="Closure Reason" value={loan.closure_reason} onChange={(value) => updateLoan(loanEditorIndex, 'closure_reason', value)}>
	                      <option value="">Select reason</option>
	                      {LOAN_CLOSURE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
	                    </SelectInput>
	                    <SelectInput label="Replacement Loan" value={loan.replacement_loan_id} onChange={(value) => updateLoan(loanEditorIndex, 'replacement_loan_id', value)}>
	                      <option value="">None</option>
	                      {loans.filter((candidate, index) => index !== loanEditorIndex).map((candidate, index) => (
	                        <option key={candidate.id || index} value={candidate.id || ''}>{candidate.lender_name || `Loan ${index + 1}`}</option>
	                      ))}
	                    </SelectInput>
	                  </>
	                ) : null}
	              </div>
	            </SetupSubsection>
	            <SetupSubsection title="Escrow Details">
	              <label className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
	                <input type="checkbox" checked={Boolean(loan.escrow_included)} onChange={(event) => toggleLoanEscrow(loanEditorIndex, event.target.checked)} />
	                Escrow included
	              </label>
	              {loan.escrow_included ? (
	                <div className="grid gap-4 md:grid-cols-3">
	                  <MoneyInput label="Monthly property tax escrow" value={loan.monthly_property_tax_escrow} onChange={(value) => updateLoan(loanEditorIndex, 'monthly_property_tax_escrow', value)} source={statementSources.monthly_property_tax_escrow} />
	                  <MoneyInput label="Monthly insurance escrow" value={loan.monthly_insurance_escrow} onChange={(value) => updateLoan(loanEditorIndex, 'monthly_insurance_escrow', value)} source={statementSources.monthly_insurance_escrow} />
	                  <MoneyInput label="Monthly mortgage insurance" value={loan.monthly_mortgage_insurance} onChange={(value) => updateLoan(loanEditorIndex, 'monthly_mortgage_insurance', value)} source={statementSources.monthly_mortgage_insurance} />
	                  <MoneyInput label="Other monthly escrow" value={loan.monthly_other_escrow} onChange={(value) => updateLoan(loanEditorIndex, 'monthly_other_escrow', value)} source={statementSources.monthly_other_escrow} />
	                  <MoneyInput label="Total monthly escrow" value={loan.escrow_amount} onChange={(value) => updateLoan(loanEditorIndex, 'escrow_amount', value)} error={errors[`loan_${loanEditorIndex}_escrow_amount`]} source={statementSources.escrow_amount} />
	                  <MoneyInput label="Estimated total monthly payment" value={loan.estimated_total_monthly_payment} onChange={(value) => updateLoan(loanEditorIndex, 'estimated_total_monthly_payment', value)} source={statementSources.estimated_total_monthly_payment} />
	                  <TextInput label="Statement date" type="date" value={loan.statement_date} onChange={(value) => updateLoan(loanEditorIndex, 'statement_date', value)} source={statementSources.statement_date} />
	                </div>
	              ) : null}
	            </SetupSubsection>
          </div>
        )}
      </PropertySetupEditor>
    )
  }

	  function renderRentalRecords() {
	    const rentalPeriods = rentalTimeline?.periods || []
	    const editingRef = rentalDraft.period_ref
	    const rows = editingRef
	      ? rentalPeriods.flatMap((period) => rentalPeriodRef(period) === editingRef ? [period, { kind: 'form', periodRef: '__edit_form__' }] : [period])
	      : [...rentalPeriods, { kind: 'form', periodRef: '__add_form__' }]
	    return (
	      <PropertySetupRecords title="Occupancy log" description="Log only occupied periods. Vacancy rows are calculated automatically from the gaps.">
	        <DataTable
	          rows={rows}
	          getRowKey={(period) => rentalPeriodRef(period)}
	          getRowProps={(period) => period.status === 'vacant' ? { className: 'bg-yellow-50/70 dark:bg-yellow-950/20' } : {}}
	          renderFullWidthRow={(period) => period.kind === 'form' ? renderRentalPeriodInlineForm() : null}
	          columns={[
	            { id: 'startDate', header: 'From', render: (period) => formatDate(rentalPeriodValue(period, 'startDate', 'start_date')) },
	            { id: 'endDate', header: 'To', render: (period) => rentalPeriodValue(period, 'endDate', 'end_date') ? formatDate(rentalPeriodValue(period, 'endDate', 'end_date')) : 'Ongoing' },
	            {
	              id: 'monthlyRent',
	              header: 'Rent/mo',
	              align: 'right',
	              render: (period) => period.status === 'vacant'
	                ? <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-200">Vacant · auto</span>
	                : rentalPeriodMonthlyRent(period),
	            },
	            { id: 'months', header: 'Duration', align: 'right', render: (period) => rentalPeriodValue(period, 'monthsDisplay', 'duration') || '—' },
	            {
	              id: 'actions',
	              header: 'Actions',
	              sortable: false,
	              render: (period) => period.editable && period.status === 'occupied'
	                ? <div className="flex justify-end gap-3"><button type="button" className="text-blue-600 hover:underline" onClick={() => editRentalPeriod(period)}>Edit</button><button type="button" className="text-red-600 hover:underline" onClick={() => setRentalDeleteTarget(period)}>Delete</button></div>
	                : <span className="text-xs text-gray-400 dark:text-gray-500">{period.derived ? 'Auto' : '—'}</span>,
	            },
	          ]}
	        />
	      </PropertySetupRecords>
	    )
	  }

	  function renderRentalPeriodInlineForm() {
	    const editing = Boolean(rentalDraft.period_ref)
	    return (
	      <div className="space-y-3 rounded-md bg-white p-3 dark:bg-gray-900">
	        <div>
	          <p className="text-sm font-semibold text-gray-950 dark:text-white">{editing ? 'Edit occupied period' : '+ Add occupied period'}</p>
	          <p className="text-xs text-gray-500 dark:text-gray-400">Record only periods when the property generated rental income.</p>
	        </div>
	        <div className="grid gap-4 md:grid-cols-4">
	          <TextInput label="From" type="date" value={rentalDraft.start_date} onChange={(value) => { setRentalDraft((current) => ({ ...current, start_date: value })); setDirtySection('rental') }} error={errors.rental_start} />
	          <TextInput label="To" type="date" value={rentalDraft.end_date} onChange={(value) => { setRentalDraft((current) => ({ ...current, end_date: value })); setDirtySection('rental') }} error={errors.rental_end} helper="Optional — leave blank if currently occupied." />
	          <MoneyInput label="Rent/mo" value={rentalDraft.monthly_rent} onChange={(value) => { setRentalDraft((current) => ({ ...current, monthly_rent: value })); setDirtySection('rental') }} error={errors.rental_monthly_rent} />
	          <TextInput label="Notes" value={rentalDraft.notes} onChange={(value) => { setRentalDraft((current) => ({ ...current, notes: value })); setDirtySection('rental') }} />
	        </div>
	        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
	          {editing ? (
	            <button type="button" className="btn-secondary" onClick={() => setRentalDraft(blankRentalPeriod())}>Cancel</button>
	          ) : null}
	          <button type="button" className="btn-primary" onClick={() => saveSection('rental')} disabled={sectionState.rental === 'Saving'}>
	            {editing ? 'Save Changes' : 'Add Occupied Period'}
	          </button>
	        </div>
	      </div>
	    )
	  }

	  function renderRentalEditor() {
	    return (
	      <div className="space-y-6">
	        <PropertySetupEditor title="When it opened as a rental" description="Rental availability is separate from occupancy. A property can be open as a rental and still vacant between tenants.">
	          <div className="mb-4 rounded-md bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 dark:bg-gray-900 dark:text-gray-200">
	            {rentalSummaryLine(rentalTimeline)}
	          </div>
	          <div className="grid gap-4 md:grid-cols-2">
	            <div>
	              <TextInput fieldKey="rental_start_date" label="Rental available from" type="date" value={form.rental_start_date} onChange={(value) => setField('rental_start_date', value, 'rental')} error={errors.rental_start_date} required />
	              {form.rental_start_date_origin === 'auto_purchase_date' ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Defaulted from purchase date</p> : null}
	            </div>
	            <TextInput label="Available until" type="date" value={form.rental_end_date} onChange={(value) => setField('rental_end_date', value, 'rental')} />
	          </div>
	        </PropertySetupEditor>
	        {renderRentalRecords()}
	      </div>
	    )
	  }

  function renderExpenseHistoryRecords() {
    const tableRows = expenseYears.map((year) => expenseRows.find((row) => Number(row.year) === Number(year)) || blankAnnualExpense(year))
    const expenseTableColumns = [
      { id: 'year', header: 'Year', accessor: 'year', defaultDirection: 'asc' },
      ...EXPENSE_FIELDS.filter((field) => !field.feature || flags[field.feature]).map((field) => ({
        id: field.key,
        header: field.label.replace(' / yr', ''),
        accessor: field.key,
        align: 'right',
        render: (_row, value) => toNumber(value) ? formatCurrency(toNumber(value)) : '—',
      })),
      {
        id: 'status',
        header: 'Status',
        sortable: false,
        render: (row) => row.entered || EXPENSE_FIELDS.some((field) => toNumber(row[field.key]) > 0) ? 'Entered' : 'Blank',
      },
      {
        id: 'actions',
        header: 'Actions',
        sortable: false,
        render: (row) => (
          <button type="button" className="text-blue-600 hover:underline" onClick={() => setExpenseYear(Number(row.year))}>
            Edit
          </button>
        ),
      },
    ]
    const currentRow = tableRows.find((row) => Number(row.year) === CURRENT_YEAR) || blankAnnualExpense(CURRENT_YEAR)
    const currentStatus = currentRow.entered || EXPENSE_FIELDS.some((field) => toNumber(currentRow[field.key]) > 0) ? 'Entered' : 'Blank'
    return (
      <PropertySetupRecords title="Current Year Summary" description={`${CURRENT_YEAR} expenses are ${currentStatus.toLowerCase()}. Review existing years before editing the selected row.`}>
        <DataTable
          columns={expenseTableColumns}
          rows={tableRows}
          getRowKey={(row) => row.year}
          defaultSort={{ id: 'year', direction: 'asc' }}
          getRowProps={(row) => ({
            className: Number(row.year) === Number(expenseYear)
              ? 'bg-blue-50 hover:bg-blue-50 dark:bg-blue-950/20 dark:hover:bg-blue-950/30'
              : undefined,
          })}
          emptyMessage="No annual expense years available."
        />
      </PropertySetupRecords>
    )
  }

  function renderExpenseDocumentControl(field) {
    if (!['property_tax', 'insurance'].includes(field.key)) return null
    const sourceDocument = selectedExpenseRow[`${field.key}_document`]
    const uploadingThisField = expenseUploading && expenseUploadTarget === field.key
    const documentUrl = propertyId ? `/properties/${propertyId}/documents` : '/uploads'
    const pendingReview = expenseAddressReview?.field === field.key ? expenseAddressReview : null
    if (pendingReview) {
      const validation = pendingReview.addressValidation || {}
      const missingAddress = validation.status === 'document_address_missing'
      return (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{missingAddress ? "Couldn't read an address" : 'Address mismatch'}</p>
              <p className="mt-0.5 text-red-700 dark:text-red-200">
                {missingAddress
                  ? "Confirm this is the right document before it drives expenses."
                  : 'This document is blocked until the address is confirmed.'}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="font-medium text-red-700 dark:text-red-200">Property address</p>
                  <p className="mt-0.5 break-words text-red-950 dark:text-red-50">{validation.normalizedPropertyAddress || 'No property address'}</p>
                </div>
                <div>
                  <p className="font-medium text-red-700 dark:text-red-200">On-document address</p>
                  <p className="mt-0.5 break-words text-red-950 dark:text-red-50">{validation.normalizedDocumentAddress || 'No address found'}</p>
                </div>
              </div>
              <p className="mt-2 text-red-700 dark:text-red-200">Match confidence: {validation.matchScoreDisplay || '0%'}</p>
              <div className="mt-2 flex flex-wrap gap-3 font-medium">
                <button type="button" className="text-blue-700 hover:underline dark:text-blue-300" onClick={acceptExpenseAddressReview}>
                  Same address — accept
                </button>
                <button type="button" className="text-red-700 hover:underline dark:text-red-300" onClick={removeExpenseAddressReview}>
                  Wrong document — remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }
    if (sourceDocument) {
      return (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-700 dark:text-gray-200" title={sourceDocument.name}>{sourceDocument.name}</p>
              <p className="mt-0.5 truncate text-gray-500 dark:text-gray-400">
                {sourceDocument.docType || 'document'} · {sourceDocument.amountDisplay || '—'} · parsed {documentDisplayDate(sourceDocument.parsedAt)}
              </p>
              {sourceDocument.addressConfirmed && (
                <p className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Address confirmed</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-3 font-medium">
                <button type="button" className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-300" onClick={() => navigate(documentUrl)}>
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
                </button>
                <button type="button" className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-300" onClick={() => openExpenseDocumentUpload(field.key)} disabled={expenseUploading}>
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Replace
                </button>
                <button type="button" className="inline-flex items-center gap-1 text-gray-600 hover:underline dark:text-gray-300" onClick={() => removeExpenseDocument(field.key)}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <button
        type="button"
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-blue-300 hover:text-blue-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-800 dark:hover:text-blue-300"
        onClick={() => openExpenseDocumentUpload(field.key)}
        disabled={expenseUploading}
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        {uploadingThisField ? 'Uploading...' : `Upload ${field.key === 'property_tax' ? 'tax bill' : 'insurance'} doc — PDF, xls`}
      </button>
    )
  }

  function renderExpensesSection() {
    return (
      <div className="space-y-5">
        <input
          ref={expenseDocumentInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls"
          className="sr-only"
          onChange={(event) => handleExpenseDocumentUpload(event.target.files?.[0])}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="label mb-0" htmlFor="expense-year">Year</label>
          <select id="expense-year" className="input max-w-40" value={expenseYear} onChange={(event) => setExpenseYear(Number(event.target.value))}>
            {expenseYears.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <button type="button" className="btn-secondary text-sm" onClick={copyPriorExpenseYear}>Copy prior year</button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {EXPENSE_FIELDS.filter((field) => !field.feature || flags[field.feature]).map((field) => (
            <div key={field.key}>
              <MoneyInput
                label={field.label}
                value={selectedExpenseRow[field.key]}
                onChange={(value) => updateExpenseField(field.key, value)}
                error={errors[field.key]}
                source={annualExpenseSourceBadge(selectedExpenseRow, field.key)}
              />
              {renderExpenseDocumentControl(field)}
            </div>
          ))}
          {flags.hasHoa ? <MoneyInput label="HOA special assessment / yr" value={form.hoa_special_assessment} onChange={(value) => setField('hoa_special_assessment', value, 'expenses')} /> : null}
          {flags.hasSolar ? (
            <SelectInput label="Solar" value={form.solar_ownership} onChange={(value) => setField('solar_ownership', value, 'expenses')}>
              <option value="None">None</option>
              <option value="Leased">Leased</option>
              <option value="Purchased">Purchased</option>
              <option value="Included in Purchase">Included in Purchase</option>
            </SelectInput>
          ) : null}
          {flags.hasSolar && form.solar_ownership === 'Leased' ? <MoneyInput label="Solar lease" value={form.solar_monthly_payment} onChange={(value) => setField('solar_monthly_payment', value, 'expenses')} /> : null}
          {flags.hasSolar && ['Purchased', 'Included in Purchase'].includes(form.solar_ownership) ? <MoneyInput label="Solar purchase price" value={form.solar_purchase_price} onChange={(value) => setField('solar_purchase_price', value, 'expenses')} /> : null}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Blank years are not assumed to be $0. Current-year expenses are optional during setup; entered values drive current-year metrics.</p>
      </div>
    )
  }

}
