"""레포트 폴더 라우트 — /api/report-folders.

CRUD는 System_Operator, 트리 조회(tree)는 로그인 사용자(G+).
삭제 시 하위 폴더/레포트 있으면 409 거부(R41.5).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, or_

from app.core.constants import AuditAction, RoleCode, PermissionAction
from app.core.deps import SessionDep, require_menu, get_current_user
from app.core.errors import NotFoundError, ConflictError
from app.models.report import ReportFolder, Report
from app.schemas.folder import FolderCreate, FolderUpdate, FolderResponse, FolderTreeNode
from app.services.audit_service import append_audit
from app.services import permission_service

router = APIRouter(prefix="/api/report-folders", tags=["folders"])

_require_operator = require_menu("admin_reports")

@router.get("", response_model=list[FolderResponse])
async def list_folders(db: SessionDep, _op=Depends(_require_operator)):
    folders = (await db.execute(select(ReportFolder).order_by(ReportFolder.sort_order, ReportFolder.id))).scalars().all()
    return [FolderResponse(id=f.id, parent_id=f.parent_id, name=f.name,
                           folder_type=f.folder_type, sort_order=f.sort_order) for f in folders]

@router.post("", response_model=FolderResponse, status_code=201)
async def create_folder(body: FolderCreate, db: SessionDep, op=Depends(_require_operator)):
    if body.parent_id is not None:
        parent = await db.scalar(select(ReportFolder).where(ReportFolder.id == body.parent_id))
        if parent is None:
            raise NotFoundError("상위 폴더를 찾을 수 없습니다.")
    folder = ReportFolder(name=body.name, parent_id=body.parent_id,
                          folder_type=body.folder_type, sort_order=body.sort_order)
    db.add(folder)
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="folder", resource_id=str(folder.id),
                       meta={"target": "folder_create", "folder_id": folder.id})
    await db.commit()
    return FolderResponse(id=folder.id, parent_id=folder.parent_id, name=folder.name,
                          folder_type=folder.folder_type, sort_order=folder.sort_order)

@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(folder_id: int, body: FolderUpdate, db: SessionDep, op=Depends(_require_operator)):
    folder = await db.scalar(select(ReportFolder).where(ReportFolder.id == folder_id))
    if folder is None:
        raise NotFoundError("폴더를 찾을 수 없습니다.")
    if body.name is not None:
        folder.name = body.name
    if body.parent_id is not None:
        folder.parent_id = body.parent_id
    if body.folder_type is not None:
        folder.folder_type = body.folder_type
    if body.sort_order is not None:
        folder.sort_order = body.sort_order
    await db.flush()
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="folder", resource_id=str(folder_id),
                       meta={"target": "folder_update", "folder_id": folder_id})
    await db.commit()
    return FolderResponse(id=folder.id, parent_id=folder.parent_id, name=folder.name,
                          folder_type=folder.folder_type, sort_order=folder.sort_order)

@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: int, db: SessionDep, op=Depends(_require_operator)):
    """폴더 삭제. 하위 폴더 또는 소속 레포트 있으면 409 거부(R41.5)."""
    folder = await db.scalar(select(ReportFolder).where(ReportFolder.id == folder_id))
    if folder is None:
        raise NotFoundError("폴더를 찾을 수 없습니다.")

    child_count = await db.scalar(
        select(func.count()).select_from(ReportFolder).where(ReportFolder.parent_id == folder_id)
    )
    report_count = await db.scalar(
        select(func.count()).select_from(Report).where(Report.folder_id == folder_id)
    )
    if child_count > 0 or report_count > 0:
        raise ConflictError("하위 폴더 또는 소속 레포트가 있어 삭제할 수 없습니다. 먼저 이동하거나 삭제하세요.")

    await db.delete(folder)
    await append_audit(db, action=AuditAction.REPORT_UPDATE, result="success",
                       actor_user_id=op["user_id"], actor_label=op["emp_no"],
                       resource_type="folder", resource_id=str(folder_id),
                       meta={"target": "folder_delete", "folder_id": folder_id})
    await db.commit()

@router.get("/tree", response_model=list[FolderTreeNode])
async def folder_tree(
    db: SessionDep,
    current=Depends(get_current_user),
    q: str | None = Query(default=None, max_length=200),
):
    """폴더 트리 + 사용자가 VIEW 권한 가진 레포트만 노출(R41.4).

    검색어가 있으면 리포트 메타데이터가 일치하는 레포트만 집계하고,
    해당 결과가 속한 폴더 경로만 반환한다. 검색이 없을 때 운영자
    (System_Operator/로컬 관리자)는 관리 목적상 빈 폴더까지 본다.
    """
    folders = (await db.execute(select(ReportFolder).order_by(ReportFolder.sort_order, ReportFolder.id))).scalars().all()
    normalized_query = (q or "").strip()
    reports_stmt = select(Report)
    if normalized_query:
        pattern = f"%{normalized_query}%"
        reports_stmt = reports_stmt.where(or_(
            Report.display_name.ilike(pattern),
            Report.report_name.ilike(pattern),
            Report.description.ilike(pattern),
            Report.author_label.ilike(pattern),
            Report.category.ilike(pattern),
        ))
    reports = (await db.execute(reports_stmt)).scalars().all()

    accessible = await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW, roles=current.get("roles")
    )

    # folder_id -> [report_id] (VIEW 권한 보유 레포트만; 가시성은 권한 기반)
    reports_by_folder: dict[int | None, list[int]] = {}
    for r in reports:
        if r.id in accessible:
            reports_by_folder.setdefault(r.folder_id, []).append(r.id)

    # 노드 생성
    nodes: dict[int, FolderTreeNode] = {
        f.id: FolderTreeNode(id=f.id, name=f.name, folder_type=f.folder_type,
                             sort_order=f.sort_order, report_ids=reports_by_folder.get(f.id, []))
        for f in folders
    }
    # 부모-자식 연결
    roots: list[FolderTreeNode] = []
    for f in folders:
        if f.parent_id is not None and f.parent_id in nodes:
            nodes[f.parent_id].children.append(nodes[f.id])
        else:
            roots.append(nodes[f.id])

    # 검색이 없을 때만 운영자에게 빈 폴더까지 보여준다.
    # 검색 중에는 모든 역할에서 결과가 있는 폴더 경로만 남겨 count를 검색 결과와 맞춘다.
    is_operator = (
        RoleCode.SYSTEM_OPERATOR.value in current.get("roles", [])
        or bool(current.get("is_local_admin"))
    )
    if is_operator and not normalized_query:
        return roots

    # (일반 사용자) 하위(자기 포함)에 조회권 있는 레포트가 하나도 없는 폴더는 숨긴다(R41.4/R41.7).
    # 레포트 조회 권한이 없으면 그 레포트가 속한 상위 폴더도 보이지 않아야 한다.
    def _keep(node: FolderTreeNode) -> bool:
        node.children = [c for c in node.children if _keep(c)]
        return bool(node.report_ids) or bool(node.children)

    return [r for r in roots if _keep(r)]
