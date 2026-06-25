/**
 * fetch 기반 API 클라이언트 (단계 7).
 *
 * design.md "TanStack Query" / "Frontend 오류 처리" 절의 결정을 따른다.
 *  - axios 대신 fetch를 사용하여 런타임 의존성을 최소화한다.
 *  - 모든 오류(HTTP 4xx/5xx, 네트워크, JSON 파싱 실패)를 `ApiError`로 표준화한다.
 *    표준화 형태는 `{status, errorCode, errorDescription}`이며, ErrorBanner의
 *    `ApiErrorLike`({status, errorCode, errorDescription, message})와 호환된다.
 *  - Backend는 오류 시 본문에 `{errorCode, errorDescription}`(design.md 공통 오류
 *    응답 표)을 반환하므로 이를 파싱하여 그대로 노출한다.
 *
 * 베이스 URL 결정 (design.md / docker-compose / CORS 고려):
 *  - `VITE_API_BASE_URL`이 설정되면 그 값을 사용한다.
 *  - 미설정 시 `http://localhost:8000`으로 fallback 한다(dev). Backend CORS가
 *    `http://localhost:5173`을 허용(allow_credentials)하므로 cross-origin 직접
 *    호출이 가능하다. 또는 `VITE_API_BASE_URL=""`로 두면 Vite 프록시(/api)를 타
 *    동일 출처로 호출한다.
 *  - 배포(nginx /api 프록시 활성화) 시에는 `VITE_API_BASE_URL=""`로 설정하여
 *    상대 경로(`/api/...`)로 호출하면 된다.
 */

/** 기본 베이스 URL (VITE_API_BASE_URL 미설정 시). */
const DEFAULT_BASE_URL = "http://localhost:8000";

/**
 * 베이스 URL을 해석한다.
 * - 정의되지 않은 경우(undefined)에만 기본값을 사용한다.
 * - 명시적 빈 문자열("")은 "상대 경로 사용" 의도이므로 그대로 둔다.
 * - 끝의 슬래시는 제거하여 경로 결합 시 중복 슬래시를 방지한다.
 */
function resolveBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  const base = raw === undefined ? DEFAULT_BASE_URL : raw;
  return base.replace(/\/+$/, "");
}

/** 모듈 로드 시점에 한 번 해석한 베이스 URL. */
export const API_BASE_URL = resolveBaseUrl();

/**
 * 표준화된 API 오류.
 *
 * ErrorBanner의 `ApiErrorLike`와 호환되도록 `status`/`errorCode`/
 * `errorDescription` 필드를 노출하며, `Error`를 상속하여 `message`도 채운다.
 * TanStack Query의 `error`로 그대로 전달된다.
 */
export class ApiError extends Error {
  /** HTTP 상태 코드. 네트워크 오류 등 응답이 없으면 0 */
  readonly status: number;
  /** Backend errorCode (예: "POWERBI_ERROR", "VALIDATION_ERROR") */
  readonly errorCode?: string;
  /** 사람이 읽을 수 있는 오류 설명 */
  readonly errorDescription?: string;

  constructor(params: {
    status: number;
    errorCode?: string;
    errorDescription?: string;
    message?: string;
  }) {
    super(
      params.message ??
        params.errorDescription ??
        params.errorCode ??
        "API 요청에 실패했습니다."
    );
    this.name = "ApiError";
    this.status = params.status;
    this.errorCode = params.errorCode;
    this.errorDescription = params.errorDescription;
  }
}

/** Backend 오류 응답 본문 형태 (design.md 공통 오류 응답). */
interface ApiErrorBody {
  errorCode?: string;
  errorDescription?: string;
}

/** 쿼리 파라미터 값 타입 (undefined/null은 미전달로 처리). */
export type QueryParamValue = string | number | boolean | null | undefined;

/** request 옵션 */
export interface RequestOptions {
  /** HTTP 메서드. 기본 GET */
  method?: string;
  /** 쿼리 파라미터. null/undefined 값은 직렬화에서 제외한다. */
  query?: Record<string, QueryParamValue>;
  /** JSON 본문 (POST 등). 있으면 Content-Type: application/json 자동 설정 */
  body?: unknown;
  /** AbortSignal (TanStack Query가 주입) */
  signal?: AbortSignal;
}

/** path와 query를 결합하여 최종 요청 URL 문자열을 만든다. */
function buildUrl(path: string, query?: Record<string, QueryParamValue>): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  let url = `${API_BASE_URL}${normalizedPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.append(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

/** 응답 본문에서 오류 메시지를 안전하게 추출한다(파싱 실패 graceful). */
async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const data = (await response.json()) as ApiErrorBody;
    if (data && typeof data === "object") return data;
    return {};
  } catch {
    return {};
  }
}

/**
 * 공통 request 함수.
 *
 * - 응답이 ok면 JSON을 파싱하여 `T`로 반환한다(204/빈 본문은 undefined).
 * - 응답이 ok가 아니면 본문의 `{errorCode, errorDescription}`을 읽어 `ApiError`로 throw.
 * - 네트워크 오류/JSON 파싱 실패도 `ApiError`(status 0 / 502)로 표준화하여 throw.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, signal } = options;
  const url = buildUrl(path, query);

  const headers: Record<string, string> = { Accept: "application/json" };
  let bodyInit: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      // multipart: Content-Type은 브라우저가 boundary와 함께 자동 설정
      bodyInit = body;
    } else {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(body);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyInit,
      signal,
      credentials: "include", // 세션 쿠키(bip_session) 송수신
    });
  } catch (err) {
    // 네트워크 오류(서버 미기동, CORS, 연결 끊김 등) 또는 abort
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err; // abort는 TanStack Query가 자체 처리하도록 그대로 전파
    }
    throw new ApiError({
      status: 0,
      errorCode: "NETWORK_ERROR",
      errorDescription:
        "네트워크 오류로 서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (!response.ok) {
    const errBody = await parseErrorBody(response);
    throw new ApiError({
      status: response.status,
      errorCode: errBody.errorCode,
      errorDescription: errBody.errorDescription,
    });
  }

  // 성공 응답: 204 또는 빈 본문 처리
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      status: response.status,
      errorCode: "PARSE_ERROR",
      errorDescription: "서버 응답을 해석하지 못했습니다.",
    });
  }
}

/** 편의 메서드 모음. */
export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method">) =>
    request<T>(path, { ...options, method: "POST", body }),
};

export default apiClient;
