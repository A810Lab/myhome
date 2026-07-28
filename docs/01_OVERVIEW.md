# [01] myhome 프로젝트 개요

> **아파트 알림 서비스 (Apartment Alert)** — 국토부 오픈 API 직접 호출 및 알림 자동화 + SQLite 실거래 분석 대시보드 (v0.3.0)

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 | Node.js (v24), Express, TypeScript |
| 프론트엔드 | React (v19) + TypeScript + Vite + Tailwind CSS |
| 로컬 DB | SQLite (Node.js 내장 `node:sqlite` 활용) |
| 시각화 | Recharts (시계열 차트 및 통계 분석) |
| 런타임 | `tsx` (Server), `Vite` (Web) |
| 빌드 | `npm run build` (workspaces 순차 빌드) |
| 실행 | `npm run dev` (Dashboard Backend/Frontend 동시 실행 + 수집 스케줄러 내장) |
| 외부 연동 | 국토부 아파트매매 실거래 상세 자료 API (실거래·지역코드·단지목록 단일 소스), Telegram Bot API, PlayMCP `mcp-gateway` (**자연어 NL 질의 전용** — Phase 8 이후 활성화 예정) |
| 배포 | Synology Container Manager (Docker Compose), Docker |
| CI/CD | GitHub Actions (Release 트리거 GHCR 이미지 생성 / 주간 10개 버전 자동 관리) |
| 패키지 관리 | npm workspaces (모노레포) |

## 디렉토리 구조

```
myhome/                            ← 모노레포 루트
├── package.json                   ← workspaces 정의
├── tsconfig.base.json             ← 공통 TS 설정
├── AGENTS.md / GEMINI.md          ← AI 에이전트 규칙
├── Dockerfile                     ← Docker 패키징 설정
├── docker-compose.yml             ← Synology / 로컬 배포용 템플릿
├── config.yaml                    ← 수동 가동 포트 지정 파일
├── .github/                       ← GitHub Actions 워크플로우 설정
│   └── workflows/
│       ├── docker-release.yml     ← 릴리즈 시 GHCR 빌드/푸시
│       └── cleanup-ghcr.yml       ← 매주 월요일 오래된 이미지 삭제 (10개 보존)
├── docs/                          ← 프로젝트 문서
│   ├── 01_OVERVIEW.md             ← 이 파일
│   ├── 02_CACHE_POLICY.md         ← 국토부 OpenAPI 연동 & 실거래 캐싱 정책
│   ├── 03_BACKEND_SCHEDULER.md    ← 백엔드 Express 서버 & 자동 수집 스케줄러
│   ├── 04_DATABASE.md             ← SQLite DB 스키마 & 집계 SQL 쿼리
│   ├── 05_DESIGN.md               ← 프론트엔드 UI, Recharts 차트, 반응형/i18n
│   ├── 06_ROADMAP.md              ← 개발 진행 현황 & Phase별 로드맵
│   ├── 07_REGION_SEARCH.md        ← 지역 검색 및 주소 자동완성 기능
│   ├── 08_RONE_API.md             ← 부동산원 OpenAPI 명세 및 호출 가이드
│   ├── 08-1_RONE_API_LIST.md      ← 부동산원 통계표 코드 목록
│   └── 08-2_RONE_API_REGION_CODE.md ← 부동산원 지역코드 마스터 목록
│
├── packages/
│   ├── shared/                    ← @myhome/shared 공통 모듈
│   │   └── src/
│   │       ├── index.ts           ← barrel export
│   │       ├── db.ts              ← SQLite 클라이언트 (테이블 초기화, 트랜잭션, SQL 집계 함수)
│   │       ├── apiClient.ts       ← 국토부 API 직접 fetch 및 정규화(normalizeTransaction)
│   │       ├── xmlParser.ts       ← fast-xml-parser 기반 공공데이터 XML 파서
│   │       ├── types.ts           ← 공통 타입 (TransactionNode, RegionInfo 등)
│   │       └── utils.ts           ← 유틸리티
│   │
│   ├── collector/                 ← @myhome/collector 데이터 수집 라이브러리
│   │   └── src/
│   │       ├── index.ts           ← 수집 엔트리 및 runCollector() export
│   │       └── fetcher.ts         ← @myhome/shared apiClient 재수출 (하위 호환)
│   │
│   └── dashboard/                 ← @myhome/dashboard 웹 대시보드
│       ├── vite.config.ts         ← Vite 설정
│       ├── index.html             ← HTML 엔트리
│       ├── server/                ← Express 백엔드
│       │   ├── index.ts           ← 서버 엔트리 + SQLite 초기화 연동
│       │   ├── routes.ts          ← 기본 REST API 라우팅 (rules, check-runs 등)
│       │   ├── routes-graph.ts    ← SQLite 실거래 분석 및 통계 API
│       │   ├── mcpClient.ts       ← 국토부 API 단일화 래퍼 (getApartmentPrices/getApartmentList), MCP는 자연어 NL 전용 예약
│       │   ├── scheduler.ts       ← 주기적 매물 룰 감시 + 매일 새벽 수집 스케줄러 통합
│       │   ├── ruleEngine.ts      ← 매물 매칭 + SQLite upsert
│       │   ├── storage.ts         ← JSON 파일 기반 상태 저장소 (Rules)
│       │   ├── graphPresets.ts    ← 조회 프리셋 CRUD
│       │   └── graphInsights.ts   ← LLM 인사이트 CRUD
│       └── src/                   ← React 프론트엔드
│           ├── main.tsx           ← 엔트리
│           ├── App.tsx            ← 메인 UI + 뷰 라우팅
│           ├── components/        ← 공통 컴포넌트
│           └── pages/             ← 페이지 컴포넌트
│               ├── Dashboard.tsx  ← 홈 대시보드
│               ├── ExploreV2.tsx  ← 실거래 탐색
│               └── GraphDashboard.tsx  ← 4탭 실거래 분석 메인 대시보드
```

## 핵심 구현 패턴

**모노레포 (npm workspaces)**:
- `@myhome/shared`: SQLite 커넥션, XML 파서, 국토부 API fetch, 공통 타입 공유. collector 및 dashboard 중복 코드 없이 재사용.
- `@myhome/collector`: 경량 수집 모듈. 대시보드 서버 내 라이브러리로 탑재 및 작동.
- `@myhome/dashboard`: Express 백엔드, React 프론트엔드 포함. 백엔드 가동 시 수집 스케줄러 연동 작동.

**백엔드 (Express)**:
- `scheduler.ts` 300초 간격 `ruleEngine` 구동, 텔레그램 알림 발송. 매일 새벽 6시 이후 1회 자동 `@myhome/collector` `runCollector` 호출, 로컬 SQLite DB 실거래 적재 파이프라인 가동.
- `routes-graph.ts` 로컬 SQLite DB 파일(`data/myhome.db`) SQL 집계 함수(`AVG`, `COUNT`, `Window Function` 등) 수행, 대시보드 분석 데이터 고속 제공.
- **국토부 API 및 DB 적재 특징**: 국토부 API 한계로 단지별 조회 시 백엔드에서 **해당 법정동/지역구(5자리 LAWD_CD) 전체 실거래 데이터 수집**. 수집 데이터 전체 DB 적재(Upsert), 동일 지역 타 단지 조회 성능 향상 및 통계 정확도 보장 최적화.

**프론트엔드 (React)**:
- Recharts 활용 시계열 차트, 층수 분포, 면적대별 분석 그래프 제공.
- **분석 대시보드 4탭**: 종합 현황, 단지별 분석, 드릴다운, 💡 AI 인사이트 구성.

---

## 작업 유형별 필독 파일

| 작업 유형 | 필독 파일 |
|-----------|-----------|
| 전체 로드맵·Phase 파악 | `docs/06_ROADMAP.md` |
| 국토부 API 캐싱 및 수집 정책 | `docs/02_CACHE_POLICY.md` |
| SQLite 클라이언트 / DDL / 집계 SQL | `packages/shared/src/db.ts` |
| 국토부 오픈 API 직접 호출 / 정규화 | `packages/shared/src/apiClient.ts` |
| XML 응답 파싱 유틸 | `packages/shared/src/xmlParser.ts` |
| 백엔드 스케줄러 및 자동 수집 제어 | `packages/dashboard/server/scheduler.ts` |
| 대시보드 분석 API 및 라우팅 | `packages/dashboard/server/routes-graph.ts` |
| 대시보드 분석 UI/UX 수정 | `packages/dashboard/src/pages/GraphDashboard.tsx` |
| 부동산원 API 명세 및 호출 가이드 | `docs/08_RONE_API.md` |
| 부동산원 통계표 코드 목록 | `docs/08-1_RONE_API_LIST.md` |
| 부동산원 지역코드 마스터 목록 | `docs/08-2_RONE_API_REGION_CODE.md` |




---

## 개발 현황 요약

- **Phase 1~6** (알림, 대시보드 기초) 완료 ✓
- **Phase 7A** (모노레포 전환 및 shared 추출) 완료 ✓
- **Phase 7B** (분석 대시보드 4탭 및 SQLite 집계 쿼리 연동) 완료 ✓
- **Phase 7C** (통합 수집 스케줄러 및 data/myhome.db 구축) 완료 ✓
- **Phase 7D** (Docker 컨테이너화 및 GitHub Actions CI/CD) 완료 ✓
- **Phase 7E** (국토부 API 단일화 + MCP 자연어 전용 분리 + UX 개선) 완료 ✓
- **Phase 8** (직접 LLM API 연동 및 인사이트 자동화) 계획 📋
- **Phase 9** (MCP 서버 - SQLite 데이터 노출 + 자연어 NL 질의 처리) 계획 📋
