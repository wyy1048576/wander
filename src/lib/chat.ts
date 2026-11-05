import { db, newId } from "./db";
import { sparkChat, type ChatMessage, type Tool } from "./muse";
import { normalizePlan, PlanSchema, type Plan, type PlanItem } from "./plan-schema";
import { addExpense, captionMissing, listTrip, updateExpense, deleteExpense } from "./trip";
import { RESEARCH_TOOL_NAMES, TOOLS as PLAN_TOOLS, runTool } from "./agent";

/**
 * The trip's group chat, with Wander in it. Members talk to each other and to the agent;
 * the agent can edit the itinerary, fix expenses and pull photos from the shared album.
 */

export type ChatMsg = {
  id: number;
  memberId: string | null; // null = Muse, the agent
  memberName: string;
  text: string;
  photoIds: string[];
  actions: string[];
  createdAt: string;
};

let ensured = false;
function ensure() {
  if (ensured) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      member_id TEXT,
      text TEXT NOT NULL,
      photo_ids TEXT,
      actions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

export function listMessages(roomId: string, afterId = 0): ChatMsg[] {
  ensure();
  const names = new Map(
    (db().prepare("SELECT id, name FROM members WHERE room_id = ?").all(roomId) as { id: string; name: string }[]).map((m) => [m.id, m.name]),
  );
  const rows = db()
    .prepare("SELECT id, member_id, text, photo_ids, actions, created_at FROM messages WHERE room_id = ? AND id > ? ORDER BY id LIMIT 200")
    .all(roomId, afterId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    memberId: (r.member_id as string | null) ?? null,
    memberName: r.member_id ? (names.get(String(r.member_id)) ?? "?") : "Muse",
    text: String(r.text),
    photoIds: r.photo_ids ? (JSON.parse(String(r.photo_ids)) as string[]) : [],
    actions: r.actions ? (JSON.parse(String(r.actions)) as string[]) : [],
    createdAt: String(r.created_at),
  }));
}

export function addMessage(roomId: string, memberId: string | null, text: string, photoIds: string[] = [], actions: string[] = []): number {
  ensure();
  const r = db()
    .prepare("INSERT INTO messages (room_id, member_id, text, photo_ids, actions) VALUES (?, ?, ?, ?, ?)")
    .run(roomId, memberId, text, photoIds.length ? JSON.stringify(photoIds) : null, actions.length ? JSON.stringify(actions) : null);
  return Number(r.lastInsertRowid);
}

function loadPlan(roomId: string): Plan | null {
  const row = db().prepare("SELECT json FROM plans WHERE room_id = ?").get(roomId) as { json: string } | undefined;
  return row ? normalizePlan(JSON.parse(row.json) as Plan) : null;
}
function savePlan(roomId: string, plan: Plan) {
  const ok = PlanSchema.safeParse(plan);
  if (!ok.success) throw new Error("plan would become invalid: " + ok.error.issues[0]?.message);
  db().prepare("UPDATE plans SET json = ? WHERE room_id = ?").run(JSON.stringify(normalizePlan(ok.data)), roomId);
}

const ITEM_FIELDS = {
  type: "object",
  properties: {
    time: { type: "string" },
    type: { type: "string", enum: ["place", "meal", "transit", "hotel", "flight", "free"] },
    title: { type: "string" },
    detail: { type: "string" },
    how: { type: "string" },
    cost: { type: "string" },
    for: { type: "array", items: { type: "string" } },
    why: { type: "string" },
    link: { type: "object", properties: { label: { type: "string" }, url: { type: "string" } } },
    estimated: { type: "boolean" },
  },
};

const RESEARCH: Tool[] = PLAN_TOOLS.filter((t) => t.type === "function" && (RESEARCH_TOOL_NAMES as readonly string[]).includes(t.function.name));

const TOOLS: Tool[] = [
  ...RESEARCH,
  {
    type: "function",
    function: {
      name: "update_plan_item",
      description: "Change fields of one itinerary item. Identify it by day number and the item's position (1-based) as listed in the plan you were given.",
      parameters: { type: "object", required: ["day", "position", "changes"], properties: { day: { type: "integer" }, position: { type: "integer" }, changes: ITEM_FIELDS } },
    },
  },
  {
    type: "function",
    function: {
      name: "add_plan_item",
      description: "Insert a new itinerary item into a day at a position (1-based; omit to append). Give time, type, title, detail, how, cost, for, why.",
      parameters: { type: "object", required: ["day", "item"], properties: { day: { type: "integer" }, position: { type: "integer" }, item: { ...ITEM_FIELDS, required: ["time", "type", "title"] } } },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_plan_item",
      description: "Remove one itinerary item by day and position (1-based).",
      parameters: { type: "object", required: ["day", "position"], properties: { day: { type: "integer" }, position: { type: "integer" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "update_expense",
      description: "Edit an expense row by id: any of at (YYYY-MM-DDTHH:mm), title, category, amount, currency, note, memberId (who paid).",
      parameters: {
        type: "object",
        required: ["id", "changes"],
        properties: {
          id: { type: "string" },
          changes: { type: "object", properties: { at: { type: "string" }, title: { type: "string" }, category: { type: "string" }, amount: { type: "number" }, currency: { type: "string" }, note: { type: "string" }, memberId: { type: "string" } } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_expense",
      description: "Add an expense row.",
      parameters: {
        type: "object",
        required: ["title", "amount", "currency", "memberId"],
        properties: { at: { type: "string" }, title: { type: "string" }, category: { type: "string" }, amount: { type: "number" }, currency: { type: "string" }, note: { type: "string" }, memberId: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_expense",
      description: "Delete an expense row by id.",
      parameters: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "show_photos",
      description: "Attach photos from the shared album to your reply, by photo id.",
      parameters: { type: "object", required: ["photoIds"], properties: { photoIds: { type: "array", items: { type: "string" } } } },
    },
  },
];

function planForModel(plan: Plan) {
  return plan.days
    .map(
      (d) =>
        `Day ${d.day} (${d.date}, ${d.city}):\n` +
        d.items.map((it, i) => `  ${i + 1}. ${it.time} [${it.type}] ${it.title}${it.detail ? ` — ${it.detail}` : ""}${it.cost ? ` (${it.cost})` : ""}${it.for?.length ? ` for ${it.for.join("&")}` : ""}`).join("\n"),
    )
    .join("\n");
}

/** Run one agent turn for the latest message. Stores the reply (unless the agent stays silent). */
export async function runChatTurn(roomId: string, code: string): Promise<void> {
  const room = db().prepare("SELECT destination, start_date, nights FROM rooms WHERE id = ?").get(roomId) as { destination: string; start_date: string; nights: number };
  const members = db().prepare("SELECT id, name, is_host FROM members WHERE room_id = ? ORDER BY created_at").all(roomId) as { id: string; name: string; is_host: number }[];
  const history = listMessages(roomId).slice(-30);
  const plan = loadPlan(roomId);
  await captionMissing(roomId); // so photos can be picked by what they show
  const trip = listTrip(roomId);
  const actions: string[] = [];
  const attach: string[] = [];

  const system = `You are Muse, the trip agent (the app is called Wander), and you are a member of this group chat for the trip "${room.destination}" (${room.start_date}, ${room.nights} nights).
Members: ${members.map((m) => `${m.name} (id ${m.id})`).join(", ")}. Room code ${code}.
You can edit the itinerary (update_plan_item / add_plan_item / remove_plan_item), fix or add expenses (update_expense / add_expense / delete_expense) and show photos from the shared album (show_photos). You also have the research tools: search_restaurants for any new restaurant (never invent one; use its real name and Maps link), get_walking_route for any new walk (write how from its real steps), search_hotels and get_transit_route. Research first, then make the change with an edit tool, then reply.
Style: a helpful friend in the chat, 1-3 short sentences, no headers or bullet lists, no emojis. Confirm exactly what you changed. When you edit an item, keep the plan's standard: specific trains/platforms/exits, walking steps, costs. If a message is just members talking to each other and nothing is asked of you, reply with exactly: SILENT

CURRENT PLAN (positions are 1-based within each day):
${plan ? planForModel(plan) : "(no plan yet)"}

EXPENSES (id · when · title · amount currency · category · paid by):
${trip.expenses.map((e) => `${e.id} · ${e.at} · ${e.title} · ${e.amount} ${e.currency} · ${e.category} · ${e.memberName}`).join("\n") || "(none)"}

PHOTOS in the album (id · by · when · what it shows · kind). Pick photos by what they show; attach only the ones that match the request:
${trip.photos.map((p) => `${p.id} · ${p.memberName} · ${p.createdAt} · ${p.caption ?? ""} · ${p.kind}`).join("\n") || "(none)"}`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((m): ChatMessage => (m.memberId ? { role: "user", content: `${m.memberName}: ${m.text}` } : { role: "assistant", content: m.text })),
  ];

  let reply = "";
  for (let turn = 0; turn < 6; turn++) {
    const res = await sparkChat(messages, TOOLS, { temperature: 0.3, maxTokens: 6000 });
    const msg = res.choices[0]?.message;
    if (!msg) break;
    const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
    if (!calls.length) {
      reply = (msg.content ?? "").trim();
      break;
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* ignore */
      }
      let result: unknown;
      try {
        result = (RESEARCH_TOOL_NAMES as readonly string[]).includes(call.function.name)
          ? await runTool(roomId, call.function.name, args)
          : applyTool(roomId, call.function.name, args, actions, attach, trip);
      } catch (e) {
        result = { error: String((e as Error).message ?? e).slice(0, 200) };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  if (!reply && actions.length) reply = "Done: " + actions.join("; ");
  if (!reply || /^SILENT\.?$/i.test(reply)) return;
  addMessage(roomId, null, reply, attach, actions);
}

function applyTool(roomId: string, name: string, a: Record<string, unknown>, actions: string[], attach: string[], trip: ReturnType<typeof listTrip>): unknown {
  switch (name) {
    case "update_plan_item":
    case "add_plan_item":
    case "remove_plan_item": {
      const plan = loadPlan(roomId);
      if (!plan) return { error: "no plan" };
      const day = plan.days.find((d) => d.day === Number(a.day));
      if (!day) return { error: `no day ${a.day}` };
      if (name === "update_plan_item") {
        const i = Number(a.position) - 1;
        if (!day.items[i]) return { error: `no item ${a.position} on day ${a.day}` };
        const changes = (a.changes ?? {}) as Partial<PlanItem>;
        day.items[i] = { ...day.items[i], ...changes };
        actions.push(`Day ${day.day} item ${i + 1} "${day.items[i].title}" updated (${Object.keys(changes).join(", ")})`);
      } else if (name === "add_plan_item") {
        const item = { for: ["both"], ...(a.item as Partial<PlanItem>) } as PlanItem;
        const pos = a.position ? Number(a.position) - 1 : day.items.length;
        day.items.splice(Math.max(0, Math.min(pos, day.items.length)), 0, item);
        actions.push(`Day ${day.day}: added "${item.title}" at ${item.time}`);
      } else {
        const i = Number(a.position) - 1;
        const [removed] = day.items.splice(i, 1);
        if (!removed) return { error: `no item ${a.position}` };
        actions.push(`Day ${day.day}: removed "${removed.title}"`);
      }
      savePlan(roomId, plan);
      return { ok: true, day: day.items.map((it, i) => `${i + 1}. ${it.time} ${it.title}`) };
    }
    case "update_expense": {
      const id = String(a.id);
      const e = trip.expenses.find((x) => x.id === id);
      if (!e) return { error: "no such expense" };
      updateExpense(id, (a.changes ?? {}) as Record<string, unknown>);
      actions.push(`Expense "${e.title}" updated`);
      return { ok: true };
    }
    case "add_expense": {
      const id = addExpense(roomId, {
        memberId: String(a.memberId),
        at: String(a.at ?? new Date().toISOString().slice(0, 16)),
        title: String(a.title),
        category: String(a.category ?? "other"),
        amount: Number(a.amount) || 0,
        currency: String(a.currency ?? "JPY"),
        note: a.note ? String(a.note) : null,
        photoId: null,
      });
      actions.push(`Expense "${a.title}" added`);
      return { ok: true, id };
    }
    case "delete_expense": {
      deleteExpense(String(a.id));
      actions.push("Expense deleted");
      return { ok: true };
    }
    case "show_photos": {
      const ids = ((a.photoIds ?? []) as string[]).filter((id) => trip.photos.some((p) => p.id === id)).slice(0, 12);
      attach.push(...ids);
      return { ok: true, attached: ids.length };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
