/**
 * geocoding-utils.ts — 거리 계산 및 주소 정규화 유틸리티
 *
 * geocoding.ts에서 분리된 순수 유틸 함수 모음.
 * 외부 API 의존성 없음.
 */

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
// 주소 정규화
// ──────────────────────────────────────────────────

/**
 * 행정구역 시도 명칭을 표준 명칭으로 정규화
 */
export function normalizeSido(sido: string): string {
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
export function isAddressMatch(stationAddress: string, regionDisplayName: string): boolean {
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

/**
 * 단지의 주소 정보로 Geocoding 주소 문자열을 조합
 * 예: "성남시 분당구" + "백현동" + "753" → "성남시 분당구 백현동 753"
 */
export function buildGeocodeQuery(
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

/**
 * 문자열 해시 생성 (입지 평가 Mock 데이터용 내부 유틸)
 */
export function simpleStringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
