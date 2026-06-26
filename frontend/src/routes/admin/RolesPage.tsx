/** 역할 관리 — 역할별 메뉴(페이지) 접근 권한 매트릭스. 변경분 일괄 저장. */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'

import { rolesApi } from '@/api/adminApi'

const SYSTEM_OPERATOR = 'System_Operator'

export default function RolesPage() {
  const qc = useQueryClient()
  const menusQuery = useQuery({
    queryKey: ['role-menus'],
    queryFn: ({ signal }) => rolesApi.getMenus(signal),
    staleTime: 60_000,
  })

  // draft: roleId -> Set<menuKey>
  const [draft, setDraft] = useState<Record<number, Set<string>>>({})

  const original = useMemo(() => {
    const m: Record<number, Set<string>> = {}
    for (const r of menusQuery.data?.roles ?? []) m[r.id] = new Set(r.menus)
    return m
  }, [menusQuery.data])

  useEffect(() => {
    if (menusQuery.data) {
      const m: Record<number, Set<string>> = {}
      for (const r of menusQuery.data.roles) m[r.id] = new Set(r.menus)
      setDraft(m)
    }
  }, [menusQuery.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const roles = menusQuery.data?.roles ?? []
      await Promise.all(
        roles
          .filter((r) => r.code !== SYSTEM_OPERATOR && _changed(original[r.id], draft[r.id]))
          .map((r) => rolesApi.setMenus(r.id, Array.from(draft[r.id] ?? []))),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['role-menus'] })
      qc.invalidateQueries({ queryKey: ['me'] }) // 사이드바 갱신
    },
  })

  const catalog = menusQuery.data?.catalog ?? []
  const roles = menusQuery.data?.roles ?? []

  const dirty = roles.some((r) => r.code !== SYSTEM_OPERATOR && _changed(original[r.id], draft[r.id]))

  function toggle(roleId: number, code: string, key: string) {
    if (code === SYSTEM_OPERATOR) return // 운영자는 전체 고정
    setDraft((prev) => {
      const next = { ...prev }
      const set = new Set(next[roleId] ?? [])
      set.has(key) ? set.delete(key) : set.add(key)
      next[roleId] = set
      return next
    })
  }

  function isChecked(role: { id: number; code: string }, key: string): boolean {
    if (role.code === SYSTEM_OPERATOR) return true
    return draft[role.id]?.has(key) ?? false
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">역할 관리 · 메뉴 권한</h2>
          <p className="mt-1 text-sm text-slate-500">
            역할별로 접근 가능한 메뉴를 지정합니다. 변경 후 저장하면 사이드바/접근 권한에 반영됩니다.
            System_Operator는 항상 전체 권한입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? '저장 중…' : '변경사항 저장'}
        </button>
      </div>

      {saveMutation.isError && (
        <p role="alert" className="mb-3 text-sm text-red-600">저장에 실패했습니다. 다시 시도하세요.</p>
      )}
      {saveMutation.isSuccess && !dirty && (
        <p className="mb-3 text-sm text-green-700">저장되었습니다.</p>
      )}

      {menusQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">메뉴</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-4 py-3 text-center">{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catalog.map((m) => (
                <tr key={m.key} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-700">{m.label}</td>
                  {roles.map((r) => {
                    const locked = r.code === SYSTEM_OPERATOR
                    return (
                      <td key={r.id} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked(r, m.key)}
                          disabled={locked || saveMutation.isPending}
                          aria-label={`${r.name} ${m.label}`}
                          onChange={() => toggle(r.id, r.code, m.key)}
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

function _changed(a?: Set<string>, b?: Set<string>): boolean {
  const sa = a ?? new Set<string>()
  const sb = b ?? new Set<string>()
  if (sa.size !== sb.size) return true
  for (const x of sa) if (!sb.has(x)) return true
  return false
}
