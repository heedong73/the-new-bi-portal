/**
 * 필터 / 자동 새로고침 클라이언트 상태 (Zustand).
 *
 * design.md "상태 관리 - Zustand useRefreshFilterStore" 절의 `RefreshFilterState`
 * 인터페이스를 그대로 구현한다. 서버 상태(refresh 데이터)는 TanStack Query가,
 * 클라이언트 상태(필터/자동 새로고침 토글)는 이 store가 담당한다.
 *
 * 관련 요구사항:
 *  - 13.1 필터 영역(기간/Workspace/Report/Dataset/상태) 상태 보관
 *  - 13.3 상태 필터 값: 전체 / 성공 / 실패 / 진행중 / 알 수 없음
 *  - 13.4 기간 기본값: 단일 일자(선택 일자 00:00~23:59). 기본은 최신 데이터 일자.
 *  - 12.2/12.3 자동 새로고침 토글 및 간격(기본 60초, 환경 변수 주입 가능)
 *
 * 비고:
 *  - `status`는 "all"을 포함한다. API 호출 시 "all"은 status 파라미터를
 *    "미전달"로 매핑되어야 한다(전체 조회). 이 매핑은 task 1.14 / 7.1에서
 *    refreshApi 계층이 수행한다. 여기서는 store 값만 보관한다.
 *  - 단계 1(mock)에서는 KST 고정 오프셋을 과도하게 다루지 않고 date-fns의
 *    startOfDay/endOfDay로 "오늘 00:00 ~ 23:59:59"를 계산한다.
 */
import { create } from "zustand";
import { startOfDay, endOfDay } from "date-fns";
import type { RefreshStatus } from "@/types/refresh";

/**
 * 상태 필터 값. design.md 인터페이스대로 "all"을 포함한다.
 * (ko.status의 키 집합과 일치: all/success/failed/in_progress/unknown)
 */
export type RefreshFilterStatus = "all" | RefreshStatus;

/**
 * 자동 새로고침 간격(초) 기본값.
 *
 * Vite는 `VITE_` 접두사 환경 변수만 클라이언트 번들에 주입하므로
 * `import.meta.env.VITE_AUTO_REFRESH_INTERVAL_SEC`를 우선 사용하고,
 * 미설정/비정상 값이면 60초로 fallback 한다 (Requirement 12.3).
 */
function resolveAutoRefreshIntervalSec(): number {
  const raw = import.meta.env.VITE_AUTO_REFRESH_INTERVAL_SEC;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

const DEFAULT_AUTO_REFRESH_INTERVAL_SEC = resolveAutoRefreshIntervalSec();

/**
 * 기간 기본값을 계산한다 (Requirement 13.4).
 * 단일 일자 조회 모델: 선택 일자 하루(00:00:00 ~ 23:59:59.999)를 [from,to]로 표현한다.
 * 기본은 오늘이지만, 화면 최초 진입 시 데이터가 있는 최신 일자로 자동 설정된다
 * (RefreshStatusPage의 useLatestRefreshDate + selectedDateInitialized).
 */
function defaultRange(): { from: Date; to: Date } {
  const now = new Date();
  return { from: startOfDay(now), to: endOfDay(now) };
}

/**
 * design.md "상태 관리(useRefreshFilterStore)" 인터페이스.
 * task 요구에 따라 setReportId/setDatasetId/setWorkspaceId 액션을 함께 노출한다.
 */
export interface RefreshFilterState {
  /** 선택 일자 시작 (해당 일 00:00 KST) */
  from: Date;
  /** 선택 일자 종료 (해당 일 23:59 KST) */
  to: Date;
  /** 선택 Workspace ID (null = 전체) */
  workspaceId: string | null;
  /** 선택 Report ID (null = 전체) */
  reportId: string | null;
  /** 선택 Dataset ID (null = 전체) */
  datasetId: string | null;
  /** 상태 필터 ("all" = 전체) */
  status: RefreshFilterStatus;
  /** 화면에서 제외할 Report ID 집합 (제외 = 타임테이블/표에서 숨김) */
  excludedReportIds: string[];
  /** 자동 새로고침 토글 (기본 false) */
  autoRefresh: boolean;
  /** 자동 새로고침 간격(초). 환경 변수 주입, 기본 60 */
  autoRefreshIntervalSec: number;
  /** 최초 진입 시 '최신 데이터 일자'로 기본 선택을 1회 자동 설정했는지 (세션 내 중복 방지) */
  selectedDateInitialized: boolean;

  /** 기간을 한 번에 설정 */
  setRange: (from: Date, to: Date) => void;
  /** 상태 필터 설정 */
  setStatus: (s: RefreshFilterStatus) => void;
  /** Report 필터 설정 */
  setReportId: (id: string | null) => void;
  /** Dataset 필터 설정 */
  setDatasetId: (id: string | null) => void;
  /** Workspace 필터 설정 */
  setWorkspaceId: (id: string | null) => void;
  /** 특정 Report를 화면에서 제외(숨김) */
  excludeReport: (id: string) => void;
  /** 제외했던 Report를 다시 표시 */
  includeReport: (id: string) => void;
  /** 모든 제외를 해제(전부 다시 표시) */
  clearExcludedReports: () => void;
  /** 자동 새로고침 토글 */
  toggleAutoRefresh: () => void;
  /** '최신 데이터 일자' 자동 기본 설정 완료 표시 (1회) */
  markDateInitialized: () => void;
  /** 필터를 기본값으로 초기화 (autoRefreshIntervalSec는 환경 기준값 유지) */
  reset: () => void;
}

export const useRefreshFilterStore = create<RefreshFilterState>((set) => {
  const { from, to } = defaultRange();
  return {
    from,
    to,
    workspaceId: null,
    reportId: null,
    datasetId: null,
    status: "all",
    excludedReportIds: [],
    autoRefresh: false,
    autoRefreshIntervalSec: DEFAULT_AUTO_REFRESH_INTERVAL_SEC,
    selectedDateInitialized: false,

    setRange: (nextFrom, nextTo) => set({ from: nextFrom, to: nextTo }),
    setStatus: (s) => set({ status: s }),
    setReportId: (id) => set({ reportId: id }),
    setDatasetId: (id) => set({ datasetId: id }),
    setWorkspaceId: (id) => set({ workspaceId: id }),
    excludeReport: (id) =>
      set((state) =>
        state.excludedReportIds.includes(id)
          ? state
          : { excludedReportIds: [...state.excludedReportIds, id] }
      ),
    includeReport: (id) =>
      set((state) => ({
        excludedReportIds: state.excludedReportIds.filter((x) => x !== id),
      })),
    clearExcludedReports: () => set({ excludedReportIds: [] }),
    toggleAutoRefresh: () => set((state) => ({ autoRefresh: !state.autoRefresh })),
    markDateInitialized: () => set({ selectedDateInitialized: true }),
    reset: () => {
      const range = defaultRange();
      set({
        from: range.from,
        to: range.to,
        workspaceId: null,
        reportId: null,
        datasetId: null,
        status: "all",
        excludedReportIds: [],
        autoRefresh: false,
      });
    },
  };
});

export default useRefreshFilterStore;
