/**
 * 헤더 액션 컨텍스트.
 *
 * Header는 모든 화면에 걸쳐 상단에 고정(App 레벨)되지만, "새로고침"/"내보내기"
 * 버튼의 실제 동작은 현재 라우트의 페이지가 가장 잘 안다. 과도한 전역 상태
 * (Zustand 등) 도입 없이, 페이지가 자신의 핸들러를 컨텍스트에 등록(register)하고
 * App의 Header가 이를 호출하도록 하는 가벼운 컨텍스트를 제공한다.
 *
 *  - App: <HeaderActionsProvider>로 트리를 감싸고, Header의 onRefresh/onExport를
 *    이 컨텍스트의 현재 등록값에 위임한다. 또한 ErrorBanner에 전역 error/onRetry를
 *    연결한다(현재는 mock이라 error=null).
 *  - Page(RefreshStatusPage 등): useRegisterHeaderActions(...)로 자신의 핸들러를
 *    마운트 시 등록하고, 언마운트 시 초기화한다.
 *
 * 단계 7.2에서 "즉시 수집(collect-now)"·자동 새로고침을 같은 메커니즘으로 확장한다.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BannerError } from "@/components/common/ErrorBanner";

/** 페이지가 등록할 수 있는 헤더 액션 집합 */
export interface HeaderActions {
  /** 새로고침 버튼(Requirement 12.4) 클릭 시 동작 */
  onRefresh?: () => void;
  /** 내보내기 버튼 클릭 시 동작 (CSV 내보내기 등) */
  onExport?: () => void;
  /** 전역 오류 배너에 표시할 오류 (Requirement 19.1) */
  error?: BannerError;
  /** 오류 배너 재시도 동작 */
  onRetry?: () => void;
}

interface HeaderActionsContextValue {
  actions: HeaderActions;
  /** 액션 등록/병합. 페이지에서 호출한다. */
  setActions: (next: HeaderActions) => void;
  /** 액션 초기화. 페이지 언마운트 시 호출한다. */
  clearActions: () => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(null);

export function HeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<HeaderActions>({});

  const setActions = useCallback((next: HeaderActions) => {
    setActionsState(next);
  }, []);

  const clearActions = useCallback(() => {
    setActionsState({});
  }, []);

  const value = useMemo<HeaderActionsContextValue>(
    () => ({ actions, setActions, clearActions }),
    [actions, setActions, clearActions]
  );

  return (
    <HeaderActionsContext.Provider value={value}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

/** App(Header/ErrorBanner)이 현재 등록된 액션을 읽기 위한 훅 */
// Provider와 전용 hooks를 한 모듈에서 제공하는 Context API 모듈이다.
// eslint-disable-next-line react-refresh/only-export-components
export function useHeaderActions(): HeaderActions {
  const ctx = useContext(HeaderActionsContext);
  return ctx?.actions ?? {};
}

/**
 * 페이지가 자신의 헤더 액션을 등록하는 훅.
 * deps가 바뀔 때마다 최신 핸들러로 갱신하고, 언마운트 시 초기화한다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRegisterHeaderActions(
  actions: HeaderActions,
  deps: readonly unknown[]
): void {
  const ctx = useContext(HeaderActionsContext);

  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(actions);
    return () => ctx.clearActions();
    // actions는 deps로 안정성을 제어한다(페이지가 deps를 명시).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ...deps]);
}

export default HeaderActionsContext;
