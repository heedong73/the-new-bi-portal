/** 통계/운영 모니터링 타입 (백엔드 stats_service, monitoring_service 응답과 대응). */

export interface StatsOverview {
  login_count: number
  report_view_count: number
  refresh_success: number
  refresh_failed: number
  mail_success: number
  mail_failed: number
  failed_job_count: number
}

export interface TopReport {
  report_id: string
  report_name?: string | null
  count: number
}
export interface UserCount {
  user_id: number
  user_name?: string | null
  count: number
}
export interface DeptReports {
  folder_id: number | null
  department: string
  count: number
}
export interface DeptViews {
  department: string
  count: number
}
export interface MonthCount {
  month: string
  count: number
}
export interface UnusedReport {
  report_id: number
  report_name?: string | null
}

export interface StatsUsage {
  top_reports: TopReport[]
  by_user: UserCount[]
  reports_by_department: DeptReports[]
  views_by_department: DeptViews[]
  reports_by_month: MonthCount[]
  mail_jobs: { total: number; succeeded: number; failed: number }
  export_jobs: { succeeded: number; failed: number }
  refresh_failed: number
  unused_reports: UnusedReport[]
}

export interface RecentJob {
  id: number
  status: string
  [key: string]: unknown
}

export interface MonitoringStatus {
  db: string
  redis: string
  worker: string
  worker_count: number
  app_mode: string
  auth_mode: string
  recent_jobs: { refresh: RecentJob[]; mail: RecentJob[]; export: RecentJob[] }
  recent_failures: { refresh: number; mail: number; export: number }
  has_recent_failures: boolean
}
