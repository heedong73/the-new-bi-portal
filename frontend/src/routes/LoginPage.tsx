import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  User,
} from 'lucide-react'

import { authApi } from '@/api/authApi'
import { ApiError } from '@/api/client'
import AnalyticsBackground from '@/components/login/AnalyticsBackground'
import { useAuthStore } from '@/stores/useAuthStore'
import type { LoginResponse } from '@/types/auth'
import './LoginPage.css'

function errorMessage(error: unknown): string {
  const fallback = '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.'

  if (!(error instanceof ApiError)) return fallback

  if (error.status === 0 || error.errorCode === 'NETWORK_ERROR') {
    return '로그인 서비스에 연결할 수 없습니다. 사내망 연결 상태를 확인한 후 다시 시도해 주세요.'
  }

  if (error.status === 401) {
    // 인증 API에서 의도적으로 내려준 사용자용 메시지(잘못된 인증 정보, 비활성 계정)는 유지한다.
    return error.errorCode === 'UNAUTHENTICATED' && error.errorDescription
      ? error.errorDescription
      : '사번 또는 비밀번호가 올바르지 않습니다.'
  }

  if (error.status === 403) {
    return '로그인이 허용되지 않은 계정입니다. 관리자에게 문의해 주세요.'
  }

  if (error.status === 400 || error.status === 422 || error.errorCode === 'VALIDATION_ERROR') {
    return '입력하신 사번과 비밀번호를 다시 확인해 주세요.'
  }

  if (error.status === 429) {
    return '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.'
  }

  if (error.status === 404) {
    return '로그인 서비스를 찾을 수 없습니다. 관리자에게 문의해 주세요.'
  }

  if (error.status >= 500 || error.errorCode === 'PARSE_ERROR') {
    return '로그인 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  }

  return fallback
}

export default function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.setUser)

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const mutation = useMutation<LoginResponse, unknown, void>({
    mutationFn: () => authApi.login({ emp_no: identifier.trim(), password }),
    onSuccess: (data) => {
      setUser(data.user)
      navigate('/', { replace: true })
    },
  })

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !mutation.isPending

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    mutation.mutate()
  }

  return (
    <div className="login-page">
      <AnalyticsBackground />

      <header className="login-brand" aria-label="SCL BI Portal">
        <span className="login-brand__mark">
          <img src="/logo.png" alt="삼천리 로고" />
        </span>
        <span className="login-brand__copy">
          <small>SAMCHULLY GROUP</small>
          <strong>SCL BI PORTAL</strong>
        </span>
      </header>

      <section className="login-story" aria-label="SCL BI Portal 소개">
        <span className="login-story__edition">FROM DATA TO DECISIONS</span>
        <p className="login-story__eyebrow">
          <span /> Business Intelligence Workspace
        </p>
        <h2>
          데이터가
          <br />
          <em>더 나은 결정</em>이 되는 곳.
        </h2>
        <p className="login-story__description">
          하나의 공간에서 리포트를 발견하고 공유하며,
          <br />
          비즈니스의 다음 인사이트를 연결하세요.
        </p>

        <div className="login-data-flow" aria-hidden="true">
          <div className="login-data-flow__chart">
            <svg viewBox="0 0 600 120" preserveAspectRatio="none">
              <path
                d="M0 96 C58 82 78 93 128 67 S212 72 258 48 S345 70 397 36 S486 44 530 18 S572 26 600 6"
                fill="none"
                stroke="#087fa9"
                strokeWidth="1.5"
              />
              <path
                d="M0 107 H600 M0 70 H600 M0 33 H600"
                fill="none"
                stroke="#1a4b5b"
                strokeOpacity="0.09"
              />
            </svg>
          </div>
          <div className="login-data-flow__labels">
            <span>Datasets</span>
            <span>Reports</span>
            <span>Insights</span>
            <span>Decisions</span>
          </div>
        </div>
      </section>

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-heading">
          <div className="login-card__heading">
            <h1 id="login-heading">SCL BI Portal</h1>
            <span>사번과 그룹웨어 비밀번호로 로그인해 주세요.</span>
          </div>

          <form
            className="login-form"
            onSubmit={handleSubmit}
            noValidate
            aria-busy={mutation.isPending}
          >
            <div className="login-field">
              <label htmlFor="identifier">ID</label>
              <div className="login-field__control">
                <User aria-hidden="true" />
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="사번을 입력해 주세요"
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="login-field__control">
                <Lock aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="그룹웨어 비밀번호"
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
            </div>

            {mutation.isError && (
              <p role="alert" className="login-error">
                {errorMessage(mutation.error)}
              </p>
            )}

            <button className="login-submit" type="submit" disabled={!canSubmit}>
              <span>
                {mutation.isPending && <LoaderCircle className="login-submit__spinner" aria-hidden="true" />}
                {mutation.isPending ? '로그인 중…' : 'Login'}
              </span>
              {!mutation.isPending && <ArrowRight aria-hidden="true" />}
            </button>
          </form>

          <p className="login-card__security">
            <Lock aria-hidden="true" />
            안전한 사내망 내에서만 접속 가능합니다.
          </p>
        </section>

        <p className="login-copyright">© 2026 Samchully Group. All rights reserved.</p>
      </main>
    </div>
  )
}
