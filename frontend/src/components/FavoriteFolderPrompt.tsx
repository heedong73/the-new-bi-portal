import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FolderPlus, LoaderCircle, Star, X } from 'lucide-react'

import { reportsApi } from '@/api/portalApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToastStore } from '@/stores/useToastStore'
import type { FavoriteFolder } from '@/types/report'

interface FavoriteFolderPromptProps {
  open: boolean
  reportId: number
  reportName: string
  onClose: () => void
  onAssigned?: (folderId: number | null) => void
}

interface MoveVariables {
  folderId: number | null
  folderName: string
}

/**
 * 즐겨찾기 추가 직후 표시하는 비차단 폴더 선택 패널.
 * 별 클릭 자체는 즉시 완료되며, 이 패널을 닫아도 항목은 미분류에 보존된다.
 */
export default function FavoriteFolderPrompt({
  open,
  reportId,
  reportName,
  onClose,
  onAssigned,
}: FavoriteFolderPromptProps) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const favoriteFolderQueryKey = ['favorite-folders', user?.id ?? null, user?.emp_no ?? null] as const
  const addToast = useToastStore((state) => state.addToast)
  const [newFolderName, setNewFolderName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const foldersQuery = useQuery({
    queryKey: favoriteFolderQueryKey,
    queryFn: ({ signal }) => reportsApi.listFavoriteFolders(signal),
    enabled: open,
    staleTime: 30_000,
  })

  function invalidateFavoriteQueries() {
    queryClient.invalidateQueries({ queryKey: ['report-catalog'] })
    queryClient.invalidateQueries({ queryKey: ['report-favorites'] })
    queryClient.invalidateQueries({ queryKey: ['report-recent'] })
    queryClient.invalidateQueries({ queryKey: ['reports'] })
    queryClient.invalidateQueries({ queryKey: ['favorites'] })
  }

  const moveMutation = useMutation({
    mutationFn: ({ folderId }: MoveVariables) =>
      reportsApi.moveFavoriteToFolder(reportId, folderId),
    onMutate: () => setErrorMessage(null),
    onSuccess: (_data, variables) => {
      invalidateFavoriteQueries()
      addToast(
        variables.folderId == null
          ? `‘${reportName}’을(를) 미분류에 저장했습니다.`
          : `‘${reportName}’을(를) ‘${variables.folderName}’ 폴더에 저장했습니다.`,
        'success',
      )
      onAssigned?.(variables.folderId)
      onClose()
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : '폴더로 이동하지 못했습니다.')
    },
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => reportsApi.createFavoriteFolder(name),
    onMutate: () => setErrorMessage(null),
    onSuccess: (folder) => {
      queryClient.setQueryData<FavoriteFolder[]>(favoriteFolderQueryKey, (current) => {
        if (!current) return [folder]
        return [...current.filter((item) => item.id !== folder.id), folder]
          .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      })
      setNewFolderName('')
      moveMutation.mutate({ folderId: folder.id, folderName: folder.name })
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : '폴더를 만들지 못했습니다.')
    },
  })

  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name) {
      setErrorMessage('새 폴더 이름을 입력해 주세요.')
      return
    }
    createMutation.mutate(name)
  }

  if (!open) return null

  const folders = foldersQuery.data ?? []
  const busy = moveMutation.isPending || createMutation.isPending

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="favorite-folder-prompt-title"
      className="fixed bottom-5 right-5 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
    >
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-500">
          <Star className="h-4.5 w-4.5 fill-current" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="favorite-folder-prompt-title" className="text-sm font-bold text-slate-800">
            즐겨찾기에 추가했습니다
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500" title={reportName}>
            {reportName} · 저장할 폴더를 선택하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="폴더 선택 닫기"
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        <button
          type="button"
          onClick={() => moveMutation.mutate({ folderId: null, folderName: '미분류' })}
          disabled={busy}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-50"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500">
            <Folder className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-slate-700">미분류</strong>
            <span className="block text-xs text-slate-400">나중에 즐겨찾기 화면에서 정리</span>
          </span>
        </button>

        {foldersQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-5 text-xs text-slate-500" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            폴더를 불러오는 중…
          </div>
        ) : foldersQuery.isError ? (
          <p className="px-3 py-4 text-center text-xs text-red-600" role="alert">
            폴더 목록을 불러오지 못했습니다.
          </p>
        ) : folders.map((folder) => (
          <button
            type="button"
            key={folder.id}
            onClick={() => moveMutation.mutate({ folderId: folder.id, folderName: folder.name })}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-sky-50 disabled:opacity-50"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-700">
              <Folder className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="truncate text-sm font-semibold text-slate-700">{folder.name}</span>
          </button>
        ))}
      </div>

      <form onSubmit={createFolder} className="border-t border-slate-100 bg-slate-50/70 p-3">
        <label htmlFor="favorite-folder-new-name" className="mb-1.5 block text-xs font-semibold text-slate-600">
          새 폴더를 만들어 바로 저장
        </label>
        <div className="flex gap-2">
          <input
            id="favorite-folder-new-name"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            maxLength={80}
            disabled={busy}
            placeholder="예: 월간 보고서"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-100"
          />
          <button
            type="submit"
            disabled={busy || !newFolderName.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sky-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {createMutation.isPending ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            만들기
          </button>
        </div>
        {errorMessage && (
          <p className="mt-2 text-xs font-medium text-red-600" role="alert">{errorMessage}</p>
        )}
      </form>
    </aside>
  )
}
