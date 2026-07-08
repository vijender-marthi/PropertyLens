import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { propAPI } from '../services/api'
import { costModel } from '../utils/costModel'

const PROPERTY_TYPES = ['Single Family', 'Multi Family', 'Condo', 'Townhouse', 'Commercial']
const LOAN_TYPES = ['FIXED', 'ARM', 'HELOC']

const DEFAULTS = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  property_type: 'Single Family',
  usage_type: 'Rental',
  purchase_date: '',
  purchase_price: '',
  down_payment: '',
  market_value: '',
  monthly_rent: '',
  property_tax: '',
  insurance: '',
  maintenance: '',
  property_management_fee: '',
  utilities: '',
  vacancy_allowance: '',
  capex_reserve: '',
  other_expenses: '',
  hoa_fee: '',
  hoa_history: '[]',
  hoa_special_assessment: '',
  solar_ownership: 'None',
  solar_monthly_payment: '',
  solar_purchase_price: '',
}

const blankLoan = () => ({
  id: null,
  lender_name: '',
  loan_type: 'FIXED',
  original_amount: '',
  current_balance: '',
  interest_rate: '',
  loan_term_years: '30',
  origination_date: '',
  monthly_payment: '',
  escrow_amount: '',
  escrow_included: false,
  extra_monthly_payment: '',
})

function toNumber(value) {
  if (value === '' || value == null) return 0
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function moneyRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function formatMoney(value) {
  const n = toNumber(value)
  if (!n) return ''
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function cleanDecimal(value) {
  const cleaned = String(value || '').replace(/[^0-9.]/g, '')
  const [first, ...rest] = cleaned.split('.')
  return rest.length ? `${first}.${rest.join('')}` : first
}

function isDecimalDraft(value) {
  return value === '' || /^\d*\.?\d*$/.test(String(value))
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

function isLoanBlank(loan) {
  return ![
    loan.lender_name,
    loan.original_amount,
    loan.current_balance,
    loan.interest_rate,
    loan.monthly_payment,
    loan.origination_date,
  ].some((value) => String(value ?? '').trim() !== '')
}

function MoneyInput({ label, value, onChange, required = false, period, error, placeholder }) {
  return (
    <div>
      <label className="label">
        {label}{period ? <span className="text-gray-400"> {period}</span> : null}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      <div className={`flex items-center rounded-md border bg-white dark:bg-gray-800 ${error ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'}`}>
        <span className="px-3 text-gray-400">$</span>
        <input
          className="w-full rounded-r-md border-0 bg-transparent py-2 pr-3 text-sm text-gray-900 outline-none dark:text-gray-100"
          type="text"
          inputMode="decimal"
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => {
            const next = e.target.value
            if (isDecimalDraft(next)) onChange(next)
          }}
          required={required}
        />
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

function PercentInput({ label, value, onChange, error }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className={`flex items-center rounded-md border bg-white dark:bg-gray-800 ${error ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'}`}>
        <input
          className="w-full rounded-l-md border-0 bg-transparent py-2 pl-3 text-sm text-gray-900 outline-none dark:text-gray-100"
          type="text"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => {
            const next = e.target.value
            if (isDecimalDraft(next)) onChange(next)
          }}
        />
        <span className="px-3 text-gray-400">%</span>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

function TextInput({ label, value, onChange, placeholder, helper, error }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className={`input ${error ? 'border-red-400' : ''}`} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {helper ? <p className="mt-1 text-xs text-gray-400">{helper}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

function loanPayload(loan, purchaseDate) {
  const original = toNumber(loan.original_amount)
  if (original <= 0) return null
  const monthlyPayment = toNumber(loan.monthly_payment)
  return {
    lender_name: loan.lender_name || '',
    loan_type: loan.loan_type || 'FIXED',
    original_amount: original,
    current_balance: toNumber(loan.current_balance),
    interest_rate: toNumber(loan.interest_rate),
    monthly_payment: monthlyPayment,
    estimated_total_monthly_payment: monthlyPayment + toNumber(loan.escrow_amount),
    extra_monthly_payment: toNumber(loan.extra_monthly_payment),
    loan_term_years: Math.max(1, Math.round(toNumber(loan.loan_term_years) || 30)),
    origination_date: normalizeDateInput(loan.origination_date || purchaseDate || ''),
    escrow_amount: toNumber(loan.escrow_amount),
    escrow_included: Boolean(loan.escrow_included),
  }
}

export default function PropertyFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(DEFAULTS)
  const [loans, setLoans] = useState([blankLoan()])
  const [deletedLoanIds, setDeletedLoanIds] = useState([])
  const [expandedLoans, setExpandedLoans] = useState(new Set(['new-0']))
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [liveCost, setLiveCost] = useState(() => costModel(DEFAULTS, [blankLoan()]))

  useEffect(() => {
    if (!isEdit) return
    propAPI.get(id)
      .then((r) => {
        const prop = r.data
        const loadedLoans = prop.loans?.length ? prop.loans.map((loan) => ({
          ...blankLoan(),
          ...loan,
          original_amount: loan.original_amount || '',
          current_balance: loan.current_balance || '',
          interest_rate: loan.interest_rate || '',
          loan_term_years: loan.loan_term_years || '30',
          origination_date: normalizeDateInput(loan.origination_date),
          monthly_payment: loan.monthly_payment || '',
          escrow_amount: loan.escrow_amount || '',
          extra_monthly_payment: loan.extra_monthly_payment || '',
        })) : [blankLoan()]
        setForm({
          ...DEFAULTS,
          ...prop,
          address: prop.address === 'Address not provided' ? '' : prop.address || '',
          purchase_date: normalizeDateInput(prop.purchase_date),
          purchase_price: prop.purchase_price || '',
          down_payment: prop.down_payment || '',
          market_value: prop.market_value || '',
          monthly_rent: prop.monthly_rent || '',
          property_tax: prop.property_tax || '',
          insurance: prop.insurance ? moneyRound(prop.insurance / 12) : '',
          maintenance: prop.maintenance || '',
          property_management_fee: prop.property_management_fee || '',
          utilities: prop.utilities || '',
          vacancy_allowance: prop.vacancy_allowance || '',
          capex_reserve: prop.capex_reserve || '',
          other_expenses: prop.other_expenses || '',
          hoa_fee: prop.hoa_fee || '',
          hoa_history: prop.hoa_history || '[]',
          hoa_special_assessment: prop.hoa_special_assessment || '',
          solar_ownership: prop.solar_ownership || 'None',
          solar_monthly_payment: prop.solar_monthly_payment || '',
          solar_purchase_price: prop.solar_purchase_price || '',
        })
        setLoans(loadedLoans)
        setExpandedLoans(new Set([String(loadedLoans[0]?.id || 'new-0')]))
      })
      .catch(() => toast.error('Failed to load property'))
  }, [id, isEdit])

  const isPrimary = (form.usage_type || '').toLowerCase() === 'primary'
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setLoan = (index, key, value) => {
    setLoans((current) => current.map((loan, i) => (i === index ? { ...loan, [key]: value } : loan)))
    setErrors((current) => ({ ...current, [`loan_${index}_${key}`]: undefined }))
  }

  const totalLoanOriginal = useMemo(() => loans.reduce((sum, loan) => sum + toNumber(loan.original_amount), 0), [loans])
  const suggestedDownPayment = Math.max(0, toNumber(form.purchase_price) - totalLoanOriginal)
  useEffect(() => {
    const handle = setTimeout(() => setLiveCost(costModel(form, loans)), 150)
    return () => clearTimeout(handle)
  }, [form, loans])

  const buildPropertyPayload = () => ({
    name: form.name || undefined,
    address: form.address?.trim() || '',
    city: form.city,
    state: form.state,
    zip_code: form.zip_code,
    property_type: form.property_type,
    usage_type: form.usage_type,
    purchase_date: form.purchase_date,
    purchase_price: toNumber(form.purchase_price),
    down_payment: toNumber(form.down_payment),
    market_value: toNumber(form.market_value),
    monthly_rent: toNumber(form.monthly_rent),
    occupancy_rate: 100,
    property_tax: toNumber(form.property_tax),
    insurance: toNumber(form.insurance) * 12,
    hoa_flag: toNumber(form.hoa_fee) > 0 || toNumber(form.hoa_special_assessment) > 0,
    hoa_fee: toNumber(form.hoa_fee),
    hoa_history: form.hoa_history || '[]',
    hoa_special_assessment: toNumber(form.hoa_special_assessment),
    solar_ownership: form.solar_ownership || 'None',
    solar_monthly_payment: toNumber(form.solar_monthly_payment),
    solar_purchase_price: toNumber(form.solar_purchase_price),
    maintenance: toNumber(form.maintenance),
    property_management_fee: toNumber(form.property_management_fee),
    utilities: toNumber(form.utilities),
    vacancy_allowance: toNumber(form.vacancy_allowance),
    capex_reserve: toNumber(form.capex_reserve),
    other_expenses: toNumber(form.other_expenses),
    land_value: toNumber(form.land_value),
    construction_price: toNumber(form.construction_price),
    depreciation_years: form.property_type === 'Commercial' ? 39 : 27.5,
  })

  const validate = () => {
    const next = {}
    if (toNumber(form.purchase_price) <= 0) next.purchase_price = 'Purchase price is required.'
loans.forEach((loan, index) => {
if (isLoanBlank(loan)) return
const original = toNumber(loan.original_amount)
      const balance = toNumber(loan.current_balance)
      const rate = toNumber(loan.interest_rate)
      if (original <= 0) next[`loan_${index}_original_amount`] = 'Original loan amount is required.'
      if (balance > original && original > 0) next[`loan_${index}_current_balance`] = 'Balance cannot exceed original amount.'
      if (rate < 0 || rate > 100) next[`loan_${index}_interest_rate`] = 'Rate must be between 0 and 100.'
      if (loan.origination_date && Number.isNaN(Date.parse(loan.origination_date))) next[`loan_${index}_origination_date`] = 'Enter a valid start date.'
    })
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const addLoan = () => {
    setLoans((current) => {
      const next = [...current, blankLoan()]
      setExpandedLoans(new Set([`new-${next.length - 1}`]))
      return next
    })
  }

  const removeLoan = (index) => {
    setLoans((current) => {
      const loan = current[index]
      if (loan?.id) setDeletedLoanIds((ids) => [...ids, loan.id])
      const next = current.filter((_, i) => i !== index)
      return next.length ? next : [blankLoan()]
    })
  }

  const toggleLoan = (loan, index) => {
    const key = String(loan.id || `new-${index}`)
    setExpandedLoans((current) => {
      const next = new Set(current)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const propertyPayload = buildPropertyPayload()
      const loanPayloads = loans.map((loan) => ({ loan, payload: loanPayload(loan, form.purchase_date) })).filter((entry) => entry.payload)
      if (!isEdit) propertyPayload.loans = loanPayloads.map((entry) => entry.payload)

      if (isEdit) {
        await propAPI.update(id, propertyPayload)
        for (const loanId of deletedLoanIds) await propAPI.deleteLoan(id, loanId)
        for (const { loan, payload } of loanPayloads) {
          if (loan.id) await propAPI.updateLoan(id, loan.id, payload)
          else await propAPI.addLoan(id, payload)
        }
        toast.success('Property updated')
      } else {
        await propAPI.create(propertyPayload)
        toast.success('Property added')
      }
      navigate('/properties')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl pb-24">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit Property' : 'Add Property'}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Property facts, repeatable loans, taxes, and operating expenses.</p>
        </div>
        <div
          className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          title={`P&I $${moneyRound(liveCost.breakdown.loanPayments).toLocaleString()} + tax $${moneyRound(liveCost.breakdown.propertyTaxMo).toLocaleString()} + insurance $${moneyRound(liveCost.breakdown.insuranceMo).toLocaleString()} + HOA $${moneyRound(liveCost.breakdown.hoaMo).toLocaleString()} + other $${moneyRound(liveCost.breakdown.otherMo).toLocaleString()} = $${moneyRound(liveCost.monthlyOutflow).toLocaleString()}/mo`}
        >
          {liveCost.label}: <span className={`font-semibold ${liveCost.monthly < 0 ? 'text-red-600' : isPrimary ? 'text-gray-900 dark:text-white' : 'text-green-600'}`}>{liveCost.monthly < 0 ? '-' : ''}${moneyRound(Math.abs(liveCost.monthly)).toLocaleString()}</span>
          <p className="text-xs text-gray-400">Annual: {liveCost.annual < 0 ? '-' : ''}${moneyRound(Math.abs(liveCost.annual)).toLocaleString()}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="card">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Property</h2>
            <p className="text-xs text-gray-400">Type is the physical property. Usage controls rental vs primary-residence fields.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <TextInput label="Property Name" value={form.name} onChange={(v) => set('name', v)} />
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.property_type} onChange={(e) => set('property_type', e.target.value)}>
                {PROPERTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-400">Physical type, e.g. single family, condo, duplex.</p>
            </div>
            <div>
              <label className="label">Usage</label>
              <select className="input" value={form.usage_type} onChange={(e) => set('usage_type', e.target.value)}>
                <option value="Primary">Primary</option>
                <option value="Rental">Rental</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">Primary residence or rental/investment use.</p>
            </div>
            <TextInput label="Street Address" value={form.address} onChange={(v) => set('address', v)} placeholder="Address not provided" />
            <TextInput label="City" value={form.city} onChange={(v) => set('city', v)} />
            <TextInput label="State" value={form.state} onChange={(v) => set('state', v)} />
            <TextInput label="ZIP" value={form.zip_code} onChange={(v) => set('zip_code', v)} />
            <div>
              <label className="label">Purchase date</label>
              <input type="date" className="input" value={form.purchase_date || ''} onChange={(e) => set('purchase_date', e.target.value)} />
            </div>
          </div>

          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-700">
            <div className="grid gap-4 md:grid-cols-3">
              <MoneyInput label="Purchase price" value={form.purchase_price} onChange={(v) => set('purchase_price', v)} required error={errors.purchase_price} />
              <MoneyInput label="Down payment" value={form.down_payment} onChange={(v) => set('down_payment', v)} placeholder={suggestedDownPayment ? formatMoney(suggestedDownPayment) : ''} />
              <MoneyInput label="Current value" value={form.market_value} onChange={(v) => set('market_value', v)} />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Suggested down payment: {suggestedDownPayment ? `$${formatMoney(suggestedDownPayment)}` : '$0'} from purchase price minus total original loans. Entered value wins.
              <button type="button" className="ml-2 text-blue-600 hover:underline" onClick={() => set('down_payment', String(moneyRound(suggestedDownPayment)))}>Use suggested</button>
            </p>
          </div>

          {isPrimary ? (
            <div className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              Rental fields hidden — primary residence.
            </div>
          ) : (
            <div className="mt-5 grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-3 dark:border-gray-700">
              <MoneyInput label="Monthly rent" period="/ mo" value={form.monthly_rent} onChange={(v) => set('monthly_rent', v)} />
              <MoneyInput label="Vacancy allowance" period="/ mo" value={form.vacancy_allowance} onChange={(v) => set('vacancy_allowance', v)} />
              <MoneyInput label="Property management" period="/ mo" value={form.property_management_fee} onChange={(v) => set('property_management_fee', v)} />
            </div>
          )}
        </section>

        <section className="card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Loans ({loans.length})</h2>
              <p className="text-xs text-gray-400">Each loan is edited independently. Down payment stays on the property.</p>
            </div>
            <button type="button" className="btn-secondary flex items-center gap-1.5 text-sm" onClick={addLoan}>
              <Plus className="h-4 w-4" /> Add loan
            </button>
          </div>

          <div className="space-y-3">
            {loans.map((loan, index) => {
              const key = String(loan.id || `new-${index}`)
              const expanded = expandedLoans.has(key)
              return (
                <div key={key} className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggleLoan(loan, index)}>
                      {expanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900 dark:text-white">{loan.lender_name || `Loan ${index + 1}`}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {loan.loan_type || 'FIXED'} · {formatMoney(loan.original_amount) ? `$${formatMoney(loan.original_amount)}` : 'No amount'} · {loan.interest_rate || '0'}%
                        </p>
                      </div>
                    </button>
                    <button type="button" className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeLoan(index)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {expanded ? (
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <TextInput label="Loan name / vendor" value={loan.lender_name} onChange={(v) => setLoan(index, 'lender_name', v)} />
                      <div>
                        <label className="label">Loan type</label>
                        <select className="input" value={loan.loan_type || 'FIXED'} onChange={(e) => setLoan(index, 'loan_type', e.target.value)}>
                          {LOAN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Start date</label>
                        <input type="date" className={`input ${errors[`loan_${index}_origination_date`] ? 'border-red-400' : ''}`} value={loan.origination_date || ''} onChange={(e) => setLoan(index, 'origination_date', e.target.value)} />
                        {errors[`loan_${index}_origination_date`] ? <p className="mt-1 text-xs text-red-600">{errors[`loan_${index}_origination_date`]}</p> : null}
                      </div>
                      <MoneyInput label="Original amount" value={loan.original_amount} onChange={(v) => setLoan(index, 'original_amount', v)} error={errors[`loan_${index}_original_amount`]} />
                      <MoneyInput label="Current balance" value={loan.current_balance} onChange={(v) => setLoan(index, 'current_balance', v)} error={errors[`loan_${index}_current_balance`]} />
                      <PercentInput label="Interest rate" value={loan.interest_rate} onChange={(v) => setLoan(index, 'interest_rate', v)} error={errors[`loan_${index}_interest_rate`]} />
                      <MoneyInput label="Monthly P&I" period="/ mo" value={loan.monthly_payment} onChange={(v) => setLoan(index, 'monthly_payment', v)} />
                      <MoneyInput label="Escrow" period="/ mo" value={loan.escrow_amount} onChange={(v) => setLoan(index, 'escrow_amount', v)} />
                      <MoneyInput label="Extra payment" period="/ mo" value={loan.extra_monthly_payment} onChange={(v) => setLoan(index, 'extra_monthly_payment', v)} />
                      <div>
                        <label className="label">Term</label>
                        <input className="input" inputMode="numeric" value={loan.loan_term_years || ''} onChange={(e) => setLoan(index, 'loan_term_years', e.target.value.replace(/[^0-9]/g, ''))} />
                      </div>
                      <label className="mt-7 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <input type="checkbox" checked={Boolean(loan.escrow_included)} onChange={(e) => setLoan(index, 'escrow_included', e.target.checked)} />
                        Escrow included
                      </label>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="card">
          <details open>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Taxes & Expenses</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <MoneyInput label="Property tax" period="/ yr" value={form.property_tax} onChange={(v) => set('property_tax', v)} />
              <MoneyInput label="Insurance" period="/ mo" value={form.insurance} onChange={(v) => set('insurance', v)} />
              <MoneyInput label="HOA" period="/ mo" value={form.hoa_fee} onChange={(v) => set('hoa_fee', v)} />
              <MoneyInput label="HOA special assessment" value={form.hoa_special_assessment} onChange={(v) => set('hoa_special_assessment', v)} />
              <MoneyInput label="Maintenance" period="/ mo" value={form.maintenance} onChange={(v) => set('maintenance', v)} />
              <MoneyInput label="Utilities" period="/ mo" value={form.utilities} onChange={(v) => set('utilities', v)} />
              <MoneyInput label="CapEx reserve" period="/ mo" value={form.capex_reserve} onChange={(v) => set('capex_reserve', v)} />
              <MoneyInput label="Other expenses" period="/ mo" value={form.other_expenses} onChange={(v) => set('other_expenses', v)} />
            </div>
          </details>
        </section>

        <section className="card">
          <details>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Misc / Solar</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="label">Solar</label>
                <select className="input" value={form.solar_ownership || 'None'} onChange={(e) => set('solar_ownership', e.target.value)}>
                  <option value="None">None</option>
                  <option value="Leased">Leased</option>
                  <option value="Purchased">Purchased</option>
                  <option value="Included in Purchase">Included in Purchase</option>
                </select>
              </div>
              {form.solar_ownership === 'Leased' ? (
                <MoneyInput label="Solar lease" period="/ mo" value={form.solar_monthly_payment} onChange={(v) => set('solar_monthly_payment', v)} />
              ) : null}
              {(form.solar_ownership === 'Purchased' || form.solar_ownership === 'Included in Purchase') ? (
                <MoneyInput label="Solar purchase price" value={form.solar_purchase_price} onChange={(v) => set('solar_purchase_price', v)} />
              ) : null}
            </div>
          </details>
        </section>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
          <div className="mx-auto flex max-w-6xl justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" className="btn-primary px-8" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
