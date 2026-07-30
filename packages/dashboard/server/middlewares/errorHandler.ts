import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // console.error 대신 자세한 에러 로깅을 통합 관리합니다.
  console.error(`[Global Error] ${req.method} ${req.url}:`, err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      details: err.details,
    });
  }

  if (err instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: "요청 파라미터가 유효하지 않습니다.",
      details: err.issues,
    });
  }

  const message = err instanceof Error ? err.message : "서버 내부 오류가 발생했습니다.";
  return res.status(500).json({
    success: false,
    error: message,
  });
}
