/** 좌측 하단 백그라운드 작업 도크 — "진행중" 제목 아래 진행 작업 목록.
 *  각 작업은 import-status 를 폴링해 게시중/완료/실패를 표시한다. 페이지 이동과 무관.
 */
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react'

import { reportAdminApi } from '@/api/reportAdminApi'
import { reportsApi, exportsApi } from '@/api/portalApi'
import { refreshApi } from '@/api/refreshApi'
import { useTaskStore, type BgTask } from '@/stores/useTaskStore'

const KIND_LABEL: Record<BgTask['kind'], string> = {
  pbix_import: '레포트 게시',
  pbix_replace: '레포트 업데이트',
  refresh: '새로고침',
  collect: '데이터 수집',
  export: '다운로드',
}

/** 완료된 Export 파일을 브라우저 다운로드로 트리거(세션 쿠키 동반, 첨부 헤더로 저장). */
function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 새로고침 후 복원되어 떠 있는 완료(success) 알림을 잠깐 보여준 뒤 자동 정리하는 지연(ms). */
const RESTORED_DONE_DISMISS_MS = 6000

export default function BackgroundTaskDock() {
  const tasks = useTaskStore((s) => s.tasks)

  // 새로고침 복원 시점에 이미 완료(success)인 알림은 잠깐 노출 후 정리한다.
  // (라이브로 완료되는 작업은 각 행에서 처리하므로 마운트 시점 항목만 대상)
  useEffect(() => {
    const initial = useTaskStore.getState().tasks.filter((t) => t.status === 'success')
    if (initial.length === 0) return
    const { removeTask } = useTaskStore.getState()
    const timers = initial.map((t) => setTimeout(() => removeTask(t.id), RESTORED_DONE_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [])

  if (tasks.length === 0) return null

  return (
    <div className="fixed right-4 top-32 z-50 w-72 rounded-xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">진행중</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{tasks.length}</span>
      </div>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </div>
  )
}

function TaskRow({ task }: { task: BgTask }) {
  const qc = useQueryClient()
  const updateTask = useTaskStore((s) => s.updateTask)
  const removeTask = useTaskStore((s) => s.removeTask)

  if (task.kind === 'refresh') return <RefreshTaskRow task={task} qc={qc} updateTask={updateTask} removeTask={removeTask} />
  if (task.kind === 'collect') return <CollectTaskRow task={task} qc={qc} updateTask={updateTask} removeTask={removeTask} />
  if (task.kind === 'export') return <ExportTaskRow task={task} qc={qc} updateTask={updateTask} removeTask={removeTask} />
  return <ImportTaskRow task={task} qc={qc} updateTask={updateTask} removeTask={removeTask} />
}

type RowProps = {
  task: BgTask
  qc: ReturnType<typeof useQueryClient>
  updateTask: (id: string, patch: Partial<BgTask>) => void
  removeTask: (id: string) => void
}

function ImportTaskRow({ task, qc, updateTask, removeTask }: RowProps) {
  const statusQuery = useQuery({
    queryKey: ['bg-task', task.id],
    queryFn: () => reportAdminApi.importStatus(task.id),
    enabled: task.status === 'pending',
    refetchInterval: (q) => {
      const st = (q.state.data as { state?: string } | undefined)?.state
      return st === 'SUCCESS' || st === 'FAILURE' ? false : 2000
    },
  })

  useEffect(() => {
    const st = (statusQuery.data as { state?: string; error?: string } | undefined)?.state
    if (!st) return
    if (st === 'SUCCESS' && task.status !== 'success') {
      updateTask(task.id, { status: 'success' })
      qc.invalidateQueries({ queryKey: ['admin-reports'] })
      qc.invalidateQueries({ queryKey: ['admin-folders'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['embed'] })
      const id = task.id
      setTimeout(() => removeTask(id), 5000)
    } else if (st === 'FAILURE' && task.status !== 'error') {
      const err = (statusQuery.data as { error?: string } | undefined)?.error
      updateTask(task.id, { status: 'error', message: err })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data])

  return <TaskRowView task={task} onClose={() => removeTask(task.id)} />
}

const REFRESH_TERMINAL_OK = new Set(['Completed'])
const REFRESH_TERMINAL_FAIL = new Set(['Failed', 'Cancelled', 'Disabled'])

function RefreshTaskRow({ task, qc, updateTask, removeTask }: RowProps) {
  const statusQuery = useQuery({
    queryKey: ['bg-refresh', task.id],
    queryFn: () => reportsApi.liveRefreshStatus(task.reportId as number),
    enabled: task.status === 'pending' && task.reportId != null,
    refetchInterval: () => (task.status === 'pending' ? 5000 : false),
  })

  useEffect(() => {
    if (task.status !== 'pending') return
    const data = statusQuery.data as
      | { status?: string | null; in_progress?: boolean }
      | undefined
    const elapsed = task.startedAt ? Date.now() - task.startedAt : 0

    if (data) {
      const inProgress = !!data.in_progress
      const st = data.status ?? ''
      if (inProgress) {
        // 진행 중(Unknown 등) 관측 → 이후 terminal 전환 시 완료로 판정
        if (!task.seenRunning) updateTask(task.id, { seenRunning: true })
      } else {
        // terminal 상태. 진행 중을 한 번이라도 봤으면 이번 새로고침의 결과로 간주
        const isNewResult = task.seenRunning || elapsed > 20_000
        if (isNewResult && REFRESH_TERMINAL_OK.has(st)) {
          updateTask(task.id, { status: 'success' })
          qc.invalidateQueries({ queryKey: ['refresh-status'] })
          const id = task.id
          setTimeout(() => removeTask(id), 5000)
          return
        }
        if (isNewResult && REFRESH_TERMINAL_FAIL.has(st)) {
          updateTask(task.id, { status: 'error', message: st === 'Disabled' ? '비활성' : st })
          return
        }
      }
    }
    // 안전 타임아웃: 10분 내 결과 미확정 시 '요청됨'으로 정리
    if (elapsed > 10 * 60_000) {
      updateTask(task.id, { status: 'success', message: '요청됨 (반영까지 시간이 걸릴 수 있어요)' })
      const id = task.id
      setTimeout(() => removeTask(id), 6000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data, statusQuery.dataUpdatedAt])

  return <TaskRowView task={task} onClose={() => removeTask(task.id)} />
}

const COLLECT_STARTUP_GRACE_MS = 12_000
const COLLECT_SAFETY_TIMEOUT_MS = 5 * 60_000

function CollectTaskRow({ task, qc, updateTask, removeTask }: RowProps) {
  const statusQuery = useQuery({
    queryKey: ['bg-collect', task.id],
    queryFn: ({ signal }) => refreshApi.getCollectStatus(signal),
    enabled: task.status === 'pending',
    refetchInterval: () => (task.status === 'pending' ? 3000 : false),
  })

  useEffect(() => {
    if (task.status !== 'pending') return
    const data = statusQuery.data as { running?: boolean } | undefined
    if (data === undefined) return
    const elapsed = task.startedAt ? Date.now() - task.startedAt : 0
    const running = !!data.running

    // 안전 타임아웃: 오래 진행 미확정(락 장시간 유지/워커 지연)이면 정리
    if (elapsed > COLLECT_SAFETY_TIMEOUT_MS) {
      updateTask(task.id, { status: 'success', message: '요청됨 (반영까지 시간이 걸릴 수 있어요)' })
      const id = task.id
      setTimeout(() => removeTask(id), 6000)
      return
    }

    if (running) {
      // 진행 중(락 점유)을 한 번이라도 관측 → 이후 해제 시 완료로 판정
      if (!task.seenRunning) updateTask(task.id, { seenRunning: true })
      return
    }

    // running === false: 진행 중을 봤거나 시작 유예를 지났으면 완료로 간주
    const done = task.seenRunning || elapsed > COLLECT_STARTUP_GRACE_MS
    if (done) {
      updateTask(task.id, { status: 'success', message: '완료' })
      qc.invalidateQueries({ queryKey: ['refresh-timetable'] })
      qc.invalidateQueries({ queryKey: ['refresh-history'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      const id = task.id
      setTimeout(() => removeTask(id), 5000)
    }
    // else: 락 미획득(시작 대기) — 계속 폴링한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data, statusQuery.dataUpdatedAt])

  return <TaskRowView task={task} onClose={() => removeTask(task.id)} />
}

function ExportTaskRow({ task, updateTask, removeTask }: RowProps) {
  const statusQuery = useQuery({
    queryKey: ['bg-export', task.id],
    queryFn: ({ signal }) => exportsApi.status(task.exportJobId as number, signal),
    enabled: task.status === 'pending' && task.exportJobId != null,
    refetchInterval: (q) => {
      const st = (q.state.data as { status?: string } | undefined)?.status
      return st === 'Succeeded' || st === 'Failed' ? false : 2500
    },
  })

  useEffect(() => {
    if (task.status !== 'pending') return
    const data = statusQuery.data
    if (!data) return
    if (data.status === 'Succeeded') {
      // 완료: 파일 자동 다운로드(1회) 후 성공 처리
      if (!task.downloaded && task.exportJobId != null) {
        triggerDownload(exportsApi.fileUrl(task.exportJobId))
      }
      updateTask(task.id, { downloaded: true, status: 'success', message: '다운로드 시작됨' })
      const id = task.id
      setTimeout(() => removeTask(id), 6000)
    } else if (data.status === 'Failed') {
      updateTask(task.id, { status: 'error', message: data.error_message || '실패' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data])

  return <TaskRowView task={task} onClose={() => removeTask(task.id)} />
}

function TaskRowView({ task, onClose }: { task: BgTask; onClose: () => void }) {
  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        {task.status === 'pending' && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
        {task.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
        {task.status === 'error' && <AlertTriangle className="h-4 w-4 text-red-600" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700">{task.label}</p>
        <p className="text-xs text-slate-400">
          {KIND_LABEL[task.kind]} ·{' '}
          {task.status === 'pending' &&
            (task.kind === 'refresh'
              ? '새로고침 중…'
              : task.kind === 'collect'
                ? '수집 중…'
                : task.kind === 'export'
                  ? '내보내는 중…'
                  : '게시중…')}
          {task.status === 'success' && (task.message ?? '완료')}
          {task.status === 'error' && (task.message ? `실패: ${task.message}` : '실패')}
        </p>
      </div>
      {task.status !== 'pending' && (
        <button type="button" aria-label="닫기" onClick={onClose}
          className="shrink-0 text-slate-300 hover:text-slate-500">
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  )
}
