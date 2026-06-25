/**
 * 개별 Refresh_Run 막대 (Requirements 15.2, 15.3, 15.4, 15.6).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정":
 *  - 상태별 색상: success/failed/in_progress(+사선 패턴)/unknown
 *  - duration 라벨: 막대 폭 ≥ 30px면 막대 안, 미만이면 막대 오른쪽 (formatDuration)
 *  - hover 시 tooltip 트리거(콜백으로 상위에 위임)
 *  - 진행중 막대 연장은 computeBarGeometry(geometry 계산)에서 처리
 *
 * 좌표는 plot 영역 기준 상대값으로 전달받아 `<g transform>`이 적용된 그룹 내부에서
 * 렌더된다. 막대 자체는 plot 좌표계의 (x, rowTop) 기준으로 그린다.
 */
import { memo } from "react";
import type { RefreshRunOut } from "@/types/refresh";
import { formatDuration } from "@/utils/duration";
import {
  BAR_VERTICAL_PADDING,
  DURATION_LABEL_MIN_WIDTH,
  IN_PROGRESS_PATTERN_ID,
  ROW_HEIGHT,
  STATUS_COLORS,
  type BarGeometry,
} from "./ganttGeometry";

export interface GanttBarProps {
  run: RefreshRunOut;
  geometry: BarGeometry;
  /** 이 막대가 놓인 행 인덱스 (Y 위치 계산용) */
  rowIndex: number;
  /** hover 진입 시 호출. 상위가 tooltip 위치/내용을 관리한다 (Requirement 15.4). */
  onHover: (run: RefreshRunOut, clientX: number, clientY: number) => void;
  /** hover 이탈 시 호출 */
  onLeave: () => void;
}

function GanttBarImpl({ run, geometry, rowIndex, onHover, onLeave }: GanttBarProps) {
  const { x, width, displayDurationSeconds } = geometry;
  const barTop = rowIndex * ROW_HEIGHT + BAR_VERTICAL_PADDING;
  const barHeight = ROW_HEIGHT - BAR_VERTICAL_PADDING * 2;
  const color = STATUS_COLORS[run.status];

  const label = formatDuration(displayDurationSeconds);
  const labelInside = width >= DURATION_LABEL_MIN_WIDTH;
  const labelY = barTop + barHeight / 2;

  return (
    <g
      onMouseEnter={(e) => onHover(run, e.clientX, e.clientY)}
      onMouseMove={(e) => onHover(run, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: "pointer" }}
    >
      {/* 막대 본체 */}
      <rect
        x={x}
        y={barTop}
        width={width}
        height={barHeight}
        rx={3}
        ry={3}
        fill={color}
      />
      {/* 진행중: 사선 패턴 오버레이 (Requirement 15.2) */}
      {run.status === "in_progress" && (
        <rect
          x={x}
          y={barTop}
          width={width}
          height={barHeight}
          rx={3}
          ry={3}
          fill={`url(#${IN_PROGRESS_PATTERN_ID})`}
        />
      )}
      {/* duration 라벨 (Requirement 15.3) */}
      {labelInside ? (
        <text
          x={x + width / 2}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={10}
          fill="#ffffff"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {label}
        </text>
      ) : (
        <text
          x={x + width + 4}
          y={labelY}
          textAnchor="start"
          dominantBaseline="central"
          fontSize={10}
          fill="#475569"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** 막대 50~200개 수준에서 불필요한 리렌더를 막기 위해 memo한다. */
const GanttBar = memo(GanttBarImpl);
export default GanttBar;
