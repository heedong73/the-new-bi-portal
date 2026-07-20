/**
 * 현재 시각(local) vertical line (Requirement 15.5).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정":
 *  - 현재 시각을 표시하는 세로선. 1초 단위 갱신은 불필요하고 30초 단위로 충분.
 *  - from~to 범위 안에 있을 때만 렌더한다.
 *
 * 30초 갱신은 `useNow` 훅(setInterval)으로 제공한다. 컨테이너(RefreshTimeline)가
 * 동일 훅을 사용하여 진행중 막대 연장(Requirement 15.6)과 now line이 같은 "현재
 * 시각"을 공유하도록 한다 — 타이머 1개로 일관성과 성능을 모두 확보.
 */
import { useEffect, useState } from "react";
import ko from "@/i18n/ko";
import { AXIS_HEIGHT, LABEL_WIDTH, timeToX } from "./ganttGeometry";

/** 현재 시각(ms)을 주기적으로 갱신하는 훅. */
// 이 모듈은 타이머 훅과 그 값을 표시하는 컴포넌트를 의도적으로 함께 제공한다.
// eslint-disable-next-line react-refresh/only-export-components
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface NowLineProps {
  nowMs: number;
  fromMs: number;
  toMs: number;
  plotWidth: number;
  /** 행 영역 전체 높이(px) — 선을 행 끝까지 그리기 위함 */
  plotAreaHeight: number;
}

/**
 * 현재 시각 세로선. nowMs가 [from, to] 범위를 벗어나면 아무것도 그리지 않는다.
 */
export default function NowLine({
  nowMs,
  fromMs,
  toMs,
  plotWidth,
  plotAreaHeight,
}: NowLineProps) {
  if (nowMs < fromMs || nowMs > toMs) return null;

  const x = LABEL_WIDTH + timeToX(nowMs, fromMs, toMs, plotWidth);
  const top = AXIS_HEIGHT;
  const bottom = AXIS_HEIGHT + plotAreaHeight;

  return (
    <g pointerEvents="none">
      <line
        x1={x}
        y1={top}
        x2={x}
        y2={bottom}
        stroke="#2563eb"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      {/* "현재" 라벨 (축 영역 상단) */}
      <text x={x} y={top - 1} textAnchor="middle" fontSize={9} fill="#2563eb">
        {ko.gantt.now}
      </text>
    </g>
  );
}
