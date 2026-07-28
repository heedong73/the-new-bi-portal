/**
 * KPI 전광판 목록 (`/display`).
 *
 * 재생 가능한 전광판(활성 + 내가 볼 수 있는 화면 보유)만 보여준다. 재생 버튼은
 * 클릭 제스처 안에서 전체화면을 먼저 요청한 뒤 플레이어로 이동한다 — 브라우저는
 * 사용자 제스처 없이 전체화면 진입을 허용하지 않으므로, 플레이어 진입 후에
 * 요청하면 차단된다.
 */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Maximize2, Monitor, Play } from 'lucide-react'

import { displayBoardsApi } from '@/api/displayApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { formatDwell } from '@/types/display'

export default function DisplayBoardListPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isOperator = (user?.roles ?? []).includes('System_Operator')

  const boardsQuery = useQuery({
    queryKey: ['display-boards', 'playable'],
    queryFn: ({ signal }) => displayBoardsApi.list(signal),
    staleTime: 30_000,
  })
  const boards = boardsQuery.data ?? []

  /** 전체화면을 먼저 요청(사용자 제스처 유지)한 뒤 플레이어로 이동한다. */
  function playFullscreen(boardId: number) {
    const target = document.documentElement
    if (!document.fullscreenElement && target.requestFullscreen) {
      target.requestFullscreen().catch(() => { /* 차단되면 창 모드로 재생 */ })
    }
    navigate(`/display/${boardId}/play`)
  }

  return (
    <section className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="portal-content-page-title">KPI 전광판</h1>
          <p className="mt-1 text-sm text-slate-500">
            여러 레포트를 정해진 순서와 시간으로 자동 순환 표시합니다. 대형 모니터에
            띄워 두고 사용하세요.
          </p>
        </div>
        {isOperator && (
          <button
            type="button"
            onClick={() => navigate('/admin/display-boards')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            전광판 구성 관리
          </button>
        )}
      </div>

      {boardsQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
        </p>
      ) : boardsQuery.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          전광판 목록을 불러오지 못했습니다.
        </p>
      ) : boards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Monitor className="mx-auto mb-2 h-7 w-7 text-slate-300" />
          <p className="text-sm text-slate-500">재생할 수 있는 전광판이 없습니다.</p>
          {isOperator && (
            <p className="mt-1 text-xs text-slate-400">
              관리자 콘솔 · KPI 전광판에서 플레이리스트를 만들어 주세요.
            </p>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {boards.map((board) => (
            <li
              key={board.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2 className="truncate text-base font-bold text-slate-800">{board.name}</h2>
              {board.description && (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{board.description}</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                화면 {board.playable_slide_count}개 · 1회 순환 약{' '}
                {formatDwell(board.total_cycle_seconds)}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playFullscreen(board.id)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  <Maximize2 className="h-4 w-4" />
                  전체화면 재생
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/display/${board.id}/play`)}
                  aria-label={`${board.name} 창 모드로 재생`}
                  title="창 모드로 재생"
                  className="rounded-lg border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-50"
                >
                  <Play className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
