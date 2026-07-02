from enum import StrEnum


class RoleCode(StrEnum):
    GENERAL_USER = "General_User"
    SUPER_USER = "Super_User"
    SYSTEM_OPERATOR = "System_Operator"


class MenuKey(StrEnum):
    """메뉴(페이지) 권한 키 — 역할 → 메뉴 고정 매핑(ROLE_MENUS)에서 사용."""
    HOME = "home"                          # 홈(레포트 조회)
    STATS = "stats"                        # 통계
    MAIL_SCHEDULES = "mail_schedules"      # 메일 스케줄
    MAIL_JOBS = "mail_jobs"                # 메일 이력
    MONITORING_REFRESH = "monitoring_refresh"  # Refresh 현황
    MONITORING_OPS = "monitoring_ops"      # 운영 상태
    ADMIN_REPORTS = "admin_reports"        # 관리자-레포트 관리
    ADMIN_USERS = "admin_users"            # 관리자-사용자
    ADMIN_GROUPS = "admin_groups"          # 관리자-그룹
    ADMIN_HOLIDAYS = "admin_holidays"      # 관리자-공휴일


# 메뉴 카탈로그 (키 → 표시명). 프론트 노출 순서.
MENU_CATALOG: list[tuple[str, str]] = [
    (MenuKey.HOME, "홈 (레포트 조회)"),
    (MenuKey.STATS, "통계"),
    (MenuKey.MAIL_SCHEDULES, "메일 스케줄"),
    (MenuKey.MAIL_JOBS, "메일 이력"),
    (MenuKey.MONITORING_REFRESH, "Refresh 현황"),
    (MenuKey.MONITORING_OPS, "운영 상태"),
    (MenuKey.ADMIN_REPORTS, "관리자 · 레포트 관리"),
    (MenuKey.ADMIN_USERS, "관리자 · 사용자"),
    (MenuKey.ADMIN_GROUPS, "관리자 · 그룹"),
    (MenuKey.ADMIN_HOLIDAYS, "관리자 · 공휴일"),
]

ALL_MENU_KEYS: list[str] = [k for k, _ in MENU_CATALOG]

# 역할 → 메뉴 접근 권한 (코드 고정 매핑, 편집 불가). System_Operator는 항상 전체.
# 서비스 센터는 메뉴 권한 대상이 아니라 로그인한 모든 사용자에게 노출된다.
ROLE_MENUS: dict[str, list[str]] = {
    RoleCode.GENERAL_USER: [MenuKey.HOME],
    RoleCode.SUPER_USER: [MenuKey.HOME, MenuKey.STATS],
    RoleCode.SYSTEM_OPERATOR: list(ALL_MENU_KEYS),
}


class PermissionAction(StrEnum):
    VIEW = "VIEW"
    DOWNLOAD = "DOWNLOAD"
    REFRESH = "REFRESH"
    MANAGE_REPORT = "MANAGE_REPORT"
    VIEW_STATS = "VIEW_STATS"  # 레포트별 통계 조회 권한 (Super_User, 관리자 부여)


class SubjectType(StrEnum):
    USER = "user"
    ROLE = "role"
    DEPT = "dept"
    GROUP = "group"


class RefreshStatus(StrEnum):
    SUCCESS = "Completed"
    FAILED = "Failed"
    IN_PROGRESS = "Unknown"
    CANCELLED = "Cancelled"


class ExportStatus(StrEnum):
    NOT_STARTED = "NotStarted"
    RUNNING = "Running"
    SUCCEEDED = "Succeeded"
    FAILED = "Failed"


class MailJobStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class AuditAction(StrEnum):
    LOGIN = "login"
    REPORT_VIEW = "report_view"
    REPORT_CREATE = "report_create"
    REPORT_UPDATE = "report_update"
    REPORT_DELETE = "report_delete"
    REPORT_VISIBILITY_CHANGE = "report_visibility_change"
    EXPORT_RUN = "export_run"
    MAIL_SEND = "mail_send"
    MAIL_SCHEDULE_CREATE = "mail_schedule_create"
    MAIL_SCHEDULE_UPDATE = "mail_schedule_update"
    MAIL_SCHEDULE_DELETE = "mail_schedule_delete"
    PERMISSION_CHANGE = "permission_change"
    GROUP_CHANGE = "group_change"
    REFRESH_TRIGGER = "refresh_trigger"
    COLLECT_NOW = "collect_now"
    ADMIN_SETTING_CHANGE = "admin_setting_change"
    POWERBI_API_FAILURE = "powerbi_api_failure"
    PERMISSION_DENIED = "permission_denied"
    REQUEST_CREATE = "request_create"
    REQUEST_UPDATE = "request_update"
    REQUEST_COMMENT = "request_comment"


class RecipientType(StrEnum):
    USER = "USER"
    GROUP = "GROUP"
    DEPARTMENT = "DEPARTMENT"
    EMAIL = "EMAIL"


class RequestType(StrEnum):
    """서비스 센터 요청 유형 (R17)."""
    INQUIRY = "inquiry"       # 문의
    ERROR = "error"           # 에러
    IMPROVEMENT = "improvement"  # 개선요청


class RequestStatus(StrEnum):
    """서비스 센터 요청 처리 상태 (R17)."""
    PENDING = "pending"     # 대기(초기)
    RECEIVED = "received"   # 접수
    REJECTED = "rejected"   # 반려
    DONE = "done"           # 완료


class RequestPriority(StrEnum):
    """서비스 센터 요청 우선순위 (R17 고도화)."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


# 우선순위별 SLA 목표 응답시간(시간). 단순 경과시간 기준(영업시간 미고려, v1).
REQUEST_SLA_HOURS: dict[str, int] = {
    RequestPriority.URGENT: 4,
    RequestPriority.HIGH: 8,
    RequestPriority.NORMAL: 24,
    RequestPriority.LOW: 72,
}

# SLA 종료(미산정) 상태 — 완료/반려는 지연 판정 대상이 아니다.
REQUEST_CLOSED_STATUSES: frozenset[str] = frozenset({
    RequestStatus.DONE, RequestStatus.REJECTED,
})


class ImageVariant(StrEnum):
    ORIGINAL = "original"
    RESIZED = "resized"
