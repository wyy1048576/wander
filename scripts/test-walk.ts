import { loadEnv } from "./env";
loadEnv();
(async () => {
  const { getWalkingRoute } = await import("../src/lib/tools/routes");
  const r = await getWalkingRoute({ origin: "THE TOURIST HOTEL & Cafe AKIHABARA, Tokyo", destination: "Akihabara Electric Town, Chuo-dori, Tokyo" });
  console.log(JSON.stringify(r, null, 1));
})();
