/** 그룹 관리 — 전체 조직도 트리(회사·본부·담당·팀) + 노드별 팀 그룹 동기화 + 그룹원 관리. R5, R6. */
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, UserMinus, UserPlus, ChevronRight, ChevronDown,
  Folder, UsersRound, RefreshCcw, X, Building2,
} from 'lucide-react'

import { groupsApi, usersApi, orgApi } from '@/api/adminApi'
import type { GroupTreeNode, TeamGroupSyncResult } from '@/types/admin'

export default function GroupsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [addUserId, setAddUserId] = useState('')
  const [cmpId, setCmpId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [syncPlan, setSyncPlan] = useState<TeamGroupSyncResult | null>(null)
  const [syncDeptId, setSyncDeptId] = useState<string | null>(null)

  const companiesQuery = useQuery({
    queryKey: ['org-companies'],
    queryFn: ({ signal }) => orgApi.companies(signal),
    staleTime: 300_000,
  })
  const treeQuery = useQuery({
    queryKey: ['admin-group-tree', cmpId],
    queryFn: ({ signal }) => groupsApi.tree(cmpId || undefined, signal),
    staleTime: 30_000,
  })
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    staleTime: 30_000,
  })
  const membersQuery = useQuery({
    queryKey: ['admin-group-members', selectedId],
    queryFn: ({ signal }) => groupsApi.members(selectedId as number, signal),
    enabled: selectedId !== null,
  })

  const invalidateTree = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-group-tree'] })
    // 다른 화면(사용자 관리: 권한 현황/조직도)이 공유하는 그룹·사용자 캐시도 갱신
    queryClient.invalidateQueries({ queryKey: ['admin-groups'] })
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['org-members'] })
  }
  const invalidateMembers = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-group-members', selectedId] })
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['org-members'] })
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => groupsApi.create(name),
    onSuccess: () => { setNewName(''); invalidateTree() },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => groupsApi.remove(id),
    onSuccess: () => { setSelectedId(null); invalidateTree() },
  })
  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      groupsApi.addMember(groupId, userId),
    onSuccess: () => { setAddUserId(''); invalidateMembers() },
  })
  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      groupsApi.removeMember(groupId, userId),
    onSuccess: () => invalidateMembers(),
  })
  // 노드별 팀 그룹 동기화: 미리보기 → 적용
  const previewSyncMutation = useMutation({
    mutationFn: (deptId: string) => orgApi.syncTeamGroups(deptId, false),
    onSuccess: (plan, deptId) => { setSyncPlan(plan); setSyncDeptId(deptId) },
  })
  const applySyncMutation = useMutation({
    mutationFn: () => orgApi.syncTeamGroups(syncDeptId as string, true),
    onSuccess: () => {
      setSyncPlan(null); setSyncDeptId(null)
      invalidateTree(); invalidateMembers()
    },
  })

  const companies = companiesQuery.data ?? []
  const tree = treeQuery.data?.tree ?? []
  const ungrouped = treeQuery.data?.ungrouped ?? []
  const users = usersQuery.data ?? []
  const members = membersQuery.data ?? []
  const memberIds = new Set(members.map((m) => m.id))
  const selectableUsers = users.filter((u) => !memberIds.has(u.id))

  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    const walk = (nodes: GroupTreeNode[]) => {
      for (const n of nodes) {
        if (n.group_id != null) map.set(n.group_id, n.group_name || n.dept_name)
        walk(n.children)
      }
    }
    walk(tree)
    for (const g of ungrouped) map.set(g.id, g.name)
    return map
  }, [tree, ungrouped])

  function toggle(deptId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(deptId) ? next.delete(deptId) : next.add(deptId)
      return next
    })
  }

  const renderNode = (node: GroupTreeNode, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.dept_id)
    const isGroup = node.group_id != null
    const isSel = isGroup && selectedId === node.group_id
    return (
      <div key={node.dept_id}>
        <div
          className={`group flex items-center gap-1 rounded-md py-0.5 pr-1 ${isSel ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
          style={{ paddingLeft: depth * 14 + 2 }}
        >
          {hasChildren ? (
            <button type="button" onClick={() => toggle(node.dept_id)} aria-label={isOpen ? '접기' : '펼치기'} className="shrink-0 text-slate-400">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}

          {isGroup ? (
            <button
              type="button"
              onClick={() => setSelectedId(node.group_id!)}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm ${
                isSel ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <UsersRound className={`h-3.5 w-3.5 shrink-0 ${isSel ? 'text-white' : 'text-blue-500'}`} />
              <span className="truncate">{node.dept_name}</span>
              <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-xs ${isSel ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {node.member_count ?? 0}
              </span>
            </button>
          ) : (
            <span className={`flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-sm ${node.has_members ? 'text-slate-600' : 'text-slate-400'}`}>
              {node.has_members
                ? <UsersRound className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <span className="truncate">{node.dept_name}</span>
              {node.has_members && <span className="shrink-0 text-xs text-slate-300">그룹 없음</span>}
            </span>
          )}

          <button
            type="button"
            title="이 조직 하위 팀 그룹 동기화 (미리보기)"
            aria-label={`${node.dept_name} 동기화`}
            disabled={previewSyncMutation.isPending}
            onClick={() => previewSyncMutation.mutate(node.dept_id)}
            className="shrink-0 rounded p-1 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-blue-600 group-hover:opacity-100 disabled:opacity-50"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </div>
        {isOpen && hasChildren && <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    )
  }

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
      {/* 조직 트리 + 그룹 */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">그룹</h2>

        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Building2 className="h-4 w-4 text-slate-400" /> 조직도
        </div>
        <select
          value={cmpId}
          onChange={(e) => setCmpId(e.target.value)}
          aria-label="회사 선택"
          className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">전체 회사</option>
          {companies.map((c) => (
            <option key={c.cmp_id} value={c.cmp_id}>{c.dept_name}</option>
          ))}
        </select>

        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {treeQuery.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</p>
          ) : tree.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">조직 정보가 없습니다.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {tree.map((n) => renderNode(n, 0))}
            </div>
          )}

          {/* 기타(수동) 그룹 */}
          <div className="mt-3 border-t border-slate-100 px-2 pt-2 text-xs font-medium text-slate-400">기타 그룹 (수동)</div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMutation.mutate(newName.trim()) }}
            className="mt-1 flex gap-2 px-1"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 수동 그룹 이름"
              aria-label="새 그룹 이름"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            />
            <button type="submit" disabled={!newName.trim() || createMutation.isPending}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              <Plus className="h-4 w-4" /> 추가
            </button>
          </form>
          {ungrouped.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">수동 그룹이 없습니다.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {ungrouped.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(g.id)}
                    className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm ${
                      selectedId === g.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <UsersRound className={`h-3.5 w-3.5 shrink-0 ${selectedId === g.id ? 'text-white' : 'text-slate-400'}`} />
                    <span className="truncate">{g.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">부서 옆 <RefreshCcw className="inline h-3 w-3" /> 로 해당 조직 하위 팀 그룹을 한 번에 생성/동기화할 수 있습니다.</p>
      </div>

      {/* 선택 그룹 멤버 관리 */}
      <div>
        {selectedId === null ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 py-20 text-slate-400">
            그룹을 선택하세요.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">
                {nameById.get(selectedId) ?? '그룹'} 멤버
              </h3>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(selectedId)}
                className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" /> 그룹 삭제
              </button>
            </div>

            <div className="mb-4 flex gap-2">
              <select
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
                aria-label="추가할 사용자"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="">사용자 선택…</option>
                {selectableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.emp_no})</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addUserId || addMemberMutation.isPending}
                onClick={() => addMemberMutation.mutate({ groupId: selectedId, userId: Number(addUserId) })}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" /> 추가
              </button>
            </div>

            {membersQuery.isLoading ? (
              <p className="text-sm text-slate-400">멤버 불러오는 중…</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-slate-700">
                      {m.name} <span className="font-mono text-xs text-slate-400">({m.emp_no})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMemberMutation.mutate({ groupId: selectedId, userId: m.id })}
                      aria-label={`${m.name} 제거`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      <UserMinus className="h-3.5 w-3.5" /> 제거
                    </button>
                  </li>
                ))}
                {members.length === 0 && <li className="py-6 text-center text-sm text-slate-400">멤버가 없습니다.</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 팀 그룹 동기화 미리보기 모달 */}
      {syncPlan && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="my-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">팀 권한그룹 동기화 미리보기</h3>
              <button type="button" aria-label="닫기" onClick={() => { setSyncPlan(null); setSyncDeptId(null) }} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
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
              <button type="button" onClick={() => { setSyncPlan(null); setSyncDeptId(null) }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
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
