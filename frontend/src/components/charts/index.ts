/**
 * 하단 분석 카드 묶음 export.
 *
 * 상위 페이지에서 단일 진입점으로 import하기 위한 barrel 모듈.
 *   - LongestRunCard:  가장 오래 걸린 리포트 TOP 5 (runs 기반)
 *   - HourlyTrendChart: 시간대별 추이 line chart, 30분 단위 (runs 기반)
 *   - FailedRunsCard:  실패·경고 리포트 목록 (runs 기반)
 */
export { default as LongestRunCard } from "./LongestRunCard";
export type { LongestRunCardProps } from "./LongestRunCard";

export { default as HourlyTrendChart } from "./HourlyTrendChart";
export type { HourlyTrendChartProps } from "./HourlyTrendChart";

export { default as FailedRunsCard } from "./FailedRunsCard";
export type { FailedRunsCardProps } from "./FailedRunsCard";
