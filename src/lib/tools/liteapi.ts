import { spend } from "../budget";
import { cached, cacheKey } from "../cache";

/**
 * liteAPI (Nuitée) hotels. Sandbox key: real inventory, simulated bookings.
 * Search + rates on api.liteapi.travel, prebook + book on book.liteapi.travel.
 */
const DATA = "https://api.liteapi.travel/v3.0";
const BOOK = "https://book.liteapi.travel/v3.0";

function headers() {
  const key = process.env.LITEAPI_KEY;
  if (!key) throw new Error("LITEAPI_KEY is not set");
  return { "Content-Type": "application/json", Accept: "application/json", "X-API-Key": key };
}

export type HotelOffer = {
  hotelId: string;
  name: string;
  stars?: number;
  rating?: number;
  reviews?: number;
  address?: string;
  photo?: string;
  roomName: string;
  boardName?: string;
  refundable?: boolean;
  total: number;
  currency: string;
  nights: number;
  perNight: number;
  offerId: string;
  bookUrl: string;
};

const CITY_FIX: Record<string, string> = {
  tokyo: "Tokyo",
  kyoto: "Kyoto",
  osaka: "Osaka",
  nara: "Nara",
  fukuoka: "Fukuoka",
  hakata: "Fukuoka",
  nagasaki: "Nagasaki",
  kumamoto: "Kumamoto",
  beppu: "Beppu",
  yufuin: "Yufuin",
  kagoshima: "Kagoshima",
};

export async function searchHotels(args: {
  city: string;
  checkin: string;
  checkout: string;
  adults?: number;
  max?: number;
  min_rating?: number;
}): Promise<HotelOffer[]> {
  const city = CITY_FIX[args.city.toLowerCase()] ?? args.city;
  const adults = args.adults ?? 2;
  const max = Math.min(args.max ?? 5, 8);
  const nights = Math.max(
    1,
    Math.round((Date.parse(args.checkout) - Date.parse(args.checkin)) / 86400e3),
  );
  return cached(cacheKey("liteapi-search", { ...args, city, adults, max }), 3600, async () => {
    // 1. Candidate hotels in the city (well-reviewed, 3-5 stars).
    spend("liteapi");
    const q = new URLSearchParams({
      countryCode: "JP",
      cityName: city,
      limit: "25",
      minRating: String(args.min_rating ?? 7.5),
      minReviewsCount: "200",
      starRating: "3,3.5,4,4.5,5",
    });
    const hres = await fetch(`${DATA}/data/hotels?${q}`, { headers: headers() });
    if (!hres.ok) throw new Error(`liteAPI hotels ${hres.status}: ${(await hres.text()).slice(0, 300)}`);
    const hj = await hres.json();
    const hotels = (hj.data ?? []) as Record<string, unknown>[];
    if (!hotels.length) return [];
    const byId = new Map(hotels.map((h) => [String(h.id), h]));

    // 2. Live rates for those hotels.
    spend("liteapi");
    const rres = await fetch(`${DATA}/hotels/rates`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        hotelIds: hotels.slice(0, 20).map((h) => h.id),
        occupancies: [{ adults }],
        currency: "USD",
        guestNationality: "US",
        checkin: args.checkin,
        checkout: args.checkout,
        timeout: 8,
      }),
    });
    if (!rres.ok) throw new Error(`liteAPI rates ${rres.status}: ${(await rres.text()).slice(0, 300)}`);
    const rj = await rres.json();
    const offers: HotelOffer[] = [];
    for (const d of (rj.data ?? []) as Record<string, unknown>[]) {
      const h = byId.get(String(d.hotelId));
      if (!h) continue;
      // Cheapest room type per hotel.
      let best: HotelOffer | undefined;
      for (const rt of (d.roomTypes ?? []) as Record<string, unknown>[]) {
        const rate = ((rt.rates ?? []) as Record<string, unknown>[])[0];
        if (!rate) continue;
        const total = ((rate.retailRate as { total?: { amount: number; currency: string }[] })?.total ?? [])[0];
        const amount = total?.amount ?? (rt.offerRetailRate as { amount?: number })?.amount;
        if (!amount) continue;
        const refundable =
          (rate.cancellationPolicies as { refundableTag?: string })?.refundableTag === "RFN";
        const offer: HotelOffer = {
          hotelId: String(h.id),
          name: String(h.name),
          stars: h.stars as number | undefined,
          rating: h.rating as number | undefined,
          reviews: h.reviewCount as number | undefined,
          address: h.address as string | undefined,
          photo: (h.main_photo as string) || (h.thumbnail as string) || undefined,
          roomName: String(rate.name ?? rt.name ?? "Room"),
          boardName: rate.boardName as string | undefined,
          refundable,
          total: Math.round(amount),
          currency: total?.currency ?? "USD",
          nights,
          perNight: Math.round(amount / nights),
          offerId: String(rt.offerId),
          // Offer IDs are ~1.5 KB; the booking page re-fetches a fresh offer by hotel + dates instead.
          bookUrl: `/book?hotelId=${encodeURIComponent(String(h.id))}&checkin=${args.checkin}&checkout=${args.checkout}&adults=${adults}`,
        };
        if (!best || offer.total < best.total) best = offer;
      }
      if (best) offers.push(best);
    }
    offers.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return offers.slice(0, max);
  });
}

/** Fresh offer for one hotel (used by the booking page). */
export async function offerForHotel(args: { hotelId: string; checkin: string; checkout: string; adults?: number }) {
  spend("liteapi");
  const rres = await fetch(`${DATA}/hotels/rates`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      hotelIds: [args.hotelId],
      occupancies: [{ adults: args.adults ?? 2 }],
      currency: "USD",
      guestNationality: "US",
      checkin: args.checkin,
      checkout: args.checkout,
      timeout: 8,
    }),
  });
  if (!rres.ok) throw new Error(`liteAPI rates ${rres.status}: ${(await rres.text()).slice(0, 300)}`);
  const rj = await rres.json();
  const d = ((rj.data ?? []) as Record<string, unknown>[])[0];
  if (!d) return undefined;
  let best: { offerId: string; roomName: string; boardName?: string; total: number; currency: string; refundable: boolean } | undefined;
  for (const rt of (d.roomTypes ?? []) as Record<string, unknown>[]) {
    const rate = ((rt.rates ?? []) as Record<string, unknown>[])[0];
    const total = ((rate?.retailRate as { total?: { amount: number; currency: string }[] })?.total ?? [])[0];
    if (!rate || !total) continue;
    const o = {
      offerId: String(rt.offerId),
      roomName: String(rate.name ?? rt.name ?? "Room"),
      boardName: rate.boardName as string | undefined,
      total: Math.round(total.amount),
      currency: total.currency,
      refundable: (rate.cancellationPolicies as { refundableTag?: string })?.refundableTag === "RFN",
    };
    if (!best || o.total < best.total) best = o;
  }
  return best;
}

/** What the planning model sees: no offer IDs, just the facts and the booking route. */
export function offerForModel(o: HotelOffer) {
  return {
    hotelId: o.hotelId,
    name: o.name,
    stars: o.stars,
    guestRating: o.rating,
    reviews: o.reviews,
    area: o.address,
    room: o.roomName,
    board: o.boardName,
    refundable: o.refundable,
    totalUSD: o.total,
    perNightUSD: o.perNight,
    nights: o.nights,
    bookUrl: o.bookUrl,
  };
}

export async function hotelDetails(hotelId: string) {
  return cached(cacheKey("liteapi-hotel", hotelId), 24 * 3600, async () => {
    spend("liteapi");
    const res = await fetch(`${DATA}/data/hotel?hotelId=${encodeURIComponent(hotelId)}`, { headers: headers() });
    if (!res.ok) throw new Error(`liteAPI hotel ${res.status}`);
    const j = await res.json();
    const d = j.data ?? {};
    return {
      id: hotelId,
      name: String(d.name ?? "Hotel"),
      address: d.address as string | undefined,
      city: d.city as string | undefined,
      stars: d.starRating ?? d.stars,
      photo: (d.main_photo as string) || (d.hotelImages as { url: string }[])?.[0]?.url,
      description: String(d.hotelDescription ?? "").replace(/<[^>]+>/g, "").slice(0, 400),
    };
  });
}

export async function prebook(offerId: string) {
  spend("liteapi");
  const res = await fetch(`${BOOK}/rates/prebook`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ offerId, usePaymentSdk: false }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`liteAPI prebook ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const d = j.data;
  const rate = d.roomTypes?.[0]?.rates?.[0];
  return {
    prebookId: String(d.prebookId),
    hotelId: String(d.hotelId),
    checkin: String(d.checkin),
    checkout: String(d.checkout),
    price: Number(d.price),
    currency: String(d.currency),
    roomName: String(rate?.name ?? "Room"),
    boardName: rate?.boardName as string | undefined,
    refundable: rate?.cancellationPolicies?.refundableTag === "RFN",
    sandbox: true,
  };
}

export async function book(args: { prebookId: string; firstName: string; lastName: string; email: string }) {
  spend("liteapi");
  const res = await fetch(`${BOOK}/rates/book`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prebookId: args.prebookId,
      holder: { firstName: args.firstName, lastName: args.lastName, email: args.email },
      guests: [{ occupancyNumber: 1, firstName: args.firstName, lastName: args.lastName, email: args.email }],
      payment: { method: "ACC_CREDIT_CARD" },
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`liteAPI book ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const d = j.data;
  return {
    bookingId: String(d.bookingId),
    status: String(d.status),
    confirmation: d.hotelConfirmationCode as string | undefined,
    price: Number(d.price),
    currency: String(d.currency),
    sandbox: Boolean(d.sandbox ?? true),
  };
}
