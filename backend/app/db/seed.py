"""기준 데이터 멱등 시드 - 개발/운영 양 환경 동일 적용"""
import asyncio
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.auth import Role
from app.core.constants import RoleCode

ROLES = [
    (RoleCode.GENERAL_USER, "일반 사용자"),
    (RoleCode.SUPER_USER, "수퍼 사용자"),
    (RoleCode.SYSTEM_OPERATOR, "시스템 운영자"),
]

async def seed_roles() -> None:
    async with AsyncSessionLocal() as db:
        for code, name in ROLES:
            exists = await db.scalar(select(Role).where(Role.code == code))
            if not exists:
                db.add(Role(code=code, name=name))
        await db.commit()

if __name__ == "__main__":
    asyncio.run(seed_roles())
