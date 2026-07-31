import React, { useEffect, useMemo, useState, useRef } from "react";
import { useBreakpoint } from "../useBreakpoint";
import { loadAdminDbTables, executeAdminDbQuery, searchComplexNames, clearDatabase, deleteDbRegion, deleteDbComplex, loadGeocodeStats, triggerGeocodeBatch, updateComplexCoords, resetComplexCoords, loadGeocodePending } from "../api";
import { SectionCard } from "../components/SectionCard";
import { Play, Database, RefreshCw, AlertCircle, CheckCircle2, ChevronRight, FileText, Settings, Building2, MapPin } from "lucide-react";
import { copy } from "../locales/ko";
import { RegionSearchInput } from "../components/RegionSearchInput";
import { classNames } from "../lib/format";
import type { RegionSearchResult } from "../types";
import { CoordPickerMap } from "../components/CoordPickerMap";

const locale = "ko";
const t = copy[locale];

type SchemaInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
};

type QueryResult = {
  type: "select" | "write";
  rows?: Record<string, any>[];
  changes?: number;
  lastInsertRowid?: number | string;
};

export function DatabaseAdminPage() {
  const { isMobile } = useBreakpoint();
  const [tables, setTables] = useState<string[]>([]);

  // 탭 상태 정의 (URL 쿼리 파라미터 tab과 연동)
  const [activeTab, setActiveTab] = useState<"sql" | "geocode" | "manage">(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam === "sql" || tabParam === "geocode" || tabParam === "manage") {
      return tabParam;
    }
    return "sql";
  });

  // 탭 변경 시 URL 파라미터 동기화
  const handleTabChange = (tab: "sql" | "geocode" | "manage") => {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(window.history.state, "", newUrl);
  };

  // 브라우저 뒤로가기 / 앞으로가기 시 탭 싱크
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam === "sql" || tabParam === "geocode" || tabParam === "manage") {
        setActiveTab(tabParam);
      } else {
        setActiveTab("sql");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Geocoding 통계 상태
  const [geocodeStats, setGeocodeStats] = useState<{
    total: number;
    geocoded: number;
    pending: number;
  } | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResult, setBatchResult] = useState<{ total: number; success: number; failed: number } | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    processed: number;
    total: number;
    success: number;
    failed: number;
    failures: { name: string; query: string; reason: string }[];
    isPaused?: boolean;
  } | null>(null);
  const [shouldStopBatch, setShouldStopBatch] = useState(false);
  const shouldStopRef = useRef(false);

  // 위경도 좌표가 없는 단지 리스트 상태
  const [pendingComplexes, setPendingComplexes] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  // Geocoding 통계 조회
  const fetchGeocodeStats = async () => {
    try {
      const stats = await loadGeocodeStats();
      setGeocodeStats(stats);
    } catch (err) {
      console.error("Failed to load geocode stats", err);
    }
  };

  // 위경도 좌표가 없는 단지 리스트 조회
  const fetchPendingComplexes = async () => {
    setLoadingPending(true);
    try {
      const list = await loadGeocodePending();
      setPendingComplexes(list);
    } catch (err) {
      console.error("Failed to load geocode pending complexes", err);
    } finally {
      setLoadingPending(false);
    }
  };

  useEffect(() => {
    fetchGeocodeStats();
    fetchPendingComplexes();
  }, []);

  const geocodePercentage = useMemo(() => {
    if (!geocodeStats || geocodeStats.total === 0) return 0;
    return Math.round((geocodeStats.geocoded / geocodeStats.total) * 100);
  }, [geocodeStats]);

  // 일괄 Geocoding 실행 (루프 방식)
  const handleGeocodeBatch = async () => {
    if (batchLoading) return;

    let currentPending = 0;
    try {
      const stats = await loadGeocodeStats();
      setGeocodeStats(stats);
      currentPending = stats.pending;
    } catch (err) {
      console.error("Failed to load geocode stats before batch", err);
      return;
    }

    if (currentPending === 0) {
      alert("수집할 미확보 단지가 없습니다.");
      return;
    }

    const totalToProcess = currentPending; // 모든 대기 항목 처리
    setBatchLoading(true);
    shouldStopRef.current = false;
    setShouldStopBatch(false);
    setBatchResult(null);

    const progressState = {
      processed: 0,
      total: totalToProcess,
      success: 0,
      failed: 0,
      failures: [] as { name: string; query: string; reason: string }[],
      isPaused: false
    };
    setBatchProgress(progressState);

    for (let i = 0; i < totalToProcess; i++) {
      if (shouldStopRef.current) {
        break;
      }

      try {
        const res = await triggerGeocodeBatch(undefined, 1);
        
        progressState.processed += 1;
        progressState.success += res.success;
        progressState.failed += res.failed;
        if (res.failedDetails && res.failedDetails.length > 0) {
          progressState.failures.push(...res.failedDetails);
        }

        setBatchProgress({ ...progressState });

        // 실시간으로 통계 상태도 갱신하여 바 차트 등에 반영
        setGeocodeStats(prev => {
          if (!prev) return null;
          return {
            ...prev,
            geocoded: prev.geocoded + res.success,
            pending: prev.pending - res.success
          };
        });
      } catch (err: any) {
        console.error("Geocoding step failed:", err);
        progressState.processed += 1;
        progressState.failed += 1;
        progressState.failures.push({
          name: `단지 ${i + 1}`,
          query: "N/A",
          reason: err.message || "네트워크 통신 오류",
        });
        setBatchProgress({ ...progressState });
      }

      if ((i + 1) % 30 === 0 && i < totalToProcess - 1) {
        setBatchProgress(prev => prev ? { ...prev, isPaused: true } : null);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        setBatchProgress(prev => prev ? { ...prev, isPaused: false } : null);
      } else if (totalToProcess > 1 && i < totalToProcess - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    setBatchLoading(false);
    setBatchResult({
      total: progressState.processed,
      success: progressState.success,
      failed: progressState.failed
    });

    await fetchGeocodeStats();
    await fetchPendingComplexes();
  };

  const handleStopBatch = () => {
    shouldStopRef.current = true;
    setShouldStopBatch(true);
  };
  const [schemas, setSchemas] = useState<Record<string, SchemaInfo[]>>({});
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [loadingSchema, setLoadingSchema] = useState(false);

  // DB 관리 도구 상태
  const [deleteRegion, setDeleteRegion] = useState<RegionSearchResult | null>(null);
  const [deleteRegionName, setDeleteRegionName] = useState("");

  const [complexQuery, setComplexQuery] = useState("");
  const [showComplexDropdown, setShowComplexDropdown] = useState(false);
  const [activeAptIndex, setActiveAptIndex] = useState(-1);
  const [apartments, setApartments] = useState<string[]>([]);
  const [searchingComplexes, setSearchingComplexes] = useState(false);

  const filteredApartments = useMemo(() => {
    const q = complexQuery.trim().toLowerCase();
    if (!q) return apartments;
    return apartments.filter((apt) => apt.toLowerCase().includes(q));
  }, [apartments, complexQuery]);

  // 단지명 디바운스 실시간 검색
  useEffect(() => {
    const q = complexQuery.trim();
    if (q.length === 1) {
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingComplexes(true);
      try {
        const found = await searchComplexNames(q);
        setApartments(found.map((item) => item.name));
      } catch (err) {
        console.error("Failed to search complexes:", err);
        setApartments([]);
      } finally {
        setSearchingComplexes(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [complexQuery]);

  async function handleDeleteRegion() {
    if (!deleteRegion) return;
    if (!confirm(`정말로 '${deleteRegion.displayName}' 지역의 모든 실거래 및 단지 데이터를 지우시겠습니까?`)) return;

    try {
      await deleteDbRegion(deleteRegion.lawdCode);
      alert("해당 지역의 실거래 및 단지 정보가 성공적으로 삭제되었습니다.");
      setDeleteRegion(null);
      setDeleteRegionName("");
      void loadSchemaData();
    } catch (err: any) {
      alert(`삭제 실패: ${err.message || "오류가 발생했습니다."}`);
    }
  }

  async function handleDeleteComplex() {
    const name = complexQuery.trim();
    if (!name) return;
    if (!confirm(`정말로 '${name}' 아파트 단지의 모든 실거래 데이터를 지우시겠습니까?`)) return;

    try {
      await deleteDbComplex(name);
      alert("해당 아파트 단지의 실거래 정보가 성공적으로 삭제되었습니다.");
      setComplexQuery("");
      void loadSchemaData();
    } catch (err: any) {
      alert(`삭제 실패: ${err.message || "오류가 발생했습니다."}`);
    }
  }

  async function handleClearDb() {
    if (!confirm("⚠️ 정말로 데이터베이스의 모든 실거래, 단지, 지역 데이터를 지우고 전체 초기화하시겠습니까? 이 작업은 절대 되돌릴 수 없습니다.")) return;

    try {
      await clearDatabase();
      alert("데이터베이스 전체 초기화가 완료되었습니다.");
      setDeleteRegion(null);
      setDeleteRegionName("");
      setComplexQuery("");
      void loadSchemaData();
    } catch (err: any) {
      alert(`초기화 실패: ${err.message || "오류가 발생했습니다."}`);
    }
  }

  // 좌표 수동 관리 상태
  const [coordsQuery, setCoordsQuery] = useState("");
  const [showCoordsDropdown, setShowCoordsDropdown] = useState(false);
  const [activeCoordsIndex, setActiveCoordsIndex] = useState(-1);
  const [coordsApartments, setCoordsApartments] = useState<any[]>([]);
  const [searchingCoords, setSearchingCoords] = useState(false);

  const [selectedComplex, setSelectedComplex] = useState<any | null>(null);
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [coordsUpdating, setCoordsUpdating] = useState(false);

  // 좌표 수동 관리 단지 검색 디바운스
  useEffect(() => {
    const q = coordsQuery.trim();
    if (q.length === 0) {
      setCoordsApartments([]);
      return;
    }
    if (q.length === 1) {
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingCoords(true);
      try {
        const found = await searchComplexNames(q);
        setCoordsApartments(found);
      } catch (err) {
        console.error("Failed to search complexes for coords:", err);
        setCoordsApartments([]);
      } finally {
        setSearchingCoords(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [coordsQuery]);

  const handleSelectCoordsComplex = (complex: any) => {
    setSelectedComplex(complex);
    setCoordsQuery(complex.name);
    setEditLat(complex.lat !== null && complex.lat !== undefined ? String(complex.lat) : "");
    setEditLng(complex.lng !== null && complex.lng !== undefined ? String(complex.lng) : "");
    setShowCoordsDropdown(false);
  };

  const handleUpdateCoords = async () => {
    if (!selectedComplex) return;
    if (!selectedComplex.id) {
      alert("선택된 단지의 식별자(ID)가 누락되었습니다. 단지를 다시 검색하여 선택해 주세요.");
      return;
    }
    const latNum = parseFloat(editLat);
    const lngNum = parseFloat(editLng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      alert("위도와 경도는 올바른 숫자여야 합니다.");
      return;
    }

    setCoordsUpdating(true);
    try {
      await updateComplexCoords(selectedComplex.id, latNum, lngNum);
      alert(`'${selectedComplex.name}' 단지의 좌표가 성공적으로 수정되었습니다.`);
      setSelectedComplex({ ...selectedComplex, lat: latNum, lng: lngNum });
      void fetchGeocodeStats();
      void fetchPendingComplexes();
    } catch (err: any) {
      alert(`좌표 수정 실패: ${err.message || "오류가 발생했습니다."}`);
    } finally {
      setCoordsUpdating(false);
    }
  };

  const handleResetCoords = async () => {
    if (!selectedComplex) return;
    if (!selectedComplex.id) {
      alert("선택된 단지의 식별자(ID)가 누락되었습니다. 단지를 다시 검색하여 선택해 주세요.");
      return;
    }
    if (!confirm(`'${selectedComplex.name}' 단지의 좌표를 초기화하고 다시 Geocoding 하도록 설정하시겠습니까?`)) return;

    setCoordsUpdating(true);
    try {
      await resetComplexCoords(selectedComplex.id);
      alert(`'${selectedComplex.name}' 단지의 좌표가 초기화되었습니다. 다음 수집 또는 일괄 Geocoding 시 좌표를 새로 갱신합니다.`);
      setSelectedComplex({ ...selectedComplex, lat: null, lng: null });
      setEditLat("");
      setEditLng("");
      void fetchGeocodeStats();
      void fetchPendingComplexes();
    } catch (err: any) {
      alert(`좌표 초기화 실패: ${err.message || "오류가 발생했습니다."}`);
    } finally {
      setCoordsUpdating(false);
    }
  };

  const [sql, setSql] = useState<string>("SELECT * FROM transactions LIMIT 20;");
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string>("");

  async function loadSchemaData() {
    setLoadingSchema(true);
    try {
      const data = await loadAdminDbTables();
      setTables(data.tables);
      setSchemas(data.schemas);
      if (data.tables.length > 0 && !selectedTable) {
        setSelectedTable(data.tables[0]);
      }
    } catch (err: any) {
      console.error("Failed to load schema", err);
    } finally {
      setLoadingSchema(false);
    }
  }

  useEffect(() => {
    void loadSchemaData();
  }, []);

  async function handleExecute() {
    if (!sql.trim()) return;
    setExecuting(true);
    setQueryError("");
    setQueryResult(null);
    try {
      const res = await executeAdminDbQuery(sql);
      setQueryResult(res);
      // 쓰기 작업이 일어났을 가능성이 있으므로 스키마 데이터를 가볍게 새로고침합니다.
      void loadSchemaData();
    } catch (err: any) {
      setQueryError(err.message || "쿼리 실행 중 알 수 없는 에러가 발생했습니다.");
    } finally {
      setExecuting(false);
    }
  }

  function injectTemplate(query: string) {
    setSql(query);
  }

  // 결과 그리드의 헤더 추출
  const resultHeaders = queryResult?.rows && queryResult.rows.length > 0
    ? Object.keys(queryResult.rows[0])
    : [];

  return (
    <div className="space-y-6">
      {!isMobile && (
        <header className="flex flex-col gap-1">
          <h2 className="text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
            <Database className="text-primary h-6 w-6" />
            {t.dbAdminTitle}
          </h2>
          <p className="text-sm text-neutral">{t.dbAdminSubtitle}</p>
        </header>
      )}

      {/* 2-mode 반응형 탭 스트립 */}
      {isMobile ? (
        <div className="overflow-x-auto scrollbar-none snap-x snap-mandatory flex flex-nowrap gap-2 pb-1 border-b border-normal/50">
          <button
            type="button"
            onClick={() => handleTabChange("sql")}
            className={classNames(
              "snap-start shrink-0 px-4 py-2 text-xs font-bold transition-all whitespace-nowrap",
              activeTab === "sql"
                ? "bg-primary text-white rounded-full shadow-sm shadow-primary/20"
                : "text-neutral hover:text-strong hover:bg-alternative rounded-full"
            )}
          >
            {t.dbTabSql}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("geocode")}
            className={classNames(
              "snap-start shrink-0 px-4 py-2 text-xs font-bold transition-all whitespace-nowrap",
              activeTab === "geocode"
                ? "bg-primary text-white rounded-full shadow-sm shadow-primary/20"
                : "text-neutral hover:text-strong hover:bg-alternative rounded-full"
            )}
          >
            {t.dbTabGeocoding}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("manage")}
            className={classNames(
              "snap-start shrink-0 px-4 py-2 text-xs font-bold transition-all whitespace-nowrap",
              activeTab === "manage"
                ? "bg-primary text-white rounded-full shadow-sm shadow-primary/20"
                : "text-neutral hover:text-strong hover:bg-alternative rounded-full"
            )}
          >
            {t.dbTabManagement}
          </button>
        </div>
      ) : (
        <div className="border-b border-normal flex gap-6 text-sm">
          <button
            type="button"
            onClick={() => handleTabChange("sql")}
            className={classNames(
              "pb-3 px-1 border-b-2 transition-all font-bold",
              activeTab === "sql"
                ? "border-primary text-primary"
                : "border-transparent text-neutral hover:text-strong"
            )}
          >
            {t.dbTabSql}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("geocode")}
            className={classNames(
              "pb-3 px-1 border-b-2 transition-all font-bold",
              activeTab === "geocode"
                ? "border-primary text-primary"
                : "border-transparent text-neutral hover:text-strong"
            )}
          >
            {t.dbTabGeocoding}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("manage")}
            className={classNames(
              "pb-3 px-1 border-b-2 transition-all font-bold",
              activeTab === "manage"
                ? "border-primary text-primary"
                : "border-transparent text-neutral hover:text-strong"
            )}
          >
            {t.dbTabManagement}
          </button>
        </div>
      )}

      {/* 탭 1: SQL 탐색기 */}
      {activeTab === "sql" && (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* 좌측: 스키마 브라우저 */}
          <div className="space-y-6">
            <SectionCard
              title={t.tablesList}
              right={
                <button
                  type="button"
                  onClick={() => void loadSchemaData()}
                  disabled={loadingSchema}
                  className="p-1.5 text-neutral hover:text-strong hover:bg-alternative rounded-lg transition-colors"
                  title="새로고침"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingSchema ? "animate-spin" : ""}`} />
                </button>
              }
            >
              {tables.length === 0 ? (
                <p className="text-sm text-neutral text-center py-4">테이블이 존재하지 않습니다.</p>
              ) : (
                <div className="space-y-4">
                  {/* 테이블 선택 셀렉트 (모바일 대응) */}
                  <div className="lg:hidden">
                    <select
                      value={selectedTable}
                      onChange={(e) => setSelectedTable(e.target.value)}
                      className="w-full h-10 rounded-lg border border-normal bg-normal px-3 text-sm font-semibold text-strong outline-none"
                    >
                      {tables.map((tName) => (
                        <option key={tName} value={tName}>
                          {tName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 테이블 리스트 (데스크톱 대응 - 종 스크롤 고정 높이 적용) */}
                  <div className="hidden lg:block max-h-[260px] overflow-y-auto space-y-1 pr-1 border border-normal/20 rounded-lg p-1 bg-alternative/30">
                    {tables.map((tName) => (
                      <button
                        key={tName}
                        type="button"
                        onClick={() => setSelectedTable(tName)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-lg transition-colors ${
                          selectedTable === tName
                            ? "bg-primary/10 text-primary"
                            : "text-neutral hover:bg-alternative hover:text-strong"
                        }`}
                      >
                        <Database className="h-4 w-4 shrink-0" />
                        <span>{tName}</span>
                      </button>
                    ))}
                  </div>

                  {/* 선택한 테이블 스키마 상세 정보 */}
                  {selectedTable && schemas[selectedTable] && (
                    <div className="border-t border-normal/50 pt-3 space-y-2">
                      <p className="text-[11px] font-bold text-assistive tracking-wide uppercase">{t.schemaInfo}: {selectedTable}</p>
                      <div className="overflow-x-auto max-h-[220px] overflow-y-auto border border-normal rounded-lg bg-alternative/10">
                        <table className="w-full text-[11px] leading-normal">
                          <thead>
                            <tr className="bg-alternative/60 border-b border-normal text-left text-neutral">
                              <th className="px-2.5 py-1.5 font-bold">컬럼명</th>
                              <th className="px-2.5 py-1.5 font-bold">타입</th>
                              <th className="px-2.5 py-1.5 font-bold text-center">PK</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schemas[selectedTable].map((col) => (
                              <tr key={col.cid} className="border-b border-normal/30 last:border-b-0 hover:bg-alternative/30">
                                <td className="px-2.5 py-1.5 font-semibold text-strong">{col.name}</td>
                                <td className="px-2.5 py-1.5 text-neutral">{col.type}</td>
                                <td className="px-2.5 py-1.5 text-center font-bold text-primary">{col.pk ? "✓" : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </div>

          {/* 우측: SQL 콘솔 & 실행 결과 */}
          <div className="space-y-6">
            <SectionCard
              title="SQL 콘솔"
              right={
                <div className="flex flex-wrap gap-1 sm:gap-1.5 justify-end items-center">
                  <button
                    type="button"
                    onClick={() => injectTemplate("SELECT * FROM transactions LIMIT 20;")}
                    className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-alternative hover:bg-primary/10 hover:text-primary text-[9px] sm:text-[10px] font-bold text-strong transition-all border border-normal"
                    title="최근 실거래 20건을 조회하는 SQL 템플릿을 입력합니다."
                  >
                    {isMobile ? "실거래" : "최근 실거래"}
                  </button>
                  <button
                    type="button"
                    onClick={() => injectTemplate("SELECT * FROM regions LIMIT 20;")}
                    className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-alternative hover:bg-primary/10 hover:text-primary text-[9px] sm:text-[10px] font-bold text-strong transition-all border border-normal"
                    title="등록된 수집 지역 목록을 조회하는 SQL 템플릿을 입력합니다."
                  >
                    {isMobile ? "지역" : "등록 지역"}
                  </button>
                  <button
                    type="button"
                    onClick={() => injectTemplate("SELECT * FROM complexes LIMIT 20;")}
                    className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-alternative hover:bg-primary/10 hover:text-primary text-[9px] sm:text-[10px] font-bold text-strong transition-all border border-normal"
                    title="등록된 단지 목록을 조회하는 SQL 템플릿을 입력합니다."
                  >
                    {isMobile ? "단지" : "등록 단지"}
                  </button>
                </div>
              }
            >
              <div className="space-y-4">
                <div className="relative rounded-xl border border-normal bg-alternative/40 focus-within:border-primary overflow-hidden">
                  <textarea
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    placeholder={t.sqlPlaceholder}
                    rows={6}
                    className="w-full p-4 text-sm font-mono text-strong bg-transparent outline-none resize-y"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleExecute()}
                    disabled={executing || !sql.trim()}
                    className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-500/20 transition-all hover:opacity-90 disabled:opacity-50"
                  >
                    {executing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {t.execute}
                  </button>
                </div>
              </div>
            </SectionCard>

            {/* 에러 또는 결과 표출 */}
            {(queryError || queryResult) && (
              <SectionCard title={t.queryResult}>
                {queryError && (
                  <div className="flex gap-2 rounded-xl border border-red-200/50 bg-red-500/10 p-4 text-sm text-red-600">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-bold">SQL 에러</p>
                      <p className="mt-1 font-mono text-xs whitespace-pre-wrap">{queryError}</p>
                    </div>
                  </div>
                )}

                {queryResult && (
                  <div className="space-y-3">
                    {/* 쓰기(DML/DDL) 처리 성공 요약 */}
                    {queryResult.type === "write" && (
                      <div className="flex gap-2 rounded-xl border border-emerald-200/50 bg-emerald-500/10 p-4 text-sm text-emerald-600">
                        <CheckCircle2 className="h-5 w-5 shrink-0" />
                        <div>
                          <p className="font-bold">{t.querySuccess}</p>
                          <ul className="mt-1.5 space-y-1 text-xs">
                            <li>• {t.affectedRows}: <b>{queryResult.changes ?? 0}</b></li>
                            {queryResult.lastInsertRowid !== undefined && (
                              <li>• {t.lastInsertId}: <b>{queryResult.lastInsertRowid}</b></li>
                            )}
                          </ul>
                        </div>
                      </div>
                    )}

                    {/* SELECT 조회 성공 테이블 데이터 표출 */}
                    {queryResult.type === "select" && (
                      <div className="space-y-2">
                        <p className="text-xs text-neutral">
                          조회 완료: <b>{queryResult.rows?.length ?? 0}</b>{t.rowsCount}
                        </p>

                        {queryResult.rows && queryResult.rows.length > 0 ? (
                          <div className="overflow-x-auto border border-normal rounded-xl max-h-[500px]">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr className="bg-alternative border-b border-normal text-left text-neutral">
                                  {resultHeaders.map((header) => (
                                    <th key={header} className="px-4 py-3 font-bold whitespace-nowrap">
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {queryResult.rows.map((row, index) => (
                                  <tr key={index} className="border-b border-normal/30 last:border-b-0 hover:bg-alternative/40">
                                    {resultHeaders.map((header) => (
                                      <td key={header} className="px-4 py-2.5 font-medium text-strong whitespace-nowrap">
                                        {row[header] !== null && row[header] !== undefined
                                          ? String(row[header])
                                          : <span className="text-assistive font-normal">NULL</span>}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-center py-10 text-sm text-neutral bg-alternative/30 rounded-xl border border-dashed border-normal">
                            조회 결과(Rows)가 존재하지 않습니다.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        </div>
      )}

      {/* 탭 2: 위치/좌표 관리 */}
      {activeTab === "geocode" && (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          {/* Geocoding 좌표 캐싱 관리 */}
          <SectionCard
            title="Geocoding 좌표 캐싱 관리"
            right={<Settings size={15} className="text-neutral" />}
          >
            <div className="space-y-4">
              <p className="text-xs text-neutral">
                지하철역 주변 역세권 분석 속도 및 데이터 정확도 향상을 위해 로컬 DB에 등록된 아파트 단지 주소를 위도·경도 좌표로 일괄 변환(Geocoding) 및 캐싱합니다.
              </p>
              <div className="flex justify-between items-center text-xs font-bold border-t border-normal/50 pt-3">
                <span className="text-neutral">좌표 데이터 현황</span>
                <span className="text-strong">
                  {geocodeStats?.geocoded || 0} / {geocodeStats?.total || 0} 단지 ({geocodePercentage}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-alternative overflow-hidden border border-normal">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${geocodePercentage}%` }}
                />
              </div>

              {geocodeStats && geocodeStats.pending > 0 ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-neutral leading-relaxed">
                    현재 DB에 등록된 아파트 중 <strong>{geocodeStats.pending}개</strong> 단지의 위도·경도 좌표가 없습니다.
                    국토부 지번 주소 기반으로 카카오 Geocoding 일괄 수집을 실행할 수 있습니다.
                  </p>
                  {batchLoading ? (
                    <div className="flex gap-2">
                      <div className="flex-1 py-2.5 rounded-xl bg-emerald-600/20 text-emerald-600 font-bold flex items-center justify-center gap-2 border border-emerald-500/20 text-sm">
                        <RefreshCw size={15} className="animate-spin text-emerald-600 shrink-0" />
                        <span>
                          {batchProgress?.isPaused 
                            ? (t.geocodeBatchPausing || "수집 대기 중 (API 제한 방지)...") 
                            : `${t.geocodeCollecting || "수집 중"} (${batchProgress?.processed} / ${batchProgress?.total})`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleStopBatch}
                        disabled={shouldStopBatch}
                        className="px-4 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-red-500/20 disabled:opacity-50 text-sm shrink-0"
                      >
                        중단
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGeocodeBatch}
                      className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-500 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 text-sm"
                    >
                      <Play size={15} />
                      <span>좌표 미확보 단지 일괄 수집</span>
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-emerald-500 font-semibold flex items-center gap-1.5 py-2">
                  ✓ 모든 아파트 단지의 위도·경도 좌표가 확보되었습니다.
                </p>
              )}

              {batchProgress && (
                <div className="text-[11px] font-semibold text-neutral flex justify-between bg-alternative/40 p-2 rounded-lg border border-normal/50">
                  <span>진행 수치</span>
                  <span>
                    성공: <span className="text-emerald-500 font-bold">{batchProgress.success}</span> | 실패: <span className="text-red-500 font-bold">{batchProgress.failed}</span>
                  </span>
                </div>
              )}

              {batchProgress && batchProgress.failures.length > 0 && (
                <div className="border border-red-500/20 rounded-lg bg-red-500/5 p-3 space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold text-red-600">
                    <span>⚠️ 좌표 수집 실패 목록 ({batchProgress.failures.length}건)</span>
                  </div>
                  <div className="overflow-y-auto max-h-[140px] border border-normal rounded bg-elevated text-[10px]">
                    <table className="w-full text-left border-collapse border-spacing-0">
                      <thead>
                        <tr className="bg-alternative text-neutral border-b border-normal">
                          <th className="p-1.5 font-bold">단지명</th>
                          <th className="p-1.5 font-bold">검색 주소</th>
                          <th className="p-1.5 font-bold">실패 사유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchProgress.failures.map((fail, idx) => (
                          <tr key={idx} className="border-b border-normal/30 last:border-b-0 hover:bg-alternative/30">
                            <td className="p-1.5 font-semibold text-strong max-w-[120px] truncate" title={fail.name}>
                              {fail.name}
                            </td>
                            <td className="p-1.5 text-neutral truncate max-w-[150px]" title={fail.query}>
                              {fail.query}
                            </td>
                            <td className="p-1.5 text-red-500 max-w-[150px] truncate" title={fail.reason}>
                              {fail.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {batchResult && !batchLoading && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-600 font-bold space-y-1">
                  <p>✓ Geocoding 수집 배치 완료 {shouldStopBatch && "(사용자 요청으로 중단됨)"}</p>
                  <p>- 대상: {batchResult.total}건 / 성공: {batchResult.success}건 / 실패: {batchResult.failed}건</p>
                </div>
              )}
            </div>
          </SectionCard>

          {/* 단지 좌표 수동 관리 */}
          <SectionCard title="단지 좌표 수동 관리">
            <div className="space-y-4">
              <p className="text-xs text-neutral">
                Geocoding이 잘못되었거나 지도가 엉뚱한 위치를 가리키는 아파트 단지의 좌표를 수동으로 수정하거나 리셋할 수 있습니다.
              </p>

              {/* 위경도 좌표가 없는 단지 리스트 */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-strong flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                  {t.geocodePendingListTitle} ({pendingComplexes.length}건)
                </span>
                
                {pendingComplexes.length === 0 ? (
                  <p className="text-[11px] text-emerald-500 font-semibold bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-lg">
                    ✓ {t.noGeocodePendingComplexes}
                  </p>
                ) : (
                  <div className="overflow-y-auto max-h-[160px] border border-normal rounded-lg bg-alternative/20 p-1.5 space-y-1">
                    {pendingComplexes.map((complex) => (
                      <button
                        key={complex.id}
                        type="button"
                        onClick={() => handleSelectCoordsComplex(complex)}
                        className={classNames(
                          "w-full text-left p-2 rounded-md text-xs transition-colors flex flex-col gap-0.5 border",
                          selectedComplex?.id === complex.id
                            ? "bg-primary/10 border-primary text-primary font-bold shadow-sm"
                            : "bg-normal border-normal hover:bg-alternative/40 text-strong"
                        )}
                      >
                        <span className="font-bold flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-neutral" />
                          {complex.name}
                        </span>
                        <span className="text-[10px] text-neutral pl-4">
                          {complex.regionName || complex.lawdCode} {complex.dongName ? `· ${complex.dongName}` : ""} {complex.jibun ? ` ${complex.jibun}` : ""}
                        </span>
                        {complex.geocodeError && (
                          <span className="text-[9px] text-red-500 pl-4 font-normal italic">
                            Error: {complex.geocodeError}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 p-3 rounded-lg border border-normal bg-alternative/30">
                <span className="text-xs font-bold text-strong flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-neutral shrink-0" />
                  단지 검색 및 좌표 설정
                </span>
                <div className="relative flex gap-2 items-center mt-1">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      className="w-full h-[38px] rounded-lg border border-normal bg-normal pl-3 pr-8 text-xs font-semibold text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                      value={coordsQuery}
                      onChange={(e) => {
                        setCoordsQuery(e.target.value);
                        setShowCoordsDropdown(true);
                        if (selectedComplex && e.target.value !== selectedComplex.name) {
                          setSelectedComplex(null);
                        }
                      }}
                      onFocus={() => setShowCoordsDropdown(true)}
                      onBlur={() => {
                        setTimeout(() => {
                          setShowCoordsDropdown(false);
                          setActiveCoordsIndex(-1);
                        }, 200);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (showCoordsDropdown && activeCoordsIndex >= 0 && activeCoordsIndex < coordsApartments.length) {
                            handleSelectCoordsComplex(coordsApartments[activeCoordsIndex]);
                          }
                        } else if (showCoordsDropdown && coordsApartments.length > 0) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setActiveCoordsIndex((prev) => (prev < coordsApartments.length - 1 ? prev + 1 : prev));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setActiveCoordsIndex((prev) => (prev > 0 ? prev - 1 : -1));
                          } else if (e.key === "Escape") {
                            setShowCoordsDropdown(false);
                            setActiveCoordsIndex(-1);
                          }
                        }
                      }}
                      placeholder="좌표를 수정할 단지명 검색..."
                      autoComplete="off"
                    />
                    {searchingCoords && <RefreshCw className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-neutral" />}

                    {showCoordsDropdown && coordsApartments.length > 0 && (
                      <ul className="absolute z-30 left-0 right-0 top-full mt-1 max-h-40 overflow-auto rounded-lg border border-normal bg-elevated py-1 shadow-lg">
                        {coordsApartments.map((complex, index) => (
                          <li key={`${complex.id}-${index}`}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSelectCoordsComplex(complex)}
                              className={classNames(
                                "w-full text-left px-3 py-1.5 text-xs transition-colors",
                                index === activeCoordsIndex ? "bg-primary/10 text-primary font-semibold" : "hover:bg-alternative text-strong"
                              )}
                            >
                              {complex.name} <span className="text-[10px] text-neutral">({complex.regionName || complex.lawdCode})</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {selectedComplex && (
                  <div className="mt-3 space-y-3 pt-3 border-t border-normal/50">
                    <div className="mb-2">
                      <CoordPickerMap
                        lat={editLat && !isNaN(parseFloat(editLat)) ? parseFloat(editLat) : null}
                        lng={editLng && !isNaN(parseFloat(editLng)) ? parseFloat(editLng) : null}
                        regionName={selectedComplex.regionName || ""}
                        complexName={selectedComplex.name}
                        onSelectCoords={(lat, lng) => {
                          setEditLat(String(lat));
                          setEditLng(String(lng));
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-neutral mb-1">위도 (Latitude)</label>
                        <input
                          type="text"
                          className="w-full h-[36px] rounded-lg border border-normal bg-normal px-3 text-xs font-semibold text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                          value={editLat}
                          onChange={(e) => setEditLat(e.target.value)}
                          placeholder="예: 37.123456"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-neutral mb-1">경도 (Longitude)</label>
                        <input
                          type="text"
                          className="w-full h-[36px] rounded-lg border border-normal bg-normal px-3 text-xs font-semibold text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                          value={editLng}
                          onChange={(e) => setEditLng(e.target.value)}
                          placeholder="예: 127.123456"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        type="button"
                        disabled={coordsUpdating}
                        onClick={handleResetCoords}
                        className="rounded-lg bg-orange-500/10 hover:bg-orange-500/20 px-3.5 py-2 text-xs font-bold text-orange-600 disabled:opacity-50 transition-all"
                      >
                        좌표 초기화(재수집)
                      </button>
                      <button
                        type="button"
                        disabled={coordsUpdating || !editLat.trim() || !editLng.trim()}
                        onClick={handleUpdateCoords}
                        className="rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-50 transition-all"
                      >
                        좌표 저장
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* 탭 3: 데이터 관리 */}
      {activeTab === "manage" && (
        <div className="max-w-2xl mx-auto">
          <SectionCard title="데이터 관리 도구">
            <div className="space-y-4">
              <p className="text-xs text-neutral">
                수집된 실거래 데이터베이스의 특정 지역이나 아파트 단지를 골라 지우거나, 전체 데이터를 안전하게 초기화할 수 있습니다.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* 1. 지역별 삭제 */}
                <div className="space-y-1.5 p-3 rounded-lg border border-normal bg-alternative/30">
                  <span className="text-xs font-bold text-strong flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-neutral shrink-0" />
                    지역별 실거래 삭제
                  </span>
                  <div className="flex gap-2 items-center mt-1">
                    <div className="flex-1">
                      <RegionSearchInput
                        value={deleteRegionName}
                        onChange={setDeleteRegionName}
                        onSelect={(item) => {
                          setDeleteRegion(item);
                          setDeleteRegionName(item.displayName);
                        }}
                        placeholder="지우고 싶은 지역 검색..."
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!deleteRegion}
                      onClick={handleDeleteRegion}
                      className="rounded-lg bg-red-500 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50 transition-all shrink-0"
                    >
                      삭제
                    </button>
                  </div>
                  {deleteRegion && (
                    <p className="text-[10px] text-neutral mt-1">
                      선택된 코드: <b className="font-semibold text-strong">{deleteRegion.lawdCode}</b>
                    </p>
                  )}
                </div>

                {/* 2. 아파트 단지별 삭제 */}
                <div className="space-y-1.5 p-3 rounded-lg border border-normal bg-alternative/30">
                  <span className="text-xs font-bold text-strong flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-neutral shrink-0" />
                    아파트 단지별 실거래 삭제
                  </span>
                  <div className="relative flex gap-2 items-center mt-1">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        className="w-full h-[38px] rounded-lg border border-normal bg-normal pl-3 pr-8 text-xs font-semibold text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        value={complexQuery}
                        onChange={(e) => {
                          setComplexQuery(e.target.value);
                          setShowComplexDropdown(true);
                        }}
                        onFocus={() => setShowComplexDropdown(true)}
                        onBlur={() => {
                          setTimeout(() => {
                            setShowComplexDropdown(false);
                            setActiveAptIndex(-1);
                          }, 200);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (showComplexDropdown && activeAptIndex >= 0 && activeAptIndex < filteredApartments.length) {
                              const selected = filteredApartments[activeAptIndex];
                              setComplexQuery(selected);
                              setShowComplexDropdown(false);
                            }
                          } else if (showComplexDropdown && filteredApartments.length > 0) {
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setActiveAptIndex((prev) => (prev < filteredApartments.length - 1 ? prev + 1 : prev));
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setActiveAptIndex((prev) => (prev > 0 ? prev - 1 : -1));
                            } else if (e.key === "Escape") {
                              setShowComplexDropdown(false);
                              setActiveAptIndex(-1);
                            }
                          }
                        }}
                        placeholder="단지명을 입력해 검색..."
                        autoComplete="off"
                      />
                      {searchingComplexes && <RefreshCw className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-neutral" />}

                      {showComplexDropdown && filteredApartments.length > 0 && (
                        <ul className="absolute z-30 left-0 right-0 top-full mt-1 max-h-40 overflow-auto rounded-lg border border-normal bg-elevated py-1 shadow-lg">
                          {filteredApartments.map((apt, index) => (
                            <li key={`${apt}-${index}`}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setComplexQuery(apt);
                                  setShowComplexDropdown(false);
                                }}
                                className={classNames(
                                  "w-full text-left px-3 py-1.5 text-xs transition-colors",
                                  index === activeAptIndex ? "bg-primary/10 text-primary font-semibold" : "hover:bg-alternative text-strong"
                                )}
                              >
                                {apt}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!complexQuery.trim()}
                      onClick={handleDeleteComplex}
                      className="rounded-lg bg-red-500 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50 transition-all shrink-0"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. 전체 초기화 (Red Alert Box 형태로 강조 및 시각 정돈) */}
              <div className="mt-4 p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-black text-red-600 flex items-center gap-1.5 uppercase tracking-wide">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    데이터베이스 전체 초기화 (위험)
                  </span>
                  <p className="text-[11px] text-neutral leading-normal">
                    수집된 실거래 내역, 등록 단지 및 법정동 주소 정보가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearDb}
                  className="rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-xs font-bold text-white transition-all shadow-sm shadow-red-500/20 flex items-center justify-center gap-1.5 shrink-0"
                >
                  전체 초기화
                </button>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
