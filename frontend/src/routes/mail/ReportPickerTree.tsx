/** 레포트 선택 트리 (메일 스케줄용) — 폴더 구조 그대로, 말단에서 레포트 선택.
 *
 * 폴더(계층) + 각 폴더의 레포트를 함께 보여주고, 레포트를 클릭해 1개를 선택한다.
 * 폴더는 펼치기/접기만. 폴더 미지정 레포트는 "미분류"로 표시.
 * 상단 검색창에 입력하면 폴더명·레포트명으로 걸러내고, 남은 경로는 자동으로 펼친다.
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderOpen, FileBarChart, ChevronRight, ChevronDown, Search, X } from 'lucide-react'

import { foldersAdminApi, reportAdminApi } from '@/api/reportAdminApi'
import type { FolderItem, ReportAdmin } from '@/types/reportAdmin'

function reportName(r: ReportAdmin): string {
  return r.display_name || r.report_name || r.report_id
}

/** 검색 비교용 정규화. 앞뒤 공백과 대소문자 차이는 무시한다. */
function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ko')
}

/** 로딩 중 기본값. 참조가 고정돼야 useMemo 의존성이 안정적으로 유지된다. */
const NO_FOLDERS: FolderItem[] = []
const NO_REPORTS: ReportAdmin[] = []

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

  // ?? [] 를 인라인으로 쓰면 렌더마다 새 배열이 생겨 아래 useMemo가 매번 다시 계산된다.
  const folders = foldersQuery.data ?? NO_FOLDERS
  const reports = reportsQuery.data ?? NO_REPORTS

  const [query, setQuery] = useState('')
  const term = normalize(query)
  const searching = term !== ''

  // 수정 화면의 선택 레포트가 보이도록 해당 폴더부터 루트까지의 경로를 구한다.
  const selectedFolderPath = useMemo(() => {
    const selectedReport = reports.find((report) => report.id === value)
    if (selectedReport?.folder_id == null) return new Set<number>()

    const folderById = new Map(folders.map((folder) => [folder.id, folder]))
    const path = new Set<number>()
    let folderId: number | null = selectedReport.folder_id
    while (folderId != null && !path.has(folderId)) {
      path.add(folderId)
      folderId = folderById.get(folderId)?.parent_id ?? null
    }
    return path
  }, [folders, reports, value])

  // 선택 경로는 자동으로 열고, 그 밖의 폴더는 기본적으로 접는다.
  // 사용자가 선택 경로를 직접 접은 상태는 현재 레포트별로 구분해 새 선택 경로를 막지 않는다.
  const [openState, setOpenState] = useState(() => ({
    selectedReportId: value,
    openFolders: new Set<number>(),
    closedSelectedFolders: new Set<number>(),
  }))
  const toggle = (id: number) => {
    setOpenState((current) => {
      const openFolders = new Set(current.openFolders)
      const closedSelectedFolders = current.selectedReportId === value
        ? new Set(current.closedSelectedFolders)
        : new Set<number>()
      const selectedPathOpen = selectedFolderPath.has(id) && !closedSelectedFolders.has(id)
      const currentlyOpen = openFolders.has(id) || selectedPathOpen

      if (currentlyOpen) {
        openFolders.delete(id)
        if (selectedFolderPath.has(id)) closedSelectedFolders.add(id)
      } else {
        openFolders.add(id)
        closedSelectedFolders.delete(id)
      }

      return { selectedReportId: value, openFolders, closedSelectedFolders }
    })
  }

  const childrenOf = useMemo(() => {
    const map = new Map<number | null, FolderItem[]>()
    for (const f of [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
      const key = f.parent_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(f)
    }
    return map
  }, [folders])

  const reportsOf = useMemo(() => {
    const map = new Map<number | null, ReportAdmin[]>()
    for (const r of [...reports].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      const key = r.folder_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return map
  }, [reports])

  /** 검색어에 걸린 항목과 그 상위 경로만 남긴다(검색 중이 아니면 null = 전체 표시). */
  const filtered = useMemo(() => {
    if (!searching) return null

    const folderById = new Map(folders.map((f) => [f.id, f]))

    // 폴더명이 걸리면 그 안의 하위 폴더·레포트도 이어서 탐색할 수 있게 모두 포함한다.
    const insideMatchedFolder = new Set<number>()
    const stack = folders.filter((f) => normalize(f.name).includes(term)).map((f) => f.id)
    while (stack.length > 0) {
      const id = stack.pop()!
      if (insideMatchedFolder.has(id)) continue
      insideMatchedFolder.add(id)
      for (const child of childrenOf.get(id) ?? []) stack.push(child.id)
    }

    const visibleReports = new Set<number>()
    for (const r of reports) {
      const inMatchedFolder = r.folder_id != null && insideMatchedFolder.has(r.folder_id)
      if (inMatchedFolder || normalize(reportName(r)).includes(term)) visibleReports.add(r.id)
    }

    // 걸린 항목까지 내려가는 상위 폴더가 없으면 트리에서 보이지 않으므로 조상도 채운다.
    const visibleFolders = new Set<number>(insideMatchedFolder)
    const addSelfAndAncestors = (folderId: number | null) => {
      let current = folderId
      while (current != null && !visibleFolders.has(current)) {
        visibleFolders.add(current)
        current = folderById.get(current)?.parent_id ?? null
      }
    }
    for (const id of insideMatchedFolder) addSelfAndAncestors(folderById.get(id)?.parent_id ?? null)
    for (const r of reports) {
      if (visibleReports.has(r.id)) addSelfAndAncestors(r.folder_id ?? null)
    }

    return { visibleFolders, visibleReports }
  }, [searching, term, folders, reports, childrenOf])

  const visibleFoldersOf = (parentId: number | null): FolderItem[] => {
    const list = childrenOf.get(parentId) ?? []
    return filtered === null ? list : list.filter((f) => filtered.visibleFolders.has(f.id))
  }
  const visibleReportsOf = (folderId: number | null): ReportAdmin[] => {
    const list = reportsOf.get(folderId) ?? []
    return filtered === null ? list : list.filter((r) => filtered.visibleReports.has(r.id))
  }

  const isLoading = foldersQuery.isLoading || reportsQuery.isLoading

  const renderReport = (r: ReportAdmin, depth: number): ReactNode => {
    const selected = value === r.id
    return (
      <button
        key={`r-${r.id}`}
        type="button"
        onClick={() => onChange(r.id, reportName(r))}
        className={`mail-report-tree-item flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] ${
          selected ? 'bg-blue-100 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
        }`}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <FileBarChart className="h-[0.64rem] w-[0.64rem] shrink-0 text-slate-400" />
        <span className="truncate">{reportName(r)}</span>
      </button>
    )
  }

  const renderFolder = (f: FolderItem, depth: number): ReactNode => {
    const subFolders = visibleFoldersOf(f.id)
    const subReports = visibleReportsOf(f.id)
    const expandable = subFolders.length > 0 || subReports.length > 0
    // 검색 중이거나 직접 펼쳤거나, 현재 선택된 레포트까지의 경로면 연다.
    const selectedPathOpen = selectedFolderPath.has(f.id)
      && (openState.selectedReportId !== value || !openState.closedSelectedFolders.has(f.id))
    const isOpen = searching || openState.openFolders.has(f.id) || selectedPathOpen
    return (
      <div key={`f-${f.id}`}>
        <button
          type="button"
          onClick={() => expandable && !searching && toggle(f.id)}
          className="mail-report-tree-item flex w-full items-center gap-1 rounded bg-slate-100 px-2 py-1 text-left text-[13px] text-slate-700 hover:bg-slate-200"
          style={{ paddingLeft: depth * 16 + 8 }}
        >
          {isOpen ? <FolderOpen className="h-[0.64rem] w-[0.64rem] shrink-0 text-amber-500" /> : <Folder className="h-[0.64rem] w-[0.64rem] shrink-0 text-amber-500" />}
          <span className="flex-1 truncate">{f.name}</span>
          {expandable && !searching ? (
            isOpen ? <ChevronDown className="h-[0.56rem] w-[0.56rem] text-slate-400" /> : <ChevronRight className="h-[0.56rem] w-[0.56rem] text-slate-400" />
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

  // 검색창은 메일 스케줄 폼 안에 있어 Enter가 폼 저장으로 이어지지 않도록 막는다.
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') event.preventDefault()
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
    }
  }

  const rootFolders = visibleFoldersOf(null)
  const rootReports = visibleReportsOf(null)
  const isEmpty = folders.length === 0 && reports.length === 0
  const noMatch = rootFolders.length === 0 && rootReports.length === 0
  // 로딩·빈 목록·검색 결과 없음도 트리와 같은 박스 안에서 같은 높이로 표시한다.
  const placeholder = isLoading
    ? '불러오는 중…'
    : isEmpty
      ? '등록된 레포트가 없습니다.'
      : noMatch
        ? '검색 결과가 없습니다.'
        : null

  return (
    <div className="rounded-lg border border-slate-300 p-1">
      <div className="relative px-1 pb-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          aria-label="폴더·레포트 검색"
          placeholder="폴더 또는 레포트명 검색…"
          disabled={isLoading || isEmpty}
          className="mail-report-tree-search w-full rounded border border-slate-200 py-1 pl-7 pr-7 text-[13px] outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="검색어 지우기"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* 검색·펼침 결과에 따라 박스가 늘거나 줄지 않도록 높이를 230.4px로 고정한다. */}
      <div className="h-[14.4rem] overflow-y-auto">
        {placeholder !== null ? (
          <p className="px-2 py-4 text-center text-[10px] text-slate-400">{placeholder}</p>
        ) : (
          <>
            {rootFolders.map((f) => renderFolder(f, 0))}
            {rootReports.length > 0 && (
              <div className="mt-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">미분류</div>
                {rootReports.map((r) => renderReport(r, 0))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
