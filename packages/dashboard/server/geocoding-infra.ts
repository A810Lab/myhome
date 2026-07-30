/**
 * geocoding-infra.ts — 단지 주변 입지 평가 엔진
 *
 * geocoding.ts에서 분리된 입지 평가 기능:
 * - calculateCategoryScore: 카테고리별 거리/개수 기반 가중 평점 계산
 * - generateMockInfraRating: API 키 미설정 시 해시 기반 Mock 데이터 생성
 * - getComplexInfraRating: 실제 카카오 API 호출 기반 종합 입지 평점 산출
 */

import { Config } from "./config.js";
import { simpleStringHash } from "./geocoding-utils.js";

// ──────────────────────────────────────────────────
// 내부 유틸: 카테고리 거리 평점 계산
// ──────────────────────────────────────────────────

function calculateCategoryScore(code: string, minDistance: number | null, count: number): number {
  if (minDistance === null || count === 0) return 0;

  // 1. 거리 점수 계산 (S_dist)
  let distanceScore = 0;
  const d = minDistance;

  if (code === "SW8") {
    // 지하철역 (반경 1000m) - 최고 배점
    if (d <= 250) distanceScore = 100;
    else if (d <= 500) distanceScore = 85;
    else if (d <= 1000) distanceScore = 60;
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

// ──────────────────────────────────────────────────
// Mock 입지 평가 (API 키 미설정 또는 좌표 없을 때)
// ──────────────────────────────────────────────────

function generateMockInfraRating(complexName: string) {
  const hash = simpleStringHash(complexName);
  const categoryConfigs = [
    { code: "SW8", name: "역세권", weight: 1.5, radius: 1000, baseDist: 150, countMax: 4 },
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

  const baseScore = Math.round((weightedScoreSum / weightSum) * 10) / 10;

  // NAT (조망/환경) 가상 데이터 생성 및 가산점화
  const natCategoryHash = hash + "NAT".charCodeAt(0) + "NAT".charCodeAt(1);
  const natSimulatedDist = 150 + (natCategoryHash % 1300);
  const natHasFacilities = natSimulatedDist <= 1000;

  let natScore = 0;
  let natCount = 0;
  let natMinDistance: number | null = null;
  let natDetails: any = null;

  if (natHasFacilities) {
    const hasWater = (natCategoryHash % 2) === 0;
    const waterMinDistance = hasWater ? (natSimulatedDist % 900) + 100 : null;
    const waterType = hasWater ? (natCategoryHash % 3 === 0 ? "OCEAN" : natCategoryHash % 3 === 1 ? "RIVER" : "LAKE") : null;

    const hasGreen = (natCategoryHash % 3) > 0;
    const greenMinDistance = hasGreen ? ((natSimulatedDist + 200) % 950) + 50 : null;
    const greenType = hasGreen ? (natCategoryHash % 2 === 0 ? "FOREST" : "PARK") : null;

    let sWater = 0;
    if (waterMinDistance !== null) {
      const d = waterMinDistance;
      if (d <= 250) sWater = 100;
      else if (d <= 500) sWater = 85;
      else if (d <= 1000) sWater = 60;
      
      const typeWeight = waterType === "OCEAN" ? 1.2 : waterType === "RIVER" ? 1.1 : waterType === "LAKE" ? 1.0 : 0.8;
      sWater = Math.min(100, Math.round(sWater * typeWeight));
    }

    let sGreen = 0;
    if (greenMinDistance !== null) {
      const d = greenMinDistance;
      if (d <= 250) sGreen = 100;
      else if (d <= 500) sGreen = 85;
      else if (d <= 1000) sGreen = 60;
      
      const typeWeight = greenType === "PARK" ? 1.0 : 0.9;
      sGreen = Math.min(100, Math.round(sGreen * typeWeight));
    }

    natScore = Math.max(sWater, sGreen);
    natCount = (hasWater ? 1 : 0) + (hasGreen ? 1 : 0);
    natMinDistance = natCount > 0 ? (waterMinDistance !== null && greenMinDistance !== null ? Math.min(waterMinDistance, greenMinDistance) : waterMinDistance ?? greenMinDistance) : null;

    natDetails = {
      waterMinDistance,
      waterType,
      greenMinDistance,
      greenType
    };
  }

  categories["NAT"] = {
    name: "조망/환경",
    score: natScore,
    count: natCount,
    minDistance: natMinDistance,
    details: natDetails
  };

  const bonus = Math.round((natScore / 10) * 10) / 10; // 최대 10점 가산
  const totalScore = Math.min(100, Math.round((baseScore + bonus) * 10) / 10);

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

// ──────────────────────────────────────────────────
// 실제 API 기반 종합 입지 평가
// ──────────────────────────────────────────────────

const nearbyInfraCache = new Map<string, any>();

/**
 * 특정 좌표 반경 내 핵심 입지(지하철역, 학교, 병원, 대형마트, 약국, 편의점) 검색 후
 * 가중 평점 계산 (특화 반경 및 노멀라이징 적용)
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

  const apiKey = Config.KAKAO_REST_API_KEY;
  if (!apiKey) {
    const mock = generateMockInfraRating(complexName);
    nearbyInfraCache.set(cacheKey, mock);
    return mock;
  }

  const categoryConfigs = [
    { code: "SW8", name: "역세권", weight: 1.5, radius: 1000 },
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
            const getUniqueStationName = (doc: any) => {
              const rawName = doc.place_name || "";
              const match = rawName.match(/^(.+?역)/);
              return match ? match[1] : rawName.trim();
            };

            const gtxUnique = new Map<string, number>();
            const railUnique = new Map<string, number>();
            const metroUnique = new Map<string, number>();

            docs.forEach((doc: any) => {
              const cat = doc.category_name || "";
              const name = doc.place_name || "";
              const distanceM = parseInt(doc.distance) || 0;
              const uniqueName = getUniqueStationName(doc);

              const isGtx = cat.includes("GTX") || name.includes("GTX");
              if (isGtx) {
                if (!gtxUnique.has(uniqueName)) {
                  gtxUnique.set(uniqueName, distanceM);
                }
                return;
              }

              const isRail = cat.includes("KTX") || cat.includes("SRT") || cat.includes("ITX") || 
                             name.includes("KTX") || name.includes("SRT") || name.includes("ITX") || 
                             name.includes("기차역") || name.includes("철도역") || 
                             name.endsWith("철도") || name.includes("일반철도");
              if (isRail) {
                if (!railUnique.has(uniqueName)) {
                  railUnique.set(uniqueName, distanceM);
                }
                return;
              }

              if (!metroUnique.has(uniqueName)) {
                metroUnique.set(uniqueName, distanceM);
              }
            });

            const gtxCount = gtxUnique.size;
            const gtxMinDistance = gtxCount > 0 ? Math.min(...Array.from(gtxUnique.values())) : null;

            const railCount = railUnique.size;
            const railMinDistance = railCount > 0 ? Math.min(...Array.from(railUnique.values())) : null;

            const metroCount = metroUnique.size;
            const metroMinDistance = metroCount > 0 ? Math.min(...Array.from(metroUnique.values())) : null;

            const allUniqueNames = new Set([
              ...gtxUnique.keys(),
              ...railUnique.keys(),
              ...metroUnique.keys()
            ]);
            count = allUniqueNames.size;
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

    const baseScore = Math.round((weightedScoreSum / weightSum) * 10) / 10;

    // NAT (조망/환경) 실거래 데이터 수집 - 카테고리 AT4 + 키워드 "하천", "공원", "호수" 병렬 검색
    let natScore = 0;
    let natCount = 0;
    let natMinDistance: number | null = null;
    let natDetails: any = null;

    const natQueries = [
      `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=AT4&x=${lng}&y=${lat}&radius=1000&sort=distance`,
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent("하천")}&x=${lng}&y=${lat}&radius=1000&sort=distance`,
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent("공원")}&x=${lng}&y=${lat}&radius=1000&sort=distance`,
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent("호수")}&x=${lng}&y=${lat}&radius=1000&sort=distance`
    ];

    try {
      const responses = await Promise.all(
        natQueries.map(q => 
          fetch(q, {
            headers: { Authorization: `KakaoAK ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );

      let natDocs: any[] = [];
      responses.forEach(body => {
        if (body && body.documents) {
          natDocs.push(...body.documents);
        }
      });

      // 중복 장소 제거 (id 기준)
      const seen = new Set();
      natDocs = natDocs.filter(doc => {
        const duplicate = seen.has(doc.id);
        seen.add(doc.id);
        return !duplicate;
      });

      // 거리 기준 오름차순 정렬
      natDocs.sort((a, b) => (parseInt(a.distance) || 0) - (parseInt(b.distance) || 0));

      if (natDocs.length > 0) {
        let waterMinDistance: number | null = null;
        let waterType: string | null = null;
        let greenMinDistance: number | null = null;
        let greenType: string | null = null;
        let waterCount = 0;
        let greenCount = 0;

        natDocs.forEach((doc: any) => {
          const cat = doc.category_name || "";
          const name = doc.place_name || "";
          const dist = parseInt(doc.distance) || 0;

          // 바다
          if (cat.includes("해수욕장") || name.includes("해수욕장") || name.includes("해변")) {
            waterCount++;
            if (waterMinDistance === null || dist < waterMinDistance) {
              waterMinDistance = dist;
              waterType = "OCEAN";
            }
          }
          // 호수/저수지
          else if (cat.includes("호수") || cat.includes("저수지") || name.includes("호수공원")) {
            waterCount++;
            if (waterMinDistance === null || dist < waterMinDistance) {
              waterMinDistance = dist;
              waterType = "LAKE";
            }
          }
          // 강/천
          else if (cat.includes("강") || cat.includes("계곡") || name.endsWith("강") || name.endsWith("천") || name.endsWith("하천") || name.includes("강변")) {
            waterCount++;
            if (waterMinDistance === null || dist < waterMinDistance) {
              waterMinDistance = dist;
              waterType = "RIVER";
            }
          }
          // 녹지/공원
          else if (cat.includes("공원") || cat.includes("산") || cat.includes("수목원") || cat.includes("자연") || name.includes("공원") || name.includes("수목원") || name.endsWith("산")) {
            greenCount++;
            if (greenMinDistance === null || dist < greenMinDistance) {
              greenMinDistance = dist;
              greenType = cat.includes("산") || name.endsWith("산") ? "FOREST" : "PARK";
            }
          }
        });

        natCount = waterCount + greenCount;
        natMinDistance = natCount > 0 ? (waterMinDistance !== null && greenMinDistance !== null ? Math.min(waterMinDistance, greenMinDistance) : waterMinDistance ?? greenMinDistance) : null;

        let sWater = 0;
        if (waterMinDistance !== null) {
          const d = waterMinDistance;
          let baseVal = 0;
          if (d <= 250) baseVal = 100;
          else if (d <= 500) baseVal = 85;
          else if (d <= 1000) baseVal = 60;
          
          const typeWeight = waterType === "OCEAN" ? 1.2 : waterType === "RIVER" ? 1.1 : waterType === "LAKE" ? 1.0 : 0.8;
          sWater = Math.min(100, Math.round(baseVal * typeWeight));
        }

        let sGreen = 0;
        if (greenMinDistance !== null) {
          const d = greenMinDistance;
          let baseVal = 0;
          if (d <= 250) baseVal = 100;
          else if (d <= 500) baseVal = 85;
          else if (d <= 1000) baseVal = 60;
          
          const typeWeight = greenType === "PARK" ? 1.0 : 0.9;
          sGreen = Math.min(100, Math.round(baseVal * typeWeight));
        }

        natScore = Math.max(sWater, sGreen);
        natDetails = {
          waterMinDistance,
          waterType,
          greenMinDistance,
          greenType
        };
      }
    } catch (err) {
      console.error("[Geocoding] NAT 병렬 수집 중 에러 발생:", err);
    }

    categories["NAT"] = {
      name: "조망/환경",
      score: natScore,
      count: natCount,
      minDistance: natMinDistance,
      details: natDetails
    };

    const bonus = Math.round((natScore / 10) * 10) / 10; // 최대 10점 가산
    const totalScore = Math.min(100, Math.round((baseScore + bonus) * 10) / 10);

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
