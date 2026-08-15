import { createContext, useContext } from 'react'
import { Building2, Home } from 'lucide-react'

// Per-home accent palette (keyed by the property's immutable accentIndex), and
// the app convention: Home icon for a primary residence, Building2 for a rental.
export const HOME_TEXT = ['text-blue-500', 'text-teal-500', 'text-indigo-500', 'text-fuchsia-500', 'text-cyan-500', 'text-rose-500']
export const HOME_BG = ['bg-blue-500', 'bg-teal-500', 'bg-indigo-500', 'bg-fuchsia-500', 'bg-cyan-500', 'bg-rose-500']

const Ctx = createContext({ accentById: {}, primaryById: {} })

export function HomeAccentProvider({ available = [], children }) {
  const value = {
    accentById: Object.fromEntries(available.map((p) => [p.id, p.accentIndex ?? 0])),
    primaryById: Object.fromEntries(available.map((p) => [p.id, p.isPrimary || String(p.type || '').toLowerCase() === 'primary'])),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHomeAccent() { return useContext(Ctx) }

// Property name with the shared home icon + accent color.
export function HomeName({ id, name, className = '' }) {
  const { accentById, primaryById } = useContext(Ctx)
  const Icon = primaryById[id] ? Home : Building2
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><Icon className={`h-3.5 w-3.5 shrink-0 ${HOME_TEXT[(accentById[id] ?? 0) % HOME_TEXT.length]}`} />{name}</span>
}
