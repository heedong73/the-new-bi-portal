import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  Clock3,
  Folder,
  Grid2X2,
  List,
  Search,
  SearchX,
  Star,
  X,
} from 'lucide-react'

import { foldersApi, reportsApi } from '@/api/portalApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { reportDisplayName, type FolderTreeNode, type ReportCatalogSort, type ReportSummary } from '@/types/report'

import './ReportsHubPage.css'

type HubMode = 'home' | 'favorites' | 'recent' | 'catalog'
type ViewMode = 'grid' | 'list'

const CATALOG_PAGE_SIZE = 12

function hubMode(pathname: string): HubMode {
  if (pathname === '/reports/favorites') return 'favorites'
  if (pathname === '/reports/recent') return 'recent'
  if (pathname === '/reports/catalog') return 'catalog'
  return 'home'
}

function positiveNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function countReports(node: FolderTreeNode): number {
  return node.report_ids.length + node.children.reduce((sum, child) => sum + countReports(child), 0)
}

function containsFolder(node: FolderTreeNode, folderId: number): boolean {
  return node.id === folderId || node.children.some((child) => containsFolder(child, folderId))
}

function findFolder(nodes: FolderTreeNode[], folderId: number | null): FolderTreeNode | undefined {
  if (folderId == null) return undefined
  for (const node of nodes) {
    if (node.id === folderId) return node
    const nested = findFolder(node.children, folderId)
    if (nested) return nested
  }
  return undefined
}

function visibleFolderLevels(root: FolderTreeNode, selectedFolderId: number | null): FolderTreeNode[][] {
  if (root.children.length === 0) return []
  const levels: FolderTreeNode[][] = [root.children]
  if (selectedFolderId == null) return levels

  let candidates = root.children
  while (candidates.length > 0) {
    const branch: FolderTreeNode | undefined = candidates.find(
      (folder) => containsFolder(folder, selectedFolderId),
    )
    if (!branch || branch.children.length === 0) break
    levels.push(branch.children)
    if (branch.id === selectedFolderId) break
    candidates = branch.children
  }
  return levels
}

function relativeTime(value?: string | null): string {
  if (!value) return '조회 기록 없음'
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return '조회 시각 미상'

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (elapsedSeconds < 60) return '방금 전'
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}일 전`
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

interface PreviewPanelProps {
  title: string
  description: string
  icon: typeof Clock3
  reports: ReportSummary[]
  loading: boolean
  emptyText: string
  onOpen: (reportId: number) => void
  onViewAll: () => void
  kind: 'recent' | 'favorite'
}

function PreviewPanel({
  title,
  description,
  icon: Icon,
  reports,
  loading,
  emptyText,
  onOpen,
  onViewAll,
  kind,
}: PreviewPanelProps) {
  return (
    <section className="report-hub-preview" aria-labelledby={`preview-${kind}`}>
      <div className="report-hub-preview__heading">
        <div className="report-hub-preview__title-wrap">
          <span className="report-hub-preview__icon"><Icon aria-hidden="true" /></span>
          <div>
            <h2 id={`preview-${kind}`}>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <button type="button" onClick={onViewAll} className="report-hub-text-button">
          전체보기 <ArrowRight aria-hidden="true" />
        </button>
      </div>

      <div className="report-hub-preview__items">
        {loading ? (
          <p className="report-hub-preview__state">불러오는 중…</p>
        ) : reports.length === 0 ? (
          <p className="report-hub-preview__state">{emptyText}</p>
        ) : reports.map((report) => (
          <button
            type="button"
            key={`${kind}-${report.id}`}
            onClick={() => onOpen(report.id)}
            className="report-hub-preview-row"
            aria-label={`${reportDisplayName(report)} 열기`}
          >
            <span className="report-hub-preview-row__visual">
              <BarChart3 aria-hidden="true" />
            </span>
            <span className="report-hub-preview-row__content">
              <strong>{reportDisplayName(report)}</strong>
              <span>
                {kind === 'recent'
                  ? relativeTime(report.last_viewed_at)
                  : report.last_viewed_at
                    ? `최근 조회 ${relativeTime(report.last_viewed_at)}`
                    : '즐겨찾기한 리포트'}
              </span>
            </span>
            <ChevronRight className="report-hub-preview-row__chevron" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}

interface ReportItemProps {
  report: ReportSummary
  view: ViewMode
  context: HubMode
  toggling: boolean
  onOpen: (reportId: number) => void
  onToggleFavorite: (report: ReportSummary) => void
}

function ReportItem({ report, view, context, toggling, onOpen, onToggleFavorite }: ReportItemProps) {
  const favorite = Boolean(report.is_favorite)
  const viewedLabel = report.last_viewed_at ? relativeTime(report.last_viewed_at) : null

  return (
    <article className={`report-hub-card report-hub-card--${view}`}>
      <button
        type="button"
        onClick={() => onOpen(report.id)}
        className="report-hub-card__visual"
        aria-label={`${reportDisplayName(report)} 열기`}
      >
        <span className="report-hub-card__visual-label">{report.root_folder_name || report.category || 'REPORT'}</span>
        <BarChart3 aria-hidden="true" />
      </button>

      <div className="report-hub-card__body">
        <div className="report-hub-card__heading">
          <button type="button" onClick={() => onOpen(report.id)} className="report-hub-card__title">
            {reportDisplayName(report)}
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite(report)}
            disabled={toggling}
            aria-label={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            aria-pressed={favorite}
            className={`report-hub-card__favorite ${favorite ? 'report-hub-card__favorite--active' : ''}`}
          >
            <Star aria-hidden="true" />
          </button>
        </div>

        {report.description && (
          <p className="report-hub-card__description">{report.description}</p>
        )}

        <div className="report-hub-card__meta">
          <span title={report.folder_path ?? undefined}>
            <Folder aria-hidden="true" />
            {report.folder_path || '미분류'}
          </span>
          {context === 'recent' && viewedLabel && (
            <span><Clock3 aria-hidden="true" />{viewedLabel}</span>
          )}
        </div>

        <div className="report-hub-card__footer">
          <span>{report.author_label || '작성자 미지정'}</span>
          {viewedLabel && context !== 'recent' && <span>최근 조회 {viewedLabel}</span>}
        </div>
      </div>
    </article>
  )
}

interface HomeReportSearchProps {
  query: string
  onSearch: (query: string | null, replace?: boolean) => void
}

function HomeReportSearch({ query, onSearch }: HomeReportSearchProps) {
  const [value, setValue] = useState(query)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextQuery = value.trim()
    setValue(nextQuery)
    onSearch(nextQuery || null)
  }

  function clear() {
    setValue('')
    onSearch(null, true)
  }

  return (
    <form className="report-hub-home-search" role="search" onSubmit={submit}>
      <Search aria-hidden="true" className="report-hub-home-search__icon" />
      <input
        type="search"
        name="report-home-search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="리포트명, 설명, 작성자 검색"
        aria-label="전체 레포트 검색"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          className="report-hub-home-search__clear"
          aria-label="검색어 초기화"
          title="검색어 초기화"
        >
          <X aria-hidden="true" />
        </button>
      )}
    </form>
  )
}

export default function ReportsHubPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const mode = hubMode(location.pathname)
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const query = searchParams.get('q')?.trim() ?? ''
  const requestedRootFolderId = positiveNumber(searchParams.get('root'))
  const folderId = positiveNumber(searchParams.get('folder'))
  const sort: ReportCatalogSort = searchParams.get('sort') === 'popular' ? 'popular' : 'latest'
  const view: ViewMode = searchParams.get('view') === 'list' ? 'list' : 'grid'

  const rootsQuery = useQuery({
    queryKey: ['folder-tree', query],
    queryFn: ({ signal }) => foldersApi.tree(signal, query || undefined),
    staleTime: 60_000,
  })
  const roots = rootsQuery.data ?? []
  const folderOwnerRoot = folderId == null
    ? undefined
    : roots.find((root) => containsFolder(root, folderId))
  const ownerRootId = folderOwnerRoot?.id ?? null
  const rootFolderId = ownerRootId ?? requestedRootFolderId

  useEffect(() => {
    if ((mode !== 'home' && mode !== 'catalog') || ownerRootId == null || requestedRootFolderId === ownerRootId) {
      return
    }
    const next = new URLSearchParams(location.search)
    next.set('root', String(ownerRootId))
    navigate(`${location.pathname}?${next.toString()}`, { replace: true })
  }, [location.pathname, location.search, mode, navigate, ownerRootId, requestedRootFolderId])

  const recentPreviewQuery = useQuery({
    queryKey: ['report-recent', 3],
    queryFn: ({ signal }) => reportsApi.recent(3, signal),
    enabled: mode === 'home',
    staleTime: 30_000,
  })

  const favoritePreviewQuery = useQuery({
    queryKey: ['report-favorites', 3],
    queryFn: ({ signal }) => reportsApi.favorites(3, signal),
    enabled: mode === 'home',
    staleTime: 30_000,
  })

  const recentQuery = useQuery({
    queryKey: ['report-recent', 'all'],
    queryFn: ({ signal }) => reportsApi.recent(undefined, signal),
    enabled: mode === 'recent',
    staleTime: 30_000,
  })

  const favoritesQuery = useQuery({
    queryKey: ['report-favorites', 'all'],
    queryFn: ({ signal }) => reportsApi.favorites(undefined, signal),
    enabled: mode === 'favorites',
    staleTime: 30_000,
  })

  const favoriteItems = favoritesQuery.data ?? []
  const favoriteRootCounts = favoriteItems.reduce((counts, report) => {
    const rootId = report.root_folder_id
    if (rootId != null) counts.set(rootId, (counts.get(rootId) ?? 0) + 1)
    return counts
  }, new Map<number, number>())
  const favoriteRootOptions = roots.flatMap((root) => {
    const count = favoriteRootCounts.get(root.id) ?? 0
    return count > 0 ? [{ id: root.id, name: root.name, count }] : []
  })
  const isValidFavoriteRoot = requestedRootFolderId != null
    && favoriteRootOptions.some((root) => root.id === requestedRootFolderId)
  const selectedFavoriteRootId = mode === 'favorites' && isValidFavoriteRoot
    ? requestedRootFolderId
    : null
  const filteredFavoriteItems = selectedFavoriteRootId == null
    ? favoriteItems
    : favoriteItems.filter((report) => report.root_folder_id === selectedFavoriteRootId)

  useEffect(() => {
    if (mode !== 'favorites' || favoritesQuery.isLoading || rootsQuery.isLoading) return

    const hasRootParam = searchParams.has('root')
    const hasFolderParam = searchParams.has('folder')
    if (!hasFolderParam && (!hasRootParam || isValidFavoriteRoot)) return

    const next = new URLSearchParams(searchParams)
    next.delete('folder')
    if (!isValidFavoriteRoot) next.delete('root')
    const suffix = next.toString()
    navigate(`${location.pathname}${suffix ? `?${suffix}` : ''}`, { replace: true })
  }, [
    favoritesQuery.isLoading,
    isValidFavoriteRoot,
    location.pathname,
    mode,
    navigate,
    rootsQuery.isLoading,
    searchParams,
  ])

  const catalogQuery = useInfiniteQuery({
    queryKey: ['report-catalog', query, rootFolderId, folderId, sort],
    queryFn: ({ pageParam, signal }) => reportsApi.catalog({
      q: query || undefined,
      rootFolderId,
      folderId,
      sort,
      limit: CATALOG_PAGE_SIZE,
      offset: pageParam,
    }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length
      return nextOffset < lastPage.total ? nextOffset : undefined
    },
    enabled: mode === 'home' || mode === 'catalog',
    staleTime: 30_000,
  })

  const favoriteMutation = useMutation({
    mutationFn: (report: ReportSummary) => report.is_favorite
      ? reportsApi.removeFavorite(report.id)
      : reportsApi.addFavorite(report.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-catalog'] })
      queryClient.invalidateQueries({ queryKey: ['report-favorites'] })
      queryClient.invalidateQueries({ queryKey: ['report-recent'] })
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  const catalogItems = catalogQuery.data?.pages.flatMap((page) => page.items) ?? []
  const catalogTotal = catalogQuery.data?.pages[0]?.total ?? 0
  const currentRoot = roots.find((root) => root.id === rootFolderId)
  const currentFolder = findFolder(currentRoot ? [currentRoot] : roots, folderId)
  const folderLevels = currentRoot ? visibleFolderLevels(currentRoot, folderId) : []
  const reports = mode === 'favorites'
    ? filteredFavoriteItems
    : mode === 'recent'
      ? (recentQuery.data ?? [])
      : catalogItems
  const isLoading = mode === 'favorites'
    ? favoritesQuery.isLoading
    : mode === 'recent'
      ? recentQuery.isLoading
      : catalogQuery.isLoading
  const isError = mode === 'favorites'
    ? favoritesQuery.isError
    : mode === 'recent'
      ? recentQuery.isError
      : catalogQuery.isError

  const pageTitle = mode === 'favorites'
    ? '즐겨찾기 리포트'
    : mode === 'recent'
      ? '최근 본 리포트'
      : query
        ? `“${query}” 검색 결과`
        : currentFolder?.name || currentRoot?.name || '전체 리포트'
  const pageDescription = mode === 'favorites'
    ? '즐겨찾기한 리포트를 최근 조회한 순서대로 모았습니다.'
    : mode === 'recent'
      ? '가장 최근에 확인한 리포트부터 다시 이어볼 수 있습니다.'
      : null

  function openReport(reportId: number) {
    navigate(`/reports/${reportId}`)
  }

  function catalogDestination(changes: Record<string, string | number | null>) {
    const next = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, String(value))
    }
    const suffix = next.toString()
    const destination = mode === 'home' ? '/reports' : '/reports/catalog'
    return `${destination}${suffix ? `?${suffix}` : ''}`
  }

  function selectRoot(folderId: number | null) {
    navigate(catalogDestination({ root: folderId, folder: null }))
  }

  function selectFavoriteRoot(rootId: number | null) {
    const next = new URLSearchParams(location.search)
    next.delete('folder')
    if (rootId == null) next.delete('root')
    else next.set('root', String(rootId))
    const suffix = next.toString()
    navigate(`${location.pathname}${suffix ? `?${suffix}` : ''}`)
  }

  function selectFolder(selectedFolderId: number) {
    navigate(catalogDestination({ folder: selectedFolderId }))
  }

  function selectSort(nextSort: ReportCatalogSort) {
    navigate(catalogDestination({ sort: nextSort === 'latest' ? null : nextSort }))
  }

  function selectView(nextView: ViewMode) {
    const next = new URLSearchParams(location.search)
    if (nextView === 'grid') next.delete('view')
    else next.set('view', nextView)
    const suffix = next.toString()
    navigate(`${location.pathname}${suffix ? `?${suffix}` : ''}`)
  }

  const togglingId = favoriteMutation.isPending ? favoriteMutation.variables?.id : undefined

  return (
    <main className={`report-hub${mode === 'home' ? '' : ' report-hub--page'}`}>
      {mode === 'home' ? (
        <>
          <section className="report-hub-hero">
            <div>
              <p className="report-hub-kicker">Report discovery workspace</p>
              <h1>환영합니다, <strong>{user?.name || '사용자'}</strong>님!</h1>
              <p>필요한 인사이트를 빠르게 찾고, 최근 업무 흐름을 자연스럽게 이어가세요.</p>
            </div>
            <HomeReportSearch
              key={query}
              query={query}
              onSearch={(nextQuery, replace = false) => {
                navigate(catalogDestination({ q: nextQuery }), { replace })
              }}
            />
          </section>

          <div className="report-hub-preview-grid">
            <PreviewPanel
              title="최근 본 리포트"
              description="마지막으로 확인한 리포트"
              icon={Clock3}
              reports={recentPreviewQuery.data ?? []}
              loading={recentPreviewQuery.isLoading}
              emptyText="아직 조회한 리포트가 없습니다."
              onOpen={openReport}
              onViewAll={() => navigate('/reports/recent')}
              kind="recent"
            />
            <PreviewPanel
              title="즐겨찾기"
              description="자주 찾는 리포트 모음"
              icon={Star}
              reports={favoritePreviewQuery.data ?? []}
              loading={favoritePreviewQuery.isLoading}
              emptyText="즐겨찾기한 리포트가 없습니다."
              onOpen={openReport}
              onViewAll={() => navigate('/reports/favorites')}
              kind="favorite"
            />
          </div>
        </>
      ) : (
        <header className="report-hub-page-heading">
          <h1>{pageTitle}</h1>
          {pageDescription && <p>{pageDescription}</p>}
        </header>
      )}

      <section
        className="report-hub-library"
        aria-label={`${mode === 'home' ? '리포트 탐색' : pageTitle} 목록`}
      >
        {(mode === 'home' || mode === 'catalog') && (
          <>
            <div className="report-hub-categories" aria-label="최상위 폴더 선택">
              <button
                type="button"
                onClick={() => selectRoot(null)}
                className={rootFolderId == null ? 'is-active' : ''}
                aria-pressed={rootFolderId == null}
              >
                전체
              </button>
              {roots.map((root) => (
                <button
                  type="button"
                  key={root.id}
                  onClick={() => selectRoot(root.id)}
                  className={rootFolderId === root.id ? 'is-active' : ''}
                  aria-pressed={rootFolderId === root.id}
                >
                  {root.name}
                  <span>{countReports(root)}</span>
                </button>
              ))}
            </div>

            {currentRoot && folderLevels.length > 0 && (
              <div className="report-hub-subcategories" aria-label={`${currentRoot.name} 하위 폴더 선택`}>
                {folderLevels.map((folders, level) => (
                  <div className="report-hub-subcategories__level" key={`${currentRoot.id}-${level}`}>
                    <span className="report-hub-subcategories__label">
                      {level === 0 ? '하위 폴더' : '세부 폴더'}
                    </span>
                    <div className="report-hub-subcategories__items">
                      {folders.map((folder) => {
                        const selected = folderId === folder.id
                        const inPath = folderId != null && containsFolder(folder, folderId)
                        return (
                          <button
                            type="button"
                            key={folder.id}
                            onClick={() => selectFolder(folder.id)}
                            className={selected ? 'is-active' : inPath ? 'is-path' : ''}
                            aria-pressed={selected}
                          >
                            <Folder aria-hidden="true" />
                            {folder.name}
                            <span>{countReports(folder)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'favorites' && favoriteRootOptions.length > 0 && (
          <div className="report-hub-categories" aria-label="즐겨찾기 최상위 폴더 필터">
            <button
              type="button"
              onClick={() => selectFavoriteRoot(null)}
              className={selectedFavoriteRootId == null ? 'is-active' : ''}
              aria-pressed={selectedFavoriteRootId == null}
            >
              전체
              <span>{favoriteItems.length}</span>
            </button>
            {favoriteRootOptions.map((root) => (
              <button
                type="button"
                key={root.id}
                onClick={() => selectFavoriteRoot(root.id)}
                className={selectedFavoriteRootId === root.id ? 'is-active' : ''}
                aria-pressed={selectedFavoriteRootId === root.id}
              >
                {root.name}
                <span>{root.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="report-hub-toolbar">
          <div className="report-hub-toolbar__actions">
            {(mode === 'home' || mode === 'catalog') && (
              <label className="report-hub-sort">
                <span>정렬</span>
                <select value={sort} onChange={(event) => selectSort(event.target.value as ReportCatalogSort)}>
                  <option value="latest">최신 게시순</option>
                  <option value="popular">최근 30일 인기순</option>
                </select>
              </label>
            )}
            <div className="report-hub-view-toggle" aria-label="보기 방식">
              <button
                type="button"
                className={view === 'grid' ? 'is-active' : ''}
                onClick={() => selectView('grid')}
                aria-label="박스형 보기"
                aria-pressed={view === 'grid'}
              >
                <Grid2X2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className={view === 'list' ? 'is-active' : ''}
                onClick={() => selectView('list')}
                aria-label="리스트형 보기"
                aria-pressed={view === 'list'}
              >
                <List aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="report-hub-state" role="status">리포트를 불러오는 중…</div>
        ) : isError ? (
          <div className="report-hub-state report-hub-state--error" role="alert">
            리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
        ) : reports.length === 0 ? (
          <div className="report-hub-state">
            <SearchX aria-hidden="true" />
            <strong>
              {mode === 'favorites'
                ? '즐겨찾기한 리포트가 없습니다.'
                : mode === 'recent'
                  ? '최근 본 리포트가 없습니다.'
                  : '조건에 맞는 리포트가 없습니다.'}
            </strong>
            <span>다른 카테고리나 검색어를 확인해 보세요.</span>
          </div>
        ) : (
          <div className={`report-hub-results report-hub-results--${view}`}>
            {reports.map((report) => (
              <ReportItem
                key={report.id}
                report={report}
                view={view}
                context={mode}
                toggling={togglingId === report.id}
                onOpen={openReport}
                onToggleFavorite={(item) => favoriteMutation.mutate(item)}
              />
            ))}
          </div>
        )}

        {(mode === 'home' || mode === 'catalog') && catalogQuery.hasNextPage && (
          <div className="report-hub-load-more">
            <button
              type="button"
              onClick={() => catalogQuery.fetchNextPage()}
              disabled={catalogQuery.isFetchingNextPage}
            >
              {catalogQuery.isFetchingNextPage ? '불러오는 중…' : `더 보기 (${catalogItems.length}/${catalogTotal})`}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
