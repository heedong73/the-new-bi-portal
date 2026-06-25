/** 사용자 관리 (T-38) — 목록 + 비활성화/재활성화. 요구사항: R4. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/api/adminApi'
import type { UserListItem } from '@/types/admin'

export default function UsersPage() {
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    staleTime: 30_000,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      usersApi.setStatus(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const users = usersQuery.data ?? []

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-slate-800">사용자 목록</h2>
      {usersQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">사번</th>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">메일</th>
                <th className="px-4 py-3">역할</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u: UserListItem) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-600">{u.emp_no}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{u.name}</td>
                  <td className="px-4 py-3 text-slate-500">{u.email ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span key={r} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">활성</span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">비활성</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => statusMutation.mutate({ id: u.id, isActive: !u.is_active })}
                      disabled={statusMutation.isPending}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                        u.is_active
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-blue-600 text-white hover:bg-blue-500'
                      }`}
                    >
                      {u.is_active ? '비활성화' : '재활성화'}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">사용자가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
