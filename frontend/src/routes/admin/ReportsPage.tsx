/** 레포트 관리 (관리자) — 폴더 트리 구조 + 폴더/하위폴더 추가 + 레포트 게시/공개/권한/이동. */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, X, Upload, Folder, FolderPlus,
  ChevronRight, ChevronDown, Pencil, Trash2, FileBarChart, FolderInput,
  ArrowUp, ArrowDown,
} from 'lucide-react'

import { reportAdminApi, foldersAdminApi } from '@/api/reportAdminApi'
import type { FolderItem, ReportAdmin } from '@/types/reportAdmin'
import { useTaskStore } from '@/stores/useTaskStore'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import ReportPermissionPanel from './ReportPermissionPanel'
import FolderTreePicker from './FolderTreePicker'
import AuthorPicker from './AuthorPicker'

export default function ReportsPage() {
  const queryClient = useQueryClient()
  const [permsReportId, setPermsReportId] = useState<number | null>(null)
  // PBIX 업로드
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pbixFile, setPbixFile] = useState<File | null>(null)
  const [pbixName, setPbixName] = useState('')
  const [pbixFolderId, setPbixFolderId] = useState('')
  const [pbixDescription, setPbixDescription] = useState('')
  const [pbixAuthor, setPbixAuthor] = useState('')
  const addTask = useTaskStore((s) => s.addTask)
  // 레포트 수정/이동
  const [editReport, setEditReport] = useState<ReportAdmin | null>(null)
  const [editMode, setEditMode] = useState<'edit' | 'move'>('edit')
  const [editName, setEditName] = useState('')
  const [editFolderId, setEditFolderId] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  // 레포트 삭제 확인
  const [deleteTarget, setDeleteTarget] = useState<ReportAdmin | null>(null)
  const pbixInputRef = useRef<HTMLInputElement>(null)
  // 트리 펼침/폴더 추가 대상
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [addParentId, setAddParentId] = useState<number | null | 'root'>(null)
  const [newFolderName, setNewFolderName] = useState('')

  const reportsQuery = useQuery({
    queryKey: ['admin-reports'],
    queryFn: ({ signal }) => reportAdminApi.list(signal),
    staleTime: 30_000,
  })
  const foldersQuery = useQuery({
    queryKey: ['admin-folders'],
    queryFn: ({ signal }) => foldersAdminApi.list(signal),
    staleTime: 30_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-reports'] })
    queryClient.invalidateQueries({ queryKey: ['admin-folders'] })
  }

  // ---- mutations ----
  const editReportMutation = useMutation({
    mutationFn: async () => {
      if (!editReport) return
      if (editMode === 'edit') {
        const patch: { display_name?: string; description?: string; author_label?: string | null } = {}
        const newName = editName.trim()
        const curName = editReport.display_name ?? editReport.report_name ?? ''
        if (newName && newName !== curName) patch.display_name = newName
        const newDesc = editDescription.trim()
        if (newDesc !== (editReport.description ?? '')) patch.description = newDesc
        const newAuthor = editAuthor.trim()
        if (newAuthor !== (editReport.author_label ?? '')) patch.author_label = newAuthor || null
        if (Object.keys(patch).length > 0) {
          await reportAdminApi.update(editReport.id, patch)
        }
      } else {
        const newFolder = editFolderId ? Number(editFolderId) : null
        if (newFolder !== (editReport.folder_id ?? null)) {
          await reportAdminApi.setFolder(editReport.id, newFolder)
        }
      }
    },
    onSuccess: () => { setEditReport(null); invalidate() },
  })
  const deleteReportMutation = useMutation({
    mutationFn: (id: number) => reportAdminApi.remove(id),
    onSuccess: () => { setDeleteTarget(null); invalidate() },
  })
  // 같은 폴더 내 레포트 순서 재배치: 정렬된 형제 목록을 받아 변경분만 sort_order PATCH
  const reportReorderMutation = useMutation({
    mutationFn: async (ordered: ReportAdmin[]) => {
      await Promise.all(
        ordered
          .map((r, i) => ((r.sort_order ?? 0) !== i ? reportAdminApi.setSortOrder(r.id, i) : null))
          .filter((p): p is Promise<ReportAdmin> => p !== null),
      )
    },
    onSuccess: invalidate,
  })
  const createFolderMutation = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: number | null }) =>
      foldersAdminApi.create(name, parentId),
    onSuccess: () => { setAddParentId(null); setNewFolderName(''); invalidate() },
  })
  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => foldersAdminApi.rename(id, name),
    onSuccess: invalidate,
  })
  // 같은 레벨 폴더 순서 재배치: 정렬된 형제 목록을 받아 변경분만 sort_order PATCH
  const reorderMutation = useMutation({
    mutationFn: async (ordered: FolderItem[]) => {
      await Promise.all(
        ordered
          .map((f, i) => (f.sort_order !== i ? foldersAdminApi.setSortOrder(f.id, i) : null))
          .filter((p): p is Promise<FolderItem> => p !== null),
      )
    },
    onSuccess: invalidate,
  })
  const deleteFolderMutation = useMutation({
    mutationFn: (id: number) => foldersAdminApi.remove(id),
    onSuccess: invalidate,
    onError: () => alert('하위 폴더 또는 레포트가 있어 삭제할 수 없습니다. 먼저 비우세요.'),
  })
  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!pbixFile) throw new Error('PBIX 파일을 선택하세요.')
      return reportAdminApi.importPbix(
        pbixFile,
        pbixName.trim() || pbixFile.name.replace(/\.pbix$/i, ''),
        pbixFolderId ? Number(pbixFolderId) : null,
        pbixDescription.trim() || null,
        pbixAuthor.trim() || null,
      )
    },
    onSuccess: (res) => {
      const label = pbixName.trim() || pbixFile?.name?.replace(/\.pbix$/i, '') || '새 레포트'
      addTask({ id: res.task_id, label, kind: 'pbix_import', status: 'pending' })
      closeUpload()
    },
  })

  // 업로드(파일 전송) 진행 중에는 새로고침/창 닫기 시 경고 — 전송 취소 방지.
  useBeforeUnload(uploadMutation.isPending)
  function closeUpload() {
    setUploadOpen(false); setPbixFile(null); setPbixName(''); setPbixFolderId(''); setPbixDescription(''); setPbixAuthor(''); invalidate()
  }

  function openEdit(r: ReportAdmin, mode: 'edit' | 'move') {
    setEditReport(r)
    setEditMode(mode)
    setEditName(r.display_name ?? r.report_name ?? '')
    setEditFolderId(r.folder_id != null ? String(r.folder_id) : '')
    setEditDescription(r.description ?? '')
    setEditAuthor(r.author_label ?? '')
  }

  // ---- 트리 구성 ----
  const folders = foldersQuery.data ?? []
  const reports = reportsQuery.data ?? []
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

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- 렌더: 레포트 행 (컴포넌트가 아닌 렌더 함수 — 부모 리렌더 시 재마운트로 인한 한글 IME 끊김 방지) ----
  const renderReportRow = (r: ReportAdmin, depth: number) => {
    const name = r.display_name || r.report_name || r.report_id
    const siblings = reportsByFolder.get(r.folder_id ?? null) ?? []
    const idx = siblings.findIndex((x) => x.id === r.id)
    const isFirst = idx <= 0
    const isLast = idx >= siblings.length - 1
    const moveReport = (dir: -1 | 1) => {
      const target = idx + dir
      if (target < 0 || target >= siblings.length) return
      const next = [...siblings]
      const [m] = next.splice(idx, 1)
      next.splice(target, 0, m)
      reportReorderMutation.mutate(next)
    }
    return (
      <div key={r.id}
        className="grid grid-cols-[minmax(0,1.2fr)_190px_110px_150px_130px_minmax(0,1.4fr)_280px] items-center gap-3 rounded-md py-2 pr-2 text-sm hover:bg-slate-50">
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 + 4 }}>
          <FileBarChart className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="truncate text-slate-800" title={name}>{name}</span>
        </div>
        <span className="truncate font-mono text-xs text-slate-500" title={r.report_id}>{r.report_id}</span>
        <span className="text-slate-500">{r.created_at ? r.created_at.slice(0, 10) : '-'}</span>
        <span className="truncate text-slate-500" title={r.created_by_label ?? ''}>{r.created_by_label || '알 수 없음'}</span>
        <span className="truncate text-slate-500" title={r.author_label ?? ''}>{r.author_label || '-'}</span>
        <span className="truncate text-slate-500" title={r.description ?? ''}>{r.description || '-'}</span>
        <div className="flex shrink-0 items-center justify-end gap-1 whitespace-nowrap">
          <button type="button" disabled={isFirst} onClick={() => moveReport(-1)}
            title="위로" aria-label={`${name} 위로`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={isLast} onClick={() => moveReport(1)}
            title="아래로" aria-label={`${name} 아래로`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => openEdit(r, 'move')}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
            <FolderInput className="h-3.5 w-3.5" /> 이동
          </button>
          <button type="button" onClick={() => openEdit(r, 'edit')}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
            <Pencil className="h-3.5 w-3.5" /> 수정
          </button>
          <button type="button" onClick={() => setPermsReportId(permsReportId === r.id ? null : r.id)}
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-blue-600 hover:underline">
            <Shield className="h-3.5 w-3.5" /> 권한
          </button>
          <button type="button" onClick={() => setDeleteTarget(r)}
            aria-label={`${name} 삭제`}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" /> 삭제
          </button>
        </div>
      </div>
    )
  }

  // ---- 렌더: 폴더 노드 (재귀, 렌더 함수) ----
  const renderFolderNode = (folder: FolderItem, depth: number): ReactNode => {
    const isOpen = !collapsed.has(folder.id)
    const subFolders = childFolders.get(folder.id) ?? []
    const subReports = reportsByFolder.get(folder.id) ?? []
    const siblings = childFolders.get(folder.parent_id ?? null) ?? []
    const sibIdx = siblings.findIndex((f) => f.id === folder.id)
    const isFirst = sibIdx <= 0
    const isLast = sibIdx >= siblings.length - 1
    const move = (dir: -1 | 1) => {
      const target = sibIdx + dir
      if (target < 0 || target >= siblings.length) return
      const next = [...siblings]
      const [m] = next.splice(sibIdx, 1)
      next.splice(target, 0, m)
      reorderMutation.mutate(next)
    }
    return (
      <div key={folder.id}>
        <div className="flex items-center gap-1 rounded-md py-1.5 pr-2 hover:bg-slate-100" style={{ paddingLeft: depth * 20 + 4 }}>
          <button type="button" onClick={() => toggle(folder.id)} aria-label={isOpen ? '접기' : '펼치기'} className="shrink-0 text-slate-400">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="flex-1 truncate text-sm font-bold text-slate-800">{folder.name}</span>
          <button type="button" disabled={isFirst} onClick={() => move(-1)}
            title="위로" aria-label={`${folder.name} 위로`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-30"><ArrowUp className="h-[18px] w-[18px]" /></button>
          <button type="button" disabled={isLast} onClick={() => move(1)}
            title="아래로" aria-label={`${folder.name} 아래로`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-30"><ArrowDown className="h-[18px] w-[18px]" /></button>
          <button type="button" onClick={() => { setAddParentId(folder.id); setNewFolderName('') }}
            title="하위 폴더 추가" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600"><FolderPlus className="h-[18px] w-[18px]" /></button>
          <button type="button" onClick={() => { const n = prompt('폴더 이름', folder.name); if (n && n.trim()) renameFolderMutation.mutate({ id: folder.id, name: n.trim() }) }}
            title="이름 수정" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600"><Pencil className="h-[18px] w-[18px]" /></button>
          <button type="button" onClick={() => { if (confirm(`'${folder.name}' 폴더를 삭제할까요?`)) deleteFolderMutation.mutate(folder.id) }}
            title="삭제" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-[18px] w-[18px]" /></button>
        </div>

        {/* 하위 폴더 추가 인라인 입력 */}
        {addParentId === folder.id && (
          <div className="flex items-center gap-2 py-1" style={{ paddingLeft: (depth + 1) * 20 + 8 }}>
            <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="새 하위 폴더 이름"
              aria-label="새 하위 폴더 이름" className="rounded border border-slate-300 px-2 py-1 text-sm" />
            <button type="button" disabled={!newFolderName.trim()} onClick={() => createFolderMutation.mutate({ name: newFolderName.trim(), parentId: folder.id })}
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">추가</button>
            <button type="button" onClick={() => setAddParentId(null)} className="text-xs text-slate-400">취소</button>
          </div>
        )}

        {isOpen && (
          <div>
            {subFolders.map((sf) => renderFolderNode(sf, depth + 1))}
            {subReports.map((r) => renderReportRow(r, depth + 1))}
            {subFolders.length === 0 && subReports.length === 0 && (
              <p className="py-1 text-xs text-slate-400" style={{ paddingLeft: (depth + 1) * 20 + 28 }}>(비어 있음)</p>
            )}
          </div>
        )}
      </div>
    )
  }

  const rootFolders = childFolders.get(null) ?? []
  const rootReports = reportsByFolder.get(null) ?? []
  const permsReport = permsReportId !== null ? reports.find((r) => r.id === permsReportId) ?? null : null
  const permsReportName = permsReport
    ? (permsReport.display_name || permsReport.report_name || permsReport.report_id)
    : ''

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="portal-content-page-title">레포트 관리</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setAddParentId('root'); setNewFolderName('') }}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <FolderPlus className="h-4 w-4" /> 폴더 추가
          </button>
          <button type="button" onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
            <Upload className="h-4 w-4" /> PBIX 업로드 게시
          </button>
        </div>
      </div>

      {/* 루트 폴더 추가 인라인 */}
      {addParentId === 'root' && (
        <div className="mb-2 flex items-center gap-2">
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="새 폴더 이름"
            aria-label="새 폴더 이름" className="rounded border border-slate-300 px-2 py-1 text-sm" />
          <button type="button" disabled={!newFolderName.trim()} onClick={() => createFolderMutation.mutate({ name: newFolderName.trim(), parentId: null })}
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">추가</button>
          <button type="button" onClick={() => setAddParentId(null)} className="text-xs text-slate-400">취소</button>
        </div>
      )}

      {/* 트리 */}
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        {/* 컬럼 헤더 */}
        <div className="grid grid-cols-[minmax(0,1.2fr)_190px_110px_150px_130px_minmax(0,1.4fr)_280px] items-center gap-3 border-b border-slate-200 px-2 py-2.5 text-xs font-extrabold text-slate-500">
          <span className="pl-1">레포트명</span>
          <span>레포트 ID</span>
          <span>등록일</span>
          <span>생성자</span>
          <span>작성자</span>
          <span>설명</span>
          <span className="text-right">관리</span>
        </div>
        {reportsQuery.isLoading || foldersQuery.isLoading ? (
          <p className="px-2 py-6 text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <>
            {rootFolders.map((f) => renderFolderNode(f, 0))}
            {/* 미분류 레포트 */}
            {rootReports.length > 0 && (
              <div className="mt-1">
                <div className="flex items-center gap-1 px-1 py-1.5 text-sm font-medium text-slate-500" style={{ paddingLeft: 4 }}>
                  <Folder className="h-4 w-4 text-slate-300" /> (미분류)
                </div>
                {rootReports.map((r) => renderReportRow(r, 0))}
              </div>
            )}
            {folders.length === 0 && reports.length === 0 && (
              <p className="px-2 py-10 text-center text-sm text-slate-400">폴더나 레포트가 없습니다. "폴더 추가" 또는 "PBIX 업로드 게시"로 시작하세요.</p>
            )}
          </>
        )}
      </div>

      {/* 선택 레포트 권한 관리 모달 */}
      {permsReportId !== null && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="레포트 권한 관리" className="my-12 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                권한 관리{permsReportName ? <span className="text-slate-500"> — {permsReportName}</span> : null}
              </h3>
              <button type="button" aria-label="닫기" onClick={() => setPermsReportId(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <ReportPermissionPanel reportId={permsReportId} />
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setPermsReportId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* PBIX 업로드 게시 모달 */}
      {uploadOpen && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="PBIX 업로드 게시" className="my-12 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">PBIX 업로드 게시 (신규)</h3>
              <button type="button" aria-label="닫기" onClick={closeUpload} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (pbixFile) uploadMutation.mutate() }} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">PBIX 파일 *</span>
                  <input ref={pbixInputRef} type="file" accept=".pbix" aria-label="PBIX 파일" className="hidden"
                    onChange={(e) => setPbixFile(e.target.files?.[0] ?? null)} />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => pbixInputRef.current?.click()}
                      className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      파일 선택
                    </button>
                    <span className={`truncate text-sm ${pbixFile ? 'text-slate-700' : 'text-slate-400'}`}>
                      {pbixFile ? pbixFile.name : '선택된 파일 없음'}
                    </span>
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">레포트 이름 (비우면 파일명)</span>
                  <input value={pbixName} onChange={(e) => setPbixName(e.target.value)} aria-label="레포트 이름"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">설명</span>
                  <textarea value={pbixDescription} onChange={(e) => setPbixDescription(e.target.value)} aria-label="PBIX 레포트 설명"
                    rows={2} placeholder="레포트 용도/내용 간단 설명 (선택)"
                    className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-600">작성자 (현업 화면에 표시)</span>
                  <AuthorPicker value={pbixAuthor} onChange={setPbixAuthor} />
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">폴더 * (트리에서 선택)</span>
                  <FolderTreePicker folders={folders} value={pbixFolderId} onChange={setPbixFolderId} />
                </label>
                {uploadMutation.isError && <p role="alert" className="text-sm text-red-600">업로드 실패. 파일/이름을 확인하세요.</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={closeUpload} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
                  <button type="submit" disabled={!pbixFile || !pbixFolderId || uploadMutation.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                    {uploadMutation.isPending ? '업로드 중…' : '업로드 게시'}
                  </button>
                </div>
                <p className="text-xs text-amber-600">⚠️ 운영 워크스페이스에 실제 레포트가 새로 생성돼요. 게시 시작 후엔 좌측 하단 '진행중'에서 상태를 확인하세요.</p>
              </form>
          </div>
        </div>
      )}

      {/* 레포트 수정/이동 모달 */}
      {editReport && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label={editMode === 'edit' ? '레포트 수정' : '폴더 이동'} className="my-12 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">{editMode === 'edit' ? '레포트 수정' : '폴더 이동'}</h3>
              <button type="button" aria-label="닫기" onClick={() => setEditReport(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); editReportMutation.mutate() }} className="space-y-4">
              <p className="text-xs text-slate-400">대상: {editReport.display_name || editReport.report_name || editReport.report_id}</p>
              {editMode === 'edit' ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">레포트 표시명</span>
                    <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="레포트 표시명"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">설명</span>
                    <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} aria-label="레포트 설명 수정"
                      rows={3} placeholder="레포트 용도/내용 간단 설명 (선택)"
                      className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </label>
                  <div>
                    <span className="mb-1 block text-xs font-medium text-slate-600">작성자 (현업 화면에 표시)</span>
                    <AuthorPicker value={editAuthor} onChange={setEditAuthor} />
                  </div>
                </>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">폴더 위치 (트리에서 선택)</span>
                  <FolderTreePicker folders={folders} value={editFolderId} onChange={setEditFolderId} />
                </label>
              )}
              {editReportMutation.isError && <p role="alert" className="text-sm text-red-600">저장 실패. 다시 시도하세요.</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditReport(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
                <button type="submit" disabled={editReportMutation.isPending || (editMode === 'edit' && !editName.trim()) || (editMode === 'move' && !editFolderId)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 레포트 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="레포트 삭제 확인" className="my-24 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              <h3 className="text-lg font-bold text-slate-800">레포트 삭제</h3>
            </div>
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{deleteTarget.display_name || deleteTarget.report_name || deleteTarget.report_id}</span>
              {' '}레포트를 삭제하시겠습니까?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              포털 등록과 권한 부여가 함께 삭제됩니다. Power BI 워크스페이스의 실제 레포트는 삭제되지 않습니다.
            </p>
            {deleteReportMutation.isError && (
              <p role="alert" className="mt-2 text-sm text-red-600">
                {(deleteReportMutation.error as { errorDescription?: string })?.errorDescription
                  ?? '삭제에 실패했습니다. 이 레포트를 사용하는 메일 스케줄이 있는지 확인하세요.'}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" onClick={() => deleteReportMutation.mutate(deleteTarget.id)} disabled={deleteReportMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
                {deleteReportMutation.isPending ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
