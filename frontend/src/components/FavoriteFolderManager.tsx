import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Folder,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'

import { reportsApi } from '@/api/portalApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import type { FavoriteFolder, ReportSummary } from '@/types/report'

export type FavoriteFolderSelection = 'all' | 'uncategorized' | number

interface FavoriteFolderManagerProps {
  folders: FavoriteFolder[]
  reports: ReportSummary[]
  selected: FavoriteFolderSelection
  loading: boolean
  loadError: boolean
  onSelect: (selection: FavoriteFolderSelection) => void
}

function mutationError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** 즐겨찾기 화면의 개인 폴더 필터와 생성·이름 변경·삭제·정렬 관리 UI. */
export default function FavoriteFolderManager({
  folders,
  reports,
  selected,
  loading,
  loadError,
  onSelect,
}: FavoriteFolderManagerProps) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const favoriteFolderQueryKey = ['favorite-folders', user?.id ?? null, user?.emp_no ?? null] as const
  const addToast = useToastStore((state) => state.addToast)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [managing, setManaging] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const counts = reports.reduce((result, report) => {
    const key = report.favorite_folder_id ?? null
    result.set(key, (result.get(key) ?? 0) + 1)
    return result
  }, new Map<number | null, number>())

  function invalidateFoldersAndFavorites() {
    queryClient.invalidateQueries({ queryKey: favoriteFolderQueryKey })
    queryClient.invalidateQueries({ queryKey: ['report-favorites'] })
    queryClient.invalidateQueries({ queryKey: ['report-catalog'] })
    queryClient.invalidateQueries({ queryKey: ['reports'] })
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => reportsApi.createFavoriteFolder(name),
    onMutate: () => setErrorMessage(null),
    onSuccess: (folder) => {
      queryClient.setQueryData<FavoriteFolder[]>(favoriteFolderQueryKey, (current) => [
        ...(current ?? folders).filter((item) => item.id !== folder.id),
        folder,
      ].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
      setNewName('')
      setCreating(false)
      onSelect(folder.id)
      addToast(`‘${folder.name}’ 즐겨찾기 폴더를 만들었습니다.`, 'success')
      invalidateFoldersAndFavorites()
    },
    onError: (error) => setErrorMessage(mutationError(error, '폴더를 만들지 못했습니다.')),
  })

  const renameMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: number; name: string }) =>
      reportsApi.renameFavoriteFolder(folderId, name),
    onMutate: () => setErrorMessage(null),
    onSuccess: (updated) => {
      queryClient.setQueryData<FavoriteFolder[]>(favoriteFolderQueryKey, (current) =>
        (current ?? folders).map((folder) => folder.id === updated.id ? updated : folder),
      )
      setEditingId(null)
      setEditingName('')
      addToast(`폴더 이름을 ‘${updated.name}’(으)로 변경했습니다.`, 'success')
      invalidateFoldersAndFavorites()
    },
    onError: (error) => setErrorMessage(mutationError(error, '폴더 이름을 변경하지 못했습니다.')),
  })

  const deleteMutation = useMutation({
    mutationFn: (folder: FavoriteFolder) => reportsApi.deleteFavoriteFolder(folder.id),
    onMutate: () => setErrorMessage(null),
    onSuccess: (_data, folder) => {
      queryClient.setQueryData<FavoriteFolder[]>(favoriteFolderQueryKey, (current) =>
        (current ?? folders).filter((item) => item.id !== folder.id),
      )
      if (selected === folder.id) onSelect('uncategorized')
      addToast(`‘${folder.name}’ 폴더를 삭제했습니다. 항목은 미분류로 이동했습니다.`, 'success')
      invalidateFoldersAndFavorites()
    },
    onError: (error) => setErrorMessage(mutationError(error, '폴더를 삭제하지 못했습니다.')),
  })

  const reorderMutation = useMutation({
    mutationFn: (nextFolders: FavoriteFolder[]) =>
      reportsApi.reorderFavoriteFolders(nextFolders.map((folder) => folder.id)),
    onMutate: (nextFolders) => {
      setErrorMessage(null)
      queryClient.setQueryData<FavoriteFolder[]>(favoriteFolderQueryKey, nextFolders)
    },
    onError: (error) => {
      setErrorMessage(mutationError(error, '폴더 순서를 변경하지 못했습니다.'))
      queryClient.invalidateQueries({ queryKey: favoriteFolderQueryKey })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: favoriteFolderQueryKey }),
  })

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) {
      setErrorMessage('새 폴더 이름을 입력해 주세요.')
      return
    }
    createMutation.mutate(name)
  }

  function submitRename(event: FormEvent<HTMLFormElement>, folderId: number) {
    event.preventDefault()
    const name = editingName.trim()
    if (!name) {
      setErrorMessage('폴더 이름을 입력해 주세요.')
      return
    }
    renameMutation.mutate({ folderId, name })
  }

  function moveFolder(index: number, offset: -1 | 1) {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= folders.length) return
    const next = [...folders]
    const [folder] = next.splice(index, 1)
    next.splice(targetIndex, 0, folder)
    reorderMutation.mutate(next.map((item, sortOrder) => ({
      ...item,
      sort_order: sortOrder,
    })))
  }

  function confirmDelete(folder: FavoriteFolder) {
    const confirmed = window.confirm(
      `‘${folder.name}’ 폴더를 삭제할까요? 폴더 안의 즐겨찾기는 삭제되지 않고 미분류로 이동합니다.`,
    )
    if (confirmed) deleteMutation.mutate(folder)
  }

  const busy = createMutation.isPending
    || renameMutation.isPending
    || deleteMutation.isPending
    || reorderMutation.isPending

  return (
    <section aria-label="개인 즐겨찾기 폴더">
      <div className="report-hub-categories" aria-label="즐겨찾기 폴더 필터">
        <button
          type="button"
          onClick={() => onSelect('all')}
          className={selected === 'all' ? 'is-active' : ''}
          aria-pressed={selected === 'all'}
        >
          전체 <span>{reports.length}</span>
        </button>
        <button
          type="button"
          onClick={() => onSelect('uncategorized')}
          className={selected === 'uncategorized' ? 'is-active' : ''}
          aria-pressed={selected === 'uncategorized'}
        >
          미분류 <span>{counts.get(null) ?? 0}</span>
        </button>
        {folders.map((folder) => (
          <button
            type="button"
            key={folder.id}
            onClick={() => onSelect(folder.id)}
            className={selected === folder.id ? 'is-active' : ''}
            aria-pressed={selected === folder.id}
          >
            {folder.name} <span>{counts.get(folder.id) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 py-2">
        <p className="text-xs text-slate-500">
          {loading ? '개인 폴더를 불러오는 중…' : loadError ? '개인 폴더를 불러오지 못했습니다.' : `${folders.length}개 개인 폴더`}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCreating((current) => !current)
              setErrorMessage(null)
            }}
            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-100"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            새 폴더
          </button>
          {folders.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setManaging((current) => !current)
                setErrorMessage(null)
              }}
              aria-expanded={managing}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              폴더 관리
            </button>
          )}
        </div>
      </div>

      {creating && (
        <form onSubmit={submitCreate} className="flex flex-wrap items-end gap-2 border-b border-stone-200 bg-sky-50/50 px-3 py-2.5">
          <label className="min-w-52 flex-1 text-xs font-semibold text-slate-600">
            새 폴더 이름
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={80}
              disabled={busy}
              placeholder="예: 월간 보고서"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-sky-700 px-3 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-45"
          >
            {createMutation.isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            만들기
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
            disabled={busy}
            className="h-8 rounded-md px-2 text-xs font-semibold text-slate-500 hover:bg-white"
          >
            취소
          </button>
        </form>
      )}

      {managing && folders.length > 0 && (
        <ul className="divide-y divide-slate-100 border-b border-stone-200 bg-white" aria-label="즐겨찾기 폴더 관리 목록">
          {folders.map((folder, index) => (
            <li key={folder.id} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
              <Folder className="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
              {editingId === folder.id ? (
                <form onSubmit={(event) => submitRename(event, folder.id)} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    maxLength={80}
                    disabled={busy}
                    aria-label={`${folder.name} 새 이름`}
                    className="min-w-0 flex-1 rounded border border-sky-400 px-2 py-1 text-sm outline-none ring-2 ring-sky-100"
                  />
                  <button type="submit" disabled={busy || !editingName.trim()} aria-label="이름 변경 저장" className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} disabled={busy} aria-label="이름 변경 취소" className="rounded p-1 text-slate-500 hover:bg-slate-100">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </form>
              ) : (
                <>
                  <button type="button" onClick={() => onSelect(folder.id)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-700">
                    {folder.name} <span className="ml-1 text-xs font-normal text-slate-400">{counts.get(folder.id) ?? 0}</span>
                  </button>
                  <button type="button" onClick={() => moveFolder(index, -1)} disabled={busy || index === 0} aria-label={`${folder.name} 위로 이동`} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-25">
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => moveFolder(index, 1)} disabled={busy || index === folders.length - 1} aria-label={`${folder.name} 아래로 이동`} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-25">
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(folder.id)
                      setEditingName(folder.name)
                      setErrorMessage(null)
                    }}
                    disabled={busy}
                    aria-label={`${folder.name} 이름 변경`}
                    className="rounded p-1 text-slate-500 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => confirmDelete(folder)} disabled={busy} aria-label={`${folder.name} 삭제`} className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  )
}
