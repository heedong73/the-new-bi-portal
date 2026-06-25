/** 새로고침 상태 배지 (T-37). 레포트 마지막 새로고침 상태/시각 표시. */
import { CheckCircle2, XCircle, Clock, HelpCircle } from 'lucide-react'
import type { RefreshStatus } from '@/types/report'

interface Props {
  status?: RefreshStatus
  isLoading?: boolean
}

/** Power BI refresh status 문자열 → 표시 스타일. */
function styleFor(status?: string | null) {
  switch (status) {
    case 'Completed':
      return { label: '성공', cls: 'bg-green-50 text-green-700 ring-green-600/20', Icon: CheckCircle2 }
    case 'Failed':
      return { label: '실패', cls: 'bg-red-50 text-red-700 ring-red-600/20', Icon: XCircle }
    case 'Unknown':
      return { label: '진행 중', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20', Icon: Clock }
    default:
      return { label: '알 수 없음', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20', Icon: HelpCircle }
  }
}

export default function RefreshStatusBadge({ status, isLoading }: Props) {
  if (isLoading) {
    return <span className="text-sm text-slate-400">새로고침 상태 확인 중…</span>
  }
  if (!status || !status.has_history) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-500/20">
        <HelpCircle className="h-3.5 w-3.5" />
        새로고침 이력 없음
      </span>
    )
  }

  const { label, cls, Icon } = styleFor(status.status)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${cls}`}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {status.last_refresh_local && (
        <span className="text-xs text-slate-500">마지막: {status.last_refresh_local}</span>
      )}
      {status.next_scheduled_local && (
        <span className="text-xs text-slate-400">다음 예약: {status.next_scheduled_local}</span>
      )}
    </div>
  )
}
