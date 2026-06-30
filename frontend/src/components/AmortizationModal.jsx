import { useState, useEffect } from 'react'
import { propAPI } from '../services/api'
import { X } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import toast from 'react-hot-toast'

const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)

export default function AmortizationModal({ propId, loan, onClose }) {
  const [extra, setExtra] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('chart') // chart | table

  const load = async (extraAmt) => {
    setLoading(true)
    try {
      const { data: res } = await propAPI.amortization(propId, loan.id, extraAmt)
      setData(res)
    } catch { toast.error('Failed to load amortization') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(0) }, [])

  const chartData = data?.schedule?.filter((_, i) => i % 12 === 0) || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-gray-900/80 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Amortization Schedule</h2>
            <p className="text-sm text-gray-400 dark:text-gray-500">{loan.lender_name || 'Loan'} · {loan.loan_type} · {loan.interest_rate}%</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 dark:text-gray-500" /></button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Extra payment control */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="label">Extra Monthly Payment ($)</label>
              <div className="flex gap-2">
                <input type="number" className="input w-36" value={extra}
                  onChange={(e) => setExtra(parseFloat(e.target.value) || 0)} min="0" step="50" />
                <button onClick={() => load(extra)} className="btn-primary" disabled={loading}>
                  {loading ? '…' : 'Apply'}
                </button>
              </div>
            </div>
            <div className="flex gap-2 ml-auto">
              <button onClick={() => setView('chart')}
                className={`text-sm px-3 py-1.5 rounded-lg ${view === 'chart' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                Chart
              </button>
              <button onClick={() => setView('table')}
                className={`text-sm px-3 py-1.5 rounded-lg ${view === 'table' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                Table
              </button>
            </div>
          </div>

          {/* Analysis */}
          {data?.analysis && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { l: 'Payoff', v: `${(data.analysis.extra_months / 12).toFixed(1)} yrs` },
                { l: 'Months Saved', v: data.analysis.months_saved, c: 'text-green-600' },
                { l: 'Total Interest', v: fmt(data.analysis.extra_total_interest) },
                { l: 'Interest Saved', v: fmt(data.analysis.interest_saved), c: 'text-purple-600' },
              ].map(({ l, v, c }) => (
                <div key={l} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{l}</p>
                  <p className={`text-base font-bold mt-0.5 ${c || 'text-gray-900 dark:text-white'}`}>{v}</p>
                </div>
              ))}
            </div>
          )}

          {view === 'chart' && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tickFormatter={(m) => `Yr ${Math.round(m / 12)}`} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={(m) => `Month ${m}`} />
                <Legend iconSize={10} />
                <Area type="monotone" dataKey="balance" name="Balance" stroke="#3b82f6" fill="#eff6ff" strokeWidth={2} />
                <Area type="monotone" dataKey="total_interest_paid" name="Cumulative Interest" stroke="#ef4444" fill="#fef2f2" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {view === 'table' && data?.schedule && (
            <div className="overflow-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/50">
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Payment</th>
                    <th className="px-3 py-2 text-right">Principal</th>
                    <th className="px-3 py-2 text-right">Interest</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {data.schedule.map((row) => (
                    <tr key={row.month} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-3 py-1.5">{row.month}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(row.payment)}</td>
                      <td className="px-3 py-1.5 text-right text-green-600">{fmt(row.principal)}</td>
                      <td className="px-3 py-1.5 text-right text-red-500">{fmt(row.interest)}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{fmt(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
