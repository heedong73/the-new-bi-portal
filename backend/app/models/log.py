from datetime import datetime, date
from sqlalchemy import String, BigInteger, Text, Index, ForeignKey, Boolean, Date, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base

SCHEMA = "bip"

class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("idx_audit_occurred_at", "occurred_at_utc"),
        Index("idx_audit_actor", "actor_user_id"),
        Index("idx_audit_action", "action"),
        Index("idx_audit_action_occurred", "action", "occurred_at_utc"),
        Index("idx_audit_resource", "resource_type", "resource_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actor_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at_utc: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # report_view 전용: 프런트가 탭 전환/이탈 시점에 갱신하는 체류 시간(초, 근사치).
    duration_seconds: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # 요청 클라이언트 IP(nginx X-Forwarded-For/X-Real-IP 또는 request.client.host).
    # 감사 목적의 참고값이며, 위조 가능성이 있어 단독 신원 증거로 쓰지 않는다.
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)

class Request(Base):
    __tablename__ = "requests"
    __table_args__ = (
        Index("idx_requests_requester", "requester_id"),
        Index("idx_requests_status", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    requester_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    request_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    operator_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RequestAttachment(Base):
    """서비스 센터 요청 첨부 파일 (에러 캡처/문서 등). 파일 본체는 StorageService에,
    DB에는 상대 경로/메타만 저장한다(R31.2)."""
    __tablename__ = "request_attachments"
    __table_args__ = (
        Index("idx_request_attachments_request", "request_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.requests.id", ondelete="CASCADE"), nullable=False
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    uploaded_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class RequestComment(Base):
    """서비스 센터 요청 댓글 스레드 1건. 요청자/운영자가 메시지를 주고받는다."""
    __tablename__ = "request_comments"
    __table_args__ = (
        Index("idx_request_comments_request", "request_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.requests.id", ondelete="CASCADE"), nullable=False
    )
    author_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    author_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_operator: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class RequestStatusHistory(Base):
    """서비스 센터 요청 상태 변경 이력 (from → to). 생성 시 1건(from=None→pending),
    이후 운영자가 상태를 바꿀 때마다 1건씩 기록한다. 요청 삭제 시 CASCADE."""
    __tablename__ = "request_status_history"
    __table_args__ = (
        Index("idx_request_status_history_request", "request_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.requests.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 생성 시 None
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    changed_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    changed_by_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
