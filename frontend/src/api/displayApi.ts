/** KPI 전광판 API 래퍼 — /api/display-boards.
 *
 * 재생용(list/detail/embed)은 로그인 사용자, 관리용(manage/생성/수정/삭제/슬라이드)은
 * System_Operator 전용이다(백엔드에서 강제).
 */
import apiClient, { request } from '@/api/client'
import type {
  DisplayBoard,
  DisplayBoardCreatePayload,
  DisplayBoardEmbed,
  DisplayBoardSlide,
  DisplayBoardSlideCreatePayload,
  DisplayBoardSlideUpdatePayload,
  DisplayBoardUpdatePayload,
} from '@/types/display'

export const displayBoardsApi = {
  /** GET /api/display-boards — 재생 가능한(활성 + 권한 있는 슬라이드 보유) 전광판 목록. */
  list: (signal?: AbortSignal) =>
    apiClient.get<DisplayBoard[]>('/api/display-boards', { signal }),

  /** GET /api/display-boards/manage — 관리용 전체 목록(비활성 포함, 슬라이드 상세 포함). */
  listForManage: (signal?: AbortSignal) =>
    apiClient.get<DisplayBoard[]>('/api/display-boards/manage', { signal }),

  /** GET /api/display-boards/{id} — 재생용 상세(권한 필터된 활성 슬라이드만). */
  get: (boardId: number, signal?: AbortSignal) =>
    apiClient.get<DisplayBoard>(`/api/display-boards/${boardId}`, { signal }),

  /** GET /api/display-boards/{id}/reports/{reportId}/embed — 슬라이드 재생용 Embed Token. */
  embed: (boardId: number, reportId: number, signal?: AbortSignal) =>
    apiClient.get<DisplayBoardEmbed>(
      `/api/display-boards/${boardId}/reports/${reportId}/embed`,
      { signal },
    ),

  /** POST /api/display-boards — 전광판 생성. */
  create: (body: DisplayBoardCreatePayload) =>
    apiClient.post<DisplayBoard>('/api/display-boards', body),

  /** PATCH /api/display-boards/{id} — 이름·설명·활성 여부·기본 노출 시간 수정. */
  update: (boardId: number, body: DisplayBoardUpdatePayload) =>
    request<DisplayBoard>(`/api/display-boards/${boardId}`, { method: 'PATCH', body }),

  /** DELETE /api/display-boards/{id} — 전광판 삭제(슬라이드 함께 삭제, 레포트는 유지). */
  remove: (boardId: number) =>
    request<void>(`/api/display-boards/${boardId}`, { method: 'DELETE' }),

  /** POST /api/display-boards/{id}/slides — 슬라이드를 맨 뒤에 추가. */
  addSlide: (boardId: number, body: DisplayBoardSlideCreatePayload) =>
    apiClient.post<DisplayBoardSlide>(`/api/display-boards/${boardId}/slides`, body),

  /** PATCH /api/display-boards/{id}/slides/{slideId} — 페이지·노출 시간·사용 여부 수정. */
  updateSlide: (boardId: number, slideId: number, body: DisplayBoardSlideUpdatePayload) =>
    request<DisplayBoardSlide>(`/api/display-boards/${boardId}/slides/${slideId}`, {
      method: 'PATCH',
      body,
    }),

  /** PUT /api/display-boards/{id}/slides/reorder — 전체 순서 변경(모든 슬라이드 id 전달). */
  reorderSlides: (boardId: number, slideIds: number[]) =>
    apiClient.put<void>(`/api/display-boards/${boardId}/slides/reorder`, {
      slide_ids: slideIds,
    }),

  /** DELETE /api/display-boards/{id}/slides/{slideId} — 슬라이드 삭제. */
  removeSlide: (boardId: number, slideId: number) =>
    request<void>(`/api/display-boards/${boardId}/slides/${slideId}`, { method: 'DELETE' }),
}
