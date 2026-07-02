@echo off
REM ============================================================
REM  Local (Windows) Celery Beat (scheduler)
REM  Fires periodic tasks: mail schedule dispatch (every minute),
REM  refresh collection, retention cleanup. Redis must be running,
REM  and the worker (run_worker.cmd) must also be running to process
REM  the tasks Beat enqueues.
REM ============================================================
cd /d "%~dp0"
".venv\Scripts\python.exe" -m celery -A app.workers.celery_app beat -l info
