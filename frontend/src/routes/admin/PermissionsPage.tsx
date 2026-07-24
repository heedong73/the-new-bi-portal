/** 권한 관리 — 그룹 중심 메뉴 권한 · 허용 계열사 · 레포트 다중 권한 부여 통합 화면.
 *
 * - 그룹 관리: 그룹을 고르면 메뉴 접근 토글, 허용 계열사(최상위 폴더) 다중 선택,
 *   레포트를 다중 선택해 권한(조회/다운로드/새로고침/교체/통계조회)을 한 번에 부여.
 * - 메뉴 관리: 메뉴를 고르면 접근 가능한 주체(그룹/개별 사용자) 목록을 보여준다.
 *   그룹 권한으로 얻은 사용자는 여기서 회수할 수 없다(그룹 관리에서 조정).
 *
 * 기존 레포트 관리 화면의 레포트별 '권한' 버튼(ReportPermissionPanel)은 병행 유지한다.
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, LayoutGrid, Shield, User, UsersRound, X } from 'lucide-react'

import { permissionAdminApi, usersApi } from '@/api/adminApi'
import { foldersAdminApi, reportAdminApi } from '@/api/reportAdminApi'
import { MENU_CATALOG } from '@/constants/menus'
import type { PermissionAction } from '@/types/reportAdmin'
import type { DirectReportPermission, InheritedReportPermission } from '@/types/admin'
import CompanyScopePicker from './CompanyScopePicker'
import ReportMultiPicker from './ReportMultiPicker'
import GroupTreeSelector, { type GroupSelection } from './GroupTreeSelector'
import { UserPicker } from './EntityPicker'

const REPORT_PERMISSIONS: { value: PermissionAction; label: string }[] = [
  { value: 'VIEW', label: '조회' },
  { value: 'DOWNLOAD', label: '다운로드' },
  { value: 'REFRESH', label: '새로고침' },
  { value: 'MANAGE_REPORT', label: '교체' },
  { value: 'VIEW_STATS', label: '통계 조회' },
]

const PERM_LABEL: Record<string, string> = {
  VIEW: '조회',
  DOWNLOAD: '다운로드',
  REFRESH: '새로고침',
  MANAGE_REPORT: '교체',
  VIEW_STATS: '통계 조회',
}
const permOrder = (code: string) => {
  const index = REPORT_PERMISSIONS.findIndex((p) => p.value === code)
  return index === -1 ? 999 : index
}
const SOURCE_LABEL: Record<string, string> = {
  group: '그룹',
  role: '역할',
  dept: '부서',
  scope: '계열사',
}

type Tab = 'groups' | 'menus' | 'personal'

export default function PermissionsPage() {
  const [tab, setTab] = useState<Tab>('groups')

  return (
    <section>
      <div className="mb-4">
        <h2 className="portal-content-page-title">권한 관리</h2>
        <p className="mt-1 text-sm text-slate-500">
          그룹·메뉴·개인 단위로 메뉴 접근, 허용 계열사, 레포트 권한을 한 화면에서 관리합니다.
        </p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'groups'} onClick={() => setTab('groups')} icon={<UsersRound className="h-4 w-4" />}>
          그룹 관리
        </TabButton>
        <TabButton active={tab === 'menus'} onClick={() => setTab('menus')} icon={<LayoutGrid className="h-4 w-4" />}>
          메뉴 관리
        </TabButton>
        <TabButton active={tab === 'personal'} onClick={() => setTab('personal')} icon={<User className="h-4 w-4" />}>
          개인별 권한
        </TabButton>
      </div>

      {tab === 'groups' && <GroupPermissionsView />}
      {tab === 'menus' && <MenuPermissionsView />}
      {tab === 'personal' && <UserPermissionsView />}
    </section>
  )
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
        active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {icon} {children}
    </button>
  )
}

// ===== 그룹 관리 =====

function GroupPermissionsView() {
  const [selectedGroup, setSelectedGroup] = useState<GroupSelection | null>(null)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
      <div>
        <GroupTreeSelector selectedId={selectedGroup?.id ?? null} onSelect={setSelectedGroup} />
      </div>

      {selectedGroup === null ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 py-20 text-slate-400">
          그룹을 선택하세요.
        </div>
      ) : (
        <GroupDetailPanel key={selectedGroup.id} groupId={selectedGroup.id} groupName={selectedGroup.name} />
      )}
    </div>
  )
}

function GroupDetailPanel({ groupId, groupName }: { groupId: number; groupName: string }) {
  const qc = useQueryClient()

  const menuPermsQuery = useQuery({
    queryKey: ['menu-permissions', 'group', groupId],
    queryFn: ({ signal }) => permissionAdminApi.getMenuPermissions('group', groupId, signal),
  })
  const scopesQuery = useQuery({
    queryKey: ['company-scopes', groupId],
    queryFn: ({ signal }) => permissionAdminApi.getCompanyScopes(groupId, signal),
  })
  const foldersQuery = useQuery({
    queryKey: ['admin-folders'],
    queryFn: ({ signal }) => foldersAdminApi.list(signal),
    staleTime: 30_000,
  })
  const reportsQuery = useQuery({
    queryKey: ['admin-reports'],
    queryFn: ({ signal }) => reportAdminApi.list(signal),
    staleTime: 30_000,
  })

  // 그룹 전환 시 draft를 초기화할 필요가 없다 — 부모가 key={groupId}로 이 컴포넌트를
  // 재마운트시키므로 그룹이 바뀌면 아래 상태들은 항상 초기값에서 새로 시작한다.
  const [menuDraft, setMenuDraft] = useState<Set<string> | null>(null)
  const [scopeDraft, setScopeDraft] = useState<Set<number> | null>(null)
  const [reportIds, setReportIds] = useState<Set<number>>(new Set())
  const [reportPerms, setReportPerms] = useState<PermissionAction[]>(['VIEW'])
  const [grantMessage, setGrantMessage] = useState<string | null>(null)

  const menuKeys = menuDraft ?? new Set(menuPermsQuery.data ?? [])
  const scopeIds = scopeDraft ?? new Set(scopesQuery.data?.map((s) => s.root_folder_id) ?? [])

  const saveMenuMutation = useMutation({
    mutationFn: (keys: string[]) => permissionAdminApi.setMenuPermissions('group', groupId, keys),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-permissions', 'group', groupId] })
      setMenuDraft(null)
    },
  })
  const saveScopeMutation = useMutation({
    mutationFn: (ids: number[]) => permissionAdminApi.setCompanyScopes(groupId, ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-scopes', groupId] })
      setScopeDraft(null)
    },
  })
  const grantMutation = useMutation({
    mutationFn: () =>
      permissionAdminApi.bulkGrantReportPermissions({
        subject_type: 'group',
        subject_id: groupId,
        report_ids: [...reportIds],
        permissions: reportPerms,
      }),
    onSuccess: (added) => {
      setGrantMessage(`${added}건의 권한이 새로 부여되었습니다. (이미 있던 조합은 건너뜀)`)
      setReportIds(new Set())
    },
  })

  function toggleMenu(key: string) {
    const next = new Set(menuKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setMenuDraft(next)
  }
  function togglePerm(p: PermissionAction, checked: boolean) {
    setReportPerms((prev) => (checked ? [...new Set([...prev, p])] : prev.filter((x) => x !== p)))
  }

  const menuDirty = menuDraft !== null
  const scopeDirty = scopeDraft !== null
  const folders = foldersQuery.data ?? []
  const reports = reportsQuery.data ?? []

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-bold text-slate-800">{groupName}</h3>

      {/* 메뉴 접근 권한 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
            <LayoutGrid className="h-4 w-4 text-slate-400" /> 메뉴 접근 권한
          </h4>
          {menuDirty && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setMenuDraft(null)} className="text-xs text-slate-400 hover:text-slate-600">취소</button>
              <button type="button" disabled={saveMenuMutation.isPending}
                onClick={() => saveMenuMutation.mutate([...menuKeys])}
                className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                {saveMenuMutation.isPending ? '저장 중…' : '저장'}
              </button>
            </div>
          )}
        </div>
        {menuPermsQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {MENU_CATALOG.map(([key, label]) => {
              const checked = menuKeys.has(key)
              return (
                <label key={key}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                    checked ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleMenu(key)} className="h-3.5 w-3.5 rounded border-slate-300" />
                  {label}
                </label>
              )
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">홈은 모든 사용자가 기본으로 접근하며, 시스템 운영자는 항상 전체 메뉴에 접근합니다.</p>
      </div>

      {/* 허용 계열사 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
            <Building2 className="h-4 w-4 text-slate-400" /> 허용 계열사
          </h4>
          {scopeDirty && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setScopeDraft(null)} className="text-xs text-slate-400 hover:text-slate-600">취소</button>
              <button type="button" disabled={saveScopeMutation.isPending}
                onClick={() => saveScopeMutation.mutate([...scopeIds])}
                className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                {saveScopeMutation.isPending ? '저장 중…' : '저장'}
              </button>
            </div>
          )}
        </div>
        {foldersQuery.isLoading || scopesQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <CompanyScopePicker folders={folders} value={scopeIds} onChange={setScopeDraft} />
        )}
        <p className="mt-2 text-xs text-slate-400">
          선택한 계열사 하위 모든 레포트에 조회 권한이 자동으로 부여됩니다. 다운로드·새로고침·교체·통계 조회는 아래에서 레포트별로 부여하세요.
        </p>
      </div>

      {/* 레포트 다중 권한 부여 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700">
          <Shield className="h-4 w-4 text-slate-400" /> 레포트 권한 부여
        </h4>
        {foldersQuery.isLoading || reportsQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <>
            <ReportMultiPicker folders={folders} reports={reports} value={reportIds} onChange={setReportIds} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-400">권한(복수 선택)</span>
              {REPORT_PERMISSIONS.map((p) => (
                <label key={p.value} className="inline-flex items-center gap-1 text-sm text-slate-600">
                  <input type="checkbox" checked={reportPerms.includes(p.value)}
                    onChange={(e) => togglePerm(p.value, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300" />
                  {p.label}
                </label>
              ))}
              <button type="button"
                disabled={reportIds.size === 0 || reportPerms.length === 0 || grantMutation.isPending}
                onClick={() => grantMutation.mutate()}
                className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                {grantMutation.isPending ? '부여 중…' : `선택한 ${reportIds.size}개 레포트에 부여`}
              </button>
            </div>
            {grantMessage && <p className="mt-2 text-xs text-green-700">{grantMessage}</p>}
            {grantMutation.isError && <p role="alert" className="mt-2 text-xs text-red-600">부여에 실패했습니다. 다시 시도하세요.</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ===== 메뉴 관리 =====

function MenuPermissionsView() {
  const [selectedMenu, setSelectedMenu] = useState<string>(MENU_CATALOG[0]?.[0] ?? '')

  const subjectsQuery = useQuery({
    queryKey: ['menu-subjects', selectedMenu],
    queryFn: ({ signal }) => permissionAdminApi.subjectsForMenu(selectedMenu, signal),
    enabled: !!selectedMenu,
  })
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    staleTime: 30_000,
  })
  const qc = useQueryClient()

  const revokeGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      const current = await permissionAdminApi.getMenuPermissions('group', groupId)
      await permissionAdminApi.setMenuPermissions('group', groupId, current.filter((k) => k !== selectedMenu))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-subjects', selectedMenu] }),
  })
  const revokeUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const current = await permissionAdminApi.getMenuPermissions('user', userId)
      await permissionAdminApi.setMenuPermissions('user', userId, current.filter((k) => k !== selectedMenu))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-subjects', selectedMenu] }),
  })
  const grantUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const current = await permissionAdminApi.getMenuPermissions('user', userId)
      if (!current.includes(selectedMenu)) {
        await permissionAdminApi.setMenuPermissions('user', userId, [...current, selectedMenu])
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-subjects', selectedMenu] }),
  })

  const subjects = subjectsQuery.data ?? []
  const groupItems = subjects.filter((s) => s.subject_type === 'group')
  const directUserItems = subjects.filter((s) => s.subject_type === 'user' && s.source === 'direct')
  const viaGroupUserItems = subjects.filter((s) => s.subject_type === 'user' && s.source === 'group')

  const users = usersQuery.data ?? []
  const directUserIds = new Set(directUserItems.map((s) => s.subject_id))
  const availableUsers = users.filter((u) => !directUserIds.has(u.id))
  const [addUserId, setAddUserId] = useState<number | null>(null)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <ul className="space-y-0.5">
          {MENU_CATALOG.map(([key, label]) => (
            <li key={key}>
              <button type="button" onClick={() => setSelectedMenu(key)}
                className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedMenu === key ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}>
                <LayoutGrid className={`h-3.5 w-3.5 shrink-0 ${selectedMenu === key ? 'text-white' : 'text-slate-400'}`} />
                <span className="truncate">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-slate-800">
          {MENU_CATALOG.find(([k]) => k === selectedMenu)?.[1] ?? selectedMenu} — 접근 가능 주체
        </h3>

        {subjectsQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase text-slate-400">그룹 권한</h4>
              {groupItems.length === 0 ? (
                <p className="text-sm text-slate-400">그룹 권한으로 접근 가능한 그룹이 없습니다.</p>
              ) : (
                <ul className="space-y-1">
                  {groupItems.map((s) => (
                    <li key={`g-${s.subject_id}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="flex items-center gap-1.5 text-slate-700"><UsersRound className="h-3.5 w-3.5 text-blue-500" /> {s.label}</span>
                      <button type="button" onClick={() => revokeGroupMutation.mutate(s.subject_id)}
                        aria-label={`${s.label} 그룹 메뉴 권한 회수`}
                        className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-xs font-bold uppercase text-slate-400">개별 사용자 권한</h4>
              <div className="mb-2 flex gap-2">
                <UserPicker
                  users={availableUsers}
                  value={addUserId}
                  onChange={setAddUserId}
                  loading={usersQuery.isLoading}
                  ariaLabel="개별 부여 대상 사용자"
                  className="min-w-0 flex-1"
                />
                <button type="button" disabled={addUserId === null || grantUserMutation.isPending}
                  onClick={() => { if (addUserId !== null) { grantUserMutation.mutate(addUserId); setAddUserId(null) } }}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                  부여
                </button>
              </div>
              {directUserItems.length === 0 ? (
                <p className="text-sm text-slate-400">개별 부여된 사용자가 없습니다.</p>
              ) : (
                <ul className="space-y-1">
                  {directUserItems.map((s) => (
                    <li key={`u-${s.subject_id}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="text-slate-700">{s.label}</span>
                      <button type="button" onClick={() => revokeUserMutation.mutate(s.subject_id)}
                        aria-label={`${s.label} 메뉴 권한 회수`}
                        className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {viaGroupUserItems.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase text-slate-400">그룹 소속으로 접근 (여기서 회수 불가)</h4>
                <ul className="space-y-1">
                  {viaGroupUserItems.map((s) => (
                    <li key={`gu-${s.subject_id}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-500">
                      <span>{s.label}</span>
                      <span className="text-xs text-slate-400">그룹 권한</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 개인별 권한 =====

interface DirectReportGroup {
  report_id: number
  report_name: string
  folder_name?: string | null
  items: DirectReportPermission[]
}

function groupDirectReports(rows: DirectReportPermission[]): DirectReportGroup[] {
  const map = new Map<number, DirectReportGroup>()
  for (const row of rows) {
    const existing = map.get(row.report_id)
    if (existing) existing.items.push(row)
    else map.set(row.report_id, { report_id: row.report_id, report_name: row.report_name, folder_name: row.folder_name, items: [row] })
  }
  return [...map.values()].map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => permOrder(a.permission) - permOrder(b.permission)),
  }))
}

interface InheritedReportGroup {
  report_id: number
  report_name: string
  folder_name?: string | null
  items: InheritedReportPermission[]
}

function groupInheritedReports(rows: InheritedReportPermission[]): InheritedReportGroup[] {
  const map = new Map<number, InheritedReportGroup>()
  for (const row of rows) {
    const existing = map.get(row.report_id)
    if (existing) existing.items.push(row)
    else map.set(row.report_id, { report_id: row.report_id, report_name: row.report_name, folder_name: row.folder_name, items: [row] })
  }
  return [...map.values()].map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => permOrder(a.permission) - permOrder(b.permission)),
  }))
}

function UserPermissionsView() {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: ({ signal }) => usersApi.list(signal),
    staleTime: 30_000,
  })
  const users = usersQuery.data ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="mb-1.5 block text-xs font-bold text-slate-500">사용자 선택</label>
        <UserPicker
          users={users}
          value={selectedUserId}
          onChange={setSelectedUserId}
          loading={usersQuery.isLoading}
          ariaLabel="개인별 권한 조회 대상 사용자"
          className="max-w-md"
          inputClassName="py-2"
        />
        <p className="mt-2 text-xs text-slate-400">
          선택한 사용자가 실제로 보유한 권한을 직접 부여분과 그룹·역할·계열사 상속분으로 나누어 보여줍니다.
        </p>
      </div>

      {selectedUserId === null ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 py-20 text-slate-400">
          사용자를 선택하세요.
        </div>
      ) : (
        <UserDetailPanel key={selectedUserId} userId={selectedUserId} />
      )}
    </div>
  )
}

function UserDetailPanel({ userId }: { userId: number }) {
  const qc = useQueryClient()

  const effectiveQuery = useQuery({
    queryKey: ['user-effective-permissions', userId],
    queryFn: ({ signal }) => permissionAdminApi.userEffectivePermissions(userId, signal),
  })
  const foldersQuery = useQuery({
    queryKey: ['admin-folders'],
    queryFn: ({ signal }) => foldersAdminApi.list(signal),
    staleTime: 30_000,
  })
  const reportsQuery = useQuery({
    queryKey: ['admin-reports'],
    queryFn: ({ signal }) => reportAdminApi.list(signal),
    staleTime: 30_000,
  })

  const [menuDraft, setMenuDraft] = useState<Set<string> | null>(null)
  const [reportIds, setReportIds] = useState<Set<number>>(new Set())
  const [reportPerms, setReportPerms] = useState<PermissionAction[]>(['VIEW'])
  const [grantMessage, setGrantMessage] = useState<string | null>(null)

  const effective = effectiveQuery.data
  const menuKeys = menuDraft ?? new Set(effective?.direct_menu_keys ?? [])

  function invalidateEffective() {
    qc.invalidateQueries({ queryKey: ['user-effective-permissions', userId] })
  }

  const saveMenuMutation = useMutation({
    mutationFn: (keys: string[]) => permissionAdminApi.setMenuPermissions('user', userId, keys),
    onSuccess: () => { invalidateEffective(); setMenuDraft(null) },
  })
  const grantMutation = useMutation({
    mutationFn: () =>
      permissionAdminApi.bulkGrantReportPermissions({
        subject_type: 'user',
        subject_id: userId,
        report_ids: [...reportIds],
        permissions: reportPerms,
      }),
    onSuccess: (added) => {
      setGrantMessage(`${added}건의 권한이 새로 부여되었습니다. (이미 있던 조합은 건너뜀)`)
      setReportIds(new Set())
      invalidateEffective()
    },
  })
  const revokeMutation = useMutation({
    mutationFn: ({ reportId, permissionId }: { reportId: number; permissionId: number }) =>
      reportAdminApi.revoke(reportId, permissionId),
    onSuccess: invalidateEffective,
  })

  function toggleMenu(key: string) {
    const next = new Set(menuKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setMenuDraft(next)
  }
  function togglePerm(p: PermissionAction, checked: boolean) {
    setReportPerms((prev) => (checked ? [...new Set([...prev, p])] : prev.filter((x) => x !== p)))
  }

  if (effectiveQuery.isLoading || !effective) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400 shadow-sm">불러오는 중…</div>
  }

  const menuDirty = menuDraft !== null
  const folders = foldersQuery.data ?? []
  const reports = reportsQuery.data ?? []
  const directGroups = groupDirectReports(effective.direct_reports)
  const inheritedGroups = groupInheritedReports(effective.inherited_reports)
  const busy = revokeMutation.isPending

  return (
    <div className="space-y-5">
      {/* 사용자 요약 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-slate-800">{effective.name}</h3>
          <span className="font-mono text-xs text-slate-400">({effective.emp_no})</span>
          {effective.department_name && <span className="text-sm text-slate-500">· {effective.department_name}</span>}
          {effective.is_operator && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">시스템 운영자 · 전체 접근</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {effective.roles.map((r) => (
            <span key={r} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{r}</span>
          ))}
          {effective.groups.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              <UsersRound className="h-3 w-3" /> {g.name}
            </span>
          ))}
          {effective.groups.length === 0 && <span className="text-xs text-slate-400">소속 그룹 없음</span>}
        </div>
      </div>

      {effective.is_operator ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          시스템 운영자는 모든 메뉴와 레포트에 접근할 수 있어 개별 권한을 조정할 필요가 없습니다.
        </div>
      ) : (
        <>
          {/* 메뉴 접근 권한 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <LayoutGrid className="h-4 w-4 text-slate-400" /> 메뉴 접근 권한 (직접 부여)
              </h4>
              {menuDirty && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMenuDraft(null)} className="text-xs text-slate-400 hover:text-slate-600">취소</button>
                  <button type="button" disabled={saveMenuMutation.isPending}
                    onClick={() => saveMenuMutation.mutate([...menuKeys])}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                    {saveMenuMutation.isPending ? '저장 중…' : '저장'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {MENU_CATALOG.map(([key, label]) => {
                const checked = menuKeys.has(key)
                return (
                  <label key={key}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                      checked ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleMenu(key)} className="h-3.5 w-3.5 rounded border-slate-300" />
                    {label}
                  </label>
                )
              })}
            </div>
            {effective.inherited_menus.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-1.5 text-xs font-bold uppercase text-slate-400">그룹·역할 상속 (읽기 전용)</p>
                <div className="flex flex-wrap gap-1.5">
                  {effective.inherited_menus.map((m) => (
                    <span key={`${m.menu_key}-${m.source_type}-${m.source_label}`}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {m.label}
                      <span className="text-slate-400">· {m.source_type === 'role' ? '역할' : '그룹'} {m.source_label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 직접 레포트 권한 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700">
              <Shield className="h-4 w-4 text-slate-400" /> 직접 레포트 권한
            </h4>
            {directGroups.length === 0 ? (
              <p className="text-sm text-slate-400">직접 부여된 레포트 권한이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {directGroups.map((group) => (
                  <li key={group.report_id} className="flex items-start gap-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-700">{group.report_name}</span>
                      {group.folder_name && <span className="ml-1.5 text-xs text-slate-400">{group.folder_name}</span>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {group.items.map((item) => (
                        <span key={item.permission_id}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-2 pr-1 text-xs text-slate-600">
                          {PERM_LABEL[item.permission] ?? item.permission}
                          <button type="button" disabled={busy}
                            onClick={() => revokeMutation.mutate({ reportId: item.report_id, permissionId: item.permission_id })}
                            aria-label={`${group.report_name} ${PERM_LABEL[item.permission] ?? item.permission} 회수`}
                            className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* 직접 권한 부여 */}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-bold uppercase text-slate-400">레포트 권한 추가</p>
              {foldersQuery.isLoading || reportsQuery.isLoading ? (
                <p className="text-sm text-slate-400">불러오는 중…</p>
              ) : (
                <>
                  <ReportMultiPicker folders={folders} reports={reports} value={reportIds} onChange={setReportIds} />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-slate-400">권한(복수 선택)</span>
                    {REPORT_PERMISSIONS.map((p) => (
                      <label key={p.value} className="inline-flex items-center gap-1 text-sm text-slate-600">
                        <input type="checkbox" checked={reportPerms.includes(p.value)}
                          onChange={(e) => togglePerm(p.value, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300" />
                        {p.label}
                      </label>
                    ))}
                    <button type="button"
                      disabled={reportIds.size === 0 || reportPerms.length === 0 || grantMutation.isPending}
                      onClick={() => grantMutation.mutate()}
                      className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                      {grantMutation.isPending ? '부여 중…' : `선택한 ${reportIds.size}개 레포트에 부여`}
                    </button>
                  </div>
                  {grantMessage && <p className="mt-2 text-xs text-green-700">{grantMessage}</p>}
                  {grantMutation.isError && <p role="alert" className="mt-2 text-xs text-red-600">부여에 실패했습니다. 다시 시도하세요.</p>}
                </>
              )}
            </div>
          </div>

          {/* 상속 레포트 권한 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-700">
              <UsersRound className="h-4 w-4 text-slate-400" /> 그룹·계열사 상속 권한
            </h4>
            <p className="mb-3 text-xs text-slate-400">그룹 소속·역할·허용 계열사로 자동 부여된 권한입니다. 회수하려면 해당 그룹/계열사 설정에서 조정하세요.</p>
            {inheritedGroups.length === 0 ? (
              <p className="text-sm text-slate-400">상속된 레포트 권한이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {inheritedGroups.map((group) => (
                  <li key={group.report_id} className="py-2 text-sm">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-medium text-slate-700">{group.report_name}</span>
                      {group.folder_name && <span className="text-xs text-slate-400">{group.folder_name}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.items.map((item, index) => (
                        <span key={`${item.permission}-${item.source_type}-${item.source_label}-${index}`}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                          {PERM_LABEL[item.permission] ?? item.permission}
                          <span className="text-slate-400">· {SOURCE_LABEL[item.source_type] ?? item.source_type} {item.source_label}</span>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
