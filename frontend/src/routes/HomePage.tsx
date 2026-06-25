/**
 * 레포트 목록 + 폴더 트리 (HomePage, T-36).
 *
 * - 좌측 사이드바: 폴더 트리(VIEW 권한 필터는 백엔드에서 적용)
 * - 본문: 선택 폴더의 레포트 카드 목록(VIEW + 공개 필터 = 백엔드)
 * - TanStack Query refetchInterval 자동 새로고침(토글) — 필터/선택 상태 보존
 * 요구사항: R8, R19, R24, R41
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderOpen, LayoutGrid, FileBarChart, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'

import { foldersApi, reportsApi } from '@/api/portalApi'
import { reportDisplayName, type FolderTreeNode, type ReportSummary } from '@/types/report'

/** 자동 새로고침 간격(ms). VITE_AUTO_REFRESH_SEC 로 조정 가능(기본 60s). */
const AUTO_REFRESH_MS = (Number(import.meta.env.VITE_AUTO_REFRESH_SEC) || 60) * 1000

/** 사이드바 선택 상태: null=전체 레포트. */
type Selection = number | null

function countReports(node: FolderTreeNode): number {
  return node.report_ids.length + node.children.reduce((s, c) => s + countReports(c), 0)
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

export default function HomePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Selection>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

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

  const folders = treeQuery.data ?? []
  const reports = reportsQuery.data ?? []

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

      {/* 본문: 레포트 목록 */}
      <main className="flex-1 p-6">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-800">{selectedName}</h1>
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

        {reportsQuery.isLoading ? (
          <p className="text-sm text-slate-400">레포트를 불러오는 중…</p>
        ) : reportsQuery.isError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            레포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : reports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-400">
            조회 가능한 레포트가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {reports.map((r: ReportSummary) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/reports/${r.id}`)}
                className="group flex flex-col items-start rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
                  <FileBarChart className="h-5 w-5" />
                </div>
                <h3 className="line-clamp-2 font-semibold text-slate-800">{reportDisplayName(r)}</h3>
                {r.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.description}</p>
                )}
                {r.category && (
                  <span className="mt-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{r.category}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
