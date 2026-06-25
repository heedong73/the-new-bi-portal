/**
 * Refresh 상세 조회 (`/monitoring/detail`).
 *
 * 후속 task에서 단일 Refresh_Run 상세/원본 JSON 조회로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "./PageStub";

export default function RefreshDetailPage() {
  return <PageStub title={ko.pages.refreshDetail} />;
}
