/** 개별 부여 가능한 메뉴 카탈로그 — 백엔드 GRANTABLE_MENU_CATALOG와 동일하게 유지한다.
 *
 * 정책:
 *  - "홈"과 "서비스 센터"는 로그인한 모든 사용자의 기본 메뉴라 부여/회수 대상이 아니다.
 *  - 관리자 계열, 운영 상태, Refresh 현황, 메일 이력/스케줄은 System_Operator 전용이므로
 *    개별 부여 대상이 아니다(백엔드 require_menu도 개별 부여로는 통과시키지 않는다).
 *  - 따라서 실제로 부여 여부를 결정할 메뉴는 "통계" 하나다.
 */
export const MENU_CATALOG: [string, string][] = [['stats', '통계']]
