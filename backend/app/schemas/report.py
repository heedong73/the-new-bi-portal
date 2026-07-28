"""레포트 카탈로그 I/O 스키마."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

class ReportUpdate(BaseModel):
    """레포트 메타데이터 수정 요청 (부분)."""
    display_name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=128)
    author_label: str | None = Field(default=None, max_length=255)
    sort_order: int | None = None

class VisibilityUpdate(BaseModel):
    """공개/비공개 전환 요청."""
    is_published: bool

class FolderMoveRequest(BaseModel):
    """레포트 폴더 이동 요청."""
    folder_id: int | None = None

class DefaultViewUpdate(BaseModel):
    """공통 기본 뷰 상태 저장/초기화 요청.

    state = Power BI 북마크 state 문자열. None/빈 값이면 기본 뷰 해제.
    """
    state: str | None = None

class ExportRequest(BaseModel):
    """독립 Export 요청 (T-25). 포맷: PDF | PNG | PPTX(렌더링) | PBIX(원본 파일)

    페이지 범위:
      - page_name 지정 = 그 페이지 1장만 내보낸다(PDF/PPTX/PNG).
      - page_name 없음 = 레포트 전체를 내보낸다(PDF/PPTX/PNG).
        전체 PNG는 페이지별 이미지가 담긴 ZIP으로 반환될 수 있다.
      - PBIX는 페이지 범위 없이 원본 파일을 내려받는다.

    bookmark_state: 프런트가 `bookmarksManager.capture()`로 캡처한 Power BI 북마크
    state 문자열. 화면의 슬라이서/필터 선택을 내보내기 결과에 반영하기 위해 전달한다.
    비우면 Power BI에 저장된 기본 상태로 렌더링된다.
    """
    export_format: str = Field(default="PDF", pattern="^(PDF|PNG|PPTX|PBIX)$")
    page_name: str | None = Field(default=None, max_length=255)
    # 파일명 표기에만 쓰는 사람이 읽는 페이지 이름(page_name은 내부 섹션 id).
    page_display_name: str | None = Field(default=None, max_length=255)
    bookmark_state: str | None = None
    # 전체 범위에서 내보낼 페이지 순서(레포트에서 숨김 처리한 페이지 제외).
    # 비우면 Power BI가 레포트 전체를 자체 순서로 내보낸다.
    page_names: list[str] | None = None

class FavoriteFolderNameRequest(BaseModel):
    """개인 즐겨찾기 폴더 생성/이름 변경."""
    name: str = Field(min_length=1, max_length=80)


class FavoriteFolderReorderRequest(BaseModel):
    """개인 즐겨찾기 폴더 전체 순서."""
    folder_ids: list[int] = Field(default_factory=list, max_length=100)


class FavoriteFolderMoveRequest(BaseModel):
    """즐겨찾기한 레포트를 개인 폴더로 이동. None이면 미분류."""
    folder_id: int | None = None


class FavoriteFolderResponse(BaseModel):
    """개인 즐겨찾기 폴더."""
    id: int
    name: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ReportResponse(BaseModel):
    """레포트 응답 (목록/상세)."""
    id: int
    workspace_id: str
    report_id: str
    dataset_id: str | None = None
    report_name: str | None = None
    display_name: str | None = None
    description: str | None = None
    category: str | None = None
    folder_id: int | None = None
    sort_order: int = 0
    is_published: bool
    author_label: str | None = None
    updated_at: datetime | None = None
    published_at: datetime | None = None
    folder_path: str | None = None
    root_folder_id: int | None = None
    root_folder_name: str | None = None
    last_viewed_at: datetime | None = None
    view_count: int = 0  # 최근 30일 전체 사용자 조회수
    is_favorite: bool = False
    favorite_folder_id: int | None = None  # 개인 즐겨찾기 폴더. None이면 미분류
    created_by_user_id: int | None = None
    created_by_label: str | None = None
    created_at: datetime | None = None
    can_manage: bool = False  # MANAGE_REPORT 권한(레포트 PBIX 교체 가능) 여부
    can_download: bool = False  # DOWNLOAD 권한(렌더링 파일 내보내기 가능) 여부
    can_download_pbix: bool = False  # DOWNLOAD_PBIX 권한(원본 .pbix 다운로드 가능) 여부
    can_manage_default_view: bool = False  # MANAGE_DEFAULT_VIEW 권한(공통 기본 뷰 저장) 여부
    can_refresh: bool = False  # REFRESH 권한(수동 새로고침 가능) 여부


class ReportCatalogResponse(BaseModel):
    """검색·카테고리·정렬이 적용된 페이지형 레포트 카탈로그."""
    items: list[ReportResponse] = Field(default_factory=list)
    total: int
    limit: int
    offset: int
