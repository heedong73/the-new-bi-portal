/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 자동 새로고침 토글 활성 시 재조회 간격(초). 미설정 시 60으로 fallback. */
  readonly VITE_AUTO_REFRESH_INTERVAL_SEC?: string;
  /**
   * Backend API 베이스 URL.
   *
   * 미설정 시 `http://localhost:8000`으로 fallback 한다. Backend CORS가
   * `http://localhost:5173`(dev)을 허용하므로, dev에서는 cross-origin으로
   * 직접 호출한다. nginx /api 프록시를 활성화한 배포 환경에서는 빈 문자열("")로
   * 설정하여 상대 경로(`/api/...`)로 호출할 수 있다.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
