import { loadEnv } from "./env";
loadEnv();
(async () => {
  const which = process.argv[2] ?? "all";
  if (which === "all" || which === "routes") {
    const { getTransitRoute } = await import("../src/lib/tools/routes");
    const dep = new Date(); dep.setUTCDate(dep.getUTCDate() + 14); dep.setUTCHours(0, 0, 0, 0); // 09:00 JST
    const r = await getTransitRoute({ origin: "Tokyo Station, Tokyo, Japan", destination: "Kyoto Station, Kyoto, Japan", departure_time: dep.toISOString() });
    console.log("ROUTES", JSON.stringify(r, null, 1).slice(0, 1800));
  }
  if (which === "all" || which === "places") {
    const { searchPlaces } = await import("../src/lib/tools/places");
    const p = await searchPlaces({ query: "best ramen near Shinjuku Station Tokyo", max: 3 });
    console.log("PLACES", JSON.stringify(p, null, 1));
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
