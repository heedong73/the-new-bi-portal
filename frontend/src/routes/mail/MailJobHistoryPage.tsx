/** 메일 발송 이력 (T-39) — 성공/실패 이력 + 실패 잡 재시도. 요구사항: R16. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { mailJobsApi } from '@/api/mailApi'
import type { MailJob } from '@/types/mail'

const POLL_MS = 15_000

function statusCls(status: string): string {
  if (/succ/i.test(status)) return 'bg-green-50 text-green-700'
  if (/fail/i.test(status)) return 'bg-red-50 text-red-700'
  return 'bg-amber-50 text-amber-700'
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
    <div className="min-h-screen bg-slate-50 p-6">
      <h1 className="mb-5 text-xl font-bold text-slate-800">메일 발송 이력</h1>
      {jobsQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">스케줄</th>
                <th className="px-4 py-3">회차(run_key)</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">시작</th>
                <th className="px-4 py-3">실패 사유</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((j: MailJob) => (
                <tr key={j.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{j.id}</td>
                  <td className="px-4 py-3 text-slate-600">#{j.mail_schedule_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{j.run_key}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusCls(j.status)}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{j.started_at ?? '-'}</td>
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
              ))}
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
