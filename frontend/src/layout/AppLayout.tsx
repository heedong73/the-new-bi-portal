/**
 * 공용 레이아웃 — 역할별 내비게이션, 사용자 헤더, 콘텐츠 Outlet.
 * 기능 계약을 유지하며 Ivory Editorial 표면 시스템을 적용한다.
 */
import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, BarChart3, Settings, LogOut, PanelLeftClose, Menu, MessagesSquare } from 'lucide-react'

import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import SidebarFolderTree from '@/components/SidebarFolderTree'
import BackgroundTaskDock from '@/components/BackgroundTaskDock'
import { ADMIN_GROUP_MENUS } from '@/routes/admin/adminNav'

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleSidebar = useSidebarStore((s) => s.toggle)
  const [folderTreeResetKey, setFolderTreeResetKey] = useState(0)

  const roles = user?.roles ?? []
  const allowedMenus = user?.allowed_menus ?? []
  const isOperator = roles.includes('System_Operator')
  const canStats = isOperator || allowedMenus.includes('stats')
  const canAdmin = isOperator || ADMIN_GROUP_MENUS.some((m) => allowedMenus.includes(m))

  const path = location.pathname
  const reportActive = path === '/' || path.startsWith('/reports/')
  const statsActive = path.startsWith('/stats')
  const serviceActive = path.startsWith('/service-center')
  const adminActive = path.startsWith('/admin') || path.startsWith('/mail') || path.startsWith('/monitoring')
  const itemCls = (active: boolean) =>
    `editorial-nav-link flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition ${
      active ? 'editorial-nav-link--active' : ''
    }`

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clear()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="editorial-shell flex h-screen overflow-hidden">
      <aside
        className={`editorial-sidebar shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
          collapsed ? 'w-0 border-r-0' : 'w-64 border-r'
        }`}
      >
        <div className="flex h-full w-64 flex-col">
          <div className="editorial-sidebar__brand flex items-center gap-3 border-b px-4 py-4">
            <span className="editorial-brand-mark shrink-0">
              <img src="/logo.png" alt="삼천리 로고" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="editorial-brand-eyebrow whitespace-nowrap">SAMCHULLY GROUP</div>
              <div className="editorial-brand-title mt-1 whitespace-nowrap">SCL BI PORTAL</div>
              <div className="editorial-brand-subtitle mt-1">Business Intelligence Workspace</div>
            </div>
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="메뉴 접기"
              title="메뉴 접기"
              className="editorial-icon-button translate-y-6 shrink-0 p-1"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </div>

          <nav className="editorial-nav flex-1 space-y-1 overflow-y-auto">
            <NavLink
              to="/?fav=1"
              end
              onClick={() => setFolderTreeResetKey((value) => value + 1)}
              className={() => itemCls(reportActive)}
            >
              <LayoutGrid className="h-4 w-4" />
              레포트
            </NavLink>
            <SidebarFolderTree key={folderTreeResetKey} />

            {canStats && (
              <NavLink to="/stats" className={() => itemCls(statsActive)}>
                <BarChart3 className="h-4 w-4" />
                통계
              </NavLink>
            )}

            <NavLink to="/service-center" className={() => itemCls(serviceActive)}>
              <MessagesSquare className="h-4 w-4" />
              서비스 센터
            </NavLink>

            {canAdmin && (
              <NavLink to="/admin" className={() => itemCls(adminActive)}>
                <Settings className="h-4 w-4" />
                관리자 콘솔
              </NavLink>
            )}
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="editorial-header flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            {collapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="메뉴 펼치기"
                title="메뉴 펼치기"
                className="editorial-icon-button inline-flex items-center justify-center p-2"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="editorial-user text-right">
              <div className="editorial-user__name">{user?.name ?? '-'}</div>
              <div className="editorial-user__meta">{user?.emp_no}</div>
            </div>
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="editorial-logout inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm transition disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </div>
        </header>

        <div className="editorial-content min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>

      <BackgroundTaskDock />
    </div>
  )
}
