/** 관리자 도메인 타입 (백엔드 schemas/user.py, group.py, permission.py 와 대응). */

/** 사용자 목록 항목. */
export interface UserListItem {
  id: number
  emp_no: string
  name: string
  email?: string | null
  department_id?: number | null
  roles: string[]
  is_active: boolean
}

/** 그룹. */
export interface GroupResponse {
  id: number
  name: string
  description?: string | null
}

/** 그룹원 항목. */
export interface GroupMemberItem {
  id: number
  emp_no: string
  name: string
  email?: string | null
  department_id?: number | null
}

/** 역할. */
export interface RoleResponse {
  id: number
  code: string
  name: string
}

/** 공휴일. */
export interface Holiday {
  id: number
  holiday_date: string
  name: string
  holiday_type: string
  is_recurring: boolean
  created_at: string
}

export interface HolidayCreate {
  holiday_date: string
  name: string
  holiday_type?: 'national' | 'substitute' | 'company'
  is_recurring?: boolean
}
