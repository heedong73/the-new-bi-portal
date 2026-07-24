/** 운영 상태 모니터링 (T-39) — DB/Redis/Worker + 최근 작업/실패. 요구사항: R36. */
import { useQuery } from '@tanstack/react-query'
import { Database, Server, Cpu, CheckCircle2, XCircle } from 'lucide-react'
import { monitoringApi } from '@/api/dashboardApi'

const POLL_MS = 15_000

function HealthPill({ label, ok, Icon, detail }: {
  label: string; ok: boolean; Icon: typeof Database; detail?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${ok ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="flex items-center gap-1.5 font-medium text-slate-800">
          {label}
          {ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
        </div>
        <div className="text-xs text-slate-500">{detail ?? (ok ? '정상' : '오류')}</div>
      </div>
    </div>
  )
}

export default function OpsStatusPage() {
  const statusQuery = useQuery({
    queryKey: ['monitoring-status'],
    queryFn: ({ signal }) => monitoringApi.status(signal),
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  })

  const s = statusQuery.data

  return (
    <div>
      <h1 className="portal-content-page-title portal-content-page-title--mb-5">운영 상태</h1>

      {statusQuery.isLoading || !s ? (
        <p className="text-sm text-slate-400">상태 확인 중…</p>
      ) : (
        <>
          {/* 컴포넌트 상태 */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HealthPill label="데이터베이스" ok={s.db === 'ok'} Icon={Database} />
            <HealthPill label="Redis" ok={s.redis === 'ok'} Icon={Server} />
            <HealthPill
              label="Worker"
              ok={s.worker === 'ok'}
              Icon={Cpu}
              detail={s.worker === 'ok' ? `워커 ${s.worker_count}대` : '사용 불가'}
            />
          </div>

          {/* 최근 실패 배너 */}
          {s.has_recent_failures && (
            <div role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              최근 24시간 실패: 새로고침 {s.recent_failures.refresh} · 메일 {s.recent_failures.mail} · Export {s.recent_failures.export}
            </div>
          )}

          {/* 최근 작업 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {(['refresh', 'mail', 'export'] as const).map((kind) => {
              const label = { refresh: '최근 새로고침', mail: '최근 메일', export: '최근 Export' }[kind]
              const jobs = s.recent_jobs[kind]
              return (
                <div key={kind} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-sm font-bold text-slate-700">{label}</h3>
                  <ul className="space-y-1.5 text-sm">
                    {jobs.length === 0 && <li className="text-slate-400">기록 없음</li>}
                    {jobs.map((j) => (
                      <li key={j.id} className="flex justify-between">
                        <span className="text-slate-500">#{j.id}</span>
                        <span className={`font-medium ${
                          /fail/i.test(j.status) ? 'text-red-600'
                            : /succ|complet/i.test(j.status) ? 'text-green-600' : 'text-slate-600'
                        }`}>{j.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          <p className="mt-4 text-xs text-slate-400">
            모드: {s.app_mode} / 인증: {s.auth_mode} · {POLL_MS / 1000}초마다 자동 갱신
          </p>
        </>
      )}
    </div>
  )
}
