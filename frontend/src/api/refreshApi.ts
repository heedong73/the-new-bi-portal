/**
 * Backend `/api/*` 엔드포인트 호출 함수 모음 (단계 7).
 *
 * design.md "API 엔드포인트 명세"의 각 엔드포인트를 fetch 기반 `apiClient`로 호출한다.
 * 응답 타입은 `src/types/refresh.ts`(Backend 1:1 매핑)를 그대로 사용한다.
 *
 * 필터 직렬화 규약 (Requirements 9.2, 13.2):
 *  - status "all" → status 파라미터 미전달(전체 조회)
 *  - reportId/datasetId가 null/undefined → 미전달
 *  - from/to(Date) → ISO 8601 문자열(`toISOString()`, UTC `Z`)로 직렬화.
 *    Backend는 timezone-aware 비교를 수행하므로 절대 시각으로 전달해도 정확하다.
 *
 * 단계 1의 mock fixture(getMockTimetable 등)를 대체하며, 외부 인터페이스(응답 스키마)는
 * 동일하게 유지하여 회귀를 방지한다(R2.6).
 */
import apiClient from "@/api/client";
import type { RefreshFilterStatus } from "@/stores/useRefreshFilterStore";
import type {
  DatasetOut,
  ReportOut,
  RefreshRunOut,
  ScheduleOut,
  SummaryOut,
} from "@/types/refresh";

/** `POST /api/collect-now` 응답. */
export interface CollectNowResult {
  status: "enqueued" | "already-running";
  taskId?: string;
}

/** `GET /api/collect-status` 응답 — 현재 수집 진행 여부(분산 락 점유). */
export interface CollectStatusResult {
  running: boolean;
}

/** `GET /api/refresh-latest-date` 응답 — 데이터가 있는 가장 최근 일자(APP_TZ). */
export interface LatestDateResult {
  date: string | null; // "YYYY-MM-DD"
}

/**
 * `/api/refresh-timetable` 호출에 사용하는 필터 입력.
 * 필터 store 상태(`from/to/status/reportId/datasetId`)를 그대로 받을 수 있는 형태다.
 */
export interface TimetableFilterInput {
  from?: Date | null;
  to?: Date | null;
  status?: RefreshFilterStatus;
  reportId?: string | null;
  datasetId?: string | null;
}

/** Date를 ISO 8601 문자열로 직렬화한다. 유효하지 않으면 undefined(미전달). */
function toIso(d?: Date | null): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** status "all" 또는 미지정은 undefined(미전달)로 매핑한다. */
function toStatusParam(status?: RefreshFilterStatus): string | undefined {
  if (!status || status === "all") return undefined;
  return status;
}

/**
 * `GET /api/refresh-timetable?from&to&status&reportId&datasetId`
 * 선택적 필터를 적용한 Report 단위 Refresh_Run 목록을 조회한다.
 */
export function getTimetable(
  filters: TimetableFilterInput = {},
  signal?: AbortSignal
): Promise<RefreshRunOut[]> {
  return apiClient.get<RefreshRunOut[]>("/api/refresh-timetable", {
    query: {
      from: toIso(filters.from),
      to: toIso(filters.to),
      status: toStatusParam(filters.status),
      reportId: filters.reportId ?? undefined,
      datasetId: filters.datasetId ?? undefined,
    },
    signal,
  });
}

/**
 * `GET /api/refresh-history?date={YYYY-MM-DD}`
 * 지정 일자(APP_TIMEZONE 기준)의 Refresh_Run 목록을 조회한다.
 */
export function getRefreshHistory(
  date: string,
  signal?: AbortSignal
): Promise<RefreshRunOut[]> {
  return apiClient.get<RefreshRunOut[]>("/api/refresh-history", {
    query: { date },
    signal,
  });
}

/**
 * `GET /api/summary?date={YYYY-MM-DD}`
 * 지정 일자의 KPI/요약 지표를 조회한다.
 */
export function getSummary(date: string, signal?: AbortSignal): Promise<SummaryOut> {
  return apiClient.get<SummaryOut>("/api/summary", {
    query: { date },
    signal,
  });
}

/** `GET /api/reports` — Workspace의 Report 목록. */
export function getReports(signal?: AbortSignal): Promise<ReportOut[]> {
  return apiClient.get<ReportOut[]>("/api/reports", { signal });
}

/** `GET /api/datasets` — Workspace의 Dataset 목록. */
export function getDatasets(signal?: AbortSignal): Promise<DatasetOut[]> {
  return apiClient.get<DatasetOut[]>("/api/datasets", { signal });
}

/** `GET /api/refresh-schedules` — Dataset별 예약 refresh 설정. */
export function getSchedules(signal?: AbortSignal): Promise<ScheduleOut[]> {
  return apiClient.get<ScheduleOut[]>("/api/refresh-schedules", { signal });
}

/** `POST /api/collect-now` — 즉시 수집 트리거. */
export function postCollectNow(): Promise<CollectNowResult> {
  return apiClient.post<CollectNowResult>("/api/collect-now");
}

/** `GET /api/collect-status` — 현재 수집 진행 여부(진행 배너 폴링용). */
export function getCollectStatus(signal?: AbortSignal): Promise<CollectStatusResult> {
  return apiClient.get<CollectStatusResult>("/api/collect-status", { signal });
}

/** `GET /api/refresh-latest-date` — 데이터가 있는 가장 최근 일자(기본 선택 일자용). */
export function getLatestDate(signal?: AbortSignal): Promise<LatestDateResult> {
  return apiClient.get<LatestDateResult>("/api/refresh-latest-date", { signal });
}

export const refreshApi = {
  getTimetable,
  getRefreshHistory,
  getSummary,
  getReports,
  getDatasets,
  getSchedules,
  postCollectNow,
  getCollectStatus,
  getLatestDate,
};

export default refreshApi;
