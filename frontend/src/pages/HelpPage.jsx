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
  // ── Portfolio Value & Equity ──────────────────────────────────────────────
  {
    id: 'num-props', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Number of Properties',
    tags: [{ label: 'Count', color: 'blue' }],
    description: 'Total count of all properties added to the portfolio — rentals and primary residences combined.',
    formula: 'Count of all active properties',
    search: 'count properties total owned',
    example: <p>6 properties added → <strong>6</strong></p>,
  },
  {
    id: 'portfolio-value', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Total Portfolio Value',
    tags: [{ label: 'Market Value', color: 'blue' }],
    description: 'Sum of the current estimated market value set on each property. Update each property\'s Market Value field to keep this accurate — Zillow or recent comparable sales are good sources.',
    formula: 'Portfolio Value = Σ (Market Value per property)',
    search: 'portfolio value market sum appreciation total',
    example: <>
      <p>$1,050k + $1,025k + $875k + $930k + $1,200k + $520k</p>
      <p>= <strong>$5,600,000</strong></p>
    </>,
  },
  {
    id: 'loan-balance', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Outstanding Loan Balance',
    tags: [{ label: 'Debt', color: 'red' }],
    description: 'Total remaining principal owed across all active loans, summed from each loan\'s Current Balance field. Populated automatically from uploaded mortgage statements.',
    formula: 'Total Loan Balance = Σ (Current Balance per loan)',
    search: 'loan balance outstanding debt owed mortgage',
    example: <>
      <p>$733k + $442k + $497k + $438k + $830k + $393k</p>
      <p>= <strong>$3,333,000</strong></p>
    </>,
  },
  {
    id: 'equity', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Total Equity',
    tags: [{ label: 'Net Worth', color: 'green' }],
    description: 'The portion of portfolio value you own outright — market value minus outstanding debt. Grows through appreciation and principal paydown.',
    formula: 'Total Equity = Portfolio Value − Total Loan Balance',
    search: 'equity net worth ownership value',
    example: <p>$5,600,000 − $3,333,000 = <strong>$2,267,000</strong></p>,
  },
  {
    id: 'equity-pct', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Portfolio Equity %',
    tags: [{ label: 'Ratio', color: 'green' }],
    description: 'Equity as a share of total portfolio value. Inverse of LTV — Equity % + LTV = 100%.',
    formula: 'Equity % = (Total Equity ÷ Portfolio Value) × 100',
    search: 'equity percentage fraction ownership share',
    example: <p>$2,267,000 ÷ $5,600,000 × 100 = <strong>40.5%</strong></p>,
  },
  {
    id: 'ltv', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Loan-to-Value (LTV)',
    tags: [{ label: 'Ratio', color: 'amber' }],
    description: 'What percentage of your portfolio\'s market value is still financed. Lower is safer — below 60% is healthy, 60–80% moderate, above 80% high risk.',
    formula: 'LTV = (Total Loan Balance ÷ Portfolio Value) × 100',
    search: 'ltv loan to value ratio leverage percentage debt',
    example: <>
      <p>$3,333,000 ÷ $5,600,000 × 100 = <strong>59.5%</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: &lt;60% Healthy · 60–80% Moderate · &gt;80% High risk</p>
    </>,
  },
  {
    id: 'appreciation', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Appreciation Gain',
    tags: [{ label: 'Gain/Loss', color: 'purple' }],
    description: 'Market value growth since purchase across all properties. Independent of principal paydown — measures only how much values have risen.',
    formula: 'Appreciation Gain = Portfolio Value − Total Purchase Price',
    search: 'appreciation gain value growth purchase price increase',
    example: <>
      <p>$5,600,000 (current) − $5,200,000 (purchased) = <strong>+$400,000</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Purchase price is the sum of original purchase prices entered per property.</p>
    </>,
  },
  {
    id: 'original-ltv-portfolio', section: 'portfolio', sectionLabel: 'Portfolio Value & Equity',
    title: 'Original LTV (at Purchase)',
    tags: [{ label: 'Historical', color: 'blue' }],
    description: 'Combined loan-to-value at the time of purchase. Compares the original loan amounts to the original purchase prices. Only loans with a recorded original amount are included.',
    formula: 'Original LTV = Σ(Original Loan Amounts) ÷ Σ(Purchase Prices) × 100',
    search: 'original ltv purchase leverage pmi historical',
    example: <>
      <p>Original loans: $4,200,000 · Purchase prices: $5,200,000</p>
      <p>$4,200,000 ÷ $5,200,000 × 100 = <strong>80.8%</strong></p>
    </>,
  },

  // ── Cash Flow Metrics ─────────────────────────────────────────────────────
  {
    id: 'effective-rent', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Effective Monthly Rent',
    tags: [{ label: 'Income', color: 'green' }],
    description: 'Gross rent adjusted for the occupancy rate. Primary residences contribute $0. A property with 95% occupancy on $4,500/mo contributes $4,275.',
    formula: 'Effective Rent = Monthly Rent × (Occupancy Rate ÷ 100)\nPortfolio: Σ(Effective Rent per rental property)',
    search: 'gross rent effective monthly income collected occupancy',
    example: <>
      <p>San Salvador: $4,500 × 100% = $4,500</p>
      <p>Syrah Dr: $4,833 × 100% = $4,833</p>
      <p>Mission Ln: $3,075 × 100% = $3,075</p>
      <p>… all 5 rentals = <strong>$19,000/mo total</strong></p>
    </>,
  },
  {
    id: 'operating-expenses', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Monthly Operating Expenses',
    tags: [{ label: 'Expenses', color: 'amber' }],
    description: 'All property-level expenses excluding mortgage principal & interest. Taxes and insurance are entered annually and divided by 12. All other fields are monthly.',
    formula: 'Op Expenses = (Property Tax + Insurance) ÷ 12\n            + HOA + Maintenance + Mgmt Fee\n            + Utilities + Vacancy + CapEx + Other',
    search: 'operating expenses monthly property tax insurance hoa maintenance management',
    example: <>
      <p>Property tax: $6,000/yr ÷ 12 = $500</p>
      <p>Insurance: $2,400/yr ÷ 12 = $200</p>
      <p>HOA: $0 · Maintenance: $300 · Mgmt: $450</p>
      <p>Total = <strong>$1,450/mo</strong> for one property</p>
    </>,
  },
  {
    id: 'noi', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Net Operating Income (NOI)',
    tags: [{ label: 'Key Metric', color: 'blue' }, { label: 'Income', color: 'green' }],
    description: 'Income after operating expenses but before debt service. NOI is independent of financing — it measures a property\'s earning power on its own. Used to calculate cap rate and DSCR.',
    formula: 'NOI/mo = Effective Rent − Operating Expenses\nNOI/yr  = NOI/mo × 12',
    search: 'noi net operating income earning power cap rate dscr',
    example: <>
      <p>Effective rent: $4,500</p>
      <p>Operating expenses: −$1,450</p>
      <p>NOI = <strong>$3,050/mo</strong> · <strong>$36,600/yr</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Mortgage P&amp;I is NOT included — NOI is pre-financing.</p>
    </>,
  },
  {
    id: 'cap-rate', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Cap Rate',
    tags: [{ label: 'Return', color: 'teal' }, { label: 'Key Metric', color: 'blue' }],
    description: 'Annual NOI as a percentage of market value. Shows the unlevered return — what the property earns independent of how it is financed. Higher is better; 5–8% is typical for residential rentals.',
    formula: 'Cap Rate = (Annual NOI ÷ Market Value) × 100',
    search: 'cap rate capitalization return market value noi yield',
    example: <>
      <p>Annual NOI: $36,600 · Market Value: $875,000</p>
      <p>$36,600 ÷ $875,000 × 100 = <strong>4.2%</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Benchmark: &lt;4% Low · 4–6% Average · &gt;6% Strong</p>
    </>,
  },
  {
    id: 'gross-yield', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Gross Yield',
    tags: [{ label: 'Return', color: 'teal' }],
    description: 'Annual effective rent as a percentage of market value. A quick screen before factoring in expenses. Higher than cap rate because it ignores operating costs.',
    formula: 'Gross Yield = (Annual Effective Rent ÷ Market Value) × 100',
    search: 'gross yield rental return market value rent',
    example: <>
      <p>Annual rent: $4,500 × 12 = $54,000 · Market value: $875,000</p>
      <p>$54,000 ÷ $875,000 × 100 = <strong>6.2%</strong></p>
    </>,
  },
  {
    id: 'mortgage-payment', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Mortgage Payment (Principal & Interest)',
    tags: [{ label: 'Debt Service', color: 'red' }],
    description: 'Principal and interest portion only. Escrow is counted under tax/insurance expenses when annual tax and insurance fields are missing or lower, avoiding double-counting.',
    formula: 'Monthly Principal & Interest = Σ (Statement Payment − Escrow Amount) per loan\n            = Σ monthly_payment − Σ escrow_amount',
    search: 'mortgage payment principal interest escrow monthly loan debt service',
    example: <>
      <p>Loan statement: $3,847/mo PITI · Escrow: $647/mo</p>
      <p>P&amp;I = $3,847 − $647 = <strong>$3,200/mo</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Escrow covers property tax + insurance already in Operating Expenses above.</p>
    </>,
  },
  {
    id: 'cash-flow', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Monthly Cash Flow',
    tags: [{ label: 'Bottom Line', color: 'blue' }],
    description: 'Net cash remaining after all expenses and principal & interest payments. Positive means the property funds itself; negative means you top it up from other income.',
    formula: 'Cash Flow = Effective Rent − Operating Expenses − Mortgage Principal & Interest',
    search: 'cash flow monthly bottom line profit loss',
    example: <>
      <p>Effective rent: $4,500</p>
      <p>− Operating expenses: $1,450</p>
      <p>− Mortgage P&amp;I: $3,200</p>
      <p>= <strong>−$150/mo</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Slight negative cash flow is common on leveraged investment properties — appreciation and equity buildup often offset it.</p>
    </>,
  },
  {
    id: 'cf-margin', section: 'cashflow', sectionLabel: 'Cash Flow Metrics',
    title: 'Cash Flow Margin',
    tags: [{ label: 'Efficiency', color: 'purple' }],
    description: 'Cash flow as a percentage of gross rent. Measures how efficiently collected rent converts to take-home income after all costs.',
    formula: 'Cash Flow Margin = (Monthly Cash Flow ÷ Effective Monthly Rent) × 100',
    search: 'cash flow margin efficiency percentage rent ratio',
    example: <>
      <p>−$150 ÷ $4,500 × 100 = <strong>−3.3%</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Target: &gt;10% healthy · 0–10% break-even · &lt;0% subsidized</p>
    </>,
  },

  // ── Financing & Debt Metrics ──────────────────────────────────────────────
  {
    id: 'original-loan', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Original Loan Amount',
    tags: [{ label: 'Historical', color: 'blue' }],
    description: 'Total loan principal at time of purchase, summed across all loans that have a recorded original amount. Loans without an original amount entered are excluded.',
    formula: 'Σ (Original Loan Amount) for loans where original_amount > 0',
    search: 'original loan amount purchase financing debt start',
    example: <>
      <p>$840k + $700k + $400k + $350k + $880k + $416k</p>
      <p>= <strong>$3,586,000</strong> total at purchase</p>
    </>,
  },
  {
    id: 'original-ltv', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Original LTV',
    tags: [{ label: 'Historical', color: 'blue' }],
    description: 'Portfolio LTV at the time of purchase. Compares original loan amounts to original purchase prices to show how leveraged you started.',
    formula: 'Original LTV = Σ(Original Loans) ÷ Σ(Purchase Prices) × 100',
    search: 'original ltv loan to value purchase leverage pmi historical',
    example: <>
      <p>$3,586,000 ÷ $5,200,000 × 100 = <strong>69.0%</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Below 80% at purchase avoids PMI on conventional loans.</p>
    </>,
  },
  {
    id: 'principal-paid', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Principal Paid Till Date',
    tags: [{ label: 'Equity Buildup', color: 'green' }],
    description: 'Equity created through loan repayment (not appreciation) — the difference between each loan\'s original amount and current balance. Only loans with a recorded original amount count.',
    formula: 'Principal Paid = Σ (Original Loan Amount − Current Balance)\n               per loan where original_amount recorded',
    search: 'principal paid equity buildup paydown loan reduction',
    example: <>
      <p>San Salvador: $840,000 − $733,000 = $107,000</p>
      <p>Palermo: $880,000 − $830,000 = $50,000</p>
      <p>… all 6 loans → Total = <strong>$253,000 paid down</strong></p>
    </>,
  },
  {
    id: 'interest-paid', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Interest Paid Till Date',
    tags: [{ label: 'Historical', color: 'amber' }],
    description: 'Total mortgage interest paid across all years where a tax return or 1098 has been uploaded. Sourced from Schedule E (mortgage interest line) and 1098 forms. Upload more returns to improve accuracy.',
    formula: 'Σ (mortgage_interest field from each TaxReturnEntry / 1098 record)',
    search: 'interest paid till date historical tax return 1098 schedule e total',
    example: <>
      <p>2022 Schedule E (all properties): $123,000</p>
      <p>2023 Schedule E (all properties): $118,000</p>
      <p>2024 Schedule E (all properties): $113,000</p>
      <p>Total (3 years) = <strong>$354,000</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Requires uploaded tax returns or 1098s. Only covers years with documents.</p>
    </>,
  },
  {
    id: 'weighted-rate', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Weighted Average Interest Rate',
    tags: [{ label: 'Key Formula', color: 'purple' }],
    description: 'A single blended rate representing the cost of all debt, weighted by each loan\'s current balance. Larger loans carry more weight than smaller ones.',
    formula: 'Weighted Rate = Σ(Current Balance × Interest Rate) ÷ Σ(Current Balances)',
    search: 'weighted average interest rate debt cost blended formula',
    example: <>
      <table className="w-full text-xs mt-1 mb-2">
        <thead>
          <tr className="text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
            <th className="text-left pb-1">Property</th>
            <th className="text-right pb-1">Balance</th>
            <th className="text-right pb-1">Rate</th>
            <th className="text-right pb-1">Bal × Rate</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['San Salvador','$733,000','5.125%','$3,756,625'],
            ['Syrah Dr',    '$393,000','2.875%','$1,130,063'],
            ['Mission Ln',  '$442,000','3.625%','$1,602,250'],
            ['Electra Way', '$497,000','6.500%','$3,230,500'],
            ['Palermo Way', '$830,000','2.875%','$2,386,250'],
            ['Osprey Dr',   '$438,000','7.625%','$3,339,750'],
          ].map(([n,b,r,p]) => (
            <tr key={n} className="border-b border-gray-50 dark:border-gray-800">
              <td className="py-0.5 text-gray-600 dark:text-gray-300 pr-2">{n}</td>
              <td className="text-right">{b}</td>
              <td className="text-right">{r}</td>
              <td className="text-right font-medium">{p}</td>
            </tr>
          ))}
          <tr className="font-semibold pt-1">
            <td>Total</td>
            <td className="text-right">$3,333,000</td>
            <td/>
            <td className="text-right">$15,445,438</td>
          </tr>
        </tbody>
      </table>
      <p className="font-semibold">$15,445,438 ÷ $3,333,000 = <strong>4.63%</strong> weighted avg rate</p>
    </>,
  },
  {
    id: 'annual-debt-service', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Annual Debt Service',
    tags: [{ label: 'Debt Service', color: 'red' }],
    description: 'Total annual principal & interest payments across all loans. Escrow is excluded — taxes and insurance are counted under Operating Expenses. Used as the denominator in DSCR.',
    formula: 'Annual Debt Service = Σ(Monthly Payment − Escrow Amount) per loan × 12\n                     = Total Monthly Principal & Interest × 12',
    search: 'annual debt service mortgage yearly obligation piti escrow',
    example: <>
      <p>Total monthly P&amp;I across all loans: $18,300/mo</p>
      <p>$18,300 × 12 = <strong>$219,600/yr</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Escrow (taxes/insurance via lender) is NOT included here — those costs appear in Operating Expenses.</p>
    </>,
  },
  {
    id: 'dscr', section: 'financing', sectionLabel: 'Financing & Debt Metrics',
    title: 'Portfolio DSCR',
    tags: [{ label: 'Key Metric', color: 'blue' }, { label: 'Lender Threshold', color: 'purple' }],
    description: 'Debt Service Coverage Ratio — how many times annual NOI covers annual debt service. The primary underwriting metric lenders use. Below 1.0 means rent income doesn\'t cover mortgage payments.',
    formula: 'DSCR = Annual NOI ÷ Annual Debt Service',
    search: 'dscr debt service coverage ratio noi lender underwriting',
    example: <>
      <p>Annual NOI (all rentals): $228,000/yr</p>
      <p>Annual Debt Service (P&amp;I only): $219,600/yr</p>
      <p>DSCR = $228,000 ÷ $219,600 = <strong>1.04</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: ≥1.25 Strong · 1.0–1.25 Marginal · &lt;1.0 Income below debt</p>
    </>,
  },

  // ── Risk Metrics ──────────────────────────────────────────────────────────
  {
    id: 'concentration', section: 'risk', sectionLabel: 'Risk Metrics',
    title: 'Concentration Risk',
    tags: [{ label: 'Diversification', color: 'amber' }],
    description: 'Share of total portfolio equity held by the single largest property. High concentration means one bad event has an outsized impact on total net worth.',
    formula: 'Concentration Risk = (Largest Single Property Equity ÷ Total Portfolio Equity) × 100',
    search: 'concentration risk diversification single property equity',
    example: <>
      <p>Palermo Way equity: $630,000 (largest)</p>
      <p>Total portfolio equity: $2,267,000</p>
      <p>$630,000 ÷ $2,267,000 × 100 = <strong>27.8%</strong> — Diversified</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: &lt;35% Diversified · 35–50% Moderate · &gt;50% Concentrated</p>
    </>,
  },
  {
    id: 'arm-exposure', section: 'risk', sectionLabel: 'Risk Metrics',
    title: 'ARM Exposure',
    tags: [{ label: 'Rate Risk', color: 'red' }],
    description: 'Percentage of total loan balance on adjustable-rate mortgages. ARM loans reset after the initial fixed period and can increase significantly when market rates rise.',
    formula: 'ARM Exposure = (Σ ARM Loan Balances ÷ Total Loan Balance) × 100',
    search: 'arm adjustable rate mortgage exposure risk variable',
    example: <>
      <p>All loans are fixed-rate → ARM balance = $0</p>
      <p>$0 ÷ $3,333,000 × 100 = <strong>0%</strong> — No rate risk</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: 0% None · &lt;25% Low · 25–50% Moderate · &gt;50% High</p>
    </>,
  },
  {
    id: 'high-rate', section: 'risk', sectionLabel: 'Risk Metrics',
    title: 'High Interest Debt',
    tags: [{ label: 'Rate Risk', color: 'red' }],
    description: 'Share of loan balance carrying a rate above 6%. These loans are the strongest refinance candidates when market rates decline.',
    formula: 'High-Rate Exposure = (Σ Balances where Rate > 6% ÷ Total Loan Balance) × 100',
    search: 'high interest debt rate above 6% refinance expensive',
    example: <>
      <p>Electra Way: $497,000 @ 6.5% + Osprey Dr: $438,000 @ 7.625%</p>
      <p>High-rate balance: $935,000</p>
      <p>$935,000 ÷ $3,333,000 × 100 = <strong>28.1%</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: 0% Clean · &lt;10% Manageable · &gt;30% Refinance candidate</p>
    </>,
  },
  {
    id: 'vacancy-rate', section: 'risk', sectionLabel: 'Risk Metrics',
    title: 'Economic Vacancy Rate',
    tags: [{ label: 'Occupancy', color: 'amber' }],
    description: 'The income gap between full occupancy and actual collection. Covers physical vacancy (empty unit) and any rent discounts.',
    formula: 'Vacancy Rate = (1 − Occupancy Rate ÷ 100) × 100\n             = (Scheduled Rent − Effective Rent) ÷ Scheduled Rent × 100',
    search: 'economic vacancy rate occupancy actual scheduled rent empty',
    example: <>
      <p>Property at 95% occupancy → vacancy rate = <strong>5%</strong></p>
      <p>Scheduled: $4,500/mo · Effective: $4,275/mo</p>
      <p>($4,500 − $4,275) ÷ $4,500 × 100 = <strong>5%</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: &lt;7% Healthy · 7–10% Watch · &gt;10% High</p>
    </>,
  },
  {
    id: 'debt-weighted-rate', section: 'risk', sectionLabel: 'Risk Metrics',
    title: 'Debt-Weighted Interest Rate',
    tags: [{ label: 'Key Formula', color: 'purple' }],
    description: 'Same calculation as Weighted Average Rate in the Financing tab — shown here because a rising portfolio rate is a risk signal. Large loans skew the average more than small ones.',
    formula: 'Weighted Rate = Σ(Current Balance × Interest Rate) ÷ Σ(Current Balances)',
    search: 'debt weighted interest rate blended average cost risk',
    example: <>
      <p>Σ(Balance × Rate) = $15,445,438</p>
      <p>Σ(Balance) = $3,333,000</p>
      <p>= <strong>4.63%</strong> (see Financing tab for full breakdown)</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Zones: ≤5% Low · 5–6.5% Moderate · &gt;6.5% High — refinance candidates</p>
    </>,
  },
  {
    id: 'portfolio-occupancy', section: 'risk', sectionLabel: 'Risk Metrics',
    title: 'Portfolio Occupancy',
    tags: [{ label: 'Occupancy', color: 'teal' }],
    description: 'Effective rent collected as a share of what all properties would earn at 100% occupancy. Inverse of vacancy rate.',
    formula: 'Portfolio Occupancy = (Total Effective Rent ÷ Total Scheduled Rent) × 100\nTotal Scheduled Rent = Σ (Monthly Rent for all rentals)',
    search: 'portfolio occupancy effective rent scheduled full total',
    example: <>
      <p>Scheduled (all 5 rentals at 100%): $20,000/mo</p>
      <p>Effective (after occupancy rates): $19,000/mo</p>
      <p>$19,000 ÷ $20,000 × 100 = <strong>95%</strong></p>
    </>,
  },

  // ── Property Analytics ────────────────────────────────────────────────────
  {
    id: 'depreciation', section: 'analytics', sectionLabel: 'Property Analytics',
    title: 'Annual Depreciation',
    tags: [{ label: 'Tax Deduction', color: 'purple' }],
    description: 'IRS allows residential rental property to be depreciated over 27.5 years. Only the structure depreciates — not the land. The first year uses the mid-month convention: you get credit for only the fraction of months remaining after placed in service.',
    formula: 'Full Year:   (Purchase Price − Land Value) ÷ 27.5\nFirst Year:  Full Year × (12 − Month Placed + 0.5) ÷ 12',
    search: 'depreciation irs 27.5 years tax deduction residential rental mid-month',
    extra: <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Source priority: Tax Return (Schedule E line 18) → IRS mid-month calculation → full-year estimate. Upload tax returns to get the exact filed figure.</p>,
    example: <>
      <p>Purchase price: $875,000 · Land value: $175,000</p>
      <p>Depreciable basis: $875,000 − $175,000 = $700,000</p>
      <p>Full year: $700,000 ÷ 27.5 = <strong>$25,455/yr</strong></p>
      <p>First year (placed in service Sep): × (12 − 9 + 0.5) ÷ 12 = × 0.292</p>
      <p>First-year deduction: <strong>$7,433</strong></p>
    </>,
  },
  {
    id: 'taxable-income', section: 'analytics', sectionLabel: 'Property Analytics',
    title: 'Taxable Income (Schedule E)',
    tags: [{ label: 'Tax', color: 'purple' }],
    description: 'Net rental profit or loss per IRS Schedule E. Rental losses (common with depreciation) can offset other income subject to passive activity rules and income limits.',
    formula: 'Taxable Income = Rental Income − Operating Expenses − Mortgage Interest − Depreciation',
    search: 'taxable income schedule e rental loss profit irs passive activity',
    example: <>
      <p>Rent: $54,000</p>
      <p>− Operating expenses: $18,500</p>
      <p>− Mortgage interest: $39,153</p>
      <p>− Depreciation: $25,452</p>
      <p>= <strong>−$29,105 (rental loss)</strong></p>
    </>,
  },
  {
    id: 'total-return', section: 'analytics', sectionLabel: 'Property Analytics',
    title: 'Total Annual Return',
    tags: [{ label: 'Combined Return', color: 'green' }],
    description: 'Cash return plus equity built through principal paydown in a given year. Does not include appreciation (unrealized) or tax benefits from depreciation.',
    formula: 'Total Return = Annual Cash Flow + Annual Principal Paid',
    search: 'total return annual cash flow principal equity buildup combined',
    example: <>
      <p>Annual cash flow: −$1,800</p>
      <p>Principal paid (from 1098 balance delta): +$8,400</p>
      <p>Total return: <strong>$6,600/yr</strong></p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Even with negative cash flow, principal paydown creates real equity.</p>
    </>,
  },
  {
    id: 'cumulative-net-income', section: 'analytics', sectionLabel: 'Property Analytics',
    title: 'Cumulative Net Income',
    tags: [{ label: 'Historical', color: 'teal' }],
    description: 'Running total of taxable income across all years owned. Negative cumulative income reflects the tax losses that have accumulated — useful for understanding your tax position over time.',
    formula: 'Cumulative Net Income (year N) = Σ Taxable Income from purchase year to year N',
    search: 'cumulative net income running total taxable loss historical years',
    example: <>
      <p>2022: −$6,202 · 2023: −$28,846 · 2024: −$15,758</p>
      <p>Cumulative through 2024: <strong>−$50,806</strong></p>
    </>,
  },

  // ── Operating Expenses ────────────────────────────────────────────────────
  {
    id: 'prop-tax', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Property Taxes',
    tags: [{ label: 'Annual $', color: 'amber' }],
    description: 'Annual county property tax bill. Entered as a yearly amount, divided by 12 for monthly calculations. If your lender escrows taxes, the escrow covers this — so property_tax and insurance together should match the escrow amount to avoid double-counting.',
    formula: 'Monthly contribution = Annual Property Tax ÷ 12',
    search: 'property tax annual county assessor escrow',
    example: <p>$6,000/yr ÷ 12 = <strong>$500/mo</strong> in operating expenses</p>,
  },
  {
    id: 'insurance', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Insurance',
    tags: [{ label: 'Annual $', color: 'amber' }],
    description: 'Annual homeowner / landlord insurance premium. Entered yearly, divided by 12. If escrowed, included in the escrow amount on your mortgage statement.',
    formula: 'Monthly contribution = Annual Insurance ÷ 12',
    search: 'insurance homeowner landlord premium annual',
    example: <p>$2,400/yr ÷ 12 = <strong>$200/mo</strong></p>,
  },
  {
    id: 'hoa', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'HOA Fee',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Monthly homeowners association dues. Enter 0 if the property has no HOA.',
    formula: 'Direct monthly expense',
    search: 'hoa homeowners association fee monthly dues',
    example: <p>HOA: <strong>$350/mo</strong></p>,
  },
  {
    id: 'maintenance', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Repairs & Maintenance',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Routine ongoing maintenance — landscaping, appliance repairs, pest control, turnover cleaning. Rule of thumb: 1% of property value per year.',
    formula: 'Rough guide: (Property Value × 1%) ÷ 12',
    search: 'repairs maintenance routine landscaping appliance cleaning',
    example: <p>$875,000 × 1% ÷ 12 = <strong>$729/mo</strong></p>,
  },
  {
    id: 'mgmt-fee', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Property Management Fee',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Fee paid to a property manager, typically 8–12% of monthly rent collected. Enter 0 if self-managing.',
    formula: 'Rough guide: Monthly Rent × 8–12%',
    search: 'property management fee company 8% 10% 12% manager',
    example: <p>$4,500 rent × 10% = <strong>$450/mo</strong></p>,
  },
  {
    id: 'utilities', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Utilities',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Water, gas, electric, trash — any utility the landlord pays instead of the tenant. Common in multi-family with master meters.',
    formula: 'Direct monthly expense',
    search: 'utilities water electric gas trash landlord pays',
    example: <p>Water + trash: <strong>$150/mo</strong></p>,
  },
  {
    id: 'vacancy-allowance', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Vacancy Allowance',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Cash reserve for turnover costs: cleaning, advertising, leasing commissions. Complements the Occupancy Rate (which reduces effective rent) — this reserves actual cash for the turnover period.',
    formula: 'Rough guide: Monthly Rent × 5–8%',
    search: 'vacancy allowance reserve turnover empty unit advertising leasing',
    example: <p>$4,500 × 5% = <strong>$225/mo</strong> reserve</p>,
  },
  {
    id: 'capex', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'CapEx Reserve',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Monthly savings for large infrequent replacements: roof, HVAC, water heater, flooring, appliances. Typically 5–10% of gross rent.',
    formula: 'Rough guide: Monthly Rent × 5–10%',
    search: 'capex capital expenditure reserve roof hvac appliance replacement',
    example: <p>$4,500 × 8% = <strong>$360/mo</strong> CapEx reserve</p>,
  },
  {
    id: 'other-expenses', section: 'expenses', sectionLabel: 'Operating Expenses',
    title: 'Other Expenses',
    tags: [{ label: 'Monthly $', color: 'amber' }],
    description: 'Catch-all for any recurring cost not listed above: accounting, legal, advertising, licensing fees, etc.',
    formula: 'Direct monthly expense',
    search: 'other expenses miscellaneous accounting legal advertising licensing',
    example: <p>Accounting + misc: <strong>$100/mo</strong></p>,
  },
]

// ── Guide section (static, not in METRICS) ───────────────────────────────────

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
  { id: 'guide',     label: 'Getting Started',           icon: Map },
  { id: 'portfolio', label: 'Portfolio Value & Equity',   icon: TrendingUp },
  { id: 'cashflow',  label: 'Cash Flow Metrics',          icon: DollarSign },
  { id: 'financing', label: 'Financing & Debt Metrics',   icon: Landmark },
  { id: 'risk',      label: 'Risk Metrics',               icon: Shield },
  { id: 'analytics', label: 'Property Analytics',         icon: BarChart3 },
  { id: 'expenses',  label: 'Operating Expenses',         icon: Calculator },
]

const SECTION_ICON = { portfolio: TrendingUp, cashflow: DollarSign, financing: Landmark, risk: Shield, analytics: BarChart3, expenses: Calculator }
const SECTION_COLOR_MAP = { portfolio: 'blue', cashflow: 'green', financing: 'purple', risk: 'red', analytics: 'teal', expenses: 'amber' }

// ── field mapping data (sources and input variables per metric) ───────────────
const FIELD_SOURCES = {
  'num-props':              { variables: 'Count of properties',                           source: 'System — auto-counted from all created properties' },
  'portfolio-value':        { variables: 'market_value per property',                     source: 'Manual entry: Property Details → Market Value field; or Zillow refresh' },
  'loan-balance':           { variables: 'current_balance per loan',                      source: 'Manual entry: Loan Details → Current Balance; or uploaded mortgage statement (PDF)' },
  'equity':                 { variables: 'market_value, current_balance',                 source: 'Derived: Portfolio Value − Total Loan Balance' },
  'equity-pct':             { variables: 'total_equity, total_market_value',              source: 'Derived: Total Equity ÷ Portfolio Value' },
  'ltv':                    { variables: 'total_loan_balance, total_market_value',        source: 'Derived: Total Loan Balance ÷ Portfolio Value' },
  'appreciation':           { variables: 'market_value, purchase_price',                  source: 'Manual entry: Property Details → Market Value & Purchase Price' },
  'original-ltv-portfolio': { variables: 'original_loan_amount, purchase_price',          source: 'Manual entry: Loan Details → Original Loan Amount; Property Details → Purchase Price' },
  'effective-rent':         { variables: 'monthly_rent, occupancy_rate',                  source: 'Manual entry: Property Details → Monthly Rent + Rental Periods (occupancy)' },
  'operating-expenses':     { variables: 'property_tax, insurance, hoa, maintenance, mgmt_fee, utilities, vacancy_allowance, capex, other_expenses', source: 'Manual entry: Property page → Expenses section (all fields)' },
  'noi':                    { variables: 'effective_rent, operating_expenses',             source: 'Derived: Effective Rent − Operating Expenses' },
  'cap-rate':               { variables: 'annual_noi, market_value',                      source: 'Derived: (NOI × 12) ÷ Market Value' },
  'gross-yield':            { variables: 'monthly_rent, market_value',                    source: 'Derived: (Monthly Rent × 12) ÷ Market Value' },
  'mortgage-payment':       { variables: 'monthly_payment, escrow_amount',                source: 'Manual entry: Loan Details → Monthly Principal & Interest; or uploaded mortgage statement (PDF)' },
  'cash-flow':              { variables: 'effective_rent, operating_expenses, monthly_payment', source: 'Derived: Effective Rent − Op Expenses − Mortgage Principal & Interest' },
  'cf-margin':              { variables: 'monthly_cash_flow, effective_rent',              source: 'Derived: Cash Flow ÷ Effective Rent' },
  'original-loan':          { variables: 'original_loan_amount',                          source: 'Manual entry: Loan Details → Original Loan Amount; or uploaded mortgage statement' },
  'original-ltv':           { variables: 'original_loan_amount, purchase_price',          source: 'Manual entry: Loan Details → Original Loan Amount; Property Details → Purchase Price' },
  'principal-paid':         { variables: 'original_loan_amount, current_balance',         source: 'Manual entry: Loan Details → Original Loan Amount & Current Balance' },
  'interest-paid':          { variables: 'mortgage_interest (per year)',                  source: 'Uploaded tax returns (Schedule E) or 1098 forms — one entry per year' },
  'weighted-rate':          { variables: 'current_balance, interest_rate per loan',       source: 'Manual entry: Loan Details → Current Balance & Interest Rate; or uploaded statement' },
  'annual-debt-service':    { variables: 'monthly_payment, escrow_amount per loan',       source: 'Manual entry: Loan Details → Monthly Principal & Interest; or uploaded mortgage statement (PDF)' },
  'dscr':                   { variables: 'annual_noi, annual_debt_service',               source: 'Derived: Annual NOI ÷ Annual Debt Service' },
  'concentration':          { variables: 'largest_property_equity, total_equity',         source: 'Derived from market_value & current_balance per property' },
  'arm-exposure':           { variables: 'loan_type, current_balance',                    source: 'Manual entry: Loan Details → Loan Type (Fixed / ARM)' },
  'high-rate':              { variables: 'interest_rate, current_balance',                source: 'Manual entry: Loan Details → Interest Rate & Current Balance' },
  'vacancy-rate':           { variables: 'occupancy_rate, monthly_rent',                  source: 'Manual entry: Rental Periods → Occupancy % (per property)' },
  'debt-weighted-rate':     { variables: 'current_balance, interest_rate per loan',       source: 'Manual entry: Loan Details → Current Balance & Interest Rate' },
  'portfolio-occupancy':    { variables: 'effective_rent, scheduled_rent',                source: 'Derived from monthly_rent × occupancy_rate vs monthly_rent at 100%' },
  'depreciation':           { variables: 'purchase_price, land_value, placed_in_service_date', source: 'Tax return (Schedule E line 18); fallback: IRS 27.5-yr mid-month formula' },
  'taxable-income':         { variables: 'rental_income, operating_expenses, mortgage_interest, depreciation', source: 'Uploaded tax returns (Schedule E) — all four lines' },
  'total-return':           { variables: 'annual_cash_flow, annual_principal_paid',       source: 'Derived: Annual Cash Flow + Principal Paydown in period' },
  'cumulative-net-income':  { variables: 'net_income per year',                           source: 'Uploaded tax returns (Schedule E net income line) — running sum across years' },
  'prop-tax':               { variables: 'property_tax (annual)',                          source: 'Manual entry: Property Expenses → Property Taxes (annual $)' },
  'insurance':              { variables: 'insurance (annual)',                             source: 'Manual entry: Property Expenses → Insurance (annual $)' },
  'hoa':                    { variables: 'hoa (monthly)',                                  source: 'Manual entry: Property Expenses → HOA Fee (monthly $)' },
  'maintenance':            { variables: 'maintenance (monthly)',                          source: 'Manual entry: Property Expenses → Repairs & Maintenance (monthly $)' },
  'mgmt-fee':               { variables: 'mgmt_fee (monthly)',                             source: 'Manual entry: Property Expenses → Property Management Fee (monthly $)' },
  'utilities':              { variables: 'utilities (monthly)',                            source: 'Manual entry: Property Expenses → Utilities (monthly $)' },
  'vacancy-allowance':      { variables: 'vacancy_allowance (monthly)',                   source: 'Manual entry: Property Expenses → Vacancy Allowance (monthly $)' },
  'capex':                  { variables: 'capex (monthly)',                                source: 'Manual entry: Property Expenses → CapEx Reserve (monthly $)' },
  'other-expenses':         { variables: 'other_expenses (monthly)',                       source: 'Manual entry: Property Expenses → Other Expenses (monthly $)' },
}

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
