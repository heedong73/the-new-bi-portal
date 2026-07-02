import { useEffect } from 'react'

/**
 * 작업이 진행 중일 때 페이지 이탈(새로고침/탭 닫기)을 막는 가드.
 *
 * 파일 업로드처럼 진행 중인 HTTP 요청은 새로고침하면 취소되어 작업이 중단된다.
 * 새로고침을 "한 뒤"에는 되살릴 수 없으므로, `active`인 동안 브라우저 기본
 * 확인 대화상자를 띄워 실수로 이탈하는 것을 막는다(사용자가 취소하면 업로드 유지).
 *
 * @param active true인 동안 이탈 경고를 활성화
 */
export function useBeforeUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Chrome 등에서 확인 대화상자를 띄우기 위해 returnValue 설정 필요(문구는 브라우저 고정).
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
