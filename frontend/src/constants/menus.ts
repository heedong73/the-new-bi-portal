/** 메뉴(페이지) 카탈로그 — 백엔드 app/core/constants.py의 MENU_CATALOG와 동일하게 유지한다.
 *
 * 권한 관리 화면에서 그룹/사용자에게 부여 가능한 메뉴 목록으로 사용한다.
 * "홈"은 모든 사용자의 기본 메뉴라 목록에 포함하지 않는다(항상 접근 가능하므로
 * 부여/회수 대상이 아님).
 */
export const MENU_CATALOG: [string, string][] = [
  ['stats', '통계'],
  ['mail_schedules', '메일 스케줄'],
  ['mail_jobs', '메일 이력'],
  ['monitoring_refresh', 'Refresh 현황'],
  ['monitoring_ops', '운영 상태'],
  ['admin_reports', '관리자 · 레포트 관리'],
  ['admin_users', '관리자 · 사용자'],
  ['admin_groups', '관리자 · 그룹'],
  ['admin_holidays', '관리자 · 공휴일'],
  ['audit_logs', '관리자 · 감사 로그'],
]
