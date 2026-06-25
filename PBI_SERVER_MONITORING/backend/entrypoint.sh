#!/usr/bin/env bash
# ============================================================
# Backend container entrypoint.
# ------------------------------------------------------------
# 동작 모드:
#   * 인자 없음(backend 서비스):
#       1. DB 마이그레이션 적용 (alembic upgrade head)
#       2. uvicorn 으로 FastAPI 앱 기동
#   * 인자 있음(worker / scheduler 서비스, 예: "celery -A ... worker"):
#       마이그레이션을 실행하지 않고(주: backend 가 담당) 전달된 명령을 그대로 실행.
#       이 컨테이너들은 compose depends_on 으로 backend healthy 이후 기동된다.
#
# `set -euo pipefail` 로 마이그레이션 실패 시 기동을 중단하여, 스키마가
# 최신이 아닌 상태로 트래픽을 받지 않도록 한다.
# ============================================================
set -euo pipefail

# 인자가 전달되면(worker/scheduler) 해당 명령을 그대로 실행한다.
if [ "$#" -gt 0 ]; then
  echo "Starting command: $*"
  exec "$@"
fi

# 인자가 없으면(backend) 마이그레이션 후 uvicorn 을 기동한다.
echo "Applying database migrations (alembic upgrade head)..."
alembic upgrade head

echo "Starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
