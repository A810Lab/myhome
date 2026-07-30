import { Router } from "express";
import { getDataContext, type GraphFilter } from "@myhome/shared";
import { readInsights, saveInsight, deleteInsight } from "../../graphInsights.js";
import { generateTextWithGemini } from "../../llmClient.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";

const router = Router();

// --- LLM 인사이트 API ---
router.get("/insights", asyncHandler(async (_req, res) => {
  const insights = await readInsights();
  res.json(insights);
}));

router.post("/insights", asyncHandler(async (req, res) => {
  const { title, filter, promptTemplate, generatedPrompt, response, source } = req.body;
  if (!title || !generatedPrompt) {
    res.status(400).json({ error: "title 또는 generatedPrompt가 누락되었습니다." });
    return;
  }
  const newInsight = await saveInsight({
    title,
    filter,
    promptTemplate,
    generatedPrompt,
    response,
    source: source || "manual",
  });
  res.status(201).json(newInsight);
}));

router.delete("/insights/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const success = await deleteInsight(id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "존재하지 않는 인사이트 ID입니다." });
  }
}));

/** POST /api/graph/insights/generate — LLM을 통한 분석 리포트 생성 및 저장 */
router.post("/insights/generate", asyncHandler(async (req, res) => {
  const { lawdCode, complexName, regionName } = req.body;
  if (!lawdCode) {
    res.status(400).json({ error: "lawdCode 파라미터가 필요합니다." });
    return;
  }

  const filter: GraphFilter = {
    lawdCode,
    complexName: complexName || undefined,
    startDate: undefined,
    endDate: undefined,
  };

  const contextText = await getDataContext(filter);

  const targetName = complexName ? `${complexName} (${regionName || lawdCode})` : (regionName || lawdCode);
  const prompt = `
아래는 ${targetName} 아파트 실거래 데이터 요약 정보입니다.
이 데이터를 심층 분석하여 최근 거래 동향, 가격 추이의 특징(상승/하락/보합세), 그리고 실주거 및 투자 관점에서의 의견을 정리한 종합 분석 리포트를 작성해 주세요.

[실거래 데이터 정보]
${contextText}

[작성 규칙]
1. 한글로 작성해 주세요.
2. 가독성을 위해 마크다운(Markdown) 형식(소제목, 글머리 기호, 굵은 글씨 등)을 풍부하게 활용하세요.
3. 데이터에 기반하여 핵심 트렌드(평균가 변화량, 최고가 대비 현 시세 비율, 거래 활성도 등)를 정확하게 해석해 주세요.
4. 분석 마지막 부분에는 이 지역/단지에 대한 종합 투자 및 거주 요약 의견을 2~3줄 요약 문단으로 명시해 주세요.
`;

  const generatedReport = await generateTextWithGemini(prompt);

  const title = complexName ? `${complexName} 실거래 분석 리포트` : `${regionName || lawdCode} 지역 실거래 분석 리포트`;
  const newInsight = await saveInsight({
    title,
    filter: { lawdCode, complexName },
    promptTemplate: "default-apartment-analysis",
    generatedPrompt: prompt,
    response: generatedReport,
    source: "api",
  });

  res.status(201).json(newInsight);
}));

export default router;
