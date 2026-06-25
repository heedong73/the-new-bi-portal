/** 폴더 트리 선택기 — 같은 이름 폴더를 계층으로 구분해 고를 수 있는 라디오형 트리. (미분류 옵션 없음) */
import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'

import type { FolderItem } from '@/types/reportAdmin'

interface Props {
  folders: FolderItem[]
  /** 선택된 폴더 id (문자열). 빈 문자열이면 미선택. */
  value: string
  onChange: (id: string) => void
  emptyHint?: string
}

export default function FolderTreePicker({ folders, value, onChange, emptyHint }: Props) {
  const byParent = new Map<number | null, FolderItem[]>()
  for (const f of [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
    const key = f.parent_id ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(f)
  }

  const renderNode = (f: FolderItem, depth: number): ReactNode => {
    const children = byParent.get(f.id) ?? []
    const selected = value === String(f.id)
    return (
      <div key={f.id}>
        <button
          type="button"
          onClick={() => onChange(String(f.id))}
          aria-pressed={selected}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
            selected ? 'bg-blue-100 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-100'
          }`}
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          <Folder className={`h-4 w-4 shrink-0 ${selected ? 'text-blue-500' : 'text-amber-500'}`} />
          <span className="truncate">{f.name}</span>
        </button>
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  const roots = byParent.get(null) ?? []
  if (roots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">
        {emptyHint ?? '폴더가 없습니다. 먼저 "폴더 추가"로 폴더를 만드세요.'}
      </p>
    )
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-300 p-1">
      {roots.map((f) => renderNode(f, 0))}
    </div>
  )
}
