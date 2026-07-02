/**
 * 개별 Refresh_Run 막대 (Requirements 15.2, 15.4, 15.6).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정":
 *  - 상태별 색상: success/failed/in_progress(+사선 패턴)/unknown
 *  - 소요 시간 등 상세 정보는 막대 위 라벨 대신 hover tooltip으로만 노출한다
 *    (막대 라벨은 타임테이블이 지저분해져 제거 — 사용자 피드백).
 *  - hover 시 tooltip 트리거(콜백으로 상위에 위임)
 *  - 진행중 막대 연장은 computeBarGeometry(geometry 계산)에서 처리
 *
 * 좌표는 plot 영역 기준 상대값으로 전달받아 `<g transform>`이 적용된 그룹 내부에서
 * 렌더된다. 막대 자체는 plot 좌표계의 (x, rowTop) 기준으로 그린다.
 */
import { memo } from "react";
import type { RefreshRunOut } from "@/types/refresh";
import {
  BAR_VERTICAL_PADDING,
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
  const { x, width } = geometry;
  const barTop = rowIndex * ROW_HEIGHT + BAR_VERTICAL_PADDING;
  const barHeight = ROW_HEIGHT - BAR_VERTICAL_PADDING * 2;
  const color = STATUS_COLORS[run.status];

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
      {/* 소요 시간 라벨은 제거함 — 상세 정보는 hover tooltip에서 확인 */}
    </g>
  );
}

/** 막대 50~200개 수준에서 불필요한 리렌더를 막기 위해 memo한다. */
const GanttBar = memo(GanttBarImpl);
export default GanttBar;
