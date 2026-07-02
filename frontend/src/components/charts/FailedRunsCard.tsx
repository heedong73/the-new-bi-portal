/**
 * "실패·경고 리포트" 카드 (Requirements 17.1, 17.2).
 *
 * 성공/실패 비율(도넛) 대신, 표시 중(선택 일자 + 제외 반영) Refresh_Run 중
 * 실패(failed) 또는 경고(unknown/Disabled 등 비정상)인 항목만 목록으로 보여준다.
 * 운영자가 "무엇이 잘못됐는지"를 바로 확인하도록 하는 것이 목적이다.
 *
 * 분류:
 *  - status === "failed" → 실패(빨강)
 *  - status === "unknown" → 경고(주황) (Power BI Disabled/모호 상태의 내부 정규화값)
 *  - 나머지(success/in_progress)는 제외.
 * 각 행은 상태 배지 · 리포트명 · 시작 시각 · 오류 메시지(있으면)를 보여준다.
 * 대상이 없으면 "실패·경고 없음"을 긍정적으로 안내한다.
 */
import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import ko from "@/i18n/ko";
import { formatLocalTime, compareIsoAsc } from "@/utils/date";
import type { RefreshRunOut } from "@/types/refresh";

export interface FailedRunsCardProps {
  /** Report 단위로 펼쳐진 refresh 목록. 상위 페이지에서 주입한다. */
  runs: RefreshRunOut[];
}

export default function FailedRunsCard({ runs }: FailedRunsCardProps) {
  // 실패/경고만 추출 후 시작 시각 내림차순(최근 먼저).
  const problems = useMemo(
    () =>
      runs
        .filter((r) => r.status === "failed" || r.status === "unknown")
        .sort((a, b) => compareIsoAsc(b.startTimeLocal, a.startTimeLocal)),
    [runs]
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <AlertTriangle className="text-amber-500" size={16} aria-hidden="true" />
        {ko.charts.failedRuns}
        {problems.length > 0 && (
          <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {problems.length}
          </span>
        )}
      </h3>
      {problems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <CheckCircle2 className="text-green-500" size={28} aria-hidden="true" />
          <p className="text-sm text-slate-400">실패·경고 없음</p>
        </div>
      ) : (
        <ul className="flex max-h-[240px] flex-1 flex-col divide-y divide-slate-100 overflow-y-auto">
          {problems.map((r, i) => {
            const isFailed = r.status === "failed";
            return (
              <li
                key={`${r.requestId ?? r.datasetId ?? r.reportName}-${i}`}
                className="flex items-start gap-2 py-2"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${
                    isFailed
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {isFailed ? ko.status.failed : "경고"}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium text-slate-800"
                    title={r.reportName}
                  >
                    {r.reportName}
                  </p>
                  <p
                    className="truncate text-xs text-slate-400"
                    title={r.errorMessage ?? undefined}
                  >
                    {formatLocalTime(r.startTimeLocal)}
                    {r.errorMessage ? ` · ${r.errorMessage}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
