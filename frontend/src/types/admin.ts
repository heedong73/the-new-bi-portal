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

/** 조직(회사) 항목. */
export interface OrgCompany {
  cmp_id: string
  dept_id: string
  dept_name: string
}

/** 조직도 트리 노드. */
export interface OrgNode {
  dept_id: string
  dept_name: string
  cmp_id?: string | null
  depth: number
  children: OrgNode[]
}

/** 부서 구성원 (인사 + BIP 등록 상태). 권한 그룹은 다중. */
export interface OrgMember {
  emp_no: string
  name: string
  email?: string | null
  dept_id?: string | null
  dept_name?: string | null
  ofc_name?: string | null
  registered: boolean
  user_id?: number | null
  is_active?: boolean | null
  role_level?: string | null
  groups: { id: number; name: string }[]
}

/** 메뉴 카탈로그 항목. */
export interface MenuCatalogItem {
  key: string
  label: string
}

/** 역할별 메뉴 권한. */
export interface RoleMenus {
  id: number
  code: string
  name: string
  menus: string[]
}

/** 역할-메뉴 매트릭스 응답. */
export interface RoleMenusResponse {
  catalog: MenuCatalogItem[]
  roles: RoleMenus[]
}
