/** 서비스 센터(요청) 타입 — 백엔드 /api/requests 응답/요청과 1:1 매핑. (R17) */

export type RequestType = 'inquiry' | 'error' | 'improvement'
export type RequestStatus = 'pending' | 'received' | 'rejected' | 'done'

/** 첨부 파일 메타 (파일 본체는 다운로드 엔드포인트로 제공). */
export interface RequestAttachment {
  id: number
  request_id: number
  file_name: string
  mime_type: string | null
  file_size: number | null
  is_image: boolean
  created_at: string
}

/** 댓글(대화) 1건. */
export interface RequestComment {
  id: number
  request_id: number
  author_user_id: number | null
  author_label: string | null
  is_operator: boolean
  body: string
  created_at: string
}

/** 요청 단건 (RequestResponse). */
export interface ServiceRequest {
  id: number
  requester_id: number
  requester_name: string | null
  requester_department: string | null
  request_type: RequestType
  title: string
  body: string | null
  status: RequestStatus
  operator_response: string | null
  reject_reason: string | null
  expected_completion_date: string | null
  created_at: string
  updated_at: string
  attachments: RequestAttachment[]
  comments: RequestComment[]
}

/** 생성 요청 (RequestCreate). */
export interface ServiceRequestCreate {
  request_type: RequestType
  title: string
  body: string
}

/** 상태 변경/응답/반려/완료예정일 (RequestUpdate, 운영자). */
export interface ServiceRequestUpdate {
  status?: RequestStatus
  operator_response?: string | null
  reject_reason?: string | null
  expected_completion_date?: string | null
}

/** 유형 표시 라벨. */
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  inquiry: '문의',
  error: '에러',
  improvement: '개선요청',
}

/** 상태 표시 라벨. */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: '대기',
  received: '접수',
  rejected: '반려',
  done: '완료',
}

/** 상태별 배지 스타일(Tailwind). */
export const REQUEST_STATUS_CLS: Record<RequestStatus, string> = {
  pending: 'bg-indigo-50 text-indigo-600',
  received: 'bg-blue-50 text-blue-700',
  rejected: 'bg-red-50 text-red-700',
  done: 'bg-green-50 text-green-700',
}

/** 상태별 점(dot) 색상. */
export const REQUEST_STATUS_DOT: Record<RequestStatus, string> = {
  pending: 'bg-indigo-400',
  received: 'bg-blue-500',
  rejected: 'bg-red-500',
  done: 'bg-green-500',
}

/** 관리자 상태 변경 선택지 (대기는 초기값이라 제외). */
export const ADMIN_STATUS_OPTIONS: RequestStatus[] = ['received', 'rejected', 'done']

/** 바이트 크기를 사람이 읽는 문자열로. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
