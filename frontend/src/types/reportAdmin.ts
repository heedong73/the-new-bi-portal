/** 레포트 관리/권한 타입 (백엔드 schemas/report.py, permission.py 대응). */

/** 라이브 PBI 워크스페이스 레포트 (등록 선택용). */
export interface WorkspaceReportItem {
  workspace_id: string
  report_id: string
  report_name: string
  dataset_id?: string | null
  dataset_name?: string | null
}

/** BIP 등록 레포트(관리용 상세). */
export interface ReportAdmin {
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
  created_by_user_id?: number | null
  created_by_label?: string | null
  created_at?: string | null
}

export interface ReportCreate {
  workspace_id: string
  report_id: string
  dataset_id?: string | null
  report_name?: string | null
  display_name?: string | null
  description?: string | null
  folder_id?: number | null
}

export type SubjectType = 'user' | 'role' | 'dept' | 'group'
export type PermissionAction = 'VIEW' | 'DOWNLOAD' | 'REFRESH' | 'MANAGE_REPORT'

export interface ReportPermission {
  id: number
  report_id: number
  subject_type: string
  subject_id: number
  permission: string
}

export interface PermissionGrant {
  subject_type: SubjectType
  subject_id: number
  permission: PermissionAction
}

/** 폴더 (트리 구성용 flat). */
export interface FolderItem {
  id: number
  parent_id?: number | null
  name: string
  folder_type?: string | null
  sort_order: number
}
