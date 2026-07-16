import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { docAPI, propAPI } from '../services/api'

const DEFAULTS = {
  lender_name: '',
  loan_type: 'FIXED',
  original_amount: '',
  current_balance: '',
  interest_rate: '',
  loan_term_years: '30',
  origination_date: '',
  monthly_payment: '',
  escrow_amount: '',
  estimated_total_monthly_payment: '',
  statement_date: '',
}

function cleanDecimal(value) {
  const cleaned = String(value || '').replace(/[^0-9.]/g, '')
  const [first, ...rest] = cleaned.split('.')
  return rest.length ? `${first}.${rest.join('')}` : first
}

function cleanInteger(value) {
  return String(value || '').replace(/[^0-9]/g, '')
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function LoanModal({ propId, loan, onClose, onSaved, onUploadStatement }) {
  const [form, setForm] = useState(() => ({
    ...DEFAULTS,
    ...(loan || {}),
    original_amount: loan?.original_amount ?? '',
    current_balance: loan?.current_balance ?? '',
    interest_rate: loan?.interest_rate ?? '',
    loan_term_years: loan?.loan_term_years ?? '30',
    origination_date: loan?.origination_date ?? '',
    monthly_payment: loan?.monthly_payment ?? '',
    escrow_amount: loan?.escrow_amount ?? '',
    estimated_total_monthly_payment: loan?.estimated_total_monthly_payment ?? '',
    statement_date: loan?.statement_date ?? '',
  }))
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [uploadingStatement, setUploadingStatement] = useState(false)
  const statementInputRef = useRef(null)
  const isEdit = Boolean(loan?.id)

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const validate = () => {
    const next = {}
    if (!form.lender_name.trim()) next.lender_name = 'Loan vendor is required.'
    if (toNumber(form.original_amount) <= 0) next.original_amount = 'Loan amount must be greater than 0.'
    if (form.current_balance !== '' && toNumber(form.current_balance) < 0) next.current_balance = 'Current balance must be 0 or greater.'
    const rate = toNumber(form.interest_rate)
    if (rate <= 0 || rate > 100) next.interest_rate = 'Interest rate must be between 0 and 100.'
    if (toNumber(form.loan_term_years) <= 0) next.loan_term_years = 'Tenure must be greater than 0.'
    if (!form.origination_date) next.origination_date = 'Start date is required.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const buildPayload = () => ({
    lender_name: form.lender_name.trim(),
    loan_product: '',
    loan_type: form.loan_type,
    original_amount: toNumber(form.original_amount),
    current_balance: toNumber(form.current_balance),
    interest_rate: toNumber(form.interest_rate),
    rate_note: '',
    monthly_payment: toNumber(form.monthly_payment),
    estimated_total_monthly_payment: toNumber(form.estimated_total_monthly_payment),
    extra_monthly_payment: 0,
    loan_term_years: Math.max(1, Math.round(toNumber(form.loan_term_years))),
    origination_date: form.origination_date,
    maturity_date: '',
    original_ltv: 0,
    escrow_amount: toNumber(form.escrow_amount),
    escrow_included: toNumber(form.escrow_amount) > 0,
    account_number: '',
    borrowers: '',
    principal_due: 0,
    interest_due: 0,
    statement_date: form.statement_date,
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
  })

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const payload = buildPayload()
      if (isEdit) {
        await propAPI.updateLoan(propId, loan.id, payload)
        toast.success('Loan updated')
      } else {
        await propAPI.addLoan(propId, payload)
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

  const handleStatementFile = async (file) => {
    if (!file) return
    const fd = new FormData()
    fd.append('property_id', propId)
    fd.append('category', 'mortgage_statement')
    fd.append('file', file)
    setUploadingStatement(true)
    try {
      const preview = await docAPI.previewUpload(fd)
      const accepted = await docAPI.acceptUpload({
        pending_upload_id: preview.data.pending_upload_id,
        original_filename: preview.data.original_filename,
        property_id: propId,
        category: preview.data.category || 'mortgage_statement',
        apply_extracted: false,
      })
      const review = await docAPI.loanStatementReview(accepted.data.id)
      const extracted = accepted.data.extracted_data || {}
      const draft = review.data?.statementDraft || {}
      if (isEdit) {
        const selectedFields = (review.data?.loanFields || []).map((field) => field.targetKey)
        const applied = await docAPI.applyLoanStatement(accepted.data.id, {
          property_id: propId,
          loan_id: loan.id,
          selected_loan_fields: selectedFields,
        })
        const updatedLoan = (applied.data?.draft?.loans || []).find((item) => item.id === loan.id)
        if (updatedLoan) {
          setForm((current) => ({
            ...current,
            ...updatedLoan,
            original_amount: updatedLoan.original_amount ?? current.original_amount,
            current_balance: updatedLoan.current_balance ?? current.current_balance,
            interest_rate: updatedLoan.interest_rate ?? current.interest_rate,
            loan_term_years: updatedLoan.loan_term_years ?? current.loan_term_years,
            origination_date: updatedLoan.origination_date ?? current.origination_date,
            monthly_payment: updatedLoan.monthly_payment ?? current.monthly_payment,
            escrow_amount: updatedLoan.escrow_amount ?? current.escrow_amount,
            estimated_total_monthly_payment: updatedLoan.estimated_total_monthly_payment ?? current.estimated_total_monthly_payment,
            statement_date: updatedLoan.statement_date ?? current.statement_date,
          }))
        }
        const estimates = applied.data?.expenseEstimates || {}
        const estimatedParts = [
          estimates.propertyTax?.applied ? `property tax ${estimates.propertyTax.display}` : null,
          estimates.insurance?.applied ? `insurance ${estimates.insurance.display}` : null,
        ].filter(Boolean)
        if (estimatedParts.length) {
          toast.success(`Estimated ${estimates.year} ${estimatedParts.join(' and ')} from escrow — upload your tax bill to confirm.`)
        } else {
          toast.success('Loan statement values applied')
        }
        onSaved()
        return
      }
      setForm((current) => ({
        ...current,
        lender_name: extracted.lender_name || current.lender_name,
        loan_type: extracted.loan_type || current.loan_type,
        original_amount: extracted.original_amount ?? current.original_amount,
        current_balance: draft.current_balance || current.current_balance,
        interest_rate: extracted.interest_rate ?? current.interest_rate,
        loan_term_years: extracted.loan_term_years ?? current.loan_term_years,
        origination_date: extracted.origination_date || current.origination_date,
        monthly_payment: extracted.monthly_payment ?? draft.estimated_total_monthly_payment ?? current.monthly_payment,
        escrow_amount: draft.escrow_amount || current.escrow_amount,
        estimated_total_monthly_payment: draft.estimated_total_monthly_payment || current.estimated_total_monthly_payment,
        statement_date: draft.statement_date || current.statement_date,
      }))
      toast.success('Loan statement values loaded for review')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Statement upload failed')
    } finally {
      setUploadingStatement(false)
      if (statementInputRef.current) statementInputRef.current.value = ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {isEdit ? 'Edit Loan' : 'Add Loan'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter loan basics. Calculations and statement extraction are handled by the backend.
            </p>
          </div>
          <button type="button" className="rounded-md p-2 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <input
            ref={statementInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.xls,.xlsx"
            onChange={(event) => handleStatementFile(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => statementInputRef.current?.click()}
            className="flex w-full items-center justify-between gap-4 rounded-lg border border-dashed border-blue-200 bg-blue-50/70 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-blue-900/70 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
          >
            <span>
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">Upload loan statement</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">Use the document workflow to prefill reported balance, payment, escrow, and statement date.</span>
            </span>
            {uploadingStatement ? (
              <span className="shrink-0 text-xs font-medium text-blue-600 dark:text-blue-400">Uploading...</span>
            ) : (
              <Upload className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
            )}
          </button>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Loan Vendor"
              value={form.lender_name}
              error={errors.lender_name}
              onChange={(value) => set('lender_name', value)}
            />
            <div>
            <label className="label">Loan Type</label>
            <select className="input" value={form.loan_type} onChange={(event) => set('loan_type', event.target.value)}>
              <option value="FIXED">Fixed</option>
              <option value="ARM">ARM</option>
              <option value="HELOC">HELOC</option>
            </select>
          </div>
            <NumericField
              label="Loan Amount"
              value={form.original_amount}
              error={errors.original_amount}
              onChange={(value) => set('original_amount', cleanDecimal(value))}
            />
            <NumericField
              label="Current Balance"
              value={form.current_balance}
              error={errors.current_balance}
              onChange={(value) => set('current_balance', cleanDecimal(value))}
            />
            <NumericField
              label="Payment / mo"
              value={form.monthly_payment}
              onChange={(value) => set('monthly_payment', cleanDecimal(value))}
            />
            <NumericField
              label="Escrow / mo"
              value={form.escrow_amount}
              onChange={(value) => set('escrow_amount', cleanDecimal(value))}
            />
          <NumericField
              label="Interest Rate"
              value={form.interest_rate}
              error={errors.interest_rate}
              onChange={(value) => set('interest_rate', cleanDecimal(value))}
            />
            <NumericField
              label="Tenure (years)"
              value={form.loan_term_years}
              error={errors.loan_term_years}
              onChange={(value) => set('loan_term_years', cleanInteger(value))}
              integer
            />
            <div>
              <label className="label">Start Date</label>
              <input
                className={`input ${errors.origination_date ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
                type="date"
                value={form.origination_date}
                onChange={(event) => set('origination_date', event.target.value)}
              />
              {errors.origination_date && <p className="mt-1 text-xs text-red-600">{errors.origination_date}</p>}
            </div>
            <div>
              <label className="label">Statement Date</label>
              <input
                className="input"
                type="date"
                value={form.statement_date}
                onChange={(event) => set('statement_date', event.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Saving...' : isEdit ? 'Save Loan' : 'Add Loan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TextField({ label, value, error, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className={`input ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function NumericField({ label, value, error, onChange, integer = false }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className={`input ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        pattern={integer ? '[0-9]*' : '[0-9.]*'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
