import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HomeTimeline } from './PortfolioEquityDashboard'
import { propAPI } from '../services/api'

// Page-level acquisition timeline for the property detail view: this property is
// highlighted, the rest are dimmed; clicking another home opens it. Shown across
// all tabs.
export default function PropertyTimelineBar({ propId, tabPath }) {
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
    <HomeTimeline
      rows={available}
      selectedIds={new Set([currentId])}
      hint="This property is highlighted · click another to open it"
      onSelect={(home) => {
        if (home.id === currentId) return
        // Keep the current tab when switching properties.
        navigate(tabPath ? `/properties/${home.id}/${tabPath}` : `/properties/${home.id}`)
      }}
    />
  )
}
