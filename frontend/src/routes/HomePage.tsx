/**
 * 레포트 홈 (HomePage).
 *
 * 폴더/레포트 탐색은 좌측 내비(SidebarFolderTree)에서 수행하며, 레포트를 고르면
 * `/reports/:id`(단일 뷰)로 이동한다. 따라서 이 화면은 카드 갤러리가 아니라:
 *  - 기본(`/`): 안내 랜딩 + 즐겨찾기(있으면)
 *  - 즐겨찾기 보기(`/?fav=1`): 즐겨찾기 레포트 카드 + 검색
 * 요구사항: R8, R24, R41
 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileBarChart, Star, Search, FolderTree } from 'lucide-react'

import { reportsApi } from '@/api/portalApi'
import { reportDisplayName, type ReportSummary } from '@/types/report'

/** ISO 문자열을 한국 로컬 날짜시간 문자열로. */
function fmtLocal(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}

interface ReportCardProps {
  report: ReportSummary
  onOpen: (id: number) => void
  onToggleFavorite: (report: ReportSummary) => void
  toggling: boolean
}

function ReportCard({ report, onOpen, onToggleFavorite, toggling }: ReportCardProps) {
  const updated = fmtLocal(report.updated_at)
  const fav = !!report.is_favorite
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-blue-400 hover:shadow-md">
      <button
        type="button"
        aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-pressed={fav}
        disabled={toggling}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(report) }}
        className="absolute right-2 top-2 z-10 rounded-full bg-white/90 p-1.5 shadow-sm transition hover:bg-white disabled:opacity-50"
      >
        <Star className={`h-4 w-4 ${fav ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(report.id)}
        className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 text-blue-300 transition group-hover:from-blue-100"
        aria-label={`${reportDisplayName(report)} 열기`}
      >
        <FileBarChart className="h-10 w-10" />
      </button>

      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={() => onOpen(report.id)}
          className="line-clamp-2 text-left font-semibold text-slate-800 hover:text-blue-600"
          title={report.description ?? undefined}
        >
          {reportDisplayName(report)}
        </button>
        <dl className="mt-2 space-y-0.5 text-xs text-slate-500">
          <div className="flex gap-1">
            <dt className="shrink-0 text-slate-400">마지막 업데이트:</dt>
            <dd className="truncate">{updated ?? '-'}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0 text-slate-400">작성자:</dt>
            <dd className="truncate">{report.author_label || '-'}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')

  const favView = searchParams.get('fav') === '1'

  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: ({ signal }) => reportsApi.favorites(signal),
    staleTime: 30_000,
  })

  const toggleFavorite = useMutation({
    mutationFn: (report: ReportSummary) =>
      report.is_favorite
        ? reportsApi.removeFavorite(report.id)
        : reportsApi.addFavorite(report.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })

  const favorites = useMemo(
    () => (favoritesQuery.data ?? []).map((r) => ({ ...r, is_favorite: true })),
    [favoritesQuery.data],
  )

  const filteredFavorites = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return favorites
    return favorites.filter((r) => {
      const name = reportDisplayName(r).toLowerCase()
      const author = (r.author_label ?? '').toLowerCase()
      return name.includes(q) || author.includes(q)
    })
  }, [favorites, search])

  const togglingId = toggleFavorite.isPending ? toggleFavorite.variables?.id : undefined
  const openReport = (id: number) => navigate(`/reports/${id}`)

  // ── 즐겨찾기 전용 보기 ──────────────────────────────────────────────
  if (favView) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-1.5 text-xl font-bold text-slate-800">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            즐겨찾기
          </h1>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="레포트명·작성자 검색"
              aria-label="레포트 검색"
              className="w-56 rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>

        {favoritesQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : filteredFavorites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-400">
            {search.trim() ? '검색 결과가 없습니다.' : '즐겨찾기한 레포트가 없습니다. 레포트 화면의 별을 눌러 추가하세요.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredFavorites.map((r) => (
              <ReportCard
                key={`fav-${r.id}`}
                report={r}
                onOpen={openReport}
                onToggleFavorite={(rep) => toggleFavorite.mutate(rep)}
                toggling={togglingId === r.id}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── 기본 랜딩(좌측 트리에서 레포트 선택 유도) + 즐겨찾기 ─────────────
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {favorites.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-1.5 text-base font-bold text-slate-800">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            즐겨찾기
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {favorites.map((r) => (
              <ReportCard
                key={`fav-${r.id}`}
                report={r}
                onOpen={openReport}
                onToggleFavorite={(rep) => toggleFavorite.mutate(rep)}
                toggling={togglingId === r.id}
              />
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <FolderTree className="h-10 w-10 text-slate-300" />
        <h2 className="mt-3 text-base font-semibold text-slate-700">레포트를 선택하세요</h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          좌측 메뉴에서 폴더를 펼쳐 원하는 레포트를 선택하면 이 영역에 레포트가 표시됩니다.
        </p>
      </div>
    </div>
  )
}
