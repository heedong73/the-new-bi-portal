/** 메일 스케줄 관리 — 목록 + 생성/수정.
 *
 * 폼 순서: 스케줄명 → 레포트(폴더 트리 선택) → 페이지(페이지명 다중선택) →
 * Export 형식 → 메일 제목 → 상단/하단 안내문구 → 수신자 → 발송 스케줄(주기/시간/기간)
 * → 발송 제외(주말/공휴일)/활성화. 요구사항: R16.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, ArrowUp, ArrowDown } from 'lucide-react'

import { mailSchedulesApi } from '@/api/mailApi'
import { reportAdminApi } from '@/api/reportAdminApi'
import { usersApi, groupsApi } from '@/api/adminApi'
import ReportPickerTree from './ReportPickerTree'
import RichTextEditor from '@/components/RichTextEditor'
import HintTip from '@/components/HintTip'
import { UserPicker } from '@/routes/admin/EntityPicker'
import { useSidebarStore } from '@/stores/useSidebarStore'
import type {
  MailSchedule,
  MailScheduleCreate,
  RecipientField,
  RecipientItem,
  RecipientType,
  ScheduleFreq,
} from '@/types/mail'

const RECIPIENT_TYPES: RecipientType[] = ['USER', 'GROUP', 'DEPARTMENT', 'EMAIL']
const RECIPIENT_LABEL: Record<RecipientType, string> = {
  USER: '사용자', GROUP: '그룹', DEPARTMENT: '부서', EMAIL: '직접입력',
}
// 수신 칸(받는사람/참조/숨은참조)
const RECIPIENT_FIELDS: RecipientField[] = ['to', 'cc', 'bcc']
const RECIPIENT_FIELD_LABEL: Record<RecipientField, string> = {
  to: '받는사람', cc: '참조', bcc: '숨은참조',
}
const RECIPIENT_FIELD_BADGE: Record<RecipientField, string> = {
  to: 'bg-slate-100 text-slate-600',
  cc: 'bg-sky-50 text-sky-700',
  bcc: 'bg-violet-50 text-violet-700',
}
// 수신자 칸(받는사람/참조/숨은참조)은 인원이 많아지면 세로로 계속 길어진다.
// 이 개수를 넘는 칸만 자동으로 접고, 접힌 상태에서도 앞쪽 몇 개는 남겨 확인 가능하게 한다.
// 3명까지는 한 줄에 들어가 접을 이유가 없으므로 4명부터 접기 버튼을 노출한다.
const RECIPIENT_COLLAPSE_THRESHOLD = 3
const RECIPIENT_COLLAPSED_PREVIEW = 3
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
    // 표시 폭(1280) 대비 2배 해상도를 첨부해 모바일 고화면에서도 선명하게 보이도록 한다.
    image_width: '1280',
    image_resize_px: 2560,
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
  // 관리자 사이드바가 펼쳐졌을 때 모달의 왼쪽 경계를 사이드바 오른쪽에 맞춘다.
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed)
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

  function openNew() {
    setExpandedRecipFields(new Set())
    setForm(emptyForm())
    setEditingId('new')
  }
  function openEdit(s: MailSchedule) {
    setExpandedRecipFields(new Set())
    setForm(toForm(s))
    setEditingId(s.id)
  }

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
      if (checked) cur.add(v)
      else cur.delete(v)
      return { ...f, schedule_days: [...cur].sort((a, b) => a - b) }
    })
  }

  // 수신자 입력창(1개) → 추가 버튼으로 칸(받는사람/참조/숨은참조)별 chip 그룹에 append.
  // 사용자가 직접 펼친 수신 칸. 임계치를 넘지 않는 칸은 이 값과 무관하게 항상 펼쳐 보인다.
  const [expandedRecipFields, setExpandedRecipFields] = useState<Set<RecipientField>>(new Set())
  function toggleRecipFieldExpand(fld: RecipientField) {
    setExpandedRecipFields((cur) => {
      const next = new Set(cur)
      if (next.has(fld)) next.delete(fld)
      else next.add(fld)
      return next
    })
  }

  const [newRecipField, setNewRecipField] = useState<RecipientField>('to')
  const [newRecipType, setNewRecipType] = useState<RecipientType>('USER')
  const [newRecipEmail, setNewRecipEmail] = useState('')
  const [newRecipId, setNewRecipId] = useState('')

  function addRecipientFromInput() {
    setForm((f) => {
      if (newRecipType === 'EMAIL') {
        const email = newRecipEmail.trim()
        if (!email) return f
        if (f.recipients.some((r) => r.recipient_type === 'EMAIL' && (r.email ?? '').toLowerCase() === email.toLowerCase())) return f
        return { ...f, recipients: [...f.recipients, { recipient_type: 'EMAIL', email, field: newRecipField }] }
      }
      const id = Number(newRecipId)
      if (!id) return f
      if (f.recipients.some((r) => r.recipient_type === newRecipType && r.recipient_id === id)) return f
      return { ...f, recipients: [...f.recipients, { recipient_type: newRecipType, recipient_id: id, field: newRecipField }] }
    })
    setNewRecipEmail('')
    setNewRecipId('')
  }
  function removeRecipient(i: number) {
    setForm((f) => ({ ...f, recipients: f.recipients.filter((_, idx) => idx !== i) }))
  }
  // To/Cc/Bcc 의미는 유지하고, 선택한 칸 안의 이전·다음 수신자와 배열 위치만 맞바꾼다.
  // 저장 API는 이 배열 위치를 sort_order로 기록하므로 재편집과 실제 발송에도 반영된다.
  function moveRecipient(field: RecipientField, indexInField: number, dir: -1 | 1) {
    setExpandedRecipFields((current) => new Set(current).add(field))
    setForm((current) => {
      const indexes = current.recipients.reduce<number[]>((result, recipient, index) => {
        if ((recipient.field ?? 'to') === field) result.push(index)
        return result
      }, [])
      const targetIndexInField = indexInField + dir
      if (targetIndexInField < 0 || targetIndexInField >= indexes.length) return current

      const recipients = [...current.recipients]
      const from = indexes[indexInField]
      const to = indexes[targetIndexInField]
      ;[recipients[from], recipients[to]] = [recipients[to], recipients[from]]
      return { ...current, recipients }
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
        <h1 className="portal-content-page-title">메일 스케줄</h1>
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
          {/* 목록 기본 글자는 14px → 15px. 컬럼명·부가 정보도 각각 1px씩 키운다. */}
          <table className="w-full text-[15px]">
            <thead className="bg-slate-50 text-left text-[13px] uppercase text-slate-500">
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
                  <td className="px-4 py-3 text-[13px] text-slate-500">{freqSummary(s)}</td>
                  <td className="px-4 py-3 text-slate-500">{s.recipients.length} / {s.pages.length}</td>
                  <td className="px-4 py-3">
                    {s.enabled
                      ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-[13px] text-green-700">활성</span>
                      : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[13px] text-slate-600">비활성</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openEdit(s)} className="mr-2 text-[13px] text-blue-600 hover:underline">수정</button>
                    <button type="button" onClick={() => { deleteMutation.reset(); setConfirmDelete(s) }} className="text-[13px] text-red-600 hover:underline">삭제</button>
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
        <div
          className={`fixed inset-y-0 right-0 z-10 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 transition-[left] duration-300 ${
            sidebarCollapsed ? 'left-0' : 'left-64'
          }`}
        >
          {/* 펼친 관리자 사이드바의 오른쪽 영역에서만 가운데 정렬한다.
              최대 폭은 96rem까지만 늘린다 — 수신자 입력 행(드롭다운 3개 + 추가 버튼)이
              한 줄에 들어갈 만큼만 넓히고, 배경이 left-64부터 시작하므로 사이드바는
              침범하지 않는다. 화면이 좁으면 w-full 로 가용 폭만 사용한다. */}
          <div className="my-4 w-full max-w-[96rem] rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                {editingId === 'new' ? '새 메일 스케줄' : '메일 스케줄 수정'}
              </h2>
              <button type="button" aria-label="닫기" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate() }} className="space-y-4">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3 xl:items-start">
                <div className="space-y-4">
              {/* 1. 스케줄명 */}
              <Field label="스케줄명">
                <input value={form.title} aria-label="스케줄명"
                  onChange={(e) => setField('title', e.target.value)} className={inputCls} />
              </Field>

              {/* 2. 레포트 (폴더 트리에서 선택) */}
              <Field label="레포트">
                {/* 선택 결과는 트리보다 눈에 먼저 들어와야 해서 기본(text-xs) 대비 10% 키운다. */}
                <div className="mb-1 text-[13.2px] text-slate-500">
                  {form.report_id > 0 ? <>선택됨: <span className="font-medium text-slate-700">{reportName(form.report_id)}</span></> : '폴더에서 레포트를 선택하세요.'}
                </div>
                <ReportPickerTree value={form.report_id} onChange={(id) => selectReport(id)} />
              </Field>

              {/* 3. 레포트 페이지 선택 + 발송 순서 */}
              <Field label="레포트 페이지 선택 및 발송 순서">
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
                    {[...form.pages]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((p, idx, arr) => {
                        const apiPage = apiPages.find((candidate) => candidate.name === p.page_name)
                        const pageLabel = apiPage?.display_name || p.caption || p.page_name
                        return (
                          <div key={p.page_name} className="flex items-center gap-2 rounded bg-blue-50 px-1 py-0.5 text-sm">
                            <input
                              type="checkbox"
                              checked
                              aria-label={`${pageLabel} 선택 해제`}
                              onChange={(e) => togglePage(p.page_name, p.caption ?? '', e.target.checked)}
                              className="h-4 w-4 shrink-0 rounded border-slate-300"
                            />
                            <span className="w-5 shrink-0 text-center text-xs font-medium text-blue-600">{idx + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-slate-700">{pageLabel}</span>
                            {!apiPage && <span className="shrink-0 text-xs text-amber-500">(목록에 없음)</span>}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => movePage(idx, -1)}
                              aria-label={`${pageLabel} 발송 순서 위로`}
                              className="rounded p-1 text-slate-400 hover:bg-white disabled:opacity-30"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === arr.length - 1}
                              onClick={() => movePage(idx, 1)}
                              aria-label={`${pageLabel} 발송 순서 아래로`}
                              className="rounded p-1 text-slate-400 hover:bg-white disabled:opacity-30"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      })}
                    {apiPages
                      .filter((p) => !form.pages.some((selected) => selected.page_name === p.name))
                      .map((p) => (
                        <label key={p.name} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={false}
                            aria-label={`${p.display_name} 선택`}
                            onChange={(e) => togglePage(p.name, p.display_name, e.target.checked)}
                            className="h-4 w-4 shrink-0 rounded border-slate-300"
                          />
                          <span className="w-5 shrink-0 text-center text-xs text-slate-300">—</span>
                          {/* 내부 페이지 식별자(p.name)는 운영자에게 의미가 없어 노출하지 않는다. */}
                          <span className="min-w-0 flex-1 truncate text-slate-700">{p.display_name}</span>
                        </label>
                      ))}
                  </div>
                )}
              </Field>

              {/* 4. Export 형식 + 이미지 화질/표시 크기.
                  설명은 제목 옆 i 툴팁으로만 노출해 폼이 세로로 길어지지 않게 한다. */}
              <div className="grid grid-cols-3 gap-2">
                <Field label="Export 형식">
                  <select value={form.export_format} onChange={(e) => setField('export_format', e.target.value)} className={compactInputCls}>
                    <option>PNG</option><option>PDF</option><option>PPTX</option>
                  </select>
                </Field>
                <Field
                  label="첨부 해상도"
                  hint="첨부 파일의 실제 픽셀 폭이며 화질을 결정합니다. 비우면 원본 그대로. 표시 폭의 2배 이상을 권장합니다(모바일 고해상도 화면 대응). 예: 2560"
                >
                  <input type="number" value={form.image_resize_px ?? ''} placeholder="2560"
                    aria-label="첨부 이미지 해상도(px)"
                    onChange={(e) => setField('image_resize_px', e.target.value ? Number(e.target.value) : null)} className={compactInputCls} />
                </Field>
                <Field
                  label="표시 최대 폭"
                  hint="메일에서 보이는 크기입니다. 1280 · 1280px · 100% 형식을 쓸 수 있습니다. 비우면 최대 1280px로 표시하며, 모바일에서는 화면 폭에 맞춰 자동 축소됩니다."
                >
                  <input value={form.image_width ?? ''} placeholder="1280"
                    aria-label="본문 표시 최대 폭"
                    onChange={(e) => setField('image_width', e.target.value)} className={compactInputCls} />
                </Field>
              </div>
                </div>

                <div className="space-y-4">
              {/* 메일 내용: 제목 + 상단/하단 안내문구 */}
              <Field label="메일 제목 (수신자에게 표시)">
                <input value={form.subject_template ?? ''} placeholder="예: {date} 일일 보고서"
                  onChange={(e) => setField('subject_template', e.target.value)} className={inputCls} />
              </Field>

              <Field label="상단 안내문구">
                <RichTextEditor value={form.body_header ?? ''} ariaLabel="상단 안내문구"
                  onChange={(html) => setField('body_header', html)} />
              </Field>
              <Field label="하단 안내문구">
                <RichTextEditor value={form.body_footer ?? ''} ariaLabel="하단 안내문구"
                  onChange={(html) => setField('body_footer', html)} minHeight={72} />
              </Field>
                </div>

                <div className="space-y-4">
              {/* 발신: 보내는 사람(From) — 비우면 서버 기본값 */}
              <Field label="보내는 사람 이메일 (선택)">
                <input type="email" value={form.sender_email ?? ''} placeholder="비우면 기본 발신 주소로 발송"
                  aria-label="보내는 사람 이메일"
                  onChange={(e) => setField('sender_email', e.target.value)} className={inputCls} />
                <p className="mt-1 text-xs text-slate-400">비우면 시스템 기본 발신 주소로 발송됩니다. 메일 서버 정책상 허용되지 않는 주소는 발송이 거부될 수 있습니다.</p>
              </Field>

              {/* 수신자 — 유형·값 선택 후 칸(받는사람/참조/숨은참조)에 추가 → 칸별 chip 그룹 */}
              <div>
                <span className="mb-2 block text-sm font-medium text-slate-700">수신자</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={newRecipField} aria-label="수신 칸"
                    onChange={(e) => setNewRecipField(e.target.value as RecipientField)}
                    className={`${rowInputCls} ${rowSelectWidthCls} shrink-0`}>
                    {RECIPIENT_FIELDS.map((fld) => <option key={fld} value={fld}>{RECIPIENT_FIELD_LABEL[fld]}</option>)}
                  </select>
                  <select value={newRecipType} aria-label="수신자 유형"
                    onChange={(e) => { setNewRecipType(e.target.value as RecipientType); setNewRecipEmail(''); setNewRecipId('') }}
                    className={`${rowInputCls} ${rowSelectWidthCls} shrink-0`}>
                    {RECIPIENT_TYPES.map((t) => <option key={t} value={t}>{RECIPIENT_LABEL[t]}</option>)}
                  </select>
                  {newRecipType === 'EMAIL' ? (
                    <input value={newRecipEmail} placeholder="email@삼천리.com" aria-label="수신자 이메일"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipientFromInput() } }}
                      onChange={(e) => setNewRecipEmail(e.target.value)} className={`${rowInputCls} flex-1 min-w-0`} />
                  ) : newRecipType === 'USER' ? (
                    // 사용자는 수가 많아 인라인 검색이 필요하다(이름·사번·이메일·부서로 검색).
                    <UserPicker
                      users={users}
                      value={newRecipId ? Number(newRecipId) : null}
                      onChange={(id) => setNewRecipId(id === null ? '' : String(id))}
                      loading={usersQuery.isLoading}
                      ariaLabel="수신자 사용자"
                      placeholder="사용자 검색…"
                      dense
                      // 고정 폭이면 '추가' 버튼이 다음 줄로 밀리므로, 다른 유형의
                      // 입력칸과 동일하게 남는 공간을 차지하고 필요하면 줄어들게 한다.
                      className="min-w-0 flex-1"
                    />
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
                  {/* 입력 컨트롤과 높이를 맞춘 추가 버튼. */}
                  <button type="button" onClick={addRecipientFromInput} disabled={!newRecipValid}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-[0.6rem] py-[0.4rem] text-[12px] font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                    <Plus className="h-[0.8rem] w-[0.8rem]" /> 추가
                  </button>
                </div>

                {/* 칸별 chip 그룹: 받는사람/참조/숨은참조. pill 가로 wrap, x로 삭제 */}
                <div className="mt-2 space-y-1.5">
                  {RECIPIENT_FIELDS.map((fld) => {
                    const items = form.recipients
                      .map((r, i) => ({ r, i }))
                      .filter((it) => (it.r.field ?? 'to') === fld)
                    // 임계치 이하면 접을 필요가 없어 그대로 전부 보여준다.
                    const collapsible = items.length > RECIPIENT_COLLAPSE_THRESHOLD
                    const expanded = !collapsible || expandedRecipFields.has(fld)
                    const visibleItems = expanded ? items : items.slice(0, RECIPIENT_COLLAPSED_PREVIEW)
                    const hiddenCount = items.length - visibleItems.length
                    return (
                      // 수신자가 늘어 1줄 → 2줄이 될 때 모달 전체가 세로로 늘어나
                      // 화면이 흔들리는 것을 막는다. 접힌 상태의 최대 줄 수(2줄)만큼
                      // 공간을 처음부터 확보해 두어 인원 수와 무관하게 높이가 고정된다.
                      // chip 1줄 24px + gap 4px + 컨테이너 padding/border 14px = 66px.
                      <div key={fld} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 xl:min-h-[4.125rem]">
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium ${RECIPIENT_FIELD_BADGE[fld]}`}>
                          {RECIPIENT_FIELD_LABEL[fld]}
                          {items.length > 0 && <span className="ml-1 font-semibold">{items.length}</span>}
                        </span>
                        {items.length === 0 ? (
                          <span className="mt-1 text-[12px] text-slate-300">없음</span>
                        ) : (
                          // 자동 줄바꿈(flex-wrap)은 이름 길이에 따라 줄 수가 달라져
                          // 받는사람만 3줄이 되는 문제가 있다. PC(xl)에서는 2열 그리드로
                          // 고정해 3명이면 항상 2줄이 되도록 칸마다 통일한다.
                          <div className="grid flex-1 grid-cols-1 items-center gap-1 xl:grid-cols-2">
                            {visibleItems.map((it, indexInField) => {
                              const label = recipientLabel(it.r)
                              return (
                                <span key={it.i}
                                  className={`inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-[12px] ${label ? 'text-slate-700' : 'text-amber-600'}`}>
                                  <span className="shrink-0 text-[12px] text-slate-400">{RECIPIENT_LABEL[it.r.recipient_type]}</span>
                                  <span className="min-w-0 flex-1 truncate">{label ?? '미선택'}</span>
                                  {items.length > 1 && (
                                    <span className="inline-flex shrink-0 items-center">
                                      <button type="button" disabled={indexInField === 0}
                                        onClick={() => moveRecipient(fld, indexInField, -1)}
                                        aria-label={`${label ?? '수신자'} 위로 이동`}
                                        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-25">
                                        <ArrowUp className="h-3 w-3" />
                                      </button>
                                      <button type="button" disabled={indexInField === items.length - 1}
                                        onClick={() => moveRecipient(fld, indexInField, 1)}
                                        aria-label={`${label ?? '수신자'} 아래로 이동`}
                                        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-25">
                                        <ArrowDown className="h-3 w-3" />
                                      </button>
                                    </span>
                                  )}
                                  <button type="button" onClick={() => removeRecipient(it.i)} aria-label="수신자 삭제"
                                    className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              )
                            })}
                            {collapsible && (
                              <button type="button" onClick={() => toggleRecipFieldExpand(fld)}
                                aria-expanded={expanded}
                                className="inline-flex w-fit items-center justify-self-start rounded-full border border-slate-300 px-2 py-0.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100">
                                {expanded ? '접기' : `+${hiddenCount}개 더보기`}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 9. 발송 스케줄 (주기/시간/기간) */}
              <div className="rounded-lg border border-slate-200 px-3 py-3">
                <p className="mb-2 text-sm font-medium text-slate-700">발송 스케줄</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="주기" labelSize="xs">
                    <select value={form.schedule_freq ?? 'daily'}
                      onChange={(e) => setField('schedule_freq', e.target.value as ScheduleFreq)} className={compactInputCls}>
                      <option value="daily">매일</option>
                      <option value="weekly">매주</option>
                      <option value="monthly">매월</option>
                    </select>
                  </Field>
                  <Field label="시간" labelSize="xs">
                    <input type="time" value={form.schedule_time ?? ''}
                      onChange={(e) => setField('schedule_time', e.target.value)} className={compactInputCls} />
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
                            className={`h-8 w-8 rounded-full text-[12px] ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            {d.l}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {form.schedule_freq === 'monthly' && (
                  <div className="mt-2">
                    <Field label="매월 며칠" labelSize="xs">
                      {/* 같은 발송 스케줄 패널이라 주기·시간과 같은 축소 폰트를 쓴다. */}
                      <input type="number" min={1} max={31} value={form.schedule_day_of_month ?? 1}
                        onChange={(e) => setField('schedule_day_of_month', Number(e.target.value))}
                        className={`${compactInputCls} w-28`} />
                    </Field>
                  </div>
                )}

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Field label="시작일 (선택)" labelSize="xs">
                    <input type="date" value={form.start_date ?? ''}
                      onChange={(e) => setField('start_date', e.target.value || null)} className={compactInputCls} />
                  </Field>
                  <Field label="종료일 (선택)" labelSize="xs">
                    <input type="date" value={form.end_date ?? ''}
                      onChange={(e) => setField('end_date', e.target.value || null)} className={compactInputCls} />
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

      {/* 삭제 확인 모달 */}
      {confirmDelete && (
        <div
          className={`fixed inset-y-0 right-0 z-20 flex items-center justify-center bg-slate-900/40 p-4 transition-[left] duration-300 ${
            sidebarCollapsed ? 'left-0' : 'left-64'
          }`}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-800">메일 스케줄 삭제</h2>
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

// 스케줄명·메일 제목·보내는 사람 이메일 입력값은 항목 제목(14px)보다 1px 작게 둔다.
const inputCls = 'rounded-lg border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-blue-500 w-full'
// 수신자 행처럼 flex 안에서 폭을 직접 제어하는 입력용(위 inputCls의 w-full 충돌 방지).
const rowInputCls = 'mail-recipient-control rounded-lg border border-slate-300 px-[0.6rem] py-[0.4rem] text-[12px] outline-none focus:border-blue-500'
// 수신 칸/대상 유형 선택은 고정 폭으로 유지한다.
// '받는사람'·'숨은참조'처럼 4글자 항목이 select 화살표 공간까지 고려해도 잘리지 않는 폭.
const rowSelectWidthCls = 'w-[5.6rem]'
// 네이티브 select/date/time/number 내부 글자는 브라우저 기본 스타일이 개입할 수 있어
// mail-compact-control CSS에서도 13px을 !important로 강제한다.
const compactInputCls = 'mail-compact-control rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 w-full'

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

/** 항목 제목. 기본값은 '수신자'·'발송 스케줄' 제목과 동일한 14px이며,
 *  발송 스케줄 패널 안의 하위 항목은 labelSize="xs"로 한 단계 작게 유지한다.
 *  hint 를 주면 제목 옆 i 아이콘의 툴팁으로만 노출해 폼 높이를 늘리지 않는다. */
function Field({
  label,
  children,
  labelSize = 'sm',
  hint,
}: {
  label: string
  children: React.ReactNode
  labelSize?: 'sm' | 'xs'
  hint?: string
}) {
  return (
    <label className="block">
      <span className={`mb-1 flex items-center gap-1 font-medium text-slate-600 ${labelSize === 'sm' ? 'text-sm' : 'text-xs'}`}>
        <span className="min-w-0 truncate">{label}</span>
        {hint && <HintTip text={hint} label={label} />}
      </span>
      {children}
    </label>
  )
}


