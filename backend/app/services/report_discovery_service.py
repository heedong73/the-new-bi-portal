"""권한 필터가 적용된 레포트 탐색·최근 조회·인기순 조회 서비스."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report import (
    Report,
    ReportFavorite,
    ReportFolder,
    ReportViewDailyStat,
    UserReportActivity,
)

POPULARITY_DAYS = 30


@dataclass(frozen=True)
class FolderContext:
    paths: dict[int, str]
    roots: dict[int, tuple[int, str]]
    descendants: dict[int, set[int]]


@dataclass(frozen=True)
class DiscoveryItem:
    report: Report
    folder_path: str | None
    root_folder_id: int | None
    root_folder_name: str | None
    last_viewed_at: datetime | None
    view_count: int


async def load_folder_context(db: AsyncSession) -> FolderContext:
    folders = (
        await db.execute(select(ReportFolder).order_by(ReportFolder.sort_order, ReportFolder.id))
    ).scalars().all()
    by_id = {folder.id: folder for folder in folders}
    children: dict[int, list[int]] = {}
    for folder in folders:
        if folder.parent_id is not None:
            children.setdefault(folder.parent_id, []).append(folder.id)

    paths: dict[int, str] = {}
    roots: dict[int, tuple[int, str]] = {}

    def resolve(folder_id: int) -> tuple[str, int, str]:
        if folder_id in paths:
            root_id, root_name = roots[folder_id]
            return paths[folder_id], root_id, root_name
        chain: list[ReportFolder] = []
        seen: set[int] = set()
        current = by_id.get(folder_id)
        while current is not None and current.id not in seen:
            seen.add(current.id)
            chain.append(current)
            current = by_id.get(current.parent_id) if current.parent_id is not None else None
        chain.reverse()
        path = " / ".join(folder.name for folder in chain)
        root = chain[0] if chain else by_id[folder_id]
        paths[folder_id] = path
        roots[folder_id] = (root.id, root.name)
        return path, root.id, root.name

    for folder_id in by_id:
        resolve(folder_id)

    descendants: dict[int, set[int]] = {}
    for folder in folders:
        result: set[int] = set()
        stack = [folder.id]
        while stack:
            current_id = stack.pop()
            if current_id in result:
                continue
            result.add(current_id)
            stack.extend(children.get(current_id, []))
        descendants[folder.id] = result

    return FolderContext(paths=paths, roots=roots, descendants=descendants)


def _popularity_subquery():
    cutoff = date.today() - timedelta(days=POPULARITY_DAYS - 1)
    return (
        select(
            ReportViewDailyStat.report_id.label("report_id"),
            func.sum(ReportViewDailyStat.view_count).label("view_count"),
        )
        .where(ReportViewDailyStat.viewed_date >= cutoff)
        .group_by(ReportViewDailyStat.report_id)
        .subquery()
    )


def _to_items(rows, folders: FolderContext) -> list[DiscoveryItem]:
    items: list[DiscoveryItem] = []
    for report, last_viewed_at, view_count in rows:
        root = folders.roots.get(report.folder_id) if report.folder_id is not None else None
        items.append(DiscoveryItem(
            report=report,
            folder_path=folders.paths.get(report.folder_id) if report.folder_id is not None else None,
            root_folder_id=root[0] if root else None,
            root_folder_name=root[1] if root else None,
            last_viewed_at=last_viewed_at,
            view_count=int(view_count or 0),
        ))
    return items


async def catalog(
    db: AsyncSession,
    *,
    user_id: int,
    accessible_ids: set[int],
    root_folder_id: int | None,
    folder_id: int | None,
    query: str | None,
    sort: str,
    limit: int,
    offset: int,
) -> tuple[list[DiscoveryItem], int]:
    if not accessible_ids:
        return [], 0

    folders = await load_folder_context(db)
    popularity = _popularity_subquery()
    conditions = [Report.id.in_(accessible_ids)]

    if root_folder_id is not None:
        root_folder_ids = folders.descendants.get(root_folder_id)
        if not root_folder_ids:
            return [], 0
        conditions.append(Report.folder_id.in_(root_folder_ids))

    if folder_id is not None:
        scoped_folder_ids = folders.descendants.get(folder_id)
        if not scoped_folder_ids:
            return [], 0
        conditions.append(Report.folder_id.in_(scoped_folder_ids))

    normalized_query = (query or "").strip()
    if normalized_query:
        pattern = f"%{normalized_query}%"
        search_conditions = [
            Report.display_name.ilike(pattern),
            Report.report_name.ilike(pattern),
            Report.description.ilike(pattern),
            Report.author_label.ilike(pattern),
            Report.category.ilike(pattern),
        ]
        conditions.append(or_(*search_conditions))

    stmt = (
        select(
            Report,
            UserReportActivity.last_viewed_at,
            func.coalesce(popularity.c.view_count, 0).label("view_count"),
        )
        .outerjoin(
            UserReportActivity,
            and_(
                UserReportActivity.report_id == Report.id,
                UserReportActivity.user_id == user_id,
            ),
        )
        .outerjoin(popularity, popularity.c.report_id == Report.id)
        .where(*conditions)
    )
    total = int(await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)

    latest_order = func.coalesce(Report.published_at, Report.created_at, Report.updated_at).desc()
    if sort == "popular":
        stmt = stmt.order_by(
            func.coalesce(popularity.c.view_count, 0).desc(),
            latest_order,
            Report.id.desc(),
        )
    else:
        stmt = stmt.order_by(latest_order, Report.id.desc())

    rows = (await db.execute(stmt.offset(offset).limit(limit))).all()
    return _to_items(rows, folders), total


async def recent(
    db: AsyncSession,
    *,
    user_id: int,
    accessible_ids: set[int],
    limit: int | None,
) -> list[DiscoveryItem]:
    if not accessible_ids:
        return []
    folders = await load_folder_context(db)
    popularity = _popularity_subquery()
    stmt = (
        select(
            Report,
            UserReportActivity.last_viewed_at,
            func.coalesce(popularity.c.view_count, 0).label("view_count"),
        )
        .join(
            UserReportActivity,
            and_(
                UserReportActivity.report_id == Report.id,
                UserReportActivity.user_id == user_id,
            ),
        )
        .outerjoin(popularity, popularity.c.report_id == Report.id)
        .where(Report.id.in_(accessible_ids))
        .order_by(UserReportActivity.last_viewed_at.desc(), Report.id.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return _to_items((await db.execute(stmt)).all(), folders)


async def favorites(
    db: AsyncSession,
    *,
    user_id: int,
    accessible_ids: set[int],
    limit: int | None,
) -> list[DiscoveryItem]:
    if not accessible_ids:
        return []
    folders = await load_folder_context(db)
    popularity = _popularity_subquery()
    stmt = (
        select(
            Report,
            UserReportActivity.last_viewed_at,
            func.coalesce(popularity.c.view_count, 0).label("view_count"),
        )
        .join(
            ReportFavorite,
            and_(
                ReportFavorite.report_id == Report.id,
                ReportFavorite.user_id == user_id,
            ),
        )
        .outerjoin(
            UserReportActivity,
            and_(
                UserReportActivity.report_id == Report.id,
                UserReportActivity.user_id == user_id,
            ),
        )
        .outerjoin(popularity, popularity.c.report_id == Report.id)
        .where(Report.id.in_(accessible_ids))
        .order_by(
            UserReportActivity.last_viewed_at.desc().nullslast(),
            ReportFavorite.created_at.desc(),
            Report.id.desc(),
        )
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return _to_items((await db.execute(stmt)).all(), folders)
