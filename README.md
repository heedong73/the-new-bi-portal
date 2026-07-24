# BIP — The New BI Portal

사내 Power BI 레포트 공유 포털 (외부 업체 솔루션 대체)

## 기동 방법

```bash
# 1. 환경 변수 설정
cp .env.example .env
# .env 파일에서 실제 값으로 교체

# 2. 전체 스택 기동
docker compose up --build

# 3. 테스트 실행
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
```

## 개발 환경 (Backend 로컬)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate       # Windows
source .venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
```

## 백그라운드 작업 (Redis / Celery) — 수동으로 켜야 하나요?

레포트 게시(PBIX import), 수동 새로고침, 메일 발송은 **Celery 워커**가 처리하며 **Redis**를 큐로 사용합니다. 실행 방식에 따라 수동 기동 여부가 다릅니다.

- **`docker compose up`로 기동하는 경우 (권장/일반 사용)**: redis, worker, scheduler가 컨테이너로 **자동 기동**됩니다. 따로 켤 필요가 없습니다. (리눅스 컨테이너라 워커 풀 문제도 없음)
- **로컬에서 개별 실행하는 경우 (백엔드 핫리로드 개발)**: Redis와 Celery 워커를 **직접 켜야** 합니다. 워커가 떠 있지 않으면 업로드가 "게시중"에서 멈춘 것처럼 보이고 완료되지 않습니다.

### 로컬(Windows) 워커 실행

Celery 기본 prefork 풀은 Windows에서 동작하지 않으므로(`WinError 6`), **solo 풀**로 실행해야 합니다. 편의 스크립트를 제공합니다.

```bat
REM backend 폴더에서
run_worker.cmd
REM 또는 직접:
.venv\Scripts\python.exe -m celery -A app.workers.celery_app worker -l info --pool=solo
```

Redis는 Docker 백그라운드 컨테이너(`bip-dev-redis`)로 띄우는 것을 권장합니다. 저장소 루트에서 `redis-up.cmd`(있으면)로 시작하거나 직접:

```bat
docker run -d --name bip-dev-redis --restart unless-stopped -p 6379:6379 redis:7-alpine
```

`--restart unless-stopped`를 주면 이후 Docker Desktop이 켜질 때 Redis가 **자동으로 함께 기동**됩니다(창 불필요). 중지는 `docker stop bip-dev-redis`. `.env`의 `REDIS_URL`이 이 Redis를 가리켜야 합니다. 운영(docker-compose/리눅스)에서는 prefork가 정상 동작하므로 solo 풀이 필요 없습니다.

### 로컬 일괄 기동 (한 번에)

매번 수동으로 켜기 번거로우면 루트의 `dev-up.cmd`를 실행하세요. Redis는 Docker 백그라운드 컨테이너로(창 없이) 보장하고, Celery 워커(solo) · Celery Beat · Backend(uvicorn) · Frontend(vite)를 각각 새 창으로 띄웁니다.

```bat
REM 저장소 루트에서
dev-up.cmd
```

사전 준비: Docker Desktop 실행, `backend\.venv` 의존성 설치, `frontend` `npm install`, `.env` 존재. (Redis 외 4개 창을 닫으면 해당 서비스가 종료됩니다. Redis는 `docker stop bip-dev-redis`로 중지.)

## 구성 서비스

| 서비스 | 역할 |
|--------|------|
| nginx | 리버스 프록시 (:80) |
| backend | FastAPI :8000 |
| worker | Celery Worker |
| scheduler | Celery Beat |
| redis | Cache/Queue/Lock |
| (외부) PostgreSQL | bi_portal RDS |
