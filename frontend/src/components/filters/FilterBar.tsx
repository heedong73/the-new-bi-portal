/**
 * 필터 바 — 단일 일자 선택 모델 (Requirements 13.1, 13.3).
 *
 * 며칠 범위를 한 번에 보면 간트/차트 가시성이 떨어져, 조회 단위를 "하루"로 고정한다.
 * 날짜를 고르면 해당 일자(00:00~23:59)를 store의 [from,to]로 설정하며, 상위 화면의
 * 조회 쿼리는 store 값을 실시간으로 읽어 자동 반영한다(별도 "조회" 버튼 불필요).
 *
 *  - 날짜: 단일 date 입력. 값은 store.from(선택 일자)에서 표시.
 *  - Report/Dataset 옵션은 useReports/useDatasets(TanStack Query)에서 채운다.
 *  - 상태: ko.status 라벨(전체/성공/실패/진행중/알 수 없음).
 *
 * date 입력은 로컬 벽시계 날짜(`YYYY-MM-DD`)를 다루므로 브라우저 로컬(KST) 기준
 * startOfDay/endOfDay로 하루 경계를 만든다.
 */
import { startOfDay, endOfDay } from "date-fns";
import ko from "@/i18n/ko";
import { useReports, useDatasets } from "@/api/hooks";
import {
  useRefreshFilterStore,
  type RefreshFilterStatus,
} from "@/stores/useRefreshFilterStore";

/** 상태 드롭다운 옵션 순서 (Requirement 13.3) */
const STATUS_OPTIONS: RefreshFilterStatus[] = [
  "all",
  "success",
  "failed",
  "in_progress",
  "unknown",
];

/** Date → date input 값(`YYYY-MM-DD`)으로 변환 (로컬 벽시계 기준) */
function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** date input 값(`YYYY-MM-DD`) → 로컬 자정 Date. 비정상 입력이면 null */
function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const selectClass =
  "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 " +
  "focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300";

const fieldLabelClass = "text-xs font-medium text-slate-500";

export default function FilterBar() {
  const from = useRefreshFilterStore((s) => s.from);
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
  const reports = reportsQuery.data ?? [];
  const datasets = datasetsQuery.data ?? [];

  const handleDateChange = (value: string) => {
    const day = fromDateInputValue(value);
    if (day) setRange(startOfDay(day), endOfDay(day));
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      {/* 조회 일자 (단일) */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-date" className={fieldLabelClass}>
          조회 일자
        </label>
        <input
          id="filter-date"
          type="date"
          value={toDateInputValue(from)}
          onChange={(e) => handleDateChange(e.target.value)}
          className={selectClass}
        />
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
    </div>
  );
}
