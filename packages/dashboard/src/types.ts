export type AlertChannel = "telegram" | "kakao";

export type ComparisonCriteria =
  | "none"
  | "parking"
  | "large_complex"
  | "transit"
  | "newer"
  | "livability";

export type WatchRule = {
  id: string;
  name: string;
  regionName: string;
  regionCode?: string;
  apartmentKeywords?: string[];
  minPriceEok?: number;
  maxPriceEok?: number;
  minArea?: number;
  maxArea?: number;
  comparisonCriteria: ComparisonCriteria;
  intervalMinutes: number;
  alertTime?: string;
  channels: AlertChannel[];
  enabled: boolean;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuleInput = {
  name: string;
  regionName: string;
  /** 국토부 실거래 API용 법정동코드 5자리 (LAWD_CD). 지역 선택 시 함께 저장 */
  regionCode?: string;
  apartmentKeywords?: string[];
  minPriceEok?: number;
  maxPriceEok?: number;
  minArea?: number;
  maxArea?: number;
  comparisonCriteria: ComparisonCriteria;
  intervalMinutes?: number;
  alertTime?: string;
  channels: AlertChannel[];
  enabled: boolean;
};

export type TransactionRecord = {
  apartmentName: string;
  dealDate: string;
  priceEok: number;
  areaM2?: number;
  floor?: number;
  dongName?: string | null;
  jibun?: string | null;
  roadName?: string | null;
  lat?: number | null;
  lng?: number | null;
  raw: unknown;
};

export type TransactionMatch = TransactionRecord & {
  dedupeKey: string;
};

export type CheckRun = {
  id: string;
  ruleId: string;
  ruleName: string;
  matched: boolean;
  summary: string;
  matches: TransactionMatch[];
  sourceLimitNotice: string;
  error?: string;
  createdAt: string;
};

export type NotificationRecord = {
  id: string;
  ruleId: string;
  channel: AlertChannel;
  status: "sent" | "skipped" | "failed";
  message: string;
  dedupeKeys: string[];
  createdAt: string;
};

export type AppConfig = {
  telegramConfigured: boolean;
  kakaoStatus: "phase-2";
  kakaoSearchConfigured?: boolean;
  kakaoConfigured?: boolean;
  jusoConfigured?: boolean;
  dataGoKrConfigured?: boolean;
  kakaoJavascriptConfigured?: boolean;
  kakaoJavascriptKey?: string;
  kakaoNativeAppConfigured?: boolean;
  dataSourceNotice: string;
  geminiConfigured?: boolean;
};

export type RegionSearchResult = {
  lawdCode: string;
  displayName: string;
  placeName?: string;
  addressName?: string;
  raw?: unknown;
};

export type DashboardState = {
  rules: WatchRule[];
  checkRuns: CheckRun[];
  notifications: NotificationRecord[];
  config: AppConfig;
  dbStats?: {
    regions: number;
    complexes: number;
    transactions: number;
  };
};

export type ApartmentListResponse = {
  apartments: string[];
  cachedAt: string | null;
};

export type ComplexSearchResult = {
  id: string;
  name: string;
  lawdCode: string;
  regionName: string;
  lat?: number | null;
  lng?: number | null;
};

export interface UserActivityLog {
  id: string;
  userEmail: string;
  activityType: string;
  description: string;
  payload?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface ActivityStats {
  activityByType: { activityType: string; count: number }[];
  activityByDate: { date: string; logCount: number; userCount: number }[];
  topUsers: { userEmail: string; count: number }[];
  dau: number;
  wau: number;
  mau: number;
  totalUsers: number;
  totalLogs: number;
}
