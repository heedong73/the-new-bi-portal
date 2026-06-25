/**
 * ganttGeometry 단위 테스트 (Requirement 15: 좌표 매핑/그룹핑/진행중 연장).
 *
 *  - groupRunsByReport: 리포트명별 그룹핑, 첫 등장 순서 보존
 *  - flattenRows: { rowIndex, run } 평면화, 같은 리포트는 같은 rowIndex
 *  - timeToX: 선형 매핑 + 범위 밖 clamp
 *  - computeBarGeometry: 진행중(in_progress) 막대의 현재 시각 연장(15.6), 범위 밖 제외
 *  - buildHourTicks: 정시 1시간 단위 tick
 */
import { describe, expect, it } from "vitest";
import type { RefreshRunOut } from "@/types/refresh";
import {
  MIN_BAR_WIDTH,
  buildHourTicks,
  computeBarGeometry,
  flattenRows,
  groupRunsByReport,
  timeToX,
} from "./ganttGeometry";

function makeRun(over: Partial<RefreshRunOut>): RefreshRunOut {
  return {
    reportId: "rep-1",
    reportName: "리포트 A",
    datasetId: "ds-1",
    datasetName: "데이터셋 A",
    refreshType: "Scheduled",
    status: "success",
    startTimeUtc: null,
    endTimeUtc: null,
    startTimeLocal: null,
    endTimeLocal: null,
    durationSeconds: null,
    requestId: "req-1",
    errorMessage: null,
    ...over,
  };
}

describe("groupRunsByReport / flattenRows", () => {
  it("리포트명별로 그룹핑하고 가장 빠른 시작 시각 오름차순으로 정렬한다", () => {
    const runs = [
      makeRun({ reportName: "B", requestId: "1", startTimeLocal: "2026-06-24T09:00:00+09:00" }),
      makeRun({ reportName: "A", requestId: "2", startTimeLocal: "2026-06-24T10:00:00+09:00" }),
      makeRun({ reportName: "B", requestId: "3", startTimeLocal: "2026-06-24T11:00:00+09:00" }),
    ];
    const rows = groupRunsByReport(runs);
    // B의 최빠른 시작(09:00) < A(10:00) → B가 위. 같은 리포트는 한 행에 묶인다.
    expect(rows.map((r) => r.reportName)).toEqual(["B", "A"]);
    expect(rows[0].runs).toHaveLength(2);
    expect(rows[1].runs).toHaveLength(1);
  });

  it("같은 리포트의 여러 refresh는 같은 rowIndex에 평면화된다", () => {
    const runs = [
      makeRun({ reportName: "A", requestId: "1" }),
      makeRun({ reportName: "B", requestId: "2" }),
      makeRun({ reportName: "A", requestId: "3" }),
    ];
    const flat = flattenRows(groupRunsByReport(runs));
    const aRows = flat.filter((f) => f.run.reportName === "A").map((f) => f.rowIndex);
    expect(new Set(aRows).size).toBe(1);
    expect(aRows[0]).toBe(0);
  });
});

describe("timeToX", () => {
  it("범위 내 시각을 선형 매핑한다", () => {
    expect(timeToX(50, 0, 100, 200)).toBe(100); // 중간 → 절반
    expect(timeToX(0, 0, 100, 200)).toBe(0);
    expect(timeToX(100, 0, 100, 200)).toBe(200);
  });

  it("범위를 벗어나면 clamp한다", () => {
    expect(timeToX(-50, 0, 100, 200)).toBe(0);
    expect(timeToX(150, 0, 100, 200)).toBe(200);
  });

  it("from >= to면 0을 반환한다 (방어)", () => {
    expect(timeToX(50, 100, 100, 200)).toBe(0);
  });
});

describe("computeBarGeometry", () => {
  const from = Date.parse("2025-01-15T00:00:00+09:00");
  const to = Date.parse("2025-01-15T24:00:00+09:00");
  const plotWidth = 1000;

  it("완료된 막대의 x/width와 소요시간을 계산한다", () => {
    const run = makeRun({
      status: "success",
      startTimeLocal: "2025-01-15T06:00:00+09:00",
      endTimeLocal: "2025-01-15T06:30:00+09:00",
      durationSeconds: 1800,
    });
    const g = computeBarGeometry(run, from, to, plotWidth, to);
    expect(g).not.toBeNull();
    expect(g!.displayDurationSeconds).toBe(1800);
    expect(g!.width).toBeGreaterThan(MIN_BAR_WIDTH);
    // 06:00 → 06:30 = 24시간 중 0.25h ~ 0.5h
    expect(g!.x).toBeCloseTo((6 / 24) * plotWidth, 0);
  });

  it("진행중 막대는 종료 시각을 현재 시각(now)으로 연장한다 (15.6)", () => {
    const start = "2025-01-15T10:00:00+09:00";
    const now = Date.parse("2025-01-15T10:20:00+09:00"); // 20분 경과
    const run = makeRun({
      status: "in_progress",
      startTimeLocal: start,
      endTimeLocal: null,
      durationSeconds: null,
    });
    const g = computeBarGeometry(run, from, to, plotWidth, now);
    expect(g).not.toBeNull();
    // 20분 = 1200초 (동적 계산)
    expect(g!.displayDurationSeconds).toBe(1200);
    // end(now)의 X가 start의 X보다 우측
    const startX = timeToX(Date.parse(start), from, to, plotWidth);
    expect(g!.x).toBeCloseTo(startX, 0);
  });

  it("startTimeLocal이 없으면 null을 반환한다", () => {
    const run = makeRun({ startTimeLocal: null });
    expect(computeBarGeometry(run, from, to, plotWidth, to)).toBeNull();
  });

  it("범위를 완전히 벗어난 막대는 null을 반환한다", () => {
    const run = makeRun({
      startTimeLocal: "2025-01-10T06:00:00+09:00",
      endTimeLocal: "2025-01-10T06:30:00+09:00",
      durationSeconds: 1800,
    });
    expect(computeBarGeometry(run, from, to, plotWidth, to)).toBeNull();
  });

  it("0초에 가까운 막대도 최소 폭을 보장한다", () => {
    const run = makeRun({
      startTimeLocal: "2025-01-15T06:00:00+09:00",
      endTimeLocal: "2025-01-15T06:00:00+09:00",
      durationSeconds: 0,
    });
    const g = computeBarGeometry(run, from, to, plotWidth, to);
    expect(g!.width).toBe(MIN_BAR_WIDTH);
  });
});

describe("buildHourTicks", () => {
  it("정시 1시간 단위 tick을 생성한다", () => {
    const from = Date.parse("2025-01-15T06:15:00+09:00");
    const to = Date.parse("2025-01-15T09:00:00+09:00");
    const ticks = buildHourTicks(from, to);
    // 07:00, 08:00, 09:00
    expect(ticks).toHaveLength(3);
    ticks.forEach((t) => {
      const d = new Date(t);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
    });
  });

  it("from >= to면 빈 배열을 반환한다", () => {
    expect(buildHourTicks(100, 100)).toEqual([]);
  });
});
