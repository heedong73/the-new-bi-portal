/**
 * 시간대별 refresh 건수 line chart — 30분 단위 (Requirements 17.1, 17.2).
 *
 * 표시 중(선택 일자 + 제외 반영) Refresh_Run 목록을 prop으로 받아 시작 시각(local)의
 * 30분 버킷(00:00, 00:30, … 23:30 — 48개)별로 건수를 집계하여 Recharts `LineChart`로
 * 렌더한다. 하루를 30분 단위로 상세히 보기 위해 X축을 넓게(가로 스크롤) 표시한다.
 *
 * 집계 방식:
 *  - startTimeLocal ISO 문자열에서 `HH:mm`을 추출해 30분 버킷 인덱스(0~47)에 매핑한다.
 *    타임존 재변환 없이 Backend가 보낸 local 벽시계 시각을 그대로 사용한다(R7.5).
 *  - 0:00~23:30 48개 버킷을 항상 생성해 추이가 끊겨 보이지 않게 한다.
 *  - 총 건수 라인 + 실패 건수 라인 2개만 표시한다.
 */
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ko from "@/i18n/ko";
import { STATUS_COLORS } from "@/components/gantt/ganttGeometry";
import type { RefreshRunOut } from "@/types/refresh";
import { BUCKETS, bucketLabel, extractBucket, labelToBucket } from "./hourlyBuckets";

export interface HourlyTrendChartProps {
  /** Report 단위로 펼쳐진 refresh 목록. 상위 페이지에서 주입한다. */
  runs: RefreshRunOut[];
  /** 차트 높이(px). 기본 280 */
  height?: number;
  /** 현재 선택된 30분 버킷 인덱스(0~47). null이면 미선택. */
  selectedBucket?: number | null;
  /**
   * 버킷 클릭 시 호출. 같은 버킷을 다시 클릭하면 null(해제)로 전달한다.
   * 지정하지 않으면 차트는 클릭 불가(기존 동작 유지).
   */
  onSelectBucket?: (bucket: number | null) => void;
}

/** 30분 버킷 집계 1행 */
interface BucketDatum {
  /** 표시용 라벨 (예: "09:00", "09:30") */
  label: string;
  /** 해당 버킷 전체 건수 */
  total: number;
  /** 해당 버킷 실패 건수 */
  failed: number;
}

const TOTAL_LINE_COLOR = "#6366f1"; // indigo-500
const FAILED_LINE_COLOR = STATUS_COLORS.failed;

const TOTAL_KEY = "건수";
const FAILED_KEY = ko.status.failed;

/** 시작 시각(local)의 30분 버킷별로 총/실패 건수를 집계한다 (48개 버킷). */
function aggregateByHalfHour(runs: RefreshRunOut[]): BucketDatum[] {
  const totals = new Array<number>(BUCKETS).fill(0);
  const fails = new Array<number>(BUCKETS).fill(0);

  for (const run of runs) {
    const b = extractBucket(run.startTimeLocal);
    if (b == null) continue; // 시작 시각 없는 run은 제외
    totals[b] += 1;
    if (run.status === "failed") fails[b] += 1;
  }

  return totals.map((total, idx) => ({
    label: bucketLabel(idx),
    total,
    failed: fails[idx],
  }));
}

export default function HourlyTrendChart({
  runs,
  height = 280,
  selectedBucket = null,
  onSelectBucket,
}: HourlyTrendChartProps) {
  const data = useMemo(() => aggregateByHalfHour(runs), [runs]);
  const hasAny = useMemo(() => data.some((d) => d.total > 0), [data]);

  const clickable = typeof onSelectBucket === "function";

  /** 차트 클릭 → 활성 x라벨을 버킷으로 역산. 같은 버킷 재클릭은 해제(null). */
  const handleChartClick = (state: { activeLabel?: string | number } | null) => {
    if (!onSelectBucket) return;
    const bucket = labelToBucket(state?.activeLabel);
    if (bucket == null) return;
    onSelectBucket(bucket === selectedBucket ? null : bucket);
  };

  const selectedLabel =
    selectedBucket != null ? bucketLabel(selectedBucket) : null;

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
        {ko.charts.hourlyTrend}{" "}
        <span className="text-xs font-normal text-slate-400">(30분 단위)</span>
        {clickable && hasAny && (
          <span className="ml-auto text-xs font-normal text-slate-400">
            시간대를 클릭하면 아래 표가 해당 시간대로 필터링됩니다
          </span>
        )}
      </h3>
      {!hasAny ? (
        <p className="flex h-40 items-center justify-center text-sm text-slate-400">
          {ko.common.noData}
        </p>
      ) : (
        // 30분 단위 48개 버킷을 넉넉히 보여주기 위해 가로로 넓히고, 좁은 화면에선 스크롤한다.
        <div className="overflow-x-auto">
          <div style={{ minWidth: 1440 }}>
            <ResponsiveContainer width="100%" height={height}>
              <LineChart
                data={data}
                margin={{ top: 4, right: 16, bottom: 28, left: -8 }}
                onClick={clickable ? handleChartClick : undefined}
                style={clickable ? { cursor: "pointer" } : undefined}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  height={44}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {selectedLabel != null && (
                  <ReferenceLine
                    x={selectedLabel}
                    stroke={TOTAL_LINE_COLOR}
                    strokeWidth={2}
                    strokeOpacity={0.7}
                    ifOverflow="extendDomain"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="total"
                  name={TOTAL_KEY}
                  stroke={TOTAL_LINE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="failed"
                  name={FAILED_KEY}
                  stroke={FAILED_LINE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
