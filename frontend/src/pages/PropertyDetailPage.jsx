import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { propAPI, docAPI } from '../services/api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area
} from 'recharts'
import {
  ChevronLeft, ChevronDown, Pencil, Trash2, Plus, Upload,
  FileText, RefreshCw, Calculator, Building2, Home, X, Download, Info
} from 'lucide-react'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { utils, writeFile } from 'xlsx'
import DocumentUpload from '../components/DocumentUpload'
import LoanCard from '../components/LoanCard'
import LoanModal from '../components/LoanModal'
import AmortizationModal from '../components/AmortizationModal'
import { propertyLabel, shortPropertyUid } from '../utils/propertyDisplay'

const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
const fmtPct = (n) => `${(n || 0).toFixed(2)}%`

export default function PropertyDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [prop, setProp] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLoanModal, setShowLoanModal] = useState(false)
  const [editLoan, setEditLoan] = useState(null)
  const [showAmortization, setShowAmortization] = useState(null)
  const [refreshingValue, setRefreshingValue] = useState(false)
  const [activeTab, setActiveTab] = useState('summary')
  const [showAddress, setShowAddress] = useState(false)

  const loadData = async () => {
    try {
      const [propRes, metricsRes, docsRes] = await Promise.all([
        propAPI.get(id),
        propAPI.metrics(id),
        docAPI.list(id),
      ])
      setProp(propRes.data)
      setMetrics(metricsRes.data)
      setDocs(docsRes.data)
    } catch {
      toast.error('Failed to load property')
      navigate('/properties')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [id])

  const exportPropertyXLS = () => {
    const wb = utils.book_new()

    // Sheet 1: Summary — property details + current metrics
    const summaryRows = [
      ['PropertyLens — Property Export'],
      [],
      ['PROPERTY DETAILS'],
      ['Property Name',     propertyLabel(prop)],
      ['Property ID',       prop.property_uid],
      ['City',              prop.city],
      ['State',             prop.state],
      ['ZIP',               prop.zip_code],
      ['Property Type',     prop.property_type],
      ['Usage',             prop.usage_type || 'Rental'],
      ['Purchase Date',     prop.purchase_date],
      ['Purchase Price',    prop.purchase_price],
      ['Market Value',      prop.market_value],
      ['Land Value',        prop.land_value],
      ['Depreciation Period (yrs)', prop.depreciation_years],
      [],
      ['RENTAL INCOME'],
      ['Monthly Rent',      prop.monthly_rent],
      ['Occupancy Rate (%)', prop.occupancy_rate],
      ['Effective Monthly Rent', metrics?.effective_rent],
      [],
      ['MONTHLY EXPENSES'],
      ['Property Tax (annual)', prop.property_tax],
      ['Insurance (annual)', prop.insurance],
      ['HOA Fee',           prop.hoa_fee],
      ['HOA Special Assessment', prop.hoa_special_assessment],
      ['Solar Ownership',   prop.solar_ownership],
      ['Solar Lease/mo',    prop.solar_monthly_payment],
      ['Solar Purchase Price', prop.solar_purchase_price],
      ['Maintenance',       prop.maintenance],
      ['Property Mgmt Fee', prop.property_management_fee],
      ['Utilities',         prop.utilities],
      ['Vacancy Allowance', prop.vacancy_allowance],
      ['CapEx Reserve',     prop.capex_reserve],
      ['Other Expenses',    prop.other_expenses],
      [],
      ['CURRENT METRICS'],
      ['Monthly Cash Flow', metrics?.monthly_cash_flow],
      ['Annual Cash Flow',  metrics?.annual_cash_flow],
      ['Annual NOI',        metrics?.annual_noi],
      ['Cap Rate (%)',       metrics?.cap_rate],
      ['Gross Yield (%)',    metrics?.gross_yield],
      ['Total Loan Balance', metrics?.total_loan_balance],
      ['Equity',            metrics?.equity],
      ['Annual Depreciation', metrics?.annual_depreciation],
    ]
    const ws1 = utils.aoa_to_sheet(summaryRows)
    ws1['!cols'] = [{ wch: 30 }, { wch: 20 }]
    utils.book_append_sheet(wb, ws1, 'Summary')

    // Sheet 2: Loans
    if (prop.loans?.length) {
      const loanHeader = ['Lender', 'Type', 'Original Amount', 'Current Balance',
        'Interest Rate (%)', 'Monthly Payment', 'Term (yrs)', 'Origination Date',
        'Maturity Date', 'Escrow (mo)', 'Interest Due', 'Principal Due']
      const loanRows = prop.loans.map(l => [
        l.lender_name, l.loan_type, l.original_amount, l.current_balance,
        l.interest_rate, l.monthly_payment, l.loan_term_years,
        l.origination_date, l.maturity_date, l.escrow_amount,
        l.interest_due, l.principal_due,
      ])
      const ws2 = utils.aoa_to_sheet([loanHeader, ...loanRows])
      ws2['!cols'] = loanHeader.map(() => ({ wch: 18 }))
      utils.book_append_sheet(wb, ws2, 'Loans')
    }

    const addr = propertyLabel(prop).replace(/[^a-z0-9]/gi, '_').slice(0, 20)
    writeFile(wb, `propertylens_${addr}.xlsx`)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this property? This cannot be undone.')) return
    await propAPI.delete(id)
    toast.success('Property deleted')
    navigate('/properties')
  }

  const handleRefreshValue = async () => {
    setRefreshingValue(true)
    const { data } = await propAPI.refreshValue(id)
    if (data.value) {
      toast.success(`Market value updated: ${fmt(data.value)} (${data.source})`)
      loadData()
    } else {
      toast(data.message || 'No value returned. Configure ZILLOW_API_KEY.', { icon: 'ℹ️' })
    }
    setRefreshingValue(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const TABS = ['summary', 'details', 'loans', 'rental', 'taxes', 'documents', 'raw data', 'verify', 'scenarios']

  return (
<div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => navigate('/properties')} className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm mb-2">
            <ChevronLeft className="w-4 h-4" /> Properties
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate">{propertyLabel(prop)}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            ID {shortPropertyUid(prop)} · {prop.city}, {prop.state} · {prop.property_type} ·{' '}
            <span className={prop.usage_type === 'Primary' ? 'badge-yellow' : 'badge-green'}>
              {prop.usage_type === 'Primary' ? 'Primary Home' : 'Rental'}
            </span>
          </p>
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAddress((v) => !v)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {showAddress ? 'Hide address' : 'Show address'}
            </button>
            {showAddress ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{prop.address}</p>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <button onClick={exportPropertyXLS} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <Link to={`/properties/${id}/edit`} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Link>
          <button onClick={handleDelete} className="btn-danger flex items-center gap-1.5 text-sm">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPI label="Monthly Cash Flow" value={fmt(metrics?.monthly_cash_flow)} color={metrics?.monthly_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'} />
        <KPI label="Annual Cash Flow" value={fmt(metrics?.annual_cash_flow)} color={metrics?.annual_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'} />
        <KPI label="Market Value" value={fmt(prop.market_value)} action={
          <button onClick={handleRefreshValue} disabled={refreshingValue} className="text-blue-500 hover:text-blue-700">
            <RefreshCw className={`w-3 h-3 ${refreshingValue ? 'animate-spin' : ''}`} />
          </button>
        } />
        <KPI label="Equity" value={fmt(metrics?.equity)} />
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-1 sm:gap-4 overflow-x-auto no-scrollbar -mb-px">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pb-3 px-1 sm:px-0 text-sm font-medium capitalize border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>


      {/* Details */}
      {activeTab === 'details' && (
        <DetailsEditTab prop={prop} propId={id} onSaved={loadData} />
      )}

      {/* Loans */}
      {activeTab === 'loans' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-gray-900 dark:text-white">Loans ({prop.loans?.length || 0})</h3>
            <button onClick={() => { setEditLoan(null); setShowLoanModal(true) }}
              className="btn-primary flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> Add Loan
            </button>
          </div>
          {prop.loans?.map((loan) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              onEdit={() => { setEditLoan(loan); setShowLoanModal(true) }}
              onAmortize={() => setShowAmortization(loan)}
              onDeleted={loadData}
              propId={id}
            />
          ))}
          {prop.loans?.length === 0 && (
            <div className="text-center py-12 card">
              <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 dark:text-gray-500">No loans added yet</p>
            </div>
          )}
        </div>
      )}

      {/* Rental */}
      {activeTab === 'rental' && (
        <RentalTab propId={id} />
      )}

      {/* Taxes */}
      {activeTab === 'taxes' && (
        <TaxesTab propId={id} property={prop} />
      )}

      {/* Documents */}
      {activeTab === 'documents' && (
        <DocumentUpload propertyId={id} docs={docs} onUploaded={loadData} />
      )}

      {activeTab === 'raw data' && (
        <ExtractedRawDataTab propId={id} prop={prop} docs={docs} />
      )}

      {/* Scenarios */}
      {activeTab === 'scenarios' && (
        <ScenariosTab prop={prop} propId={id} />
      )}

      {/* Summary */}
      {activeTab === 'verify' && (
        <RawDataTab propId={id} prop={prop} />
      )}
      {activeTab === 'summary' && (
        <SummaryTab propId={id} prop={prop} metrics={metrics} />
      )}

      {/* Modals */}
      {showLoanModal && (
        <LoanModal
          propId={id}
          loan={editLoan}
          onClose={() => setShowLoanModal(false)}
          onSaved={loadData}
        />
      )}
      {showAmortization && (
        <AmortizationModal
          propId={id}
          loan={showAmortization}
          onClose={() => setShowAmortization(null)}
        />
      )}
    </div>
  )
}

function KPI({ label, value, color, action }) {
  return (
    <div className="stat-card">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">{label} {action}</p>
      <p className={`text-xl font-bold ${color || 'text-gray-900 dark:text-white'}`}>{value}</p>
    </div>
  )
}

function PLRow({ label, value, neg, bold, color }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={bold ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}>{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${color || (neg ? 'text-red-500' : 'text-gray-900 dark:text-white')}`}>{value}</span>
    </div>
  )
}


const RAW_FIELD_LABELS = {
  tax_year: 'Tax Year',
  statement_year: 'Statement Year',
  statement_date: 'Statement Date',
  property_address: 'Property Address',
  property_city: 'Property City',
  property_state: 'Property State',
  property_zip: 'Property ZIP',
  account_number: 'Account Number',
  lender_name: 'Lender',
  current_balance: 'Current Balance',
  original_amount: 'Original Amount',
  interest_rate: 'Interest Rate',
  monthly_payment: 'Monthly Payment',
  escrow_amount: 'Escrow Amount',
  mortgage_interest: 'Mortgage Interest',
  property_tax_amount: 'Property Tax Amount',
  year_end_outstanding_balance: 'Year-End Outstanding Balance',
  rents_received: 'Rents Received',
  property_taxes: 'Property Taxes',
  depreciation: 'Depreciation',
  total_expenses: 'Total Expenses',
  net_income: 'Net Income',
  days_rented: 'Days Rented',
  personal_use_days: 'Personal Use Days',
}

const DOCUMENT_TYPE_LABELS = {
  mortgage_statement: 'Mortgage Statement',
  closing_statement: 'Closing Statement',
  tax_return: 'Tax Return',
  '1098': '1098',
  '1099': '1099',
  loan_disclosure: 'Loan Disclosure',
  bank_statement: 'Bank Statement',
  property_tax: 'Property Tax',
  other: 'Other',
}

function rawFieldLabel(key) {
  return RAW_FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function rawDocumentType(category) {
  return DOCUMENT_TYPE_LABELS[category] || rawFieldLabel(category || 'document')
}

function rawYear(doc, data = {}) {
  const value = doc.statement_year || data.statement_year || data.tax_year
  if (value) return String(value)
  const dateValue = data.statement_date || data.period_end || doc.period_end || doc.period_start
  const match = String(dateValue || '').match(/\b(19|20)\d{2}\b/)
  return match ? match[0] : '—'
}

function rawValue(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return Math.abs(value) >= 1000 ? fmt(value) : String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function flattenExtractedData(data) {
  return Object.entries(data || {})
    .filter(([key]) => !['raw_text_preview', 'parse_error'].includes(key))
    .map(([field, value]) => ({ field, value }))
}

function ExtractedRawDataTab({ propId, prop, docs }) {
  const [taxEntries, setTaxEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    propAPI.rawdata(propId)
      .then((res) => setTaxEntries(res.data?.tax_entries || []))
      .catch(() => setTaxEntries([]))
      .finally(() => setLoading(false))
  }, [propId])

  const documentRows = (docs || []).map((doc) => {
    const data = doc.extracted_data || {}
    return {
      key: `doc-${doc.id}`,
      documentType: rawDocumentType(doc.doc_category),
      year: rawYear(doc, data),
      source: doc.original_filename || `Document ${doc.id}`,
      fields: Object.fromEntries(
        Object.entries(data).filter(([key]) => !['raw_text_preview', 'parse_error'].includes(key))
      ),
    }
  })

  const taxRows = taxEntries.map((entry) => ({
    key: `tax-${entry.id}`,
    documentType: 'Tax Return Schedule E',
    year: String(entry.tax_year),
    source: entry.property_kind === 'primary' ? 'Schedule A / Primary' : 'Schedule E',
    fields: {
      rents_received: entry.rents_received,
      mortgage_interest: entry.mortgage_interest,
      property_taxes: entry.property_taxes,
      depreciation: entry.depreciation,
      total_expenses: entry.total_expenses,
      net_income: entry.net_income,
      days_rented: entry.days_rented,
      personal_use_days: entry.personal_use_days,
    },
  }))

  const rows = [...documentRows, ...taxRows].sort((a, b) => {
    const byYear = String(b.year).localeCompare(String(a.year))
    if (byYear) return byYear
    return a.documentType.localeCompare(b.documentType) || a.source.localeCompare(b.source)
  })

  const preferredFields = [
    'statement_year',
    'tax_year',
    'statement_date',
    'period_start',
    'period_end',
    'account_number',
    'lender_name',
    'property_address',
    'property_city',
    'property_state',
    'property_zip',
    'original_amount',
    'current_balance',
    'year_end_outstanding_balance',
    'interest_rate',
    'monthly_payment',
    'escrow_amount',
    'mortgage_interest',
    'property_tax_amount',
    'rents_received',
    'property_taxes',
    'depreciation',
    'total_expenses',
    'net_income',
    'days_rented',
    'personal_use_days',
  ]

  const fieldColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row.fields || {}))))
    .sort((a, b) => {
      const ai = preferredFields.indexOf(a)
      const bi = preferredFields.indexOf(b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return rawFieldLabel(a).localeCompare(rawFieldLabel(b))
    })

  const exportXLSX = () => {
    const exportRows = rows.map((row) => {
      const out = {
        'Property ID': prop?.property_uid || propId,
        'Property Name': propertyLabel(prop),
        'Document Type': row.documentType,
        Year: row.year,
        Source: row.source,
      }
      fieldColumns.forEach((field) => {
        out[rawFieldLabel(field)] = rawValue(row.fields[field])
      })
      return out
    })
    const ws = utils.json_to_sheet(exportRows)
    ws['!cols'] = Object.keys(exportRows[0] || { 'Document Type': '', Year: '', Source: '' }).map((key) => ({
      wch: Math.min(Math.max(String(key).length + 4, 14), 28),
    }))
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Raw Data')
    writeFile(wb, `propertylens_raw_data_${propId}.xlsx`)
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Raw Extracted Data</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Spreadsheet view: one row per document or tax year, with each extracted field as a column.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 dark:text-gray-500">{rows.length} rows · {fieldColumns.length} fields</div>
          <button type="button" className="btn-secondary flex items-center gap-1.5 text-xs" onClick={exportXLSX} disabled={rows.length === 0}>
            <Download className="h-3.5 w-3.5" /> Export XLSX
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">Loading raw data…</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">No extracted raw data yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="sticky left-0 z-10 bg-white py-2 pr-3 font-medium dark:bg-gray-800">Document Type</th>
                <th className="py-2 px-3 font-medium">Year</th>
                <th className="py-2 px-3 font-medium">Source</th>
                {fieldColumns.map((field) => (
                  <th key={field} className="whitespace-nowrap py-2 px-3 font-medium">{rawFieldLabel(field)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {rows.map((row) => (
                <tr key={row.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-2 pr-3 align-top font-medium text-gray-900 dark:bg-gray-800 dark:text-white">
                    {row.documentType}
                  </td>
                  <td className="whitespace-nowrap py-2 px-3 align-top text-gray-600 dark:text-gray-300">{row.year}</td>
                  <td className="max-w-[220px] truncate whitespace-nowrap py-2 px-3 align-top text-gray-500 dark:text-gray-400">{row.source}</td>
                  {fieldColumns.map((field) => (
                    <td key={field} className="whitespace-nowrap py-2 px-3 align-top text-gray-800 dark:text-gray-200">
                      {rawValue(row.fields[field])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  )
}

// ── Details / inline-edit tab ─────────────────────────────────────────────────
const PROPERTY_TYPES = ['Single Family', 'Multi Family', 'Condo', 'Townhouse', 'Commercial']

const DETAIL_SECTIONS = [
  {
    title: 'Basic Info',
    rows: [
      { label: 'Street Address',        key: 'address',        type: 'text',   span: 2 },
      { label: 'City',                  key: 'city',           type: 'text' },
      { label: 'State',                 key: 'state',          type: 'text' },
      { label: 'ZIP Code',              key: 'zip_code',       type: 'text' },
      { label: 'Property Type',         key: 'property_type',  type: 'select', options: PROPERTY_TYPES },
      { label: 'Usage',                 key: 'usage_type',     type: 'select', options: ['Rental', 'Primary'] },
      { label: 'Purchase Date',         key: 'purchase_date',  type: 'date' },
      { label: 'Purchase Price',        key: 'purchase_price', type: 'number', dollar: true },
      { label: 'Market Value',          key: 'market_value',   type: 'number', dollar: true },
    ],
  },
  {
    title: 'Rental Income',
    rentalOnly: true,
    rows: [
      { label: 'Monthly Rent',          key: 'monthly_rent',   type: 'number', dollar: true },
      { label: 'Occupancy Rate',        key: 'occupancy_rate', type: 'number', pct: true },
    ],
  },
  {
    title: 'Monthly Expenses',
    rows: [
      { label: 'Annual Property Tax',        key: 'property_tax',            type: 'number', dollar: true },
      { label: 'Annual Insurance',           key: 'insurance',               type: 'number', dollar: true },
      { label: 'HOA Fee / mo',               key: 'hoa_fee',                 type: 'number', dollar: true },
      { label: 'HOA Special Assessment',     key: 'hoa_special_assessment',  type: 'number', dollar: true },
      { label: 'Repairs & Maintenance / mo', key: 'maintenance',             type: 'number', dollar: true },
      { label: 'Property Mgmt / mo',         key: 'property_management_fee', type: 'number', dollar: true },
      { label: 'Utilities / mo',             key: 'utilities',               type: 'number', dollar: true },
      { label: 'Vacancy Allowance / mo',     key: 'vacancy_allowance',       type: 'number', dollar: true },
      { label: 'CapEx Reserve / mo',         key: 'capex_reserve',           type: 'number', dollar: true },
      { label: 'Other Expenses / mo',        key: 'other_expenses',          type: 'number', dollar: true },
    ],
  },
  {
    title: 'Solar',
    rows: [
      { label: 'Solar Ownership', key: 'solar_ownership', type: 'select', options: ['None', 'Leased', 'Purchased', 'Included in Purchase'] },
      { label: 'Solar Lease / mo', key: 'solar_monthly_payment', type: 'number', dollar: true },
      { label: 'Solar Purchase Price', key: 'solar_purchase_price', type: 'number', dollar: true },
    ],
  },
  {
    title: 'Depreciation',
    rows: [
      { label: 'Land Value',             key: 'land_value',         type: 'number', dollar: true },
      { label: 'Construction Cost',      key: 'construction_price', type: 'number', dollar: true },
      { label: 'Depreciation Period',    key: 'depreciation_years', type: 'number', suffix: 'yrs' },
    ],
  },
]

function DetailsEditTab({ prop, propId, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({ ...prop })
  const [saving, setSaving]   = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleEdit   = () => { setForm({ ...prop }); setEditing(true) }
  const handleCancel = () => { setForm({ ...prop }); setEditing(false) }

  const handleSave = async () => {
    setSaving(true)
    try {
      await propAPI.update(propId, form)
      toast.success('Property updated')
      onSaved()
      setEditing(false)
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const displayVal = (row, src) => {
    const v = src[row.key]
    if (v == null || v === '') return '—'
    if (row.dollar) return fmt(v)
    if (row.pct) return `${v}%`
    if (row.suffix) return `${v} ${row.suffix}`
    return String(v)
  }

  const isPrimary = (form.usage_type || prop.usage_type || 'Rental').toLowerCase() === 'primary'

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {editing ? 'Edit property details below, then save.' : 'View all property fields.'}
        </p>
        {!editing ? (
          <button onClick={handleEdit} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={handleCancel} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-5">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {DETAIL_SECTIONS.map(section => {
        if (section.rentalOnly && isPrimary) return null
        return (
          <div key={section.title} className="card">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">{section.title}</h3>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {section.rows.map(row => (
                <div key={row.key} className="flex items-center justify-between py-2.5 gap-4">
                  <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0 w-44">{row.label}</span>
                  {editing ? (
                    <div className="flex-1 max-w-xs">
                      {row.options ? (
                        <select className="input py-1.5 text-sm" value={form[row.key] ?? ''}
                          onChange={e => set(row.key, e.target.value)}>
                          {row.options.map(o => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input className="input py-1.5 text-sm" type={row.type}
                          value={form[row.key] ?? ''}
                          onChange={e => set(row.key, row.type === 'number' ? Number(e.target.value) : e.target.value)}
                          step={row.type === 'number' ? 'any' : undefined} />
                      )}
                    </div>
                  ) : (
                    <span className="text-sm font-medium text-gray-900 dark:text-white text-right">{displayVal(row, prop)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Computed read-only block */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">Computed</h3>
        <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
          {[
            { label: 'Total Loan Balance',  value: fmt(prop.total_loan_balance) },
            { label: 'Loan-to-Value',       value: prop.market_value ? fmtPct((prop.total_loan_balance||0)/prop.market_value*100) : 'N/A' },
            { label: 'Market Value Source', value: prop.market_value_source || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-gray-500 dark:text-gray-400 w-44">{label}</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Performance tab ────────────────────────────────────────────────────────────
function PerformanceTab({ propId }) {
  const [perf, setPerf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [yearNotes, setYearNotes] = useState({})
  const [editingNoteYear, setEditingNoteYear] = useState(null)
  const [noteInput, setNoteInput] = useState('')

  useEffect(() => {
    propAPI.performance(propId)
      .then((r) => {
        setPerf(r.data)
        setYearNotes(r.data.year_notes || {})
      })
      .catch(() => toast.error('Failed to load performance'))
      .finally(() => setLoading(false))
  }, [propId])

  const saveYearNote = async (year) => {
    const note = noteInput.trim()
    try {
      await propAPI.updateYearNote(propId, year, note)
      setYearNotes(prev => {
        const next = { ...prev }
        if (note) next[year] = note
        else delete next[year]
        return next
      })
    } catch {
      toast.error('Failed to save note')
    }
    setEditingNoteYear(null)
    setNoteInput('')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!perf) return null

  const latest = perf.yearly[perf.yearly.length - 1]
  const SOURCE_LABEL = {
    actual: 'from statements',
    annualized: 'annualized from 1 statement',
    estimated: 'estimated from loan',
    '1098': 'from Form 1098',
  }

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Cash Flow / yr" value={fmt(latest?.cash_flow)}
          color={latest?.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'} />
        <KPI label="Principal Paydown / yr" value={fmt(latest?.principal_paid)} color="text-blue-600" />
        <KPI label="Depreciation / yr" value={fmt(perf.annual_depreciation)} color="text-purple-600" />
        <KPI label="Return on Equity"
          value={perf.return_on_equity != null ? `${perf.return_on_equity}%` : 'N/A'}
          color={perf.return_on_equity >= 5 ? 'text-green-600' : 'text-amber-600'} />
      </div>

      {/* Signals */}
      {perf.signals.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Keep or Sell — Signals</h3>
          <ul className="space-y-2">
            {perf.signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  s.level === 'good' ? 'bg-green-500' : s.level === 'bad' ? 'bg-red-500' : 'bg-amber-400'
                }`} />
                {s.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Yearly table */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Yearly Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                <th className="pb-2 pr-2 font-medium">Year</th>
                <th className="pb-2 px-2 font-medium text-right">Rent</th>
                <th className="pb-2 px-2 font-medium text-right">Expenses</th>
                <th className="pb-2 px-2 font-medium text-right">Interest</th>
                <th className="pb-2 px-2 font-medium text-right">Taxes</th>
                <th className="pb-2 px-2 font-medium text-right">Principal</th>
                <th className="pb-2 px-2 font-medium text-right">Topup</th>
                <th className="pb-2 px-2 font-medium text-right">Cash Flow</th>
                <th className="pb-2 px-2 font-medium text-right">Taxable Income</th>
                <th className="pb-2 px-2 font-medium text-right">Depreciation</th>
                <th className="pb-2 px-2 font-medium text-right">Escrow</th>
                <th className="pb-2 pl-2 font-medium text-right">Total Return</th>
                <th className="pb-2 pl-3 font-medium text-left text-gray-400 dark:text-gray-500">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {perf.yearly.map((y) => (
                <tr key={y.year} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-2 pr-2 font-medium text-gray-900 dark:text-white">
                    {y.year}
                    <span className="block text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                      {y.statements > 0 ? `${y.statements} stmt · ` : ''}{SOURCE_LABEL[y.source]}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right">
                    {fmt(y.rental_income)}
                    {y.rent_source === 'leases' && (
                      <span className="block text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                        {y.occupied_months}/{12} mo · {fmtPct(y.occupancy)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right text-red-500">{fmt(y.operating_expenses)}</td>
                  <td className="py-2 px-2 text-right text-red-500">{fmt(y.interest_paid)}</td>
                  <td className="py-2 px-2 text-right text-orange-500">{fmt(y.taxes_paid)}</td>
                <td className="py-2 px-2 text-right text-blue-600">{fmt(y.principal_paid)}</td>
                <td className="py-2 px-2 text-right text-indigo-600 dark:text-indigo-400">{fmt(y.principal_topup_paid)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${y.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(y.cash_flow)}
                  </td>
                  <td className={`py-2 px-2 text-right ${y.taxable_income < 0 ? 'text-purple-600' : 'text-gray-900 dark:text-white'}`}>
                    {fmt(y.taxable_income)}
                  </td>
                  <td className="py-2 px-2 text-right text-purple-600">{fmt(y.depreciation)}</td>
                  <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(y.escrow_paid)}</td>
                  <td className={`py-2 pl-2 text-right font-semibold ${y.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(y.total_return)}
                  </td>
                  <td className="py-1 pl-3 min-w-[160px]">
                    {editingNoteYear === y.year ? (
                      <input
                        autoFocus
                        type="text"
                        value={noteInput}
                        onChange={e => setNoteInput(e.target.value)}
                        onBlur={() => saveYearNote(y.year)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveYearNote(y.year)
                          if (e.key === 'Escape') { setEditingNoteYear(null); setNoteInput('') }
                        }}
                        placeholder="Add note…"
                        className="w-full text-xs border border-blue-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingNoteYear(y.year); setNoteInput(yearNotes[y.year] || '') }}
                        className={`text-xs cursor-pointer rounded px-1 py-0.5 hover:bg-gray-100 ${yearNotes[y.year] ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 italic'}`}
                        title="Click to edit note"
                      >
                        {yearNotes[y.year] || 'Add note'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50">
                <td className="pt-2 pr-2 text-sm">Total</td>
                <td className="pt-2 px-2 text-right">{fmt(perf.totals.rental_income)}</td>
                <td className="pt-2 px-2 text-right text-red-500">{fmt(perf.totals.operating_expenses)}</td>
                <td className="pt-2 px-2 text-right text-red-500">{fmt(perf.totals.interest_paid)}</td>
              <td className="pt-2 px-2 text-right text-orange-500">{fmt(perf.totals.taxes_paid)}</td>
              <td className="pt-2 px-2 text-right text-blue-600">{fmt(perf.totals.principal_paid)}</td>
              <td className="pt-2 px-2 text-right text-indigo-600 dark:text-indigo-400">{fmt(perf.totals.principal_topup_paid)}</td>
              <td className={`pt-2 px-2 text-right ${perf.totals.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(perf.totals.cash_flow)}
                </td>
                <td className={`pt-2 px-2 text-right ${perf.totals.taxable_income < 0 ? 'text-purple-600' : 'text-gray-900 dark:text-white'}`}>
                  {fmt(perf.totals.taxable_income)}
                </td>
                <td className="pt-2 px-2 text-right text-purple-600">{fmt(perf.totals.depreciation)}</td>
                <td className="pt-2 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(perf.totals.escrow_paid)}</td>
                <td className={`pt-2 pl-2 text-right font-bold ${perf.totals.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(perf.totals.total_return)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          Upload mortgage statements from different months to turn estimates into actuals —
          two or more statements per year let the app measure the real principal paydown.
        </p>
      </div>

      {/* Statement Details per document */}
      {perf.snapshots.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Statement Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-2 font-medium">Date</th>
                  <th className="pb-2 px-2 font-medium text-right">Balance</th>
                  <th className="pb-2 px-2 font-medium text-right">Payment</th>
                  <th className="pb-2 px-2 font-medium text-right">Principal</th>
                  <th className="pb-2 px-2 font-medium text-right">Interest</th>
                  <th className="pb-2 px-2 font-medium text-right">Escrow</th>
                  <th className="pb-2 pl-2 font-medium text-right">Taxes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {(() => {
                  const years = [...new Set(perf.snapshots.map(s => s.year))].sort()
                  const rows = []
                  let grandBalance = 0, grandPayment = 0, grandPrincipal = 0, grandInterest = 0, grandEscrow = 0, grandTaxes = 0
                  years.forEach((year, yi) => {
                    const yrSnaps = perf.snapshots.filter(s => s.year === year)
                    let subBalance = 0, subPayment = 0, subPrincipal = 0, subInterest = 0, subEscrow = 0, subTaxes = 0
                    if (yi > 0) rows.push(<tr key={`gap-${year}`} className="h-2" />)
                    yrSnaps.forEach((s) => {
                      subBalance += s.balance || 0; subPayment += s.payment || 0
                      subPrincipal += s.principal || 0; subInterest += s.interest || 0
                      subEscrow += s.escrow || 0; subTaxes += s.taxes_paid || 0
                      rows.push(
                        <tr key={s.date} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="py-1.5 pr-2 text-gray-900 dark:text-white">{s.date}</td>
                          <td className="py-1.5 px-2 text-right">{fmt(s.balance)}</td>
                          <td className="py-1.5 px-2 text-right">{fmt(s.payment)}</td>
                          <td className="py-1.5 px-2 text-right text-blue-600">{fmt(s.principal)}</td>
                          <td className="py-1.5 px-2 text-right text-red-500">{fmt(s.interest)}</td>
                          <td className="py-1.5 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(s.escrow)}</td>
                          <td className="py-1.5 pl-2 text-right text-orange-500">{fmt(s.taxes_paid)}</td>
                        </tr>
                      )
                    })
                    // Year subtotal
                    rows.push(
                      <tr key={`sub-${year}`} className="bg-gray-50 dark:bg-gray-700/50 font-semibold text-gray-900 dark:text-white">
                        <td className="py-1.5 pr-2 text-xs text-gray-500 dark:text-gray-400">{year} subtotal</td>
                        <td className="py-1.5 px-2 text-right">{fmt(subBalance)}</td>
                        <td className="py-1.5 px-2 text-right">{fmt(subPayment)}</td>
                        <td className="py-1.5 px-2 text-right text-blue-600">{fmt(subPrincipal)}</td>
                        <td className="py-1.5 px-2 text-right text-red-500">{fmt(subInterest)}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(subEscrow)}</td>
                        <td className="py-1.5 pl-2 text-right text-orange-500">{fmt(subTaxes)}</td>
                      </tr>
                    )
                    grandBalance += subBalance; grandPayment += subPayment
                    grandPrincipal += subPrincipal; grandInterest += subInterest
                    grandEscrow += subEscrow; grandTaxes += subTaxes
                  })
                  // Grand total
                  rows.push(
                    <tr key="grand-total" className="border-t-2 border-gray-300 bg-gray-100 font-bold text-gray-900 dark:text-white">
                      <td className="pt-2 pr-2">Grand Total</td>
                      <td className="pt-2 px-2 text-right">{fmt(grandBalance)}</td>
                      <td className="pt-2 px-2 text-right">{fmt(grandPayment)}</td>
                      <td className="pt-2 px-2 text-right text-blue-600">{fmt(grandPrincipal)}</td>
                      <td className="pt-2 px-2 text-right text-red-500">{fmt(grandInterest)}</td>
                      <td className="pt-2 px-2 text-right text-gray-500 dark:text-gray-400">{fmt(grandEscrow)}</td>
                      <td className="pt-2 pl-2 text-right text-orange-500">{fmt(grandTaxes)}</td>
                    </tr>
                  )
                  return rows
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loan balance over time */}
      {perf.snapshots.length >= 2 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Loan Balance Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={perf.snapshots} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                domain={['auto', 'auto']} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Line type="monotone" dataKey="balance" name="Balance" stroke="#3b82f6" strokeWidth={2} dot isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* All Extracted Data — every document's extracted fields */}
      {perf.all_documents && perf.all_documents.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">All Extracted Data ({perf.all_documents.length})</h3>
          {perf.all_documents.map((doc) => {
            const entries = Object.entries(doc.extracted).filter(
              ([k]) => !['raw_text_preview', 'period_type', 'statement_year'].includes(k)
            )
            if (entries.length === 0) return null
            return (
              <details key={doc.id} className="border border-gray-100 dark:border-gray-700 rounded-lg mb-2 overflow-hidden">
                <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                    {doc.category}
                  </span>
                  <span className="text-gray-900 dark:text-white font-medium truncate">{doc.original_filename}</span>
                  {doc.period_type && doc.period_type !== 'other' && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
                      {doc.period_type} · {doc.period_start || ''}{doc.period_start && doc.period_end ? ' → ' : ''}{doc.period_end || ''}
                    </span>
                  )}
                </summary>
                <div className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 px-3 py-2 grid grid-cols-2 gap-x-6 gap-y-1">
                  {entries.map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-400 dark:text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300 ml-2">
                        {v === null || v === undefined ? '—' :
                         typeof v === 'number' ? `$${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` :
                         String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Scenarios tab ──────────────────────────────────────────────────────────────
function ScenariosTab({ prop, propId }) {
  const [extra, setExtra] = useState(0)
  const [selectedLoan, setSelectedLoan] = useState(prop.loans?.[0]?.id || '')
  const [analysis, setAnalysis] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [loading, setLoading] = useState(false)

  const run = async () => {
    if (!selectedLoan) return
    setLoading(true)
    try {
      const { data } = await propAPI.amortization(propId, selectedLoan, extra)
      setAnalysis(data.analysis)
      // sample every 12 months for chart
      const sampled = data.schedule.filter((_, i) => i % 12 === 0)
      setSchedule(sampled)
    } catch { toast.error('Failed to compute') }
    finally { setLoading(false) }
  }

  const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Extra Payment Payoff Simulator</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Loan</label>
            <select className="input w-52" value={selectedLoan} onChange={(e) => setSelectedLoan(e.target.value)}>
              {prop.loans?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lender_name || `Loan #${l.id}`} ({l.loan_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Extra Monthly Payment ($)</label>
            <input type="number" className="input w-36" value={extra}
              onChange={(e) => setExtra(parseFloat(e.target.value) || 0)} min="0" step="50" />
          </div>
          <button onClick={run} disabled={loading} className="btn-primary">
            {loading ? 'Calculating…' : 'Calculate'}
          </button>
        </div>

        {analysis && (
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <AnalysisCard label="Standard Payoff" value={`${(analysis.base_months / 12).toFixed(1)} yrs`} sub={`${analysis.base_months} months`} />
            <AnalysisCard label="With Extra $" value={`${(analysis.extra_months / 12).toFixed(1)} yrs`} sub={`${analysis.extra_months} months`} color="text-green-600" />
            <AnalysisCard label="Time Saved" value={`${analysis.years_saved} yrs`} sub={`${analysis.months_saved} months`} color="text-blue-600" />
            <AnalysisCard label="Interest Saved" value={fmt(analysis.interest_saved)} sub={`${fmt(analysis.base_total_interest)} → ${fmt(analysis.extra_total_interest)}`} color="text-purple-600" />
          </div>
        )}
      </div>

      {schedule.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Amortization Chart (Annual)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={schedule}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tickFormatter={(m) => `Yr ${Math.round(m/12)}`} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmt(v)} labelFormatter={(m) => `Month ${m}`} />
              <Area type="monotone" dataKey="balance" name="Balance" stroke="#3b82f6" fill="#eff6ff" />
              <Area type="monotone" dataKey="total_interest_paid" name="Interest Paid" stroke="#ef4444" fill="#fef2f2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Taxes tab (tax-return Schedule E / Schedule A) ──────────────────────────────
function TaxesTab({ propId, property }) {
  const [entries, setEntries] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([propAPI.taxEntries(propId), propAPI.taxComparison()])
      .then(([e, c]) => { setEntries(e.data); setComparison(c.data) })
      .catch(() => toast.error('Failed to load tax return data'))
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const hasEntries = entries && entries.length > 0
  const isPrimary = (property?.usage_type || '').toLowerCase() === 'primary'

  // Sort ascending by year so cumulative runs forward
  const sorted = hasEntries
    ? [...entries].sort((a, b) => a.tax_year - b.tax_year)
    : []

  // Build cumulative net income column
  let cumulative = 0
  const rows = sorted.map(e => {
    cumulative += (e.net_income || 0)
    return { ...e, cumulative_net: cumulative }
  })

  const exportCSV = () => {
    const headers = ['Year', 'Rents Received', 'Mortgage Interest', 'Property Taxes',
      'Depreciation', 'Total Expenses', 'Net Income', 'Cumulative Net Income']
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.tax_year,
        r.rents_received ?? '',
        r.mortgage_interest ?? '',
        r.property_taxes ?? '',
        r.depreciation ?? '',
        r.total_expenses ?? '',
        r.net_income ?? '',
        r.cumulative_net,
      ].join(','))
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tax_return_${propertyLabel(property).replace(/\s+/g, '_') || propId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* This property's tax-return figures by year */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Tax Return Figures</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {isPrimary ? 'Schedule A — primary residence' : 'Schedule E — rental real estate'}
            </p>
          </div>
          <div className="flex gap-2">
            {hasEntries && (
              <button onClick={exportCSV} className="btn-secondary text-sm flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            <button onClick={() => setShowCompare((s) => !s)} className="btn-secondary text-sm">
              {showCompare ? 'Hide comparison' : 'Compare all properties'}
            </button>
          </div>
        </div>

        {!hasEntries ? (
          <div className="text-center py-10">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 dark:text-gray-500 text-sm">No tax-return data for this property yet.</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
              Upload a 1040 tax return (with Schedule E) on the Uploads page — figures are matched by address.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Year</th>
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-green-600">Rents</th>}
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Mortgage Int.</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Prop. Taxes</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Depreciation</th>
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Total Exp.</th>}
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Net Income</th>}
                  {!isPrimary && <th className="text-right py-2 px-3 text-xs font-semibold text-blue-600">Cumulative Net</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={e.id} className={i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'}>
                    <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">
                      {e.tax_year}
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 capitalize">{e.property_kind}</span>
                    </td>
                    {!isPrimary && (
                      <td className="py-2 px-3 text-right text-green-600 font-medium">{fmt(e.rents_received)}</td>
                    )}
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.mortgage_interest)}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.property_taxes)}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.depreciation)}</td>
                    {!isPrimary && (
                      <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(e.total_expenses)}</td>
                    )}
                    {!isPrimary && (
                      <td className={`py-2 px-3 text-right font-medium ${e.net_income >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {e.net_income >= 0 ? '+' : ''}{fmt(e.net_income)}
                      </td>
                    )}
                    {!isPrimary && (
                      <td className={`py-2 px-3 text-right font-semibold ${e.cumulative_net >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                        {e.cumulative_net >= 0 ? '+' : ''}{fmt(e.cumulative_net)}
                      </td>
                    )}
                  </tr>
                ))}
                {/* Totals row */}
                {rows.length > 1 && !isPrimary && (
                  <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-semibold">
                    <td className="py-2 px-3 text-gray-700 dark:text-gray-300">Total ({rows[0].tax_year}–{rows[rows.length-1].tax_year})</td>
                    <td className="py-2 px-3 text-right text-green-600">{fmt(rows.reduce((s,r) => s+(r.rents_received||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.mortgage_interest||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.property_taxes||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.depreciation||0), 0))}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{fmt(rows.reduce((s,r) => s+(r.total_expenses||0), 0))}</td>
                    <td className={`py-2 px-3 text-right ${cumulative >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {cumulative >= 0 ? '+' : ''}{fmt(cumulative)}
                    </td>
                    <td className={`py-2 px-3 text-right ${cumulative >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                      {cumulative >= 0 ? '+' : ''}{fmt(cumulative)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cross-property comparison */}
      {showCompare && comparison && (
        <TaxComparison comparison={comparison} currentPropId={Number(propId)} />
      )}
    </div>
  )
}

function TaxComparison({ comparison, currentPropId }) {
  if (!comparison.years || comparison.years.length === 0) {
    return <div className="card text-sm text-gray-400 dark:text-gray-500">No tax-return data to compare yet.</div>
  }
  const COLS = [
    ['rents_received', 'Rents'],
    ['mortgage_interest', 'Mortgage Int.'],
    ['property_taxes', 'Taxes'],
    ['depreciation', 'Depreciation'],
    ['total_expenses', 'Total Exp.'],
    ['net_income', 'Net'],
  ]
  return (
    <div className="space-y-6">
      {comparison.years.map((yr) => (
        <div key={yr.tax_year} className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{yr.tax_year} — All Properties</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-2 font-medium">Property</th>
                  {COLS.map(([k, label]) => (
                    <th key={k} className="pb-2 px-2 font-medium text-right">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {yr.entries.map((e) => (
                  <tr key={e.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${e.property_id === currentPropId ? 'bg-blue-50/50' : ''}`}>
                    <td className="py-2 pr-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {e.property_name || (e.property_uid ? `ID ${e.property_uid.slice(0, 8).toUpperCase()}` : 'Unlinked property')}
                    </span>
                      {e.property_kind === 'primary' && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">primary</span>
                      )}
                      {!e.property_id && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:text-gray-400">unlinked</span>
                      )}
                    </td>
                    {COLS.map(([k]) => (
                      <td key={k} className={`py-2 px-2 text-right ${k === 'net_income' ? (e[k] >= 0 ? 'text-green-600' : 'text-red-500') : ''}`}>
                        {e[k] ? fmt(e[k]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 dark:border-gray-700 font-semibold">
                  <td className="py-2 pr-2 text-gray-900 dark:text-white">Total</td>
                  {COLS.map(([k]) => (
                    <td key={k} className="py-2 px-2 text-right">{fmt(yr.totals[k])}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Rental tab ──────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m, y) => (m && y ? `${MONTHS[m - 1]} ${y}` : '')

function RentalTab({ propId }) {
  const [data, setData]         = useState(null)
  const [taxData, setTaxData]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPeriod, setEditPeriod] = useState(null)

  const currentYear = new Date().getFullYear()

  const load = () => {
    setLoading(true)
    Promise.all([
      propAPI.rentals(propId),
      propAPI.rawdata(propId),
    ])
      .then(([r, rd]) => { setData(r.data); setTaxData(rd.data) })
      .catch(() => toast.error('Failed to load rental history'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [propId])

  const handleDelete = async (rid) => {
    if (!confirm('Delete this rental period?')) return
    await propAPI.deleteRental(propId, rid)
    toast.success('Rental period deleted')
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!data) return null

  const { periods, yearly, total_collected } = data

  // Tax entry lookup by year (for past rent & days_rented)
  const taxByYear = Object.fromEntries(
    (taxData?.tax_entries || []).map(e => [e.tax_year, e])
  )

  // Merge yearly rows with tax return data
  // All years present in either source
  const leaseYearSet = new Set(yearly.map(y => y.year))
  const taxYearSet   = new Set(Object.keys(taxByYear).map(Number))
  const allYears     = Array.from(new Set([...leaseYearSet, ...taxYearSet])).sort((a, b) => b - a)

  return (
    <div className="space-y-6">

      {/* Per-year occupancy + tax return rollup */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Rental by Year</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Past years: rent &amp; days from Tax Returns (Schedule E). Current year: from lease records / input.
            </p>
          </div>
          <span className="text-sm text-gray-400 dark:text-gray-500 shrink-0 ml-4">
            Total collected: <span className="font-semibold text-green-600">{fmt(total_collected)}</span>
          </span>
        </div>
        {allYears.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">
            No rental periods yet. Add a lease below or upload a tax return to track income per year.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                  <th className="pb-2 pr-2 font-medium text-left">Year</th>
                  <th className="pb-2 px-2 font-medium text-right">Rent Collected</th>
                  <th className="pb-2 px-2 font-medium text-right">Source</th>
                  <th className="pb-2 px-2 font-medium text-right">Days Rented<br/><span className="text-gray-400 dark:text-gray-500 font-normal">Sch E line 2</span></th>
                  <th className="pb-2 px-2 font-medium text-right">Personal Days<br/><span className="text-gray-400 dark:text-gray-500 font-normal">Sch E line 3</span></th>
                  <th className="pb-2 px-2 font-medium text-right">Occupancy</th>
                  <th className="pb-2 px-2 font-medium">&nbsp;</th>
                  <th className="pb-2 pl-2 font-medium text-right">Months / Lease</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {allYears.map((yr) => {
                  const ly   = yearly.find(y => y.year === yr)
                  const te   = taxByYear[yr]
                  const isPast    = yr < currentYear
                  const isCurrent = yr === currentYear

                  // Rent: past years prefer tax return; current uses lease
                  const rent       = isPast && te?.rents_received ? te.rents_received
                                   : ly?.income ?? null
                  const rentSource = isPast && te?.rents_received ? 'tax_return'
                                   : ly ? 'leases' : 'none'
                  const daysRented  = te?.days_rented || null
                  const personalDays = te?.personal_use_days || null
                  const occupancy  = ly?.occupancy ?? null
                  const mixedUse   = daysRented != null && personalDays > 0

                  const yearDays = (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365
                  const occupancyFromDays = daysRented != null
                    ? Math.round(daysRented / yearDays * 100)
                    : occupancy

                  return (
                    <tr key={yr} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${mixedUse ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                      <td className="py-2.5 pr-2 font-semibold text-gray-900 dark:text-white">
                        {yr}
                        {isCurrent && <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">current</span>}
                        {mixedUse  && <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">mixed use</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium text-green-600">
                        {rent != null ? fmt(rent) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          rentSource === 'tax_return' ? 'bg-purple-100 text-purple-700' :
                          rentSource === 'leases'     ? 'bg-blue-100 text-blue-700' :
                                                        'bg-gray-100 text-gray-400 dark:text-gray-500'}`}>
                          {rentSource === 'tax_return' ? 'Sch-E' :
                           rentSource === 'leases'     ? 'leases' : '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium text-blue-700">
                        {daysRented != null ? `${daysRented}d` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right text-orange-600">
                        {personalDays != null && personalDays > 0
                          ? `${personalDays}d`
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-medium">
                        {occupancyFromDays != null ? fmtPct(occupancyFromDays) : '—'}
                      </td>
                      <td className="py-2.5 px-2 w-32">
                        {occupancyFromDays != null && (
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                              occupancyFromDays >= 95 ? 'bg-green-500' :
                              occupancyFromDays >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${Math.min(occupancyFromDays, 100)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 text-right text-gray-500 dark:text-gray-400 text-xs">
                        {ly ? `${ly.occupied_months}/${ly.months_elapsed} mo` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400 dark:text-gray-500">
          <span><span className="inline-block w-2 h-2 rounded bg-purple-400 mr-1" />Sch-E = income / days from uploaded tax return</span>
          <span><span className="inline-block w-2 h-2 rounded bg-blue-400 mr-1" />Leases = from entered lease periods below</span>
          <span><span className="inline-block w-2 h-2 rounded bg-amber-300 mr-1" />Mixed use = rental + personal days in same year</span>
        </div>
      </div>

      {/* Lease periods list */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Lease Periods ({periods.length})</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Used for current-year income and occupancy tracking.</p>
          </div>
          <button onClick={() => { setEditPeriod(null); setShowForm(true) }}
            className="btn-primary flex items-center gap-2 text-sm shrink-0">
            <Plus className="w-4 h-4" /> Add Period
          </button>
        </div>
        {periods.length === 0 ? (
          <div className="text-center py-10">
            <Home className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 dark:text-gray-500 text-sm">No lease periods recorded</p>
          </div>
        ) : (
          <div className="space-y-2">
            {periods.map((p) => (
              <div key={p.id} className="flex items-center justify-between border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <Home className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">
                      {p.tenant_name || 'Tenant'}
                      <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">
                        {monthLabel(p.start_month, p.start_year)} → {p.end_year ? monthLabel(p.end_month, p.end_year) : 'present'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {fmt(p.monthly_rent)}/mo{p.notes ? ` · ${p.notes}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditPeriod(p); setShowForm(true) }}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(p.id)}
                    className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <RentalForm
          propId={propId}
          period={editPeriod}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function RentalForm({ propId, period, onClose, onSaved }) {
  const now = new Date()
  const [form, setForm] = useState({
    tenant_name: period?.tenant_name || '',
    start_month: period?.start_month || 1,
    start_year: period?.start_year || now.getFullYear(),
    end_month: period?.end_month || '',
    end_year: period?.end_year || '',
    monthly_rent: period?.monthly_rent ?? '',
    notes: period?.notes || '',
    ongoing: period ? !period.end_year : false,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    const payload = {
      tenant_name: form.tenant_name || null,
      start_month: Number(form.start_month),
      start_year: Number(form.start_year),
      end_month: form.ongoing || !form.end_month ? null : Number(form.end_month),
      end_year: form.ongoing || !form.end_year ? null : Number(form.end_year),
      monthly_rent: Number(form.monthly_rent) || 0,
      notes: form.notes || null,
    }
    if (!form.ongoing && payload.end_year && payload.end_month &&
        (payload.end_year < payload.start_year ||
         (payload.end_year === payload.start_year && payload.end_month < payload.start_month))) {
      toast.error('End date is before start date')
      return
    }
    setSaving(true)
    try {
      if (period) await propAPI.updateRental(propId, period.id, payload)
      else await propAPI.addRental(propId, payload)
      toast.success(period ? 'Rental period updated' : 'Rental period added')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">{period ? 'Edit' : 'Add'} Rental Period</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-gray-300"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="label">Tenant / Label (optional)</label>
            <input className="input" value={form.tenant_name}
              onChange={(e) => set('tenant_name', e.target.value)} placeholder="e.g. John Smith" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">From</label>
              <div className="flex gap-2">
                <select className="input" value={form.start_month} onChange={(e) => set('start_month', e.target.value)}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input type="number" className="input w-24" value={form.start_year}
                  onChange={(e) => set('start_year', e.target.value)} min="1980" max="2100" required />
              </div>
            </div>
            <div>
              <label className="label flex items-center justify-between">
                <span>To</span>
                <label className="flex items-center gap-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                  <input type="checkbox" checked={form.ongoing}
                    onChange={(e) => set('ongoing', e.target.checked)} /> Ongoing
                </label>
              </label>
              <div className="flex gap-2">
                <select className="input" value={form.end_month} disabled={form.ongoing}
                  onChange={(e) => set('end_month', e.target.value)}>
                  <option value="">—</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input type="number" className="input w-24" value={form.end_year} disabled={form.ongoing}
                  onChange={(e) => set('end_year', e.target.value)} min="1980" max="2100"
                  placeholder="Year" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Monthly Rent ($)</label>
              <input type="number" className="input" value={form.monthly_rent}
                onChange={(e) => set('monthly_rent', e.target.value)} min="0" step="50" required />
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" value={form.notes}
                onChange={(e) => set('notes', e.target.value)} placeholder="e.g. renewed lease" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : period ? 'Save' : 'Add Period'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Summary / Lifetime tab ─────────────────────────────────────────────────────
// ── RawDataTab ────────────────────────────────────────────────────────────────
// Pulls every raw data point from backend and presents them in a year-by-year
// cross-verification grid, flagging mismatches between sources.

function RawDataTab({ propId, prop }) {
  const [data, setData]       = useState(null)
  const [lifetimeData, setLifetimeData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selYear, setSelYear] = useState('all')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      propAPI.rawdata(propId),
      propAPI.lifetime(propId),
    ])
      .then(([raw, lifetime]) => {
        setData(raw.data)
        setLifetimeData(lifetime.data)
      })
      .catch(() => toast.error('Failed to load verification data'))
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!data) return null

  const { tax_entries, docs_1098, docs_1098_detail, docs_balance, docs_balance_logic = {},
          stmt_annual, tax_docs, lease_rent, irs_annual_depreciation,
          snapshots, loans } = data
  const lifetime = lifetimeData?.lifetime || {}
  const yearly = lifetimeData?.yearly || []
 const principalTopupPaid = lifetime.total_principal_topup_paid ?? lifetime.principal_topup_paid
  const topupRows = yearly.filter(y => (y.principal_topup_paid || 0) > 0)
  const expectedPrincipalPaid = lifetime.total_expected_principal_paid ?? lifetime.expected_principal_paid
  const scheduledLoanBalance = lifetime.scheduled_loan_balance

  // Build sorted set of all years across all sources
  const allYears = Array.from(new Set([
    ...tax_entries.map(e => e.tax_year),
    ...Object.keys(docs_1098).map(Number),
    ...Object.keys(docs_balance).map(Number),
    ...Object.keys(stmt_annual).map(Number),
    ...Object.keys(lease_rent).map(Number),
    ...Object.keys(tax_docs).map(Number),
  ])).sort((a, b) => b - a)

  const years = selYear === 'all' ? allYears : [Number(selYear)]

  // Tax entry lookup by year
  const taxByYear = Object.fromEntries(tax_entries.map(e => [e.tax_year, e]))

  // ── Discrepancy detection ───────────────────────────────────────────────────
  const THRESH = 0.05  // 5% tolerance before flagging

  function discLevel(a, b) {
    if (a == null || b == null) return 'none'
    if (a === 0 && b === 0) return 'none'
    const base = Math.max(Math.abs(a), Math.abs(b), 1)
    const diff = Math.abs(a - b) / base
    if (diff > 0.20) return 'high'
    if (diff > THRESH) return 'low'
    return 'none'
  }

  const DISC_STYLE = {
    none: '',
    low:  'bg-yellow-50 dark:bg-yellow-900/20',
    high: 'bg-red-50 dark:bg-red-900/20',
  }
  const DISC_TEXT = {
    none: 'text-gray-700 dark:text-gray-300',
    low:  'text-yellow-800 dark:text-yellow-300 font-medium',
    high: 'text-red-700 dark:text-red-400 font-bold',
  }
  const DISC_BADGE = {
    none: null,
    low:  <span className="ml-1 text-xs text-yellow-600 font-normal">⚠ differs</span>,
    high: <span className="ml-1 text-xs text-red-600 font-normal">❌ mismatch</span>,
  }

  // ── Cell renderer ─────────────────────────────────────────────────────────
  function Val({ v, disc = 'none', na = '—' }) {
    if (v == null || v === 0) return <span className="text-gray-300">{na}</span>
    return (
      <span className={DISC_TEXT[disc]}>
        {fmt(v)}{DISC_BADGE[disc]}
      </span>
    )
  }

  // ── Section: Rental Income ───────────────────────────────────────────────
  function RentSection() {
    return (
      <Section icon="🏠" title="Rental Income & Days" subtitle="What rent did the property earn, and for how many days was it rented each year?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Sch E Rent<br/><span className="font-normal">Tax Return</span></th>
            <th className="text-right py-2">Lease Rent<br/><span className="font-normal">Rental tab</span></th>
            <th className="text-right py-2">Days Rented<br/><span className="font-normal">Sch E line 2</span></th>
            <th className="text-right py-2">Personal Days<br/><span className="font-normal">Sch E line 3</span></th>
            <th className="text-right py-2">Lease Days<br/><span className="font-normal">from leases</span></th>
            <th className="text-right py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te  = taxByYear[yr]
            const lr  = lease_rent[yr]
            const taxRent    = te?.rents_received || null
            const leaseRent  = lr?.income || null
            const daysRented = te?.days_rented || null
            const persUse    = te?.personal_use_days || null
            const leaseDays  = lr?.lease_days || null
            const rentDisc   = discLevel(taxRent, leaseRent)
            const daysDisc   = discLevel(daysRented, leaseDays)
            const rowDisc    = rentDisc === 'high' || daysDisc === 'high' ? 'high'
                             : rentDisc === 'low'  || daysDisc === 'low'  ? 'low' : 'none'
            const totalDays  = daysRented != null && persUse != null ? daysRented + persUse : null
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[rowDisc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
                <td className="py-2 px-2 text-right">
                  <Val v={taxRent} disc={taxRent && leaseRent ? rentDisc : 'none'} />
                </td>
                <td className="py-2 px-2 text-right">
                  <Val v={leaseRent} disc={taxRent && leaseRent ? rentDisc : 'none'} />
                </td>
                <td className="py-2 px-2 text-right font-medium text-blue-700">
                  {daysRented != null ? `${daysRented}d` : <span className="text-gray-300">—</span>}
                  {totalDays != null && totalDays < 365 && (
                    <span className="text-xs text-amber-600 ml-1">(partial yr)</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right text-orange-600">
                  {persUse != null && persUse > 0 ? `${persUse}d` : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">
                  {leaseDays != null ? `~${leaseDays}d` : '—'}
                  {lr?.occupied_months != null && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">({lr.occupied_months} mo)</span>
                  )}
                </td>
                <td className="py-2 pl-2 text-right text-xs">
                  {rowDisc === 'none' && (taxRent || daysRented) ? <span className="text-green-500">✓</span> : null}
                  {rentDisc !== 'none' ? <span className={`block ${rentDisc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>rent {rentDisc === 'high' ? '❌' : '⚠'}</span> : null}
                  {daysDisc !== 'none' ? <span className={`block ${daysDisc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>days {daysDisc === 'high' ? '❌' : '⚠'}</span> : null}
                  {persUse > 0 && <span className="block text-amber-600">mixed use</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Mortgage Interest ───────────────────────────────────────────
  function InterestSection() {
    return (
      <Section icon="📄" title="Mortgage Interest" subtitle="Where does the interest number come from — and do sources agree?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Schedule E<br/><span className="font-normal">Tax Return</span></th>
            <th className="text-right py-2">Form 1098<br/><span className="font-normal">Uploaded doc</span></th>
            <th className="text-right py-2">Statements<br/><span className="font-normal">annualised</span></th>
            <th className="text-right py-2">Loan estimate<br/><span className="font-normal">current rate</span></th>
            <th className="text-right py-2">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te   = taxByYear[yr]
            const taxInt  = te?.mortgage_interest || null
            const docInt  = docs_1098[yr] || null
            const stmtInt = stmt_annual[yr]?.interest_annual || null
            const loanInt = loans.reduce((s, l) => s + (l.interest_due || 0), 0) * 12 || null

            // Compare best two available sources
            const sources = [taxInt, docInt, stmtInt].filter(v => v != null)
            const maxDisc = sources.length >= 2
              ? sources.reduce((worst, v, i) =>
                  sources.slice(i + 1).reduce((w, v2) => {
                    const d = discLevel(v, v2)
                    return d === 'high' ? 'high' : w === 'high' ? 'high' : d
                  }, worst), 'none')
              : 'none'

            // Priority indicator
            const used = docInt != null ? '1098' : taxInt != null ? 'Sch-E' : stmtInt != null ? 'stmt' : 'est'

            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[maxDisc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
                <td className="py-2 px-2 text-right"><Val v={taxInt} /></td>
                <td className="py-2 px-2 text-right"><Val v={docInt} /></td>
                <td className="py-2 px-2 text-right text-blue-600"><Val v={stmtInt} /></td>
                <td className="py-2 px-2 text-right text-gray-400 dark:text-gray-500">
                  {loanInt ? fmt(loanInt) : '—'}
                </td>
                <td className="py-2 pl-2 text-right">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    used === '1098'  ? 'bg-blue-100 text-blue-700' :
                    used === 'Sch-E' ? 'bg-purple-100 text-purple-700' :
                    used === 'stmt'  ? 'bg-gray-100 text-gray-600' :
                                       'bg-orange-100 text-orange-700'
                  }`}>
                    uses {used}
                  </span>
                  {maxDisc !== 'none' && (
                    <span className={`ml-1 text-xs ${maxDisc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                      {maxDisc === 'high' ? '❌' : '⚠'}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Principal & Balance ─────────────────────────────────────────
  function PrincipalSection() {
    return (
      <Section icon="🏦" title="Principal & Outstanding Balance" subtitle="How fast is the loan being paid down?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Balance (1098)<br/><span className="font-normal">Box 2 Jan-1</span></th>
            <th className="text-right py-2">Stmt avg balance<br/><span className="font-normal">from statements</span></th>
            <th className="text-right py-2">Principal paid<br/><span className="font-normal">stmt annualised</span></th>
            <th className="text-right py-2">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const doc1098Bal  = docs_balance[yr] || null
            const balanceLogic = docs_balance_logic[yr] || null
            const selectedDate = balanceLogic?.selected_acquisition_date || balanceLogic?.selected_origination_date
            const stmtBal     = stmt_annual[yr]?.avg_balance || null
            const stmtPrin    = stmt_annual[yr]?.principal_annual || null
            const disc        = discLevel(doc1098Bal, stmtBal)
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[disc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
              <td className="py-2 px-2 text-right text-blue-600 dark:text-blue-400">
                <Val v={doc1098Bal} />
                {balanceLogic && (
                  <div className="mt-1 text-[10px] leading-snug text-gray-400 dark:text-gray-500">
                    {balanceLogic.mode === 'active_parallel_loans' ? 'summed active loans' : 'latest loan balance'}
                    {selectedDate ? ` · date ${selectedDate}` : ''}
                    {balanceLogic.selected_account ? ` · ${balanceLogic.selected_account}` : ''}
                  </div>
                )}
              </td>
                <td className="py-2 px-2 text-right text-gray-600"><Val v={stmtBal} /></td>
                <td className="py-2 px-2 text-right text-green-600"><Val v={stmtPrin} /></td>
                <td className="py-2 pl-2 text-right">
                  {disc === 'none' && (doc1098Bal || stmtBal) ? <span className="text-green-500 text-xs">✓ ok</span> : null}
                  {disc !== 'none' ? (
                    <span className={`text-xs ${disc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                      {doc1098Bal && stmtBal ? fmt(Math.abs(doc1098Bal - stmtBal)) : ''}
                      {disc === 'high' ? ' ❌' : ' ⚠'}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Property Taxes ───────────────────────────────────────────────
  function TaxSection() {
    return (
      <Section icon="🧾" title="Property Taxes" subtitle="Three ways property taxes are known — do they agree?">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Schedule E<br/><span className="font-normal">Tax Return</span></th>
            <th className="text-right py-2">Uploaded docs<br/><span className="font-normal">bills / 1098</span></th>
            <th className="text-right py-2">Static field<br/><span className="font-normal">property card</span></th>
            <th className="text-right py-2">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te      = taxByYear[yr]
            const taxRet  = te?.property_taxes || null
            const docTax  = tax_docs[yr] || null
            const staticT = prop.property_tax || null

            const disc = discLevel(taxRet, docTax)
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[disc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">{yr}</td>
                <td className="py-2 px-2 text-right"><Val v={taxRet} disc={taxRet && docTax ? disc : 'none'} /></td>
                <td className="py-2 px-2 text-right text-blue-600"><Val v={docTax} disc={taxRet && docTax ? disc : 'none'} /></td>
                <td className="py-2 px-2 text-right text-gray-400 dark:text-gray-500">{staticT ? fmt(staticT) : '—'}</td>
                <td className="py-2 pl-2 text-right">
                  {disc === 'none' && taxRet && docTax ? <span className="text-green-500 text-xs">✓ match</span> : null}
                  {disc !== 'none' ? (
                    <span className={`text-xs ${disc === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                      {fmt(Math.abs((taxRet || 0) - (docTax || 0)))} {disc === 'high' ? '❌' : '⚠'}
                    </span>
                  ) : null}
                  {(!taxRet || !docTax) && <span className="text-gray-300 text-xs">only one source</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Section>
    )
  }

  // ── Section: Depreciation ─────────────────────────────────────────────────
  function DeprSection() {
    const irsFullYear = irs_annual_depreciation
    const basis       = (prop.purchase_price || 0) - (prop.land_value || 0)
    return (
      <Section icon="📉" title="Depreciation" subtitle="Filed Schedule E vs IRS straight-line. Mixed-use years prorate by days rented.">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2 w-16">Year</th>
            <th className="text-right py-2">Days Rented<br/><span className="font-normal">Sch E line 2</span></th>
            <th className="text-right py-2">IRS Prorated<br/><span className="font-normal">by days rented</span></th>
            <th className="text-right py-2">Schedule E<br/><span className="font-normal">filed return</span></th>
            <th className="text-right py-2">Δ vs Filed</th>
            <th className="text-right py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {years.map(yr => {
            const te       = taxByYear[yr]
            const taxDepr  = te?.depreciation || null
            const dr       = te?.days_rented  || null
            const pu       = te?.personal_use_days || 0
            const yearDays = (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365
            // Prorated IRS: if days_rented known, prorate; else full-year
            const irsProrated = dr != null ? Math.round(irsFullYear * dr / yearDays) : irsFullYear
            const disc     = discLevel(taxDepr, irsProrated)
            const diff     = taxDepr != null ? taxDepr - irsProrated : null
            const mixedUse = dr != null && pu > 0
            return (
              <tr key={yr} className={`border-b border-gray-100 dark:border-gray-700 text-sm ${DISC_STYLE[disc]}`}>
                <td className="py-2 font-semibold text-gray-700 dark:text-gray-300">
                  {yr}
                  {mixedUse && <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">mixed</span>}
                </td>
                <td className="py-2 px-2 text-right font-medium text-blue-700">
                  {dr != null ? `${dr}d` : <span className="text-gray-300">—</span>}
                  {pu > 0 && <span className="text-xs text-orange-500 block">{pu}d personal</span>}
                </td>
                <td className="py-2 px-2 text-right text-blue-600">
                  {fmt(irsProrated)}
                  {dr != null && dr < yearDays && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 block">{((dr / yearDays) * 100).toFixed(0)}% of yr</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right"><Val v={taxDepr} /></td>
                <td className="py-2 px-2 text-right">
                  {diff != null ? (
                    <span className={Math.abs(diff) < 200 ? 'text-gray-500 dark:text-gray-400' : diff > 0 ? 'text-orange-600' : 'text-red-600'}>
                      {diff > 0 ? '+' : ''}{fmt(diff)}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 pl-2 text-right text-xs">
                  {disc === 'none' && taxDepr    ? <span className="text-green-500">✓ ok</span>       : null}
                  {disc === 'low'                 ? <span className="text-yellow-600">⚠ small Δ</span> : null}
                  {disc === 'high'                ? <span className="text-red-600">❌ review</span>    : null}
                  {!taxDepr                       ? <span className="text-gray-300">no return</span>   : null}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="pt-3 text-xs text-gray-400 dark:text-gray-500">
              Depreciable basis = {fmt(prop.purchase_price)} − {fmt(prop.land_value)} = {fmt(basis)} over {prop.depreciation_years} yrs = {fmt(irsFullYear)}/yr full-year.
              When Schedule E "Fair Rental Days" &lt; 365, IRS prorates: basis × days / {365}.
              Mixed-use years (personal use days &gt; 0) further limit the deductible portion.
            </td>
          </tr>
        </tfoot>
      </Section>
    )
  }

  // ── Section: 1098 Document Detail ────────────────────────────────────────
  function Docs1098Section() {
    if (!docs_1098_detail.length) return null
    const dupCount = docs_1098_detail.filter(d => d.is_duplicate).length
    return (
      <Section icon="📋" title="Form 1098 — Document Inventory"
        subtitle={dupCount
          ? `Every uploaded 1098. ⚠ ${dupCount} duplicate${dupCount > 1 ? 's' : ''} detected — originals used for calculations.`
          : "Every uploaded 1098, deduplicated by account for each tax year."}>
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
              <th className="text-left py-2">Year</th>
              <th className="text-left py-2">File</th>
              <th className="text-left py-2">Account</th>
              <th className="text-left py-2">Origination</th>
              <th className="text-left py-2">Acquisition</th>
              <th className="text-right py-2">Mortgage Interest</th>
              <th className="text-right py-2">Outstanding Principal</th>
            <th className="text-left py-2 pl-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {[...docs_1098_detail].sort((a, b) => b.year - a.year).map((d, i) => (
            <tr key={i} className={`border-b text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${d.is_duplicate ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
              <td className="py-2 font-medium text-gray-700 dark:text-gray-300">{d.year}</td>
            <td className="py-2 px-2 text-blue-600 text-xs truncate max-w-xs" title={d.filename}>{d.filename}</td>
            <td className="py-2 px-2 text-gray-400 dark:text-gray-500 text-xs">{d.account_number || '—'}</td>
            <td className="py-2 px-2 text-gray-500 dark:text-gray-400 text-xs">{d.origination_date || '—'}</td>
                <td className="py-2 px-2 text-gray-500 dark:text-gray-400 text-xs">
                  {d.mortgage_acquisition_date || <span className="text-gray-300 dark:text-gray-600">Not reported</span>}
                </td>
            <td className={`py-2 px-2 text-right ${d.is_duplicate ? 'text-gray-300 line-through' : 'text-orange-600'}`}>
                {d.mortgage_interest ? fmt(d.mortgage_interest) : '—'}
              </td>
              <td className={`py-2 pl-2 text-right ${d.is_duplicate ? 'text-gray-300 line-through' : 'text-blue-600'}`}>
                {d.outstanding_principal ? fmt(d.outstanding_principal) : '—'}
              </td>
              <td className="py-2 pl-3">
                {d.is_duplicate ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 text-amber-800">
                    ⚠ Duplicate
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700">
                    ✓ Original
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Section>
    )
  }

  // ── Section: Mortgage Statement Snapshots ────────────────────────────────
  function StatementsSection() {
    if (!snapshots.length) return null
    const visible = selYear === 'all'
      ? snapshots
      : snapshots.filter(s => s.year === Number(selYear))
    return (
      <Section icon="📊" title="Mortgage Statement Snapshots" subtitle="Raw point-in-time data extracted from every uploaded statement.">
        <thead>
          <tr className="text-xs text-gray-400 dark:text-gray-500 border-b">
            <th className="text-left py-2">Date</th>
            <th className="text-right py-2">Balance</th>
            <th className="text-right py-2">Interest (mo)</th>
            <th className="text-right py-2">Principal (mo)</th>
            <th className="text-right py-2">Escrow (mo)</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s, i) => (
            <tr key={i} className="border-b text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="py-1.5 text-gray-600">{s.date}</td>
              <td className="py-1.5 px-2 text-right">{s.balance ? fmt(s.balance) : '—'}</td>
              <td className="py-1.5 px-2 text-right text-orange-600">{s.interest ? fmt(s.interest) : '—'}</td>
              <td className="py-1.5 px-2 text-right text-blue-600">{s.principal ? fmt(s.principal) : '—'}</td>
              <td className="py-1.5 pl-2 text-right text-gray-400 dark:text-gray-500">{s.escrow ? fmt(s.escrow) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </Section>
    )
  }

  // ── Master discrepancy summary ────────────────────────────────────────────
  const discrepancies = []
  for (const yr of allYears) {
    const te = taxByYear[yr]
    const lr = lease_rent[yr]
    const yearDays = (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)) ? 366 : 365
    // Rent
    const taxRent  = te?.rents_received || null
    const lsRent   = lr?.income || null
    if (discLevel(taxRent, lsRent) !== 'none')
      discrepancies.push({ yr, field: 'Rent', a: taxRent, b: lsRent, sa: 'Sch-E', sb: 'Leases' })
    // Days rented
    const schDays  = te?.days_rented || null
    const lsDays   = lr?.lease_days  || null
    if (discLevel(schDays, lsDays) !== 'none')
      discrepancies.push({ yr, field: 'Days Rented', a: schDays, b: lsDays, sa: 'Sch-E', sb: 'Leases', isDays: true })
    // Interest
    const taxInt   = te?.mortgage_interest || null
    const docInt   = docs_1098[yr] || null
    const stmtInt  = stmt_annual[yr]?.interest_annual || null
    if (discLevel(taxInt, docInt) !== 'none')
      discrepancies.push({ yr, field: 'Interest', a: taxInt, b: docInt, sa: 'Sch-E', sb: '1098' })
    else if (discLevel(taxInt, stmtInt) !== 'none' && !docInt)
      discrepancies.push({ yr, field: 'Interest', a: taxInt, b: stmtInt, sa: 'Sch-E', sb: 'Stmt' })
    // Taxes
    const taxTax   = te?.property_taxes || null
    const docTax   = tax_docs[yr] || null
    if (discLevel(taxTax, docTax) !== 'none')
      discrepancies.push({ yr, field: 'Property Tax', a: taxTax, b: docTax, sa: 'Sch-E', sb: 'Docs' })
    // Depreciation — compare filed vs IRS-prorated-by-days
    const taxDepr  = te?.depreciation || null
    const dr       = te?.days_rented  || null
    const irsExp   = dr != null ? Math.round(irs_annual_depreciation * dr / yearDays) : irs_annual_depreciation
    if (discLevel(taxDepr, irsExp) === 'high')
      discrepancies.push({ yr, field: 'Depreciation', a: taxDepr, b: irsExp, sa: 'Sch-E', sb: dr != null ? `IRS (${dr}d)` : 'IRS calc' })
  }

  return (
    <div className="space-y-6">

      {/* Discrepancy Alert Banner */}
      {discrepancies.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-900/20 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">❌</span>
            <h3 className="font-semibold text-red-800">
              {discrepancies.length} Data Discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} Found
            </h3>
          </div>
          <div className="space-y-1.5">
            {discrepancies.map((d, i) => {
              const disp = (v) => d.isDays ? `${v}d` : fmt(v)
              return (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-red-400">•</span>
                  <span className="font-medium text-red-800">{d.yr} {d.field}:</span>
                  <span className="text-red-700">{d.sa} says {disp(d.a)}</span>
                  <span className="text-red-400">vs</span>
                  <span className="text-red-700">{d.sb} says {disp(d.b)}</span>
                  <span className="text-red-500 ml-auto text-xs">Δ {d.isDays ? `${Math.abs((d.a||0)-(d.b||0))}d` : fmt(Math.abs((d.a || 0) - (d.b || 0)))}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* No discrepancies */}
      {discrepancies.length === 0 && allYears.length > 0 && (
        <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <div className="font-semibold text-green-800 dark:text-green-300">All sources agree</div>
            <div className="text-sm text-green-700 dark:text-green-400">No significant discrepancies detected across {allYears.length} years of data.</div>
          </div>
        </div>
      )}

      {/* Year filter */}
      {allYears.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Filter by year:</span>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setSelYear('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selYear === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
              All years
            </button>
            {allYears.map(yr => (
              <button key={yr} onClick={() => setSelYear(String(yr))}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selYear === String(yr) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                {yr}
              </button>
            ))}
          </div>
        </div>
      )}

      {allYears.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <div className="text-4xl mb-3">📂</div>
          <div className="font-medium">No data to verify yet</div>
          <div className="text-sm mt-1">Upload tax returns, 1098s, or mortgage statements to populate this view.</div>
        </div>
      )}

      <RentSection />
      <InterestSection />
      <PrincipalSection />
      <TaxSection />
      <DeprSection />
      <Docs1098Section />
      <StatementsSection />

    </div>
  )
}

// Collapsible card wrapper for each verification section
function Section({ icon, title, subtitle, children }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-left group">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">{icon}</span>
            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 ml-6">{subtitle}</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform shrink-0 ml-4 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            {children}
          </table>
        </div>
      )}
    </div>
  )
}


function SummaryTab({ propId, prop, metrics }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedYear, setExpandedYear] = useState(null)

  useEffect(() => {
    setLoading(true)
    propAPI.lifetime(propId)
      .then((r) => setData(r.data))
      .catch((err) => {
        const detail = err.response?.data?.detail
        toast.error(detail ? `Failed to load lifetime summary: ${detail}` : 'Failed to load lifetime summary')
      })
      .finally(() => setLoading(false))
  }, [propId])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
  if (!data) return null

  const { lifetime, yearly } = data
  const topupRows = (yearly || []).filter(y => (y.principal_topup_paid || 0) > 0)

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const appreciation = (lifetime.market_value || 0) - (lifetime.purchase_price || 0)
  const appPct       = lifetime.purchase_price > 0 ? appreciation / lifetime.purchase_price * 100 : 0
  const equityPct    = lifetime.market_value > 0 ? lifetime.equity / lifetime.market_value * 100 : 0
  const ltv          = lifetime.market_value > 0 ? lifetime.current_loan_balance / lifetime.market_value * 100 : null
  const cfMarginPct  = lifetime.total_rental_income > 0
    ? lifetime.total_cash_flow / lifetime.total_rental_income * 100 : 0
  // Use original_loan_amount from DB (authoritative); fall back to
  // current_balance + principal_paid only if original is missing.
  const originalLoan   = lifetime.original_loan_amount
    || (lifetime.current_loan_balance + lifetime.total_principal_paid)
  const totalDebt        = lifetime.total_interest_paid + lifetime.total_principal_paid
  const interestRatioPct = totalDebt > 0 ? lifetime.total_interest_paid / totalDebt * 100 : 0
  const payoffProgress   = originalLoan > 0 ? lifetime.total_principal_paid / originalLoan * 100 : 0
  const expectedPrincipalPaid = lifetime.total_expected_principal_paid ?? lifetime.expected_principal_paid
  const principalTopupPaid = lifetime.total_principal_topup_paid ?? lifetime.principal_topup_paid
  const taxableIncomePct  = lifetime.total_rental_income > 0
    ? lifetime.total_taxable_income / lifetime.total_rental_income * 100 : 0
  // Cash-on-cash: lifetime CF / approximate down payment
  const downPayment = Math.max((lifetime.purchase_price || 0) - originalLoan, 1)
  const cocReturn   = downPayment > 0 ? lifetime.total_cash_flow / downPayment * 100 : 0

  const annualCFValue   = metrics?.annual_cash_flow || 0
  const annualRentValue = (metrics?.effective_rent || 0) * 12
  const annualOpex      = (metrics?.monthly_expenses || 0) * 12
  const annualMortgage  = (metrics?.monthly_mortgage || 0) * 12

  // ── Health score (0–100) ─────────────────────────────────────────────────────
  let healthScore = 0
  // LTV component (25 pts)
  if (ltv !== null) {
    if (ltv < 55)      healthScore += 25
    else if (ltv < 65) healthScore += 20
    else if (ltv < 75) healthScore += 14
    else if (ltv < 85) healthScore += 7
  } else {
    healthScore += 12 // no debt
  }
  // Cash flow margin (25 pts)
  if (cfMarginPct > 20)      healthScore += 25
  else if (cfMarginPct > 10) healthScore += 20
  else if (cfMarginPct > 0)  healthScore += 12
  else if (cfMarginPct > -10) healthScore += 5
  // Equity % (25 pts)
  if (equityPct > 50)      healthScore += 25
  else if (equityPct > 35) healthScore += 20
  else if (equityPct > 20) healthScore += 12
  else if (equityPct > 10) healthScore += 6
  // Tax efficiency (25 pts) — paper rental loss offsets income
  if (taxableIncomePct < -20)      healthScore += 25
  else if (taxableIncomePct < 0)   healthScore += 20
  else if (taxableIncomePct < 10)  healthScore += 10
  healthScore = Math.min(100, Math.round(healthScore))

  const healthLabel = healthScore >= 80 ? 'Excellent' : healthScore >= 65 ? 'Good' : healthScore >= 45 ? 'Average' : 'Needs Attention'
  const healthBg    = healthScore >= 80 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : healthScore >= 65 ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : healthScore >= 45 ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
  const healthText  = healthScore >= 80 ? 'text-green-700' : healthScore >= 65 ? 'text-yellow-700' : healthScore >= 45 ? 'text-orange-700' : 'text-red-700'
  const healthBar   = healthScore >= 80 ? '#16a34a' : healthScore >= 65 ? '#ca8a04' : healthScore >= 45 ? '#d97706' : '#dc2626'

  // ── Verdicts ─────────────────────────────────────────────────────────────────
  const overallVerdict =
    cfMarginPct > 15 && equityPct > 40 ? 'Excellent long-term wealth builder with strong cash flow and growing equity.'
    : cfMarginPct > 5 && equityPct > 25 ? 'Solid performer. Cash flow positive and equity growing steadily.'
    : cfMarginPct < 0 && equityPct > 40 ? 'Equity growth is strong but cash flow is negative. Monitor monthly costs.'
    : cfMarginPct > 5 && equityPct < 20 ? 'Cash flow is healthy but equity is early-stage — patience is the strategy.'
    : 'High leverage is compressing returns. Consider rent optimization or refinancing.'

  const cfVerdict =
    cfMarginPct > 20 ? 'Strong positive cash flow — this property reliably generates monthly income.'
    : cfMarginPct > 5 ? 'Cash flow is positive but lean. Review expenses or consider a rent increase.'
    : cfMarginPct > 0 ? 'Barely cash-flow positive. Any vacancy or major repair could turn it negative.'
    : 'Negative cash flow. Mortgage and operating costs exceed rental income.'

  const equityVerdict =
    equityPct > 50 ? `Equity is strong at ${fmtPct(equityPct)} of property value — significant wealth has been built.`
    : equityPct > 30 ? `Equity at ${fmtPct(equityPct)} is growing solidly. Time and appreciation will accelerate this.`
    : `Equity at ${fmtPct(equityPct)} is in early stages. Most payments are still going to interest.`

  // ── Status badges ─────────────────────────────────────────────────────────────
  const badges = [
    { label: 'Cash Flow', status: cfMarginPct > 10 ? 'green' : cfMarginPct > 0 ? 'yellow' : 'red', note: cfMarginPct > 10 ? 'Strong' : cfMarginPct > 0 ? 'Weak' : 'Negative' },
    { label: 'Equity',    status: equityPct > 35 ? 'green' : equityPct > 20 ? 'yellow' : 'red',     note: equityPct > 35 ? 'Strong' : equityPct > 20 ? 'Growing' : 'Low' },
    { label: 'Debt',      status: ltv == null ? 'green' : ltv < 65 ? 'green' : ltv < 80 ? 'yellow' : 'red', note: ltv == null ? 'No debt' : ltv < 65 ? 'Healthy' : ltv < 80 ? 'High' : 'Very High' },
    { label: 'Tax',       status: taxableIncomePct < 0 ? 'green' : taxableIncomePct < 10 ? 'yellow' : 'red', note: taxableIncomePct < 0 ? 'Efficient' : 'Positive' },
    { label: 'Occupancy', status: (prop.occupancy_rate || 0) >= 95 ? 'green' : (prop.occupancy_rate || 0) >= 85 ? 'yellow' : 'red', note: `${prop.occupancy_rate || 0}%` },
  ]
  const BADGE = {
    green:  { bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-800 dark:text-green-300',  dot: 'bg-green-500' },
    yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300', dot: 'bg-yellow-500' },
    red:    { bg: 'bg-red-100 dark:bg-red-900/30',    text: 'text-red-800 dark:text-red-300',    dot: 'bg-red-500' },
  }

  // ── Auto-insights ─────────────────────────────────────────────────────────────
  const insights = []
  if (cfMarginPct > 20) insights.push({ t: 'green', msg: `Strong cash flow margin of ${fmtPct(cfMarginPct)} — property is generating reliable income.` })
  else if (cfMarginPct < 0) insights.push({ t: 'red', msg: 'Cash flow is negative. Consider increasing rent or reducing non-essential expenses.' })
  else insights.push({ t: 'yellow', msg: `Cash flow margin is ${fmtPct(cfMarginPct)} — positive but limited buffer against vacancies.` })
  if (equityPct > 40) insights.push({ t: 'green', msg: `Equity represents ${fmtPct(equityPct)} of property value — strong ownership position.` })
  if (ltv != null && ltv < 65) insights.push({ t: 'green', msg: `LTV of ${fmtPct(ltv)} is healthy and may qualify for favorable refinancing terms.` })
  if (ltv != null && ltv > 80) insights.push({ t: 'red', msg: `High LTV of ${fmtPct(ltv)} limits your equity cushion and may increase borrowing costs.` })
  if (lifetime.total_taxable_income < 0) insights.push({ t: 'green', msg: 'Depreciation and interest create a paper loss that may offset other income — tax efficient.' })
  if (interestRatioPct > 75) insights.push({ t: 'yellow', msg: `${interestRatioPct.toFixed(0)}% of lifetime debt payments have gone to interest. This is normal early in a loan term.` })
  if (appreciation > 0 && appPct > 10) insights.push({ t: 'green', msg: `Property has appreciated ${fmt(appreciation)} (${appPct.toFixed(1)}%) since purchase — building long-term wealth.` })
  if (yearly.length >= 2) {
    const last2 = yearly.slice(-2)
    if (last2[1]?.cash_flow < last2[0]?.cash_flow && last2[0]?.cash_flow < 0) {
      insights.push({ t: 'red', msg: 'Cash flow has declined for two consecutive years. Review rent pricing and expense trends.' })
    }
  }
  const occ = prop.occupancy_rate || 0
  if (occ >= 95) insights.push({ t: 'green', msg: `${occ}% occupancy — property has maintained near-full occupancy.` })
  else if (occ < 85) insights.push({ t: 'red', msg: `${occ}% occupancy is below target. Vacancy is reducing effective rental income.` })

  // ── Export ────────────────────────────────────────────────────────────────────
  const exportXLS = () => {
    const header = ['Year', 'Rent', 'Expenses', 'Interest', 'Principal', 'Topup', 'Cash Flow', 'Taxable Income', 'Depreciation']
    const rows = yearly.map(y => [y.year, y.rental_income, y.operating_expenses, y.interest_paid, y.principal_paid, y.principal_topup_paid, y.cash_flow, y.taxable_income, y.depreciation])
    const ws = utils.aoa_to_sheet([header, ...rows])
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Summary')
    writeFile(wb, 'property-summary.xlsx')
  }

  return (
    <div className="space-y-6">

      {/* 1. Property Health Summary */}
      <div className={`rounded-2xl border p-6 ${healthBg}`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-5xl font-bold ${healthText}`}>{healthScore}</span>
              <div>
                <div className={`text-xl font-semibold ${healthText}`}>{healthLabel}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Health Score / 100</div>
              </div>
            </div>
            <div className="w-full bg-white/60 dark:bg-gray-700/60 rounded-full h-2.5 mb-3">
              <div className="h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${healthScore}%`, backgroundColor: healthBar }} />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 italic">"{overallVerdict}"</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end sm:max-w-xs">
            {badges.map((b) => {
              const c = BADGE[b.status]
              return (
                <span key={b.label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  {b.label}: {b.note}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* 2–5 Story Cards in 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* 2. Cash Flow Story */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-0.5">Cash Flow</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Is this property making money every month?</p>
          <div className="space-y-2 mb-4">
            <SumRow label="Annual Rental Income"  value={annualRentValue}   color="text-green-600" plus />
            <SumRow label="Deductible Expenses"   value={-annualOpex}       color="text-red-500" />
            <SumRow label="Mortgage (P&amp;I)"    value={-annualMortgage}   color="text-orange-500" />
            <div className="border-t pt-2">
              <SumRow label="Annual Cash Flow" value={annualCFValue}
                color={annualCFValue >= 0 ? 'text-green-700' : 'text-red-600'} bold />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Monthly Cash Flow</div>
              <div className={`text-base font-bold ${(metrics?.monthly_cash_flow || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {fmt(metrics?.monthly_cash_flow || 0)}
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Cash-on-Cash Return</div>
              <div className={`text-base font-bold ${cocReturn >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {cocReturn.toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 italic border-t pt-3">{cfVerdict}</p>
        </div>

        {/* 3. Equity Story */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-0.5">Equity</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">How much wealth has this property created?</p>
          {/* Stacked bar */}
          <div className="mb-4">
            <div className="flex rounded-xl overflow-hidden h-5 mb-1.5">
              <div style={{ width: `${Math.min(100, ltv || 0)}%`, backgroundColor: '#f87171' }}
                title={`Remaining Mortgage: ${fmt(lifetime.current_loan_balance)}`} />
              <div style={{ width: `${Math.min(100, equityPct)}%`, backgroundColor: '#4ade80' }}
                title={`Your Equity: ${fmt(lifetime.equity)}`} />
            </div>
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-300 inline-block" /> Loan ({fmtPct(ltv || 0)})</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-300 inline-block" /> Equity ({fmtPct(equityPct)})</span>
            </div>
          </div>
          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Estimated Property Value</span><span className="text-green-600 font-medium">{fmt(lifetime.market_value)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Remaining Mortgage</span><span className="text-red-500">{fmt(lifetime.current_loan_balance)}</span></div>
            <div className="flex justify-between border-t pt-2"><span className="font-semibold text-gray-900 dark:text-white">Current Equity</span><span className="font-bold text-blue-600">{fmt(lifetime.equity)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Appreciation</span><span className={appreciation >= 0 ? 'text-green-600' : 'text-red-500'}>{fmt(appreciation)} ({appPct.toFixed(1)}%)</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Loan Paydown</span><span className="text-blue-600">{fmt(lifetime.total_principal_paid)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Topup Paid</span><span className="text-indigo-600 dark:text-indigo-400">{fmt(principalTopupPaid)}</span></div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 italic border-t pt-3">{equityVerdict}</p>
        </div>

        {/* 4. Debt Story */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-0.5">Debt</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Is the mortgage on track?</p>

          {/* Data quality warning when balance exceeds original loan */}
          {originalLoan > 0 && lifetime.current_loan_balance > originalLoan && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 mb-4 text-xs text-amber-800">
              <strong>⚠ Loan data check needed:</strong> Current balance ({fmt(lifetime.current_loan_balance)}) is
              higher than original loan amount ({fmt(originalLoan)}). Update the loan details to reflect the
              actual origination amount so payoff progress is calculated correctly.
            </div>
          )}

          {/* Payoff progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Payoff Progress</span>
              <span className="font-medium">{Math.max(0, payoffProgress).toFixed(1)}% paid off</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="h-3 rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, payoffProgress))}%` }} />
            </div>
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
              <span>Original loan: {fmt(originalLoan)}</span>
              <span>{fmt(lifetime.current_loan_balance)} remaining</span>
            </div>
          </div>
          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total Interest Paid</span><span className="text-orange-500">{fmt(lifetime.total_interest_paid)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total Principal Paid</span>
              <span className={lifetime.total_principal_paid > 0 ? 'text-blue-600' : 'text-gray-400 dark:text-gray-500'}>
                {lifetime.total_principal_paid > 0 ? fmt(lifetime.total_principal_paid) : '—'}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Scheduled Principal</span>
              <span className={expectedPrincipalPaid > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}>
                {expectedPrincipalPaid > 0 ? fmt(expectedPrincipalPaid) : '—'}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Topup Paid</span>
              <span className={principalTopupPaid > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500'}>
                {principalTopupPaid > 0 ? fmt(principalTopupPaid) : '—'}
              </span>
            </div>
            {lifetime.total_principal_paid > 0 && (
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Interest Share of Payments</span>
                <span className={interestRatioPct > 70 ? 'text-orange-500' : 'text-gray-700 dark:text-gray-300'}>{interestRatioPct.toFixed(0)}%</span>
              </div>
            )}
            {ltv != null && (
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Loan-to-Value (LTV)</span>
                <span className={ltv < 65 ? 'text-green-600' : ltv < 80 ? 'text-yellow-600' : 'text-red-600'}>{fmtPct(ltv)}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 italic border-t pt-3">
            {lifetime.total_principal_paid <= 0
              ? 'Update loan details with the original loan amount to enable payoff tracking.'
              : interestRatioPct > 75
                ? 'Most payments are still going to interest — normal early in a 30-year loan.'
                : 'Principal reduction is accelerating. Momentum is building toward payoff.'}
          </p>
        </div>

        {/* 5. Tax Story */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-0.5">Tax Picture</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">How does this property affect your taxes?</p>
          <div className="space-y-2 mb-4">
            <SumRow label="Lifetime Rental Income"  value={lifetime.total_rental_income}    color="text-green-600" plus />
            <SumRow label="Deductible Expenses"     value={-lifetime.total_operating_expenses} color="text-red-500" />
            <SumRow label="Mortgage Interest"       value={-lifetime.total_interest_paid}   color="text-orange-500" />
            <SumRow label="Depreciation"            value={-lifetime.total_depreciation}    color="text-purple-600" />
            <div className="border-t pt-2">
              <SumRow label={lifetime.total_taxable_income < 0 ? 'Tax Loss (Lifetime)' : 'Taxable Income (Lifetime)'}
                value={lifetime.total_taxable_income}
                color={lifetime.total_taxable_income < 0 ? 'text-purple-700' : 'text-gray-800'} bold />
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Annual Depreciation</span><span className="text-purple-600 font-medium">{fmt(lifetime.annual_depreciation)}</span></div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 italic border-t pt-3 mt-3">
            {lifetime.total_taxable_income < 0
              ? 'Depreciation and interest create paper losses that may offset other income — tax efficient.'
              : 'Taxable rental income is positive. Ensure all deductions are fully captured.'}
          </p>
        </div>
      </div>

      {topupRows.length > 0 && (
        <div className="card">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Lifetime Topup Paid by Year</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">Extra principal paid above scheduled amortization.</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400 dark:text-gray-500">Total Topup</div>
              <div className="font-bold text-indigo-600 dark:text-indigo-400">{fmt(principalTopupPaid)}</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 dark:text-gray-400 border-b">
                  <th className="text-left py-2 font-medium">Year</th>
                  <th className="text-right py-2 px-3 font-medium">Principal Paid</th>
                  <th className="text-right py-2 px-3 font-medium">Scheduled Principal</th>
                  <th className="text-right py-2 px-3 font-medium">Topup Paid</th>
                  <th className="text-right py-2 pl-3 font-medium">Cumulative Topup</th>
                </tr>
              </thead>
              <tbody>
                {topupRows.map((y) => (
                  <tr key={`topup-${y.year}`} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 font-medium text-gray-900 dark:text-white">{y.year}</td>
                    <td className="py-2 px-3 text-right text-blue-600">{fmt(y.principal_paid)}</td>
                    <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-300">{fmt(y.expected_principal_paid)}</td>
                    <td className="py-2 px-3 text-right text-indigo-600 dark:text-indigo-400">{fmt(y.principal_topup_paid)}</td>
                    <td className="py-2 pl-3 text-right font-semibold text-indigo-700 dark:text-indigo-300">{fmt(y.principal_topup_cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Yearly Performance */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Yearly Performance</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">Click a year to expand details</p>
          </div>
          <button onClick={exportXLS} className="btn-secondary flex items-center gap-1.5 text-xs">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 dark:text-gray-400 border-b">
                <th className="text-left py-2 font-medium">Year</th>
                <th className="text-right py-2 font-medium">Rental Income</th>
                <th className="text-right py-2 font-medium">Cash Flow</th>
                <th className="text-right py-2 font-medium">Tax Income</th>
                <th className="text-right py-2 font-medium">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <Fragment key={y.year}>
                  <tr
                    onClick={() => setExpandedYear(expandedYear === y.year ? null : y.year)}
                    className="border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="py-2 pr-2 font-medium">
                      {y.is_partial ? `${y.year}*` : y.year}
                      <ChevronDown className={`w-3 h-3 inline ml-1 text-gray-400 dark:text-gray-500 transition-transform ${expandedYear === y.year ? 'rotate-180' : ''}`} />
                    </td>
                    <td className="py-2 px-2 text-right text-green-700">{fmt(y.rental_income)}</td>
                    <td className={`py-2 px-2 text-right ${y.cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(y.cash_flow)}</td>
                    <td className={`py-2 px-2 text-right ${y.taxable_income < 0 ? 'text-purple-600' : 'text-gray-700 dark:text-gray-300'}`}>{fmt(y.taxable_income)}</td>
                    <td className="py-2 pl-2 text-right text-gray-600">{y.occupancy != null ? fmtPct(y.occupancy) : '—'}</td>
                  </tr>
                  {expandedYear === y.year && (
                      <tr key={`${y.year}-detail`} className="bg-blue-50 dark:bg-blue-950/30">
                      <td colSpan={5} className="py-3 px-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                          <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Expenses</div><div className="font-medium">{fmt(y.operating_expenses)}</div></div>
                        <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Interest</div><div className="font-medium text-orange-600">{fmt(y.interest_paid)}</div></div>
                        <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Principal</div><div className="font-medium text-blue-600">{fmt(y.principal_paid)}</div></div>
                        <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Topup</div><div className="font-medium text-indigo-600 dark:text-indigo-400">{fmt(y.principal_topup_paid)}</div></div>
                        <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Taxes</div><div className="font-medium">{fmt(y.taxes_paid)}</div></div>
                          <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Depreciation</div><div className="font-medium text-purple-600">{fmt(y.depreciation)}</div></div>
                          <div><div className="text-gray-500 dark:text-gray-400 mb-0.5">Data Source</div><div className="font-medium capitalize text-gray-600">{y.source || '—'}</div></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold text-xs text-gray-800">
                <td className="pt-2">Total</td>
                <td className="pt-2 px-2 text-right text-green-700">{fmt(lifetime.total_rental_income)}</td>
                <td className={`pt-2 px-2 text-right ${lifetime.total_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(lifetime.total_cash_flow)}</td>
                <td className={`pt-2 px-2 text-right ${lifetime.total_taxable_income < 0 ? 'text-purple-600' : 'text-gray-700 dark:text-gray-300'}`}>{fmt(lifetime.total_taxable_income)}</td>
                <td className="pt-2 pl-2 text-right">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {yearly.some(y => y.is_partial) && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 flex items-center gap-1.5">
            <Info className="w-3 h-3 shrink-0" />
            *Partial year — current year values are annualized projections.
          </p>
        )}
      </div>

      {/* 7. Insights & Recommendations */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Insights &amp; Recommendations</h3>
        <div className="space-y-2">
          {insights.map((ins, i) => {
            const colors = { green: 'text-green-700 bg-green-50', yellow: 'text-yellow-700 bg-yellow-50', red: 'text-red-600 bg-red-50 dark:bg-red-900/20' }
            const dots   = { green: '🟢', yellow: '🟡', red: '🔴' }
            return (
              <div key={i} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-sm ${colors[ins.t]}`}>
                <span className="shrink-0 mt-0.5">{dots[ins.t]}</span>
                <span>{ins.msg}</span>
              </div>
            )
          })}
          {insights.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Add lease and loan data to generate property insights.</p>
          )}
        </div>
      </div>

    </div>
  )
}

function SumRow({ label, value, color = 'text-gray-700 dark:text-gray-300', bold, plus }) {
  const abs = Math.abs(value || 0)
  const neg = (value || 0) < 0
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={color}>{!neg && plus ? '+' : neg ? '–' : ''}{fmt(abs)}</span>
    </div>
  )
}



function AnalysisCard({ label, value, sub, color }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color || 'text-gray-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
    </div>
  )
}
