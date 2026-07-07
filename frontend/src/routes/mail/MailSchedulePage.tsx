/** 메일 스케줄 관리 — 목록 + 생성/수정.
 *
 * 폼 순서: 스케줄명 → 레포트(폴더 트리 선택) → 페이지(페이지명 다중선택) →
 * Export 형식 → 메일 제목 → 상단/하단 안내문구 → 수신자 → 발송 스케줄(주기/시간/기간)
 * → 발송 제외(주말/공휴일)/활성화. 요구사항: R16.
 */
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, ArrowUp, ArrowDown, GripVertical } from 'lucide-react'

import { mailSchedulesApi } from '@/api/mailApi'
import { reportAdminApi } from '@/api/reportAdminApi'
import { usersApi, groupsApi } from '@/api/adminApi'
import ReportPickerTree from './ReportPickerTree'
import RichTextEditor from '@/components/RichTextEditor'
import type {
  MailSchedule,
  MailScheduleCreate,
  RecipientItem,
  RecipientType,
  ScheduleFreq,
} from '@/types/mail'

const RECIPIENT_TYPES: RecipientType[] = ['USER', 'GROUP', 'DEPARTMENT', 'EMAIL']
const RECIPIENT_LABEL: Record<RecipientType, string> = {
  USER: '사용자', GROUP: '그룹', DEPARTMENT: '부서', EMAIL: '직접입력',
}
const WEEKDAYS: { v: number; l: string }[] = [
  { v: 0, l: '일' }, { v: 1, l: '월' }, { v: 2, l: '화' }, { v: 3, l: '수' },
  { v: 4, l: '목' }, { v: 5, l: '금' }, { v: 6, l: '토' },
]

function emptyForm(): MailScheduleCreate {
  return {
    report_id: 0,
    title: '',
    subject_template: '',
    sender_email: '',
    body_header: '',
    body_footer: '',
    image_width: '',
    image_resize_px: null,
    export_format: 'PNG',
    enabled: true,
    schedule_freq: 'daily',
    schedule_time: '09:00',
    schedule_days: [],
    schedule_day_of_month: 1,
    start_date: null,
    end_date: null,
    skip_weekends: true,
    skip_holidays: true,
    recipients: [],
    pages: [],
  }
}

function toForm(s: MailSchedule): MailScheduleCreate {
  return {
    report_id: s.report_id,
    title: s.title,
    subject_template: s.subject_template ?? '',
    sender_email: s.sender_email ?? '',
    body_header: s.body_header ?? '',
    body_footer: s.body_footer ?? '',
    image_width: s.image_width ?? '',
    image_resize_px: s.image_resize_px ?? null,
    export_format: s.export_format,
    enabled: s.enabled,
    schedule_freq: s.schedule_freq ?? 'daily',
    schedule_time: s.schedule_time ?? '09:00',
    schedule_days: s.schedule_days ?? [],
    schedule_day_of_month: s.schedule_day_of_month ?? 1,
    start_date: s.start_date ?? null,
    end_date: s.end_date ?? null,
    skip_weekends: s.skip_weekends ?? true,
    skip_holidays: s.skip_holidays ?? true,
    recipients: s.recipients.map((r) => ({ ...r })),
    pages: s.pages.map((p) => ({ ...p })),
  }
}

export default function MailSchedulePage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState<MailScheduleCreate>(emptyForm())
  // 삭제 확인 대상 스케줄 (null = 확인창 닫힘)
  const [confirmDelete, setConfirmDelete] = useState<MailSchedule | null>(null)

  const listQuery = useQuery({
    queryKey: ['mail-schedules'],
    queryFn: ({ signal }) => mailSchedulesApi.list(signal),
    staleTime: 30_000,
  })

  // 레포트 id → 표시명 (목록 테이블 + 선택 표시용)
  const reportsQuery = useQuery({
    queryKey: ['admin-reports'],
    queryFn: ({ signal }) => reportAdminApi.list(signal),
    staleTime: 30_000,
  })
  const reportName = (id: number): string => {
    const r = (reportsQuery.data ?? []).find((x) => x.id === id)
    return r ? (r.display_name || r.report_name || r.report_id) : `#${id}`
  }

  // 선택 레포트의 페이지 목록 (페이지명 선택용)
  const pagesQuery = useQuery({
    queryKey: ['report-pages', form.report_id],
    queryFn: ({ signal }) => mailSchedulesApi.reportPages(form.report_id, signal),
    enabled: editingId !== null && form.report_id > 0,
    staleTime: 60_000,
  })

  // 수신자 선택용 사용자/그룹 목록 (이름으로 선택)
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    enabled: editingId !== null,
    staleTime: 60_000,
  })
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: ({ signal }) => groupsApi.list(signal),
    enabled: editingId !== null,
    staleTime: 60_000,
  })
  const users = usersQuery.data ?? []
  const groups = groupsQuery.data ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['mail-schedules'] })

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId === 'new'
        ? mailSchedulesApi.create(form)
        : mailSchedulesApi.update(editingId as number, form),
    onSuccess: () => { setEditingId(null); invalidate() },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => mailSchedulesApi.remove(id),
    onSuccess: () => { setConfirmDelete(null); invalidate() },
  })

  const schedules = listQuery.data ?? []

  function openNew() { setForm(emptyForm()); setEditingId('new') }
  function openEdit(s: MailSchedule) { setForm(toForm(s)); setEditingId(s.id) }

  function setField<K extends keyof MailScheduleCreate>(key: K, value: MailScheduleCreate[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // 레포트 선택 — 다른 레포트로 바꾸면 기존 페이지 선택 초기화
  function selectReport(id: number) {
    setForm((f) => (id === f.report_id ? f : { ...f, report_id: id, pages: [] }))
  }

  // 페이지 선택 토글 (페이지명 기준). 추가/삭제 후 sort_order 재정렬.
  function reindexPages(pages: typeof form.pages) {
    return pages.map((p, idx) => ({ ...p, sort_order: idx }))
  }
  function togglePage(pageName: string, caption: string, checked: boolean) {
    setForm((f) => {
      if (checked) {
        if (f.pages.some((p) => p.page_name === pageName)) return f
        return { ...f, pages: reindexPages([...f.pages, { page_name: pageName, caption, sort_order: f.pages.length }]) }
      }
      return { ...f, pages: reindexPages(f.pages.filter((p) => p.page_name !== pageName)) }
    })
  }
  // 발송 순서 이동 (PNG 삽입 순서)
  function movePage(idx: number, dir: -1 | 1) {
    setForm((f) => {
      const arr = [...f.pages].sort((a, b) => a.sort_order - b.sort_order)
      const j = idx + dir
      if (j < 0 || j >= arr.length) return f
      ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
      return { ...f, pages: reindexPages(arr) }
    })
  }

  // 수신자 표시 라벨 (요약 목록용)
  function recipientLabel(r: RecipientItem): string | null {
    if (r.recipient_type === 'EMAIL') return r.email?.trim() || null
    if (r.recipient_id == null) return null
    if (r.recipient_type === 'USER') {
      const u = users.find((x) => x.id === r.recipient_id)
      return u ? `${u.name}(${u.emp_no})` : `사용자 #${r.recipient_id}`
    }
    if (r.recipient_type === 'GROUP') {
      const g = groups.find((x) => x.id === r.recipient_id)
      return g ? g.name : `그룹 #${r.recipient_id}`
    }
    return `부서 #${r.recipient_id}`
  }

  // 주간 요일 토글
  function toggleWeekday(v: number, checked: boolean) {
    setForm((f) => {
      const cur = new Set(f.schedule_days ?? [])
      checked ? cur.add(v) : cur.delete(v)
      return { ...f, schedule_days: [...cur].sort((a, b) => a - b) }
    })
  }

  // 수신자 입력창(1개) → 추가 버튼으로 리스트에 append. 매번 입력행이 늘지 않도록.
  const [newRecipType, setNewRecipType] = useState<RecipientType>('USER')
  const [newRecipEmail, setNewRecipEmail] = useState('')
  const [newRecipId, setNewRecipId] = useState('')
  const dragIndex = useRef<number | null>(null)

  function addRecipientFromInput() {
    setForm((f) => {
      if (newRecipType === 'EMAIL') {
        const email = newRecipEmail.trim()
        if (!email) return f
        if (f.recipients.some((r) => r.recipient_type === 'EMAIL' && (r.email ?? '').toLowerCase() === email.toLowerCase())) return f
        return { ...f, recipients: [...f.recipients, { recipient_type: 'EMAIL', email }] }
      }
      const id = Number(newRecipId)
      if (!id) return f
      if (f.recipients.some((r) => r.recipient_type === newRecipType && r.recipient_id === id)) return f
      return { ...f, recipients: [...f.recipients, { recipient_type: newRecipType, recipient_id: id }] }
    })
    setNewRecipEmail('')
    setNewRecipId('')
  }
  function removeRecipient(i: number) {
    setForm((f) => ({ ...f, recipients: f.recipients.filter((_, idx) => idx !== i) }))
  }
  function moveRecipient(i: number, dir: -1 | 1) {
    setForm((f) => {
      const arr = [...f.recipients]
      const j = i + dir
      if (j < 0 || j >= arr.length) return f
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...f, recipients: arr }
    })
  }
  function dropRecipient(to: number) {
    const from = dragIndex.current
    dragIndex.current = null
    if (from === null || from === to) return
    setForm((f) => {
      const arr = [...f.recipients]
      const [m] = arr.splice(from, 1)
      arr.splice(to, 0, m)
      return { ...f, recipients: arr }
    })
  }
  const newRecipValid = newRecipType === 'EMAIL' ? newRecipEmail.trim() !== '' : newRecipId !== ''

  const canSave = form.report_id > 0 && form.title.trim().length > 0 && !saveMutation.isPending

  const apiPages = pagesQuery.data ?? []
  // form.pages 중 API 목록에 없는 항목(레거시 수동 페이지명)도 표시
  const extraPages = form.pages.filter((p) => !apiPages.some((ap) => ap.name === p.page_name))

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">메일 스케줄</h1>
        <button type="button" onClick={openNew}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">
          <Plus className="h-4 w-4" /> 새 스케줄
        </button>
      </div>

      {/* 목록 */}
      {listQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">스케줄명</th>
                <th className="px-4 py-3">레포트</th>
                <th className="px-4 py-3">주기</th>
                <th className="px-4 py-3">수신자/페이지</th>
                <th className="px-4 py-3">활성</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((s: MailSchedule) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.title}</td>
                  <td className="px-4 py-3 text-slate-600">{reportName(s.report_id)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{freqSummary(s)}</td>
                  <td className="px-4 py-3 text-slate-500">{s.recipients.length} / {s.pages.length}</td>
                  <td className="px-4 py-3">
                    {s.enabled
                      ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">활성</span>
                      : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">비활성</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openEdit(s)} className="mr-2 text-xs text-blue-600 hover:underline">수정</button>
                    <button type="button" onClick={() => { deleteMutation.reset(); setConfirmDelete(s) }} className="text-xs text-red-600 hover:underline">삭제</button>
                  </td>
                </tr>
              ))}
              {schedules.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">등록된 스케줄이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 생성/수정 폼 (모달) */}
      {editingId !== null && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="my-8 w-full max-w-5xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                {editingId === 'new' ? '새 메일 스케줄' : '메일 스케줄 수정'}
              </h2>
              <button type="button" aria-label="닫기" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate() }} className="space-y-4">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 lg:items-start">
                <div className="space-y-4">
              {/* 1. 스케줄명 */}
              <Field label="스케줄명">
                <input value={form.title} aria-label="스케줄명"
                  onChange={(e) => setField('title', e.target.value)} className={inputCls} />
              </Field>

              {/* 2. 레포트 (폴더 트리에서 선택) */}
              <Field label="레포트">
                <div className="mb-1 text-xs text-slate-500">
                  {form.report_id > 0 ? <>선택됨: <span className="font-medium text-slate-700">{reportName(form.report_id)}</span></> : '폴더에서 레포트를 선택하세요.'}
                </div>
                <ReportPickerTree value={form.report_id} onChange={(id) => selectReport(id)} />
              </Field>

              {/* 3. 레포트 페이지 선택 (페이지명 다중선택) */}
              <Field label="레포트 페이지 선택 (다중 선택)">
                {form.report_id <= 0 ? (
                  <p className="text-xs text-slate-400">먼저 레포트를 선택하세요.</p>
                ) : pagesQuery.isLoading ? (
                  <p className="text-xs text-slate-400">페이지 불러오는 중…</p>
                ) : pagesQuery.isError ? (
                  <p className="text-xs text-red-500">페이지를 불러오지 못했습니다.</p>
                ) : apiPages.length === 0 && extraPages.length === 0 ? (
                  <p className="text-xs text-slate-400">선택 가능한 페이지가 없습니다.</p>
                ) : (
                  <div className="space-y-1 rounded-lg border border-slate-300 p-2">
                    {apiPages.map((p) => {
                      const checked = form.pages.some((fp) => fp.page_name === p.name)
                      return (
                        <label key={p.name} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                          <input type="checkbox" checked={checked}
                            onChange={(e) => togglePage(p.name, p.display_name, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300" />
                          <span className="text-slate-700">{p.display_name}</span>
                          <span className="text-xs text-slate-400">({p.name})</span>
                        </label>
                      )
                    })}
                    {extraPages.map((p) => (
                      <label key={p.page_name} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked
                          onChange={() => togglePage(p.page_name, p.caption ?? '', false)}
                          className="h-4 w-4 rounded border-slate-300" />
                        <span className="text-slate-700">{p.caption || p.page_name}</span>
                        <span className="text-xs text-amber-500">(목록에 없음)</span>
                      </label>
                    ))}
                  </div>
                )}
              </Field>

              {/* 3-1. 선택된 페이지 발송 순서 (PNG 삽입 순서) */}
              {form.pages.length > 0 && (
                <Field label="발송 순서 (PNG 삽입 순서)">
                  <ol className="space-y-1">
                    {[...form.pages].sort((a, b) => a.sort_order - b.sort_order).map((p, idx, arr) => (
                      <li key={p.page_name} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                        <span className="w-5 shrink-0 text-center text-xs font-medium text-slate-400">{idx + 1}</span>
                        <span className="flex-1 truncate text-slate-700">{p.caption || p.page_name}</span>
                        <button type="button" disabled={idx === 0} onClick={() => movePage(idx, -1)} aria-label="위로"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" disabled={idx === arr.length - 1} onClick={() => movePage(idx, 1)} aria-label="아래로"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                        <button type="button" onClick={() => togglePage(p.page_name, p.caption ?? '', false)} aria-label="제거"
                          className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </li>
                    ))}
                  </ol>
                </Field>
              )}

              {/* 4. Export 형식 + 이미지 리사이즈 */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Export 형식">
                  <select value={form.export_format} onChange={(e) => setField('export_format', e.target.value)} className={inputCls}>
                    <option>PNG</option><option>PDF</option><option>PPTX</option>
                  </select>
                </Field>
                <Field label="이미지 리사이즈(px, 선택)">
                  <input type="number" value={form.image_resize_px ?? ''}
                    onChange={(e) => setField('image_resize_px', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                  <p className="mt-1 text-xs text-slate-400">메일 본문 이미지를 이 폭(px)으로 비율 유지하며 축소합니다. 비우면 원본 그대로. 원본보다 큰 값은 확대하지 않습니다.</p>
                </Field>
              </div>
                </div>

                <div className="space-y-4">
              {/* 5. 메일 제목(수신자에게 표시) */}
              <Field label="메일 제목 (수신자에게 표시)">
                <input value={form.subject_template ?? ''} placeholder="예: {date} 일일 보고서"
                  onChange={(e) => setField('subject_template', e.target.value)} className={inputCls} />
              </Field>

              {/* 5-1. 보내는 사람(From) — 비우면 서버 기본값 */}
              <Field label="보내는 사람 이메일 (선택)">
                <input type="email" value={form.sender_email ?? ''} placeholder="비우면 기본 발신 주소로 발송"
                  aria-label="보내는 사람 이메일"
                  onChange={(e) => setField('sender_email', e.target.value)} className={inputCls} />
                <p className="mt-1 text-xs text-slate-400">비우면 시스템 기본 발신 주소로 발송됩니다. 메일 서버 정책상 허용되지 않는 주소는 발송이 거부될 수 있습니다.</p>
              </Field>

              {/* 6/7. 상단/하단 안내문구 (리치 텍스트) */}
              <Field label="상단 안내문구">
                <RichTextEditor value={form.body_header ?? ''} ariaLabel="상단 안내문구"
                  onChange={(html) => setField('body_header', html)} />
              </Field>
              <Field label="하단 안내문구">
                <RichTextEditor value={form.body_footer ?? ''} ariaLabel="하단 안내문구"
                  onChange={(html) => setField('body_footer', html)} minHeight={72} />
              </Field>

              {/* 8. 수신자 — 입력창 1개로 선택 후 "추가" → 아래 리스트로 표시 + 순서 변경 */}
              <div>
                <span className="mb-2 block text-sm font-medium text-slate-700">수신자</span>
                <div className="flex items-center gap-2">
                  <select value={newRecipType} aria-label="수신자 유형"
                    onChange={(e) => { setNewRecipType(e.target.value as RecipientType); setNewRecipEmail(''); setNewRecipId('') }}
                    className={`${rowInputCls} w-28 shrink-0`}>
                    {RECIPIENT_TYPES.map((t) => <option key={t} value={t}>{RECIPIENT_LABEL[t]}</option>)}
                  </select>
                  {newRecipType === 'EMAIL' ? (
                    <input value={newRecipEmail} placeholder="email@삼천리.com" aria-label="수신자 이메일"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipientFromInput() } }}
                      onChange={(e) => setNewRecipEmail(e.target.value)} className={`${rowInputCls} flex-1 min-w-0`} />
                  ) : newRecipType === 'USER' ? (
                    <select value={newRecipId} aria-label="수신자 사용자"
                      onChange={(e) => setNewRecipId(e.target.value)} className={`${rowInputCls} flex-1 min-w-0`}>
                      <option value="">사용자 선택…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.emp_no}){u.email ? ` · ${u.email}` : ''}</option>
                      ))}
                    </select>
                  ) : newRecipType === 'GROUP' ? (
                    <select value={newRecipId} aria-label="수신자 그룹"
                      onChange={(e) => setNewRecipId(e.target.value)} className={`${rowInputCls} flex-1 min-w-0`}>
                      <option value="">그룹 선택…</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="number" value={newRecipId} placeholder="부서 ID" aria-label="수신자 부서 ID"
                      onChange={(e) => setNewRecipId(e.target.value)} className={`${rowInputCls} flex-1 min-w-0`} />
                  )}
                  <button type="button" onClick={addRecipientFromInput} disabled={!newRecipValid}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                    <Plus className="h-4 w-4" /> 추가
                  </button>
                </div>

                {form.recipients.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">추가된 수신자가 없습니다. 위에서 선택 후 "추가"를 누르세요.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {form.recipients.map((r, i) => {
                      const label = recipientLabel(r)
                      return (
                        <li key={i} draggable
                          onDragStart={() => { dragIndex.current = i }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => dropRecipient(i)}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-300" />
                          <span className="w-5 shrink-0 text-center text-xs font-medium text-slate-400">{i + 1}</span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{RECIPIENT_LABEL[r.recipient_type]}</span>
                          <span className={`flex-1 truncate ${label ? 'text-slate-700' : 'text-amber-600'}`}>{label ?? '미선택'}</span>
                          <button type="button" disabled={i === 0} onClick={() => moveRecipient(i, -1)} aria-label="위로"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                          <button type="button" disabled={i === form.recipients.length - 1} onClick={() => moveRecipient(i, 1)} aria-label="아래로"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                          <button type="button" onClick={() => removeRecipient(i)} aria-label={`수신자 ${i + 1} 삭제`}
                            className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
                </div>
              </div>

              {/* 9. 발송 스케줄 (주기/시간/기간) */}
              <div className="rounded-lg border border-slate-200 px-3 py-3">
                <p className="mb-2 text-sm font-medium text-slate-700">발송 스케줄</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="주기">
                    <select value={form.schedule_freq ?? 'daily'}
                      onChange={(e) => setField('schedule_freq', e.target.value as ScheduleFreq)} className={inputCls}>
                      <option value="daily">매일</option>
                      <option value="weekly">매주</option>
                      <option value="monthly">매월</option>
                    </select>
                  </Field>
                  <Field label="시간">
                    <input type="time" value={form.schedule_time ?? ''}
                      onChange={(e) => setField('schedule_time', e.target.value)} className={inputCls} />
                  </Field>
                </div>

                {form.schedule_freq === 'weekly' && (
                  <div className="mt-2">
                    <span className="mb-1 block text-xs font-medium text-slate-600">요일 선택</span>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((d) => {
                        const on = (form.schedule_days ?? []).includes(d.v)
                        return (
                          <button key={d.v} type="button" onClick={() => toggleWeekday(d.v, !on)}
                            className={`h-8 w-8 rounded-full text-sm ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            {d.l}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {form.schedule_freq === 'monthly' && (
                  <div className="mt-2">
                    <Field label="매월 며칠">
                      <input type="number" min={1} max={31} value={form.schedule_day_of_month ?? 1}
                        onChange={(e) => setField('schedule_day_of_month', Number(e.target.value))}
                        className={`${inputCls} w-28`} />
                    </Field>
                  </div>
                )}

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label="시작일 (선택)">
                    <input type="date" value={form.start_date ?? ''}
                      onChange={(e) => setField('start_date', e.target.value || null)} className={inputCls} />
                  </Field>
                  <Field label="종료일 (선택)">
                    <input type="date" value={form.end_date ?? ''}
                      onChange={(e) => setField('end_date', e.target.value || null)} className={inputCls} />
                  </Field>
                </div>
              </div>

              {/* 10. 발송 제외 + 활성화 */}
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="mb-2 text-xs font-medium text-slate-500">발송 제외 (해당 일에는 메일을 보내지 않음)</p>
                <div className="flex flex-wrap gap-5">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.skip_weekends ?? true}
                      onChange={(e) => setField('skip_weekends', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    주말 제외
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.skip_holidays ?? true}
                      onChange={(e) => setField('skip_holidays', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    공휴일 제외
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.enabled ?? true}
                      onChange={(e) => setField('enabled', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    활성화
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-400">활성화를 끄면 스케줄은 저장되지만 발송되지 않습니다(일시중지). 다시 켜면 설정한 주기로 발송이 재개됩니다.</p>
              </div>

              {saveMutation.isError && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">저장에 실패했습니다. 입력값을 확인하세요.</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">취소</button>
                <button type="submit" disabled={!canSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-800">메일 스케줄 삭제</h2>
            <p className="mt-2 text-sm text-slate-600">
              '<span className="font-medium text-slate-800">{confirmDelete.title}</span>' 스케줄을 삭제할까요?
            </p>
            <p className="mt-1 text-xs text-slate-400">
              관련 수신자·페이지·발송 이력이 함께 삭제되며 되돌릴 수 없습니다.
            </p>
            {deleteMutation.isError && (
              <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleteMutation.isPending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> {deleteMutation.isPending ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 w-full'
// 수신자 행처럼 flex 안에서 폭을 직접 제어하는 입력용(위 inputCls의 w-full 충돌 방지)
const rowInputCls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500'

function freqSummary(s: MailSchedule): string {
  if (!s.schedule_freq) return s.cron_expr ?? '-'
  const time = s.schedule_time ?? ''
  if (s.schedule_freq === 'weekly') {
    const days = (s.schedule_days ?? []).map((d) => WEEKDAYS[d]?.l ?? d).join('')
    return `매주 ${days} ${time}`.trim()
  }
  if (s.schedule_freq === 'monthly') {
    return `매월 ${s.schedule_day_of_month ?? 1}일 ${time}`.trim()
  }
  return `매일 ${time}`.trim()
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}
