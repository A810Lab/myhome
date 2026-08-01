import { Check, ChevronLeft, ChevronRight, History, Pencil, Play, RefreshCw, Search, Send, Trash2, X, Bell, HelpCircle, ShieldAlert } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, useRef } from "react";
import { useBreakpoint } from "../useBreakpoint";
import { createRule, deleteRule, getApartments, patchRule, runRule, searchRegions, logActivity } from "../api";

import { RegionSearchInput } from "../components/RegionSearchInput";
import { SectionCard } from "../components/SectionCard";
import { classNames, formatDate } from "../lib/format";
import type { ComparisonCriteria, DashboardState, RegionSearchResult, RuleInput, WatchRule, ComplexSearchResult } from "../types";
import { MapPin } from "lucide-react";
import { copy } from "../locales/ko";
import { TelegramGuideModal } from "../components/TelegramGuideModal";

const locale = "ko";
const t = copy[locale];

const ALERT_TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const hour = i.toString().padStart(2, "0");
  const timeStr = `${hour}:00`;
  const period = i < 12 ? "오전" : "오후";
  const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return {
    value: timeStr,
    label: `${period} ${displayHour}시 (${timeStr})`,
    labelEn: `${i < 12 ? "AM" : "PM"} ${displayHour === 0 ? 12 : displayHour}:00 (${timeStr})`
  };
});

const initialForm: RuleInput = {
  name: "",
  regionName: "",
  regionCode: undefined,
  apartmentKeywords: [],
  minPriceEok: undefined,
  maxPriceEok: 15,
  minArea: undefined,
  maxArea: undefined,
  comparisonCriteria: "none",
  intervalMinutes: 1440,
  alertTime: "09:00",
  channels: ["telegram"],
  enabled: true
};

function RuleForm({
  editingRule,
  initData,
  clearInitData,
  onSave,
  onCancel,
  isAdmin = false,
  currentRulesCount = 0
}: {
  editingRule?: WatchRule;
  initData?: { regionName: string; regionCode?: string; apartmentKeywords: string[] } | null;
  clearInitData?: () => void;
  onSave: () => void;
  onCancel: () => void;
  isAdmin?: boolean;
  currentRulesCount?: number;
}) {
  const [step, setStep] = useState(1);
  const [isTelegramGuideOpen, setIsTelegramGuideOpen] = useState(false);
  const [form, setForm] = useState<RuleInput>(() => ({
    ...initialForm,
    name: t.ruleInitialName
  }));

  const comparisonLabels: Record<ComparisonCriteria, string> = {
    none: t.comparisonCriteriaNone,
    parking: t.comparisonCriteriaParking,
    large_complex: t.comparisonCriteriaLargeComplex,
    transit: t.comparisonCriteriaTransit,
    newer: t.comparisonCriteriaNewer,
    livability: t.comparisonCriteriaLivability
  };

  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lawdCode, setLawdCode] = useState("");
  const [resolvedRegionName, setResolvedRegionName] = useState("");
  const [error, setError] = useState("");
  const [complexQuery, setComplexQuery] = useState("");
  const [showComplexDropdown, setShowComplexDropdown] = useState(false);
  const [activeAptIndex, setActiveAptIndex] = useState(-1);
  const [complexSearchResults, setComplexSearchResults] = useState<ComplexSearchResult[]>([]);
  const [searchingComplexes, setSearchingComplexes] = useState(false);

  const filteredApts = useMemo(() => {
    const names = complexSearchResults.map(item => item.name);
    const q = complexQuery.trim().toLowerCase();
    if (!q) return names;
    return names.filter(name => name.toLowerCase().includes(q));
  }, [complexSearchResults, complexQuery]);

  useEffect(() => {
    if (editingRule) {
      setForm({
        name: editingRule.name,
        regionName: editingRule.regionName,
        regionCode: editingRule.regionCode,
        apartmentKeywords: editingRule.apartmentKeywords ?? [],
        minPriceEok: editingRule.minPriceEok,
        maxPriceEok: editingRule.maxPriceEok,
        minArea: editingRule.minArea,
        maxArea: editingRule.maxArea,
        comparisonCriteria: editingRule.comparisonCriteria,
        intervalMinutes: editingRule.intervalMinutes ?? 1440,
        alertTime: editingRule.alertTime ?? "09:00",
        channels: editingRule.channels,
        enabled: editingRule.enabled
      });
      setLawdCode(editingRule.regionCode ?? "");
      setResolvedRegionName(editingRule.regionName);
      setStep(1);
    } else if (initData) {
      // 1. 외부(역세권 분석 등)에서 넘어온 데이터로 폼 세팅
      setForm({
        ...initialForm,
        name: `${initData.regionName.split(" ").pop() ?? ""} 알림 규칙`,
        regionName: initData.regionName,
        regionCode: initData.regionCode,
        apartmentKeywords: initData.apartmentKeywords
      });
      setLawdCode(initData.regionCode ?? "");
      setResolvedRegionName(initData.regionName);
      setStep(2); // 2단계(단지선택)로 즉시 진입
      clearInitData?.(); // 즉시 부모 상태 클리어 (이후 initData가 null로 재유입됨)
    } else {
      // 2. editingRule이 해제되었거나 빈 폼 초기 로드 시점
      // 단, clearInitData로 인해 initData가 null로 변해 재유입된 경우에는 리셋하지 않도록 폼 입력 여부 체크(가드)
      if (!resolvedRegionName) {
        setForm({
          ...initialForm,
          name: t.ruleInitialName
        });
        setLawdCode("");
        setResolvedRegionName("");
        setStep(1);
      }
    }
  }, [editingRule, initData]);

  /**
   * lawdCode 확정 시 단지 목록 자동 로드:
   *   지역 아파트 목록 캐시(/api/apartments/list) 우선 조회 (캐시 없을 시 국토부 API 자동 호출)
   */
  useEffect(() => {
    if (!lawdCode) {
      setComplexSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchingComplexes(true);
    setComplexSearchResults([]);

    (async () => {
      try {
        const apiResult = await getApartments(lawdCode);
        if (!cancelled) {
          setComplexSearchResults(apiResult.apartments.map(name => ({
            id: `${lawdCode}|${name}`,
            name,
            lawdCode,
            regionName: resolvedRegionName
          })));
        }
      } catch (err) {
        console.error("[Rules] 단지 목록 로드 실패:", err);
        if (!cancelled) setComplexSearchResults([]);
      } finally {
        if (!cancelled) setSearchingComplexes(false);
      }
    })();

    return () => { cancelled = true; };
  }, [lawdCode, resolvedRegionName]);

  function selectRegion(item: RegionSearchResult) {
    // 사용자가 입력한 regionName을 덮어쓰지 않음
    // lawdCode만 저장하고, 표시용 이름은 연동 배지로 표시
    setLawdCode(item.lawdCode);
    setResolvedRegionName(item.displayName);
    setForm(prev => ({ ...prev, regionCode: item.lawdCode }));
    setError("");
    setStep(2);
  }

  async function handleSearch() {
    if (!form.regionName.trim()) return;
    setSearching(true);
    setError("");
    try {
      const results = await searchRegions(form.regionName);
      if (results.length > 0) {
        const bestMatch = results[0];
        setLawdCode(bestMatch.lawdCode);
        setResolvedRegionName(bestMatch.displayName);
        setForm(prev => ({ ...prev, regionCode: bestMatch.lawdCode }));
        setStep(2);
      } else {
        setError("검색된 지역이 없습니다. 정확한 구/군 이름을 입력해 주세요.");
        setLawdCode("");
      }
    } catch (err) {
      setError("지역 검색에 실패했습니다.");
      setLawdCode("");
    } finally {
      setSearching(false);
    }
  }

  const toggleApt = (name: string) => {
    const current = form.apartmentKeywords ?? [];
    if (current.includes(name)) {
      setForm({ ...form, apartmentKeywords: current.filter(n => n !== name) });
    } else {
      setForm({ ...form, apartmentKeywords: [...current, name] });
    }
  };

  const handleAddCustomApt = () => {
    const customName = complexQuery.trim();
    if (!customName) return;

    const current = form.apartmentKeywords ?? [];
    if (!current.includes(customName)) {
      setForm(prev => ({
        ...prev,
        apartmentKeywords: [...current, customName]
      }));
    }
    setComplexQuery("");
    setShowComplexDropdown(false);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    const isLimitExceeded = !isAdmin && !editingRule && currentRulesCount >= 5;
    if (isLimitExceeded) {
      setError("일반 사용자는 알림 규칙을 최대 5개까지만 등록할 수 있습니다.");
      return;
    }

    setSaving(true);
    try {
      if (editingRule) {
        await patchRule(editingRule.id, form);
        void logActivity("rule_update", `알림 규칙 수정: ${form.name}`, { ruleId: editingRule.id, form });
      } else {
        const newRule = await createRule(form);
        void logActivity("rule_create", `알림 규칙 생성: ${form.name}`, { ruleId: newRule.id, form });
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title={editingRule ? t.ruleFormEdit : t.ruleFormCreate}
      right={
        editingRule && (
          <button onClick={onCancel} className="text-neutral hover:text-strong transition-colors">
            <X className="h-5 w-5" />
          </button>
        )
      }
    >
      <div className="space-y-6">
        {!isAdmin && !editingRule && (
          <div className="mx-2 sm:mx-6 bg-primary/5 border border-primary/10 rounded-xl p-3 text-[11px] text-primary font-bold flex justify-between items-center animate-in fade-in duration-300">
            <span>💡 일반 사용자는 알림 규칙을 최대 5개까지 생성할 수 있습니다.</span>
            <span className="bg-primary/15 px-2.5 py-0.5 rounded-full text-xs">
              {currentRulesCount} / 5개
            </span>
          </div>
        )}
        {/* Step Wizard Stepper */}
        <div className="mb-6 flex items-center justify-between px-2 sm:px-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div className={classNames(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all duration-300",
                  step === s
                    ? "bg-primary text-white ring-4 ring-primary/20 scale-105"
                    : step > s
                      ? "bg-emerald-500 text-white"
                      : "bg-alternative border border-normal text-neutral"
                )}>
                  {step > s ? <Check className="w-3.5 h-3.5" /> : s}
                </div>
                <span className={classNames(
                  "text-[10px] font-bold tracking-tight mt-1",
                  step === s ? "text-primary" : "text-neutral"
                )}>
                  {s === 1 ? t.regionSearch : s === 2 ? t.aptSelect : t.buttonNext}
                </span>
              </div>
              {s < 3 && (
                <div className={classNames(
                  "h-[2px] flex-1 -mt-6 mx-2 transition-all duration-300",
                  step > s ? "bg-emerald-500" : "bg-normal"
                )} />
              )}
            </div>
          ))}
        </div>
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-semibold text-strong">{t.ruleName}</span>
                <input
                  className="h-8 w-full rounded-lg border border-normal bg-normal px-2.5 text-xs text-strong focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder={t.ruleNamePlaceholder}
                />
              </label>
              <div className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-semibold text-strong">{t.regionSearch}</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <RegionSearchInput
                      value={form.regionName}
                      onChange={(value) => setForm({ ...form, regionName: value })}
                      onSelect={selectRegion}
                      className="h-8 w-full rounded-lg border border-normal bg-normal px-2.5 text-xs text-strong focus:border-primary outline-none"
                    />
                    {resolvedRegionName && lawdCode && (
                      <p className="flex items-center gap-1 text-[10px] text-primary font-semibold mt-0.5">
                        <MapPin className="h-2.5 w-2.5" />
                        {resolvedRegionName}
                        <span className="text-assistive font-normal">({lawdCode})</span>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSearch}
                    disabled={searching || !form.regionName.trim()}
                    className="h-8 rounded-lg bg-primary px-3 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-sm shadow-blue-500/20"
                  >
                    {searching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    {t.searchButton}
                  </button>
                </div>
              </div>
            </div>
            {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-strong">{form.regionName} {t.aptSelect}</h3>
                <p className="text-xs text-neutral mt-0.5">{t.aptSelectDesc}</p>
              </div>
            </div>

            {/* 선택된 단지 칩 목록 */}
            {form.apartmentKeywords && form.apartmentKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-alternative/30 border border-normal/20">
                {form.apartmentKeywords.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20 animate-in fade-in zoom-in-95 duration-150"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleApt(name)}
                      className="p-0.5 rounded-full hover:bg-primary/20 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Autocomplete 단지 검색창 */}
            <div className="relative">
              <input
                type="text"
                className="w-full h-[42px] rounded-lg border border-normal bg-normal pl-10 pr-10 text-sm font-semibold text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
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
                    if (showComplexDropdown && activeAptIndex >= 0 && activeAptIndex < filteredApts.length) {
                      const selected = filteredApts[activeAptIndex];
                      if (!form.apartmentKeywords?.includes(selected)) {
                        toggleApt(selected);
                      }
                      setComplexQuery("");
                      setShowComplexDropdown(false);
                      setActiveAptIndex(-1);
                    } else if (showComplexDropdown && filteredApts.length === 1) {
                      const selected = filteredApts[0];
                      if (!form.apartmentKeywords?.includes(selected)) {
                        toggleApt(selected);
                      }
                      setComplexQuery("");
                      setShowComplexDropdown(false);
                      setActiveAptIndex(-1);
                    } else {
                      handleAddCustomApt();
                    }
                  } else if (showComplexDropdown && filteredApts.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveAptIndex((prev) => (prev < filteredApts.length - 1 ? prev + 1 : prev));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveAptIndex((prev) => (prev > 0 ? prev - 1 : -1));
                    } else if (e.key === "Escape") {
                      setShowComplexDropdown(false);
                      setActiveAptIndex(-1);
                    }
                  }
                }}
                placeholder={t.aptSearchPlaceholder}
                autoComplete="off"
              />
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral" />
              {searchingComplexes && <RefreshCw className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-neutral" />}

              {showComplexDropdown && filteredApts.length > 0 && (
                <ul className="absolute z-30 left-0 right-0 top-full mt-1 max-h-48 overflow-auto rounded-lg border border-normal bg-elevated py-1 shadow-lg">
                  {filteredApts.map((apt, index) => {
                    const isAlreadySelected = form.apartmentKeywords?.includes(apt);
                    return (
                      <li key={`${apt}-${index}`}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (!isAlreadySelected) {
                              toggleApt(apt);
                            }
                            setComplexQuery("");
                            setShowComplexDropdown(false);
                          }}
                          className={classNames(
                            "w-full text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
                            index === activeAptIndex ? "bg-primary/10 text-primary font-semibold" : "hover:bg-alternative text-strong"
                          )}
                        >
                          <span>{apt}</span>
                          {isAlreadySelected && (
                            <span className="text-[10px] text-primary font-semibold bg-primary/10 px-1.5 py-0.5 rounded">
                              {t.allResults}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-lg border border-normal px-4 py-2.5 text-sm font-bold text-strong hover:bg-alternative transition-colors flex items-center justify-center gap-2"
              >
                <ChevronLeft className="h-4 w-4" /> {t.buttonPrev}
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-[2] rounded-lg bg-strong px-4 py-2.5 text-sm font-bold text-normal hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                {t.buttonNext} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-300">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-strong">{t.priceRangeLabel}</span>
                <div className="flex items-center gap-2">
                  <input
                    className="w-full rounded-lg border border-normal bg-normal px-4 py-2 text-sm text-strong focus:border-primary outline-none"
                    type="number"
                    step="0.1"
                    value={form.minPriceEok ?? ""}
                    onChange={(event) =>
                      setForm({ ...form, minPriceEok: event.target.value ? Number(event.target.value) : undefined })
                    }
                    placeholder={t.priceMinPlaceholder}
                  />
                  <span className="text-neutral">~</span>
                  <input
                    className="w-full rounded-lg border border-normal bg-normal px-4 py-2 text-sm text-strong focus:border-primary outline-none"
                    type="number"
                    step="0.1"
                    value={form.maxPriceEok ?? ""}
                    onChange={(event) =>
                      setForm({ ...form, maxPriceEok: event.target.value ? Number(event.target.value) : undefined })
                    }
                    placeholder={t.priceMaxPlaceholder}
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-strong">{t.areaRangeLabel}</span>
                  <span className="text-[10px] text-neutral font-medium">
                    {form.minArea ? `${Math.round(form.minArea / 3.3)}평` : "0평"} ~ {form.maxArea ? `${Math.round(form.maxArea / 3.3)}평` : "무제한"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="w-full rounded-lg border border-normal bg-normal px-4 py-2 text-sm text-strong focus:border-primary outline-none"
                    type="number"
                    step="1"
                    value={form.minArea ?? ""}
                    onChange={(event) =>
                      setForm({ ...form, minArea: event.target.value ? Number(event.target.value) : undefined })
                    }
                    placeholder={t.areaMinPlaceholder}
                  />
                  <span className="text-neutral">~</span>
                  <input
                    className="w-full rounded-lg border border-normal bg-normal px-4 py-2 text-sm text-strong focus:border-primary outline-none"
                    type="number"
                    step="1"
                    value={form.maxArea ?? ""}
                    onChange={(event) =>
                      setForm({ ...form, maxArea: event.target.value ? Number(event.target.value) : undefined })
                    }
                    placeholder={t.areaMaxPlaceholder}
                  />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-strong">{t.comparisonCriteria}</span>
                <select
                  className="w-full rounded-lg border border-normal bg-normal px-3 py-2 text-sm text-strong focus:border-primary outline-none appearance-none"
                  value={form.comparisonCriteria}
                  onChange={(event) => setForm({ ...form, comparisonCriteria: event.target.value as ComparisonCriteria })}
                >
                  {Object.entries(comparisonLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-strong">{t.checkInterval}</span>
                <select
                  className="w-full rounded-lg border border-normal bg-normal px-3 py-2 text-sm text-strong focus:border-primary outline-none appearance-none"
                  value={form.alertTime || "09:00"}
                  onChange={(event) => setForm({ ...form, alertTime: event.target.value })}
                >
                  {ALERT_TIME_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {locale === "ko" ? opt.label : opt.labelEn}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1.5 sm:col-span-2 flex items-end">
                <p className="text-xs text-neutral leading-relaxed flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 shrink-0" />
                  {t.checkIntervalNote}
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                 <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-strong">{t.alertChannels}</span>
                    <button
                      type="button"
                      onClick={() => setIsTelegramGuideOpen(true)}
                      className="text-xs text-primary hover:underline font-semibold flex items-center gap-1"
                    >
                      <HelpCircle size={13} />
                      <span>설정 가이드</span>
                    </button>
                 </div>
                 <div className="flex gap-4 p-3 rounded-lg border border-normal/30 bg-alternative/50">
                    <label className="flex items-center gap-2 text-sm text-neutral cursor-pointer select-none">
                      <input type="checkbox" checked readOnly disabled className="h-4 w-4 rounded text-primary" />
                      {t.channelTelegram}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-neutral cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-normal text-primary focus:ring-primary"
                        checked={form.channels.includes("kakao")}
                        onChange={(event) => {
                          setForm({
                            ...form,
                            channels: event.target.checked ? ["telegram", "kakao"] : ["telegram"]
                          });
                        }}
                      />
                      {t.channelKakao}
                    </label>
                 </div>
                 <p className="text-[10px] text-neutral/80 mt-1">
                   * {locale === "ko" 
                     ? "텔레그램 봇 토큰 및 대화방 ID 설정은 좌측 메뉴 [환경 설정]에서 개인별로 등록할 수 있습니다." 
                     : "Telegram Bot Token and Chat ID can be configured personally in the [Settings] menu."}
                 </p>
              </div>
            </div>

            {error && <p className="text-xs text-warn font-bold mt-2">{error}</p>}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 rounded-lg border border-normal px-4 py-2.5 text-sm font-bold text-strong hover:bg-alternative transition-colors flex items-center justify-center gap-2"
              >
                <ChevronLeft className="h-4 w-4" /> {t.buttonPrev}
              </button>
              <form onSubmit={submit} className="flex-[2]">
                <button
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60 hover:opacity-90 transition-all shadow-md shadow-primary/20 active:scale-95 disabled:bg-slate-400 disabled:shadow-none"
                  disabled={saving || (!isAdmin && !editingRule && currentRulesCount >= 5)}
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {saving ? t.buttonSaveProgress : editingRule ? t.buttonSaveComplete : t.buttonSave}
                </button>
              </form>
            </div>
            {!isAdmin && !editingRule && currentRulesCount >= 5 && (
              <p className="text-[10px] text-warn font-semibold text-center mt-2">
                ⚠️ 최대 5개의 규칙만 등록 가능하여 신규 추가가 제한됩니다. (현재: {currentRulesCount}/5개)
              </p>
            )}
          </div>
        )}
        <TelegramGuideModal
          isOpen={isTelegramGuideOpen}
          onClose={() => setIsTelegramGuideOpen(false)}
          locale={locale}
        />
      </div>
    </SectionCard>
  );
}

function RuleList({
  rules,
  onChanged,
  onEdit
}: {
  rules: WatchRule[];
  onChanged: () => void;
  onEdit: (rule: WatchRule) => void;
}) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const comparisonLabels: Record<ComparisonCriteria, string> = {
    none: t.comparisonCriteriaNone,
    parking: t.comparisonCriteriaParking,
    large_complex: t.comparisonCriteriaLargeComplex,
    transit: t.comparisonCriteriaTransit,
    newer: t.comparisonCriteriaNewer,
    livability: t.comparisonCriteriaLivability
  };

  async function run(id: string) {
    setBusyId(id);
    setError("");
    try {
      await runRule(id);
      const rule = rules.find((r) => r.id === id);
      void logActivity("rule_test", `알림 규칙 즉시 실행 테스트: ${rule?.name || id}`, { ruleId: id });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "체크 실행에 실패했습니다.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(id: string) {
    if (!confirm(t.deleteConfirm)) return;
    try {
      const rule = rules.find((r) => r.id === id);
      await deleteRule(id);
      void logActivity("rule_delete", `알림 규칙 삭제: ${rule?.name || id}`, { ruleId: id });
      onChanged();
    } catch (err) {
      setError("삭제에 실패했습니다.");
    }
  }

  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-normal bg-elevated p-10 text-center text-sm text-neutral">
        {t.noRules}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50/10 border border-red-500/20 px-4 py-3 text-sm text-red-500 font-medium">{error}</p>}
      {rules.map((rule) => {
        const keywordLen = rule.apartmentKeywords?.length ?? 0;
        return (
          <article key={rule.id} className="rounded-xl border border-normal bg-elevated p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-strong truncate">{rule.name}</h3>
                  {!rule.enabled && <span className="bg-alternative text-neutral px-1.5 py-0.5 rounded text-[10px] font-bold border border-normal">{t.ruleSuspended}</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral">
                  <span className="font-semibold text-strong bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{rule.regionName}</span>
                  {rule.apartmentKeywords && keywordLen > 0 ? (
                    <span className="text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded font-bold border border-primary/10">
                      {keywordLen === 1
                        ? rule.apartmentKeywords[0]
                        : locale === "ko"
                          ? `${rule.apartmentKeywords[0]} 외 ${keywordLen - 1}곳`
                          : `${rule.apartmentKeywords[0]} & ${keywordLen - 1} others`}
                    </span>
                  ) : <span className="text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded font-bold border border-primary/10">{t.ruleAllComplexes}</span>}
                  
                  <span className="text-[10px] bg-blue-500/5 text-blue-500 dark:text-blue-400 px-1.5 py-0.5 rounded font-bold border border-blue-500/10">
                    {locale === "ko"
                      ? `${rule.minPriceEok ?? 0}억~${rule.maxPriceEok ? rule.maxPriceEok + "억" : t.ruleUnlimited}`
                      : `${rule.minPriceEok ?? 0} Eok ~ ${rule.maxPriceEok ? rule.maxPriceEok + " Eok" : t.ruleUnlimited}`}
                  </span>
                  
                  {(rule.minArea !== undefined || rule.maxArea !== undefined) && (
                    <span className="text-[10px] bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10 px-1.5 py-0.5 rounded font-bold">
                      {rule.minArea ?? 0}㎡ ~ {rule.maxArea ? rule.maxArea + "㎡" : t.ruleUnlimited}
                      <span className="text-[9px] font-normal ml-1">
                        ({rule.minArea ? Math.round(rule.minArea / 3.3) : 0}평~{rule.maxArea ? Math.round(rule.maxArea / 3.3) : "무제한"})
                      </span>
                    </span>
                  )}

                  <span className="text-[10px] text-neutral bg-alternative/60 px-1.5 py-0.5 rounded border border-normal/50 font-medium">
                    {t.ruleRecentTrack}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral">
                  <span className="bg-alternative border border-normal px-1.5 py-0.5 rounded leading-none">{comparisonLabels[rule.comparisonCriteria]}</span>
                  <span>
                    {locale === "ko" 
                      ? `${rule.alertTime || "09:00"} 알림` 
                      : `Alert at ${rule.alertTime || "09:00"}`}
                  </span>
                  <span className="flex items-center gap-1">
                     <History className="h-3 w-3" /> {formatDate(rule.lastCheckedAt)} {t.ruleLastChecked}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:self-center">
                <button
                  className="p-2.5 text-neutral hover:bg-alternative hover:text-strong rounded-lg transition-colors"
                  title={t.ruleEdit}
                  onClick={() => onEdit(rule)}
                >
                  <Pencil className="h-4.5 w-4.5" />
                </button>
                <button
                  className="p-2.5 text-neutral hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors"
                  title={t.ruleDelete}
                  onClick={() => remove(rule.id)}
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
                <div className="h-6 w-px bg-line/20 mx-1 hidden sm:block" />
                <button
                  className={classNames(
                    "px-3.5 py-2 text-xs font-bold rounded-lg transition-all border",
                    rule.enabled ? "bg-elevated border-normal text-strong hover:bg-alternative" : "bg-primary border-primary text-white hover:opacity-90 active:scale-95"
                  )}
                  onClick={async () => {
                    const nextEnabled = !rule.enabled;
                    await patchRule(rule.id, { enabled: nextEnabled });
                    void logActivity("rule_update", `알림 규칙 상태 변경 (${nextEnabled ? "활성화" : "일시정지"}): ${rule.name}`, { ruleId: rule.id, enabled: nextEnabled });
                    onChanged();
                  }}
                >
                  {rule.enabled ? t.rulePause : t.ruleResume}
                </button>
                <button
                  className="inline-flex items-center gap-1.5 bg-strong px-4 py-2 text-xs font-bold text-normal rounded-lg disabled:opacity-60 hover:opacity-90 transition-all active:scale-95"
                  disabled={busyId === rule.id || !rule.enabled}
                  onClick={() => void run(rule.id)}
                >
                  {busyId === rule.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {busyId === rule.id ? t.ruleRunProgress : t.ruleRunNow}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function RulesPage({
  state,
  onChanged,
  initData,
  clearInitData,
  onNavigate,
  isAdmin = false
}: {
  state: DashboardState | undefined;
  onChanged: () => void;
  initData?: { regionName: string; regionCode?: string; apartmentKeywords: string[] } | null;
  clearInitData?: () => void;
  onNavigate?: (view: any) => void;
  isAdmin?: boolean;
}) {
  const { isMobile } = useBreakpoint();
  const [editingRule, setEditingRule] = useState<WatchRule | undefined>();
  const [isTelegramGuideOpen, setIsTelegramGuideOpen] = useState(false);

  const telegramNotConfigured = state && !state.config.telegramConfigured;

  return (
    <div className="space-y-6">
      {!isMobile && (
        <header className="flex flex-col gap-1">
          <h2 className="text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
            <Bell className="text-primary h-6 w-6" />
            {t.rulesTitle}
          </h2>
          <p className="text-sm text-neutral">{t.rulesSubtitle}</p>
        </header>
      )}

      {telegramNotConfigured ? (
        <div className="rounded-xl border border-warn bg-warn/5 p-6 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-warn/10 text-warn rounded-xl shrink-0">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="flex-1 space-y-1.5">
              <h3 className="text-sm font-bold text-strong">📬 텔레그램 알림 채널 미설정</h3>
              <p className="text-xs text-neutral leading-relaxed">
                실거래가 감시 조건 충족 시 실시간 알림을 수신하기 위한 텔레그램 연동이 설정되지 않았습니다.<br />
                알림 규칙을 등록하고 실행하기 전에 텔레그램 봇 토큰 및 대화방 ID를 먼저 입력해야 알림을 정상적으로 수신하실 수 있습니다.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 pl-0 sm:pl-12 pt-2">
            <button
              onClick={() => onNavigate?.("settings")}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity shadow-lg shadow-primary/10"
            >
              <span>환경 설정으로 이동하여 등록하기</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setIsTelegramGuideOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-normal bg-normal hover:bg-alternative text-strong text-xs font-bold rounded-lg transition-colors"
            >
              <span>설정 방법 가이드 보기</span>
            </button>
          </div>
          <TelegramGuideModal
            isOpen={isTelegramGuideOpen}
            onClose={() => setIsTelegramGuideOpen(false)}
            locale={locale}
          />
        </div>
      ) : (
        <>
          <RuleForm
            editingRule={editingRule}
            initData={initData}
            clearInitData={clearInitData}
            onSave={() => {
              setEditingRule(undefined);
              onChanged();
            }}
            onCancel={() => setEditingRule(undefined)}
            isAdmin={isAdmin}
            currentRulesCount={state?.rules.length ?? 0}
          />

          <div>
            <div className="mb-4 flex items-center justify-between px-1">
              <h2 className="text-lg font-bold text-strong tracking-tight">{t.ruleListTitle}</h2>
              <span className="text-xs font-bold text-neutral bg-elevated border border-normal px-2 py-0.5 rounded-full">
                {state?.rules.length ?? 0}{t.unitCount}
              </span>
            </div>
            <RuleList
              rules={state?.rules ?? []}
              onChanged={onChanged}
              onEdit={(rule) => {
                setEditingRule(rule);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
