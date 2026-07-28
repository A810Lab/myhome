# Apartment Alert & Analytics Dashboard

국토교통부 아파트 실거래가 오픈 API 및 PlayMCP `mcp-gateway`의 지역/단지 정보를 연동하여, 사용자가 저장한 감시 조건과 일치하는 실거래 결과를 Telegram 알림과 웹 대시보드를 통해 실시간으로 제공하고, 수집된 데이터를 SQLite 로컬 DB 기반으로 다차원 통계 분석하는 통합 아파트 실거래 모니터링 시스템입니다.

---

## 🚀 주요 특징 및 개선 사항 (v0.3.5)

* **지능형 로컬 DB 하이브리드 캐싱**: 
  * 국토부 OpenAPI 호출 트래픽을 아끼기 위해 3개월이 초과된 과거 고정 데이터는 SQLite DB에 적재된 내역이 있을 시 API 호출을 완전 생략(`Cache Hit`)하고 로컬에서 즉시 서빙(0.05초 내외)합니다.
  * 최근 3개월 데이터는 30일 실거래 신고 유예 규정을 반영해 API를 매번 호출(`Cache Miss/Refresh`)하여 최신 신고 건을 실시간으로 갱신 및 동기화합니다.
* **국토부 OpenAPI 직접 연동 및 배치 적재 최적화**: 
  * 10건 조회 한계가 있는 외부 MCP 서버를 우회하고 공공데이터포털 오픈 API를 직접 호출(`numOfRows=9999`)하여 한 달 전체 데이터를 누락 없이 수집합니다.
  * 수집 시 단일 트랜잭션 배치 업서트(`Batch Upsert`) 방식을 도입하여, HDD 및 Synology NAS 등 IOPS가 한정된 디스크 환경에서 디스크 동기화(`fsync`) 병목을 해결하고 데이터 적재 속도를 비약적으로 단축(수 분 ➔ 수 초)했습니다.
* **지역명 자동완성 및 주소 후보 축소 (Kakao Local API)**: 
  * 사용자가 입력한 검색어에 대해 여러 하위 후보 지역구/법정동을 중복 없이 드롭다운에 노출하고, 선택 시 정확한 5자리 지역코드(`LAWD_CD`)로 정밀 축소 매핑합니다.
  * 카카오 API 키가 설정되지 않았거나 호출 실패 시 MCP 및 로컬 매핑 데이터로 자동 폴백(Fallback)합니다.
* **지하철역 역세권 분석 (Nearby Station)**: 
  * 카카오 지도 API를 연동하여 특정 지하철역 검색 및 반경(300m, 500m, 1000m) 내 아파트 단지를 실시간으로 지도 위에 매핑합니다.
  * 로컬 DB에 수집된 단지("DB 단지")와 수집되지 않은 단지("라이브 단지")를 시각적으로 구분하고, 수집되지 않은 단지에 대해 "실거래 수집" 버튼을 통해 즉각적인 백엔드 실거래 수집 트리거를 지원합니다.
* **데이터베이스 웹 어드민 (Database Admin)**: 
  * 대시보드 내에서 로컬 DB에 직접 SQL 질의를 실행하고 결과를 조회할 수 있는 웹 SQL 콘솔을 탑재했습니다.
  * 단지 정보(위경도 좌표, 지번/도로명 주소, 총 세대수, 주차공간, 사용승인일 등) 관리 및 좌표 미매핑 단지 일괄 Geocoding 관리 기능, 카카오 지도를 활용한 수동 좌표 보정 툴(`CoordPickerMap`)을 제공합니다.
* **수집 현황 대시보드 (Collect Page)**: 
  * 날짜/월별 실거래 수집 건수 및 평균 평단가, 수집 단지 개수를 시계열 차트로 시각화합니다.
  * 특정 수집일을 클릭하면 해당 일자에 어느 지역에서 몇 건의 실거래가 적재되었는지 상세 현황을 드릴다운 형식으로 제공합니다.
* **사용자 맞춤형 UI 커스터마이징 & 다국어 (i18n)**: 
  * 주조색 테마(WDS Blue, Violet, Green), 글자 크기(12px~22px), 서체 종류(Noto Sans KR / Noto Serif KR)를 실시간으로 슬라이딩 전환할 수 있습니다.
  * 한국어 및 영어 다국어 번역 리소스 사전(`packages/dashboard/src/locales/ko.ts` 등)을 통해 모든 노출 텍스트가 다국어 번역으로 렌더링됩니다.
* **Recharts 시각화 및 Box Plot Y축 동적 스케일링**: 
  * 종합 현황 및 단지 상세 화면에서 면적 단위(평/㎡) 및 면적 구분(분양/전용) 실시간 변환 기능을 제공합니다.
  * 768px 분기에 따라 데스크톱의 `Underline 탭`과 모바일의 `Scrollable Pill 탭`으로 레이아웃이 자동 전환됩니다.
  * Box Plot 차트에서 Whisker/Box 레이어 토글에 맞춰 Y축의 가격 도메인이 최적의 높이로 조절(밀착)되는 투명 가이드 Line 설계가 적용되었습니다.
* **Google OAuth 2.0 및 이메일 화이트리스트 보안**: 
  * Google OAuth 2.0 로그인을 탑재하여 비인증 외부 사용자의 접근을 차단합니다.
  * `ALLOWED_EMAILS` 화이트리스트 접근 제어 및 세션 관리를 지원하며, 상세 사용자 활동(페이지 조회, 검색, 규칙 생성 등)에 대한 다국어 기반 활동 로그(`ActivityLogPage`)가 적재됩니다.
* **Docker화 및 CI/CD 자동 배포**: 
  * Synology Container Manager에서 Docker Compose를 통해 바로 기동할 수 있도록 Docker 설정이 완비되었으며, GitHub Actions를 통해 Release 시 이미지 빌드 및 자동 용량 정리 파이프라인(매주 월요일 10개 버전 제외 청소)을 지원합니다.

---

## 📚 개발 문서 및 가이드

이 프로젝트의 세부 아키텍처와 개발 규칙은 넘버링이 적용된 아래의 개발 문서를 참고하시기 바랍니다. AI 에이전트 및 개발자를 위한 전체 Sitemap과 진입 규칙은 [AGENTS.md](file:///e:/apps/myhome/AGENTS.md)에 상세히 정의되어 있습니다.

| 순번 | 개발/수정 부문 | 상세 개발 문서 |
|:---:|---|---|
| **01** | **프로젝트 전체 구조 & 핵심 패턴 파악** | [docs/01_OVERVIEW.md](file:///e:/apps/myhome/docs/01_OVERVIEW.md) |
| **02** | **국토부 OpenAPI 연동 & 실거래 캐싱 정책** | [docs/02_CACHE_POLICY.md](file:///e:/apps/myhome/docs/02_CACHE_POLICY.md) |
| **03** | **백엔드 Express 서버 & 자동 수집 스케줄러** | [docs/03_BACKEND_SCHEDULER.md](file:///e:/apps/myhome/docs/03_BACKEND_SCHEDULER.md) |
| **04** | **SQLite DB 스키마 & 집계 SQL 쿼리** | [docs/04_DATABASE.md](file:///e:/apps/myhome/docs/04_DATABASE.md) |
| **05** | **프론트엔드 UI, Recharts 차트, 반응형/i18n** | [docs/05_DESIGN.md](file:///e:/apps/myhome/docs/05_DESIGN.md) |
| **06** | **개발 진행 현황 & Phase별 로드맵** | [docs/06_ROADMAP.md](file:///e:/apps/myhome/docs/06_ROADMAP.md) |
| **07** | **지역 검색 및 주소 자동완성 기능** | [docs/07_REGION_SEARCH.md](file:///e:/apps/myhome/docs/07_REGION_SEARCH.md) |

---

## 🛠️ 기술 구성

* **Frontend**: React (v19), TypeScript, Vite, Tailwind CSS, Recharts
* **Backend**: Node.js (v24), TypeScript, Express, `tsx`
* **Database**: SQLite (Node.js 내장 `node:sqlite` 활용, `data/myhome.db` 파일 저장)
* **XML Parser**: `fast-xml-parser`
* **Maps SDK**: Kakao Maps SDK (비동기 동적 로드)
* **Data Sources**: 
  * 국토교통부 아파트매매 실거래 상세 자료 오픈 API (실거래가 수집)
  * Kakao Local API 및 행정안전부 도로명주소 오픈 API (지역명 검색, Geocoding 및 단지 좌표 수집)
  * PlayMCP `mcp-gateway` (자연어 NL 질의 전용 보조 연동)
* **Notification**: Telegram Bot API
* **LLM Integration**: Gemini API (분석 대시보드 내 AI 인사이트 자동화)

```text
         React Dashboard (Web) ◀────────────────────────┐
                 │                                      │ (Kakao Maps JS API)
                 ▼ (REST API)                           │
   Express Server + Scheduler ──▶ Telegram Bot          │
                 │                                      │
                 ├─▶ (Direct fetch) ──▶ 국토부 OpenAPI (실거래 데이터)
                 ├─▶ (Direct fetch) ──▶ 카카오 Local API / 행안부 JUSO (지오코딩/주소 자동완성)
                 ├─▶ (LLM SDK)       ──▶ Gemini API (AI 분석 인사이트 생성)
                 │
                 ▼ (Local storage)
         [SQLite (myhome.db)]
```

---

## 📂 디렉토리 구조

프로젝트는 `npm workspaces` 모노레포 구조로 설계되어 있습니다:

* [packages/shared](file:///e:/apps/myhome/packages/shared): SQLite 클라이언트 커넥션(`db.ts`), 공통 API 클라이언트(`apiClient.ts`), XML 파서(`xmlParser.ts`), 공통 TypeScript 타입정의(`types.ts`) 및 유틸리티 포함.
* [packages/collector](file:///e:/apps/myhome/packages/collector): 국토부 API 수집 코어 엔진. 수동 또는 백엔드 스케줄러에 연동되어 가동.
* [packages/dashboard](file:///e:/apps/myhome/packages/dashboard): React 프론트엔드와 Express 백엔드를 포함한 웹 서비스 패키지.
  * `server/`: Express 서버, 스케줄러(`scheduler.ts`), 룰 감시 엔진(`ruleEngine.ts`), 지오코딩 클라이언트, LLM API 클라이언트 탑재.
  * `src/`: React SPA 프론트엔드 코드. `pages/` 폴더에 대시보드 각 화면 탑재.

---

## 🔐 보안 및 로그인 (Google OAuth)

서비스 보안 및 외부 무단 접근을 방지하기 위해 Google OAuth 2.0 기반의 로그인 인증 체계가 구축되어 있습니다.
* **접근 제한 (Whitelist)**: 이메일 화이트리스트(`ALLOWED_EMAILS`) 제어가 포함되어 있습니다. 이 리스트가 비어있거나, 목록에 등록되지 않은 구글 계정으로 로그인할 경우 대시보드 접근이 전면 거부됩니다.
* **최초 구동 시 필수 조치**: 최초 서버를 띄우기 전 반드시 `.env` 파일에 `ALLOWED_EMAILS`를 최소 1개 이상 기입해 두어야 대시보드에 정상적으로 첫 진입을 할 수 있습니다.

---

## 📋 사전 준비

다음 환경 변수 및 사전 설정이 필요합니다.

1. **공공데이터포털(data.go.kr) 아파트매매 실거래 상세 자료 API 신청**:
   * API 신청 후 발급받은 일반 인증키를 준비합니다.
2. **Node.js 24 이상**:
   * 내장 SQLite 기능(`node:sqlite` `DatabaseSync`) 활성화를 위해 **Node.js v24** 이상 실행 환경이 필요합니다.
3. **카카오 Developers (developers.kakao.com) API 설정**:
   * 지역명 자동완성을 위한 **REST API 키**와 웹 지도 렌더링을 위한 **JavaScript 키**를 발급받아 준비합니다.

---

## ⚙️ 설정 주입 (.env 및 config.yaml)

### 1. 환경 변수 설정 (`.env`)
프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 다음 값들을 기입합니다.

```env
PORT=4174
CHECK_INTERVAL_SECONDS=300

# 공공데이터포털 국토부 실거래가 API 일반 인증키 (필수)
DATA_GO_KR_API_KEY=YOUR_PUBLIC_DATA_PORTAL_KEY

# 카카오 Local API REST 키 (지역명 자동완성 및 백엔드 지오코딩용)
KAKAO_REST_API_KEY=YOUR_KAKAO_REST_API_KEY

# 카카오 지도 JavaScript API 키 (웹 대시보드 지도 시각화용)
KAKAO_JAVASCRIPT_KEY=YOUR_KAKAO_JAVASCRIPT_KEY

# 행정안전부 도로명주소 오픈 API 승인키 (선택, 카카오 API 키 부재 시 대체)
JUSO_CONFM_KEY=YOUR_JUSO_CONFIRM_KEY

# Telegram 알림 설정 (선택)
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID

# SQLite 적재 사용 플래그
GRAPH_DB_ENABLED=true

# Gemini API 설정 (대시보드 내 AI 인사이트 생성용)
GEMINI_API_KEY=YOUR_GEMINI_API_KEY

# Google OAuth 2.0 로그인 설정 (보안 필수)
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:4174/api/auth/google/callback

# 대시보드 접근을 허용할 구글 이메일 목록 (쉼표로 구분하여 기재, 빈칸일 시 로그인 불가)
ALLOWED_EMAILS=user1@gmail.com,user2@gmail.com
```

### 2. YAML 설정 파일 (`config.yaml`)
포트 지정을 위해 `.env` 파일 외에도 루트 디렉토리의 `config.yaml` (또는 `config.yml`, `app.yaml`, `app.yml`)을 사용할 수 있습니다.
```yaml
port: 4174
```

---

## 📦 로컬 설치 및 실행

### 1. 의존성 설치
```powershell
npm install
```

### 2. 전체 빌드 (workspaces 순차 빌드)
```powershell
npm run build
```

### 3. 개발 서버 실행 (Frontend + Backend 동시 기동)
```powershell
npm run dev
```

* **웹 대시보드**: <http://127.0.0.1:5174> (Vite React Web)
* **Backend API**: <http://127.0.0.1:4174>

---

## 🐳 Docker 배포 (Synology Container Manager 및 일반 Docker)

단일 컨테이너로 빌드하여 배포하며, Express 백엔드가 빌드된 React 대시보드 정적 파일을 서빙합니다.

### 1. Synology Container Manager 배포 방법
1. Synology NAS **Container Manager**에서 **프로젝트** 탭 -> **생성**을 선택합니다.
2. `docker-compose.yml 작성`을 선택한 뒤, 프로젝트 루트의 [docker-compose.yml](file:///e:/apps/myhome/docker-compose.yml) 파일 내용을 복사해 붙여넣습니다.
3. 생성 시 설정 환경 변수에 필수 API 키 정보와 Telegram 챗 ID 정보를 입력하고 시작합니다.

### 2. Docker Compose로 로컬 기동
루트 경로에 `.env` 및 `docker-compose.yml`이 존재하는 상태에서 아래 명령을 실행합니다.
```bash
docker-compose up -d
```
* **대시보드 및 API 주소**: <http://localhost:4174>
* **데이터 보존**: SQLite 데이터베이스는 호스트의 `./data` 디렉토리에 볼륨 매핑되어 안전하게 유지됩니다.

---

## 📊 주요 API 라우팅

### 인증 및 보안 (Google OAuth)
| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/auth/google` | Google 로그인 페이지로 리디렉션 |
| `GET` | `/api/auth/google/callback` | Google OAuth 콜백 처리 및 세션 발급 |
| `GET` | `/api/auth/me` | 현재 사용자 세션 및 로그인 정보 조회 |
| `POST` | `/api/auth/logout` | 사용자 세션 만료 및 로그아웃 |

### 기본 규칙 및 모니터링 API
| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/health` | Backend 상태 확인 |
| `GET` | `/api/config` | 시스템 환경 설정 및 API 구성 상태 확인 |
| `GET` | `/api/rules` | 관심 알림 조건 목록 |
| `POST` | `/api/rules` | 관심 알림 조건 생성 |
| `PATCH` | `/api/rules/:id` | 관심 알림 조건 수정 및 상태 변경 |
| `POST` | `/api/rules/:id/run` | 관심 조건 즉시 수집 및 검사 실행 |
| `GET` | `/api/check-runs` | 수집 및 룰 매칭 이력 조회 |
| `GET` | `/api/notifications` | 발송된 알림 이력 |
| `GET` | `/api/regions/search` | 지역명 검색 자동완성 (Kakao Local 연동) |

### SQLite 실거래 분석 및 관리 API
| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/graph/stats` | SQLite DB 전체 레코드 통계 |
| `GET` | `/api/graph/db-regions` | DB에 등록된 수집 완료 지역 목록 |
| `GET` | `/api/graph/regions-summary` | DB 수집 지역별 요약 통계 |
| `POST` | `/api/graph/regions` | 신규 수집 대상 지역 추가 |
| `GET` | `/api/graph/complex/:name/trend` | 특정 단지의 월별 실거래 평단 단가 추이 |
| `GET` | `/api/graph/search` | 기간, 지역, 아파트명, 평수 필터 조합 검색 |
| `GET` | `/api/graph/drilldown/regions` | 시/도 레벨 실거래 통계 드릴다운 |
| `GET` | `/api/graph/drilldown/complexes` | 단지 레벨 실거래 통계 드릴다운 |
| `GET` | `/api/graph/drilldown/areas` | 평형대별 실거래 통계 드릴다운 |
| `GET` | `/api/graph/complex/:name/detail` | 단지 상세 (평수, 층별 통계 및 최근 10건 실거래) |
| `GET` | `/api/graph/context` | LLM 프롬프트 입력용 데이터 요약 텍스트 생성 |
| `GET` | `/api/graph/complex-geo` | 단지 위경도 좌표 목록 조회 |
| `POST` | `/api/graph/complex-geo` | 단지 위경도 좌표 업데이트 및 수동 보정 |
| `GET` | `/api/graph/collect-stats/daily` | 일별 실거래 수집 통계 조회 |
| `GET` | `/api/graph/collect-stats/monthly` | 월별 실거래 수집 통계 조회 |
| `GET` | `/api/graph/collect-stats/region` | 특정 수집일/월의 지역별 수집 상세 조회 |
| `GET` | `/api/graph/nearby-station` | 특정 지하철역 검색 및 반경 내 단지 조회 (역세권) |
| `POST` | `/api/graph/geocode-batch` | 좌표 미매핑 단지 일괄 Geocoding 수행 |
| `GET` | `/api/graph/geocode-stats` | Geocoding 좌표 매핑 진척률 통계 조회 |
| `POST` | `/api/graph/complexes/fetch` | 특정 단지의 실거래가 즉각 강제 수집 |
| `CRUD`| `/api/graph/presets` | 대시보드 필터 프리셋 관리 |
| `CRUD`| `/api/graph/insights` | AI 분석 인사이트 이력 관리 |
| `GET` | `/api/logs` | 사용자 활동 로그 목록 및 페이징 조회 |
| `GET` | `/api/logs/stats` | 활동 유형별 로그 통계 및 집계 조회 |
