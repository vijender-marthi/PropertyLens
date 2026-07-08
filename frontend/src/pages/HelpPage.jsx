import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, DollarSign, Landmark, Shield, Calculator,
  ChevronDown, ChevronRight, BookOpen, Search, Map,
  Upload, Building2, FileText, Settings, BarChart3,
  Home, CheckCircle, ArrowRight, X, Download
} from 'lucide-react'
import * as XLSX from 'xlsx'

// ── reusable display components ───────────────────────────────────────────────

function Formula({ children }) {
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 font-mono text-sm text-blue-800 my-2 leading-relaxed">
      {children}
    </div>
  )
}

function ExampleBox({ children }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-700 dark:text-gray-300 my-2 space-y-1">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">Example</p>
      {children}
    </div>
  )
}

function Tag({ color = 'blue', children }) {
  const cls = {
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    red:    'bg-red-100 text-red-700',
    amber:  'bg-amber-100 text-amber-700',
    purple: 'bg-purple-100 text-purple-700',
    teal:   'bg-teal-100 text-teal-700',
  }
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${cls[color] || cls.blue}`}>{children}</span>
}

function MetricCard({ title, tags = [], description, formula, example, extra, highlight }) {
  const [open, setOpen] = useState(true)
  const titleMatch = highlight && title.toLowerCase().includes(highlight.toLowerCase())
  return (
    <div className={`border rounded-xl overflow-hidden mb-3 ${titleMatch ? 'border-blue-300 ring-1 ring-blue-200' : 'border-gray-100 dark:border-gray-700'}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
          <div className="flex gap-1.5 flex-wrap">{tags.map((t, i) => <Tag key={i} color={t.color}>{t.label}</Tag>)}</div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0 ml-2" /> : <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0 ml-2" />}
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 bg-white dark:bg-gray-800 border-t border-gray-50 dark:border-gray-800 space-y-1">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{description}</p>
          {formula && <Formula>{formula}</Formula>}
          {example && <ExampleBox>{example}</ExampleBox>}
          {extra}
        </div>
      )}
    </div>
  )
}

function SectionBadge({ sectionLabel }) {
  return (
    <p className="text-xs text-blue-500 font-medium mb-1 ml-1">{sectionLabel}</p>
  )
}

function SectionHeading({ icon: Icon, label, color = 'blue' }) {
  const bg = { blue: 'bg-blue-600', green: 'bg-green-600', purple: 'bg-purple-600', red: 'bg-red-600', amber: 'bg-amber-500', teal: 'bg-teal-600' }
  return (
    <div className="flex items-center gap-3 mb-5 mt-2">
      <div className={`w-8 h-8 rounded-xl ${bg[color] || bg.blue} flex items-center justify-center shrink-0`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{label}</h2>
    </div>
  )
}

// ── flat searchable data ───────────────────────────────────────────────────────
// Numbers use a consistent example portfolio: 6 properties, ~$5.6M value, ~$3.3M debt

const METRICS = [
  {
    id: 'architecture',
    section: 'architecture',
    sectionLabel: 'Architecture & Source of Truth',
    title: 'Backend Calculation Engine',
    tags: [{ label: 'Non-negotiable', color: 'red' }],
    description: 'All derived numbers are computed by backend engines and returned as DTOs. The UI renders value, display, source, tone, formula, inputs, computation, result, missingInputs, and warning.',
    formula: 'Controller -> Manager/Service -> Engine -> DTO\nUI renders DTO only; no client-side math',
    search: 'backend engine dto source truth ui computes nothing',
    example: 'If Summary, Taxes, Loans, and Raw Data show cash flow, they all read the same backend value.',
  },
  {
    id: 'metric-dto',
    section: 'architecture',
    sectionLabel: 'Architecture & Source of Truth',
    title: 'Metric Tooltip DTO',
    tags: [{ label: 'Tooltip', color: 'blue' }],
    description: 'Every metric tooltip must show the exact formula and exact plugged-in inputs the engine used. Stubs like "Provided by backend engine" are invalid.',
    formula: '{ value, display, period, source, tone, formula, inputs, computation, result, missingInputs, warning, hint }',
    search: 'tooltip formula inputs computation result source missing inputs',
    example: 'Total Return: $2,222 + $16,163 + $45,000 = $63,385.',
  },
  {
    id: 'resolve-monthly-rent',
    section: 'rent-cashflow',
    sectionLabel: 'Rent, NOI & Cash Flow',
    title: 'Rent Resolution',
    tags: [{ label: 'Single Source', color: 'green' }],
    description: 'Monthly rent is resolved once in the backend. Current-year lease periods win; property details rent is fallback. Partial-year collected rent is not divided by 12 for current rent.',
    formula: 'monthlyRent = latest current-year rental-period amount\nfallback = property.monthly_rent\nannualRent = monthlyRent × 12',
    search: 'rent monthly rental tab lease ytd annualize current year',
    example: 'Mission: Lease C = $3,200/mo, so annual run-rate rent = $38,400.',
  },
  {
    id: 'noi',
    section: 'rent-cashflow',
    sectionLabel: 'Rent, NOI & Cash Flow',
    title: 'Net Operating Income (NOI)',
    tags: [{ label: 'Key Metric', color: 'blue' }],
    description: 'NOI measures property operations before financing and before tax-only non-cash deductions. Mortgage principal, mortgage interest, and depreciation are not operating expenses.',
    formula: 'EGI = grossRent - vacancy\nNOI = EGI - operatingExpenses',
    search: 'noi effective gross income operating expenses no mortgage no depreciation',
    example: '$38,400 rent - $3,708 operating expenses = $34,692 NOI.',
  },
  {
    id: 'annual-cash-flow',
    section: 'rent-cashflow',
    sectionLabel: 'Rent, NOI & Cash Flow',
    title: 'Annual Cash Flow',
    tags: [{ label: 'Cash', color: 'green' }],
    description: 'Cash flow is operating income after all loan principal and interest payments. Depreciation is never included in cash flow.',
    formula: 'annualDebtService = Σ all loans annual P&I\nannualCashFlow = NOI - annualDebtService\nmonthlyCashFlow = annualCashFlow / 12',
    search: 'cash flow debt service annual monthly depreciation excluded',
    example: '$34,692 NOI - $32,470 debt service = $2,222/yr = $185/mo.',
  },
  {
    id: 'operating-expenses',
    section: 'rent-cashflow',
    sectionLabel: 'Rent, NOI & Cash Flow',
    title: 'Operating Expenses',
    tags: [{ label: 'Expense', color: 'amber' }],
    description: 'Operating expenses include recurring property costs only. Property tax and insurance are annual inputs; management, maintenance, HOA, utilities, vacancy allowance, capex reserve, and other expenses are monthly where entered that way.',
    formula: 'operatingExpenses = propertyTax + insurance + HOA + maintenance + utilities + management + capexReserve + vacancyAllowance + other',
    search: 'operating expenses property tax insurance hoa maintenance utilities capex vacancy',
    example: 'Mortgage principal and depreciation are excluded.',
  },
  {
    id: 'debt-service',
    section: 'loans',
    sectionLabel: 'Loans & Amortization',
    title: 'Debt Service',
    tags: [{ label: 'All Loans', color: 'purple' }],
    description: 'Debt service is the sum of every loan’s principal and interest. Missing a second loan causes cash flow, DSCR, and tooltips to disagree.',
    formula: 'monthlyDebtService = Σ loan.monthlyP&I\nannualDebtService = monthlyDebtService × 12',
    search: 'debt service monthly pi all loans mortgage payment',
    example: 'Loan A P&I + Loan B P&I are both included.',
  },
  {
    id: 'amortization',
    section: 'loans',
    sectionLabel: 'Loans & Amortization',
    title: 'Amortization Schedule',
    tags: [{ label: 'Invariant', color: 'blue' }],
    description: 'Schedules start at each loan start date, run month by month, and bucket interest, principal, and ending balance into calendar years.',
    formula: 'originalAmount - Σ principalPaid = currentBalance\nΣ annualInterest(y) ties to Taxes.mortgageInterest(y)',
    search: 'amortization principal interest balance invariant start date',
    example: 'Loan card latest split shows the current/latest month, not payment #1.',
  },
  {
    id: 'payoff-simulator',
    section: 'loans',
    sectionLabel: 'Loans & Amortization',
    title: 'Payoff Simulator',
    tags: [{ label: 'Scenario', color: 'teal' }],
    description: 'Simulator stats and charts come from one accelerated amortization run. Base monthly P&I is required; extra payments, lump sums, payoff date, interest saved, and charts all read that run.',
    formula: 'scenarioPayment = baseMonthlyPI + extraMonthly\ntotalInterest = Σ acceleratedSchedule.interest\ninterestSaved = baselineInterest - totalInterest',
    search: 'payoff simulator extra payment lump sum interest saved',
    example: 'It is invalid to show $0 total interest with non-zero interest saved.',
  },
  {
    id: 'depreciation',
    section: 'depreciation',
    sectionLabel: 'Depreciation',
    title: 'Rental Depreciation',
    tags: [{ label: 'Schedule E', color: 'purple' }],
    description: 'Residential rental depreciation is straight-line over 27.5 years with mid-month convention. It accrues only in rental-use months and is N/A for primary-use years.',
    formula: 'depreciableBasis = purchasePrice - landValue + improvements\nannualDepreciation = depreciableBasis / 27.5',
    search: 'depreciation basis land 27.5 mid month rental months',
    example: 'Land is excluded. If land value is 0, the app flags overstated basis.',
  },
  {
    id: 'recapture',
    section: 'depreciation',
    sectionLabel: 'Depreciation',
    title: 'Recapture If Sold Today',
    tags: [{ label: 'Illustrative', color: 'amber' }],
    description: 'Accumulated depreciation is retained even if the property later becomes primary. The page shows illustrative unrecaptured Section 1250 exposure.',
    formula: 'recaptureIfSoldToday = accumulatedDepreciation × 25%',
    search: 'recapture accumulated depreciation sale section 1250',
    example: '$90,924 accumulated × 25% = $22,731 illustrative recapture.',
  },
  {
    id: 'primary-taxes',
    section: 'taxes',
    sectionLabel: 'Taxes',
    title: 'Primary Residence Deductions',
    tags: [{ label: 'Primary', color: 'blue' }],
    description: 'Primary homes use itemized-deduction rules. They never use Schedule E and never depreciate.',
    formula: 'deductibleInterest = interestPaid × min(1, debtLimit / avgBalance)\nSALT property tax deduction capped at $10,000',
    search: 'primary residence mortgage interest salt cap standard deduction',
    example: 'Show itemizable total versus standard deduction verdict.',
  },
  {
    id: 'schedule-e',
    section: 'taxes',
    sectionLabel: 'Taxes',
    title: 'Rental Schedule E',
    tags: [{ label: 'Rental', color: 'green' }],
    description: 'Rental tax uses Schedule E. Mortgage interest and property tax are fully deductible rental expenses. Principal is not tax-relevant.',
    formula: 'netScheduleE = rentalIncome - operatingExpenses - mortgageInterest - depreciation',
    search: 'schedule e rental taxable income depreciation interest property tax principal excluded',
    example: '$38,400 - $3,257 - $30,865 - $22,727 = -$18,449 taxable Schedule E result.',
  },
  {
    id: 'passive-loss',
    section: 'taxes',
    sectionLabel: 'Taxes',
    title: 'Passive Loss Allowance',
    tags: [{ label: 'Form 8582', color: 'amber' }],
    description: 'Rental losses may be suspended at high MAGI. Only suspended losses carry forward; losses already allowed do not.',
    formula: 'allowance = clamp(25000 - max(0, MAGI - 100000) × 0.5, 0, 25000)',
    search: 'passive loss suspended form 8582 magi allowance',
    example: 'If netScheduleE < 0 and MAGI > $150k, flag possible suspended loss.',
  },
  {
    id: 'cap-rate',
    section: 'returns',
    sectionLabel: 'Return Metrics',
    title: 'Cap Rate',
    tags: [{ label: 'Return', color: 'teal' }],
    description: 'Cap rate is unlevered return. It must be positive whenever NOI is positive.',
    formula: 'capRate = NOI / marketValue',
    search: 'cap rate noi market value sign sanity',
    example: '$35,143 ÷ $700,000 = 5.02%.',
  },
  {
    id: 'dscr',
    section: 'returns',
    sectionLabel: 'Return Metrics',
    title: 'DSCR',
    tags: [{ label: 'Debt Coverage', color: 'purple' }],
    description: 'Debt Service Coverage Ratio shows how many times NOI covers annual principal and interest. It uses the same NOI as cap rate and cash flow.',
    formula: 'DSCR = NOI / annualDebtService',
    search: 'dscr noi annual debt service',
    example: '$35,143 ÷ $42,000 = 0.84x.',
  },
  {
    id: 'cash-on-cash',
    section: 'returns',
    sectionLabel: 'Return Metrics',
    title: 'Cash-on-Cash Return',
    tags: [{ label: 'Needs Inputs', color: 'amber' }],
    description: 'Cash-on-cash requires cash invested. If down payment or closing costs are missing, show — and prompt for the missing input.',
    formula: 'cashOnCash = annualCashFlow / cashInvested\ncashInvested = downPayment + closingCosts',
    search: 'cash on cash down payment closing costs missing input',
    example: 'Missing down payment -> display —, not 0%.',
  },
  {
    id: 'equity-ltv',
    section: 'returns',
    sectionLabel: 'Return Metrics',
    title: 'Equity and LTV',
    tags: [{ label: 'Balance Tie-out', color: 'blue' }],
    description: 'Equity and LTV use the same market value and loan balances shown on the page. No parallel balance calculations.',
    formula: 'equity = marketValue - Σ loanBalance\nLTV = Σ loanBalance / marketValue',
    search: 'equity ltv market value balance drift',
    example: '$700,000 - $438,502 = $261,498 equity.',
  },
  {
    id: 'total-return',
    section: 'returns',
    sectionLabel: 'Return Metrics',
    title: 'Total Return',
    tags: [{ label: 'Additive Assertion', color: 'red' }],
    description: 'Total Return is additive. The metric value, tooltip computation, and result must all come from the same inputs.',
    formula: 'totalReturn = cashFlow + principalPaid + appreciation',
    search: 'total return cash flow principal appreciation additive assertion',
    example: '$2,222 + $16,163 + $45,000 = $63,385.',
  },
  {
    id: 'usage-periods',
    section: 'data',
    sectionLabel: 'Data, Provenance & Assertions',
    title: 'Usage Period Timeline',
    tags: [{ label: 'Type-aware', color: 'green' }],
    description: 'Property behavior is driven by usage periods, not a single static type flag. Primary years hide rental economics; rental years show Schedule E and depreciation.',
    formula: 'yearUse = split usagePeriods by calendar year/day\nprimary -> deductions model\nrental -> Schedule E model',
    search: 'usage periods primary rental conversion mixed year',
    example: 'A rental-to-primary conversion stops future depreciation but keeps accumulated depreciation for recapture.',
  },
  {
    id: 'source-tier',
    section: 'data',
    sectionLabel: 'Data, Provenance & Assertions',
    title: 'Source Tier',
    tags: [{ label: 'Audit', color: 'blue' }],
    description: 'Every figure carries provenance. Reported document facts override calculated/projected values for the same period.',
    formula: 'REPORTED > CALCULATED > APPROX > PROJECTED\nRaw Data = MANUAL + CALCULATED + REPORTED',
    search: 'source tier reported calculated approx projected raw data',
    example: 'Uploading a statement flips projected months to reported and all tabs update from one rebuild.',
  },
  {
    id: 'assertions',
    section: 'data',
    sectionLabel: 'Data, Provenance & Assertions',
    title: 'Universal Assertions',
    tags: [{ label: 'Safety Net', color: 'red' }],
    description: 'DTOs run consistency checks before returning. A failing assertion means there are two source paths and the source must be fixed.',
    formula: 'monthlyCashFlow × 12 = annualCashFlow\nincome - opex - debtService = cashFlow\nvalue = sum(inputs) for additive metrics\ncapRate > 0 and DSCR > 0 when NOI > 0',
    search: 'assertions golden file invariant cashflow tooltip mismatch',
    example: 'The +$63,385 shown as -$815 bug is caught by value == sum(inputs).',
  },
]

const GUIDE_STEPS = [
  {
    num: 1,
    icon: Upload,
    title: 'Upload a Mortgage Statement',
    color: 'blue',
    body: 'Go to Uploads in the left nav. Drop a PDF mortgage statement — the tool reads the property address, loan balance, interest rate, monthly payment, and escrow automatically. A new property and loan are created for you.',
    tips: [
      'Supported: PDF statements from Chase, Wells Fargo, Rocket, Nationstar, most major servicers.',
      'If auto-detect misses a field, open the property and edit it manually.',
      'You can also add a property manually via Properties → Add Property.',
    ],
    link: '/uploads',
    linkLabel: 'Go to Uploads',
  },
  {
    num: 2,
    icon: Building2,
    title: 'Set Rent & Market Value',
    color: 'green',
    body: 'Open the property → Details tab. Set Monthly Rent to what you charge (or expect to charge), Occupancy Rate (default 100%), and Market Value (current Zillow/Redfin estimate). These three fields drive most dashboard metrics.',
    tips: [
      'Occupancy Rate 95% = assume 5% vacancy. Use 100% if the unit is always occupied.',
      'Market Value is only used for LTV, equity, and appreciation — not for cash flow.',
      'For a primary residence, set Usage Type to "Primary" to exclude it from rent calculations.',
    ],
    link: null,
  },
  {
    num: 3,
    icon: FileText,
    title: 'Upload Tax Returns (Schedule E)',
    color: 'purple',
    body: 'Upload your 1040 PDF in Uploads and select "Tax Return (Schedule E)" as the document type. Tax returns are Common documents — they\'re not tied to one property. The tool reads Schedule E and maps rental income and deductions to each property by address.',
    tips: [
      'Tax returns populate the Yearly Summary table in the property Summary tab.',
      'Rent from Schedule E takes priority over your lease/rent field for historical years.',
      'Depreciation from Schedule E line 18 is used in the yearly Taxable Income column.',
    ],
    link: '/uploads',
    linkLabel: 'Go to Uploads',
  },
  {
    num: 4,
    icon: Settings,
    title: 'Fill in Operating Expenses',
    color: 'amber',
    body: 'Open each property → Details tab → Operating Expenses section. Enter HOA, maintenance, property management fee, utilities, vacancy allowance, and CapEx reserve. These flow directly into NOI and cash flow calculations.',
    tips: [
      'Property Taxes and Insurance are entered as annual amounts.',
      'All other expense fields are monthly amounts.',
      'If your lender escrows taxes and insurance, they\'re already in your mortgage payment — the tool avoids double-counting.',
    ],
    link: null,
  },
  {
    num: 5,
    icon: BarChart3,
    title: 'Explore the Dashboard',
    color: 'blue',
    body: 'The Dashboard (home icon) has 4 tabs — Portfolio Value & Equity, Cash Flow Metrics, Financing & Debt Metrics, and Risk Metrics. Each shows portfolio-wide totals and a per-property breakdown table.',
    tips: [
      'Portfolio tab: equity, LTV, appreciation across all properties.',
      'Cash Flow tab: gross rent, NOI, mortgage, cash flow margin.',
      'Financing tab: original loan, weighted rate, DSCR, principal paid.',
      'Risk tab: concentration, ARM exposure, vacancy rate, high-rate debt.',
    ],
    link: '/dashboard',
    linkLabel: 'Go to Dashboard',
  },
  {
    num: 6,
    icon: TrendingUp,
    title: 'Review Property Performance',
    color: 'teal',
    body: 'Open any property → Summary tab for the yearly P&L table showing rent, expenses, interest, depreciation, cash flow, and taxable income year by year. Use Performance tab for signals, cap rate, gross yield, and monthly metrics.',
    tips: [
      'Year Rent comes from: Tax Return (Schedule E) → Lease/Rent field → $0.',
      'Export the yearly table to PDF or XLS using the buttons in the Summary tab.',
      'The Performance tab flags issues like low cap rate, high vacancy, or negative cash flow.',
    ],
    link: null,
  },
  {
    num: 7,
    icon: Home,
    title: 'Keep Data Current',
    color: 'gray',
    body: 'Upload new mortgage statements as they arrive — balances and payments update automatically. Upload each year\'s tax return after filing. Refresh market values in the Details tab periodically to keep equity and LTV accurate.',
    tips: [
      'Use "Reprocess All" on the Uploads page to re-extract all documents after a parser update.',
      'The Loans tab on each property shows full amortization schedule and ARM reset details.',
      'Scenarios tab lets you model refinance or purchase scenarios without touching real data.',
    ],
    link: '/uploads',
    linkLabel: 'Go to Uploads',
  },
]

const SECTION_COLOR = { blue: 'bg-blue-600', green: 'bg-green-600', purple: 'bg-purple-600', amber: 'bg-amber-500', teal: 'bg-teal-600', gray: 'bg-gray-400' }

function GuideSection() {
  return (
    <div>
      <SectionHeading icon={Map} label="Getting Started — How to Use This Tool" color="blue" />
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Follow these steps to get your portfolio fully set up. Each step takes 2–5 minutes.
        You can do them in any order, but the sequence below gives the best results.
      </p>

      <div className="space-y-4">
        {GUIDE_STEPS.map((step) => (
          <div key={step.num} className="card border border-gray-100 dark:border-gray-700">
            <div className="flex gap-4">
              <div className="shrink-0 flex flex-col items-center">
                <div className={`w-9 h-9 rounded-xl ${SECTION_COLOR[step.color]} flex items-center justify-center`}>
                  <step.icon className="w-4 h-4 text-white" />
                </div>
                <div className="text-xs font-bold text-gray-300 dark:text-gray-600 mt-1">#{step.num}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{step.title}</h3>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">{step.body}</p>
                <ul className="space-y-1 mb-3">
                  {step.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                      {tip}
                    </li>
                  ))}
                </ul>
                {step.link && (
                  <Link to={step.link} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800">
                    {step.linkLabel} <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-sm font-semibold text-blue-800 mb-2">Data flow summary</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-blue-700">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-100">
            <p className="font-semibold mb-1">Inputs</p>
            <p>Mortgage statements · Tax returns · Rent &amp; occupancy · Market value · Operating expenses</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-100">
            <p className="font-semibold mb-1">Calculated</p>
            <p>NOI · Cash flow · Equity · LTV · DSCR · Cap rate · Weighted rate · Taxable income</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-100">
            <p className="font-semibold mb-1">Views</p>
            <p>Dashboard tabs · Yearly P&amp;L table · Performance signals · Loan amortization · Scenarios</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────────

const SECTIONS = [
 { id: 'guide', label: 'Getting Started', icon: Map },
 { id: 'architecture', label: 'Architecture & Source', icon: BookOpen },
 { id: 'rent-cashflow', label: 'Rent, NOI & Cash Flow', icon: DollarSign },
 { id: 'loans', label: 'Loans & Amortization', icon: Landmark },
 { id: 'depreciation', label: 'Depreciation', icon: BarChart3 },
 { id: 'taxes', label: 'Taxes', icon: FileText },
 { id: 'returns', label: 'Return Metrics', icon: TrendingUp },
 { id: 'data', label: 'Data & Assertions', icon: Shield },
]

const SECTION_ICON = { architecture: BookOpen, 'rent-cashflow': DollarSign, loans: Landmark, depreciation: BarChart3, taxes: FileText, returns: TrendingUp, data: Shield }
const SECTION_COLOR_MAP = { architecture: 'blue', 'rent-cashflow': 'green', loans: 'purple', depreciation: 'teal', taxes: 'amber', returns: 'blue', data: 'red' }

// ── field mapping data (sources and input variables per metric) ───────────────
const FIELD_SOURCES = Object.fromEntries(METRICS.map((metric) => [
 metric.id,
 {
  variables: Array.isArray(metric.tags) ? metric.tags.map((tag) => tag.label).join(', ') : '',
  source: metric.description,
 },
]))

function downloadFieldMapping() {
  const rows = METRICS.map(m => {
    const src = FIELD_SOURCES[m.id] || {}
    // strip JSX from formula — use string or convert
    const formulaStr = typeof m.formula === 'string' ? m.formula : ''
    return {
      'Metric Name':      m.title,
      'Category':         m.sectionLabel,
      'Formula':          formulaStr,
      'Input Variables':  src.variables || '',
      'Source of Inputs': src.source   || '',
      'Tags':             (m.tags || []).map(t => t.label).join(', '),
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  // Column widths
  ws['!cols'] = [
    { wch: 32 },  // Metric Name
    { wch: 26 },  // Category
    { wch: 70 },  // Formula
    { wch: 60 },  // Input Variables
    { wch: 80 },  // Source of Inputs
    { wch: 30 },  // Tags
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Field & Logic Mapping')
  XLSX.writeFile(wb, 'PropertyLens_Field_Logic_Mapping.xlsx')
}

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState('guide')
  const [query, setQuery] = useState('')

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return METRICS.filter(m =>
      m.title.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      (m.formula || '').toLowerCase().includes(q) ||
      (m.search || '').toLowerCase().includes(q) ||
      m.sectionLabel.toLowerCase().includes(q)
    )
  }, [query])

  const sectionMetrics = useMemo(() =>
    METRICS.filter(m => m.section === activeSection),
    [activeSection]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <BookOpen className="w-6 h-6 text-blue-600 shrink-0" />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Help &amp; Documentation</h1>
              <button
                onClick={downloadFieldMapping}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Field &amp; Logic Mapping (.xlsx)
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Formulas, definitions, and worked examples for every metric</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search metrics, formulas…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Search results */}
      {searchResults !== null ? (
        <div className="flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {searchResults.length === 0
              ? `No results for "${query}"`
              : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${query}"`}
          </p>
          {searchResults.length === 0 ? (
            <div className="text-center py-12 card text-gray-400 dark:text-gray-500">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>Try searching for a metric name, formula term, or keyword like "NOI", "LTV", "vacancy", or "DSCR".</p>
            </div>
          ) : (
            <div>
              {/* Group by section */}
              {[...new Set(searchResults.map(m => m.section))].map(sec => (
                <div key={sec} className="mb-6">
                  <SectionBadge sectionLabel={searchResults.find(m => m.section === sec)?.sectionLabel} />
                  {searchResults.filter(m => m.section === sec).map(m => (
                    <MetricCard key={m.id} {...m} highlight={query} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Normal tabbed view */
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left nav */}
          <aside className="lg:w-56 shrink-0">
            <nav className="space-y-1 lg:sticky lg:top-4">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveSection(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                    activeSection === id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === 'guide' ? (
              <GuideSection />
            ) : (
              <div>
                <SectionHeading
                  icon={SECTION_ICON[activeSection]}
                  label={SECTIONS.find(s => s.id === activeSection)?.label}
                  color={SECTION_COLOR_MAP[activeSection]}
                />

                {activeSection === 'expenses' && (
                  <>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      All fields below are stored per property and sum into the Operating Expenses line used in NOI, Cash Flow, and yearly P&amp;L calculations.
                    </p>
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 text-sm text-blue-700">
                      <p className="font-semibold text-blue-800 mb-1">How expenses flow into calculations</p>
                      <p><strong>NOI</strong> = Gross Rent − (Property Tax + Insurance + HOA + Maintenance + Mgmt + Utilities + Vacancy + CapEx + Other)</p>
                      <p className="mt-1"><strong>Cash Flow</strong> = Gross Rent − Mortgage P&amp;I − max(Tax/Insurance, Escrow) − Other Operating Expenses</p>
                      <p className="text-xs text-blue-500 mt-1">If annual tax and insurance are missing or lower than lender escrow, escrow is used so monthly cost is still counted.</p>
                    </div>
                  </>
                )}

                {sectionMetrics.map(m => (
                  <MetricCard key={m.id} {...m} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
