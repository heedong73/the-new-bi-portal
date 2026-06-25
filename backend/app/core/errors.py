from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class BIPError(HTTPException):
    def __init__(self, status_code: int, error_code: str, message: str, details: dict = {}):
        super().__init__(status_code=status_code, detail=message)
        self.error_code = error_code
        self.message = message
        self.details = details


# 자주 쓰는 에러 정의
class NotFoundError(BIPError):
    def __init__(self, message: str = "리소스를 찾을 수 없습니다."):
        super().__init__(404, "NOT_FOUND", message)


class PermissionDeniedError(BIPError):
    def __init__(self, message: str = "이 작업을 수행할 권한이 없습니다."):
        super().__init__(403, "PERMISSION_DENIED", message)


class UnauthenticatedError(BIPError):
    def __init__(self, message: str = "인증이 필요합니다. 다시 로그인해 주세요."):
        super().__init__(401, "UNAUTHENTICATED", message)


class ConflictError(BIPError):
    def __init__(self, message: str = "요청이 현재 상태와 충돌합니다."):
        super().__init__(409, "CONFLICT", message)


class ValidationError(BIPError):
    def __init__(self, message: str = "입력값이 올바르지 않습니다."):
        super().__init__(400, "VALIDATION_ERROR", message)


class PowerBIError(BIPError):
    def __init__(self, message: str = "Power BI 연동 중 오류가 발생했습니다.", details: dict = {}):
        super().__init__(502, "POWERBI_ERROR", message, details)


class PowerBIAuthError(BIPError):
    def __init__(self, message: str = "Power BI 인증에 실패했습니다.", details: dict = {}):
        super().__init__(502, "POWERBI_AUTH_ERROR", message, details)


class PowerBIForbiddenError(BIPError):
    def __init__(self, message: str = "Power BI 접근 권한이 없습니다.", details: dict = {}):
        super().__init__(502, "POWERBI_FORBIDDEN", message, details)


class PowerBIRateLimitError(BIPError):
    def __init__(self, message: str = "Power BI 요청 한도를 초과했습니다.", details: dict = {}):
        super().__init__(502, "POWERBI_RATE_LIMIT", message, details)


class PowerBIUpstreamError(BIPError):
    def __init__(self, message: str = "Power BI 서버 오류가 발생했습니다.", details: dict = {}):
        super().__init__(502, "POWERBI_UPSTREAM_5XX", message, details)


class QueueUnavailableError(BIPError):
    def __init__(self, message: str = "작업 큐를 사용할 수 없습니다."):
        super().__init__(503, "QUEUE_UNAVAILABLE", message)


async def bip_error_handler(request: Request, exc: BIPError) -> JSONResponse:
    # PowerBI 공통 오류는 감사 로그(powerbi_api_failure)에 기록 (best-effort)
    if exc.error_code.startswith("POWERBI"):
        await _record_powerbi_failure_safe(request, exc)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "errorCode": exc.error_code,
            "errorDescription": exc.message,
            "details": exc.details,
        },
    )


async def _record_powerbi_failure_safe(request: Request, exc: "BIPError") -> None:
    """PowerBI 오류를 audit_logs 에 기록. 감사 기록 실패가 응답을 막지 않도록 격리."""
    try:
        from app.db.session import AsyncSessionLocal
        from app.services.audit_service import record_powerbi_failure

        async with AsyncSessionLocal() as db:
            await record_powerbi_failure(
                db,
                endpoint=str(request.url.path),
                status_code=exc.status_code,
                error_type=exc.error_code,
                reason=exc.message,
            )
            await db.commit()
    except Exception:  # noqa: BLE001 - 감사 기록은 best-effort
        pass


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "errorCode": "INTERNAL_ERROR",
            "errorDescription": "서버 내부 오류가 발생했습니다.",
            "details": {},
        },
    )
