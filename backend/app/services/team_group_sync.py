"""조직도 기반 팀 권한 그룹 자동 생성/완전 동기화.

- 선택한 dept_id 하위(재귀)에서 '직속 구성원(bass_dept_yn=Y, 재직 W)이 있는 팀'마다
  자동 관리 그룹(user_groups.source_dept_id = 팀 dept_id)을 만들고, 그룹 멤버를 팀의
  현재 로스터와 **완전 동기화**(추가 + 제거)한다. 자동 관리 그룹만 대상(수동 그룹 불변).
- 그룹명은 팀명. 다른 그룹명과 충돌하면 점진적으로 '상위조직 · 팀명' →
  '회사명 · 상위조직 · 팀명' → '팀명 (dept_id)' 순으로 구분한다. 식별은 source_dept_id.
- 인사 뷰(public.scl_v_insa_*)는 읽기 전용 조회.
"""
from __future__ import annotations

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User
from app.models.portal import UserGroup, UserGroupMember
from app.services import user_admin

_SEP = " · "


async def _load_companies(db: AsyncSession) -> dict[str, str]:
    """{cmp_id: 회사명(depth=1 부서명)}."""
    rows = (await db.execute(text(
        "SELECT cmp_id, dept_name FROM public.scl_v_insa_dept_add_depth "
        "WHERE dept_depth = 1 AND dept_status = 'U'"
    ))).mappings().all()
    return {r["cmp_id"]: r["dept_name"] for r in rows}


async def _load_dept_map(db: AsyncSession) -> dict[str, dict]:
    """{dept_id: {name, up, cmp}} — 사용중 부서 전체(상위/회사명 계산용)."""
    rows = (await db.execute(text(
        "SELECT dept_id, dept_name, up_dept_id, cmp_id "
        "FROM public.scl_v_insa_dept_add_depth WHERE dept_status = 'U'"
    ))).mappings().all()
    return {
        r["dept_id"]: {"name": r["dept_name"], "up": r["up_dept_id"], "cmp": r["cmp_id"]}
        for r in rows
    }


async def _load_subtree_members(db: AsyncSession, dept_id: str) -> tuple[dict[str, set[str]], dict[str, str]]:
    """dept_id 하위 팀별 직속 구성원. ({dept_id: {emp_no}}, {emp_no: name})."""
    sql = (
        "WITH RECURSIVE subtree AS ("
        "  SELECT dept_id FROM public.scl_v_insa_dept_add_depth "
        "  WHERE dept_id = :dept AND dept_status='U' "
        "  UNION ALL "
        "  SELECT d.dept_id FROM public.scl_v_insa_dept_add_depth d "
        "  JOIN subtree s ON d.up_dept_id = s.dept_id WHERE d.dept_status='U'"
        ") "
        "SELECT j.dept_id, u.emp_no, u.user_name "
        "FROM public.scl_v_insa_my_job j "
        "JOIN subtree st ON st.dept_id = j.dept_id "
        "JOIN public.scl_v_insa_user u ON u.emp_no = j.emp_no AND u.emp_status='W' "
        "WHERE j.bass_dept_yn = 'Y'"
    )
    rows = (await db.execute(text(sql), {"dept": dept_id})).mappings().all()
    members: dict[str, set[str]] = {}
    names: dict[str, str] = {}
    for r in rows:
        members.setdefault(r["dept_id"], set()).add(r["emp_no"])
        names[r["emp_no"]] = r["user_name"]
    return members, names


def _name_candidates(dept_id: str, dept_map: dict[str, dict], companies: dict[str, str]) -> list[str]:
    """이름 후보(점진적 구분). 순서대로 사용 가능."""
    d = dept_map.get(dept_id, {"name": dept_id, "up": None, "cmp": None})
    name = d["name"] or dept_id
    parent = dept_map.get(d["up"]) if d["up"] else None
    parent_name = parent["name"] if parent else None
    company_name = companies.get(d["cmp"])
    cands = [name]
    if parent_name and parent_name != company_name:
        cands.append(f"{parent_name}{_SEP}{name}")
        if company_name:
            cands.append(f"{company_name}{_SEP}{parent_name}{_SEP}{name}")
    elif company_name:
        cands.append(f"{company_name}{_SEP}{name}")
    cands.append(f"{name} ({dept_id})")  # 최후 fallback
    return list(dict.fromkeys(cands))  # 순서 유지 dedup


async def sync_team_groups(db: AsyncSession, dept_id: str, *, apply: bool) -> dict:
    """팀 그룹 동기화 계획 생성(apply=False) 또는 적용(apply=True). commit은 apply 시 호출측 책임."""
    companies = await _load_companies(db)
    dept_map = await _load_dept_map(db)
    members_by_dept, member_names = await _load_subtree_members(db, dept_id)

    # 기존 그룹 로드
    groups = (await db.execute(select(UserGroup))).scalars().all()
    by_source = {g.source_dept_id: g for g in groups if g.source_dept_id}
    taken_names = {g.name for g in groups}

    # 자동 그룹들의 현재 멤버(emp_no → user_id)
    own_group_ids = [by_source[d].id for d in members_by_dept if d in by_source]
    current_members: dict[int, dict[str, int]] = {gid: {} for gid in own_group_ids}
    if own_group_ids:
        for gid, emp_no, uid in (await db.execute(
            select(UserGroupMember.group_id, User.external_id, User.id)
            .join(User, User.id == UserGroupMember.user_id)
            .where(UserGroupMember.group_id.in_(own_group_ids))
        )).all():
            current_members.setdefault(gid, {})[emp_no] = uid

    # 대상 emp_no 중 미등록자 수(미리보기용)
    all_emp_nos = {e for s in members_by_dept.values() for e in s}
    registered_emp = set()
    if all_emp_nos:
        registered_emp = set((await db.execute(
            select(User.external_id).where(User.external_id.in_(all_emp_nos))
        )).scalars().all())

    teams: list[dict] = []
    groups_to_create = 0
    members_to_add = 0
    members_to_remove = 0

    # 팀명 기준 안정 정렬
    ordered = sorted(members_by_dept.keys(), key=lambda d: (dept_map.get(d, {}).get("name") or d))
    for tdept in ordered:
        desired_emp = members_by_dept[tdept]
        own = by_source.get(tdept)

        # 이름 결정(자기 그룹 현재 이름은 재사용 가능)
        available = taken_names - ({own.name} if own else set())
        chosen = next((c for c in _name_candidates(tdept, dept_map, companies) if c not in available), None)
        if chosen is None:
            chosen = f"{dept_map.get(tdept, {}).get('name') or tdept} ({tdept})"
        taken_names = available | {chosen}

        cur = current_members.get(own.id, {}) if own else {}
        cur_emp = set(cur.keys())
        add_emp = sorted(desired_emp - cur_emp)
        remove_emp = sorted(cur_emp - desired_emp)
        keep = len(desired_emp & cur_emp)

        dept_name = dept_map.get(tdept, {}).get("name") or tdept
        item = {
            "dept_id": tdept,
            "dept_name": dept_name,
            "group_name": chosen,
            "group_id": own.id if own else None,
            "created": own is None,
            "renamed_from": own.name if (own and own.name != chosen) else None,
            "add": [{"emp_no": e, "name": member_names.get(e, e)} for e in add_emp],
            "remove": [{"emp_no": e, "name": member_names.get(e, e)} for e in remove_emp],
            "keep": keep,
        }
        teams.append(item)
        if own is None:
            groups_to_create += 1
        members_to_add += len(add_emp)
        members_to_remove += len(remove_emp)

        if apply:
            group = own
            if group is None:
                group = UserGroup(
                    name=chosen,
                    description=f"조직도 자동 생성 · {dept_name}",
                    source_dept_id=tdept,
                )
                db.add(group)
                await db.flush()
                item["group_id"] = group.id
            elif group.name != chosen:
                group.name = chosen
            # 추가(등록 필요 시 자동 등록)
            for emp_no in add_emp:
                user = await user_admin.get_or_register(db, emp_no)
                if user is None:
                    continue
                db.add(UserGroupMember(group_id=group.id, user_id=user.id))
            # 제거(로스터에서 빠진 인원)
            remove_uids = [cur[e] for e in remove_emp if e in cur]
            if remove_uids:
                await db.execute(delete(UserGroupMember).where(
                    UserGroupMember.group_id == group.id,
                    UserGroupMember.user_id.in_(remove_uids),
                ))
            await db.flush()

    return {
        "dept_id": dept_id,
        "applied": apply,
        "teams": teams,
        "groups_total": len(teams),
        "groups_to_create": groups_to_create,
        "members_to_add": members_to_add,
        "members_to_remove": members_to_remove,
        "to_register": len(all_emp_nos - registered_emp),
    }
