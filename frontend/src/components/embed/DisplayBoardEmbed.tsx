/**
 * 전광판 전용 Power BI 임베드 (크롬 없는 전체화면 렌더).
 *
 * 레포트 뷰(`PowerBIEmbed`)와 달리 필터 패널·페이지 탐색을 감추고 화면을 꽉 채운다.
 * 무인 표시용이라 조작 요소가 필요 없고, 보이면 전광판 화면이 어수선해진다.
 *
 * 이벤트는 부모(플레이어)가 순환/복구 판단에 사용한다.
 *  - onLoaded: 레포트 메타 로드 완료. 이 시점부터 페이지 전환이 가능하다.
 *  - onRendered: 시각적 렌더 완료. 부모는 이때부터 노출 시간을 센다(로딩 중 시간을
 *    노출 시간으로 세면 실제로 보이는 시간이 짧아진다).
 *  - onError: 토큰 만료/렌더 실패. 부모가 토큰 재발급 또는 슬라이드 스킵을 결정한다.
 *
 * 부모가 1초 이하 주기로 재렌더되더라도 임베드가 다시 붙지 않도록 embedConfig의 객체
 * 동일성을 유지하고 memo로 감싼다. 콜백은 부모에서 useCallback으로 고정해 전달한다.
 */
import { memo, useMemo } from 'react'
import { PowerBIEmbed as ReactPowerBIEmbed } from 'powerbi-client-react'
import { models, type Embed, type Report } from 'powerbi-client'

import type { DisplayBoardEmbed as DisplayBoardEmbedInfo } from '@/types/display'

/** powerbi-client-react 이벤트 핸들러 시그니처. */
type EmbedEventHandler = (
  event?: { detail?: unknown },
  embeddedEntity?: Embed,
) => void

interface Props {
  embed: DisplayBoardEmbedInfo
  onReport?: (report: Report | null) => void
  onLoaded?: () => void
  onRendered?: () => void
  onError?: (detail: unknown) => void
}

function DisplayBoardEmbedBase({
  embed, onReport, onLoaded, onRendered, onError,
}: Props) {
  const eventHandlers = useMemo(
    () => new Map<string, EmbedEventHandler | null>([
      ['loaded', () => onLoaded?.()],
      ['rendered', () => onRendered?.()],
      ['error', (event) => onError?.(event?.detail)],
    ]),
    [onLoaded, onRendered, onError],
  )

  const embedConfig = useMemo(
    () => ({
      type: 'report',
      id: embed.reportId,
      embedUrl: embed.embedUrl,
      accessToken: embed.embedToken,
      tokenType: models.TokenType.Embed,
      settings: {
        layoutType: models.LayoutType.Custom,
        customLayout: { displayOption: models.DisplayOption.FitToPage },
        panes: {
          filters: { expanded: false, visible: false },
          pageNavigation: { visible: false },
        },
        background: models.BackgroundType.Default,
      },
    }),
    [embed.reportId, embed.embedUrl, embed.embedToken],
  )

  return (
    <ReactPowerBIEmbed
      embedConfig={embedConfig}
      cssClassName="h-full w-full"
      eventHandlers={eventHandlers}
      getEmbeddedComponent={(embedObject) => {
        onReport?.(embedObject as Report)
      }}
    />
  )
}

export default memo(DisplayBoardEmbedBase)
