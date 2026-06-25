/**
 * 상세 테이블 (Requirements 18.1 ~ 18.5).
 *
 * design.md "Frontend 디렉터리 구조(table/RefreshTable.tsx)" 및 Requirement 18:
 *   - 컬럼(R18.1): 순번 / 리포트명 / 데이터셋명 / Refresh Type / 상태 /
 *     예약 시각 / 시작 시각 / 종료 시각 / 소요 시간 / Request ID / 오류 메시지
 *   - 검색(R18.2): 리포트명 또는 데이터셋명 부분 일치 필터
 *   - 정렬(R18.3): 모든 컬럼 클릭 정렬, asc/desc 토글
 *   - 토글(R18.4): "실패만" / "진행중만"
 *   - CSV 내보내기(R18.5): 현재 화면에 표시된(필터/정렬 적용된) 행을 내보냄
 *
 * 본 컴포넌트는 prop으로 `runs`를 받는 순수 컴포넌트이며, 검색/정렬/토글은
 * 컴포넌트 로컬 상태(useState)로 관리한다. CSV 내보내기는 utils/csv.ts의
 * downloadCSV(현재 표시 행)를 사용한다.
 *
 * 페이지(task 1.14)가 헤더의 "내보내기" 버튼(Header.tsx)을 테이블 export와
 * 연결할 수 있도록, 표시 중인 행이 바뀔 때마다 `onVisibleRowsChange` 콜백으로
 * 현재 표시 행을 상위로 올린다. 페이지는 이 행을 보관했다가 헤더 onExport에서
 * downloadCSV를 호출하면 된다. (테이블 자체에도 독립 CSV 버튼을 둔다.)
 *
 * 시각은 Backend가 준 local 값을 추가 변환 없이 표시한다(R7.5, formatLocalDateTime).
 * 소요 시간은 formatDuration, 상태는 ko.status 라벨 + 상태별 색상 뱃지로 표시한다.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import ko from "@/i18n/ko";
import type { RefreshRunOut, RefreshStatus } from "@/types/refresh";
import { STATUS_COLORS } from "@/components/gantt/ganttGeometry";
import { compareIsoAsc, formatLocalDateTime } from "@/utils/date";
import { formatDuration } from "@/utils/duration";
import { downloadCSV } from "@/utils/csv";

/** 오류 메시지 셀의 표시 최대 길이 (초과 시 truncate + title) */
const ERROR_CELL_MAX = 80;

/** CSV 다운로드 기본 파일명 */
const CSV_FILENAME = "refresh-history.csv";

/**
 * 정렬 가능한 컬럼 키. 표시 컬럼과 1:1 대응한다.
 * `index`는 현재 정렬 순서를 기준으로 한 순번이므로 정렬 대상에서 제외한다.
 */
export type SortKey =
  | "reportName"
  | "datasetName"
  | "refreshType"
  | "status"
  | "scheduledTime"
  | "startTime"
  | "endTime"
  | "duration"
  | "requestId"
  | "errorMessage";

type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** 상태 정렬용 가중치 (실패 → 진행중 → 성공 → 알 수 없음 순) */
const STATUS_ORDER: Record<RefreshStatus, number> = {
  failed: 0,
  in_progress: 1,
  success: 2,
  unknown: 3,
};

export interface RefreshTableProps {
  /** 표시할 Refresh_Run 목록 (상위 페이지에서 주입) */
  runs: RefreshRunOut[];
  /**
   * 검색/정렬/토글 적용 후 현재 화면에 표시되는 행이 바뀔 때 호출된다.
   * 페이지가 헤더의 "내보내기" 버튼을 테이블 export와 연결할 때 사용한다.
   */
  onVisibleRowsChange?: (rows: RefreshRunOut[]) => void;
}

/** 진행중 행의 동적 소요 시간(초). start~now 차이. */
function inProgressSeconds(run: RefreshRunOut): number {
  if (!run.startTimeUtc) return 0;
  const start = Date.parse(run.startTimeUtc);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

/**
 * 표시용 소요 시간 문자열.
 * - 진행중(in_progress)이고 종료 시각이 없으면 start~now 동적 계산값을 표시
 * - durationSeconds가 숫자면 formatDuration
 * - 둘 다 불가하면 "-"
 */
function displayDuration(run: RefreshRunOut): string {
  if (run.status === "in_progress" && run.endTimeLocal == null) {
    return formatDuration(inProgressSeconds(run));
  }
  if (run.durationSeconds != null) {
    return formatDuration(run.durationSeconds);
  }
  return "-";
}

/** 정렬 비교에 사용할 소요 시간 수치(초). 진행중은 동적 계산. */
function durationForSort(run: RefreshRunOut): number {
  if (run.status === "in_progress" && run.endTimeLocal == null) {
    return inProgressSeconds(run);
  }
  return run.durationSeconds ?? -1;
}

/** 상태별 색상 뱃지 (성공/실패/진행중/알 수 없음) */
function StatusBadge({ status }: { status: RefreshStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `${color}1a` }} // 1a = ~10% alpha
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {ko.status[status]}
    </span>
  );
}

/** 컬럼 정의 (표시 순서 = 배열 순서) */
interface ColumnDef {
  key: SortKey;
  label: string;
  /** 숫자/시각 등 우측 정렬이 자연스러운 컬럼 */
  align?: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "reportName", label: ko.table.reportName },
  { key: "datasetName", label: ko.table.datasetName },
  { key: "refreshType", label: ko.table.refreshType },
  { key: "status", label: ko.table.status },
  { key: "scheduledTime", label: ko.table.scheduledTime },
  { key: "startTime", label: ko.table.startTime },
  { key: "endTime", label: ko.table.endTime },
  { key: "duration", label: ko.table.duration, align: "right" },
  { key: "requestId", label: ko.table.requestId },
  { key: "errorMessage", label: ko.table.errorMessage },
];

/** 두 run을 주어진 키로 비교 (asc 기준). */
function compareByKey(a: RefreshRunOut, b: RefreshRunOut, key: SortKey): number {
  switch (key) {
    case "reportName":
      return a.reportName.localeCompare(b.reportName);
    case "datasetName":
      return a.datasetName.localeCompare(b.datasetName);
    case "refreshType":
      return (a.refreshType ?? "").localeCompare(b.refreshType ?? "");
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "scheduledTime":
      return compareIsoAsc(a.scheduledTimeLocal, b.scheduledTimeLocal);
    case "startTime":
      return compareIsoAsc(a.startTimeLocal, b.startTimeLocal);
    case "endTime":
      return compareIsoAsc(a.endTimeLocal, b.endTimeLocal);
    case "duration":
      return durationForSort(a) - durationForSort(b);
    case "requestId":
      return (a.requestId ?? "").localeCompare(b.requestId ?? "");
    case "errorMessage":
      return (a.errorMessage ?? "").localeCompare(b.errorMessage ?? "");
    default:
      return 0;
  }
}

export default function RefreshTable({ runs, onVisibleRowsChange }: RefreshTableProps) {
  /** 검색어 (리포트명/데이터셋명 부분 일치) — R18.2 */
  const [query, setQuery] = useState("");
  /** 정렬 상태 — R18.3. 기본: 시작 시각 내림차순 */
  const [sort, setSort] = useState<SortState>({ key: "startTime", dir: "desc" });
  /** "실패만" 토글 — R18.4 */
  const [failedOnly, setFailedOnly] = useState(false);
  /** "진행중만" 토글 — R18.4 */
  const [inProgressOnly, setInProgressOnly] = useState(false);

  /**
   * 검색 → 토글 필터 → 정렬 순으로 현재 표시 행을 도출한다.
   * 이 결과가 CSV 내보내기 대상(R18.5)이자 onVisibleRowsChange로 상위에 전달된다.
   */
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();

    let result = runs.filter((r) => {
      // 검색: 리포트명 또는 데이터셋명 부분 일치 (R18.2)
      if (q) {
        const inReport = r.reportName.toLowerCase().includes(q);
        const inDataset = r.datasetName.toLowerCase().includes(q);
        if (!inReport && !inDataset) return false;
      }
      // 토글: 실패만 / 진행중만 (R18.4)
      if (failedOnly && r.status !== "failed") return false;
      if (inProgressOnly && r.status !== "in_progress") return false;
      return true;
    });

    // 정렬 (R18.3). 안정성을 위해 동률은 requestId로 보조 정렬.
    const factor = sort.dir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      const cmp = compareByKey(a, b, sort.key);
      if (cmp !== 0) return cmp * factor;
      return (a.requestId ?? "").localeCompare(b.requestId ?? "");
    });

    return result;
  }, [runs, query, failedOnly, inProgressOnly, sort]);

  /** 표시 행이 바뀌면 상위(페이지)로 전달 → 헤더 내보내기 버튼 연결용 */
  useEffect(() => {
    onVisibleRowsChange?.(visibleRows);
  }, [visibleRows, onVisibleRowsChange]);

  /** 컬럼 헤더 클릭: 같은 컬럼이면 asc/desc 토글, 다른 컬럼이면 asc로 시작 */
  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  /** 현재 표시 행을 UTF-8 BOM 포함 CSV로 다운로드 (R18.5) */
  function handleExport() {
    downloadCSV(visibleRows, CSV_FILENAME);
  }

  return (
    <section
      className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white"
      aria-label={ko.pages.refreshDetail}
    >
      {/* 툴바: 검색 / 토글 / 내보내기 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ko.table.searchPlaceholder}
          className="min-w-[14rem] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300"
          aria-label={ko.table.searchPlaceholder}
        />

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={failedOnly}
            onChange={(e) => setFailedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-400"
          />
          {ko.table.failedOnly}
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={inProgressOnly}
            onChange={(e) => setInProgressOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
          />
          {ko.table.inProgressOnly}
        </label>

        <button
          type="button"
          onClick={handleExport}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Download size={16} aria-hidden="true" />
          {ko.table.exportCsv}
        </button>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
              {/* 순번: 정렬 대상 아님 (R18.1) */}
              <th className="whitespace-nowrap px-3 py-2 text-right">
                {ko.table.index}
              </th>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                const SortIcon = !active
                  ? ChevronsUpDown
                  : sort.dir === "asc"
                    ? ArrowUp
                    : ArrowDown;
                return (
                  <th
                    key={col.key}
                    className={
                      "whitespace-nowrap px-3 py-2 " +
                      (col.align === "right" ? "text-right" : "text-left")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className={
                        "inline-flex items-center gap-1 hover:text-slate-700 " +
                        (active ? "text-indigo-600" : "")
                      }
                      aria-label={`${col.label} 정렬`}
                    >
                      {col.label}
                      <SortIcon size={13} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="px-3 py-8 text-center text-sm text-slate-400"
                >
                  {ko.common.noData}
                </td>
              </tr>
            ) : (
              visibleRows.map((run, i) => (
                <tr
                  key={`${run.requestId ?? "na"}-${run.reportId ?? "na"}-${i}`}
                  className="border-b border-slate-100 text-slate-700 hover:bg-slate-50"
                >
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block max-w-[16rem] truncate" title={run.reportName}>
                      {run.reportName || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block max-w-[14rem] truncate" title={run.datasetName}>
                      {run.datasetName || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {run.refreshType ?? "-"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">
                    {formatLocalDateTime(run.scheduledTimeLocal ?? null)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">
                    {formatLocalDateTime(run.startTimeLocal)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">
                    {formatLocalDateTime(run.endTimeLocal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {displayDuration(run)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-400">
                    <span className="block max-w-[12rem] truncate" title={run.requestId ?? ""}>
                      {run.requestId ?? "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {run.errorMessage ? (
                      <span
                        className="block max-w-[20rem] truncate text-red-600"
                        title={run.errorMessage}
                      >
                        {run.errorMessage.length > ERROR_CELL_MAX
                          ? `${run.errorMessage.slice(0, ERROR_CELL_MAX)}…`
                          : run.errorMessage}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
