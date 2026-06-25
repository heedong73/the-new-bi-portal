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

interface NavItem {
  to: string
  label: string
  Icon: typeof LayoutGrid
  roles?: string[] // 지정 시 해당 역할 보유자만 노출
}

const NAV: NavItem[] = [
  { to: '/', label: '레포트', Icon: LayoutGrid },
  { to: '/mail/schedules', label: '메일 스케줄', Icon: CalendarClock, roles: ['System_Operator', 'Super_User'] },
  { to: '/mail/jobs', label: '메일 이력', Icon: Mail, roles: ['System_Operator', 'Super_User'] },
  { to: '/stats', label: '통계', Icon: BarChart3, roles: ['System_Operator'] },
  { to: '/monitoring/refresh', label: 'Refresh 현황', Icon: RefreshCw, roles: ['System_Operator'] },
  { to: '/monitoring/ops', label: '운영 상태', Icon: Activity, roles: ['System_Operator'] },
  { to: '/admin/users', label: '관리자', Icon: Users, roles: ['System_Operator'] },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)

  const roles = user?.roles ?? []
  const visibleNav = NAV.filter((n) => !n.roles || n.roles.some((r) => roles.includes(r)))

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
    </div>
  )
}
