import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Bar
} from "recharts";
import { loadComplexDetail } from "../../api";
import { SectionCard } from "../../components/SectionCard";
import { StatCard } from "../../components/StatCard";
import { useBreakpoint } from "../../useBreakpoint";
import { useKakaoMap } from "../../useKakaoMap";
import { Home, Calendar, DollarSign, Layers, MapPin, Train, ShoppingBag, School, Activity, Clock, Navigation, ArrowUpDown, TrendingUp, HelpCircle, X } from "lucide-react";


const i18n = {
  ko: {
    selectComplex: "상위 필터에서 분석할 단지를 선택해 주세요.",
    noData: "선택한 면적대 조건의 실거래 데이터가 없습니다.",
    detailReport: "단지 전용 분석 리포트",
    allArea: "전체",
    monthlyTrendTitle: "📈 월별 평균 가격 추이 (평균 억)",
    overallAvg: "전체 평균",
    complexOverallAvg: "단지 전체 평균",
    areaAnalysisTitle: "📐 평형별 거래 분석 (평균가 & 거래량)",
    floorAnalysisTitle: "🏢 층별 거래 분석 (거래량 & 평균가)",
    avgPrice: "평균가",
    txCount: "거래량",
    eokUnit: "억",
    countUnit: "건",
    floorUnit: "층",
    recentTxTitle: "📋 최근 실거래 내역 (최대 10건)",
    dealDate: "거래일",
    dealPrice: "거래가",
    exclusiveArea: "전용면적",
    floor: "층",
    recentAvgPrice: "최근 월 평균가",
    yoyChange: "전년동월비 (YoY)",
    yoyNoData: "전년동월 거래 없음",
    pastYearVolume: "최근 1년 거래량",
    allTimeHigh: "역대 최고가",
    maxPrice: "최대값",
    minPrice: "최소값",
    q1Price: "Q1",
    q3Price: "Q3",
    medianPrice: "중위값",
    box: "박스",
    infraRatingTitle: "⭐ 단지 주변 입지 평가 리포트",
    infraRatingSubtitle: "반경 1km 이내의 핵심 생활 인프라 시설의 최단 거리 및 개수를 가중치 분석하여 산출한 종합 평가 점수입니다.",
    infraTotalScore: "종합 평가 점수",
    infraGrade: "입지 등급",
    infraCategory: "인프라 부문",
    infraScore: "부문 점수",
    infraCount: "시설 개수",
    infraMinDistance: "최단 거리",
    infraWalkMin: "도보 약 {min}분",
    infraMockNotice: "⚠️ 카카오 API 키가 설정되지 않아 샘플 입지 데이터로 표시 중입니다.",
    infraCategorySchool: "학교 (SC4)",
    infraCategoryHospital: "병원 (HP8)",
    infraCategoryMart: "대형마트 (MT1)",
    infraCategoryPharmacy: "약국 (PM9)",
    infraCategoryConvStore: "편의점 (CS2)",
    infraCategorySubway: "역세권 (SW8)",
    infraDetailGeneralHospital: "종합/대학병원",
    infraDetailLocalClinic: "일반 병/의원",
    infraDetailLargeMart: "대형마트",
    infraDetailSSM: "대형슈퍼(SSM)",
    infraDetailElementary: "초등학교",
    infraDetailMiddle: "중학교",
    infraDetailHigh: "고등학교",
    infraDetailMetro: "지하철(일반)",
    infraDetailGtx: "GTX",
    infraDetailRail: "광역/고속철도(기차)",
    infraDetailPharmacy: "약국",
    infraDetailConvStore: "편의점",
    
    // 입지 평가 정보 모달 번역
    infraModalTitle: "📊 입지 평가 점수 산출 기준",
    infraModalIntro: "본 입지 평가는 국토교통부 실거래 데이터의 단지 좌표를 기준으로, 카카오 Local API를 통해 실시간 조회한 반경 내 인프라(최단 거리)를 가중 평균하여 산출합니다.",
    infraModalFormulaTitle: "1. 부문별 평점 계산식",
    infraModalFormulaDesc: "각 인프라의 평점(0~100점)은 최단 거리 점수(100%)로 계산됩니다.",
    infraModalFormulaMath: "부문 점수 = 최단거리 점수",
    infraModalRadiusTitle: "2. 시설별 특화 반경 및 거리 감점 기준",
    infraModalRadiusDesc: "생활 밀착도에 따른 전용 반경 내에서 가까울수록 고득점을 획득합니다 (반경 초과 시 0점).",
    infraModalSubwayDesc: "역세권 (반경 1000m): 250m 이내 100점, 500m 이내 85점, 1000m 이내 60점",
    infraModalSchoolDesc: "학교 (반경 500m): 150m 이내 100점, 300m 이내 85점, 500m 이내 60점",
    infraModalHospitalDesc: "병원 (반경 1000m): 300m 이내 100점, 500m 이내 80점, 1000m 이내 50점",
    infraModalMartDesc: "대형마트 (반경 1500m): 500m 이내 100점, 1000m 이내 80점, 1500m 이내 50점",
    infraModalPharmacyDesc: "약국 (반경 500m): 100m 이내 100점, 300m 이내 80점, 500m 이내 50점",
    infraModalConvDesc: "편의점 (반경 300m): 50m 이내 100점, 150m 이내 80점, 300m 이내 50점",
    infraModalCountTitle: "3. 시설 개수 점수 (밀집도)",
    infraModalCountDesc: "반경 내 시설 1개당 20점이 부여되며, 5개 이상일 시 만점(100점)을 획득합니다 (최대 20점 기여).",
    infraModalWeightTitle: "3. 종합 등급 가중치 기준",
    infraModalWeightDesc: "주거 선호도에 따라 가중 평균하여 최종 등급(S~D)을 산출합니다.",
    infraModalWeightList: "역세권 (1.5) > 학교 (1.0) > 병원 (0.8) > 대형마트 (0.7)",
    close: "닫기"
  },
  en: {
    selectComplex: "Please select a complex to analyze in the filter panel above.",
    noData: "No transaction data found for the selected area filter.",
    detailReport: "Complex Analysis Report",
    allArea: "All",
    monthlyTrendTitle: "📈 Monthly Average Price Trend (Avg in 100M KRW)",
    overallAvg: "Overall Avg",
    complexOverallAvg: "Complex Overall Avg",
    areaAnalysisTitle: "📐 Size Analysis (Avg Price & Volume)",
    floorAnalysisTitle: "🏢 Floor Analysis (Volume & Avg Price)",
    avgPrice: "Avg Price",
    txCount: "Volume",
    eokUnit: "100M",
    countUnit: "deals",
    floorUnit: "F",
    recentTxTitle: "📋 Recent Transactions (Max 10)",
    dealDate: "Deal Date",
    dealPrice: "Deal Price",
    exclusiveArea: "Size",
    floor: "Floor",
    recentAvgPrice: "Recent Monthly Avg",
    yoyChange: "YoY Change",
    yoyNoData: "No YoY Data",
    pastYearVolume: "Past 1Year Volume",
    allTimeHigh: "All-time High",
    maxPrice: "Max",
    minPrice: "Min",
    q1Price: "Q1",
    q3Price: "Q3",
    medianPrice: "Median",
    box: "Box",
    infraRatingTitle: "⭐ Nearby Location Infrastructure Rating Report",
    infraRatingSubtitle: "Overall location score calculated based on weighted analysis of the shortest distance and quantity of key living infrastructures within a 1km radius.",
    infraTotalScore: "Overall Score",
    infraGrade: "Grade",
    infraCategory: "Category",
    infraScore: "Score",
    infraCount: "Count",
    infraMinDistance: "Min Distance",
    infraWalkMin: "Walk ~{min}m",
    infraMockNotice: "⚠️ Displaying sample infrastructure data because Kakao API key is not configured.",
    infraCategorySchool: "School (SC4)",
    infraCategoryHospital: "Hospital (HP8)",
    infraCategoryMart: "Mart (MT1)",
    infraCategoryPharmacy: "Pharmacy (PM9)",
    infraCategoryConvStore: "Conv. Store (CS2)",
    infraCategorySubway: "Station Area (SW8)",
    infraDetailGeneralHospital: "General/Univ. Hospital",
    infraDetailLocalClinic: "Local Clinic",
    infraDetailLargeMart: "Large Mart",
    infraDetailSSM: "SSM Supermarket",
    infraDetailElementary: "Elementary School",
    infraDetailMiddle: "Middle School",
    infraDetailHigh: "High School",
    infraDetailMetro: "Subway (Metro)",
    infraDetailGtx: "GTX",
    infraDetailRail: "Rail/Train",
    infraDetailPharmacy: "Pharmacy",
    infraDetailConvStore: "Convenience Store",
    
    // Infrastructure rating modal translations
    infraModalTitle: "📊 Location Score Calculation Standards",
    infraModalIntro: "This location score is calculated by weighted averaging of nearby infrastructures (distance) queried via Kakao Local API.",
    infraModalFormulaTitle: "1. Category Score Formula",
    infraModalFormulaDesc: "Each infrastructure score (0-100) is calculated based on the shortest distance score (100%).",
    infraModalFormulaMath: "Category Score = Distance Score",
    infraModalRadiusTitle: "2. Specific Radius & Distance Penalty",
    infraModalRadiusDesc: "Points decrease as distance increases within the specialized radius (0 points if outside).",
    infraModalSubwayDesc: "Station Area (Radius 1000m): <=250m 100pts, <=500m 85pts, <=1000m 60pts",
    infraModalSchoolDesc: "School (Radius 500m): <=150m 100pts, <=300m 85pts, <=500m 60pts",
    infraModalHospitalDesc: "Hospital (Radius 1000m): <=300m 100pts, <=500m 80pts, <=1000m 50pts",
    infraModalMartDesc: "Mart (Radius 1500m): <=500m 100pts, <=1000m 80pts, <=1500m 50pts",
    infraModalPharmacyDesc: "Pharmacy (Radius 500m): <=100m 100pts, <=300m 80pts, <=500m 50pts",
    infraModalConvDesc: "Conv. Store (Radius 300m): <=50m 100pts, <=150m 80pts, <=300m 50pts",
    infraModalCountTitle: "3. Density Score",
    infraModalCountDesc: "Each facility within the radius gives 20pts, up to 100pts for 5+ facilities (contributing up to 20pts to final score).",
    infraModalWeightTitle: "3. Weighted Average for Final Grade",
    infraModalWeightDesc: "Infrastructures are weighted according to residential preference to calculate the overall grade (S to D).",
    infraModalWeightList: "Station Area (1.5) > School (1.0) > Hospital (0.8) > Mart (0.7)",
    close: "Close"
  }
};

const currentLang: "ko" | "en" = (navigator.language.startsWith("ko") ? "ko" : "en") as "ko" | "en";
const t = (key: keyof typeof i18n["ko"]) => i18n[currentLang][key];

const tooltipContentStyle = {
  backgroundColor: "var(--color-semantic-background-elevated-normal)",
  border: "1px solid var(--color-semantic-line-normal-normal)",
  borderRadius: "8px",
  color: "var(--color-semantic-label-strong)",
  fontSize: "12px",
};

const lineColors = [
  "var(--color-chart-min)",
  "var(--color-chart-primary)",
  "var(--color-chart-accent)",
  "var(--color-chart-floor)",
  "var(--color-chart-median)",
  "var(--color-semantic-primary-normal)",
  "var(--color-chart-max)"
];

interface ComplexTabProps {
  initialComplexName?: string;
  lawdCode?: string;
  areaUnit?: "pyeong" | "m2";
  areaType?: "supply" | "dedicated";
  startDate?: string;
  endDate?: string;
}

const BoxPlotShape = (props: any) => {
  const { x, y, width, height, payload, yAxis, showWhiskers = true, showBox = true, showMedian = true, showMean = true } = props;
  if (!payload) return null;

  const min = payload.min;
  const max = payload.max;
  const q1 = payload.q1;
  const q3 = payload.q3;
  const median = payload.median;
  const mean = payload.mean;

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
    // yAxis가 주어지지 않았을 때의 수학적 Fallback 보간
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

const BoxPlotTooltip = ({ active, payload, label, unit, type }: any) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  if (!data) return null;

  const title = type === "area"
    ? (unit === "pyeong" ? `${Math.round(parseFloat(label) / 3.305785)}평 (${Math.round(parseFloat(label))}㎡)` : `${Math.round(parseFloat(label))}㎡`)
    : `${label}층`;

  const lang = (navigator.language.startsWith("ko") ? "ko" : "en") as "ko" | "en";
  const labelMax = i18n[lang].maxPrice;
  const labelQ3 = i18n[lang].q3Price;
  const labelMean = i18n[lang].avgPrice;
  const labelMedian = i18n[lang].medianPrice;
  const labelQ1 = i18n[lang].q1Price;
  const labelMin = i18n[lang].minPrice;
  const labelCount = i18n[lang].countUnit;
  const labelEok = i18n[lang].eokUnit;

  return (
    <div className="bg-elevated border border-normal rounded-xl p-3 shadow-lg min-w-[190px] text-xs space-y-2 backdrop-blur-md bg-opacity-95">
      <div className="font-bold text-strong pb-1 border-b border-normal flex justify-between items-center">
        <span>{title}</span>
        <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
          {data.count || 0}{labelCount}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-neutral font-medium">
        <div className="flex items-center gap-1.5 justify-between">
          <span className="text-assistive">{labelMax}:</span>
          <span className="font-mono text-strong font-bold">{(data.max || 0).toFixed(2)}{labelEok}</span>
        </div>
        <div className="flex items-center gap-1.5 justify-between">
          <span className="text-assistive">{labelQ3} (75%):</span>
          <span className="font-mono text-strong">{(data.q3 || 0).toFixed(2)}{labelEok}</span>
        </div>
        <div className="flex items-center gap-1.5 justify-between">
          <span className="text-assistive">{labelMean}:</span>
          <span className="font-mono text-primary font-bold">{(data.mean || 0).toFixed(2)}{labelEok}</span>
        </div>
        <div className="flex items-center gap-1.5 justify-between">
          <span className="text-assistive">{labelMedian}:</span>
          <span className="font-mono text-strong font-semibold">{(data.median || 0).toFixed(2)}{labelEok}</span>
        </div>
        <div className="flex items-center gap-1.5 justify-between">
          <span className="text-assistive">{labelQ1} (25%):</span>
          <span className="font-mono text-strong">{(data.q1 || 0).toFixed(2)}{labelEok}</span>
        </div>
        <div className="flex items-center gap-1.5 justify-between">
          <span className="text-assistive">{labelMin}:</span>
          <span className="font-mono text-strong font-bold">{(data.min || 0).toFixed(2)}{labelEok}</span>
        </div>
      </div>
    </div>
  );
};

export default function ComplexTab({
  initialComplexName = "",
  lawdCode,
  areaUnit = "pyeong",
  areaType = "supply",
  startDate,
  endDate,
}: ComplexTabProps) {
  const formatSizeString = (sizeStr: string, unit: "pyeong" | "m2") => {
    let num = parseFloat(sizeStr);
    if (isNaN(num)) return sizeStr;

    if (areaType === "supply" && detailData?.areaBreakdown) {
      const cleanSize = sizeStr.endsWith("㎡") ? sizeStr : `${Math.round(num)}㎡`;
      const matched = detailData.areaBreakdown.find((b: any) => b.area === cleanSize);
      if (matched && matched.supplyArea) {
        num = parseFloat(matched.supplyArea);
      } else {
        num = num / 0.78; // fallback
      }
    }

    if (unit === "pyeong") {
      return `${Math.round(num / 3.305785)}평`;
    }
    return `${Math.round(num)}㎡`;
  };
  const { isNarrow } = useBreakpoint();
  const [complexName, setComplexName] = useState(initialComplexName);
  const [selectedArea, setSelectedArea] = useState<number | undefined>(undefined);
  const [availableSizes, setAvailableSizes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [error, setError] = useState("");
  const [cache, setCache] = useState<Record<string, any>>({});
  const [hiddenKeys, setHiddenKeys] = useState<Record<string, boolean>>({});
  const [areaHiddenKeys, setAreaHiddenKeys] = useState<Record<string, boolean>>({});
  const [floorHiddenKeys, setFloorHiddenKeys] = useState<Record<string, boolean>>({
    "최대/최소": true
  });
  const [showInfoModal, setShowInfoModal] = useState(false);

  const toggleKey = (key: string) => {
    setHiddenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAreaKey = (key: string) => {
    setAreaHiddenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleFloorKey = (key: string) => {
    setFloorHiddenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 카카오맵 관련 상태 및 레프
  const { loaded: mapSdkLoaded } = useKakaoMap();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [infraMarkers, setInfraMarkers] = useState<any[]>([]);
  const [activeInfraFilter, setActiveInfraFilter] = useState<string | null>(null);

  // 도보/차량 시간 계산 헬퍼 함수
  const getTravelTime = (distanceM: number) => {
    // 도보: 분당 80m 속도 가정 (시속 약 4.8km)
    const walkMin = Math.max(1, Math.round(distanceM / 80));
    // 차량: 분당 500m 속도 가정 (시속 30km)
    const carMin = Math.max(1, Math.round(distanceM / 500));
    return { walkMin, carMin };
  };

  // 인프라 카테고리 정의
  const infraCategories = [
    { code: 'MT1', label: '대형마트', icon: ShoppingBag },
    { code: 'CS2', label: '편의점', icon: ShoppingBag },
    { code: 'SC4', label: '학교', icon: School },
    { code: 'HP8', label: '병원', icon: Activity },
    { code: 'PM9', label: '약국', icon: Activity }
  ];

  // 지도 인스턴스 생성 및 단지/지하철 마커/반경 원 표시
  useEffect(() => {
    if (!mapSdkLoaded || !detailData?.complexInfo || !mapContainerRef.current) return;

    const { lat, lng } = detailData.complexInfo;
    if (lat === null || lng === null) return;

    const container = mapContainerRef.current;
    const complexPosition = new window.kakao.maps.LatLng(lat, lng);
    const options = {
      center: complexPosition,
      level: 5 // 반경 1km가 원활히 보이도록 레벨 5 설정
    };

    const map = new window.kakao.maps.Map(container, options);
    setMapInstance(map);

    // 1. 단지 마커 표시
    const complexMarker = new window.kakao.maps.Marker({
      position: complexPosition,
      map: map,
      title: detailData.complexInfo.name
    });

    const complexOverlay = new window.kakao.maps.CustomOverlay({
      position: complexPosition,
      content: `<div style="background-color:var(--color-semantic-background-elevated-normal); border:1px solid var(--color-semantic-line-normal-normal); border-radius:8px; padding:6px 12px; font-size:12px; font-weight:700; color:var(--color-semantic-label-strong); box-shadow:0 2px 4px rgba(0,0,0,0.12); margin-top:-46px; text-align:center; min-width:120px;">🏢 ${detailData.complexInfo.name}</div>`,
      yAnchor: 1
    });
    complexOverlay.setMap(map);

    // 2. 반경 원 500m, 1km 표시
    const circleRadii = [
      { r: 500, color: '#3b82f6', opacity: 0.08 },
      { r: 1000, color: '#10b981', opacity: 0.05 }
    ];

    const circleInstances = circleRadii.map((c) => {
      const circle = new window.kakao.maps.Circle({
        center: complexPosition,
        radius: c.r,
        strokeWeight: 1.5,
        strokeColor: c.color,
        strokeOpacity: 0.5,
        strokeStyle: 'dashed',
        fillColor: c.color,
        fillOpacity: c.opacity
      });
      circle.setMap(map);
      return circle;
    });

    // 3. 인근 지하철역 마커 및 커스텀 오버레이 표시
    const subwayMarkers = (detailData.subways || []).map((sub: any) => {
      const subPosition = new window.kakao.maps.LatLng(sub.lat, sub.lng);
      const marker = new window.kakao.maps.Marker({
        position: subPosition,
        map: map,
        title: sub.name
      });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: subPosition,
        content: `<div style="background-color:var(--color-semantic-background-elevated-normal); border:1px solid var(--color-semantic-line-normal-normal); border-radius:12px; padding:3px 8px; font-size:10px; font-weight:700; color:var(--color-semantic-label-strong); box-shadow:0 2px 4px rgba(0,0,0,0.12); margin-top:-38px;">🚇 ${sub.name}</div>`,
        yAnchor: 1
      });
      overlay.setMap(map);

      return { marker, overlay };
    });

    // Clean up
    return () => {
      complexMarker.setMap(null);
      complexOverlay.setMap(null);
      circleInstances.forEach(c => c.setMap(null));
      subwayMarkers.forEach((s: any) => {
        s.marker.setMap(null);
        s.overlay.setMap(null);
      });
    };
  }, [mapSdkLoaded, detailData?.complexInfo, detailData?.subways]);

  // 주변 인프라 필터 토글
  const handleInfraFilterToggle = (categoryCode: string) => {
    if (!mapInstance || !window.kakao || !detailData?.complexInfo) return;

    // 기존 인프라 마커들 지도에서 제거
    infraMarkers.forEach(item => {
      item.marker.setMap(null);
      if (item.overlay) item.overlay.setMap(null);
    });
    setInfraMarkers([]);

    // 현재 활성화된 인프라 필터를 다시 누른 경우 해제
    if (activeInfraFilter === categoryCode) {
      setActiveInfraFilter(null);
      return;
    }

    setActiveInfraFilter(categoryCode);

    const { lat, lng } = detailData.complexInfo;
    const ps = new window.kakao.maps.services.Places(mapInstance);

    ps.categorySearch(categoryCode, (data: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const newMarkers = data.map((place: any) => {
          const placePos = new window.kakao.maps.LatLng(place.y, place.x);
          const marker = new window.kakao.maps.Marker({
            position: placePos,
            map: mapInstance,
            title: place.place_name
          });

          // 편의시설 이름 표시용 오버레이
          const overlay = new window.kakao.maps.CustomOverlay({
            position: placePos,
            content: `<div style="background-color:var(--color-semantic-background-normal-normal); border:1px solid var(--color-semantic-line-normal-normal); border-radius:4px; padding:2px 6px; font-size:9px; color:var(--color-semantic-label-strong); box-shadow:0 1px 2px rgba(0,0,0,0.15); margin-top:-32px;">${place.place_name}</div>`,
            yAnchor: 1
          });
          overlay.setMap(mapInstance);

          return { marker, overlay };
        });
        setInfraMarkers(newMarkers);
      }
    }, {
      location: new window.kakao.maps.LatLng(lat, lng),
      radius: 1000, // 인프라는 실용적 접근을 위해 1km 반경으로 필터링
      sort: window.kakao.maps.services.SortBy.DISTANCE
    });
  };


  // 트렌드 데이터 내 존재하는 모든 평수 키 수집
  const trendSizes = React.useMemo(() => {
    if (!detailData?.trend || detailData.trend.length === 0) return [];
    const keys = new Set<string>();
    detailData.trend.forEach((item: any) => {
      Object.keys(item).forEach((key) => {
        if (key.endsWith("㎡")) {
          keys.add(key);
        }
      });
    });
    return Array.from(keys).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
  }, [detailData]);

  // 실거래 내역을 날짜별로 그룹화 (화면 영역 축소 및 일자별 묶음 조회 목적)
  // 4개 KPI 요약 정보 연산
  const kpiData = React.useMemo(() => {
    if (!detailData?.trend || detailData.trend.length === 0) {
      return null;
    }
    const trend = detailData.trend;
    const latest = trend[trend.length - 1];
    if (!latest) return null;

    // 1. 최근 월 평균가
    const latestAvg = latest.평균가 || 0;
    const latestMonth = latest.month || "";

    // 2. 전년동월비 (YoY)
    let yoyDiff = 0;
    let yoyPercent = 0;
    let hasYoy = false;
    let yoyMonthStr = "";
    
    if (latestMonth) {
      const [year, month] = latestMonth.split("-");
      const targetYear = parseInt(year) - 1;
      yoyMonthStr = `${targetYear}-${month}`;
      const yoyData = trend.find((d: any) => d.month === yoyMonthStr);
      if (yoyData && yoyData.평균가) {
        yoyDiff = latestAvg - yoyData.평균가;
        yoyPercent = (yoyDiff / yoyData.평균가) * 100;
        hasYoy = true;
      }
    }

    // 3. 최근 1년 거래량 (최근 월 기준 12개월 범위 내)
    let pastYearVolume = 0;
    if (latestMonth) {
      const [year, month] = latestMonth.split("-").map(Number);
      let startYear = year;
      let startMonth = month - 11;
      if (startMonth <= 0) {
        startYear -= 1;
        startMonth += 12;
      }
      const startMonthStr = `${startYear}-${String(startMonth).padStart(2, '0')}`;
      pastYearVolume = trend
        .filter((d: any) => d.month >= startMonthStr && d.month <= latestMonth)
        .reduce((sum: number, d: any) => sum + (d.거래량 || 0), 0);
    }

    // 4. 역대 최고가
    let maxPrice = 0;
    let maxMonth = "";
    trend.forEach((d: any) => {
      if (d.최대가 && d.최대가 > maxPrice) {
        maxPrice = d.최대가;
        maxMonth = d.month;
      }
    });

    return {
      latestAvg,
      latestMonth,
      hasYoy,
      yoyDiff,
      yoyPercent,
      yoyMonthStr,
      pastYearVolume,
      maxPrice,
      maxMonth
    };
  }, [detailData?.trend]);

  // 실거래 내역을 날짜별로 그룹화 (화면 영역 축소 및 일자별 묶음 조회 목적)
  const groupedTx = React.useMemo(() => {
    if (!detailData?.recentTx || detailData.recentTx.length === 0) return [];
    const groups: { dealDate: string; items: any[] }[] = [];
    detailData.recentTx.forEach((tx: any) => {
      let g = groups.find(x => x.dealDate === tx.dealDate);
      if (!g) {
        g = { dealDate: tx.dealDate, items: [] };
        groups.push(g);
      }
      g.items.push(tx);
    });
    return groups;
  }, [detailData?.recentTx]);

  const fetchDetail = async (name: string, area?: number) => {
    if (!name.trim()) return;
    const cacheKey = `${name}_${area !== undefined ? area : "all"}_${startDate ?? ""}_${endDate ?? ""}`;

    if (cache[cacheKey]) {
      setDetailData(cache[cacheKey]);
      setComplexName(name);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await loadComplexDetail(name, lawdCode, area, startDate, endDate);
      setCache((prev) => ({ ...prev, [cacheKey]: res }));
      setDetailData(res);
      setComplexName(name);

      // "전체" 조회인 경우 실제 존재하는 모든 평수 목록 수집
      if (area === undefined) {
        const sizes = res.areaBreakdown.map((b: any) => b.area);
        // 숫자 오름차순 정렬 (예: "59㎡" -> 59, "114㎡" -> 114)
        sizes.sort((a: string, b: string) => {
          const numA = parseInt(a) || 0;
          const numB = parseInt(b) || 0;
          return numA - numB;
        });
        setAvailableSizes(sizes);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "단지 상세 데이터를 불러오지 못했습니다.");
      setDetailData(null);
    } finally {
      setLoading(false);
    }
  };

  // 단지명 변경 시 필터, 사이즈 목록 및 캐시 초기화
  useEffect(() => {
    setSelectedArea(undefined);
    setAvailableSizes([]);
    setCache({});
  }, [initialComplexName]);

  // 단지명 또는 면적 필터 변경 시 상세 데이터 로드
  useEffect(() => {
    if (initialComplexName) {
      fetchDetail(initialComplexName, selectedArea);
    } else {
      setDetailData(null);
      setComplexName("");
    }
  }, [initialComplexName, selectedArea, lawdCode, startDate, endDate]);

  // 빈 상태
  if (!initialComplexName && !loading && !detailData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-elevated border border-normal rounded-xl text-neutral">
        <Home size={48} className="mb-3 opacity-30" />
        <p className="text-sm">{t("selectComplex")}</p>
      </div>
    );
  }

  // 로딩 상태
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 bg-elevated border border-normal rounded-xl">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-elevated border border-normal rounded-xl text-neutral">
        <Home size={48} className="mb-3 opacity-30" />
        <p className="text-sm text-warn">{error}</p>
      </div>
    );
  }

  if (!detailData) return null;

  return (
    <div className="space-y-6">
      {/* 단지 정보 & 크기 퀵 필터 탭 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 border-primary pl-4 py-1">
        <div>
          <h2 className="text-lg font-bold text-strong">{complexName}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <p className="text-xs text-neutral">{t("detailReport")}</p>
            {detailData?.infraRating && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${
                detailData.infraRating.grade === "S" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                detailData.infraRating.grade === "A" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                detailData.infraRating.grade === "B" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                detailData.infraRating.grade === "C" ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
                "bg-rose-500/10 text-rose-500 border-rose-500/20"
              }`}>
                {detailData.infraRating.grade}등급 ({detailData.infraRating.totalScore}점)
              </span>
            )}
          </div>
          {detailData?.complexInfo && (detailData.complexInfo.totalHouseholds || detailData.complexInfo.parkingPerHousehold || detailData.complexInfo.useApprovalDate) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[10px] font-bold text-neutral">
              {detailData.complexInfo.totalHouseholds && (
                <span className="flex items-center gap-1 bg-alternative border border-normal px-2 py-0.5 rounded-md">
                  🏠 {detailData.complexInfo.totalHouseholds.toLocaleString()}세대
                </span>
              )}
              {detailData.complexInfo.parkingPerHousehold && (
                <span className="flex items-center gap-1 bg-alternative border border-normal px-2 py-0.5 rounded-md" title={`총 주차대수: ${detailData.complexInfo.totalParking}대`}>
                  🚗 주차 {detailData.complexInfo.parkingPerHousehold}대
                </span>
              )}
              {detailData.complexInfo.useApprovalDate && (
                <span className="flex items-center gap-1 bg-alternative border border-normal px-2 py-0.5 rounded-md">
                  📅 {detailData.complexInfo.useApprovalDate.substring(0, 7)} 준공 
                  {(() => {
                    const year = parseInt(detailData.complexInfo.useApprovalDate.substring(0, 4));
                    const age = isNaN(year) ? null : new Date().getFullYear() - year + 1;
                    return age !== null ? ` (${age}년차)` : "";
                  })()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 크기 선택 탭 바 (실제 단지 평수 목록으로 가로 스크롤 대응) */}
        <div className="flex bg-alternative p-1 rounded-lg border border-normal self-start md:self-auto gap-0.5 overflow-x-auto max-w-full">
          <button
            onClick={() => setSelectedArea(undefined)}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition whitespace-nowrap ${
              selectedArea === undefined
                ? "bg-primary text-[var(--color-semantic-background-normal-normal)] shadow-sm"
                : "text-neutral hover:text-strong"
            }`}
          >
            {t("allArea")}
          </button>
          {availableSizes.map((size) => {
            const areaNum = parseInt(size);
            const isActive = selectedArea === areaNum;
            return (
              <button
                key={size}
                onClick={() => setSelectedArea(areaNum)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-[var(--color-semantic-background-normal-normal)] shadow-sm"
                    : "text-neutral hover:text-strong"
                }`}
              >
                {formatSizeString(size, areaUnit)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 주변 입지 평가 리포트 섹션 */}
      {detailData.infraRating && (
        <SectionCard 
          title={t("infraRatingTitle")}
          right={
            <button 
              type="button"
              onClick={() => setShowInfoModal(true)}
              className="text-assistive hover:text-primary transition-colors duration-150 p-1.5 rounded-full hover:bg-alternative flex items-center justify-center"
              title="산출 기준 보기"
            >
              <HelpCircle size={16} />
            </button>
          }
        >
          <div className="flex flex-col gap-6">
            {/* 상단 종합 등급 및 설명 요약 */}
            <div className="flex flex-col md:flex-row items-center justify-between p-5 rounded-xl bg-alternative/60 border border-normal gap-6">
              <div className="space-y-1.5 text-center md:text-left min-w-0 flex-1">
                <p className="text-xs text-neutral font-medium leading-relaxed">{t("infraRatingSubtitle")}</p>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 mt-2">
                  <span className="text-strong text-base font-bold">{t("infraTotalScore")}:</span>
                  <span className="text-primary font-mono text-2xl font-extrabold">{detailData.infraRating.totalScore}점</span>
                </div>
                {detailData.infraRating.isMock && (
                  <p className="text-[11px] text-warn font-semibold mt-2 flex items-center justify-center md:justify-start gap-1">
                    {t("infraMockNotice")}
                  </p>
                )}
              </div>
              
              {/* 등급 배지 */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-neutral font-semibold">{t("infraGrade")}</span>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center font-extrabold text-2xl shadow-sm border ${
                  detailData.infraRating.grade === "S" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                  detailData.infraRating.grade === "A" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                  detailData.infraRating.grade === "B" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                  detailData.infraRating.grade === "C" ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
                  "bg-rose-500/10 text-rose-500 border-rose-500/20"
                }`}>
                  {detailData.infraRating.grade}
                </div>
              </div>
            </div>

            {/* 개별 인프라 그리드 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { code: "SW8", name: t("infraCategorySubway"), weight: "1.5 (최상)", color: "emerald", icon: Train },
                { code: "SC4", name: t("infraCategorySchool"), weight: "1.0 (상)", color: "blue", icon: School },
                { code: "HP8", name: t("infraCategoryHospital"), weight: "0.8 (중상)", color: "indigo", icon: Activity },
                { code: "MT1", name: t("infraCategoryMart"), weight: "0.7 (중)", color: "purple", icon: ShoppingBag }
              ].map((item) => {
                const info = detailData.infraRating.categories[item.code] || { score: 0, count: 0, minDistance: null };
                const Icon = item.icon;
                
                // 도보 시간 계산
                const walkTime = info.minDistance !== null ? Math.max(1, Math.round(info.minDistance / 80)) : null;

                return (
                  <div key={item.code} className="bg-normal/20 border border-normal rounded-xl p-4 flex flex-col justify-between gap-4 hover:bg-normal/40 transition duration-150">
                    <div className="space-y-2">
                      {/* 헤더 */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-strong flex items-center gap-1.5 min-w-0">
                          <Icon size={14} className="text-primary shrink-0" />
                          <span className="truncate">{item.name.split(" ")[0]}</span>
                        </span>
                        <span className="text-[10px] text-assistive shrink-0 font-semibold bg-alternative px-1.5 py-0.5 rounded">
                          가중치 {item.weight.split(" ")[0]}
                        </span>
                      </div>
                      
                      {/* 점수 게이지 */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-assistive font-semibold">{t("infraScore")}</span>
                          <span className="font-bold text-strong font-mono">{info.score}점</span>
                        </div>
                        <div className="w-full bg-alternative rounded-full h-1.5 overflow-hidden border border-normal">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              item.color === "emerald" ? "bg-emerald-500" :
                              item.color === "blue" ? "bg-blue-500" :
                              item.color === "indigo" ? "bg-indigo-500" :
                              item.color === "purple" ? "bg-purple-500" :
                              "bg-amber-500"
                            }`}
                            style={{ width: `${info.score}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 세부 통계 정보 (details가 존재하는 경우) */}
                    {info.details && (
                      <div className="border-t border-normal/30 pt-2.5 space-y-1.5 text-[10px] text-neutral">
                        {item.code === "SW8" && (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🚇 {t("infraDetailMetro")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.metroCount}개 
                                {info.details.metroMinDistance !== null 
                                  ? ` (${info.details.metroMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🚄 {t("infraDetailGtx")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.gtxCount}개 
                                {info.details.gtxMinDistance !== null 
                                  ? ` (${info.details.gtxMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🚂 {t("infraDetailRail")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.railCount}개 
                                {info.details.railMinDistance !== null 
                                  ? ` (${info.details.railMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                          </>
                        )}
                        {item.code === "SC4" && (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🎒 {t("infraDetailElementary")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.elementaryCount}개 
                                {info.details.elementaryMinDistance !== null 
                                  ? ` (${info.details.elementaryMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                ✏️ {t("infraDetailMiddle")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.middleCount}개 
                                {info.details.middleMinDistance !== null 
                                  ? ` (${info.details.middleMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🎓 {t("infraDetailHigh")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.highCount}개 
                                {info.details.highMinDistance !== null 
                                  ? ` (${info.details.highMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                          </>
                        )}
                        {item.code === "HP8" && (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🏥 {t("infraDetailGeneralHospital")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.generalHospitalCount}개 
                                {info.details.generalHospitalMinDistance !== null 
                                  ? ` (${info.details.generalHospitalMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🩺 {t("infraDetailLocalClinic")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.localClinicCount}개 
                                {info.details.localClinicMinDistance !== null 
                                  ? ` (${info.details.localClinicMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                💊 {t("infraDetailPharmacy")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.pharmacyCount}개 
                                {info.details.pharmacyMinDistance !== null 
                                  ? ` (${info.details.pharmacyMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                          </>
                        )}
                        {item.code === "MT1" && (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🛒 {t("infraDetailLargeMart")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.largeMartCount}개 
                                {info.details.largeMartMinDistance !== null 
                                  ? ` (${info.details.largeMartMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🏬 {t("infraDetailSSM")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.ssmCount}개 
                                {info.details.ssmMinDistance !== null 
                                  ? ` (${info.details.ssmMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-assistive flex items-center gap-1">
                                🏪 {t("infraDetailConvStore")}
                              </span>
                              <span className="font-semibold text-strong">
                                {info.details.convenienceCount}개 
                                {info.details.convenienceMinDistance !== null 
                                  ? ` (${info.details.convenienceMinDistance}m)` 
                                  : " (-)"}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* 거리 및 개수 통계 */}
                    <div className="border-t border-normal/50 pt-2.5 flex items-center justify-between text-[11px] text-neutral font-medium">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[10px] text-assistive font-semibold">{t("infraMinDistance")}</span>
                        <span className="text-strong font-semibold font-mono truncate">
                          {info.minDistance !== null 
                            ? `${info.minDistance}m (${walkTime}분)` 
                            : "-"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0 ml-2">
                        <span className="text-[10px] text-assistive font-semibold">{t("infraCount")}</span>
                        <span className="text-strong font-extrabold font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px]">
                          {info.count}개
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </SectionCard>
      )}

      {/* 지도 및 입지 분석 섹션 (단지 정보가 존재할 경우 표시) */}
      {detailData.complexInfo && (
        <SectionCard title="🗺️ 단지 주변 입지 분석 (역세권 및 인프라)">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {/* 지도 컨테이너 */}
            <div className="lg:col-span-2 space-y-4">
              {!mapSdkLoaded ? (
                <div className="h-80 lg:h-[400px] w-full flex items-center justify-center bg-alternative border border-normal rounded-xl text-neutral">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-2" />
                  <span>지도 서비스를 로딩 중입니다...</span>
                </div>
              ) : detailData.complexInfo.lat === null || detailData.complexInfo.lng === null ? (
                <div className="h-80 lg:h-[400px] w-full flex flex-col items-center justify-center bg-alternative border border-normal rounded-xl text-neutral p-4 text-center">
                  <MapPin size={36} className="mb-2 opacity-30" />
                  <p className="text-sm font-semibold">좌표 정보를 확보할 수 없습니다.</p>
                  <p className="text-xs text-assistive mt-1">단지의 주소가 불명확하여 지도를 렌더링하지 못했습니다.</p>
                </div>
              ) : (
                <div className="relative rounded-xl border border-normal overflow-hidden shadow-inner">
                  {/* 카카오 지도 렌더링 노드 */}
                  <div ref={mapContainerRef} className="h-80 lg:h-[400px] w-full" />
                  
                  {/* 편의시설 필터 퀵 패널 */}
                  <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1.5 max-w-[calc(100%-24px)] pointer-events-auto bg-elevated/95 backdrop-blur-sm p-1.5 rounded-lg shadow-md border border-normal">
                    {infraCategories.map((infra) => {
                      const Icon = infra.icon;
                      const isActive = activeInfraFilter === infra.code;
                      return (
                        <button
                          key={infra.code}
                          type="button"
                          onClick={() => handleInfraFilterToggle(infra.code)}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-bold border transition-colors ${
                            isActive
                              ? "bg-primary text-white border-primary"
                              : "bg-normal text-neutral border-normal hover:bg-alternative hover:text-strong"
                          }`}
                        >
                          <Icon size={12} />
                          <span>{infra.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 인근 역세권 정보 패널 */}
            <div className="flex flex-col justify-between gap-4 lg:h-[400px]">
              <div>
                <h3 className="text-sm font-bold text-strong flex items-center gap-1.5 mb-2">
                  <Train size={16} className="text-primary" />
                  <span>인근 역세권 (반경 1km 이내)</span>
                </h3>
                <p className="text-xs text-neutral mb-3 leading-relaxed">
                  단지 기준 직선 반경 1km 이내에 위치한 철도/지하철역 목록입니다. 도보/차량 시간은 직선거리 기준 추정값입니다.
                </p>

                {detailData.subways && detailData.subways.length > 0 ? (
                  <div className="space-y-3 overflow-y-auto max-h-60 lg:max-h-[200px] pr-1">
                    {detailData.subways.map((sub: any) => {
                      const { walkMin, carMin } = getTravelTime(sub.distanceM);
                      return (
                        <div key={sub.name} className="flex flex-col p-3 rounded-lg border border-normal bg-normal/30 hover:bg-normal/70 transition">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-strong flex items-center gap-1.5">
                              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                              {sub.name}
                            </span>
                            <span className="text-[11px] font-mono font-semibold text-primary">
                              {sub.distanceM >= 1000 
                                ? `${(sub.distanceM / 1000).toFixed(2)}km` 
                                : `${sub.distanceM}m`}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-4 mt-2 border-t border-normal/50 pt-2">
                            <span className="text-[10px] text-neutral flex items-center gap-1">
                              <Clock size={12} className="text-assistive" />
                              <span>도보 <strong className="text-strong">{walkMin}분</strong></span>
                            </span>
                            <span className="text-[10px] text-neutral flex items-center gap-1">
                              <Navigation size={12} className="text-assistive" />
                              <span>차량 <strong className="text-strong">{carMin}분</strong></span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 bg-normal/20 border border-normal border-dashed rounded-xl text-neutral">
                    <Train size={32} className="mb-2 opacity-20 text-warn" />
                    <p className="text-xs font-semibold text-warn">1km 이내에 철도/지하철역이 없습니다.</p>
                  </div>
                )}
              </div>

              {detailData.complexInfo && (

                <div className="p-3 bg-alternative/40 border border-normal rounded-lg text-[11px] text-neutral space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-strong shrink-0">단지 주소</span>
                    <span className="text-right">{detailData.complexInfo.regionName} {detailData.complexInfo.dongName || ""} {detailData.complexInfo.jibun || ""}</span>
                  </div>
                  {detailData.complexInfo.roadName && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-strong shrink-0">도로명</span>
                      <span className="text-right">{detailData.complexInfo.roadName}</span>
                    </div>
                  )}
                  {(detailData.complexInfo.lat && detailData.complexInfo.lng) && (
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-strong">좌표 (위·경도)</span>
                      <span className="font-mono text-[10px]">{detailData.complexInfo.lat.toFixed(5)}, {detailData.complexInfo.lng.toFixed(5)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      )}



      {/* 데이터가 전혀 없을 경우 */}
      {detailData.recentTx.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-elevated border border-normal rounded-xl text-neutral">
          <Home size={48} className="mb-3 opacity-30" />
          <p className="text-sm">{t("noData")}</p>
        </div>
      ) : (
        <>
          {/* 1. 월별 거래 트렌드 시계열 */}
          <SectionCard title={t("monthlyTrendTitle")}>
            {/* 요약 통계 카드 그리드 */}
            {kpiData && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard
                  icon={DollarSign}
                  label={`${t("recentAvgPrice")} (${kpiData.latestMonth})`}
                  value={`${kpiData.latestAvg.toFixed(2)}${t("eokUnit")}`}
                />
                <StatCard
                  icon={ArrowUpDown}
                  label={`${t("yoyChange")} (${kpiData.yoyMonthStr})`}
                  value={
                    kpiData.hasYoy
                      ? `${kpiData.yoyDiff >= 0 ? "+" : ""}${kpiData.yoyDiff.toFixed(2)}${t("eokUnit")} (${kpiData.yoyDiff >= 0 ? "+" : ""}${kpiData.yoyPercent.toFixed(1)}%)`
                      : t("yoyNoData")
                  }
                  tone={
                    kpiData.hasYoy
                      ? kpiData.yoyDiff > 0
                        ? "good"
                        : kpiData.yoyDiff < 0
                        ? "warn"
                        : "default"
                      : "default"
                  }
                />
                <StatCard
                  icon={Layers}
                  label={t("pastYearVolume")}
                  value={`${kpiData.pastYearVolume}${t("countUnit")}`}
                />
                <StatCard
                  icon={TrendingUp}
                  label={`${t("allTimeHigh")} (${kpiData.maxMonth})`}
                  value={`${kpiData.maxPrice.toFixed(2)}${t("eokUnit")}`}
                />
              </div>
            )}

            {/* 커스텀 범례 (클릭 시 토글 가능) */}
            <div className="flex flex-wrap items-center gap-4 mb-4">
              {[
                { key: "최대가", label: "최대가", color: "var(--color-chart-max)", type: "line" },
                { key: "평균가", label: "평균가", color: "var(--color-chart-primary)", type: "area" },
                { key: "중위값", label: "중위값", color: "var(--color-chart-median)", type: "line" },
                { key: "최소가", label: "최소가", color: "var(--color-chart-min)", type: "line" },
                { key: "거래량", label: "거래량", color: "var(--color-chart-primary)", type: "bar" }
              ].map((item) => {
                const isHidden = hiddenKeys[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleKey(item.key)}
                    className={`flex items-center gap-1.5 transition-opacity duration-200 ${
                      isHidden ? "opacity-30 line-through" : "opacity-100 hover:opacity-80"
                    }`}
                  >
                    <span
                      className={`inline-block w-3 h-3 ${item.type === "line" ? "rounded-full" : "rounded-sm"}`}
                      style={{ backgroundColor: item.color, opacity: item.type === "line" ? 1.0 : 0.6 }}
                    />
                    <span className="text-xs text-neutral select-none">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={detailData.trend} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} interval="preserveStartEnd" />
                  {/* 좌측 Y축: 가격 */}
                  <YAxis yAxisId="left" width={52} stroke="#64748b" fontSize={11} tickLine={false} domain={[(dataMin) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]} />
                  {/* 우측 Y축: 거래량 */}
                  <YAxis yAxisId="right" orientation="right" width={35} stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} domain={[(dataMin) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]} />
                  <Tooltip contentStyle={tooltipContentStyle} />
                  
                  {/* 우측 Y축 기준의 거래량 Bar (뒷배경) */}
                  {!hiddenKeys["거래량"] && (
                    <Bar yAxisId="right" dataKey="거래량" name="거래량" fill="var(--color-chart-primary)" fillOpacity={0.15} radius={[4, 4, 0, 0]} barSize={24} />
                  )}

                  {/* 평균가를 배경 반투명 Area 스타일로 뒷배경에 깔아줌 */}
                  {!hiddenKeys["평균가"] && (
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="평균가"
                      name="평균가 (배경)"
                      stroke="none"
                      fill="var(--color-chart-primary)"
                      fillOpacity={0.08}
                      connectNulls={true}
                    />
                  )}
                  
                  {/* 최대가, 중위값, 최소가 선 그래프 드로잉 (평균가 Line 제거) */}
                  {!hiddenKeys["최대가"] && (
                    <Line yAxisId="left" type="monotone" dataKey="최대가" name="최대가" stroke="var(--color-chart-max)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls={true} />
                  )}
                  {!hiddenKeys["중위값"] && (
                    <Line yAxisId="left" type="monotone" dataKey="중위값" name="중위값" stroke="var(--color-chart-median)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls={true} />
                  )}
                  {!hiddenKeys["최소가"] && (
                    <Line yAxisId="left" type="monotone" dataKey="최소가" name="최소가" stroke="var(--color-chart-min)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls={true} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <div className="grid gap-6" style={{ gridTemplateColumns: isNarrow ? '1fr' : 'repeat(2, 1fr)' }}>
            {/* 2. 평수별 통계 (이중 Y축 적용 ComposedChart) */}
            <SectionCard title={t("areaAnalysisTitle")}>
              {/* 커스텀 범례 */}
              <div className="flex flex-wrap items-center gap-4 mb-4">
                {[
                  { key: "최대/최소", label: t("maxPrice") + "/" + t("minPrice"), color: "var(--color-semantic-line-normal-normal)", type: "line" },
                  { key: "Q1/Q3", label: t("q1Price") + "/" + t("q3Price") + " " + t("box"), color: "var(--color-chart-primary)", type: "area" },
                  { key: "평균", label: t("avgPrice"), color: "var(--color-chart-accent)", type: "line" },
                  { key: "중위값", label: t("medianPrice"), color: "var(--color-chart-median)", type: "line" },
                  { key: "거래량", label: t("txCount") + ` (${t("countUnit")})`, color: "var(--color-chart-min)", type: "line" }
                ].map((item) => {
                  const isHidden = areaHiddenKeys[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleAreaKey(item.key)}
                      className={`flex items-center gap-1.5 transition-opacity duration-200 ${
                        isHidden ? "opacity-30 line-through" : "opacity-100 hover:opacity-80"
                      }`}
                    >
                      {item.type === "line" && (
                        <span className="inline-block w-3.5 h-0.5" style={{ backgroundColor: item.color }} />
                      )}
                      {item.type === "area" && (
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: item.color, opacity: 0.25, border: `1.5px solid ${item.color}` }} />
                      )}
                      {item.type === "dot" && (
                        <span className="inline-block w-2.5 h-2.5 rotate-45" style={{ backgroundColor: item.color, border: "1px solid var(--color-semantic-background-normal-normal)" }} />
                      )}
                      <span className="text-xs text-neutral select-none">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={detailData.areaBreakdown} margin={{ top: 10, right: -5, left: -25, bottom: 0 }}>
                    <XAxis dataKey="area" stroke="#64748b" fontSize={11} tickLine={false} interval="preserveStartEnd" tickFormatter={(v) => formatSizeString(v, areaUnit)} />
                    {/* Y축 1: 가격 (억 원) */}
                    <YAxis yAxisId="left" width={52} stroke="#64748b" fontSize={11} tickLine={false} domain={[(dataMin) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]} />
                    {/* Y축 2: 거래 건수 (건) */}
                    <YAxis yAxisId="right" orientation="right" width={35} stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} domain={[(dataMin) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]} />
                    
                    <Tooltip content={<BoxPlotTooltip unit={areaUnit} type="area" />} />

                    {/* Y축 범위를 정확히 감싸기 위한 투명 가이드 Line (토글 여부에 맞춰 도메인 조절) */}
                    {!areaHiddenKeys["최대/최소"] ? (
                      <>
                        <Line yAxisId="left" dataKey="max" stroke="none" dot={false} activeDot={false} legendType="none" />
                        <Line yAxisId="left" dataKey="min" stroke="none" dot={false} activeDot={false} legendType="none" />
                      </>
                    ) : !areaHiddenKeys["Q1/Q3"] ? (
                      <>
                        <Line yAxisId="left" dataKey="q3" stroke="none" dot={false} activeDot={false} legendType="none" />
                        <Line yAxisId="left" dataKey="q1" stroke="none" dot={false} activeDot={false} legendType="none" />
                      </>
                    ) : (
                      <Line yAxisId="left" dataKey="mean" stroke="none" dot={false} activeDot={false} legendType="none" />
                    )}

                    <Bar
                      yAxisId="left"
                      dataKey="mean"
                      name={t("avgPrice")}
                      shape={(barProps: any) => (
                        <BoxPlotShape
                          {...barProps}
                          showWhiskers={!areaHiddenKeys["최대/최소"]}
                          showBox={!areaHiddenKeys["Q1/Q3"]}
                          showMedian={!areaHiddenKeys["중위값"]}
                          showMean={false}
                        />
                      )}
                    />

                    {/* 평균가 시계열 라인 */}
                    {!areaHiddenKeys["평균"] && (
                      <Line yAxisId="left" type="monotone" dataKey="mean" name={t("avgPrice")} stroke="var(--color-chart-accent)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    )}

                    {!areaHiddenKeys["거래량"] && (
                      <Line yAxisId="right" type="monotone" dataKey="count" name={`${t("txCount")} (${t("countUnit")})`} stroke="var(--color-chart-min)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            {/* 3. 층별 분포 (이중 Y축 적용 ComposedChart) */}
            <SectionCard title={t("floorAnalysisTitle")}>
              {/* 커스텀 범례 */}
              <div className="flex flex-wrap items-center gap-4 mb-4">
                {[
                  { key: "최대/최소", label: t("maxPrice") + "/" + t("minPrice"), color: "var(--color-semantic-line-normal-normal)", type: "line" },
                  { key: "Q1/Q3", label: t("q1Price") + "/" + t("q3Price") + " " + t("box"), color: "var(--color-chart-primary)", type: "area" },
                  { key: "평균", label: t("avgPrice"), color: "var(--color-chart-accent)", type: "line" },
                  { key: "중위값", label: t("medianPrice"), color: "var(--color-chart-median)", type: "line" },
                  { key: "거래량", label: t("txCount") + ` (${t("countUnit")})`, color: "var(--color-chart-floor)", type: "line" }
                ].map((item) => {
                  const isHidden = floorHiddenKeys[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggleFloorKey(item.key)}
                      className={`flex items-center gap-1.5 transition-opacity duration-200 ${
                        isHidden ? "opacity-30 line-through" : "opacity-100 hover:opacity-80"
                      }`}
                    >
                      {item.type === "line" && (
                        <span className="inline-block w-3.5 h-0.5" style={{ backgroundColor: item.color }} />
                      )}
                      {item.type === "area" && (
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: item.color, opacity: 0.25, border: `1.5px solid ${item.color}` }} />
                      )}
                      {item.type === "dot" && (
                        <span className="inline-block w-2.5 h-2.5 rotate-45" style={{ backgroundColor: item.color, border: "1px solid var(--color-semantic-background-normal-normal)" }} />
                      )}
                      <span className="text-xs text-neutral select-none">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={detailData.floorDist} margin={{ top: 10, right: -5, left: -25, bottom: 0 }}>
                    <XAxis dataKey="floor" stroke="#64748b" fontSize={11} tickLine={false} interval="preserveStartEnd" tickFormatter={(v) => `${v}${t("floorUnit")}`} />
                    {/* Y축 1: 가격 (억 원) */}
                    <YAxis yAxisId="left" width={52} stroke="#64748b" fontSize={11} tickLine={false} domain={[(dataMin) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]} />
                    {/* Y축 2: 거래 건수 (건) */}
                    <YAxis yAxisId="right" orientation="right" width={35} stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} domain={[(dataMin) => Math.max(0, Math.floor(dataMin * 0.9)), "auto"]} />
                    
                    <Tooltip content={<BoxPlotTooltip unit="m2" type="floor" />} />

                    {/* Y축 범위를 정확히 감싸기 위한 투명 가이드 Line (토글 여부에 맞춰 도메인 조절) */}
                    {!floorHiddenKeys["최대/최소"] ? (
                      <>
                        <Line yAxisId="left" dataKey="max" stroke="none" dot={false} activeDot={false} legendType="none" />
                        <Line yAxisId="left" dataKey="min" stroke="none" dot={false} activeDot={false} legendType="none" />
                      </>
                    ) : !floorHiddenKeys["Q1/Q3"] ? (
                      <>
                        <Line yAxisId="left" dataKey="q3" stroke="none" dot={false} activeDot={false} legendType="none" />
                        <Line yAxisId="left" dataKey="q1" stroke="none" dot={false} activeDot={false} legendType="none" />
                      </>
                    ) : (
                      <Line yAxisId="left" dataKey="mean" stroke="none" dot={false} activeDot={false} legendType="none" />
                    )}

                    <Bar
                      yAxisId="left"
                      dataKey="mean"
                      name={t("avgPrice")}
                      shape={(barProps: any) => (
                        <BoxPlotShape
                          {...barProps}
                          showWhiskers={!floorHiddenKeys["최대/최소"]}
                          showBox={!floorHiddenKeys["Q1/Q3"]}
                          showMedian={!floorHiddenKeys["중위값"]}
                          showMean={false}
                        />
                      )}
                    />

                    {/* 평균가 시계열 라인 */}
                    {!floorHiddenKeys["평균"] && (
                      <Line yAxisId="left" type="monotone" dataKey="mean" name={t("avgPrice")} stroke="var(--color-chart-accent)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    )}

                    {!floorHiddenKeys["거래량"] && (
                      <Line yAxisId="right" type="monotone" dataKey="count" name={`${t("txCount")} (${t("countUnit")})`} stroke="var(--color-chart-floor)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          </div>

          {/* 4. 최근 실거래 목록 */}
          <SectionCard title={t("recentTxTitle")}>
            {groupedTx.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {groupedTx.map((group) => (
                  <div key={group.dealDate} className="bg-normal/30 border border-normal rounded-xl p-3.5 flex flex-col gap-2.5 hover:bg-normal/50 transition duration-150">
                    {/* 날짜 헤더 */}
                    <div className="flex items-center gap-1.5 pb-2 border-b border-normal/50 text-xs font-bold text-neutral">
                      <Calendar size={13} className="text-primary" />
                      <span>{group.dealDate}</span>
                      <span className="ml-auto text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                        {group.items.length} {t("countUnit")}
                      </span>
                    </div>
                    {/* 날짜 내 개별 거래 목록 */}
                    <div className="flex flex-col gap-2.5">
                      {group.items.map((tx: any, idx: number) => (
                        <div key={tx.dedupeKey || idx} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-strong bg-alternative/80 px-2 py-0.5 rounded text-[10px] font-bold">
                              {tx.floor ? `${tx.floor}${t("floorUnit")}` : "-"}
                            </span>
                            <span className="text-neutral font-medium">
                              {tx.areaM2 ? formatSizeString(String(tx.areaM2), areaUnit) : "-"}
                            </span>
                          </div>
                          <span className="text-primary font-extrabold font-mono text-sm inline-flex items-center gap-0.5">
                            <DollarSign size={12} className="opacity-80" />
                            {tx.priceEok.toFixed(1)}{t("eokUnit")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-normal/20 border border-normal border-dashed rounded-xl text-neutral text-xs">
                {t("noData")}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* 입지 평가 산출 기준 정보 모달 */}
      {showInfoModal && createPortal(
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/5 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setShowInfoModal(false)}
        >
          <div 
            className="bg-elevated border border-normal rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between border-b border-normal px-6 py-4 shrink-0">
              <h3 className="text-base font-bold text-strong flex items-center gap-2">
                {t("infraModalTitle")}
              </h3>
              <button 
                onClick={() => setShowInfoModal(false)}
                className="text-assistive hover:text-strong p-1 rounded-lg hover:bg-alternative transition"
              >
                <X size={18} />
              </button>
            </div>
            
            {/* 본문 */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-neutral leading-relaxed">
              <p className="text-[11px] bg-alternative/60 p-3 rounded-lg border border-normal">
                {t("infraModalIntro")}
              </p>

              <div className="space-y-2">
                <h4 className="font-bold text-strong flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {t("infraModalFormulaTitle")}
                </h4>
                <p>{t("infraModalFormulaDesc")}</p>
                <div className="bg-normal/50 p-2.5 rounded font-mono text-[10px] text-primary text-center font-bold border border-normal/50">
                  {t("infraModalFormulaMath")}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-strong flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {t("infraModalRadiusTitle")}
                </h4>
                <p>{t("infraModalRadiusDesc")}</p>
                <ul className="bg-alternative/40 p-3 rounded-lg border border-normal space-y-1.5 font-medium">
                  <li className="flex items-center justify-between">
                    <span className="text-strong">{t("infraCategorySubway").split(" ")[0]}</span>
                    <span className="text-[10px] font-mono">{t("infraModalSubwayDesc")}</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-strong">{t("infraCategorySchool").split(" ")[0]}</span>
                    <span className="text-[10px] font-mono">{t("infraModalSchoolDesc")}</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-strong">{t("infraCategoryHospital").split(" ")[0]}</span>
                    <span className="text-[10px] font-mono">{t("infraModalHospitalDesc")}</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-strong">{t("infraCategoryMart").split(" ")[0]}</span>
                    <span className="text-[10px] font-mono">{t("infraModalMartDesc")}</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-strong flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {t("infraModalWeightTitle")}
                </h4>
                <p>{t("infraModalWeightDesc")}</p>
                <div className="bg-normal/50 p-2.5 rounded font-mono text-[10px] text-strong text-center font-bold border border-normal/50">
                  {t("infraModalWeightList")}
                </div>
              </div>
            </div>

            {/* 푸터 */}
            <div className="border-t border-normal px-6 py-4 flex justify-end shrink-0">
              <button
                onClick={() => setShowInfoModal(false)}
                className="px-4 py-2 bg-primary text-white font-bold rounded-lg text-xs hover:opacity-90 transition"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
