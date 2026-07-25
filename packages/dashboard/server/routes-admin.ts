import express from "express";
import { getDb } from "@myhome/shared";
import { graphCache } from "./cache.js";

export function createAdminRouter() {
  const router = express.Router();

  // 1. 테이블 목록 및 스키마 정보 조회
  router.get("/db/tables", (req, res, next) => {
    try {
      const db = getDb();
      const tablesRaw = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      const tables = tablesRaw.map((t) => t.name);

      const schemas: Record<string, any[]> = {};
      for (const table of tables) {
        const info = db.prepare(`PRAGMA table_info(${table})`).all();
        schemas[table] = info;
      }

      res.json({ tables, schemas });
    } catch (error) {
      next(error);
    }
  });

  // 2. 임의의 SQL 쿼리 실행
  router.post("/db/query", (req, res, next) => {
    try {
      const { sql } = req.body;
      if (!sql || typeof sql !== "string") {
        res.status(400).json({ error: "SQL 쿼리가 필요합니다." });
        return;
      }

      const db = getDb();
      const trimmed = sql.trim().toLowerCase();

      if (trimmed.startsWith("select") || trimmed.startsWith("pragma") || trimmed.startsWith("explain")) {
        const rows = db.prepare(sql).all();
        res.json({ type: "select", rows });
      } else {
        const stmt = db.prepare(sql);
        const result = stmt.run();
        graphCache.clear(); // 데이터 변경 쿼리 실행 시 캐시 초기화
        res.json({
          type: "write",
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid !== undefined ? String(result.lastInsertRowid) : undefined
        });
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // 3. 데이터베이스 전체 초기화
  router.post("/db/clear", (req, res, next) => {
    try {
      const db = getDb();
      db.prepare("PRAGMA foreign_keys = OFF").run();
      try {
        db.prepare("DELETE FROM transactions").run();
        db.prepare("DELETE FROM complexes").run();
        db.prepare("DELETE FROM regions").run();
        db.prepare("DELETE FROM region_apartment_cache").run();
        db.prepare("DELETE FROM region_apartment_cache_meta").run();
      } finally {
        db.prepare("PRAGMA foreign_keys = ON").run();
      }
      db.prepare("VACUUM").run();
      graphCache.clear(); // 전체 초기화 시 캐시 초기화
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 4. 특정 법정동(지역) 데이터 삭제
  router.post("/db/delete-region", (req, res, next) => {
    try {
      const { lawdCode } = req.body;
      if (!lawdCode || typeof lawdCode !== "string") {
        res.status(400).json({ error: "lawdCode가 필요합니다." });
        return;
      }

      const db = getDb();
      db.prepare("PRAGMA foreign_keys = OFF").run();
      try {
        db.prepare("DELETE FROM transactions WHERE complex_id IN (SELECT id FROM complexes WHERE lawd_code = ?)").run(lawdCode);
        db.prepare("DELETE FROM complexes WHERE lawd_code = ?").run(lawdCode);
        db.prepare("DELETE FROM regions WHERE lawd_code = ?").run(lawdCode);
        db.prepare("DELETE FROM region_apartment_cache WHERE lawd_code = ?").run(lawdCode);
        db.prepare("DELETE FROM region_apartment_cache_meta WHERE lawd_code = ?").run(lawdCode);
      } finally {
        db.prepare("PRAGMA foreign_keys = ON").run();
      }
      graphCache.clear(); // 특정 지역 데이터 삭제 시 캐시 초기화
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 5. 특정 아파트 단지 데이터 삭제
  router.post("/db/delete-complex", (req, res, next) => {
    try {
      const { complexName } = req.body;
      if (!complexName || typeof complexName !== "string") {
        res.status(400).json({ error: "complexName이 필요합니다." });
        return;
      }

      const db = getDb();
      db.prepare("PRAGMA foreign_keys = OFF").run();
      try {
        db.prepare("DELETE FROM transactions WHERE complex_id IN (SELECT id FROM complexes WHERE name = ?)").run(complexName);
        db.prepare("DELETE FROM complexes WHERE name = ?").run(complexName);
      } finally {
        db.prepare("PRAGMA foreign_keys = ON").run();
      }
      graphCache.clear(); // 특정 아파트 데이터 삭제 시 캐시 초기화
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
