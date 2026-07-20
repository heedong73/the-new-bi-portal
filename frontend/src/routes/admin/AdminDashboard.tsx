/** 관리자 콘솔 대시보드 — 권한 있는 관리 기능으로 가는 편집형 랜딩. */
import { Link } from 'react-router-dom'

import { useAuthStore } from '@/stores/useAuthStore'
import { ADMIN_SECTIONS } from '@/routes/admin/adminNav'

export default function AdminDashboard() {
  const user = useAuthStore((state) => state.user)
  const isOperator = (user?.roles ?? []).includes('System_Operator')
  const allowed = user?.allowed_menus ?? []

  const items = ADMIN_SECTIONS
    .flatMap((section) => section.items)
    .filter((item) => isOperator || allowed.includes(item.menu))

  return (
    <div className="editorial-admin-dashboard">
      <div className="editorial-page-heading">
        <p className="editorial-page-kicker">System Operations</p>
        <h1 className="editorial-compact-page-title">관리자 콘솔</h1>
        <p>운영 현황을 확인하고 리포트, 사용자, 권한 및 자동화 작업을 한 흐름으로 관리하세요.</p>
      </div>

      {items.length === 0 ? (
        <div className="editorial-empty-state mt-8 px-6 py-16 text-center text-sm text-slate-500">
          현재 접근 가능한 관리 기능이 없습니다.
        </div>
      ) : (
        <div className="editorial-admin-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(({ to, label, Icon, desc }) => (
            <Link
              key={to}
              to={to}
              className="editorial-admin-card group flex items-start gap-3 border p-5 transition"
            >
              <div className="editorial-admin-card__icon flex h-11 w-11 shrink-0 items-center justify-center transition group-hover:bg-blue-100">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 transition group-hover:text-blue-700">{label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
