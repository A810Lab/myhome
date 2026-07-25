import React, { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
} from "recharts";
import {
  loadDailyCollectionStats,
  loadMonthlyCollectionStats,
  loadRegionCollectionStats
} from "../api";
import { DailyCollectStat, RegionCollectStat } from "@myhome/shared";
import { SectionCard } from "../components/SectionCard";
import { StatCard } from "../components/StatCard";
import { useBreakpoint } from "../useBreakpoint";
import { copy } from "../locales/ko";
import { Database, MapPin, Calendar, ClipboardList, TrendingUp, BarChart2, Building2, ChevronRight } from "lucide-react";

const locale = "ko";
const t = copy[locale];

// 수 포맷 유틸
const fmtCount = (v: number) => v.toLocaleString("ko-KR");
const fmtPrice = (v: number) =>
  v >= 10 ? `${v.toFixed(1)}억` : `${(v * 10000).toLocaleString("ko-KR")}만`;

export function CollectPage() {
  const { isMobile } = useBreakpoint();
  const [viewType, setViewType] = useState<"daily" | "monthly">("daily");
  const [chartData, setChartData] = useState<DailyCollectStat[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [errorChart, setErrorChart] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [regionData, setRegionData] = useState<RegionCollectStat[]>([]);
  const [loadingRegion, setLoadingRegion] = useState(false);
  const [errorRegion, setErrorRegion] = useState<string | null>(null);

  // 1. 수집 데이터 로딩 (보기 타입별)
  useEffect(() => {
    async function fetchStats() {
      setLoadingChart(true);
      setErrorChart(null);
      try {
        const data = viewType === "daily"
          ? await loadDailyCollectionStats()
          : await loadMonthlyCollectionStats();
        setChartData(data);
        if (data.length > 0) {
          setSelectedDate(data[data.length - 1].collectDate);
        } else {
          setSelectedDate(null);
        }
      } catch (err: any) {
        console.error(`Failed to load ${viewType} stats`, err);
        setErrorChart(err?.message ?? "Failed to load statistics.");
      } finally {
        setLoadingChart(false);
      }
    }
    fetchStats();
  }, [viewType]);

  // 2. 선택된 일자/월의 지역별 수집 데이터 로딩
  useEffect(() => {
    if (!selectedDate) { setRegionData([]); return; }
    async function fetchRegionStats() {
      setLoadingRegion(true);
      setErrorRegion(null);
      try {
        const data = await loadRegionCollectionStats(selectedDate!, viewType);
        setRegionData(data);
      } catch (err: any) {
        console.error(`Failed to load region stats for ${selectedDate}`, err);
        setErrorRegion(err?.message ?? `Failed to load stats for ${selectedDate}`);
      } finally {
        setLoadingRegion(false);
      }
    }
    fetchRegionStats();
  }, [selectedDate, viewType]);

  // 차트 클릭 핸들러
  const handleChartClick = (state: any) => {
    if (state && state.activeLabel) setSelectedDate(state.activeLabel);
  };

  // KPI 집계
  const kpi = useMemo(() => {
    if (chartData.length === 0) return { totalCount: 0, avgPrice: 0, totalComplex: 0 };
    const totalCount = chartData.reduce((s, d) => s + d.count, 0);
    const avgPrice =
      chartData.reduce((s, d) => s + d.avgPriceEok * d.count, 0) / totalCount;
    const maxComplex = Math.max(...chartData.map((d) => d.complexCount));
    return { totalCount, avgPrice, totalComplex: maxComplex };
  }, [chartData]);

  // 프리미엄 커스텀 툴팁
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as DailyCollectStat;
      return (
        <div className="rounded-xl border border-normal bg-elevated p-4 shadow-xl text-xs space-y-2 min-w-[180px]">
          <p className="font-black text-strong border-b border-normal pb-2 mb-1 flex items-center gap-1.5">
            <Calendar size={13} className="text-primary" />
            {data.collectDate} {viewType === "monthly" && `(${t.dealMonth})`}
          </p>
          <div className="flex justify-between items-center gap-4">
            <span className="text-neutral flex items-center gap-1"><BarChart2 size={11} /> {t.collectCount}</span>
            <span className="font-bold font-mono text-primary">
              {fmtCount(data.count)} {t.unitCount}
            </span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-neutral flex items-center gap-1"><TrendingUp size={11} /> 평균 거래가</span>
            <span className="font-bold font-mono text-amber-500">
              {fmtPrice(data.avgPriceEok)}
            </span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-neutral flex items-center gap-1"><Building2 size={11} /> 단지 수</span>
            <span className="font-bold font-mono text-strong">
              {fmtCount(data.complexCount)}개
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  // 범례 커스터마이저
  const CustomLegend = () => (
    <div className="flex items-center justify-center gap-5 mt-2 text-[11px] text-neutral">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm bg-[var(--color-semantic-primary-normal)] opacity-70" />
        수집 건수
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-5 h-0.5 bg-amber-400 rounded-full" />
        평균 거래가
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {!isMobile && (
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
              <ClipboardList className="text-primary h-6 w-6" />
              {t.collectReportTitle}
            </h2>
            <p className="text-sm text-neutral">{t.collectReportSubtitle}</p>
          </div>
        )}
        
        {/* 일자별 / 등록월별 토글 세그먼트 컨트롤 */}
        <div className="flex bg-alternative p-1 rounded-xl w-fit border border-normal shadow-sm">
          <button
            onClick={() => {
              setViewType("daily");
              setSelectedDate(null);
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewType === "daily"
                ? "bg-elevated text-primary shadow-sm"
                : "text-neutral hover:text-strong"
            }`}
          >
            {t.dailyView}
          </button>
          <button
            onClick={() => {
              setViewType("monthly");
              setSelectedDate(null);
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewType === "monthly"
                ? "bg-elevated text-primary shadow-sm"
                : "text-neutral hover:text-strong"
            }`}
          >
            {t.monthlyView}
          </button>
        </div>
      </header>

      {/* KPI 카드 3종 */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={BarChart2}
            label={t.accumulatedCollectCount}
            value={`${fmtCount(kpi.totalCount)} ${t.unitCount}`}
          />
          <StatCard
            icon={TrendingUp}
            label={t.totalAvgPrice}
            value={kpi.avgPrice > 0 ? `${kpi.avgPrice.toFixed(1)} ${t.unitDealWon}` : "-"}
            tone="good"
          />
          <StatCard
            icon={Building2}
            label={t.maxComplexCount}
            value={`${fmtCount(kpi.totalComplex)} ${t.unitComplex}`}
          />
        </div>
      )}

      {/* Main Grid */}
      <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-12"} gap-6`}>
        {/* 복합 차트 섹션 */}
        <div className={isMobile ? "" : "col-span-8"}>
          <SectionCard
            title={viewType === "daily" ? t.dailyCollectChart : t.monthlyCollectChart}
            subtitle={selectedDate ? `${locale === "ko" ? (viewType === "daily" ? "선택일" : "선택월") : (viewType === "daily" ? "Date" : "Month")}: ${selectedDate}` : undefined}
          >
            {loadingChart ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                <span className="text-xs text-neutral mt-3">{t.loading}</span>
              </div>
            ) : errorChart ? (
              <div className="flex items-center justify-center h-[300px] text-red-500 text-sm">
                {errorChart}
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-neutral text-sm">
                수집 기록이 없습니다.
              </div>
            ) : (
              <div className="h-[300px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    onClick={handleChartClick}
                    margin={{ top: 10, right: 58, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="collectDate"
                      tick={{ fontSize: 11, fill: "var(--color-semantic-label-neutral)" }}
                      axisLine={{ stroke: "var(--color-semantic-line-normal-normal)" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    {/* 좌측 Y: 수집 건수 */}
                    <YAxis
                      yAxisId="count"
                      orientation="left"
                      width={62}
                      tick={{ fontSize: 11, fill: "var(--color-semantic-label-neutral)", fontFamily: "monospace" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => v.toLocaleString("ko-KR")}
                      domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]}
                    />
                    {/* 우측 Y: 평균 거래가 (억) */}
                    <YAxis
                      yAxisId="price"
                      orientation="right"
                      width={52}
                      tick={{ fontSize: 11, fill: "#f59e0b", fontFamily: "monospace" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}억`}
                    />
                    <Tooltip
                      content={<CustomTooltip />}
                      cursor={{ fill: "var(--color-semantic-background-normal-alternative)", opacity: 0.4 }}
                    />
                    <Legend content={<CustomLegend />} />
                    {/* 막대: 수집 건수 */}
                    <Bar
                      yAxisId="count"
                      dataKey="count"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={40}
                    >
                      {chartData.map((entry, index) => {
                        const isSelected = entry.collectDate === selectedDate;
                        return (
                          <Cell
                            key={`cell-${index}`}
                            fill="var(--color-semantic-primary-normal)"
                            opacity={isSelected ? 1.0 : 0.35}
                            className="transition-all duration-200 cursor-pointer hover:opacity-80"
                          />
                        );
                      })}
                    </Bar>
                    {/* 꺾은선: 평균 거래가 */}
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="avgPriceEok"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, stroke: "#f59e0b", strokeWidth: 2, fill: "#fef3c7" }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        </div>

        {/* 지역별 상세 통계 섹션 */}
        <div className={isMobile ? "" : "col-span-4"}>
          <SectionCard
            title={selectedDate ? `${selectedDate} ${viewType === "daily" ? t.selectedDateStats : t.selectedMonthStats}` : (viewType === "daily" ? t.selectedDateStats : t.selectedMonthStats)}
            right={<ClipboardList size={16} className="text-neutral" />}
          >
            <div className="h-[340px] flex flex-col justify-between">
              {loadingRegion ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  <span className="text-xs text-neutral mt-2">{t.loading}</span>
                </div>
              ) : errorRegion ? (
                <div className="flex items-center justify-center h-full text-red-500 text-xs">{errorRegion}</div>
              ) : !selectedDate ? (
                <div className="flex items-center justify-center h-full text-xs text-neutral text-center">
                  {viewType === "daily" ? t.selectDatePrompt : t.selectMonthPrompt}
                </div>
              ) : regionData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-neutral">
                  이 날짜의 지역별 수집 기록이 없습니다.
                </div>
              ) : (
                <div className="space-y-2 h-full overflow-y-auto pr-1">
                  {regionData.map((item, idx) => (
                    <div
                      key={item.lawdCode}
                      className="flex justify-between items-center py-2.5 px-3 bg-alternative hover:bg-normal-normal rounded-xl transition-colors border border-normal/30"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="text-[13px] font-bold text-strong truncate flex items-center gap-1">
                          <span className="text-[10px] text-assistive font-mono w-4 shrink-0">{idx + 1}</span>
                          <MapPin size={11} className="text-neutral flex-shrink-0" />
                          {item.regionName}
                        </div>
                        <div className="text-[10px] text-neutral/70 font-mono mt-0.5 pl-4">
                          {item.lawdCode}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <span className="text-xs font-black font-mono text-primary bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded-full">
                          {item.count.toLocaleString()}{t.unitCount}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
