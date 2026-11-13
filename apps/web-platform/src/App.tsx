import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import Analytics from './pages/Analytics'
import Announcements from './pages/Announcements'
import Audit from './pages/Audit'
import HospitalDetail from './pages/HospitalDetail'
import Logs from './pages/Logs'
import System from './pages/System'
import Hospitals from './pages/Hospitals'
import Invoices from './pages/Invoices'
import Login from './pages/Login'
import Onboard from './pages/Onboard'
import Overview from './pages/Overview'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

function Protected() {
  const { me, loading } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>
  return me ? <Layout /> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected />}>
              <Route index element={<Overview />} />
              <Route path="hospitals" element={<Hospitals />} />
              <Route path="hospitals/new" element={<Onboard />} />
              <Route path="hospitals/:id" element={<HospitalDetail />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="logs" element={<Logs />} />
              <Route path="audit" element={<Audit />} />
              <Route path="announcements" element={<Announcements />} />
              <Route path="system" element={<System />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
