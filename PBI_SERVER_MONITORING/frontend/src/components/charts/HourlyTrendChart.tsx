/**
 * 시간대별 refresh 건수 line chart (Requirements 17.1, 17.2).
 *
 * `GET /api/refresh-timetable` 응답(`RefreshRunOut[]`)을 prop으로 받아 시작 시각
 * (local)의 시(hour)별로 건수를 집계하여 Recharts `LineChart`로 렌더하는 순수
 * 컴포넌트다. 데이터 소스는 상위 페이지(task 1.14)에서 주입한다.
 *
 * 집계 방식:
 *  - startTimeLocal ISO 문자열에서 시(`HH`) 부분을 추출하여 0~23시 버킷에 매핑한다.
 *    타임존 재변환 없이 Backend가 보낸 local 벽시계 시각을 그대로 사용한다
 *    (Requirement 7.5와 동일 원칙). startTimeLocal이 없는 run은 집계에서 제외한다.
 *  - 0~23시를 모두 포함하는 24개 버킷을 항상 생성하여 추이가 끊겨 보이지 않게 한다.
 *  - 총 건수 라인 + 실패 건수 라인 2개만 표시한다(과도한 멀티 라인 지양).
 */
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ko from "@/i18n/ko";
import { STATUS_COLORS } from "@/components/gantt/ganttGeometry";
import type { RefreshRunOut } from "@/types/refresh";

export interface HourlyTrendChartProps {
  /** Report 단위로 펼쳐진 refresh 목록. 상위 페이지에서 주입한다. */
  runs: RefreshRunOut[];
  /** 차트 높이(px). 기본 240 */
  height?: number;
}

/** 시간대별 집계 1행 */
interface HourlyDatum {
  /** 표시용 라벨 (예: "09시") */
  hourLabel: string;
  /** 해당 시간대 전체 건수 */
  total: number;
  /** 해당 시간대 실패 건수 */
  failed: number;
}

/** 라인 색상 (총 건수: indigo, 실패: STATUS_COLORS.failed로 일관) */
const TOTAL_LINE_COLOR = "#6366f1"; // indigo-500
const FAILED_LINE_COLOR = STATUS_COLORS.failed;

const TOTAL_KEY = "건수";
const FAILED_KEY = ko.status.failed;

/**
 * local ISO 문자열에서 시(0~23)를 추출한다. 형식 불일치/null이면 null.
 * 오프셋 재해석 없이 ISO 문자열의 `HH` 부분만 읽는다.
 */
function extractHour(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/[T ](\d{2}):/);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : null;
}

/** 시작 시각(local)의 시별로 총/실패 건수를 집계한다 (24개 버킷). */
function aggregateByHour(runs: RefreshRunOut[]): HourlyDatum[] {
  const totals = new Array<number>(24).fill(0);
  const fails = new Array<number>(24).fill(0);

  for (const run of runs) {
    const hour = extractHour(run.startTimeLocal);
    if (hour == null) continue; // 시작 시각 없는 run은 제외
    totals[hour] += 1;
    if (run.status === "failed") fails[hour] += 1;
  }

  return totals.map((total, hour) => ({
    hourLabel: `${String(hour).padStart(2, "0")}시`,
    total,
    failed: fails[hour],
  }));
}

export default function HourlyTrendChart({ runs, height = 240 }: HourlyTrendChartProps) {
  const data = useMemo(() => aggregateByHour(runs), [runs]);
  const hasAny = useMemo(() => data.some((d) => d.total > 0), [data]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{ko.charts.hourlyTrend}</h3>
      {!hasAny ? (
        <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
          {ko.common.noData}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="hourLabel"
              interval={2}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="total"
              name={TOTAL_KEY}
              stroke={TOTAL_LINE_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="failed"
              name={FAILED_KEY}
              stroke={FAILED_LINE_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
