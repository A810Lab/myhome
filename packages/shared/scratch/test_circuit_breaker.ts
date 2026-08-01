import { syncSupplyArea } from "../src/areaMapper.js";
import { initDb, getDb } from "../src/db.js";

// 테스트 실행 전 DB 초기화
initDb();

const originalFetch = globalThis.fetch;
let fetchCallCount = 0;

// fetch 모킹 정의
globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof url === "string" ? url : url.toString();
  fetchCallCount++;

  console.log(`[TestMock] Fetch Called (${fetchCallCount}): ${urlStr.slice(0, 100)}...`);

  // 카카오 API 모킹 (bCode 10자리 성공 응답 제공)
  if (urlStr.includes("dapi.kakao.com")) {
    return new Response(
      JSON.stringify({
        documents: [
          {
            address: {
              b_code: "1111012300" // 10자리 법정동
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 공공데이터포털 API 모킹 (강제 HTTP 500 에러 발생)
  if (urlStr.includes("apis.data.go.kr")) {
    return new Response("<error>Internal Server Error</error>", {
      status: 500,
      statusText: "Internal Server Error"
    });
  }

  return new Response("OK", { status: 200 });
};

async function runTest() {
  console.log("=== 서킷 브레이커 검증 테스트 시작 ===");
  
  // API 인증키 임시 설정
  process.env.DATA_GO_KR_API_KEY = "MOCK_DATA_GO_KR_API_KEY";
  process.env.KAKAO_REST_API_KEY = "MOCK_KAKAO_REST_API_KEY";

  const db = getDb();
  const now = new Date().toISOString();

  // 기존 테스트 데이터 클리어 (캐시 히트 우회용)
  db.exec(`
    DELETE FROM complex_area_mappings WHERE complex_id LIKE 'TEST_COMPLEX_CB_%'
  `);

  // regions 테이블에 테스트용 lawdCode 등록하여 외래키 제약 우회
  const regionStmt = db.prepare(`
    INSERT INTO regions (lawd_code, display_name, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(lawd_code) DO NOTHING
  `);
  regionStmt.run("11110", "서울특별시 테스트구", now);

  // complexes 테이블에 테스트용 complexId들을 미리 등록하여 외래키 제약 우회
  const stmt = db.prepare(`
    INSERT INTO complexes (id, lawd_code, name, created_at, dong_name, jibun, road_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  
  for (let i = 1; i <= 6; i++) {
    stmt.run(`TEST_COMPLEX_CB_${i}`, "11110", `테스트아파트_${i}`, now, "테스트동", "100", "테스트로");
  }

  // 1회차부터 6회차까지 호출 (에러 누적 유도 및 차단 상태 검증)
  // 매번 areaM2를 다르게 하여 캐시 히트를 우회하고 캐시 미스로 공공데이터 API를 호출하게 만듦
  for (let i = 1; i <= 6; i++) {
    const areaM2 = 84 + i;
    console.log(`\n--- [시도 ${i}] areaM2: ${areaM2}㎡ ---`);
    const startTime = Date.now();
    
    const fetchBefore = fetchCallCount;
    const result = await syncSupplyArea({
      complexId: `TEST_COMPLEX_CB_${i}`,
      complexName: `테스트아파트_${i}`,
      lawdCode: "11110",
      dongName: "테스트동",
      jibun: "100",
      areaM2: areaM2,
      regionDisplayName: "서울특별시 테스트구"
    });
    const endTime = Date.now();

    const expectedFallback = Number((areaM2 / 0.78).toFixed(2));
    const fetchDiff = fetchCallCount - fetchBefore;

    console.log(`결과 면적: ${result}㎡ (예상 fallback: ${expectedFallback}㎡, 일치여부: ${result === expectedFallback})`);
    console.log(`API 호출 수: ${fetchDiff}회`);
    console.log(`수행 시간: ${endTime - startTime}ms`);
    
    // 시도 6의 경우, 서킷 브레이커 작동으로 API를 호출하지 않아야 함.
    if (i === 6) {
      if (fetchDiff === 0) {
        console.log("-> 성공: 6회째 호출은 서킷 브레이커 작동으로 API 호출 없이 즉시 리턴되었습니다.");
      } else {
        console.error("-> 실패: 6회째 호출임에도 API 호출이 수행되었습니다.");
      }
    }
  }

  // 복구 검증을 위해 원래대로 복구
  globalThis.fetch = originalFetch;
  console.log("\n=== 테스트 완료 ===");
}

runTest().catch((err) => {
  console.error("테스트 실패:", err);
  globalThis.fetch = originalFetch;
});
