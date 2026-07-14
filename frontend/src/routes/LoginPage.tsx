/**
 * 로그인 화면 (T-35).
 *
 * - BI 일러스트 배경 이미지(/login-bg.png). 우측 흰 영역 위에 밝은 로그인 카드 배치.
 * - 사번(Employee ID)/비밀번호 입력, 비밀번호 표시/숨김 토글
 * - 로컬 관리자 로그인 보조 링크(모드 전환)
 * - 401 등 실패 시 한국어 오류 표시
 * 요구사항: R1, R2, R28
 *
 * 배경 이미지: frontend/public/login-bg.png. 파일이 없으면 밝은 배경으로 fallback.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Eye, EyeOff, Lock, User, Cloud } from 'lucide-react'

import { authApi } from '@/api/authApi'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/useAuthStore'
import type { LoginResponse } from '@/types/auth'

type Mode = 'hr' | 'local'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.errorDescription ?? error.message
  }
  return '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)

  const [mode, setMode] = useState<Mode>('hr')
  const [identifier, setIdentifier] = useState('') // 사번 또는 관리자 아이디
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const mutation = useMutation<LoginResponse, unknown, void>({
    mutationFn: () =>
      mode === 'hr'
        ? authApi.login({ emp_no: identifier.trim(), password })
        : authApi.localLogin({ username: identifier.trim(), password }),
    onSuccess: (data) => {
      setUser(data.user)
      navigate('/', { replace: true })
    },
  })

  const isHr = mode === 'hr'
  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !mutation.isPending
  const idLabel = isHr ? 'ID' : 'Admin ID'
  const idPlaceholder = isHr ? '사번' : '관리자 아이디'

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    mutation.mutate()
  }

  function switchMode(next: Mode) {
    setMode(next)
    mutation.reset()
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950">
      {/* 레터박스 여백을 흐린 이미지로 메움(보조 배경, 잘려도 무방).
          우클릭 시 브라우저 기본 이미지 저장/복사 메뉴가 뜨지 않도록 컨텍스트 메뉴 차단. */}
      <div
        className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl"
        style={{ backgroundImage: "url('/login-bg.png')" }}
        aria-hidden="true"
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* 비율 유지 전체 이미지(절대 잘리지 않음) + 우측 유리창 위 카드 */}
      <div className="relative flex min-h-screen items-center justify-center">
        <div className="relative max-h-screen">
          <img
            src="/login-bg.png"
            alt=""
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="block max-h-screen w-auto max-w-full select-none [-webkit-user-drag:none]"
          />
          {/* 카드: 우측 파란 유리창 중앙 (이미지 비율에 맞춰 같이 축소) */}
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: '82.5%', top: '50%', width: 'clamp(240px, 30%, 380px)' }}>
            <div className="w-full rounded-2xl border border-white/60 bg-white p-6 shadow-2xl shadow-blue-950/40 ring-1 ring-black/5">
          {/* 헤더 */}
          <div className="mb-7 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30">
              <Cloud className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-wide text-slate-800">SCL BI PORTAL</h1>
            <p className="mt-1 text-sm text-slate-500">
              삼천리 BI Portal에서 레포트를<br />공유하고 인사이트를 얻어보세요
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* 아이디/사번 */}
            <div>
              <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium text-slate-700">
                {idLabel}
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={idPlaceholder}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
            </div>

            {/* 비밀번호 + 표시/숨김 토글 */}
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="그룹웨어 비밀번호"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-11 text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 오류 메시지 */}
            {mutation.isError && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {errorMessage(mutation.error)}
              </p>
            )}

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 py-2.5 font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:from-blue-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? '로그인 중…' : 'Login'}
            </button>
          </form>

          {/* 모드 전환 보조 링크 */}
          <div className="mt-5 text-center">
            {isHr ? (
              <button
                type="button"
                onClick={() => switchMode('local')}
                className="text-sm text-slate-500 underline-offset-4 transition hover:text-blue-600 hover:underline"
              >
                로컬 관리자로 로그인
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('hr')}
                className="text-sm text-slate-500 underline-offset-4 transition hover:text-blue-600 hover:underline"
              >
                사번 로그인으로 돌아가기
              </button>
            )}
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
