# Tasks

## 작업 분해 구조 (WBS) — 전체 산출물 기준

> 아래는 지금까지 구현된 v1.0(운영 피드백 반영 포함) 전체를 **기능 단위 작업 패키지(WP)**로 정리한 것이다. WBS 작성용 상위 구조이며, 각 WP는 하단 Phase 0~13의 상세 task로 뒷받침된다. 상태: [완료]/[일부]/[예정].
> 표기: WP번호 · 범위 · (관련 task / Requirement)

- **WP1. 프로젝트 기반/인프라** [완료]
  - 1.1 저장소·Docker Compose·`.env`·README (task 1 / R25,R26)
  - 1.2 Backend 골격 + Alembic(스키마 bip) + config/logging/timezone (task 2 / R28,R29)
  - 1.3 Frontend 골격(Vite/React/TS/Tailwind, Query/Zustand/Router, vitest) (task 3 / R25)
  - 1.4 로컬 실행/워커 안정화: dev-up.cmd·run_worker·run_beat·redis-up/down, async_runner(run_async), Celery `--pool=solo`+Beat, uvicorn --reload (task 55 / R37,R25)

- **WP2. 데이터 모델·마이그레이션** [완료]
  - 2.1 Auth/Users/Roles/Departments/LocalAdmin (task 4 / R29,R7)
  - 2.2 Groups/Reports/Permissions/Folders/Datasets/Workspaces (task 5 / R29,R5,R8,R41)
  - 2.3 Refresh/Mail/Job/Export/ReportImage (task 6 / R29,R14,R16,R37)
  - 2.4 Audit/System + 인덱스 + CI up/down 검증 (task 7 / R29,R35)
  - 2.5 서비스센터(requests/첨부/댓글/완료예정일) (task 46,47-A,47-B,53 / R17)
  - 2.6 피드백 마이그레이션: mail sender_email(a4d9e1c6b820), role_menu_permissions drop(b7f2a3d9c410), user_groups.source_dept_id(c1a8e5b2f930), requests.expected_completion_date(f3b1c8d47a20)

- **WP3. 인증/세션** [완료]
  - 3.1 PowerBI Client(Protocol/live/mock) + Token Service(Azure AD+Redis) (task 8 / R32,R38)
  - 3.2 HR DB 인증(SHA-256³) + AUTH_MODE 토글 + 부서 한글명(dept_name) 매핑 (task 9,58 / R1,R33,R39)
  - 3.3 세션 서비스(Redis, TTL, 사용자별 세션 추적/무효화) (task 10 / R39,R4)
  - 3.4 사용자 자동 매핑 + 로컬 관리자(argon2id) (task 11 / R2,R3,R39)
  - 3.5 인증 API(login/local/logout/me, deps 권한 가드) (task 12 / R1,R2,R22,R23)

- **WP4. 사용자/그룹/역할/권한 관리** [완료]
  - 4.1 권한 계산 서비스(user/role/dept/group 합집합, Redis 캐시) (task 13 / R8,R22,R24)
  - 4.2 사용자 관리 API + 조직도(org: 회사/트리/구성원, 자동등록) (task 14 / R4)
  - 4.3 그룹 API + **조직 기반 팀 그룹 자동생성/완전동기화**(source_dept_id, 미리보기/적용) + **전체 조직 트리 뷰**(/api/groups/tree) (task 15,62 / R5,R6,R8)
  - 4.4 역할(**메뉴 고정 매핑**, 매트릭스 제거) + 레포트 권한(부여/회수, **다중 부여 bulk**, MANAGE_REPORT='교체') (task 16,60,61 / R7,R8,R23)

- **WP5. 레포트 카탈로그/폴더** [완료]
  - 5.1 폴더 API/트리(권한 필터, 삭제 409) (task 17 / R41)
  - 5.2 레포트 등록/관리(**PBIX 업로드 게시로 일원화**, ID수동등록/기존레포트게시 제거) (task 18,59 / R11,R12)
  - 5.3 PBIX Import Worker(업로드→게시→카탈로그) (task 19 / R12,R40)
  - 5.4 사이드바 탐색기 트리 + 즐겨찾기 + HomePage 랜딩 (task 36,54 / R8,R19,R24,R41)

- **WP6. Power BI Embedded / 새로고침** [완료]
  - 6.1 Embed Token 발급(App-Owns-Data, master 비노출) (task 20 / R9,R24,R38)
  - 6.2 새로고침 상태(라이브) + **갱신 예정 시각(예약)** 표시 (task 21,63 / R10)
  - 6.3 수동 새로고침(분산 락, 워커 위임, 진행 도크) (task 22 / R13,R37)
  - 6.4 Refresh History 수집(collector) + **카탈로그 자동등록 중단** + 정리 스크립트 (task 23,59 / R14,R30)
  - 6.5 Refresh 실행 현황 화면(PRM 이식) + 운영 콘솔 편입(전용 툴바/인라인 오류배너/즉시수집 보강) (task 24,64 / R15,R19)
  - 6.6 레포트 뷰(임베드, 보기옵션, 페이지 드롭다운·숨김페이지 제외, 실제크기 기본, 배경/스크롤, 새 데이터 반영 배너) (task 37,54 / R9,R10,R13)

- **WP7. Export / 메일 발송** [완료]
  - 7.1 StorageService(local/nas) (task 26 / R16,R31)
  - 7.2 독립 Export API(DOWNLOAD) (task 25 / R9.6,R9.7,R8)
  - 7.3 메일 스케줄 CRUD(친화 스케줄, 수신자 USER/GROUP/DEPT/EMAIL, 받는사람/참조/숨은참조, 페이지 다중·순서, **sender_email**) (task 27,56,70 / R16)
  - 7.4 Export→ZIP→Image 파이프라인(**페이지별 export**) (task 28,56 / R16.3-16.9)
  - 7.5 Pillow 이미지 리사이즈 (task 29 / R16.17)
  - 7.6 템플릿 조립(**리치 본문 서식/줄바꿈**, CID inline, **평문 대체본**) + SMTP 발송 (task 30,56 / R16.10,R16.14,R34)
  - 7.7 Mail_Job 관리·분산락·멱등 + **발송 겹침/누락 방지** (task 31,56 / R16.11-13,R37)
  - 7.8 메일 스케줄 화면(리치 에디터, 가로 2단, 수신자 리스트/순서) (task 39,56 / R16)

- **WP8. 감사/통계/모니터링** [완료]
  - 8.1 감사 로그 서비스+API(시크릿 마스킹) (task 32 / R35,R38)
  - 8.2 통계 대시보드 + **레포트별 통계 권한(VIEW_STATS)** (task 33,57 / R18)
  - 8.3 운영 상태 모니터링(health/status) (task 34 / R36)

- **WP9. 서비스 센터(R17)** [완료]
  - 9.1 백엔드 API(유형 문의/에러/개선요청, 상태 대기/접수/반려/완료, 완료예정일, 관리자 알림) (task 46,53 / R17)
  - 9.2 첨부/댓글(대화) (task 47-A,47-B / R17.5-17.9)
  - 9.3 프런트 화면(목록/필터/생성/상세, 시간 KST) (task 47,53,58 / R17)

- **WP10. 화면(Frontend) 공통** [완료]
  - 10.1 로그인 화면 (task 35 / R1,R2,R28)
  - 10.2 관리자 콘솔 셸/네비 + 앱 레이아웃(뷰포트 고정/콘텐츠 스크롤) (task 38,54 / R4-R8)
  - 10.3 한국어화/오류 처리 (R28)

- **WP11. 공휴일/보존/배포** [일부]
  - 11.1 공휴일 관리(holidays 라이브러리 시드, 발송 제외) (task 43 관련 / R16)
  - 11.2 보존 정리 작업 + 이미지 권한 다운로드 (task 43 / R31)
  - 11.3 nginx + 배포 최종화 (task 44 / R25,R38)
  - 11.4 운영 이관 준비(체크리스트/.env.prod) — [예정] (task 45 / R25,R26)

- **WP12. 테스트/릴리스 게이트** [완료]
  - 12.1 Tier1 PBT(P1~P11) (task 40 / 릴리스 게이트)
  - 12.2 핵심 통합 테스트 (task 41)
  - 12.3 보안/성능 검증 (task 42 / R27,R38)

- **WP13. v1.1+ (범위 외)** [예정] — Job_Context 다중부서, 전체 PRM 대시보드, AI 분석, Embedded 자동 스케일, 서비스센터 고도화 잔여 (task 48-52)

---

## Phase 0: 프로젝트 셋업

- [x] 1. 저장소 구조 및 Docker Compose 초기화
  - 디렉터리: backend/, frontend/, nginx/, docker-compose.yml, docker-compose.test.yml
  - PRM Compose에서 postgres 제거, nginx 추가, 외부 RDS DATABASE_URL 연결
  - .env.example 작성 — SSL 무시 기본값 포함: `POWERBI_VERIFY_SSL=false`, `DATABASE_SSL=disable`
  - 한국어 README.md 작성
  - _Requirements: R25, R26_

- [x] 2. Backend 골격 + Alembic 초기화
  - `python -m venv backend/.venv` 로컬 개발용 가상환경 구성 (Docker Compose 빌드와 별개)
  - 이후 모든 backend 로컬 작업은 `backend/.venv` 활성화 후 진행
  - FastAPI main.py + lifespan, core/config.py (PRM 확장)
  - core/logging.py structlog + secret 마스킹 (PRM 재활용)
  - core/timezone.py, core/errors.py, core/constants.py (PRM 재활용)
  - Alembic 설정: version_table_schema=bip, search_path=bip,public
  - db/session.py asyncpg pool, db/redis.py (PRM 재활용)
  - _Requirements: R25, R28, R29_

- [x] 3. Frontend 골격
  - Vite 6 + React 19 + TypeScript + Tailwind v4 초기화
  - TanStack Query, Zustand, React Router v6 설치
  - App.tsx + AuthGuard + Sidebar/Header 레이아웃
  - api/client.ts 기본 클라이언트
  - vitest + testing-library + msw 설정
  - _Requirements: R25_

## Phase 1: 데이터 모델 마이그레이션

- [x] 4. Auth/Users/Roles 테이블 마이그레이션
  - departments, users, roles, user_roles, local_admins 테이블 생성
  - users.external_id UNIQUE, user_roles PK=(user_id, role_id)
  - 역할 시드: General_User, Super_User, System_Operator 멱등 삽입
  - _Requirements: R29, R7_

- [x] 5. Groups/Reports/Permissions 테이블 마이그레이션
  - user_groups, user_group_members, workspaces 테이블 생성
  - report_folders (자기참조 트리), reports UNIQUE(workspace_id, report_id)
  - datasets, report_permissions UNIQUE(report_id, subject_type, subject_id, permission)
  - _Requirements: R29, R5, R8, R41_

- [x] 6. Refresh/Mail/Job 테이블 마이그레이션
  - refresh_runs UNIQUE(workspace_id, dataset_id, request_id) (PRM 계승)
  - refresh_schedules (PRM 계승)
  - mail_schedules, mail_recipients, mail_schedule_pages
  - mail_jobs UNIQUE(mail_schedule_id, run_key)
  - export_jobs (mail_job_id nullable - standalone export 지원)
  - report_image_paths
  - _Requirements: R29, R14, R16, R37_

- [x] 7. Audit/System 테이블 + 인덱스 + CI 검증
  - audit_logs (occurred_at_utc, meta jsonb)
  - 인덱스: audit_logs(action, occurred_at_utc), reports(is_published), report_permissions(subject_type, subject_id) 등
  - CI: docker-compose.test.yml PG에서 alembic upgrade head → downgrade 검증
  - _Requirements: R29, R35_

## Phase 2: 인증/세션

- [x] 8. PowerBI Client + Token Service (PRM 재활용)
  - services/powerbi/client.py Protocol + live_client.py + mock_client.py
  - token_service.py Azure AD client credentials + Redis 캐싱
  - APP_MODE=mock/live 토글 (PRM 계승)
  - _Requirements: R32, R38_

- [x] 9. HR DB 인증 (hr_authenticator)
  - auth/hr_authenticator.py: scl_v_insa_user_add_pwd에서 login_pwd 조회
  - SHA-256 3회 해시 구현 (실제 샘플로 라운드 입력 형태 hex/bytes 검증)
  - AUTH_MODE=hr-db/mock/local-only 토글
  - Property 11 PBT: test_password_hash.py - 결정성 + authenticate ⟺ h(p)==stored
  - _Requirements: R1, R33, R39_

- [x] 10. 세션 서비스 (session_service)
  - auth/session_service.py: Redis bip:session:{id} + TTL(SESSION_TTL_MINUTES)
  - bip:user_sessions:{user_id} Set - 사용자별 세션 ID 추적
  - 로그아웃 시 세션 삭제, 만료 시 재인증 유도
  - _Requirements: R39, R4_

- [x] 11. 사용자 자동 매핑 + 로컬 관리자
  - auth/user_mapper.py: 최초 로그인 생성 + General_User 부여, 재로그인 갱신
  - bass_dept_yn='Y' 우선 기본 부서 선정
  - auth/local_admin.py: argon2id 검증, 실패 횟수 제한
  - auth/password_hash.py argon2id 래퍼
  - _Requirements: R2, R3, R39_

- [x] 12. 인증 API (/api/auth)
  - POST /api/auth/login, POST /api/auth/local/login
  - POST /api/auth/logout, GET /api/auth/me
  - deps.py: get_current_user, require_role, require_report_permission
  - Audit_Log: login success/failure
  - _Requirements: R1, R2, R22, R23_

## Phase 3: 사용자/그룹/역할/권한 API

- [x] 13. 권한 계산 서비스 (permission_service)
  - services/permission_service.py: VIEW/DOWNLOAD/REFRESH/MANAGE_REPORT 합집합 쿼리
  - 부서 출처 = users.department_id (v1.0 단일)
  - Redis 단기 캐시 bip:perm:{user_id} + 변경 시 무효화
  - Property 1 PBT: test_permission_union.py - 4종 주체 합집합 동치성 (200+회)
  - Property 2 PBT: test_report_list_visibility.py - VIEW AND is_published
  - _Requirements: R8, R22, R24_

- [x] 14. 사용자 관리 API
  - GET /api/users, PATCH /api/users/{id}/status
  - 비활성화 시: bip:user_sessions:{id} Set 조회 → 모든 세션 즉시 Redis 삭제
  - Audit_Log: admin_setting_change
  - _Requirements: R4_

- [x] 15. 그룹 + 그룹원 API
  - POST/PATCH/DELETE /api/groups
  - POST/DELETE /api/groups/{id}/members (멱등, UNIQUE 충돌 무시)
  - 그룹 삭제 시 report_permissions, user_group_members CASCADE
  - Property 9 example 테스트: 멱등 + 최소 역할 invariant
  - 조직도 기반 팀 그룹 자동 생성/완전 동기화: `POST /api/org/sync-team-groups`(`user_groups.source_dept_id`, 미리보기/적용, 자동 그룹만 mirror). D-25
  - _Requirements: R5, R6, R8_

- [x] 16. 역할 + 레포트 권한 API
  - GET /api/roles, POST/DELETE /api/users/{id}/roles (General_User 최소 보장)
  - POST/DELETE/GET /api/reports/{id}/permissions
  - _Requirements: R7, R8_

## Phase 4: 레포트 카탈로그 + 폴더

- [x] 17. 레포트 폴더 API
  - GET/POST/PATCH/DELETE /api/report-folders
  - GET /api/report-folders/tree: 폴더 트리 + VIEW 권한 필터
  - 삭제 시 하위 폴더/레포트 존재하면 HTTP 409 거부
  - Audit_Log: report_update
  - _Requirements: R41_

- [x] 18. 레포트 등록/관리 API
  - ~~POST /api/reports: ID 수동 등록~~ (제거됨 — 기존 레포트 게시 폐지, PBIX 업로드로 일원화. D-15 갱신)
  - PATCH /api/reports/{id}, PATCH /api/reports/{id}/visibility
  - PATCH /api/reports/{id}/folder
  - GET /api/reports: VIEW + is_published 필터
  - Audit_Log: report_create/update/visibility_change
  - _Requirements: R11, R12_

- [x] 19. PBIX Import API 업로드
  - POST /api/reports/{id}/pbix: 형식/크기/확장자 검증
  - workers/tasks/pbix_import.py: POST imports → polling → 카탈로그 반영 + workspace auto-upsert
  - GET /api/reports/imports/{importId}: 진행 조회
  - 업로드 완료 시 "게이트웨이 설정 필요" 안내
  - _Requirements: R12, R40_

## Phase 5: Power BI Embedded + 새로고침

- [x] 20. Embed Token 발급 (embed_service)
  - services/powerbi/embed_service.py: GenerateToken App-Owns-Data
  - GET /api/reports/{id}/embed: VIEW 권한 검증 → Embed Token
  - master token/secret 응답 미포함 보장
  - Audit_Log: report_view
  - Property 3 PBT: test_embed_token_scope.py - 무권한 403, 토큰 범위, master 비포함
  - _Requirements: R9, R24, R38_

- [x] 21. 새로고침 상태 표시 API
  - GET /api/reports/{id}/refresh-status
  - PRM refresh_query.py, summary.py 재활용
  - 이력 없으면 "새로고침 이력 없음" 반환
  - _Requirements: R10_

- [x] 22. 수동 새로고침 (Worker 위임)
  - POST /api/datasets/{id}/refresh: REFRESH 권한 → 분산 락 → Celery enqueue
  - workers/tasks/refresh_trigger.py
  - 진행 중이면 409 반환
  - Property 4 PBT: test_distributed_lock.py - N개 동시 acquire 중 exactly 1 성공 (PRM 재활용)
  - _Requirements: R13, R37_

- [x] 23. Refresh History 수집 (PRM Collector 재활용)
  - workers/tasks/collect.py PRM 이식
  - POST /api/collect-now: 즉시 동기화
  - Celery Beat COLLECT_INTERVAL_MINUTES 주기
  - Property 5 PBT: test_refresh_upsert.py - upsert 멱등성 (PRM 재활용)
  - Property 6 PBT: test_timezone_roundtrip.py - UTC↔Local (PRM 재활용)
  - _Requirements: R14, R30_

- [x] 24. PRM Refresh 실행 현황 화면 편입 (Frontend)
  - routes/monitoring/RefreshStatusPage.tsx
  - PRM Gantt/KPI/타임테이블 컴포넌트 이식
  - BIP 공통 레이아웃 + AuthGuard 안에서 렌더링
  - _Requirements: R15, R19_

## Phase 6: 직접 Export API

- [x] 25. 독립 Export API (DOWNLOAD 권한)
  - services/powerbi/export_service.py: Export to File 시작 + polling
  - POST /api/reports/{id}/export: DOWNLOAD 권한 → export_poll task → 202 {export_job_id}
  - GET /api/exports/{id}: 요청자 소유 확인 → status + 다운로드 수단
  - export_jobs.mail_job_id nullable (standalone)
  - StorageService 추상화 (T-26 선행)
  - Audit_Log: export_run
  - _Requirements: R9.6, R9.7, R8_

## Phase 7: 메일 발송 파이프라인

- [x] 26. StorageService 추상화
  - services/storage_service.py: save/open/delete/url_for 인터페이스
  - local(Docker volume), nas(마운트) 구현체
  - STORAGE_BACKEND, STORAGE_ROOT_PATH env
  - _Requirements: R16, R31_

- [x] 27. 메일 스케줄 CRUD API
  - GET/POST/PATCH/DELETE /api/mail-schedules
  - mail_schedule + mail_recipients + mail_schedule_pages 복합 저장
  - 수신자: USER/GROUP/DEPARTMENT/EMAIL, CHECK 제약
  - 커스터마이징: subject_template, body_header/footer, image_width, image_resize_px, sort_order
  - _Requirements: R16.1, R16.2, R16.14, R16.15_

- [x] 28. Export→ZIP→Image 파이프라인 (Worker)
  - workers/tasks/mail_job.py: 메인 파이프라인
  - 각 페이지: Export to File → polling → result.zip → extracted 해제 → StorageService → Report_Image_Path DB
  - export_jobs status: NotStarted → Running → Succeeded/Failed
  - EXPORT_POLL_INTERVAL_SEC, EXPORT_POLL_TIMEOUT_SEC
  - _Requirements: R16.3-16.9_

- [x] 29. Pillow 이미지 리사이즈 (image_service)
  - services/mail/image_service.py: 다운스케일 (비율 유지, 업스케일 금지)
  - 원본(variant=original) + 리사이즈본(variant=resized) 별도 저장
  - 리사이즈 실패 시 원본 fallback
  - _Requirements: R16.17_

- [x] 30. 메일 템플릿 조립 + SMTP 발송
  - services/mail/template.py: HTML 조립 (header → CID inline 이미지 → footer), XSS sanitize
  - {date} 등 치환 변수 렌더링
  - services/mail/mail_service.py: aiosmtplib, multipart/related + Content-ID
  - 수신자 전개 (GROUP/DEPT → cmp_email), 중복 제거
  - MAIL_RETRY_MAX 재시도, Audit_Log: mail_send
  - _Requirements: R16.10, R16.14, R16.16, R34_

- [x] 31. Mail_Job 관리 + 분산 락 + 멱등 처리
  - Redis 락 bip:lock:mail:{mail_schedule_id}
  - UNIQUE(mail_schedule_id, run_key) 중복 회차 차단
  - 부분 실패 시 Mail_Job status=failed + 실패 페이지 목록
  - GET /api/mail-jobs, POST /api/mail-jobs/{id}/retry
  - Celery Beat cron_expr 기반 트리거
  - Property 7 PBT: test_mail_multipage.py - |P| export_jobs, |P| original images
  - Property 8 example: 부분 실패 시 failed + failure_reason
  - _Requirements: R16.11-16.13, R37_

## Phase 8: 감사 로그 + 통계 + 모니터링

- [x] 32. 감사 로그 서비스 + API
  - services/audit_service.py: append() + secret 화이트리스트 마스킹
  - GET /api/audit-logs: 기간/주체/행위 필터 (System_Operator)
  - powerbi_api_failure action: PowerBI_Client 공통 오류 경로에서 기록
  - Property 10 PBT: test_audit_secret_masking.py - 임의 메타에서 시크릿 비포함
  - _Requirements: R35, R38_

- [x] 33. 통계 대시보드 API
  - GET /api/stats/overview: 로그인/조회/새로고침/메일 성공+실패 수
  - GET /api/stats/usage: TOP10, 부서별/월별, 사용자별, 미사용(UNUSED_REPORT_DAYS)
  - 기간 필터(from/to), 집계 캐시 60s
  - _Requirements: R18_

- [x] 34. 운영 상태 모니터링 API
  - GET /api/health (익명)
  - GET /api/monitoring/status: DB/Redis/Worker/최근 작업
  - _Requirements: R36_

## Phase 9: Frontend 주요 화면

- [x] 35. 로그인 화면
  - routes/LoginPage.tsx: glassmorphism 카드, 사번/비밀번호 입력
  - 비밀번호 표시/숨김 토글, 로컬 관리자 보조 링크
  - 401 시 한국어 오류
  - _Requirements: R1, R2, R28_

- [x] 36. 레포트 목록 + 폴더 트리 (HomePage)
  - routes/HomePage.tsx: 사이드바 폴더 트리 + VIEW 권한 필터 목록
  - TanStack Query refetchInterval auto-refresh
  - _Requirements: R8, R19, R24, R41_

- [x] 37. 레포트 뷰 화면 (ReportViewPage)
  - routes/ReportViewPage.tsx: Power BI Embed 렌더링
  - components/embed/PowerBIEmbed.tsx: powerbi-client-react 래퍼
  - components/refresh/RefreshStatusBadge.tsx
  - 수동 새로고침 버튼 (REFRESH 권한 시 노출)
  - _Requirements: R9, R10, R13_

- [x] 38. 관리자 화면
  - routes/admin/UsersPage.tsx: 사용자 목록 + 비활성화/재활성화
  - routes/admin/GroupsPage.tsx (역할별 메뉴 매트릭스 페이지는 제거됨 — 역할→메뉴 코드 고정 매핑으로 전환, D-24)
  - routes/admin/ReportAdminPage.tsx: 레포트 등록(ID/PBIX) + 폴더 관리
  - routes/admin/ReportPermissionPage.tsx: 권한 부여/회수
  - routes/admin/AuditLogPage.tsx
  - _Requirements: R4-R8, R11, R12, R35, R41_

- [x] 39. 메일 + 통계 + 모니터링 화면
  - routes/mail/MailSchedulePage.tsx, MailJobHistoryPage.tsx
  - routes/stats/StatsDashboardPage.tsx
  - routes/monitoring/OpsStatusPage.tsx
  - _Requirements: R16, R18, R36_

## Phase 10: 테스트 완성 + 릴리스 게이트

- [x] 40. Tier 1 PBT 완성 (v1.0 릴리스 게이트)
  - P1 test_permission_union.py: @settings(max_examples=200)
  - P2 test_report_list_visibility.py
  - P3 test_embed_token_scope.py
  - P4 test_distributed_lock.py (PRM 재활용)
  - P5 test_refresh_upsert.py (PRM 재활용)
  - P6 test_timezone_roundtrip.py (PRM 재활용)
  - P7 test_mail_multipage.py
  - P10 test_audit_secret_masking.py
  - P11 test_password_hash.py
  - _Requirements: 릴리스 게이트_

- [x] 41. 핵심 통합 테스트
  - 로그인 성공/실패 (SHA-256 실제 샘플)
  - 비활성화 → 즉시 세션 무효화 → 401
  - Embed Token 발급 + 무권한 403
  - 메일 파이프라인 (mock Export)
  - PBIX Import polling
  - 직접 Export API (DOWNLOAD 권한)
  - 폴더 삭제 거부 (409)
  - _Requirements: 모든 핵심 경로_

- [x] 42. 보안 + 성능 검증
  - secret 마스킹 검증 (로그/응답에 미포함)
  - 조회 SLA 측정: 캐시 hit 200ms, miss 1000ms
  - docker compose up → /api/health smoke test
  - _Requirements: R27, R38_

## Phase 11: 운영 준비

- [x] 43. 보존 정리 작업 + 이미지 접근
  - Celery Beat 주기 작업: IMAGE_RETENTION_DAYS, AUDIT_RETENTION_DAYS 기준 삭제
  - GET /api/report-images/{id}: 권한 검증 다운로드 스트리밍
  - _Requirements: R31_

- [x] 44. nginx 설정 + 배포 최종화
  - /api/* → backend, / → frontend 정적 서빙
  - SERVE_REPORTIMAGE_STATIC=false 기본 (권한 우회 방지)
  - TLS 종단 설정
  - _Requirements: R25, R38_

- [ ] 45. 운영 이관 준비
  - 개발계→운영계 이관 체크리스트 (D-23)
  - Embedded 서버 이전 절차 (D-22)
  - .env.prod 작성 가이드
  - _Requirements: R25, R26_

## Phase 12: 서비스 센터 (R17)

- [x] 46. 서비스 센터 Backend API
  - models/request_center.py: `bip.requests` (requester_id FK→users, request_type[inquiry/error_fix], title, body, status[received/in_progress/done/rejected] default received, operator_response nullable, reject_reason nullable, created_at, updated_at)
  - Alembic 마이그레이션: requests 테이블 + idx(requester_id), idx(status)
  - schemas/request_center.py: RequestCreate(request_type, title, body), RequestUpdate(status, operator_response, reject_reason), RequestResponse
  - api/routes/requests.py:
    - POST /api/requests: 인증 사용자 생성, requester_id는 세션 사용자로 강제
    - GET /api/requests: 일반=본인만, System_Operator=전체(status/주체 필터)
    - GET /api/requests/{id}: 소유자 또는 System_Operator
    - PATCH /api/requests/{id}: System_Operator만 status 변경 + operator_response 등록, rejected 전환 시 reject_reason 필수(누락 시 400)
  - deps: 생성/조회=get_current_user, 변경=require_role(System_Operator), 소유권 검증
  - Audit_Log: request_create / request_update(반려 시 사유 요약)
  - 라우터 등록 (api/routes/__init__.py)
  - _Requirements: R17.1-17.5, R23, R29.1_

- [x] 47. 서비스 센터 Frontend 화면
  - routes/requests/ServiceCenterPage.tsx: 내 요청 목록 + 생성 폼(유형/제목/본문)
  - routes/admin/RequestAdminPage.tsx: 전체 요청 처리(상태 변경, 응답 등록, 반려 사유 입력) — 관리자 콘솔 메뉴
  - 사이드바 메뉴 추가(사용자: 서비스 센터 / 관리자 콘솔: 요청 관리)
  - TanStack Query 연동, 본문 XSS escape, 한국어 메시지
  - _Requirements: R17, R28.2_

- [x] 47-A. 서비스 센터 파일 첨부 (R17.5)
  - models: RequestAttachment(`bip.request_attachments`) + Alembic 마이그레이션
  - StorageService 재사용(`request-attachments/{id}/{uuid}{ext}`), 허용 형식/크기(REQUEST_ATTACHMENT_MAX_MB) 검증
  - API: POST/GET `/api/requests/{id}/attachments`, GET/DELETE `/api/request-attachments/{id}`(권한 검증 스트리밍, 이미지 inline)
  - 응답에 attachments 메타 포함, Frontend 업로드 UI(다중 선택)·다운로드 링크·삭제
  - _Requirements: R17.5, R31_

- [x] 47-B. 서비스 센터 고도화: 우선순위/SLA · 댓글 · 알림 (R17.6-17.9, 구 task 52)
  - 우선순위: requests.priority(low/normal/high/urgent), REQUEST_SLA_HOURS 기반 sla_due_at/is_overdue 산정(응답 파생값)
  - 댓글: RequestComment(`bip.request_comments`), POST `/api/requests/{id}/comments`(소유자/운영자), 응답에 comments 포함
  - 알림: services/request_notify.py, FastAPI BackgroundTasks best-effort 메일(REQUEST_NOTIFY_ENABLED), 새 요청→운영자 / 상태변경·응답→요청자 / 댓글→상대방
  - Alembic 마이그레이션(priority 컬럼 + request_comments), Audit: request_comment
  - Frontend: 우선순위 select/배지, SLA 지연 배지, 공용 RequestComments 컴포넌트(사용자·관리자)
  - _Requirements: R17.6-17.9, R34_

## Phase 13: 운영 피드백 반영 (2026-06~07)

> 파일럿 사용 중 요청·버그를 반영한 v1.0 범위 내 변경. 상세 결정은 D-15/D-24/D-25 참조.

- [x] 53. 서비스 센터 R17 개편 (사진 기반)
  - 유형: inquiry(문의)/error(에러)/improvement(개선요청). 상태: pending(대기, 기본)/received(접수)/rejected(반려)/done(완료)
  - 우선순위·SLA·공개범위·대상화면 UI 제거(대상은 본문에 기술), 관리자 `expected_completion_date`(완료예정일) 추가(마이그레이션 f3b1c8d47a20)
  - 신규 요청 시 고정 관리자 메일(settings.REQUEST_ADMIN_EMAIL=220042@samchully.co.kr)로 알림
  - 응답에 requester_department 포함(users↔departments 조인), 목록 필터(status/type/q)
  - Frontend: ServiceCenterPage(목록+필터+생성모달+페이지네이션), RequestDetailModal(내용+대화 / 관리자 처리), RequestAdminPage는 ServiceCenterPage 재사용
  - _Requirements: R17_

- [x] 54. 레포트 사이드바 탐색기 개편
  - SidebarFolderTree: 폴더 확장 + 리프 레포트 lazy 로드(reportsApi.list(folderId)) → /reports/:id, "전체 레포트" 제거, 즐겨찾기 메뉴(항상 노란 별)
  - HomePage: 랜딩 + 즐겨찾기(카드 그리드 제거)
  - _Requirements: R8, R19, R24, R41_

- [x] 55. Worker/개발 인프라 안정화
  - workers/async_runner.py(run_async 지속 루프)로 'Event loop is closed' 해소, 모든 worker 태스크 asyncio.run→run_async 전환
  - Windows Celery는 --pool=solo, Celery Beat 상시 구동
  - dev-up.cmd(Redis 컨테이너 + Worker/Beat/Backend/Frontend 4창), run_worker.cmd/run_beat.cmd/redis-up.cmd/redis-down.cmd (모두 ASCII)
  - 업로드 중 새로고침/이탈 경고(useBeforeUnload), useTaskStore localStorage 영속 + 완료 작업 자동 정리(BackgroundTaskDock)
  - _Requirements: R37, R25_

- [x] 56. 메일 스케줄 고도화
  - 페이지 다중 선택(페이지명) + 발송 순서(sort_order), 친화 스케줄(schedule_freq/time/days/day_of_month/start_date/end_date → cron), 발송 겹침·누락 방지(catch-up 10분 + run_key + skip-if-existing)
  - 수신자 이름 선택(USER/GROUP/DEPARTMENT/EMAIL) + 입력창 1개 → 아래 리스트 + 드래그/화살표 순서변경
  - 리치 본문 에디터(굵기/기울임/밑줄/정렬/글꼴/크기, 줄바꿈), 폼 가로 2단 레이아웃
  - 보내는 사람 스케줄별 지정(mail_schedules.sender_email, 마이그레이션 a4d9e1c6b820, 비우면 SMTP_FROM)
  - 페이지별 export(powerBIReportConfiguration.pages)로 "첫 페이지만 전송" 버그 수정, 이미지 위 페이지명 라벨 제거
  - 모바일 그룹웨어 알림용 text/plain 대체본을 실제 본문/제목으로(안내문구 대신)
  - sanitizer(nh3) 인라인 style 허용(정렬/폰트/굵기/색만, attribute_filter)
  - _Requirements: R16, R34, R40_

- [x] 57. 레포트별 통계 권한
  - PermissionAction.VIEW_STATS(레포트별 통계 조회), 통계 범위: operator=전체 / Super_User=VIEW_STATS 보유 레포트, GET /api/stats/reports + report_id 필터
  - 레포트 등록/업로드 시 작성자에게 VIEW_STATS 자동 부여, '잡 현황' 카드 제거
  - _Requirements: R18_

- [x] 58. 버그 수정: 시간·부서명
  - 서비스 센터 시간 KST 표기: requests 응답 datetime을 to_local()로(+09:00), 프런트 포매터 timeZone 'Asia/Seoul' 고정
  - 부서 코드→한글명: HRProfile.dept_name 추가 + hr_authenticator가 scl_v_insa_dept_add_depth에서 조회, user_mapper가 한글명 저장 + 재로그인 시 코드→한글명 백필, backfill_department_names.py 일괄 스크립트
  - _Requirements: R2, R17, R33_

- [x] 59. 레포트 카탈로그 큐레이션 (기존 레포트 게시 제거, D-15)
  - "기존 레포트 게시"(ID 수동 등록 + GET /api/powerbi/workspace-reports) 프런트/백엔드 제거, PBIX 업로드 게시로 일원화
  - 수집기(collect_workspace)의 reports 자동 등록 중단(upsert_reports 갱신-only), 기존 자동 등록분 정리 cleanup_autocollected_reports.py(created_by_user_id IS NULL 대상, 미리보기/적용)
  - _Requirements: R12_

- [x] 60. 레포트 권한 UX
  - 권한 패널을 하단 인라인 → 정면 모달로, 다중 권한 부여(POST /api/reports/{id}/permissions/bulk, 멱등), MANAGE_REPORT 표시 라벨 '관리'→'교체'
  - _Requirements: R8_

- [x] 61. 역할-메뉴: 편집형 매트릭스 제거 → 코드 고정 매핑 (D-24)
  - role_menu_permissions 테이블/`/api/roles/menus`/RolesPage 제거(마이그레이션 b7f2a3d9c410 drop), constants.ROLE_MENUS 고정(일반=home, 파워=home+stats, 운영자=전체), allowed_menus를 고정 매핑에서 계산(require_menu 유지)
  - _Requirements: R7, R23_

- [x] 62. 조직도 기반 팀 권한 그룹 자동 생성/동기화 (D-25)
  - user_groups.source_dept_id(마이그레이션 c1a8e5b2f930), POST /api/org/sync-team-groups {dept_id, apply}
  - 선택 조직 하위 '직속 구성원 있는 팀'별 자동 그룹 완전 동기화(추가+제거, 자동 그룹만), 미등록자 자동 등록, 미리보기→적용
  - 이름 충돌 시 점진적 구분(상위조직·팀명 → 회사명·상위조직·팀명), source_dept_id로 재동기화
  - 그룹 관리 화면: GET /api/groups/tree(전체 조직도, cmp_id 옵션, has_members)로 회사·본부·담당·팀 전체 트리 + 노드별 동기화, 수동 그룹은 "기타 그룹"
  - _Requirements: R5, R6, R8_

- [x] 63. 레포트 조회: 갱신 예정 시각 표시 (R10)
  - refresh_schedules(요일/시간/타임존/활성)로 '다음 갱신 예정' 계산(refresh_query.compute_next_scheduled/get_schedule_info, Windows tz→IANA 매핑 + KST 폴백)
  - `GET /api/reports/{id}/live-refresh-status` 응답에 schedule(enabled/days/times/next_scheduled_local) 포함
  - 레포트 뷰: 새로고침 배지 옆 "갱신 예정: …" 표시, 클릭 시 예약 요일·시간 팝오버
  - _Requirements: R10_

- [x] 64. Refresh 현황 화면 통합 마무리 (운영 콘솔 편입)
  - RefreshStatusPage 전용 툴바 신설: 자동 새로고침 토글 / 새로고침 / 즉시 수집 / CSV 내보내기 — 관리자 콘솔 셸(AdminConsoleLayout)이 HeaderActionsContext를 렌더하지 않아 죽어있던 헤더 액션(CSV 내보내기·오류배너)을 페이지로 이전
  - 오류를 페이지 상단 ErrorBanner에 인라인 표시(재시도 포함), useRegisterHeaderActions 제거
  - 콘솔 `<main>` p-6 기준으로 px-6/mx-6 중복 패딩 제거, FilterBar를 풀블리드 스트립→카드로 변경해 정렬 통일
  - 즉시 수집: 기존 monitoring.py `POST /api/collect-now`(task 23) 보강 — response_model=CollectNowOut + HTTP 202 + 감사로그(collect_now) + 게이트 monitoring_ops→monitoring_refresh(유일 호출처가 Refresh 화면). AuditAction.COLLECT_NOW / CollectNowOut 추가
  - 즉시 수집 진행 배너: `GET /api/collect-status`(분산락 점유 여부) 추가, useTaskStore에 'collect' 종류 추가 → 우측 상단 BackgroundTaskDock가 폴링해 "수집 중 → 완료" 표시. useTaskStore localStorage 영속으로 페이지 새로고침 후에도 진행 배너 유지(도크가 복원 폴링), 완료 시 refresh-timetable/history/summary 무효화, 수집 중 버튼 비활성
  - '데이터 안 보임' 버그 수정 + 단일 일자 조회 전환: 며칠 범위는 간트/차트 가시성이 낮아 조회를 '단일 일자'로 고정(FilterBar를 기간 from/to → 단일 date 선택으로, 스냅샷/조회버튼 제거하고 store 값 변경 즉시 반영). 최초 진입 시 `GET /api/refresh-latest-date`(데이터가 있는 최신 일자, LatestDateOut)로 기본 선택을 1회 자동 설정(오늘 갱신이 없어도 최근 실행일이 바로 보이도록, store.selectedDateInitialized). KPI/요약/실행흐름은 단일 일자 `/api/summary`가 아니라 표시 중 runs에서 클라이언트 계산(utils/summary.ts computeSummary, build_summary 동치)하여 화면 전체를 선택 일자 기준으로 일관(RefreshStatusPage는 useSummary/useRefreshHistory 미사용)
  - 하단 분석 카드 개편: '가장 오래 걸린 리포트'→TOP5 리스트(리포트명·시작시각·소요시간, LongestRunCard runs 기반), '리포트별 소요 시간' bar chart 제거(DurationBarChart 삭제), '시간대별 추이'→30분 단위 48버킷+가로 확장(overflow-x-auto), '성공/실패 비율' 도넛→'실패·경고 리포트' 목록(FailedRunsCard, status failed/unknown)으로 대체(StatusDonutChart 삭제)
  - _Requirements: R14, R15, R19_

- [x] 65. 통계 대시보드 기간 필터 (R18.5)
  - StatsDashboardPage에 기간 필터 추가: 프리셋(전체/최근 7·30·90일) + 직접 선택(시작~종료 date input). KST 하루 경계를 UTC ISO로 변환해 overview/usage 쿼리에 from/to 전달(백엔드 stats 라우트는 이미 from/to 지원). 기본값 '전체'
  - dashboardApi.overview/usage에 from/to 인자 추가, 쿼리키에 기간 포함해 변경 시 재조회
  - _Requirements: R18.5_

- [x] 67. 세션 만료 정책 강화 (idle 슬라이딩 + absolute 상한 + 쿠키 보안)
  - `SESSION_TTL_MINUTES`(단일 절대 8h) → `SESSION_IDLE_MINUTES`(120, 마지막 활동 기준 슬라이딩) + `SESSION_ABSOLUTE_MINUTES`(720, 로그인 상한). get_session이 접근 시 Redis TTL을 idle로 갱신(absolute 넘지 않게 캡), absolute 초과 시 즉시 폐기. payload에 absolute_exp 저장
  - 쿠키: HttpOnly + `SESSION_COOKIE_SAMESITE`(lax) + `SESSION_COOKIE_SECURE`(env, 운영 HTTPS=true), max_age=absolute. 로그아웃/비활성화 시 서버측 즉시 폐기(기존)
  - opaque Redis 세션 유지(JWT/Refresh Token 미도입 — 즉시 폐기가 기본). 관리자 재인증(step-up)은 범위 제외(사용자 결정)
  - _Requirements: R39_

- [x] 66. 레포트 공통 기본 뷰 저장 (슬라이서/필터 기본값, .pbix 수정 없이)
  - 관리자가 레포트 조회 화면에서 현재 뷰(슬라이서/필터/페이지 선택)를 '공통 기본값'으로 저장 → 이후 모든 뷰어가 그 상태로 시작. Power BI 북마크 state를 저장하는 방식이라 원본 .pbix는 변경/재업로드하지 않음
  - 백엔드: `reports.default_view_state`(TEXT) 컬럼(mig a7c3e9f14d80), `PUT /api/reports/{id}/default-view`(MANAGE_REPORT 게이트, 감사 report_update·target=default_view), embed 응답에 `defaultViewState` 포함
  - 프런트: ReportViewPage 보기 옵션에 '현재 뷰를 기본값으로 저장'/'기본 뷰 초기화'(can_manage). 로드 시 `bookmarksManager.applyState`로 적용, 저장은 `capture({allPages:true})`. reportsApi.saveDefaultView, EmbedInfo.defaultViewState
  - _Requirements: R9_

- [x] 68. 서비스 센터 UX: 채팅 좌/우 분리 + 상태 변경 이력
  - RequestComments를 메신저형으로: 현재 사용자(useAuthStore.user.id)와 작성자 비교 → 내 메시지=우측(파란 말풍선)/상대=좌측(회색 말풍선)
  - 상태 변경 이력: `request_status_history` 테이블(mig c4e7a2b9f130 — from_status→to_status·changed_by·created_at) 신설, 요청 삭제 시 CASCADE. 생성(None→pending)·운영자 상태 변경 시 기록. RequestResponse.status_history + RequestDetailModal 타임라인(from→to·담당자·시각) 표시
  - _Requirements: R17_

- [x] 69. 버그 수정: 메일 스케줄 삭제 500 (mail_jobs FK CASCADE)
  - 발송 이력(mail_jobs)이 있는 스케줄 삭제 시 FK 위반(ForeignKeyViolationError)으로 500 발생. `mail_jobs.mail_schedule_id` FK를 ON DELETE CASCADE로 변경(mig d5f8c1a63b40 + 모델 MailJob). 삭제 시 mail_jobs→export_jobs·report_image_paths까지 정리(발송 감사는 audit_logs 별도 보존)
  - _Requirements: R16_

- [x] 70. 메일 스케줄 수신 칸: 참조(CC)/숨은참조(BCC) 추가
  - `mail_recipients.field`(to/cc/bcc, 기본 to) 컬럼 신설(mig e2c9b7a4d150 + 모델 MailRecipient + CHECK ck_mail_recipient_field). recipient_type(USER/GROUP/DEPARTMENT/EMAIL)과 직교 — 모든 유형을 받는사람/참조/숨은참조 어디로든 지정
  - `resolve_recipients`가 field별로 그룹핑하여 `ResolvedRecipients(to/cc/bcc)` 반환 + 우선순위(to>cc>bcc) 전역 중복 제거. `build_message`는 To/Cc 헤더만 설정(**Bcc 헤더 미설정**), 실제 발송은 envelope(to+cc+bcc)로만 하여 숨은참조 비노출. to가 비면 To=`undisclosed-recipients:;`. `send_with_retry`/`_send_once`는 평면 envelope 리스트 유지(request_notify 공용)
  - 스키마 RecipientCreate/Response.field, 라우트 create/update/_build_response 반영. 프런트: RecipientItem.field, MailSchedulePage 추가행 칸 셀렉트 + 리스트 인라인 칸 배지/드롭다운(받는사람/참조/숨은참조)
  - _Requirements: R16_

## v1.1+ (범위 외 - 참고)

- [ ] 48. Job_Context 다중 부서 선택 (R1.7)
- [ ] 49. 전체 PRM 대시보드 통합 (R20)
- [ ] 50. AI 분석 (R21)
- [ ] 51. Embedded 용량 자동 스케일링 (v1.2, D-21)
- [x] 52. 서비스 센터 고도화 (R17 확장) — **v1.0 승격 완료**: 첨부(47-A), 우선순위/SLA·댓글·알림(47-B). 잔여 고도화(카테고리 세분화, 메신저 알림, 영업시간 SLA, 첨부 스캔)는 v1.1+
