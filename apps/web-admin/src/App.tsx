import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { ScanProvider } from './lib/scan'
import Layout from './components/Layout'
import Appointments from './pages/Appointments'
import Billing from './pages/Billing'
import ChangePassword from './pages/ChangePassword'
import Settings from './pages/Settings'
import Signup from './pages/Signup'
import Cards from './pages/Cards'
import Consultation from './pages/Consultation'
import Lab from './pages/Lab'
import PharmacyApp from './pages/pharmacy/PharmacyApp'
import Login from './pages/Login'
import Messages from './pages/Messages'
import PatientDetail from './pages/PatientDetail'
import Patients from './pages/Patients'
import Documents from './pages/Documents'
import AdmissionDetail from './pages/ipd/AdmissionDetail'
import Ipd from './pages/ipd/Ipd'
import Emergency from './pages/Emergency'
import Exports from './pages/Exports'
import Feedback from './pages/Feedback'
import GiveFeedback from './pages/GiveFeedback'
import Insurance from './pages/Insurance'
import Security from './pages/Security'
import Theatre from './pages/Theatre'
import Workforce from './pages/Workforce'
import Executive from './pages/Executive'
import Organization from './pages/Organization'
import Reports from './pages/Reports'
import Audit from './pages/Audit'
import CheckIn from './pages/CheckIn'
import Soon from './pages/Soon'
import Tasks from './pages/Tasks'
import VerifyRx from './pages/VerifyRx'
import Tele from './pages/Tele'
import Workspace from './pages/Workspace'
import QueueDisplay from './pages/QueueDisplay'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

function Protected() {
  const { me, loading } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted">Loading…</div>
  if (!me) return <Navigate to="/login" replace />
  return me.mustChangePassword ? <ChangePassword /> : <ScanProvider><Outlet /></ScanProvider>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/verify/:tenantId/:code" element={<VerifyRx />} />
            <Route path="/f/:tenantId/:token" element={<GiveFeedback />} />
            <Route element={<Protected />}>
              <Route path="queue-display" element={<QueueDisplay />} />
              <Route path="pharmacy/*" element={<PharmacyApp />} />
              <Route element={<Layout />}>
              <Route index element={<Workspace />} />
              <Route path="patients" element={<Patients />} />
              <Route path="patients/:id" element={<PatientDetail />} />
              <Route path="appointments" element={<Appointments />} />
              <Route path="cards" element={<Cards />} />
              <Route path="billing" element={<Billing />} />
              <Route path="consult/:appointmentId" element={<Consultation />} />
              <Route path="lab" element={<Lab />} />
              <Route path="documents" element={<Documents />} />
              <Route path="checkin" element={<CheckIn />} />
              <Route path="reports" element={<Reports />} />
              <Route path="insurance" element={<Insurance />} />
              <Route path="theatre" element={<Theatre />} />
              <Route path="emergency" element={<Emergency />} />
              <Route path="staff" element={<Workforce />} />
              <Route path="feedback" element={<Feedback />} />
              <Route path="exports" element={<Exports />} />
              <Route path="security" element={<Security />} />
              <Route path="executive" element={<Executive />} />
              <Route path="ipd" element={<Ipd />} />
              <Route path="ipd/:id" element={<AdmissionDetail />} />
              <Route path="organization" element={<Organization />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="audit" element={<Audit />} />
              <Route path="consultations" element={<Tele />} />
              <Route path="messages" element={<Messages />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Soon />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
