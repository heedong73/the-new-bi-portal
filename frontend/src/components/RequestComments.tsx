/** 서비스 센터 요청 댓글 스레드 (사용자/관리자 화면 공용).
 *
 * 댓글 목록 표시 + 새 댓글 작성. 작성 성공 시 onAdded로 상위에 알려 목록을 갱신한다.
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Send, ShieldCheck, User as UserIcon } from 'lucide-react'

import { requestsApi } from '@/api/requestsApi'
import type { RequestComment } from '@/types/request'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' })
}

export default function RequestComments({
  requestId,
  comments,
  onAdded,
}: {
  requestId: number
  comments: RequestComment[]
  onAdded: () => void
}) {
  const [text, setText] = useState('')

  const addMutation = useMutation({
    mutationFn: () => requestsApi.addComment(requestId, text.trim()),
    onSuccess: () => {
      setText('')
      onAdded()
    },
  })

  const canSend = text.trim() !== '' && !addMutation.isPending

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="text-xs font-medium text-slate-500">대화 {comments.length > 0 && `(${comments.length})`}</div>

      {comments.length > 0 && (
        <ul className="mt-2 space-y-2">
          {comments.map((c) => (
            <li
              key={c.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                c.is_operator ? 'bg-blue-50' : 'bg-slate-50'
              }`}
            >
              <div className="mb-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                {c.is_operator ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                ) : (
                  <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span className="font-medium text-slate-600">{c.author_label ?? '-'}</span>
                {c.is_operator && <span className="text-blue-600">운영자</span>}
                <span className="text-slate-300">·</span>
                <time>{formatDateTime(c.created_at)}</time>
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) addMutation.mutate()
        }}
        className="mt-2 flex items-end gap-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={10000}
          placeholder="댓글을 입력하세요"
          aria-label="댓글 입력"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> 등록
        </button>
      </form>
      {addMutation.isError && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          댓글 등록 실패:{' '}
          {(addMutation.error as { errorDescription?: string })?.errorDescription ??
            '잠시 후 다시 시도해 주세요.'}
        </p>
      )}
    </div>
  )
}
