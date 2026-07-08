/** 메일 스케줄/발송 잡 타입 (백엔드 schemas/mail_schedule.py, mail_job.py 대응). */

export type RecipientType = 'USER' | 'GROUP' | 'DEPARTMENT' | 'EMAIL'

/** 수신 칸: 받는사람(to)/참조(cc)/숨은참조(bcc). */
export type RecipientField = 'to' | 'cc' | 'bcc'

export interface RecipientItem {
  id?: number
  recipient_type: RecipientType
  recipient_id?: number | null
  email?: string | null
  field?: RecipientField
}

export interface PageItem {
  id?: number
  page_name: string
  caption?: string | null
  image_width_override?: string | null
  sort_order: number
}

/** Power BI 레포트 페이지 (GET /api/reports/{id}/pages). */
export interface ReportPage {
  name: string
  display_name: string
  order?: number | null
}

export type ScheduleFreq = 'daily' | 'weekly' | 'monthly'

export interface MailSchedule {
  id: number
  report_id: number
  title: string
  subject_template?: string | null
  sender_email?: string | null
  body_header?: string | null
  body_footer?: string | null
  image_width?: string | null
  image_resize_px?: number | null
  cron_expr?: string | null
  export_format: string
  enabled: boolean
  schedule_freq?: ScheduleFreq | null
  schedule_time?: string | null
  schedule_days?: number[]
  schedule_day_of_month?: number | null
  start_date?: string | null
  end_date?: string | null
  skip_weekends: boolean
  skip_holidays: boolean
  created_at: string
  recipients: RecipientItem[]
  pages: PageItem[]
}

export interface MailScheduleCreate {
  report_id: number
  title: string
  subject_template?: string | null
  sender_email?: string | null
  body_header?: string | null
  body_footer?: string | null
  image_width?: string | null
  image_resize_px?: number | null
  cron_expr?: string | null
  export_format?: string
  enabled?: boolean
  schedule_freq?: ScheduleFreq | null
  schedule_time?: string | null
  schedule_days?: number[]
  schedule_day_of_month?: number | null
  start_date?: string | null
  end_date?: string | null
  skip_weekends?: boolean
  skip_holidays?: boolean
  recipients: RecipientItem[]
  pages: PageItem[]
}

export interface MailJob {
  id: number
  mail_schedule_id: number
  run_key: string
  status: string
  started_at?: string | null
  finished_at?: string | null
  failure_reason?: string | null
  retry_count: number
}
