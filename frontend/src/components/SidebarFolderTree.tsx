/** 레포트 탐색 허브 전용 좌측 내비게이션. 카테고리에는 최상위 폴더만 표시한다. */
import { useLocation, useNavigate } from 'react-router-dom'
import { Clock3, Folder, Home, LayoutGrid, Star } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { foldersApi } from '@/api/portalApi'
import type { FolderTreeNode } from '@/types/report'

function countReports(node: FolderTreeNode): number {
  return node.report_ids.length + node.children.reduce((sum, child) => sum + countReports(child), 0)
}

function positiveNumber(value: string | null): number | null {
  const parsed = Number(value)
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export default function SidebarFolderTree() {
  const navigate = useNavigate()
  const location = useLocation()
  const treeQuery = useQuery({
    queryKey: ['folder-tree'],
    queryFn: ({ signal }) => foldersApi.tree(signal),
    staleTime: 60_000,
  })

  const roots = treeQuery.data ?? []
  const params = new URLSearchParams(location.search)
  const selectedRootId = positiveNumber(params.get('root'))
  const path = location.pathname
  const reportNavClass = (active: boolean) =>
    `portal-discovery-link flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
      active ? 'portal-discovery-link--active' : ''
    }`
  const categoryClass = (active: boolean) =>
    `portal-discovery-link flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
      active ? 'portal-discovery-link--active' : ''
    }`

  return (
    <div className="portal-discovery-nav px-2 pb-2">
      <p className="portal-discovery-nav__label px-2 pb-2 pt-1">레포트 탐색</p>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => navigate('/reports')}
          className={reportNavClass(path === '/reports')}
          aria-current={path === '/reports' ? 'page' : undefined}
        >
          <Home className="h-4 w-4 shrink-0" />
          <span className="flex-1">홈</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/reports/favorites')}
          className={reportNavClass(path === '/reports/favorites')}
          aria-current={path === '/reports/favorites' ? 'page' : undefined}
        >
          <Star className="h-4 w-4 shrink-0" />
          <span className="flex-1">즐겨찾기</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/reports/recent')}
          className={reportNavClass(path === '/reports/recent')}
          aria-current={path === '/reports/recent' ? 'page' : undefined}
        >
          <Clock3 className="h-4 w-4 shrink-0" />
          <span className="flex-1">최근 본 리포트</span>
        </button>
      </div>

      <div className="portal-discovery-nav__divider my-4" />
      <p className="portal-discovery-nav__label px-2 pb-2">카테고리</p>
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => navigate('/reports/catalog')}
          className={categoryClass(path === '/reports/catalog' && selectedRootId == null)}
          aria-current={path === '/reports/catalog' && selectedRootId == null ? 'page' : undefined}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          <span className="flex-1">전체 리포트</span>
          {roots.length > 0 && (
            <span className="portal-discovery-link__count">{roots.reduce((sum, root) => sum + countReports(root), 0)}</span>
          )}
        </button>

        {treeQuery.isLoading ? (
          <p className="px-3 py-2 text-xs text-slate-400">불러오는 중…</p>
        ) : roots.map((root) => {
          const active = path === '/reports/catalog' && selectedRootId === root.id
          return (
            <button
              key={root.id}
              type="button"
              onClick={() => navigate(`/reports/catalog?root=${root.id}`)}
              className={categoryClass(active)}
              title={root.name}
              aria-current={active ? 'page' : undefined}
            >
              <Folder className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{root.name}</span>
              <span className="portal-discovery-link__count">{countReports(root)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
