/** 메일 스케줄/발송 잡 타입 (백엔드 schemas/mail_schedule.py, mail_job.py 대응). */

export type RecipientType = 'USER' | 'GROUP' | 'DEPARTMENT' | 'EMAIL'

export interface RecipientItem {
  id?: number
  recipient_type: RecipientType
  recipient_id?: number | null
  email?: string | null
}

export interface PageItem {
  id?: number
  page_name: string
  caption?: string | null
  image_width_override?: string | null
  sort_order: number
}

export interface MailSchedule {
  id: number
  report_id: number
  title: string
  subject_template?: string | null
  body_header?: string | null
  body_footer?: string | null
  image_width?: string | null
  image_resize_px?: number | null
  cron_expr?: string | null
  export_format: string
  enabled: boolean
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
  body_header?: string | null
  body_footer?: string | null
  image_width?: string | null
  image_resize_px?: number | null
  cron_expr?: string | null
  export_format?: string
  enabled?: boolean
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
