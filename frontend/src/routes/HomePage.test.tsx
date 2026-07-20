import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import HomePage from './HomePage'
import { reportsApi } from '@/api/portalApi'
import type { ReportSummary } from '@/types/report'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/api/portalApi', () => ({
  reportsApi: { favorites: vi.fn(), addFavorite: vi.fn(), removeFavorite: vi.fn() },
}))

const FAV: ReportSummary = {
  id: 99, workspace_id: 'ws', report_id: 'rpt', display_name: '즐겨찾기 레포트',
  description: null, category: null, folder_id: 1, is_published: true, is_favorite: true,
}

function renderPage(initial = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(reportsApi.favorites).mockResolvedValue([])
    vi.mocked(reportsApi.addFavorite).mockResolvedValue(undefined as never)
    vi.mocked(reportsApi.removeFavorite).mockResolvedValue(undefined as never)
  })

  it('기본 진입 시 즐겨찾기를 표시하고 레포트 선택 안내를 노출하지 않는다', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '즐겨찾기 리포트' })).toBeInTheDocument()
    expect(screen.queryByText('레포트를 선택하세요')).not.toBeInTheDocument()
  })

  it('즐겨찾기가 있으면 기본 화면에 즐겨찾기 카드를 렌더링한다', async () => {
    vi.mocked(reportsApi.favorites).mockResolvedValue([FAV])
    renderPage()
    expect(await screen.findByRole('button', { name: '즐겨찾기 레포트 열기' })).toBeInTheDocument()
  })

  it('즐겨찾기 보기에서 카드 클릭 시 단일 레포트 상세로 이동한다', async () => {
    vi.mocked(reportsApi.favorites).mockResolvedValue([FAV])
    renderPage('/?fav=1')
    fireEvent.click(await screen.findByRole('button', { name: '즐겨찾기 레포트 열기' }))
    expect(navigateMock).toHaveBeenCalledWith('/reports/99')
  })

  it('즐겨찾기 보기에서 즐겨찾기가 없으면 안내 문구를 표시한다', async () => {
    renderPage('/?fav=1')
    expect(await screen.findByText(/즐겨찾기한 레포트가 없습니다/)).toBeInTheDocument()
  })

  it('별 토글 클릭 시 즐겨찾기 해제를 호출한다', async () => {
    vi.mocked(reportsApi.favorites).mockResolvedValue([FAV])
    renderPage('/?fav=1')
    await screen.findByRole('button', { name: '즐겨찾기 레포트 열기' })
    fireEvent.click(screen.getByRole('button', { name: '즐겨찾기 해제' }))
    await waitFor(() => expect(reportsApi.removeFavorite).toHaveBeenCalledWith(99))
  })
})
