# [03] 백엔드 서버 & 알림 수집 스케줄러 (Backend & Scheduler)

Express 백엔드 서버, 매물 감시 룰 엔진 및 자동 수집 스케줄러 라이브러리 통합 동작 방식 설명.

---

## 1. 서버 엔트리 및 설정 주입
- **진입점**: `packages/dashboard/server/index.ts`
- **설정 주입**: `.env` 및 `config.yaml` 주입받음.
- **포트 지정 우선순위**:
  1. 시스템 환경 변수 (`process.env.PORT`)
  2. `.env` 파일 내 `PORT`
  3. `config.yaml` 파일 내 `port` (또는 `PORT`)
  4. 기본 포트 (`4174`)

---

## 2. 룰 엔진 (Rule Engine)
- **위치**: `packages/dashboard/server/ruleEngine.ts`
- **역할**: 사용자 지정 감시 조건(지역, 키워드, 최저/최고가 등) 바탕 신규 실거래 감지 여부 판별.
- **동작**:
  - `runRuleCheck()`: 지정 조건 실거래 국토부 API 즉시 조회, 조건 일치 매물 필터링.
  - 조건 충족 시 `notifications.ts` 경유 **Telegram 봇 알림** 즉시 발송.

---

## 3. 통합 스케줄러 (Scheduler)
- **위치**: `packages/dashboard/server/scheduler.ts`
- **역할**: 시스템 백그라운드 스케줄러 구동.
- **동작 주기**:
  1. **감시 스케줄러 (300초 간격)**: 등록 알림 조건(`rules`) 대상 `runRuleCheck` 실행, Telegram 알림 주기적 스캔.
  2. **자동 수집 스케줄러 (매일 1회)**: 매일 새벽 6시 이후 최초 구동 시 주요 지역 대상 `@myhome/collector` `runCollector` 수집기 백그라운드 작동, 로컬 SQLite DB 실거래 데이터 대량 적재.

---

## 4. 주요 환경변수 (Backend)

| 환경변수 | 기본값 | 설명 |
|----------|--------|------|
| `PORT` | `4174` | 서버 포트. `config.yaml`의 `port` 보다 우선. |
| `HOST` | `0.0.0.0` | 서버 바인드 주소. |
| `CHECK_INTERVAL_SECONDS` | `300` | 룰 감시 스케줄러 실행 간격(초). |
| `GRAPH_DB_ENABLED` | `true` | SQLite 실거래 DB 적재 스위치. `true`로 설정해야 `ruleEngine.ts`의 자동 수집(upsert)이 활성화됩니다. `false`이면 API 조회만 수행하고 DB에 저장하지 않습니다. |
| `GOOGLE_CLIENT_ID` | — | Google OAuth 클라이언트 ID. 미설정 시 Bootstrap Admin 모드가 필요합니다. |
| `ENABLE_BOOTSTRAP_ADMIN` | — | `true`로 설정 시 Google OAuth 미설정 환경에서 관리자 세션을 부여. **개발/테스트 전용.** |
| `TELEGRAM_BOT_TOKEN` | — | Telegram 알림 발송용 봇 토큰. |
| `TELEGRAM_CHAT_ID` | — | 알림 수신 Telegram 채팅 ID. |

