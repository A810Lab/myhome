# myhome — Agent 진입점

## 필수 규칙
- 대화 한국어 진행.
- 모호 요청 임의 해석 금지, 확인 필수.
- 사용자 노출 문자열 항상 i18n 처리 (한국어/English).
- 프론트엔드 모바일 퍼스트 — 390px 모바일·태블릿·데스크톱 검증.
- 독립 가능 작업 subagent 병렬 진행.

## 안드레아 카파시(Andrej Karpathy)의 AI 협업 4대 원칙
1. **읽기 우선 (Read before write)**: 코드 작성·수정 전 기존 소스 동작·맥락 완벽 파악.
2. **작고 점진적인 변경 (Small, incremental changes)**: 방대 아키텍처 일괄 수정 금지, 빌드·동작 확인 가능 최소 단위 점진 수정.
3. **검증 및 테스트 우선 (Validate and Test)**: 수정 코드 정상 가동 검증 단위 테스트·실행 확인 절차 준수.
4. **제약 및 컨텍스트 준수 (Respect constraints)**: 정의 규칙·시스템 가이드 가두리 (Sitemap 및 개발문서) 범위 내 안전 수정.

## 읽기 순서
1. 이 파일 (완료)
2. [01_OVERVIEW.md](file:///e:/apps/myhome/docs/01_OVERVIEW.md) — 프로젝트 구조·기술 스택·핵심 패턴 (항상 읽기)
3. 아래 표 참조, 작업 수정 부문 맞춰 상세 개발문서 이동.

## 개발 부문별 상세 가이드 (Sitemap)

| 순번 | 개발/수정 부문 | 필독 개발문서 |
|---|---|---|
| 01 | **프로젝트 전체 구조 & 핵심 패턴 파악** | [docs/01_OVERVIEW.md](file:///e:/apps/myhome/docs/01_OVERVIEW.md) |
| 02 | **국토부 OpenAPI 연동 & 실거래 캐싱 정책** | [docs/02_CACHE_POLICY.md](file:///e:/apps/myhome/docs/02_CACHE_POLICY.md) |
| 03 | **백엔드 Express 서버 & 자동 수집 스케줄러** | [docs/03_BACKEND_SCHEDULER.md](file:///e:/apps/myhome/docs/03_BACKEND_SCHEDULER.md) |
| 04 | **SQLite DB 스키마 & 집계 SQL 쿼리** | [docs/04_DATABASE.md](file:///e:/apps/myhome/docs/04_DATABASE.md) |
| 05 | **프론트엔드 UI, Recharts 차트, 반응형/i18n** | [docs/05_DESIGN.md](file:///e:/apps/myhome/docs/05_DESIGN.md) |
| 06 | **개발 진행 현황 & Phase별 로드맵** | [docs/06_ROADMAP.md](file:///e:/apps/myhome/docs/06_ROADMAP.md) |
| 07 | **지역 검색 및 주소 자동완성 기능** | [docs/07_REGION_SEARCH.md](file:///e:/apps/myhome/docs/07_REGION_SEARCH.md) |
| 08 | **부동산원 OpenAPI 명세 및 호출 가이드** | [docs/08_RONE_API.md](file:///e:/apps/myhome/docs/08_RONE_API.md) |
| 08-1 | **부동산원 통계표 코드 목록** | [docs/08-1_RONE_API_LIST.md](file:///e:/apps/myhome/docs/08-1_RONE_API_LIST.md) |
| 08-2 | **부동산원 지역코드 마스터 목록** | [docs/08-2_RONE_API_REGION_CODE.md](file:///e:/apps/myhome/docs/08-2_RONE_API_REGION_CODE.md) |



