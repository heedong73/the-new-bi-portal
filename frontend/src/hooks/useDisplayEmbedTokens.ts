/**
 * 전광판 재생용 Embed Token 캐시 (레포트 단위).
 *
 * 장시간(수 시간~수 일) 무인 재생을 전제로 다음을 처리한다.
 *  - 레포트 단위 캐시: 같은 레포트의 여러 페이지를 순환할 때 토큰을 재사용한다.
 *  - 동시 요청 합치기: 같은 레포트에 대한 in-flight 요청은 하나로 묶는다.
 *  - 만료 전 선제 재발급: 만료 REFRESH_MARGIN_MS 이전이면 캐시를 무효로 본다.
 *  - 실패 시 지수 백오프 재시도: 네트워크 단절이 회복되면 스스로 복구한다.
 *
 * 캐시는 ref에 두고, 화면에 필요한 정보(마지막 오류·연속 실패 수)만 state로 노출해
 * 재렌더를 최소화한다. 모든 공개 함수는 렌더가 아닌 이펙트/타이머/이벤트에서 호출한다.
 */
import { useCallback, useRef, useState } from 'react'

import { displayBoardsApi } from '@/api/displayApi'
import type { DisplayBoardEmbed } from '@/types/display'

/** 만료 이 시간 전부터는 새 토큰을 받는다(렌더 도중 만료되는 것을 방지). */
const REFRESH_MARGIN_MS = 5 * 60_000
/** 재시도 백오프 하한/상한. */
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000

interface TokenEntry {
  embed: DisplayBoardEmbed
  /** 만료 시각(ms). 서버가 expiry를 주지 않는 mock 모드에서는 null. */
  expiresAtMs: number | null
}

export interface EmbedTokenState {
  /** 캐시된 토큰을 반환하거나 새로 발급한다. force=true면 캐시를 무시한다. */
  ensureToken: (reportId: number, force?: boolean) => Promise<DisplayBoardEmbed>
  /** 토큰 만료/오류 시 해당 레포트 캐시를 버린다. */
  invalidate: (reportId: number) => void
  /** 만료가 임박(또는 캐시 없음)한지. 재발급 트리거 판단에 사용한다. */
  isExpiring: (reportId: number) => boolean
  /** 마지막 토큰 발급 실패 메시지(성공하면 null). */
  lastError: string | null
  /** 연속 실패 횟수. 재연결 안내 표시에 사용한다. */
  failureCount: number
}

function expiryToMs(expiry: string | null | undefined): number | null {
  if (!expiry) return null
  const parsed = new Date(expiry).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function isFresh(entry: TokenEntry | undefined): entry is TokenEntry {
  if (!entry) return false
  if (entry.expiresAtMs == null) return true // mock 모드: 만료 개념 없음
  return entry.expiresAtMs - Date.now() > REFRESH_MARGIN_MS
}

export function useDisplayEmbedTokens(boardId: number): EmbedTokenState {
  const cacheRef = useRef<Map<number, TokenEntry>>(new Map())
  const inFlightRef = useRef<Map<number, Promise<DisplayBoardEmbed>>>(new Map())
  const failureCountRef = useRef(0)
  const boardIdRef = useRef(boardId)
  const [lastError, setLastError] = useState<string | null>(null)
  const [failureCount, setFailureCount] = useState(0)

  /**
   * 보드가 바뀌면 캐시를 버린다(보드별 발급 범위가 다르다).
   * 렌더 중이 아니라 실제 토큰 요청/점검 시점에 확인해 이펙트 내 setState를 피한다.
   */
  const syncBoard = useCallback(() => {
    if (boardIdRef.current === boardId) return
    boardIdRef.current = boardId
    cacheRef.current.clear()
    inFlightRef.current.clear()
    failureCountRef.current = 0
  }, [boardId])

  const isExpiring = useCallback((reportId: number): boolean => {
    syncBoard()
    return !isFresh(cacheRef.current.get(reportId))
  }, [syncBoard])

  const invalidate = useCallback((reportId: number) => {
    cacheRef.current.delete(reportId)
  }, [])

  const ensureToken = useCallback(
    (reportId: number, force = false): Promise<DisplayBoardEmbed> => {
      syncBoard()
      if (!force) {
        const cached = cacheRef.current.get(reportId)
        if (isFresh(cached)) return Promise.resolve(cached.embed)
        const pending = inFlightRef.current.get(reportId)
        if (pending) return pending
      }

      const fetchWithRetry = async (): Promise<DisplayBoardEmbed> => {
        let attempt = 0
        // 무인 운영이므로 포기하지 않고 백오프로 계속 시도한다.
        // 호출부가 언마운트되면 Promise 결과는 버려진다.
        for (;;) {
          try {
            const embed = await displayBoardsApi.embed(boardId, reportId)
            cacheRef.current.set(reportId, {
              embed,
              expiresAtMs: expiryToMs(embed.expiry),
            })
            failureCountRef.current = 0
            setFailureCount(0)
            setLastError(null)
            return embed
          } catch (error) {
            attempt += 1
            failureCountRef.current += 1
            setFailureCount(failureCountRef.current)
            const description = (error as { errorDescription?: string })?.errorDescription
            const status = (error as { status?: number })?.status
            setLastError(
              description
                ?? (error instanceof Error ? error.message : '표시 정보를 가져오지 못했습니다.'),
            )
            // 권한 없음/삭제됨은 재시도해도 달라지지 않는다 — 즉시 실패로 알린다.
            if (status === 403 || status === 404) throw error
            const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS)
            await new Promise((resolve) => window.setTimeout(resolve, delay))
          }
        }
      }

      const promise = fetchWithRetry().finally(() => {
        inFlightRef.current.delete(reportId)
      })
      inFlightRef.current.set(reportId, promise)
      return promise
    },
    [boardId, syncBoard],
  )

  return { ensureToken, invalidate, isExpiring, lastError, failureCount }
}

export default useDisplayEmbedTokens
