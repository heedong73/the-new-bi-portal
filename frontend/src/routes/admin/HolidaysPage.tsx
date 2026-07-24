/** 공휴일 관리 (공휴일/주말 발송 제외) — 목록 + 추가/삭제 + 국가공휴일 자동 시드. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Download } from 'lucide-react'

import { holidaysApi } from '@/api/adminApi'
import type { Holiday } from '@/types/admin'

const TYPE_LABEL: Record<string, string> = {
  national: '국가',
  substitute: '대체',
  company: '사내',
}
const TYPE_CLS: Record<string, string> = {
  national: 'bg-blue-50 text-blue-700',
  substitute: 'bg-indigo-50 text-indigo-700',
  company: 'bg-amber-50 text-amber-700',
}

export default function HolidaysPage() {
  const queryClient = useQueryClient()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [recurring, setRecurring] = useState(false)

  const listQuery = useQuery({
    queryKey: ['holidays', year],
    queryFn: ({ signal }) => holidaysApi.list(year, signal),
    staleTime: 30_000,
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['holidays'] })

  const createMutation = useMutation({
    mutationFn: () =>
      holidaysApi.create({
        holiday_date: newDate, name: newName.trim(),
        holiday_type: 'company', is_recurring: recurring,
      }),
    onSuccess: (created) => {
      // 추가한 공휴일이 보이도록 해당 연도로 전환
      const y = Number(created?.holiday_date?.slice(0, 4))
      if (!Number.isNaN(y)) setYear(y)
      setNewDate(''); setNewName(''); setRecurring(false); invalidate()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => holidaysApi.remove(id),
    onSuccess: () => invalidate(),
  })
  const seedMutation = useMutation({
    mutationFn: () => holidaysApi.seed(year),
    onSuccess: () => invalidate(),
  })

  const holidays = listQuery.data ?? []
  const canAdd = newDate !== '' && newName.trim() !== '' && !createMutation.isPending

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="portal-content-page-title">공휴일 관리</h2>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="연도"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {[thisYear, thisYear + 1, thisYear + 2].map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> {year}년 국가공휴일 가져오기
          </button>
        </div>
      </div>

      <p className="mb-3 text-sm text-slate-500">
        주말·공휴일에는 메일이 발송되지 않습니다. 대체공휴일·사내 공휴일은 직접 추가/삭제할 수 있어요.
      </p>

      {seedMutation.isSuccess && (
        <p className="mb-3 text-sm text-green-700">국가공휴일 {seedMutation.data?.added}건을 반영했습니다(추가/한글명 갱신).</p>
      )}

      {/* 사내 공휴일 추가 */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (canAdd) createMutation.mutate() }}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <label className="flex flex-col text-xs text-slate-500">
          날짜
          <input type="date" value={newDate} aria-label="공휴일 날짜"
            onChange={(e) => setNewDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-1 flex-col text-xs text-slate-500">
          이름
          <input value={newName} placeholder="예: 창립기념일" aria-label="공휴일 이름"
            onChange={(e) => setNewName(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300" />
          매년 반복
        </label>
        <button type="submit" disabled={!canAdd}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          <Plus className="h-4 w-4" /> 추가
        </button>
      </form>

      {createMutation.isError && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          추가 실패: {(createMutation.error as { errorDescription?: string })?.errorDescription
            ?? '같은 날짜의 공휴일이 이미 등록되어 있는지 확인하세요.'}
        </p>
      )}

      {/* 목록 */}
      {listQuery.isLoading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">날짜</th>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">구분</th>
                <th className="px-4 py-3">반복</th>
                <th className="px-4 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {holidays.map((h: Holiday) => (
                <tr key={h.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-600">{h.holiday_date}</td>
                  <td className="px-4 py-3 text-slate-800">{h.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_CLS[h.holiday_type] ?? 'bg-slate-100 text-slate-600'}`}>
                      {TYPE_LABEL[h.holiday_type] ?? h.holiday_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{h.is_recurring ? '매년' : '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => deleteMutation.mutate(h.id)}
                      aria-label={`${h.name} 삭제`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" /> 삭제
                    </button>
                  </td>
                </tr>
              ))}
              {holidays.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">등록된 공휴일이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
