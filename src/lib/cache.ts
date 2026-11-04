import { db } from "./db";

/** Cache external responses per (api, args) so repeated plan runs cost nothing. */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const d = db();
  const now = Date.now();
  const row = d.prepare("SELECT value, expires_at FROM api_cache WHERE key = ?").get(key) as
    | { value: string; expires_at: number }
    | undefined;
  if (row && row.expires_at > now) return JSON.parse(row.value) as T;
  const value = await fn();
  d.prepare(
    "INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
  ).run(key, JSON.stringify(value), now + ttlSeconds * 1000);
  return value;
}

export function cacheKey(api: string, args: unknown): string {
  return `${api}:${JSON.stringify(args)}`;
}
