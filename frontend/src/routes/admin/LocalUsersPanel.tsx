/** 로컬 사용자(그룹웨어 미연동) 관리 패널.
 *
 * 관리자가 테스트용/외부 인력용 계정을 직접 만들고 비밀번호를 재설정한다. HR 사번이
 * 아닌 자유 문자열 아이디를 쓰며, users 테이블의 is_local=true 행에만 대응한다.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react'

import { usersApi } from '@/api/adminApi'
import type { UserListItem } from '@/types/admin'
import { ApiError } from '@/api/client'

interface CreateDraft {
  login_id: string
  name: string
  email: string
  password: string
  role_code: string
}

const EMPTY_DRAFT: CreateDraft = {
  login_id: '',
  name: '',
  email: '',
  password: '',
  role_code: 'General_User',
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'General_User', label: '일반 사용자' },
  { value: 'System_Operator', label: '시스템 운영자' },
]

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.errorDescription) return err.errorDescription
  return fallback
}

interface PasswordInputProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  autoFocus?: boolean
  required?: boolean
  className?: string
}

/** 비밀번호 입력 + 표시/숨김 토글. 눈 아이콘을 눌러 입력한 값을 확인할 수 있다. */
function PasswordInput({
  value, onChange, ariaLabel, placeholder,
  autoFocus = false, required = false,
  className = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500',
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        minLength={8}
        maxLength={256}
        className={`${className} w-full pr-9`}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? '비밀번호 숨기기' : '비밀번호 표시'}
        aria-pressed={visible}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

export default function LocalUsersPanel() {
  const qc = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    staleTime: 30_000,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<{ name: string; email: string }>({ name: '', email: '' })
  const [passwordFor, setPasswordFor] = useState<UserListItem | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const createMutation = useMutation({
    mutationFn: () => usersApi.createLocal({
      login_id: draft.login_id.trim(),
      name: draft.name.trim(),
      email: draft.email.trim() || null,
      password: draft.password,
      role_code: draft.role_code,
    }),
    onSuccess: () => {
      setDraft(EMPTY_DRAFT)
      setShowCreate(false)
      invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name?: string; email?: string | null } }) =>
      usersApi.updateLocal(id, body),
    onSuccess: () => { setEditingId(null); invalidate() },
  })

  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      usersApi.resetLocalPassword(id, password),
    onSuccess: () => { setPasswordFor(null); setNewPassword('') },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      usersApi.setStatus(id, isActive),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.removeLocal(id),
    onSuccess: invalidate,
  })

  const allUsers = usersQuery.data ?? []
  const localUsers = allUsers.filter((u) => u.is_local)

  const canCreate =
    draft.login_id.trim().length >= 3
    && draft.name.trim().length > 0
    && draft.password.length >= 8
    && !createMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-slate-800">로컬 사용자 계정</h3>
          <p className="mt-1 text-xs text-slate-500">
            그룹웨어(인사) 정보 없이 관리자가 직접 만드는 계정입니다. 테스트나 외부 인력 로그인용으로 활용하세요.
            부서는 지정되지 않고, 이후 그룹·레포트 권한은 권한 관리 화면에서 개별 부여합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <UserPlus className="h-4 w-4" /> {showCreate ? '취소' : '새 계정 만들기'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (canCreate) createMutation.mutate() }}
          className="rounded-xl border border-blue-200 bg-blue-50/60 p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              로그인 아이디 (3자 이상)
              <input
                value={draft.login_id}
                onChange={(e) => setDraft((d) => ({ ...d, login_id: e.target.value }))}
                placeholder="예: ext_partner1"
                required
                minLength={3}
                maxLength={64}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              이름
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                required
                maxLength={255}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              이메일 (선택)
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                maxLength={255}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              초기 비밀번호 (8자 이상)
              <PasswordInput
                value={draft.password}
                onChange={(v) => setDraft((d) => ({ ...d, password: v }))}
                ariaLabel="초기 비밀번호"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
              초기 역할
              <select
                value={draft.role_code}
                onChange={(e) => setDraft((d) => ({ ...d, role_code: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
          </div>
          {createMutation.isError && (
            <p role="alert" className="mt-3 text-xs text-red-600">
              {errorMessage(createMutation.error, '계정을 만들지 못했습니다. 아이디 중복 여부를 확인하세요.')}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setShowCreate(false); setDraft(EMPTY_DRAFT) }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-white">
              취소
            </button>
            <button type="submit" disabled={!canCreate}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              <Plus className="h-4 w-4" /> {createMutation.isPending ? '생성 중…' : '생성'}
            </button>
          </div>
        </form>
      )}

      {usersQuery.isLoading ? (
        <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : localUsers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400">
          로컬 계정이 없습니다. 우측 상단의 <strong className="font-medium">새 계정 만들기</strong> 로 추가하세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">로그인 아이디</th>
                <th className="px-3 py-3">이름</th>
                <th className="px-3 py-3">이메일</th>
                <th className="px-3 py-3">역할</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {localUsers.map((user) => {
                const isEditing = editingId === user.id
                return (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-slate-700">{user.emp_no}</td>
                    <td className="px-3 py-2.5">
                      {isEditing ? (
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          aria-label={`${user.emp_no} 이름`}
                          className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="font-medium text-slate-800">{user.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {isEditing ? (
                        <input
                          type="email"
                          value={editDraft.email}
                          onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))}
                          aria-label={`${user.emp_no} 이메일`}
                          className="w-56 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        user.email ?? '-'
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r) => (
                          <span key={r} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {user.is_active ? '활성' : '해제'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button type="button"
                              onClick={() => updateMutation.mutate({ id: user.id, body: { name: editDraft.name, email: editDraft.email || null } })}
                              disabled={updateMutation.isPending}
                              className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                              저장
                            </button>
                            <button type="button" onClick={() => setEditingId(null)}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-white">
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" title="이름/이메일 수정"
                              onClick={() => { setEditingId(user.id); setEditDraft({ name: user.name, email: user.email ?? '' }) }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
                              <Pencil className="h-3 w-3" /> 수정
                            </button>
                            <button type="button" title="비밀번호 재설정"
                              onClick={() => setPasswordFor(user)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100">
                              <KeyRound className="h-3 w-3" /> 비밀번호
                            </button>
                            <button type="button"
                              onClick={() => statusMutation.mutate({ id: user.id, isActive: !user.is_active })}
                              disabled={statusMutation.isPending}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                                user.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-600 text-white hover:bg-blue-500'
                              }`}>
                              {user.is_active ? '해제' : '활성화'}
                            </button>
                            <button type="button" title="계정 삭제" aria-label={`${user.name} 계정 삭제`}
                              onClick={() => {
                                if (window.confirm(`${user.name}(${user.emp_no}) 계정을 삭제할까요? 이 사용자의 그룹·권한도 함께 제거됩니다.`)) {
                                  deleteMutation.mutate(user.id)
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {passwordFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-800">비밀번호 재설정</h3>
              <button type="button" aria-label="닫기"
                onClick={() => { setPasswordFor(null); setNewPassword('') }}
                className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-slate-500">
              <span className="font-medium text-slate-700">{passwordFor.name}</span>
              <span className="ml-1 font-mono text-xs text-slate-400">({passwordFor.emp_no})</span>
              의 새 비밀번호를 입력하세요. 재설정 즉시 이 사용자의 모든 세션이 만료됩니다.
            </p>
            <form onSubmit={(e) => {
              e.preventDefault()
              if (newPassword.length >= 8 && passwordFor) {
                passwordMutation.mutate({ id: passwordFor.id, password: newPassword })
              }
            }}>
              <PasswordInput
                value={newPassword}
                onChange={setNewPassword}
                ariaLabel="새 비밀번호"
                placeholder="8자 이상"
                autoFocus
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              {passwordMutation.isError && (
                <p role="alert" className="mt-2 text-xs text-red-600">
                  {errorMessage(passwordMutation.error, '재설정에 실패했습니다.')}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => { setPasswordFor(null); setNewPassword('') }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  취소
                </button>
                <button type="submit" disabled={newPassword.length < 8 || passwordMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                  {passwordMutation.isPending ? '재설정 중…' : '재설정'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
