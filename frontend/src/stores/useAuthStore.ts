/** 인증 상태 스토어 (zustand). 현재 로그인 사용자 보관. */
import { create } from 'zustand'
import type { UserSummary } from '@/types/auth'

interface AuthState {
  user: UserSummary | null
  /** 로그인 성공/me 조회 시 사용자 설정. */
  setUser: (user: UserSummary | null) => void
  /** 로그아웃 시 초기화. */
  clear: () => void
  /** 특정 역할 보유 여부. */
  hasRole: (role: string) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
  hasRole: (role) => get().user?.roles.includes(role) ?? false,
}))
