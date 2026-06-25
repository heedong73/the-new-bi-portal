/**
 * Refresh 실행 현황 — 메인 화면 (`/monitoring/status`).
 *
 * design.md "라우팅 ↔ 사이드바 매핑"의 메인(Refresh 실행 현황) 화면으로,
 * 1단계에서 만든 컴포넌트를 결합한다. 레이아웃(위→아래):
 *   1. FilterBar (상단 필터)
 *   2. KpiCards (7개 KPI)
 *   3. 2단 영역: 좌측 RefreshTimeline(Gantt) + 우측 ExecutionFlow
 *   4. 하단 분석 차트 4개: LongestRunCard / DurationBarChart / HourlyTrendChart / StatusDonutChart
 *   5. RefreshTable (상세 테이블)
 *
 * 데이터 흐름 (단계 7, 실연동):
 *   - useRefreshFilterStore의 필터(from/to/status/reportId/datasetId)를 읽는다.
 *   - "조회"(FilterBar.onSearch) / "새로고침"(Header.onRefresh) 시점에 현재 store
 *     값을 `applied` 스냅샷으로 고정하고, 이 스냅샷을 TanStack Query 훅에 전달한다.
 *     (키 입력마다가 아니라 명시적 조회 시 반영 — Requirement 13.2 의도)
 *   - useRefreshTimetable(applied): Gantt / 차트 / 테이블용 Report 단위 runs
 *   - useSummary(date): KPI / LongestRunCard / Donut 용 요약
 *   - useRefreshHistory(date): ExecutionFlow용 해당 일자 실행 목록
 *   - status "all"은 refreshApi 계층에서 status 파라미터 미전달로 매핑(전체 조회).
 *
 * 로딩/오류 처리 (Requirement 19.1):
 *   - 최초 로딩 시 LoadingSpinner 표시.
 *   - 오류(ApiError)는 HeaderActionsContext를 통해 App 상단 ErrorBanner로 위임하고,
 *     재시도(onRetry) 시 timetable 쿼리를 refetch 한다.
 *
 * Header 액션 연결:
 *   - HeaderActionsContext에 onRefresh(재조회) / onExport(현재 표시 행 CSV) /
 *     error / onRetry를 등록한다.
 *   - 내보내기는 RefreshTable의 onVisibleRowsChange로 보관한 "현재 표시 행"을 CSV로
 *     내보낸다(검색/정렬/토글이 반영된 행 — Requirement 18.5).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import FilterBar from "@/components/filters/FilterBar";
import KpiCards from "@/components/kpi/KpiCards";
import RefreshTimeline from "@/components/gantt/RefreshTimeline";
import ExecutionFlow from "@/components/flow/ExecutionFlow";
import {
  DurationBarChart,
  HourlyTrendChart,
  LongestRunCard,
  StatusDonutChart,
} from "@/components/charts";
import RefreshTable from "@/components/table/RefreshTable";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import { useRegisterHeaderActions } from "@/layout/HeaderActionsContext";
import {
  useRefreshHistory,
  useRefreshTimetable,
  useSummary,
} from "@/api/hooks";
import { useRefreshFilterStore } from "@/stores/useRefreshFilterStore";
import { downloadCSV } from "@/utils/csv";
import { toDateParam } from "@/utils/date";
import type { RefreshRunOut, SummaryOut } from "@/types/refresh";

/** CSV 내보내기 기본 파일명 */
const CSV_FILENAME = "refresh-history.csv";

/** 빈 요약(요약 데이터 로딩 전/실패 시 KPI·차트 fallback) */
const EMPTY_SUMMARY: SummaryOut = {
  total: 0,
  success: 0,
  failed: 0,
  inProgress: 0,
  averageDurationSeconds: 0,
  longestRun: null,
  lastCompletedAtLocal: null,
};

/** 조회에 적용되는 필터 스냅샷 (store 값의 캡처본) */
interface AppliedFilters {
  from: Date;
  to: Date;
  status: ReturnType<typeof useRefreshFilterStore.getState>["status"];
  reportId: string | null;
  datasetId: string | null;
}

export default function RefreshStatusPage() {
  // 필터 store (라이브 값) — "조회" 시점에 스냅샷으로 고정한다.
  const from = useRefreshFilterStore((s) => s.from);
  const to = useRefreshFilterStore((s) => s.to);
  const status = useRefreshFilterStore((s) => s.status);
  const reportId = useRefreshFilterStore((s) => s.reportId);
  const datasetId = useRefreshFilterStore((s) => s.datasetId);

  // 화면에서 제외할 리포트(행 숨김) — store 클라이언트 상태
  const excludedReportIds = useRefreshFilterStore((s) => s.excludedReportIds);
  const excludeReport = useRefreshFilterStore((s) => s.excludeReport);
  const clearExcludedReports = useRefreshFilterStore((s) => s.clearExcludedReports);

  // 적용된 필터 스냅샷 — "조회" 시에만 갱신하여 명시적 조회 시 반영(R13.2)
  const [applied, setApplied] = useState<AppliedFilters>(() => ({
    from,
    to,
    status,
    reportId,
    datasetId,
  }));

  /** 현재 store 값을 적용 스냅샷으로 고정한다. */
  const applySnapshot = useCallback(() => {
    setApplied({ from, to, status, reportId, datasetId });
  }, [from, to, status, reportId, datasetId]);

  // 요약/실행흐름의 날짜 파라미터: 조회 기간 시작일(KST 벽시계 기준)
  const dateParam = useMemo(() => toDateParam(applied.from), [applied.from]);

  // --- 데이터 취득 (TanStack Query 훅) ------------------------------------
  const timetableQuery = useRefreshTimetable(applied);
  const summaryQuery = useSummary(dateParam);
  const historyQuery = useRefreshHistory(dateParam);

  const timetableRuns = useMemo<RefreshRunOut[]>(
    () => timetableQuery.data ?? [],
    [timetableQuery.data]
  );
  const summary = summaryQuery.data ?? EMPTY_SUMMARY;
  const todayRuns = useMemo<RefreshRunOut[]>(
    () => historyQuery.data ?? [],
    [historyQuery.data]
  );

  // 제외된 리포트(reportName 기준)를 화면 데이터에서 숨긴다.
  const excludedSet = useMemo(
    () => new Set(excludedReportIds),
    [excludedReportIds]
  );
  const visibleTimetableRuns = useMemo<RefreshRunOut[]>(
    () => timetableRuns.filter((r) => !excludedSet.has(r.reportName)),
    [timetableRuns, excludedSet]
  );
  const visibleTodayRuns = useMemo<RefreshRunOut[]>(
    () => todayRuns.filter((r) => !excludedSet.has(r.reportName)),
    [todayRuns, excludedSet]
  );

  /** 조회/새로고침: 스냅샷 고정 후 모든 쿼리 refetch */
  const applyAndRefetch = useCallback(() => {
    applySnapshot();
    timetableQuery.refetch();
    summaryQuery.refetch();
    historyQuery.refetch();
  }, [applySnapshot, timetableQuery, summaryQuery, historyQuery]);

  // --- Header 내보내기: 테이블의 "현재 표시 행"을 ref로 보관 ----------------
  const visibleRowsRef = useRef<RefreshRunOut[]>(timetableRuns);
  const handleVisibleRowsChange = useCallback((rows: RefreshRunOut[]) => {
    visibleRowsRef.current = rows;
  }, []);
  const handleExport = useCallback(() => {
    downloadCSV(visibleRowsRef.current, CSV_FILENAME);
  }, []);

  // --- 오류 처리 (Requirement 19.1) ---------------------------------------
  // 세 쿼리 중 가장 먼저 발생한 오류를 배너로 노출한다.
  const error =
    timetableQuery.error ?? summaryQuery.error ?? historyQuery.error ?? null;

  // Header(onRefresh/onExport) 및 전역 오류 배너를 이 페이지 핸들러에 연결한다.
  useRegisterHeaderActions(
    {
      onRefresh: applyAndRefetch,
      onExport: handleExport,
      error,
      onRetry: applyAndRefetch,
    },
    [applyAndRefetch, handleExport, error]
  );

  // 최초 로딩(데이터가 아직 없고 fetching 중)일 때 스피너 표시
  const isInitialLoading =
    timetableQuery.isLoading && summaryQuery.isLoading && historyQuery.isLoading;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* 1. 필터 바 (조회 시 재조회) */}
      <FilterBar onSearch={applyAndRefetch} />

      {isInitialLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* 2. KPI 카드 */}
          <KpiCards summary={summary} />

          {/* 3. 2단 레이아웃: Gantt(좌) + ExecutionFlow(우) */}
          {/* 제외된 리포트가 있으면 복원 배너를 표시한다 (선택 제외 방식). */}
          {excludedReportIds.length > 0 && (
            <div className="mx-6 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <span>
                제외된 리포트 {excludedReportIds.length}개 — 타임테이블/차트/표에서 숨김
              </span>
              <button
                type="button"
                onClick={() => clearExcludedReports()}
                className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                모두 다시 표시
              </button>
            </div>
          )}

          {/* 우측 컬럼은 relative 컨테이너로 두고 ExecutionFlow를 absolute로 채워,
              좌측 Gantt 높이에 맞춰지고 내용이 길면 패널 내부에서 세로 스크롤되게 한다.
              (items-start: 우측 컬럼이 Gantt 높이에 늘어나도록 stretch 방지) */}
          <div className="grid grid-cols-1 items-start gap-4 px-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <RefreshTimeline
              runs={visibleTimetableRuns}
              from={applied.from}
              to={applied.to}
              onExcludeReport={excludeReport}
            />
            <div className="relative min-h-[20rem] self-stretch">
              <div className="absolute inset-0">
                <ExecutionFlow runs={visibleTodayRuns} />
              </div>
            </div>
          </div>

          {/* 4. 하단 분석 차트 4개 */}
          <div className="grid grid-cols-1 gap-4 px-6 md:grid-cols-2 xl:grid-cols-4">
            <LongestRunCard summary={summary} />
            <DurationBarChart runs={visibleTimetableRuns} />
            <HourlyTrendChart runs={visibleTimetableRuns} />
            <StatusDonutChart summary={summary} />
          </div>

          {/* 5. 상세 테이블 */}
          <div className="px-6">
            <RefreshTable
              runs={visibleTimetableRuns}
              onVisibleRowsChange={handleVisibleRowsChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
