import { useState, useEffect } from 'react'
import { propAPI } from '../services/api'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'

const DEFAULTS = {
  lender_name: '', loan_type: 'FIXED',
  original_amount: 0, current_balance: 0,
  interest_rate: 0, rate_note: '', monthly_payment: 0,
  loan_term_years: 30, origination_date: '',
  maturity_date: '', escrow_amount: 0, down_payment: 0,
  account_number: '', borrowers: '',
  principal_due: null, interest_due: null,
  statement_date: '', payment_due_date: '',
  arm_initial_period: 5, arm_adjustment_period: 1,
  arm_cap: 0, arm_margin: 2.75, arm_index: 'SOFR',
}

export default function LoanModal({ propId, loan, onClose, onSaved }) {
  const [form, setForm] = useState(loan ? { ...DEFAULTS, ...loan } : DEFAULTS)
  const [loading, setLoading] = useState(false)
  const isEdit = Boolean(loan?.id)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const num = (k) => (e) => set(k, parseFloat(e.target.value) || 0)
  const str = (k) => (e) => set(k, e.target.value)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEdit) {
        await propAPI.updateLoan(propId, loan.id, form)
        toast.success('Loan updated')
      } else {
        await propAPI.addLoan(propId, form)
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

  const F = ({ label, k, type = 'text', step }) => (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={form[k] ?? ''}
        onChange={type === 'number' ? num(k) : str(k)}
        step={step || (type === 'number' ? 'any' : undefined)} />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-gray-900/80 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{isEdit ? 'Edit Loan' : 'Add Loan'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 dark:text-gray-500" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <F label="Lender Name" k="lender_name" />
            <div>
              <label className="label">Loan Type</label>
              <select className="input" value={form.loan_type} onChange={str('loan_type')}>
                <option value="FIXED">Fixed Rate</option>
                <option value="ARM">Adjustable Rate (ARM)</option>
              </select>
            </div>
            <F label="Original Amount ($)" k="original_amount" type="number" />
            <F label="Current Balance ($)" k="current_balance" type="number" />
            <F label="Interest Rate (%)" k="interest_rate" type="number" step="0.001" />
            <F label="Rate Note (e.g. ARM intro period)" k="rate_note" />
            <F label="Monthly Principal & Interest Payment ($)" k="monthly_payment" type="number" />
            <F label="Loan Term (years)" k="loan_term_years" type="number" />
            <F label="Escrow/mo ($)" k="escrow_amount" type="number" />
            <F label="Down Payment ($)" k="down_payment" type="number" />
            <F label="Origination Date" k="origination_date" type="date" />
            <F label="Maturity Date" k="maturity_date" />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Statement Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <F label="Account Number" k="account_number" />
              <F label="Borrowers" k="borrowers" />
              <F label="Principal Portion ($)" k="principal_due" type="number" />
              <F label="Interest Portion ($)" k="interest_due" type="number" />
              <F label="Statement Date" k="statement_date" />
              <F label="Payment Due Date" k="payment_due_date" />
            </div>
          </div>

          {form.loan_type === 'ARM' && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">ARM Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <F label="Initial Period (yrs)" k="arm_initial_period" type="number" />
                <F label="Adjustment Period (yrs)" k="arm_adjustment_period" type="number" />
                <F label="Rate Cap (%)" k="arm_cap" type="number" step="0.001" />
                <F label="Margin (%)" k="arm_margin" type="number" step="0.001" />
                <div>
                  <label className="label">Index</label>
                  <select className="input" value={form.arm_index} onChange={str('arm_index')}>
                    <option value="SOFR">SOFR</option>
                    <option value="LIBOR">LIBOR</option>
                    <option value="CMT">CMT</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary px-8" disabled={loading}>
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Loan'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
