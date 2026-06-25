/**
 * "가장 오래 걸린 리포트" 카드 (Requirements 17.1, 17.2).
 *
 * 하단 분석 영역의 독립 카드로, design.md/Requirement 17.1이 4개 시각화 중 하나로
 * 명시한다(KPI 카드에도 동일 지표가 있으나 분석 영역에서 강조 표시한다).
 *
 * `GET /api/summary` 응답(`SummaryOut`)을 prop으로 받아 longestRun 필드를 사용한다.
 * 데이터 소스는 상위 페이지(task 1.14)에서 주입한다.
 *
 * 표시 방식:
 *  - 리포트명 + 소요 시간(formatDuration)을 강조 표시한다.
 *  - longestRun이 null(완료 run 없음)이면 graceful 하게 "-"/안내 문구를 보여준다.
 *  - 소요 시간은 utils/duration.ts 의 formatDuration(초 → "H시간 m분"/"mm:ss")을 사용한다.
 */
import { Timer } from "lucide-react";
import ko from "@/i18n/ko";
import { formatDuration } from "@/utils/duration";
import type { SummaryOut } from "@/types/refresh";

export interface LongestRunCardProps {
  /** `GET /api/summary` 응답. 상위 페이지에서 주입한다. */
  summary: SummaryOut;
}

export default function LongestRunCard({ summary }: LongestRunCardProps) {
  const longest = summary.longestRun;

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{ko.charts.longestRun}</h3>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
          <Timer className="text-indigo-600" size={24} aria-hidden="true" />
        </div>
        {longest ? (
          <>
            <p
              className="max-w-full truncate text-base font-semibold text-slate-800"
              title={longest.reportName}
            >
              {longest.reportName}
            </p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">
              {formatDuration(longest.durationSeconds)}
            </p>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-slate-400">-</p>
            <p className="mt-1 text-sm text-slate-400">{ko.common.noData}</p>
          </>
        )}
      </div>
    </div>
  );
}
