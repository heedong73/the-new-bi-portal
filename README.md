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

## 구성 서비스

| 서비스 | 역할 |
|--------|------|
| nginx | 리버스 프록시 (:80) |
| backend | FastAPI :8000 |
| worker | Celery Worker |
| scheduler | Celery Beat |
| redis | Cache/Queue/Lock |
| (외부) PostgreSQL | bi_portal RDS |
