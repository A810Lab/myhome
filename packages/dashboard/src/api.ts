import type { AppConfig, CheckRun, NotificationRecord, RegionSearchResult, RuleInput, TransactionRecord, WatchRule, ApartmentListResponse, UserActivityLog, ActivityStats } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as unknown as T;
  }
  return response.json() as Promise<T>;
}

export async function loadDashboard() {
  const [rules, checkRuns, notifications, config, dbStats] = await Promise.all([
    request<WatchRule[]>("/api/rules"),
    request<CheckRun[]>("/api/check-runs"),
    request<NotificationRecord[]>("/api/notifications"),
    request<AppConfig>("/api/config"),
    request<{ regions: number; complexes: number; transactions: number }>("/api/graph/stats").catch((err) => {
      console.warn("Failed to load db stats:", err);
      return { regions: 0, complexes: 0, transactions: 0 };
    })
  ]);
  return { rules, checkRuns, notifications, config, dbStats };
}

export function createRule(input: RuleInput) {
  return request<WatchRule>("/api/rules", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchRule(id: string, patch: Partial<WatchRule>) {
  return request<WatchRule>(`/api/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteRule(id: string) {
  return request<void>(`/api/rules/${id}`, { method: "DELETE" });
}

export function deleteCheckRun(id: string) {
  return request<void>(`/api/check-runs/${id}`, { method: "DELETE" });
}

export function searchRegions(query: string) {
  return request<RegionSearchResult[]>(`/api/regions/search?query=${encodeURIComponent(query)}`);
}

export function getApartments(lawdCode: string, forceRefresh = false) {
  return request<ApartmentListResponse>(`/api/apartments/list?lawd_cd=${lawdCode}${forceRefresh ? "&refresh=true" : ""}`);
}

export function runRule(id: string) {
  return request(`/api/rules/${id}/run`, { method: "POST" });
}

export function searchTransactions(lawdCode: string, regionName: string, period: { dealMonth: string } | { startMonth: string; endMonth: string }, refresh = false) {
  const params = new URLSearchParams({ lawd_cd: lawdCode, region_name: regionName });
  if ("dealMonth" in period) {
    params.set("deal_ymd", period.dealMonth);
  } else {
    params.set("start_ymd", period.startMonth);
    params.set("end_ymd", period.endMonth);
  }
  if (refresh) {
    params.set("refresh", "true");
  }
  return request<TransactionRecord[]>(`/api/transactions?${params.toString()}`);
}

// 📊 SQLite 실거래 DB 분석 API

import type {
  GraphStats,
  GraphFilter,
  GraphTopologyData,
  GraphPreset,
  Insight,
  TrendPoint,
  ComplexSearchResult,
  DailyCollectStat,
  RegionCollectStat
} from "@myhome/shared";

export function loadGraphStats() {
  return request<GraphStats>("/api/graph/stats");
}

export function searchComplexNames(query: string, lawdCode?: string) {
  const params = new URLSearchParams({ q: query });
  if (lawdCode) params.set("lawdCode", lawdCode);
  return request<ComplexSearchResult[]>(`/api/graph/complexes/search?${params.toString()}`);
}

export function loadGraphComplexTrend(complexName: string, lawdCode?: string) {
  const query = lawdCode ? `?lawdCode=${lawdCode}` : "";
  return request<{ complexName: string; lawdCode?: string; trend: TrendPoint[] }>(
    `/api/graph/complex/${encodeURIComponent(complexName)}/trend${query}`
  );
}

export function loadGraphRegionTrend(lawdCode: string) {
  return request<{ lawdCode: string; trend: TrendPoint[] }>(`/api/graph/region/${lawdCode}/trend`);
}

export function searchGraphTransactions(filter: GraphFilter) {
  const params = new URLSearchParams();
  if (filter.lawdCodes && filter.lawdCodes.length > 0) {
    filter.lawdCodes.forEach((code) => params.append("lawdCodes", code));
  } else if (filter.lawdCode) {
    params.set("lawdCode", filter.lawdCode);
  }
  if (filter.complexName) params.set("complexName", filter.complexName);
  if (filter.startDate) params.set("startDate", filter.startDate);
  if (filter.endDate) params.set("endDate", filter.endDate);
  if (filter.minArea !== undefined) params.set("minArea", String(filter.minArea));
  if (filter.maxArea !== undefined) params.set("maxArea", String(filter.maxArea));

  return request<any[]>(`/api/graph/search?${params.toString()}`);
}

export function loadDrilldownRegions(complexName?: string) {
  const params = new URLSearchParams();
  if (complexName) params.set("complexName", complexName);
  return request<any[]>(`/api/graph/drilldown/regions?${params.toString()}`);
}

export function loadDrilldownComplexes(lawdCode: string, complexName?: string) {
  const params = new URLSearchParams({ lawdCode });
  if (complexName) params.set("complexName", complexName);
  return request<any[]>(`/api/graph/drilldown/complexes?${params.toString()}`);
}

export function loadDrilldownAreas(complex: string, lawdCode?: string) {
  const params = new URLSearchParams({ complex });
  if (lawdCode) params.set("lawdCode", lawdCode);
  return request<any[]>(`/api/graph/drilldown/areas?${params.toString()}`);
}

export function loadGraphTopology(filter: GraphFilter) {
  const params = new URLSearchParams();
  if (filter.lawdCode) params.set("lawdCode", filter.lawdCode);
  if (filter.complexName) params.set("complexName", filter.complexName);
  if (filter.startDate) params.set("startDate", filter.startDate);
  if (filter.endDate) params.set("endDate", filter.endDate);

  return request<GraphTopologyData>(`/api/graph/topology?${params.toString()}`);
}

export function loadComplexDetail(complexName: string, lawdCode?: string, area?: number, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (lawdCode) params.set("lawdCode", lawdCode);
  if (area !== undefined && area !== null) params.set("area", String(area));
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<any>(`/api/graph/complex/${encodeURIComponent(complexName)}/detail${query}`);
}

export function fetchDbRegions() {
  return request<{ lawdCode: string; displayName: string }[]>("/api/graph/db-regions");
}

export function fetchComplexesByRegion(lawdCode?: string) {
  const params = new URLSearchParams();
  if (lawdCode) params.set("lawdCode", lawdCode);
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<string[]>(`/api/graph/region-complexes${query}`);
}

export async function loadGraphContext(filter: GraphFilter): Promise<string> {
  const params = new URLSearchParams();
  if (filter.lawdCode) params.set("lawdCode", filter.lawdCode);
  if (filter.complexName) params.set("complexName", filter.complexName);
  if (filter.startDate) params.set("startDate", filter.startDate);
  if (filter.endDate) params.set("endDate", filter.endDate);
  if (filter.minArea !== undefined) params.set("minArea", String(filter.minArea));
  if (filter.maxArea !== undefined) params.set("maxArea", String(filter.maxArea));

  const response = await fetch(`/api/graph/context?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load graph context");
  }
  return response.text();
}

// ⚙️ 조회 조건 프리셋 관리 API

export function loadPresets() {
  return request<GraphPreset[]>("/api/graph/presets");
}

export function savePreset(name: string, filter: GraphFilter) {
  return request<GraphPreset>("/api/graph/presets", {
    method: "POST",
    body: JSON.stringify({ name, filter }),
  });
}

export function deletePreset(id: string) {
  return request<void>(`/api/graph/presets/${id}`, { method: "DELETE" });
}

// 종합 현황용 프리셋 API
export function loadPresetsOverview() {
  return request<GraphPreset[]>("/api/graph/presets/overview");
}

export function savePresetOverview(name: string, filter: GraphFilter) {
  return request<GraphPreset>("/api/graph/presets/overview", {
    method: "POST",
    body: JSON.stringify({ name, filter }),
  });
}

export function deletePresetOverview(id: string) {
  return request<void>(`/api/graph/presets/overview/${id}`, { method: "DELETE" });
}

// 단지 분석용 프리셋 API
export function loadPresetsAnalysis() {
  return request<any[]>("/api/graph/presets/analysis");
}

export function savePresetAnalysis(preset: { name: string; regionName: string; buildingName: string; areaM2?: number }) {
  return request<any>("/api/graph/presets/analysis", {
    method: "POST",
    body: JSON.stringify(preset),
  });
}

export function deletePresetAnalysis(id: string) {
  return request<void>(`/api/graph/presets/analysis/${id}`, { method: "DELETE" });
}


// 💡 LLM 인사이트 관리 API

export function loadInsights() {
  return request<Insight[]>("/api/graph/insights");
}

export function saveInsight(insight: Omit<Insight, "id" | "createdAt">) {
  return request<Insight>("/api/graph/insights", {
    method: "POST",
    body: JSON.stringify(insight),
  });
}

export function deleteInsight(id: string) {
  return request<void>(`/api/graph/insights/${id}`, { method: "DELETE" });
}

export function generateInsight(lawdCode: string, complexName?: string, regionName?: string) {
  return request<Insight>("/api/graph/insights/generate", {
    method: "POST",
    body: JSON.stringify({ lawdCode, complexName, regionName }),
  });
}

export function loadAdminDbTables() {
  return request<{ tables: string[]; schemas: Record<string, any[]> }>("/api/admin/db/tables");
}

export function executeAdminDbQuery(sql: string) {
  return request<{ type: "select" | "write"; rows?: any[]; changes?: number; lastInsertRowid?: number | string }>("/api/admin/db/query", {
    method: "POST",
    body: JSON.stringify({ sql })
  });
}

export function clearDatabase() {
  return request<{ success: boolean }>("/api/admin/db/clear", {
    method: "POST"
  });
}

export function deleteDbRegion(lawdCode: string) {
  return request<{ success: boolean }>("/api/admin/db/delete-region", {
    method: "POST",
    body: JSON.stringify({ lawdCode })
  });
}

export function deleteDbComplex(complexName: string) {
  return request<{ success: boolean }>("/api/admin/db/delete-complex", {
    method: "POST",
    body: JSON.stringify({ complexName })
  });
}

export function loadSystemConfig() {
  return request<{
    telegramBotToken: string;
    telegramChatId: string;
    kakaoRestApiKey: string;
    jusoConfmKey: string;
    dataGoKrApiKey: string;
    kakaoJavascriptKey: string;
    kakaoNativeAppKey: string;
    googleClientId?: string;
    googleClientSecret?: string;
    googleRedirectUri?: string;
    allowedEmails?: string;
    adminEmails?: string;
  }>("/api/system-config");
}

export function saveSystemConfig(config: {
  telegramBotToken?: string;
  telegramChatId?: string;
  kakaoRestApiKey?: string;
  jusoConfmKey?: string;
  dataGoKrApiKey?: string;
  kakaoJavascriptKey?: string;
  kakaoNativeAppKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  allowedEmails?: string;
  adminEmails?: string;
}) {
  return request<{ ok: boolean }>("/api/system-config", {
    method: "POST",
    body: JSON.stringify(config)
  });
}

export function loadUserConfig() {
  return request<{
    telegramBotToken: string;
    telegramChatId: string;
    kakaoRestApiKey: string;
  }>("/api/user-config");
}

export function saveUserConfig(config: {
  telegramBotToken?: string;
  telegramChatId?: string;
  kakaoRestApiKey?: string;
}) {
  return request<{ ok: boolean }>("/api/user-config", {
    method: "POST",
    body: JSON.stringify(config)
  });
}

// 📊 수집 현황 통계 API 추가

export function loadDailyCollectionStats() {
  return request<DailyCollectStat[]>("/api/graph/collect-stats/daily");
}

export function loadMonthlyCollectionStats() {
  return request<DailyCollectStat[]>("/api/graph/collect-stats/monthly");
}

export function loadRegionCollectionStats(dateOrMonth: string, type: "daily" | "monthly" = "daily") {
  const param = type === "daily" ? `date=${encodeURIComponent(dateOrMonth)}` : `month=${encodeURIComponent(dateOrMonth)}`;
  return request<RegionCollectStat[]>(`/api/graph/collect-stats/region?${param}`);
}

// 🚇 역세권 / Geocoding API 추가

export function loadNearbyStation(station: string, radius = 500, live = false) {
  const params = new URLSearchParams({ station, radius: String(radius), live: String(live) });
  return request<{ 
    station: { name: string; lat: number; lng: number };
    radiusM: number;
    complexes: {
      name: string;
      lawdCode: string;
      regionName: string;
      lat: number;
      lng: number;
      distanceM: number;
      dongName: string | null;
      jibun: string | null;
      hasDbData?: boolean;
    }[];
    /** 실시간 국토부 API로 발견된 단지 목록 */
    liveComplexes: {
      name: string;
      lawdCode: string;
      regionName: string;
      lat: number | null;
      lng: number | null;
      distanceM: number | null;
      dongName: string | null;
      jibun: string | null;
      hasDbData: boolean;
    }[];
    /** 역 주소 기반 법정동코드 */
    stationLawdCode: string | null;
    geocodeStats: { total: number; geocoded: number; pending: number };
  }>(`/api/graph/nearby-station?${params.toString()}`);
}

/**
 * 특정 단지의 최근 12개월 실거래 데이터를 API에서 가져와 DB에 적재
 */
export function fetchComplexData(complexName: string, lawdCode: string, regionName?: string) {
  return request<{
    ok: boolean;
    complexName: string;
    lawdCode: string;
    inserted: number;
    months: string[];
    alreadyCached: string[];
  }>("/api/graph/complex-fetch", {
    method: "POST",
    body: JSON.stringify({ complexName, lawdCode, regionName }),
  });
}


export function triggerGeocodeBatch(lawdCode?: string, limit?: number) {
  return request<{
    total: number;
    success: number;
    failed: number;
    failedDetails: { name: string; query: string; reason: string }[];
  }>("/api/graph/geocode-batch", {
    method: "POST",
    body: JSON.stringify({ lawdCode, limit })
  });
}

export function loadGeocodeStats() {
  return request<{ total: number; geocoded: number; pending: number }>("/api/graph/geocode-stats");
}

export function updateComplexCoords(complexId: string, lat: number, lng: number) {
  return request<{ success: boolean }>("/api/complexes/coords", {
    method: "PUT",
    body: JSON.stringify({ complexId, lat, lng })
  });
}

export function resetComplexCoords(complexId: string) {
  return request<{ success: boolean }>("/api/complexes/coords/reset", {
    method: "POST",
    body: JSON.stringify({ complexId })
  });
}

export function checkAuth() {
  return request<{ isAuthenticated: boolean; email?: string; isAdmin?: boolean; isTemporaryPassword?: boolean }>("/api/auth/me");
}

export function logout() {
  return request<{ ok: boolean }>("/api/auth/logout", {
    method: "POST"
  });
}

export function loginLocal(email: string, password: string) {
  return request<{ ok: boolean; email: string; isTemporaryPassword?: boolean }>("/api/auth/login-local", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function addUserAccount(email: string, isAdmin: boolean) {
  return request<{ ok: boolean; email: string; tempPassword?: string; isAdmin: boolean }>("/api/auth/users", {
    method: "POST",
    body: JSON.stringify({ email, isAdmin })
  });
}

export function updateCredentials(email: string, password?: string) {
  return request<{ ok: boolean; email: string }>("/api/auth/credentials", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function fetchDbRegionsSummary() {
  return request<any[]>("/api/graph/regions-summary");
}

export function addDbRegion(lawdCode: string, displayName: string) {
  return request<{ success: boolean }>("/api/graph/regions", {
    method: "POST",
    body: JSON.stringify({ lawdCode, displayName })
  });
}

export function logActivity(activityType: string, description: string, payload?: any) {
  return request<{ ok: boolean }>("/api/logs", {
    method: "POST",
    body: JSON.stringify({ activityType, description, payload })
  }).catch((err) => {
    console.warn("Failed to log activity:", err);
    return { ok: false };
  });
}

export function fetchActivityLogs(params: {
  limit?: number;
  offset?: number;
  userEmail?: string;
  activityType?: string;
}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  if (params.userEmail) query.set("userEmail", params.userEmail);
  if (params.activityType) query.set("activityType", params.activityType);
  return request<{ logs: UserActivityLog[]; total: number }>(`/api/logs?${query.toString()}`);
}

export function fetchActivityStats() {
  return request<ActivityStats>("/api/logs/stats");
}


