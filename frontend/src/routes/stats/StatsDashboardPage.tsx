/** 통계 대시보드 (T-39, 고도화) — 요구사항 R18.
 *
 * - System_Operator: 전역 통계. [메인] · [추이] · [상세 조회] 3탭 + 기간/계열사 필터.
 *   - 메인: KPI(접속자 고유/전체·총 레포트(+신규)·접속 레포트·총 뷰) + 계열사별 레포트 수
 *     + 레포트 조회수 TOP10 + 시간대별(0~23시) 조회/사용자.
 *   - 추이: 주별/월별 접속자·누적 레포트·조회 수.
 *   - 상세: 계열사/레포트/기간별 부서 조회 상세(조회수·고유 사용자·최근 접속) + CSV.
 * - Super_User: 관리자가 VIEW_STATS를 부여한 레포트만 선택해 조회(스코프).
 */
import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { startOfDay, endOfDay } from 'date-fns'
import { Users, UserCheck, Eye, FileText, FolderOpen, Download, CalendarClock, FileBarChart, Building2, Table2 } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

import { statsApi } from '@/api/dashboardApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { BOM, escapeCsvField } from '@/utils/csv'
import type {
  CompanyReports, HourlyPoint, RawViewEvent, ReportDetailRow, ReportDetailUserRow, StatsHighlights, StatsOverview, TopReport, TrendPoint,
} from '@/types/dashboard'

// ── 날짜 유틸 ────────────────────────────────────────────────────────────────
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}

// ── 공통 표시 컴포넌트 ───────────────────────────────────────────────────────
const TONE_CLS = {
  slate: 'text-slate-600 bg-slate-100',
  green: 'text-green-600 bg-green-50',
  blue: 'text-blue-600 bg-blue-50',
  violet: 'text-violet-600 bg-violet-50',
  amber: 'text-amber-600 bg-amber-50',
} as const

function KpiCard({ label, value, delta, Icon, tone = 'slate' }: {
  label: string
  value: number
  delta?: number | null
  Icon: typeof Users
  tone?: keyof typeof TONE_CLS
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${TONE_CLS[tone]}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold leading-tight text-slate-800">{value.toLocaleString()}</span>
          {delta != null && delta > 0 && (
            <span className="text-xs font-semibold text-green-600">(+{delta.toLocaleString()})</span>
          )}
        </div>
        <div className="truncate text-xs leading-tight text-slate-500">{label}</div>
      </div>
    </div>
  )
}

function SectionCard({ title, action, children }: {
  title: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

/** 필터 바 카드 공통 래퍼: 아이콘 배지 + 라벨 + 컨트롤을 한 줄에 배치. */
function FilterCard({ icon: Icon, label, children }: {
  icon: typeof CalendarClock; label: string; children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="h-5 w-px bg-slate-200" />
      {children}
    </div>
  )
}

/** 작성자 대시보드용 심플 기간 필터: 프리셋 버튼 없이 시작~종료 날짜 선택만. */
function SimplePeriodFilter({ fromDate, toDate, onChange }: {
  fromDate: string; toDate: string; onChange: (from: string, to: string) => void
}) {
  return (
    <FilterCard icon={CalendarClock} label="기간">
      <div className="flex items-center gap-1.5">
        <input type="date" value={fromDate} max={toDate || undefined}
          onChange={(e) => onChange(e.target.value, toDate)} aria-label="시작일"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700" />
        <span className="text-slate-400">~</span>
        <input type="date" value={toDate} min={fromDate || undefined}
          onChange={(e) => onChange(fromDate, e.target.value)} aria-label="종료일"
          className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700" />
        {(fromDate || toDate) && (
          <button type="button" onClick={() => onChange('', '')}
            className="ml-1 text-xs text-slate-400 underline hover:text-slate-600">
            전체
          </button>
        )}
      </div>
    </FilterCard>
  )
}

// ── 차트 ─────────────────────────────────────────────────────────────────────
function HourlyChart({ data, height = 240 }: { data: HourlyPoint[]; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="hour" tickFormatter={(h) => `${h}시`} tick={{ fontSize: 11 }} interval={1} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip labelFormatter={(h) => `${h}시`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="views" name="레포트 조회 수" fill="#93c5fd" radius={[3, 3, 0, 0]} />
          <Line yAxisId="right" dataKey="users" name="사용자 수" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function TopReportsBar({ data, selectedReportId, onSelect, height = 240, nameAxisWidth = 100 }: {
  data: TopReport[]
  selectedReportId?: number | null
  onSelect?: (reportId: number | null) => void
  height?: number
  /** Y축(레포트명) 폭. 넓힐수록 이름이 덜 잘리고 막대(그래프) 영역은 그만큼 줄어든다. */
  nameAxisWidth?: number
}) {
  const rows = data.map((r) => ({
    id: r.report_id,
    name: r.report_name ?? `#${r.report_id}`,
    count: r.count,
  }))
  if (rows.length === 0) return <p className="text-sm text-slate-400">데이터 없음</p>
  const maxChars = Math.max(6, Math.round(nameAxisWidth / 8.5))
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 0 }} barCategoryGap="30%" maxBarSize={22}>
          <defs>
            <linearGradient id="topReportBarGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="topReportBarGradientActive" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={nameAxisWidth} tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
            tickFormatter={(v: string) => (v.length > maxChars ? `${v.slice(0, maxChars)}…` : v)} />
          <Tooltip cursor={{ fill: '#f8fafc' }} />
          <Bar
            dataKey="count" name="조회수" radius={[0, 6, 6, 0]}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={(d: { id?: string }) => {
              if (!onSelect || !d?.id) return
              const rid = Number(d.id)
              if (!Number.isFinite(rid)) return
              onSelect(selectedReportId === rid ? null : rid)
            }}
          >
            {rows.map((r) => {
              const active = selectedReportId != null && String(selectedReportId) === r.id
              return (
                <Cell
                  key={r.id}
                  fill={active ? 'url(#topReportBarGradientActive)' : 'url(#topReportBarGradient)'}
                />
              )
            })}
            <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const GRANULARITY_LABEL: Record<'day' | 'week' | 'month', string> = { day: '전일', week: '전주', month: '전월' }

/** 마지막 포인트 vs 그 이전 포인트의 전기간 대비 변화율 배지. */
function TrendSummaryBadges({ series, granularity }: { series: TrendPoint[]; granularity: 'day' | 'week' | 'month' }) {
  if (series.length < 2) return null
  const cur = series[series.length - 1]
  const prev = series[series.length - 2]
  const pct = (a: number, b: number): number | null => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10)

  const items: { label: string; value: number; pct: number | null }[] = [
    { label: '조회 수', value: cur.views, pct: pct(cur.views, prev.views) },
    { label: '접속자 수', value: cur.unique_users, pct: pct(cur.unique_users, prev.unique_users) },
    { label: '신규 레포트', value: cur.new_reports, pct: pct(cur.new_reports, prev.new_reports) },
  ]
  const label = GRANULARITY_LABEL[granularity]

  return (
    <div className="mb-3 flex flex-wrap gap-4 rounded-lg bg-slate-100/70 px-4 py-2 text-xs text-slate-500">
      {items.map((it) => (
        <span key={it.label}>
          {it.label} <b className="text-slate-700">{it.value.toLocaleString()}</b>{' '}
          {it.pct == null ? (
            <span className="text-slate-400">({label} 대비 -)</span>
          ) : (
            <span className={it.pct >= 0 ? 'text-green-600' : 'text-red-500'}>
              ({label} 대비 {it.pct >= 0 ? '+' : ''}{it.pct}%)
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

function TrendsChart({ series }: { series: TrendPoint[] }) {
  if (series.length === 0) return <p className="text-sm text-slate-400">데이터 없음</p>
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="right" dataKey="views" name="조회 수" fill="#bfdbfe" radius={[3, 3, 0, 0]} barSize={18} />
          <Bar yAxisId="left" dataKey="new_reports" name="신규 레포트 수" fill="#bbf7d0" radius={[3, 3, 0, 0]} barSize={10} />
          <Line yAxisId="left" dataKey="unique_users" name="접속자 수" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
          <Line yAxisId="left" dataKey="total_reports" name="누적 레포트 수" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function CompanyCards({ data, selected, onSelect }: {
  data: CompanyReports[]
  selected?: number | null
  onSelect?: (id: number | null) => void
}) {
  if (data.length === 0) return <p className="text-sm text-slate-400">데이터 없음</p>
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {data.map((c) => {
        const active = selected != null && selected === c.company_id
        return (
          <button
            key={String(c.company_id)}
            type="button"
            onClick={() => onSelect?.(active ? null : c.company_id)}
            className={
              'flex items-baseline gap-2 rounded-lg border px-3 py-2 text-left shadow-sm transition ' +
              (active ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50')
            }
          >
            <span className="text-lg font-bold leading-tight text-slate-800">{c.count.toLocaleString()}</span>
            <span className="truncate text-xs leading-tight text-slate-500">{c.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function DetailTable({ rows, onExport, selectedDepartment, onSelectDepartment }: {
  rows: ReportDetailRow[]
  onExport: () => void
  selectedDepartment?: string | null
  onSelectDepartment?: (department: string | null) => void
}) {
  return (
    <SectionCard
      title="부서별 조회 상세"
      action={
        <button
          type="button"
          onClick={onExport}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      }
    >
      {onSelectDepartment && (
        <p className="mb-2 text-xs text-slate-400">부서를 클릭하면 시간대별 추이가 그 부서로 필터링됩니다.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="py-2 pr-3 font-medium">부서</th>
              <th className="py-2 pr-3 text-right font-medium">조회수</th>
              <th className="py-2 pr-3 text-right font-medium">고유 사용자</th>
              <th className="py-2 font-medium">최근 접속</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400">데이터 없음</td></tr>
            )}
            {rows.map((r) => {
              const active = selectedDepartment === r.department
              return (
                <tr key={r.department}
                  className={`border-b border-slate-50 ${active ? 'bg-blue-50' : ''}`}>
                  <td className="py-1">
                    {onSelectDepartment ? (
                      <button type="button"
                        onClick={() => onSelectDepartment(active ? null : r.department)}
                        className={`w-full rounded px-2 py-1 text-left transition hover:bg-blue-100 ${active ? 'font-semibold text-blue-700' : 'text-slate-700'}`}>
                        {r.department}
                      </button>
                    ) : (
                      <span className="px-2 py-1 text-slate-700">{r.department}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium text-slate-600">{r.views.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{r.unique_users.toLocaleString()}</td>
                  <td className="py-2 text-slate-500">{fmtDateTime(r.last_access)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function UserDetailTable({ rows, onExport, selectedUserId, onSelectUser }: {
  rows: ReportDetailUserRow[]
  onExport: () => void
  selectedUserId?: number | null
  onSelectUser?: (user: { id: number; name: string } | null) => void
}) {
  return (
    <SectionCard
      title="사용자별 조회 상세"
      action={
        <button
          type="button"
          onClick={onExport}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      }
    >
      {onSelectUser && (
        <p className="mb-2 text-xs text-slate-400">사용자를 클릭하면 시간대별 추이가 그 사용자로 필터링됩니다.</p>
      )}
      <div className="max-h-96 overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="py-2 pr-3 font-medium">사용자</th>
              <th className="py-2 pr-3 font-medium">부서</th>
              <th className="py-2 pr-3 text-right font-medium">조회수</th>
              <th className="py-2 font-medium">최근 접속</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400">데이터 없음</td></tr>
            )}
            {rows.map((r) => {
              const active = selectedUserId === r.user_id
              return (
                <tr key={r.user_id} className={`border-b border-slate-50 ${active ? 'bg-blue-50' : ''}`}>
                  <td className="py-1">
                    {onSelectUser ? (
                      <button type="button"
                        onClick={() => onSelectUser(active ? null : { id: r.user_id, name: r.user_name })}
                        className={`w-full rounded px-2 py-1 text-left transition hover:bg-blue-100 ${active ? 'font-semibold text-blue-700' : 'text-slate-700'}`}>
                        {r.user_name}
                      </button>
                    ) : (
                      <span className="px-2 py-1 text-slate-700">{r.user_name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{r.department}</td>
                  <td className="py-2 pr-3 text-right font-medium text-slate-600">{r.views.toLocaleString()}</td>
                  <td className="py-2 text-slate-500">{fmtDateTime(r.last_access)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

function exportUserDetailCsv(rows: ReportDetailUserRow[], filename: string) {
  const header = ['사용자', '부서', '조회수', '최근 접속']
  const lines = [header.map(escapeCsvField).join(',')]
  for (const r of rows) {
    lines.push([
      r.user_name,
      r.department,
      r.views,
      r.last_access ? fmtDateTime(r.last_access) : '',
    ].map(escapeCsvField).join(','))
  }
  const content = BOM + lines.join('\r\n')
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function fmtDateOnly(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'medium' })
}

/** 로우 이벤트를 CSV로 내보낸다(일시·사번·계열사·부서·사용자명·레포트명·레포트ID·체류시간).
 * 사전 집계 없이 원본 단위라 엑셀에서 피벗/필터로 자유롭게 재구성할 수 있다. */
function exportRawEventsCsv(rows: RawViewEvent[], filename: string) {
  const header = ['일시', '사용자ID', '계열사명', '부서명', '사용자명', '레포트명', '레포트ID', '체류시간(초)']
  const lines = [header.map(escapeCsvField).join(',')]
  for (const r of rows) {
    lines.push([
      fmtDateOnly(r.occurred_at),
      r.user_emp_no,
      r.company ?? '',
      r.department,
      r.user_name,
      r.report_name,
      r.report_id ?? '',
      r.duration_seconds ?? '',
    ].map(escapeCsvField).join(','))
  }
  const content = BOM + lines.join('\r\n')
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function exportDetailCsv(rows: ReportDetailRow[], filename: string) {
  const header = ['부서', '조회수', '고유 사용자', '최근 접속']
  const lines = [header.map(escapeCsvField).join(',')]
  for (const r of rows) {
    lines.push([
      r.department,
      r.views,
      r.unique_users,
      r.last_access ? fmtDateTime(r.last_access) : '',
    ].map(escapeCsvField).join(','))
  }
  const content = BOM + lines.join('\r\n')
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** overview KPI 카드 목록(스코프 여부에 따라 라벨/구성 분기). */
function OverviewKpis({ o, periodActive }: { o: StatsOverview; periodActive: boolean }) {
  const newDelta = periodActive ? (o.new_reports ?? null) : null
  if (o.scoped) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="고유 조회자" value={o.unique_visitors ?? 0} Icon={UserCheck} tone="violet" />
        <KpiCard label="총 레포트 뷰" value={o.report_view_count} Icon={Eye} tone="blue" />
        <KpiCard label="접속 레포트 수" value={o.viewed_reports ?? 0} Icon={FolderOpen} tone="amber" />
        <KpiCard label="총 레포트 수" value={o.total_reports ?? 0} delta={newDelta} Icon={FileText} tone="green" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard label="고유 접속자" value={o.unique_visitors ?? 0} Icon={UserCheck} tone="violet" />
      <KpiCard label="전체 접속 수" value={o.total_visits ?? 0} Icon={Users} tone="slate" />
      <KpiCard label="총 레포트 수" value={o.total_reports ?? 0} delta={newDelta} Icon={FileText} tone="green" />
      <KpiCard label="접속 레포트 수" value={o.viewed_reports ?? 0} Icon={FolderOpen} tone="amber" />
      <KpiCard label="총 레포트 뷰" value={o.report_view_count} Icon={Eye} tone="blue" />
    </div>
  )
}

// ── 운영자 대시보드 (전역, 3탭) ──────────────────────────────────────────────
type Tab = 'main' | 'trends' | 'detail'
const TABS: { key: Tab; label: string }[] = [
  { key: 'main', label: '메인' },
  { key: 'detail', label: '상세 조회' },
  { key: 'trends', label: '추이' },
]

function OperatorStats() {
  const [tab, setTab] = useState<Tab>('main')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('month')
  const [detailReportId, setDetailReportId] = useState<number | null>(null)
  // 상세 조회 탭: 부서/사용자 선택(상호 배타) → 시간대별 차트 드릴다운
  const [detailDept, setDetailDept] = useState<string | null>(null)
  const [detailUser, setDetailUser] = useState<{ id: number; name: string } | null>(null)

  const fromParam = fromDate ? startOfDay(parseYmd(fromDate)).toISOString() : undefined
  const toParam = toDate ? endOfDay(parseYmd(toDate)).toISOString() : undefined
  const periodActive = !!(fromDate || toDate)
  // 레포트를 특정 선택하면(reportId) 계열사 선택과 무관하게 그 레포트로 전 탭이 스코프된다(백엔드 우선순위).
  const base = { companyId: companyId ?? undefined, reportId: detailReportId ?? undefined, from: fromParam, to: toParam }
  const pk = [companyId ?? 'all', detailReportId ?? 'all', fromParam ?? '', toParam ?? ''] as const

  const companiesQuery = useQuery({
    queryKey: ['stats-companies'],
    queryFn: ({ signal }) => statsApi.companies(signal),
    staleTime: 5 * 60_000,
  })
  // 계열사를 고르면 레포트 드롭다운도 그 계열사 소속으로 좁힌다(서로 다른 계열사를
  // 고른 채 남는 UI 불일치 방지). 계열사 변경 시 맞지 않는 선택은 아래 useEffect로 해제.
  const reportsQuery = useQuery({
    queryKey: ['stats-reports', companyId ?? 'all'],
    queryFn: ({ signal }) => statsApi.reports(companyId ?? undefined, signal),
    staleTime: 60_000,
  })
  useEffect(() => {
    if (detailReportId == null || !reportsQuery.data) return
    // 비동기로 갱신된 레포트 선택지에서 사라진 기존 선택을 상태와 동기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!reportsQuery.data.some((r) => r.id === detailReportId)) setDetailReportId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, reportsQuery.data])
  const overviewQuery = useQuery({
    queryKey: ['stats-overview', ...pk],
    queryFn: ({ signal }) => statsApi.overview(base, signal),
    staleTime: 60_000,
  })
  const usageQuery = useQuery({
    queryKey: ['stats-usage', ...pk],
    queryFn: ({ signal }) => statsApi.usage(base, signal),
    enabled: tab === 'main',
    staleTime: 60_000,
  })
  const trendsQuery = useQuery({
    queryKey: ['stats-trends', granularity, ...pk],
    queryFn: ({ signal }) => statsApi.trends(granularity, base, signal),
    enabled: tab === 'trends',
    staleTime: 60_000,
  })
  const detailQuery = useQuery({
    queryKey: ['stats-detail', detailReportId ?? 'none', ...pk],
    queryFn: ({ signal }) =>
      statsApi.reportDetail({ ...base, reportId: detailReportId ?? undefined }, signal),
    enabled: tab === 'detail',
    staleTime: 60_000,
  })
  const detailUsersQuery = useQuery({
    queryKey: ['stats-detail-users', detailReportId ?? 'none', ...pk],
    queryFn: ({ signal }) =>
      statsApi.reportDetailUsers({ ...base, reportId: detailReportId ?? undefined }, signal),
    enabled: tab === 'detail',
    staleTime: 60_000,
  })
  const detailHourlyQuery = useQuery({
    queryKey: ['stats-detail-hourly', detailDept ?? '', detailUser?.id ?? '', ...pk],
    queryFn: ({ signal }) =>
      statsApi.hourly({ ...base, department: detailDept ?? undefined, userId: detailUser?.id }, signal),
    enabled: tab === 'detail',
    staleTime: 60_000,
  })
  // 로우 이벤트 다운로드: 데이터가 클 수 있어 버튼 클릭 시점에만 조회한다.
  const rawEventsMutation = useMutation({
    mutationFn: () => statsApi.rawEvents(base),
    onSuccess: (rows) => exportRawEventsCsv(rows, 'report-view-raw-events.csv'),
  })

  function selectDept(d: string | null) {
    setDetailDept(d)
    setDetailUser(null)
  }
  function selectUser(u2: { id: number; name: string } | null) {
    setDetailUser(u2)
    setDetailDept(null)
  }

  const companies = companiesQuery.data ?? []
  const reports = reportsQuery.data ?? []
  const o = overviewQuery.data
  const u = usageQuery.data

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">통계 대시보드</h1>
      </div>

      {/* 탭 */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              'border-b-2 px-4 py-2 text-sm font-medium transition ' +
              (tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 필터 바: 기간 + 계열사 + 레포트 (작성자 화면과 동일한 스타일, 좌측 정렬).
          계열사를 먼저 골라야 레포트 목록이 그 계열사로 좁혀지므로 계열사를 앞에 둔다. */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <SimplePeriodFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} />
        <FilterCard icon={Building2} label="계열사">
          <select
            value={companyId ?? ''}
            onChange={(e) => {
              setCompanyId(e.target.value ? Number(e.target.value) : null)
              setDetailReportId(null)
            }}
            aria-label="계열사 필터"
            className="min-w-[140px] rounded-md border border-slate-300 px-2 py-1 text-sm font-medium text-slate-800"
          >
            <option value="">전체</option>
            {companies.map((c) => (
              <option key={String(c.company_id)} value={c.company_id ?? ''}>{c.label}</option>
            ))}
          </select>
        </FilterCard>
        <FilterCard icon={FileBarChart} label="레포트">
          <select
            value={detailReportId ?? ''}
            onChange={(e) => setDetailReportId(e.target.value ? Number(e.target.value) : null)}
            aria-label="레포트 선택"
            className="min-w-[200px] rounded-md border border-slate-300 px-2 py-1 text-sm font-medium text-slate-800"
          >
            <option value="">전체 레포트</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </FilterCard>
      </div>

      {/* ── 메인 탭 ── */}
      {tab === 'main' && (
        <div className="space-y-5">
          {!o ? (
            <p className="text-sm text-slate-400">불러오는 중…</p>
          ) : (
            <OverviewKpis o={o} periodActive={periodActive} />
          )}

          <SectionCard title="계열사별 레포트 수">
            <CompanyCards data={u?.reports_by_company ?? []} selected={companyId} onSelect={setCompanyId} />
          </SectionCard>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SectionCard title="레포트 조회수 TOP 10">
              <TopReportsBar data={u?.top_reports ?? []} height={280} nameAxisWidth={190} />
            </SectionCard>
            <SectionCard title="시간대별 조회 · 사용자 (0~23시)">
              <HourlyChart data={u?.hourly ?? []} height={280} />
            </SectionCard>
          </div>
        </div>
      )}

      {/* ── 추이 탭 ── */}
      {tab === 'trends' && (
        <SectionCard
          title="일별/주별/월별 추이 (접속자 · 신규/누적 레포트 · 조회 수)"
          action={
            <div className="flex gap-1">
              {(['day', 'week', 'month'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition ' +
                    (granularity === g
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
                  }
                >
                  {g === 'day' ? '일별' : g === 'week' ? '주별' : '월별'}
                </button>
              ))}
            </div>
          }
        >
          {trendsQuery.isLoading || !trendsQuery.data ? (
            <p className="text-sm text-slate-400">불러오는 중…</p>
          ) : (
            <>
              <TrendSummaryBadges series={trendsQuery.data.series} granularity={granularity} />
              <TrendsChart series={trendsQuery.data.series} />
            </>
          )}
        </SectionCard>
      )}

      {/* ── 상세 조회 탭 ── */}
      {tab === 'detail' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              상단의 레포트/계열사/기간 필터 기준 조회 현황입니다. 아래 부서/사용자를 선택하면 가운데 시간대별 추이가 그 범위로 필터링됩니다.
            </p>
            <button
              type="button"
              onClick={() => rawEventsMutation.mutate()}
              disabled={rawEventsMutation.isPending}
              title="일시·사용자ID·계열사명·부서명·사용자명·레포트명·레포트ID·체류시간 원본 데이터를 CSV로 내보냅니다"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Table2 className="h-3.5 w-3.5" />
              {rawEventsMutation.isPending ? '내보내는 중…' : '로우 데이터 다운로드(CSV)'}
            </button>
          </div>
          {rawEventsMutation.isError && (
            <p role="alert" className="text-xs text-red-600">로우 데이터를 불러오지 못했습니다. 다시 시도해 주세요.</p>
          )}
          {detailQuery.isLoading || detailUsersQuery.isLoading ? (
            <p className="text-sm text-slate-400">불러오는 중…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
              <DetailTable
                rows={detailQuery.data ?? []}
                onExport={() => exportDetailCsv(detailQuery.data ?? [], 'report-detail-by-department.csv')}
                selectedDepartment={detailDept}
                onSelectDepartment={selectDept}
              />
              <SectionCard
                title={
                  detailDept
                    ? `시간대별 조회 · 사용자 — ${detailDept}`
                    : detailUser
                      ? `시간대별 조회 · 사용자 — ${detailUser.name}`
                      : '시간대별 조회 · 사용자 (전체)'
                }
                action={
                  (detailDept || detailUser) && (
                    <button type="button" onClick={() => { setDetailDept(null); setDetailUser(null) }}
                      className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50">
                      선택 해제
                    </button>
                  )
                }
              >
                <HourlyChart data={detailHourlyQuery.data ?? []} />
              </SectionCard>
              <UserDetailTable
                rows={detailUsersQuery.data ?? []}
                onExport={() => exportUserDetailCsv(detailUsersQuery.data ?? [], 'report-detail-by-user.csv')}
                selectedUserId={detailUser?.id ?? null}
                onSelectUser={selectUser}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 작성자 KPI 5종 + 오늘 접속(전일대비%) + 파생 인사이트(평균 조회수/미조회/최근 접속). */
function AuthorKpis({ o, h }: { o: StatsOverview; h?: StatsHighlights }) {
  const totalReports = o.total_reports ?? 0
  const totalVisits = o.report_view_count
  const avgViewsPerReport = totalReports > 0 ? Math.round((totalVisits / totalReports) * 10) / 10 : 0

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="총 접속(레포트 뷰)" value={totalVisits} Icon={Eye} tone="blue" />
        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
            <CalendarClock className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold leading-tight text-slate-800">{(h?.today_views ?? 0).toLocaleString()}</span>
              {h && (
                h.is_new ? (
                  <span className="text-xs font-semibold text-green-600">신규</span>
                ) : h.pct_change != null && (
                  <span className={`text-xs font-semibold ${h.pct_change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {h.pct_change >= 0 ? '+' : ''}{h.pct_change}%
                  </span>
                )
              )}
            </div>
            <div className="truncate text-xs leading-tight text-slate-500">오늘 접속(전일대비)</div>
          </div>
        </div>
        <KpiCard label="총 접속자(중복제거)" value={o.unique_visitors ?? 0} Icon={UserCheck} tone="violet" />
        <KpiCard label="총 레포트" value={totalReports} Icon={FileText} tone="green" />
        <KpiCard label="접속 레포트(중복제거)" value={o.viewed_reports ?? 0} Icon={FolderOpen} tone="amber" />
      </div>
      <div className="flex flex-wrap gap-4 rounded-lg bg-slate-100/70 px-4 py-2 text-xs text-slate-500">
        <span>레포트당 평균 조회수 <b className="text-slate-700">{avgViewsPerReport.toLocaleString()}</b></span>
        <span>미조회 레포트 <b className="text-slate-700">{h?.unused_count ?? 0}개</b></span>
        <span>최근 접속 <b className="text-slate-700">{fmtDateTime(h?.last_access ?? null)}</b></span>
      </div>
    </div>
  )
}

// ── Super_User 대시보드 (VIEW_STATS 부여 레포트 스코프, 작성자 전체 기본) ─────
function SuperUserStats() {
  // null = 전체(작성자 게시 레포트 전체), 값 있으면 그 레포트만(드릴다운)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // 부서/사용자 선택(상호 배타) → 시간대별 차트 드릴다운
  const [detailDept, setDetailDept] = useState<string | null>(null)
  const [detailUser, setDetailUser] = useState<{ id: number; name: string } | null>(null)

  const reportsQuery = useQuery({
    queryKey: ['stats-reports'],
    queryFn: ({ signal }) => statsApi.reports(undefined, signal),
    staleTime: 60_000,
  })
  const statReports = reportsQuery.data ?? []

  const fromParam = fromDate ? startOfDay(parseYmd(fromDate)).toISOString() : undefined
  const toParam = toDate ? endOfDay(parseYmd(toDate)).toISOString() : undefined
  const canQuery = !reportsQuery.isLoading && statReports.length > 0
  const base = { reportId: selectedId ?? undefined, from: fromParam, to: toParam }
  const pk = [selectedId ?? 'all', fromParam ?? '', toParam ?? ''] as const

  const overviewQuery = useQuery({
    queryKey: ['stats-overview', ...pk],
    queryFn: ({ signal }) => statsApi.overview(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const highlightsQuery = useQuery({
    queryKey: ['stats-highlights', selectedId ?? 'all'],
    queryFn: ({ signal }) => statsApi.highlights({ reportId: selectedId ?? undefined }, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const usageQuery = useQuery({
    queryKey: ['stats-usage', ...pk],
    queryFn: ({ signal }) => statsApi.usage(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const hourlyQuery = useQuery({
    queryKey: ['stats-hourly-main', ...pk],
    queryFn: ({ signal }) => statsApi.hourly(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const detailQuery = useQuery({
    queryKey: ['stats-detail', ...pk],
    queryFn: ({ signal }) => statsApi.reportDetail(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const detailUsersQuery = useQuery({
    queryKey: ['stats-detail-users', ...pk],
    queryFn: ({ signal }) => statsApi.reportDetailUsers(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const drilldownHourlyQuery = useQuery({
    queryKey: ['stats-detail-hourly', detailDept ?? '', detailUser?.id ?? '', ...pk],
    queryFn: ({ signal }) =>
      statsApi.hourly({ ...base, department: detailDept ?? undefined, userId: detailUser?.id }, signal),
    enabled: canQuery && (!!detailDept || !!detailUser),
    staleTime: 60_000,
  })
  // 로우 이벤트 다운로드: 데이터가 클 수 있어 버튼 클릭 시점에만 조회한다.
  const rawEventsMutation = useMutation({
    mutationFn: () => statsApi.rawEvents(base),
    onSuccess: (rows) => exportRawEventsCsv(rows, 'report-view-raw-events.csv'),
  })

  function selectDept(d: string | null) {
    setDetailDept(d)
    setDetailUser(null)
  }
  function selectUser(u2: { id: number; name: string } | null) {
    setDetailUser(u2)
    setDetailDept(null)
  }
  function selectTopReport(reportId: number | null) {
    setSelectedId(reportId)
    setDetailDept(null)
    setDetailUser(null)
  }

  const o = overviewQuery.data
  const h = highlightsQuery.data
  const u = usageQuery.data
  const top5 = (u?.top_reports ?? []).slice(0, 5)
  const noStatsReports = !reportsQuery.isLoading && statReports.length === 0
  const selectedReportName = selectedId != null ? statReports.find((r) => r.id === selectedId)?.name : null

  const drilldownActive = !!detailDept || !!detailUser
  const centerHourlyData = drilldownActive ? (drilldownHourlyQuery.data ?? []) : (hourlyQuery.data ?? [])
  const centerHourlyTitle = detailDept
    ? `시간대별 조회 · 사용자 — ${detailDept}`
    : detailUser
      ? `시간대별 조회 · 사용자 — ${detailUser.name}`
      : '시간대별 조회 · 사용자 (0~23시)'

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800">통계 대시보드</h1>
      </div>

      {noStatsReports ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-400">
          통계 조회 권한이 부여된 레포트가 없습니다. 관리자에게 통계 권한을 요청하세요.
        </div>
      ) : (
        <div className="space-y-5">
          {/* 기간 필터 + 레포트 선택: 기본값 전체, 선택 시 그 레포트로 드릴다운. 별도 카드지만 좌측에 붙여 배치 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <SimplePeriodFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} />
            <FilterCard icon={FileBarChart} label="레포트">
              <select
                value={selectedId ?? ''}
                onChange={(e) => selectTopReport(e.target.value ? Number(e.target.value) : null)}
                aria-label="통계 레포트 선택"
                className="min-w-[200px] rounded-md border border-slate-300 px-2 py-1 text-sm font-medium text-slate-800"
              >
                <option value="">전체 레포트 ({statReports.length}개)</option>
                {statReports.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </FilterCard>
          </div>

          {selectedReportName && (
            <p className="-mt-2 text-xs text-slate-500">
              현재 보기: <span className="font-medium text-blue-700">{selectedReportName}</span>{' '}
              <button type="button" onClick={() => selectTopReport(null)} className="ml-1 text-slate-400 underline hover:text-slate-600">
                전체로 보기
              </button>
            </p>
          )}

          {o && <AuthorKpis o={o} h={h} />}

          {/* 좌: 시간대별(넓게) / 우: TOP5(중복 미제거 조회수) */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SectionCard
              title={centerHourlyTitle}
              action={
                drilldownActive && (
                  <button type="button" onClick={() => { setDetailDept(null); setDetailUser(null) }}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50">
                    선택 해제
                  </button>
                )
              }
            >
              <HourlyChart data={centerHourlyData} height={220} />
            </SectionCard>
            <SectionCard title="레포트 조회 수 TOP 5 (중복 미제거)">
              <TopReportsBar data={top5} selectedReportId={selectedId} onSelect={selectTopReport} height={220} />
            </SectionCard>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              아래 부서/사용자를 선택하면 위 시간대별 추이가 그 범위로 필터링됩니다.
            </p>
            <button
              type="button"
              onClick={() => rawEventsMutation.mutate()}
              disabled={rawEventsMutation.isPending}
              title="일시·사용자ID·계열사명·부서명·사용자명·레포트명·레포트ID·체류시간 원본 데이터를 CSV로 내보냅니다"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Table2 className="h-3.5 w-3.5" />
              {rawEventsMutation.isPending ? '내보내는 중…' : '로우 데이터 다운로드(CSV)'}
            </button>
          </div>
          {rawEventsMutation.isError && (
            <p role="alert" className="text-xs text-red-600">로우 데이터를 불러오지 못했습니다. 다시 시도해 주세요.</p>
          )}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DetailTable
              rows={detailQuery.data ?? []}
              onExport={() => exportDetailCsv(detailQuery.data ?? [], 'report-detail-by-department.csv')}
              selectedDepartment={detailDept}
              onSelectDepartment={selectDept}
            />
            <UserDetailTable
              rows={detailUsersQuery.data ?? []}
              onExport={() => exportUserDetailCsv(detailUsersQuery.data ?? [], 'report-detail-by-user.csv')}
              selectedUserId={detailUser?.id ?? null}
              onSelectUser={selectUser}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function StatsDashboardPage() {
  const user = useAuthStore((s) => s.user)
  const isOperator = (user?.roles ?? []).includes('System_Operator')
  return isOperator ? <OperatorStats /> : <SuperUserStats />
}
