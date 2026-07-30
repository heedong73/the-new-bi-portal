/** 통계/운영 API 래퍼 (System_Operator / VIEW_STATS 권한자). */
import apiClient from '@/api/client'
import type {
  CompanyItem,
  HourlyPoint,
  LifecycleResponse,
  MonitoringStatus,
  RawViewEvent,
  ReportDetailRow,
  ReportDetailUserRow,
  ReportPerformanceRow,
  StatsCapabilities,
  StatsHighlights,
  StatsInsights,
  StatsOverview,
  StatsReport,
  StatsUsage,
  TeamActivityRow,
  TrendsResponse,
  UserActivityRow,
} from '@/types/dashboard'

/** 통계 공통 질의 파라미터. reportId/companyId는 상호 배타(둘 중 하나). from/to는 ISO. */
export interface StatsQuery {
  reportId?: number
  companyId?: number
  from?: string
  to?: string
}

const q = (query: StatsQuery, extra: Record<string, unknown> = {}) => ({
  report_id: query.reportId,
  company: query.companyId,
  from: query.from,
  to: query.to,
  ...extra,
})

/** 시간대별 조회(hourly) 드릴다운 필터. 상세 탭에서 부서/사용자 선택 시 지정.
 * 부서는 표시 이름이 아니라 부서 ID로 필터링한다(부서명이 코드→한글명으로 바뀐
 * 이력이 있어도 같은 범위로 묶기 위함). 부서 미지정 사용자는 unassignedDepartment. */
export interface HourlyQuery extends StatsQuery {
  departmentId?: number
  unassignedDepartment?: boolean
  userId?: number
}

export const statsApi = {
  /** GET /api/stats/reports — 통계를 볼 수 있는 레포트 목록(드롭다운용). companyId 지정 시 그 계열사 소속만. */
  reports: (companyId?: number, signal?: AbortSignal) =>
    apiClient.get<StatsReport[]>('/api/stats/reports', { query: { company: companyId }, signal }),
  /** GET /api/stats/companies — 계열사(최상위 폴더) 목록. 운영자 전용. */
  companies: (signal?: AbortSignal) =>
    apiClient.get<CompanyItem[]>('/api/stats/companies', { signal }),
  /** GET /api/stats/overview — 기본 운영 통계. */
  overview: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<StatsOverview>('/api/stats/overview', { query: q(query), signal }),
  /** GET /api/stats/usage — 사용 통계(계열사별/시간대별/TOP10 등). */
  usage: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<StatsUsage>('/api/stats/usage', { query: q(query), signal }),
  /** GET /api/stats/trends — 일별/주별/월별 추이. */
  trends: (granularity: 'day' | 'week' | 'month', query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<TrendsResponse>('/api/stats/trends', { query: q(query, { granularity }), signal }),
  /** GET /api/stats/report-detail — 레포트별(또는 계열사별) 부서 조회 상세. */
  reportDetail: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<ReportDetailRow[]>('/api/stats/report-detail', { query: q(query), signal }),
  /** GET /api/stats/report-detail-users — 레포트별(또는 계열사별) 사용자 조회 상세. */
  reportDetailUsers: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<ReportDetailUserRow[]>('/api/stats/report-detail-users', { query: q(query), signal }),
  /** GET /api/stats/hourly — 시간대별(0~23시) 조회/사용자. 부서 ID/사용자로 드릴다운. */
  hourly: (query: HourlyQuery = {}, signal?: AbortSignal) =>
    apiClient.get<HourlyPoint[]>('/api/stats/hourly', {
      query: {
        ...q(query),
        department_id: query.departmentId,
        unassigned_department: query.unassignedDepartment ? true : undefined,
        user_id: query.userId,
      },
      signal,
    }),
  /** GET /api/stats/highlights — 기간 필터와 무관한 상시 지표(오늘/어제 접속 등). */
  highlights: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<StatsHighlights>('/api/stats/highlights', { query: q(query), signal }),
  /** GET /api/stats/raw-events — 레포트 조회 로우 이벤트(엑셀/CSV 다운로드용). */
  rawEvents: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<RawViewEvent[]>('/api/stats/raw-events', { query: q(query), signal }),
  /** 현재 사용자의 통계 범위/역할 capability. */
  capabilities: (signal?: AbortSignal) =>
    apiClient.get<StatsCapabilities>('/api/stats/capabilities', { signal }),
  /** 팀별 조회·다운로드·로그인·유효 참여. */
  teams: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<TeamActivityRow[]>('/api/stats/teams', { query: q(query), signal }),
  /** 사용자별 조회·다운로드·로그인·체류. */
  users: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<UserActivityRow[]>('/api/stats/users', { query: q(query), signal }),
  /** 레포트별 성과·재방문·도달·직전기간 비교. */
  reportPerformance: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<ReportPerformanceRow[]>('/api/stats/report-performance', {
      query: q(query), signal,
    }),
  /** 감사 원장 기준 레포트 생성·수정·삭제. */
  lifecycle: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<LifecycleResponse>('/api/stats/lifecycle', { query: q(query), signal }),
  /** 참여도·활용률·미사용/급감 인사이트. */
  insights: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<StatsInsights>('/api/stats/insights', { query: q(query), signal }),
}

export const monitoringApi = {
  /** GET /api/monitoring/status — DB/Redis/Worker + 최근 작업/실패. */
  status: (signal?: AbortSignal) =>
    apiClient.get<MonitoringStatus>('/api/monitoring/status', { signal }),
}
