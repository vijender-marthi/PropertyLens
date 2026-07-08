import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authAPI } from '../services/api'
import { Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import BrandLogo from '../components/BrandLogo'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [reset, setReset] = useState({ email: '', token: '', password: '', confirm: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const requestReset = async (e) => {
    e.preventDefault()
    setResetLoading(true)
    try {
      const { data } = await authAPI.requestPasswordReset(reset.email || form.email)
      setReset((current) => ({ ...current, email: reset.email || form.email, token: data.reset_token || '' }))
      toast.success('Reset token created')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Password reset failed')
    } finally {
      setResetLoading(false)
    }
  }

  const confirmReset = async (e) => {
    e.preventDefault()
    if (reset.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (reset.password !== reset.confirm) {
      toast.error('Passwords do not match')
      return
    }
    setResetLoading(true)
    try {
      const { data } = await authAPI.confirmPasswordReset(reset.token, reset.password)
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      toast.success('Password reset')
      window.location.href = '/dashboard'
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Password reset failed')
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-8">
          <BrandLogo className="mb-8" markClassName="h-11 w-11" textClassName="text-xl text-gray-900 dark:text-white" subtitleClassName="text-gray-400" />
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">Welcome back</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            {showReset ? 'Reset your password' : 'Sign in to your account'}
          </p>

          {!showReset ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <button
                type="button"
                className="w-full text-sm font-medium text-blue-600 hover:underline"
                onClick={() => {
                  setReset((current) => ({ ...current, email: form.email }))
                  setShowReset(true)
                }}
              >
                Forgot password?
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <form onSubmit={requestReset} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="you@example.com"
                    value={reset.email}
                    onChange={(e) => setReset({ ...reset, email: e.target.value })}
                    required
                  />
                </div>
                <button type="submit" className="btn-secondary w-full py-2.5" disabled={resetLoading}>
                  {resetLoading ? 'Creating reset...' : 'Create reset token'}
                </button>
              </form>

              {reset.token && (
                <form onSubmit={confirmReset} className="space-y-4 border-t border-gray-100 pt-4 dark:border-gray-700">
                  <div>
                    <label className="label">New Password</label>
                    <input
                      type="password"
                      className="input"
                      value={reset.password}
                      onChange={(e) => setReset({ ...reset, password: e.target.value })}
                      required
                      minLength={6}
                    />
                  </div>
                  <div>
                    <label className="label">Confirm Password</label>
                    <input
                      type="password"
                      className="input"
                      value={reset.confirm}
                      onChange={(e) => setReset({ ...reset, confirm: e.target.value })}
                      required
                      minLength={6}
                    />
                  </div>
                  <button type="submit" className="btn-primary w-full py-2.5" disabled={resetLoading}>
                    {resetLoading ? 'Resetting...' : 'Reset password'}
                  </button>
                </form>
              )}

              <button type="button" className="w-full text-sm font-medium text-gray-500 hover:text-gray-700" onClick={() => setShowReset(false)}>
                Back to sign in
              </button>
            </div>
          )}

          {!showReset && (
            <p className="text-center text-sm text-gray-500 mt-6">
              Don&apos;t have an account?{' '}
              <Link to="/register" className="text-blue-600 font-medium hover:underline">
                Create one
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
