/**
 * TanStack Query 훅 (단계 7).
 *
 * design.md "상태 관리 - TanStack Query" 및 "자동 새로고침" 절을 구현한다.
 *  - 서버 상태(refresh 데이터)는 TanStack Query가 담당한다.
 *  - 자동 새로고침: `useRefreshFilterStore`의 `autoRefresh`/`autoRefreshIntervalSec`을
 *    읽어 `refetchInterval = autoRefresh ? autoRefreshIntervalSec * 1000 : false`로 설정.
 *    (Requirements 12.3, 14)
 *  - queryKey는 `['refresh-timetable', filters]` 형태로 필터를 포함하여 캐시를 분리한다.
 *  - staleTime은 10초로 두어 빈번한 재조회를 억제한다(main.tsx 기본값과 일치).
 *
 * 오류는 `refreshApi` → `apiClient`가 `ApiError`로 표준화하므로, 각 훅의 `error`는
 * ErrorBanner의 `ApiErrorLike`와 호환된다(Requirement 19.1).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import refreshApi, {
  type CollectNowResult,
  type TimetableFilterInput,
} from "@/api/refreshApi";
import { useRefreshFilterStore } from "@/stores/useRefreshFilterStore";
import type {
  DatasetOut,
  ReportOut,
  RefreshRunOut,
  ScheduleOut,
  SummaryOut,
} from "@/types/refresh";

/** 메타데이터(reports/datasets/schedules)는 자주 바뀌지 않으므로 staleTime을 길게. */
const META_STALE_TIME = 5 * 60_000;

/**
 * 필터를 queryKey에 안정적으로 직렬화한다.
 * Date는 epoch(ms)로 변환하여 동일 시각이면 동일 key가 되도록 한다.
 */
function serializeFilters(filters: TimetableFilterInput) {
  return {
    from: filters.from ? filters.from.getTime() : null,
    to: filters.to ? filters.to.getTime() : null,
    status: filters.status ?? "all",
    reportId: filters.reportId ?? null,
    datasetId: filters.datasetId ?? null,
  };
}

/** 자동 새로고침 간격(ms) 또는 false를 store에서 도출한다. */
function useRefetchInterval(): number | false {
  const autoRefresh = useRefreshFilterStore((s) => s.autoRefresh);
  const intervalSec = useRefreshFilterStore((s) => s.autoRefreshIntervalSec);
  return autoRefresh ? intervalSec * 1000 : false;
}

/**
 * `GET /api/refresh-timetable` — 필터 적용 Refresh_Run 목록.
 * Gantt / 하단 차트 / 상세 테이블의 데이터 소스.
 */
export function useRefreshTimetable(
  filters: TimetableFilterInput
): UseQueryResult<RefreshRunOut[]> {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: ["refresh-timetable", serializeFilters(filters)],
    queryFn: ({ signal }) => refreshApi.getTimetable(filters, signal),
    refetchInterval,
    staleTime: 10_000,
  });
}

/**
 * `GET /api/refresh-history?date=` — 지정 일자 실행 목록.
 * 우측 ExecutionFlow 패널의 데이터 소스(오늘 실행).
 */
export function useRefreshHistory(date: string): UseQueryResult<RefreshRunOut[]> {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: ["refresh-history", date],
    queryFn: ({ signal }) => refreshApi.getRefreshHistory(date, signal),
    refetchInterval,
    staleTime: 10_000,
  });
}

/**
 * `GET /api/summary?date=` — KPI / 요약 지표.
 */
export function useSummary(date: string): UseQueryResult<SummaryOut> {
  const refetchInterval = useRefetchInterval();
  return useQuery({
    queryKey: ["summary", date],
    queryFn: ({ signal }) => refreshApi.getSummary(date, signal),
    refetchInterval,
    staleTime: 10_000,
  });
}

/** `GET /api/reports` — FilterBar의 Report 옵션. */
export function useReports(): UseQueryResult<ReportOut[]> {
  return useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => refreshApi.getReports(signal),
    staleTime: META_STALE_TIME,
  });
}

/** `GET /api/datasets` — FilterBar의 Dataset 옵션. */
export function useDatasets(): UseQueryResult<DatasetOut[]> {
  return useQuery({
    queryKey: ["datasets"],
    queryFn: ({ signal }) => refreshApi.getDatasets(signal),
    staleTime: META_STALE_TIME,
  });
}

/** `GET /api/refresh-schedules` — 예약 설정. */
export function useSchedules(): UseQueryResult<ScheduleOut[]> {
  return useQuery({
    queryKey: ["refresh-schedules"],
    queryFn: ({ signal }) => refreshApi.getSchedules(signal),
    staleTime: META_STALE_TIME,
  });
}

/**
 * `POST /api/collect-now` — 즉시 수집 트리거 (mutation).
 * 성공 시 refresh 관련 쿼리를 무효화하여 최신 데이터를 재조회한다(task 7.2에서 활용).
 */
export function useCollectNow(): UseMutationResult<CollectNowResult, unknown, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshApi.postCollectNow(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["refresh-timetable"] });
      queryClient.invalidateQueries({ queryKey: ["refresh-history"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}
