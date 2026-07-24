/** 레포트 카탈로그/폴더 API 래퍼 (BIP 포털). */
import apiClient, { API_BASE_URL } from '@/api/client'
import type {
  EmbedInfo, ExportFormat, ExportStatusResponse, FolderTreeNode, RefreshStatus,
  ReportCatalogParams, ReportCatalogResponse, ReportSummary,
} from '@/types/report'

export const foldersApi = {
  /** GET /api/report-folders/tree — VIEW 권한과 선택적 검색어로 필터된 폴더 트리. */
  tree: (signal?: AbortSignal, q?: string) =>
    apiClient.get<FolderTreeNode[]>('/api/report-folders/tree', {
      query: { q: q || undefined },
      signal,
    }),
}

export const reportsApi = {
  /** GET /api/reports — VIEW 권한 + 공개 레포트 목록. folderId 지정 시 해당 폴더만. */
  list: (folderId?: number | null, signal?: AbortSignal) =>
    apiClient.get<ReportSummary[]>('/api/reports', {
      query: { folder_id: folderId ?? undefined },
      signal,
    }),

  /** 검색·카테고리·최신/최근 30일 인기순 레포트 카탈로그. */
  catalog: (params: ReportCatalogParams = {}, signal?: AbortSignal) =>
    apiClient.get<ReportCatalogResponse>('/api/reports/catalog', {
      query: {
        q: params.q || undefined,
        root_folder_id: params.rootFolderId ?? undefined,
        folder_id: params.folderId ?? undefined,
        sort: params.sort ?? 'latest',
        limit: params.limit ?? 24,
        offset: params.offset ?? 0,
      },
      signal,
    }),

  /** 현재 사용자의 최근 본 레포트. */
  recent: (limit?: number, signal?: AbortSignal) =>
    apiClient.get<ReportSummary[]>('/api/reports/recent', {
      query: { limit },
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

  /** PUT /api/reports/{id}/default-view — 공통 기본 뷰 상태 저장/초기화 (MANAGE_REPORT 권한). */
  saveDefaultView: (reportDbId: number, state: string | null) =>
    apiClient.put<void>(`/api/reports/${reportDbId}/default-view`, { state }),

  /** POST /api/reports/{id}/replace-pbix — PBIX 재업로드로 레포트 교체 (MANAGE_REPORT 권한). */
  replacePbix: (reportDbId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post<{ task_id: string; status: string; report_id: number }>(
      `/api/reports/${reportDbId}/replace-pbix`, fd,
    )
  },

  /** GET /api/reports/favorites — 최근 조회순 내 즐겨찾기 레포트 목록. */
  favorites: (limit?: number, signal?: AbortSignal) =>
    apiClient.get<ReportSummary[]>('/api/reports/favorites', {
      query: { limit },
      signal,
    }),
  /** PUT /api/reports/{id}/favorite — 즐겨찾기 추가. */
  addFavorite: (reportDbId: number) =>
    apiClient.put<void>(`/api/reports/${reportDbId}/favorite`),
  /** DELETE /api/reports/{id}/favorite — 즐겨찾기 해제. */
  removeFavorite: (reportDbId: number) =>
    apiClient.del<void>(`/api/reports/${reportDbId}/favorite`),

  /** POST /api/reports/{id}/export — Export 요청(DOWNLOAD 권한). 202 {export_job_id}. */
  startExport: (reportDbId: number, format: ExportFormat) =>
    apiClient.post<{ export_job_id: number; status: string }>(
      `/api/reports/${reportDbId}/export`, { export_format: format },
    ),

  /** POST /api/reports/{id}/view — 최근 조회와 인기 집계에 화면 진입을 기록. */
  recordView: (reportDbId: number) =>
    apiClient.post<void>(`/api/reports/${reportDbId}/view`),

  /** POST /api/reports/{id}/view-duration — 조회 세션 체류 시간 갱신(근사치).
   * 탭 이탈/전환 시점에 keepalive fetch로 호출한다(페이지가 언로드되어도 요청 유지).
   */
  reportViewDuration: (reportDbId: number, viewLogId: number, durationSeconds: number) =>
    apiClient.post<void>(
      `/api/reports/${reportDbId}/view-duration`,
      { audit_log_id: viewLogId, duration_seconds: Math.round(durationSeconds) },
      { keepalive: true },
    ),
}

export const exportsApi = {
  /** GET /api/exports/{id} — Export 작업 상태(+ 완료 시 download_url). */
  status: (exportJobId: number, signal?: AbortSignal) =>
    apiClient.get<ExportStatusResponse>(`/api/exports/${exportJobId}`, { signal }),
  /** 완료된 Export 파일의 다운로드 URL(브라우저 직접 다운로드용, 세션 쿠키 동반). */
  fileUrl: (exportJobId: number) => `${API_BASE_URL}/api/exports/${exportJobId}/file`,
}

export const datasetsApi = {
  /** POST /api/datasets/{datasetId}/refresh — 수동 enhanced refresh (REFRESH 권한). */
  triggerRefresh: (datasetId: string) =>
    apiClient.post<{ status: string; taskId?: string; dataset_id: string }>(
      `/api/datasets/${encodeURIComponent(datasetId)}/refresh`,
    ),

  /** DELETE /api/datasets/{datasetId}/refresh — 진행 중인 enhanced refresh 취소. */
  cancelRefresh: (datasetId: string) =>
    apiClient.del<{ status: string; dataset_id: string; refresh_id: string }>(
      `/api/datasets/${encodeURIComponent(datasetId)}/refresh`,
    ),
}
