import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import HolidaysPage from './HolidaysPage'
import { holidaysApi } from '@/api/adminApi'
import type { Holiday } from '@/types/admin'

vi.mock('@/api/adminApi', () => ({
  holidaysApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), seed: vi.fn() },
}))

const HOLIDAYS: Holiday[] = [
  { id: 1, holiday_date: '2026-01-01', name: '신정', holiday_type: 'national', is_recurring: false, created_at: '2026-01-01' },
  { id: 2, holiday_date: '2026-05-04', name: '창립기념일', holiday_type: 'company', is_recurring: true, created_at: '2026-01-01' },
]

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(holidaysApi.list).mockResolvedValue(HOLIDAYS)
  vi.mocked(holidaysApi.create).mockResolvedValue(HOLIDAYS[1])
  vi.mocked(holidaysApi.remove).mockResolvedValue(undefined as never)
  vi.mocked(holidaysApi.seed).mockResolvedValue({ year: 2026, added: 15 })
})

describe('HolidaysPage', () => {
  it('공휴일 목록과 구분 배지를 렌더링한다', async () => {
    wrap(<HolidaysPage />)
    expect(await screen.findByText('신정')).toBeInTheDocument()
    expect(await screen.findByText('창립기념일')).toBeInTheDocument()
    expect(screen.getByText('국가')).toBeInTheDocument()
    expect(screen.getByText('사내')).toBeInTheDocument()
  })

  it('국가공휴일 자동 시드를 호출한다', async () => {
    wrap(<HolidaysPage />)
    fireEvent.click(await screen.findByRole('button', { name: /국가공휴일 가져오기/ }))
    await waitFor(() => expect(holidaysApi.seed).toHaveBeenCalled())
    expect(await screen.findByText(/15건을 반영/)).toBeInTheDocument()
  })

  it('사내 공휴일을 추가한다', async () => {
    wrap(<HolidaysPage />)
    fireEvent.change(await screen.findByLabelText('공휴일 날짜'), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText('공휴일 이름'), { target: { value: '임시휴일' } })
    fireEvent.click(screen.getByRole('button', { name: /추가/ }))
    await waitFor(() => expect(holidaysApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ holiday_date: '2026-08-15', name: '임시휴일' }),
    ))
  })

  it('공휴일을 삭제한다', async () => {
    wrap(<HolidaysPage />)
    fireEvent.click(await screen.findByRole('button', { name: '신정 삭제' }))
    await waitFor(() => expect(holidaysApi.remove).toHaveBeenCalledWith(1))
  })
})
