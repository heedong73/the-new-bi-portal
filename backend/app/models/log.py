from datetime import datetime
from sqlalchemy import String, BigInteger, Text, Index, func
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
    status: Mapped[str] = mapped_column(String(16), default="received", nullable=False)
    operator_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
