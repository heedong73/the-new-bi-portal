/**
 * 작성자 선택 입력 (검색형 드롭다운 + 자유 텍스트, Task F).
 *
 * - 인사 DB(org/members)에서 이름/사번/이메일로 검색해 "이름(사번)" 형태로 선택.
 * - 검색 결과에 없는 사람(퇴직자 등)은 자유 텍스트로 직접 입력 가능.
 * - 값(value)은 author_label 문자열 그대로다.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'

import { orgApi } from '@/api/adminApi'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function AuthorPicker({ value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // 입력값 디바운스 (검색어). 300ms.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.trim()), 300)
    return () => window.clearTimeout(t)
  }, [value])

  // 바깥 클릭 시 닫기
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const membersQuery = useQuery({
    queryKey: ['author-search', debounced],
    queryFn: ({ signal }) => orgApi.members({ q: debounced }, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  })

  const results = membersQuery.data ?? []

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? '이름·사번 검색 또는 직접 입력'}
          aria-label="작성자"
          className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none"
        />
      </div>
      {open && debounced.length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {membersQuery.isLoading ? (
            <p className="px-3 py-2 text-xs text-slate-400">검색 중…</p>
          ) : membersQuery.isError ? (
            <p className="px-3 py-2 text-xs text-slate-400">검색할 수 없습니다. 직접 입력하세요.</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">결과 없음. 입력한 값을 그대로 사용합니다.</p>
          ) : (
            results.map((m) => {
              const label = `${m.name}(${m.emp_no})`
              return (
                <button
                  key={m.emp_no}
                  type="button"
                  onClick={() => { onChange(label); setOpen(false) }}
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-slate-50"
                >
                  <span className="text-sm text-slate-800">{label}</span>
                  <span className="text-xs text-slate-400">
                    {[m.dept_name, m.ofc_name].filter(Boolean).join(' · ') || ' '}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
