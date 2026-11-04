import { db } from "./db";
import { sparkChat, type ChatMessage, type Tool } from "./muse";
import { computePreferences, describePrefs, memberSwipes, tensions, CARD_BY_ID, type Preferences } from "./game";
import { PlanSchema, PLAN_JSON_SCHEMA, normalizePlan, type Plan } from "./plan-schema";
import { getTransitRoute, routeForModel } from "./tools/routes";
import { searchPlaces } from "./tools/places";
import { searchHotels, offerForModel } from "./tools/liteapi";
import { BudgetExceeded } from "./budget";

/**
 * The planning agent: a tool loop on Muse Spark. It reads everyone's swipe preferences,
 * calls live tools (transit, restaurants, hotels), and finishes by calling finalize_plan
 * with a structured itinerary.
 */

const MAX_TURNS = 24;

/** Reject plans that stop early: every trip day must be present with real content. */
function completenessIssues(plan: Plan, room: { nights: number }): string | null {
  const wantDays = room.nights + 1;
  const problems: string[] = [];
  if (plan.days.length < wantDays) problems.push(`only ${plan.days.length} of ${wantDays} days are present`);
  const thin = plan.days.filter((d) => d.items.length < 3).map((d) => `day ${d.day}`);
  if (thin.length) problems.push(`${thin.join(", ")} ${thin.length === 1 ? "has" : "have"} fewer than 3 items`);
  const nightsCovered = plan.hotels.reduce((n, h) => {
    const a = Date.parse(h.checkin);
    const b = Date.parse(h.checkout);
    return n + (Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86400e3)) : 0);
  }, 0);
  if (nightsCovered < room.nights) problems.push(`hotels cover ${nightsCovered} of ${room.nights} nights`);
  if (!plan.days.some((d) => d.items.some((i) => i.type === "meal"))) problems.push("no meals listed");
  if ((plan.tasks?.length ?? 0) < 4) problems.push(`only ${plan.tasks?.length ?? 0} tasks listed; include 6-10 logistics tasks (money, IC card, seat reservations, advance tickets)`);
  return problems.length ? problems.join("; ") + "." : null;
}

type Room = {
  id: string;
  code: string;
  destination: string;
  origin_city: string;
  start_date: string;
  nights: number;
  status: string;
};
type Member = { id: string; name: string };

function logEvent(roomId: string, kind: string, summary: string, tool?: string) {
  db()
    .prepare("INSERT INTO plan_events (room_id, kind, tool, summary) VALUES (?, ?, ?, ?)")
    .run(roomId, kind, tool ?? null, summary.slice(0, 400));
}

function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function flightLink(origin: string, destCity: string, date: string) {
  const q = `Flights from ${origin} to ${destCity} on ${date}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_transit_route",
      description:
        "Live public-transit route between two places in Japan (Google Routes). Returns train/bus legs with real departure and arrival times, and a booking link. Use for every intercity move and for any long hop within a city.",
      parameters: {
        type: "object",
        required: ["origin", "destination", "departure_time"],
        properties: {
          origin: { type: "string", description: "e.g. 'Tokyo Station, Tokyo, Japan'" },
          destination: { type: "string", description: "e.g. 'Kyoto Station, Kyoto, Japan'" },
          departure_time: { type: "string", description: "ISO 8601 with +09:00 offset, e.g. 2026-11-20T09:00:00+09:00" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Google Places text search. Returns real restaurants with rating, review count, price level and a Google Maps link. Query like 'izakaya near Pontocho Kyoto' or 'best okonomiyaki Dotonbori Osaka'.",
      parameters: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string" }, max: { type: "integer", minimum: 1, maximum: 6 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_hotels",
      description:
        "Live hotel availability and prices (liteAPI). Returns bookable hotels with a bookUrl. Call once per city the group sleeps in, with the exact check-in and check-out dates.",
      parameters: {
        type: "object",
        required: ["city", "checkin", "checkout"],
        properties: {
          city: { type: "string", enum: ["Tokyo", "Kyoto", "Osaka"] },
          checkin: { type: "string", description: "YYYY-MM-DD" },
          checkout: { type: "string", description: "YYYY-MM-DD" },
          adults: { type: "integer", default: 2 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flight_link",
      description:
        "Returns a Google Flights search link for the group's arrival flight (no live prices). Use once for the arrival day if the origin city is outside Japan.",
      parameters: {
        type: "object",
        required: ["origin", "destination_city", "date"],
        properties: {
          origin: { type: "string" },
          destination_city: { type: "string", enum: ["Tokyo", "Osaka"] },
          date: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_plan",
      description:
        "Call exactly once, at the end, with the complete itinerary. Every hotel must come from search_hotels (copy bookUrl exactly). Every transit item must carry the link returned by get_transit_route. Every meal must be a real restaurant from search_restaurants with its Maps link.",
      parameters: PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
  },
];

function systemPrompt(room: Room, members: Member[]) {
  const names = members.map((m) => m.name).join(" and ");
  return `You are Wander, a trip-planning agent for a group of friends. Your job is to turn their swipe preferences into ONE specific, bookable itinerary that is visibly fair to everyone.

Trip: ${room.destination}. Arriving from ${room.origin_city}. Start date ${room.start_date}, ${room.nights} nights (${room.nights + 1} days, last day ends by late afternoon). Travellers: ${names}.

How to work:
1. Read each person's preferences. Identify where they agree and where they clash.
2. Decide the city split (e.g. Tokyo first, then Kyoto with an Osaka evening). Keep at most 2 hotels.
3. Use tools for everything factual. Call get_transit_route for each intercity move and the big hops. Call search_hotels once per sleeping city with exact dates. Call search_restaurants for every meal you list (one query per meal, specific to neighbourhood and cuisine). Call flight_link once for arrival if origin is outside Japan.
4. Then call finalize_plan once.

Rules for the plan:
- Be specific: train line and departure time, hotel name and price, restaurant name and what to order.
- Transit items must be executable: name the service (e.g. "Nozomi 21"), the platform station, departure and arrival times, and the ticket to buy. Day items should chain: the item after a transit leg starts where that leg ends.
- Every item gets a "for" value: a member's name when it is clearly their pick, or ["both"] for shared items. Aim for each person to have roughly equal "wins", and say so in tradeoffs.
- "why" must reference their actual swipes ("Sam picked Golden Gai over Skytree") or an explicit compromise.
- Use the exact links tools return. Never invent URLs. Hotels: copy bookUrl verbatim into hotels[].bookUrl and into the day item link.
- If a transit result says liveSchedule is false, set estimated: true on that item and keep the mapsUrl link.
- Include a hotel check-in item on arrival days and the Shinkansen move as a transit item with its SmartEX link.
- Keep days realistic: 3 to 5 activities, one lunch, one dinner, travel time respected.
- Keep finalize_plan compact: "detail" under 100 characters, "why" under 80, no more than 6 items per day. Cover EVERY day of the trip and every night with a hotel.
- notes: mention that flight links are search links and hotel bookings run in a sandbox.
- tasks: 6-10 logistics tasks that make THIS plan executable, each with a "when" and a concrete "detail": roughly how much cash to carry and where to get yen (airport counter vs 7-Eleven / Japan Post ATMs), Welcome Suica or Suica on phone, reserve the Shinkansen seats on SmartEX (give the date), timed-entry tickets (teamLab, Ghibli, USJ) with the booking window, luggage forwarding between hotels, eSIM, dinner reservations where needed. Tie each task to a day or item in the plan.
Write in plain, warm English. No emojis.`;
}

function prefsBlock(prefs: Preferences[]) {
  const lines = prefs.map((p) => {
    const picks = p.picks.map((t) => `"${t}"`).join(", ");
    const passes = p.passes.map((t) => `"${t}"`).join(", ");
    return `${p.name}: ${describePrefs(p)}.\n  Picked: ${picks}.\n  Passed on: ${passes}.`;
  });
  const t = prefs.length >= 2 ? tensions(prefs[0], prefs[1]) : [];
  return `${lines.join("\n")}\n\nClashes to resolve: ${t.length ? t.join("; ") : "none obvious; look for subtler ones in the picks."}`;
}

async function runTool(roomId: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_transit_route": {
      const r = await getTransitRoute(args as { origin: string; destination: string; departure_time?: string });
      const m = routeForModel(r);
      logEvent(
        roomId,
        "tool",
        `${m.origin} → ${m.destination}: ${m.liveSchedule ? `${m.totalMinutes} min, ${m.legs.length} legs, live schedule` : "schedule unavailable, maps link only"}`,
        name,
      );
      return m;
    }
    case "search_restaurants": {
      const p = await searchPlaces({ query: String(args.query), max: Number(args.max ?? 4) });
      logEvent(roomId, "tool", `"${args.query}" → ${p.map((x) => x.name).slice(0, 3).join(", ")}`, name);
      return p.map((x) => ({ name: x.name, rating: x.rating, reviews: x.reviews, price: x.priceLevel, type: x.type, mapsUrl: x.mapsUrl }));
    }
    case "search_hotels": {
      const h = await searchHotels({
        city: String(args.city),
        checkin: String(args.checkin),
        checkout: String(args.checkout),
        adults: Number(args.adults ?? 2),
        max: 5,
      });
      logEvent(roomId, "tool", `${args.city} ${args.checkin}→${args.checkout}: ${h.length} hotels, from $${Math.min(...h.map((x) => x.perNight))}/night`, name);
      return h.map(offerForModel);
    }
    case "flight_link": {
      const url = flightLink(String(args.origin), String(args.destination_city), String(args.date));
      logEvent(roomId, "tool", `${args.origin} → ${args.destination_city} on ${args.date}: search link`, name);
      return { url, label: "Search flights", note: "Search link, not a live fare." };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

export async function buildPlan(roomId: string): Promise<void> {
  const d = db();
  const room = d.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as Room | undefined;
  if (!room) return;
  const members = d.prepare("SELECT id, name FROM members WHERE room_id = ? ORDER BY created_at").all(roomId) as Member[];
  d.prepare("UPDATE rooms SET status = 'planning' WHERE id = ?").run(roomId);
  d.prepare("DELETE FROM plan_events WHERE room_id = ?").run(roomId);
  logEvent(roomId, "start", `Reading swipes from ${members.map((m) => m.name).join(" and ")}`);

  const prefs = members.map((m) => computePreferences(m.name, memberSwipes(m.id)));
  const endDate = addDays(room.start_date, room.nights);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(room, members) },
    {
      role: "user",
      content: `Dates: ${room.start_date} to ${endDate}. Arriving from ${room.origin_city}.\n\nPreferences from swiping (each person compared ${prefs[0]?.picks.length ?? 0} pairs of places):\n${prefsBlock(prefs)}\n\nAvailable place cards for reference: ${[...CARD_BY_ID.values()].map((c) => `${c.title} (${c.city}, ${c.tags.join("/")})`).join("; ")}.\n\nBuild the plan now. Use the tools, then call finalize_plan.`,
    },
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await sparkChat(messages, TOOLS, { temperature: 0.3, maxTokens: 16000 });
      const choice = res.choices[0];
      const msg = choice?.message;
      if (!msg) throw new Error("Empty response from Muse Spark");
      const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
      const text = (msg.content ?? "").trim();
      if (choice.finish_reason === "length") {
        logEvent(roomId, "thought", "Output was cut off; asking for a tighter plan");
        messages.push({ role: "user", content: "Your last message was cut off. Call finalize_plan again with a more concise itinerary (shorter detail strings)." });
        continue;
      }
      if (!calls.length) {
        // Prose or an empty turn. Only echo it back if it has content; the API rejects empty assistant messages.
        if (text) messages.push({ role: "assistant", content: text });
        logEvent(roomId, "thought", text.slice(0, 200) || "Thinking…");
        messages.push({ role: "user", content: "Continue. When you have what you need, call finalize_plan with the full itinerary." });
        continue;
      }
      // Re-emit a clean assistant message (no provider-specific extras) before the tool results.
      messages.push({
        role: "assistant",
        ...(text ? { content: text } : {}),
        tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.function.name, arguments: c.function.arguments } })),
      } as ChatMessage);
      let finalized: Plan | undefined;
      for (const call of calls) {
        if (call.type !== "function") continue;
        let args: Record<string, unknown> = {};
        let badJson = false;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          badJson = true;
        }
        if (call.function.name === "finalize_plan") {
          if (badJson) {
            const len = (call.function.arguments ?? "").length;
            logEvent(roomId, "thought", `finalize_plan arguments were not valid JSON (${len} chars); asking for a shorter plan`);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({
                ok: false,
                fix: "The arguments were not valid JSON, probably cut off. Call finalize_plan again with the complete plan but shorter strings: detail under 100 characters, why under 80, 3-5 items per day.",
              }),
            });
            continue;
          }
          // Some turns wrap everything in { plan: {...} }; some stringify nested fields. Unwrap before validating.
          if (args.plan && typeof args.plan === "object" && !args.days) args = args.plan as Record<string, unknown>;
          else if (typeof args.plan === "string") {
            try {
              args = JSON.parse(args.plan);
            } catch {
              /* schema will report */
            }
          }
          for (const k of ["days", "hotels", "tradeoffs", "notes", "tasks"]) {
            if (typeof args[k] === "string") {
              try {
                args[k] = JSON.parse(args[k] as string);
              } catch {
                /* leave for the schema to report */
              }
            }
          }
          const parsed = PlanSchema.safeParse(args);
          if (!parsed.success) {
            const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            logEvent(roomId, "thought", `Plan needs fixes: ${issues}`);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, fix: issues }) });
            continue;
          }
          const candidate = normalizePlan(parsed.data);
          const incomplete = completenessIssues(candidate, room);
          if (incomplete) {
            logEvent(roomId, "thought", `Plan incomplete: ${incomplete}`);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ ok: false, fix: `${incomplete} Call finalize_plan again with the COMPLETE itinerary for every day, reusing the tool results you already have.` }),
            });
            continue;
          }
          finalized = candidate;
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
          continue;
        }
        let result: unknown;
        try {
          result = await runTool(roomId, call.function.name, args);
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          logEvent(roomId, "error", `${call.function.name} failed: ${err}`, call.function.name);
          result = { error: err.slice(0, 300) };
          if (e instanceof BudgetExceeded) throw e;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      if (finalized) {
        d.prepare("INSERT INTO plans (room_id, json) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET json = excluded.json, created_at = datetime('now')").run(
          roomId,
          JSON.stringify(finalized),
        );
        d.prepare("UPDATE rooms SET status = 'done' WHERE id = ?").run(roomId);
        logEvent(roomId, "done", `Plan ready: ${finalized.days.length} days, ${finalized.hotels.length} hotels`);
        return;
      }
    }
    throw new Error("Planner did not finish within the turn limit");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logEvent(roomId, "error", err);
    d.prepare("UPDATE rooms SET status = 'error' WHERE id = ?").run(roomId);
  }
}
