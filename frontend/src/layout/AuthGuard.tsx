/**
 * 인증 가드 — 보호 라우트 진입 시 세션을 확인한다.
 *
 * 세션은 httponly 쿠키라 새로고침하면 zustand 상태가 초기화되므로, GET /api/auth/me
 * 로 재확인하여 스토어를 복원한다. 미인증(401)이면 /login 으로 보낸다.
 */
import { Navigate, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { authApi } from '@/api/authApi'
import { useAuthStore } from '@/stores/useAuthStore'

export default function AuthGuard() {
  const setUser = useAuthStore((s) => s.setUser)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    retry: false,
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        확인 중…
      </div>
    )
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />
  }

  // 스토어 복원 (사이드바/헤더에서 역할·이름 사용)
  if (useAuthStore.getState().user?.id !== data.id) {
    setUser(data)
  }

  return <Outlet />
}
