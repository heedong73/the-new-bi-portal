"""Domain exception hierarchy + global exception handlers.

Design reference: "Error Handling - Backend 오류 분류와 응답" and "공통 오류 응답".

This module centralizes how the Backend turns failures into the standard
``ErrorResponse`` envelope (``{errorCode, errorDescription, details}``). It is
the single source of truth for the HTTP status / errorCode mapping described in
design.md:

| 오류 카테고리                    | HTTP | errorCode             |
|----------------------------------|------|-----------------------|
| 입력 유효성 (date/ISO 형식 등)   | 400  | ``VALIDATION_ERROR``  |
| Power BI 인증 실패 (Azure AD 4xx)| 502  | ``POWERBI_AUTH_ERROR``|
| Power BI 인가 실패 (403)         | 502  | ``POWERBI_FORBIDDEN`` |
| Power BI rate limit (429)        | 502  | ``POWERBI_RATE_LIMIT``|
| Power BI 5xx                     | 502  | ``POWERBI_UPSTREAM_5XX``|
| DB 무결성 위반                   | 500  | ``DB_INTEGRITY_ERROR``|
| 작업 큐 enqueue 실패             | 503  | ``QUEUE_UNAVAILABLE`` |
| 예상치 못한 예외                 | 500  | ``INTERNAL_ERROR``    |

Design decisions:

- ``AppError`` is the base for all domain exceptions. Each subclass fixes its
  ``error_code``/``status_code`` so call sites only supply a (Korean) message
  and optional non-sensitive ``details``. Stages 4/5/6 raise the Power BI /
  queue subclasses; they are defined here now so those stages plug in without
  touching the handler wiring (no orphan code).
- ``register_exception_handlers(app)`` registers three handlers:
  1. ``AppError`` -> the exception's own status + envelope.
  2. ``RequestValidationError`` -> 400 ``VALIDATION_ERROR`` (Korean message).
  3. bare ``Exception`` -> 500 ``INTERNAL_ERROR`` with a generic user-facing
     message; the full traceback goes to the structured log only.

Security (Requirement 20.5): handlers NEVER place a stacktrace or any secret in
the response body. The unhandled-exception handler logs ``exc_info`` via
structlog (which masks secret-bearing keys) but returns a fixed generic message.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_logger
from app.schemas.common import ErrorResponse

_log = get_logger("app.errors")


class ErrorCode:
    """Canonical ``errorCode`` string constants (design.md 오류 분류표).

    Kept as plain class attributes (not an ``Enum``) so they serialize as bare
    strings in the JSON envelope and read cleanly at raise sites.
    """

    VALIDATION_ERROR = "VALIDATION_ERROR"
    POWERBI_AUTH_ERROR = "POWERBI_AUTH_ERROR"
    POWERBI_FORBIDDEN = "POWERBI_FORBIDDEN"
    POWERBI_RATE_LIMIT = "POWERBI_RATE_LIMIT"
    POWERBI_UPSTREAM_5XX = "POWERBI_UPSTREAM_5XX"
    DB_INTEGRITY_ERROR = "DB_INTEGRITY_ERROR"
    QUEUE_UNAVAILABLE = "QUEUE_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


# ---------------------------------------------------------------------------
# Domain exception hierarchy
# ---------------------------------------------------------------------------
class AppError(Exception):
    """Base class for all domain errors surfaced through the API.

    Carries everything the global handler needs to build an ``ErrorResponse``:

    - ``error_code``: machine-readable code (see :class:`ErrorCode`).
    - ``error_description``: human-readable Korean message (user-facing).
    - ``status_code``: HTTP status to return.
    - ``details``: optional non-sensitive context dict (e.g. upstream status).
      Callers MUST NOT place secrets or stacktraces here (Requirement 20.5).
    """

    # Subclasses override these defaults.
    error_code: str = ErrorCode.INTERNAL_ERROR
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR

    def __init__(
        self,
        error_description: str,
        *,
        error_code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.error_description = error_description
        if error_code is not None:
            self.error_code = error_code
        if status_code is not None:
            self.status_code = status_code
        self.details = details
        super().__init__(error_description)

    def to_response(self) -> JSONResponse:
        """Render this error as the standard ``ErrorResponse`` JSON envelope."""
        body = ErrorResponse(
            errorCode=self.error_code,
            errorDescription=self.error_description,
            details=self.details,
        )
        return JSONResponse(status_code=self.status_code, content=body.model_dump())


class ValidationAppError(AppError):
    """Input validation failure (400). Mirrors ``VALIDATION_ERROR``.

    Use for hand-rolled validation (e.g. ``date``/ISO parsing in routes). The
    FastAPI ``RequestValidationError`` path produces the same envelope via
    :func:`request_validation_handler`.
    """

    error_code = ErrorCode.VALIDATION_ERROR
    status_code = status.HTTP_400_BAD_REQUEST


class PowerBIError(AppError):
    """Power BI upstream failure (502). Base for the ``POWERBI_*`` family.

    Raised by the Live Power BI client / Token_Service in stage 4. Defaults to
    the generic upstream code; the specific subclasses below pin the precise
    ``errorCode`` from the design table.
    """

    error_code = ErrorCode.POWERBI_UPSTREAM_5XX
    status_code = status.HTTP_502_BAD_GATEWAY


class PowerBIAuthError(PowerBIError):
    """Azure AD / Power BI authentication failure (502, ``POWERBI_AUTH_ERROR``)."""

    error_code = ErrorCode.POWERBI_AUTH_ERROR


class PowerBIForbiddenError(PowerBIError):
    """Power BI authorization failure / 403 (502, ``POWERBI_FORBIDDEN``)."""

    error_code = ErrorCode.POWERBI_FORBIDDEN


class PowerBIRateLimitError(PowerBIError):
    """Power BI rate limit exhausted after retries (502, ``POWERBI_RATE_LIMIT``)."""

    error_code = ErrorCode.POWERBI_RATE_LIMIT


class PowerBIUpstreamError(PowerBIError):
    """Power BI 5xx upstream error (502, ``POWERBI_UPSTREAM_5XX``)."""

    error_code = ErrorCode.POWERBI_UPSTREAM_5XX


class DBIntegrityError(AppError):
    """Database integrity violation (500, ``DB_INTEGRITY_ERROR``).

    User sees a generic message; the detailed cause is logged only.
    """

    error_code = ErrorCode.DB_INTEGRITY_ERROR
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR


class QueueUnavailableError(AppError):
    """Task queue enqueue failure (503, ``QUEUE_UNAVAILABLE``).

    Raised by ``POST /api/collect-now`` (stage 5/6) when Celery/Redis is down.
    """

    error_code = ErrorCode.QUEUE_UNAVAILABLE
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE


# ---------------------------------------------------------------------------
# Global handlers
# ---------------------------------------------------------------------------
async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    """Render any :class:`AppError` as its standard envelope.

    Logs at ``warning`` (client/upstream faults are expected, recoverable
    conditions). The response body contains only ``errorCode``,
    ``errorDescription`` and the caller-provided non-sensitive ``details``.
    """
    _log.warning(
        "app_error",
        error_code=exc.error_code,
        status_code=exc.status_code,
        error_description=exc.error_description,
        details=exc.details,
    )
    return exc.to_response()


def _summarize_validation_errors(exc: RequestValidationError) -> str:
    """Build a concise Korean message from FastAPI validation errors.

    Lists the offending fields (location path) without echoing raw input
    values, keeping the message human-readable and free of sensitive data.
    """
    fields: list[str] = []
    for err in exc.errors():
        loc = err.get("loc", ())
        # Drop the leading scope ("query"/"body"/"path") for readability.
        parts = [str(p) for p in loc if p not in ("query", "body", "path")]
        field = ".".join(parts) if parts else "요청"
        if field not in fields:
            fields.append(field)
    if fields:
        return "요청 값이 올바르지 않습니다: " + ", ".join(fields)
    return "요청 값이 올바르지 않습니다."


async def request_validation_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handle FastAPI ``RequestValidationError`` as 400 ``VALIDATION_ERROR``.

    Produces the same envelope shape as the hand-rolled validation in
    ``refresh.py`` / ``summary.py`` so the response is consistent regardless of
    where the validation failure originated. The Korean message names the
    offending fields; raw errors go to the log only.
    """
    _log.warning("validation_error", errors=exc.errors())
    body = ErrorResponse(
        errorCode=ErrorCode.VALIDATION_ERROR,
        errorDescription=_summarize_validation_errors(exc),
    )
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST, content=body.model_dump()
    )


async def unhandled_exception_handler(
    _request: Request, exc: Exception
) -> JSONResponse:
    """Catch-all for unexpected exceptions -> 500 ``INTERNAL_ERROR``.

    Security (Requirement 20.5): the response body NEVER contains the
    stacktrace or any secret — only a fixed, generic Korean message. The full
    traceback is recorded in the structured log (``exc_info=True``); structlog's
    masking processor redacts secret-bearing keys.
    """
    _log.error("unhandled_exception", exc_info=exc)
    body = ErrorResponse(
        errorCode=ErrorCode.INTERNAL_ERROR,
        errorDescription="서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content=body.model_dump()
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Register all global exception handlers on the FastAPI app.

    Called from ``create_app`` (``main.py``). Registers, in order of
    specificity:

    1. :class:`AppError` (and all subclasses) -> :func:`app_error_handler`.
    2. ``RequestValidationError`` -> :func:`request_validation_handler` (400).
    3. bare ``Exception`` -> :func:`unhandled_exception_handler` (500).
    """
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(
        RequestValidationError, request_validation_handler  # type: ignore[arg-type]
    )
    app.add_exception_handler(Exception, unhandled_exception_handler)
