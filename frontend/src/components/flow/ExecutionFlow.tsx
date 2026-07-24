/**
 * 우측 실행 흐름 패널 (Requirements 7.5, 16.1, 16.2).
 *
 * design.md "Frontend 디렉터리 구조(flow/ExecutionFlow.tsx)":
 *  - 오늘 실행된 Refresh_Run을 시작 시각 기준으로 정렬하여 시간순 표시 (R16.1)
 *  - 운영 모니터링 특성상 최신 항목이 위로 오도록 내림차순 정렬
 *  - 각 항목: 상태 아이콘 + 리포트명 + 시작 시각(HH:mm:ss) + 소요 시간(formatDuration)
 *  - 실패 항목은 errorMessage 앞 100자를 잘라 표시 (R16.2)
 *  - 진행중 항목은 스피너/펄스로 시각적 표시
 *  - 데이터 없으면 ko.flow.empty 표시
 *
 * 본 컴포넌트는 prop 기반 순수 컴포넌트이며, mock 주입(getMockRefreshHistory)은
 * 상위 페이지(task 1.14)에서 수행한다. 시각은 Backend가 준 local 값을 추가 변환
 * 없이 표시한다 (R7.5 — utils/date.formatLocalTime).
 */
import { memo, useMemo } from "react";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import ko from "@/i18n/ko";
import type { RefreshRunOut, RefreshStatus } from "@/types/refresh";
import { STATUS_COLORS } from "@/components/gantt/ganttGeometry";
import { compareIsoAsc, formatLocalTime } from "@/utils/date";
import { formatDuration } from "@/utils/duration";

/** 실패 항목의 errorMessage 표시 최대 길이 (Requirement 16.2) */
const ERROR_PREVIEW_MAX = 100;

/** 상태별 lucide 아이콘 매핑 */
const STATUS_ICON: Record<RefreshStatus, LucideIcon> = {
  success: CheckCircle2,
  failed: AlertCircle,
  in_progress: Loader2,
  unknown: HelpCircle,
};

export interface ExecutionFlowProps {
  /** 오늘 실행된 Refresh_Run 목록 (상위 페이지에서 주입) */
  runs: RefreshRunOut[];
}

/**
 * errorMessage를 앞 100자로 자르고, 잘린 경우 말줄임표를 덧붙인다 (R16.2).
 */
function truncateError(message: string): string {
  if (message.length <= ERROR_PREVIEW_MAX) return message;
  return `${message.slice(0, ERROR_PREVIEW_MAX)}…`;
}

/** 진행중 항목의 동적 소요 시간(초). start~now 차이. */
function inProgressSeconds(run: RefreshRunOut): number {
  if (!run.startTimeUtc) return 0;
  const start = Date.parse(run.startTimeUtc);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

function FlowItem({ run }: { run: RefreshRunOut }) {
  const Icon = STATUS_ICON[run.status];
  const color = STATUS_COLORS[run.status];
  const isInProgress = run.status === "in_progress";

  const durationSeconds = isInProgress
    ? inProgressSeconds(run)
    : run.durationSeconds ?? 0;

  return (
    <li className="flex gap-2.5 px-3 py-2.5 hover:bg-slate-50">
      {/* 상태 아이콘: 진행중은 스핀, 그 외 정적 */}
      <span className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true">
        <Icon size={16} className={isInProgress ? "animate-spin" : undefined} />
      </span>

      <div className="min-w-0 flex-1">
        {/* 1행: 리포트명 + 시작 시각 */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-800">
            {run.reportName || run.datasetName || "-"}
          </span>
          <span className="shrink-0 font-mono text-xs text-slate-400">
            {formatLocalTime(run.startTimeLocal)}
          </span>
        </div>

        {/* 2행: 상태 라벨 + 소요 시간 */}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span style={{ color }}>{ko.status[run.status]}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDuration(durationSeconds)}</span>
        </div>

        {/* 실패 시 errorMessage 앞 100자 (Requirement 16.2) */}
        {run.status === "failed" && run.errorMessage && (
          <p className="mt-1 break-words text-xs leading-snug text-red-600">
            {truncateError(run.errorMessage)}
          </p>
        )}
      </div>
    </li>
  );
}

function ExecutionFlowImpl({ runs }: ExecutionFlowProps) {
  /**
   * 시작 시각(startTimeLocal) 기준 정렬 (Requirement 16.1).
   * 최신이 위로 오도록 내림차순. 동일 시각이면 requestId로 안정 정렬 보조.
   */
  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const cmp = compareIsoAsc(b.startTimeLocal, a.startTimeLocal); // 내림차순
      if (cmp !== 0) return cmp;
      return (a.requestId ?? "").localeCompare(b.requestId ?? "");
    });
  }, [runs]);

  return (
    <section
      className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white"
      aria-label={ko.flow.title}
    >
      <header className="border-b border-slate-100 px-3 py-2.5">
        <h2 className="text-sm font-bold text-slate-700">{ko.flow.title}</h2>
      </header>

      {sortedRuns.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">
          {ko.flow.empty}
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {sortedRuns.map((run) => (
            <FlowItem
              key={`${run.requestId ?? "na"}-${run.reportId ?? "na"}`}
              run={run}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 항목 수가 많을 수 있어 memo로 불필요한 리렌더를 방지한다. */
const ExecutionFlow = memo(ExecutionFlowImpl);
export default ExecutionFlow;
