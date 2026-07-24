"""사용자 관리 라우트 — /api/users (System_Operator 전용)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from sqlalchemy import text, bindparam

from app.core.constants import AuditAction, RoleCode
from app.core.deps import SessionDep, RedisDep, require_menu
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.auth import User, Role, UserRole, Department
from app.models.portal import UserGroup, UserGroupMember
from app.schemas.user import (
    LocalUserCreate, LocalUserPasswordReset, LocalUserUpdate,
    UserGroupBrief, UserListItem, UserStatusUpdate,
)
from app.services.audit_service import append_audit
from app.services.auth import local_user_auth, session_service

router = APIRouter(prefix="/api/users", tags=["users"])

_require_operator = require_menu("admin_users")

async def _roles_for(db, user_id: int) -> list[str]:
    rows = await db.execute(
        select(Role.code).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id)
    )
    return [r[0] for r in rows.all()]

@router.get("", response_model=list[UserListItem])
async def list_users(db: SessionDep, _operator=Depends(_require_operator)):
    """전체 사용자 목록 (식별자/이름/부서명/메일/역할/권한 그룹/활성).

    역할·그룹·부서명을 사용자별 개별 조회(N+1) 대신 일괄 조회한다.
    """
    users = (await db.execute(select(User).order_by(User.id))).scalars().all()
    if not users:
        return []
    user_ids = [u.id for u in users]

    # 역할 일괄
    roles_by_user: dict[int, list[str]] = {}
    for uid, code in (await db.execute(
        select(UserRole.user_id, Role.code)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id.in_(user_ids))
    )).all():
        roles_by_user.setdefault(uid, []).append(code)

    # 권한 그룹 일괄
    groups_by_user: dict[int, list[UserGroupBrief]] = {}
    for uid, gid, gname in (await db.execute(
        select(UserGroupMember.user_id, UserGroup.id, UserGroup.name)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .where(UserGroupMember.user_id.in_(user_ids))
        .order_by(UserGroup.name)
    )).all():
        groups_by_user.setdefault(uid, []).append(UserGroupBrief(id=gid, name=gname))

    # 부서명 + 부서코드(external_id = 조직도 dept_id) 일괄
    dept_ids = {u.department_id for u in users if u.department_id is not None}
    dept_meta: dict[int, tuple[str | None, str | None]] = {}
    if dept_ids:
        for d_id, d_name, d_ext in (await db.execute(
            select(Department.id, Department.name, Department.external_id)
            .where(Department.id.in_(dept_ids))
        )).all():
            dept_meta[d_id] = (d_name, d_ext)

    # 부서 한글명: 인사 뷰(scl_v_insa_dept_add_depth)에서 dept_id로 조회.
    # (BIP departments.name이 코드로 남아있는 경우 대비, 인사명 없으면 BIP 저장명 폴백)
    ext_ids = [ext for (_n, ext) in dept_meta.values() if ext]
    hr_names: dict[str, str] = {}
    if ext_ids:
        stmt = text(
            "SELECT dept_id, dept_name FROM public.scl_v_insa_dept_add_depth "
            "WHERE dept_id IN :ids"
        ).bindparams(bindparam("ids", expanding=True))
        for d_id, d_name in (await db.execute(stmt, {"ids": ext_ids})).all():
            hr_names[d_id] = d_name

    def _dept(dep_id: int | None) -> tuple[str | None, str | None]:
        if not dep_id:
            return (None, None)
        bip_name, ext = dept_meta.get(dep_id, (None, None))
        name = (hr_names.get(ext) if ext else None) or bip_name
        return (name, ext)

    return [
        UserListItem(
            id=u.id, emp_no=u.external_id, name=u.name, email=u.email,
            department_id=u.department_id,
            department_ext_id=_dept(u.department_id)[1],
            department_name=_dept(u.department_id)[0],
            roles=roles_by_user.get(u.id, []),
            groups=groups_by_user.get(u.id, []),
            is_active=u.is_active,
            is_local=u.is_local,
        )
        for u in users
    ]

@router.patch("/{user_id}/status", response_model=UserListItem)
async def update_status(
    user_id: int,
    body: UserStatusUpdate,
    db: SessionDep,
    redis: RedisDep,
    operator=Depends(_require_operator),
):
    """사용자 활성/비활성 전환. 비활성화 시 모든 세션 즉시 무효화(R4.3)."""
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    user.is_active = body.is_active
    await db.flush()

    # 비활성화 시 해당 사용자의 모든 활성 세션 즉시 삭제
    if not body.is_active:
        await session_service.destroy_user_sessions(redis, user_id)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=operator["user_id"], actor_label=operator["emp_no"],
        resource_type="user", resource_id=str(user_id),
        meta={"target": "user_status", "after": "active" if body.is_active else "inactive"},
    )
    await db.commit()

    return UserListItem(
        id=user.id, emp_no=user.external_id, name=user.name, email=user.email,
        department_id=user.department_id, roles=await _roles_for(db, user.id),
        is_active=user.is_active, is_local=user.is_local,
    )


# 사용자 권한 그룹 단일 설정과 역할 레벨 설정은 org.py의
# PUT /api/org/members/{emp_no}/role-level, POST/DELETE .../groups 로 제공한다
# (사번 기준, 미등록자 자동 등록 지원). 이 파일에는 동일 기능을 중복 정의하지 않는다.


# ===== 로컬 사용자 (그룹웨어 미연동 계정) =====

_ALLOWED_LOCAL_ROLE_CODES = {RoleCode.GENERAL_USER.value, RoleCode.SYSTEM_OPERATOR.value}


def _to_list_item(user: User, roles: list[str]) -> UserListItem:
    return UserListItem(
        id=user.id, emp_no=user.external_id, name=user.name, email=user.email,
        department_id=user.department_id, roles=roles,
        is_active=user.is_active, is_local=user.is_local,
    )


@router.post("/local", response_model=UserListItem, status_code=201)
async def create_local_user(
    body: LocalUserCreate,
    db: SessionDep,
    operator=Depends(_require_operator),
):
    """관리자가 그룹웨어 미연동 로컬 계정을 생성한다(테스트/외부 인력용).

    - login_id는 자유 문자열이며 users.external_id에 저장한다. HR 사번과 중복되지 않아야 한다.
    - 부서는 항상 NULL(로컬 계정은 조직도에 소속되지 않는다).
    - 초기 역할은 General_User 기본, System_Operator 가능. 이후 그룹/레포트 권한은
      기존 관리 화면(권한 관리 > 그룹/개인별)에서 부여한다.
    """
    if body.role_code not in _ALLOWED_LOCAL_ROLE_CODES:
        raise ValidationError("허용되지 않는 역할 코드입니다.")

    login_id = body.login_id.strip()
    if not login_id:
        raise ValidationError("로그인 아이디는 비워둘 수 없습니다.")

    duplicate = await db.scalar(select(User).where(User.external_id == login_id))
    if duplicate is not None:
        raise ConflictError("이미 사용 중인 아이디입니다. 다른 값을 입력하세요.")

    user = User(
        external_id=login_id, name=body.name.strip(),
        email=(body.email or "").strip() or None,
        department_id=None, is_active=True, is_local=True,
        password_hash=local_user_auth.hash_password(body.password),
    )
    db.add(user)
    await db.flush()

    role = await db.scalar(select(Role).where(Role.code == body.role_code))
    if role is None:
        raise NotFoundError("역할을 찾을 수 없습니다.")
    db.add(UserRole(user_id=user.id, role_id=role.id))

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=operator["user_id"], actor_label=operator["emp_no"],
        resource_type="local_user", resource_id=str(user.id),
        meta={"target": "local_user_create", "login_id": login_id, "role": body.role_code},
    )
    await db.commit()
    return _to_list_item(user, [body.role_code])


@router.patch("/local/{user_id}", response_model=UserListItem)
async def update_local_user(
    user_id: int,
    body: LocalUserUpdate,
    db: SessionDep,
    operator=Depends(_require_operator),
):
    """로컬 사용자 이름·이메일 수정. HR 매핑 사용자는 403(인사 뷰가 소스)."""
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")
    if not user.is_local:
        raise ValidationError("로컬 계정만 여기에서 수정할 수 있습니다.")

    changed: dict[str, str | None] = {}
    if body.name is not None and body.name.strip() and body.name.strip() != user.name:
        user.name = body.name.strip()
        changed["name"] = user.name
    if body.email is not None:
        cleaned = body.email.strip() or None
        if cleaned != user.email:
            user.email = cleaned
            changed["email"] = cleaned

    if changed:
        await db.flush()
        await append_audit(
            db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
            actor_user_id=operator["user_id"], actor_label=operator["emp_no"],
            resource_type="local_user", resource_id=str(user_id),
            meta={"target": "local_user_update", **changed},
        )
    await db.commit()
    return _to_list_item(user, await _roles_for(db, user.id))


@router.post("/local/{user_id}/password", status_code=204)
async def reset_local_user_password(
    user_id: int,
    body: LocalUserPasswordReset,
    db: SessionDep,
    redis: RedisDep,
    operator=Depends(_require_operator),
):
    """로컬 사용자 비밀번호를 새 값으로 교체한다.

    보안상 재설정 즉시 해당 사용자의 모든 세션을 무효화한다(다음 접속 시 재로그인 강제).
    """
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")
    if not user.is_local:
        raise ValidationError("로컬 계정만 비밀번호를 재설정할 수 있습니다.")

    user.password_hash = local_user_auth.hash_password(body.password)
    await db.flush()
    # 잠금 초기화 + 세션 무효화
    await session_service.destroy_user_sessions(redis, user_id)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=operator["user_id"], actor_label=operator["emp_no"],
        resource_type="local_user", resource_id=str(user_id),
        meta={"target": "local_user_password_reset"},
    )
    await db.commit()


@router.delete("/local/{user_id}", status_code=204)
async def delete_local_user(
    user_id: int,
    db: SessionDep,
    redis: RedisDep,
    operator=Depends(_require_operator),
):
    """로컬 사용자 삭제. 그룹 멤버십·역할·부여 권한도 함께 정리한다.

    HR 매핑 사용자는 인사 뷰가 소스라 여기서 삭제할 수 없다(비활성화만 허용).
    """
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")
    if not user.is_local:
        raise ValidationError("로컬 계정만 삭제할 수 있습니다. 그룹웨어 사용자는 비활성화로 처리하세요.")

    login_id = user.external_id
    # 참조 정리: 역할, 그룹 멤버십(다형 FK가 없는 menu_permissions/report_permissions는 그대로 두고,
    # 조회 시점에 사용자 존재 검증). ReportFavorite/UserReportActivity는 cascade 설정됨.
    await db.execute(text("DELETE FROM bip.user_roles WHERE user_id = :uid"), {"uid": user_id})
    await db.execute(text("DELETE FROM bip.user_group_members WHERE user_id = :uid"), {"uid": user_id})
    await db.execute(text(
        "DELETE FROM bip.menu_permissions WHERE subject_type = 'user' AND subject_id = :uid"
    ), {"uid": user_id})
    await db.execute(text(
        "DELETE FROM bip.report_permissions WHERE subject_type = 'user' AND subject_id = :uid"
    ), {"uid": user_id})
    await db.delete(user)
    await session_service.destroy_user_sessions(redis, user_id)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=operator["user_id"], actor_label=operator["emp_no"],
        resource_type="local_user", resource_id=str(user_id),
        meta={"target": "local_user_delete", "login_id": login_id},
    )
    await db.commit()
