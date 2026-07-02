import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import UsersPage from './UsersPage'
import GroupsPage from './GroupsPage'
import { usersApi, rolesApi, groupsApi, orgApi } from '@/api/adminApi'
import type {
  GroupResponse, RoleResponse, UserListItem, GroupMemberItem, OrgCompany, OrgNode, OrgMember,
} from '@/types/admin'

vi.mock('@/api/adminApi', () => ({
  usersApi: {
    list: vi.fn(), setStatus: vi.fn(), assignRole: vi.fn(), revokeRole: vi.fn(),
  },
  rolesApi: { list: vi.fn() },
  groupsApi: {
    list: vi.fn(), tree: vi.fn(), members: vi.fn(), create: vi.fn(), remove: vi.fn(),
    addMember: vi.fn(), removeMember: vi.fn(),
  },
  orgApi: {
    companies: vi.fn(), tree: vi.fn(), members: vi.fn(),
    addGroup: vi.fn(), removeGroup: vi.fn(), setRoleLevel: vi.fn(),
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

const ORG_COMPANIES: OrgCompany[] = [{ cmp_id: 'C1', dept_id: 'C1', dept_name: '회사A' }]
const ORG_TREE: OrgNode[] = [
  { dept_id: 'C1', dept_name: '회사A', depth: 1, children: [
    { dept_id: 'D1', dept_name: '영업팀', depth: 2, children: [] },
  ] },
]
const ORG_MEMBERS: OrgMember[] = [
  { emp_no: '1001', name: '홍길동', email: 'h@x.com', dept_name: '영업팀', ofc_name: '팀장',
    registered: true, user_id: 1, is_active: true, role_level: 'General_User', groups: [{ id: 5, name: '영업팀' }] },
  { emp_no: '1002', name: '김영희', dept_name: '영업팀', ofc_name: '팀원', registered: false, groups: [] },
]

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
  vi.mocked(groupsApi.tree).mockResolvedValue({ tree: [], ungrouped: GROUPS })
  vi.mocked(groupsApi.members).mockResolvedValue(MEMBERS)
  vi.mocked(groupsApi.create).mockResolvedValue({ id: 6, name: '신규', description: null })
  vi.mocked(groupsApi.addMember).mockResolvedValue(undefined as never)
  vi.mocked(groupsApi.removeMember).mockResolvedValue(undefined as never)
  vi.mocked(orgApi.companies).mockResolvedValue(ORG_COMPANIES)
  vi.mocked(orgApi.tree).mockResolvedValue(ORG_TREE)
  vi.mocked(orgApi.members).mockResolvedValue(ORG_MEMBERS)
  vi.mocked(orgApi.addGroup).mockResolvedValue(undefined as never)
  vi.mocked(orgApi.removeGroup).mockResolvedValue(undefined as never)
  vi.mocked(orgApi.setRoleLevel).mockResolvedValue(undefined as never)
})

describe('UsersPage', () => {
  it('조직도에서 부서를 선택하면 구성원을 보여주고 미등록자에 그룹을 부여(자동등록)한다', async () => {
    wrap(<UsersPage />)
    fireEvent.click(await screen.findByRole('button', { name: '회사A' }))
    expect(await screen.findByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText('김영희')).toBeInTheDocument()
    // 미등록자(김영희)에게 그룹 추가 → emp_no 기준 자동등록+부여
    fireEvent.change(screen.getByLabelText('1002 권한 그룹 추가'), { target: { value: '5' } })
    await waitFor(() => expect(orgApi.addGroup).toHaveBeenCalledWith('1002', 5))
  })

  it('등록된 구성원의 그룹 제거와 역할 변경(일괄 저장)을 호출한다', async () => {
    wrap(<UsersPage />)
    fireEvent.click(await screen.findByRole('button', { name: '회사A' }))
    await screen.findByText('홍길동')
    // 그룹 칩 제거
    fireEvent.click(screen.getByRole('button', { name: '1001 영업팀 그룹 제거' }))
    await waitFor(() => expect(orgApi.removeGroup).toHaveBeenCalledWith('1001', 5))
    // 역할 변경(스테이징) 후 일괄 저장
    fireEvent.change(screen.getByLabelText('1001 역할'), { target: { value: 'System_Operator' } })
    fireEvent.click(screen.getByRole('button', { name: '역할 변경 저장' }))
    await waitFor(() => expect(orgApi.setRoleLevel).toHaveBeenCalledWith('1001', 'System_Operator'))
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
