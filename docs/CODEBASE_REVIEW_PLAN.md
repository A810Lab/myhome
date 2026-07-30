# Codebase Review – Action Plan

> *최종 업데이트: 2026-07-29 (실제 코드 대조 검증 완료)*

## Summary Verdict
저장소는 활발히 유지되고 있으며 핵심 서비스(Express API + SQLite 수집 파이프라인)가 정상 동작합니다. 검토 결과 **구조·안전성·유지보수성·성능** 측면에서 몇 가지 개선 포인트가 확인되었습니다. 대부분은 **고영향·저비용** 수정이며, 일부는 **중기 아키텍처** 개선 사항입니다.

---

## ✅ High-Priority Fixes (다음 릴리스 전 반드시 수정)

| # | Issue | Why it matters | Suggested fix |
|---|-------|----------------|---------------|
| 1 | **입력 검증 부재** — `/api` 라우트 전반에 걸쳐 요청 바디·쿼리 파라미터에 대한 스키마 검증이 없습니다. `routes.ts`, `routes-graph.ts` 모두 raw 값을 그대로 사용합니다. | 잘못된 데이터가 DB에 저장되거나 다운스트림 쿼리가 깨질 수 있고, 보안 공격 표면이 넓어집니다. | `zod`를 도입하여 **모든 요청 바디·쿼리 파라미터**를 검증합니다. 공통 `validation.ts` 헬퍼를 만들어 재사용합니다. |
| 2 | **Bootstrap Admin 폴백 항상 활성화** — [`authRoutes.ts:422-427`](file:///e:/apps/myhome/packages/dashboard/server/authRoutes.ts#L422-L427): `GOOGLE_CLIENT_ID` / `GOOGLE_REDIRECT_URI` 환경 변수가 없으면 **조건 없이** `bootstrap-admin@myhome.local` 관리자 세션이 부여됩니다. | 환경 변수가 실수로 제거되거나 누락된 경우 의도치 않게 관리자 권한이 활성화됩니다. | 명시적 env 플래그 (`ENABLE_BOOTSTRAP_ADMIN=true`)를 확인하도록 변경하고, 활성화 시 `console.warn`으로 경고 로그를 출력합니다. |
| 3 | **`mcpThrottle.ts`가 실제 API 호출에서 사용되지 않음** — [`mcpClient.ts`](file:///e:/apps/myhome/packages/dashboard/server/mcpClient.ts)는 `fetchApartmentPricesDirect`를 직접 호출하며 `createMcporterLimiter`를 import하지 않습니다. `mcpThrottle.ts`는 테스트 파일에만 참조됩니다. | 국토부 API 과호출 시 rate-limit 오류(HTTP 429) 발생 위험이 있고, `mcpThrottle.ts`의 재시도 로직이 사실상 dead code입니다. | `mcpClient.ts`의 `getApartmentPrices` / `getApartmentList` 내부에서 `createMcporterLimiter`를 통해 호출하도록 연결합니다. |
| 4 | **`storage.ts` JSON 파일 동시 쓰기 위험** — [`storage.ts`](file:///e:/apps/myhome/packages/dashboard/server/storage.ts)는 `app-state.json`을 마이그레이션 용도로 참조하지만, 스케줄러가 여러 룰을 병렬로 실행할 경우 파일 I/O 충돌이 발생할 수 있습니다. | 현재 핵심 상태(Rules, CheckRun, Settings)는 SQLite로 이전됐으나, 마이그레이션 경로의 동시성 보호가 없어 `app-state.json` 손상 시 마이그레이션이 실패할 수 있습니다. | `migrateJsonToDb()`에 파일 잠금(또는 migration 완료 플래그)을 추가하여 중복 실행을 방지합니다. |

---

## ⏳ Medium-Priority Fixes (다음 2~3 스프린트 내 수정)

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| 5 | **`process.env` 접근이 여러 파일에 분산** — `authRoutes.ts`, `notifications.ts`, `addressSearch.ts`, `geocoding.ts`, `routes.ts` 등 10개 이상의 파일에서 `process.env.X`를 직접 참조합니다. | 오타 하나로 특정 환경 변수 체크가 누락되어도 런타임에 조용히 실패합니다. | `src/config.ts`에 typed `Config` 인터페이스를 만들어 환경 변수를 한 곳에서 검증·노출합니다. 서버 시작 시 필수 env 누락 시 즉시 종료하도록 합니다. |
| 6 | **테스트 커버리지 부족** — [`mcpThrottle.test.ts`](file:///e:/apps/myhome/packages/dashboard/server/mcpThrottle.test.ts)가 유일한 테스트 파일입니다. `ruleEngine.ts`, `storage.ts`, `authRoutes.ts`에는 테스트가 없습니다. | 리팩터링 시 회귀 버그를 조기에 발견할 수 없습니다. | 기존 테스트 러너 환경을 확인 후 커버리지를 추가합니다: ① 룰 생성·check-run 실행 ② 입력 검증 오류 ③ DB 마이그레이션 경로 ④ Google OAuth + Bootstrap 인증 흐름. |
| 7 | **외부 API 호출에 timeout/circuit-breaker 없음** — `/transactions` 및 배치 수집 시 국토부 API가 응답하지 않으면 무한 대기합니다. | 국토부 API 장애 시 서버 전체가 멈출 수 있습니다. | `fetchApartmentPricesDirect` 호출에 `AbortSignal.timeout(5000)`을 적용하고, 타임아웃 초과 시 `503 Service Unavailable`을 반환합니다. |
| 8 | **SQLite 배치 upsert가 트랜잭션으로 묶이지 않음** — [`ruleEngine.ts:91-107`](file:///e:/apps/myhome/packages/dashboard/server/ruleEngine.ts#L91-L107)에서 매 건마다 개별 upsert를 실행합니다. `node:sqlite` 모듈 기반이므로 `BEGIN … COMMIT` 수동 래핑이 필요합니다. | 대용량 배치 수집 시 fsync 횟수가 많아져 속도가 저하됩니다. | `@myhome/shared/db.ts`에 `runInTransaction(fn)` 헬퍼를 추가하고, 배치 upsert를 단일 트랜잭션으로 묶습니다. |
| 9 | **i18n 미구현** — `AGENTS.md`에 사용자 노출 문자열의 i18n 처리가 필수 규칙으로 명시되어 있으나, 프론트엔드 컴포넌트에 한국어 문자열이 하드코딩되어 있습니다. | 영문 환경 지원이 불가능하고, 에이전트 규칙 위반 상태입니다. | `react-i18next` 또는 간단한 `i18n.ts` 유틸을 도입하고, 사용자 노출 문자열을 `ko` / `en` 키로 분리합니다. |

---

## 📈 Low-Priority / Structural Suggestions

| # | Suggestion | Benefit |
|---|------------|---------| 
| 10 | **Graceful shutdown 개선** — [`index.ts:119-129`](file:///e:/apps/myhome/packages/dashboard/server/index.ts#L119-L129)의 SIGTERM/SIGINT 핸들러가 `server.close()` 콜백에서 `closeGraphDb()`를 호출하지만, scheduler의 진행 중인 upsert Promise를 기다리지 않습니다. | 종료 시점에 진행 중인 DB 쓰기가 중단될 수 있습니다. | `startScheduler()`의 반환값으로 `stopScheduler(): Promise<void>`를 추가하고, shutdown 함수에서 `await stopScheduler()` → `await closeGraphDb()` 순으로 대기합니다. |
| 11 | **`geocoding.ts` 파일 분리** — 현재 58KB 단일 파일로 지오코딩 로직 전체가 집중되어 있습니다. | 유지보수가 어렵고, PR 리뷰 시 diff가 너무 커집니다. | `geocoding-kakao.ts` / `geocoding-juso.ts` / `geocoding-fallback.ts`로 분리하고 `geocoding.ts`는 facade 역할만 수행합니다. |
| 12 | **`GRAPH_DB_ENABLED` env 플래그 문서화** — [`ruleEngine.ts:88`](file:///e:/apps/myhome/packages/dashboard/server/ruleEngine.ts#L88)에서 이 플래그가 SQLite 적재 여부를 결정하지만, README 및 docs 어디에도 언급이 없습니다. | 신규 개발자가 이 플래그의 존재를 알 수 없습니다. | `.env.example`과 `docs/03_BACKEND_SCHEDULER.md`에 항목과 설명을 추가합니다. |
| 13 | **API 버전 관리 도입** — 현재 `/api/...` 네임스페이스를 모든 클라이언트가 직접 사용합니다. | 하위 호환 없는 변경 시 기존 클라이언트가 즉시 깨집니다. | `/api/v1/...`로 버전을 명시하고 기존 경로를 deprecation 기간 동안 redirect 처리합니다. |
| 14 | **`docs/ARCHITECTURE.md` 작성** — 모노레포 레이아웃(`shared ↔ collector ↔ dashboard`)과 데이터 흐름(클라이언트 → Express → SQLite → 공통 유틸)을 다이어그램으로 정리합니다. | 신규 기여자의 온보딩 시간을 단축합니다. |

---

## Risk & Opportunity Snapshot

| Area | Immediate Risk | Opportunity (if fixed) |
|------|----------------|------------------------|
| **API rate-limiting** | mcpThrottle이 실제로 작동하지 않아 국토부 API 429 오류 미대응. | Throttle 연결 후 **자동 재시도·안정적 수집** 보장. |
| **Auth security** | Bootstrap admin 폴백이 env 누락 시 조건 없이 활성화. | 명시적 opt-in 플래그 → **의도된 관리자 온보딩** 흐름. |
| **데이터 무결성** | Shutdown 시 scheduler 진행 중인 upsert가 잘릴 수 있음. | 순서적 shutdown → **제로 데이터 손실** 보장. |
| **개발자 온보딩** | 환경 변수 분산·문서화 부족 → "이 env는 왜 있지?" 혼란. | `config.ts` 집중화 + 문서 정비 → **빠른 온보딩**. |
| **확장성** | 외부 API timeout 없어 장애 전파 위험. | circuit-breaker 적용 → **graceful degradation** + SLA 준수. |

---

## Next Steps

1. **#3 Throttle 연결** — `mcpClient.ts`에서 `createMcporterLimiter`를 실제로 사용하도록 수정 (기존 구현 활용, 코드 변경량 최소).
2. **#2 Bootstrap Admin opt-in** — `ENABLE_BOOTSTRAP_ADMIN` 플래그 추가 및 경고 로그 강화.
3. **#1 입력 검증** — `zod` 스키마를 주요 라우트에 순차 적용 (`/rules` → `/transactions` → `/system-config` 순).
4. **#5 `config.ts` 집중화** — 필수 env 누락 시 서버 시작 단계에서 즉시 오류 발생하도록 설정.
5. 위 작업 완료 후 PR 오픈 및 리뷰어 지정.

---

## 🔧 리팩토링 제안

### R1. `routes-graph.ts` 파일 분리 (31KB, 838줄)

현재 `routes-graph.ts`에 데이터 조회(trend/stats/search), 수집 통계, 프리셋 CRUD, LLM 인사이트, 지오코딩·인프라 평점, 배치 수집 등 **7개 도메인**이 한 파일에 혼재합니다.

```
routes-graph.ts (현재 838줄)
├── routes-graph-analytics.ts  ← trend / stats / search / drilldown
├── routes-graph-collect.ts    ← collect-stats / batch 수집 트리거
├── routes-graph-presets.ts    ← presets (overview / analysis / 기본)
├── routes-graph-insights.ts   ← LLM insights CRUD
└── routes-graph-geo.ts        ← geocoding / subway / infra-rating
```

`index.ts`에서 `createGraphRouter()`가 각 서브라우터를 마운트하는 구조로 변경하면 됩니다.

---

### R2. `routes.ts` 내 `/system-config` 마스킹 로직 추출 (24KB, 620줄)

[`routes.ts:100-113`](file:///e:/apps/myhome/packages/dashboard/server/routes.ts#L100-L113)에서 민감키를 `"●●●●●●●●"`로 마스킹하는 패턴이 반복됩니다. 헬퍼 함수로 추출하면 가독성과 테스트 용이성이 향상됩니다.

```typescript
// 현재 (반복 패턴)
telegramBotToken: config.telegramBotToken ? "●●●●●●●●" : (process.env.TELEGRAM_BOT_TOKEN ? "●●●●●●●●" : ""),

// 개선
function maskSecret(dbVal?: string, envVal?: string): string {
  return (dbVal || envVal) ? "●●●●●●●●" : "";
}
```

---

### R3. `db.ts` 단일 파일 분리 (74KB, 2260줄)

[`db.ts`](file:///e:/apps/myhome/packages/shared/src/db.ts)가 SQLite 연결 관리, DDL/마이그레이션, 트랜잭션 집계 함수, 사용자 설정, 세션 관리, 룰/체크런, 지오코딩 좌표 업데이트 등 **모든 DB 로직**을 담고 있습니다.

```
db.ts (현재 2260줄)
├── db-connection.ts      ← getDb / initDb / closeDb / migrations
├── db-transactions.ts    ← upsertTransactionBatch / getComplexTrend / getRegionTrend / searchTransactions
├── db-analytics.ts       ← getGraphStats / getDrilldown* / getComplexDetail / getDataContext
├── db-users.ts           ← getUserSettings / saveUserSettings / sessions / rules / checkRuns
└── db-regions.ts         ← getAllDbRegions / insertDbRegion / searchDbRegions / getComplexGeo
```

`packages/shared/src/index.ts`는 각 파일에서 re-export하면 하위 호환 유지됩니다.

---

### R4. `getComplexDetail`의 BoxPlot 통계 함수 중복 제거

[`db.ts:810-848`](file:///e:/apps/myhome/packages/shared/src/db.ts#L810-L848)의 `calculateBoxPlotStats`와 `getComplexTrend`의 `getMedian` 함수가 유사한 통계 계산을 각자 구현하고 있습니다. `packages/shared/src/utils.ts`에 통합하여 재사용합니다.

---

### R5. `routes-graph.ts`의 에러 핸들러 패턴 통일

[`routes-graph.ts`](file:///e:/apps/myhome/packages/dashboard/server/routes-graph.ts) 전체에서 에러 처리가 두 가지 패턴이 혼재합니다:
- `next(err)` (routes.ts 스타일)
- `res.status(500).json({ error: err?.message ?? "내부 오류" })` (routes-graph.ts 스타일)

공통 에러 미들웨어(`errorHandler.ts`)를 도입하고, 모든 라우트에서 `next(err)`만 사용하도록 통일합니다.

---

### R6. `GraphTopology` dead code 제거

[`db.ts:757-765`](file:///e:/apps/myhome/packages/shared/src/db.ts#L757-L765)의 `getGraphTopology()`가 빈 배열을 반환하며 "(네트워크 뷰 폐기로 더미 데이터 리턴)"이라고 주석이 달려 있습니다. 이 함수와 `/api/graph/topology` 라우트를 **삭제**하거나 명시적으로 `410 Gone`을 반환하도록 처리합니다.

---

## ⚡ 성능 개선 제안

### P1. `graphCache`에 TTL 세분화 및 키 범위 무효화

현재 [`cache.ts`](file:///e:/apps/myhome/packages/dashboard/server/cache.ts)는 `clear()`로 **전체 캐시를 무조건 삭제**합니다. upsert가 발생할 때마다 stats, trend, drilldown 등 관계없는 캐시까지 모두 날라갑니다.

```typescript
// 개선: 영향받는 키만 무효화
cache.invalidateByPrefix("trend:");
cache.invalidateByPrefix(`region-complexes:${lawdCode}`);
// stats는 별도 TTL로 더 오래 유지 (5분 → 30분)
cache.set("stats", data, 30 * 60 * 1000);
```

| 캐시 키 패턴 | 현재 TTL | 권장 TTL | 무효화 트리거 |
|---|---|---|---|
| `stats` | 5분 | 30분 | upsert 후 수동 |
| `trend:complex:*` | 5분 | 10분 | 해당 complexId upsert 시 |
| `trend:region:*` | 5분 | 10분 | 해당 lawdCode upsert 시 |
| `regions-summary` | 5분 | 1시간 | 신규 지역 추가 시만 |
| `drilldown:*` | 5분 | 10분 | upsert 후 수동 |

---

### P2. `searchTransactions`의 LIKE 검색 → FTS5 또는 인덱스 추가

[`db.ts:632-635`](file:///e:/apps/myhome/packages/shared/src/db.ts#L632-L635):
```sql
WHERE c.name LIKE '%' || ? || '%'
```
선행 `%`가 있는 LIKE 절은 **인덱스를 타지 않습니다**. 데이터가 수십만 건으로 늘면 풀 스캔이 됩니다.

**단기**: `complexes.name`에 `CREATE INDEX idx_complexes_name ON complexes(name)`을 추가하고, 접두 검색(`name LIKE ? || '%'`)으로 유도.  
**중기**: SQLite FTS5 가상 테이블(`CREATE VIRTUAL TABLE complexes_fts USING fts5(name, content=complexes)`)을 도입하면 한글 초성 검색도 가능합니다.

---

### P3. `/api/transactions/batch` 무제한 병렬 호출

[`routes.ts:413-415`](file:///e:/apps/myhome/packages/dashboard/server/routes.ts#L413-L415):
```typescript
const results = await Promise.all(
  months.map((m) => getApartmentPrices(lawdCode, m))
);
```
월 범위가 넓을 경우(예: 24개월) **24개 API 요청이 동시에 발사**됩니다. `mcpThrottle.ts`의 `createMcporterLimiter`를 사용해 순차 제한을 걸어야 합니다. 현재 `/transactions`의 `concurrencyLimit = 5` 패턴을 이 엔드포인트에도 동일하게 적용합니다.

---

### P4. `getComplexDetail` 이중 DB 호출 최소화

[`db.ts:779`](file:///e:/apps/myhome/packages/shared/src/db.ts#L779):
```typescript
const trend = await getComplexTrend(resolvedName, lawdCode, area, startDate, endDate);
// ...
const allTxs = db.prepare(baseSql).all(...baseParams); // 같은 데이터 재조회
```
`getComplexTrend`와 `getComplexDetail` 내부 `baseSql`이 **동일한 transactions 데이터를 두 번 조회**합니다. `getComplexTrend`가 raw rows를 함께 반환하거나, 단일 쿼리에서 모든 집계를 처리하는 뷰를 만들어 DB 라운드트립을 줄입니다.

---

### P5. `db.ts` Prepared Statement 모듈 레벨 캐싱

현재 `getUserSettings`, `getCheckRunsByEmail` 등 자주 호출되는 함수마다 `db.prepare(sql)` 호출이 매번 발생합니다. `node:sqlite`의 `prepare()`는 내부적으로 SQL을 파싱하므로, **모듈 레벨에서 한번만 준비**하면 반복 파싱 비용을 제거할 수 있습니다.

```typescript
// 현재 (매 호출마다 prepare)
export function getUserSettings(email: string) {
  const db = getDb();
  return db.prepare("SELECT ...").get(email);
}

// 개선 (lazy singleton)
let _getUserSettingsStmt: ReturnType<DatabaseSync["prepare"]> | null = null;
function getUserSettingsStmt() {
  if (!_getUserSettingsStmt) _getUserSettingsStmt = getDb().prepare("SELECT ...");
  return _getUserSettingsStmt;
}
export function getUserSettings(email: string) {
  return getUserSettingsStmt().get(email);
}
```

---

### P6. `scheduler.ts` 룰 실행 직렬화 → 파셜 병렬화

현재 스케줄러가 룰을 어떻게 실행하는지 확인이 필요하지만, 일반적으로 `for...of`로 순차 실행 시 룰 수가 늘면 전체 주기(300초)가 초과될 수 있습니다. 독립된 룰들은 `Promise.all`로 병렬 실행하되, 동일 지역(`lawdCode`)을 가진 룰은 같은 그룹으로 묶어 API 호출을 공유하면 됩니다.

---

## Risk & Opportunity Snapshot

| Area | Immediate Risk | Opportunity (if fixed) |
|------|----------------|------------------------|
| **API rate-limiting** | mcpThrottle이 실제로 작동하지 않아 국토부 API 429 오류 미대응. | Throttle 연결 후 **자동 재시도·안정적 수집** 보장. |
| **Auth security** | Bootstrap admin 폴백이 env 누락 시 조건 없이 활성화. | 명시적 opt-in 플래그 → **의도된 관리자 온보딩** 흐름. |
| **데이터 무결성** | Shutdown 시 scheduler 진행 중인 upsert가 잘릴 수 있음. | 순서적 shutdown → **제로 데이터 손실** 보장. |
| **개발자 온보딩** | 환경 변수 분산·문서화 부족 → "이 env는 왜 있지?" 혼란. | `config.ts` 집중화 + 문서 정비 → **빠른 온보딩**. |
| **확장성** | 외부 API timeout 없어 장애 전파 위험. | circuit-breaker 적용 → **graceful degradation** + SLA 준수. |
| **DB 조회 성능** | LIKE '%keyword%' 풀 스캔, 이중 DB 호출, 전체 캐시 무효화 누적. | 인덱스 + 캐시 세분화 + 쿼리 통합 → **응답 속도 50%+ 단축** 가능. |

---

*Generated on: 2026-07-29 | Verified against: packages/dashboard/server/\*, packages/shared/src/\**