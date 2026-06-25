import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import MailJobHistoryPage from './MailJobHistoryPage'
import MailSchedulePage from './MailSchedulePage'
import { mailJobsApi, mailSchedulesApi } from '@/api/mailApi'
import type { MailJob, MailSchedule } from '@/types/mail'

vi.mock('@/api/mailApi', () => ({
  mailJobsApi: { list: vi.fn(), retry: vi.fn() },
  mailSchedulesApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))

const JOBS: MailJob[] = [
  { id: 1, mail_schedule_id: 5, run_key: 'k1', status: 'failed', failure_reason: 'SMTP 오류', retry_count: 0 },
  { id: 2, mail_schedule_id: 5, run_key: 'k2', status: 'succeeded', retry_count: 0 },
]
const SCHEDULES: MailSchedule[] = [
  { id: 5, report_id: 10, title: '일일 보고서', export_format: 'PNG', enabled: true,
    skip_weekends: true, skip_holidays: true,
    created_at: '2026-06-24', recipients: [], pages: [], cron_expr: '0 9 * * *' },
]

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mailJobsApi.list).mockResolvedValue(JOBS)
  vi.mocked(mailJobsApi.retry).mockResolvedValue({ mail_schedule_id: 5, run_key: 'k1-retry', accepted: true, message: 'ok' })
  vi.mocked(mailSchedulesApi.list).mockResolvedValue(SCHEDULES)
  vi.mocked(mailSchedulesApi.create).mockResolvedValue(SCHEDULES[0])
})

describe('MailJobHistoryPage', () => {
  it('실패 잡에만 재시도 버튼을 노출하고 클릭 시 retry 호출', async () => {
    wrap(<MailJobHistoryPage />)
    const retryButtons = await screen.findAllByRole('button', { name: /재시도/ })
    expect(retryButtons).toHaveLength(1) // failed 1건만
    fireEvent.click(retryButtons[0])
    await waitFor(() => expect(mailJobsApi.retry).toHaveBeenCalledWith(1))
  })
})

describe('MailSchedulePage', () => {
  it('스케줄 목록을 렌더링하고 새 스케줄 폼을 연다', async () => {
    wrap(<MailSchedulePage />)
    expect(await screen.findByText('일일 보고서')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /새 스케줄/ }))
    expect(await screen.findByText('새 메일 스케줄')).toBeInTheDocument()
    expect(screen.getByLabelText('제목')).toBeInTheDocument()
  })

  it('필수값 입력 후 저장하면 create 호출', async () => {
    wrap(<MailSchedulePage />)
    fireEvent.click(screen.getByRole('button', { name: /새 스케줄/ }))
    fireEvent.change(await screen.findByLabelText('레포트 ID'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '주간 보고서' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(mailSchedulesApi.create).toHaveBeenCalled())
  })
})
