/** 레포트 다중 선택기 — 폴더 트리 아래 레포트를 검색·체크박스로 여러 개 고른다.
 *
 * '주체(그룹/사용자)를 먼저 고르고 레포트를 다중 선택'하는 권한 관리 흐름에서 사용한다.
 * 레포트별로 권한 버튼을 눌러 주체를 하나씩 검색하던 기존 방식의 번거로움을 줄인다.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileBarChart, Folder, Search } from 'lucide-react'

import type { FolderItem, ReportAdmin } from '@/types/reportAdmin'

interface Props {
  folders: FolderItem[]
  reports: ReportAdmin[]
  value: Set<number>
  onChange: (next: Set<number>) => void
}

export default function ReportMultiPicker({ folders, reports, value, onChange }: Props) {
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const term = q.trim().toLowerCase()
  const matches = (r: ReportAdmin) =>
    !term || `${r.display_name ?? ''} ${r.report_name ?? ''}`.toLowerCase().includes(term)

  const childFolders = useMemo(() => {
    const m = new Map<number | null, FolderItem[]>()
    for (const f of [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
      const key = f.parent_id ?? null
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(f)
    }
    return m
  }, [folders])
  const reportsByFolder = useMemo(() => {
    const m = new Map<number | null, ReportAdmin[]>()
    for (const r of reports) {
      const key = r.folder_id ?? null
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(r)
    }
    return m
  }, [reports])

  // 검색 중 결과가 있는 폴더만 펼쳐 보이도록, 하위에 매칭이 있는지 재귀 판정
  const folderHasMatch = useMemo(() => {
    const cache = new Map<number | null, boolean>()
    function check(folderId: number | null): boolean {
      if (cache.has(folderId)) return cache.get(folderId)!
      const ownReports = reportsByFolder.get(folderId) ?? []
      let has = ownReports.some(matches)
      if (!has) {
        for (const child of childFolders.get(folderId) ?? []) {
          if (check(child.id)) { has = true; break }
        }
      }
      cache.set(folderId, has)
      return has
    }
    return check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childFolders, reportsByFolder, term])

  function toggleReport(id: number) {
    const next = new Set(value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  function toggleFolderCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function selectAllInFolder(folderId: number | null, checked: boolean) {
    const ids = (reportsByFolder.get(folderId) ?? []).filter(matches).map((r) => r.id)
    const next = new Set(value)
    for (const id of ids) {
      if (checked) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  const renderFolder = (folder: FolderItem, depth: number): ReactNode => {
    if (term && !folderHasMatch(folder.id)) return null
    const isOpen = term ? true : !collapsed.has(folder.id)
    const subFolders = childFolders.get(folder.id) ?? []
    const subReports = (reportsByFolder.get(folder.id) ?? []).filter(matches)
    return (
      <div key={folder.id}>
        <div className="flex items-center gap-1 py-1" style={{ paddingLeft: depth * 16 + 4 }}>
          <button type="button" onClick={() => toggleFolderCollapse(folder.id)} aria-label={isOpen ? '접기' : '펼치기'} className="shrink-0 text-slate-400">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="truncate text-sm font-medium text-slate-700">{folder.name}</span>
          {subReports.length > 0 && (
            <button type="button" onClick={() => selectAllInFolder(folder.id, !subReports.every((r) => value.has(r.id)))}
              className="ml-auto shrink-0 text-xs text-blue-600 hover:underline">
              {subReports.every((r) => value.has(r.id)) ? '전체 해제' : '전체 선택'}
            </button>
          )}
        </div>
        {isOpen && (
          <div>
            {subFolders.map((sf) => renderFolder(sf, depth + 1))}
            {subReports.map((r) => renderReport(r, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const renderReport = (r: ReportAdmin, depth: number): ReactNode => {
    const name = r.display_name || r.report_name || r.report_id
    const checked = value.has(r.id)
    return (
      <label
        key={r.id}
        className={`flex items-center gap-2 rounded py-1 pr-2 text-sm hover:bg-slate-50 ${checked ? 'bg-blue-50/60' : ''}`}
        style={{ paddingLeft: depth * 16 + 26 }}
      >
        <input type="checkbox" checked={checked} onChange={() => toggleReport(r.id)} className="h-3.5 w-3.5 rounded border-slate-300" />
        <FileBarChart className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        <span className="truncate text-slate-700">{name}</span>
      </label>
    )
  }

  const roots = childFolders.get(null) ?? []
  const rootReports = (reportsByFolder.get(null) ?? []).filter(matches)

  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="레포트 검색"
          aria-label="레포트 검색"
          className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm"
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-300 p-1">
        {roots.map((f) => renderFolder(f, 0))}
        {rootReports.map((r) => renderReport(r, 0))}
        {roots.length === 0 && rootReports.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-slate-400">레포트가 없습니다.</p>
        )}
      </div>
      <p className="mt-1 text-right text-xs text-slate-400">{value.size}개 선택</p>
    </div>
  )
}
