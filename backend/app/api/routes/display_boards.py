"""KPI 전광판 API — /api/display-boards.

전광판은 여러 Power BI 레포트/페이지를 순서대로 묶어 전체화면에서 자동 순환 표시하는
플레이리스트다.

권한 모델
  * 구성 관리(생성/수정/삭제/슬라이드 편집): ``admin_display_boards`` 메뉴 =
    System_Operator 전용(GRANTABLE_MENU_KEYS 밖이므로 개별 부여로 통과되지 않는다).
  * 재생(목록/상세/Embed): 로그인 사용자. 단, 슬라이드는 **레포트 VIEW 권한으로 필터**하여
    전광판을 통해 권한 없는 레포트가 노출되지 않게 한다(R8/R24와 동일한 기준).

장시간 무인 운영 고려
  * Embed Token은 슬라이드가 아니라 **레포트 단위**로 발급한다. 같은 레포트의 여러
    페이지를 순환할 때 토큰을 재사용하고, 프런트가 만료 전 이 엔드포인트로 재발급한다.
  * 이 Embed 엔드포인트는 report_view 감사 로그를 남기지 않는다. 전광판은 무인 순환
    표시이므로 조회수/체류시간 통계에 섞이면 사용 통계가 왜곡된다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.core.constants import AuditAction, PermissionAction, RoleCode
from app.core.deps import SessionDep, TokenServiceDep, get_current_user, require_menu
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.display import DisplayBoard, DisplayBoardSlide
from app.models.report import Report
from app.schemas.display_board import (
    MAX_BOARDS,
    MAX_SLIDES_PER_BOARD,
    DisplayBoardCreate,
    DisplayBoardEmbedResponse,
    DisplayBoardResponse,
    DisplayBoardSlideCreate,
    DisplayBoardSlideReorder,
    DisplayBoardSlideResponse,
    DisplayBoardSlideUpdate,
    DisplayBoardUpdate,
)
from app.services import permission_service
from app.services.audit_service import append_audit
from app.services.powerbi.embed_service import get_embed_info

router = APIRouter(prefix="/api/display-boards", tags=["display-boards"])

_require_operator = require_menu("admin_display_boards")


def _is_operator(current: dict) -> bool:
    """System_Operator 또는 비상용 로컬 관리자인지."""
    return (
        RoleCode.SYSTEM_OPERATOR.value in current.get("roles", [])
        or bool(current.get("is_local_admin"))
    )


def _creator_label(op: dict) -> str | None:
    """생성자 라벨 '이름(사번)'. 이름이 없으면 사번만."""
    name = op.get("name")
    emp = op.get("emp_no")
    if name and emp:
        return f"{name}({emp})"
    return name or emp


def _normalize_board_name(value: str) -> tuple[str, str]:
    """표시 이름은 trim, 중복 비교용 이름은 공백 축약 + casefold."""
    name = value.strip()
    if not name:
        raise ValidationError("전광판 이름을 입력해 주세요.")
    if len(name) > 120:
        raise ValidationError("전광판 이름은 120자 이하여야 합니다.")
    normalized = " ".join(name.split()).casefold()
    return name, normalized


def _report_label(report: Report) -> str:
    return report.display_name or report.report_name or report.report_id


async def _get_board(db: SessionDep, board_id: int) -> DisplayBoard:
    board = await db.scalar(select(DisplayBoard).where(DisplayBoard.id == board_id))
    if board is None:
        raise NotFoundError("전광판을 찾을 수 없습니다.")
    return board


async def _slides_with_reports(
    db: SessionDep, board_id: int
) -> list[tuple[DisplayBoardSlide, Report]]:
    """슬라이드를 표시 순서대로 레포트와 함께 조회한다."""
    rows = (
        await db.execute(
            select(DisplayBoardSlide, Report)
            .join(Report, Report.id == DisplayBoardSlide.report_id)
            .where(DisplayBoardSlide.board_id == board_id)
            .order_by(DisplayBoardSlide.sort_order, DisplayBoardSlide.id)
        )
    ).all()
    return [(slide, report) for slide, report in rows]


def _slide_response(
    slide: DisplayBoardSlide,
    report: Report,
    *,
    board: DisplayBoard,
    accessible_ids: set[int],
) -> DisplayBoardSlideResponse:
    return DisplayBoardSlideResponse(
        id=slide.id,
        report_id=slide.report_id,
        report_name=_report_label(report),
        page_name=slide.page_name,
        page_display_name=slide.page_display_name,
        effective_dwell_seconds=slide.dwell_seconds or board.default_dwell_seconds,
        dwell_seconds=slide.dwell_seconds,
        sort_order=slide.sort_order,
        is_enabled=slide.is_enabled,
        is_accessible=slide.report_id in accessible_ids,
    )


def _board_response(
    board: DisplayBoard,
    slides: list[DisplayBoardSlideResponse],
    *,
    include_slides: bool,
) -> DisplayBoardResponse:
    playable = [s for s in slides if s.is_enabled and s.is_accessible]
    return DisplayBoardResponse(
        id=board.id,
        name=board.name,
        description=board.description,
        is_active=board.is_active,
        default_dwell_seconds=board.default_dwell_seconds,
        slide_count=len(slides),
        playable_slide_count=len(playable),
        total_cycle_seconds=sum(s.effective_dwell_seconds for s in playable),
        slides=slides if include_slides else [],
        created_by_label=board.created_by_label,
        created_at=board.created_at,
        updated_at=board.updated_at,
    )


async def _accessible_view_ids(db: SessionDep, current: dict) -> set[int]:
    return await permission_service.accessible_report_ids(
        db, current["user_id"], PermissionAction.VIEW, roles=current.get("roles")
    )


async def _next_sort_order(db: SessionDep, board_id: int) -> int:
    current_max = await db.scalar(
        select(func.max(DisplayBoardSlide.sort_order)).where(
            DisplayBoardSlide.board_id == board_id
        )
    )
    return 0 if current_max is None else current_max + 1


async def _touch_board(db: SessionDep, board: DisplayBoard) -> None:
    """슬라이드 변경도 보드의 updated_at에 반영해 플레이어가 구성 변경을 감지하게 한다."""
    board.updated_at = func.now()


# ===== 재생용 (로그인 사용자) =====

@router.get("", response_model=list[DisplayBoardResponse])
async def list_display_boards(
    db: SessionDep,
    current=Depends(get_current_user),
):
    """재생 가능한 전광판 목록.

    활성 상태이고, 현재 사용자가 볼 수 있는 슬라이드가 1개 이상인 전광판만 반환한다.
    """
    boards = (
        await db.execute(
            select(DisplayBoard)
            .where(DisplayBoard.is_active.is_(True))
            .order_by(DisplayBoard.name, DisplayBoard.id)
        )
    ).scalars().all()
    if not boards:
        return []

    accessible_ids = await _accessible_view_ids(db, current)
    result: list[DisplayBoardResponse] = []
    for board in boards:
        slides = [
            _slide_response(slide, report, board=board, accessible_ids=accessible_ids)
            for slide, report in await _slides_with_reports(db, board.id)
        ]
        response = _board_response(board, slides, include_slides=False)
        if response.playable_slide_count > 0:
            result.append(response)
    return result


@router.get("/manage", response_model=list[DisplayBoardResponse])
async def list_display_boards_for_manage(
    db: SessionDep,
    op=Depends(_require_operator),
):
    """관리용 전체 목록 (비활성 포함, 슬라이드 상세 포함)."""
    boards = (
        await db.execute(
            select(DisplayBoard).order_by(DisplayBoard.name, DisplayBoard.id)
        )
    ).scalars().all()
    accessible_ids = await _accessible_view_ids(db, op)
    return [
        _board_response(
            board,
            [
                _slide_response(slide, report, board=board, accessible_ids=accessible_ids)
                for slide, report in await _slides_with_reports(db, board.id)
            ],
            include_slides=True,
        )
        for board in boards
    ]


@router.get("/{board_id}", response_model=DisplayBoardResponse)
async def get_display_board(
    board_id: int,
    db: SessionDep,
    current=Depends(get_current_user),
):
    """재생용 전광판 상세.

    슬라이드는 활성이고 VIEW 권한이 있는 것만 순서대로 반환한다. 운영자는 비활성
    전광판도 미리 볼 수 있다(구성 검수용).
    """
    board = await _get_board(db, board_id)
    operator = _is_operator(current)
    if not board.is_active and not operator:
        raise NotFoundError("전광판을 찾을 수 없습니다.")

    accessible_ids = await _accessible_view_ids(db, current)
    slides = [
        _slide_response(slide, report, board=board, accessible_ids=accessible_ids)
        for slide, report in await _slides_with_reports(db, board.id)
    ]
    playable = [s for s in slides if s.is_enabled and s.is_accessible]
    return _board_response(board, playable, include_slides=True)


@router.get(
    "/{board_id}/reports/{report_id}/embed",
    response_model=DisplayBoardEmbedResponse,
)
async def get_display_board_embed(
    board_id: int,
    report_id: int,
    db: SessionDep,
    token_service: TokenServiceDep,
    current=Depends(get_current_user),
):
    """전광판 슬라이드 재생용 Embed Token 발급.

    - 해당 전광판에 그 레포트를 쓰는 **활성 슬라이드**가 있어야 한다(임의 레포트 토큰
      발급 통로가 되지 않도록).
    - 레포트 VIEW 권한을 다시 검증한다.
    - 무인 순환 표시이므로 report_view 감사 로그는 남기지 않는다.
    """
    board = await _get_board(db, board_id)
    if not board.is_active and not _is_operator(current):
        raise NotFoundError("전광판을 찾을 수 없습니다.")

    slide_exists = await db.scalar(
        select(DisplayBoardSlide.id).where(
            DisplayBoardSlide.board_id == board_id,
            DisplayBoardSlide.report_id == report_id,
            DisplayBoardSlide.is_enabled.is_(True),
        )
    )
    if slide_exists is None:
        raise NotFoundError("전광판에서 이 레포트를 찾을 수 없습니다.")

    report = await db.scalar(select(Report).where(Report.id == report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    allowed = await permission_service.has_permission(
        db, current["user_id"], report_id, PermissionAction.VIEW, roles=current.get("roles")
    )
    if not allowed:
        raise NotFoundError("전광판에서 이 레포트를 찾을 수 없습니다.")

    info = await get_embed_info(
        token_service, report.workspace_id, report.report_id, report.dataset_id
    )
    return DisplayBoardEmbedResponse(
        reportId=info.report_id,
        embedUrl=info.embed_url,
        embedToken=info.embed_token,
        expiry=info.expiry,
    )


# ===== 구성 관리 (System_Operator) =====

@router.post("", response_model=DisplayBoardResponse, status_code=201)
async def create_display_board(
    body: DisplayBoardCreate,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """전광판 생성. 같은 이름이 이미 있으면 409."""
    name, normalized = _normalize_board_name(body.name)
    board_count = int(
        await db.scalar(select(func.count(DisplayBoard.id))) or 0
    )
    if board_count >= MAX_BOARDS:
        raise ValidationError(f"전광판은 최대 {MAX_BOARDS}개까지 만들 수 있습니다.")

    board = DisplayBoard(
        name=name,
        normalized_name=normalized,
        description=(body.description or None),
        default_dwell_seconds=body.default_dwell_seconds,
        created_by_user_id=op.get("user_id"),
        created_by_label=_creator_label(op),
    )
    db.add(board)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("같은 이름의 전광판이 이미 있습니다.") from exc

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board.id),
        meta={"target": "display_board_create"},
    )
    await db.commit()
    await db.refresh(board)
    return _board_response(board, [], include_slides=True)


@router.patch("/{board_id}", response_model=DisplayBoardResponse)
async def update_display_board(
    board_id: int,
    body: DisplayBoardUpdate,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """전광판 이름/설명/활성 여부/기본 노출 시간 수정 (전달된 필드만)."""
    board = await _get_board(db, board_id)
    fields = body.model_fields_set

    if "name" in fields and body.name is not None:
        name, normalized = _normalize_board_name(body.name)
        board.name = name
        board.normalized_name = normalized
    if "description" in fields:
        board.description = (body.description or None) if body.description else None
    if "is_active" in fields and body.is_active is not None:
        board.is_active = body.is_active
    if "default_dwell_seconds" in fields and body.default_dwell_seconds is not None:
        board.default_dwell_seconds = body.default_dwell_seconds

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError("같은 이름의 전광판이 이미 있습니다.") from exc

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board.id),
        meta={"target": "display_board_update"},
    )
    await db.commit()
    await db.refresh(board)

    accessible_ids = await _accessible_view_ids(db, op)
    slides = [
        _slide_response(slide, report, board=board, accessible_ids=accessible_ids)
        for slide, report in await _slides_with_reports(db, board.id)
    ]
    return _board_response(board, slides, include_slides=True)


@router.delete("/{board_id}", status_code=204)
async def delete_display_board(
    board_id: int,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """전광판 삭제. 슬라이드는 FK CASCADE로 함께 삭제되며 레포트는 영향받지 않는다."""
    board = await _get_board(db, board_id)
    await db.delete(board)
    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board_id),
        meta={"target": "display_board_delete"},
    )
    await db.commit()


@router.post(
    "/{board_id}/slides",
    response_model=DisplayBoardSlideResponse,
    status_code=201,
)
async def add_display_board_slide(
    board_id: int,
    body: DisplayBoardSlideCreate,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """슬라이드를 목록 맨 뒤에 추가한다.

    같은 레포트를 페이지만 바꿔 여러 번 넣을 수 있다(페이지별 순환). 다만 완전히
    동일한 레포트+페이지 조합은 중복 재생이 되므로 막는다.
    """
    board = await _get_board(db, board_id)
    report = await db.scalar(select(Report).where(Report.id == body.report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")

    slide_count = int(
        await db.scalar(
            select(func.count(DisplayBoardSlide.id)).where(
                DisplayBoardSlide.board_id == board_id
            )
        ) or 0
    )
    if slide_count >= MAX_SLIDES_PER_BOARD:
        raise ValidationError(
            f"한 전광판에는 최대 {MAX_SLIDES_PER_BOARD}개까지 추가할 수 있습니다."
        )

    page_name = body.page_name or None
    duplicate = await db.scalar(
        select(DisplayBoardSlide.id).where(
            DisplayBoardSlide.board_id == board_id,
            DisplayBoardSlide.report_id == body.report_id,
            DisplayBoardSlide.page_name.is_(None) if page_name is None
            else DisplayBoardSlide.page_name == page_name,
        )
    )
    if duplicate is not None:
        raise ConflictError("이미 같은 레포트·페이지가 이 전광판에 있습니다.")

    slide = DisplayBoardSlide(
        board_id=board_id,
        report_id=body.report_id,
        page_name=page_name,
        page_display_name=body.page_display_name or None,
        dwell_seconds=body.dwell_seconds,
        sort_order=await _next_sort_order(db, board_id),
        is_enabled=True,
    )
    db.add(slide)
    await _touch_board(db, board)
    await db.flush()

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board_id),
        meta={"target": "display_slide_add", "report_id": body.report_id},
    )
    await db.commit()
    await db.refresh(slide)
    await db.refresh(board)

    accessible_ids = await _accessible_view_ids(db, op)
    return _slide_response(slide, report, board=board, accessible_ids=accessible_ids)


@router.put("/{board_id}/slides/reorder", status_code=204)
async def reorder_display_board_slides(
    board_id: int,
    body: DisplayBoardSlideReorder,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """전광판의 모든 슬라이드 순서를 한 번에 변경한다(부분 전달 불가)."""
    board = await _get_board(db, board_id)
    slides = (
        await db.execute(
            select(DisplayBoardSlide).where(DisplayBoardSlide.board_id == board_id)
        )
    ).scalars().all()
    current_ids = {slide.id for slide in slides}
    requested = body.slide_ids
    if len(requested) != len(set(requested)) or set(requested) != current_ids:
        raise ValidationError("이 전광판의 모든 슬라이드를 중복 없이 전달해 주세요.")

    by_id = {slide.id: slide for slide in slides}
    for sort_order, slide_id in enumerate(requested):
        by_id[slide_id].sort_order = sort_order
    await _touch_board(db, board)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board_id),
        meta={"target": "display_slide_reorder", "count": len(requested)},
    )
    await db.commit()


@router.patch(
    "/{board_id}/slides/{slide_id}",
    response_model=DisplayBoardSlideResponse,
)
async def update_display_board_slide(
    board_id: int,
    slide_id: int,
    body: DisplayBoardSlideUpdate,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """슬라이드 페이지/노출 시간/사용 여부 수정.

    dwell_seconds에 null을 명시하면 보드 기본값을 따르도록 되돌린다.
    """
    board = await _get_board(db, board_id)
    slide = await db.scalar(
        select(DisplayBoardSlide).where(
            DisplayBoardSlide.id == slide_id,
            DisplayBoardSlide.board_id == board_id,
        )
    )
    if slide is None:
        raise NotFoundError("슬라이드를 찾을 수 없습니다.")

    fields = body.model_fields_set
    if "page_name" in fields:
        slide.page_name = body.page_name or None
    if "page_display_name" in fields:
        slide.page_display_name = body.page_display_name or None
    if "dwell_seconds" in fields:
        slide.dwell_seconds = body.dwell_seconds
    if "is_enabled" in fields and body.is_enabled is not None:
        slide.is_enabled = body.is_enabled
    await _touch_board(db, board)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board_id),
        meta={"target": "display_slide_update", "report_id": slide.report_id},
    )
    await db.commit()
    await db.refresh(slide)
    await db.refresh(board)

    report = await db.scalar(select(Report).where(Report.id == slide.report_id))
    if report is None:
        raise NotFoundError("레포트를 찾을 수 없습니다.")
    accessible_ids = await _accessible_view_ids(db, op)
    return _slide_response(slide, report, board=board, accessible_ids=accessible_ids)


@router.delete("/{board_id}/slides/{slide_id}", status_code=204)
async def delete_display_board_slide(
    board_id: int,
    slide_id: int,
    db: SessionDep,
    op=Depends(_require_operator),
):
    """슬라이드 삭제 후 남은 슬라이드의 순서를 0..n-1로 다시 압축한다."""
    board = await _get_board(db, board_id)
    slide = await db.scalar(
        select(DisplayBoardSlide).where(
            DisplayBoardSlide.id == slide_id,
            DisplayBoardSlide.board_id == board_id,
        )
    )
    if slide is None:
        raise NotFoundError("슬라이드를 찾을 수 없습니다.")

    await db.execute(delete(DisplayBoardSlide).where(DisplayBoardSlide.id == slide_id))
    remaining = (
        await db.execute(
            select(DisplayBoardSlide)
            .where(DisplayBoardSlide.board_id == board_id)
            .order_by(DisplayBoardSlide.sort_order, DisplayBoardSlide.id)
        )
    ).scalars().all()
    for sort_order, item in enumerate(remaining):
        item.sort_order = sort_order
    await _touch_board(db, board)

    await append_audit(
        db, action=AuditAction.ADMIN_SETTING_CHANGE, result="success",
        actor_user_id=op.get("user_id"), actor_label=op.get("emp_no"),
        resource_type="display_board", resource_id=str(board_id),
        meta={"target": "display_slide_delete"},
    )
    await db.commit()
