import { loadEnv } from "./env";
loadEnv();
(async () => {
  const { searchHotels } = await import("../src/lib/tools/liteapi");
  const d = new Date(); d.setDate(d.getDate() + 14);
  const ci = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() + 2);
  const co = d.toISOString().slice(0, 10);
  const r = await searchHotels({ city: "Kyoto", checkin: ci, checkout: co, max: 4 });
  console.log(JSON.stringify(r, null, 1).slice(0, 2500));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
