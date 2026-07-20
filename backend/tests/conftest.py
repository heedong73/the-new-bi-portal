"""pytest 공용 fixture — DB 마이그레이션, 세션(SAVEPOINT 격리), 환경 설정.

테스트 시작 시 전용 DB를 Alembic head까지 올리고, 각 테스트는 트랜잭션 안에서
실행 후 롤백하여 서로 격리한다. docker-compose.test.yml의 postgres-test를 사용한다.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://bip_test:bip_test@localhost:5432/bi_portal_test",
)
os.environ.setdefault("DATABASE_SSL", "disable")
os.environ.setdefault("DATABASE_SCHEMA", "bip")
os.environ.setdefault("APP_MODE", "mock")
os.environ.setdefault("AUTH_MODE", "mock")

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_NAME = "bi_portal_test"


@pytest.fixture(scope="session", autouse=True)
def migrate_test_database() -> None:
    """전용 테스트 DB만 Alembic head로 갱신한다.

    로컬에서 ``pytest``만 직접 실행해도 docker-compose의 실행 순서와 동일하게
    스키마가 준비된다. 잘못 설정된 개발/운영 DB는 변경하지 않고 즉시 중단한다.
    """
    database_name = make_url(settings.DATABASE_URL).database
    if database_name != TEST_DATABASE_NAME:
        raise pytest.UsageError(
            f"Refusing to migrate non-test database: expected {TEST_DATABASE_NAME!r}, "
            f"got {database_name!r}"
        )

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")


@pytest_asyncio.fixture
async def db():
    """테스트용 DB 세션. 각 테스트 후 롤백으로 격리."""
    engine = create_async_engine(settings.DATABASE_URL, connect_args={"ssl": False})
    conn = await engine.connect()
    trans = await conn.begin()
    Session = async_sessionmaker(bind=conn, expire_on_commit=False, class_=AsyncSession)
    session = Session()
    try:
        yield session
    finally:
        await session.close()
        await trans.rollback()
        await conn.close()
        await engine.dispose()
