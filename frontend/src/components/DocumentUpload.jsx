import { useState, useRef } from 'react'
import { docAPI } from '../services/api'
import { Upload, FileText, Trash2, ChevronDown, Wand2, CheckSquare, Square, AlertTriangle, Copy } from 'lucide-react'
import toast from 'react-hot-toast'

const CATEGORIES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'mortgage_statement', label: 'Mortgage Statement' },
  { value: 'tax_return', label: 'Tax Return' },
  { value: '1098', label: '1098 - Mortgage Interest' },
  { value: '1099', label: '1099 Year-End' },
  { value: 'loan_disclosure', label: 'Loan Disclosure' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'property_tax', label: 'Property Tax Statement' },
  { value: 'other', label: 'Other' },
]

const fmtSize = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DocumentUpload({ propertyId, docs, onUploaded }) {
  const [category, setCategory] = useState('auto')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef()

  const duplicateDocs = docs.filter((d) => d.is_duplicate)
  const hasDuplicates  = duplicateDocs.length > 0

  const upload = async (file) => {
    const fd = new FormData()
    fd.append('property_id', propertyId)
    fd.append('category', category)
    fd.append('file', file)
    setUploading(true)
    try {
      const { data } = await docAPI.upload(fd)
      if (data.tax_import_error)
        toast.error(`Tax return uploaded, but import failed: ${data.tax_import_error}`, { duration: 8000 })
      else
        toast.success(`Uploaded: ${data.original_filename}`)
      onUploaded()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = (files) => {
    if (files.length) upload(files[0])
  }

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === docs.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(docs.map((d) => d.id)))
    }
  }

  const selectDuplicates = () => {
    setSelected(new Set(duplicateDocs.map((d) => d.id)))
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} document(s)?`)) return
    setDeleting(true)
    try {
      const { data } = await docAPI.deleteBatch([...selected])
      toast.success(`Deleted ${data.count} document(s)`)
      setSelected(new Set())
      onUploaded()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const handleDelete = async (docId) => {
    if (!confirm('Delete this document?')) return
    await docAPI.delete(docId)
    toast.success('Deleted')
    onUploaded()
  }

  const handleApply = async (docId) => {
    try {
      const { data } = await docAPI.apply(docId)
      if (Object.keys(data.applied).length) {
        toast.success(data.message)
        onUploaded()
      } else {
        toast(data.message, { icon: 'ℹ️' })
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Apply failed')
    }
  }

  const catLabel = (val) => CATEGORIES.find((c) => c.value === val)?.label || val

  return (
    <div className="space-y-4">

      {/* Duplicate warning banner */}
      {hasDuplicates && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-800">
                {duplicateDocs.length} duplicate document{duplicateDocs.length > 1 ? 's' : ''} detected
              </p>
              <p className="text-sm text-amber-700 mt-0.5">
                {duplicateDocs.length === 1
                  ? 'One document appears to be a duplicate of an earlier upload — same type, year, and loan account.'
                  : `${duplicateDocs.length} documents share the same type, year, and loan account as earlier uploads.`}
                {' '}The original is used for all calculations; duplicates are ignored.
              </p>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={selectDuplicates}
                  className="text-xs font-medium text-amber-700 hover:text-amber-900 underline">
                  Select duplicates
                </button>
                <button
                  onClick={() => { selectDuplicates(); setTimeout(handleBatchDelete, 50) }}
                  className="text-xs font-medium text-red-600 hover:text-red-800 underline">
                  Delete all duplicates
                </button>
              </div>
            </div>
          </div>
          {/* List which docs are flagged */}
          <div className="mt-3 space-y-1 pl-8">
            {duplicateDocs.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs text-amber-700">
                <Copy className="w-3 h-3 shrink-0" />
                <span className="truncate font-medium">{d.original_filename}</span>
                {d.statement_year && <span className="text-amber-500">· {d.statement_year}</span>}
                {d.loan_account_number && <span className="text-amber-500">· acct {d.loan_account_number}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Upload Documents</h3>
        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <label className="label">Document Type</label>
            <select className="input w-52" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          className={`border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors flex flex-col items-center justify-center text-center ${
            dragOver
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-700/30'
          }`}
        >
          <Upload className="w-8 h-8 text-gray-300 dark:text-gray-500 mb-3" />
          {uploading ? (
            <p className="text-sm text-blue-600 font-medium">Uploading…</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drop file here or click to browse</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PDF, XLSX, XLS, CSV · Max 20 MB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.xlsx,.xls,.csv"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Document list */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">Documents ({docs.length})</h3>
            {hasDuplicates && (
              <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {duplicateDocs.length} duplicate{duplicateDocs.length > 1 ? 's' : ''} — highlighted below
              </p>
            )}
          </div>
          {selected.size > 0 && (
            <button onClick={handleBatchDelete} disabled={deleting}
              className="btn-danger flex items-center gap-1.5 text-xs px-3 py-1.5">
              <Trash2 className="w-3 h-3" />
              {deleting ? 'Deleting…' : `Delete ${selected.size}`}
            </button>
          )}
        </div>
        {docs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No documents uploaded yet</p>
        ) : (
          <div className="space-y-2">
            {docs.length > 1 && (
              <div className="flex items-center gap-4 mb-1">
                <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600">
                  {selected.size === docs.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {selected.size === docs.length ? 'Deselect all' : 'Select all'}
                </button>
                {hasDuplicates && (
                  <button onClick={selectDuplicates} className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Select duplicates
                  </button>
                )}
              </div>
            )}
            {docs.map((doc) => (
              <DocRow key={doc.id} doc={doc} catLabel={catLabel}
                selected={selected.has(doc.id)}
                onToggle={() => toggleSelect(doc.id)}
                onDelete={() => handleDelete(doc.id)}
                onApply={() => handleApply(doc.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DocRow({ doc, catLabel, selected, onToggle, onDelete, onApply }) {
  const [expanded, setExpanded] = useState(false)
  const data = doc.extracted_data || {}
  const hasData = Object.keys(data).length > 0
  const applicable = hasData && !data.parse_error && !data.raw_text_preview
  const isDup = doc.is_duplicate

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      isDup     ? 'border-amber-300 bg-amber-50/60' :
      selected  ? 'border-blue-300 bg-blue-50'      :
                  'border-gray-100'
    }`}>
      <div className="flex items-center gap-2 p-3 hover:bg-gray-50/80">
        <button onClick={onToggle} className="shrink-0 text-gray-400 hover:text-blue-600">
          {selected ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
        </button>
        <FileText className={`w-4 h-4 shrink-0 ${isDup ? 'text-amber-500' : 'text-blue-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900 truncate">{doc.original_filename}</p>
            {isDup && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 text-amber-800 shrink-0">
                <Copy className="w-3 h-3" /> Duplicate
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            {catLabel(doc.doc_category)}
            {doc.statement_year && ` · ${doc.statement_year}`}
            {doc.loan_account_number && ` · acct ${doc.loan_account_number}`}
            {' · '}{fmtSize(doc.file_size)}
          </p>
          {isDup && (
            <p className="text-xs text-amber-600 mt-0.5">
              ⚠ Same {doc.doc_category} for {doc.statement_year}
              {doc.loan_account_number ? ` / acct ${doc.loan_account_number}` : ''} already uploaded earlier.
              This copy is <strong>not used in calculations</strong>.
            </p>
          )}
        </div>
        {hasData && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 flex items-center gap-1 shrink-0">
            Extracted <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
        {applicable && !isDup && (
          <button onClick={onApply} title="Apply extracted data to property/loan"
            className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1 shrink-0">
            <Wand2 className="w-3.5 h-3.5" /> Apply
          </button>
        )}
        {isDup && (
          <span title="Apply disabled — duplicate document" className="text-xs text-gray-300 flex items-center gap-1 shrink-0 cursor-not-allowed">
            <Wand2 className="w-3.5 h-3.5" /> Apply
          </span>
        )}
        <button onClick={onDelete} className="text-red-400 hover:text-red-600 shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {expanded && hasData && (
        <div className="bg-gray-50 border-t border-gray-100 px-3 py-2">
          <p className="text-xs font-medium text-gray-500 mb-1">Extracted Data</p>
          {doc.period_type && doc.period_type !== 'other' && (
            <p className="text-[10px] text-gray-400 mb-1.5">
              {doc.period_type} · {doc.period_start} → {doc.period_end || 'N/A'}
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {Object.entries(doc.extracted_data)
              .filter(([k]) => !['period_type', 'period_start', 'period_end', 'raw_text_preview'].includes(k))
              .map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-gray-400 capitalize">{k.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-gray-700">{typeof v === 'number' ? v.toLocaleString() : String(v)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
