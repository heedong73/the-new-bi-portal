import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import HomePage from './HomePage'
import { foldersApi, reportsApi } from '@/api/portalApi'
import type { FolderTreeNode, ReportSummary } from '@/types/report'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/api/portalApi', () => ({
  foldersApi: { tree: vi.fn() },
  reportsApi: { list: vi.fn() },
}))

const TREE: FolderTreeNode[] = [
  {
    id: 1, name: '영업부', folder_type: null, sort_order: 0, report_ids: [10],
    children: [
      { id: 2, name: '국내영업', folder_type: null, sort_order: 0, children: [], report_ids: [11] },
    ],
  },
]

const REPORT: ReportSummary = {
  id: 10, workspace_id: 'ws', report_id: 'rpt', display_name: '월간 매출',
  description: '월별 매출 현황', category: '영업', folder_id: 1, is_published: true,
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(foldersApi.tree).mockResolvedValue(TREE)
    vi.mocked(reportsApi.list).mockResolvedValue([REPORT])
  })

  it('폴더 트리와 레포트 목록을 렌더링한다', async () => {
    renderPage()
    expect(await screen.findByText('영업부')).toBeInTheDocument()
    expect(await screen.findByText('국내영업')).toBeInTheDocument()
    expect(await screen.findByText('월간 매출')).toBeInTheDocument()
    // 초기엔 전체 레포트 (folder_id 미지정)
    expect(reportsApi.list).toHaveBeenCalledWith(null, expect.anything())
  })

  it('폴더를 선택하면 해당 folder_id로 레포트를 재조회한다', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('영업부'))
    await waitFor(() => expect(reportsApi.list).toHaveBeenCalledWith(1, expect.anything()))
  })

  it('레포트 카드 클릭 시 상세로 이동한다', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('월간 매출'))
    expect(navigateMock).toHaveBeenCalledWith('/reports/10')
  })

  it('레포트가 없으면 안내 문구를 표시한다', async () => {
    vi.mocked(reportsApi.list).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('조회 가능한 레포트가 없습니다.')).toBeInTheDocument()
  })
})
