/** 통계 대시보드 (T-39) — 기본 운영 통계 + 사용 통계. 요구사항: R18. */
import { useQuery } from '@tanstack/react-query'
import { LogIn, Eye, RefreshCw, Mail, AlertTriangle } from 'lucide-react'
import { statsApi } from '@/api/dashboardApi'

function StatCard({ label, value, Icon, tone = 'slate' }: {
  label: string; value: number; Icon: typeof LogIn; tone?: 'slate' | 'green' | 'red' | 'blue'
}) {
  const toneCls = {
    slate: 'text-slate-600 bg-slate-100',
    green: 'text-green-600 bg-green-50',
    red: 'text-red-600 bg-red-50',
    blue: 'text-blue-600 bg-blue-50',
  }[tone]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${toneCls}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function ListCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  )
}

export default function StatsDashboardPage() {
  const overviewQuery = useQuery({
    queryKey: ['stats-overview'],
    queryFn: ({ signal }) => statsApi.overview(signal),
    staleTime: 60_000,
  })
  const usageQuery = useQuery({
    queryKey: ['stats-usage'],
    queryFn: ({ signal }) => statsApi.usage(signal),
    staleTime: 60_000,
  })

  const o = overviewQuery.data
  const u = usageQuery.data

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <h1 className="mb-5 text-xl font-bold text-slate-800">통계 대시보드</h1>

      {/* 기본 운영 통계 */}
      {overviewQuery.isLoading || !o ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : o.scoped ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="레포트 조회" value={o.report_view_count} Icon={Eye} tone="blue" />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="로그인" value={o.login_count ?? 0} Icon={LogIn} tone="blue" />
          <StatCard label="레포트 조회" value={o.report_view_count} Icon={Eye} tone="blue" />
          <StatCard label="새로고침 성공" value={o.refresh_success ?? 0} Icon={RefreshCw} tone="green" />
          <StatCard label="새로고침 실패" value={o.refresh_failed ?? 0} Icon={RefreshCw} tone="red" />
          <StatCard label="메일 성공" value={o.mail_success ?? 0} Icon={Mail} tone="green" />
          <StatCard label="실패 Job" value={o.failed_job_count ?? 0} Icon={AlertTriangle} tone="red" />
        </div>
      )}
      {o?.scoped && (
        <p className="mb-4 -mt-2 text-xs text-slate-400">권한이 부여된 레포트의 사용 통계만 표시됩니다.</p>
      )}

      {/* 사용 통계 */}
      {usageQuery.isLoading || !u ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ListCard title="인기 레포트 TOP 10 (조회 수)">
            <ol className="space-y-1.5 text-sm">
              {u.top_reports.length === 0 && <li className="text-slate-400">데이터 없음</li>}
              {u.top_reports.map((r, i) => (
                <li key={r.report_id} className="flex justify-between">
                  <span className="truncate text-slate-700">{i + 1}. {r.report_name ?? r.report_id}</span>
                  <span className="font-medium text-slate-500">{r.count}</span>
                </li>
              ))}
            </ol>
          </ListCard>

          <ListCard title="부서별 게시 레포트 수">
            <ul className="space-y-1.5 text-sm">
              {u.reports_by_department.length === 0 && <li className="text-slate-400">데이터 없음</li>}
              {u.reports_by_department.map((d) => (
                <li key={`${d.folder_id}-${d.department}`} className="flex justify-between">
                  <span className="truncate text-slate-700">{d.department}</span>
                  <span className="font-medium text-slate-500">{d.count}</span>
                </li>
              ))}
            </ul>
          </ListCard>

          <ListCard title="사용자별 조회 수 (TOP 10)">
            <ul className="space-y-1.5 text-sm">
              {u.by_user.length === 0 && <li className="text-slate-400">데이터 없음</li>}
              {u.by_user.map((x) => (
                <li key={x.user_id} className="flex justify-between">
                  <span className="truncate text-slate-700">{x.user_name ?? x.user_id}</span>
                  <span className="font-medium text-slate-500">{x.count}</span>
                </li>
              ))}
            </ul>
          </ListCard>

          <ListCard title="잡 현황">
            {u.scoped || !u.mail_jobs || !u.export_jobs ? (
              <p className="text-sm text-slate-400">권한 범위에서는 표시되지 않습니다.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">메일 발송(성공/실패)</dt>
                  <dd className="font-medium text-slate-700">{u.mail_jobs.succeeded} / {u.mail_jobs.failed}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Export(성공/실패)</dt>
                  <dd className="font-medium text-slate-700">{u.export_jobs.succeeded} / {u.export_jobs.failed}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Refresh 실패</dt>
                  <dd className="font-medium text-red-600">{u.refresh_failed ?? 0}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">미사용 레포트</dt>
                  <dd className="font-medium text-slate-700">{u.unused_reports.length}</dd></div>
              </dl>
            )}
          </ListCard>
        </div>
      )}
    </div>
  )
}
