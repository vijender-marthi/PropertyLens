import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'
import PropertiesPage from './pages/PropertiesPage'
import PropertyDetailPage from './pages/PropertyDetailPage'
import PropertyFormPage from './pages/PropertyFormPage'
import UploadsPage from './pages/UploadsPage'
import SettingsPage from './pages/SettingsPage'
import HelpPage from './pages/HelpPage'
import ReportsPage from './pages/ReportsPage'
import AnalyticsPage from './pages/AnalyticsPage'
import TaxCenterPage from './pages/TaxCenterPage'
import LoansPage from './pages/LoansPage'
import IncomeExpensesPage from './pages/IncomeExpensesPage'
import AdminPage from './pages/AdminPage'

function PrivateRoute({ children }) {
  const { user, authReady } = useAuth()
  const location = useLocation()
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }
  const next = encodeURIComponent(`${location.pathname}${location.search}`)
  return user ? children : <Navigate to={`/login?next=${next}`} replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/properties/new" element={<PropertyFormPage />} />
                <Route path="/properties/:id" element={<PropertyDetailPage />} />
                <Route path="/properties/:id/:tab" element={<PropertyDetailPage />} />
                <Route path="/properties/:id/edit" element={<PropertyFormPage />} />
                <Route path="/income-expenses" element={<IncomeExpensesPage />} />
                <Route path="/uploads" element={<UploadsPage />} />
                <Route path="/loans" element={<LoansPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/tax-center" element={<TaxCenterPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
          <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
