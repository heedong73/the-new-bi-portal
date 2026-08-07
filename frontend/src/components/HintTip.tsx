/**
 * 항목 제목·라벨 옆에 붙는 도움말 아이콘 + 툴팁 (포털 공용).
 *
 * 브라우저 기본 `title` 속성은 글자 크기·표시 위치·지연시간을 제어할 수 없고
 * 마우스 커서에 가려지기 쉬워, 아이콘 "위쪽"에 고정 표시되는 커스텀 툴팁을 쓴다.
 * 별도 라이브러리 없이 hover(마우스)와 focus(키보드) 모두에서 열린다.
 *
 * 중요: 트리거에 `title` 을 함께 주면 커스텀 툴팁(검은 배경)과 브라우저 기본
 * 툴팁(흰 배경)이 겹쳐 두 개가 보인다. 그래서 `title` 대신 `aria-describedby`
 * 로만 설명을 연결한다. 도움말 툴팁은 반드시 이 컴포넌트를 사용한다.
 */
import { useId, useState } from 'react'
import { Info } from 'lucide-react'

export interface HintTipProps {
  /** 툴팁에 표시할 도움말 문구. */
  text: string
  /** 스크린리더용 트리거 라벨(예: 항목 이름). */
  label: string
}

export default function HintTip({ text, label }: HintTipProps) {
  const tooltipId = useId()
  const [open, setOpen] = useState(false)

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button
        type="button"
        aria-label={`${label} 도움말`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // 클릭(모바일/터치)에서도 토글되도록 — 라벨과 분리된 버튼이라
        // 클릭이 옆 입력/체크박스 값을 바꾸지 않는다.
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex cursor-help items-center rounded-full p-0.5 text-slate-400 transition hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[20rem] -translate-x-1/2 whitespace-normal rounded-md bg-slate-800 px-2.5 py-1.5 text-left text-[13px] font-normal leading-snug text-white shadow-lg"
        >
          {text}
          <span
            aria-hidden
            className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-slate-800"
          />
        </span>
      )}
    </span>
  )
}
