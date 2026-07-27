import React, { useState, useEffect, useRef } from "react";
import { useKakaoMap } from "../../useKakaoMap";
import { SectionCard } from "../../components/SectionCard";
import { StatCard } from "../../components/StatCard";
import { PageHeader } from "../../components/PageHeader";
import { loadNearbyStation, triggerGeocodeBatch, loadGeocodeStats, fetchComplexData } from "../../api";
import { MapPin, Search, Map, Compass, Play, RefreshCw, AlertTriangle, ArrowRight, Bell, Settings, CheckCircle2, X, Clock, Database, Download, Loader2, ChevronRight, Zap } from "lucide-react";
import { copy } from "../../locales/ko";

const LOCAL_STORAGE_KEY_STATIONS = "myhome_recent_stations";

function loadRecentStations(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY_STATIONS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to load recent stations", e);
    return [];
  }
}

function saveRecentStation(station: string) {
  if (!station.trim()) return;
  try {
    const current = loadRecentStations();
    const filtered = current.filter(x => x.toLowerCase() !== station.trim().toLowerCase());
    const updated = [station.trim(), ...filtered].slice(0, 10);
    localStorage.setItem(LOCAL_STORAGE_KEY_STATIONS, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save recent station", e);
  }
}

function removeRecentStation(station: string): string[] {
  try {
    const current = loadRecentStations();
    const updated = current.filter(x => x.toLowerCase() !== station.trim().toLowerCase());
    localStorage.setItem(LOCAL_STORAGE_KEY_STATIONS, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("Failed to remove recent station", e);
    return [];
  }
}

function clearRecentStations() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_STATIONS);
  } catch (e) {
    console.error("Failed to clear recent stations", e);
  }
}

interface NearbyComplex {
  name: string;
  lawdCode: string;
  regionName: string;
  lat: number;
  lng: number;
  distanceM: number;
  dongName: string | null;
  jibun: string | null;
  hasDbData?: boolean;
}

interface LiveNearbyComplex {
  name: string;
  lawdCode: string;
  regionName: string;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
  dongName: string | null;
  jibun: string | null;
  hasDbData: boolean;
}

interface FetchResult {
  ok: boolean;
  complexName: string;
  inserted: number;
  months: string[];
  alreadyCached: string[];
}

interface NearbyStationTabProps {
  onSelectComplex: (complexName: string, lawdCode?: string) => void;
  onNavigateToRules?: (initData: { regionName: string; regionCode?: string; apartmentKeywords: string[] }) => void;
}

export default function NearbyStationTab({ onSelectComplex, onNavigateToRules }: NearbyStationTabProps) {
  const locale = "ko";
  const t = copy[locale];
  const { loaded: mapLoaded, error: mapError } = useKakaoMap();
  const [stationName, setStationName] = useState("");
  const [radiusM, setRadiusM] = useState(500);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showGeocodeAdmin, setShowGeocodeAdmin] = useState(false);
  const [activeListTab, setActiveListTab] = useState<"db" | "live">("db");
  const [enableLive, setEnableLive] = useState(false);

  // 최근 검색어 상태 추가
  const [recentStations, setRecentStations] = useState<string[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // 온디맨드 적재 상태
  const [fetchingComplex, setFetchingComplex] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // 선택된 단지 (온디맨드 적재 패널용)
  const [selectedLiveComplex, setSelectedLiveComplex] = useState<LiveNearbyComplex | null>(null);

  useEffect(() => {
    setRecentStations(loadRecentStations());
  }, []);

  const handleDeleteRecent = (event: React.MouseEvent, station: string) => {
    event.stopPropagation();
    event.preventDefault();
    const updated = removeRecentStation(station);
    setRecentStations(updated);
    inputRef.current?.focus();
  };

  const handleClearAllRecent = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    clearRecentStations();
    setRecentStations([]);
    inputRef.current?.focus();
  };

  const query = stationName.trim().toLowerCase();
  const displayedStations = recentStations.filter((station) => {
    if (showAllRecent || !query) return true;
    return station.toLowerCase().includes(query);
  });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggest || displayedStations.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev < displayedStations.length - 1 ? prev + 1 : prev));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < displayedStations.length) {
        event.preventDefault();
        const selected = displayedStations[activeIndex];
        setStationName(selected);
        void handleSearch(undefined, selected);
      }
    } else if (event.key === "Escape") {
      setShowSuggest(false);
      setActiveIndex(-1);
    }
  };

  // API 결과 상태
  const [searchResult, setSearchResult] = useState<{
    station: { name: string; lat: number; lng: number };
    radiusM: number;
    complexes: NearbyComplex[];
    liveComplexes: LiveNearbyComplex[];
    stationLawdCode: string | null;
  } | null>(null);

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

  // 지도 레퍼런스
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const stationMarkerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  // 1. Geocoding 통계 조회
  const fetchGeocodeStats = async () => {
    try {
      const stats = await loadGeocodeStats();
      setGeocodeStats(stats);
    } catch (err) {
      console.error("Failed to load geocode stats", err);
    }
  };

  useEffect(() => {
    fetchGeocodeStats();
  }, []);

  // 2. 검색 실행
  const handleSearch = async (e?: React.FormEvent, overrideStationName?: string) => {
    if (e) e.preventDefault();
    const queryStr = (overrideStationName !== undefined ? overrideStationName : stationName).trim();
    if (!queryStr) return;

    setLoading(true);
    setErrorMsg("");
    setBatchResult(null);
    setShowSuggest(false);
    setFetchResult(null);
    setFetchError(null);
    setSelectedLiveComplex(null);
    setShowAllRecent(false);

    try {
      const result = await loadNearbyStation(queryStr, radiusM, enableLive);
      setSearchResult({
        station: result.station,
        radiusM: result.radiusM,
        complexes: result.complexes || [],
        liveComplexes: result.liveComplexes || [],
        stationLawdCode: result.stationLawdCode ?? null,
      });

      // DB 집계 단지(사전 집계 기반)를 항상 우선 노출하므로 db 탭을 기본 선택
      setActiveListTab("db");
      
      saveRecentStation(queryStr);
      setRecentStations(loadRecentStations());

      if (result.geocodeStats) {
        setGeocodeStats(result.geocodeStats);
      }
    } catch (err: any) {
      setErrorMsg(err.message || t.stationSearchFailed || "지하철역 조회에 실패했습니다.");
      setSearchResult(null);
    } finally {
      setLoading(false);
    }
  };

  // 온디맨드 적재 핸들러
  const handleFetchComplex = async (complex: LiveNearbyComplex) => {
    if (fetchingComplex) return;
    setSelectedLiveComplex(complex);
    setFetchingComplex(complex.name);
    setFetchResult(null);
    setFetchError(null);

    try {
      const result = await fetchComplexData(complex.name, complex.lawdCode, complex.regionName);
      setFetchResult(result);
      // 적재 완료 후 검색 결과 갱신 (hasDbData 업데이트)
      if (searchResult) {
        const updatedLive = searchResult.liveComplexes.map((c) =>
          c.name === complex.name ? { ...c, hasDbData: true } : c
        );
        setSearchResult({ ...searchResult, liveComplexes: updatedLive });
      }
    } catch (err: any) {
      setFetchError(err.message || "데이터 수집에 실패했습니다.");
    } finally {
      setFetchingComplex(null);
    }
  };

  // 3. 일괄 Geocoding 실행 (루프 방식)
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

    // 검색 결과도 갱신하여 새로운 좌표 단지 반영
    try {
      await handleSearch();
    } catch (err) {
      console.error("Failed to refresh search results after batch geocoding", err);
    }
  };

  const handleStopBatch = () => {
    shouldStopRef.current = true;
    setShouldStopBatch(true);
  };

  // 4. 카카오 지도 초기화 및 마커 렌더링
  useEffect(() => {
    if (!mapLoaded || !mapContainerRef.current || !searchResult) return;

    const kakao = window.kakao;
    const center = new kakao.maps.LatLng(searchResult.station.lat, searchResult.station.lng);

    // 지도가 없으면 생성, 있으면 중심 이동
    if (!mapRef.current) {
      const options = {
        center,
        level: 4, // 줌 레벨
        draggable: true,
        zoomable: true,
      };
      mapRef.current = new kakao.maps.Map(mapContainerRef.current, options);
    } else {
      mapRef.current.relayout();
      mapRef.current.setCenter(center);
    }

    const map = mapRef.current;

    // 기존 요소 정리
    if (stationMarkerRef.current) stationMarkerRef.current.setMap(null);
    if (circleRef.current) circleRef.current.setMap(null);
    for (const overlay of overlaysRef.current) {
      overlay.setMap(null);
    }
    overlaysRef.current = [];

    // 지하철역 마커 생성
    const stationContent = document.createElement("div");
    stationContent.className = "relative z-30 select-none";
    stationContent.innerHTML = `
      <div class="flex flex-col items-center">
        <div class="bg-indigo-600 border-2 border-white text-white font-black text-xs px-2.5 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-yellow-400 animate-ping"></span>
          <span>${searchResult.station.name}</span>
        </div>
        <div class="w-0.5 h-3 bg-indigo-600 shadow-md"></div>
      </div>
    `;

    stationMarkerRef.current = new kakao.maps.CustomOverlay({
      position: center,
      content: stationContent,
      yAnchor: 1.0,
    });
    stationMarkerRef.current.setMap(map);

    // 반경 Circle 생성
    circleRef.current = new kakao.maps.Circle({
      center,
      radius: searchResult.radiusM,
      strokeWeight: 1.5,
      strokeColor: "#6366f1",
      strokeOpacity: 0.7,
      strokeStyle: "dashed",
      fillColor: "#818cf8",
      fillOpacity: 0.08,
    });
    circleRef.current.setMap(map);

    // 아파트 단지 마커(오버레이)들 추가
    const bounds = new kakao.maps.LatLngBounds();
    bounds.extend(center); // 지하철역 포함

    const addedNames = new Set<string>();
    const newOverlays: any[] = [];

    // 1. 기존 DB 단지들 마커 생성 (초록색)
    searchResult.complexes.forEach((c) => {
      if (addedNames.has(c.name)) return;
      addedNames.add(c.name);

      const pos = new kakao.maps.LatLng(c.lat, c.lng);
      bounds.extend(pos);

      const el = document.createElement("div");
      el.className = "relative -translate-y-[100%] select-none pointer-events-auto group";

      el.innerHTML = `
        <div class="flex flex-col items-center cursor-pointer transition-all duration-200 hover:scale-105 hover:z-50 active:scale-95">
          <div class="px-2 py-1.5 rounded-lg bg-emerald-600 border border-emerald-500 text-white font-bold flex flex-col items-center text-center shadow-md">
            <span class="text-[9px] truncate max-w-[100px] leading-tight font-medium opacity-90">${c.name}</span>
            <div class="flex items-baseline gap-0.5 mt-0.5">
              <span class="text-xs font-black tracking-tight">${c.distanceM}</span>
              <span class="text-[8px] font-bold opacity-80">m</span>
            </div>
          </div>
          <div class="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-emerald-600"></div>
        </div>
      `;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectComplex(c.name, c.lawdCode);
      });

      const overlay = new kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        xAnchor: 0.5,
        yAnchor: 0,
      });

      overlay.setMap(map);
      newOverlays.push(overlay);
    });

    // 2. 실시간 단지들 마커 생성 (파란색 또는 초록색)
    searchResult.liveComplexes.forEach((c) => {
      if (addedNames.has(c.name) || c.lat === null || c.lng === null) return;
      addedNames.add(c.name);

      const pos = new kakao.maps.LatLng(c.lat, c.lng);
      bounds.extend(pos);

      const el = document.createElement("div");
      el.className = "relative -translate-y-[100%] select-none pointer-events-auto group";

      const bgColor = c.hasDbData ? "bg-emerald-600 border-emerald-500" : "bg-blue-600 border-blue-500";
      const arrowColor = c.hasDbData ? "border-t-emerald-600" : "border-t-blue-600";
      const badgeText = c.hasDbData ? "" : `<span class="text-[7px] font-black text-blue-200 block -mt-0.5">실시간</span>`;

      el.innerHTML = `
        <div class="flex flex-col items-center cursor-pointer transition-all duration-200 hover:scale-105 hover:z-50 active:scale-95">
          <div class="px-2 py-1.5 rounded-lg ${bgColor} text-white font-bold flex flex-col items-center text-center shadow-md">
            <span class="text-[9px] truncate max-w-[100px] leading-tight font-medium opacity-90">${c.name}</span>
            <div class="flex items-baseline gap-0.5 mt-0.5">
              <span class="text-xs font-black tracking-tight">${c.distanceM ?? "?"}</span>
              <span class="text-[8px] font-bold opacity-80">m</span>
            </div>
            ${badgeText}
          </div>
          <div class="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] ${arrowColor}"></div>
        </div>
      `;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (c.hasDbData) {
          onSelectComplex(c.name, c.lawdCode);
        } else {
          // 온디맨드 적재 패널 활성화
          handleFetchComplex(c);
        }
      });

      const overlay = new kakao.maps.CustomOverlay({
        position: pos,
        content: el,
        xAnchor: 0.5,
        yAnchor: 0,
      });

      overlay.setMap(map);
      newOverlays.push(overlay);
    });

    overlaysRef.current = newOverlays;

    // 지도를 단지들이 한눈에 보이게 바운즈 재설정
    const totalComplexesCount = searchResult.complexes.length + searchResult.liveComplexes.filter(c => c.lat !== null).length;
    if (totalComplexesCount > 0) {
      map.setBounds(bounds);
      // 너무 줌인되는 방지
      if (map.getLevel() < 3) {
        map.setLevel(3);
      }
    } else {
      map.setLevel(4);
    }

    return () => {
      if (stationMarkerRef.current) stationMarkerRef.current.setMap(null);
      if (circleRef.current) circleRef.current.setMap(null);
      for (const overlay of overlaysRef.current) {
        overlay.setMap(null);
      }
      overlaysRef.current = [];
      mapRef.current = null;
    };
  }, [mapLoaded, searchResult]);

  // 지도 다시 중심으로
  const handleResetCenter = () => {
    if (!mapRef.current || !searchResult) return;
    const center = new window.kakao.maps.LatLng(searchResult.station.lat, searchResult.station.lng);
    mapRef.current.relayout();
    mapRef.current.setCenter(center);
  };

  const geocodePercentage = geocodeStats && geocodeStats.total > 0
    ? Math.round((geocodeStats.geocoded / geocodeStats.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title={t.nearbyStationTitle || "역세권 아파트 검색"}
        subtitle={t.nearbyStationSubtitle || "지하철역 주변 관심 반경 내의 아파트 단지 정보와 위치를 검색합니다."}
        icon={Compass}
      />

      {/* 검색 & 정보 패널 */}
      <div className="space-y-6">
        {/* 역세권 검색 카드 */}
        <div>
          <SectionCard
            title={t.nearbyStationTitle || "역세권 아파트 검색"}
            right={
              <button
                type="button"
                onClick={() => setShowGeocodeAdmin(!showGeocodeAdmin)}
                className={`px-3 py-1.5 rounded-lg border border-normal text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 ${
                  showGeocodeAdmin
                    ? "bg-primary text-white border-transparent"
                    : "bg-alternative hover:bg-opacity-90 text-strong"
                }`}
              >
                <Settings size={13} />
                <span>{t.geocodeStatsBtn || "좌표 캐싱 설정"}</span>
              </button>
            }
          >
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-3 flex items-center text-neutral">
                    <MapPin size={18} />
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={stationName}
                    onChange={(e) => {
                      setStationName(e.target.value);
                      setShowSuggest(true);
                      setShowAllRecent(false);
                    }}
                    onFocus={() => {
                      setRecentStations(loadRecentStations());
                      setShowSuggest(true);
                      setShowAllRecent(true);
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowSuggest(false);
                        setActiveIndex(-1);
                      }, 200);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={t.stationPlaceholder || "예: 판교역, 강남역"}
                    className="w-full pl-10 pr-4 py-1.5 h-[38px] rounded-lg border border-normal bg-normal text-strong text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent transition-all"
                    autoComplete="off"
                  />
                  {showSuggest && displayedStations.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-72 w-full overflow-hidden rounded-lg border border-normal bg-normal shadow-lg flex flex-col left-0 top-[38px]">
                      <div className="flex justify-between items-center px-3 py-1.5 bg-alternative border-b border-normal text-[10px] font-bold text-neutral select-none">
                        <span>{t.recentStations || "최근 검색 지하철역"}</span>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={handleClearAllRecent}
                          className="hover:text-red-500 transition-colors flex items-center gap-0.5"
                        >
                          <X size={10} />
                          <span>{t.recentSearchClear || "전체 삭제"}</span>
                        </button>
                      </div>
                      <ul role="listbox" className="overflow-y-auto max-h-60 py-1">
                        {displayedStations.map((station, index) => {
                          const isSelected = index === activeIndex;
                          return (
                            <li
                              key={`${station}-${index}`}
                              id={`suggest-station-item-${index}`}
                              role="option"
                              aria-selected={isSelected}
                              className="relative group"
                            >
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setStationName(station);
                                  void handleSearch(undefined, station);
                                }}
                                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-strong transition-colors ${
                                  isSelected ? "bg-primary/10 text-primary" : "hover:bg-primary/5"
                                }`}
                              >
                                <Clock className="h-3.5 w-3.5 text-neutral shrink-0" />
                                <span className="flex-1 truncate pr-8">{station}</span>
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => handleDeleteRecent(e, station)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral hover:text-red-500 rounded transition-colors group-hover:opacity-100 opacity-0 focus:opacity-100"
                                title={t.deleteRegion || "삭제"}
                              >
                                <X size={12} />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 min-w-[200px]">
                  <span className="text-xs font-bold text-neutral whitespace-nowrap">{t.nearbyRadiusLabel}</span>
                  <select
                    value={radiusM}
                    onChange={(e) => setRadiusM(Number(e.target.value))}
                    className="w-full px-3 py-1.5 h-[38px] rounded-lg border border-normal bg-normal text-strong text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value={300}>{t.nearbyRadius300m}</option>
                    <option value={500}>{t.nearbyRadius500m}</option>
                    <option value={700}>{t.nearbyRadius700m}</option>
                    <option value={1000}>{t.nearbyRadius1000m}</option>
                    <option value={1500}>{t.nearbyRadius1500m}</option>
                    <option value={2000}>{t.nearbyRadius2000m}</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-1.5 px-4 h-[38px] bg-primary hover:bg-primary/80 text-white text-xs font-bold rounded-lg shadow-sm shadow-primary/20 transition-all disabled:opacity-50 whitespace-nowrap"
                >
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  <span>{loading ? (t.loading || "조회 중...") : (t.searchButton || "조회하기")}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-neutral">
                  <input
                    type="checkbox"
                    checked={enableLive}
                    onChange={(e) => setEnableLive(e.target.checked)}
                    className="rounded border-normal text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>{t.enableLiveLabel || "실시간 국토부 API 연동 조회"}</span>
                </label>
                <span className="text-[10px] text-neutral/70">
                  ({t.liveSearchDesc || "국토부 API 실시간 호출로 검색 시간이 5초 이상 소요될 수 있으며, 최근 3개월 거래 단지만 표시됩니다."})
                </span>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-500 flex items-center gap-2">
                  <AlertTriangle size={15} />
                  <span>{errorMsg}</span>
                </div>
              )}
            </form>
          </SectionCard>
        </div>

        {/* Geocoding 관리 카드 */}
        {showGeocodeAdmin && (
          <SectionCard
            title={t.geocodeStatsTitle || "Geocoding 좌표 캐싱 관리"}
            right={<Settings size={15} className="text-neutral" />}
          >
            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-neutral">{t.geocodePercentageOfTotal || "좌표 데이터 현황"}</span>
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
                    {(t.geocodeRequiredDesc || "현재 DB에 등록된 아파트 중 {pending}개 단지의 위도·경도 좌표가 없습니다...").replace("{pending}", String(geocodeStats.pending))}
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
                      <span>{t.runGeocodeBatchBtn || "좌표 미확보 단지 일괄 수집"}</span>
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
                  <div className="overflow-y-auto max-h-40 border border-normal rounded bg-elevated text-[10px]">
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
                  <p>✓ {t.batchGeocodeCompleted || "Geocoding 수집 배치 완료"} {shouldStopBatch && "(사용자 요청으로 중단됨)"}</p>
                  <p>- {(t.batchGeocodeCountInfo || "대상: {total}건 / 성공: {success}건 / 실패: {failed}건").replace("{total}", String(batchResult.total)).replace("{success}", String(batchResult.success)).replace("{failed}", String(batchResult.failed))}</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}
      </div>

      {/* 검색 결과 */}
      {searchResult && (
        <div className="space-y-6">
          {/* 통계 요약 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label={t.dbAggregateTab || "사전 집계 기반"}
              value={`${searchResult.complexes.length} 개`}
              icon={Database}
              tone="good"
            />
            <StatCard
              label={t.liveSearchTab || "실시간 조회 기반"}
              value={`${searchResult.liveComplexes.length} 개`}
              icon={Zap}
              tone={searchResult.liveComplexes.length > 0 ? "good" : "neutral" as any}
            />
            <StatCard
              label={t.nearbyRadiusLabel || "검색 반경"}
              value={`${searchResult.radiusM} m`}
              icon={Compass}
              tone="warn"
            />
          </div>

          {/* 메인 결과 뷰 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* 단지 목록 (탭 분리) */}
            <div className="lg:col-span-1 order-2 lg:order-1 h-full">
              <div className="bg-elevated border border-normal rounded-xl flex flex-col" style={{ height: "550px" }}>
                {/* 탭 헤더 */}
                <div className="flex items-center border-b border-normal shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveListTab("db")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      activeListTab === "db"
                        ? "border-emerald-500 text-emerald-600"
                        : "border-transparent text-neutral hover:text-strong"
                    }`}
                  >
                    <Database size={12} />
                    {t.dbAggregateTab || "사전 집계 기반"}
                    <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                      activeListTab === "db" ? "bg-emerald-500 text-white" : "bg-alternative text-neutral"
                    }`}>
                      {searchResult.complexes.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveListTab("live")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                      activeListTab === "live"
                        ? "border-primary text-primary"
                        : "border-transparent text-neutral hover:text-strong"
                    }`}
                  >
                    <Zap size={12} />
                    {t.liveSearchTab || "실시간 조회 기반"}
                    <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                      activeListTab === "live" ? "bg-primary text-white" : "bg-alternative text-neutral"
                    }`}>
                      {searchResult.liveComplexes.length}
                    </span>
                  </button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* 실시간 단지 탭 */}
                  {activeListTab === "live" && (
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      {searchResult.liveComplexes.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8">
                          <Zap className="text-assistive h-8 w-8 mb-2" />
                          <p className="text-xs font-semibold text-neutral">실시간 단지 정보가 없습니다.</p>
                          <p className="text-[10px] text-assistive mt-1">
                            국토부 API 키 또는 카카오 API 키가 필요합니다.
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="px-3 py-1.5 text-[10px] text-neutral bg-alternative/50 border-b border-normal/50 shrink-0">
                            <span className="font-bold text-primary">{searchResult.stationLawdCode}</span> 지역 실거래 기반 실시간 조회
                          </p>
                          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                            {searchResult.liveComplexes.map((c, idx) => (
                              <div
                                key={idx}
                                className={`group p-2.5 rounded-xl border transition-all duration-200 ${
                                  selectedLiveComplex?.name === c.name
                                    ? "border-primary bg-primary/5"
                                    : "border-normal bg-elevated/40 hover:bg-elevated hover:border-primary/30"
                                }`}
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <h4 className="font-bold text-strong text-xs truncate">{c.name}</h4>
                                      {c.hasDbData ? (
                                        <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                          DB ✓
                                        </span>
                                      ) : (
                                        <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-blue-500/10 text-blue-500 border border-blue-500/20">
                                          실시간
                                        </span>
                                      )}
                                    </div>
                                    {c.distanceM !== null && (
                                      <p className="text-[10px] text-indigo-500 font-black font-mono mt-0.5">{c.distanceM}m</p>
                                    )}
                                    <p className="text-[9px] text-neutral truncate mt-0.5">
                                      {c.dongName || ""} {c.jibun || ""}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {c.hasDbData ? (
                                      <button
                                        type="button"
                                        onClick={() => onSelectComplex(c.name, c.lawdCode)}
                                        className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500 hover:text-white transition-all active:scale-90 text-emerald-600"
                                        title="단지 분석으로 이동"
                                      >
                                        <ChevronRight size={13} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={!!fetchingComplex}
                                        onClick={() => handleFetchComplex(c)}
                                        className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500 hover:text-white transition-all active:scale-90 text-blue-500 disabled:opacity-50"
                                        title="실거래 데이터 수집 (최근 12개월)"
                                      >
                                        {fetchingComplex === c.name ? (
                                          <Loader2 size={13} className="animate-spin" />
                                        ) : (
                                          <Download size={13} />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* DB 집계 단지 탭 (기존 UI) */}
                  {activeListTab === "db" && (
                    <div className="flex-1 flex flex-col min-h-0">
                      {searchResult.complexes.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-xs font-semibold text-neutral">
                          {t.noNearbyComplexes || "반경 이내에 등록된 아파트 단지가 없습니다."}
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                          {onNavigateToRules && (
                            <button
                              type="button"
                              onClick={() => {
                                const first = searchResult.complexes[0];
                                onNavigateToRules({
                                  regionName: first.regionName,
                                  regionCode: first.lawdCode,
                                  apartmentKeywords: searchResult.complexes.map((c) => c.name),
                                });
                              }}
                              className="w-full py-2 rounded-none bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shrink-0"
                              title={t.alertRegisterTip || "반경 내 모든 단지를 관심 조건 알림 규칙으로 등록합니다."}
                            >
                              <Bell size={13} />
                              {t.allComplexAlertRegister || "전체 단지 알림 등록"} ({searchResult.complexes.length}{t.unitComplex || "개"})
                            </button>
                          )}
                          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                            {searchResult.complexes.map((c, idx) => (
                              <div
                                key={idx}
                                onClick={() => {
                                  if (mapRef.current && c.lat && c.lng) {
                                    const pos = new window.kakao.maps.LatLng(c.lat, c.lng);
                                    mapRef.current.panTo(pos);
                                  }
                                }}
                                className="group p-2.5 rounded-xl border border-normal bg-elevated/40 hover:bg-elevated hover:border-emerald-500/50 cursor-pointer transition-all duration-200 flex justify-between items-center"
                              >
                                <div className="space-y-0.5 min-w-0 pr-2">
                                  <div className="flex items-center gap-1.5">
                                    <h4 className="font-bold text-strong text-xs truncate">{c.name}</h4>
                                    {c.hasDbData !== false && (
                                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                        DB ✓
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-neutral truncate">
                                    {c.regionName} {c.dongName || ""} {c.jibun || ""}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="text-right">
                                    <span className="text-xs font-black text-indigo-500 tracking-tight">{c.distanceM}m</span>
                                    <p className="text-[8px] text-neutral uppercase font-bold tracking-wider mt-0.5">{t.distance || "거리"}</p>
                                  </div>
                                  {onNavigateToRules && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onNavigateToRules({
                                          regionName: c.regionName,
                                          regionCode: c.lawdCode,
                                          apartmentKeywords: [c.name]
                                        });
                                      }}
                                      className="p-1.5 rounded-lg bg-alternative hover:bg-emerald-500 hover:text-white transition-all active:scale-90 text-neutral"
                                      title={t.alertRegisterBtn || "알림 규칙 등록"}
                                    >
                                      <Bell size={13} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectComplex(c.name, c.lawdCode);
                                    }}
                                    className="p-1.5 rounded-lg bg-alternative hover:bg-primary hover:text-white transition-all active:scale-90 text-neutral"
                                    title={t.complexAnalysisLink || "단지 분석으로 이동"}
                                  >
                                    <ArrowRight size={13} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 온디맨드 적재 패널 */}
              {selectedLiveComplex && (
                <div className="mt-3 bg-elevated border border-normal rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-strong text-xs flex items-center gap-1.5">
                      <Download className="text-blue-500 h-3.5 w-3.5" />
                      실거래 데이터 수집
                    </h4>
                    <button
                      type="button"
                      onClick={() => { setSelectedLiveComplex(null); setFetchResult(null); setFetchError(null); }}
                      className="text-neutral hover:text-strong p-0.5"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral">
                    <span className="font-bold text-strong">{selectedLiveComplex.name}</span> 단지의 최근 12개월 실거래 데이터를 수집합니다.
                  </p>

                  {fetchingComplex === selectedLiveComplex.name && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                      <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />
                      <span className="text-xs font-semibold text-blue-600">국토부 API 호출 및 DB 적재 중...</span>
                    </div>
                  )}

                  {fetchResult && (
                    <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-2">
                      <p className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
                        <CheckCircle2 size={13} />
                        수집 완료!
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-alternative rounded-lg p-2 text-center">
                          <p className="text-neutral">해당 단지 적재</p>
                          <p className="font-black text-strong text-sm mt-0.5">{fetchResult.inserted}건</p>
                        </div>
                        <div className="bg-alternative rounded-lg p-2 text-center">
                          <p className="text-neutral">조회 기간</p>
                          <p className="font-black text-strong text-sm mt-0.5">{fetchResult.months.length}개월</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectComplex(selectedLiveComplex.name, selectedLiveComplex.lawdCode)}
                        className="w-full py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                      >
                        <ChevronRight size={13} />
                        단지 분석으로 이동
                      </button>
                    </div>
                  )}

                  {fetchError && (
                    <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                      <p className="text-xs font-semibold text-red-500 flex items-center gap-1.5">
                        <AlertTriangle size={13} />
                        {fetchError}
                      </p>
                    </div>
                  )}

                  {!fetchingComplex && !fetchResult && !fetchError && (
                    <button
                      type="button"
                      onClick={() => handleFetchComplex(selectedLiveComplex)}
                      className="w-full py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shadow-sm shadow-blue-500/20"
                    >
                      <Download size={13} />
                      최근 12개월 데이터 수집
                    </button>
                  )}
                </div>
              )}
            </div>


            {/* 지도 */}
            <div className="lg:col-span-2 order-1 lg:order-2 h-full">
              <div className="bg-elevated border border-normal rounded-xl p-3 flex flex-col" style={{ height: "550px" }}>
                <div className="flex justify-between items-center mb-3 shrink-0">
                  <span className="text-xs font-bold text-neutral flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                    {t.clickComplexToAnalyze || "단지 위치를 클릭하면 단지 상세 분석으로 이동합니다."}
                  </span>
                  <button
                    type="button"
                    onClick={handleResetCenter}
                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-normal bg-alternative hover:bg-opacity-95 text-strong flex items-center gap-1"
                  >
                    <Compass size={12} />
                    {t.centerToStation || "지하철역 중심으로"}
                  </button>
                </div>
                <div className="flex-1 w-full relative rounded-lg overflow-hidden border border-normal">
                  {mapError ? (
                    <div className="w-full h-full bg-red-500/5 flex flex-col items-center justify-center text-center p-6">
                      <MapPin className="text-red-500 animate-bounce mb-2" size={32} />
                      <p className="text-xs font-bold text-red-500">{t.mapLoadError || "지도를 로드하지 못했습니다."}</p>
                    </div>
                  ) : !mapLoaded ? (
                    <div className="w-full h-full bg-alternative flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mb-2" />
                      <p className="text-xs font-bold text-neutral">{t.loadingMap || "지도 준비 중..."}</p>
                    </div>
                  ) : (
                    <div ref={mapContainerRef} className="w-full h-full min-h-[350px]" style={{ touchAction: "auto" }} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

