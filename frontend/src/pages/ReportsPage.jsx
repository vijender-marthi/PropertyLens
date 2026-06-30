import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useEffect } from 'react'
import {
  FileText, Download, Upload, Printer, TrendingUp, DollarSign,
  Landmark, Shield, Building2, CheckCircle, AlertCircle, ChevronDown,
  Calendar, X,
} from 'lucide-react'
import { propAPI, docAPI } from '../services/api'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

const fmt = (n) => {
  if (n == null) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const short = (v) => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)

  if (abs >= 1_000_000) return `${sign}$${short(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}$${short(abs / 1_000)}K`

  return `${sign}$${short(abs)}`
}
const fmtPct = (n) => `${(n || 0).toFixed(2)}%`
const isPrimary = p => (p.usage_type || 'Rental').toLowerCase() === 'primary'

// ── Section wrapper ───────────────────────────────────────────────────────────
function ReportSection({ id, icon: Icon, title, children }) {
  return (
    <section id={id} className="border-b border-slate-100 dark:border-gray-700 pb-10 mb-10 last:border-0">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 dark:bg-gray-700 print:bg-slate-200 shrink-0">
          <Icon className="w-4 h-4 text-slate-500 dark:text-gray-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function KV({ label, value, color }) {
  return (
    <div className="bg-slate-50 dark:bg-gray-700/50 rounded-xl px-4 py-3 border border-slate-100 dark:border-gray-700">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500">{label}</p>
<p className="text-lg font-bold mt-1 leading-none text-slate-900 dark:text-white" style={color ? { color } : undefined}>{value}</p>
    </div>
  )
}

// ── Uploaded report card ───────────────────────────────────────────────────────
function UploadedReportCard({ doc, onDelete }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-white dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <FileText className="w-5 h-5 text-blue-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{doc.filename}</p>
          <p className="text-[10px] text-slate-400 dark:text-gray-500">{doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : '—'} · {doc.property_name || 'Portfolio'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer"
          className="text-xs text-blue-600 font-semibold hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors">View</a>
        <button onClick={() => onDelete(doc.id)}
          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [loading, setLoading]   = useState(true)
  const [data, setData]         = useState(null)
  const [docs, setDocs]         = useState([])
  const [uploading, setUploading] = useState(false)
  const [selectedPropId, setSelectedPropId] = useState('all')
  const fileRef = useRef()
  const printRef = useRef()

  useEffect(() => {
    Promise.all([propAPI.dashboard(), docAPI.listAll()])
      .then(([dashRes, docRes]) => {
        setData(dashRes.data)
        setDocs((docRes.data || []).filter(d => d.content_type === 'application/pdf' || d.filename?.endsWith('.pdf')))
      })
      .catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false))
  }, [])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      if (selectedPropId !== 'all') form.append('property_id', selectedPropId)
      const res = await docAPI.upload(form)
      setDocs(prev => [res.data, ...prev])
      toast.success('Report uploaded')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      fileRef.current.value = ''
    }
  }

  const handleDeleteDoc = async (id) => {
    if (!confirm('Delete this report?')) return
    await docAPI.delete(id)
    setDocs(prev => prev.filter(d => d.id !== id))
    toast.success('Deleted')
  }

  const exportXLSX = () => {
    if (!data) return
    const props = data.properties || []
    const rows = props.map(p => ({
      'Address':         p.address,
      'Type':            isPrimary(p) ? 'Primary Residence' : 'Rental',
      'Market Value':    p.market_value || 0,
      'Purchase Price':  p.purchase_price || 0,
      'Appreciation':    (p.market_value || 0) - (p.purchase_price || 0),
      'Equity':          p.equity || 0,
      'Loan Balance':    p.total_loan_balance || 0,
      'LTV %':           p.market_value > 0 ? ((p.total_loan_balance||0)/p.market_value*100).toFixed(2) : '—',
      'Monthly Rent':    p.effective_rent || 0,
      'Monthly Mortgage':p.monthly_mortgage || 0,
      'Monthly Cash Flow':p.monthly_cash_flow || 0,
      'Annual NOI':      p.annual_noi || 0,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Array(12).fill({ wch: 18 })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Portfolio Report')

    const trends = data.yearly_trends || []
    if (trends.length) {
      const trows = trends.map(r => ({
        'Year': r.year,
        'Rental Income': r.rental_income || 0,
        'Mortgage Interest': r.mortgage_interest || 0,
        'Property Taxes': r.property_taxes || 0,
        'Operating Expenses': r.operating_expenses || 0,
        'Depreciation': r.depreciation || 0,
        'Net Income': r.net_income || 0,
      }))
      const ws2 = XLSX.utils.json_to_sheet(trows)
      ws2['!cols'] = Array(7).fill({ wch: 20 })
      XLSX.utils.book_append_sheet(wb, ws2, 'Yearly Trends')
    }

    XLSX.writeFile(wb, `PropertyLens_Report_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  if (!data) return <p className="text-slate-400 dark:text-gray-500 text-sm p-8">No data available. Add properties first.</p>

  const rentalProps = (data.properties || []).filter(p => !isPrimary(p))
  const primaryProps = (data.properties || []).filter(p => isPrimary(p))
  const d_mv  = (data.properties || []).reduce((s,p) => s+(p.market_value||0), 0)
  const d_eq  = (data.properties || []).reduce((s,p) => s+(p.equity||0), 0)
  const d_lb  = (data.properties || []).reduce((s,p) => s+(p.total_loan_balance||0), 0)
  const dr_mr = rentalProps.reduce((s,p) => s+(p.effective_rent||0), 0)
  const dr_cf = rentalProps.reduce((s,p) => s+(p.monthly_cash_flow||0), 0)
  const dr_noi= rentalProps.reduce((s,p) => s+(p.annual_noi||0), 0)
  const dr_mm = rentalProps.reduce((s,p) => s+(p.monthly_mortgage||0), 0)
  const dr_lbs= rentalProps.reduce((s,p) => s+(p.total_loan_balance||0), 0)
  const dr_mv = rentalProps.reduce((s,p) => s+(p.market_value||0), 0)
  const rentalLTV = dr_mv > 0 ? dr_lbs/dr_mv*100 : 0
  const dr_ads= dr_mm * 12
  const dscr  = dr_ads > 0 ? dr_noi/dr_ads : null
  const d_pp  = (data.properties||[]).reduce((s,p) => s+(p.purchase_price||0), 0)
  const allLoans = rentalProps.flatMap(p => p.loans||[])
  const d_lbs_all= allLoans.reduce((s,l) => s+(l.current_balance||0), 0)
  const wRate = d_lbs_all > 0
    ? allLoans.reduce((s,l) => s+(l.current_balance||0)*(l.interest_rate||0), 0)/d_lbs_all : 0
  const yearlyTrends = data.yearly_trends || []
  const latestTrend  = yearlyTrends[yearlyTrends.length - 1]
  const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
  const cfMarginPct = dr_mr > 0 ? dr_cf/dr_mr*100 : 0

  return (
    <div className="max-w-4xl mx-auto">

      {/* ── PAGE HEADER ───────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Portfolio Report</h1>
          <p className="text-sm text-slate-400 dark:text-gray-500 mt-1">Generated {today} · {data.properties?.length || 0} properties</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <button onClick={exportXLSX}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold text-slate-700 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-700/50 shadow-sm transition-colors">
            <Download className="w-3.5 h-3.5" /> Export XLSX
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 shadow-sm transition-colors">
            <Printer className="w-3.5 h-3.5" /> Print / Save PDF
          </button>
        </div>
      </div>

      <div ref={printRef} className="space-y-0">

        {/* ── 1. PORTFOLIO OVERVIEW ─────────────────────────────────── */}
        <ReportSection id="overview" icon={TrendingUp} title="Portfolio Overview">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <KV label="Total Market Value"   value={fmt(d_mv)} />
            <KV label="Total Equity"         value={fmt(d_eq)} color="#2563eb" />
            <KV label="Total Debt"           value={fmt(d_lb)} />
            <KV label="Appreciation Gain"    value={fmt(d_mv - d_pp)} color={d_mv >= d_pp ? '#059669' : '#dc2626'} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <KV label="Rental Properties"    value={rentalProps.length} />
            <KV label="Rental Portfolio LTV" value={fmtPct(rentalLTV)} color={rentalLTV > 80 ? '#dc2626' : rentalLTV > 65 ? '#d97706' : '#059669'} />
            <KV label="Monthly Cash Flow"    value={fmt(dr_cf)} color={dr_cf >= 0 ? '#059669' : '#dc2626'} />
            <KV label="Annual NOI"           value={fmt(dr_noi)} />
          </div>
          {primaryProps.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-5 py-4">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-2">Primary Residence(s) — Excluded from Rental Metrics</p>
              {primaryProps.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs text-amber-950 dark:text-amber-100 py-1">
                  <span className="font-medium">{p.address}</span>
                  <span>Equity {fmt(p.equity||0)} · LTV {p.market_value>0?fmtPct((p.total_loan_balance||0)/p.market_value*100):'—'} · Monthly cost {fmt(p.monthly_mortgage||0)}</span>
                </div>
              ))}
            </div>
          )}
        </ReportSection>

        {/* ── 2. PROPERTY PERFORMANCE ───────────────────────────────── */}
        <ReportSection id="properties" icon={Building2} title="Property Performance">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-gray-600 text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500">
                  <th className="py-2 text-left pr-4 font-semibold">Property</th>
                  <th className="py-2 text-right pr-4 font-semibold">Market Value</th>
                  <th className="py-2 text-right pr-4 font-semibold">Equity</th>
                  <th className="py-2 text-right pr-4 font-semibold">LTV</th>
                  <th className="py-2 text-right pr-4 font-semibold">Rent/mo</th>
                  <th className="py-2 text-right pr-4 font-semibold">Cash Flow</th>
                  <th className="py-2 text-right font-semibold">Annual NOI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rentalProps.map(p => {
                  const ltv = p.market_value > 0 ? (p.total_loan_balance||0)/p.market_value*100 : 0
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-gray-700/50">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-800 dark:text-gray-200">{p.address.split(',')[0]}</p>
                        <p className="text-slate-400 dark:text-gray-500">{p.city}, {p.state}</p>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-slate-700 dark:text-gray-300 font-medium">{fmt(p.market_value)}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-blue-700">{fmt(p.equity||0)}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color: ltv>80?'#dc2626':ltv>65?'#d97706':'#059669' }}>{fmtPct(ltv)}</td>
                      <td className="py-2.5 pr-4 text-right text-slate-700 dark:text-gray-300">{fmt(p.effective_rent||0)}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold" style={{ color:(p.monthly_cash_flow||0)>=0?'#059669':'#dc2626' }}>{fmt(p.monthly_cash_flow||0)}</td>
                      <td className="py-2.5 text-right text-slate-700 dark:text-gray-300">{fmt(p.annual_noi||0)}</td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-slate-300 dark:border-gray-500 bg-slate-50 dark:bg-gray-700/50 font-bold text-xs">
                  <td className="py-2.5 pr-4 text-slate-700 dark:text-gray-300">TOTAL (Rental Portfolio)</td>
                  <td className="py-2.5 pr-4 text-right text-slate-800 dark:text-gray-200">{fmt(dr_mv)}</td>
                  <td className="py-2.5 pr-4 text-right text-blue-700">{fmt(d_eq - (primaryProps.reduce((s,p)=>s+(p.equity||0),0)))}</td>
                  <td className="py-2.5 pr-4 text-right" style={{ color:rentalLTV>80?'#dc2626':rentalLTV>65?'#d97706':'#059669' }}>{fmtPct(rentalLTV)}</td>
                  <td className="py-2.5 pr-4 text-right text-slate-800 dark:text-gray-200">{fmt(dr_mr)}</td>
                  <td className="py-2.5 pr-4 text-right" style={{ color:dr_cf>=0?'#059669':'#dc2626' }}>{fmt(dr_cf)}</td>
                  <td className="py-2.5 text-right text-slate-800 dark:text-gray-200">{fmt(dr_noi)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </ReportSection>

        {/* ── 3. CASH FLOW ANALYSIS ─────────────────────────────────── */}
        <ReportSection id="cashflow" icon={DollarSign} title="Cash Flow Analysis">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <KV label="Gross Rent / mo"       value={fmt(dr_mr)} />
            <KV label="Net Cash Flow / mo"    value={fmt(dr_cf)} color={dr_cf>=0?'#059669':'#dc2626'} />
            <KV label="Cash Flow Margin"      value={fmtPct(cfMarginPct)} color={cfMarginPct>10?'#059669':cfMarginPct>0?'#d97706':'#dc2626'} />
            <KV label="Debt Service / yr"     value={fmt(dr_ads)} />
            <KV label="DSCR"                  value={dscr!=null?`${dscr.toFixed(2)}×`:'N/A'} color={dscr==null?'#6b7280':dscr>1.25?'#059669':dscr>1?'#d97706':'#dc2626'} />
            <KV label="Annual NOI"            value={fmt(dr_noi)} />
          </div>
          {yearlyTrends.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-gray-600 text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500">
                    <th className="py-2 text-left pr-4 font-semibold">Year</th>
                    <th className="py-2 text-right pr-4 font-semibold">Rental Income</th>
                    <th className="py-2 text-right pr-4 font-semibold">Op. Expenses</th>
                    <th className="py-2 text-right pr-4 font-semibold">Mortgage Int.</th>
                    <th className="py-2 text-right pr-4 font-semibold">Depreciation</th>
                    <th className="py-2 text-right font-semibold">Net Income</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {yearlyTrends.map(r => (
                    <tr key={r.year} className="hover:bg-slate-50 dark:hover:bg-gray-700/50">
                      <td className="py-2 pr-4 font-semibold text-slate-700 dark:text-gray-300">{r.year}</td>
                      <td className="py-2 pr-4 text-right text-slate-600 dark:text-gray-300">{fmt(r.rental_income||0)}</td>
                      <td className="py-2 pr-4 text-right text-slate-600 dark:text-gray-300">{fmt(r.operating_expenses||0)}</td>
                      <td className="py-2 pr-4 text-right text-slate-600 dark:text-gray-300">{fmt(r.mortgage_interest||0)}</td>
                      <td className="py-2 pr-4 text-right text-slate-600 dark:text-gray-300">{fmt(r.depreciation||0)}</td>
                      <td className="py-2 text-right font-semibold" style={{ color:(r.net_income||0)>=0?'#059669':'#dc2626' }}>{fmt(r.net_income||0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportSection>

        {/* ── 4. DEBT & FINANCING ───────────────────────────────────── */}
        <ReportSection id="debt" icon={Landmark} title="Debt & Financing">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <KV label="Total Rental Debt"     value={fmt(dr_lbs)} />
            <KV label="Rental Portfolio LTV"  value={fmtPct(rentalLTV)} color={rentalLTV>80?'#dc2626':rentalLTV>65?'#d97706':'#059669'} />
            <KV label="Wtd Avg. Rate"         value={`${fmtPct(wRate)}`} color={wRate>7?'#dc2626':wRate>5.5?'#d97706':'#059669'} />
          </div>
          {allLoans.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-gray-600 text-[10px] uppercase tracking-wider text-slate-400 dark:text-gray-500">
                    <th className="py-2 text-left pr-4 font-semibold">Property</th>
                    <th className="py-2 text-center pr-4 font-semibold">Type</th>
                    <th className="py-2 text-right pr-4 font-semibold">Original</th>
                    <th className="py-2 text-right pr-4 font-semibold">Balance</th>
                    <th className="py-2 text-right pr-4 font-semibold">Rate</th>
                    <th className="py-2 text-right font-semibold">P&I / mo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rentalProps.flatMap(p => (p.loans||[]).map(l => ({ ...l, prop: p }))).map((l, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-gray-700/50">
                      <td className="py-2 pr-4 font-medium text-slate-700 dark:text-gray-300">{l.prop.address.split(',')[0]}</td>
                      <td className="py-2 pr-4 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ background:(l.loan_type||'Fixed').toUpperCase()==='ARM'?'#fff7ed':'#f0fdf4', color:(l.loan_type||'Fixed').toUpperCase()==='ARM'?'#c2410c':'#15803d' }}>
                          {(l.loan_type||'Fixed').toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-600 dark:text-gray-300">{fmt(l.original_loan_amount||0)}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-slate-700 dark:text-gray-300">{fmt(l.current_balance||0)}</td>
                      <td className="py-2 pr-4 text-right font-bold" style={{ color:(l.interest_rate||0)>7?'#dc2626':(l.interest_rate||0)>5.5?'#d97706':'#059669' }}>{fmtPct(l.interest_rate||0)}</td>
                      <td className="py-2 text-right text-slate-600 dark:text-gray-300">{fmt(l.monthly_payment||0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ReportSection>

        {/* ── 5. TAX SUMMARY ────────────────────────────────────────── */}
        {latestTrend && (
          <ReportSection id="tax" icon={FileText} title={`Tax Summary — ${latestTrend.year}`}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <KV label="Gross Rental Income"   value={fmt(latestTrend.rental_income||0)} />
              <KV label="Mortgage Interest"     value={fmt(latestTrend.mortgage_interest||0)} />
              <KV label="Property Taxes"        value={fmt(latestTrend.property_taxes||0)} />
              <KV label="Depreciation"          value={fmt(latestTrend.depreciation||0)} color="#7c3aed" />
              <KV label="Operating Expenses"    value={fmt(latestTrend.operating_expenses||0)} />
              <KV label="Taxable Net Income"    value={fmt(latestTrend.net_income||0)} color={(latestTrend.net_income||0)<0?'#059669':'#dc2626'} />
            </div>
            <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 text-xs text-violet-900">
              <strong className="text-violet-700">Note:</strong> Depreciation is a non-cash deduction — it reduces taxable income without a cash outlay. A negative taxable net income represents a passive loss that may offset other passive income or carry forward to future years.
            </div>
          </ReportSection>
        )}

      </div>

      {/* ── UPLOAD SECTION ────────────────────────────────────────────── */}
      <div className="mt-10 pt-10 border-t border-slate-200 dark:border-gray-600 print:hidden">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Uploaded Reports</h2>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Attach PDF reports, tax returns, appraisals, or external statements</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={selectedPropId} onChange={e => setSelectedPropId(e.target.value)}
              className="text-xs border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 text-slate-700 dark:text-gray-300 bg-white dark:bg-gray-800 shadow-sm">
              <option value="all">Portfolio (no property)</option>
              {(data.properties||[]).map(p => (
                <option key={p.id} value={p.id}>{p.address.split(',')[0]}{isPrimary(p) ? ' (Primary)' : ''}</option>
              ))}
            </select>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading…' : 'Upload PDF Report'}
            </button>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
          </div>
        </div>

        {docs.length === 0 ? (
          <div className="bg-slate-50 dark:bg-gray-700/50 border border-dashed border-slate-200 dark:border-gray-600 rounded-2xl p-10 text-center">
            <FileText className="w-8 h-8 text-slate-300 dark:text-gray-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500 dark:text-gray-400">No reports uploaded yet</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">Upload tax returns, appraisals, mortgage statements, or property reports</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map(doc => (
              <UploadedReportCard key={doc.id} doc={doc} onDelete={handleDeleteDoc} />
            ))}
          </div>
        )}
      </div>

      {/* ── PRINT STYLES ───────────────────────────────────────────────── */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
}
