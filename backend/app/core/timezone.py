from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from app.core.config import settings


def get_app_tz() -> ZoneInfo:
    return ZoneInfo(settings.APP_TIMEZONE)


def to_local(dt: datetime) -> datetime:
    """UTC datetime → APP_TIMEZONE datetime"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(get_app_tz())


def to_utc(dt: datetime) -> datetime:
    """APP_TIMEZONE datetime → UTC datetime"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=get_app_tz())
    return dt.astimezone(timezone.utc)


def now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def now_local() -> datetime:
    return datetime.now(tz=get_app_tz())


def local_isoformat(dt: datetime) -> str:
    """API 응답용 Local_Time 문자열 반환"""
    return to_local(dt).isoformat()

def compute_time_columns(
    start_time: datetime | None, end_time: datetime | None
) -> dict:
    """UTC 시각 쌍으로 이중 시간 컬럼값 + duration 계산.

    refresh_runs의 UTC/Local 이중 컬럼 저장용 (PRM 패턴 계승).
    """
    from datetime import timezone as _tz
    result: dict = {
        "start_time_utc": None,
        "end_time_utc": None,
        "start_time_local": None,
        "end_time_local": None,
        "duration_seconds": None,
    }
    if start_time is not None:
        st = start_time if start_time.tzinfo else start_time.replace(tzinfo=_tz.utc)
        result["start_time_utc"] = st
        result["start_time_local"] = to_local(st)
    if end_time is not None:
        et = end_time if end_time.tzinfo else end_time.replace(tzinfo=_tz.utc)
        result["end_time_utc"] = et
        result["end_time_local"] = to_local(et)
        if start_time is not None:
            delta = et - result["start_time_utc"]
            result["duration_seconds"] = max(0, int(delta.total_seconds()))
    return result
