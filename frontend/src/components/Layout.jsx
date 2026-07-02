import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import {
  Building2, Upload, Settings, LogOut,
  BarChart3, Menu, X, HelpCircle, Wrench, FileText,
  Sun, Moon,
} from 'lucide-react'
import { useState } from 'react'
import BrandLogo from './BrandLogo'

const MAIN_NAV = [
  { to: '/dashboard',  icon: BarChart3,  label: 'Dashboard' },
  { to: '/properties', icon: Building2,  label: 'Properties' },
  { to: '/uploads',    icon: Upload,     label: 'Upload Files' },
  { to: '/reports',    icon: FileText,   label: 'Reports' },
]

const TOOLS_NAV = [
  { to: '/help',     icon: HelpCircle, label: 'Help' },
  { to: '/settings', icon: Settings,   label: 'Settings' },
]

function NavItem({ to, icon: Icon, label, active }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
        active
          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 hover:text-gray-800 dark:hover:text-gray-200'
      }`}
    >
      <Icon className={`w-[15px] h-[15px] shrink-0 ${active ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`} />
      {label}
    </Link>
  )
}

function SidebarContent({ user, onLogout, onClose }) {
  const location = useLocation()
  const { dark, toggle } = useTheme()
  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">

      {/* Logo */}
      <div className="flex items-center justify-between px-3.5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <BrandLogo markClassName="h-[30px] w-[30px]" textClassName="text-[13px] text-gray-900 dark:text-white" subtitleClassName="text-[10px] text-gray-400 dark:text-gray-500" />
        {/* Close button (mobile only) */}
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Scrollable main nav */}
      <div className="flex-1 overflow-y-auto py-2.5 px-2">
        <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-widest px-2 py-1.5">Main</p>
        <div className="flex flex-col gap-0.5">
          {MAIN_NAV.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} active={isActive(to)} />
          ))}
        </div>
      </div>

      {/* Tools + Profile — pinned to bottom */}
      <div className="shrink-0">

        {/* Tools */}
        <div className="border-t border-gray-100 dark:border-gray-700 px-2 pt-2 pb-1">
          <div className="flex items-center gap-1.5 px-2 py-1">
            <Wrench className="w-2.5 h-2.5 text-gray-400 dark:text-gray-600" />
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-widest">Resources</p>
          </div>
          <div className="flex flex-col gap-0.5">
            {TOOLS_NAV.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} active={isActive(to)} />
            ))}
          </div>
        </div>

        {/* Dark / Light toggle */}
        <div className="border-t border-gray-100 dark:border-gray-700 px-2 py-2">
          <button
            onClick={toggle}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
          >
            <span className="flex items-center gap-2.5">
              {dark ? <Sun className="w-[15px] h-[15px] text-amber-400" /> : <Moon className="w-[15px] h-[15px]" />}
              {dark ? 'Light mode' : 'Dark mode'}
            </span>
            <span className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${dark ? 'bg-blue-500' : 'bg-gray-200'}`}>
              <span className={`w-3 h-3 rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-4' : 'translate-x-0'}`} />
            </span>
          </button>
        </div>

        {/* Profile */}
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0 flex items-center justify-center">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {user?.name?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-gray-900 dark:text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50 dark:bg-gray-950">

      {/* Desktop sidebar */}
      <div className="hidden lg:flex w-[216px] shrink-0 h-full">
        <SidebarContent user={user} onLogout={handleLogout} />
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-[216px] z-10 h-full shadow-xl">
            <SidebarContent user={user} onLogout={handleLogout} onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content column */}
      <div className="flex flex-col flex-1 min-w-0 h-full">

        {/* Mobile top bar */}
        <div className="flex lg:hidden items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-gray-500 dark:text-gray-400 p-1">
            <Menu className="w-5 h-5" />
          </button>
          <BrandLogo markClassName="h-7 w-7" textClassName="text-sm text-gray-900 dark:text-white" subtitleClassName="hidden" />
          {/* Theme toggle on mobile top bar */}
          <button onClick={toggle} className="text-gray-500 dark:text-gray-400 p-1">
            {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
