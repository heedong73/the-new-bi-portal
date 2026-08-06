import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import StatsDashboardPage from './StatsDashboardPage'
import OpsStatusPage from '@/routes/monitoring/OpsStatusPage'
import { statsApi, monitoringApi } from '@/api/dashboardApi'
import { useAuthStore } from '@/stores/useAuthStore'
import type { MonitoringStatus, StatsOverview, StatsUsage } from '@/types/dashboard'

vi.mock('@/api/dashboardApi', () => ({
  statsApi: { overview: vi.fn(), usage: vi.fn(), reports: vi.fn() },
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
  recent_jobs: {
    refresh: [{
      id: 1,
      status: 'Completed',
      target_name: '월간 매출 데이터셋',
      target_detail: '연결 레포트: 월간 매출',
      started_at: '2026-08-05T08:30:00+09:00',
      finished_at: '2026-08-05T08:30:42+09:00',
      duration_seconds: 42,
      error_message: null,
    }],
    mail: [],
    export: [],
  },
  recent_failures: { refresh: 0, mail: 1, export: 0 },
  has_recent_failures: true,
  overall_status: 'error',
  checked_at: '2026-08-05T17:42:15+09:00',
  db_latency_ms: 3.5,
  redis_latency_ms: 1.2,
  worker_ids: [],
  active_tasks: null,
  queued_tasks: 0,
  scheduler: {
    status: 'ok',
    last_heartbeat: '2026-08-05T17:42:00+09:00',
    age_seconds: 15,
    message: '예약 작업 실행 경로가 정상입니다.',
  },
  powerbi: {
    status: 'mock',
    checked_at: '2026-08-05T17:42:15+09:00',
    latency_ms: 0,
    http_status: null,
    message: '모의 모드로 외부 Power BI를 호출하지 않습니다.',
  },
  recent_jobs_available: true,
  recent_jobs_error: null,
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // 운영 상태의 전체 보기 링크가 라우터 컨텍스트를 요구한다.
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // 운영자로 로그인된 상태 → 전역 통계 대시보드 렌더링
  useAuthStore.setState({
    user: { id: 1, emp_no: '1001', name: '운영자', roles: ['System_Operator'] },
  })
  vi.mocked(statsApi.overview).mockResolvedValue(OVERVIEW)
  vi.mocked(statsApi.usage).mockResolvedValue(USAGE)
  vi.mocked(statsApi.reports).mockResolvedValue([])
  vi.mocked(monitoringApi.status).mockResolvedValue(STATUS)
})

describe('StatsDashboardPage', () => {
  it('운영 통계 카드와 사용 통계를 렌더링한다', async () => {
    wrap(<StatsDashboardPage />)
    expect(await screen.findByText('340')).toBeInTheDocument() // 조회 수
    expect(await screen.findByText('월간 매출', { selector: 'tspan' })).toBeInTheDocument()
    expect(screen.getByText('시간대별 조회 · 사용자 (0~23시)')).toBeInTheDocument()
  })
})

describe('OpsStatusPage', () => {
  it('구성요소 상태와 최근 실패 배너를 렌더링한다', async () => {
    wrap(<OpsStatusPage />)
    expect(await screen.findByText('데이터 저장소')).toBeInTheDocument()
    expect(await screen.findByText('백그라운드 작업 처리기')).toBeInTheDocument()
    expect(await screen.findByText('Celery Worker')).toBeInTheDocument()
    expect(await screen.findByText('응답 Worker 없음')).toBeInTheDocument()
    expect(await screen.findByText(/최근 24시간 실패/)).toBeInTheDocument()
  })

  it('최근 작업을 대상 이름·한글 상태·초 단위 시각으로 표시한다', async () => {
    wrap(<OpsStatusPage />)
    expect(await screen.findByText('월간 매출 데이터셋')).toBeInTheDocument()
    expect(await screen.findByText('연결 레포트: 월간 매출')).toBeInTheDocument()
    expect(await screen.findByText('성공')).toBeInTheDocument()
    expect(await screen.findByText(/2026-08-05 08:30:42/)).toBeInTheDocument()
    expect(await screen.findByText(/소요 42초/)).toBeInTheDocument()
    expect(await screen.findByText(/마지막 확인 2026-08-05 17:42:15/)).toBeInTheDocument()
  })

  it('작업별 전체 이력 화면으로 가는 링크를 제공한다', async () => {
    wrap(<OpsStatusPage />)
    const links = await screen.findAllByRole('link', { name: /전체 보기/ })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/monitoring/refresh',
      '/mail/jobs',
      '/admin/audit-logs?action=export_run',
    ])
  })
})
