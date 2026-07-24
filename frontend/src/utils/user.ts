/** 사용자 정보(역할 라벨, 마지막 접속일시) 표시 유틸 — 일반/관리자 레이아웃 공용. */

/** roles 배열을 화면에 노출할 단일 등급 라벨로 축약한다(우선순위: 운영자 > 파워 > 일반). */
export function userRoleLabel(roles: readonly string[]): '일반 사용자' | '파워 사용자' | '시스템 운영자' {
  if (roles.includes('System_Operator')) return '시스템 운영자'
  if (roles.includes('Super_User')) return '파워 사용자'
  return '일반 사용자'
}

/**
 * 직전 로그인 시각(UTC ISO)을 우측 상단 사용자 정보에 노출할 짧은 문자열로 포맷한다.
 * 최초 로그인(값 없음)이면 null을 반환해 호출부가 표시를 생략하게 한다.
 */
export function formatLastLogin(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' })
}
