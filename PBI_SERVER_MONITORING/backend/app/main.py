"""FastAPI application entrypoint.

Responsibilities (Task 2.1):
- Create the FastAPI app with a lifespan handler.
- Configure structured logging.
- Register the request-id middleware (``X-Request-Id``).
- Configure CORS from ``CORS_ALLOWED_ORIGINS`` (default ``http://localhost:5173``).
- Provide the mount point for ``/api`` routers (added in stages 2.5 / 2.6 / 5.3).

Concrete routes (``/api/health`` etc.) are added in later tasks; this module
only prepares the wiring so those routers can be mounted without changes here
beyond a single ``include_router`` call.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import collect as collect_routes
from app.api.routes import datasets as datasets_routes
from app.api.routes import health as health_routes
from app.api.routes import refresh as refresh_routes
from app.api.routes import reports as reports_routes
from app.api.routes import schedules as schedules_routes
from app.api.routes import summary as summary_routes
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import RequestIdMiddleware, configure_logging, get_logger

# Aggregated API router mounted under ``/api``. Individual route modules
# (health, reports, datasets, schedules, refresh, summary, collect) attach
# their routers to this aggregate. Metadata + health routers are wired in
# stage 2.5; refresh/summary (2.6) and collect (5.3) follow.
api_router = APIRouter(prefix="/api")
api_router.include_router(health_routes.router)
api_router.include_router(reports_routes.router)
api_router.include_router(datasets_routes.router)
api_router.include_router(schedules_routes.router)
api_router.include_router(refresh_routes.router)
api_router.include_router(summary_routes.router)
api_router.include_router(collect_routes.router)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: startup/shutdown hooks.

    Resource initialization (DB engine, Redis pool) is added in later stages.
    """
    settings = get_settings()
    log = get_logger("app.lifespan")
    log.info("app_startup", mode=settings.APP_MODE, timezone=settings.APP_TIMEZONE)
    yield
    log.info("app_shutdown")


def create_app() -> FastAPI:
    """Application factory."""
    configure_logging()
    settings = get_settings()

    app = FastAPI(
        title="Power BI Refresh Monitor",
        version="1.0.0",
        lifespan=lifespan,
    )

    # Request-id middleware (binds id + sets X-Request-Id response header).
    app.add_middleware(RequestIdMiddleware)

    # Global exception handlers (AppError / RequestValidationError / Exception).
    # All failures render the standard ErrorResponse envelope; secrets and
    # stacktraces are never exposed in the body (Requirement 20.5).
    register_exception_handlers(app)

    # CORS — driven by CORS_ALLOWED_ORIGINS (default http://localhost:5173).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
    )

    # Mount the aggregated /api router. Sub-routers are attached in later tasks.
    app.include_router(api_router)

    return app


app = create_app()
