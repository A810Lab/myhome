import React, { useState, useEffect } from "react";
import { Activity, ShieldAlert, CheckCircle, Search, Calendar, ChevronLeft, ChevronRight, Eye, RefreshCw, X, User, Users, UserCheck, Database } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";
import { useBreakpoint } from "../useBreakpoint";
import { SectionCard } from "../components/SectionCard";
import { StatCard } from "../components/StatCard";
import { fetchActivityLogs, fetchActivityStats } from "../api";
import { UserActivityLog, ActivityStats } from "../types";
import { copy } from "../locales/ko";

const locale = (typeof navigator !== "undefined" && navigator.language.startsWith("ko")) ? "ko" : "en";
const t = copy[locale];

// Chart colors tailwind compatible
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#6b7280"];

export function ActivityLogPage() {
  const { isMobile } = useBreakpoint();
  
  // 상태 변수
  const [logs, setLogs] = useState<UserActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  // 필터 및 페이징 상태
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [debouncedUser, setDebouncedUser] = useState("");
  const [limit] = useState(15);
  const [page, setPage] = useState(1);
  
  // 모달 상태
  const [selectedPayload, setSelectedPayload] = useState<string | null>(null);

  // 사용자 이메일 검색 디바운싱
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUser(filterUser);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [filterUser]);

  // 통계 데이터 조회
  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const data = await fetchActivityStats();
      setStats(data);
    } catch (err: any) {
      console.error("Failed to load activity stats:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  // 로그 리스트 조회
  const loadLogs = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const offset = (page - 1) * limit;
      const data = await fetchActivityLogs({
        limit,
        offset,
        userEmail: debouncedUser.trim() || undefined,
        activityType: filterType || undefined
      });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err: any) {
      console.error("Failed to load activity logs:", err);
      setErrorMsg(err.message || "로그 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [page, debouncedUser, filterType]);

  // 전체 페이지 수 계산
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // 로그 유형 포맷터 (한국어/영문 매핑)
  const formatActivityType = (type: string) => {
    const types: Record<string, string> = {
      page_view: t.activityType_page_view || "페이지 뷰",
      search_transactions: t.activityType_search_transactions || "실거래 검색",
      region_add: t.activityType_region_add || "지역 추가",
      region_delete: t.activityType_region_delete || "지역 삭제",
      rule_create: t.activityType_rule_create || "규칙 생성",
      rule_update: t.activityType_rule_update || "규칙 수정",
      rule_delete: t.activityType_rule_delete || "규칙 삭제",
      rule_test: t.activityType_rule_test || "규칙 테스트",
      preset_create: t.activityType_preset_create || "프리셋 추가",
      preset_delete: t.activityType_preset_delete || "프리셋 삭제"
    };
    return types[type] || type;
  };

  const handleRefresh = () => {
    void loadStats();
    void loadLogs();
  };

  // 파이 차트 데이터 가공
  const pieChartData = stats?.activityByType.map((item) => ({
    name: formatActivityType(item.activityType),
    value: item.count
  })) || [];

  // 라인 차트 데이터 가공
  const areaChartData = stats?.activityByDate.map((item) => ({
    date: item.date.substring(5), // YYYY-MM-DD -> MM-DD
    logCount: item.logCount,
    userCount: item.userCount
  })) || [];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      {!isMobile && (
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-black text-strong tracking-tight mt-1 flex items-center gap-2">
              <Activity className="text-primary h-6 w-6" />
              {t.activityLogTitle || "활동 로그 모니터링"}
            </h2>
            <p className="text-sm text-neutral">
              {t.activityLogSubtitle || "대시보드 내 사용자의 페이지 방문, 실거래 검색, 수집 지역 변경 등의 활동 로그를 모니터링합니다."}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-2 bg-normal border border-normal rounded-lg hover:bg-normal/50 text-xs font-semibold text-strong transition-colors"
          >
            <RefreshCw size={14} />
            <span>새로고침</span>
          </button>
        </header>
      )}

      {isMobile && (
        <div className="flex justify-between items-center bg-normal/30 p-3 rounded-xl border border-normal/50">
          <span className="text-xs font-bold text-strong">로그 모니터링</span>
          <button
            onClick={handleRefresh}
            className="p-2 bg-primary/10 text-primary rounded-lg text-xs font-semibold"
          >
            <RefreshCw size={14} className="inline mr-1" /> 새로고침
          </button>
        </div>
      )}

      {/* 통계 요약 카드 섹션 */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* DAU */}
          <div className="rounded-xl border border-normal bg-elevated p-4 shadow-sm relative overflow-hidden transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral">일간 활성 사용자 (DAU)</span>
              <UserCheck className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-black text-strong">{stats.dau}명</div>
            <div className="mt-1 text-[10px] text-assistive">KST 오늘 활동한 고유 사용자</div>
          </div>

          {/* WAU */}
          <div className="rounded-xl border border-normal bg-elevated p-4 shadow-sm relative overflow-hidden transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral">주간 활성 사용자 (WAU)</span>
              <Users className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="mt-2 text-2xl font-black text-strong">{stats.wau}명</div>
            <div className="mt-1 text-[10px] text-assistive">최근 7일 동안 활동한 고유 사용자</div>
          </div>

          {/* MAU */}
          <div className="rounded-xl border border-normal bg-elevated p-4 shadow-sm relative overflow-hidden transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral">월간 활성 사용자 (MAU)</span>
              <Users className="h-5 w-5 text-blue-500" />
            </div>
            <div className="mt-2 text-2xl font-black text-strong">{stats.mau}명</div>
            <div className="mt-1 text-[10px] text-assistive">최근 30일 동안 활동한 고유 사용자</div>
          </div>

          {/* Cumulative Stats */}
          <div className="rounded-xl border border-normal bg-elevated p-4 shadow-sm relative overflow-hidden transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral">누적 사용자 / 전체 로그</span>
              <Database className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-black text-strong">
              {stats.totalUsers}명 <span className="text-sm font-normal text-neutral">/</span> {stats.totalLogs}건
            </div>
            <div className="mt-1 text-[10px] text-assistive">시스템 내 등록된 누적 수치</div>
          </div>
        </div>
      )}

      {/* 통계 차트 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 최근 활동 추이 그래프 */}
        <div className="lg:col-span-2">
          <SectionCard title={t.activityTrends || "최근 활동 추이 (14일)"}>
            {loadingStats ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : areaChartData.length === 0 ? (
              <div className="flex justify-center items-center h-64 text-xs text-neutral">
                활동 내역 데이터가 충분하지 않습니다.
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={areaChartData} margin={{ top: 10, right: 5, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorLogCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorUserCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} style={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis yAxisId="left" tickLine={false} axisLine={false} style={{ fontSize: 10, fill: "#94a3b8" }} width={35} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} style={{ fontSize: 10, fill: "#94a3b8" }} width={30} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(255, 255, 255, 0.95)",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        fontSize: "11px",
                        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.05)"
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => (
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          {value}
                        </span>
                      )}
                    />
                    <Area yAxisId="left" type="monotone" dataKey="logCount" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorLogCount)" name="활동량 (로그 수)" />
                    <Area yAxisId="right" type="monotone" dataKey="userCount" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorUserCount)" name="액티브 사용자 (명)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        </div>

        {/* 활동 유형별 분포 파이 차트 */}
        <div className="lg:col-span-1">
          <SectionCard title={t.activityDistribution || "활동 유형별 분포"}>
            {loadingStats ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : pieChartData.length === 0 ? (
              <div className="flex justify-center items-center h-64 text-xs text-neutral">
                데이터 없음
              </div>
            ) : (
              <div className="h-64 w-full flex flex-row items-center justify-between gap-4">
                <div className="h-48 w-[40%] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value}건`, '건수']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* 커스텀 레전드 (도넛차트 우측에 1개 라인씩 배치) */}
                <div className="flex-1 max-h-full overflow-y-auto px-2 py-1 flex flex-col gap-2.5 text-[10px] sm:text-xs text-neutral">
                  {pieChartData.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-1.5 w-full justify-between">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                        <span className="truncate text-strong dark:text-neutral" title={item.name}>
                          {item.name}
                        </span>
                      </div>
                      <span className="shrink-0 font-semibold text-neutral ml-auto">
                        {item.value}건
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* 상세 로그 필터 및 목록 */}
      <SectionCard title="상세 활동 로그 목록">
        <div className="space-y-4">
          {/* 필터 바 */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 사용자 이메일 검색 */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-assistive" />
              <input
                type="text"
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                placeholder={t.filterUser || "사용자 이메일 검색..."}
                className="w-full bg-normal border border-normal rounded-lg pl-9 pr-3 py-2 text-xs text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder-assistive"
              />
            </div>
            
            {/* 활동 유형 필터 */}
            <div className="w-full sm:w-[220px]">
              <select
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-normal border border-normal rounded-lg px-3 py-2 text-xs text-strong outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              >
                <option value="">{t.allTypes || "전체 유형"}</option>
                <option value="page_view">{formatActivityType("page_view")}</option>
                <option value="search_transactions">{formatActivityType("search_transactions")}</option>
                <option value="region_add">{formatActivityType("region_add")}</option>
                <option value="region_delete">{formatActivityType("region_delete")}</option>
                <option value="rule_create">{formatActivityType("rule_create")}</option>
                <option value="rule_update">{formatActivityType("rule_update")}</option>
                <option value="rule_delete">{formatActivityType("rule_delete")}</option>
                <option value="rule_test">{formatActivityType("rule_test")}</option>
                <option value="preset_create">{formatActivityType("preset_create")}</option>
                <option value="preset_delete">{formatActivityType("preset_delete")}</option>
              </select>
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 bg-warn/10 border border-warn/30 text-warn text-xs px-4 py-3 rounded-lg animate-in fade-in duration-300">
              <ShieldAlert size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 로그 리스트 테이블 */}
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-xs text-neutral border border-dashed border-normal rounded-xl">
              {t.noActivityLogs || "기록된 활동 로그가 없습니다."}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 모바일 뷰 카드 리스트 */}
              {isMobile ? (
                <div className="divide-y divide-normal/40 border border-normal rounded-xl overflow-hidden bg-normal/10">
                  {logs.map((log) => (
                    <div key={log.id} className="p-4 space-y-2 text-xs">
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary">
                          {formatActivityType(log.activityType)}
                        </span>
                        <span className="text-[10px] text-assistive font-mono">
                          {new Date(log.createdAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      
                      <p className="text-strong font-semibold">{log.description}</p>
                      
                      <div className="flex items-center gap-1.5 text-neutral text-[10px]">
                        <User size={10} className="text-assistive" />
                        <span className="truncate max-w-[200px]" title={log.userEmail}>{log.userEmail}</span>
                      </div>
                      
                      <div className="flex items-center justify-between text-[10px] text-assistive pt-1.5 border-t border-normal/20">
                        <span>IP: {log.ipAddress || "-"}</span>
                        {log.payload && (
                          <button
                            onClick={() => setSelectedPayload(log.payload || null)}
                            className="flex items-center gap-1 text-primary hover:underline font-bold"
                          >
                            <Eye size={10} />
                            <span>{t.viewPayload || "상세 데이터"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* 데스크톱 뷰 테이블 */
                <div className="overflow-x-auto border border-normal rounded-xl bg-normal/10">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-normal bg-alternative/60">
                        <th className="px-4 py-2.5 text-left font-bold text-neutral">시간</th>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral">사용자</th>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral">유형</th>
                        <th className="px-4 py-2.5 text-left font-bold text-neutral">상세 내용</th>
                        <th className="px-4 py-2.5 text-center font-bold text-neutral">IP 주소</th>
                        <th className="px-4 py-2.5 text-center font-bold text-neutral">페이로드</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-normal/30">
                      {logs.map((log) => (
                        <tr key={log.id} className="hover:bg-alternative/40 transition-colors">
                          <td className="px-4 py-3 text-neutral font-mono whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString("ko-KR")}
                          </td>
                          <td className="px-4 py-3 text-strong font-medium truncate max-w-[150px]" title={log.userEmail}>
                            {log.userEmail}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary">
                              {formatActivityType(log.activityType)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-strong font-semibold max-w-[300px] truncate" title={log.description}>
                            {log.description}
                          </td>
                          <td className="px-4 py-3 text-center text-neutral font-mono whitespace-nowrap">
                            {log.ipAddress || "-"}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {log.payload ? (
                              <button
                                onClick={() => setSelectedPayload(log.payload || null)}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-normal hover:bg-normal/80 text-primary hover:text-primary/80 font-bold border border-normal transition-colors"
                              >
                                <Eye size={12} />
                                <span>보기</span>
                              </button>
                            ) : (
                              <span className="text-assistive">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 페이징 네비게이션 */}
              <div className="flex items-center justify-between pt-4 border-t border-normal/20">
                <span className="text-[11px] text-neutral font-medium">
                  총 <b className="text-strong font-bold">{total}</b>건 중 {Math.min(total, (page - 1) * limit + 1)} ~ {Math.min(total, page * limit)}번째 항목 표시
                </span>
                
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-2 border border-normal rounded-lg hover:bg-normal/40 disabled:opacity-50 text-neutral transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="px-3 text-xs font-semibold text-strong font-mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-2 border border-normal rounded-lg hover:bg-normal/40 disabled:opacity-50 text-neutral transition-colors"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* 페이로드 JSON 뷰어 모달 */}
      {selectedPayload !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-elevated border border-normal shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in scale-in duration-200">
            <div className="flex items-center justify-between border-b border-normal px-4 py-3 shrink-0">
              <h3 className="text-sm font-bold text-strong flex items-center gap-2">
                <Activity size={16} className="text-primary" />
                <span>상세 페이로드 데이터 (JSON)</span>
              </h3>
              <button
                onClick={() => setSelectedPayload(null)}
                className="rounded-lg p-1.5 text-neutral hover:bg-normal hover:text-strong transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 bg-alternative/30 font-mono text-[11px] text-strong leading-relaxed whitespace-pre-wrap select-all">
              {(() => {
                try {
                  const parsed = JSON.parse(selectedPayload);
                  return JSON.stringify(parsed, null, 2);
                } catch {
                  return selectedPayload;
                }
              })()}
            </div>
            
            <div className="border-t border-normal px-4 py-3 bg-normal/30 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedPayload(null)}
                className="px-4 py-2 bg-primary hover:bg-primary/80 text-white text-xs font-bold rounded-lg transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
