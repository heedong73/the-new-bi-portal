/** 서비스 센터 — 서비스 요청 목록 + 작성 + 상세(대화/관리자 처리).
 *
 * - 일반 사용자: 본인 요청만. System_Operator: 전체 + 상세에서 관리자 처리.
 * - 유형: 문의/에러/개선요청. 상태: 대기/접수/반려/완료. (R17)
 */
import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, RotateCcw, ClipboardList, Paperclip, X, ChevronLeft, ChevronRight } from 'lucide-react'

import { requestsApi } from '@/api/requestsApi'
import { useAuthStore } from '@/stores/useAuthStore'
import RequestDetailModal from '@/components/RequestDetailModal'
import {
  REQUEST_STATUS_CLS,
  REQUEST_STATUS_DOT,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  formatFileSize,
  type RequestStatus,
  type RequestType,
  type ServiceRequest,
} from '@/types/request'

const PAGE_SIZE = 20
const MAX_MB = 10
const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.log,.zip'
const ALLOWED_EXTS = ['png','jpg','jpeg','gif','webp','bmp','pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','log','zip']
const TYPE_ICON: Record<RequestType, string> = { inquiry: '💬', error: '🐞', improvement: '✨' }

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}
function relTime(iso: string): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return iso
  const diff = Date.now() - d
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금 전'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}일 전`
  return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })
}

export default function ServiceCenterPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isOperator = (user?.roles ?? []).includes('System_Operator')

  const [typeFilter, setTypeFilter] = useState<'' | RequestType>('')
  const [statusFilter, setStatusFilter] = useState<'' | RequestStatus>('')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)

  const listQuery = useQuery({
    queryKey: ['requests', 'list'],
    queryFn: ({ signal }) => requestsApi.list({}, signal),
    staleTime: 15_000,
  })
  const all = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase()
    return all.filter((r) => {
      if (typeFilter && r.request_type !== typeFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const t = r.title.toLowerCase()
        const name = (r.requester_name ?? '').toLowerCase()
        if (!t.includes(q) && !name.includes(q)) return false
      }
      return true
    })
  }, [all, typeFilter, statusFilter, appliedSearch])

  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const curPage = Math.min(page, pageCount)
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  function resetFilters() {
    setTypeFilter(''); setStatusFilter(''); setSearchInput(''); setAppliedSearch(''); setPage(1)
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['requests'] })

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">
          서비스 요청 <span className="text-sm font-normal text-slate-400">{total}건</span>
        </h1>
        <button type="button" onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
          <Plus className="h-4 w-4" /> 새 요청
        </button>
      </div>

      {/* 필터 바 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as RequestType | ''); setPage(1) }}
          aria-label="구분 필터" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
          <option value="">구분</option>
          <option value="inquiry">문의</option>
          <option value="error">에러</option>
          <option value="improvement">개선요청</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as RequestStatus | ''); setPage(1) }}
          aria-label="상태 필터" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
          <option value="">상태</option>
          <option value="pending">대기</option>
          <option value="received">접수</option>
          <option value="rejected">반려</option>
          <option value="done">완료</option>
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setAppliedSearch(searchInput); setPage(1) } }}
            placeholder="제목 또는 요청자 검색…" aria-label="검색"
            className="w-64 rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm" />
        </div>
        <button type="button" onClick={() => { setAppliedSearch(searchInput); setPage(1) }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          <Search className="h-4 w-4" /> 검색
        </button>
        <button type="button" onClick={resetFilters}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
          <RotateCcw className="h-4 w-4" /> 초기화
        </button>
      </div>

      {/* 목록 */}
      {listQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-20 text-center">
          <ClipboardList className="h-12 w-12 text-orange-300" />
          <p className="mt-3 text-sm text-slate-400">등록된 서비스 요청이 없습니다</p>
          <button type="button" onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
            <Plus className="h-4 w-4" /> 첫 요청 작성하기
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {pageItems.map((r: ServiceRequest) => (
            <li key={r.id}>
              <button type="button" onClick={() => setDetailId(r.id)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-blue-300 hover:shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <span>{TYPE_ICON[r.request_type]} {REQUEST_TYPE_LABEL[r.request_type]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${REQUEST_STATUS_DOT[r.status]}`} />
                      <span className="truncate font-semibold text-slate-800">{r.title}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {r.requester_name ?? `#${r.requester_id}`} · {relTime(r.created_at)}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_CLS[r.status]}`}>
                    {REQUEST_STATUS_LABEL[r.status]}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="mt-6 flex items-center justify-end gap-3 text-sm text-slate-500">
          <span>Total {total}</span>
          <span className="rounded-lg border border-slate-300 px-2 py-1">{PAGE_SIZE}/page</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}
              aria-label="이전" className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-6 rounded bg-blue-50 px-2 py-0.5 text-center font-medium text-blue-600">{curPage}</span>
            <button type="button" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}
              aria-label="다음" className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateRequestModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); invalidate() }}
        />
      )}
      {detailId !== null && (
        <RequestDetailModal requestId={detailId} isOperator={isOperator} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 작성 모달
// ---------------------------------------------------------------------------
function CreateRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<RequestType | ''>('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await requestsApi.create({ request_type: type as RequestType, title: title.trim(), body: body.trim() })
      for (const f of files) await requestsApi.uploadAttachment(created.id, f)
      return created
    },
    onSuccess: onCreated,
  })

  function addFiles(selected: FileList | null) {
    if (!selected) return
    const next: File[] = []
    for (const f of Array.from(selected)) {
      if (!ALLOWED_EXTS.includes(extOf(f.name))) { setFileError(`허용되지 않는 형식: ${f.name}`); continue }
      if (f.size > MAX_MB * 1024 * 1024) { setFileError(`파일이 너무 큽니다(최대 ${MAX_MB}MB): ${f.name}`); continue }
      next.push(f)
    }
    if (next.length) setFileError(null)
    setFiles((prev) => [...prev, ...next].slice(0, 5))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canSubmit = type !== '' && title.trim() !== '' && body.trim() !== '' && !createMutation.isPending

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">서비스 요청 작성</h2>
          <button type="button" aria-label="닫기" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) createMutation.mutate() }} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600"><span className="text-red-500">*</span> 제목</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
              placeholder="요청 제목을 입력하세요" aria-label="제목"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="mt-0.5 text-right text-xs text-slate-400">{title.length} / 200</div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600"><span className="text-red-500">*</span> 내용</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000}
              placeholder="요청 내용을 상세히 입력하세요 (대상 화면/레포트도 여기에 적어주세요)" aria-label="내용"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="mt-0.5 text-right text-xs text-slate-400">{body.length} / 5000</div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600"><span className="text-red-500">*</span> 구분</span>
            <select value={type} onChange={(e) => setType(e.target.value as RequestType | '')} aria-label="구분"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">구분 선택</option>
              <option value="inquiry">문의</option>
              <option value="error">에러</option>
              <option value="improvement">개선요청</option>
            </select>
          </label>

          {/* 첨부 */}
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">첨부파일</span>
            <input ref={fileInputRef} id="sr-file" type="file" multiple accept={ACCEPT}
              onChange={(e) => addFiles(e.target.files)} className="hidden" aria-label="첨부파일 선택" />
            <label htmlFor="sr-file"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-400 hover:border-blue-300 hover:bg-slate-50">
              <Paperclip className="mb-1 h-5 w-5 text-slate-400" />
              파일을 드래그하거나 클릭하여 선택하세요
              <span className="mt-0.5">최대 5개, 10MB 이하 (jpg, png, gif, pdf, xlsx, docx, txt, csv, zip)</span>
            </label>
            {fileError && <p role="alert" className="mt-1 text-xs text-red-600">{fileError}</p>}
            {files.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                    <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                    <span className="max-w-[12rem] truncate" title={f.name}>{f.name}</span>
                    <span className="text-slate-400">{formatFileSize(f.size)}</span>
                    <button type="button" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                      aria-label={`${f.name} 제거`} className="rounded p-0.5 text-slate-400 hover:bg-slate-200"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {createMutation.isError && (
            <p role="alert" className="text-sm text-red-600">등록 실패. 입력값을 확인하세요.</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
            <button type="submit" disabled={!canSubmit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {createMutation.isPending ? '등록 중…' : '등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
