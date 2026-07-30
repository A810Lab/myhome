import "./env.js";
import { existsSync, readFileSync } from "node:fs";
import express from "express";
import { createRouter } from "./routes.js";
import { createGraphRouter } from "./routes-graph.js";
import { createAdminRouter } from "./routes-admin.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { initDb, closeGraphDb, cleanExpiredSessions } from "@myhome/shared";
import { createAuthRouter, authMiddleware, adminRequired } from "./authRoutes.js";

import { join, dirname } from "node:path";
import { Config, validateRequiredConfig } from "./config.js";

// .env 로드 후 즉시 필수 환경변수 검증 — 누락 시 경고 출력, 인증 설정 전무 시 즉시 종료
validateRequiredConfig();

function findAndLoadYamlPort(): number | null {
  let currentDir = process.cwd();
  // tsx watch 등으로 실행되는 파일 디렉토리 기준으로도 탐색할 수 있도록 __dirname 지원
  const fileDir = dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1'); // Windows drive letter 정규화
  
  const dirsToSearch = [currentDir, fileDir];
  const yamlNames = ["config.yaml", "config.yml", "app.yaml", "app.yml"];

  for (let startDir of dirsToSearch) {
    let dir = startDir;
    while (true) {
      for (const name of yamlNames) {
        const yamlPath = join(dir, name);
        if (existsSync(yamlPath)) {
          try {
            const content = readFileSync(yamlPath, "utf-8");
            const match = content.match(/^\s*(?:port|PORT)\s*:\s*(\d+)/m);
            if (match) {
              return Number(match[1]);
            }
          } catch (err) {
            console.error(`⚠️ YAML 설정을 읽는 중 오류 발생 (${yamlPath}):`, err);
          }
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const app = express();
app.set('trust proxy', 1); // Synology Nginx reverse proxy 환경에서 X-Forwarded-For 헤더 신뢰
const yamlPort = findAndLoadYamlPort();
const port = Number(Config.PORT ?? yamlPort ?? "4174");

app.use(express.json());
app.use("/api", authMiddleware);
app.use("/api/auth", createAuthRouter());
app.use("/api", createRouter());
app.use("/api/graph", createGraphRouter());
app.use("/api/admin", adminRequired, createAdminRouter());

// SPA 정적 파일 서빙 추가
const fileDir = dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
const distPath = join(fileDir, "../dist");

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*splat", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    res.sendFile(join(distPath, "index.html"));
  });
}

const host = Config.HOST ?? "0.0.0.0";
const server = app.listen(port, host, async () => {
  console.log(`Apartment Alert API listening on http://${host}:${port}`);
  try {
    initDb();
    console.log("💾 SQLite 데이터베이스가 정상적으로 초기화되었습니다.");
    
    // 만료 세션 주기적 제거 (1시간 주기)
    setInterval(() => {
      try {
        cleanExpiredSessions();
      } catch (err: any) {
        console.error("⚠️ 만료 세션 제거 실패:", err.message);
      }
    }, 3600 * 1000);
    // app-state.json 설정을 process.env에 로드
    const { applySystemConfigToEnv } = await import("./storage.js");
    await applySystemConfigToEnv();
    console.log("⚙️  시스템 API 설정이 환경 변수(env)에 정상 반영되었습니다.");
  } catch (err: any) {
    console.error("❌ SQLite 데이터베이스 초기화 실패:", err.message);
  }
  startScheduler();
});

// Graceful shutdown — 스케줄러 완료 대기 후 SQLite DB 해제
async function shutdown(signal: string) {
  console.log(`\n[${signal}] 서버 종료 중…`);
  server.close(async () => {
    await stopScheduler();   // 진행 중인 스케줄러 주기 완료 대기
    await closeGraphDb();    // SQLite DB 연결 해제
    console.log("SQLite DB 연결 해제 완료. 종료.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
