import { useEffect, useState } from "react";
import { loadDashboard, checkAuth, logout, logActivity } from "./api";
import { Layout, type View } from "./components/Layout";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { RulesPage } from "./pages/Rules";
import { SettingsPage } from "./pages/Settings";
import GraphDashboard from "./pages/GraphDashboard";
import ComplexAnalysisPage from "./pages/ComplexAnalysisPage";
import NearbyStationTab from "./pages/graph/NearbyStationTab";
import { DatabaseAdminPage } from "./pages/DatabaseAdmin";
import { CollectPage } from "./pages/Collect";
import { AllowedAccountsPage } from "./pages/AllowedAccountsPage";
import { ActivityLogPage } from "./pages/ActivityLog";
import { TempPasswordResetModal } from "./components/TempPasswordResetModal";
import type { DashboardState } from "./types";

function App() {
  const [auth, setAuth] = useState<{ isAuthenticated: boolean; email?: string; isAdmin?: boolean; isTemporaryPassword?: boolean } | null>(null);
  const [state, setState] = useState<DashboardState | undefined>();
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view") as View;
    const validViews: View[] = [
      "dashboard",
      "rules",
      "settings",
      "analytics",
      "complexAnalysis",
      "dbAdmin",
      "collect",
      "nearby",
      "allowedAccounts",
      "activityLog"
    ];
    return validViews.includes(viewParam) ? viewParam : "dashboard";
  });
  const [rulesInitData, setRulesInitData] = useState<{ regionName: string; regionCode?: string; apartmentKeywords: string[] } | null>(null);
  const [complexAnalysisInitData, setComplexAnalysisInitData] = useState<{ complexName: string; lawdCode?: string } | null>(null);
  const [drilldownFromOverview, setDrilldownFromOverview] = useState(false);
  
  // 뒤로가기 / 앞으로가기 (popstate) 이벤트 감지 및 처리
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && typeof event.state === "object" && "view" in event.state) {
        setView(event.state.view as View);
      } else {
        const params = new URLSearchParams(window.location.search);
        const viewParam = params.get("view") as View;
        const validViews: View[] = [
          "dashboard", "rules", "settings", "analytics", 
          "complexAnalysis", "dbAdmin", "collect", "nearby", "allowedAccounts", "activityLog"
        ];
        if (validViews.includes(viewParam)) {
          setView(viewParam);
        } else {
          setView("dashboard");
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // view 상태 변경 시 브라우저 히스토리(history state) 동기화
  useEffect(() => {
    if (auth?.isAuthenticated) {
      const currentState = window.history.state;
      const url = `?view=${view}`;
      
      if (!currentState) {
        window.history.replaceState({ view }, "", url);
      } else if (currentState.view !== view) {
        window.history.pushState({ view }, "", url);
      }
    }
  }, [view, auth?.isAuthenticated]);

  const adminViews: View[] = ["collect", "activityLog", "dbAdmin", "allowedAccounts"];
  useEffect(() => {
    if (auth?.isAuthenticated && !auth.isAdmin && adminViews.includes(view)) {
      setView("dashboard");
    }
  }, [view, auth]);

  async function refresh() {
    setError("");
    try {
      setState(await loadDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "대시보드를 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    async function initAuth() {
      try {
        const res = await checkAuth();
        setAuth(res);
        if (res.isAuthenticated) {
          void refresh();
        }
      } catch {
        setAuth({ isAuthenticated: false });
      }
    }
    void initAuth();
  }, []);

  useEffect(() => {
    if (auth?.isAuthenticated && view) {
      const viewNames: Record<View, string> = {
        dashboard: "대시보드",
        rules: "알림 규칙",
        settings: "환경 설정",
        analytics: "종합 현황",
        complexAnalysis: "단지 분석",
        dbAdmin: "데이터베이스 관리",
        collect: "수집 현황",
        nearby: "역세권 분석",
        allowedAccounts: "계정 관리",
        activityLog: "활동 로그"
      };
      const name = viewNames[view] || view;
      void logActivity("page_view", `${name} 페이지 조회`, { view });
    }
  }, [view, auth?.isAuthenticated]);

  const handleLogout = async () => {
    try {
      await logout();
      setAuth({ isAuthenticated: false });
      setView("dashboard");
      window.history.pushState({}, "", "/");
    } catch (err) {
      console.error("로그아웃 실패:", err);
    }
  };

  const handleNavigateToRules = (initData: { regionName: string; regionCode?: string; apartmentKeywords: string[] }) => {
    setRulesInitData(initData);
    setView("rules");
  };

  /** 종합 현황 차트에서 단지 클릭 → 단지 분석 페이지로 드릴다운 */
  const handleSelectComplex = (complexName: string, lawdCode?: string) => {
    setComplexAnalysisInitData({ complexName, lawdCode });
    setDrilldownFromOverview(true);
    setView("complexAnalysis");
  };

  if (auth === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-alternative text-neutral">
        <span className="text-sm font-medium">인증 상태를 확인하는 중...</span>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return <LoginPage />;
  }

  if (auth.isTemporaryPassword && auth.email) {
    return (
      <TempPasswordResetModal
        email={auth.email}
        onResetSuccess={() => {
          setAuth((prev) => (prev ? { ...prev, isTemporaryPassword: false } : null));
          void refresh();
        }}
      />
    );
  }

  return (
    <Layout view={view} onNavigate={setView} onLogout={handleLogout} isAdmin={auth?.isAdmin} userEmail={auth?.email}>
      {error && <p className="mb-4 text-sm text-red-500 font-medium">{error}</p>}
      {view === "dashboard" && <DashboardPage state={state} onChanged={() => void refresh()} onNavigate={setView} isAdmin={auth?.isAdmin} />}
      {view === "rules" && (
        <RulesPage
          state={state}
          onChanged={() => void refresh()}
          initData={rulesInitData}
          clearInitData={() => setRulesInitData(null)}
          onNavigate={setView}
          isAdmin={auth?.isAdmin}
        />
      )}
      {view === "analytics" && (
        <GraphDashboard
          onNavigateToRules={handleNavigateToRules}
          onSelectComplex={handleSelectComplex}
          config={state?.config}
        />
      )}
      {view === "complexAnalysis" && (
        <ComplexAnalysisPage
          onNavigateToRules={handleNavigateToRules}
          initData={complexAnalysisInitData}
          clearInitData={() => setComplexAnalysisInitData(null)}
          onBackToOverview={drilldownFromOverview ? () => {
            setDrilldownFromOverview(false);
            setView("analytics");
          } : undefined}
        />
      )}
      {view === "nearby" && (
        <NearbyStationTab
          onSelectComplex={(complexName, lawdCode) => {
            setComplexAnalysisInitData({ complexName, lawdCode });
            setDrilldownFromOverview(false);
            setView("complexAnalysis");
          }}
          onNavigateToRules={handleNavigateToRules}
        />
      )}
      {view === "collect" && <CollectPage />}
      {view === "activityLog" && <ActivityLogPage />}
      {view === "dbAdmin" && <DatabaseAdminPage />}
      {view === "allowedAccounts" && <AllowedAccountsPage onChanged={() => void refresh()} currentUserEmail={auth?.email} />}
      {view === "settings" && <SettingsPage state={state} onChanged={() => void refresh()} isAdmin={auth?.isAdmin} userEmail={auth?.email} />}
    </Layout>
  );
}

export default App;
