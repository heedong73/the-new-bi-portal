/**
 * 소요 시간(초) 포맷 유틸.
 *
 * design.md "Refresh Timeline" / Requirement 15.3 의 표기 규약을 따른다.
 *   - 1시간 이상: `H시간 m분`  (예: 3725초 → "1시간 2분")
 *   - 1시간 미만: `mm:ss`      (예: 145초  → "02:25")
 *
 * 이 모듈은 task 1.7(KPI 카드)에서 먼저 도입되며, task 1.9에서 Gantt 막대 라벨
 * 등 추가 사용처와 property 테스트(task 1.10)로 확장된다. 시그니처(초 단위 입력
 * → 사람이 읽는 문자열)는 고정이므로 중복 정의 없이 그대로 재사용한다.
 *
 * total function: 음수/0/비정상(NaN, Infinity) 입력에도 예외 없이 문자열을 반환한다.
 */

/** 두 자리 0 패딩 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 초 단위 소요 시간을 사람이 읽는 문자열로 변환한다.
 *
 *  - 비정상 입력(NaN/Infinity)은 `00:00`으로 방어 처리한다.
 *  - 음수는 0으로 클램프한다.
 *  - 소수 초는 내림(floor)한다.
 *
 * @param totalSeconds 소요 시간(초)
 * @returns `H시간 m분`(≥1시간) 또는 `mm:ss`(<1시간) 형식 문자열
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) {
    return "00:00";
  }
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

export default formatDuration;
