import React, { useState, useEffect } from "react";
import { Database, Settings, ShieldAlert, CheckCircle, Save, Sliders, Globe, Building2, HelpCircle } from "lucide-react";
import { useBreakpoint } from "../useBreakpoint";
import { SectionCard } from "../components/SectionCard";
import { PageHeader } from "../components/PageHeader";
import { classNames } from "../lib/format";
import type { DashboardState } from "../types";
import packageJson from "../../package.json";
import { loadSystemConfig, saveSystemConfig, loadUserConfig, saveUserConfig, updateCredentials } from "../api";
import { copy } from "../locales/ko";
import { readDisplayPreferences, saveDisplayPreferences, resetDisplayPreferences, DISPLAY_FONT_OPTIONS, DISPLAY_ACCENT_OPTIONS } from "../lib/displayPreferences";
import { TelegramGuideModal } from "../components/TelegramGuideModal";

const locale = "ko";
const t = copy[locale];

type SettingsTab = "api" | "display" | "account";

export function SettingsPage({ state, onChanged, isAdmin = false, userEmail }: { state: DashboardState | undefined; onChanged?: () => void; isAdmin?: boolean; userEmail?: string }) {
  const { isMobile } = useBreakpoint();
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");

  // 로컬 로그인 이메일 & 비밀번호 설정
  const [localEmail, setLocalEmail] = useState(userEmail || "");
  const [localPassword, setLocalPassword] = useState("");
  const [localPasswordConfirm, setLocalPasswordConfirm] = useState("");
  const [localSaving, setLocalSaving] = useState(false);
  const [localSuccessMsg, setLocalSuccessMsg] = useState("");
  const [localErrorMsg, setLocalErrorMsg] = useState("");

  useEffect(() => {
    if (userEmail) {
      setLocalEmail(userEmail);
    }
  }, [userEmail]);

  const handleAccountSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localEmail.trim()) {
      setLocalErrorMsg("이메일은 필수 입력 항목입니다.");
      return;
    }
    if (localPassword && localPassword !== localPasswordConfirm) {
      setLocalErrorMsg("비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    
    setLocalSaving(true);
    setLocalSuccessMsg("");
    setLocalErrorMsg("");
    try {
      const res = await updateCredentials(localEmail.trim(), localPassword || undefined);
      if (res.ok) {
        setLocalSuccessMsg("계정 설정이 저장되었습니다. 이메일이 변경된 경우 새로운 이메일로 다시 로그인 세션이 유지됩니다.");
        setLocalPassword("");
        setLocalPasswordConfirm("");
        setTimeout(() => setLocalSuccessMsg(""), 4000);
        if (onChanged) onChanged();
      }
    } catch (err: any) {
      setLocalErrorMsg(err.message || "계정 설정 저장 실패");
    } finally {
      setLocalSaving(false);
    }
  };
  const [isTelegramGuideOpen, setIsTelegramGuideOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // 설정 폼 필드
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [kakaoRestApiKey, setKakaoRestApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [kakaoJavascriptKey, setKakaoJavascriptKey] = useState("");
  const [kakaoNativeAppKey, setKakaoNativeAppKey] = useState("");
  const [jusoConfmKey, setJusoConfmKey] = useState("");
  const [dataGoKrApiKey, setDataGoKrApiKey] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleRedirectUri, setGoogleRedirectUri] = useState("");

  // 화면 표시 설정 상태
  const [pref, setPref] = useState(readDisplayPreferences());

  const handlePrefChange = (changes: Partial<typeof pref>) => {
    const next = saveDisplayPreferences(changes);
    setPref(next);
  };

  // 설정값 불러오기
  const fetchConfig = async () => {
    setLoading(true);
    try {
      const [systemData, userData] = await Promise.all([
        loadSystemConfig(),
        loadUserConfig(),
      ]);
      setTelegramBotToken(userData.telegramBotToken || "");
      setTelegramChatId(userData.telegramChatId || "");
      setKakaoRestApiKey(userData.kakaoRestApiKey || "");
      setGeminiApiKey((userData as any).geminiApiKey || "");

      setKakaoJavascriptKey(systemData.kakaoJavascriptKey || "");
      setKakaoNativeAppKey(systemData.kakaoNativeAppKey || "");
      setJusoConfmKey(systemData.jusoConfmKey || "");
      setDataGoKrApiKey(systemData.dataGoKrApiKey || "");
      googleClientId || setGoogleClientId(systemData.googleClientId || "");
      setGoogleClientSecret(systemData.googleClientSecret || "");
      setGoogleRedirectUri(systemData.googleRedirectUri || "");
    } catch (err: any) {
      console.error("Failed to load config:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // 설정값 저장하기
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    try {
      const promises = [
        saveUserConfig({
          telegramBotToken,
          telegramChatId,
          kakaoRestApiKey,
          geminiApiKey: geminiApiKey || null,
        } as any)
      ];
      if (isAdmin) {
        promises.push(
          saveSystemConfig({
            kakaoJavascriptKey,
            kakaoNativeAppKey,
            jusoConfmKey,
            dataGoKrApiKey,
            googleClientId,
            googleClientSecret,
            googleRedirectUri,
          })
        );
      }
      await Promise.all(promises);
      setSuccessMsg("설정이 성공적으로 저장 및 적용되었습니다.");
      setTimeout(() => setSuccessMsg(""), 3000);
      if (onChanged) onChanged();
    } catch (err: any) {
      setErrorMsg(err.message || "설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="환경 설정"
        subtitle="시스템 연동 API 키와 화면 표시 설정을 관리합니다."
        icon={Settings}
      />

      {/* Responsive 2-mode Tab Strip */}
      <div className="relative">
        {/* Desktop Underline Tab Strip */}
        <div className="hidden md:flex border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setActiveTab("api")}
            className={classNames(
              "px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2",
              activeTab === "api"
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            <Globe size={16} />
            <span>외부 API 연동 설정</span>
          </button>
          <button
            onClick={() => setActiveTab("display")}
            className={classNames(
              "px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2",
              activeTab === "display"
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            <Sliders size={16} />
            <span>화면 표시 설정</span>
          </button>
          <button
            onClick={() => setActiveTab("account")}
            className={classNames(
              "px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2",
              activeTab === "account"
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            )}
          >
            <ShieldAlert size={16} />
            <span>계정 설정</span>
          </button>
        </div>

        {/* Mobile Pill-like Tabs */}
        <div className="flex md:hidden overflow-x-auto scrollbar-none gap-2 pb-1 snap-x snap-mandatory">
          <button
            onClick={() => setActiveTab("api")}
            className={classNames(
              "snap-start shrink-0 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5",
              activeTab === "api"
                ? "bg-primary-600 text-white dark:bg-primary-500"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            <Globe size={14} />
            <span>연동 설정</span>
          </button>
          <button
            onClick={() => setActiveTab("display")}
            className={classNames(
              "snap-start shrink-0 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5",
              activeTab === "display"
                ? "bg-primary-600 text-white dark:bg-primary-500"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            <Sliders size={14} />
            <span>표시 설정</span>
          </button>
          <button
            onClick={() => setActiveTab("account")}
            className={classNames(
              "snap-start shrink-0 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5",
              activeTab === "account"
                ? "bg-primary-600 text-white dark:bg-primary-500"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            )}
          >
            <ShieldAlert size={14} />
            <span>계정 설정</span>
          </button>
        </div>
      </div>

      {activeTab === "account" && (
        <div className="space-y-6 animate-fade-in-up">
          <SectionCard
            title="로컬 로그인 계정 설정"
            right={<Sliders size={15} className="text-primary" />}
          >
            <form onSubmit={handleAccountSave} className="space-y-5 max-w-md">
              {localSuccessMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-500 flex items-center gap-2">
                  <CheckCircle size={15} />
                  <span>{localSuccessMsg}</span>
                </div>
              )}
              {localErrorMsg && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs font-semibold text-rose-500 flex items-center gap-2">
                  <ShieldAlert size={15} />
                  <span>{localErrorMsg}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-neutral">로그인 이메일 주소</label>
                <input
                  type="email"
                  required
                  value={localEmail}
                  onChange={(e) => setLocalEmail(e.target.value)}
                  className="w-full rounded-lg border border-normal bg-normal px-3 py-2 text-xs font-semibold text-strong focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="user@example.com"
                />
                <p className="text-[10px] text-neutral leading-relaxed">
                  로컬 로그인(비밀번호 로그인)에 사용할 이메일입니다. 이메일을 변경하면 작성한 알림 규칙 및 프리셋 소유자도 함께 이전됩니다.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-neutral">새 비밀번호</label>
                <input
                  type="password"
                  value={localPassword}
                  onChange={(e) => setLocalPassword(e.target.value)}
                  className="w-full rounded-lg border border-normal bg-normal px-3 py-2 text-xs font-semibold text-strong focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="변경할 새 비밀번호 입력 (공백 시 미변경)"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-neutral">새 비밀번호 확인</label>
                <input
                  type="password"
                  value={localPasswordConfirm}
                  onChange={(e) => setLocalPasswordConfirm(e.target.value)}
                  className="w-full rounded-lg border border-normal bg-normal px-3 py-2 text-xs font-semibold text-strong focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="새 비밀번호 다시 입력"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={localSaving}
                  className="flex items-center justify-center gap-1.5 px-4 h-9 bg-primary hover:bg-primary/80 text-white text-xs font-bold rounded-lg shadow-sm shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {localSaving ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-b-white" />
                  ) : (
                    <Save size={13} />
                  )}
                  <span>계정 설정 저장</span>
                </button>
              </div>
            </form>
          </SectionCard>
        </div>
      )}

      {/* Tab Contents */}
      {activeTab === "api" && (
        <div className="space-y-6">
          {/* Status summary */}
          {isAdmin && (
            <SectionCard
              title={t.systemStatusTitle}
              right={<Database className="h-4 w-4 text-primary" />}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-y-4 gap-x-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">데이터 소스</p>
                  <p className="text-xs font-bold text-strong">PlayMCP</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">공공데이터 실거래 API</p>
                  <p className={classNames("text-xs font-bold", state?.config.dataGoKrConfigured ? "text-emerald-500" : "text-warn")}>
                    {state?.config.dataGoKrConfigured ? "활성 (data.go.kr)" : "미설정 (수집 제한)"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">텔레그램 알림</p>
                  <p className={classNames("text-xs font-bold", state?.config.telegramConfigured ? "text-emerald-500" : "text-warn")}>
                    {state?.config.telegramConfigured ? "활성" : "점검 필요"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">카카오 REST API</p>
                  <p className={classNames("text-xs font-bold", state?.config.kakaoConfigured ? "text-emerald-500" : "text-neutral")}>
                    {state?.config.kakaoConfigured ? "활성 (검색)" : "미설정"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">카카오 JS API</p>
                  <p className={classNames("text-xs font-bold", state?.config.kakaoJavascriptConfigured ? "text-emerald-500" : "text-neutral")}>
                    {state?.config.kakaoJavascriptConfigured ? "활성 (지도)" : "미설정"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">카카오 Native API</p>
                  <p className={classNames("text-xs font-bold", state?.config.kakaoNativeAppConfigured ? "text-emerald-500" : "text-neutral")}>
                    {state?.config.kakaoNativeAppConfigured ? "활성" : "미설정"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">도로명주소 API</p>
                  <p className={classNames("text-xs font-bold", state?.config.jusoConfigured ? "text-emerald-500" : "text-neutral")}>
                    {state?.config.jusoConfigured ? "활성 (juso.go.kr)" : "미설정"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-neutral uppercase">현재 버전</p>
                  <p className="text-xs font-bold text-strong">v{packageJson.version}</p>
                </div>
              </div>
              <p className="text-[10px] text-assistive mt-4">
                * 주소 검색 시 <strong>카카오 Local(REST) API</strong>가 기본(우선) 사용되며, 미설정 시 <strong>행안부 도로명주소 API</strong>로 대체 자동 전환(Fallback)됩니다. 두 API가 모두 미설정된 경우 <strong>PlayMCP</strong> 내장 검색 모듈로 작동합니다.
              </p>
            </SectionCard>
          )}

          {/* Form Editor */}
          <SectionCard
            title="외부 API 연동 설정"
            className={classNames(!isAdmin && "max-w-2xl")}
          >
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                {successMsg && (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs px-4 py-3 rounded-lg max-w-2xl">
                    <CheckCircle size={14} />
                    <span>{successMsg}</span>
                  </div>
                )}
                {errorMsg && (
                  <div className="flex items-center gap-2 bg-warn/10 border border-warn/30 text-warn text-xs px-4 py-3 rounded-lg max-w-2xl">
                    <ShieldAlert size={14} />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div className={classNames("grid gap-6", isAdmin ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1")}>
                  {/* 1. 실거래 수집 설정 */}
                  {isAdmin && (
                    <div className="space-y-4 p-4 rounded-xl border border-normal bg-normal/30 flex flex-col justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-strong border-b border-normal pb-2 flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-neutral shrink-0" />
                          공공데이터 실거래 수집 API
                        </h3>
                        <p className="text-[11px] text-neutral mt-1">국토교통부 아파트 실거래 데이터 수집 및 동기화에 필요한 최상위 수집 키입니다.</p>
                        
                        <div className="flex flex-col gap-1.5 mt-4">
                          <label className="text-xs font-semibold text-neutral">공공데이터 실거래 API 키 (data.go.kr Key)</label>
                          <input
                            type="password"
                            value={dataGoKrApiKey}
                            onChange={(e) => setDataGoKrApiKey(e.target.value)}
                            placeholder="공공데이터포털 실거래 API 인증키 입력"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-assistive mt-4 border-t border-normal/50 pt-2">
                        * <a href="https://www.data.go.kr/" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">공공데이터포털</a> 회원가입 후 '국토교통부 아파트실거래가 정보 조회 서비스'를 신청하여 활용 가능한 일반 인증키(Encoding/Decoding)를 복사해 붙여넣습니다.
                      </p>
                    </div>
                  )}

                  {/* 2. 텔레그램 설정 */}
                  <div className="space-y-4 p-4 rounded-xl border border-normal bg-normal/30 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-strong border-b border-normal pb-2 flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1.5">📬 텔레그램 알림 채널 (개인 설정)</span>
                        <button
                          type="button"
                          onClick={() => setIsTelegramGuideOpen(true)}
                          className="text-[10px] text-primary hover:underline font-semibold flex items-center gap-1 bg-primary/10 px-2 py-0.5 rounded"
                        >
                          <HelpCircle size={12} />
                          <span>설정 가이드</span>
                        </button>
                      </h3>
                      <p className="text-[11px] text-neutral mt-1">아파트 실거래가 기준 조건 충족 시 실시간 텔레그램 메신저 알림을 전달하는 키입니다.</p>
                      
                      <div className="flex flex-col gap-1.5 mt-4">
                        <label className="text-xs font-semibold text-neutral">텔레그램 봇 토큰 (Bot Token)</label>
                        <input
                          type="password"
                          value={telegramBotToken}
                          onChange={(e) => setTelegramBotToken(e.target.value)}
                          placeholder="텔레그램 봇 API 토큰 입력"
                          className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5 mt-3">
                        <label className="text-xs font-semibold text-neutral">텔레그램 대화방 ID (Chat ID)</label>
                        <input
                          type="text"
                          value={telegramChatId}
                          onChange={(e) => setTelegramChatId(e.target.value)}
                          placeholder="알림을 수신할 Chat ID 입력 (예: -100...)"
                          className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-assistive mt-4 border-t border-normal/50 pt-2">
                      * <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">@BotFather</a>를 통해 봇을 생성하고 토큰을 획득합니다. 대화방 ID는 수신 그룹/채널에 봇을 참여시킨 뒤 <a href="https://t.me/getidsbot" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">@getidsbot</a> 등을 호출해 확인합니다.
                    </p>
                  </div>

                  {/* 2-2. Gemini API 설정 */}
                  <div className="space-y-4 p-4 rounded-xl border border-normal bg-normal/30 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-strong border-b border-normal pb-2 flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1.5">💡 Gemini API 설정 (개인 설정)</span>
                      </h3>
                      <p className="text-[11px] text-neutral mt-1">AI 인사이트 리포트 생성에 사용되는 개인 Gemini API 인증키입니다. 미설정 시 기본 시스템 API 키를 사용합니다.</p>
                      
                      <div className="flex flex-col gap-1.5 mt-4">
                        <label className="text-xs font-semibold text-neutral">Gemini API 키 (Gemini API Key)</label>
                        <input
                          type="password"
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder="Google Gemini API Key 입력"
                          className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-assistive mt-4 border-t border-normal/50 pt-2">
                      * <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">Google AI Studio</a>에서 API 키를 발급받을 수 있습니다.
                    </p>
                  </div>

                  {/* 3. 주소 및 지도 검색 설정 */}
                  {isAdmin && (
                    <div className="space-y-4 p-4 rounded-xl border border-normal bg-normal/30 flex flex-col justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-strong border-b border-normal pb-2 flex items-center gap-1.5">
                          🗺️ 지도 및 주소 검색 API
                        </h3>
                        <p className="text-[11px] text-neutral mt-1">지역/단지명 검색과 웹 지도 렌더링에 사용되는 다양한 플랫폼 API 키들입니다.</p>

                        <div className="flex flex-col gap-1.5 mt-4">
                          <label className="text-xs font-semibold text-neutral">카카오 REST API 키 (Kakao REST API Key)</label>
                          <input
                            type="password"
                            value={kakaoRestApiKey}
                            onChange={(e) => setKakaoRestApiKey(e.target.value)}
                            placeholder="카카오 REST API 키 입력 (주소 검색용)"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 mt-3">
                          <label className="text-xs font-semibold text-neutral">카카오 JavaScript 키 (Kakao JS Key)</label>
                          <input
                            type="password"
                            value={kakaoJavascriptKey}
                            onChange={(e) => setKakaoJavascriptKey(e.target.value)}
                            placeholder="카카오 JavaScript 키 입력 (지도 로드용)"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 mt-3">
                          <label className="text-xs font-semibold text-neutral">카카오 네이티브 앱 키 (Kakao Native Key)</label>
                          <input
                            type="password"
                            value={kakaoNativeAppKey}
                            onChange={(e) => setKakaoNativeAppKey(e.target.value)}
                            placeholder="카카오 네이티브 앱 키 입력 (앱 연동용)"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 mt-3">
                          <label className="text-xs font-semibold text-neutral">도로명주소 검색 API 키 (Juso Key - juso.go.kr)</label>
                          <input
                            type="password"
                            value={jusoConfmKey}
                            onChange={(e) => setJusoConfmKey(e.target.value)}
                            placeholder="행정안전부 도로명주소 승인 키 입력"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-assistive mt-4 border-t border-normal/50 pt-2">
                        * 각 키는 <a href="https://developers.kakao.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">카카오 디벨로퍼스</a>와 <a href="https://business.juso.go.kr/" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">행안부 도로명주소 개발자센터</a>에서 각각 애플리케이션 등록 후 발급받을 수 있습니다.
                      </p>
                    </div>
                  )}

                  {/* 4. Google OAuth 로그인 설정 */}
                  {isAdmin && (
                    <div className="space-y-4 p-4 rounded-xl border border-normal bg-normal/30 flex flex-col justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-strong border-b border-normal pb-2 flex items-center gap-1.5">
                          🔐 Google OAuth 로그인 설정
                        </h3>
                        <p className="text-[11px] text-neutral mt-1">대시보드 보안 접근을 위한 Google OAuth 2.0 연동 설정입니다.</p>

                        <div className="flex flex-col gap-1.5 mt-4">
                          <label className="text-xs font-semibold text-neutral">Google Client ID</label>
                          <input
                            type="text"
                            value={googleClientId}
                            onChange={(e) => setGoogleClientId(e.target.value)}
                            placeholder="구글 클라우드 콘솔 Client ID 입력"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 mt-3">
                          <label className="text-xs font-semibold text-neutral">Google Client Secret</label>
                          <input
                            type="password"
                            value={googleClientSecret}
                            onChange={(e) => setGoogleClientSecret(e.target.value)}
                            placeholder="구글 클라우드 콘솔 Client Secret 입력"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 mt-3">
                          <label className="text-xs font-semibold text-neutral">Google Redirect URI</label>
                          <input
                            type="text"
                            value={googleRedirectUri}
                            onChange={(e) => setGoogleRedirectUri(e.target.value)}
                            placeholder="예: http://localhost:4174/api/auth/google/callback"
                            className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong placeholder-assistive focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-assistive mt-4 border-t border-normal/50 pt-2">
                        * <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline font-semibold">Google Cloud Console</a> API 및 서비스 &gt; 사용자 인증 정보에서 OAuth 2.0 클라이언트 ID를 생성한 후 관련 정보를 설정합니다.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2 max-w-full">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-primary hover:bg-primary/80 text-white text-xs font-bold rounded-lg shadow-lg shadow-primary/20 transition disabled:opacity-50"
                  >
                    <Save size={14} />
                    <span>{saving ? "저장 중..." : "설정 저장"}</span>
                  </button>
                </div>
              </form>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "display" && (
        <div className="space-y-6">
          {/* Font selection */}
          <SectionCard title="글꼴 설정">
            <div className="space-y-4">
              <p className="text-xs text-neutral">대시보드 전체에서 사용할 기본 폰트 패밀리를 선택합니다.</p>
              <div className="flex gap-6">
                {DISPLAY_FONT_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-strong">
                    <input
                      type="radio"
                      name="fontFamily"
                      checked={pref.fontFamily === opt.value}
                      onChange={() => handlePrefChange({ fontFamily: opt.value })}
                      className="accent-primary h-4 w-4"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* Font Size slider */}
          <SectionCard title="글자 크기">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-xs text-neutral">대시보드 전체의 텍스트 크기를 일괄 조절합니다. (12px ~ 22px)</p>
                <span className="text-xs font-bold text-primary font-mono">{pref.fontSizePx}px</span>
              </div>
              <div className="flex items-center gap-4 bg-slate-100/50 dark:bg-slate-900/50 p-4 rounded-xl border border-normal">
                <span className="text-xs text-neutral font-mono">12px</span>
                <input
                  type="range"
                  min="12"
                  max="22"
                  value={pref.fontSizePx}
                  onChange={(e) => handlePrefChange({ fontSizePx: parseInt(e.target.value, 10) })}
                  className="flex-1 accent-primary h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-xs text-neutral font-mono">22px</span>
              </div>
            </div>
          </SectionCard>

          {/* Accent Color selection */}
          <SectionCard title="테마 색상 (Accent Color)">
            <div className="space-y-4">
              <p className="text-xs text-neutral">대시보드의 주요 버튼, 아이콘 및 강조 텍스트에 쓰일 브랜드 주조색을 선택합니다.</p>
              <div className="flex flex-wrap gap-4">
                {DISPLAY_ACCENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePrefChange({ accentColor: opt.value })}
                    className={classNames(
                      "flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all text-xs font-semibold",
                      pref.accentColor === opt.value
                        ? "border-primary bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400 font-bold shadow-sm shadow-primary/10"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    )}
                  >
                    <span className="h-4 w-4 rounded-full shrink-0 shadow-inner" style={{ backgroundColor: opt.swatch }} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* Reset button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                const next = resetDisplayPreferences();
                setPref(next);
              }}
              className="px-5 py-2.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold text-strong transition-colors"
            >
              기본 설정으로 재설정
            </button>
          </div>
        </div>
      )}
      <TelegramGuideModal
        isOpen={isTelegramGuideOpen}
        onClose={() => setIsTelegramGuideOpen(false)}
        locale={locale}
      />
    </div>
  );
}

