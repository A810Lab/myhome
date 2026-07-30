/**
 * mcpClient.ts
 *
 * ⚠️  이 파일의 MCP(mcporter/mcp-gateway) 기능은 자연어 질의 전용으로 예약되어 있습니다.
 *    예: "판교역 반경 500미터 내 아파트 단지를 알려줘" 같은 NL 쿼리 처리 시 사용.
 *
 * 실거래 데이터 조회·지역코드 변환·단지 목록 조회는 모두 국토부 API 직접 호출을 사용합니다.
 */
import { fetchApartmentPricesDirect } from "@myhome/shared";
import type { McpPriceResult } from "./types.js";
import { createMcporterLimiter } from "./mcpThrottle.js";

// ──────────────────────────────────────────────────
// 실거래 조회 (국토부 API 직접 호출)
// ──────────────────────────────────────────────────

// Configure a limiter: 최소 200 ms 간격, 캐시 비활성화, 재시도 지연 200/500/1000ms
const mcpLimiter = createMcporterLimiter({
  minIntervalMs: 200,
  cacheTtlMs: 0,
  retryDelaysMs: [200, 500, 1000],
});

export async function getApartmentPrices(lawdCode: string, dealMonth: string): Promise<McpPriceResult> {
  // limiter key = "lawdCode:dealMonth"
  const result = await mcpLimiter.run(`${lawdCode}:${dealMonth}`, async () => {
    const transactions = await fetchApartmentPricesDirect(lawdCode, dealMonth);
    return { transactions, raw: { result: { transactions } } };
  });
  return result;
}

/**
 * 특정 지역의 아파트 단지 목록을 국토부 실거래 API 기반으로 수집합니다.
 * 최근 3개월 실거래 데이터를 조회하여 등장하는 단지명을 중복 제거 후 반환합니다.
 * (MCP get_apt_list 대체)
 */
export async function getApartmentList(lawdCode: string): Promise<string[]> {
  const names = new Set<string>();
  const now = new Date();

  // 최근 3개월 조회 (계약 지연 신고 고려)
  const months = 3;
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      // limiter key = "lawdCode:list:month"
      const res = await mcpLimiter.run(`${lawdCode}:list:${month}`, async () => {
        return await fetchApartmentPricesDirect(lawdCode, month);
      });
      for (const t of res) {
        if (t.apartmentName) names.add(t.apartmentName.trim());
      }
    } catch (err) {
      console.warn(`[getApartmentList] ${lawdCode}/${month} 조회 실패 (무시):`, err);
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
}

// ──────────────────────────────────────────────────
// 지역코드 조회 — addressSearch.ts 위임
// ──────────────────────────────────────────────────
// getRegionCode / searchRegionCandidates 은 addressSearch.ts 의 searchAddresses() 를 사용합니다.
// routes.ts의 /api/regions/search 참조.

// ──────────────────────────────────────────────────
// 🔮 자연어(NL) 전용 예약 영역
// ──────────────────────────────────────────────────
// 아래 함수는 "판교역 반경 500미터 내 아파트 단지" 같은 자연어 질의를 처리할 때 활용 예정.
// Phase 8 (LLM 직접 연동) 이후 구현 예정.

/*
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

async function runMcporterNL(query: string): Promise<unknown> {
  // NL → MCP 도구 호출 (미래 기능)
}
*/
