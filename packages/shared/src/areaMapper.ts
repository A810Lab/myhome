import { parseRealEstateXml } from "./xmlParser.js";
import { upsertAreaMapping, getAreaMapping } from "./db.js";

// 카카오 로컬 API를 이용해 주소의 10자리 법정동 코드(bCode)를 가져오는 헬퍼
async function getBCode(addressName: string): Promise<string | null> {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) return null;

  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addressName)}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body.documents && body.documents.length > 0) {
      return body.documents[0].address?.b_code ?? null;
    }
  } catch (err) {
    console.warn(`[AreaMapper] 카카오 법정동코드 조회 실패:`, err);
  }
  return null;
}

// 지번주소를 본번(bun)과 부번(ji)으로 변환 (각각 4자리 zero-padded 문자열)
function parseJibun(jibun: string): { bun: string; ji: string } {
  if (!jibun) return { bun: "", ji: "" };
  const match = jibun.trim().match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return { bun: "", ji: "" };

  const bunNum = parseInt(match[1], 10);
  const jiNum = match[2] ? parseInt(match[2], 10) : 0;

  return {
    bun: String(bunNum).padStart(4, "0"),
    ji: String(jiNum).padStart(4, "0"),
  };
}

/**
 * 특정 단지 및 전용면적에 대해 분양면적(공급면적)을 조회하고 DB에 캐싱합니다.
 */
export async function syncSupplyArea(params: {
  complexId: string;
  complexName: string;
  lawdCode: string; // 5자리 시군구코드
  dongName?: string;
  jibun?: string;
  areaM2: number;
  regionDisplayName: string; // 예: "서울특별시 마포구"
}): Promise<number> {
  const { complexId, complexName, lawdCode, dongName, jibun, areaM2, regionDisplayName } = params;

  // 0. 캐시 확인: 이미 매핑 정보가 적재되어 있다면 해당 분양면적 반환
  const cached = getAreaMapping(complexId, areaM2);
  if (cached) {
    return cached.supplyAreaM2;
  }

  // 1. 카카오 API를 활용해 법정동 코드 조회 시도
  let bCode: string | null = null;
  if (dongName && jibun) {
    // 예: 서울특별시 마포구 아현동 123-45
    const fullAddress = `${regionDisplayName} ${dongName} ${jibun}`.trim();
    bCode = await getBCode(fullAddress);
  }

  // 2. 공공데이터 인증키가 없거나 법정동 코드를 못 찾은 경우 폴백 계산 (전용률 78% 가정)
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey || !bCode || bCode.length < 10) {
    const fallbackSupply = Number((areaM2 / 0.78).toFixed(2));
    upsertAreaMapping(complexId, areaM2, fallbackSupply, "fallback");
    return fallbackSupply;
  }

  const sigunguCd = bCode.slice(0, 5); // 5자리 시군구
  const bjdongCd = bCode.slice(5, 10); // 5자리 법정동
  const { bun, ji } = parseJibun(jibun || "");

  // 2.5 건축물대장 표제부 API 호출 및 메타정보 갱신 (세대수, 주차대수 등)
  const titleUrl = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?serviceKey=${apiKey}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&numOfRows=10&pageNo=1`;
  try {
    const titleRes = await fetch(titleUrl, { signal: AbortSignal.timeout(10000) });
    if (titleRes.ok) {
      const titleXml = await titleRes.text();
      const titleItems = parseRealEstateXml(titleXml);
      if (titleItems && titleItems.length > 0) {
        const target = titleItems.find((it: any) => String(it.bldNm).includes(complexName)) || titleItems[0];
        const hhldCnt = Number(target.hhldCnt || 0);
        const totPkngCnt = Number(target.totPkngCnt || 0);
        const useAprvDay = String(target.useAprvDay || "").trim();

        let formattedDate: string | null = null;
        if (useAprvDay && useAprvDay.length === 8) {
          formattedDate = `${useAprvDay.substring(0, 4)}-${useAprvDay.substring(4, 6)}-${useAprvDay.substring(6, 8)}`;
        }

        const parkingPerHousehold = hhldCnt > 0 ? Number((totPkngCnt / hhldCnt).toFixed(2)) : null;

        const { updateComplexMeta } = await import("./db.js");
        updateComplexMeta(complexId, {
          totalHouseholds: hhldCnt || null,
          totalParking: totPkngCnt || null,
          parkingPerHousehold: parkingPerHousehold,
          useApprovalDate: formattedDate,
        });
        console.log(`[AreaMapper] complexes 메타정보 갱신 성공: ${complexName} (${hhldCnt}세대, 세대당주차 ${parkingPerHousehold}대)`);
      }
    }
  } catch (err: any) {
    console.warn(`[AreaMapper] 표제부 API 연동 실패 (${complexName}):`, err.message);
  }

  // 3. 건축물대장 전유공용면적 API 호출
  const url = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrExposPubuseAreaInfo?serviceKey=${apiKey}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&bun=${bun}&ji=${ji}&numOfRows=1000&pageNo=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xmlText = await res.text();
    const items = parseRealEstateXml(xmlText);

    // 전유 면적 중 실거래 전용면적(areaM2)과 일치하는 항목(오차 0.1㎡ 이내) 조회
    const matchedExpos = items.filter(
      (it: any) =>
        (it.exposPubuseAreaGbCd === 1 || it.exposPubuseAreaGbCd === "1" || String(it.exposPubuseAreaGbCdNm).includes("전유")) &&
        Math.abs(Number(it.area) - areaM2) < 0.1
    );

    if (matchedExpos.length > 0) {
      // 매칭된 호 중 첫 번째 호를 기준으로 주거공용면적 합산
      const targetExpo = matchedExpos[0];
      const targetDong = targetExpo.dongNm;
      const targetHo = targetExpo.hoNm;

      // 동일한 동, 호를 가진 공용 면적 필터링
      const publicAreas = items.filter(
        (it: any) =>
          (it.exposPubuseAreaGbCd === 2 || it.exposPubuseAreaGbCd === "2" || String(it.exposPubuseAreaGbCdNm).includes("공용")) &&
          it.dongNm === targetDong &&
          it.hoNm === targetHo
      );

      // 공용 면적 중 '주거공용' 성격의 면적 합산
      let mainPublicAreaSum = 0;
      for (const pa of publicAreas) {
        const purpose = String(pa.etcPurps || pa.exposPubuseAreaGbCdNm || "");
        
        // 제외할 용도 키워드 (기타공용, 주차장, 기계실 등 공급면적 외 제외)
        const excludeKeywords = ["주차", "기계", "전기", "정화조", "발전", "기타", "노유자", "주민"];
        const isExcluded = excludeKeywords.some((kw) => purpose.includes(kw));

        if (!isExcluded) {
          mainPublicAreaSum += Number(pa.area || 0);
        }
      }

      const supplyArea = Number((areaM2 + mainPublicAreaSum).toFixed(2));
      const ratio = areaM2 / supplyArea;

      // 산출된 전용률이 정상 범주(60% ~ 90%)인 경우에만 실측 데이터로 채택
      if (ratio >= 0.6 && ratio <= 0.9) {
        upsertAreaMapping(complexId, areaM2, supplyArea, "api");
        return supplyArea;
      }
    }
  } catch (err: any) {
    const isServerErr = err.message?.includes("500") || err.message?.includes("Unexpected errors");
    const errMsg = isServerErr ? `${err.message} (공공데이터포털 서버 장애 - 폴백 적용)` : err.message;
    console.warn(`[AreaMapper] 건축물대장 API 연동 실패 (${complexName}, ${areaM2}㎡):`, errMsg);
  }

  // API 연동에 실패하거나 전용률이 비정상적인 경우 폴백 적용
  const fallbackSupply = Number((areaM2 / 0.78).toFixed(2));
  upsertAreaMapping(complexId, areaM2, fallbackSupply, "fallback");
  return fallbackSupply;
}
