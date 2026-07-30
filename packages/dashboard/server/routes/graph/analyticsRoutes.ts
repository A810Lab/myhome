import { Router } from "express";
import {
  getGraphStats,
  getComplexTrend,
  getRegionTrend,
  searchTransactions,
  getDrilldownRegions,
  getDrilldownComplexes,
  getDrilldownAreas,
  getGraphTopology,
  getComplexDetail,
  getDataContext,
  getDailyCollectionStats,
  getMonthlyCollectionStats,
  getRegionCollectionStatsByMonth,
  getRegionCollectionStatsByDate,
  getComplexGeo,
  type GraphFilter
} from "@myhome/shared";
import {
  geocodeAddress,
  findSubwayStationsNearCoords,
  getComplexInfraRating,
  updateComplexCoords
} from "../../geocoding.js";
import { graphCache, TTL } from "../../cache.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";

const router = Router();

/** GET /api/graph/stats — 전체 노드 수 통계 */
router.get("/stats", asyncHandler(async (_req, res) => {
  const cacheKey = "stats";
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const stats = await getGraphStats();
  graphCache.set(cacheKey, stats, TTL.STATIC);
  res.json(stats);
}));

/** GET /api/graph/complex/:name/trend */
router.get("/complex/:name/trend", asyncHandler(async (req, res) => {
  const complexName = decodeURIComponent(req.params.name);
  const lawdCode = req.query.lawdCode as string | undefined;
  const cacheKey = `trend:complex:${complexName}:${lawdCode ?? ""}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const trend = await getComplexTrend(complexName, lawdCode);
  const result = { complexName, lawdCode, trend };
  graphCache.set(cacheKey, result, TTL.TREND);
  res.json(result);
}));

/** GET /api/graph/region/:lawdCode/trend */
router.get("/region/:lawdCode/trend", asyncHandler(async (req, res) => {
  const { lawdCode } = req.params;
  const cacheKey = `trend:region:${lawdCode}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const trend = await getRegionTrend(lawdCode);
  const result = { lawdCode, trend };
  graphCache.set(cacheKey, result, TTL.TREND);
  res.json(result);
}));

/** GET /api/graph/search — 필터 조건 검색 */
router.get("/search", asyncHandler(async (req, res) => {
  let lawdCodes: string[] | undefined = undefined;
  if (req.query.lawdCodes) {
    if (Array.isArray(req.query.lawdCodes)) {
      lawdCodes = req.query.lawdCodes as string[];
    } else if (typeof req.query.lawdCodes === "string") {
      lawdCodes = (req.query.lawdCodes as string).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  const filter: GraphFilter = {
    lawdCode: req.query.lawdCode as string | undefined,
    lawdCodes,
    complexName: req.query.complexName as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    minArea: req.query.minArea ? Number(req.query.minArea) : undefined,
    maxArea: req.query.maxArea ? Number(req.query.maxArea) : undefined,
  };

  const cacheKey = `search:${JSON.stringify(filter)}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const results = await searchTransactions(filter);
  graphCache.set(cacheKey, results, TTL.SEARCH);
  res.json(results);
}));

/** GET /api/graph/drilldown/regions — 드릴다운: 시/도 레벨 */
router.get("/drilldown/regions", asyncHandler(async (req, res) => {
  const complexName = req.query.complexName as string | undefined;
  const cacheKey = `drilldown:regions:${complexName ?? ""}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const data = await getDrilldownRegions(complexName);
  graphCache.set(cacheKey, data, TTL.SEARCH);
  res.json(data);
}));

/** GET /api/graph/drilldown/complexes — 드릴다운: 아파트 단지별 */
router.get("/drilldown/complexes", asyncHandler(async (req, res) => {
  const lawdCode = req.query.lawdCode as string;
  const complexName = req.query.complexName as string | undefined;
  if (!lawdCode) {
    res.status(400).json({ error: "lawdCode 파라미터가 누락되었습니다." });
    return;
  }
  const cacheKey = `drilldown:complexes:${lawdCode}:${complexName ?? ""}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const data = await getDrilldownComplexes(lawdCode, complexName);
  graphCache.set(cacheKey, data, TTL.SEARCH);
  res.json(data);
}));

/** GET /api/graph/drilldown/areas — 드릴다운: 평수별 */
router.get("/drilldown/areas", asyncHandler(async (req, res) => {
  const complexName = req.query.complex as string;
  const lawdCode = req.query.lawdCode as string | undefined;
  if (!complexName) {
    res.status(400).json({ error: "complex 파라미터가 누락되었습니다." });
    return;
  }
  const cacheKey = `drilldown:areas:${complexName}:${lawdCode ?? ""}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }
  const data = await getDrilldownAreas(complexName, lawdCode);
  graphCache.set(cacheKey, data, TTL.SEARCH);
  res.json(data);
}));

/** GET /api/graph/topology — 토폴로지 데이터 */
router.get("/topology", asyncHandler(async (req, res) => {
  const filter: GraphFilter = {
    lawdCode: req.query.lawdCode as string | undefined,
    complexName: req.query.complexName as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
  };
  const data = await getGraphTopology(filter);
  res.json(data);
}));

/** GET /api/graph/complex/:name/detail — 단지별 입체 상세 분석 */
router.get("/complex/:name/detail", asyncHandler(async (req, res) => {
  const complexName = decodeURIComponent(req.params.name);
  const lawdCode = req.query.lawdCode as string | undefined;
  const area = req.query.area ? Number(req.query.area) : undefined;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  const cacheKey = `detail:${complexName}:${lawdCode ?? ""}:${area ?? ""}:${startDate ?? ""}:${endDate ?? ""}`;
  const cached = graphCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const data = await getComplexDetail(complexName, lawdCode, area, startDate, endDate);

  // 단지 지리정보 조회 및 지하철역 연동
  let complexInfo = getComplexGeo(complexName, lawdCode);
  let subways: any[] = [];
  let infraRating: any = null;

  if (complexInfo) {
    // 위경도 좌표가 없으면 Lazy Geocoding 수행
    if (complexInfo.lat === null || complexInfo.lng === null) {
      let query = "";
      if (complexInfo.dongName && complexInfo.jibun) {
        query = `${complexInfo.regionName} ${complexInfo.dongName} ${complexInfo.jibun}`;
      } else if (complexInfo.dongName) {
        query = `${complexInfo.regionName} ${complexInfo.dongName}`;
      } else {
        const cleanName = complexInfo.name.replace(/\(.*?\)/g, "").trim();
        query = `${complexInfo.regionName} ${cleanName}`;
      }

      const result = await geocodeAddress(query);
      if (result) {
        updateComplexCoords(complexInfo.id, result.lat, result.lng);
        complexInfo.lat = result.lat;
        complexInfo.lng = result.lng;
        console.log(`[Lazy Geocoding] 단지 좌표 확보: ${complexInfo.name} -> (${result.lat}, ${result.lng})`);
      }
    }

    // 좌표가 있는 경우 주변 지하철역 검색 (반경 1km)
    if (complexInfo.lat !== null && complexInfo.lng !== null) {
      subways = await findSubwayStationsNearCoords(complexInfo.lat, complexInfo.lng, 1000);
    }
  }

  // 주변 입지 가중 평점 및 등급 산출
  infraRating = await getComplexInfraRating(
    complexInfo?.lat ?? null,
    complexInfo?.lng ?? null,
    complexName
  );

  const resultPayload = {
    ...data,
    complexInfo,
    subways,
    infraRating
  };
  graphCache.set(cacheKey, resultPayload, TTL.SEARCH);
  res.json(resultPayload);
}));

/** GET /api/graph/context — 데이터 컨텍스트 생성 */
router.get("/context", asyncHandler(async (req, res) => {
  const filter: GraphFilter = {
    lawdCode: req.query.lawdCode as string | undefined,
    complexName: req.query.complexName as string | undefined,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    minArea: req.query.minArea ? Number(req.query.minArea) : undefined,
    maxArea: req.query.maxArea ? Number(req.query.maxArea) : undefined,
  };
  const contextText = await getDataContext(filter);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(contextText);
}));

/** GET /api/graph/collect-stats/daily — 일단위 수집 집계 */
router.get("/collect-stats/daily", asyncHandler(async (_req, res) => {
  const stats = await getDailyCollectionStats();
  res.json(stats);
}));

/** GET /api/graph/collect-stats/monthly — 등록월 단위 수집 집계 */
router.get("/collect-stats/monthly", asyncHandler(async (_req, res) => {
  const stats = await getMonthlyCollectionStats();
  res.json(stats);
}));

/** GET /api/graph/collect-stats/region — 특정 날짜 또는 월의 지역별 수집 집계 */
router.get("/collect-stats/region", asyncHandler(async (req, res) => {
  const date = req.query.date as string | undefined;
  const month = req.query.month as string | undefined;

  if (!date && !month) {
    res.status(400).json({ error: "date 또는 month 파라미터가 누락되었습니다." });
    return;
  }

  if (month) {
    const stats = await getRegionCollectionStatsByMonth(month);
    res.json(stats);
  } else if (date) {
    const stats = await getRegionCollectionStatsByDate(date);
    res.json(stats);
  }
}));

export default router;
