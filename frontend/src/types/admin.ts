/** 관리자 도메인 타입 (백엔드 schemas/user.py, group.py, permission.py 와 대응). */

/** 사용자 목록 항목. */
export interface UserListItem {
  id: number
  emp_no: string
  name: string
  email?: string | null
  department_id?: number | null
  department_ext_id?: string | null
  department_name?: string | null
  roles: string[]
  groups?: { id: number; name: string }[]
  is_active: boolean
  /** true면 관리자가 만든 로컬 계정(HR 미연동). */
  is_local?: boolean
}

/** 로컬 사용자 생성 요청. login_id는 users.external_id로 저장되는 자유 문자열. */
export interface LocalUserCreatePayload {
  login_id: string
  name: string
  email?: string | null
  password: string
  role_code?: string
}

/** 로컬 사용자 이름·이메일 수정. */
export interface LocalUserUpdatePayload {
  name?: string
  email?: string | null
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


/** 팀 그룹 동기화 — 구성원 참조. */
export interface TeamGroupMemberRef {
  emp_no: string
  name: string
}

/** 팀 그룹 동기화 — 팀별 계획/결과. */
export interface TeamGroupPlanItem {
  dept_id: string
  dept_name: string
  group_name: string
  group_id: number | null
  created: boolean
  renamed_from: string | null
  add: TeamGroupMemberRef[]
  remove: TeamGroupMemberRef[]
  keep: number
}

/** 팀 그룹 동기화 응답(미리보기/적용). */
export interface TeamGroupSyncResult {
  dept_id: string
  applied: boolean
  teams: TeamGroupPlanItem[]
  groups_total: number
  groups_to_create: number
  members_to_add: number
  members_to_remove: number
  to_register: number
}

/** 그룹 트리 노드(조직 계층). group_id가 있으면 그 부서의 팀 그룹, 없으면 구조용 폴더. */
export interface GroupTreeNode {
  dept_id: string
  dept_name: string
  group_id: number | null
  group_name: string | null
  member_count: number | null
  has_members: boolean
  children: GroupTreeNode[]
}

/** 그룹 트리 응답. tree=자동 팀 그룹(조직 계층), ungrouped=수동/미배치 그룹. */
export interface GroupTreeResponse {
  tree: GroupTreeNode[]
  ungrouped: GroupResponse[]
}

/** 메뉴별 접근 주체 조회 항목('메뉴 관리' 탭). source=group이면 그룹 권한으로 얻은 사용자. */
export interface MenuSubjectItem {
  subject_type: 'user' | 'group'
  subject_id: number
  label: string
  source: 'direct' | 'group'
}

/** 그룹의 허용 계열사(최상위 폴더) 스코프 항목. */
export interface GroupCompanyScopeItem {
  root_folder_id: number
  root_folder_name: string
}

/** 그룹/역할에서 상속된 메뉴 접근(읽기 전용). */
export interface InheritedMenuItem {
  menu_key: string
  label: string
  source_type: 'role' | 'group'
  source_label: string
}

/** 사용자에게 직접 부여된 레포트 권한(회수 가능). */
export interface DirectReportPermission {
  permission_id: number
  report_id: number
  report_name: string
  folder_name?: string | null
  permission: string
}

/** 그룹/역할/부서/계열사 스코프로 상속된 레포트 권한(읽기 전용). */
export interface InheritedReportPermission {
  report_id: number
  report_name: string
  folder_name?: string | null
  permission: string
  source_type: 'group' | 'role' | 'dept' | 'scope'
  source_label: string
}

/** 개인별 권한 화면 — 한 사용자의 직접·상속 권한 총람. */
export interface UserEffectivePermissions {
  user_id: number
  emp_no: string
  name: string
  department_name?: string | null
  is_operator: boolean
  roles: string[]
  groups: { id: number; name: string }[]
  direct_menu_keys: string[]
  inherited_menus: InheritedMenuItem[]
  direct_reports: DirectReportPermission[]
  inherited_reports: InheritedReportPermission[]
}
