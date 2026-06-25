/**
 * 성공/실패(및 진행중/알 수 없음) 비율 donut chart (Requirements 17.1, 17.2).
 *
 * `GET /api/summary` 응답(`SummaryOut`)을 prop으로 받아 상태별 비율을 Recharts
 * `PieChart`(innerRadius 적용 donut)로 렌더하는 순수 컴포넌트다. 데이터 소스는
 * 상위 페이지(task 1.14)에서 주입한다.
 *
 * 집계 방식:
 *  - SummaryOut의 success/failed/inProgress 건수를 직접 사용한다.
 *  - "알 수 없음" 건수는 SummaryOut에 별도 필드가 없으므로
 *    total - (success + failed + inProgress)로 도출한다(음수 방지 clamp).
 *  - 건수가 0인 상태는 조각에서 제외하여 범례가 깔끔하게 유지된다.
 *
 * 색상은 Gantt와 동일한 STATUS_COLORS를 재사용하여 화면 전체의 상태 색상
 * 일관성을 보장한다. 범례와 퍼센트 라벨을 함께 표시한다.
 */
import { useMemo } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import ko from "@/i18n/ko";
import { STATUS_COLORS } from "@/components/gantt/ganttGeometry";
import type { RefreshStatus, SummaryOut } from "@/types/refresh";

export interface StatusDonutChartProps {
  /** `GET /api/summary` 응답. 상위 페이지에서 주입한다. */
  summary: SummaryOut;
  /** 차트 높이(px). 기본 240 */
  height?: number;
}

/** donut 조각 1개 */
interface StatusDatum {
  status: RefreshStatus;
  label: string;
  value: number;
}

/**
 * SummaryOut을 상태별 조각으로 변환한다.
 * unknown 건수는 total에서 나머지를 빼서 도출하고 음수는 0으로 clamp한다.
 * 건수가 0인 상태는 제외한다.
 */
function toStatusData(summary: SummaryOut): StatusDatum[] {
  const unknown = Math.max(
    0,
    summary.total - summary.success - summary.failed - summary.inProgress
  );
  const all: StatusDatum[] = [
    { status: "success", label: ko.status.success, value: summary.success },
    { status: "failed", label: ko.status.failed, value: summary.failed },
    { status: "in_progress", label: ko.status.in_progress, value: summary.inProgress },
    { status: "unknown", label: ko.status.unknown, value: unknown },
  ];
  return all.filter((d) => d.value > 0);
}

/** 퍼센트 라벨 렌더 (조각 위에 "성공 70%" 형태) */
interface PieLabelArg {
  percent?: number;
  payload?: { label?: string };
}

function renderPercentLabel({ percent, payload }: PieLabelArg): string {
  const pct = Math.round((percent ?? 0) * 100);
  return `${payload?.label ?? ""} ${pct}%`;
}

export default function StatusDonutChart({ summary, height = 240 }: StatusDonutChartProps) {
  const data = useMemo(() => toStatusData(summary), [summary]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{ko.charts.statusRatio}</h3>
      {data.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
          {ko.common.noData}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="50%"
              outerRadius="75%"
              paddingAngle={2}
              label={renderPercentLabel}
              labelLine={false}
            >
              {data.map((d) => (
                <Cell key={d.status} fill={STATUS_COLORS[d.status]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value}건`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
