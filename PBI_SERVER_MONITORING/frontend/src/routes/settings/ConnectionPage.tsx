/**
 * 연결 정보 (`/settings/connection`).
 *
 * 후속 task에서 Power BI Workspace 연결/모드(Mock/Live) 설정으로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "../PageStub";

export default function ConnectionPage() {
  return <PageStub title={ko.pages.connection} />;
}
