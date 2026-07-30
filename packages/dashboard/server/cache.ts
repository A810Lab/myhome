class GraphCache {
  private cache = new Map<string, { value: any; expiry: number }>();

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = 300_000): void {
    this.cache.set(key, { value, expiry: Date.now() + ttlMs });
  }

  /**
   * 특정 키 접두사를 가진 캐시 항목들만 선택적으로 무효화합니다.
   * 데이터베이스에 수집/변경이 발생할 때 전체 캐시 폭파를 방지하여 성능을 보존합니다.
   */
  invalidateByPrefix(prefix: string): void {
    console.log(`[GraphCache] Invalidating caches starting with prefix: "${prefix}"`);
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    console.log("[GraphCache] Clearing all caches due to DB modification.");
    this.cache.clear();
  }
}

export const graphCache = new GraphCache();

// 데이터 성격에 따른 권한화된 TTL 상수 (밀리초 단위)
export const TTL = {
  STATIC: 60 * 60 * 1000,    // 1시간 (db-regions, regions-summary 등 거의 변하지 않는 정적 데이터)
  TREND: 15 * 60 * 1000,     // 15분 (실거래가 월간 추이 등 주기적으로 갱신되는 통계)
  SEARCH: 5 * 60 * 1000,     // 5분 (사용자 필터 조건 검색 및 복잡한 드릴다운 렌더링용)
};
