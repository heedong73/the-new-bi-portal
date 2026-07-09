/**
 * Refresh 실행 현황 — 메인 화면 (`/monitoring/refresh`, 관리자 콘솔).
 *
 * design.md "라우팅 ↔ 사이드바 매핑"의 메인(Refresh 실행 현황) 화면으로,
 * 1단계에서 만든 컴포넌트를 결합한다. 레이아웃(위→아래):
 *   1. FilterBar (상단 필터)
 *   2. KpiCards (7개 KPI)
 *   3. 2단 영역: 좌측 RefreshTimeline(Gantt) + 우측 ExecutionFlow
 *   4. 하단 분석: LongestRunCard(오래 걸린 TOP5) + FailedRunsCard(실패·경고) 2단 / HourlyTrendChart(30분 추이) 전체 폭
 *   5. RefreshTable (상세 테이블)
 *
 * 데이터 흐름:
 *   - 단일 일자 선택 모델: useRefreshFilterStore의 from/to는 "선택 일자 하루"(00:00~23:59)를
 *     나타내고, status/reportId/datasetId와 함께 그대로 TanStack Query에 전달된다(스냅샷
 *     없이 store 변경 시 즉시 반영). 며칠 범위를 한 번에 보면 간트/차트 가시성이 낮아 하루로 고정.
 *   - 최초 진입 시 useLatestRefreshDate로 '데이터가 있는 최신 일자'를 받아 기본 선택으로 1회
 *     설정한다(오늘 갱신이 없어도 최근 실행일이 바로 보이도록). 확정 전에는 조회를 보류한다.
 *   - useRefreshTimetable(filters): 선택 일자의 Report 단위 runs —
 *     Gantt / 차트 / 테이블 / ExecutionFlow / KPI의 단일 데이터 소스.
 *   - KPI/요약(LongestRunCard/Donut 포함)은 /api/summary 대신 computeSummary(표시 중 runs)로
 *     계산하여 화면 전체를 선택 일자 기준으로 일관시킨다.
 *   - status "all"은 refreshApi 계층에서 status 파라미터 미전달로 매핑(전체 조회).
 *
 * 로딩/오류 처리 (Requirement 19.1):
 *   - 최초 로딩 시 LoadingSpinner 표시.
 *   - 오류(ApiError)는 페이지 상단 ErrorBanner에 인라인으로 표시하고,
 *     재시도(onRetry) 시 timetable 쿼리를 refetch 한다.
 *
 * 페이지 툴바(액션):
 *   - 관리자 콘솔 셸(AdminConsoleLayout)은 전역 헤더 액션 영역을 렌더하지 않으므로,
 *     새로고침 / 즉시 수집(collect-now) / CSV 내보내기 / 자동 새로고침 토글을 이
 *     페이지 자체 툴바에서 제공한다(HeaderActionsContext 미사용).
 *   - 내보내기는 RefreshTable의 onVisibleRowsChange로 보관한 "현재 표시 행"을 CSV로
 *     내보낸다(검색/정렬/토글이 반영된 행 — Requirement 18.5).
 *   - 즉시 수집은 useTaskStore에 진행 작업을 등록하고, 우측 상단 BackgroundTaskDock가
 *     /api/collect-status를 폴링해 "수집 중 → 완료"를 표시한다. useTaskStore가
 *     localStorage에 영속되므로 페이지를 새로고침해도 진행 배너가 유지된다.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { RefreshCw, DownloadCloud, FileDown } from "lucide-react";
import { startOfDay, endOfDay } from "date-fns";
import FilterBar from "@/components/filters/FilterBar";
import KpiCards from "@/components/kpi/KpiCards";
import RefreshTimeline from "@/components/gantt/RefreshTimeline";
import ExecutionFlow from "@/components/flow/ExecutionFlow";
import {
  FailedRunsCard,
  HourlyTrendChart,
  LongestRunCard,
} from "@/components/charts";
import RefreshTable from "@/components/table/RefreshTable";
import LoadingSpinner from "@/components/common/LoadingSpinner";
import ErrorBanner from "@/components/common/ErrorBanner";
import {
  useCollectNow,
  useLatestRefreshDate,
  useRefreshTimetable,
} from "@/api/hooks";
import { useRefreshFilterStore } from "@/stores/useRefreshFilterStore";
import { useTaskStore } from "@/stores/useTaskStore";
import { downloadCSV } from "@/utils/csv";
import { computeSummary } from "@/utils/summary";
import type { RefreshRunOut } from "@/types/refresh";

/** CSV 내보내기 기본 파일명 */
const CSV_FILENAME = "refresh-history.csv";

/** 즉시 수집 진행 배너의 고정 작업 id (수집은 workspace 단일 플라이트). */
const COLLECT_TASK_ID = "collect-now";

export default function RefreshStatusPage() {
  // 필터 store (라이브 값) — 단일 일자 선택 모델. 값 변경 시 조회가 즉시 반영된다.
  const from = useRefreshFilterStore((s) => s.from);
  const to = useRefreshFilterStore((s) => s.to);
  const status = useRefreshFilterStore((s) => s.status);
  const reportId = useRefreshFilterStore((s) => s.reportId);
  const datasetId = useRefreshFilterStore((s) => s.datasetId);
  const setRange = useRefreshFilterStore((s) => s.setRange);

  // 화면에서 제외할 리포트(행 숨김) — store 클라이언트 상태
  const excludedReportIds = useRefreshFilterStore((s) => s.excludedReportIds);
  const excludeReport = useRefreshFilterStore((s) => s.excludeReport);
  const clearExcludedReports = useRefreshFilterStore((s) => s.clearExcludedReports);

  // 자동 새로고침 토글 — 콘솔 헤더가 없으므로 페이지 툴바에서 제어한다.
  const autoRefresh = useRefreshFilterStore((s) => s.autoRefresh);
  const toggleAutoRefresh = useRefreshFilterStore((s) => s.toggleAutoRefresh);
  const autoRefreshIntervalSec = useRefreshFilterStore((s) => s.autoRefreshIntervalSec);

  // 최초 진입 시 '데이터가 있는 최신 일자'로 기본 선택을 1회 자동 설정한다
  // (오늘 갱신이 없어도 최근 실행일이 바로 보이도록). 세션 내에서는 사용자의
  // 선택을 존중하고, 전체 새로고침(store 초기화) 시 다시 최신 일자로 맞춘다.
  const selectedDateInitialized = useRefreshFilterStore((s) => s.selectedDateInitialized);
  const markDateInitialized = useRefreshFilterStore((s) => s.markDateInitialized);
  const latestDateQuery = useLatestRefreshDate();
  useEffect(() => {
    if (selectedDateInitialized || !latestDateQuery.isFetched) return;
    const d = latestDateQuery.data?.date;
    if (d) {
      const [y, m, dd] = d.split("-").map(Number);
      const day = new Date(y, m - 1, dd);
      setRange(startOfDay(day), endOfDay(day));
    }
    markDateInitialized();
  }, [
    latestDateQuery.isFetched,
    latestDateQuery.data,
    selectedDateInitialized,
    setRange,
    markDateInitialized,
  ]);

  // --- 데이터 취득 (TanStack Query 훅) ------------------------------------
  // 선택 일자 하루([from,to])가 화면의 단일 데이터 소스다. KPI/요약/실행흐름은
  // 단일 일자 기준 /api/summary 대신 이 runs에서 계산하여 화면 전체를 일관시킨다.
  // 기본 일자(최신)가 확정되기 전에는 조회를 보류한다(불필요한 오늘자 조회 방지).
  const filters = useMemo(
    () => ({ from, to, status, reportId, datasetId }),
    [from, to, status, reportId, datasetId]
  );
  const timetableQuery = useRefreshTimetable(filters, selectedDateInitialized);

  const timetableRuns = useMemo<RefreshRunOut[]>(
    () => timetableQuery.data ?? [],
    [timetableQuery.data]
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

  // KPI/요약: 표시 중(기간+제외 반영)인 runs에서 계산 (build_summary 동치).
  const summary = useMemo(
    () => computeSummary(visibleTimetableRuns),
    [visibleTimetableRuns]
  );

  /** 새로고침: 현재 선택 일자 기준 타임테이블 재조회 */
  const applyAndRefetch = useCallback(() => {
    timetableQuery.refetch();
  }, [timetableQuery]);

  // --- Header 내보내기: 테이블의 "현재 표시 행"을 ref로 보관 ----------------
  const visibleRowsRef = useRef<RefreshRunOut[]>(timetableRuns);
  const handleVisibleRowsChange = useCallback((rows: RefreshRunOut[]) => {
    visibleRowsRef.current = rows;
  }, []);
  const handleExport = useCallback(() => {
    downloadCSV(visibleRowsRef.current, CSV_FILENAME);
  }, []);

  // --- 오류 처리 (Requirement 19.1) ---------------------------------------
  // 타임테이블 조회 오류를 배너로 노출한다.
  const error = timetableQuery.error ?? null;

  // --- 즉시 수집(collect-now) ----------------------------------------------
  // 진행 상태는 우측 상단 진행 배너(BackgroundTaskDock)가 collect-status를 폴링해
  // 표시한다. useTaskStore는 localStorage에 영속되어 페이지를 새로고침해도 진행
  // 배너가 유지되고, 도크가 복원된 작업의 폴링을 이어간다.
  const collectNow = useCollectNow();
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const collecting = useTaskStore((s) =>
    s.tasks.some((t) => t.kind === "collect" && t.status === "pending")
  );
  const handleCollectNow = useCallback(() => {
    // 단일 플라이트 — 고정 id로 중복 배너 방지. 잔여(완료/실패) 항목 정리 후 재시작.
    removeTask(COLLECT_TASK_ID);
    addTask({
      id: COLLECT_TASK_ID,
      label: "Refresh 데이터",
      kind: "collect",
      status: "pending",
      startedAt: Date.now(),
    });
    collectNow.mutate(undefined, {
      onSuccess: (result) => {
        if (result.status === "already-running") {
          updateTask(COLLECT_TASK_ID, {
            status: "success",
            message: "이미 수집이 진행 중입니다.",
          });
        } else if (result.taskId) {
          // 도크가 이 task의 실제 결과(성공/실패)를 폴링하도록 id 저장
          updateTask(COLLECT_TASK_ID, { collectTaskId: result.taskId });
        }
      },
      onError: () =>
        updateTask(COLLECT_TASK_ID, {
          status: "error",
          message: "수집 요청에 실패했습니다.",
        }),
    });
  }, [collectNow, addTask, updateTask, removeTask]);

  // 최초 로딩(기본 일자 확정 전 또는 타임테이블 fetching 중)일 때 스피너 표시
  const isInitialLoading = !selectedDateInitialized || timetableQuery.isLoading;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* 0. 오류 배너 (오류가 있을 때만 렌더) */}
      <ErrorBanner error={error} onRetry={applyAndRefetch} />

      {/* 1. 페이지 툴바: 제목 + 액션(자동 새로고침 / 새로고침 / 즉시 수집 / CSV) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Refresh 실행 현황</h1>
          <p className="text-xs text-slate-500">
            Power BI 데이터셋 새로고침 실행 이력 · 예약 현황
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={toggleAutoRefresh}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            자동 새로고침 ({autoRefreshIntervalSec}초)
          </label>
          <button
            type="button"
            onClick={applyAndRefetch}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </button>
          <button
            type="button"
            onClick={handleCollectNow}
            disabled={collectNow.isPending || collecting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <DownloadCloud className="h-4 w-4" />
            {collecting ? "수집 중…" : "즉시 수집"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            <FileDown className="h-4 w-4" />
            CSV 내보내기
          </button>
        </div>
      </div>

      {/* 2. 필터 바 (단일 일자 선택 — 변경 즉시 반영) */}
      <FilterBar />

      {isInitialLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* 2. KPI 카드 */}
          <KpiCards summary={summary} />

          {/* 3. 2단 레이아웃: Gantt(좌) + ExecutionFlow(우) */}
          {/* 제외된 리포트가 있으면 복원 배너를 표시한다 (선택 제외 방식). */}
          {excludedReportIds.length > 0 && (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
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
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <RefreshTimeline
              runs={visibleTimetableRuns}
              from={from}
              to={to}
              onExcludeReport={excludeReport}
            />
            <div className="relative min-h-[20rem] self-stretch">
              <div className="absolute inset-0">
                <ExecutionFlow runs={visibleTimetableRuns} />
              </div>
            </div>
          </div>

          {/* 4. 하단 분석: 가장 오래 걸린 TOP5 + 실패·경고 목록(2단), 시간대별 추이(전체 폭·30분) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <LongestRunCard runs={visibleTimetableRuns} />
            <FailedRunsCard runs={visibleTimetableRuns} />
          </div>
          <HourlyTrendChart runs={visibleTimetableRuns} />

          {/* 5. 상세 테이블 */}
          <div className="min-w-0">
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
