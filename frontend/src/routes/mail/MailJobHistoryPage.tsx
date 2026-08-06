/** 메일 발송 이력 — 어떤 스케줄이 언제 어떤 결과로 발송됐는지 확인하고 실패 건을 재시도한다. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { mailJobsApi } from '@/api/mailApi'
import type { MailJob } from '@/types/mail'
import { formatLocalDateTime } from '@/utils/date'
import { formatDurationKo } from '@/utils/duration'

const POLL_MS = 15_000

/** 발송 상태를 운영자가 읽는 한국어 라벨과 색으로 정규화한다. */
function statusPresentation(status: string): { label: string; cls: string } {
  switch (status.toLowerCase()) {
    case 'succeeded':
      return { label: '발송 성공', cls: 'bg-green-50 text-green-700' }
    case 'failed':
      return { label: '발송 실패', cls: 'bg-red-50 text-red-700' }
    case 'running':
      return { label: '진행 중', cls: 'bg-amber-50 text-amber-700' }
    default:
      return { label: status || '확인 불가', cls: 'bg-slate-100 text-slate-600' }
  }
}

/** 시작·종료 시각이 모두 있을 때만 소요 시간을 계산한다. */
function durationLabel(job: MailJob): string {
  if (!job.started_at || !job.finished_at) return '-'
  const started = new Date(job.started_at).getTime()
  const finished = new Date(job.finished_at).getTime()
  if (Number.isNaN(started) || Number.isNaN(finished)) return '-'
  return formatDurationKo(Math.max(0, Math.round((finished - started) / 1000))) ?? '-'
}

export default function MailJobHistoryPage() {
  const queryClient = useQueryClient()

  const jobsQuery = useQuery({
    queryKey: ['mail-jobs'],
    queryFn: ({ signal }) => mailJobsApi.list({}, signal),
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  })

  const retryMutation = useMutation({
    mutationFn: (jobId: number) => mailJobsApi.retry(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mail-jobs'] }),
  })

  const jobs = jobsQuery.data ?? []

  return (
    <div>
      <h1 className="portal-content-page-title portal-content-page-title--mb-5">메일 발송 이력</h1>
      {jobsQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">발송 스케줄</th>
                <th className="px-4 py-3 font-medium">상태</th>
                <th className="px-4 py-3 font-medium">시작</th>
                <th className="px-4 py-3 font-medium">종료</th>
                <th className="px-4 py-3 font-medium">소요</th>
                <th className="px-4 py-3 font-medium">실패 사유</th>
                <th className="px-4 py-3 text-right font-medium">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j: MailJob) => {
                const status = statusPresentation(j.status)
                return (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-700">
                        {j.schedule_title || `메일 스케줄 #${j.mail_schedule_id}`}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {j.report_name || '연결 레포트 정보 없음'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400" title={`회차 키 ${j.run_key}`}>
                        작업 #{j.id}
                        {j.retry_count > 0 ? ` · 재시도 ${j.retry_count}회` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {formatLocalDateTime(j.started_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                      {formatLocalDateTime(j.finished_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-500">
                      {durationLabel(j)}
                    </td>
                    <td className="px-4 py-3 text-xs text-red-600">{j.failure_reason ?? ''}</td>
                    <td className="px-4 py-3 text-right">
                      {/fail/i.test(j.status) && (
                        <button
                          type="button"
                          onClick={() => retryMutation.mutate(j.id)}
                          disabled={retryMutation.isPending}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          <RotateCw className="h-3.5 w-3.5" /> 재시도
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {jobs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">발송 이력이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {retryMutation.isSuccess && (
        <p className="mt-3 text-sm text-green-700">재발송을 요청했습니다.</p>
      )}
    </div>
  )
}
