"""조직 표시 정보 해석 — 부서 코드 대신 부서명·계열사·본부를 제공한다.

`bip.departments.name`은 인사 부서명을 확보하기 전에 생성된 행이 코드로 남아 있다
(예: `D200836262`). 해당 사용자가 다시 로그인할 때만 한글명으로 backfill되므로,
통계 화면은 이 서비스로 인사 조직 뷰(읽기 전용)를 참조해 표시용 이름과 상위 조직을
채운다.

계층은 인사 뷰의 `up_dept_id` 체인을 따라 올라간다.
    디지털기획팀 → 디지털담당 → 경영지원본부 → 대표이사 → 회장단 → (주)삼천리
- company: 최상위(depth 1) 계열사명
- division: 상위 조직 중 '본부'가 포함된 조직, 없으면 바로 위 조직
- org_path: 계열사 아래부터 팀 직전까지의 전체 경로(툴팁 표시용)

인사 뷰가 없는 환경(mock/개발 DB)이나 조회 실패 시에는 저장된 값으로 조용히 후퇴해
통계 조회 자체는 계속 동작한다.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.auth import Department

logger = get_logger(__name__)

HR_DEPT_VIEW = "public.scl_v_insa_dept_add_depth"
ORG_PATH_SEPARATOR = " · "
DIVISION_KEYWORD = "본부"
UNASSIGNED_LABEL = "(부서 없음)"


@dataclass(frozen=True)
class DepartmentOrg:
    """부서 1건의 표시용 이름과 상위 조직."""
    department_id: int
    code: str
    name: str
    company: str | None
    division: str | None
    org_path: str | None


async def _load_hr_tree(db: AsyncSession) -> dict[str, dict]:
    """인사 조직 뷰 → {dept_id: {name, parent, company}}. 실패 시 빈 dict."""
    try:
        # 뷰가 없는 환경에서 상위 트랜잭션이 오염되지 않도록 SAVEPOINT로 격리한다.
        async with db.begin_nested():
            rows = (await db.execute(text(
                f"SELECT dept_id, dept_name, up_dept_id, cmp_id FROM {HR_DEPT_VIEW} "
                "WHERE dept_status = 'U'"
            ))).mappings().all()
    except Exception:  # noqa: BLE001 - 조직 뷰 부재가 통계 조회를 막지 않도록
        logger.warning("hr_dept_view_unavailable", view=HR_DEPT_VIEW)
        return {}
    return {
        row["dept_id"]: {
            "name": row["dept_name"],
            "parent": row["up_dept_id"],
            "company": row["cmp_id"],
        }
        for row in rows
    }


def _org_labels(code: str, tree: dict[str, dict]) -> tuple[str | None, str | None, str | None]:
    """(계열사, 본부/상위조직, 상위 경로) 계산. 순환 참조에도 멈춘다."""
    node = tree.get(code)
    if node is None:
        return None, None, None
    company_code = node.get("company")
    company_node = tree.get(company_code) if company_code else None
    company = company_node.get("name") if company_node else None

    ancestors: list[str] = []  # 가까운 상위 → 먼 상위
    seen = {code}
    cursor = node.get("parent")
    while cursor and cursor != "ROOT" and cursor not in seen and cursor != company_code:
        seen.add(cursor)
        parent = tree.get(cursor)
        if parent is None:
            break
        if parent.get("name"):
            ancestors.append(parent["name"])
        cursor = parent.get("parent")

    division = next(
        (name for name in ancestors if DIVISION_KEYWORD in name),
        ancestors[0] if ancestors else None,
    )
    org_path = ORG_PATH_SEPARATOR.join(reversed(ancestors)) or None
    return company, division, org_path


async def department_org_map(db: AsyncSession) -> dict[int, DepartmentOrg]:
    """등록 부서 전체의 표시용 이름·계열사·본부 맵({departments.id: DepartmentOrg}).

    관리자가 직접 바꾼 이름(코드와 다른 값)은 유지하고, 코드로만 남은 이름만 인사
    부서명으로 대체한다.
    """
    departments = (await db.execute(select(Department))).scalars().all()
    tree = await _load_hr_tree(db)
    result: dict[int, DepartmentOrg] = {}
    for dept in departments:
        node = tree.get(dept.external_id)
        stored_name = dept.name if dept.name and dept.name != dept.external_id else None
        hr_name = node.get("name") if node else None
        company, division, org_path = _org_labels(dept.external_id, tree)
        result[dept.id] = DepartmentOrg(
            department_id=dept.id,
            code=dept.external_id,
            name=stored_name or hr_name or dept.external_id,
            company=company,
            division=division,
            org_path=org_path,
        )
    return result
