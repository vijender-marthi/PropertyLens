import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import PortfolioEquityDashboard, { HomeTimeline } from './PortfolioEquityDashboard'
import { propAPI } from '../services/api'

// The portfolio Equity & Cashflow dashboard, scoped to a single property, with a
// read-only timeline that highlights this property and dims the rest.
export default function PropertyEquitySummary({ propId }) {
  const [data, setData] = useState(null)
  const [available, setAvailable] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    setLoading(true)
    propAPI.portfolioEquityCashflow({ selected_property_ids: String(propId), selection_explicit: true })
      .then((res) => {
        if (!active) return
        setData(res.data)
        setAvailable(res.data?.availableProperties || [])
      })
      .catch(() => { if (active) toast.error('Failed to load equity & cashflow summary') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [propId])

  if ((loading && !data) || !data?.totals) {
    return <div className="flex h-48 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>
  }

  const currentId = Number(propId)
  const timeline = available.length > 1 ? (
    <HomeTimeline
      rows={available}
      selectedIds={new Set([currentId])}
      hint="This property is highlighted · click another to open it"
      onSelect={(home) => { if (home.id !== currentId) navigate(`/properties/${home.id}`) }}
    />
  ) : null

  return <PortfolioEquityDashboard data={data} timeline={timeline} wrap={false} />
}
