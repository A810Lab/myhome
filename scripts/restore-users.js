import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// DB 경로 찾기 (기본값: myhome/data/myhome.db)
let dbPath = join(__dirname, "..", "data", "myhome.db");
if (!existsSync(dbPath)) {
  dbPath = join(process.cwd(), "data", "myhome.db");
}

if (!existsSync(dbPath)) {
  console.error("❌ DB 파일을 찾을 수 없습니다. 경로:", dbPath);
  process.exit(1);
}

console.log("💾 DB 연결 중:", dbPath);
const db = new DatabaseSync(dbPath);

// pbkdf2 비밀번호 해시 함수 정의 (authRoutes.ts 와 호환)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

// 복구 대상에서 제외할 명백한 테스트용 가짜/더미 이메일 블랙리스트
const dummyBlacklist = new Set([
  "user1@gmail.com",
  "user2@gmail.com",
  "user@gmail.com",
  "admin@example.com",
  "user@example.com",
  "newuser@example.com",
  "test@example.com",
  "admin@test.com",
  "e2e@example.com",
  "noreply@deboox.com",
  "antony@antny-bot.github.io",
  "family@gmail.com",
  "myemail@gmail.com",
  "n@pytest.fixture",
  "n+@pytest.fixture",
  "bootstrap-admin@myhome.local",
  "anonymous"
]);

// 1. DB 내 user_activity_logs 테이블에서 고유 이메일 추출
let logs = [];
try {
  logs = db.prepare("SELECT DISTINCT user_email FROM user_activity_logs").all();
} catch (err) {
  console.error("❌ user_activity_logs 테이블 조회 실패:", err.message);
  process.exit(1);
}

const rawEmails = logs.map(r => r.user_email);
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const targetEmails = Array.from(new Set(
  rawEmails
    .map(e => e ? e.trim().toLowerCase() : "")
    .filter(e => e && emailRegex.test(e) && !dummyBlacklist.has(e))
));

// 필수 유지 계정 누락 방지 처리
const mandatoryEmails = ["heedong2@gmail.com", "macrolandkr@gmail.com"];
for (const email of mandatoryEmails) {
  if (!targetEmails.includes(email)) {
    targetEmails.push(email);
  }
}

console.log("🔍 복구 대상 실제 이메일 목록:", targetEmails);

const now = new Date().toISOString();
db.exec("BEGIN TRANSACTION");

try {
  // 2. system_config에서 기존 allowedEmails 조회
  const allowedRow = db.prepare("SELECT value FROM system_config WHERE key = 'allowedEmails'").get();
  let existingAllowed = allowedRow ? allowedRow.value.split(",").map(e => e.trim().toLowerCase()).filter(Boolean) : [];
  
  const tempPasswords = {};

  for (const email of targetEmails) {
    // allowedEmails에 없으면 추가
    if (!existingAllowed.includes(email)) {
      existingAllowed.push(email);
    }
    
    // user_settings 테이블에 해당 계정이 없다면 신규 임시 계정으로 생성
    const userRow = db.prepare("SELECT email FROM user_settings WHERE email = ?").get(email);
    if (!userRow) {
      const tempPassword = crypto.randomBytes(4).toString("hex");
      const passwordHash = hashPassword(tempPassword);
      tempPasswords[email] = tempPassword;

      db.prepare(`
        INSERT INTO user_settings (email, password_hash, is_temporary_password, alerted_dedupe_keys, updated_at)
        VALUES (?, ?, 1, '[]', ?)
      `).run(email, passwordHash, now);
    }
  }

  // 3. system_config 테이블 업데이트 (allowedEmails / adminEmails 동시 반영)
  const updatedAllowed = existingAllowed.join(",");
  db.prepare(`
    INSERT INTO system_config (key, value) VALUES ('allowedEmails', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(updatedAllowed);

  db.prepare(`
    INSERT INTO system_config (key, value) VALUES ('adminEmails', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(updatedAllowed);

  db.exec("COMMIT");
  console.log("\n✅ 성공적으로 계정 정보 복구를 마쳤습니다.");
  console.log("📋 최종 활성화 계정 목록:", existingAllowed);
  
  if (Object.keys(tempPasswords).length > 0) {
    console.log("\n🔑 [신규 등록된 계정 임시 비밀번호]");
    for (const [email, pass] of Object.entries(tempPasswords)) {
      console.log(`- ${email} : ${pass}`);
    }
    console.log("\n⚠️ 위 계정들은 최초 로그인 후 비밀번호를 재설정해야 합니다.");
  }
} catch (error) {
  db.exec("ROLLBACK");
  console.error("❌ 복구 작업 중 에러가 발생하여 롤백되었습니다.", error);
  process.exit(1);
}
