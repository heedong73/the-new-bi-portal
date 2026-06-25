import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import Header from "./components/layout/Header";
import ErrorBanner from "./components/common/ErrorBanner";
import ToastContainer from "./components/common/ToastContainer";
import {
  HeaderActionsProvider,
  useHeaderActions,
} from "./layout/HeaderActionsContext";
import useRefreshFilterStore from "./stores/useRefreshFilterStore";
import DashboardPage from "./routes/DashboardPage";
import RefreshStatusPage from "./routes/RefreshStatusPage";
import RefreshDetailPage from "./routes/RefreshDetailPage";
import RefreshLogPage from "./routes/RefreshLogPage";
import ExecutionStatsPage from "./routes/analytics/ExecutionStatsPage";
import DatasetThroughputPage from "./routes/analytics/DatasetThroughputPage";
import TopNPage from "./routes/analytics/TopNPage";
import ConnectionPage from "./routes/settings/ConnectionPage";
import NotificationPage from "./routes/settings/NotificationPage";
import UserPage from "./routes/settings/UserPage";

/**
 * 애플리케이션 루트 컴포넌트.
 *
 * Router + Layout 골격을 제공한다. Sidebar/Header 레이아웃에 실제 페이지
 * 컴포넌트(routes/)를 연결하며, 라우트는 design.md "라우팅 ↔ 사이드바 매핑"
 * 표를 그대로 반영한다.
 *
 *  - Header의 자동 새로고침 토글은 useRefreshFilterStore(Zustand)와 연결한다.
 *    토글 ON 시 hooks.ts의 refetchInterval(store 기반)이 활성 쿼리를 주기적으로
 *    자동 refetch 한다(Requirement 12.3, task 7.2 완료).
 *  - Header의 새로고침/내보내기 버튼은 HeaderActionsContext를 통해 현재 라우트
 *    페이지가 등록한 핸들러로 위임한다(과도한 전역 상태 없이 라우트별 처리).
 *  - ErrorBanner는 헤더 아래(main 상단)에 sticky로 배치한다. 단계 1(mock)에서는
 *    error=null이라 렌더되지 않지만, 단계 7에서 TanStack Query의 error를 연결할
 *    자리를 마련한다 (Requirement 19.1).
 */
function AppShell() {
  const autoRefresh = useRefreshFilterStore((s) => s.autoRefresh);
  const toggleAutoRefresh = useRefreshFilterStore((s) => s.toggleAutoRefresh);

  // 현재 라우트 페이지가 등록한 헤더 액션 / 전역 오류
  const { onRefresh, onExport, error, onRetry } = useHeaderActions();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => toggleAutoRefresh()}
          onRefresh={onRefresh}
          onExport={onExport}
        />
        {/* 전역 오류 배너 (Requirement 19.1) — 헤더 아래 sticky */}
        <ErrorBanner error={error} onRetry={onRetry} />
        <main className="flex-1 overflow-auto bg-slate-50">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/monitoring/status" element={<RefreshStatusPage />} />
            <Route path="/monitoring/detail" element={<RefreshDetailPage />} />
            <Route path="/monitoring/log" element={<RefreshLogPage />} />
            <Route path="/analytics/stats" element={<ExecutionStatsPage />} />
            <Route path="/analytics/throughput" element={<DatasetThroughputPage />} />
            <Route path="/analytics/top-n" element={<TopNPage />} />
            <Route path="/settings/connection" element={<ConnectionPage />} />
            <Route path="/settings/notification" element={<NotificationPage />} />
            <Route path="/settings/user" element={<UserPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HeaderActionsProvider>
      <AppShell />
      {/* 전역 toast (즉시 수집 결과 안내 등 — Requirement 10.1) */}
      <ToastContainer />
    </HeaderActionsProvider>
  );
}
