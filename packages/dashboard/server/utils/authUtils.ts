import { Request, Response } from "express";
import { Config } from "../config.js";

/**
 * Request에서 사용자 이메일을 안전하게 추출하거나 Bootstrap fallback을 적용하는 헬퍼.
 * 인증이 실패한 경우 자동으로 401 Response를 보내고 null을 반환합니다.
 */
export function getAuthenticatedEmail(req: Request, res: Response): string | null {
  let email = req.user?.email;
  if (!email) {
    if (Config.ENABLE_BOOTSTRAP_ADMIN === "true") {
      email = "bootstrap-admin@myhome.local";
    } else {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
  }
  return email;
}
