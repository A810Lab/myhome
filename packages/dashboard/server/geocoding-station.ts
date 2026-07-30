/**
 * geocoding-station.ts — 역세권 탐색 서비스
 *
 * geocoding.ts에서 분리된 역 반경 단지 탐색 기능:
 * - findComplexesNearStation: 지하철역 반경 내 아파트 단지 검색
 * - findSubwayStationsNearCoords: 좌표 반경 내 지하철역 검색
 */

import { Config } from "./config.js";
import {
  getComplexesWithCoords,
  getComplexesWithoutCoords,
  updateComplexCoords,
  updateComplexGeocodeFailed,
} from "@myhome/shared";
import { haversineDistance, isAddressMatch, buildGeocodeQuery } from "./geocoding-utils.js";
import {
  geocodeSubwayStation,
  geocodeAddressDetailed,
  geocodeAddress,
  fetchLiveComplexList,
} from "./geocoding-kakao.js";

// ──────────────────────────────────────────────────
// 타입 정의
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

export interface NearbySubwayStation {
  name: string;
  distanceM: number;
  lat: number;
  lng: number;
}

// 주변 지하철역 조회 결과 메모리 캐시 (API Rate Limit 절약 및 0ms 초고속 응답 목적)
const nearbySubwaysCache = new Map<string, NearbySubwayStation[]>();

// ──────────────────────────────────────────────────
// 역 반경 내 단지 검색
// ──────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────
// 좌표 반경 내 지하철역 검색
// ──────────────────────────────────────────────────

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

  const apiKey = Config.KAKAO_REST_API_KEY;
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
        const stationsMap = new Map<string, NearbySubwayStation>();

        for (const doc of body.documents) {
          const rawName = doc.place_name;
          const match = rawName.match(/^(.+?역)/);
          const name = match ? match[1] : rawName.trim();
          
          const distanceM = parseInt(doc.distance) || 0;
          const lat = parseFloat(doc.y);
          const lng = parseFloat(doc.x);

          const existing = stationsMap.get(name);
          if (!existing || distanceM < existing.distanceM) {
            stationsMap.set(name, { name, distanceM, lat, lng });
          }
        }

        const result = Array.from(stationsMap.values());
        nearbySubwaysCache.set(cacheKey, result);
        console.log(`[Geocoding] 주변 지하철역 캐시 저장: ${cacheKey} (중복 제거 후 ${result.length}개 발견, 원본 ${body.documents.length}개)`);
        return result;
      }
    }
  } catch (err) {
    console.error(`[Geocoding] 주변 지하철역 검색 실패 (${lat}, ${lng}):`, err);
  }

  return [];
}
