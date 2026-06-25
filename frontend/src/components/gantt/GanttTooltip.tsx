/**
 * Gantt 막대 hover tooltip (Requirement 15.4).
 *
 * design.md "Refresh Timeline(Gantt) 컴포넌트 설계 결정":
 *  - hover 시 절대 배치 `<div role="tooltip">`로 표시.
 *  - 내용: 리포트명, 데이터셋명, 시작 시각(local), 종료 시각(local), 소요 시간,
 *    상태, requestId, (실패 시) errorMessage.
 *
 * 시각은 Backend가 준 local ISO 문자열을 추가 변환 없이 보기 좋게 표시한다
 * (Requirement 7.5). 진행중(in_progress)은 종료 시각이 없으므로 "진행중"으로 표기하고
 * 소요 시간은 컨테이너가 계산한 동적값(displayDurationSeconds)을 사용한다.
 */
import ko from "@/i18n/ko";
import type { RefreshRunOut } from "@/types/refresh";
import { formatDuration } from "@/utils/duration";

export interface TooltipState {
  run: RefreshRunOut;
  /** 막대가 계산한 동적 소요 시간(초) — 진행중 연장 반영 */
  displayDurationSeconds: number;
  /** 뷰포트 기준 좌표(px) */
  clientX: number;
  clientY: number;
}

export interface GanttTooltipProps {
  state: TooltipState;
}

/**
 * local ISO 문자열(`...+09:00`)을 `YYYY-MM-DD HH:mm:ss`로 표시한다.
 * ISO 문자열의 벽시계 부분만 추출하므로 곧 KST(Asia/Seoul) 벽시계 시각이며,
 * Gantt X축 라벨/tick(formatKstHourMinute)과 동일한 KST 기준으로 정렬된다.
 */
function formatLocal(iso: string | null): string {
  if (!iso) return "-";
  // ISO의 날짜/시각 부분만 취해 표시 (오프셋/Z 제거). 추가 타임존 변환 없음.
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return iso;
}

export default function GanttTooltip({ state }: GanttTooltipProps) {
  const { run, displayDurationSeconds, clientX, clientY } = state;

  // 커서 우측 하단에 약간 띄워 배치. 화면 끝 넘침은 transform으로 살짝 보정.
  const style: React.CSSProperties = {
    position: "fixed",
    left: clientX + 12,
    top: clientY + 12,
    zIndex: 50,
    maxWidth: 320,
    pointerEvents: "none",
  };

  return (
    <div
      role="tooltip"
      style={style}
      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
    >
      <div className="mb-1 font-semibold text-slate-800">{run.reportName || "-"}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600">
        <dt className="text-slate-400">{ko.table.datasetName}</dt>
        <dd className="text-slate-700">{run.datasetName}</dd>

        <dt className="text-slate-400">{ko.table.status}</dt>
        <dd className="text-slate-700">{ko.status[run.status]}</dd>

        <dt className="text-slate-400">{ko.table.startTime}</dt>
        <dd className="text-slate-700">{formatLocal(run.startTimeLocal)}</dd>

        <dt className="text-slate-400">{ko.table.endTime}</dt>
        <dd className="text-slate-700">
          {run.status === "in_progress" || !run.endTimeLocal
            ? ko.status.in_progress
            : formatLocal(run.endTimeLocal)}
        </dd>

        <dt className="text-slate-400">{ko.table.duration}</dt>
        <dd className="text-slate-700">{formatDuration(displayDurationSeconds)}</dd>

        <dt className="text-slate-400">{ko.table.requestId}</dt>
        <dd className="break-all text-slate-700">{run.requestId ?? "-"}</dd>
      </dl>

      {/* 실패 시에만 오류 메시지 표시 (Requirement 15.4) */}
      {run.status === "failed" && run.errorMessage && (
        <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-red-600">
          {run.errorMessage}
        </div>
      )}
    </div>
  );
}
