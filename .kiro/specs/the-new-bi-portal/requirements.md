# Requirements Document

## Introduction

사내 BI Portal(이하 BIP)은 현재 외부 업체 솔루션으로 운영 중인 "사내 Power BI 레포트 공유 웹 포털"을 자체 개발 시스템으로 대체하기 위한 내부 운영 포털이다. 단순 레포트 게시판이 아니라, Power BI Embedded 기반 레포트 조회, 사용자/그룹/권한 관리, 인사정보 DB 기반 사번/비밀번호 로그인, 데이터셋 새로고침 상태 표시, Power BI Export 기반 정기 메일 발송, 운영 로그/모니터링/통계 대시보드를 포함하는 운영 등급(production-grade) 시스템이다. (요청센터는 v1.1+ 범위)

본 시스템은 회사 표준 기술 스택(FastAPI, PostgreSQL 16+, Redis 7, React 19 + Vite 6 + TypeScript, Tailwind CSS v4, Node.js 20 LTS, Docker Compose)으로 내부망 전용으로 구축된다. 운영 원장(ledger)은 PostgreSQL의 별도 DB `bi_portal`(AWS RDS, 서울 리전)에 저장하며, Redis는 cache / queue / lock 용도로만 사용한다. 모든 Power BI API 호출, Embed Token 발급, Export, Refresh는 Backend 또는 Worker에서만 수행하고 secret을 Frontend에 노출하지 않는다.

본 시스템은 이미 동일 워크스페이스에서 개발되어 실제 Power BI와 연동 중인 `powerbi-refresh-monitor` 시스템의 자산(FastAPI 라우트, Celery 수집 Worker, React Gantt 컴포넌트, Power BI client/token service 등)을 재활용한다. 특히 해당 시스템의 "Refresh 실행 현황" 화면은 BIP의 한 메뉴로 편입된다.

본 프로젝트는 1인 개발, 12주, 주 4.5일 작업 제약하에 수행되므로, 요구사항은 **v1.0 필수 범위**와 **v1.1 이후 고도화 범위**로 명확히 구분한다. 보안/권한/Power BI Token/로그인 인증/메일/Job 중복실행/로그·감사 등 민감 영역은 본 요구사항에서 "무엇을 보장해야 하는가"를 기술하고, 구체적 구현 방식·대안 비교·결정은 후속 design 및 risk-and-decision-log 문서로 위임한다.

### 범위 구분 표기 규약

각 Requirement 제목에 다음 표기를 부여한다.

- **[v1.0]**: v1.0 필수 범위. 기존 업체 솔루션 대체를 위해 반드시 필요.
- **[v1.1+]**: v1.1 이후 고도화 범위. v1.0 인도 후 추가.

기능 범위 번호(사용자 제공 1~29)는 각 Requirement에 `(기능 #N)` 형식으로 매핑한다. 

## Glossary

### 시스템 컴포넌트

- **BIP (BI_Portal_System)**: 본 문서가 정의하는 전체 시스템(웹 + Backend + Worker + DB + Cache + Mail).
- **Backend_API**: FastAPI 기반 REST API 서버. 인증, 권한 검증, 데이터 조회/관리, Power BI 연동 트리거를 담당.
- **Frontend_App**: React 19 + Vite 6 + TypeScript 기반 SPA. 사용자 웹 UI.
- **Worker**: Celery 기반 Background Worker. Power BI 수집, Export, 메일 발송 등 비동기/장기 작업 수행.
- **Scheduler**: Celery Beat 기반 주기 작업 트리거 컴포넌트.
- **Token_Service**: Azure AD client credentials flow로 Power BI access token 및 Embed Token 발급/갱신/캐싱을 담당하는 Backend 내부 서비스.
- **PowerBI_Client**: Backend/Worker 내부에서 Power BI REST API를 호출하는 HTTP 클라이언트 모듈.
- **Mail_Service**: 사내 메일 서버(SMTP)를 통해 메일을 발송하는 Backend/Worker 내부 서비스.
- **Refresh_Monitor**: 재활용되는 `powerbi-refresh-monitor` 시스템의 "Refresh 실행 현황" 기능을 BIP에 편입한 하위 모듈.

### 인증/권한 용어

- **HR_Auth (인사정보 인증)**: 사내 그룹웨어에 표준 SSO가 없어, 운영 DB `bi_portal`의 `public` 스키마에 적재된 인사정보 뷰(`scl_v_insa_*`)를 자격 증명/프로필 원천으로 사용하는 BIP의 로그인 방식.
- **Insa_View**: 인사정보 읽기 전용 뷰 집합(실측 확정). `scl_v_insa_user_add_pwd`(사번 `emp_no`+해시 비밀번호 `login_pwd`(64자 소문자 hex)+회사메일 `cmp_email`+`user_name`+`emp_status`), `scl_v_insa_user`(임직원 기본정보·재직상태 `emp_status`/`retire_date`), `scl_v_insa_my_job`(사번↔회사 `cmp_id`/조직 `dept_id`/직급 `ofc_id`/직책 `pos_id`/기준부서 `bass_dept_yn` 연결, 겸직 시 다중 행), `scl_v_insa_dept_add_depth`(조직 `dept_id`/`dept_name`/상위 `up_dept_id`/`dept_depth`), `scl_v_insa_office`(직급 `ofc_id`/`ofc_name`).
- **Job_Context (직무 컨텍스트)**: 한 사용자(`emp_no`)의 (회사, 조직, 직급) 조합 1건. 겸직 사용자는 복수 Job_Context를 가질 수 있다. v1.0에서는 기본 부서(대표) 1건만 사용하며, 복수 Job_Context 중 사용자가 활성 컨텍스트를 선택하는 기능은 v1.1+ 범위이다.
- **Authenticated_User**: HR_Auth를 통해 인증된 사용자.
- **Local_Admin**: 인사정보 DB 장애 시 비상용으로 로그인하는 로컬 관리자 계정.
- **User_Role**: 사용자에게 부여되는 역할. `일반 사용자(General_User)`, `수퍼 사용자(Super_User)`, `시스템 운영자(System_Operator)` 중 하나 이상.
  - **General_User**: 권한이 부여된 레포트를 조회하는 표준 사용자.
  - **Super_User**: General_User 권한에 더해, 권한 범위 내 수동 새로고침을 수행할 수 있는 사용자.
  - **System_Operator**: 사용자/그룹/권한/레포트/메일/모니터링을 관리하는 최고 권한 사용자.
- **User_Group**: 사용자 묶음 단위. 권한 부여의 대상이 될 수 있음.
- **Department**: 그룹웨어로부터 매핑되는 사용자의 부서 정보.
- **Report_Permission**: 특정 Report에 대한 액션별 권한. 사용자/역할/부서/그룹 단위로 부여 가능. v1.0 권한 종류: `VIEW`/`DOWNLOAD`/`REFRESH`/`MANAGE_REPORT` (v1.1+: `SCHEDULE_REFRESH`/`MANAGE_PERMISSION`).
- **Permission_Subject**: 권한이 부여되는 주체. 사용자, 역할, 부서, 그룹 중 하나.

### Power BI / 데이터 용어

- **Workspace**: Power BI의 group(workspace) 단위.
- **Report**: Power BI의 레포트. `reportId`, `reportName`, `datasetId` 속성을 가짐.
- **Report_Folder**: BIP 내부의 레포트 분류 폴더. 계열사/팀/업무 영역 등 자유 계층(트리)으로 구성되며, 각 Report는 하나의 Report_Folder에 배치된다. Power BI 워크스페이스 구조와 독립이다.
- **Dataset**: Power BI의 데이터셋(Semantic Model).
- **Embed_Token**: Frontend가 Power BI Embedded 레포트를 렌더링하기 위해 필요한 단기 토큰.
- **PBIX**: Power BI Desktop 레포트 파일 포맷.
- **Refresh_Run**: Dataset의 단일 새로고침 실행 이력.
- **Refresh_Schedule**: Dataset의 예약 새로고침 설정.
- **Refresh_History**: Power BI가 제공하는 Dataset별 새로고침 이력.
- **Refresh_Status**: Refresh_Run의 상태(`성공`, `실패`, `진행중`, `알 수 없음`).

### Export / 메일 용어

- **Export_Job**: Power BI Export to File API를 통한 단일 내보내기 작업.
- **Export_Status**: Export_Job의 상태(`NotStarted`, `Running`, `Succeeded`, `Failed`).
- **Result_Zip**: Export_Job 완료 시 다운로드되는 결과 ZIP 파일.
- **Mail_Schedule**: 정기 메일 발송 예약 설정.
- **Mail_Recipient**: Mail_Schedule의 수신 대상 1건. 유형은 `USER`/`GROUP`/`DEPARTMENT`/`EMAIL`이며, 발송 시점에 실제 이메일 주소로 전개된다(그룹/부서는 구성원 메일로 펼침, 변경 자동 반영).
- **Mail_Job**: 단일 정기 메일 발송 실행 단위.
- **Report_Image_Path**: Result_Zip 압축 해제 후 저장되는 레포트 이미지 파일 경로(`/reportimage/...`).

### 운영 용어

- **Audit_Log**: 로그인/조회/권한/그룹/새로고침/메일/Export 등 운영 행위를 추적하는 감사 로그.
- **Request_Center**: 사용자가 문의사항, 에러 수정 요청 등을 등록하는 요청센터.
- **Local_Time**: `APP_TIMEZONE`(기본 `Asia/Seoul`) 기준 변환된 시각.
- **UTC_Time**: Power BI API가 반환하는 UTC 기준 시각.
- **bi_portal**: 기존 데이터플랫폼 AWS RDS PostgreSQL(서울 리전) 내 BIP 전용 데이터베이스. BIP 운영 원장과 인사정보 뷰(`scl_v_insa_*`)가 함께 존재한다.

## Requirements

## 1. 기능 요구사항 (Functional Requirements)

### Requirement 1: 인사정보 DB 기반 사번/비밀번호 로그인 [v1.0] (기능 #1)

**User Story:** 사내 사용자로서 그룹웨어 사번과 비밀번호로 BI Portal에 로그인하고 싶다, 그래야 별도 계정 발급 없이 기존 사내 인사 자격으로 포털에 접근할 수 있기 때문이다.

#### Acceptance Criteria

1. WHEN 인증되지 않은 사용자가 보호된 화면에 접근한 경우, THE Backend_API SHALL 사용자를 사번/비밀번호 로그인 화면으로 유도한다.
2. WHEN 사용자가 사번(`emp_no`)과 비밀번호를 입력하여 로그인한 경우, THE Backend_API SHALL `bi_portal`의 `public.scl_v_insa_user_add_pwd`에서 해당 `emp_no`의 `login_pwd`를 조회하고, 입력 비밀번호에 SHA-256 해시를 3회 연속 적용한 값이 `login_pwd`와 일치하면 BIP 세션을 생성한다.
3. WHEN 로그인이 성공하고 해당 사용자가 BIP에 처음 접근한 경우, THE Backend_API SHALL 자동 사용자 매핑 절차(Requirement 3)를 수행한다.
4. IF 입력 사번이 존재하지 않거나 해시 비교가 일치하지 않는 경우, THEN THE Backend_API SHALL 세션을 생성하지 않고 HTTP 401 응답과 한국어 오류 메시지를 반환한다.
5. WHEN 인증된 사용자의 세션이 만료된 경우, THE Backend_API SHALL 보호된 API 요청에 대해 HTTP 401 응답을 반환하고 재인증을 요구한다.
6. THE Backend_API SHALL 인사정보 테이블(`scl_v_insa_*`)을 읽기 전용으로만 사용하고, 사용자의 비밀번호나 그 해시를 BIP에 저장하지 않으며, 입력 비밀번호 및 `login_pwd` 값을 로그/응답/Audit_Log에 남기지 않는다(입력 비밀번호는 요청 처리 중 메모리에서만 사용).
7. WHEN 로그인이 성공한 경우, THE Backend_API SHALL `scl_v_insa_my_job`에서 해당 사번의 기본 부서(`bass_dept_yn='Y'` 우선, 없으면 `emp_sort_ordr` 최상위 1건)를 활성 부서로 매핑한다.

> 비고: 사내 그룹웨어에 표준 SSO(SAML/OIDC) 엔드포인트가 없어, 운영 DB `bi_portal`의 `public` 스키마에 적재된 인사정보 뷰를 자격 증명 원천으로 사용한다. 비밀번호는 그룹웨어 비밀번호를 SHA-256 3회 적용한 해시(`login_pwd`)와 비교한다.
>
> **겸직 처리 범위**: v1.0에서는 겸직 사용자도 **기본 부서 하나만** 사용하며 로그인 시 부서/회사 선택 UI를 제공하지 않는다. **계열사 간 겸직은 계열사별로 로그인 ID(`emp_no`)가 분리되므로**(ID 체계 상이) 일반 사용자와 동일하게 로그인되며 추가 처리가 필요 없다. 동일 회사 내 다중 부서/직책의 활성 컨텍스트 선택·전환은 **v1.1+** 범위로 분리한다.
>
> **보안 주의(레거시 해시)**: SHA-256 단순 3회 반복은 신규 비밀번호 저장 방식으로 권장되지 않는 방식이며, 기존 인사정보 DB의 `login_pwd` 검증을 위해 불가피하게 사용하는 레거시 검증 방식이다. BIP는 사용자의 비밀번호나 해시를 저장하지 않고, 입력 비밀번호는 요청 처리 중 메모리에서만 사용하며 로그에 남기지 않는다.
> 구현 메모: 비밀번호 해시는 **단순 SHA-256 3회 반복**(`sha256(sha256(sha256(password)))`, salt 없음)이며 `login_pwd`는 **64자 소문자 hex로 저장됨(실측 확정)**. 라운드 간 입력 형태(hex 문자열 재해싱 vs digest 바이트)만 알려진 샘플로 확정한다. 인사 뷰 컬럼/조인은 실측 완료(emp_no/cmp_id/dept_id/ofc_id/cmp_email/login_pwd/bass_dept_yn). DB 연결은 `sslmode=require` 필수. Job_Context 선택 UX, 세션 저장 방식은 design 및 risk-and-decision-log 문서 참조(D-01).

### Requirement 2: 비상용 로컬 관리자 로그인 [v1.0] (기능 #2)

**User Story:** 시스템 운영자로서 인사정보 DB 장애나 인증 연동 문제 시에도 포털에 로그인하고 싶다, 그래야 인증 의존성 장애 상황에서도 운영 작업을 지속할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 인사정보 DB 기반 로그인(HR_Auth)과 독립적인 Local_Admin 로그인 경로를 제공한다.
2. WHEN Local_Admin이 유효한 자격 증명으로 로그인한 경우, THE Backend_API SHALL System_Operator 권한을 가진 BIP 세션을 생성한다.
3. IF Local_Admin 로그인 자격 증명이 유효하지 않은 경우, THEN THE Backend_API SHALL 세션을 생성하지 않고 HTTP 401 응답을 반환한다.
4. THE Backend_API SHALL 모든 Local_Admin 로그인 시도(성공/실패)를 Audit_Log에 기록한다.

> 구현 메모: Local_Admin 자격 증명 저장 방식(해시 알고리즘), 무차별 대입 방어, 계정 수 제한 정책은 보안 요구사항(Requirement 33~35)을 만족하는 범위에서 design 문서에서 결정한다.

### Requirement 3: 사용자 자동 매핑 [v1.0] (기능 #3)

**User Story:** 시스템 운영자로서 그룹웨어 사용자가 BIP에 처음 로그인할 때 자동으로 사용자 레코드가 생성되기를 원한다, 그래야 사용자를 일일이 수동 등록하지 않아도 되기 때문이다.

#### Acceptance Criteria

1. WHEN 사용자가 BIP에 최초로 인증된 경우, THE Backend_API SHALL 인사정보 뷰(`scl_v_insa_user`, `scl_v_insa_my_job`, `scl_v_insa_dept_add_depth`, `scl_v_insa_office`)에서 해당 `emp_no`의 이름, 부서(조직), 직급, 회사메일(`cmp_email`) 정보를 조회하여 `bi_portal`에 BIP 사용자 레코드를 생성한다.
2. WHEN 기존 사용자가 재로그인하고 인사정보의 부서/직급/메일(`cmp_email`) 정보가 변경된 경우, THE Backend_API SHALL 해당 사용자 레코드의 변경된 속성을 갱신한다.
3. WHEN 신규 사용자 레코드가 자동 생성된 경우, THE Backend_API SHALL 해당 사용자에게 기본 역할로 General_User를 부여한다.
4. THE Backend_API SHALL 사용자 자동 매핑 및 속성 갱신 행위를 Audit_Log에 기록한다.
5. THE Backend_API SHALL 사용자 식별자(`users.external_id`)를 인사정보의 사번(`emp_no`)으로, 부서(`departments.external_id`)를 기본 부서의 조직 ID(`dept_id`)로 매핑한다.
6. THE Backend_API SHALL v1.0에서 사용자당 단일 기본 부서(Requirement 1.7)를 권한 계산의 부서 기준으로 사용한다. 겸직 활성 부서 선택은 v1.1+ 범위이다.

> 구현 메모: 인사 뷰 간 조인 키와 실제 컬럼명, 겸직(emp_no당 다중 조직/직급) 시 활성 Job_Context 선택·저장 방식, 메일 컬럼(`cmp_email`)의 정확한 소재 뷰는 design 문서에서 확정한다. BIP는 인사 뷰를 읽기 전용으로 참조하며 BIP 운영 데이터는 별도 테이블에 저장한다.

### Requirement 4: 사용자 관리 [v1.0] (기능 #4)

**User Story:** 시스템 운영자로서 BIP의 사용자 목록을 조회하고 상태를 관리하고 싶다, 그래야 퇴사자 비활성화 등 사용자 생애주기를 운영할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 사용자 목록을 식별자, 이름, 부서, 메일, 역할, 활성 상태와 함께 조회하는 기능을 제공한다.
2. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 특정 사용자를 비활성화 또는 재활성화하는 기능을 제공한다.
3. WHEN 사용자가 비활성화된 경우, THE Backend_API SHALL 해당 사용자의 신규 세션 생성을 거부하고, 이미 존재하는 모든 활성 세션을 즉시 무효화한다.
4. THE Backend_API SHALL 사용자 상태 변경 행위를 Audit_Log에 기록한다.

### Requirement 5: 사용자 그룹 생성/수정/삭제 [v1.0] (기능 #5)

**User Story:** 시스템 운영자로서 사용자 그룹을 만들고 관리하고 싶다, 그래야 그룹 단위로 레포트 권한을 일괄 부여할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL User_Group을 생성하는 기능을 제공한다.
2. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL User_Group의 이름과 설명을 수정하는 기능을 제공한다.
3. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL User_Group을 삭제하는 기능을 제공한다.
4. WHEN User_Group이 삭제된 경우, THE Backend_API SHALL 해당 그룹에 연결된 Report_Permission과 그룹원 관계를 함께 제거한다.
5. THE Backend_API SHALL User_Group 생성/수정/삭제 행위를 Audit_Log에 기록한다.

### Requirement 6: 그룹원 추가/제거 [v1.0] (기능 #6)

**User Story:** 시스템 운영자로서 사용자를 그룹에 추가하거나 제거하고 싶다, 그래야 조직 변경에 맞춰 그룹 구성을 유지할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 특정 사용자를 User_Group에 추가하는 기능을 제공한다.
2. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 특정 사용자를 User_Group에서 제거하는 기능을 제공한다.
3. IF 이미 그룹에 속한 사용자를 동일 그룹에 다시 추가하려는 경우, THEN THE Backend_API SHALL 중복 멤버십을 생성하지 않고 멱등하게 처리한다.
4. THE Backend_API SHALL 그룹원 추가/제거 행위를 Audit_Log에 기록한다.

### Requirement 7: 역할 관리 [v1.0] (기능 #7)

**User Story:** 시스템 운영자로서 사용자에게 일반 사용자/수퍼 사용자/시스템 운영자 역할을 부여하고 회수하고 싶다, 그래야 권한 수준을 사용자별로 통제할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `General_User`, `Super_User`, `System_Operator` 세 가지 User_Role을 정의한다.
2. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 특정 사용자에게 하나 이상의 User_Role을 부여하는 기능을 제공한다.
3. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 특정 사용자로부터 User_Role을 회수하는 기능을 제공한다.
4. THE Backend_API SHALL 모든 사용자가 최소 General_User 역할을 보유하도록 보장한다.
5. THE Backend_API SHALL 역할 부여/회수 행위를 Audit_Log에 기록한다.

### Requirement 8: 레포트 권한 관리 [v1.0] (기능 #8)

**User Story:** 시스템 운영자로서 레포트 조회 권한을 사용자/역할/부서/그룹 기준으로 부여하고 싶다, 그래야 조직 구조에 맞춰 유연하게 접근 통제를 할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 특정 Report에 대한 Report_Permission을 Permission_Subject(사용자/역할/부서/그룹) 단위로 부여하는 기능을 제공한다.
2. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 부여된 Report_Permission을 회수하는 기능을 제공한다.
3. THE Backend_API SHALL Report_Permission의 권한 종류로 v1.0에서 `VIEW`(조회/임베드), `DOWNLOAD`(Export/다운로드), `REFRESH`(수동 새로고침), `MANAGE_REPORT`(레포트 메타/공개 관리)를 정의하고, `SCHEDULE_REFRESH`(예약 새로고침 변경)·`MANAGE_PERMISSION`(권한 위임)은 v1.1+ 범위로 둔다.
4. WHEN 사용자의 특정 Report에 대한 특정 액션 수행 가능 여부를 판정하는 경우, THE Backend_API SHALL 해당 사용자에게 직접 부여된 권한과 사용자의 역할/부서/소속 그룹에 부여된 권한을 합집합으로 계산하고, 요청 액션에 대응하는 권한(예: 조회=`VIEW`, 새로고침=`REFRESH`) 보유 여부로 판정한다.
5. THE Backend_API SHALL `VIEW` 권한을 보유한 Report 목록만 해당 사용자에게 노출한다.
6. THE Backend_API SHALL Report_Permission을 Report 단위로 저장·판정하며, 레포트의 폴더(Report_Folder) 소속과 무관하게 동작한다(같은 폴더 내 레포트들도 서로 다른 권한 가능).
7. THE Backend_API SHALL Report_Permission 부여/회수 행위를 Audit_Log에 기록한다.

> 비고: 한 (주체, Report)에 복수 권한을 부여할 수 있다(예: VIEW + REFRESH). System_Operator는 모든 액션 권한을 보유한 것으로 간주한다. MANAGE_REPORT는 해당 레포트에 한정한 관리 위임이며, 전사 관리(사용자/그룹/역할 등)는 System_Operator 역할로 통제한다.

### Requirement 9: Power BI Embedded 레포트 조회 [v1.0] (기능 #9)

**User Story:** 일반 사용자로서 권한이 부여된 Power BI 레포트를 포털 화면에서 직접 조회하고 싶다, 그래야 Power BI 서비스에 별도 로그인하지 않고 사내 포털에서 레포트를 볼 수 있기 때문이다.

#### Acceptance Criteria

1. WHEN 사용자가 조회 권한을 보유한 Report를 요청한 경우, THE Backend_API SHALL 해당 Report에 한정된 Embed_Token과 임베드 정보를 발급하여 반환한다.
2. THE Frontend_App SHALL Backend_API가 발급한 Embed_Token을 사용하여 Power BI Embedded 레포트를 렌더링한다.
3. IF 사용자가 조회 권한이 없는 Report의 Embed_Token을 요청한 경우, THEN THE Backend_API SHALL Embed_Token을 발급하지 않고 HTTP 403 응답을 반환한다.
4. THE Backend_API SHALL Embed_Token 발급에 필요한 Power BI 자격 증명과 master token을 Frontend_App에 노출하지 않는다.
5. THE Backend_API SHALL Report 조회(임베드 토큰 발급) 행위를 Audit_Log에 기록한다.
6. WHERE 요청자가 대상 Report에 대한 `DOWNLOAD` 권한을 보유한 경우, THE Backend_API SHALL Power BI Export to File 작업을 Worker 비동기 작업으로 위임하고, Export_Job 식별자(`export_job_id`)를 포함한 HTTP 202 응답을 반환하는 기능을 제공한다.
7. THE Backend_API SHALL Export_Job 상태(`NotStarted`/`Running`/`Succeeded`/`Failed`)를 조회하는 기능을 제공하고, `Succeeded` 상태인 경우 결과 파일 다운로드 수단을 제공한다.
8. THE Backend_API SHALL Export_Job 실행 행위를 Audit_Log에 기록한다.

> 구현 메모: Embed Token 발급 방식(Embed for your organization vs. Embed for your customers / App-Owns-Data), 토큰 수명·갱신, 행 수준 보안(RLS) 적용 여부는 design 및 risk-and-decision-log 문서에서 대안 비교 후 결정한다.

### Requirement 10: 레포트 새로고침 상태 표시 [v1.0] (기능 #10)

**User Story:** 일반 사용자로서 레포트 화면에서 마지막 새로고침 시간과 상태, 다음 예약 새로고침 정보를 보고 싶다, 그래야 보고 있는 데이터의 최신성을 신뢰할 수 있기 때문이다.

#### Acceptance Criteria

1. WHEN 사용자가 Report를 조회하는 경우, THE Frontend_App SHALL 해당 Report와 연결된 Dataset의 마지막 새로고침 시각(Local_Time), Refresh_Status, 다음 예약 새로고침 시각을 표시한다.
2. THE Backend_API SHALL Report 화면에 필요한 마지막 Refresh_Run 정보와 Refresh_Schedule 정보를 제공한다.
3. IF 연결된 Dataset의 새로고침 이력이 없는 경우, THEN THE Frontend_App SHALL "새로고침 이력 없음"을 표시한다.
4. THE Frontend_App SHALL Refresh_Status를 `성공`, `실패`, `진행중`, `알 수 없음`으로 구분하여 시각적으로 표시한다.

### Requirement 11: 관리자 레포트 등록/수정/공개 관리 [v1.0] (기능 #11)

**User Story:** 시스템 운영자로서 포털에 노출할 레포트를 등록하고 공개/비공개를 관리하고 싶다, 그래야 사용자에게 제공할 레포트 카탈로그를 통제할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL Power BI Workspace의 Report를 BIP 카탈로그에 등록하는 기능을 제공한다.
2. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 등록된 Report의 표시명, 설명, 분류 등 메타데이터를 수정하는 기능을 제공한다.
3. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 등록된 Report를 공개 또는 비공개 상태로 전환하는 기능을 제공한다.
4. WHILE Report가 비공개 상태인 동안, THE Backend_API SHALL 권한 보유 여부와 무관하게 해당 Report를 일반 조회 목록에서 제외한다.
5. THE Backend_API SHALL Report 등록/수정/공개 상태 변경 행위를 Audit_Log에 기록한다.

### Requirement 12: 관리자 레포트 등록 (ID 수동 등록 + PBIX Import 업로드) [v1.0] (기능 #12, #29)

**User Story:** 시스템 운영자로서 이미 Power BI에 게시된 레포트를 ID로 카탈로그에 등록하거나, PBIX 파일을 Power BI Import API로 직접 업로드하여 게시하고 싶다, 그래야 기존 업체 솔루션을 거치지 않고도 포털의 레포트 카탈로그를 갱신·갱신본 반영할 수 있기 때문이다.

#### Acceptance Criteria

**ID 수동 등록**

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 이미 Power BI에 게시된 Report의 Power BI Report ID와 Dataset ID를 수동으로 입력받아 BIP 카탈로그에 등록하는 기능을 제공한다.
2. WHEN System_Operator가 Power BI Report ID / Dataset ID / Workspace ID를 입력하여 등록을 요청한 경우, THE Backend_API SHALL 입력된 식별자의 형식을 검증하고, `workspace_id`를 `workspaces` 테이블에 자동으로 upsert한 후 BIP 카탈로그에 Report 레코드를 생성한다.

**PBIX Import API 업로드**

3. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL Power BI Import API를 통해 PBIX 파일을 대상 Workspace에 업로드(신규 게시 또는 기존 레포트 갱신)하는 기능을 제공한다.
4. WHEN PBIX 업로드가 요청된 경우, THE Backend_API SHALL 업로드 및 Import 상태 polling 처리를 Worker 비동기 작업으로 위임하고 처리 상태(진행/성공/실패)를 추적 가능하게 한다.
5. WHEN PBIX Import가 성공한 경우, THE Backend_API SHALL 생성/갱신된 Report ID / Dataset ID를 BIP 카탈로그에 반영(신규 등록 또는 기존 레코드 갱신)하고, `workspace_id`를 `workspaces` 테이블에 자동으로 upsert한다.
6. IF 업로드된 파일이 PBIX 형식이 아니거나 허용 크기/확장자를 위반한 경우, THEN THE Backend_API SHALL 업로드를 거부하고 한국어 오류 메시지를 반환한다.
7. WHEN PBIX Import가 성공한 경우, THE Backend_API SHALL 해당 레포트가 새로고침을 요구하는 경우 "데이터셋 자격증명/게이트웨이 설정이 별도로 필요함"을 결과에 안내한다.
8. THE Backend_API SHALL 레포트 등록 시 BIP 폴더(Report_Folder, Requirement 41)를 지정받아 카탈로그 분류에 저장한다.
9. THE Backend_API SHALL ID 기반 수동 등록 및 PBIX Import 업로드 행위를 Audit_Log에 기록한다.

> 비고: 레포트 신규 등록(신규 PBIX 게시)은 **관리자(System_Operator)**만 수행한다. 수퍼 사용자의 레포트 등록 "요청" 기능은 사내 그룹웨어 IT 요청서로 처리되므로 BIP 범위에서 **제외**한다. 수퍼 사용자의 완전 셀프 업로드 및 업로드본 자동 검수는 v1.1+ 범위로 분리한다.
>
> **중요(데이터셋 자격증명/게이트웨이)**: PBIX 업로드는 워크스페이스 게시 = 임베드 자동 가능까지만 처리한다. 데이터 원본 자격증명/온프레미스 게이트웨이 연결은 Import API가 자동 설정하지 않으므로, 새로고침이 필요한 레포트는 업로드 후 운영자가 Power BI 포털에서 직접 설정한다(기존 운영 방식 동일). BIP는 이를 자동화하지 않고 안내만 한다.
>
> 구현 메모: Power BI Import API 사용 방식(`POST imports`, `nameConflict` 처리로 갱신 vs 신규), Import 상태 polling, 업로드 검증·격리(스캔), 버전/갱신 정책은 design 문서에서 결정한다.

### Requirement 13: 수동 새로고침 [v1.0] (기능 #13)

**User Story:** 수퍼 사용자로서 권한 범위 내 Dataset을 수동으로 새로고침하고 싶다, 그래야 예약 시각을 기다리지 않고 최신 데이터를 반영할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 대상 Dataset과 연결된 Report에 대한 `REFRESH` 권한(Requirement 8)을 보유한 경우, THE Backend_API SHALL Power BI Dataset 수동 새로고침을 트리거하는 기능을 제공한다.
2. IF 요청자가 대상 Dataset에 대한 `REFRESH` 권한을 보유하지 않은 경우, THEN THE Backend_API SHALL 새로고침을 트리거하지 않고 HTTP 403 응답을 반환한다.
3. WHEN 수동 새로고침이 트리거된 경우, THE Backend_API SHALL Power BI 호출을 Worker로 위임하고 요청자에게 접수 결과를 반환한다.
4. WHILE 동일 Dataset에 대한 새로고침이 이미 진행 중인 동안, THE Backend_API SHALL 중복 새로고침 트리거를 차단하고 진행 중 상태를 반환한다.
5. THE Backend_API SHALL 수동 새로고침 트리거 행위(요청자, 대상 Dataset, 결과)를 Audit_Log에 기록한다.

### Requirement 14: Power BI Refresh History 동기화 [v1.0] (기능 #14)

**User Story:** 시스템 운영자로서 Power BI의 새로고침 이력이 포털에 주기적으로 동기화되기를 원한다, 그래야 포털 화면이 항상 최신 새로고침 현황을 반영할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Scheduler SHALL Power BI Refresh_History 동기화 작업을 환경 변수로 설정 가능한 고정 간격으로 트리거한다.
2. THE Worker SHALL Power BI Refresh_History를 수집하여 `bi_portal`에 upsert한다.
3. WHEN 동일한 Refresh_Run 식별자가 이미 존재하는 경우, THE Worker SHALL 신규 삽입 대신 갱신(upsert)을 수행한다.
4. WHILE 동일 Workspace에 대한 동기화 작업이 이미 실행 중인 동안, THE Worker SHALL Redis 기반 분산 락으로 중복 실행을 방지한다.
5. THE BIP SHALL 본 동기화 기능을 재활용 대상인 `powerbi-refresh-monitor`의 Collector 자산을 기반으로 구현한다.

### Requirement 15: Refresh 실행 현황 화면 편입 [v1.0] (기능 #27 일부)

**User Story:** 시스템 운영자로서 기존에 개발된 "Refresh 실행 현황" 대시보드를 BIP 메뉴에서 사용하고 싶다, 그래야 별도 시스템을 오가지 않고 한 포털에서 새로고침 현황을 모니터링할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Frontend_App SHALL `powerbi-refresh-monitor`의 "Refresh 실행 현황" 화면(KST 타임테이블/Gantt, KPI 카드, 리포트 제외/정렬, 상세 테이블)을 BIP의 모니터링 메뉴로 편입하여 제공한다.
2. THE Frontend_App SHALL 편입된 Refresh 실행 현황 화면을 BIP의 공통 레이아웃(사이드바, 헤더)과 인증/권한 체계 안에서 렌더링한다.
3. WHERE 요청자가 해당 화면 접근 권한을 보유한 경우에 한해, THE Backend_API SHALL Refresh 실행 현황 데이터를 제공한다.
4. THE BIP SHALL 편입된 화면의 Gantt/타임테이블/필터/CSV 내보내기 등 기존 컴포넌트 자산을 재활용한다.

> 비고: 기능 #27 "기존 KIRO 개발 대시보드 합치기" 전체는 v1.1+ 범위(Requirement 28)이나, 사용자가 명시적으로 요구한 "Refresh 실행 현황" 메뉴 편입은 v1.0 범위에 포함한다.
>
> 범위 비상 옵션(contingency): PRM 자산은 재활용 가능 시 우선 사용한다. 다만 PRM 코드 의존성으로 BIP 핵심 기능(인증·권한·Embed 조회·Export 메일 발송) 구현이 지연되는 경우, 본 Refresh 실행 현황 화면(R15)과 Refresh History 동기화(R14)는 v1.0 optional 또는 v1.1+로 분리하는 것을 검토한다. 핵심 기능 인도가 우선이다.

### Requirement 16: Export 기반 정기 메일 발송 파이프라인 [v1.0] (기능 #15~21)

**User Story:** 시스템 운영자로서 Power BI Export 결과 이미지를 정해진 일정에 사내 메일로 자동 발송하고 싶다, 그래야 사용자가 포털에 접속하지 않아도 정기 보고를 받을 수 있고 기존 업체 솔루션의 메일 발송을 대체할 수 있기 때문이다. 하나의 power bi report에 여러 페이지가 있는 경우, 페이지를 다중 선택할 수 있어야 한다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 대상 Report, 발송 대상 페이지, 수신자, 발송 주기를 포함하는 Mail_Schedule을 생성/수정/삭제하는 기능을 제공한다. 수신자는 특정 사용자, 사용자 그룹, 부서, 직접 입력 이메일 주소를 혼합하여 지정할 수 있다. (기능 #15)
2. WHERE 대상 Report가 여러 페이지를 포함하는 경우, THE Backend_API SHALL Mail_Schedule에 발송 대상 페이지를 하나 이상 다중 선택하여 저장하는 기능을 제공한다. (기능 #15)
3. WHEN Mail_Schedule의 예약 시각이 도래한 경우, THE Scheduler SHALL Mail_Job을 트리거하고 "schedule working" 의미의 시작 로그를 기록한다. (기능 #15, #23)
4. WHEN Mail_Job이 시작된 경우, THE Worker SHALL Mail_Schedule에 선택된 각 페이지에 대해 Power BI Export to File 작업을 시작하고 Export_Status를 추적한다. (기능 #15, #16)
5. THE Worker SHALL Export_Status를 `NotStarted` → `Running` → `Succeeded` 흐름으로 polling하며 상태 전이를 기록한다. (기능 #16)
6. WHEN Export_Job이 생성된 경우, THE Worker SHALL `exports/{exportId}` 식별 정보를 로그에 기록한다. (기능 #16, #23)
7. WHEN Export_Status가 `Succeeded`가 된 경우, THE Worker SHALL Result_Zip 파일을 다운로드한다. (기능 #17)
8. WHEN Result_Zip이 다운로드된 경우, THE Worker SHALL Result_Zip을 extracted 폴더로 압축 해제한다. (기능 #18)
9. WHEN 압축 해제가 완료된 경우, THE Worker SHALL 선택된 각 페이지에 대해 생성된 `/reportimage/...` 형식의 Report_Image_Path를 `bi_portal`에 저장한다. (기능 #19)
10. WHEN 선택된 모든 페이지의 Report_Image_Path가 저장된 경우, THE Mail_Service SHALL 사내 메일 서버를 통해 대상 수신자에게 다중 페이지 이미지를 **본문 inline(CID 첨부)** 으로 포함한 메일을 발송하고 "Sending email" 및 "Email sent" 의미의 로그를 기록한다. (기능 #20, #23)
11. WHILE 동일 Mail_Schedule에 대한 Mail_Job이 이미 실행 중인 동안, THE Worker SHALL Redis 기반 분산 락으로 중복 실행을 방지한다. (Job 중복 실행 방지)
12. IF 선택된 페이지 중 하나라도 Export_Status가 `Failed`가 되거나 메일 발송이 실패한 경우, THEN THE Worker SHALL 실패 사유(실패한 페이지 식별 정보 포함)를 메일 발송 로그에 기록하고 Mail_Job을 실패 상태로 종료한다. (기능 #21)
13. THE Backend_API SHALL Mail_Job별 발송 성공/실패 이력을 조회하는 기능을 제공한다. (기능 #21)
14. WHEN Mail_Job이 발송되는 시점에, THE Backend_API SHALL 지정된 수신자(사용자/그룹/부서/직접 이메일)를 실제 이메일 주소 집합으로 해석하고(그룹·부서는 소속 구성원의 메일로 전개), 중복을 제거하여 발송 대상으로 사용한다. 그룹원/부서원 변경은 다음 발송에 자동 반영된다. (기능 #15)
15. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL Mail_Schedule에 메일 제목 템플릿, 상단/하단 안내 문구, 이미지 표시 폭, 이미지 실제 리사이즈 목표 폭(px), 페이지 순서를 설정하는 기능을 제공한다. (기능 #15, #20)
16. WHEN Mail_Job 본문을 조립하는 경우, THE Worker SHALL 상단 안내 문구 → 선택된 페이지 이미지를 `sort_order` 순서대로 지정된 표시 폭으로 inline 배치 → 하단 안내 문구 순으로 구성하고, 사용자 입력 HTML은 XSS 방지를 위해 sanitize한다. (기능 #20)
17. WHEN 이미지 리사이즈 목표 폭이 설정된 경우, THE Worker SHALL 추출 이미지를 해당 폭으로 비율을 유지하여 실제 픽셀 다운스케일(재인코딩)하고, 원본 이미지는 보존하며(리사이즈본을 별도 저장), 메일에는 리사이즈본을 첨부한다. 원본보다 큰 목표 폭은 업스케일하지 않고 원본을 사용하며, 리사이즈 실패 시 원본으로 fallback한다. (기능 #20)

> 구현 메모: Export 형식(PNG/PDF/PPTX), polling 간격·타임아웃·재시도 정책, ZIP 저장/이미지 정적 서빙 위치, 메일 본문 템플릿, SMTP 인증, 락 키 설계·TTL은 design 및 risk-and-decision-log 문서에서 결정한다. 기존 업체 솔루션의 메일 발송 흐름(schedule working → Export NotStarted/Running/Succeeded → exports/{exportId} → result.zip → extracted 압축해제 → /reportimage 경로 저장 → Lock 중복방지 → Sending/Email sent)을 본 파이프라인의 기준 흐름으로 삼는다.

### Requirement 17: 요청센터 [v1.1+] (기능 #22)

**User Story:** 일반 사용자로서 문의사항이나 에러 수정 요청을 포털에서 등록하고 처리 현황을 확인하고 싶다, 그래야 별도 채널 없이 포털 안에서 요청을 관리할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 인증된 사용자가 문의/에러 수정 요청을 생성하는 기능을 제공한다.
2. THE Backend_API SHALL 요청자가 자신이 생성한 요청의 처리 상태를 조회하는 기능을 제공한다.
3. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 등록된 요청의 상태를 변경하고 응답을 등록하는 기능을 제공한다.
4. THE Backend_API SHALL 요청 생성/상태 변경 행위를 Audit_Log에 기록한다.

> 비고: 요청센터는 v1.1+ 고도화 범위로 분리한다. v1.0 기간에는 문의/에러 수정 요청을 사내 그룹웨어 IT 요청서 등 기존 채널로 처리한다.

### Requirement 18: 통계 대시보드 [v1.0] (기능 #25)

**User Story:** 시스템 운영자로서 포털 사용 및 운영 지표를 한눈에 보고 싶다, 그래야 레포트 활용도와 시스템 건강성을 파악할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL v1.0 기본 운영 통계로서 접속 수(로그인 수), 레포트 조회 수, 새로고침 성공/실패 건수, 메일 발송 성공/실패 건수, 실패 Job 수를 집계하여 제공한다.
2. THE Backend_API SHALL v1.0 사용 통계로서 다음 지표를 집계하여 제공한다.
   - 인기 리포트 TOP 10 (조회 수 기준)
   - 부서별 리포트 수
   - 월별 등록 리포트 수
   - 사용자별 조회 수
   - 스케줄 메일 발송 건수
   - Export 성공/실패 건수
   - Refresh 실패 현황
   - 미사용 리포트 목록 (설정 가능한 기간 동안 조회 이력이 없는 공개 Report)
3. THE Frontend_App SHALL 통계 대시보드 화면에 v1.0 기본 운영 통계 및 사용 통계 지표를 카드, 차트, 목록으로 표시한다.
4. WHERE 요청자가 통계 대시보드 접근 권한을 보유한 경우에 한해, THE Backend_API SHALL 통계 데이터를 제공한다.
5. THE Backend_API SHALL 통계 집계 시 기간(예: 일/주/월) 필터를 지원한다.
6. THE BIP SHALL 고급 분석, AI 기반 분석, 복잡한 대시보드를 v1.1+ 범위로 분리한다(AI 분석은 Requirement 21 참조).

> 비고: v1.0 통계 대시보드는 위 기본 운영 지표 및 사용 통계 지표 표출로 한정한다. 고급 분석/AI 분석/복잡한 대시보드는 v1.1+에서 다룬다. 모든 통계는 별도 원장 없이 기존 테이블(audit_logs, reports, refresh_runs, mail_jobs, export_jobs 등)에 대한 집계 쿼리/뷰로 산출한다.

### Requirement 19: 웹페이지 주기적 자동 리렌더링 [v1.0] (기능 #26)

**User Story:** 사용자로서 모니터링 화면이 주기적으로 자동 갱신되기를 원한다, 그래야 수동 새로고침 없이 최신 상태를 볼 수 있기 때문이다.

#### Acceptance Criteria

1. WHEN 사용자가 자동 새로고침을 활성화한 경우, THE Frontend_App SHALL 환경 변수로 설정 가능한 간격(기본 60초)마다 현재 화면의 데이터를 Backend_API로부터 재조회한다.
2. WHEN 사용자가 자동 새로고침을 비활성화한 경우, THE Frontend_App SHALL 주기적 재조회를 중단한다.
3. THE Frontend_App SHALL 재조회 중에도 사용자의 현재 필터/스크롤 상태를 보존한다.

### Requirement 20: 기존 모니터링 대시보드 통합 [v1.1+] (기능 #27 전체)

**User Story:** 시스템 운영자로서 기존 KIRO에서 개발한 Power BI 새로고침 현황 대시보드 전체를 BIP에 통합하고 싶다, 그래야 모든 모니터링 자산을 단일 포털로 일원화할 수 있기 때문이다.

#### Acceptance Criteria

1. THE BIP SHALL `powerbi-refresh-monitor`의 분석/설정 화면을 포함한 전체 대시보드를 BIP 메뉴 체계에 통합한다.
2. THE BIP SHALL 통합 시 BIP의 인증/권한 체계를 일관되게 적용한다.

> 비고: "Refresh 실행 현황" 화면만 v1.0(Requirement 15)에 포함하며, 나머지 전체 통합은 v1.1+ 범위이다.

### Requirement 21: 화면 데이터 AI 분석 [v1.1+] (기능 #28)

**User Story:** 사용자로서 화면에 표출되는 데이터에 대한 AI 기반 분석/요약을 받고 싶다, 그래야 데이터 해석에 드는 시간을 줄일 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE AI 분석 기능이 활성화된 경우, THE Backend_API SHALL 화면에 표출된 데이터에 대한 AI 분석 결과를 생성하여 제공한다.
2. THE BIP SHALL AI 분석 요청 시 외부로 전송되는 데이터 범위와 보안 정책을 명시적으로 통제한다.

> 비고: AI 모델 선택, 데이터 전송 경계, 사내 보안 정책 준수는 v1.1+ design 단계에서 별도 검토한다.

## 2. 권한 요구사항 (Authorization Requirements)

### Requirement 22: 역할별 권한 경계 [v1.0]

**User Story:** 시스템 운영자로서 각 역할이 수행할 수 있는 작업이 명확히 통제되기를 원한다, 그래야 권한 오남용 없이 시스템을 운영할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 사용자가 General_User 역할만 보유한 경우, THE Backend_API SHALL 조회 권한이 부여된 Report 조회, 본인 정보 조회로 작업을 제한한다.
2. WHERE 사용자가 Super_User 역할을 보유한 경우, THE Backend_API SHALL General_User 권한에 더해 권한 보유 Dataset의 수동 새로고침을 허용한다.
3. WHERE 사용자가 System_Operator 역할을 보유한 경우, THE Backend_API SHALL 사용자/그룹/역할/권한/레포트/메일/모니터링 관리 작업을 허용한다.
4. THE Backend_API SHALL 다중 역할 보유 사용자에 대해 보유 역할들의 권한 합집합을 적용한다.

### Requirement 23: 모든 Backend API의 권한 재검증 [v1.0]

**User Story:** 시스템 운영자로서 화면 제어만이 아니라 서버에서 권한이 강제되기를 원한다, 그래야 API 직접 호출이나 화면 우회를 통한 무단 접근을 막을 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 모든 보호된 엔드포인트에서 요청자의 인증 상태와 권한을 서버 측에서 재검증한다.
2. THE BIP SHALL Frontend_App의 버튼/메뉴 숨김을 권한 통제의 유일한 수단으로 사용하지 않는다.
3. IF 요청자가 요청한 작업에 필요한 권한을 보유하지 않은 경우, THEN THE Backend_API SHALL 작업을 수행하지 않고 HTTP 403 응답을 반환한다.
4. IF 요청자가 인증되지 않은 경우, THEN THE Backend_API SHALL 보호된 엔드포인트에 대해 HTTP 401 응답을 반환한다.
5. WHEN 권한 검증으로 요청이 거부된 경우, THE Backend_API SHALL 거부된 요청(요청자, 대상 리소스, 작업)을 Audit_Log에 기록한다.

### Requirement 24: 데이터 수준 접근 통제 [v1.0]

**User Story:** 일반 사용자로서 권한이 없는 레포트나 데이터에 접근할 수 없기를 원한다(시스템 관점에서는 통제되어야 함), 그래야 권한 범위를 벗어난 정보 노출이 발생하지 않기 때문이다.

#### Acceptance Criteria

1. WHEN Backend_API가 Report 목록 또는 데이터를 반환하는 경우, THE Backend_API SHALL 요청자가 조회 권한을 보유한 리소스로 응답 범위를 제한한다.
2. WHEN Backend_API가 Embed_Token을 발급하는 경우, THE Backend_API SHALL 요청자가 권한을 보유한 Report에 한정된 토큰만 발급한다.
3. THE Backend_API SHALL 관리 기능(사용자/그룹/권한/메일 관리) 데이터를 System_Operator에게만 반환한다.

## 3. 비기능 요구사항 (Non-Functional Requirements)

### Requirement 25: 기술 스택 및 실행 환경 [v1.0]

**User Story:** 운영자(DevOps)로서 회사 표준 스택으로 전체 시스템을 단일 명령으로 기동하고 싶다, 그래야 일관된 환경에서 시스템을 재현할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL FastAPI, Python, Pydantic v2, SQLAlchemy 2.x async, Alembic, asyncpg, httpx, Pillow(메일 이미지 리사이즈) 스택으로 구현된다.
2. THE Frontend_App SHALL React 19, Vite 6, TypeScript, Node.js 20 LTS, Tailwind CSS v4 스택으로 구현된다.
3. THE BIP SHALL Docker Compose를 통해 Backend_API, Frontend_App, Worker, Scheduler, Redis 및 외부 PostgreSQL 연결을 포함한 전체 스택을 단일 정의로 기동한다.
4. THE BIP SHALL PostgreSQL 16 이상의 `bi_portal`(AWS RDS, 서울 리전)을 운영 원장 저장소로 사용한다.
5. THE BIP SHALL Redis 7을 cache, queue, lock 용도로만 사용하고 운영 원장 저장소로 사용하지 않는다.
6. THE BIP SHALL 내부망 전용으로 동작하도록 구성된다.
7. THE BIP SHALL `.env.example`과 한국어 `README.md`를 제공하여 환경 변수와 기동 절차를 문서화한다.

### Requirement 26: 일정 및 범위 제약 (Phasing) [v1.0]

**User Story:** 1인 개발자로서 12주, 주 4.5일 제약 안에서 인도 가능한 범위를 명확히 하고 싶다, 그래야 핵심 가치를 우선 인도하고 일정을 지킬 수 있기 때문이다.

#### Acceptance Criteria

1. THE BIP SHALL 기능을 v1.0 필수 범위와 v1.1+ 고도화 범위로 구분하여 인도한다.
2. THE BIP SHALL 기존 업체 솔루션 대체에 필수적인 기능(인사정보 DB 기반 로그인, 권한 관리, 레포트 조회, 새로고침 상태, 관리자 ID 수동 등록 및 PBIX Import 업로드, Export 메일 발송, 기본 운영 통계 대시보드, 운영 로그)을 v1.0 범위에 포함한다.
3. THE BIP SHALL 요청센터(기능 #22), 기존 대시보드 전체 통합(기능 #27), AI 분석(기능 #28), PBIX 완전 셀프 업로드 및 자동 검수(기능 #12/#29 고도화)를 v1.1+ 범위로, Embedded 용량 자동 스케일링을 v1.2 범위로 분리한다.
4. THE BIP SHALL 관리자의 PBIX Import API 기반 업로드(기능 #12/#29)를 v1.0 필수 범위에 포함한다(기존 업체 솔루션에서 운영 중인 기능).
5. THE BIP SHALL `powerbi-refresh-monitor`의 기존 자산(Backend 라우트, Celery Collector, React Gantt/타임테이블, PowerBI client/token service)을 재활용 가능한 경우 우선 사용하여 개발량을 절감하되, PRM 의존성이 핵심 기능 인도를 지연시키는 경우 Refresh History 수집(R14)·Refresh 실행 현황 화면(R15)을 v1.0 optional 또는 v1.1+로 분리하는 것을 검토한다.

### Requirement 27: 성능 및 가용성 [v1.0]

**User Story:** 사용자로서 포털이 반응성 있게 동작하기를 원한다, 그래야 운영 업무 중 대기 시간이 최소화되기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 조회 계열 `/api/*` 엔드포인트 응답을 캐시 hit 기준 200ms 이내, 캐시 miss + DB 조회 기준 1000ms 이내에 반환한다.
2. WHEN Power BI Export 또는 새로고침처럼 장기 실행되는 작업이 요청된 경우, THE Backend_API SHALL 작업을 Worker로 위임하고 즉시 접수 응답을 반환하여 요청 스레드를 차단하지 않는다.
3. THE Worker SHALL 단일 Workspace의 1회 Refresh_History 동기화 작업을 60초 이내에 완료한다(Power BI API 응답 시간 제외).

### Requirement 28: 가관측성 및 한국어화 [v1.0]

**User Story:** 운영자로서 시스템 동작을 추적하고 한국어 메시지를 받고 싶다, 그래야 장애 분석과 사용자 안내가 용이하기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 모든 외부 Power BI REST API 호출에 대해 호출 URL, HTTP 상태 코드, 소요 시간(ms)을 구조화 로그로 기록한다.
2. THE BIP SHALL Backend_API와 Frontend_App의 모든 사용자 노출 메시지를 한국어로 제공한다.
3. WHEN Backend_API 호출이 5xx 또는 네트워크 오류로 실패한 경우, THE Frontend_App SHALL 사람이 읽을 수 있는 한국어 오류 메시지와 재시도 수단을 표시한다.

## 4. 데이터 요구사항 (Data Requirements)

### Requirement 29: 원장 영속화 및 마이그레이션 [v1.0]

**User Story:** 운영자로서 모든 운영 데이터가 추적 가능한 스키마로 영속화되기를 원한다, 그래야 데이터 일관성과 변경 추적이 보장되기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 사용자, 역할, 그룹, 그룹원, 부서, 레포트, 레포트 권한, Refresh_Run, Refresh_Schedule, Mail_Schedule, Mail_Job, Export_Job, Report_Image_Path, Request_Center 요청, Audit_Log를 `bi_portal`의 정규화된 테이블로 영속화한다.
2. THE Backend_API SHALL Alembic을 사용하여 모든 스키마 변경을 마이그레이션 파일로 관리한다.
3. THE Backend_API SHALL 동일 Refresh_Run 식별자(`workspace_id`, `dataset_id`, `request_id` 조합)에 UNIQUE 제약을 적용한다.
4. THE Backend_API SHALL Redis에 저장되는 데이터(토큰 캐시, 작업 큐, 분산 락)를 휘발성으로 취급하고, 손실 시 원장(`bi_portal`)으로부터 복구 가능하도록 설계한다.

### Requirement 30: 시간 처리 [v1.0]

**User Story:** 사용자로서 Power BI가 UTC로 반환하는 시각을 한국 시간으로 보고 싶다, 그래야 별도 변환 없이 화면의 시각을 인지할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 모든 시각을 DB에 UTC(`timestamptz`)로 정규 저장한다(원장 기준 시간은 UTC). Power BI REST API가 반환한 시각도 UTC로 해석하여 저장한다.
2. THE Backend_API SHALL API 응답 시 `APP_TIMEZONE`(기본 `Asia/Seoul`) 기준으로 변환한 Local_Time(`*_local` 문자열)을 제공한다. (Gantt 성능을 위한 `refresh_runs`의 Local 사전 저장 컬럼은 UTC에서 파생된 표시용 예외이다.)
3. THE Frontend_App SHALL Backend_API가 제공한 Local_Time을 추가 변환 없이 표시한다.
4. THE Backend_API SHALL Audit_Log를 포함한 원장 테이블의 기준 시각을 UTC로 단일 저장하고, Local 표시값을 별도 정규 컬럼으로 중복 저장하지 않는다(refresh_runs 제외).

### Requirement 31: 데이터 보존 [v1.0]

**User Story:** 운영자로서 로그와 이력 데이터의 보존 범위가 통제되기를 원한다, 그래야 저장소 용량과 감사 요건을 동시에 만족할 수 있기 때문이다.

#### Acceptance Criteria

1. THE BIP SHALL Audit_Log, Mail_Job 이력, Export_Job 이력의 보존 기간을 설정 가능한 정책으로 관리한다.
2. THE BIP SHALL Report_Image_Path가 가리키는 이미지 파일의 저장 위치와 정리(cleanup) 정책을 정의한다.
3. THE BIP SHALL 저장된 레포트 이미지에 대한 기본 접근 경로로 (a) 메일 발송 시 본문 inline(CID) 첨부, (b) 권한 검증 다운로드 API를 사용하고, 권한 검증을 우회하는 정적 파일 서빙은 기본 비활성화하며 내부망 편의 옵션으로만 제공한다.

> 구현 메모: 보존 기간 기본값, 아카이브/삭제 방식, 이미지 파일 정리 주기, 정적 서빙 토글(`SERVE_REPORTIMAGE_STATIC`)은 design 문서에서 결정한다.

## 5. 연동 요구사항 (Integration Requirements)

### Requirement 32: Power BI 연동 [v1.0]

**User Story:** Backend 운영자로서 Power BI REST API와 안전하고 효율적으로 연동하고 싶다, 그래야 토큰 만료나 rate limit으로 인한 호출 실패를 줄일 수 있기 때문이다.

#### Acceptance Criteria

1. THE Token_Service SHALL Azure AD client credentials flow를 사용하여 Power BI access token을 발급하고 Redis에 캐싱한다.
2. WHEN PowerBI_Client가 유효한 캐시 토큰을 보유한 경우, THE Token_Service SHALL Azure AD 재호출 없이 캐시된 토큰을 반환한다.
3. IF Power BI REST API 호출이 HTTP 401을 반환한 경우, THEN THE PowerBI_Client SHALL 캐시된 토큰을 무효화하고 1회에 한해 재발급하여 재시도한다.
4. IF Power BI REST API가 HTTP 429(rate limit)를 반환한 경우, THEN THE PowerBI_Client SHALL `Retry-After` 값만큼 대기한 후 재시도한다.
5. THE PowerBI_Client SHALL Reports, Datasets, Refresh History, Refresh Schedule, Export to File, Refresh 트리거, Import(PBIX) 엔드포인트 호출을 Backend 또는 Worker에서만 수행한다.
6. THE BIP SHALL Power BI 연동 코드를 `powerbi-refresh-monitor`의 PowerBI client/token service 자산을 기반으로 구현한다.

### Requirement 33: 인사정보 DB 인증 연동 [v1.0]

**User Story:** 시스템 운영자로서 사내 인사정보 DB와 안정적으로 연동되기를 원한다, 그래야 별도 계정 체계 없이 사번/비밀번호로 BIP 인증을 처리할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `bi_portal`의 인사정보 뷰(`scl_v_insa_*`)를 읽기 전용으로 조회하여 사번(`emp_no`) 기반 인증과 사용자 프로필(이름/부서/직급/`cmp_email`) 매핑을 수행한다.
2. IF 인사정보 DB가 일시적으로 응답하지 않는 경우, THEN THE BIP SHALL Local_Admin 로그인 경로를 통한 운영 접근을 유지한다.
3. THE Backend_API SHALL 인사정보 뷰에 대해 INSERT/UPDATE/DELETE를 수행하지 않는다.

> 구현 메모: 인사 뷰 조인 키, SHA-256 3회 해시 규약(담당자 확인 대기), Job_Context(겸직) 선택 처리는 design 및 risk-and-decision-log 문서에서 결정한다(D-01).

### Requirement 34: 사내 메일 서버 연동 [v1.0]

**User Story:** 운영자로서 사내 메일 서버를 통해 정기 메일이 발송되기를 원한다, 그래야 기존 업체 솔루션의 메일 발송을 대체할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Mail_Service SHALL 사내 메일 서버(SMTP, 호스트/포트는 환경 변수 `SMTP_HOST`/`SMTP_PORT`로 주입, 기본 포트 587)를 통해 메일을 발송한다.
2. THE Mail_Service SHALL 인증 없이(사용자/비밀번호 없음) SMTP 발송을 수행하되, 호스트/포트/발신 주소/인증 사용 여부를 환경 변수로 구성 가능하게 한다.
3. WHEN 메일 발송이 성공한 경우, THE Mail_Service SHALL 발송 성공을 Mail_Job 로그에 기록한다.
4. IF 메일 발송이 실패한 경우, THEN THE Mail_Service SHALL 실패 사유를 Mail_Job 로그에 기록하고 재시도 정책에 따라 처리한다.

> 비고: 기존 업체 솔루션은 인증 없이 사내 SMTP 서버(포트 587)로 발송했다. 실제 호스트 주소는 문서에 명시하지 않고 `.env`에만 보관한다. 향후 인증/TLS가 필요해질 수 있으므로 `SMTP_USE_AUTH`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`를 옵션으로 둔다(기본 미인증).
> 구현 메모: 재시도/백오프 정책, 대용량 첨부/인라인 이미지 처리 방식은 design 문서에서 결정한다.

## 6. 운영/모니터링 요구사항 (Operations & Monitoring Requirements)

### Requirement 35: 감사 로그 [v1.0] (기능 #23)

**User Story:** 시스템 운영자로서 주요 운영 행위가 추적되기를 원한다, 그래야 보안 사고 조사와 운영 책임 추적이 가능하기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 다음 운영 행위를 Audit_Log에 기록한다.
   - 로그인(HR_Auth 사번 로그인/Local_Admin)
   - 레포트 열람(Embed_Token 발급)
   - 레포트 등록, 수정, 삭제, 공개범위(공개/비공개) 변경
   - Export_Job 실행
   - 메일 발송(Mail_Job)
   - Mail_Schedule 생성, 수정, 삭제
   - 권한 변경(Report_Permission, User_Role 부여/회수)
   - 그룹/그룹원 변경
   - 수동 새로고침 트리거
   - 관리자 설정 변경(시스템 설정, 사용자 상태, 보존 정책 등 운영 구성 변경)
   - Power BI REST API 호출 실패
2. THE Audit_Log SHALL 각 항목에 대해 행위 주체, 행위 종류, 대상 리소스, 발생 시각(UTC로 저장하고 API 응답 시 Local_Time으로 변환 제공), 결과(성공/실패)를 포함한다.
3. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL Audit_Log를 기간/주체/행위 종류로 필터링하여 조회하는 기능을 제공한다.
4. THE Backend_API SHALL Audit_Log에 시크릿 값(토큰, 비밀번호, client secret)을 기록하지 않는다.
5. WHEN Power BI REST API 호출이 4xx/5xx 또는 네트워크 오류로 실패한 경우, THE Backend_API SHALL 호출 대상 엔드포인트, HTTP 상태(또는 오류 유형), 발생 시각(Local_Time)을 시크릿 없이 Audit_Log에 기록한다.
6. WHEN 관리자(System_Operator)가 시스템 운영 설정을 변경한 경우, THE Backend_API SHALL 변경 대상, 변경 전/후 요약(시크릿 제외), 행위 주체를 Audit_Log에 기록한다.

### Requirement 36: 운영 상태 모니터링 [v1.0] (기능 #24)

**User Story:** 시스템 운영자로서 시스템 구성 요소의 상태를 모니터링하고 싶다, 그래야 장애를 조기에 인지할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL `GET /api/health`를 제공하고 시스템 가용 상태를 반환한다.
2. THE Backend_API SHALL DB 연결, Redis 연결, Worker 가용성, 최근 동기화/메일 작업 결과 등 운영 상태 지표를 조회하는 기능을 제공한다.
3. WHEN 정기 작업(동기화/메일/Export)이 실패한 경우, THE BIP SHALL 실패 사실을 운영 상태 화면에서 확인 가능하게 한다.

### Requirement 37: Job 중복 실행 방지 [v1.0]

**User Story:** 운영자로서 동일 작업이 중복 실행되지 않기를 원한다, 그래야 메일 중복 발송이나 데이터 경합이 발생하지 않기 때문이다.

#### Acceptance Criteria

1. WHILE 동일 키의 작업(Workspace 동기화, Mail_Job, Dataset 새로고침)이 실행 중인 동안, THE Worker SHALL Redis 기반 분산 락(`SET NX EX`)으로 중복 실행을 차단한다.
2. WHEN 분산 락을 보유한 작업이 정상 종료된 경우, THE Worker SHALL 자신이 획득한 락만 해제한다.
3. IF 락 보유 작업이 비정상 종료된 경우, THEN THE BIP SHALL 락 TTL 만료 후 후속 작업이 진입 가능하도록 보장하고, 데이터 정합성은 멱등(upsert) 처리로 유지한다.

## 7. 보안 요구사항 (Security Requirements)

### Requirement 38: 시크릿 비노출 [v1.0]

**User Story:** 보안 담당자로서 자격 증명과 토큰이 노출되지 않기를 원한다, 그래야 자격 증명 탈취로 인한 사고를 예방할 수 있기 때문이다.

#### Acceptance Criteria

1. THE BIP SHALL Power BI 자격 증명, master token, Embed_Token 발급 비밀, SMTP 자격 증명을 Frontend_App에 노출하지 않는다.
2. THE BIP SHALL 시크릿 환경 변수(`AZURE_CLIENT_SECRET`, SMTP 비밀번호 등)를 코드, 로그, API 응답 본문에 노출하지 않는다.
3. THE BIP SHALL 모든 Power BI API 호출, Embed_Token 발급, Export, Refresh 트리거를 Backend 또는 Worker에서만 수행한다.

### Requirement 39: 인증/세션 보안 [v1.0]

**User Story:** 보안 담당자로서 인증과 세션이 안전하게 관리되기를 원한다, 그래야 세션 탈취나 무단 접근을 방지할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 세션 또는 인증 토큰에 만료 시간을 적용한다.
2. WHEN 사용자가 로그아웃한 경우, THE Backend_API SHALL 해당 세션을 무효화한다.
3. THE Backend_API SHALL Local_Admin 자격 증명을 평문이 아닌 안전한 해시 형태로 저장한다.
4. IF 비정상적으로 반복된 로그인 실패가 감지된 경우, THEN THE Backend_API SHALL 해당 시도를 제한하고 Audit_Log에 기록한다.
5. THE Backend_API SHALL 일반 사용자(인사정보 인증)의 비밀번호 또는 그 해시를 BIP에 저장하지 않으며, 인사정보 뷰의 `login_pwd`는 읽기 전용 검증에만 사용한다.
6. THE Backend_API SHALL 인사정보 비밀번호 검증에 사용하는 SHA-256 3회 반복 방식을 레거시 검증 용도로만 사용하고, 신규 비밀번호 저장(예: Local_Admin)에는 적용하지 않는다(Requirement 39.3의 안전한 해시 사용).

> 비고: SHA-256 단순 반복은 신규 자격 증명 저장 방식으로 권장되지 않으나, 기존 인사정보 DB의 `login_pwd`와의 호환을 위해 검증 경로에서만 불가피하게 사용한다. 입력 비밀번호는 요청 처리 중 메모리에서만 사용하고 로그/응답/Audit_Log에 기록하지 않는다.

### Requirement 40: 입력 검증 및 파일 업로드 보안 [v1.0]

**User Story:** 보안 담당자로서 외부 입력과 업로드 파일이 검증되기를 원한다, 그래야 악성 입력으로 인한 사고를 예방할 수 있기 때문이다.

#### Acceptance Criteria

1. THE Backend_API SHALL 모든 외부 입력에 대해 형식과 범위를 검증하고, 검증 실패 시 HTTP 400 응답과 한국어 오류 메시지를 반환한다.
2. WHEN PBIX 파일이 업로드된 경우, THE Backend_API SHALL 파일 형식, 크기, 확장자를 검증한다.
3. THE Backend_API SHALL 데이터베이스 접근 시 파라미터 바인딩을 사용하여 SQL 인젝션을 방지한다.

> 구현 메모: 업로드 파일 격리/스캔, CSRF/CORS 정책, 내부망 전제하의 추가 보안 통제는 design 및 risk-and-decision-log 문서에서 결정한다.

### Requirement 41: 레포트 폴더/분류 체계 [v1.0] (기능 #11 확장)

**User Story:** 시스템 운영자로서 레포트를 계열사·팀·업무 영역 등 원하는 기준으로 폴더로 구분하여 등록·관리하고 싶다, 그래야 다수의 레포트를 조직 구조에 맞게 정리하고 사용자가 쉽게 탐색할 수 있기 때문이다.

#### Acceptance Criteria

1. WHERE 요청자가 System_Operator인 경우, THE Backend_API SHALL 레포트 폴더(Report_Folder)를 생성/수정/삭제하는 기능을 제공한다.
2. THE Backend_API SHALL Report_Folder가 부모 폴더를 가질 수 있는 자유 계층(트리) 구조를 지원하여 계열사 > 팀 > 업무 영역 등 임의 깊이의 분류를 허용한다.
3. WHEN 레포트가 등록되거나 PBIX가 업로드되는 경우, THE Backend_API SHALL 해당 레포트를 하나의 Report_Folder에 배치하고, 이후 다른 폴더로 이동하는 기능을 제공한다.
4. THE Frontend_App SHALL 폴더 트리를 사이드바/탐색 영역에 표시하고, 사용자가 폴더를 선택하면 해당 폴더(및 하위 폴더)에 속한, 사용자가 조회 권한을 보유한 레포트만 노출한다.
5. WHEN Report_Folder가 삭제되는 경우, IF 해당 폴더에 하위 폴더 또는 소속 레포트가 존재하는 경우, THEN THE Backend_API SHALL 삭제를 거부하고 HTTP 409 CONFLICT 응답을 반환한다. 레포트 자체(Power BI 원본)는 어떠한 경우에도 삭제하지 않는다.
6. THE Backend_API SHALL Report_Folder 생성/수정/삭제 및 레포트의 폴더 이동 행위를 Audit_Log에 기록한다.
7. THE Backend_API SHALL 레포트 접근 권한을 **폴더와 독립적으로 레포트 단위(Requirement 8)로** 판정하여, 동일 Report_Folder에 속한 레포트들이라도 서로 다른 권한을 가질 수 있도록 한다. 폴더 소속은 권한에 영향을 주지 않는다(분류/탐색 용도).

> 비고: 폴더는 BIP 내부의 분류/탐색 체계이며 Power BI 워크스페이스 구조와 독립이다. **권한 통제 단위는 항상 레포트(Requirement 8)이며 폴더 소속과 무관하다** — 같은 폴더 안에서도 레포트별로 다른 권한을 부여할 수 있다. 폴더 단위 일괄 권한 부여(여러 레포트에 한 번에 같은 권한을 적용하는 편의 기능)는 v1.1+ 또는 design 결정 사항으로 두며, 이 경우에도 최종 권한은 레포트 단위로 저장·판정한다.
> 구현 메모: 폴더 트리 표현(인접 리스트 vs 경로), 삭제 시 cascade/이동 규칙, 폴더-권한 연계(편의 기능) 여부는 design 문서에서 결정한다.

## 후속 문서에서 다룰 설계/결정 항목

본 requirements 문서는 "무엇을 보장해야 하는가"에 집중하며, 구체적 구현 방식과 기술 결정은 후속 문서로 위임한다. 사용자가 요구한 "중요 결정은 최소 2개 이상 대안 제시 및 장단점 비교, 추천안은 확정/추후 비교/PoC 후 결정으로 구분" 원칙은 design 및 risk-and-decision-log 문서에서 적용한다.

- **design.md**: 시스템 아키텍처, 모듈 구조, 데이터 모델(ERD), API 명세, `powerbi-refresh-monitor` 자산 재활용 통합 설계, 핵심 기술 결정 대안 비교표(인사정보 DB 인증, Embed Token 발급 방식, Export 파이프라인 구조, 메일 발송 방식, 락 설계 등), Correctness Properties, 테스트 전략.
- **risk-and-decision-log.md**: 보안/권한/Token/인증/메일/Job 중복실행/로그·감사 관련 리스크 식별, 결정 로그(확정 / 추후 비교 / PoC 후 결정 구분), v1.0/v1.1+ 범위 결정 근거.
- **tasks.md**: task 단위 구현 계획. v1.0 필수 범위 우선, 기존 자산 재활용 task 포함, 1인 12주 일정 제약 반영.
