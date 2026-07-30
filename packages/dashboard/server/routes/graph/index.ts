import { Router } from "express";
import regionRoutes from "./regionRoutes.js";
import analyticsRoutes from "./analyticsRoutes.js";
import presetRoutes from "./presetRoutes.js";
import insightRoutes from "./insightRoutes.js";
import geoRoutes from "./geoRoutes.js";

export function createGraphRouter(): Router {
  const router = Router();

  // 하위 세부 모듈 마운트
  router.use("/", regionRoutes);
  router.use("/", analyticsRoutes);
  router.use("/", presetRoutes);
  router.use("/", insightRoutes);
  router.use("/", geoRoutes);

  return router;
}
