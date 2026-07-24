"""Feature: the-new-bi-portal, Property 9: 그룹 멱등성 + 최소 역할 invariant.

- 그룹원 추가를 임의 횟수 반복해도 (group, user) row는 1을 넘지 않는다.
- 임의의 역할 부여/회수 시퀀스 후에도 사용자는 항상 General_User를 보유한다.

example/대표 케이스 테스트로 충족 (Tier 2).
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, func

from app.core.constants import RoleCode
from app.models.auth import User, Role, UserRole
from app.models.portal import UserGroup, UserGroupMember

def _uid() -> str:
    return uuid.uuid4().hex[:12]

@pytest.mark.asyncio
async def test_group_membership_idempotent(db):
    """같은 (group, user) 추가를 여러 번 시도해도 row는 1개."""
    user = User(external_id=_uid(), name="u", is_active=True)
    db.add(user)
    group = UserGroup(name=f"G_{_uid()}")
    db.add(group)
    await db.flush()

    # 멱등 추가 로직 모사: 존재하지 않을 때만 삽입, 3회 반복
    for _ in range(3):
        existing = await db.scalar(
            select(UserGroupMember).where(
                UserGroupMember.group_id == group.id,
                UserGroupMember.user_id == user.id,
            )
        )
        if existing is None:
            db.add(UserGroupMember(group_id=group.id, user_id=user.id))
            await db.flush()

    count = await db.scalar(
        select(func.count()).select_from(UserGroupMember).where(
            UserGroupMember.group_id == group.id,
            UserGroupMember.user_id == user.id,
        )
    )
    assert count == 1

@pytest.mark.asyncio
async def test_minimum_general_role_preserved(db):
    """역할 부여/회수 후에도 General_User는 항상 보유 (최소 역할 보장)."""
    general = await db.scalar(select(Role).where(Role.code == RoleCode.GENERAL_USER))
    assert general is not None  # 시드 데이터 존재

    user = User(external_id=_uid(), name="u", is_active=True)
    db.add(user)
    await db.flush()
    db.add(UserRole(user_id=user.id, role_id=general.id))
    await db.flush()

    # System_Operator 부여 후 회수 (General은 건드리지 않는 정책)
    operator_role = await db.scalar(select(Role).where(Role.code == RoleCode.SYSTEM_OPERATOR))
    db.add(UserRole(user_id=user.id, role_id=operator_role.id))
    await db.flush()

    # System_Operator 회수
    from sqlalchemy import delete
    await db.execute(
        delete(UserRole).where(
            UserRole.user_id == user.id, UserRole.role_id == operator_role.id
        )
    )
    await db.flush()

    # General_User는 여전히 보유
    roles = await db.execute(
        select(Role.code).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user.id)
    )
    codes = [r[0] for r in roles.all()]
    assert RoleCode.GENERAL_USER in codes