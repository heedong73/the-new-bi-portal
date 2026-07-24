"""HTTP 응답 유틸.

HTTP 헤더는 latin-1만 허용하므로 한글 등 비ASCII 파일명을 Content-Disposition에
그대로 넣으면 UnicodeEncodeError(500)가 발생한다. RFC 5987 ``filename*``(UTF-8
퍼센트 인코딩)과 ASCII 대체 ``filename``을 함께 제공해 안전하게 다운로드/inline
표시되도록 한다.
"""
from __future__ import annotations

from contextvars import ContextVar
from urllib.parse import quote

from starlette.requests import Request

# 현재 요청의 클라이언트 IP. RequestContextMiddleware가 요청마다 설정하고,
# audit_service.append_audit()이 호출부를 개별 수정하지 않고 자동으로 읽어
# audit_logs.ip_address에 채운다. 요청 밖(예: Celery 워커)에서는 기본값 None.
_current_client_ip: ContextVar[str | None] = ContextVar("current_client_ip", default=None)


def get_current_client_ip() -> str | None:
    """현재 요청 컨텍스트에 저장된 클라이언트 IP를 반환한다(없으면 None)."""
    return _current_client_ip.get()


def client_ip(request: Request) -> str | None:
    """요청의 실제 클라이언트 IP를 해석한다.

    nginx(리버스 프록시, `nginx/nginx.conf`)가 ``X-Forwarded-For``/``X-Real-IP``를
    설정해 백엔드로 전달하므로, 이 값이 있으면 우선 사용한다(프록시 뒤에서는
    ``request.client.host``가 nginx 자신의 IP가 되어 버리기 때문). 두 헤더 모두
    없는 로컬 개발 환경에서는 ``request.client.host``로 폴백한다.

    ``X-Forwarded-For``는 ``client, proxy1, proxy2`` 순으로 누적되므로 첫 값만
    사용한다. 신뢰할 수 없는 클라이언트가 헤더를 직접 위조할 수 있다는 한계가
    있으나, 배포 환경은 nginx가 유일한 진입점이라 감사 로그 참고용으로는 충분하다.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:64]
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()[:64]
    if request.client:
        return request.client.host
    return None


async def request_context_middleware(request: Request, call_next):
    """요청마다 클라이언트 IP를 contextvar에 저장하는 ASGI 미들웨어.

    감사 로그 기록 시점(라우트 핸들러 내부, ``append_audit`` 호출부)에서 매번
    ``request: Request``를 새로 주입하지 않고도 IP를 읽을 수 있게 한다.
    """
    token = _current_client_ip.set(client_ip(request))
    try:
        return await call_next(request)
    finally:
        _current_client_ip.reset(token)


def content_disposition(filename: str, *, inline: bool = False) -> str:
    """비ASCII 파일명을 안전하게 담은 Content-Disposition 헤더 값을 만든다.

    - ``filename="..."``: ASCII 대체본(비ASCII/따옴표/역슬래시/제어문자는 ``_``).
    - ``filename*=UTF-8''...``: 원본 파일명을 UTF-8 퍼센트 인코딩(현대 브라우저용).
    """
    disp = "inline" if inline else "attachment"
    safe_name = filename or "download"
    ascii_name = "".join(
        c if (32 <= ord(c) < 127 and c not in '"\\') else "_" for c in safe_name
    ).strip() or "download"
    quoted = quote(safe_name, safe="")
    return f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"
