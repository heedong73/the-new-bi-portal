"""Mail Job Worker task — 메일 스케줄 멀티페이지 Export→ZIP→Image 파이프라인 (T-28).

design.md "메일 발송 시퀀스"(R16.3-16.9) 참조.

흐름(페이지별):
  1. Mail_Job 생성 (status=running)
  2. 스케줄의 mail_schedule_pages 로드 (sort_order 순)
  3. 각 페이지마다 Export_Job 생성 (status=NotStarted)
     - ExportTo 시작 → status=Running, export_id 저장
     - poll_until_done() → Succeeded/Failed
     - result.zip 다운로드 → extracted 해제 → StorageService.save()
     - Report_Image_Path 기록 (variant=original)
     - status=Succeeded
  4. 전체 페이지 성공 → Mail_Job status=succeeded
     일부 실패 → Mail_Job status=failed + failure_reason

NOTE(T-28 범위): 분산 락 / run_key 멱등 처리는 T-31, SMTP 발송은 T-30에서 추가.
mock 모드: 외부 호출 없이 최소 PNG로 성공 시뮬레이션.
"""
from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import ExportStatus, ImageVariant, MailJobStatus
from app.core.errors import PowerBIError
from app.core.logging import get_logger
from app.db.redis import redis_client
from app.db.session import AsyncSessionLocal
from app.models.mail import (
    ExportJob,
    MailJob,
    MailSchedule,
    MailSchedulePage,
    ReportImagePath,
)
from app.models.report import Report
from app.services.powerbi.export_service import (
    download_export_file,
    poll_until_done,
    start_export,
)
from app.services.powerbi.lock import acquire_lock, release_lock
from app.services.powerbi.token_service import MockTokenService, TokenService
from app.services.mail.image_service import resize_png
from app.services.mail.mail_service import MailAttachment, deliver_mail_job
from app.services.mail.recipients import resolve_recipients
from app.services.storage_service import get_storage_service
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

logger = get_logger(__name__)


def _default_run_key() -> str:
    """run_key 미지정 시 UTC 타임스탬프 기반 기본값 (T-31에서 cron 회차 키로 대체)."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _now_naive_utc() -> datetime:
    """naive UTC datetime. mail_jobs 의 TIMESTAMP WITHOUT TIME ZONE 컬럼용."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _get_access_token() -> str:
    """mock/live 모드에 맞는 토큰 서비스로 access token 획득."""
    if settings.APP_MODE == "mock":
        token_service = MockTokenService()
    else:
        token_service = TokenService(settings=settings, redis=redis_client)
    return await token_service.get_token()


async def _export_one_page(
    *,
    access_token: str,
    mail_job_id: int,
    workspace_id: str,
    powerbi_report_id: str,
    report_name: str,
    export_format: str,
    page: MailSchedulePage,
    image_resize_px: int | None = None,
) -> dict[str, Any]:
    """단일 페이지 Export 파이프라인. Export_Job 생성→상태전이→이미지 저장.

    반환: {"page_name", "status", "export_job_id", "error"?}

    NOTE(2단계 예정): result.zip 해제 → StorageService.save → Report_Image_Path 기록
    로직은 _persist_export_images() 헬퍼에서 완성한다. 현재는 상태 전이 골격만.
    """
    # 1) Export_Job 생성 (NotStarted)
    async with AsyncSessionLocal() as db:
        job = ExportJob(
            mail_job_id=mail_job_id,
            page_name=page.page_name,
            status=ExportStatus.NOT_STARTED,
            report_id=None,
            workspace_id=workspace_id,
            export_format=export_format,
        )
        db.add(job)
        await db.flush()
        export_job_id = job.id
        await db.commit()

    # 2) ExportTo 시작 → Running + export_id
    try:
        start_result = await start_export(
            access_token, workspace_id, powerbi_report_id, export_format,
            page_name=page.page_name,
        )
    except Exception as exc:  # noqa: BLE001 - 페이지 단위 실패 격리
        await _mark_export_failed(export_job_id, f"Export 시작 오류: {exc}")
        return {"page_name": page.page_name, "status": "Failed",
                "export_job_id": export_job_id, "error": str(exc)}

    async with AsyncSessionLocal() as db:
        job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
        if job:
            job.status = ExportStatus.RUNNING
            job.export_id = start_result.export_id
            await db.commit()

    # 3) 폴링 → Succeeded/Failed
    try:
        poll_result = await poll_until_done(
            access_token, workspace_id, powerbi_report_id, start_result.export_id,
            poll_interval_sec=settings.EXPORT_POLL_INTERVAL_SEC,
            timeout_sec=settings.EXPORT_POLL_TIMEOUT_SEC,
        )
    except Exception as exc:  # noqa: BLE001
        await _mark_export_failed(export_job_id, f"Export 폴링 오류: {exc}")
        return {"page_name": page.page_name, "status": "Failed",
                "export_job_id": export_job_id, "error": str(exc)}

    if poll_result.status == "Failed":
        await _mark_export_failed(export_job_id, "Power BI Export가 실패 상태로 종료됐습니다.")
        return {"page_name": page.page_name, "status": "Failed",
                "export_job_id": export_job_id, "error": "Power BI Export 실패"}

    # 4) 파일 다운로드 → (2단계) ZIP 해제 + 저장 + Report_Image_Path
    try:
        file_result = await download_export_file(
            access_token, workspace_id, powerbi_report_id, start_result.export_id,
            report_name=report_name, export_format=export_format,
        )
        await _persist_export_images(
            mail_job_id=mail_job_id,
            export_job_id=export_job_id,
            page=page,
            file_name=file_result.file_name,
            content_type=file_result.content_type,
            raw_bytes=file_result.data,
            image_resize_px=image_resize_px,
        )
    except Exception as exc:  # noqa: BLE001
        await _mark_export_failed(export_job_id, f"이미지 저장 오류: {exc}")
        return {"page_name": page.page_name, "status": "Failed",
                "export_job_id": export_job_id, "error": str(exc)}

    async with AsyncSessionLocal() as db:
        job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
        if job:
            job.status = ExportStatus.SUCCEEDED
            await db.commit()

    return {"page_name": page.page_name, "status": "Succeeded",
            "export_job_id": export_job_id}


async def _mark_export_failed(export_job_id: int, message: str) -> None:
    """Export_Job 을 Failed 로 갱신하고 사유를 기록."""
    async with AsyncSessionLocal() as db:
        job = await db.scalar(select(ExportJob).where(ExportJob.id == export_job_id))
        if job:
            job.status = ExportStatus.FAILED
            job.error_message = message
            await db.commit()
    logger.warning("export_job_failed", export_job_id=export_job_id, reason=message)


async def _persist_export_images(
    *,
    mail_job_id: int,
    export_job_id: int,
    page: MailSchedulePage,
    file_name: str,
    content_type: str,
    raw_bytes: bytes,
    image_resize_px: int | None = None,
) -> None:
    """result.zip 해제 → StorageService 저장 → Report_Image_Path 기록.

    Power BI Export 결과는 두 형태:
      - ZIP(result.zip): 여러 페이지 이미지 묶음 → 멤버별로 해제하여 각각 저장
      - 단일 파일(PNG/PDF 등): 그대로 1건 저장
    파일 본체는 StorageService(저장소)에만 두고, DB(Report_Image_Path)에는
    상대 경로/메타만 기록한다(R31.2). variant=original.

    image_resize_px 가 설정되어 있으면(T-29) PNG 멤버를 다운스케일하여
    variant=resized 로 추가 저장한다. 리사이즈 실패/생략 시 원본만 유지.
    """
    images = _extract_images(file_name, content_type, raw_bytes)
    storage = get_storage_service()

    async with AsyncSessionLocal() as db:
        for idx, (member_name, member_mime, member_bytes) in enumerate(images):
            # 1) 원본 저장 (항상)
            rel_path = _image_storage_path(mail_job_id, export_job_id, idx, member_name)
            stored = storage.save(rel_path, member_bytes, member_mime)
            db.add(ReportImagePath(
                mail_job_id=mail_job_id,
                export_job_id=export_job_id,
                page_name=page.page_name,
                variant=ImageVariant.ORIGINAL,
                image_path=stored.relative_path,
                file_name=member_name,
                file_size=stored.size,
                mime_type=member_mime,
            ))

            # 2) 리사이즈본 저장 (PNG + image_resize_px 설정 시, 실패하면 원본 fallback)
            resized = resize_png(
                member_bytes, image_resize_px,
                mime_type=member_mime, file_name=member_name,
            )
            if resized is not None:
                resized_name = _resized_name(member_name)
                resized_rel = _image_storage_path(
                    mail_job_id, export_job_id, idx, resized_name
                )
                resized_stored = storage.save(
                    resized_rel, resized.data, resized.mime_type
                )
                db.add(ReportImagePath(
                    mail_job_id=mail_job_id,
                    export_job_id=export_job_id,
                    page_name=page.page_name,
                    variant=ImageVariant.RESIZED,
                    image_path=resized_stored.relative_path,
                    file_name=resized_name,
                    file_size=resized_stored.size,
                    mime_type=resized.mime_type,
                    width_px=resized.width_px,
                    height_px=resized.height_px,
                ))
        await db.commit()

    logger.info(
        "mail_images_persisted",
        export_job_id=export_job_id,
        page_name=page.page_name,
        image_count=len(images),
        resize_target_px=image_resize_px,
    )


# 이미지로 취급할 확장자 (ZIP 멤버 필터링)
_IMAGE_EXTS: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
}


def _mime_for(name: str, default: str) -> str:
    """파일명 확장자로 MIME 추정. 미지원 확장자는 default."""
    lower = name.lower()
    for ext, mime in _IMAGE_EXTS.items():
        if lower.endswith(ext):
            return mime
    return default


def _extract_images(
    file_name: str, content_type: str, raw_bytes: bytes
) -> list[tuple[str, str, bytes]]:
    """다운로드 바이트를 (이름, MIME, 바이트) 목록으로 정규화한다.

    ZIP(result.zip)이면 내부 멤버를 풀어 이미지 파일만 반환하고,
    그 외에는 단일 파일 1건으로 반환한다. ZIP 내 디렉터리/빈 멤버는 스킵한다.
    """
    if zipfile.is_zipfile(io.BytesIO(raw_bytes)):
        out: list[tuple[str, str, bytes]] = []
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            for info in sorted(zf.infolist(), key=lambda i: i.filename):
                if info.is_dir():
                    continue
                member_name = info.filename.rsplit("/", 1)[-1]
                if not member_name:
                    continue
                data = zf.read(info)
                if not data:
                    continue
                out.append((member_name, _mime_for(member_name, content_type), data))
        if out:
            return out
        # 이미지 멤버가 하나도 없으면 ZIP 자체를 단일 파일로 폴백
    return [(file_name, content_type, raw_bytes)]


def _image_storage_path(
    mail_job_id: int, export_job_id: int, idx: int, file_name: str
) -> str:
    """이미지 저장소 상대 경로: reportimage/{년}/{월}/{mailjob}_{exportjob}_{idx}_{파일명}."""
    now = datetime.now(timezone.utc)
    safe_name = file_name.replace("/", "_").replace("\\", "_")
    return (
        f"reportimage/{now.year}/{now.month:02d}/"
        f"{mail_job_id}_{export_job_id}_{idx}_{safe_name}"
    )


def _resized_name(file_name: str) -> str:
    """리사이즈본 파일명: 원본명에 _resized 접미사 (확장자 유지)."""
    if "." in file_name:
        stem, ext = file_name.rsplit(".", 1)
        return f"{stem}_resized.{ext}"
    return f"{file_name}_resized"


async def _execute_mail_job(mail_schedule_id: int, run_key: str) -> dict[str, Any]:
    """메일 잡 본 파이프라인 (락 획득 후 실행). Mail_Job 생성 → 페이지별 Export → 발송."""

    # 스케줄 + 페이지 로드, Mail_Job 생성
    async with AsyncSessionLocal() as db:
        schedule = await db.scalar(
            select(MailSchedule).where(MailSchedule.id == mail_schedule_id)
        )
        if schedule is None:
            logger.error("mail_schedule_not_found", mail_schedule_id=mail_schedule_id)
            return {"status": "failed", "error": "MailSchedule을 찾을 수 없습니다."}

        report = await db.scalar(select(Report).where(Report.id == schedule.report_id))
        if report is None:
            logger.error("mail_report_not_found", report_id=schedule.report_id)
            return {"status": "failed", "error": "연결된 Report를 찾을 수 없습니다."}

        pages = (
            await db.execute(
                select(MailSchedulePage)
                .where(MailSchedulePage.mail_schedule_id == mail_schedule_id)
                .order_by(MailSchedulePage.sort_order, MailSchedulePage.id)
            )
        ).scalars().all()

        mail_job = MailJob(
            mail_schedule_id=mail_schedule_id,
            run_key=run_key,
            status=MailJobStatus.RUNNING,
            started_at=_now_naive_utc(),
        )
        db.add(mail_job)
        await db.flush()
        mail_job_id = mail_job.id

        # 후속 단계에서 쓸 값들을 세션 종료 전에 추출
        workspace_id = report.workspace_id
        powerbi_report_id = report.report_id
        report_name = report.display_name or report.report_name or "report"
        export_format = schedule.export_format or "PNG"
        image_resize_px = schedule.image_resize_px
        report_id = schedule.report_id
        subject_template = schedule.subject_template
        body_header = schedule.body_header
        body_footer = schedule.body_footer
        schedule_title = schedule.title
        sender_email = schedule.sender_email
        image_width = schedule.image_width
        # 페이지 메타(발송 첨부용): page_name → (caption, 표시폭, sort_order)
        page_meta = {
            p.page_name: (p.caption, p.image_width_override or image_width, p.sort_order)
            for p in pages
        }
        await db.commit()

    if not pages:
        await _finalize_mail_job(mail_job_id, ok=False, reason="선택된 페이지가 없습니다.")
        return {"status": "failed", "mail_job_id": mail_job_id,
                "error": "선택된 페이지가 없습니다."}

    access_token = await _get_access_token()

    # 페이지별 순차 Export (실패 격리)
    results: list[dict[str, Any]] = []
    for page in pages:
        result = await _export_one_page(
            access_token=access_token,
            mail_job_id=mail_job_id,
            workspace_id=workspace_id,
            powerbi_report_id=powerbi_report_id,
            report_name=report_name,
            export_format=export_format,
            page=page,
            image_resize_px=image_resize_px,
        )
        results.append(result)

    failed = [r for r in results if r["status"] != "Succeeded"]
    if failed:
        reason = "; ".join(f"{r['page_name']}: {r.get('error', '실패')}" for r in failed)
        await _finalize_mail_job(mail_job_id, ok=False, reason=reason)
        return {"status": "failed", "mail_job_id": mail_job_id,
                "failed_pages": [r["page_name"] for r in failed], "results": results}

    # 전체 페이지 성공 → 수신자 전개 + 이미지 수집 + 메일 발송 (T-30)
    async with AsyncSessionLocal() as db:
        recipients = await resolve_recipients(db, mail_schedule_id)
        attachments = await _gather_attachments(db, mail_job_id, page_meta)
        sent = await deliver_mail_job(
            db,
            mail_job_id=mail_job_id,
            report_id=report_id,
            report_name=report_name,
            subject_template=subject_template,
            sender_email=sender_email,
            body_header=body_header,
            body_footer=body_footer,
            schedule_title=schedule_title,
            recipients=recipients,
            attachments=attachments,
        )

    if not sent:
        await _finalize_mail_job(mail_job_id, ok=False, reason="메일 발송 실패")
        return {"status": "failed", "mail_job_id": mail_job_id,
                "error": "메일 발송 실패", "results": results}

    await _finalize_mail_job(mail_job_id, ok=True, reason=None)
    return {"status": "succeeded", "mail_job_id": mail_job_id, "results": results}


async def _gather_attachments(
    db: AsyncSession,
    mail_job_id: int,
    page_meta: dict[str, tuple[str | None, str | None, int]],
) -> list[MailAttachment]:
    """Mail_Job 의 저장 이미지를 발송용 첨부로 수집한다.

    페이지별로 리사이즈본(variant=resized)을 우선 사용하고 없으면 원본을 쓴다.
    page_meta 의 sort_order 순으로 정렬하며, 저장소에서 바이트를 읽어 cid 를 부여한다.
    """
    rows = (
        await db.execute(
            select(ReportImagePath)
            .where(ReportImagePath.mail_job_id == mail_job_id)
            .order_by(ReportImagePath.id)
        )
    ).scalars().all()

    # 페이지별로 우선순위(resized > original) 1건 선택
    chosen: dict[str, ReportImagePath] = {}
    for row in rows:
        key = row.page_name or f"_{row.id}"
        cur = chosen.get(key)
        if cur is None:
            chosen[key] = row
        elif cur.variant != ImageVariant.RESIZED and row.variant == ImageVariant.RESIZED:
            chosen[key] = row

    def _sort_key(item: tuple[str, ReportImagePath]) -> tuple[int, int]:
        page_name, row = item
        meta = page_meta.get(page_name)
        order = meta[2] if meta else 0
        return (order, row.id)

    storage = get_storage_service()
    attachments: list[MailAttachment] = []
    for idx, (page_name, row) in enumerate(sorted(chosen.items(), key=_sort_key)):
        try:
            with storage.open(row.image_path) as fh:
                data = fh.read()
        except Exception as exc:  # noqa: BLE001
            logger.warning("attachment_read_failed", path=row.image_path, error=str(exc))
            continue
        meta = page_meta.get(page_name)
        caption = meta[0] if meta else None
        display_width = meta[1] if meta else None
        attachments.append(MailAttachment(
            cid=f"page{idx}",
            data=data,
            mime_subtype="png",
            caption=caption,
            display_width=display_width,
        ))
    return attachments


async def _finalize_mail_job(mail_job_id: int, *, ok: bool, reason: str | None) -> None:
    """Mail_Job 최종 상태 갱신 (succeeded/failed + finished_at + 사유)."""
    async with AsyncSessionLocal() as db:
        job = await db.scalar(select(MailJob).where(MailJob.id == mail_job_id))
        if job:
            job.status = MailJobStatus.SUCCEEDED if ok else MailJobStatus.FAILED
            job.finished_at = _now_naive_utc()
            job.failure_reason = reason
            await db.commit()
    logger.info("mail_job_finalized", mail_job_id=mail_job_id, ok=ok, reason=reason)


async def _run_mail_job(mail_schedule_id: int, run_key: str | None = None) -> dict[str, Any]:
    """메일 잡 진입 래퍼 — 분산 락 + run_key 멱등 처리 (T-31).

    - Redis 락(bip:lock:mail:{mail_schedule_id})으로 동일 스케줄 동시 실행 차단.
      이미 실행 중이면 skip(중복 방지, R16.11/R37).
    - 동일 (mail_schedule_id, run_key) Mail_Job 이 이미 있으면 skip(멱등, 중복 회차 차단).
      DB UNIQUE(mail_schedule_id, run_key) 가 최종 방어선.
    - 본 파이프라인은 _execute_mail_job 에서 수행하고, 락은 finally 로 항상 해제.
    """
    run_key = run_key or _default_run_key()

    lock_value = await acquire_lock(redis_client, "mail", str(mail_schedule_id))
    if lock_value is None:
        logger.info("mail_job_skip_locked", mail_schedule_id=mail_schedule_id)
        return {"status": "skipped", "reason": "locked",
                "mail_schedule_id": mail_schedule_id}

    try:
        # 멱등: 동일 run_key 회차가 이미 있으면 재실행하지 않음
        async with AsyncSessionLocal() as db:
            existing = await db.scalar(
                select(MailJob).where(
                    MailJob.mail_schedule_id == mail_schedule_id,
                    MailJob.run_key == run_key,
                )
            )
            if existing is not None:
                logger.info(
                    "mail_job_skip_duplicate",
                    mail_schedule_id=mail_schedule_id, run_key=run_key,
                    mail_job_id=existing.id,
                )
                return {"status": "skipped", "reason": "duplicate",
                        "mail_job_id": existing.id, "run_key": run_key}

        return await _execute_mail_job(mail_schedule_id, run_key)
    finally:
        await release_lock(redis_client, "mail", str(mail_schedule_id), lock_value)


@celery_app.task(name="bip.mail_job")
def mail_job(mail_schedule_id: int, run_key: str | None = None) -> dict[str, Any]:
    """메일 잡 진입점 (sync Celery task → 지속 루프 러너)."""
    return run_async(_run_mail_job(mail_schedule_id, run_key))
