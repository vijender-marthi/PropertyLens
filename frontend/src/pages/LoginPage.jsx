import { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authAPI } from '../services/api'
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import BrandLogo from '../components/BrandLogo'

function authErrorMessage(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  return err?.message || fallback
}

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ email: '', password: '' })
  const [reset, setReset] = useState({ email: '', token: '', password: '', confirm: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const sessionExpired = params.get('reason') === 'session-expired'
  const requestedNext = params.get('next') || '/dashboard'
  const nextPath = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    try {
      await login(form.email.trim(), form.password)
      navigate(nextPath, { replace: true })
    } catch (err) {
      toast.error(authErrorMessage(err, 'Sign in failed'))
    } finally {
      setLoading(false)
    }
  }

  const requestReset = async (event) => {
    event.preventDefault()
    setResetLoading(true)
    try {
      const email = (reset.email || form.email).trim()
      const { data } = await authAPI.requestPasswordReset(email)
      setReset((current) => ({ ...current, email, token: data.reset_token || '' }))
      toast.success(data.reset_token ? 'Recovery code created' : 'If the account exists, recovery instructions were sent.')
    } catch (err) {
      toast.error(authErrorMessage(err, 'Account recovery failed'))
    } finally {
      setResetLoading(false)
    }
  }

  const confirmReset = async (event) => {
    event.preventDefault()
    if (reset.password.length < 8) {
      toast.error('Password must be at least 8 characters')
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
      toast.success('Password updated')
      window.location.href = nextPath
    } catch (err) {
      toast.error(authErrorMessage(err, 'Password reset failed'))
    } finally {
      setResetLoading(false)
    }
  }

  const switchToRecovery = () => {
    setReset((current) => ({ ...current, email: current.email || form.email }))
    setMode('recovery')
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden rounded-2xl border border-white/70 bg-white/80 p-8 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 lg:block">
          <BrandLogo markClassName="h-12 w-12" textClassName="text-2xl text-slate-950 dark:text-white" subtitleClassName="text-slate-500" />
          <div className="mt-10 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Property intelligence</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Portfolio data, documents, and loan history in one place.</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Sign in keeps your extracted documents, property setup, loan schedules, and reporting workspace available across sessions.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
                <span>Sessions now stay active longer and are verified quietly on app load.</span>
              </div>
              <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <LockKeyhole className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
                <span>Account recovery is separate from normal sign-in. Use it only when the password is actually lost.</span>
              </div>
            </div>
          </div>
        </section>

        <main className="rounded-2xl border border-white/80 bg-white p-6 shadow-xl shadow-slate-200/80 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30 sm:p-8">
          <div className="mb-8 lg:hidden">
            <BrandLogo markClassName="h-11 w-11" textClassName="text-xl text-slate-950 dark:text-white" subtitleClassName="text-slate-500" />
          </div>

          {sessionExpired && mode === 'signin' ? (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Your session expired. Sign in again to continue where you left off.
            </div>
          ) : null}

          {mode === 'signin' ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Secure sign in</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Welcome back</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use your PropertyLens account password. Reset is optional.</p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="email"
                      className="input pl-10"
                      placeholder="you@example.com"
                      value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label className="label mb-0">Password</label>
                    <button type="button" className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={switchToRecovery}>
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type={showPwd ? 'text' : 'password'}
                      className="input pl-10 pr-10"
                      placeholder="Password"
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Don&apos;t have an account?{' '}
                <Link to="/register" className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300">
                  Create one
                </Link>
              </p>
            </>
          ) : (
            <>
              <button type="button" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" onClick={() => setMode('signin')}>
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account recovery</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Reset password</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use this only if the saved password no longer works.</p>
              </div>

              <form onSubmit={requestReset} className="mt-6 space-y-4">
                <div>
                  <label className="label">Account email</label>
                  <input
                    type="email"
                    className="input"
                    placeholder="you@example.com"
                    value={reset.email}
                    onChange={(event) => setReset({ ...reset, email: event.target.value })}
                    autoComplete="email"
                    required
                  />
                </div>
                <button type="submit" className="btn-secondary w-full py-2.5" disabled={resetLoading}>
                  {resetLoading ? 'Preparing recovery...' : 'Start password recovery'}
                </button>
              </form>

              {reset.token ? (
                <form onSubmit={confirmReset} className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Recovery code verified for this session.</p>
                  <div>
                    <label className="label">New password</label>
                    <input
                      type="password"
                      className="input"
                      value={reset.password}
                      onChange={(event) => setReset({ ...reset, password: event.target.value })}
                      autoComplete="new-password"
                      required
                      minLength={8}
                    />
                  </div>
                  <div>
                    <label className="label">Confirm password</label>
                    <input
                      type="password"
                      className="input"
                      value={reset.confirm}
                      onChange={(event) => setReset({ ...reset, confirm: event.target.value })}
                      autoComplete="new-password"
                      required
                      minLength={8}
                    />
                  </div>
                  <button type="submit" className="btn-primary w-full py-2.5" disabled={resetLoading}>
                    {resetLoading ? 'Updating password...' : 'Update password and sign in'}
                  </button>
                </form>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
