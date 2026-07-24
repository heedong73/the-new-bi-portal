/** 관리자 콘솔 메뉴 정의 — 콘솔 사이드바와 대시보드 카드가 공유한다.
 *
 * 각 항목은 menu 권한 키로 노출 필터된다(System_Operator는 전체).
 * URL은 기존 그대로 유지(/admin/*, /mail/*, /monitoring/*).
 */
import {
  FileBarChart, Users, UsersRound, ShieldCheck,
  CalendarClock, Mail, CalendarOff, RefreshCw, Activity, Inbox, History,
} from 'lucide-react'

export interface AdminItem {
  to: string
  label: string
  Icon: typeof Users
  menu: string
  desc: string
}

export interface AdminSection {
  title: string
  items: AdminItem[]
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    title: '콘텐츠',
    items: [
      { to: '/admin/reports', label: '레포트 관리', Icon: FileBarChart, menu: 'admin_reports', desc: '레포트 게시·폴더·권한·교체' },
    ],
  },
  {
    title: '사용자·권한',
    items: [
      { to: '/admin/users', label: '사용자', Icon: Users, menu: 'admin_users', desc: '사용자 조회·역할 부여' },
      { to: '/admin/groups', label: '그룹', Icon: UsersRound, menu: 'admin_groups', desc: '권한 그룹 관리' },
      { to: '/admin/permissions', label: '권한 관리', Icon: ShieldCheck, menu: 'admin_groups', desc: '그룹별 메뉴·계열사·레포트 권한' },
    ],
  },
  {
    title: '메일',
    items: [
      { to: '/mail/schedules', label: '메일 스케줄', Icon: CalendarClock, menu: 'mail_schedules', desc: '정기 발송 스케줄' },
      { to: '/mail/jobs', label: '메일 이력', Icon: Mail, menu: 'mail_jobs', desc: '발송 이력·재시도' },
      { to: '/admin/holidays', label: '공휴일', Icon: CalendarOff, menu: 'admin_holidays', desc: '발송 제외 공휴일' },
    ],
  },
  {
    title: '운영',
    items: [
      { to: '/monitoring/refresh', label: 'Refresh 현황', Icon: RefreshCw, menu: 'monitoring_refresh', desc: '새로고침 실행 현황' },
      { to: '/monitoring/ops', label: '운영 상태', Icon: Activity, menu: 'monitoring_ops', desc: 'DB·Redis·워커 상태' },
      { to: '/admin/audit-logs', label: '감사 로그', Icon: History, menu: 'audit_logs', desc: '시스템 사용자 활동 이력' },
    ],
  },
  {
    title: '서비스 센터',
    items: [
      { to: '/admin/requests', label: '요청 관리', Icon: Inbox, menu: 'admin_requests', desc: '문의·에러 요청 처리/반려' },
    ],
  },
]

/** '관리자 콘솔' 노출 판정용 메뉴 키 목록 (하나라도 권한 있으면 콘솔 진입 가능). */
export const ADMIN_GROUP_MENUS: string[] = ADMIN_SECTIONS.flatMap((s) => s.items.map((i) => i.menu))

/** 권한에 따라 섹션/항목 필터 (System_Operator는 전체). 빈 섹션은 제거. */
export function visibleAdminSections(isOperator: boolean, allowedMenus: string[]): AdminSection[] {
  return ADMIN_SECTIONS
    .map((sec) => ({ ...sec, items: sec.items.filter((it) => isOperator || allowedMenus.includes(it.menu)) }))
    .filter((sec) => sec.items.length > 0)
}
