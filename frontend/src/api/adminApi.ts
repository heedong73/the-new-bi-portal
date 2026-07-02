/** 관리자 API 래퍼 — users / groups / roles (System_Operator 전용). */
import apiClient, { request } from '@/api/client'
import type {
  GroupMemberItem,
  GroupResponse,
  GroupTreeResponse,
  Holiday,
  HolidayCreate,
  OrgCompany,
  OrgMember,
  OrgNode,
  RoleResponse,
  TeamGroupSyncResult,
  UserListItem,
} from '@/types/admin'

export const usersApi = {
  /** GET /api/users — 전체 사용자 목록. */
  list: (signal?: AbortSignal) => apiClient.get<UserListItem[]>('/api/users', { signal }),

  /** PATCH /api/users/{id}/status — 활성/비활성 전환. */
  setStatus: (userId: number, isActive: boolean) =>
    request<UserListItem>(`/api/users/${userId}/status`, {
      method: 'PATCH',
      body: { is_active: isActive },
    }),

  /** POST /api/users/{id}/roles — 역할 부여(멱등). */
  assignRole: (userId: number, roleCode: string) =>
    apiClient.post<void>(`/api/users/${userId}/roles`, { role_code: roleCode }),

  /** DELETE /api/users/{id}/roles/{code} — 역할 회수. */
  revokeRole: (userId: number, roleCode: string) =>
    request<void>(`/api/users/${userId}/roles/${encodeURIComponent(roleCode)}`, {
      method: 'DELETE',
    }),
}

export const orgApi = {
  /** GET /api/org/companies — 회사(조직 최상위) 목록. */
  companies: (signal?: AbortSignal) =>
    apiClient.get<OrgCompany[]>('/api/org/companies', { signal }),
  /** GET /api/org/tree — 조직도 트리 (cmp_id 한정 옵션). */
  tree: (cmpId?: string, signal?: AbortSignal) =>
    apiClient.get<OrgNode[]>('/api/org/tree', { query: { cmp_id: cmpId }, signal }),
  /** GET /api/org/members — 부서 구성원 + BIP 등록 상태. */
  members: (
    params: { deptId?: string; q?: string; descendants?: boolean },
    signal?: AbortSignal,
  ) =>
    apiClient.get<OrgMember[]>('/api/org/members', {
      query: { dept_id: params.deptId, q: params.q, descendants: params.descendants },
      signal,
    }),
  /** POST /api/org/members/{emp_no}/groups — 권한 그룹 부여(다중, 미등록 자동등록). */
  addGroup: (empNo: string, groupId: number) =>
    apiClient.post<void>(`/api/org/members/${encodeURIComponent(empNo)}/groups`, { group_id: groupId }),
  /** DELETE /api/org/members/{emp_no}/groups/{group_id} — 권한 그룹 회수. */
  removeGroup: (empNo: string, groupId: number) =>
    request<void>(`/api/org/members/${encodeURIComponent(empNo)}/groups/${groupId}`, { method: 'DELETE' }),
  /** PUT /api/org/members/{emp_no}/role-level — 역할 레벨 설정(미등록 자동등록). */
  setRoleLevel: (empNo: string, roleCode: string) =>
    request<void>(`/api/org/members/${encodeURIComponent(empNo)}/role-level`, {
      method: 'PUT', body: { role_code: roleCode },
    }),
  /** POST /api/org/sync-team-groups — 조직도 기반 팀 그룹 생성/완전 동기화. apply=false면 미리보기. */
  syncTeamGroups: (deptId: string, apply: boolean) =>
    apiClient.post<TeamGroupSyncResult>('/api/org/sync-team-groups', { dept_id: deptId, apply }),
}

export const groupsApi = {
  list: (signal?: AbortSignal) => apiClient.get<GroupResponse[]>('/api/groups', { signal }),
  /** GET /api/groups/tree — 전체 조직 트리(팀 그룹 상태 포함, cmp_id 한정 옵션) + 기타(수동) 그룹. */
  tree: (cmpId?: string, signal?: AbortSignal) =>
    apiClient.get<GroupTreeResponse>('/api/groups/tree', { query: { cmp_id: cmpId }, signal }),
  members: (groupId: number, signal?: AbortSignal) =>
    apiClient.get<GroupMemberItem[]>(`/api/groups/${groupId}/members`, { signal }),
  create: (name: string, description?: string) =>
    apiClient.post<GroupResponse>('/api/groups', { name, description }),
  update: (groupId: number, body: { name?: string; description?: string }) =>
    request<GroupResponse>(`/api/groups/${groupId}`, { method: 'PATCH', body }),
  remove: (groupId: number) =>
    request<void>(`/api/groups/${groupId}`, { method: 'DELETE' }),
  addMember: (groupId: number, userId: number) =>
    apiClient.post<void>(`/api/groups/${groupId}/members`, { user_id: userId }),
  removeMember: (groupId: number, userId: number) =>
    request<void>(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
}

export const rolesApi = {
  list: (signal?: AbortSignal) => apiClient.get<RoleResponse[]>('/api/roles', { signal }),
}

export const holidaysApi = {
  /** GET /api/holidays — 공휴일 목록(연도 필터). */
  list: (year?: number, signal?: AbortSignal) =>
    apiClient.get<Holiday[]>('/api/holidays', { query: { year }, signal }),
  /** POST /api/holidays — 사내/대체 공휴일 추가. */
  create: (body: HolidayCreate) => apiClient.post<Holiday>('/api/holidays', body),
  /** DELETE /api/holidays/{id} — 공휴일 삭제. */
  remove: (id: number) => request<void>(`/api/holidays/${id}`, { method: 'DELETE' }),
  /** POST /api/holidays/seed — 국가/대체 공휴일 자동 시드. */
  seed: (year: number) =>
    apiClient.post<{ year: number; added: number }>('/api/holidays/seed', { year }),
}
