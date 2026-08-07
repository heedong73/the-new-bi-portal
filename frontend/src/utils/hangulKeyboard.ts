/**
 * 두벌식 한글 자판을 영문 상태로 입력한 문자열을 한글로 조합한다.
 *
 * 예: `tjgmldus` → `서희연`
 * 검색어 보정에 쓰므로, 영문 자판 키가 아닌 문자는 그대로 보존한다.
 */

const KEY_TO_JAMO: Record<string, string> = {
  r: 'ㄱ', R: 'ㄲ', s: 'ㄴ', e: 'ㄷ', E: 'ㄸ', f: 'ㄹ', a: 'ㅁ', q: 'ㅂ', Q: 'ㅃ',
  t: 'ㅅ', T: 'ㅆ', d: 'ㅇ', w: 'ㅈ', W: 'ㅉ', c: 'ㅊ', z: 'ㅋ', x: 'ㅌ', v: 'ㅍ', g: 'ㅎ',
  k: 'ㅏ', o: 'ㅐ', i: 'ㅑ', O: 'ㅒ', j: 'ㅓ', p: 'ㅔ', u: 'ㅕ', P: 'ㅖ', h: 'ㅗ',
  y: 'ㅛ', n: 'ㅜ', b: 'ㅠ', m: 'ㅡ', l: 'ㅣ',
}

const INITIAL_INDEX: Record<string, number> = {
  'ㄱ': 0, 'ㄲ': 1, 'ㄴ': 2, 'ㄷ': 3, 'ㄸ': 4, 'ㄹ': 5, 'ㅁ': 6, 'ㅂ': 7, 'ㅃ': 8,
  'ㅅ': 9, 'ㅆ': 10, 'ㅇ': 11, 'ㅈ': 12, 'ㅉ': 13, 'ㅊ': 14, 'ㅋ': 15, 'ㅌ': 16, 'ㅍ': 17, 'ㅎ': 18,
}

const MEDIAL_INDEX: Record<string, number> = {
  'ㅏ': 0, 'ㅐ': 1, 'ㅑ': 2, 'ㅒ': 3, 'ㅓ': 4, 'ㅔ': 5, 'ㅕ': 6, 'ㅖ': 7, 'ㅗ': 8,
  'ㅘ': 9, 'ㅙ': 10, 'ㅚ': 11, 'ㅛ': 12, 'ㅜ': 13, 'ㅝ': 14, 'ㅞ': 15, 'ㅟ': 16,
  'ㅠ': 17, 'ㅡ': 18, 'ㅢ': 19, 'ㅣ': 20,
}

const FINAL_INDEX: Record<string, number> = {
  '': 0, 'ㄱ': 1, 'ㄲ': 2, 'ㄳ': 3, 'ㄴ': 4, 'ㄵ': 5, 'ㄶ': 6, 'ㄷ': 7, 'ㄹ': 8,
  'ㄺ': 9, 'ㄻ': 10, 'ㄼ': 11, 'ㄽ': 12, 'ㄾ': 13, 'ㄿ': 14, 'ㅀ': 15, 'ㅁ': 16,
  'ㅂ': 17, 'ㅄ': 18, 'ㅅ': 19, 'ㅆ': 20, 'ㅇ': 21, 'ㅈ': 22, 'ㅊ': 23, 'ㅋ': 24,
  'ㅌ': 25, 'ㅍ': 26, 'ㅎ': 27,
}

const COMBINED_MEDIAL: Record<string, string> = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ',
  'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ',
  'ㅡㅣ': 'ㅢ',
}

const COMBINED_FINAL: Record<string, string> = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ',
  'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
}

const SPLIT_FINAL: Record<string, readonly [string, string]> = {
  'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'],
  'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'],
  'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'],
}

function isVowel(jamo: string): boolean {
  return jamo in MEDIAL_INDEX
}

function composeSyllable(initial: string, medial: string, final: string): string {
  const initialIndex = INITIAL_INDEX[initial]
  const medialIndex = MEDIAL_INDEX[medial]
  const finalIndex = FINAL_INDEX[final]
  if (initialIndex == null || medialIndex == null || finalIndex == null) {
    return `${initial}${medial}${final}`
  }
  return String.fromCharCode(0xAC00 + ((initialIndex * 21 + medialIndex) * 28) + finalIndex)
}

/**
 * 영문 상태에서 두벌식 자판으로 입력한 텍스트를 한글로 변환한다.
 * 완성되지 않은 자모와 영문/숫자/공백은 유실하지 않고 그대로 반환한다.
 */
export function englishKeyboardToHangul(input: string): string {
  let result = ''
  let initial = ''
  let medial = ''
  let final = ''

  const flush = () => {
    if (initial && medial) result += composeSyllable(initial, medial, final)
    else result += `${initial}${medial}${final}`
    initial = ''
    medial = ''
    final = ''
  }

  for (const char of input) {
    const jamo = KEY_TO_JAMO[char]
    if (!jamo) {
      flush()
      result += char
      continue
    }

    if (isVowel(jamo)) {
      if (!initial) {
        initial = 'ㅇ'
        medial = jamo
      } else if (!medial) {
        medial = jamo
      } else if (final) {
        const split = SPLIT_FINAL[final]
        if (split) {
          result += composeSyllable(initial, medial, split[0])
          initial = split[1]
        } else {
          result += composeSyllable(initial, medial, '')
          initial = final
        }
        medial = jamo
        final = ''
      } else {
        const combined = COMBINED_MEDIAL[`${medial}${jamo}`]
        if (combined) medial = combined
        else {
          result += composeSyllable(initial, medial, '')
          initial = 'ㅇ'
          medial = jamo
        }
      }
      continue
    }

    if (!initial) initial = jamo
    else if (!medial) {
      flush()
      initial = jamo
    } else if (!final) final = jamo
    else {
      const combined = COMBINED_FINAL[`${final}${jamo}`]
      if (combined) final = combined
      else {
        result += composeSyllable(initial, medial, final)
        initial = jamo
        medial = ''
        final = ''
      }
    }
  }

  flush()
  return result
}

/**
 * 검색어를 비교용 후보 목록으로 확장한다.
 *
 * 원문과 두벌식 한글 변환값을 함께 돌려주므로, 영문 자판으로 입력한 한글
 * (`tjgmldus` → `서희연`)과 실제 영문·숫자 값(사번·이메일 등)이 모두 검색된다.
 * 변환은 대소문자에 의존하므로(`R`→`ㄲ`) 소문자화보다 먼저 수행한다.
 */
export function buildSearchTerms(input: string): string[] {
  const raw = input.trim()
  if (!raw) return []
  return [...new Set([
    raw.toLocaleLowerCase('ko'),
    englishKeyboardToHangul(raw).toLocaleLowerCase('ko'),
  ])]
}

/**
 * 검색 대상 값 중 하나라도 확장된 검색어를 포함하는지 확인한다.
 * `values`의 null/undefined 항목은 무시한다.
 */
export function matchesSearchTerms(
  values: readonly (string | null | undefined)[],
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true
  const haystack = values
    .filter((value): value is string => !!value)
    .map((value) => value.toLocaleLowerCase('ko'))
  return terms.some((term) => haystack.some((value) => value.includes(term)))
}
