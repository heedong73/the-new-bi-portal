/** 감사 로그(시스템 사용자 활동 이력) API 래퍼 (System_Operator 전용). */
import apiClient from '@/api/client'
import type { AuditLogItem, AuditLogQuery } from '@/types/audit'

export const auditApi = {
  /** GET /api/audit-logs — 기간/주체/행위/대상/결과 필터 + 페이지네이션. */
  list: (query: AuditLogQuery = {}, signal?: AbortSignal) =>
    apiClient.get<AuditLogItem[]>('/api/audit-logs', {
      query: {
        from: query.from,
        to: query.to,
        actor_user_id: query.actorUserId,
        action: query.action,
        resource_type: query.resourceType,
        result: query.result,
        q: query.q,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      },
      signal,
    }),
  /** GET /api/audit-logs/actions — 실제 기록된 행위 값 목록(필터 드롭다운용). */
  actions: (signal?: AbortSignal) =>
    apiClient.get<string[]>('/api/audit-logs/actions', { signal }),
}

export default auditApi
