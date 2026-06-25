"""로컬 관리자 계정 생성/갱신 (개발·비상용).

사용법:
  python -m scripts.create_local_admin [username] [password]
  기본값: admin / admin1234
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.auth import LocalAdmin
from app.services.auth.local_admin import hash_secret


async def main(username: str, password: str) -> None:
    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(LocalAdmin).where(LocalAdmin.username == username))
        if existing is not None:
            existing.password_hash = hash_secret(password)
            existing.is_active = True
        else:
            db.add(LocalAdmin(
                username=username,
                password_hash=hash_secret(password),
                is_active=True,
            ))
        await db.commit()
    print(f"local admin seeded: {username}")


if __name__ == "__main__":
    u = sys.argv[1] if len(sys.argv) > 1 else "admin"
    p = sys.argv[2] if len(sys.argv) > 2 else "admin1234"
    asyncio.run(main(u, p))
