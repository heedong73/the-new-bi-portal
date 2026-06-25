/**
 * Refresh 로그 (`/monitoring/log`).
 *
 * 후속 task에서 수집/실행 로그 타임라인으로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "./PageStub";

export default function RefreshLogPage() {
  return <PageStub title={ko.pages.refreshLog} />;
}
