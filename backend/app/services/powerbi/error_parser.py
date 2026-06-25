"""serviceExceptionJson -> human-readable errorMessage (design.md "errorMessage 변환").

Power BI returns failure details as a ``serviceExceptionJson`` string. This
module converts it into a single-line, human-readable message stored in
``refresh_runs.error_message`` / surfaced as ``RefreshRunOut.errorMessage``.

Parsing rules (design.md):
- valid JSON -> extract ``errorCode``/``code`` and ``errorDescription``/``message``;
  return ``"[code] desc"`` when both present, else ``code`` or ``desc`` or the
  raw prefix.
- parse failure -> first 500 chars of the raw string (Requirement 19.4).

This is a **total function**: it never raises for any input, always returns
``str | None``, and the returned string is at most 500 characters long. These
guarantees are validated by Property 4 (task 2.3) with hypothesis.

Requirements: 9.4, 19.3, 19.4.
"""

from __future__ import annotations

import json

_MAX_LEN = 500


def _truncate(value: str) -> str:
    """Clamp a string to the maximum allowed length (``_MAX_LEN``)."""
    return value[:_MAX_LEN]


def parse_service_exception(raw: str | None) -> str | None:
    """Convert a ``serviceExceptionJson`` string into a one-line message.

    Args:
        raw: The raw ``serviceExceptionJson`` value, or ``None``.

    Returns:
        ``None`` when ``raw`` is empty/``None``; otherwise a human-readable
        string of at most 500 characters. Never raises.
    """
    if not raw:
        return None

    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError, TypeError):
        return _truncate(raw)

    # Only object payloads carry the documented error fields. Non-dict JSON
    # (numbers, strings, arrays, null) falls back to the raw prefix.
    if not isinstance(obj, dict):
        return _truncate(raw)

    # Coerce to str so non-string values (numbers, etc.) cannot raise during
    # formatting; empty/missing fields normalize to "".
    code_raw = obj.get("errorCode") or obj.get("code") or ""
    desc_raw = obj.get("errorDescription") or obj.get("message") or ""
    code = str(code_raw) if code_raw else ""
    desc = str(desc_raw) if desc_raw else ""

    if code and desc:
        return _truncate(f"[{code}] {desc}")
    return _truncate(code or desc or raw)
