/** 관리자 레이아웃 (T-38) — 상단 탭 네비 + 중첩 라우트 Outlet. 메뉴 권한으로 탭 필터. */
import { NavLink, Outlet } from 'react-router-dom'
import { Users, UsersRound, ShieldCheck, CalendarOff, FileBarChart } from 'lucide-react'

import { useAuthStore } from '@/stores/useAuthStore'

const tabs = [
  { to: '/admin/reports', label: '레포트', Icon: FileBarChart, menu: 'admin_reports' },
  { to: '/admin/users', label: '사용자', Icon: Users, menu: 'admin_users' },
  { to: '/admin/groups', label: '그룹', Icon: UsersRound, menu: 'admin_groups' },
  { to: '/admin/roles', label: '역할', Icon: ShieldCheck, menu: 'admin_roles' },
  { to: '/admin/holidays', label: '공휴일', Icon: CalendarOff, menu: 'admin_holidays' },
]

export default function AdminLayout() {
  const user = useAuthStore((s) => s.user)
  const isOperator = (user?.roles ?? []).includes('System_Operator')
  const allowed = user?.allowed_menus ?? []
  const visibleTabs = tabs.filter((t) => isOperator || allowed.includes(t.menu))
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 pt-4">
        <h1 className="mb-3 text-xl font-bold text-slate-800">관리자</h1>
        <nav className="flex gap-1">
          {visibleTabs.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
