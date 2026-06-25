/**
 * 전역 오류 배너 (Requirement 19.1).
 *
 * design.md "Frontend 오류 처리":
 *  - `error`가 있으면 화면 상단 sticky 영역에 빨간색 배너 + 재시도 버튼을 표시한다.
 *  - 재시도 클릭 시 `onRetry`(보통 query.refetch)를 호출한다.
 *  - 502(Power BI 실패) 시 "Power BI 연결에 문제가 발생했습니다: {errorDescription}" 표시.
 *    Backend는 Power BI 실패를 502 + errorCode `POWERBI_*`(POWERBI_AUTH_ERROR /
 *    POWERBI_FORBIDDEN / POWERBI_RATE_LIMIT / POWERBI_UPSTREAM_5XX)로 표준화한다.
 *  - 재시도 버튼은 5xx(>=500) 또는 네트워크 오류(status 0 / NETWORK_ERROR)에서만
 *    노출한다(design.md "5xx 또는 네트워크 오류 시 재시도 버튼"). 4xx는 메시지만 표시.
 *  - `error`가 없으면(null/undefined) 아무것도 렌더하지 않는다.
 *
 * 본 컴포넌트는 표시 전용 순수 컴포넌트이며, 어떤 종류의 오류 객체가 와도
 * 사람이 읽을 수 있는 한 줄 메시지로 graceful 하게 변환한다(total function).
 * 단계 7에서 TanStack Query의 error(ApiError)를 그대로 주입받아 실연동한다.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";
import ko from "@/i18n/ko";

/** axios interceptor 등이 표준화한 API 오류 형태 (단계 7에서 사용) */
export interface ApiErrorLike {
  /** HTTP 상태 코드 */
  status?: number;
  /** Backend errorCode (예: "POWERBI_AUTH_ERROR", "VALIDATION_ERROR") */
  errorCode?: string;
  /** 사람이 읽을 수 있는 오류 설명 */
  errorDescription?: string;
  /** 일반 Error.message 호환 */
  message?: string;
}

/** ErrorBanner가 허용하는 오류 입력 타입 */
export type BannerError = ApiErrorLike | Error | string | null | undefined;

export interface ErrorBannerProps {
  /** 표시할 오류. null/undefined면 렌더하지 않는다. */
  error?: BannerError;
  /** 재시도 버튼 클릭 콜백 (query.refetch 등) */
  onRetry?: () => void;
}

/**
 * 오류가 Power BI 연동 실패인지 판별한다.
 *
 * Backend(core/errors.py)는 Power BI 호출 실패를 HTTP 502 + 아래 errorCode로
 * 표준화한다: `POWERBI_AUTH_ERROR` / `POWERBI_FORBIDDEN` / `POWERBI_RATE_LIMIT`
 * / `POWERBI_UPSTREAM_5XX` (Requirement 19.2). 따라서 502 상태이거나 errorCode가
 * `POWERBI_` 접두사를 가지면 Power BI 오류로 본다(과거 호환용 `POWERBI_ERROR` 포함).
 */
function isPowerBiError(error: ApiErrorLike): boolean {
  return (
    error.status === 502 ||
    error.errorCode === "POWERBI_ERROR" ||
    (typeof error.errorCode === "string" && error.errorCode.startsWith("POWERBI_"))
  );
}

/**
 * 표준화된 API 오류(또는 그 형태의 객체)인지 판별한다.
 *
 * `ApiError`는 `Error`를 상속하므로 `instanceof Error` 검사보다 먼저 식별해야
 * status/errorCode 기반 Power BI 메시지가 올바르게 적용된다.
 */
function isApiErrorLike(error: object): error is ApiErrorLike {
  return "status" in error || "errorCode" in error || "errorDescription" in error;
}

/**
 * 임의의 오류 입력을 사람이 읽을 수 있는 한 줄 메시지로 변환한다.
 * - 문자열: 그대로
 * - ApiErrorLike(ApiError 포함): 502/Power BI면 한국어 prefix + 설명, 그 외 errorDescription/message
 * - 일반 Error: message
 * - 그 외: 일반 안내 문구
 */
function toMessage(error: NonNullable<BannerError>): string {
  if (typeof error === "string") {
    return error.trim() || ko.common.errorBackend;
  }
  // ApiError는 Error 상속이므로 status/errorCode 기반 처리를 먼저 적용한다.
  if (isApiErrorLike(error)) {
    const desc = error.errorDescription ?? error.message ?? "";
    if (isPowerBiError(error)) {
      return desc ? `${ko.common.errorPowerBi}: ${desc}` : ko.common.errorPowerBi;
    }
    return desc || ko.common.errorBackend;
  }
  if (error instanceof Error) {
    return error.message || ko.common.errorBackend;
  }
  return ko.common.errorBackend;
}

/**
 * 재시도 버튼을 노출할지 판별한다 (design.md "Frontend 오류 처리", Requirement 19.1).
 *
 * 5xx(>=500, 502 Power BI 포함) 또는 네트워크 오류(status 0 / `NETWORK_ERROR`)일 때만
 * 재시도 버튼을 노출한다. 4xx(검증 등 클라이언트 오류)는 재조회해도 동일 결과이므로
 * 메시지만 표시한다. 상태 정보가 없는 문자열/일반 Error는 재시도를 허용한다.
 */
function isRetryable(error: NonNullable<BannerError>): boolean {
  if (typeof error === "string") return true;
  if (isApiErrorLike(error)) {
    if (error.status === 0 || error.errorCode === "NETWORK_ERROR") return true;
    return typeof error.status === "number" && error.status >= 500;
  }
  // status 정보가 없는 일반 Error
  return true;
}

export default function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  // 오류가 없으면 렌더하지 않는다 (자리만 마련).
  if (error == null) return null;

  const message = toMessage(error);
  // design.md: 5xx 또는 네트워크 오류일 때만 재시도 버튼 노출 (Requirement 19.1)
  const showRetry = Boolean(onRetry) && isRetryable(error);

  return (
    <div
      role="alert"
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words font-medium">{message}</p>
      {showRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {ko.common.retry}
        </button>
      )}
    </div>
  );
}
