/**
 * 화면 절전 방지 (Screen Wake Lock API).
 *
 * KPI 전광판처럼 무인으로 장시간 켜 두는 화면에서 OS 절전으로 모니터가 꺼지는 것을
 * 막는다. 지원하지 않는 브라우저(또는 비 HTTPS 환경)에서는 조용히 무시한다 —
 * 전광판 재생 자체는 이 기능 없이도 정상 동작해야 한다.
 *
 * 브라우저가 탭 비활성 시 wake lock을 자동 해제하므로, 다시 보이게 되면 재획득한다.
 */
import { useEffect } from 'react'

/** navigator.wakeLock 최소 타입 (표준 lib.dom.d.ts에 없는 환경 대비). */
interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

function getWakeLock(): WakeLockLike | null {
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
  return candidate ?? null
}

/**
 * enabled가 true인 동안 화면 절전을 막는다.
 * @returns 없음. 실패는 무시한다(기능 없는 환경에서도 동작해야 하므로).
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const wakeLock = getWakeLock()
    if (!wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let disposed = false

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      try {
        sentinel = await wakeLock.request('screen')
      } catch {
        // 사용자 설정/정책으로 거부될 수 있다. 재생에는 영향 없음.
        sentinel = null
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (sentinel && !sentinel.released) {
        sentinel.release().catch(() => { /* noop */ })
      }
      sentinel = null
    }
  }, [enabled])
}

export default useWakeLock
