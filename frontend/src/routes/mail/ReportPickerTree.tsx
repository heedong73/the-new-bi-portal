/** 레포트 선택 트리 (메일 스케줄용) — 폴더 구조 그대로, 말단에서 레포트 선택.
 *
 * 폴더(계층) + 각 폴더의 레포트를 함께 보여주고, 레포트를 클릭해 1개를 선택한다.
 * 폴더는 펼치기/접기만. 폴더 미지정 레포트는 "미분류"로 표시.
 */
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderOpen, FileBarChart, ChevronRight, ChevronDown } from 'lucide-react'

import { foldersAdminApi, reportAdminApi } from '@/api/reportAdminApi'
import type { FolderItem, ReportAdmin } from '@/types/reportAdmin'

function reportName(r: ReportAdmin): string {
  return r.display_name || r.report_name || r.report_id
}

interface Props {
  value: number // 선택된 report id (0이면 미선택)
  onChange: (reportId: number, reportLabel: string) => void
}

export default function ReportPickerTree({ value, onChange }: Props) {
  const foldersQuery = useQuery({
    queryKey: ['admin-folders'],
    queryFn: ({ signal }) => foldersAdminApi.list(signal),
    staleTime: 60_000,
  })
  const reportsQuery = useQuery({
    queryKey: ['admin-reports'],
    queryFn: ({ signal }) => reportAdminApi.list(signal),
    staleTime: 30_000,
  })

  const folders = foldersQuery.data ?? []
  const reports = reportsQuery.data ?? []

  // 펼침 상태(폴더 id 집합). 기본 전체 펼침.
  const [open, setOpen] = useState<Set<number> | null>(null)
  const openSet = open ?? new Set<number>(folders.map((f) => f.id))
  const toggle = (id: number) => {
    const next = new Set(openSet)
    next.has(id) ? next.delete(id) : next.add(id)
    setOpen(next)
  }

  const childrenOf = new Map<number | null, FolderItem[]>()
  for (const f of [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
    const key = f.parent_id ?? null
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(f)
  }
  const reportsOf = new Map<number | null, ReportAdmin[]>()
  for (const r of [...reports].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const key = r.folder_id ?? null
    if (!reportsOf.has(key)) reportsOf.set(key, [])
    reportsOf.get(key)!.push(r)
  }

  const isLoading = foldersQuery.isLoading || reportsQuery.isLoading

  const renderReport = (r: ReportAdmin, depth: number): ReactNode => {
    const selected = value === r.id
    return (
      <button
        key={`r-${r.id}`}
        type="button"
        onClick={() => onChange(r.id, reportName(r))}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
          selected ? 'bg-blue-100 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
        }`}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <FileBarChart className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="truncate">{reportName(r)}</span>
      </button>
    )
  }

  const renderFolder = (f: FolderItem, depth: number): ReactNode => {
    const subFolders = childrenOf.get(f.id) ?? []
    const subReports = reportsOf.get(f.id) ?? []
    const expandable = subFolders.length > 0 || subReports.length > 0
    const isOpen = openSet.has(f.id)
    return (
      <div key={`f-${f.id}`}>
        <button
          type="button"
          onClick={() => expandable && toggle(f.id)}
          className="flex w-full items-center gap-1 rounded bg-slate-100 px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-200"
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          {isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
          <span className="flex-1 truncate">{f.name}</span>
          {expandable ? (
            isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          ) : null}
        </button>
        {isOpen && (
          <div>
            {subFolders.map((sf) => renderFolder(sf, depth + 1))}
            {subReports.map((r) => renderReport(r, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootFolders = childrenOf.get(null) ?? []
  const rootReports = reportsOf.get(null) ?? []

  if (isLoading) {
    return <p className="rounded-lg border border-slate-300 px-3 py-4 text-center text-xs text-slate-400">불러오는 중…</p>
  }
  if (rootFolders.length === 0 && rootReports.length === 0) {
    return <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">등록된 레포트가 없습니다.</p>
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-300 p-1">
      {rootFolders.map((f) => renderFolder(f, 0))}
      {rootReports.length > 0 && (
        <div className="mt-1">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">미분류</div>
          {rootReports.map((r) => renderReport(r, 0))}
        </div>
      )}
    </div>
  )
}
