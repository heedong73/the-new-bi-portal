from enum import StrEnum


class RoleCode(StrEnum):
    GENERAL_USER = "General_User"
    SUPER_USER = "Super_User"
    SYSTEM_OPERATOR = "System_Operator"


class PermissionAction(StrEnum):
    VIEW = "VIEW"
    DOWNLOAD = "DOWNLOAD"
    REFRESH = "REFRESH"
    MANAGE_REPORT = "MANAGE_REPORT"


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
    ADMIN_SETTING_CHANGE = "admin_setting_change"
    POWERBI_API_FAILURE = "powerbi_api_failure"
    PERMISSION_DENIED = "permission_denied"


class RecipientType(StrEnum):
    USER = "USER"
    GROUP = "GROUP"
    DEPARTMENT = "DEPARTMENT"
    EMAIL = "EMAIL"


class ImageVariant(StrEnum):
    ORIGINAL = "original"
    RESIZED = "resized"
