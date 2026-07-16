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
import { landingCssVars } from '../utils/landingTokens'

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
<header className="border-b border-[var(--landing-header-border)] bg-[var(--landing-header-bg)] backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" aria-label="PropertyLens home">
          <BrandLogo
            markClassName="h-10 w-10"
            textClassName="text-base text-[var(--landing-logo-text)]"
            subtitleClassName="text-[var(--landing-logo-subtitle)]"
          />
        </Link>
        <div className="flex items-center gap-2">
          {!user && (
            <Link
              to="/login"
className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--landing-link-text)] hover:bg-white/70"
            >
              Sign in
            </Link>
          )}
          <Link
            to={primaryHref}
className="inline-flex items-center gap-2 rounded-lg bg-[var(--landing-dark)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[var(--landing-dark-hover)]"
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
<div className={`rounded-lg border border-[var(--landing-panel-border)] bg-[var(--landing-panel-bg)] shadow-[var(--landing-panel-shadow)] ${className}`}>
      {children}
    </div>
  )
}

function PortfolioPreview() {
  return (
    <PalmPanel className="p-3">
      <div className="grid gap-3 lg:grid-cols-[0.72fr_1fr]">
        <div className="rounded-lg bg-[var(--landing-preview-dark)] p-4 text-white shadow-inner">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--landing-gold)]">Portfolio readout</p>
              <p className="mt-1 text-sm text-white/70">Current operating view</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-[var(--landing-gold)]" />
          </div>
          <div className="mt-4 space-y-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-white/10 bg-[var(--landing-preview-card)] p-4">
                <p className="text-xs font-medium text-white/58">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
                <p className="mt-1 text-xs font-semibold text-[var(--landing-gold)]">{metric.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--landing-preview-border)] bg-[var(--landing-preview-bg)]">
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
<div className="min-h-screen bg-[var(--landing-page-bg)] text-[var(--landing-page-text)]" style={landingCssVars}>
      <Header primaryHref={primaryHref} primaryLabel={primaryLabel} user={user} />

      <main>
        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
<p className="inline-flex items-center rounded-lg border border-[var(--landing-accent-border)] bg-[var(--landing-accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--landing-accent-text)]">
              Rental property financial intelligence
            </p>
<h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-[var(--landing-heading)] sm:text-5xl lg:text-6xl">
              See the financial health of every rental.
            </h1>
<p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--landing-muted-text)]">
              PropertyLens organizes rent, debt, tax, valuation, and document data into a calm operating view for
              rental-property owners.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to={primaryHref}
className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--landing-accent)] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[var(--landing-accent-hover)]"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
className="inline-flex items-center justify-center rounded-lg border border-[var(--landing-secondary-border)] bg-[var(--landing-secondary-bg)] px-5 py-3 text-sm font-semibold text-[var(--landing-secondary-text)] hover:bg-white"
              >
                View portfolio
              </Link>
            </div>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {['Cash flow', 'Debt', 'Taxes'].map((item) => (
<PalmPanel key={item} className="px-3 py-3 text-sm font-semibold text-[var(--landing-chip-text)]">
                  {item}
                </PalmPanel>
              ))}
            </div>
          </div>

          <PortfolioPreview />
        </section>

<section className="border-y border-[var(--landing-section-border)] bg-[var(--landing-section-bg)] py-16">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div className="max-w-2xl">
<p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--landing-accent-muted)]">What it monitors</p>
<h2 className="mt-3 text-3xl font-semibold text-[var(--landing-heading)] sm:text-4xl">
                  A disciplined view across properties, loans, taxes, and documents.
                </h2>
              </div>
<ShieldCheck className="h-10 w-10 text-[var(--landing-accent)]" />
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <PalmPanel key={feature.title} className="p-5">
                  <feature.icon className="h-6 w-6 text-[var(--landing-accent-deep)]" />
                  <h3 className="mt-4 text-base font-semibold text-[var(--landing-heading)]">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--landing-muted-text)]">{feature.body}</p>
                </PalmPanel>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
          <div>
<p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--landing-accent-muted)]">Owner mode</p>
<h2 className="mt-3 text-3xl font-semibold text-[var(--landing-heading)] sm:text-4xl">
              The quick answer to how your rentals are actually doing.
            </h2>
<p className="mt-5 text-base leading-7 text-[var(--landing-muted-text)]">
              Use it after tax uploads, loan updates, new purchases, rent changes, or before financing and sell-hold
              decisions.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {checks.map((check) => (
              <PalmPanel key={check} className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--landing-accent)]" />
                <span className="text-sm font-medium text-[var(--landing-check-text)]">{check}</span>
              </PalmPanel>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="rounded-lg bg-[var(--landing-dark)] px-6 py-8 text-white shadow-[var(--landing-cta-shadow)] sm:px-8 lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--landing-gold)]">Ready when the portfolio gets serious.</p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Turn rental data into decisions.</h2>
            </div>
            <Link
              to={primaryHref}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[var(--landing-dark)] hover:bg-[var(--landing-accent-soft)] lg:mt-0"
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
