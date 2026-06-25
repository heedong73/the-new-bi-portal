/**
 * 필터 바 (Requirements 13.1, 13.3, 13.4).
 *
 * 기간(시작일시/종료일시), Workspace, Report, Dataset, 상태 드롭다운과
 * 조회 버튼을 렌더한다. 값은 `useRefreshFilterStore`(Zustand)에 보관한다.
 *
 *  - Report/Dataset 옵션은 `useReports`/`useDatasets`(TanStack Query) 훅에서 채운다.
 *    (단계 7 실연동 — 데이터 로딩 전/실패 시 빈 옵션으로 graceful 처리)
 *  - 상태 옵션은 ko.status 라벨을 사용한다 (전체/성공/실패/진행중/알 수 없음).
 *  - 조회 버튼 클릭 시 store는 이미 최신 값이므로 onSearch 콜백만 호출하여
 *    상위(페이지)가 실제 API 재조회를 트리거하게 한다.
 *
 * datetime-local input은 로컬 벽시계 문자열(`YYYY-MM-DDTHH:mm`)을 다루므로,
 * Date ↔ 문자열 변환 헬퍼를 둔다. 단계 1(mock)에서는 브라우저 로컬 타임존을
 * 그대로 사용한다(과도한 KST 오프셋 처리는 하지 않음).
 */
import { useMemo } from "react";
import ko from "@/i18n/ko";
import { useReports, useDatasets } from "@/api/hooks";
import {
  useRefreshFilterStore,
  type RefreshFilterStatus,
} from "@/stores/useRefreshFilterStore";

export interface FilterBarProps {
  /**
   * 조회 버튼 클릭 콜백. store 값은 이미 최신이므로 추가 인자 없이 호출한다.
   * 상위 페이지가 이 콜백에서 API 재조회를 트리거한다 (task 1.14 / 7.x).
   */
  onSearch?: () => void;
}

/** 상태 드롭다운 옵션 순서 (Requirement 13.3) */
const STATUS_OPTIONS: RefreshFilterStatus[] = [
  "all",
  "success",
  "failed",
  "in_progress",
  "unknown",
];

/** Date → datetime-local input 값(`YYYY-MM-DDTHH:mm`)으로 변환 (로컬 벽시계 기준) */
function toDateTimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** datetime-local input 값 → Date. 비정상 입력이면 null 반환 */
function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const selectClass =
  "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 " +
  "focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300";

const fieldLabelClass = "text-xs font-medium text-slate-500";

export default function FilterBar({ onSearch }: FilterBarProps) {
  const from = useRefreshFilterStore((s) => s.from);
  const to = useRefreshFilterStore((s) => s.to);
  const reportId = useRefreshFilterStore((s) => s.reportId);
  const datasetId = useRefreshFilterStore((s) => s.datasetId);
  const status = useRefreshFilterStore((s) => s.status);
  const setRange = useRefreshFilterStore((s) => s.setRange);
  const setReportId = useRefreshFilterStore((s) => s.setReportId);
  const setDatasetId = useRefreshFilterStore((s) => s.setDatasetId);
  const setStatus = useRefreshFilterStore((s) => s.setStatus);

  // Report/Dataset 옵션 (TanStack Query). 로딩 전/실패 시 빈 배열로 graceful 처리.
  const reportsQuery = useReports();
  const datasetsQuery = useDatasets();
  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);

  const handleFromChange = (value: string) => {
    const next = fromDateTimeLocalValue(value);
    if (next) setRange(next, to);
  };

  const handleToChange = (value: string) => {
    const next = fromDateTimeLocalValue(value);
    if (next) setRange(from, next);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-6 py-3">
      {/* 기간: 시작일시 */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-from" className={fieldLabelClass}>
          {ko.filter.from}
        </label>
        <input
          id="filter-from"
          type="datetime-local"
          value={toDateTimeLocalValue(from)}
          onChange={(e) => handleFromChange(e.target.value)}
          className={selectClass}
        />
      </div>

      {/* 기간: 종료일시 */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-to" className={fieldLabelClass}>
          {ko.filter.to}
        </label>
        <input
          id="filter-to"
          type="datetime-local"
          value={toDateTimeLocalValue(to)}
          onChange={(e) => handleToChange(e.target.value)}
          className={selectClass}
        />
      </div>

      {/* Workspace (단계 1에서는 단일 Workspace 가정 → 전체 옵션만 노출) */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-workspace" className={fieldLabelClass}>
          {ko.filter.workspace}
        </label>
        <select
          id="filter-workspace"
          className={selectClass}
          value=""
          disabled
        >
          <option value="">{ko.filter.all}</option>
        </select>
      </div>

      {/* Report */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-report" className={fieldLabelClass}>
          {ko.filter.report}
        </label>
        <select
          id="filter-report"
          className={selectClass}
          value={reportId ?? ""}
          onChange={(e) => setReportId(e.target.value || null)}
        >
          <option value="">{ko.filter.all}</option>
          {reports.map((r) => (
            <option key={r.reportId} value={r.reportId}>
              {r.reportName}
            </option>
          ))}
        </select>
      </div>

      {/* Dataset */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-dataset" className={fieldLabelClass}>
          {ko.filter.dataset}
        </label>
        <select
          id="filter-dataset"
          className={selectClass}
          value={datasetId ?? ""}
          onChange={(e) => setDatasetId(e.target.value || null)}
        >
          <option value="">{ko.filter.all}</option>
          {datasets.map((d) => (
            <option key={d.datasetId} value={d.datasetId}>
              {d.datasetName}
            </option>
          ))}
        </select>
      </div>

      {/* 상태 (Requirement 13.3) */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className={fieldLabelClass}>
          {ko.filter.status}
        </label>
        <select
          id="filter-status"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as RefreshFilterStatus)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {ko.status[s]}
            </option>
          ))}
        </select>
      </div>

      {/* 조회 버튼 (Requirement 13.2 — 실제 호출 연결은 task 1.14/7.x) */}
      <button
        type="button"
        onClick={() => onSearch?.()}
        className="h-9 rounded-md bg-slate-800 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
      >
        {ko.filter.search}
      </button>
    </div>
  );
}
