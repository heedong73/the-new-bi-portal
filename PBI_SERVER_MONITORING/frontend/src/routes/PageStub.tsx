/**
 * 라우트 페이지 스텁 공통 컴포넌트.
 *
 * design.md "라우팅 ↔ 사이드바 매핑"의 경로 중 메인(RefreshStatusPage)을 제외한
 * 화면은 후속 task에서 확장된다. 그 전까지는 제목 + "준비 중" 안내만 표시하여
 * 모든 경로가 mock fixture만으로도 정상 렌더되도록 한다(빈 화면/에러 방지).
 */
import ko from "@/i18n/ko";

export interface PageStubProps {
  /** 페이지 제목 (ko.pages.*) */
  title: string;
  /** 보조 설명. 기본 ko.pages.comingSoon */
  description?: string;
}

export default function PageStub({ title, description = ko.pages.comingSoon }: PageStubProps) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  );
}
