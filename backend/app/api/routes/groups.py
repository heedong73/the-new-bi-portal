"""그룹 관리 라우트 — /api/groups (System_Operator 전용)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select, delete

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, require_menu
from app.core.errors import NotFoundError, ConflictError
from app.models.portal import UserGroup, UserGroupMember
from app.models.auth import User
from app.schemas.group import GroupCreate, GroupUpdate, GroupResponse, MemberRequest, GroupMemberItem
from app.services.audit_service import append_audit

router = APIRouter(prefix="/api/groups", tags=["groups"])

_require_operator = require_menu("admin_groups")

@router.get("", response_model=list[GroupResponse])
async def list_groups(db: SessionDep, _op=Depends(_require_operator)):
    groups = (await db.execute(select(UserGroup).order_by(UserGroup.id))).scalars().all()
    return [GroupResponse(id=g.id, name=g.name, description=g.description) for g in groups]

@router.get("/{group_id}/members", response_model=list[GroupMemberItem])
async def list_members(group_id: int, db: SessionDep, _op=Depends(_require_operator)):
    """그룹 소속원 목록."""
    group = await db.scalar(select(UserGroup).where(UserGroup.id == group_id))
    if group is None:
        raise NotFoundError("그룹을 찾을 수 없습니다.")
    users = (await db.execute(
        select(User)
        .join(UserGroupMember, UserGroupMember.user_id == User.id)
        .where(UserGroupMember.group_id == group_id)
        .order_by(User.id)
    )).scalars().all()
    return [GroupMemberItem(
        id=u.id, emp_no=u.external_id, name=u.name,
        email=u.email, department_id=u.department_id,
    ) for u in users]

@router.post("", response_model=GroupResponse, status_code=201)
async def create_group(body: GroupCreate, db: SessionDep, op=Depends(_require_operator)):
    exists = await db.scalar(select(UserGroup).where(UserGroup.name == body.name))
    if exists is not None:
        raise ConflictError("같은 이름의 그룹이 이미 존재합니다.")
    group = UserGroup(name=body.name, description=body.description)
    db.add(group)
    await db.flush()
    await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="group", resource_id=str(group.id),
                       meta={"target": "create", "group_id": group.id})
    await db.commit()
    return GroupResponse(id=group.id, name=group.name, description=group.description)

@router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(group_id: int, body: GroupUpdate, db: SessionDep, op=Depends(_require_operator)):
    group = await db.scalar(select(UserGroup).where(UserGroup.id == group_id))
    if group is None:
        raise NotFoundError("그룹을 찾을 수 없습니다.")
    if body.name is not None:
        group.name = body.name
    if body.description is not None:
        group.description = body.description
    await db.flush()
    await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="group", resource_id=str(group_id),
                       meta={"target": "update", "group_id": group_id})
    await db.commit()
    return GroupResponse(id=group.id, name=group.name, description=group.description)

@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, db: SessionDep, op=Depends(_require_operator)):
    """그룹 삭제. 멤버/그룹권한은 DB CASCADE로 함께 제거."""
    group = await db.scalar(select(UserGroup).where(UserGroup.id == group_id))
    if group is None:
        raise NotFoundError("그룹을 찾을 수 없습니다.")
    await db.delete(group)
    await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="group", resource_id=str(group_id),
                       meta={"target": "delete", "group_id": group_id})
    await db.commit()

@router.post("/{group_id}/members", status_code=204)
async def add_member(group_id: int, body: MemberRequest, db: SessionDep, op=Depends(_require_operator)):
    """그룹원 추가 (멱등: 이미 있으면 무시)."""
    group = await db.scalar(select(UserGroup).where(UserGroup.id == group_id))
    if group is None:
        raise NotFoundError("그룹을 찾을 수 없습니다.")
    user = await db.scalar(select(User).where(User.id == body.user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    existing = await db.scalar(
        select(UserGroupMember).where(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id == body.user_id,
        )
    )
    if existing is None:
        db.add(UserGroupMember(group_id=group_id, user_id=body.user_id))
        await db.flush()
        await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                           actor_user_id=op["user_id"], actor_label=op["emp_no"],
                           resource_type="group", resource_id=str(group_id),
                           meta={"target": "add_member", "group_id": group_id})
    await db.commit()

@router.delete("/{group_id}/members/{user_id}", status_code=204)
async def remove_member(group_id: int, user_id: int, db: SessionDep, op=Depends(_require_operator)):
    """그룹원 제거 (멱등: 없어도 정상)."""
    await db.execute(
        delete(UserGroupMember).where(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id == user_id,
        )
    )
    await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="group", resource_id=str(group_id),
                       meta={"target": "remove_member", "group_id": group_id})
    await db.commit()
