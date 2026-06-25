/** 메일 스케줄 관리 (T-39) — 목록 + 생성/수정(수신자·페이지·커스터마이징). 요구사항: R16. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'

import { mailSchedulesApi } from '@/api/mailApi'
import type {
  MailSchedule,
  MailScheduleCreate,
  PageItem,
  RecipientItem,
  RecipientType,
} from '@/types/mail'

const RECIPIENT_TYPES: RecipientType[] = ['USER', 'GROUP', 'DEPARTMENT', 'EMAIL']

function emptyForm(): MailScheduleCreate {
  return {
    report_id: 0,
    title: '',
    subject_template: '',
    body_header: '',
    body_footer: '',
    image_width: '',
    image_resize_px: null,
    cron_expr: '',
    export_format: 'PNG',
    enabled: true,
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
    body_header: s.body_header ?? '',
    body_footer: s.body_footer ?? '',
    image_width: s.image_width ?? '',
    image_resize_px: s.image_resize_px ?? null,
    cron_expr: s.cron_expr ?? '',
    export_format: s.export_format,
    enabled: s.enabled,
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

  const listQuery = useQuery({
    queryKey: ['mail-schedules'],
    queryFn: ({ signal }) => mailSchedulesApi.list(signal),
    staleTime: 30_000,
  })

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
    onSuccess: () => invalidate(),
  })

  const schedules = listQuery.data ?? []

  function openNew() { setForm(emptyForm()); setEditingId('new') }
  function openEdit(s: MailSchedule) { setForm(toForm(s)); setEditingId(s.id) }

  function setField<K extends keyof MailScheduleCreate>(key: K, value: MailScheduleCreate[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // 수신자 행 조작
  function addRecipient() {
    setForm((f) => ({ ...f, recipients: [...f.recipients, { recipient_type: 'EMAIL', email: '' }] }))
  }
  function updateRecipient(i: number, patch: Partial<RecipientItem>) {
    setForm((f) => ({
      ...f,
      recipients: f.recipients.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }))
  }
  function removeRecipient(i: number) {
    setForm((f) => ({ ...f, recipients: f.recipients.filter((_, idx) => idx !== i) }))
  }

  // 페이지 행 조작
  function addPage() {
    setForm((f) => ({ ...f, pages: [...f.pages, { page_name: '', sort_order: f.pages.length }] }))
  }
  function updatePage(i: number, patch: Partial<PageItem>) {
    setForm((f) => ({ ...f, pages: f.pages.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }))
  }
  function removePage(i: number) {
    setForm((f) => ({ ...f, pages: f.pages.filter((_, idx) => idx !== i) }))
  }

  const canSave = form.report_id > 0 && form.title.trim().length > 0 && !saveMutation.isPending

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">메일 스케줄</h1>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
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
                <th className="px-4 py-3">제목</th>
                <th className="px-4 py-3">레포트</th>
                <th className="px-4 py-3">Cron</th>
                <th className="px-4 py-3">수신자/페이지</th>
                <th className="px-4 py-3">활성</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map((s: MailSchedule) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.title}</td>
                  <td className="px-4 py-3 text-slate-500">#{s.report_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.cron_expr ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{s.recipients.length} / {s.pages.length}</td>
                  <td className="px-4 py-3">
                    {s.enabled
                      ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">활성</span>
                      : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">비활성</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openEdit(s)} className="mr-2 text-xs text-blue-600 hover:underline">수정</button>
                    <button type="button" onClick={() => deleteMutation.mutate(s.id)} className="text-xs text-red-600 hover:underline">삭제</button>
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

      {/* 생성/수정 폼 (간단 모달) */}
      {editingId !== null && (
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                {editingId === 'new' ? '새 메일 스케줄' : '메일 스케줄 수정'}
              </h2>
              <button type="button" aria-label="닫기" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate() }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="레포트 ID *">
                  <input type="number" value={form.report_id || ''} aria-label="레포트 ID"
                    onChange={(e) => setField('report_id', Number(e.target.value))}
                    className={inputCls} />
                </Field>
                <Field label="제목 *">
                  <input value={form.title} aria-label="제목"
                    onChange={(e) => setField('title', e.target.value)} className={inputCls} />
                </Field>
                <Field label="Cron 식">
                  <input value={form.cron_expr ?? ''} placeholder="0 9 * * *"
                    onChange={(e) => setField('cron_expr', e.target.value)} className={inputCls} />
                </Field>
                <Field label="Export 형식">
                  <select value={form.export_format} onChange={(e) => setField('export_format', e.target.value)} className={inputCls}>
                    <option>PNG</option><option>PDF</option><option>PPTX</option>
                  </select>
                </Field>
                <Field label="제목 템플릿">
                  <input value={form.subject_template ?? ''} placeholder="{date} 보고서"
                    onChange={(e) => setField('subject_template', e.target.value)} className={inputCls} />
                </Field>
                <Field label="이미지 리사이즈(px)">
                  <input type="number" value={form.image_resize_px ?? ''}
                    onChange={(e) => setField('image_resize_px', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                </Field>
              </div>

              <Field label="상단 안내문구(HTML)">
                <textarea value={form.body_header ?? ''} rows={2}
                  onChange={(e) => setField('body_header', e.target.value)} className={inputCls} />
              </Field>
              <Field label="하단 안내문구(HTML)">
                <textarea value={form.body_footer ?? ''} rows={2}
                  onChange={(e) => setField('body_footer', e.target.value)} className={inputCls} />
              </Field>

              {/* 수신자 */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">수신자</span>
                  <button type="button" onClick={addRecipient} className="text-xs text-blue-600 hover:underline">+ 추가</button>
                </div>
                <div className="space-y-2">
                  {form.recipients.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select value={r.recipient_type} aria-label={`수신자 ${i + 1} 유형`}
                        onChange={(e) => updateRecipient(i, {
                          recipient_type: e.target.value as RecipientType,
                          recipient_id: null, email: null,
                        })}
                        className={`${inputCls} w-36`}>
                        {RECIPIENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {r.recipient_type === 'EMAIL' ? (
                        <input value={r.email ?? ''} placeholder="email@삼천리.com" aria-label={`수신자 ${i + 1} 이메일`}
                          onChange={(e) => updateRecipient(i, { email: e.target.value })} className={`${inputCls} flex-1`} />
                      ) : (
                        <input type="number" value={r.recipient_id ?? ''} placeholder="ID" aria-label={`수신자 ${i + 1} ID`}
                          onChange={(e) => updateRecipient(i, { recipient_id: e.target.value ? Number(e.target.value) : null })}
                          className={`${inputCls} flex-1`} />
                      )}
                      <button type="button" onClick={() => removeRecipient(i)} aria-label={`수신자 ${i + 1} 삭제`} className="text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {form.recipients.length === 0 && <p className="text-xs text-slate-400">수신자를 추가하세요.</p>}
                </div>
              </div>

              {/* 페이지 */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">페이지</span>
                  <button type="button" onClick={addPage} className="text-xs text-blue-600 hover:underline">+ 추가</button>
                </div>
                <div className="space-y-2">
                  {form.pages.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={p.page_name} placeholder="페이지명(섹션)" aria-label={`페이지 ${i + 1} 이름`}
                        onChange={(e) => updatePage(i, { page_name: e.target.value })} className={`${inputCls} flex-1`} />
                      <input value={p.caption ?? ''} placeholder="캡션" aria-label={`페이지 ${i + 1} 캡션`}
                        onChange={(e) => updatePage(i, { caption: e.target.value })} className={`${inputCls} flex-1`} />
                      <input type="number" value={p.sort_order} aria-label={`페이지 ${i + 1} 순서`}
                        onChange={(e) => updatePage(i, { sort_order: Number(e.target.value) })} className={`${inputCls} w-20`} />
                      <button type="button" onClick={() => removePage(i)} aria-label={`페이지 ${i + 1} 삭제`} className="text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {form.pages.length === 0 && <p className="text-xs text-slate-400">페이지를 추가하세요.</p>}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.enabled ?? true}
                  onChange={(e) => setField('enabled', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                활성화
              </label>

              {/* 발송 제외 정책 */}
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="mb-2 text-xs font-medium text-slate-500">발송 제외 (해당 일에는 메일을 보내지 않음)</p>
                <div className="flex gap-5">
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
                </div>
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
    </div>
  )
}

const inputCls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 w-full'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}
