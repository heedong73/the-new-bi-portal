/**
 * 데이터셋별 처리량 (`/analytics/throughput`).
 *
 * 후속 task에서 Dataset 단위 처리량/소요 시간 분석으로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "../PageStub";

export default function DatasetThroughputPage() {
  return <PageStub title={ko.pages.datasetThroughput} />;
}
