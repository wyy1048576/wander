import { loadEnv } from "./env";
import { writeFileSync } from "node:fs";
loadEnv();
const base = process.env.META_API_BASE!;
const key = process.env.META_API_KEY!;
const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function spark() {
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      model: process.env.META_SPARK_MODEL,
      messages: [
        { role: "system", content: "You are a trip planner. Use tools when needed." },
        { role: "user", content: "How do I get from Tokyo Station to Kyoto Station tomorrow at 9am?" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "get_transit_route",
          description: "Get a public transit route between two places",
          parameters: { type: "object", properties: {
            origin: { type: "string" }, destination: { type: "string" }, departure_time: { type: "string" } },
            required: ["origin", "destination"] },
        },
      }],
    }),
  });
  const j = await r.json();
  console.log("SPARK status", r.status);
  console.log(JSON.stringify(j, null, 2).slice(0, 2500));
}

async function image() {
  const r = await fetch(`${base}/images/generations`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      model: process.env.META_IMAGE_MODEL,
      prompt: "Fushimi Inari shrine torii gate path in Kyoto at golden hour, travel photo, no people, no text",
      n: 1, size: "1024x1024",
    }),
  });
  const j = await r.json();
  console.log("IMAGE status", r.status);
  const d = j?.data?.[0];
  if (d?.b64_json) { writeFileSync("data/smoke.png", Buffer.from(d.b64_json, "base64")); console.log("wrote data/smoke.png"); }
  else console.log(JSON.stringify(j, null, 2).slice(0, 1500));
}

const which = process.argv[2] ?? "both";
(async () => {
  if (which !== "image") await spark();
  if (which !== "spark") await image();
})().catch((e) => { console.error(e); process.exit(1); });
