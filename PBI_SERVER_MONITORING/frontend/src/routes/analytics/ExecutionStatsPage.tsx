/**
 * 실행/실패 통계 (`/analytics/stats`).
 *
 * 후속 task에서 기간별 실행/실패 통계 분석으로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "../PageStub";

export default function ExecutionStatsPage() {
  return <PageStub title={ko.pages.executionStats} />;
}
