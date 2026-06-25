# 구현 계획 (Implementation Plan): Power BI Refresh Monitor

## Overview

본 계획은 design.md의 "Phased Delivery 매핑" 절과 requirements.md Requirement 2.5의 8단계 인도 순서를 상위 task 묶음으로 그대로 반영한다. 핵심 원칙은 다음과 같다.

- **Mock 우선 end-to-end**: 단계 0~2에서 mock data만으로 frontend + backend가 `docker compose up`으로 함께 뜨는 상태를 가장 먼저 확보한다.
- **점진적 교체**: 이후 단계에서 PostgreSQL 영속화 → Live PowerBI_Client → 즉시 수집 → Worker/Scheduler → 실연동 순으로 mock 경로를 실제 구현으로 교체하되, 외부 인터페이스(엔드포인트 경로 + 응답 스키마)는 고정하여 회귀를 방지한다(R2.6).
- **Property 근접 배치**: design.md의 8개 Correctness Property(P1~P8)는 각 기능을 구현하는 task 직후에 검증 task로 배치한다. Backend는 `hypothesis`, Frontend는 `fast-check`를 사용한다.
- **언어/스택**: Backend는 Python 3.12 + FastAPI + SQLAlchemy 2.x async + Alembic + httpx + Celery, Frontend는 React 19 + Vite 6 + TypeScript (design.md 명시 스택).

> `*` 가 붙은 sub-task는 선택적(optional)이며 MVP를 위해 건너뛸 수 있다. 상위 task에는 `*`를 붙이지 않는다.

## Tasks

- [x] 0. 프로젝트 부트스트랩 (단계 0: repo 구조 + Compose + 문서 초안)
  - [x] 0.1 모노레포 디렉터리 골격 및 루트 문서 생성
    - 루트에 `backend/`, `frontend/`, `docker-compose.yml`, `docker-compose.test.yml`, `.gitignore` 생성
    - `.env.example`에 `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`, `POWERBI_API_BASE_URL`(기본 `https://api.powerbi.com/v1.0/myorg`), `DATABASE_URL`, `REDIS_URL`, `APP_TIMEZONE`(기본 `Asia/Seoul`), `APP_MODE`(기본 `mock`), `COLLECT_INTERVAL_MINUTES`, `CACHE_TTL_SECONDS`, `CORS_ALLOWED_ORIGINS`, `AUTO_REFRESH_INTERVAL_SEC` 변수를 모두 포함하여 작성
    - `README.md` 초안 작성: `.env.example` 복사 절차, `docker compose up` 절차, Backend(:8000)/Frontend(:5173) 접속 URL, Mock_Mode↔Live_Mode 전환 방법(한국어) — 단계 8에서 최종화
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 20.4_
    - _Design: Phased Delivery 매핑(8단계), Docker Compose 구성_

  - [x] 0.2 docker-compose.yml에 6개 서비스 정의 (mock 우선 기동)
    - `postgres`(postgres:16, healthcheck pg_isready, named volume), `redis`(redis:7-alpine, healthcheck redis-cli ping), `backend`, `frontend`, `worker`, `scheduler` 6개 서비스를 단일 파일로 정의
    - `backend`는 `depends_on` postgres/redis healthy, `worker`/`scheduler`는 backend healthy 이후 기동(`depends_on` + healthcheck), `prm-net` 네트워크 지정
    - 초기 단계에서는 `APP_MODE=mock`이므로 worker/scheduler가 외부 API 없이도 기동 실패하지 않도록 환경 변수 주입
    - _Requirements: 1.1, 5.6_
    - _Design: Docker Compose 구성_

- [x] 1. Mock 기반 Frontend UI 완성 (단계 1)
  - [x] 1.1 Frontend 프로젝트 스캐폴딩 및 빌드/실행 설정
    - `frontend/`에 Vite 6 + React 19 + TypeScript 프로젝트 생성, Tailwind CSS v4, React Router, TanStack Query, Zustand, Recharts, lucide-react, date-fns(또는 dayjs) 의존성 추가
    - `frontend/Dockerfile`(빌드 후 정적 서빙, :80→compose에서 5173 매핑), `vite.config.ts`, `tsconfig.json` 구성
    - `src/main.tsx`(React 19 createRoot), `src/App.tsx`(Router + Layout), `src/i18n/ko.ts`(모든 한국어 라벨) 생성
    - _Requirements: 1.7, 2.3, 20.4_
    - _Design: Frontend 디렉터리 구조_

  - [x] 1.2 타입 정의 및 정적 mock fixture 작성
    - `src/types/refresh.ts`에 Backend 응답 1:1 매핑 타입(`RefreshRunOut`, `SummaryOut`, `ReportOut`, `DatasetOut`, `ScheduleOut`) 정의
    - `src/mocks/fixtures.ts`에 5~10개 Report, 3~5개 Dataset(공유 Dataset 포함), Dataset당 30~60개 refresh(성공/실패/진행중/알 수 없음 혼재), "현재 시각 ± N분" 동적 시간 생성 로직 작성
    - _Requirements: 2.3, 9.3_
    - _Design: Frontend 디렉터리 구조(types/, mocks/), MockPowerBIClient 픽스처_

  - [x] 1.3 레이아웃: Sidebar와 Header 구현
    - `src/components/layout/Sidebar.tsx`: 4개 그룹(대시보드 / 모니터링 / 분석 / 설정)과 하위 메뉴를 한국어로 렌더, design.md 라우팅 매핑대로 경로 연결
    - `src/components/layout/Header.tsx`: 제목 "Power BI Refresh Monitor", 자동 새로고침 토글, 새로고침 버튼, 내보내기 버튼, 사용자 표시(`admin`)
    - _Requirements: 12.1, 12.2_
    - _Design: 라우팅 ↔ 사이드바 매핑_

  - [ ]* 1.4 Sidebar/Header 컴포넌트 테스트
    - Vitest + RTL로 4개 그룹/하위 메뉴 라벨 및 헤더 요소 렌더 검증
    - _Requirements: 12.1, 12.2_

  - [x] 1.5 Zustand 필터 store 및 FilterBar 구현
    - `src/stores/useRefreshFilterStore.ts`: `from/to/workspaceId/reportId/datasetId/status/autoRefresh/autoRefreshIntervalSec` 상태와 `setRange/setStatus/toggleAutoRefresh/reset` 액션. 기간 기본값 오늘 00:00~23:59(KST)
    - `src/components/filters/FilterBar.tsx`: 기간/Workspace/Report/Dataset/상태(전체·성공·실패·진행중·알 수 없음)/조회 버튼
    - _Requirements: 13.1, 13.3, 13.4_
    - _Design: 상태 관리(useRefreshFilterStore)_

  - [ ]* 1.6 필터 store 단위 테스트
    - 기본 기간값, 상태 토글, reset 동작 검증
    - _Requirements: 13.3, 13.4_

  - [x] 1.7 KPI 카드 구현
    - `src/components/kpi/KpiCards.tsx`: 7개 카드(전체/성공/실패/진행중/평균 소요 시간/가장 오래 걸린 리포트/최근 완료 시각). 진행중 > 0이면 시각적 강조
    - mock fixture로부터 값 도출
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 1.8 Gantt 타임테이블(SVG) 구현
    - `src/components/gantt/`에 `RefreshTimeline.tsx`(컨테이너, 리포트명 그룹핑→평면화), `GanttBar.tsx`(상태별 색상), `GanttAxis.tsx`(X=시간/Y=리포트명), `NowLine.tsx`(현재 시각 vertical line) 작성
    - 상태별 막대 색상(success/failed/in_progress+사선/unknown), duration 라벨(`mm:ss`/`H시간 m분`), hover tooltip(리포트명·데이터셋명·시작/종료 local·소요시간·상태·requestId), 진행중 막대는 현재 시각까지 연장
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
    - _Design: Refresh Timeline(Gantt) 컴포넌트 설계 결정_

  - [x] 1.9 duration/date 유틸 및 우측 실행 흐름 패널 구현
    - `src/utils/duration.ts`(초→`mm:ss`/`H시간 m분`), `src/utils/date.ts`(parse/format)
    - `src/components/flow/ExecutionFlow.tsx`: 오늘 실행 Refresh_Run을 시작 시각 순 정렬, 실패 항목은 errorMessage 앞 100자 표시
    - _Requirements: 7.5, 16.1, 16.2_

  - [ ]* 1.10 duration 포맷 property 테스트 (fast-check)
    - **Property: format(d)의 결과가 `H시간 m분`/`mm:ss` 규약을 만족 (음수/0/대값 포함)**
    - `src/__tests__/property/duration.property.test.ts`
    - _Requirements: 15.3_

  - [x] 1.11 하단 분석 차트 구현 (Recharts)
    - `src/components/charts/`에 `DurationBarChart.tsx`(리포트별 소요 시간), `HourlyTrendChart.tsx`(시간대별 line), `StatusDonutChart.tsx`(성공/실패 donut), 그리고 "가장 오래 걸린 리포트" 카드 구성
    - _Requirements: 17.1, 17.2_

  - [x] 1.12 상세 테이블 및 CSV 내보내기 구현
    - `src/components/table/RefreshTable.tsx`: 컬럼(순번/리포트명/데이터셋명/Refresh Type/상태/예약 시각/시작/종료/소요 시간/Request ID/오류 메시지), 검색 입력(리포트명·데이터셋명 부분 일치), 컬럼 정렬, "실패만"/"진행중만" 토글
    - `src/utils/csv.ts`: 현재 표시 행을 UTF-8 BOM 포함 CSV로 다운로드 + Header 클릭으로 내보내기 버튼 연결
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_
    - _Design: CSV 내보내기(utils/csv.ts)_

  - [ ]* 1.13 CSV/검색 property 테스트 (fast-check)
    - **Property: CSV 출력은 항상 UTF-8 BOM(0xFEFF)으로 시작하고 줄 수 = header + rows**
    - **Property: 검색 필터 결과의 모든 행은 입력 문자열을 리포트명/데이터셋명에 포함(includes invariant)**
    - `src/__tests__/property/csv.property.test.ts`, `search.property.test.ts`
    - _Requirements: 18.2, 18.5_

  - [x] 1.14 메인 화면 라우트 와이어링 및 ErrorBanner 배치
    - `src/routes/RefreshStatusPage.tsx`(`/monitoring/status`)에 FilterBar + KpiCards + RefreshTimeline + ExecutionFlow + 하단 차트 + RefreshTable 결합
    - 나머지 라우트(`/`, `/monitoring/detail`, `/monitoring/log`, `/analytics/*`, `/settings/*`) 페이지 스텁 생성
    - `src/components/common/ErrorBanner.tsx`, `LoadingSpinner.tsx` 작성 후 `App` 상단에 sticky 배치
    - 이 시점에 모든 화면이 mock fixture만으로 정상 렌더되어야 함
    - _Requirements: 2.3, 12.1, 19.1_
    - _Design: 라우팅 ↔ 사이드바 매핑, Frontend 오류 처리_

- [x] 2. Backend mock endpoint 구현 (단계 2: FastAPI + MockPowerBIClient)
  - [x] 2.1 Backend 프로젝트 스캐폴딩 및 설정
    - `backend/app/`에 `main.py`(FastAPI 앱·lifespan·라우터 마운트·CORS), `core/config.py`(Pydantic Settings로 env 바인딩, `APP_MODE` 포함), `core/logging.py`(structlog JSON + request_id 미들웨어 + 시크릿 마스킹), `core/timezone.py`, `core/deps.py` 디렉터리 골격 생성
    - `backend/Dockerfile`, `backend/entrypoint.sh`(단계 3 이후 `alembic upgrade head` 추가 예정, 현재는 uvicorn 기동), `pyproject.toml`(FastAPI/Pydantic v2/SQLAlchemy/Alembic/asyncpg/httpx/celery/structlog/pytest/hypothesis)
    - _Requirements: 1.6, 1.8, 20.1, 20.5_
    - _Design: Backend 모듈 구조_

  - [x] 2.2 응답 스키마 및 status/error 변환 유틸 구현
    - `schemas/`에 `common.py`(오류 응답 스키마), `refresh.py`(`RefreshRunOut`, `RefreshTimetableQuery`, `SummaryOut`), `report.py`, `dataset.py`, `schedule.py`
    - `services/powerbi/status_mapper.py`(Power BI status→내부 enum success/failed/in_progress/unknown), `services/powerbi/error_parser.py`(`parse_service_exception`)
    - _Requirements: 8.2, 8.3, 8.4, 9.3, 9.4, 19.3, 19.4_
    - _Design: Power BI status 정규화, errorMessage 변환_

  - [ ]* 2.3 error_parser total function property 테스트 (hypothesis)
    - **Property 4: serviceExceptionJson 파서의 total function 보장 — 임의 입력에 예외 없이 str|None 반환, 길이 ≤ 500, valid JSON이면 errorCode/errorDescription 부분 문자열 포함**
    - **Validates: Requirements 9.4, 19.3, 19.4**
    - `backend/tests/property/test_error_parser_total.py`
    - _Requirements: 9.4, 19.3, 19.4_

  - [x] 2.4 PowerBIClient Protocol 및 MockPowerBIClient 구현
    - `services/powerbi/client.py`: `PowerBIClient` Protocol(`list_reports`/`list_datasets`/`list_refreshes`/`get_refresh_schedule`)과 DTO(`ReportDTO`/`DatasetDTO`/`RefreshRunDTO`/`RefreshScheduleDTO`)
    - `services/powerbi/mock_client.py`: `fixtures/` 하위 JSON을 읽어 동일 DTO 반환(공유 Dataset, 성공/실패/진행중/Disabled, 동적 시간 포함)
    - `core/deps.py`의 `get_powerbi_client`가 `APP_MODE`에 따라 Mock/Live 팩토리 분기(Live는 단계 4에서 추가)
    - _Requirements: 2.2, 2.3_
    - _Design: 런타임 모드(Mock vs Live), PowerBIClient Protocol_

  - [x] 2.5 메타데이터 및 헬스 라우트 구현
    - `api/routes/health.py`(`GET /api/health` → `{status, mode, version}`), `reports.py`(`GET /api/reports`), `datasets.py`(`GET /api/datasets`), `schedules.py`(`GET /api/refresh-schedules`)
    - paginated report(datasetId 없음)는 datasetName="데이터셋 없음"으로 노출
    - _Requirements: 6.3, 8.1, 8.2, 8.3, 8.4_
    - _Design: API 엔드포인트 명세_

  - [x] 2.6 Refresh 조회/요약 라우트 구현 (mock 데이터 기반)
    - `services/refresh_query.py`(조회 로직), `services/summary.py`(집계)를 mock client 결과 위에서 동작하도록 구현
    - `api/routes/refresh.py`(`GET /api/refresh-history?date=`, `GET /api/refresh-timetable?from&to&status&reportId&datasetId`), `api/routes/summary.py`(`GET /api/summary?date=`)
    - 잘못된 date/ISO 형식은 HTTP 400 `VALIDATION_ERROR`(한국어) 반환
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6_
    - _Design: API 엔드포인트 명세, 공통 오류 응답_

  - [ ]* 2.7 메타/조회 엔드포인트 통합 테스트 (httpx ASGITransport)
    - `/api/health`, `/api/reports`, `/api/refresh-history`, `/api/refresh-timetable`, `/api/summary` happy path + 400 오류 path
    - `backend/tests/integration/test_health.py`, `test_reports_api.py`, `test_refresh_api.py`, `test_summary_api.py`
    - _Requirements: 8.1, 9.1, 9.2, 9.5, 9.6_

  - [x] 2.8 전역 오류 핸들러 및 Compose mock end-to-end 확인
    - design.md 오류 분류표대로 전역 예외 핸들러 등록(400/500/502/503, 한국어 errorDescription, secret/stacktrace 미노출)
    - `docker compose up`으로 backend(mock) + frontend가 함께 떠서 `/api/health` 200 및 화면이 backend mock 응답으로 렌더되는지 확인 (단, 이 단계 Frontend는 여전히 mock fixture 사용 가능 — 실연동은 단계 7)
    - _Requirements: 1.1, 19.2, 20.5_
    - _Design: Error Handling_

- [x] 3. PostgreSQL 모델 + Alembic migration (단계 3)
  - [x] 3.1 DB 세션/엔진 및 SQLAlchemy 모델 정의
    - `db/base.py`(DeclarativeBase), `db/session.py`(async engine + async_sessionmaker), `db/redis.py`(aioredis 클라이언트)
    - `models/`에 `workspace.py`, `report.py`, `dataset.py`, `refresh_run.py`, `refresh_schedule.py` — design.md 테이블 스펙(컬럼/타입/제약/인덱스)대로 정의
    - `refresh_runs`에 `(workspace_id, dataset_id, request_id)` UNIQUE, `raw_json` JSONB, status CHECK 제약, 인덱스 3종
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 4.10_
    - _Design: Data Models(테이블 스펙, ERD)_

  - [x] 3.2 Alembic 초기 마이그레이션 및 entrypoint 연결
    - `migrations/env.py`(async) + 초기 버전 파일로 5개 테이블/제약/인덱스 생성
    - `entrypoint.sh`에 `alembic upgrade head` 추가 후 uvicorn 기동, worker/scheduler는 backend healthy 대기
    - _Requirements: 5.5, 5.6_
    - _Design: Alembic 마이그레이션 정책_

  - [x] 3.3 시간 변환 유틸 구현 (UTC ↔ APP_TIMEZONE)
    - `core/timezone.py`에 `to_local`/`to_utc` 및 row의 utc/local 동시 산출 헬퍼 구현
    - _Requirements: 7.1, 7.2, 7.5_
    - _Design: 이중 시간 컬럼_

  - [ ]* 3.4 시간대 round-trip property 테스트 (hypothesis)
    - **Property 3: UTC ↔ APP_TIMEZONE round-trip 등가성 — `to_utc(to_local(t)) == t`, local과 utc는 동일 절대 순간**
    - **Validates: Requirements 7.1, 7.2, 7.5**
    - `backend/tests/property/test_timezone_roundtrip.py`
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 3.5 Collector upsert 및 조회 SQL을 DB 기반으로 전환
    - `services/powerbi/collector.py`에 `upsert_refresh_run`/`dto_to_row`(`INSERT ... ON CONFLICT DO UPDATE`, 진행중→완료 시 end_time/duration/error 갱신, 누락 필드 보존)와 reports/datasets/schedules upsert 구현
    - `services/refresh_query.py`를 design.md JOIN SQL(Report↔Refresh, COALESCE duration, paginated report 처리)로 교체, `services/summary.py`도 DB 집계로 전환
    - duration_seconds 계산 및 진행중 동적 계산(`COALESCE` + `EXTRACT(EPOCH ...)`) 적용
    - _Requirements: 4.5, 4.6, 6.1, 6.2, 6.3, 7.3, 7.4_
    - _Design: Refresh_Collector, Refresh Query Service_

  - [ ]* 3.6 upsert 멱등성 property 테스트 (hypothesis)
    - **Property 1: Refresh_Run upsert 멱등성 및 선택적 갱신 — 동일 키 시퀀스 적용 후 row 1개, 마지막 DTO와 동등, 누락 report_name 보존**
    - **Validates: Requirements 4.5, 4.6, 5.4, 11.3**
    - `backend/tests/property/test_upsert_idempotency.py`
    - _Requirements: 4.5, 4.6, 5.4_

  - [ ]* 3.7 duration 계산 property 테스트 (hypothesis)
    - **Property 2: Refresh duration 계산 일관성 — endTime 있으면 정수 초 ≥ 0, 진행중이면 (현재 UTC - start) 1초 이내 오차**
    - **Validates: Requirements 7.1, 7.3, 7.4**
    - `backend/tests/property/test_duration.py`
    - _Requirements: 7.1, 7.3, 7.4_

  - [ ]* 3.8 fan-out consistency property 테스트 (hypothesis)
    - **Property 5: Reports ↔ Refresh History fan-out consistency — 동일 dataset 공유 Report 그룹의 requestId 집합이 모두 동일**
    - **Validates: Requirements 6.1, 6.2**
    - `backend/tests/property/test_fanout_consistency.py`
    - _Requirements: 6.1, 6.2_

  - [ ]* 3.9 filter 술어 property 테스트 (hypothesis)
    - **Property 7: Refresh timetable 필터 술어 만족 — 응답 모든 row가 from/to/status/reportId/datasetId 술어 동시 만족, date 조회는 startTimeLocal.date()==D**
    - **Validates: Requirements 9.1, 9.2**
    - `backend/tests/property/test_filter_predicates.py`
    - _Requirements: 9.1, 9.2_

- [x] 4. PowerBI_Client(Live) + Token_Service 구현 (단계 4)
  - [x] 4.1 Token_Service 구현 (Azure AD client credentials + Redis 캐시)
    - `services/powerbi/token_service.py`: `get_token()`/`invalidate()`, Redis 키 `prm:powerbi:token:{tenant}:{client}`, TTL `min(expires_in - 60, 3600)`, 발급 실패 시 `TokenServiceError`(상태코드+메시지)·캐시 미저장
    - `APP_MODE=mock`일 때 `MockTokenService`로 교체(Azure AD 호출 0회)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 11.1, 20.5_
    - _Design: Token_Service_

  - [x] 4.2 LivePowerBIClient 구현 (httpx + 재시도 + 로깅)
    - `services/powerbi/live_client.py`: 4개 엔드포인트(`/groups/{id}/reports`, `/datasets`, `/datasets/{id}/refreshes?$top=60`, `/datasets/{id}/refreshSchedule`) 호출 및 DTO 매핑
    - 401→token invalidate 후 1회 재시도, 429→`Retry-After` 대기 + 지수 backoff(최대 3회), 5xx backoff, 구조화 로그(`url/method/status_code/elapsed_ms/retry_count`), Authorization/client_secret 마스킹
    - `raw_json` 보존을 위해 원본 JSON을 DTO에 포함
    - _Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 4.9, 4.10, 11.2, 19.2, 20.1, 20.5_
    - _Design: PowerBIClient Protocol(Live 정책), Redis 키/TTL 규약_

  - [ ]* 4.3 LivePowerBIClient 재시도/마스킹 단위 테스트 (respx)
    - 401 재시도 1회, 429 Retry-After 대기, 5xx backoff, 로그 마스킹 검증
    - `backend/tests/unit/` 하위
    - _Requirements: 3.5, 4.9, 20.5_

  - [x] 4.4 Refresh history 응답 Redis 캐싱 적용
    - `/api/refresh-history`, `/api/refresh-timetable` 외부 호출 결과를 `prm:cache:*` 키로 TTL(`CACHE_TTL_SECONDS`, 기본 60) 캐싱
    - _Requirements: 11.2_
    - _Design: Redis 키/TTL 규약_

  - [ ]* 4.5 Mock/Live 응답 스키마 동치성 property 테스트 (hypothesis + respx)
    - **Property 6: Mock_Mode와 Live_Mode 응답 스키마 동치성 — 6개 엔드포인트가 mock/live(stubbed httpx) 모두 동일 Pydantic 스키마 validation 통과 (mock→live 전환 회귀 방지)**
    - **Validates: Requirements 2.2, 2.4, 2.6**
    - `backend/tests/property/test_mode_schema_parity.py`, `backend/tests/integration/test_mode_parity.py`
    - _Requirements: 2.2, 2.4, 2.6_

- [x] 5. 분산 락 + POST /api/collect-now 구현 (단계 5)
  - [x] 5.1 Redis 분산 락 구현
    - `services/powerbi/lock.py`: `acquire_collect_lock`(`SET NX EX`, lock value=uuid), `release_collect_lock`(동일 value일 때만 DEL, Lua atomic), 키 `prm:lock:collect:{workspace_id}`, TTL 60초
    - _Requirements: 4.8, 11.3_
    - _Design: Redis 분산 락(lock.py)_

  - [ ]* 5.2 분산 락 상호 배제 property 테스트 (hypothesis)
    - **Property 8: 분산 락의 상호 배제 — N≥2 동시 acquire 시 정확히 1개만 non-None, 미보유 caller의 release는 무효**
    - **Validates: Requirements 4.8, 11.3**
    - `backend/tests/property/test_distributed_lock.py`
    - _Requirements: 4.8, 11.3_

  - [x] 5.3 POST /api/collect-now 라우트 구현
    - `api/routes/collect.py`: 락 키를 검사하여 이미 실행 중이면 HTTP 202 `{status:"already-running"}`, 아니면 Celery task enqueue 후 HTTP 202 `{status:"enqueued", taskId}`
    - 단계 6에서 실제 Celery task와 연결되기 전, enqueue 인터페이스(추상)를 먼저 정의하여 고아 코드 방지
    - _Requirements: 10.1, 10.2, 10.3_
    - _Design: API 엔드포인트 명세, Lock 정책_

  - [ ]* 5.4 collect-now 통합 테스트
    - enqueue 성공 202, already-running 202 두 경로 검증
    - `backend/tests/integration/test_collect_api.py`
    - _Requirements: 10.2, 10.3_

- [x] 6. Collector_Worker + Scheduler 구현 (단계 6: Celery + Celery Beat)
  - [x] 6.1 Celery 앱 및 collect task 구현
    - `workers/celery_app.py`(Redis broker/result backend), `workers/tasks/collect.py`(`@celery_app.task prm.collect_workspace`, `autoretry_for=(httpx.HTTPError,)`, `retry_backoff`, `max_retries=3`)
    - task 내부에서 락 획득→collector 수집 흐름(reports/datasets/refreshes/schedule upsert)→락 해제 호출
    - `POST /api/collect-now`를 실제 `collect_workspace.delay(...)`와 연결
    - _Requirements: 4.5, 4.6, 4.8, 10.1, 20.3_
    - _Design: 작업 정의, Refresh_Collector 시퀀스_

  - [x] 6.2 Celery Beat 스케줄 구현
    - `workers/beat_schedule.py`: `crontab(minute="*/N")`로 `COLLECT_INTERVAL_MINUTES`(허용값 1 또는 5) 간격 `prm.collect_workspace` 트리거, args=`POWERBI_WORKSPACE_ID`
    - compose의 `worker`/`scheduler` 서비스가 mock/live 모두에서 기동되어 DB row가 증가하는지 확인
    - _Requirements: 4.7_
    - _Design: Beat schedule_

  - [ ]* 6.3 Worker 통합 테스트 (testcontainers)
    - 진행중 row가 다음 수집에서 완료로 갱신되는지(4.6), 동시 실행 시 락으로 중복 차단되는지(4.8) 검증
    - _Requirements: 4.6, 4.8_

  - [ ]* 6.4 Flower 모니터링 연동
    - compose에 Flower 서비스(optional)를 추가하여 Celery task 큐 가시화
    - _Requirements: 20.1_

- [x] 7. Frontend ↔ 실제 Backend API 연동 (단계 7)
  - [x] 7.1 API 클라이언트 구현 및 mock fixture 제거
    - `src/api/client.ts`(base URL 환경 변수, axios interceptor로 오류 `{status, errorCode, errorDescription}` 표준화), `src/api/refreshApi.ts`(모든 `/api/*` 호출)
    - 컴포넌트가 `src/mocks/fixtures.ts` 대신 TanStack Query 훅(`useRefreshTimetable`/`useSummary`/`useReports`/`useDatasets`/`useSchedules`) 사용하도록 교체
    - _Requirements: 2.4, 13.2_
    - _Design: TanStack Query, Frontend 오류 처리_

  - [x] 7.2 자동 새로고침 및 수동 새로고침/즉시 수집 연결
    - 자동 새로고침 토글 활성 시 `refetchInterval`(기본 60초)로 현재 화면 재조회, 새로고침 버튼은 즉시 refetch
    - 헤더에 `POST /api/collect-now` 트리거 버튼 연결(이미 실행 중이면 toast)
    - _Requirements: 12.3, 12.4, 10.1_

  - [x] 7.3 오류 배너 실연동 및 502 메시지 처리
    - `<ErrorBanner>`가 5xx/네트워크 오류 시 재시도 버튼 노출, 502(Power BI 실패) 시 한국어 메시지 표시
    - _Requirements: 19.1, 19.2_
    - _Design: Frontend 오류 처리_

  - [ ]* 7.4 메인 페이지 MSW 통합 테스트
    - `RefreshStatusPage`가 API 응답으로 KPI/Gantt/Table을 렌더, 오류 시 배너 표시
    - `frontend/src/__tests__/pages/RefreshStatusPage.test.tsx`
    - _Requirements: 14.2, 15.1, 19.1_

  - [ ]* 7.5 Playwright E2E smoke 테스트
    - `docker compose up` 후 메인 화면이 실 데이터로 렌더되는지 자동 검증
    - _Requirements: 2.4_

- [x] 8. 체크포인트 및 README 최종화 (단계 8)
  - [x] 8.1 체크포인트 - 전체 테스트 통과 확인
    - Backend unit/property/integration, Frontend component/property 테스트를 모두 실행하여 통과 확인. 문제 발생 시 사용자에게 질문.
    - _Requirements: 2.6, 20.4_

  - [x] 8.2 README 및 .env.example 최종화
    - `.env.example` 복사 절차, `docker compose up` 절차, Backend/Frontend 접속 URL, Mock_Mode↔Live_Mode 전환 방법(`APP_MODE`), Alembic 마이그레이션, 수집 간격 설정을 한국어로 최종 정리
    - 새 개발자가 README만으로 30분 내 기동 가능하도록 검증
    - _Requirements: 1.5, 2.5, 20.4_
    - _Design: Phased Delivery 매핑(단계 8)_

  - [ ]* 8.3 성능 측정 스크립트 작성
    - `backend/scripts/perf_check.py`로 `/api/*` 응답 시간(캐시 hit/miss) 및 Worker 60초 SLA 측정
    - _Requirements: 20.2, 20.3_

## Notes

- `*` 표시 sub-task는 선택적(테스트/모니터링/측정)이며 MVP 빠른 인도를 위해 건너뛸 수 있다. 핵심 구현 task는 절대 optional로 표시하지 않는다.
- 단계 1~2는 mock으로 end-to-end 동작을 우선 확보하고, 단계 3~6에서 실제 DB/외부 연동으로 점진 교체하며, 외부 인터페이스(엔드포인트·스키마)는 고정하여 회귀를 방지한다(R2.6, Property 6).
- 8개 Correctness Property(P1~P8)는 각 구현 task 직후에 검증 task로 배치했다: P4(2.3), P3(3.4), P1(3.6), P2(3.7), P5(3.8), P7(3.9), P6(4.5), P8(5.2).
- 모든 task는 design.md의 디렉터리 구조/엔드포인트/데이터 모델/Redis 키 규약/Celery 정의를 그대로 참조한다.
- Azure AD 자격 증명 발급, 운영 배포, 사용자 수동 테스트는 코딩 task가 아니므로 제외했다(필요 시 README의 운영 절차로 안내).
