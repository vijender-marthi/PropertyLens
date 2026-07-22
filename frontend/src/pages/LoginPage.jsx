import { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authAPI } from '../services/api'
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import BrandLogo from '../components/BrandLogo'

const LAST_EMAIL_KEY = 'propertylens:lastEmail'

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
  const [form, setForm] = useState(() => ({ email: localStorage.getItem(LAST_EMAIL_KEY) || '', password: '' }))
  const [reset, setReset] = useState({ email: '', token: '', password: '', confirm: '', requested: false, emailed: false })
  const [showPwd, setShowPwd] = useState(false)
  const [signInError, setSignInError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const sessionExpired = params.get('reason') === 'session-expired'
  const requestedNext = params.get('next') || '/dashboard'
  const nextPath = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSignInError('')
    setLoading(true)
    try {
      const email = form.email.trim()
      await login(email, form.password)
      localStorage.setItem(LAST_EMAIL_KEY, email)
      navigate(nextPath, { replace: true })
    } catch (err) {
      const message = authErrorMessage(err, 'Sign in failed')
      setSignInError(err?.response?.status === 401 ? 'Email or password did not match. Your password was not changed; reset only if you forgot it.' : message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const requestReset = async (event) => {
    event.preventDefault()
    setSignInError('')
    setResetLoading(true)
    try {
      const email = (reset.email || form.email).trim()
      const { data } = await authAPI.requestPasswordReset(email)
      setReset((current) => ({ ...current, email, token: data.reset_token || '', requested: true, emailed: Boolean(data.emailed) }))
      toast.success(data.emailed ? 'Recovery code emailed' : 'If the account exists, recovery instructions were sent.')
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

  const switchToSignIn = () => {
    setMode('signin')
    setReset((current) => ({ ...current, token: '', password: '', confirm: '', requested: false, emailed: false }))
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden rounded-2xl border border-white/70 bg-white/80 p-8 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 lg:block">
          <BrandLogo markClassName="h-12 w-12" textClassName="text-2xl text-slate-950 dark:text-white" subtitleClassName="text-slate-500" />
          <div className="mt-10 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Property intelligence</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Sign in once. Keep working across sessions.</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                PropertyLens keeps your verified session active for longer by default, so account recovery is only needed when the password is actually lost.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
                <span>Long-lived sessions are verified quietly when the app opens.</span>
              </div>
              <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <LockKeyhole className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
                <span>Password reset is a separate recovery path, not part of routine sign-in.</span>
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
              Your saved session expired. Sign in again with your current password; reset is only needed if you forgot it.
            </div>
          ) : null}

          {mode === 'signin' ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Secure sign in</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Welcome back</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use your existing password. Your account password is not reset unless you start recovery.</p>
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {signInError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    {signInError}
                  </div>
                ) : null}
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
                      autoFocus={!form.email}
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
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                  Sessions stay active for months on this browser unless you sign out or clear browser storage.
                </p>
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
              <button type="button" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white" onClick={switchToSignIn}>
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account recovery</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Recover access</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use this only if you forgot the password. Session expiration alone does not require a reset.</p>
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
                  {resetLoading ? 'Sending recovery code...' : 'Send recovery code'}
                </button>
              </form>

              {reset.requested ? (
                <form onSubmit={confirmReset} className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {reset.emailed
                      ? `We emailed a recovery code to ${reset.email}. Paste it below, then choose a new password.`
                      : 'Enter the recovery code, then choose a new password.'}
                  </p>
                  <div>
                    <label className="label">Recovery code</label>
                    <input
                      type="text"
                      className="input font-mono text-xs"
                      placeholder="Paste the code from your email"
                      value={reset.token}
                      onChange={(event) => setReset({ ...reset, token: event.target.value })}
                      autoComplete="one-time-code"
                      required
                    />
                    {reset.token && !reset.emailed ? (
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Auto-filled for local development (no email server configured).</p>
                    ) : null}
                  </div>
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
                  <button type="submit" className="btn-primary w-full py-2.5" disabled={resetLoading || !reset.token.trim()}>
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
