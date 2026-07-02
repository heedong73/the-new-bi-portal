import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import ReportsPage from './ReportsPage'
import { reportAdminApi, foldersAdminApi } from '@/api/reportAdminApi'
import { foldersApi } from '@/api/portalApi'
import { usersApi, groupsApi } from '@/api/adminApi'
import type { ReportAdmin } from '@/types/reportAdmin'

vi.mock('@/api/reportAdminApi', () => ({
  reportAdminApi: {
    list: vi.fn(), update: vi.fn(), remove: vi.fn(),
    setVisibility: vi.fn(), setFolder: vi.fn(), setSortOrder: vi.fn(),
    permissions: vi.fn(), grant: vi.fn(), revoke: vi.fn(),
    importPbix: vi.fn(), importStatus: vi.fn(),
  },
  foldersAdminApi: {
    list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), setSortOrder: vi.fn(),
  },
}))
vi.mock('@/api/portalApi', () => ({ foldersApi: { tree: vi.fn() } }))
vi.mock('@/api/adminApi', () => ({
  usersApi: { list: vi.fn() }, groupsApi: { list: vi.fn() },
  orgApi: { members: vi.fn() },
}))

const REPORTS: ReportAdmin[] = [
  { id: 1, workspace_id: 'ws', report_id: 'pbi-1', display_name: '월간 매출', is_published: true, folder_id: null, created_at: '2026-06-24T00:00:00Z', created_by_label: '홍길동', description: '영업 실적 요약' },
]
const FOLDERS = [
  { id: 1, parent_id: null, name: '영업부', folder_type: null, sort_order: 0 },
  { id: 2, parent_id: 1, name: '국내영업', folder_type: null, sort_order: 0 },
]

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reportAdminApi.list).mockResolvedValue(REPORTS)
  vi.mocked(reportAdminApi.remove).mockResolvedValue(undefined as never)
  vi.mocked(reportAdminApi.setVisibility).mockResolvedValue({ ...REPORTS[0], is_published: true })
  vi.mocked(reportAdminApi.permissions).mockResolvedValue([])
  vi.mocked(foldersAdminApi.list).mockResolvedValue(FOLDERS as never)
  vi.mocked(foldersAdminApi.create).mockResolvedValue(FOLDERS[0] as never)
  vi.mocked(foldersApi.tree).mockResolvedValue([])
  vi.mocked(usersApi.list).mockResolvedValue([])
  vi.mocked(groupsApi.list).mockResolvedValue([])
})

describe('ReportsPage', () => {
  it('등록 레포트 목록과 메타(등록일·생성자 컬럼)를 렌더링한다', async () => {
    wrap(<ReportsPage />)
    expect(await screen.findByText('월간 매출')).toBeInTheDocument()
    expect(screen.getByText('2026-06-24')).toBeInTheDocument()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
  })

  it('공개 버튼은 더 이상 노출되지 않는다 (권한 기반 가시성)', async () => {
    wrap(<ReportsPage />)
    await screen.findByText('월간 매출')
    expect(screen.queryByText('공개')).not.toBeInTheDocument()
    expect(screen.queryByText('비공개')).not.toBeInTheDocument()
  })

  it('권한 버튼 클릭 시 권한 패널을 연다', async () => {
    wrap(<ReportsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /권한/ }))
    expect(await screen.findByText('권한 부여')).toBeInTheDocument()
  })

  it('폴더 트리(하위 폴더 포함)를 렌더링한다', async () => {
    wrap(<ReportsPage />)
    // 폴더명은 트리 span과 레포트 이동 select option 양쪽에 나타나므로 트리 span으로 특정
    expect(await screen.findByText('영업부', { selector: 'span' })).toBeInTheDocument()
    expect(await screen.findByText('국내영업', { selector: 'span' })).toBeInTheDocument() // 하위 폴더
  })

  it('폴더 추가 버튼으로 루트 폴더를 생성한다', async () => {
    wrap(<ReportsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '폴더 추가' }))
    fireEvent.change(await screen.findByLabelText('새 폴더 이름'), { target: { value: '신규부서' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(foldersAdminApi.create).toHaveBeenCalledWith('신규부서', null))
  })

  it('삭제 버튼 → 확인 모달 → remove 호출', async () => {
    wrap(<ReportsPage />)
    fireEvent.click(await screen.findByLabelText('월간 매출 삭제'))
    expect(await screen.findByText(/삭제하시겠습니까/)).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: '레포트 삭제 확인' })
    fireEvent.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(reportAdminApi.remove).toHaveBeenCalledWith(1))
  })
})
