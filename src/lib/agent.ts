import { db } from "./db";
import { sparkChat, type ChatMessage, type Tool } from "./muse";
import { computePreferences, describePrefs, memberSwipes, tensions, type Preferences, deckFor } from "./game";
import { destination } from "./destinations";
import { flightLink } from "./tools/flights";
import { PlanSchema, PLAN_JSON_SCHEMA, normalizePlan, type Plan, DaySchema, type PlanDay } from "./plan-schema";
import { getTransitRoute, getWalkingRoute, routeForModel } from "./tools/routes";
import { searchPlaces } from "./tools/places";
import { searchHotels, offerForModel } from "./tools/liteapi";
import { BudgetExceeded } from "./budget";

/**
 * The planning agent: a tool loop on Muse Spark. It reads everyone's swipe preferences,
 * calls live tools (transit, restaurants, hotels), and finishes by calling finalize_plan
 * with a structured itinerary.
 */

const MAX_TURNS = 34;

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
  const eligible = plan.days.flatMap((d) => d.items.slice(1));
  const withHow = eligible.filter((i) => (i.how ?? "").trim().length >= 20).length;
  if (eligible.length && withHow / eligible.length < 0.7)
    problems.push(`only ${withHow} of ${eligible.length} items say how to get there; every item after the first of a day needs "how" (line, platform/exit, times, fare)`);
  return problems.length ? problems.join("; ") + "." : null;
}

type Room = {
  id: string;
  code: string;
  destination: string;
  dest_key: string | null;
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


const DAY_JSON_SCHEMA = PLAN_JSON_SCHEMA.properties.days.items;
const { days: _daysSchema, ...FINAL_PROPS } = PLAN_JSON_SCHEMA.properties;
void _daysSchema;
const FINALIZE_JSON_SCHEMA = {
  type: "object",
  required: ["title", "summary", "tradeoffs", "hotels", "tasks"],
  properties: {
    ...FINAL_PROPS,
    days: { type: "array", description: "Leave out: days are submitted with add_day.", items: DAY_JSON_SCHEMA },
  },
};

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
      name: "get_walking_route",
      description:
        "Real turn-by-turn walking directions between two places (Google Routes, works everywhere in Japan). Returns metres, minutes and the street-level steps with landmarks. Call it for EVERY hop between consecutive items that is walked (hotel to station, station exit to restaurant, sight to sight), and build the item's \"how\" from the steps. Use specific names or addresses as returned by the other tools.",
      parameters: {
        type: "object",
        required: ["origin", "destination"],
        properties: {
          origin: { type: "string", description: "e.g. 'THE TOURIST HOTEL & Cafe AKIHABARA, Tokyo' or 'Akihabara Station Electric Town exit'" },
          destination: { type: "string", description: "e.g. 'Torarenbo, Akihabara, Tokyo'" },
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
          city: {
            type: "string",
            description: "City the group sleeps in, e.g. Tokyo, Kyoto, Osaka, Nara, Fukuoka, Nagasaki, Kumamoto, Beppu, Yufuin, Kagoshima",
          },
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
        "Returns the airline's OFFICIAL booking link for a specific flight you name (no live prices). Decide the best flight yourself from what you know of the route (airline, flight number, scheduled departure and arrival), then call this with airline_code and flight_number. Use once for the arrival day if the origin city is outside Japan (Tokyo for Tokyo trips, Osaka for Kansai and Nara, Fukuoka for Kyushu), and for a domestic hop when flying beats the train.",
      parameters: {
        type: "object",
        required: ["origin", "destination_city", "date", "airline_code", "flight_number"],
        properties: {
          origin: { type: "string", description: "City or IATA code, e.g. 'Singapore' or 'SFO'" },
          destination_city: { type: "string", enum: ["Tokyo", "Osaka", "Fukuoka"] },
          date: { type: "string", description: "YYYY-MM-DD" },
          airline_code: { type: "string", description: "IATA airline code, e.g. SQ, NH, JL, UA, DL" },
          flight_number: { type: "string", description: "e.g. SQ638" },
          adults: { type: "integer", default: 2 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_day",
      description:
        "Submit ONE day of the itinerary. Call it once per day, in order (day 1 first), one call per turn, after all research is done. 4-5 items per day, each with time, type, title, detail, how (getting there from the previous item), cost, for, why, and the link the tools returned. Every meal must be a real restaurant from search_restaurants with its Maps link; every transit item carries the link from get_transit_route; hotel check-in items carry the hotel bookUrl.",
      parameters: DAY_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_plan",
      description:
        "Call exactly once, after every day has been submitted with add_day: title, summary, tradeoffs, hotels (copy bookUrl exactly from search_hotels), tasks and notes. Do not resend the days.",
      parameters: FINALIZE_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
  },
];

function systemPrompt(room: Room, members: Member[]) {
  const names = members.map((m) => m.name).join(" and ");
  return `You are Wander, a trip-planning agent for a group of friends. Your job is to turn their swipe preferences into ONE specific, bookable itinerary that is visibly fair to everyone.

Trip: ${room.destination}. Arriving from ${room.origin_city}. Start date ${room.start_date}, ${room.nights} nights (${room.nights + 1} days, last day ends by late afternoon). Travellers: ${names}.

How to work:
1. Read each person's preferences. Identify where they agree and where they clash.
2. Decide the city split. ${destination(room.dest_key).brief}
3. Use tools for everything factual. Call get_walking_route for every walked hop between consecutive items (there will be many; that is the point). Call get_transit_route for each intercity move and the big hops. Call search_hotels once per sleeping city with exact dates. Call search_restaurants for every meal you list (one query per meal, specific to neighbourhood and cuisine). Call flight_link once for arrival if origin is outside Japan, and for a domestic hop (e.g. Tokyo to Fukuoka) when flying beats the train.
4. Submit the itinerary one day at a time with add_day: day 1 first, one call per turn, 4-5 items each. Short strings; each call must be quick.
5. Then call finalize_plan once with title, summary, tradeoffs, hotels, tasks and notes (no days).

Rules for the plan:
- Be specific: train line and departure time, hotel name and price, restaurant name and what to order.
- AUTOPILOT, not copilot. The traveller must never have to look anything up. Every item after the first of a day carries "how": exactly how to get there from the previous item.
  * Walked hops: call get_walking_route(previous place, this place) and write "how" from the REAL steps: distance, minutes, the 2-3 decisive turns with street names or landmarks, e.g. "11 min, 730 m: out of the hotel head south, left after Futaba, right onto Showa-dori, right after Aisan Denki past BicCamera". Never invent a walk.
  * Train or metro hops: station, line, direction (toward ...), platform number, number of stops, fare, IC card vs ticket, arrival station exit number, THEN the walk from that exit (call get_walking_route from "<station> <exit>" to the place). e.g. "Hibiya line pf 3 toward Naka-Meguro, 4 stops to Ginza (¥180 IC), exit A2, then 4 min: right on Chuo-dori, left at Matsuya".
  * Taxi only when it saves 20+ minutes; say the fare.
  Transit items also put service name, platform and times in "detail".
- The arrival flight is a specific flight: airline, flight number, scheduled departure and arrival (from your knowledge, estimated: true), terminal on arrival, in "detail". Its link is the flight_link result (the airline's official booking page). In "how", say where to check in and the recommended time at the airport.
- Arrival day opens with the airport-to-hotel journey as its own transit item: terminal, the specific train or bus (e.g. Narita Express platform 1 at 11:15 → Tokyo 12:10, ¥3,070, buy at the JR East counter in arrivals; or Keisei Skyliner; or Haruka from Kansai), then the last hop to the hotel's nearest station and exit. Hotel check-in item: nearest station, exit, and where to leave bags before check-in.
- Give the fare or entry price in "cost" wherever it is known. Timed-entry places: say where to buy the ticket. Restaurants: what to order and whether to queue or reserve.
- Car rental only where it genuinely beats trains (e.g. Takachiho, Yufuin countryside): name the company and counter location, pick-up and return times, estimated cost, and a search link.
- Day items chain: the item after a journey starts where that journey ends. Times must be consistent with the stated durations.
- Every item gets a "for" value: a member's name when it is clearly their pick, or ["both"] for shared items. Aim for each person to have roughly equal "wins", and say so in tradeoffs.
- "why" must reference their actual swipes ("Sam picked Golden Gai over Skytree") or an explicit compromise.
- Use the exact links tools return. Never invent URLs. Hotels: copy bookUrl verbatim into hotels[].bookUrl and into the day item link.
- If a transit result says liveSchedule is false, set estimated: true on that item and keep the mapsUrl link.
- Include a hotel check-in item on arrival days and the Shinkansen move as a transit item with its SmartEX link.
- Keep days realistic: 3 to 5 activities, one lunch, one dinner, travel time respected.
- Keep every call compact: at most 5 items per day, "detail" under 80 characters, "how" under 200, "why" under 60, 6-8 tasks. Cover EVERY day of the trip (one add_day per day) and every night with a hotel.
- notes: mention that flight links are search links and hotel bookings run in a sandbox.
- tasks: 6-8 logistics tasks that make THIS plan executable, each with a "when" and a concrete "detail": roughly how much cash to carry and where to get yen (airport counter vs 7-Eleven / Japan Post ATMs), Welcome Suica or Suica on phone, reserve the Shinkansen seats on SmartEX (give the date), timed-entry tickets (teamLab, Ghibli, USJ) with the booking window, luggage forwarding between hotels, eSIM, dinner reservations where needed. Tie each task to a day or item in the plan.
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
    case "get_walking_route": {
      const w = await getWalkingRoute({ origin: String(args.origin), destination: String(args.destination) });
      logEvent(roomId, "tool", `${w.origin} → ${w.destination}: ${w.unavailable ? "no walking route" : `${w.meters} m, ${w.minutes} min, ${w.steps.length} steps`}`, name);
      return w;
    }
    case "search_hotels": {
      const h = await searchHotels({
        city: String(args.city),
        checkin: String(args.checkin),
        checkout: String(args.checkout),
        adults: Number(args.adults ?? 2),
        max: 5,
      });
      logEvent(roomId, "tool", h.length ? `${args.city} ${args.checkin}→${args.checkout}: ${h.length} hotels, from $${Math.min(...h.map((x) => x.perNight))}/night` : `${args.city} ${args.checkin}→${args.checkout}: no sandbox rates for these dates, try another base city`, name);
      return h.map(offerForModel);
    }
    case "flight_link": {
      const f = flightLink({
        origin: String(args.origin),
        destination_city: String(args.destination_city),
        date: String(args.date),
        airline_code: args.airline_code ? String(args.airline_code) : undefined,
        flight_number: args.flight_number ? String(args.flight_number) : undefined,
        adults: Number(args.adults ?? 2),
      });
      logEvent(
        roomId,
        "tool",
        `${f.flightNumber ?? "flight"} ${f.from} → ${f.to} on ${f.date}: ${f.official ? `official ${f.airline} booking link` : "search link"}`,
        name,
      );
      return { url: f.bookUrl, label: f.bookLabel, official: f.official, compareUrl: f.compareUrl, note: f.note };
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
      content: `Dates: ${room.start_date} to ${endDate}. Arriving from ${room.origin_city}.\n\nPreferences from swiping (each person compared ${prefs[0]?.picks.length ?? 0} pairs of places):\n${prefsBlock(prefs)}\n\nAvailable place cards for reference: ${deckFor(destination(room.dest_key)).map((c) => `${c.title} (${c.city}, ${c.tags.join("/")})`).join("; ")}.\n\nBuild the plan now. Use the tools, then call finalize_plan.`,
    },
  ];

  let dropped = 0;
  const dayBuffer = new Map<number, PlanDay>();
  const wantDays = room.nights + 1;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let res;
      try {
        res = await sparkChat(messages, TOOLS, { temperature: 0.3, maxTokens: 16000 });
      } catch (e) {
        // Meta's gateway drops very long generations ("Connection error"). Ask for a tighter plan and go again.
        const msg = String((e as Error).message ?? e);
        if (/connection|ECONNRESET|socket|terminated|fetch failed/i.test(msg) && dropped < 2) {
          dropped++;
          logEvent(roomId, "thought", `Connection dropped while writing the plan (${dropped}/2); asking for a tighter plan`);
          messages.push({
            role: "user",
            content:
              "The connection dropped while you were writing. Continue with shorter strings: submit the next missing day with add_day (4 items, \"how\" under 100 characters), one day per call, then finalize_plan. Reuse the tool results you already have; do not call tools again.",
          });
          continue;
        }
        throw e;
      }
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
        if (call.function.name === "add_day") {
          if (badJson) {
            logEvent(roomId, "thought", "add_day arguments were not valid JSON; asking for a shorter day");
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ ok: false, fix: "Not valid JSON, probably cut off. Resend this day with shorter strings (4 items, how under 100 characters)." }),
            });
            continue;
          }
          if (args.day && typeof args.day === "object") args = args.day as Record<string, unknown>;
          if (typeof args.items === "string") {
            try {
              args.items = JSON.parse(args.items);
            } catch {
              /* schema will report */
            }
          }
          const parsedDay = DaySchema.safeParse(args);
          if (!parsedDay.success) {
            const issues = parsedDay.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
            logEvent(roomId, "thought", `Day needs fixes: ${issues}`);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, fix: issues }) });
            continue;
          }
          const dayOk = parsedDay.data;
          dayBuffer.set(dayOk.day, dayOk);
          const have = [...dayBuffer.keys()].sort((a, b) => a - b);
          const missing = Array.from({ length: wantDays }, (_, i) => i + 1).filter((n) => !dayBuffer.has(n));
          logEvent(roomId, "thought", `Day ${dayOk.day} written: ${dayOk.items.length} items in ${dayOk.city}`);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              days_submitted: have,
              next: missing.length ? `add_day for day ${missing[0]}` : "finalize_plan (title, summary, tradeoffs, hotels, tasks, notes)",
            }),
          });
          continue;
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
                fix: "The arguments were not valid JSON, probably cut off. Call finalize_plan again with shorter strings (title, summary, tradeoffs, hotels, tasks, notes only; days are already stored).",
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
          {
            const provided = Array.isArray(args.days) ? (args.days as Record<string, unknown>[]) : [];
            const merged = new Map<number, unknown>(dayBuffer);
            for (const dd of provided) if (dd && typeof dd === "object" && typeof dd.day === "number") merged.set(dd.day, dd);
            args.days = [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
            if (!Array.isArray(args.tasks)) args.tasks = [];
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
              content: JSON.stringify({ ok: false, fix: `${incomplete} Submit the missing or thin days with add_day (one per call), then call finalize_plan again. Reuse the tool results you already have.` }),
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
