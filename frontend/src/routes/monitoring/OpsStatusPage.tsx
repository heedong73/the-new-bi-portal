/** 운영 상태 — 핵심 의존성, 예약 실행 경로, 최근 작업과 실패 원인을 한 화면에서 확인한다. */
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, Cloud,
  Cpu, Database, FileDown, Mail, RefreshCw, Server, XCircle,
  type LucideIcon,
} from 'lucide-react'

import { monitoringApi } from '@/api/dashboardApi'
import type { RecentJob } from '@/types/dashboard'

const POLL_MS = 15_000

type Tone = 'ok' | 'degraded' | 'error' | 'unknown'

const TONE_STYLE: Record<Tone, {
  card: string
  icon: string
  badge: string
  label: string
}> = {
  ok: {
    card: 'border-green-200',
    icon: 'bg-green-50 text-green-600',
    badge: 'bg-green-50 text-green-700',
    label: '정상',
  },
  degraded: {
    card: 'border-amber-200',
    icon: 'bg-amber-50 text-amber-600',
    badge: 'bg-amber-50 text-amber-700',
    label: '주의',
  },
  error: {
    card: 'border-red-200',
    icon: 'bg-red-50 text-red-600',
    badge: 'bg-red-50 text-red-700',
    label: '장애',
  },
  unknown: {
    card: 'border-slate-200',
    icon: 'bg-slate-100 text-slate-500',
    badge: 'bg-slate-100 text-slate-600',
    label: '확인 불가',
  },
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 장애 순서 비교가 가능하도록 모든 운영 시각을 로컬 연월일 시:분:초로 표시한다. */
function fmtDateTimeSeconds(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function fmtDuration(seconds?: number | null): string | null {
  if (seconds == null) return null
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  const remains = seconds % 60
  if (minutes < 60) return `${minutes}분 ${remains}초`
  const hours = Math.floor(minutes / 60)
  return `${hours}시간 ${minutes % 60}분 ${remains}초`
}

function fmtLatency(value?: number | null): string {
  return value == null ? '응답시간 확인 불가' : `응답 ${value.toLocaleString()}ms`
}

function HealthCard({
  koreanName, technicalName, description, tone, statusLabel, Icon,
  detail, technicalDetail, impact,
}: {
  koreanName: string
  technicalName: string
  description: string
  tone: Tone
  statusLabel?: string
  Icon: LucideIcon
  detail: string
  technicalDetail?: string | null
  impact: string
}) {
  const style = TONE_STYLE[tone]
  return (
    <article className={`rounded-xl border bg-white p-4 shadow-sm ${style.card}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${style.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
          {statusLabel ?? style.label}
        </span>
      </div>
      <h3 className="text-sm font-bold text-slate-800">{koreanName}</h3>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {technicalName}
      </p>
      <p className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{description}</p>
      <p className="mt-2 text-xs font-medium text-slate-700">{detail}</p>
      {technicalDetail && (
        <p className="mt-1 break-all text-[11px] leading-4 text-slate-400" title={technicalDetail}>
          {technicalDetail}
        </p>
      )}
      {tone !== 'ok' && (
        <p className={`mt-2 rounded-md px-2 py-1.5 text-[11px] leading-4 ${
          tone === 'error' ? 'bg-red-50 text-red-700'
            : tone === 'degraded' ? 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-600'
        }`}>
          영향: {impact}
        </p>
      )}
    </article>
  )
}

function jobPresentation(status: string): { label: string; tone: Tone } {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'succeeded':
      return { label: '성공', tone: 'ok' }
    case 'failed':
      return { label: '실패', tone: 'error' }
    case 'unknown':
    case 'running':
    case 'inprogress':
      return { label: '진행 중', tone: 'degraded' }
    case 'notstarted':
      return { label: '대기 중', tone: 'unknown' }
    case 'cancelled':
      return { label: '취소됨', tone: 'unknown' }
    case 'disabled':
      return { label: '비활성', tone: 'unknown' }
    default:
      return { label: status || '확인 불가', tone: 'unknown' }
  }
}

function JobList({ title, Icon, jobs, available, unavailableMessage }: {
  title: string
  Icon: LucideIcon
  jobs: RecentJob[]
  available: boolean
  unavailableMessage?: string | null
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      </div>
      {!available ? (
        <div className="rounded-lg bg-red-50 px-3 py-4 text-sm text-red-700">
          {unavailableMessage || '작업 이력을 조회할 수 없습니다.'}
        </div>
      ) : jobs.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
          최근 작업 없음
        </p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => {
            const status = jobPresentation(job.status)
            const style = TONE_STYLE[status.tone]
            const time = job.finished_at || job.started_at
            const duration = fmtDuration(job.duration_seconds)
            return (
              <li key={job.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-700" title={job.target_name ?? undefined}>
                      {job.target_name || `작업 #${job.id}`}
                    </p>
                    {job.target_detail && (
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={job.target_detail}>
                        {job.target_detail}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}>
                    {status.label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                  <span>{fmtDateTimeSeconds(time)}</span>
                  {duration && <span>· 소요 {duration}</span>}
                  {job.retry_count != null && job.retry_count > 0 && <span>· 재시도 {job.retry_count}회</span>}
                  <span>· 작업 #{job.id}</span>
                </div>
                {job.error_message && (
                  <p className="mt-2 break-words rounded-md bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-700">
                    {job.error_message}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const APP_MODE_LABEL: Record<string, string> = {
  live: '운영 Power BI 연동',
  mock: '모의 데이터',
}
const AUTH_MODE_LABEL: Record<string, string> = {
  'hr-db': '인사 DB 인증',
  'local-only': '로컬 관리자 인증',
  mock: '모의 인증',
}

export default function OpsStatusPage() {
  const statusQuery = useQuery({
    queryKey: ['monitoring-status'],
    queryFn: ({ signal }) => monitoringApi.status(signal),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    staleTime: 5_000,
  })

  const s = statusQuery.data

  if (statusQuery.isLoading && !s) {
    return (
      <div>
        <h1 className="portal-content-page-title portal-content-page-title--mb-5">운영 상태</h1>
        <p className="text-sm text-slate-400">상태 확인 중…</p>
      </div>
    )
  }

  if (!s) {
    return (
      <div>
        <h1 className="portal-content-page-title portal-content-page-title--mb-5">운영 상태</h1>
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          운영 상태 API에 연결할 수 없습니다. 백엔드와 네트워크 상태를 확인해 주세요.
        </div>
      </div>
    )
  }

  const overallTone: Tone = s.overall_status === 'ok'
    ? 'ok'
    : s.overall_status === 'degraded' ? 'degraded' : 'error'
  const overallStyle = TONE_STYLE[overallTone]
  const redisOk = s.redis === 'ok'
  const workerTone: Tone = !redisOk ? 'unknown' : s.worker === 'ok' ? 'ok' : 'error'
  const schedulerTone: Tone = s.scheduler.status === 'ok'
    ? 'ok'
    : s.scheduler.status === 'unknown' ? 'unknown' : 'error'
  const powerbiTone: Tone = s.powerbi.status === 'ok'
    ? 'ok'
    : s.powerbi.status === 'degraded' || s.powerbi.status === 'mock'
      ? 'degraded'
      : s.powerbi.status === 'unknown' ? 'unknown' : 'error'

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="portal-content-page-title">운영 상태</h1>
        <button
          type="button"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${statusQuery.isFetching ? 'animate-spin' : ''}`} />
          지금 새로 확인
        </button>
      </div>

      <section className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${overallStyle.card} ${
        overallTone === 'error' ? 'bg-red-50'
          : overallTone === 'degraded' ? 'bg-amber-50' : 'bg-green-50'
      }`}>
        <div className="flex items-center gap-3">
          {overallTone === 'ok'
            ? <CheckCircle2 className="h-5 w-5 text-green-600" />
            : overallTone === 'error'
              ? <XCircle className="h-5 w-5 text-red-600" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          <div>
            <p className="text-sm font-bold text-slate-800">
              종합 상태: {overallTone === 'ok' ? '정상' : overallTone === 'error' ? '장애' : '주의 필요'}
            </p>
            <p className="text-xs text-slate-500">
              마지막 확인 {fmtDateTimeSeconds(s.checked_at)} · {POLL_MS / 1000}초마다 자동 갱신
            </p>
          </div>
        </div>
        {statusQuery.isError && (
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
            최신 상태 갱신 실패 · 직전 결과 표시 중
          </span>
        )}
      </section>

      <h2 className="mb-2 text-sm font-bold text-slate-700">핵심 구성요소</h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HealthCard
          koreanName="데이터 저장소"
          technicalName="PostgreSQL Database"
          description="사용자·권한·레포트 카탈로그와 작업 이력을 저장합니다."
          tone={s.db === 'ok' ? 'ok' : 'error'}
          Icon={Database}
          detail={s.db === 'ok' ? fmtLatency(s.db_latency_ms) : '데이터베이스 연결 실패'}
          impact="로그인 이후 화면, 설정 저장, 작업 이력 조회"
        />
        <HealthCard
          koreanName="캐시·세션·작업 큐"
          technicalName="Redis"
          description="로그인 세션, API 캐시와 백그라운드 작업 전달을 담당합니다."
          tone={redisOk ? 'ok' : 'error'}
          Icon={Server}
          detail={redisOk ? `${fmtLatency(s.redis_latency_ms)} · 대기 ${s.queued_tasks ?? '-'}건` : 'Redis 연결 실패'}
          impact="로그인 세션과 모든 비동기 작업 전달"
        />
        <HealthCard
          koreanName="백그라운드 작업 처리기"
          technicalName="Celery Worker"
          description="새로고침 수집, 메일 발송과 파일 내보내기를 실행합니다."
          tone={workerTone}
          statusLabel={!redisOk ? '확인 불가' : undefined}
          Icon={Cpu}
          detail={s.worker === 'ok'
            ? `응답 ${s.worker_count}대 · 실행 ${s.active_tasks ?? '-'}건`
            : !redisOk ? 'Redis 장애 영향으로 확인 불가' : '응답 Worker 없음'}
          technicalDetail={s.worker_ids.length > 0 ? `노드: ${s.worker_ids.join(', ')}` : null}
          impact="새로고침·메일·다운로드 작업 실행"
        />
        <HealthCard
          koreanName="예약 작업 스케줄러"
          technicalName="Celery Beat"
          description="정기 수집, 예약 메일과 보존 정리 작업의 시작 시각을 관리합니다."
          tone={schedulerTone}
          Icon={Clock3}
          detail={s.scheduler.last_heartbeat
            ? `최근 heartbeat ${fmtDateTimeSeconds(s.scheduler.last_heartbeat)}`
            : s.scheduler.message}
          technicalDetail={s.scheduler.age_seconds != null ? `${s.scheduler.age_seconds}초 전 확인` : null}
          impact="자동 수집과 예약 메일의 정시 실행"
        />
        <HealthCard
          koreanName="Power BI 서비스 연결"
          technicalName="Azure AD · Power BI REST API"
          description="Azure 인증과 운영 워크스페이스 읽기 권한을 확인합니다."
          tone={powerbiTone}
          statusLabel={s.powerbi.status === 'mock' ? '모의 모드' : undefined}
          Icon={Cloud}
          detail={s.powerbi.message}
          technicalDetail={[
            s.powerbi.checked_at ? `확인 ${fmtDateTimeSeconds(s.powerbi.checked_at)}` : null,
            s.powerbi.latency_ms != null ? fmtLatency(s.powerbi.latency_ms) : null,
          ].filter(Boolean).join(' · ') || null}
          impact="레포트 조회·새로고침·파일 내보내기"
        />
      </div>

      {s.has_recent_failures && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            최근 24시간 실패: 데이터 새로고침 {s.recent_failures.refresh}건 · 메일 {s.recent_failures.mail}건 · 파일 내보내기 {s.recent_failures.export}건
          </span>
        </div>
      )}

      <div className="mb-2 flex items-center gap-2">
        <Activity className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-bold text-slate-700">최근 작업</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <JobList
          title="최근 데이터 새로고침"
          Icon={RefreshCw}
          jobs={s.recent_jobs.refresh}
          available={s.recent_jobs_available}
          unavailableMessage={s.recent_jobs_error}
        />
        <JobList
          title="최근 예약 메일 발송"
          Icon={Mail}
          jobs={s.recent_jobs.mail}
          available={s.recent_jobs_available}
          unavailableMessage={s.recent_jobs_error}
        />
        <JobList
          title="최근 파일 내보내기"
          Icon={FileDown}
          jobs={s.recent_jobs.export}
          available={s.recent_jobs_available}
          unavailableMessage={s.recent_jobs_error}
        />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        실행 모드: {APP_MODE_LABEL[s.app_mode] ?? s.app_mode} · 인증 방식: {AUTH_MODE_LABEL[s.auth_mode] ?? s.auth_mode}
      </p>
    </div>
  )
}
