import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { authAPI, sharingAPI } from '../services/api'
import toast from 'react-hot-toast'
import { User, Key, Info, Share2, X, UserCheck, UserPlus, ArrowRight, ArrowLeft, Home } from 'lucide-react'

export default function SettingsPage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' })

  const handleProfile = async (e) => {
    e.preventDefault()
    toast('Profile updates require backend extension — coming soon', { icon: 'ℹ️' })
  }

  return (
<div className="w-full max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>

      {/* Profile */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Profile</h2>
        </div>
        <form onSubmit={handleProfile} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input type="text" className="input" value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
          <button type="submit" className="btn-primary">Save Profile</button>
        </form>
      </div>

      {/* Shared Access */}
      <SharedAccessSection currentUser={user} />

      {/* API Keys */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">API Keys</h2>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4">
          <div className="flex gap-2 text-sm text-blue-700">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>Set environment variables in the backend to enable live property valuations from Zillow.</p>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <EnvVar name="ZILLOW_API_KEY" desc="Zillow / RapidAPI key for Zestimate lookups" />
        </div>
      </div>

      {/* About */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white">About</h2>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <p><span className="font-medium text-gray-700 dark:text-gray-300">App:</span> PropertyLens — Property Intelligence Platform</p>
          <p><span className="font-medium text-gray-700 dark:text-gray-300">Stack:</span> FastAPI + React + SQLite</p>
          <p><span className="font-medium text-gray-700 dark:text-gray-300">Version:</span> 1.0.0</p>
        </div>
      </div>
    </div>
  )
}

function SharedAccessSection({ currentUser }) {
  const [sharing, setSharing] = useState({ given: [], received: [] })
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    sharingAPI.list()
      .then(r => setSharing(r.data))
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [])

  const handleShare = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    try {
      const r = await sharingAPI.share(email.trim().toLowerCase())
      setSharing(prev => ({ ...prev, given: [...prev.given, r.data] }))
      setEmail('')
      toast.success(`Dashboard shared with ${r.data.shared_with_name}`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not share — check the email address')
    } finally {
      setLoading(false)
    }
  }

  const removeShare = async (id, isGiven) => {
    try {
      await sharingAPI.remove(id)
      if (isGiven) {
        setSharing(prev => ({ ...prev, given: prev.given.filter(s => s.id !== id) }))
      } else {
        setSharing(prev => ({ ...prev, received: prev.received.filter(s => s.id !== id) }))
      }
      toast.success('Access removed')
    } catch {
      toast.error('Failed to remove access')
    }
  }

  const hasAny = !fetching && (sharing.given.length > 0 || sharing.received.length > 0)

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Share2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Shared Access</h2>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Both people in your household can see the same properties and dashboards.
        Enter the other person's registered email to grant them view-only access to your portfolio.
      </p>

      {/* Visual access map */}
      {hasAny && (
        <div className="mb-6 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 p-4">
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-4">Access Map</p>
          <div className="space-y-3">
            {/* You → others (given) */}
            {sharing.given.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 shadow-sm min-w-0">
                  <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{currentUser?.name || 'You'}</span>
                </div>
                <div className="flex flex-col items-center shrink-0">
                  <ArrowRight className="w-4 h-4 text-green-500" />
                  <span className="text-[10px] text-green-600 font-medium">shares with</span>
                </div>
                <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 min-w-0">
                  <UserCheck className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 dark:text-gray-200 truncate leading-none">{s.shared_with_name}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{s.shared_with_email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  <Home className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">view all properties</span>
                </div>
              </div>
            ))}

            {/* Others → you (received) */}
            {sharing.received.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 min-w-0">
                  <User className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 dark:text-gray-200 truncate leading-none">{s.owner_name}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{s.owner_email}</p>
                  </div>
                </div>
                <div className="flex flex-col items-center shrink-0">
                  <ArrowRight className="w-4 h-4 text-blue-500" />
                  <span className="text-[10px] text-blue-600 font-medium">shares with</span>
                </div>
                <div className="flex items-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 shadow-sm min-w-0">
                  <UserCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{currentUser?.name || 'You'}</span>
                </div>
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  <Home className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                  <span className="text-xs text-gray-400 dark:text-gray-500">you can view their properties</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add share form */}
      <form onSubmit={handleShare} className="flex gap-2 mb-6">
        <input
          type="email"
          className="input flex-1"
          placeholder="partner@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
          disabled={loading || !email.trim()}
        >
          <UserPlus className="w-4 h-4" />
          {loading ? 'Sharing…' : 'Share'}
        </button>
      </form>

      {/* Shared with others (given) */}
      <div className="mb-5">
        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
          You shared your portfolio with
        </h3>
        {fetching ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : sharing.given.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Not shared with anyone yet.</p>
        ) : (
          <ul className="space-y-2">
            {sharing.given.map(s => (
              <li key={s.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-green-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.shared_with_name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{s.shared_with_email}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeShare(s.id, true)}
                  className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                  title="Revoke access"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Shared by others (received) */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
          Others sharing their portfolio with you
        </h3>
        {fetching ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : sharing.received.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No one has shared their portfolio with you yet.</p>
        ) : (
          <ul className="space-y-2">
            {sharing.received.map(s => (
              <li key={s.id}
                className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.owner_name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{s.owner_email}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeShare(s.id, false)}
                  className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                  title="Opt out"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EnvVar({ name, desc }) {
  return (
    <div className="flex items-start gap-3">
      <code className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-0.5 rounded text-xs font-mono shrink-0">{name}</code>
      <span className="text-gray-500 dark:text-gray-400">{desc}</span>
    </div>
  )
}
