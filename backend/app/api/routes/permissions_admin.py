"""권한 관리 라우트 — /api/permission-admin (System_Operator 전용).

관리자 콘솔의 "권한 관리" 섹션이 사용한다.
- 그룹 관리: 그룹별 메뉴 접근 권한과 명시적 레포트 다중 권한 부여.
- 메뉴 관리: 메뉴별로 접근 가능한 주체(그룹/개별 사용자) 조회.

기존 레포트 관리 화면의 레포트별 권한 패널(roles.py의 bulk 엔드포인트)은
그대로 병행 운영한다(확인사항 4) — 이 라우트는 "주체 먼저 선택" 흐름을 추가한다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select, delete, text, and_, or_

from app.core.constants import (
    AuditAction, GRANTABLE_MENU_KEYS, MENU_CATALOG, PermissionAction, ROLE_MENUS,
    RoleCode,
)
from app.core.deps import SessionDep, require_menu
from app.core.errors import NotFoundError, ValidationError
from app.models.auth import Department, Role, User, UserRole
from app.models.portal import UserGroup, UserGroupMember, MenuPermission
from app.models.report import Report, ReportFolder, ReportPermission
from app.services import permission_service
from app.schemas.permission_admin import (
    MenuPermissionSetRequest, MenuPermissionItem, MenuSubjectItem,
    GroupReportBulkGrantRequest, GroupReportPermissionLookupRequest,
    GroupReportPermissionItem, GroupReportPermissionSetRequest,
    GroupReportPermissionSetResult, UserReportPermissionSetRequest,
    UserReportPermissionSetResult, MENU_SUBJECT_TYPES,
    UserGroupBrief, InheritedMenuItem, DirectReportPermission,
    InheritedReportPermission, UserEffectivePermissions,
)
from app.services.audit_service import append_audit

_MENU_LABELS = dict(MENU_CATALOG)

router = APIRouter(prefix="/api/permission-admin", tags=["permission-admin"])

_require_operator = require_menu("admin_groups")

# 개별 부여/조회 대상 메뉴 = 통계, KPI 전광판(재생). 관리자/운영 메뉴는 System_Operator
# 전용이라 부여 자체를 허용하지 않는다(require_menu에서도 개별 부여로는 통과되지 않는다).
_VALID_MENU_KEYS = set(GRANTABLE_MENU_KEYS)


def _validate_subject_type(subject_type: str) -> None:
    if subject_type not in MENU_SUBJECT_TYPES:
        raise ValidationError("주체 유형은 user 또는 group만 허용됩니다.")


# ===== 그룹/사용자 메뉴 권한 =====

# by-menu(정적 경로)를 동적 경로 /{subject_type}/{subject_id}보다 먼저 선언한다.
# Starlette는 선언 순서대로 매칭하며 두 경로 모두 두 세그먼트에 FULL 매치되므로,
# 순서가 뒤바뀌면 by-menu 요청이 subject_id=int 변환에 걸려 422가 된다.
@router.get("/menu-permissions/by-menu/{menu_key}", response_model=list[MenuSubjectItem])
async def list_subjects_for_menu(menu_key: str, db: SessionDep, _op=Depends(_require_operator)):
    """메뉴별 접근 가능 주체 조회('메뉴 관리' 탭). 그룹 권한으로 얻은 사용자는 source='group'."""
    if menu_key not in _VALID_MENU_KEYS:
        raise NotFoundError("메뉴를 찾을 수 없습니다.")

    grants = (await db.execute(
        select(MenuPermission.subject_type, MenuPermission.subject_id)
        .where(MenuPermission.menu_key == menu_key)
    )).all()
    user_ids = [sid for stype, sid in grants if stype == "user"]
    group_ids = [sid for stype, sid in grants if stype == "group"]

    items: list[MenuSubjectItem] = []

    if user_ids:
        for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all():
            items.append(MenuSubjectItem(
                subject_type="user", subject_id=u.id, label=f"{u.name}({u.external_id})", source="direct",
            ))

    if group_ids:
        groups = (
            await db.execute(
                select(UserGroup)
                .where(UserGroup.id.in_(group_ids))
                .order_by(UserGroup.name, UserGroup.id)
            )
        ).scalars().all()
        for g in groups:
            items.append(MenuSubjectItem(
                subject_type="group", subject_id=g.id, label=g.name, source="group"
            ))

        # 그룹별 접기/펼치기를 위해 구성원을 그룹-사용자 멤버십 단위로 반환한다.
        # 한 사용자가 여러 권한 그룹에 속하면 각 그룹 아래에 나타나는 것이 의도된 동작이다.
        member_rows = (await db.execute(text(
            """
            SELECT m.group_id, u.id, u.name, u.external_id
            FROM bip.user_group_members m
            JOIN bip.users u ON u.id = m.user_id
            WHERE m.group_id = ANY(:gids)
            ORDER BY m.group_id, u.name, u.external_id, u.id
            """
        ), {"gids": group_ids})).all()
        for group_id, uid, uname, ext_id in member_rows:
            items.append(MenuSubjectItem(
                subject_type="user",
                subject_id=uid,
                label=f"{uname}({ext_id})",
                source="group",
                source_group_id=group_id,
            ))

    return items


@router.get("/menu-permissions/{subject_type}/{subject_id}", response_model=list[str])
async def get_menu_permissions(
    subject_type: str, subject_id: int, db: SessionDep, _op=Depends(_require_operator),
):
    """특정 주체(사용자/그룹)에 개별 부여된 메뉴 키 목록(부여 가능 목록으로 필터)."""
    _validate_subject_type(subject_type)
    rows = (await db.execute(
        select(MenuPermission.menu_key).where(
            MenuPermission.subject_type == subject_type,
            MenuPermission.subject_id == subject_id,
        )
    )).scalars().all()
    return [k for k in rows if k in _VALID_MENU_KEYS]


@router.put("/menu-permissions/{subject_type}/{subject_id}", response_model=list[str])
async def set_menu_permissions(
    subject_type: str, subject_id: int, body: MenuPermissionSetRequest,
    db: SessionDep, op=Depends(_require_operator),
):
    """주체(사용자/그룹)의 메뉴 접근 권한을 전체 교체(멱등). 알 수 없는 메뉴 키는 거부."""
    _validate_subject_type(subject_type)
    if subject_type == "user":
        user_exists = await db.scalar(
            select(User.id).where(User.id == subject_id).with_for_update()
        )
        if user_exists is None:
            raise NotFoundError("사용자를 찾을 수 없습니다.")
    else:
        group_exists = await db.scalar(
            select(UserGroup.id).where(UserGroup.id == subject_id).with_for_update()
        )
        if group_exists is None:
            raise NotFoundError("그룹을 찾을 수 없습니다.")

    unknown = [k for k in body.menu_keys if k not in _VALID_MENU_KEYS]
    if unknown:
        raise ValidationError(f"알 수 없는 메뉴 키입니다: {', '.join(unknown)}")

    await db.execute(delete(MenuPermission).where(
        MenuPermission.subject_type == subject_type,
        MenuPermission.subject_id == subject_id,
    ))
    for key in dict.fromkeys(body.menu_keys):  # 중복 제거, 순서 보존
        db.add(MenuPermission(subject_type=subject_type, subject_id=subject_id, menu_key=key))
    await db.flush()
    await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="menu_permission", resource_id=f"{subject_type}:{subject_id}",
                       meta={"target": "set_menu_permissions", "subject_type": subject_type,
                             "subject_id": subject_id, "menu_keys": body.menu_keys})
    await db.commit()
    return body.menu_keys


# ===== 주체 우선 레포트 다중 권한 부여 =====

@router.post(
    "/report-permissions/groups/{group_id}/lookup",
    response_model=list[GroupReportPermissionItem],
)
async def list_group_report_permissions(
    group_id: int, body: GroupReportPermissionLookupRequest,
    db: SessionDep, _op=Depends(_require_operator),
):
    """선택한 레포트에 그룹으로 직접 부여된 권한을 한 번에 조회한다."""
    rows = (await db.execute(
        select(ReportPermission.report_id, ReportPermission.permission)
        .where(
            ReportPermission.report_id.in_(body.report_ids),
            ReportPermission.subject_type == "group",
            ReportPermission.subject_id == group_id,
        )
        .order_by(ReportPermission.report_id, ReportPermission.permission)
    )).all()
    return [
        GroupReportPermissionItem(report_id=report_id, permission=permission)
        for report_id, permission in rows
    ]


@router.put(
    "/report-permissions/groups/{group_id}",
    response_model=GroupReportPermissionSetResult,
)
async def set_group_report_permissions(
    group_id: int, body: GroupReportPermissionSetRequest,
    db: SessionDep, op=Depends(_require_operator),
):
    """선택한 레포트의 직접 그룹 권한을 요청한 권한 세트로 교체한다."""
    # 같은 그룹에 대한 동시 설정 요청은 그룹 행 잠금으로 직렬화한다.
    group_exists = await db.scalar(
        select(UserGroup.id).where(UserGroup.id == group_id).with_for_update()
    )
    if group_exists is None:
        raise NotFoundError("그룹을 찾을 수 없습니다.")

    report_ids = list(dict.fromkeys(body.report_ids))
    existing_report_ids = (await db.execute(
        select(Report.id).where(Report.id.in_(report_ids))
    )).scalars().all()
    missing = set(report_ids) - set(existing_report_ids)
    if missing:
        raise NotFoundError(f"존재하지 않는 레포트입니다: {sorted(missing)}")

    # VIEW가 필요한 액션은 VIEW를 자동 포함해, 교체 후에도 접근 불가능한
    # 다운로드/관리 권한만 남는 모순을 방지한다.
    desired_codes = permission_service.normalize_grant_codes(body.permissions)
    existing_pairs = set((await db.execute(
        select(ReportPermission.report_id, ReportPermission.permission).where(
            ReportPermission.report_id.in_(report_ids),
            ReportPermission.subject_type == "group",
            ReportPermission.subject_id == group_id,
        )
    )).all())

    removed_result = await db.execute(
        delete(ReportPermission).where(
            ReportPermission.report_id.in_(report_ids),
            ReportPermission.subject_type == "group",
            ReportPermission.subject_id == group_id,
            ~ReportPermission.permission.in_(desired_codes),
        )
    )
    removed = removed_result.rowcount or 0

    added = 0
    for report_id in report_ids:
        for code in desired_codes:
            if (report_id, code) in existing_pairs:
                continue
            db.add(ReportPermission(
                report_id=report_id, subject_type="group",
                subject_id=group_id, permission=code,
            ))
            added += 1

    if added or removed:
        await db.flush()
        await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                           actor_user_id=op["user_id"], actor_label=op["emp_no"],
                           resource_type="report_permission_bulk", resource_id=f"group:{group_id}",
                           meta={"target": "set_group_report_permissions", "group_id": group_id,
                                 "report_ids": report_ids, "permissions": desired_codes,
                                 "added": added, "removed": removed})
    await db.commit()
    return GroupReportPermissionSetResult(
        added=added, removed=removed, permissions=desired_codes,
    )


@router.put(
    "/report-permissions/users/{user_id}",
    response_model=UserReportPermissionSetResult,
)
async def set_user_report_permissions(
    user_id: int, body: UserReportPermissionSetRequest,
    db: SessionDep, op=Depends(_require_operator),
):
    """선택한 레포트의 직접 사용자 권한을 요청한 권한 세트로 교체한다."""
    # 같은 사용자에 대한 동시 설정 요청은 사용자 행 잠금으로 직렬화한다.
    user_exists = await db.scalar(
        select(User.id).where(User.id == user_id).with_for_update()
    )
    if user_exists is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    report_ids = list(dict.fromkeys(body.report_ids))
    existing_report_ids = (await db.execute(
        select(Report.id).where(Report.id.in_(report_ids))
    )).scalars().all()
    missing = set(report_ids) - set(existing_report_ids)
    if missing:
        raise NotFoundError(f"존재하지 않는 레포트입니다: {sorted(missing)}")

    # VIEW가 필요한 액션은 VIEW를 자동 포함해, 교체 후에도 접근 불가능한
    # 다운로드/관리 권한만 남는 모순을 방지한다.
    desired_codes = permission_service.normalize_grant_codes(body.permissions)
    existing_pairs = set((await db.execute(
        select(ReportPermission.report_id, ReportPermission.permission).where(
            ReportPermission.report_id.in_(report_ids),
            ReportPermission.subject_type == "user",
            ReportPermission.subject_id == user_id,
        )
    )).all())

    removed_result = await db.execute(
        delete(ReportPermission).where(
            ReportPermission.report_id.in_(report_ids),
            ReportPermission.subject_type == "user",
            ReportPermission.subject_id == user_id,
            ~ReportPermission.permission.in_(desired_codes),
        )
    )
    removed = removed_result.rowcount or 0

    added = 0
    for report_id in report_ids:
        for code in desired_codes:
            if (report_id, code) in existing_pairs:
                continue
            db.add(ReportPermission(
                report_id=report_id, subject_type="user",
                subject_id=user_id, permission=code,
            ))
            added += 1

    if added or removed:
        await db.flush()
        await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                           actor_user_id=op["user_id"], actor_label=op["emp_no"],
                           resource_type="report_permission_bulk", resource_id=f"user:{user_id}",
                           meta={"target": "set_user_report_permissions", "user_id": user_id,
                                 "report_ids": report_ids, "permissions": desired_codes,
                                 "added": added, "removed": removed})
    await db.commit()
    return UserReportPermissionSetResult(
        added=added, removed=removed, permissions=desired_codes,
    )


@router.post("/report-permissions/bulk-grant", response_model=int)
async def bulk_grant_report_permissions(
    body: GroupReportBulkGrantRequest, db: SessionDep, op=Depends(_require_operator),
):
    """한 주체(그룹/사용자)에게 여러 레포트에 동일 권한 세트를 한 번에 부여(멱등).

    '주체를 먼저 고르고 레포트를 다중 선택' 흐름 — 레포트 관리 화면에서 레포트를
    하나씩 열어 권한을 주던 기존 방식의 번거로움을 줄인다. 반환값은 신규 생성된
    권한 행 수(이미 있던 조합은 건너뛴다).
    """
    _validate_subject_type(body.subject_type)
    if body.subject_type == "group":
        # 그룹 권한 교체 API와 같은 행을 잠가, 두 그룹 변경 요청이 서로 덮어쓰지 않게 한다.
        group_exists = await db.scalar(
            select(UserGroup.id).where(UserGroup.id == body.subject_id).with_for_update()
        )
        if group_exists is None:
            raise NotFoundError("그룹을 찾을 수 없습니다.")
    else:
        # 사용자 권한 교체 API와 같은 행을 잠가, 두 사용자 변경 요청이 서로 덮어쓰지 않게 한다.
        user_exists = await db.scalar(
            select(User.id).where(User.id == body.subject_id).with_for_update()
        )
        if user_exists is None:
            raise NotFoundError("사용자를 찾을 수 없습니다.")

    existing_reports = (await db.execute(
        select(Report.id).where(Report.id.in_(body.report_ids))
    )).scalars().all()
    missing = set(body.report_ids) - set(existing_reports)
    if missing:
        raise NotFoundError(f"존재하지 않는 레포트입니다: {sorted(missing)}")

    existing_perms = set((await db.execute(
        select(ReportPermission.report_id, ReportPermission.permission).where(
            ReportPermission.report_id.in_(body.report_ids),
            ReportPermission.subject_type == body.subject_type,
            ReportPermission.subject_id == body.subject_id,
        )
    )).all())

    # 다운로드/새로고침/관리 권한만 부여되어 목록에 보이지도 않는 상태를 막기 위해
    # 조회(VIEW)를 자동 포함한다.
    grant_codes = permission_service.normalize_grant_codes(body.permissions)

    added = 0
    for report_id in body.report_ids:
        for code in grant_codes:
            if (report_id, code) in existing_perms:
                continue
            db.add(ReportPermission(
                report_id=report_id, subject_type=body.subject_type,
                subject_id=body.subject_id, permission=code,
            ))
            added += 1

    if added:
        await db.flush()
        await append_audit(db, action=AuditAction.PERMISSION_CHANGE, result="success",
                           actor_user_id=op["user_id"], actor_label=op["emp_no"],
                           resource_type="report_permission_bulk",
                           resource_id=f"{body.subject_type}:{body.subject_id}",
                           meta={"target": "bulk_grant", "subject_type": body.subject_type,
                                 "subject_id": body.subject_id, "report_ids": body.report_ids,
                                 "permissions": grant_codes, "added": added})
    await db.commit()
    return added


# ===== 개인별(사용자) 유효 권한 조회 =====

@router.get("/users/{user_id}/effective-permissions", response_model=UserEffectivePermissions)
async def get_user_effective_permissions(
    user_id: int, db: SessionDep, _op=Depends(_require_operator),
):
    """한 사용자가 실제로 보유한 권한을 직접/상속(그룹·역할·부서)으로 구분해 총람.

    - 직접 레포트 권한만 회수 가능(permission_id 포함). 상속 권한은 읽기 전용이며
      출처(그룹/역할/부서)를 함께 반환한다.
    - System_Operator는 전체 접근이므로 is_operator=True만 반환(레포트 나열 생략).
    """
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise NotFoundError("사용자를 찾을 수 없습니다.")

    dept_name = None
    if user.department_id is not None:
        dept_name = await db.scalar(
            select(Department.name).where(Department.id == user.department_id)
        )

    role_pairs = (await db.execute(
        select(Role.id, Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
    )).all()
    role_ids = [rid for rid, _ in role_pairs]
    role_codes = [code for _, code in role_pairs]
    role_code_by_id = {rid: code for rid, code in role_pairs}
    is_operator = RoleCode.SYSTEM_OPERATOR.value in role_codes

    group_rows = (await db.execute(
        select(UserGroup.id, UserGroup.name)
        .join(UserGroupMember, UserGroupMember.group_id == UserGroup.id)
        .where(UserGroupMember.user_id == user_id)
        .order_by(UserGroup.name)
    )).all()
    groups = [UserGroupBrief(id=gid, name=gname) for gid, gname in group_rows]
    group_ids = [g.id for g in groups]
    group_name_by_id = {g.id: g.name for g in groups}

    result = UserEffectivePermissions(
        user_id=user.id, emp_no=user.external_id, name=user.name,
        department_name=dept_name, is_operator=is_operator,
        roles=role_codes, groups=groups,
    )
    if is_operator:
        # 운영자는 전체 메뉴/레포트 접근 — 상세 나열 없이 배지로만 표시
        return result

    # ===== 메뉴 접근 =====
    result.direct_menu_keys = [
        k for k in (await db.execute(
            select(MenuPermission.menu_key).where(
                MenuPermission.subject_type == "user", MenuPermission.subject_id == user_id)
        )).scalars().all()
        if k in _VALID_MENU_KEYS
    ]

    inherited_menus: dict[tuple[str, str, str], InheritedMenuItem] = {}
    for code in role_codes:
        for key in ROLE_MENUS.get(code, []):
            inherited_menus.setdefault((key, "role", code), InheritedMenuItem(
                menu_key=key, label=_MENU_LABELS.get(key, key), source_type="role", source_label=code))
    if group_ids:
        for key, gid in (await db.execute(
            select(MenuPermission.menu_key, MenuPermission.subject_id).where(
                MenuPermission.subject_type == "group", MenuPermission.subject_id.in_(group_ids))
        )).all():
            if key not in _VALID_MENU_KEYS:
                continue  # 정책 변경 이전에 저장된 운영자 전용 메뉴 행은 무효
            gname = group_name_by_id.get(gid, f"group#{gid}")
            inherited_menus.setdefault((key, "group", gname), InheritedMenuItem(
                menu_key=key, label=_MENU_LABELS.get(key, key), source_type="group", source_label=gname))
    result.inherited_menus = list(inherited_menus.values())

    # ===== 레포트 권한 (직접 + 상속) =====
    conds = [and_(ReportPermission.subject_type == "user", ReportPermission.subject_id == user_id)]
    if group_ids:
        conds.append(and_(ReportPermission.subject_type == "group", ReportPermission.subject_id.in_(group_ids)))
    if role_ids:
        conds.append(and_(ReportPermission.subject_type == "role", ReportPermission.subject_id.in_(role_ids)))
    if user.department_id is not None:
        conds.append(and_(ReportPermission.subject_type == "dept", ReportPermission.subject_id == user.department_id))

    perm_rows = (await db.execute(
        select(
            ReportPermission.id, ReportPermission.report_id, ReportPermission.permission,
            ReportPermission.subject_type, ReportPermission.subject_id,
        ).where(or_(*conds))
    )).all()

    report_ids = {row[1] for row in perm_rows}
    report_meta: dict[int, tuple[str, str | None]] = {}
    if report_ids:
        for rid, rname, dname, fname in (await db.execute(
            select(Report.id, Report.report_name, Report.display_name, ReportFolder.name)
            .outerjoin(ReportFolder, ReportFolder.id == Report.folder_id)
            .where(Report.id.in_(report_ids))
        )).all():
            report_meta[rid] = (dname or rname or "(이름 없음)", fname)

    direct_reports: list[DirectReportPermission] = []
    inherited_reports: list[InheritedReportPermission] = []
    for perm_id, rep_id, permission, stype, sid in perm_rows:
        name, folder = report_meta.get(rep_id, ("(이름 없음)", None))
        if stype == "user":
            direct_reports.append(DirectReportPermission(
                permission_id=perm_id, report_id=rep_id, report_name=name,
                folder_name=folder, permission=permission))
            continue
        if stype == "group":
            label = group_name_by_id.get(sid, f"group#{sid}")
        elif stype == "role":
            label = role_code_by_id.get(sid, f"role#{sid}")
        elif stype == "dept":
            label = dept_name or f"dept#{sid}"
        else:
            label = f"{stype}#{sid}"
        inherited_reports.append(InheritedReportPermission(
            report_id=rep_id, report_name=name, folder_name=folder,
            permission=permission, source_type=stype, source_label=label))

    # 레포트명 → 권한 순으로 정렬해 화면에서 읽기 쉽게
    direct_reports.sort(key=lambda x: (x.report_name, x.permission))
    inherited_reports.sort(key=lambda x: (x.report_name, x.permission))
    result.direct_reports = direct_reports
    result.inherited_reports = inherited_reports
    return result
