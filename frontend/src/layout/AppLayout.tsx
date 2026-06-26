/**
 * 공용 레이아웃 — 좌측 사이드바(역할별 메뉴) + 상단 헤더(사용자/로그아웃) + 본문 Outlet.
 *
 * 메뉴는 역할에 따라 노출되며(통제는 백엔드가 강제), 로그아웃은 세션을 무효화하고
 * 로그인 화면으로 보낸다.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LayoutGrid, BarChart3, Mail, CalendarClock, Activity, RefreshCw,
  Users, LogOut,
} from 'lucide-react'

import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/stores/useAuthStore'
import BackgroundTaskDock from '@/components/BackgroundTaskDock'

interface NavItem {
  to: string
  label: string
  Icon: typeof LayoutGrid
  menu: string // 접근 메뉴 키 (allowed_menus 기준 노출)
}

const NAV: NavItem[] = [
  { to: '/', label: '레포트', Icon: LayoutGrid, menu: 'home' },
  { to: '/mail/schedules', label: '메일 스케줄', Icon: CalendarClock, menu: 'mail_schedules' },
  { to: '/mail/jobs', label: '메일 이력', Icon: Mail, menu: 'mail_jobs' },
  { to: '/stats', label: '통계', Icon: BarChart3, menu: 'stats' },
  { to: '/monitoring/refresh', label: 'Refresh 현황', Icon: RefreshCw, menu: 'monitoring_refresh' },
  { to: '/monitoring/ops', label: '운영 상태', Icon: Activity, menu: 'monitoring_ops' },
  { to: '/admin', label: '관리자', Icon: Users, menu: 'admin_users' },
]

const ADMIN_MENUS = ['admin_reports', 'admin_users', 'admin_groups', 'admin_roles', 'admin_holidays']

export default function AppLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)

  const roles = user?.roles ?? []
  const allowedMenus = user?.allowed_menus ?? []
  const isOperator = roles.includes('System_Operator')
  const visibleNav = NAV.filter((n) => {
    if (n.to === '/') return true // 홈(레포트 조회)은 모든 로그인 사용자
    if (isOperator) return true
    if (n.to === '/admin') return ADMIN_MENUS.some((m) => allowedMenus.includes(m))
    return allowedMenus.includes(n.menu)
  })

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clear()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* 사이드바 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="text-xl font-bold text-slate-800">SCL BI PORTAL</div>
          <div className="text-xs text-slate-400">삼천리 BI PORTAL</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {visibleNav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 본문 영역 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div />
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

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>

      <BackgroundTaskDock />
    </div>
  )
}
