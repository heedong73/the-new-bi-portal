"""KPI 전광판(Display Board) 모델.

여러 Power BI 레포트/페이지를 하나의 플레이리스트로 묶어 전체화면에서 일정 시간마다
자동 순환 표시하기 위한 도메인이다.

- DisplayBoard: 전광판(플레이리스트) 본체. 화면별 기본 노출 시간을 가진다.
- DisplayBoardSlide: 순환 단위(레포트 + 선택적 페이지 + 개별 노출 시간 + 순서).

설계 메모:
  * 슬라이드의 dwell_seconds가 NULL이면 보드의 default_dwell_seconds를 사용한다
    (보드 기본값만 바꿔 전체 노출 속도를 일괄 조정할 수 있도록).
  * page_name은 Power BI 내부 섹션 id, page_display_name은 사람이 읽는 이름이다
    (export_jobs와 동일한 구분). NULL이면 레포트 기본 페이지를 표시한다.
  * 레포트가 카탈로그에서 삭제되면 해당 슬라이드도 함께 사라진다(ON DELETE CASCADE) —
    전광판에 깨진 슬라이드가 남지 않게 한다.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, BigInteger, ForeignKey, Index, Integer, String, DateTime, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

SCHEMA = "bip"


class DisplayBoard(Base):
    """전광판(플레이리스트). 이름은 대소문자/공백 정규화 기준으로 중복 불가."""
    __tablename__ = "display_boards"
    __table_args__ = (
        UniqueConstraint("normalized_name", name="uq_display_boards_normalized_name"),
        Index("ix_display_boards_active_name", "is_active", "name"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # 재생 대상에서 임시로 제외할 때 사용(슬라이드 구성을 지우지 않고 숨김).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 슬라이드가 개별 노출 시간을 지정하지 않았을 때 적용할 기본 노출 시간(초).
    default_dwell_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    created_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DisplayBoardSlide(Base):
    """전광판 순환 단위. sort_order 오름차순으로 재생한다."""
    __tablename__ = "display_board_slides"
    __table_args__ = (
        Index("ix_display_board_slides_board_order", "board_id", "sort_order", "id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    board_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{SCHEMA}.display_boards.id", ondelete="CASCADE"),
        nullable=False,
    )
    report_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{SCHEMA}.reports.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Power BI 내부 섹션 id. NULL이면 레포트 기본(첫) 페이지.
    page_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 사람이 읽는 페이지 이름(관리 화면 표기용).
    page_display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # NULL이면 보드의 default_dwell_seconds를 사용.
    dwell_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
