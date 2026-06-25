/**
 * Gantt 타임테이블의 순수 좌표/그룹핑 로직 (Requirement 15).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정"을 따른다.
 *  - 리포트명별로 그룹핑 → `{ rowIndex, run }` 평면화 (Y축 = 리포트명, 행 높이 28px)
 *  - X축: `from` ~ `to`를 px로 선형 매핑, 1시간 단위 그리드
 *  - 진행중(in_progress) 막대는 종료 시각을 현재 시각으로 그려 연장 (Requirement 15.6)
 *
 * 렌더링과 분리된 순수 함수만 모아 단위/property 테스트가 용이하도록 한다.
 * 모든 시각 계산은 절대 시각(ms epoch)으로 수행하므로 타임존과 무관하게 일관된다
 * (ISO 문자열의 `+09:00` / `Z` 오프셋은 `Date.parse`가 절대 시각으로 정규화한다).
 */
import type { RefreshRunOut, RefreshStatus } from "@/types/refresh";
import { KST_OFFSET_MS } from "@/utils/date";

/** 한 행(리포트)의 높이(px) — design.md "행 높이 28px" */
export const ROW_HEIGHT = 28;

/** Y축(리포트명) 라벨 영역 너비(px) */
export const LABEL_WIDTH = 200;

/** 상단 X축(시간) 영역 높이(px) */
export const AXIS_HEIGHT = 28;

/** 행 안에서 막대 위/아래 여백(px). 막대 높이 = ROW_HEIGHT - 2 * 패딩 */
export const BAR_VERTICAL_PADDING = 5;

/** 막대 최소 폭(px) — 0초에 가까운 refresh도 보이도록 보장 */
export const MIN_BAR_WIDTH = 3;

/**
 * duration 라벨을 막대 "안"에 넣을지 "오른쪽"에 둘지의 임계 폭(px).
 * design.md: 막대 폭 ≥ 30px면 막대 안, 미만이면 막대 오른쪽 (Requirement 15.3).
 */
export const DURATION_LABEL_MIN_WIDTH = 30;

/** 진행중 막대 사선 패턴 SVG `<pattern>` id */
export const IN_PROGRESS_PATTERN_ID = "gantt-in-progress-stripes";

/**
 * 상태별 막대 색상 (Requirement 15.2).
 * design.md 명시:
 *   success → #10b981, failed → #ef4444, in_progress → #f59e0b(+사선), unknown → #9ca3af
 */
export const STATUS_COLORS: Record<RefreshStatus, string> = {
  success: "#10b981",
  failed: "#ef4444",
  in_progress: "#f59e0b",
  unknown: "#9ca3af",
};

/** 그룹핑된 한 행(리포트명 + 해당 리포트의 refresh 목록) */
export interface GanttRow {
  reportName: string;
  runs: RefreshRunOut[];
}

/** 평면화된 막대 1개: 어떤 행(rowIndex)에 어떤 run이 놓이는지 */
export interface FlatRun {
  rowIndex: number;
  run: RefreshRunOut;
}

/**
 * 리포트명별로 그룹핑하고, 각 리포트의 "가장 빠른 refresh 시작 시각" 오름차순으로
 * 행 순서를 정렬한다. 즉 가장 일찍 시작하는 리포트가 맨 위에 온다.
 * 동률(같은 시작 시각)이면 리포트명 가나다순(localeCompare 'ko')으로 배치한다.
 * 같은 리포트의 여러 refresh는 같은 행(같은 rowIndex)에 놓인다.
 */
export function groupRunsByReport(runs: RefreshRunOut[]): GanttRow[] {
  const byName = new Map<string, RefreshRunOut[]>();
  for (const run of runs) {
    const key = run.reportName && run.reportName.length > 0 ? run.reportName : "(이름 없음)";
    let bucket = byName.get(key);
    if (!bucket) {
      bucket = [];
      byName.set(key, bucket);
    }
    bucket.push(run);
  }

  /** 해당 리포트의 가장 빠른 시작 시각(ms). 없으면 +Infinity(맨 아래로). */
  const earliestStartMs = (bucket: RefreshRunOut[]): number => {
    let min = Number.POSITIVE_INFINITY;
    for (const run of bucket) {
      const ms = run.startTimeLocal ? Date.parse(run.startTimeLocal) : NaN;
      if (!Number.isNaN(ms) && ms < min) min = ms;
    }
    return min;
  };

  return Array.from(byName.entries())
    .map(([reportName, bucket]) => ({
      reportName,
      runs: bucket,
      _earliest: earliestStartMs(bucket),
    }))
    .sort((a, b) => {
      // 1순위: 가장 빠른 시작 시각 오름차순
      if (a._earliest !== b._earliest) return a._earliest - b._earliest;
      // 2순위(동률): 리포트명 가나다순
      return a.reportName.localeCompare(b.reportName, "ko");
    })
    .map(({ reportName, runs }) => ({ reportName, runs }));
}

/**
 * 그룹을 `{ rowIndex, run }` 형태로 평면화한다.
 * rowIndex는 `rows` 배열에서의 행 인덱스(= Y축 위치)와 일치한다.
 */
export function flattenRows(rows: GanttRow[]): FlatRun[] {
  const flat: FlatRun[] = [];
  rows.forEach((row, rowIndex) => {
    for (const run of row.runs) {
      flat.push({ rowIndex, run });
    }
  });
  return flat;
}

/**
 * 절대 시각(ms)을 X 좌표(px)로 선형 매핑한다. `[from, to]` 범위를 벗어나면 clamp한다.
 */
export function timeToX(tMs: number, fromMs: number, toMs: number, plotWidth: number): number {
  if (!(toMs > fromMs)) return 0;
  const ratio = (tMs - fromMs) / (toMs - fromMs);
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  return clamped * plotWidth;
}

/** 막대의 X 좌표/폭 계산 결과. 범위를 완전히 벗어나면 null. */
export interface BarGeometry {
  /** 막대 좌측 X (px, plot 영역 기준) */
  x: number;
  /** 막대 폭 (px, 최소 MIN_BAR_WIDTH) */
  width: number;
  /** 표시에 사용할 소요 시간(초). 진행중은 (now - start) 동적 계산값 */
  displayDurationSeconds: number;
}

/**
 * 단일 refresh run의 막대 geometry를 계산한다 (Requirement 15.6 진행중 연장 포함).
 *
 *  - startTimeLocal이 없거나 파싱 불가하면 null (그릴 수 없음).
 *  - 진행중(in_progress)이거나 endTimeLocal이 없으면 종료 시각 = 현재 시각(nowMs).
 *  - 막대가 [from, to] 범위를 완전히 벗어나면 null.
 *  - 범위에 걸치면 timeToX의 clamp로 가시 영역만 그린다.
 *
 * @param run 대상 refresh run
 * @param fromMs 타임라인 시작(ms)
 * @param toMs 타임라인 종료(ms)
 * @param plotWidth plot 영역 너비(px)
 * @param nowMs 현재 시각(ms) — 진행중 막대 연장 및 clamp 기준
 */
export function computeBarGeometry(
  run: RefreshRunOut,
  fromMs: number,
  toMs: number,
  plotWidth: number,
  nowMs: number
): BarGeometry | null {
  const startMs = run.startTimeLocal ? Date.parse(run.startTimeLocal) : NaN;
  if (Number.isNaN(startMs)) return null;

  let endMs: number;
  if (run.status === "in_progress" || !run.endTimeLocal) {
    // 진행중: 현재 시각까지 연장 (Requirement 15.6)
    endMs = nowMs;
  } else {
    const parsed = Date.parse(run.endTimeLocal);
    endMs = Number.isNaN(parsed) ? startMs : parsed;
  }
  if (endMs < startMs) endMs = startMs;

  // [from, to]를 완전히 벗어나면 그리지 않는다.
  if (endMs < fromMs || startMs > toMs) return null;

  const x1 = timeToX(startMs, fromMs, toMs, plotWidth);
  const x2 = timeToX(endMs, fromMs, toMs, plotWidth);
  const width = Math.max(MIN_BAR_WIDTH, x2 - x1);

  const displayDurationSeconds =
    run.durationSeconds != null
      ? run.durationSeconds
      : Math.max(0, Math.floor((endMs - startMs) / 1000));

  return { x: x1, width, displayDurationSeconds };
}

/**
 * [from, to] 구간의 1시간 경계 시각(ms) 목록을 생성한다 (X축 그리드/라벨용).
 * 각 tick은 KST(Asia/Seoul) 정시(분/초 0)의 절대 ms에 위치한다.
 * 브라우저 로컬 타임존과 무관하게 KST 벽시계 정시에 맞춰야 막대·X축·tooltip이
 * 모두 정렬되므로, KST 벽시계 ms로 내림한 뒤 절대 ms로 복원한다.
 */
export function buildHourTicks(fromMs: number, toMs: number): number[] {
  if (!(toMs > fromMs)) return [];
  const HOUR = 3_600_000;
  // KST 벽시계 ms로 변환해 정시로 내림한 뒤, 다시 절대 ms로 복원한다.
  const kstMs = fromMs + KST_OFFSET_MS;
  let t = Math.floor(kstMs / HOUR) * HOUR - KST_OFFSET_MS; // KST 정시의 절대 ms
  if (t < fromMs) t += HOUR;
  const ticks: number[] = [];
  // 안전 상한: 과도한 구간에서 무한 루프 방지 (최대 24*14 tick)
  let guard = 0;
  for (; t <= toMs && guard < 24 * 14; t += HOUR, guard += 1) {
    ticks.push(t);
  }
  return ticks;
}

/** 전체 plot 높이(px) = 행 수 × 행 높이 */
export function plotHeight(rowCount: number): number {
  return rowCount * ROW_HEIGHT;
}
