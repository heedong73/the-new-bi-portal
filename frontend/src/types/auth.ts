/** 인증 도메인 타입 (백엔드 schemas/auth.py 와 대응). */

/** 현재 사용자 요약 (응답용, 비밀번호/해시 미포함). */
export interface UserSummary {
  id: number
  emp_no: string
  name: string
  email?: string | null
  department_id?: number | null
  roles: string[]
}

/** 로그인 성공 응답. */
export interface LoginResponse {
  user: UserSummary
}

/** 사번 로그인 요청. */
export interface LoginRequest {
  emp_no: string
  password: string
}

/** 로컬 관리자 로그인 요청. */
export interface LocalLoginRequest {
  username: string
  password: string
}
