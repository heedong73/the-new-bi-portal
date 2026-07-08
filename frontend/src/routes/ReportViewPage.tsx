/**
 * 레포트 뷰 화면 (ReportViewPage, T-37).
 *
 * - Power BI Embedded 렌더링(Embed Token)
 * - 새로고침 상태 배지 + 다음 예약
 * - 수동 새로고침 버튼: REFRESH 권한은 백엔드가 강제(403 시 한국어 안내).
 *   레포트의 dataset_id 는 목록(VIEW 필터)에서 조회.
 * 요구사항: R9, R10, R13
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { models, type Report } from 'powerbi-client'
import {
  ArrowLeft, RefreshCw, Upload, X, AlertTriangle, Star,
  Maximize2, Monitor, ScanLine, ChevronDown, Clock, Save, RotateCcw, Download,
} from 'lucide-react'

import { datasetsApi, reportsApi } from '@/api/portalApi'
import { ApiError } from '@/api/client'
import { reportDisplayName, type RefreshStatus, type ExportFormat } from '@/types/report'
import { useTaskStore } from '@/stores/useTaskStore'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import PowerBIEmbed from '@/components/embed/PowerBIEmbed'
import RefreshStatusBadge from '@/components/refresh/RefreshStatusBadge'

const REFRESH_TERMINAL_FAIL = ['Failed', 'Cancelled', 'Disabled']

/** 다운로드 포맷 표시 라벨. */
const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  PDF: 'PDF', PPTX: 'PowerPoint', PNG: '이미지', PBIX: '원본(.pbix)',
}

/** 요일(영문) → 한글 축약. */
const WEEKDAY_KO: Record<string, string> = {
  Monday: '월', Tuesday: '화', Wednesday: '수', Thursday: '목',
  Friday: '금', Saturday: '토', Sunday: '일',
}
function weekdayKo(d: string): string {
  return WEEKDAY_KO[d] ?? d
}

/** 라이브 새로고침 상태 폴링 주기(ms). .env로 조정 가능. */
const LIVE_POLL_IDLE_MS = (Number(import.meta.env.VITE_LIVE_REFRESH_IDLE_SEC) || 60) * 1000
const LIVE_POLL_ACTIVE_MS = (Number(import.meta.env.VITE_LIVE_REFRESH_ACTIVE_SEC) || 10) * 1000

function fmtLocal(iso?: string | null): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}

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
    queryKey: ['live-refresh', reportDbId],
    queryFn: ({ signal }) => reportsApi.liveRefreshStatus(reportDbId, signal),
    enabled: validId,
    refetchInterval: (q) => ((q.state.data as { in_progress?: boolean } | undefined)?.in_progress ? LIVE_POLL_ACTIVE_MS : LIVE_POLL_IDLE_MS),
    staleTime: 5_000,
  })

  // 새로고침 실패 알림: 진행 중(true) → 종료(false) 전환 시 실패 상태면 토스트
  const [refreshFailed, setRefreshFailed] = useState<string | null>(null)
  // 데이터 반영 안내: 사용자가 이미 반영/닫은 end_time (재노출 방지)
  const [appliedEndTime, setAppliedEndTime] = useState<string | null>(null)
  // 임베드가 렌더된 시각(ms). 이 시점 이후 완료된 새로고침만 "새 데이터"로 간주.
  const renderedAtRef = useRef<number | null>(null)
  const prevInProgress = useRef(false)
  useEffect(() => {
    const ip = !!statusQuery.data?.in_progress
    if (prevInProgress.current && !ip) {
      const st = statusQuery.data?.status ?? ''
      if (REFRESH_TERMINAL_FAIL.includes(st)) {
        setRefreshFailed(`새로고침 실패 (${st})`)
        window.setTimeout(() => setRefreshFailed(null), 8000)
      }
    }
    prevInProgress.current = ip
  }, [statusQuery.data])

  const addTask = useTaskStore((s) => s.addTask)
  const tasks = useTaskStore((s) => s.tasks)

  // 임베드된 Report 인스턴스 (보기 옵션 제어용)
  const reportRef = useRef<Report | null>(null)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [schedOpen, setSchedOpen] = useState(false)
  // 레포트 페이지 목록 + 현재 페이지 (하단 탭 대신 헤더 드롭다운으로 전환)
  const [pages, setPages] = useState<{ name: string; displayName: string }[]>([])
  const [activePageName, setActivePageName] = useState('')

  // 전체 화면 종료 시 앱 기본 보기(실제 크기)로 복귀한다.
  // (전체 화면 진입 시 페이지 맞춤으로 바꾸므로, 나올 때 되돌린다)
  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) return
      reportRef.current
        ?.updateSettings({
          layoutType: models.LayoutType.Custom,
          customLayout: { displayOption: models.DisplayOption.ActualSize },
        })
        .catch(() => { /* noop */ })
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // 공통 기본 뷰 상태(embed 응답의 defaultViewState) — loaded 시 applyState로 적용하기 위해
  // 최신값을 ref에 유지한다(loaded 이벤트 콜백의 stale closure 방지).
  const defaultViewStateRef = useRef<string | null>(null)
  useEffect(() => {
    defaultViewStateRef.current = embedQuery.data?.defaultViewState ?? null
  }, [embedQuery.data])
  // 기본 뷰 저장/초기화 결과 안내(자동 소멸)
  const [viewSaveMsg, setViewSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function handleReport(r: Report | null) {
    reportRef.current = r
    if (renderedAtRef.current == null) renderedAtRef.current = Date.now()
    if (!r) return
    // 기본 보기를 '실제 크기'로 확실히 적용 (초기 embedConfig만으론 미적용되는 경우 대비)
    const applyFit = () => {
      r.updateSettings({
        layoutType: models.LayoutType.Custom,
        customLayout: { displayOption: models.DisplayOption.ActualSize },
      }).catch(() => { /* noop */ })
    }
    const loadPages = () => {
      r.getPages()
        .then((pgs) => {
          // 레포트에서 숨김 처리한 페이지는 제외 (SectionVisibility: 0=표시, 1=뷰모드 숨김)
          const isHidden = (p: { visibility?: number }) => (p.visibility as number) === 1
          const visible = pgs.filter((p) => !isHidden(p))
          setPages(visible.map((p) => ({ name: p.name, displayName: p.displayName })))
          const active = pgs.find((p) => p.isActive)
          const initial = active && !isHidden(active) ? active : visible[0]
          if (initial) setActivePageName(initial.name)
        })
        .catch(() => { /* noop */ })
    }
    // 저장된 공통 기본 뷰(슬라이서/필터/페이지)가 있으면 로드 후 적용한다.
    const applyDefaultView = () => {
      const st = defaultViewStateRef.current
      if (!st) { loadPages(); return }
      r.bookmarksManager
        .applyState(st)
        .catch(() => { /* 레포트 구조 변경 등으로 실패 시 무시 */ })
        .finally(loadPages)
    }
    try {
      r.off('loaded')
      r.on('loaded', () => { applyFit(); applyDefaultView() })
    } catch {
      /* noop */
    }
    loadPages()  // 이미 로드된 경우 대비
  }

  async function selectPage(name: string) {
    setActivePageName(name)
    try {
      await reportRef.current?.setPage(name)
    } catch {
      /* noop */
    }
  }

  async function applyFullscreen() {
    setViewMenuOpen(false)
    const r = reportRef.current
    if (!r) return
    // 전체 화면에서는 화면을 꽉 채우도록 '페이지 맞춤'으로 전환한다.
    // (실제 크기로 두면 레포트가 상단에 붙고 하단에 여백이 남음)
    try {
      await r.updateSettings({
        layoutType: models.LayoutType.Custom,
        customLayout: { displayOption: models.DisplayOption.FitToPage },
      })
    } catch {
      /* noop */
    }
    try {
      r.fullscreen()
    } catch {
      /* noop */
    }
  }

  async function applyDisplayOption(option: models.DisplayOption) {
    setViewMenuOpen(false)
    const r = reportRef.current
    if (!r) return
    try {
      await r.updateSettings({
        layoutType: models.LayoutType.Custom,
        customLayout: { displayOption: option },
      })
    } catch {
      /* noop */
    }
  }

  // 현재 화면(슬라이서/필터/페이지)을 공통 기본 뷰로 저장/초기화 (MANAGE_REPORT 권한자).
  const defaultViewMutation = useMutation({
    mutationFn: (state: string | null) => reportsApi.saveDefaultView(reportDbId, state),
    onSuccess: (_data, state) => {
      setViewSaveMsg({
        ok: true,
        text: state ? '현재 뷰를 기본값으로 저장했습니다.' : '기본 뷰를 초기화했습니다.',
      })
      window.setTimeout(() => setViewSaveMsg(null), 4000)
      queryClient.invalidateQueries({ queryKey: ['embed', reportDbId] })
    },
    onError: () => {
      setViewSaveMsg({ ok: false, text: '기본 뷰 저장에 실패했습니다.' })
      window.setTimeout(() => setViewSaveMsg(null), 4000)
    },
  })

  async function saveCurrentAsDefault() {
    setViewMenuOpen(false)
    const r = reportRef.current
    if (!r) return
    try {
      // 슬라이서/필터/페이지 선택을 북마크 state로 캡처(모든 페이지 포함).
      const bookmark = await r.bookmarksManager.capture({ allPages: true })
      defaultViewMutation.mutate(bookmark.state ?? null)
    } catch {
      setViewSaveMsg({ ok: false, text: '현재 뷰 상태를 가져오지 못했습니다.' })
      window.setTimeout(() => setViewSaveMsg(null), 4000)
    }
  }

  function clearDefaultView() {
    setViewMenuOpen(false)
    defaultViewMutation.mutate(null)
  }

  // 즐겨찾기 토글
  const favoriteMutation = useMutation({
    mutationFn: () =>
      report?.is_favorite
        ? reportsApi.removeFavorite(reportDbId)
        : reportsApi.addFavorite(reportDbId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })

  const refreshMutation = useMutation({
    mutationFn: () => {
      if (!report?.dataset_id) {
        throw new Error('이 레포트에는 연결된 데이터셋이 없습니다.')
      }
      return datasetsApi.triggerRefresh(report.dataset_id)
    },
    onSuccess: () => {
      addTask({
        id: `refresh-${reportDbId}-${Date.now()}`,
        label: report ? reportDisplayName(report) : '레포트',
        kind: 'refresh',
        status: 'pending',
        reportId: reportDbId,
        startedAt: Date.now(),
      })
      queryClient.invalidateQueries({ queryKey: ['live-refresh', reportDbId] })
    },
  })

  // 다운로드(Export): 포맷별 비동기 Export 요청 → 작업 도크가 진행/완료·자동 다운로드 처리.
  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) => reportsApi.startExport(reportDbId, format),
    onSuccess: (res, format) => {
      addTask({
        id: `export-${res.export_job_id}`,
        label: `${report ? reportDisplayName(report) : '레포트'} · ${EXPORT_FORMAT_LABEL[format]}`,
        kind: 'export',
        status: 'pending',
        exportJobId: res.export_job_id,
        startedAt: Date.now(),
      })
    },
  })

  function requestExport(format: ExportFormat) {
    setDownloadMenuOpen(false)
    exportMutation.mutate(format)
  }

  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceMutation = useMutation({
    mutationFn: (file: File) => reportsApi.replacePbix(reportDbId, file),
    onSuccess: (res) => {
      const label = report ? reportDisplayName(report) : '레포트'
      addTask({ id: res.task_id, label, kind: 'pbix_replace', status: 'pending' })
      setReplaceOpen(false)
      setReplaceFile(null)
    },
  })

  // PBIX 교체 업로드(파일 전송) 중에는 새로고침/창 닫기 시 경고.
  useBeforeUnload(replaceMutation.isPending)

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
  // 새로고침 진행 중: 트리거 POST 중 / PBI가 진행중 보고 / 도크 작업 진행 중
  const live = statusQuery.data
  const refreshing = refreshMutation.isPending || !!live?.in_progress || tasks.some(
    (t) => t.kind === 'refresh' && t.reportId === reportDbId && t.status === 'pending',
  )
  // 배지용 상태 (라이브 PBI 기준)
  const badgeStatus: RefreshStatus = live && live.has_history
    ? {
        has_history: true,
        status: live.status ?? 'Unknown',
        last_refresh_local: fmtLocal(live.end_time ?? live.start_time),
      }
    : { has_history: false }

  // 마지막 업데이트 = max(라이브 새로고침 end_time, report.updated_at)
  // PBIX 교체는 새로고침 이력에 안 남을 수 있으므로 updated_at도 함께 고려한다.
  const lastUpdateLabel = useMemo(() => {
    const candidates: number[] = []
    if (live?.end_time) {
      const t = new Date(live.end_time).getTime()
      if (!Number.isNaN(t)) candidates.push(t)
    }
    if (report?.updated_at) {
      const t = new Date(report.updated_at).getTime()
      if (!Number.isNaN(t)) candidates.push(t)
    }
    if (candidates.length === 0) return null
    return fmtLocal(new Date(Math.max(...candidates)).toISOString())
  }, [live?.end_time, report?.updated_at])

  const isFavorite = !!report?.is_favorite

  // 새 데이터 반영 안내: 임베드 렌더 이후 "완료"된 새로고침이 감지되면(end_time이 더 최신),
  // 자동 갱신 대신 배너+버튼으로 사용자가 직접 반영하도록 한다(조작 방해 최소화).
  const newDataEndTime = live?.status === 'Completed' ? (live.end_time ?? null) : null
  const newDataAvailable = Boolean(
    newDataEndTime
    && !refreshing
    && renderedAtRef.current != null
    && new Date(newDataEndTime).getTime() > renderedAtRef.current
    && newDataEndTime !== appliedEndTime,
  )

  function applyNewData() {
    try {
      reportRef.current?.refresh()
    } catch {
      /* noop */
    }
    setAppliedEndTime(newDataEndTime)
  }

  function dismissNewData() {
    setAppliedEndTime(newDataEndTime)
  }

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
    <div className="flex h-full flex-col bg-slate-50">
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
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold text-slate-800">{title}</h1>
            <button
              type="button"
              aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              aria-pressed={isFavorite}
              disabled={favoriteMutation.isPending}
              onClick={() => favoriteMutation.mutate()}
              className="shrink-0 rounded-full p-1 transition hover:bg-slate-100 disabled:opacity-50"
            >
              <Star className={`h-5 w-5 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span>작성자: {report?.author_label || '-'}</span>
            <span className="text-slate-300">·</span>
            <span>마지막 업데이트: {lastUpdateLabel ?? '-'}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <RefreshStatusBadge status={badgeStatus} isLoading={statusQuery.isLoading} />

          {/* 갱신 예정 (예약 새로고침이 활성일 때) */}
          {live?.schedule?.enabled && live.schedule.next_scheduled_local && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSchedOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={schedOpen}
                title="예약 새로고침 상세 보기"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
              >
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                갱신 예정: {fmtLocal(live.schedule.next_scheduled_local)}
              </button>
              {schedOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setSchedOpen(false)}
                  />
                  <div role="dialog" aria-label="예약 새로고침" className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
                    <p className="mb-1.5 font-semibold text-slate-700">예약 새로고침</p>
                    <p className="text-slate-500">
                      요일: <span className="text-slate-700">{live.schedule.days.map(weekdayKo).join(', ') || '-'}</span>
                    </p>
                    <p className="text-slate-500">
                      시간: <span className="text-slate-700">{live.schedule.times.join(', ') || '-'}</span>
                    </p>
                    <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-slate-500">
                      다음 갱신: <span className="font-medium text-blue-700">{fmtLocal(live.schedule.next_scheduled_local)}</span>
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 페이지 선택 (하단 탭 대신) */}
          {pages.length > 1 && (
            <select
              value={activePageName}
              onChange={(e) => selectPage(e.target.value)}
              aria-label="페이지 선택"
              className="max-w-[14rem] rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {pages.map((p) => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))}
            </select>
          )}

          {/* 보기 옵션 드롭다운 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setViewMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={viewMenuOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Monitor className="h-4 w-4" />
              보기 옵션
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {viewMenuOpen && (
              <>
                <button
                  type="button"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setViewMenuOpen(false)}
                />
                <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button type="button" role="menuitem" onClick={applyFullscreen}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <Maximize2 className="h-4 w-4 text-slate-500" /> 전체 화면
                  </button>
                  <button type="button" role="menuitem" onClick={() => applyDisplayOption(models.DisplayOption.FitToPage)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <Monitor className="h-4 w-4 text-slate-500" /> 페이지 맞춤
                  </button>
                  <button type="button" role="menuitem" onClick={() => applyDisplayOption(models.DisplayOption.ActualSize)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <ScanLine className="h-4 w-4 text-slate-500" /> 실제 크기
                  </button>
                  {report?.can_manage && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      <button type="button" role="menuitem" onClick={saveCurrentAsDefault} disabled={defaultViewMutation.isPending}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        <Save className="h-4 w-4 text-slate-500" /> 현재 뷰를 기본값으로 저장
                      </button>
                      <button type="button" role="menuitem" onClick={clearDefaultView} disabled={defaultViewMutation.isPending}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                        <RotateCcw className="h-4 w-4 text-slate-400" /> 기본 뷰 초기화
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 다운로드 드롭다운 (DOWNLOAD 권한자에게만 노출) */}
          {report?.can_download && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDownloadMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={downloadMenuOpen}
                disabled={exportMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                다운로드
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {downloadMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setDownloadMenuOpen(false)}
                  />
                  <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    <p className="px-3 py-1.5 text-xs font-medium text-slate-400">렌더링 파일</p>
                    <button type="button" role="menuitem" onClick={() => requestExport('PDF')}
                      className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">PDF</button>
                    <button type="button" role="menuitem" onClick={() => requestExport('PPTX')}
                      className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">PowerPoint (PPTX)</button>
                    <button type="button" role="menuitem" onClick={() => requestExport('PNG')}
                      className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">이미지 (PNG)</button>
                    <div className="my-1 border-t border-slate-100" />
                    <p className="px-3 py-1.5 text-xs font-medium text-slate-400">원본 파일</p>
                    <button type="button" role="menuitem" onClick={() => requestExport('PBIX')}
                      className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">Power BI 원본 (.pbix)</button>
                  </div>
                </>
              )}
            </div>
          )}

          {report?.can_manage && (
            <button
              type="button"
              onClick={() => { setReplaceFile(null); replaceMutation.reset(); setReplaceOpen(true) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
            >
              <Upload className="h-4 w-4" />
              레포트 업데이트(교체)
            </button>
          )}
          {canRefresh && (
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '새로고침 중…' : '새로고침'}
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
      {refreshFailed && (
        <div role="alert" className="bg-red-50 px-5 py-2 text-sm text-red-600">
          {refreshFailed}
        </div>
      )}
      {exportMutation.isError && (
        <div role="alert" className="bg-red-50 px-5 py-2 text-sm text-red-600">
          다운로드 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      )}
      {newDataAvailable && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 px-5 py-2 text-sm text-blue-700">
          <span className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" />
            데이터가 새로 갱신되었습니다. 화면에 반영할까요?
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyNewData}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              새 데이터 반영
            </button>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={dismissNewData}
              className="text-blue-400 transition hover:text-blue-600"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}
      {replaceMutation.isSuccess && (
        <div className="bg-green-50 px-5 py-2 text-sm text-green-700">
          레포트 업데이트(교체)를 요청했습니다. 게시 반영까지 잠시 걸릴 수 있습니다.
        </div>
      )}
      {viewSaveMsg && (
        <div role="status" className={`px-5 py-2 text-sm ${viewSaveMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {viewSaveMsg.text}
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
          <div className="relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <PowerBIEmbed embed={embedQuery.data} onReport={handleReport} />
          </div>
        ) : null}
      </main>

      {/* 레포트 업데이트(교체) 모달 */}
      {replaceOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="레포트 업데이트(교체)" className="my-24 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">레포트 업데이트(교체)</h3>
              <button type="button" aria-label="닫기" onClick={() => setReplaceOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>

            {/* 경고 문구 */}
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>기존 업로드된 레포트의 데이터셋과 다르다면 업데이트 불가할 수 있습니다.</span>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">PBIX 파일 선택</span>
              <input
                ref={replaceInputRef}
                type="file"
                accept=".pbix"
                aria-label="PBIX 파일"
                className="hidden"
                onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => replaceInputRef.current?.click()}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  파일 선택
                </button>
                <span className={`truncate text-sm ${replaceFile ? 'text-slate-700' : 'text-slate-400'}`}>
                  {replaceFile ? replaceFile.name : '선택된 파일 없음'}
                </span>
              </div>
            </label>

            {replaceMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                업데이트에 실패했습니다. 파일/권한 또는 데이터셋 호환성을 확인하세요.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReplaceOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" disabled={!replaceFile || replaceMutation.isPending}
                onClick={() => replaceFile && replaceMutation.mutate(replaceFile)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                <Upload className="h-4 w-4" />
                {replaceMutation.isPending ? '업데이트 중…' : '업데이트(교체)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
