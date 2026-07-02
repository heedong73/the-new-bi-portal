/** 간단한 리치 텍스트 에디터 (메일 본문 문구용).
 *
 * contentEditable + 툴바(굵기/기울임/밑줄/정렬/폰트/크기). styleWithCSS 를 켜서
 * 인라인 style(예: font-weight/text-align/font-family/font-size)로 출력하며,
 * 백엔드 sanitize 화이트리스트(정렬/폰트/굵기 등)와 맞춘다. 값은 HTML 문자열.
 * 줄바꿈(Enter)은 <div>/<br>로 저장되어 메일에도 그대로 반영된다.
 */
import { useEffect, useRef } from 'react'
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Eraser } from 'lucide-react'

const FONT_FAMILIES = [
  { label: '기본', value: '' },
  { label: '맑은 고딕', value: "'Malgun Gothic', sans-serif" },
  { label: '굴림', value: 'Gulim, sans-serif' },
  { label: '돋움', value: 'Dotum, sans-serif' },
  { label: '바탕', value: 'Batang, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
]
const FONT_SIZES = [
  { label: '작게', value: '2' },
  { label: '보통', value: '3' },
  { label: '크게', value: '5' },
  { label: '매우 크게', value: '6' },
]

/** 저장값이 HTML 태그를 포함하지 않으면(구 평문 데이터) 줄바꿈을 <br>로 변환해 표시. */
function toHtml(value: string): string {
  if (!value) return ''
  if (/<[a-z][\s\S]*>/i.test(value)) return value
  return value.replace(/\n/g, '<br>')
}

export default function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  minHeight = 96,
}: {
  value: string
  onChange: (html: string) => void
  ariaLabel?: string
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  // 외부 value 가 에디터 내용과 다를 때만 innerHTML 갱신(커서 유지를 위해 입력 중엔 건드리지 않음)
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== value) {
      el.innerHTML = toHtml(value)
    }
    // value 는 초기/외부 변경 시에만 반영; 입력 이벤트는 emit 으로 처리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML)
  }

  function exec(command: string, arg?: string) {
    const el = ref.current
    if (!el) return
    el.focus()
    try {
      // 서식을 인라인 style 로 출력(태그 대신)해 백엔드 sanitize 와 호환
      document.execCommand('styleWithCSS', false, 'true')
    } catch {
      /* 일부 브라우저 미지원 무시 */
    }
    document.execCommand(command, false, arg)
    emit()
  }

  const btn =
    'inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-200'

  return (
    <div className="rounded-lg border border-slate-300 focus-within:border-blue-500">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1.5">
        <button type="button" title="굵게" aria-label="굵게" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" title="기울임" aria-label="기울임" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" title="밑줄" aria-label="밑줄" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
          <Underline className="h-4 w-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" title="왼쪽 정렬" aria-label="왼쪽 정렬" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyLeft')}>
          <AlignLeft className="h-4 w-4" />
        </button>
        <button type="button" title="가운데 정렬" aria-label="가운데 정렬" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyCenter')}>
          <AlignCenter className="h-4 w-4" />
        </button>
        <button type="button" title="오른쪽 정렬" aria-label="오른쪽 정렬" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyRight')}>
          <AlignRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <select aria-label="글꼴" className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
          defaultValue="" onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => { if (e.target.value) exec('fontName', e.target.value); e.currentTarget.selectedIndex = 0 }}>
          {FONT_FAMILIES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select aria-label="글자 크기" className="rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-600"
          defaultValue="" onChange={(e) => { if (e.target.value) exec('fontSize', e.target.value); e.currentTarget.selectedIndex = 0 }}>
          <option value="">크기</option>
          {FONT_SIZES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" title="서식 지우기" aria-label="서식 지우기" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}>
          <Eraser className="h-4 w-4" />
        </button>
      </div>

      {/* 편집 영역 */}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        className="prose-sm max-w-none px-3 py-2 text-sm text-slate-800 outline-none"
        style={{ minHeight }}
      />
    </div>
  )
}
