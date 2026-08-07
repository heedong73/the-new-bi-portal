/**
 * Power BI Embedded 렌더링 래퍼 (T-37).
 *
 * powerbi-client-react 의 PowerBIEmbed 를 감싸 Report 한정 Embed Token으로
 * 레포트를 렌더링한다. master token/secret 은 백엔드에만 있고, 여기엔 단기
 * Embed Token만 전달된다(R9.4, R38).
 *
 * onReport: getEmbeddedComponent 로 잡은 Report 인스턴스를 부모에 노출하여
 * 보기 옵션(전체화면/페이지 맞춤/실제 크기) 제어를 가능하게 한다.
 */
import { PowerBIEmbed as ReactPowerBIEmbed } from 'powerbi-client-react'
import { models, type Report } from 'powerbi-client'
import type { EmbedInfo } from '@/types/report'

interface Props {
  embed: EmbedInfo
  /** 임베드된 Report 인스턴스 콜백 (보기 옵션 제어용). */
  onReport?: (report: Report | null) => void
  /** Power BI가 실제 화면을 처음 렌더링한 뒤 조회 세션을 시작하기 위한 콜백. */
  onRendered?: () => void
}

export default function PowerBIEmbed({ embed, onReport, onRendered }: Props) {
  return (
    <ReactPowerBIEmbed
      embedConfig={{
        type: 'report',
        id: embed.reportId,
        embedUrl: embed.embedUrl,
        accessToken: embed.embedToken,
        tokenType: models.TokenType.Embed,
        settings: {
          layoutType: models.LayoutType.Custom,
          customLayout: {
            displayOption: models.DisplayOption.FitToPage,
          },
          panes: {
            filters: { expanded: false, visible: false },
            pageNavigation: { visible: false },
          },
          background: models.BackgroundType.Default,
        },
      }}
      eventHandlers={new Map([
        ['rendered', () => onRendered?.()],
      ])}
      cssClassName="h-full w-full"
      getEmbeddedComponent={(embedObject) => {
        onReport?.(embedObject as Report)
      }}
    />
  )
}
