/**
 * CSV 내보내기 유틸 (Requirement 18.5).
 *
 * design.md "CSV 내보내기(utils/csv.ts)" 예시를 따른다.
 *   - 헤더(한국어 컬럼명) + 현재 화면에 표시된(필터/정렬 적용된) 행
 *   - UTF-8 BOM(`\uFEFF`)을 선두에 포함하여 Excel에서 한글이 깨지지 않게 한다
 *   - CSV escape: 값에 쉼표/큰따옴표/줄바꿈이 포함되면 큰따옴표로 감싸고
 *     내부 큰따옴표는 `""`로 이스케이프한다 (RFC 4180)
 *
 * 테스트 용이성을 위해 순수 문자열 생성(`buildCsv`)과 브라우저 다운로드 트리거
 * (`downloadCSV`)를 분리한다. property 테스트(task 1.13)는 `buildCsv`/`buildCsvString`의
 * 결과 문자열(BOM 선두, 줄 수 = header + rows)을 검증한다.
 *
 * 컬럼 라벨은 i18n(ko.table)을 단일 출처로 사용하여 RefreshTable의 표시 컬럼과
 * 일치시킨다 (Requirement 18.1).
 */
import ko from "@/i18n/ko";
import type { RefreshRunOut } from "@/types/refresh";
import { formatLocalDateTime } from "@/utils/date";
import { formatDuration } from "@/utils/duration";

/** UTF-8 BOM (Requirement 18.5) */
export const BOM = "\uFEFF";

/**
 * CSV 헤더(한국어 컬럼명). RefreshTable 표시 컬럼 순서와 동일하다.
 * design.md 예시 및 Requirement 18.1 컬럼 목록과 일치한다.
 */
export const CSV_HEADERS: readonly string[] = [
  ko.table.index, // 순번
  ko.table.reportName, // 리포트명
  ko.table.datasetName, // 데이터셋명
  ko.table.refreshType, // Refresh Type
  ko.table.status, // 상태
  ko.table.scheduledTime, // 예약 시각
  ko.table.startTime, // 시작 시각
  ko.table.endTime, // 종료 시각
  ko.table.duration, // 소요 시간
  ko.table.requestId, // Request ID
  ko.table.errorMessage, // 오류 메시지
];

/**
 * 단일 CSV 필드를 escape 한다 (RFC 4180).
 * 쉼표/큰따옴표/줄바꿈(\n, \r)이 포함되면 큰따옴표로 감싸고,
 * 내부 큰따옴표는 두 개(`""`)로 치환한다.
 *
 * total function: null/undefined/숫자 등 어떤 입력도 문자열로 안전하게 처리한다.
 */
export function escapeCsvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * 진행중 행의 소요 시간 표시값을 계산한다.
 *
 * 종료 시각이 없는 진행중 행은 durationSeconds가 null일 수 있으므로,
 * - durationSeconds가 숫자면 formatDuration으로 포맷
 * - null이면 "-" (placeholder)로 표시한다.
 *
 * 동적(현재 시각 기준) 계산은 화면 표시(RefreshTable)에서 수행하며, CSV는
 * 내보내는 시점의 스냅샷 값을 그대로 직렬화한다.
 */
function formatDurationCell(seconds: number | null): string {
  if (seconds == null) return "-";
  return formatDuration(seconds);
}

/**
 * 단일 Refresh_Run을 CSV 한 행(필드 배열, escape 전 원시값)으로 변환한다.
 *
 * @param run  대상 Refresh_Run
 * @param index 0-기반 인덱스 (순번은 index + 1)
 */
export function runToCsvRow(run: RefreshRunOut, index: number): string[] {
  return [
    String(index + 1),
    run.reportName ?? "",
    run.datasetName ?? "",
    run.refreshType ?? "",
    ko.status[run.status],
    formatLocalDateTime(run.scheduledTimeLocal ?? null),
    formatLocalDateTime(run.startTimeLocal),
    formatLocalDateTime(run.endTimeLocal),
    formatDurationCell(run.durationSeconds),
    run.requestId ?? "",
    run.errorMessage ?? "",
  ];
}

/**
 * 행 배열을 CSV 본문 문자열로 직렬화한다 (BOM 미포함).
 * 헤더 + 각 행을 `\r\n`(CRLF, RFC 4180 권장)으로 연결한다.
 *
 * 줄 수 invariant: 반환 문자열을 `\r\n`로 split하면 길이는 `1 + rows.length`이다
 * (헤더 1줄 + 데이터 행 수).
 */
export function buildCsvString(rows: RefreshRunOut[]): string {
  const lines: string[] = [CSV_HEADERS.map(escapeCsvField).join(",")];
  rows.forEach((run, i) => {
    lines.push(runToCsvRow(run, i).map(escapeCsvField).join(","));
  });
  return lines.join("\r\n");
}

/**
 * BOM을 포함한 완전한 CSV 문자열을 생성한다 (Requirement 18.5).
 *
 * property 테스트 대상: 결과는 항상 BOM(`\uFEFF`)으로 시작하고,
 * BOM 제거 후 `\r\n` 기준 줄 수는 header(1) + rows.length 이다.
 *
 * @param rows 현재 화면에 표시된(필터/정렬 적용된) 행
 */
export function buildCsv(rows: RefreshRunOut[]): string {
  return BOM + buildCsvString(rows);
}

/**
 * 현재 표시 행을 UTF-8 BOM 포함 CSV 파일로 다운로드한다 (Requirement 18.5).
 *
 * 순수 문자열 생성은 `buildCsv`에 위임하고, 본 함수는 Blob 생성 + `<a>` 태그
 * 클릭으로 다운로드를 트리거하는 DOM 사이드이펙트만 담당한다. 비브라우저
 * 환경(예: 테스트)에서 `document`가 없으면 아무 동작도 하지 않는다.
 *
 * @param rows     내보낼 행 (필터/정렬 적용 후 화면 표시 행)
 * @param filename 다운로드 파일명 (예: "refresh-history.csv")
 */
export function downloadCSV(rows: RefreshRunOut[], filename: string): void {
  const content = buildCsv(rows);

  if (typeof document === "undefined" || typeof URL === "undefined") {
    return;
  }

  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default downloadCSV;
