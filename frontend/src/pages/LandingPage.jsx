import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  Landmark,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import BrandLogo from '../components/BrandLogo'
import heroImage from '../assets/propertylens-hero.png'

const metrics = [
  { label: 'Net cash flow', value: '$18.6K', note: 'Trailing 30 days' },
  { label: 'Portfolio equity', value: '$3.8M', note: '12-property view' },
  { label: 'Debt posture', value: 'Low', note: '2 ARM loans flagged' },
]

const features = [
  {
    icon: BarChart3,
    title: 'Portfolio health',
    body: 'Cash flow, NOI, cap rate, DSCR, LTV, equity, and valuation movement across rentals.',
  },
  {
    icon: Landmark,
    title: 'Debt intelligence',
    body: 'Balances, interest, escrow, refinance history, ARM exposure, and principal paydown.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Tax-year clarity',
    body: 'Rent, expenses, mortgage interest, depreciation, 1098s, and Schedule E in yearly context.',
  },
  {
    icon: UploadCloud,
    title: 'Document-backed data',
    body: 'Use statements and tax records to keep portfolio numbers tied to source documents.',
  },
]

const checks = [
  'Rental income trends',
  'Mortgage interest paid',
  'Principal paydown',
  'Tax and insurance split',
  'Depreciation view',
  'Risk concentration',
]

function Header({ primaryHref, primaryLabel, user }) {
  return (
    <header className="border-b border-gray-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" aria-label="PropertyLens home">
          <BrandLogo
            markClassName="h-10 w-10"
            textClassName="text-base text-gray-950"
            subtitleClassName="text-gray-500"
          />
        </Link>
        <div className="flex items-center gap-2">
          {!user && (
            <Link
              to="/login"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Sign in
            </Link>
          )}
          <Link
            to={primaryHref}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </nav>
    </header>
  )
}

function Panel({ children, className = '' }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function PortfolioPreview() {
  return (
    <Panel className="p-3 shadow-xl shadow-gray-200/60">
      <div className="grid gap-3 lg:grid-cols-[0.72fr_1fr]">
        <div className="rounded-lg bg-gray-950 p-4 text-white">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-400">Portfolio readout</p>
              <p className="mt-1 text-sm text-gray-300">Current operating view</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-orange-400" />
          </div>
          <div className="mt-4 space-y-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-white/10 bg-gray-900 p-4">
                <p className="text-xs font-medium text-gray-400">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
                <p className="mt-1 text-xs font-semibold text-orange-400">{metric.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
          <img
            src={heroImage}
            alt="PropertyLens portfolio analytics preview"
            className="h-64 w-full object-cover object-[63%_44%] sm:h-80 lg:h-full"
          />
        </div>
      </div>
    </Panel>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const primaryHref = user ? '/dashboard' : '/register'
  const primaryLabel = user ? 'Open dashboard' : 'Start tracking'

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <Header primaryHref={primaryHref} primaryLabel={primaryLabel} user={user} />

      <main>
        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <p className="inline-flex items-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700">
              Rental property financial intelligence
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-gray-950 sm:text-5xl lg:text-6xl">
              See the financial health of every rental.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600">
              PropertyLens organizes rent, debt, tax, valuation, and document data into a calm operating view for
              rental-property owners.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to={primaryHref}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-100"
              >
                View portfolio
              </Link>
            </div>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {['Cash flow', 'Debt', 'Taxes'].map((item) => (
                <Panel key={item} className="px-3 py-3 text-sm font-semibold text-gray-700">
                  {item}
                </Panel>
              ))}
            </div>
          </div>

          <PortfolioPreview />
        </section>

        <section className="border-y border-gray-200 bg-white py-16">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">What it monitors</p>
                <h2 className="mt-3 text-3xl font-semibold text-gray-950 sm:text-4xl">
                  A disciplined view across properties, loans, taxes, and documents.
                </h2>
              </div>
              <ShieldCheck className="h-10 w-10 text-orange-600" />
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <Panel key={feature.title} className="p-5">
                  <feature.icon className="h-6 w-6 text-orange-600" />
                  <h3 className="mt-4 text-base font-semibold text-gray-950">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-gray-600">{feature.body}</p>
                </Panel>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Owner mode</p>
            <h2 className="mt-3 text-3xl font-semibold text-gray-950 sm:text-4xl">
              The quick answer to how your rentals are actually doing.
            </h2>
            <p className="mt-5 text-base leading-7 text-gray-600">
              Use it after tax uploads, loan updates, new purchases, rent changes, or before financing and sell-hold
              decisions.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {checks.map((check) => (
              <Panel key={check} className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-600" />
                <span className="text-sm font-medium text-gray-700">{check}</span>
              </Panel>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="rounded-lg bg-gray-950 px-6 py-8 text-white shadow-xl shadow-gray-300/70 sm:px-8 lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-orange-400">Ready when the portfolio gets serious.</p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Turn rental data into decisions.</h2>
            </div>
            <Link
              to={primaryHref}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-gray-950 hover:bg-orange-50 lg:mt-0"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
