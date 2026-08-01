import React, { useState, useEffect } from "react";
import FilterPanel from "./graph/FilterPanel";
import ComplexTab from "./graph/ComplexTab";
import InsightTab from "./graph/InsightTab";
import { GraphFilter } from "@myhome/shared";
import { Building2, Sparkles, ArrowLeft, Home } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { classNames } from "../lib/format";
import { copy } from "../locales/ko";

const locale = "ko";
const t = copy[locale];

const tabs = [
  { id: "complex" as const, label: t.analyticsTabComplex, icon: Building2 },
  { id: "insight" as const, label: t.analyticsTabInsight, icon: Sparkles },
];

interface ComplexAnalysisPageProps {
  onNavigateToRules?: (initData: { regionName: string; regionCode?: string; apartmentKeywords: string[] }) => void;
  /** 종합 현황에서 드릴다운 진입 시 초기 단지 정보 */
  initData?: { complexName: string; lawdCode?: string } | null;
  clearInitData?: () => void;
  /** 종합 현황으로 돌아가기 콜백 */
  onBackToOverview?: () => void;
}

export default function ComplexAnalysisPage({
  onNavigateToRules,
  initData,
  clearInitData,
  onBackToOverview,
}: ComplexAnalysisPageProps) {
  const [activeTab, setActiveTab] = useState<"complex" | "insight">("complex");
  const [areaUnit, setAreaUnit] = useState<"pyeong" | "m2">("pyeong");
  const [areaType, setAreaType] = useState<"supply" | "dedicated">("supply");

  const [filter, setFilter] = useState<GraphFilter>({
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().substring(0, 7),
    endDate: new Date().toISOString().substring(0, 7),
  });
  const [regionName, setRegionName] = useState("");

  // 드릴다운 진입 시 단지명 자동 세팅
  useEffect(() => {
    if (initData) {
      setFilter((prev) => ({
        ...prev,
        complexName: initData.complexName,
        lawdCode: initData.lawdCode ?? prev.lawdCode,
      }));
      setActiveTab("complex");
      clearInitData?.();
    }
  }, [initData]);

  const handleFilterChange = (newFilter: GraphFilter, newRegionName: string) => {
    setFilter(newFilter);
    setRegionName(newRegionName);
  };

  const handleApply = (appliedFilter?: GraphFilter) => {
    // ComplexTab은 filter prop 변경 시 자동으로 다시 조회하므로 별도 fetch 불필요
  };

  return (
    <div className="space-y-6">
      {/* 종합 현황에서 드릴다운 진입 시 뒤로가기 브레드크럼 */}
      {onBackToOverview && (
        <button
          onClick={onBackToOverview}
          className="inline-flex items-center gap-1.5 text-sm text-neutral hover:text-primary transition-colors group"
        >
          <ArrowLeft
            size={15}
            className="group-hover:-translate-x-0.5 transition-transform"
          />
          <span>종합 현황으로</span>
        </button>
      )}

      {/* Page Header */}
      <PageHeader
        title="단지 분석"
        subtitle="특정 아파트 단지의 실거래 데이터를 심층 분석합니다. 단지명을 검색하거나, 종합 현황에서 단지를 클릭하면 자동으로 진입됩니다."
        icon={Building2}
      />

      {/* FilterPanel 전체 (단지명·평형 포함) */}
      <FilterPanel
        filter={filter}
        regionName={regionName}
        onFilterChange={handleFilterChange}
        onApply={handleApply}
        hideComplexSearch={false}
        locale={locale}
      />

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 gap-2 pb-px overflow-visible">
        {/* Desktop Underline Tabs */}
        <div className="hidden md:flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={classNames(
                  "flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap",
                  isActive
                    ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                )}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile Scrollable Pill Tabs */}
        <div className="flex md:hidden overflow-x-auto scrollbar-none gap-2 pb-1 snap-x snap-mandatory flex-1 max-w-full">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={classNames(
                  "snap-start shrink-0 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5",
                  isActive
                    ? "bg-primary-600 text-white dark:bg-primary-500"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                )}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 면적 구분(분양/전용) 및 단위 토글 */}
        {activeTab === "complex" && (
          <div className="flex items-center gap-2 shrink-0 mr-1 mb-1">
            {/* 분양 / 전용 탭 */}
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setAreaType("supply")}
                className={classNames(
                  "rounded-md px-2 py-1 text-[10px] font-bold transition-colors",
                  areaType === "supply"
                    ? "bg-primary text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                )}
              >
                분양
              </button>
              <button
                type="button"
                onClick={() => setAreaType("dedicated")}
                className={classNames(
                  "rounded-md px-2 py-1 text-[10px] font-bold transition-colors",
                  areaType === "dedicated"
                    ? "bg-primary text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                )}
              >
                전용
              </button>
            </div>

            {/* 평 / ㎡ 단위 탭 */}
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setAreaUnit("pyeong")}
                className={classNames(
                  "rounded-md px-2 py-1 text-[10px] font-bold transition-colors",
                  areaUnit === "pyeong"
                    ? "bg-primary text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                )}
              >
                평
              </button>
              <button
                type="button"
                onClick={() => setAreaUnit("m2")}
                className={classNames(
                  "rounded-md px-2 py-1 text-[10px] font-bold transition-colors",
                  areaUnit === "m2"
                    ? "bg-primary text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                )}
              >
                ㎡
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        {activeTab === "complex" && (
          <ComplexTab
            initialComplexName={filter.complexName ?? ""}
            lawdCode={filter.lawdCode}
            areaUnit={areaUnit}
            areaType={areaType}
            startDate={filter.startDate}
            endDate={filter.endDate}
          />
        )}
        {activeTab === "insight" && (
          <InsightTab filter={filter} regionName={regionName} />
        )}
      </div>
    </div>
  );
}
