import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'

import { englishKeyboardToHangul } from '@/utils/hangulKeyboard'
import type {
  LifecycleResponse,
  ReportPerformanceRow,
  StatsInsights,
  TeamActivityRow,
  UserActivityRow,
} from '@/types/dashboard'

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}초`
  const minutes = Math.floor(seconds / 60)
  const remain = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}분 ${remain}초`
  const hours = Math.floor(minutes / 60)
  return `${hours}시간 ${minutes % 60}분`
}

function pct(value: number | null | undefined): string {
  return value == null ? '-' : `${value.toLocaleString()}%`
}

/** 지표 용어 설명. 표 머리글·카드의 물음표에 마우스를 올리거나 포커스하면 이 문구가 열린다. */
const METRIC_HELP = {
  reportViews: '레포트 화면이 실제로 열린 횟수입니다. 같은 사람이 여러 번 열면 각각 셉니다.',
  uniqueViewers: '기간 안에 한 번이라도 조회한 사람 수입니다(같은 사람은 한 번만 셉니다).',
  reportsViewed: '그 사용자가 본 서로 다른 레포트 수입니다.',
  downloads: '레포트 파일 관련 다운로드 요청 수입니다.',
  logins: '포털에 로그인한 횟수입니다. 레포트 조회와 별개로 접속 자체를 셉니다.',
  engagedViews: '30초 이상 화면을 보고 있던 조회입니다.',
  engagedRate: '유효 조회 ÷ 전체 조회입니다. 값이 높으면 레포트를 클릭한 사람이 실제로 내용까지 본 비율이 높다는 뜻입니다.',
  repeatViewers: '기간 안에 같은 레포트를 2회 이상 본 사람 수입니다. 레포트를 계속 이용하는 사람입니다.',
  repeatRate: '재방문자 ÷ 고유 조회자입니다.',
  reachRate: '이 레포트를 조회한 사람 ÷ 전체 활성 사용자입니다. 조직에서 얼마나 널리 퍼졌는지 보는 값입니다.',
  teamAdoptionRate: '그 팀에서 조회한 사람 ÷ 그 팀의 현재 활성 등록 사용자입니다. 왼쪽 활성/대상 칸을 비율로 나타낸 값입니다.',
  duration: '화면에 실제로 체류한 시간의 합계(근사치)입니다.',
  avgDuration: '조회 1건당 평균 체류시간(근사치)입니다.',
  previousPeriod: '선택한 기간 바로 앞의 같은 길이 기간입니다(예 : 최근 7일을 조회 중이라면 그 앞 7일과 비교합니다).',
  declining: '직전기간에 3회 이상 조회됐는데 현재 기간 조회가 그 절반 이하로 떨어진 레포트입니다.',
  userDepartment: '소속 부서입니다. 아래 작은 글씨는 소속 계열사입니다.',
  activeOfEligible: '선택 기간에 레포트를 조회한 사람 수 / 그 팀의 현재 활성 등록 사용자 수입니다. 분모는 기간과 무관한 현재 시점 기준입니다.',
} as const

// ── 컬럼 정렬 ────────────────────────────────────────────────────────────────
type SortDirection = 'asc' | 'desc'
type SortValue = string | number | null | undefined
type SortState = { key: string; dir: SortDirection }

/** 값 비교. 빈 값은 정렬 방향과 무관하게 항상 아래로 보낸다. */
function compareSortValues(a: SortValue, b: SortValue, dir: SortDirection): number {
  const emptyA = a == null || a === ''
  const emptyB = b == null || b === ''
  if (emptyA && emptyB) return 0
  if (emptyA) return 1
  if (emptyB) return -1
  const result = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'ko')
  return dir === 'asc' ? result : -result
}

/** 표 정렬 상태. 같은 컬럼을 다시 누르면 오름/내림이 바뀌고, 다른 컬럼은 내림차순으로 시작한다. */
function useSortedRows<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
  initialKey: string,
) {
  const [sort, setSort] = useState<SortState>({ key: initialKey, dir: 'desc' })
  const sortedRows = useMemo(() => {
    const accessor = accessors[sort.key]
    if (!accessor) return rows
    return [...rows].sort((a, b) => compareSortValues(accessor(a), accessor(b), sort.dir))
  }, [rows, accessors, sort])
  const toggle = useCallback((key: string) => {
    setSort((current) => (
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' }
    ))
  }, [])
  return { sortedRows, sort, toggle }
}

/** 정렬 가능한 표 머리글. 지표 설명 툴팁을 함께 붙일 수 있다. */
function SortableTh({ label, sortKey, sort, onSort, help, align = 'right' }: {
  label: string
  sortKey: string
  sort: SortState
  onSort: (key: string) => void
  help?: string
  align?: 'left' | 'right'
}) {
  const active = sort.key === sortKey
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-3 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`${label} 기준 ${active && sort.dir === 'desc' ? '오름차순' : '내림차순'} 정렬`}
        className={`inline-flex items-center gap-0.5 rounded transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${active ? 'font-bold text-slate-700' : 'text-slate-500'}`}
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-blue-600' : 'text-slate-300'}>
          {active && sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
      {help ? <HelpTip label={label} text={help} /> : null}
    </th>
  )
}

const HELP_TIP_WIDTH = 240 // w-60

/** 다크 배경 툴팁. 마우스 호버와 키보드 포커스 모두에서 열린다.
 * 표 컨테이너는 가로 스크롤을 위해 overflow-x-auto를 쓰는데, CSS 스펙상
 * overflow-x를 auto로 주면 overflow-y도 자동으로 클리핑된다. 그래서 결과가
 * 1행이라 표 높이가 낮을 때 절대 위치(absolute)로 띄운 박스는 아래쪽이 잘렸다.
 * 이를 근본적으로 피하기 위해 박스를 document.body에 포털로 렌더링하고
 * position:fixed로 좌표를 계산해 표의 클리핑 영역 자체를 벗어나게 한다.
 *
 * 시각 툴팁은 보조기기에서 중복 낭독되지 않도록 aria-hidden으로 두고, 같은 문구를
 * sr-only로 함께 제공한다. 앵커 쪽에서 aria-describedby={descriptionId}로 연결한다. */
export function HoverTooltip({ text, descriptionId, className, children }: {
  text: string
  descriptionId: string
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePosition = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const half = HELP_TIP_WIDTH / 2
    const left = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8)
    setCoords({ top: rect.top, left })
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  // 버튼→박스 사이 간격(mb-2)을 마우스가 지나갈 때 살짝 늦게 닫아, 잠깐의 빈 공간
  // 때문에 hover가 끊겨 툴팁이 깜빡이며 사라지는 것을 막는다.
  const openNow = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  return (
    <span
      ref={anchorRef}
      className={`relative inline-flex align-middle ${className ?? ''}`}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      onFocus={openNow}
      onBlur={scheduleClose}
    >
      {children}
      <span id={descriptionId} className="sr-only">{text}</span>
      {open && coords && createPortal(
        <span
          role="tooltip"
          aria-hidden="true"
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: HELP_TIP_WIDTH,
            transform: 'translate(-50%, calc(-100% - 8px))',
          }}
          className="z-[100] whitespace-normal rounded-lg bg-slate-800 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-xl"
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  )
}

/** 지표 용어 설명용 물음표 버튼. 다크 툴팁을 공통 컴포넌트로 띄운다. */
function HelpTip({ label, text }: { label: string; text: string }) {
  const descriptionId = useId()
  return (
    <HoverTooltip text={text} descriptionId={descriptionId}>
      <button
        type="button"
        aria-label={`${label} 설명 보기`}
        aria-describedby={descriptionId}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-400 transition hover:border-blue-400 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        ?
      </button>
    </HoverTooltip>
  )
}

function ChangeBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-slate-400">비교 불가</span>
  const tone = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-slate-500'
  return (
    <span className={`text-xs font-semibold ${tone}`}>
      {value > 0 ? '+' : ''}{value.toLocaleString()}%
    </span>
  )
}

function Empty({ loading, text }: { loading?: boolean; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-400">
      {loading ? '불러오는 중…' : text}
    </div>
  )
}

const TEAM_SORT_ACCESSORS: Record<string, (row: TeamActivityRow) => SortValue> = {
  company: (row) => row.company,
  department: (row) => row.department,
  active_users: (row) => row.active_users,
  adoption_rate: (row) => row.adoption_rate,
  report_views: (row) => row.report_views,
  engaged_views: (row) => row.engaged_views,
  downloads: (row) => row.downloads,
  logins: (row) => row.logins,
  last_activity: (row) => row.last_activity,
}

/** 표 위 계열사 필터 select. 상단 필터 바의 "계열사"는 레포트가 속한 폴더 기준이라,
 * 이 표의 데이터(조회자의 인사 조직도 기준 계열사)와는 별도 축이다. 조직도 쪽 계열사는
 * 향후 늘어날 수 있으니 rows에서 실제 등장하는 값만 동적으로 뽑아 옵션을 구성한다. */
function OrgCompanyFilter({ value, onChange, options }: {
  value: string | null
  onChange: (value: string | null) => void
  options: string[]
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      조직도 계열사
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="조직도 계열사 필터"
        className="rounded-md border border-slate-300 px-2 py-1 text-sm font-medium text-slate-700"
      >
        <option value="">전체</option>
        {options.map((label) => (
          <option key={label} value={label}>{label}</option>
        ))}
      </select>
    </label>
  )
}

export function TeamActivityTable({ rows, loading }: { rows: TeamActivityRow[]; loading?: boolean }) {
  const [orgCompany, setOrgCompany] = useState<string | null>(null)
  const companyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) {
      if (row.company) set.add(row.company)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows])
  const filteredRows = useMemo(
    () => (orgCompany ? rows.filter((row) => row.company === orgCompany) : rows),
    [rows, orgCompany],
  )
  const { sortedRows, sort, toggle } = useSortedRows(filteredRows, TEAM_SORT_ACCESSORS, 'report_views')

  if (!rows.length) return <Empty loading={loading} text="선택 기간의 팀 활동이 없습니다." />

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <OrgCompanyFilter value={orgCompany} onChange={setOrgCompany} options={companyOptions} />
        {orgCompany && (
          <span className="text-xs text-slate-400">{filteredRows.length.toLocaleString()}개 팀 표시 중</span>
        )}
      </div>
      {filteredRows.length === 0 ? (
        <Empty text="선택한 계열사에 해당하는 팀 활동이 없습니다." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <SortableTh label="계열사" sortKey="company" sort={sort} onSort={toggle} align="left" />
                <SortableTh label="팀" sortKey="department" sort={sort} onSort={toggle} align="left" />
                <SortableTh label="활성/대상" sortKey="active_users" sort={sort} onSort={toggle} help={METRIC_HELP.activeOfEligible} />
                <SortableTh label="활용률" sortKey="adoption_rate" sort={sort} onSort={toggle} help={METRIC_HELP.teamAdoptionRate} />
                <SortableTh label="레포트 뷰" sortKey="report_views" sort={sort} onSort={toggle} help={METRIC_HELP.reportViews} />
                <SortableTh label="유효 조회" sortKey="engaged_views" sort={sort} onSort={toggle} help={METRIC_HELP.engagedViews} />
                <SortableTh label="다운로드" sortKey="downloads" sort={sort} onSort={toggle} help={METRIC_HELP.downloads} />
                <SortableTh label="로그인" sortKey="logins" sort={sort} onSort={toggle} help={METRIC_HELP.logins} />
                <SortableTh label="최근 활동" sortKey="last_activity" sort={sort} onSort={toggle} align="left" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => (
                <tr key={`${row.department_id ?? 'none'}-${row.department}`} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-600">{row.company || '-'}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-800">{row.department}</div>
                    <div className="text-xs text-slate-400" title={row.org_path ?? undefined}>
                      {row.division || '상위 조직 정보 없음'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{row.active_users.toLocaleString()} / {row.eligible_users.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-blue-700">{pct(row.adoption_rate)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{row.report_views.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{row.engaged_views.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{row.downloads.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{row.logins == null ? '-' : row.logins.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDateTime(row.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const USER_SORT_ACCESSORS: Record<string, (row: UserActivityRow) => SortValue> = {
  user_name: (row) => row.user_name,
  department: (row) => row.department,
  reports_viewed: (row) => row.reports_viewed,
  report_views: (row) => row.report_views,
  engaged_views: (row) => row.engaged_views,
  duration_seconds: (row) => row.duration_seconds,
  downloads: (row) => row.downloads,
  login_count: (row) => row.login_count,
  last_activity: (row) => row.last_activity,
}

/** 사용자명/사번/부서명으로 걸러내는 인라인 검색 박스. */
function UserSearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex w-full max-w-xs items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
      <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="사용자명·사번·부서 검색…"
        aria-label="사용자 검색"
        className="w-full min-w-0 text-sm text-slate-800 outline-none placeholder:text-slate-400"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="검색어 지우기" className="shrink-0 text-slate-400 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export function UserActivityTable({ rows, loading }: { rows: UserActivityRow[]; loading?: boolean }) {
  const [query, setQuery] = useState('')
  const filteredRows = useMemo(() => {
    const rawQuery = query.trim()
    if (!rawQuery) return rows
    // 영문 자판으로 입력한 경우에도 원문(사번 등)과 두벌식 한글 변환값을 함께 비교한다.
    // 예: tjgmldus → "tjgmldus" 및 "서희연" 모두 검색어로 사용.
    const terms = [...new Set([
      rawQuery.toLowerCase(),
      englishKeyboardToHangul(rawQuery).toLowerCase(),
    ])]
    return rows.filter((row) => {
      const values = [row.user_name ?? '', row.emp_no ?? '', row.department, row.company ?? '']
        .map((value) => value.toLowerCase())
      return terms.some((term) => values.some((value) => value.includes(term)))
    })
  }, [rows, query])
  const { sortedRows, sort, toggle } = useSortedRows(filteredRows, USER_SORT_ACCESSORS, 'report_views')

  if (!rows.length) return <Empty loading={loading} text="선택 기간의 사용자 활동이 없습니다." />

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <UserSearchBox value={query} onChange={setQuery} />
        {query && (
          <span className="shrink-0 text-xs text-slate-400">{filteredRows.length.toLocaleString()}명 검색됨</span>
        )}
      </div>
      {filteredRows.length === 0 ? (
        <Empty text="검색 조건에 맞는 사용자가 없습니다." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <SortableTh label="사용자" sortKey="user_name" sort={sort} onSort={toggle} align="left" />
                <SortableTh label="부서" sortKey="department" sort={sort} onSort={toggle} align="left" help={METRIC_HELP.userDepartment} />
                <SortableTh label="조회 레포트" sortKey="reports_viewed" sort={sort} onSort={toggle} help={METRIC_HELP.reportsViewed} />
                <SortableTh label="레포트 뷰" sortKey="report_views" sort={sort} onSort={toggle} help={METRIC_HELP.reportViews} />
                <SortableTh label="유효 조회" sortKey="engaged_views" sort={sort} onSort={toggle} help={METRIC_HELP.engagedViews} />
                <SortableTh label="체류시간" sortKey="duration_seconds" sort={sort} onSort={toggle} help={METRIC_HELP.duration} />
                <SortableTh label="다운로드" sortKey="downloads" sort={sort} onSort={toggle} help={METRIC_HELP.downloads} />
                <SortableTh label="로그인" sortKey="login_count" sort={sort} onSort={toggle} help={METRIC_HELP.logins} />
                <SortableTh label="최근 활동" sortKey="last_activity" sort={sort} onSort={toggle} align="left" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => (
                <tr key={row.user_id} className={!row.is_active ? 'bg-slate-50/70 text-slate-400' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-800">{row.user_name || `#${row.user_id}`}</div>
                    <div className="text-xs text-slate-400">{row.emp_no || '-'}{!row.is_active ? ' · 비활성' : ''}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-slate-600">{row.department}</div>
                    {row.company ? <div className="text-xs text-slate-400">{row.company}</div> : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">{row.reports_viewed.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{row.report_views.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">{row.engaged_views.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">{fmtDuration(row.duration_seconds)}</td>
                  <td className="px-3 py-2.5 text-right">{row.downloads.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">{row.login_count == null ? '-' : row.login_count.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDateTime(row.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const REPORT_SORT_ACCESSORS: Record<string, (row: ReportPerformanceRow) => SortValue> = {
  report_name: (row) => row.report_name,
  owner_label: (row) => row.owner_label,
  views: (row) => row.views,
  previous_views: (row) => row.previous_views,
  unique_viewers: (row) => row.unique_viewers,
  reach_rate: (row) => row.reach_rate,
  engaged_rate: (row) => row.engaged_rate,
  repeat_viewers: (row) => row.repeat_viewers,
  avg_duration_seconds: (row) => row.avg_duration_seconds,
  downloads: (row) => row.downloads,
  last_viewed_at: (row) => row.last_viewed_at,
}

export function ReportPerformanceTable({ rows, loading }: { rows: ReportPerformanceRow[]; loading?: boolean }) {
  const { sortedRows, sort, toggle } = useSortedRows(rows, REPORT_SORT_ACCESSORS, 'views')
  if (!rows.length) return <Empty loading={loading} text="표시할 레포트 성과가 없습니다." />
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[1320px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <SortableTh label="레포트" sortKey="report_name" sort={sort} onSort={toggle} align="left" />
            <SortableTh label="작성자/계열사" sortKey="owner_label" sort={sort} onSort={toggle} align="left" />
            <SortableTh label="조회" sortKey="views" sort={sort} onSort={toggle} help={METRIC_HELP.reportViews} />
            <SortableTh label="직전기간" sortKey="previous_views" sort={sort} onSort={toggle} help={METRIC_HELP.previousPeriod} />
            <SortableTh label="고유 조회자" sortKey="unique_viewers" sort={sort} onSort={toggle} help={METRIC_HELP.uniqueViewers} />
            <SortableTh label="도달률" sortKey="reach_rate" sort={sort} onSort={toggle} help={METRIC_HELP.reachRate} />
            <SortableTh label="유효 조회율" sortKey="engaged_rate" sort={sort} onSort={toggle} help={METRIC_HELP.engagedRate} />
            <SortableTh label="재방문자" sortKey="repeat_viewers" sort={sort} onSort={toggle} help={METRIC_HELP.repeatViewers} />
            <SortableTh label="평균 체류" sortKey="avg_duration_seconds" sort={sort} onSort={toggle} help={METRIC_HELP.avgDuration} />
            <SortableTh label="다운로드" sortKey="downloads" sort={sort} onSort={toggle} help={METRIC_HELP.downloads} />
            <SortableTh label="최근 조회" sortKey="last_viewed_at" sort={sort} onSort={toggle} align="left" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedRows.map((row) => (
            <tr key={row.report_id} className={row.declining ? 'bg-red-50/40' : 'hover:bg-slate-50'}>
              <td className="px-3 py-2.5">
                <div className="font-medium text-slate-800">{row.report_name}</div>
                <div className="text-xs text-slate-400">{row.is_published ? '게시 중' : '비공개'}{row.declining ? ' · 급감 감지' : ''}</div>
              </td>
              <td className="px-3 py-2.5"><div className="text-slate-700">{row.owner_label || '-'}</div><div className="text-xs text-slate-400">{row.company}</div></td>
              <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{row.views.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right"><div>{row.previous_views.toLocaleString()}</div><ChangeBadge value={row.views_change_pct} /></td>
              <td className="px-3 py-2.5 text-right">{row.unique_viewers.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-blue-700">{pct(row.reach_rate)}</td>
              <td className="px-3 py-2.5 text-right">{pct(row.engaged_rate)}</td>
              <td className="px-3 py-2.5 text-right">{row.repeat_viewers.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right">{fmtDuration(row.avg_duration_seconds)}</td>
              <td className="px-3 py-2.5 text-right">{row.downloads.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDateTime(row.last_viewed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const LIFECYCLE_LABELS: Record<string, string> = {
  report_create: '추가', report_update: '수정', report_delete: '삭제',
}

export function LifecyclePanel({ data, loading }: { data?: LifecycleResponse; loading?: boolean }) {
  if (!data) return <Empty loading={loading} text="선택 기간의 생명주기 이벤트가 없습니다." />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {([
          ['추가', data.summary.created, 'text-green-700 bg-green-50'],
          ['수정', data.summary.updated, 'text-blue-700 bg-blue-50'],
          ['삭제', data.summary.deleted, 'text-red-700 bg-red-50'],
        ] as const).map(([label, value, tone]) => (
          <div key={label} className={`rounded-xl border border-slate-200 px-4 py-3 ${tone}`}>
            <div className="text-xs font-medium opacity-80">레포트 {label}</div>
            <div className="mt-1 text-2xl font-bold">{value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
            <th className="px-3 py-3">일시</th><th className="px-3 py-3">구분</th><th className="px-3 py-3">레포트</th>
            <th className="px-3 py-3">계열사</th><th className="px-3 py-3">작성자</th><th className="px-3 py-3">처리자</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.events.map((event) => (
              <tr key={event.event_id} className="hover:bg-slate-50">
                <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDateTime(event.occurred_at)}</td>
                <td className="px-3 py-2.5 font-medium text-slate-700">{LIFECYCLE_LABELS[event.action] ?? event.action}</td>
                <td className="px-3 py-2.5 text-slate-800">{event.report_name}</td>
                <td className="px-3 py-2.5 text-slate-600">{event.company}</td>
                <td className="px-3 py-2.5 text-slate-600">{event.owner_label || '-'}</td>
                <td className="px-3 py-2.5 text-slate-600">{event.actor_name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InsightCard({ label, value, suffix, change, help }: {
  label: string; value: number; suffix?: string; change?: number | null; help: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center text-xs text-slate-500">
        {label}
        <HelpTip label={label} text={help} />
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800">{value.toLocaleString()}{suffix}</span>
        <ChangeBadge value={change} />
      </div>
    </div>
  )
}

export function InsightsPanel({ data, loading }: { data?: StatsInsights; loading?: boolean }) {
  if (!data) return <Empty loading={loading} text="인사이트를 계산할 활동 데이터가 없습니다." />
  const c = data.current
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <InsightCard label="레포트 뷰" value={c.views} change={data.changes_pct.views} help={METRIC_HELP.reportViews} />
        <InsightCard label="고유 조회자" value={c.unique_viewers} change={data.changes_pct.unique_viewers} help={METRIC_HELP.uniqueViewers} />
        <InsightCard label="다운로드 요청" value={c.downloads} change={data.changes_pct.downloads} help={METRIC_HELP.downloads} />
        <InsightCard label="유효 조회" value={c.engaged_views} change={data.changes_pct.engaged_views} help={METRIC_HELP.engagedViews} />
        <InsightCard label="유효 조회율" value={c.engaged_rate ?? 0} suffix="%" help={METRIC_HELP.engagedRate} />
        <InsightCard label="재방문율" value={c.repeat_rate ?? 0} suffix="%" help={METRIC_HELP.repeatRate} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 flex items-center text-sm font-bold text-slate-700">
            미사용 레포트 ({data.inactive_cutoff_days}일 기준)
            <HelpTip
              label="미사용 레포트"
              text={`최근 ${data.inactive_cutoff_days}일 동안 조회 기록이 한 건도 없는 게시 레포트입니다.`}
            />
          </h3>
          {data.inactive_reports.length === 0 ? <p className="text-sm text-slate-400">미사용 레포트가 없습니다.</p> : (
            <ul className="space-y-2">
              {data.inactive_reports.slice(0, 10).map((report) => (
                <li key={report.report_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-700">{report.report_name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{report.days_since_last_view == null ? '조회 없음' : `${report.days_since_last_view}일 전`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 flex items-center text-sm font-bold text-slate-700">
            조회 급감 레포트
            <HelpTip label="조회 급감 레포트" text={METRIC_HELP.declining} />
          </h3>
          {data.declining_reports.length === 0 ? <p className="text-sm text-slate-400">급감이 감지된 레포트가 없습니다.</p> : (
            <ul className="space-y-2">
              {data.declining_reports.slice(0, 10).map((report) => (
                <li key={report.report_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-700">{report.report_name}</span>
                  <ChangeBadge value={report.views_change_pct} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-700">지표 설명 한눈에 보기</summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {([
            ['레포트 뷰', METRIC_HELP.reportViews],
            ['고유 조회자', METRIC_HELP.uniqueViewers],
            ['유효 조회', METRIC_HELP.engagedViews],
            ['유효 조회율', METRIC_HELP.engagedRate],
            ['재방문자', METRIC_HELP.repeatViewers],
            ['재방문율', METRIC_HELP.repeatRate],
            ['도달률', METRIC_HELP.reachRate],
            ['다운로드 요청', METRIC_HELP.downloads],
            ['체류시간', METRIC_HELP.duration],
            ['직전기간 비교', METRIC_HELP.previousPeriod],
            ['조회 급감 레포트', METRIC_HELP.declining],
            ['미사용 레포트', `최근 ${data.inactive_cutoff_days}일 동안 조회 기록이 한 건도 없는 게시 레포트입니다.`],
          ] as const).map(([term, description]) => (
            <div key={term}>
              <dt className="font-semibold text-slate-600">{term}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}
