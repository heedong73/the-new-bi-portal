import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import StatsDashboardPage from './StatsDashboardPage'
import OpsStatusPage from '@/routes/monitoring/OpsStatusPage'
import { statsApi, monitoringApi } from '@/api/dashboardApi'
import type { MonitoringStatus, StatsOverview, StatsUsage } from '@/types/dashboard'

vi.mock('@/api/dashboardApi', () => ({
  statsApi: { overview: vi.fn(), usage: vi.fn() },
  monitoringApi: { status: vi.fn() },
}))

const OVERVIEW: StatsOverview = {
  login_count: 12, report_view_count: 340, refresh_success: 8, refresh_failed: 1,
  mail_success: 5, mail_failed: 0, failed_job_count: 1,
}
const USAGE: StatsUsage = {
  top_reports: [{ report_id: '10', report_name: '월간 매출', count: 50 }],
  by_user: [{ user_id: 1, user_name: '홍길동', count: 30 }],
  reports_by_department: [{ folder_id: 1, department: '영업부', count: 4 }],
  views_by_department: [{ department: '영업부', count: 100 }],
  reports_by_month: [{ month: '2026-06', count: 3 }],
  mail_jobs: { total: 5, succeeded: 5, failed: 0 },
  export_jobs: { succeeded: 10, failed: 1 },
  refresh_failed: 1,
  unused_reports: [{ report_id: 99, report_name: '안쓰는 레포트' }],
}
const STATUS: MonitoringStatus = {
  db: 'ok', redis: 'ok', worker: 'unavailable', worker_count: 0,
  app_mode: 'mock', auth_mode: 'mock',
  recent_jobs: { refresh: [{ id: 1, status: 'Completed' }], mail: [], export: [] },
  recent_failures: { refresh: 0, mail: 1, export: 0 },
  has_recent_failures: true,
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(statsApi.overview).mockResolvedValue(OVERVIEW)
  vi.mocked(statsApi.usage).mockResolvedValue(USAGE)
  vi.mocked(monitoringApi.status).mockResolvedValue(STATUS)
})

describe('StatsDashboardPage', () => {
  it('운영 통계 카드와 사용 통계를 렌더링한다', async () => {
    wrap(<StatsDashboardPage />)
    expect(await screen.findByText('340')).toBeInTheDocument() // 조회 수
    expect(await screen.findByText(/월간 매출/)).toBeInTheDocument()
    expect(await screen.findByText('영업부')).toBeInTheDocument()
  })
})

describe('OpsStatusPage', () => {
  it('컴포넌트 상태와 최근 실패 배너를 렌더링한다', async () => {
    wrap(<OpsStatusPage />)
    expect(await screen.findByText('데이터베이스')).toBeInTheDocument()
    expect(await screen.findByText('Worker')).toBeInTheDocument()
    expect(await screen.findByText('사용 불가')).toBeInTheDocument()
    expect(await screen.findByText(/최근 24시간 실패/)).toBeInTheDocument()
  })
})
