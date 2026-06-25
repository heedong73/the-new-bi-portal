"""메일 템플릿 조립 + HTML sanitize + 치환 변수 렌더링 (T-30).

design.md "메일 템플릿/커스터마이징 설계"(R16.10, R16.16, R40) 참조.

본문 구성: 상단 안내문구(header) → 페이지 이미지(sort_order 순, CID inline) → 하단문구(footer).
사용자 입력 HTML(header/footer)은 화이트리스트 기반으로 sanitize 하여 XSS를 방지한다.
치환 변수({date}, {report_name} 등)는 발송 시점 값으로 렌더링한다.

NOTE: HTML sanitize 는 nh3(ammonia, Rust 기반) 화이트리스트로 수행한다.
body_header/footer 는 System_Operator 만 설정하는 제한된 입력이다.
"""
from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import datetime

import nh3

# ── 화이트리스트 (nh3) ──────────────────────────────────────────────────────
# 허용 태그/속성. 그 외 태그는 제거(텍스트는 보존), script/style 은 내용까지 제거.
# style 속성은 nh3 가 CSS 값을 검사하지 못하므로 사용자 입력에서는 허용하지 않는다
# (본문 레이아웃의 style 은 assemble_body 가 sanitize 이후 자체 부여).
_ALLOWED_TAGS: set[str] = {
    "p", "br", "b", "strong", "i", "em", "u", "span", "div",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "table", "thead",
    "tbody", "tr", "td", "th", "a",
}
_ALLOWED_ATTRS: dict[str, set[str]] = {
    "a": {"href", "title"},
}
_ALLOWED_URL_SCHEMES: set[str] = {"http", "https", "mailto"}
_CLEAN_CONTENT_TAGS: set[str] = {"script", "style"}


def sanitize_html(raw: str | None) -> str:
    """사용자 입력 HTML을 nh3(ammonia) 화이트리스트로 정화한다. None/빈 값은 ''.

    - 허용 태그 외는 제거(텍스트는 보존), script/style 은 내용까지 제거.
    - href 는 http/https/mailto 스킴만 허용(javascript:/data: 차단).
    - 링크에 rel="noopener noreferrer" 부여.
    """
    if not raw:
        return ""
    return nh3.clean(
        raw,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        url_schemes=_ALLOWED_URL_SCHEMES,
        clean_content_tags=_CLEAN_CONTENT_TAGS,
        link_rel="noopener noreferrer",
    )


def render_variables(text: str | None, context: dict[str, str]) -> str:
    """{key} 형태 치환 변수를 context 값으로 렌더링한다.

    정의되지 않은 변수는 원문을 그대로 남긴다(KeyError 회피).
    """
    if not text:
        return ""
    result = text
    for key, value in context.items():
        result = result.replace(f"{{{key}}}", value)
    return result


def default_context(report_name: str, now: datetime | None = None) -> dict[str, str]:
    """치환 변수 기본 컨텍스트: {date}, {datetime}, {report_name}."""
    now = now or datetime.now()
    return {
        "date": now.strftime("%Y-%m-%d"),
        "datetime": now.strftime("%Y-%m-%d %H:%M"),
        "report_name": report_name,
    }


# ── 본문 조립 ───────────────────────────────────────────────────────────────

@dataclass
class InlineImage:
    """본문에 inline 삽입할 이미지. cid 로 multipart/related 와 연결."""

    cid: str
    caption: str | None = None
    display_width: str | None = None  # 예: "600", "80%" (None이면 미지정)


def render_subject(
    subject_template: str | None, context: dict[str, str], fallback: str
) -> str:
    """제목 렌더링. 템플릿이 없으면 fallback(스케줄 제목 등) 사용. 제목은 평문."""
    if not subject_template:
        return fallback
    return render_variables(subject_template, context)


def _img_tag(image: InlineImage) -> str:
    """cid inline <img> 태그. display_width 적용(px는 숫자, %는 그대로)."""
    width_attr = ""
    if image.display_width:
        w = image.display_width.strip()
        if w.endswith("%"):
            width_attr = f' width="{html.escape(w)}"'
        elif w.isdigit():
            width_attr = f' width="{w}"'
    alt = html.escape(image.caption or "")
    return f'<img src="cid:{html.escape(image.cid)}"{width_attr} alt="{alt}" />'


def assemble_body(
    *,
    body_header: str | None,
    body_footer: str | None,
    images: list[InlineImage],
    context: dict[str, str],
) -> str:
    """메일 HTML 본문 조립: header(sanitize+render) → 이미지(순서대로) → footer.

    이미지는 호출 측에서 sort_order 순으로 정렬해 전달한다고 가정한다.
    """
    header_html = render_variables(sanitize_html(body_header), context)
    footer_html = render_variables(sanitize_html(body_footer), context)

    blocks: list[str] = ['<div style="font-family:sans-serif">']
    if header_html:
        blocks.append(f'<div class="bip-header">{header_html}</div>')

    for image in images:
        blocks.append('<div class="bip-page" style="margin:12px 0">')
        if image.caption:
            blocks.append(f"<p><strong>{html.escape(image.caption)}</strong></p>")
        blocks.append(_img_tag(image))
        blocks.append("</div>")

    if footer_html:
        blocks.append(f'<div class="bip-footer">{footer_html}</div>')
    blocks.append("</div>")

    return "".join(blocks)
