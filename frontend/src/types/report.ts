/** 레포트 카탈로그/폴더 타입 (백엔드 schemas/report.py, folder.py 와 대응). */

/** 레포트 요약 (목록/상세). */
export interface ReportSummary {
  id: number
  workspace_id: string
  report_id: string
  dataset_id?: string | null
  report_name?: string | null
  display_name?: string | null
  description?: string | null
  category?: string | null
  folder_id?: number | null
  is_published: boolean
  can_manage?: boolean
  can_download?: boolean
  author_label?: string | null
  updated_at?: string | null
  is_favorite?: boolean
}

/** Export 다운로드 포맷. PDF/PPTX/PNG=렌더링, PBIX=원본 파일. */
export type ExportFormat = 'PDF' | 'PPTX' | 'PNG' | 'PBIX'

/** Export 작업 상태 (GET /api/exports/{id}). status: NotStarted/Running/Succeeded/Failed. */
export interface ExportStatusResponse {
  export_job_id: number
  status: string
  export_format?: string | null
  file_name?: string | null
  mime_type?: string | null
  download_url?: string
  error_message?: string
}

/** 폴더 트리 노드 (자식 폴더 + 권한 필터된 레포트 ID 포함). */
export interface FolderTreeNode {
  id: number
  name: string
  folder_type?: string | null
  sort_order: number
  children: FolderTreeNode[]
  report_ids: number[]
}

/** 레포트 표시명 결정 (display_name > report_name > report_id). */
export function reportDisplayName(r: ReportSummary): string {
  return r.display_name || r.report_name || r.report_id
}

/** Embed Token + 임베드 정보 (GET /api/reports/{id}/embed). */
export interface EmbedInfo {
  reportId: string
  embedUrl: string
  embedToken: string
  expiry?: string | null
  /** 공통 기본 뷰 상태(Power BI 북마크 state). 있으면 로드 시 적용. */
  defaultViewState?: string | null
  /** 이 조회 세션의 audit_logs.id. 체류 시간 갱신(view-duration) 시 사용. */
  viewLogId?: number | null
}

/** 레포트 새로고침 상태 (GET /api/reports/{id}/refresh-status). */
export interface RefreshStatus {
  has_history: boolean
  status?: string | null
  last_refresh_local?: string | null
  next_scheduled_local?: string | null
  message?: string | null
}
