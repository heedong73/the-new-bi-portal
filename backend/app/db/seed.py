"""기준 데이터 멱등 시드 - 개발/운영 양 환경 동일 적용"""
import asyncio
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.auth import Role, RoleMenuPermission
from app.core.constants import RoleCode, DEFAULT_ROLE_MENUS

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


async def seed_role_menus() -> None:
    """역할별 기본 메뉴 권한 시드 (멱등). 누락분만 추가."""
    async with AsyncSessionLocal() as db:
        for code, menus in DEFAULT_ROLE_MENUS.items():
            role = await db.scalar(select(Role).where(Role.code == code))
            if role is None:
                continue
            existing = {
                m for (m,) in (await db.execute(
                    select(RoleMenuPermission.menu_key)
                    .where(RoleMenuPermission.role_id == role.id)
                )).all()
            }
            for menu in menus:
                if menu not in existing:
                    db.add(RoleMenuPermission(role_id=role.id, menu_key=menu))
        await db.commit()

if __name__ == "__main__":
    asyncio.run(seed_roles())
    asyncio.run(seed_role_menus())
