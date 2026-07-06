import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, RefreshCw, Users } from 'lucide-react'
import { authAPI } from '../services/api'
import { useAuth } from '../hooks/useAuth'

const ROLES = ['demo', 'admin', 'superuser']
const ADMIN_EMAIL = 'vijender.marthi@gmail.com'

export default function AdminPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const isAdmin = ['admin', 'superuser'].includes((user?.role || '').toLowerCase())

  const loadUsers = () => {
    setLoading(true)
    authAPI.listUsers()
      .then((res) => setUsers(res.data || []))
      .catch((err) => toast.error(err.response?.data?.detail || 'Failed to load users'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (isAdmin) loadUsers()
  }, [isAdmin])

  const updateRole = async (targetUser, role) => {
    setSavingId(targetUser.id)
    try {
      const { data } = await authAPI.updateUserRole(targetUser.id, role)
      setUsers((current) => current.map((u) => (u.id === data.id ? data : u)))
      toast.success(`${data.email} updated to ${data.role}`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Role update failed')
    } finally {
      setSavingId(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="card mx-auto max-w-2xl py-12 text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Admin access required</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Only admins can manage user roles.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Access</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Promote or restrict users across demo, admin, and superuser roles.</p>
        </div>
        <button onClick={loadUsers} className="btn-secondary flex items-center gap-2 text-sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <RoleTile label="Demo Users" value={users.filter((u) => u.role === 'demo').length} />
        <RoleTile label="Admins" value={users.filter((u) => u.role === 'admin').length} />
        <RoleTile label="Super Users" value={users.filter((u) => u.role === 'superuser').length} />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <Users className="h-4 w-4 text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Users</h2>
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-400">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {users.map((target) => {
                  const lockedAdmin = target.email.toLowerCase() === ADMIN_EMAIL
                  return (
                    <tr key={target.id}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{target.name}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{target.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={target.role}
                          disabled={savingId === target.id || lockedAdmin}
                          onChange={(e) => updateRole(target, e.target.value)}
                          className="input max-w-40 py-1.5 text-sm capitalize disabled:opacity-60"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                        {lockedAdmin ? <span className="ml-2 text-xs text-gray-400">fixed admin</span> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RoleTile({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}
