/** 레포트 관리/권한 API 래퍼 (System_Operator). */
import apiClient, { request } from '@/api/client'
import type {
  FolderItem,
  PermissionGrant,
  ReportAdmin,
  ReportCreate,
  ReportPermission,
  WorkspaceReportItem,
} from '@/types/reportAdmin'

export const foldersAdminApi = {
  /** 전체 폴더 flat 목록 (System_Operator). */
  list: (signal?: AbortSignal) =>
    apiClient.get<FolderItem[]>('/api/report-folders', { signal }),
  /** 폴더 생성 (parent_id로 하위 폴더). */
  create: (name: string, parentId: number | null) =>
    apiClient.post<FolderItem>('/api/report-folders', { name, parent_id: parentId, sort_order: 0 }),
  /** 폴더 이름 수정. */
  rename: (id: number, name: string) =>
    request<FolderItem>(`/api/report-folders/${id}`, { method: 'PATCH', body: { name } }),
  /** 폴더 표시 순서 변경 (같은 레벨 정렬). */
  setSortOrder: (id: number, sortOrder: number) =>
    request<FolderItem>(`/api/report-folders/${id}`, { method: 'PATCH', body: { sort_order: sortOrder } }),
  /** 폴더 삭제 (하위 폴더/레포트 있으면 409). */
  remove: (id: number) =>
    request<void>(`/api/report-folders/${id}`, { method: 'DELETE' }),
}

export const reportAdminApi = {
  /** 라이브 PBI 워크스페이스 레포트 목록 (등록 선택용). */
  workspaceReports: (signal?: AbortSignal) =>
    apiClient.get<WorkspaceReportItem[]>('/api/powerbi/workspace-reports', { signal }),

  /** BIP 등록 레포트 목록 (관리자: 미공개 포함 전체). */
  list: (signal?: AbortSignal) =>
    apiClient.get<ReportAdmin[]>('/api/reports/all', { signal }),

  /** 레포트 등록 (ID 수동 + workspace auto-upsert). */
  create: (body: ReportCreate) => apiClient.post<ReportAdmin>('/api/reports', body),

  /** 레포트 메타 수정 (표시명/설명/카테고리/작성자). */
  update: (id: number, body: { display_name?: string; description?: string; category?: string; author_label?: string | null }) =>
    request<ReportAdmin>(`/api/reports/${id}`, { method: 'PATCH', body }),

  /** 레포트 등록 삭제 (BIP 카탈로그에서 제거). */
  remove: (id: number) => request<void>(`/api/reports/${id}`, { method: 'DELETE' }),

  /** 레포트 표시 순서 변경 (같은 폴더 내 정렬). */
  setSortOrder: (id: number, sortOrder: number) =>
    request<ReportAdmin>(`/api/reports/${id}`, { method: 'PATCH', body: { sort_order: sortOrder } }),

  /** 공개/비공개 전환. */
  setVisibility: (id: number, isPublished: boolean) =>
    request<ReportAdmin>(`/api/reports/${id}/visibility`, {
      method: 'PATCH',
      body: { is_published: isPublished },
    }),

  /** 폴더 이동. */
  setFolder: (id: number, folderId: number | null) =>
    request<ReportAdmin>(`/api/reports/${id}/folder`, {
      method: 'PATCH',
      body: { folder_id: folderId },
    }),

  /** 권한 목록. */
  permissions: (id: number, signal?: AbortSignal) =>
    apiClient.get<ReportPermission[]>(`/api/reports/${id}/permissions`, { signal }),

  /** 권한 부여. */
  grant: (id: number, body: PermissionGrant) =>
    apiClient.post<ReportPermission>(`/api/reports/${id}/permissions`, body),

  /** 권한 회수. */
  revoke: (id: number, permissionId: number) =>
    request<void>(`/api/reports/${id}/permissions/${permissionId}`, { method: 'DELETE' }),

  /** PBIX 업로드 → 신규 게시 (multipart). task_id 반환. */
  importPbix: (file: File, reportName: string, folderId?: number | null, description?: string | null, authorLabel?: string | null) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('report_name', reportName)
    if (folderId != null) fd.append('folder_id', String(folderId))
    if (description != null && description !== '') fd.append('description', description)
    if (authorLabel != null && authorLabel !== '') fd.append('author_label', authorLabel)
    return request<{ task_id: string; status: string; report_name: string }>(
      '/api/reports/import-pbix',
      { method: 'POST', body: fd },
    )
  },

  /** PBIX import 진행 상태. */
  importStatus: (taskId: string) =>
    apiClient.get<{ task_id: string; state: string; result?: unknown; error?: string }>(
      `/api/reports/import-status/${taskId}`,
    ),
}
