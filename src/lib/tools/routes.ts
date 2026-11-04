import { spend } from "../budget";
import { cached, cacheKey } from "../cache";

/** Google Routes API, transit mode. Returns real train/bus legs with times and the operator's site. */
export type TransitStep = {
  mode: "TRANSIT" | "WALK";
  line?: string;
  vehicle?: string;
  agency?: string;
  agencyUri?: string;
  headsign?: string;
  from?: string;
  to?: string;
  departTime?: string;
  arriveTime?: string;
  stops?: number;
  minutes: number;
};
export type TransitRoute = {
  origin: string;
  destination: string;
  totalMinutes: number;
  departTime?: string;
  arriveTime?: string;
  steps: TransitStep[];
  mapsUrl: string;
};

const FIELD_MASK = [
  "routes.duration",
  "routes.legs.duration",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.transitDetails",
].join(",");

function hhmm(isoTime?: string) {
  if (!isoTime) return undefined;
  // Routes returns UTC; show Japan local time.
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return isoTime;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
}

const SHINKANSEN = /shinkansen|nozomi|hikari|kodama|sakura|mizuho|hayabusa/i;

/** Compact, model-friendly view of a route, with a deterministic booking link. */
export function routeForModel(r: TransitRoute & { unavailable?: string }) {
  const transit = r.steps.filter((s) => s.mode === "TRANSIT");
  const isShinkansen = transit.some((s) => SHINKANSEN.test(`${s.line} ${s.vehicle} ${s.headsign}`));
  const bookUrl = isShinkansen
    ? "https://smart-ex.jp/en/"
    : transit.find((s) => s.agencyUri)?.agencyUri ?? r.mapsUrl;
  const bookLabel = isShinkansen ? "Book Shinkansen (SmartEX)" : transit.length ? "Operator site" : "Directions";
  return {
    origin: r.origin,
    destination: r.destination,
    totalMinutes: r.totalMinutes,
    departTime: hhmm(r.departTime),
    arriveTime: hhmm(r.arriveTime),
    legs: r.steps.map((s) =>
      s.mode === "WALK"
        ? `Walk ${s.minutes} min`
        : `${s.vehicle ?? "Train"} ${s.line ?? ""}${s.headsign ? ` towards ${s.headsign}` : ""}: ${s.from} ${hhmm(s.departTime)} → ${s.to} ${hhmm(s.arriveTime)} (${s.minutes} min${s.stops ? `, ${s.stops} stops` : ""})${s.agency ? `, ${s.agency}` : ""}`,
    ),
    liveSchedule: !r.unavailable && transit.length > 0,
    note: r.unavailable,
    bookUrl,
    bookLabel,
    mapsUrl: r.mapsUrl,
  };
}

function iso(s?: string) {
  return s ? s.replace(/\.\d+Z$/, "Z") : undefined;
}

export async function getTransitRoute(args: {
  origin: string;
  destination: string;
  departure_time?: string;
}): Promise<TransitRoute> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const departure = args.departure_time ?? new Date(Date.now() + 14 * 86400e3).toISOString();
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(args.origin)}&destination=${encodeURIComponent(args.destination)}&travelmode=transit`;

  return cached(cacheKey("routes", { ...args, departure: departure.slice(0, 13) }), 6 * 3600, async () => {
    spend("google");
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { address: args.origin },
        destination: { address: args.destination },
        travelMode: "TRANSIT",
        departureTime: departure,
        computeAlternativeRoutes: false,
        languageCode: "en",
        transitPreferences: { routingPreference: "FEWER_TRANSFERS" },
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      // Graceful fallback (e.g. API not enabled yet): the agent still gets a usable maps link.
      if (res.status === 403 || res.status === 429) {
        console.warn("Routes API unavailable:", body);
        return {
          origin: args.origin,
          destination: args.destination,
          totalMinutes: 0,
          steps: [],
          mapsUrl,
          unavailable: "Live schedule unavailable; estimate times from general knowledge and say so.",
        } as TransitRoute & { unavailable: string };
      }
      throw new Error(`Routes API ${res.status}: ${body}`);
    }
    const j = await res.json();
    const route = j.routes?.[0];
    if (!route) {
      // Google returns no transit data for some countries (Japan among them). Keep the maps link,
      // and tell the agent to estimate the schedule and label it as such.
      return {
        origin: args.origin,
        destination: args.destination,
        totalMinutes: 0,
        steps: [],
        mapsUrl,
        unavailable: "Google has no transit schedule for this route; estimate times from general knowledge and mark them estimated.",
      } as TransitRoute & { unavailable: string };
    }
    const steps: TransitStep[] = [];
    for (const leg of route.legs ?? []) {
      for (const s of leg.steps ?? []) {
        const secs = parseInt(String(s.staticDuration ?? "0s"), 10) || 0;
        if (s.travelMode === "TRANSIT" && s.transitDetails) {
          const td = s.transitDetails;
          const line = td.transitLine ?? {};
          const agency = line.agencies?.[0];
          steps.push({
            mode: "TRANSIT",
            line: line.nameShort || line.name,
            vehicle: line.vehicle?.name?.text,
            agency: agency?.name,
            agencyUri: agency?.uri,
            headsign: td.headsign,
            from: td.stopDetails?.departureStop?.name,
            to: td.stopDetails?.arrivalStop?.name,
            departTime: iso(td.stopDetails?.departureTime),
            arriveTime: iso(td.stopDetails?.arrivalTime),
            stops: td.stopCount,
            minutes: Math.round(secs / 60),
          });
        } else if (secs >= 120) {
          // Merge consecutive walks; ignore sub-2-minute hops.
          const last = steps[steps.length - 1];
          if (last && last.mode === "WALK") last.minutes += Math.round(secs / 60);
          else steps.push({ mode: "WALK", minutes: Math.round(secs / 60) });
        }
      }
    }
    const total = Math.round((parseInt(String(route.duration ?? "0s"), 10) || 0) / 60);
    const transit = steps.filter((s) => s.mode === "TRANSIT");
    return {
      origin: args.origin,
      destination: args.destination,
      totalMinutes: total,
      departTime: transit[0]?.departTime,
      arriveTime: transit[transit.length - 1]?.arriveTime,
      steps,
      mapsUrl,
    };
  });
}
