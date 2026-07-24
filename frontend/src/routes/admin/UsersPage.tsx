/** 사용자 관리 — 인사 조직도 트리 + 부서 구성원(이름/사번/이메일/부서/직급) + BIP 등록/권한그룹/역할.
 *  가시성은 권한 기반: 등록된 사용자도 권한(그룹/레포트 권한)이 없으면 레포트 조회 불가.
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Building2, Search, Users2, RefreshCcw, X, UserCog } from 'lucide-react'

import { orgApi, groupsApi, usersApi } from '@/api/adminApi'
import type { OrgMember, OrgNode, TeamGroupSyncResult } from '@/types/admin'
import { GroupPicker } from './EntityPicker'
import LocalUsersPanel from './LocalUsersPanel'

const ROLE_LEVELS = [
  { code: 'General_User', label: '일반 사용자' },
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
  const [syncPlan, setSyncPlan] = useState<TeamGroupSyncResult | null>(null)
  const [view, setView] = useState<'org' | 'local'>('org')

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

  // 팀 그룹 동기화: 미리보기(apply=false) → 적용(apply=true)
  const previewSyncMutation = useMutation({
    mutationFn: () => orgApi.syncTeamGroups(selectedDept!.id, false),
    onSuccess: (plan) => setSyncPlan(plan),
  })
  const applySyncMutation = useMutation({
    mutationFn: () => orgApi.syncTeamGroups(selectedDept!.id, true),
    onSuccess: () => {
      setSyncPlan(null)
      invalidateMembers()
      qc.invalidateQueries({ queryKey: ['admin-groups'] })
    },
  })

  const companies = companiesQuery.data ?? []
  const tree = treeQuery.data ?? []
  const groups = groupsQuery.data ?? []
  const members = membersQuery.data ?? []

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
        <h2 className="portal-content-page-title">사용자 관리</h2>
        <p className="mt-1 text-sm text-slate-500">
          인사 정보에서 사용자를 조회하고, 시스템 접근 권한을 등록/해제합니다. 등록된 사용자도 권한이 없으면 레포트 조회가 불가합니다.
        </p>
      </div>

      <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        사용자별 레포트·메뉴 권한은 <span className="font-medium text-slate-600">권한 관리 &gt; 개인별 권한</span>에서 조회하고 조정할 수 있습니다.
      </p>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <button type="button" onClick={() => setView('org')}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
            view === 'org' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <Building2 className="h-4 w-4" /> 조직도
        </button>
        <button type="button" onClick={() => setView('local')}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
            view === 'local' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <UserCog className="h-4 w-4" /> 로컬 계정
        </button>
      </div>

      {view === 'local' && <LocalUsersPanel />}

      {view === 'org' && (
      <div className="flex gap-4">
        {/* 좌측: 조직도 */}
        <aside className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
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
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  부서: {selectedDept.name}
                  <button type="button" onClick={() => setSelectedDept(null)} className="ml-1 text-blue-400 hover:text-blue-600">×</button>
                </span>
                <button type="button" onClick={() => previewSyncMutation.mutate()} disabled={previewSyncMutation.isPending}
                  title="이 조직 하위 팀들의 권한 그룹을 자동 생성하고 구성원을 현재 조직도와 동기화합니다"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-600 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                  <RefreshCcw className="h-3.5 w-3.5" /> {previewSyncMutation.isPending ? '분석 중…' : '팀 그룹 동기화'}
                </button>
              </>
            )}
          </div>

          {previewSyncMutation.isError && (
            <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">팀 그룹 분석에 실패했습니다. 다시 시도하세요.</p>
          )}

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
      )}

      {/* 팀 권한그룹 동기화 미리보기 모달 */}
      {syncPlan && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="my-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">팀 권한그룹 동기화 미리보기</h3>
              <button type="button" aria-label="닫기" onClick={() => setSyncPlan(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              팀 {syncPlan.groups_total}개 · 신규 그룹 {syncPlan.groups_to_create}개 · 추가 {syncPlan.members_to_add}명 · 제거 {syncPlan.members_to_remove}명 · 자동등록 {syncPlan.to_register}명
            </div>
            {syncPlan.members_to_remove > 0 && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                완전 동기화: 조직도에서 빠진 인원 {syncPlan.members_to_remove}명이 해당 팀 그룹에서 제거됩니다. (수동 생성 그룹은 영향 없음)
              </p>
            )}

            {syncPlan.teams.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">이 조직 하위에 구성원이 있는 팀이 없습니다.</p>
            ) : (
              <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
                {syncPlan.teams.map((t) => (
                  <li key={t.dept_id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">{t.group_name}</span>
                      {t.created && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">신규</span>}
                      {t.renamed_from && <span className="text-xs text-slate-400">(이전: {t.renamed_from})</span>}
                      <span className="ml-auto text-xs text-slate-400">유지 {t.keep}</span>
                      {t.add.length > 0 && <span className="text-xs text-green-600">+{t.add.length}</span>}
                      {t.remove.length > 0 && <span className="text-xs text-red-600">-{t.remove.length}</span>}
                    </div>
                    {(t.add.length > 0 || t.remove.length > 0) && (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                        {t.add.length > 0 && <div><span className="text-green-600">추가</span> {t.add.map((a) => a.name).join(', ')}</div>}
                        {t.remove.length > 0 && <div><span className="text-red-600">제거</span> {t.remove.map((a) => a.name).join(', ')}</div>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {applySyncMutation.isError && <p role="alert" className="mt-3 text-sm text-red-600">적용에 실패했습니다. 다시 시도하세요.</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSyncPlan(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" onClick={() => applySyncMutation.mutate()} disabled={applySyncMutation.isPending || syncPlan.teams.length === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                {applySyncMutation.isPending ? '적용 중…' : '적용'}
              </button>
            </div>
          </div>
        </div>
      )}
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
          <GroupPicker
            groups={available}
            value={null}
            onChange={(id) => { if (id !== null) onAddGroup(id) }}
            disabled={busy || available.length === 0}
            ariaLabel={`${m.emp_no} 권한 그룹 추가`}
            placeholder="+ 그룹 검색"
            className="w-40"
            inputClassName="py-1 text-xs"
          />
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

// 사용자별 상세 권한은 권한 관리 > 개인별 권한 화면에서 관리한다.
