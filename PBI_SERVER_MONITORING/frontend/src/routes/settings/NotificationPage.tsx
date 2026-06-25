/**
 * 알림 설정 (`/settings/notification`).
 *
 * 후속 task에서 실패 알림 채널/규칙 설정으로 확장된다. 현재는 스텁.
 */
import ko from "@/i18n/ko";
import PageStub from "../PageStub";

export default function NotificationPage() {
  return <PageStub title={ko.pages.notification} />;
}
