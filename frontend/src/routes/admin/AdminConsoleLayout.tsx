/** 관리자 콘솔 전용 전체 화면 레이아웃. */
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogOut, Menu, PanelLeftClose } from 'lucide-react'

import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { visibleAdminSections } from '@/routes/admin/adminNav'
import BackgroundTaskDock from '@/components/BackgroundTaskDock'
import { formatLastLogin, userRoleLabel } from '@/utils/user'

export default function AdminConsoleLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)
  // 사용자 화면과 같은 영속 상태를 사용해 화면을 오갈 때 접힘 상태를 일관되게 유지한다.
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleSidebar = useSidebarStore((s) => s.toggle)

  const roles = user?.roles ?? []
  const isOperator = roles.includes('System_Operator')
  const sections = visibleAdminSections(isOperator, user?.allowed_menus ?? [])
  const lastLoginLabel = formatLastLogin(user?.last_login_at)

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clear()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="editorial-shell editorial-shell--admin flex h-screen overflow-hidden">
      <aside
        className={`editorial-sidebar editorial-sidebar--admin shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
          collapsed ? 'w-0 border-r-0' : 'w-64 border-r'
        }`}
      >
        {/* aside가 0px로 줄어도 내부 메뉴 폭은 유지해 자연스럽게 좌측으로 사라지게 한다. */}
        <div className="flex h-full w-64 flex-col">
          <div className="editorial-sidebar__brand flex items-center gap-3 border-b px-4 py-4">
            <Link
              to="/admin"
              aria-label="관리자 대시보드로 이동"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <span className="editorial-brand-mark shrink-0">
                <img src="/logo.png" alt="삼천리 로고" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="editorial-brand-eyebrow">SYSTEM OPERATIONS</div>
                <span className="editorial-brand-title mt-1 block">ADMIN</span>
              </div>
            </Link>
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="관리자 메뉴 접기"
              title="관리자 메뉴 접기"
              className="editorial-icon-button shrink-0 p-1"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </div>

          <nav className="editorial-nav flex-1 overflow-y-auto">
            {sections.map((sec) => (
              <div key={sec.title} className="mb-4">
                <div className="editorial-admin-section-label px-3 pb-1 pt-1.5">{sec.title}</div>
                <div className="space-y-1">
                  {sec.items.map(({ to, label, Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/admin/reports'}
                      className={({ isActive }) =>
                        `editorial-nav-link flex items-center gap-2 px-3 py-2 text-sm font-medium transition ${
                          isActive ? 'editorial-nav-link--active' : ''
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
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
                aria-label="관리자 메뉴 펼치기"
                title="관리자 메뉴 펼치기"
                className="editorial-icon-button inline-flex items-center justify-center p-2"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              사용자 화면으로
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="editorial-user text-right"
              title={`${user?.name ?? '-'} / ${userRoleLabel(roles)}, ${user?.department_name?.trim() || '팀 미지정'}`}
            >
              <div className="editorial-user__name">{user?.name ?? '-'}</div>
              <div className="editorial-user__meta">
                {userRoleLabel(roles)}, {user?.department_name?.trim() || '팀 미지정'}
              </div>
              {lastLoginLabel && (
                <div className="editorial-user__last-login text-xs text-slate-400">
                  마지막 접속 {lastLoginLabel}
                </div>
              )}
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

        <main className="editorial-content editorial-content--admin min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <BackgroundTaskDock />
    </div>
  )
}
