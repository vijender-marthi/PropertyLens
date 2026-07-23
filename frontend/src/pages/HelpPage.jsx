import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BookOpen,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSearch,
  Filter,
  Search,
  X,
} from 'lucide-react'
import { helpAPI } from '../services/api'

const RELATED_PAGE_PATHS = {
  summary: '/properties',
  loans: '/properties',
  rental: '/properties',
  expenses: '/properties',
  taxes: '/properties',
  depreciation: '/properties',
  scenarios: '/properties',
  portfolio: '/dashboard',
  documents: '/uploads',
  reconciliation: '/properties',
  conventions: '/help?page=conventions',
}

const SOURCE_LABELS = {
  reported: 'Reported',
  calculated: 'Calculated',
  derived: 'Derived',
  projected: 'Projected',
  estimated: 'Estimated',
  manual: 'Manual',
  mixed: 'Mixed',
}

function sourceLabel(value) {
  return SOURCE_LABELS[value] || value || 'Mixed'
}

function pageLabel(pages, pageKey) {
  return pages.find((page) => page.pageKey === pageKey)?.label || pageKey
}

function formulaText(formula) {
  return [
    formula.name,
    formula.shortDefinition,
    '',
    'Formula:',
    ...(formula.formulaLines || [formula.formula]).filter(Boolean),
  ].join('\n')
}

function SourceBadge({ sourceType }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {sourceLabel(sourceType)}
    </span>
  )
}

function HelpNavigation({ pages, activePage, onSelect }) {
  return (
    <aside className="lg:w-64 shrink-0">
      <nav className="lg:sticky lg:top-4 space-y-1" aria-label="Help sections">
        {pages.map((page) => (
          <button
            key={page.pageKey}
            type="button"
            onClick={() => onSelect(page.pageKey)}
            className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              activePage === page.pageKey
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
            }`}
            aria-current={activePage === page.pageKey ? 'page' : undefined}
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <span>{page.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

function HelpSearch({
  query,
  onQueryChange,
  section,
  onSectionChange,
  sourceType,
  onSourceTypeChange,
  sections,
  sourceTypes,
}) {
  return (
    <div className="card border border-gray-100 dark:border-gray-700">
      <div className="grid gap-3 lg:grid-cols-[1fr_220px_200px]">
        <label className="relative block">
          <span className="sr-only">Search formulas and metrics</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search formulas and metrics"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:ring-blue-950"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <label className="relative block">
          <span className="sr-only">Filter by metric category</span>
          <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={section}
            onChange={(event) => onSectionChange(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:ring-blue-950"
          >
            <option value="">All categories</option>
            {sections.map((sectionKey) => (
              <option key={sectionKey} value={sectionKey}>
                {sectionKey.replaceAll('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Filter by source type</span>
          <select
            value={sourceType}
            onChange={(event) => onSourceTypeChange(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:ring-blue-950"
          >
            <option value="">All source types</option>
            {sourceTypes.map((type) => (
              <option key={type} value={type}>
                {sourceLabel(type)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function FormulaDefinitionCard({ formula, pages }) {
  const [showExample, setShowExample] = useState(Boolean(formula.example))
  const [copied, setCopied] = useState(false)
  const relatedPath = RELATED_PAGE_PATHS[formula.pageKey] || '/help'

  const copyFormula = useCallback(async () => {
    await navigator.clipboard.writeText(formulaText(formula))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }, [formula])

  return (
    <article className="card border border-gray-100 dark:border-gray-700" id={formula.metricKey}>
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SourceBadge sourceType={formula.sourceType} />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {pageLabel(pages, formula.pageKey)} · {formula.sectionKey?.replaceAll('-', ' ')}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{formula.name}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{formula.shortDefinition}</p>
          {formula.detailedDefinition ? (
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{formula.detailedDefinition}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={copyFormula}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy formula'}
          </button>
          <Link
            to={relatedPath}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open related page
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Formula</h3>
          <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 font-mono text-sm leading-6 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
            {(formula.formulaLines || [formula.formula]).filter(Boolean).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Inputs used</h3>
          <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-700 dark:border-gray-700">
            {(formula.inputDefinitions || []).map((input) => (
              <div key={input.key} className="grid gap-1 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{input.label}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{input.dataType}</span>
                </div>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{input.definition}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {formula.sourcePriority?.length ? (
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Source priority</h3>
            <ol className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
              {formula.sourcePriority.map((source, index) => (
                <li key={source} className="flex gap-2">
                  <span className="text-gray-400">{index + 1}.</span>
                  <span>{source}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Calculation frequency</h3>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{formula.calculationFrequency || 'Backend-owned'}</p>
          {formula.displayFormat ? (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Display: {formula.displayFormat}</p>
          ) : null}
        </section>
      </div>

      {formula.example ? (
        <section className="mt-4">
          <button
            type="button"
            onClick={() => setShowExample((value) => !value)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200"
            aria-expanded={showExample}
          >
            {showExample ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Show calculation example
          </button>
          {showExample ? (
            <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
              {formula.example.inputs?.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {formula.example.inputs.map((input) => (
                    <span key={`${input.label}-${input.display}`} className="rounded-md bg-white px-2 py-1 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                      {input.label}: <span className="font-semibold">{input.display}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="text-sm text-gray-700 dark:text-gray-200">{formula.example.computation}</p>
              <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{formula.example.result}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {formula.assumptions?.length || formula.exclusions?.length || formula.relatedMetricKeys?.length ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {formula.assumptions?.length ? (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Limitations or assumptions</h3>
              <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                {formula.assumptions.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </section>
          ) : null}
          {formula.exclusions?.length ? (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Not included</h3>
              <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                {formula.exclusions.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </section>
          ) : null}
          {formula.relatedMetricKeys?.length ? (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Related metrics</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {formula.relatedMetricKeys.map((key) => (
                  <a key={key} href={`#${key}`} className="rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                    {key}
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function GettingStarted({ audit }) {
  return (
    <div className="space-y-4">
      <div className="card border border-gray-100 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Backend-owned formula catalog</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              PropertyLens formulas are returned by the backend catalog. This Help Center renders definitions, source precedence, assumptions, examples, and related metric keys without calculating financial values in the browser.
            </p>
          </div>
        </div>
      </div>
      <div className="card border border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Formula audit summary</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          The audit identifies documentation drift and known standards debt without changing historical values.
        </p>
        <div className="mt-4 space-y-3">
          {(audit || []).map((item) => (
            <div key={item.metric} className="rounded-lg border border-gray-100 p-3 dark:border-gray-700">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{item.metric}</h3>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Risk: {item.risk}</span>
              </div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{item.difference}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.recommendedFix}</p>
            </div>
          ))}
        </div>
        <Link to="/help?page=summary" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-300">
          Start with Property Summary <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function FormulaTable({ formulas }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
              <th className="px-4 py-2.5">Metric</th>
              <th className="px-4 py-2.5">Formula</th>
              <th className="px-4 py-2.5">Definition</th>
            </tr>
          </thead>
          <tbody>
            {formulas.map((formula) => {
              const lines = (formula.formulaLines?.length ? formula.formulaLines : [formula.formula]).filter(Boolean)
              return (
                <tr key={formula.metricKey} className="border-b border-gray-100 align-top last:border-0 dark:border-gray-800">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {formula.name || formula.metricKey}
                    {formula.sectionKey ? <div className="mt-0.5 text-[11px] font-normal capitalize text-gray-400 dark:text-gray-500">{formula.sectionKey.replaceAll('-', ' ')}</div> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] leading-relaxed text-gray-700 dark:text-gray-200">
                    {lines.length ? lines.map((line, index) => <div key={index}>{line}</div>) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{formula.shortDefinition || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function HelpPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialPage = searchParams.get('page') || 'getting-started'
  const [activePage, setActivePage] = useState(initialPage)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [viewMode, setViewMode] = useState('table')
  const [catalog, setCatalog] = useState({ pages: [], formulas: [], audit: [], sourceTypes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const nextPage = searchParams.get('page') || 'getting-started'
    setActivePage(nextPage)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    async function loadCatalog() {
      setLoading(true)
      setError('')
      try {
        const params = {}
        if (activePage && activePage !== 'getting-started') params.page = activePage
        if (section) params.section = section
        if (sourceType) params.sourceType = sourceType
        if (query.trim()) params.q = query.trim()
        const response = await helpAPI.formulas(params)
        if (!cancelled) setCatalog(response.data || { pages: [], formulas: [], audit: [], sourceTypes: [] })
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.detail || 'Formula catalog is unavailable.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadCatalog()
    return () => {
      cancelled = true
    }
  }, [activePage, query, section, sourceType])

  const pages = useMemo(() => catalog.pages || [], [catalog.pages])
  const visibleFormulas = catalog.formulas || []
  const availableSections = useMemo(
    () => [...new Set(visibleFormulas.map((formula) => formula.sectionKey).filter(Boolean))].sort(),
    [visibleFormulas]
  )

  const selectPage = (pageKey) => {
    setSection('')
    setSearchParams(pageKey === 'getting-started' ? {} : { page: pageKey })
  }

  const activePageMeta = pages.find((page) => page.pageKey === activePage)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
            <BookOpen className="h-4 w-4" />
            PropertyLens Help
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Formula and metric catalog</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
            Search every metric definition, formula, input, source priority, assumption, and limitation supplied by the backend catalog.
          </p>
        </div>
        <Link
          to="/help?page=documents"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <FileSearch className="h-4 w-4" />
          Data sources
        </Link>
      </header>

      <HelpSearch
        query={query}
        onQueryChange={setQuery}
        section={section}
        onSectionChange={setSection}
        sourceType={sourceType}
        onSourceTypeChange={setSourceType}
        sections={availableSections}
        sourceTypes={catalog.sourceTypes || []}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <HelpNavigation pages={pages} activePage={activePage} onSelect={selectPage} />
        <main className="min-w-0 flex-1">
          {activePage === 'getting-started' && !query && !section && !sourceType ? (
            <GettingStarted audit={catalog.audit} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {activePageMeta?.label || pageLabel(pages, activePage)}
                  </h2>
                  {activePageMeta?.description ? (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{activePageMeta.description}</p>
                  ) : null}
                </div>
                {visibleFormulas.length ? (
                  <div className="flex shrink-0 rounded-lg border border-gray-200 p-0.5 text-xs dark:border-gray-700" role="group" aria-label="View mode">
                    {['table', 'cards'].map((mode) => (
                      <button key={mode} type="button" onClick={() => setViewMode(mode)} aria-pressed={viewMode === mode}
                        className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${
                          viewMode === mode ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}>
                        {mode}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {loading ? (
                <div className="card border border-gray-100 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  Loading formula catalog…
                </div>
              ) : error ? (
                <div className="card border border-red-100 bg-red-50 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              ) : visibleFormulas.length === 0 ? (
                <div className="card border border-gray-100 py-10 text-center dark:border-gray-700">
                  <Search className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">No formulas found</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Try a different page, category, source type, or search term.</p>
                </div>
              ) : viewMode === 'table' ? (
                <FormulaTable formulas={visibleFormulas} />
              ) : (
                visibleFormulas.map((formula) => (
                  <FormulaDefinitionCard key={formula.metricKey} formula={formula} pages={pages} />
                ))
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
