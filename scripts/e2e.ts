// End-to-end flow against a running dev server: two users with opposite tastes, then the agent.
// Run: npx tsx scripts/e2e.ts [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3000";
type Card = { id: string; title: string; tags: string[] };
const LIKE: Record<string, string[]> = {
  Alex: ["temples", "nature", "culture", "daytrip", "museums"],
  Sam: ["nightlife", "food", "modern", "thrills", "markets"],
};
async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(body)}`);
  return body as T;
}
function score(c: Card, likes: string[]) { return c.tags.filter((t) => likes.includes(t)).length; }
(async () => {
  const d = new Date(); d.setDate(d.getDate() + 14);
  const startDate = d.toISOString().slice(0, 10);
  const room = await j<{ code: string; memberId: string }>("/api/rooms", { method: "POST", body: JSON.stringify({ hostName: "Alex", originCity: "Singapore", startDate, nights: 4 }) });
  console.log("room", room.code);
  const sam = await j<{ memberId: string }>(`/api/rooms/${room.code}/join`, { method: "POST", body: JSON.stringify({ name: "Sam" }) });
  for (const [name, memberId] of [["Alex", room.memberId], ["Sam", sam.memberId]] as const) {
    for (let i = 0; i < 12; i++) {
      const s = await j<{ nextPair: [Card, Card] | null; me: { done: boolean } }>(`/api/rooms/${room.code}?me=${memberId}`);
      if (!s.nextPair) break;
      const [a, b] = s.nextPair;
      const chosen = score(a, LIKE[name]) >= score(b, LIKE[name]) ? a : b;
      await j(`/api/rooms/${room.code}/swipe`, { method: "POST", body: JSON.stringify({ memberId, left: a.id, right: b.id, chosen: chosen.id }) });
    }
    console.log(name, "swiped");
  }
  const st = await j<{ members: { name: string; summary: string }[]; tensions: string[] }>(`/api/rooms/${room.code}?me=${room.memberId}`);
  for (const m of st.members) console.log(" ", m.name, "→", m.summary);
  console.log("  tensions:", st.tensions.join("; ") || "none");
  await j(`/api/rooms/${room.code}/plan`, { method: "POST", body: JSON.stringify({ memberId: room.memberId }) });
  const t0 = Date.now(); let seen = 0;
  while (Date.now() - t0 < 6 * 60e3) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await j<{ room: { status: string }; events: { kind: string; tool: string | null; summary: string }[]; plan: unknown }>(`/api/rooms/${room.code}?me=${room.memberId}`);
    for (const e of s.events.slice(seen)) console.log(`  [${e.tool ?? e.kind}] ${e.summary}`);
    seen = s.events.length;
    if (s.room.status === "done" || s.room.status === "error") {
      console.log("STATUS", s.room.status, `${Math.round((Date.now() - t0) / 1000)}s`);
      if (s.plan) console.log(JSON.stringify(s.plan, null, 1));
      break;
    }
  }
  console.log("ROOM", room.code, "host", room.memberId);
  process.exit(0);
})().catch((e) => { console.error("E2E FAILED", e.message); process.exit(1); });
