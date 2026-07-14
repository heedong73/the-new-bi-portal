/** 통계/운영 모니터링 타입 (백엔드 stats_service, monitoring_service 응답과 대응). */

/** 통계 조회 가능 레포트(드롭다운용). */
export interface StatsReport {
  id: number
  name: string
}

export interface StatsOverview {
  scoped?: boolean
  // 접속자
  unique_visitors?: number // 고유 접속자 (전역=로그인 고유, 스코프=조회 고유)
  total_visits?: number // 전체 접속 수 (전역=로그인 총건, 스코프=조회 총건)
  unique_login_users?: number // 고유 로그인 사용자 (전역)
  login_count?: number // 전체 로그인 수 (전역)
  // 레포트
  total_reports?: number // 총 등록 레포트 수
  new_reports?: number // 기간 내 신규 등록 수
  viewed_reports?: number // 접속(조회)된 레포트 수(distinct)
  report_view_count: number // 총 레포트 뷰 수
  // 시스템 (전역만)
  refresh_success?: number
  refresh_failed?: number
  mail_success?: number
  mail_failed?: number
  failed_job_count?: number
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

/** 계열사(최상위 폴더) 항목 — 필터 드롭다운. */
export interface CompanyItem {
  company_id: number | null
  label: string
}
/** 계열사별 레포트 수. */
export interface CompanyReports {
  company_id: number | null
  label: string
  count: number
}
/** 시간대별(0~23시, KST) 조회/사용자. */
export interface HourlyPoint {
  hour: number
  views: number
  users: number
}
/** 일별/주별/월별 추이 한 지점. */
export interface TrendPoint {
  period: string
  unique_users: number
  views: number
  new_reports: number // 그 버킷에 신규 등록된 레포트 수
  total_reports: number // 누적 등록 레포트 수
}
export interface TrendsResponse {
  granularity: 'day' | 'week' | 'month'
  scoped: boolean
  series: TrendPoint[]
}
/** 레포트별 상세 — 부서별 조회 정보 한 행. */
export interface ReportDetailRow {
  department: string
  views: number
  unique_users: number
  last_access: string | null // tz-aware ISO(UTC)
}
/** 레포트별 상세 — 사용자별 조회 정보 한 행. */
export interface ReportDetailUserRow {
  user_id: number
  user_name: string
  department: string
  views: number
  last_access: string | null // tz-aware ISO(UTC)
}

/** 레포트 조회 로우 이벤트 한 건 — 엑셀/CSV 다운로드용 원본 단위 데이터. */
export interface RawViewEvent {
  occurred_at: string | null // tz-aware ISO(UTC)
  user_emp_no: string
  user_name: string
  company: string | null
  department: string
  report_id: number | null
  report_name: string
  duration_seconds: number | null // 근사치, 아직 갱신 안 됐으면 null
}

/** 기간 필터와 무관한 상시 지표(오늘/어제 접속·최근 접속·미사용 레포트 수). */
export interface StatsHighlights {
  today_views: number
  yesterday_views: number
  pct_change: number | null // null=전일 0건(비교 불가)
  is_new: boolean // 전일 0건, 오늘 발생(순증)
  last_access: string | null // tz-aware ISO(UTC)
  unused_count: number
}

export interface StatsUsage {
  scoped?: boolean
  top_reports: TopReport[]
  by_user: UserCount[]
  reports_by_department: DeptReports[]
  views_by_department: DeptViews[]
  reports_by_month: MonthCount[]
  reports_by_company?: CompanyReports[]
  hourly?: HourlyPoint[]
  mail_jobs?: { total: number; succeeded: number; failed: number }
  export_jobs?: { succeeded: number; failed: number }
  refresh_failed?: number
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
