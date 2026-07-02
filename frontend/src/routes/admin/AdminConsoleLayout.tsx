/** 관리자 콘솔 셸 (전용 전체화면 레이아웃).
 *
 * 일반 포털(AppLayout)과 분리된 운영자 전용 화면. 좌측 섹션 사이드바 +
 * 상단 헤더('사용자 화면으로' 복귀 / 사용자 / 로그아웃) + 본문 Outlet.
 * /admin/* · /mail/* · /monitoring/* 가 이 셸 안에서 렌더된다(URL 유지).
 */
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogOut } from 'lucide-react'

import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { visibleAdminSections } from '@/routes/admin/adminNav'
import BackgroundTaskDock from '@/components/BackgroundTaskDock'

export default function AdminConsoleLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clear = useAuthStore((s) => s.clear)

  const isOperator = (user?.roles ?? []).includes('System_Operator')
  const sections = visibleAdminSections(isOperator, user?.allowed_menus ?? [])

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
      {/* 콘솔 사이드바 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="삼천리 로고" className="h-8 w-8 shrink-0 object-contain" />
            <span className="text-base font-bold tracking-tight text-slate-800">관리자 콘솔</span>
          </div>
          <Link
            to="/"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition hover:text-blue-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            사용자 화면으로
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          {sections.map((sec) => (
            <div key={sec.title} className="mb-2">
              <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {sec.title}
              </div>
              {sec.items.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/admin/reports'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* 본문 영역 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            사용자 화면으로
          </Link>
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

        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>

      <BackgroundTaskDock />
    </div>
  )
}
