import { 
  Bell, 
  CheckCircle2, 
  ChevronRight, 
  Database, 
  Send, 
  LayoutDashboard, 
  MapPin, 
  Building2, 
  TrendingUp, 
  ChevronDown, 
  ChevronUp,
  RefreshCw,
  Plus,
  Trash2,
  X,
  Calendar,
  AlertCircle,
  HelpCircle,
  Check
} from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { useBreakpoint } from "../useBreakpoint";
import { useKakaoMap } from "../useKakaoMap";
import { RecentRuns } from "../components/RecentRuns";
import { SectionCard } from "../components/SectionCard";
import { StatCard } from "../components/StatCard";
import { RegionSearchInput } from "../components/RegionSearchInput";
import { classNames, formatDate } from "../lib/format";
import { searchTransactions, fetchDbRegionsSummary, addDbRegion, deleteDbRegion, logActivity } from "../api";
import type { DashboardState, RegionSearchResult } from "../types";
import { copy } from "../locales/ko";

const locale = "ko";
const t = copy[locale];

// 수집된 지역 요약 데이터 인터페이스
interface RegionSummary {
  lawdCode: string;
  displayName: string;
  createdAt: string;
  transactionCount: number;
  minDealDate: string | null;
  maxDealDate: string | null;
}

export function DashboardPage({ 
  state, 
  onChanged,
  onNavigate,
  isAdmin = false
}: { 
  state: DashboardState | undefined; 
  onChanged?: () => void;
  onNavigate?: (view: any) => void;
  isAdmin?: boolean;
}) {
  const { isMobile } = useBreakpoint();
  
  // 아코디언 상태 관리 (모두 디폴트로 접힌 상태로 설정)
  const [recentRunsOpen, setRecentRunsOpen] = useState(false);
  const [alertHistoryOpen, setAlertHistoryOpen] = useState(false);

  // 지도 & 수집 관련 상태
  const [dbRegions, setDbRegions] = useState<RegionSummary[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingCollect, setLoadingCollect] = useState(false);
  const [uiFeedback, setUiFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // 플로팅 검색 상태
  const [searchRegionName, setSearchRegionName] = useState("");

  // 수집 설정 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{
    lawdCode: string;
    regionName: string;
    isExisting: boolean;
    existingRegion?: RegionSummary;
  } | null>(null);

  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [modalError, setModalError] = useState("");

  // 지도 참조
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  const { loaded: mapLoaded, error: mapError } = useKakaoMap();

  // 1. 수집 지역 목록 로드
  const loadRegions = async () => {
    setLoadingSummary(true);
    try {
      const summary = await fetchDbRegionsSummary();
      setDbRegions(summary);
    } catch (err: any) {
      console.error("Failed to load regions summary", err);
      setUiFeedback({ message: "수집 지역 정보를 불러오는데 실패했습니다.", type: "error" });
    } finally {
      setLoadingSummary(false);
    }
  };

  // 마운트 시 지역 목록 조회
  useEffect(() => {
    void loadRegions();
  }, []);

  // 2. 지도 객체 초기화
  useEffect(() => {
    if (!mapLoaded || !mapContainerRef.current) return;

    const kakao = (window as any).kakao;
    if (!kakao || !kakao.maps) return;

    // 서울시청 중심 초기화
    const initialCenter = new kakao.maps.LatLng(37.566524, 126.978058);
    const options = {
      center: initialCenter,
      level: 8
    };

    const map = new kakao.maps.Map(mapContainerRef.current, options);
    mapRef.current = map;

    // 지도 줌 컨트롤 추가
    const zoomControl = new kakao.maps.ZoomControl();
    map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

    const geocoder = new kakao.maps.services.Geocoder();

    // 지도 클릭 이벤트: 해당 좌표의 법정동 정보 확인 후 관리자만 신규 집계 모달
    kakao.maps.event.addListener(map, "click", (mouseEvent: any) => {
      const latlng = mouseEvent.latLng;
      const lat = latlng.getLat();
      const lng = latlng.getLng();

      geocoder.coord2RegionCode(lng, lat, (result: any[], status: string) => {
        if (status === kakao.maps.services.Status.OK) {
          const legalDong = result.find((item) => item.region_type === "B");
          if (legalDong && isAdmin) {
            const lawdCode = legalDong.code.substring(0, 5);
            const regionName = `${legalDong.region_1depth_name} ${legalDong.region_2depth_name}`;
            openCollectModal(lawdCode, regionName);
          }
        }
      });
    });

    return () => {
      if (mapRef.current) {
        mapRef.current = null;
      }
    };
  }, [mapLoaded, isAdmin]);

  // 3. 수집 지역 목록이 변경될 때마다 지도 위에 커스텀 오버레이 표시
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || dbRegions.length === 0) return;

    const kakao = (window as any).kakao;
    if (!kakao || !kakao.maps) return;

    const geocoder = new kakao.maps.services.Geocoder();

    // 기존 오버레이 삭제
    for (const overlay of overlaysRef.current) {
      overlay.setMap(null);
    }
    overlaysRef.current = [];

    const bounds = new kakao.maps.LatLngBounds();
    let validBoundsCount = 0;

    const promises = dbRegions.map((region) => {
      return new Promise<void>((resolve) => {
        geocoder.addressSearch(region.displayName, (result: any[], status: string) => {
          if (status === kakao.maps.services.Status.OK && result[0]) {
            const lat = parseFloat(result[0].y);
            const lng = parseFloat(result[0].x);
            const position = new kakao.maps.LatLng(lat, lng);

            // 오버레이 엘리먼트 생성 (WDS 다크/라이트 모드 지원 프리미엄 스타일)
            const content = document.createElement("div");
            content.className = classNames(
              "rounded-2xl border border-normal bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg shadow-md px-3.5 py-2 text-center min-w-[130px] select-none transition-all hover:scale-105 hover:border-primary active:scale-95 duration-200 cursor-pointer"
            );
            content.style.pointerEvents = "auto";

            // 오버레이 본문 클릭 시 -> 종합 현황 페이지로 이동 (1년 조회)
            content.onclick = (e) => {
              e.stopPropagation();
              handleRegionClick(region.lawdCode, region.displayName);
            };

            const titleEl = document.createElement("div");
            titleEl.className = "text-xs font-black text-strong whitespace-nowrap overflow-hidden text-ellipsis flex items-center justify-center gap-1.5";
            const shortName = region.displayName.split(" ").pop() || region.displayName;
            const countText = `${region.transactionCount.toLocaleString()}건`;

            if (isAdmin) {
              titleEl.innerHTML = `<span>${shortName}</span><span class="text-primary font-extrabold text-[10.5px]">${countText}</span>`;
              
              const collectIconContainer = document.createElement("span");
              collectIconContainer.className = "inline-flex items-center justify-center p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer shrink-0 ml-1";
              collectIconContainer.style.pointerEvents = "auto";
              collectIconContainer.title = "집계 관리 및 수집 기간 연장";
              collectIconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database text-neutral hover:text-primary"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`;
              
              collectIconContainer.onclick = (e) => {
                e.stopPropagation(); // 오버레이 자체 클릭(종합현황 이동) 방지
                openCollectModal(region.lawdCode, region.displayName, region);
              };
              
              titleEl.appendChild(collectIconContainer);
            } else {
              titleEl.innerHTML = `<span>${shortName}</span><span class="text-primary font-extrabold text-[10.5px]">${countText}</span>`;
            }

            const periodEl = document.createElement("div");
            periodEl.className = "text-[9px] text-assistive font-mono mt-1 whitespace-nowrap";
            if (region.minDealDate && region.maxDealDate) {
              const formatMonth = (d: string) => d.substring(2, 7).replace("-", ".");
              periodEl.innerText = `${formatMonth(region.minDealDate)} ~ ${formatMonth(region.maxDealDate)}`;
            } else {
              periodEl.innerText = "-";
            }

            content.appendChild(titleEl);
            content.appendChild(periodEl);

            const overlay = new kakao.maps.CustomOverlay({
              position: position,
              content: content,
              yAnchor: 1.15
            });

            overlay.setMap(mapRef.current);
            overlaysRef.current.push(overlay);

            bounds.extend(position);
            validBoundsCount++;
          }
          resolve();
        });
      });
    });

    // 모든 지역이 변환되면 중심점 조절
    Promise.all(promises).then(() => {
      if (validBoundsCount > 0 && mapRef.current) {
        mapRef.current.setBounds(bounds);
      }
    });

  }, [mapLoaded, dbRegions, isAdmin]);

  // 지역 클릭 시 종합 현황 페이지로 이동 (최근 1년 필터 적용)
  const handleRegionClick = (lawdCode: string, regionName: string) => {
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = String(today.getMonth() + 1).padStart(2, "0");
    const endDate = `${curYear}-${curMonth}`;

    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const startY = oneYearAgo.getFullYear();
    const startM = String(oneYearAgo.getMonth() + 1).padStart(2, "0");
    const startDate = `${startY}-${startM}`;

    const url = `?view=analytics&lawdCode=${lawdCode}&regionName=${encodeURIComponent(regionName)}&startDate=${startDate}&endDate=${endDate}`;
    window.history.pushState({ view: "analytics" }, "", url);

    if (onNavigate) {
      onNavigate("analytics");
    }
  };

  // 집계 모달창 오픈 (관리자용)
  const openCollectModal = (lawdCode: string, regionName: string, existingRegion?: RegionSummary) => {
    const isExisting = !!existingRegion || dbRegions.some((r) => r.lawdCode === lawdCode);
    const resolvedExistingRegion = existingRegion || dbRegions.find((r) => r.lawdCode === lawdCode);

    setModalData({
      lawdCode,
      regionName,
      isExisting,
      existingRegion: resolvedExistingRegion
    });

    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = String(today.getMonth() + 1).padStart(2, "0");
    const currentYm = `${curYear}${curMonth}`;

    if (isExisting && resolvedExistingRegion?.maxDealDate) {
      const lastDate = resolvedExistingRegion.maxDealDate;
      const lastY = parseInt(lastDate.substring(0, 4));
      const lastM = parseInt(lastDate.substring(5, 7));

      let nextM = lastM + 1;
      let nextY = lastY;
      if (nextM > 12) {
        nextM = 1;
        nextY += 1;
      }
      
      const nextYm = `${nextY}${String(nextM).padStart(2, "0")}`;
      if (parseInt(nextYm) > parseInt(currentYm)) {
        setStartMonth(currentYm);
      } else {
        setStartMonth(nextYm);
      }
      setEndMonth(currentYm);
    } else {
      setStartMonth(`${curYear}01`);
      setEndMonth(currentYm);
    }

    setModalError("");
    setIsModalOpen(true);
  };

  // 플로팅 검색 인풋 선택 시 해당 주소로 이동 및 분기 처리
  const handleSearchSelect = (item: RegionSearchResult) => {
    if (!mapLoaded || !mapRef.current) return;

    const kakao = (window as any).kakao;
    if (!kakao || !kakao.maps) return;

    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(item.displayName, (result: any[], status: string) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const lat = parseFloat(result[0].y);
        const lng = parseFloat(result[0].x);
        const position = new kakao.maps.LatLng(lat, lng);

        mapRef.current.panTo(position);
        mapRef.current.setLevel(6);

        const cleanedName = item.displayName.split(" (")[0].trim();
        const isExisting = dbRegions.some((r) => r.lawdCode === item.lawdCode);
        if (isExisting) {
          handleRegionClick(item.lawdCode, cleanedName);
        } else {
          if (isAdmin) {
            openCollectModal(item.lawdCode, cleanedName);
          } else {
            setUiFeedback({ message: "아직 집계되지 않은 지역입니다. 지역 추가는 관리자에게 문의하세요.", type: "error" });
          }
        }
        
        // 검색바 리셋
        setSearchRegionName("");
      } else {
        setUiFeedback({ message: "검색한 지역의 주소 좌표를 찾을 수 없습니다.", type: "error" });
      }
    });
  };

  // 수집 및 적재 실행
  const handleCollectSubmit = async () => {
    if (!modalData) return;

    const monthPattern = /^\d{6}$/;
    if (!monthPattern.test(startMonth) || !monthPattern.test(endMonth)) {
      setModalError("집계 기간은 YYYYMM 형식(예: 202601)으로 6자리 숫자를 입력해 주세요.");
      return;
    }

    if (parseInt(startMonth) > parseInt(endMonth)) {
      setModalError("시작년월은 종료년월보다 이전이어야 합니다.");
      return;
    }

    setLoadingCollect(true);
    setModalError("");
    setUiFeedback(null);

    try {
      // 1. 신규 수집 지역의 경우 DB regions에 먼저 추가
      if (!modalData.isExisting) {
        await addDbRegion(modalData.lawdCode, modalData.regionName);
        void logActivity("region_add", `수집 지역 추가: ${modalData.regionName} (${modalData.lawdCode})`, {
          lawdCode: modalData.lawdCode,
          displayName: modalData.regionName
        });
      }

      // 2. 해당 기간 실거래 수집 API 호출 (refresh=true로 실시간 국토부 긁어와서 적재 유도)
      const records = await searchTransactions(
        modalData.lawdCode,
        modalData.regionName,
        { startMonth, endMonth },
        true
      );

      // 사용자 로그 기록
      void logActivity(
        "search_transactions",
        `${modalData.regionName} 실거래 수집/추가집계 (${startMonth}~${endMonth})`,
        {
          lawdCode: modalData.lawdCode,
          regionName: modalData.regionName,
          period: { startMonth, endMonth },
          count: records.length
        }
      );

      setUiFeedback({
        message: `${modalData.regionName} 실거래 데이터 적재를 완료했습니다. (${records.length.toLocaleString()}건 완료)`,
        type: "success"
      });
      setIsModalOpen(false);
      void loadRegions();
      if (onChanged) onChanged(); // 대시보드 상태 갱신 유도
    } catch (err: any) {
      console.error(err);
      setModalError(err.message || "수집 진행 도중 에러가 발생했습니다.");
    } finally {
      setLoadingCollect(false);
    }
  };

  // 수집 삭제 (수집 중단 및 SQLite 데이터 폭파)
  const handleRegionDelete = async () => {
    if (!modalData || !window.confirm(`${modalData.regionName} 지역의 모든 수집 설정 및 SQLite 실거래 적재 내역을 완전히 제거하시겠습니까?`)) {
      return;
    }

    setLoadingCollect(true);
    setModalError("");
    setUiFeedback(null);

    try {
      await deleteDbRegion(modalData.lawdCode);
      void logActivity("region_delete", `수집 지역 삭제 및 DB 초기화: ${modalData.regionName} (${modalData.lawdCode})`, {
        lawdCode: modalData.lawdCode,
        displayName: modalData.regionName
      });

      setUiFeedback({
        message: `${modalData.regionName} 지역 및 관련 실거래 데이터를 일괄 제거하였습니다.`,
        type: "success"
      });
      setIsModalOpen(false);
      void loadRegions();
      if (onChanged) onChanged(); // 대시보드 상태 갱신 유도
    } catch (err: any) {
      console.error(err);
      setModalError(err.message || "지역 정보 삭제에 실패했습니다.");
    } finally {
      setLoadingCollect(false);
    }
  };

  const stats = useMemo(() => {
    if (!state) return { activeRules: 0, matches: 0, sent: 0 };
    const rules = state.rules ?? [];
    const runs = state.checkRuns ?? [];
    const notifications = state.notifications ?? [];
    return {
      activeRules: rules.filter((rule) => rule.enabled).length,
      matches: runs.reduce((sum, run) => sum + run.matches.length, 0),
      sent: notifications.filter((item) => item.status === "sent").length
    };
  }, [state]);

  if (!state) {
    return (
      <div className="space-y-6 animate-pulse">
        <header className="flex flex-col gap-1">
          <div className="h-4 w-12 bg-neutral/15 rounded-md" />
          <div className="h-8 w-48 bg-neutral/20 rounded-md mt-1" />
          <div className="h-4 w-72 bg-neutral/10 rounded-md mt-1" />
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-elevated border border-normal rounded-xl p-5 flex flex-col justify-between">
              <div className="flex justify-between items-center">
                <div className="h-4 w-16 bg-neutral/15 rounded-md" />
                <div className="h-6 w-6 bg-neutral/15 rounded-full" />
              </div>
              <div className="h-6 w-12 bg-neutral/25 rounded-md" />
            </div>
          ))}
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.8fr] gap-6">
          <div className="bg-elevated border border-normal rounded-xl p-5 space-y-4">
            <div className="h-6 w-32 bg-neutral/20 rounded-md" />
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-neutral/5 rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl md:text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
          <LayoutDashboard className="text-primary h-5 w-5 md:h-6 md:w-6" />
          {t.dashboardTitle}
        </h2>
        {!isMobile && <p className="text-sm text-neutral">{t.dashboardSubtitle}</p>}
      </header>

      {/* 🚀 화려한 그라디언트 히어로 배너 (실거래 DB 현황) */}
      <div className="relative overflow-hidden rounded-2xl border border-primary-100/80 bg-gradient-to-br from-primary-50 via-primary-100/30 to-indigo-100/20 text-strong p-6 md:p-8 shadow-md shadow-primary-100/10 dark:border-none dark:bg-gradient-to-br dark:from-primary-600 dark:via-primary-700 dark:to-indigo-900 dark:text-white dark:shadow-lg dark:shadow-primary-500/10">
        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-primary-200/20 blur-2xl pointer-events-none dark:bg-white/5" />
        <div className="absolute -left-10 -bottom-10 w-40 h-40 rounded-full bg-primary-200/20 blur-2xl pointer-events-none dark:bg-white/5" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary-100 text-primary border border-primary-200/30 backdrop-blur-md dark:bg-white/20 dark:text-white dark:border-none">
              <Database className="h-3 w-3" />
              Live DB Status
            </span>
            <h3 className="text-lg md:text-2xl font-black tracking-tight text-strong dark:text-white">{t.dbStatsTitle}</h3>
            <p className="text-xs md:text-sm text-neutral leading-relaxed font-medium dark:text-white/80">
              {t.dbStatsSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 md:gap-4 shrink-0 min-w-full md:min-w-[360px]">
            <div className="bg-white/80 border border-primary-100/50 p-3 md:p-4 rounded-xl flex flex-col items-center justify-center text-center transition-all hover:bg-white dark:bg-white/10 dark:border-white/10 dark:text-white dark:hover:bg-white/15">
              <MapPin className="h-5 w-5 text-primary/70 mb-1.5 dark:text-white/70" />
              <span className="text-[10px] md:text-xs text-neutral font-bold dark:text-white/60">{t.dbStatsRegionCount}</span>
              <span className="text-lg md:text-xl font-bold font-mono mt-1 text-strong dark:text-white">
                {state.dbStats?.regions?.toLocaleString("ko-KR") ?? 0}
              </span>
            </div>
            <div className="bg-white/80 border border-primary-100/50 p-3 md:p-4 rounded-xl flex flex-col items-center justify-center text-center transition-all hover:bg-white dark:bg-white/10 dark:border-white/10 dark:text-white dark:hover:bg-white/15">
              <Building2 className="h-5 w-5 text-primary/70 mb-1.5 dark:text-white/70" />
              <span className="text-[10px] md:text-xs text-neutral font-bold dark:text-white/60">{t.dbStatsComplexCount}</span>
              <span className="text-lg md:text-xl font-bold font-mono mt-1 text-strong dark:text-white">
                {state.dbStats?.complexes?.toLocaleString("ko-KR") ?? 0}
              </span>
            </div>
            <div className="bg-white/80 border border-primary-100/50 p-3 md:p-4 rounded-xl flex flex-col items-center justify-center text-center transition-all hover:bg-white dark:bg-white/10 dark:border-white/10 dark:text-white dark:hover:bg-white/15">
              <TrendingUp className="h-5 w-5 text-primary/70 mb-1.5 dark:text-white/70" />
              <span className="text-[10px] md:text-xs text-neutral font-bold dark:text-white/60">{t.dbStatsDealCount}</span>
              <span className="text-lg md:text-xl font-bold font-mono mt-1 text-strong dark:text-white">
                {state.dbStats?.transactions?.toLocaleString("ko-KR") ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 🗺️ 실거래 수집/집계 지역 지도 (통합 배치) */}
      <div className="rounded-2xl border border-normal bg-elevated p-4 shadow-sm relative overflow-hidden">
        <h3 className="text-sm font-black text-strong mb-2.5 flex items-center gap-2">
          <Database className="h-4.5 w-4.5 text-primary shrink-0" />
          지역별 실거래 집계 지도
        </h3>
        
        {uiFeedback && (
          <div className={classNames(
            "mb-3 px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-3 animate-in fade-in duration-200",
            uiFeedback.type === "success" 
              ? "bg-primary-50/50 border-primary-200/50 text-primary dark:bg-primary-900/10 dark:border-primary-900/30" 
              : "bg-warn-50/50 border-warn-200/50 text-warn dark:bg-warn-900/10 dark:border-warn-900/30"
          )}>
            <div className="flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{uiFeedback.message}</span>
            </div>
            <button onClick={() => setUiFeedback(null)} className="text-neutral hover:text-strong">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="relative w-full h-[400px] md:h-[480px] rounded-xl overflow-hidden border border-normal bg-slate-100 dark:bg-slate-900">
          {!mapLoaded ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 dark:bg-slate-900 text-neutral">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs">{mapError ? t.mapLoadError : t.loadingMap}</p>
            </div>
          ) : (
            <div ref={mapContainerRef} className="w-full h-full" />
          )}

          {mapLoaded && !mapError && (
            <div className="absolute top-4 left-4 z-10 w-[240px] md:w-[280px] max-w-[calc(100vw-32px)]">
              <RegionSearchInput
                value={searchRegionName}
                onChange={setSearchRegionName}
                onSelect={handleSearchSelect}
                placeholder={t.regionPlaceholder}
                className="w-full rounded-lg border border-normal bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-2.5 py-1.5 text-xs text-strong focus:border-primary outline-none shadow-lg"
              />
            </div>
          )}

          {mapLoaded && !mapError && !isMobile && (
            <div className="absolute bottom-4 left-4 z-10 bg-white/60 dark:bg-slate-900/60 backdrop-blur-lg border border-normal rounded-lg px-3 py-2 text-[10px] font-bold text-neutral flex items-center gap-1.5 shadow-md max-w-[360px]">
              <HelpCircle className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>지역 추가는 관리자에게 문의하세요</span>
            </div>
          )}
        </div>
      </div>

      {/* 핵심 지표 요약 (즉시 노출) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Bell} label={t.activeRules} value={`${stats.activeRules}${t.unitCount}`} tone="good" />
        <StatCard icon={CheckCircle2} label={t.totalMatches} value={`${stats.matches}${t.unitCount}`} />
        <StatCard 
          icon={Send} 
          label={t.sentNotifications} 
          value={`${stats.sent}${t.unitCount}`} 
          tone={state.config.telegramConfigured ? "good" : "warn"} 
          onClick={() => onNavigate && onNavigate("rules")}
        />
        <StatCard icon={Database} label={t.systemStatus} value={state.config.telegramConfigured ? t.statusNormal : t.statusCheck} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.8fr] gap-6">
        <RecentRuns runs={state.checkRuns ?? []} onChanged={onChanged} isOpen={recentRunsOpen} onToggle={() => setRecentRunsOpen(!recentRunsOpen)} />

        <SectionCard 
          title={t.alertHistory}
          right={
            <button
              onClick={() => setAlertHistoryOpen(!alertHistoryOpen)}
              className="flex items-center justify-center p-1.5 rounded-lg border border-normal bg-normal text-neutral hover:text-strong hover:bg-alternative transition-all"
              title={alertHistoryOpen ? t.accordionCollapse : t.accordionExpand}
            >
              {alertHistoryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          }
        >
          {alertHistoryOpen ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              {(state.notifications ?? []).slice(0, 4).map((item) => {
                let statusText: string = t.alertSuccess;
                let statusColor = "bg-primary-50/50 text-primary border border-primary-200/30";
                if (item.status === "skipped") {
                  statusText = t.alertSkipped;
                  statusColor = "bg-warning-50/50 text-warning border border-warning-200/30";
                } else if (item.status === "failed") {
                  statusText = t.alertFailed;
                  statusColor = "bg-warn-50/50 text-warn border border-warn-200/30";
                }

                return (
                  <div key={item.id} className="flex gap-3">
                    <div className={classNames(
                      "h-8 w-8 rounded-full flex items-center justify-center shrink-0 border",
                      statusColor
                    )}>
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-strong">
                        {item.channel} {t.alertPrefix} {statusText}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral truncate">{item.message}</p>
                      <p className="mt-1 text-[10px] text-assistive">{formatDate(item.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
              {(state.notifications ?? []).length === 0 && (
                <p className="text-center py-6 text-sm text-neutral">{t.noAlertHistory}</p>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-neutral cursor-pointer hover:text-strong transition-colors" onClick={() => setAlertHistoryOpen(!alertHistoryOpen)}>
              {t.accordionAlertHistoryCollapsed} (최근 {(state.notifications ?? []).length}건)
            </div>
          )}
        </SectionCard>
      </div>

      {/* 4. 집계 설정 및 추가수집 모달 다이얼로그 (Portal 대용) */}
      {isModalOpen && modalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-elevated border border-normal rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* 모달 헤더 */}
            <div className="px-5 py-4 border-b border-normal bg-alternative/35 flex items-center justify-between">
              <h3 className="text-sm font-black text-strong flex items-center gap-2">
                <Database className="h-4.5 w-4.5 text-primary" />
                {modalData.isExisting ? "실거래 추가 집계 (기간 연장)" : "신규 지역 실거래 집계"}
              </h3>
              <button 
                type="button" 
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-neutral hover:bg-alternative hover:text-strong transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="p-5 space-y-4 text-xs">
              
              {/* 지역 정보 요약 */}
              <div className="rounded-xl bg-alternative/30 backdrop-blur-xs p-3.5 border border-normal/50 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-assistive font-semibold">선택한 지역</span>
                    <p className="text-sm font-black text-strong flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                      {modalData.regionName}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-assistive bg-normal px-2 py-0.5 rounded border border-normal">
                    코드 {modalData.lawdCode}
                  </span>
                </div>

                {modalData.isExisting && modalData.existingRegion && (
                  <div className="pt-2 border-t border-normal/30 grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-assistive">기존 집계 건수</span>
                      <p className="font-bold text-strong mt-0.5">{modalData.existingRegion.transactionCount.toLocaleString()}건</p>
                    </div>
                    <div>
                      <span className="text-assistive">기존 집계 기간</span>
                      <p className="font-bold text-strong mt-0.5">
                        {modalData.existingRegion.minDealDate && modalData.existingRegion.maxDealDate
                          ? `${modalData.existingRegion.minDealDate.substring(0, 7)} ~ ${modalData.existingRegion.maxDealDate.substring(0, 7)}`
                          : "-"}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 입력 기간 폼 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[10px] font-bold text-neutral">
                  <Calendar size={14} className="text-primary" />
                  <span>집계 기간 설정 (YYYYMM 형식)</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="startMonth" className="text-[10px] text-neutral font-semibold">시작년월</label>
                    <input
                      id="startMonth"
                      type="text"
                      maxLength={6}
                      value={startMonth}
                      onChange={(e) => setStartMonth(e.target.value.replace(/\D/g, ""))}
                      placeholder="예: 202601"
                      className="w-full rounded-xl border border-normal bg-normal px-3 py-2 text-xs font-bold text-strong focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="endMonth" className="text-[10px] text-neutral font-semibold">종료년월</label>
                    <input
                      id="endMonth"
                      type="text"
                      maxLength={6}
                      value={endMonth}
                      onChange={(e) => setEndMonth(e.target.value.replace(/\D/g, ""))}
                      placeholder="예: 202607"
                      className="w-full rounded-xl border border-normal bg-normal px-3 py-2 text-xs font-bold text-strong focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-alternative/40 border border-normal text-[10px] text-neutral flex items-start gap-2 leading-relaxed">
                  <AlertCircle size={14} className="text-primary shrink-0 mt-0.5" />
                  <span>
                    {modalData.isExisting 
                      ? "기존 수집 데이터와 겹치지 않는 추가 기간만 지정하셔도 되며, 이미 수집된 달을 포함해 집계하면 해당 기간의 로컬 실거래가 자동 업데이트(Upsert)됩니다."
                      : "집계 시작 시, 국토교통부 OpenAPI를 호출하여 실시간으로 해당 지역의 실거래 데이터를 긁어와 로컬 SQLite DB에 일괄upsert 및 적재합니다."}
                  </span>
                </div>
              </div>

              {/* 에러 노출 */}
              {modalError && (
                <div className="p-2.5 rounded-lg bg-warn-50 border border-warn text-[10px] text-warn flex items-center gap-1.5 dark:bg-warn-900/10 dark:border-warn-900/30">
                  <AlertCircle size={13} />
                  <span>{modalError}</span>
                </div>
              )}
            </div>

            {/* 모달 풋터 */}
            <div className="px-5 py-3.5 bg-alternative/20 border-t border-normal flex items-center justify-between gap-3">
              {/* 관리자 권한 + 기존 등록 지역일 때만 수집 제외(삭제) 버튼 노출 */}
              {isAdmin && modalData.isExisting ? (
                <button
                  type="button"
                  onClick={handleRegionDelete}
                  disabled={loadingCollect}
                  className="px-3.5 py-2 rounded-xl text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 font-bold transition-colors flex items-center gap-1 disabled:opacity-50 dark:bg-rose-950/10 dark:border-rose-900/30 dark:text-rose-400"
                >
                  <Trash2 size={13} />
                  <span>집계 해제</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={loadingCollect}
                  className="px-4 py-2 rounded-xl border border-normal text-neutral hover:bg-alternative font-bold transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleCollectSubmit}
                  disabled={loadingCollect}
                  className="px-4 py-2 rounded-xl bg-primary text-white hover:bg-primary-700 font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {loadingCollect ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>집계 중...</span>
                    </>
                  ) : (
                    <>
                      <Check size={13} />
                      <span>집계 시작</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
