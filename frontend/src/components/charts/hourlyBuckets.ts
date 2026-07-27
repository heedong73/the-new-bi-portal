/**
 * 시간대별 추이(HourlyTrendChart)와 상세 테이블 필터가 공유하는 30분 버킷 유틸.
 *
 * 컴포넌트 파일에서 비(非)컴포넌트 값을 export 하면 Fast Refresh가 제한되므로
 * (react-refresh/only-export-components), 순수 함수/상수는 이 모듈에 모아 둔다.
 *
 * 버킷 인덱스는 0~47이며 00:00, 00:30, … 23:30 (24시간 × 2)에 대응한다.
 * 타임존 재변환 없이 Backend가 보낸 local 벽시계 시각의 `HH:mm`만 사용한다(R7.5).
 */

/** 하루 30분 버킷 개수 (24시간 × 2) */
export const BUCKETS = 48;

/**
 * local ISO 문자열에서 30분 버킷 인덱스(0~47)를 추출한다. 형식 불일치/null이면 null.
 * 오프셋 재해석 없이 ISO 문자열의 `HH:mm` 부분만 읽는다.
 */
export function extractBucket(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23) return null;
  return h * 2 + (min >= 30 ? 1 : 0);
}

/** 버킷 인덱스 → "HH:mm" 라벨 */
export function bucketLabel(idx: number): string {
  const h = Math.floor(idx / 2);
  const mm = idx % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${mm}`;
}

/** 버킷 인덱스 → "HH:mm–HH:mm" 범위 라벨 (선택 칩 표시용). */
export function bucketRangeLabel(idx: number): string {
  return `${bucketLabel(idx)}–${bucketLabel((idx + 1) % BUCKETS)}`;
}

/** "HH:mm" 축 라벨 → 버킷 인덱스(0~47). 파싱 실패 시 null. */
export function labelToBucket(
  label: string | number | undefined | null
): number | null {
  if (label == null) return null;
  const m = String(label).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23) return null;
  return h * 2 + (min >= 30 ? 1 : 0);
}
