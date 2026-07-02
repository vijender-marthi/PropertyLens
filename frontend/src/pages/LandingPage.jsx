import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeDollarSign,
  BarChart3,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Gauge,
  Landmark,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import BrandLogo from '../components/BrandLogo'
import heroImage from '../assets/propertylens-hero.png'

const metrics = [
  { label: 'Cash flow', value: '$18.6K', note: '+8.1% MoM', accent: 'text-emerald-600' },
  { label: 'Equity', value: '$3.8M', note: '12 properties', accent: 'text-sky-600' },
  { label: 'Debt risk', value: 'Low', note: '2 ARMs', accent: 'text-amber-600' },
]

const features = [
  {
    icon: BarChart3,
    title: 'Portfolio pulse',
    body: 'Cash flow, NOI, DSCR, cap rate, LTV, equity, and value movement across every rental.',
  },
  {
    icon: Landmark,
    title: 'Debt clarity',
    body: 'Track loan balances, escrow, interest, ARM exposure, principal paydown, and refinance history.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Tax-year story',
    body: 'Connect rent, expenses, interest, depreciation, 1098s, and Schedule E into yearly views.',
  },
  {
    icon: UploadCloud,
    title: 'Document assisted',
    body: 'Upload statements and tax documents so the portfolio view gets richer over time.',
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

function HeroPreview() {
  return (
    <div className="relative">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
        <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
          <img
            src={heroImage}
            alt="PropertyLens analytics workspace preview"
            className="h-56 w-full object-cover object-[62%_42%] sm:h-72 lg:h-80"
          />
        </div>
        <div className="grid gap-3 pt-3 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{metric.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">{metric.value}</p>
              <p className={`mt-1 text-xs font-semibold ${metric.accent}`}>{metric.note}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute -bottom-5 left-5 hidden rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg dark:border-slate-800 dark:bg-slate-900 sm:block">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-slate-900 dark:text-white">Financial health: strong</span>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const primaryHref = user ? '/dashboard' : '/register'
  const primaryLabel = user ? 'Open dashboard' : 'Start tracking'

  return (
    <div className="min-h-screen bg-[#f6f7f4] text-slate-950 dark:bg-slate-950 dark:text-white">
      <header className="border-b border-slate-200/80 bg-[#f6f7f4]/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/">
            <BrandLogo markClassName="h-10 w-10" textClassName="text-base text-slate-950 dark:text-white" subtitleClassName="text-slate-500 dark:text-slate-400" />
          </Link>
          <div className="flex items-center gap-2">
            {!user && (
              <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900">
                Sign in
              </Link>
            )}
            <Link to={primaryHref} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200">
              <Sparkles className="h-4 w-4" />
              Rental property insights without spreadsheet chaos
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">
              See every rental like an asset manager.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
              PropertyLens gives owners a clean read on cash flow, equity, debt, taxes, and risk across the portfolio,
              so every property has a financial signal, not just a file folder.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to={primaryHref} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800">
                View portfolio
              </Link>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
              {['Cash flow', 'Debt', 'Tax years'].map((item) => (
                <div key={item} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <HeroPreview />
        </section>

        <section className="border-y border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300">What it watches</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white sm:text-4xl">
                  Financial health across properties, loans, taxes, and documents.
                </h2>
              </div>
              <BadgeDollarSign className="h-10 w-10 text-emerald-600" />
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <div key={feature.title} className="rounded-lg border border-slate-200 bg-[#f6f7f4] p-5 dark:border-slate-800 dark:bg-slate-950">
                  <feature.icon className="h-6 w-6 text-teal-700 dark:text-teal-300" />
                  <h3 className="mt-4 text-base font-semibold text-slate-950 dark:text-white">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700 dark:text-rose-300">Owner mode</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white sm:text-4xl">
              The quick answer to “how are my rentals actually doing?”
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
              Use it after tax uploads, loan updates, new purchases, rent changes, or whenever you need the full portfolio
              picture before making a financing or sell/hold decision.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {checks.map((check) => (
              <div key={check} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{check}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
          <div className="rounded-lg bg-slate-950 px-6 py-8 text-white sm:px-8 lg:flex lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-300">Ready when your portfolio gets real.</p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Turn rental data into decisions.</h2>
            </div>
            <Link to={primaryHref} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-100 lg:mt-0">
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
