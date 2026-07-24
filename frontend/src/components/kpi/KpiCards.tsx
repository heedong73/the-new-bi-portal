/**
 * Refresh 실행 현황의 핵심 상태 KPI.
 *
 * 운영자가 즉시 판단해야 하는 전체·성공·실패·진행중만 표시한다.
 * 실패 카드는 선택적으로 하단 실패·경고 목록으로 이동하는 액션을 제공한다.
 */
import {
  CheckCircle2,
  LayoutGrid,
  Loader2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import ko from "@/i18n/ko";
import type { SummaryOut } from "@/types/refresh";

export interface KpiCardsProps {
  /** 표시 중인 Refresh 실행의 요약 값. */
  summary: SummaryOut;
  /** 실패 KPI 선택 시 호출되는 이동 액션. */
  onFailedClick?: () => void;
}

interface CardTheme {
  iconBg: string;
  iconColor: string;
}

const NEUTRAL: CardTheme = { iconBg: "bg-slate-100", iconColor: "text-slate-500" };
const SUCCESS: CardTheme = { iconBg: "bg-emerald-100", iconColor: "text-emerald-600" };
const FAILED: CardTheme = { iconBg: "bg-red-100", iconColor: "text-red-600" };
const IN_PROGRESS: CardTheme = { iconBg: "bg-amber-100", iconColor: "text-amber-600" };

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  theme: CardTheme;
  highlight?: boolean;
  pulse?: boolean;
  onClick?: () => void;
  actionLabel?: string;
}

function KpiCard({
  label,
  value,
  icon: Icon,
  theme,
  highlight,
  pulse,
  onClick,
  actionLabel,
}: KpiCardProps) {
  const containerClass = highlight
    ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300"
    : "border-slate-200 bg-white";
  const className =
    "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left shadow-sm transition-colors " +
    containerClass;
  const content = (
    <>
      <span
        className={
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
          theme.iconBg
        }
      >
        <Icon
          className={theme.iconColor + (pulse ? " animate-spin" : "")}
          size={16}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold leading-4 text-slate-500">
          {label}
        </span>
        <span className="block truncate text-base font-semibold leading-5 text-slate-800">
          {value}
        </span>
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={actionLabel}
        title={actionLabel}
        className={`${className} w-full cursor-pointer hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

export default function KpiCards({ summary, onFailedClick }: KpiCardsProps) {
  const inProgressActive = summary.inProgress > 0;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <KpiCard
        label={ko.kpi.total}
        value={String(summary.total)}
        icon={LayoutGrid}
        theme={NEUTRAL}
      />
      <KpiCard
        label={ko.kpi.success}
        value={String(summary.success)}
        icon={CheckCircle2}
        theme={SUCCESS}
      />
      <KpiCard
        label={ko.kpi.failed}
        value={String(summary.failed)}
        icon={XCircle}
        theme={FAILED}
        onClick={onFailedClick}
        actionLabel={`${ko.kpi.failed} ${summary.failed}건, ${ko.charts.failedRuns}로 이동`}
      />
      <KpiCard
        label={ko.kpi.inProgress}
        value={String(summary.inProgress)}
        icon={Loader2}
        theme={IN_PROGRESS}
        highlight={inProgressActive}
        pulse={inProgressActive}
      />
    </div>
  );
}
