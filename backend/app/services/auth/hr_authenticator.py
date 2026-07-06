"""HR_Authenticator — 인사정보 뷰 기반 사번/비밀번호 인증 (읽기 전용).

design.md "인증(인사정보 DB)" 참조. 인사 뷰(public.scl_v_insa_*)를 읽기 전용으로
조회하여 SHA-256 3회 해시로 비밀번호를 검증한다. INSERT/UPDATE/DELETE 금지(R33.3).
AUTH_MODE=mock이면 인사 DB 없이 더미 사용자로 인증한다.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.auth.password_hash import verify_password

@dataclass
class HRProfile:
    """인사 뷰에서 가져온 인증 성공 사용자 프로필."""
    emp_no: str
    user_name: str
    cmp_email: str | None
    cmp_id: str | None
    dept_id: str | None
    ofc_id: str | None
    dept_name: str | None = None

class AuthenticationError(Exception):
    """사번 없음 또는 비밀번호 불일치."""

async def authenticate(db: AsyncSession, emp_no: str, password: str) -> HRProfile:
    """사번+비밀번호로 인증하고 프로필을 반환. 실패 시 AuthenticationError.

    mock 모드: 비밀번호 'mock' 이면 더미 프로필 반환(인사 DB 미접근).
    hr-db 모드: scl_v_insa_user_add_pwd에서 login_pwd 조회 후 해시 비교.
    """
    if settings.AUTH_MODE == "mock":
        if password != "mock":
            raise AuthenticationError("mock 모드: 비밀번호는 'mock' 입니다.")
        return HRProfile(
            emp_no=emp_no,
            user_name=f"테스트사용자_{emp_no}",
            cmp_email=f"{emp_no}@example.com",
            cmp_id="MOCK",
            dept_id="D001",
            ofc_id="O001",
            dept_name="테스트부서",
        )

    # hr-db 모드: 인사 뷰 읽기 전용 조회
    row = (
        await db.execute(
            text(
                "SELECT emp_no, login_pwd, cmp_email, user_name, cmp_id "
                "FROM public.scl_v_insa_user_add_pwd WHERE emp_no = :emp_no"
            ),
            {"emp_no": emp_no},
        )
    ).first()

    if row is None or not verify_password(password, row.login_pwd):
        raise AuthenticationError("사번 또는 비밀번호가 올바르지 않습니다.")

    # 재직(emp_status='W') 직원만 로그인 허용 (R: 사내 임직원 전용 포털)
    active = (
        await db.execute(
            text(
                "SELECT 1 FROM public.scl_v_insa_user "
                "WHERE emp_no = :emp_no AND emp_status = 'W' LIMIT 1"
            ),
            {"emp_no": emp_no},
        )
    ).first()
    if active is None:
        raise AuthenticationError("재직 중인 임직원만 로그인할 수 있습니다.")

    # 조직/직급 조회 (기본 부서: bass_dept_yn='Y' 우선, 없으면 emp_sort_ordr 최상위)
    job = (
        await db.execute(
            text(
                "SELECT cmp_id, dept_id, ofc_id FROM public.scl_v_insa_my_job "
                "WHERE emp_no = :emp_no "
                "ORDER BY (bass_dept_yn = 'Y') DESC, emp_sort_ordr ASC LIMIT 1"
            ),
            {"emp_no": emp_no},
        )
    ).first()

    # 부서 한글명 조회 (scl_v_insa_dept_add_depth). 실패해도 로그인은 계속되도록 방어.
    # 주의 1: asyncpg는 `(:cmp_id IS NULL OR cmp_id = :cmp_id)` 형태에서 파라미터 타입을
    #   추론하지 못해 AmbiguousParameterError를 낸다 → cmp_id 유무에 따라 조건을 구성한다.
    # 주의 2: 조회 실패가 상위 트랜잭션을 오염(InFailedSQLTransactionError)시키지 않도록
    #   SAVEPOINT(begin_nested)로 격리한다. 실패 시 savepoint만 롤백되고 로그인은 계속된다.
    dept_name: str | None = None
    if job and job.dept_id:
        sql = "SELECT dept_name FROM public.scl_v_insa_dept_add_depth WHERE dept_id = :dept_id"
        params: dict = {"dept_id": job.dept_id}
        if job.cmp_id:
            sql += " AND cmp_id = :cmp_id"
            params["cmp_id"] = job.cmp_id
        sql += " LIMIT 1"
        try:
            async with db.begin_nested():
                dept_row = (await db.execute(text(sql), params)).first()
                if dept_row is not None:
                    dept_name = dept_row.dept_name
        except Exception:  # noqa: BLE001 - 부서명 조회 실패가 로그인을 막지 않도록
            dept_name = None

    return HRProfile(
        emp_no=row.emp_no,
        user_name=row.user_name,
        cmp_email=row.cmp_email,
        cmp_id=job.cmp_id if job else None,
        dept_id=job.dept_id if job else None,
        ofc_id=job.ofc_id if job else None,
        dept_name=dept_name,
    )
