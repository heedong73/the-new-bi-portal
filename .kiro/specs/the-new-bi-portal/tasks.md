# Tasks

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
  - _Requirements: R5, R6_

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
  - POST /api/reports: ID 수동 등록 + workspace auto-upsert
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
  - routes/admin/GroupsPage.tsx, RolesPage.tsx
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

## v1.1+ (범위 외 - 참고)

- [ ] 46. 요청센터 (R17)
- [ ] 47. Job_Context 다중 부서 선택 (R1.7)
- [ ] 48. 전체 PRM 대시보드 통합 (R20)
- [ ] 49. AI 분석 (R21)
- [ ] 50. Embedded 용량 자동 스케일링 (v1.2, D-21)
