/**
 * Flight links without a flight API (Amadeus self-service closed in 2026).
 * The agent names the exact flight from its knowledge (marked as a schedule to confirm);
 * this file turns the airline into a link to that airline's OWN booking page, pre-filled
 * with route and date where the airline supports it. Unknown carriers fall back to a search.
 */

const AIRPORT: Record<string, string> = {
  tokyo: "NRT",
  narita: "NRT",
  haneda: "HND",
  osaka: "KIX",
  kansai: "KIX",
  kyoto: "KIX",
  nara: "KIX",
  fukuoka: "FUK",
  singapore: "SIN",
  "san francisco": "SFO",
  "los angeles": "LAX",
  "new york": "JFK",
  newark: "EWR",
  chicago: "ORD",
  seattle: "SEA",
  boston: "BOS",
  "washington": "IAD",
  dallas: "DFW",
  houston: "IAH",
  atlanta: "ATL",
  london: "LHR",
  paris: "CDG",
  sydney: "SYD",
  "hong kong": "HKG",
  seoul: "ICN",
  taipei: "TPE",
  bangkok: "BKK",
  "kuala lumpur": "KUL",
  manila: "MNL",
  jakarta: "CGK",
};

export function iata(place: string): string {
  const key = place.trim().toLowerCase();
  if (/^[a-z]{3}$/.test(key)) return key.toUpperCase();
  for (const [name, code] of Object.entries(AIRPORT)) if (key.includes(name)) return code;
  return key.slice(0, 3).toUpperCase();
}

type Airline = { name: string; book: (from: string, to: string, date: string, adults: number) => string };

/** Official booking pages. Deep-linked with route and date where the carrier accepts query parameters. */
const AIRLINES: Record<string, Airline> = {
  SQ: {
    name: "Singapore Airlines",
    book: () => "https://www.singaporeair.com/en_UK/sg/plan-travel/book/",
  },
  NH: {
    name: "ANA",
    book: () => "https://www.ana.co.jp/en/us/book-plan/",
  },
  JL: {
    name: "Japan Airlines",
    book: () => "https://www.jal.co.jp/en/",
  },
  UA: {
    name: "United",
    book: (f, t, d, a) =>
      `https://www.united.com/en/us/fsr/choose-flights?f=${f}&t=${t}&d=${d}&tt=1&sc=7&px=${a}&taxng=1&newHP=True`,
  },
  DL: {
    name: "Delta",
    book: () => "https://www.delta.com/flight-search/book-a-flight",
  },
  AA: {
    name: "American Airlines",
    book: () => "https://www.aa.com/booking/find-flights",
  },
  TR: { name: "Scoot", book: () => "https://www.flyscoot.com/en" },
  ZG: { name: "ZIPAIR", book: () => "https://www.zipair.net/en" },
  CX: { name: "Cathay Pacific", book: () => "https://www.cathaypacific.com/cx/en_US/book-a-trip/book-flights.html" },
  KE: { name: "Korean Air", book: () => "https://www.koreanair.com/booking/search" },
  OZ: { name: "Asiana", book: () => "https://flyasiana.com/C/US/EN/index" },
  BR: { name: "EVA Air", book: () => "https://www.evaair.com/en-us/index.html" },
  CI: { name: "China Airlines", book: () => "https://www.china-airlines.com/us/en" },
  TG: { name: "Thai Airways", book: () => "https://www.thaiairways.com/en/index.page" },
  MH: { name: "Malaysia Airlines", book: () => "https://www.malaysiaairlines.com/" },
  QF: { name: "Qantas", book: () => "https://www.qantas.com/" },
  BA: { name: "British Airways", book: () => "https://www.britishairways.com/travel/home/public/en_gb/" },
  AF: { name: "Air France", book: () => "https://wwws.airfrance.us/" },
  HA: { name: "Hawaiian Airlines", book: () => "https://www.hawaiianairlines.com/" },
  AS: { name: "Alaska Airlines", book: () => "https://www.alaskaair.com/" },
  "7C": { name: "Jeju Air", book: () => "https://www.jejuair.net/en/" },
  MM: { name: "Peach", book: () => "https://www.flypeach.com/en" },
  GK: { name: "Jetstar Japan", book: () => "https://www.jetstar.com/jp/en/home" },
};

export type FlightLink = {
  airline?: string;
  flightNumber?: string;
  from: string;
  to: string;
  date: string;
  bookUrl: string;
  bookLabel: string;
  official: boolean;
  compareUrl: string;
  note: string;
};

export function flightLink(args: {
  origin: string;
  destination_city: string;
  date: string;
  airline_code?: string;
  flight_number?: string;
  adults?: number;
}): FlightLink {
  const from = iata(args.origin);
  const to = iata(args.destination_city);
  const adults = args.adults ?? 2;
  const code = (args.airline_code ?? args.flight_number?.match(/^([A-Z0-9]{2})\s?\d+/i)?.[1] ?? "").toUpperCase();
  const airline = AIRLINES[code];
  const q = `Flights from ${from} to ${to} on ${args.date}`;
  const compareUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
  if (airline) {
    return {
      airline: airline.name,
      flightNumber: args.flight_number?.toUpperCase().replace(/\s+/g, ""),
      from,
      to,
      date: args.date,
      bookUrl: airline.book(from, to, args.date, adults),
      bookLabel: `Book on ${airline.name}`,
      official: true,
      compareUrl,
      note: "Official airline booking page. Flight times in the plan come from the model's knowledge; confirm them on the airline site.",
    };
  }
  return {
    airline: code || undefined,
    flightNumber: args.flight_number,
    from,
    to,
    date: args.date,
    bookUrl: compareUrl,
    bookLabel: "Search flights",
    official: false,
    compareUrl,
    note: "Airline not in the official-link table; this is a search link.",
  };
}
