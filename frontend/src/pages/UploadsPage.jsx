import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { propAPI, docAPI } from '../services/api'
import {
  Upload, FileText, Trash2, ChevronDown, Wand2, Building2,
  RefreshCw, FileSpreadsheet, PenLine, Download, CheckCircle2,
  ArrowRight, AlertCircle, X, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'

const CATEGORIES = [
  { value: 'auto',               label: 'Auto-detect' },
  { value: 'mortgage_statement', label: 'Mortgage Statement' },
  { value: 'closing_statement',  label: 'Closing Statement (ALTA / HUD-1)' },
  { value: 'tax_return',         label: 'Tax Return (Schedule E)' },
  { value: '1098',               label: '1098 – Mortgage Interest' },
  { value: '1099',               label: '1099 Year-End' },
  { value: 'loan_disclosure',    label: 'Loan Disclosure' },
  { value: 'bank_statement',     label: 'Bank Statement' },
  { value: 'property_tax',       label: 'Property Tax Statement' },
  { value: 'other',              label: 'Other' },
]

const METHODS = [
  {
    id: 'document',
    Icon: FileText,
    title: 'Document Upload',
    badge: 'PDF / CSV / XLSX',
    desc: 'Mortgage statements, tax returns (Schedule E), 1098/1099 forms, property tax bills, and closing statements. Data is extracted automatically.',
    accent: '#2563eb',
    bg: '#eff6ff',
    border: '#93c5fd',
  },
  {
    id: 'spreadsheet',
    Icon: FileSpreadsheet,
    title: 'Spreadsheet Import',
    badge: 'CSV template',
    desc: 'Download our pre-filled template with your properties, enter income and expense figures for each year, then upload to import all at once.',
    accent: '#059669',
    bg: '#f0fdf4',
    border: '#6ee7b7',
  },
  {
    id: 'manual',
    Icon: PenLine,
    title: 'Manual Entry',
    badge: 'Form input',
    desc: 'Select a property and tax year then type in rental income, interest, taxes, depreciation, and net income directly.',
    accent: '#7c3aed',
    bg: '#f5f3ff',
    border: '#c4b5fd',
  },
]

const fmtSize = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
const catLabel = (val) => CATEGORIES.find((c) => c.value === val)?.label || val
const CURRENT_YEAR = new Date().getFullYear()

export default function UploadsPage() {
  const [mode, setMode] = useState('document')
  const [properties, setProperties] = useState([])
  const [docs, setDocs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [result, setResult]     = useState(null)  // success state

  // ── document upload ──
  const [propertyId, setPropertyId] = useState('')
  const [category, setCategory]     = useState('auto')
  const [uploading, setUploading]   = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const fileInputRef = useRef()

  // ── manual entry ──
  const [mPropId, setMPropId]   = useState('')
  const [mYear,   setMYear]     = useState(CURRENT_YEAR - 1)
  const [mFields, setMFields]   = useState({
    rents_received: '', mortgage_interest: '', property_taxes: '',
    depreciation: '', total_expenses: '', net_income: '',
  })
  const [mPropFields, setMPropFields] = useState({ market_value: '', purchase_price: '', monthly_rent: '' })
  const [mLoanFields, setMLoanFields] = useState({
    original_loan_amount: '', current_balance: '', interest_rate: '', loan_type: 'Fixed', monthly_payment: '',
  })
  const [saving, setSaving]         = useState(false)
  const [savingProp, setSavingProp] = useState(false)
  const [savingLoan, setSavingLoan] = useState(false)

  useEffect(() => {
    if (!mPropId || !properties.length) return
    const prop = properties.find(p => String(p.id) === String(mPropId))
    if (!prop) return
    setMPropFields({
      market_value:   prop.market_value   || '',
      purchase_price: prop.purchase_price || '',
      monthly_rent:   prop.monthly_rent   || '',
    })
    const loan = prop.loans?.[0]
    setMLoanFields({
      original_loan_amount: loan?.original_loan_amount || '',
      current_balance:      loan?.current_balance      || '',
      interest_rate:        loan?.interest_rate        || '',
      loan_type:            loan?.loan_type            || 'Fixed',
      monthly_payment:      loan?.monthly_payment      || '',
    })
  }, [mPropId, properties])

  const loadDocs = () => docAPI.listAll().then((r) => setDocs(r.data))
  const loadProps = () => propAPI.list().then((r) => setProperties(r.data))

  useEffect(() => {
    Promise.all([loadProps(), loadDocs()])
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const isTaxReturn = category === 'tax_return'

  // ── Document upload handler ──────────────────────────────────────────────
  const handleUpload = async (files) => {
    if (!files.length) return
    setUploading(true)
    setResult(null)
    let uploaded = 0, created = 0
    for (const file of files) {
      const fd = new FormData()
      if (propertyId && !isTaxReturn) fd.append('property_id', propertyId)
      fd.append('category', category)
      fd.append('file', file)
      try {
        const { data } = await docAPI.upload(fd)
        uploaded++
        if (data.property_created) created++
        if (data.tax_entries_imported > 0)
          toast.success(`${data.tax_entries_imported} propert${data.tax_entries_imported === 1 ? 'y' : 'ies'} updated from tax return`, { duration: 5000 })
        else
          toast.success(`Uploaded: ${data.original_filename} (${catLabel(data.category)})`)
      } catch (err) {
        toast.error(err.response?.data?.detail || `Upload failed: ${file.name}`)
      }
    }
    setUploading(false)
    await Promise.all([loadDocs(), loadProps()])
    if (uploaded) setResult({ type: 'upload', count: uploaded, created })
  }

  // ── Spreadsheet template download ────────────────────────────────────────
  const downloadTemplate = () => {
    const headers = [
      // Property identification
      'Property Address', 'City', 'State', 'Zip Code',
      // Property details (update anytime)
      'Market Value', 'Purchase Price', 'Monthly Rent',
      // Loan details (first/primary loan)
      'Original Loan Amount', 'Current Balance', 'Interest Rate (%)', 'Loan Type (Fixed/ARM)', 'Monthly P&I',
      // Annual tax-year financials (one row per year)
      'Tax Year', 'Rental Income', 'Mortgage Interest', 'Property Taxes',
      'Depreciation', 'Total Expenses', 'Net Income', 'Notes',
    ]
    const years = [CURRENT_YEAR - 2, CURRENT_YEAR - 1]
    const rows = []
    if (properties.length) {
      for (const p of properties) {
        const loan = p.loans?.[0]
        for (const yr of years) {
          rows.push([
            p.address.split(',')[0], p.city || '', p.state || '', p.zip_code || '',
            p.market_value   || '', p.purchase_price || '', p.monthly_rent || '',
            loan?.original_loan_amount || '', loan?.current_balance || '',
            loan?.interest_rate || '', loan?.loan_type || 'Fixed', loan?.monthly_payment || '',
            yr, '', '', '', '', '', '', '',
          ])
        }
      }
    } else {
      rows.push([
        '123 Maple St', 'Oakland', 'CA', '94601',
        '450000', '380000', '3200',
        '300000', '282000', '6.5', 'Fixed', '1897',
        CURRENT_YEAR - 1, '38400', '24000', '5600', '6420', '36020', '2380', 'Example row',
      ])
    }
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'propertylens_import_template.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('Template downloaded — fill it in and upload below')
  }

  // ── Manual entry handler ─────────────────────────────────────────────────
  const handlePropSave = async () => {
    if (!mPropId) { toast.error('Select a property first'); return }
    const payload = {}
    if (mPropFields.market_value   !== '') payload.market_value   = parseFloat(mPropFields.market_value)
    if (mPropFields.purchase_price !== '') payload.purchase_price = parseFloat(mPropFields.purchase_price)
    if (mPropFields.monthly_rent   !== '') payload.monthly_rent   = parseFloat(mPropFields.monthly_rent)
    if (!Object.keys(payload).length) { toast('Nothing to update'); return }
    setSavingProp(true)
    try {
      await propAPI.update(mPropId, payload)
      await loadProps()
      toast.success('Property details saved')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setSavingProp(false)
    }
  }

  const handleLoanSave = async () => {
    if (!mPropId) { toast.error('Select a property first'); return }
    if (!mLoanFields.interest_rate) { toast.error('Interest rate is required'); return }
    setSavingLoan(true)
    try {
      const payload = {
        loan_type:     mLoanFields.loan_type,
        interest_rate: parseFloat(mLoanFields.interest_rate),
      }
      if (mLoanFields.original_loan_amount !== '') payload.original_loan_amount = parseFloat(mLoanFields.original_loan_amount)
      if (mLoanFields.current_balance      !== '') payload.current_balance      = parseFloat(mLoanFields.current_balance)
      if (mLoanFields.monthly_payment      !== '') payload.monthly_payment      = parseFloat(mLoanFields.monthly_payment)
      const prop = properties.find(p => String(p.id) === String(mPropId))
      const existingLoan = prop?.loans?.[0]
      if (existingLoan) {
        await propAPI.updateLoan(mPropId, existingLoan.id, payload)
        toast.success('Loan updated')
      } else {
        await propAPI.addLoan(mPropId, payload)
        toast.success('Loan added')
      }
      await loadProps()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Loan save failed')
    } finally {
      setSavingLoan(false)
    }
  }

  const handleManualSave = async () => {
    if (!mPropId) { toast.error('Select a property first'); return }
    setSaving(true)
    try {
      const payload = { tax_year: parseInt(mYear) }
      Object.entries(mFields).forEach(([k, v]) => {
        if (v !== '') payload[k] = parseFloat(v)
      })
      await propAPI.upsertYearEntry(mPropId, payload)
      toast.success(`${mYear} data saved successfully`)
      setMFields({ rents_received:'', mortgage_interest:'', property_taxes:'', depreciation:'', total_expenses:'', net_income:'' })
      setResult({ type: 'manual', year: mYear, prop: properties.find(p => String(p.id) === String(mPropId))?.address || '' })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete   = async (id) => { if (!confirm('Delete this document?')) return; await docAPI.delete(id); toast.success('Deleted'); loadDocs() }
  const handleApply    = async (id) => { try { const { data } = await docAPI.apply(id); toast(data.message, { icon: Object.keys(data.applied||{}).length ? '✅' : 'ℹ️' }) } catch(e) { toast.error(e.response?.data?.detail||'Apply failed') } }
  const handleReparse  = async (id) => { try { await docAPI.reparse(id); toast.success('Re-parsed'); loadDocs() } catch { toast.error('Re-parse failed') } }
  const handleReprocessAll = async () => {
    if (!confirm('Re-extract all files with the latest parser?')) return
    setReprocessing(true)
    try { const { data } = await docAPI.reprocessAll(); toast.success(`Reprocessed ${data.reprocessed} of ${data.total}`); await Promise.all([loadDocs(), loadProps()]) }
    catch { toast.error('Reprocess failed') }
    finally { setReprocessing(false) }
  }

  const switchMode = (id) => { setMode(id); setResult(null) }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const activeMethod = METHODS.find((m) => m.id === mode)

  return (
<div className="max-w-5xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Import Property Data</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Three ways to bring in your rental property financials — mix and match as needed.
        </p>
      </div>

      {/* ── No properties tip ── */}
      {properties.length === 0 && (
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 flex items-start gap-3">
          <Building2 className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold">No properties yet.</p>
            <p className="text-blue-600 mt-0.5">Upload a mortgage statement and the property + loan are created automatically from the document address.</p>
          </div>
        </div>
      )}

      {/* ── Method cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {METHODS.map((m) => {
          const active = mode === m.id
          return (
            <button key={m.id} onClick={() => switchMode(m.id)}
className="text-left rounded-xl border-2 p-5 transition-all focus:outline-none bg-white dark:bg-gray-800"
              style={active
                ? { borderColor: m.accent, background: m.bg }
: { borderColor: '#e2e8f0' }
              }
            >
              <div className="flex items-start justify-between mb-3">
<div className="rounded-lg p-2 bg-slate-100 dark:bg-gray-700" style={active ? { background: m.accent } : undefined}>
                  <m.Icon className="w-5 h-5" style={{ color: active ? '#fff' : '#94a3b8' }} />
                </div>
                {active && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5"
                    style={{ background: m.accent, color: '#fff' }}>
                    Active
                  </span>
                )}
              </div>
              <p className="font-semibold text-slate-900 dark:text-white text-sm">{m.title}</p>
              <p className="text-[11px] font-medium mt-0.5 mb-2" style={{ color: active ? m.accent : '#94a3b8' }}>{m.badge}</p>
              <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">{m.desc}</p>
            </button>
          )
        })}
      </div>

      {/* ── Success state ── */}
      {result && (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-6 flex items-start gap-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            {result.type === 'upload' && (
              <>
                <p className="font-semibold text-emerald-900 text-lg">Upload complete</p>
                <p className="text-sm text-emerald-700 mt-0.5">
                  {result.count} file{result.count > 1 ? 's' : ''} uploaded
                  {result.created > 0 && ` · ${result.created} new propert${result.created > 1 ? 'ies' : 'y'} created`}
                </p>
              </>
            )}
            {result.type === 'manual' && (
              <>
                <p className="font-semibold text-emerald-900 text-lg">{result.year} data saved</p>
                <p className="text-sm text-emerald-700 mt-0.5">{result.prop}</p>
              </>
            )}
            <div className="flex items-center gap-3 mt-4">
              <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-900">
                View Dashboard <ArrowRight className="w-4 h-4" />
              </Link>
              <button onClick={() => setResult(null)}
                className="text-sm text-emerald-600 hover:text-emerald-800 flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5" /> Import more
              </button>
            </div>
          </div>
          <button onClick={() => setResult(null)} className="text-emerald-400 hover:text-emerald-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Active mode panel ── */}
      <div className="rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">

        {/* Panel header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-gray-700"
          style={{ background: activeMethod.bg }}>
          <div className="rounded-lg p-2" style={{ background: activeMethod.accent }}>
            <activeMethod.Icon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white text-sm">{activeMethod.title}</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">{activeMethod.badge}</p>
          </div>
        </div>

        <div className="p-6">

          {/* ═══ DOCUMENT UPLOAD ═══════════════════════════════════════════════ */}
          {mode === 'document' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">Property</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 dark:border-gray-600 px-3 py-2 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    value={isTaxReturn ? '' : propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    disabled={isTaxReturn}
                  >
                    {isTaxReturn
                      ? <option value="">Common — linked via Schedule E addresses</option>
                      : <>
                          <option value="">Auto-detect from document</option>
                          {properties.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
                        </>
                    }
                  </select>
                  <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">
                    {isTaxReturn
                      ? 'Tax returns are matched to properties by address on Schedule E'
                      : !propertyId ? 'The address in the document is used to match or create a property' : ''}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">Document Type</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 dark:border-gray-600 px-3 py-2 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={category} onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload([...e.dataTransfer.files]) }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                className={`rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 dark:border-gray-600 hover:border-blue-300 hover:bg-slate-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <Upload className="w-10 h-10 text-slate-300 dark:text-gray-600 mx-auto mb-4" />
                {uploading
                  ? <p className="text-sm font-semibold text-blue-600 animate-pulse">Uploading…</p>
                  : <>
                      <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">Drop files here or click to browse</p>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">PDF, XLSX, XLS, CSV · Max 20 MB · Multiple files supported</p>
                    </>
                }
                <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.xlsx,.xls,.csv"
                  onChange={(e) => { handleUpload([...e.target.files]); e.target.value = '' }} />
              </div>

              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-100 px-4 py-3 flex items-start gap-2 text-xs text-amber-800">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                <p>If a document can't be parsed automatically, try the Spreadsheet or Manual Entry options instead.</p>
              </div>
            </div>
          )}

          {/* ═══ SPREADSHEET IMPORT ════════════════════════════════════════════ */}
          {mode === 'spreadsheet' && (
            <div className="space-y-6">

              {/* Step 1: Download */}
              <div className="flex gap-4 items-start">
                <div className="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white text-sm">Download the template</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 mb-3">
                    The template is pre-populated with your existing properties and the last two tax years.
                    Open it in Excel or Google Sheets and fill in the financial figures.
                  </p>
                  <button onClick={downloadTemplate}
                    className="inline-flex items-center gap-2 rounded-lg border-2 border-emerald-600 bg-emerald-600 text-white text-sm font-semibold px-4 py-2 hover:bg-emerald-700 transition-colors">
                    <Download className="w-4 h-4" /> Download Template CSV
                  </button>
                </div>
              </div>

              {/* Column guide */}
              <div className="ml-11 rounded-xl border border-slate-200 dark:border-gray-600 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 dark:bg-gray-700/50 border-b border-slate-200 dark:border-gray-600">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">Template columns — all fields supported</p>
                </div>
                <div className="px-4 py-2 bg-slate-50 dark:bg-gray-700/50 border-b border-slate-100 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Property &amp; Loan (set once)</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-0 divide-y divide-slate-100 border-b border-slate-200 dark:border-gray-600">
                  {[
                    ['Property Address', 'Street address (must match existing)'],
                    ['City / State / Zip', 'Location fields'],
                    ['Market Value', 'Current estimated value'],
                    ['Purchase Price', 'Original acquisition price'],
                    ['Monthly Rent', 'Current effective rent'],
                    ['Original Loan Amount', 'Amount at origination'],
                    ['Current Balance', 'Outstanding loan balance'],
                    ['Interest Rate (%)', 'Annual rate e.g. 6.75'],
                    ['Loan Type (Fixed/ARM)', '"Fixed" or "ARM"'],
                    ['Monthly P&I', 'Principal + interest payment'],
                  ].map(([col, hint]) => (
                    <div key={col} className="px-4 py-2.5">
                      <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">{col}</p>
                      <p className="text-[11px] text-slate-400 dark:text-gray-500">{hint}</p>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 bg-slate-50 dark:bg-gray-700/50 border-b border-slate-100 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">Tax Year Financials (one row per year)</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-0 divide-y divide-slate-100">
                  {[
                    ['Tax Year', 'e.g. 2024'],
                    ['Rental Income', 'Gross rent received'],
                    ['Mortgage Interest', 'From 1098 / Schedule E'],
                    ['Property Taxes', 'Annual tax bill'],
                    ['Depreciation', 'Annual depreciation'],
                    ['Total Expenses', 'All deductible expenses'],
                    ['Net Income', 'Taxable rental income'],
                    ['Notes', 'Optional notes per row'],
                  ].map(([col, hint]) => (
                    <div key={col} className="px-4 py-2.5">
                      <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">{col}</p>
                      <p className="text-[11px] text-slate-400 dark:text-gray-500">{hint}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-100 dark:border-gray-700" />

              {/* Step 2: Upload */}
              <div className="flex gap-4 items-start">
                <div className="w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white text-sm">Upload the filled template</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 mb-3">Upload your completed CSV or XLSX file. Each row creates or updates year data for that property.</p>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); setCategory('tax_return'); handleUpload([...e.dataTransfer.files]) }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                      dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 dark:border-gray-600 hover:border-emerald-300 hover:bg-slate-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <FileSpreadsheet className="w-9 h-9 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
                    {uploading
                      ? <p className="text-sm font-semibold text-emerald-600 animate-pulse">Uploading…</p>
                      : <>
                          <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">Drop your filled CSV / XLSX here</p>
                          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">CSV or XLSX · Max 20 MB</p>
                        </>
                    }
                    <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls"
                      onChange={(e) => { setCategory('tax_return'); handleUpload([...e.target.files]); e.target.value = '' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ MANUAL ENTRY ══════════════════════════════════════════════════ */}
          {mode === 'manual' && (
            <div className="space-y-6">

              {/* Property selector — shared across all sections */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">Property <span className="text-red-500">*</span></label>
                <select
                  className="w-full rounded-lg border border-slate-200 dark:border-gray-600 px-3 py-2 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  value={mPropId} onChange={(e) => setMPropId(e.target.value)}
                >
                  <option value="">Select a property…</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.address}</option>)}
                </select>
              </div>

              {/* ── SECTION A: Property Details ── */}
              <div className="rounded-xl border border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/50 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">A · Property Details</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Current valuation and rental income — used for equity, LTV, and cash flow metrics</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { key: 'market_value',   label: 'Current Market Value', hint: 'Estimated value today',      prefix: '$' },
                    { key: 'purchase_price', label: 'Purchase Price',       hint: 'Original acquisition price', prefix: '$' },
                    { key: 'monthly_rent',   label: 'Monthly Rent',         hint: 'Current effective rent',     prefix: '$' },
                  ].map(({ key, label, hint, prefix }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">{label}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 text-sm">{prefix}</span>
                        <input type="number" step="1" placeholder="0"
                          value={mPropFields[key]}
                          onChange={(e) => setMPropFields(p => ({ ...p, [key]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-7 pr-3 py-2 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{hint}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button onClick={handlePropSave} disabled={savingProp || !mPropId}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white text-xs font-semibold px-4 py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {savingProp ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save Property Details'}
                  </button>
                </div>
              </div>

              {/* ── SECTION B: Loan Details ── */}
              <div className="rounded-xl border border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/50 p-5">
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">B · Loan Details</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    Primary mortgage — used for DSCR, paydown progress, and financing metrics
                    {mPropId && properties.find(p => String(p.id) === String(mPropId))?.loans?.length > 0 && (
                      <span className="ml-1 text-violet-500 font-medium">· Existing loan will be updated</span>
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { key: 'original_loan_amount', label: 'Original Loan Amount', hint: 'Amount at origination',      prefix: '$', type: 'number' },
                    { key: 'current_balance',       label: 'Current Balance',      hint: 'Outstanding loan balance',   prefix: '$', type: 'number' },
                    { key: 'monthly_payment',        label: 'Monthly P&I',          hint: 'Principal + interest only',  prefix: '$', type: 'number' },
                    { key: 'interest_rate',          label: 'Interest Rate',         hint: 'Annual rate (e.g. 6.75)',    prefix: '%', type: 'number', required: true },
                  ].map(({ key, label, hint, prefix, type, required }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">
                        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 text-sm">{prefix}</span>
                        <input type={type} step="0.01" placeholder="0"
                          value={mLoanFields[key]}
                          onChange={(e) => setMLoanFields(p => ({ ...p, [key]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-7 pr-3 py-2 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{hint}</p>
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">Loan Type</label>
                    <div className="flex gap-3 mt-2">
                      {['Fixed', 'ARM'].map((lt) => (
                        <label key={lt} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="loan_type" value={lt} checked={mLoanFields.loan_type === lt}
                            onChange={(e) => setMLoanFields(p => ({ ...p, loan_type: e.target.value }))}
                            className="h-4 w-4 text-violet-600 border-slate-300 focus:ring-violet-500" />
                          <span className="text-sm text-slate-700 dark:text-gray-300">{lt}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-2">ARM = adjustable-rate mortgage</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button onClick={handleLoanSave} disabled={savingLoan || !mPropId}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white text-xs font-semibold px-4 py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {savingLoan ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : (
                      properties.find(p => String(p.id) === String(mPropId))?.loans?.length > 0 ? 'Update Loan' : 'Add Loan'
                    )}
                  </button>
                </div>
              </div>

              {/* ── SECTION C: Tax Year Data ── */}
              <div className="rounded-xl border border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/50 p-5">
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">C · Annual Tax Data</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Schedule E figures for a specific tax year — drives YoY trend and net income heatmap</p>
                  </div>
                  <div className="shrink-0">
                    <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1">Tax Year</label>
                    <select className="rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      value={mYear} onChange={(e) => setMYear(e.target.value)}>
                      {Array.from({ length: 12 }, (_, i) => CURRENT_YEAR - i).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { key: 'rents_received',   label: 'Rental Income',      hint: 'Gross rent received (line 3)',      color: '#059669' },
                    { key: 'mortgage_interest', label: 'Mortgage Interest',  hint: 'From 1098 / Schedule E line 12',   color: '#dc2626' },
                    { key: 'property_taxes',    label: 'Property Taxes',     hint: 'Annual property tax (line 16)',     color: '#d97706' },
                    { key: 'depreciation',      label: 'Depreciation',       hint: 'Annual depreciation (line 18)',     color: '#7c3aed' },
                    { key: 'total_expenses',    label: 'Total Expenses',     hint: 'All deductible expenses (line 20)', color: '#0891b2' },
                    { key: 'net_income',        label: 'Net Taxable Income', hint: 'Income minus expenses (line 21)',   color: '#2563eb' },
                  ].map(({ key, label, hint, color }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">{label}</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 text-sm">$</span>
                        <input type="number" step="0.01" placeholder="0"
                          value={mFields[key]}
                          onChange={(e) => setMFields((p) => ({ ...p, [key]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-7 pr-3 py-2 text-sm text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                          style={{ '--ring': color }} />
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{hint}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-200 dark:border-gray-600 pt-4">
                  <p className="text-xs text-slate-400 dark:text-gray-500">
                    {mYear} data for{' '}
                    <span className="font-medium text-slate-600 dark:text-gray-300">
                      {mPropId && properties.find(p => String(p.id) === String(mPropId))
                        ? properties.find(p => String(p.id) === String(mPropId)).address.split(',')[0]
                        : 'selected property'}
                    </span>
                    . Existing entry will be updated.
                  </p>
                  <button onClick={handleManualSave} disabled={saving || !mPropId}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 text-white text-xs font-semibold px-4 py-2 hover:bg-violet-700 disabled:opacity-50 transition-colors">
                    {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <>Save Tax Data <ArrowRight className="w-3.5 h-3.5" /></>}
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>

      {/* ── Document list ── */}
      <div className="rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-gray-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">Uploaded Documents</p>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">{docs.length} file{docs.length !== 1 ? 's' : ''}</p>
          </div>
          {docs.length > 0 && (
            <button onClick={handleReprocessAll} disabled={reprocessing}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700/50 disabled:opacity-50 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${reprocessing ? 'animate-spin' : ''}`} />
              {reprocessing ? 'Reprocessing…' : 'Reprocess All'}
            </button>
          )}
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 text-slate-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 dark:text-gray-500">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {docs.map((doc) => (
              <DocRow key={doc.id} doc={doc}
                onDelete={() => handleDelete(doc.id)}
                onApply={() => handleApply(doc.id)}
                onReparse={() => handleReparse(doc.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Doc row ────────────────────────────────────────────────────────────────────
function DocRow({ doc, onDelete, onApply, onReparse }) {
  const [expanded, setExpanded]       = useState(false)
  const [showMarkdown, setShowMarkdown] = useState(false)
  const [markdown, setMarkdown]       = useState(null)

  const data       = doc.extracted_data || {}
  const hasData    = Object.keys(data).length > 0 && !data.parse_error
  const applicable = hasData && !data.raw_text_preview

  const toggleMarkdown = async () => {
    if (showMarkdown) { setShowMarkdown(false); return }
    if (markdown === null) {
      try { const { data: md } = await docAPI.markdown(doc.id); setMarkdown(md) }
      catch { toast.error('Markdown not available'); return }
    }
    setShowMarkdown(true)
    setExpanded(false)
  }

  const catColor = {
    mortgage_statement: '#2563eb',
    tax_return:         '#7c3aed',
    '1098':             '#0891b2',
    property_tax:       '#d97706',
    closing_statement:  '#059669',
  }[doc.doc_category] || '#94a3b8'

  return (
    <div className="hover:bg-slate-50 dark:hover:bg-gray-700/50 transition-colors">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: catColor }} />
        <FileText className="w-4 h-4 shrink-0" style={{ color: catColor }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{doc.original_filename}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {doc.property_id
              ? <Link to={`/properties/${doc.property_id}`} className="text-xs text-blue-600 hover:text-blue-800 hover:underline">{doc.property_address}</Link>
              : <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">Common</span>
            }
            <span className="text-xs text-slate-400 dark:text-gray-500">·</span>
            <span className="text-xs text-slate-500 dark:text-gray-400">{catLabel(doc.doc_category)}</span>
            {doc.file_size > 0 && <><span className="text-xs text-slate-400 dark:text-gray-500">·</span><span className="text-xs text-slate-400 dark:text-gray-500">{fmtSize(doc.file_size)}</span></>}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasData && (
            <button onClick={() => { setExpanded(!expanded); setShowMarkdown(false) }}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors">
              Data <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          {doc.has_markdown && (
            <button onClick={toggleMarkdown}
              className="text-xs text-violet-500 hover:text-violet-700 px-2 py-1 rounded hover:bg-violet-50 transition-colors">
              {showMarkdown ? 'Hide' : 'MD'}
            </button>
          )}
          <button onClick={onReparse} title="Re-parse with latest parser"
            className="p-1.5 rounded text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:text-gray-300 hover:bg-slate-100 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {applicable && (
            <button onClick={onApply} title="Apply extracted data to property"
              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 px-2 py-1 rounded hover:bg-emerald-50 transition-colors">
              <Wand2 className="w-3.5 h-3.5" /> Apply
            </button>
          )}
          <button onClick={onDelete}
            className="p-1.5 rounded text-slate-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showMarkdown && markdown !== null && (
        <div className="bg-slate-900 border-t border-slate-200 dark:border-gray-600 px-5 py-3 overflow-auto max-h-72">
          <pre className="text-xs text-slate-200 dark:text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">{markdown}</pre>
        </div>
      )}

      {expanded && hasData && (
        <div className="bg-slate-50 dark:bg-gray-700/50 border-t border-slate-100 dark:border-gray-700 px-5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-2">Extracted Data</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
            {Object.entries(data).filter(([k]) => !['raw_text_preview'].includes(k)).map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs py-0.5">
                <span className="text-slate-400 dark:text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                <span className="font-medium text-slate-700 dark:text-gray-300 ml-2 truncate">{typeof v === 'number' ? v.toLocaleString() : String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
