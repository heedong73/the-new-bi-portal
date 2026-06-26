"""조직도/인사 사용자 라우트 — /api/org (System_Operator 전용).

인사 뷰(public.scl_v_insa_*)를 읽기 전용으로 조회한다(R33.3, INSERT/UPDATE 금지).
- 조직도 트리: scl_v_insa_dept_add_depth (up_dept_id 계층)
- 부서 구성원: my_job ⋈ user(emp_status='W') ⋈ dept ⋈ office(직급)
- 권한 그룹/역할: emp_no 기준으로 부여하며, BIP 미등록자는 자동 등록(+General_User).
  가시성은 권한 기반 — 등록만으론 아무것도 안 보이고, 권한 그룹/레포트 권한이 있어야 노출.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select, text

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, require_menu
from app.core.errors import NotFoundError, ValidationError
from app.models.auth import Role, User, UserRole
from app.models.portal import UserGroup, UserGroupMember
from app.schemas.org import (
    CompanyItem, GroupAddRequest, GroupRef, OrgMember, OrgNode, RoleLevelRequest,
)
from app.services import user_admin
from app.services.audit_service import append_audit

router = APIRouter(prefix="/api/org", tags=["org"])

_require_operator = require_menu("admin_users")


@router.get("/companies", response_model=list[CompanyItem])
async def list_companies(db: SessionDep, _op=Depends(_require_operator)):
    """조직 최상위(회사) 목록 (depth=1, 사용중 'U')."""
    rows = (await db.execute(text(
        "SELECT cmp_id, dept_id, dept_name FROM public.scl_v_insa_dept_add_depth "
        "WHERE dept_depth = 1 AND dept_status = 'U' ORDER BY dept_sort_ordr"
    ))).mappings().all()
    return [CompanyItem(cmp_id=r["cmp_id"], dept_id=r["dept_id"], dept_name=r["dept_name"]) for r in rows]


@router.get("/tree", response_model=list[OrgNode])
async def org_tree(
    db: SessionDep,
    cmp_id: str | None = Query(default=None),
    _op=Depends(_require_operator),
):
    """조직도 트리 (up_dept_id 계층). cmp_id로 회사 한정 가능."""
    params: dict = {}
    where = "dept_status = 'U'"
    if cmp_id:
        where += " AND cmp_id = :cmp_id"
        params["cmp_id"] = cmp_id
    rows = (await db.execute(text(
        f"SELECT dept_id, dept_name, cmp_id, up_dept_id, dept_depth "
        f"FROM public.scl_v_insa_dept_add_depth WHERE {where} "
        f"ORDER BY dept_depth, dept_sort_ordr"
    ), params)).mappings().all()

    nodes: dict[str, OrgNode] = {}
    children_of: dict[str, list[str]] = {}
    ids = set()
    up_of: dict[str, str] = {}
    for r in rows:
        nodes[r["dept_id"]] = OrgNode(
            dept_id=r["dept_id"], dept_name=r["dept_name"],
            cmp_id=r["cmp_id"], depth=int(r["dept_depth"]), children=[],
        )
        children_of.setdefault(r["up_dept_id"], []).append(r["dept_id"])
        up_of[r["dept_id"]] = r["up_dept_id"]
        ids.add(r["dept_id"])

    def build(dept_id: str) -> OrgNode:
        node = nodes[dept_id]
        node.children = [build(cid) for cid in children_of.get(dept_id, [])]
        return node

    # 루트 = up_dept_id가 결과 집합에 없는 노드(ROOT 포함)
    return [build(did) for did in ids if up_of.get(did) not in ids]


@router.get("/members", response_model=list[OrgMember])
async def org_members(
    db: SessionDep,
    dept_id: str | None = Query(default=None),
    q: str | None = Query(default=None),
    descendants: bool = Query(default=True),
    _op=Depends(_require_operator),
):
    """부서 구성원(재직 'W') 목록 + BIP 등록 상태. dept_id 또는 q 중 하나 필수."""
    if not dept_id and not (q and q.strip()):
        raise ValidationError("부서를 선택하거나 검색어를 입력하세요.")

    params: dict = {}
    join_dept = ""
    if dept_id:
        if descendants:
            join_dept = (
                "AND j.dept_id IN ("
                "WITH RECURSIVE subtree AS ("
                "  SELECT dept_id FROM public.scl_v_insa_dept_add_depth "
                "  WHERE dept_id = :dept AND dept_status='U' "
                "  UNION ALL "
                "  SELECT d.dept_id FROM public.scl_v_insa_dept_add_depth d "
                "  JOIN subtree s ON d.up_dept_id = s.dept_id WHERE d.dept_status='U'"
                ") SELECT dept_id FROM subtree)"
            )
        else:
            join_dept = "AND j.dept_id = :dept"
        params["dept"] = dept_id

    where_q = ""
    if q and q.strip():
        where_q = "AND (u.user_name ILIKE :q OR u.emp_no ILIKE :q OR u.cmp_email ILIKE :q)"
        params["q"] = f"%{q.strip()}%"

    sql = (
        "SELECT u.emp_no, u.user_name, u.cmp_email, j.dept_id, d.dept_name, "
        "       o.ofc_name, o.ofc_ordr "
        "FROM public.scl_v_insa_my_job j "
        "JOIN public.scl_v_insa_user u ON u.emp_no = j.emp_no AND u.emp_status = 'W' "
        "LEFT JOIN public.scl_v_insa_dept_add_depth d ON d.dept_id = j.dept_id "
        "LEFT JOIN public.scl_v_insa_office o ON o.ofc_id = j.ofc_id "
        f"WHERE j.bass_dept_yn = 'Y' {join_dept} {where_q} "
        "ORDER BY o.ofc_ordr NULLS LAST, u.user_name "
        "LIMIT 500"
    )
    rows = (await db.execute(text(sql), params)).mappings().all()

    seen: dict[str, dict] = {}
    for r in rows:
        if r["emp_no"] not in seen:
            seen[r["emp_no"]] = r
    hr_rows = list(seen.values())
    emp_nos = [r["emp_no"] for r in hr_rows]

    bip_users: dict[str, User] = {}
    roles_by_user: dict[int, set[str]] = {}
    groups_by_user: dict[int, list[GroupRef]] = {}
    if emp_nos:
        users = (await db.execute(
            select(User).where(User.external_id.in_(emp_nos))
        )).scalars().all()
        bip_users = {u.external_id: u for u in users}
        user_ids = [u.id for u in users]
        if user_ids:
            for uid, code in (await db.execute(
                select(UserRole.user_id, Role.code)
                .join(Role, Role.id == UserRole.role_id)
                .where(UserRole.user_id.in_(user_ids))
            )).all():
                roles_by_user.setdefault(uid, set()).add(code)
            for uid, gid, gname in (await db.execute(
                select(UserGroupMember.user_id, UserGroup.id, UserGroup.name)
                .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
                .where(UserGroupMember.user_id.in_(user_ids))
                .order_by(UserGroupMember.user_id, UserGroup.name)
            )).all():
                groups_by_user.setdefault(uid, []).append(GroupRef(id=gid, name=gname))

    result: list[OrgMember] = []
    for r in hr_rows:
        u = bip_users.get(r["emp_no"])
        base = dict(
            emp_no=r["emp_no"], name=r["user_name"], email=r["cmp_email"],
            dept_id=r["dept_id"], dept_name=r["dept_name"], ofc_name=r["ofc_name"],
        )
        if u is not None:
            result.append(OrgMember(
                **base, registered=True, user_id=u.id, is_active=u.is_active,
                role_level=user_admin.role_level_of(roles_by_user.get(u.id, set())),
                groups=groups_by_user.get(u.id, []),
            ))
        else:
            result.append(OrgMember(**base, registered=False))
    return result


@router.post("/members/{emp_no}/groups", status_code=204)
async def add_member_group(
    emp_no: str, body: GroupAddRequest, db: SessionDep, op=Depends(_require_operator),
):
    """구성원에게 권한 그룹 부여(다중). 미등록자는 자동 등록(+General_User)."""
    user = await user_admin.get_or_register(db, emp_no)
    if user is None:
        raise ValidationError("재직 중인 인사 사용자를 찾을 수 없습니다.")
    group = await db.scalar(select(UserGroup).where(UserGroup.id == body.group_id))
    if group is None:
        raise NotFoundError("그룹을 찾을 수 없습니다.")

    existing = await db.scalar(select(UserGroupMember).where(
        UserGroupMember.group_id == body.group_id, UserGroupMember.user_id == user.id,
    ))
    if existing is None:
        db.add(UserGroupMember(group_id=body.group_id, user_id=user.id))
        await db.flush()
    await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="user", resource_id=str(user.id),
                       meta={"target": "add_group", "group_id": body.group_id})
    await db.commit()


@router.delete("/members/{emp_no}/groups/{group_id}", status_code=204)
async def remove_member_group(
    emp_no: str, group_id: int, db: SessionDep, op=Depends(_require_operator),
):
    """구성원의 권한 그룹 회수 (멱등)."""
    user = await db.scalar(select(User).where(User.external_id == emp_no))
    if user is not None:
        await db.execute(delete(UserGroupMember).where(
            UserGroupMember.group_id == group_id, UserGroupMember.user_id == user.id,
        ))
        await append_audit(db, action=AuditAction.GROUP_CHANGE, result="success",
                           actor_user_id=op["user_id"], actor_label=op["emp_no"],
                           resource_type="user", resource_id=str(user.id),
                           meta={"target": "remove_group", "group_id": group_id})
        await db.commit()


@router.put("/members/{emp_no}/role-level", status_code=204)
async def set_member_role_level(
    emp_no: str, body: RoleLevelRequest, db: SessionDep, op=Depends(_require_operator),
):
    """구성원 역할 레벨 설정. 미등록자는 자동 등록."""
    if body.role_code not in user_admin._ROLE_LEVELS:
        raise ValidationError("허용되지 않은 역할입니다.")
    user = await user_admin.get_or_register(db, emp_no)
    if user is None:
        raise ValidationError("재직 중인 인사 사용자를 찾을 수 없습니다.")
    await user_admin.set_role_level(db, user.id, body.role_code)
    await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="user_role", resource_id=str(user.id),
                       meta={"target": "set_role_level", "role_code": body.role_code})
    await db.commit()
