"""워커용 지속 이벤트 루프 러너.

Celery 워커(solo 풀)에서 매 태스크마다 ``asyncio.run()`` 을 호출하면 새 이벤트
루프가 생성·종료된다. 그런데 전역 비동기 자원(SQLAlchemy async 엔진/asyncpg 연결 풀,
``redis.asyncio`` 클라이언트)은 최초 사용한 루프에 묶이므로, 다음 태스크(새 루프)에서
재사용하면 ``RuntimeError: Event loop is closed`` 가 발생한다.

워커 프로세스에서 **단일 지속 루프**를 재사용하면 전역 자원이 그 루프에 한 번만
묶여 안정적으로 동작한다. solo 풀(단일 스레드) 전제이며, API(uvicorn) 프로세스와는
별개 프로세스이므로 영향이 없다.
"""
from __future__ import annotations

import asyncio
from typing import Any, Coroutine, TypeVar

_T = TypeVar("_T")
_loop: asyncio.AbstractEventLoop | None = None


def run_async(coro: Coroutine[Any, Any, _T]) -> _T:
    """워커 전용 지속 이벤트 루프에서 코루틴을 실행한다.

    ``asyncio.run()`` 대체용. 루프가 없거나 닫혀 있으면 새로 만들어 재사용한다.
    """
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop.run_until_complete(coro)
