/**
 * 공용 레이아웃 — 좌측 사이드바(역할별 메뉴) + 상단 헤더(사용자/로그아웃) + 본문 Outlet.
 *
 * 메뉴는 역할에 따라 노출되며(통제는 백엔드가 강제), 로그아웃은 세션을 무효화하고
 * 로그인 화면으로 보낸다.
 */
import { NavLink, Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
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
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleSidebar = useSidebarStore((s) => s.toggle)

  const roles = user?.roles ?? []
  const allowedMenus = user?.allowed_menus ?? []
  const isOperator = roles.includes('System_Operator')
  const canStats = isOperator || allowedMenus.includes('stats')
  const canAdmin = isOperator || ADMIN_GROUP_MENUS.some((m) => allowedMenus.includes(m))

  // 최상위 메뉴 활성 판정(쿼리/하위경로 포함)
  const path = location.pathname
  // '레포트'는 전체 레포트 진입점 겸 헤더 — 전체 보기(폴더/즐겨찾기 미선택)일 때만 강조
  const folderSel = searchParams.get('folder')
  const favSel = searchParams.get('fav')
  const reportActive = path === '/' && !folderSel && !favSel
  const statsActive = path.startsWith('/stats')
  const serviceActive = path.startsWith('/service-center')
  const adminActive = path.startsWith('/admin') || path.startsWith('/mail') || path.startsWith('/monitoring')
  const itemCls = (active: boolean) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
      active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
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
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* 사이드바 (접힘 시 왼쪽으로 사라짐) */}
      <aside
        className={`shrink-0 overflow-hidden border-slate-200 bg-white transition-[width] duration-300 ease-in-out ${
          collapsed ? 'w-0 border-r-0' : 'w-56 border-r'
        }`}
      >
        <div className="flex h-full w-56 flex-col">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-4">
            <img src="/logo.png" alt="삼천리 로고" className="h-9 w-9 shrink-0 object-contain" />
            <div className="min-w-0 flex-1">
              <div className="whitespace-nowrap text-base font-bold tracking-tight text-slate-800">SCL BI PORTAL</div>
              <div className="text-xs text-slate-400">삼천리 BI PORTAL</div>
            </div>
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="메뉴 접기"
              title="메뉴 접기"
              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
            {/* 레포트 + 폴더 트리 (모든 사용자) */}
            <NavLink to="/" end className={() => itemCls(reportActive)}>
              <LayoutGrid className="h-4 w-4" />
              레포트
            </NavLink>
            <SidebarFolderTree />

            {/* 통계 (Super_User·운영자) */}
            {canStats && (
              <NavLink to="/stats" className={() => itemCls(statsActive)}>
                <BarChart3 className="h-4 w-4" />
                통계
              </NavLink>
            )}

            {/* 서비스 센터 (모든 사용자) */}
            <NavLink to="/service-center" className={() => itemCls(serviceActive)}>
              <MessagesSquare className="h-4 w-4" />
              서비스 센터
            </NavLink>

            {/* 관리자 콘솔 (운영자) — 전용 콘솔 화면으로 이동 */}
            {canAdmin && (
              <NavLink to="/admin" className={() => itemCls(adminActive)}>
                <Settings className="h-4 w-4" />
                관리자 콘솔
              </NavLink>
            )}
          </nav>
        </div>
      </aside>

      {/* 본문 영역 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center">
            {collapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="메뉴 펼치기"
                title="메뉴 펼치기"
                className="-ml-2 inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-700">{user?.name ?? '-'}</div>
              <div className="text-xs text-slate-400">{user?.emp_no}</div>
            </div>
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </div>
        </header>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>

      <BackgroundTaskDock />
    </div>
  )
}
