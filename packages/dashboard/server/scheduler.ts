import { runRuleCheck } from "./ruleEngine.js";
import { sendNotifications } from "./notifications.js";
import { runCollector } from "@myhome/collector";
import { getAllRules, mapLimit } from "@myhome/shared";
import { batchGeocodeComplexes } from "./geocoding.js";
import { Config } from "./config.js";
import { graphCache } from "./cache.js";



function isAlertDue(lastCheckedAt: string | undefined, alertTime: string | undefined): boolean {
  // alertTime이 명시적으로 지정되지 않은 레거시 데이터는 기본적으로 오전 9시 알림으로 대치
  const targetAlertTime = alertTime || "09:00";
  
  const now = new Date();
  const [targetHour, targetMin] = targetAlertTime.split(":").map(Number);
  
  // 오늘 기준 타겟 알림 설정 시각 Date 객체 생성
  const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMin, 0, 0);

  // 현재 시간이 오늘 타겟 시각보다 전이면 아직 실행 주기 미도달
  if (now.getTime() < targetTime.getTime()) {
    return false;
  }

  // 마지막 체크 기록이 없으면 최초 실행
  if (!lastCheckedAt) {
    return true;
  }

  // 마지막으로 체크한 시간이 오늘 설정된 타겟 시각 이전이면 오늘 체크를 미수행했으므로 실행
  const lastChecked = new Date(lastCheckedAt);
  return lastChecked.getTime() < targetTime.getTime();
}

let running = false;
let timerId: NodeJS.Timeout | undefined;
let lastCollectedDate = "";

/**
 * 현재 실행 중인 스케줄러 주기가 완료될 때까지 기다린 뒤 인터벌을 해제합니다.
 * index.ts의 graceful shutdown에서 호출하세요.
 */
export async function stopScheduler(): Promise<void> {
  if (timerId) {
    clearInterval(timerId);
    timerId = undefined;
  }
  // 진행 중인 runDueRules 주기가 끝날 때까지 대기 (최대 30초)
  const start = Date.now();
  while (running && Date.now() - start < 30_000) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  console.log("[Scheduler] Stopped gracefully.");
}

export async function runDueCollector() {
  const now = new Date();
  const todayStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
  const hour = now.getHours();

  // 매일 오전 6시 이후에 데이터 수집 (오늘 돌린 적이 없는 경우에만)
  if (hour >= 6 && lastCollectedDate !== todayStr) {
    console.log(`[Scheduler] Daily collection triggered for date: ${todayStr}`);
    try {
      lastCollectedDate = todayStr;
      const result = await runCollector();
      console.log(`[Scheduler] Daily collection finished: collected ${result.totalCollected} items, upserted ${result.totalUpserted}`);

      // 신규 수집된 아파트 단지에 대한 일괄 Geocoding 수행
      console.log("[Scheduler] Starting batch geocoding for new complexes...");
      const geoResult = await batchGeocodeComplexes();
      console.log(`[Scheduler] Batch geocoding finished: total ${geoResult.total}, success ${geoResult.success}, failed ${geoResult.failed}`);
      
      console.log("[Scheduler] Daily collection & geocoding completed. Invalidating graph cache.");
      graphCache.clear();
    } catch (err: any) {
      console.error("[Scheduler] Daily collection or geocoding failed:", err.message);
      lastCollectedDate = ""; // 실패 시 다음 스케줄 검사 주기에서 재시도하도록 재설정
    }
  }
}

export async function runDueRules() {
  if (running) {
    console.log("Scheduler is already running. Skipping this cycle.");
    return;
  }
  running = true;
  try {
    const rules = getAllRules();
    const dueRules = rules.filter((rule) => rule.enabled && isAlertDue(rule.lastCheckedAt, rule.alertTime));

    if (dueRules.length === 0) return;

    console.log(`[Scheduler] Executing ${dueRules.length} due rules with concurrency limit = 3...`);

    // 최대 3개 동시성으로 병렬 룰 검사 수행
    const CONCURRENCY_LIMIT = 3;
    await mapLimit(dueRules, CONCURRENCY_LIMIT, async (rule) => {
      try {
        const outcome = await runRuleCheck(rule);
        const email = (rule as any).userEmail || "bootstrap-admin@myhome.local";
        await sendNotifications(rule, outcome.newMatches, email);
      } catch (error) {
        console.error(`Scheduled check failed for ${rule.name}:`, error);
      }
    });

    console.log(`[Scheduler] Finished processing ${dueRules.length} rules.`);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const seconds = Number(Config.CHECK_INTERVAL_SECONDS ?? "300");
  const intervalMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 300_000;

  // 기동 시 최초 1회 즉시 실행
  void runDueRules();
  void runDueCollector();

  timerId = setInterval(() => {
    void runDueRules();
    void runDueCollector();
  }, intervalMs);

  // SIGTERM/SIGINT 처리는 index.ts의 shutdown 함수에서 stopScheduler()를 통해 통합 관리합니다.
}
