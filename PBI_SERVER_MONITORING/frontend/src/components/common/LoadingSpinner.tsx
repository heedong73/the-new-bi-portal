/**
 * 로딩 스피너 (공통 컴포넌트).
 *
 * design.md "Frontend 디렉터리 구조(common/LoadingSpinner.tsx)".
 * 데이터 로딩 중 표시하는 간단한 스피너다. 단계 1(mock)에서는 즉시 데이터가
 * 준비되므로 거의 쓰이지 않지만, 단계 7에서 TanStack Query의 isLoading 상태에
 * 연결하기 위해 미리 마련한다.
 *
 * lucide-react의 Loader2 아이콘에 Tailwind animate-spin을 적용한다.
 */
import { Loader2 } from "lucide-react";
import ko from "@/i18n/ko";

export interface LoadingSpinnerProps {
  /** 스피너 아이콘 크기(px). 기본 24 */
  size?: number;
  /** 보조 라벨. 기본 ko.common.loading. 빈 문자열이면 라벨 미표시 */
  label?: string;
  /** 컨테이너에 적용할 추가 클래스 */
  className?: string;
}

export default function LoadingSpinner({
  size = 24,
  label = ko.common.loading,
  className = "",
}: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex items-center justify-center gap-2 py-8 text-sm text-slate-500 " + className
      }
    >
      <Loader2 className="animate-spin text-slate-400" size={size} aria-hidden="true" />
      {label !== "" && <span>{label}</span>}
    </div>
  );
}
