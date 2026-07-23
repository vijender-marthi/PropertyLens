import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  ChevronDown,
  Download,
  Landmark,
  ListFilter,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  WalletCards,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageContainer from '../components/PageContainer'
import { propAPI } from '../services/api'
import { chartColors, chartTooltipStyle, chartTypography } from '../utils/chartTokens'
import { formatChartCurrency, formatCurrency, formatCurrencyCompact, formatDate, formatFixed, formatInterestRate, formatPercent } from '../utils/formatters'

const LOAN_TABS = ['Loan Overview', 'Amortization Schedules', 'Refinancing History', 'Payment History']
const MIX_COLORS = [chartColors.positive, chartColors.primary, chartColors.warningStrong, chartColors.purple, chartColors.neutral]

function compact(value) {
  return formatCurrencyCompact(value, { threshold: 100_000, kDigits: 1, mDigits: 1 })
}

function propertyName(property) {
  return property?.name || property?.address || `Property ${property?.id || ''}`.trim()
}

function metricValue(kpis, key) {
  return kpis?.[key]?.value ?? null
}

function KpiCard({ icon: Icon, label, value, note, tone = 'emerald' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${tones[tone] || tones.emerald}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-neutral-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{value}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">{note}</p>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, subtitle, children, action }) {
  return (
    <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function LoansTable({ rows }) {
  return (
    <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-gray-200 dark:border-neutral-800">
      <table className="min-w-[68rem] divide-y divide-gray-200 text-sm dark:divide-neutral-800">
        <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-3 text-left">Property / Loan</th>
            <th className="px-4 py-3 text-left">Lender</th>
            <th className="px-4 py-3 text-left">Loan Type</th>
            <th className="px-4 py-3 text-right">Balance</th>
            <th className="px-4 py-3 text-right">Interest Rate</th>
            <th className="px-4 py-3 text-right">Monthly P&I</th>
            <th className="px-4 py-3 text-left">Paid %</th>
            <th className="px-4 py-3 text-left">Next Payment</th>
            <th className="px-4 py-3 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                <Link to={`/properties/${row.propertyId}/loans`} className="font-semibold text-gray-950 hover:text-blue-700 dark:text-white dark:hover:text-blue-300">{row.propertyName}</Link>
                <p className="text-xs text-gray-400">{row.address || `#${row.account || row.loanId || '—'}`}</p>
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-800 dark:text-neutral-200">{row.lender}</p>
                <p className="text-xs text-gray-400">{row.account ? `#${row.account}` : '—'}</p>
              </td>
              <td className="px-4 py-3 text-gray-600 dark:text-neutral-300">{row.loanType}</td>
              <td className="px-4 py-3 text-right">
                <p className="font-semibold text-gray-950 dark:text-white">{formatCurrency(row.balance)}</p>
                <p className="text-xs text-gray-400">of {formatCurrency(row.original)}</p>
              </td>
              <td className="px-4 py-3 text-right">{formatInterestRate(row.rate)}</td>
              <td className="px-4 py-3 text-right">{formatCurrency(row.monthlyPI)}</td>
              <td className="px-4 py-3">
                <div className="flex min-w-28 items-center gap-2">
                  <span className="w-10 text-xs text-gray-500">{formatPercent(row.paidPercent, { maximumFractionDigits: 0 })}</span>
                  <span className="h-2 flex-1 rounded-full bg-gray-100 dark:bg-neutral-800">
                    <span className="block h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(Math.max(row.paidPercent, 0), 100)}%` }} />
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-600 dark:text-neutral-300">{row.nextPayment}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${row.status === 'Active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function currencyOrDash(value) {
  return value == null ? '—' : formatCurrency(value)
}

function AmortizationTable({ rows }) {
  return (
    <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-gray-200 dark:border-neutral-800">
      <table className="min-w-[72rem] divide-y divide-gray-200 text-sm dark:divide-neutral-800">
        <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-3 text-left">Property / Loan</th>
            <th className="px-4 py-3 text-left">Year</th>
            <th className="px-4 py-3 text-right">Opening Balance</th>
            <th className="px-4 py-3 text-right">Scheduled Principal</th>
            <th className="px-4 py-3 text-right">Extra Principal</th>
            <th className="px-4 py-3 text-right">Interest</th>
            <th className="px-4 py-3 text-right">Ending Balance</th>
            <th className="px-4 py-3 text-left">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
          {rows.map((row) => (
            <tr key={`${row.propertyId}-${row.rowKey || `${row.loanId}-${row.yearLabel}`}`}>
              <td className="px-4 py-3">
                <Link to={`/properties/${row.propertyId}/loans`} className="font-semibold text-gray-950 hover:text-blue-700 dark:text-white dark:hover:text-blue-300">{row.propertyName}</Link>
                <p className="text-xs text-gray-400">{row.lenderName || row.loanLabel || 'Loan'}</p>
              </td>
              <td className="px-4 py-3 font-medium text-gray-800 dark:text-neutral-200">
                {row.yearLabel || row.year || '—'}
                {row.isFullYearProjection ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Projected</span> : null}
              </td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-neutral-300">{currencyOrDash(row.startingBalance)}</td>
              <td className="px-4 py-3 text-right font-semibold text-gray-950 dark:text-white">{currencyOrDash(row.scheduledPrincipal)}</td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-neutral-300">{currencyOrDash(row.topUp)}</td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-neutral-300">{currencyOrDash(row.interestPaid)}</td>
              <td className="px-4 py-3 text-right font-semibold text-gray-950 dark:text-white">{currencyOrDash(row.endingBalance)}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-neutral-300">{row.sourceLabel || row.sourceDisplay || row.source || 'Calculated schedule'}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No schedule rows are available for the selected loans.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function PaymentHistoryTable({ rows }) {
  return (
    <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-gray-200 dark:border-neutral-800">
      <table className="min-w-[66rem] divide-y divide-gray-200 text-sm dark:divide-neutral-800">
        <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-3 text-left">Property / Loan</th>
            <th className="px-4 py-3 text-left">Statement Date</th>
            <th className="px-4 py-3 text-right">Recorded Payment</th>
            <th className="px-4 py-3 text-right">Principal YTD</th>
            <th className="px-4 py-3 text-right">Interest YTD</th>
            <th className="px-4 py-3 text-right">Reported Balance</th>
            <th className="px-4 py-3 text-left">Source Document</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white dark:divide-neutral-800 dark:bg-neutral-900">
          {rows.map((row) => (
            <tr key={`${row.propertyId}-${row.rowKey}`}>
              <td className="px-4 py-3">
                <Link to={`/properties/${row.propertyId}/loans`} className="font-semibold text-gray-950 hover:text-blue-700 dark:text-white dark:hover:text-blue-300">{row.propertyName}</Link>
                <p className="text-xs text-gray-400">{row.lenderName || 'Loan'}{row.accountNumber ? ` · #${row.accountNumber}` : ''}</p>
              </td>
              <td className="px-4 py-3 font-medium text-gray-800 dark:text-neutral-200">{formatDate(row.statementDate)}</td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-neutral-300">{currencyOrDash(row.payment)}</td>
              <td className="px-4 py-3 text-right font-semibold text-gray-950 dark:text-white">{currencyOrDash(row.principalYtd)}</td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-neutral-300">{currencyOrDash(row.interestYtd)}</td>
              <td className="px-4 py-3 text-right font-semibold text-gray-950 dark:text-white">{currencyOrDash(row.balance)}</td>
              <td className="max-w-72 px-4 py-3 text-gray-600 dark:text-neutral-300">
                <span className="block truncate" title={row.sourceLabel || row.sourceType}>{row.sourceLabel || row.sourceType || 'Mortgage statement'}</span>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No accepted mortgage statements are available for the selected loans.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function BalanceChart({ data }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="loanBalanceFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={chartColors.positive} stopOpacity={0.24} />
              <stop offset="95%" stopColor={chartColors.positive} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.gridLight} />
          <XAxis dataKey="period" tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={formatChartCurrency} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} width={56} />
          <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} />
          <Area type="monotone" dataKey="value" name="Loan Balance" fill="url(#loanBalanceFill)" stroke={chartColors.positive} strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function DebtMix({ rows }) {
  return (
    <div className="space-y-4">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chartColors.gridLight} />
            <XAxis type="number" tickFormatter={formatChartCurrency} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={145} tick={chartTypography.smallMutedTick} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={chartTooltipStyle(false)} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              {rows.map((row, index) => <Cell key={row.label} fill={MIX_COLORS[index % MIX_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-gray-600 dark:text-neutral-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: MIX_COLORS[index % MIX_COLORS.length] }} />
              {row.label}
            </span>
            <span className="font-medium text-gray-950 dark:text-white">{formatCurrency(row.value)} <span className="text-xs text-gray-400">({formatPercent(row.percentage, { maximumFractionDigits: 1 })})</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightPanel({ portfolio, rows }) {
  const highRate = rows.filter((row) => row.rate >= 5)
  return (
    <Panel title="Loan Insights" action={<span className="text-xs text-gray-400">Current</span>}>
      <div className="space-y-4 text-sm">
        <div className="flex gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><Banknote className="h-4 w-4" /></span>
          <p className="text-gray-600 dark:text-neutral-300">You paid {formatCurrency(portfolio.principalYtd)} toward principal this year.</p>
        </div>
        <div className="flex gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><RefreshCw className="h-4 w-4" /></span>
          <p className="text-gray-600 dark:text-neutral-300">{highRate.length} active {highRate.length === 1 ? 'loan has' : 'loans have'} rates above 5%. Review refinancing before making decisions.</p>
        </div>
        <div className="flex gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"><ShieldCheck className="h-4 w-4" /></span>
          <p className="text-gray-600 dark:text-neutral-300">Total interest tracked so far is {formatCurrency(portfolio.interestToDate)}.</p>
        </div>
      </div>
    </Panel>
  )
}

export default function LoansPage() {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState(null)
  const [activeTab, setActiveTab] = useState('Loan Overview')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('Active')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    propAPI.portfolioAnalysis({
      selected_property_ids: propertyFilter === 'all' ? '' : propertyFilter,
      include_primary_residence: true,
      active_loan_only: statusFilter === 'Active',
      loan_status: statusFilter,
    }, { signal: controller.signal })
      .then((response) => setAnalysis(response.data || null))
      .catch((error) => {
        if (error?.code !== 'ERR_CANCELED') toast.error('Failed to load loans')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [propertyFilter, statusFilter])

  const properties = analysis?.filterContext?.availableProperties || []
  const rows = analysis?.loans?.rows || []
  const allLoanRows = analysis?.loans?.allRows || []
  const kpis = analysis?.loans?.kpis || {}
  const activeRows = analysis?.loans?.allRows?.filter((row) => row.status === 'Active') || []
  const portfolio = {
    activeRows,
    totalBalance: metricValue(kpis, 'totalBalance'),
    totalMonthlyPayment: metricValue(kpis, 'monthlyPI'),
    weightedRate: metricValue(kpis, 'weightedRate'),
    principalYtd: metricValue(kpis, 'principalYtd'),
    interestYtd: metricValue(kpis, 'interestYtd'),
    interestToDate: metricValue(kpis, 'interestToDate'),
    averageDti: metricValue(kpis, 'averageDti'),
  }
  const trend = analysis?.loans?.balanceSeries || []
  const mix = analysis?.loans?.debtMix || []
  const amortizationRows = analysis?.loans?.amortizationRows || []
  const paymentHistoryRows = analysis?.loans?.paymentHistoryRows || []
  const tabRows = activeTab === 'Refinancing History'
    ? allLoanRows.filter((row) => row.status === 'Closed')
    : rows

  const exportCSV = () => {
    const headers = ['Property', 'Lender', 'Account', 'Loan type', 'Balance', 'Original amount', 'Rate', 'Monthly P&I', 'Paid percent', 'Status']
    const lines = [
      headers.join(','),
      ...rows.map((row) => [
        row.propertyName,
        row.lender,
        row.account || '',
        row.loanType,
        row.balance,
        row.original,
        row.rate,
        row.monthlyPI,
        row.paidPercent,
        row.status,
      ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'PropertyLens_Loans.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !analysis) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-[112rem]">
      <div className="min-w-0 space-y-5">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-5 dark:border-neutral-800 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">Loans</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">Track all property loans and debt performance.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportCSV} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" />
              Export
            </button>
            <Link to="/properties" className="btn-primary inline-flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" />
              Add Loan
            </Link>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard icon={WalletCards} label="Total Loan Balance" value={compact(portfolio.totalBalance)} note="owed today" tone="emerald" />
          <KpiCard icon={CalendarDays} label="Total Monthly P&I" value={compact(portfolio.totalMonthlyPayment)} note="escrow excluded" tone="purple" />
          <KpiCard icon={Landmark} label="Weighted Avg. Interest Rate" value={formatInterestRate(portfolio.weightedRate)} note="by balance" tone="amber" />
          <KpiCard icon={Banknote} label="Principal Paid (YTD)" value={compact(portfolio.principalYtd)} note="reported/projected" tone="emerald" />
          <KpiCard icon={TrendingDown} label="Interest Paid (YTD)" value={compact(portfolio.interestYtd)} note="reported/projected" tone="purple" />
          <KpiCard icon={ShieldCheck} label="Average DTI" value={portfolio.averageDti ? formatFixed(portfolio.averageDti, 2) : '—'} note="all loans" tone="blue" />
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-neutral-800" aria-label="Loan views">
          {LOAN_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-w-max border-b-2 px-4 py-3 text-sm font-medium ${
                activeTab === tab
                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="min-w-0 space-y-5">
            <Panel
              title={activeTab}
              subtitle="Logical loans are consolidated across servicer transfers."
              action={(
                <div className="flex flex-wrap gap-2">
                  <label className="btn-secondary inline-flex items-center gap-2 text-sm">
                    <Landmark className="h-4 w-4" />
                    <select className="bg-transparent outline-none" value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)}>
                      <option value="all">All Properties</option>
                      {properties.map((property) => <option key={property.id} value={property.id}>{propertyName(property)}</option>)}
                    </select>
                    <ChevronDown className="h-4 w-4" />
                  </label>
                  <label className="btn-secondary inline-flex items-center gap-2 text-sm">
                    <ListFilter className="h-4 w-4" />
                    <select className="bg-transparent outline-none" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                      <option value="all">All Statuses</option>
                      <option value="Active">Active</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </label>
                </div>
              )}
            >
              {activeTab === 'Loan Overview' ? <LoansTable rows={tabRows} /> : null}
              {activeTab === 'Amortization Schedules' ? <AmortizationTable rows={amortizationRows} /> : null}
              {activeTab === 'Refinancing History' ? <LoansTable rows={tabRows} /> : null}
              {activeTab === 'Payment History' ? <PaymentHistoryTable rows={paymentHistoryRows} /> : null}
              <p className="mt-3 text-xs text-gray-500 dark:text-neutral-400">
                {activeTab === 'Loan Overview' || activeTab === 'Refinancing History'
                  ? `Showing ${tabRows.length} loans for the selected backend scope.`
                  : activeTab === 'Payment History'
                    ? `Showing ${paymentHistoryRows.length} accepted mortgage-statement records.`
                    : `Showing ${amortizationRows.length} annual schedule rows from the backend loan engine.`}
              </p>
            </Panel>

            {activeTab === 'Loan Overview' ? <div className="grid min-w-0 gap-5 2xl:grid-cols-2">
              <Panel title="Loan Balance Over Time" subtitle="Portfolio-level balance trend">
                <BalanceChart data={trend} />
              </Panel>
              <Panel title="Debt Mix by Loan Type" subtitle="Bar view, no pie charts">
                <DebtMix rows={mix} />
              </Panel>
            </div> : null}
          </main>

          <aside className="min-w-0 space-y-5">
            <InsightPanel portfolio={portfolio} rows={activeRows} />
            <Panel title="Refinance Opportunities">
              <div className="space-y-3 text-sm">
                {activeRows.filter((row) => row.rate >= 5).slice(0, 3).map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3">
                    <span className="text-gray-600 dark:text-neutral-300">{row.propertyName}</span>
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Review</span>
                  </div>
                ))}
                {!activeRows.some((row) => row.rate >= 5) ? <p className="text-sm text-gray-500">No high-rate loans found.</p> : null}
                <Link to="/analytics" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-700 dark:text-blue-300">View Details <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </Panel>
            <Panel title="Quick Actions">
              <div className="space-y-2">
                {[
                  ['Compare Refinance Offers', RefreshCw, '/analytics'],
                  ['Extra Principal Payment', Banknote, '/properties'],
                  ['Run What-If Analysis', TrendingDown, '/analytics'],
                  ['Add New Loan', Plus, '/properties'],
                ].map(([label, Icon, to]) => (
                  <Link key={label} to={to} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:text-neutral-300 dark:hover:bg-neutral-800">
                    <Icon className="h-4 w-4 text-blue-600" /> {label}
                  </Link>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </PageContainer>
  )
}
