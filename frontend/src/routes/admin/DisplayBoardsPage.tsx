/**
 * KPI 전광판 관리 (System_Operator).
 *
 * 왼쪽에서 전광판(플레이리스트)을 선택/생성하고, 오른쪽에서 해당 전광판의 기본 설정과
 * 슬라이드(레포트·페이지·노출 시간·순서)를 편집한다.
 *
 * 설계 메모
 *  - 노출 시간은 슬라이드별로 비워 두면 전광판 기본값을 따른다. 기본값만 바꿔 전체
 *    순환 속도를 한 번에 조정할 수 있는 구조라, 표에서도 '기본값' 상태를 구분해 보여준다.
 *  - 권한이 없는 레포트가 슬라이드에 남아 있으면(레포트 권한 회수 등) 경고를 표시한다.
 *    실제 재생 시에는 백엔드가 해당 슬라이드를 제외한다.
 *  - 선택 상태는 별도 effect로 동기화하지 않고 파생값으로 계산한다. 폼 초기화는 렌더
 *    중 이전 키 비교(React 권장 파생 상태 초기화 패턴)로 처리한다.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowDown, ArrowUp, Eye, EyeOff, Monitor, Play, Plus, Save, Trash2,
} from 'lucide-react'

import { displayBoardsApi } from '@/api/displayApi'
import { mailSchedulesApi } from '@/api/mailApi'
import { reportsApi } from '@/api/portalApi'
import { useToastStore } from '@/stores/useToastStore'
import {
  DEFAULT_DWELL_SECONDS, MAX_DWELL_SECONDS, MIN_DWELL_SECONDS,
  formatDwell, type DisplayBoard,
} from '@/types/display'
import { reportDisplayName } from '@/types/report'

const MANAGE_QUERY_KEY = ['display-boards', 'manage'] as const

/** API 오류에서 사용자에게 보여줄 메시지 추출. */
function errorText(error: unknown, fallback: string): string {
  const description = (error as { errorDescription?: string })?.errorDescription
  if (description) return description
  return error instanceof Error ? error.message : fallback
}

export default function DisplayBoardsPage() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((state) => state.addToast)

  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null)
  const [newBoardName, setNewBoardName] = useState('')

  // 전광판 기본 설정 편집 폼
  const [boardForm, setBoardForm] = useState({
    name: '',
    description: '',
    dwell: DEFAULT_DWELL_SECONDS,
  })

  // 슬라이드 추가 폼
  const [newSlideReportId, setNewSlideReportId] = useState<number | ''>('')
  const [newSlidePageName, setNewSlidePageName] = useState('')
  const [newSlideDwell, setNewSlideDwell] = useState('')

  // 슬라이드별 노출 시간 입력 초안 (빈 문자열 = 보드 기본값 사용)
  const [dwellDraft, setDwellDraft] = useState<Record<number, string>>({})

  const boardsQuery = useQuery({
    queryKey: MANAGE_QUERY_KEY,
    queryFn: ({ signal }) => displayBoardsApi.listForManage(signal),
    staleTime: 15_000,
  })
  const boards = useMemo(() => boardsQuery.data ?? [], [boardsQuery.data])

  const reportsQuery = useQuery({
    queryKey: ['reports', null],
    queryFn: ({ signal }) => reportsApi.list(null, signal),
    staleTime: 60_000,
  })
  const reports = useMemo(
    () => [...(reportsQuery.data ?? [])].sort(
      (a, b) => reportDisplayName(a).localeCompare(reportDisplayName(b), 'ko'),
    ),
    [reportsQuery.data],
  )

  // 사용자가 고른 값이 우선이고, 없거나 삭제된 경우 첫 전광판으로 파생시킨다.
  const selectedBoard: DisplayBoard | undefined = useMemo(() => {
    if (boards.length === 0) return undefined
    return boards.find((b) => b.id === selectedBoardId) ?? boards[0]
  }, [boards, selectedBoardId])

  /** 실제 편집 대상 전광판 id (명시 선택이 없으면 목록의 첫 항목). */
  const activeBoardId = selectedBoard?.id ?? null

  // 선택/서버 값이 바뀌면 편집 폼과 초안을 다시 맞춘다.
  const boardSyncKey = selectedBoard
    ? `${selectedBoard.id}|${selectedBoard.updated_at ?? ''}`
    : ''
  const [prevBoardSyncKey, setPrevBoardSyncKey] = useState(boardSyncKey)
  if (boardSyncKey !== prevBoardSyncKey) {
    setPrevBoardSyncKey(boardSyncKey)
    setBoardForm({
      name: selectedBoard?.name ?? '',
      description: selectedBoard?.description ?? '',
      dwell: selectedBoard?.default_dwell_seconds ?? DEFAULT_DWELL_SECONDS,
    })
    setDwellDraft(
      Object.fromEntries(
        (selectedBoard?.slides ?? []).map(
          (s) => [s.id, s.dwell_seconds == null ? '' : String(s.dwell_seconds)],
        ),
      ),
    )
    setNewSlideReportId('')
    setNewSlidePageName('')
    setNewSlideDwell('')
  }

  // 슬라이드 추가 시 선택한 레포트의 페이지 목록(선택 사항)
  const pagesQuery = useQuery({
    queryKey: ['report-pages', newSlideReportId],
    queryFn: ({ signal }) => mailSchedulesApi.reportPages(Number(newSlideReportId), signal),
    enabled: typeof newSlideReportId === 'number',
    staleTime: 60_000,
    retry: false,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['display-boards'] })

  const createBoardMutation = useMutation({
    mutationFn: () => displayBoardsApi.create({ name: newBoardName.trim() }),
    onSuccess: (board) => {
      setNewBoardName('')
      setSelectedBoardId(board.id)
      addToast(`전광판 ‘${board.name}’을(를) 만들었습니다.`, 'success')
      invalidate()
    },
    onError: (error) => addToast(errorText(error, '전광판을 만들지 못했습니다.'), 'error'),
  })

  const updateBoardMutation = useMutation({
    mutationFn: (payload: Parameters<typeof displayBoardsApi.update>[1]) =>
      displayBoardsApi.update(activeBoardId as number, payload),
    onSuccess: () => {
      addToast('전광판 설정을 저장했습니다.', 'success')
      invalidate()
    },
    onError: (error) => addToast(errorText(error, '설정을 저장하지 못했습니다.'), 'error'),
  })

  const deleteBoardMutation = useMutation({
    mutationFn: (boardId: number) => displayBoardsApi.remove(boardId),
    onSuccess: () => {
      setSelectedBoardId(null)
      addToast('전광판을 삭제했습니다.', 'success')
      invalidate()
    },
    onError: (error) => addToast(errorText(error, '전광판을 삭제하지 못했습니다.'), 'error'),
  })

  const addSlideMutation = useMutation({
    mutationFn: () => {
      const reportId = Number(newSlideReportId)
      const page = pagesQuery.data?.find((p) => p.name === newSlidePageName)
      const dwell = newSlideDwell.trim() === '' ? null : Number(newSlideDwell)
      return displayBoardsApi.addSlide(activeBoardId as number, {
        report_id: reportId,
        page_name: newSlidePageName || null,
        page_display_name: page?.display_name ?? null,
        dwell_seconds: dwell,
      })
    },
    onSuccess: () => {
      setNewSlideReportId('')
      setNewSlidePageName('')
      setNewSlideDwell('')
      addToast('화면을 추가했습니다.', 'success')
      invalidate()
    },
    onError: (error) => addToast(errorText(error, '화면을 추가하지 못했습니다.'), 'error'),
  })

  const updateSlideMutation = useMutation({
    mutationFn: ({ slideId, payload }: {
      slideId: number
      payload: Parameters<typeof displayBoardsApi.updateSlide>[2]
    }) => displayBoardsApi.updateSlide(activeBoardId as number, slideId, payload),
    onSuccess: () => invalidate(),
    onError: (error) => addToast(errorText(error, '화면을 수정하지 못했습니다.'), 'error'),
  })

  const reorderMutation = useMutation({
    mutationFn: (slideIds: number[]) =>
      displayBoardsApi.reorderSlides(activeBoardId as number, slideIds),
    onSuccess: () => invalidate(),
    onError: (error) => addToast(errorText(error, '순서를 변경하지 못했습니다.'), 'error'),
  })

  const deleteSlideMutation = useMutation({
    mutationFn: (slideId: number) =>
      displayBoardsApi.removeSlide(activeBoardId as number, slideId),
    onSuccess: () => {
      addToast('화면을 삭제했습니다.', 'success')
      invalidate()
    },
    onError: (error) => addToast(errorText(error, '화면을 삭제하지 못했습니다.'), 'error'),
  })

  function moveSlide(slideId: number, direction: -1 | 1) {
    if (!selectedBoard) return
    const ids = selectedBoard.slides.map((s) => s.id)
    const position = ids.indexOf(slideId)
    const target = position + direction
    if (position < 0 || target < 0 || target >= ids.length) return
    const next = [...ids]
    const moved = next[position]
    next[position] = next[target]
    next[target] = moved
    reorderMutation.mutate(next)
  }

  /** 노출 시간 입력을 커밋한다. 빈 값이면 보드 기본값을 따르도록 되돌린다. */
  function commitDwell(slideId: number, currentValue: number | null) {
    const raw = (dwellDraft[slideId] ?? '').trim()
    const next = raw === '' ? null : Number(raw)
    const outOfRange = next !== null
      && (!Number.isFinite(next) || next < MIN_DWELL_SECONDS || next > MAX_DWELL_SECONDS)
    if (outOfRange) {
      addToast(
        `노출 시간은 ${MIN_DWELL_SECONDS}~${MAX_DWELL_SECONDS}초로 입력해 주세요.`,
        'error',
      )
      setDwellDraft((prev) => ({
        ...prev,
        [slideId]: currentValue == null ? '' : String(currentValue),
      }))
      return
    }
    if (currentValue === next) return
    updateSlideMutation.mutate({ slideId, payload: { dwell_seconds: next } })
  }

  const boardFormDirty = Boolean(
    selectedBoard
    && (boardForm.name.trim() !== selectedBoard.name
      || boardForm.description !== (selectedBoard.description ?? '')
      || boardForm.dwell !== selectedBoard.default_dwell_seconds),
  )
  const canSaveBoardForm = Boolean(
    boardFormDirty
    && boardForm.name.trim() !== ''
    && boardForm.dwell >= MIN_DWELL_SECONDS
    && boardForm.dwell <= MAX_DWELL_SECONDS
    && !updateBoardMutation.isPending,
  )

  return (
    <section className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="portal-content-page-title">KPI 전광판</h2>
          <p className="mt-1 text-sm text-slate-500">
            레포트·페이지를 플레이리스트로 묶어 전체화면에서 자동 순환 표시합니다.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        {/* 전광판 목록 + 생성 */}
        <div className="flex flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newBoardName.trim() && !createBoardMutation.isPending) {
                createBoardMutation.mutate()
              }
            }}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <label className="block text-xs font-medium text-slate-500" htmlFor="new-board-name">
              새 전광판 이름
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="new-board-name"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="예: 임원 상황판"
                maxLength={120}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={!newBoardName.trim() || createBoardMutation.isPending}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> 추가
              </button>
            </div>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {boardsQuery.isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">불러오는 중…</p>
            ) : boards.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                등록된 전광판이 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {boards.map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedBoardId(board.id)}
                      aria-current={board.id === activeBoardId}
                      className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-slate-50 ${
                        board.id === activeBoardId ? 'bg-blue-50/70' : ''
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-slate-800">
                          {board.name}
                        </span>
                        {!board.is_active && (
                          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500">
                            중지
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-slate-500">
                        화면 {board.slide_count}개 · 1회 순환 {formatDwell(board.total_cycle_seconds)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 선택된 전광판 상세 */}
        {!selectedBoard ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-10 text-sm text-slate-400">
            왼쪽에서 전광판을 선택하거나 새로 만들어 주세요.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 기본 설정 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-800">기본 설정</h3>
                <div className="flex items-center gap-2">
                  <Link
                    to={`/display/${selectedBoard.id}/play`}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
                  >
                    <Play className="h-3.5 w-3.5" /> 재생 미리보기
                  </Link>
                  <button
                    type="button"
                    onClick={() => updateBoardMutation.mutate({
                      is_active: !selectedBoard.is_active,
                    })}
                    disabled={updateBoardMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {selectedBoard.is_active ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> 재생 중지
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" /> 재생 허용
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const ok = window.confirm(
                        `‘${selectedBoard.name}’ 전광판을 삭제할까요? 레포트는 삭제되지 않습니다.`,
                      )
                      if (ok) deleteBoardMutation.mutate(selectedBoard.id)
                    }}
                    disabled={deleteBoardMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 삭제
                  </button>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!canSaveBoardForm) return
                  updateBoardMutation.mutate({
                    name: boardForm.name.trim(),
                    description: boardForm.description.trim() || null,
                    default_dwell_seconds: boardForm.dwell,
                  })
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-slate-500">
                  이름
                  <input
                    value={boardForm.name}
                    onChange={(e) => setBoardForm((f) => ({ ...f, name: e.target.value }))}
                    maxLength={120}
                    className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex min-w-[14rem] flex-[2] flex-col text-xs text-slate-500">
                  설명 (선택)
                  <input
                    value={boardForm.description}
                    onChange={(e) => setBoardForm((f) => ({ ...f, description: e.target.value }))}
                    maxLength={300}
                    placeholder="예: 로비 대형 모니터용"
                    className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex w-40 flex-col text-xs text-slate-500">
                  기본 노출 시간(초)
                  <input
                    type="number"
                    min={MIN_DWELL_SECONDS}
                    max={MAX_DWELL_SECONDS}
                    value={boardForm.dwell}
                    onChange={(e) => setBoardForm((f) => ({ ...f, dwell: Number(e.target.value) }))}
                    className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!canSaveBoardForm}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> 저장
                </button>
              </form>

              <p className="mt-2 text-xs text-slate-500">
                화면 {selectedBoard.slide_count}개 · 재생 가능 {selectedBoard.playable_slide_count}개
                · 1회 순환 약 {formatDwell(selectedBoard.total_cycle_seconds)}
              </p>
            </div>

            {/* 슬라이드 추가 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-800">화면 추가</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (typeof newSlideReportId === 'number' && !addSlideMutation.isPending) {
                    addSlideMutation.mutate()
                  }
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="flex min-w-[14rem] flex-[2] flex-col text-xs text-slate-500">
                  레포트
                  <select
                    value={newSlideReportId}
                    onChange={(e) => {
                      setNewSlideReportId(e.target.value === '' ? '' : Number(e.target.value))
                      setNewSlidePageName('')
                    }}
                    className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">레포트 선택</option>
                    {reports.map((report) => (
                      <option key={report.id} value={report.id}>
                        {reportDisplayName(report)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[12rem] flex-1 flex-col text-xs text-slate-500">
                  페이지 (선택)
                  <select
                    value={newSlidePageName}
                    onChange={(e) => setNewSlidePageName(e.target.value)}
                    disabled={typeof newSlideReportId !== 'number' || pagesQuery.isLoading}
                    className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                  >
                    <option value="">기본(첫) 페이지</option>
                    {(pagesQuery.data ?? []).map((page) => (
                      <option key={page.name} value={page.name}>{page.display_name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col text-xs text-slate-500">
                  노출 시간(초)
                  <input
                    type="number"
                    min={MIN_DWELL_SECONDS}
                    max={MAX_DWELL_SECONDS}
                    value={newSlideDwell}
                    onChange={(e) => setNewSlideDwell(e.target.value)}
                    placeholder={`기본 ${selectedBoard.default_dwell_seconds}`}
                    className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={typeof newSlideReportId !== 'number' || addSlideMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> 추가
                </button>
              </form>
              {pagesQuery.isError && (
                <p className="mt-2 text-xs text-amber-600">
                  페이지 목록을 불러오지 못했습니다. 기본 페이지로 추가할 수 있습니다.
                </p>
              )}
            </div>

            {/* 슬라이드 목록 */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-16 px-4 py-3">순서</th>
                    <th className="px-4 py-3">레포트 · 페이지</th>
                    <th className="w-44 px-4 py-3">노출 시간(초)</th>
                    <th className="w-24 px-4 py-3">사용</th>
                    <th className="w-20 px-4 py-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedBoard.slides.map((slide, position) => (
                    <tr key={slide.id} className={slide.is_enabled ? '' : 'bg-slate-50/60'}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="w-4 text-xs text-slate-500">{position + 1}</span>
                          <button
                            type="button"
                            aria-label={`${slide.report_name} 위로`}
                            disabled={position === 0 || reorderMutation.isPending}
                            onClick={() => moveSlide(slide.id, -1)}
                            className="rounded p-0.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`${slide.report_name} 아래로`}
                            disabled={
                              position === selectedBoard.slides.length - 1
                              || reorderMutation.isPending
                            }
                            onClick={() => moveSlide(slide.id, 1)}
                            className="rounded p-0.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-800">{slide.report_name}</span>
                          <span className="text-xs text-slate-500">
                            {slide.page_display_name?.trim() || '기본(첫) 페이지'}
                          </span>
                          {!slide.is_accessible && (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              조회 권한이 없어 재생에서 제외됩니다.
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={MIN_DWELL_SECONDS}
                          max={MAX_DWELL_SECONDS}
                          aria-label={`${slide.report_name} 노출 시간`}
                          value={dwellDraft[slide.id] ?? ''}
                          placeholder={`기본 ${selectedBoard.default_dwell_seconds}`}
                          onChange={(e) => setDwellDraft((prev) => ({
                            ...prev,
                            [slide.id]: e.target.value,
                          }))}
                          onBlur={() => commitDwell(slide.id, slide.dwell_seconds ?? null)}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        />
                        <span className="ml-2 text-xs text-slate-400">
                          {slide.dwell_seconds == null
                            ? '기본값'
                            : formatDwell(slide.effective_dwell_seconds)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => updateSlideMutation.mutate({
                            slideId: slide.id,
                            payload: { is_enabled: !slide.is_enabled },
                          })}
                          disabled={updateSlideMutation.isPending}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition disabled:opacity-50 ${
                            slide.is_enabled
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {slide.is_enabled ? '사용' : '제외'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`${slide.report_name} 삭제`}
                          onClick={() => deleteSlideMutation.mutate(slide.id)}
                          disabled={deleteSlideMutation.isPending}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                  {selectedBoard.slides.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                        <Monitor className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                        아직 추가된 화면이 없습니다. 위에서 레포트를 선택해 추가해 주세요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
