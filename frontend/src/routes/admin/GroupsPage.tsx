/** 그룹 관리 — 팀 그룹 트리·수동 그룹 생성과 그룹원 관리. */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserMinus, UserPlus } from 'lucide-react'

import { groupsApi, usersApi } from '@/api/adminApi'
import { UserPicker } from './EntityPicker'
import GroupTreeSelector, { type GroupSelection } from './GroupTreeSelector'

export default function GroupsPage() {
  const queryClient = useQueryClient()
  const [selectedGroup, setSelectedGroup] = useState<GroupSelection | null>(null)
  const [addUserId, setAddUserId] = useState<number | null>(null)
  const selectedId = selectedGroup?.id ?? null

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

  function invalidateTree() {
    queryClient.invalidateQueries({ queryKey: ['admin-group-tree'] })
    queryClient.invalidateQueries({ queryKey: ['admin-groups'] })
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['org-members'] })
  }

  function invalidateMembers() {
    queryClient.invalidateQueries({ queryKey: ['admin-group-members', selectedId] })
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['org-members'] })
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => groupsApi.remove(id),
    onSuccess: () => {
      setSelectedGroup(null)
      setAddUserId(null)
      invalidateTree()
    },
  })
  const addMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      groupsApi.addMember(groupId, userId),
    onSuccess: () => {
      setAddUserId(null)
      invalidateMembers()
    },
  })
  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      groupsApi.removeMember(groupId, userId),
    onSuccess: invalidateMembers,
  })

  const users = usersQuery.data ?? []
  const members = membersQuery.data ?? []
  const memberIds = new Set(members.map((member) => member.id))
  const selectableUsers = users.filter((user) => !memberIds.has(user.id))

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
      <div>
        <h2 className="portal-content-page-title portal-content-page-title--mb-3">그룹</h2>
        <GroupTreeSelector
          selectedId={selectedId}
          onSelect={(group) => {
            setSelectedGroup(group)
            setAddUserId(null)
          }}
          onGroupsChanged={() => queryClient.invalidateQueries({ queryKey: ['admin-group-members'] })}
        />
      </div>

      <div>
        {selectedGroup === null ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 py-20 text-slate-400">
            그룹을 선택하세요.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{selectedGroup.name} 멤버</h3>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(selectedGroup.id)}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> 그룹 삭제
              </button>
            </div>

            <div className="mb-4 flex gap-2">
              <UserPicker
                users={selectableUsers}
                value={addUserId}
                onChange={setAddUserId}
                loading={usersQuery.isLoading}
                disabled={addMemberMutation.isPending || selectableUsers.length === 0}
                placeholder={selectableUsers.length === 0 ? '추가할 사용자가 없습니다.' : '이름·사번·이메일 검색'}
                ariaLabel="추가할 사용자"
                className="min-w-0 flex-1"
                inputClassName="py-2"
              />
              <button
                type="button"
                disabled={addUserId === null || addMemberMutation.isPending}
                onClick={() => {
                  if (addUserId !== null) {
                    addMemberMutation.mutate({ groupId: selectedGroup.id, userId: addUserId })
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" /> 추가
              </button>
            </div>

            {addMemberMutation.isError && (
              <p role="alert" className="mb-3 text-xs text-red-600">사용자를 그룹에 추가하지 못했습니다.</p>
            )}
            {deleteMutation.isError && (
              <p role="alert" className="mb-3 text-xs text-red-600">그룹을 삭제하지 못했습니다.</p>
            )}

            {membersQuery.isLoading ? (
              <p className="text-sm text-slate-400">멤버 불러오는 중…</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-slate-700">
                      {member.name} <span className="font-mono text-xs text-slate-400">({member.emp_no})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMemberMutation.mutate({ groupId: selectedGroup.id, userId: member.id })}
                      aria-label={`${member.name} 제거`}
                      disabled={removeMemberMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <UserMinus className="h-3.5 w-3.5" /> 제거
                    </button>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-6 text-center text-sm text-slate-400">멤버가 없습니다.</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
