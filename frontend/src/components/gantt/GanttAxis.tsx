/**
 * Gantt X축(시간) + Y축(리포트명) (Requirement 15.1).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정":
 *  - X축: from~to를 px 선형 매핑, 1시간 단위 그리드 라인 + 라벨
 *  - Y축: 리포트명 라벨 (행 높이 28px)
 *
 * 두 축을 분리된 하위 컴포넌트로 두되, 막대(GanttBar)와 동일한 plot 좌표계를 공유한다.
 * 시간 tick의 라벨은 KST(Asia/Seoul) 절대 시각을 `HH:mm`으로 표시한다.
 */
import {
  AXIS_HEIGHT,
  LABEL_WIDTH,
  ROW_HEIGHT,
  buildHourTicks,
  timeToX,
  type GanttRow,
} from "./ganttGeometry";
import { formatKstHourMinute } from "@/utils/date";

export interface GanttXAxisProps {
  fromMs: number;
  toMs: number;
  plotWidth: number;
  /** plot 영역 전체 높이(px) — 그리드 라인을 행 영역까지 그리기 위함 */
  plotAreaHeight: number;
}

/**
 * X축: 상단 시각 라벨 + 1시간 그리드 세로선.
 * `<g transform>`으로 plot 좌측(LABEL_WIDTH) 이후, 상단(AXIS_HEIGHT) 영역에 배치된다.
 */
export function GanttXAxis({ fromMs, toMs, plotWidth, plotAreaHeight }: GanttXAxisProps) {
  const ticks = buildHourTicks(fromMs, toMs);

  return (
    <g>
      {/* 축 하단 경계선 */}
      <line
        x1={LABEL_WIDTH}
        y1={AXIS_HEIGHT}
        x2={LABEL_WIDTH + plotWidth}
        y2={AXIS_HEIGHT}
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      {ticks.map((t) => {
        const x = LABEL_WIDTH + timeToX(t, fromMs, toMs, plotWidth);
        return (
          <g key={t}>
            {/* 1시간 그리드 세로선 (행 영역까지) */}
            <line
              x1={x}
              y1={AXIS_HEIGHT}
              x2={x}
              y2={AXIS_HEIGHT + plotAreaHeight}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            {/* 시각 라벨 */}
            <text
              x={x}
              y={AXIS_HEIGHT - 8}
              textAnchor="middle"
              fontSize={10}
              fill="#64748b"
              style={{ userSelect: "none" }}
            >
              {formatKstHourMinute(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface GanttYAxisProps {
  rows: GanttRow[];
  plotWidth: number;
  /** 행(리포트) 제외 버튼 클릭 콜백. 주어지면 각 행에 × 버튼을 표시한다. */
  onExcludeReport?: (reportName: string) => void;
}

/**
 * Y축: 리포트명 라벨 + 행 구분선.
 * 라벨 영역(LABEL_WIDTH) 안에 행 높이(ROW_HEIGHT) 단위로 리포트명을 배치한다.
 * onExcludeReport가 주어지면 각 행 우측에 "×"(제외) 버튼을 표시한다.
 */
export function GanttYAxis({ rows, plotWidth, onExcludeReport }: GanttYAxisProps) {
  return (
    <g>
      {rows.map((row, i) => {
        const rowTop = AXIS_HEIGHT + i * ROW_HEIGHT;
        const centerY = rowTop + ROW_HEIGHT / 2;
        return (
          <g key={row.reportName}>
            {/* 행 배경 구분선 */}
            <line
              x1={0}
              y1={rowTop + ROW_HEIGHT}
              x2={LABEL_WIDTH + plotWidth}
              y2={rowTop + ROW_HEIGHT}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            {/* 리포트명 라벨 (넘치면 ellipsis 효과를 위해 title 제공) */}
            <text
              x={8}
              y={centerY}
              dominantBaseline="central"
              fontSize={11}
              fill="#334155"
              style={{ userSelect: "none" }}
            >
              {truncateLabel(row.reportName)}
              <title>{row.reportName}</title>
            </text>
            {/* 제외(×) 버튼 — 라벨 영역 우측 끝 */}
            {onExcludeReport && (
              <g
                role="button"
                tabIndex={0}
                onClick={() => onExcludeReport(row.reportName)}
                style={{ cursor: "pointer" }}
                aria-label={`${row.reportName} 제외`}
              >
                <title>{`${row.reportName} 제외`}</title>
                <rect
                  x={LABEL_WIDTH - 22}
                  y={centerY - 8}
                  width={16}
                  height={16}
                  rx={3}
                  fill="transparent"
                />
                <text
                  x={LABEL_WIDTH - 14}
                  y={centerY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={13}
                  fill="#94a3b8"
                  style={{ userSelect: "none" }}
                >
                  ×
                </text>
              </g>
            )}
          </g>
        );
      })}
      {/* Y축 우측 경계선 */}
      <line
        x1={LABEL_WIDTH}
        y1={AXIS_HEIGHT}
        x2={LABEL_WIDTH}
        y2={AXIS_HEIGHT + rows.length * ROW_HEIGHT}
        stroke="#e2e8f0"
        strokeWidth={1}
      />
    </g>
  );
}

/** 라벨 영역(LABEL_WIDTH)에 맞도록 대략적으로 자른다 (SVG는 CSS ellipsis 미지원). */
function truncateLabel(label: string, maxChars = 20): string {
  if (label.length <= maxChars) return label;
  return label.slice(0, maxChars - 1) + "…";
}
