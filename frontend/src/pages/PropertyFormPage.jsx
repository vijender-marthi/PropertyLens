import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { propAPI } from '../services/api'
import toast from 'react-hot-toast'
import { ChevronLeft } from 'lucide-react'

const PROPERTY_TYPES = ['Single Family', 'Multi Family', 'Condo', 'Townhouse', 'Commercial']

const FIELDS = {
  'Basic Info': [
    { key: 'name', label: 'Property Name', required: true, colSpan: 2 },
    { key: 'address', label: 'Street Address', required: true, colSpan: 2 },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip_code', label: 'ZIP Code' },
    { key: 'property_type', label: 'Property Type', type: 'select', options: PROPERTY_TYPES },
    { key: 'usage_type', label: 'Usage', type: 'select', options: ['Rental', 'Primary'] },
    { key: 'purchase_date', label: 'Purchase Date', type: 'date' },
    { key: 'purchase_price', label: 'Purchase Price ($)', type: 'number' },
    { key: 'market_value', label: 'Current Market Value ($)', type: 'number' },
  ],
  'Rental Income': [
    { key: 'monthly_rent', label: 'Monthly Rent ($)', type: 'number' },
    { key: 'occupancy_rate', label: 'Occupancy Rate (%)', type: 'number' },
  ],
  'Monthly Expenses': [
    { key: 'property_tax', label: 'Annual Property Tax ($)', type: 'number' },
    { key: 'insurance', label: 'Annual Insurance ($)', type: 'number' },
    { key: 'hoa_fee', label: 'HOA Fee/mo ($)', type: 'number' },
    { key: 'hoa_special_assessment', label: 'HOA Special Assessment ($)', type: 'number' },
    { key: 'maintenance', label: 'Repairs & Maintenance/mo ($)', type: 'number' },
    { key: 'property_management_fee', label: 'Property Mgmt/mo ($)', type: 'number' },
    { key: 'utilities', label: 'Utilities/mo ($)', type: 'number' },
    { key: 'vacancy_allowance', label: 'Vacancy Allowance/mo ($)', type: 'number' },
    { key: 'capex_reserve', label: 'CapEx Reserve/mo ($)', type: 'number' },
    { key: 'other_expenses', label: 'Other Expenses/mo ($)', type: 'number' },
  ],
  'Solar': [
    { key: 'solar_ownership', label: 'Solar Ownership', type: 'select', options: ['None', 'Leased', 'Purchased', 'Included in Purchase'] },
    { key: 'solar_monthly_payment', label: 'Solar Lease/mo ($)', type: 'number' },
    { key: 'solar_purchase_price', label: 'Solar Purchase Price ($)', type: 'number' },
  ],
'Depreciation': [
{ key: 'land_value', label: 'Land Value ($)', type: 'number' },
{ key: 'construction_price', label: 'Construction Cost ($)', type: 'number' },
{ key: 'depreciation_years', label: 'Depreciation Period (yrs)', type: 'number' },
],
}

const DEFAULTS = {
  name: '', address: '', city: '', state: '', zip_code: '',
  property_type: 'Single Family', usage_type: 'Rental', purchase_date: '',
  purchase_price: 0, market_value: 0,
  monthly_rent: 0, occupancy_rate: 100,
  property_tax: 0, insurance: 0, hoa_fee: 0, hoa_history: '[]', hoa_special_assessment: 0,
  solar_ownership: 'None', solar_monthly_payment: 0, solar_purchase_price: 0,
  maintenance: 0, property_management_fee: 0,
utilities: 0, vacancy_allowance: 0, capex_reserve: 0, other_expenses: 0,
  land_value: 0, construction_price: 0, depreciation_years: 27.5,
}

const parseHoaHistory = (value) => {
  if (Array.isArray(value)) return value
  try {
    const rows = JSON.parse(value || '[]')
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

const serializeHoaHistory = (rows) => JSON.stringify(
  rows
    .map((r) => ({
      year: parseInt(r.year, 10),
      monthly_fee: parseFloat(r.monthly_fee) || 0,
    }))
    .filter((r) => r.year && r.monthly_fee >= 0)
)

export default function PropertyFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isEdit) {
      propAPI.get(id).then((r) => {
        const d = r.data
        setForm({ ...DEFAULTS, ...d })
      }).catch(() => toast.error('Failed to load property'))
    }
  }, [id])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
  const payload = form.usage_type === 'Primary'
    ? { ...form, monthly_rent: 0, hoa_history: serializeHoaHistory(parseHoaHistory(form.hoa_history)) }
    : { ...form, hoa_history: serializeHoaHistory(parseHoaHistory(form.hoa_history)) }
    try {
      if (isEdit) {
        await propAPI.update(id, payload)
        toast.success('Property updated')
        navigate(`/properties/${id}`)
      } else {
        const { data } = await propAPI.create(payload)
        toast.success('Property added')
        navigate(`/properties/${data.id}`)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))
  const hoaRows = parseHoaHistory(form.hoa_history)
  const setHoaRows = (rows) => set('hoa_history', JSON.stringify(rows))

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm mb-4">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        {isEdit ? 'Edit Property' : 'Add Property'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {Object.entries(FIELDS)
          .filter(([section]) => !(section === 'Rental Income' && form.usage_type === 'Primary'))
          .map(([section, fields]) => (
          <div key={section} className="card">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{section}</h2>
            <div className="grid grid-cols-2 gap-4">
              {fields.map(({ key, label, type = 'text', required, colSpan, options }) => (
                <div key={key} className={colSpan === 2 ? 'col-span-2' : ''}>
                  <label className="label">{label}</label>
                  {type === 'select' ? (
                    <select
                      className="input"
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value)}
                    >
                      {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={type}
                      className="input"
                      value={form[key]}
                      onChange={(e) => set(key, type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                      required={required}
                      step={type === 'number' ? 'any' : undefined}
                    />
                  )}
                </div>
              ))}
            </div>
            </div>
          ))}

        <div className="card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 dark:text-white">HOA History</h2>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setHoaRows([...hoaRows, { year: new Date().getFullYear(), monthly_fee: form.hoa_fee || 0 }])}
            >
              Add Year
            </button>
          </div>
          <div className="space-y-3">
            {hoaRows.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">No HOA history yet.</p>
            ) : hoaRows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-3">
                <input
                  type="number"
                  className="input"
                  placeholder="Year"
                  value={row.year || ''}
                  onChange={(e) => {
                    const next = [...hoaRows]
                    next[idx] = { ...next[idx], year: e.target.value }
                    setHoaRows(next)
                  }}
                />
                <input
                  type="number"
                  className="input"
                  placeholder="Monthly HOA"
                  value={row.monthly_fee || ''}
                  onChange={(e) => {
                    const next = [...hoaRows]
                    next[idx] = { ...next[idx], monthly_fee: e.target.value }
                    setHoaRows(next)
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary px-3"
                  onClick={() => setHoaRows(hoaRows.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary px-8" disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Property'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
