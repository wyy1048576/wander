import { db } from "./db";

/**
 * Hard daily call budget per external API, enforced in code.
 * Replaces console-side quota caps. Throws once the cap is reached.
 */
export type Api = "google" | "meta" | "liteapi";

const DEFAULT_CAPS: Record<Api, number> = { google: 500, meta: 300, liteapi: 300 };

function cap(api: Api): number {
  const env = process.env[`MAX_${api.toUpperCase()}_CALLS_PER_DAY`];
  const n = env ? Number(env) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAPS[api];
}

export class BudgetExceeded extends Error {
  constructor(public api: Api, public limit: number) {
    super(`Daily call budget exceeded for ${api} (${limit}/day)`);
  }
}

export function spend(api: Api): void {
  const day = new Date().toISOString().slice(0, 10);
  const d = db();
  const row = d.prepare("SELECT count FROM api_calls WHERE api = ? AND day = ?").get(api, day) as
    | { count: number }
    | undefined;
  const used = row?.count ?? 0;
  const limit = cap(api);
  if (used >= limit) throw new BudgetExceeded(api, limit);
  d.prepare(
    "INSERT INTO api_calls (api, day, count) VALUES (?, ?, 1) ON CONFLICT(api, day) DO UPDATE SET count = count + 1",
  ).run(api, day);
}

export function usage(): Record<string, number> {
  const day = new Date().toISOString().slice(0, 10);
  const rows = db().prepare("SELECT api, count FROM api_calls WHERE day = ?").all(day) as {
    api: string;
    count: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.api, r.count]));
}
