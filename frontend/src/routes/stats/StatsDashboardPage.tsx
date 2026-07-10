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
import { useQuery } from '@tanstack/react-query'
import { startOfDay, endOfDay, subDays } from 'date-fns'
import { Users, UserCheck, Eye, FileText, FolderOpen, Download } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

import { statsApi } from '@/api/dashboardApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { BOM, escapeCsvField } from '@/utils/csv'
import type {
  CompanyReports, HourlyPoint, ReportDetailRow, StatsOverview, TopReport, TrendPoint,
} from '@/types/dashboard'

// ── 기간 프리셋/유틸 ─────────────────────────────────────────────────────────
const PERIOD_PRESETS: { label: string; days: number | null }[] = [
  { label: '전체', days: null },
  { label: '최근 7일', days: 7 },
  { label: '최근 30일', days: 30 },
  { label: '최근 90일', days: 90 },
]
const pad2 = (n: number) => String(n).padStart(2, '0')
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function presetRange(days: number): { from: string; to: string } {
  const today = new Date()
  return { from: toYmd(subDays(today, days - 1)), to: toYmd(today) }
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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${TONE_CLS[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</span>
        {delta != null && delta > 0 && (
          <span className="text-sm font-semibold text-green-600">(+{delta.toLocaleString()})</span>
        )}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
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

function PeriodFilter({ fromDate, toDate, onChange }: {
  fromDate: string; toDate: string; onChange: (from: string, to: string) => void
}) {
  const isPresetActive = (days: number | null) => {
    if (days === null) return !fromDate && !toDate
    const r = presetRange(days)
    return fromDate === r.from && toDate === r.to
  }
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">기간</span>
        <div className="flex flex-wrap gap-1">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => (p.days === null ? onChange('', '') : (() => { const r = presetRange(p.days!); onChange(r.from, r.to) })())}
              className={
                'rounded-md border px-2.5 py-1 text-xs font-medium transition ' +
                (isPresetActive(p.days)
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">직접 선택</span>
        <div className="flex items-center gap-1.5">
          <input type="date" value={fromDate} max={toDate || undefined}
            onChange={(e) => onChange(e.target.value, toDate)} aria-label="시작일"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700" />
          <span className="text-slate-400">~</span>
          <input type="date" value={toDate} min={fromDate || undefined}
            onChange={(e) => onChange(fromDate, e.target.value)} aria-label="종료일"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700" />
        </div>
      </div>
    </div>
  )
}

// ── 차트 ─────────────────────────────────────────────────────────────────────
function HourlyChart({ data }: { data: HourlyPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="hour" tickFormatter={(h) => `${h}시`} tick={{ fontSize: 11 }} interval={1} />
          <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip labelFormatter={(h) => `${h}시`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="views" name="조회 페이지수" fill="#93c5fd" radius={[3, 3, 0, 0]} />
          <Line yAxisId="right" dataKey="users" name="사용자 수" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function TopReportsBar({ data }: { data: TopReport[] }) {
  const rows = data.map((r) => ({
    name: r.report_name ?? `#${r.report_id}`,
    count: r.count,
  }))
  if (rows.length === 0) return <p className="text-sm text-slate-400">데이터 없음</p>
  return (
    <div style={{ height: Math.max(160, rows.length * 34) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }}
            tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 16)}…` : v)} />
          <Tooltip />
          <Bar dataKey="count" name="조회수" fill="#60a5fa" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
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
          <Bar yAxisId="right" dataKey="views" name="조회 수" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.map((c) => {
        const active = selected != null && selected === c.company_id
        return (
          <button
            key={String(c.company_id)}
            type="button"
            onClick={() => onSelect?.(active ? null : c.company_id)}
            className={
              'rounded-xl border p-4 text-left shadow-sm transition ' +
              (active ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50')
            }
          >
            <div className="text-2xl font-bold text-slate-800">{c.count.toLocaleString()}</div>
            <div className="truncate text-xs text-slate-500">{c.label}</div>
          </button>
        )
      })}
    </div>
  )
}

function DetailTable({ rows, onExport }: { rows: ReportDetailRow[]; onExport: () => void }) {
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
            {rows.map((r) => (
              <tr key={r.department} className="border-b border-slate-50">
                <td className="py-2 pr-3 text-slate-700">{r.department}</td>
                <td className="py-2 pr-3 text-right font-medium text-slate-600">{r.views.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{r.unique_users.toLocaleString()}</td>
                <td className="py-2 text-slate-500">{fmtDateTime(r.last_access)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
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
  { key: 'trends', label: '추이' },
  { key: 'detail', label: '상세 조회' },
]

function OperatorStats() {
  const [tab, setTab] = useState<Tab>('main')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [granularity, setGranularity] = useState<'week' | 'month'>('month')
  const [detailReportId, setDetailReportId] = useState<number | null>(null)

  const fromParam = fromDate ? startOfDay(parseYmd(fromDate)).toISOString() : undefined
  const toParam = toDate ? endOfDay(parseYmd(toDate)).toISOString() : undefined
  const periodActive = !!(fromDate || toDate)
  const base = { companyId: companyId ?? undefined, from: fromParam, to: toParam }
  const pk = [companyId ?? 'all', fromParam ?? '', toParam ?? ''] as const

  const companiesQuery = useQuery({
    queryKey: ['stats-companies'],
    queryFn: ({ signal }) => statsApi.companies(signal),
    staleTime: 5 * 60_000,
  })
  const reportsQuery = useQuery({
    queryKey: ['stats-reports'],
    queryFn: ({ signal }) => statsApi.reports(signal),
    staleTime: 60_000,
  })
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

  const companies = companiesQuery.data ?? []
  const reports = reportsQuery.data ?? []
  const o = overviewQuery.data
  const u = usageQuery.data

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">통계 대시보드</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          계열사
          <select
            value={companyId ?? ''}
            onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)}
            aria-label="계열사 필터"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">전체</option>
            {companies.map((c) => (
              <option key={String(c.company_id)} value={c.company_id ?? ''}>{c.label}</option>
            ))}
          </select>
        </label>
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

      {/* 필터 바 */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <PeriodFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} />
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
              <TopReportsBar data={u?.top_reports ?? []} />
            </SectionCard>
            <SectionCard title="시간대별 조회 · 사용자 (0~23시)">
              <HourlyChart data={u?.hourly ?? []} />
            </SectionCard>
          </div>
        </div>
      )}

      {/* ── 추이 탭 ── */}
      {tab === 'trends' && (
        <SectionCard
          title="주별/월별 추이 (접속자 · 누적 레포트 · 조회 수)"
          action={
            <div className="flex gap-1">
              {(['week', 'month'] as const).map((g) => (
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
                  {g === 'week' ? '주별' : '월별'}
                </button>
              ))}
            </div>
          }
        >
          {trendsQuery.isLoading || !trendsQuery.data ? (
            <p className="text-sm text-slate-400">불러오는 중…</p>
          ) : (
            <TrendsChart series={trendsQuery.data.series} />
          )}
        </SectionCard>
      )}

      {/* ── 상세 조회 탭 ── */}
      {tab === 'detail' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              레포트
              <select
                value={detailReportId ?? ''}
                onChange={(e) => setDetailReportId(e.target.value ? Number(e.target.value) : null)}
                aria-label="레포트 선택"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="">전체(계열사 기준)</option>
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-400">
              계열사/레포트/기간 필터 기준 부서별 조회 현황
            </p>
          </div>
          {detailQuery.isLoading ? (
            <p className="text-sm text-slate-400">불러오는 중…</p>
          ) : (
            <DetailTable
              rows={detailQuery.data ?? []}
              onExport={() => exportDetailCsv(detailQuery.data ?? [], 'report-detail.csv')}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Super_User 대시보드 (VIEW_STATS 부여 레포트 스코프) ───────────────────────
function SuperUserStats() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const reportsQuery = useQuery({
    queryKey: ['stats-reports'],
    queryFn: ({ signal }) => statsApi.reports(signal),
    staleTime: 60_000,
  })
  const statReports = reportsQuery.data ?? []
  useEffect(() => {
    if (selectedId === null && statReports.length > 0) setSelectedId(statReports[0].id)
  }, [selectedId, statReports])

  const fromParam = fromDate ? startOfDay(parseYmd(fromDate)).toISOString() : undefined
  const toParam = toDate ? endOfDay(parseYmd(toDate)).toISOString() : undefined
  const periodActive = !!(fromDate || toDate)
  const canQuery = selectedId !== null
  const base = { reportId: selectedId ?? undefined, from: fromParam, to: toParam }
  const pk = [selectedId ?? 'none', fromParam ?? '', toParam ?? ''] as const

  const overviewQuery = useQuery({
    queryKey: ['stats-overview', ...pk],
    queryFn: ({ signal }) => statsApi.overview(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const usageQuery = useQuery({
    queryKey: ['stats-usage', ...pk],
    queryFn: ({ signal }) => statsApi.usage(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })
  const detailQuery = useQuery({
    queryKey: ['stats-detail', ...pk],
    queryFn: ({ signal }) => statsApi.reportDetail(base, signal),
    enabled: canQuery,
    staleTime: 60_000,
  })

  const o = overviewQuery.data
  const u = usageQuery.data
  const noStatsReports = !reportsQuery.isLoading && statReports.length === 0

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">통계 대시보드</h1>
        {statReports.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            레포트
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              aria-label="통계 레포트 선택"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {statReports.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {noStatsReports ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-400">
          통계 조회 권한이 부여된 레포트가 없습니다. 관리자에게 통계 권한을 요청하세요.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <PeriodFilter fromDate={fromDate} toDate={toDate} onChange={(f, t) => { setFromDate(f); setToDate(t) }} />
          </div>

          {o && <OverviewKpis o={o} periodActive={periodActive} />}

          <SectionCard title="시간대별 조회 · 사용자 (0~23시)">
            <HourlyChart data={u?.hourly ?? []} />
          </SectionCard>

          <DetailTable
            rows={detailQuery.data ?? []}
            onExport={() => exportDetailCsv(detailQuery.data ?? [], 'report-detail.csv')}
          />
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
