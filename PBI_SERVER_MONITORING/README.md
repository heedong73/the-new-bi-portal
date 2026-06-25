# Power BI Refresh Monitor

Power BI Embedded Workspace에 포함된 모든 Report의 데이터셋(Semantic Model) 새로고침(refresh) 현황을
웹에서 운영 모니터링용으로 시각화하는 시스템입니다. 좌측 사이드바, 상단 헤더, 필터, KPI 카드,
중앙 Gantt 타임테이블, 우측 실행 흐름 요약, 하단 분석 차트와 상세 테이블로 구성된 한국어 UI를 제공합니다.

Power BI REST API의 Reports / Datasets / Refresh History / Refresh Schedule 엔드포인트를 주기적으로 수집하여
PostgreSQL에 정규화 적재하고, Redis로 토큰·응답을 캐싱하며, Celery Worker/Beat로 백그라운드 수집을 수행합니다.
Power BI의 refresh history가 Dataset 단위라는 제약을 고려해, Reports와 Refresh History를 `datasetId`로 조인하여
리포트 단위 화면을 제공합니다.

## 주요 특징

- **Mock_Mode 우선**: Azure AD 자격 증명 없이도 모든 화면과 API가 동작합니다. 환경 변수 하나(`APP_MODE`)로 Live_Mode 전환.
- **단일 명령 기동**: `docker compose up --build` 한 번으로 6개 서비스가 함께 뜹니다. Python/Node 로컬 설치 불필요.
- **자동 수집**: Celery Beat가 설정한 주기(1분 또는 5분)마다 자동 수집하며, 즉시 수집(`POST /api/collect-now`)도 지원합니다.
- **한국어 UI**: 모든 사용자 노출 메시지가 한국어입니다.

## 기술 스택

| 영역 | 스택 |
|---|---|
| **Backend** | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.x (async), Alembic, asyncpg, httpx, Celery, structlog |
| **Frontend** | React 19, Vite 6, TypeScript, Tailwind CSS v4, TanStack Query, Zustand, React Router, Recharts, lucide-react, date-fns |
| **Infra** | PostgreSQL 16, Redis 7, Docker Compose (worker = Celery, scheduler = Celery Beat) |

## 사전 준비

- **Docker Desktop**(또는 Docker Engine + Docker Compose v2)만 설치되어 있으면 됩니다.
  - Python·Node.js를 로컬에 직접 설치할 필요가 없습니다. 빌드/실행/마이그레이션은 모두 `docker compose`가 처리합니다.
  - 로컬에서 직접 테스트/개발하고 싶을 때만 Python 3.12 / Node.js 20 LTS가 선택적으로 필요합니다(아래 "개발 / 테스트" 참고).
- (Live_Mode 사용 시) Power BI Workspace 접근 권한을 가진 Azure AD 앱 등록 및 client credentials → "5. Power BI 연동 설정" 참고.

## 1. 환경 변수 설정 (.env 생성)

루트의 `.env.example` 파일을 복사하여 `.env` 파일을 만든 뒤, 값을 환경에 맞게 수정합니다.
Mock_Mode(기본값)에서는 값을 수정하지 않아도 그대로 기동됩니다.

```bash
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

주요 환경 변수:

| 변수 | 설명 | 기본값 |
|---|---|---|
| `APP_MODE` | 운영 모드 (`mock` / `live`) | `mock` |
| `APP_TIMEZONE` | 시각 변환 기준 타임존 | `Asia/Seoul` |
| `POWERBI_API_BASE_URL` | Power BI REST API 베이스 URL | `https://api.powerbi.com/v1.0/myorg` |
| `POWERBI_WORKSPACE_ID` | 모니터링 대상 Workspace(group) ID | - |
| `AZURE_TENANT_ID` | Azure AD 테넌트 ID (Live_Mode 필요) | - |
| `AZURE_CLIENT_ID` | 앱(클라이언트) ID (Live_Mode 필요) | - |
| `AZURE_CLIENT_SECRET` | 클라이언트 비밀 (Live_Mode 필요) | - |
| `DATABASE_URL` | PostgreSQL 연결 문자열 (async / asyncpg) | `postgresql+asyncpg://prm:prm@postgres:5432/prm` |
| `REDIS_URL` | Redis 연결 문자열 (토큰/락/Celery) | `redis://redis:6379/0` |
| `COLLECT_INTERVAL_MINUTES` | Collector 수집 주기(분, 허용값 `1` 또는 `5`) | `5` |
| `CACHE_TTL_SECONDS` | Refresh 응답 Redis 캐시 TTL(초) | `60` |
| `CORS_ALLOWED_ORIGINS` | Backend CORS 허용 Origin (콤마 구분) | `http://localhost:5173` |
| `AUTO_REFRESH_INTERVAL_SEC` | 자동 새로고침 토글 활성 시 재조회 간격(초) | `60` |
| `VITE_API_BASE_URL` | Frontend가 호출할 Backend API 베이스 URL | `http://localhost:8000` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres 컨테이너 초기화 값 | `prm` / `prm` / `prm` |

> 🔐 `AZURE_CLIENT_SECRET` 등 시크릿 값은 `.env`에만 두고 git에 커밋하지 마세요. `.env`는 `.gitignore` 처리되어 있습니다.
> `.env.example`에는 placeholder 값만 포함되어 있습니다.

## 2. 실행 (docker compose)

```bash
docker compose up --build
```

백그라운드 실행 / 종료:

```bash
docker compose up -d --build   # 백그라운드 기동
docker compose logs -f backend # 특정 서비스 로그 추적
docker compose down            # 종료 (볼륨 유지)
docker compose down -v         # 종료 + DB 볼륨 삭제(초기화)
```

기동되는 6개 서비스:

| 서비스 | 역할 | 비고 |
|---|---|---|
| `postgres` | PostgreSQL 16 영속 저장소 | healthcheck `pg_isready`, named volume `postgres-data` |
| `redis` | Redis 7 (토큰 캐시 / 분산 락 / Celery broker) | healthcheck `redis-cli ping` |
| `backend` | FastAPI API 서버 (:8000) | entrypoint에서 `alembic upgrade head` 후 uvicorn 기동 |
| `frontend` | React + Vite 정적 빌드 (nginx, 컨테이너 :80 → 호스트 5173) | SPA fallback |
| `worker` | Celery worker (수집 작업 처리) | backend healthy 이후 기동 |
| `scheduler` | Celery Beat (주기적 수집 트리거) | worker 기동 이후 기동 |

기동 순서는 `depends_on` + healthcheck로 보장됩니다: `postgres`/`redis`(healthy) → `backend`(마이그레이션 완료 + healthy) → `worker` → `scheduler`.

## 3. 접속 URL

- **Frontend (웹 UI)**: <http://localhost:5173>
- **Backend (API)**: <http://localhost:8000>
  - 헬스 체크: <http://localhost:8000/api/health> → `{"status":"ok","mode":"mock|live","version":"1.0.0"}`
  - OpenAPI 문서(Swagger UI): <http://localhost:8000/docs>
  - OpenAPI 스키마(JSON): <http://localhost:8000/openapi.json>

## 4. Mock_Mode ↔ Live_Mode 전환

운영 모드는 `.env`의 **`APP_MODE`** 환경 변수 하나로 전환합니다. 코드 변경은 필요하지 않습니다.

- **Mock_Mode (`APP_MODE=mock`)**: 외부 Power BI API를 호출하지 않고 사전 정의된 mock 데이터로 동작합니다.
  실제 Azure AD 자격 증명 없이도 모든 화면이 정상 렌더링됩니다. (기본값)
- **Live_Mode (`APP_MODE=live`)**: 실제 Power BI REST API와 연동되어 동작합니다.
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `POWERBI_WORKSPACE_ID`가 모두 유효해야 합니다.

전환 절차:

```bash
# .env 파일에서 값을 변경
APP_MODE=live

# 컨테이너 재기동
docker compose up -d --build
```

> Mock_Mode와 Live_Mode는 동일한 API 엔드포인트와 응답 스키마를 사용하므로, 모드를 바꿔도 Frontend는 변경 없이 동작합니다.

## 5. Power BI 연동 설정 (Live_Mode)

Live_Mode로 실제 Power BI Embedded 워크스페이스에 연동하려면 `.env`의 다음 4개 값만 채우면 됩니다.
호출 대상 API 주소(`/groups/{workspaceId}/reports` 등)는 코드에 이미 고정되어 있으므로 별도로 "내 서버 API 주소"를
알아낼 필요는 없습니다. **고정 엔드포인트(`https://api.powerbi.com/v1.0/myorg`) + 워크스페이스 ID + 인증 자격 증명** 조합으로 동작합니다.

```
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
POWERBI_WORKSPACE_ID=
```

### 5.1 POWERBI_WORKSPACE_ID

Power BI 웹 포털에서 대상 워크스페이스를 연 뒤 브라우저 주소창을 확인합니다.

```
https://app.powerbi.com/groups/{이 GUID가 workspace_id}/list
```

`groups/` 뒤의 GUID가 워크스페이스 ID입니다. 주소에 `me`가 표시되면 "내 작업 영역"이므로, 별도 워크스페이스를 하나 만들어 사용하세요.

### 5.2 AZURE_TENANT_ID

Azure Portal → **Microsoft Entra ID(구 Azure AD)** → **개요(Overview)** 화면의 "테넌트 ID"입니다. 조직당 하나입니다.

### 5.3 AZURE_CLIENT_ID / AZURE_CLIENT_SECRET (앱 등록)

이 시스템은 **client credentials(앱 전용) 인증 방식**을 사용합니다. "서비스 주체(Service Principal)" 역할을 하는 앱이 토큰을 받아 Power BI API를 호출합니다.

- **AZURE_CLIENT_ID**: 앱의 애플리케이션(클라이언트) ID
- **AZURE_CLIENT_SECRET**: 앱의 클라이언트 비밀 값(Value). 생성 직후 한 번만 표시되므로 즉시 복사해 두세요.

#### 기존 앱 재사용 vs 새 앱 등록

꼭 새 앱을 만들 필요는 없습니다. 기존 앱 등록을 재사용해도 됩니다. 다음 조건만 충족하면 됩니다.

- **기존 앱 재사용이 가능한 경우**: 클라이언트 비밀을 가질 수 있는 앱(confidential client)이고, 아래 5.4의 두 권한 설정이 되어 있으면 그대로 사용 가능합니다. 비밀 값을 모른다면 앱 자체를 새로 만들 필요 없이 **그 앱에 새 클라이언트 비밀만 하나 추가 발급**하면 됩니다.
- **새 앱 등록을 권장하는 경우**:
  - 기존 앱이 다른 용도(사용자 로그인용, 위임 권한 기반)로 쓰여 권한/시크릿을 분리하고 싶을 때
  - 기존 앱의 비밀 추가가 다른 시스템에 영향을 줄 수 있을 때
  - 최소 권한 원칙으로 "읽기 모니터링 전용" service principal을 따로 관리하고 싶을 때
- **주의**: 단순 SPA/모바일 로그인용 앱(비밀이 없는 public client, 위임 권한 전용)은 이 용도에 부적합합니다. 이 경우 confidential client 앱을 새로 등록하세요.

새 앱 등록 절차:

1. Azure Portal → **Microsoft Entra ID → 앱 등록(App registrations) → 새 등록**
2. 이름 입력 후 등록 → 표시되는 **애플리케이션(클라이언트) ID**를 `AZURE_CLIENT_ID`로 사용
3. 해당 앱 → **인증서 및 비밀(Certificates & secrets) → 새 클라이언트 비밀** 생성 → 표시되는 **값(Value)**을 `AZURE_CLIENT_SECRET`로 사용 (생성 직후 한 번만 표시됨)

### 5.4 필수 권한 설정 (2가지)

앱만 등록하면 호출 시 401/403이 발생합니다. 다음 두 가지를 반드시 설정하세요.

1. **Power BI 테넌트 설정 허용** (Power BI 관리자 권한 필요):
   Power BI 관리 포털 → 테넌트 설정에서 "서비스 주체(Service Principal)가 Power BI API를 사용하도록 허용"을 켜고,
   위에서 등록한 앱(또는 그 앱이 속한 보안 그룹)을 허용 목록에 추가합니다.
2. **워크스페이스 멤버 추가**:
   모니터링 대상 워크스페이스 → **액세스(Access)** 에서 위 앱(서비스 주체)을 **구성원(Member) 또는 뷰어(Viewer)** 이상으로 추가합니다.
   이 설정이 빠지면 워크스페이스의 Reports/Datasets가 조회되지 않습니다.

### 5.5 사용되는 Power BI REST API

연동 시 다음 엔드포인트가 자동으로 호출됩니다(모두 코드에 고정되어 있음).

| 엔드포인트 | 수집 항목 |
|---|---|
| `GET /groups/{workspaceId}/reports` | reportId, reportName, datasetId |
| `GET /groups/{workspaceId}/datasets` | datasetId, datasetName |
| `GET /groups/{workspaceId}/datasets/{datasetId}/refreshes?$top=60` | startTime, endTime, status, refreshType, requestId, serviceExceptionJson |
| `GET /groups/{workspaceId}/datasets/{datasetId}/refreshSchedule` | 예약 시각, 요일, timezone, enabled |

## 6. 데이터베이스 마이그레이션 (Alembic)

스키마 변경은 모두 Alembic 마이그레이션(`backend/app/migrations/versions/`)으로 관리됩니다.

- **자동 적용**: `backend` 컨테이너의 `entrypoint.sh`가 기동 시 `alembic upgrade head`를 먼저 실행한 뒤 uvicorn을 띄웁니다.
  마이그레이션이 실패하면 컨테이너가 트래픽을 받지 않으므로, 스키마가 항상 최신 상태임이 보장됩니다.
- **worker / scheduler는 마이그레이션을 실행하지 않습니다.** `backend`가 healthy가 될 때까지 대기한 후 기동됩니다.

수동으로 마이그레이션을 실행해야 할 때(예: 디버깅):

```bash
# 실행 중인 backend 컨테이너 안에서
docker compose exec backend alembic upgrade head

# 현재 리비전 확인
docker compose exec backend alembic current

# 새 마이그레이션 자동 생성(모델 변경 후)
docker compose exec backend alembic revision --autogenerate -m "변경 설명"
```

## 7. 수집 동작 (Collector / Scheduler)

- **주기적 자동 수집**: `scheduler`(Celery Beat)가 `COLLECT_INTERVAL_MINUTES`(허용값 `1` 또는 `5`)마다
  `prm.collect_workspace` 작업을 트리거하고, `worker`(Celery)가 이를 처리합니다.
  수집 흐름은 Reports → Datasets → Refresh History → Refresh Schedule 순으로 upsert합니다.
- **즉시 수집**: 다음 스케줄을 기다리지 않고 바로 수집하려면 `POST /api/collect-now`를 호출합니다.
  - 정상 enqueue: HTTP 202 `{"status":"enqueued","taskId":"..."}`
  - 이미 실행 중: HTTP 202 `{"status":"already-running"}`
  - 웹 UI 헤더의 "즉시 수집" 버튼으로도 트리거할 수 있습니다.
- **중복 방지**: 동일 Workspace 수집은 Redis 분산 락(`prm:lock:collect:{workspace_id}`)으로 동시 실행이 차단됩니다.

```bash
# curl로 즉시 수집 트리거
curl -X POST http://localhost:8000/api/collect-now
```

```powershell
# Windows PowerShell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/collect-now
```

> Mock_Mode에서도 worker/scheduler가 동작하며, mock 데이터가 DB에 적재되어 화면이 갱신됩니다.

## 8. 개발 / 테스트 (선택)

Docker만으로 운영/검증이 가능하지만, 로컬에서 직접 개발하거나 테스트를 돌리고 싶을 때 사용합니다.

### Backend (pytest)

```bash
# 컨테이너 안에서 실행 (별도 로컬 설치 불필요)
docker compose exec backend pip install ".[dev]"
docker compose exec backend pytest

# 또는 로컬 Python 3.12 환경에서
cd backend
pip install ".[dev]"
pytest
```

> 일부 테스트는 property-based test(hypothesis) 및 통합 테스트(httpx ASGITransport, respx)를 포함합니다.

### Frontend (vitest)

```bash
# 컨테이너 안에서 실행
docker compose exec frontend npm test   # (프로덕션 이미지는 nginx 기반이라 dev 의존성이 없을 수 있음)

# 또는 로컬 Node.js 20 환경에서 (권장)
cd frontend
npm install
npm test            # vitest run (1회 실행)
npm run test:watch  # watch 모드
npm run dev         # Vite 개발 서버 (http://localhost:5173)
```

## 9. 트러블슈팅

- **`worker`/`scheduler`가 바로 뜨지 않음**: 정상입니다. 두 서비스는 `backend`의 마이그레이션이 끝나고 healthy가 된 뒤에 기동되도록
  `depends_on`이 설정되어 있습니다. `docker compose logs -f backend`로 마이그레이션 완료를 확인하세요.
- **Live_Mode에서 401/403 발생**: 5.4의 두 권한(테넌트 설정 허용 + 워크스페이스 멤버 추가)을 점검하세요.
  앱만 등록하고 워크스페이스에 추가하지 않은 경우가 가장 흔한 원인입니다.
- **Live_Mode에서 429(rate limit)**: Power BI API 호출 한도 초과입니다. 시스템이 `Retry-After`만큼 대기 후 재시도하지만,
  빈번하면 `COLLECT_INTERVAL_MINUTES`를 `5`로 늘리세요.
- **화면 상단 빨간 오류 배너 + "Power BI 연결에 문제가 발생했습니다"**: Backend가 502를 반환한 경우입니다(Power BI 인증/권한/rate limit).
  배너의 메시지와 `docker compose logs -f backend`/`worker`를 함께 확인하세요.
- **Frontend가 API를 호출하지 못함**: `.env`의 `VITE_API_BASE_URL`(기본 `http://localhost:8000`)과
  `CORS_ALLOWED_ORIGINS`(기본 `http://localhost:5173`)가 환경에 맞는지 확인하세요. `VITE_*`는 빌드 시점에 반영되므로 변경 후 재빌드가 필요합니다.
- **DB를 초기화하고 싶음**: `docker compose down -v`로 `postgres-data` 볼륨을 삭제한 뒤 다시 기동하세요.

## 프로젝트 구조

```
.
├── backend/                      # FastAPI 백엔드
│   ├── app/
│   │   ├── main.py               # FastAPI 앱 생성 / 라우터 마운트 / CORS
│   │   ├── core/                 # config, logging, timezone, deps, errors, constants
│   │   ├── db/                   # base, session(async engine), redis
│   │   ├── migrations/           # Alembic env.py + versions/
│   │   ├── models/               # workspace, report, dataset, refresh_run, refresh_schedule
│   │   ├── schemas/              # Pydantic 응답 스키마
│   │   ├── services/
│   │   │   ├── powerbi/          # client(Protocol)/live/mock, token_service, collector,
│   │   │   │                     #   lock, status_mapper, error_parser
│   │   │   ├── cache.py          # Redis 응답 캐시
│   │   │   ├── collect_dispatch.py
│   │   │   ├── refresh_query.py  # 조회 SQL (Report ↔ Refresh JOIN)
│   │   │   └── summary.py        # 집계
│   │   ├── api/routes/           # health, reports, datasets, schedules, refresh, summary, collect
│   │   └── workers/              # celery_app, beat_schedule, tasks/collect
│   ├── Dockerfile
│   ├── entrypoint.sh             # alembic upgrade head + uvicorn
│   ├── alembic.ini
│   └── pyproject.toml
├── frontend/                     # React 19 + Vite 6 프론트엔드
│   ├── src/
│   │   ├── main.tsx / App.tsx
│   │   ├── api/                  # client(fetch), refreshApi, hooks(TanStack Query)
│   │   ├── components/           # layout, filters, kpi, gantt, flow, charts, table, common
│   │   ├── stores/               # Zustand (필터, 토스트)
│   │   ├── types/ utils/ i18n/   # 타입, date/duration/csv 유틸, 한국어 라벨
│   │   └── mocks/                # fixtures (단계 1 전용)
│   ├── Dockerfile                # node 빌드 → nginx 서빙
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml            # 6개 서비스 정의
├── docker-compose.test.yml       # 테스트 오버라이드
├── .env.example                  # 환경 변수 예시 (placeholder)
└── README.md
```
