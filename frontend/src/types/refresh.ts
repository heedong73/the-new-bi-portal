/**
 * Backend 응답과 1:1 매핑되는 TypeScript 타입 정의.
 *
 * design.md "API 엔드포인트 명세"의 `RefreshRunOut` (Pydantic) 스키마 및
 * `/api/summary`, `/api/reports`, `/api/datasets`, `/api/refresh-schedules`
 * 응답 형태를 그대로 옮긴다 (Requirements 8.2~8.4, 9.3, 9.5).
 *
 * 단계 1(Frontend mock UI)에서는 `src/mocks/fixtures.ts`가 이 타입을 채우고,
 * 단계 7에서 실제 Backend API 응답이 동일한 타입으로 교체된다(R2.6 회귀 방지).
 */

/**
 * 정규화된 Refresh 상태 enum.
 * design.md "Power BI status 정규화" 표의 내부 enum과 일치한다.
 */
export type RefreshStatus = "success" | "failed" | "in_progress" | "unknown";

/**
 * 단일 Refresh_Run 응답 (Report 단위로 펼쳐진 형태).
 *
 * design.md `RefreshRunOut` (Pydantic) 스키마와 정확히 일치한다.
 * Backend는 datetime을 ISO 8601 문자열로 직렬화하므로 시각 필드는 모두 `string`이다.
 * Asia/Seoul(+09:00) 기준 local 시각과 UTC(`Z`) 시각을 분리하여 제공한다.
 */
export interface RefreshRunOut {
  /** Power BI reportId. paginated report 등에서 null 가능 */
  reportId: string | null;
  /** 리포트명 */
  reportName: string;
  /** Power BI datasetId. paginated report은 null */
  datasetId: string | null;
  /** 데이터셋명. datasetId가 없으면 "데이터셋 없음" */
  datasetName: string;
  /** Scheduled / OnDemand / ViaApi 등 */
  refreshType: string | null;
  /** 정규화된 상태 */
  status: RefreshStatus;
  /** 시작 시각 (UTC, ISO 8601 `...Z`) */
  startTimeUtc: string | null;
  /** 종료 시각 (UTC). 진행중이면 null */
  endTimeUtc: string | null;
  /** 시작 시각 (Asia/Seoul, ISO 8601 `...+09:00`) */
  startTimeLocal: string | null;
  /** 종료 시각 (Asia/Seoul). 진행중이면 null */
  endTimeLocal: string | null;
  /**
   * 예약 시각 (Asia/Seoul). design.md CSV 내보내기 코드(`r.scheduledTimeLocal`)가
   * 참조하는 옵셔널 필드. Scheduled refresh에만 존재할 수 있다.
   */
  scheduledTimeLocal?: string | null;
  /** 소요 시간(초). 진행중이면 응답 시점 기준 동적 계산값 또는 null */
  durationSeconds: number | null;
  /** Power BI requestId (고유 식별자) */
  requestId: string | null;
  /** serviceExceptionJson에서 변환된 한 줄 오류 메시지. 정상이면 null */
  errorMessage: string | null;
}

/** `GET /api/summary`의 `longestRun` 필드 */
export interface LongestRun {
  reportName: string;
  durationSeconds: number;
}

/**
 * `GET /api/summary?date=` 응답.
 * design.md "API 엔드포인트 명세 - GET /api/summary"와 일치한다.
 */
export interface SummaryOut {
  /** 전체 건수 */
  total: number;
  /** 성공 건수 */
  success: number;
  /** 실패 건수 */
  failed: number;
  /** 진행중 건수 */
  inProgress: number;
  /** 평균 소요 시간(초). 완료 건이 없으면 0 */
  averageDurationSeconds: number;
  /** 가장 오래 걸린 Refresh_Run. 데이터가 없으면 null */
  longestRun: LongestRun | null;
  /** 최근 완료 시각 (Asia/Seoul, ISO 8601). 완료 건이 없으면 null */
  lastCompletedAtLocal: string | null;
}

/**
 * `GET /api/reports` 응답 항목.
 * design.md: `{reportId, reportName, datasetId|null, datasetName|"데이터셋 없음"}`
 */
export interface ReportOut {
  reportId: string;
  reportName: string;
  datasetId: string | null;
  datasetName: string;
}

/** `GET /api/datasets` 응답 항목 */
export interface DatasetOut {
  datasetId: string;
  datasetName: string;
}

/**
 * `GET /api/refresh-schedules` 응답 항목.
 * design.md: `{datasetId, datasetName, days[], times[], timezone, enabled}`
 */
export interface ScheduleOut {
  datasetId: string;
  datasetName: string;
  /** 예약 요일 (예: ["Monday", "Tuesday"]) */
  days: string[];
  /** 예약 시각 (예: ["07:00", "13:00"]) */
  times: string[];
  /** 타임존 (예: "Asia/Seoul") */
  timezone: string;
  /** 예약 활성화 여부 */
  enabled: boolean;
}
