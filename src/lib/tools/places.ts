import { spend } from "../budget";
import { cached, cacheKey } from "../cache";

/** Google Places API (New) text search, minimal field mask to stay in the Pro SKU. */
export type Place = {
  id: string;
  name: string;
  rating?: number;
  reviews?: number;
  priceLevel?: string;
  type?: string;
  address?: string;
  mapsUrl: string;
};

const PRICE: Record<string, string> = {
  PRICE_LEVEL_FREE: "free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

export async function searchPlaces(args: { query: string; max?: number }): Promise<Place[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const max = Math.min(args.max ?? 5, 8);
  return cached(cacheKey("places", { q: args.query, max }), 24 * 3600, async () => {
    spend("google");
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.formattedAddress,places.primaryTypeDisplayName",
      },
      body: JSON.stringify({ textQuery: args.query, maxResultCount: max, languageCode: "en" }),
    });
    if (!res.ok) throw new Error(`Places API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return (j.places ?? []).map(
      (p: Record<string, unknown>): Place => ({
        id: String(p.id),
        name: (p.displayName as { text?: string })?.text ?? "Unknown",
        rating: p.rating as number | undefined,
        reviews: p.userRatingCount as number | undefined,
        priceLevel: PRICE[String(p.priceLevel)] ?? undefined,
        type: (p.primaryTypeDisplayName as { text?: string })?.text,
        address: p.formattedAddress as string | undefined,
        mapsUrl: String(p.googleMapsUri ?? ""),
      }),
    );
  });
}
