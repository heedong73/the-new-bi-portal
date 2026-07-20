/**
 * 레포트 홈 (HomePage).
 * 폴더/레포트 탐색은 좌측 내비에서 수행하며, 이 화면은
 * 즐겨찾기 리포트 컬렉션을 기본으로 제공한다.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileBarChart, Star, Search, FolderTree } from 'lucide-react'

import { reportsApi } from '@/api/portalApi'
import { reportDisplayName, type ReportSummary } from '@/types/report'

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
    <div className="editorial-report-card group relative flex flex-col overflow-hidden border transition">
      <button
        type="button"
        aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        aria-pressed={fav}
        disabled={toggling}
        onClick={(event) => { event.stopPropagation(); onToggleFavorite(report) }}
        className="editorial-report-card__favorite absolute right-3 top-3 z-10 rounded-full p-1.5 transition disabled:opacity-50"
      >
        <Star className={`h-4 w-4 ${fav ? 'fill-yellow-400 text-yellow-400' : 'text-slate-400'}`} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(report.id)}
        className="editorial-report-card__visual flex h-32 w-full items-center justify-center transition"
        aria-label={`${reportDisplayName(report)} 열기`}
      >
        <FileBarChart className="h-10 w-10" />
      </button>

      <div className="flex flex-1 flex-col p-4">
        <button
          type="button"
          onClick={() => onOpen(report.id)}
          className="editorial-report-card__title line-clamp-2 text-left font-semibold transition"
          title={report.description ?? undefined}
        >
          {reportDisplayName(report)}
        </button>
        <dl className="editorial-report-card__meta mt-3 space-y-1 text-xs">
          <div className="flex gap-1">
            <dt className="shrink-0">마지막 업데이트:</dt>
            <dd className="truncate">{updated ?? '-'}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="shrink-0">작성자:</dt>
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
  const [search, setSearch] = useState('')

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
    () => (favoritesQuery.data ?? []).map((report) => ({ ...report, is_favorite: true })),
    [favoritesQuery.data],
  )

  const filteredFavorites = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return favorites
    return favorites.filter((report) => {
      const name = reportDisplayName(report).toLowerCase()
      const author = (report.author_label ?? '').toLowerCase()
      return name.includes(query) || author.includes(query)
    })
  }, [favorites, search])

  const togglingId = toggleFavorite.isPending ? toggleFavorite.variables?.id : undefined
  const openReport = (id: number) => navigate(`/reports/${id}`)

  return (
    <div className="editorial-home">
      <div className="editorial-page-heading">
        <p className="editorial-page-kicker">Personal Report Collection</p>
        <h1 className="editorial-compact-page-title">즐겨찾기 리포트</h1>
        <p>자주 확인하는 핵심 지표와 업무 인사이트를 한 곳에서 빠르게 이어보세요.</p>
      </div>

      <div className="editorial-section-heading mb-5 flex-wrap">
        <h2>
          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
          Saved reports
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="레포트명 · 작성자 검색"
            aria-label="레포트 검색"
            className="editorial-search w-64 py-2 pl-9 pr-3 text-sm focus:outline-none"
          />
        </div>
      </div>

      {favoritesQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : filteredFavorites.length === 0 ? (
        <div className="editorial-empty-state px-6 py-16 text-center text-slate-500">
          <FolderTree className="mx-auto h-10 w-10 text-blue-300" />
          <p className="mt-4 text-sm">
            {search.trim() ? '검색 결과가 없습니다.' : '즐겨찾기한 레포트가 없습니다. 레포트 화면의 별을 눌러 추가하세요.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredFavorites.map((report) => (
            <ReportCard
              key={`fav-${report.id}`}
              report={report}
              onOpen={openReport}
              onToggleFavorite={(item) => toggleFavorite.mutate(item)}
              toggling={togglingId === report.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
