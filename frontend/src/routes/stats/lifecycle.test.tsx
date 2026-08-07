import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { LifecyclePanel } from './StatsAnalysisPanels'
import type { LifecycleAction, LifecycleEvent, LifecycleResponse } from '@/types/dashboard'

const EVENTS: LifecycleEvent[] = [
  {
    event_id: 1, occurred_at: '2026-08-06T10:00:00+09:00', action: 'report_create',
    report_id: 11, report_name: '신규 매출 레포트', company: 'SCL',
    owner_label: '홍길동', actor_name: '운영자',
  },
  {
    event_id: 2, occurred_at: '2026-08-06T11:00:00+09:00', action: 'report_update',
    report_id: 12, report_name: '경영현황', company: 'SCL',
    owner_label: '김철수', actor_name: '운영자',
  },
  {
    event_id: 3, occurred_at: '2026-08-06T12:00:00+09:00', action: 'report_delete',
    report_id: 13, report_name: '폐기 레포트', company: 'SCL',
    owner_label: null, actor_name: '운영자',
  },
]

const DATA: LifecycleResponse = {
  summary: { created: 2, updated: 1, deleted: 1 },
  events: EVENTS,
  total: 3,
  limit: 200,
  offset: 0,
  action: null,
}

/** 서버 조회를 흉내내는 래퍼. 구분 선택이 상위 상태이므로 테스트도 같은 구조를 쓴다. */
function Harness({ onQuery }: { onQuery?: (action: LifecycleAction | null) => void }) {
  const [action, setAction] = useState<LifecycleAction | null>(null)
  const events = action ? EVENTS.filter((event) => event.action === action) : EVENTS
  return (
    <LifecyclePanel
      data={{ ...DATA, events, total: events.length, action }}
      selectedAction={action}
      onSelectAction={(next) => {
        setAction(next)
        onQuery?.(next)
      }}
      onLoadMore={() => {}}
    />
  )
}

describe('LifecyclePanel', () => {
  it('기본은 전체 이벤트를 보여준다', () => {
    render(<Harness />)
    expect(screen.getByText('신규 매출 레포트')).toBeInTheDocument()
    expect(screen.getByText('경영현황')).toBeInTheDocument()
    expect(screen.getByText('폐기 레포트')).toBeInTheDocument()
  })

  it('카드를 누르면 그 구분으로 서버 조회를 요청하고 목록이 좁혀진다', () => {
    const onQuery = vi.fn()
    render(<Harness onQuery={onQuery} />)
    fireEvent.click(screen.getByRole('button', { name: /레포트 수정/ }))

    expect(onQuery).toHaveBeenCalledWith('report_update')
    expect(screen.getByText('경영현황')).toBeInTheDocument()
    expect(screen.queryByText('신규 매출 레포트')).not.toBeInTheDocument()
    expect(screen.getByText(/수정 이벤트만/)).toBeInTheDocument()
  })

  it('같은 카드를 다시 누르거나 전체 보기를 누르면 필터가 해제된다', () => {
    render(<Harness />)
    const deleteCard = screen.getByRole('button', { name: /레포트 삭제/ })

    fireEvent.click(deleteCard)
    expect(deleteCard).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('경영현황')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '전체 보기' }))
    expect(deleteCard).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('경영현황')).toBeInTheDocument()

    fireEvent.click(deleteCard)
    fireEvent.click(deleteCard)
    expect(screen.getByText('경영현황')).toBeInTheDocument()
  })

  it('선택 기간에 해당 구분 기록이 없으면 안내를 보여준다', () => {
    render(
      <LifecyclePanel
        data={{ ...DATA, events: [], total: 0, action: 'report_delete' }}
        selectedAction="report_delete"
        onSelectAction={() => {}}
        onLoadMore={() => {}}
      />,
    )
    expect(screen.getByText('선택 기간에 삭제 기록이 없습니다.')).toBeInTheDocument()
  })

  it('아직 못 불러온 이벤트가 있으면 더 보기로 추가 조회한다', () => {
    const onLoadMore = vi.fn()
    render(
      <LifecyclePanel
        data={{ ...DATA, total: 250 }}
        selectedAction={null}
        onSelectAction={() => {}}
        onLoadMore={onLoadMore}
      />,
    )
    expect(screen.getByText(/기간 전체 250건 중 3건 표시/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /더 보기 \(남은 247건\)/ }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('모두 불러왔으면 더 보기를 숨긴다', () => {
    render(
      <LifecyclePanel
        data={DATA}
        selectedAction={null}
        onSelectAction={() => {}}
        onLoadMore={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /더 보기/ })).not.toBeInTheDocument()
  })
})
