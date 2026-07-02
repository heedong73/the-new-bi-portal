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
import re
from dataclasses import dataclass
from datetime import datetime

import nh3

# ── 화이트리스트 (nh3) ──────────────────────────────────────────────────────
# 허용 태그/속성. 그 외 태그는 제거(텍스트는 보존), script/style 은 내용까지 제거.
# style 속성은 attribute_filter 로 안전한 CSS 속성만 남긴다(정렬/폰트/굵기 등).
_ALLOWED_TAGS: set[str] = {
    "p", "br", "b", "strong", "i", "em", "u", "span", "div",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "table", "thead",
    "tbody", "tr", "td", "th", "a",
}
# style 을 가질 수 있는 태그(리치 에디터가 생성하는 인라인 서식용)
_STYLE_TAGS: set[str] = {
    "p", "div", "span", "b", "strong", "i", "em", "u",
    "h1", "h2", "h3", "h4", "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "td", "th", "a",
}
_ALLOWED_ATTRS: dict[str, set[str]] = {t: {"style"} for t in _STYLE_TAGS}
_ALLOWED_ATTRS["a"] = {"href", "title", "style"}
_ALLOWED_URL_SCHEMES: set[str] = {"http", "https", "mailto"}
_CLEAN_CONTENT_TAGS: set[str] = {"script", "style"}

# style 속성에서 허용할 CSS 속성(정렬/폰트/굵기/색 등 서식용). 그 외는 제거.
_ALLOWED_CSS_PROPS: set[str] = {
    "text-align", "font-weight", "font-style", "text-decoration",
    "font-family", "font-size", "color", "background-color", "line-height",
}


def _style_attribute_filter(tag: str, attr: str, value: str) -> str | None:
    """attribute_filter: style 속성은 허용 CSS 속성만 남기고, 그 외 속성은 그대로 둔다.

    url()/expression()/javascript: 등 위험 값은 제거한다. 남는 선언이 없으면 None(속성 제거).
    """
    if attr != "style":
        return value
    kept: list[str] = []
    for decl in value.split(";"):
        prop, sep, val = decl.partition(":")
        if not sep:
            continue
        prop_name = prop.strip().lower()
        css_val = val.strip()
        low = css_val.lower()
        if (
            prop_name in _ALLOWED_CSS_PROPS
            and "url(" not in low
            and "expression" not in low
            and "javascript:" not in low
        ):
            kept.append(f"{prop_name}:{css_val}")
    return "; ".join(kept) if kept else None


def sanitize_html(raw: str | None) -> str:
    """사용자 입력 HTML을 nh3(ammonia) 화이트리스트로 정화한다. None/빈 값은 ''.

    - 허용 태그 외는 제거(텍스트는 보존), script/style 은 내용까지 제거.
    - style 속성은 허용 CSS 속성(정렬/폰트/굵기/색 등)만 남긴다(XSS 방지).
    - href 는 http/https/mailto 스킴만 허용(javascript:/data: 차단).
    - 링크에 rel="noopener noreferrer" 부여.
    """
    if not raw:
        return ""
    return nh3.clean(
        raw,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        attribute_filter=_style_attribute_filter,
        url_schemes=_ALLOWED_URL_SCHEMES,
        clean_content_tags=_CLEAN_CONTENT_TAGS,
        link_rel="noopener noreferrer",
    )


def html_to_text(raw: str | None) -> str:
    """HTML을 평문으로 변환(모바일 알림/미리보기용 text/plain 대체본).

    <br>/<p>/<div>/<li> 등 블록 경계는 줄바꿈으로 바꾸고 태그를 제거한 뒤
    엔티티를 복원하고 과도한 빈 줄을 정리한다.
    """
    if not raw:
        return ""
    s = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    s = re.sub(r"(?i)</(p|div|li|h[1-4]|tr|table|ul|ol)>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", "", s)
    s = html.unescape(s)
    lines = [ln.strip() for ln in s.splitlines()]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


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
        # 페이지명(캡션) 라벨은 본문에 표시하지 않는다(요청). alt 속성으로만 유지.
        blocks.append(_img_tag(image))
        blocks.append("</div>")

    if footer_html:
        blocks.append(f'<div class="bip-footer">{footer_html}</div>')
    blocks.append("</div>")

    return "".join(blocks)
