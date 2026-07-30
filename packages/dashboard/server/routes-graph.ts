import { Router } from "express";
import {
  getComplexTrend,
  getRegionTrend,
  getGraphStats,
  searchTransactions,
  getDrilldownRegions,
  getDrilldownComplexes,
  getDrilldownAreas,
  getGraphTopology,
  getComplexDetail,
  getDataContext,
  searchComplexNames,
  GraphFilter,
  getAllDbRegions,
  getDbRegionsSummary,
  insertDbRegion,
  getComplexesByRegion,
  getDailyCollectionStats,
  getRegionCollectionStatsByDate,
  getMonthlyCollectionStats,
  getRegionCollectionStatsByMonth,
  readPresetsCore,
  savePresetCore,
  deletePresetCore,
  getCheckRunsByEmail,
  appendCheckRunDb,
  deleteCheckRunDb,
  getNotificationsByEmail,
  appendNotificationDb,
  getSystemConfigDb,
  saveSystemConfigDb,
  getRulesByEmail,
  upsertRuleDb,
  deleteRuleDb,
  getComplexGeo,
  updateComplexCoords,
  upsertTransactionBatch,
  makeGraphDedupeKey,
  getLocalTransactionsCount,
  fetchApartmentPricesDirect,
  normalizeTransaction,
} from "@myhome/shared";
import type { BatchUpsertItem } from "@myhome/shared";
import { Config } from "./config.js";
import { readPresets, savePreset, deletePreset } from "./graphPresets.js";
import { readInsights, saveInsight, deleteInsight } from "./graphInsights.js";
import { findComplexesNearStation, batchGeocodeComplexes, geocodeAddress, findSubwayStationsNearCoords, getComplexInfraRating } from "./geocoding.js";
import { generateTextWithGemini } from "./llmClient.js";
import { graphCache } from "./cache.js";



export function createGraphRouter(): Router {
  const router = Router();

  /** GET /api/graph/db-regions — DB에 등록된 모든 지역 목록 */
  router.get("/db-regions", async (_req, res) => {
    try {
      const regions = await getAllDbRegions();
      res.json(regions);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/regions-summary — DB 수집 지역별 요약 통계 */
  router.get("/regions-summary", async (_req, res) => {
    try {
      const cacheKey = "regions-summary";
      const cached = graphCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const summary = await getDbRegionsSummary();
      graphCache.set(cacheKey, summary);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** POST /api/graph/regions — 신규 수집 지역 추가 */
  router.post("/regions", async (req, res) => {
    try {
      const { lawdCode, displayName } = req.body;
      if (!lawdCode || !displayName) {
        res.status(400).json({ error: "lawdCode 또는 displayName이 누락되었습니다." });
        return;
      }
      await insertDbRegion(lawdCode, displayName);
      graphCache.clear(); // 신규 지역 추가 시 캐시 클리어
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/region-complexes — 특정 지역에 등록된 아파트 단지 목록 */
  router.get("/region-complexes", async (req, res) => {
    try {
      const lawdCode = req.query.lawdCode as string | undefined;
      const cacheKey = `region-complexes:${lawdCode ?? ""}`;
      const cached = graphCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const complexes = await getComplexesByRegion(lawdCode);
      graphCache.set(cacheKey, complexes);
      res.json(complexes);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/stats — 전체 노드 수 통계 */
  router.get("/stats", async (_req, res) => {
    try {
      const cacheKey = "stats";
      const cached = graphCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const stats = await getGraphStats();
      graphCache.set(cacheKey, stats);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/complexes/search — 단지명 글로벌 검색 */
  router.get("/complexes/search", async (req, res) => {
    try {
      const query = (req.query.q as string || "").trim();
      const lawdCode = req.query.lawdCode as string | undefined;
      if (!query && !lawdCode) {
        res.json([]);
        return;
      }
      const results = await searchComplexNames(query, lawdCode);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/complex/:name/trend */
  router.get("/complex/:name/trend", async (req, res) => {
    try {
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
      graphCache.set(cacheKey, result);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/region/:lawdCode/trend */
  router.get("/region/:lawdCode/trend", async (req, res) => {
    try {
      const { lawdCode } = req.params;
      const cacheKey = `trend:region:${lawdCode}`;
      const cached = graphCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const trend = await getRegionTrend(lawdCode);
      const result = { lawdCode, trend };
      graphCache.set(cacheKey, result);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/search — 필터 조건 검색 */
  router.get("/search", async (req, res) => {
    try {
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
      graphCache.set(cacheKey, results);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/drilldown/regions — 드릴다운: 시/도 레벨 */
  router.get("/drilldown/regions", async (req, res) => {
    try {
      const complexName = req.query.complexName as string | undefined;
      const cacheKey = `drilldown:regions:${complexName ?? ""}`;
      const cached = graphCache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const data = await getDrilldownRegions(complexName);
      graphCache.set(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/drilldown/complexes — 드릴다운: 아파트 단지별 */
  router.get("/drilldown/complexes", async (req, res) => {
    try {
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
      graphCache.set(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/drilldown/areas — 드릴다운: 평수별 */
  router.get("/drilldown/areas", async (req, res) => {
    try {
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
      graphCache.set(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/topology — 노드-링크용 토폴로지 데이터 */
  router.get("/topology", async (req, res) => {
    try {
      const filter: GraphFilter = {
        lawdCode: req.query.lawdCode as string | undefined,
        complexName: req.query.complexName as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      };
      const data = await getGraphTopology(filter);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/complex/:name/detail — 단지별 입체 분석 */
  router.get("/complex/:name/detail", async (req, res) => {
    try {
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
      graphCache.set(cacheKey, resultPayload);
      res.json(resultPayload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/context — LLM 프롬프트 요약 텍스트 생성 */
  router.get("/context", async (req, res) => {
    try {
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
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/collect-stats/daily — 일단위 수집 집계 */
  router.get("/collect-stats/daily", async (_req, res) => {
    try {
      const stats = await getDailyCollectionStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/collect-stats/monthly — 등록월 단위 수집 집계 */
  router.get("/collect-stats/monthly", async (_req, res) => {
    try {
      const stats = await getMonthlyCollectionStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/collect-stats/region — 특정 날짜 또는 월의 지역별 수집 집계 */
  router.get("/collect-stats/region", async (req, res) => {
    try {
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
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  // 조회 조건 프리셋 라우트 (기존 graph_presets 테이블 사용)
  router.get("/presets", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const presets = await readPresets(email);
      res.json(presets);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.post("/presets", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const { name, filter } = req.body;
      if (!name || !filter) {
        res.status(400).json({ error: "name 또는 filter가 누락되었습니다." });
        return;
      }
      const newPreset = await savePreset({ name, filter }, email);
      res.status(201).json(newPreset);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.delete("/presets/:id", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const { id } = req.params;
      const success = await deletePreset(id, email);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "존재하지 않는 프리셋 ID입니다." });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  // 종합 현황용 프리셋 라우트 (지역만 저장, graph_presets_overview 테이블 사용)
  router.get("/presets/overview", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const presets = await readPresetsCore(email, "overview");
      res.json(presets);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.post("/presets/overview", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const { name, filter } = req.body;
      if (!name || !filter) {
        res.status(400).json({ error: "name 또는 filter가 누락되었습니다." });
        return;
      }
      const newPreset = await savePresetCore({ name, filter }, email, "overview");
      res.status(201).json(newPreset);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.delete("/presets/overview/:id", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const { id } = req.params;
      const success = await deletePresetCore(id, email, "overview");
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "존재하지 않는 프리셋 ID입니다." });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  // 단지 분석용 프리셋 라우트 (지역 + 단지명 + 평수 저장, graph_presets_analysis 테이블 사용)
  router.get("/presets/analysis", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const presets = await readPresetsCore(email, "analysis");
      res.json(presets);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.post("/presets/analysis", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const { name, regionName, buildingName, areaM2 } = req.body;
      if (!name || !regionName || !buildingName) {
        res.status(400).json({ error: "name, regionName, buildingName이 필요합니다." });
        return;
      }
      const newPreset = await savePresetCore({ name, regionName, buildingName, areaM2 }, email, "analysis");
      res.status(201).json(newPreset);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.delete("/presets/analysis/:id", async (req, res) => {
    try {
      let email = req.user?.email;
if (!email) {
  if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
    email = "bootstrap-admin@myhome.local";
  } else {
    return res.status(401).json({ error: "Authentication required" });
  }
}
      const { id } = req.params;
      const success = await deletePresetCore(id, email, "analysis");
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "존재하지 않는 프리셋 ID입니다." });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  // LLM 인사이트 라우트 (graphInsights.ts 파일 사용)
  router.get("/insights", async (_req, res) => {
    try {
      const insights = await readInsights();
      res.json(insights);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.post("/insights", async (req, res) => {
    try {
      const { title, filter, promptTemplate, generatedPrompt, response, source } = req.body;
      if (!title || !generatedPrompt) {
        res.status(400).json({ error: "title 또는 generatedPrompt가 누락되었습니다." });
        return;
      }
      const newInsight = await saveInsight({
        title,
        filter,
        promptTemplate,
        generatedPrompt,
        response,
        source: source || "manual",
      });
      res.status(201).json(newInsight);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  router.delete("/insights/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await deleteInsight(id);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "존재하지 않는 인사이트 ID입니다." });
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** POST /api/graph/insights/generate — LLM을 통한 분석 리포트 생성 및 저장 */
  router.post("/insights/generate", async (req, res) => {
    try {
      const { lawdCode, complexName, regionName } = req.body;
      if (!lawdCode) {
        res.status(400).json({ error: "lawdCode 파라미터가 필요합니다." });
        return;
      }

      const filter: GraphFilter = {
        lawdCode,
        complexName: complexName || undefined,
        startDate: undefined,
        endDate: undefined,
      };

      // 1. 실거래 요약 텍스트 컨텍스트 생성
      const contextText = await getDataContext(filter);

      // 2. 프롬프트 조립
      const targetName = complexName ? `${complexName} (${regionName || lawdCode})` : (regionName || lawdCode);
      const prompt = `
아래는 ${targetName} 아파트 실거래 데이터 요약 정보입니다.
이 데이터를 심층 분석하여 최근 거래 동향, 가격 추이의 특징(상승/하락/보합세), 그리고 실주거 및 투자 관점에서의 의견을 정리한 종합 분석 리포트를 작성해 주세요.

[실거래 데이터 정보]
${contextText}

[작성 규칙]
1. 한글로 작성해 주세요.
2. 가독성을 위해 마크다운(Markdown) 형식(소제목, 글머리 기호, 굵은 글씨 등)을 풍부하게 활용하세요.
3. 데이터에 기반하여 핵심 트렌드(평균가 변화량, 최고가 대비 현 시세 비율, 거래 활성도 등)를 정확하게 해석해 주세요.
4. 분석 마지막 부분에는 이 지역/단지에 대한 종합 투자 및 거주 요약 의견을 2~3줄 요약 문단으로 명시해 주세요.
`;

      // 3. Gemini API 호출
      const generatedReport = await generateTextWithGemini(prompt);

      // 4. 리포트 저장
      const title = complexName ? `${complexName} 실거래 분석 리포트` : `${regionName || lawdCode} 지역 실거래 분석 리포트`;
      const newInsight = await saveInsight({
        title,
        filter: { lawdCode, complexName },
        promptTemplate: "default-apartment-analysis",
        generatedPrompt: prompt,
        response: generatedReport,
        source: "api",
      });

      res.status(201).json(newInsight);
    } catch (err: any) {
      console.error("AI Insight generation failed:", err);
      res.status(500).json({ error: err?.message ?? "인사이트 생성 도중 내부 서버 오류가 발생했습니다." });
    }
  });

  // ──────────────────────────────────────────────────
  // 역세권 / Geocoding API
  // ──────────────────────────────────────────────────

  /** GET /api/graph/nearby-station — 지하철역 반경 내 아파트 단지 검색 */
  router.get("/nearby-station", async (req, res) => {
    try {
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
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /**
   * POST /api/graph/complex-fetch
   * 특정 단지의 최근 12개월 실거래 데이터를 국토부 API에서 가져와 DB에 적재
   * Body: { complexName: string; lawdCode: string; regionName?: string }
   * Response: { inserted: number; months: string[]; alreadyCached: string[] }
   */
  router.post("/complex-fetch", async (req, res) => {
    try {
      const { complexName, lawdCode, regionName } = req.body as {
        complexName: string;
        lawdCode: string;
        regionName?: string;
      };

      if (!complexName || !lawdCode) {
        res.status(400).json({ error: "complexName과 lawdCode가 필요합니다." });
        return;
      }

      // 최근 12개월 목록 생성
      const now = new Date();
      const currentYm = now.getFullYear() * 100 + (now.getMonth() + 1);
      const months: string[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
        months.push(ym);
      }

      // 캐시 정책 적용 (02_CACHE_POLICY.md 준수)
      const apiFetchMonths: string[] = [];
      const alreadyCached: string[] = [];

      for (const month of months) {
        const targetYm = parseInt(month);
        const diffMonths =
          (Math.floor(currentYm / 100) - Math.floor(targetYm / 100)) * 12 +
          (currentYm % 100 - targetYm % 100);
        const localCount = getLocalTransactionsCount(lawdCode, month);

        if (diffMonths > 3 && localCount > 0) {
          // 3개월 초과 과거 + 데이터 있음 → 캐시 히트
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

      // API 호출 및 DB 적재 (최대 3 동시 처리)
      const concurrencyLimit = 3;
      for (let i = 0; i < apiFetchMonths.length; i += concurrencyLimit) {
        const chunk = apiFetchMonths.slice(i, i + concurrencyLimit);
        const results = await Promise.all(
          chunk.map(async (month) => {
            try {
              const transactions = await fetchApartmentPricesDirect(lawdCode, month);
              // 해당 단지 데이터만 필터링하여 적재
              const items: BatchUpsertItem[] = [];
              for (const rawTx of transactions) {
                const norm = normalizeTransaction(rawTx, month);
                if (!norm) continue;
                // 단지명 필터 (해당 단지 + 지역 전체 적재 - 국토부 API는 지역 단위 조회)
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
              // 해당 단지 건수만 카운트
              return items.filter((item) => item.complexName === complexName).length;
            } catch (err: any) {
              console.error(`[complex-fetch] ${lawdCode}/${month} 실패:`, err.message);
              return 0;
            }
          })
        );
        insertedTotal += results.reduce((a, b) => a + b, 0);
      }

      console.log(
        `[complex-fetch] ${complexName} 완료: ${insertedTotal}건 적재 (${apiFetchMonths.length}개월 API 호출)`
      );

      graphCache.clear(); // 데이터 추가 완료 후 캐시 전체 무효화

      res.json({
        ok: true,
        complexName,
        lawdCode,
        inserted: insertedTotal,
        months: apiFetchMonths,
        alreadyCached,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** POST /api/graph/geocode-batch — 좌표 미확보 단지 일괄 Geocoding */
  router.post("/geocode-batch", async (req, res) => {
    try {
      const lawdCode = req.body?.lawdCode as string | undefined;
      const limit = typeof req.body?.limit === "number" ? req.body.limit : undefined;
      const result = await batchGeocodeComplexes(lawdCode, limit);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  /** GET /api/graph/geocode-stats — Geocoding 현황 통계 */
  router.get("/geocode-stats", async (_req, res) => {
    try {
      const { getGeocodeStats } = await import("@myhome/shared");
      const stats = getGeocodeStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "내부 오류" });
    }
  });

  return router;
}