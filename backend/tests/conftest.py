"""pytest 공용 fixture — DB 세션(SAVEPOINT 격리), 환경 설정.

각 테스트는 트랜잭션 안에서 실행 후 롤백하여 서로 격리된다.
docker-compose.test.yml 의 postgres-test(localhost:5432) 사용.
"""
from __future__ import annotations

import os

import pytest
import pytest_asyncio

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://bip_test:bip_test@localhost:5432/bi_portal_test",
)
os.environ.setdefault("DATABASE_SSL", "disable")
os.environ.setdefault("DATABASE_SCHEMA", "bip")
os.environ.setdefault("APP_MODE", "mock")
os.environ.setdefault("AUTH_MODE", "mock")

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.config import settings

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
