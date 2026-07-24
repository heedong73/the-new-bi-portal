import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HeaderActionsProvider } from '@/layout/HeaderActionsContext'
import AuthGuard from '@/layout/AuthGuard'
import AppLayout from '@/layout/AppLayout'
import AdminConsoleLayout from '@/routes/admin/AdminConsoleLayout'
import AdminDashboard from '@/routes/admin/AdminDashboard'
import RefreshStatusPage from '@/routes/monitoring/RefreshStatusPage'
import LoginPage from '@/routes/LoginPage'
import HomePage from '@/routes/HomePage'
import ReportViewPage from '@/routes/ReportViewPage'
import UsersPage from '@/routes/admin/UsersPage'
import GroupsPage from '@/routes/admin/GroupsPage'
import PermissionsPage from '@/routes/admin/PermissionsPage'
import ReportsPage from '@/routes/admin/ReportsPage'
import HolidaysPage from '@/routes/admin/HolidaysPage'
import AuditLogsPage from '@/routes/admin/AuditLogsPage'
import StatsDashboardPage from '@/routes/stats/StatsDashboardPage'
import OpsStatusPage from '@/routes/monitoring/OpsStatusPage'
import MailSchedulePage from '@/routes/mail/MailSchedulePage'
import MailJobHistoryPage from '@/routes/mail/MailJobHistoryPage'
import ServiceCenterPage from '@/routes/requests/ServiceCenterPage'
import RequestAdminPage from '@/routes/admin/RequestAdminPage'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HeaderActionsProvider>
        <BrowserRouter>
          <Routes>
            {/* 공개 */}
            <Route path="/login" element={<LoginPage />} />

            {/* 보호 라우트: 세션 확인 */}
            <Route element={<AuthGuard />}>
              {/* 사용자 포털 */}
              <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/reports" replace />} />
                <Route path="/reports" element={<HomePage />} />
                <Route path="/reports/favorites" element={<HomePage />} />
                <Route path="/reports/recent" element={<HomePage />} />
                <Route path="/reports/catalog" element={<HomePage />} />
                <Route path="/reports/:reportId" element={<ReportViewPage />} />
                <Route path="/stats" element={<StatsDashboardPage />} />
                <Route path="/service-center" element={<ServiceCenterPage />} />
              </Route>

              {/* 관리자 콘솔 — 전용 셸(별도 레이아웃). /admin 인덱스=대시보드. URL 유지. */}
              <Route element={<AdminConsoleLayout />}>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/reports" element={<ReportsPage />} />
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/admin/groups" element={<GroupsPage />} />
                <Route path="/admin/permissions" element={<PermissionsPage />} />
                <Route path="/admin/holidays" element={<HolidaysPage />} />
                <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
                <Route path="/admin/requests" element={<RequestAdminPage />} />
                <Route path="/mail/schedules" element={<MailSchedulePage />} />
                <Route path="/mail/jobs" element={<MailJobHistoryPage />} />
                <Route path="/monitoring/refresh" element={<RefreshStatusPage />} />
                <Route path="/monitoring/ops" element={<OpsStatusPage />} />
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
