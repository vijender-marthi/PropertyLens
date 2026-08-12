import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import PortfolioEquityDashboard from './PortfolioEquityDashboard'
import { propAPI } from '../services/api'

// The portfolio Equity & Cashflow dashboard, scoped to a single property.
export default function PropertyEquitySummary({ propId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    propAPI.portfolioEquityCashflow({ selected_property_ids: String(propId), selection_explicit: true })
      .then((res) => { if (active) setData(res.data) })
      .catch(() => { if (active) toast.error('Failed to load equity & cashflow summary') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [propId])

  if ((loading && !data) || !data?.totals) {
    return <div className="flex h-48 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>
  }

  return <PortfolioEquityDashboard data={data} wrap={false} />
}
