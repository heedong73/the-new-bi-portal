import { RefreshCw, Download, UserCircle2, DownloadCloud } from "lucide-react";
import ko from "../../i18n/ko";
import { useCollectNow } from "../../api/hooks";
import { useToastStore } from "../../stores/useToastStore";

/**
 * 상단 헤더 (Requirements 12.2, 12.3, 12.4, 10.1).
 *
 * 제목, 자동 새로고침 토글, 새로고침 버튼, 즉시 수집 버튼, 내보내기 버튼,
 * 현재 사용자(admin)를 표시한다.
 *
 * 동작 연결:
 *  - 자동 새로고침 토글(12.3): App에서 useRefreshFilterStore와 연결. 토글 ON 시
 *    hooks.ts의 refetchInterval이 store 기반으로 동작하여 활성 쿼리가 주기적으로
 *    자동 refetch 된다.
 *  - 새로고침 버튼(12.4): App이 HeaderActionsContext를 통해 현재 라우트 페이지의
 *    onRefresh(즉시 재조회) 핸들러를 위임한다.
 *  - 즉시 수집 버튼(10.1): 라우트 무관하게 동작해야 하므로 Header가 useCollectNow
 *    mutation을 직접 호출한다(Header는 QueryClientProvider 하위). 결과(enqueued /
 *    already-running / 실패)에 따라 toast로 안내한다.
 *  - 내보내기 버튼: 페이지가 등록한 onExport(CSV)를 위임한다.
 */
export interface HeaderProps {
  /** 자동 새로고침 토글 현재 상태 (기본 false) */
  autoRefresh?: boolean;
  /** 자동 새로고침 토글 변경 콜백 (다음 상태를 전달) */
  onToggleAutoRefresh?: (next: boolean) => void;
  /** 새로고침 버튼 클릭 콜백 (Requirement 12.4) */
  onRefresh?: () => void;
  /** 내보내기 버튼 클릭 콜백 (CSV 내보내기는 task 1.12 에서 연결) */
  onExport?: () => void;
  /** 현재 사용자 표시 (기본 admin) */
  currentUser?: string;
}

export default function Header({
  autoRefresh = false,
  onToggleAutoRefresh,
  onRefresh,
  onExport,
  currentUser = ko.header.user,
}: HeaderProps) {
  const collectNow = useCollectNow();
  const addToast = useToastStore((s) => s.addToast);

  /**
   * 즉시 수집 트리거 (Requirement 10.1).
   * POST /api/collect-now 결과에 따라 toast로 안내한다.
   *  - enqueued: "수집 작업을 시작했습니다." (success)
   *  - already-running: "이미 수집이 실행 중입니다." (info)
   *  - 실패: 오류 설명 또는 일반 오류 메시지 (error)
   * 수집은 비동기이므로 즉시 데이터가 바뀌지 않을 수 있으나, mutation onSuccess가
   * 관련 쿼리를 invalidate 하여 다음 응답 시점에 최신 데이터로 갱신된다.
   */
  const handleCollectNow = () => {
    if (collectNow.isPending) return;
    collectNow.mutate(undefined, {
      onSuccess: (result) => {
        if (result.status === "already-running") {
          addToast(ko.common.collectAlreadyRunning, "info");
        } else {
          addToast(ko.common.collectEnqueued, "success");
        }
      },
      onError: (err) => {
        const description =
          err && typeof err === "object" && "errorDescription" in err
            ? (err as { errorDescription?: string }).errorDescription
            : undefined;
        addToast(description || ko.common.errorBackend, "error");
      },
    });
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      {/* 제목 */}
      <h1 className="text-base font-semibold text-slate-800">
        {ko.header.title}
      </h1>

      {/* 우측 컨트롤 */}
      <div className="flex items-center gap-3">
        {/* 자동 새로고침 토글 (Requirements 12.2, 12.3) */}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <span>{ko.header.autoRefresh}</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            aria-label={ko.header.autoRefresh}
            onClick={() => onToggleAutoRefresh?.(!autoRefresh)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              autoRefresh ? "bg-yellow-400" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                autoRefresh ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>

        <span className="h-5 w-px bg-slate-200" aria-hidden="true" />

        {/* 새로고침 버튼 (Requirement 12.4) */}
        <button
          type="button"
          onClick={() => onRefresh?.()}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {ko.header.refresh}
        </button>

        {/* 즉시 수집 버튼 (Requirement 10.1) */}
        <button
          type="button"
          onClick={handleCollectNow}
          disabled={collectNow.isPending}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <DownloadCloud
            className={`h-4 w-4 ${collectNow.isPending ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          {ko.header.collectNow}
        </button>

        {/* 내보내기 버튼 (CSV 트리거는 task 1.12) */}
        <button
          type="button"
          onClick={() => onExport?.()}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {ko.header.export}
        </button>

        <span className="h-5 w-px bg-slate-200" aria-hidden="true" />

        {/* 현재 사용자 표시 */}
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <UserCircle2 className="h-5 w-5 text-slate-400" aria-hidden="true" />
          {currentUser}
        </span>
      </div>
    </header>
  );
}
