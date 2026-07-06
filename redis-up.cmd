@echo off
REM ============================================================
REM  Ensure the dev Redis container is running (detached).
REM  Named container "bip-redis" with --restart unless-stopped so
REM  it auto-starts with Docker Desktop. Requires Docker running.
REM ============================================================
docker start bip-redis >NUL 2>&1 || docker run -d --name bip-redis --restart unless-stopped -p 6379:6379 redis:7-alpine
if errorlevel 1 (
  echo [WARN] Failed to start Redis container. Make sure Docker Desktop is running.
) else (
  docker ps --filter "name=bip-redis"
)
