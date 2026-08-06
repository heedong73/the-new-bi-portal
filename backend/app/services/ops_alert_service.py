"""운영 장애 알림 — 구성요소 장애를 감지해 운영자에게 메일로 알린다.

화면을 보고 있지 않아도 장애를 알 수 있게 하는 것이 목적이므로, 알림이 무시되지
않도록 다음 규칙을 지킨다.

- 장애(error) 등급만 보낸다. 주의(degraded)는 화면에서만 표시한다.
- 같은 구성요소의 장애는 ``OPS_ALERT_RESEND_MINUTES`` 안에는 다시 보내지 않는다.
- 정상으로 돌아오면 회복 알림을 한 번 보낸다. 그래야 장애 메일만 남아
  "아직 문제인지" 판단이 안 되는 상황을 피한다.
- 발송 실패는 조용히 넘긴다(알림 실패가 점검 작업을 막지 않는다).

한계: 메일 서버 자체 장애는 이 경로로 전달되지 않는다. 화면과 로그로만 확인된다.
"""
from __future__ import annotations

import html
from email.message import EmailMessage
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.core.timezone import now_local
from app.services.mail.mail_service import send_with_retry

logger = get_logger(__name__)

_APP = "BI 포털"

# 구성요소별 마지막 알림 시각 보관 키. TTL로 재발송 억제 창을 표현한다.
_ALERT_STATE_KEY = "bip:monitoring:alert:{component}"

# 구성요소 키 → (표시명, 영향 범위)
COMPONENT_LABELS: dict[str, tuple[str, str]] = {
    "db": ("데이터 저장소 (PostgreSQL)", "로그인 이후 화면·설정 저장·작업 이력"),
    "redis": ("캐시·세션·작업 큐 (Redis)", "로그인 세션과 모든 비동기 작업"),
    "worker": ("백그라운드 작업 처리기 (Celery Worker)", "새로고침·메일·내보내기 실행"),
    "scheduler": ("예약 작업 스케줄러 (Celery Beat)", "정기 수집과 예약 메일의 정시 실행"),
    "powerbi": ("Power BI 서비스 연결", "레포트 조회·새로고침·내보내기"),
    "smtp": ("메일 서버 (SMTP)", "예약 메일 발송"),
    "storage": ("파일 저장 공간", "메일 이미지 생성과 파일 내보내기 저장"),
}


def failing_components(status: dict[str, Any]) -> dict[str, str]:
    """운영 상태 응답에서 장애 구성요소와 사유를 뽑는다."""
    failures: dict[str, str] = {}
    if status.get("db") != "ok":
        failures["db"] = "데이터베이스에 연결할 수 없습니다."
    if status.get("redis") != "ok":
        failures["redis"] = "Redis에 연결할 수 없습니다."
    # Redis 장애 시 Worker·스케줄러는 확인 자체가 불가하므로 원인 중복 통보를 피한다.
    if status.get("redis") == "ok":
        if status.get("worker") != "ok":
            failures["worker"] = "응답하는 Worker가 없습니다."
        scheduler = status.get("scheduler") or {}
        if scheduler.get("status") == "unavailable":
            failures["scheduler"] = scheduler.get("message") or "스케줄러 heartbeat가 지연되고 있습니다."
        powerbi = status.get("powerbi") or {}
        if powerbi.get("status") == "error":
            failures["powerbi"] = powerbi.get("message") or "Power BI에 연결할 수 없습니다."
        smtp = status.get("smtp") or {}
        if smtp.get("status") == "error":
            failures["smtp"] = smtp.get("message") or "메일 서버에 연결할 수 없습니다."
    storage = status.get("storage") or {}
    if storage.get("status") == "error":
        failures["storage"] = storage.get("message") or "저장 경로에 접근할 수 없습니다."
    return failures


def _render(title: str, rows: list[tuple[str, str]], note: str) -> str:
    items = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap;">{html.escape(k)}</td>'
        f'<td style="padding:4px 0;color:#0f172a;">{html.escape(v)}</td></tr>'
        for k, v in rows
    )
    return (
        '<div style="font-family:system-ui,Segoe UI,sans-serif;font-size:14px;color:#0f172a;">'
        f'<h2 style="font-size:16px;margin:0 0 12px;">{html.escape(title)}</h2>'
        f'<table style="border-collapse:collapse;">{items}</table>'
        f'<p style="margin-top:16px;color:#334155;">{html.escape(note)}</p>'
        f'<p style="margin-top:12px;color:#94a3b8;font-size:12px;">본 메일은 {_APP} 운영 상태 점검에서 자동 발송되었습니다.</p>'
        '</div>'
    )


async def _send(subject: str, html_body: str) -> bool:
    recipients = settings.ops_alert_recipients
    if not recipients:
        return False
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM
    message["To"] = ", ".join(recipients)
    message["Subject"] = subject
    message.set_content("이 메일은 HTML 형식입니다.")
    message.add_alternative(html_body, subtype="html")
    try:
        await send_with_retry(message, recipients)
        return True
    except Exception as exc:  # noqa: BLE001 - 알림 실패가 점검을 막지 않는다
        logger.warning("ops_alert_send_failed", subject=subject, error=str(exc))
        return False


async def process_alerts(redis: Any, status: dict[str, Any]) -> dict[str, Any]:
    """장애·회복 알림을 처리하고 발송 결과 요약을 반환한다."""
    if not settings.OPS_ALERT_ENABLED:
        return {"enabled": False, "alerted": [], "recovered": []}

    failures = failing_components(status)
    checked_at = now_local().strftime("%Y-%m-%d %H:%M:%S")
    alerted: list[str] = []
    recovered: list[str] = []

    for component, (label, impact) in COMPONENT_LABELS.items():
        key = _ALERT_STATE_KEY.format(component=component)
        try:
            already_notified = bool(await redis.get(key))
        except Exception:  # noqa: BLE001 - Redis 장애 시 억제 상태를 알 수 없다
            already_notified = False

        reason = failures.get(component)
        if reason:
            if already_notified:
                continue
            sent = await _send(
                f"[{_APP}] 장애 발생: {label}",
                _render(
                    "운영 상태 점검에서 장애가 감지되었습니다.",
                    [("구성요소", label), ("원인", reason), ("영향", impact), ("감지 시각", checked_at)],
                    "관리자 콘솔의 운영 상태 화면에서 최근 작업과 실패 사유를 확인해 주세요.",
                ),
            )
            if sent:
                alerted.append(component)
                try:
                    await redis.set(key, checked_at, ex=settings.OPS_ALERT_RESEND_MINUTES * 60)
                except Exception:  # noqa: BLE001
                    pass
        elif already_notified:
            # 정상 복귀: 억제 키를 지우고 회복을 한 번 알린다.
            try:
                await redis.delete(key)
            except Exception:  # noqa: BLE001
                pass
            if await _send(
                f"[{_APP}] 장애 해소: {label}",
                _render(
                    "장애가 해소되어 정상 상태로 돌아왔습니다.",
                    [("구성요소", label), ("확인 시각", checked_at)],
                    "추가 조치가 필요하지 않다면 별도 대응은 필요하지 않습니다.",
                ),
            ):
                recovered.append(component)

    if alerted or recovered:
        logger.info("ops_alert_processed", alerted=alerted, recovered=recovered)
    return {"enabled": True, "alerted": alerted, "recovered": recovered}
