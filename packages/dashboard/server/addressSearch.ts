import type { RegionCodeResult } from "./types.js";
import { Config } from "./config.js";

const JUSO_API_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

/**
 * 행정안전부 도로명주소 오픈 API 승인키가 설정되어 있는지 검사합니다.
 * 하위 호환성을 위해 함수명은 `isKakaoConfigured`로 유지합니다.
 */
export function isKakaoConfigured(): boolean {
  return Boolean(Config.JUSO_CONFM_KEY) || Boolean(Config.KAKAO_REST_API_KEY);
}

/**
 * 카카오 로컬 API를 통해 지번에 매핑된 법정동 코드를 반환합니다.
 */
async function getBCodeForAddress(addressName: string): Promise<string | null> {
  const apiKey = Config.KAKAO_REST_API_KEY;
  if (!apiKey) return null;

  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addressName)}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body.documents && body.documents.length > 0) {
      return body.documents[0].address?.b_code ?? null;
    }
  } catch {
    // 무시
  }
  return null;
}

/**
 * 행정안전부 도로명주소 또는 카카오 로컬 API를 호출하여 입력 키워드에 매칭되는 시군구 정보를 반환합니다.
 * 반환 결과의 admCd(10자리 행정구역코드) 또는 b_code의 앞 5자리를 국토교통부 실거래 조회의 LAWD_CD로 활용합니다.
 */
export async function searchAddresses(query: string): Promise<RegionCodeResult[]> {
  const kakaoKey = Config.KAKAO_REST_API_KEY;
  const jusoKey = Config.JUSO_CONFM_KEY;

  if (kakaoKey) {
    // 1. 카카오 주소 검색(address.json) 시도
    const addrUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
    const addrResponse = await fetch(addrUrl, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
      signal: AbortSignal.timeout(10000)
    });

    if (!addrResponse.ok) {
      throw new Error(`카카오 주소 검색 API 호출 에러 (${addrResponse.status})`);
    }

    const addrBody = await addrResponse.json();
    const addrDocuments = addrBody.documents ?? [];
    const results: RegionCodeResult[] = [];
    const seen = new Set<string>();

    for (const doc of addrDocuments) {
      const address = doc.address;
      if (!address) continue;

      const bCode = address.b_code; // 10자리 법정동 코드
      if (!bCode || bCode.length < 5) continue;

      const lawdCode = bCode.slice(0, 5);
      if (seen.has(lawdCode)) continue;

      const region1 = address.region_1depth_name; // 예: 서울
      const region2 = address.region_2depth_name; // 예: 강남구
      
      // 시도와 시군구 명칭으로만 구성하여 시군구 단위로 정규화 (동/읍/면인 region_3depth_name 제외)
      const displayName = region1 && region2 ? `${region1} ${region2}`.trim() : address.address_name;
      if (!displayName) continue;

      seen.add(lawdCode);
      results.push({
        lawdCode,
        displayName,
        raw: doc
      });
    }

    // 아파트명/건물명 키워드 검색(keyword.json)은 시군구 범위 조회를 위해 제외 처리합니다.
    return results;
  }

  if (jusoKey) {
    // keyword 파라미터는 API 요구사항에 맞춰 UTF-8 인코딩을 적용합니다.
    const url = `${JUSO_API_URL}?confmKey=${encodeURIComponent(jusoKey)}&keyword=${encodeURIComponent(query)}&currentPage=1&countPerPage=15&resultType=json`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`도로명주소 API 호출 에러 (${response.status})`);
    }

    const rawText = await response.text();
    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch {
      // UTF-8 BOM(\uFEFF) 제거 후 재파싱 시도
      const cleaned = rawText.trim().replace(/^\uFEFF/, "");
      body = JSON.parse(cleaned);
    }

    const errorCode = body.results?.common?.errorCode;
    if (errorCode && errorCode !== "0") {
      throw new Error(`도로명주소 API 응답 에러: ${body.results?.common?.errorMessage || errorCode}`);
    }

    const documents = body.results?.juso ?? [];

    const results: RegionCodeResult[] = [];
    const seen = new Set<string>();

    for (const doc of documents) {
      const admCd = doc.admCd; // 10자리 행정구역코드 (법정동코드)
      if (!admCd || admCd.length < 5) continue;
      const lawdCode = admCd.slice(0, 5); // 실거래 조회 시 필요한 앞 5자리 시군구코드
      if (seen.has(lawdCode)) continue;

      // 시도명(siNm)과 시군구명(sggNm)을 조합하여 "서울특별시 종로구" 등으로 노출
      const region1 = doc.siNm;
      const region2 = doc.sggNm;
      const displayName = region1 && region2 ? `${region1} ${region2}` : (doc.roadAddrPart1 ?? doc.roadAddr);
      if (!displayName) continue;

      seen.add(lawdCode);
      results.push({
        lawdCode,
        displayName,
        raw: doc
      });
    }

    return results;
  }

  throw new Error("주소 검색 API 승인키(JUSO_CONFM_KEY 또는 KAKAO_REST_API_KEY)가 설정되지 않았습니다.");
}
