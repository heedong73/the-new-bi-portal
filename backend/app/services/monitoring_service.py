"""운영 상태 모니터링 집계.

애플리케이션 구성요소 상태와 최근 작업을 운영자가 바로 이해할 수 있는 형태로
정규화한다. 기술 ID는 로그 대조용 보조 정보로 남기고, 화면의 주 식별자는
데이터셋·레포트·메일 스케줄 이름을 사용한다.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import aiosmtplib
import httpx
from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import ExportStatus, MailJobStatus, RefreshStatus
from app.core.logging import get_logger
from app.core.timezone import local_isoformat
from app.models.mail import ExportJob, MailJob, MailSchedule, MailSchedulePage
from app.models.refresh import RefreshRun
from app.models.report import Dataset, Report
from app.services.powerbi.token_service import TokenService
from app.workers.celery_app import celery_app

logger = get_logger(__name__)

_RECENT_LIMIT = 5
_FAILURE_WINDOW_HOURS = 24
_WORKER_TIMEOUT_SECONDS = 1.0
_DEFAULT_CELERY_QUEUE = "celery"

# Beat가 30초마다 이 키를 갱신한다. 90초를 넘기면 예약 경로 이상으로 판단한다.
SCHEDULER_HEARTBEAT_KEY = "bip:monitoring:scheduler-heartbeat"
SCHEDULER_HEARTBEAT_TTL_SECONDS = 300
SCHEDULER_STALE_SECONDS = 90

# 외부 Power BI 상태 확인은 화면 폴링(15초)마다 호출하지 않고 60초 캐시한다.
_POWERBI_HEALTH_CACHE_KEY = "bip:monitoring:powerbi-health"
_POWERBI_HEALTH_CACHE_SECONDS = 60
_POWERBI_HEALTH_TIMEOUT_SECONDS = 8.0

# SMTP는 연결만 확인하되 메일 서버 부하와 접속 로그 증가를 막기 위해 5분 캐시한다.
_SMTP_HEALTH_CACHE_KEY = "bip:monitoring:smtp-health"
_SMTP_HEALTH_CACHE_SECONDS = 300
_SMTP_HEALTH_TIMEOUT_SECONDS = 5.0

# API 프로세스 기동 시각. 배포·재시작 시점을 운영 상태에서 확인한다.
PROCESS_STARTED_AT = datetime.now(timezone.utc)


def _report_label(report: Report | None) -> str | None:
    if report is None:
        return None
    return report.display_name or report.report_name or f"레포트 #{report.id}"


def _duration_seconds(started: datetime | None, finished: datetime | None) -> int | None:
    if started is None or finished is None:
        return None
    # 두 컬럼은 같은 테이블 정책을 따르므로 naive/aware 여부만 서로 맞춰 계산한다.
    if started.tzinfo is None and finished.tzinfo is not None:
        started = started.replace(tzinfo=timezone.utc)
    elif started.tzinfo is not None and finished.tzinfo is None:
        finished = finished.replace(tzinfo=timezone.utc)
    return max(0, int((finished - started).total_seconds()))


def _local_iso(value: datetime | None) -> str | None:
    return local_isoformat(value) if value is not None else None


async def worker_status(timeout_sec: float = _WORKER_TIMEOUT_SECONDS) -> dict[str, Any]:
    """Celery Worker 응답 수·노드명·실행 중 작업 수를 반환한다.

    active 조회 실패가 Worker 생존 판정을 뒤집지는 않는다. ping 응답이 있으면 Worker는
    정상이고, 실행 작업 수만 확인 불가(None)로 둔다.
    """

    def _inspect() -> tuple[list[dict[str, Any]], dict[str, list[Any]] | None]:
        try:
            replies = celery_app.control.ping(timeout=timeout_sec) or []
        except Exception:  # noqa: BLE001 - broker 장애는 unavailable로 정규화
            return [], None
        try:
            active = celery_app.control.inspect(timeout=timeout_sec).active() or {}
        except Exception:  # noqa: BLE001 - 상세 조회만 실패할 수 있음
            active = None
        return replies, active

    try:
        replies, active = await asyncio.wait_for(
            asyncio.to_thread(_inspect), timeout=(timeout_sec * 2) + 3.0
        )
    except (asyncio.TimeoutError, Exception):  # noqa: BLE001
        logger.warning("worker_status_failed", exc_info=True)
        return {"ok": False, "count": 0, "worker_ids": [], "active_tasks": None}

    worker_ids = sorted(
        str(worker_id)
        for reply in replies
        for worker_id in reply.keys()
    )
    active_tasks = None if active is None else sum(len(tasks) for tasks in active.values())
    return {
        "ok": bool(worker_ids),
        "count": len(worker_ids),
        "worker_ids": worker_ids,
        "active_tasks": active_tasks,
    }


async def ping_workers(timeout_sec: float = _WORKER_TIMEOUT_SECONDS) -> tuple[bool, int]:
    """기존 호출부 호환용 Worker 가용성 요약."""
    status = await worker_status(timeout_sec)
    return bool(status["ok"]), int(status["count"])


async def scheduler_status(redis: Any) -> dict[str, Any]:
    """Beat → broker → Worker heartbeat의 최근 시각으로 예약 실행 경로를 판정한다."""
    try:
        raw = await redis.get(SCHEDULER_HEARTBEAT_KEY)
    except Exception:  # noqa: BLE001
        return {
            "status": "unknown",
            "last_heartbeat": None,
            "age_seconds": None,
            "message": "Redis 연결 오류로 스케줄러 상태를 확인할 수 없습니다.",
        }
    if not raw:
        return {
            "status": "unavailable",
            "last_heartbeat": None,
            "age_seconds": None,
            "message": "최근 스케줄러 heartbeat가 없습니다.",
        }
    try:
        heartbeat = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if heartbeat.tzinfo is None:
            heartbeat = heartbeat.replace(tzinfo=timezone.utc)
        age = max(0, int((datetime.now(timezone.utc) - heartbeat.astimezone(timezone.utc)).total_seconds()))
    except (TypeError, ValueError):
        return {
            "status": "unknown",
            "last_heartbeat": None,
            "age_seconds": None,
            "message": "스케줄러 heartbeat 형식을 해석할 수 없습니다.",
        }
    stale = age > SCHEDULER_STALE_SECONDS
    return {
        "status": "unavailable" if stale else "ok",
        "last_heartbeat": local_isoformat(heartbeat),
        "age_seconds": age,
        "message": "heartbeat가 지연되고 있습니다." if stale else "예약 작업 실행 경로가 정상입니다.",
    }


async def queue_depth(redis: Any) -> int | None:
    """기본 Celery 큐의 대기 작업 수. Redis 장애 시 None."""
    try:
        return int(await redis.llen(_DEFAULT_CELERY_QUEUE))
    except Exception:  # noqa: BLE001
        return None


async def powerbi_status(redis: Any) -> dict[str, Any]:
    """Azure AD 인증 + Power BI 워크스페이스 읽기 연결을 최대 60초 캐시해 확인한다."""
    now = datetime.now(timezone.utc)
    if settings.APP_MODE == "mock":
        return {
            "status": "mock",
            "checked_at": local_isoformat(now),
            "latency_ms": 0,
            "http_status": None,
            "message": "모의 모드로 외부 Power BI를 호출하지 않습니다.",
        }

    try:
        cached = await redis.get(_POWERBI_HEALTH_CACHE_KEY)
        if cached:
            payload = json.loads(cached)
            if isinstance(payload, dict):
                return payload
    except Exception:  # noqa: BLE001 - 캐시 실패 시 실제 확인을 시도
        pass

    started = time.perf_counter()
    result: dict[str, Any]
    try:
        token = await asyncio.wait_for(
            TokenService(settings=settings, redis=redis).get_token(),
            timeout=_POWERBI_HEALTH_TIMEOUT_SECONDS,
        )
        url = (
            f"{settings.POWERBI_API_BASE_URL.rstrip('/')}"
            f"/groups/{settings.POWERBI_WORKSPACE_ID}"
        )
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(_POWERBI_HEALTH_TIMEOUT_SECONDS),
            verify=settings.POWERBI_VERIFY_SSL,
        ) as client:
            response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        code = response.status_code
        if code < 400:
            status, message = "ok", "Azure 인증과 Power BI 워크스페이스 연결이 정상입니다."
        elif code in (401, 403):
            status, message = "error", f"Power BI 인증 또는 워크스페이스 권한 오류(HTTP {code})입니다."
        elif code == 429:
            status, message = "degraded", "Power BI API 요청 제한(HTTP 429)이 발생했습니다."
        else:
            status, message = "error", f"Power BI API 연결 오류(HTTP {code})입니다."
        result = {
            "status": status,
            "checked_at": local_isoformat(now),
            "latency_ms": latency_ms,
            "http_status": code,
            "message": message,
        }
    except asyncio.TimeoutError:
        result = {
            "status": "error",
            "checked_at": local_isoformat(now),
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "http_status": None,
            "message": "Power BI 연결 확인 시간이 초과됐습니다.",
        }
    except Exception as exc:  # noqa: BLE001 - 운영 화면에는 안전한 요약만 노출
        logger.warning("powerbi_health_failed", error_type=type(exc).__name__)
        result = {
            "status": "error",
            "checked_at": local_isoformat(now),
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "http_status": getattr(exc, "azure_status_code", None),
            "message": "Azure 인증 또는 Power BI API에 연결할 수 없습니다.",
        }

    try:
        await redis.set(
            _POWERBI_HEALTH_CACHE_KEY,
            json.dumps(result, ensure_ascii=False),
            ex=_POWERBI_HEALTH_CACHE_SECONDS,
        )
    except Exception:  # noqa: BLE001
        pass
    return result


def storage_status() -> dict[str, Any]:
    """레포트 이미지·내보내기 파일 저장 경로의 남은 용량을 확인한다.

    용량이 차면 메일 발송과 파일 내보내기가 저장 단계에서 실패하므로, 실패가 발생한
    뒤가 아니라 사용률로 미리 판단할 수 있게 한다. S3 백엔드는 디스크 개념이 없어
    확인 대상이 아니다.
    """
    if settings.STORAGE_BACKEND not in ("local", "nas"):
        return {
            "status": "unknown",
            "backend": settings.STORAGE_BACKEND,
            "path": None,
            "total_bytes": None,
            "used_bytes": None,
            "free_bytes": None,
            "used_percent": None,
            "message": "오브젝트 스토리지는 디스크 사용량 확인 대상이 아닙니다.",
        }

    path = settings.STORAGE_ROOT_PATH
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return {
            "status": "error",
            "backend": settings.STORAGE_BACKEND,
            "path": path,
            "total_bytes": None,
            "used_bytes": None,
            "free_bytes": None,
            "used_percent": None,
            "message": "저장 경로에 접근할 수 없습니다. 마운트 상태를 확인하세요.",
        }

    used_percent = round(usage.used / usage.total * 100, 1) if usage.total else None
    warn = used_percent is not None and used_percent >= settings.STORAGE_WARN_PERCENT
    return {
        "status": "degraded" if warn else "ok",
        "backend": settings.STORAGE_BACKEND,
        "path": path,
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "used_percent": used_percent,
        "message": (
            f"사용률이 임계치({settings.STORAGE_WARN_PERCENT}%)를 넘었습니다."
            if warn else "저장 공간이 충분합니다."
        ),
    }


async def smtp_status(redis: Any) -> dict[str, Any]:
    """메일 서버 연결만 확인한다. 메일은 보내지 않는다.

    계정 잠금 위험을 피하려고 인증은 시도하지 않고 연결과 인사(EHLO)까지만 확인한다.
    STARTTLS가 설정된 경우 협상까지 확인해 실제 발송 경로와 조건을 맞춘다.
    """
    now = datetime.now(timezone.utc)
    if settings.APP_MODE == "mock":
        return {
            "status": "mock",
            "checked_at": local_isoformat(now),
            "host": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "latency_ms": 0,
            "message": "모의 모드로 메일 서버에 연결하지 않습니다.",
        }

    try:
        cached = await redis.get(_SMTP_HEALTH_CACHE_KEY)
        if cached:
            payload = json.loads(cached)
            if isinstance(payload, dict):
                return payload
    except Exception:  # noqa: BLE001 - 캐시 실패 시 실제 확인을 시도
        pass

    started = time.perf_counter()
    client = aiosmtplib.SMTP(
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        start_tls=False,
        timeout=_SMTP_HEALTH_TIMEOUT_SECONDS,
    )
    try:
        await client.connect()
        if settings.SMTP_STARTTLS:
            await client.starttls()
        await client.ehlo()
        result = {
            "status": "ok",
            "checked_at": local_isoformat(now),
            "host": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "message": "메일 서버 연결이 정상입니다.",
        }
    except Exception as exc:  # noqa: BLE001 - 운영 화면에는 안전한 요약만 노출
        logger.warning("smtp_health_failed", error_type=type(exc).__name__)
        result = {
            "status": "error",
            "checked_at": local_isoformat(now),
            "host": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "message": "메일 서버에 연결할 수 없습니다. 예약 메일 발송이 실패합니다.",
        }
    finally:
        try:
            await client.quit()
        except Exception:  # noqa: BLE001 - 연결 실패 시 정리도 실패할 수 있다
            pass

    try:
        await redis.set(
            _SMTP_HEALTH_CACHE_KEY,
            json.dumps(result, ensure_ascii=False),
            ex=_SMTP_HEALTH_CACHE_SECONDS,
        )
    except Exception:  # noqa: BLE001
        pass
    return result


def deployment_info() -> dict[str, Any]:
    """배포 버전과 기동 시각. "언제부터 문제인가"의 기준점을 제공한다."""
    started = PROCESS_STARTED_AT
    uptime = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    return {
        "version": settings.APP_VERSION or None,
        "commit": (settings.GIT_COMMIT or None),
        "started_at": local_isoformat(started),
        "uptime_seconds": uptime,
    }


async def recent_jobs(db: AsyncSession) -> dict[str, list[dict[str, Any]]]:
    """최근 작업을 사람이 읽는 대상명·시각·오류와 함께 반환한다."""
    refresh_rows = (await db.execute(
        select(RefreshRun)
        .order_by(RefreshRun.start_time_utc.desc().nullslast(), RefreshRun.id.desc())
        .limit(_RECENT_LIMIT)
    )).scalars().all()
    mail_rows = (await db.execute(
        select(MailJob).order_by(MailJob.id.desc()).limit(_RECENT_LIMIT)
    )).scalars().all()
    export_rows = (await db.execute(
        select(ExportJob).order_by(ExportJob.id.desc()).limit(_RECENT_LIMIT)
    )).scalars().all()

    # 최근 Export가 예약 메일에서 생성된 경우 그 MailJob도 함께 해석한다.
    export_mail_ids = {int(row.mail_job_id) for row in export_rows if row.mail_job_id is not None}
    export_mail_rows = []
    if export_mail_ids:
        export_mail_rows = (await db.execute(
            select(MailJob).where(MailJob.id.in_(export_mail_ids))
        )).scalars().all()
    all_mail_jobs = {int(row.id): row for row in [*mail_rows, *export_mail_rows]}

    schedule_ids = {int(row.mail_schedule_id) for row in all_mail_jobs.values()}
    schedules: dict[int, MailSchedule] = {}
    if schedule_ids:
        schedules = {
            int(row.id): row
            for row in (await db.execute(
                select(MailSchedule).where(MailSchedule.id.in_(schedule_ids))
            )).scalars().all()
        }

    # 예약 메일 Export는 page_display_name이 없고 내부 섹션 id만 남는다. 사람이 붙인
    # 페이지 설명(caption)이 있으면 그것으로 대체하고, 없으면 페이지 표기를 생략한다.
    page_captions: dict[tuple[int, str], str] = {}
    caption_keys = [
        (int(all_mail_jobs[int(row.mail_job_id)].mail_schedule_id), str(row.page_name))
        for row in export_rows
        if row.mail_job_id is not None
        and int(row.mail_job_id) in all_mail_jobs
        and row.page_name
        and not row.page_display_name
    ]
    if caption_keys:
        caption_rows = (await db.execute(
            select(MailSchedulePage).where(
                tuple_(MailSchedulePage.mail_schedule_id, MailSchedulePage.page_name).in_(
                    list(set(caption_keys))
                )
            )
        )).scalars().all()
        page_captions = {
            (int(row.mail_schedule_id), str(row.page_name)): row.caption
            for row in caption_rows
            if row.caption
        }

    report_ids = {int(row.report_id) for row in export_rows if row.report_id is not None}
    report_ids.update(int(schedule.report_id) for schedule in schedules.values())
    reports_by_id: dict[int, Report] = {}
    if report_ids:
        reports_by_id = {
            int(row.id): row
            for row in (await db.execute(
                select(Report).where(Report.id.in_(report_ids))
            )).scalars().all()
        }

    refresh_keys = {(row.workspace_id, row.dataset_id) for row in refresh_rows}
    datasets: dict[tuple[str, str], Dataset] = {}
    refresh_reports: dict[tuple[str, str], list[str]] = {}
    if refresh_keys:
        datasets = {
            (row.workspace_id, row.dataset_id): row
            for row in (await db.execute(
                select(Dataset).where(
                    tuple_(Dataset.workspace_id, Dataset.dataset_id).in_(list(refresh_keys))
                )
            )).scalars().all()
        }
        linked_reports = (await db.execute(
            select(Report).where(
                tuple_(Report.workspace_id, Report.dataset_id).in_(list(refresh_keys))
            )
        )).scalars().all()
        for report in linked_reports:
            if report.dataset_id is None:
                continue
            key = (report.workspace_id, report.dataset_id)
            label = _report_label(report)
            if label and label not in refresh_reports.setdefault(key, []):
                refresh_reports[key].append(label)

    refresh_items: list[dict[str, Any]] = []
    for row in refresh_rows:
        key = (row.workspace_id, row.dataset_id)
        dataset = datasets.get(key)
        report_names = refresh_reports.get(key, [])
        target_name = (
            (dataset.dataset_name if dataset is not None else None)
            or (report_names[0] if report_names else None)
            or f"데이터셋 …{row.dataset_id[-8:]}"
        )
        detail = None
        if report_names:
            shown = ", ".join(report_names[:2])
            detail = f"연결 레포트: {shown}"
            if len(report_names) > 2:
                detail += f" 외 {len(report_names) - 2}개"
        refresh_items.append({
            "id": row.id,
            "status": row.status,
            "target_name": target_name,
            "target_detail": detail,
            "dataset_id": row.dataset_id,
            "started_at": _local_iso(row.start_time_local or row.start_time_utc),
            "finished_at": _local_iso(row.end_time_local or row.end_time_utc),
            "duration_seconds": row.duration_seconds,
            "error_message": row.error_message,
        })

    mail_items: list[dict[str, Any]] = []
    for row in mail_rows:
        schedule = schedules.get(int(row.mail_schedule_id))
        report = reports_by_id.get(int(schedule.report_id)) if schedule is not None else None
        mail_items.append({
            "id": row.id,
            "status": row.status,
            "target_name": schedule.title if schedule is not None else f"메일 스케줄 #{row.mail_schedule_id}",
            "target_detail": _report_label(report),
            "mail_schedule_id": row.mail_schedule_id,
            "started_at": _local_iso(row.started_at),
            "finished_at": _local_iso(row.finished_at),
            "duration_seconds": _duration_seconds(row.started_at, row.finished_at),
            "retry_count": row.retry_count,
            "error_message": row.failure_reason,
        })

    export_items: list[dict[str, Any]] = []
    for row in export_rows:
        mail_job = all_mail_jobs.get(int(row.mail_job_id)) if row.mail_job_id is not None else None
        schedule = schedules.get(int(mail_job.mail_schedule_id)) if mail_job is not None else None
        report = (
            reports_by_id.get(int(row.report_id))
            if row.report_id is not None
            else reports_by_id.get(int(schedule.report_id)) if schedule is not None else None
        )
        report_name = _report_label(report)
        source = "예약 메일" if schedule is not None else "사용자 다운로드"
        format_label = row.export_format or (schedule.export_format if schedule is not None else None)
        detail_parts = [source]
        if format_label:
            detail_parts.append(str(format_label))
        page_label = row.page_display_name
        if not page_label and schedule is not None and row.page_name:
            page_label = page_captions.get((int(schedule.id), str(row.page_name)))
        if page_label:
            detail_parts.append(str(page_label))
        export_items.append({
            "id": row.id,
            "status": row.status,
            "target_name": report_name or (schedule.title if schedule is not None else f"Export 작업 #{row.id}"),
            "target_detail": " · ".join(detail_parts),
            "report_id": row.report_id,
            "mail_job_id": row.mail_job_id,
            "export_format": format_label,
            "page_name": page_label,
            "started_at": _local_iso(row.created_at),
            "finished_at": _local_iso(row.updated_at) if row.status in (ExportStatus.SUCCEEDED, ExportStatus.FAILED) else None,
            "duration_seconds": (
                _duration_seconds(row.created_at, row.updated_at)
                if row.status in (ExportStatus.SUCCEEDED, ExportStatus.FAILED)
                else None
            ),
            "error_message": row.error_message,
        })

    return {"refresh": refresh_items, "mail": mail_items, "export": export_items}


async def recent_failures(db: AsyncSession) -> dict[str, int]:
    """최근 24시간 내 실패한 정기 작업 수."""
    naive_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        hours=_FAILURE_WINDOW_HOURS
    )
    aware_cutoff = datetime.now(timezone.utc) - timedelta(hours=_FAILURE_WINDOW_HOURS)

    refresh_failed = int(await db.scalar(
        select(func.count()).select_from(RefreshRun).where(
            RefreshRun.status == RefreshStatus.FAILED,
            RefreshRun.start_time_utc >= aware_cutoff,
        )
    ) or 0)
    mail_failed = int(await db.scalar(
        select(func.count()).select_from(MailJob).where(
            MailJob.status == MailJobStatus.FAILED,
            MailJob.started_at >= naive_cutoff,
        )
    ) or 0)
    export_failed = int(await db.scalar(
        select(func.count()).select_from(ExportJob).where(
            ExportJob.status == ExportStatus.FAILED,
            ExportJob.created_at >= naive_cutoff,
        )
    ) or 0)

    return {
        "refresh": refresh_failed,
        "mail": mail_failed,
        "export": export_failed,
    }
