/**
 * geocoding.ts — 카카오 REST API 기반 Geocoding + Haversine 거리 계산
 *
 * Lazy Geocoding 패턴:
 * - 좌표가 필요할 때 DB에서 먼저 조회
 * - 없으면 카카오 API로 Geocoding → DB에 저장
 * - 이후 요청은 DB에서 즉시 히트
 */

import {
  getComplexesWithCoords,
  getComplexesWithoutCoords,
  updateComplexCoords,
  updateComplexGeocodeFailed,
} from "@myhome/shared";
import { fetchApartmentPricesDirect } from "@myhome/shared";

// ──────────────────────────────────────────────────
// Haversine 거리 계산
// ──────────────────────────────────────────────────

/**
 * 두 좌표(위도/경도) 간 거리를 미터로 계산 (Haversine formula)
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // 지구 반경 (미터)
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ──────────────────────────────────────────────────
// 카카오 REST API Geocoding
// ──────────────────────────────────────────────────

interface GeocoordResult {
  lat: number;
  lng: number;
  address?: string;
}

// 메모리 캐시 (서버 수명 동안 유지)
export interface GeocodeDetailResult {
  success: boolean;
  lat?: number;
  lng?: number;
  reason?: string;
  isTransient?: boolean;
}

const geocodeCache = new Map<string, GeocoordResult | null>();

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

  const apiKey = process.env.KAKAO_REST_API_KEY;
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

/**
 * 지하철역명 → 좌표 변환 (카카오 키워드 검색, category_group_code=SW8)
 */
export async function geocodeSubwayStation(stationName: string): Promise<GeocoordResult | null> {
  const cacheKey = `__subway__${stationName}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) ?? null;
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
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
// 단지 Geocoding (Lazy: DB에 없으면 API 호출 후 저장)
// ──────────────────────────────────────────────────

/**
 * 단지의 주소 정보로 Geocoding 주소 문자열을 조합
 * 예: "성남시 분당구" + "백현동" + "753" → "성남시 분당구 백현동 753"
 */
function buildGeocodeQuery(
  regionName: string,
  dongName: string | null,
  jibun: string | null,
  complexName: string
): string {
  // 1순위: 지역명 + 법정동명 + 지번 (가장 정확)
  if (dongName && jibun) {
    return `${regionName} ${dongName} ${jibun}`;
  }
  // 2순위: 지역명 + 법정동명
  if (dongName) {
    return `${regionName} ${dongName}`;
  }
  // 3순위: 지역명 + 단지명 (괄호 제거)
  const cleanName = complexName.replace(/\(.*?\)/g, "").trim();
  return `${regionName} ${cleanName}`;
}

export interface GeocodeFailureDetail {
  name: string;
  query: string;
  reason: string;
}

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
// 핵심 비즈니스 로직: 역 반경 내 단지 검색
// ──────────────────────────────────────────────────

export interface NearbyComplex {
  name: string;
  lawdCode: string;
  regionName: string;
  lat: number;
  lng: number;
  distanceM: number;
  dongName: string | null;
  jibun: string | null;
  /** DB에 실거래 집계가 있는 단지이면 true */
  hasDbData?: boolean;
}

/** 실시간 국토부 API로 발견된 단지 (좌표 포함 가능) */
export interface LiveNearbyComplex {
  name: string;
  lawdCode: string;
  regionName: string;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
  dongName: string | null;
  jibun: string | null;
  /** DB에 실거래 집계가 있는 단지이면 true */
  hasDbData: boolean;
}

export interface NearbyStationResult {
  station: {
    name: string;
    lat: number;
    lng: number;
  };
  radiusM: number;
  complexes: NearbyComplex[];
  /** 실시간 국토부 API로 발견된 단지 목록 (반경 필터 적용) */
  liveComplexes: LiveNearbyComplex[];
  /** 역 주소 기반으로 추출한 법정동코드 */
  stationLawdCode: string | null;
  geocodeStats: {
    total: number;
    geocoded: number;
    pending: number;
  };
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

/**
 * 특정 지하철역 반경 내 아파트 단지 검색
 *
 * Lazy Geocoding:
 * 1. 역 좌표 확보 (카카오 API)
 * 2. DB에서 좌표 있는 단지 → Haversine 필터
 * 3. 좌표 없는 단지 → Geocoding → DB 저장 → 필터
 * 4. [신규] 국토부 API 실시간 단지 목록 병합
 * 5. 거리순 정렬 반환
 */
export async function findComplexesNearStation(
  stationName: string,
  radiusM = 500,
  enableLive = false
): Promise<NearbyStationResult> {
  // 1. 지하철역 좌표 확보
  const stationCoords = await geocodeSubwayStation(stationName);
  if (!stationCoords) {
    throw new Error(`지하철역 '${stationName}'의 좌표를 확인할 수 없습니다.`);
  }

  // 지하철역 주소 기반으로 매칭되는 DB 내 지역코드(lawdCode) 탐색
  let targetLawdCode: string | undefined = undefined;
  if (stationCoords.address) {
    try {
      const { getAllDbRegions } = await import("@myhome/shared");
      const regions = await getAllDbRegions();
      const matchedRegion = regions
        .filter((r) => stationCoords.address!.includes(r.displayName))
        .sort((a, b) => b.displayName.length - a.displayName.length)[0];
      
      if (matchedRegion) {
        targetLawdCode = matchedRegion.lawdCode;
        console.log(`[Geocoding] 지하철역 주소 매칭 지역코드 확보: ${stationCoords.address} → ${matchedRegion.displayName} (${targetLawdCode})`);
      }
    } catch (e) {
      console.error("[Geocoding] 지역코드 조회 및 매칭 실패:", e);
    }
  }

  const nearbyComplexes: NearbyComplex[] = [];

  // 2. DB에서 좌표 보유 단지 → 거리 계산
  const geocodedComplexes = getComplexesWithCoords();
  for (const c of geocodedComplexes) {
    const dist = haversineDistance(stationCoords.lat, stationCoords.lng, c.lat, c.lng);
    if (dist <= radiusM) {
      nearbyComplexes.push({
        name: c.name,
        lawdCode: c.lawdCode,
        regionName: c.regionName,
        lat: c.lat,
        lng: c.lng,
        distanceM: Math.round(dist),
        dongName: c.dongName,
        jibun: c.jibun,
      });
    }
  }

  // 3. 좌표 미확보 단지 → Lazy Geocoding (지하철역과 동일 지역구 단지로만 한정하여 504 Timeout 방지)
  // enableLive가 활성화된 경우에만 실시간 Geocoding 루프를 수행합니다.
  const pendingComplexes = (targetLawdCode && enableLive) ? getComplexesWithoutCoords(targetLawdCode) : [];
  for (const c of pendingComplexes) {
    // 사전 필터: 법정동이 다른 지역이면 Geocoding 스킵 (API 절약)
    const query = buildGeocodeQuery(c.regionName, c.dongName, c.jibun, c.name);
    const result = await geocodeAddressDetailed(query);

    if (result.success && result.lat !== undefined && result.lng !== undefined) {
      updateComplexCoords(c.id, result.lat, result.lng);

      const dist = haversineDistance(stationCoords.lat, stationCoords.lng, result.lat, result.lng);
      if (dist <= radiusM) {
        nearbyComplexes.push({
          name: c.name,
          lawdCode: c.lawdCode,
          regionName: c.regionName,
          lat: result.lat,
          lng: result.lng,
          distanceM: Math.round(dist),
          dongName: c.dongName,
          jibun: c.jibun,
        });
      }
    } else {
      if (!result.isTransient) {
        updateComplexGeocodeFailed(c.id, result.reason || "알 수 없는 오류");
      }
    }

    // Rate Limit 방지
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  // 4. 거리순 정렬
  nearbyComplexes.sort((a, b) => a.distanceM - b.distanceM);

  // Geocoding 현황 통계
  const { getGeocodeStats, searchComplexNames } = await import("@myhome/shared");
  const geocodeStats = getGeocodeStats();

  // 5. [신규] 실시간 단지 목록 수집 (국토부 API) - targetLawdCode가 있고 enableLive가 활성화된 경우만
  const liveComplexes: LiveNearbyComplex[] = [];
  if (targetLawdCode && enableLive) {
    try {
      console.log(`[NearbyStation] 실시간 단지 목록 수집 시작: ${targetLawdCode}`);
      const liveList = await fetchLiveComplexList(targetLawdCode, 3);

      // DB 등록 단지명 Set (중복 체크용)
      const dbComplexNames = new Set(nearbyComplexes.map((c) => c.name));

      // DB에서 해당 지역의 단지 집계 여부 확인용
      const dbComplexesInRegion = (await searchComplexNames("", targetLawdCode)).map((c: any) => c.name);
      const dbComplexSet = new Set(dbComplexesInRegion);

      for (const live of liveList) {
        const hasDbData = dbComplexSet.has(live.name);

        // 이미 DB 단지로 표시된 경우: hasDbData 뱃지만 업데이트
        if (dbComplexNames.has(live.name)) {
          const existing = nearbyComplexes.find((c) => c.name === live.name);
          if (existing) existing.hasDbData = hasDbData;
          continue;
        }

        // 좌표 확보 시도 (카카오 geocoding)
        let lat: number | null = null;
        let lng: number | null = null;
        let distanceM: number | null = null;

        const regionName = stationCoords.address?.split(" ").slice(0, 2).join(" ") ?? stationName;
        const query = live.dongName && live.jibun
          ? `${regionName} ${live.dongName} ${live.jibun}`
          : live.dongName
          ? `${regionName} ${live.dongName}`
          : `${regionName} ${live.name.replace(/\(.*?\)/g, "").trim()}`;

        const geoResult = await geocodeAddress(query);
        if (geoResult) {
          lat = geoResult.lat;
          lng = geoResult.lng;
          const dist = haversineDistance(stationCoords.lat, stationCoords.lng, lat, lng);
          distanceM = Math.round(dist);

          // 반경 초과 시 건너뜀
          if (dist > radiusM) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
        }

        liveComplexes.push({
          name: live.name,
          lawdCode: targetLawdCode,
          regionName: stationCoords.address?.split(" ").slice(0, 3).join(" ") ?? stationName,
          lat,
          lng,
          distanceM,
          dongName: live.dongName,
          jibun: live.jibun,
          hasDbData,
        });

        // Rate Limit 방지
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 거리순 정렬 (좌표 없는 단지는 뒤로)
      liveComplexes.sort((a, b) => {
        if (a.distanceM === null && b.distanceM === null) return 0;
        if (a.distanceM === null) return 1;
        if (b.distanceM === null) return -1;
        return a.distanceM - b.distanceM;
      });

      console.log(`[NearbyStation] 실시간 단지 ${liveComplexes.length}개 수집 완료 (lawdCode: ${targetLawdCode})`);
    } catch (err) {
      console.error("[NearbyStation] 실시간 단지 목록 수집 실패:", err);
    }
  }

  return {
    station: {
      name: stationName,
      lat: stationCoords.lat,
      lng: stationCoords.lng,
    },
    radiusM,
    complexes: nearbyComplexes,
    liveComplexes,
    stationLawdCode: targetLawdCode ?? null,
    geocodeStats,
  };
}

export interface NearbySubwayStation {
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
}

// 주변 지하철역 조회 결과 메모리 캐시 (API Rate Limit 절약 및 0ms 초고속 응답 목적)
const nearbySubwaysCache = new Map<string, NearbySubwayStation[]>();

/**
 * 특정 좌표(위도/경도) 반경 내 지하철역 검색 (카카오 카테고리 검색 SW8)
 */
export async function findSubwayStationsNearCoords(
  lat: number,
  lng: number,
  radiusM = 2000
): Promise<NearbySubwayStation[]> {
  // 위경도 소수점 5자리(약 1m 정밀도)로 반올림하여 캐시 키 생성
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)},${radiusM}`;
  if (nearbySubwaysCache.has(cacheKey)) {
    console.log(`[Geocoding] 주변 지하철역 캐시 히트: ${cacheKey}`);
    return nearbySubwaysCache.get(cacheKey) || [];
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    console.warn("[Geocoding] KAKAO_REST_API_KEY가 설정되지 않았습니다.");
    return [];
  }

  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SW8&x=${lng}&y=${lat}&radius=${radiusM}&sort=distance`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const body = await res.json();
      if (body.documents) {
        const result: NearbySubwayStation[] = body.documents.map((doc: any) => ({
          name: doc.place_name,
          distanceM: parseInt(doc.distance) || 0,
          lat: parseFloat(doc.y),
          lng: parseFloat(doc.x),
        }));
        
        nearbySubwaysCache.set(cacheKey, result);
        console.log(`[Geocoding] 주변 지하철역 캐시 저장: ${cacheKey} (${result.length}개 발견)`);
        return result;
      }
    }
  } catch (err) {
    console.error(`[Geocoding] 주변 지하철역 검색 실패 (${lat}, ${lng}):`, err);
  }

  return [];
}


