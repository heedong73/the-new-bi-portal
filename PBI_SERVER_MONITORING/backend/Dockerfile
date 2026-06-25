# ============================================================
# Backend Dockerfile - FastAPI (Python 3.12)
# ------------------------------------------------------------
# - Installs dependencies from pyproject.toml.
# - Runs as a non-root user.
# - Uses entrypoint.sh (uvicorn now; alembic upgrade head added in stage 3.2).
# compose maps 8000:8000 and overrides the command for worker/scheduler.
# ============================================================
FROM python:3.12-slim AS runtime

# Avoid .pyc files and enable unbuffered stdout for structured logs.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# curl is needed for the compose healthcheck (GET /api/health).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Copy project metadata + source, then install (package build needs app/).
COPY pyproject.toml ./
COPY app ./app
# NOTE: some corporate networks / antivirus perform TLS interception, which
# makes PyPI's certificate appear self-signed inside the container and breaks
# pip's TLS verification. We mark the official PyPI hosts as trusted so the
# build works behind such proxies. (Scoped to the known PyPI hosts only.)
ARG PIP_TRUSTED="--trusted-host pypi.org --trusted-host files.pythonhosted.org --trusted-host pypi.python.org"
RUN pip install $PIP_TRUSTED --upgrade pip \
    && pip install $PIP_TRUSTED .

# Alembic config (entrypoint runs `alembic upgrade head` from /app before
# uvicorn). script_location = app/migrations resolves relative to this dir.
COPY alembic.ini ./alembic.ini

# Copy entrypoint.
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create and switch to a non-root user.
RUN useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
