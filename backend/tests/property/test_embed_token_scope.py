"""Feature: the-new-bi-portal, Property 3: Embed Token 범위 + master 비노출.

- 권한 없는 (user, report) → has_permission False (라우트에서 403).
- 권한 있으면 → 그 report_id 한정 EmbedInfo 발급.
- 어떤 경우에도 EmbedInfo 직렬화에 master token/client_secret/Azure 자격증명 미포함.
"""
from __future__ import annotations

import json
import uuid

import pytest

from app.core.config import settings
from app.core.constants import PermissionAction, SubjectType
from app.models.auth import User
from app.models.report import Workspace, Report, ReportPermission
from app.services import permission_service
from app.services.powerbi.embed_service import get_embed_info
from app.services.powerbi.token_service import MockTokenService

def _uid() -> str:
    return uuid.uuid4().hex[:12]

@pytest.mark.asyncio
@pytest.mark.parametrize("has_view", [True, False])
async def test_embed_permission_and_scope(db, has_view):
    """권한 유무에 따른 발급 가부 + master 비노출 (Property 3)."""
    user = User(external_id=_uid(), name="u", is_active=True)
    db.add(user)
    ws_id = _uid()
    db.add(Workspace(workspace_id=ws_id, workspace_name="ws"))
    await db.flush()
    report = Report(workspace_id=ws_id, report_id=_uid(), report_name="r", is_published=True)
    db.add(report)
    await db.flush()

    if has_view:
        db.add(ReportPermission(report_id=report.id, subject_type=SubjectType.USER,
                                subject_id=user.id, permission=PermissionAction.VIEW))
        await db.flush()

    allowed = await permission_service.has_permission(
        db, user.id, report.id, PermissionAction.VIEW
    )
    assert allowed == has_view

    if allowed:
        info = await get_embed_info(MockTokenService(), ws_id, report.report_id, None)
        # 요청한 report에 한정
        assert info.report_id == report.report_id
        # master/secret 비노출 검증
        serialized = json.dumps(info.__dict__)
        assert "mock-powerbi-access-token" not in serialized
        secret_val = settings.AZURE_CLIENT_SECRET.get_secret_value()
        if secret_val:
            assert secret_val not in serialized
        assert "client_secret" not in serialized.lower()
