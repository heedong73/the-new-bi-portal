@echo off
REM ============================================================
REM  Local (Windows) dev launcher
REM  - Redis: detached Docker container (no window). Uses a named
REM    container with --restart unless-stopped so it comes back up
REM    automatically whenever Docker Desktop starts.
REM  - Worker / Beat / Backend / Frontend: each in its own window
REM    (dev with hot reload). These will be dockerized later.
REM
REM  Requires Docker Desktop running.
REM ============================================================
setlocal
set ROOT=%~dp0

echo Ensuring Redis container (detached, auto-restart)...
docker start bip-redis >NUL 2>&1 || docker run -d --name bip-redis --restart unless-stopped -p 6379:6379 redis:7-alpine
if errorlevel 1 (
  echo [WARN] Redis 컨테이너를 시작하지 못했습니다. Docker Desktop이 실행 중인지 확인하세요.
)

echo Starting Worker / Beat / Backend / Frontend in separate windows...

REM Celery worker (Windows requires solo pool)
start "BIP Worker" cmd /k "%ROOT%backend\run_worker.cmd"

REM Celery Beat (scheduler) - fires scheduled mail dispatch every minute
start "BIP Beat" cmd /k "%ROOT%backend\run_beat.cmd"

REM Backend (FastAPI, hot reload)
start "BIP Backend" cmd /k "cd /d %ROOT%backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"

REM Frontend (Vite)
start "BIP Frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"

echo.
echo Done.
echo  - Redis: runs in background as docker container "bip-redis" (no window).
echo  - 4 windows opened: Worker / Beat / Backend / Frontend. Close a window to stop that service.
echo  - Stop Redis with: docker stop bip-redis   (start again: docker start bip-redis)
endlocal
