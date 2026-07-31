import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

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

// 보존 대상 계정 목록 (기본 관리자 계정 포함)
const keepEmails = [
  "heedong2@gmail.com",
  "macrolandkr@gmail.com",
  "bootstrap-admin@myhome.local"
];

const updateAllowedEmails = "heedong2@gmail.com,macrolandkr@gmail.com";

db.exec("BEGIN TRANSACTION");

try {
  // 1. system_config 테이블 업데이트 (allowedEmails / adminEmails 정리)
  db.prepare(`
    INSERT INTO system_config (key, value) VALUES ('allowedEmails', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(updateAllowedEmails);

  db.prepare(`
    INSERT INTO system_config (key, value) VALUES ('adminEmails', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(updateAllowedEmails);

  // 2. user_settings 테이블에서 보존 대상 제외한 계정 삭제
  const placeholders = keepEmails.map(() => "?").join(",");
  const deleteResult = db.prepare(`
    DELETE FROM user_settings 
    WHERE email NOT IN (${placeholders})
  `).run(...keepEmails);

  db.exec("COMMIT");
  console.log(`🧹 user_settings에서 불필요한 임시/더미 계정 ${deleteResult.changes}개를 삭제 완료했습니다.`);
  console.log("📋 최종 활성화 계정:", updateAllowedEmails.split(","));
} catch (error) {
  db.exec("ROLLBACK");
  console.error("❌ 정리 작업 진행 중 오류가 발생하여 롤백되었습니다.", error);
  process.exit(1);
}
