/**
 * 단계 1(Frontend mock UI) 전용 정적 mock fixture.
 *
 * design.md "Frontend 디렉터리 구조(mocks/)" 및 "MockPowerBIClient 픽스처" 규약을 따른다.
 *  - 5~10개 Report, 3~5개 Dataset (1개 이상 Dataset이 여러 Report에 공유)
 *  - datasetId가 없는 paginated report 1개 (datasetName="데이터셋 없음")
 *  - 각 Dataset당 30~60개 refresh history (success/failed/in_progress/unknown 혼재,
 *    refreshType: Scheduled/OnDemand/ViaApi 혼재)
 *  - 시간은 "현재 시각 기준 ± N분/시간" 동적 계산 → 화면이 항상 최신처럼 보임 (오늘 범위 위주)
 *  - 진행중(in_progress)은 endTime 계열 null
 *  - 실패(failed)는 errorMessage에 한국어/영문 메시지 포함
 *  - 모든 시각은 UTC(`...Z`)와 Asia/Seoul(`...+09:00`)을 모두 채움
 *
 * 단계 7에서 이 모듈은 실제 API 호출(`src/api/refreshApi.ts`)로 교체된다.
 * 컴포넌트는 아래 헬퍼 함수(`getMockTimetable` 등)만 사용하여 fixture와 깔끔히 분리한다.
 *
 * 시간 산술에는 date-fns를 사용하고, KST 오프셋(+09:00)은 명시적으로 적용한다.
 */
import { addSeconds, subMinutes } from "date-fns";
import type {
  DatasetOut,
  RefreshRunOut,
  RefreshStatus,
  ReportOut,
  ScheduleOut,
  SummaryOut,
} from "@/types/refresh";

/** Asia/Seoul 고정 오프셋 (분). DST가 없으므로 +09:00 상수로 충분하다. */
const KST_OFFSET_MINUTES = 9 * 60;

/** 모듈 로드 시점의 "현재 시각"을 한 번만 고정하여 헬퍼 호출 간 일관성을 유지한다. */
const NOW = new Date();

// ---------------------------------------------------------------------------
// 시간 포맷 유틸 (런타임 타임존과 무관하게 명시적 +09:00 / Z 문자열 생성)
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC 기준 ISO 8601 문자열(`YYYY-MM-DDTHH:mm:ssZ`)로 변환한다. */
function toUtcIso(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

/** Asia/Seoul(+09:00) 기준 ISO 8601 문자열로 변환한다. */
function toLocalIso(d: Date): string {
  const kst = new Date(d.getTime() + KST_OFFSET_MINUTES * 60_000);
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  );
}

/** 해당 시각의 KST 기준 일자(`YYYY-MM-DD`)를 반환한다. */
function localDateOf(d: Date): string {
  return toLocalIso(d).slice(0, 10);
}

/** KST 기준 오늘 일자(`YYYY-MM-DD`). 필터/요약 기본 날짜로 사용. */
export const TODAY_LOCAL_DATE = localDateOf(NOW);

// ---------------------------------------------------------------------------
// 결정적 의사난수 생성기 (mulberry32) — 빌드/렌더 간 동일한 분포를 보장한다.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function intBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Datasets (4개) — design.md 요구: 3~5개
// ---------------------------------------------------------------------------

interface DatasetDef {
  datasetId: string;
  datasetName: string;
}

const DATASETS: DatasetDef[] = [
  { datasetId: "ds-sales-0001", datasetName: "매출 통합 데이터셋" },
  { datasetId: "ds-finance-0002", datasetName: "재무 마감 데이터셋" },
  { datasetId: "ds-ops-0003", datasetName: "운영 지표 데이터셋" },
  { datasetId: "ds-marketing-0004", datasetName: "마케팅 캠페인 데이터셋" },
];

// ---------------------------------------------------------------------------
// Reports (7개) — design.md 요구: 5~10개
//   - "매출 통합 데이터셋"(ds-sales-0001)을 3개 Report가 공유 (공유 케이스)
//   - 마지막 1개는 datasetId 없는 paginated report (datasetName="데이터셋 없음")
// ---------------------------------------------------------------------------

interface ReportDef {
  reportId: string;
  reportName: string;
  /** null이면 paginated report */
  datasetId: string | null;
}

const NO_DATASET_NAME = "데이터셋 없음";

const REPORTS: ReportDef[] = [
  // 공유 Dataset(ds-sales-0001)을 사용하는 3개 Report
  { reportId: "rep-0001", reportName: "매출 일일 보고", datasetId: "ds-sales-0001" },
  { reportId: "rep-0002", reportName: "매출 지역별 분석", datasetId: "ds-sales-0001" },
  { reportId: "rep-0003", reportName: "매출 임원 대시보드", datasetId: "ds-sales-0001" },
  // 단일 Dataset Report
  { reportId: "rep-0004", reportName: "재무 마감 현황", datasetId: "ds-finance-0002" },
  { reportId: "rep-0005", reportName: "운영 모니터링", datasetId: "ds-ops-0003" },
  { reportId: "rep-0006", reportName: "마케팅 성과 분석", datasetId: "ds-marketing-0004" },
  // paginated report (datasetId 없음)
  { reportId: "rep-0007", reportName: "월간 정산 명세서(Paginated)", datasetId: null },
];

/** datasetId → datasetName 조회 맵 */
const DATASET_NAME_BY_ID = new Map(DATASETS.map((d) => [d.datasetId, d.datasetName]));

// ---------------------------------------------------------------------------
// Refresh 이력 생성
// ---------------------------------------------------------------------------

const REFRESH_TYPES = ["Scheduled", "OnDemand", "ViaApi"] as const;

/** 상태 분포(가중치): 성공 위주, 실패/진행중/알수없음 소수 혼재 */
const STATUS_WEIGHTS: { status: RefreshStatus; weight: number }[] = [
  { status: "success", weight: 70 },
  { status: "failed", weight: 16 },
  { status: "in_progress", weight: 8 },
  { status: "unknown", weight: 6 },
];

const FAILED_MESSAGES = [
  "[ModelRefreshFailed_CredentialsNotSpecified] 데이터 원본 자격 증명이 지정되지 않았습니다.",
  "[DM_GWPipeline_Gateway_DataSourceAccessError] 게이트웨이에서 데이터 원본에 접근할 수 없습니다.",
  "[Database] Timeout expired. The timeout period elapsed prior to completion.",
  "[QueryUserError] 쿼리 실행 중 메모리 한도를 초과했습니다.",
  "[ModelRefresh_ShortMessage_ProcessingError] 데이터셋 처리 중 오류가 발생했습니다.",
];

function weightedStatus(rng: () => number): RefreshStatus {
  const total = STATUS_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let r = rng() * total;
  for (const { status, weight } of STATUS_WEIGHTS) {
    if (r < weight) return status;
    r -= weight;
  }
  return "success";
}

/**
 * 단일 Dataset에 대한 refresh 이력을 생성한다.
 * 각 run은 NOW 기준 과거로 거슬러 일정 간격(대략 25~70분)으로 배치하여
 * 오늘 범위에 다수가 분포하도록 한다.
 */
function buildRefreshesForDataset(
  datasetId: string,
  datasetName: string,
  seed: number
): RefreshRunOut[] {
  const rng = mulberry32(seed);
  const count = intBetween(rng, 30, 60);
  const runs: RefreshRunOut[] = [];

  // 가장 최근 run의 시작점을 NOW 기준 0~20분 전으로 잡고 과거로 누적한다.
  let cursorStart = subMinutes(NOW, intBetween(rng, 0, 20));

  for (let i = 0; i < count; i++) {
    const status = weightedStatus(rng);
    const refreshType = pick(rng, REFRESH_TYPES);
    const durationSeconds = intBetween(rng, 20, 900); // 20초 ~ 15분

    const startTime = cursorStart;
    const isInProgress = status === "in_progress";
    const endTime = isInProgress ? null : addSeconds(startTime, durationSeconds);

    const scheduled =
      refreshType === "Scheduled"
        ? toLocalIso(subMinutes(startTime, intBetween(rng, 0, 5)))
        : null;

    runs.push({
      reportId: null, // Report 단위 펼침은 조회 헬퍼에서 수행
      reportName: "", // 동일
      datasetId,
      datasetName,
      refreshType,
      status,
      startTimeUtc: toUtcIso(startTime),
      endTimeUtc: endTime ? toUtcIso(endTime) : null,
      startTimeLocal: toLocalIso(startTime),
      endTimeLocal: endTime ? toLocalIso(endTime) : null,
      scheduledTimeLocal: scheduled,
      durationSeconds: isInProgress ? null : durationSeconds,
      requestId: `req-${datasetId}-${String(i).padStart(3, "0")}`,
      errorMessage: status === "failed" ? pick(rng, FAILED_MESSAGES) : null,
    });

    // 다음(더 과거의) run으로 커서 이동
    cursorStart = subMinutes(startTime, intBetween(rng, 25, 70));
  }

  return runs;
}

/** datasetId → 해당 Dataset의 refresh 이력 (모듈 1회 생성) */
const REFRESHES_BY_DATASET: Map<string, RefreshRunOut[]> = new Map(
  DATASETS.map((d, idx) => [
    d.datasetId,
    buildRefreshesForDataset(d.datasetId, d.datasetName, 0x9e3779b1 + idx * 0x1000),
  ])
);

// ---------------------------------------------------------------------------
// Refresh Schedules (Dataset 단위) — design.md `GET /api/refresh-schedules`
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const ALL_DAYS = [...WEEKDAYS, "Saturday", "Sunday"];

/** Dataset별 예약 설정. 일부는 비활성/주말 포함으로 다양성 확보. */
const SCHEDULES: ScheduleOut[] = DATASETS.map((d, idx) => {
  const variants: Pick<ScheduleOut, "days" | "times" | "enabled">[] = [
    { days: WEEKDAYS, times: ["07:00", "13:00"], enabled: true },
    { days: ALL_DAYS, times: ["06:30"], enabled: true },
    { days: WEEKDAYS, times: ["08:00", "12:00", "18:00"], enabled: true },
    { days: ["Monday", "Thursday"], times: ["09:00"], enabled: false },
  ];
  const v = variants[idx % variants.length];
  return {
    datasetId: d.datasetId,
    datasetName: d.datasetName,
    days: v.days,
    times: v.times,
    timezone: "Asia/Seoul",
    enabled: v.enabled,
  };
});

// ---------------------------------------------------------------------------
// Report 단위 펼침 (fan-out) — design.md "Reports ↔ Refresh History join"
//   - 공유 Dataset을 사용하는 Report N개 × Refresh M개 → N×M row (R6.2)
//   - paginated report(datasetId null)은 refresh 없음(빈 배열) (R6.3)
// ---------------------------------------------------------------------------

/**
 * 모든 Report에 대해 Dataset의 refresh 이력을 펼쳐 Report 단위 목록을 만든다.
 * 시작 시각(UTC) 내림차순으로 정렬한다.
 */
function buildReportLevelRuns(): RefreshRunOut[] {
  const out: RefreshRunOut[] = [];
  for (const rep of REPORTS) {
    // paginated report: datasetId 없음 → refresh 목록은 빈 배열 (R6.3)
    if (rep.datasetId === null) continue;

    const datasetName = DATASET_NAME_BY_ID.get(rep.datasetId) ?? NO_DATASET_NAME;
    const datasetRuns = REFRESHES_BY_DATASET.get(rep.datasetId) ?? [];

    for (const run of datasetRuns) {
      out.push({
        ...run,
        reportId: rep.reportId,
        reportName: rep.reportName,
        datasetId: rep.datasetId,
        datasetName,
      });
    }
  }
  out.sort((a, b) => (b.startTimeUtc ?? "").localeCompare(a.startTimeUtc ?? ""));
  return out;
}

/** Report 단위로 펼쳐진 전체 refresh 목록 (모듈 1회 생성) */
const ALL_REPORT_RUNS: RefreshRunOut[] = buildReportLevelRuns();

// ---------------------------------------------------------------------------
// 집계 (SummaryOut) — design.md `GET /api/summary`
// ---------------------------------------------------------------------------

/**
 * 주어진 Refresh_Run 목록을 `SummaryOut`으로 집계한다.
 *  - total/success/failed/inProgress: 상태별 건수
 *  - averageDurationSeconds: durationSeconds가 있는 run의 평균(반올림). 없으면 0
 *  - longestRun: durationSeconds 최댓값 run의 {reportName, durationSeconds}. 없으면 null
 *  - lastCompletedAtLocal: endTimeLocal이 있는 run 중 가장 최근 값. 없으면 null
 */
export function buildSummary(runs: RefreshRunOut[]): SummaryOut {
  let success = 0;
  let failed = 0;
  let inProgress = 0;
  let durationSum = 0;
  let durationCount = 0;
  let longestRun: SummaryOut["longestRun"] = null;
  let lastCompletedAtLocal: string | null = null;

  for (const run of runs) {
    if (run.status === "success") success += 1;
    else if (run.status === "failed") failed += 1;
    else if (run.status === "in_progress") inProgress += 1;

    if (run.durationSeconds != null) {
      durationSum += run.durationSeconds;
      durationCount += 1;
      if (longestRun == null || run.durationSeconds > longestRun.durationSeconds) {
        longestRun = {
          reportName: run.reportName,
          durationSeconds: run.durationSeconds,
        };
      }
    }

    if (run.endTimeLocal != null) {
      if (lastCompletedAtLocal == null || run.endTimeLocal > lastCompletedAtLocal) {
        lastCompletedAtLocal = run.endTimeLocal;
      }
    }
  }

  return {
    total: runs.length,
    success,
    failed,
    inProgress,
    averageDurationSeconds:
      durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    longestRun,
    lastCompletedAtLocal,
  };
}

// ---------------------------------------------------------------------------
// Public mock 접근자 — 컴포넌트는 아래 함수만 사용한다.
//   (단계 7에서 동일 시그니처의 실제 API 호출로 교체)
// ---------------------------------------------------------------------------

/** `GET /api/reports` 대응. paginated report은 datasetName="데이터셋 없음". */
export function getMockReports(): ReportOut[] {
  return REPORTS.map((r) => ({
    reportId: r.reportId,
    reportName: r.reportName,
    datasetId: r.datasetId,
    datasetName:
      r.datasetId == null
        ? NO_DATASET_NAME
        : DATASET_NAME_BY_ID.get(r.datasetId) ?? NO_DATASET_NAME,
  }));
}

/** `GET /api/datasets` 대응. */
export function getMockDatasets(): DatasetOut[] {
  return DATASETS.map((d) => ({
    datasetId: d.datasetId,
    datasetName: d.datasetName,
  }));
}

/** `GET /api/refresh-schedules` 대응. */
export function getMockSchedules(): ScheduleOut[] {
  return SCHEDULES.map((s) => ({ ...s }));
}

/**
 * `GET /api/refresh-timetable` 대응 (Report 단위 펼침).
 * 선택적 필터(from/to ISO local, status, reportId, datasetId)를 적용한다.
 */
export function getMockTimetable(filters?: {
  from?: string;
  to?: string;
  status?: RefreshStatus;
  reportId?: string;
  datasetId?: string;
}): RefreshRunOut[] {
  let runs = ALL_REPORT_RUNS;
  if (filters) {
    runs = runs.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.reportId && r.reportId !== filters.reportId) return false;
      if (filters.datasetId && r.datasetId !== filters.datasetId) return false;
      if (filters.from && (r.startTimeLocal ?? "") < filters.from) return false;
      if (filters.to && (r.startTimeLocal ?? "") > filters.to) return false;
      return true;
    });
  }
  return runs.map((r) => ({ ...r }));
}

/**
 * `GET /api/refresh-history?date=` 대응.
 * 지정 일자(KST, 기본 오늘)의 startTimeLocal을 가진 run만 반환한다.
 */
export function getMockRefreshHistory(date: string = TODAY_LOCAL_DATE): RefreshRunOut[] {
  return ALL_REPORT_RUNS.filter(
    (r) => r.startTimeLocal != null && r.startTimeLocal.slice(0, 10) === date
  ).map((r) => ({ ...r }));
}

/**
 * `GET /api/summary?date=` 대응.
 * 지정 일자(KST, 기본 오늘)의 run을 집계한다.
 */
export function getMockSummary(date: string = TODAY_LOCAL_DATE): SummaryOut {
  return buildSummary(getMockRefreshHistory(date));
}

/** 필터 없이 Report 단위로 펼쳐진 전체 refresh 목록을 반환한다. */
export function getAllReportRuns(): RefreshRunOut[] {
  return ALL_REPORT_RUNS.map((r) => ({ ...r }));
}
