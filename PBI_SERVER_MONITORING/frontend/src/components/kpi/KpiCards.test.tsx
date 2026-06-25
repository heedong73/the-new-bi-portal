/**
 * KpiCards 단위 테스트 (Requirements 14.1, 14.2, 14.3).
 *
 *  - 7개 카드 라벨이 모두 렌더되는지
 *  - SummaryOut 값이 카드에 반영되는지 (전체/성공/실패/진행중, 평균/최장 소요시간, 최근 완료)
 *  - inProgress > 0이면 진행중 카드가 시각적으로 강조되는지
 *  - longestRun / lastCompletedAtLocal 가 null일 때 graceful 처리되는지
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import KpiCards from "./KpiCards";
import ko from "@/i18n/ko";
import type { SummaryOut } from "@/types/refresh";

const baseSummary: SummaryOut = {
  total: 42,
  success: 38,
  failed: 3,
  inProgress: 1,
  averageDurationSeconds: 145, // → "02:25"
  longestRun: { reportName: "매출 일일 보고", durationSeconds: 3725 }, // → "1시간 2분"
  lastCompletedAtLocal: "2025-01-15T13:42:11+09:00",
};

describe("KpiCards", () => {
  it("7개 KPI 카드 라벨을 모두 렌더한다 (14.1)", () => {
    render(<KpiCards summary={baseSummary} />);
    expect(screen.getByText(ko.kpi.total)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.success)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.failed)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.inProgress)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.averageDuration)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.longestRun)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.lastCompleted)).toBeInTheDocument();
  });

  it("summary 값을 카드에 반영한다 (14.2)", () => {
    render(<KpiCards summary={baseSummary} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("02:25")).toBeInTheDocument(); // 평균 소요 시간
    expect(screen.getByText("매출 일일 보고")).toBeInTheDocument();
    expect(screen.getByText("1시간 2분")).toBeInTheDocument(); // 최장 소요 시간
    expect(screen.getByText("2025-01-15 13:42:11")).toBeInTheDocument();
  });

  it("inProgress > 0이면 진행중 카드를 강조한다 (14.3)", () => {
    render(<KpiCards summary={baseSummary} />);
    const label = screen.getByText(ko.kpi.inProgress);
    const card = label.closest("div.rounded-lg");
    expect(card?.className).toContain("ring-amber-300");
  });

  it("inProgress = 0이면 진행중 카드를 강조하지 않는다 (14.3)", () => {
    render(<KpiCards summary={{ ...baseSummary, inProgress: 0 }} />);
    const label = screen.getByText(ko.kpi.inProgress);
    const card = label.closest("div.rounded-lg");
    expect(card?.className).not.toContain("ring-amber-300");
  });

  it("longestRun이 null이면 graceful 처리한다", () => {
    render(<KpiCards summary={{ ...baseSummary, longestRun: null }} />);
    const label = screen.getByText(ko.kpi.longestRun);
    const card = label.closest("div.rounded-lg");
    expect(card).toHaveTextContent("-");
  });

  it("lastCompletedAtLocal이 null이면 '-'를 표시한다", () => {
    render(<KpiCards summary={{ ...baseSummary, lastCompletedAtLocal: null }} />);
    const label = screen.getByText(ko.kpi.lastCompleted);
    const card = label.closest("div.rounded-lg");
    expect(card).toHaveTextContent("-");
  });
});
