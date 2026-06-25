/** 인증 API 래퍼 — /api/auth (로그인/로그아웃/현재 사용자). */
import apiClient, { request } from '@/api/client'
import type {
  LocalLoginRequest,
  LoginRequest,
  LoginResponse,
  UserSummary,
} from '@/types/auth'

export const authApi = {
  /** 사번/비밀번호 로그인. 실패 시 ApiError(401). */
  login: (body: LoginRequest) =>
    apiClient.post<LoginResponse>('/api/auth/login', body),

  /** 로컬 관리자 로그인 (비상). */
  localLogin: (body: LocalLoginRequest) =>
    apiClient.post<LoginResponse>('/api/auth/local/login', body),

  /** 현재 로그인 사용자 조회. 미인증 시 ApiError(401). */
  me: () => apiClient.get<UserSummary>('/api/auth/me'),

  /** 로그아웃 (세션 무효화 + 쿠키 삭제). */
  logout: () => request<{ status: string }>('/api/auth/logout', { method: 'POST' }),
}

export default authApi
