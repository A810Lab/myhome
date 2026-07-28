import React, { useState, useEffect } from "react";
import FilterPanel from "./graph/FilterPanel";
import OverviewTab from "./graph/OverviewTab";
import InsightTab from "./graph/InsightTab";
import { GraphFilter } from "@myhome/shared";
import { searchGraphTransactions } from "../api";
import { BarChart3, Sparkles } from "lucide-react";
import { copy } from "../locales/ko";
import { PageHeader } from "../components/PageHeader";
import { classNames } from "../lib/format";
import type { AppConfig } from "../types";

const locale = "ko";
const t = copy[locale];

const tabs = [
  { id: "overview" as const, label: "종합 현황", icon: BarChart3 },
  { id: "insight" as const, label: t.analyticsTabInsight, icon: Sparkles },
];

interface GraphDashboardProps {
  onNavigateToRules?: (initData: { regionName: string; regionCode?: string; apartmentKeywords: string[] }) => void;
  /** 종합 현황에서 단지 클릭 시 단지 분석으로 이동하는 콜백 */
  onSelectComplex?: (complexName: string, lawdCode?: string) => void;
  config?: AppConfig;
}

export default function GraphDashboard({ onNavigateToRules, onSelectComplex, config }: GraphDashboardProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "insight">("overview");

  const [filter, setFilter] = useState<GraphFilter>({
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().substring(0, 7),
    endDate: new Date().toISOString().substring(0, 7),
  });
  const [regionName, setRegionName] = useState("");
  const [areaUnit, setAreaUnit] = useState<"pyeong" | "m2">("pyeong");
  const [areaType, setAreaType] = useState<"supply" | "dedicated">("supply");

  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTransactions = async (currentFilter: GraphFilter = filter) => {
    setLoading(true);
    try {
      const data = await searchGraphTransactions(currentFilter);
      setTransactions(data);
    } catch (err) {
      console.error("Failed to load transactions for overview", err);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLawdCode = params.get("lawdCode");
    const urlRegionName = params.get("regionName");
    const urlStartDate = params.get("startDate");
    const urlEndDate = params.get("endDate");

    if (urlLawdCode) {
      const activeFilter: GraphFilter = {
        lawdCode: urlLawdCode,
        startDate: urlStartDate || filter.startDate,
        endDate: urlEndDate || filter.endDate
      };
      setFilter(activeFilter);
      if (urlRegionName) {
        setRegionName(decodeURIComponent(urlRegionName));
      }
      void fetchTransactions(activeFilter);
    } else {
      void fetchTransactions(filter);
    }
  }, []);

  const handleFilterChange = (newFilter: GraphFilter, newRegionName: string) => {
    setFilter(newFilter);
    setRegionName(newRegionName);
  };

  const handleApply = (appliedFilter?: GraphFilter) => {
    fetchTransactions(appliedFilter || filter);
  };

  /** 종합 현황 차트에서 단지 클릭 → 단지 분석 페이지로 드릴다운 */
  const handleSelectComplex = (complexName: string, lawdCode?: string) => {
    if (onSelectComplex) {
      onSelectComplex(complexName, lawdCode ?? filter.lawdCode);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="종합 현황"
        subtitle="실거래 적재 데이터를 지역·기간별로 거시 통계 분석합니다. 단지를 클릭하면 단지 분석으로 이동합니다."
        icon={BarChart3}
      />

      {/* 지역·기간 필터만 표시 (단지명·평형 숨김) */}
      <FilterPanel
        filter={filter}
        regionName={regionName}
        onFilterChange={handleFilterChange}
        onApply={handleApply}
        hideComplexSearch={true}
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

        {/* 면적 구분(분양/전용) 및 단위 토글 버튼 */}
        {activeTab === "overview" && (
          <div className="flex items-center gap-2 shrink-0 mr-1 mb-1">
            {/* 분양 / 전용 탭 */}
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setAreaType("supply")}
                className={classNames(
                  "rounded-md px-2 py-1 text-[10px] font-bold transition-colors",
                  areaType === "supply"
                    ? "bg-primary-600 text-white dark:bg-primary-500"
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
                    ? "bg-primary-600 text-white dark:bg-primary-500"
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
                    ? "bg-primary-600 text-white dark:bg-primary-500"
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
                    ? "bg-primary-600 text-white dark:bg-primary-500"
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
        {activeTab === "overview" && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-24 bg-elevated border border-normal rounded-xl">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <OverviewTab
                data={transactions}
                onSelectComplex={handleSelectComplex}
                areaUnit={areaUnit}
                areaType={areaType}
                locale={locale}
              />
            )}
          </>
        )}

        {activeTab === "insight" && (
          <InsightTab filter={filter} regionName={regionName} geminiConfigured={config?.geminiConfigured} />
        )}
      </div>
    </div>
  );
}
