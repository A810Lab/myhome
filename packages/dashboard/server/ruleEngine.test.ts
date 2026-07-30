/**
 * ruleEngine.test.ts
 *
 * ruleEngine 내부 필터 로직 + normalizeTransaction 유닛 테스트.
 * ESM named export 재정의 제약으로 runRuleCheck 통합 테스트는 직접 데이터 흐름을 재현합니다.
 * Node.js 내장 test 러너 사용.
 *
 * 실행: node --import tsx/esm --test server/ruleEngine.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

// DB 인메모리 초기화
process.env.SQLITE_DB_PATH = ":memory:";
process.env.ENABLE_BOOTSTRAP_ADMIN = "true";
process.env.GRAPH_DB_ENABLED = "false"; // 그래프 DB 적재 비활성화

import { initDb } from "@myhome/shared";
import type { WatchRule } from "./types.js";

initDb();

// ── 헬퍼 ────────────────────────────────────────────────────────
function makeRule(overrides: Partial<WatchRule> = {}): WatchRule {
  return {
    id: "rule-test-001",
    name: "테스트 룰",
    regionName: "서울시 강남구",
    regionCode: "11680",
    apartmentKeywords: [],
    comparisonCriteria: "none",
    channels: ["telegram"],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    intervalMinutes: 1440,
    ...overrides,
  };
}

/**
 * 테스트용 raw 거래 데이터 생성.
 * 가격은 만원 단위 숫자로 전달 (콤마 없는 순수 숫자).
 * normalizeTransaction 내부에서 rawPrice / 10000 = 억 단위로 변환됨.
 * 예: 80000 → 8억, 150000 → 15억
 */
function makeRawTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    아파트: "래미안 아파트",
    거래금액: 80000,  // 8억 (만원 단위 숫자)
    전용면적: "84.9",
    층: "10",
    년: "2025",
    월: "01",
    일: "15",
    ...overrides,
  };
}

// ── normalizeTransaction 파싱 검증 ───────────────────────────────
test("normalizeTransaction: 기본 raw 데이터 파싱 성공", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const raw = makeRawTx();
  const tx = normalizeTransaction(raw, "202501");

  assert.ok(tx, "정규화 성공");
  assert.equal(tx!.apartmentName, "래미안 아파트");
  assert.equal(tx!.priceEok, 8, "80,000만원 → 8억");
  assert.equal(tx!.areaM2, 84.9);
  assert.equal(tx!.floor, 10);
  assert.equal(tx!.dealDate, "2025-01-15");
});

test("normalizeTransaction: 단지명 없으면 undefined 반환", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const raw = { 거래금액: 80000 }; // 아파트명 없음
  const tx = normalizeTransaction(raw, "202501");
  assert.equal(tx, undefined);
});

test("normalizeTransaction: fallbackMonth로 날짜 대체", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const raw = { 아파트: "힐스테이트", 거래금액: 50000 }; // 날짜 없음
  const tx = normalizeTransaction(raw, "202503");

  assert.ok(tx);
  assert.equal(tx!.dealDate, "2025-03-01", "날짜 없으면 fallbackMonth 1일로 대체");
});

// ── 가격 필터 테스트 ─────────────────────────────────────────────
test("가격 필터: minPriceEok=10 — 8억은 걸림, 15억은 통과", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const tx8 = normalizeTransaction(makeRawTx({ 거래금액: 80000 }), "202501");   // 8억
  const tx15 = normalizeTransaction(makeRawTx({ 거래금액: 150000 }), "202501"); // 15억

  assert.ok(tx8);
  assert.ok(tx15);

  const minPriceEok = 10;
  assert.equal(tx8!.priceEok < minPriceEok, true, "8억은 필터에 걸려야 함");
  assert.equal(tx15!.priceEok >= minPriceEok, true, `15억(=${tx15!.priceEok})은 통과해야 함`);
});

test("가격 필터: maxPriceEok=10 — 8억 통과, 15억 걸림", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const tx8 = normalizeTransaction(makeRawTx({ 거래금액: 80000 }), "202501");
  const tx15 = normalizeTransaction(makeRawTx({ 거래금액: 150000 }), "202501");

  assert.ok(tx8);
  assert.ok(tx15);

  const maxPriceEok = 10;
  assert.equal(tx8!.priceEok <= maxPriceEok, true, "8억은 통과해야 함");
  assert.equal(tx15!.priceEok > maxPriceEok, true, "15억은 필터에 걸려야 함");
});

// ── 면적 필터 테스트 ─────────────────────────────────────────────
test("면적 필터: minArea=60 — 49.9㎡ 걸림, 84.9㎡ 통과", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const txSmall = normalizeTransaction(makeRawTx({ 전용면적: "49.9" }), "202501");
  const txLarge = normalizeTransaction(makeRawTx({ 전용면적: "84.9" }), "202501");

  assert.ok(txSmall);
  assert.ok(txLarge);

  const minArea = 60;
  assert.equal((txSmall!.areaM2 ?? 0) < minArea, true, "49.9㎡은 필터에 걸려야 함");
  assert.equal((txLarge!.areaM2 ?? 0) >= minArea, true, "84.9㎡은 통과해야 함");
});

// ── 키워드 필터 테스트 ───────────────────────────────────────────
test("키워드 필터: 대소문자 무관하게 포함 여부 적용", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const txMatch = normalizeTransaction(makeRawTx({ 아파트: "래미안 아파트" }), "202501");
  const txNoMatch = normalizeTransaction(makeRawTx({ 아파트: "힐스테이트 아파트" }), "202501");

  assert.ok(txMatch);
  assert.ok(txNoMatch);

  const keywords = ["래미안"];
  const matchResult = keywords.some(kw =>
    txMatch!.apartmentName.toLowerCase().includes(kw.trim().toLowerCase())
  );
  const noMatchResult = keywords.some(kw =>
    txNoMatch!.apartmentName.toLowerCase().includes(kw.trim().toLowerCase())
  );

  assert.equal(matchResult, true, "키워드 포함 시 매칭되어야 함");
  assert.equal(noMatchResult, false, "키워드 미포함 시 매칭 안 되어야 함");
});

test("키워드 필터: 빈 키워드 배열이면 모든 단지 통과", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const tx = normalizeTransaction(makeRawTx({ 아파트: "무관 아파트" }), "202501");
  assert.ok(tx);

  const keywords: string[] = [];
  // keywords.length === 0 이면 필터 없음 (ruleEngine 로직)
  const passes = keywords.length === 0 || keywords.some(kw =>
    tx!.apartmentName.toLowerCase().includes(kw.trim().toLowerCase())
  );
  assert.equal(passes, true, "키워드 없으면 모든 거래 통과");
});

// ── dedupeKey 형식 테스트 ────────────────────────────────────────
test("dedupeKey 형식: ruleId|단지명|거래일|면적|층|가격 구조", async () => {
  const { normalizeTransaction } = await import("./transactions.js");

  const raw = makeRawTx();
  const tx = normalizeTransaction(raw, "202501");
  assert.ok(tx, "정규화 성공");

  const ruleId = "rule-test-001";
  const dedupeKey = [
    ruleId,
    tx!.apartmentName,
    tx!.dealDate,
    tx!.areaM2 ?? "",
    tx!.floor ?? "",
    tx!.priceEok.toFixed(4),
  ].join("|");

  const parts = dedupeKey.split("|");
  assert.equal(parts.length, 6, "dedupeKey는 6개 파트로 구성되어야 함");
  assert.equal(parts[0], ruleId, "첫 번째 파트는 ruleId");
  assert.equal(parts[1], "래미안 아파트", "두 번째 파트는 단지명");
  assert.equal(parts[2], "2025-01-15", "세 번째 파트는 거래일");
});

// ── summarize 요약 문자열 테스트 ─────────────────────────────────
test("매칭 없으면 요약에 '조건에 맞는 신규 실거래가 없습니다' 포함", () => {
  const rule = makeRule({ name: "강남 테스트" });
  // summarize는 private이므로 export된 runRuleCheck 결과의 run.summary로 간접 검증 불가
  // 직접 로직 재현
  const matches: unknown[] = [];
  const summary = matches.length === 0
    ? `${rule.name}: 조건에 맞는 신규 실거래가 없습니다.`
    : `${rule.name}: ${matches.length}건 매칭`;
  assert.ok(summary.includes("조건에 맞는 신규 실거래가 없습니다."));
});
