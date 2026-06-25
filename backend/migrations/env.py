import asyncio
from logging.config import fileConfig
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy import pool
from alembic import context

from app.core.config import settings
from app.db.session import Base

# 모든 모델이 Base.metadata에 등록되도록 import (테이블 추가 시 여기에 import)
from app.models import *  # noqa

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
BIP_SCHEMA = settings.DATABASE_SCHEMA

def _connect_args() -> dict:
    if settings.DATABASE_SSL == "require":
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return {"ssl": ctx}
    return {"ssl": False}

def do_run_migrations(connection):
    connection.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {BIP_SCHEMA}")
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=BIP_SCHEMA,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations():
    connectable = async_engine_from_config(
        {"sqlalchemy.url": settings.DATABASE_URL},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=_connect_args(),
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
        await connection.commit()
    await connectable.dispose()

def run_migrations_offline():
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        version_table_schema=BIP_SCHEMA,
        include_schemas=True,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
