/** 관리자 레이아웃 (T-38) — 상단 탭 네비 + 중첩 라우트 Outlet. */
import { NavLink, Outlet } from 'react-router-dom'
import { Users, UsersRound, ShieldCheck, CalendarOff } from 'lucide-react'

const tabs = [
  { to: '/admin/users', label: '사용자', Icon: Users },
  { to: '/admin/groups', label: '그룹', Icon: UsersRound },
  { to: '/admin/roles', label: '역할', Icon: ShieldCheck },
  { to: '/admin/holidays', label: '공휴일', Icon: CalendarOff },
]

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 pt-4">
        <h1 className="mb-3 text-xl font-bold text-slate-800">관리자</h1>
        <nav className="flex gap-1">
          {tabs.map(({ to, label, Icon }) => (
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
