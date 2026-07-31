export const Config = {
  // 기존 키
  get KAKAO_REST_API_KEY() { return process.env.KAKAO_REST_API_KEY; },
  get JUSO_CONFM_KEY() { return process.env.JUSO_CONFM_KEY; },
  get DATA_GO_KR_API_KEY() { return process.env.DATA_GO_KR_API_KEY; },
  get KAKAO_JAVASCRIPT_KEY() { return process.env.KAKAO_JAVASCRIPT_KEY; },
  get KAKAO_NATIVE_APP_KEY() { return process.env.KAKAO_NATIVE_APP_KEY; },
  get GEMINI_API_KEY() { return process.env.GEMINI_API_KEY; },
  get GOOGLE_CLIENT_ID() { return process.env.GOOGLE_CLIENT_ID; },
  get GOOGLE_CLIENT_SECRET() { return process.env.GOOGLE_CLIENT_SECRET; },
  get GOOGLE_REDIRECT_URI() { return process.env.GOOGLE_REDIRECT_URI; },
  // 새로 추가된 키
  get ALLOWED_EMAILS() { return process.env.ALLOWED_EMAILS; },
  get ADMIN_EMAILS() { return process.env.ADMIN_EMAILS; },
  get ENABLE_BOOTSTRAP_ADMIN() { return process.env.ENABLE_BOOTSTRAP_ADMIN; },
  // 서버 설정
  get PORT() { return process.env.PORT; },
  get HOST() { return process.env.HOST; },
  get TELEGRAM_BOT_TOKEN() { return process.env.TELEGRAM_BOT_TOKEN; },
  get TELEGRAM_CHAT_ID() { return process.env.TELEGRAM_CHAT_ID; },
  // 데이터 및 서비스 설정
  get GRAPH_DB_ENABLED() { return process.env.GRAPH_DB_ENABLED; },
  get CHECK_INTERVAL_SECONDS() { return process.env.CHECK_INTERVAL_SECONDS; },
};

/**
 * 서버 시작 시 환경변수를 검증합니다.
 * - 치명적 누락(인증 불가 상태): process.exit(1) 로 종료
 * - 선택적 누락(기능 일부 비활성화): console.warn 경고
 */
export function validateRequiredConfig() {
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── 인증 설정 검사 ─────────────────────────────────────────────
  const hasGoogleOAuth = Boolean(Config.GOOGLE_CLIENT_ID && Config.GOOGLE_REDIRECT_URI);
  const hasBootstrapAdmin = Config.ENABLE_BOOTSTRAP_ADMIN === "true";

  if (!hasGoogleOAuth && !hasBootstrapAdmin) {
    errors.push(
      "인증 설정 없음: GOOGLE_CLIENT_ID/GOOGLE_REDIRECT_URI 가 설정되지 않았고, ENABLE_BOOTSTRAP_ADMIN=true 도 지정되지 않았습니다. " +
      "서버에 접근할 수 없습니다. .env 파일을 확인하세요."
    );
  } else if (hasBootstrapAdmin && !hasGoogleOAuth) {
    warnings.push(
      "⚠️  [보안 경고] ENABLE_BOOTSTRAP_ADMIN=true 활성화 상태입니다. " +
      "Google OAuth 없이 관리자 세션이 자동 부여됩니다. 프로덕션 환경에서는 반드시 GOOGLE_CLIENT_ID를 설정하세요."
    );
  }

  // ── 국토부 API 키 검사 ────────────────────────────────────────
  if (!Config.DATA_GO_KR_API_KEY) {
    warnings.push(
      "⚠️  DATA_GO_KR_API_KEY 가 설정되지 않았습니다. 국토부 실거래 API 호출이 작동하지 않습니다."
    );
  }

  // ── 알림 설정 검사 ────────────────────────────────────────────
  if (!Config.TELEGRAM_BOT_TOKEN || !Config.TELEGRAM_CHAT_ID) {
    warnings.push(
      "⚠️  TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 설정되지 않았습니다. Telegram 알림이 비활성화됩니다."
    );
  }

  // ── 출력 ──────────────────────────────────────────────────────
  for (const warn of warnings) {
    console.warn(warn);
  }
  for (const err of errors) {
    console.error(`❌ ${err}`);
  }

  if (errors.length > 0) {
    console.error("❌ 필수 환경변수 누락으로 서버를 시작할 수 없습니다. 종료합니다.");
    process.exit(1);
  }
}

