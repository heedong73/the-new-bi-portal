# The New BI Portal (BIP) v1.0

사내 Power BI 레포트 공유 포털을 자체 개발 시스템으로 대체하는 운영 등급 내부 포털입니다.
Power BI Embedded 레포트 조회, 사용자/그룹/권한 관리, 인사정보 DB 기반 사번/비밀번호 로그인,
데이터셋 새로고침 상태 표시, Power BI Export 기반 정기 메일 발송, 감사 로그/모니터링/통계를 제공합니다.

> 본 문서는 BIP 전용 기동 절차와 환경 변수 설명입니다. 기존 Power BI Refresh Monitor(PRM)
> 문서는 루트 `README.md` 를 참고하세요. BIP는 PRM 자산(FastAPI 라우트, Celery, React, 분산 락 등)을
> 재활용·확장하여 구축됩니다.

## 아키텍처 개요

nginx 리버스 프록시가 유일한 외부 진입점(내부망 전용)이며, `/` 는 frontend 정적 산출물,
`/api/*` 는 backend 로 프록시합니다. 운영 원장은 외부 PostgreSQL `bi_portal`(AWS RDS, 서울 리전)이며
Compose 에는 postgres 서비스를 두지 않고 `DATABASE_URL` 로 연결합니다. Redis 는 cache/queue/lock/token cache
전용(휘발성)입니다.

| 서비스 | 역할 | 비고 |
|---|---|---|
| `nginx` | 리버스 프록시, 정적 서빙, `/api/*` 프록시 | 내부망 전용 진입점 |
| `frontend` | React 19 + Vite 6 정적 빌드 | nginx가 서빙 |
| `backend` | FastAPI(:8000), entrypoint에서 `alembic upgrade head` 후 uvicorn | `/api/health` healthcheck |
| `worker` | Celery worker (수집/Export/메일/Refresh) | backend healthy 후 기동 |
| `scheduler` | Celery Beat (동기화/메일 스케줄 트리거) | worker 후 기동 |
| `redis` | Redis 7 (cache/queue/lock/token) | 원장 저장 금지 |
| (외부) `bi_portal` | PostgreSQL 16+ (AWS RDS, 서울) | Compose 외부, `DATABASE_URL` 연결 |

## 사전 준비

- **Docker Desktop**(또는 Docker Engine + Docker Compose v2)
- 외부 PostgreSQL `bi_portal` 접근 정보 (RDS 호스트/사용자/비밀번호, SSL 필수, 인바운드 5432 허용)
- (live 모드) Power BI 워크스페이스 접근 권한을 가진 Azure AD 앱(client credentials)
- (메일 발송 시) 사내 SMTP 서버 정보

## 1. 환경 변수 설정 (.env 생성)

루트의 `.env.bip.example` 를 복사하여 `.env` 를 만든 뒤, `<PLACEHOLDER>` 값을 환경에 맞게 교체합니다.
`APP_MODE=mock` / `AUTH_MODE=mock` 기본값에서는 외부 의존(Power BI/인사 DB) 없이 화면을 띄울 수 있습니다.

```bash
# macOS / Linux
cp .env.bip.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.bip.example .env
```

> 🔐 실제 RDS 호스트, SMTP 호스트, 워크스페이스 ID, Azure 자격 증명 등은 `.env` 에만 보관하고
> git 에 커밋하지 않습니다(`.env` 는 `.gitignore` 처리됨). `.env.bip.example` 에는 플레이스홀더만 둡니다.

### 환경 변수 설명

#### 앱

| 변수 | 설명 | 기본값 |
|---|---|---|
| `APP_MODE` | 운영 모드 (`mock` / `live`) | `mock` |
| `AUTH_MODE` | 인증 모드 (`hr-db` / `local-only` / `mock`) | `mock` |
| `APP_TIMEZONE` | 화면/저장 시각 변환 기준 타임존 | `Asia/Seoul` |
| `SESSION_SECRET` | 세션 서명/암호화용 시크릿 (긴 임의 문자열로 교체) | `<SESSION_SECRET>` |
| `SESSION_TTL_MINUTES` | 세션 만료(분) | `480` |

#### 외부 DB / Redis

| 변수 | 설명 | 기본값 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 연결 문자열(async/asyncpg). 실제 호스트는 `.env` 에만 | `postgresql+asyncpg://<DB_USER>:<DB_PASSWORD>@<RDS_HOST>:5432/bi_portal` |
| `DATABASE_SSL` | RDS SSL 연결 요구 (asyncpg `ssl=true`) | `require` |
| `DATABASE_SCHEMA` | BIP 전용 스키마(인사 뷰 public 과 분리) | `bip` |
| `REDIS_URL` | Redis 연결 문자열 (cache/queue/lock/token) | `redis://redis:6379/0` |

#### Azure AD / Power BI

| 변수 | 설명 | 기본값 |
|---|---|---|
| `AZURE_TENANT_ID` | Azure AD 테넌트 ID (live 필요) | `<AZURE_TENANT_ID>` |
| `AZURE_CLIENT_ID` | 앱(클라이언트) ID (live 필요) | `<AZURE_CLIENT_ID>` |
| `AZURE_CLIENT_SECRET` | 클라이언트 비밀 (live 필요) | `<AZURE_CLIENT_SECRET>` |
| `POWERBI_WORKSPACE_ID` | 대상 워크스페이스(group) ID | `<POWERBI_WORKSPACE_ID>` |
| `POWERBI_API_BASE_URL` | Power BI REST API 베이스 URL | `https://api.powerbi.com/v1.0/myorg` |
| `POWERBI_VERIFY_SSL` | Power BI/Azure 호출 TLS 검증 여부 | `true` |

#### 인사정보 DB 인증 (HR)

| 변수 | 설명 | 기본값 |
|---|---|---|
| `HR_PWD_HASH_ROUNDS` | `login_pwd` 검증용 SHA-256 반복 횟수(salt 없음, 레거시 호환) | `3` |

#### SMTP (미인증 발송 기본)

| 변수 | 설명 | 기본값 |
|---|---|---|
| `SMTP_HOST` | 사내 메일 서버 호스트 (실제 값은 `.env` 에만) | `<SMTP_HOST>` |
| `SMTP_PORT` | SMTP 포트 | `587` |
| `SMTP_FROM` | 발신자 주소 | `<SMTP_FROM>` |
| `SMTP_USE_AUTH` | SMTP 인증 사용 여부 | `false` |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | 인증 사용 시 자격 증명 | (빈 값) |
| `SMTP_STARTTLS` | STARTTLS 사용 여부 | `false` |

#### 작업 주기

| 변수 | 설명 | 기본값 |
|---|---|---|
| `COLLECT_INTERVAL_MINUTES` | Refresh History 수집 주기(분) | `5` |
| `EXPORT_POLL_INTERVAL_SEC` | Export 상태 polling 간격(초) | `5` |
| `EXPORT_POLL_TIMEOUT_SEC` | Export polling 전체 timeout(초) | `600` |
| `MAIL_RETRY_MAX` | 메일 발송 실패 시 최대 재시도 횟수 | `3` |

#### Power BI Embedded 용량 자동 스케일 (v1.2 연기, v1.0 미사용)

| 변수 | 설명 | 기본값 |
|---|---|---|
| `CAPACITY_AUTOSCALE_ENABLED` | 자동 스케일 활성 여부 (v1.0 미사용) | `false` |
| `CAPACITY_PEAK_SKU` / `CAPACITY_OFFPEAK_SKU` | 피크/비피크 노드 SKU | `A2` / `A1` |
| `CAPACITY_PEAK_START` / `CAPACITY_PEAK_END` | 피크 시간대(KST) | `03:00` / `08:00` |
| `CAPACITY_AZURE_RESOURCE_ID` | 용량 리소스 ID | (빈 값) |

#### 파일 저장소 / 보존

| 변수 | 설명 | 기본값 |
|---|---|---|
| `STORAGE_ROOT_PATH` | 이미지/zip 저장 루트(개발=volume, 운영=NAS) | `/data/reportimage` |
| `STORAGE_BACKEND` | 저장소 백엔드 (`local` / `nas` / `s3`) | `local` |
| `SERVE_REPORTIMAGE_STATIC` | nginx 정적 서빙(권한 우회) — 기본 off | `false` |
| `IMAGE_RETENTION_DAYS` | 저장 이미지 보존 일수 | `90` |
| `AUDIT_RETENTION_DAYS` | 감사 로그 보존 일수 | `365` |
| `UNUSED_REPORT_DAYS` | 미사용 리포트 판정 기준 일수 | `90` |

#### 프론트

| 변수 | 설명 | 기본값 |
|---|---|---|
| `AUTO_REFRESH_INTERVAL_SEC` | 화면 자동 리렌더링 기본 간격(초) | `60` |
| `CORS_ALLOWED_ORIGINS` | Backend CORS 허용 Origin(콤마 구분) | `https://bip.intra.example` |

## 2. 실행 (docker compose)

```bash
docker compose up --build
```

백그라운드 실행 / 종료:

```bash
docker compose up -d --build   # 백그라운드 기동
docker compose logs -f backend # 특정 서비스 로그 추적
docker compose down            # 종료
```

기동 순서는 `depends_on` + healthcheck 로 보장됩니다:
`redis`(healthy) → `backend`(마이그레이션 완료 + healthy) → `worker` → `scheduler`.
운영 DB(`bi_portal`)는 Compose 외부에 있으므로 기동 전에 접근 가능해야 합니다.

## 3. 접속 URL

- **Frontend (웹 UI)**: nginx 진입점(내부망 도메인 또는 <http://localhost>)
- **Backend (API)**: nginx `/api/*` 프록시 경유
  - 헬스 체크: `/api/health`
  - OpenAPI 문서: `/docs`

## 4. 모드 전환 (mock ↔ live, 인증 모드)

- `APP_MODE=mock` : Power BI/Azure 호출을 mock 으로 대체(외부 의존 없이 전체 화면 시연).
- `APP_MODE=live` : 실제 Power BI REST API 연동. `AZURE_*`, `POWERBI_WORKSPACE_ID` 가 유효해야 합니다.
- `AUTH_MODE=mock` : 개발용 mock 사용자 로그인(인사 DB 불필요).
- `AUTH_MODE=hr-db` : 인사정보 뷰(`scl_v_insa_*`) 기반 사번/비밀번호 로그인(운영).
- `AUTH_MODE=local-only` : 비상 로컬 관리자만 허용(인사 DB 장애 대비).

`.env` 값을 바꾼 뒤 `docker compose up -d --build` 로 재기동합니다.

## 5. 데이터베이스 마이그레이션 (Alembic)

- 모든 BIP 스키마 변경은 Alembic 마이그레이션으로만 수행합니다(수동 DDL 금지).
- `backend` entrypoint 가 기동 시 `alembic upgrade head` 를 먼저 실행한 뒤 uvicorn 을 띄웁니다.
- 마이그레이션은 BIP 전용 스키마(`bip`)에만 작용하고 `public`(인사 뷰)은 건드리지 않습니다.
- 운영계(prod)는 `.env.prod` + `alembic upgrade head` 로 개발계와 동일 스키마를 코드로 재현합니다.

```bash
docker compose exec backend alembic upgrade head   # 수동 적용
docker compose exec backend alembic current        # 현재 리비전 확인
```

## 6. 환경 분리 / 개발계 → 운영계 이관 (D-23)

| 구분 | 개발계(dev, 현재) | 운영계(prod, 추후) |
|---|---|---|
| 구성 파일 | `.env.dev` | `.env.prod` |
| DB | `bi_portal` RDS(서울), 스키마 `bip` | 동일 구조의 운영 DB/스키마 |
| 모드 | `APP_MODE=mock`/`live`, `AUTH_MODE=mock`/`hr-db` | `APP_MODE=live`, `AUTH_MODE=hr-db` |
| 로컬 테스트/CI | `docker-compose.test.yml`(일회용 PG) | — |

- 데이터는 이관하지 않으며(환경별 독립 원장), 기준 데이터(역할 코드 등)는 멱등 시드 스크립트로 동일 적용합니다.
- 환경별 차이는 코드가 아니라 `.env` 로만 표현합니다(DB URL, 워크스페이스 ID, Azure/SMTP, `STORAGE_ROOT_PATH` 등).
- Power BI 연결 정보를 전부 환경 변수로 외부화하여, 서버 이전(cutover) 시 코드 변경 없이 `.env` 교체 + 재기동으로 전환합니다(D-22).

## 7. 보안 주의

- Power BI/Azure/SMTP 시크릿은 `backend`/`worker`/`scheduler` 컨테이너 환경 변수로만 주입되며
  `frontend` 빌드에는 절대 포함하지 않습니다.
- 입력 비밀번호는 요청 처리 중 메모리에서만 사용하고 로그/응답/감사 로그에 남기지 않습니다.
- `SERVE_REPORTIMAGE_STATIC` 은 권한 검증을 우회하므로 기본 비활성이며, 내부망 편의가 필요할 때만 켭니다.
  저장 이미지의 기본 접근 경로는 메일 inline CID 첨부 또는 권한 검증 다운로드 API(`GET /api/report-images/{id}`)입니다.
