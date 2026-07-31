import { DatabaseSync } from "node:sqlite";
import { TransactionNode, RegionInfo, TrendPoint, GraphStats, GraphFilter, GraphTopologyData, ComplexSearchResult, DailyCollectStat, RegionCollectStat, UserActivityLog } from "./types.js";
import { calculateBoxPlot } from "./stats.js";
import { getDb, closeDb, getPreparedStatement, clearStatementCache } from "./db/connection.js";
import { initDb } from "./db/schema.js";

export { getDb, initDb, closeDb, getPreparedStatement, clearStatementCache };

// 기존 closeGraphDb 호환용 래퍼
export async function closeGraphDb(): Promise<void> {
  closeDb();
}

/**
 * 실거래 식별 키 생성
 */
export function makeGraphDedupeKey(
  lawdCode: string,
  apartmentName: string,
  dealDate: string,
  areaM2: number | undefined,
  floor: number | undefined
): string {
  return [lawdCode, apartmentName, dealDate, areaM2 ?? "", floor ?? ""].join("|");
}

/**
 * 실거래 데이터 단건 Upsert (하위 호환 유지)
 */
export async function upsertTransaction(
  region: RegionInfo,
  complexName: string,
  tx: TransactionNode,
  addressInfo?: { dongName?: string; jibun?: string; roadName?: string }
): Promise<void> {
  return upsertTransactionBatch(region, [{ complexName, tx, addressInfo }]);
}

export type BatchUpsertItem = {
  complexName: string;
  tx: TransactionNode;
  addressInfo?: { dongName?: string; jibun?: string; roadName?: string };
};

/**
 * 실거래 데이터 배치 Upsert
 * 전체 records를 단일 트랜잭션으로 묶어 HDD 환경에서 fsync 횟수를 N→1회로 감소.
 * Synology 등 IOPS가 제한된 환경에서 수 분 → 수 초로 대폭 단축됨.
 */
export async function upsertTransactionBatch(
  region: RegionInfo,
  items: BatchUpsertItem[]
): Promise<void> {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();

  // Prepared statements를 루프 밖에서 1번만 생성 (성능 최적화)
  const regionStmt = db.prepare(`
    INSERT INTO regions (lawd_code, display_name, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(lawd_code) DO UPDATE SET display_name = excluded.display_name
  `);
  const complexStmt = db.prepare(`
    INSERT INTO complexes (id, lawd_code, name, created_at, dong_name, jibun, road_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      dong_name = COALESCE(excluded.dong_name, complexes.dong_name),
      jibun = COALESCE(excluded.jibun, complexes.jibun),
      road_name = COALESCE(excluded.road_name, complexes.road_name)
  `);
  const txStmt = db.prepare(`
    INSERT INTO transactions (dedupe_key, complex_id, lawd_code, deal_date, price_eok, area_m2, floor, collected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      price_eok = excluded.price_eok,
      updated_at = ?
  `);

  db.exec("BEGIN TRANSACTION");
  try {
    // region은 배치 전체에 공통 → 1번만 upsert
    regionStmt.run(region.lawdCode, region.displayName, now);

    for (const { complexName, tx, addressInfo } of items) {
      const complexId = `${region.lawdCode}|${complexName}`;

      complexStmt.run(
        complexId, region.lawdCode, complexName, now,
        addressInfo?.dongName ?? null,
        addressInfo?.jibun ?? null,
        addressInfo?.roadName ?? null
      );

      txStmt.run(
        tx.dedupeKey,
        complexId,
        region.lawdCode,
        tx.dealDate,
        tx.priceEok,
        tx.areaM2 ?? null,
        tx.floor ?? null,
        now,
        now  // updated_at
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * 전용면적 대비 분양면적 매핑 정보 Upsert
 */
export function upsertAreaMapping(
  complexId: string,
  areaM2: number,
  supplyAreaM2: number,
  source: string = "api"
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO complex_area_mappings (complex_id, area_m2, supply_area_m2, source, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(complex_id, area_m2) DO UPDATE SET
      supply_area_m2 = excluded.supply_area_m2,
      source = excluded.source,
      created_at = excluded.created_at
  `);
  stmt.run(complexId, areaM2, supplyAreaM2, source, now);
}

/**
 * 전용면적 대비 분양면적 매핑 정보 조회 (캐시 검사용)
 */
export function getAreaMapping(
  complexId: string,
  areaM2: number
): { supplyAreaM2: number; source: string } | null {
  const db = getDb();
  try {
    const stmt = db.prepare(`
      SELECT supply_area_m2 AS supplyAreaM2, source
      FROM complex_area_mappings
      WHERE complex_id = ? AND ABS(area_m2 - ?) < 0.01
    `);
    const row = stmt.get(complexId, areaM2) as any;
    if (row) {
      return {
        supplyAreaM2: Number(row.supplyAreaM2),
        source: String(row.source),
      };
    }
  } catch (err) {
    console.error("[SQLiteDB] getAreaMapping error", err);
  }
  return null;
}

/**
 * 검색 단지명 유연 해석
 */
function resolveComplexName(db: DatabaseSync, complexName: string, lawdCode?: string): string {
  if (!complexName.trim()) return complexName;
  try {
    // 1. 정확히 일치하는 단지가 있는지 검사
    const exactQuery = db.prepare(`
      SELECT name FROM complexes
      WHERE name = ? ${lawdCode ? "AND lawd_code = ?" : ""}
      LIMIT 1
    `);
    const exactRow = lawdCode ? exactQuery.get(complexName, lawdCode) : exactQuery.get(complexName);
    if (exactRow) {
      return (exactRow as any).name;
    }

    // 2. 부분 일치하는 단지 중 실거래가 가장 많은 단지 1개 매칭
    const fuzzyQuery = db.prepare(`
      SELECT c.name, COUNT(t.dedupe_key) AS cnt
      FROM complexes c
      JOIN transactions t ON c.id = t.complex_id
      WHERE c.name LIKE '%' || ? || '%' ${lawdCode ? "AND c.lawd_code = ?" : ""}
      GROUP BY c.name
      ORDER BY cnt DESC
      LIMIT 1
    `);
    const fuzzyRow = lawdCode ? fuzzyQuery.get(complexName, lawdCode) : fuzzyQuery.get(complexName);
    if (fuzzyRow) {
      return (fuzzyRow as any).name;
    }
  } catch (err) {
    console.error("[SQLiteDB] resolveComplexName error", err);
  }
  return complexName;
}

/**
 * 특정 단지의 월별 평균 실거래가 추이
 */
export async function getComplexTrend(
  complexName: string,
  lawdCode?: string,
  area?: number,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const db = getDb();
  const resolvedName = resolveComplexName(db, complexName, lawdCode);

  // 1. 해당 단지의 전체 월별 실거래 가격 및 평형 목록 가져오기
  let sql = `
    SELECT substr(t.deal_date, 1, 7) AS month,
           t.price_eok               AS priceEok,
           t.area_m2                 AS areaM2,
           m.supply_area_m2          AS supplyAreaM2
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    LEFT JOIN complex_area_mappings m ON t.complex_id = m.complex_id AND ROUND(t.area_m2, 2) = ROUND(m.area_m2, 2)
    WHERE c.name = ?
  `;
  const params: any[] = [resolvedName];
  if (lawdCode) {
    sql += " AND c.lawd_code = ?";
    params.push(lawdCode);
  }
  if (area !== undefined && area !== null) {
    sql += " AND CAST(ROUND(t.area_m2) AS INTEGER) = ?";
    params.push(area);
  }
  if (startDate) {
    sql += " AND substr(t.deal_date, 1, 7) >= ?";
    params.push(startDate);
  }
  if (endDate) {
    sql += " AND substr(t.deal_date, 1, 7) <= ?";
    params.push(endDate);
  }
  sql += " ORDER BY month ASC";

  const rows = db.prepare(sql).all(...params) as { month: string; priceEok: number; areaM2: number; supplyAreaM2: number | null }[];

  // 월별 가격 그룹화
  const monthlyGroups = new Map<string, { prices: number[]; sizePrices: Map<string, number[]> }>();
  for (const row of rows) {
    let group = monthlyGroups.get(row.month);
    if (!group) {
      group = { prices: [], sizePrices: new Map() };
      monthlyGroups.set(row.month, group);
    }
    group.prices.push(row.priceEok);

    const dedicatedLabel = `${Math.round(row.areaM2)}㎡`;
    const supplyM2 = row.supplyAreaM2 || (row.areaM2 / 0.78);
    const supplyLabel = `${Math.round(supplyM2)}㎡(공급)`;

    // 전용면적 그룹
    let dedPrices = group.sizePrices.get(dedicatedLabel);
    if (!dedPrices) {
      dedPrices = [];
      group.sizePrices.set(dedicatedLabel, dedPrices);
    }
    dedPrices.push(row.priceEok);

    // 공급면적 그룹
    let supPrices = group.sizePrices.get(supplyLabel);
    if (!supPrices) {
      supPrices = [];
      group.sizePrices.set(supplyLabel, supPrices);
    }
    supPrices.push(row.priceEok);
  }

  // 중위값 계산 헬퍼 함수
  function getMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 데이터 생성
  const trend: any[] = [];
  for (const [month, data] of monthlyGroups.entries()) {
    const prices = data.prices;
    const count = prices.length;
    const maxVal = Math.max(...prices);
    const minVal = Math.min(...prices);
    const sumVal = prices.reduce((sum, p) => sum + p, 0);
    const avgVal = sumVal / count;
    const medVal = getMedian(prices);

    const point: Record<string, any> = {
      month,
      거래량: count,
      최대가: Number(maxVal.toFixed(2)),
      최소가: Number(minVal.toFixed(2)),
      평균가: Number(avgVal.toFixed(2)),
      중위값: Number(medVal.toFixed(2)),
      overall: Number(avgVal.toFixed(2)) // 하위 호환용 전체 평균
    };

    // 평수별 평균가 (하위 호환용)
    for (const [areaName, aPrices] of data.sizePrices.entries()) {
      const aSum = aPrices.reduce((sum, p) => sum + p, 0);
      point[areaName] = Number((aSum / aPrices.length).toFixed(2));
    }

    trend.push(point);
  }

  return trend.sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 특정 지역의 월별 평균 실거래가 추이
 */
export async function getRegionTrend(
  lawdCode: string
): Promise<TrendPoint[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT substr(t.deal_date, 1, 7) AS month,
           AVG(t.price_eok)          AS avgPriceEok,
           COUNT(*)                  AS cnt
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    WHERE c.lawd_code = ?
    GROUP BY month
    ORDER BY month
  `).all(lawdCode);

  return rows.map((r: any) => ({
    month: r.month,
    avgPriceEok: r.avgPriceEok,
    count: r.cnt,
  }));
}

/**
 * 전체 데이터베이스 통계
 */
export async function getGraphStats(): Promise<GraphStats> {
  const db = getDb();
  const regions = (db.prepare("SELECT COUNT(*) AS count FROM regions").get() as any).count;
  const complexes = (db.prepare("SELECT COUNT(*) AS count FROM complexes").get() as any).count;
  const transactions = (db.prepare("SELECT COUNT(*) AS count FROM transactions").get() as any).count;

  return { regions, complexes, transactions };
}

/**
 * 다중 필터 조합 검색
 */
export async function searchTransactions(filter: GraphFilter): Promise<any[]> {
  const db = getDb();
  
  let queryStr = `
    SELECT r.display_name AS regionName, r.lawd_code AS lawdCode, c.name AS apartmentName,
           t.deal_date AS dealDate, t.price_eok AS priceEok, t.area_m2 AS areaM2,
           m.supply_area_m2 AS supplyAreaM2, t.floor AS floor, t.dedupe_key AS dedupeKey
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    JOIN regions r ON c.lawd_code = r.lawd_code
    LEFT JOIN complex_area_mappings m ON t.complex_id = m.complex_id AND ROUND(t.area_m2, 2) = ROUND(m.area_m2, 2)
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filter.lawdCodes && filter.lawdCodes.length > 0) {
    const placeholders = filter.lawdCodes.map(() => "?").join(",");
    queryStr += ` AND r.lawd_code IN (${placeholders})`;
    params.push(...filter.lawdCodes);
  } else if (filter.lawdCode) {
    queryStr += " AND r.lawd_code LIKE ? || '%'";
    params.push(filter.lawdCode);
  }
  if (filter.complexName) {
    queryStr += " AND c.name LIKE '%' || ? || '%'";
    params.push(filter.complexName);
  }
  if (filter.startDate) {
    queryStr += " AND substr(t.deal_date, 1, 7) >= ?";
    params.push(filter.startDate);
  }
  if (filter.endDate) {
    queryStr += " AND substr(t.deal_date, 1, 7) <= ?";
    params.push(filter.endDate);
  }
  if (filter.minArea !== undefined && filter.minArea !== null) {
    queryStr += " AND t.area_m2 >= ?";
    params.push(filter.minArea);
  }
  if (filter.maxArea !== undefined && filter.maxArea !== null) {
    queryStr += " AND t.area_m2 <= ?";
    params.push(filter.maxArea);
  }

  queryStr += " ORDER BY t.deal_date DESC";

  const rows = db.prepare(queryStr).all(...params);
  return rows.map((r: any) => ({
    regionName: r.regionName,
    lawdCode: r.lawdCode,
    apartmentName: r.apartmentName,
    dealDate: r.dealDate,
    priceEok: r.priceEok,
    areaM2: r.areaM2,
    supplyAreaM2: r.supplyAreaM2,
    floor: r.floor,
    dedupeKey: r.dedupeKey,
  }));
}

/**
 * 드릴다운: 시/도 레벨 집계
 */
export async function getDrilldownRegions(complexName?: string): Promise<any[]> {
  const db = getDb();
  let query = `
    SELECT r.lawd_code AS code, r.display_name AS name,
           COUNT(t.dedupe_key) AS count, AVG(t.price_eok) AS avgPriceEok
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    JOIN regions r ON c.lawd_code = r.lawd_code
  `;
  const params: any[] = [];
  if (complexName) {
    query += ` WHERE c.name LIKE ?`;
    params.push(`%${complexName}%`);
  }
  query += `
    GROUP BY r.lawd_code, r.display_name
    ORDER BY r.display_name
  `;

  const rows = db.prepare(query).all(...params);

  return rows.map((r: any) => ({
    code: r.code,
    name: r.name,
    count: r.count,
    avgPriceEok: Number(r.avgPriceEok.toFixed(2)),
  }));
}

/**
 * 드릴다운: 특정 지역의 아파트 단지별 집계
 */
export async function getDrilldownComplexes(lawdCode: string, complexName?: string): Promise<any[]> {
  const db = getDb();
  let query = `
    SELECT c.name AS name, COUNT(t.dedupe_key) AS count, AVG(t.price_eok) AS avgPriceEok
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    WHERE c.lawd_code = ?
  `;
  const params: any[] = [lawdCode];
  if (complexName) {
    query += ` AND c.name LIKE ?`;
    params.push(`%${complexName}%`);
  }
  query += `
    GROUP BY c.name
    ORDER BY count DESC
  `;

  const rows = db.prepare(query).all(...params);

  return rows.map((r: any) => ({
    name: r.name,
    count: r.count,
    avgPriceEok: Number(r.avgPriceEok.toFixed(2)),
  }));
}

/**
 * 드릴다운: 특정 단지의 평수별 집계
 */
export async function getDrilldownAreas(complexName: string, lawdCode?: string): Promise<any[]> {
  const db = getDb();
  const resolvedName = resolveComplexName(db, complexName, lawdCode);

  const query = db.prepare(`
    SELECT CAST(ROUND(t.area_m2) AS TEXT) || '㎡' AS name,
           COUNT(*) AS count,
           AVG(t.price_eok) AS avgPriceEok
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    WHERE c.name = ? ${lawdCode ? "AND c.lawd_code = ?" : ""}
    GROUP BY name
    ORDER BY avgPriceEok DESC
  `);

  const rows = lawdCode ? query.all(resolvedName, lawdCode) : query.all(resolvedName);
  return rows.map((r: any) => ({
    name: r.name,
    count: r.count,
    avgPriceEok: Number(r.avgPriceEok.toFixed(2)),
  }));
}

/**
 * 노드-링크 시각화 데이터 (네트워크 뷰 폐기로 더미 데이터 리턴)
 */
export async function getGraphTopology(filter: GraphFilter): Promise<GraphTopologyData> {
  return {
    nodes: [],
    links: [],
  };
}

export async function getComplexDetail(
  complexName: string,
  lawdCode?: string,
  area?: number,
  startDate?: string,
  endDate?: string
): Promise<any> {
  const db = getDb();
  const resolvedName = resolveComplexName(db, complexName, lawdCode);

  // 단일 통합 SQL: 필요한 모든 컬럼을 1회 조회 (deal_date DESC 정렬)
  let sql = `
    SELECT t.deal_date AS dealDate,
           t.price_eok AS priceEok,
           t.area_m2 AS areaM2,
           t.floor AS floor,
           t.dedupe_key AS dedupeKey
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    WHERE c.name = ?
  `;
  const params: any[] = [resolvedName];
  if (lawdCode) {
    sql += " AND c.lawd_code = ?";
    params.push(lawdCode);
  }
  if (area !== undefined && area !== null) {
    sql += " AND CAST(ROUND(t.area_m2) AS INTEGER) = ?";
    params.push(area);
  }
  if (startDate) {
    sql += " AND substr(t.deal_date, 1, 7) >= ?";
    params.push(startDate);
  }
  if (endDate) {
    sql += " AND substr(t.deal_date, 1, 7) <= ?";
    params.push(endDate);
  }
  sql += " ORDER BY t.deal_date DESC";

  const allRows = db.prepare(sql).all(...params) as { dealDate: string; priceEok: number; areaM2: number; floor: number | null; dedupeKey: string }[];

  // 1. 최근 거래 10건 (이미 deal_date DESC 정렬됨)
  const recentTx = allRows.slice(0, 10).map((r) => ({
    apartmentName: resolvedName,
    dealDate: r.dealDate,
    priceEok: r.priceEok,
    areaM2: r.areaM2,
    floor: r.floor,
    dedupeKey: r.dedupeKey
  }));

  // 2. 메모리 상 단일 패스(Pass)로 areaBreakdown, floorDist, trend 데이터 집계
  const areaGroups = new Map<string, number[]>();
  const floorGroups = new Map<number, number[]>();
  const monthlyMap = new Map<string, number[]>();

  for (const row of allRows) {
    // 평형 그룹화
    const areaKey = `${Math.round(row.areaM2)}㎡`;
    let aList = areaGroups.get(areaKey);
    if (!aList) {
      aList = [];
      areaGroups.set(areaKey, aList);
    }
    aList.push(row.priceEok);

    // 층 그룹화
    if (row.floor !== null && row.floor !== undefined) {
      let fList = floorGroups.get(row.floor);
      if (!fList) {
        fList = [];
        floorGroups.set(row.floor, fList);
      }
      fList.push(row.priceEok);
    }

    // 월별 추이 그룹화 (최근 12개월 등)
    const monthKey = row.dealDate.substring(0, 7);
    let mList = monthlyMap.get(monthKey);
    if (!mList) {
      mList = [];
      monthlyMap.set(monthKey, mList);
    }
    mList.push(row.priceEok);
  }

  // 3. 통계 연산 수행 (Memory BoxPlot)
  const areaBreakdown = Array.from(areaGroups.entries()).map(([areaStr, prices]) => {
    const stats = calculateBoxPlot(prices);
    return {
      area: areaStr,
      avgPriceEok: stats.mean, // 하위 호환
      count: prices.length,
      ...stats
    };
  }).sort((a, b) => {
    const numA = parseInt(a.area) || 0;
    const numB = parseInt(b.area) || 0;
    return numA - numB;
  });

  const floorDist = Array.from(floorGroups.entries()).map(([floorNum, prices]) => {
    const stats = calculateBoxPlot(prices);
    return {
      floor: floorNum,
      count: prices.length,
      avgPriceEok: stats.mean, // 하위 호환
      ...stats
    };
  }).sort((a, b) => a.floor - b.floor);

  const trend = Array.from(monthlyMap.entries()).map(([month, prices]) => {
    const stats = calculateBoxPlot(prices);
    return {
      month,
      거래량: prices.length,
      최대가: Number(stats.max.toFixed(2)),
      최소가: Number(stats.min.toFixed(2)),
      평균가: Number(stats.mean.toFixed(2)),
      중위값: Number(stats.median.toFixed(2)),
      overall: Number(stats.mean.toFixed(2)) // 하위 호환
    };
  }).sort((a, b) => a.month.localeCompare(b.month));

  return {
    trend,
    areaBreakdown,
    floorDist,
    recentTx
  };
}

/**
 * 단지명 글로벌 검색 (지역 무관 또는 특정 지역 필터)
 * SQLite FTS5 MATCH 구문을 사용하여 Full-Table Scan 없이 초고속 부분 검색을 지원합니다.
 */
export async function searchComplexNames(
  query: string,
  lawdCode?: string
): Promise<ComplexSearchResult[]> {
  const db = getDb();
  
  if (!query.trim()) {
    let queryStr = `
      SELECT DISTINCT c.id, c.name, c.lawd_code AS lawdCode, r.display_name AS regionName, c.lat, c.lng
      FROM complexes c
      JOIN regions r ON c.lawd_code = r.lawd_code
      WHERE 1=1
    `;
    const params: any[] = [];
    if (lawdCode) {
      queryStr += ` AND c.lawd_code LIKE ? || '%'`;
      params.push(lawdCode);
    }
    queryStr += ` ORDER BY c.name LIMIT 30`;
    const rows = db.prepare(queryStr).all(...params);
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      lawdCode: r.lawdCode,
      regionName: r.regionName,
      lat: r.lat,
      lng: r.lng,
    }));
  }

  let queryStr = `
    SELECT DISTINCT c.id, c.name, c.lawd_code AS lawdCode, r.display_name AS regionName, c.lat, c.lng
    FROM complexes c
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE c.name LIKE ?
  `;
  const params: any[] = [`%${query.trim()}%`];
  if (lawdCode) {
    queryStr += ` AND c.lawd_code LIKE ? || '%'`;
    params.push(lawdCode);
  }
  queryStr += ` ORDER BY c.name LIMIT 30`;

  const rows = db.prepare(queryStr).all(...params);
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    lawdCode: r.lawdCode,
    regionName: r.regionName,
    lat: r.lat,
    lng: r.lng,
  }));
}

/**
 * LLM 프롬프트 생성을 위한 데이터 요약 텍스트
 */
export async function getDataContext(filter: GraphFilter): Promise<string> {
  const txs = await searchTransactions(filter);

  if (txs.length === 0) {
    return "조건에 일치하는 실거래 데이터가 없습니다.";
  }

  const count = txs.length;
  const prices = txs.map((t) => t.priceEok);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / count;
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);

  // 월별 추이 집계
  const monthlyMap = new Map<string, { count: number; sum: number }>();
  txs.forEach((t) => {
    const month = t.dealDate.substring(0, 7);
    const curr = monthlyMap.get(month) || { count: 0, sum: 0 };
    curr.count += 1;
    curr.sum += t.priceEok;
    monthlyMap.set(month, curr);
  });

  const monthlySummary = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => `- ${month}: 거래량 ${data.count}건, 평균가 ${(data.sum / data.count).toFixed(2)}억`)
    .join("\n");

  // 상위 거래 5건
  const topRecent = txs
    .slice(0, 5)
    .map((t) => `- [${t.dealDate}] ${t.apartmentName} (${t.floor}층, ${t.areaM2 ? Math.round(t.areaM2) : "-"}㎡) : ${t.priceEok}억`)
    .join("\n");

  return `[조회 필터 조건]
- 지역 코드: ${filter.lawdCode || "전체"}
- 아파트명 키워드: ${filter.complexName || "전체"}
- 기간: ${filter.startDate || "시작일 없음"} ~ ${filter.endDate || "종료일 없음"}
- 평형대(㎡): ${filter.minArea || 0}㎡ ~ ${filter.maxArea || "제한 없음"}㎡

[실거래 요약 통계]
- 총 거래 건수: ${count}건
- 평균 거래 금액: ${avgPrice.toFixed(2)}억 원
- 최고 거래 금액: ${maxPrice}억 원
- 최저 거래 금액: ${minPrice}억 원

[월별 거래 추이]
${monthlySummary}

[최근 실거래 내역 (상위 5건)]
${topRecent}
`;
}

/**
 * 캐시된 법정동 아파트 목록 조회
 */
export function getCachedApartments(lawdCode: string): { apartments: string[]; cachedAt: string | null } {
  const db = getDb();
  
  const meta = db.prepare(`
    SELECT cached_at FROM region_apartment_cache_meta WHERE lawd_code = ?
  `).get(lawdCode) as { cached_at: string } | undefined;

  if (!meta) {
    return { apartments: [], cachedAt: null };
  }

  const rows = db.prepare(`
    SELECT apartment_name FROM region_apartment_cache WHERE lawd_code = ? ORDER BY apartment_name ASC
  `).all(lawdCode) as { apartment_name: string }[];

  return {
    apartments: rows.map(r => r.apartment_name),
    cachedAt: meta.cached_at
  };
}

/**
 * 법정동 아파트 목록 캐시 갱신
 */
export function saveCachedApartments(lawdCode: string, apartments: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION");
  try {
    // 1. 기존 캐시 삭제
    db.prepare("DELETE FROM region_apartment_cache WHERE lawd_code = ?").run(lawdCode);
    
    // 2. 신규 캐시 삽입
    const insertStmt = db.prepare("INSERT INTO region_apartment_cache (lawd_code, apartment_name) VALUES (?, ?)");
    for (const name of apartments) {
      insertStmt.run(lawdCode, name);
    }

    // 3. 메타 정보 갱신
    db.prepare(`
      INSERT INTO region_apartment_cache_meta (lawd_code, cached_at)
      VALUES (?, ?)
      ON CONFLICT(lawd_code) DO UPDATE SET cached_at = excluded.cached_at
    `).run(lawdCode, now);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * DB regions 테이블에서 지역명 검색 (외부 주소 API 미설정 시 폴백)
 */
export function searchDbRegions(query: string): { lawdCode: string; displayName: string }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT lawd_code AS lawdCode, display_name AS displayName
    FROM regions
    WHERE display_name LIKE '%' || ? || '%'
    ORDER BY display_name
    LIMIT 15
  `).all(query) as { lawdCode: string; displayName: string }[];
  return rows;
}

/**
 * DB regions 테이블에 있는 모든 지역 목록 조회
 */
export function getAllDbRegions(): { lawdCode: string; displayName: string }[] {
  const rows = getPreparedStatement(`
    SELECT lawd_code AS lawdCode, display_name AS displayName
    FROM regions
    ORDER BY display_name ASC
  `).all() as { lawdCode: string; displayName: string }[];
  return rows;
}

/**
 * DB regions 테이블에 있는 지역들의 집계 정보 조회 (건수, 집계기간)
 */
export function getDbRegionsSummary(): {
  lawdCode: string;
  displayName: string;
  createdAt: string;
  transactionCount: number;
  minDealDate: string | null;
  maxDealDate: string | null;
}[] {
  const rows = getPreparedStatement(`
    SELECT r.lawd_code AS lawdCode,
           r.display_name AS displayName,
           r.created_at AS createdAt,
           COUNT(t.dedupe_key) AS transactionCount,
           MIN(t.deal_date) AS minDealDate,
           MAX(t.deal_date) AS maxDealDate
    FROM regions r
    LEFT JOIN transactions t ON r.lawd_code = t.lawd_code
    GROUP BY r.lawd_code, r.display_name, r.created_at
    ORDER BY r.display_name ASC
  `).all() as any[];

  return rows.map(r => ({
    lawdCode: r.lawdCode,
    displayName: r.displayName,
    createdAt: r.createdAt,
    transactionCount: r.transactionCount,
    minDealDate: r.minDealDate || null,
    maxDealDate: r.maxDealDate || null
  }));
}

/**
 * DB regions 테이블에 신규 지역 등록
 */
export function insertDbRegion(lawdCode: string, displayName: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO regions (lawd_code, display_name, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(lawd_code) DO NOTHING
  `);
  stmt.run(lawdCode, displayName, now);
}

/**
 * 특정 지역 코드(lawdCode)에 속한 아파트 단지 목록 조회
 */
export function getComplexesByRegion(lawdCode?: string): string[] {
  const db = getDb();
  let query = `
    SELECT DISTINCT name
    FROM complexes
  `;
  const params: any[] = [];
  if (lawdCode && lawdCode.trim() !== "") {
    query += ` WHERE lawd_code = ?`;
    params.push(lawdCode);
  }
  query += ` ORDER BY name ASC`;
  const rows = db.prepare(query).all(...params) as { name: string }[];
  return rows.map(r => r.name);
}

/**
 * 일단위 수집 건수 통계 조회
 */
export function getDailyCollectionStats(): DailyCollectStat[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT substr(collected_at, 1, 10) AS collectDate,
           COUNT(*) AS count,
           ROUND(AVG(price_eok), 2) AS avgPriceEok,
           COUNT(DISTINCT complex_id) AS complexCount
    FROM transactions
    GROUP BY collectDate
    ORDER BY collectDate ASC
  `).all() as { collectDate: string; count: number; avgPriceEok: number; complexCount: number }[];
  return rows;
}

/**
 * 특정 수집일의 지역별 수집 건수 통계 조회
 */
export function getRegionCollectionStatsByDate(date: string): RegionCollectStat[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.lawd_code AS lawdCode,
           r.display_name AS regionName,
           COUNT(*) AS count
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE substr(t.collected_at, 1, 10) = ?
    GROUP BY r.lawd_code, r.display_name
    ORDER BY count DESC
  `).all(date) as { lawdCode: string; regionName: string; count: number }[];
  return rows;
}

/**
 * 등록월별(계약월별) 수집 건수 통계 조회
 */
export function getMonthlyCollectionStats(): DailyCollectStat[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT substr(deal_date, 1, 7) AS collectDate,
           COUNT(*) AS count,
           ROUND(AVG(price_eok), 2) AS avgPriceEok,
           COUNT(DISTINCT complex_id) AS complexCount
    FROM transactions
    GROUP BY collectDate
    ORDER BY collectDate ASC
  `).all() as { collectDate: string; count: number; avgPriceEok: number; complexCount: number }[];
  return rows;
}

/**
 * 특정 등록월(계약월, YYYY-MM)의 지역별 수집 건수 통계 조회
 */
export function getRegionCollectionStatsByMonth(month: string): RegionCollectStat[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.lawd_code AS lawdCode,
           r.display_name AS regionName,
           COUNT(*) AS count
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE substr(t.deal_date, 1, 7) = ?
    GROUP BY r.lawd_code, r.display_name
    ORDER BY count DESC
  `).all(month) as { lawdCode: string; regionName: string; count: number }[];
  return rows;
}

/**
 * 특정 지역코드(lawdCode) 및 거래월(dealMonth: YYYYMM)에 적재된 로컬 실거래 건수 조회
 */
export function getLocalTransactionsCount(lawdCode: string, dealMonth: string): number {
  const db = getDb();
  const dealMonthHyphen = `${dealMonth.slice(0, 4)}-${dealMonth.slice(4, 6)}`;
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    WHERE c.lawd_code = ? AND t.deal_date LIKE ?
  `).get(lawdCode, `${dealMonthHyphen}%`) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * 특정 지역코드(lawdCode) 및 거래월(dealMonth: YYYYMM)의 실거래 목록을 로컬 DB로부터 직접 조회
 */
export function getLocalApartmentPrices(
  lawdCode: string,
  dealMonth: string
): { 
  apartmentName: string; 
  dealDate: string; 
  priceEok: number; 
  areaM2: number; 
  floor: number;
  dongName?: string | null;
  jibun?: string | null;
  roadName?: string | null;
  lat?: number | null;
  lng?: number | null;
}[] {
  const db = getDb();
  const dealMonthHyphen = `${dealMonth.slice(0, 4)}-${dealMonth.slice(4, 6)}`;
  const rows = db.prepare(`
    SELECT c.name AS apartmentName,
           t.deal_date AS dealDate,
           t.price_eok AS priceEok,
           t.area_m2 AS areaM2,
           t.floor AS floor,
           c.dong_name AS dongName,
           c.jibun AS jibun,
           c.road_name AS roadName,
           c.lat AS lat,
           c.lng AS lng
    FROM transactions t
    JOIN complexes c ON t.complex_id = c.id
    WHERE c.lawd_code = ? AND t.deal_date LIKE ?
    ORDER BY t.deal_date ASC
  `).all(lawdCode, `${dealMonthHyphen}%`) as any[];
  return rows;
}

/**
 * 좌표 미확보 단지 목록 조회 (Geocoding 대상)
 */
export function getComplexesWithoutCoords(lawdCode?: string): { id: string; name: string; lawdCode: string; regionName: string; dongName: string | null; jibun: string | null; roadName: string | null }[] {
  const db = getDb();
  let query = `
    SELECT c.id, c.name, c.lawd_code AS lawdCode, r.display_name AS regionName,
           c.dong_name AS dongName, c.jibun, c.road_name AS roadName
    FROM complexes c
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE c.lat IS NULL AND c.geocode_failed = 0
  `;
  const params: any[] = [];
  if (lawdCode) {
    query += ' AND c.lawd_code = ?';
    params.push(lawdCode);
  }
  query += ' ORDER BY c.name ASC';
  return db.prepare(query).all(...params) as any[];
}

/**
 * 위경도 좌표가 없는 모든 단지 목록 조회 (수동 관리 대상)
 */
export function getComplexesMissingCoords(): {
  id: string;
  name: string;
  lawdCode: string;
  regionName: string;
  dongName: string | null;
  jibun: string | null;
  roadName: string | null;
  lat: number | null;
  lng: number | null;
  geocodeFailed: number;
  geocodeError: string | null;
}[] {
  const db = getDb();
  const query = `
    SELECT c.id, c.name, c.lawd_code AS lawdCode, r.display_name AS regionName,
           c.dong_name AS dongName, c.jibun, c.road_name AS roadName,
           c.lat, c.lng, c.geocode_failed AS geocodeFailed, c.geocode_error AS geocodeError
    FROM complexes c
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE c.lat IS NULL OR c.lng IS NULL
    ORDER BY c.name ASC
  `;
  return db.prepare(query).all() as any[];
}

/**
 * 좌표 확보 단지 목록 조회 (반경 검색 대상)
 */
export function getComplexesWithCoords(lawdCode?: string): { id: string; name: string; lawdCode: string; regionName: string; lat: number; lng: number; dongName: string | null; jibun: string | null }[] {
  const db = getDb();
  let query = `
    SELECT c.id, c.name, c.lawd_code AS lawdCode, r.display_name AS regionName,
           c.lat, c.lng, c.dong_name AS dongName, c.jibun
    FROM complexes c
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL
  `;
  const params: any[] = [];
  if (lawdCode) {
    query += ' AND c.lawd_code = ?';
    params.push(lawdCode);
  }
  query += ' ORDER BY c.name ASC';
  return db.prepare(query).all(...params) as any[];
}

/**
 * 단지 좌표 업데이트 (Geocoding 결과 저장)
 */
export function updateComplexCoords(complexId: string, lat: number, lng: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE complexes SET lat = ?, lng = ?, geocode_failed = 0, geocode_error = NULL, geocoded_at = ? WHERE id = ?
  `).run(lat, lng, now, complexId);
}

/**
 * 단지 Geocoding 실패 업데이트
 */
export function updateComplexGeocodeFailed(complexId: string, errorMsg: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE complexes SET geocode_failed = 1, geocode_error = ?, geocoded_at = ? WHERE id = ?
  `).run(errorMsg, now, complexId);
}

/**
 * 모든 단지의 Geocoding 실패 상태 초기화 (재시도 가능하게 함)
 */
export function resetGeocodeFailures(): void {
  const db = getDb();
  db.prepare(`
    UPDATE complexes SET geocode_failed = 0, geocode_error = NULL WHERE geocode_failed = 1
  `).run();
}

/**
 * 특정 단지의 좌표 및 실패 상태 리셋 (다시 Geocoding 하도록)
 */
export function resetComplexCoords(complexId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE complexes 
    SET lat = NULL, lng = NULL, geocode_failed = 0, geocode_error = NULL, geocoded_at = NULL 
    WHERE id = ?
  `).run(complexId);
}

/**
 * Geocoding 현황 통계 조회
 */
export function getGeocodeStats(): { total: number; geocoded: number; pending: number } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM complexes').get() as any).c;
  const geocoded = (db.prepare('SELECT COUNT(*) AS c FROM complexes WHERE lat IS NOT NULL').get() as any).c;
  return { total, geocoded, pending: total - geocoded };
}

/**
 * 세션 저장
 */
export function saveSession(id: string, email: string, expiresAt: number, loginMethod?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, email, expires_at, login_method)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      expires_at = excluded.expires_at,
      login_method = COALESCE(excluded.login_method, sessions.login_method)
  `).run(id, email, expiresAt, loginMethod ?? null);
}

/**
 * 세션 조회
 */
export function getSession(id: string): { email: string; expiresAt: number; loginMethod: string | null } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT email, expires_at AS expiresAt, login_method AS loginMethod
    FROM sessions
    WHERE id = ?
  `).get(id) as { email: string; expiresAt: number; loginMethod: string | null } | undefined;
  
  if (!row) return null;
  return row;
}

/**
 * 세션 삭제
 */
export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/**
 * 만료된 세션 삭제
 */
export function cleanExpiredSessions(): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
}

/**
 * ----------------------------------------------------
 * 다중 사용자(계정 격리) 관련 Helper 함수군
 * ----------------------------------------------------
 */

export type UserSettings = {
  email: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  kakaoRestApiKey: string | null;
  alertedDedupeKeys: string[];
};

export function getUserSettings(email: string): UserSettings | null {
  const row = getPreparedStatement(`
    SELECT email, telegram_bot_token AS telegramBotToken, telegram_chat_id AS telegramChatId,
           kakao_rest_api_key AS kakaoRestApiKey, alerted_dedupe_keys AS alertedDedupeKeys
    FROM user_settings
    WHERE email = ?
  `).get(email) as any | undefined;

  if (!row) return null;

  let alertedDedupeKeys: string[] = [];
  try {
    alertedDedupeKeys = JSON.parse(row.alertedDedupeKeys || "[]");
  } catch {
    alertedDedupeKeys = [];
  }

  return {
    email: row.email,
    telegramBotToken: row.telegramBotToken,
    telegramChatId: row.telegramChatId,
    kakaoRestApiKey: row.kakaoRestApiKey,
    alertedDedupeKeys,
  };
}

export function saveUserSettings(
  email: string,
  settings: {
    telegramBotToken?: string | null;
    telegramChatId?: string | null;
    kakaoRestApiKey?: string | null;
    alertedDedupeKeys?: string[];
  }
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getUserSettings(email);

  const updatedToken = settings.telegramBotToken !== undefined ? settings.telegramBotToken : (existing?.telegramBotToken ?? null);
  const updatedChatId = settings.telegramChatId !== undefined ? settings.telegramChatId : (existing?.telegramChatId ?? null);
  const updatedKakaoKey = settings.kakaoRestApiKey !== undefined ? settings.kakaoRestApiKey : (existing?.kakaoRestApiKey ?? null);
  const alertedKeysStr = settings.alertedDedupeKeys !== undefined ? JSON.stringify(settings.alertedDedupeKeys) : (existing ? JSON.stringify(existing.alertedDedupeKeys) : "[]");

  getPreparedStatement(`
    INSERT INTO user_settings (email, telegram_bot_token, telegram_chat_id, kakao_rest_api_key, alerted_dedupe_keys, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      telegram_bot_token = excluded.telegram_bot_token,
      telegram_chat_id = excluded.telegram_chat_id,
      kakao_rest_api_key = excluded.kakao_rest_api_key,
      alerted_dedupe_keys = excluded.alerted_dedupe_keys,
      updated_at = excluded.updated_at
  `).run(email, updatedToken, updatedChatId, updatedKakaoKey, alertedKeysStr, now);
}

function parseRuleRow(row: any) {
  let keywords: string[] = [];
  try {
    keywords = JSON.parse(row.apartment_keywords || "[]");
  } catch {
    keywords = [];
  }

  let channels: string[] = [];
  try {
    channels = row.channels ? row.channels.split(",") : [];
  } catch {
    channels = [];
  }

  return {
    id: row.id,
    userEmail: row.user_email,
    name: row.name,
    regionName: row.region_name,
    regionCode: row.region_code || undefined,
    apartmentKeywords: keywords,
    minPriceEok: row.min_price_eok !== null ? row.min_price_eok : undefined,
    maxPriceEok: row.max_price_eok !== null ? row.max_price_eok : undefined,
    minArea: row.min_area !== null ? row.min_area : undefined,
    maxArea: row.max_area !== null ? row.max_area : undefined,
    comparisonCriteria: row.comparison_criteria,
    intervalMinutes: row.interval_minutes,
    alertTime: row.alert_time || "09:00",
    channels: channels,
    enabled: Boolean(row.enabled),
    lastCheckedAt: row.last_checked_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getRulesByEmail(email: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM rules WHERE user_email = ? ORDER BY created_at DESC
  `).all(email) as any[];

  return rows.map(parseRuleRow);
}

export function getAllRules(): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM rules ORDER BY created_at DESC
  `).all() as any[];

  return rows.map(parseRuleRow);
}

export function upsertRuleDb(email: string, rule: any): void {
  const db = getDb();
  const now = new Date().toISOString();
  
  // 외래키 무결성을 위해 우선 user_settings 레코드 확보
  const user = getUserSettings(email);
  if (!user) {
    saveUserSettings(email, {});
  }

  const keywordsStr = JSON.stringify(rule.apartmentKeywords || []);
  const channelsStr = (rule.channels || []).join(",");

  db.prepare(`
    INSERT INTO rules (
      id, user_email, name, region_name, region_code, apartment_keywords,
      min_price_eok, max_price_eok, min_area, max_area, comparison_criteria,
      interval_minutes, alert_time, channels, enabled, last_checked_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      region_name = excluded.region_name,
      region_code = excluded.region_code,
      apartment_keywords = excluded.apartment_keywords,
      min_price_eok = excluded.min_price_eok,
      max_price_eok = excluded.max_price_eok,
      min_area = excluded.min_area,
      max_area = excluded.max_area,
      comparison_criteria = excluded.comparison_criteria,
      interval_minutes = excluded.interval_minutes,
      alert_time = excluded.alert_time,
      channels = excluded.channels,
      enabled = excluded.enabled,
      last_checked_at = COALESCE(excluded.last_checked_at, rules.last_checked_at),
      updated_at = excluded.updated_at
  `).run(
    rule.id,
    email,
    rule.name,
    rule.regionName,
    rule.regionCode || null,
    keywordsStr,
    rule.minPriceEok !== undefined ? rule.minPriceEok : null,
    rule.maxPriceEok !== undefined ? rule.maxPriceEok : null,
    rule.minArea !== undefined ? rule.minArea : null,
    rule.maxArea !== undefined ? rule.maxArea : null,
    rule.comparisonCriteria,
    rule.intervalMinutes,
    rule.alertTime || "09:00",
    channelsStr,
    rule.enabled ? 1 : 0,
    rule.lastCheckedAt || null,
    rule.createdAt || now,
    now
  );
}

export function deleteRuleDb(email: string, id: string): boolean {
  const db = getDb();
  const info = db.prepare("DELETE FROM rules WHERE id = ? AND user_email = ?").run(id, email);
  return info.changes > 0;
}

export function getPresetsByEmail(email: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, filter_data AS filter, created_at AS createdAt
    FROM graph_presets
    WHERE user_email = ?
    ORDER BY created_at DESC
  `).all(email) as any[];

  return rows.map(r => {
    let filter = {};
    try {
      filter = JSON.parse(r.filter);
    } catch {
      filter = {};
    }
    return {
      id: r.id,
      name: r.name,
      filter,
      createdAt: r.createdAt,
    };
  });
}

export function savePresetDb(email: string, preset: any): void {
  const db = getDb();
  const now = new Date().toISOString();
  
  const user = getUserSettings(email);
  if (!user) {
    saveUserSettings(email, {});
  }

  const filterStr = JSON.stringify(preset.filter || {});

  db.prepare(`
    INSERT INTO graph_presets (id, user_email, name, filter_data, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      filter_data = excluded.filter_data
  `).run(preset.id, email, preset.name, filterStr, preset.createdAt || now);
}

export async function readPresetsCore(email: string, type: 'overview' | 'analysis'): Promise<any[]> {
  const db = getDb();
  if (type === 'overview') {
    const rows = db.prepare(`SELECT id, name, filter_data AS filter, created_at AS createdAt FROM graph_presets_overview WHERE user_email = ? ORDER BY created_at DESC`).all(email) as any[];
    return rows.map(r => {
      let filter = {};
      try {
        filter = JSON.parse(r.filter);
      } catch {
        filter = {};
      }
      return { id: r.id, name: r.name, filter, createdAt: r.createdAt };
    });
  } else {
    const rows = db.prepare(`SELECT id, name, region_name AS regionName, building_name AS buildingName, area_m2 AS areaM2, created_at AS createdAt FROM graph_presets_analysis WHERE user_email = ? ORDER BY created_at DESC`).all(email) as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      regionName: r.regionName,
      buildingName: r.buildingName,
      areaM2: r.areaM2,
      createdAt: r.createdAt
    })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }
}

export async function savePresetCore(preset: any, email: string, type: 'overview' | 'analysis'): Promise<any> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = preset.id ?? `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // 외래키 무결성을 위해 우선 user_settings 레코드 확보
  const user = getUserSettings(email);
  if (!user) {
    saveUserSettings(email, {});
  }

  if (type === 'overview') {
    const filterStr = JSON.stringify(preset.filter || {});
    const stmt = db.prepare(`INSERT INTO graph_presets_overview (id, user_email, name, filter_data, created_at) VALUES (?, ?, ?, ?, ?) 
      ON CONFLICT(id) DO UPDATE SET 
        name = excluded.name, 
        filter_data = excluded.filter_data`);
    stmt.run(id, email, preset.name, filterStr, preset.createdAt || now);
    return { ...preset, id, createdAt: preset.createdAt || now };
  } else {
    const stmt = db.prepare(`INSERT INTO graph_presets_analysis (id, user_email, name, region_name, building_name, area_m2, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) 
      ON CONFLICT(id) DO UPDATE SET 
        name = excluded.name, 
        region_name = excluded.region_name,
        building_name = excluded.building_name,
        area_m2 = excluded.area_m2`);
    stmt.run(id, email, preset.name, preset.regionName, preset.buildingName, preset.areaM2 ?? null, preset.createdAt || now);
    return {
      id,
      name: preset.name,
      regionName: preset.regionName,
      buildingName: preset.buildingName,
      areaM2: preset.areaM2,
      createdAt: preset.createdAt || now
    };
  }
}

export async function deletePresetCore(id: string, email: string, type: 'overview' | 'analysis'): Promise<boolean> {
  const db = getDb();
  const table = type === 'overview' ? 'graph_presets_overview' : 'graph_presets_analysis';
  const info = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_email = ?`).run(id, email);
  return info.changes > 0;
}

/**
 * 단지 지리 정보 및 상세 메타 정보 조회 (위경도, 법정동, 지번, 세대수, 주차대수, 사용승인일 등)
 */
export function getComplexGeo(
  complexName: string,
  lawdCode?: string
): {
  id: string;
  name: string;
  lawdCode: string;
  regionName: string;
  lat: number | null;
  lng: number | null;
  dongName: string | null;
  jibun: string | null;
  roadName: string | null;
  totalHouseholds?: number | null;
  totalParking?: number | null;
  parkingPerHousehold?: number | null;
  useApprovalDate?: string | null;
} | null {
  const db = getDb();
  const resolvedName = resolveComplexName(db, complexName, lawdCode);

  let query = `
    SELECT c.id, c.name, c.lawd_code AS lawdCode, r.display_name AS regionName,
           c.lat, c.lng, c.dong_name AS dongName, c.jibun, c.road_name AS roadName,
           c.total_households AS totalHouseholds, c.total_parking AS totalParking,
           c.parking_per_household AS parkingPerHousehold, c.use_approval_date AS useApprovalDate
    FROM complexes c
    JOIN regions r ON c.lawd_code = r.lawd_code
    WHERE c.name = ?
  `;
  const params: any[] = [resolvedName];
  if (lawdCode) {
    query += ' AND c.lawd_code = ?';
    params.push(lawdCode);
  }
  query += ' LIMIT 1';

  const row = db.prepare(query).get(...params);
  if (!row) return null;
  return row as any;
}

/**
 * 단지 메타 정보(세대수, 주차대수, 사용승인일) 업데이트
 */
export function updateComplexMeta(
  complexId: string,
  meta: {
    totalHouseholds?: number | null;
    totalParking?: number | null;
    parkingPerHousehold?: number | null;
    useApprovalDate?: string | null;
  }
): void {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    const stmt = db.prepare(`
      UPDATE complexes
      SET total_households = COALESCE(?, total_households),
          total_parking = COALESCE(?, total_parking),
          parking_per_household = COALESCE(?, parking_per_household),
          use_approval_date = COALESCE(?, use_approval_date)
      WHERE id = ?
    `);
    stmt.run(
      meta.totalHouseholds ?? null,
      meta.totalParking ?? null,
      meta.parkingPerHousehold ?? null,
      meta.useApprovalDate ?? null,
      complexId
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}


export function getCheckRunsByEmail(email: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, rule_id AS ruleId, rule_name AS ruleName, matched, summary,
           matches_data AS matches, source_limit_notice AS sourceLimitNotice,
           error, created_at AS createdAt
    FROM check_runs
    WHERE user_email = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(email) as any[];

  return rows.map(r => {
    let matches = [];
    try {
      matches = JSON.parse(r.matches || "[]");
    } catch {
      matches = [];
    }
    return {
      id: r.id,
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      matched: Boolean(r.matched),
      summary: r.summary,
      matches,
      sourceLimitNotice: r.sourceLimitNotice,
      error: r.error || undefined,
      createdAt: r.createdAt,
    };
  });
}

export function getAlertedDedupeKeys(email: string, ruleId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT dedupe_key AS dedupeKey
    FROM alerted_transactions
    WHERE user_email = ? AND rule_id = ?
  `).all(email, ruleId) as { dedupeKey: string }[];
  return rows.map(r => r.dedupeKey);
}

export function appendCheckRunDb(email: string, run: any, alertedDedupeKeys: string[]): void {
  const db = getDb();
  const user = getUserSettings(email);
  if (!user) {
    saveUserSettings(email, {});
  }

  const existingKeys = user?.alertedDedupeKeys ?? [];
  const mergedKeys = Array.from(new Set([...existingKeys, ...alertedDedupeKeys])).slice(-1000);
  
  db.exec("BEGIN TRANSACTION");
  try {
    // 1. check_run 삽입
    const matchesStr = JSON.stringify(run.matches || []);
    db.prepare(`
      INSERT INTO check_runs (id, user_email, rule_id, rule_name, matched, summary, matches_data, source_limit_notice, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      email,
      run.ruleId,
      run.ruleName,
      run.matched ? 1 : 0,
      run.summary,
      matchesStr,
      run.sourceLimitNotice,
      run.error || null,
      run.createdAt
    );

    // 2. 룰의 lastCheckedAt 및 updatedAt 갱신
    db.prepare(`
      UPDATE rules SET last_checked_at = ?, updated_at = ? WHERE id = ?
    `).run(run.createdAt, run.createdAt, run.ruleId);

    // 3. user_settings의 alerted_dedupe_keys 갱신 (기존 호환 유지)
    db.prepare(`
      UPDATE user_settings SET alerted_dedupe_keys = ? WHERE email = ?
    `).run(JSON.stringify(mergedKeys), email);

    // 3-1. alerted_transactions에 신규 중복 방지 키 삽입
    const insertAlertedStmt = db.prepare(`
      INSERT OR IGNORE INTO alerted_transactions (user_email, rule_id, dedupe_key, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const key of alertedDedupeKeys) {
      insertAlertedStmt.run(email, run.ruleId, key, run.createdAt);
    }

    // 3-2. 90일 지난 오래된 alerted_transactions 데이터 삭제
    const ninetyDaysAgo = new Date(new Date(run.createdAt).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      DELETE FROM alerted_transactions WHERE created_at < ?
    `).run(ninetyDaysAgo);

    // 4. 오래된 check_runs 삭제 (최근 100개 유지)
    db.prepare(`
      DELETE FROM check_runs
      WHERE user_email = ? AND id NOT IN (
        SELECT id FROM check_runs WHERE user_email = ? ORDER BY created_at DESC LIMIT 100
      )
    `).run(email, email);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function deleteCheckRunDb(email: string, id: string): boolean {
  const db = getDb();
  const info = db.prepare("DELETE FROM check_runs WHERE id = ? AND user_email = ?").run(id, email);
  return info.changes > 0;
}

export function getNotificationsByEmail(email: string): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, rule_id AS ruleId, channel, status, message,
           dedupe_keys AS dedupeKeys, created_at AS createdAt
    FROM notifications
    WHERE user_email = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(email) as any[];

  return rows.map(r => {
    let dedupeKeys = [];
    try {
      dedupeKeys = JSON.parse(r.dedupeKeys || "[]");
    } catch {
      dedupeKeys = [];
    }
    return {
      id: r.id,
      ruleId: r.ruleId,
      channel: r.channel,
      status: r.status,
      message: r.message,
      dedupeKeys,
      createdAt: r.createdAt,
    };
  });
}

export function appendNotificationDb(email: string, record: any): void {
  const db = getDb();
  const user = getUserSettings(email);
  if (!user) {
    saveUserSettings(email, {});
  }

  db.exec("BEGIN TRANSACTION");
  try {
    const dedupeKeysStr = JSON.stringify(record.dedupeKeys || []);
    db.prepare(`
      INSERT INTO notifications (id, user_email, rule_id, channel, status, message, dedupe_keys, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      email,
      record.ruleId,
      record.channel,
      record.status,
      record.message,
      dedupeKeysStr,
      record.createdAt
    );

    // 오래된 알림 삭제 (100개 유지)
    db.prepare(`
      DELETE FROM notifications
      WHERE user_email = ? AND id NOT IN (
        SELECT id FROM notifications WHERE user_email = ? ORDER BY created_at DESC LIMIT 100
      )
    `).run(email, email);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getSystemConfigDb(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM system_config").all() as { key: string; value: string }[];
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

export function saveSystemConfigDb(config: Record<string, string>): void {
  const db = getDb();
  db.exec("BEGIN TRANSACTION");
  try {
    const stmt = db.prepare(`
      INSERT INTO system_config (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null) {
        stmt.run(key, String(value));
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function insertActivityLog(log: Omit<UserActivityLog, "id" | "createdAt">): void {
  const db = getDb();
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
  const now = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO user_activity_logs (id, user_email, activity_type, description, payload, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    id,
    log.userEmail,
    log.activityType,
    log.description,
    log.payload ?? null,
    log.ipAddress ?? null,
    log.userAgent ?? null,
    now
  );
}

export function getActivityLogs(
  limit: number,
  offset: number,
  userEmail?: string,
  activityType?: string
): { logs: UserActivityLog[]; total: number } {
  const db = getDb();
  
  let countSql = "SELECT COUNT(*) AS count FROM user_activity_logs WHERE 1=1";
  let selectSql = "SELECT id, user_email AS userEmail, activity_type AS activityType, description, payload, ip_address AS ipAddress, user_agent AS userAgent, created_at AS createdAt FROM user_activity_logs WHERE 1=1";
  const params: any[] = [];
  
  if (userEmail) {
    countSql += " AND user_email = ?";
    selectSql += " AND user_email = ?";
    params.push(userEmail);
  }
  
  if (activityType) {
    countSql += " AND activity_type = ?";
    selectSql += " AND activity_type = ?";
    params.push(activityType);
  }
  
  const totalRow = db.prepare(countSql).get(...params) as { count: number };
  const total = totalRow ? totalRow.count : 0;
  
  selectSql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  const selectParams = [...params, limit, offset];
  const logs = db.prepare(selectSql).all(...selectParams) as unknown as UserActivityLog[];
  
  return { logs, total };
}

export function getActivityStats(): {
  activityByType: { activityType: string; count: number }[];
  activityByDate: { date: string; logCount: number; userCount: number }[];
  topUsers: { userEmail: string; count: number }[];
  dau: number;
  wau: number;
  mau: number;
  totalUsers: number;
  totalLogs: number;
} {
  const db = getDb();
  
  // 1. 유형별 로그 수
  const byTypeRows = db.prepare(`
    SELECT activity_type AS activityType, COUNT(*) AS count
    FROM user_activity_logs
    GROUP BY activity_type
    ORDER BY count DESC
  `).all() as unknown as { activityType: string; count: number }[];
  
  // 2. 최근 14일 일자별 로그 수 및 고유 사용자 수 (KST 기준 일자 집계)
  const byDateRows = db.prepare(`
    SELECT date(created_at, '+9 hours') AS date, COUNT(*) AS logCount, COUNT(DISTINCT user_email) AS userCount
    FROM user_activity_logs
    WHERE created_at >= datetime('now', '-14 days')
    GROUP BY date
    ORDER BY date ASC
  `).all() as unknown as { date: string; logCount: number; userCount: number }[];
  
  // 3. 사용자별 로그 수 상위 10
  const topUsersRows = db.prepare(`
    SELECT user_email AS userEmail, COUNT(*) AS count
    FROM user_activity_logs
    GROUP BY user_email
    ORDER BY count DESC
    LIMIT 10
  `).all() as unknown as { userEmail: string; count: number }[];

  // 4. DAU (오늘 접속한 고유 사용자 수 - KST 기준 오늘)
  const dauRow = db.prepare(`
    SELECT COUNT(DISTINCT user_email) AS count
    FROM user_activity_logs
    WHERE date(created_at, '+9 hours') = date('now', '+9 hours')
  `).get() as { count: number } | undefined;
  const dau = dauRow ? dauRow.count : 0;

  // 5. WAU (최근 7일 접속한 고유 사용자 수)
  const wauRow = db.prepare(`
    SELECT COUNT(DISTINCT user_email) AS count
    FROM user_activity_logs
    WHERE created_at >= datetime('now', '-7 days')
  `).get() as { count: number } | undefined;
  const wau = wauRow ? wauRow.count : 0;

  // 6. MAU (최근 30일 접속한 고유 사용자 수)
  const mauRow = db.prepare(`
    SELECT COUNT(DISTINCT user_email) AS count
    FROM user_activity_logs
    WHERE created_at >= datetime('now', '-30 days')
  `).get() as { count: number } | undefined;
  const mau = mauRow ? mauRow.count : 0;

  // 7. 총 고유 사용자 수
  const totalUsersRow = db.prepare(`
    SELECT COUNT(DISTINCT user_email) AS count
    FROM user_activity_logs
  `).get() as { count: number } | undefined;
  const totalUsers = totalUsersRow ? totalUsersRow.count : 0;

  // 8. 총 로그 수
  const totalLogsRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM user_activity_logs
  `).get() as { count: number } | undefined;
  const totalLogs = totalLogsRow ? totalLogsRow.count : 0;
  
  return {
    activityByType: byTypeRows,
    activityByDate: byDateRows,
    topUsers: topUsersRows,
    dau,
    wau,
    mau,
    totalUsers,
    totalLogs
  };
}

export function getUserPasswordHash(email: string): string | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT password_hash AS passwordHash
    FROM user_settings
    WHERE email = ?
  `).get(email.toLowerCase()) as any | undefined;
  return row?.passwordHash ?? null;
}

export function updateUserCredentials(
  currentEmail: string,
  newEmail: string,
  passwordHash: string | null
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const current = currentEmail.toLowerCase();
  const next = newEmail.toLowerCase();

  // newEmail user_settings 레코드 존재 검사
  const existing = db.prepare("SELECT email FROM user_settings WHERE email = ?").get(next);
  if (!existing) {
    // currentEmail의 기존 데이터를 가져와 복사
    const currentSettings = db.prepare(`
      SELECT telegram_bot_token, telegram_chat_id, kakao_rest_api_key, alerted_dedupe_keys
      FROM user_settings
      WHERE email = ?
    `).get(current) as any | undefined;

    const botToken = currentSettings?.telegram_bot_token ?? null;
    const chatId = currentSettings?.telegram_chat_id ?? null;
    const kakaoKey = currentSettings?.kakao_rest_api_key ?? null;
    const alertedKeys = currentSettings?.alerted_dedupe_keys ?? "[]";

    db.prepare(`
      INSERT INTO user_settings (email, telegram_bot_token, telegram_chat_id, kakao_rest_api_key, alerted_dedupe_keys, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(next, botToken, chatId, kakaoKey, alertedKeys, now);
  }

  // 비밀번호가 세팅된 경우 해시 업데이트
  if (passwordHash !== null) {
    db.prepare(`
      UPDATE user_settings
      SET password_hash = ?, is_temporary_password = 0, updated_at = ?
      WHERE email = ?
    `).run(passwordHash, now, next);
  }

  // 이메일이 변경된 경우 관련 테이블의 이메일 이그레이션 진행
  if (current !== next) {
    db.prepare("UPDATE rules SET user_email = ?, updated_at = ? WHERE user_email = ?").run(next, now, current);
    db.prepare("UPDATE graph_presets SET user_email = ? WHERE user_email = ?").run(next, current);
    db.prepare("UPDATE graph_presets_overview SET user_email = ? WHERE user_email = ?").run(next, current);
    db.prepare("UPDATE graph_presets_analysis SET user_email = ? WHERE user_email = ?").run(next, current);
    db.prepare("UPDATE check_runs SET user_email = ? WHERE user_email = ?").run(next, current);
    db.prepare("UPDATE notifications SET user_email = ? WHERE user_email = ?").run(next, current);
    db.prepare("UPDATE user_activity_logs SET user_email = ? WHERE user_email = ?").run(next, current);

    // 구 이메일 레코드 삭제
    db.prepare("DELETE FROM user_settings WHERE email = ?").run(current);
  }
}

export function isTemporaryPassword(email: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT is_temporary_password AS isTemp
    FROM user_settings
    WHERE email = ?
  `).get(email.toLowerCase()) as { isTemp: number } | undefined;
  return row?.isTemp === 1;
}

