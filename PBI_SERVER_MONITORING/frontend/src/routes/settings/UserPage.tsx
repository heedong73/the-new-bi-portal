/**
 * 사용자 관리 (`/settings/user`).
 *
 * 후속 task에서 사용자/권한 관리로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "../PageStub";

export default function UserPage() {
  return <PageStub title={ko.pages.user} />;
}
