import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Folder,
  Plus,
  RefreshCcw,
  UsersRound,
  X,
} from 'lucide-react'

import { groupsApi, orgApi } from '@/api/adminApi'
import type { GroupTreeNode, TeamGroupSyncResult } from '@/types/admin'

export interface GroupSelection {
  id: number
  name: string
}

interface GroupTreeSelectorProps {
  selectedId: number | null
  onSelect: (group: GroupSelection) => void
  onGroupsChanged?: () => void
}

export default function GroupTreeSelector({
  selectedId,
  onSelect,
  onGroupsChanged,
}: GroupTreeSelectorProps) {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
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

  function invalidateGroups() {
    queryClient.invalidateQueries({ queryKey: ['admin-group-tree'] })
    queryClient.invalidateQueries({ queryKey: ['admin-groups'] })
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['org-members'] })
    onGroupsChanged?.()
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => groupsApi.create(name),
    onSuccess: (group) => {
      setNewName('')
      invalidateGroups()
      onSelect({ id: group.id, name: group.name })
    },
  })
  const previewSyncMutation = useMutation({
    mutationFn: (deptId: string) => orgApi.syncTeamGroups(deptId, false),
    onSuccess: (plan, deptId) => {
      setSyncPlan(plan)
      setSyncDeptId(deptId)
    },
  })
  const applySyncMutation = useMutation({
    mutationFn: () => orgApi.syncTeamGroups(syncDeptId as string, true),
    onSuccess: () => {
      setSyncPlan(null)
      setSyncDeptId(null)
      invalidateGroups()
    },
  })

  const companies = companiesQuery.data ?? []
  const tree = treeQuery.data?.tree ?? []
  const manualGroups = treeQuery.data?.ungrouped ?? []

  function toggle(deptId: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(deptId)) next.delete(deptId)
      else next.add(deptId)
      return next
    })
  }

  const renderNode = (node: GroupTreeNode, depth: number): ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.dept_id)
    const isGroup = node.group_id !== null
    const isSelected = isGroup && selectedId === node.group_id
    const groupName = node.group_name || node.dept_name

    return (
      <div key={node.dept_id}>
        <div
          className={`group flex items-center gap-1 rounded-md py-0.5 pr-1 ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
          style={{ paddingLeft: depth * 14 + 2 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.dept_id)}
              aria-label={isOpen ? '접기' : '펼치기'}
              className="shrink-0 text-slate-400"
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}

          {isGroup ? (
            <button
              type="button"
              onClick={() => onSelect({ id: node.group_id as number, name: groupName })}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm ${
                isSelected ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <UsersRound className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-blue-500'}`} />
              <span className="truncate">{groupName}</span>
              <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-xs ${
                isSelected ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {node.member_count ?? 0}
              </span>
            </button>
          ) : (
            <span className={`flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-sm ${
              node.has_members ? 'text-slate-600' : 'text-slate-400'
            }`}>
              {node.has_members ? (
                <UsersRound className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
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
        {isOpen && hasChildren && <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    )
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
        <UsersRound className="h-4 w-4 text-slate-400" /> 그룹 선택
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (newName.trim()) createMutation.mutate(newName.trim())
        }}
        className="mb-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3"
      >
        <label htmlFor="manual-group-name" className="mb-1.5 block text-xs font-bold text-blue-700">
          수동 그룹 만들기
        </label>
        <div className="flex gap-2">
          <input
            id="manual-group-name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="프로젝트·TF 그룹 이름"
            className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!newName.trim() || createMutation.isPending}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> 추가
          </button>
        </div>
        {createMutation.isError && (
          <p role="alert" className="mt-1.5 text-xs text-red-600">그룹을 만들지 못했습니다. 이름 중복 여부를 확인하세요.</p>
        )}
      </form>

      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
        <Building2 className="h-4 w-4 text-slate-400" /> 팀별 그룹
      </div>
      <select
        value={cmpId}
        onChange={(event) => setCmpId(event.target.value)}
        aria-label="회사 선택"
        className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="">전체 회사</option>
        {companies.map((company) => (
          <option key={company.cmp_id} value={company.cmp_id}>{company.dept_name}</option>
        ))}
      </select>

      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        {treeQuery.isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : tree.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">조직 정보가 없습니다.</p>
        ) : (
          <div className="max-h-[48vh] overflow-y-auto">{tree.map((node) => renderNode(node, 0))}</div>
        )}

        <div className="mt-3 border-t border-slate-100 px-2 pt-2 text-xs font-medium text-slate-400">
          수동 그룹
        </div>
        {manualGroups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-400">수동 그룹이 없습니다.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {manualGroups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ id: group.id, name: group.name })}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm ${
                    selectedId === group.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <UsersRound className={`h-3.5 w-3.5 shrink-0 ${
                    selectedId === group.id ? 'text-white' : 'text-slate-400'
                  }`} />
                  <span className="truncate">{group.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        부서 옆 <RefreshCcw className="inline h-3 w-3" /> 로 해당 조직 하위 팀 그룹을 생성·동기화할 수 있습니다.
      </p>

      {syncPlan && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="my-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">팀 권한그룹 동기화 미리보기</h3>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => {
                  setSyncPlan(null)
                  setSyncDeptId(null)
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              팀 {syncPlan.groups_total}개 · 신규 그룹 {syncPlan.groups_to_create}개 · 추가 {syncPlan.members_to_add}명 · 제거 {syncPlan.members_to_remove}명 · 자동등록 {syncPlan.to_register}명
            </div>
            {syncPlan.members_to_remove > 0 && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                완전 동기화: 조직도에서 빠진 인원 {syncPlan.members_to_remove}명이 해당 팀 그룹에서 제거됩니다. 수동 그룹은 영향받지 않습니다.
              </p>
            )}
            {syncPlan.teams.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">이 조직 하위에 구성원이 있는 팀이 없습니다.</p>
            ) : (
              <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
                {syncPlan.teams.map((team) => (
                  <li key={team.dept_id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">{team.group_name}</span>
                      {team.created && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">신규</span>}
                      {team.renamed_from && <span className="text-xs text-slate-400">(이전: {team.renamed_from})</span>}
                      <span className="ml-auto text-xs text-slate-400">유지 {team.keep}</span>
                      {team.add.length > 0 && <span className="text-xs text-green-600">+{team.add.length}</span>}
                      {team.remove.length > 0 && <span className="text-xs text-red-600">-{team.remove.length}</span>}
                    </div>
                    {(team.add.length > 0 || team.remove.length > 0) && (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                        {team.add.length > 0 && <div><span className="text-green-600">추가</span> {team.add.map((member) => member.name).join(', ')}</div>}
                        {team.remove.length > 0 && <div><span className="text-red-600">제거</span> {team.remove.map((member) => member.name).join(', ')}</div>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {applySyncMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-red-600">적용에 실패했습니다. 다시 시도하세요.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSyncPlan(null)
                  setSyncDeptId(null)
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => applySyncMutation.mutate()}
                disabled={applySyncMutation.isPending || syncPlan.teams.length === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {applySyncMutation.isPending ? '적용 중…' : '적용'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
