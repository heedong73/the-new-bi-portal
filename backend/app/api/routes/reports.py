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
from sqlalchemy import select, func, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.core.constants import AuditAction, RoleCode, PermissionAction, SubjectType
from app.core.deps import SessionDep, require_menu, require_report_permission, get_current_user, PowerBIClientDep, RedisDep
from app.core.errors import NotFoundError, ConflictError, ValidationError, PermissionDeniedError
from app.models.report import (
    Report, Workspace, ReportFavorite, ReportPermission,
    UserReportActivity, ReportViewDailyStat,
)
from app.models.mail import MailSchedule
from app.models.log import AuditLog
from app.workers.celery_app import celery_app
from app.workers.tasks.pbix_import import pbix_import as pbix_import_task
from app.schemas.report import (
    ReportUpdate, VisibilityUpdate, FolderMoveRequest, ReportResponse, DefaultViewUpdate,
    ReportCatalogResponse,
)
from app.services.powerbi.client import ReportPageDTO
from app.services.audit_service import append_audit
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


def _discovery_response(
    item,
    *,
    manage_ids: set[int],
    download_ids: set[int],
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
    response.can_manage = item.report.id in manage_ids
    response.can_download = item.report.id in download_ids
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
    manage_ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.MANAGE_REPORT, roles=current.get("roles")
    )
    download_ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.DOWNLOAD, roles=current.get("roles")
    )
    fav_ids = {
        rid for (rid,) in (await db.execute(
            select(ReportFavorite.report_id).where(ReportFavorite.user_id == current["user_id"])
        )).all()
    }
    stmt = select(Report)
    if folder_id is not None:
        stmt = stmt.where(Report.folder_id == folder_id)
    reports = (await db.execute(stmt.order_by(Report.sort_order, Report.id))).scalars().all()
    result = []
    for r in reports:
        if r.id in accessible:
            resp = _to_response(r)
            resp.can_manage = r.id in manage_ids
            resp.can_download = r.id in download_ids
            resp.is_favorite = r.id in fav_ids
            result.append(resp)
    return result


def _discovery_user_id(current: dict) -> int:
    """독립 PK 공간을 쓰는 로컬 관리자가 일반 사용자의 개인화를 읽지 않게 한다."""
    return -1 if current.get("is_local_admin") else current["user_id"]


async def _discovery_permissions(db: SessionDep, current: dict):
    accessible_ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW, roles=current.get("roles")
    )
    manage_ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.MANAGE_REPORT, roles=current.get("roles")
    )
    download_ids = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.DOWNLOAD, roles=current.get("roles")
    )
    favorite_ids: set[int] = set()
    if not current.get("is_local_admin"):
        favorite_ids = {
            report_id for (report_id,) in (await db.execute(
                select(ReportFavorite.report_id).where(
                    ReportFavorite.user_id == current["user_id"]
                )
            )).all()
        }
    return accessible_ids, manage_ids, download_ids, favorite_ids


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
    accessible, manage_ids, download_ids, favorite_ids = await _discovery_permissions(db, current)
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
            _discovery_response(
                item,
                manage_ids=manage_ids,
                download_ids=download_ids,
                favorite_ids=favorite_ids,
            )
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
    accessible, manage_ids, download_ids, favorite_ids = await _discovery_permissions(db, current)
    items = await report_discovery_service.recent(
        db, user_id=_discovery_user_id(current), accessible_ids=accessible, limit=limit
    )
    return [
        _discovery_response(
            item,
            manage_ids=manage_ids,
            download_ids=download_ids,
            favorite_ids=favorite_ids,
        )
        for item in items
    ]


@router.get("/favorites", response_model=list[ReportResponse])
async def list_favorites(
    db: SessionDep,
    current=Depends(get_current_user),
    limit: int | None = Query(default=None, ge=1, le=100),
):
    """현재 사용자의 즐겨찾기를 최근 조회순(미조회는 추가순)으로 반환한다."""
    accessible, manage_ids, download_ids, favorite_ids = await _discovery_permissions(db, current)
    items = await report_discovery_service.favorites(
        db, user_id=_discovery_user_id(current), accessible_ids=accessible, limit=limit
    )
    return [
        _discovery_response(
            item,
            manage_ids=manage_ids,
            download_ids=download_ids,
            favorite_ids=favorite_ids,
        )
        for item in items
    ]


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
    """즐겨찾기 추가 (멱등). VIEW 권한 필요."""
    ok = await permission_service.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW, roles=current.get("roles")
    )
    if not ok:
        raise PermissionDeniedError()
    existing = await db.scalar(select(ReportFavorite).where(
        ReportFavorite.user_id == current["user_id"], ReportFavorite.report_id == report_id,
    ))
    if existing is None:
        db.add(ReportFavorite(user_id=current["user_id"], report_id=report_id))
        await db.flush()
    await db.commit()


@router.delete("/{report_id}/favorite", status_code=204)
async def remove_favorite(report_id: int, db: SessionDep, current=Depends(get_current_user)):
    """즐겨찾기 해제 (멱등)."""
    await db.execute(delete(ReportFavorite).where(
        ReportFavorite.user_id == current["user_id"], ReportFavorite.report_id == report_id,
    ))
    await db.commit()


@router.post("/{report_id}/view", status_code=204)
async def record_report_view(
    report_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """실제 레포트 화면 진입을 최근 조회와 일별 인기 집계에 반영한다."""
    existing_report_id = await db.scalar(select(Report.id).where(Report.id == report_id))
    if existing_report_id is None:
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
    if current.get("is_local_admin"):
        return

    activity_insert = pg_insert(UserReportActivity).values(
        user_id=current["user_id"],
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
        created_by_user_id=op.get("user_id"),
        created_by_label=_creator_label(op),
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
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id})
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
    await append_audit(db, action=AuditAction.REPORT_VISIBILITY_CHANGE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id, "after": "public" if body.is_published else "private"})
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
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id, "folder_id": body.folder_id})
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
    )
    await append_audit(db, action=AuditAction.REPORT_CREATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"target": "pbix_upload", "workspace_id": workspace_id})
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
        await append_audit(db, action=AuditAction.PERMISSION_DENIED, result="failure",
                           actor_user_id=current["user_id"], actor_label=current["emp_no"],
                           resource_type="report", resource_id=str(report_id))
        await db.commit()
        raise PermissionDeniedError()

    info = await get_embed_info(
        token_service, report.workspace_id, report.report_id, report.dataset_id
    )

    audit_log_id = await append_audit(
        db, action=AuditAction.REPORT_VIEW, result="success",
        actor_user_id=current["user_id"], actor_label=current["emp_no"],
        resource_type="report", resource_id=str(report_id),
    )
    await db.commit()

    return {
        "reportId": info.report_id,
        "embedUrl": info.embed_url,
        "embedToken": info.embed_token,
        "expiry": info.expiry,
        "defaultViewState": report.default_view_state,
        # 프런트가 탭 이탈/전환 시 이 조회 세션의 체류 시간을 갱신할 때 사용.
        "viewLogId": audit_log_id,
    }

@router.post("/{report_id}/view-duration", status_code=204)
async def report_view_duration(
    report_id: int,
    body: dict,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """조회 세션(embed 발급 시 남긴 report_view 로그)의 체류 시간을 갱신한다.

    프런트가 탭 이탈/전환(visibilitychange, pagehide) 시점에 `navigator.sendBeacon`
    또는 fetch로 호출한다. 새 로그를 만들지 않고 embed 발급 시점 로그의
    duration_seconds만 갱신한다(근사치 — 브라우저 강제 종료/네트워크 단절 시 마지막
    값이 못 반영될 수 있음). 본인이 남긴 로그만 갱신 가능(actor_user_id 일치 검증).
    """
    audit_log_id = body.get("audit_log_id")
    duration_seconds = body.get("duration_seconds")
    if not isinstance(audit_log_id, int) or not isinstance(duration_seconds, (int, float)):
        raise ValidationError("audit_log_id/duration_seconds가 필요합니다.")

    log = await db.scalar(select(AuditLog).where(AuditLog.id == audit_log_id))
    if log is None or log.actor_user_id != current["user_id"] or log.resource_id != str(report_id):
        # 존재하지 않거나 본인 로그가 아니면 조용히 무시(악의적 위조 방지, 굳이 오류 노출 불필요)
        return
    # 음수/비정상적으로 큰 값(예: 하루 이상 방치) 방어. 하루=86400초.
    log.duration_seconds = max(0, min(int(duration_seconds), 86400))
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
    """DOWNLOAD 권한 → ExportJob 생성 → export_poll 태스크 enqueue → 202."""
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await _perm.has_permission(
        db, current["user_id"], report_id, PermissionAction.DOWNLOAD, roles=current.get("roles")
    )
    if not allowed:
        await append_audit(
            db, action=AuditAction.PERMISSION_DENIED, result="failure",
            actor_user_id=current["user_id"], actor_label=current["emp_no"],
            resource_type="report", resource_id=str(report_id),
        )
        await db.commit()
        raise PermissionDeniedError()

    job = ExportJob(
        mail_job_id=None,
        requested_by_user_id=current["user_id"],
        report_id=report_id,
        workspace_id=report.workspace_id,
        export_format=body.export_format.upper(),
        status=ExportStatus.NOT_STARTED,
    )
    db.add(job)
    await db.flush()

    await append_audit(
        db, action=AuditAction.EXPORT_RUN, result="success",
        actor_user_id=current["user_id"], actor_label=current["emp_no"],
        resource_type="report", resource_id=str(report_id),
        meta={"export_format": body.export_format, "export_job_id": job.id},
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
    )
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=current["user_id"], actor_label=current["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"target": "replace_pbix", "report_id": report_id})
    await db.commit()
    return {"task_id": task.id, "status": "enqueued", "report_id": report_id}


@router.put("/{report_id}/default-view", status_code=204)
async def save_default_view(
    report_id: int,
    body: DefaultViewUpdate,
    *,
    db: SessionDep,
    current=Depends(require_report_permission(PermissionAction.MANAGE_REPORT)),
):
    """공통 기본 뷰 상태(슬라이서/필터/페이지) 저장/초기화. MANAGE_REPORT 권한 필요.

    Power BI 북마크 state 문자열을 저장하며, 이후 그 레포트를 여는 모든 뷰어가 이
    상태로 시작한다(.pbix 수정·재업로드 없이 기본 뷰만 변경). state가 비면 기본 뷰 해제.
    """
    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    report.default_view_state = body.state or None
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=current["user_id"], actor_label=current["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"target": "default_view", "cleared": not body.state})
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

    await db.delete(report)
    await append_audit(db, action=AuditAction.REPORT_DELETE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="report", resource_id=str(report_id),
                       meta={"report_id": report_id})
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
