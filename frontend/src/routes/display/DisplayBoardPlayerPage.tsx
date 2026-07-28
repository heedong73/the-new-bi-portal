/**
 * KPI 전광판 플레이어 — 전체화면 자동 순환 재생 (`/display/:boardId/play`).
 *
 * 구성한 플레이리스트를 화면별 노출 시간에 따라 순환 표시한다. 로비/상황실 모니터에
 * 며칠씩 띄워 두는 것을 전제로 다음 안정성 장치를 갖는다.
 *
 *  1) 노출 시간은 "렌더 완료" 시점부터 센다. 로딩 시간이 노출 시간을 잡아먹지 않는다.
 *  2) Embed Token은 레포트 단위로 캐시하고 만료 전에 선제 재발급한다. 현재 화면은
 *     다시 임베드하지 않고 setAccessToken으로 토큰만 갈아끼워 깜빡임을 없앤다.
 *  3) 렌더 실패/토큰 오류는 재시도 후 해당 화면을 일정 시간 건너뛴다. 한 레포트가
 *     죽어도 전광판 전체가 멈추지 않는다.
 *  4) 네트워크가 끊기면 지수 백오프로 계속 재시도하고, 화면에는 재연결 상태만 알린다.
 *  5) 구성(순서·노출 시간)은 주기적으로 다시 조회해 재시작 없이 반영된다.
 *  6) 화면이 하나뿐이면 순환 대신 데이터를 새로 고쳐 값이 굳지 않게 한다.
 *  7) Wake Lock으로 모니터 절전을 막는다(지원 환경에서만).
 *
 * 같은 레포트의 다른 페이지로 넘어갈 때는 다시 임베드하지 않고 setPage만 호출한다
 * (재임베드는 수 초가 걸리고 화면이 깜빡인다).
 *
 * 렌더 성능: 진행률 표시를 위해 0.5초마다 갱신되므로, 화면에 필요한 값은 타이머
 * 콜백에서 하나의 tick 상태로 모아 넣고 임베드 컴포넌트는 memo로 고정한다.
 *
 * 조작 UI는 기본적으로 숨어 있고 마우스/키 입력이 있을 때만 나타난다.
 * 키보드: Space 일시정지, ←/→ 이동, F 전체화면, Esc 종료.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Report } from 'powerbi-client'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Loader2, LogOut, Maximize2, Minimize2,
  Pause, Play, WifiOff,
} from 'lucide-react'

import { displayBoardsApi } from '@/api/displayApi'
import { ApiError } from '@/api/client'
import DisplayBoardEmbed from '@/components/embed/DisplayBoardEmbed'
import { useDisplayEmbedTokens } from '@/hooks/useDisplayEmbedTokens'
import { useWakeLock } from '@/hooks/useWakeLock'
import {
  formatDwell, slideLabel, type DisplayBoardEmbed as DisplayBoardEmbedInfo,
  type DisplayBoardSlide,
} from '@/types/display'

/** 구성 변경 반영 주기(ms). 재시작 없이 순서·노출 시간 변경을 가져온다. */
const BOARD_REFETCH_MS = 5 * 60_000
/** 순환 판단 주기(ms). */
const TICK_MS = 500
/** 렌더 완료를 기다리는 한계(ms). 초과하면 해당 화면을 건너뛴다. */
const LOAD_TIMEOUT_MS = 30_000
/** 토큰 만료 점검 주기(ms). */
const TOKEN_CHECK_MS = 60_000
/** 렌더 실패한 화면을 다시 시도하기까지 건너뛰는 시간(ms). */
const SLIDE_COOLDOWN_MS = 5 * 60_000
/** 같은 화면에서 재시도할 최대 횟수. 초과하면 쿨다운 후 재시도. */
const MAX_SLIDE_RETRY = 2
/** 조작 UI 자동 숨김 지연(ms). */
const CONTROLS_HIDE_MS = 4_000

/** 화면 표시에 필요한 시간 정보. 타이머 콜백에서 한 번에 갱신한다. */
interface PlayerTick {
  nowMs: number
  /** 현재 화면의 렌더 완료 시각(ms). null이면 아직 로딩 중. */
  readyAt: number | null
}

/** 슬라이드 구성이 실제로 바뀌었는지 판단하기 위한 키. */
function slidesSignature(slides: DisplayBoardSlide[]): string {
  return slides
    .map((s) => `${s.id}:${s.report_id}:${s.page_name ?? ''}:${s.effective_dwell_seconds}`)
    .join('|')
}

/** 임베드 오류가 토큰 문제인지 추정한다. */
function isTokenProblem(detail: unknown): boolean {
  let text: string
  if (typeof detail === 'string') {
    text = detail
  } else {
    try {
      text = JSON.stringify(detail ?? '')
    } catch {
      text = ''
    }
  }
  return /token|unauthor|401|403/i.test(text)
}

export default function DisplayBoardPlayerPage() {
  const navigate = useNavigate()
  const params = useParams<{ boardId: string }>()
  const boardId = Number(params.boardId)
  const validId = Number.isFinite(boardId) && boardId > 0

  const boardQuery = useQuery({
    queryKey: ['display-board', boardId],
    queryFn: ({ signal }) => displayBoardsApi.get(boardId, signal),
    enabled: validId,
    staleTime: 60_000,
    refetchInterval: BOARD_REFETCH_MS,
    refetchIntervalInBackground: true,
    retry: 5,
  })

  const board = boardQuery.data
  const slides = useMemo(() => board?.slides ?? [], [board])
  const signature = useMemo(() => slidesSignature(slides), [slides])

  const { ensureToken, invalidate, isExpiring, lastError, failureCount } =
    useDisplayEmbedTokens(boardId)

  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [activeReportId, setActiveReportId] = useState<number | null>(null)
  /** 실제로 임베드에 넘기는 값. 토큰만 조용히 교체할 때는 갱신하지 않는다. */
  const [renderEmbed, setRenderEmbed] = useState<DisplayBoardEmbedInfo | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [tick, setTick] = useState<PlayerTick>(() => ({ nowMs: Date.now(), readyAt: null }))
  const [controlsVisible, setControlsVisible] = useState(true)
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now())
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const [skippedNotice, setSkippedNotice] = useState<string | null>(null)

  // 슬라이드 삭제로 목록이 짧아져도 범위를 벗어나지 않게 파생값으로 보정한다.
  const safeIndex = slides.length === 0 ? 0 : Math.min(index, slides.length - 1)
  const currentSlide: DisplayBoardSlide | undefined = slides[safeIndex]
  const dwellMs = (currentSlide?.effective_dwell_seconds ?? 30) * 1000

  // 순환 판단은 0.5초 주기로 돌기 때문에 상태 대신 ref로 최신 값을 읽는다.
  const slidesRef = useRef<DisplayBoardSlide[]>(slides)
  const indexRef = useRef(0)
  const pausedRef = useRef(false)
  const enteredAtRef = useRef(0)
  const readyAtRef = useRef<number | null>(null)
  const reportRef = useRef<Report | null>(null)
  /** 현재 임베드 대상 레포트 id (state 미러). */
  const activeReportIdRef = useRef<number | null>(null)
  /** 현재 임베드가 loaded까지 끝났는지. setPage 가능 여부 판단에 쓴다. */
  const reportLoadedRef = useRef(false)
  const retryCountRef = useRef<Map<number, number>>(new Map())
  const cooldownRef = useRef<Map<number, number>>(new Map())
  const refetchBoardRef = useRef(boardQuery.refetch)

  useEffect(() => { slidesRef.current = slides }, [slides])
  useEffect(() => { indexRef.current = safeIndex }, [safeIndex])
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { activeReportIdRef.current = activeReportId }, [activeReportId])
  useEffect(() => { refetchBoardRef.current = boardQuery.refetch }, [boardQuery.refetch])

  useWakeLock(!paused)

  /** 슬라이드 진입 상태를 초기화한다(노출 시간 계산 기준 재설정). */
  const resetSlideTiming = useCallback(() => {
    enteredAtRef.current = Date.now()
    readyAtRef.current = null
  }, [])

  const goToIndex = useCallback((next: number) => {
    indexRef.current = next
    resetSlideTiming()
    setIndex(next)
  }, [resetSlideTiming])

  /** 임베드를 처음부터 다시 붙인다(토큰 교체 실패·렌더 오류 복구용). */
  const forceReembed = useCallback((token?: string) => {
    reportLoadedRef.current = false
    if (token) {
      setRenderEmbed((prev) => (prev ? { ...prev, embedToken: token } : prev))
    }
    setReloadNonce((n) => n + 1)
  }, [])

  /** 쿨다운 중인 화면을 건너뛰며 이동한다. 전부 쿨다운이면 쿨다운을 풀고 재시도한다. */
  const advance = useCallback((step: 1 | -1) => {
    const list = slidesRef.current
    const total = list.length
    if (total === 0) return
    let candidate = indexRef.current
    for (let i = 0; i < total; i += 1) {
      candidate = (candidate + step + total) % total
      const slide = list[candidate]
      const until = cooldownRef.current.get(slide.id) ?? 0
      if (until <= Date.now()) {
        goToIndex(candidate)
        return
      }
    }
    // 모든 화면이 실패 상태 — 쿨다운을 초기화하고 계속 재시도한다(무인 복구).
    cooldownRef.current.clear()
    retryCountRef.current.clear()
    goToIndex((indexRef.current + step + total) % total)
  }, [goToIndex])

  /** 렌더 실패한 화면을 일정 시간 건너뛰도록 표시한다. */
  const markSlideFailed = useCallback((slide: DisplayBoardSlide, reason: string) => {
    cooldownRef.current.set(slide.id, Date.now() + SLIDE_COOLDOWN_MS)
    retryCountRef.current.delete(slide.id)
    setSkippedNotice(`${slideLabel(slide)} · ${reason}`)
  }, [])

  // 안내 문구는 10초 후 스스로 사라진다.
  useEffect(() => {
    if (!skippedNotice) return
    const id = window.setTimeout(() => setSkippedNotice(null), 10_000)
    return () => window.clearTimeout(id)
  }, [skippedNotice])

  // 슬라이드 전환 — 같은 레포트면 페이지만 바꾸고, 다르면 새 토큰으로 다시 임베드한다.
  useEffect(() => {
    const slide = slidesRef.current[safeIndex]
    if (!slide) return
    let cancelled = false
    resetSlideTiming()

    if (activeReportIdRef.current === slide.report_id && reportLoadedRef.current) {
      const report = reportRef.current
      void (async () => {
        try {
          if (slide.page_name && report) await report.setPage(slide.page_name)
          // rendered 이벤트가 오지 않는 구성에서도 멈추지 않도록 기준 시각을 채운다.
          if (!cancelled && readyAtRef.current == null) readyAtRef.current = Date.now()
        } catch {
          // 페이지 전환 실패는 렌더 타임아웃/에러 이벤트 경로가 처리한다.
        }
      })()
      return () => { cancelled = true }
    }

    void (async () => {
      try {
        const embed = await ensureToken(slide.report_id)
        if (cancelled) return
        reportLoadedRef.current = false
        setRenderEmbed(embed)
        setActiveReportId(slide.report_id)
      } catch (error) {
        if (cancelled) return
        const status = error instanceof ApiError ? error.status : 0
        markSlideFailed(
          slide,
          status === 403 || status === 404 ? '표시 권한이 없습니다' : '불러오지 못했습니다',
        )
        if (slidesRef.current.length > 1) advance(1)
      }
    })()
    return () => { cancelled = true }
  }, [safeIndex, signature, advance, ensureToken, markSlideFailed, resetSlideTiming])

  // 순환 타이머 — 단일 인터벌로 진행률 갱신과 다음 화면 판단을 함께 처리한다.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick({ nowMs: Date.now(), readyAt: readyAtRef.current })
      if (pausedRef.current) return
      const list = slidesRef.current
      const slide = list[indexRef.current]
      if (!slide) return
      const now = Date.now()

      if (readyAtRef.current == null) {
        if (now - enteredAtRef.current > LOAD_TIMEOUT_MS) {
          markSlideFailed(slide, '표시 시간이 초과되었습니다')
          if (list.length > 1) advance(1)
          else resetSlideTiming()
        }
        return
      }

      if (now - readyAtRef.current < slide.effective_dwell_seconds * 1000) return

      if (list.length > 1) {
        advance(1)
        return
      }
      // 화면이 하나면 순환 대신 데이터를 새로 고쳐 값이 굳지 않게 한다.
      try {
        void reportRef.current?.refresh()
      } catch {
        /* 새로고침을 지원하지 않는 레포트는 그대로 유지 */
      }
      readyAtRef.current = Date.now()
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [advance, markSlideFailed, resetSlideTiming])

  // 토큰 만료 점검 + 다음 화면 토큰 선반입.
  useEffect(() => {
    const id = window.setInterval(() => {
      const list = slidesRef.current
      const slide = list[indexRef.current]
      if (!slide) return

      if (isExpiring(slide.report_id)) {
        void (async () => {
          try {
            const embed = await ensureToken(slide.report_id, true)
            const report = reportRef.current
            if (!report) {
              forceReembed(embed.embedToken)
              return
            }
            try {
              // 화면 깜빡임 없이 토큰만 교체한다.
              await report.setAccessToken(embed.embedToken)
            } catch {
              forceReembed(embed.embedToken)
            }
          } catch {
            /* ensureToken이 백오프로 계속 재시도한다 */
          }
        })()
      }

      if (list.length > 1) {
        const next = list[(indexRef.current + 1) % list.length]
        if (next && next.report_id !== slide.report_id && isExpiring(next.report_id)) {
          void ensureToken(next.report_id).catch(() => { /* 다음 주기에 재시도 */ })
        }
      }
    }, TOKEN_CHECK_MS)
    return () => window.clearInterval(id)
  }, [ensureToken, forceReembed, isExpiring])

  // 탭이 다시 보이면 노출 시간을 처음부터 센다(백그라운드 동안 타이머가 지연되어
  // 복귀 직후 곧바로 넘어가 버리는 것을 막는다) + 구성을 다시 확인한다.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (readyAtRef.current != null) readyAtRef.current = Date.now()
      else resetSlideTiming()
      void refetchBoardRef.current()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [resetSlideTiming])

  const handleReport = useCallback((report: Report | null) => {
    reportRef.current = report
  }, [])

  const handleLoaded = useCallback(() => {
    reportLoadedRef.current = true
    const slide = slidesRef.current[indexRef.current]
    const report = reportRef.current
    if (!slide || !report || !slide.page_name) return
    report.setPage(slide.page_name).catch(() => { /* rendered/에러 경로에서 처리 */ })
  }, [])

  const handleRendered = useCallback(() => {
    reportLoadedRef.current = true
    const slide = slidesRef.current[indexRef.current]
    if (slide) retryCountRef.current.delete(slide.id)
    // 데이터 자동 갱신 등으로 rendered가 반복될 수 있어 첫 완료만 기준으로 삼는다.
    if (readyAtRef.current == null) {
      readyAtRef.current = Date.now()
      setTick({ nowMs: Date.now(), readyAt: readyAtRef.current })
    }
  }, [])

  const handleEmbedError = useCallback((detail: unknown) => {
    const slide = slidesRef.current[indexRef.current]
    if (!slide) return

    if (isTokenProblem(detail)) {
      invalidate(slide.report_id)
      void ensureToken(slide.report_id, true)
        .then((embed) => forceReembed(embed.embedToken))
        .catch(() => markSlideFailed(slide, '표시 권한을 확인해 주세요'))
      return
    }

    const attempts = (retryCountRef.current.get(slide.id) ?? 0) + 1
    retryCountRef.current.set(slide.id, attempts)
    if (attempts > MAX_SLIDE_RETRY) {
      markSlideFailed(slide, '레포트를 표시할 수 없습니다')
      if (slidesRef.current.length > 1) advance(1)
      return
    }
    resetSlideTiming()
    forceReembed()
  }, [advance, ensureToken, forceReembed, invalidate, markSlideFailed, resetSlideTiming])

  // 조작 UI 자동 숨김 — 입력이 있을 때만 타이머를 다시 시작한다.
  const showControls = useCallback(() => {
    setControlsVisible(true)
    setLastInteractionAt(Date.now())
  }, [])
  useEffect(() => {
    if (!controlsVisible) return
    const id = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS)
    return () => window.clearTimeout(id)
  }, [controlsVisible, lastInteractionAt])

  // 전체화면 상태 동기화
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* noop */ })
    } else {
      document.documentElement.requestFullscreen().catch(() => { /* noop */ })
    }
  }, [])

  const exitPlayer = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { /* noop */ })
    }
    navigate('/display')
  }, [navigate])

  // 키보드 조작
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      showControls()
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        setPaused((p) => !p)
        return
      }
      if (event.key === 'ArrowRight') { advance(1); return }
      if (event.key === 'ArrowLeft') { advance(-1); return }
      if (event.key.toLowerCase() === 'f') { toggleFullscreen(); return }
      if (event.key === 'Escape' && !document.fullscreenElement) exitPlayer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [advance, exitPlayer, showControls, toggleFullscreen])

  const elapsedMs = tick.readyAt == null ? 0 : Math.max(0, tick.nowMs - tick.readyAt)
  const progress = dwellMs > 0 ? Math.min(1, elapsedMs / dwellMs) : 0
  const remainingSec = Math.max(0, Math.ceil((dwellMs - elapsedMs) / 1000))
  const reconnecting = failureCount > 0

  if (!validId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-200">
        <p role="alert">잘못된 전광판 경로입니다.</p>
      </div>
    )
  }

  if (boardQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 bg-slate-950 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin" />
        전광판을 준비하는 중…
      </div>
    )
  }

  if (boardQuery.isError) {
    const status = boardQuery.error instanceof ApiError ? boardQuery.error.status : null
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-slate-200">
        <AlertTriangle className="h-7 w-7 text-amber-400" />
        <p role="alert">
          {status === 403
            ? 'KPI 전광판 사용 권한이 없습니다.'
            : status === 404
              ? '전광판을 찾을 수 없거나 재생이 중지되었습니다.'
              : '전광판을 불러오지 못했습니다.'}
        </p>
        <button
          type="button"
          onClick={exitPlayer}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          목록으로
        </button>
      </div>
    )
  }

  if (slides.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-slate-200">
        <AlertTriangle className="h-7 w-7 text-amber-400" />
        <p>표시할 수 있는 화면이 없습니다. 전광판 구성과 레포트 조회 권한을 확인해 주세요.</p>
        <button
          type="button"
          onClick={exitPlayer}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          목록으로
        </button>
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 z-40 flex flex-col bg-slate-950 ${
        controlsVisible ? '' : 'cursor-none'
      }`}
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      {/* 임베드 본문 */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {renderEmbed ? (
          <DisplayBoardEmbed
            key={`${activeReportId}-${reloadNonce}`}
            embed={renderEmbed}
            onReport={handleReport}
            onLoaded={handleLoaded}
            onRendered={handleRendered}
            onError={handleEmbedError}
          />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            화면을 불러오는 중…
          </div>
        )}

        {renderEmbed && tick.readyAt == null && (
          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            불러오는 중…
          </div>
        )}

        {reconnecting && (
          <div
            role="status"
            className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full bg-amber-500/90 px-3 py-1.5 text-xs font-medium text-amber-950"
          >
            <WifiOff className="h-3.5 w-3.5" />
            재연결 중… ({failureCount}회 실패)
            {lastError ? ` · ${lastError}` : ''}
          </div>
        )}

        {skippedNotice && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-lg bg-slate-900/85 px-3 py-2 text-xs text-amber-200"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {skippedNotice} — 건너뜁니다
          </div>
        )}
      </div>

      {/* 진행 바 */}
      <div className="h-1 w-full bg-slate-800">
        <div
          className="h-full bg-blue-500 transition-[width] duration-500 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* 조작 UI — 입력이 있을 때만 표시 */}
      <div
        className={`flex items-center gap-3 border-t border-slate-800 bg-slate-900/95 px-5 py-2.5 text-slate-200 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{board?.name}</span>
          <span className="truncate text-xs text-slate-400">
            {currentSlide ? slideLabel(currentSlide) : '-'}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 whitespace-nowrap text-xs text-slate-400">
            {safeIndex + 1} / {slides.length} · {paused ? '일시정지' : `${remainingSec}초 후 전환`}
          </span>
          <button
            type="button"
            aria-label="이전 화면"
            onClick={() => advance(-1)}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={paused ? '재생' : '일시정지'}
            onClick={() => setPaused((p) => !p)}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="다음 화면"
            onClick={() => advance(1)}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? '전체화면 종료' : '전체화면'}
            onClick={toggleFullscreen}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={exitPlayer}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
          >
            <LogOut className="h-3.5 w-3.5" />
            종료
          </button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {currentSlide
          ? `${slideLabel(currentSlide)} 표시 중, 노출 시간 ${formatDwell(currentSlide.effective_dwell_seconds)}`
          : ''}
      </p>
    </div>
  )
}
