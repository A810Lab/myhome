import React from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  CartesianGrid,
  Cell,
} from "recharts";
import { SectionCard } from "../../components/SectionCard";
import { StatCard } from "../../components/StatCard";
import { useBreakpoint } from "../../useBreakpoint";
import { TrendingUp, DollarSign, Home, Activity } from "lucide-react";
import { copy } from "../../locales/ko";

interface OverviewTabProps {
  data: any[]; // searchTransactions 결과
  onSelectComplex?: (complexName: string) => void;
  areaUnit?: "pyeong" | "m2";
  areaType?: "supply" | "dedicated";
  locale?: "ko" | "en";
}

const tooltipContentStyle = {
  backgroundColor: "var(--color-semantic-background-elevated-normal)",
  border: "1px solid var(--color-semantic-line-normal-normal)",
  borderRadius: "8px",
  color: "var(--color-semantic-label-strong)",
  fontSize: "12px",
};

// 중위값 계산 헬퍼 함수
function getMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// 백분위수 계산 헬퍼 함수 (Q1, Q3용)
function getPercentile(arr: number[], percentile: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

const BoxPlotShape = (props: any) => {
  const { x, y, width, height, payload, yAxis, showWhiskers = true, showBox = true, showMedian = true, showMean = true } = props;
  if (!payload) return null;

  const min = payload.min;
  const max = payload.max;
  const q1 = payload.q1;
  const q3 = payload.q3;
  const median = payload.median;
  const mean = payload.mean !== undefined ? payload.mean : payload.avg;

  if (min === undefined || max === undefined || q1 === undefined || q3 === undefined || median === undefined || mean === undefined) {
    return null;
  }

  const getY = (val: number) => {
    if (yAxis && typeof yAxis.scale === "function") {
      return yAxis.scale(val);
    }
    if (yAxis && yAxis.domain) {
      const [minD, maxD] = yAxis.domain;
      const range = maxD - minD;
      if (range === 0) return yAxis.y + yAxis.height;
      const ratio = (val - minD) / range;
      return yAxis.y + yAxis.height - ratio * yAxis.height;
    }
    const assumedMinD = Math.max(0, Math.floor(min * 0.9));
    const denom = mean - assumedMinD;
    if (denom <= 0) return y;
    const pixelsPerUnit = height / denom;
    return y + height - (val - assumedMinD) * pixelsPerUnit;
  };

  const yMin = getY(min);
  const yMax = getY(max);
  const yQ1 = getY(q1);
  const yQ3 = getY(q3);
  const yMedian = getY(median);
  const yMean = getY(mean);

  const centerX = x + width / 2;
  const boxWidth = Math.min(width * 0.7, 24);
  const boxLeft = centerX - boxWidth / 2;

  const boxStroke = "var(--color-chart-primary)";
  const boxFill = "var(--color-chart-primary)";
  const whiskerStroke = "var(--color-semantic-line-normal-normal)";
  const medianStroke = "var(--color-chart-median)";
  const meanFill = "var(--color-chart-accent)";

  return (
    <g>
      {/* 1. Whisker (최소 ~ 최대 세로선) */}
      {showWhiskers && (
        <g>
          <line x1={centerX} y1={yMin} x2={centerX} y2={yMax} stroke={whiskerStroke} strokeWidth={1.5} strokeDasharray="3 3" />
          <line x1={centerX - boxWidth / 4} y1={yMin} x2={centerX + boxWidth / 4} y2={yMin} stroke={whiskerStroke} strokeWidth={1.5} />
          <line x1={centerX - boxWidth / 4} y1={yMax} x2={centerX + boxWidth / 4} y2={yMax} stroke={whiskerStroke} strokeWidth={1.5} />
        </g>
      )}

      {/* 2. Box (Q1 ~ Q3) */}
      {showBox && (
        <rect
          x={boxLeft}
          y={Math.min(yQ1, yQ3)}
          width={boxWidth}
          height={Math.max(1, Math.abs(yQ1 - yQ3))}
          stroke={boxStroke}
          strokeWidth={1.5}
          fill={boxFill}
          fillOpacity={0.15}
          rx={1}
        />
      )}

      {/* 3. Median Line */}
      {showMedian && (
        <line x1={boxLeft} y1={yMedian} x2={boxLeft + boxWidth} y2={yMedian} stroke={medianStroke} strokeWidth={2} />
      )}

      {/* 4. Mean Marker (다이아몬드) */}
      {showMean && (
        <polygon
          points={`${centerX},${yMean - 4} ${centerX + 4},${yMean} ${centerX},${yMean + 4} ${centerX - 4},${yMean}`}
          fill={meanFill}
          stroke="var(--color-semantic-background-normal-normal)"
          strokeWidth={1}
        />
      )}
    </g>
  );
};

// ─── 히트맵: 가격 → 색상 보간 헬퍼 (파랑 → 빨강) ────────────────────────────
function interpolateHeatColor(value: number, min: number, max: number): string {
  if (max <= min) return "rgba(99,102,241,0.55)"; // 단색 fallback
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // 파랑(#6366f1) → 보라(#a855f7) → 빨강(#ef4444)
  let r: number, g: number, b: number;
  if (ratio < 0.5) {
    const t = ratio * 2;
    r = Math.round(99 + t * (168 - 99));
    g = Math.round(102 + t * (85 - 102));
    b = Math.round(241 + t * (247 - 241));
  } else {
    const t = (ratio - 0.5) * 2;
    r = Math.round(168 + t * (239 - 168));
    g = Math.round(85 + t * (68 - 85));
    b = Math.round(247 + t * (68 - 247));
  }
  return `rgba(${r},${g},${b},0.82)`;
}

// 박스 플롯용 커스텀 툴팁 컴포넌트
const BoxPlotTooltip = ({ active, payload, label, t }: any) => {
  if (active && payload && payload.length) {
    const metaRecord = payload[0]?.payload;
    if (!metaRecord) return null;

    const { min, q1, median, q3, max, avg, volume } = metaRecord;

    return (
      <div className="rounded-xl border border-normal bg-elevated p-3.5 shadow-xl text-xs space-y-2 min-w-[180px]">
        <p className="font-black text-strong border-b border-normal pb-1.5 mb-1.5 text-[13px]">
          {metaRecord.name || label}
        </p>

        <div className="space-y-1.5">
          <p className="text-neutral flex justify-between gap-4">
            <span>{t?.tradeCount || "거래량"}:</span>
            <span className="font-bold text-strong">{volume} 건</span>
          </p>
          <p
            className="flex justify-between gap-4"
            style={{ color: "var(--color-chart-max)" }}
          >
            <span>{t?.maxPriceLabel || "최고가"} (Max):</span>
            <span className="font-bold">
              {max !== null && max !== undefined ? `${max.toFixed(1)} 억` : "-"}
            </span>
          </p>
          <p
            className="flex justify-between gap-4"
            style={{ color: "var(--color-chart-median)" }}
          >
            <span>Q3 (75%):</span>
            <span className="font-bold">
              {q3 !== null && q3 !== undefined ? `${q3.toFixed(1)} 억` : "-"}
            </span>
          </p>
          <p
            className="flex justify-between gap-4"
            style={{ color: "var(--color-chart-primary)" }}
          >
            <span>{t?.avgPriceLabel || "평균가"} (Avg):</span>
            <span className="font-bold">
              {avg !== null && avg !== undefined ? `${avg.toFixed(1)} 억` : "-"}
            </span>
          </p>
          <p
            className="flex justify-between gap-4"
            style={{ color: "var(--color-chart-median)" }}
          >
            <span>
              {t?.boxPlotMedian?.replace(" (Median)", "") || "중위값"}:
            </span>
            <span className="font-bold">
              {median !== null && median !== undefined
                ? `${median.toFixed(1)} 억`
                : "-"}
            </span>
          </p>
          <p
            className="flex justify-between gap-4"
            style={{ color: "var(--color-chart-median)" }}
          >
            <span>Q1 (25%):</span>
            <span className="font-bold">
              {q1 !== null && q1 !== undefined ? `${q1.toFixed(1)} 억` : "-"}
            </span>
          </p>
          <p
            className="flex justify-between gap-4"
            style={{ color: "var(--color-chart-min)" }}
          >
            <span>최저가 (Min):</span>
            <span className="font-bold">
              {min !== null && min !== undefined ? `${min.toFixed(1)} 억` : "-"}
            </span>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

// 프리미엄 커스텀 툴팁 컴포넌트
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    // ComposedChart 전체 메타 데이터
    const metaRecord = payload.find(
      (p: any) =>
        p.dataKey === "최대가" ||
        p.dataKey === "최소가" ||
        p.dataKey === "거래량",
    )?.payload;

    const maxVal = metaRecord?.최대가;
    const avgVal = metaRecord?.평균가;
    const medVal = metaRecord?.중위값;
    const minVal = metaRecord?.최소가;
    const volume = metaRecord?.거래량;

    return (
      <div className="rounded-xl border border-normal bg-elevated p-3.5 shadow-xl text-xs space-y-2 min-w-[180px]">
        <p className="font-black text-strong border-b border-normal pb-1.5 mb-1.5 text-[13px]">
          {label}
        </p>

        <div className="space-y-1.5">
          {volume !== undefined && (
            <p className="text-neutral flex justify-between gap-4">
              <span>총 거래량:</span>
              <span className="font-bold text-strong">{volume} 건</span>
            </p>
          )}
          {maxVal !== undefined && (
            <p
              className="flex justify-between gap-4"
              style={{ color: "var(--color-chart-max)" }}
            >
              <span>최고가:</span>
              <span className="font-bold">{maxVal.toFixed(1)} 억</span>
            </p>
          )}
          {avgVal !== undefined && (
            <p
              className="flex justify-between gap-4"
              style={{ color: "var(--color-chart-primary)" }}
            >
              <span>평균가:</span>
              <span className="font-bold">{avgVal.toFixed(1)} 억</span>
            </p>
          )}
          {medVal !== undefined && (
            <p
              className="flex justify-between gap-4"
              style={{ color: "var(--color-chart-median)" }}
            >
              <span>중위값:</span>
              <span className="font-bold">{medVal.toFixed(1)} 억</span>
            </p>
          )}
          {minVal !== undefined && (
            <p
              className="flex justify-between gap-4"
              style={{ color: "var(--color-chart-min)" }}
            >
              <span>최저가:</span>
              <span className="font-bold">{minVal.toFixed(1)} 억</span>
            </p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export default function OverviewTab({
  data,
  onSelectComplex,
  areaUnit = "pyeong",
  areaType = "supply",
  locale = "ko",
}: OverviewTabProps) {
  const { isNarrow } = useBreakpoint();

  const getAreaValue = React.useCallback((d: any) => {
    if (areaType === "supply") {
      return d.supplyAreaM2 || (d.areaM2 / 0.78);
    }
    return d.areaM2 || 0;
  }, [areaType]);

  const sizeCategories = React.useMemo(() => {
    if (areaUnit === "pyeong") {
      if (areaType === "supply") {
        return [
          "20평 이하",
          "21~25평",
          "26~30평",
          "31~35평",
          "36~40평",
          "41~45평",
          "46~50평",
          "50평 초과",
        ];
      } else {
        return [
          "15평 이하",
          "16~20평",
          "21~25평",
          "26~30평",
          "31~35평",
          "36~40평",
          "40평 초과",
        ];
      }
    } else {
      if (areaType === "supply") {
        return [
          "66㎡ 이하",
          "67~85㎡",
          "86~105㎡",
          "106~120㎡",
          "121~135㎡",
          "136~150㎡",
          "151~165㎡",
          "165㎡ 초과",
        ];
      } else {
        return [
          "66㎡ 이하",
          "67~83㎡",
          "84~99㎡",
          "100~116㎡",
          "117~132㎡",
          "133~149㎡",
          "150~165㎡",
          "165㎡ 초과",
        ];
      }
    }
  }, [areaUnit, areaType]);

  const [sizeFilter, setSizeFilter] = React.useState<
    "all" | "under20" | "20s" | "30s" | "40s" | "over50"
  >("all");
  const [selectedRegion, setSelectedRegion] = React.useState<string>("all");

  const regionOptions = React.useMemo(() => {
    const set = new Set<string>();
    data.forEach((d) => {
      const rName = d.regionName ? d.regionName.split(" ").slice(-1)[0] : null;
      if (rName) set.add(rName);
    });
    return ["all", ...Array.from(set).sort()];
  }, [data]);

  const t = copy[locale];

  const floorCategories = React.useMemo(() => {
    return [t.floorLow, t.floorMid, t.floorHigh, t.floorSuper];
  }, [t]);

  const getSizeCategory = React.useCallback((areaM2: number) => {
    const areaPyeong = areaM2 / 3.3058;
    if (areaUnit === "pyeong") {
      if (areaType === "supply") {
        if (areaPyeong <= 20.5) return "20평 이하";
        if (areaPyeong <= 25.5) return "21~25평";
        if (areaPyeong <= 30.5) return "26~30평";
        if (areaPyeong <= 35.5) return "31~35평";
        if (areaPyeong <= 40.5) return "36~40평";
        if (areaPyeong <= 45.5) return "41~45평";
        if (areaPyeong <= 50.5) return "46~50평";
        return "50평 초과";
      } else {
        if (areaPyeong <= 15.5) return "15평 이하";
        if (areaPyeong <= 20.5) return "16~20평";
        if (areaPyeong <= 25.5) return "21~25평";
        if (areaPyeong <= 30.5) return "26~30평";
        if (areaPyeong <= 35.5) return "31~35평";
        if (areaPyeong <= 40.5) return "36~40평";
        return "40평 초과";
      }
    } else {
      if (areaType === "supply") {
        if (areaM2 <= 66.5) return "66㎡ 이하";
        if (areaM2 <= 85.5) return "67~85㎡";
        if (areaM2 <= 105.5) return "86~105㎡";
        if (areaM2 <= 120.5) return "106~120㎡";
        if (areaM2 <= 135.5) return "121~135㎡";
        if (areaM2 <= 150.5) return "136~150㎡";
        if (areaM2 <= 165.5) return "151~165㎡";
        return "165㎡ 초과";
      } else {
        if (areaM2 <= 66.5) return "66㎡ 이하";
        if (areaM2 <= 83.5) return "67~83㎡";
        if (areaM2 <= 99.5) return "84~99㎡";
        if (areaM2 <= 116.5) return "100~116㎡";
        if (areaM2 <= 132.5) return "117~132㎡";
        if (areaM2 <= 149.5) return "133~149㎡";
        if (areaM2 <= 165.5) return "150~165㎡";
        return "165㎡ 초과";
      }
    }
  }, [areaUnit, areaType]);

  const getFloorCategory = React.useCallback((floorStr: string | number) => {
    const floorNum = Number(floorStr);
    if (isNaN(floorNum)) return "기타";
    if (floorNum <= 5) return t.floorLow;
    if (floorNum <= 15) return t.floorMid;
    if (floorNum <= 25) return t.floorHigh;
    return t.floorSuper;
  }, [t]);

  // 피벗 테이블 아코디언 지역 확장 상태
  const [expandedRegions, setExpandedRegions] = React.useState<Set<string>>(
    new Set(),
  );

  const toggleRegion = (region: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) {
        next.delete(region);
      } else {
        next.add(region);
      }
      return next;
    });
  };

  // 거래 활성 단지 지역 필터 상태
  const [activeRegionFilter, setActiveRegionFilter] = React.useState<string>("all");

  // 피벗 매트릭스 툴팁 상태 (fixed 포지셔닝)
  const [pivotTooltip, setPivotTooltip] = React.useState<{
    visible: boolean;
    x: number;
    y: number;
    direction: "up" | "down";
    cell: {
      avg: number; median: number; min: number; max: number;
      count: number; complexesSummary: string;
    };
    label: string;
  } | null>(null);

  const handleCellMouseEnter = (
    e: React.MouseEvent<HTMLDivElement>,
    cell: any,
    label: string,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipH = 170; // 예상 툴팁 높이
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction: "up" | "down" = spaceBelow >= tooltipH ? "down" : "up";
    setPivotTooltip({
      visible: true,
      x: rect.left + rect.width / 2,
      y: direction === "down" ? rect.bottom + 6 : rect.top - 6,
      direction,
      cell,
      label,
    });
  };

  const handleCellMouseLeave = () => setPivotTooltip(null);

  // 범례 On/Off 필터 상태 (차트별 독립 설정)
  // 박스플롯 범례 토글 상태 (차트별 독립)
  type BoxVisible = { volume: boolean; whisker: boolean; box: boolean; median: boolean; avg: boolean };
  const defaultVisible: BoxVisible = { volume: true, whisker: false, box: true, median: false, avg: true };
  const [monthlyVisible, setMonthlyVisible] = React.useState<BoxVisible>(defaultVisible);

  // 거래가 활발한 아파트 단지 범례 및 시리즈 On/Off 상태
  const [showComplexLegend, setShowComplexLegend] = React.useState<boolean>(true);
  const [complexSeriesVisible, setComplexSeriesVisible] = React.useState<{
    거래수: boolean;
    평균가: boolean;
  }>({
    거래수: true,
    평균가: true,
  });

  const makeToggle = (setter: React.Dispatch<React.SetStateAction<BoxVisible>>) =>
    (key: keyof BoxVisible) => setter(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleMonthly = makeToggle(setMonthlyVisible);

  const legendItems = [
    { key: "volume"  as const, label: t.boxPlotVolume,  icon: (
      <div className="relative w-3.5 h-2.5 border-t border-x border-dashed rounded-t-sm" style={{ backgroundColor: "var(--color-chart-primary)", borderColor: "var(--color-chart-primary)", opacity: 0.3 }} />
    ) },
    { key: "whisker" as const, label: t.boxPlotWhisker, icon: <span className="inline-block w-0.5 h-3.5" style={{ backgroundColor: "var(--color-semantic-label-neutral)" }} /> },
    { key: "box"     as const, label: t.boxPlotBox,     icon: <span className="inline-block w-3.5 h-2.5 rounded-sm border" style={{ backgroundColor: "var(--color-chart-primary)", borderColor: "var(--color-chart-primary)", opacity: 0.5 }} /> },
    { key: "median"  as const, label: t.boxPlotMedian,  icon: <span className="inline-block w-3.5 h-0.5 rounded" style={{ backgroundColor: "var(--color-chart-median)" }} /> },
    { key: "avg"     as const, label: t.boxPlotAvg,     icon: (
      <div className="relative flex items-center justify-center w-6 h-3">
        <span className="absolute w-full h-0.5" style={{ backgroundColor: "var(--color-chart-accent)" }} />
        <span className="absolute w-2 h-2 rotate-45 shrink-0" style={{ backgroundColor: "var(--color-chart-accent)", border: "1px solid var(--color-semantic-background-elevated-normal)" }} />
      </div>
    ) },
  ];

  const renderLegendHeader = (visible: BoxVisible, onToggle: (k: keyof BoxVisible) => void) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3 select-none">
      {legendItems.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(key)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-all text-[10px] ${
            visible[key]
              ? "bg-slate-100 dark:bg-slate-800 text-strong font-bold"
              : "opacity-35 text-neutral"
          }`}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-neutral">
        <Home size={48} className="mb-3 opacity-30" />
        <p className="text-sm">조회된 실거래 데이터가 없습니다.</p>
        <p className="text-xs mt-1 text-assistive">
          필터 조건을 설정하고 분석 실행 버튼을 눌러주세요.
        </p>
      </div>
    );
  }

  // 1. 전체 실거래 필터 데이터 가공 (필터 분리됨에 따라 원본 data 전체 활용)
  const filteredData = React.useMemo(() => {
    return data;
  }, [data]);

  // 월별 시계열 전용 평형 및 지역 필터 적용 데이터
  const monthlyFilteredData = React.useMemo(() => {
    return data.filter((d) => {
      // 1. 지역구 필터
      if (selectedRegion !== "all") {
        const rName = d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타";
        if (rName !== selectedRegion) return false;
      }
      // 2. 평형 필터
      if (sizeFilter === "all") return true;
      const areaM2 = getAreaValue(d);
      const areaPyeong = areaM2 / 3.305785;
      if (sizeFilter === "under20") return areaPyeong < 20;
      if (sizeFilter === "20s") return areaPyeong >= 20 && areaPyeong < 30;
      if (sizeFilter === "30s") return areaPyeong >= 30 && areaPyeong < 40;
      if (sizeFilter === "40s") return areaPyeong >= 40 && areaPyeong < 50;
      if (sizeFilter === "over50") return areaPyeong >= 50;
      return true;
    });
  }, [data, sizeFilter, selectedRegion, getAreaValue]);

  // 1. 통계 데이터 가공 (전체 기준)
  const totalCount = filteredData.length;
  const prices = filteredData.map((d) => d.priceEok);
  const avgPrice =
    totalCount > 0 ? prices.reduce((sum, p) => sum + p, 0) / totalCount : 0;
  const maxPrice = totalCount > 0 ? Math.max(...prices) : 0;
  const minPrice = totalCount > 0 ? Math.min(...prices) : 0;

  // 2. 월별 시계열 데이터 가공 (최대, 최소, 평균, 중위, 거래량)
  const monthlyDataMap = new Map<string, { count: number; prices: number[] }>();
  monthlyFilteredData.forEach((d) => {
    const month = d.dealDate.substring(0, 7);
    const current = monthlyDataMap.get(month) || { count: 0, prices: [] };
    current.count += 1;
    current.prices.push(d.priceEok);
    monthlyDataMap.set(month, current);
  });

  const monthlyChartData = Array.from(monthlyDataMap.entries())
    .map(([month, val]) => {
      const count = val.count;
      if (count === 0) {
        return {
          name: month,
          volume: 0,
          min: null,
          q1: null,
          median: null,
          q3: null,
          max: null,
          avg: null,
          whiskerRange: null,
          boxRange: null,
        };
      }
      const maxVal = Math.max(...val.prices);
      const minVal = Math.min(...val.prices);
      const sumVal = val.prices.reduce((sum, p) => sum + p, 0);
      const avgVal = sumVal / count;
      const medVal = getMedian(val.prices);
      const q1Val = getPercentile(val.prices, 0.25);
      const q3Val = getPercentile(val.prices, 0.75);

      return {
        name: month,
        volume: count,
        min: Number(minVal.toFixed(1)),
        q1: Number(q1Val.toFixed(1)),
        median: Number(medVal.toFixed(1)),
        q3: Number(q3Val.toFixed(1)),
        max: Number(maxVal.toFixed(1)),
        avg: Number(avgVal.toFixed(1)),
        whiskerRange: [
          Number(minVal.toFixed(1)),
          Number(maxVal.toFixed(1)),
        ] as [number, number],
        boxRange: [Number(q1Val.toFixed(1)), Number(q3Val.toFixed(1))] as [
          number,
          number,
        ],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // 개별 실거래가 점용 데이터셋 (Scatter용 x/y 사용)
  const scatterData = filteredData
    .map((d) => ({
      x: d.dealDate.substring(0, 7),
      y: Number(d.priceEok.toFixed(1)),
      aptName: d.apartmentName,
      dealDate: d.dealDate,
      floor: d.floor,
      areaM2: d.areaM2,
    }))
    .sort((a, b) => a.x.localeCompare(b.x));

  // 3-2. 지역별 & 평형대별 실거래 피벗 매트릭스 데이터 가공
  const activeRegions = React.useMemo(() => {
    const counts = new Map<string, number>();
    filteredData.forEach((d) => {
      const rName = d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타";
      counts.set(rName, (counts.get(rName) || 0) + 1);
    });
    
    const topNames = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
      
    const regionAvgPrices = topNames.map((name) => {
      const regionTransactions = filteredData.filter(
        (d) => (d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타") === name
      );
      const avg = regionTransactions.length > 0 
        ? regionTransactions.reduce((sum, d) => sum + d.priceEok, 0) / regionTransactions.length 
        : 0;
      return { name, avg };
    });

    return regionAvgPrices
      .sort((a, b) => b.avg - a.avg)
      .map((item) => item.name);
  }, [filteredData]);

  const pivotData = React.useMemo(() => {
    const cellMap = new Map<string, {
      prices: number[];
      complexes: Set<string>;
    }>();

    filteredData.forEach((d) => {
      const colKey = d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타";
      if (!activeRegions.includes(colKey)) return;

      const areaVal = getAreaValue(d);
      const rowKey = getSizeCategory(areaVal);

      // 1. 일반 지역별 집계
      const key = `${rowKey}|${colKey}`;
      const cell = cellMap.get(key) || { prices: [], complexes: new Set<string>() };
      cell.prices.push(d.priceEok);
      if (d.apartmentName) {
        cell.complexes.add(d.apartmentName);
      }
      cellMap.set(key, cell);

      // 2. 지역의 층수별 상세 집계
      const floorCat = getFloorCategory(d.floor);
      if (floorCat !== "기타") {
        const floorKey = `${rowKey}|${colKey}|${floorCat}`;
        const floorCell = cellMap.get(floorKey) || { prices: [], complexes: new Set<string>() };
        floorCell.prices.push(d.priceEok);
        if (d.apartmentName) {
          floorCell.complexes.add(d.apartmentName);
        }
        cellMap.set(floorKey, floorCell);
      }
    });

    const data: Record<string, {
      avg: number;
      median: number;
      min: number;
      max: number;
      count: number;
      complexesSummary: string;
    }> = {};

    let maxCount = 0;
    let minAvg = Infinity;
    let maxAvg = -Infinity;

    activeRegions.forEach((colKey) => {
      sizeCategories.forEach((cat) => {
        // 일반 지역 집계 계산
        const key = `${cat}|${colKey}`;
        const cell = cellMap.get(key);
        if (!cell || cell.prices.length === 0) {
          data[key] = { avg: 0, median: 0, min: 0, max: 0, count: 0, complexesSummary: "" };
        } else {
          const pricesArr = cell.prices;
          const count = pricesArr.length;
          if (count > maxCount) maxCount = count;

          const sum = pricesArr.reduce((s, p) => s + p, 0);
          const avg = sum / count;
          const median = getMedian(pricesArr);
          const min = Math.min(...pricesArr);
          const max = Math.max(...pricesArr);

          if (avg < minAvg) minAvg = avg;
          if (avg > maxAvg) maxAvg = avg;

          const complexesArr = Array.from(cell.complexes);
          const complexesSummary = complexesArr.slice(0, 2).join(", ") +
            (complexesArr.length > 2 ? ` 외 ${complexesArr.length - 2}개` : "");

          data[key] = {
            avg: Number(avg.toFixed(1)),
            median: Number(median.toFixed(1)),
            min: Number(min.toFixed(1)),
            max: Number(max.toFixed(1)),
            count,
            complexesSummary
          };
        }

        // 층수 상세 집계 계산
        floorCategories.forEach((floorCat) => {
          const floorKey = `${cat}|${colKey}|${floorCat}`;
          const floorCell = cellMap.get(floorKey);
          if (!floorCell || floorCell.prices.length === 0) {
            data[floorKey] = { avg: 0, median: 0, min: 0, max: 0, count: 0, complexesSummary: "" };
          } else {
            const pricesArr = floorCell.prices;
            const count = pricesArr.length;
            const sum = pricesArr.reduce((s, p) => s + p, 0);
            const avg = sum / count;
            const median = getMedian(pricesArr);
            const min = Math.min(...pricesArr);
            const max = Math.max(...pricesArr);

            if (avg < minAvg) minAvg = avg;
            if (avg > maxAvg) maxAvg = avg;

            const complexesArr = Array.from(floorCell.complexes);
            const complexesSummary = complexesArr.slice(0, 2).join(", ") +
              (complexesArr.length > 2 ? ` 외 ${complexesArr.length - 2}개` : "");

            data[floorKey] = {
              avg: Number(avg.toFixed(1)),
              median: Number(median.toFixed(1)),
              min: Number(min.toFixed(1)),
              max: Number(max.toFixed(1)),
              count,
              complexesSummary
            };
          }
        });
      });
    });

    if (minAvg === Infinity) minAvg = 0;
    if (maxAvg === -Infinity) maxAvg = 0;

    return {
      cells: data,
      maxCount,
      minAvg,
      maxAvg,
    };
  }, [filteredData, activeRegions, areaUnit, getFloorCategory, floorCategories, sizeCategories]);

  // 4. 단지별 거래량 순위 (상위 10개) - 지역 필터 및 상세 통계 통합
  const complexChartData = React.useMemo(() => {
    // 1. 선택된 지역 필터 적용
    const targetData = activeRegionFilter === "all"
      ? filteredData
      : filteredData.filter((d) => {
          const rName = d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타";
          return rName === activeRegionFilter;
        });

    // 2. 단지별 집계 (거래수, 가격 정보)
    const complexStats = new Map<string, {
      count: number;
      prices: number[];
      region: string;
    }>();

    targetData.forEach((d) => {
      const name = d.apartmentName;
      if (!name) return;

      const rName = d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타";
      const stat = complexStats.get(name) || { count: 0, prices: [] as number[], region: rName };
      stat.count += 1;
      stat.prices.push(d.priceEok);
      complexStats.set(name, stat);
    });

    // 3. 탑 10 추출 및 정밀 데이터 가공
    return Array.from(complexStats.entries())
      .map(([name, stat]) => {
        const avgPrice = stat.prices.reduce((s, p) => s + p, 0) / stat.count;
        const maxPrice = Math.max(...stat.prices);
        const minPrice = Math.min(...stat.prices);
        return {
          name,
          거래수: stat.count,
          평균가: Number(avgPrice.toFixed(1)),
          최고가: Number(maxPrice.toFixed(1)),
          최저가: Number(minPrice.toFixed(1)),
          지역: stat.region,
        };
      })
      .sort((a, b) => b.거래수 - a.거래수)
      .slice(0, 10);
  }, [filteredData, activeRegionFilter]);

  // 지역별 색상 정의 (WDS / 시맨틱 디자인 토큰 활용)
  // 평균 실거래가 라인의 색상(var(--color-chart-median), 보라색)과 겹쳐서 안 보이는 문제를 방지하기 위해 
  // 바 차트용 지역 컬러 목록에서 보라색을 제외합니다.
  const CHART_COLORS = React.useMemo(() => [
    "var(--color-chart-primary)", // 파랑
    "var(--color-chart-accent)",  // 주황/노랑
    "var(--color-chart-min)",     // 초록
    "var(--color-chart-floor)",   // 핑크
    "var(--color-chart-max)",     // 빨강
  ], []);

  const uniqueRegionsInChart = React.useMemo(() => {
    const set = new Set<string>();
    complexChartData.forEach((d) => {
      if (d.지역) set.add(d.지역);
    });
    return Array.from(set).sort();
  }, [complexChartData]);

  const regionColorMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    uniqueRegionsInChart.forEach((region, idx) => {
      map[region] = CHART_COLORS[idx % CHART_COLORS.length];
    });
    return map;
  }, [uniqueRegionsInChart, CHART_COLORS]);

  // 5. 평형별 Box Plot 데이터 가공
  // 5. 평형×층수 버블 차트 데이터 가공

  const sizeIdxMap = React.useMemo(() => {
    return new Map(sizeCategories.map((cat, idx) => [cat, idx]));
  }, [sizeCategories]);

  const floorIdxMap = React.useMemo(() => {
    return new Map<string, number>(floorCategories.map((cat, idx) => [cat, idx]));
  }, [floorCategories]);

  const regionBubbleData = React.useMemo(() => {
    const map = new Map<string, Array<{ x: string; y: string; xIdx: number; yIdx: number; z: number; count: number; region: string }>>();
    
    activeRegions.forEach((r) => map.set(r, []));
    
    const groups = new Map<string, { sum: number; count: number }>();
    
    data.forEach((d) => {
      const rName = d.regionName ? d.regionName.split(" ").slice(-1)[0] : "기타";
      if (!activeRegions.includes(rName)) return;
      
      const sizeCat = getSizeCategory(getAreaValue(d));
      const floorCat = getFloorCategory(d.floor);
      if (floorCat === "기타") return;
      
      const groupKey = `${rName}|${sizeCat}|${floorCat}`;
      const current = groups.get(groupKey) || { sum: 0, count: 0 };
      current.sum += d.priceEok;
      current.count += 1;
      groups.set(groupKey, current);
    });
    
    groups.forEach((val, key) => {
      const [rName, sizeCat, floorCat] = key.split("|");
      if (val.count > 0) {
        const avgPrice = val.sum / val.count;
        const arr = map.get(rName) || [];
        const xIdx = sizeIdxMap.get(sizeCat) ?? 0;
        const yIdx = floorIdxMap.get(floorCat) ?? 0;
        arr.push({
          x: sizeCat,
          y: floorCat,
          xIdx,
          yIdx,
          z: Number(avgPrice.toFixed(1)),
          count: val.count,
          region: rName,
        });
        map.set(rName, arr);
      }
    });

    // 각 지역 데이터 리스트를 z(평균 거래가) 기준 내림차순 정렬하여,
    // Scatter 차트 렌더링 시 큰 원이 먼저 아래에 깔리고, 작은 원이 위에 얹히도록 함.
    map.forEach((arr, rName) => {
      arr.sort((a, b) => b.z - a.z);
      map.set(rName, arr);
    });
    
    return map;
  }, [data, activeRegions, getSizeCategory, getFloorCategory, sizeIdxMap, floorIdxMap]);

  // 실제 평수 기준 필터 버튼 옵션
  const sizeOptions = [
    { key: "all" as const, label: "전체" },
    {
      key: "under20" as const,
      label: areaUnit === "pyeong" ? "20평 미만" : "66㎡ 미만",
    },
    { key: "20s" as const, label: areaUnit === "pyeong" ? "20평대" : "66㎡ ~ 99㎡" },
    { key: "30s" as const, label: areaUnit === "pyeong" ? "30평대" : "99㎡ ~ 132㎡" },
    { key: "40s" as const, label: areaUnit === "pyeong" ? "40평대" : "132㎡ ~ 165㎡" },
    {
      key: "over50" as const,
      label: areaUnit === "pyeong" ? "50평 초과" : "165㎡ 초과",
    },
  ] as const;

  const chartFilterSelectors = (
    <div className="flex items-center gap-2">
      {/* 지역구 선택 다운리스트 */}
      <select
        value={selectedRegion}
        onChange={(e) => setSelectedRegion(e.target.value)}
        className="rounded-lg border border-normal bg-normal px-2.5 py-1 text-[9px] md:text-[10px] font-bold text-strong outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary h-7 min-w-[80px]"
      >
        {regionOptions.map((reg) => (
          <option key={reg} value={reg}>
            {reg === "all" ? t.allRegions || "전체 지역" : reg}
          </option>
        ))}
      </select>

      {/* 평형대 필터 */}
      <div className="flex items-center gap-0.5 rounded-lg bg-alternative p-0.5 border border-normal">
        {sizeOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSizeFilter(opt.key)}
            className={`px-2 md:px-3 py-1 text-[9px] md:text-[10px] font-bold rounded-md transition-colors ${
              sizeFilter === opt.key
                ? "bg-primary text-[var(--color-semantic-background-normal-normal)] shadow-sm"
                : "text-neutral hover:text-strong"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );


  return (
    <div className="space-y-6">
      {/* 시계열 메인 차트 */}
      <SectionCard
        title="월별 실거래가 & 거래량 추이"
        right={chartFilterSelectors}
      >
        {renderLegendHeader(monthlyVisible, toggleMonthly)}
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={monthlyChartData}
              margin={{ top: 12, right: 8, left: -10, bottom: 0 }}
            >
              <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} interval="preserveStartEnd" />
              {/* 좌측 Y축: 가격(억) */}
              <YAxis
                yAxisId="left" width={56} stroke="#64748b" fontSize={11} tickLine={false}
                tickFormatter={(v) => `${v}억`}
                domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin * 0.88)), (dataMax: number) => Math.ceil(dataMax * 1.05)]}
              />
              {/* 우측 Y축: 거래수(건) */}
              <YAxis
                yAxisId="right" orientation="right" width={40} stroke="#64748b" fontSize={11} tickLine={false}
                tickFormatter={(v) => `${v}건`}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.3)]}
              />
              <Tooltip content={<BoxPlotTooltip t={t} />} />
              {/* 거래량 배경 Area */}
              <Area yAxisId="right" type="monotone" dataKey="volume"
                fill="var(--color-chart-primary)" fillOpacity={0.06}
                stroke="var(--color-chart-primary)" strokeOpacity={0.15} strokeWidth={1.5}
                hide={!monthlyVisible.volume} />

              {/* Y축 범위를 정확히 감싸기 위한 투명 가이드 Line (토글 여부에 맞춰 도메인 조절) */}
              {monthlyVisible.whisker ? (
                <>
                  <Line yAxisId="left" dataKey="max" stroke="none" dot={false} activeDot={false} legendType="none" />
                  <Line yAxisId="left" dataKey="min" stroke="none" dot={false} activeDot={false} legendType="none" />
                </>
              ) : monthlyVisible.box ? (
                <>
                  <Line yAxisId="left" dataKey="q3" stroke="none" dot={false} activeDot={false} legendType="none" />
                  <Line yAxisId="left" dataKey="q1" stroke="none" dot={false} activeDot={false} legendType="none" />
                </>
              ) : (
                <Line yAxisId="left" dataKey="avg" stroke="none" dot={false} activeDot={false} legendType="none" />
              )}

              {/* 단일 Bar 기반 Box Plot */}
              <Bar
                yAxisId="left"
                dataKey="avg"
                name={t?.avgPriceLabel || "평균가"}
                shape={(barProps: any) => (
                  <BoxPlotShape
                    {...barProps}
                    showWhiskers={monthlyVisible.whisker}
                    showBox={monthlyVisible.box}
                    showMedian={monthlyVisible.median}
                    showMean={false}
                  />
                )}
              />

              {/* 평균가 시계열 라인 */}
              {monthlyVisible.avg && (
                <Line yAxisId="left" type="monotone" dataKey="avg" name={t?.avgPriceLabel || "평균가"} stroke="var(--color-chart-accent)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>



      {/* 지역별·평형대별 실거래 요약 매트릭스 (피벗 시트) */}
      <SectionCard 
        title={t.pivotTableTitle}
        subtitle={t.pivotTableLegend}
      >
        <div className="w-full overflow-x-auto scrollbar-thin mt-4">
          <div
            className="grid min-w-[800px] p-1.5"
            style={{
              gridTemplateColumns: `auto repeat(${sizeCategories.length}, minmax(0, 1fr))`,
              gap: "4px",
            }}
          >
            {/* 좌상단 코너: 구분 텍스트 */}
            <div className="flex items-end justify-start pl-3 pb-1.5">
              <span className="text-[10px] font-bold text-assistive">지역 / 평형</span>
            </div>
            {/* 헤더 컬럼들 */}
            {sizeCategories.map((cat) => (
              <div
                key={cat}
                className="text-center text-[9px] md:text-[10px] font-bold text-neutral pb-1.5 leading-tight flex items-end justify-center"
              >
                {cat.replace("평 이하", "이하").replace("평 초과", "초과")}
              </div>
            ))}

            {/* 데이터 행들 (단일 그리드 내부 형제로 나열) */}
            {activeRegions.map((regionKey) => {
              const isExpanded = expandedRegions.has(regionKey);
              return (
                <React.Fragment key={regionKey}>
                  {/* 행 라벨 (지역명) */}
                  <div
                    className="flex items-center justify-start pl-3 py-1 cursor-pointer hover:text-primary transition-colors group select-none"
                    onClick={() => toggleRegion(regionKey)}
                  >
                    <span className={`inline-block mr-1.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>
                      <svg className="w-3 h-3 text-assistive group-hover:text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                    <span className="text-[10px] md:text-[11px] font-extrabold text-strong whitespace-nowrap">
                      {regionKey}
                    </span>
                  </div>

                  {/* 평형대별 셀 */}
                  {sizeCategories.map((sizeCat) => {
                    const cellKey = `${sizeCat}|${regionKey}`;
                    const cell = pivotData.cells[cellKey];
                    const isEmpty = !cell || cell.count === 0;
                    const tooltipLabel = `${regionKey} (${sizeCat})`;

                    const bgColor = isEmpty
                      ? "rgba(100,116,139,0.08)"
                      : interpolateHeatColor(cell.avg, pivotData.minAvg, pivotData.maxAvg);
                    const textColor = isEmpty
                      ? "var(--color-semantic-label-assistive)"
                      : "#fff";

                    return (
                      <div
                        key={sizeCat}
                        className={`relative rounded-lg flex flex-col items-center justify-center py-2 px-1 transition-transform hover:scale-105 hover:z-10 ${isEmpty ? "cursor-default" : "cursor-help select-none"}`}
                        style={{
                          backgroundColor: bgColor,
                          minHeight: "56px",
                          border: isEmpty
                            ? "1px dashed rgba(100,116,139,0.2)"
                            : "1px solid transparent",
                        }}
                        onMouseEnter={isEmpty ? undefined : (e) => handleCellMouseEnter(e, cell, tooltipLabel)}
                        onMouseLeave={isEmpty ? undefined : handleCellMouseLeave}
                      >
                        {isEmpty ? (
                          <span className="text-[9px]" style={{ color: textColor }}>-</span>
                        ) : (
                          <>
                            <span
                              className="text-[11px] md:text-[12px] font-black leading-none"
                              style={{ color: textColor, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                            >
                              {cell.avg}억
                            </span>
                            <span
                              className="text-[9px] mt-0.5 font-medium leading-none"
                              style={{ color: textColor, opacity: 0.8 }}
                            >
                              {cell.count}건
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* 층수 상세 아코디언 행들 */}
                  {isExpanded && [...floorCategories].reverse().map((floorCat) => (
                    <React.Fragment key={`${regionKey}|${floorCat}`}>
                      {/* 하위 행 라벨 (층수) */}
                      <div className="flex items-center justify-start pl-6 py-1 select-none">
                        <span className="text-[9px] text-assistive mr-1 font-bold">└</span>
                        <span className="text-[10px] font-bold text-neutral whitespace-nowrap">
                          {floorCat}
                        </span>
                      </div>

                      {/* 하위 행 평형대별 셀 */}
                      {sizeCategories.map((sizeCat) => {
                        const cellKey = `${sizeCat}|${regionKey}|${floorCat}`;
                        const cell = pivotData.cells[cellKey];
                        const isEmpty = !cell || cell.count === 0;
                        const tooltipLabel = `${regionKey} (${floorCat}) - ${sizeCat}`;

                        const bgColor = isEmpty
                          ? "rgba(100,116,139,0.08)"
                          : interpolateHeatColor(cell.avg, pivotData.minAvg, pivotData.maxAvg);
                        const textColor = isEmpty
                          ? "var(--color-semantic-label-assistive)"
                          : "#fff";

                        return (
                          <div
                            key={sizeCat}
                            className={`relative rounded-lg flex flex-col items-center justify-center py-2 px-1 transition-transform hover:scale-105 hover:z-10 ${isEmpty ? "cursor-default" : "cursor-help select-none"}`}
                            style={{
                              backgroundColor: bgColor,
                              minHeight: "56px",
                              border: isEmpty
                                ? "1px dashed rgba(100,116,139,0.2)"
                                : "1px solid transparent",
                            }}
                            onMouseEnter={isEmpty ? undefined : (e) => handleCellMouseEnter(e, cell, tooltipLabel)}
                            onMouseLeave={isEmpty ? undefined : handleCellMouseLeave}
                          >
                            {isEmpty ? (
                              <span className="text-[9px]" style={{ color: textColor }}>-</span>
                            ) : (
                              <>
                                <span
                                  className="text-[11px] md:text-[12px] font-black leading-none"
                                  style={{ color: textColor, textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                                >
                                  {cell.avg}억
                                </span>
                                <span
                                  className="text-[9px] mt-0.5 font-medium leading-none"
                                  style={{ color: textColor, opacity: 0.8 }}
                                >
                                  {cell.count}건
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {/* 피벗/히트맵 공용 툴팁 (fixed, viewport 기준 React Portal 렌더링) */}
      {pivotTooltip?.visible && createPortal(
        <div
          className="fixed z-[9999] min-w-[180px] max-w-[240px] p-3.5 rounded-xl border border-normal bg-elevated shadow-xl text-left text-xs space-y-2 pointer-events-none opacity-100"
          style={{
            left: Math.max(110, Math.min(pivotTooltip.x, window.innerWidth - 110)),
            top: pivotTooltip.direction === "down" ? pivotTooltip.y : undefined,
            bottom: pivotTooltip.direction === "up" ? (window.innerHeight - pivotTooltip.y) : undefined,
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-black text-strong border-b border-normal pb-1.5 mb-1.5 text-[13px] truncate text-center">
            {pivotTooltip.label}
          </p>
          <div className="space-y-1.5">
            <p className="text-neutral flex justify-between gap-4">
              <span>총 거래량:</span>
              <span className="font-bold text-strong">{pivotTooltip.cell.count} 건</span>
            </p>
            <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-primary)" }}>
              <span>평균가:</span>
              <span className="font-bold">{pivotTooltip.cell.avg} 억</span>
            </p>
            <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-median)" }}>
              <span>중위값:</span>
              <span className="font-bold">{pivotTooltip.cell.median} 억</span>
            </p>
            {pivotTooltip.cell.min !== undefined && pivotTooltip.cell.max !== undefined && (
              <div className="space-y-1.5">
                <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-min)" }}>
                  <span>최저가:</span>
                  <span className="font-bold">{pivotTooltip.cell.min} 억</span>
                </p>
                <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-max)" }}>
                  <span>최고가:</span>
                  <span className="font-bold">{pivotTooltip.cell.max} 억</span>
                </p>
              </div>
            )}
          </div>
          {pivotTooltip.cell.complexesSummary && (
            <div className="border-t border-normal pt-1.5 mt-1 text-[10px]">
              <span className="text-neutral block font-bold mb-0.5">주요 단지:</span>
              <span className="text-strong block truncate font-medium">
                {pivotTooltip.cell.complexesSummary}
              </span>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* 거래 상위 10개 단지 (단독 1단 넓은 카드로 재배치 및 입체화) */}
      <SectionCard
        title={t.complexActiveRankTitle}
        right={
          <div className="flex flex-wrap gap-1 max-w-[240px] md:max-w-none justify-end">
            <button
              key="all"
              type="button"
              onClick={() => setActiveRegionFilter("all")}
              className={`px-2.5 py-1 rounded-md text-[9px] md:text-[11px] font-bold transition-all ${
                activeRegionFilter === "all"
                  ? "bg-primary text-white shadow-sm"
                  : "bg-alternative text-neutral hover:text-strong border border-normal"
              }`}
            >
              {t.allResults}
            </button>
            {activeRegions.map((region) => (
              <button
                key={region}
                type="button"
                onClick={() => setActiveRegionFilter(region)}
                className={`px-2.5 py-1 rounded-md text-[9px] md:text-[11px] font-bold transition-all ${
                  activeRegionFilter === region
                    ? "bg-primary text-white shadow-sm"
                    : "bg-alternative text-neutral hover:text-strong border border-normal"
                }`}
              >
                {region}
              </button>
            ))}
          </div>
        }
      >
        <div className="mt-2">
          {/* 차트 컨트롤 및 팁 영역 */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 select-none">
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <button
                type="button"
                onClick={() => setShowComplexLegend(!showComplexLegend)}
                className="w-fit px-2.5 py-1 rounded-lg border border-normal bg-alternative hover:bg-elevated text-[10px] font-bold text-neutral transition-all"
              >
                {showComplexLegend ? t.hideLegend : t.showLegend}
              </button>
              <span className="text-[10px] font-bold text-assistive">
                {t.complexClickHint}
              </span>
            </div>

            {/* 범례 아이템 - showComplexLegend가 true일 때만 표시 */}
            {showComplexLegend && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setComplexSeriesVisible(prev => ({ ...prev, 거래수: !prev.거래수 }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all border ${
                    complexSeriesVisible.거래수
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                      : "border-transparent text-assistive line-through"
                  }`}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{
                      backgroundColor: complexSeriesVisible.거래수 ? "var(--color-chart-accent)" : "var(--color-semantic-line-normal-normal)",
                    }}
                  />
                  <span>{t.legendVolume}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setComplexSeriesVisible(prev => ({ ...prev, 평균가: !prev.평균가 }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all border ${
                    complexSeriesVisible.평균가
                      ? "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400"
                      : "border-transparent text-assistive line-through"
                  }`}
                >
                  <div className="relative flex items-center justify-center w-4 h-2.5">
                    <span
                      className="absolute w-full h-0.5"
                      style={{
                        backgroundColor: complexSeriesVisible.평균가 ? "var(--color-chart-median)" : "var(--color-semantic-line-normal-normal)",
                      }}
                    />
                    {complexSeriesVisible.평균가 && (
                      <span className="absolute w-1.5 h-1.5 rotate-45" style={{ backgroundColor: "var(--color-chart-median)" }} />
                    )}
                  </div>
                  <span>{t.legendAvgPrice}</span>
                </button>

                {/* 거래수가 활성화되어 있을 때만 지역별 컬러 뱃지 표시 */}
                {/* 탭처럼 오해되지 않도록 배경(bg)과 테두리(border)를 제거하고 단순 라벨로 렌더링합니다. */}
                {complexSeriesVisible.거래수 && uniqueRegionsInChart.map((region) => (
                  <div
                    key={region}
                    className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-neutral font-semibold select-none"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: regionColorMap[region] }}
                    />
                    <span>{region}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 차트 뷰 */}
          <div className="h-[360px] w-full mt-2 relative">
            {complexChartData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-assistive text-xs">
                {t.noActiveComplexData}
              </div>
            ) : !complexSeriesVisible.거래수 && !complexSeriesVisible.평균가 ? (
              <div className="absolute inset-0 flex items-center justify-center text-assistive text-xs">
                {t.noActiveChartData}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={complexChartData}
                  margin={{ top: 15, right: 15, left: 15, bottom: 25 }}
                >
                  <CartesianGrid stroke="none" />
                  <XAxis
                    dataKey="name"
                    stroke="#64748b"
                    fontSize={10}
                    tickLine={false}
                    interval={0}
                    height={100}
                    tick={(props: any) => {
                      const { x, y, payload } = props;
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text
                            x={0}
                            y={0}
                            dy={12}
                            dx={-4}
                            textAnchor="end"
                            fill="var(--color-semantic-label-neutral)"
                            fontSize={isNarrow ? 9 : 10}
                            fontWeight="bold"
                            transform="rotate(-90)"
                            className="cursor-pointer hover:fill-primary transition-colors"
                            onClick={() => onSelectComplex && onSelectComplex(payload.value)}
                          >
                            {payload.value}
                          </text>
                        </g>
                      );
                    }}
                  />
                  {complexSeriesVisible.거래수 && (
                    <YAxis
                      yAxisId="left"
                      stroke="var(--color-chart-accent)"
                      fontSize={10}
                      tickLine={false}
                      width={40}
                      label={{
                        value: t.axisVolume,
                        angle: -90,
                        position: "insideLeft",
                        offset: 5,
                        style: { fontSize: 10, fill: "var(--color-chart-accent)", fontWeight: "bold" }
                      }}
                    />
                  )}
                  {complexSeriesVisible.평균가 && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="var(--color-chart-median)"
                      fontSize={10}
                      tickLine={false}
                      width={40}
                      label={{
                        value: t.axisAvgPrice,
                        angle: 90,
                        position: "insideRight",
                        offset: 5,
                        style: { fontSize: 10, fill: "var(--color-chart-median)", fontWeight: "bold" }
                      }}
                    />
                  )}
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                          <div className="p-3.5 rounded-xl border border-normal bg-elevated shadow-xl text-xs space-y-2 pointer-events-none">
                            <p className="font-extrabold text-strong border-b border-normal pb-1">{d.name}</p>
                            <p className="text-[10px] text-assistive font-bold">지역: {d.지역}</p>
                            <div className="space-y-1 pt-1">
                              <p className="flex justify-between gap-4 text-neutral">
                                <span>총 거래수:</span>
                                <span className="font-bold">{d.거래수}건</span>
                              </p>
                              <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-median)" }}>
                                <span>평균 거래가:</span>
                                <span className="font-bold">{d.평균가}억</span>
                              </p>
                              <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-max)" }}>
                                <span>최고 실거래가:</span>
                                <span className="font-bold">{d.최고가}억</span>
                              </p>
                              <p className="flex justify-between gap-4" style={{ color: "var(--color-chart-min)" }}>
                                <span>최저 실거래가:</span>
                                <span className="font-bold">{d.최저가}억</span>
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  {complexSeriesVisible.거래수 && (
                    <Bar
                      yAxisId="left"
                      dataKey="거래수"
                      barSize={16}
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      fillOpacity={0.85}
                      onClick={(data: any) => {
                        if (data && data.name && onSelectComplex) {
                          onSelectComplex(data.name);
                        }
                      }}
                    >
                      {complexChartData.map((entry, index) => {
                        const color = regionColorMap[entry.지역] || "var(--color-chart-accent)";
                        return (
                          <Cell
                            key={`cell-${index}`}
                            fill={color}
                          />
                        );
                      })}
                    </Bar>
                  )}
                  {complexSeriesVisible.평균가 && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="평균가"
                      stroke="var(--color-chart-median)"
                      strokeWidth={3}
                      activeDot={{ r: 6, stroke: "var(--color-semantic-background-elevated-normal)", strokeWidth: 2 }}
                      dot={{ cursor: "pointer", r: 4, stroke: "var(--color-semantic-background-elevated-normal)", strokeWidth: 1.5 }}
                      onClick={(data: any) => {
                        const name = data?.name || data?.activeLabel || data?.payload?.name;
                        if (name && onSelectComplex) {
                          onSelectComplex(name);
                        }
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
