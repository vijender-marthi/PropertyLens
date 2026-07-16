import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle,
  Download,
  FileText,
  Landmark,
  PiggyBank,
  Printer,
  Shield,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import PageContainer from '../components/PageContainer'
import DataTable from '../components/DataTable'
import { docAPI, propAPI } from '../services/api'
import { REPORT_CALLOUT_THEMES, REPORT_SECTION_THEMES, REPORT_STATUS_BADGES } from '../config/reportTheme'

const iconMap = {
  'trending-up': TrendingUp,
  'piggy-bank': PiggyBank,
  landmark: Landmark,
}

const severityClass = {
  critical: 'border-red-200 bg-red-50 text-red-950',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  info: 'border-blue-200 bg-blue-50 text-blue-950',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-950',
}

const storyThemeById = {
  'cash-flow-story': 'cashFlow',
  'wealth-creation-story': 'wealth',
  'debt-financing-story': 'debt',
  'tax-benefits-story': 'tax',
}

function metricDisplay(metric) {
  return metric?.display ?? metric?.fullDisplay ?? '—'
}

function tableColumns(table) {
  return (table?.columns || []).map((column) => ({
    id: column,
    header: column,
    accessor: column,
    sortable: false,
  }))
}

function tableRows(table) {
  return (table?.rows || []).map((row, index) => ({
    ...row,
    __rowKey: `${table.id}-${index}`,
  }))
}

function sectionTheme(theme) {
  return REPORT_SECTION_THEMES[theme] || REPORT_SECTION_THEMES.neutral
}

function ReportSection({ id, icon: Icon, eyebrow, title, question, theme = 'neutral', children }) {
  const styles = sectionTheme(theme)
  return (
    <section id={id} className={`break-inside-avoid rounded-xl border p-5 pb-6 ${styles.surface} ${styles.border}`}>
      <div className={`mb-5 h-1 w-20 rounded-full ${styles.accent}`} />
      <div className="mb-5 flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${styles.icon}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          {eyebrow ? <p className={`text-xs font-semibold uppercase tracking-wide ${styles.eyebrow}`}>{eyebrow}</p> : null}
          <h2 className="text-xl font-semibold text-gray-950">{title}</h2>
          {question ? <p className="mt-1 text-sm text-gray-500">{question}</p> : null}
        </div>
      </div>
      {children}
    </section>
  )
}

function CalloutBox({ type = 'insight', children }) {
  const styles = REPORT_CALLOUT_THEMES[type] || REPORT_CALLOUT_THEMES.insight
  const Icon = type === 'good' ? CheckCircle : AlertCircle
  return (
    <div className={`rounded-lg border p-4 ${styles.surface} ${styles.border} ${styles.text}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.icon}`} aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{styles.label}</p>
          <div className="mt-1 text-sm leading-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ metric }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{metric?.label || 'Metric'}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-950">{metricDisplay(metric)}</p>
      {metric?.description ? <p className="mt-2 text-xs text-gray-500">{metric.description}</p> : null}
      {metric?.asOfDate ? <p className="mt-2 text-xs text-gray-400">As of {metric.asOfDate}</p> : null}
    </div>
  )
}

function ScorecardItem({ item }) {
  const className = severityClass[item.status] || severityClass.info
  const Icon = item.status === 'ok' ? CheckCircle : AlertCircle
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <p className="text-sm font-semibold">{item.label}</p>
      </div>
      <p className="mt-2 text-lg font-semibold">{item.display}</p>
      <p className="mt-1 text-sm opacity-80">{item.description}</p>
    </div>
  )
}

function HighlightCard({ item }) {
  const Icon = iconMap[item.icon] || TrendingUp
  return (
 <div className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
 <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.headline}</p>
 <h3 className="mt-1 font-semibold text-gray-950">{item.title}</h3>
        </div>
      </div>
 {item.metric ? <p className="mt-4 text-2xl font-semibold text-gray-950">{metricDisplay(item.metric)}</p> : null}
 <p className="mt-2 text-sm text-gray-600">{item.summary}</p>
      {item.cta?.href ? (
 <Link className="mt-4 inline-flex text-sm font-semibold text-blue-700" to={item.cta.href}>
          {item.cta.label}
        </Link>
      ) : null}
    </div>
  )
}

function RiskCard({ item }) {
  const className = severityClass[item.severity] || severityClass.info
  return (
    <div className={`rounded-lg border p-5 ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{item.severity || 'review'}</p>
      <h3 className="mt-2 text-lg font-semibold">{item.issue}</h3>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Impact</dt>
          <dd className="opacity-85">{item.financialImpact || '—'}</dd>
        </div>
        <div>
          <dt className="font-semibold">Confidence</dt>
          <dd className="opacity-85">{item.confidence || '—'}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm opacity-90">{item.whyItMatters}</p>
      <p className="mt-3 text-sm font-semibold">Recommended next step: {item.recommendation}</p>
      {item.cta?.href ? (
        <Link className="mt-4 inline-flex text-sm font-semibold underline-offset-4 hover:underline" to={item.cta.href}>
          {item.cta.label}
        </Link>
      ) : null}
    </div>
  )
}

function StoryPanel({ section }) {
  const story = section.story || {}
  return (
    <ReportSection id={section.id} icon={BookOpen} eyebrow="Portfolio Story" title={section.title} question={section.question} theme={storyThemeById[section.id] || 'neutral'}>
 <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
 <h3 className="text-lg font-semibold text-gray-950">{story.title || section.title}</h3>
 <p className="mt-2 text-sm leading-6 text-gray-600">{story.explanation || 'Backend story unavailable.'}</p>
          </div>
          {story.link?.href ? (
            <Link className="btn-secondary shrink-0 text-sm" to={story.link.href}>
              {story.link.label}
            </Link>
          ) : null}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(story.metrics || []).map((metric) => <MetricCard key={metric.key || metric.label} metric={metric} />)}
        </div>
      </div>
    </ReportSection>
  )
}

function UploadedReportCard({ doc, onDelete }) {
  return (
 <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex min-w-0 items-center gap-3">
        <FileText className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
        <div className="min-w-0">
 <p className="truncate text-sm font-medium text-gray-900">{doc.filename}</p>
 <p className="text-xs text-gray-500">{doc.document_type || 'Report'}</p>
        </div>
      </div>
      <button type="button" className="rounded-md p-1 text-gray-400 hover:text-red-600 print:hidden" onClick={() => onDelete(doc.id)} aria-label={`Delete ${doc.filename}`}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState(null)
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    Promise.all([propAPI.dashboard(), docAPI.listAll()])
      .then(([dashboardResponse, docsResponse]) => {
        setReport(dashboardResponse.data?.portfolio_report || null)
        setDocs((docsResponse.data || []).filter((doc) => doc.content_type === 'application/pdf' || doc.filename?.endsWith('.pdf')))
      })
      .catch(() => toast.error('Failed to load report'))
      .finally(() => setLoading(false))
  }, [])

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await docAPI.upload(form)
      setDocs((current) => [response.data, ...current])
      toast.success('Report uploaded')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDeleteDoc = async (id) => {
    if (!confirm('Delete report?')) return
    await docAPI.delete(id)
    setDocs((current) => current.filter((doc) => doc.id !== id))
    toast.success('Deleted')
  }

  const exportXLSX = () => {
    if (!report?.appendix?.tables?.length) return
    const workbook = XLSX.utils.book_new()
    report.appendix.tables.forEach((table) => {
      const worksheet = XLSX.utils.json_to_sheet(table.rows || [])
      XLSX.utils.book_append_sheet(workbook, worksheet, table.title.slice(0, 31))
    })
    XLSX.writeFile(workbook, `PropertyLens_Portfolio_Report_${report.cover?.asOfDate || 'export'}.xlsx`)
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </PageContainer>
    )
  }

  if (!report) {
    return (
      <PageContainer>
 <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center text-amber-900">
          <AlertCircle className="mx-auto h-8 w-8" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">Portfolio report unavailable</h1>
          <p className="mt-1 text-sm">The backend report view model could not be loaded.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 print:hidden sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Portfolio Report</h1>
          <p className="mt-1 text-sm text-gray-500">Professional investment report generated from backend-owned metrics and narratives.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={exportXLSX}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export XLSX
          </button>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print / Save PDF
          </button>
        </div>
      </div>

 <div className="space-y-10 rounded-xl border border-slate-200 bg-slate-50 p-6 shadow-sm print:border-0 print:bg-white print:p-0 print:shadow-none">
 <section className="break-after-page rounded-xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-8 text-slate-950 print:min-h-screen print:border-0 print:bg-white">
<p className="text-sm font-semibold uppercase tracking-wide text-blue-700 print:text-gray-500">PropertyLens</p>
<h2 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950">{report.cover?.title}</h2>
<p className="mt-4 max-w-2xl text-lg text-slate-600 print:text-gray-600">{report.cover?.subtitle}</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard metric={report.executiveSummary?.primaryMetric} />
            {(report.executiveSummary?.supportingMetrics || []).slice(0, 3).map((metric) => <MetricCard key={metric.key} metric={metric} />)}
          </div>
<dl className="mt-10 grid gap-4 text-sm text-slate-600 print:text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-semibold text-slate-950 print:text-gray-950">Prepared for</dt>
              <dd>{report.cover?.preparedFor}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-950 print:text-gray-950">As of date</dt>
              <dd>{report.cover?.asOfDate}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-950 print:text-gray-950">Last refreshed</dt>
              <dd>{report.cover?.lastRefresh || '—'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-950 print:text-gray-950">Data quality</dt>
              <dd>{report.cover?.dataQuality}</dd>
            </div>
          </dl>
        </section>

        <ReportSection id="executive-summary" icon={FileText} eyebrow="1" title="Executive Summary" theme="executive">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-xl font-semibold text-gray-950">{report.executiveSummary?.headline}</h3>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-600">{report.executiveSummary?.summary}</p>
          </div>
          <div className="mt-4">
            <CalloutBox type="insight">All values, narrative, priorities, and recommendations in this report come from the backend portfolio report contract.</CalloutBox>
          </div>
        </ReportSection>

        <ReportSection id="portfolio-scorecard" icon={Shield} eyebrow="2" title="Portfolio Scorecard" theme="neutral">
          <div className="grid gap-4 lg:grid-cols-3">
            {(report.scorecard || []).map((item) => <ScorecardItem key={item.key} item={item} />)}
          </div>
        </ReportSection>

        <ReportSection id="portfolio-snapshot" icon={BarChart3} eyebrow="3" title="Portfolio Snapshot" theme="neutral">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(report.snapshot?.metrics || []).map((metric) => <MetricCard key={metric.key} metric={metric} />)}
          </div>
        </ReportSection>

        <ReportSection id="performance-highlights" icon={TrendingUp} eyebrow="4" title="Performance Highlights" question="What is going well?" theme="wealth">
          <div className="grid gap-4 lg:grid-cols-3">
            {(report.performanceHighlights || []).map((item) => <HighlightCard key={item.id} item={item} />)}
          </div>
          <div className="mt-4">
            <CalloutBox type="good">These highlights identify the strongest backend-reported contributors to portfolio performance.</CalloutBox>
          </div>
        </ReportSection>

        <ReportSection id="risks" icon={AlertCircle} eyebrow="5" title="Risks & Areas for Improvement" question="What deserves attention?" theme="risk">
          {(report.risks || []).length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {report.risks.map((item) => <RiskCard key={item.id} item={item} />)}
            </div>
          ) : (
            <CalloutBox type="good">No backend-prioritized risks are currently in the report.</CalloutBox>
          )}
        </ReportSection>

        {(report.stories || []).map((section) => <StoryPanel key={section.id} section={section} />)}

        <ReportSection id="property-performance" icon={Building2} eyebrow="10" title="Property-by-Property Performance" theme="neutral">
          <div className="grid gap-4 lg:grid-cols-2">
            {(report.properties || []).map((property) => (
 <div key={property.id || property.name} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
 <h3 className="font-semibold text-gray-950">{property.name}</h3>
                    <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${REPORT_STATUS_BADGES[property.healthBadge] || REPORT_STATUS_BADGES.Monitor}`}>{property.healthBadge}</span>
                  </div>
 {property.cta?.href ? <Link className="text-sm font-semibold text-blue-700" to={property.cta.href}>{property.cta.label}</Link> : null}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MetricCard metric={{ label: 'Cash Flow', ...property.cashFlowBadge }} />
                  <MetricCard metric={{ label: 'Equity', ...property.equityBadge }} />
                  <MetricCard metric={{ label: 'LTV', ...property.ltv }} />
                  <MetricCard metric={{ label: 'DSCR', ...property.dscr }} />
                </div>
 <p className="mt-4 text-sm font-semibold text-gray-700">Recommendation: {property.recommendation}</p>
 <p className="mt-1 text-xs text-gray-500">Data health: {property.dataHealth}</p>
              </div>
            ))}
          </div>
        </ReportSection>

        <ReportSection id="recommended-next-steps" icon={CheckCircle} eyebrow="11" title="Recommended Next Steps" question="What should be done next?" theme="recommendations">
          <div className="mb-4">
            <CalloutBox type="action">Recommended next steps are ordered by backend priority and should be reviewed before making new portfolio decisions.</CalloutBox>
          </div>
          <div className="space-y-3">
            {(report.recommendedNextSteps || []).map((item) => <RiskCard key={item.id} item={item} />)}
          </div>
        </ReportSection>

        <ReportSection id="appendix" icon={Landmark} eyebrow="12" title="Supporting Financial Tables" theme="neutral">
          <div className="space-y-8">
            {(report.appendix?.tables || []).map((table) => (
              <div key={table.id} className="space-y-3">
 <h3 className="font-semibold text-gray-950">{table.title}</h3>
                <DataTable columns={tableColumns(table)} rows={tableRows(table)} getRowKey={(row) => row.__rowKey} emptyMessage="No backend rows available." />
              </div>
            ))}
          </div>
        </ReportSection>

        <ReportSection id="uploaded-reports" icon={Upload} eyebrow="Appendix" title="Uploaded Reports" theme="neutral">
 <div className="rounded-lg border border-dashed border-gray-300 p-5 print:hidden">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
 <p className="font-semibold text-gray-950">Attach supporting reports</p>
 <p className="text-sm text-gray-500">Tax returns, appraisals, mortgage statements, or property reports.</p>
              </div>
              <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? 'Uploading...' : 'Upload PDF'}
                <input ref={fileRef} type="file" className="hidden" accept="application/pdf" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {docs.length ? docs.map((doc) => <UploadedReportCard key={doc.id} doc={doc} onDelete={handleDeleteDoc} />) : (
 <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">No uploaded reports yet.</p>
            )}
          </div>
        </ReportSection>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>
    </PageContainer>
  )
}
