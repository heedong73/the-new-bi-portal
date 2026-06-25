"""공휴일 모델 — 메일 스케줄 발송 제외용 휴일 달력.

national(국가 공휴일) / substitute(대체공휴일) 는 holidays 라이브러리로 시드하고,
company(사내 공휴일) 는 관리자가 직접 입력한다. is_recurring=True 면 매년 같은
월/일에 반복되는 휴일(예: 창립기념일)로 취급한다.
"""
from datetime import date, datetime

from sqlalchemy import String, BigInteger, Boolean, Date, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

SCHEMA = "bip"


class Holiday(Base):
    __tablename__ = "holidays"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    holiday_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # national | substitute | company
    holiday_type: Mapped[str] = mapped_column(String(16), default="company", nullable=False)
    # 매년 같은 월/일 반복 여부 (사내 기념일 등)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
