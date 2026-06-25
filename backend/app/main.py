from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.core.errors import BIPError, bip_error_handler, unhandled_error_handler
from app.api.routes import auth as auth_routes
from app.api.routes import users as users_routes
from app.api.routes import groups as groups_routes
from app.api.routes import roles as roles_routes
from app.api.routes import folders as folders_routes
from app.api.routes import reports as reports_routes
from app.api.routes import datasets as datasets_routes
from app.api.routes import exports as exports_routes
from app.api.routes import monitoring as monitoring_routes
from app.api.routes import refresh as refresh_routes
from app.api.routes import mail_schedules as mail_schedules_routes
from app.api.routes import mail_jobs as mail_jobs_routes
from app.api.routes import audit_logs as audit_logs_routes
from app.api.routes import stats as stats_routes
from app.api.routes import holidays as holidays_routes
from app.api.routes import report_images as report_images_routes


logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger.info("bip_startup", app_mode=settings.APP_MODE, auth_mode=settings.AUTH_MODE)
    yield
    logger.info("bip_shutdown")


app = FastAPI(title="BIP - The New BI Portal", lifespan=lifespan)

app.add_exception_handler(BIPError, bip_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

# CORS — 쿠키 세션(credentials) 동작을 위해 명시 origin + allow_credentials.
# 배포(nginx /api 프록시, 동일 출처)에서는 cross-origin 미발생.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(users_routes.router)
app.include_router(groups_routes.router)
app.include_router(roles_routes.router)
app.include_router(folders_routes.router)
app.include_router(reports_routes.router)
app.include_router(datasets_routes.router)
app.include_router(exports_routes.router)
app.include_router(monitoring_routes.router)
app.include_router(refresh_routes.router)
app.include_router(mail_schedules_routes.router)
app.include_router(mail_jobs_routes.router)
app.include_router(audit_logs_routes.router)
app.include_router(stats_routes.router)
app.include_router(holidays_routes.router)
app.include_router(report_images_routes.router)
