"""PBIX Import Worker task — 업로드 PBIX를 Power BI에 게시 후 카탈로그 반영.

흐름: POST imports → 상태 polling → 성공 시 reports/workspace upsert.
mock 모드: 외부 호출 없이 성공 시뮬레이션.
Import 진행 상태는 Celery result backend(task_id=importId)로 추적.
새로고침 필요 레포트는 "게이트웨이 설정 필요" 안내를 결과에 포함.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx
import redis.asyncio as aioredis
from sqlalchemy import select, func

from app.core.config import settings
from app.core.constants import AuditAction, PermissionAction, SubjectType
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal
from app.models.auth import User
from app.models.report import Report, Workspace, ReportPermission
from app.services.audit_service import append_audit, build_audit_snapshot
from app.services.powerbi.token_service import MockTokenService, TokenService
from app.workers.async_runner import run_async
from app.workers.celery_app import celery_app

logger = get_logger(__name__)

_IMPORT_POLL_INTERVAL_SEC = 3
_IMPORT_POLL_TIMEOUT_SEC = 300

async def _apply_catalog(workspace_id: str, report_id: str, dataset_id: str | None,
                         report_name: str | None, folder_id: int | None,
                         description: str | None = None,
                         author_label: str | None = None,
                         created_by_user_id: int | None = None,
                         created_by_label: str | None = None,
                         requested_by_user_id: int | None = None,
                         requested_by_label: str | None = None,
                         replace_report_pk: int | None = None) -> dict[str, Any]:
    """workspace upsert + report 신규/갱신 (nameConflict=CreateOrOverwrite 의미)."""
    async with AsyncSessionLocal() as db:
        ws = await db.scalar(select(Workspace).where(Workspace.workspace_id == workspace_id))
        if ws is None:
            db.add(Workspace(workspace_id=workspace_id, workspace_name=workspace_id))
            await db.flush()

        report = await db.scalar(
            select(Report).where(
                Report.workspace_id == workspace_id, Report.report_id == report_id
            )
        )
        if report is None:
            report = Report(
                workspace_id=workspace_id, report_id=report_id, dataset_id=dataset_id,
                report_name=report_name, folder_id=folder_id, is_published=True,
                published_at=func.now(),
                description=description, author_label=author_label,
                created_by_user_id=created_by_user_id, created_by_label=created_by_label,
            )
            db.add(report)
            await db.flush()
            created = True
        else:
            report.dataset_id = dataset_id
            report.report_name = report_name
            report.is_published = True
            report.published_at = func.now()
            if description is not None:
                report.description = description
            if author_label is not None:
                report.author_label = author_label
            created = False

        # 작성자 통계 권한은 신규/재시도 모두 멱등 보장한다.
        if created_by_user_id is not None:
            # 직접 사용자 권한 교체와 같은 사용자 행을 잠가 자동 부여를 직렬화한다.
            creator_exists = await db.scalar(
                select(User.id).where(User.id == created_by_user_id).with_for_update()
            )
            if creator_exists is not None:
                permission = await db.scalar(select(ReportPermission).where(
                    ReportPermission.report_id == report.id,
                    ReportPermission.subject_type == SubjectType.USER.value,
                    ReportPermission.subject_id == created_by_user_id,
                    ReportPermission.permission == PermissionAction.VIEW_STATS.value,
                ))
                if permission is None:
                    db.add(ReportPermission(
                        report_id=report.id,
                        subject_type=SubjectType.USER.value,
                        subject_id=created_by_user_id,
                        permission=PermissionAction.VIEW_STATS.value,
                    ))

        await db.flush()
        actor_user_id = requested_by_user_id
        snapshot = await build_audit_snapshot(
            db, actor_user_id=actor_user_id, report=report,
        )
        # 교체 작업은 사용자가 누른 원본 레포트의 교체 이력으로 남긴다. 그래야 레포트
        # 화면에서 "직전 교체"를 그 레포트 기준으로 정확히 조회할 수 있다.
        is_replace = replace_report_pk is not None
        await append_audit(
            db,
            action=AuditAction.REPORT_CREATE if created else AuditAction.REPORT_UPDATE,
            result="success",
            actor_user_id=actor_user_id,
            actor_label=requested_by_label or created_by_label,
            resource_type="report",
            resource_id=str(replace_report_pk if is_replace else report.id),
            event_key=f"report-create:{report.id}" if created else None,
            meta={
                "report_id": report.id,
                "workspace_id": workspace_id,
                "target": "replace_pbix" if is_replace else "pbix_import",
            },
            **snapshot,
        )
        await db.commit()
        return {"report_pk": report.id, "created": created}

async def _record_replace_failure(
    report_pk: int,
    actor_user_id: int | None,
    actor_label: str | None,
    reason: str,
) -> None:
    """교체 실패를 최종 상태로 기록한다.

    접수(accepted) 이벤트만 남으면 게시가 끝난 것으로 오해할 수 있으므로 실패도
    같은 target으로 남겨 마지막 성공 이력과 구분한다.
    """
    async with AsyncSessionLocal() as db:
        report = await db.scalar(select(Report).where(Report.id == report_pk))
        if report is None:
            return
        snapshot = await build_audit_snapshot(
            db, actor_user_id=actor_user_id, report=report,
        )
        await append_audit(
            db,
            action=AuditAction.REPORT_UPDATE,
            result="failed",
            actor_user_id=actor_user_id,
            actor_label=actor_label,
            resource_type="report",
            resource_id=str(report_pk),
            meta={
                "report_id": report_pk,
                "target": "replace_pbix",
                "reason": reason[:200],
            },
            **snapshot,
        )
        await db.commit()


def _record_replace_failure_if_needed(
    report_pk: int | None,
    actor_user_id: int | None,
    actor_label: str | None,
    reason: str,
) -> None:
    """교체 작업일 때만 실패를 기록한다. 감사 기록 실패가 원래 오류를 가리지 않게 한다."""
    if report_pk is None:
        return
    try:
        run_async(_record_replace_failure(report_pk, actor_user_id, actor_label, reason))
    except Exception:  # noqa: BLE001 - 원래 예외를 보존해야 한다
        logger.warning("replace_failure_audit_failed", report_pk=report_pk)


async def _powerbi_import_live(file_path: str, workspace_id: str, dataset_display_name: str,
                               name_conflict: str) -> dict[str, Any]:
    """live Power BI Import API: POST imports(multipart) → GET imports/{id} 폴링."""
    # 워커는 asyncio.run()으로 매 호출 새 이벤트 루프를 쓰므로, 전역 redis_client(이전 루프
    # 바인딩) 재사용 시 'Event loop is closed'가 발생한다. 현재 루프 전용 redis를 새로 만든다.
    if settings.APP_MODE == "mock":
        token_service = MockTokenService()
        redis = None
    else:
        redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        token_service = TokenService(settings=settings, redis=redis)
    try:
        token = await token_service.get_token()
        base = settings.POWERBI_API_BASE_URL.rstrip("/")
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=120.0, write=120.0, pool=120.0),
            verify=settings.POWERBI_VERIFY_SSL,
        ) as client:
            # 1) 업로드 (multipart). datasetDisplayName 은 .pbix 확장자 포함 권장.
            with open(file_path, "rb") as fh:
                files = {"file": (dataset_display_name, fh, "application/octet-stream")}
                resp = await client.post(
                    f"{base}/groups/{workspace_id}/imports",
                    params={"datasetDisplayName": dataset_display_name,
                            "nameConflict": name_conflict},
                    headers=headers,
                    files=files,
                )
            if resp.status_code >= 400:
                return {"status": "Failed", "reason": f"import 요청 실패 (HTTP {resp.status_code}): {resp.text[:200]}"}
            import_id = resp.json().get("id")
            if not import_id:
                return {"status": "Failed", "reason": "importId를 받지 못했습니다."}

            # 2) 폴링
            deadline = time.monotonic() + _IMPORT_POLL_TIMEOUT_SEC
            while time.monotonic() < deadline:
                await asyncio.sleep(_IMPORT_POLL_INTERVAL_SEC)
                poll = await client.get(f"{base}/groups/{workspace_id}/imports/{import_id}", headers=headers)
                if poll.status_code >= 400:
                    continue
                data = poll.json()
                state = data.get("importState")
                if state == "Succeeded":
                    reports = data.get("reports") or []
                    datasets = data.get("datasets") or []
                    return {
                        "status": "Succeeded",
                        "report_id": reports[0]["id"] if reports else None,
                        "dataset_id": datasets[0]["id"] if datasets else None,
                        "report_name": reports[0].get("name") if reports else dataset_display_name,
                    }
                if state == "Failed":
                    return {"status": "Failed", "reason": "Power BI import 실패", "detail": data.get("error")}
            return {"status": "Failed", "reason": "import 폴링 타임아웃"}
    finally:
        if redis is not None:
            await redis.aclose()


def _powerbi_import(file_path: str, workspace_id: str, dataset_display_name: str,
                    name_conflict: str) -> dict[str, Any]:
    """Power BI Import 실행. mock 모드는 외부 호출 없이 시뮬레이션."""
    if settings.APP_MODE == "mock":
        return {
            "status": "Succeeded",
            "report_id": f"mock-report-{abs(hash(file_path)) % 100000}",
            "dataset_id": f"mock-dataset-{abs(hash(file_path)) % 100000}",
            "report_name": dataset_display_name,
        }
    return run_async(_powerbi_import_live(file_path, workspace_id, dataset_display_name, name_conflict))

@celery_app.task(name="bip.pbix_import")
def pbix_import(
    file_path: str,
    workspace_id: str,
    report_name: str | None = None,
    folder_id: int | None = None,
    name_conflict: str = "CreateOrOverwrite",
    description: str | None = None,
    author_label: str | None = None,
    created_by_user_id: int | None = None,
    created_by_label: str | None = None,
    requested_by_user_id: int | None = None,
    requested_by_label: str | None = None,
    replace_report_pk: int | None = None,
) -> dict[str, Any]:
    """PBIX import 작업 진입점 (Celery sync task). 업로드→게시→카탈로그 반영.

    replace_report_pk가 있으면 기존 레포트 교체 작업으로 보고, 최종 성공/실패를 그
    레포트의 교체 이력(meta.target=replace_pbix)으로 남긴다.
    """
    display_name = report_name or "uploaded-report"
    if not display_name.lower().endswith(".pbix"):
        display_name = f"{display_name}.pbix"

    try:
        result = _powerbi_import(file_path, workspace_id, display_name, name_conflict)
    except Exception as exc:
        # 예외로 끝나도 접수(accepted)만 남으면 교체된 것으로 오해할 수 있다.
        _record_replace_failure_if_needed(
            replace_report_pk, requested_by_user_id, requested_by_label,
            f"{type(exc).__name__}: {exc}",
        )
        raise
    finally:
        # 임시 업로드 파일 정리
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError:
            pass

    if result.get("status") != "Succeeded":
        reason = result.get("reason") or result.get("status") or "unknown"
        _record_replace_failure_if_needed(
            replace_report_pk, requested_by_user_id, requested_by_label, str(reason),
        )
        return {"status": "Failed", "reason": reason}

    try:
        catalog = run_async(_apply_catalog(
            workspace_id=workspace_id,
            report_id=result["report_id"],
            dataset_id=result.get("dataset_id"),
            report_name=report_name or result.get("report_name"),
            folder_id=folder_id,
            description=description,
            author_label=author_label,
            created_by_user_id=created_by_user_id,
            created_by_label=created_by_label,
            requested_by_user_id=requested_by_user_id,
            requested_by_label=requested_by_label,
            replace_report_pk=replace_report_pk,
        ))
    except Exception as exc:
        # Power BI 게시는 됐지만 카탈로그/감사 반영이 실패한 경우. 성공으로 남기면
        # 교체 이력이 실제 상태와 어긋나므로 실패로 기록한다.
        _record_replace_failure_if_needed(
            replace_report_pk, requested_by_user_id, requested_by_label,
            f"catalog {type(exc).__name__}: {exc}",
        )
        raise

    return {
        "status": "Succeeded",
        "report_id": result["report_id"],
        "dataset_id": result.get("dataset_id"),
        "report_pk": catalog["report_pk"],
        "created": catalog["created"],
        "notice": "데이터셋 자격증명/게이트웨이 설정이 별도로 필요할 수 있습니다.",
    }
