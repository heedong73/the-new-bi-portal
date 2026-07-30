"""레포트 카탈로그 라우트 — /api/reports.

등록/수정/공개/이동은 System_Operator, 목록(GET)은 로그인 사용자(G+).
등록 시 workspace auto-upsert. 목록은 VIEW 권한 AND 공개 필터(Property 2).
"""
from __future__ import annotations

import os
import uuid
import json

from fastapi import APIRouter, Depends, Query, UploadFile, File, Form
from celery.result import AsyncResult
from sqlalchemy import select, func, delete, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.constants import AuditAction, RoleCode, PermissionAction, SubjectType
from app.core.deps import SessionDep, require_menu, require_report_permission, get_current_user, PowerBIClientDep, RedisDep
from app.core.errors import NotFoundError, ConflictError, ValidationError, PermissionDeniedError
from app.models.report import (
    FavoriteFolder, Report, Workspace, ReportFavorite, ReportPermission,
    UserReportActivity, ReportViewDailyStat,
)
from app.models.mail import MailSchedule
from app.models.log import AuditLog
from app.workers.celery_app import celery_app
from app.workers.tasks.pbix_import import pbix_import as pbix_import_task
from app.schemas.report import (
    FavoriteFolderMoveRequest, FavoriteFolderNameRequest,
    FavoriteFolderReorderRequest, FavoriteFolderResponse,
    ReportUpdate, VisibilityUpdate, FolderMoveRequest, ReportResponse, DefaultViewUpdate,
    ReportCatalogResponse, ReportViewDurationUpdate, ReportViewSessionCreate,
    ReportViewSessionResponse,
)
from app.services.powerbi.client import ReportPageDTO
from app.services.audit_service import append_audit, build_audit_snapshot
from app.services import permission_service, report_discovery_service
from app.services.refresh_query import get_schedule_info

router = APIRouter(prefix="/api/reports", tags=["reports"])

_require_operator = require_menu("admin_reports")

# 라이브 새로고침 상태 캐시 TTL(초). 동시 뷰어의 upstream REST 호출을 합쳐 throttling을 줄인다.
LIVE_STATUS_CACHE_TTL = 20

def _creator_label(op: dict) -> str | None:
    """생성자 라벨 '이름(사번)' 포맷. 이름 없으면 사번만."""
    name = op.get("name")
    emp = op.get("emp_no")
    if name and emp:
        return f"{name}({emp})"
    return name or emp


def _audit_actor_user_id(current: dict) -> int | None:
    """로컬 관리자는 users와 PK 공간이 다르므로 감사 actor FK처럼 취급하지 않는다."""
    return None if current.get("is_local_admin") else current.get("user_id")


async def _append_report_audit(
    db: SessionDep,
    *,
    action: str,
    result: str,
    current: dict,
    report: Report,
    event_key: str | None = None,
    duration_seconds: int | None = None,
    meta: dict | None = None,
) -> int:
    """레포트 이벤트를 사용자·조직·레포트 스냅샷과 함께 기록한다."""
    actor_user_id = _audit_actor_user_id(current)
    snapshot = await build_audit_snapshot(
        db,
        actor_user_id=actor_user_id,
        report=report,
    )
    return await append_audit(
        db,
        action=action,
        result=result,
        actor_user_id=actor_user_id,
        actor_label=current.get("emp_no"),
        resource_type="report",
        resource_id=str(report.id),
        event_key=event_key,
        duration_seconds=duration_seconds,
        meta=meta,
        **snapshot,
    )


def _to_response(
    r: Report,
    *,
    folder_path: str | None = None,
    root_folder_id: int | None = None,
    root_folder_name: str | None = None,
    last_viewed_at=None,
    view_count: int = 0,
) -> ReportResponse:
    return ReportResponse(
        id=r.id, workspace_id=r.workspace_id, report_id=r.report_id,
        dataset_id=r.dataset_id, report_name=r.report_name, display_name=r.display_name,
        description=r.description, category=r.category, folder_id=r.folder_id,
        is_published=r.is_published, published_at=r.published_at, sort_order=r.sort_order,
        author_label=r.author_label, updated_at=r.updated_at,
        folder_path=folder_path, root_folder_id=root_folder_id,
        root_folder_name=root_folder_name, last_viewed_at=last_viewed_at,
        view_count=view_count,
        created_by_user_id=r.created_by_user_id, created_by_label=r.created_by_label,
        created_at=r.created_at,
    )


# 응답 플래그 → 필요한 레포트 권한. 프런트는 이 플래그로 버튼 노출을 결정하고,
# 실제 통제는 각 엔드포인트에서 동일 권한으로 다시 검증한다.
_PERMISSION_FLAGS: dict[str, str] = {
    "can_manage": PermissionAction.MANAGE_REPORT,
    "can_download": PermissionAction.DOWNLOAD,
    "can_download_pbix": PermissionAction.DOWNLOAD_PBIX,
    "can_manage_default_view": PermissionAction.MANAGE_DEFAULT_VIEW,
    "can_refresh": PermissionAction.REFRESH,
}


async def _permission_flag_ids(db: SessionDep, current: dict) -> dict[str, set[int]]:
    """플래그별로 해당 권한을 가진 report id 집합을 모아 반환한다."""
    return {
        flag: await permission_service.accessible_report_ids(
            db, current["user_id"], action, roles=current.get("roles")
        )
        for flag, action in _PERMISSION_FLAGS.items()
    }


def _apply_permission_flags(
    response: ReportResponse, report_id: int, flag_ids: dict[str, set[int]]
) -> ReportResponse:
    """조회 권한 외 액션 플래그(can_*)를 응답에 채운다."""
    for flag, ids in flag_ids.items():
        setattr(response, flag, report_id in ids)
    return response


def _discovery_response(
    item,
    *,
    flag_ids: dict[str, set[int]],
    favorite_ids: set[int],
) -> ReportResponse:
    response = _to_response(
        item.report,
        folder_path=item.folder_path,
        root_folder_id=item.root_folder_id,
        root_folder_name=item.root_folder_name,
        last_viewed_at=item.last_viewed_at,
        view_count=item.view_count,
    )
    _apply_permission_flags(response, item.report.id, flag_ids)
    response.is_favorite = item.report.id in favorite_ids
    return response

async def _upsert_workspace(db: SessionDep, workspace_id: str) -> None:
    """workspace_id가 workspaces에 없으면 생성 (auto-upsert)."""
    ws = await db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id))
    if ws is None:
        db.add(Workspace(workspace_id=workspace_id, workspace_name=workspace_id))
        await db.flush()

@router.get("", response_model=list[ReportResponse])
async def list_reports(
    db: SessionDep,
    current=Depends(get_current_user),
    folder_id: int | None = Query(default=None),
):
    """VIEW 권한 보유 레포트 목록 (folder_id 필터 옵션).

    가시성은 권한(VIEW) 기반이다. 등록 후 권한을 부여해야 노출된다.
    """
    accessible = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW, roles=current.get("roles")
    )
    flag_ids = await _permission_flag_ids(db, current)
    personalization_user_id = _discovery_user_id(current)
    fav_ids = {
        rid for (rid,) in (await db.execute(
            select(ReportFavorite.report_id).where(
                ReportFavorite.user_id == personalization_user_id
            )
        )).all()
    }
    stmt = select(Report)
    if folder_id is not None:
        stmt = stmt.where(Report.folder_id == folder_id)
    reports = (await db.execute(stmt.order_by(Report.sort_order, Report.id))).scalars().all()
    result = []
    for r in reports:
        if r.id in accessible:
            resp = _apply_permission_flags(_to_response(r), r.id, flag_ids)
            resp.is_favorite = r.id in fav_ids
            result.append(resp)
    return result


def _discovery_user_id(current: dict) -> int:
    """일반 사용자와 PK 공간이 다른 로컬 관리자를 고유한 음수 ID로 분리한다."""
    user_id = int(current["user_id"])
    return -user_id if current.get("is_local_admin") else user_id


_FAVORITE_FOLDER_RESERVED_NAMES = {"전체", "미분류"}
_MAX_FAVORITE_FOLDERS = 100


def _normalize_favorite_folder_name(value: str) -> tuple[str, str]:
    """표시 이름은 trim하고 사용자별 중복 비교용 이름은 casefold한다."""
    name = value.strip()
    if not name:
        raise ValidationError("폴더 이름을 입력해 주세요.")
    normalized_name = name.casefold()
    if normalized_name in _FAVORITE_FOLDER_RESERVED_NAMES:
        raise ValidationError(f"'{name}'은(는) 사용할 수 없는 폴더 이름입니다.")
    if len(normalized_name) > 80:
        raise ValidationError("폴더 이름은 80자 이하여야 합니다.")
    return name, normalized_name


def _favorite_folder_response(folder: FavoriteFolder) -> FavoriteFolderResponse:
    return FavoriteFolderResponse(
        id=folder.id,
        name=folder.name,
        sort_order=folder.sort_order,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


async def _owned_favorite_folder(
    db: SessionDep, user_id: int, folder_id: int
) -> FavoriteFolder:
    folder = await db.scalar(
        select(FavoriteFolder).where(
            FavoriteFolder.id == folder_id,
            FavoriteFolder.user_id == user_id,
        )
    )
    if folder is None:
        raise NotFoundError("즐겨찾기 폴더를 찾을 수 없습니다.")
    return folder


async def _discovery_permissions(db: SessionDep, current: dict):
    accessible_ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW, roles=current.get("roles")
    )
    flag_ids = await _permission_flag_ids(db, current)
    personalization_user_id = _discovery_user_id(current)
    favorite_ids = {
        report_id for (report_id,) in (await db.execute(
            select(ReportFavorite.report_id).where(
                ReportFavorite.user_id == personalization_user_id
            )
        )).all()
    }
    return accessible_ids, flag_ids, favorite_ids


@router.get("/catalog", response_model=ReportCatalogResponse)
async def report_catalog(
    db: SessionDep,
    current=Depends(get_current_user),
    q: str | None = Query(default=None, max_length=200),
    root_folder_id: int | None = Query(default=None),
    folder_id: int | None = Query(default=None),
    sort: str = Query(default="latest", pattern="^(latest|popular)$"),
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """VIEW 권한 범위 내 검색·최상위 폴더·최신/최근 30일 인기순 카탈로그."""
    accessible, flag_ids, favorite_ids = await _discovery_permissions(db, current)
    items, total = await report_discovery_service.catalog(
        db,
        user_id=_discovery_user_id(current),
        accessible_ids=accessible,
        root_folder_id=root_folder_id,
        folder_id=folder_id,
        query=q,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return ReportCatalogResponse(
        items=[
            _discovery_response(item, flag_ids=flag_ids, favorite_ids=favorite_ids)
            for item in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/recent", response_model=list[ReportResponse])
async def list_recent_reports(
    db: SessionDep,
    current=Depends(get_current_user),
    limit: int | None = Query(default=None, ge=1, le=100),
):
    """현재 사용자가 최근에 연 레포트를 마지막 조회순으로 반환한다."""
    accessible, flag_ids, favorite_ids = await _discovery_permissions(db, current)
    items = await report_discovery_service.recent(
        db, user_id=_discovery_user_id(current), accessible_ids=accessible, limit=limit
    )
    return [
        _discovery_response(item, flag_ids=flag_ids, favorite_ids=favorite_ids)
        for item in items
    ]


@router.get("/favorite-folders", response_model=list[FavoriteFolderResponse])
async def list_favorite_folders(
    db: SessionDep,
    current=Depends(get_current_user),
):
    """현재 사용자의 개인 즐겨찾기 폴더를 지정 순서로 반환한다."""
    user_id = _discovery_user_id(current)
    folders = (
        await db.execute(
            select(FavoriteFolder)
            .where(FavoriteFolder.user_id == user_id)
            .order_by(FavoriteFolder.sort_order, FavoriteFolder.id)
        )
    ).scalars().all()
    return [_favorite_folder_response(folder) for folder in folders]


@router.post(
    "/favorite-folders",
    response_model=FavoriteFolderResponse,
    status_code=201,
)
async def create_favorite_folder(
    body: FavoriteFolderNameRequest,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """현재 사용자에게 1단계 즐겨찾기 폴더를 생성한다."""
    user_id = _discovery_user_id(current)
    name, normalized_name = _normalize_favorite_folder_name(body.name)
    folder_count = int(await db.scalar(
        select(func.count(FavoriteFolder.id)).where(FavoriteFolder.user_id == user_id)
    ) or 0)
    if folder_count >= _MAX_FAVORITE_FOLDERS:
        raise ValidationError(
            f"즐겨찾기 폴더는 최대 {_MAX_FAVORITE_FOLDERS}개까지 만들 수 있습니다."
        )
    max_sort_order = await db.scalar(
        select(func.max(FavoriteFolder.sort_order)).where(
            FavoriteFolder.user_id == user_id
        )
    )
    folder = FavoriteFolder(
        user_id=user_id,
        name=name,
        normalized_name=normalized_name,
        sort_order=0 if max_sort_order is None else max_sort_order + 1,
    )
    db.add(folder)
    try:
        await db.flush()
        await db.refresh(folder)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("같은 이름의 즐겨찾기 폴더가 이미 있습니다.") from exc
    return _favorite_folder_response(folder)


@router.put("/favorite-folders/reorder", status_code=204)
async def reorder_favorite_folders(
    body: FavoriteFolderReorderRequest,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """현재 사용자의 모든 개인 폴더 순서를 한 번에 변경한다."""
    user_id = _discovery_user_id(current)
    folders = (
        await db.execute(
            select(FavoriteFolder).where(FavoriteFolder.user_id == user_id)
        )
    ).scalars().all()
    current_ids = {folder.id for folder in folders}
    requested_ids = body.folder_ids
    if len(requested_ids) != len(set(requested_ids)) or set(requested_ids) != current_ids:
        raise ValidationError("현재 사용자의 모든 즐겨찾기 폴더를 중복 없이 전달해 주세요.")
    by_id = {folder.id: folder for folder in folders}
    for sort_order, folder_id in enumerate(requested_ids):
        by_id[folder_id].sort_order = sort_order
    await db.commit()


@router.patch(
    "/favorite-folders/{folder_id}",
    response_model=FavoriteFolderResponse,
)
async def rename_favorite_folder(
    folder_id: int,
    body: FavoriteFolderNameRequest,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """현재 사용자가 소유한 개인 폴더의 이름을 변경한다."""
    user_id = _discovery_user_id(current)
    folder = await _owned_favorite_folder(db, user_id, folder_id)
    name, normalized_name = _normalize_favorite_folder_name(body.name)
    folder.name = name
    folder.normalized_name = normalized_name
    try:
        await db.flush()
        await db.refresh(folder)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("같은 이름의 즐겨찾기 폴더가 이미 있습니다.") from exc
    return _favorite_folder_response(folder)


@router.delete("/favorite-folders/{folder_id}", status_code=204)
async def delete_favorite_folder(
    folder_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """개인 폴더를 삭제하고 그 안의 즐겨찾기는 미분류로 보존한다."""
    user_id = _discovery_user_id(current)
    folder = await _owned_favorite_folder(db, user_id, folder_id)
    await db.execute(
        update(ReportFavorite)
        .where(
            ReportFavorite.user_id == user_id,
            ReportFavorite.favorite_folder_id == folder.id,
        )
        .values(favorite_folder_id=None)
    )
    await db.delete(folder)
    await db.commit()


@router.get("/favorites", response_model=list[ReportResponse])
async def list_favorites(
    db: SessionDep,
    current=Depends(get_current_user),
    limit: int | None = Query(default=None, ge=1, le=100),
):
    """현재 사용자의 즐겨찾기를 최근 조회순(미조회는 추가순)으로 반환한다."""
    accessible, flag_ids, favorite_ids = await _discovery_permissions(db, current)
    user_id = _discovery_user_id(current)
    folder_by_report = {
        report_id: folder_id
        for report_id, folder_id in (await db.execute(
            select(
                ReportFavorite.report_id,
                ReportFavorite.favorite_folder_id,
            ).where(ReportFavorite.user_id == user_id)
        )).all()
    }
    items = await report_discovery_service.favorites(
        db, user_id=user_id, accessible_ids=accessible, limit=limit
    )
    responses = [
        _discovery_response(item, flag_ids=flag_ids, favorite_ids=favorite_ids)
        for item in items
    ]
    for response in responses:
        response.favorite_folder_id = folder_by_report.get(response.id)
    return responses


@router.put("/{report_id}/favorite-folder", status_code=204)
async def move_favorite_to_folder(
    report_id: int,
    body: FavoriteFolderMoveRequest,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """즐겨찾기한 레포트를 소유한 개인 폴더 또는 미분류로 이동한다."""
    user_id = _discovery_user_id(current)
    favorite = await db.scalar(
        select(ReportFavorite).where(
            ReportFavorite.user_id == user_id,
            ReportFavorite.report_id == report_id,
        )
    )
    if favorite is None:
        raise NotFoundError("즐겨찾기에 추가된 레포트를 찾을 수 없습니다.")
    if body.folder_id is not None:
        await _owned_favorite_folder(db, user_id, body.folder_id)
    favorite.favorite_folder_id = body.folder_id
    await db.commit()


@router.get("/{report_id}/pages", response_model=list[ReportPageDTO])
async def list_report_pages(
    report_id: int,
    db: SessionDep,
    client: PowerBIClientDep,
    _op=Depends(require_menu("mail_schedules")),
):
    """레포트의 Power BI 페이지 목록(메일 스케줄 페이지 선택용).

    Export to File 에 쓰는 내부 page name 과 사람이 보는 displayName 을 함께 반환한다.
    """
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    return await client.get_report_pages(report.workspace_id, report.report_id)


@router.put("/{report_id}/favorite", status_code=204)
async def add_favorite(report_id: int, db: SessionDep, current=Depends(get_current_user)):
    """즐겨찾기 추가 (멱등). VIEW 권한 필요. 새 항목은 미분류에 둔다."""
    ok = await permission_service.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW, roles=current.get("roles")
    )
    if not ok:
        raise PermissionDeniedError()
    user_id = _discovery_user_id(current)
    existing = await db.scalar(select(ReportFavorite).where(
        ReportFavorite.user_id == user_id, ReportFavorite.report_id == report_id,
    ))
    if existing is None:
        db.add(ReportFavorite(user_id=user_id, report_id=report_id))
        await db.flush()
    await db.commit()


@router.delete("/{report_id}/favorite", status_code=204)
async def remove_favorite(report_id: int, db: SessionDep, current=Depends(get_current_user)):
    """즐겨찾기 해제 (멱등)."""
    user_id = _discovery_user_id(current)
    await db.execute(delete(ReportFavorite).where(
        ReportFavorite.user_id == user_id, ReportFavorite.report_id == report_id,
    ))
    await db.commit()


async def _record_report_view_session(
    report_id: int,
    session_id: uuid.UUID,
    db: SessionDep,
    current: dict,
) -> tuple[int, bool]:
    """조회 세션 원장과 최근 조회/일별 집계를 한 트랜잭션으로 멱등 반영한다."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await permission_service.has_permission(
        db,
        current["user_id"],
        report_id,
        PermissionAction.VIEW,
        roles=current.get("roles"),
    )
    if not allowed:
        raise PermissionDeniedError()

    event_key = f"report-view:{session_id}"
    actor_user_id = _audit_actor_user_id(current)

    def _belongs_to_current(log: AuditLog) -> bool:
        if log.action != AuditAction.REPORT_VIEW or log.resource_id != str(report_id):
            return False
        if current.get("is_local_admin"):
            return log.actor_user_id is None and log.actor_label == current.get("emp_no")
        return log.actor_user_id == actor_user_id

    existing = await db.scalar(select(AuditLog).where(AuditLog.event_key == event_key))
    if existing is not None:
        if not _belongs_to_current(existing):
            raise ConflictError("이미 다른 조회에 사용된 세션 식별자입니다.")
        return existing.id, False

    try:
        audit_log_id = await _append_report_audit(
            db,
            action=AuditAction.REPORT_VIEW,
            result="success",
            current=current,
            report=report,
            event_key=event_key,
            duration_seconds=0,
            meta={"session_id": str(session_id)},
        )

        # 로컬 관리자는 users FK 대상이 아니므로 사용자별 최근 조회 테이블에서는 제외한다.
        if actor_user_id is not None:
            activity_insert = pg_insert(UserReportActivity).values(
                user_id=actor_user_id,
                report_id=report_id,
                first_viewed_at=func.now(),
                last_viewed_at=func.now(),
                view_count=1,
            )
            await db.execute(activity_insert.on_conflict_do_update(
                index_elements=["user_id", "report_id"],
                set_={
                    "last_viewed_at": func.now(),
                    "view_count": UserReportActivity.view_count + 1,
                },
            ))

        daily_insert = pg_insert(ReportViewDailyStat).values(
            report_id=report_id,
            viewed_date=func.current_date(),
            view_count=1,
        )
        await db.execute(daily_insert.on_conflict_do_update(
            index_elements=["report_id", "viewed_date"],
            set_={"view_count": ReportViewDailyStat.view_count + 1},
        ))
        await db.commit()
        return audit_log_id, True
    except IntegrityError:
        # 같은 client UUID가 동시에 재시도된 경우 unique(event_key)가 승자를 정한다.
        await db.rollback()
        existing = await db.scalar(select(AuditLog).where(AuditLog.event_key == event_key))
        if existing is not None and _belongs_to_current(existing):
            return existing.id, False
        raise ConflictError("이미 다른 조회에 사용된 세션 식별자입니다.")


@router.post(
    "/{report_id}/view-session",
    response_model=ReportViewSessionResponse,
)
async def create_report_view_session(
    report_id: int,
    body: ReportViewSessionCreate,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """Power BI 첫 rendered 이벤트를 실제 조회 세션으로 멱등 기록한다."""
    view_log_id, created = await _record_report_view_session(
        report_id, body.session_id, db, current,
    )
    return ReportViewSessionResponse(view_log_id=view_log_id, created=created)


@router.post("/{report_id}/view", status_code=204)
async def record_report_view(
    report_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """구버전 클라이언트 호환용 조회 기록. 신규 클라이언트는 view-session을 사용한다."""
    await _record_report_view_session(report_id, uuid.uuid4(), db, current)


@router.get("/all", response_model=list[ReportResponse])
async def list_all_reports(db: SessionDep, _op=Depends(_require_operator)):
    """전체 레포트 (미공개 포함) — 관리자 레포트 관리 화면용."""
    reports = (await db.execute(select(Report).order_by(Report.sort_order, Report.id))).scalars().all()
    return [_to_response(r) for r in reports]

@router.post("/import-pbix", status_code=202)
async def import_pbix(
    file: UploadFile = File(...),
    report_name: str = Form(...),
    workspace_id: str | None = Form(default=None),
    folder_id: int | None = Form(default=None),
    description: str | None = Form(default=None),
    author_label: str | None = Form(default=None),
    *,
    op=Depends(_require_operator),
):
    """PBIX 파일 업로드 → Power BI 신규 게시 (Worker 비동기). task_id 반환."""
    if not file.filename or not file.filename.lower().endswith(".pbix"):
        raise ValidationError("PBIX(.pbix) 파일만 업로드할 수 있습니다.")

    ws = workspace_id or settings.POWERBI_WORKSPACE_ID
    upload_dir = os.path.join(settings.STORAGE_ROOT_PATH, "_pbix_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    path = os.path.join(upload_dir, f"{uuid.uuid4().hex}.pbix")
    with open(path, "wb") as f:
        f.write(await file.read())

    task = pbix_import_task.delay(
        file_path=path, workspace_id=ws,
        report_name=report_name, folder_id=folder_id,
        description=description, author_label=author_label,
        created_by_user_id=(None if op.get("is_local_admin") else op.get("user_id")),
        created_by_label=_creator_label(op),
        requested_by_user_id=(None if op.get("is_local_admin") else op.get("user_id")),
        requested_by_label=op.get("emp_no"),
    )
    return {"task_id": task.id, "status": "enqueued", "report_name": report_name}

@router.get("/import-status/{task_id}")
async def import_status(task_id: str, _op=Depends(_require_operator)):
    """PBIX import 작업 진행 상태 조회 (Celery result)."""
    res = AsyncResult(task_id, app=celery_app)
    state = res.state
    payload: dict = {"task_id": task_id, "state": state}
    if state == "SUCCESS":
        payload["result"] = res.result
    elif state == "FAILURE":
        payload["error"] = str(res.result)
    return payload

async def _grant_creator_view_stats(db: SessionDep, report_id: int, creator_user_id: int | None) -> None:
    """레포트 작성자에게 통계 조회 권한(VIEW_STATS)을 부여(멱등). 관리자가 이후 회수/수정 가능."""
    if not creator_user_id:
        return
    exists = await db.scalar(
        select(ReportPermission).where(
            ReportPermission.report_id == report_id,
            ReportPermission.subject_type == SubjectType.USER.value,
            ReportPermission.subject_id == creator_user_id,
            ReportPermission.permission == PermissionAction.VIEW_STATS.value,
        )
    )
    if exists is None:
        db.add(ReportPermission(
            report_id=report_id, subject_type=SubjectType.USER.value,
            subject_id=creator_user_id, permission=PermissionAction.VIEW_STATS.value,
        ))
        await db.flush()


@router.patch("/{report_id}", response_model=ReportResponse)
async def update_report(report_id: int, body: ReportUpdate, db: SessionDep, op=Depends(_require_operator)):
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    if body.display_name is not None:
        report.display_name = body.display_name
    if body.description is not None:
        report.description = body.description
    if body.category is not None:
        report.category = body.category
    if body.author_label is not None:
        report.author_label = body.author_label
    if body.sort_order is not None:
        report.sort_order = body.sort_order
    await db.flush()
    await _append_report_audit(
        db, action=AuditAction.REPORT_UPDATE, result="success", current=op,
        report=report, meta={"report_id": report_id},
    )
    await db.commit()
    # onupdate(func.now()) 컬럼(updated_at)은 커밋 후 만료되므로, async 세션에서
    # _to_response가 동기 lazy-load(→ MissingGreenlet 500)를 하지 않도록 명시적으로 재로딩한다.
    await db.refresh(report)
    return _to_response(report)

@router.patch("/{report_id}/visibility", response_model=ReportResponse)
async def change_visibility(report_id: int, body: VisibilityUpdate, db: SessionDep, op=Depends(_require_operator)):
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    if body.is_published and not report.is_published:
        report.published_at = func.now()
    report.is_published = body.is_published
    await db.flush()
    await _append_report_audit(
        db, action=AuditAction.REPORT_VISIBILITY_CHANGE, result="success", current=op,
        report=report,
        meta={"report_id": report_id, "after": "public" if body.is_published else "private"},
    )
    await db.commit()
    # onupdate(func.now()) 컬럼(updated_at)은 커밋 후 만료되므로, async 세션에서
    # _to_response가 동기 lazy-load(→ MissingGreenlet 500)를 하지 않도록 명시적으로 재로딩한다.
    await db.refresh(report)
    return _to_response(report)

@router.patch("/{report_id}/folder", response_model=ReportResponse)
async def move_folder(report_id: int, body: FolderMoveRequest, db: SessionDep, op=Depends(_require_operator)):
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    report.folder_id = body.folder_id
    await db.flush()
    await _append_report_audit(
        db, action=AuditAction.REPORT_UPDATE, result="success", current=op,
        report=report, meta={"report_id": report_id, "folder_id": body.folder_id},
    )
    await db.commit()
    # onupdate(func.now()) 컬럼(updated_at)은 커밋 후 만료되므로, async 세션에서
    # _to_response가 동기 lazy-load(→ MissingGreenlet 500)를 하지 않도록 명시적으로 재로딩한다.
    await db.refresh(report)
    return _to_response(report)


# ===== PBIX Import 업로드 (T-19) =====
import os
import tempfile
from fastapi import UploadFile, File, Form
from celery.result import AsyncResult
from app.core.errors import ValidationError as BIPValidationError
from app.workers.celery_app import celery_app
from app.workers.tasks.pbix_import import pbix_import

_MAX_PBIX_BYTES = 1024 * 1024 * 1024  # 1GB

@router.post("/{report_id}/pbix", status_code=202)
async def upload_pbix(
    report_id: int,
    db: SessionDep,
    op=Depends(_require_operator),
    file: UploadFile = File(...),
    workspace_id: str = Form(...),
    folder_id: int | None = Form(default=None),
):
    """PBIX 업로드 → 검증 → Worker 비동기 import. importId(task_id) 반환."""
    # 확장자 검증
    if not file.filename or not file.filename.lower().endswith(".pbix"):
        raise BIPValidationError("PBIX 파일(.pbix)만 업로드할 수 있습니다.")
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    # 크기 검증하며 임시 저장
    fd, tmp_path = tempfile.mkstemp(suffix=".pbix")
    size = 0
    with os.fdopen(fd, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > _MAX_PBIX_BYTES:
                f.close()
                os.remove(tmp_path)
                raise BIPValidationError("허용 크기(1GB)를 초과했습니다.")
            f.write(chunk)

    task = pbix_import.delay(
        file_path=tmp_path, workspace_id=workspace_id,
        report_name=file.filename, folder_id=folder_id,
        requested_by_user_id=(None if op.get("is_local_admin") else op.get("user_id")),
        requested_by_label=op.get("emp_no"),
    )
    await _append_report_audit(
        db, action=AuditAction.REPORT_UPDATE, result="accepted", current=op,
        report=report,
        meta={"target": "pbix_upload", "workspace_id": workspace_id},
    )
    await db.commit()
    return {"importId": task.id, "status": "enqueued"}

@router.get("/imports/{import_id}")
async def import_status(import_id: str, _op=Depends(_require_operator)):
    """PBIX Import 진행/결과 조회 (Celery result backend)."""
    res = AsyncResult(import_id, app=celery_app)
    payload = {"importId": import_id, "state": res.state}
    if res.successful():
        payload["result"] = res.result
    elif res.failed():
        payload["error"] = str(res.result)
    return payload


# ===== Embed Token 발급 (T-20) =====
from app.core.deps import TokenServiceDep
from app.core.errors import PermissionDeniedError
from app.services import permission_service as _perm
from app.services.powerbi.embed_service import get_embed_info

@router.get("/{report_id}/embed")
async def get_embed(
    report_id: int,
    db: SessionDep,
    token_service: TokenServiceDep,
    current=Depends(get_current_user),
):
    """Report 한정 Embed Token 발급. VIEW 권한 없으면 403."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW, roles=current.get("roles")
    )
    if not allowed:
        await _append_report_audit(
            db, action=AuditAction.PERMISSION_DENIED, result="failure", current=current,
            report=report,
        )
        await db.commit()
        raise PermissionDeniedError()

    info = await get_embed_info(
        token_service, report.workspace_id, report.report_id, report.dataset_id
    )

    # Embed Token 발급은 실제 화면 렌더를 보장하지 않는다. 조회 원장은 프런트의 첫
    # Power BI `rendered` 이벤트가 view-session을 호출할 때만 생성한다.
    return {
        "reportId": info.report_id,
        "embedUrl": info.embed_url,
        "embedToken": info.embed_token,
        "expiry": info.expiry,
        "defaultViewState": report.default_view_state,
    }

@router.post("/{report_id}/view-duration", status_code=204)
async def report_view_duration(
    report_id: int,
    body: ReportViewDurationUpdate,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """조회 세션의 누적 가시 체류시간을 단조 증가 방식으로 갱신한다.

    클라이언트는 구간 delta가 아니라 세션 시작 이후 누적 절대값을 보낸다. 요청 순서가
    뒤바뀌거나 재시도되어도 DB의 기존 값과 받은 값 중 큰 값을 유지해 중복/역전으로
    체류시간이 줄어들지 않는다.
    """
    conditions = [
        AuditLog.id == body.audit_log_id,
        AuditLog.action == AuditAction.REPORT_VIEW,
        AuditLog.resource_type == "report",
        AuditLog.resource_id == str(report_id),
    ]
    if current.get("is_local_admin"):
        conditions.extend([
            AuditLog.actor_user_id.is_(None),
            AuditLog.actor_label == current.get("emp_no"),
        ])
    else:
        conditions.append(AuditLog.actor_user_id == current["user_id"])

    await db.execute(
        update(AuditLog)
        .where(*conditions)
        .values(duration_seconds=func.greatest(
            func.coalesce(AuditLog.duration_seconds, 0),
            body.duration_seconds,
        ))
    )
    await db.commit()


# ===== 새로고침 상태 (T-21) =====
from app.services.refresh_query import get_refresh_status
from app.schemas.refresh import RefreshStatusResponse

@router.get("/{report_id}/refresh-status", response_model=RefreshStatusResponse)
async def refresh_status(
    report_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """레포트 마지막 새로고침 + 다음 예약 (VIEW 권한 필요)."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW, roles=current.get("roles")
    )
    if not allowed:
        raise PermissionDeniedError()

    return await get_refresh_status(db, report)


# ===== 독립 Export API (T-25) =====
from app.core.constants import ExportStatus
from app.models.mail import ExportJob
from app.schemas.report import ExportRequest
from app.workers.tasks.export_poll import export_poll

@router.post("/{report_id}/export", status_code=202)
async def start_export(
    report_id: int,
    body: ExportRequest,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """내보내기 권한 → ExportJob 생성 → export_poll 태스크 enqueue → 202.

    렌더링 파일(PDF/PPTX/PNG)은 DOWNLOAD, 원본 .pbix는 DOWNLOAD_PBIX 권한을 요구한다
    (원본은 데이터 모델을 포함하므로 별도 통제).

    page_name을 지정하면 현재 페이지 1장, 지정하지 않으면 보이는 전체 페이지를
    내보낸다. 렌더링 포맷(PNG/PPTX/PDF)은 두 범위를 모두 지원하며, 전체 PNG는
    Power BI 응답에 따라 페이지별 이미지가 담긴 ZIP으로 저장될 수 있다.
    """
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    export_format = body.export_format.upper()

    required_action = (
        PermissionAction.DOWNLOAD_PBIX
        if export_format == "PBIX"
        else PermissionAction.DOWNLOAD
    )
    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, required_action, roles=current.get("roles")
    )
    if not allowed:
        await _append_report_audit(
            db, action=AuditAction.PERMISSION_DENIED, result="failure", current=current,
            report=report,
        )
        await db.commit()
        raise PermissionDeniedError()

    # PBIX는 원본 파일 단일 다운로드라 페이지/뷰 상태 개념이 없다.
    is_pbix = export_format == "PBIX"
    job = ExportJob(
        mail_job_id=None,
        requested_by_user_id=current["user_id"],
        report_id=report_id,
        workspace_id=report.workspace_id,
        export_format=export_format,
        page_name=None if is_pbix else body.page_name,
        page_display_name=None if is_pbix else body.page_display_name,
        bookmark_state=None if is_pbix else body.bookmark_state,
        page_names_csv=(
            None if is_pbix or body.page_name or not body.page_names
            else ",".join(body.page_names)
        ),
        status=ExportStatus.NOT_STARTED,
    )
    db.add(job)
    await db.flush()

    await _append_report_audit(
        db, action=AuditAction.EXPORT_RUN, result="success", current=current,
        report=report,
        meta={
            "export_format": export_format,
            "export_job_id": job.id,
            "scope": "page" if body.page_name else ("file" if is_pbix else "all_pages"),
            "page_name": body.page_name,
            # 북마크 state 문자열 자체는 길고 의미가 없어 적용 여부만 남긴다.
            "with_view_state": bool(body.bookmark_state) and not is_pbix,
        },
    )
    await db.commit()

    export_poll.delay(job.id)
    return {"export_job_id": job.id, "status": "enqueued"}


@router.post("/{report_id}/replace-pbix", status_code=202)
async def replace_pbix(
    report_id: int,
    file: UploadFile = File(...),
    *,
    db: SessionDep,
    current=Depends(require_report_permission(PermissionAction.MANAGE_REPORT)),
):
    """기존 레포트를 PBIX 재업로드로 교체(덮어쓰기). MANAGE_REPORT 권한 필요.

    General_User도 운영자가 MANAGE_REPORT를 부여한 레포트에 한해 콘텐츠를 교체할 수 있다.
    Power BI Import(nameConflict=CreateOrOverwrite)로 동일 이름 레포트를 덮어쓴다.
    """
    if not file.filename or not file.filename.lower().endswith(".pbix"):
        raise ValidationError("PBIX(.pbix) 파일만 업로드할 수 있습니다.")
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    upload_dir = os.path.join(settings.STORAGE_ROOT_PATH, "_pbix_uploads")
    os.makedirs(upload_dir, exist_ok=True)
    path = os.path.join(upload_dir, f"{uuid.uuid4().hex}.pbix")
    with open(path, "wb") as f:
        f.write(await file.read())

    task = pbix_import_task.delay(
        file_path=path, workspace_id=report.workspace_id,
        report_name=report.report_name or report.display_name,
        folder_id=report.folder_id, name_conflict="CreateOrOverwrite",
        requested_by_user_id=(None if current.get("is_local_admin") else current.get("user_id")),
        requested_by_label=current.get("emp_no"),
    )
    await _append_report_audit(
        db, action=AuditAction.REPORT_UPDATE, result="accepted", current=current,
        report=report, meta={"target": "replace_pbix", "report_id": report_id},
    )
    await db.commit()
    return {"task_id": task.id, "status": "enqueued", "report_id": report_id}


@router.put("/{report_id}/default-view", status_code=204)
async def save_default_view(
    report_id: int,
    body: DefaultViewUpdate,
    *,
    db: SessionDep,
    current=Depends(require_report_permission(PermissionAction.MANAGE_DEFAULT_VIEW)),
):
    """공통 기본 뷰 상태(슬라이서/필터/페이지) 저장/초기화. MANAGE_DEFAULT_VIEW 권한 필요.

    Power BI 북마크 state 문자열을 저장하며, 이후 그 레포트를 여는 모든 뷰어가 이
    상태로 시작한다(.pbix 수정·재업로드 없이 기본 뷰만 변경). state가 비면 기본 뷰 해제.
    """
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    report.default_view_state = body.state or None
    await db.flush()
    await _append_report_audit(
        db, action=AuditAction.REPORT_UPDATE, result="success", current=current,
        report=report, meta={"target": "default_view", "cleared": not body.state},
    )
    await db.commit()


@router.delete("/{report_id}", status_code=204)
async def delete_report(report_id: int, db: SessionDep, op=Depends(_require_operator)):
    """레포트 등록 삭제(BIP 카탈로그에서 제거). 권한/Export 기록은 CASCADE로 함께 삭제.

    이 레포트를 사용하는 메일 스케줄이 있으면 409로 거부한다(먼저 스케줄 삭제 필요).
    Power BI 워크스페이스의 실제 레포트는 삭제하지 않는다(포털 등록만 해제).
    """
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    sched_count = await db.scalar(
        select(func.count()).select_from(MailSchedule).where(MailSchedule.report_id == report_id)
    )
    if sched_count and sched_count > 0:
        raise ConflictError("이 레포트를 사용하는 메일 스케줄이 있어 삭제할 수 없습니다. 먼저 메일 스케줄을 삭제하세요.")

    # 삭제 전 스냅샷을 남겨 카탈로그에서 사라진 뒤에도 lifecycle 통계에 보존한다.
    await _append_report_audit(
        db, action=AuditAction.REPORT_DELETE, result="success", current=op,
        report=report, meta={"report_id": report_id},
    )
    await db.delete(report)
    await db.commit()


@router.get("/{report_id}/live-refresh-status")
async def live_refresh_status(
    report_id: int,
    db: SessionDep,
    client: PowerBIClientDep,
    redis: RedisDep,
    current=Depends(require_report_permission(PermissionAction.VIEW)),
):
    """Power BI에 직접 최신 새로고침 상태를 조회(수집기/DB와 무관, 실시간).

    진행 중 판정용으로 도크가 폴링한다. terminal=Completed/Failed/Disabled/Cancelled.
    dataset 단위 Redis 캐시(TTL 20초)로 동시 뷰어의 upstream REST 호출을 합쳐 부하/쓰로틀을 줄인다.
    """
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    if not report.dataset_id:
        return {"has_history": False, "in_progress": False, "status": None}

    cache_key = f"bip:livestatus:{report.workspace_id}:{report.dataset_id}"
    try:
        cached = await redis.get(cache_key)
    except Exception:
        cached = None
    if cached:
        try:
            return json.loads(cached)
        except (ValueError, TypeError):
            pass

    runs = await client.list_refreshes(report.workspace_id, report.dataset_id, top=1)
    if not runs:
        payload = {"has_history": False, "in_progress": False, "status": None}
    else:
        r = runs[0]
        terminal = r.status in ("Completed", "Failed", "Disabled", "Cancelled")
        payload = {
            "has_history": True,
            "status": r.status,
            "in_progress": not terminal,
            "start_time": r.start_time.isoformat() if r.start_time else None,
            "end_time": r.end_time.isoformat() if r.end_time else None,
        }

    # 예약 새로고침(다음 갱신 예정) 정보 추가 (DB의 refresh_schedules 기반)
    payload["schedule"] = await get_schedule_info(db, report.workspace_id, report.dataset_id)

    try:
        await redis.set(cache_key, json.dumps(payload), ex=LIVE_STATUS_CACHE_TTL)
    except Exception:
        pass
    return payload
