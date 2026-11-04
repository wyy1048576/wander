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

export const PlanSchema = z.object({
  title: z.string(),
  summary: z.string().describe("Two sentences on how the plan balances the group"),
  tradeoffs: z.array(z.string()).min(1).describe("Concrete sentences: who got what, where someone compromised"),
  days: z.array(DaySchema).min(1),
  hotels: z.array(HotelPickSchema),
  notes: z.array(z.string()).optional().describe("Honesty notes, e.g. which links are search links"),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanItem = z.infer<typeof ItemSchema>;
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
                  description: "Concrete specifics: train line + times, what to order, neighbourhood",
                },
                for: {
                  type: "array",
                  items: { type: "string" },
                  description: 'Member names this is mainly for, or ["both"]',
                },
                why: { type: "string", description: "Short sentence tying it to a swipe or compromise" },
                link: {
                  type: "object",
                  required: ["label", "url"],
                  properties: { label: { type: "string" }, url: { type: "string" } },
                },
                estimated: { type: "boolean", description: "true if times are not from live data" },
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
    notes: { type: "array", items: { type: "string" } },
  },
} as const;
