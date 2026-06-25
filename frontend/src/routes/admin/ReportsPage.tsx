/** 레포트 관리 (관리자) — 폴더 트리 구조 + 폴더/하위폴더 추가 + 레포트 게시/공개/권한/이동. */
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Shield, X, Upload, Folder, FolderPlus,
  ChevronRight, ChevronDown, Pencil, Trash2, FileBarChart, FolderInput,
  ArrowUp, ArrowDown,
} from 'lucide-react'

import { reportAdminApi, foldersAdminApi } from '@/api/reportAdminApi'
import type { FolderItem, ReportAdmin } from '@/types/reportAdmin'
import ReportPermissionPanel from './ReportPermissionPanel'
import FolderTreePicker from './FolderTreePicker'

export default function ReportsPage() {
  const queryClient = useQueryClient()
  const [registerOpen, setRegisterOpen] = useState(false)
  const [selectedPbi, setSelectedPbi] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [registerFolderId, setRegisterFolderId] = useState('')
  const [registerDescription, setRegisterDescription] = useState('')
  const [permsReportId, setPermsReportId] = useState<number | null>(null)
  // PBIX 업로드
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pbixFile, setPbixFile] = useState<File | null>(null)
  const [pbixName, setPbixName] = useState('')
  const [pbixFolderId, setPbixFolderId] = useState('')
  const [pbixDescription, setPbixDescription] = useState('')
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null)
  // 레포트 수정/이동
  const [editReport, setEditReport] = useState<ReportAdmin | null>(null)
  const [editMode, setEditMode] = useState<'edit' | 'move'>('edit')
  const [editName, setEditName] = useState('')
  const [editFolderId, setEditFolderId] = useState('')
  const [editDescription, setEditDescription] = useState('')
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
  const wsQuery = useQuery({
    queryKey: ['ws-reports'],
    queryFn: ({ signal }) => reportAdminApi.workspaceReports(signal),
    enabled: registerOpen,
    staleTime: 5 * 60_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-reports'] })
    queryClient.invalidateQueries({ queryKey: ['admin-folders'] })
  }

  // ---- mutations ----
  const createReportMutation = useMutation({
    mutationFn: () => {
      const r = (wsQuery.data ?? []).find((x) => x.report_id === selectedPbi)
      if (!r) throw new Error('레포트를 선택하세요.')
      return reportAdminApi.create({
        workspace_id: r.workspace_id, report_id: r.report_id,
        dataset_id: r.dataset_id ?? null, report_name: r.report_name,
        display_name: displayName.trim() || r.report_name,
        folder_id: registerFolderId ? Number(registerFolderId) : null,
        description: registerDescription.trim() || null,
      })
    },
    onSuccess: () => {
      setRegisterOpen(false); setSelectedPbi(''); setDisplayName('')
      setRegisterFolderId(''); setRegisterDescription(''); invalidate()
    },
  })
  const editReportMutation = useMutation({
    mutationFn: async () => {
      if (!editReport) return
      if (editMode === 'edit') {
        const patch: { display_name?: string; description?: string } = {}
        const newName = editName.trim()
        const curName = editReport.display_name ?? editReport.report_name ?? ''
        if (newName && newName !== curName) patch.display_name = newName
        const newDesc = editDescription.trim()
        if (newDesc !== (editReport.description ?? '')) patch.description = newDesc
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
      )
    },
    onSuccess: (res) => setUploadTaskId(res.task_id),
  })
  const uploadStatus = useQuery({
    queryKey: ['pbix-status', uploadTaskId],
    queryFn: () => reportAdminApi.importStatus(uploadTaskId as string),
    enabled: uploadTaskId !== null,
    refetchInterval: (q) => {
      const st = (q.state.data as any)?.state
      return st === 'SUCCESS' || st === 'FAILURE' ? false : 2000
    },
  })
  function closeUpload() {
    setUploadOpen(false); setPbixFile(null); setPbixName(''); setPbixFolderId(''); setPbixDescription(''); setUploadTaskId(null); invalidate()
  }

  function openEdit(r: ReportAdmin, mode: 'edit' | 'move') {
    setEditReport(r)
    setEditMode(mode)
    setEditName(r.display_name ?? r.report_name ?? '')
    setEditFolderId(r.folder_id != null ? String(r.folder_id) : '')
    setEditDescription(r.description ?? '')
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
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const registeredPbiIds = new Set(reports.map((r) => r.report_id))
  const wsCandidates = (wsQuery.data ?? []).filter((r) => !registeredPbiIds.has(r.report_id))

  // ---- 렌더: 레포트 행 (컴포넌트가 아닌 렌더 함수 — 부모 리렌더 시 재마운트로 인한 한글 IME 끊김 방지) ----
  const renderReportRow = (r: ReportAdmin, depth: number) => (
      <div key={r.id} className="rounded-md py-1.5 pr-2 hover:bg-slate-50" style={{ paddingLeft: depth * 20 + 28 }}>
        <div className="flex items-center gap-2">
          <FileBarChart className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="flex-1 truncate text-sm text-slate-800">{r.display_name || r.report_name || r.report_id}</span>
          <button type="button" onClick={() => openEdit(r, 'move')}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
            <FolderInput className="h-3.5 w-3.5" /> 이동
          </button>
          <button type="button" onClick={() => openEdit(r, 'edit')}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
            <Pencil className="h-3.5 w-3.5" /> 수정
          </button>
          <button type="button" onClick={() => setPermsReportId(permsReportId === r.id ? null : r.id)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
            <Shield className="h-3.5 w-3.5" /> 권한
          </button>
        </div>
        {/* 메타 라인: 등록일 · 생성자 · 설명 */}
        <div className="mt-0.5 flex items-center gap-2 pl-6 text-xs text-slate-400">
          <span>등록 {r.created_at ? r.created_at.slice(0, 10) : '-'}</span>
          <span className="text-slate-300">·</span>
          <span>생성자 {r.created_by_label || '알 수 없음'}</span>
          {r.description && (
            <>
              <span className="text-slate-300">·</span>
              <span className="max-w-[48ch] truncate" title={r.description}>{r.description}</span>
            </>
          )}
        </div>
      </div>
  )

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
          <span className="flex-1 truncate text-sm font-medium text-slate-700">{folder.name}</span>
          <button type="button" disabled={isFirst} onClick={() => move(-1)}
            title="위로" aria-label={`${folder.name} 위로`} className="text-slate-400 hover:text-blue-600 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={isLast} onClick={() => move(1)}
            title="아래로" aria-label={`${folder.name} 아래로`} className="text-slate-400 hover:text-blue-600 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => { setAddParentId(folder.id); setNewFolderName('') }}
            title="하위 폴더 추가" className="text-slate-400 hover:text-blue-600"><FolderPlus className="h-4 w-4" /></button>
          <button type="button" onClick={() => { const n = prompt('폴더 이름', folder.name); if (n && n.trim()) renameFolderMutation.mutate({ id: folder.id, name: n.trim() }) }}
            title="이름 수정" className="text-slate-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => { if (confirm(`'${folder.name}' 폴더를 삭제할까요?`)) deleteFolderMutation.mutate(folder.id) }}
            title="삭제" className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
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

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">레포트 관리</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setAddParentId('root'); setNewFolderName('') }}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <FolderPlus className="h-4 w-4" /> 폴더 추가
          </button>
          <button type="button" onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50">
            <Upload className="h-4 w-4" /> PBIX 업로드 게시
          </button>
          <button type="button" onClick={() => setRegisterOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
            <Plus className="h-4 w-4" /> 기존 레포트 게시
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
              <p className="px-2 py-10 text-center text-sm text-slate-400">폴더나 레포트가 없습니다. "폴더 추가" 또는 "레포트 게시"로 시작하세요.</p>
            )}
          </>
        )}
      </div>

      {/* 선택 레포트 권한 패널 */}
      {permsReportId !== null && (
        <div className="mt-4"><ReportPermissionPanel reportId={permsReportId} /></div>
      )}

      {/* 기존 레포트 게시 모달 */}
      {registerOpen && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="기존 레포트 게시" className="my-12 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">기존 레포트 게시 (PBI에서 선택)</h3>
              <button type="button" aria-label="닫기" onClick={() => setRegisterOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (selectedPbi) createReportMutation.mutate() }} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">워크스페이스 레포트 *</span>
                <select value={selectedPbi} onChange={(e) => setSelectedPbi(e.target.value)} aria-label="워크스페이스 레포트"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">{wsQuery.isLoading ? '불러오는 중…' : '레포트 선택…'}</option>
                  {wsCandidates.map((r) => <option key={r.report_id} value={r.report_id}>{r.report_name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">표시명 (비우면 원래 이름)</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="표시명"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">설명</span>
                <textarea value={registerDescription} onChange={(e) => setRegisterDescription(e.target.value)} aria-label="레포트 설명"
                  rows={2} placeholder="레포트 용도/내용 간단 설명 (선택)"
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">폴더 * (트리에서 선택)</span>
                <FolderTreePicker folders={folders} value={registerFolderId} onChange={setRegisterFolderId} />
              </label>
              {createReportMutation.isError && <p role="alert" className="text-sm text-red-600">등록 실패 (이미 등록됐거나 입력값 확인).</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setRegisterOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
                <button type="submit" disabled={!selectedPbi || !registerFolderId || createReportMutation.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">게시</button>
              </div>
            </form>
            <p className="mt-3 text-xs text-slate-400">게시 후 기본 비공개예요. 트리에서 "공개"로 바꾸고 권한을 부여하세요.</p>
          </div>
        </div>
      )}

      {/* PBIX 업로드 게시 모달 */}
      {uploadOpen && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="PBIX 업로드 게시" className="my-12 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">PBIX 업로드 게시 (신규)</h3>
              <button type="button" aria-label="닫기" onClick={closeUpload} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            {uploadTaskId === null ? (
              <form onSubmit={(e) => { e.preventDefault(); if (pbixFile) uploadMutation.mutate() }} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">PBIX 파일 *</span>
                  <input type="file" accept=".pbix" aria-label="PBIX 파일" onChange={(e) => setPbixFile(e.target.files?.[0] ?? null)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
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
                <p className="text-xs text-amber-600">⚠️ 운영 워크스페이스에 실제 레포트가 새로 생성돼요.</p>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">게시 상태: <span className="font-semibold">{uploadStatus.data?.state ?? 'PENDING'}</span>
                  {['PENDING', 'STARTED'].includes(uploadStatus.data?.state ?? 'PENDING') && ' (처리 중…)'}</p>
                {uploadStatus.data?.state === 'SUCCESS' && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">게시 완료! 트리에서 공개 전환 후 사용하세요.</p>}
                {uploadStatus.data?.state === 'FAILURE' && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">게시 실패: {uploadStatus.data?.error}</p>}
                <div className="flex justify-end"><button type="button" onClick={closeUpload} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">닫기</button></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 레포트 수정/이동 모달 */}
      {editReport && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label={editMode === 'edit' ? '레포트 수정' : '폴더 이동'} className="my-12 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">{editMode === 'edit' ? '레포트 수정' : '폴더 이동'}</h3>
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
    </section>
  )
}
