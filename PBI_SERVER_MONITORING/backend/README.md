# Power BI Refresh Monitor — Backend

FastAPI 기반 Backend API. Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.x async + Alembic + asyncpg + httpx + Celery 스택으로 구현된다.

## 로컬 실행

```bash
pip install -e .[dev]
uvicorn app.main:app --reload
```

운영 모드는 `APP_MODE` 환경 변수로 전환한다 (`mock` 기본 / `live`). 자세한 절차는 루트 `README.md`를 참고한다.

## 디렉터리 구조

`app/` 하위에 `core/`, `db/`, `models/`, `schemas/`, `services/`, `api/routes/`, `workers/` 가 위치한다 (design.md "Backend 모듈 구조" 참조). 각 모듈의 실제 구현은 단계별 task에서 채워진다.
