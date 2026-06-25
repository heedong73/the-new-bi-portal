"""Power BI status normalization (design.md "Power BI status 정규화").

Maps the raw Power BI refresh ``status`` string to the internal normalized
enum used throughout the system (success / failed / in_progress / unknown).

| Power BI 값 | 내부 enum | 설명 |
|---|---|---|
| ``Completed`` | ``success`` | 정상 완료 |
| ``Failed`` | ``failed`` | 실패 |
| ``Unknown`` (endTime 없음) | ``in_progress`` | 진행중 |
| ``Unknown`` (endTime 있음) | ``unknown`` | 알 수 없음 |
| ``Disabled`` | ``unknown`` | Disabled |
| 그 외 | ``unknown`` | 방어적 기본값 |

Requirements: 9.3 (status field), 19.3/19.4 (defensive handling).
"""

from __future__ import annotations

from typing import Literal

RefreshStatus = Literal["success", "failed", "in_progress", "unknown"]


def map_status(powerbi_status: str | None, has_end_time: bool) -> RefreshStatus:
    """Normalize a Power BI status string to the internal enum.

    Args:
        powerbi_status: Raw status from Power BI (e.g. ``"Completed"``,
            ``"Failed"``, ``"Unknown"``, ``"Disabled"``). May be ``None``.
            Comparison is case-insensitive.
        has_end_time: Whether the Refresh_Run has an ``endTime``. Only used to
            disambiguate ``Unknown`` between ``in_progress`` (no end time) and
            ``unknown`` (has end time).

    Returns:
        One of ``"success"``, ``"failed"``, ``"in_progress"``, ``"unknown"``.
    """
    normalized = (powerbi_status or "").strip().lower()

    if normalized == "completed":
        return "success"
    if normalized == "failed":
        return "failed"
    if normalized == "unknown":
        return "unknown" if has_end_time else "in_progress"
    # "disabled" and any other / missing value fall through to the defensive
    # default.
    return "unknown"
