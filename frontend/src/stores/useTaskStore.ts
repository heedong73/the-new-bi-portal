/** 백그라운드 작업(게시/교체/새로고침) 진행 상태 스토어 (zustand).
 *  좌측 하단 도크에서 폴링/표시하며, 페이지 이동과 무관하게 유지된다.
 *
 *  localStorage에 영속화하여 **새로고침 후에도** 진행 작업이 유지되도록 한다.
 *  도크는 복원된 task_id로 상태를 이어서 폴링하므로 "게시중→완료"가 끊기지 않는다.
 *  (서버측 작업은 브라우저와 무관하게 진행되므로, UI 추적만 복원하면 된다.)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TaskStatus = 'pending' | 'success' | 'error'
export type TaskKind = 'pbix_import' | 'pbix_replace' | 'refresh' | 'collect' | 'export'

export interface BgTask {
  id: string // celery task_id (또는 고유 키)
  label: string // 표시명 (레포트명)
  kind: TaskKind
  status: TaskStatus
  message?: string
  // 새로고침 추적용
  reportId?: number // refresh: 대상 레포트 PK
  baseline?: string | null // (legacy) 트리거 시점 마지막 새로고침 시각
  seenRunning?: boolean // refresh: 진행 중(Unknown) 상태를 한 번이라도 관측했는지
  startedAt?: number // 타임아웃/영속 정리 판정용 (ms)
  exportJobId?: number // export: 폴링/다운로드할 ExportJob id
  downloaded?: boolean // export: 자동 다운로드를 이미 트리거했는지(중복 방지)
}

interface TaskState {
  tasks: BgTask[]
  addTask: (t: BgTask) => void
  updateTask: (id: string, patch: Partial<BgTask>) => void
  removeTask: (id: string) => void
}

// 영속 복원 시 이보다 오래된 'pending' 작업은 만료로 간주하여 제거(고아 행 방지).
const STALE_MS = 30 * 60_000

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      tasks: [],
      addTask: (t) =>
        set((s) =>
          s.tasks.some((x) => x.id === t.id)
            ? s
            : { tasks: [...s.tasks, { startedAt: Date.now(), ...t }] },
        ),
      updateTask: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),
    }),
    {
      name: 'bip-bg-tasks',
      partialize: (s) => ({ tasks: s.tasks }),
      // 복원 시: 최근(STALE_MS 이내) 작업은 상태와 무관하게 유지한다.
      // - 진행 중(pending)이던 작업은 도크가 이어서 폴링
      // - 직전에 완료(success)된 작업은 잠깐 다시 보였다가 도크에서 정리(BackgroundTaskDock)
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const now = Date.now()
        state.tasks = state.tasks.filter((t) => now - (t.startedAt ?? 0) < STALE_MS)
      },
    },
  ),
)
