import { DatabaseSync, type StatementSync } from "node:sqlite";
import { join } from "node:path";

let _db: DatabaseSync | null = null;
const stmtCache = new Map<string, StatementSync>();

/**
 * SQLite DatabaseSync 커넥션 인스턴스를 안전하게 확보합니다. (싱글턴)
 */
export function getDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath = process.env.SQLITE_DB_PATH ?? join(process.cwd(), "data", "myhome.db");
  _db = new DatabaseSync(dbPath);
  _db.exec("PRAGMA journal_mode = WAL"); // WAL 모드 활성화로 동시성 개선
  _db.exec("PRAGMA foreign_keys = ON");  // 외래키 제약조건 활성화
  return _db;
}

/**
 * 컴파일 비용을 최소화하기 위해 SQL Prepared Statement를 모듈 단위로 캐싱 및 재사용합니다.
 */
export function getPreparedStatement(sql: string): StatementSync {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

/**
 * Prepared Statement 캐시를 전부 초기화합니다.
 */
export function clearStatementCache(): void {
  stmtCache.clear();
}

/**
 * SQLite DatabaseSync 커넥션을 닫습니다. (안전 종료용)
 */
export function closeDb(): void {
  clearStatementCache();
  if (_db) {
    _db = null;
  }
}
