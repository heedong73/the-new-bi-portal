"""그룹 관리 라우트 — /api/groups (System_Operator 전용)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, delete, func, text

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, require_menu
from app.core.errors import NotFoundError, ConflictError
from app.models.portal import UserGroup, UserGroupMember
from app.models.auth import User
from app.schemas.group import (
    GroupCreate, GroupUpdate, GroupResponse, MemberRequest, GroupMemberItem,
    GroupTreeNode, GroupTreeResponse,
)
from app.services.audit_service import append_audit

router = APIRouter(prefix="/api/groups", tags=["groups"])

_require_operator = require_menu("admin_groups")

@router.get("", response_model=list[GroupResponse])
async def list_groups(db: SessionDep, _op=Depends(_require_operator)):
    groups = (await db.execute(select(UserGroup).order_by(UserGroup.id))).scalars().all()
    return [GroupResponse(id=g.id, name=g.name, description=g.description) for g in groups]


@router.get("/tree", response_model=GroupTreeResponse)
async def group_tree(
    db: SessionDep,
    cmp_id: str | None = Query(default=None),
    _op=Depends(_require_operator),
):
    """전체 조직도 트리 + 각 부서의 팀 그룹 상태.

    - 사용자 관리 화면처럼 **회사·본부·담당·팀 전체**를 반환한다(cmp_id로 회사 한정).
    - 각 노드: group_id/member_count(그룹 있으면), has_members(직속 구성원=그룹화 가능한 팀).
    - 수동 생성 그룹 및 부서가 사라진 자동 그룹은 ungrouped(평면)로 반환.
    """
    groups = (await db.execute(select(UserGroup).order_by(UserGroup.name))).scalars().all()
    auto = [g for g in groups if g.source_dept_id]
    manual = [g for g in groups if not g.source_dept_id]

    counts: dict[int, int] = {}
    for gid, c in (await db.execute(
        select(UserGroupMember.group_id, func.count()).group_by(UserGroupMember.group_id)
    )).all():
        counts[gid] = int(c)

    # 전체 활성 부서
    rows = (await db.execute(text(
        "SELECT dept_id, dept_name, up_dept_id, cmp_id FROM public.scl_v_insa_dept_add_depth "
        "WHERE dept_status='U' ORDER BY dept_sort_ordr"
    ))).mappings().all()
    dept_map = {
        r["dept_id"]: {"name": r["dept_name"], "up": r["up_dept_id"], "cmp": r["cmp_id"]}
        for r in rows
    }
    order = {r["dept_id"]: i for i, r in enumerate(rows)}  # 인사 정렬 순서 유지

    # 직속 구성원(재직) 보유 부서 = 팀
    member_depts = set((await db.execute(text(
        "SELECT DISTINCT j.dept_id FROM public.scl_v_insa_my_job j "
        "JOIN public.scl_v_insa_user u ON u.emp_no = j.emp_no AND u.emp_status='W' "
        "WHERE j.bass_dept_yn='Y'"
    ))).scalars().all())

    group_by_dept = {g.source_dept_id: g for g in auto}
    scope = {d for d, info in dept_map.items() if (not cmp_id or info["cmp"] == cmp_id)}

    children: dict[str, list[str]] = {}
    for did in dept_map:
        up = dept_map[did]["up"]
        children.setdefault(up, []).append(did)

    def build(did: str) -> GroupTreeNode:
        g = group_by_dept.get(did)
        kids = sorted(
            [c for c in children.get(did, []) if c in scope],
            key=lambda x: order.get(x, 0),
        )
        return GroupTreeNode(
            dept_id=did,
            dept_name=dept_map[did]["name"] or did,
            group_id=g.id if g else None,
            group_name=g.name if g else None,
            member_count=counts.get(g.id, 0) if g else None,
            has_members=did in member_depts,
            children=[build(k) for k in kids],
        )

    roots = sorted(
        [d for d in scope if dept_map[d]["up"] not in scope],
        key=lambda x: order.get(x, 0),
    )
    tree = [build(r) for r in roots]

    # 부서가 사라진 자동 그룹 = 미배치 → 수동 그룹과 함께 ungrouped
    orphan = [g for g in auto if g.source_dept_id not in dept_map]
    ungrouped = [
        GroupResponse(id=g.id, name=g.name, description=g.description)
        for g in (manual + orphan)
    ]
    return GroupTreeResponse(tree=tree, ungrouped=ungrouped)

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
