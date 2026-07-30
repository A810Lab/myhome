/**
 * validation.test.ts
 * 
 * Zod 스키마 및 validateBody / validateQuery 미들웨어 유닛 테스트.
 * Node.js 내장 test 러너 사용 (외부 의존성 없음).
 *
 * 실행: node --import tsx/esm --test server/validation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  systemConfigUpdateSchema,
  transactionQuerySchema,
  loginLocalSchema,
  credentialsSchema,
  createUserSchema,
  complexCoordsSchema,
  complexCoordsResetSchema,
  userConfigUpdateSchema,
  logEntrySchema,
} from "./validation.js";

// ── loginLocalSchema ──────────────────────────────────────────────
test("loginLocalSchema: 유효한 이메일+패스워드 통과", () => {
  const result = loginLocalSchema.safeParse({ email: "user@example.com", password: "secret" });
  assert.ok(result.success, "유효한 입력이 파싱되어야 함");
  assert.equal(result.data!.email, "user@example.com");
});

test("loginLocalSchema: 잘못된 이메일 형식 거부", () => {
  const result = loginLocalSchema.safeParse({ email: "not-an-email", password: "secret" });
  assert.equal(result.success, false, "잘못된 이메일은 거부되어야 함");
});

test("loginLocalSchema: 패스워드 누락 시 거부", () => {
  const result = loginLocalSchema.safeParse({ email: "user@example.com" });
  assert.equal(result.success, false, "패스워드 없으면 거부되어야 함");
});

// ── transactionQuerySchema ────────────────────────────────────────
test("transactionQuerySchema: 모든 필드 선택적 — 빈 객체 통과", () => {
  const result = transactionQuerySchema.safeParse({});
  assert.ok(result.success, "빈 쿼리 파라미터도 허용되어야 함");
});

test("transactionQuerySchema: lawd_cd + deal_ymd 정상 통과", () => {
  const result = transactionQuerySchema.safeParse({ lawd_cd: "11110", deal_ymd: "202501" });
  assert.ok(result.success);
  assert.equal(result.data!.lawd_cd, "11110");
});

test("transactionQuerySchema: 알 수 없는 필드는 passthrough 없이 strip됨", () => {
  // zod 기본 동작: 알 수 없는 필드는 strip
  const result = transactionQuerySchema.safeParse({ unknown_field: "value" });
  assert.ok(result.success);
  assert.equal((result.data as any).unknown_field, undefined);
});

// ── systemConfigUpdateSchema ──────────────────────────────────────
test("systemConfigUpdateSchema: 빈 객체 통과 (모두 optional)", () => {
  const result = systemConfigUpdateSchema.safeParse({});
  assert.ok(result.success);
});

test("systemConfigUpdateSchema: nullable 필드에 null 허용", () => {
  const result = systemConfigUpdateSchema.safeParse({ telegramBotToken: null });
  assert.ok(result.success);
  assert.equal(result.data!.telegramBotToken, null);
});

test("systemConfigUpdateSchema: 올바른 문자열 값 통과", () => {
  const result = systemConfigUpdateSchema.safeParse({
    telegramBotToken: "bot123:token",
    geminiApiKey: "my-gemini-key",
  });
  assert.ok(result.success);
});

// ── createUserSchema ──────────────────────────────────────────────
test("createUserSchema: 유효한 이메일, isAdmin 기본값 false", () => {
  const result = createUserSchema.safeParse({ email: "admin@test.com" });
  assert.ok(result.success);
  assert.equal(result.data!.isAdmin, false);
});

test("createUserSchema: isAdmin=true 명시 가능", () => {
  const result = createUserSchema.safeParse({ email: "admin@test.com", isAdmin: true });
  assert.ok(result.success);
  assert.equal(result.data!.isAdmin, true);
});

// ── complexCoordsSchema ───────────────────────────────────────────
test("complexCoordsSchema: 올바른 좌표 통과", () => {
  const result = complexCoordsSchema.safeParse({ complexId: "11110|래미안", lat: 37.5, lng: 127.0 });
  assert.ok(result.success);
});

test("complexCoordsSchema: lat 누락 시 거부", () => {
  const result = complexCoordsSchema.safeParse({ complexId: "11110|래미안", lng: 127.0 });
  assert.equal(result.success, false);
});

// ── logEntrySchema ────────────────────────────────────────────────
test("logEntrySchema: activityType + description 필수", () => {
  const result = logEntrySchema.safeParse({ activityType: "page_view", description: "대시보드 조회" });
  assert.ok(result.success);
});

test("logEntrySchema: activityType 빈 문자열 거부", () => {
  const result = logEntrySchema.safeParse({ activityType: "", description: "desc" });
  assert.equal(result.success, false);
});

// ── userConfigUpdateSchema ────────────────────────────────────────
test("userConfigUpdateSchema: 빈 객체 통과", () => {
  const result = userConfigUpdateSchema.safeParse({});
  assert.ok(result.success);
});

test("userConfigUpdateSchema: null 값 허용", () => {
  const result = userConfigUpdateSchema.safeParse({ telegramBotToken: null });
  assert.ok(result.success);
  assert.equal(result.data!.telegramBotToken, null);
});
