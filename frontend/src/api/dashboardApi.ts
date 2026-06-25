/** 통계/운영 API 래퍼 (System_Operator 전용). */
import apiClient from '@/api/client'
import type { MonitoringStatus, StatsOverview, StatsUsage } from '@/types/dashboard'

export const statsApi = {
  /** GET /api/stats/overview — 기본 운영 통계. */
  overview: (signal?: AbortSignal) =>
    apiClient.get<StatsOverview>('/api/stats/overview', { signal }),
  /** GET /api/stats/usage — 사용 통계. */
  usage: (signal?: AbortSignal) =>
    apiClient.get<StatsUsage>('/api/stats/usage', { signal }),
}

export const monitoringApi = {
  /** GET /api/monitoring/status — DB/Redis/Worker + 최근 작업/실패. */
  status: (signal?: AbortSignal) =>
    apiClient.get<MonitoringStatus>('/api/monitoring/status', { signal }),
}
