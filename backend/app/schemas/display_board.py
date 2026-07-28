"""KPI 전광판 I/O 스키마.

노출 시간 하한(MIN_DWELL_SECONDS)은 Power BI 임베드 렌더 시간을 고려한 값이다.
너무 짧으면 레포트가 그려지기 전에 다음 슬라이드로 넘어가 전광판이 깜빡이는 화면만
반복하게 된다. 상한은 하루 종일 한 화면에 머무는 오설정을 막기 위한 값이다.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

MIN_DWELL_SECONDS = 5
MAX_DWELL_SECONDS = 3600
DEFAULT_DWELL_SECONDS = 30

# 한 전광판이 담을 수 있는 슬라이드 수 상한(무한 증가로 재생/관리가 무의미해지는 것 방지).
MAX_SLIDES_PER_BOARD = 50
# 전체 전광판 수 상한.
MAX_BOARDS = 100


class DisplayBoardCreate(BaseModel):
    """전광판 생성."""
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=300)
    default_dwell_seconds: int = Field(
        default=DEFAULT_DWELL_SECONDS, ge=MIN_DWELL_SECONDS, le=MAX_DWELL_SECONDS
    )


class DisplayBoardUpdate(BaseModel):
    """전광판 수정 (부분). 전달된 필드만 반영한다."""
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None
    default_dwell_seconds: int | None = Field(
        default=None, ge=MIN_DWELL_SECONDS, le=MAX_DWELL_SECONDS
    )


class DisplayBoardSlideCreate(BaseModel):
    """슬라이드 추가. page_name이 없으면 레포트 기본 페이지를 표시한다."""
    report_id: int
    page_name: str | None = Field(default=None, max_length=255)
    page_display_name: str | None = Field(default=None, max_length=255)
    dwell_seconds: int | None = Field(
        default=None, ge=MIN_DWELL_SECONDS, le=MAX_DWELL_SECONDS
    )


class DisplayBoardSlideUpdate(BaseModel):
    """슬라이드 수정 (부분).

    page/dwell은 "값 없음(보드 기본값·기본 페이지 사용)"으로 되돌릴 수 있어야 하므로
    필드 존재 여부(model_fields_set)로 판단한다 — None 전달은 명시적 초기화를 뜻한다.
    """
    page_name: str | None = Field(default=None, max_length=255)
    page_display_name: str | None = Field(default=None, max_length=255)
    dwell_seconds: int | None = Field(
        default=None, ge=MIN_DWELL_SECONDS, le=MAX_DWELL_SECONDS
    )
    is_enabled: bool | None = None


class DisplayBoardSlideReorder(BaseModel):
    """해당 전광판의 모든 슬라이드 id를 표시 순서대로 전달."""
    slide_ids: list[int] = Field(default_factory=list, max_length=MAX_SLIDES_PER_BOARD)


class DisplayBoardSlideResponse(BaseModel):
    """슬라이드 응답."""
    id: int
    report_id: int
    report_name: str
    page_name: str | None = None
    page_display_name: str | None = None
    # 실제 적용되는 노출 시간(개별 지정이 없으면 보드 기본값).
    effective_dwell_seconds: int
    # 개별 지정값. None이면 보드 기본값을 따른다는 뜻.
    dwell_seconds: int | None = None
    sort_order: int
    is_enabled: bool
    # 현재 사용자가 이 레포트를 볼 권한이 있는지. 관리 화면에서 경고 표시에 사용한다.
    is_accessible: bool = True


class DisplayBoardResponse(BaseModel):
    """전광판 응답. slides는 상세/관리 조회에서만 채운다."""
    id: int
    name: str
    description: str | None = None
    is_active: bool
    default_dwell_seconds: int
    slide_count: int = 0
    # 현재 사용자가 실제로 재생할 수 있는(권한 있고 활성인) 슬라이드 수.
    playable_slide_count: int = 0
    # 전체 순환 1회에 걸리는 시간(초).
    total_cycle_seconds: int = 0
    slides: list[DisplayBoardSlideResponse] = Field(default_factory=list)
    created_by_label: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DisplayBoardEmbedResponse(BaseModel):
    """전광판 재생용 Embed 정보.

    레포트 뷰(`/api/reports/{id}/embed`)와 달리 report_view 감사 로그를 남기지 않는다 —
    전광판은 무인 순환 표시라 사용자 조회수로 집계하면 통계가 왜곡된다.
    프런트 EmbedInfo 타입과 맞추기 위해 camelCase를 사용한다.
    """
    reportId: str
    embedUrl: str
    embedToken: str
    expiry: str | None = None
