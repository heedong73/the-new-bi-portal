/**
 * 모든 한국어 라벨 중앙화 모듈.
 *
 * 사이드바 메뉴, 헤더, 상태값, 필터, KPI, 테이블 컬럼 등 화면에 노출되는
 * 모든 문자열을 이 파일에서 단일 정의한다 (Requirements 12.1, 12.2, 20.4).
 *
 * design.md "라우팅 ↔ 사이드바 매핑" 표를 기준으로 사이드바 구조를 정의한다.
 */

/** 앱 전역 */
export const app = {
  title: "Power BI Refresh Monitor",
  currentUser: "admin",
} as const;

/** 헤더 (Requirement 12.2) */
export const header = {
  title: "Power BI Refresh Monitor",
  autoRefresh: "자동 새로고침",
  refresh: "새로고침",
  export: "내보내기",
  collectNow: "즉시 수집",
  user: "admin",
} as const;

/**
 * 사이드바 메뉴 구조 (Requirement 12.1).
 * design.md "라우팅 ↔ 사이드바 매핑" 표를 그대로 반영한다.
 */
export interface SidebarItem {
  label: string;
  path: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export const sidebar: { groups: SidebarGroup[] } = {
  groups: [
    {
      label: "대시보드",
      items: [{ label: "대시보드", path: "/" }],
    },
    {
      label: "모니터링",
      items: [
        { label: "Refresh 실행 현황", path: "/monitoring/status" },
        { label: "Refresh 상세 조회", path: "/monitoring/detail" },
        { label: "Refresh 로그", path: "/monitoring/log" },
      ],
    },
    {
      label: "분석",
      items: [
        { label: "실행/실패 통계", path: "/analytics/stats" },
        { label: "데이터셋별 처리량", path: "/analytics/throughput" },
        { label: "Top N 분석", path: "/analytics/top-n" },
      ],
    },
    {
      label: "설정",
      items: [
        { label: "연결 정보", path: "/settings/connection" },
        { label: "알림 설정", path: "/settings/notification" },
        { label: "사용자 관리", path: "/settings/user" },
      ],
    },
  ],
};

/** Refresh 상태값 라벨 (Requirements 13.3, 15.2) */
export const status = {
  all: "전체",
  success: "성공",
  failed: "실패",
  in_progress: "진행중",
  unknown: "알 수 없음",
} as const;

/** 필터 영역 (Requirement 13.1) */
export const filter = {
  period: "기간",
  from: "시작일시",
  to: "종료일시",
  workspace: "Workspace",
  report: "Report",
  dataset: "Dataset",
  status: "상태",
  search: "조회",
  all: "전체",
} as const;

/** KPI 카드 (Requirement 14.1) */
export const kpi = {
  total: "전체 건수",
  success: "성공",
  failed: "실패",
  inProgress: "진행중",
  averageDuration: "평균 소요 시간",
  longestRun: "가장 오래 걸린 리포트",
  lastCompleted: "최근 완료 시각",
} as const;

/** 상세 테이블 컬럼 (Requirement 18.1) */
export const table = {
  index: "순번",
  reportName: "리포트명",
  datasetName: "데이터셋명",
  refreshType: "Refresh Type",
  status: "상태",
  scheduledTime: "예약 시각",
  startTime: "시작 시각",
  endTime: "종료 시각",
  duration: "소요 시간",
  requestId: "Request ID",
  errorMessage: "오류 메시지",
  searchPlaceholder: "리포트명 또는 데이터셋명 검색",
  failedOnly: "실패만",
  inProgressOnly: "진행중만",
  exportCsv: "CSV 내보내기",
} as const;

/** 차트 영역 (Requirement 17.1) */
export const charts = {
  longestRun: "가장 오래 걸린 리포트",
  longestRunTop: "가장 오래 걸린 리포트 TOP 5",
  durationByReport: "리포트별 소요 시간",
  hourlyTrend: "시간대별 추이",
  statusRatio: "성공/실패 비율",
  failedRuns: "실패·경고 리포트",
} as const;

/** 우측 실행 흐름 패널 (Requirement 16) */
export const flow = {
  title: "실행 흐름",
  empty: "오늘 실행된 항목이 없습니다.",
} as const;

/** Gantt 타임테이블 (Requirement 15) */
export const gantt = {
  title: "Refresh 타임테이블",
  now: "현재",
  noData: "표시할 데이터가 없습니다.",
} as const;

/** 공통/상태 메시지 */
export const common = {
  loading: "불러오는 중...",
  noData: "데이터가 없습니다.",
  noDataset: "데이터셋 없음",
  retry: "재시도",
  error: "오류가 발생했습니다.",
  errorBackend: "데이터를 불러오지 못했습니다. 다시 시도해 주세요.",
  errorPowerBi: "Power BI 연결에 문제가 발생했습니다",
  collectEnqueued: "수집 작업을 시작했습니다.",
  collectAlreadyRunning: "이미 수집이 실행 중입니다.",
} as const;

/** 페이지 제목 */
export const pages = {
  dashboard: "대시보드",
  refreshStatus: "Refresh 실행 현황",
  refreshDetail: "Refresh 상세 조회",
  refreshLog: "Refresh 로그",
  executionStats: "실행/실패 통계",
  datasetThroughput: "데이터셋별 처리량",
  topN: "Top N 분석",
  connection: "연결 정보",
  notification: "알림 설정",
  user: "사용자 관리",
  comingSoon: "준비 중입니다.",
} as const;

/** 단일 진입점 객체 */
export const ko = {
  app,
  header,
  sidebar,
  status,
  filter,
  kpi,
  table,
  charts,
  flow,
  gantt,
  common,
  pages,
} as const;

export default ko;
