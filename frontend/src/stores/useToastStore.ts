/**
 * 가벼운 toast 알림 클라이언트 상태 (Zustand).
 *
 * 외부 의존성 없이 화면 우하단에 잠깐 떴다 사라지는 toast를 제공한다.
 * 즉시 수집(Requirement 10.1) 결과 안내 등 "비차단적 일시 알림"에 사용한다.
 *
 *  - addToast(message, type, durationMs): toast 추가 후 durationMs 뒤 자동 제거.
 *    durationMs <= 0 이면 자동 제거하지 않는다(수동 닫기 전용).
 *  - removeToast(id): 특정 toast를 즉시 제거(사용자가 X 클릭 시).
 *
 * 오류(error)는 ErrorBanner(상단 sticky 배너)가 영속적으로 다루므로, toast는
 * 주로 "성공/안내"(enqueued/already-running)와 가벼운 실패 안내에 적합하다.
 */
import { create } from "zustand";

/** toast 종류 — 색상/아이콘 결정에 사용 */
export type ToastType = "success" | "error" | "info";

export interface Toast {
  /** 고유 식별자(자동 증가) */
  id: number;
  /** 표시 메시지(한국어) */
  message: string;
  /** 종류 */
  type: ToastType;
}

interface ToastState {
  toasts: Toast[];
  /** toast 추가. 생성된 id를 반환한다. */
  addToast: (message: string, type?: ToastType, durationMs?: number) => number;
  /** toast 제거 */
  removeToast: (id: number) => void;
}

/** 자동 사라짐 기본 시간(ms). */
const DEFAULT_DURATION_MS = 3000;

/** 단조 증가 id 시퀀스(모듈 전역). */
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, type = "info", durationMs = DEFAULT_DURATION_MS) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    if (durationMs > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, durationMs);
    }
    return id;
  },

  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export default useToastStore;
