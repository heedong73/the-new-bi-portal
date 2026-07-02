/** 레포트 카탈로그/폴더 API 래퍼 (BIP 포털). */
import apiClient from '@/api/client'
import type { EmbedInfo, FolderTreeNode, RefreshStatus, ReportSummary } from '@/types/report'

export const foldersApi = {
  /** GET /api/report-folders/tree — VIEW 권한 필터된 폴더 트리. */
  tree: (signal?: AbortSignal) =>
    apiClient.get<FolderTreeNode[]>('/api/report-folders/tree', { signal }),
}

export const reportsApi = {
  /** GET /api/reports — VIEW 권한 + 공개 레포트 목록. folderId 지정 시 해당 폴더만. */
  list: (folderId?: number | null, signal?: AbortSignal) =>
    apiClient.get<ReportSummary[]>('/api/reports', {
      query: { folder_id: folderId ?? undefined },
      signal,
    }),

  /** GET /api/reports/{id}/embed — Report 한정 Embed Token 발급. */
  embed: (reportDbId: number, signal?: AbortSignal) =>
    apiClient.get<EmbedInfo>(`/api/reports/${reportDbId}/embed`, { signal }),

  /** GET /api/reports/{id}/refresh-status — 마지막 새로고침 + 다음 예약. */
  refreshStatus: (reportDbId: number, signal?: AbortSignal) =>
    apiClient.get<RefreshStatus>(`/api/reports/${reportDbId}/refresh-status`, { signal }),

  /** GET /api/reports/{id}/live-refresh-status — Power BI 직접 최신 새로고침 상태(실시간) + 예약 정보. */
  liveRefreshStatus: (reportDbId: number, signal?: AbortSignal) =>
    apiClient.get<{
      has_history: boolean
      status: string | null
      in_progress: boolean
      start_time?: string | null
      end_time?: string | null
      schedule?: {
        enabled: boolean
        days: string[]
        times: string[]
        timezone: string | null
        next_scheduled_local: string | null
      } | null
    }>(
      `/api/reports/${reportDbId}/live-refresh-status`, { signal },
    ),

  /** POST /api/reports/{id}/replace-pbix — PBIX 재업로드로 레포트 교체 (MANAGE_REPORT 권한). */
  replacePbix: (reportDbId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post<{ task_id: string; status: string; report_id: number }>(
      `/api/reports/${reportDbId}/replace-pbix`, fd,
    )
  },

  /** GET /api/reports/favorites — 내 즐겨찾기 레포트 목록. */
  favorites: (signal?: AbortSignal) =>
    apiClient.get<ReportSummary[]>('/api/reports/favorites', { signal }),
  /** PUT /api/reports/{id}/favorite — 즐겨찾기 추가. */
  addFavorite: (reportDbId: number) =>
    apiClient.put<void>(`/api/reports/${reportDbId}/favorite`),
  /** DELETE /api/reports/{id}/favorite — 즐겨찾기 해제. */
  removeFavorite: (reportDbId: number) =>
    apiClient.del<void>(`/api/reports/${reportDbId}/favorite`),
}

export const datasetsApi = {
  /** POST /api/datasets/{datasetId}/refresh — 수동 새로고침 (REFRESH 권한). */
  triggerRefresh: (datasetId: string) =>
    apiClient.post<{ status: string; taskId?: string; dataset_id: string }>(
      `/api/datasets/${encodeURIComponent(datasetId)}/refresh`,
    ),
}
