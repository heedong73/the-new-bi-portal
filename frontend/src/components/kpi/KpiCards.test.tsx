/**
 * KpiCards 단위 테스트.
 *
 *  - 핵심 상태 KPI 4개가 렌더되는지
 *  - SummaryOut 값이 카드에 반영되는지
 *  - inProgress > 0이면 진행중 카드가 시각적으로 강조되는지
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
  averageDurationSeconds: 145,
  longestRun: { reportName: "매출 일일 보고", durationSeconds: 3725 },
  lastCompletedAtLocal: "2025-01-15T13:42:11+09:00",
};

describe("KpiCards", () => {
  it("핵심 상태 KPI 4개만 렌더한다", () => {
    render(<KpiCards summary={baseSummary} />);
    expect(screen.getByText(ko.kpi.total)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.success)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.failed)).toBeInTheDocument();
    expect(screen.getByText(ko.kpi.inProgress)).toBeInTheDocument();
    expect(screen.queryByText(ko.kpi.averageDuration)).not.toBeInTheDocument();
    expect(screen.queryByText(ko.kpi.longestRun)).not.toBeInTheDocument();
    expect(screen.queryByText(ko.kpi.lastCompleted)).not.toBeInTheDocument();
  });

  it("summary 값을 카드에 반영한다", () => {
    render(<KpiCards summary={baseSummary} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("inProgress > 0이면 진행중 카드를 강조한다", () => {
    render(<KpiCards summary={baseSummary} />);
    const label = screen.getByText(ko.kpi.inProgress);
    const card = label.closest("div.rounded-lg");
    expect(card?.className).toContain("ring-amber-300");
  });

  it("inProgress = 0이면 진행중 카드를 강조하지 않는다", () => {
    render(<KpiCards summary={{ ...baseSummary, inProgress: 0 }} />);
    const label = screen.getByText(ko.kpi.inProgress);
    const card = label.closest("div.rounded-lg");
    expect(card?.className).not.toContain("ring-amber-300");
  });
});
