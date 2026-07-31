import { Router } from "express";
import {
  getLocalTransactionsCount,
  fetchApartmentPricesDirect,
  normalizeTransaction,
  makeGraphDedupeKey,
  upsertTransactionBatch,
  getGeocodeStats,
  mapLimit,
  getComplexesMissingCoords,
  type BatchUpsertItem
} from "@myhome/shared";
import {
  findComplexesNearStation,
  batchGeocodeComplexes
} from "../../geocoding.js";
import { graphCache } from "../../cache.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";

const router = Router();

/** GET /api/graph/nearby-station — 지하철역 반경 내 아파트 단지 검색 */
router.get("/nearby-station", asyncHandler(async (req, res) => {
  const station = (req.query.station as string || "").trim();
  const radius = req.query.radius ? Number(req.query.radius) : 500;
  if (!station) {
    res.status(400).json({ error: "station 파라미터가 누락되었습니다." });
    return;
  }
  if (radius < 100 || radius > 5000) {
    res.status(400).json({ error: "radius는 100~5000 사이여야 합니다." });
    return;
  }
  const live = req.query.live === "true";
  const result = await findComplexesNearStation(station, radius, live);
  res.json(result);
}));

/**
 * POST /api/graph/complex-fetch
 * 특정 단지의 최근 12개월 실거래 데이터를 국토부 API에서 가져와 DB에 적재
 */
router.post("/complex-fetch", asyncHandler(async (req, res) => {
  const { complexName, lawdCode, regionName } = req.body as {
    complexName: string;
    lawdCode: string;
    regionName?: string;
  };

  if (!complexName || !lawdCode) {
    res.status(400).json({ error: "complexName과 lawdCode가 필요합니다." });
    return;
  }

  const now = new Date();
  const currentYm = now.getFullYear() * 100 + (now.getMonth() + 1);
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(ym);
  }

  const apiFetchMonths: string[] = [];
  const alreadyCached: string[] = [];

  for (const month of months) {
    const targetYm = parseInt(month);
    const diffMonths =
      (Math.floor(currentYm / 100) - Math.floor(targetYm / 100)) * 12 +
      (currentYm % 100 - targetYm % 100);
    const localCount = getLocalTransactionsCount(lawdCode, month);

    if (diffMonths > 3 && localCount > 0) {
      alreadyCached.push(month);
    } else {
      apiFetchMonths.push(month);
    }
  }

  console.log(
    `[complex-fetch] ${complexName} (${lawdCode}): API 조회 ${apiFetchMonths.length}개월, 캐시 히트 ${alreadyCached.length}개월`
  );

  let insertedTotal = 0;
  const displayName = regionName || lawdCode;
  const regionInfo = { lawdCode, displayName };

  const results = await mapLimit(apiFetchMonths, 3, async (month) => {
    try {
      const transactions = await fetchApartmentPricesDirect(lawdCode, month);
      const items: BatchUpsertItem[] = [];
      for (const rawTx of transactions) {
        const norm = normalizeTransaction(rawTx, month);
        if (!norm) continue;
        items.push({
          complexName: norm.apartmentName,
          tx: {
            dedupeKey: makeGraphDedupeKey(
              lawdCode,
              norm.apartmentName,
              norm.dealDate,
              norm.areaM2,
              norm.floor
            ),
            dealDate: norm.dealDate,
            priceEok: norm.priceEok,
            areaM2: norm.areaM2,
            floor: norm.floor,
          },
          addressInfo: {
            dongName: norm.dongName,
            jibun: norm.jibun,
            roadName: norm.roadName,
          },
        });
      }

      if (items.length > 0) {
        await upsertTransactionBatch(regionInfo, items);
      }
      return items.filter((item) => item.complexName === complexName).length;
    } catch (err: any) {
      console.error(`[complex-fetch] ${lawdCode}/${month} 실패:`, err.message);
      return 0;
    }
  });

  insertedTotal = results.reduce((a, b) => a + b, 0);

  console.log(
    `[complex-fetch] ${complexName} 완료: ${insertedTotal}건 적재 (${apiFetchMonths.length}개월 API 호출)`
  );

  graphCache.invalidateByPrefix("trend:");
  graphCache.invalidateByPrefix("search:");
  graphCache.invalidateByPrefix("detail:");
  res.json({
    ok: true,
    complexName,
    lawdCode,
    inserted: insertedTotal,
    months: apiFetchMonths,
    alreadyCached,
  });
}));

/** POST /api/graph/geocode-batch — 좌표 미확보 단지 일괄 Geocoding */
router.post("/geocode-batch", asyncHandler(async (req, res) => {
  const lawdCode = req.body?.lawdCode as string | undefined;
  const limit = typeof req.body?.limit === "number" ? req.body.limit : undefined;
  const result = await batchGeocodeComplexes(lawdCode, limit);
  res.json(result);
}));

/** GET /api/graph/geocode-stats — Geocoding 현황 통계 */
router.get("/geocode-stats", asyncHandler(async (_req, res) => {
  const stats = getGeocodeStats();
  res.json(stats);
}));

/** GET /api/graph/geocode-pending — 위경도 좌표가 없는 단지 목록 */
router.get("/geocode-pending", asyncHandler(async (_req, res) => {
  const list = getComplexesMissingCoords();
  res.json(list);
}));

export default router;
