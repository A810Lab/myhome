import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { isTelegramConfigured, sendNotifications } from "./notifications.js";
import { getSourceLimitNotice, runRuleCheck } from "./ruleEngine.js";
import { deleteCheckRun, deleteRule, readState, readStateForUser, updateRulePatch, upsertRule, getSystemConfig, saveSystemConfig } from "./storage.js";
import { getApartmentList, getApartmentPrices } from "./mcpClient.js";
import { isKakaoConfigured, searchAddresses } from "./addressSearch.js";
import { getMonthsInRange, normalizeTransaction } from "./transactions.js";
import type { ComparisonCriteria, RuleInput, SystemConfig } from "./types.js";
import { upsertTransactionBatch, makeGraphDedupeKey, getCachedApartments, saveCachedApartments, searchDbRegions, getLocalTransactionsCount, getLocalApartmentPrices, getUserSettings, saveUserSettings, insertActivityLog, getActivityLogs, getActivityStats, resetGeocodeFailures, updateComplexCoords, resetComplexCoords } from "@myhome/shared";
export type GraphFilter = {
  /** 기존 단일 법정동 코드 */
  lawdCode?: string;
  /** 다중 법정동 코드 (콤마 구분) */
  lawdCodes?: string[];
};
import type { BatchUpsertItem } from "@myhome/shared";
import { adminRequired } from "./authRoutes.js";

const comparisonValues: ComparisonCriteria[] = ["none", "parking", "large_complex", "transit", "newer", "livability"];

const ruleSchema = z.object({
  name: z.string().min(1),
  regionName: z.string().min(1),
  regionCode: z.string().optional(),
  apartmentKeywords: z.array(z.string()).optional(),
  minPriceEok: z.number().positive().optional(),
  maxPriceEok: z.number().positive().optional(),
  minArea: z.number().positive().optional(),
  maxArea: z.number().positive().optional(),
  comparisonCriteria: z.enum(comparisonValues),
  intervalMinutes: z.number().int().min(10).optional(),
  alertTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  channels: z.array(z.enum(["telegram", "kakao"])).min(1),
  enabled: z.boolean()
});

const ruleUpdateSchema = ruleSchema.partial();

function cleanRegionDisplayName(displayName: string): string {
  const match = displayName.match(/\(([^)]+)\)/);
  let address = match ? match[1].trim() : displayName.trim();

  const parts = address.split(/\s+/);
  if (parts.length >= 2) {
    if (parts[0].startsWith("세종")) {
      return "세종특별자치시";
    }
    if (parts.length >= 3 && (parts[2].endsWith("구") || parts[2].endsWith("군"))) {
      return `${parts[0]} ${parts[1]} ${parts[2]}`;
    }
    return `${parts[0]} ${parts[1]}`;
  }
  return address;
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // 개발 및 운영 환경 전체에서 HMR, 다중 API 호출, 대시보드 새로고침으로 인한 429 에러 방지를 위해 한도를 10,000회로 상향 조정
  message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요. (Too many requests from this IP, please try again later.)",
  standardHeaders: true,
  legacyHeaders: false,
});

export function createRouter() {
  const router = express.Router();
  router.use(apiLimiter);

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/config", async (_req, res, next) => {
    try {
      const config = await getSystemConfig();
      res.json({
        telegramConfigured: isTelegramConfigured(),
        kakaoStatus: "phase-2",
        kakaoSearchConfigured: isKakaoConfigured(),
        kakaoConfigured: Boolean(process.env.KAKAO_REST_API_KEY),
        jusoConfigured: Boolean(process.env.JUSO_CONFM_KEY),
        dataGoKrConfigured: Boolean(process.env.DATA_GO_KR_API_KEY),
        kakaoJavascriptConfigured: Boolean(process.env.KAKAO_JAVASCRIPT_KEY),
        kakaoJavascriptKey: process.env.KAKAO_JAVASCRIPT_KEY || "",
        kakaoNativeAppConfigured: Boolean(process.env.KAKAO_NATIVE_APP_KEY),
        dataSourceNotice: getSourceLimitNotice(),
        geminiConfigured: Boolean(config.geminiApiKey || process.env.GEMINI_API_KEY)
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/system-config", adminRequired, async (_req, res, next) => {
    try {
      const config = await getSystemConfig();
      res.json({
        telegramBotToken: config.telegramBotToken ? "●●●●●●●●" : (process.env.TELEGRAM_BOT_TOKEN ? "●●●●●●●●" : ""),
        telegramChatId: config.telegramChatId ? "●●●●●●●●" : (process.env.TELEGRAM_CHAT_ID ? "●●●●●●●●" : ""),
        kakaoRestApiKey: config.kakaoRestApiKey ? "●●●●●●●●" : (process.env.KAKAO_REST_API_KEY ? "●●●●●●●●" : ""),
        jusoConfmKey: config.jusoConfmKey ? "●●●●●●●●" : (process.env.JUSO_CONFM_KEY ? "●●●●●●●●" : ""),
        dataGoKrApiKey: config.dataGoKrApiKey ? "●●●●●●●●" : (process.env.DATA_GO_KR_API_KEY ? "●●●●●●●●" : ""),
        kakaoJavascriptKey: config.kakaoJavascriptKey ? "●●●●●●●●" : (process.env.KAKAO_JAVASCRIPT_KEY ? "●●●●●●●●" : ""),
        kakaoNativeAppKey: config.kakaoNativeAppKey ? "●●●●●●●●" : (process.env.KAKAO_NATIVE_APP_KEY ? "●●●●●●●●" : ""),
        googleClientId: config.googleClientId || (process.env.GOOGLE_CLIENT_ID || ""),
        googleClientSecret: config.googleClientSecret ? "●●●●●●●●" : (process.env.GOOGLE_CLIENT_SECRET ? "●●●●●●●●" : ""),
        googleRedirectUri: config.googleRedirectUri || (process.env.GOOGLE_REDIRECT_URI || ""),
        allowedEmails: config.allowedEmails || (process.env.ALLOWED_EMAILS || ""),
        adminEmails: config.adminEmails || (process.env.ADMIN_EMAILS || ""),
        geminiApiKey: config.geminiApiKey ? "●●●●●●●●" : (process.env.GEMINI_API_KEY ? "●●●●●●●●" : "")
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/system-config", adminRequired, async (req, res, next) => {
    try {
      const body = req.body;
      const update: SystemConfig = {};

      if (body.telegramBotToken !== undefined && body.telegramBotToken !== "●●●●●●●●") {
        update.telegramBotToken = body.telegramBotToken;
      }
      if (body.telegramChatId !== undefined && body.telegramChatId !== "●●●●●●●●") {
        update.telegramChatId = body.telegramChatId;
      }
      if (body.kakaoRestApiKey !== undefined && body.kakaoRestApiKey !== "●●●●●●●●") {
        update.kakaoRestApiKey = body.kakaoRestApiKey;
      }
      if (body.jusoConfmKey !== undefined && body.jusoConfmKey !== "●●●●●●●●") {
        update.jusoConfmKey = body.jusoConfmKey;
      }
      if (body.dataGoKrApiKey !== undefined && body.dataGoKrApiKey !== "●●●●●●●●") {
        update.dataGoKrApiKey = body.dataGoKrApiKey;
      }
      if (body.kakaoJavascriptKey !== undefined && body.kakaoJavascriptKey !== "●●●●●●●●") {
        update.kakaoJavascriptKey = body.kakaoJavascriptKey;
      }
      if (body.kakaoNativeAppKey !== undefined && body.kakaoNativeAppKey !== "●●●●●●●●") {
        update.kakaoNativeAppKey = body.kakaoNativeAppKey;
      }
      if (body.googleClientId !== undefined) {
        update.googleClientId = body.googleClientId;
      }
      if (body.googleClientSecret !== undefined && body.googleClientSecret !== "●●●●●●●●") {
        update.googleClientSecret = body.googleClientSecret;
      }
      if (body.googleRedirectUri !== undefined) {
        update.googleRedirectUri = body.googleRedirectUri;
      }
      if (body.allowedEmails !== undefined) {
        update.allowedEmails = body.allowedEmails;
      }
      if (body.adminEmails !== undefined) {
        update.adminEmails = body.adminEmails;
      }
      if (body.geminiApiKey !== undefined && body.geminiApiKey !== "●●●●●●●●") {
        update.geminiApiKey = body.geminiApiKey;
      }

      await saveSystemConfig(update);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/geocoding/reset-failures", async (req, res, next) => {
    try {
      resetGeocodeFailures();
      res.json({ success: true, message: "Geocoding 실패 상태가 모두 초기화되었습니다." });
    } catch (err) {
      next(err);
    }
  });

  router.put("/complexes/coords", async (req, res, next) => {
    try {
      const { complexId, lat, lng } = req.body;
      if (!complexId || lat === undefined || lng === undefined) {
        res.status(400).json({ error: "complexId, lat, lng are required" });
        return;
      }
      updateComplexCoords(complexId, Number(lat), Number(lng));
      res.json({ success: true, message: "좌표가 수동으로 수정되었습니다." });
    } catch (err) {
      next(err);
    }
  });

  router.post("/complexes/coords/reset", async (req, res, next) => {
    try {
      const { complexId } = req.body;
      if (!complexId) {
        res.status(400).json({ error: "complexId is required" });
        return;
      }
      resetComplexCoords(complexId);
      res.json({ success: true, message: "좌표가 성공적으로 초기화되었습니다." });
    } catch (err) {
      next(err);
    }
  });

  router.get("/regions/search", async (req, res, next) => {
    try {
      const query = String(req.query.query || "");
      if (!query) {
        res.json([]);
        return;
      }

      if (isKakaoConfigured()) {
        const results = await searchAddresses(query);
        res.json(results);
      } else {
        const results = searchDbRegions(query);
        res.json(results);
      }
    } catch (error) {
      next(error);
    }
  });

  router.get("/apartments/list", async (req, res, next) => {
    try {
      const lawdCode = String(req.query.lawd_cd || "");
      const forceRefresh = req.query.refresh === "true";
      if (!lawdCode) {
        res.json({ apartments: [], cachedAt: null });
        return;
      }

      if (!forceRefresh) {
        const cached = getCachedApartments(lawdCode);
        if (cached.cachedAt && cached.apartments.length > 0) {
          res.json(cached);
          return;
        }
      }

      const list = await getApartmentList(lawdCode);
      saveCachedApartments(lawdCode, list);
      const fresh = getCachedApartments(lawdCode);
      res.json(fresh);
    } catch (error) {
      next(error);
    }
  });

  router.get("/transactions", async (req, res, next) => {
    try {
      const lawdCodeParam = String(req.query.lawd_cd || "");
      // 지원: 단일 코드 혹은 콤마 구분 다중 코드
      const lawdCodes = lawdCodeParam
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      // 기존 단일 코드 로직을 유지하기 위해 첫 번째 코드를 기본 lawdCode 로 사용
      const lawdCode = lawdCodes[0] || "";
      const dealMonth = String(req.query.deal_ymd || "");
      const startMonth = String(req.query.start_ymd || "");
      const endMonth = String(req.query.end_ymd || "");
      const forceRefresh = req.query.refresh === "true";
      let regionDisplayName = String(req.query.region_name || "").trim();
      if (!regionDisplayName || /^\d{5}$/.test(regionDisplayName)) {
        try {
          const resolved = searchDbRegions(lawdCode);
          if (resolved.length > 0) {
            regionDisplayName = resolved[0].displayName;
          } else {
            regionDisplayName = lawdCode;
          }
        } catch {
          regionDisplayName = lawdCode;
        }
      }
      regionDisplayName = cleanRegionDisplayName(regionDisplayName);
      if (!lawdCode) {
        res.status(400).json({ error: "lawd_cd is required" });
        return;
      }

      const monthPattern = /^\d{6}$/;
      const months = startMonth && endMonth
        ? (monthPattern.test(startMonth) && monthPattern.test(endMonth) ? getMonthsInRange(startMonth, endMonth) : [])
        : (monthPattern.test(dealMonth) ? [dealMonth] : []);

      if (months.length === 0) {
        res.status(400).json({ error: "deal_ymd(YYYYMM) or start_ymd~end_ymd range is required" });
        return;
      }

      const records: any[] = [];
      // 다중 지역 처리: 각 region에 대해 데이터를 수집
      const regionCodes = lawdCodes.length > 0 ? lawdCodes : [lawdCode];
      const now = new Date();
      const currentYm = now.getFullYear() * 100 + (now.getMonth() + 1);
      let isCacheHitOnly = true;
      const cacheHitMonths: { region: string; month: string }[] = [];
      const apiFetchMonths: { region: string; month: string }[] = [];

      // Determine cache vs API fetch per region/month
      for (const region of lawdCodes.length > 0 ? lawdCodes : [lawdCode]) {
        for (const month of months) {
          const targetYm = parseInt(month);
          const diffMonths = (Math.floor(currentYm / 100) - Math.floor(targetYm / 100)) * 12 + (currentYm % 100 - targetYm % 100);
          const localCount = getLocalTransactionsCount(region, month);
          if (!forceRefresh && diffMonths > 3 && localCount > 0) {
            cacheHitMonths.push({ region, month });
          } else {
            apiFetchMonths.push({ region, month });
          }
        }
      }

      // Serve cached data
      for (const { region, month } of cacheHitMonths) {
        const localRecords = getLocalApartmentPrices(region, month);
        records.push(...localRecords);
        console.log(`[Cache Hit] ${region}/${month} - 로컬 DB 적재 데이터 서빙 (건수: ${localRecords.length})`);
      }

      // Fetch from API with concurrency limit
      if (apiFetchMonths.length > 0) {
        isCacheHitOnly = false;
        const concurrencyLimit = 5;
        for (let i = 0; i < apiFetchMonths.length; i += concurrencyLimit) {
          const chunk = apiFetchMonths.slice(i, i + concurrencyLimit);
          const chunkResults = await Promise.all(
            chunk.map(async ({ region, month }) => {
              try {
                const prices = await getApartmentPrices(region, month);
                return { region, month, transactions: prices.transactions, success: true };
              } catch (err: any) {
                console.error(`❌ [API Error] ${region}/${month} 호출 실패:`, err.message);
                return { region, month, transactions: [], success: false };
              }
            })
          );
          for (const resObj of chunkResults) {
            if (!resObj.success) continue;
            const apiRecords: any[] = [];
            for (const item of resObj.transactions) {
              const normalized = normalizeTransaction(item, resObj.month);
              if (normalized) {
                records.push(normalized);
                apiRecords.push(normalized);
              }
            }
            console.log(`[Cache Miss/Refresh] ${resObj.region}/${resObj.month} - 국토부 API 호출 (반환: ${apiRecords.length}건)`);
          }
        }
      }

      // Return aggregated records
      res.json(records);

      // Optional graph DB upsert when fresh data fetched
      if (process.env.GRAPH_DB_ENABLED === "true" && records.length > 0 && !isCacheHitOnly) {
        const regionInfo = { lawdCode: lawdCodes.length > 0 ? lawdCodes[0] : lawdCode, displayName: regionDisplayName };
        const batchItems: BatchUpsertItem[] = records.map(rec => {
          const rawObj = (rec as any).raw && typeof (rec as any).raw === "object" ? (rec as any).raw as Record<string, unknown> : {};
          return {
            complexName: rec.apartmentName,
            tx: {
              dedupeKey: makeGraphDedupeKey(lawdCode, rec.apartmentName, rec.dealDate, rec.areaM2, rec.floor),
              dealDate: rec.dealDate,
              priceEok: rec.priceEok,
              areaM2: rec.areaM2,
              floor: rec.floor,
            },
            addressInfo: {
              dongName: (rawObj.dongName ?? rawObj.umdNm ?? undefined) as string | undefined,
              jibun: (rawObj.jibun ?? undefined) as string | undefined,
              roadName: (rawObj.roadName ?? rawObj.roadNm ?? undefined) as string | undefined,
            },
          };
        });
        // 전체를 단일 트랜잭션으로 묶어 HDD fsync 병목 해소 (N번→1번)
        upsertTransactionBatch(regionInfo, batchItems).catch((err: any) =>
          console.error(`[graphDb] 탐색 배치 upsert 실패 (${records.length}건):`, err)
        );
      }
    } catch (error) {
      next(error);
    }
  });

  router.get("/transactions/batch", async (req, res, next) => {
    try {
      const { lawdCode, startMonth, endMonth } = req.query as Record<string, string>;
      
      if (!lawdCode || !startMonth || !endMonth) {
        return res.status(400).json({ error: 'lawd_cd, start_ymd, and end_ymd are required' });
      }
      
      const monthPattern = /^\d{6}$/;
      if (!monthPattern.test(startMonth) || !monthPattern.test(endMonth)) {
        return res.status(400).json({ error: 'start_ymd and end_ymd must be in YYYYMM format' });
      }

      const months = getMonthsInRange(startMonth, endMonth);
      const results = await Promise.all(
        months.map((m) => getApartmentPrices(lawdCode, m))
      );
      const flattened = results.map((r) => r.transactions).flat();
      
      res.json({ ok: true, data: flattened });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rules", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const state = await readStateForUser(email);
      res.json(state.rules);
    } catch (error) {
      next(error);
    }
  });

  router.post("/rules", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const input = ruleSchema.parse(req.body) satisfies RuleInput;
      const rule = await upsertRule(input, undefined, email);
      res.status(201).json(rule);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/rules/:id", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const parsedBody = ruleUpdateSchema.parse(req.body);
      const rule = await updateRulePatch(req.params.id, parsedBody, email);
      if (!rule) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.json(rule);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/rules/:id", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const deleted = await deleteRule(req.params.id, email);
      if (!deleted) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/rules/:id/run", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const state = await readStateForUser(email);
      const rule = state.rules.find((item) => item.id === req.params.id);
      if (!rule) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }
      const outcome = await runRuleCheck(rule);
      const notifications = await sendNotifications(rule, outcome.newMatches, email);
      res.json({ ...outcome, notifications });
    } catch (error) {
      next(error);
    }
  });

  router.get("/check-runs", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const state = await readStateForUser(email);
      res.json(state.checkRuns);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/check-runs/:id", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const deleted = await deleteCheckRun(req.params.id, email);
      if (!deleted) {
        res.status(404).json({ error: "Check run not found" });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/notifications", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const state = await readStateForUser(email);
      res.json(state.notifications);
    } catch (error) {
      next(error);
    }
  });

  router.post("/logs", async (req, res, next) => {
    try {
      const email = req.user?.email || "anonymous";
      const { activityType, description, payload } = req.body;
      
      if (!activityType || !description) {
        res.status(400).json({ error: "activityType and description are required" });
        return;
      }
      
      insertActivityLog({
        userEmail: email,
        activityType,
        description,
        payload: payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : undefined,
        ipAddress: req.ip || req.headers["x-forwarded-for"] as string || undefined,
        userAgent: req.headers["user-agent"] || undefined
      });
      
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/logs", adminRequired, async (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit as string || "20");
      const offset = parseInt(req.query.offset as string || "0");
      const userEmail = req.query.userEmail as string || undefined;
      const activityType = req.query.activityType as string || undefined;
      
      const result = getActivityLogs(limit, offset, userEmail, activityType);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/logs/stats", adminRequired, async (req, res, next) => {
    try {
      const stats = getActivityStats();
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  router.get("/user-config", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const settings = getUserSettings(email);
      res.json({
        telegramBotToken: settings?.telegramBotToken ? "●●●●●●●●" : "",
        telegramChatId: settings?.telegramChatId ? "●●●●●●●●" : "",
        kakaoRestApiKey: settings?.kakaoRestApiKey ? "●●●●●●●●" : "",
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/user-config", async (req, res, next) => {
    try {
      const email = req.user?.email || "bootstrap-admin@myhome.local";
      const body = req.body;
      const update: { telegramBotToken?: string | null; telegramChatId?: string | null; kakaoRestApiKey?: string | null } = {};

      if (body.telegramBotToken !== undefined && body.telegramBotToken !== "●●●●●●●●") {
        update.telegramBotToken = body.telegramBotToken;
      }
      if (body.telegramChatId !== undefined && body.telegramChatId !== "●●●●●●●●") {
        update.telegramChatId = body.telegramChatId;
      }
      if (body.kakaoRestApiKey !== undefined && body.kakaoRestApiKey !== "●●●●●●●●") {
        update.kakaoRestApiKey = body.kakaoRestApiKey;
      }

      saveUserSettings(email, update);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.issues });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  });

  return router;
}