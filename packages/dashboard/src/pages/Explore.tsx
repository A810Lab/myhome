import { ArrowDownRight, ArrowUpRight, ChevronDown, LayoutGrid, TableProperties, RefreshCw, Search, MapPin, History, Plus, Trash2, Calendar, Database, Building2, TrendingUp } from "lucide-react";
import React, { useMemo, useState, useEffect } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from "recharts";
import { searchTransactions, searchComplexNames, getApartments, fetchDbRegionsSummary, addDbRegion, deleteDbRegion, logActivity } from "../api";

import { RegionSearchInput } from "../components/RegionSearchInput";
import { SectionCard } from "../components/SectionCard";
import { ComplexGroupView } from "../components/ComplexGroupView";
import { classNames } from "../lib/format";
import type { RegionSearchResult, TransactionRecord, ComplexSearchResult } from "../types";
import { PYEONG_M2, getDefaultMonth } from "../lib/constants";
import { copy } from "../locales/ko";
import { useBreakpoint } from "../useBreakpoint";

const defaultMonth = getDefaultMonth();

type Locale = keyof typeof copy;
type SortMode = "date" | "price-d" | "price-a" | "area-d" | "ppy-d";

const locale: Locale = "ko";
const t = copy[locale];

type EnrichedRecord = TransactionRecord & {
  pyeong: number;
  ppy: number;
  deltaEok?: number;
};

// 수집된 지역 요약 데이터 인터페이스
interface RegionSummary {
  lawdCode: string;
  displayName: string;
  createdAt: string;
  transactionCount: number;
  minDealDate: string | null;
  maxDealDate: string | null;
}

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: "date", label: t.latestSort },
  { value: "price-d", label: t.highPriceSort },
  { value: "price-a", label: t.lowPriceSort },
  { value: "area-d", label: t.largeAreaSort },
  { value: "ppy-d", label: t.highPpySort }
];

function enrichRecords(records: TransactionRecord[]): EnrichedRecord[] {
  const groups = new Map<string, TransactionRecord[]>();
  for (const item of records) {
    const key = `${item.apartmentName}__${item.areaM2 ?? "?"}`;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const deltaByRef = new Map<TransactionRecord, number | undefined>();
  for (const items of groups.values()) {
    const sorted = [...items].sort((a, b) => a.dealDate.localeCompare(b.dealDate));
    sorted.forEach((item, idx) => {
      deltaByRef.set(item, idx === 0 ? undefined : item.priceEok - sorted[idx - 1].priceEok);
    });
  }

  return records.map((item) => {
    const pyeong = item.areaM2 !== undefined ? item.areaM2 / PYEONG_M2 : 0;
    const ppy = pyeong > 0 ? Math.round((item.priceEok * 10000) / pyeong) : 0;
    return { ...item, pyeong, ppy, deltaEok: deltaByRef.get(item) };
  });
}

function sortValue(item: EnrichedRecord, mode: SortMode): number | string {
  switch (mode) {
    case "date":
      return item.dealDate;
    case "price-d":
    case "price-a":
      return item.priceEok;
    case "area-d":
      return item.areaM2 ?? 0;
    case "ppy-d":
      return item.ppy;
  }
}

function sortRecords(items: EnrichedRecord[], mode: SortMode) {
  const direction = mode === "price-a" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = sortValue(a, mode);
    const bv = sortValue(b, mode);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });
}

function formatArea(item: EnrichedRecord, unit: "pyeong" | "m2") {
  if (item.areaM2 === undefined) return "-";
  if (unit === "pyeong") {
    return `${item.pyeong.toFixed(1)}평`;
  }
  return `${item.areaM2.toFixed(1)}㎡`;
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-alternative px-4 py-3.5">
      <p className="text-[12px] font-semibold text-neutral">{label}</p>
      <p className="mt-2 text-[22px] font-black tracking-tight text-strong leading-none">{value}</p>
      <p className="mt-1.5 text-[11px] text-assistive">{hint}</p>
    </div>
  );
}

export function ExplorePage() {
  const { isMobile } = useBreakpoint();

  // 1. 수집 지역 관리 상태
  const [dbRegions, setDbRegions] = useState<RegionSummary[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [addingRegion, setAddingRegion] = useState(false);
  const [searchRegionName, setSearchRegionName] = useState("");
  const [searchLawdCode, setSearchLawdCode] = useState("");
  const [searchResolvedName, setSearchResolvedName] = useState("");
  const [uiFeedback, setUiFeedback] = useState({ message: "", type: "success" });

  // 2. 선택된 수집 지역 상세 조회 상태
  const [selectedLawdCode, setSelectedLawdCode] = useState("");
  const [selectedDisplayName, setSelectedDisplayName] = useState("");
  const [isRange, setIsRange] = useState(true);
  const [dealMonth, setDealMonth] = useState(defaultMonth);
  const [startMonth, setStartMonth] = useState(defaultMonth);
  const [endMonth, setEndMonth] = useState(defaultMonth);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [errorDetails, setErrorDetails] = useState("");
  const [results, setResults] = useState<TransactionRecord[]>([]);
  const [searchedRegion, setSearchedRegion] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [areaUnit, setAreaUnit] = useState<"pyeong" | "m2">("pyeong");

  // 아파트 단지 연동
  const [selectedApartment, setSelectedApartment] = useState<string | null>(null);
  const [apartments, setApartments] = useState<string[]>([]);
  const [searchingComplexes, setSearchingComplexes] = useState(false);
  const [complexQuery, setComplexQuery] = useState("");
  const [showComplexDropdown, setShowComplexDropdown] = useState(false);
  const [activeAptIndex, setActiveAptIndex] = useState(-1);

  // 1. DB 수집 지역 목록 로드
  const loadRegions = async () => {
    setLoadingSummary(true);
    try {
      const summary = await fetchDbRegionsSummary();
      setDbRegions(summary);
    } catch (err: any) {
      console.error("Failed to load regions summary", err);
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    void loadRegions();
  }, []);

  // 2. 신규 지역 추가 실행
  const handleAddRegion = async () => {
    if (!searchLawdCode || !searchResolvedName) return;
    setAddingRegion(true);
    setUiFeedback({ message: "", type: "success" });
    try {
      await addDbRegion(searchLawdCode, searchResolvedName);
      
      // 사용자 활동 로그
      void logActivity("region_add", `수집 지역 추가: ${searchResolvedName} (${searchLawdCode})`, {
        lawdCode: searchLawdCode,
        displayName: searchResolvedName
      });

      setUiFeedback({
        message: `${searchResolvedName} (코드: ${searchLawdCode}) ${t.addRegionSuccess}`,
        type: "success"
      });
      // 폼 리셋
      setSearchRegionName("");
      setSearchLawdCode("");
      setSearchResolvedName("");
      // 목록 리로드
      await loadRegions();
    } catch (err: any) {
      setUiFeedback({
        message: err.message || "지역 추가에 실패했습니다.",
        type: "error"
      });
    } finally {
      setAddingRegion(false);
    }
  };

  // 3. 지역 삭제 실행
  const handleDeleteRegion = async (lawdCode: string, name: string) => {
    if (!window.confirm(`'${name}' ${t.deleteConfirm}`)) return;
    try {
      await deleteDbRegion(lawdCode);
      
      // 사용자 활동 로그
      void logActivity("region_delete", `수집 지역 삭제: ${name} (${lawdCode})`, {
        lawdCode,
        displayName: name
      });

      setUiFeedback({
        message: `'${name}' ${t.deleteRegionSuccess}`,
        type: "success"
      });
      // 만약 조회 중이던 지역이 삭제되었다면 상세 결과 비움
      if (selectedLawdCode === lawdCode) {
        setSelectedLawdCode("");
        setSelectedDisplayName("");
        setResults([]);
      }
      await loadRegions();
    } catch (err: any) {
      alert(err.message || "지역 삭제에 실패했습니다.");
    }
  };

  // 4. 선택 지역 상세 로드
  const handleSelectRegion = (lawdCode: string, displayName: string) => {
    setSelectedLawdCode(lawdCode);
    setSelectedDisplayName(displayName);
    setResults([]);
    setErrorDetails("");
    setComplexQuery("");
    setNameFilter("");
    setSelectedApartment(null);
  };

  // 5. 상세 아파트 목록 로드
  useEffect(() => {
    if (!selectedLawdCode) {
      setApartments([]);
      return;
    }
    let cancelled = false;
    setSearchingComplexes(true);
    setApartments([]);

    (async () => {
      try {
        // 1. DB에 저장된 단지 목록 조회
        const dbFound = await searchComplexNames("", selectedLawdCode);
        if (cancelled) return;

        // 2. API(캐시 또는 실시간)를 통해 아파트 단지 목록 조회
        let apiApartments: string[] = [];
        try {
          const apiResult = await getApartments(selectedLawdCode);
          apiApartments = apiResult?.apartments || [];
        } catch (apiErr) {
          console.warn("[ExploreDetail] API 단지 목록 로드 실패 (무시하고 DB 목록만 사용):", apiErr);
        }

        if (cancelled) return;

        // 3. DB 단지 목록과 API 단지 목록 병합 및 정렬 (중복 제거)
        const dbNames = dbFound.map((item) => item.name);
        const mergedSet = new Set<string>([...dbNames, ...apiApartments]);
        const sortedApartments = Array.from(mergedSet).sort((a, b) => a.localeCompare(b, "ko"));

        setApartments(sortedApartments);
      } catch (err) {
        console.error("[ExploreDetail] 단지 목록 로드 실패:", err);
        if (!cancelled) setApartments([]);
      } finally {
        if (!cancelled) setSearchingComplexes(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedLawdCode]);

  const filteredApartments = useMemo(() => {
    const q = complexQuery.trim().toLowerCase();
    if (!q) return apartments;
    return apartments.filter((apt) => apt.toLowerCase().includes(q));
  }, [apartments, complexQuery]);

  const enriched = useMemo(() => enrichRecords(results), [results]);

  const filtered = useMemo(() => {
    const name = nameFilter.trim();
    const minArea = areaMin ? Number(areaMin) : undefined;
    const maxArea = areaMax ? Number(areaMax) : undefined;
    const minPrice = priceMin ? Number(priceMin) : undefined;
    const maxPrice = priceMax ? Number(priceMax) : undefined;

    return enriched.filter((item) => {
      if (name && !item.apartmentName.includes(name)) return false;
      if (minArea !== undefined && (item.areaM2 === undefined || item.areaM2 < minArea)) return false;
      if (maxArea !== undefined && (item.areaM2 === undefined || item.areaM2 > maxArea)) return false;
      if (minPrice !== undefined && item.priceEok < minPrice) return false;
      if (maxPrice !== undefined && item.priceEok > maxPrice) return false;
      return true;
    });
  }, [enriched, nameFilter, areaMin, areaMax, priceMin, priceMax]);

  const sorted = useMemo(() => sortRecords(filtered, sortMode), [filtered, sortMode]);

  // 결과 필터링 시 첫 번째 단지 자동 선택
  useEffect(() => {
    const uniqueApts = Array.from(new Set(filtered.map((r) => r.apartmentName)));
    if (uniqueApts.length > 0) {
      if (!selectedApartment || !uniqueApts.includes(selectedApartment)) {
        setSelectedApartment(uniqueApts[0]);
      }
    } else {
      setSelectedApartment(null);
    }
  }, [filtered]);

  const kpis = useMemo(() => {
    const prices = filtered.map((item) => item.priceEok);
    const ppys = filtered.filter((item) => item.ppy > 0).map((item) => item.ppy);
    return {
      count: filtered.length,
      avgPrice: prices.length > 0 ? prices.reduce((sum, value) => sum + value, 0) / prices.length : 0,
      avgPpy: ppys.length > 0 ? Math.round(ppys.reduce((sum, value) => sum + value, 0) / ppys.length) : 0,
      maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
      minPrice: prices.length > 0 ? Math.min(...prices) : 0
    };
  }, [filtered]);

  const hasActiveFilters = Boolean(nameFilter || areaMin || areaMax || priceMin || priceMax);

  function resetFilters() {
    setNameFilter("");
    setAreaMin("");
    setAreaMax("");
    setPriceMin("");
    setPriceMax("");
    setSelectedApartment(null);
    setComplexQuery("");
  }

  async function handleSearchDetails() {
    if (!selectedLawdCode) return;

    const monthPattern = /^\d{6}$/;
    if (isRange ? (!monthPattern.test(startMonth) || !monthPattern.test(endMonth)) : !monthPattern.test(dealMonth)) {
      setErrorDetails(t.monthFormatError);
      return;
    }

    setLoadingDetails(true);
    setErrorDetails("");
    setSelectedApartment(null);

    try {
      const records = isRange
        ? await searchTransactions(selectedLawdCode, selectedDisplayName, { startMonth, endMonth }, true)
        : await searchTransactions(selectedLawdCode, selectedDisplayName, { dealMonth }, true);
      setResults(records);
      setSearchedRegion(selectedDisplayName);
      setNameFilter(complexQuery);

      // 사용자 활동 로그
      const periodStr = isRange ? `${startMonth}~${endMonth}` : dealMonth;
      const detailsStr = complexQuery ? ` (단지명: ${complexQuery})` : "";
      void logActivity("search_transactions", `${selectedDisplayName} 실거래 검색 (${periodStr})${detailsStr}`, {
        lawdCode: selectedLawdCode,
        regionName: selectedDisplayName,
        period: isRange ? { startMonth, endMonth } : { dealMonth },
        complexQuery: complexQuery || undefined,
        count: records.length
      });

      // DB 집계 결과가 갱신되었으므로, 상단 수집 지역 목록도 실시간으로 다시 로딩하여 통계 및 기간 반영
      await loadRegions();
    } catch (err) {
      setResults([]);
      setErrorDetails(err instanceof Error ? err.message : t.searchFailed);
    } finally {
      setLoadingDetails(false);
    }
  }

  // 우측 영역용 선택 단지 실거래 추출
  const selectedAptRecords = useMemo(() => {
    if (!selectedApartment) return [];
    return filtered.filter((r) => r.apartmentName === selectedApartment);
  }, [filtered, selectedApartment]);

  const selectedAptRecordsSorted = useMemo(() => {
    return [...selectedAptRecords].sort((a, b) => b.dealDate.localeCompare(a.dealDate));
  }, [selectedAptRecords]);

  const selectedAptKpis = useMemo(() => {
    const prices = selectedAptRecords.map((r) => r.priceEok);
    return {
      minPrice: prices.length > 0 ? Math.min(...prices) : 0,
      maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
      avgPrice: prices.length > 0 ? prices.reduce((s, p) => s + p, 0) / prices.length : 0
    };
  }, [selectedAptRecords]);

  // 시계열 그래프용 데이터 가공 (날짜 오름차순)
  const selectedAptChartData = useMemo(() => {
    return [...selectedAptRecords]
      .sort((a, b) => a.dealDate.localeCompare(b.dealDate))
      .map((r) => ({
        date: r.dealDate.substring(5), // 'YYYY-MM-DD' -> 'MM-DD'
        price: Number(r.priceEok.toFixed(2)),
        area: r.areaM2 ? `${Math.round(r.areaM2)}㎡` : "",
        floor: r.floor ? `${r.floor}층` : ""
      }));
  }, [selectedAptRecords]);

  const formatDispArea = (areaM2: number | undefined) => {
    if (areaM2 === undefined) return "-";
    if (areaUnit === "pyeong") {
      const pyeong = areaM2 / PYEONG_M2;
      return `${pyeong.toFixed(1)}평`;
    }
    return `${areaM2.toFixed(1)}㎡`;
  };

  // Recharts 커스텀 툴팁
  const SelectedAptTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-xl border border-normal bg-elevated p-3 shadow-xl text-xs space-y-1">
          <p className="font-bold text-strong border-b border-normal pb-1 mb-1">{data.date}</p>
          <p className="text-neutral">
            거래가: <span className="font-black text-primary">{data.price.toFixed(1)}억</span>
          </p>
          {data.area && <p className="text-neutral">면적: <span className="font-semibold text-strong">{data.area}</span></p>}
          {data.floor && <p className="text-neutral">층수: <span className="font-semibold text-strong">{data.floor}</span></p>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 flex flex-col min-h-0">
      {/* 1. Header */}
      {!isMobile && (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
              <Database className="text-primary h-6 w-6" />
              {t.title}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral">{t.subtitle}</p>
          </div>
        </header>
      )}

      {/* 알림 피드백 배너 */}
      {uiFeedback.message && (
        <div className={classNames(
          "p-4 rounded-xl text-xs font-bold transition-all border flex items-center justify-between",
          uiFeedback.type === "success"
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
            : "bg-red-500/10 border-red-500/20 text-red-500"
        )}>
          <span>{uiFeedback.message}</span>
          <button onClick={() => setUiFeedback({ message: "", type: "success" })} className="text-[10px] underline hover:opacity-80">확인</button>
        </div>
      )}

      <div className={classNames("grid gap-6", isMobile ? "grid-cols-1" : "grid-cols-3")}>
        {/* 2. 지역 신규 등록 카드 */}
        <div className={classNames(isMobile ? "" : "col-span-1")}>
          <SectionCard title={t.addRegionTitle}>
            <div className="space-y-4">
              <div className="relative">
                <span className="text-[11px] font-bold tracking-wide text-neutral block mb-1.5">{t.region} 검색</span>
                <RegionSearchInput
                  value={searchRegionName}
                  onChange={(v) => {
                    setSearchRegionName(v);
                    if (!v) { setSearchLawdCode(""); setSearchResolvedName(""); }
                  }}
                  onSelect={(item: RegionSearchResult) => {
                    setSearchLawdCode(item.lawdCode);
                    setSearchResolvedName(item.displayName);
                  }}
                  placeholder={t.regionPlaceholder}
                />
              </div>

              {searchResolvedName && searchLawdCode && (
                <div className="rounded-lg bg-alternative p-3 border border-normal/50">
                  <p className="text-[11px] text-neutral">선택된 지역 정보:</p>
                  <p className="text-xs font-bold text-strong mt-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-primary" />
                    {searchResolvedName}
                  </p>
                  <p className="text-[10px] text-assistive mt-0.5 pl-4">법정동코드: {searchLawdCode}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleAddRegion()}
                disabled={addingRegion || !searchLawdCode}
                className="w-full flex items-center justify-center gap-1.5 h-10 bg-primary hover:bg-primary/80 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm shadow-primary/20 transition-all"
              >
                {addingRegion ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                <span>수집 지역으로 추가</span>
              </button>
            </div>
          </SectionCard>
        </div>

        {/* 3. 수집 지역 목록 카드 */}
        <div className={classNames(isMobile ? "" : "col-span-2")}>
          <SectionCard title={t.regionsListTitle}>
            {loadingSummary ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
                <p className="text-xs text-neutral mt-2">수집 목록 로딩 중...</p>
              </div>
            ) : dbRegions.length === 0 ? (
              <div className="py-12 text-center text-xs text-neutral">
                {t.noDbRegions}
              </div>
            ) : (
              isMobile ? (
                <div className="grid grid-cols-1 gap-3">
                  {dbRegions.map((region, idx) => {
                    const isSelected = selectedLawdCode === region.lawdCode;
                    return (
                      <div
                        key={region.lawdCode}
                        className={classNames(
                          "p-4 rounded-xl border transition-all cursor-pointer space-y-3",
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-normal bg-alternative/40 hover:bg-alternative/60"
                        )}
                        onClick={() => handleSelectRegion(region.lawdCode, region.displayName)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-assistive font-mono">{idx + 1}</span>
                              <h4 className="font-bold text-strong text-sm">{region.displayName}</h4>
                            </div>
                            <span className="text-[10px] text-neutral font-mono block">코드: {region.lawdCode}</span>
                          </div>
                          
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleSelectRegion(region.lawdCode, region.displayName)}
                              className="px-2 py-1 text-[10px] font-bold rounded bg-primary text-white hover:opacity-90"
                            >
                              {t.viewDetails}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRegion(region.lawdCode, region.displayName)}
                              className="p-1.5 rounded text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
                              title={t.deleteRegion}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-normal/30 text-[11px]">
                          <div className="flex items-center gap-1 text-neutral">
                            <Calendar size={12} className="text-assistive" />
                            {region.minDealDate && region.maxDealDate ? (
                              <span className="font-mono">
                                {region.minDealDate.substring(2)} ~ {region.maxDealDate.substring(2)}
                              </span>
                            ) : (
                              <span className="text-assistive">-</span>
                            )}
                          </div>

                          <span className="px-2 py-0.5 rounded-full font-bold font-mono text-[10px] bg-primary/10 text-primary border border-primary/20">
                            {region.transactionCount.toLocaleString()}{t.unitCount}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-normal bg-alternative/60">
                        <th className="px-3 py-2 text-left font-bold text-neutral">지역명</th>
                        <th className="px-3 py-2 text-center font-bold text-neutral">코드</th>
                        <th className="px-3 py-2 text-center font-bold text-neutral">{t.dbAggregatePeriod}</th>
                        <th className="px-3 py-2 text-right font-bold text-neutral">{t.dbCollectCount}</th>
                        <th className="px-3 py-2 text-right font-bold text-neutral">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbRegions.map((region, idx) => {
                        const isSelected = selectedLawdCode === region.lawdCode;
                        return (
                          <tr
                            key={region.lawdCode}
                            className={classNames(
                              "border-b border-normal/40 hover:bg-alternative/40 transition-colors cursor-pointer",
                              isSelected ? "bg-primary/5 font-semibold" : ""
                            )}
                            onClick={() => handleSelectRegion(region.lawdCode, region.displayName)}
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-assistive font-mono w-4 shrink-0 text-center">{idx + 1}</span>
                                <span className="text-strong">{region.displayName}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center text-neutral font-mono">{region.lawdCode}</td>
                            <td className="px-3 py-3 text-center text-neutral">
                              {region.minDealDate && region.maxDealDate ? (
                                <span className="text-[11px]">
                                  {region.minDealDate.substring(2)} ~ {region.maxDealDate.substring(2)}
                                </span>
                              ) : (
                                <span className="text-assistive">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="px-2 py-0.5 rounded-full font-bold font-mono text-[10px] bg-primary/10 text-primary border border-primary/20">
                                {region.transactionCount.toLocaleString()}{t.unitCount}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleSelectRegion(region.lawdCode, region.displayName)}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded bg-primary text-white hover:opacity-90"
                                >
                                  {t.viewDetails}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRegion(region.lawdCode, region.displayName)}
                                  className="p-1 rounded text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
                                  title={t.deleteRegion}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </SectionCard>
        </div>
      </div>

      {/* 4. 선택 지역 상세 내역 영역 (드릴다운) */}
      {selectedLawdCode ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300">
          {/* 상세 검색 필터 바 */}
          <SectionCard
            title={`${selectedDisplayName} 실거래 집계 상세`}
            right={
              <div className="flex items-center gap-1.5 text-xs text-primary font-bold">
                <MapPin className="h-3.5 w-3.5" />
                {selectedDisplayName} ({selectedLawdCode})
              </div>
            }
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-normal bg-normal p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold tracking-wide text-neutral">{t.tradeType}</span>
                    <div className="inline-flex gap-1 rounded-lg bg-alternative p-0.5">
                      <button type="button" className="rounded-md bg-elevated px-3 py-1.5 text-xs font-bold text-strong shadow-sm">
                        {t.sale}
                      </button>
                    </div>
                  </div>

                  <div className="min-w-[180px] flex-1 space-y-1 relative">
                    <span className="text-[11px] font-bold tracking-wide text-neutral block mb-1">아파트 단지 (선택)</span>
                    <div className="relative">
                      <input
                        type="text"
                        className="w-full h-[38px] rounded-lg border border-normal bg-normal pl-3 pr-8 text-xs font-semibold text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                        value={complexQuery}
                        onChange={(e) => {
                          setComplexQuery(e.target.value);
                          if (e.target.value === "") {
                            setNameFilter("");
                          }
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
                          if (!showComplexDropdown || filteredApartments.length === 0) return;
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setActiveAptIndex((prev) => (prev < filteredApartments.length - 1 ? prev + 1 : prev));
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setActiveAptIndex((prev) => (prev > 0 ? prev - 1 : -1));
                          } else if (e.key === "Enter") {
                            e.preventDefault();
                            if (activeAptIndex >= 0 && activeAptIndex < filteredApartments.length) {
                              const selected = filteredApartments[activeAptIndex];
                              setComplexQuery(selected);
                              setNameFilter(selected);
                              setShowComplexDropdown(false);
                            }
                          } else if (e.key === "Escape") {
                            setShowComplexDropdown(false);
                            setActiveAptIndex(-1);
                          }
                        }}
                        placeholder="단지명 입력 (미입력 시 전체 조회)"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowComplexDropdown((prev) => !prev)}
                        className="absolute inset-y-0 right-0 flex items-center pr-2 text-neutral hover:text-strong"
                      >
                        {searchingComplexes ? (
                          <RefreshCw className="h-3 w-3 animate-spin text-neutral" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {showComplexDropdown && filteredApartments.length > 0 && (
                        <ul className="absolute z-30 left-0 right-0 top-full mt-1 max-h-48 overflow-auto rounded-lg border border-normal bg-elevated py-1 shadow-lg">
                          {complexQuery && (
                            <li>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setComplexQuery("");
                                  setNameFilter("");
                                  setShowComplexDropdown(false);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs text-primary font-semibold hover:bg-alternative transition-colors"
                              >
                                전체 아파트 선택 해제
                              </button>
                            </li>
                          )}
                          {filteredApartments.map((apt, index) => (
                            <li key={`${apt}-${index}`}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setComplexQuery(apt);
                                  setNameFilter(apt);
                                  setShowComplexDropdown(false);
                                }}
                                className={`w-full text-left px-3 py-1.5 text-xs text-strong transition-colors ${
                                  index === activeAptIndex ? "bg-primary/10 text-primary font-semibold" : "hover:bg-alternative"
                                }`}
                              >
                                {apt}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold tracking-wide text-neutral">{t.period}</span>
                      <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-neutral">
                        <input type="checkbox" className="rounded" checked={isRange} onChange={(event) => setIsRange(event.target.checked)} />
                        {t.rangeSearch}
                      </label>
                    </div>
                    {isRange ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          className="w-24 h-[38px] rounded-lg border border-normal bg-normal px-2.5 text-xs text-strong outline-none focus:border-primary"
                          value={startMonth}
                          onChange={(event) => setStartMonth(event.target.value)}
                          placeholder={t.startMonth}
                        />
                        <span className="text-xs text-assistive">~</span>
                        <input
                          className="w-24 h-[38px] rounded-lg border border-normal bg-normal px-2.5 text-xs text-strong outline-none focus:border-primary"
                          value={endMonth}
                          onChange={(event) => setEndMonth(event.target.value)}
                          placeholder={t.endMonth}
                        />
                      </div>
                    ) : (
                      <input
                        className="w-32 h-[38px] rounded-lg border border-normal bg-normal px-2.5 text-xs text-strong outline-none focus:border-primary"
                        value={dealMonth}
                        onChange={(event) => setDealMonth(event.target.value)}
                        placeholder={t.singleMonth}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSearchDetails()}
                    disabled={loadingDetails}
                    className="flex items-center justify-center gap-1 px-5 py-2 bg-primary hover:bg-primary/80 text-white text-sm font-semibold rounded-lg shadow-lg shadow-primary/20 transition disabled:opacity-50"
                  >
                    {loadingDetails ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                    <span>{t.search}</span>
                  </button>
                </div>

                {results.length > 0 && (
                  <div className="mt-3 grid gap-2 border-t border-dashed border-normal pt-3 md:grid-cols-[repeat(2,minmax(0,1fr))_auto]">
                    <div className="flex items-center gap-1.5">
                      <input
                        className="w-full rounded-lg h-[36px] border border-normal bg-normal px-2 text-xs text-strong outline-none focus:border-primary"
                        value={areaMin}
                        onChange={(event) => setAreaMin(event.target.value)}
                        placeholder={t.areaMin}
                        inputMode="decimal"
                      />
                      <span className="text-xs text-assistive">~</span>
                      <input
                        className="w-full rounded-lg h-[36px] border border-normal bg-normal px-2 text-xs text-strong outline-none focus:border-primary"
                        value={areaMax}
                        onChange={(event) => setAreaMax(event.target.value)}
                        placeholder={t.areaMax}
                        inputMode="decimal"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        className="w-full rounded-lg h-[36px] border border-normal bg-normal px-2 text-xs text-strong outline-none focus:border-primary"
                        value={priceMin}
                        onChange={(event) => setPriceMin(event.target.value)}
                        placeholder={t.priceMin}
                        inputMode="decimal"
                      />
                      <span className="text-xs text-assistive">~</span>
                      <input
                        className="w-full rounded-lg h-[36px] border border-normal bg-normal px-2 text-xs text-strong outline-none focus:border-primary"
                        value={priceMax}
                        onChange={(event) => setPriceMax(event.target.value)}
                        placeholder={t.priceMax}
                        inputMode="decimal"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value as SortMode)}
                        className="h-[36px] rounded-lg border border-normal bg-normal px-2 text-xs font-semibold text-strong outline-none"
                      >
                        {sortOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={() => resetFilters()}
                          className="rounded-lg border border-normal px-2.5 h-[36px] text-xs font-semibold text-neutral transition-colors hover:bg-alternative hover:text-strong"
                        >
                          {t.resetFilters}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {errorDetails && <p className="text-xs font-bold text-red-500">{errorDetails}</p>}
            </div>
          </SectionCard>

          {/* KPI 통계 카드 */}
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard label={t.recordCount} value={`${kpis.count}${t.unitCount}`} hint={t.searchScope} />
            <KpiCard label={t.averagePrice} value={`${kpis.avgPrice.toFixed(1)}${t.unitDeal}`} hint={searchedRegion || t.prompt} />
            <KpiCard label={t.averagePpy} value={kpis.avgPpy > 0 ? `${kpis.avgPpy.toLocaleString()}${t.unitPpy}` : "-"} hint={t.ppyHint} />
            <KpiCard label={t.priceRange} value={kpis.count > 0 ? `${kpis.maxPrice.toFixed(1)} · ${kpis.minPrice.toFixed(1)}${t.unitDeal}` : "-"} hint={t.searchScope} />
          </section>

          {/* 5. 좌우 2분할 레이아웃 적용 상세 영역 (기존 지도 제거 후 와이드 대시보드로 대개편) */}
          {results.length > 0 ? (
            <div className={classNames("grid gap-6 min-h-[550px]", isMobile ? "grid-cols-1" : "grid-cols-12")}>
              
              {/* [좌측 패널]: 단지 목록 카드 리스트 */}
              <div className={classNames(isMobile ? "" : "col-span-5", "border border-normal bg-elevated rounded-2xl overflow-hidden shadow-sm flex flex-col h-[650px]")}>
                <div className="p-3 border-b border-normal bg-alternative/25 flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="font-bold text-strong text-xs">아파트 단지 목록</h3>
                    <p className="text-[10px] text-neutral mt-0.5">조회 결과 내 거래량 순으로 정렬됩니다.</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* 평 / m2 토글 버튼 */}
                    <div className="flex items-center gap-0.5 rounded-lg border border-normal p-0.5 bg-alternative">
                      <button
                        type="button"
                        onClick={() => setAreaUnit("pyeong")}
                        className={classNames(
                          "rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors",
                          areaUnit === "pyeong" ? "bg-primary text-white" : "text-neutral hover:text-strong"
                        )}
                      >
                        평
                      </button>
                      <button
                        type="button"
                        onClick={() => setAreaUnit("m2")}
                        className={classNames(
                          "rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors",
                          areaUnit === "m2" ? "bg-primary text-white" : "text-neutral hover:text-strong"
                        )}
                      >
                        ㎡
                      </button>
                    </div>
                  </div>
                </div>

                {/* 단지 목록 내부 스크롤 */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  <ComplexGroupView
                    records={filtered}
                    selectedApartment={selectedApartment}
                    onSelectApartment={(aptName) => setSelectedApartment(aptName)}
                    areaUnit={areaUnit}
                  />
                </div>
              </div>

              {/* [우측 패널]: 선택한 단지의 와이드 시계열 차트 및 전체 상세 목록 */}
              <div className={classNames(isMobile ? "" : "col-span-7", "flex flex-col gap-6 h-[650px] overflow-y-auto pr-1")}>
                {selectedApartment ? (
                  <>
                    {/* 우측 상단: 선택 단지 타이틀 & KPI 집계 */}
                    <div className="border border-normal bg-elevated rounded-2xl p-4 shadow-sm space-y-4 shrink-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-black text-strong text-base flex items-center gap-2">
                          <Building2 className="text-primary h-5 w-5" />
                          {selectedApartment}
                        </h3>
                        <span className="text-xs text-neutral">
                          총 {selectedAptRecords.length}건 거래 적재됨
                        </span>
                      </div>
                      
                      {/* 선택 단지 최고/평균/최저가 */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-alternative rounded-xl p-3 text-center border border-normal/20">
                          <p className="text-[10px] text-neutral font-semibold">최고 거래가</p>
                          <p className="text-sm font-black text-red-500 font-mono mt-1">{selectedAptKpis.maxPrice.toFixed(1)}억</p>
                        </div>
                        <div className="bg-alternative rounded-xl p-3 text-center border border-normal/20">
                          <p className="text-[10px] text-neutral font-semibold">평균 거래가</p>
                          <p className="text-sm font-black text-primary font-mono mt-1">{selectedAptKpis.avgPrice.toFixed(1)}억</p>
                        </div>
                        <div className="bg-alternative rounded-xl p-3 text-center border border-normal/20">
                          <p className="text-[10px] text-neutral font-semibold">최저 거래가</p>
                          <p className="text-sm font-black text-blue-500 font-mono mt-1">{selectedAptKpis.minPrice.toFixed(1)}억</p>
                        </div>
                      </div>
                    </div>

                    {/* 우측 중단: 시원한 와이드 Recharts 실거래가 시계열 차트 */}
                    <div className="border border-normal bg-elevated rounded-2xl p-4 shadow-sm flex flex-col shrink-0 min-h-[300px]">
                      <h4 className="font-bold text-strong text-xs flex items-center gap-1.5 mb-4">
                        <TrendingUp className="text-amber-500 h-4 w-4" />
                        실거래가 시계열 추이 (와이드 뷰)
                      </h4>
                      {selectedAptChartData.length > 0 ? (
                        <div className="flex-1 w-full min-h-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={selectedAptChartData} margin={{ top: 10, right: 15, left: -20, bottom: 0 }}>
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-semantic-label-neutral)" }} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: "var(--color-semantic-label-neutral)", fontFamily: "monospace" }} tickLine={false} width={45} tickFormatter={(v) => `${v}억`} />
                              <RechartsTooltip content={<SelectedAptTooltip />} />
                              <Line type="monotone" dataKey="price" stroke="var(--color-semantic-primary-normal)" strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: "var(--color-semantic-background-elevated-normal)" }} activeDot={{ r: 5 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-xs text-neutral">
                          표시할 거래 추이가 없습니다.
                        </div>
                      )}
                    </div>

                    {/* 우측 하단: 단지별 상세 실거래 이력 테이블 */}
                    <div className="border border-normal bg-elevated rounded-2xl p-4 shadow-sm flex-1 overflow-hidden flex flex-col min-h-[250px]">
                      <h4 className="font-bold text-strong text-xs mb-3 flex items-center gap-1.5 shrink-0">
                        <TableProperties className="text-neutral h-4 w-4" />
                        상세 실거래 이력
                      </h4>
                      <div className="flex-1 overflow-y-auto">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-normal bg-alternative/60 sticky top-0 z-10">
                              <th className="px-3 py-2 text-left font-bold text-neutral">계약일</th>
                              <th className="px-3 py-2 text-center font-bold text-neutral">전용 면적</th>
                              <th className="px-3 py-2 text-center font-bold text-neutral">층</th>
                              <th className="px-3 py-2 text-right font-bold text-neutral">거래 금액</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedAptRecordsSorted.map((item, idx) => (
                              <tr key={idx} className="border-b border-normal/40 hover:bg-alternative/30 transition-colors">
                                <td className="px-3 py-2.5 text-neutral">{item.dealDate}</td>
                                <td className="px-3 py-2.5 text-center text-neutral">{formatDispArea(item.areaM2)}</td>
                                <td className="px-3 py-2.5 text-center text-strong font-semibold">{item.floor ? `${item.floor}층` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-primary font-black font-mono">{item.priceEok.toFixed(1)}억</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="border border-normal bg-elevated rounded-2xl p-8 text-center text-xs text-neutral h-full flex flex-col items-center justify-center">
                    <Building2 className="h-8 w-8 text-assistive mb-2.5 animate-bounce" />
                    좌측 목록에서 아파트를 선택해 주세요.
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="rounded-2xl border border-normal bg-elevated p-8 text-center text-xs text-neutral">
              조회 조건(단지, 기간)을 설정한 뒤 조회하기 버튼을 눌러주세요.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-normal bg-elevated p-8 text-center text-xs text-neutral">
          <Database className="h-8 w-8 text-assistive mx-auto mb-2.5" />
          위의 **수집 및 집계 지역 목록**에서 통계 요약이나 실거래 목록을 보고 싶은 지역의 **[조회]** 버튼을 클릭해 주세요.
        </div>
      )}
    </div>
  );
}