/** KPI 전광판 타입 (백엔드 schemas/display_board.py와 대응). */

/** 노출 시간 허용 범위 — 백엔드 검증값과 동일하게 유지한다. */
export const MIN_DWELL_SECONDS = 5
export const MAX_DWELL_SECONDS = 3600
export const DEFAULT_DWELL_SECONDS = 30

/** 전광판 순환 단위(슬라이드). */
export interface DisplayBoardSlide {
  id: number
  report_id: number
  report_name: string
  /** Power BI 내부 섹션 id. null이면 레포트 기본 페이지. */
  page_name?: string | null
  /** 사람이 읽는 페이지 이름. */
  page_display_name?: string | null
  /** 실제 적용되는 노출 시간(개별 지정이 없으면 보드 기본값). */
  effective_dwell_seconds: number
  /** 개별 지정값. null이면 보드 기본값을 따른다. */
  dwell_seconds?: number | null
  sort_order: number
  is_enabled: boolean
  /** 현재 사용자가 이 레포트를 볼 권한이 있는지. */
  is_accessible: boolean
}

/** 전광판(플레이리스트). */
export interface DisplayBoard {
  id: number
  name: string
  description?: string | null
  is_active: boolean
  default_dwell_seconds: number
  slide_count: number
  /** 현재 사용자가 재생할 수 있는 슬라이드 수. */
  playable_slide_count: number
  /** 전체 1회 순환에 걸리는 시간(초). */
  total_cycle_seconds: number
  slides: DisplayBoardSlide[]
  created_by_label?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** 전광판 재생용 Embed 정보 (레포트 단위 토큰). */
export interface DisplayBoardEmbed {
  reportId: string
  embedUrl: string
  embedToken: string
  /** 토큰 만료 시각(ISO). mock 모드에서는 null. */
  expiry?: string | null
}

export interface DisplayBoardCreatePayload {
  name: string
  description?: string | null
  default_dwell_seconds?: number
}

export interface DisplayBoardUpdatePayload {
  name?: string
  description?: string | null
  is_active?: boolean
  default_dwell_seconds?: number
}

export interface DisplayBoardSlideCreatePayload {
  report_id: number
  page_name?: string | null
  page_display_name?: string | null
  dwell_seconds?: number | null
}

export interface DisplayBoardSlideUpdatePayload {
  page_name?: string | null
  page_display_name?: string | null
  dwell_seconds?: number | null
  is_enabled?: boolean
}

/** 초 단위 노출 시간을 사람이 읽는 문자열로. */
export function formatDwell(seconds: number): string {
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`
}

/** 슬라이드의 표시 라벨(레포트명 + 페이지). */
export function slideLabel(slide: DisplayBoardSlide): string {
  const page = slide.page_display_name?.trim()
  return page ? `${slide.report_name} · ${page}` : slide.report_name
}
