import { getDb } from "./connection.js";

/**
 * 데이터베이스 스키마 및 마이그레이션을 초기화합니다.
 */
export function initDb(): void {
  const db = getDb();
  
  // 테이블 정의
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      lawd_code TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS complexes (
      id TEXT PRIMARY KEY, -- 'lawd_code|complex_name'
      lawd_code TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lawd_code) REFERENCES regions(lawd_code),
      UNIQUE(lawd_code, name)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      dedupe_key TEXT PRIMARY KEY,
      complex_id TEXT NOT NULL,
      lawd_code TEXT NOT NULL,
      deal_date TEXT NOT NULL,
      price_eok REAL NOT NULL,
      area_m2 REAL,
      floor INTEGER,
      collected_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (complex_id) REFERENCES complexes(id)
    );

    CREATE TABLE IF NOT EXISTS region_apartment_cache (
      lawd_code TEXT NOT NULL,
      apartment_name TEXT NOT NULL,
      PRIMARY KEY (lawd_code, apartment_name)
    );

    CREATE TABLE IF NOT EXISTS region_apartment_cache_meta (
      lawd_code TEXT PRIMARY KEY,
      cached_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_deal_date ON transactions(deal_date);
    CREATE INDEX IF NOT EXISTS idx_transactions_complex_id ON transactions(complex_id);
    CREATE INDEX IF NOT EXISTS idx_complexes_lawd_code ON complexes(lawd_code);
    CREATE INDEX IF NOT EXISTS idx_region_apartment_cache_lawd_code ON region_apartment_cache(lawd_code);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      email TEXT PRIMARY KEY,
      telegram_bot_token TEXT,
      telegram_chat_id TEXT,
      kakao_rest_api_key TEXT,
      gemini_api_key TEXT,
      alerted_dedupe_keys TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      region_name TEXT NOT NULL,
      region_code TEXT,
      apartment_keywords TEXT,
      min_price_eok REAL,
      max_price_eok REAL,
      min_area REAL,
      max_area REAL,
      comparison_criteria TEXT NOT NULL,
      interval_minutes INTEGER NOT NULL,
      alert_time TEXT DEFAULT '09:00',
      channels TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES user_settings(email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_presets (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      filter_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES user_settings(email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_presets_overview (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      filter_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES user_settings(email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_presets_analysis (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      region_name TEXT NOT NULL,
      building_name TEXT NOT NULL,
      area_m2 REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES user_settings(email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS check_runs (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      matched INTEGER NOT NULL,
      summary TEXT NOT NULL,
      matches_data TEXT NOT NULL,
      source_limit_notice TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES user_settings(email) ON DELETE CASCADE,
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      dedupe_keys TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES user_settings(email) ON DELETE CASCADE,
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerted_transactions (
      user_email TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_email, rule_id, dedupe_key)
    );

    CREATE INDEX IF NOT EXISTS idx_alerted_transactions_created_at ON alerted_transactions(created_at);

    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      description TEXT NOT NULL,
      payload TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_email ON user_activity_logs(user_email);

    CREATE TABLE IF NOT EXISTS complex_area_mappings (
      complex_id TEXT NOT NULL,
      area_m2 REAL NOT NULL,
      supply_area_m2 REAL NOT NULL,
      source TEXT DEFAULT 'api',
      created_at TEXT NOT NULL,
      PRIMARY KEY (complex_id, area_m2),
      FOREIGN KEY (complex_id) REFERENCES complexes(id)
    );
    CREATE INDEX IF NOT EXISTS idx_complex_area_mappings_complex_id ON complex_area_mappings(complex_id);
  `);

  // -- complexes 테이블 주소·좌표 컬럼 마이그레이션 (기존 DB 호환)
  const complexCols = db.prepare("PRAGMA table_info(complexes)").all() as { name: string }[];
  const colNames = new Set(complexCols.map((c: any) => c.name));
  if (!colNames.has('dong_name')) db.exec('ALTER TABLE complexes ADD COLUMN dong_name TEXT');
  if (!colNames.has('jibun')) db.exec('ALTER TABLE complexes ADD COLUMN jibun TEXT');
  if (!colNames.has('road_name')) db.exec('ALTER TABLE complexes ADD COLUMN road_name TEXT');
  if (!colNames.has('lat')) db.exec('ALTER TABLE complexes ADD COLUMN lat REAL');
  if (!colNames.has('lng')) db.exec('ALTER TABLE complexes ADD COLUMN lng REAL');
  if (!colNames.has('geocoded_at')) db.exec('ALTER TABLE complexes ADD COLUMN geocoded_at TEXT');
  if (!colNames.has('geocode_failed')) db.exec('ALTER TABLE complexes ADD COLUMN geocode_failed INTEGER DEFAULT 0');
  if (!colNames.has('geocode_error')) db.exec('ALTER TABLE complexes ADD COLUMN geocode_error TEXT');
  if (!colNames.has('total_households')) db.exec('ALTER TABLE complexes ADD COLUMN total_households INTEGER');
  if (!colNames.has('total_parking')) db.exec('ALTER TABLE complexes ADD COLUMN total_parking REAL');
  if (!colNames.has('parking_per_household')) db.exec('ALTER TABLE complexes ADD COLUMN parking_per_household REAL');
  if (!colNames.has('use_approval_date')) db.exec('ALTER TABLE complexes ADD COLUMN use_approval_date TEXT');

  // 좌표 보유 단지 조회 성능 인덱스
  db.exec('CREATE INDEX IF NOT EXISTS idx_complexes_geocoded ON complexes(lat, lng) WHERE lat IS NOT NULL');

  // -- transactions 테이블 lawd_code 컬럼 마이그레이션 (기존 DB 호환)
  const txCols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  const txColNames = new Set(txCols.map((c: any) => c.name));
  if (!txColNames.has('lawd_code')) {
    db.exec('ALTER TABLE transactions ADD COLUMN lawd_code TEXT');
    db.exec(`UPDATE transactions SET lawd_code = substr(complex_id, 1, instr(complex_id, '|') - 1) WHERE lawd_code IS NULL`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_lawd_code_deal_date ON transactions(lawd_code, deal_date)');

  // -- user_settings 테이블 password_hash 컬럼 마이그레이션 (기존 DB 호환)
  const userSettingsCols = db.prepare("PRAGMA table_info(user_settings)").all() as { name: string }[];
  const userSettingsColNames = new Set(userSettingsCols.map((c: any) => c.name));
  if (!userSettingsColNames.has('password_hash')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN password_hash TEXT');
  }
  if (!userSettingsColNames.has('is_temporary_password')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN is_temporary_password INTEGER DEFAULT 0');
  }
  if (!userSettingsColNames.has('gemini_api_key')) {
    db.exec('ALTER TABLE user_settings ADD COLUMN gemini_api_key TEXT');
  }

  // -- sessions 테이블 login_method 컬럼 마이그레이션 (기존 DB 호환)
  const sessionsCols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const sessionsColNames = new Set(sessionsCols.map((c: any) => c.name));
  if (!sessionsColNames.has('login_method')) {
    db.exec('ALTER TABLE sessions ADD COLUMN login_method TEXT');
  }

  // -- rules 테이블 alert_time 컬럼 마이그레이션 (기존 DB 호환)
  const rulesCols = db.prepare("PRAGMA table_info(rules)").all() as { name: string }[];
  const rulesColNames = new Set(rulesCols.map((c: any) => c.name));
  if (!rulesColNames.has('alert_time')) {
    db.exec("ALTER TABLE rules ADD COLUMN alert_time TEXT DEFAULT '09:00'");
  }

  // Complexes/Regions 단지명 및 지역명 검색 성능 개선용 인덱스 추가
  db.exec('CREATE INDEX IF NOT EXISTS idx_complexes_lawd_name ON complexes(lawd_code, name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_regions_display_name ON regions(display_name)');

  // FTS5 (Full-Text Search) 가상 테이블 생성
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS complexes_fts USING fts5(
      name,
      lawd_code UNINDEXED,
      complex_id UNINDEXED,
      tokenize='unicode61'
    )
  `);

  // Complexes 자동 동기화용 SQL 트리거 구축
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_complexes_insert AFTER INSERT ON complexes BEGIN
      INSERT INTO complexes_fts(name, lawd_code, complex_id)
      VALUES(new.name, new.lawd_code, new.id);
    END;

    CREATE TRIGGER IF NOT EXISTS trg_complexes_delete AFTER DELETE ON complexes BEGIN
      DELETE FROM complexes_fts WHERE complex_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_complexes_update AFTER UPDATE ON complexes BEGIN
      UPDATE complexes_fts SET name = new.name WHERE complex_id = old.id;
    END;
  `);

  // 기존 Complexes 누적 데이터 FTS 가상 테이블 이관 마이그레이션
  db.exec(`
    INSERT INTO complexes_fts(name, lawd_code, complex_id)
    SELECT name, lawd_code, id FROM complexes
    WHERE NOT EXISTS (SELECT 1 FROM complexes_fts LIMIT 1)
  `);
}
