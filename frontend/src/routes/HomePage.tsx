/**
 * 레포트 목록 + 폴더 트리 (HomePage, T-36 / Task F).
 *
 * - 좌측 사이드바: 폴더 트리(VIEW 권한 필터는 백엔드에서 적용)
 * - 본문 상단: 즐겨찾기 섹션(별표한 레포트 카드 갤러리)
 * - 본문: 선택 폴더의 레포트 카드 갤러리(검색 + 자동 새로고침)
 *   각 카드: 제목바 / 미리보기 영역 / 레포트명 / 마지막 업데이트 / 작성자 / 별 토글
 * 요구사항: R8, R19, R24, R41
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Folder, FolderOpen, LayoutGrid, FileBarChart, RefreshCw,
  ChevronRight, ChevronDown, Star, Search,
} from 'lucide-react'

import { foldersApi, reportsApi } from '@/api/portalApi'
import { reportDisplayName, type FolderTreeNode, type ReportSummary } from '@/types/report'

/** 자동 새로고침 간격(ms). VITE_AUTO_REFRESH_SEC 로 조정 가능(기본 60s). */
const AUTO_REFRESH_MS = (Number(import.meta.env.VITE_AUTO_REFRESH_SEC) || 60) * 1000

/** 사이드바 선택 상태: null=전체 레포트. */
type Selection = number | null

function countReports(node: FolderTreeNode): number {
  return node.report_ids.length + node.children.reduce((s, c) => s + countReports(c), 0)
}

/** ISO 문자열을 한국 로컬 날짜시간 문자열로. */
function fmtLocal(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
}

interface FolderItemProps {
  node: FolderTreeNode
  depth: number
  selected: Selection
  onSelect: (id: number) => void
}

function FolderItem({ node, depth, selected, onSelect }: FolderItemProps) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  const isSelected = selected === node.id
  const total = countReports(node)

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition ${
          isSelected ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? '접기' : '펼치기'}
            onClick={() => setOpen((v) => !v)}
            className="shrink-0"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          {isSelected ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
          <span className="truncate">{node.name}</span>
          <span className={`ml-auto text-xs ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>{total}</span>
        </button>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <FolderItem key={child.id} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  )
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
      {/* 별 토글 */}
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

      {/* 미리보기 영역(플레이스홀더) — 클릭 시 열기 */}
      <button
        type="button"
        onClick={() => onOpen(report.id)}
        className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 text-blue-300 transition group-hover:from-blue-100"
        aria-label={`${reportDisplayName(report)} 열기`}
      >
        <FileBarChart className="h-10 w-10" />
      </button>

      {/* 본문 */}
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
  const [selected, setSelected] = useState<Selection>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [search, setSearch] = useState('')

  const treeQuery = useQuery({
    queryKey: ['folder-tree'],
    queryFn: ({ signal }) => foldersApi.tree(signal),
    staleTime: 60_000,
  })

  const reportsQuery = useQuery({
    queryKey: ['reports', selected],
    queryFn: ({ signal }) => reportsApi.list(selected, signal),
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
    staleTime: 10_000,
  })

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
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const folders = treeQuery.data ?? []
  const reports = reportsQuery.data ?? []
  const favorites = favoritesQuery.data ?? []

  const selectedName = useMemo(() => {
    if (selected === null) return '전체 레포트'
    const find = (nodes: FolderTreeNode[]): string | null => {
      for (const n of nodes) {
        if (n.id === selected) return n.name
        const c = find(n.children)
        if (c) return c
      }
      return null
    }
    return find(folders) ?? '레포트'
  }, [selected, folders])

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return reports
    return reports.filter((r) => {
      const name = reportDisplayName(r).toLowerCase()
      const author = (r.author_label ?? '').toLowerCase()
      return name.includes(q) || author.includes(q)
    })
  }, [reports, search])

  const togglingId = toggleFavorite.isPending ? toggleFavorite.variables?.id : undefined

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* 사이드바: 폴더 트리 */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white p-3">
        <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">폴더</div>
        <ul>
          <li>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition ${
                selected === null ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              전체 레포트
            </button>
          </li>
        </ul>
        {treeQuery.isLoading ? (
          <p className="px-2 py-3 text-sm text-slate-400">불러오는 중…</p>
        ) : folders.length === 0 ? (
          <p className="px-2 py-3 text-sm text-slate-400">폴더가 없습니다.</p>
        ) : (
          <ul className="mt-1">
            {folders.map((node) => (
              <FolderItem key={node.id} node={node} depth={0} selected={selected} onSelect={setSelected} />
            ))}
          </ul>
        )}
      </aside>

      {/* 본문 */}
      <main className="flex-1 p-6">
        {/* 즐겨찾기 섹션 — 전체 보기일 때만 노출 */}
        {selected === null && favorites.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 flex items-center gap-1.5 text-base font-bold text-slate-800">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              즐겨찾기
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {favorites.map((r) => (
                <ReportCard
                  key={`fav-${r.id}`}
                  report={{ ...r, is_favorite: true }}
                  onOpen={(id) => navigate(`/reports/${id}`)}
                  onToggleFavorite={(rep) => toggleFavorite.mutate({ ...rep, is_favorite: true })}
                  toggling={togglingId === r.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* 헤더 + 검색 + 자동 새로고침 */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-slate-800">{selectedName}</h1>
          <div className="flex items-center gap-3">
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'text-blue-500' : 'text-slate-400'}`} />
              자동 새로고침
            </label>
          </div>
        </div>

        {reportsQuery.isLoading ? (
          <p className="text-sm text-slate-400">레포트를 불러오는 중…</p>
        ) : reportsQuery.isError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            레포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : filteredReports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-400">
            {search.trim() ? '검색 결과가 없습니다.' : '조회 가능한 레포트가 없습니다.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredReports.map((r: ReportSummary) => (
              <ReportCard
                key={r.id}
                report={r}
                onOpen={(id) => navigate(`/reports/${id}`)}
                onToggleFavorite={(rep) => toggleFavorite.mutate(rep)}
                toggling={togglingId === r.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
