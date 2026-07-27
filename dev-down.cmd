@echo off
REM 개발용 docker compose 스택 종료(컨테이너/네트워크 정리, 볼륨은 보존).
REM 볼륨까지 지우려면: dev-down.cmd -v
setlocal
docker compose -f "%~dp0docker-compose.dev.yml" down %*
endlocal
