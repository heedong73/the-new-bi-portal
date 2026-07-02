/**
 * Refresh 요약(KPI) 클라이언트 계산.
 *
 * 백엔드 `services/summary.py`의 `build_summary`를 그대로 옮긴 것으로, 화면에 표시되는
 * (기간 필터 + 제외 반영) Refresh_Run 목록에서 KPI/요약을 파생한다. 단일 일자 기준
 * `GET /api/summary` 대신 조회 기간 전체를 반영하기 위해 클라이언트에서 계산한다.
 * 표(테이블)·간트와 동일한 runs에서 산출하므로 화면 전체가 일관된다.
 */
import type { RefreshRunOut, SummaryOut } from "@/types/refresh";

/** 표시 중인 runs로부터 요약 지표를 계산한다(build_summary 동치). */
export function computeSummary(runs: RefreshRunOut[]): SummaryOut {
  const total = runs.length;
  const success = runs.filter((r) => r.status === "success").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const inProgress = runs.filter((r) => r.status === "in_progress").length;

  const completed = runs.filter((r) => r.status === "success" || r.status === "failed");
  const durations = completed
    .map((r) => r.durationSeconds)
    .filter((d): d is number => d != null);
  const averageDurationSeconds = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const withDuration = runs.filter((r) => r.durationSeconds != null);
  const longestRun = withDuration.length
    ? (() => {
        const lr = withDuration.reduce((max, r) =>
          (r.durationSeconds ?? 0) > (max.durationSeconds ?? 0) ? r : max
        );
        return { reportName: lr.reportName, durationSeconds: lr.durationSeconds ?? 0 };
      })()
    : null;

  const ends = completed
    .map((r) => r.endTimeLocal)
    .filter((e): e is string => !!e);
  const lastCompletedAtLocal = ends.length
    ? ends.reduce((a, b) => (a > b ? a : b))
    : null;

  return {
    total,
    success,
    failed,
    inProgress,
    averageDurationSeconds,
    longestRun,
    lastCompletedAtLocal,
  };
}
