/** 통계/운영 API 래퍼 (System_Operator / VIEW_STATS 권한자). */
import apiClient from '@/api/client'
import type { MonitoringStatus, StatsOverview, StatsReport, StatsUsage } from '@/types/dashboard'

export const statsApi = {
  /** GET /api/stats/reports — 통계를 볼 수 있는 레포트 목록(드롭다운용). */
  reports: (signal?: AbortSignal) =>
    apiClient.get<StatsReport[]>('/api/stats/reports', { signal }),
  /** GET /api/stats/overview — 기본 운영 통계. reportId·기간(from/to, ISO) 지정 가능. */
  overview: (reportId?: number, from?: string, to?: string, signal?: AbortSignal) =>
    apiClient.get<StatsOverview>('/api/stats/overview', {
      query: { report_id: reportId, from, to },
      signal,
    }),
  /** GET /api/stats/usage — 사용 통계. reportId·기간(from/to, ISO) 지정 가능. */
  usage: (reportId?: number, from?: string, to?: string, signal?: AbortSignal) =>
    apiClient.get<StatsUsage>('/api/stats/usage', {
      query: { report_id: reportId, from, to },
      signal,
    }),
}

export const monitoringApi = {
  /** GET /api/monitoring/status — DB/Redis/Worker + 최근 작업/실패. */
  status: (signal?: AbortSignal) =>
    apiClient.get<MonitoringStatus>('/api/monitoring/status', { signal }),
}
