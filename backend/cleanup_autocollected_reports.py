"""자동 수집된 레포트 카탈로그 정리 (일회성 유틸).

과거 수집기(collect_workspace)가 워크스페이스의 모든 레포트를 카탈로그(bip.reports)에
자동 등록하던 동작 때문에, 업로드하지 않았는데 '레포트 관리 > (미분류)'에 나타난
레포트들을 제거한다.

판별: `created_by_user_id IS NULL` = 수집기가 넣은 자동 등록분.
      (PBIX 업로드로 등록한 레포트는 created_by_user_id가 채워지므로 보존된다.)

안전장치:
  - 메일 스케줄이 참조하는 레포트는 삭제하지 않고 건너뛴다(FK 제약).
  - 권한/즐겨찾기/Export 기록은 DB CASCADE로 함께 삭제된다.
  - 기본은 미리보기(dry-run). 실제 삭제는 --apply 옵션 필요.

사용:
    # 1) 무엇이 지워질지 미리보기 (삭제 안 함)
    backend> .venv\\Scripts\\python.exe cleanup_autocollected_reports.py

    # 2) 실제 삭제
    backend> .venv\\Scripts\\python.exe cleanup_autocollected_reports.py --apply

주의: 실행 전에 worker/beat를 최신 코드로 재시작해야 한다. 그렇지 않으면
      옛 수집기가 삭제 직후 레포트를 다시 등록할 수 있다.
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
from app.models.mail import MailSchedule
from app.models.report import Report


async def run(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        reports = (
            await db.execute(
                select(Report)
                .where(Report.created_by_user_id.is_(None))
                .order_by(Report.id)
            )
        ).scalars().all()

        if not reports:
            print("자동 수집된 레포트(created_by_user_id IS NULL)가 없습니다. 정리할 대상 없음.")
            return

        print(f"대상(자동 수집분): {len(reports)}건")
        deleted = 0
        skipped = 0
        for r in reports:
            sched = await db.scalar(
                select(func.count())
                .select_from(MailSchedule)
                .where(MailSchedule.report_id == r.id)
            )
            tag = (
                f"[id={r.id}] {r.report_name or r.report_id} "
                f"(published={r.is_published}, folder_id={r.folder_id})"
            )
            if sched and sched > 0:
                print(f"  SKIP(메일 스케줄 {sched}건이 사용 중): {tag}")
                skipped += 1
                continue
            if apply:
                await db.delete(r)
                deleted += 1
                print(f"  DELETE: {tag}")
            else:
                print(f"  (삭제 예정): {tag}")

        if apply:
            await db.commit()
            print(f"\n완료: 삭제 {deleted}건, 스킵 {skipped}건")
        else:
            print(f"\n미리보기: 삭제 예정 {len(reports) - skipped}건, 스킵 {skipped}건")
            print("실제로 삭제하려면 --apply 옵션을 붙여 다시 실행하세요.")


if __name__ == "__main__":
    asyncio.run(run(apply="--apply" in sys.argv))
