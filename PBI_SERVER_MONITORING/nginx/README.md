# nginx 리버스 프록시 (BIP)

BIP(The New BI Portal)의 **내부망 전용 단일 진입점**이다. `docker-compose`(task 1.1)의 `nginx` 서비스가 이 설정을 사용한다.

## 라우팅

| 경로 | 대상 | 비고 |
|---|---|---|
| `/` | Frontend 정적 빌드 (`/usr/share/nginx/html`) | SPA fallback (`index.html`) |
| `/api/*` | `backend:8000` (FastAPI) | 리버스 프록시, PBIX 업로드 대비 `client_max_body_size 200m` |
| `/reportimage/*` | 저장 이미지 정적 서빙 | **기본 비활성** (`SERVE_REPORTIMAGE_STATIC=false`) — 권한 우회이므로 주석 블록으로 비활성 |

## 보안 경계

- 이 컨테이너는 어떤 secret(Power BI/Azure/SMTP/DB)에도 접근하지 않는다 (design 결정 #4 / R38).
- `/reportimage/*` 정적 서빙은 BIP 권한 검증을 우회한다. 저장 이미지 접근의 기본 경로는
  (a) 메일 본문 inline(CID) 첨부, (b) `GET /api/report-images/{id}` 권한 검증 다운로드 API 다.
  완전한 내부망 편의가 필요할 때만 운영자가 의도적으로 활성화한다 (R31.3).

## 정적 서빙 활성화 (선택)

`nginx.conf` 하단의 `/reportimage/` 주석 블록을 해제하고, StorageService 의
`STORAGE_ROOT_PATH`(기본 `/data/reportimage`)를 동일 경로로 read-only 마운트한다.

## 검증

```sh
docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
```
