/** 관리자 콘솔 "요청 관리" — 서비스 센터와 동일한 통합 화면을 사용한다.
 *
 * 운영자는 전체 요청 목록을 보고, 상세 모달의 "관리자 처리"로 상태/완료예정일을
 * 설정한다(RequestDetailModal). 별도 UI를 두지 않고 ServiceCenterPage를 재사용. (R17)
 */
import ServiceCenterPage from '@/routes/requests/ServiceCenterPage'

export default function RequestAdminPage() {
  return <ServiceCenterPage />
}
