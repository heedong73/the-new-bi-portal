@echo off
REM Stop the dev Redis container (keeps the container so it can be started again).
docker stop bip-redis
