import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HomeTimeline } from './PortfolioEquityDashboard'
import { propAPI } from '../services/api'

// Page-level acquisition timeline for the property detail view: this property is
// highlighted, the rest are dimmed; clicking another home opens it. Shown across
// all tabs.
export default function PropertyTimelineBar({ propId }) {
  const [available, setAvailable] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    propAPI.portfolioEquityCashflow({ selected_property_ids: String(propId), selection_explicit: true })
      .then((res) => { if (active) setAvailable(res.data?.availableProperties || []) })
      .catch(() => { /* timeline is non-critical */ })
    return () => { active = false }
  }, [propId])

  if (available.length <= 1) return null
  const currentId = Number(propId)

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <HomeTimeline
        rows={available}
        selectedIds={new Set([currentId])}
        hint="This property is highlighted · click another to open it"
        onSelect={(home) => { if (home.id !== currentId) navigate(`/properties/${home.id}`) }}
      />
    </div>
  )
}
