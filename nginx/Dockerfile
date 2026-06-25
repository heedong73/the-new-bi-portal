# Edge nginx — 프론트엔드 SPA 정적 서빙 + /api 리버스 프록시 (T-44)
# 1) 프론트엔드 빌드
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
# 사내 프록시/자체서명 인증서 환경에서 npm SSL 검증 우회 (backend pip --trusted-host 와 동일 맥락)
RUN npm config set strict-ssl false && npm install
COPY frontend/ .
RUN npm run build

# 2) nginx: 정적 서빙(SPA fallback) + /api 프록시
FROM nginx:alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
