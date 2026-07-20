import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import LoginPage from './LoginPage'
import { authApi } from '@/api/authApi'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/useAuthStore'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/api/authApi', () => ({
  authApi: { login: vi.fn() },
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().clear()
  })

  it('ID/비밀번호 필드와 로그인 버튼을 렌더링한다', () => {
    renderPage()
    expect(screen.getByLabelText('ID')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument()
  })

  it('비밀번호 표시/숨김 토글이 input type을 바꾼다', () => {
    renderPage()
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 표시' }))
    expect(pw.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
    expect(pw.type).toBe('password')
  })

  it('HR 로그인만 제공하고 사내망 접속 안내를 표시한다', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /로컬 관리자로 로그인/ })).not.toBeInTheDocument()
    expect(screen.getByText('안전한 사내망 내에서만 접속 가능합니다.')).toBeInTheDocument()
  })

  it('로그인 성공 시 사용자 저장 + "/"로 이동한다', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      user: { id: 1, emp_no: '1001', name: '홍길동', roles: ['General_User'] },
    })
    renderPage()
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))
    expect(useAuthStore.getState().user?.name).toBe('홍길동')
  })

  it('401 실패 시 한국어 오류 메시지를 표시한다', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError({ status: 401, errorCode: 'UNAUTHENTICATED', errorDescription: '사번 또는 비밀번호가 올바르지 않습니다.' }),
    )
    renderPage()
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: '1001' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('사번 또는 비밀번호가 올바르지 않습니다.')
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
