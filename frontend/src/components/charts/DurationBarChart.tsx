/**
 * 리포트별 소요 시간 bar chart (Requirements 17.1, 17.2).
 *
 * `GET /api/refresh-timetable` 응답(`RefreshRunOut[]`)을 prop으로 받아 리포트별
 * 평균 소요 시간을 집계하여 Recharts `BarChart`로 렌더하는 순수 컴포넌트다.
 * 데이터 소스(mock fixture / 단계 7의 useRefreshTimetable 훅)는 상위 페이지
 * (task 1.14)에서 주입하며, 이 컴포넌트는 어떤 모드인지 알 필요가 없다.
 *
 * 집계 방식:
 *  - 리포트명(reportName)별로 그룹핑한다.
 *  - durationSeconds가 null(진행중)인 run은 평균 계산에서 제외한다. 진행중은
 *    아직 소요 시간이 확정되지 않았으므로 0 처리 대신 표본에서 빼는 것이 평균을
 *    왜곡하지 않는다(주석으로 의도 명시).
 *  - 완료 run이 하나도 없는 리포트는 차트에서 제외한다.
 *  - 평균이 큰 순으로 정렬하여 병목 리포트를 상단에 노출한다.
 *
 * 색상은 단일 톤(emerald-500)으로 일관되게 적용한다. 막대별 상태 색상 구분은
 * Gantt/Donut가 담당하므로 여기서는 "처리량 비교"에 집중한다.
 */
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ko from "@/i18n/ko";
import { formatDuration } from "@/utils/duration";
import { STATUS_COLORS } from "@/components/gantt/ganttGeometry";
import type { RefreshRunOut } from "@/types/refresh";

export interface DurationBarChartProps {
  /** Report 단위로 펼쳐진 refresh 목록. 상위 페이지에서 주입한다. */
  runs: RefreshRunOut[];
  /** 차트 높이(px). 기본 240 */
  height?: number;
}

/** 차트에 넘길 집계 데이터 1행 */
interface DurationDatum {
  reportName: string;
  /** 평균 소요 시간(초) */
  averageSeconds: number;
}

/** 막대 색상 — success 톤(emerald)으로 일관 적용 */
const BAR_COLOR = STATUS_COLORS.success;

/**
 * 리포트별 평균 소요 시간을 집계한다.
 * durationSeconds가 null(진행중)인 항목은 표본에서 제외한다.
 */
function aggregateByReport(runs: RefreshRunOut[]): DurationDatum[] {
  const sumByName = new Map<string, { sum: number; count: number }>();

  for (const run of runs) {
    // 진행중 등 소요 시간 미확정 run은 평균 왜곡 방지를 위해 제외
    if (run.durationSeconds == null) continue;
    const key = run.reportName && run.reportName.length > 0 ? run.reportName : "(이름 없음)";
    const acc = sumByName.get(key) ?? { sum: 0, count: 0 };
    acc.sum += run.durationSeconds;
    acc.count += 1;
    sumByName.set(key, acc);
  }

  const data: DurationDatum[] = [];
  for (const [reportName, { sum, count }] of sumByName) {
    data.push({ reportName, averageSeconds: Math.round(sum / count) });
  }
  // 평균이 큰 순으로 정렬 (병목 리포트 우선 노출)
  data.sort((a, b) => b.averageSeconds - a.averageSeconds);
  return data;
}

/** Y축/툴팁에 소요 시간을 사람이 읽는 형식으로 표시 */
function tickFormatter(value: number): string {
  return formatDuration(value);
}

export default function DurationBarChart({ runs, height = 240 }: DurationBarChartProps) {
  const data = useMemo(() => aggregateByReport(runs), [runs]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        {ko.charts.durationByReport}
      </h3>
      {data.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
          {ko.common.noData}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={tickFormatter}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <YAxis
              type="category"
              dataKey="reportName"
              width={120}
              tick={{ fontSize: 11, fill: "#475569" }}
            />
            <Tooltip
              formatter={(value) => [formatDuration(Number(value)), ko.table.duration]}
              labelFormatter={(label) => String(label)}
            />
            <Bar
              dataKey="averageSeconds"
              name={ko.table.duration}
              fill={BAR_COLOR}
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
