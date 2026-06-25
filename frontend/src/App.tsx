import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HeaderActionsProvider } from '@/layout/HeaderActionsContext'
import AuthGuard from '@/layout/AuthGuard'
import AppLayout from '@/layout/AppLayout'
import RefreshStatusPage from '@/routes/monitoring/RefreshStatusPage'
import LoginPage from '@/routes/LoginPage'
import HomePage from '@/routes/HomePage'
import ReportViewPage from '@/routes/ReportViewPage'
import AdminLayout from '@/routes/admin/AdminLayout'
import UsersPage from '@/routes/admin/UsersPage'
import GroupsPage from '@/routes/admin/GroupsPage'
import RolesPage from '@/routes/admin/RolesPage'
import ReportsPage from '@/routes/admin/ReportsPage'
import HolidaysPage from '@/routes/admin/HolidaysPage'
import StatsDashboardPage from '@/routes/stats/StatsDashboardPage'
import OpsStatusPage from '@/routes/monitoring/OpsStatusPage'
import MailSchedulePage from '@/routes/mail/MailSchedulePage'
import MailJobHistoryPage from '@/routes/mail/MailJobHistoryPage'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HeaderActionsProvider>
        <BrowserRouter>
          <Routes>
            {/* 공개 */}
            <Route path="/login" element={<LoginPage />} />

            {/* 보호 라우트: 세션 확인 → 공용 레이아웃 */}
            <Route element={<AuthGuard />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/reports/:reportId" element={<ReportViewPage />} />
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<Navigate to="reports" replace />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="groups" element={<GroupsPage />} />
                  <Route path="roles" element={<RolesPage />} />
                  <Route path="holidays" element={<HolidaysPage />} />
                </Route>
                <Route path="/monitoring/refresh" element={<RefreshStatusPage />} />
                <Route path="/monitoring/ops" element={<OpsStatusPage />} />
                <Route path="/stats" element={<StatsDashboardPage />} />
                <Route path="/mail/schedules" element={<MailSchedulePage />} />
                <Route path="/mail/jobs" element={<MailJobHistoryPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </HeaderActionsProvider>
    </QueryClientProvider>
  )
}

export default App
