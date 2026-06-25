"""Image Service — 메일 이미지 픽셀 리사이즈 (T-29, Pillow).

design.md "이미지 크기 조정"(R16.17, D-13) 참조.

규칙:
  - 목표 폭(``target_width_px``)으로 **비율 유지 다운스케일**(재인코딩).
  - **업스케일 금지**: 목표 폭이 원본 폭 이상이면 리사이즈하지 않는다.
  - ``target_width_px`` 가 None/0 이하면 리사이즈 생략.
  - **PNG에만 적용**(PDF/PPTX 등은 리사이즈 대상이 아니다).
  - 리사이즈 실패 시 호출 측에서 원본으로 fallback 할 수 있도록 None 을 반환한다.

본 모듈은 순수 변환 로직만 담당한다(저장/DB 기록은 호출 측). 원본은 절대
변형하지 않으며, 새 bytes(리사이즈본)를 생성해 반환한다.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

from app.core.logging import get_logger

logger = get_logger(__name__)

# 리사이즈 대상 MIME (PNG만)
_RESIZABLE_MIMES = frozenset({"image/png"})


@dataclass
class ResizedImage:
    """리사이즈 결과. 호출 측이 StorageService 저장 + Report_Image_Path 기록에 사용."""

    data: bytes
    width_px: int
    height_px: int
    mime_type: str = "image/png"


def _is_resizable(mime_type: str | None, file_name: str | None) -> bool:
    """MIME 또는 확장자가 PNG 인 경우에만 리사이즈 대상."""
    if mime_type and mime_type.lower() in _RESIZABLE_MIMES:
        return True
    if file_name and file_name.lower().endswith(".png"):
        return True
    return False


def resize_png(
    raw_bytes: bytes,
    target_width_px: int | None,
    *,
    mime_type: str | None = None,
    file_name: str | None = None,
) -> ResizedImage | None:
    """PNG 이미지를 목표 폭으로 비율 유지 다운스케일한다.

    리사이즈를 수행한 경우 ``ResizedImage`` 를, 다음의 경우 ``None`` 을 반환한다:
      - ``target_width_px`` 가 None/0 이하 (리사이즈 생략)
      - 대상이 PNG 가 아님
      - 목표 폭이 원본 폭 이상 (업스케일 금지 → 원본 유지)
      - 디코딩/인코딩 실패 (호출 측에서 원본 fallback)
    """
    if not target_width_px or target_width_px <= 0:
        return None

    if not _is_resizable(mime_type, file_name):
        return None

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            orig_w, orig_h = img.size
            if orig_w <= 0 or orig_h <= 0:
                return None

            # 업스케일 금지: 목표 폭이 원본 이상이면 원본 유지(None)
            if target_width_px >= orig_w:
                logger.info(
                    "image_resize_skip_upscale",
                    target_width_px=target_width_px,
                    orig_width_px=orig_w,
                )
                return None

            # 비율 유지 다운스케일
            ratio = target_width_px / orig_w
            new_h = max(1, round(orig_h * ratio))
            resized = img.resize((target_width_px, new_h), Image.LANCZOS)

            out = io.BytesIO()
            resized.save(out, format="PNG", optimize=True)
            data = out.getvalue()

        logger.info(
            "image_resized",
            orig=f"{orig_w}x{orig_h}",
            resized=f"{target_width_px}x{new_h}",
            bytes=len(data),
        )
        return ResizedImage(
            data=data,
            width_px=target_width_px,
            height_px=new_h,
            mime_type="image/png",
        )
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        # 실패 시 None → 호출 측이 원본 fallback (발송 계속, R16.17)
        logger.warning("image_resize_failed", error=str(exc), exc_info=True)
        return None
