/**
 * 레포트 뷰 화면 (ReportViewPage, T-37).
 *
 * - Power BI Embedded 렌더링(Embed Token)
 * - 새로고침 상태 배지 + 다음 예약
 * - 수동 새로고침 버튼: REFRESH 권한은 백엔드가 강제(403 시 한국어 안내).
 *   레포트의 dataset_id 는 목록(VIEW 필터)에서 조회.
 * 요구사항: R9, R10, R13
 */
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'

import { datasetsApi, reportsApi } from '@/api/portalApi'
import { ApiError } from '@/api/client'
import { reportDisplayName } from '@/types/report'
import PowerBIEmbed from '@/components/embed/PowerBIEmbed'
import RefreshStatusBadge from '@/components/refresh/RefreshStatusBadge'

const REFRESH_STATUS_POLL_MS = 30_000

export default function ReportViewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const params = useParams<{ reportId: string }>()
  const reportDbId = Number(params.reportId)
  const validId = Number.isFinite(reportDbId) && reportDbId > 0

  // 목록에서 해당 레포트 메타(dataset_id, 표시명) 조회 (캐시 재사용)
  const listQuery = useQuery({
    queryKey: ['reports', null],
    queryFn: ({ signal }) => reportsApi.list(null, signal),
    staleTime: 60_000,
  })
  const report = useMemo(
    () => listQuery.data?.find((r) => r.id === reportDbId),
    [listQuery.data, reportDbId],
  )

  const embedQuery = useQuery({
    queryKey: ['embed', reportDbId],
    queryFn: ({ signal }) => reportsApi.embed(reportDbId, signal),
    enabled: validId,
    staleTime: 5 * 60_000,
  })

  const statusQuery = useQuery({
    queryKey: ['refresh-status', reportDbId],
    queryFn: ({ signal }) => reportsApi.refreshStatus(reportDbId, signal),
    enabled: validId,
    refetchInterval: REFRESH_STATUS_POLL_MS,
    staleTime: 10_000,
  })

  const refreshMutation = useMutation({
    mutationFn: () => {
      if (!report?.dataset_id) {
        throw new Error('이 레포트에는 연결된 데이터셋이 없습니다.')
      }
      return datasetsApi.triggerRefresh(report.dataset_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refresh-status', reportDbId] })
    },
  })

  function refreshErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 403) return '새로고침 권한이 없습니다.'
      if (error.status === 409) return '이미 새로고침이 진행 중입니다.'
      return error.errorDescription ?? error.message
    }
    if (error instanceof Error) return error.message
    return '새로고침 요청에 실패했습니다.'
  }

  const title = report ? reportDisplayName(report) : '레포트'
  const canRefresh = Boolean(report?.dataset_id)

  if (!validId) {
    return (
      <div className="p-6">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          잘못된 레포트 경로입니다.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* 헤더 */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="목록으로"
          className="flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          목록
        </button>
        <h1 className="text-lg font-bold text-slate-800">{title}</h1>

        <div className="ml-auto flex items-center gap-3">
          <RefreshStatusBadge status={statusQuery.data} isLoading={statusQuery.isLoading} />
          {canRefresh && (
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          )}
        </div>
      </header>

      {/* 새로고침 요청 결과 알림 */}
      {refreshMutation.isError && (
        <div role="alert" className="bg-red-50 px-5 py-2 text-sm text-red-600">
          {refreshErrorMessage(refreshMutation.error)}
        </div>
      )}
      {refreshMutation.isSuccess && (
        <div className="bg-green-50 px-5 py-2 text-sm text-green-700">
          새로고침을 요청했습니다. 잠시 후 상태가 갱신됩니다.
        </div>
      )}

      {/* 임베드 본문 */}
      <main className="flex-1 overflow-hidden p-4">
        {embedQuery.isLoading ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            레포트를 불러오는 중…
          </div>
        ) : embedQuery.isError ? (
          <div className="flex h-full items-center justify-center">
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {embedQuery.error instanceof ApiError && embedQuery.error.status === 403
                ? '이 레포트를 볼 권한이 없습니다.'
                : '레포트를 불러오지 못했습니다.'}
            </p>
          </div>
        ) : embedQuery.data ? (
          <div className="h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <PowerBIEmbed embed={embedQuery.data} />
          </div>
        ) : null}
      </main>
    </div>
  )
}
