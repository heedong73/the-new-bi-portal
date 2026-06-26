/** 사용자 관리 — 인사 조직도 트리 + 부서 구성원(이름/사번/이메일/부서/직급) + BIP 등록/권한그룹/역할.
 *  가시성은 권한 기반: 등록된 사용자도 권한(그룹/레포트 권한)이 없으면 레포트 조회 불가.
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Building2, Search, Users2 } from 'lucide-react'

import { orgApi, groupsApi, usersApi } from '@/api/adminApi'
import type { OrgMember, OrgNode } from '@/types/admin'

const ROLE_LEVELS = [
  { code: 'General_User', label: '일반 사용자' },
  { code: 'Super_User', label: '파워 사용자' },
  { code: 'System_Operator', label: '시스템 운영자' },
]

export default function UsersPage() {
  const qc = useQueryClient()
  const [cmpId, setCmpId] = useState('')
  const [selectedDept, setSelectedDept] = useState<{ id: string; name: string } | null>(null)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({})

  const companiesQuery = useQuery({
    queryKey: ['org-companies'],
    queryFn: ({ signal }) => orgApi.companies(signal),
    staleTime: 300_000,
  })
  const treeQuery = useQuery({
    queryKey: ['org-tree', cmpId],
    queryFn: ({ signal }) => orgApi.tree(cmpId || undefined, signal),
    staleTime: 300_000,
  })
  const groupsQuery = useQuery({
    queryKey: ['admin-groups'],
    queryFn: ({ signal }) => groupsApi.list(signal),
    staleTime: 60_000,
  })

  const membersEnabled = !!selectedDept || appliedSearch.trim().length > 0
  const membersQuery = useQuery({
    queryKey: ['org-members', selectedDept?.id ?? null, appliedSearch],
    queryFn: ({ signal }) =>
      orgApi.members({ deptId: selectedDept?.id, q: appliedSearch || undefined }, signal),
    enabled: membersEnabled,
    staleTime: 10_000,
  })

  const invalidateMembers = () => qc.invalidateQueries({ queryKey: ['org-members'] })

  const addGroupMutation = useMutation({
    mutationFn: ({ empNo, groupId }: { empNo: string; groupId: number }) =>
      orgApi.addGroup(empNo, groupId),
    onSuccess: invalidateMembers,
  })
  const removeGroupMutation = useMutation({
    mutationFn: ({ empNo, groupId }: { empNo: string; groupId: number }) =>
      orgApi.removeGroup(empNo, groupId),
    onSuccess: invalidateMembers,
  })
  const roleSaveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        Object.entries(roleDraft).map(([empNo, code]) => orgApi.setRoleLevel(empNo, code)),
      )
    },
    onSuccess: () => { setRoleDraft({}); invalidateMembers() },
  })
  const statusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      usersApi.setStatus(userId, isActive),
    onSuccess: invalidateMembers,
  })

  const companies = companiesQuery.data ?? []
  const tree = treeQuery.data ?? []
  const groups = groupsQuery.data ?? []
  const members = membersQuery.data ?? []

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function applySearch() {
    setAppliedSearch(search.trim())
    if (search.trim()) setSelectedDept(null)
  }

  const renderNode = (node: OrgNode, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.dept_id)
    const isSelected = selectedDept?.id === node.dept_id
    return (
      <div key={node.dept_id}>
        <div
          className={`flex items-center gap-1 rounded-md py-1 pr-2 ${
            isSelected ? 'bg-blue-50' : 'hover:bg-slate-100'
          }`}
          style={{ paddingLeft: depth * 14 + 4 }}
        >
          {hasChildren ? (
            <button type="button" onClick={() => toggle(node.dept_id)} aria-label={isOpen ? '접기' : '펼치기'}
              className="shrink-0 text-slate-400">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}
          <button
            type="button"
            onClick={() => { setSelectedDept({ id: node.dept_id, name: node.dept_name }); setAppliedSearch(''); setSearch('') }}
            className={`flex-1 truncate text-left text-sm ${isSelected ? 'font-semibold text-blue-700' : 'text-slate-700'}`}
          >
            {node.dept_name}
          </button>
        </div>
        {isOpen && hasChildren && (
          <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">사용자 관리</h2>
        <p className="mt-1 text-sm text-slate-500">
          인사 정보에서 사용자를 조회하고, 시스템 접근 권한을 등록/해제합니다. 등록된 사용자도 권한이 없으면 레포트 조회가 불가합니다.
        </p>
      </div>

      <div className="flex gap-4">
        {/* 좌측: 조직도 */}
        <aside className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Building2 className="h-4 w-4 text-slate-400" /> 조직도
          </div>
          <select
            value={cmpId}
            onChange={(e) => { setCmpId(e.target.value); setSelectedDept(null) }}
            aria-label="회사 선택"
            className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">전체 회사</option>
            {companies.map((c) => (
              <option key={c.cmp_id} value={c.cmp_id}>{c.dept_name}</option>
            ))}
          </select>
          <div className="max-h-[60vh] overflow-y-auto">
            {treeQuery.isLoading ? (
              <p className="p-2 text-xs text-slate-400">불러오는 중…</p>
            ) : tree.length === 0 ? (
              <p className="p-2 text-xs text-slate-400">조직 정보가 없습니다.</p>
            ) : (
              tree.map((n) => renderNode(n, 0))
            )}
          </div>
        </aside>

        {/* 우측: 구성원 */}
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applySearch() }}
                aria-label="구성원 검색"
                placeholder="이름, 사번, 이메일 검색 (Enter)"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
              />
            </div>
            {selectedDept && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                부서: {selectedDept.name}
                <button type="button" onClick={() => setSelectedDept(null)} className="ml-1 text-blue-400 hover:text-blue-600">×</button>
              </span>
            )}
          </div>

          {Object.keys(roleDraft).length > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="text-amber-700">역할 변경 {Object.keys(roleDraft).length}건 미저장</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setRoleDraft({})}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-white">취소</button>
                <button type="button" onClick={() => roleSaveMutation.mutate()} disabled={roleSaveMutation.isPending}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                  {roleSaveMutation.isPending ? '저장 중…' : '역할 변경 저장'}
                </button>
              </div>
            </div>
          )}

          {!membersEnabled ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-16 text-slate-400">
              <Users2 className="mb-2 h-8 w-8" />
              <p className="text-sm">좌측 조직도에서 부서를 선택하거나 검색하세요.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-3">이름</th>
                    <th className="px-3 py-3">사번</th>
                    <th className="px-3 py-3">이메일</th>
                    <th className="px-3 py-3">부서</th>
                    <th className="px-3 py-3">직급</th>
                    <th className="px-3 py-3">권한 그룹</th>
                    <th className="px-3 py-3">역할</th>
                    <th className="px-3 py-3 text-right">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {membersQuery.isLoading ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">불러오는 중…</td></tr>
                  ) : members.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">구성원이 없습니다.</td></tr>
                  ) : (
                    members.map((m) => (
                      <MemberRow
                        key={m.emp_no}
                        m={m}
                        groups={groups}
                        roleValue={roleDraft[m.emp_no] ?? m.role_level ?? 'General_User'}
                        roleDirty={m.emp_no in roleDraft}
                        onAddGroup={(gid) => addGroupMutation.mutate({ empNo: m.emp_no, groupId: gid })}
                        onRemoveGroup={(gid) => removeGroupMutation.mutate({ empNo: m.emp_no, groupId: gid })}
                        onSetRole={(code) => setRoleDraft((prev) => ({ ...prev, [m.emp_no]: code }))}
                        onToggleActive={() => m.user_id && statusMutation.mutate({ userId: m.user_id, isActive: !m.is_active })}
                        busy={addGroupMutation.isPending || removeGroupMutation.isPending || statusMutation.isPending}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-right text-xs text-slate-400">총 {members.length}명{members.length >= 500 ? ' (최대 500 표시)' : ''}</p>
        </div>
      </div>
    </section>
  )
}

interface MemberRowProps {
  m: OrgMember
  groups: { id: number; name: string }[]
  roleValue: string
  roleDirty: boolean
  onAddGroup: (groupId: number) => void
  onRemoveGroup: (groupId: number) => void
  onSetRole: (roleCode: string) => void
  onToggleActive: () => void
  busy: boolean
}

function MemberRow({ m, groups, roleValue, roleDirty, onAddGroup, onRemoveGroup, onSetRole, onToggleActive, busy }: MemberRowProps) {
  const assignedIds = new Set(m.groups.map((g) => g.id))
  const available = groups.filter((g) => !assignedIds.has(g.id))
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5 font-medium text-slate-800">{m.name}</td>
      <td className="px-3 py-2.5 font-mono text-slate-600">{m.emp_no}</td>
      <td className="px-3 py-2.5 text-slate-500">{m.email ?? '-'}</td>
      <td className="px-3 py-2.5 text-slate-600">{m.dept_name ?? '-'}</td>
      <td className="px-3 py-2.5 text-slate-600">{m.ofc_name ?? '-'}</td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {m.groups.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              {g.name}
              <button type="button" aria-label={`${m.emp_no} ${g.name} 그룹 제거`} disabled={busy}
                onClick={() => onRemoveGroup(g.id)} className="text-blue-400 hover:text-blue-600 disabled:opacity-50">×</button>
            </span>
          ))}
          <select
            value=""
            disabled={busy || available.length === 0}
            aria-label={`${m.emp_no} 권한 그룹 추가`}
            onChange={(e) => { if (e.target.value) onAddGroup(Number(e.target.value)) }}
            className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-xs text-slate-500 disabled:opacity-50"
          >
            <option value="">+ 그룹</option>
            {available.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <select
          value={roleValue}
          disabled={busy}
          aria-label={`${m.emp_no} 역할`}
          onChange={(e) => onSetRole(e.target.value)}
          className={`w-32 rounded border px-2 py-1 text-xs disabled:opacity-50 ${
            roleDirty ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
        >
          {ROLE_LEVELS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-2.5 text-right">
        {m.registered ? (
          <button type="button" onClick={onToggleActive} disabled={busy}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
              m.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}>
            {m.is_active ? '해제' : '활성화'}
          </button>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">미등록</span>
        )}
      </td>
    </tr>
  )
}
