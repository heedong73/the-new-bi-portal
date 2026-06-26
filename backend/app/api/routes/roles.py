"""역할 + 레포트 권한 라우트 (System_Operator 전용).

- /api/roles, /api/users/{id}/roles : 역할 목록/부여/회수
- /api/reports/{id}/permissions : 레포트 권한 부여/회수/조회
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select, delete

from app.core.constants import AuditAction, RoleCode, MENU_CATALOG, ALL_MENU_KEYS
from app.core.deps import SessionDep, require_role, require_menu
from app.core.errors import NotFoundError, ConflictError, ValidationError
from app.models.auth import User, Role, UserRole, RoleMenuPermission
from app.models.report import Report, ReportPermission
from app.schemas.permission import (
    RoleResponse, RoleAssignRequest, PermissionGrantRequest, PermissionResponse,
    MenuCatalogItem, RoleMenusItem, RoleMenusResponse, RoleMenusUpdate,
)
from app.services.audit_service import append_audit

router = APIRouter(tags=["roles-permissions"])

_require_operator = require_role(RoleCode.SYSTEM_OPERATOR)
_require_roles_menu = require_menu("admin_roles")
_require_users_menu = require_menu("admin_users")
_require_reports_menu = require_menu("admin_reports")

# ===== 역할-메뉴 권한 매트릭스 =====
@router.get("/api/roles/menus", response_model=RoleMenusResponse)
async def get_role_menus(db: SessionDep, _op=Depends(_require_roles_menu)):
    """역할별 메뉴 권한 매트릭스 (카탈로그 + 역할별 부여 목록)."""
    roles = (await db.execute(select(Role).order_by(Role.id))).scalars().all()
    perms = (await db.execute(select(RoleMenuPermission))).scalars().all()
    by_role: dict[int, list[str]] = {}
    for p in perms:
        by_role.setdefault(p.role_id, []).append(p.menu_key)
    items = []
    for r in roles:
        # System_Operator는 항상 전체 (잠금)
        menus = list(ALL_MENU_KEYS) if r.code == RoleCode.SYSTEM_OPERATOR.value else sorted(by_role.get(r.id, []))
        items.append(RoleMenusItem(id=r.id, code=r.code, name=r.name, menus=menus))
    return RoleMenusResponse(
        catalog=[MenuCatalogItem(key=k, label=label) for k, label in MENU_CATALOG],
        roles=items,
    )

@router.put("/api/roles/{role_id}/menus", status_code=204)
async def set_role_menus(role_id: int, body: RoleMenusUpdate, db: SessionDep, op=Depends(_require_roles_menu)):
    """역할 메뉴 권한 일괄 설정(교체). System_Operator는 전체로 강제."""
    role = await db.scalar(select(Role).where(Role.id == role_id))
    if role is None:
        raise NotFoundError("역할을 찾을 수 없습니다.")

    valid = set(ALL_MENU_KEYS)
    if role.code == RoleCode.SYSTEM_OPERATOR.value:
        target = list(ALL_MENU_KEYS)  # 운영자는 잠금: 항상 전체
    else:
        target = [m for m in body.menus if m in valid]

    await db.execute(delete(RoleMenuPermission).where(RoleMenuPermission.role_id == role_id))
    for m in target:
        db.add(RoleMenuPermission(role_id=role_id, menu_key=m))
    await db.flush()
    await append_audit(db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="role", resource_id=str(role_id),
                       meta={"target": "set_role_menus", "menus": target})
    await db.commit()

# ===== 역할 =====
@router.get("/api/roles", response_model=list[RoleResponse])
async def list_roles(db: SessionDep, _op=Depends(_require_roles_menu)):
    roles = (await db.execute(select(Role).order_by(Role.id))).scalars().all()
    return [RoleResponse(id=r.id, code=r.code, name=r.name) for r in roles]

@router.post("/api/users/{user_id}/roles", status_code=204)
async def assign_role(user_id: int, body: RoleAssignRequest, db: SessionDep, op=Depends(_require_users_menu)):
    """역할 부여 (멱등)."""
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")
    role = await db.scalar(select(Role).where(Role.code == body.role_code))
    if role is None:
        raise NotFoundError("역할을 찾을 수 없습니다.")

    existing = await db.scalar(
        select(UserRole).where(UserRole.user_id == user_id, UserRole.role_id == role.id)
    )
    if existing is None:
        db.add(UserRole(user_id=user_id, role_id=role.id))
        await db.flush()
        await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                           actor_user_id=op["user_id"], actor_label=op["emp_no"],
                           resource_type="user_role", resource_id=str(user_id),
                           meta={"target": "assign_role", "role_id": role.id})
    await db.commit()

@router.delete("/api/users/{user_id}/roles/{role_code}", status_code=204)
async def revoke_role(user_id: int, role_code: str, db: SessionDep, op=Depends(_require_users_menu)):
    """역할 회수. General_User는 회수 불가 (최소 역할 보장, R7.4)."""
    if role_code == RoleCode.GENERAL_USER:
        raise ConflictError("General_User 역할은 회수할 수 없습니다.")
    role = await db.scalar(select(Role).where(Role.code == role_code))
    if role is None:
        raise NotFoundError("역할을 찾을 수 없습니다.")
    await db.execute(
        delete(UserRole).where(UserRole.user_id == user_id, UserRole.role_id == role.id)
    )
    await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="user_role", resource_id=str(user_id),
                       meta={"target": "revoke_role", "role_id": role.id})
    await db.commit()

# ===== 레포트 권한 =====
@router.get("/api/reports/{report_id}/permissions", response_model=list[PermissionResponse])
async def list_permissions(report_id: int, db: SessionDep, _op=Depends(_require_reports_menu)):
    perms = (await db.execute(
        select(ReportPermission).where(ReportPermission.report_id == report_id)
    )).scalars().all()
    return [PermissionResponse(
        id=p.id, report_id=p.report_id, subject_type=p.subject_type,
        subject_id=p.subject_id, permission=p.permission,
    ) for p in perms]

@router.post("/api/reports/{report_id}/permissions", response_model=PermissionResponse, status_code=201)
async def grant_permission(report_id: int, body: PermissionGrantRequest, db: SessionDep, op=Depends(_require_reports_menu)):
    """레포트 권한 부여 (주체=user/role/dept/group, 권한=VIEW/DOWNLOAD/REFRESH/MANAGE_REPORT)."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    existing = await db.scalar(
        select(ReportPermission).where(
            ReportPermission.report_id == report_id,
            ReportPermission.subject_type == body.subject_type,
            ReportPermission.subject_id == body.subject_id,
            ReportPermission.permission == body.permission,
        )
    )
    if existing is not None:
        raise ConflictError("이미 부여된 권한입니다.")

    perm = ReportPermission(
        report_id=report_id, subject_type=body.subject_type,
        subject_id=body.subject_id, permission=body.permission,
    )
    db.add(perm)
    await db.flush()
    await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"target": "grant", "subject_type": body.subject_type,
                             "subject_id": body.subject_id, "permission": body.permission})
    await db.commit()
    return PermissionResponse(
        id=perm.id, report_id=perm.report_id, subject_type=perm.subject_type,
        subject_id=perm.subject_id, permission=perm.permission,
    )

@router.delete("/api/reports/{report_id}/permissions/{permission_id}", status_code=204)
async def revoke_permission(report_id: int, permission_id: int, db: SessionDep, op=Depends(_require_reports_menu)):
    """레포트 권한 회수."""
    await db.execute(
        delete(ReportPermission).where(
            ReportPermission.id == permission_id,
            ReportPermission.report_id == report_id,
        )
    )
    await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"target": "revoke"})
    await db.commit()
