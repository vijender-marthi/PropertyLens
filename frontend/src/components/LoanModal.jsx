import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { propAPI } from '../services/api'

const DEFAULTS = {
  lender_name: '',
  loan_product: '',
  loan_type: 'FIXED',
  original_amount: 0,
  current_balance: 0,
  interest_rate: 0,
  rate_note: '',
  monthly_payment: 0,
  estimated_total_monthly_payment: 0,
  loan_term_years: 30,
  origination_date: '',
  maturity_date: '',
  original_ltv: 0,
  escrow_amount: 0,
  escrow_included: false,
  down_payment: 0,
  account_number: '',
  borrowers: '',
  principal_due: 0,
  interest_due: 0,
  statement_date: '',
  payment_due_date: '',
  mortgage_tenure_covered: '',
  interest_paid_ytd: 0,
  principal_paid_ytd: 0,
  projected_principal_fy: 0,
  projected_interest_fy: 0,
  arm_initial_period: 5,
  arm_adjustment_period: 1,
  arm_cap: 0,
  arm_margin: 2.75,
  arm_index: 'SOFR',
}

const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
}).format(Number(value) || 0)

function toNumber(value) {
  if (value === '' || value == null) return 0
  const parsed = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function monthlyPI(principal, annualRate, years) {
  const amount = toNumber(principal)
  const months = Math.max(1, Math.round(toNumber(years) * 12))
  const monthlyRate = toNumber(annualRate) / 100 / 12
  if (!amount || !months) return 0
  if (!monthlyRate) return roundMoney(amount / months)
  return roundMoney(amount * (monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1))
}

function addYears(dateString, years) {
  if (!dateString) return ''
  const date = new Date(`${dateString}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setFullYear(date.getFullYear() + Number(years || 0))
  return date.toISOString().slice(0, 10)
}

function firstPaymentSplit(balance, annualRate, monthlyPayment) {
  const interest = roundMoney(toNumber(balance) * (toNumber(annualRate) / 100 / 12))
  const principal = roundMoney(Math.max(0, toNumber(monthlyPayment) - interest))
  return { principal, interest }
}

export default function LoanModal({ propId, property, loan, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...DEFAULTS, ...(loan || {}) }))
  const [loading, setLoading] = useState(false)
  const [autoCalc, setAutoCalc] = useState(!loan?.id)
  const isEdit = Boolean(loan?.id)

  const calculated = useMemo(() => {
    const purchasePrice = toNumber(property?.purchase_price)
    const originalAmount = toNumber(form.original_amount)
    const payment = monthlyPI(form.original_amount, form.interest_rate, form.loan_term_years)
    const split = firstPaymentSplit(form.current_balance || form.original_amount, form.interest_rate, payment)
    return {
      monthly_payment: payment,
      principal_due: split.principal,
      interest_due: split.interest,
      estimated_total_monthly_payment: roundMoney(payment + toNumber(form.escrow_amount)),
      maturity_date: addYears(form.origination_date, form.loan_term_years),
      down_payment: purchasePrice ? roundMoney(Math.max(0, purchasePrice - originalAmount)) : form.down_payment,
      original_ltv: purchasePrice ? roundMoney((originalAmount / purchasePrice) * 100) : form.original_ltv,
    }
  }, [
    property?.purchase_price,
    form.original_amount,
    form.current_balance,
    form.interest_rate,
    form.loan_term_years,
    form.origination_date,
    form.escrow_amount,
    form.down_payment,
    form.original_ltv,
  ])

  useEffect(() => {
    if (!autoCalc) return
    setForm((current) => ({
      ...current,
      ...calculated,
      current_balance: current.current_balance || current.original_amount,
    }))
  }, [autoCalc, calculated])

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const setNumeric = (key) => (event) => {
    set(key, event.target.value)
  }

  const setString = (key) => (event) => {
    set(key, event.target.value)
  }

  const payload = () => {
    const numericFields = [
      'original_amount',
      'current_balance',
      'interest_rate',
      'monthly_payment',
      'estimated_total_monthly_payment',
      'loan_term_years',
      'original_ltv',
      'escrow_amount',
      'down_payment',
      'principal_due',
      'interest_due',
      'interest_paid_ytd',
      'principal_paid_ytd',
      'projected_principal_fy',
      'projected_interest_fy',
      'arm_initial_period',
      'arm_adjustment_period',
      'arm_cap',
      'arm_margin',
    ]
    const data = { ...form }
    numericFields.forEach((field) => {
      data[field] = toNumber(data[field])
    })
    data.loan_term_years = Math.max(1, Math.round(data.loan_term_years || 30))
    return data
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    try {
      const data = payload()
      if (isEdit) {
        await propAPI.updateLoan(propId, loan.id, data)
        toast.success('Loan updated')
      } else {
        await propAPI.addLoan(propId, data)
        toast.success('Loan added')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  const applyCalculated = () => {
    setForm((current) => ({
      ...current,
      ...calculated,
      current_balance: current.current_balance || current.original_amount,
    }))
    setAutoCalc(true)
  }

  const Field = ({ label, name, type = 'text', step, children }) => (
    <div>
      <label className="label">{label}</label>
      {children || (
        <input
          className="input"
          type={type === 'number' ? 'text' : type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          pattern={type === 'number' ? '[0-9.,-]*' : undefined}
          value={form[name] ?? ''}
          step={step}
          onChange={type === 'number' ? setNumeric(name) : setString(name)}
        />
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {isEdit ? 'Edit Loan' : 'Add Loan'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Principal, interest, payment, and maturity calculate from amount, rate, term, and origination date.
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="Close loan form">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-blue-900 dark:text-blue-100">Calculated loan values</h3>
                <p className="text-sm text-blue-700 dark:text-blue-200">
                  Monthly P&I {money(calculated.monthly_payment)} · Principal {money(calculated.principal_due)} · Interest {money(calculated.interest_due)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-gray-900 dark:text-blue-200">
                  <input
                    type="checkbox"
                    checked={autoCalc}
                    onChange={(event) => setAutoCalc(event.target.checked)}
                  />
                  Auto calculate
                </label>
                <button type="button" className="btn-secondary text-sm" onClick={applyCalculated}>
                  Apply calculated
                </button>
              </div>
            </div>
          </div>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Loan Details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Lender Name" name="lender_name" />
              <Field label="Loan Product" name="loan_product" />
              <div>
                <label className="label">Loan Type</label>
                <select className="input" value={form.loan_type} onChange={setString('loan_type')}>
                  <option value="FIXED">Fixed Rate</option>
                  <option value="ARM">Adjustable Rate (ARM)</option>
                </select>
              </div>
              <Field label="Rate Note" name="rate_note" />
              <Field label="Original Loan Amount ($)" name="original_amount" type="number" />
              <Field label="Current Balance ($)" name="current_balance" type="number" />
              <Field label="Interest Rate (%)" name="interest_rate" type="number" />
              <Field label="Loan Term (years)" name="loan_term_years" type="number" />
              <Field label="Origination Date" name="origination_date" type="date" />
              <Field label="Maturity Date" name="maturity_date" type="date" />
              <Field label="Escrow/mo ($)" name="escrow_amount" type="number" />
              <Field label="Down Payment ($)" name="down_payment" type="number" />
              <Field label="Original LTV (%)" name="original_ltv" type="number" />
              <label className="flex items-center gap-2 pt-6 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={Boolean(form.escrow_included)}
                  onChange={(event) => set('escrow_included', event.target.checked)}
                />
                Escrow included
              </label>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Payment Breakdown</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monthly Principal & Interest ($)" name="monthly_payment" type="number" />
              <Field label="Estimated Total Monthly Payment ($)" name="estimated_total_monthly_payment" type="number" />
              <Field label="Principal Portion ($)" name="principal_due" type="number" />
              <Field label="Interest Portion ($)" name="interest_due" type="number" />
              <Field label="Account Number" name="account_number" />
              <Field label="Borrowers" name="borrowers" />
              <Field label="Statement Date" name="statement_date" type="date" />
              <Field label="Payment Due Date" name="payment_due_date" type="date" />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Year-to-Date / Projection</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mortgage Tenure Covered" name="mortgage_tenure_covered" />
              <Field label="Interest Paid YTD ($)" name="interest_paid_ytd" type="number" />
              <Field label="Principal Paid YTD ($)" name="principal_paid_ytd" type="number" />
              <Field label="Projected Principal FY ($)" name="projected_principal_fy" type="number" />
              <Field label="Projected Interest FY ($)" name="projected_interest_fy" type="number" />
            </div>
          </section>

          {form.loan_type === 'ARM' && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">ARM Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Initial Period (yrs)" name="arm_initial_period" type="number" />
                <Field label="Adjustment Period (yrs)" name="arm_adjustment_period" type="number" />
                <Field label="Rate Cap (%)" name="arm_cap" type="number" />
                <Field label="Margin (%)" name="arm_margin" type="number" />
                <div>
                  <label className="label">Index</label>
                  <select className="input" value={form.arm_index} onChange={setString('arm_index')}>
                    <option value="SOFR">SOFR</option>
                    <option value="LIBOR">LIBOR</option>
                    <option value="CMT">CMT</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </section>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary px-8" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Loan'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
