"""두벌식 한글 자판을 영문 상태로 입력한 검색어를 한글로 복원한다.

한글 입력기를 켜지 않고 검색하면 `서희연`이 `tjgmldus`로 입력된다. 서버 검색은
DB의 실제 한글 값과 ILIKE 비교를 하므로 이런 입력은 아무것도 찾지 못한다.
검색 시 원문과 함께 이 변환 결과도 후보로 넣어 두 경우 모두 매칭시킨다.

프런트엔드 `frontend/src/utils/hangulKeyboard.ts`와 같은 규칙을 따른다.
"""
from __future__ import annotations

KEY_TO_JAMO: dict[str, str] = {
    "r": "ㄱ", "R": "ㄲ", "s": "ㄴ", "e": "ㄷ", "E": "ㄸ", "f": "ㄹ", "a": "ㅁ",
    "q": "ㅂ", "Q": "ㅃ", "t": "ㅅ", "T": "ㅆ", "d": "ㅇ", "w": "ㅈ", "W": "ㅉ",
    "c": "ㅊ", "z": "ㅋ", "x": "ㅌ", "v": "ㅍ", "g": "ㅎ",
    "k": "ㅏ", "o": "ㅐ", "i": "ㅑ", "O": "ㅒ", "j": "ㅓ", "p": "ㅔ", "u": "ㅕ",
    "P": "ㅖ", "h": "ㅗ", "y": "ㅛ", "n": "ㅜ", "b": "ㅠ", "m": "ㅡ", "l": "ㅣ",
}

INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
MEDIALS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
FINALS = "_ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"

INITIAL_INDEX = {jamo: index for index, jamo in enumerate(INITIALS)}
MEDIAL_INDEX = {jamo: index for index, jamo in enumerate(MEDIALS)}
# 첫 항목은 종성 없음(0)을 뜻하는 자리표시자이므로 빈 문자열로 바꿔 넣는다.
FINAL_INDEX = {("" if jamo == "_" else jamo): index for index, jamo in enumerate(FINALS)}

COMBINED_MEDIAL: dict[str, str] = {
    "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ",
    "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ",
    "ㅡㅣ": "ㅢ",
}

COMBINED_FINAL: dict[str, str] = {
    "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ",
    "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ",
    "ㅂㅅ": "ㅄ",
}

SPLIT_FINAL: dict[str, tuple[str, str]] = {
    "ㄳ": ("ㄱ", "ㅅ"), "ㄵ": ("ㄴ", "ㅈ"), "ㄶ": ("ㄴ", "ㅎ"), "ㄺ": ("ㄹ", "ㄱ"),
    "ㄻ": ("ㄹ", "ㅁ"), "ㄼ": ("ㄹ", "ㅂ"), "ㄽ": ("ㄹ", "ㅅ"), "ㄾ": ("ㄹ", "ㅌ"),
    "ㄿ": ("ㄹ", "ㅍ"), "ㅀ": ("ㄹ", "ㅎ"), "ㅄ": ("ㅂ", "ㅅ"),
}

HANGUL_BASE = 0xAC00


def _compose(initial: str, medial: str, final: str) -> str:
    """초성·중성·종성을 완성형 음절로 조합한다. 조합 불가면 자모를 그대로 잇는다."""
    initial_index = INITIAL_INDEX.get(initial)
    medial_index = MEDIAL_INDEX.get(medial)
    final_index = FINAL_INDEX.get(final)
    if initial_index is None or medial_index is None or final_index is None:
        return f"{initial}{medial}{final}"
    return chr(HANGUL_BASE + ((initial_index * 21 + medial_index) * 28) + final_index)


def english_keyboard_to_hangul(text: str) -> str:
    """영문 자판으로 입력한 문자열을 한글로 조합한다.

    자판에 없는 문자(숫자·공백·이미 한글인 문자 등)는 그대로 보존하므로
    사번이나 이메일이 섞인 검색어도 손실 없이 통과한다.
    """
    result: list[str] = []
    initial = ""
    medial = ""
    final = ""

    def flush() -> None:
        nonlocal initial, medial, final
        if initial and medial:
            result.append(_compose(initial, medial, final))
        else:
            result.append(f"{initial}{medial}{final}")
        initial = ""
        medial = ""
        final = ""

    for char in text:
        jamo = KEY_TO_JAMO.get(char)
        if jamo is None:
            flush()
            result.append(char)
            continue

        if jamo in MEDIAL_INDEX:
            if not initial:
                initial = "ㅇ"
                medial = jamo
            elif not medial:
                medial = jamo
            elif final:
                # 종성이 다음 음절의 초성으로 넘어가는 실제 입력기 동작을 재현한다.
                split = SPLIT_FINAL.get(final)
                if split:
                    result.append(_compose(initial, medial, split[0]))
                    initial = split[1]
                else:
                    result.append(_compose(initial, medial, ""))
                    initial = final
                medial = jamo
                final = ""
            else:
                combined = COMBINED_MEDIAL.get(f"{medial}{jamo}")
                if combined:
                    medial = combined
                else:
                    result.append(_compose(initial, medial, ""))
                    initial = "ㅇ"
                    medial = jamo
            continue

        if not initial:
            initial = jamo
        elif not medial:
            flush()
            initial = jamo
        elif not final:
            final = jamo
        else:
            combined = COMBINED_FINAL.get(f"{final}{jamo}")
            if combined:
                final = combined
            else:
                result.append(_compose(initial, medial, final))
                initial = jamo
                medial = ""
                final = ""

    flush()
    return "".join(result)


def expand_search_terms(query: str | None) -> list[str]:
    """검색어를 ILIKE 비교용 후보 목록으로 확장한다.

    원문을 항상 먼저 넣으므로 실제 영문·숫자 검색이 자판 변환 때문에 깨지지 않는다.
    변환 결과가 원문과 같으면 중복을 넣지 않는다.
    """
    normalized = (query or "").strip()
    if not normalized:
        return []
    terms = [normalized]
    converted = english_keyboard_to_hangul(normalized)
    if converted and converted != normalized:
        terms.append(converted)
    return terms
