/** 허용 계열사(최상위 폴더) 다중 선택기 — 그룹에 계열사를 지정하면 하위 전체 레포트에 VIEW 자동 부여. */
import { Building2 } from 'lucide-react'

import type { FolderItem } from '@/types/reportAdmin'

interface Props {
  folders: FolderItem[]
  /** 선택된 최상위 폴더 id 집합. */
  value: Set<number>
  onChange: (next: Set<number>) => void
}

export default function CompanyScopePicker({ folders, value, onChange }: Props) {
  const roots = [...folders]
    .filter((f) => f.parent_id == null)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  function toggle(id: number) {
    const next = new Set(value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  if (roots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">
        최상위 폴더(계열사)가 없습니다.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-slate-300 p-2">
      {roots.map((f) => {
        const checked = value.has(f.id)
        return (
          <label
            key={f.id}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              checked ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(f.id)}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            <Building2 className={`h-3.5 w-3.5 ${checked ? 'text-blue-500' : 'text-slate-400'}`} />
            {f.name}
          </label>
        )
      })}
    </div>
  )
}
