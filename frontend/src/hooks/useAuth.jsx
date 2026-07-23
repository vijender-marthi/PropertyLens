import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authAPI } from '../services/api'

const AuthContext = createContext(null)
const SESSION_RETRY_DELAYS_MS = [300, 700, 1200]

function clearStoredSession() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let active = true
    const token = localStorage.getItem('token')
    if (!token) {
      setAuthReady(true)
      return () => { active = false }
    }
    const verifySession = async () => {
      for (let attempt = 0; attempt <= SESSION_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const { data } = await authAPI.me()
          if (!active) return
          localStorage.setItem('user', JSON.stringify(data))
          setUser(data)
          return
        } catch (error) {
          if (!active) return

          // Only a confirmed unauthorized response invalidates the session.
          // Network failures and backend startup errors retain the cached user.
          if (error.response?.status === 401) {
            clearStoredSession()
            setUser(null)
            return
          }

          if (attempt === SESSION_RETRY_DELAYS_MS.length) return
          await wait(SESSION_RETRY_DELAYS_MS[attempt])
        }
      }
    }

    verifySession().finally(() => {
      if (active) setAuthReady(true)
    })
    return () => { active = false }
  }, [])

  const login = useCallback(async (email, password) => {
    const { data } = await authAPI.login(email, password)
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (name, email, password) => {
    const { data } = await authAPI.register({ name, email, password })
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    clearStoredSession()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, authReady, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
