/**
 * Power BI Embedded 렌더링 래퍼 (T-37).
 *
 * powerbi-client-react 의 PowerBIEmbed 를 감싸 Report 한정 Embed Token으로
 * 레포트를 렌더링한다. master token/secret 은 백엔드에만 있고, 여기엔 단기
 * Embed Token만 전달된다(R9.4, R38).
 */
import { PowerBIEmbed as ReactPowerBIEmbed } from 'powerbi-client-react'
import { models } from 'powerbi-client'
import type { EmbedInfo } from '@/types/report'

interface Props {
  embed: EmbedInfo
}

export default function PowerBIEmbed({ embed }: Props) {
  return (
    <ReactPowerBIEmbed
      embedConfig={{
        type: 'report',
        id: embed.reportId,
        embedUrl: embed.embedUrl,
        accessToken: embed.embedToken,
        tokenType: models.TokenType.Embed,
        settings: {
          panes: {
            filters: { expanded: false, visible: true },
            pageNavigation: { visible: true },
          },
          background: models.BackgroundType.Transparent,
        },
      }}
      cssClassName="h-full w-full"
    />
  )
}
