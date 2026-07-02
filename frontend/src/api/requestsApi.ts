/** 서비스 센터(요청) API 래퍼.
 *
 * - list/get/create: 인증된 모든 사용자(일반은 본인 요청만 반환)
 * - update: System_Operator 전용(상태 변경/응답/반려 사유)
 */
import apiClient, { request, API_BASE_URL } from '@/api/client'
import type {
  RequestAttachment,
  RequestComment,
  ServiceRequest,
  ServiceRequestCreate,
  ServiceRequestUpdate,
} from '@/types/request'

export const requestsApi = {
  list: (
    params: { status?: string; type?: string; q?: string } = {},
    signal?: AbortSignal,
  ) =>
    apiClient.get<ServiceRequest[]>('/api/requests', {
      query: { status: params.status, type: params.type, q: params.q },
      signal,
    }),
  get: (id: number, signal?: AbortSignal) =>
    apiClient.get<ServiceRequest>(`/api/requests/${id}`, { signal }),
  create: (body: ServiceRequestCreate) =>
    apiClient.post<ServiceRequest>('/api/requests', body),
  update: (id: number, body: ServiceRequestUpdate) =>
    request<ServiceRequest>(`/api/requests/${id}`, { method: 'PATCH', body }),

  /** 댓글 작성 (요청자 또는 운영자). */
  addComment: (requestId: number, body: string) =>
    apiClient.post<RequestComment>(`/api/requests/${requestId}/comments`, { body }),

  /** 첨부 업로드 (multipart). 브라우저가 Content-Type/boundary를 자동 설정. */
  uploadAttachment: (requestId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post<RequestAttachment>(`/api/requests/${requestId}/attachments`, form)
  },
  deleteAttachment: (attachmentId: number) =>
    request<void>(`/api/request-attachments/${attachmentId}`, { method: 'DELETE' }),

  /** 첨부 다운로드/미리보기 URL (권한 검증은 서버에서 수행). */
  attachmentUrl: (attachmentId: number) =>
    `${API_BASE_URL}/api/request-attachments/${attachmentId}`,
}
