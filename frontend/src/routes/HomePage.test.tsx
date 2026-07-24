import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import HomePage from './HomePage'
import { foldersApi, reportsApi } from '@/api/portalApi'
import { useAuthStore } from '@/stores/useAuthStore'
import type { FolderTreeNode, ReportSummary } from '@/types/report'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/api/portalApi', () => ({
  foldersApi: { tree: vi.fn() },
  reportsApi: {
    catalog: vi.fn(),
    recent: vi.fn(),
    favorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
}))

const TREE: FolderTreeNode[] = [{
  id: 10,
  name: 'SAMCHULLY',
  sort_order: 0,
  report_ids: [],
  children: [{
    id: 11,
    name: '센터',
    sort_order: 0,
    report_ids: [99],
    children: [],
  }],
}]

const FAV: ReportSummary = {
  id: 99,
  workspace_id: 'ws',
  report_id: 'rpt',
  display_name: '즐겨찾기 레포트',
  description: null,
  category: null,
  folder_id: 1,
  is_published: true,
  is_favorite: true,
}

function renderPage(initial = '/reports') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: {
        id: 1,
        emp_no: '1001',
        name: '서희연',
        department_name: '디지털기획팀',
        roles: ['General_User'],
      },
    })
    vi.mocked(foldersApi.tree).mockResolvedValue(TREE)
    vi.mocked(reportsApi.catalog).mockResolvedValue({ items: [], total: 0, limit: 12, offset: 0 })
    vi.mocked(reportsApi.recent).mockResolvedValue([])
    vi.mocked(reportsApi.favorites).mockResolvedValue([])
    vi.mocked(reportsApi.addFavorite).mockResolvedValue(undefined as never)
    vi.mocked(reportsApi.removeFavorite).mockResolvedValue(undefined as never)
  })

  it('기본 진입 시 개인화 환영문과 탐색 섹션을 표시한다', async () => {
    renderPage('/reports?root=10&folder=11&q=매출')
    expect(await screen.findByRole('heading', { name: /환영합니다.*서희연.*님/ })).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: '전체 레포트 검색' })
    expect(search).toHaveValue('매출')
    expect(screen.getByRole('heading', { name: '최근 본 리포트' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '즐겨찾기' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '레포트 둘러보기' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '리포트 탐색 목록' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /센터/ })).toBeInTheDocument()
    await waitFor(() => {
      expect(vi.mocked(reportsApi.catalog).mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        q: '매출',
        rootFolderId: 10,
        folderId: 11,
      }))
    })
    fireEvent.click(screen.getByRole('button', { name: '검색어 초기화' }))
    expect(search).toHaveValue('')
    expect(navigateMock).toHaveBeenCalledWith('/reports?root=10&folder=11', { replace: true })
    expect(screen.queryByText('레포트를 선택하세요')).not.toBeInTheDocument()
  })

  it('즐겨찾기가 있으면 홈 요약 패널에 리포트를 렌더링한다', async () => {
    vi.mocked(reportsApi.favorites).mockResolvedValue([FAV])
    renderPage()
    expect(await screen.findByRole('button', { name: '즐겨찾기 레포트 열기' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /SAMCHULLY/ }))
    expect(navigateMock).toHaveBeenCalledWith('/reports?root=10')
  })

  it('즐겨찾기 전체보기에서 카드 클릭 시 단일 레포트 상세로 이동한다', async () => {
    vi.mocked(reportsApi.favorites).mockResolvedValue([FAV])
    renderPage('/reports/favorites')
    fireEvent.click(await screen.findByRole('button', { name: '즐겨찾기 레포트 열기' }))
    expect(navigateMock).toHaveBeenCalledWith('/reports/99')
  })

  it('즐겨찾기 전체보기에서 항목이 없으면 안내 문구를 표시한다', async () => {
    renderPage('/reports/favorites')
    expect(await screen.findByText('즐겨찾기한 리포트가 없습니다.')).toBeInTheDocument()
  })

  it('별 토글 클릭 시 즐겨찾기 해제를 호출한다', async () => {
    vi.mocked(reportsApi.favorites).mockResolvedValue([FAV])
    renderPage('/reports/favorites')
    await screen.findByRole('button', { name: '즐겨찾기 레포트 열기' })
    fireEvent.click(screen.getByRole('button', { name: '즐겨찾기 해제' }))
    await waitFor(() => expect(reportsApi.removeFavorite).toHaveBeenCalledWith(99))
  })
})
