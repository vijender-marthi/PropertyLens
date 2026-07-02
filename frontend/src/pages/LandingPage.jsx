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
    <header className="border-b border-[#d7d1c8] bg-[#ece8df]/95 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" aria-label="PropertyLens home">
          <BrandLogo
            markClassName="h-10 w-10"
            textClassName="text-base text-[#242321]"
            subtitleClassName="text-[#766f66]"
          />
        </Link>
        <div className="flex items-center gap-2">
          {!user && (
            <Link
              to="/login"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[#4f4942] hover:bg-white/70"
            >
              Sign in
            </Link>
          )}
          <Link
            to={primaryHref}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2f2c29] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1f1d1b]"
          >
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </nav>
    </header>
  )
}

function PalmPanel({ children, className = '' }) {
  return (
    <div className={`rounded-lg border border-[#d8d1c7] bg-[#f7f4ee] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_18px_45px_rgba(61,50,40,0.08)] ${className}`}>
      {children}
    </div>
  )
}

function PortfolioPreview() {
  return (
    <PalmPanel className="p-3">
      <div className="grid gap-3 lg:grid-cols-[0.72fr_1fr]">
        <div className="rounded-lg bg-[#383532] p-4 text-white shadow-inner">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f6a64b]">Portfolio readout</p>
              <p className="mt-1 text-sm text-white/70">Current operating view</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-[#f6a64b]" />
          </div>
          <div className="mt-4 space-y-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-white/10 bg-[#4a4642] p-4">
                <p className="text-xs font-medium text-white/58">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
                <p className="mt-1 text-xs font-semibold text-[#f6a64b]">{metric.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-[#d5cec4] bg-[#ddd7ce]">
          <img
            src={heroImage}
            alt="PropertyLens portfolio analytics preview"
            className="h-64 w-full object-cover object-[63%_44%] sm:h-80 lg:h-full"
          />
        </div>
      </div>
    </PalmPanel>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const primaryHref = user ? '/dashboard' : '/register'
  const primaryLabel = user ? 'Open dashboard' : 'Start tracking'

  return (
    <div className="min-h-screen bg-[#e8e3da] text-[#252321]">
      <Header primaryHref={primaryHref} primaryLabel={primaryLabel} user={user} />

      <main>
        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <p className="inline-flex items-center rounded-lg border border-[#e2a04a]/40 bg-[#fff4e5] px-3 py-2 text-sm font-semibold text-[#8b4b0d]">
              Rental property financial intelligence
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-[#1f1d1b] sm:text-5xl lg:text-6xl">
              See the financial health of every rental.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#625b52]">
              PropertyLens organizes rent, debt, tax, valuation, and document data into a calm operating view for
              rental-property owners.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to={primaryHref}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ef7d22] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#d96d1c]"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-lg border border-[#cbc3b8] bg-[#f8f5ef] px-5 py-3 text-sm font-semibold text-[#3e3934] hover:bg-white"
              >
                View portfolio
              </Link>
            </div>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {['Cash flow', 'Debt', 'Taxes'].map((item) => (
                <PalmPanel key={item} className="px-3 py-3 text-sm font-semibold text-[#5a524a]">
                  {item}
                </PalmPanel>
              ))}
            </div>
          </div>

          <PortfolioPreview />
        </section>

        <section className="border-y border-[#d6cec2] bg-[#f4f1eb] py-16">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#b65e19]">What it monitors</p>
                <h2 className="mt-3 text-3xl font-semibold text-[#1f1d1b] sm:text-4xl">
                  A disciplined view across properties, loans, taxes, and documents.
                </h2>
              </div>
              <ShieldCheck className="h-10 w-10 text-[#ef7d22]" />
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <PalmPanel key={feature.title} className="p-5">
                  <feature.icon className="h-6 w-6 text-[#c46219]" />
                  <h3 className="mt-4 text-base font-semibold text-[#1f1d1b]">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#625b52]">{feature.body}</p>
                </PalmPanel>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#b65e19]">Owner mode</p>
            <h2 className="mt-3 text-3xl font-semibold text-[#1f1d1b] sm:text-4xl">
              The quick answer to how your rentals are actually doing.
            </h2>
            <p className="mt-5 text-base leading-7 text-[#625b52]">
              Use it after tax uploads, loan updates, new purchases, rent changes, or before financing and sell-hold
              decisions.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {checks.map((check) => (
              <PalmPanel key={check} className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[#ef7d22]" />
                <span className="text-sm font-medium text-[#4d4740]">{check}</span>
              </PalmPanel>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="rounded-lg bg-[#2f2c29] px-6 py-8 text-white shadow-[0_18px_45px_rgba(47,44,41,0.22)] sm:px-8 lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#f6a64b]">Ready when the portfolio gets serious.</p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Turn rental data into decisions.</h2>
            </div>
            <Link
              to={primaryHref}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#2f2c29] hover:bg-[#fff4e5] lg:mt-0"
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
