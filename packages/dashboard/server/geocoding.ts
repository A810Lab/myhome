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

/**
 * 행정구역 시도 명칭을 표준 명칭으로 정규화
 */
function normalizeSido(sido: string): string {
  if (!sido) return "";
  if (sido.startsWith("서울")) return "서울특별시";
  if (sido.startsWith("부산")) return "부산광역시";
  if (sido.startsWith("대구")) return "대구광역시";
  if (sido.startsWith("인천")) return "인천광역시";
  if (sido.startsWith("광주")) return "광주광역시";
  if (sido.startsWith("대전")) return "대전광역시";
  if (sido.startsWith("울산")) return "울산광역시";
  if (sido.startsWith("세종")) return "세종특별자치시";
  if (sido.startsWith("경기")) return "경기도";
  if (sido.startsWith("강원")) return "강원특별자치도";
  if (sido.startsWith("충북") || sido.includes("충청북도")) return "충청북도";
  if (sido.startsWith("충남") || sido.includes("충청남도")) return "충청남도";
  if (sido.startsWith("전북") || sido.includes("전라북도") || sido.includes("전북특별자치도")) return "전북특별자치도";
  if (sido.startsWith("전남") || sido.includes("전라남도")) return "전라남도";
  if (sido.startsWith("경북") || sido.includes("경상북도")) return "경상북도";
  if (sido.startsWith("경남") || sido.includes("경상남도")) return "경상남도";
  if (sido.startsWith("제주")) return "제주특별자치도";
  return sido;
}

/**
 * 지하철역 검색 주소와 DB 지역 표기명이 일치하는지 판별
 */
function isAddressMatch(stationAddress: string, regionDisplayName: string): boolean {
  const stationParts = stationAddress.split(/\s+/).filter(Boolean);
  const regionParts = regionDisplayName.split(/\s+/).filter(Boolean);

  if (regionParts.length === 0) return false;

  for (const rPart of regionParts) {
    const isSido = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"].some(
      s => rPart.startsWith(s)
    );

    let matched = false;
    if (isSido) {
      matched = stationParts.some(sPart => normalizeSido(sPart) === normalizeSido(rPart));
    } else {
      matched = stationParts.some(sPart => sPart.includes(rPart) || rPart.includes(sPart));
    }

    if (!matched) {
      return false;
    }
  }

  return true;
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
        .filter((r) => isAddressMatch(stationCoords.address!, r.displayName))
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

      // 이미 로컬 DB에 좌표가 확보된 전체 단지들을 Map 캐시로 구축
      const coordMap = new Map<string, { lat: number; lng: number }>();
      for (const c of geocodedComplexes) {
        coordMap.set(`${c.lawdCode}_${c.name}`, { lat: c.lat, lng: c.lng });
      }

      let newGeocodeCount = 0;
      const MAX_NEW_GEOCODE_LIMIT = 15; // 1회 요청 시 외부 API Geocoding 최대 시도 횟수 제한

      for (const live of liveList) {
        const hasDbData = dbComplexSet.has(live.name);

        // 이미 DB 단지로 표시된 경우: hasDbData 뱃지만 업데이트
        if (dbComplexNames.has(live.name)) {
          const existing = nearbyComplexes.find((c) => c.name === live.name);
          if (existing) existing.hasDbData = hasDbData;
          continue;
        }

        let lat: number | null = null;
        let lng: number | null = null;
        let distanceM: number | null = null;

        // DB 캐시 확인
        const dbCoords = coordMap.get(`${targetLawdCode}_${live.name}`);

        if (dbCoords) {
          lat = dbCoords.lat;
          lng = dbCoords.lng;
          const dist = haversineDistance(stationCoords.lat, stationCoords.lng, lat, lng);
          distanceM = Math.round(dist);

          // 반경 초과 시 건너뜀
          if (dist > radiusM) {
            continue;
          }
        } else {
          // 좌표가 없고 외부 API 제한에 도달한 경우 건너뜀
          if (newGeocodeCount >= MAX_NEW_GEOCODE_LIMIT) {
            continue;
          }

          // 좌표 확보 시도 (카카오 geocoding)
          const regionName = stationCoords.address?.split(" ").slice(0, 2).join(" ") ?? stationName;
          const query = live.dongName && live.jibun
            ? `${regionName} ${live.dongName} ${live.jibun}`
            : live.dongName
            ? `${regionName} ${live.dongName}`
            : `${regionName} ${live.name.replace(/\(.*?\)/g, "").trim()}`;

          newGeocodeCount++;
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
          // Rate Limit 방지
          await new Promise((resolve) => setTimeout(resolve, 100));
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

// ──────────────────────────────────────────────────
// 단지 주변 입지 평가 평점 (학교 > 병원 > 대형마트 > 약국 > 편의점)
// ──────────────────────────────────────────────────

function simpleStringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function calculateCategoryScore(code: string, minDistance: number | null, count: number): number {
  if (minDistance === null || count === 0) return 0;

  // 1. 거리 점수 계산 (S_dist)
  let distanceScore = 0;
  const d = minDistance;

  if (code === "SW8") {
    // 지하철역 (반경 1500m) - 최고 배점
    if (d <= 250) distanceScore = 100;
    else if (d <= 500) distanceScore = 85;
    else if (d <= 1000) distanceScore = 65;
    else if (d <= 1500) distanceScore = 40;
    else distanceScore = 0;
  } else if (code === "SC4") {
    // 학교 (반경 500m)
    if (d <= 150) distanceScore = 100;
    else if (d <= 300) distanceScore = 85;
    else if (d <= 500) distanceScore = 60;
    else distanceScore = 0;
  } else if (code === "HP8") {
    // 병원 (반경 1000m)
    if (d <= 300) distanceScore = 100;
    else if (d <= 500) distanceScore = 80;
    else if (d <= 1000) distanceScore = 50;
    else distanceScore = 0;
  } else if (code === "MT1") {
    // 대형마트 (반경 1500m)
    if (d <= 500) distanceScore = 100;
    else if (d <= 1000) distanceScore = 80;
    else if (d <= 1500) distanceScore = 50;
    else distanceScore = 0;
  } else if (code === "PM9") {
    // 약국 (반경 500m)
    if (d <= 100) distanceScore = 100;
    else if (d <= 300) distanceScore = 80;
    else if (d <= 500) distanceScore = 50;
    else distanceScore = 0;
  } else if (code === "CS2") {
    // 편의점 (반경 300m)
    if (d <= 50) distanceScore = 100;
    else if (d <= 150) distanceScore = 80;
    else if (d <= 300) distanceScore = 50;
    else distanceScore = 0;
  } else {
    // 기본 디폴트
    if (d <= 300) distanceScore = 100;
    else if (d <= 500) distanceScore = 80;
    else if (d <= 1000) distanceScore = 50;
    else distanceScore = 0;
  }

  // 2. 최종 카테고리 평점 (거리 100%)
  const finalScore = distanceScore;

  return Math.round(finalScore);
}

function generateMockInfraRating(complexName: string) {
  const hash = simpleStringHash(complexName);
  const categoryConfigs = [
    { code: "SW8", name: "역세권", weight: 1.5, radius: 1500, baseDist: 150, countMax: 4 },
    { code: "SC4", name: "학교", weight: 1.0, radius: 500, baseDist: 100, countMax: 3 },
    { code: "HP8", name: "병원", weight: 0.8, radius: 1000, baseDist: 200, countMax: 5 },
    { code: "MT1", name: "대형마트", weight: 0.7, radius: 1500, baseDist: 400, countMax: 2 }
  ];

  const categories: Record<string, any> = {};
  let weightedScoreSum = 0;
  let weightSum = 0;

  for (const config of categoryConfigs) {
    const categoryHash = hash + config.code.charCodeAt(0) + config.code.charCodeAt(1);
    
    // 해시 기반으로 시설이 존재 여부 및 거리 시뮬레이션
    const simulatedDist = config.baseDist + (categoryHash % Math.round(config.radius * 1.3));
    const hasFacilities = simulatedDist <= config.radius;
    
    let count = 0;
    let minDistance: number | null = null;
    let score = 0;
    let details: any = null;

    if (hasFacilities) {
      count = (categoryHash % config.countMax) + 1;
      minDistance = simulatedDist;
      
      if (config.code === "SW8") {
        const isGtxExist = (categoryHash % 4) === 0;
        const gtxCount = isGtxExist ? 1 : 0;
        const gtxMinDistance = isGtxExist ? simulatedDist + 500 : null;
        
        const isRailExist = (categoryHash % 3) === 0;
        const railCount = isRailExist ? 1 : 0;
        const railMinDistance = isRailExist ? simulatedDist + 300 : null;
        
        const metroCount = count;
        const metroMinDistance = simulatedDist;
        
        details = {
          metroCount,
          metroMinDistance,
          gtxCount,
          gtxMinDistance,
          railCount,
          railMinDistance
        };
      } else if (config.code === "HP8") {
        const isBigHospitalExist = (categoryHash % 3) > 0;
        const generalHospitalCount = isBigHospitalExist ? 1 : 0;
        const generalHospitalMinDistance = isBigHospitalExist ? simulatedDist + 200 : null;
        const localClinicCount = count;
        const localClinicMinDistance = simulatedDist;
        const pharmacyCount = count * 2;
        const pharmacyMinDistance = simulatedDist;
        
        let sLarge = 0;
        if (generalHospitalMinDistance !== null) {
          if (generalHospitalMinDistance <= 500) sLarge = 100;
          else if (generalHospitalMinDistance <= 1000) sLarge = 80;
        }
        let sClinic = 0;
        if (localClinicMinDistance !== null) {
          const d = localClinicMinDistance;
          if (d <= 150) sClinic = 100;
          else if (d <= 300) sClinic = 80;
          else if (d <= 500) sClinic = 60;
          else if (d <= 1000) sClinic = 40;
        }
        
        if (generalHospitalMinDistance !== null) {
          score = Math.min(100, Math.round(sLarge * 0.7 + sClinic * 0.3 + 10));
        } else {
          score = sClinic;
        }
        
        details = {
          generalHospitalCount,
          generalHospitalMinDistance,
          localClinicCount,
          localClinicMinDistance,
          pharmacyCount,
          pharmacyMinDistance
        };
      } else if (config.code === "MT1") {
        const isLargeMartExist = (categoryHash % 2) > 0;
        const largeMartCount = isLargeMartExist ? 1 : 0;
        const largeMartMinDistance = isLargeMartExist ? simulatedDist + 300 : null;
        const ssmCount = count;
        const ssmMinDistance = simulatedDist;
        const convenienceCount = count * 3;
        const convenienceMinDistance = simulatedDist;
        
        let sMart = 0;
        if (largeMartMinDistance !== null) {
          const d = largeMartMinDistance;
          if (d <= 500) sMart = 100;
          else if (d <= 1000) sMart = 80;
          else if (d <= 1500) sMart = 60;
        }
        let sSsm = 0;
        if (ssmMinDistance !== null) {
          const d = ssmMinDistance;
          if (d <= 300) sSsm = 100;
          else if (d <= 700) sSsm = 80;
          else if (d <= 1500) sSsm = 50;
        }
        
        if (largeMartMinDistance !== null) {
          score = Math.min(100, Math.round(sMart * 0.7 + sSsm * 0.3));
        } else {
          score = Math.round(sSsm * 0.7);
        }
        
        details = {
          largeMartCount,
          largeMartMinDistance,
          ssmCount,
          ssmMinDistance,
          convenienceCount,
          convenienceMinDistance
        };
      } else if (config.code === "SC4") {
        const elementaryCount = (categoryHash % 2) + 1;
        const elementaryMinDistance = simulatedDist;
        const middleCount = (categoryHash % 2);
        const middleMinDistance = middleCount > 0 ? simulatedDist + 150 : null;
        const highCount = (categoryHash % 2);
        const highMinDistance = highCount > 0 ? simulatedDist + 300 : null;
        
        score = calculateCategoryScore(config.code, minDistance, count);
        
        details = {
          elementaryCount,
          elementaryMinDistance,
          middleCount,
          middleMinDistance,
          highCount,
          highMinDistance
        };
      } else {
        score = calculateCategoryScore(config.code, minDistance, count);
      }
    } else {
      score = 0;
    }

    categories[config.code] = {
      name: config.name,
      score,
      count,
      minDistance,
      details
    };

    weightedScoreSum += score * config.weight;
    weightSum += config.weight;
  }

  const totalScore = Math.round((weightedScoreSum / weightSum) * 10) / 10;
  let grade = "D";
  if (totalScore >= 90) grade = "S";
  else if (totalScore >= 80) grade = "A";
  else if (totalScore >= 70) grade = "B";
  else if (totalScore >= 60) grade = "C";

  return {
    totalScore,
    grade,
    categories,
    isMock: true
  };
}

const nearbyInfraCache = new Map<string, any>();

/**
 * 특정 좌표 반경 내 핵심 입지(지하철역, 학교, 병원, 대형마트, 약국, 편의점) 검색 후 가중 평점 계산 (특화 반경 및 노멀라이징 적용)
 */
export async function getComplexInfraRating(
  lat: number | null,
  lng: number | null,
  complexName: string
): Promise<any> {
  if (lat === null || lng === null) {
    return generateMockInfraRating(complexName);
  }

  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (nearbyInfraCache.has(cacheKey)) {
    return nearbyInfraCache.get(cacheKey);
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    const mock = generateMockInfraRating(complexName);
    nearbyInfraCache.set(cacheKey, mock);
    return mock;
  }

  const categoryConfigs = [
    { code: "SW8", name: "역세권", weight: 1.5, radius: 1500 },
    { code: "SC4", name: "학교", weight: 1.0, radius: 500 },
    { code: "HP8", name: "병원", weight: 0.8, radius: 1000 },
    { code: "MT1", name: "대형마트", weight: 0.7, radius: 1500 }
  ];

  const categories: Record<string, any> = {};
  let weightedScoreSum = 0;
  let weightSum = 0;

  try {
    for (const config of categoryConfigs) {
      const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${config.code}&x=${lng}&y=${lat}&radius=${config.radius}&sort=distance`;
      const res = await fetch(url, {
        headers: { Authorization: `KakaoAK ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      });

      let count = 0;
      let minDistance: number | null = null;
      let score = 0;
      let details: any = null;

      if (res.ok) {
        const body = await res.json();
        if (body.documents && body.documents.length > 0) {
          const docs = body.documents;
          
          if (config.code === "SW8") {
            const gtxDocs = docs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              return cat.includes("GTX") || name.includes("GTX");
            });
            const gtxCount = gtxDocs.length;
            const gtxMinDistance = gtxDocs.length > 0 ? (parseInt(gtxDocs[0].distance) || 0) : null;
            
            const railDocs = docs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              if (cat.includes("GTX") || name.includes("GTX")) return false;
              return cat.includes("KTX") || cat.includes("SRT") || cat.includes("ITX") || 
                     name.includes("KTX") || name.includes("SRT") || name.includes("ITX") || 
                     name.includes("기차역") || name.includes("철도역") || 
                     name.endsWith("철도") || name.includes("일반철도");
            });
            const railCount = railDocs.length;
            const railMinDistance = railDocs.length > 0 ? (parseInt(railDocs[0].distance) || 0) : null;
            
            const metroDocs = docs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              const isGtx = cat.includes("GTX") || name.includes("GTX");
              const isRail = cat.includes("KTX") || cat.includes("SRT") || cat.includes("ITX") || 
                             name.includes("KTX") || name.includes("SRT") || name.includes("ITX") || 
                             name.includes("기차역") || name.includes("철도역") || 
                             name.endsWith("철도") || name.includes("일반철도");
              return !isGtx && !isRail;
            });
            const metroCount = metroDocs.length;
            const metroMinDistance = metroDocs.length > 0 ? (parseInt(metroDocs[0].distance) || 0) : null;
            
            count = docs.length;
            minDistance = docs.length > 0 ? (parseInt(docs[0].distance) || 0) : null;
            score = calculateCategoryScore(config.code, minDistance, count);
            
            details = {
              metroCount,
              metroMinDistance,
              gtxCount,
              gtxMinDistance,
              railCount,
              railMinDistance
            };
          } else if (config.code === "HP8") {
            const validDocs = docs.filter((doc: any) => !(doc.category_name || "").includes("동물병원"));
            count = validDocs.length;
            minDistance = validDocs.length > 0 ? (parseInt(validDocs[0].distance) || 0) : null;
            
            const generalDocs = validDocs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              return cat.includes("종합병원") || cat.includes("대학병원") ||
                     name.includes("대학병원") || name.includes("종합병원") || name.includes("의료원") ||
                     name.includes("세브란스") || name.includes("성모병원") || name.includes("아산병원") || name.includes("삼성서울병원");
            });
            const generalHospitalCount = generalDocs.length;
            const generalHospitalMinDistance = generalDocs.length > 0 ? (parseInt(generalDocs[0].distance) || 0) : null;
            
            const clinicDocs = validDocs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              const isBig = cat.includes("종합병원") || cat.includes("대학병원") ||
                            name.includes("대학병원") || name.includes("종합병원") || name.includes("의료원") ||
                            name.includes("세브란스") || name.includes("성모병원") || name.includes("아산병원") || name.includes("삼성서울병원");
              return !isBig;
            });
            const localClinicCount = clinicDocs.length;
            const localClinicMinDistance = clinicDocs.length > 0 ? (parseInt(clinicDocs[0].distance) || 0) : null;
            
            let pharmacyCount = 0;
            let pharmacyMinDistance: number | null = null;
            try {
              const pUrl = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=PM9&x=${lng}&y=${lat}&radius=500&sort=distance`;
              const pRes = await fetch(pUrl, {
                headers: { Authorization: `KakaoAK ${apiKey}` },
                signal: AbortSignal.timeout(3000),
              });
              if (pRes.ok) {
                const pBody = await pRes.json();
                if (pBody.documents && pBody.documents.length > 0) {
                  pharmacyCount = pBody.meta?.total_count || pBody.documents.length;
                  pharmacyMinDistance = parseInt(pBody.documents[0].distance) || 0;
                }
              }
            } catch (pErr) {
              console.error("[Geocoding] 약국 추가 조회 실패:", pErr);
            }
            
            let sLarge = 0;
            if (generalHospitalMinDistance !== null) {
              if (generalHospitalMinDistance <= 500) sLarge = 100;
              else if (generalHospitalMinDistance <= 1000) sLarge = 80;
            }
            
            let sClinic = 0;
            if (localClinicMinDistance !== null) {
              const d = localClinicMinDistance;
              if (d <= 150) sClinic = 100;
              else if (d <= 300) sClinic = 80;
              else if (d <= 500) sClinic = 60;
              else if (d <= 1000) sClinic = 40;
            }
            
            if (generalHospitalMinDistance !== null) {
              score = Math.min(100, Math.round(sLarge * 0.7 + sClinic * 0.3 + 10));
            } else {
              score = sClinic;
            }
            
            details = {
              generalHospitalCount,
              generalHospitalMinDistance,
              localClinicCount,
              localClinicMinDistance,
              pharmacyCount,
              pharmacyMinDistance
            };
            
          } else if (config.code === "MT1") {
            const largeDocs = docs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              const isSSM = name.includes("익스프레스") || name.includes("에브리데이") || name.includes("노브랜드") || name.includes("메트로") || name.includes("프레시") || name.includes("슈퍼");
              const hasMartCat = cat.includes("대형마트");
              const hasLargeBrand = name.includes("이마트") || name.includes("홈플러스") || name.includes("롯데마트") || name.includes("코스트코") || name.includes("트레이더스") || name.includes("메가마트");
              return (hasMartCat || hasLargeBrand) && !isSSM;
            });
            const largeMartCount = largeDocs.length;
            const largeMartMinDistance = largeDocs.length > 0 ? (parseInt(largeDocs[0].distance) || 0) : null;
            
            const ssmDocs = docs.filter((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              const isSSM = name.includes("익스프레스") || name.includes("에브리데이") || name.includes("노브랜드") || name.includes("메트로") || name.includes("프레시") || name.includes("슈퍼") || cat.includes("대형슈퍼") || cat.includes("슈퍼마켓");
              const hasMartCat = cat.includes("대형마트");
              const hasLargeBrand = name.includes("이마트") || name.includes("홈플러스") || name.includes("롯데마트") || name.includes("코스트코") || name.includes("트레이더스") || name.includes("메가마트");
              const isLarge = (hasMartCat || hasLargeBrand) && !isSSM;
              return !isLarge && (isSSM || cat.includes("대형슈퍼") || cat.includes("슈퍼마켓"));
            });
            const ssmCount = ssmDocs.length;
            const ssmMinDistance = ssmDocs.length > 0 ? (parseInt(ssmDocs[0].distance) || 0) : null;
            
            let convenienceCount = 0;
            let convenienceMinDistance: number | null = null;
            try {
              const cUrl = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=CS2&x=${lng}&y=${lat}&radius=300&sort=distance`;
              const cRes = await fetch(cUrl, {
                headers: { Authorization: `KakaoAK ${apiKey}` },
                signal: AbortSignal.timeout(3000),
              });
              if (cRes.ok) {
                const cBody = await cRes.json();
                if (cBody.documents && cBody.documents.length > 0) {
                  convenienceCount = cBody.meta?.total_count || cBody.documents.length;
                  convenienceMinDistance = parseInt(cBody.documents[0].distance) || 0;
                }
              }
            } catch (cErr) {
              console.error("[Geocoding] 편의점 추가 조회 실패:", cErr);
            }
            
            count = docs.length;
            minDistance = docs.length > 0 ? (parseInt(docs[0].distance) || 0) : null;
            
            let sMart = 0;
            if (largeMartMinDistance !== null) {
              const d = largeMartMinDistance;
              if (d <= 500) sMart = 100;
              else if (d <= 1000) sMart = 80;
              else if (d <= 1500) sMart = 60;
            }
            
            let sSsm = 0;
            if (ssmMinDistance !== null) {
              const d = ssmMinDistance;
              if (d <= 300) sSsm = 100;
              else if (d <= 700) sSsm = 80;
              else if (d <= 1500) sSsm = 50;
            }
            
            if (largeMartMinDistance !== null) {
              score = Math.min(100, Math.round(sMart * 0.7 + sSsm * 0.3));
            } else {
              score = Math.round(sSsm * 0.7);
            }
            
            details = {
              largeMartCount,
              largeMartMinDistance,
              ssmCount,
              ssmMinDistance,
              convenienceCount,
              convenienceMinDistance
            };
            
          } else if (config.code === "SC4") {
            count = docs.length;
            minDistance = docs.length > 0 ? (parseInt(docs[0].distance) || 0) : null;
            score = calculateCategoryScore(config.code, minDistance, count);
            
            const elemDocs = docs.filter((doc: any) => (doc.category_name || "").includes("초등학교"));
            const elementaryCount = elemDocs.length;
            const elementaryMinDistance = elemDocs.length > 0 ? (parseInt(elemDocs[0].distance) || 0) : null;
            
            const middDocs = docs.filter((doc: any) => (doc.category_name || "").includes("중학교"));
            const middleCount = middDocs.length;
            const middleMinDistance = middDocs.length > 0 ? (parseInt(middDocs[0].distance) || 0) : null;
            
            const highDocs = docs.filter((doc: any) => (doc.category_name || "").includes("고등학교"));
            const highCount = highDocs.length;
            const highMinDistance = highDocs.length > 0 ? (parseInt(highDocs[0].distance) || 0) : null;
            
            details = {
              elementaryCount,
              elementaryMinDistance,
              middleCount,
              middleMinDistance,
              highCount,
              highMinDistance
            };
          } else {
            count = body.meta?.total_count || docs.length;
            minDistance = parseInt(docs[0].distance) || 0;
            score = calculateCategoryScore(config.code, minDistance, count);
          }
        }
      }

      categories[config.code] = {
        name: config.name,
        score,
        count,
        minDistance,
        details
      };

      weightedScoreSum += score * config.weight;
      weightSum += config.weight;
      
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const totalScore = Math.round((weightedScoreSum / weightSum) * 10) / 10;
    let grade = "D";
    if (totalScore >= 90) grade = "S";
    else if (totalScore >= 80) grade = "A";
    else if (totalScore >= 70) grade = "B";
    else if (totalScore >= 60) grade = "C";

    const result = {
      totalScore,
      grade,
      categories,
      isMock: false
    };

    nearbyInfraCache.set(cacheKey, result);
    return result;

  } catch (err) {
    console.error(`[Geocoding] 입지 분석 실패 (${lat}, ${lng}), Mock 폴백 사용:`, err);
    return generateMockInfraRating(complexName);
  }
}



