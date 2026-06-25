import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Activity,
  ListFilter,
  ScrollText,
  BarChart3,
  Database,
  TrendingUp,
  Settings,
  Plug,
  Bell,
  Users,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import ko from "../../i18n/ko";

/**
 * 좌측 사이드바 (Requirement 12.1).
 *
 * - ko.sidebar.groups 의 4개 그룹(대시보드/모니터링/분석/설정)과 하위 메뉴를
 *   한국어로 렌더한다. 라벨/경로는 i18n(ko.ts)에서 가져오며 하드코딩하지 않는다.
 * - design.md "라우팅 ↔ 사이드바 매핑" 표대로 react-router NavLink 로 경로를
 *   연결하고 active 상태를 시각적으로 강조한다.
 * - lucide-react 아이콘을 각 메뉴 경로에 매핑한다.
 *
 * 아이콘은 표시 전용(presentational)이므로 i18n 라벨과 분리하여 경로 기준으로
 * 이 컴포넌트에서 매핑한다.
 */

/** 메뉴 경로 → lucide 아이콘 매핑 */
const ITEM_ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/monitoring/status": Activity,
  "/monitoring/detail": ListFilter,
  "/monitoring/log": ScrollText,
  "/analytics/stats": BarChart3,
  "/analytics/throughput": Database,
  "/analytics/top-n": TrendingUp,
  "/settings/connection": Plug,
  "/settings/notification": Bell,
  "/settings/user": Users,
};

/** 그룹 라벨 → lucide 아이콘 매핑 (그룹 헤더 장식용) */
const GROUP_ICONS: Record<string, LucideIcon> = {
  대시보드: LayoutDashboard,
  모니터링: Activity,
  분석: BarChart3,
  설정: Settings,
};

export default function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200">
      {/* 브랜드 영역 */}
      <div className="flex h-14 items-center gap-2 border-b border-slate-800 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-yellow-400 text-slate-900">
          <Gauge className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="text-sm font-bold tracking-tight text-white">
          {ko.app.title}
        </span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {ko.sidebar.groups.map((group) => {
          const GroupIcon = GROUP_ICONS[group.label];
          return (
            <div key={group.label} className="mb-5">
              <p className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {GroupIcon && <GroupIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                {group.label}
              </p>
              <div className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const ItemIcon = ITEM_ICONS[item.path];
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive
                            ? "bg-slate-800 font-medium text-white shadow-[inset_2px_0_0_0] shadow-yellow-400"
                            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                        }`
                      }
                    >
                      {ItemIcon && (
                        <ItemIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
