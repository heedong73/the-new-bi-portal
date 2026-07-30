/**
 * 레포트 뷰 화면 (ReportViewPage, T-37).
 *
 * - Power BI Embedded 렌더링(Embed Token)
 * - 새로고침 상태 배지 + 다음 예약
 * - 수동 새로고침 버튼: REFRESH 권한은 백엔드가 강제(403 시 한국어 안내).
 *   레포트의 dataset_id 는 목록(VIEW 필터)에서 조회.
 * 요구사항: R9, R10, R13
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { models, type Report } from 'powerbi-client'
import {
  ArrowLeft, RefreshCw, Upload, X, AlertTriangle, Star,
  Maximize2, Monitor, ScanLine, ChevronDown, Clock, Save, RotateCcw, Download,
  Square,
} from 'lucide-react'

import { datasetsApi, reportsApi } from '@/api/portalApi'
import { ApiError } from '@/api/client'
import { reportDisplayName, type RefreshStatus, type ExportFormat } from '@/types/report'
import { useTaskStore } from '@/stores/useTaskStore'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import PowerBIEmbed from '@/components/embed/PowerBIEmbed'
import FavoriteFolderPrompt from '@/components/FavoriteFolderPrompt'
import RefreshStatusBadge from '@/components/refresh/RefreshStatusBadge'

const REFRESH_TERMINAL_FAIL = ['Failed', 'Disabled']

/** 다운로드 포맷 표시 라벨. */
const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  PDF: 'PDF', PPTX: 'PowerPoint', PNG: '이미지', PBIX: '원본(.pbix)',
}

/** Export 요청 1건 — 포맷 + 범위(페이지/전체/원본) 옵션 + 작업 도크 표시용 라벨. */
interface ExportRequestVariables {
  format: ExportFormat
  /** 작업 도크 라벨에 덧붙일 범위 표시(예: 페이지명, '전체 페이지'). */
  scopeLabel?: string
  options?: {
    pageName?: string | null
    pageDisplayName?: string | null
    bookmarkState?: string | null
    pageNames?: string[] | null
  }
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

function fmtDate(iso?: string | null): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? undefined
    : d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

function createViewSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 구형 브라우저/테스트 환경 fallback. 형식은 UUID v4를 유지해 백엔드 검증을 통과한다.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

export default function ReportViewPage() {
  const params = useParams<{ reportId: string }>()
  const reportDbId = Number(params.reportId)
  return <ReportViewPageContent key={params.reportId ?? ''} reportDbId={reportDbId} />
}

function ReportViewPageContent({ reportDbId }: { reportDbId: number }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const validId = Number.isFinite(reportDbId) && reportDbId > 0
  const [viewSessionId] = useState(createViewSessionId)
  const activeViewSessionIdRef = useRef<string | null>(viewSessionId)
  const requestedViewSessionRef = useRef<string | null>(null)

  useEffect(() => () => {
    activeViewSessionIdRef.current = null
  }, [])
  const [viewSessionState, setViewSessionState] = useState<{
    sessionId: string
    viewLogId: number
  } | null>(null)
  const viewLogId = viewSessionState?.sessionId === viewSessionId
    ? viewSessionState.viewLogId
    : null
  const [renderedState, setRenderedState] = useState<{
    sessionId: string
    renderedAt: number
  } | null>(null)
  const renderedAt = renderedState?.sessionId === viewSessionId
    ? renderedState.renderedAt
    : null

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

  // Embed Token 발급이 아니라 Power BI의 실제 rendered 이벤트를 조회 시작점으로 삼는다.
  // 동일 UUID 재호출은 백엔드에서도 멱등 처리하므로 이벤트 중복/네트워크 재시도에 안전하다.
  const handleRendered = useCallback(() => {
    setRenderedState((current) => (
      current?.sessionId === viewSessionId
        ? current
        : { sessionId: viewSessionId, renderedAt: Date.now() }
    ))
    if (!validId || requestedViewSessionRef.current === viewSessionId) return
    requestedViewSessionRef.current = viewSessionId

    const createSession = (attempt: number) => {
      reportsApi.createViewSession(reportDbId, viewSessionId)
        .then((session) => {
          if (
            activeViewSessionIdRef.current !== viewSessionId
            || requestedViewSessionRef.current !== viewSessionId
          ) return
          setViewSessionState({ sessionId: viewSessionId, viewLogId: session.view_log_id })
          queryClient.invalidateQueries({ queryKey: ['report-recent'] })
          queryClient.invalidateQueries({ queryKey: ['report-favorites'] })
          queryClient.invalidateQueries({ queryKey: ['report-catalog'] })
        })
        .catch(() => {
          if (
            activeViewSessionIdRef.current !== viewSessionId
            || requestedViewSessionRef.current !== viewSessionId
          ) return
          if (attempt < 2) {
            window.setTimeout(() => createSession(attempt + 1), (attempt + 1) * 1000)
          } else {
            requestedViewSessionRef.current = null
          }
        })
    }
    createSession(0)
  }, [queryClient, reportDbId, validId, viewSessionId])

  const statusQuery = useQuery({
    queryKey: ['live-refresh', reportDbId],
    queryFn: ({ signal }) => reportsApi.liveRefreshStatus(reportDbId, signal),
    enabled: validId,
    refetchInterval: (q) => ((q.state.data as { in_progress?: boolean } | undefined)?.in_progress ? LIVE_POLL_ACTIVE_MS : LIVE_POLL_IDLE_MS),
    staleTime: 5_000,
  })

  // 조회 체류 시간(근사치): 실제 rendered 후 받은 viewLogId 기준으로 "보이는 시간"만
  // 누적한다. 매 전송은 구간 delta가 아니라 세션 누적 절대값이며 서버가 max로 병합한다.
  useEffect(() => {
    if (viewLogId == null) return
    const logId = viewLogId
    let visibleSinceMs: number | null = document.visibilityState === 'visible' ? Date.now() : null
    let accumulatedSec = 0
    let acknowledgedSec = 0

    function flush(stopTracking: boolean) {
      if (visibleSinceMs != null) {
        accumulatedSec += (Date.now() - visibleSinceMs) / 1000
      }
      visibleSinceMs = !stopTracking && document.visibilityState === 'visible'
        ? Date.now()
        : null

      const absoluteSec = Math.min(86_400, Math.floor(accumulatedSec))
      if (absoluteSec < 1 || absoluteSec <= acknowledgedSec) return
      reportsApi.reportViewDuration(reportDbId, logId, absoluteSec)
        .then(() => {
          acknowledgedSec = Math.max(acknowledgedSec, absoluteSec)
        })
        .catch(() => { /* 다음 체크포인트/정리 시 동일 절대값으로 안전하게 재시도 */ })
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        flush(true)
      } else if (visibleSinceMs == null) {
        visibleSinceMs = Date.now()
      }
    }
    function onPageHide() {
      flush(true)
    }

    // 장시간 열린 탭도 마지막 이탈 이벤트에만 의존하지 않도록 주기적으로 체크포인트한다.
    const checkpoint = window.setInterval(() => flush(false), 30_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.clearInterval(checkpoint)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      flush(true)
    }
  }, [reportDbId, viewLogId])

  // 새로고침 실패 알림: 진행 중(true) → 종료(false) 전환 시 실패 상태면 토스트
  const [refreshFailed, setRefreshFailed] = useState<string | null>(null)
  // 데이터 반영 안내: 사용자가 이미 반영/닫은 end_time (재노출 방지)
  const [appliedEndTime, setAppliedEndTime] = useState<string | null>(null)
  // renderedAt은 실제 Power BI rendered 이벤트에서 설정한다.
  const prevInProgress = useRef(false)
  useEffect(() => {
    const ip = !!statusQuery.data?.in_progress
    let showTimer: number | undefined
    let clearTimer: number | undefined
    if (prevInProgress.current && !ip) {
      const st = statusQuery.data?.status ?? ''
      if (REFRESH_TERMINAL_FAIL.includes(st)) {
        showTimer = window.setTimeout(() => setRefreshFailed(`새로고침 실패 (${st})`), 0)
        clearTimer = window.setTimeout(() => setRefreshFailed(null), 8000)
      }
    }
    prevInProgress.current = ip
    return () => {
      if (showTimer !== undefined) window.clearTimeout(showTimer)
      if (clearTimer !== undefined) window.clearTimeout(clearTimer)
    }
  }, [statusQuery.data])

  const addTask = useTaskStore((s) => s.addTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const markCancelling = useTaskStore((s) => s.markCancelling)
  const tasks = useTaskStore((s) => s.tasks)

  // 임베드된 Report 인스턴스 (보기 옵션 제어용)
  const reportRef = useRef<Report | null>(null)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [schedOpen, setSchedOpen] = useState(false)
  // 레포트 페이지 목록 + 현재 페이지 (하단 탭 대신 헤더 드롭다운으로 전환)
  const [pages, setPages] = useState<{ name: string; displayName: string }[]>([])
  const [activePageName, setActivePageName] = useState('')

  // 전체 화면 종료 시 앱 기본 보기(페이지 맞춤)로 복귀한다.
  // (전체 화면 중에도 기본값과 동일하게 페이지 맞춤을 쓰므로, 사용자가 보기 옵션에서
  // '실제 크기'로 바꾼 뒤 전체 화면에 들어갔다 나오는 경우를 위해 명시적으로 되돌린다)
  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) return
      reportRef.current
        ?.updateSettings({
          layoutType: models.LayoutType.Custom,
          customLayout: { displayOption: models.DisplayOption.FitToPage },
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
    if (!r) return
    // 기본 보기를 '페이지 맞춤'으로 확실히 적용 (초기 embedConfig만으론 미적용되는 경우 대비)
    const applyFit = () => {
      r.updateSettings({
        layoutType: models.LayoutType.Custom,
        customLayout: { displayOption: models.DisplayOption.FitToPage },
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
    // 전체 화면은 화면을 꽉 채우도록 '페이지 맞춤'을 강제한다.
    // (사용자가 보기 옵션에서 '실제 크기'로 바꿔 뒀어도, 전체 화면에서는 레포트가
    // 상단에 붙고 하단에 여백이 남는 것을 피하기 위해 페이지 맞춤으로 전환)
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

  // 즐겨찾기 토글. 새로 추가한 경우에는 비차단 폴더 선택 패널을 연다.
  const [folderPromptOpen, setFolderPromptOpen] = useState(false)
  const favoriteMutation = useMutation({
    mutationFn: (wasFavorite: boolean) =>
      wasFavorite
        ? reportsApi.removeFavorite(reportDbId)
        : reportsApi.addFavorite(reportDbId),
    onSuccess: (_data, wasFavorite) => {
      setFolderPromptOpen(!wasFavorite)
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
      queryClient.invalidateQueries({ queryKey: ['report-catalog'] })
      queryClient.invalidateQueries({ queryKey: ['report-favorites'] })
      queryClient.invalidateQueries({ queryKey: ['report-recent'] })
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
        datasetId: report?.dataset_id ?? undefined,
        startedAt: Date.now(),
      })
      queryClient.invalidateQueries({ queryKey: ['live-refresh', reportDbId] })
    },
  })

  const cancelRefreshMutation = useMutation({
    mutationFn: () => {
      if (!report?.dataset_id) {
        throw new Error('이 레포트에는 연결된 데이터셋이 없습니다.')
      }
      return datasetsApi.cancelRefresh(report.dataset_id)
    },
    onMutate: () => {
      for (const task of useTaskStore.getState().tasks) {
        if (task.kind === 'refresh' && task.reportId === reportDbId && task.status === 'pending') {
          markCancelling(task.id, '중지 요청 중…')
        }
      }
    },
    onSuccess: () => {
      for (const task of useTaskStore.getState().tasks) {
        if (task.kind === 'refresh' && task.reportId === reportDbId && task.status === 'cancelling') {
          updateTask(task.id, { message: '중지 처리 중…' })
        }
      }
      queryClient.invalidateQueries({ queryKey: ['live-refresh', reportDbId] })
    },
    onError: (error) => {
      for (const task of useTaskStore.getState().tasks) {
        if (task.kind === 'refresh' && task.reportId === reportDbId && task.status === 'cancelling') {
          updateTask(task.id, { status: 'pending', message: `중지 실패: ${cancelRefreshErrorMessage(error)}` })
        }
      }
    },
  })

  // 다운로드(Export): 포맷별 비동기 Export 요청 → 작업 도크가 진행/완료·자동 다운로드 처리.
  const exportMutation = useMutation({
    mutationFn: (variables: ExportRequestVariables) =>
      reportsApi.startExport(reportDbId, variables.format, variables.options),
    onSuccess: (res, variables) => {
      const reportLabel = report ? reportDisplayName(report) : '레포트'
      const scopeLabel = variables.scopeLabel ? ` · ${variables.scopeLabel}` : ''
      addTask({
        id: `export-${res.export_job_id}`,
        label: `${reportLabel}${scopeLabel} · ${EXPORT_FORMAT_LABEL[variables.format]}`,
        kind: 'export',
        status: 'pending',
        exportJobId: res.export_job_id,
        startedAt: Date.now(),
      })
    },
  })

  /**
   * 현재 화면 상태(슬라이서/필터/페이지 선택)를 북마크 state로 캡처한다.
   * 캡처가 불가능한 레포트는 null을 반환하고, 이 경우 Power BI에 저장된 기본 상태로
   * 내보내진다(안내 문구로 알린다).
   */
  async function captureViewState(allPages: boolean): Promise<string | null> {
    const r = reportRef.current
    if (!r) return null
    try {
      const bookmark = await r.bookmarksManager.capture(
        allPages ? { allPages: true } : undefined,
      )
      return bookmark.state ?? null
    } catch {
      return null
    }
  }

  /** 현재 보고 있는 페이지 1장만 내보낸다(PDF/PPTX/PNG). */
  async function requestCurrentPageExport(format: ExportFormat) {
    setDownloadMenuOpen(false)
    const state = await captureViewState(false)
    if (!state) {
      setViewSaveMsg({ ok: false, text: '현재 화면 설정을 가져오지 못해 저장된 기본 상태로 내보냅니다.' })
      window.setTimeout(() => setViewSaveMsg(null), 5000)
    }
    exportMutation.mutate({
      format,
      scopeLabel: activePageDisplayName || '현재 페이지',
      options: {
        pageName: activePageName || null,
        pageDisplayName: activePageDisplayName || null,
        bookmarkState: state,
      },
    })
  }

  /** 레포트의 보이는 전체 페이지를 화면 순서대로 내보낸다(PNG/PPTX/PDF). */
  async function requestAllPagesExport(format: ExportFormat) {
    setDownloadMenuOpen(false)
    const state = await captureViewState(true)
    if (!state) {
      setViewSaveMsg({ ok: false, text: '현재 화면 설정을 가져오지 못해 저장된 기본 상태로 내보냅니다.' })
      window.setTimeout(() => setViewSaveMsg(null), 5000)
    }
    exportMutation.mutate({
      format,
      scopeLabel: '전체 페이지',
      options: {
        bookmarkState: state,
        pageNames: pages.length > 0 ? pages.map((p) => p.name) : null,
      },
    })
  }

  /** 원본 .pbix 파일 다운로드 (페이지/뷰 상태 개념 없음). */
  function requestPbixExport() {
    setDownloadMenuOpen(false)
    exportMutation.mutate({ format: 'PBIX' })
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

  function cancelRefreshErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.status === 403) return '새로고침을 중지할 권한이 없습니다.'
      if (error.status === 409) {
        return error.errorDescription ?? '이미 종료되었거나 중지할 수 없는 새로고침입니다.'
      }
      return error.errorDescription ?? '새로고침 중지 요청에 실패했습니다.'
    }
    if (error instanceof Error) return error.message
    return '새로고침 중지 요청에 실패했습니다.'
  }

  const title = report ? reportDisplayName(report) : '레포트'
  // 현재 페이지의 사람이 읽는 이름(다운로드 메뉴 표기 + 내보낸 파일명에 사용).
  const activePageDisplayName =
    pages.find((p) => p.name === activePageName)?.displayName ?? ''
  // 데이터셋이 연결되어 있고 새로고침 권한이 있을 때만 버튼을 노출한다(백엔드도 재검증).
  const canRefresh = Boolean(report?.dataset_id) && Boolean(report?.can_refresh)
  const currentRefreshTask = tasks.find(
    (task) => task.kind === 'refresh'
      && task.reportId === reportDbId
      && (task.status === 'pending' || task.status === 'cancelling'),
  )
  // 새로고침 진행 중: 트리거 POST 중 / PBI가 진행중 보고 / 도크 작업 진행·취소 중
  const live = statusQuery.data
  const refreshing = refreshMutation.isPending || !!live?.in_progress || Boolean(currentRefreshTask)
  const cancelling = currentRefreshTask?.status === 'cancelling' || cancelRefreshMutation.isPending
  // 이 버전에서 시작한 enhanced refresh(datasetId가 저장된 task)만 중지 버튼을 노출한다.
  // Power BI 이력에서 실제 진행을 한 번 확인한 뒤 활성화해 enqueue 직후의 레이스를 피한다.
  const canCancelRefresh = Boolean(
    currentRefreshTask?.datasetId
    && currentRefreshTask.status === 'pending'
    && (live?.in_progress || currentRefreshTask.seenRunning),
  )
  // 배지용 상태 (라이브 PBI 기준)
  const badgeStatus: RefreshStatus = live && live.has_history
    ? {
        has_history: true,
        status: live.status ?? 'Unknown',
        last_refresh_local: fmtLocal(live.end_time ?? live.start_time),
      }
    : { has_history: false }

  const publishedLabel = fmtDate(report?.published_at)

  const isFavorite = !!report?.is_favorite

  // 새 데이터 반영 안내: 임베드 렌더 이후 "완료"된 새로고침이 감지되면(end_time이 더 최신),
  // 자동 갱신 대신 배너+버튼으로 사용자가 직접 반영하도록 한다(조작 방해 최소화).
  const newDataEndTime = live?.status === 'Completed' ? (live.end_time ?? null) : null
  const newDataAvailable = Boolean(
    newDataEndTime
    && !refreshing
    && renderedAt != null
    && new Date(newDataEndTime).getTime() > renderedAt
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
    <div className="editorial-report-view flex h-full flex-col bg-slate-50">
      {/* 헤더 */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => navigate('/reports')}
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
              onClick={() => favoriteMutation.mutate(isFavorite)}
              className="shrink-0 rounded-full p-1 transition hover:bg-slate-100 disabled:opacity-50"
            >
              <Star className={`h-5 w-5 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <span>작성자: {report?.author_label || '-'}</span>
            <span className="text-slate-300">·</span>
            <span>게시일: {publishedLabel ?? '-'}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
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
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[14.5px] leading-[20px] text-slate-600 transition hover:bg-slate-50"
              >
                <Clock className="h-3 w-3 text-slate-400" />
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
                  <div role="dialog" aria-label="예약 새로고침" className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-2 text-[14.5px] leading-[20px] shadow-lg">
                    <p className="mb-1 font-semibold text-slate-700">예약 새로고침</p>
                    <p className="text-slate-500">
                      요일: <span className="text-slate-700">{live.schedule.days.map(weekdayKo).join(', ') || '-'}</span>
                    </p>
                    <p className="text-slate-500">
                      시간: <span className="text-slate-700">{live.schedule.times.join(', ') || '-'}</span>
                    </p>
                    <p className="mt-1 border-t border-slate-100 pt-1 text-slate-500">
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
              className="max-w-[11rem] rounded-md border border-slate-300 px-2 py-0.5 text-[14.5px] font-medium leading-[20px] text-slate-700 transition hover:bg-slate-50"
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
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-0.5 text-[14.5px] font-medium leading-[20px] text-slate-700 transition hover:bg-slate-50"
            >
              <Monitor className="h-3 w-3" />
              보기 옵션
              <ChevronDown className="h-2.5 w-2.5" />
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
                <div role="menu" className="absolute right-0 z-20 mt-1 w-[12.5rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg">
                  <button type="button" role="menuitem" onClick={applyFullscreen}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">
                    <Maximize2 className="h-3 w-3 text-slate-500" /> 전체 화면
                  </button>
                  <button type="button" role="menuitem" onClick={() => applyDisplayOption(models.DisplayOption.FitToPage)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">
                    <Monitor className="h-3 w-3 text-slate-500" /> 페이지 맞춤
                  </button>
                  <button type="button" role="menuitem" onClick={() => applyDisplayOption(models.DisplayOption.ActualSize)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">
                    <ScanLine className="h-3 w-3 text-slate-500" /> 실제 크기
                  </button>
                  {report?.can_manage_default_view && (
                    <>
                      <div className="my-0.5 border-t border-slate-100" />
                      <button type="button" role="menuitem" onClick={saveCurrentAsDefault} disabled={defaultViewMutation.isPending}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        <Save className="h-3 w-3 text-slate-500" /> 현재 뷰를 기본값으로 저장
                      </button>
                      <button type="button" role="menuitem" onClick={clearDefaultView} disabled={defaultViewMutation.isPending}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                        <RotateCcw className="h-3 w-3 text-slate-400" /> 기본 뷰 초기화
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 다운로드 드롭다운 (내보내기 또는 원본 다운로드 권한자에게만 노출) */}
          {(report?.can_download || report?.can_download_pbix) && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDownloadMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={downloadMenuOpen}
                disabled={exportMutation.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-0.5 text-[14.5px] font-medium leading-[20px] text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                다운로드
                <ChevronDown className="h-2.5 w-2.5" />
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
                  <div role="menu" className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-0.5 shadow-lg">
                    {report?.can_download && (
                      <>
                        <p className="truncate px-2 py-0.5 text-[10.5px] font-medium text-slate-400">
                          현재 페이지{activePageDisplayName ? ` · ${activePageDisplayName}` : ''}
                        </p>
                        <button type="button" role="menuitem" onClick={() => requestCurrentPageExport('PNG')}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">이미지 (PNG)</button>
                        <button type="button" role="menuitem" onClick={() => requestCurrentPageExport('PPTX')}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">PowerPoint (PPTX)</button>
                        <button type="button" role="menuitem" onClick={() => requestCurrentPageExport('PDF')}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">PDF</button>
                        <div className="my-0.5 border-t border-slate-100" />
                        <div className="flex items-center justify-between gap-2 px-2 py-0.5">
                          <p className="text-[10.5px] font-medium text-slate-400">전체 페이지</p>
                          <p className="whitespace-nowrap text-[10.5px] text-slate-400">페이지 수에 따라 시간이 걸립니다</p>
                        </div>
                        <button type="button" role="menuitem" onClick={() => requestAllPagesExport('PNG')}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">이미지 (PNG · ZIP)</button>
                        <button type="button" role="menuitem" onClick={() => requestAllPagesExport('PPTX')}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">PowerPoint (PPTX)</button>
                        <button type="button" role="menuitem" onClick={() => requestAllPagesExport('PDF')}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">PDF</button>
                      </>
                    )}
                    {report?.can_download_pbix && (
                      <>
                        {report?.can_download && <div className="my-0.5 border-t border-slate-100" />}
                        <p className="px-2 py-0.5 text-[10.5px] font-medium text-slate-400">원본 파일</p>
                        <button type="button" role="menuitem" onClick={requestPbixExport}
                          className="flex w-full items-center px-2 py-1 text-left text-[14.5px] leading-[20px] text-slate-700 hover:bg-slate-50">Power BI 원본 (.pbix)</button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {report?.can_manage && (
            <button
              type="button"
              onClick={() => { setReplaceFile(null); replaceMutation.reset(); setReplaceOpen(true) }}
              className="inline-flex items-center gap-1 rounded-md border border-blue-600 px-2 py-0.5 text-[14.5px] font-medium leading-[20px] text-blue-600 transition hover:bg-blue-50"
            >
              <Upload className="h-3 w-3" />
              레포트 업데이트(교체)
            </button>
          )}
          {canRefresh && (
            <>
              <button
                type="button"
                onClick={() => {
                  cancelRefreshMutation.reset()
                  refreshMutation.mutate()
                }}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? '새로고침 중…' : '새로고침'}
              </button>
              {currentRefreshTask?.datasetId && (
                <button
                  type="button"
                  aria-label="새로고침 중지"
                  onClick={() => cancelRefreshMutation.mutate()}
                  disabled={!canCancelRefresh || cancelling}
                  title={canCancelRefresh ? '진행 중인 새로고침 중지' : 'Power BI에서 시작 상태를 확인하는 중입니다.'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {cancelling ? '중지 중…' : '중지'}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* 새로고침 요청 결과 알림 */}
      {refreshMutation.isError && (
        <div role="alert" className="bg-red-50 px-5 py-2 text-sm text-red-600">
          {refreshErrorMessage(refreshMutation.error)}
        </div>
      )}
      {refreshMutation.isSuccess && !cancelRefreshMutation.isSuccess && (
        <div className="bg-green-50 px-5 py-2 text-sm text-green-700">
          새로고침을 요청했습니다. 잠시 후 상태가 갱신됩니다.
        </div>
      )}
      {cancelRefreshMutation.isError && (
        <div role="alert" className="bg-red-50 px-5 py-2 text-sm text-red-600">
          {cancelRefreshErrorMessage(cancelRefreshMutation.error)}
        </div>
      )}
      {cancelRefreshMutation.isSuccess && refreshing && (
        <div role="status" className="bg-amber-50 px-5 py-2 text-sm text-amber-700">
          새로고침 중지를 요청했습니다. Power BI에서 작업을 종료하고 있습니다.
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
            <PowerBIEmbed
              embed={embedQuery.data}
              onReport={handleReport}
              onRendered={handleRendered}
            />
          </div>
        ) : null}
      </main>

      {/* 레포트 업데이트(교체) 모달 */}
      {replaceOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="레포트 업데이트(교체)" className="my-24 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">레포트 업데이트(교체)</h3>
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

      {report && folderPromptOpen && (
        <FavoriteFolderPrompt
          open
          reportId={reportDbId}
          reportName={reportDisplayName(report)}
          onClose={() => setFolderPromptOpen(false)}
        />
      )}
    </div>
  )
}
