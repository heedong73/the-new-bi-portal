"""StorageService — 파일 저장소 추상화 (local / nas).

design.md "StorageService 추상화"(R16, R31, D-09) 참조.

reportimage/extracted/export 결과 파일의 저장·조회·삭제를 단일 인터페이스로
추상화한다. v1.0 구현체는 파일시스템 기반 두 가지이며(local = Docker volume,
nas = 마운트 경로), 둘 다 동일한 ``_FilesystemStorage`` 로직을 공유하고
``STORAGE_ROOT_PATH``(루트 디렉터리)만 다르다. ``s3``는 v1.1+ 확장 지점으로
인터페이스만 남기고 구현하지 않는다.

저장 경로는 항상 **루트 기준 상대 경로**(예: ``export/2026/06/abc.png``)로
다루며, 절대 경로/상위 디렉터리 탈출(``..``)은 거부한다(경로 주입 방어).
파일 본체만 저장소에 두고, DB에는 상대 경로/메타만 저장한다(R31.2).
"""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Protocol, runtime_checkable

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class StoredFile:
    """저장 결과 메타데이터. DB(Report_Image_Path/Export_Job)에 기록할 값."""

    relative_path: str
    size: int
    mime_type: str | None = None


def _normalize_relative_path(relative_path: str) -> PurePosixPath:
    """상대 경로를 정규화하고 디렉터리 탈출/절대 경로를 거부한다.

    저장소 루트를 벗어나는 경로 주입을 막기 위해 ``..`` 세그먼트와 절대 경로를
    금지한다. 구분자는 POSIX 스타일(``/``)로 통일한다.
    """
    normalized = relative_path.replace("\\", "/").strip("/")
    if not normalized:
        raise ValueError("빈 저장 경로는 허용되지 않습니다.")
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or any(part == ".." for part in pure.parts):
        raise ValueError(f"허용되지 않는 저장 경로입니다: {relative_path!r}")
    return pure


@runtime_checkable
class StorageService(Protocol):
    """파일 저장소 추상화 인터페이스.

    모든 경로 인자는 저장소 루트 기준 상대 경로다. 구현체는 경로 정규화/탈출
    방어를 보장해야 한다.
    """

    def save(self, relative_path: str, data: bytes, mime_type: str | None = None) -> StoredFile:
        """``data``를 ``relative_path``에 저장하고 메타를 반환한다."""
        ...

    def open(self, relative_path: str) -> BinaryIO:
        """``relative_path`` 파일을 바이너리 읽기 모드로 연다."""
        ...

    def exists(self, relative_path: str) -> bool:
        """파일 존재 여부."""
        ...

    def delete(self, relative_path: str) -> None:
        """파일을 삭제한다(없으면 무시)."""
        ...

    def url_for(self, relative_path: str) -> str | None:
        """정적 서빙 URL(가능한 경우). 파일시스템 백엔드는 ``None``."""
        ...


class _FilesystemStorage:
    """파일시스템 기반 StorageService 구현 (local/nas 공용).

    ``root_path`` 아래에 상대 경로 그대로 파일을 배치한다. local(Docker volume)과
    nas(마운트 경로)는 동일 로직이며 루트만 다르다.
    """

    def __init__(self, root_path: str) -> None:
        self._root = Path(root_path).resolve()

    def _abs(self, relative_path: str) -> Path:
        """정규화된 상대 경로를 루트 기준 절대 경로로 변환한다."""
        pure = _normalize_relative_path(relative_path)
        return self._root.joinpath(*pure.parts)

    def save(self, relative_path: str, data: bytes, mime_type: str | None = None) -> StoredFile:
        target = self._abs(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        # 부분 쓰기 노출 방지를 위해 임시 파일에 기록 후 원자적 교체.
        tmp = target.with_name(f".{target.name}.tmp")
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, target)
        logger.info("storage_save", path=relative_path, size=len(data))
        return StoredFile(
            relative_path=_normalize_relative_path(relative_path).as_posix(),
            size=len(data),
            mime_type=mime_type,
        )

    def open(self, relative_path: str) -> BinaryIO:
        return open(self._abs(relative_path), "rb")

    def exists(self, relative_path: str) -> bool:
        return self._abs(relative_path).is_file()

    def delete(self, relative_path: str) -> None:
        target = self._abs(relative_path)
        try:
            target.unlink(missing_ok=True)
        except OSError:
            logger.warning("storage_delete_failed", path=relative_path, exc_info=True)

    def url_for(self, relative_path: str) -> str | None:
        # 파일시스템 백엔드는 권한 우회 방지를 위해 정적 URL을 제공하지 않는다
        # (SERVE_REPORTIMAGE_STATIC=false 기본). 다운로드는 권한 검증 후 스트리밍.
        return None


def get_storage_service() -> StorageService:
    """``STORAGE_BACKEND`` 설정에 따른 StorageService 구현체를 반환한다.

    local/nas는 파일시스템 구현(루트는 ``STORAGE_ROOT_PATH``). s3는 v1.1+ 확장
    지점으로 아직 미구현이며 선택 시 명시적으로 실패한다.
    """
    backend = settings.STORAGE_BACKEND
    if backend in ("local", "nas"):
        return _FilesystemStorage(settings.STORAGE_ROOT_PATH)
    raise NotImplementedError(f"지원하지 않는 STORAGE_BACKEND입니다: {backend}")
