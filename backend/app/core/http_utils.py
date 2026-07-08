"""HTTP 응답 유틸.

HTTP 헤더는 latin-1만 허용하므로 한글 등 비ASCII 파일명을 Content-Disposition에
그대로 넣으면 UnicodeEncodeError(500)가 발생한다. RFC 5987 ``filename*``(UTF-8
퍼센트 인코딩)과 ASCII 대체 ``filename``을 함께 제공해 안전하게 다운로드/inline
표시되도록 한다.
"""
from __future__ import annotations

from urllib.parse import quote


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
