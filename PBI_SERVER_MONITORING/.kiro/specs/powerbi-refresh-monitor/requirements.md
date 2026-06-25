# Requirements Document

## Introduction

Power BI Refresh Monitor는 Power BI Embedded Workspace에 포함된 모든 Report의 데이터셋(Semantic Model) 새로고침(refresh) 현황을 웹에서 운영 모니터링용으로 시각화하는 시스템이다. 운영자는 좌측 사이드바, 상단 헤더, 필터, KPI 카드, 중앙 Gantt 타임테이블, 우측 실행 흐름 요약, 하단 분석 차트와 상세 테이블로 구성된 한국어 UI를 통해 Workspace 단위의 refresh 성공/실패/진행중 현황을 확인하고, 실패 원인과 소요 시간을 빠르게 파악할 수 있다.

본 시스템은 Power BI REST API의 Reports / Datasets / Refresh History / Refresh Schedule 엔드포인트를 호출하여 Backend의 PostgreSQL에 정규화된 데이터를 적재하고, Redis로 access token과 refresh history를 캐싱하며, Background Worker와 Scheduler로 주기적 수집을 수행한다. Power BI API의 refresh history가 Dataset 단위라는 제약을 고려하여, Reports와 Refresh History를 datasetId 기준으로 조인하여 리포트 단위의 화면을 제공한다.

본 워크플로우의 산출물은 아래 단계로 점진적으로 인도되며, 1단계는 mock data 기반으로 backend와 frontend가 동작하는 상태를 우선 구축하고, 이후 단계에서 Power BI API 실연동, PostgreSQL 영속화, Background Worker, 최종 통합 순으로 확장된다.

## Glossary

- **PRM (Power_BI_Refresh_Monitor_System)**: 본 문서가 정의하는 전체 시스템(웹 + Backend + Worker + DB + Cache).
- **Backend_API**: FastAPI 기반 REST API 서버. PRM의 데이터 조회/수집 트리거를 담당.
- **Frontend_App**: React 19 + Vite 6 + TypeScript 기반 SPA. 사용자가 사용하는 웹 UI.
- **Collector_Worker**: Power BI REST API를 호출하여 PostgreSQL에 적재하는 Background Worker (Celery 또는 RQ).
- **Scheduler**: Collector_Worker 작업을 주기적으로 트리거하는 컴포넌트 (APScheduler 또는 Celery Beat).
- **Token_Service**: Azure AD client credentials flow로 Power BI access token을 발급/갱신/캐싱하는 Backend 내부 서비스.
- **PowerBI_Client**: Backend 내부에서 Power BI REST API를 호출하는 HTTP 클라이언트 모듈.
- **Workspace**: Power BI의 group(workspace) 단위. `POWERBI_WORKSPACE_ID`로 식별.
- **Report**: Power BI의 리포트. `reportId`, `reportName`, `datasetId` 속성을 가진다.
- **Dataset**: Power BI의 데이터셋(Semantic Model). `datasetId`, `datasetName`을 가진다.
- **Refresh_Run**: Dataset의 단일 refresh 실행 이력. `requestId`로 고유 식별.
- **Refresh_Schedule**: Dataset의 예약 refresh 설정 (요일, 시각, timezone, enabled).
- **Refresh_Status**: Refresh_Run의 상태. `성공(Completed)`, `실패(Failed)`, `진행중(InProgress/Unknown)`, `알 수 없음(Disabled/기타)` 중 하나.
- **Refresh_Type**: Power BI에서 제공하는 새로고침 유형(Scheduled, OnDemand, ViaApi 등).
- **Service_Exception**: Power BI API가 실패 시 반환하는 `serviceExceptionJson` 문자열.
- **Gantt_Timetable**: 중앙 화면의 Y축=리포트명, X축=시간, 막대=Refresh_Run 인 시각화 컴포넌트.
- **KPI_Card**: 상단의 요약 지표 카드 (전체 건수, 성공, 실패, 진행중, 평균 소요 시간 등).
- **Local_Time**: `APP_TIMEZONE` (기본 `Asia/Seoul`) 기준 변환된 시각.
- **UTC_Time**: Power BI API가 반환하는 UTC 기준 시각.
- **Mock_Mode**: 외부 Power BI API를 호출하지 않고 사전 준비된 mock data로 동작하는 운영 모드.
- **Live_Mode**: 실제 Power BI REST API와 연동되어 동작하는 운영 모드.

## Requirements

### Requirement 1: 시스템 구성 및 실행 환경

**User Story:** 운영자(DevOps)로서 PRM 전체 스택을 단일 명령으로 기동하고 싶다, 그래야 로컬과 운영 환경에서 동일하게 시스템을 재현할 수 있기 때문이다.

#### Acceptance Criteria

1. THE PRM SHALL Docker Compose 파일을 통해 `backend`, `frontend`, `postgres`, `redis`, `worker`, `scheduler` 6개 서비스를 단일 정의 파일로 기동한다.
2. THE PRM SHALL 프로젝트 루트에 `.env.example` 파일을 제공하고 `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`, `POWERBI_API_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `APP_TIMEZONE` 환경 변수를 모두 포함한다.
3. THE PRM SHALL `POWERBI_API_BASE_URL`의 기본값을 `https://api.powerbi.com/v1.0/myorg`로 제공한다.
4. THE PRM SHALL `APP_TIMEZONE`의 기본값을 `Asia/Seoul`로 제공한다.
5. THE PRM SHALL 프로젝트 루트에 `README.md`를 제공하고 `.env.example` 복사 절차, Docker Compose 기동 절차, Backend/Frontend 접속 URL, Mock_Mode 와 Live_Mode 전환 방법을 한국어로 기술한다.
6. THE Backend_API SHALL Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.x async, Alembic, asyncpg, httpx 스택으로 구현된다.
7. THE Frontend_App SHALL React 19, Vite 6, TypeScript, Node.js 20 LTS, Tailwind CSS v4, TanStack Query, Zustand, React Router, Recharts, lucide-react, date-fns 또는 dayjs 스택으로 구현된다.
8. THE Backend_API SHALL `backend/app/` 하위에 `main.py`, `core/`, `db/`, `migrations/`, `models/`, `schemas/`, `services/`, `api/routes/`, `workers/` 디렉터리 구조를 제공한다.

### Requirement 2: 점진적 인도(Phased Delivery)

**User Story:** 사용자로서 외부 Power BI 자격 증명이 준비되기 전에도 UI와 백엔드 API의 동작을 검증하고 싶다, 그래야 Power BI 연동 작업이 끝나기를 기다리지 않고 화면 흐름을 먼저 확인할 수 있기 때문이다.

#### Acceptance Criteria

1. THE PRM SHALL Mock_Mode 와 Live_Mode 두 가지 운영 모드를 지원한다.
2. WHERE Mock_Mode 가 활성화된 환경 변수 또는 설정으로 기동된 경우, THE Backend_API SHALL 외부 Power BI REST API를 호출하지 않고 사전 정의된 mock data를 응답한다.
3. WHERE Mock_Mode 가 활성화된 경우, THE Frontend_App SHALL 실제 Power BI 자격 증명 없이 모든 화면을 정상 렌더링한다.
4. WHEN 사용자가 단일 환경 변수 또는 설정 값을 변경하여 Live_Mode 로 전환한 경우, THE PRM SHALL 코드 변경 없이 실제 Power BI REST API 호출 경로로 동작한다.
5. THE PRM SHALL 인도 단계를 다음 순서로 분리하여 산출물을 누적 인도한다: (1) mock data 기반 Frontend_App UI, (2) Backend_API mock endpoint, (3) PostgreSQL 모델 및 Alembic migration, (4) PowerBI_Client 구현, (5) `POST /api/collect-now` 구현, (6) Collector_Worker 와 Scheduler 구현, (7) Frontend_App 의 Backend_API 실연동, (8) `README.md` 실행 방법 최종화.
6. THE PRM SHALL 각 인도 단계 종료 시점에 이전 단계의 동작이 회귀(regression)되지 않도록 동일한 외부 인터페이스(엔드포인트 경로, 응답 스키마)를 유지한다.

### Requirement 3: Power BI 인증

**User Story:** Backend 운영자로서 Power BI REST API 호출에 필요한 access token 을 안전하고 효율적으로 발급받고 싶다, 그래야 매 호출마다 인증 비용이 발생하거나 token 만료로 호출이 실패하지 않게 할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Token_Service SHALL Azure AD client credentials flow 를 사용하여 `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` 으로 Power BI REST API access token 을 발급한다.
2. THE Token_Service SHALL 발급된 access token 을 Redis 에 캐싱하고 token 응답의 `expires_in` 보다 60초 이상 짧은 TTL 을 적용한다.
3. WHEN PowerBI_Client 가 access token 을 요청한 시점에 Redis 캐시에 유효한 token 이 존재하는 경우, THE Token_Service SHALL Azure AD 호출 없이 캐시된 token 을 반환한다.
4. IF Azure AD 토큰 발급이 실패한 경우, THEN THE Token_Service SHALL 실패 사유와 HTTP 상태 코드를 포함한 오류를 호출자에게 반환하고 Redis 에 무효한 token 을 저장하지 않는다.
5. IF Power BI REST API 호출이 HTTP 401 응답을 반환한 경우, THEN THE PowerBI_Client SHALL 캐시된 token 을 무효화하고 1회에 한해 token 을 재발급하여 호출을 재시도한다.

### Requirement 4: Power BI 데이터 수집

**User Story:** Backend 운영자로서 Workspace 의 Reports, Datasets, Refresh History, Refresh Schedule 을 주기적으로 수집하고 싶다, 그래야 화면이 항상 최신 운영 현황을 보여줄 수 있기 때문이다.

#### Acceptance Criteria

1. THE PowerBI_Client SHALL `GET /groups/{groupId}/reports` 호출 결과로부터 `reportId`, `reportName`, `datasetId` 를 추출하여 `reports` 테이블에 적재한다.
2. THE PowerBI_Client SHALL `GET /groups/{groupId}/datasets` 호출 결과로부터 `datasetId`, `datasetName` 을 추출하여 `datasets` 테이블에 적재한다.
3. THE PowerBI_Client SHALL `GET /groups/{groupId}/datasets/{datasetId}/refreshes?$top=60` 호출 결과로부터 `startTime`, `endTime`, `status`, `refreshType`, `requestId`, `serviceExceptionJson` 을 추출하여 `refresh_runs` 테이블에 적재한다.
4. THE PowerBI_Client SHALL `GET /groups/{groupId}/datasets/{datasetId}/refreshSchedule` 호출 결과로부터 예약 시각, 요일, timezone, enabled 여부를 추출하여 `refresh_schedules` 테이블에 적재한다.
5. THE Collector_Worker SHALL 동일한 `requestId` 가 이미 존재하는 경우 INSERT 대신 UPDATE 를 수행한다 (upsert).
6. WHEN 수집된 Refresh_Run 의 상태가 `진행중` 인 경우, THE Collector_Worker SHALL 다음 수집 주기에 동일한 `requestId` 의 종료 시각, 상태, 오류 메시지를 갱신한다.
7. THE Scheduler SHALL Collector_Worker 의 수집 작업을 1분 또는 5분 중 환경 변수로 설정 가능한 고정 간격으로 트리거한다.
8. WHILE 동일 Workspace 에 대한 수집 작업이 이미 실행 중인 동안, THE Collector_Worker SHALL Redis 기반 분산 락을 사용하여 중복 실행을 방지한다.
9. IF Power BI REST API 가 HTTP 429 (rate limit) 를 반환한 경우, THEN THE PowerBI_Client SHALL `Retry-After` 헤더 값만큼 대기한 후 1회 이상 재시도한다.
10. THE Collector_Worker SHALL Refresh_Run 응답 원본 JSON 을 `refresh_runs.raw_json` 컬럼에 보존한다.

### Requirement 5: 데이터 모델 및 영속화

**User Story:** Backend 운영자로서 수집된 Power BI 데이터를 정규화된 스키마로 영속화하고 싶다, 그래야 조회 API 가 일관된 응답을 제공하고 마이그레이션이 추적 가능하기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL PostgreSQL 16 이상을 영속 저장소로 사용한다.
2. THE Backend_API SHALL `workspaces`, `reports`, `datasets`, `refresh_runs`, `refresh_schedules` 5개 테이블을 정의한다.
3. THE `refresh_runs` 테이블 SHALL `id`, `workspace_id`, `report_id`, `report_name`, `dataset_id`, `dataset_name`, `refresh_type`, `status`, `start_time_utc`, `end_time_utc`, `start_time_local`, `end_time_local`, `duration_seconds`, `request_id`, `error_message`, `raw_json`, `created_at`, `updated_at` 컬럼을 포함한다.
4. THE `refresh_runs` 테이블 SHALL `(workspace_id, dataset_id, request_id)` 조합에 UNIQUE 제약을 적용한다.
5. THE Backend_API SHALL Alembic 을 사용하여 모든 스키마 변경을 마이그레이션 파일로 관리한다.
6. THE Backend_API SHALL Backend 컨테이너 기동 시 또는 별도 명령으로 Alembic 마이그레이션을 적용한다.

### Requirement 6: Reports - Refresh History 조인

**User Story:** 사용자로서 Power BI API 가 Dataset 단위로만 refresh 를 제공하더라도 Report 단위 화면을 보고 싶다, 그래야 운영자는 리포트명을 기준으로 새로고침 현황을 식별할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `Report.datasetId` 와 `Refresh_Run.dataset_id` 를 조인 키로 사용하여 Refresh_Run 을 Report 단위로 노출한다.
2. WHEN 하나의 Dataset 이 여러 Report 에 의해 공유되는 경우, THE Backend_API SHALL 동일한 Refresh_Run 을 해당 Dataset 을 사용하는 모든 Report 에 대해 노출한다.
3. IF Report 가 `datasetId` 를 가지지 않는 paginated report 인 경우, THEN THE Backend_API SHALL 해당 Report 의 데이터셋명을 `데이터셋 없음` 으로 표시하고 Refresh_Run 목록을 빈 배열로 반환한다.

### Requirement 7: 시간 처리

**User Story:** 사용자로서 Power BI 가 UTC 로 반환하는 시각을 한국 시간으로 보고 싶다, 그래야 운영자가 별도 변환 없이 화면의 시간을 인지할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL Power BI REST API 가 반환한 모든 시각을 UTC 로 해석하여 `start_time_utc`, `end_time_utc` 컬럼에 저장한다.
2. THE Backend_API SHALL `APP_TIMEZONE` 기준 변환된 시각을 `start_time_local`, `end_time_local` 컬럼에 함께 저장한다.
3. THE Backend_API SHALL `duration_seconds` 컬럼에 `end_time_utc - start_time_utc` 의 초 단위 값을 저장한다.
4. WHEN Refresh_Run 의 상태가 `진행중` 이어서 `end_time_utc` 가 비어 있는 경우, THE Backend_API SHALL `duration_seconds` 를 응답 시점의 현재 UTC 시각과 `start_time_utc` 의 차이로 계산하여 응답한다.
5. THE Frontend_App SHALL Backend_API 가 반환한 local 시각을 추가 변환 없이 표시한다.

### Requirement 8: Backend API - 헬스 및 메타데이터

**User Story:** 사용자(또는 운영 모니터링)로서 시스템의 가용성과 메타데이터를 조회하고 싶다, 그래야 화면 필터를 구성하고 시스템 상태를 점검할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `GET /api/health` 를 제공하고 200 응답으로 `{ "status": "ok" }` 형태의 JSON 을 반환한다.
2. THE Backend_API SHALL `GET /api/reports` 를 제공하고 Workspace 의 Report 목록을 `reportId`, `reportName`, `datasetId`, `datasetName` 필드와 함께 반환한다.
3. THE Backend_API SHALL `GET /api/datasets` 를 제공하고 Workspace 의 Dataset 목록을 `datasetId`, `datasetName` 필드와 함께 반환한다.
4. THE Backend_API SHALL `GET /api/refresh-schedules` 를 제공하고 Dataset 별 예약 refresh 설정(요일, 시각, timezone, enabled)을 반환한다.

### Requirement 9: Backend API - Refresh 조회

**User Story:** 사용자로서 기간, Workspace, Report, Dataset, 상태로 필터링된 refresh 이력을 조회하고 싶다, 그래야 화면에서 원하는 범위만 빠르게 분석할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `GET /api/refresh-history?date={YYYY-MM-DD}` 를 제공하고 해당 일자(`APP_TIMEZONE` 기준)의 Refresh_Run 목록을 반환한다.
2. THE Backend_API SHALL `GET /api/refresh-timetable?from={ISO}&to={ISO}&status={상태}&reportId={id}&datasetId={id}` 를 제공하고 모든 쿼리 파라미터를 선택적으로 적용한 Refresh_Run 목록을 반환한다.
3. THE Refresh_Run 응답 SHALL `reportId`, `reportName`, `datasetId`, `datasetName`, `refreshType`, `status`, `startTimeUtc`, `endTimeUtc`, `startTimeLocal`, `endTimeLocal`, `durationSeconds`, `requestId`, `errorMessage` 필드를 포함한다.
4. WHEN `errorMessage` 가 Power BI 의 `serviceExceptionJson` 으로부터 변환된 경우, THE Backend_API SHALL JSON 의 핵심 필드(`errorCode`, `errorDescription` 등)를 사람이 읽을 수 있는 한 줄 문자열로 변환하여 제공한다.
5. THE Backend_API SHALL `GET /api/summary?date={YYYY-MM-DD}` 를 제공하고 해당 일자의 전체 건수, 성공 건수, 실패 건수, 진행중 건수, 평균 `durationSeconds`, 가장 오래 걸린 Refresh_Run 의 `reportName` 과 `durationSeconds`, 최근 완료 시각(`endTimeLocal`)을 반환한다.
6. IF `date`, `from`, `to` 파라미터의 형식이 ISO 8601 또는 `YYYY-MM-DD` 형식이 아닌 경우, THEN THE Backend_API SHALL HTTP 400 응답과 사람이 읽을 수 있는 오류 메시지를 반환한다.

### Requirement 10: Backend API - 즉시 수집 트리거

**User Story:** 운영자로서 다음 스케줄을 기다리지 않고 즉시 수집을 트리거하고 싶다, 그래야 운영 점검 직후의 최신 상태를 빠르게 확인할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `POST /api/collect-now` 를 제공하고 호출 시 Collector_Worker 작업을 즉시 큐에 enqueue 한다.
2. WHEN `POST /api/collect-now` 가 호출되었으나 동일 Workspace 의 수집이 이미 실행 중인 경우, THE Backend_API SHALL HTTP 202 응답과 `{ "status": "already-running" }` 형태의 JSON 을 반환한다.
3. WHEN `POST /api/collect-now` 가 정상적으로 작업을 enqueue 한 경우, THE Backend_API SHALL HTTP 202 응답과 작업 식별자를 포함한 JSON 을 반환한다.

### Requirement 11: Redis 캐싱

**User Story:** Backend 운영자로서 Power BI API 의 rate limit 와 응답 지연을 줄이고 싶다, 그래야 화면 응답이 빨라지고 외부 API 비용이 감소하기 때문이다.

#### Acceptance Criteria

1. THE Token_Service SHALL Power BI access token 을 Redis 에 캐싱한다.
2. THE PowerBI_Client SHALL `GET /api/refresh-history` 와 `GET /api/refresh-timetable` 의 응답에 사용되는 외부 호출 결과를 환경 변수로 설정 가능한 TTL (기본 60초) 동안 Redis 에 캐싱한다.
3. WHEN 동일한 Workspace 에 대한 수집 작업이 이미 실행 중인 경우, THE Collector_Worker SHALL Redis 기반 분산 락(`SET NX EX`)으로 중복 실행을 차단한다.

### Requirement 12: 사이드바 및 헤더 UI

**User Story:** 사용자로서 모든 화면에서 일관된 네비게이션을 사용하고 싶다, 그래야 모니터링/분석/설정 메뉴를 쉽게 이동할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL 좌측 사이드바에 다음 4개 그룹과 하위 메뉴를 한국어로 표시한다: (1) 대시보드, (2) 모니터링 - "Refresh 실행 현황", "Refresh 상세 조회", "Refresh 로그", (3) 분석 - "실행/실패 통계", "데이터셋별 처리량", "Top N 분석", (4) 설정 - "연결 정보", "알림 설정", "사용자 관리".
2. THE Frontend_App SHALL 상단 헤더에 화면 제목 "Power BI Refresh Monitor", 자동 새로고침 토글, 새로고침 버튼, 내보내기 버튼, 현재 사용자 표시(`admin`) 를 표시한다.
3. WHEN 사용자가 자동 새로고침 토글을 활성화한 경우, THE Frontend_App SHALL 환경 변수로 설정 가능한 간격(기본 60초)마다 현재 화면의 데이터를 Backend_API 로부터 재조회한다.
4. WHEN 사용자가 새로고침 버튼을 클릭한 경우, THE Frontend_App SHALL 현재 화면의 데이터를 Backend_API 로부터 즉시 재조회한다.

### Requirement 13: 필터

**User Story:** 사용자로서 기간, Workspace, Report, Dataset, 상태로 화면을 필터링하고 싶다, 그래야 특정 조건의 refresh 만 분석할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL 필터 영역에 기간(시작일시, 종료일시), Workspace, Report, Dataset, 상태, 조회 버튼을 표시한다.
2. WHEN 사용자가 조회 버튼을 클릭한 경우, THE Frontend_App SHALL 현재 필터 값을 `GET /api/refresh-timetable` 의 쿼리 파라미터로 전달하여 Backend_API 를 호출한다.
3. THE Frontend_App SHALL 상태 필터의 선택 가능한 값으로 `전체`, `성공`, `실패`, `진행중`, `알 수 없음` 을 제공한다.
4. THE Frontend_App SHALL 기간 필터의 기본값을 `APP_TIMEZONE` 기준 오늘 00:00 부터 23:59 까지로 설정한다.

### Requirement 14: KPI 카드

**User Story:** 사용자로서 화면 진입 시 한 눈에 핵심 지표를 보고 싶다, 그래야 상세 화면 진입 전 운영 상태를 즉시 파악할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL KPI 영역에 7개 카드를 표시한다: 전체 건수, 성공, 실패, 진행중, 평균 소요 시간, 가장 오래 걸린 리포트, 최근 완료 시각.
2. THE Frontend_App SHALL 각 KPI 카드의 값을 `GET /api/summary` 응답으로부터 채운다.
3. WHEN `GET /api/summary` 응답에 `진행중` 건수가 0 보다 큰 경우, THE Frontend_App SHALL `진행중` 카드를 시각적으로 강조 표시(색상 또는 아이콘)한다.

### Requirement 15: Gantt 타임테이블

**User Story:** 사용자로서 리포트별 refresh 의 시작 시각, 종료 시각, 소요 시간을 시간축에서 한 눈에 비교하고 싶다, 그래야 동일 시간대의 동시 실행 부하와 지연을 식별할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL 중앙 영역에 Y축이 리포트명, X축이 시간인 Gantt_Timetable 을 렌더링한다.
2. THE Gantt_Timetable SHALL Refresh_Run 의 막대 색상을 상태별로 구분한다: 성공, 실패, 진행중, 알 수 없음.
3. THE Gantt_Timetable SHALL 각 막대 위 또는 안에 `durationSeconds` 를 사람이 읽을 수 있는 형식(`mm:ss` 또는 `H시간 m분`)으로 표시한다.
4. WHEN 사용자가 막대에 hover 한 경우, THE Gantt_Timetable SHALL 리포트명, 데이터셋명, 시작 시각(local), 종료 시각(local), 소요 시간, 상태, requestId 를 포함한 tooltip 을 표시한다.
5. THE Gantt_Timetable SHALL 현재 시각(local)을 표시하는 vertical line 을 렌더링한다.
6. WHEN Refresh_Run 의 상태가 `진행중` 인 경우, THE Gantt_Timetable SHALL 종료 시각을 현재 시각으로 그려 막대를 연장한다.

### Requirement 16: 우측 실행 흐름 패널

**User Story:** 사용자로서 오늘 실행된 refresh 를 시간   순서로 빠르게 훑어보고 싶다, 그래야 최신 실패와 정상 흐름을 즉시 인지할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL 우측 패널에 오늘 실행된 Refresh_Run 을 시작 시각의 오름차순 또는 내림차순으로 표시한다.
2. WHEN Refresh_Run 의 상태가 `실패` 인 경우, THE Frontend_App SHALL 해당 항목 아래에 `errorMessage` 의 앞부분을 100자 이내로 잘라 표시한다.

### Requirement 17: 하단 분석 차트

**User Story:** 사용자로서 리포트별 처리량과 시간대별 추이, 성공/실패 비율을 시각적으로 비교하고 싶다, 그래야 운영 패턴과 이상치를 식별할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL 하단 영역에 다음 4개 시각화를 표시한다: (1) 가장 오래 걸린 리포트 카드, (2) 리포트별 소요 시간 bar 차트, (3) 시간대별 line 차트, (4) 성공/실패 donut 차트.
2. THE Frontend_App SHALL 모든 하단 차트의 데이터를 현재 필터에 따른 `GET /api/refresh-timetable` 응답 또는 `GET /api/summary` 응답으로부터 도출한다.

### Requirement 18: 상세 테이블

**User Story:** 사용자로서 refresh 이력의 모든 컬럼을 표 형태로 보고 정렬, 검색, 필터링, CSV 내보내기 하고 싶다, 그래야 데이터 분석과 보고에 활용할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL 상세 테이블에 다음 컬럼을 표시한다: 순번, 리포트명, 데이터셋명, Refresh Type, 상태, 예약 시각, 시작 시각, 종료 시각, 소요 시간, Request ID, 오류 메시지.
2. THE Frontend_App SHALL 상세 테이블에 검색 입력 필드를 제공하고 입력값에 따라 리포트명 또는 데이터셋명에 부분 일치하는 행만 표시한다.
3. THE Frontend_App SHALL 상세 테이블의 모든 컬럼에 대해 클릭 기반 정렬을 제공한다.
4. THE Frontend_App SHALL 상세 테이블에 "실패만" 토글과 "진행중만" 토글을 제공하고 각 토글이 활성화된 경우 해당 상태의 행만 표시한다.
5. WHEN 사용자가 CSV 내보내기 버튼을 클릭한 경우, THE Frontend_App SHALL 현재 화면에 표시된 행을 UTF-8 BOM 포함 CSV 파일로 다운로드한다.

### Requirement 19: 오류 표시 및 예외 처리

**User Story:** 사용자로서 Power BI API 또는 Backend API 호출이 실패한 경우 화면에서 원인을 인지하고 싶다, 그래야 침묵 실패(silent failure)로 잘못된 운영 판단을 내리지 않게 할 수 있기 때문이다.

#### Acceptance Criteria

1. IF Backend_API 호출이 5xx 또는 네트워크 오류로 실패한 경우, THEN THE Frontend_App SHALL 화면 상단에 사람이 읽을 수 있는 오류 메시지와 재시도 버튼을 표시한다.
2. IF Power BI REST API 호출이 인증, 권한, rate limit 오류로 실패한 경우, THEN THE Backend_API SHALL HTTP 502 응답과 함께 `{ "errorCode": ..., "errorDescription": ... }` 형태의ㅠ  메시지를 반환한다.
3. WHEN Refresh_Run 의 `serviceExceptionJson` 이 비어 있지 않은 경우, THE Backend_API SHALL 해당 JSON 을 파싱하여 `errorMessage` 컬럼/필드에 한 줄 문자열로 저장한다.
4. IF `serviceExceptionJson` 의 파싱이 실패한 경우, THEN THE Backend_API SHALL 원본 문자열의 앞 500자를 `errorMessage` 에 저장한다.

### Requirement 20: 비기능 요구사항

**User Story:** 운영자로서 시스템이 안정적이고 추적 가능하기를 원한다, 그래야 장애 시 원인 분석과 성능 튜닝이 가능하기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 모든 외부 Power BI REST API 호출에 대해 호출 URL, HTTP 상태 코드, 소요 시간(ms) 을 구조화 로그로 기록한다.
2. THE Backend_API SHALL 모든 `/api/*` 엔드포인트 응답을 200ms 이내(캐시 hit 기준) 또는 1000ms 이내(캐시 miss + DB 조회 기준)에 반환한다.
3. THE Collector_Worker SHALL 단일 Workspace 의 1회 수집 작업을 60초 이내에 완료한다 (Power BI API 응답 시간 제외).
4. THE PRM SHALL Backend_API 와 Frontend_App 의 모든 사용자 노출 메시지를 한국어로 제공한다.
5. THE PRM SHALL 시크릿 환경 변수(`AZURE_CLIENT_SECRET` 등)를 코드, 로그, 응답 본문에 노출하지 않는다.
