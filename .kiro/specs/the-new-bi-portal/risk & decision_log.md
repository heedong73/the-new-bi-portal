# Risk & Decision Log — The New BI Portal (BIP)

본 문서는 `design.md`의 기술 결정과 리스크를 추적 가능한 형태로 정리한다. 각 결정은 고유 ID(D-XX)를 가지며 design.md의 대안 비교표와 동일 ID로 상호 참조한다. 사용자 요구에 따라 모든 중요 결정은 **최소 2개 이상 대안**과 장단점을 제시하고, 상태를 **Decided / To-Compare / PoC-Required**로 구분하며, 되돌리기 난이도와 v1.0/v1.1+ 범위를 명시한다.

## 상태 정의

- **Decided**: 본 설계에서 확정. 다른 합리적 근거가 없는 한 변경하지 않음.
- **To-Compare**: 방향(추천안)은 있으나 구현 전 다른 LLM/개발자가 재검토 가능.
- **PoC-Required**: 사내 환경/외부 시스템 확인이 필요하여 PoC 후 확정.
- **Deferred**: v1.0 범위에서 제외하고 후속 버전(v1.1+/v1.2)으로 연기. v1.0은 대체 운영 방식으로 처리.

## 되돌리기 난이도(reversibility) 정의

- **낮음(쉬움)**: 모듈 교체/설정 변경으로 단시간 내 전환 가능, 데이터 마이그레이션 거의 없음.
- **중간**: 코드 일부 + 일부 데이터/스키마 변경 필요.
- **높음(어려움)**: 데이터 모델/보안 경계/외부 연동 계약 변경 동반, 전환 비용 큼.

---

## 결정 요약 표

| ID | 주제 | 상태 | 추천(v1.0) | 되돌리기 | 범위 | 관련 R |
|---|---|---|---|---|---|---|
| D-01 | 인증 방식(SSO 부재) | Decided | 인사정보 DB(`scl_v_insa_*`) 사번/SHA256³ 로그인 | 중간 | v1.0 | R1, R33 |
| D-02 | 세션 저장 방식 | Decided | 쿠키 세션토큰 + Redis 저장 | 낮음 | v1.0 | R39 |
| D-03 | Refresh 정보 표시 | Decided | DB 동기화(+강제 동기화 하이브리드) | 낮음 | v1.0 | R10, R14 |
| D-04 | 운영 DB 배치 | Decided | 외부 bi_portal(AWS RDS), Compose 외부 연결 | 높음 | v1.0 | R25 |
| D-05 | 권한 모델 구조 | Decided | 4종 주체(user/role/dept/group) 단일 테이블 | 중간 | v1.0 | R8 |
| D-06 | Embed 발급 방식 | Decided | App-Owns-Data(master), RLS는 v1.1+ | 중간 | v1.0 | R9, R24, R38 |
| D-07 | Worker/Queue | Decided | Celery + Celery Beat (PRM 재활용) | 중간 | v1.0 | R16, R27, R37 |
| D-08 | 권한 계산 방식 | To-Compare | 요청 시 동적 + 단기 캐시 | 낮음 | v1.0 | R8, R22, R24 |
| D-09 | 파일 저장 방식 | Decided | StorageService 추상화, 개발 volume→운영 NAS | 중간 | v1.0 | R16, R31 |
| D-10 | 락 키/TTL 설계 | Decided | `bip:lock:{job_type}:{key}` + 작업별 TTL | 낮음 | v1.0 | R37 |
| D-11 | 비밀번호 해시(로컬 관리자) | Decided | argon2id(대안 bcrypt) | 낮음 | v1.0 | R39.3 |
| D-12 | 메일 발송 방식 | Decided | Worker 비동기 + 재시도 큐, 미인증 SMTP | 낮음 | v1.0 | R16, R34 |
| D-13 | Export 형식 | To-Compare | PNG | 낮음 | v1.0 | R16 |
| D-14 | 자동 새로고침 구현 | Decided | TanStack Query refetchInterval | 낮음 | v1.0 | R19 |
| D-15 | PBIX 업로드 방식 | Decided | 관리자 ID 등록 + PBIX Import API(v1.0) | 중간 | v1.0 | R12 |
| D-16 | 운영 모니터링 | Decided | 자체 health/지표 | 낮음 | v1.0 | R36 |
| D-17 | DB 스키마 배치 | Decided | BIP 전용 `bip` 스키마(인사 뷰와 분리) | 중간 | v1.0 | R29 |
| D-18 | CSRF/CORS 통제 | Decided | SameSite 쿠키 + CSRF 토큰, CORS allowlist | 낮음 | v1.0 | R40 |
| D-19 | 보존/정리 정책 | Decided | 설정 기반 보존 + 주기 정리 작업 | 낮음 | v1.0 | R31 |
| D-20 | Mock/Live·Auth 모드 토글 | Decided | APP_MODE + AUTH_MODE 환경 변수 | 낮음 | v1.0 | R26.5 |
| D-21 | Embedded 용량 자동 스케일링 | Deferred(v1.2) | v1.0 수동 운영, 자동 스케일은 v1.2 | 낮음 | v1.2 | R16, R36 |
| D-22 | Embedded 서버 이전(업체 교체) | Decided | Power BI 연결 전부 env 기반 + 테스트→cutover | 낮음 | v1.0 | R25, R32 |
| D-23 | 환경 분리/이관(개발↔운영) | Decided | Alembic 단일 소스 + env 분리, 현재 RDS=개발계 | 낮음 | v1.0 | R25, R29 |
| D-24 | 서비스 센터 범위 | Decided | v1.1+ → **v1.0 승격**(2026-06). 화면명 "서비스 센터"(내부 `requests`). 상태 received→in_progress→done/rejected(반려 사유 필수). **첨부(request_attachments+StorageService), 우선순위/SLA(경과시간 기준), 댓글 스레드(request_comments), 알림 메일(BackgroundTasks best-effort)** 포함. 카테고리 세분화·메신저 알림·영업시간 SLA·바이러스 스캔은 v1.1+ | 낮음 | v1.0 | R17 |

---

## 결정 상세

### D-01 인증 방식 (그룹웨어 SSO 부재 → 인사정보 DB 로그인) — Decided (되돌리기: 중간)
- 관련 요구: R1, R3, R33. 범위: v1.0.
- 배경: 사내 그룹웨어에 표준 SSO(SAML/OIDC) 엔드포인트가 없음. 대신 운영 DB `bi_portal`의 `public` 스키마에 그룹웨어 인사정보 뷰(`scl_v_insa_*`)가 적재되어 있어, 이를 자격 증명/프로필 원천으로 사용한다.
- **결정**: 사번(`emp_no`) + 비밀번호 로그인. 입력 비밀번호에 **단순 SHA-256을 3회 반복**(`sha256(sha256(sha256(password)))`, salt·추가 처리 없음)한 값이 `scl_v_insa_user_add_pwd.login_pwd`와 일치하면 인증 성공. 인사 뷰는 **읽기 전용**으로만 사용(INSERT/UPDATE/DELETE 금지).
- 인사 뷰 매핑(**실측 확정** — 사내망 introspection으로 컬럼 확인):

| 뷰 | 핵심 컬럼(확인됨) | BIP 매핑 |
|---|---|---|
| `scl_v_insa_user_add_pwd` | `emp_no`(사번), `login_pwd`(64자 소문자 hex), `cmp_email`, `user_name`, `cmp_id`, `emp_status` | 로그인 검증, 이메일/이름 |
| `scl_v_insa_user` | `emp_no`, `user_name`, `cmp_email`, `emp_status`, `retire_date`, (`login_pwd`도 존재) | 프로필·재직상태 |
| `scl_v_insa_my_job` | `emp_no`, `cmp_id`, `dept_id`, `ofc_id`, `pos_id`, `bass_dept_yn`, `emp_sort_ordr` | Job_Context 후보 |
| `scl_v_insa_dept_add_depth` | `cmp_id`, `dept_id`, `dept_name`, `up_dept_id`, `dept_depth`, `dept_status` | departments(계층) |
| `scl_v_insa_office` | `cmp_id`, `ofc_id`, `ofc_name` | 직급 라벨 |

- 조인 키: `emp_no`(+ `cmp_id`), 부서 = `(cmp_id, dept_id)`, 직급 = `(cmp_id, ofc_id)`.
- **해시 형식 실측**: `login_pwd`는 모두 **64자 소문자 hex**(= SHA-256 출력의 hex 표현). 단순 SHA-256 3회 반복 + 최종 소문자 hex로 확정. 남은 확인은 라운드 간 입력이 직전 라운드의 hex 문자열인지(가정) vs 원시 digest 바이트인지 — 알려진 평문/해시 샘플 1건으로만 확정 가능.
- **겸직(Job_Context) 처리 — v1.0 기본 부서 단일 / 선택은 v1.1+**: v1.0에서는 `scl_v_insa_my_job`에서 `bass_dept_yn='Y'` 우선(없으면 `emp_sort_ordr` 최상위) **1건을 기본 부서로 자동 매핑**해 `users.department_id`에 저장하고, 부서 권한 계산의 단일 출처로 쓴다. 컨텍스트 선택 UI가 없어 "선택 부서 ≠ 계산 부서" 모순이 없다.
- **모델 가정**: 로그인 ID(`emp_no`)=단일 회사·단일 정체성. **계열사 간 겸직은 계열사별 ID 체계가 달라 로그인 ID가 분리**되므로(서로 다른 사용자처럼 동작) 추가 처리 불필요 — 일반 로그인과 동일. 다중 Job_Context는 "동일 회사 내 다중 부서/직책"에만 해당하며 v1.1+로 분리(세션 활성 부서 `active_department_id` 전환). 실측상 동일 `emp_no` 다중행은 소수(~119/9183, 상당수 시스템 계정의 회사별 중복 추정).
- 대안: ① 인사정보 DB 로그인(채택) ② 어댑터만 두고 추후 SSO 도입(SSO 부재로 보류). 향후 그룹웨어가 SSO를 제공하면 `Authenticator` 인터페이스 교체로 전환 가능하게 인증 로직을 한 모듈로 격리.
- **확인 대기(담당자)**: 해시는 단순 SHA-256 3회 + **64자 소문자 hex 저장**으로 실측 확정. 유일한 잔여 확인은 라운드 간 입력 형태(직전 hex 문자열 재해싱 vs 원시 digest 바이트) — 알려진 평문/해시 샘플 1건으로 검증. 가장 흔한 구현은 매 라운드 hex 문자열을 UTF-8로 재해싱.
- 보안: `login_pwd`/입력 비밀번호는 로그/응답/Audit_Log에 평문 미기록. 인사 DB 접속 계정은 읽기 전용 권한 권장.
- 되돌리기 중간: 인증 원천 변경 시 로그인/매핑 모듈 교체.

### D-02 세션 저장 방식 — Decided (되돌리기: 낮음)
- 관련 요구: R39. 범위: v1.0.
- 대안:
  1. **쿠키 세션 토큰 + Redis 세션 저장(추천)**: 서버가 세션 레코드 보유 → 로그아웃/비활성화 시 즉시 무효화. 장점: 강제 만료·무효화 용이(R39.2, R4.3). 단점: Redis 의존(단, 세션은 휘발성 허용, 손실 시 재로그인).
  2. **JWT 무상태**: 장점: 저장소 불필요. 단점: 즉시 무효화 어려움(블랙리스트 필요) → R39.2와 충돌.
  3. **DB 세션**: 장점: 영속. 단점: 매 요청 DB 조회 부하.
- 추천 ①. 세션은 Redis 휘발성으로 두되, 손실 시 재인증으로 복구(R29.4 일관).
- 되돌리기 낮음: 세션 서비스 모듈 교체로 전환 가능.

### D-03 Refresh 정보 표시 — Decided (되돌리기: 낮음)
- 관련 요구: R10, R14. 범위: v1.0.
- 대안:
  1. **실시간 Power BI 조회**: 화면 진입 시 직접 호출. 장점: 항상 최신. 단점: rate limit/지연, R27.1 응답 SLA 위반 위험.
  2. **DB 동기화(추천)**: Scheduler가 주기 수집 → 화면은 DB 조회. 장점: 빠름·안전(PRM 자산 재활용). 단점: 동기화 주기만큼 지연.
  3. **하이브리드**: 기본 DB + 상세 화면 "강제 동기화" 버튼(`/api/collect-now`).
- 추천 ② + ③ 병행. v1.1+에서 이벤트 기반 동기화 고려.

### D-04 운영 DB 배치 — Decided (되돌리기: 높음)
- 관련 요구: R25. 범위: v1.0.
- 대안: ① Compose 내부 postgres(PRM 방식) ② **외부 데이터플랫폼 DB 서버의 bi_portal(추천)**.
- 추천 ②: 요구사항이 외부 운영 DB를 명시. 실제 환경은 AWS RDS PostgreSQL(서울 `ap-northeast-2`, DB명 `bi_portal`, 이미 생성됨). Compose는 postgres 서비스를 띄우지 않고 `DATABASE_URL`로 연결. 로컬/CI는 docker-compose.test.yml로 일회용 PG.
- 운영 고려사항: RDS 보안 그룹 인바운드(5432)에 컨테이너 호스트 허용 필요(현재 사내망에서 접근 확인됨), **RDS가 SSL 연결을 요구**하므로 `sslmode=require`(asyncpg `ssl=true`) 필수 — 평문 연결은 pg_hba에서 거부됨(진단으로 확인). RDS 엔드포인트는 사내망/VPC 경로로만 도달(사설 IP 172.30.x).
- 되돌리기 높음: 데이터 위치/백업/네트워크 정책 변경 동반.

### D-05 권한 모델 구조 — Decided (되돌리기: 중간)
- 관련 요구: R8. 범위: v1.0.
- 대안: ① 주체별 분리 테이블 ② **단일 `report_permissions`(subject_type, subject_id)(추천)**.
- 추천 ②: 4종 주체를 한 테이블에서 합집합 쿼리로 계산(설계 SQL 참조). UNIQUE(report_id, subject_type, subject_id, permission)로 중복 방지.
- 되돌리기 중간: 스키마 변경 시 마이그레이션 필요.

### D-06 Embed 발급 방식 — Decided (되돌리기: 중간)
- 관련 요구: R9, R24, R38. 범위: v1.0.
- 대안:
  1. **App-Owns-Data(서비스 주체 master)(채택)**: 단일 서비스 계정으로 GenerateToken. 장점: 사용자별 Power BI 라이선스 불필요, secret 서버 보관. 단점: 사용자별 RLS는 별도 구성 필요.
  2. **Embed for your organization(사용자별 AAD)**: 장점: 사용자 신원 그대로. 단점: 모든 사용자 Power BI 라이선스/AAD 매핑 필요 → 사내 비용·복잡도.
- **결정**: ① App-Owns-Data 채택(확정). 포털 사용자는 Power BI에 직접 로그인하지 않고 Backend가 Embed Token을 발급. 레포트 접근 통제는 BIP의 사용자/역할/부서/그룹 권한으로 처리.
- **RLS(행 수준 보안)**: v1.0 필수 아님. 동일 레포트 내 사용자별 행 수준 데이터 제한이 필요한 경우에 한해 **v1.1+ 또는 별도 PoC**로 분리.
- 되돌리기 중간: 발급 방식 전환 시 토큰 발급/임베드 경로 변경.

### D-07 Worker/Queue — Decided (되돌리기: 중간)
- 관련 요구: R16, R27, R37. 범위: v1.0.
- 대안: ① **Celery + Celery Beat(추천)** ② RQ + APScheduler ③ FastAPI BackgroundTasks.
- 추천 ①: PRM이 이미 Celery+Beat+Redis broker로 구현됨 → 재활용으로 개발량 절감. Beat가 스케줄러 내장. ③은 프로세스 재시작 시 작업 유실/분산 불가로 장기 작업 부적합.
- 되돌리기 중간: 작업 정의/브로커 전환 비용.

### D-08 권한 계산 방식 — To-Compare (되돌리기: 낮음)
- 관련 요구: R8, R22, R24. 범위: v1.0.
- 대안:
  1. **요청 시 동적 계산 + 단기 캐시(추천)**: 인덱스된 합집합 쿼리, 권한/그룹/역할 변경 시 사용자 캐시 무효화. 장점: 정합성, 구현 단순. 단점: 대규모 시 쿼리 비용.
  2. **사전 계산/materialized view**: 장점: 조회 빠름. 단점: 갱신 동기화 복잡, 일관성 지연.
- 추천 ①(정합성 우선). 부하 문제 시 v1.1+에서 ②.

### D-09 파일 저장 방식 — Decided (되돌리기: 중간)
- 관련 요구: R16, R31. 범위: v1.0.
- **결정**: `StorageService` 추상화 인터페이스를 두고, 구현체를 환경에 따라 교체한다 — **개발=Docker named volume, 운영=NAS 마운트(우선 가정), 확장=object storage(S3 호환)**. 저장 루트는 환경 변수 `STORAGE_ROOT_PATH`로 주입.
- DB에는 **파일 바이너리를 저장하지 않고** 메타데이터만 저장: `file_path`, `file_name`, `file_size`, `mime_type`, `created_at`(+ 연관 mail_job/export_job/page).
- 대안: ① DB BLOB 저장(부하·백업 비대 → 제외) ② 파일시스템+메타DB(채택).
- 운영 NAS 경로는 **TBD**(환경 변수로 주입, 확정 시 값만 설정). object storage 전환도 `StorageService` 구현체 추가로 흡수.
- 되돌리기 중간: 저장 위치 이전 시 파일 마이그레이션 필요(경로 메타는 DB 갱신).

### D-10 락 키/TTL — Decided (되돌리기: 낮음)
- 관련 요구: R37. 범위: v1.0.
- 결정: PRM 락(`lock.py`) 재활용, prefix를 `bip:lock:{job_type}:{key}`로 일반화. TTL은 작업 SLA 기준(수집 60s, 메일/Export 더 길게). 미소유자 release 무효(Lua atomic), TTL 만료 + 멱등 upsert로 재진입 안전.
- 대안: ② DB advisory lock(장점: 트랜잭션 결합, 단점: 연결 점유). Redis 채택 — 기존 자산·broker와 일관.

### D-11 비밀번호 해시 — Decided (되돌리기: 낮음)
- 관련 요구: R39.3. 범위: v1.0.
- 대안: ① **argon2id(추천)** ② bcrypt.
- 추천 ①(메모리-하드, 현대 권장). bcrypt도 허용. 평문 저장 금지.

### D-12 메일 발송 방식 — Decided (되돌리기: 낮음)
- 관련 요구: R16, R34. 범위: v1.0.
- 대안: ① 동기 SMTP(요청 스레드) ② **Worker 비동기 + 재시도 큐(채택)**.
- 결정 ②: 메일은 Export 파이프라인의 마지막 단계로 Worker 내에서 발송, 실패 시 재시도(`MAIL_RETRY_MAX`). 동기 방식은 R27.2(비차단) 위반.
- **SMTP 설정(확정)**: 사내 SMTP 서버, 포트 `587`, **인증 없음**(사용자/비밀번호 미사용)으로 발송. 기존 업체 솔루션과 동일. 실제 호스트 주소는 문서에 적지 않고 `.env`(`SMTP_HOST`)에만 보관. 단, `SMTP_USE_AUTH`/`SMTP_USERNAME`/`SMTP_PASSWORD`/`SMTP_STARTTLS`를 옵션 env로 두어 향후 인증/TLS 요구 시 코드 변경 없이 전환(기본 미인증).
- 발송 라이브러리: `aiosmtplib`(비동기) 또는 `smtplib`. 인라인 이미지(PNG)는 `multipart/related` + CID 첨부.

### D-13 Export 형식 — To-Compare (되돌리기: 낮음)
- 관련 요구: R16. 범위: v1.0.
- 대안: ① **PNG(추천)** ② PDF ③ PPTX.
- 추천 ①: 인라인 이미지 메일 본문에 적합, 페이지별 이미지 자연스러움. 형식 선택 옵션은 v1.1+.

### D-14 자동 새로고침 — Decided (되돌리기: 낮음)
- 관련 요구: R19. 범위: v1.0.
- 결정: PRM 패턴 계승. TanStack Query `refetchInterval`(기본 60s, env). 필터/스크롤 상태는 Zustand 분리로 보존.

### D-15 PBIX 업로드 방식 — Decided (되돌리기: 중간) · 2026-06 갱신
- 관련 요구: R12. 범위: v1.0.
- **결정(갱신)**: 레포트 게시를 **PBIX Import API 업로드 단일 경로**로 일원화한다. 초기에는 ID 수동 등록도 포함했으나, "기존 레포트 게시"(기존 임베디드 서버 레포트를 ID로 가져와 등록)는 v1.0에서 **제거**했다.
  - 사유: (1) 관리자에게 혼동을 유발, (2) 향후 신규 Embedded 서버 구축 시 전면 마이그레이션 예정이라 기존 서버 레포트를 끌어오는 경로가 불필요.
  - 제거 범위: `POST /api/reports`(create_report), `GET /api/powerbi/workspace-reports`(powerbi 라우터), 관리자 UI "기존 레포트 게시" 버튼/모달 및 프런트 API(`reportAdminApi.create`/`workspaceReports`)·타입(`ReportCreate`/`WorkspaceReportItem`).
  - **수집기 부작용 정리**: 과거 `collect_workspace`(수집기)가 워크스페이스의 모든 레포트를 카탈로그(bip.reports)에 자동 upsert하여, 업로드하지 않은 레포트가 '레포트 관리 > (미분류)'에 나타나는 문제가 있었다. 수집기의 `upsert_reports`를 **이미 등록된 레포트 메타 갱신만** 하도록 변경(신규 자동 등록 금지). 새로고침 모니터링은 datasets/refresh_runs 기준이라 영향 없음. 기존에 자동 등록된 레포트는 `cleanup_autocollected_reports.py`(created_by_user_id IS NULL 대상, 메일 스케줄 참조분 스킵)로 일괄 정리.
  - **PBIX Import API 업로드**(유지): System_Operator가 PBIX 파일 업로드 → Power BI `POST imports`(Worker 비동기 + Import 상태 polling) → 성공 시 생성/갱신된 reportId/datasetId를 카탈로그에 반영.
- **권한 경계**: 신규 등록·업로드는 **관리자(System_Operator) 전용**. 수퍼 사용자의 "레포트 등록 요청" 기능은 사내 그룹웨어 IT 요청서로 처리하므로 **BIP에서 제외**(요구 R12에서 삭제됨).
- 신규 vs 갱신: Import 시 `nameConflict`(`CreateOrOverwrite`/`Overwrite`/`Abort`)로 신규 게시·기존 갱신 제어. 갱신 시 기존 카탈로그 레코드의 ID 매핑 유지.
- 검증: 업로드 파일 PBIX 형식/크기/확장자 검증(R12.6, R40.2). 격리/스캔 정책은 design에서 정의.
- 대안: ① ID 등록만(제외) ② ID 등록 + Import ③ PBIX Import만(채택) ④ 완전 셀프 업로드+자동 검수(v1.1+).
- v1.1+: 수퍼 사용자 완전 셀프 업로드 및 자동 검수.
- 되돌리기 중간: Import 파이프라인 추가/제거 시 Worker 작업·권한 변경.


### D-24 역할 → 메뉴 접근: 편집형 매트릭스 → 코드 고정 매핑 — Decided · 2026-07
- 관련 요구: R7, R23. 범위: v1.0.
- **결정**: 역할별 메뉴 접근을 런타임 편집(role_menu_permissions 테이블 + `/api/roles/menus` + 관리자 "역할" 페이지)하던 방식을 없애고, **역할 → 메뉴 매핑을 코드로 고정**(`constants.ROLE_MENUS`)한다.
  - 일반 사용자 = 홈(레포트 조회) [+ 서비스 센터는 전원 노출], 파워 사용자 = 홈 + 통계, 시스템 운영자 = 전체.
  - 사유: 역할이 3개로 고정이고 메뉴 구성이 자연스러워 편집 유연성이 사실상 불필요. 관리자 화면 축소 + 드리프트(예: enum에 없는 `admin_requests` 키) 제거.
- **제거 범위**: `role_menu_permissions` 테이블(드롭 마이그레이션 `b7f2a3d9c410`), `GET/PUT /api/roles/menus` + 관련 스키마, `RoleMenuPermission` 모델, `seed_role_menus`, 프런트 `RolesPage`/`admin_roles` 네비/`rolesApi.getMenus/setMenus`. `require_menu`/`allowed_menus`는 유지하되 고정 매핑에서 계산.
- **권한 통제 불변**: 백엔드가 여전히 `require_menu`로 강제(프런트 숨김은 UX 보조).
- 되돌리기 쉬움~중간: 다시 편집형이 필요하면 테이블/엔드포인트/페이지 복원(마이그레이션 downgrade 포함).


### D-25 조직도 기반 팀 권한 그룹 자동 생성/동기화 — Decided · 2026-07
- 관련 요구: R5, R6, R8. 범위: v1.0.
- **배경**: 팀 단위 권한 부여가 대부분인데, 관리자가 팀마다 그룹을 만들고 인원을 수동 추가하는 부담이 큼. 인사이동이 분기/연 단위로 발생.
- **결정**: 조직도(인사 뷰)를 기반으로 **팀별 권한 그룹을 자동 생성하고 완전 동기화**하는 기능을 추가한다.
  - `user_groups.source_dept_id`(마이그레이션 `c1a8e5b2f930`)로 "자동 관리 팀 그룹"을 식별. `POST /api/org/sync-team-groups {dept_id, apply}`.
  - **범위 지정 실행**: 선택한 dept_id 하위(재귀)에서 **직속 구성원(bass_dept_yn=Y, 재직 W)이 있는 팀**만 대상. 본부/팀 등 원하는 노드를 골라 나눠 실행(블라스트 반경·실행시간 통제).
  - **완전 동기화(mirror)**: 자동 관리 그룹의 멤버 = 팀 현재 로스터(추가 + 제거). **자동 관리 그룹만** 대상 — 수동 생성 그룹(`source_dept_id` NULL)은 절대 건드리지 않음. 자동 그룹에 수동 추가한 인원은 재동기화 시 제거됨(팀 외 인원은 별도 수동 그룹/개인 권한 사용).
  - **미리보기 후 적용**: `apply=false`면 팀별 추가/제거/신규 계획만 반환(변경 없음), `apply=true`면 반영 + 감사 로그. 제거가 일어나므로 관리자가 먼저 확인.
  - **자동 등록**: 팀 구성원이 BIP 미등록이면 자동 등록(+General_User). 가시성은 권한 부여 후에만.
  - **명명**: 그룹명 = 팀명. `user_groups.name` UNIQUE 충돌 시 점진적 구분 — `상위조직 · 팀명` → `회사명 · 상위조직 · 팀명` → `팀명 (dept_id)`. 식별/재동기화는 이름과 무관하게 `source_dept_id` 기준. 재동기화 시 부서명 변경도 그룹명에 반영.
- **인사 뷰 읽기 전용**(R33.3): 조직/구성원 조회만, INSERT/UPDATE 없음.
- **그룹 관리 트리 뷰**: `GET /api/groups/tree`(cmp_id 옵션)가 **전체 조직도(회사·본부·담당·팀)**를 반환하고 각 부서에 그룹 유무/인원수/직속구성원 여부를 표시. 그룹 관리 화면은 사용자 관리처럼 회사 선택 + 조직 트리로 보이며, **각 노드의 동기화 버튼**으로 그 하위 팀 그룹을 미리보기→적용으로 한 번에 생성/동기화한다(팀을 하나씩 수동 추가할 필요 없음). 수동/미배치 그룹은 "기타 그룹" 평면 목록. 레포트 권한 부여 드롭다운은 v1.0에서는 평면 유지.
- 되돌리기 중간: 기능 제거 시 엔드포인트/서비스/프런트 제거 + `source_dept_id` 컬럼 드롭(마이그레이션 downgrade). 생성된 그룹 자체는 일반 그룹으로 남길 수 있음.

### D-16 운영 모니터링 — Decided (되돌리기: 낮음)
- 관련 요구: R36. 범위: v1.0.
- 대안: ① **자체 health/지표(추천)** ② Flower ③ Prometheus/Grafana.
- 추천 ①: `/api/health` + `/api/monitoring/status`(DB/Redis/Worker/최근 작업). v1.0 충분. ②/③는 v1.1+ 관측성 강화 시.

### D-17 DB 스키마 배치 — Decided (되돌리기: 중간)
- 관련 요구: R29. 범위: v1.0.
- 대안: ① BIP 테이블을 `public`에 인사 뷰와 혼재 ② **BIP 전용 스키마 `bip`(추천)** ③ 도메인별 schema(auth/report/job/log) 세분화.
- **결정 ②**: 인사 뷰(`public.scl_v_insa_*`)와 섞이지 않도록 BIP 모든 테이블을 전용 스키마 `bip`에 생성. 인사 뷰는 읽기 전용 외부 객체라 마이그레이션 대상 아님 → 분리하면 개발계→운영계 이관 시 BIP 객체만 깔끔히 재현. 마이그레이션도 단순(단일 `bip`). ③ 도메인 세분화는 권한 격리 필요 시 v1.1+.
- 되돌리기 중간: 스키마 이동 시 마이그레이션 필요(단, 초기 확정이라 비용 낮음).

### D-23 환경 분리 및 개발계→운영계 이관 — Decided (되돌리기: 낮음)
- 관련 요구: R25, R29. 범위: v1.0.
- 배경: 현재 제공된 `bi_portal` RDS는 **개발계**. 운영계는 추후 동일 구조로 구축·이관 예정.
- **결정**:
  - 모든 BIP 스키마 변경은 **Alembic 마이그레이션이 단일 진실 소스**(수동 DDL 금지). 운영계는 `alembic upgrade head`로 개발계와 동일 스키마를 코드로 재현.
  - 환경 차이는 **코드/스키마가 아니라 `.env`로만** 표현(`.env.dev`/`.env.prod`): DB URL, Power BI 워크스페이스 ID, Azure/SMTP, STORAGE_ROOT_PATH 등.
  - 데이터는 환경 간 이관하지 않음(독립 원장). 기준 데이터(역할 코드 등)는 **멱등 시드**로 양쪽 동일 적용.
  - BIP 테이블은 `bip` 스키마에만(D-17) → 마이그레이션이 `public` 인사 뷰를 건드리지 않음.
  - CI에서 `docker-compose.test.yml` PG로 `upgrade head` + 테스트(+선택 `downgrade`)로 마이그레이션 무결성 사전 검증.
- 대안: ① 환경별 코드 분기(지양) ② env 기반 단일 코드(채택). ① DB 직접 dump/restore 이관 ② 마이그레이션 재현(채택, 환경 독립·추적 가능).
- 미정(TBD): 운영계 호스트/워크스페이스/용량 — 확정 시 `.env.prod`만 채우면 됨.
- 되돌리기 낮음: 환경 추가/변경이 `.env`+마이그레이션으로 처리됨.

### D-18 CSRF/CORS 통제 — Decided (되돌리기: 낮음)
- 관련 요구: R40. 범위: v1.0.
- 결정: 세션 쿠키 SameSite=Lax/Strict + 상태 변경 요청에 CSRF 토큰. CORS는 `CORS_ALLOWED_ORIGINS` 명시 allowlist(내부망 도메인). 내부망 전제이나 다중 방어.

### D-19 보존/정리 정책 — Decided (되돌리기: 낮음)
- 관련 요구: R31. 범위: v1.0.
- 결정: `AUDIT_RETENTION_DAYS`, `IMAGE_RETENTION_DAYS` 등 설정 기반. 주기 정리 작업(Beat)으로 만료분 삭제. report_image_paths.created_at 기준.

### D-20 Mock/Live·Auth 모드 토글 — Decided (되돌리기: 낮음)
- 관련 요구: R26.5. 범위: v1.0.
- 결정: PRM `APP_MODE`(mock/live) 계승 + `AUTH_MODE`(hr-db/local-only/mock) 추가. 개발/시연 시 외부 의존(Power BI/인사 DB) 없이 전체 흐름 검증. (그룹웨어 SSO 부재이므로 운영 인증은 `hr-db`.)

### D-21 Embedded 용량 자동 스케일링 — Deferred (v1.2, 되돌리기: 낮음)
- 관련 요구: R16(메일 Export), R36(모니터링). 범위: **v1.2 고도화(연기)**.
- 배경: 현재 Power BI Embedded **A1(1 v-core, 3GB RAM)** 사용 중. 새로고침 시 단일 모델 메모리 한계(3GB) 초과로 메모리 부족 에러 빈발. A SKU는 노드 타입을 무중단에 가깝게 스케일 업/다운 가능하며(데이터/워크스페이스/워크스페이스 ID 불변), 시간당 과금이라 시간대별 조정으로 비용↔성능 균형 가능.
- **v1.0 결정**: 자동 스케일은 **v1.2로 연기**한다. v1.0에서는 용량을 **수동 운영**한다 — 즉 메모리 에러가 심하면 운영자가 Azure Portal에서 필요 시 노드를 수동 스케일 업(예: 상시 A2) 하거나, 새벽 새로고침 전후로 수동 조정한다. BIP 코드는 용량 스케일 로직을 포함하지 않는다.
- **v1.2 후보안(참고)**: 새로고침이 집중되는 매일 03:00~08:00(KST)는 A2(5GB), 그 외 A1로 자동 조절. 구현 시 Azure CLI/REST(`az powerbi embedded-capacity update`)를 Scheduler(Beat) 또는 Azure Automation/Logic App으로 트리거.
- v1.2 검토 포인트(연기된 항목): ① 서비스 주체에 구독 레벨 `Microsoft.PowerBIDedicated/capacities` 스케일 권한 부여 가능 여부 ② Korea Central A1/A2 실단가 ③ 새로고침 피크 시간대 실측(03~08시 여부) ④ 스케일 전환 중 새로고침 트리거 회피 ⑤ **스케일 다운/정지 구간과 메일 Export 스케줄 충돌 방지**(RK-12).
- 되돌리기 낮음: 워크스페이스 ID 불변이라 도입/철회가 코드·데이터에 영향 없음.

> 상태: **Deferred(v1.2)**. v1.0 설계·구현 범위에서 제외. `.env`의 `CAPACITY_*` 항목은 v1.2 참고용 placeholder로만 남기며 v1.0에서는 사용하지 않는다.

### D-22 Embedded 서버 이전(기존 업체 → 신규 업체) — Decided (되돌리기: 낮음)
- 관련 요구: R25, R32. 범위: v1.0(설계 전제), 전환은 운영 반영 시점.
- 배경: 현재 Power BI Embedded는 **기존 업체가 구축한 서버(용량/워크스페이스/Azure 자격)**를 사용 중이나, 향후 **신규 업체와 구축한 Embedded 서버로 이전**한다. 운영 반영 전에 신규 서버에서 테스트 후 전환(cutover)한다.
- 핵심 결정: **Power BI 연결 정보를 코드에 하드코딩하지 않고 전부 환경 변수로 외부화**한다. 따라서 서버 이전은 `.env` 교체 + 재기동만으로 완료되며 BIP 코드/스키마 변경이 없다(되돌리기 낮음, 롤백도 env 원복).
- 외부화 대상 env(이전 시 교체):
  - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` — 신규 업체 환경의 서비스 주체(앱 등록)가 다르면 교체
  - `POWERBI_WORKSPACE_ID` — 신규 워크스페이스 ID
  - `POWERBI_API_BASE_URL`, `POWERBI_VERIFY_SSL` — 필요 시
  - (Embedded 용량 리소스는 워크스페이스에 종속 — 신규 용량으로 자동 반영)
- 환경 분리: `APP_MODE` 및 별도 `.env`(예: `.env.test-new` / `.env.prod`)로 **신규 서버 테스트 환경과 운영 환경을 분리**한다. 테스트 전환 절차:
  1. 신규 업체 서버의 자격/워크스페이스로 별도 `.env` 구성 → 스테이징/테스트 인스턴스 기동
  2. 레포트 등록(ID 매핑), Embed 발급, Refresh History 동기화, Export 메일 발송을 신규 서버에서 검증
  3. 데이터 원장(`bi_portal`)은 **reportId/datasetId/workspaceId 기준 식별**이므로, 워크스페이스/ID가 바뀌면 reports·datasets·refresh_runs 매핑 재정합 필요 여부 점검(아래 주의)
  4. 검증 완료 후 운영 `.env`를 신규 값으로 교체 → 재기동(cutover)
- **주의(데이터 정합성)**: 신규 서버에서 **reportId/datasetId/workspaceId가 달라지면** 기존 `reports`/`datasets`/`refresh_runs`/`mail_schedules`의 식별자 매핑이 끊긴다. 전환 시 ① 신규 ID로 재등록(권장, 단순) 또는 ② ID 매핑 마이그레이션 스크립트 중 선택. v1.0은 카탈로그 규모가 크지 않으면 ①. 감사/통계 이력은 과거 ID 기준으로 보존.
- 검토 포인트: 신규 업체 서버가 동일 Azure 테넌트인지(테넌트가 다르면 SSO/AAD 영향은 없으나 PowerBI 토큰 발급 주체 재확인), 신규 용량 SKU(A1 유지 여부), 워크스페이스 ID 변경 여부.

---

## 리스크 등록부 (Risk Register)

| ID | 리스크 | 가능성 | 영향 | 대응 | 관련 결정 |
|---|---|---|---|---|---|
| RK-01 | 그룹웨어 SSO 프로토콜 불확실 → 일정 지연 | 중 | 높음 | 어댑터 격리 + 조기 PoC | D-01 |
| RK-02 | Power BI rate limit(429)로 동기화/Export 실패 | 중 | 중 | Retry-After+backoff, DB 동기화로 호출 최소화 | D-03, D-07 |
| RK-03 | 메일 중복/누락 발송 | 중 | 높음 | Redis 락 + mail_jobs UNIQUE(run_key) 멱등 | D-10, D-12 |
| RK-04 | Embed master token/secret 유출 | 낮 | 매우 높음 | 서버 보관, 단기 토큰만 전달, 로그 마스킹, Property 3 | D-06 |
| RK-05 | 권한 합집합 계산 오류로 무단 노출 | 낮 | 매우 높음 | Property 1·2 PBT, Backend 재검증 | D-05, D-08 |
| RK-06 | 외부 bi_portal(RDS) 연결 단절 | 낮 | 높음 | 풀 재시도, monitoring 노출, 원장-Redis 분리 | D-04 |
| RK-07 | 이미지 파일 누적 디스크 고갈 | 중 | 중 | 보존/정리 작업 | D-09, D-19 |
| RK-08 | PBIX 자동 업로드 PoC 실패 | 중 | 낮(범위 조정) | v1.0은 ID 등록으로 인도, 업로드는 이관 | D-15 |
| RK-09 | Worker 크래시 시 락 잔존/작업 중단 | 낮 | 중 | TTL 자동 만료 + 멱등 upsert 재진입 | D-10 |
| RK-10 | 1인 12주 일정 초과 | 중 | 높음 | v1.0 우선, PRM 자산 재활용, v1.1+ 분리 | D-07, 전체 |
| RK-11 | 감사 로그에 시크릿 유입 | 낮 | 높음 | 화이트리스트 마스킹, Property 10 | D-18 |
| RK-12 | (자동 스케일 활성화 시) 용량 다운/정지 구간과 메일 Export 스케줄 충돌로 발송 실패 | 중 | 중 | 메일 스케줄을 A2 구간 내 배치 검증, 정지 대신 A1 다운 사용, 모니터링 알림 | D-21 |
| RK-13 | A1(3GB) 메모리 한계로 새로고침 실패 지속 | 높 | 중 | A2/A3 스케일 업(시간대 또는 상시), 모델 경량화 검토 | D-21 |
| RK-14 | Embedded 서버 이전 시 reportId/datasetId/workspaceId 변경으로 카탈로그·이력 매핑 단절 | 중 | 중 | 연결정보 env 외부화, 신규 ID 재등록 또는 매핑 마이그레이션, 테스트 환경 선검증 후 cutover | D-22 |
| RK-15 | 해시 입출력 인코딩 불일치로 로그인 실패 | 낮 | 높음 | 단순 SHA256³ 확정, 실제 샘플로 hex/bytes 인코딩 검증, 인증 모듈 격리 | D-01 |
| RK-16 | 인사 뷰 스키마/조인 키가 가정과 달라 매핑 오류 | 중 | 중 | 사내망 introspection 선검증, 읽기 전용 조회, 컬럼 매핑 설정화 | D-01 |
| RK-17 | 미인증 SMTP가 향후 인증/TLS 요구로 변경 | 낮 | 낮 | SMTP_USE_AUTH 등 옵션 env 사전 배치 | D-12 |
| RK-18 | PRM 코드 의존성으로 BIP 핵심 기능 구현 지연 | 중 | 중 | PRM 자산은 재활용 가능 시 우선 사용, 핵심(인증·권한·Embed·메일) 우선. 지연 시 Refresh History 수집(R14)·Gantt 화면(R15)을 v1.0 optional/v1.1+로 분리 | D-07, R26 |

## 사용자 확정 완료 항목 (2026-06 기준)

초기 미확정 5개 항목은 모두 확정되었다.

1. **D-01 인증**: 그룹웨어 SSO 없음 → 인사정보 DB(`scl_v_insa_*`) 사번/SHA256³ 로그인으로 확정. (잔여 확인: SHA-256 3회 정확한 규약 — 그룹웨어 담당자 확인 대기)
2. **D-06 Embed 발급**: App-Owns-Data 단일 서비스 계정 확정, 사용자별 RLS는 v1.1+/PoC.
3. **D-09 파일 저장**: StorageService 추상화, 개발 Docker volume → 운영 NAS(경로 TBD, `STORAGE_ROOT_PATH`), object storage는 확장. DB는 메타데이터만.
4. **D-15 PBIX 업로드**: 관리자 ID 등록 + PBIX Import API를 **v1.0 포함**. 수퍼 사용자 등록 요청 기능은 제외(그룹웨어 IT 요청서로 처리).
5. **SMTP**: 사내 SMTP 서버, 포트 `587`, 인증 없음 확정. 실제 호스트는 `.env`(`SMTP_HOST`)에만 보관. (옵션 env로 향후 인증/TLS 대비)
6. **운영 DB**: AWS RDS PostgreSQL `bi_portal`(서울 리전), 사내망 전용 접근 확정.
7. **Power BI 용량**: Embedded A1(3GB) 사용 중, 자동 스케일은 v1.2 연기, 서버는 향후 신규 업체로 이전(D-22).

### 남은 확인 항목

- **해시 라운드 입력 형태**(D-01): 단순 SHA-256 3회 + 64자 소문자 hex 저장은 실측 확정. 라운드 간 입력이 hex 문자열(가정) vs digest 바이트인지만 알려진 평문/해시 샘플 1건으로 검증.
- **인사 뷰 컬럼/조인**: 실측 완료(`emp_no`/`cmp_id`/`dept_id`/`ofc_id`/`cmp_email`/`login_pwd`/`bass_dept_yn` 등 확인). DB 접근은 `user=scldba`, `sslmode=require`로 정상.
