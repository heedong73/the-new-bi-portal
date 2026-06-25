/**
 * KPI 카드 (Requirements 14.1, 14.2, 14.3).
 *
 * `GET /api/summary` 응답(`SummaryOut`)을 prop으로 받아 7개 지표 카드를 렌더하는
 * 순수 표시 컴포넌트다. 데이터 소스(mock fixture의 getMockSummary 또는 단계 7의
 * useSummary 훅)는 상위 페이지(task 1.14)에서 주입하며, 이 컴포넌트는 어떤 모드인지
 * 알 필요가 없다.
 *
 * 7개 카드 (Requirement 14.1):
 *   1. 전체 건수            total
 *   2. 성공                success
 *   3. 실패                failed
 *   4. 진행중              inProgress  ← 0보다 크면 시각적 강조 (Requirement 14.3)
 *   5. 평균 소요 시간       averageDurationSeconds  (formatDuration)
 *   6. 가장 오래 걸린 리포트 longestRun  (리포트명 + 소요 시간, null 시 graceful)
 *   7. 최근 완료 시각       lastCompletedAtLocal  (date-fns format, null 시 "-")
 *
 * 소요 시간은 utils/duration.ts 의 formatDuration(초 → "H시간 m분"/"mm:ss")을 사용한다.
 */
import { useMemo } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  LayoutGrid,
  Loader2,
  Timer,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import ko from "@/i18n/ko";
import { formatDuration } from "@/utils/duration";
import type { SummaryOut } from "@/types/refresh";

export interface KpiCardsProps {
  /** `GET /api/summary` 응답. 상위 페이지에서 주입한다. */
  summary: SummaryOut;
}

/** 카드 색상 테마 (Tailwind 클래스 조합) */
interface CardTheme {
  /** 아이콘 배경 */
  iconBg: string;
  /** 아이콘 색상 */
  iconColor: string;
}

const NEUTRAL: CardTheme = { iconBg: "bg-slate-100", iconColor: "text-slate-500" };
const SUCCESS: CardTheme = { iconBg: "bg-emerald-100", iconColor: "text-emerald-600" };
const FAILED: CardTheme = { iconBg: "bg-red-100", iconColor: "text-red-600" };
const IN_PROGRESS: CardTheme = { iconBg: "bg-amber-100", iconColor: "text-amber-600" };
const INFO: CardTheme = { iconBg: "bg-indigo-100", iconColor: "text-indigo-600" };

/**
 * 최근 완료 시각(local ISO 문자열)을 보기 좋은 형식으로 변환한다.
 * null이거나 파싱 불가하면 "-"를 반환한다 (Requirement 14.1 graceful 처리).
 */
function formatLastCompleted(iso: string | null): string {
  if (!iso) return "-";
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return format(d, "yyyy-MM-dd HH:mm:ss");
  } catch {
    return "-";
  }
}

/** 단일 KPI 카드 */
interface KpiCardProps {
  label: string;
  value: string;
  /** 보조 설명(가장 오래 걸린 리포트의 소요 시간 등) */
  sub?: string | null;
  icon: LucideIcon;
  theme: CardTheme;
  /** 진행중 강조 여부 (Requirement 14.3) */
  highlight?: boolean;
  /** 아이콘 펄스 애니메이션 (진행중 강조 시) */
  pulse?: boolean;
}

function KpiCard({ label, value, sub, icon: Icon, theme, highlight, pulse }: KpiCardProps) {
  const containerClass = highlight
    ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300"
    : "border-slate-200 bg-white";

  return (
    <div
      className={
        "flex items-center gap-3 rounded-lg border p-4 shadow-sm transition-colors " +
        containerClass
      }
    >
      <div
        className={
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
          theme.iconBg
        }
      >
        <Icon
          className={theme.iconColor + (pulse ? " animate-spin" : "")}
          size={20}
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500">{label}</p>
        <p className="truncate text-lg font-semibold text-slate-800" title={value}>
          {value}
        </p>
        {sub != null && sub !== "" && (
          <p className="truncate text-xs text-slate-400" title={sub}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function KpiCards({ summary }: KpiCardsProps) {
  const inProgressActive = summary.inProgress > 0;

  // 가장 오래 걸린 리포트: null이면 "-" / "데이터 없음" graceful 처리
  const longest = summary.longestRun;
  const longestValue = longest ? longest.reportName : "-";
  const longestSub = longest ? formatDuration(longest.durationSeconds) : ko.common.noData;

  const lastCompleted = useMemo(
    () => formatLastCompleted(summary.lastCompletedAtLocal),
    [summary.lastCompletedAtLocal]
  );

  return (
    <div className="grid grid-cols-2 gap-3 px-6 py-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {/* 1. 전체 건수 */}
      <KpiCard
        label={ko.kpi.total}
        value={String(summary.total)}
        icon={LayoutGrid}
        theme={NEUTRAL}
      />

      {/* 2. 성공 */}
      <KpiCard
        label={ko.kpi.success}
        value={String(summary.success)}
        icon={CheckCircle2}
        theme={SUCCESS}
      />

      {/* 3. 실패 */}
      <KpiCard
        label={ko.kpi.failed}
        value={String(summary.failed)}
        icon={XCircle}
        theme={FAILED}
      />

      {/* 4. 진행중 — inProgress > 0이면 강조 (Requirement 14.3) */}
      <KpiCard
        label={ko.kpi.inProgress}
        value={String(summary.inProgress)}
        icon={Loader2}
        theme={IN_PROGRESS}
        highlight={inProgressActive}
        pulse={inProgressActive}
      />

      {/* 5. 평균 소요 시간 */}
      <KpiCard
        label={ko.kpi.averageDuration}
        value={formatDuration(summary.averageDurationSeconds)}
        icon={Clock}
        theme={INFO}
      />

      {/* 6. 가장 오래 걸린 리포트 */}
      <KpiCard
        label={ko.kpi.longestRun}
        value={longestValue}
        sub={longestSub}
        icon={Timer}
        theme={INFO}
      />

      {/* 7. 최근 완료 시각 */}
      <KpiCard
        label={ko.kpi.lastCompleted}
        value={lastCompleted}
        icon={CalendarCheck}
        theme={NEUTRAL}
      />
    </div>
  );
}
