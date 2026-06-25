import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import UsersPage from './UsersPage'
import RolesPage from './RolesPage'
import GroupsPage from './GroupsPage'
import { usersApi, rolesApi, groupsApi } from '@/api/adminApi'
import type { GroupResponse, RoleResponse, UserListItem, GroupMemberItem } from '@/types/admin'

vi.mock('@/api/adminApi', () => ({
  usersApi: { list: vi.fn(), setStatus: vi.fn(), assignRole: vi.fn(), revokeRole: vi.fn() },
  rolesApi: { list: vi.fn() },
  groupsApi: {
    list: vi.fn(), members: vi.fn(), create: vi.fn(), remove: vi.fn(),
    addMember: vi.fn(), removeMember: vi.fn(),
  },
}))

const USERS: UserListItem[] = [
  { id: 1, emp_no: '1001', name: '홍길동', email: 'h@x.com', roles: ['General_User'], is_active: true },
  { id: 2, emp_no: '1002', name: '김영희', roles: ['General_User', 'System_Operator'], is_active: false },
]
const ROLES: RoleResponse[] = [
  { id: 1, code: 'General_User', name: '일반 사용자' },
  { id: 2, code: 'Super_User', name: '슈퍼 유저' },
  { id: 3, code: 'System_Operator', name: '시스템 운영자' },
]
const GROUPS: GroupResponse[] = [{ id: 5, name: '영업팀', description: null }]
const MEMBERS: GroupMemberItem[] = [{ id: 1, emp_no: '1001', name: '홍길동' }]

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usersApi.list).mockResolvedValue(USERS)
  vi.mocked(usersApi.setStatus).mockResolvedValue(USERS[0])
  vi.mocked(usersApi.assignRole).mockResolvedValue(undefined as never)
  vi.mocked(usersApi.revokeRole).mockResolvedValue(undefined as never)
  vi.mocked(rolesApi.list).mockResolvedValue(ROLES)
  vi.mocked(groupsApi.list).mockResolvedValue(GROUPS)
  vi.mocked(groupsApi.members).mockResolvedValue(MEMBERS)
  vi.mocked(groupsApi.create).mockResolvedValue({ id: 6, name: '신규', description: null })
  vi.mocked(groupsApi.addMember).mockResolvedValue(undefined as never)
  vi.mocked(groupsApi.removeMember).mockResolvedValue(undefined as never)
})

describe('UsersPage', () => {
  it('사용자 목록을 렌더링하고 비활성화 버튼으로 상태를 전환한다', async () => {
    wrap(<UsersPage />)
    expect(await screen.findByText('홍길동')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '비활성화' })[0])
    await waitFor(() => expect(usersApi.setStatus).toHaveBeenCalledWith(1, false))
  })
})

describe('RolesPage', () => {
  it('역할 체크 시 부여, General_User는 비활성화', async () => {
    wrap(<RolesPage />)
    // 홍길동 Super_User 체크박스(미보유) → 부여
    const cb = await screen.findByLabelText('홍길동 슈퍼 유저')
    fireEvent.click(cb)
    await waitFor(() => expect(usersApi.assignRole).toHaveBeenCalledWith(1, 'Super_User'))
    // General_User는 잠김
    expect((screen.getByLabelText('홍길동 일반 사용자') as HTMLInputElement).disabled).toBe(true)
  })
})

describe('GroupsPage', () => {
  it('그룹 선택 시 멤버를 보여주고 멤버 제거를 호출한다', async () => {
    wrap(<GroupsPage />)
    fireEvent.click(await screen.findByText('영업팀'))
    fireEvent.click(await screen.findByRole('button', { name: '홍길동 제거' }))
    await waitFor(() => expect(groupsApi.removeMember).toHaveBeenCalledWith(5, 1))
  })

  it('새 그룹을 생성한다', async () => {
    wrap(<GroupsPage />)
    fireEvent.change(await screen.findByLabelText('새 그룹 이름'), { target: { value: '신규' } })
    fireEvent.click(screen.getByRole('button', { name: /추가/ }))
    await waitFor(() => expect(groupsApi.create).toHaveBeenCalledWith('신규'))
  })
})
