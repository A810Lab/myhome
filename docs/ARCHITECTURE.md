# myhome 시스템 아키텍처 가이드 (ARCHITECTURE.md)

이 문서는 `myhome` 프로젝트의 전체적인 시스템 설계, 디렉토리 구조, 데이터 흐름 및 외부 인터페이스 사양을 종합적으로 기술하는 아키텍처 명세서입니다.

---

## 1. 시스템 개요 및 목적

`myhome` 프로젝트는 관심 지역의 아파트 실거래가(매매) 데이터를 수집, 분석, 관리하고, 사용자가 설정한 필터 조건(가격, 전용면적 등)에 맞는 실거래가 등록될 경우 실시간 또는 지정된 시간에 실시간 알림(Telegram)을 발송하는 경량 부동산 모니터링 허브입니다.

### 핵심 기능
- **데이터 자동 수집**: 국토교통부 OpenAPI와 연동하여 등록된 관심 지역의 최신 실거래 정보를 새벽(6시 이후)에 자동으로 다운로드하여 DB에 적재합니다.
- **알림 규칙 엔진**: 사용자가 설정한 단지별, 면적별, 가격 범위 조건을 기준으로 실거래가를 추적하고 텔레그램을 통해 즉시 알림을 발송합니다.
- **다차원 통계 대시보드**: 수집된 SQLite 실거래 데이터를 기반으로 평균 거래가, 거래량 분포(BoxPlot), 시계열 트렌드 및 역세권 반경 탐색을 분석할 수 있는 웹 프론트엔드를 제공합니다.

---

## 2. 전체 시스템 컴포넌트 아키텍처

`myhome`은 다음과 같은 3계층 컴포넌트 구성을 가집니다:

```mermaid
graph TD
    User([사용자 브라우저]) -->|HTTPS / WSS| FE[React Web App (packages/dashboard)]
    FE -->|API Request /api/v1/*| BE[Express Server (packages/dashboard/server)]
    
    subgraph Backend Services
        BE -->|Schedule Trigger| SCH[Scheduler (scheduler.ts)]
        BE -->|Rule Check| RE[Rule Engine (ruleEngine.ts)]
        SCH -->|Daily Sync| COL[Collector Bot (packages/collector)]
    end

    subgraph Data Layer
        BE -->|Read/Write| DB[(SQLite DB)]
        COL -->|Write Transactions| DB
        BE -->|Read/Write| LocalCache[In-Memory Cache]
    end

    subgraph External APIs
        COL -->|HTTP GET| MOLIT[국토교통부 OpenAPI]
        BE -->|HTTP GET| KAKAO[카카오 로컬/Geocoding API]
        RE -->|HTTP POST| TELEGRAM[텔레그램 봇 API]
    end
```

---

## 3. 모노레포 구조 및 레이어 설계

npm workspaces 기반의 모노레포 아키텍처를 적용하여 코드 재사용성과 유지보수성을 극대화하였습니다.

```
myhome/
├── packages/
│   ├── shared/                # 공통 데이터베이스 스키마 및 DB 유틸리티 패키지
│   │   ├── src/
│   │   │   ├── db.ts          # SQLite 초기화, 트랜잭션 적재 및 DDL 정의
│   │   │   └── index.ts       # Shared 패키지 엔트리 및 공통 함수 export
│   │   └── package.json
│   │
│   ├── collector/             # 국토부 OpenAPI 연동 및 백그라운드 수집 실행기
│   │   ├── src/
│   │   │   └── index.ts       # 실거래 수집 수동 실행용 스크립트
│   │   └── package.json
│   │
│   └── dashboard/             # 웹 관리 대시보드 (프론트엔드 React + 백엔드 Express)
│       ├── server/            # [백엔드] Express 웹서버 및 스케줄러
│       │   ├── authRoutes.ts  # 로그인/비밀번호 변경/세션/IP 차단/Google OTP 관리
│       │   ├── config.ts      # 환경변수 중앙화 및 필수 변수 검증
│       │   ├── geocoding.ts   # Geocoding Barrel 모듈 (utils, kakao, station, infra 재내보내기)
│       │   ├── index.ts       # 서버 엔트리 포인트, 포트 바인딩 및 v1 API 라우팅
│       │   ├── ruleEngine.ts  # 실거래 조건 감시 및 알림 발송 로직
│       │   └── scheduler.ts   # 룰 감시(5분) 및 새벽 데이터 수집(새벽 6시) 크론
│       │
│       ├── src/               # [프론트엔드] React SPA (Vite + TS)
│       │   ├── components/    # 재사용 가능 UI 컴포넌트
│       │   ├── lib/           # i18n, 표시설정 등 프론트엔드 유틸리티
│       │   ├── locales/       # 다국어 리소스 파일 (ko, en 번역본 통합 제공)
│       │   ├── pages/         # 화면 단위 컴포넌트 (Dashboard, Rules, Settings, Analytics 등)
│       │   ├── api.ts         # Backend API v1 호출 라이브러리
│       │   └── main.tsx       # 프론트엔드 진입점 및 LocaleProvider 래핑
│       └── package.json
```

---

## 4. 백엔드 아키텍처

Express 서버(`server/index.ts`)는 미들웨어 체인과 도메인별 라우터를 사용하여 수평 확장이 용이하도록 설계되었습니다.

### 4.1. 미들웨어 파이프라인
1. **보안 및 프록시 설정**: `trust proxy` 설정을 켜서 Nginx Reverse Proxy 환경 하에서도 클라이언트의 실제 IP 주소를 정확히 판별합니다.
2. **인증 미들웨어 (`authMiddleware`)**: 들어오는 API 요청의 쿠키 세션을 검증하고 로그인한 사용자의 정보를 컨텍스트에 설정합니다.
3. **권한 제어 미들웨어 (`adminRequired`)**: 관리자만 수행해야 하는 작업(계정 관리, DB 직접 쿼리 실행 등)에 대한 요청을 차단하고 403 Forbidden을 반환합니다.

### 4.2. 통합 스케줄러 (`scheduler.ts`)
- **실거래 룰 검사**: 300초(5분) 간격으로 기동하며 활성화 상태인 규칙(`rules`)을 검사합니다. 국토교통부 OpenAPI 게이트웨이의 과부하 및 트래픽 스로틀링을 방지하기 위해 `mcpThrottle` 직렬화 큐를 거쳐 순차적으로 안전하게 호출됩니다.
- **자동 수집 태스크**: 매일 새벽 6시 이후에 수집 대상 지역(`regions`) 목록 전체의 전일 실거래 데이터를 병렬 수집하여 SQLite DB에 안정적으로 적재합니다.

---

## 5. 데이터 아키텍처 및 캐시 정책

데이터 저장소는 경량 모노레포 구조에 걸맞게 SQLite 임베디드 데이터베이스와 메모리 캐시 레이어를 혼합하여 설계되었습니다.

### 5.1. SQLite 스키마 구성
`packages/shared/src/db.ts` 내에 선언된 주요 테이블 구조:
- `transactions`: 실거래 데이터 정보(단지명, 법정동코드, 거래금액, 전용면적, 층, 거래일 등)
- `watch_rules`: 사용자가 정의한 실거래 알림 감시 조건 규칙
- `check_runs`: 알림 감시 규칙의 실행 성공 여부, 매칭 건수 및 처리 로그 기록
- `notifications`: Telegram 발송 알림 이력 캐시 (중복 발송 방지용 dedupeKey 활용)
- `complex_coords`: 아파트 단지의 위경도 좌표 및 Geocoding 성공 여부 정보
- `users`: 시스템 사용자 계정 및 권한(Admin여부, 암호화 패스워드 등)

### 5.2. Geocoding 좌표 캐시 및 성능 최적화
카카오 로컬 API의 하루 호출 쿼터 제한을 절약하기 위해 **Lazy Geocoding 패턴**이 구현되어 있습니다:
1. 단지명에 대한 위경도 좌표가 필요한 경우, DB 내 `complex_coords` 테이블을 먼저 스캔합니다.
2. 캐싱된 정보가 없을 때에만 외부 카카오 API로 Geocoding 주소 변환을 수행합니다.
3. 변환에 성공하면 즉시 `complex_coords`에 캐싱하여 다음 호출 시 외부 API 통신 대기시간을 0ms로 단축시킵니다.
4. 실패 시 실패 사유(`reason`)를 영구 기록하고 임시 오류가 아닐 경우 API 호출을 재시도하지 않아 서버 자원을 보호합니다.

---

## 6. 프론트엔드 아키텍처

React SPA 프로젝트는 성능 향상과 모바일 퍼스트 레이아웃 대응을 위해 다음 디자인 원칙을 준수합니다.

### 6.1. 반응형 레이아웃 및 UX
- **반응형 뷰포트**: 390px 모바일 화면부터 데스크톱 4K 화면까지 UI 붕괴가 없는 반응형 플렉스/그리드 그리드를 지원합니다.
- **테마 시스템**: 브라우저의 기본 색상 설정을 감지하는 미디어 쿼리 및 사용자 지정 다크/라이트 테마 제어를 전역 HTML 클래스 바인딩을 통해 수행합니다.

### 6.2. 경량 i18n 구조 (`src/lib/i18n.ts`)
- 별도의 대형 외부 국제화 라이브러리에 의존하지 않고, React Context API와 `localStorage`를 직접 조합해 구현한 경량 언어 스위칭 엔진을 도입했습니다.
- `src/locales/ko.ts` 파일에서 한국어(`ko`)와 영어(`en`) 정적 리소스를 한눈에 관리하며, 언어 토글 시 전체 React 렌더 트리에 즉시 번역이 리로드됩니다.

---

## 7. 외부 연동 사양 및 API 버전 관리

### 7.1. API 경로 규격 (API Versioning)
서버는 하위 호환성을 유지하기 위해 듀얼 라우팅 구조를 취하고 있습니다:
- **v1 API 경로 (권장)**: `/api/v1/...`
- **Legacy API 경로**: `/api/...`
- 프론트엔드의 `api.ts` 라이브러리는 모든 API 요청 시 `request` 헬퍼 함수를 통해 자동으로 버전명이 포함된 `/api/v1/...` 종단점으로 요청이 도달하도록 주소를 정규화하여 전달합니다.

### 7.2. 연동 API 규격
1. **국토교통부 아파트 실거래가 조회 API**: `http://openapi.molit.go.kr` 연동. 트래픽 제한을 준수하기 위해 `mcpThrottle` 게이트웨이를 설계하여 요청을 지연/예외 복구합니다.
2. **카카오 로컬 API**: 키워드 및 주소 상세 검색을 통해 지하철역 및 단지의 위치 좌표를 추적합니다.
3. **Telegram Bot API**: `https://api.telegram.org/bot<Token>/sendMessage` 엔드포인트를 호출하여 알림을 전달합니다. 중복 방지를 위해 DB 단의 `dedupeKey`가 메시지의 중복 전송을 원천 차단합니다.
