@echo off
REM ============================================================
REM  개발용 단일 Docker 실행기
REM  redis + backend(리로드) + worker + beat + frontend(Vite)를
REM  docker compose 하나로 모두 띄운다. 창을 여러 개 열 필요 없음.
REM
REM  - 접속: 프런트 http://localhost:5173 , 백엔드 http://localhost:8000
REM  - 종료: 이 창에서 Ctrl+C  (또는 dev-down.cmd)
REM  - 코드 변경은 자동 반영(백엔드 uvicorn --reload / 프런트 Vite HMR).
REM  - requirements.txt 변경 시에만: dev-up.cmd --build
REM
REM  Docker Desktop 이 실행 중이어야 한다.
REM ============================================================
setlocal
set ROOT=%~dp0

REM 예전 단독 redis 컨테이너가 있으면 제거(포트 6379 / 이름 충돌 방지). compose가 자체 redis를 띄운다.
docker rm -f bip-dev-redis >NUL 2>&1

echo Starting all services via docker compose (redis / backend / worker / beat / frontend)...
echo   Frontend: http://localhost:5173
echo   Backend : http://localhost:8000
echo   (stop: Ctrl+C, or run dev-down.cmd)
echo.

docker compose -f "%ROOT%docker-compose.dev.yml" up %*

endlocal
