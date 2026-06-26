/** 백그라운드 작업(게시/교체) 진행 상태 스토어 (zustand).
 *  좌측 하단 도크에서 폴링/표시하며, 페이지 이동과 무관하게 유지된다.
 */
import { create } from 'zustand'

export type TaskStatus = 'pending' | 'success' | 'error'
export type TaskKind = 'pbix_import' | 'pbix_replace' | 'refresh'

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
  startedAt?: number // 타임아웃 판정용 (ms)
}

interface TaskState {
  tasks: BgTask[]
  addTask: (t: BgTask) => void
  updateTask: (id: string, patch: Partial<BgTask>) => void
  removeTask: (id: string) => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  addTask: (t) =>
    set((s) => (s.tasks.some((x) => x.id === t.id) ? s : { tasks: [...s.tasks, t] })),
  updateTask: (id, patch) =>
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),
}))
