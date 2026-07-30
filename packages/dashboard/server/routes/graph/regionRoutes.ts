import { Router } from "express";
import {
  getAllDbRegions,
  getDbRegionsSummary,
  insertDbRegion,
  getComplexesByRegion,
  searchComplexNames,
  fetchApartmentPricesDirect,
  normalizeTransaction,
  upsertTransactionBatch
} from "@myhome/shared";
import { graphCache, TTL } from "../../cache.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";

const router = Router();

/** GET /api/graph/db-regions — DB에 등록된 모든 지역 목록 */
router.get("/db-regions", asyncHandler(async (_req, res) => {
  const regions = await getAllDbRegions();
  res.json(regions);
}));

/** GET /api/graph/regions-summary — DB 수집 지역별 요약 통계 */
router.get("/regions-summary", asyncHandler(async (_req, res) => {
  const cacheKey = "regions-summary";
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const summary = await getDbRegionsSummary();
  graphCache.set(cacheKey, summary, TTL.STATIC);
  res.json(summary);
}));

/** POST /api/graph/regions — 신규 수집 지역 추가 */
router.post("/regions", asyncHandler(async (req, res) => {
  const { lawdCode, displayName } = req.body;
  if (!lawdCode || !displayName) {
    res.status(400).json({ error: "lawdCode 또는 displayName이 누락되었습니다." });
    return;
  }
  await insertDbRegion(lawdCode, displayName);
  graphCache.clear(); // 신규 지역 추가 시 캐시 클리어
  res.json({ success: true });
}));

/** GET /api/graph/region-complexes — 특정 지역에 등록된 아파트 단지 목록 */
router.get("/region-complexes", asyncHandler(async (req, res) => {
  const lawdCode = req.query.lawdCode as string | undefined;
  const cacheKey = `region-complexes:${lawdCode ?? ""}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const complexes = await getComplexesByRegion(lawdCode);
  graphCache.set(cacheKey, complexes, TTL.STATIC);
  res.json(complexes);
}));

/** GET /api/graph/complexes/search — 단지명 글로벌 검색 */
router.get("/complexes/search", asyncHandler(async (req, res) => {
  const query = (req.query.q as string || "").trim();
  const lawdCode = req.query.lawdCode as string | undefined;
  if (!query && !lawdCode) {
    res.json([]);
    return;
  }
  const results = await searchComplexNames(query, lawdCode);
  res.json(results);
}));

export default router;
