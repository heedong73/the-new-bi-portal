/** 통계/운영 API 래퍼 (System_Operator / VIEW_STATS 권한자). */
import apiClient from '@/api/client'
import type {
  CompanyItem,
  MonitoringStatus,
  ReportDetailRow,
  StatsOverview,
  StatsReport,
  StatsUsage,
  TrendsResponse,
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

export const statsApi = {
  /** GET /api/stats/reports — 통계를 볼 수 있는 레포트 목록(드롭다운용). */
  reports: (signal?: AbortSignal) =>
    apiClient.get<StatsReport[]>('/api/stats/reports', { signal }),
  /** GET /api/stats/companies — 계열사(최상위 폴더) 목록. 운영자 전용. */
  companies: (signal?: AbortSignal) =>
    apiClient.get<CompanyItem[]>('/api/stats/companies', { signal }),
  /** GET /api/stats/overview — 기본 운영 통계. */
  overview: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<StatsOverview>('/api/stats/overview', { query: q(query), signal }),
  /** GET /api/stats/usage — 사용 통계(계열사별/시간대별/TOP10 등). */
  usage: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<StatsUsage>('/api/stats/usage', { query: q(query), signal }),
  /** GET /api/stats/trends — 주별/월별 추이. */
  trends: (granularity: 'week' | 'month', query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<TrendsResponse>('/api/stats/trends', { query: q(query, { granularity }), signal }),
  /** GET /api/stats/report-detail — 레포트별(또는 계열사별) 부서 조회 상세. */
  reportDetail: (query: StatsQuery = {}, signal?: AbortSignal) =>
    apiClient.get<ReportDetailRow[]>('/api/stats/report-detail', { query: q(query), signal }),
}

export const monitoringApi = {
  /** GET /api/monitoring/status — DB/Redis/Worker + 최근 작업/실패. */
  status: (signal?: AbortSignal) =>
    apiClient.get<MonitoringStatus>('/api/monitoring/status', { signal }),
}
