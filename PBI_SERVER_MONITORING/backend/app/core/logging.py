"""Structured (JSON) logging with structlog + request-id middleware.

Design references: "Error Handling - Backend 로깅 정책" and "보안 고려사항".

- All records are emitted as JSON to stdout with common fields
  (``timestamp``, ``level``, ``logger``, ``event``) and, when available,
  ``request_id``.
- A masking processor redacts secret-bearing keys (``Authorization``,
  ``client_secret``, ``password``) to ``***`` (Requirement 20.5).
- ``RequestIdMiddleware`` assigns a UUID to every request, binds it to the
  structlog contextvars, and echoes it back via the ``X-Request-Id`` header.
"""

from __future__ import annotations

import logging
import sys
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-Id"

# Keys whose values must never appear in logs (case-insensitive match).
_SENSITIVE_KEYS = {"authorization", "client_secret", "password", "access_token", "token"}
_MASK = "***"


def _mask_value(value: Any) -> Any:
    """Recursively mask sensitive keys inside dict/list structures."""
    if isinstance(value, dict):
        return {
            k: (_MASK if k.lower() in _SENSITIVE_KEYS else _mask_value(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return type(value)(_mask_value(v) for v in value)
    return value


def mask_secrets_processor(
    _logger: Any, _method: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """structlog processor that masks sensitive keys in the event dict."""
    return _mask_value(event_dict)  # type: ignore[return-value]


def configure_logging() -> None:
    """Configure structlog to emit JSON logs to stdout.

    Idempotent: safe to call multiple times (e.g. app + worker startup).
    """
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            mask_secrets_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> Any:
    """Return a bound structlog logger."""
    return structlog.get_logger(name)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assign a request id to each request and expose it on the response.

    The id is taken from an inbound ``X-Request-Id`` header when present,
    otherwise a new UUID4 is generated. It is bound to structlog contextvars
    so every log record produced while handling the request carries it.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(request_id=request_id)
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
