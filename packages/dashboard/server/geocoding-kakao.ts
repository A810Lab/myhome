/**
 * geocoding-kakao.ts — 카카오 REST API 기반 지오코딩 서비스
 *
 * geocoding.ts에서 분리된 카카오 API 연동 모음:
 * - 주소 → 좌표 변환 (geocodeAddressDetailed, geocodeAddress)
 * - 지하철역 좌표 변환 (geocodeSubwayStation)
 * - 단지 일괄 지오코딩 (batchGeocodeComplexes)
 * - 실시간 단지 목록 수집 (fetchLiveComplexList)
 */

import { Config } from "./config.js";
import {
  getComplexesWithoutCoords,
  updateComplexCoords,
  updateComplexGeocodeFailed,
} from "@myhome/shared";
import { fetchApartmentPricesDirect } from "@myhome/shared";
import { buildGeocodeQuery } from "./geocoding-utils.js";

// ──────────────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────────────

interface GeocoordResult {
  lat: number;
  lng: number;
  address?: string;
}

export interface GeocodeDetailResult {
  success: boolean;
  lat?: number;
  lng?: number;
  reason?: string;
  isTransient?: boolean;
}

export interface GeocodeFailureDetail {
  name: string;
  query: string;
  reason: string;
}

// 메모리 캐시 (서버 수명 동안 유지)
const geocodeCache = new Map<string, GeocoordResult | null>();

// ──────────────────────────────────────────────────
// 주소 → 좌표 변환
// ──────────────────────────────────────────────────

/**
 * 카카오 REST API로 주소 → 상세 정보(성공 여부 및 에러 사유 포함) 변환
 */
export async function geocodeAddressDetailed(address: string): Promise<GeocodeDetailResult> {
  // 메모리 캐시 히트
  if (geocodeCache.has(address)) {
    const cached = geocodeCache.get(address);
    if (cached) {
      return { success: true, lat: cached.lat, lng: cached.lng };
    }
    return { success: false, reason: "이전 요청 실패로 캐시된 데이터 (검색 결과 없음)" };
  }

  const apiKey = Config.KAKAO_REST_API_KEY;
  if (!apiKey) {
    const reason = "카카오 API 키(KAKAO_REST_API_KEY) 설정이 누락되었습니다.";
    console.warn(`[Geocoding] ${reason}`);
    return { success: false, reason, isTransient: true };
  }

  const headers = { Authorization: `KakaoAK ${apiKey}` };

  try {
    // 1차: 주소 검색
    const addrUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
    const addrRes = await fetch(addrUrl, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!addrRes.ok) {
      return { success: false, reason: `카카오 주소 API 호출 실패 (HTTP 상태코드: ${addrRes.status})`, isTransient: true };
    }

    const addrBody = await addrRes.json();
    if (addrBody.documents && addrBody.documents.length > 0) {
      const doc = addrBody.documents[0];
      const result: GeocoordResult = {
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x),
      };
      geocodeCache.set(address, result);
      return { success: true, ...result };
    }

    // 2차: 키워드 검색 (주소 검색 실패 시)
    const kwUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(address)}`;
    const kwRes = await fetch(kwUrl, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!kwRes.ok) {
      return { success: false, reason: `카카오 키워드 API 호출 실패 (HTTP 상태코드: ${kwRes.status})`, isTransient: true };
    }

    const kwBody = await kwRes.json();
    if (kwBody.documents && kwBody.documents.length > 0) {
      const doc = kwBody.documents[0];
      const result: GeocoordResult = {
        lat: parseFloat(doc.y),
        lng: parseFloat(doc.x),
      };
      geocodeCache.set(address, result);
      return { success: true, ...result };
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[Geocoding] 주소 변환 실패 (${address}):`, err);
    return { success: false, reason: `네트워크 오류 또는 타임아웃 (${errMsg})`, isTransient: true };
  }

  geocodeCache.set(address, null);
  return { success: false, reason: "카카오맵 주소 및 키워드 검색 결과가 존재하지 않습니다.", isTransient: false };
}

/**
 * 카카오 REST API로 주소 → 좌표 변환 (하위 호환 래퍼)
 */
export async function geocodeAddress(address: string): Promise<GeocoordResult | null> {
  const result = await geocodeAddressDetailed(address);
  if (result.success && result.lat !== undefined && result.lng !== undefined) {
    return { lat: result.lat, lng: result.lng };
  }
  return null;
}

// ──────────────────────────────────────────────────
// 지하철역 좌표 변환
// ──────────────────────────────────────────────────

/**
 * 지하철역명 → 좌표 변환 (카카오 키워드 검색, category_group_code=SW8)
 */
export async function geocodeSubwayStation(stationName: string): Promise<GeocoordResult | null> {
  const cacheKey = `__subway__${stationName}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) ?? null;
  }

  const apiKey = Config.KAKAO_REST_API_KEY;
  if (!apiKey) {
    console.warn("[Geocoding] KAKAO_REST_API_KEY가 설정되지 않았습니다.");
    return null;
  }

  try {
    // "판교역" 같은 검색어에 카테고리 그룹 코드 SW8(지하철역) 지정
    const query = stationName.endsWith("역") ? stationName : `${stationName}역`;
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&category_group_code=SW8`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const body = await res.json();
      if (body.documents && body.documents.length > 0) {
        const doc = body.documents[0];
        const result: GeocoordResult = {
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
          address: doc.address_name,
        };
        geocodeCache.set(cacheKey, result);
        console.log(`[Geocoding] 지하철역 좌표 확보: ${query} → (${result.lat}, ${result.lng}, 주소: ${doc.address_name})`);
        return result;
      }
    }
  } catch (err) {
    console.error(`[Geocoding] 지하철역 좌표 변환 실패 (${stationName}):`, err);
  }

  geocodeCache.set(cacheKey, null);
  return null;
}

// ──────────────────────────────────────────────────
// 단지 일괄 Geocoding
// ──────────────────────────────────────────────────

/**
 * 좌표 미확보 단지를 일괄 Geocoding하여 DB에 저장
 * @param lawdCode 특정 지역만 처리할 경우 지역코드 지정
 * @returns { total, success, failed, failedDetails }
 */
export async function batchGeocodeComplexes(
  lawdCode?: string,
  maxLimit = 30
): Promise<{ total: number; success: number; failed: number; failedDetails: GeocodeFailureDetail[] }> {
  const pendingAll = getComplexesWithoutCoords(lawdCode);
  const pending = pendingAll.slice(0, maxLimit);
  let success = 0;
  let failed = 0;
  const failedDetails: GeocodeFailureDetail[] = [];

  console.log(`[Geocoding] 일괄 Geocoding 시작: ${pending.length}개 단지 (전체 미확보: ${pendingAll.length}개)`);

  for (const complex of pending) {
    const query = buildGeocodeQuery(
      complex.regionName,
      complex.dongName,
      complex.jibun,
      complex.name
    );

    const result = await geocodeAddressDetailed(query);
    if (result.success && result.lat !== undefined && result.lng !== undefined) {
      updateComplexCoords(complex.id, result.lat, result.lng);
      success++;
    } else {
      failed++;
      failedDetails.push({
        name: complex.name,
        query,
        reason: result.reason || "알 수 없는 오류",
      });
      console.warn(`[Geocoding] 변환 실패: ${complex.name} (${query}) - 사유: ${result.reason}`);
      if (!result.isTransient) {
        updateComplexGeocodeFailed(complex.id, result.reason || "알 수 없는 오류");
      }
    }

    // 카카오 API Rate Limit 방지 (200ms 딜레이, 1개 초과 처리 시에만 딜레이 부여)
    if (pending.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`[Geocoding] 일괄 완료: 성공 ${success}, failed ${failed} / 총 ${pending.length} (잔여 미확보: ${pendingAll.length - success}개)`);
  return { total: pendingAll.length, success, failed, failedDetails };
}

// ──────────────────────────────────────────────────
// 실시간 단지 목록 수집 (국토부 API)
// ──────────────────────────────────────────────────

/**
 * 특정 지역의 최근 N개월 국토부 실거래 API에서 단지명 목록 수집
 * @param lawdCode 법정동코드 (5자리)
 * @param months 조회할 월 수 (기본 3개월)
 */
export async function fetchLiveComplexList(
  lawdCode: string,
  months = 3
): Promise<{ name: string; dongName: string | null; jibun: string | null }[]> {
  const names = new Map<string, { dongName: string | null; jibun: string | null }>();
  const now = new Date();

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      const transactions = await fetchApartmentPricesDirect(lawdCode, month);
      for (const t of transactions) {
        if (t.apartmentName && !names.has(t.apartmentName.trim())) {
          names.set(t.apartmentName.trim(), {
            dongName: t.dongName ?? null,
            jibun: t.jibun ?? null,
          });
        }
      }
    } catch (err) {
      console.warn(`[fetchLiveComplexList] ${lawdCode}/${month} 조회 실패:`, err);
    }
  }

  return Array.from(names.entries()).map(([name, info]) => ({ name, ...info }));
}
