import { z } from "zod";

export const LinkSchema = z.object({ label: z.string(), url: z.string() });

export const ItemSchema = z.object({
  time: z.string().describe("Local time like 09:00 or a range like 12:30-14:00"),
  type: z.enum(["place", "meal", "transit", "hotel", "flight", "free"]),
  title: z.string(),
  detail: z.string().optional().describe("One or two concrete lines: line names, times, what to order, address area"),
  for: z.array(z.string()).default(["both"]).describe('Member names this item is mainly for, or ["both"]'),
  why: z.string().optional().describe("One short sentence tying it to a swipe or a compromise"),
  link: LinkSchema.optional().describe("Book / map / tickets link"),
  estimated: z.boolean().optional().describe("true when times come from general knowledge, not live data"),
  how: z
    .string()
    .optional()
    .describe("Getting there from the previous item: mode, line, platform or exit, times, fare. Under 120 characters."),
  cost: z.string().optional().describe("Out-of-pocket cost for this item, e.g. '¥2,570 pp' or 'free'"),
});

export const DaySchema = z.object({
  day: z.number(),
  date: z.string(),
  city: z.string(),
  headline: z.string().optional(),
  items: z.array(ItemSchema).min(1),
});

export const HotelPickSchema = z.object({
  city: z.string(),
  name: z.string(),
  checkin: z.string(),
  checkout: z.string(),
  perNightUSD: z.number().optional(),
  totalUSD: z.number().optional(),
  room: z.string().optional(),
  bookUrl: z.string(),
  why: z.string().optional(),
});

export const TaskSchema = z.object({
  when: z.string().describe('"Before you fly", "On arrival", "Day 2 morning", ...'),
  title: z.string(),
  detail: z.string().optional().describe("Exactly where / how, in under 120 characters"),
  link: LinkSchema.optional(),
  for: z.array(z.string()).optional(),
});

export const PlanSchema = z.object({
  title: z.string(),
  summary: z.string().describe("Two sentences on how the plan balances the group"),
  tradeoffs: z.array(z.string()).min(1).describe("Concrete sentences: who got what, where someone compromised"),
  days: z.array(DaySchema).min(1),
  hotels: z.array(HotelPickSchema),
  tasks: z.array(TaskSchema).optional().describe("Logistics checklist: money, IC card, seat reservations, advance tickets"),
  notes: z.array(z.string()).optional().describe("Honesty notes, e.g. which links are search links"),
});

export type Plan = z.infer<typeof PlanSchema>;

/**
 * Models sometimes emit one `days` entry per item. Merge entries that share a day number,
 * keep item order, and sort days. Idempotent, so it runs on write and on read.
 */
export function normalizePlan(plan: Plan): Plan {
  const byDay = new Map<number, Plan["days"][number]>();
  for (const d of plan.days) {
    const existing = byDay.get(d.day);
    if (!existing) {
      byDay.set(d.day, { ...d, items: [...d.items] });
    } else {
      existing.items.push(...d.items);
      if (!existing.headline && d.headline) existing.headline = d.headline;
      if (!existing.city && d.city) existing.city = d.city;
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.day - b.day);
  // A day's city is where most of its non-transit items happen.
  for (const d of days) {
    const counts = new Map<string, number>();
    for (const it of d.items) {
      const CITY = /\b(Tokyo|Kyoto|Osaka|Nara|Fukuoka|Hakata|Nagasaki|Kumamoto|Beppu|Yufuin|Kagoshima|Takachiho)\b/;
      const m = it.detail?.match(CITY) ?? it.title.match(CITY);
      if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2 && d.items.length >= 3) d.city = top[0] === "Hakata" ? "Fukuoka" : top[0];
  }
  return { ...plan, days };
}
export type PlanItem = z.infer<typeof ItemSchema>;
export type PlanTask = z.infer<typeof TaskSchema>;
export type PlanDay = z.infer<typeof DaySchema>;

/** JSON schema handed to Muse Spark as the finalize_plan tool's parameters. */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  required: ["title", "summary", "tradeoffs", "days", "hotels"],
  properties: {
    title: { type: "string" },
    summary: { type: "string", description: "Two sentences on how the plan balances the group" },
    tradeoffs: {
      type: "array",
      items: { type: "string" },
      description: "3-5 concrete sentences: who got what, where someone compromised. Use member names.",
    },
    days: {
      type: "array",
      items: {
        type: "object",
        required: ["day", "date", "city", "items"],
        properties: {
          day: { type: "integer" },
          date: { type: "string", description: "YYYY-MM-DD" },
          city: { type: "string" },
          headline: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["time", "type", "title", "for"],
              properties: {
                time: { type: "string", description: "e.g. 09:00 or 12:30-14:00" },
                type: { type: "string", enum: ["place", "meal", "transit", "hotel", "flight", "free"] },
                title: { type: "string" },
                detail: {
                  type: "string",
                  description: "Concrete specifics in under 80 characters: train line + times, what to order, neighbourhood",
                },
                for: {
                  type: "array",
                  items: { type: "string" },
                  description: 'Member names this is mainly for, or ["both"]',
                },
                why: { type: "string", description: "Under 60 characters, tying it to a swipe or compromise" },
                link: {
                  type: "object",
                  required: ["label", "url"],
                  properties: { label: { type: "string" }, url: { type: "string" } },
                },
                estimated: { type: "boolean", description: "true if times are not from live data" },
                how: {
                  type: "string",
                  description:
                    "REQUIRED on every item after the first of the day, and on the first item if it is a journey. How to get here from the previous item: walk/taxi/line name, platform or station exit, depart→arrive times, fare, IC card or ticket. Under 120 characters. e.g. 'JR Yamanote from Akihabara pf 2, 15:02→15:27, ¥210 IC, Omotesando exit'",
                },
                cost: { type: "string", description: "Out-of-pocket cost, e.g. '¥2,570 pp', '¥600 entry', 'free'" },
              },
            },
          },
        },
      },
    },
    hotels: {
      type: "array",
      items: {
        type: "object",
        required: ["city", "name", "checkin", "checkout", "bookUrl"],
        properties: {
          city: { type: "string" },
          name: { type: "string" },
          checkin: { type: "string" },
          checkout: { type: "string" },
          perNightUSD: { type: "number" },
          totalUSD: { type: "number" },
          room: { type: "string" },
          bookUrl: { type: "string", description: "Exactly the bookUrl returned by search_hotels" },
          why: { type: "string" },
        },
      },
    },
    tasks: {
      type: "array",
      description:
        "6-10 logistics tasks that make the plan executable: currency (how much, where to exchange or which ATMs), IC card, Shinkansen seat reservation with the date to do it, advance tickets for timed-entry places, luggage forwarding, eSIM, restaurant reservations. Each one specific to THIS itinerary.",
      items: {
        type: "object",
        required: ["when", "title"],
        properties: {
          when: { type: "string", description: '"Before you fly", "On arrival at Narita", "Day 2 evening"' },
          title: { type: "string" },
          detail: { type: "string", description: "Exactly where and how, under 120 characters" },
          link: { type: "object", required: ["label", "url"], properties: { label: { type: "string" }, url: { type: "string" } } },
          for: { type: "array", items: { type: "string" } },
        },
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
} as const;
