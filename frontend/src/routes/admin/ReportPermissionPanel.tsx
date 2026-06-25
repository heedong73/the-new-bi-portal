/** 레포트 권한 부여 패널 (T-추가) — VIEW/DOWNLOAD/REFRESH/MANAGE 주체별 부여·회수. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'

import { reportAdminApi } from '@/api/reportAdminApi'
import { usersApi, groupsApi } from '@/api/adminApi'
import type { PermissionAction, ReportPermission, SubjectType } from '@/types/reportAdmin'

const SUBJECT_TYPES: { value: SubjectType; label: string }[] = [
  { value: 'user', label: '사용자' },
  { value: 'group', label: '그룹' },
  { value: 'dept', label: '부서' },
  { value: 'role', label: '역할' },
]
const PERMISSIONS: { value: PermissionAction; label: string }[] = [
  { value: 'VIEW', label: '조회' },
  { value: 'DOWNLOAD', label: '다운로드' },
  { value: 'REFRESH', label: '새로고침' },
  { value: 'MANAGE_REPORT', label: '관리' },
]

export default function ReportPermissionPanel({ reportId }: { reportId: number }) {
  const queryClient = useQueryClient()
  const [subjectType, setSubjectType] = useState<SubjectType>('user')
  const [subjectId, setSubjectId] = useState('')
  const [permission, setPermission] = useState<PermissionAction>('VIEW')

  const permsQuery = useQuery({
    queryKey: ['report-perms', reportId],
    queryFn: ({ signal }) => reportAdminApi.permissions(reportId, signal),
  })
  // 주체 선택 보조: 사용자/그룹 목록
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: ({ signal }) => usersApi.list(signal), staleTime: 60_000 })
  const groupsQuery = useQuery({ queryKey: ['admin-groups'], queryFn: ({ signal }) => groupsApi.list(signal), staleTime: 60_000 })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['report-perms', reportId] })

  const grantMutation = useMutation({
    mutationFn: () =>
      reportAdminApi.grant(reportId, { subject_type: subjectType, subject_id: Number(subjectId), permission }),
    onSuccess: () => { setSubjectId(''); invalidate() },
  })
  const revokeMutation = useMutation({
    mutationFn: (permId: number) => reportAdminApi.revoke(reportId, permId),
    onSuccess: () => invalidate(),
  })

  const perms = permsQuery.data ?? []
  const users = usersQuery.data ?? []
  const groups = groupsQuery.data ?? []

  function subjectLabel(p: ReportPermission): string {
    if (p.subject_type === 'user') {
      const u = users.find((x) => x.id === p.subject_id)
      return u ? `${u.name}(${u.emp_no})` : `user#${p.subject_id}`
    }
    if (p.subject_type === 'group') {
      const g = groups.find((x) => x.id === p.subject_id)
      return g ? g.name : `group#${p.subject_id}`
    }
    return `${p.subject_type}#${p.subject_id}`
  }

  const permLabel = (code: string) => PERMISSIONS.find((p) => p.value === code)?.label ?? code
  const canGrant = subjectId.trim() !== '' && !grantMutation.isPending

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">권한 부여</h4>

      {/* 부여 폼 */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select value={subjectType} onChange={(e) => { setSubjectType(e.target.value as SubjectType); setSubjectId('') }}
          aria-label="주체 유형" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {SUBJECT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {subjectType === 'user' ? (
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="사용자 선택"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm min-w-44">
            <option value="">사용자 선택…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.emp_no})</option>)}
          </select>
        ) : subjectType === 'group' ? (
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="그룹 선택"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm min-w-44">
            <option value="">그룹 선택…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : (
          <input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} type="number"
            placeholder={subjectType === 'dept' ? '부서 ID' : '역할 ID'} aria-label="주체 ID"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-32" />
        )}

        <select value={permission} onChange={(e) => setPermission(e.target.value as PermissionAction)}
          aria-label="권한" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {PERMISSIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        <button type="button" disabled={!canGrant} onClick={() => grantMutation.mutate()}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          <Plus className="h-4 w-4" /> 부여
        </button>
      </div>
      {grantMutation.isError && (
        <p role="alert" className="mb-2 text-xs text-red-600">부여 실패 (중복이거나 입력값 확인).</p>
      )}

      {/* 권한 목록 */}
      {permsQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : perms.length === 0 ? (
        <p className="text-sm text-slate-400">부여된 권한이 없습니다. (System_Operator는 항상 전체 접근)</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {perms.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-700">
                {subjectLabel(p)} · <span className="font-medium">{permLabel(p.permission)}</span>
              </span>
              <button type="button" onClick={() => revokeMutation.mutate(p.id)} aria-label={`권한 ${p.id} 회수`}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" /> 회수
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
