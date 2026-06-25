/**
 * local ISO 문자열 파싱/포맷 유틸 (Requirement 7.5).
 *
 * Backend는 시각을 ISO 8601 문자열로 직렬화하며, local 시각은 `...+09:00`
 * (Asia/Seoul) 오프셋을 포함한다. 화면에는 Backend가 준 local 시각을 **추가
 * 타임존 변환 없이 그대로** 표시해야 한다 (Requirement 7.5).
 *
 * date-fns의 `parseISO`는 오프셋을 해석하여 실행 브라우저의 로컬 타임존으로
 * 재변환하므로, KST 외 타임존 브라우저에서는 화면 시각이 어긋날 수 있다.
 * 따라서 표시용 포맷은 GanttTooltip에서 쓰던 방식과 동일하게 ISO 문자열의
 * "날짜/시각 부분"만 정규식으로 추출하여, 오프셋과 무관하게 Backend가 보낸
 * 벽시계 시각(wall-clock)을 그대로 보여준다.
 *
 * `parseLocal`은 정렬 등 시각 비교가 필요할 때를 위한 절대 시각(`Date`) 파서이며,
 * 이때만 date-fns `parseISO`(오프셋 인지)를 사용한다. 표시(format*)와 비교(parse)의
 * 책임을 분리한다.
 *
 * total function: null/빈 문자열/비정상 입력에도 예외 없이 graceful 하게 처리한다
 * (포맷 계열은 "-" 반환, parseLocal은 null 반환).
 */
import { parseISO } from "date-fns";

/** 입력값이 없거나 표시 불가일 때 사용하는 placeholder */
export const EMPTY_DISPLAY = "-";

/**
 * Asia/Seoul(KST) 고정 오프셋(ms). KST는 DST가 없어 항상 UTC+9이므로
 * Intl 없이 고정 오프셋으로 벽시계 시각을 정확히 계산할 수 있다.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 절대 epoch ms를 KST 벽시계 `HH:mm`으로 반환한다 (Gantt X축 라벨/tick용).
 *
 * 핵심: 오프셋을 더한 뒤 `getUTC*` 게터로 읽으면 브라우저(컨테이너) 로컬
 * 타임존과 무관하게 KST 벽시계 시각이 된다. 컨테이너가 UTC여도 정확하다.
 *
 * @param ms 절대 epoch ms
 * @returns KST 기준 `HH:mm`
 */
export function formatKstHourMinute(ms: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(ms + KST_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * ISO 8601 문자열에서 날짜/시각 구성요소를 정규식으로 추출한다.
 * 오프셋(`Z` / `+09:00`)은 의도적으로 무시하여 추가 타임존 변환을 하지 않는다.
 *
 * @returns `{ date: "YYYY-MM-DD", time: "HH:mm:ss" }` 또는 매칭 실패 시 null
 */
function extractParts(iso: string): { date: string; time: string } | null {
  // 날짜 + 시각(초는 선택). 예: 2025-01-15T13:42:11+09:00 / 2025-01-15 13:42
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const date = m[1];
  const time = `${m[2]}:${m[3] ?? "00"}`;
  return { date, time };
}

/**
 * local ISO 문자열을 `YYYY-MM-DD HH:mm:ss` 형식으로 표시한다.
 * 타임존 재변환 없이 ISO 문자열의 벽시계 시각을 그대로 보여준다 (Requirement 7.5).
 *
 * @param iso local ISO 문자열 (`...+09:00`) 또는 null
 * @returns 포맷 문자열. 입력이 없거나 형식 불일치 시 원본 또는 "-"
 */
export function formatLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_DISPLAY;
  const parts = extractParts(iso);
  if (!parts) return iso;
  return `${parts.date} ${parts.time}`;
}

/**
 * local ISO 문자열에서 시각 부분(`HH:mm:ss`)만 표시한다.
 * 우측 실행 흐름 패널 등 날짜가 자명한 컨텍스트에서 사용한다 (Requirement 16.1).
 *
 * @param iso local ISO 문자열 또는 null
 * @returns `HH:mm:ss`. 입력이 없거나 형식 불일치 시 "-"
 */
export function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_DISPLAY;
  const parts = extractParts(iso);
  if (!parts) return EMPTY_DISPLAY;
  return parts.time;
}

/**
 * local ISO 문자열에서 날짜 부분(`YYYY-MM-DD`)만 표시한다.
 *
 * @param iso local ISO 문자열 또는 null
 * @returns `YYYY-MM-DD`. 입력이 없거나 형식 불일치 시 "-"
 */
export function formatLocalDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY_DISPLAY;
  const parts = extractParts(iso);
  if (!parts) return EMPTY_DISPLAY;
  return parts.date;
}

/**
 * ISO 8601 문자열을 절대 시각(`Date`)으로 파싱한다.
 * 정렬/비교 등 "절대 순간"이 필요한 경우에만 사용한다. 표시에는 format* 계열을 쓴다.
 *
 * date-fns `parseISO`는 오프셋을 인지하여 동일 절대 시각의 `Date`를 만든다.
 *
 * @param iso ISO 8601 문자열 또는 null
 * @returns 유효한 `Date` 또는 파싱 실패/입력 없음 시 null
 */
export function parseLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Date(또는 현재 시각)를 `YYYY-MM-DD`(로컬 벽시계 기준) 문자열로 변환한다.
 * `/api/summary?date=` · `/api/refresh-history?date=`의 date 파라미터로 사용한다.
 *
 * Backend는 APP_TIMEZONE(KST) 기준으로 일자를 해석하므로, 브라우저 로컬
 * 타임존이 KST인 운영 환경에서는 벽시계 날짜가 그대로 일치한다.
 *
 * @param d 대상 Date. 생략 시 현재 시각(오늘)
 * @returns `YYYY-MM-DD`
 */
export function toDateParam(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 두 ISO 문자열을 절대 시각 기준으로 비교한다 (정렬 comparator용).
 * 파싱 불가/null은 가장 과거로 취급한다.
 *
 * @returns a < b 이면 음수, a > b 이면 양수, 동일하면 0
 */
export function compareIsoAsc(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const da = parseLocal(a);
  const db = parseLocal(b);
  const ta = da ? da.getTime() : -Infinity;
  const tb = db ? db.getTime() : -Infinity;
  if (ta === tb) return 0;
  return ta < tb ? -1 : 1;
}
