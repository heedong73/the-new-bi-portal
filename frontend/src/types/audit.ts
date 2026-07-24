/** 감사 로그(시스템 사용자 활동 이력) 타입 (백엔드 schemas/audit.py 대응). */

/** 감사 로그에 실제 기록되는 행위(action) 값. backend/app/core/constants.py AuditAction과 동기화. */
export type AuditAction =
  | 'login'
  | 'report_view'
  | 'report_create'
  | 'report_update'
  | 'report_delete'
  | 'report_visibility_change'
  | 'export_run'
  | 'mail_send'
  | 'mail_schedule_create'
  | 'mail_schedule_update'
  | 'mail_schedule_delete'
  | 'permission_change'
  | 'group_change'
  | 'refresh_trigger'
  | 'refresh_cancel'
  | 'collect_now'
  | 'admin_setting_change'
  | 'powerbi_api_failure'
  | 'permission_denied'
  | 'request_create'
  | 'request_update'
  | 'request_comment'
  | 'stats_view'

export type AuditResult = 'success' | 'failure'

export interface AuditLogItem {
  id: number
  actor_user_id: number | null
  actor_label: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  result: string
  occurred_at_utc: string
  /** APP_TIMEZONE(KST) 기준 표시용 로컬 시각 문자열. */
  occurred_at_local: string
  ip_address: string | null
  meta: Record<string, unknown> | null
}

/** GET /api/audit-logs 쿼리 파라미터. */
export interface AuditLogQuery {
  from?: string
  to?: string
  actorUserId?: number
  action?: string
  resourceType?: string
  result?: string
  q?: string
  limit?: number
  offset?: number
}
