/** 권한 관리 — 그룹 중심 메뉴 권한과 명시적 레포트 다중 권한 부여 화면.
 *
 * - 그룹 관리: 그룹을 고르면 메뉴 접근(통계·KPI 전광판)을 토글하고, 레포트를
 *   다중 선택해 권한(조회/내보내기/원본 다운로드/새로고침/교체/기본 뷰 관리/
 *   통계 조회)을 한 번에 부여한다.
 * - 메뉴 권한: 부여 대상 메뉴(통계·KPI 전광판)별로 접근 가능한 주체(그룹/개별 사용자)
 *   목록을 보여준다. 그룹 권한으로 얻은 사용자는 여기서 회수할 수 없다(그룹 관리에서 조정).
 *   관리자·운영 메뉴는 System_Operator 전용이라 개별 부여 대상이 아니다.
 *
 * 기존 레포트 관리 화면의 레포트별 '권한' 버튼(ReportPermissionPanel)은 병행 유지한다.
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, Shield, User, UsersRound, X } from 'lucide-react'

import { permissionAdminApi, usersApi } from '@/api/adminApi'
import { foldersAdminApi, reportAdminApi } from '@/api/reportAdminApi'
import { MENU_CATALOG } from '@/constants/menus'
import type { PermissionAction } from '@/types/reportAdmin'
import type { DirectReportPermission, InheritedReportPermission } from '@/types/admin'
import PermissionHint from './PermissionHint'
import ReportMultiPicker from './ReportMultiPicker'
import GroupTreeSelector, { type GroupSelection } from './GroupTreeSelector'
import { UserPicker } from './EntityPicker'

const REPORT_PERMISSIONS: { value: PermissionAction; label: string; hint?: string }[] = [
  { value: 'VIEW', label: '조회' },
  { value: 'DOWNLOAD', label: '내보내기', hint: 'PDF·PowerPoint·이미지로 내보낼 수 있습니다. 원본 파일(.pbix)은 포함되지 않습니다.' },
  { value: 'DOWNLOAD_PBIX', label: '원본 다운로드', hint: 'Power BI 원본 파일(.pbix)을 내려받을 수 있습니다. 데이터 모델이 포함되므로 꼭 필요한 대상에만 부여하세요.' },
  { value: 'REFRESH', label: '새로고침' },
  { value: 'MANAGE_REPORT', label: '교체', hint: '레포트 원본 파일(.pbix)을 새 파일로 덮어써 내용을 교체할 수 있습니다.' },
  { value: 'MANAGE_DEFAULT_VIEW', label: '기본 뷰 관리', hint: "레포트 뷰의 '현재 뷰를 기본값으로 저장'과 '기본 뷰 초기화'를 사용할 수 있습니다. 모든 사용자에게 보이는 시작 화면이 바뀝니다." },
  { value: 'VIEW_STATS', label: '통계 조회' },
]

const PERM_LABEL: Record<string, string> = {
  VIEW: '조회',
  DOWNLOAD: '내보내기',
  DOWNLOAD_PBIX: '원본 다운로드',
  REFRESH: '새로고침',
  MANAGE_REPORT: '교체',
  MANAGE_DEFAULT_VIEW: '기본 뷰 관리',
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
}

type Tab = 'groups' | 'menus' | 'personal'

export default function PermissionsPage() {
  const [tab, setTab] = useState<Tab>('groups')

  return (
    <section>
      <div className="mb-4">
        <h2 className="portal-content-page-title">권한 관리</h2>
        <p className="mt-1 text-sm text-slate-500">
          그룹·개인 단위로 메뉴 접근과 레포트별 권한을 한 화면에서 관리합니다.
          관리자·운영 메뉴는 시스템 운영자만 접근합니다.
        </p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'groups'} onClick={() => setTab('groups')} icon={<UsersRound className="h-4 w-4" />}>
          그룹 관리
        </TabButton>
        <TabButton active={tab === 'menus'} onClick={() => setTab('menus')} icon={<LayoutGrid className="h-4 w-4" />}>
          메뉴 권한
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
  const [reportIds, setReportIds] = useState<Set<number>>(new Set())
  const [reportPerms, setReportPerms] = useState<PermissionAction[]>(['VIEW'])
  const [grantMessage, setGrantMessage] = useState<string | null>(null)

  const menuKeys = menuDraft ?? new Set(menuPermsQuery.data ?? [])
  const selectedReportIds = [...reportIds].sort((a, b) => a - b)
  const groupReportPermissionsQuery = useQuery({
    queryKey: ['group-report-permissions', groupId, selectedReportIds],
    queryFn: ({ signal }) =>
      permissionAdminApi.getGroupReportPermissions(groupId, selectedReportIds, signal),
    enabled: selectedReportIds.length > 0,
  })

  const saveMenuMutation = useMutation({
    mutationFn: (keys: string[]) => permissionAdminApi.setMenuPermissions('group', groupId, keys),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-permissions', 'group', groupId] })
      setMenuDraft(null)
    },
  })
  const applyGroupPermissionsMutation = useMutation({
    mutationFn: () =>
      permissionAdminApi.setGroupReportPermissions(groupId, {
        report_ids: [...reportIds],
        permissions: reportPerms,
      }),
    onSuccess: ({ added, removed }) => {
      setGrantMessage(
        added || removed
          ? `권한을 적용했습니다. 새로 부여 ${added}건 · 회수 ${removed}건`
          : '선택한 레포트의 그룹 권한이 이미 체크한 목록과 같습니다.',
      )
      qc.invalidateQueries({ queryKey: ['group-report-permissions', groupId] })
      setReportIds(new Set())
      setReportPerms(['VIEW'])
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
  function handleGroupReportSelection(nextReportIds: Set<number>) {
    setReportIds(nextReportIds)
    // 선택된 레포트마다 기존 권한이 다를 수 있으므로, 교체할 권한을 명시적으로 고르게 한다.
    setReportPerms(nextReportIds.size > 0 ? [] : ['VIEW'])
  }

  const menuDirty = menuDraft !== null
  const folders = foldersQuery.data ?? []
  const reports = reportsQuery.data ?? []
  const existingGroupPermissionsByReport = new Map<number, string[]>()
  for (const item of groupReportPermissionsQuery.data ?? []) {
    const permissions = existingGroupPermissionsByReport.get(item.report_id) ?? []
    permissions.push(item.permission)
    existingGroupPermissionsByReport.set(item.report_id, permissions)
  }

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
        <p className="mt-2 text-sm text-slate-400">
          홈·서비스 센터는 모든 사용자가 기본으로 접근합니다. 관리자·운영 메뉴(레포트 관리, 사용자,
          그룹, 공휴일, 감사 로그, 운영 상태, Refresh 현황, 메일 이력·스케줄)는 시스템 운영자
          전용이라 부여 대상이 아닙니다.
        </p>
      </div>

      {/* 레포트 다중 권한 설정 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700">
          <Shield className="h-4 w-4 text-slate-400" /> 레포트 권한 설정
        </h4>
        {foldersQuery.isLoading || reportsQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <>
            <ReportMultiPicker folders={folders} reports={reports} value={reportIds} onChange={handleGroupReportSelection} />
            {selectedReportIds.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-600">선택한 레포트의 기존 그룹 권한</p>
                <p className="mt-0.5 text-xs text-slate-400">{groupName} 그룹에 직접 부여된 권한만 표시합니다.</p>
                {groupReportPermissionsQuery.isLoading ? (
                  <p className="mt-2 text-xs text-slate-400">기존 권한을 불러오는 중…</p>
                ) : groupReportPermissionsQuery.isError ? (
                  <p role="alert" className="mt-2 text-xs text-red-600">기존 권한을 불러오지 못했습니다. 다시 시도하세요.</p>
                ) : (
                  <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                    {selectedReportIds.map((reportId) => {
                      const report = reports.find((item) => item.id === reportId)
                      const existingPermissions = [...(existingGroupPermissionsByReport.get(reportId) ?? [])]
                        .sort((a, b) => permOrder(a) - permOrder(b))
                      const reportName = report?.display_name || report?.report_name || report?.report_id || `레포트 #${reportId}`
                      return (
                        <li key={reportId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm">
                          <span className="min-w-0 flex-1 truncate text-slate-700">{reportName}</span>
                          {existingPermissions.length === 0 ? (
                            <span className="shrink-0 text-xs text-slate-400">권한 없음</span>
                          ) : (
                            <span className="flex shrink-0 flex-wrap justify-end gap-1">
                              {existingPermissions.map((permission) => (
                                <span key={permission} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                  {PERM_LABEL[permission] ?? permission}
                                </span>
                              ))}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
            <p className="mt-2 text-sm text-slate-400">
              선택한 레포트의 이 그룹 직접 권한은 아래 체크한 목록으로 교체됩니다. 체크하지 않은 기존 그룹 권한은 회수됩니다. 단, 내보내기·원본 다운로드·새로고침·교체·기본 뷰 관리 권한을 선택하면 조회 권한은 자동으로 포함됩니다. 상위 폴더 경로는 자동으로 표시되지만, 같은 폴더의 다른 레포트와 이후 등록되는 레포트는 별도로 권한을 부여해야 합니다.
            </p>
            {selectedReportIds.length > 0 && reportPerms.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">기존 권한 구성이 레포트마다 다를 수 있습니다. 적용할 권한을 직접 선택하세요.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-400">권한(복수 선택 · 적용 시 기존 그룹 권한 교체)</span>
              {REPORT_PERMISSIONS.map((p) => (
                <span key={p.value} className="inline-flex items-center gap-1">
                  <label className="inline-flex items-center gap-1 text-sm text-slate-600">
                    <input type="checkbox" checked={reportPerms.includes(p.value)}
                      onChange={(e) => togglePerm(p.value, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300" />
                    {p.label}
                  </label>
                  {p.hint && <PermissionHint text={p.hint} label={p.label} />}
                </span>
              ))}
              <button type="button"
                disabled={reportIds.size === 0 || reportPerms.length === 0 || applyGroupPermissionsMutation.isPending || groupReportPermissionsQuery.isLoading || groupReportPermissionsQuery.isError}
                onClick={() => applyGroupPermissionsMutation.mutate()}
                className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                {applyGroupPermissionsMutation.isPending ? '적용 중…' : `선택한 ${reportIds.size}개 레포트 권한 적용`}
              </button>
            </div>

            {grantMessage && <p className="mt-2 text-xs text-green-700">{grantMessage}</p>}
            {applyGroupPermissionsMutation.isError && <p role="alert" className="mt-2 text-xs text-red-600">권한 적용에 실패했습니다. 다시 시도하세요.</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ===== 메뉴 권한 =====

function MenuPermissionsView() {
  const [selectedMenu, setSelectedMenu] = useState<string>(MENU_CATALOG[0]?.[0] ?? '')
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set())
  const [addUserId, setAddUserId] = useState<number | null>(null)

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
    onSuccess: (_data, groupId) => {
      setExpandedGroupIds((current) => {
        const next = new Set(current)
        next.delete(groupId)
        return next
      })
      qc.invalidateQueries({ queryKey: ['menu-subjects', selectedMenu] })
    },
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
  const groupMembersById = new Map<number, typeof viaGroupUserItems>()
  for (const member of viaGroupUserItems) {
    if (member.source_group_id === null) continue
    const members = groupMembersById.get(member.source_group_id) ?? []
    members.push(member)
    groupMembersById.set(member.source_group_id, members)
  }
  const inheritedUserCount = new Set(viaGroupUserItems.map((s) => s.subject_id)).size

  const users = usersQuery.data ?? []
  const directUserIds = new Set(directUserItems.map((s) => s.subject_id))
  const availableUsers = users.filter((u) => !directUserIds.has(u.id))

  function selectMenu(menuKey: string) {
    setSelectedMenu(menuKey)
    setExpandedGroupIds(new Set())
  }

  function toggleGroup(groupId: number) {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* 부여 대상 메뉴가 하나뿐이면 선택 목록 없이 바로 주체를 보여준다. */}
      {MENU_CATALOG.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <ul className="space-y-0.5">
            {MENU_CATALOG.map(([key, label]) => (
              <li key={key}>
                <button type="button" onClick={() => selectMenu(key)}
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
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-sm font-bold text-slate-800">
          {MENU_CATALOG.find(([k]) => k === selectedMenu)?.[1] ?? selectedMenu} — 접근 가능 주체
        </h3>
        <p className="mb-4 text-xs text-slate-400">
          이 메뉴는 그룹 또는 개별 사용자에게 부여할 수 있습니다.
          {selectedMenu === 'stats' && ' 레포트별 통계 범위는 각 레포트의 \u2018통계 조회\u2019 권한으로 결정됩니다.'}
          {selectedMenu === 'display_boards' && ' 전광판에서 실제로 표시되는 화면은 각 레포트의 \u2018조회\u2019 권한으로 결정됩니다.'}
        </p>

        {subjectsQuery.isLoading ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold uppercase text-slate-400">그룹 권한</h4>
                  {groupItems.length > 0 && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      그룹을 선택하면 소속 사용자를 확인할 수 있습니다.
                    </p>
                  )}
                </div>
                {groupItems.length > 0 && (
                  <span className="text-xs text-slate-400">
                    {groupItems.length}개 그룹 · 사용자 {inheritedUserCount}명
                  </span>
                )}
              </div>
              {groupItems.length === 0 ? (
                <p className="text-sm text-slate-400">그룹 권한으로 접근 가능한 그룹이 없습니다.</p>
              ) : (
                <ul className="space-y-1.5">
                  {groupItems.map((group) => {
                    const expanded = expandedGroupIds.has(group.subject_id)
                    const members = groupMembersById.get(group.subject_id) ?? []
                    const panelId = `menu-group-${selectedMenu}-${group.subject_id}`
                    return (
                      <li key={`g-${group.subject_id}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center gap-2 bg-slate-50 px-2 py-1.5">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            onClick={() => toggleGroup(group.subject_id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                          >
                            <span
                              aria-hidden="true"
                              className={`inline-block text-[10px] text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                            >
                              ▶
                            </span>
                            <UsersRound className="h-4 w-4 shrink-0 text-blue-500" />
                            <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                            <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                              {members.length}명
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={revokeGroupMutation.isPending}
                            onClick={() => revokeGroupMutation.mutate(group.subject_id)}
                            aria-label={`${group.label} 그룹 메뉴 권한 회수`}
                            title="그룹 메뉴 권한 회수"
                            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {expanded && (
                          <div id={panelId} className="border-t border-slate-200 bg-white">
                            {members.length === 0 ? (
                              <p className="px-9 py-3 text-xs text-slate-400">소속 사용자가 없습니다.</p>
                            ) : (
                              <ul className="max-h-72 overflow-y-auto py-1">
                                {members.map((member) => (
                                  <li
                                    key={`g-${group.subject_id}-u-${member.subject_id}`}
                                    className="flex items-center justify-between gap-3 px-9 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                                  >
                                    <span className="min-w-0 truncate">{member.label}</span>
                                    <span className="shrink-0 text-xs text-slate-400">그룹 상속</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
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
                <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {directUserItems.map((s) => (
                    <li key={`u-${s.subject_id}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-slate-700">{s.label}</span>
                      <button type="button" onClick={() => revokeUserMutation.mutate(s.subject_id)}
                        aria-label={`${s.label} 메뉴 권한 회수`}
                        className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
          선택한 사용자가 실제로 보유한 권한을 직접 부여분과 그룹·역할·부서 상속분으로 나누어 보여줍니다.
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
  const [inheritedQuery, setInheritedQuery] = useState('')
  const [inheritedSourceFilter, setInheritedSourceFilter] = useState<'all' | 'group' | 'role' | 'dept'>('all')
  const [inheritedCollapsedFolders, setInheritedCollapsedFolders] = useState<Set<number> | null>(null)

  const effective = effectiveQuery.data
  const menuKeys = menuDraft ?? new Set(effective?.direct_menu_keys ?? [])

  function invalidateEffective() {
    qc.invalidateQueries({ queryKey: ['user-effective-permissions', userId] })
  }

  const saveMenuMutation = useMutation({
    mutationFn: (keys: string[]) => permissionAdminApi.setMenuPermissions('user', userId, keys),
    onSuccess: () => { invalidateEffective(); setMenuDraft(null) },
  })
  const applyUserPermissionsMutation = useMutation({
    mutationFn: () =>
      permissionAdminApi.setUserReportPermissions(userId, {
        report_ids: [...reportIds],
        permissions: reportPerms,
      }),
    onSuccess: ({ added, removed }) => {
      setGrantMessage(
        added || removed
          ? `권한을 적용했습니다. 새로 부여 ${added}건 · 회수 ${removed}건`
          : '선택한 레포트의 직접 개인 권한이 이미 체크한 목록과 같습니다.',
      )
      setReportIds(new Set())
      setReportPerms(['VIEW'])
      invalidateEffective()
    },
  })
  const revokeMutation = useMutation({
    mutationFn: ({ reportId, permissionId }: { reportId: number; permissionId: number }) =>
      reportAdminApi.revoke(reportId, permissionId),
    onSuccess: () => {
      // 회수 전 선택한 교체 초안이 삭제한 권한을 다시 부여하지 않도록 초기화한다.
      setReportIds(new Set())
      setReportPerms(['VIEW'])
      invalidateEffective()
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
  function handleUserReportSelection(nextReportIds: Set<number>) {
    setReportIds(nextReportIds)
    if (nextReportIds.size === 0) {
      setReportPerms(['VIEW'])
      return
    }
    if (nextReportIds.size > 1) {
      // 여러 레포트의 기존 권한은 서로 다를 수 있으므로, 교체할 권한을 명시적으로 고르게 한다.
      setReportPerms([])
      return
    }

    const [reportId] = nextReportIds
    const grantablePermissions = new Set<PermissionAction>(REPORT_PERMISSIONS.map((item) => item.value))
    const existingPermissions = [...new Set(
      (effective?.direct_reports ?? [])
        .filter((item) => item.report_id === reportId)
        .map((item) => item.permission),
    )]
      .filter((permission): permission is PermissionAction => grantablePermissions.has(permission as PermissionAction))
      .sort((a, b) => permOrder(a) - permOrder(b))
    setReportPerms(existingPermissions.length > 0 ? existingPermissions : ['VIEW'])
  }

  if (effectiveQuery.isLoading || !effective) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400 shadow-sm">불러오는 중…</div>
  }

  const menuDirty = menuDraft !== null
  const folders = foldersQuery.data ?? []
  const reports = reportsQuery.data ?? []
  const directGroups = groupDirectReports(effective.direct_reports)
  const inheritedGroups = groupInheritedReports(effective.inherited_reports)
  const selectedReportIds = [...reportIds].sort((a, b) => a - b)
  const existingDirectPermissionsByReport = new Map<number, string[]>()
  for (const item of effective.direct_reports) {
    const permissions = existingDirectPermissionsByReport.get(item.report_id) ?? []
    permissions.push(item.permission)
    existingDirectPermissionsByReport.set(item.report_id, permissions)
  }
  const busy = revokeMutation.isPending || applyUserPermissionsMutation.isPending

  const inheritedGroupsByReportId = new Map<number, InheritedReportGroup>()
  for (const group of inheritedGroups) inheritedGroupsByReportId.set(group.report_id, group)
  const inheritedChildFolders = new Map<number | null, typeof folders>()
  for (const folder of [...folders].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
    const parentId = folder.parent_id ?? null
    const siblings = inheritedChildFolders.get(parentId) ?? []
    siblings.push(folder)
    inheritedChildFolders.set(parentId, siblings)
  }
  const inheritedReportsByFolder = new Map<number | null, typeof reports>()
  for (const report of reports) {
    const folderId = report.folder_id ?? null
    const siblings = inheritedReportsByFolder.get(folderId) ?? []
    siblings.push(report)
    inheritedReportsByFolder.set(folderId, siblings)
  }
  const defaultInheritedCollapsedFolders = new Set(
    folders.filter((folder) => folder.parent_id !== null).map((folder) => folder.id),
  )
  const collapsedInheritedFolders = inheritedCollapsedFolders ?? defaultInheritedCollapsedFolders
  const inheritedTerm = inheritedQuery.trim().toLowerCase()
  const inheritedSourceFilters: { value: 'all' | 'group' | 'role' | 'dept'; label: string }[] = [
    { value: 'all', label: '전체' },
    { value: 'group', label: '그룹' },
    { value: 'role', label: '역할' },
    { value: 'dept', label: '부서' },
  ]
  const visibleInheritedItems = (group: InheritedReportGroup) =>
    group.items.filter((item) => inheritedSourceFilter === 'all' || item.source_type === inheritedSourceFilter)
  const matchesInheritedGroup = (group: InheritedReportGroup, reportName: string) => {
    const items = visibleInheritedItems(group)
    if (items.length === 0) return false
    if (!inheritedTerm) return true
    return `${reportName} ${group.report_name} ${items.map((item) => `${item.permission} ${item.source_label}`).join(' ')}`
      .toLowerCase()
      .includes(inheritedTerm)
  }
  const reportHasInheritedMatch = (report: (typeof reports)[number]) => {
    const group = inheritedGroupsByReportId.get(report.id)
    if (!group) return false
    return matchesInheritedGroup(group, report.display_name || report.report_name || report.report_id)
  }
  const inheritedFolderMatchCache = new Map<number, boolean>()
  function folderHasInheritedMatch(folderId: number): boolean {
    const cached = inheritedFolderMatchCache.get(folderId)
    if (cached !== undefined) return cached
    const found = (inheritedReportsByFolder.get(folderId) ?? []).some(reportHasInheritedMatch)
      || (inheritedChildFolders.get(folderId) ?? []).some((folder) => folderHasInheritedMatch(folder.id))
    inheritedFolderMatchCache.set(folderId, found)
    return found
  }
  function toggleInheritedFolder(folderId: number) {
    setInheritedCollapsedFolders((previous) => {
      const next = new Set(previous ?? defaultInheritedCollapsedFolders)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }
  function renderInheritedReport(report: (typeof reports)[number], depth: number): ReactNode {
    const group = inheritedGroupsByReportId.get(report.id)
    if (!group || !matchesInheritedGroup(group, report.display_name || report.report_name || report.report_id)) return null
    const items = visibleInheritedItems(group)
    const reportName = report.display_name || report.report_name || report.report_id
    return (
      <div key={report.id} className="rounded py-1.5 pr-2 hover:bg-slate-50" style={{ paddingLeft: depth * 16 + 26 }}>
        <p className="truncate text-sm font-medium text-slate-700">{reportName}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {items.map((item, index) => (
            <span key={`${item.permission}-${item.source_type}-${item.source_label}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {PERM_LABEL[item.permission] ?? item.permission}
              <span className="text-slate-400">· {SOURCE_LABEL[item.source_type] ?? item.source_type} {item.source_label}</span>
            </span>
          ))}
        </div>
      </div>
    )
  }
  function renderInheritedFolder(folder: (typeof folders)[number], depth: number): ReactNode {
    if (!folderHasInheritedMatch(folder.id)) return null
    const isOpen = inheritedTerm ? true : !collapsedInheritedFolders.has(folder.id)
    const children = inheritedChildFolders.get(folder.id) ?? []
    const folderReports = (inheritedReportsByFolder.get(folder.id) ?? []).filter(reportHasInheritedMatch)
    return (
      <div key={folder.id}>
        <div className="flex items-center gap-1 py-1" style={{ paddingLeft: depth * 16 + 4 }}>
          <button type="button" onClick={() => toggleInheritedFolder(folder.id)}
            aria-label={isOpen ? '폴더 접기' : '폴더 펼치기'} className="w-4 shrink-0 text-xs text-slate-400">
            {isOpen ? '▾' : '▸'}
          </button>
          <span className="truncate text-sm font-medium text-slate-700">{folder.name}</span>
        </div>
        {isOpen && (
          <div>
            {children.map((child) => renderInheritedFolder(child, depth + 1))}
            {folderReports.map((report) => renderInheritedReport(report, depth + 1))}
          </div>
        )}
      </div>
    )
  }
  const inheritedRoots = inheritedChildFolders.get(null) ?? []
  const inheritedRootReports = (inheritedReportsByFolder.get(null) ?? []).filter(reportHasInheritedMatch)
  const listedInheritedReportIds = new Set(reports.map((report) => report.id))
  const unlistedInheritedGroups = inheritedGroups.filter((group) =>
    !listedInheritedReportIds.has(group.report_id) && matchesInheritedGroup(group, group.report_name),
  )
  const hasInheritedMatches = reports.some(reportHasInheritedMatch) || unlistedInheritedGroups.length > 0

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

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-bold uppercase text-slate-400">직접 레포트 권한 설정</p>
              {foldersQuery.isLoading || reportsQuery.isLoading ? (
                <p className="text-sm text-slate-400">불러오는 중…</p>
              ) : (
                <>
                  <ReportMultiPicker folders={folders} reports={reports} value={reportIds} onChange={handleUserReportSelection} />
                  {selectedReportIds.length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-bold text-slate-600">선택한 레포트의 기존 직접 개인 권한</p>
                      <p className="mt-0.5 text-xs text-slate-400">이 사용자에게 직접 부여된 권한만 표시합니다.</p>
                      <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                        {selectedReportIds.map((reportId) => {
                          const report = reports.find((item) => item.id === reportId)
                          const existingPermissions = [...(existingDirectPermissionsByReport.get(reportId) ?? [])]
                            .sort((a, b) => permOrder(a) - permOrder(b))
                          const reportName = report?.display_name || report?.report_name || report?.report_id || `레포트 #${reportId}`
                          return (
                            <li key={reportId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1.5 text-sm">
                              <span className="min-w-0 flex-1 truncate text-slate-700">{reportName}</span>
                              {existingPermissions.length === 0 ? (
                                <span className="shrink-0 text-xs text-slate-400">권한 없음</span>
                              ) : (
                                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                                  {existingPermissions.map((permission) => (
                                    <span key={permission} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                      {PERM_LABEL[permission] ?? permission}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                  <p className="mt-2 text-sm text-slate-400">
                    선택한 레포트의 이 사용자 직접 권한은 아래 체크한 목록으로 교체됩니다. 체크하지 않은 기존 직접 권한은 회수됩니다. 그룹·역할·부서 상속 권한은 변경되지 않습니다. 내보내기·원본 다운로드·새로고침·교체·기본 뷰 관리 권한을 선택하면 조회 권한은 자동으로 포함됩니다.
                  </p>
                  {selectedReportIds.length > 1 && reportPerms.length === 0 && (
                    <p className="mt-1 text-xs text-amber-700">여러 레포트의 기존 직접 권한은 서로 다를 수 있습니다. 적용할 권한을 직접 선택하세요.</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-slate-400">권한(복수 선택 · 적용 시 기존 직접 권한 교체)</span>
                    {REPORT_PERMISSIONS.map((p) => (
                      <span key={p.value} className="inline-flex items-center gap-1">
                        <label className="inline-flex items-center gap-1 text-sm text-slate-600">
                          <input type="checkbox" checked={reportPerms.includes(p.value)}
                            onChange={(e) => togglePerm(p.value, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300" />
                          {p.label}
                        </label>
                        {p.hint && <PermissionHint text={p.hint} label={p.label} />}
                      </span>
                    ))}
                    <button type="button"
                      disabled={reportIds.size === 0 || reportPerms.length === 0 || applyUserPermissionsMutation.isPending || revokeMutation.isPending}
                      onClick={() => applyUserPermissionsMutation.mutate()}
                      className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                      {applyUserPermissionsMutation.isPending ? '적용 중…' : `선택한 ${reportIds.size}개 레포트 권한 적용`}
                    </button>
                  </div>
                  {grantMessage && <p className="mt-2 text-xs text-green-700">{grantMessage}</p>}
                  {applyUserPermissionsMutation.isError && <p role="alert" className="mt-2 text-xs text-red-600">권한 적용에 실패했습니다. 다시 시도하세요.</p>}
                </>
              )}
            </div>
          </div>

          {/* 상속 레포트 권한 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-700">
              <UsersRound className="h-4 w-4 text-slate-400" /> 그룹·역할·부서 상속 권한
            </h4>
            <p className="mb-3 text-xs text-slate-400">그룹 소속·역할·부서에서 자동 부여된 읽기 전용 권한입니다. 회수하려면 해당 그룹·역할·부서 설정에서 조정하세요.</p>
            {foldersQuery.isError || reportsQuery.isError ? (
              <p role="alert" className="text-sm text-red-600">상속 권한 트리를 불러오지 못했습니다. 다시 시도하세요.</p>
            ) : foldersQuery.isLoading || reportsQuery.isLoading ? (
              <p className="text-sm text-slate-400">불러오는 중…</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {inheritedSourceFilters.map((filter) => (
                    <button key={filter.value} type="button" onClick={() => setInheritedSourceFilter(filter.value)}
                      aria-pressed={inheritedSourceFilter === filter.value}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        inheritedSourceFilter === filter.value
                          ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}>
                      {filter.label}
                    </button>
                  ))}
                </div>
                <input value={inheritedQuery} onChange={(event) => setInheritedQuery(event.target.value)}
                  placeholder="상속 권한 레포트 또는 출처 검색" aria-label="상속 권한 검색"
                  className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                {!hasInheritedMatches ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-400">
                    {inheritedGroups.length === 0 ? '상속된 레포트 권한이 없습니다.' : '검색 또는 출처 조건에 맞는 상속 권한이 없습니다.'}
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-300 p-1">
                    {inheritedRoots.map((folder) => renderInheritedFolder(folder, 0))}
                    {inheritedRootReports.map((report) => renderInheritedReport(report, 0))}
                    {unlistedInheritedGroups.map((group) => {
                      const items = visibleInheritedItems(group)
                      return (
                        <div key={group.report_id} className="rounded px-2 py-1.5 hover:bg-slate-50">
                          <p className="text-sm font-medium text-slate-700">{group.report_name}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {items.map((item, index) => (
                              <span key={`${item.permission}-${item.source_type}-${item.source_label}-${index}`}
                                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                {PERM_LABEL[item.permission] ?? item.permission}
                                <span className="text-slate-400">· {SOURCE_LABEL[item.source_type] ?? item.source_type} {item.source_label}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
