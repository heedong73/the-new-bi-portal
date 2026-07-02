/**
 * "가장 오래 걸린 리포트 TOP 5" 카드 (Requirements 17.1, 17.2).
 *
 * 하단 분석 영역의 독립 카드로, 표시 중(선택 일자 + 제외 반영) Refresh_Run 목록에서
 * 소요 시간이 큰 순으로 상위 5건을 나열한다. 각 행은 리포트명 · 시작 시간 · 소요 시간을
 * 보여준다. 데이터 소스는 상위 페이지에서 runs prop으로 주입한다.
 *
 * 집계 방식:
 *  - durationSeconds가 null(진행중 등)인 run은 제외한다.
 *  - 소요 시간 내림차순 정렬 후 상위 5건만 취한다.
 *  - 완료 run이 하나도 없으면 graceful 안내 문구를 보여준다.
 */
import { useMemo } from "react";
import { Timer } from "lucide-react";
import ko from "@/i18n/ko";
import { formatDuration } from "@/utils/duration";
import { formatLocalTime } from "@/utils/date";
import type { RefreshRunOut } from "@/types/refresh";

export interface LongestRunCardProps {
  /** Report 단위로 펼쳐진 refresh 목록. 상위 페이지에서 주입한다. */
  runs: RefreshRunOut[];
  /** 표시할 상위 건수. 기본 5 */
  topN?: number;
}

export default function LongestRunCard({ runs, topN = 5 }: LongestRunCardProps) {
  const top = useMemo(
    () =>
      runs
        .filter((r) => r.durationSeconds != null)
        .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))
        .slice(0, topN),
    [runs, topN]
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Timer className="text-indigo-500" size={16} aria-hidden="true" />
        {ko.charts.longestRunTop}
      </h3>
      {top.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
          {ko.common.noData}
        </p>
      ) : (
        <ol className="flex flex-1 flex-col divide-y divide-slate-100">
          {top.map((r, i) => (
            <li
              key={`${r.requestId ?? r.datasetId ?? r.reportName}-${i}`}
              className="flex items-center gap-3 py-2"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-medium text-slate-800"
                  title={r.reportName}
                >
                  {r.reportName}
                </p>
                <p className="text-xs text-slate-400">
                  시작 {formatLocalTime(r.startTimeLocal)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-indigo-600">
                {formatDuration(r.durationSeconds ?? 0)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
