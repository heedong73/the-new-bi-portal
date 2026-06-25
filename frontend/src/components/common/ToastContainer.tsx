/**
 * Toast 표시 컨테이너.
 *
 * `useToastStore`에 쌓인 toast를 화면 우하단에 고정 렌더한다. 자동 사라짐은
 * store(setTimeout)가 담당하므로 본 컴포넌트는 표시/수동 닫기만 다룬다.
 *
 * 즉시 수집(Requirement 10.1) 결과 안내 등 비차단적 일시 알림에 사용한다.
 * App 루트에 한 번 마운트한다.
 */
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useToastStore, type ToastType } from "@/stores/useToastStore";

/** 종류별 스타일/아이콘 매핑. */
const TOAST_STYLE: Record<
  ToastType,
  { container: string; icon: typeof Info }
> = {
  success: {
    container: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2,
  },
  error: {
    container: "border-red-200 bg-red-50 text-red-700",
    icon: AlertTriangle,
  },
  info: {
    container: "border-slate-200 bg-white text-slate-700",
    icon: Info,
  },
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLE[toast.type];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex min-w-[16rem] max-w-sm items-start gap-2.5 rounded-md border px-4 py-3 text-sm shadow-md ${style.container}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 break-words font-medium">
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="닫기"
              className="shrink-0 rounded p-0.5 text-current/70 transition-colors hover:bg-black/5"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
