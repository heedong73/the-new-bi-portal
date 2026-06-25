# ============================================================
# Frontend Dockerfile - 멀티스테이지 빌드
#   1) node:20-alpine 에서 Vite 정적 빌드
#   2) nginx:alpine 으로 정적 파일 서빙 (컨테이너 :80)
# compose 에서 5173:80 으로 매핑된다.
# ============================================================

# ---- Stage 1: build ----
FROM node:20-alpine AS build
WORKDIR /app

# 의존성 설치 (package.json 변경 시에만 레이어 재생성)
# NOTE: 기업 네트워크의 TLS 검사(self-signed 인증서 체인) 환경에서 npm registry
# 인증서 검증이 실패할 수 있어 strict-ssl 을 비활성화한다(공식 registry 한정).
COPY package.json package-lock.json* ./
RUN npm config set strict-ssl false \
    && npm install

# 소스 복사 후 빌드
COPY . .
RUN npm run build

# ---- Stage 2: serve ----
FROM nginx:alpine AS runtime

# SPA fallback + 정적 서빙 설정
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 빌드 산출물 복사
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
