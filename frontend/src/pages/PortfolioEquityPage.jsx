import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import PageContainer from '../components/PageContainer'
import PortfolioEquityDashboard, { PropertyFilter, HomeTimeline } from '../components/PortfolioEquityDashboard'
import { propAPI } from '../services/api'

export default function PortfolioEquityPage() {
  const [data, setData] = useState(null)
  const [available, setAvailable] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const initialized = useRef(false)

  const selectedKey = useMemo(() => Array.from(selectedIds).sort((a, b) => a - b).join(','), [selectedIds])

  useEffect(() => {
    let active = true
    setLoading(true)
    propAPI.portfolioEquityCashflow({
      selected_property_ids: initialized.current ? selectedKey : '',
      selection_explicit: initialized.current,
    })
      .then((res) => {
        if (!active) return
        setData(res.data)
        setAvailable(res.data?.availableProperties || [])
        if (!initialized.current) {
          initialized.current = true
          setSelectedIds(new Set((res.data?.availableProperties || []).map((p) => p.id)))
        }
      })
      .catch(() => { if (active) toast.error('Failed to load portfolio equity dashboard') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedKey])

  if ((loading && !data) || !data?.totals) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>
      </PageContainer>
    )
  }

  const selectedNames = available.filter((p) => selectedIds.has(p.id)).map((p) => p.name)
  const allSelected = available.length > 0 && selectedNames.length === available.length

  const headerRight = (
    <div className="flex flex-col items-start gap-1.5 lg:items-end">
      <PropertyFilter properties={available} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />
      {selectedNames.length && !allSelected
        ? <p className="max-w-xs text-xs text-gray-500 dark:text-gray-400 lg:max-w-md lg:text-right">{selectedNames.join(', ')}</p>
        : null}
    </div>
  )

  const timeline = (
    <HomeTimeline
      rows={available}
      selectedIds={selectedIds}
      onSelect={(home, additive) => setSelectedIds((cur) => {
        if (additive) {
          const next = new Set(cur)
          if (next.has(home.id)) next.delete(home.id); else next.add(home.id)
          return next.size ? next : new Set(available.map((p) => p.id))
        }
        return cur.size === 1 && cur.has(home.id)
          ? new Set(available.map((p) => p.id))
          : new Set([home.id])
      })}
    />
  )

  return (
    <PortfolioEquityDashboard data={data} title="Portfolio" headerRight={headerRight} timeline={timeline} />
  )
}
