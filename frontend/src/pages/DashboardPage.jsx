import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { propAPI } from '../services/api'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend, ReferenceLine
} from 'recharts'
import { Building2, DollarSign, TrendingUp, ArrowUpRight, Shield, Landmark, ChevronDown, Home,
         AlertCircle, ArrowRight, CheckCircle, FileText, Lightbulb } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTheme } from '../hooks/useTheme'

const fmt = (n) => {
  const value = n || 0
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const short = (v) => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)

  if (abs >= 1_000_000) return `${sign}$${short(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}$${short(abs / 1_000)}K`

  return `${sign}$${short(abs)}`
}
const fmtPct = (n) => `${(n || 0).toFixed(2)}%`
// ── Design System ─────────────────────────────────────────────────────────────
const ACCENT   = '#2d4fa1'
const T_BORDER = '0.5px solid #e5e7eb'
const T_RADIUS = 12
const T_PAD    = '1rem 1.25rem'
const RAMPS = {
  blue:  ['#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af'],
  green: ['#bbf7d0','#86efac','#4ade80','#22c55e','#16a34a','#15803d','#166534'],
  amber: ['#fde68a','#fcd34d','#fbbf24','#f59e0b','#d97706','#b45309','#92400e'],
  red:   ['#fecaca','#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c','#991b1b'],
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { dark } = useTheme()
  const [data, setData]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [activeSection, setActiveSection] = useState('portfolio')
  const [sectionOpen, setSectionOpen] = useState(false)
  const sectionRef                    = useRef(null)
  const [excludedIds, setExcludedIds] = useState(new Set())
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef                   = useRef(null)
  const [editingNoteId, setEditingNoteId]   = useState(null)
  const [noteInput, setNoteInput]        = useState('')
  const excludedKey = Array.from(excludedIds).sort((a, b) => a - b).join(',')

  const SECTIONS = [
    { id: 'portfolio', label: 'Portfolio & Equity', icon: TrendingUp },
    { id: 'cashflow',  label: 'Cash Flow',           icon: DollarSign },
    { id: 'financing', label: 'Financing & Debt',    icon: Landmark },
    { id: 'risk',      label: 'Risk Metrics',         icon: Shield },
  ]

  useEffect(() => {
    setLoading(true)
    propAPI.dashboard(excludedKey)
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false))
  }, [excludedKey])

  useEffect(() => {
    const handler = (e) => {
      if (sectionRef.current && !sectionRef.current.contains(e.target)) setSectionOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const saveNote = async (propId) => {
    try {
      await propAPI.updateNotes(propId, noteInput)
      setData(prev => ({
        ...prev,
        properties: prev.properties.map(p =>
          p.id === propId ? { ...p, notes: noteInput.trim() } : p
        ),
      }))
    } catch {
      toast.error('Failed to save note')
    }
    setEditingNoteId(null)
    setNoteInput('')
  }

  const NoteCell = ({ p }) => (
    editingNoteId === p.id ? (
      <input
        autoFocus
        type="text"
        value={noteInput}
        onChange={e => setNoteInput(e.target.value)}
        onBlur={() => saveNote(p.id)}
        onKeyDown={e => {
          if (e.key === 'Enter') saveNote(p.id)
          if (e.key === 'Escape') { setEditingNoteId(null); setNoteInput('') }
        }}
        placeholder="Add note…"
        className="w-full text-xs border border-blue-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-400 min-w-[140px]"
      />
    ) : (
      <span
        onClick={() => { setEditingNoteId(p.id); setNoteInput(p.notes || '') }}
        className={`text-xs cursor-pointer rounded px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 block ${p.notes ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600 italic'}`}
        title="Click to edit note"
      >
        {p.notes || 'Add note'}
      </span>
    )
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  if (!data || data.total_properties === 0) return (
    <div className="text-center py-20">
      <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
      <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">No properties yet</h2>
      <p className="text-gray-400 mb-6">Upload a mortgage statement — the property and loan are created automatically</p>
      <div className="flex justify-center gap-3">
        <Link to="/uploads" className="btn-primary">Upload Mortgage Statement</Link>
        <Link to="/properties/new" className="btn-secondary">Add Manually</Link>
      </div>
    </div>
  )

  const truncate = (s, n = 16) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')
  const fmtAxis  = (v) => fmt(v)
  const isPrimary = p => (p.usage_type || 'Rental').toLowerCase() === 'primary'

  // ── Filter ────────────────────────────────────────────────────────────────
  const filteredProps = data.dashboard?.all_properties || data.properties.filter(p => !excludedIds.has(p.id))
  const excludedCount = data.dashboard?.excluded_count ?? excludedIds.size

  // Separate primary residence from rental portfolio
  const rentalProps  = data.dashboard?.properties || filteredProps.filter(p => !isPrimary(p))
  const primaryProps = data.dashboard?.primary_properties || filteredProps.filter(p =>  isPrimary(p))

  // ── Net-worth aggregates (ALL properties) ─────────────────────────────────
  const d_mv  = filteredProps.reduce((s, p) => s + (p.market_value || 0), 0)
  const d_lb  = filteredProps.reduce((s, p) => s + (p.total_loan_balance || 0), 0)
  const d_eq  = filteredProps.reduce((s, p) => s + (p.equity || 0), 0)
  const d_pp  = filteredProps.reduce((s, p) => s + (p.purchase_price || 0), 0)

  // ── Rental-only operational aggregates ────────────────────────────────────
  const dr_mr  = rentalProps.reduce((s, p) => s + (p.effective_rent || 0), 0)
  const dr_mm  = rentalProps.reduce((s, p) => s + (p.monthly_mortgage || 0), 0)
  const dr_cf  = rentalProps.reduce((s, p) => s + (p.monthly_cash_flow || 0), 0)
  const dr_noi = rentalProps.reduce((s, p) => s + (p.annual_noi || 0), 0)
  const d_ol   = rentalProps.filter(p => (p.original_loan_amount || 0) > 0).reduce((s, p) => s + p.original_loan_amount, 0)
  const d_prp  = rentalProps.filter(p => (p.principal_paid || 0) > 0).reduce((s, p) => s + p.principal_paid, 0)
  const d_ip   = rentalProps.reduce((s, p) => s + (p.interest_paid || 0), 0)
  const dr_ads = dr_mm * 12
  const d_loans = rentalProps.flatMap(p => p.loans)
  const d_lbs   = d_loans.reduce((s, l) => s + (l.current_balance || 0), 0)
  const d_wr    = d_lbs > 0
    ? (d_loans.reduce((s, l) => s + (l.current_balance || 0) * (l.interest_rate || 0), 0) / d_lbs).toFixed(2)
    : '0.00'

  // Rental-only LTV (personal mortgage excluded from portfolio leverage)
  const dr_lbs = rentalProps.reduce((s, p) => s + (p.total_loan_balance || 0), 0)
  const dr_mv  = rentalProps.reduce((s, p) => s + (p.market_value || 0), 0)

  // ── Primary home aggregates ───────────────────────────────────────────────
  const pm_mv  = primaryProps.reduce((s, p) => s + (p.market_value || 0), 0)
  const pm_lb  = primaryProps.reduce((s, p) => s + (p.total_loan_balance || 0), 0)
  const pm_eq  = primaryProps.reduce((s, p) => s + (p.equity || 0), 0)
  const pm_mm  = primaryProps.reduce((s, p) => s + (p.monthly_mortgage || 0), 0)
  const pm_pp  = primaryProps.reduce((s, p) => s + (p.purchase_price || 0), 0)

  const d = data.dashboard || {
    properties:              rentalProps,     // rental properties only for analytics
    all_properties:          filteredProps,   // all for display purposes
    primary_properties:      primaryProps,
    total_properties:        rentalProps.length,
    // Net worth (all properties)
    total_market_value:      d_mv,
    total_loan_balance:      d_lb,
    total_equity:            d_eq,
    total_purchase_price:    d_pp,
    total_appreciation_gain: d_mv - d_pp,
    // Rental portfolio LTV (excludes primary mortgage)
    portfolio_ltv:           dr_mv > 0 ? dr_lbs / dr_mv * 100 : 0,
    portfolio_equity_pct:    dr_mv > 0 ? (dr_mv - dr_lbs) / dr_mv * 100 : 0,
    // Rental operational metrics
    total_monthly_rent:      dr_mr,
    total_monthly_mortgage:  dr_mm,
    total_monthly_cash_flow: dr_cf,
    total_annual_noi:        dr_noi,
    annual_debt_service:     dr_ads,
    total_original_loan:     d_ol,
    total_principal_paid:    d_prp,
    total_interest_paid:     d_ip,
    original_ltv:            d_pp > 0 ? d_ol / d_pp * 100 : 0,
    portfolio_dscr:          dr_ads > 0 ? dr_noi / dr_ads : null,
    weighted_avg_rate:       d_wr,
    // Primary home (separate — personal liability, not rental asset)
    has_primary:             primaryProps.length > 0,
    primary_equity:          pm_eq,
    primary_market_value:    pm_mv,
    primary_loan_balance:    pm_lb,
    primary_monthly_cost:    pm_mm,
    primary_ltv:             pm_mv > 0 ? pm_lb / pm_mv * 100 : 0,
    primary_appreciation:    pm_mv - pm_pp,
  }

  // ── Chart data (rental properties only) ──────────────────────────────────
  const cashFlowData = rentalProps.map((p) => ({
    name: truncate(p.address.split(',')[0]),
    rent: Math.round(p.effective_rent),
    mortgage: Math.round(p.monthly_mortgage),
    cashFlow: Math.round(p.monthly_cash_flow),
  }))
  // ── Risk (rental portfolio only) ─────────────────────────────────────────
  const totalLoanBalance  = d_lbs
  const armBalance        = d_loans.filter(l => (l.loan_type || '').toUpperCase() === 'ARM').reduce((s, l) => s + (l.current_balance || 0), 0)
  const armExposure       = totalLoanBalance > 0 ? armBalance / totalLoanBalance * 100 : 0
  const highRateBalance   = d_loans.filter(l => (l.interest_rate || 0) > 6).reduce((s, l) => s + (l.current_balance || 0), 0)
  const highRateExposure  = totalLoanBalance > 0 ? highRateBalance / totalLoanBalance * 100 : 0
  const maxEquity         = Math.max(0, ...rentalProps.map(p => p.equity || 0))
  const topConcentrated   = rentalProps.find(p => p.equity === maxEquity)
  const concentrationRisk = dr_noi > 0 || d_lbs > 0
    ? (d_lbs > 0 ? maxEquity / d_lbs * 100 : 0) : 0
  const scheduledRent     = rentalProps.reduce((s, p) => s + (p.monthly_rent || 0), 0)
  const vacancyRate       = scheduledRent > 0 ? (scheduledRent - dr_mr) / scheduledRent * 100 : 0
  const occupancyRate     = 100 - vacancyRate
  const debtWeightedRate  = totalLoanBalance > 0
    ? d_loans.reduce((s, l) => s + (l.current_balance || 0) * (l.interest_rate || 0), 0) / totalLoanBalance
    : 0

  // ── Sparkline arrays (rental properties only) ────────────────────────────
  const asc = (arr) => [...arr].sort((a, b) => a - b)
  const mvSpark       = asc(rentalProps.map(p => p.market_value || 0))
  const eqSpark       = asc(rentalProps.map(p => p.equity || 0))
  const rentSpark     = asc(rentalProps.map(p => p.effective_rent || 0))
  const cfSpark       = asc(rentalProps.map(p => p.monthly_cash_flow || 0))
  const mortgageSpark = asc(rentalProps.map(p => p.monthly_mortgage || 0))
  const debtSpark     = asc(rentalProps.map(p => p.total_loan_balance || 0))
  const noiSpark      = asc(rentalProps.map(p => (p.annual_noi || 0) / 12))
  const ppSpark       = asc(rentalProps.map(p => p.principal_paid || 0))
  const ipSpark       = asc(rentalProps.map(p => p.interest_paid || 0))
  const olSpark       = asc(rentalProps.filter(p => p.original_loan_amount > 0).map(p => p.original_loan_amount))
  const rateSpark     = asc(d_loans.map(l => l.interest_rate || 0))

  // ── Derived ratios ────────────────────────────────────────────────────────
  const appreciationPct = d_pp > 0 ? (d_mv - d_pp) / d_pp * 100 : null
  const cfMarginPct     = dr_mr > 0 ? dr_cf / dr_mr * 100 : 0
  const selectedPropIds  = new Set(rentalProps.map(p => p.id))
  const yearlyTrends = (data.yearly_trends || []).map(row => {
    const props = row.properties || []
    if (!props.length) return row
    const selected = props.filter(p => selectedPropIds.has(p.property_id))
    return {
      year: row.year,
      rental_income: selected.reduce((s, p) => s + (p.rental_income || 0), 0),
      mortgage_interest: selected.reduce((s, p) => s + (p.mortgage_interest || 0), 0),
      property_taxes: selected.reduce((s, p) => s + (p.property_taxes || 0), 0),
      operating_expenses: selected.reduce((s, p) => s + (p.operating_expenses || 0), 0),
      depreciation: selected.reduce((s, p) => s + (p.depreciation || 0), 0),
      net_income: selected.reduce((s, p) => s + (p.net_income || 0), 0),
    }
  }).filter(row => selectedPropIds.size > 0 && (
    row.rental_income || row.mortgage_interest || row.operating_expenses || row.net_income
  ))
  const latestTrend = yearlyTrends[yearlyTrends.length - 1]
  const prevTrend   = yearlyTrends[yearlyTrends.length - 2]
  const yoy = (key) => {
    if (!latestTrend || !prevTrend) return null
    const current = latestTrend[key] || 0
    const previous = prevTrend[key] || 0
    return {
      current,
      previous,
      delta: current - previous,
      pct: previous !== 0 ? (current - previous) / Math.abs(previous) * 100 : null,
      currentYear: latestTrend.year,
      previousYear: prevTrend.year,
    }
  }
  const rentYoY = yoy('rental_income')
  const netIncomeYoY = yoy('net_income')
  const expenseYoY = yoy('operating_expenses')

  // Ranked by equity for tile
  const rankedByEquity = [...d.properties]
    .sort((a, b) => (b.equity || 0) - (a.equity || 0))
    .slice(0, 5)
    .map(p => ({ id: p.id, name: truncate(p.address.split(',')[0], 15), value: fmt(p.equity || 0) }))

  // ── Risk factor constants (used in Risk section) ───────────────────────────
  const riskFactors = [
    { label: 'Equity Concentration', value: concentrationRisk, lo: 35, hi: 50 },
    { label: 'ARM Exposure',          value: armExposure,       lo: 25, hi: 50 },
    { label: 'High Rate Debt',        value: highRateExposure,  lo: 10, hi: 30 },
    { label: 'Vacancy Rate',          value: vacancyRate,       lo:  7, hi: 10 },
  ]
  const dangerCount = riskFactors.filter(f => f.value > f.hi).length
  const warnCount   = riskFactors.filter(f => f.value > f.lo && f.value <= f.hi).length
  const overallRisk = dangerCount >= 2 ? 'high' : (dangerCount === 1 || warnCount >= 2) ? 'moderate' : 'low'
  // ── Portfolio Health Score ─────────────────────────────────────────────────
  const healthScore = (() => {
    let pts = 0
    const ltv = d.portfolio_ltv
    if      (ltv < 55) pts += 25
    else if (ltv < 65) pts += 20
    else if (ltv < 75) pts += 14
    else if (ltv < 85) pts += 7
    const dscr = d.portfolio_dscr
    if      (dscr == null)  pts += 12
    else if (dscr > 1.5)    pts += 25
    else if (dscr > 1.25)   pts += 20
    else if (dscr > 1.0)    pts += 10
    const cfm = cfMarginPct
    if      (cfm > 15)  pts += 25
    else if (cfm > 5)   pts += 20
    else if (cfm > 0)   pts += 12
    else if (cfm > -5)  pts += 5
    if      (occupancyRate > 96) pts += 25
    else if (occupancyRate > 92) pts += 20
    else if (occupancyRate > 85) pts += 12
    else if (occupancyRate > 75) pts += 5
    return Math.round(Math.min(100, pts))
  })()
  const healthInfo = healthScore >= 80
    ? { label: 'Healthy',    color: '#15803d', cls: 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' }
    : healthScore >= 60
    ? { label: 'Good',       color: '#0369a1', cls: 'bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800' }
    : healthScore >= 40
    ? { label: 'Watch',      color: '#b45309', cls: 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800' }
    : { label: 'At Risk',    color: '#b91c1c', cls: 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' }

  const propScore = (p) => {
    let pts = 0
    const ltv = p.market_value > 0 ? (p.total_loan_balance || 0) / p.market_value * 100 : 50
    if      (ltv < 55) pts += 25
    else if (ltv < 65) pts += 20
    else if (ltv < 75) pts += 14
    else if (ltv < 85) pts += 7
    const rent = p.effective_rent || 0
    const cf   = p.monthly_cash_flow || 0
    const cfm  = rent > 0 ? cf / rent * 100 : 0
    if      (cfm > 15)  pts += 25
    else if (cfm > 5)   pts += 20
    else if (cfm > 0)   pts += 12
    else if (cfm > -5)  pts += 5
    const dscr = (p.annual_noi || 0) > 0 && (p.monthly_mortgage || 0) > 0
      ? p.annual_noi / (p.monthly_mortgage * 12) : null
    if      (dscr == null) pts += 12
    else if (dscr > 1.5)   pts += 25
    else if (dscr > 1.25)  pts += 20
    else if (dscr > 1.0)   pts += 10
    pts += 25 // vacancy (single-property occupancy not aggregated)
    return Math.round(Math.min(100, pts))
  }
  const propStatus = (score) =>
    score >= 80 ? { label: 'Hold',          color: '#15803d', cls: 'bg-green-50 dark:bg-green-900/20' }
    : score >= 60 ? { label: 'Monitor',     color: '#0369a1', cls: 'bg-sky-50 dark:bg-sky-900/20' }
    : score >= 40 ? { label: 'Review',      color: '#b45309', cls: 'bg-amber-50 dark:bg-amber-900/20' }
    :               { label: 'Sell Review', color: '#b91c1c', cls: 'bg-red-50 dark:bg-red-900/20' }

  // ── AI Executive Summary ───────────────────────────────────────────────────
  const aiSummary = (() => {
    const parts = []
    const healthAdj = healthScore >= 80 ? 'financially healthy' : healthScore >= 60 ? 'in good standing' : healthScore >= 40 ? 'showing some concerns' : 'facing financial challenges'
    parts.push(`Your rental portfolio is ${healthAdj}, with ${d.total_properties} ${d.total_properties === 1 ? 'property' : 'properties'} valued at ${fmt(d.total_market_value)} and ${fmt(d.total_equity)} in equity.`)
    if (rentYoY?.pct != null) {
      const dir = rentYoY.pct >= 0 ? 'grown' : 'declined'
      parts.push(`Rental income has ${dir} ${Math.abs(rentYoY.pct).toFixed(1)}% year-over-year to ${fmt((latestTrend?.rental_income || 0) / 12)}/mo.`)
    }
    const ltvAdj = d.portfolio_ltv < 55 ? 'conservative' : d.portfolio_ltv < 70 ? 'moderate' : d.portfolio_ltv < 80 ? 'elevated' : 'high'
    parts.push(`Portfolio leverage is ${ltvAdj} at ${fmtPct(d.portfolio_ltv)} LTV.`)
    const negCF = d.properties.filter(p => (p.monthly_cash_flow || 0) < 0)
    if (negCF.length > 0) {
      parts.push(`${negCF.length} ${negCF.length === 1 ? 'property requires' : 'properties require'} attention due to negative cash flow.`)
    } else {
      parts.push('All properties are generating positive cash flow.')
    }
    if (d.total_equity > 0 && d.portfolio_ltv < 65 && d.total_monthly_cash_flow > 0) {
      parts.push(`Your equity position supports further acquisition if desired.`)
    } else if (d.portfolio_ltv > 80) {
      parts.push('Consider reducing leverage before any new acquisition.')
    }
    return parts.join(' ')
  })()

  // ── Action Center ──────────────────────────────────────────────────────────
  const actions = (() => {
    const recs = []
    rentalProps.filter(p => (p.monthly_cash_flow || 0) < 0).forEach(p => {
      recs.push({
        type: 'danger',
        title: `Negative cash flow: ${p.address.split(',')[0]}`,
        why: `Generating ${fmt(p.monthly_cash_flow)}/mo. A rent increase or expense reduction could restore profitability.`,
        action: 'Review Property', link: `/properties/${p.id}`,
      })
    })
    const highRateLoans = d_loans.filter(l => (l.interest_rate || 0) > 7)
    if (highRateLoans.length > 0) {
      recs.push({
        type: 'warning',
        title: `Refinancing opportunity — ${highRateLoans.length} high-rate loan${highRateLoans.length > 1 ? 's' : ''}`,
        why: `Rate${highRateLoans.length > 1 ? 's' : ''} above 7%. Refinancing may meaningfully reduce monthly debt service.`,
        action: 'View Loans', link: '/properties',
      })
    }
    if (vacancyRate > 10) {
      recs.push({
        type: 'warning',
        title: 'Vacancy rate above benchmark',
        why: `Portfolio vacancy at ${fmtPct(vacancyRate)} is reducing income by ${fmt((scheduledRent - d.total_monthly_rent) * 12)}/yr. Review pricing and marketing.`,
        action: 'Review Properties', link: '/properties',
      })
    }
    if (d.portfolio_dscr != null && d.portfolio_dscr < 1.25) {
      recs.push({
        type: 'warning',
        title: 'Debt coverage ratio below 1.25× target',
        why: `DSCR of ${d.portfolio_dscr.toFixed(2)}× means income has limited buffer above debt service. Reduce expenses or increase rent.`,
        action: 'Review Financing', link: '/properties',
      })
    }
    if (armExposure > 30) {
      recs.push({
        type: 'warning',
        title: `High ARM exposure — ${fmtPct(armExposure)} variable-rate debt`,
        why: 'Variable-rate loans increase risk if rates rise. Consider converting to fixed-rate for stability.',
        action: 'View Loans', link: '/properties',
      })
    }
    if (d.portfolio_ltv < 60 && d.total_monthly_cash_flow > 0 && d.total_properties > 0) {
      recs.push({
        type: 'opportunity',
        title: 'Strong position to acquire another property',
        why: `Conservative LTV of ${fmtPct(d.portfolio_ltv)} and positive cash flow indicate available borrowing capacity.`,
        action: 'Add Property', link: '/properties/new',
      })
    }
    return recs.slice(0, 5)
  })()

  // ── Portfolio Insights ─────────────────────────────────────────────────────
  const insights = (() => {
    const ins = []
    const byMCF = [...d.properties].sort((a,b) => (b.monthly_cash_flow||0) - (a.monthly_cash_flow||0))
    if (byMCF[0]?.monthly_cash_flow > 0)
      ins.push({ color: '#15803d', text: `Best cash flow: ${byMCF[0].address.split(',')[0]} at ${fmt(byMCF[0].monthly_cash_flow)}/mo` })
    const worst = byMCF[byMCF.length - 1]
    if (worst?.monthly_cash_flow < 0)
      ins.push({ color: '#b91c1c', text: `Needs attention: ${worst.address.split(',')[0]} at ${fmt(worst.monthly_cash_flow)}/mo` })
    const byAppPct = [...d.properties].filter(p => p.purchase_price > 0).sort((a,b) => {
      const ag = (b.market_value-b.purchase_price)/b.purchase_price
      const bg = (a.market_value-a.purchase_price)/a.purchase_price
      return ag - bg
    })
    if (byAppPct[0]) {
      const p = byAppPct[0]
      const pct = (p.market_value - p.purchase_price) / p.purchase_price * 100
      ins.push({ color: '#2563eb', text: `Highest appreciation: ${p.address.split(',')[0]} +${pct.toFixed(1)}%` })
    }
    const byEq = [...d.properties].sort((a,b) => (b.equity||0) - (a.equity||0))
    if (byEq[0])
      ins.push({ color: '#7c3aed', text: `Largest equity position: ${byEq[0].address.split(',')[0]} — ${fmt(byEq[0].equity||0)}` })
    if (rentYoY?.pct != null) {
      const up = rentYoY.pct >= 0
      ins.push({ color: up ? '#15803d' : '#b91c1c', text: `Rental income ${up ? 'up' : 'down'} ${Math.abs(rentYoY.pct).toFixed(1)}% vs ${rentYoY.previousYear}` })
    }
    if (armExposure > 20)
      ins.push({ color: '#b45309', text: `${fmtPct(armExposure)} of debt is variable-rate — monitor rate changes` })
    if (d.total_principal_paid > 0)
      ins.push({ color: '#0369a1', text: `${fmt(d.total_principal_paid)} paid down in principal across all loans` })
    const expRatio = d.total_monthly_rent > 0 ? (d.total_monthly_rent - d.total_annual_noi/12) / d.total_monthly_rent * 100 : 0
    if (expRatio > 50)
      ins.push({ color: '#b45309', text: `Operating expense ratio is ${expRatio.toFixed(0)}% — above 50% target` })
    return ins.slice(0, 8)
  })()

  // ── Waterfall data ─────────────────────────────────────────────────────────
  const monthlyOpex   = Math.max(0, d.total_monthly_rent - d.total_annual_noi / 12)
  const expenseRatio  = d.total_monthly_rent > 0 ? monthlyOpex / d.total_monthly_rent * 100 : 0
  const annualDepreciation = yearlyTrends.length > 0
    ? yearlyTrends.reduce((s, r) => s + (r.depreciation || 0), 0) / yearlyTrends.length
    : 0
  const annualInterestDeduction = yearlyTrends.length > 0
    ? yearlyTrends.reduce((s, r) => s + (r.mortgage_interest || 0), 0) / yearlyTrends.length
    : 0
  const latestTaxablIncome = latestTrend?.net_income ?? null
  const latestDepreciation = latestTrend?.depreciation ?? null

  return (
    <div className="min-h-screen bg-slate-50/40 dark:bg-gray-950 -mx-6 -mt-6 px-0">

      {/* ── STICKY FILTER BAR ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/98 dark:bg-gray-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">Portfolio Dashboard</h1>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${healthInfo.cls}`}
            style={{ color: healthInfo.color }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: healthInfo.color }} />
            {healthScore}/100 · {healthInfo.label}
          </div>
          <span className="text-xs text-slate-400 dark:text-gray-500 hidden sm:block">
            {filteredProps.length} of {data.properties.length} {data.properties.length === 1 ? 'property' : 'properties'}
            {excludedCount > 0 && <span className="ml-1 text-amber-600">— {excludedCount} excluded</span>}
          </span>
        </div>
        {/* Property filter */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
          >
            <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500" />
            {excludedCount > 0 ? `${filteredProps.length} selected` : 'All Properties'}
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 dark:text-gray-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 mt-1.5 w-64 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Filter Properties</span>
                  {excludedCount > 0 && (
                    <button onClick={() => setExcludedIds(new Set())} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Show all</button>
                  )}
                </div>
              {(data.dashboard?.filter_properties || data.properties).map(p => {
                  const primary  = isPrimary(p)
                  const excluded = excludedIds.has(p.id)
                  return (
<label key={p.id} className={`flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${excluded ? 'opacity-50' : ''}`}>
                      <input type="checkbox" checked={!excluded}
                        onChange={() => setExcludedIds(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
<span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{p.address}</span>
{primary && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 shrink-0"><Home className="w-2.5 h-2.5" />Primary</span>}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{p.city}, {p.state}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10 space-y-14">

        {/* ══ 1. PORTFOLIO SUMMARY ═══════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={TrendingUp} title="Portfolio Summary" sub="30-second executive overview" />
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <ExecKPI label="Portfolio Value"    value={fmt(d.total_market_value)}
              trend={appreciationPct != null ? `${appreciationPct >= 0 ? '+' : ''}${appreciationPct.toFixed(1)}% vs purchase` : null}
              good={true} info="Current estimated market value across all properties." />
            <ExecKPI label="Total Equity"       value={fmt(d.total_equity)}
              trend={`${fmtPct(d.portfolio_equity_pct)} of value`}
              good={d.total_equity > 0} info="Market value minus all outstanding loan balances." />
            <ExecKPI label="Monthly Cash Flow"  value={fmt(d.total_monthly_cash_flow)}
              trend={cfMarginPct > 0 ? `${cfMarginPct.toFixed(1)}% margin` : 'Negative margin'}
              good={d.total_monthly_cash_flow >= 0} info="Rent minus operating costs and mortgage principal & interest." />
            <ExecKPI label="Portfolio LTV"      value={fmtPct(d.portfolio_ltv)}
              trend={d.portfolio_ltv < 65 ? 'Conservative leverage' : d.portfolio_ltv < 80 ? 'Moderate leverage' : 'Elevated leverage'}
              good={d.portfolio_ltv < 75} info="Total debt ÷ market value. Below 65% is strong." />
            <ExecKPI label="Annual NOI"         value={fmt(d.total_annual_noi)}
              trend={`${fmt(d.total_annual_noi / 12)}/mo`}
              good={d.total_annual_noi > 0} info="Net Operating Income before debt service." />
          </div>

          {/* Executive Summary */}
          <div className="mt-6 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-gray-300">Executive Summary</p>
              <p className="text-[11px] text-slate-400 dark:text-gray-500">Rental portfolio only</p>
            </div>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-gray-300">{aiSummary}</p>
          </div>

          {/* Primary Residence Advisory */}
          {d.has_primary && (
            <div className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-6 py-5">
              <div className="flex items-start gap-3">
                <Home className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 mb-1">Primary Residence — Excluded from Rental Metrics</p>
                  <p className="text-xs text-amber-950 dark:text-amber-100 leading-relaxed mb-4">
                    Your primary home is a personal liability, not a rental asset. Its mortgage is a living expense — not portfolio income or debt service.
                    It is excluded from all rental metrics above (cash flow, NOI, DSCR, LTV). It is tracked separately below for net worth purposes.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'Market Value',    value: fmt(d.primary_market_value) },
                      { label: 'Equity Built',    value: fmt(d.primary_equity) },
                      { label: 'LTV',             value: fmtPct(d.primary_ltv) },
                      { label: 'Monthly Cost',    value: fmt(d.primary_monthly_cost) },
                    ].map(kv => (
                      <div key={kv.label} className="bg-white/70 dark:bg-gray-700/70 rounded-lg px-3 py-2.5">
<p className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold uppercase tracking-wider">{kv.label}</p>
<p className="text-base font-bold text-amber-950 dark:text-amber-100 mt-0.5">{kv.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-white/60 dark:bg-gray-700/60 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
<p className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-2">What to Do with Your Primary Home</p>
<div className="space-y-1.5 text-[11px] text-amber-950 dark:text-amber-100 leading-relaxed">
                      {d.primary_ltv < 70 && <p>• <strong>HELOC opportunity:</strong> At {fmtPct(d.primary_ltv)} LTV you likely qualify for a home equity line — a low-cost way to fund your next rental down payment.</p>}
                      {d.primary_ltv >= 70 && d.primary_ltv < 85 && <p>• <strong>Build equity first:</strong> Continue paying down your mortgage. At under 70% LTV, a HELOC becomes available for rental acquisition leverage.</p>}
                      {d.primary_ltv >= 85 && <p>• <strong>Focus on paydown:</strong> High LTV limits refinancing and HELOC options. Prioritize paying down below 80% before leveraging this asset.</p>}
                      <p>• <strong>Appreciation is real wealth:</strong> {fmt(d.primary_appreciation)} in unrealized gains adds to your net worth even though it generates no income.</p>
                      <p>• <strong>Do not count personal mortgage in portfolio DSCR</strong> — it will artificially drag down your rental income coverage ratio.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ══ 2. ACTION CENTER ═══════════════════════════════════════════ */}
        {actions.length > 0 && (
          <section>
            <DashSectionHeader icon={AlertCircle} title="Action Center" sub="Highest-impact recommendations for your portfolio" />
            <div className="mt-6 space-y-3">
              {actions.map((a, i) => {
                const cfg = a.type === 'danger'
                  ? { bar: '#dc2626', cls: 'bg-red-50 dark:bg-red-900/20', badgeCls: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300', icon: AlertCircle }
                  : a.type === 'opportunity'
                  ? { bar: '#2563eb', cls: 'bg-sky-50 dark:bg-sky-900/20', badgeCls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300', icon: CheckCircle }
                  : { bar: '#f59e0b', cls: 'bg-amber-50 dark:bg-amber-900/20', badgeCls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-300', icon: AlertCircle }
                const CfgIcon = cfg.icon
                return (
                  <div key={i} className={`rounded-xl border border-slate-100 dark:border-gray-700 overflow-hidden flex ${cfg.cls}`}>
                    <div className="w-1 shrink-0" style={{ background: cfg.bar }} />
                    <div className="flex items-start justify-between gap-4 px-5 py-4 flex-1 flex-wrap">
                      <div className="flex items-start gap-3">
                        <CfgIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: cfg.bar }} />
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{a.title}</p>
                          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 leading-relaxed">{a.why}</p>
                        </div>
                      </div>
                      <Link to={a.link}
                        className={`shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${cfg.badgeCls}`}>
                        {a.action} <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ══ 3. PORTFOLIO HEALTH ════════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={Shield} title="Portfolio Health" sub="How healthy is my overall portfolio?" link="/properties" linkLabel="All Properties" />
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <HealthKPI
              label="Portfolio LTV" value={fmtPct(d.portfolio_ltv)}
              good={d.portfolio_ltv < 65} warn={d.portfolio_ltv >= 65 && d.portfolio_ltv < 80}
              trend={`${fmt(d.total_loan_balance)} remaining debt`}
              explanation="Loan-to-Value measures leverage. Below 65% is conservative; above 80% limits future borrowing."
              recommendation={d.portfolio_ltv < 65 ? 'Continue current strategy. Strong equity position.' : d.portfolio_ltv < 80 ? 'Leverage is moderate. Maintain current paydown pace.' : 'Elevated leverage. Prioritize paydown before new acquisitions.'} />
            <HealthKPI
              label="DSCR" value={d.portfolio_dscr != null ? `${d.portfolio_dscr.toFixed(2)}×` : 'N/A'}
              good={d.portfolio_dscr == null || d.portfolio_dscr > 1.25} warn={d.portfolio_dscr != null && d.portfolio_dscr > 1.0 && d.portfolio_dscr <= 1.25}
              trend="Target above 1.25×"
              explanation="Debt Service Coverage Ratio = NOI ÷ Debt Service. Shows how comfortably income covers loan payments."
              recommendation={d.portfolio_dscr == null ? 'Add loan and income data to compute DSCR.' : d.portfolio_dscr > 1.5 ? 'Excellent coverage. Cash flow comfortably exceeds debt.' : d.portfolio_dscr > 1.25 ? 'Good coverage. Adequate buffer above minimum threshold.' : 'Below target. Focus on increasing NOI or reducing debt service.'} />
            <HealthKPI
              label="Cash Flow Margin" value={`${cfMarginPct.toFixed(1)}%`}
              good={cfMarginPct > 5} warn={cfMarginPct > 0 && cfMarginPct <= 5}
              trend={`${fmt(d.total_monthly_cash_flow)}/mo net`}
              explanation="What percentage of rent becomes profit after all costs. Above 10% is healthy; below 0% is losing money."
              recommendation={cfMarginPct > 10 ? 'Strong margin. Portfolio is generating meaningful profit.' : cfMarginPct > 0 ? 'Thin margin. Monitor expenses and consider rent increases.' : 'Negative margin. Immediate rent or expense review recommended.'} />
            <HealthKPI
              label="Occupancy Rate" value={`${occupancyRate.toFixed(1)}%`}
              good={occupancyRate > 92} warn={occupancyRate > 85 && occupancyRate <= 92}
              trend={`${fmtPct(vacancyRate)} vacancy`}
              explanation="Percentage of scheduled rent actually collected. Accounts for vacancy periods and concessions."
              recommendation={occupancyRate > 95 ? 'Excellent occupancy. Properties are well-tenanted.' : occupancyRate > 90 ? 'Good occupancy. Small vacancy allowance is normal.' : 'Below target. Review pricing, marketing, and tenant retention.'} />
            <HealthKPI
              label="Expense Ratio" value={`${expenseRatio.toFixed(1)}%`}
              good={expenseRatio < 40} warn={expenseRatio >= 40 && expenseRatio < 55}
              trend="Target below 45%"
              explanation="Operating expenses as a percentage of gross rent. Below 45% is efficient; above 55% indicates high costs."
              recommendation={expenseRatio < 40 ? 'Efficient operations. Costs well-controlled.' : expenseRatio < 55 ? 'Moderate expenses. Review largest cost categories.' : 'High expense ratio. Detailed expense audit recommended.'} />
            <HealthKPI
              label="Portfolio Appreciation" value={appreciationPct != null ? `${appreciationPct >= 0 ? '+' : ''}${appreciationPct.toFixed(1)}%` : 'N/A'}
              good={appreciationPct == null || appreciationPct > 0} warn={false}
              trend={`${fmt(d.total_appreciation_gain)} unrealized gain`}
              explanation="Total market value growth versus original purchase prices across all properties."
              recommendation={appreciationPct == null ? 'Add purchase prices and market values to track appreciation.' : appreciationPct > 10 ? 'Strong appreciation. Significant unrealized wealth has been created.' : appreciationPct > 0 ? 'Positive appreciation adds to net worth even without cash flow.' : 'Market value below purchase price. Monitor local market conditions.'} />
          </div>
        </section>

        {/* ══ 4. PROPERTY HEALTH ═════════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={Building2} title="Property Health" sub="Which properties need attention?" link="/properties" linkLabel="Manage Properties" />
          <div className="mt-6 bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-gray-700 text-slate-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">
                    <th className="px-5 py-3 text-left font-semibold">Property</th>
                    <th className="px-4 py-3 text-center font-semibold">Health</th>
                    <th className="px-4 py-3 text-right font-semibold">Cash Flow</th>
                    <th className="px-4 py-3 text-right font-semibold">LTV</th>
                    <th className="px-4 py-3 text-right font-semibold">Equity</th>
                    <th className="px-4 py-3 text-center font-semibold">Risk</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-gray-700/50">
                  {primaryProps.map(p => {
                    const ltv = p.market_value > 0 ? (p.total_loan_balance||0)/p.market_value*100 : 0
                    return (
                      <tr key={p.id} className="bg-amber-50/40 dark:bg-amber-900/20">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <Link to={`/properties/${p.id}`} className="font-medium text-slate-900 dark:text-white hover:text-blue-600 transition-colors block">{p.address.split(',')[0]}</Link>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"><Home className="w-2.5 h-2.5" />Primary</span>
                          </div>
                          <span className="text-[10px] text-slate-400 dark:text-gray-500">{p.city}, {p.state}</span>
                        </td>
                      <td className="px-4 py-3.5 text-center"><span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">N/A</span></td>
                      <td className="px-4 py-3.5 text-right"><span className="text-xs text-amber-800 dark:text-amber-200 font-medium">{fmt(p.monthly_mortgage||0)}/mo cost</span><p className="text-[10px] text-slate-400 dark:text-gray-500">personal expense</p></td>
                        <td className="px-4 py-3.5 text-right"><span className="font-semibold text-sm" style={{ color: ltv > 80 ? '#dc2626' : ltv > 65 ? '#d97706' : '#059669' }}>{fmtPct(ltv)}</span></td>
                        <td className="px-4 py-3.5 text-right"><span className="font-medium text-slate-700 dark:text-gray-300 text-sm">{fmt(p.equity||0)}</span></td>
                      <td className="px-4 py-3.5 text-center"><span className="text-[10px] text-amber-700 dark:text-amber-300 font-bold">—</span></td>
                      <td className="px-4 py-3.5 text-center"><span className="inline-block text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">Residence</span></td>
                      <td className="px-4 py-3.5"><p className="text-xs text-amber-800 dark:text-amber-200 leading-snug max-w-[200px]">{ltv < 70 ? 'HELOC available — consider for rental down payment' : 'Build equity; excluded from portfolio metrics'}</p></td>
                      </tr>
                    )
                  })}
                  {/* Rental properties — sorted by health score */}
                  {[...rentalProps].sort((a,b) => propScore(a) - propScore(b)).map(p => {
                    const score  = propScore(p)
                    const status = propStatus(score)
                    const ltv    = p.market_value > 0 ? (p.total_loan_balance || 0) / p.market_value * 100 : 0
                    const cfPos  = (p.monthly_cash_flow || 0) >= 0
                    const hasArm = p.loans?.some(l => (l.loan_type||'').toUpperCase() === 'ARM')
                    const risk   = score < 40 ? { label: 'High',   color: '#b91c1c' }
                                 : score < 60 ? { label: 'Medium', color: '#b45309' }
                                 :              { label: 'Low',    color: '#15803d' }
                    const rec    = !cfPos ? 'Review rent or expenses immediately'
                                 : ltv > 80  ? 'Reduce LTV through paydown or reappraisal'
                                 : hasArm    ? 'Consider converting ARM to fixed rate'
                                 : score >= 80 ? 'Continue current strategy — performing well'
                                 : 'Monitor performance and occupancy'
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-gray-700/30 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link to={`/properties/${p.id}`} className="font-medium text-slate-900 dark:text-white hover:text-blue-600 transition-colors block">{p.address.split(',')[0]}</Link>
                          <span className="text-[10px] text-slate-400 dark:text-gray-500">{p.city}, {p.state}</span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="text-base font-bold" style={{ color: status.color }}>{score}</span>
                            <div className="w-10 h-1 rounded-full bg-slate-100 mt-1 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${score}%`, background: status.color }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={`font-semibold text-sm ${cfPos ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(p.monthly_cash_flow)}</span>
                          <p className="text-[10px] text-slate-400 dark:text-gray-500">/mo</p>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-semibold text-sm" style={{ color: ltv > 80 ? '#dc2626' : ltv > 65 ? '#d97706' : '#059669' }}>{fmtPct(ltv)}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-medium text-slate-700 dark:text-gray-300 text-sm">{fmt(p.equity||0)}</span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: `${risk.color}18`, color: risk.color }}>{risk.label}</span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-full ${status.cls}`}
                            style={{ color: status.color }}>{status.label}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="text-xs text-slate-500 dark:text-gray-400 leading-snug max-w-[200px]">{rec}</p>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ══ 5. CASH FLOW STORY ═════════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={DollarSign} title="Cash Flow" sub="Where is my money going?" />
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Waterfall */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">Monthly Breakdown</p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Where rent goes each month</h3>
              {[
                { label: 'Gross Rent',      value: d.total_monthly_rent,      color: '#2563eb', type: 'income' },
                { label: 'Operating Exp.',  value: -monthlyOpex,              color: '#e11d48', type: 'expense' },
                { label: '→ NOI',           value: d.total_annual_noi / 12,   color: '#059669', type: 'sub' },
                { label: 'Debt Service',    value: -d.total_monthly_mortgage, color: '#e11d48', type: 'expense' },
                { label: '→ Net Cash Flow', value: d.total_monthly_cash_flow, color: d.total_monthly_cash_flow >= 0 ? '#059669' : '#dc2626', type: 'total' },
              ].map((row, i) => {
                const max  = d.total_monthly_rent || 1
                const pct  = Math.min(Math.abs(row.value) / max * 100, 100)
                const isTotal = row.type === 'total' || row.type === 'sub'
                return (
                  <div key={i} className={`mb-3 ${row.type === 'sub' ? 'pl-4' : ''}`}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-medium ${isTotal ? 'text-slate-700 dark:text-gray-300' : 'text-slate-500 dark:text-gray-400'}`}>{row.label}</span>
                      <span className="font-semibold" style={{ color: row.color }}>{fmt(row.value)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: row.color, opacity: isTotal ? 1 : 0.7 }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Trend */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">Year-over-Year</p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Income vs expenses trend</h3>
              {yearlyTrends.length > 1 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={yearlyTrends} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip formatter={(v, n) => [fmt(v), n]} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${dark ? '#374151' : '#e2e8f0'}`, background: dark ? '#1f2937' : '#ffffff', color: dark ? '#d1d5db' : '#374151' }} />
                    <Line type="monotone" dataKey="rental_income" name="Gross Rent" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="operating_expenses" name="Op. Expenses" stroke="#e11d48" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="net_income" name="Net Income" stroke="#059669" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-slate-400 dark:text-gray-500 mt-4">Upload tax returns to see year-over-year trends.</p>
              )}
              {netIncomeYoY && (
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-gray-700 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-slate-400 dark:text-gray-500">Rent YoY</p>
                    <p className="font-semibold mt-0.5" style={{ color: (rentYoY?.pct||0) >= 0 ? '#059669' : '#dc2626' }}>
                      {rentYoY?.pct != null ? `${rentYoY.pct >= 0 ? '+' : ''}${rentYoY.pct.toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-gray-500">Expense YoY</p>
                    <p className="font-semibold mt-0.5" style={{ color: (expenseYoY?.pct||0) <= 0 ? '#059669' : '#dc2626' }}>
                      {expenseYoY?.pct != null ? `${expenseYoY.pct >= 0 ? '+' : ''}${expenseYoY.pct.toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 dark:text-gray-500">Net Income YoY</p>
                    <p className="font-semibold mt-0.5" style={{ color: (netIncomeYoY?.pct||0) >= 0 ? '#059669' : '#dc2626' }}>
                      {netIncomeYoY?.pct != null ? `${netIncomeYoY.pct >= 0 ? '+' : ''}${netIncomeYoY.pct.toFixed(1)}%` : '—'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cash flow narrative */}
          <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-xl px-5 py-4">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">Cash Flow Interpretation</p>
            <p className="text-xs text-blue-900 dark:text-blue-300 leading-relaxed">
              {d.total_monthly_cash_flow > 0
                ? `After paying all ${d.total_properties} property expenses and mortgage payments, the portfolio generates ${fmt(d.total_monthly_cash_flow)}/mo (${cfMarginPct.toFixed(1)}% of gross rent). ${cfMarginPct > 10 ? 'This is a healthy margin.' : 'The margin is thin — review expenses or consider rent increases.'}`
                : `The portfolio currently generates a net loss of ${fmt(Math.abs(d.total_monthly_cash_flow))}/mo after all expenses and debt service. Identify properties with the largest negative contribution and review rent or expense strategies.`
              }
            </p>
          </div>
        </section>

        {/* ══ 6. EQUITY STORY ════════════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={TrendingUp} title="Equity Growth" sub="How is my wealth growing?" />
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Capital stack */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">Capital Stack</p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Equity vs debt composition</h3>
              <div className="mb-4">
                <div className="flex justify-between text-xs text-slate-500 dark:text-gray-400 mb-2">
                  <span>Equity {fmtPct(d.portfolio_equity_pct)}</span>
                  <span>Debt {fmtPct(d.portfolio_ltv)}</span>
                </div>
                <div className="h-5 rounded-lg overflow-hidden bg-slate-100 flex">
                  <div className="h-full rounded-l-lg transition-all" style={{ width: `${Math.max(d.portfolio_equity_pct, 2)}%`, background: '#2563eb' }} />
                  <div className="h-full flex-1 rounded-r-lg" style={{ background: '#e2e8f0' }} />
                </div>
                <div className="flex justify-between mt-2 text-xs font-semibold">
                  <span className="text-blue-600">{fmt(d.total_equity)}</span>
                  <span className="text-slate-500 dark:text-gray-400">{fmt(d.total_loan_balance)}</span>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100 dark:border-gray-700 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-gray-400">Appreciation gain</span>
<span className="font-semibold text-slate-800 dark:text-gray-200">{fmt(d.total_appreciation_gain)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-gray-400">Principal paid down</span>
<span className="font-semibold text-slate-800 dark:text-gray-200">{fmt(d.total_principal_paid)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-slate-100 dark:border-gray-700 pt-2">
                  <span className="text-slate-600 dark:text-gray-300 font-medium">Total equity built</span>
                  <span className="font-bold text-blue-700">{fmt(d.total_equity)}</span>
                </div>
              </div>
            </div>

            {/* Equity by property */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">By Property</p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Equity contribution and LTV per property</h3>
              <div className="space-y-4">
                {[...rentalProps].sort((a,b) => (b.equity||0) - (a.equity||0)).map(p => {
                  const ltv    = p.market_value > 0 ? (p.total_loan_balance||0) / p.market_value * 100 : 0
                  const eqPct  = d.total_equity > 0 ? (p.equity||0) / d.total_equity * 100 : 0
                  const appGain = (p.market_value||0) - (p.purchase_price||0)
                  return (
                    <div key={p.id}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <Link to={`/properties/${p.id}`} className="text-xs font-medium text-slate-700 dark:text-gray-300 hover:text-blue-600 truncate max-w-[180px]">{p.address.split(',')[0]}</Link>
                        <div className="flex items-center gap-3 shrink-0 text-xs">
                          <span className="text-slate-400 dark:text-gray-500">{fmtPct(ltv)} LTV</span>
<span className="font-semibold text-slate-800 dark:text-gray-200">{fmt(p.equity||0)}</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(eqPct, 100)}%`, background: '#2563eb' }} />
                      </div>
                      {appGain !== 0 && (
                        <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">{appGain >= 0 ? '+' : ''}{fmt(appGain)} appreciation · purchased {fmt(p.purchase_price||0)}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Equity narrative */}
          <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-xl px-5 py-4">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">Equity Growth Interpretation</p>
            <p className="text-xs text-blue-900 dark:text-blue-300 leading-relaxed">
              {d.total_equity > 0
                ? `Your portfolio holds ${fmt(d.total_equity)} in total equity. ${d.total_appreciation_gain > d.total_principal_paid ? `Most of this (${fmt(d.total_appreciation_gain)}) came from property appreciation rather than mortgage paydown (${fmt(d.total_principal_paid)}), reflecting market value growth.` : `${fmt(d.total_principal_paid)} came from principal paydown and ${fmt(Math.max(0, d.total_appreciation_gain))} from market appreciation.`}`
                : 'Add market values and loan balances to track equity growth across your portfolio.'}
            </p>
          </div>
        </section>

        {/* ══ 7. DEBT STORY ══════════════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={Landmark} title="Debt & Leverage" sub="Is my leverage healthy?" />
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Loan table */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500">Loan Summary</p>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">All loans · balances and rates</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-gray-700 text-slate-400 dark:text-gray-500 text-[10px] uppercase tracking-wider">
                      <th className="px-5 py-2.5 text-left font-semibold">Property</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Type</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Rate</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Principal & Interest / mo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-gray-700/50">
                    {rentalProps.flatMap(p => (p.loans||[]).map(l => ({ ...l, property: p }))).map((l, i) => {
                      const rateColor = (l.interest_rate||0) > 7 ? '#dc2626' : (l.interest_rate||0) > 5.5 ? '#d97706' : '#059669'
                      const type = (l.loan_type||'Fixed').toUpperCase()
                      return (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-gray-700/30">
                          <td className="px-5 py-2.5">
<Link to={`/properties/${l.property.id}`} className="font-medium text-slate-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-[140px] block">{l.property.address.split(',')[0]}</Link>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${type === 'ARM' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'}`}>{type}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-slate-700 dark:text-gray-300">{fmt(l.current_balance||0)}</td>
                          <td className="px-3 py-2.5 text-center font-bold" style={{ color: rateColor }}>{fmtPct(l.interest_rate||0)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-slate-700 dark:text-gray-300">{fmt(l.monthly_payment||0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-slate-100 dark:border-gray-700 grid grid-cols-3 gap-3 text-xs">
<div><p className="text-slate-400 dark:text-gray-500">Total debt</p><p className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5">{fmt(d.total_loan_balance)}</p></div>
                <div><p className="text-slate-400 dark:text-gray-500">Avg. rate</p><p className="font-semibold mt-0.5" style={{ color: debtWeightedRate > 7 ? '#dc2626' : '#059669' }}>{fmtPct(debtWeightedRate)}</p></div>
<div><p className="text-slate-400 dark:text-gray-500">Monthly Principal & Interest</p><p className="font-semibold text-slate-800 dark:text-gray-200 mt-0.5">{fmt(d.total_monthly_mortgage)}</p></div>
              </div>
            </div>

            {/* Rate spectrum */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">Rate Spectrum</p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Interest rates by loan</h3>
              {d_loans.filter(l => l.interest_rate).length === 0
                ? <p className="text-xs text-slate-400 dark:text-gray-500">No rate data. Add loan details to see rates.</p>
                : d_loans.filter(l => l.interest_rate).map((l, i) => {
                    const p = d.properties.find(pr => pr.loans?.some(ll => ll.id === l.id))
                    const name = p ? truncate(p.address.split(',')[0], 18) : `Loan ${i+1}`
                    const rCol = l.interest_rate > 7 ? '#dc2626' : l.interest_rate > 5.5 ? '#f59e0b' : '#059669'
                    return (
                      <div key={i} className="mb-4">
                        <div className="flex justify-between mb-1 text-xs">
                          <span className="text-slate-600 dark:text-gray-300 font-medium truncate">{name}</span>
                          <span className="font-bold ml-2 shrink-0" style={{ color: rCol }}>{fmtPct(l.interest_rate)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div style={{ width: `${Math.min(l.interest_rate / 10 * 100, 100)}%`, background: rCol }} className="h-full rounded-full" />
                        </div>
                      </div>
                    )
                  })
              }
              {debtWeightedRate > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-gray-700 flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-gray-400">Portfolio weighted avg.</span>
                  <span className="font-bold" style={{ color: debtWeightedRate > 7 ? '#dc2626' : debtWeightedRate > 5.5 ? '#d97706' : '#059669' }}>{fmtPct(debtWeightedRate)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Debt narrative */}
          <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
            <p className="text-xs font-semibold text-blue-700 mb-1">Leverage Interpretation</p>
            <p className="text-xs text-blue-900 leading-relaxed">
              {d.portfolio_ltv < 65
                ? `Portfolio LTV of ${fmtPct(d.portfolio_ltv)} is conservative, leaving significant equity cushion and borrowing capacity. Debt service of ${fmt(d.annual_debt_service)}/yr is ${d.portfolio_dscr != null ? `covered ${d.portfolio_dscr.toFixed(2)}× by NOI.` : 'being tracked.'}`
                : d.portfolio_ltv < 80
                ? `Portfolio LTV of ${fmtPct(d.portfolio_ltv)} is moderate. Continue current paydown pace to build long-term equity. Annual debt service is ${fmt(d.annual_debt_service)}.`
                : `Portfolio LTV of ${fmtPct(d.portfolio_ltv)} is elevated. Prioritize reducing debt before adding new acquisitions. Consider aggressive paydown on highest-rate loans first.`
              }
            </p>
          </div>
        </section>

        {/* ══ 8. TAX STORY ═══════════════════════════════════════════════ */}
        <section>
          <DashSectionHeader icon={FileText} title="Tax Picture" sub="How are rentals affecting your taxes?" link="/uploads" linkLabel="Upload Tax Returns" />
          {yearlyTrends.length === 0 ? (
            <div className="mt-6 bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-8 text-center shadow-sm">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-600 dark:text-gray-300">No tax return data yet</p>
              <p className="text-xs text-slate-400 dark:text-gray-500 mt-1 mb-4">Upload Schedule E tax returns to see depreciation, deductions, and taxable income analysis.</p>
              <Link to="/uploads" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors">
                Upload Tax Returns <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Key deductions */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">Latest Year Deductions</p>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Tax benefits from rentals</h3>
                {[
                  { label: 'Depreciation', value: latestDepreciation, note: 'Non-cash deduction — reduces taxable income without cash outlay', color: '#7c3aed' },
                  { label: 'Mortgage Interest', value: latestTrend?.mortgage_interest, note: 'Deductible interest paid on rental loans', color: '#2563eb' },
                  { label: 'Property Taxes', value: latestTrend?.property_taxes, note: 'State and local property taxes paid', color: '#0369a1' },
                  { label: 'Gross Rental Income', value: latestTrend?.rental_income, note: 'Total rent collected — offset by deductions above', color: '#374151' },
                  { label: 'Taxable Net Income', value: latestTaxablIncome, note: 'After all deductions. Negative = passive loss (may carry forward)', color: latestTaxablIncome != null && latestTaxablIncome < 0 ? '#059669' : '#374151' },
                ].map((row, i) => (
                  <div key={i} className={`mb-3 ${i === 3 ? 'pt-3 border-t border-slate-100 dark:border-gray-700' : ''}`}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-slate-500 dark:text-gray-400">{row.label}</span>
                      <span className="font-semibold" style={{ color: row.color }}>{row.value != null ? fmt(row.value) : '—'}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 leading-tight">{row.note}</p>
                  </div>
                ))}
              </div>

              {/* Depreciation trend */}
              <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1">Historical Tax Data</p>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-5">Net income vs depreciation by year</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={yearlyTrends} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip formatter={(v, n) => [fmt(v), n]} contentStyle={{ fontSize: 11, borderRadius: 8, border: `1px solid ${dark ? '#374151' : '#e2e8f0'}`, background: dark ? '#1f2937' : '#ffffff', color: dark ? '#d1d5db' : '#374151' }} />
                    <ReferenceLine y={0} stroke="#e2e8f0" />
                    <Bar dataKey="net_income" name="Net Income" fill="#2563eb" radius={[3,3,0,0]} />
                    <Bar dataKey="depreciation" name="Depreciation" fill="#7c3aed" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/50 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-1">Why Cash Flow ≠ Taxable Income</p>
                  <p className="text-[10px] text-violet-900 dark:text-violet-300 leading-relaxed">
                    Depreciation (typically ~{fmt(annualDepreciation)}/yr) is a non-cash deduction — you don't write a check for it, but it reduces your taxable rental income. A property can be cash-flow positive while showing a tax loss, creating tax shelter benefits.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ══ 9. PORTFOLIO INSIGHTS ══════════════════════════════════════ */}
        {insights.length > 0 && (
          <section>
            <DashSectionHeader icon={Lightbulb} title="Portfolio Insights" sub="Automated observations across your portfolio" />
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-3 bg-white dark:bg-gray-800 rounded-xl border border-slate-100 dark:border-gray-700 px-4 py-3.5 shadow-sm">
                  <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: ins.color }} />
                  <p className="text-xs text-slate-700 dark:text-gray-300 leading-relaxed">{ins.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

// ── Section header helper ──────────────────────────────────────────────────────
function DashSectionHeader({ icon: Icon, title, sub, link, linkLabel }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100">
          <Icon className="w-4 h-4 text-slate-500 dark:text-gray-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">{title}</h2>
          {sub && <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </div>
      </div>
      {link && (
        <Link to={link} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 shrink-0 mt-1">
          {linkLabel || 'View Details'} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}

// ── Executive KPI card ─────────────────────────────────────────────────────────
function ExecKPI({ label, value, trend, good, info }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium text-slate-500 dark:text-gray-400 mb-1.5">{label}</p>
      <p className="text-lg font-semibold text-slate-900 dark:text-white leading-none">{value}</p>
      {trend && (
        <p className="text-[11px] mt-2 leading-snug" style={{ color: good ? '#047857' : '#b91c1c' }}>{trend}</p>
      )}
    </div>
  )
}

// ── Health KPI card ────────────────────────────────────────────────────────────
function HealthKPI({ label, value, good, warn, trend, explanation, recommendation }) {
  const color = good ? '#15803d' : warn ? '#b45309' : '#b91c1c'
  const cls   = good
    ? { badge: 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800', rec: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400' }
    : warn
    ? { badge: 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800', rec: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400' }
    : { badge: 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800', rec: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400' }
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700 p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500">{label}</p>
        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cls.badge} ${cls.text}`}>
          {good ? 'Healthy' : warn ? 'Watch' : 'At Risk'}
        </span>
      </div>
      <p className="text-2xl font-bold leading-none" style={{ color }}>{value}</p>
      {trend && <p className="text-[11px] text-slate-500 dark:text-gray-400">{trend}</p>}
      <p className="text-[11px] text-slate-500 dark:text-gray-400 leading-relaxed border-t border-slate-100 dark:border-gray-700 pt-3">{explanation}</p>
      <div className={`rounded-lg px-3 py-2 ${cls.rec}`}>
        <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${cls.text}`}>Recommended Action</p>
        <p className={`text-[11px] leading-snug ${cls.text}`}>{recommendation}</p>
      </div>
    </div>
  )
}

// ── Shared style constant ─────────────────────────────────────────────────────
const subNote = { fontSize:10, color:'#9ca3af', marginTop:5 }

// ── Financing helpers ─────────────────────────────────────────────────────────

function DSCRHealthCard({ dscr, noi, ads }) {
  const status = dscr == null
    ? { label: 'No data',          color: '#6b7280', cls: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',    detail: 'Add loan and income data to compute DSCR.' }
    : dscr < 1
    ? { label: 'Danger zone',      color: '#dc2626', cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',     detail: "Income doesn't cover debt service." }
    : dscr < 1.25
    ? { label: 'Marginal coverage',color: '#d97706', cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', detail: 'Barely covering debt — monitor closely.' }
    : { label: 'Healthy coverage', color: '#047857', cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', detail: 'NOI comfortably covers annual debt service.' }
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${status.cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color:status.color }}>Debt Coverage</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{status.label}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-gray-300">{status.detail}</p>
        </div>
        <div className="rounded-lg bg-white/80 dark:bg-gray-700/80 border border-white dark:border-gray-600 px-3 py-2 text-center min-w-[56px] shrink-0">
          <p className="text-[10px] font-medium text-slate-400 dark:text-gray-500">DSCR</p>
          <p className="text-sm font-bold" style={{ color:status.color }}>{dscr != null ? dscr.toFixed(2) : 'N/A'}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-white/70 dark:bg-gray-700/70 border border-white dark:border-gray-600 p-3 space-y-1.5">
        <div className="flex justify-between text-xs text-slate-500 dark:text-gray-400">
          <span>Annual NOI</span>
          <span className="font-semibold text-slate-700 dark:text-gray-300">{fmt(Math.round(noi))}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500 dark:text-gray-400">
          <span>Annual Debt Service</span>
          <span className="font-semibold text-slate-700 dark:text-gray-300">{fmt(ads)}</span>
        </div>
      </div>
    </div>
  )
}

function DebtPaydownStack({ original, principalPaid, remaining, interestPaid }) {
  const base   = Math.max(original || 1, 1)
  const paidPct = Math.min(100, (principalPaid || 0) / base * 100)
  const remPct  = Math.min(100, (remaining || 0) / base * 100)
  const intPct  = Math.min(100, (interestPaid || 0) / base * 100)
  return (
    <div className="space-y-3">
      <CashFlowBar label="Original Loan"        value={fmt(original)}      pct={100}     color="#2563eb" />
      <CashFlowBar label="Principal Paid"       value={fmt(principalPaid)} pct={paidPct} color="#059669" />
      <CashFlowBar label="Remaining Balance"    value={fmt(remaining)}     pct={remPct}  color="#3b82f6" />
      <CashFlowBar label="Interest Paid to Date" value={fmt(interestPaid)} pct={intPct}  color="#dc2626" />
    </div>
  )
}

// ── Risk helpers ──────────────────────────────────────────────────────────────

function RiskFactorStack({ factors }) {
  return (
    <div className="space-y-3">
      {factors.map((f, i) => {
        const color = f.value > f.hi ? '#dc2626' : f.value > f.lo ? '#d97706' : '#059669'
        return (
          <div key={i}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-slate-500 dark:text-gray-400">{f.label}</span>
              <span className="font-semibold" style={{ color }}>{fmtPct(f.value)}</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div style={{ width:`${Math.min(f.value, 100)}%`, background:color }} className="h-full rounded-full" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RiskHealthCard({ dangerCount, warnCount, overallRisk }) {
  const status = overallRisk === 'high'
    ? { label: 'High risk portfolio', color: '#dc2626', cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',     detail: 'Multiple elevated risk factors need attention.' }
    : overallRisk === 'moderate'
    ? { label: 'Moderate risk',       color: '#d97706', cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', detail: 'Some risk factors merit monitoring.' }
    : { label: 'Low risk portfolio',  color: '#047857', cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', detail: 'All risk factors within healthy thresholds.' }
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${status.cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color:status.color }}>Portfolio Risk</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{status.label}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-gray-300">{status.detail}</p>
        </div>
        <div className="rounded-lg bg-white/80 dark:bg-gray-700/80 border border-white dark:border-gray-600 px-3 py-2 text-center shrink-0">
          <p className="text-[10px] font-medium text-slate-400 dark:text-gray-500">Level</p>
          <p className="text-sm font-bold capitalize" style={{ color:status.color }}>{overallRisk}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-white/70 dark:bg-gray-700/70 border border-white dark:border-gray-600 p-3 space-y-1.5">
        {dangerCount > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <span className="font-medium text-red-700">{dangerCount} critical factor{dangerCount > 1 ? 's' : ''}</span>
          </div>
        )}
        {warnCount > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            <span className="font-medium text-amber-700">{warnCount} moderate factor{warnCount > 1 ? 's' : ''}</span>
          </div>
        )}
        {dangerCount === 0 && warnCount === 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-medium text-emerald-700">All factors in healthy range</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Paydown donut ring ────────────────────────────────────────────────────────
function PaydownDonut({ pct, size = 72, stroke = 7 }) {
  const r       = (size - stroke) / 2
  const circ    = 2 * Math.PI * r
  const offset  = circ * (1 - Math.min(pct, 100) / 100)
  const color   = pct >= 60 ? '#059669' : pct >= 30 ? '#2563eb' : '#94a3b8'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold text-slate-700 dark:text-gray-300">{pct.toFixed(0)}%</span>
      </div>
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────
function TileGrid({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap:14 }}>
      {children}
    </div>
  )
}

function InfoTip({ children }) {
  return (
    <div className="group relative inline-flex items-center cursor-help">
      <svg className="w-3 h-3 text-slate-300 group-hover:text-slate-500 dark:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity z-50 w-52 p-2.5 bg-slate-900 text-white text-[11px] leading-relaxed rounded-lg shadow-xl pointer-events-none">
        {children}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-t-[5px] border-t-slate-900 border-x-[5px] border-x-transparent" />
      </div>
    </div>
  )
}

function MetricWindow({ label, value, color, sub, info, bgClass = 'bg-white dark:bg-gray-800' }) {
  return (
    <div className={`rounded-xl border border-slate-100 dark:border-gray-700 ${bgClass} px-4 py-3.5 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-600 transition-all cursor-default group`}>
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{label}</span>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color }}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400 dark:text-gray-500">{sub}</p>}
    </div>
  )
}

function MetricPair({ label, value, color, info }) {
  return (
    <div className="rounded-lg border border-slate-100 dark:border-gray-700 bg-slate-50 dark:bg-gray-700 px-3 py-2.5 hover:bg-white dark:hover:bg-gray-600 hover:border-slate-300 hover:shadow-sm transition-all cursor-default">
      <div className="flex items-center gap-1 mb-0.5">
        <p className="text-[11px] font-medium text-slate-500 dark:text-gray-400">{label}</p>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <p className="mt-0.5 text-lg font-semibold tracking-tight" style={{ color }}>{value}</p>
    </div>
  )
}

function PortfolioStat({ label, value, sub, trend, info }) {
  return (
    <div className="p-5 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-default">
      <div className="flex items-center gap-1">
        <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 dark:text-gray-500">{label}</p>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">{sub}</p>
      {trend && <div className="mt-2"><YoYTrend label="YoY" trend={trend} format={fmt} compact /></div>}
    </div>
  )
}

function PortfolioComposition({ equityPct, ltv, equity, debt, value }) {
  const debtPct = Math.min(100, Math.max(0, ltv || 0))
  const ownedPct = Math.min(100, Math.max(0, equityPct || 0))
  const debtColor = ltv > 80 ? '#dc2626' : ltv > 60 ? '#d97706' : '#2563eb'

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-medium text-slate-500 dark:text-gray-400">Capital stack</p>
        <p className="text-xs text-slate-400 dark:text-gray-500">{fmt(value)} total market value</p>
      </div>
      <div className="h-5 rounded-md bg-slate-100 overflow-hidden flex">
        <div style={{ width:`${debtPct}%`, background:debtColor }} />
        <div style={{ width:`${ownedPct}%`, background:'#059669' }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-start gap-2">
          <span className="mt-1 h-2.5 w-2.5 rounded-sm shrink-0" style={{ background:debtColor }} />
          <div>
            <p className="font-semibold text-slate-700 dark:text-gray-300">Debt {fmtPct(debtPct)}</p>
            <p className="text-slate-400 dark:text-gray-500">{fmt(debt)} outstanding</p>
          </div>
        </div>
        <div className="flex items-start justify-end gap-2 text-right">
          <div>
            <p className="font-semibold text-emerald-700">Equity {fmtPct(ownedPct)}</p>
            <p className="text-slate-400 dark:text-gray-500">{fmt(equity)} owned</p>
          </div>
          <span className="mt-1 h-2.5 w-2.5 rounded-sm shrink-0 bg-emerald-600" />
        </div>
      </div>
    </div>
  )
}

function EquityHealthCard({ equityPct, ltv, value, equity }) {
  const status = ltv > 80
    ? { label:'Highly leveraged',  color:'#dc2626', cls:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',     detail:'Debt is above the usual 80% threshold.' }
    : ltv > 60
    ? { label:'Balanced leverage', color:'#d97706', cls:'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', detail:'Moderate leverage with room to improve.' }
    : { label:'Strong equity base',color:'#047857', cls:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', detail:'Conservative leverage across the portfolio.' }

  return (
    <div className={`rounded-xl border p-5 shadow-sm ${status.cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color:status.color }}>Equity Health</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{status.label}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-gray-300">{status.detail}</p>
        </div>
        <div className="rounded-lg bg-white/80 dark:bg-gray-700/80 border border-white dark:border-gray-600 px-3 py-2 text-right min-w-[84px]">
          <p className="text-[10px] font-medium text-slate-400 dark:text-gray-500">Equity</p>
          <p className="text-sm font-bold" style={{ color:status.color }}>{fmtPct(equityPct)}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-white/70 dark:bg-gray-700/70 border border-white dark:border-gray-600 p-3">
        <div className="flex justify-between text-xs text-slate-500 dark:text-gray-400">
          <span>Owned value</span>
          <span>{fmtPct(equityPct)}</span>
        </div>
        <p className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">{fmt(equity)}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">{fmt(value)} market value less debt</p>
      </div>
    </div>
  )
}

function CashFlowStack({ rent, noi, mortgage, cashFlow }) {
  const rentBase = Math.max(Math.abs(rent || 0), 1)
  const noiPct = Math.min(100, Math.max(0, Math.abs(noi || 0) / rentBase * 100))
  const mortgagePct = Math.min(100, Math.max(0, Math.abs(mortgage || 0) / rentBase * 100))
  const cashPct = Math.min(100, Math.max(0, Math.abs(cashFlow || 0) / rentBase * 100))
  const cashColor = cashFlow >= 0 ? '#059669' : '#dc2626'

  return (
    <div className="space-y-3">
      <CashFlowBar label="Effective Rent" value={fmt(rent)} pct={100} color="#059669" />
      <CashFlowBar label="Net Operating Income" value={fmt(noi)} pct={noiPct} color="#0f766e" />
      <CashFlowBar label="Mortgage Principal & Interest" value={fmt(mortgage)} pct={mortgagePct} color="#2563eb" />
      <CashFlowBar label="Net Cash Flow" value={fmt(cashFlow)} pct={cashPct} color={cashColor} />
    </div>
  )
}

function CashFlowBar({ label, value, pct, color }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-500 dark:text-gray-400">{label}</span>
        <span className="font-semibold text-slate-800">{value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div style={{ width:`${pct}%`, background:color }} className="h-full rounded-full" />
      </div>
    </div>
  )
}

function CashFlowHealthCard({ margin, cashFlow, rent }) {
  const status = margin >= 10
    ? { label:'Healthy cash yield',  color:'#047857', cls:'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', detail:'Portfolio cash flow is above the 10% margin target.' }
    : margin >= 0
    ? { label:'Thin positive margin',color:'#d97706', cls:'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', detail:'Cash flow is positive, but the cushion is limited.' }
    : { label:'Negative cash flow',  color:'#dc2626', cls:'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', detail:'Debt service and expenses exceed effective rent.' }

  return (
    <div className={`rounded-xl border p-5 shadow-sm ${status.cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color:status.color }}>Cash Flow Health</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{status.label}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-gray-300">{status.detail}</p>
        </div>
        <div className="rounded-full bg-white/80 dark:bg-gray-700/80 border border-white dark:border-gray-600 px-3 py-2 text-center">
          <p className="text-[10px] font-medium text-slate-400 dark:text-gray-500">Margin</p>
          <p className="text-sm font-bold" style={{ color:status.color }}>{rent > 0 ? fmtPct(margin) : 'N/A'}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-white/70 dark:bg-gray-700/70 border border-white dark:border-gray-600 p-3">
        <div className="flex justify-between text-xs text-slate-500 dark:text-gray-400">
          <span>Monthly surplus</span>
          <span>{rent > 0 ? `${fmtPct(margin)} of rent` : 'No rent data'}</span>
        </div>
        <p className="mt-1 text-xl font-semibold" style={{ color:status.color }}>{fmt(cashFlow)}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">{fmt(rent)} effective monthly rent</p>
      </div>
    </div>
  )
}

function AllocationList({ items, emptyText }) {
  if (!items.length) return <p className="text-sm text-slate-400 dark:text-gray-500">{emptyText}</p>

  return (
    <div className="space-y-3">
      {items.map(item => (
        <Link key={item.id} to={`/properties/${item.id}`} className="block group">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-xs font-medium text-slate-700 dark:text-gray-300 group-hover:text-blue-600 truncate">{item.name}</span>
            <span className="text-xs font-semibold text-slate-900 dark:text-white">{fmt(item.value)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex-1">
              <div className="h-full rounded-full" style={{ width:`${Math.min(item.pct, 100)}%`, background:item.color }} />
            </div>
            <span className="w-12 text-right text-[11px] font-semibold text-slate-500 dark:text-gray-400">{fmtPct(item.pct)}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function YoYTrend({ label, trend, format = fmt, inverse = false, compact = false }) {
  const [show, setShow] = useState(false)

  if (!trend) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-500 dark:text-gray-400">{label}</span>
        <span className="text-slate-400 dark:text-gray-500">No YoY data</span>
      </div>
    )
  }
  const isUp      = trend.delta >= 0
  const favorable = inverse ? !isUp : isUp
  const yoyColorCls = favorable
    ? 'text-green-700 dark:text-green-400 bg-emerald-50 dark:bg-emerald-900/20'
    : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
  const pctStr    = trend.pct == null ? '' : `${trend.pct >= 0 ? '+' : ''}${trend.pct.toFixed(1)}%`

  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <div className={`flex items-center justify-between gap-3 cursor-default ${compact ? 'text-[11px]' : 'text-xs'}`}>
        <span className="text-slate-500 dark:text-gray-400">{label}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${yoyColorCls}`}>
          {isUp ? '↑' : '↓'} {format(Math.abs(trend.delta))}{pctStr ? ` · ${pctStr}` : ''}
        </span>
      </div>

      {show && (
        <div className="absolute right-0 top-full mt-1.5 z-50 pointer-events-none"
          style={{ minWidth: 210 }}>
          <div className="bg-slate-900 text-white rounded-xl p-3 shadow-2xl text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-2.5">{label}</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-6">
                <span className="text-slate-400 dark:text-gray-500">{trend.previousYear}</span>
                <span className="font-medium text-slate-200">{format(trend.previous)}</span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="font-semibold text-white">{trend.currentYear}</span>
                <span className="font-bold text-white">{format(trend.current)}</span>
              </div>
              <div className="mt-1 pt-1.5 border-t border-slate-700 flex items-center justify-between gap-6">
                <span className="text-slate-400 dark:text-gray-500">Change</span>
                <span className="font-bold" style={{ color: favorable ? '#34d399' : '#f87171' }}>
                  {isUp ? '+' : ''}{format(trend.delta)}
                  {pctStr && <span className="ml-1 text-[10px] opacity-80">({pctStr})</span>}
                </span>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-500 dark:text-gray-400">
              {favorable ? '✓ Moving in the right direction' : '⚠ Review this metric'}
            </p>
          </div>
          <div className="absolute -top-1 right-5 w-2.5 h-2.5 bg-slate-900 rotate-45" />
        </div>
      )}
    </div>
  )
}

function YearlyTrendBars({ data }) {
  const rows = data.slice(-6)
  if (!rows.length) return <p className="mt-4 text-xs text-slate-400 dark:text-gray-500">Upload tax returns to populate YoY trend history.</p>

  const withDelta = rows.map((row, i) => ({
    ...row,
    _prev:           rows[i - 1] ?? null,
    delta_rent:      rows[i - 1] != null ? row.rental_income       - rows[i - 1].rental_income       : null,
    delta_income:    rows[i - 1] != null ? row.net_income           - rows[i - 1].net_income           : null,
    delta_expenses:  rows[i - 1] != null ? row.operating_expenses   - rows[i - 1].operating_expenses   : null,
  }))

  const TipContent = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null
    const row = withDelta.find(r => r.year === label)
    const entries = [
      { key: 'rental_income',       name: 'Rent',       color: '#10b981', deltaKey: 'delta_rent',     betterUp: true  },
      { key: 'operating_expenses',  name: 'Expenses',   color: '#f59e0b', deltaKey: 'delta_expenses',  betterUp: false },
      { key: 'net_income',          name: 'Net Income', color: '#2563eb', deltaKey: 'delta_income',    betterUp: true  },
    ]
    return (
      <div className="bg-slate-900 rounded-xl p-3 text-xs shadow-2xl" style={{ minWidth: 216 }}>
        <p className="font-bold text-white mb-2.5">{label}</p>
        {entries.map(({ key, name, color, deltaKey, betterUp }) => {
          const entry = payload.find(p => p.dataKey === key)
          if (!entry) return null
          const delta = row?.[deltaKey] ?? null
          const good  = delta == null ? null : betterUp ? delta > 0 : delta < 0
          const deltaColor = delta == null ? null : good ? '#34d399' : '#f87171'
          return (
            <div key={key} className="flex items-center justify-between gap-4 mb-1.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-slate-300">{name}</span>
              </span>
              <div className="text-right">
                <span className="font-semibold text-white">{fmt(entry.value)}</span>
                {delta != null && (
                  <span className="ml-1.5 text-[10px]" style={{ color: deltaColor }}>
                    {delta >= 0 ? '+' : ''}{fmt(delta)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {row?._prev && (
          <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1.5 pt-1.5 border-t border-slate-700">vs {row._prev.year}</p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={withDelta} barGap={2} barCategoryGap="28%"
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1000).toFixed(0)}k`} />
          <Tooltip content={<TipContent />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
          <Bar dataKey="rental_income"      name="Rent"       fill="#10b981" radius={[2,2,0,0]} isAnimationActive={false} maxBarSize={14} />
          <Bar dataKey="operating_expenses" name="Expenses"   fill="#f59e0b" radius={[2,2,0,0]} isAnimationActive={false} maxBarSize={14} />
          <Bar dataKey="net_income"         name="Net Income" radius={[2,2,0,0]}                isAnimationActive={false} maxBarSize={14}>
            {withDelta.map((row, i) => <Cell key={i} fill={row.net_income >= 0 ? '#2563eb' : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 justify-center mt-1">
        {[['#10b981','Rent'],['#f59e0b','Expenses'],['#2563eb','Net Income']].map(([c, n]) => (
          <span key={n} className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-gray-500">
            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: c }} />{n}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Core tile ─────────────────────────────────────────────────────────────────
function Tile({ label, value, sub, accent = false, children }) {
  const base = { borderRadius: T_RADIUS, padding: T_PAD }
  if (accent) return (
    <div style={{ ...base, background: ACCENT }}>
      <p style={{ fontSize:12, color:'rgba(255,255,255,0.65)', marginBottom:5, fontWeight:500 }}>{label}</p>
      <p style={{ fontSize:30, fontWeight:500, color:'white', lineHeight:1.1, marginBottom:4 }}>{value}</p>
      {sub && <p style={{ fontSize:12, color:'rgba(255,255,255,0.5)', lineHeight:1.4 }}>{sub}</p>}
      {children}
    </div>
  )
  return (
    <div className="bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700" style={base}>
      <p className="text-slate-500 dark:text-gray-400" style={{ fontSize:12, marginBottom:5, fontWeight:500 }}>{label}</p>
      <p className="text-slate-900 dark:text-white" style={{ fontSize:28, fontWeight:500, lineHeight:1.1, marginBottom:4 }}>{value}</p>
      {sub && <p className="text-slate-400 dark:text-gray-500" style={{ fontSize:12, lineHeight:1.4 }}>{sub}</p>}
      {children}
    </div>
  )
}

// ── Risk tile (tinted background, fill bar + benchmarks) ──────────────────────
function RiskTile({ label, value, sub, detail, risk, lo, hi, marks }) {
  const danger = risk > hi
  const warn   = risk > lo && !danger
  const col    = danger ? '#dc2626' : warn ? '#d97706' : '#16a34a'
  const active = danger ? 2 : warn ? 1 : 0
  const tileCls = danger
    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
    : warn
    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
    : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
  return (
    <div className={tileCls} style={{ borderRadius: T_RADIUS, padding: T_PAD }}>
      <p className="text-slate-600 dark:text-gray-300" style={{ fontSize:12, marginBottom:5, fontWeight:500 }}>{label}</p>
      <p style={{ fontSize:28, fontWeight:500, color:col, lineHeight:1.1, marginBottom:4 }}>{value}</p>
      {sub    && <p className="text-slate-500 dark:text-gray-400" style={{ fontSize:12, lineHeight:1.4 }}>{sub}</p>}
      {detail && <p className="text-slate-600 dark:text-gray-300" style={{ fontSize:11, marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{detail}</p>}
      <FillBar value={risk} max={100} color={col} />
      <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:3 }}>
        {marks.map((m, i) => (
          <p key={i} style={{ fontSize:10, color: i === active ? col : '#9ca3af', fontWeight: i === active ? 600 : 400, lineHeight:1.3 }}>{m}</p>
        ))}
      </div>
    </div>
  )
}

// ── Micro-visuals ─────────────────────────────────────────────────────────────

function SparkBar({ data, color = RAMPS.blue[3], onAccent = false }) {
  if (!data?.length) return null
  const bars = data.slice(-7)
  const max  = Math.max(...bars.map(Math.abs), 1)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:32, marginTop:10 }}>
      {bars.map((v, i) => {
        const h      = Math.max(2, Math.abs(v) / max * 32)
        const isLast = i === bars.length - 1
        const alpha  = isLast ? 1 : 0.15 + (i / Math.max(bars.length - 1, 1)) * 0.5
        return (
          <div key={i} style={{
            flex:1, height:h, borderRadius:2,
            background: onAccent ? `rgba(255,255,255,${alpha})` : color,
            opacity:    onAccent ? undefined : alpha,
          }} />
        )
      })}
    </div>
  )
}

function FillBar({ value, max = 100, color = RAMPS.blue[3] }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div style={{ marginTop:10, height:6, borderRadius:3, background:'#f3f4f6' }}>
      <div style={{ width:`${pct}%`, height:'100%', borderRadius:3, background:color, transition:'width 0.4s ease' }} />
    </div>
  )
}

function TrendBadge({ pct }) {
  if (pct == null || isNaN(pct)) return null
  const pos = pct >= 0
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:3,
      padding:'2px 8px', borderRadius:999,
      background: pos ? '#eaf3de' : '#fcebeb',
      color:      pos ? '#3b6d11' : '#a32d2d',
      fontSize:11, fontWeight:600,
    }}>
      {pos ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function RankedList({ items, linkBase = '/properties/' }) {
  return (
    <div style={{ marginTop:10 }}>
      {items.map((item, i) => {
        const row = (
          <div style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'5px 0', borderTop: i > 0 ? '0.5px solid #f3f4f6' : 'none',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
              <span style={{ fontSize:10, color:'#9ca3af', width:12, textAlign:'right', flexShrink:0 }}>{i + 1}</span>
              <span style={{ fontSize:11, color: item.id ? '#2d4fa1' : '#374151', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                textDecoration: item.id ? 'underline' : 'none', textUnderlineOffset:2 }}>{item.name}</span>
            </div>
            <span style={{ fontSize:11, fontWeight:500, color:'#111827', flexShrink:0, marginLeft:8 }}>{item.value}</span>
          </div>
        )
        return item.id
          ? <Link key={i} to={`${linkBase}${item.id}`} style={{ display:'block', textDecoration:'none' }}>{row}</Link>
          : <div key={i}>{row}</div>
      })}
    </div>
  )
}

function LTVBar({ ltv, loan, equity, mv }) {
  const debtPct  = Math.min(ltv, 100)
  const eqPct    = Math.max(0, 100 - debtPct)
  const debtColor = ltv > 80 ? '#dc2626' : ltv > 60 ? '#d97706' : '#3b82f6'
  const eqColor   = '#16a34a'

  return (
    <div style={{ marginTop: 10 }}>
      {/* Stacked bar */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', background: '#f3f4f6' }}>
          <div style={{ width: `${debtPct}%`, background: debtColor, transition: 'width .4s' }} />
          <div style={{ flex: 1, background: eqColor, opacity: 0.75 }} />
        </div>
        {/* 80% threshold marker */}
        <div style={{ position: 'absolute', top: 0, left: '80%', width: 2, height: 22, background: '#fff', opacity: 0.8 }} />
        <div style={{ position: 'absolute', top: 24, left: '80%', transform: 'translateX(-50%)' }}>
          <span style={{ fontSize: 9, color: '#9ca3af', whiteSpace: 'nowrap' }}>│ 80%</span>
        </div>
      </div>
      {/* Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: debtColor }} />
<span className="text-slate-500 dark:text-gray-400" style={{ fontSize: 10 }}>Debt {fmtPct(debtPct)}</span>
          </div>
<span className="text-slate-900 dark:text-white" style={{ fontSize: 12, fontWeight: 600 }}>{fmt(loan)}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1, justifyContent: 'flex-end' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: eqColor }} />
<span className="text-slate-500 dark:text-gray-400" style={{ fontSize: 10 }}>Equity {fmtPct(eqPct)}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: eqColor }}>{fmt(equity)}</span>
        </div>
      </div>
    </div>
  )
}

function DSCRBadge({ dscr }) {
  const [bg, label] = dscr >= 1.25
    ? ['rgba(255,255,255,0.18)', 'Strong ✓']
    : dscr >= 1.0
    ? ['rgba(245,158,11,0.35)', 'Marginal ~']
    : ['rgba(239,68,68,0.35)', 'Below 1.0 !']
  return (
    <span style={{
      display:'inline-flex', alignItems:'center',
      padding:'2px 10px', borderRadius:999,
      background:bg, color:'rgba(255,255,255,0.92)',
      fontSize:11, fontWeight:600,
    }}>
      {label}
    </span>
  )
}

// ── KPI sparkline tile ────────────────────────────────────────────────────────
function KPISparkCard({ label, value, sub, pct, data = [], labels = [], color = '#2563eb', inverse = false, info }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  const favorable = inverse ? (pct || 0) <= 0 : (pct || 0) >= 0
  const dColor    = pct == null ? '#94a3b8' : favorable ? '#0891b2' : '#e11d48'
  const bars      = data.slice(-10)
  const barLabels = labels.slice(-10)
  const max       = Math.max(...bars.map(v => Math.abs(v || 0)), 1)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-100 dark:border-gray-700 p-4 flex items-start gap-3 hover:shadow-md hover:border-slate-200 dark:hover:border-gray-600 transition-all cursor-default">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500">{label}</p>
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        <p className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white mt-1 tracking-tight truncate">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        {pct != null && (
          <p className="text-[11px] font-semibold mt-1" style={{ color: dColor }}>
            {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% YoY
          </p>
        )}
      </div>
      {bars.length > 1 && (
        <div className="flex items-end gap-px h-10 w-16 shrink-0 mt-1" style={{ overflow: 'visible' }}>
          {bars.map((v, i, arr) => {
            const h       = Math.max(2, Math.abs(v || 0) / max * 38)
            const isLast  = i === arr.length - 1
            const isHover = hoverIdx === i
            const bg      = isHover
              ? color
              : isLast
                ? color
                : (v || 0) >= 0 ? '#e2e8f0' : '#fecdd3'
            return (
              <div key={i} className="relative" style={{ flex: 1, height: h, borderRadius: 1.5, background: bg, opacity: isHover ? 1 : (hoverIdx != null && !isLast ? 0.55 : 1), transition: 'opacity 0.1s, background 0.1s' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}>
                {isHover && (
                  <div className="absolute bottom-[calc(100%+5px)] left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                    style={{ minWidth: 80 }}>
                    <div className="bg-slate-900 text-white rounded-lg px-2.5 py-1.5 shadow-xl text-center" style={{ fontSize: 10 }}>
                      {barLabels[i] && (
                        <p className="text-slate-400 dark:text-gray-500 leading-tight truncate" style={{ maxWidth: 110 }}>{barLabels[i]}</p>
                      )}
                      <p className="font-semibold text-white leading-tight">{fmt(v)}</p>
                    </div>
                    <div className="mx-auto w-0 h-0" style={{ borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '4px solid #0f172a', width: 0 }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Trend line chart with delta tooltips ─────────────────────────────────────
function TrendLineChart({ data }) {
  const withDelta = data.map((row, i) => ({ ...row, _prev: data[i - 1] ?? null }))

  const TipContent = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null
    const row = withDelta.find(r => r.year === label || String(r.year) === String(label))
    const entries = [
      { dataKey: 'rental_income',      name: 'Rent',       color: '#fda4af', betterUp: true  },
      { dataKey: 'operating_expenses', name: 'Expenses',   color: '#f43f5e', betterUp: false },
      { dataKey: 'net_income',         name: 'Net Income', color: '#0891b2', betterUp: true  },
    ]
    return (
      <div className="bg-slate-900 rounded-xl p-3.5 text-xs shadow-2xl" style={{ minWidth: 220 }}>
        <p className="font-bold text-white mb-2.5 text-[13px]">{label}</p>
        {entries.map(({ dataKey, name, color, betterUp }) => {
          const entry = payload.find(p => p.dataKey === dataKey)
          if (!entry) return null
          const prev  = row?._prev?.[dataKey] ?? null
          const delta = prev != null ? entry.value - prev : null
          const good  = delta == null ? null : betterUp ? delta > 0 : delta < 0
          const dc    = good == null ? '#94a3b8' : good ? '#34d399' : '#f87171'
          return (
            <div key={dataKey} className="flex items-center justify-between gap-6 mb-2">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-slate-300">{name}</span>
              </span>
              <div className="text-right">
                <span className="font-semibold text-white">{fmt(entry.value)}</span>
                {delta != null && (
                  <span className="ml-1.5 text-[10px]" style={{ color: dc }}>
                    {delta >= 0 ? '+' : ''}{fmt(delta)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {row?._prev && <p className="text-[10px] text-slate-500 dark:text-gray-400 mt-1.5 pt-1.5 border-t border-slate-700">vs {row._prev.year}</p>}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
          tickFormatter={v => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1000).toFixed(0)}k`} />
        <Tooltip content={<TipContent />} cursor={{ stroke: '#e2e8f0', strokeWidth: 1 }} />
        <Line dataKey="rental_income"      stroke="#fda4af" strokeWidth={2.5} dot={false} isAnimationActive={false}
          activeDot={{ r: 4, fill: '#fda4af', strokeWidth: 0 }} />
        <Line dataKey="operating_expenses" stroke="#f43f5e" strokeWidth={2}   dot={false} isAnimationActive={false}
          activeDot={{ r: 4, fill: '#f43f5e', strokeWidth: 0 }} />
        <Line dataKey="net_income"         stroke="#0891b2" strokeWidth={2.5} dot={false} isAnimationActive={false}
          activeDot={{ r: 4, fill: '#0891b2', strokeWidth: 0 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Property performance table (Team Performance style) ───────────────────────
function PropPerfTable({ properties }) {
  const navigate = useNavigate()
  const maxRent  = Math.max(...properties.map(p => p.effective_rent || 0), 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 dark:border-gray-700" style={{ fontSize: 10 }}>
            <th className="pb-2.5 text-left font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">Property</th>
            <th className="pb-2.5 text-left font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 pl-6" style={{ minWidth: 180 }}>Monthly Rent</th>
            <th className="pb-2.5 text-right font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">Cash Flow</th>
            <th className="pb-2.5 text-center font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">DSCR</th>
            <th className="pb-2.5 text-left font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 pl-4" style={{ minWidth: 140 }}>Rate</th>
            <th className="pb-2.5 text-center font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">LTV</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {properties.map(p => {
            const rentPct  = maxRent > 0 ? (p.effective_rent || 0) / maxRent * 100 : 0
            const annualDs = (p.monthly_mortgage || 0) * 12
            const dscr     = annualDs > 0 && p.annual_noi ? p.annual_noi / annualDs : null
            const dscrCol  = dscr == null ? '#94a3b8' : dscr < 1 ? '#e11d48' : dscr < 1.25 ? '#f59e0b' : '#0891b2'
            const rate     = p.loans?.[0]?.interest_rate ?? null
            const rateCol  = rate == null ? '#94a3b8' : rate > 6.5 ? '#e11d48' : rate > 5 ? '#f59e0b' : '#0891b2'
            const ltv      = p.market_value > 0 ? (p.total_loan_balance || 0) / p.market_value * 100 : 0
            const ltvCol   = ltv > 80 ? '#e11d48' : ltv > 60 ? '#f59e0b' : '#0891b2'
            const cfColor  = (p.monthly_cash_flow || 0) >= 0 ? '#0891b2' : '#e11d48'
            return (
              <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                onClick={() => navigate(`/properties/${p.id}`)}>
                <td className="py-3 pr-4">
                  <p className="font-medium text-slate-800 whitespace-nowrap">{p.address.split(',')[0]}</p>
                  <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5">{p.city}, {p.state}</p>
                </td>
                <td className="py-3 pl-6">
                  <div className="flex items-center gap-2.5">
                    <div className="w-24 h-1.5 rounded-full bg-rose-50 overflow-hidden shrink-0">
                      <div className="h-full rounded-full" style={{ width: `${rentPct}%`, background: '#fda4af' }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 dark:text-gray-300 whitespace-nowrap">{fmt(p.effective_rent)}</span>
                  </div>
                </td>
                <td className="py-3 text-right">
                  <span className="text-sm font-bold" style={{ color: cfColor }}>{fmt(p.monthly_cash_flow || 0)}</span>
                </td>
                <td className="py-3 text-center">
                  {dscr != null
                    ? <span className="inline-flex items-center justify-center w-9 h-9 rounded-full border-2 text-[11px] font-bold"
                        style={{ borderColor: dscrCol, color: dscrCol, background: `${dscrCol}12` }}>
                        {dscr.toFixed(1)}
                      </span>
                    : <span className="text-slate-300 text-sm">—</span>}
                </td>
                <td className="py-3 pl-4">
                  {rate != null
                    ? <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: '#dbeafe' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(rate / 9 * 100, 100)}%`, background: rateCol }} />
                        </div>
                        <span className="text-[11px] font-bold whitespace-nowrap" style={{ color: rateCol }}>{fmtPct(rate)}</span>
                      </div>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-3 text-center">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ color: ltvCol, background: `${ltvCol}18` }}>
                    {fmtPct(ltv)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Net income heatmap (property × year) ─────────────────────────────────────
function NetIncomeHeatmap({ rawTrends, properties, selectedIds }) {
  const years = [...new Set((rawTrends || []).map(r => r.year))].sort((a, b) => a - b)
  if (!years.length) return <p className="text-xs text-slate-400 dark:text-gray-500">No trend data. Upload tax returns to populate this heatmap.</p>

  const grid = {}
  for (const row of (rawTrends || [])) {
    for (const pe of (row.properties || [])) {
      if (!selectedIds.has(pe.property_id)) continue
      if (!grid[pe.property_id]) grid[pe.property_id] = {}
      grid[pe.property_id][row.year] = pe.net_income ?? null
    }
  }

  const allVals = Object.values(grid).flatMap(y => Object.values(y)).filter(v => v != null)
  const maxAbs  = Math.max(...allVals.map(v => Math.abs(v)), 1)

  const cellBg = (v) => {
    if (v == null) return '#f8fafc'
    const t = Math.min(Math.abs(v) / maxAbs, 1)
    return v >= 0 ? `rgba(8,145,178,${0.1 + t * 0.6})` : `rgba(244,63,94,${0.1 + t * 0.6})`
  }
  const cellFg = (v) => {
    if (v == null) return '#cbd5e1'
    const t = Math.min(Math.abs(v) / maxAbs, 1)
    return t > 0.5 ? (v >= 0 ? '#0c4a6e' : '#4c0519') : '#334155'
  }

  const shownProps = properties.filter(p => selectedIds.has(p.id) && grid[p.id])
  if (!shownProps.length) {
    return <p className="text-xs text-slate-400 dark:text-gray-500">No per-property tax data yet. Upload Schedule E tax returns to see this heatmap.</p>
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <td className="text-slate-400 dark:text-gray-500 pr-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ minWidth: 150 }}>Property</td>
              {years.map(y => (
                <td key={y} className="text-slate-400 dark:text-gray-500 text-center pb-1.5 text-[10px] font-semibold" style={{ width: 60 }}>{y}</td>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownProps.map(p => (
              <tr key={p.id}>
                <td className="pr-4 py-0.5 text-slate-700 dark:text-gray-300 font-medium whitespace-nowrap">{p.address.split(',')[0].slice(0, 24)}</td>
                {years.map(y => {
                  const v     = grid[p.id]?.[y] ?? null
                  const short = v != null ? `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1000).toFixed(0)}k` : '—'
                  return (
                    <td key={y} className="py-0.5">
                      <div className="rounded flex items-center justify-center text-[10px] font-semibold cursor-default"
                        style={{ width: 56, height: 30, background: cellBg(v), color: cellFg(v) }}
                        title={v != null ? `${p.address.split(',')[0]} · ${y}: ${fmt(v)} net income` : 'No data'}>
                        {short}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-6 text-[10px] text-slate-400 dark:text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded" style={{ background: 'rgba(8,145,178,0.5)', display: 'inline-block' }} />
          Positive net income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded" style={{ background: 'rgba(244,63,94,0.5)', display: 'inline-block' }} />
          Negative net income
        </span>
        <span className="text-slate-300">· Hover cells for detail</span>
      </div>
    </div>
  )
}
