import { db, newId } from "./db";
import { meta, SPARK_MODEL } from "./muse";
import { spend } from "./budget";
import type { Plan } from "./plan-schema";

/** During-the-trip companion: shared expenses (from receipts or by hand) and a shared photo gallery. */

export type Expense = {
  id: string;
  memberId: string;
  memberName: string;
  at: string; // "YYYY-MM-DDTHH:mm"
  title: string;
  category: string;
  amount: number;
  currency: string;
  note: string | null;
  photoId: string | null;
};
export type PhotoMeta = {
  id: string;
  memberId: string;
  memberName: string;
  kind: "gallery" | "receipt";
  caption: string | null;
  createdAt: string;
};

export const CATEGORIES = ["food", "transport", "lodging", "tickets", "shopping", "other"] as const;

// These tables were added after the first deployments; create them lazily so a running server needs no restart.
let ensured = false;
function ensure() {
  if (ensured) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, member_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'gallery',
      mime TEXT NOT NULL, bytes BLOB NOT NULL, caption TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, member_id TEXT NOT NULL, at TEXT NOT NULL, title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other', amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'JPY',
      note TEXT, photo_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

function memberNames(roomId: string) {
  const rows = db().prepare("SELECT id, name FROM members WHERE room_id = ?").all(roomId) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function listTrip(roomId: string): { expenses: Expense[]; photos: PhotoMeta[] } {
  ensure();
  const names = memberNames(roomId);
  const ex = db()
    .prepare("SELECT id, member_id, at, title, category, amount, currency, note, photo_id FROM expenses WHERE room_id = ? ORDER BY at, created_at")
    .all(roomId) as Record<string, unknown>[];
  const ph = db()
    .prepare("SELECT id, member_id, kind, caption, created_at FROM photos WHERE room_id = ? ORDER BY created_at DESC")
    .all(roomId) as Record<string, unknown>[];
  return {
    expenses: ex.map((r) => ({
      id: String(r.id),
      memberId: String(r.member_id),
      memberName: names.get(String(r.member_id)) ?? "?",
      at: String(r.at),
      title: String(r.title),
      category: String(r.category),
      amount: Number(r.amount),
      currency: String(r.currency),
      note: (r.note as string | null) ?? null,
      photoId: (r.photo_id as string | null) ?? null,
    })),
    photos: ph.map((r) => ({
      id: String(r.id),
      memberId: String(r.member_id),
      memberName: names.get(String(r.member_id)) ?? "?",
      kind: (r.kind as "gallery" | "receipt") ?? "gallery",
      caption: (r.caption as string | null) ?? null,
      createdAt: String(r.created_at),
    })),
  };
}

export function addPhoto(roomId: string, memberId: string, kind: "gallery" | "receipt", mime: string, bytes: Uint8Array, caption?: string) {
  ensure();
  const id = newId();
  db()
    .prepare("INSERT INTO photos (id, room_id, member_id, kind, mime, bytes, caption) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, roomId, memberId, kind, mime, bytes, caption ?? null);
  return id;
}

export function getPhoto(id: string): { mime: string; bytes: Uint8Array } | undefined {
  ensure();
  const r = db().prepare("SELECT mime, bytes FROM photos WHERE id = ?").get(id) as { mime: string; bytes: Uint8Array } | undefined;
  return r;
}

export function addExpense(roomId: string, e: Omit<Expense, "id" | "memberName">) {
  ensure();
  const id = newId();
  db()
    .prepare("INSERT INTO expenses (id, room_id, member_id, at, title, category, amount, currency, note, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, roomId, e.memberId, e.at, e.title, e.category, e.amount, e.currency.toUpperCase(), e.note ?? null, e.photoId ?? null);
  return id;
}

const EDITABLE = new Set(["at", "title", "category", "amount", "currency", "note", "member_id"]);
export function updateExpense(id: string, patch: Record<string, unknown>) {
  ensure();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = k === "memberId" ? "member_id" : k;
    if (!EDITABLE.has(col)) continue;
    sets.push(`${col} = ?`);
    vals.push(col === "amount" ? Number(v) || 0 : col === "currency" ? String(v).toUpperCase().slice(0, 3) : v == null ? null : String(v));
  }
  if (!sets.length) return;
  db().prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as (string | number | null)[]), id);
}

export function deleteExpense(id: string) {
  ensure();
  db().prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

export type ReceiptRead = {
  merchant?: string;
  date?: string;
  time?: string;
  total?: number;
  currency?: string;
  category?: string;
  items?: { name: string; price?: number }[];
};

/** Ask Muse Spark to read a receipt photo. Returns null if the model cannot read it. */
export async function readReceipt(mime: string, bytes: Uint8Array, hint?: { date?: string; city?: string }): Promise<ReceiptRead | null> {
  const b64 = Buffer.from(bytes).toString("base64");
  // Muse Spark reasons for ~1,500-2,500 hidden tokens on a real receipt before answering; give it room,
  // and try once more with a bigger budget if the answer is still cut off.
  let text = "";
  for (const maxTokens of [6000, 12000]) {
    spend("meta");
    const r = await meta().chat.completions.create({
      model: SPARK_MODEL,
      max_tokens: maxTokens,
      temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You read receipts for a travel expense log. Reply with JSON only: {"merchant": string, "date": "YYYY-MM-DD", "time": "HH:mm", "total": number, "currency": "JPY"|"USD"|..., "category": "food"|"transport"|"lodging"|"tickets"|"shopping"|"other", "items": [{"name": string, "price": number}]}. Use the grand total actually paid. If a field is unreadable, omit it. Japanese receipts: 合計 or お買上 is the total; 税込 means tax included.',
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Read this receipt.${hint?.date ? ` The trip date is around ${hint.date}.` : ""}${hint?.city ? ` Location: ${hint.city}.` : ""}` },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      },
    ],
    });
    text = r.choices[0]?.message?.content ?? "";
    if (text || r.choices[0]?.finish_reason !== "length") break;
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as ReceiptRead;
  } catch {
    return null;
  }
}


/** "¥3,070 pp" -> 3070 JPY per person; "$568 total" -> 568 USD; "SGD 600-800 rtn est" -> 600 SGD; "free" -> null. */
export function parseCost(text: string | undefined): { amount: number; currency: string; perPerson: boolean } | null {
  if (!text) return null;
  const t = text.trim();
  if (/^(free|none|included|incl\.?)$/i.test(t) || (/\bfree\b/i.test(t) && !/\d/.test(t))) return null;
  const m = t.match(/(?:([¥$€£])|\b(JPY|USD|SGD|EUR|GBP|KRW|TWD|AUD|HKD|CNY|THB|MYR)\b)?\s*(\d[\d,]*(?:\.\d+)?)/i);
  if (!m) return null;
  const amount = Number(m[3].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sym = m[1];
  const code = (m[2] ?? (sym === "¥" ? "JPY" : sym === "$" ? "USD" : sym === "€" ? "EUR" : sym === "£" ? "GBP" : "JPY")).toUpperCase();
  return { amount, currency: code, perPerson: /\bpp\b|per person|\beach\b|\/person/i.test(t) };
}

const TYPE_CATEGORY: Record<string, string> = { hotel: "lodging", flight: "transport", transit: "transport", meal: "food", place: "tickets", free: "other" };

/** Pre-fill the expense table with what the plan already prices: hotels, flight, fares, tickets, meals. Runs once per room. */
export function seedExpensesFromPlan(roomId: string, plan: Plan): number {
  ensure();
  const existing = (db().prepare("SELECT COUNT(*) c FROM expenses WHERE room_id = ? AND note LIKE 'From the plan%'").get(roomId) as { c: number }).c;
  if (existing > 0) return 0;
  const members = db().prepare("SELECT id, is_host FROM members WHERE room_id = ? ORDER BY is_host DESC, created_at").all(roomId) as { id: string; is_host: number }[];
  if (!members.length) return 0;
  const payer = members[0].id;
  const n = members.length;
  let added = 0;
  for (const h of plan.hotels) {
    const amount = h.totalUSD ?? (h.perNightUSD ? h.perNightUSD * Math.max(1, Math.round((Date.parse(h.checkout) - Date.parse(h.checkin)) / 86400e3)) : 0);
    if (!amount) continue;
    addExpense(roomId, { memberId: payer, at: `${h.checkin}T15:00`, title: `Hotel: ${h.name}`, category: "lodging", amount, currency: "USD", note: `From the plan: ${h.city}, ${h.checkin} to ${h.checkout}${h.room ? `, ${h.room}` : ""}. Sandbox rate.`, photoId: null });
    added++;
  }
  for (const d of plan.days) {
    for (const it of d.items) {
      if (it.type === "hotel") continue; // hotels are added once above
      const c = parseCost(it.cost);
      if (!c && it.type === "flight") {
        const time = (it.time.match(/\d{1,2}:\d{2}/)?.[0] ?? "08:00").padStart(5, "0");
        addExpense(roomId, { memberId: payer, at: `${d.date}T${time}`, title: it.title, category: "transport", amount: 0, currency: "USD", note: "From the plan: fare not fixed yet, book on the airline site and enter the amount.", photoId: null });
        added++;
        continue;
      }
      if (!c) continue;
      const time = (it.time.match(/\d{1,2}:\d{2}/)?.[0] ?? "12:00").padStart(5, "0");
      addExpense(roomId, {
        memberId: payer,
        at: `${d.date}T${time}`,
        title: it.title,
        category: TYPE_CATEGORY[it.type] ?? "other",
        amount: c.perPerson ? c.amount * n : c.amount,
        currency: c.currency,
        note: `From the plan: ${it.cost}${c.perPerson ? ` × ${n}` : ""}${it.estimated ? " (estimated)" : ""}`,
        photoId: null,
      });
      added++;
    }
  }
  return added;
}
