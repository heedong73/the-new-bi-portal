from datetime import datetime
from datetime import date as date_type
from sqlalchemy import (
    String, Boolean, BigInteger, Integer, Text, Date, ForeignKey,
    UniqueConstraint, CheckConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base

SCHEMA = "bip"

class MailSchedule(Base):
    __tablename__ = "mail_schedules"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.reports.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subject_template: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 보내는 사람(From) 주소. 비우면 서버 기본값(settings.SMTP_FROM) 사용.
    sender_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body_header: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_footer: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_width: Mapped[str | None] = mapped_column(String(32), nullable=True)
    image_resize_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cron_expr: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # 사용자 친화 스케줄 입력 (cron_expr 는 이로부터 파생 저장)
    schedule_freq: Mapped[str | None] = mapped_column(String(16), nullable=True)  # daily/weekly/monthly
    schedule_time: Mapped[str | None] = mapped_column(String(8), nullable=True)   # 'HH:MM'
    schedule_days: Mapped[str | None] = mapped_column(String(32), nullable=True)  # weekly: cron 요일 CSV '1,3,5'
    schedule_day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)  # monthly: 1~31
    start_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)  # 발송 시작일(이전엔 발송 안 함)
    end_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)    # 발송 종료일(이후엔 발송 안 함)
    export_format: Mapped[str] = mapped_column(String(16), default="PNG", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 발송 제외 정책 (T-공휴일): 주말/공휴일에는 발송하지 않음 (스케줄별 on/off)
    skip_weekends: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    skip_holidays: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

class MailRecipient(Base):
    __tablename__ = "mail_recipients"
    __table_args__ = (
        UniqueConstraint("mail_schedule_id", "recipient_type", "recipient_id", "email"),
        CheckConstraint(
            "(recipient_type = 'EMAIL' AND email IS NOT NULL AND recipient_id IS NULL) "
            "OR (recipient_type <> 'EMAIL' AND recipient_id IS NOT NULL AND email IS NULL)",
            name="ck_mail_recipient_type",
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mail_schedule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.mail_schedules.id", ondelete="CASCADE"), nullable=False
    )
    recipient_type: Mapped[str] = mapped_column(String(16), nullable=False)
    recipient_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

class MailSchedulePage(Base):
    __tablename__ = "mail_schedule_pages"
    __table_args__ = (
        UniqueConstraint("mail_schedule_id", "page_name"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mail_schedule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.mail_schedules.id", ondelete="CASCADE"), nullable=False
    )
    page_name: Mapped[str] = mapped_column(String(255), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_width_override: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class MailJob(Base):
    __tablename__ = "mail_jobs"
    __table_args__ = (
        UniqueConstraint("mail_schedule_id", "run_key"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mail_schedule_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{SCHEMA}.mail_schedules.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_key: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ExportJob(Base):
    __tablename__ = "export_jobs"
    __table_args__ = (
        UniqueConstraint("mail_job_id", "page_name"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mail_job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.mail_jobs.id", ondelete="CASCADE"), nullable=True
    )
    page_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    export_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # --- standalone export (T-25): mail_job_id가 NULL인 직접 Export 요청 ---
    requested_by_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    report_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.reports.id", ondelete="CASCADE"), nullable=True
    )
    workspace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    export_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ReportImagePath(Base):
    __tablename__ = "report_image_paths"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mail_job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.mail_jobs.id", ondelete="CASCADE"), nullable=True
    )
    export_job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.export_jobs.id"), nullable=True
    )
    page_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    variant: Mapped[str] = mapped_column(String(16), default="original", nullable=False)
    image_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    width_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
