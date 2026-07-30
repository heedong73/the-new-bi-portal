from enum import StrEnum


class RoleCode(StrEnum):
    GENERAL_USER = "General_User"
    SYSTEM_OPERATOR = "System_Operator"
    # 전역 통계만 읽는 담당임원 역할. 관리자 메뉴·변경 권한은 부여하지 않는다.
    EXECUTIVE_STATS_READER = "Executive_Stats_Reader"


class MenuKey(StrEnum):
    """메뉴(페이지) 권한 키 — 역할 → 메뉴 고정 매핑(ROLE_MENUS)에서 사용."""
    HOME = "home"                          # 홈(레포트 조회)
    STATS = "stats"                        # 통계
    DISPLAY_BOARDS = "display_boards"      # KPI 전광판 재생(부여 대상)
    MAIL_SCHEDULES = "mail_schedules"      # 메일 스케줄
    MAIL_JOBS = "mail_jobs"                # 메일 이력
    MONITORING_REFRESH = "monitoring_refresh"  # Refresh 현황
    MONITORING_OPS = "monitoring_ops"      # 운영 상태
    ADMIN_REPORTS = "admin_reports"        # 관리자-레포트 관리
    ADMIN_DISPLAY_BOARDS = "admin_display_boards"  # 관리자-KPI 전광판 구성
    ADMIN_USERS = "admin_users"            # 관리자-사용자
    ADMIN_GROUPS = "admin_groups"          # 관리자-그룹
    ADMIN_HOLIDAYS = "admin_holidays"      # 관리자-공휴일
    AUDIT_LOGS = "audit_logs"              # 관리자-감사 로그(시스템 사용자 활동 이력)


# 메뉴 카탈로그 (키 → 표시명). 프론트 노출 순서.
MENU_CATALOG: list[tuple[str, str]] = [
    (MenuKey.HOME, "홈 (레포트 조회)"),
    (MenuKey.STATS, "통계"),
    (MenuKey.DISPLAY_BOARDS, "KPI 전광판"),
    (MenuKey.MAIL_SCHEDULES, "메일 스케줄"),
    (MenuKey.MAIL_JOBS, "메일 이력"),
    (MenuKey.MONITORING_REFRESH, "Refresh 현황"),
    (MenuKey.MONITORING_OPS, "운영 상태"),
    (MenuKey.ADMIN_REPORTS, "관리자 · 레포트 관리"),
    (MenuKey.ADMIN_DISPLAY_BOARDS, "관리자 · KPI 전광판"),
    (MenuKey.ADMIN_USERS, "관리자 · 사용자"),
    (MenuKey.ADMIN_GROUPS, "관리자 · 그룹"),
    (MenuKey.ADMIN_HOLIDAYS, "관리자 · 공휴일"),
    (MenuKey.AUDIT_LOGS, "관리자 · 감사 로그"),
]

ALL_MENU_KEYS: list[str] = [k for k, _ in MENU_CATALOG]

# 일반 사용자(그룹/개인)에게 "직접 부여"할 수 있는 메뉴 키.
# 나머지 메뉴(관리자 계열, 운영 상태, Refresh 현황, 메일 이력/스케줄)는 정책상
# System_Operator 전용이므로 부여 대상이 아니다 — 부여해도 무효가 되도록
# menu_permissions 읽기/쓰기 양쪽에서 이 목록으로 필터한다.
#
# KPI 전광판(display_boards)은 재생 화면 기준이다. 로비/현장 모니터 등 특정 대상만
# 쓰는 기능이라 기본 비노출이고, 필요한 그룹/사용자에게만 부여한다. 전광판 "구성"은
# admin_display_boards(System_Operator 전용)로 별도 통제한다.
GRANTABLE_MENU_KEYS: list[str] = [MenuKey.STATS, MenuKey.DISPLAY_BOARDS]

# 부여 가능한 메뉴만 담은 카탈로그 (권한 관리 화면 노출용).
GRANTABLE_MENU_CATALOG: list[tuple[str, str]] = [
    (k, label) for k, label in MENU_CATALOG if k in GRANTABLE_MENU_KEYS
]

# 역할 → 메뉴 접근 권한 (코드 고정 매핑, 편집 불가). System_Operator는 항상 전체.
# 서비스 센터는 메뉴 권한 대상이 아니라 로그인한 모든 사용자에게 노출된다.
# 통계·KPI 전광판 등 General_User 기본값 밖의 메뉴는 관리자가 menu_permissions로
# 그룹/사용자 단위 추가 부여한다(권한 관리 개편 — 확인사항 2).
ROLE_MENUS: dict[str, list[str]] = {
    RoleCode.GENERAL_USER: [MenuKey.HOME],
    RoleCode.SYSTEM_OPERATOR: list(ALL_MENU_KEYS),
    RoleCode.EXECUTIVE_STATS_READER: [MenuKey.HOME, MenuKey.STATS],
}


class PermissionAction(StrEnum):
    VIEW = "VIEW"
    DOWNLOAD = "DOWNLOAD"            # 내보내기(PDF/PPTX/PNG 렌더링 파일)
    DOWNLOAD_PBIX = "DOWNLOAD_PBIX"  # 원본 .pbix 다운로드 (데이터 모델 포함 — 별도 통제)
    REFRESH = "REFRESH"
    MANAGE_REPORT = "MANAGE_REPORT"              # PBIX 교체(콘텐츠 덮어쓰기)
    MANAGE_DEFAULT_VIEW = "MANAGE_DEFAULT_VIEW"  # 공통 기본 뷰 저장/초기화
    VIEW_STATS = "VIEW_STATS"  # 레포트별 통계 조회 권한 (레포트 작성자 자동 부여, 관리자 부여/회수)


# 부여 시 조회(VIEW)를 함께 필요로 하는 액션 — 조회 없이 다운로드/새로고침/관리만
# 가진 모순 상태를 막기 위해 권한 부여 시 VIEW를 자동 포함한다.
ACTIONS_IMPLYING_VIEW: set[str] = {
    PermissionAction.DOWNLOAD,
    PermissionAction.DOWNLOAD_PBIX,
    PermissionAction.REFRESH,
    PermissionAction.MANAGE_REPORT,
    PermissionAction.MANAGE_DEFAULT_VIEW,
}


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
    EXPORT_DOWNLOAD = "export_download"  # 파일 open 성공 후 기록한 다운로드 요청
    MAIL_SEND = "mail_send"
    MAIL_SCHEDULE_CREATE = "mail_schedule_create"
    MAIL_SCHEDULE_UPDATE = "mail_schedule_update"
    MAIL_SCHEDULE_DELETE = "mail_schedule_delete"
    PERMISSION_CHANGE = "permission_change"
    GROUP_CHANGE = "group_change"
    REFRESH_TRIGGER = "refresh_trigger"
    REFRESH_CANCEL = "refresh_cancel"
    COLLECT_NOW = "collect_now"
    ADMIN_SETTING_CHANGE = "admin_setting_change"
    POWERBI_API_FAILURE = "powerbi_api_failure"
    PERMISSION_DENIED = "permission_denied"
    REQUEST_CREATE = "request_create"
    REQUEST_UPDATE = "request_update"
    REQUEST_COMMENT = "request_comment"
    STATS_VIEW = "stats_view"


class RecipientType(StrEnum):
    USER = "USER"
    GROUP = "GROUP"
    DEPARTMENT = "DEPARTMENT"
    EMAIL = "EMAIL"


class RequestType(StrEnum):
    """서비스 센터 요청 유형 (R17).

    DISPLAY_BOARD는 KPI 전광판 구성 요청이다. 전광판은 사용자가 직접 만들 수 없고
    System_Operator가 관리자 콘솔에서 구성하므로, 요청 창구를 유형으로 분리해
    "어떤 레포트를 어떤 순서/시간으로 띄워달라"는 요청을 받는다.
    """
    INQUIRY = "inquiry"       # 문의
    ERROR = "error"           # 에러
    IMPROVEMENT = "improvement"  # 개선요청
    DISPLAY_BOARD = "display_board"  # KPI 전광판 구성 요청


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
