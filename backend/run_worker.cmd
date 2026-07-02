@echo off
REM ============================================================
REM  Local (Windows) Celery worker
REM  The default prefork pool (billiard) does not work on Windows
REM  (WinError 6 / SystemExit), so run with the single-thread solo pool.
REM  Handles report publish (PBIX import), manual refresh, mail sending.
REM  Redis must be running.
REM
REM  Production (docker-compose / Linux) uses prefork normally; this
REM  script is for local development only.
REM ============================================================
cd /d "%~dp0"
".venv\Scripts\python.exe" -m celery -A app.workers.celery_app worker -l info --pool=solo
