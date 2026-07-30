/**
 * storage.test.ts
 *
 * storage.ts 핵심 함수 유닛 테스트.
 * @myhome/shared의 initDb()를 인메모리 DB로 초기화하여 완전 격리.
 * Node.js 내장 test 러너 사용.
 *
 * 실행: node --import tsx/esm --test server/storage.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

// DB를 인메모리로 초기화 (파일 없이 테스트)
process.env.SQLITE_DB_PATH = ":memory:";
process.env.ENABLE_BOOTSTRAP_ADMIN = "true"; // bootstrap 모드로 인증 우회

import { initDb } from "@myhome/shared";

// storage 모듈은 DB 초기화 이후 로드해야 함
const { upsertRule, deleteRule, readStateForUser, appendCheckRun, updateRulePatch } =
  await import("./storage.js");

const TEST_EMAIL = "test@example.com";

function makeRule(overrides: Partial<Parameters<typeof upsertRule>[0]> = {}) {
  return {
    name: "테스트 룰",
    regionName: "서울시 강남구",
    regionCode: "11680",
    apartmentKeywords: ["래미안"],
    minPriceEok: 5,
    maxPriceEok: 20,
    comparisonCriteria: "none" as const,
    channels: ["telegram"] as ["telegram"],
    enabled: true,
    ...overrides,
  };
}

// DB 초기화
initDb();

// ── upsertRule ────────────────────────────────────────────────────
test("upsertRule: 룰이 생성되고 ID가 부여됨", async () => {
  const rule = await upsertRule(makeRule(), undefined, TEST_EMAIL);
  assert.ok(rule.id, "ID가 생성되어야 함");
  assert.equal(rule.name, "테스트 룰");
  assert.equal(rule.regionCode, "11680");
});

test("upsertRule: 동일 ID로 다시 호출하면 업데이트됨", async () => {
  const rule = await upsertRule(makeRule(), undefined, TEST_EMAIL);
  const updated = await upsertRule(makeRule({ name: "수정된 룰" }), rule.id, TEST_EMAIL);
  assert.equal(updated.id, rule.id, "ID가 유지되어야 함");
  assert.equal(updated.name, "수정된 룰");
});

// ── updateRulePatch ───────────────────────────────────────────────
test("updateRulePatch: 부분 업데이트가 적용됨", async () => {
  const rule = await upsertRule(makeRule({ name: "원본 룰" }), undefined, TEST_EMAIL);
  const patched = await updateRulePatch(rule.id, { enabled: false }, TEST_EMAIL);
  assert.ok(patched, "패치 결과가 반환되어야 함");
  assert.equal(patched!.enabled, false);
  assert.equal(patched!.name, "원본 룰", "변경하지 않은 필드는 유지되어야 함");
});

test("updateRulePatch: 존재하지 않는 ID → undefined 반환", async () => {
  const result = await updateRulePatch("nonexistent-id", { enabled: false }, TEST_EMAIL);
  assert.equal(result, undefined);
});

// ── deleteRule ────────────────────────────────────────────────────
test("deleteRule: 삭제 후 목록에서 제거됨", async () => {
  const rule = await upsertRule(makeRule({ name: "삭제될 룰" }), undefined, TEST_EMAIL);
  const deleted = await deleteRule(rule.id, TEST_EMAIL);
  assert.equal(deleted, true, "삭제 성공이어야 함");

  const state = await readStateForUser(TEST_EMAIL);
  const found = state.rules.find((r) => r.id === rule.id);
  assert.equal(found, undefined, "삭제된 룰이 목록에 없어야 함");
});

test("deleteRule: 존재하지 않는 ID → false 반환", async () => {
  const result = await deleteRule("nonexistent-id", TEST_EMAIL);
  assert.equal(result, false);
});

// ── appendCheckRun ────────────────────────────────────────────────
test("appendCheckRun: CheckRun이 저장되고 조회됨", async () => {
  const rule = await upsertRule(makeRule({ name: "체크런 테스트 룰" }), undefined, TEST_EMAIL);

  const run = {
    id: "test-run-001",
    ruleId: rule.id,
    ruleName: rule.name,
    matched: true,
    summary: "1건 매칭",
    matches: [],
    sourceLimitNotice: "",
    createdAt: new Date().toISOString(),
  };

  await appendCheckRun(run, ["dedupe-key-001"], TEST_EMAIL);

  const state = await readStateForUser(TEST_EMAIL);
  const savedRun = state.checkRuns.find((r) => r.id === "test-run-001");
  assert.ok(savedRun, "저장된 CheckRun을 찾을 수 있어야 함");
  assert.equal(savedRun!.ruleId, rule.id);
  assert.equal(savedRun!.matched, true);
});

// ── readStateForUser ──────────────────────────────────────────────
test("readStateForUser: rules / checkRuns 배열을 반환함", async () => {
  const state = await readStateForUser(TEST_EMAIL);
  assert.ok(Array.isArray(state.rules), "rules가 배열이어야 함");
  assert.ok(Array.isArray(state.checkRuns), "checkRuns가 배열이어야 함");
  assert.ok(Array.isArray(state.notifications), "notifications가 배열이어야 함");
});
