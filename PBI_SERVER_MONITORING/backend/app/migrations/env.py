"""Alembic migration environment (async).

Design reference: "Alembic 마이그레이션 정책".

Key decisions
-------------
- ``target_metadata`` is ``Base.metadata``. Importing ``app.models`` registers
  all five tables (workspaces, reports, datasets, refresh_runs,
  refresh_schedules) so autogenerate / metadata comparison sees them.
- The database URL is read from ``Settings.DATABASE_URL`` (an asyncpg DSN,
  ``postgresql+asyncpg://...``) and overrides whatever placeholder is in
  ``alembic.ini`` — credentials are never hard-coded in the ini file.
- Online mode runs against an ``AsyncEngine`` via
  ``connection.run_sync(context.run_migrations)`` (asyncio).
- Offline mode (``--sql``) is also supported for generating SQL without a DB.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

# Import the application's metadata. Importing ``app.models`` (its __init__)
# registers every ORM model on ``Base.metadata``.
from app.core.config import get_settings
from app.models import Base

# Alembic Config object, providing access to alembic.ini values.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject the runtime database URL from application settings (asyncpg driver).
# This overrides the placeholder ``sqlalchemy.url`` in alembic.ini.
config.set_main_option("sqlalchemy.url", get_settings().DATABASE_URL)

# Target metadata for autogenerate and metadata-based operations.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL, no DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Configure context with a live connection and run migrations."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations within a connection."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode against an async engine."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
