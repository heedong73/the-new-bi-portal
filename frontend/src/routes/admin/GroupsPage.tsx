/** 그룹 관리 (T-38) — 그룹 CRUD + 그룹원 추가/제거. 요구사항: R5, R6. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, UserMinus, UserPlus } from 'lucide-react'

import { groupsApi, usersApi } from '@/api/adminApi'
import type { GroupResponse } from '@/types/admin'

export default function GroupsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [addUserId, setAddUserId] = useState('')

  const groupsQuery = useQuery({
    queryKey: ['admin-groups'],
    queryFn: ({ signal }) => groupsApi.list(signal),
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

  const invalidateGroups = () => queryClient.invalidateQueries({ queryKey: ['admin-groups'] })
  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-group-members', selectedId] })

  const createMutation = useMutation({
    mutationFn: (name: string) => groupsApi.create(name),
    onSuccess: () => { setNewName(''); invalidateGroups() },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => groupsApi.remove(id),
    onSuccess: () => { setSelectedId(null); invalidateGroups() },
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

  const groups = groupsQuery.data ?? []
  const users = usersQuery.data ?? []
  const members = membersQuery.data ?? []
  const memberIds = new Set(members.map((m) => m.id))
  const selectableUsers = users.filter((u) => !memberIds.has(u.id))

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      {/* 그룹 목록 + 생성 */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">그룹</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMutation.mutate(newName.trim()) }}
          className="mb-3 flex gap-2"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 그룹 이름"
            aria-label="새 그룹 이름"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!newName.trim() || createMutation.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> 추가
          </button>
        </form>
        <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {groups.map((g: GroupResponse) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => setSelectedId(g.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                  selectedId === g.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="truncate">{g.name}</span>
              </button>
            </li>
          ))}
          {groups.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">그룹이 없습니다.</li>}
        </ul>
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
                {groups.find((g) => g.id === selectedId)?.name} 멤버
              </h3>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(selectedId)}
                className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                <Trash2 className="h-3.5 w-3.5" /> 그룹 삭제
              </button>
            </div>

            {/* 멤버 추가 */}
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

            {/* 멤버 목록 */}
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
    </section>
  )
}
