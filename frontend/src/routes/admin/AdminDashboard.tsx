/** 관리자 콘솔 대시보드(랜딩, /admin) — 권한 있는 관리 기능으로 가는 카드 그리드. */
import { Link } from 'react-router-dom'

import { useAuthStore } from '@/stores/useAuthStore'
import { ADMIN_SECTIONS } from '@/routes/admin/adminNav'

export default function AdminDashboard() {
  const user = useAuthStore((s) => s.user)
  const isOperator = (user?.roles ?? []).includes('System_Operator')
  const allowed = user?.allowed_menus ?? []

  const items = ADMIN_SECTIONS
    .flatMap((s) => s.items)
    .filter((it) => isOperator || allowed.includes(it.menu))

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800">관리자 콘솔</h1>
      <p className="mt-1 text-sm text-slate-500">관리할 기능을 선택하세요.</p>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-slate-400">접근 가능한 관리 기능이 없습니다.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(({ to, label, Icon, desc }) => (
            <Link
              key={to}
              to={to}
              className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-400 hover:shadow-md"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 group-hover:text-blue-700">{label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
