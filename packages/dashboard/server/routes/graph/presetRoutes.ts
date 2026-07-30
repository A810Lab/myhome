import { Router } from "express";
import {
  readPresetsCore,
  savePresetCore,
  deletePresetCore
} from "@myhome/shared";
import { readPresets, savePreset, deletePreset } from "../../graphPresets.js";
import { getAuthenticatedEmail } from "../../utils/authUtils.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";

const router = Router();

// --- 기존 조회 조건 프리셋 API ---
router.get("/presets", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const presets = await readPresets(email);
  res.json(presets);
}));

router.post("/presets", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const { name, filter } = req.body;
  if (!name || !filter) {
    res.status(400).json({ error: "name 또는 filter가 누락되었습니다." });
    return;
  }
  const newPreset = await savePreset({ name, filter }, email);
  res.status(201).json(newPreset);
}));

router.delete("/presets/:id", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const { id } = req.params;
  const success = await deletePreset(id as string, email);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "존재하지 않는 프리셋 ID입니다." });
  }
}));

// --- 종합 현황용 프리셋 API ---
router.get("/presets/overview", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const presets = await readPresetsCore(email, "overview");
  res.json(presets);
}));

router.post("/presets/overview", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const { name, filter } = req.body;
  if (!name || !filter) {
    res.status(400).json({ error: "name 또는 filter가 누락되었습니다." });
    return;
  }
  const newPreset = await savePresetCore({ name, filter }, email, "overview");
  res.status(201).json(newPreset);
}));

router.delete("/presets/overview/:id", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const { id } = req.params;
  const success = await deletePresetCore(id as string, email, "overview");
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "존재하지 않는 프리셋 ID입니다." });
  }
}));

// --- 단지 분석용 프리셋 API ---
router.get("/presets/analysis", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const presets = await readPresetsCore(email, "analysis");
  res.json(presets);
}));

router.post("/presets/analysis", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const { name, regionName, buildingName, areaM2 } = req.body;
  if (!name || !regionName || !buildingName) {
    res.status(400).json({ error: "name, regionName, buildingName이 필요합니다." });
    return;
  }
  const newPreset = await savePresetCore({ name, regionName, buildingName, areaM2 }, email, "analysis");
  res.status(201).json(newPreset);
}));

router.delete("/presets/analysis/:id", asyncHandler(async (req, res) => {
  const email = getAuthenticatedEmail(req, res);
  if (!email) return;
  const { id } = req.params;
  const success = await deletePresetCore(id as string, email, "analysis");
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "존재하지 않는 프리셋 ID입니다." });
  }
}));

export default router;
