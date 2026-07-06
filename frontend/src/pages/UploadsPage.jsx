import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { propAPI, docAPI } from '../services/api'
import {
  Upload, FileText, Trash2, ChevronDown, Wand2, Building2,
  RefreshCw, FileSpreadsheet, PenLine, Download, CheckCircle2,
  ArrowRight, AlertCircle, AlertTriangle, X, RotateCcw, Copy,
  Filter, ArrowUpDown, Layers, Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { propertyLabel, shortPropertyUid } from '../utils/propertyDisplay'
import { useAuth } from '../hooks/useAuth'

function monthlyPI(principal, annualRatePct, years = 30) {
  const months = years * 12
  const monthlyRate = (annualRatePct || 0) / 100 / 12
  if (!principal || !months) return 0
  if (!monthlyRate) return Math.round((principal / months) * 100) / 100
  const payment = principal * (monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1)
  return Math.round(payment * 100) / 100
}

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
  { value: 'deed_title',         label: 'Deed / Title' },
  { value: 'insurance_declaration', label: 'Insurance Policy Declaration' },
  { value: 'expense_receipt',    label: 'Operating Expense Receipt' },
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
const CADENCE_BY_CATEGORY = {
  closing_statement: 'one_time',
  loan_disclosure: 'one_time',
  deed_title: 'one_time',
  '1098': 'annual',
  '1099': 'annual',
  property_tax: 'annual',
  insurance_declaration: 'annual',
  tax_return: 'annual',
  expense_receipt: 'annual',
  mortgage_statement: 'monthly',
}
const CADENCE_LABELS = { one_time: 'One-Time', annual: 'Annual', monthly: 'Monthly', other: 'Other' }
const cadenceOf = (category) => CADENCE_BY_CATEGORY[category] || 'other'
const CURRENT_YEAR = new Date().getFullYear()
const fmtMoney = (n) => n === null || n === undefined
  ? '—'
  : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const YEAR_FIELD_RE = /year$/i
// Years must never pick up thousands separators ("2,024"); money/count
// fields should. schedule1_line5_delta reads "n/a" (not "—") when the
// return's own Schedule 1 total wasn't found — that's a known cross-check
// gap, not a missing field.
const formatFieldValue = (key, value, allData) => {
  if (key === 'schedule1_line5_delta' && (value === null || value === undefined) && allData?.schedule1_line5_total == null) {
    return 'n/a'
  }
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    return YEAR_FIELD_RE.test(key) ? String(Math.trunc(value)) : value.toLocaleString()
  }
  return String(value)
}

function UploadProcessing({ tone = 'blue' }) {
  const color = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-300' : 'text-blue-600 dark:text-blue-400'
  const ring = tone === 'emerald' ? 'border-emerald-200 border-t-emerald-600 dark:border-emerald-900 dark:border-t-emerald-300' : 'border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-300'
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="relative h-14 w-14">
        <div className={`absolute inset-0 rounded-full border-4 ${ring} animate-spin`} />
        <div className="absolute inset-3 rounded-full bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center">
          <RefreshCw className={`h-5 w-5 ${color} animate-pulse`} />
        </div>
      </div>
      <div>
        <p className={`text-sm font-semibold ${color}`}>Uploading and extracting fields...</p>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Reading the document and preparing the preview.</p>
      </div>
    </div>
  )
}

export default function UploadsPage() {
const { user } = useAuth()
const isDemo = (user?.role || '').toLowerCase() === 'demo'
const [mode, setMode] = useState('manual')
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
  const [previewDoc, setPreviewDoc] = useState(null)
  const [acceptingPreview, setAcceptingPreview] = useState(false)
  const [uploadQueue, setUploadQueue] = useState([])

  // ── document list filters / grouping / sort ──
  const [docFilters, setDocFilters] = useState({
    property: '', category: '', scope: '', year: '', cadence: '', status: '',
  })
  const [groupBy, setGroupBy] = useState('none') // none | property | category | both
  const [sortDir, setSortDir] = useState('desc') // desc = newest first
  const [uploadProgress, setUploadProgress] = useState({ saved: 0, created: 0, total: 0 })
  const fileInputRef = useRef()

  // ── manual entry ──
  const [mPropId, setMPropId]   = useState('')
  const [mYear,   setMYear]     = useState(CURRENT_YEAR - 1)
  const [mFields, setMFields]   = useState({
    rents_received: '', mortgage_interest: '', property_taxes: '',
    depreciation: '', total_expenses: '', net_income: '',
  })
const [mPropFields, setMPropFields] = useState({
market_value: '', purchase_price: '', monthly_rent: '',
  })
  const [mLoanFields, setMLoanFields] = useState({
    original_loan_amount: '', current_balance: '', interest_rate: '', loan_type: 'Fixed', monthly_payment: '',
    loan_product: '', origination_date: '', loan_term_years: '',
    escrow_amount: '', escrow_included: false,
    estimated_total_monthly_payment: '', original_ltv: '',
    interest_paid_ytd: '', principal_paid_ytd: '',
    projected_principal_fy: '', projected_interest_fy: '',
    mortgage_tenure_covered: '',
  })
  const [saving, setSaving]         = useState(false)
  const [savingProp, setSavingProp] = useState(false)
const [savingLoan, setSavingLoan] = useState(false)

useEffect(() => {
if (isDemo && mode !== 'manual') setMode('manual')
}, [isDemo, mode])

const selectMode = (nextMode) => {
if (isDemo && nextMode !== 'manual') {
toast.error('Document upload and spreadsheet import are premium features. Demo mode supports Manual Entry.')
return
}
setMode(nextMode)
}

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
      original_loan_amount: loan?.original_amount || '',
      current_balance:      loan?.current_balance || '',
      interest_rate:        loan?.interest_rate   || '',
      loan_type:            loan?.loan_type       || 'Fixed',
      monthly_payment:      loan?.monthly_payment || '',
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
  const previewNextFile = async (
    queue,
    saved = uploadProgress.saved,
    created = uploadProgress.created,
    uploadCategory = category,
    uploadPropertyId = propertyId,
  ) => {
    if (!queue.length) {
      setUploadQueue([])
      setPreviewDoc(null)
      setUploading(false)
      await Promise.all([loadDocs(), loadProps()])
      if (saved) setResult({ type: 'upload', count: saved, created })
      return
    }

    const [nextFile, ...rest] = queue
    setUploadQueue(rest)
    setUploading(true)
    try {
      const fd = new FormData()
      if (uploadPropertyId && uploadCategory !== 'tax_return') fd.append('property_id', uploadPropertyId)
      fd.append('category', uploadCategory)
      fd.append('file', nextFile)
      const { data } = await docAPI.previewUpload(fd)
      setPreviewDoc({
        ...data,
        selectedPropertyId: uploadPropertyId && uploadCategory !== 'tax_return' ? uploadPropertyId : null,
        uploadCategory,
        uploadPropertyId,
        remainingCount: rest.length,
      })
    } catch (err) {
      toast.error(err.response?.data?.detail || `Upload failed: ${nextFile.name}`)
      await previewNextFile(rest, saved, created, uploadCategory, uploadPropertyId)
    } finally {
      setUploading(false)
    }
  }

const handleUpload = async (files, options = {}) => {
if (isDemo) {
toast.error('Document upload and spreadsheet import are premium features. Use Manual Entry in demo mode.')
return
}
const selectedFiles = [...files]
    if (!selectedFiles.length) return
    const uploadCategory = options.category || category
    const uploadPropertyId = options.propertyId ?? propertyId
    setResult(null)
    setUploadProgress({ saved: 0, created: 0, total: selectedFiles.length })
    await previewNextFile(selectedFiles, 0, 0, uploadCategory, uploadPropertyId)
  }

const handleAcceptPreview = async ({ force = false, replaceDocumentId = null } = {}) => {
if (!previewDoc) return
if (isDemo) {
toast.error('Saving uploaded documents is a premium feature. Use Manual Entry in demo mode.')
return
}
setAcceptingPreview(true)
    try {
      const { data } = await docAPI.acceptUpload({
        pending_upload_id: previewDoc.pending_upload_id,
        original_filename: previewDoc.original_filename,
        property_id: previewDoc.selectedPropertyId,
        category: previewDoc.category,
        force,
        replace_document_id: replaceDocumentId,
      })
      if (data.tax_import_error) {
        toast.error(`Tax return uploaded, but import failed: ${data.tax_import_error}`, { duration: 8000 })
      } else if (data.tax_entries_imported > 0) {
        toast.success(`${data.tax_entries_imported} propert${data.tax_entries_imported === 1 ? 'y' : 'ies'} updated from tax return`, { duration: 5000 })
      } else {
        toast.success(`Saved: ${data.display_name || data.original_filename} (${catLabel(data.category)})`)
      }
      const nextSaved = uploadProgress.saved + 1
      const nextCreated = uploadProgress.created + (data.property_created ? 1 : 0)
      setUploadProgress((prev) => ({
        ...prev,
        saved: nextSaved,
        created: nextCreated,
      }))
      setPreviewDoc(null)
      await previewNextFile(uploadQueue, nextSaved, nextCreated, previewDoc.uploadCategory, previewDoc.uploadPropertyId)
      loadDocs()
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.name) {
        setPreviewDoc((prev) => (prev ? { ...prev, duplicate_of: detail } : prev))
      } else {
        toast.error(detail || 'Save failed')
      }
    } finally {
      setAcceptingPreview(false)
    }
  }

  const handleCancelPreview = async () => {
    if (!previewDoc) return
    const pending = previewDoc
    setPreviewDoc(null)
    try {
      await docAPI.cancelUpload({
        pending_upload_id: pending.pending_upload_id,
        original_filename: pending.original_filename,
        property_id: pending.selectedPropertyId,
        category: pending.category,
      })
    } catch {
      // Pending uploads are temporary; a missing file does not need a user alert.
    }
    await previewNextFile(uploadQueue, uploadProgress.saved, uploadProgress.created, pending.uploadCategory, pending.uploadPropertyId)
  }

  // ── Spreadsheet template download ────────────────────────────────────────
const downloadTemplate = () => {
  if (isDemo) {
    toast.error('Spreadsheet template download is a premium feature. Use Manual Entry in demo mode.')
    return
  }

  const headers = [
      // Property identification
      'Property Name', 'Property ID', 'City', 'State', 'Zip Code',
      // Property details (update anytime)
      'Market Value', 'Purchase Price', 'Monthly Rent',
      // Loan details (first/primary loan)
      'Original Loan Amount', 'Current Balance', 'Interest Rate (%)', 'Loan Type (Fixed/ARM)', 'Monthly Principal & Interest',
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
            propertyLabel(p), p.property_uid || '', p.city || '', p.state || '', p.zip_code || '',
            p.market_value   || '', p.purchase_price || '', p.monthly_rent || '',
            loan?.original_amount || '', loan?.current_balance || '',
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
    if (!mPropId) { toast.error('Select a property first, or add a new one.'); return }
    const targetPropId = mPropId
    const payload = {}
    if (mPropFields.market_value   !== '') payload.market_value   = parseFloat(mPropFields.market_value)
    if (mPropFields.purchase_price !== '') payload.purchase_price = parseFloat(mPropFields.purchase_price)
    if (mPropFields.monthly_rent   !== '') payload.monthly_rent   = parseFloat(mPropFields.monthly_rent)
    if (!Object.keys(payload).length) { toast('Nothing to update'); return }
    setSavingProp(true)
    try {
      await propAPI.update(targetPropId, payload)
      await loadProps()
      toast.success('Property details saved')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setSavingProp(false)
    }
  }

  const handleLoanSave = async () => {
    if (!mPropId) { toast.error('Select a property first, or add a new one.'); return }
    const targetPropId = mPropId
    if (!mLoanFields.interest_rate) { toast.error('Interest rate is required'); return }
    if (!mLoanFields.original_loan_amount) { toast.error('Original loan amount is required'); return }
    setSavingLoan(true)
    try {
      const prop = properties.find(p => String(p.id) === String(targetPropId))
      const existingLoan = prop?.loans?.[0]

      const originalAmount = parseFloat(mLoanFields.original_loan_amount)
      const interestRate   = parseFloat(mLoanFields.interest_rate)
      const loanTermYears  = existingLoan?.loan_term_years || 30
      const currentBalance = mLoanFields.current_balance !== ''
        ? parseFloat(mLoanFields.current_balance)
        : originalAmount
      const monthlyPayment = mLoanFields.monthly_payment !== ''
        ? parseFloat(mLoanFields.monthly_payment)
        : monthlyPI(originalAmount, interestRate, loanTermYears)

      // The update endpoint replaces the whole loan record, so start from
      // the existing loan's fields (escrow, statement data, ARM terms, etc.)
      // and only overlay what this quick-entry form actually edits.
      const payload = {
        ...(existingLoan || {}),
        loan_type: mLoanFields.loan_type,
        interest_rate: interestRate,
        original_amount: originalAmount,
        current_balance: currentBalance,
        monthly_payment: monthlyPayment,
        loan_term_years: loanTermYears,
      }
      delete payload.id
      delete payload.property_id

      if (existingLoan) {
        await propAPI.updateLoan(targetPropId, existingLoan.id, payload)
        toast.success('Loan updated')
      } else {
        await propAPI.addLoan(targetPropId, payload)
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
    if (!mPropId) { toast.error('Select a property first, or add a new one.'); return }
    const targetPropId = mPropId
    setSaving(true)
    try {
      const payload = { tax_year: parseInt(mYear) }
      Object.entries(mFields).forEach(([k, v]) => {
        if (v !== '') payload[k] = parseFloat(v)
      })
      await propAPI.upsertYearEntry(targetPropId, payload)
      toast.success(`${mYear} data saved successfully`)
      setMFields({ rents_received:'', mortgage_interest:'', property_taxes:'', depreciation:'', total_expenses:'', net_income:'' })
      setResult({ type: 'manual', year: mYear, prop: propertyLabel(properties.find(p => String(p.id) === String(targetPropId))) })
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete   = async (id) => { if (!confirm('Delete this document?')) return; await docAPI.delete(id); toast.success('Deleted'); loadDocs() }
  const handleApply = async (id) => {
if (isDemo) { toast.error('Applying uploaded documents is a premium feature. Use Manual Entry in demo mode.'); return }
try { const { data } = await docAPI.apply(id); toast(data.message, { icon: Object.keys(data.applied||{}).length ? '✅' : 'ℹ️' }) } catch(e) { toast.error(e.response?.data?.detail||'Apply failed') }
}
const handleReparse = async (id) => {
if (isDemo) { toast.error('Re-parsing uploaded documents is a premium feature. Use Manual Entry in demo mode.'); return }
try { await docAPI.reparse(id); toast.success('Re-parsed'); loadDocs() } catch { toast.error('Re-parse failed') }
}
const handleReprocessAll = async () => {
if (isDemo) { toast.error('Document reprocessing is a premium feature. Use Manual Entry in demo mode.'); return }
if (!confirm('Re-extract all files with latest parser?')) return
setReprocessing(true)
try { const { data } = await docAPI.reprocessAll(); toast.success(`Reprocessed ${data.reprocessed} of ${data.total}`); await Promise.all([loadDocs(), loadProps()]) }
catch { toast.error('Reprocess failed') }
finally { setReprocessing(false) }
}

const switchMode = (id) => { selectMode(id); setResult(null) }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const methodOrder = ['manual', 'document', 'spreadsheet']
  const orderedMethods = methodOrder.map((id) => METHODS.find((m) => m.id === id)).filter(Boolean)
  const activeMethod = METHODS.find((m) => m.id === mode) || METHODS.find((m) => m.id === 'manual')
  const previewFields = previewDoc
    ? Object.entries(previewDoc.extracted_data || {}).filter(
        ([key, value]) => key !== 'raw_text_preview' && (value === null || (!Array.isArray(value) && typeof value !== 'object'))
      )
    : []
  const previewProperties = previewDoc?.extracted_data?.properties || []

  const propNameById = Object.fromEntries(properties.map((p) => [p.id, p.name || p.address]))
  const docYears = [...new Set(docs.map((d) => d.statement_year).filter(Boolean))].sort((a, b) => b - a)
  const usedCategories = [...new Set(docs.map((d) => d.doc_category).filter(Boolean))]

  const filteredDocs = docs
    .filter((d) => {
      if (docFilters.property && String(d.property_id || '') !== docFilters.property) return false
      if (docFilters.category && d.doc_category !== docFilters.category) return false
      if (docFilters.scope === 'common' && d.property_id) return false
      if (docFilters.scope === 'property' && !d.property_id) return false
      if (docFilters.year && String(d.statement_year || '') !== docFilters.year) return false
      if (docFilters.cadence && cadenceOf(d.doc_category) !== docFilters.cadence) return false
      if (docFilters.status === 'matched' && !d.property_id) return false
      if (docFilters.status === 'unassigned' && d.property_id) return false
      if (docFilters.status === 'duplicate' && !d.is_duplicate) return false
      return true
    })
    .sort((a, b) => {
      const ta = a.upload_date ? new Date(a.upload_date).getTime() : 0
      const tb = b.upload_date ? new Date(b.upload_date).getTime() : 0
      return sortDir === 'desc' ? tb - ta : ta - tb
    })

  const groupLabel = (d) => {
    const propPart = d.property_id ? (propNameById[d.property_id] || d.property_address || `Property ${d.property_id}`) : 'Common'
    const catPart = catLabel(d.doc_category)
    if (groupBy === 'property') return propPart
    if (groupBy === 'category') return catPart
    if (groupBy === 'both') return `${propPart} — ${catPart}`
    return null
  }
  const groupedDocs = groupBy === 'none'
    ? [[null, filteredDocs]]
    : Object.entries(
        filteredDocs.reduce((acc, d) => {
          const key = groupLabel(d)
          ;(acc[key] = acc[key] || []).push(d)
          return acc
        }, {})
      )

  const activeFilterChips = [
    docFilters.property && { key: 'property', label: `Property: ${propNameById[docFilters.property] || docFilters.property}` },
    docFilters.category && { key: 'category', label: `Type: ${catLabel(docFilters.category)}` },
    docFilters.scope && { key: 'scope', label: `Scope: ${docFilters.scope === 'common' ? 'Common' : 'Property'}` },
    docFilters.year && { key: 'year', label: `Year: ${docFilters.year}` },
    docFilters.cadence && { key: 'cadence', label: `Cadence: ${CADENCE_LABELS[docFilters.cadence]}` },
    docFilters.status && { key: 'status', label: `Status: ${docFilters.status[0].toUpperCase()}${docFilters.status.slice(1)}` },
  ].filter(Boolean)

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
        <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 flex items-start gap-3">
          <Building2 className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-semibold">No properties yet.</p>
            <p className="text-blue-700 dark:text-blue-300 mt-0.5">Upload a mortgage statement and the property + loan are created automatically from the document address.</p>
          </div>
        </div>
      )}

      {/* ── Method cards ── */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
{orderedMethods.map((m) => {
const active = mode === m.id
const locked = isDemo && m.id !== 'manual'
return (
<button key={m.id} onClick={() => switchMode(m.id)}
disabled={locked}
className={`text-left rounded-xl border-2 p-5 transition-all focus:outline-none bg-white dark:bg-gray-800 font-medium ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
style={active
? { borderColor: m.accent }
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
{locked && (
<span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">
Premium
</span>
)}
</div>
              <p className="font-semibold text-slate-900 dark:text-white text-sm">{m.title}</p>
                    <p className={`text-[11px] font-semibold mt-0.5 mb-2 ${active ? 'text-slate-700 dark:text-gray-300' : 'text-slate-400 dark:text-gray-500'}`}>{m.badge}</p>
              <p className="text-xs text-slate-500 dark:text-gray-400 leading-relaxed">{m.desc}</p>
            </button>
          )
        })}
      </div>

      {/* ── Success state ── */}
      {result && (
        <div className="rounded-xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-6 flex items-start gap-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            {result.type === 'upload' && (
              <>
                <p className="font-semibold text-emerald-900 dark:text-emerald-100 text-lg">Upload complete</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {result.count} file{result.count > 1 ? 's' : ''} uploaded
                  {result.created > 0 && ` · ${result.created} new propert${result.created > 1 ? 'ies' : 'y'} created`}
                </p>
              </>
            )}
            {result.type === 'manual' && (
              <>
                <p className="font-semibold text-emerald-900 dark:text-emerald-100 text-lg">{result.year} data saved</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">{result.prop}</p>
              </>
            )}
            <div className="flex items-center gap-3 mt-4">
              <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100">
                View Dashboard <ArrowRight className="w-4 h-4" />
              </Link>
              <button onClick={() => setResult(null)}
                className="text-sm text-emerald-600 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-100 flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5" /> Import more
              </button>
            </div>
          </div>
          <button onClick={() => setResult(null)} className="text-emerald-400 hover:text-emerald-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {previewDoc && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-blue-500 dark:text-blue-300">Review extracted fields</p>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mt-1">{previewDoc.original_filename}</h2>
              <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">
                {catLabel(previewDoc.category)} · {fmtSize(previewDoc.file_size)}
                {previewDoc.property_address ? ` · ${previewDoc.property_address}` : ''}
              </p>
              {uploadProgress.total > 1 && (
                <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                  {uploadProgress.saved} saved · {previewDoc.remainingCount || 0} waiting · {uploadProgress.total} selected
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleCancelPreview}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-gray-200"
              title="Cancel upload"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5">
            {previewFields.length > 0 ? (
              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-gray-700">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-gray-700 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Field</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Extracted Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                    {previewFields.map(([key, value]) => (
                      <tr key={key} className="bg-white dark:bg-gray-800">
                        <td className="px-3 py-2 text-slate-500 dark:text-gray-400 capitalize whitespace-nowrap">
                          {key.replace(/_/g, ' ')}
                        </td>
                        <td className="px-3 py-2 text-slate-900 dark:text-gray-100">
                          {formatFieldValue(key, value, previewDoc.extracted_data)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                No structured fields were extracted. Cancel this upload or save it as a document record for manual review.
              </div>
            )}

            {previewProperties.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-500 dark:text-blue-300 mb-2">
                  Per-property Schedule E figures ({previewProperties.length})
                </p>
                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-gray-700">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-gray-700 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Property</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Kind</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Rents</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Total Exp.</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Mortgage Int.</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Depreciation</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Net Income</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-500 dark:text-gray-300">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                      {previewProperties.map((p, i) => (
                        <tr key={i} className="bg-white dark:bg-gray-800 align-top">
                          <td className="px-3 py-2 text-slate-900 dark:text-gray-100">
                            {p.address || '—'}
                            {p.unresolved_fields?.length > 0 && (
                              <div className="mt-1 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                <span>{p.unresolved_fields.join(' ')}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-500 dark:text-gray-400 capitalize whitespace-nowrap">{p.property_kind || '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-900 dark:text-gray-100 whitespace-nowrap">{fmtMoney(p.rents_received)}</td>
                          <td className="px-3 py-2 text-right text-slate-900 dark:text-gray-100 whitespace-nowrap">{fmtMoney(p.total_expenses)}</td>
                          <td className="px-3 py-2 text-right text-slate-900 dark:text-gray-100 whitespace-nowrap">{fmtMoney(p.mortgage_interest)}</td>
                          <td className="px-3 py-2 text-right text-slate-900 dark:text-gray-100 whitespace-nowrap">{fmtMoney(p.depreciation)}</td>
                          <td className="px-3 py-2 text-right text-slate-900 dark:text-gray-100 whitespace-nowrap">{fmtMoney(p.net_income)}</td>
                          <td className="px-3 py-2 text-right text-slate-500 dark:text-gray-400 whitespace-nowrap">
                            {p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {previewDoc.extracted_data?.parse_error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-200">
                {previewDoc.extracted_data.parse_error}
              </div>
            )}

            {previewDoc.duplicate_of && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <Copy className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      {previewDoc.duplicate_of.match_type === 'exact' ? 'Identical file already uploaded' : 'Possible duplicate — same content'}
                    </p>
                    <p className="mt-0.5">
                      Matches "{previewDoc.duplicate_of.name}"
                      {previewDoc.duplicate_of.property_address ? ` for ${previewDoc.duplicate_of.property_address}` : ''}
                      {previewDoc.duplicate_of.upload_date ? `, uploaded ${new Date(previewDoc.duplicate_of.upload_date).toLocaleDateString()}` : ''}.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelPreview}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              {previewDoc.duplicate_of ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleAcceptPreview({ replaceDocumentId: previewDoc.duplicate_of.id })}
                    disabled={acceptingPreview}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 px-4 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-60"
                  >
                    Replace existing
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAcceptPreview({ force: true })}
                    disabled={acceptingPreview}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {acceptingPreview ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</> : 'Keep both'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleAcceptPreview()}
                  disabled={acceptingPreview}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {acceptingPreview ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</> : <><CheckCircle2 className="w-4 h-4" /> Save and accept</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Active mode panel ── */}
      <div className="rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">

        {/* Panel header */}
<div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/50">
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
                    className="w-full rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    value={isTaxReturn ? '' : propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    disabled={isTaxReturn}
                  >
                    {isTaxReturn
                      ? <option value="">Common — linked via Schedule E</option>
                      : <>
                          <option value="">Auto-detect from document</option>
                      {properties.map((p) => <option key={p.id} value={p.id}>{propertyLabel(p)} · ID {shortPropertyUid(p)}</option>)}
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
                    className="w-full rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-gray-600 hover:border-blue-300 hover:bg-slate-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <Upload className="w-10 h-10 text-slate-300 dark:text-gray-600 mx-auto mb-4" />
                {uploading
? <UploadProcessing />
                  : <>
                      <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">Drop files here or click to browse</p>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">PDF, XLSX, XLS, CSV · Max 20 MB · Multiple files supported</p>
                    </>
                }
                <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.xlsx,.xls,.csv"
                  onChange={(e) => { handleUpload([...e.target.files]); e.target.value = '' }} />
              </div>

              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 px-4 py-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
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
                <button
                  onClick={downloadTemplate}
                  disabled={isDemo}
                  title={isDemo ? 'Premium feature' : undefined}
                  className="inline-flex items-center gap-2 rounded-lg border-2 border-emerald-600 bg-emerald-600 text-white text-sm font-semibold px-4 py-2 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                  <Download className="w-4 h-4" /> {isDemo ? 'Premium Template CSV' : 'Download Template CSV'}
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
                    ['Property Name', 'Friendly name shown in the app'],
                    ['Property ID', 'Unique ID for matching'],
                    ['City / State / Zip', 'Location fields'],
                    ['Market Value', 'Current estimated value'],
                    ['Purchase Price', 'Original acquisition price'],
                    ['Monthly Rent', 'Current effective rent'],
                    ['Original Loan Amount', 'Amount at origination'],
                    ['Current Balance', 'Outstanding loan balance'],
                    ['Interest Rate (%)', 'Annual rate e.g. 6.75'],
                    ['Loan Type (Fixed/ARM)', '"Fixed" or "ARM"'],
                    ['Monthly Principal & Interest', 'Principal + interest payment'],
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
onDrop={(e) => { e.preventDefault(); setDragOver(false); setCategory('tax_return'); handleUpload([...e.dataTransfer.files], { category: 'tax_return', propertyId: '' }) }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
dragOver ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-gray-600 hover:border-emerald-300 hover:bg-slate-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <FileSpreadsheet className="w-9 h-9 text-slate-300 dark:text-gray-600 mx-auto mb-3" />
                    {uploading
? <UploadProcessing tone="emerald" />
                      : <>
                          <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">Drop your filled CSV / XLSX here</p>
                          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">CSV or XLSX · Max 20 MB</p>
                        </>
                    }
                    <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls"
onChange={(e) => { setCategory('tax_return'); handleUpload([...e.target.files], { category: 'tax_return', propertyId: '' }); e.target.value = '' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ MANUAL ENTRY ══════════════════════════════════════════════════ */}
          {mode === 'manual' && (
            <div className="space-y-6">

              {/* Property selector — shared across all sections */}
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-1.5">Property</label>
                  <select
                      className="w-full rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-slate-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                    value={mPropId} onChange={(e) => setMPropId(e.target.value)}
                  >
                    <option value="">Select a property…</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{propertyLabel(p)} · ID {shortPropertyUid(p)}</option>)}
                  </select>
                </div>
                <Link to="/properties/new"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 text-sm font-semibold px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-700/50 transition-colors shrink-0">
                  <Plus className="w-4 h-4" /> New Property
                </Link>
              </div>

              {!mPropId && (
                <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-semibold">First time entering this property?</p>
                    <p className="text-blue-700 dark:text-blue-300 mt-0.5">
                      Use <Link to="/properties/new" className="underline font-medium">Add Property</Link> to capture the full picture —
                      address, purchase date, depreciation basis, taxes, insurance, and expenses. Once it's created,
                      come back here to select it and add loan and per-year tax data.
                    </p>
                  </div>
                </div>
              )}

              {/* ── SECTION A: Property Details ── */}
              {mPropId && (
              <div className="rounded-xl border border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/50 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">A · Quick Update</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Current valuation and rental income — used for equity, LTV, and cash flow metrics. For full property details (address, depreciation basis, taxes, insurance) use <Link to={`/properties/${mPropId}/edit`} className="underline">Edit Property</Link>.</p>
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
<button onClick={handlePropSave} disabled={savingProp}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white text-xs font-semibold px-4 py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {savingProp ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save Property Details'}
                  </button>
                </div>
              </div>
              )}

              {/* ── SECTION B: Loan Details ── */}
              {mPropId && (
              <div className="rounded-xl border border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700/50 p-5">
                <div className="mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-gray-500">B · Loan Details</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
                    Primary mortgage — used for DSCR, paydown progress, and financing metrics
                    {properties.find(p => String(p.id) === String(mPropId))?.loans?.length > 0 && (
                      <span className="ml-1 text-violet-500 font-medium">· Existing loan will be updated</span>
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { key: 'original_loan_amount', label: 'Original Loan Amount', hint: 'Amount at origination',      prefix: '$', type: 'number' },
                    { key: 'current_balance',       label: 'Current Balance',      hint: 'Outstanding loan balance',   prefix: '$', type: 'number' },
                    { key: 'monthly_payment',        label: 'Monthly Principal & Interest',          hint: 'Principal + interest only',  prefix: '$', type: 'number' },
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
<button onClick={handleLoanSave} disabled={savingLoan}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white text-xs font-semibold px-4 py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {savingLoan ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : (
                      properties.find(p => String(p.id) === String(mPropId))?.loans?.length > 0 ? 'Update Loan' : 'Add Loan'
                    )}
                  </button>
                </div>
              </div>
              )}

              {/* ── SECTION C: Tax Year Data ── */}
              {mPropId && (
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
                        ? propertyLabel(properties.find(p => String(p.id) === String(mPropId)))
                        : 'selected property'}
                    </span>
                    . Existing entry will be updated.
                  </p>
<button onClick={handleManualSave} disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 text-white text-xs font-semibold px-4 py-2 hover:bg-violet-700 disabled:opacity-50 transition-colors">
                    {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <>Save Tax Data <ArrowRight className="w-3.5 h-3.5" /></>}
                  </button>
                </div>
              </div>
              )}

            </div>
          )}

        </div>
      </div>

      {/* ── Document list ── */}
      <div className="rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-gray-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">Uploaded Documents</p>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
              {filteredDocs.length} of {docs.length} file{docs.length !== 1 ? 's' : ''}
            </p>
          </div>
          {docs.length > 0 && (
            <button onClick={handleReprocessAll} disabled={reprocessing || isDemo} title={isDemo ? 'Premium feature' : undefined}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700/50 disabled:opacity-50 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${reprocessing ? 'animate-spin' : ''}`} />
              {isDemo ? 'Premium Reprocess' : reprocessing ? 'Reprocessing…' : 'Reprocess All'}
            </button>
          )}
        </div>

        {docs.length > 0 && (
          <div className="px-6 py-3 border-b border-slate-100 dark:border-gray-700 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
              <select value={docFilters.property} onChange={(e) => setDocFilters((f) => ({ ...f, property: e.target.value }))}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="">All properties</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name || p.address}</option>)}
              </select>
              <select value={docFilters.category} onChange={(e) => setDocFilters((f) => ({ ...f, category: e.target.value }))}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="">All document types</option>
                {usedCategories.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
              <select value={docFilters.scope} onChange={(e) => setDocFilters((f) => ({ ...f, scope: e.target.value }))}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="">All scopes</option>
                <option value="common">Common</option>
                <option value="property">Property</option>
              </select>
              <select value={docFilters.year} onChange={(e) => setDocFilters((f) => ({ ...f, year: e.target.value }))}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="">All years</option>
                {docYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select value={docFilters.cadence} onChange={(e) => setDocFilters((f) => ({ ...f, cadence: e.target.value }))}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="">All cadences</option>
                {Object.entries(CADENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={docFilters.status} onChange={(e) => setDocFilters((f) => ({ ...f, status: e.target.value }))}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="">Any status</option>
                <option value="matched">Matched</option>
                <option value="unassigned">Unassigned</option>
                <option value="duplicate">Duplicate</option>
              </select>

              <span className="w-px h-5 bg-slate-200 dark:bg-gray-600 mx-1" />

              <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
                className="text-xs rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300">
                <option value="none">No grouping</option>
                <option value="property">Group by property</option>
                <option value="category">Group by document type</option>
                <option value="both">Group by property + type</option>
              </select>

              <button
                type="button"
                onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                className="inline-flex items-center gap-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-slate-600 dark:text-gray-300"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>

            {activeFilterChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {activeFilterChips.map((chip) => (
                  <span key={chip.key} className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full pl-2.5 pr-1.5 py-1">
                    {chip.label}
                    <button onClick={() => setDocFilters((f) => ({ ...f, [chip.key]: '' }))} className="hover:text-blue-900 dark:hover:text-blue-100">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => setDocFilters({ property: '', category: '', scope: '', year: '', cadence: '', status: '' })}
                  className="text-xs font-medium text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 px-1.5"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

        {docs.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-10 h-10 text-slate-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 dark:text-gray-500">No documents uploaded yet</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="text-center py-12">
            <Filter className="w-10 h-10 text-slate-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 dark:text-gray-500">No documents match the current filters</p>
          </div>
        ) : (
          groupedDocs.map(([label, groupDocs]) => (
            <div key={label || 'all'}>
              {label && (
                <div className="px-6 py-2 bg-slate-50 dark:bg-gray-700/40 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400 border-b border-slate-100 dark:border-gray-700">
                  {label} <span className="font-normal normal-case text-slate-400 dark:text-gray-500">({groupDocs.length})</span>
                </div>
              )}
              <div className="divide-y divide-slate-50">
                {groupDocs.map((doc) => (
                  <DocRow key={doc.id} doc={doc} properties={properties} isDemo={isDemo}
                    onDelete={() => handleDelete(doc.id)}
                    onApply={() => handleApply(doc.id)}
                    onReparse={() => handleReparse(doc.id)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Doc row ────────────────────────────────────────────────────────────────────
function DocRow({ doc, properties = [], isDemo = false, onDelete, onApply, onReparse }) {
  const [expanded, setExpanded]       = useState(false)
  const [showMarkdown, setShowMarkdown] = useState(false)
  const [markdown, setMarkdown]       = useState(null)

  const data       = doc.extracted_data || {}
  const linkedProperty = properties.find((p) => String(p.id) === String(doc.property_id))
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
          <p className="text-sm font-medium text-slate-900 dark:text-white truncate" title={doc.original_filename}>
            {doc.display_name || doc.original_filename}
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {doc.property_id
? <Link to={`/properties/${doc.property_id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline">{propertyLabel(linkedProperty, `ID ${doc.property_id}`)}</Link>
: <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300">Common</span>
            }
            <span className="text-xs text-slate-400 dark:text-gray-500">·</span>
            <span className="text-xs text-slate-500 dark:text-gray-400">{catLabel(doc.doc_category)}</span>
            {doc.file_size > 0 && <><span className="text-xs text-slate-400 dark:text-gray-500">·</span><span className="text-xs text-slate-400 dark:text-gray-500">{fmtSize(doc.file_size)}</span></>}
            {doc.is_duplicate && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                <Copy className="w-2.5 h-2.5" /> Duplicate
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasData && (
            <button onClick={() => { setExpanded(!expanded); setShowMarkdown(false) }}
className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              Data <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          {doc.has_markdown && (
            <button onClick={toggleMarkdown}
className="text-xs text-violet-500 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 px-2 py-1 rounded hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors">
              {showMarkdown ? 'Hide' : 'MD'}
            </button>
          )}
          <button onClick={onReparse} disabled={isDemo} title={isDemo ? 'Premium feature' : 'Re-parse latest parser'}
className="p-1.5 rounded text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors disabled:cursor-not-allowed disabled:opacity-40">
 <RefreshCw className="w-3.5 h-3.5" />
 </button>
 {applicable && (
 <button onClick={onApply} disabled={isDemo} title={isDemo ? 'Premium feature' : 'Apply extracted data to property'}
className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-100 px-2 py-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors disabled:cursor-not-allowed disabled:opacity-40">
 <Wand2 className="w-3.5 h-3.5" /> {isDemo ? 'Premium' : 'Apply'}
 </button>
 )}
 <button onClick={onDelete}
className="p-1.5 rounded text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
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
            {Object.entries(data)
              .filter(([k, v]) => !['raw_text_preview'].includes(k)
                && (v === null || (!Array.isArray(v) && typeof v !== 'object')))
              .map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs py-0.5">
                  <span className="text-slate-400 dark:text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-slate-700 dark:text-gray-300 ml-2 truncate">{formatFieldValue(k, v, data)}</span>
                </div>
              ))}
          </div>
          {(data.properties || []).length > 0 && (
            <div className="mt-1.5 text-[11px] text-slate-500 dark:text-gray-400">
              <span className="block text-slate-400 dark:text-gray-500">Properties:</span>
              {data.properties.map((p, i) => (
                <div key={i} className="truncate">{p.address || 'Unknown'}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
