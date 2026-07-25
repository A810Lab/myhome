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

  clear(): void {
    console.log("[GraphCache] Clearing all caches due to DB modification.");
    this.cache.clear();
  }
}

export const graphCache = new GraphCache();
