/** 감사 로그(시스템 사용자 활동 이력) 조회 — System_Operator 전용.
 *
 * "언제 · 누가 · 어떤 대상에 · 어떤 행위를 · 어떤 IP에서 · 성공/실패로 했는지"를
 * 확인하는 조회 전용 화면이다(append-only 원장, 수정/삭제 UI 없음).
 *
 * 기록 대상은 로그인/레포트 업로드·교체·공개전환/새로고침·즉시수집/권한·그룹
 * 변경/메일 발송·스케줄 변경/서비스센터 요청/통계 조회 등 "의미 있는 행위"
 * 단위이며, 단순 메뉴 이동·화면 렌더링은 로그 볼륨 통제를 위해 기록하지 않는다
 * (design.md "감사 로그 설계" 참조).
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, History } from 'lucide-react'

import { auditApi } from '@/api/auditApi'
import type { AuditLogItem } from '@/types/audit'

/** action(enum 값) → 한글 표시 라벨. backend/app/core/constants.py AuditAction과 동기화. */
const ACTION_LABEL: Record<string, string> = {
  login: '로그인',
  report_view: '레포트 조회',
  report_create: '레포트 등록/업로드',
  report_update: '레포트 수정/교체',
  report_delete: '레포트 삭제',
  report_visibility_change: '공개 상태 변경',
  export_run: '내보내기(Export)',
  mail_send: '메일 발송',
  mail_schedule_create: '메일 스케줄 생성',
  mail_schedule_update: '메일 스케줄 수정',
  mail_schedule_delete: '메일 스케줄 삭제',
  permission_change: '권한 변경',
  group_change: '그룹 변경',
  refresh_trigger: '새로고침 실행',
  refresh_cancel: '새로고침 중지',
  collect_now: '즉시 수집',
  admin_setting_change: '운영 설정 변경',
  powerbi_api_failure: 'Power BI 오류',
  permission_denied: '권한 거부',
  request_create: '서비스 요청 등록',
  request_update: '서비스 요청 처리',
  request_comment: '서비스 요청 댓글',
  stats_view: '통계 조회',
}

/** resource_type → 한글 표시 라벨. 정의되지 않은 값은 원본을 그대로 보여준다. */
const RESOURCE_LABEL: Record<string, string> = {
  report: '레포트',
  dataset: '데이터셋',
  workspace: 'Workspace',
  company: '계열사',
  powerbi: 'Power BI',
}

const RESULT_LABEL: Record<string, string> = { success: '성공', failure: '실패' }
const RESULT_CLS: Record<string, string> = {
  success: 'bg-green-50 text-green-700',
  failure: 'bg-red-50 text-red-700',
}

const PAGE_SIZE = 50

/** date input 값(`YYYY-MM-DD`) → 하루 시작/끝 ISO(UTC) 문자열. 빈 값이면 undefined. */
function dayStartIso(value: string): string | undefined {
  if (!value) return undefined
  return new Date(`${value}T00:00:00`).toISOString()
}
function dayEndIso(value: string): string | undefined {
  if (!value) return undefined
  return new Date(`${value}T23:59:59.999`).toISOString()
}

function formatMeta(meta: AuditLogItem['meta']): string {
  if (!meta || Object.keys(meta).length === 0) return '-'
  return Object.entries(meta)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ')
}

function toCsvField(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(rows: AuditLogItem[]) {
  const headers = ['시각', '주체', '행위', '대상', '결과', 'IP', '메타']
  const lines = [headers.map(toCsvField).join(',')]
  for (const r of rows) {
    lines.push([
      r.occurred_at_local,
      r.actor_label ?? r.actor_user_id ?? '',
      ACTION_LABEL[r.action] ?? r.action,
      [RESOURCE_LABEL[r.resource_type ?? ''] ?? r.resource_type, r.resource_id].filter(Boolean).join(' #'),
      RESULT_LABEL[r.result] ?? r.result,
      r.ip_address ?? '',
      formatMeta(r.meta),
    ].map(toCsvField).join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'audit-logs.csv'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function AuditLogsPage() {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [action, setAction] = useState('')
  const [result, setResult] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const query = useMemo(
    () => ({
      from: dayStartIso(fromDate),
      to: dayEndIso(toDate),
      action: action || undefined,
      result: result || undefined,
      q: q.trim() || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [fromDate, toDate, action, result, q, page],
  )

  const logsQuery = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: ({ signal }) => auditApi.list(query, signal),
    staleTime: 10_000,
  })
  const actionsQuery = useQuery({
    queryKey: ['audit-log-actions'],
    queryFn: ({ signal }) => auditApi.actions(signal),
    staleTime: 5 * 60_000,
  })

  const rows = logsQuery.data ?? []
  const actions = actionsQuery.data ?? []
  const hasMore = rows.length === PAGE_SIZE

  function resetAndSearch<T>(setter: (v: T) => void, value: T) {
    setter(value)
    setPage(0)
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="portal-content-page-title portal-content-page-title--mb-3">감사 로그</h2>
          <p className="text-sm text-slate-500">
            사용자가 언제, 어떤 대상에, 어떤 행위를 했는지 조회 전용으로 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => exportCsv(rows)}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> CSV 내보내기
        </button>
      </div>

      {/* 필터 바 */}
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="flex flex-col text-xs text-slate-500">
          시작일
          <input type="date" value={fromDate} max={toDate || undefined} aria-label="시작일"
            onChange={(e) => resetAndSearch(setFromDate, e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          종료일
          <input type="date" value={toDate} min={fromDate || undefined} aria-label="종료일"
            onChange={(e) => resetAndSearch(setToDate, e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          행위
          <select value={action} aria-label="행위 필터"
            onChange={(e) => resetAndSearch(setAction, e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">전체</option>
            {actions.map((a) => (
              <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          결과
          <select value={result} aria-label="결과 필터"
            onChange={(e) => resetAndSearch(setResult, e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">전체</option>
            <option value="success">성공</option>
            <option value="failure">실패</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col text-xs text-slate-500">
          검색 (주체명 · 대상 ID)
          <input value={q} placeholder="예: 홍길동, 42" aria-label="주체/대상 검색"
            onChange={(e) => resetAndSearch(setQ, e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        {(fromDate || toDate || action || result || q) && (
          <button
            type="button"
            onClick={() => { setFromDate(''); setToDate(''); setAction(''); setResult(''); setQ(''); setPage(0) }}
            className="pb-2 text-xs text-slate-400 underline hover:text-slate-600"
          >
            초기화
          </button>
        )}
      </div>

      {/* 목록 */}
      {logsQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">시각</th>
                <th className="px-4 py-3">주체</th>
                <th className="px-4 py-3">행위</th>
                <th className="px-4 py-3">대상</th>
                <th className="px-4 py-3">결과</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{r.occurred_at_local}</td>
                  <td className="px-4 py-3 text-slate-700">{r.actor_label ?? (r.actor_user_id != null ? `#${r.actor_user_id}` : '-')}</td>
                  <td className="px-4 py-3 text-slate-700">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.resource_type
                      ? `${RESOURCE_LABEL[r.resource_type] ?? r.resource_type}${r.resource_id ? ` #${r.resource_id}` : ''}`
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_CLS[r.result] ?? 'bg-slate-100 text-slate-600'}`}>
                      {RESULT_LABEL[r.result] ?? r.result}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{r.ip_address ?? '-'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-400" title={formatMeta(r.meta)}>
                    {formatMeta(r.meta)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    <History className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                    조건에 해당하는 활동 이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
        <span>{page * PAGE_SIZE + 1}~{page * PAGE_SIZE + rows.length}건</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            이전
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      </div>
    </section>
  )
}
