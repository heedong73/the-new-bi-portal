/**
 * Refresh Timeline (Gantt) 컨테이너 (Requirement 15: 15.1~15.6).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정"의 SVG 직접 구현을 따른다.
 *  - props: runs(RefreshRunOut[]), from(Date), to(Date)
 *  - 리포트명별 그룹핑 → `{ rowIndex, run }` 평면화 (Y축 = 리포트명, 행 높이 28px)
 *  - X축 시간 선형 매핑(px), 1시간 그리드 (GanttXAxis)
 *  - 막대(GanttBar): 상태별 색상, hover tooltip (소요 시간 등 상세는 tooltip에서)
 *  - NowLine: 현재 시각 세로선(30초 갱신), 진행중 막대 연장과 동일한 nowMs 공유
 *  - 데이터 없으면 ko.gantt.noData 표시
 *
 * 반응형: ResizeObserver로 컨테이너 너비를 추적해 SVG plot 너비를 조정한다.
 * 성능: now line만 30초 주기로 갱신하고, 막대는 memo된 GanttBar로 불필요한 리렌더를
 * 억제한다(50~200개 수준 가정).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ko from "@/i18n/ko";
import type { RefreshRunOut } from "@/types/refresh";
import GanttBar from "./GanttBar";
import { GanttXAxis, GanttYAxis } from "./GanttAxis";
import NowLine, { useNow } from "./NowLine";
import GanttTooltip, { type TooltipState } from "./GanttTooltip";
import {
  AXIS_HEIGHT,
  IN_PROGRESS_PATTERN_ID,
  LABEL_WIDTH,
  computeBarGeometry,
  flattenRows,
  groupRunsByReport,
  plotHeight,
} from "./ganttGeometry";

export interface RefreshTimelineProps {
  /** Report 단위로 펼쳐진 refresh 목록 */
  runs: RefreshRunOut[];
  /** 타임라인 시작(local) */
  from: Date;
  /** 타임라인 종료(local) */
  to: Date;
  /** 행(리포트) 제외 콜백. 주어지면 각 행에 × 버튼이 표시된다. */
  onExcludeReport?: (reportName: string) => void;
}

/** plot 최소 너비(px) — 컨테이너 측정 전/너무 좁을 때 하한 */
const MIN_PLOT_WIDTH = 320;

export default function RefreshTimeline({
  runs,
  from,
  to,
  onExcludeReport,
}: RefreshTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // now line + 진행중 막대 연장을 위한 공유 현재 시각 (30초 갱신)
  const nowMs = useNow(30_000);

  const fromMs = from.getTime();
  const toMs = to.getTime();

  // 컨테이너 너비 추적 (반응형)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 리포트명별 그룹핑 → 행
  const rows = useMemo(() => groupRunsByReport(runs), [runs]);
  const flat = useMemo(() => flattenRows(rows), [rows]);

  const plotWidth = Math.max(MIN_PLOT_WIDTH, containerWidth - LABEL_WIDTH);
  const areaHeight = plotHeight(rows.length);
  const svgHeight = AXIS_HEIGHT + areaHeight;
  const svgWidth = LABEL_WIDTH + plotWidth;

  // 각 막대의 geometry를 미리 계산 (범위 밖이면 제외)
  const bars = useMemo(() => {
    return flat
      .map(({ rowIndex, run }) => {
        const geometry = computeBarGeometry(run, fromMs, toMs, plotWidth, nowMs);
        return geometry ? { rowIndex, run, geometry } : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [flat, fromMs, toMs, plotWidth, nowMs]);

  const handleHover = (run: RefreshRunOut, clientX: number, clientY: number) => {
    const geometry = computeBarGeometry(run, fromMs, toMs, plotWidth, nowMs);
    setTooltip({
      run,
      displayDurationSeconds: geometry?.displayDurationSeconds ?? run.durationSeconds ?? 0,
      clientX,
      clientY,
    });
  };
  const handleLeave = () => setTooltip(null);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label={ko.gantt.title}>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{ko.gantt.title}</h2>

      <div ref={containerRef} className="w-full overflow-x-auto">
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">{ko.gantt.noData}</p>
        ) : (
          <svg
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            role="img"
            aria-label={ko.gantt.title}
          >
            <defs>
              {/* 진행중 막대 사선 패턴 (Requirement 15.2) */}
              <pattern
                id={IN_PROGRESS_PATTERN_ID}
                patternUnits="userSpaceOnUse"
                width={6}
                height={6}
                patternTransform="rotate(45)"
              >
                <rect width={6} height={6} fill="transparent" />
                <line x1={0} y1={0} x2={0} y2={6} stroke="#ffffff" strokeWidth={2} opacity={0.5} />
              </pattern>
            </defs>

            {/* Y축: 리포트명 + 행 구분선 */}
            <GanttYAxis rows={rows} plotWidth={plotWidth} onExcludeReport={onExcludeReport} />

            {/* X축: 시간 라벨 + 1시간 그리드 */}
            <GanttXAxis
              fromMs={fromMs}
              toMs={toMs}
              plotWidth={plotWidth}
              plotAreaHeight={areaHeight}
            />

            {/* 막대들 (plot 영역으로 평행이동) */}
            <g transform={`translate(${LABEL_WIDTH}, ${AXIS_HEIGHT})`}>
              {bars.map(({ rowIndex, run, geometry }) => (
                <GanttBar
                  key={`${run.reportId ?? "?"}-${run.requestId ?? `${rowIndex}-${run.startTimeLocal}`}`}
                  run={run}
                  geometry={geometry}
                  rowIndex={rowIndex}
                  onHover={handleHover}
                  onLeave={handleLeave}
                />
              ))}
            </g>

            {/* 현재 시각 세로선 (Requirement 15.5) */}
            <NowLine
              nowMs={nowMs}
              fromMs={fromMs}
              toMs={toMs}
              plotWidth={plotWidth}
              plotAreaHeight={areaHeight}
            />
          </svg>
        )}
      </div>

      {tooltip && <GanttTooltip state={tooltip} />}
    </section>
  );
}
