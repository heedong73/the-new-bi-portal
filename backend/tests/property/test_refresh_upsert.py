"""Feature: the-new-bi-portal, Property 5 & 6: Refresh upsert 멱등성 + UTC↔Local.

Property 5: 동일 (workspace_id, dataset_id, request_id) 시퀀스 적용 후 row는 1개,
            마지막 값으로 갱신.
Property 6: to_utc(to_local(t)) == t, local은 utc의 동일 절대 순간.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, func

from app.core.timezone import to_local, to_utc, compute_time_columns
from app.models.refresh import RefreshRun

def _uid() -> str:
    return uuid.uuid4().hex[:12]

# ===== Property 5: upsert 멱등성 =====
@pytest.mark.asyncio
async def test_refresh_run_upsert_idempotent(db):
    """같은 key로 여러 번 upsert해도 row 1개, 마지막 status로 갱신."""
    from app.services.powerbi.collector import upsert_refresh_run

    ws_id = _uid()
    ds_id = _uid()
    req_id = _uid()
    now = datetime.now(tz=timezone.utc)

    base_row = {
        "workspace_id": ws_id, "dataset_id": ds_id, "request_id": req_id,
        "status": "Unknown", "start_time_utc": now, "end_time_utc": None,
        "start_time_local": None, "end_time_local": None,
        "duration_seconds": None, "error_message": None, "raw_json": {},
    }

    # 3번 upsert (상태 진행 시뮬레이션)
    for status in ["Unknown", "Unknown", "Completed"]:
        row = {**base_row, "status": status}
        await upsert_refresh_run(db, row)
    await db.flush()

    count = await db.scalar(
        select(func.count()).select_from(RefreshRun).where(
            RefreshRun.workspace_id == ws_id,
            RefreshRun.dataset_id == ds_id,
            RefreshRun.request_id == req_id,
        )
    )
    assert count == 1

    run = await db.scalar(
        select(RefreshRun).where(
            RefreshRun.workspace_id == ws_id,
            RefreshRun.dataset_id == ds_id,
            RefreshRun.request_id == req_id,
        )
    )
    assert run.status == "Completed"

# ===== Property 6: UTC↔Local round-trip =====
@pytest.mark.parametrize("year,month,day,hour", [
    (2024, 1, 1, 0), (2024, 6, 15, 12), (2024, 12, 31, 23),
])
def test_utc_local_roundtrip(year, month, day, hour):
    """to_utc(to_local(t)) == t (Property 6)."""
    t = datetime(year, month, day, hour, tzinfo=timezone.utc)
    assert to_utc(to_local(t)).replace(microsecond=0) == t.replace(microsecond=0)

def test_compute_time_columns_local_equals_utc_instant():
    """start_time_local.astimezone(UTC) == start_time_utc (Property 6)."""
    utc_time = datetime(2024, 6, 15, 3, 0, 0, tzinfo=timezone.utc)
    cols = compute_time_columns(utc_time, None)
    assert cols["start_time_utc"] == utc_time
    assert cols["start_time_local"].astimezone(timezone.utc) == utc_time
