import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { propAPI } from '../services/api'

const PROPERTY_TYPES = ['Single Family', 'Multi Family', 'Condo', 'Townhouse', 'Commercial']

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
  original_loan_amount: '',
  interest_rate: '',
  loan_date: '',
  loan_type: 'FIXED',
  down_payment: '',
  current_balance: '',
  monthly_payment: '',
}

function toNumber(value) {
  if (value === '' || value == null) return 0
  const parsed = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function moneyRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function monthlyPI(amount, rate, years = 30) {
  const principal = toNumber(amount)
  const months = years * 12
  const monthlyRate = toNumber(rate) / 100 / 12
  if (!principal) return 0
  if (!monthlyRate) return moneyRound(principal / months)
  return moneyRound(principal * (monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1))
}

function paymentsMadeSinceLoanStart(loanDate, today = new Date()) {
  if (!loanDate) return 0
  const start = new Date(`${loanDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return 0
  const firstPayment = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  if (currentMonth < firstPayment) return 0
  return ((currentMonth.getFullYear() - firstPayment.getFullYear()) * 12) + currentMonth.getMonth() - firstPayment.getMonth() + 1
}

function amortizedBalance(amount, downPayment, rate, loanDate, monthlyPayment, years = 30) {
  const principal = toNumber(amount)
  if (!principal) return 0
  const totalMonths = years * 12
  const paidMonths = Math.min(paymentsMadeSinceLoanStart(loanDate), totalMonths)
  if (!paidMonths) return moneyRound(principal)
  const payment = toNumber(monthlyPayment) || monthlyPI(principal, rate, years)
  const monthlyRate = toNumber(rate) / 100 / 12
  const balance = monthlyRate
    ? principal * (1 + monthlyRate) ** paidMonths - payment * (((1 + monthlyRate) ** paidMonths - 1) / monthlyRate)
    : principal - payment * paidMonths
  return moneyRound(Math.max(0, Math.min(principal, balance)))
}

function addYears(dateString, years) {
  if (!dateString) return ''
  const date = new Date(`${dateString}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setFullYear(date.getFullYear() + years)
  return date.toISOString().slice(0, 10)
}

function NumericInput({ label, value, onChange, required = false }) {
  return (
    <div>
      <label className="label">{label}{required ? <span className="text-red-500"> *</span> : null}</label>
      <input
        className="input"
        type="text"
        inputMode="decimal"
        pattern="[0-9.,-]*"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </div>
  )
}

export default function PropertyFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [autoCalc, setAutoCalc] = useState(!isEdit)
  const [primaryLoanId, setPrimaryLoanId] = useState(null)
  const [currentBalanceManual, setCurrentBalanceManual] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    propAPI.get(id)
      .then((r) => {
        const prop = r.data
        const loan = prop.loans?.[0] || {}
        const hasManualCurrentBalance = toNumber(loan.current_balance) > 0
        setPrimaryLoanId(loan.id || null)
        setCurrentBalanceManual(hasManualCurrentBalance)
        setForm({
          ...DEFAULTS,
          ...prop,
          purchase_price: prop.purchase_price || '',
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
          original_loan_amount: loan.original_amount || '',
          interest_rate: loan.interest_rate || '',
          loan_date: loan.origination_date || '',
          loan_type: loan.loan_type || 'FIXED',
          down_payment: loan.down_payment || '',
          current_balance: hasManualCurrentBalance ? loan.current_balance : '',
          monthly_payment: loan.monthly_payment || '',
        })
      })
      .catch(() => toast.error('Failed to load property'))
  }, [id, isEdit])

  const calculated = useMemo(() => {
    const purchasePrice = toNumber(form.purchase_price)
    const originalLoan = toNumber(form.original_loan_amount)
    const monthlyPayment = monthlyPI(originalLoan, form.interest_rate, 30)
    const balanceStartDate = form.loan_date || form.purchase_date
    const scheduledBalance = amortizedBalance(
      originalLoan,
      form.down_payment,
      form.interest_rate,
      balanceStartDate,
      form.monthly_payment || monthlyPayment,
      30
    )
    return {
      down_payment: purchasePrice ? moneyRound(Math.max(0, purchasePrice - originalLoan)) : toNumber(form.down_payment),
      current_balance: currentBalanceManual ? toNumber(form.current_balance) : scheduledBalance,
      monthly_payment: monthlyPayment,
      maturity_date: addYears(balanceStartDate, 30),
    }
  }, [form.purchase_price, form.original_loan_amount, form.interest_rate, form.loan_date, form.purchase_date, form.monthly_payment, form.current_balance, form.down_payment, currentBalanceManual])

  useEffect(() => {
    if (!autoCalc) return
    setForm((current) => ({
      ...current,
      down_payment: calculated.down_payment || '',
      current_balance: currentBalanceManual ? current.current_balance : (calculated.current_balance || ''),
      monthly_payment: calculated.monthly_payment || '',
    }))
  }, [autoCalc, calculated, currentBalanceManual])

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const totalMonthlyExpenses = [
    form.insurance,
    form.maintenance,
    form.property_management_fee,
    form.utilities,
    form.vacancy_allowance,
    form.capex_reserve,
    form.other_expenses,
    form.hoa_fee,
    form.solar_ownership === 'Leased' ? form.solar_monthly_payment : 0,
  ].reduce((sum, value) => sum + toNumber(value), 0) + (toNumber(form.property_tax) / 12) + toNumber(form.hoa_special_assessment)

  const buildPropertyPayload = () => ({
    name: form.name || undefined,
    address: form.address || 'Address not provided',
    city: form.city,
    state: form.state,
    zip_code: form.zip_code,
    property_type: form.property_type,
    usage_type: form.usage_type,
    purchase_date: form.purchase_date,
    purchase_price: toNumber(form.purchase_price),
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
    land_value: 0,
    construction_price: 0,
    depreciation_years: form.property_type === 'Commercial' ? 39 : 27.5,
  })

  const buildLoanPayload = () => {
    const loanAmount = toNumber(form.original_loan_amount)
    if (loanAmount <= 0) return null
    const monthlyPayment = toNumber(form.monthly_payment || calculated.monthly_payment)
    return {
      lender_name: '',
      loan_type: form.loan_type,
      original_amount: loanAmount,
      current_balance: toNumber(form.current_balance || calculated.current_balance),
      interest_rate: toNumber(form.interest_rate),
      monthly_payment: monthlyPayment,
      estimated_total_monthly_payment: monthlyPayment,
      loan_term_years: 30,
      origination_date: form.loan_date || form.purchase_date,
      maturity_date: calculated.maturity_date,
      escrow_amount: 0,
      down_payment: toNumber(form.down_payment || calculated.down_payment),
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const propertyPayload = buildPropertyPayload()
      const loanPayload = buildLoanPayload()
      if (!isEdit && loanPayload) propertyPayload.loans = [loanPayload]

      if (isEdit) {
        await propAPI.update(id, propertyPayload)
        if (loanPayload) {
          if (primaryLoanId) {
            await propAPI.updateLoan(id, primaryLoanId, loanPayload)
          } else {
            const { data } = await propAPI.addLoan(id, loanPayload)
            setPrimaryLoanId(data.id || null)
          }
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
    <div className="mx-auto max-w-6xl">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit Property' : 'Add Property'}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Core property, rent, expense, loan, HOA, and solar details in one pass.</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          Monthly expenses: <span className="font-semibold">${moneyRound(totalMonthlyExpenses).toLocaleString()}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Property</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Property Name</label>
              <input className="input" value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Property Type</label>
              <select className="input" value={form.property_type} onChange={(e) => set('property_type', e.target.value)}>
                {PROPERTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Street Address</label>
              <input className="input" value={form.address || ''} onChange={(e) => set('address', e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={form.state || ''} onChange={(e) => set('state', e.target.value)} />
            </div>
            <div>
              <label className="label">ZIP</label>
              <input className="input" value={form.zip_code || ''} onChange={(e) => set('zip_code', e.target.value)} />
            </div>
            <div>
              <label className="label">Usage</label>
              <select className="input" value={form.usage_type} onChange={(e) => set('usage_type', e.target.value)}>
                <option value="Rental">Rental</option>
                <option value="Primary">Primary</option>
              </select>
            </div>
            <div>
              <label className="label">Purchase Date</label>
              <input type="date" className="input" value={form.purchase_date || ''} onChange={(e) => set('purchase_date', e.target.value)} />
            </div>
            <NumericInput label="Purchase Price" value={form.purchase_price} onChange={(v) => set('purchase_price', v)} required />
            <NumericInput label="Current Market Value" value={form.market_value} onChange={(v) => set('market_value', v)} />
            <NumericInput label="Monthly Rent" value={form.monthly_rent} onChange={(v) => set('monthly_rent', v)} />
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Loan</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Calculated from loan amount, rate, and loan date.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={autoCalc} onChange={(e) => setAutoCalc(e.target.checked)} />
              Auto calculate
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericInput label="Original Loan Amount" value={form.original_loan_amount} onChange={(v) => set('original_loan_amount', v)} />
            <NumericInput label="Interest Rate" value={form.interest_rate} onChange={(v) => set('interest_rate', v)} />
            <div>
              <label className="label">Loan Date</label>
              <input type="date" className="input" value={form.loan_date || ''} onChange={(e) => set('loan_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Loan Type</label>
              <select className="input" value={form.loan_type} onChange={(e) => set('loan_type', e.target.value)}>
                <option value="FIXED">Fixed</option>
                <option value="ARM">ARM</option>
              </select>
            </div>
            <NumericInput label="Down Payment" value={form.down_payment} onChange={(v) => set('down_payment', v)} />
            <NumericInput
              label="Current Balance"
              value={form.current_balance}
              onChange={(v) => {
                setCurrentBalanceManual(v !== '')
                set('current_balance', v)
              }}
            />
            <NumericInput label="Monthly Principal & Interest" value={form.monthly_payment} onChange={(v) => set('monthly_payment', v)} />
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-950/20 dark:text-blue-200">
              <p className="font-medium">Calculated</p>
              <p>Payment: ${calculated.monthly_payment.toLocaleString()}</p>
              <p>Down payment: ${Number(calculated.down_payment || 0).toLocaleString()}</p>
              <p>Maturity: {calculated.maturity_date || '—'}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Taxes & Expenses</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericInput label="Property Taxes" value={form.property_tax} onChange={(v) => set('property_tax', v)} />
            <NumericInput label="Insurance / Month" value={form.insurance} onChange={(v) => set('insurance', v)} />
            <NumericInput label="Maintenance / Month" value={form.maintenance} onChange={(v) => set('maintenance', v)} />
            <NumericInput label="Property Management / Month" value={form.property_management_fee} onChange={(v) => set('property_management_fee', v)} />
            <NumericInput label="Utilities / Month" value={form.utilities} onChange={(v) => set('utilities', v)} />
            <NumericInput label="Vacancy Allowance / Month" value={form.vacancy_allowance} onChange={(v) => set('vacancy_allowance', v)} />
            <NumericInput label="CapEx Reserve / Month" value={form.capex_reserve} onChange={(v) => set('capex_reserve', v)} />
            <NumericInput label="Other Expenses / Month" value={form.other_expenses} onChange={(v) => set('other_expenses', v)} />
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Misc</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericInput label="HOA / Month" value={form.hoa_fee} onChange={(v) => set('hoa_fee', v)} />
            <NumericInput label="HOA Special Assessment" value={form.hoa_special_assessment} onChange={(v) => set('hoa_special_assessment', v)} />
            <div>
              <label className="label">Solar</label>
              <select className="input" value={form.solar_ownership || 'None'} onChange={(e) => set('solar_ownership', e.target.value)}>
                <option value="None">None</option>
                <option value="Leased">Leased</option>
                <option value="Purchased">Purchased</option>
                <option value="Included in Purchase">Included in Purchase</option>
              </select>
            </div>
            {form.solar_ownership === 'Leased' && (
              <NumericInput label="Solar Lease / Month" value={form.solar_monthly_payment} onChange={(v) => set('solar_monthly_payment', v)} />
            )}
            {(form.solar_ownership === 'Purchased' || form.solar_ownership === 'Included in Purchase') && (
              <NumericInput label="Solar Purchase Price" value={form.solar_purchase_price} onChange={(v) => set('solar_purchase_price', v)} />
            )}
          </div>
        </div>

        <div className="flex gap-3 lg:col-span-2">
          <button type="submit" className="btn-primary px-8" disabled={loading}>{loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Property'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
