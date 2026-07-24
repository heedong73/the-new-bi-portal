/** 레포트 권한 부여 패널 (T-추가) — VIEW/DOWNLOAD/REFRESH/MANAGE 주체별 부여·회수. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'

import { reportAdminApi } from '@/api/reportAdminApi'
import { usersApi, groupsApi } from '@/api/adminApi'
import type { PermissionAction, ReportPermission, SubjectType } from '@/types/reportAdmin'
import { GroupPicker, UserPicker } from './EntityPicker'

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
  { value: 'MANAGE_REPORT', label: '교체' },
  { value: 'VIEW_STATS', label: '통계 조회' },
]

export default function ReportPermissionPanel({ reportId }: { reportId: number }) {
  const queryClient = useQueryClient()
  const [subjectType, setSubjectType] = useState<SubjectType>('user')
  const [subjectId, setSubjectId] = useState('')
  const [selectedPerms, setSelectedPerms] = useState<PermissionAction[]>(['VIEW'])

  const permsQuery = useQuery({
    queryKey: ['report-perms', reportId],
    queryFn: ({ signal }) => reportAdminApi.permissions(reportId, signal),
  })
  // 주체 선택 보조: 사용자/그룹 목록
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: ({ signal }) => usersApi.list(signal), staleTime: 60_000 })
  const groupsQuery = useQuery({ queryKey: ['admin-groups'], queryFn: ({ signal }) => groupsApi.list(signal), staleTime: 60_000 })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['report-perms', reportId] })

  function togglePerm(p: PermissionAction, checked: boolean) {
    setSelectedPerms((prev) => (checked ? [...new Set([...prev, p])] : prev.filter((x) => x !== p)))
  }

  const grantMutation = useMutation({
    mutationFn: () =>
      reportAdminApi.grantBulk(reportId, {
        subject_type: subjectType,
        subject_id: Number(subjectId),
        permissions: selectedPerms,
      }),
    onSuccess: () => { setSubjectId(''); setSelectedPerms(['VIEW']); invalidate() },
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
  const permOrder = (code: string) => {
    const i = PERMISSIONS.findIndex((p) => p.value === code)
    return i === -1 ? 999 : i
  }
  // 주체(주체유형+ID)별로 묶어 한 줄에 표시. 각 그룹의 권한은 PERMISSIONS 정의 순으로 정렬.
  const groupedPerms = Object.values(
    perms.reduce<Record<string, { key: string; items: ReportPermission[] }>>((acc, p) => {
      const key = `${p.subject_type}#${p.subject_id}`
      if (!acc[key]) acc[key] = { key, items: [] }
      acc[key].items.push(p)
      return acc
    }, {}),
  ).map((g) => ({
    ...g,
    items: [...g.items].sort((a, b) => permOrder(a.permission) - permOrder(b.permission)),
  }))

  const canGrant = subjectId.trim() !== '' && selectedPerms.length > 0 && !grantMutation.isPending

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h4 className="mb-3 text-sm font-bold text-slate-700">권한 부여</h4>

      {/* 부여 폼 */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select value={subjectType} onChange={(e) => { setSubjectType(e.target.value as SubjectType); setSubjectId('') }}
          aria-label="주체 유형" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {SUBJECT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {subjectType === 'user' ? (
          <UserPicker
            users={users}
            value={subjectId === '' ? null : Number(subjectId)}
            onChange={(id) => setSubjectId(id === null ? '' : String(id))}
            loading={usersQuery.isLoading}
            ariaLabel="사용자 선택"
            className="min-w-56"
          />
        ) : subjectType === 'group' ? (
          <GroupPicker
            groups={groups}
            value={subjectId === '' ? null : Number(subjectId)}
            onChange={(id) => setSubjectId(id === null ? '' : String(id))}
            loading={groupsQuery.isLoading}
            ariaLabel="그룹 선택"
            className="min-w-56"
          />
        ) : (
          <input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} type="number"
            placeholder={subjectType === 'dept' ? '부서 ID' : '역할 ID'} aria-label="주체 ID"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-32" />
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-2 py-1.5">
          <span className="text-xs text-slate-400">권한(복수 선택)</span>
          {PERMISSIONS.map((p) => (
            <label key={p.value} className="inline-flex items-center gap-1 text-sm text-slate-600">
              <input type="checkbox" checked={selectedPerms.includes(p.value)}
                onChange={(e) => togglePerm(p.value, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300" />
              {p.label}
            </label>
          ))}
        </div>

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
          {groupedPerms.map((g) => (
            <li key={g.key} className="flex items-start gap-2 py-2 text-sm">
              <span className="mt-0.5 shrink-0 font-medium text-slate-700">{subjectLabel(g.items[0])}</span>
              <span className="mt-0.5 shrink-0 text-slate-300">-</span>
              <div className="flex flex-1 flex-wrap gap-1">
                {g.items.map((p) => (
                  <span key={p.id}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-2 pr-1 text-xs text-slate-600">
                    {permLabel(p.permission)}
                    <button type="button" onClick={() => revokeMutation.mutate(p.id)}
                      aria-label={`${subjectLabel(g.items[0])} ${permLabel(p.permission)} 회수`}
                      className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
