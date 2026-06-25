/** 메일 스케줄/발송 잡 API 래퍼 (System_Operator/Report_Manager). */
import apiClient, { request } from '@/api/client'
import type { MailJob, MailSchedule, MailScheduleCreate } from '@/types/mail'

export const mailSchedulesApi = {
  list: (signal?: AbortSignal) =>
    apiClient.get<MailSchedule[]>('/api/mail-schedules', { signal }),
  get: (id: number, signal?: AbortSignal) =>
    apiClient.get<MailSchedule>(`/api/mail-schedules/${id}`, { signal }),
  create: (body: MailScheduleCreate) =>
    apiClient.post<MailSchedule>('/api/mail-schedules', body),
  update: (id: number, body: Partial<MailScheduleCreate>) =>
    request<MailSchedule>(`/api/mail-schedules/${id}`, { method: 'PATCH', body }),
  remove: (id: number) =>
    request<void>(`/api/mail-schedules/${id}`, { method: 'DELETE' }),
}

export const mailJobsApi = {
  list: (params: { mail_schedule_id?: number; status?: string } = {}, signal?: AbortSignal) =>
    apiClient.get<MailJob[]>('/api/mail-jobs', {
      query: { mail_schedule_id: params.mail_schedule_id, status: params.status },
      signal,
    }),
  retry: (jobId: number) =>
    apiClient.post<{ mail_schedule_id: number; run_key: string; accepted: boolean; message: string }>(
      `/api/mail-jobs/${jobId}/retry`,
    ),
}
