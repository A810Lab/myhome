import { z, ZodSchema } from "zod";
import { Request, Response, NextFunction } from "express";

/** Middleware to validate request body against a Zod schema. */
export const validateBody = (schema: ZodSchema<any>) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body || {});
      next();
    } catch (err) {
      next(err);
    }
  };
};

/** Middleware to validate request query parameters against a Zod schema. */
export const validateQuery = (schema: ZodSchema<any>) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req.query);
      for (const key in req.query) {
        delete req.query[key];
      }
      Object.assign(req.query, parsed);
      next();
    } catch (err) {
      next(err);
    }
  };
};

/** Schema for updating system configuration via POST /system-config */
export const systemConfigUpdateSchema = z.object({
  telegramBotToken: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
  kakaoRestApiKey: z.string().optional().nullable(),
  jusoConfmKey: z.string().optional().nullable(),
  dataGoKrApiKey: z.string().optional().nullable(),
  kakaoJavascriptKey: z.string().optional().nullable(),
  kakaoNativeAppKey: z.string().optional().nullable(),
  googleClientId: z.string().optional().nullable(),
  googleSecret: z.string().optional().nullable(),
  googleRedirectUri: z.string().optional().nullable(),
  allowedEmails: z.string().optional().nullable(),
  adminEmails: z.string().optional().nullable(),
  geminiApiKey: z.string().optional().nullable(),
});

/** Schema for GET /transactions query parameters */
export const transactionQuerySchema = z.object({
  lawd_cd: z.string().optional(),
  deal_ymd: z.string().optional(),
  start_ymd: z.string().optional(),
  end_ymd: z.string().optional(),
  refresh: z.string().optional(),
  region_name: z.string().optional(),
});

/** Schema for apartments list query */
export const apartmentsListQuerySchema = z.object({
  lawd_cd: z.string().optional(),
  refresh: z.string().optional(),
});

/** Schema for region search query */
export const regionsSearchQuerySchema = z.object({
  query: z.string().optional(),
});

/** New schemas for auth routes */
export const loginLocalSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().optional(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  isAdmin: z.boolean().optional().default(false),
});

/** Schema for complex coordinates */
export const complexCoordsSchema = z.object({
  complexId: z.string(),
  lat: z.number(),
  lng: z.number(),
});

export const complexCoordsResetSchema = z.object({
  complexId: z.string(),
});

/** Schema for user config update */
export const userConfigUpdateSchema = z.object({
  telegramBotToken: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
  kakaoRestApiKey: z.string().optional().nullable(),
  geminiApiKey: z.string().optional().nullable(),
});
export const logEntrySchema = z.object({
  activityType: z.string().min(1),
  description: z.string().min(1),
  payload: z.any().optional(),
});
