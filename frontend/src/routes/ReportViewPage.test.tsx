import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import ReportViewPage from './ReportViewPage'
import { reportsApi, datasetsApi } from '@/api/portalApi'
import { ApiError } from '@/api/client'
import { useTaskStore } from '@/stores/useTaskStore'
import type { EmbedInfo, RefreshStatus, ReportSummary } from '@/types/report'

vi.mock('@/api/portalApi', () => ({
  reportsApi: { list: vi.fn(), embed: vi.fn(), refreshStatus: vi.fn(), liveRefreshStatus: vi.fn(), replacePbix: vi.fn(), favorites: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn() },
  datasetsApi: { triggerRefresh: vi.fn() },
}))

// powerbi-client-react 는 jsdom 에서 실제 임베드가 불가하므로 더미로 대체
vi.mock('powerbi-client-react', () => ({
  PowerBIEmbed: () => <div data-testid="pbi-embed" />,
}))
vi.mock('powerbi-client', () => ({
  models: {
    TokenType: { Embed: 1 },
    BackgroundType: { Transparent: 1 },
    LayoutType: { Custom: 2 },
    DisplayOption: { FitToPage: 0, ActualSize: 2 },
  },
}))

const REPORT: ReportSummary = {
  id: 10, workspace_id: 'ws', report_id: 'pbi-rpt', dataset_id: 'ds-1',
  display_name: '월간 매출', folder_id: 1, is_published: true,
}
const EMBED: EmbedInfo = { reportId: 'pbi-rpt', embedUrl: 'https://embed', embedToken: 'tok' }
const STATUS: RefreshStatus = { has_history: true, status: 'Completed', last_refresh_local: '2026-06-24 09:00' }

function renderAt(path = '/reports/10') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports/:reportId" element={<ReportViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReportViewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskStore.setState({ tasks: [] })
    vi.mocked(reportsApi.list).mockResolvedValue([REPORT])
    vi.mocked(reportsApi.embed).mockResolvedValue(EMBED)
    vi.mocked(reportsApi.refreshStatus).mockResolvedValue(STATUS)
    vi.mocked(reportsApi.liveRefreshStatus).mockResolvedValue({
      has_history: true, status: 'Completed', in_progress: false,
      start_time: '2026-06-24T00:00:00Z', end_time: '2026-06-24T00:05:00Z',
    })
    vi.mocked(datasetsApi.triggerRefresh).mockResolvedValue({ status: 'enqueued', dataset_id: 'ds-1' })
  })

  it('레포트 임베드와 제목, 새로고침 상태를 렌더링한다', async () => {
    renderAt()
    expect(await screen.findByText('월간 매출')).toBeInTheDocument()
    expect(await screen.findByTestId('pbi-embed')).toBeInTheDocument()
    expect(await screen.findByText('성공')).toBeInTheDocument()
  })

  it('새로고침 버튼 클릭 시 dataset_id로 트리거한다', async () => {
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: /새로고침/ }))
    await waitFor(() => expect(datasetsApi.triggerRefresh).toHaveBeenCalledWith('ds-1'))
    expect(await screen.findByText(/새로고침을 요청했습니다/)).toBeInTheDocument()
  })

  it('새로고침 403 시 권한 없음 안내를 표시한다', async () => {
    vi.mocked(datasetsApi.triggerRefresh).mockRejectedValue(
      new ApiError({ status: 403, errorCode: 'PERMISSION_DENIED', errorDescription: '권한 없음' }),
    )
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: /새로고침/ }))
    expect(await screen.findByText('새로고침 권한이 없습니다.')).toBeInTheDocument()
  })

  it('embed 403 시 권한 안내를 표시한다', async () => {
    vi.mocked(reportsApi.embed).mockRejectedValue(
      new ApiError({ status: 403, errorCode: 'PERMISSION_DENIED', errorDescription: '권한 없음' }),
    )
    renderAt()
    expect(await screen.findByText('이 레포트를 볼 권한이 없습니다.')).toBeInTheDocument()
  })
})
