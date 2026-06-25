"""Async SQLAlchemy engine, session factory, and FastAPI dependency.

Design reference: "Backend 모듈 구조" (``db/session.py``).

The engine is created lazily from ``Settings.DATABASE_URL``
(``postgresql+asyncpg://...``) so importing this module never opens a
connection at import time. ``get_session`` is the FastAPI dependency that
yields an :class:`AsyncSession` and guarantees it is closed afterwards.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    """Return a process-wide async engine bound to ``DATABASE_URL``.

    Cached so the connection pool is shared across requests. ``pool_pre_ping``
    recycles stale connections (e.g. after a Postgres restart).
    """
    settings = get_settings()
    return create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return a cached ``async_sessionmaker`` bound to the shared engine.

    ``expire_on_commit=False`` keeps attribute values usable after commit,
    which is convenient when serializing ORM objects in route handlers.
    """
    return async_sessionmaker(
        bind=get_engine(),
        class_=AsyncSession,
        expire_on_commit=False,
    )


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an :class:`AsyncSession`.

    The session is always closed when the request finishes, returning the
    connection to the pool. Wire as ``Depends(get_session)``.
    """
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session
