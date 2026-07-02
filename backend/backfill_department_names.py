"""부서 한글명 일괄 백필 (일회성 유틸).

BIP `departments` 중 name이 코드(external_id)와 동일하게 저장된 부서를 대상으로,
인사 뷰 `public.scl_v_insa_dept_add_depth`에서 dept_name(한글명)을 조회해 갱신한다.
- 인사 뷰는 읽기 전용으로만 조회한다(R33.3).
- 관리자가 직접 바꾼 부서명(name != external_id)은 건드리지 않는다.

평상시에는 사용자가 재로그인할 때 user_mapper가 자동 백필하지만,
이미 등록된 사용자 부서를 재로그인 없이 즉시 정리하고 싶을 때 1회 실행한다.

실행:
    backend> .venv\\Scripts\\python.exe backfill_department_names.py
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from app.db.session import AsyncSessionLocal
from app.models.auth import Department


async def backfill() -> None:
    scanned = 0
    updated = 0
    async with AsyncSessionLocal() as db:
        depts = (
            await db.execute(
                select(Department).where(Department.name == Department.external_id)
            )
        ).scalars().all()
        scanned = len(depts)
        for dept in depts:
            if not dept.external_id:
                continue
            row = (
                await db.execute(
                    text(
                        "SELECT dept_name FROM public.scl_v_insa_dept_add_depth "
                        "WHERE dept_id = :dept_id LIMIT 1"
                    ),
                    {"dept_id": dept.external_id},
                )
            ).first()
            if row is not None and row.dept_name and row.dept_name != dept.external_id:
                print(f"  {dept.external_id} -> {row.dept_name}")
                dept.name = row.dept_name
                updated += 1
        await db.commit()
    print(f"완료: 스캔 {scanned}건, 갱신 {updated}건")


if __name__ == "__main__":
    asyncio.run(backfill())
