/** 관리자 API 래퍼 — users / groups / roles (System_Operator 전용). */
import apiClient, { request } from '@/api/client'
import type {
  GroupMemberItem,
  GroupResponse,
  Holiday,
  HolidayCreate,
  RoleResponse,
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

export const groupsApi = {
  list: (signal?: AbortSignal) => apiClient.get<GroupResponse[]>('/api/groups', { signal }),
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
