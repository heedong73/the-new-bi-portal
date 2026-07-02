/**
 * 좌측 내비의 '레포트' 하위 폴더/레포트 탐색기 트리.
 *
 * - 폴더는 계열사/구분자 성격이라 클릭하면 **펼치기/접기**만 한다(메인 화면 불변).
 * - 폴더를 펼치면 하위 폴더(먼저) + 그 폴더의 직속 레포트(지연 로드)가 나열된다.
 * - 레포트를 클릭하면 메인에 그 레포트 1개를 임베드 표시(`/reports/:id`).
 * - '즐겨찾기'(?fav=1)는 별도 진입점.
 */
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Folder, FolderOpen, Star, FileBarChart, ChevronRight, ChevronDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { foldersApi, reportsApi } from '@/api/portalApi'
import { reportDisplayName, type FolderTreeNode } from '@/types/report'

function countReports(node: FolderTreeNode): number {
  return node.report_ids.length + node.children.reduce((s, c) => s + countReports(c), 0)
}

interface ItemProps {
  node: FolderTreeNode
  depth: number
  currentReportId: number | null
  onOpenReport: (id: number) => void
}

function NavFolderItem({ node, depth, currentReportId, onOpenReport }: ItemProps) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children.length > 0
  const hasReports = node.report_ids.length > 0
  const expandable = hasChildren || hasReports
  const total = countReports(node)

  // 직속 레포트는 펼칠 때 지연 로드(이름 확보). report_ids만으로는 이름이 없음.
  const reportsQuery = useQuery({
    queryKey: ['folder-reports', node.id],
    queryFn: ({ signal }) => reportsApi.list(node.id, signal),
    enabled: open && hasReports,
    staleTime: 30_000,
  })
  const reports = reportsQuery.data ?? []

  return (
    <li>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen((v) => !v)}
        className="mb-0.5 flex w-full items-center gap-1 rounded-md bg-slate-100 py-1.5 pr-1 text-sm text-slate-700 transition hover:bg-slate-200"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1 truncate text-left">{node.name}</span>
        <span className="text-xs text-slate-400">{total}</span>
        {expandable ? (
          open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
      </button>

      {open && (
        <ul>
          {/* 하위 폴더 먼저 */}
          {node.children.map((child) => (
            <NavFolderItem
              key={`f-${child.id}`}
              node={child}
              depth={depth + 1}
              currentReportId={currentReportId}
              onOpenReport={onOpenReport}
            />
          ))}

          {/* 직속 레포트(지연 로드) */}
          {hasReports && reportsQuery.isLoading && (
            <li
              className="py-1 text-xs text-slate-400"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              레포트 불러오는 중…
            </li>
          )}
          {reports.map((r) => {
            const active = currentReportId === r.id
            return (
              <li key={`r-${r.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenReport(r.id)}
                  title={reportDisplayName(r)}
                  className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm transition ${
                    active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                >
                  <FileBarChart className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{reportDisplayName(r)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

export default function SidebarFolderTree() {
  const navigate = useNavigate()
  const location = useLocation()

  const treeQuery = useQuery({
    queryKey: ['folder-tree'],
    queryFn: ({ signal }) => foldersApi.tree(signal),
    staleTime: 60_000,
  })

  // 현재 보고 있는 레포트 ID(/reports/:id)로 트리의 레포트 항목 하이라이트.
  const reportMatch = location.pathname.match(/^\/reports\/(\d+)/)
  const currentReportId = reportMatch ? Number(reportMatch[1]) : null

  const favActive = location.pathname === '/' && new URLSearchParams(location.search).get('fav') === '1'

  const folders = treeQuery.data ?? []

  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => navigate('/?fav=1')}
        className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pl-4 pr-2 text-sm transition ${
          favActive ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
        즐겨찾기
      </button>
      {treeQuery.isLoading ? (
        <p className="px-4 py-1.5 text-xs text-slate-400">불러오는 중…</p>
      ) : folders.length > 0 ? (
        <ul>
          {folders.map((node) => (
            <NavFolderItem
              key={node.id}
              node={node}
              depth={1}
              currentReportId={currentReportId}
              onOpenReport={(id) => navigate(`/reports/${id}`)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
