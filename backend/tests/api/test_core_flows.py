"""핵심 통합 테스트 (T-41).

- 로컬 관리자 로그인 성공/실패
- 사용자 비활성화 → 활성 세션 즉시 무효화 (R4.3)
- 폴더 삭제 거부 (하위 폴더/레포트 존재 시 409, R41.5)
"""
from __future__ import annotations

import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.core.deps import get_current_user
from app.db.redis import redis_client
from app.db.session import AsyncSessionLocal, engine
from app.main import app
from app.models.auth import LocalAdmin, User
from app.models.report import ReportFolder
from app.services.auth import session_service
from app.services.auth.local_admin import hash_secret

OPERATOR = {"user_id": 960001, "emp_no": "OP", "name": "운영자",
            "roles": ["System_Operator"], "is_active": True}


@pytest_asyncio.fixture(autouse=True)
async def _cleanup():
    yield
    app.dependency_overrides.pop(get_current_user, None)
    await engine.dispose()
    # redis 공유 클라이언트도 닫아 다음 테스트(새 이벤트 루프)에서 재연결되게 함
    await redis_client.aclose()


def _client(user: dict | None = None) -> AsyncClient:
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_local_admin_login_success_and_failure():
    uname = f"adm_{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        db.add(LocalAdmin(username=uname, password_hash=hash_secret("secret123"), is_active=True))
        await db.commit()
    try:
        async with _client() as c:
            ok = await c.post("/api/auth/local/login",
                              json={"username": uname, "password": "secret123"})
            assert ok.status_code == 200, ok.text
            assert "System_Operator" in ok.json()["user"]["roles"]

            bad = await c.post("/api/auth/local/login",
                               json={"username": uname, "password": "wrong"})
            assert bad.status_code == 401
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(LocalAdmin).where(LocalAdmin.username == uname))
            await db.commit()
        await engine.dispose()


async def test_deactivate_invalidates_sessions():
    # 사용자 + 활성 세션 생성
    async with AsyncSessionLocal() as db:
        u = User(external_id=f"e_{uuid.uuid4().hex[:8]}", name="u", is_active=True)
        db.add(u)
        await db.flush()
        uid = u.id
        await db.commit()

    sid = await session_service.create_session(
        redis_client, uid, {"emp_no": "e", "name": "u", "roles": []}
    )
    assert await session_service.get_session(redis_client, sid) is not None

    try:
        async with _client(OPERATOR) as c:
            r = await c.patch(f"/api/users/{uid}/status", json={"is_active": False})
            assert r.status_code == 200
            assert r.json()["is_active"] is False
        # 비활성화 후 기존 세션은 즉시 무효
        assert await session_service.get_session(redis_client, sid) is None
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(User).where(User.id == uid))
            await db.commit()
        await engine.dispose()


async def test_folder_delete_conflict_409():
    async with AsyncSessionLocal() as db:
        parent = ReportFolder(name=f"p_{uuid.uuid4().hex[:8]}", sort_order=0)
        db.add(parent)
        await db.flush()
        child = ReportFolder(name=f"c_{uuid.uuid4().hex[:8]}", parent_id=parent.id, sort_order=0)
        db.add(child)
        await db.flush()
        parent_id, child_id = parent.id, child.id
        await db.commit()

    try:
        async with _client(OPERATOR) as c:
            r = await c.delete(f"/api/report-folders/{parent_id}")
            assert r.status_code == 409  # 하위 폴더 존재 → 거부
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(ReportFolder).where(ReportFolder.id == child_id))
            await db.execute(delete(ReportFolder).where(ReportFolder.id == parent_id))
            await db.commit()
        await engine.dispose()
