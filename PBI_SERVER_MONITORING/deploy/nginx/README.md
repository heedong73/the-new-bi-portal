# BIP nginx 리버스 프록시

내부망 전용 BIP의 **유일한 외부 진입점**인 엣지 nginx 설정이다. `default.conf` 는
dedicated `nginx` 서비스(`nginx:alpine`)의 `/etc/nginx/conf.d/default.conf` 로
마운트된다(서비스 결선은 docker-compose 정의에서 처리).

## 라우팅

| 경로 | 대상 | 비고 |
|---|---|---|
| `/` | `frontend:80` (React SPA 정적) | frontend 컨테이너는 자체 nginx 로 SPA 서빙, 단독 노출 안 함 |
| `/api/*` | `backend:8000` (FastAPI) | PBIX 업로드 고려해 `client_max_body_size 200m` |
| `/reportimage/*` | (정적 서빙) | **기본 비활성** — 아래 참조 |

충족: R25.6(단일 리버스 프록시 진입점), R31.3(이미지 접근 권한 검증).

## `/reportimage/*` 정적 서빙 (기본 OFF)

nginx 정적 서빙은 BIP 권한 검증을 **우회**하므로 기본적으로 비활성이다
(`SERVE_REPORTIMAGE_STATIC=false`). 저장 이미지의 기본 접근 경로는:

1. **메일**: Worker 가 이미지 바이트를 `multipart/related` + `Content-ID(cid:)` inline 첨부
2. **포털/관리자**: `GET /api/report-images/{id}` 권한 검증 다운로드 API(스트리밍)

내부망 편의가 꼭 필요할 때만 `default.conf` 의 `location /reportimage/` 주석을
해제하고 `STORAGE_ROOT_PATH` 를 nginx 컨테이너에 마운트한다. 켜는 즉시 인증 우회
위험이 발생함을 인지/문서화할 것.

## TLS 종단 (placeholder)

`default.conf` 하단의 `:443` server 블록이 TLS 종단 자리다. 사내 인증서를
`/etc/nginx/certs/bip.crt`, `/etc/nginx/certs/bip.key` 로 마운트한 뒤 주석을
해제하고, 필요 시 `:80` 블록을 HTTPS 리다이렉트로 전환한다.

## 검증 참고

`upstream` 의 `backend`/`frontend` 호스트명은 compose 네트워크에서만 resolve 되므로
`nginx -t` 단독 실행은 호스트 미해결로 실패할 수 있다. 실제 검증은 compose 기동
후 `docker compose exec nginx nginx -t` 로 수행한다.
