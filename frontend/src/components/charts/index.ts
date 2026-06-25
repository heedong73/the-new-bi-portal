/**
 * 하단 분석 차트 묶음 export (Requirement 17.1: 4개 시각화).
 *
 * 상위 페이지(task 1.14)에서 단일 진입점으로 import하기 위한 barrel 모듈.
 *   - LongestRunCard:   가장 오래 걸린 리포트 카드 (summary 기반)
 *   - DurationBarChart: 리포트별 소요 시간 bar chart (runs 기반)
 *   - HourlyTrendChart: 시간대별 추이 line chart (runs 기반)
 *   - StatusDonutChart: 성공/실패 비율 donut chart (summary 기반)
 */
export { default as LongestRunCard } from "./LongestRunCard";
export type { LongestRunCardProps } from "./LongestRunCard";

export { default as DurationBarChart } from "./DurationBarChart";
export type { DurationBarChartProps } from "./DurationBarChart";

export { default as HourlyTrendChart } from "./HourlyTrendChart";
export type { HourlyTrendChartProps } from "./HourlyTrendChart";

export { default as StatusDonutChart } from "./StatusDonutChart";
export type { StatusDonutChartProps } from "./StatusDonutChart";
