/** 좌측 하단 백그라운드 작업 도크 — "진행중" 제목 아래 진행 작업 목록.
 *  각 작업은 import-status 를 폴링해 게시중/완료/실패를 표시한다. 페이지 이동과 무관.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, CheckCircle2, AlertTriangle, Square, X } from 'lucide-react'

import { reportAdminApi } from '@/api/reportAdminApi'
import { datasetsApi, reportsApi, exportsApi } from '@/api/portalApi'
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
    const initial = useTaskStore.getState().tasks.filter(
      (task) => task.status === 'success' || task.status === 'cancelled',
    )
    if (initial.length === 0) return
    const { removeTask } = useTaskStore.getState()
    const timers = initial.map((t) => setTimeout(() => removeTask(t.id), RESTORED_DONE_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [])

  if (tasks.length === 0) return null

  return (
    <div className="fixed right-4 top-32 z-50 w-72 rounded-xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-sm font-bold text-slate-700">진행중</span>
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
const REFRESH_TERMINAL_FAIL = new Set(['Failed', 'Disabled'])

function RefreshTaskRow({ task, qc, updateTask, removeTask }: RowProps) {
  const active = task.status === 'pending' || task.status === 'cancelling'
  const markCancelling = useTaskStore((s) => s.markCancelling)
  const cancelMutation = useMutation({
    mutationFn: () => datasetsApi.cancelRefresh(task.datasetId as string),
    onMutate: () => {
      markCancelling(task.id, '중지 요청 중…')
    },
    onSuccess: () => {
      updateTask(task.id, { status: 'cancelling', message: '중지 처리 중…' })
      qc.invalidateQueries({ queryKey: ['live-refresh', task.reportId] })
      qc.invalidateQueries({ queryKey: ['bg-refresh', task.id] })
    },
    onError: (error) => {
      updateTask(task.id, {
        status: 'pending',
        message: `중지 실패: ${error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'}`,
      })
    },
  })

  const statusQuery = useQuery({
    queryKey: ['bg-refresh', task.id],
    queryFn: () => reportsApi.liveRefreshStatus(task.reportId as number),
    enabled: active && task.reportId != null,
    refetchInterval: () => (active ? 5000 : false),
  })

  useEffect(() => {
    if (task.status !== 'pending' && task.status !== 'cancelling') return
    const data = statusQuery.data as
      | { status?: string | null; in_progress?: boolean }
      | undefined
    const elapsed = task.startedAt ? Date.now() - task.startedAt : 0
    const cancelElapsed = task.cancelRequestedAt ? Date.now() - task.cancelRequestedAt : 0

    if (data) {
      const inProgress = !!data.in_progress
      const st = data.status ?? ''
      if (inProgress) {
        // 진행 중(Unknown 등) 관측 → 중지 버튼 활성화 및 이후 terminal 판정 근거.
        // Power BI가 계속 진행 중이라고 보고하는 한, 아래 안전 타임아웃보다 이 신호를
        // 우선한다(장시간 정상 실행을 '요청됨'으로 오인해 추적을 끝내지 않기 위함).
        if (!task.seenRunning) updateTask(task.id, { seenRunning: true, message: undefined })
        return
      }
      // terminal 상태. 진행 중을 보았거나 취소 요청 중이면 이번 작업 결과로 간주.
      const isNewResult = task.seenRunning || task.status === 'cancelling' || elapsed > 20_000
      if (isNewResult && REFRESH_TERMINAL_OK.has(st)) {
        updateTask(task.id, {
          status: 'success',
          message: task.status === 'cancelling' ? '중지 전에 완료됨' : undefined,
        })
        qc.invalidateQueries({ queryKey: ['refresh-status'] })
        const id = task.id
        setTimeout(() => removeTask(id), 5000)
        return
      }
      if (isNewResult && st === 'Cancelled') {
        updateTask(task.id, { status: 'cancelled', message: '중지됨' })
        qc.invalidateQueries({ queryKey: ['refresh-status'] })
        qc.invalidateQueries({ queryKey: ['live-refresh', task.reportId] })
        const id = task.id
        setTimeout(() => removeTask(id), 5000)
        return
      }
      if (isNewResult && REFRESH_TERMINAL_FAIL.has(st)) {
        updateTask(task.id, { status: 'error', message: st === 'Disabled' ? '비활성' : st })
        return
      }
      // terminal이 아닌 다른 값(예: 아직 이력에 반영되지 않아 has_history=false)이면
      // 안전 타임아웃 판정으로 넘어간다.
    }
    // 안전 타임아웃. Power BI가 in_progress를 보고하는 동안은 위에서 이미 return했으므로,
    // 여기 도달했다는 것은 상태를 아직 확인하지 못했다는 뜻이다(폴링 실패/지연 등).
    // - cancelling: 취소 요청 시점 기준 5분 내 Cancelled/종료를 확인 못하면 실패로 표시.
    //   새로고침이 오래 실행 중이었어도 취소 자체의 타임아웃은 독립적으로 계산한다.
    // - pending: 10분 내 진행 신호를 한 번도 못 보면 '요청됨'으로 정리.
    if (task.status === 'cancelling') {
      // cancelRequestedAt이 없는 경우(다른 화면에서 취소를 시작한 뒤 아직 갱신 전 등)는
      // startedAt을 기준으로 대체해 타임아웃 판정이 무한정 보류되지 않게 한다.
      const cancelWaited = task.cancelRequestedAt ? cancelElapsed : elapsed
      if (cancelWaited > 5 * 60_000) {
        updateTask(task.id, { status: 'error', message: '중지 결과를 확인하지 못했습니다.' })
      }
    } else if (task.status === 'pending' && !task.seenRunning && elapsed > 10 * 60_000) {
      updateTask(task.id, { status: 'success', message: '요청됨 (반영까지 시간이 걸릴 수 있어요)' })
      const id = task.id
      setTimeout(() => removeTask(id), 6000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data, statusQuery.dataUpdatedAt])

  return (
    <TaskRowView
      task={task}
      onClose={() => removeTask(task.id)}
      onCancel={task.datasetId ? () => cancelMutation.mutate() : undefined}
      cancelDisabled={!task.seenRunning || task.status === 'cancelling' || cancelMutation.isPending}
    />
  )
}

const COLLECT_SAFETY_TIMEOUT_MS = 10 * 60_000

function CollectTaskRow({ task, qc, updateTask, removeTask }: RowProps) {
  // 실제 수집 결과(성공/실패/스킵)를 Celery task 결과로 폴링. task_id가 붙기 전엔 대기.
  const statusQuery = useQuery({
    queryKey: ['bg-collect', task.id, task.collectTaskId],
    queryFn: ({ signal }) => refreshApi.getCollectStatus(task.collectTaskId, signal),
    enabled: task.status === 'pending' && !!task.collectTaskId,
    refetchInterval: (q) => {
      const st = (q.state.data as { state?: string } | undefined)?.state
      return st && st !== 'running' ? false : 2500
    },
  })

  useEffect(() => {
    if (task.status !== 'pending') return
    const data = statusQuery.data
    const elapsed = task.startedAt ? Date.now() - task.startedAt : 0

    if (data) {
      if (data.state === 'succeeded') {
        updateTask(task.id, { status: 'success', message: '완료' })
        qc.invalidateQueries({ queryKey: ['refresh-timetable'] })
        qc.invalidateQueries({ queryKey: ['refresh-history'] })
        qc.invalidateQueries({ queryKey: ['summary'] })
        qc.invalidateQueries({ queryKey: ['refresh-latest-date'] })
        const id = task.id
        setTimeout(() => removeTask(id), 5000)
        return
      }
      if (data.state === 'skipped') {
        updateTask(task.id, { status: 'success', message: '이미 수집 중이었습니다' })
        const id = task.id
        setTimeout(() => removeTask(id), 6000)
        return
      }
      if (data.state === 'failed') {
        updateTask(task.id, { status: 'error', message: data.error || '수집 실패' })
        return
      }
      // running/unknown → 계속 진행 표시
    }

    // 안전 타임아웃: 결과 미확정(워커 미가동/지연 등)이면 '완료' 대신 실패로 정리
    if (elapsed > COLLECT_SAFETY_TIMEOUT_MS) {
      updateTask(task.id, {
        status: 'error',
        message: '수집 상태를 확인하지 못했습니다(시간 초과). 워커 상태를 확인하세요.',
      })
    }
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

function TaskRowView({
  task,
  onClose,
  onCancel,
  cancelDisabled = false,
}: {
  task: BgTask
  onClose: () => void
  onCancel?: () => void
  cancelDisabled?: boolean
}) {
  const active = task.status === 'pending' || task.status === 'cancelling'
  const pendingLabel = task.kind === 'refresh'
    ? (task.message ?? '새로고침 중…')
    : task.kind === 'collect'
      ? '수집 중…'
      : task.kind === 'export'
        ? '내보내는 중…'
        : '게시중…'

  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        {active && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
        {task.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
        {task.status === 'cancelled' && <Square className="h-4 w-4 fill-amber-500 text-amber-500" />}
        {task.status === 'error' && <AlertTriangle className="h-4 w-4 text-red-600" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700">{task.label}</p>
        <p role="status" aria-live="polite" className="text-xs text-slate-400">
          {KIND_LABEL[task.kind]} ·{' '}
          {task.status === 'pending' && pendingLabel}
          {task.status === 'cancelling' && (task.message ?? '중지 처리 중…')}
          {task.status === 'cancelled' && (task.message ?? '중지됨')}
          {task.status === 'success' && (task.message ?? '완료')}
          {task.status === 'error' && (task.message ? `실패: ${task.message}` : '실패')}
        </p>
      </div>
      {task.kind === 'refresh' && active && onCancel && (
        <button
          type="button"
          aria-label={`${task.label} 새로고침 중지`}
          title={cancelDisabled ? 'Power BI에서 시작 상태를 확인하는 중입니다.' : '새로고침 중지'}
          onClick={onCancel}
          disabled={cancelDisabled}
          className="shrink-0 rounded p-0.5 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      )}
      {!active && (
        <button type="button" aria-label="닫기" onClick={onClose}
          className="shrink-0 text-slate-300 hover:text-slate-500">
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  )
}
