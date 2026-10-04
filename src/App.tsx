import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from './components/AppShell'
import { ErrorState } from './components/ui/States'
import { authApi } from './lib/api'
import { AuthLoadingScreen, AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { CustomerCreatePage, CustomerEditPage } from './pages/CustomerFormPage'
import { CustomerProfilePage } from './pages/CustomerProfilePage'
import { CustomersPage } from './pages/CustomersPage'
import { PaymentsPage, PrescriptionsPage, PurchasesPage, ReportsPage } from './pages/WorkspacePages'
import { SettingsPage } from './pages/SettingsPage'

function SessionUnavailable({ onRetry, error }: { onRetry: () => void; error: unknown }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5 py-10">
      <ErrorState className="w-full max-w-md" title="We could not verify your session" description={error instanceof Error ? error.message : 'The authentication service did not respond.'} onRetry={onRetry} />
    </main>
  )
}

function RequireSession() {
  const session = useQuery({ queryKey: ['session'], queryFn: authApi.session, retry: false })
  if (session.isPending) return <AuthLoadingScreen />
  if (session.isError) {
    return <SessionUnavailable error={session.error} onRetry={() => void session.refetch()} />
  }
  if (!session.data.authenticated) return <Navigate to={session.data.setupRequired ? '/setup' : '/login'} replace />
  return <Outlet />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/setup" element={<AuthPage />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/new" element={<CustomerCreatePage />} />
          <Route path="customers/:uuid" element={<CustomerProfilePage />} />
          <Route path="customers/:uuid/edit" element={<CustomerEditPage />} />
          <Route path="purchases" element={<PurchasesPage />} />
          <Route path="prescriptions" element={<PrescriptionsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
