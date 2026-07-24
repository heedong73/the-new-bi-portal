/** 서비스 요청 상세 모달 (사용자·관리자 공용).
 *
 * 좌: 제목/상태/내용 + 첨부 + 대화(댓글). 우: 메타(상태/구분/요청자/부서/생성일/완료예정)
 * + 관리자 처리(운영자 전용: 상태 변경 접수·반려·완료 / 완료예정일 설정). (R17)
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, ImageIcon, FileText } from 'lucide-react'

import { requestsApi } from '@/api/requestsApi'
import RequestComments from '@/components/RequestComments'
import {
  ADMIN_STATUS_OPTIONS,
  REQUEST_STATUS_CLS,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  formatFileSize,
  type RequestStatus,
} from '@/types/request'

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{children}</dd>
    </div>
  )
}

export default function RequestDetailModal({
  requestId,
  isOperator,
  onClose,
}: {
  requestId: number
  isOperator: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const detailQuery = useQuery({
    queryKey: ['request', requestId],
    queryFn: ({ signal }) => requestsApi.get(requestId, signal),
  })
  const r = detailQuery.data

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['request', requestId] })
    queryClient.invalidateQueries({ queryKey: ['requests'] })
  }

  // 관리자 처리 상태
  const [statusSel, setStatusSel] = useState<RequestStatus | ''>('')
  const [rejectReason, setRejectReason] = useState('')
  const [dueDate, setDueDate] = useState('')

  const statusMutation = useMutation({
    mutationFn: () =>
      requestsApi.update(requestId, {
        status: statusSel as RequestStatus,
        reject_reason: statusSel === 'rejected' ? rejectReason.trim() : undefined,
      }),
    onSuccess: () => { setStatusSel(''); setRejectReason(''); invalidate() },
  })
  const dueMutation = useMutation({
    mutationFn: () => requestsApi.update(requestId, { expected_completion_date: dueDate || null }),
    onSuccess: () => invalidate(),
  })

  const rejectMissing = statusSel === 'rejected' && rejectReason.trim() === ''
  const canChangeStatus = statusSel !== '' && !rejectMissing && !statusMutation.isPending

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-6 w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
        <div className="flex justify-end p-3">
          <button type="button" aria-label="닫기" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {detailQuery.isLoading || !r ? (
          <p className="px-6 pb-8 text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-[1fr_18rem]">
            {/* 좌: 본문 + 대화 */}
            <div className="min-w-0">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_CLS[r.status]}`}>
                {REQUEST_STATUS_LABEL[r.status]}
              </span>
              <h2 className="mt-2 text-lg font-bold text-slate-800">{r.title}</h2>
              <div className="mt-0.5 text-xs text-slate-400">
                {r.requester_name ?? `#${r.requester_id}`} · {fmtDateTime(r.created_at)}
              </div>

              {r.body && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  {r.body}
                </p>
              )}

              {r.reject_reason && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  <span className="font-medium">반려 사유</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{r.reject_reason}</p>
                </div>
              )}
              {r.operator_response && (
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-600">운영자 응답</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{r.operator_response}</p>
                </div>
              )}

              {r.attachments.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {r.attachments.map((a) => (
                    <li key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                      {a.is_image ? <ImageIcon className="h-3.5 w-3.5 text-blue-500" /> : <FileText className="h-3.5 w-3.5 text-slate-400" />}
                      <a href={requestsApi.attachmentUrl(a.id)} target="_blank" rel="noopener noreferrer"
                        className="max-w-[12rem] truncate font-medium text-blue-600 hover:underline" title={a.file_name}>
                        {a.file_name}
                      </a>
                      {a.file_size != null && <span className="text-slate-400">{formatFileSize(a.file_size)}</span>}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4">
                <div className="mb-1 text-sm font-bold text-slate-700">💬 대화</div>
                <RequestComments requestId={requestId} comments={r.comments} onAdded={invalidate} />
              </div>
            </div>

            {/* 우: 메타 + 관리자 처리 */}
            <aside className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <dl className="divide-y divide-slate-100">
                <MetaRow label="상태">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_CLS[r.status]}`}>
                    {REQUEST_STATUS_LABEL[r.status]}
                  </span>
                </MetaRow>
                <MetaRow label="구분">{REQUEST_TYPE_LABEL[r.request_type] ?? r.request_type}</MetaRow>
                <MetaRow label="요청자">{r.requester_name ?? `#${r.requester_id}`}</MetaRow>
                <MetaRow label="부서">{r.requester_department ?? '-'}</MetaRow>
                <MetaRow label="생성일">{fmtDate(r.created_at)}</MetaRow>
                <MetaRow label="완료예정">{fmtDate(r.expected_completion_date)}</MetaRow>
              </dl>

              {r.status_history.length > 0 && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <h3 className="mb-2 text-sm font-bold text-slate-700">상태 변경 이력</h3>
                  <ol className="space-y-2 border-l-2 border-slate-100 pl-3">
                    {r.status_history.map((h) => (
                      <li key={h.id} className="relative">
                        <span className="absolute -left-[1.16rem] top-1 h-2 w-2 rounded-full border-2 border-white bg-slate-300" />
                        <div className="flex flex-wrap items-center gap-1">
                          {h.from_status ? (
                            <>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${REQUEST_STATUS_CLS[h.from_status]}`}>
                                {REQUEST_STATUS_LABEL[h.from_status]}
                              </span>
                              <span className="text-slate-400">→</span>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${REQUEST_STATUS_CLS[h.to_status]}`}>
                                {REQUEST_STATUS_LABEL[h.to_status]}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-slate-500">요청 생성</span>
                              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${REQUEST_STATUS_CLS[h.to_status]}`}>
                                {REQUEST_STATUS_LABEL[h.to_status]}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {h.changed_by_label ?? '-'} · {fmtDateTime(h.created_at)}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {isOperator && (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <h3 className="mb-2 text-sm font-bold text-slate-700">관리자 처리</h3>

                  <label className="text-xs text-slate-500">상태 변경</label>
                  <select
                    value={statusSel}
                    onChange={(e) => setStatusSel(e.target.value as RequestStatus | '')}
                    aria-label="상태 변경"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">선택</option>
                    {ADMIN_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  {statusSel === 'rejected' && (
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      placeholder="반려 사유(필수)"
                      aria-label="반려 사유"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                  <button
                    type="button"
                    disabled={!canChangeStatus}
                    onClick={() => statusMutation.mutate()}
                    className="mt-2 w-full rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    변경
                  </button>

                  <label className="mt-4 block text-xs text-slate-500">완료예정일</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      aria-label="완료예정일"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={dueMutation.isPending}
                      onClick={() => dueMutation.mutate()}
                      className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                    >
                      설정
                    </button>
                  </div>

                  {(statusMutation.isError || dueMutation.isError) && (
                    <p role="alert" className="mt-2 text-xs text-red-600">처리에 실패했습니다. 입력값을 확인하세요.</p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
