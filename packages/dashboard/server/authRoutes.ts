import express from "express";
import crypto from "node:crypto";
import { saveSession, getSession, deleteSession, getUserPasswordHash, updateUserCredentials, isTemporaryPassword, getDb } from "@myhome/shared";
import { getSystemConfig, saveSystemConfig } from "./storage.js";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const calcHash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return calcHash === hash;
}

// Express.Request 인터페이스 확장
declare global {
  namespace Express {
    interface Request {
      user?: {
        email: string;
        isAdmin?: boolean;
      };
    }
  }
}

export function getSessionIdFromCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").reduce((acc, current) => {
    const parts = current.trim().split("=");
    if (parts.length >= 2) {
      const key = parts[0];
      const value = parts.slice(1).join("=");
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, string>);
  return cookies["session_id"] || null;
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

export function isUserAdmin(email: string, allowedEmailsStr: string, adminEmailsStr: string): boolean {
  const lowerEmail = email.toLowerCase();
  if (lowerEmail === "bootstrap-admin@myhome.local") {
    return true;
  }
  const adminList = adminEmailsStr
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminList.includes(lowerEmail)) {
    return true;
  }

  if (adminList.length === 0) {
    const allowedList = allowedEmailsStr
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (allowedList.length > 0 && allowedList[0] === lowerEmail) {
      return true;
    }
  }

  return false;
}

export function createAuthRouter() {
  const router = express.Router();

  router.get("/google", (req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!googleClientId || !googleRedirectUri) {
      console.error("❌ 구글 OAuth 설정이 완료되지 않았습니다. GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI 확인 필요.");
      res.status(500).json({ error: "Google OAuth is not configured on this server." });
      return;
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(
      googleRedirectUri
    )}&response_type=code&scope=openid%20email%20profile`;

    res.redirect(authUrl);
  });

  router.get("/google/callback", async (req, res) => {
    const code = req.query.code;
    if (!code || typeof code !== "string") {
      res.redirect("/login?error=oauth_failed");
      return;
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
      res.status(500).json({ error: "Google OAuth credentials are not fully configured." });
      return;
    }

    try {
      // 1. Google Token API 호출
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: googleRedirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error("❌ Google Token API Error:", errText);
        res.redirect("/login?error=oauth_failed");
        return;
      }

      const tokenData = (await tokenResp.json()) as { id_token?: string };
      if (!tokenData.id_token) {
        console.error("❌ id_token missing in Google Token API response");
        res.redirect("/login?error=oauth_failed");
        return;
      }

      // 2. ID 토큰 디코딩하여 이메일 추출
      const payload = decodeJwtPayload(tokenData.id_token);
      if (!payload || !payload.email) {
        console.error("❌ Failed to parse Google email from ID token");
        res.redirect("/login?error=oauth_failed");
        return;
      }

      const email = payload.email.toLowerCase();

      // 3. 이메일 화이트리스트 검사 (ALLOWED_EMAILS)
      const allowedEmailsEnv = process.env.ALLOWED_EMAILS || "";
      const allowedList = allowedEmailsEnv
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (allowedList.length === 0 || !allowedList.includes(email)) {
        console.warn(`⚠️ Access Blocked: ${email} is not in ALLOWED_EMAILS list or list is empty.`);
        res.redirect("/login?error=no_access");
        return;
      }

      // 4. 세션 생성 및 DB 저장
      const sessionId = crypto.randomUUID();
      const maxAgeSeconds = 30 * 24 * 60 * 60; // 30일
      const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;

      saveSession(sessionId, email, expiresAt, "google");

      // 5. HTTP-Only 쿠키 굽고 대시보드로 이동
      res.setHeader(
        "Set-Cookie",
        `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=${maxAgeSeconds}; SameSite=Lax`
      );

      res.redirect("/");
    } catch (err) {
      console.error("❌ Google OAuth Callback Error:", err);
      res.redirect("/login?error=oauth_failed");
    }
  });

  router.get("/me", (req, res) => {
    // [BOOTSTRAP 모드] 구글 설정을 마치기 전까지 임시 세션 부여
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!googleClientId || !googleRedirectUri) {
      res.json({
        isAuthenticated: true,
        email: "bootstrap-admin@myhome.local",
        isAdmin: true,
      });
      return;
    }

    const sessionId = getSessionIdFromCookies(req.headers.cookie);
    if (!sessionId) {
      res.json({ isAuthenticated: false });
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      res.json({ isAuthenticated: false });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt < now) {
      res.json({ isAuthenticated: false });
      return;
    }

    const allowedEmailsEnv = process.env.ALLOWED_EMAILS || "";
    const adminEmailsEnv = process.env.ADMIN_EMAILS || "";
    const isAdmin = isUserAdmin(session.email, allowedEmailsEnv, adminEmailsEnv);
    const isTemp = session.loginMethod === "local" && isTemporaryPassword(session.email);

    res.json({
      isAuthenticated: true,
      email: session.email,
      isAdmin,
      isTemporaryPassword: isTemp
    });
  });

  router.post("/logout", (req, res) => {
    const sessionId = getSessionIdFromCookies(req.headers.cookie);
    if (sessionId) {
      deleteSession(sessionId);
    }
    // 쿠키 제거
    res.setHeader("Set-Cookie", "session_id=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");
    res.json({ ok: true });
  });

  router.post("/login-local", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "이메일과 비밀번호를 입력해주세요." });
      return;
    }

    const lowerEmail = email.trim().toLowerCase();
    const storedHash = getUserPasswordHash(lowerEmail);

    if (!storedHash) {
      res.status(401).json({ error: "가입되지 않았거나 이메일/비밀번호가 다릅니다." });
      return;
    }

    const isValid = verifyPassword(password, storedHash);
    if (!isValid) {
      res.status(401).json({ error: "가입되지 않았거나 이메일/비밀번호가 다릅니다." });
      return;
    }

    // 세션 생성
    const sessionId = crypto.randomUUID();
    const maxAgeSeconds = 30 * 24 * 60 * 60; // 30일
    const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;

    saveSession(sessionId, lowerEmail, expiresAt, "local");

    // HTTP-Only 쿠키
    res.setHeader(
      "Set-Cookie",
      `session_id=${sessionId}; Path=/; HttpOnly; Max-Age=${maxAgeSeconds}; SameSite=Lax`
    );

    res.json({
      ok: true,
      email: lowerEmail,
      isTemporaryPassword: isTemporaryPassword(lowerEmail)
    });
  });

  router.post("/credentials", (req, res) => {
    const sessionId = getSessionIdFromCookies(req.headers.cookie);
    if (!sessionId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const session = getSession(sessionId);
    if (!session) {
      res.status(401).json({ error: "유효하지 않은 세션입니다." });
      return;
    }

    const { email, password } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).json({ error: "이메일은 필수 입력 항목입니다." });
      return;
    }

    const currentEmail = session.email;
    const newEmail = email.trim().toLowerCase();
    
    let passwordHash: string | null = null;
    if (password && typeof password === "string" && password.trim().length > 0) {
      passwordHash = hashPassword(password);
    }

    try {
      updateUserCredentials(currentEmail, newEmail, passwordHash);

      // 세션 내부 이메일도 변경해줌
      const maxAgeSeconds = 30 * 24 * 60 * 60;
      const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
      saveSession(sessionId, newEmail, expiresAt, session.loginMethod || undefined);

      res.json({ ok: true, email: newEmail });
    } catch (err: any) {
      console.error("❌ Failed to update credentials:", err);
      res.status(500).json({ error: err.message || "설정 변경에 실패했습니다." });
    }
  });

  router.post("/users", authMiddleware, adminRequired, async (req, res) => {
    const { email, isAdmin } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      res.status(400).json({ error: "이메일은 필수입니다." });
      return;
    }

    const lowerEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lowerEmail)) {
      res.status(400).json({ error: "올바르지 않은 이메일 형식입니다." });
      return;
    }

    try {
      // 1. 임시 비밀번호 생성 (8자리 랜덤 16진수)
      const tempPassword = crypto.randomBytes(4).toString("hex");
      const passwordHash = hashPassword(tempPassword);

      // 2. user_settings DB 레코드 생성 또는 업데이트
      const db = getDb();
      const now = new Date().toISOString();
      const existing = db.prepare("SELECT email FROM user_settings WHERE email = ?").get(lowerEmail);

      if (!existing) {
        db.prepare(`
          INSERT INTO user_settings (email, telegram_bot_token, telegram_chat_id, kakao_rest_api_key, alerted_dedupe_keys, password_hash, is_temporary_password, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(lowerEmail, null, null, null, "[]", passwordHash, 1, now);
      } else {
        db.prepare(`
          UPDATE user_settings
          SET password_hash = ?, is_temporary_password = 1, updated_at = ?
          WHERE email = ?
        `).run(passwordHash, now, lowerEmail);
      }

      // 3. ALLOWED_EMAILS 에 추가
      const config = await getSystemConfig();
      const allowedEmailsEnv = config.allowedEmails || process.env.ALLOWED_EMAILS || "";
      let allowedList = allowedEmailsEnv
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (!allowedList.includes(lowerEmail)) {
        allowedList.push(lowerEmail);
      }

      // 4. ADMIN_EMAILS 에 추가
      let adminList = (config.adminEmails || process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (isAdmin) {
        if (!adminList.includes(lowerEmail)) {
          adminList.push(lowerEmail);
        }
      } else {
        adminList = adminList.filter((e) => e !== lowerEmail);
      }

      await saveSystemConfig({
        allowedEmails: allowedList.join(","),
        adminEmails: adminList.join(",")
      });

      res.json({ ok: true, email: lowerEmail, tempPassword, isAdmin: isAdmin || false });
    } catch (err: any) {
      console.error("❌ Failed to add user with temporary password:", err);
      res.status(500).json({ error: err.message || "계정 추가에 실패했습니다." });
    }
  });

  return router;
}

export function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // 인증이 필요 없는 화이트리스트 경로
  const path = req.path;
  const isWhiteListed =
    path === "/health" ||
    path === "/auth/google" ||
    path === "/auth/google/callback" ||
    path === "/auth/me" ||
    path === "/auth/login-local" ||
    path === "/config"; // 시스템 설정 감지용 config 엔드포인트는 인증없이 읽을 수 있도록 허용

  if (isWhiteListed) {
    return next();
  }

  // [BOOTSTRAP 모드] 구글 OAuth가 설정되지 않은 경우, 임시 관리자 권한을 부여하여 대시보드 진입 허용 (환경설정 유도)
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!googleClientId || !googleRedirectUri) {
    console.warn("⚠️ 구글 OAuth 설정이 감지되지 않아 임시 Bootstrap 관리자 세션을 부여합니다. 환경 설정을 진행해 주세요.");
    req.user = { email: "bootstrap-admin@myhome.local", isAdmin: true };
    return next();
  }

  // API 엔드포인트가 아니거나 정적 파일 요청이면 인증 절차 진행하되 미인증 시 로그인 페이지로
  const sessionId = getSessionIdFromCookies(req.headers.cookie);
  if (!sessionId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (session.expiresAt < now) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // 로그인 상태 유지
  const allowedEmailsEnv = process.env.ALLOWED_EMAILS || "";
  const adminEmailsEnv = process.env.ADMIN_EMAILS || "";
  const isAdmin = isUserAdmin(session.email, allowedEmailsEnv, adminEmailsEnv);
  req.user = { email: session.email, isAdmin };
  next();
}

export function adminRequired(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user || !req.user.isAdmin) {
    res.status(403).json({ error: "Forbidden: Administrator privileges required." });
    return;
  }
  next();
}
