/** 역할 관리 (T-38) — 사용자별 역할 부여/회수. 요구사항: R7. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, rolesApi } from '@/api/adminApi'
import type { RoleResponse, UserListItem } from '@/types/admin'

const GENERAL_USER = 'General_User'

export default function RolesPage() {
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    staleTime: 30_000,
  })
  const rolesQuery = useQuery({
    queryKey: ['admin-roles'],
    queryFn: ({ signal }) => rolesApi.list(signal),
    staleTime: 5 * 60_000,
  })

  const assignMutation = useMutation({
    mutationFn: ({ userId, code }: { userId: number; code: string }) =>
      usersApi.assignRole(userId, code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })
  const revokeMutation = useMutation({
    mutationFn: ({ userId, code }: { userId: number; code: string }) =>
      usersApi.revokeRole(userId, code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const users = usersQuery.data ?? []
  const roles = rolesQuery.data ?? []
  const pending = assignMutation.isPending || revokeMutation.isPending

  function toggle(user: UserListItem, role: RoleResponse, has: boolean) {
    if (role.code === GENERAL_USER) return // 최소 역할: 회수 불가
    if (has) revokeMutation.mutate({ userId: user.id, code: role.code })
    else assignMutation.mutate({ userId: user.id, code: role.code })
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-slate-800">역할 관리</h2>
      <p className="mb-3 text-sm text-slate-500">
        사용자별 역할을 부여/회수합니다. General_User는 기본 역할이라 회수할 수 없습니다.
      </p>
      {usersQuery.isLoading || rolesQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">사번</th>
                <th className="px-4 py-3">이름</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-4 py-3 text-center">{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-600">{u.emp_no}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{u.name}</td>
                  {roles.map((r) => {
                    const has = u.roles.includes(r.code)
                    const locked = r.code === GENERAL_USER
                    return (
                      <td key={r.id} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={has}
                          disabled={locked || pending}
                          aria-label={`${u.name} ${r.name}`}
                          onChange={() => toggle(u, r, has)}
                          className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
