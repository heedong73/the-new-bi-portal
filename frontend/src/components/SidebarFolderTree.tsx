/**
 * 좌측 내비의 폴더/레포트 탐색기 트리.
 * 폴더는 펼치기/접기만 수행하고, 레포트 선택은 단일 뷰로 이동한다.
 */
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Folder, FolderOpen, Star, FileBarChart, ChevronRight, ChevronDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { foldersApi, reportsApi } from '@/api/portalApi'
import { reportDisplayName, type FolderTreeNode } from '@/types/report'

function countReports(node: FolderTreeNode): number {
  return node.report_ids.length + node.children.reduce((sum, child) => sum + countReports(child), 0)
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
        onClick={() => expandable && setOpen((value) => !value)}
        className="portal-tree-folder mb-0.5 flex w-full items-center gap-1 py-1.5 pr-1 text-sm transition"
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
          {node.children.map((child) => (
            <NavFolderItem
              key={`f-${child.id}`}
              node={child}
              depth={depth + 1}
              currentReportId={currentReportId}
              onOpenReport={onOpenReport}
            />
          ))}

          {hasReports && reportsQuery.isLoading && (
            <li
              className="py-1 text-xs text-slate-400"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              레포트 불러오는 중…
            </li>
          )}
          {reports.map((report) => {
            const active = currentReportId === report.id
            return (
              <li key={`r-${report.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenReport(report.id)}
                  title={reportDisplayName(report)}
                  className={`portal-tree-report flex w-full items-center gap-1.5 py-1.5 pr-2 text-sm transition ${
                    active ? 'portal-tree-report--active font-medium' : ''
                  }`}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                >
                  <FileBarChart className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{reportDisplayName(report)}</span>
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

  const reportMatch = location.pathname.match(/^\/reports\/(\d+)/)
  const currentReportId = reportMatch ? Number(reportMatch[1]) : null
  const favActive = location.pathname === '/'
  const folders = treeQuery.data ?? []

  return (
    <div className="portal-tree">
      <button
        type="button"
        onClick={() => navigate('/?fav=1')}
        className={`portal-tree-favorite flex w-full items-center gap-1.5 py-1.5 pl-4 pr-2 text-sm transition ${
          favActive ? 'portal-tree-favorite--active font-medium' : ''
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
