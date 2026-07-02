import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import AuthGuard from './AuthGuard'
import AppLayout from './AppLayout'
import { authApi } from '@/api/authApi'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/useAuthStore'
import type { UserSummary } from '@/types/auth'

vi.mock('@/api/authApi', () => ({
  authApi: { me: vi.fn(), logout: vi.fn() },
}))

// AppLayout이 SidebarFolderTree를 통해 폴더 트리를 조회하므로 mock 처리.
vi.mock('@/api/portalApi', () => ({
  foldersApi: { tree: vi.fn().mockResolvedValue([]) },
}))

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/login" element={<div>로그인 화면</div>} />
          <Route element={<AuthGuard />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<div>홈 본문</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const OPERATOR: UserSummary = { id: 1, emp_no: '1001', name: '운영자', roles: ['System_Operator'] }
const GENERAL: UserSummary = { id: 2, emp_no: '1002', name: '일반', roles: ['General_User'] }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.getState().clear()
  vi.mocked(authApi.logout).mockResolvedValue({ status: 'ok' })
})

describe('AuthGuard', () => {
  it('미인증(401)이면 로그인으로 보낸다', async () => {
    vi.mocked(authApi.me).mockRejectedValue(new ApiError({ status: 401, errorCode: 'UNAUTHENTICATED' }))
    wrap('/')
    expect(await screen.findByText('로그인 화면')).toBeInTheDocument()
  })

  it('인증되면 본문과 레이아웃을 렌더링한다', async () => {
    vi.mocked(authApi.me).mockResolvedValue(OPERATOR)
    wrap('/')
    expect(await screen.findByText('홈 본문')).toBeInTheDocument()
    expect(screen.getByText('운영자')).toBeInTheDocument()
  })
})

describe('AppLayout 메뉴 (역할별)', () => {
  it('System_Operator는 관리자/통계 메뉴를 본다', async () => {
    vi.mocked(authApi.me).mockResolvedValue(OPERATOR)
    wrap('/')
    expect(await screen.findByText('관리자 콘솔')).toBeInTheDocument()
    expect(screen.getByText('통계')).toBeInTheDocument()
  })

  it('General_User는 관리자/통계 메뉴가 보이지 않는다', async () => {
    vi.mocked(authApi.me).mockResolvedValue(GENERAL)
    wrap('/')
    expect(await screen.findByText('레포트')).toBeInTheDocument()
    expect(screen.queryByText('관리자 콘솔')).not.toBeInTheDocument()
    expect(screen.queryByText('통계')).not.toBeInTheDocument()
  })

  it('로그아웃 시 logout 호출 후 로그인으로 이동', async () => {
    vi.mocked(authApi.me).mockResolvedValue(OPERATOR)
    wrap('/')
    fireEvent.click(await screen.findByRole('button', { name: /로그아웃/ }))
    await waitFor(() => expect(authApi.logout).toHaveBeenCalled())
    expect(await screen.findByText('로그인 화면')).toBeInTheDocument()
  })
})
