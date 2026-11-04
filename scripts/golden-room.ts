// Export a finished room to JSON, or import one as a fresh room. Backup for the demo video.
//   npx tsx scripts/golden-room.ts export SPGT         -> seed/golden-room.json
//   npx tsx scripts/golden-room.ts import [file]       -> prints the new room code and host member id
import { loadEnv } from "./env";
loadEnv();
import { readFileSync, writeFileSync } from "node:fs";

type Row = Record<string, unknown>;

(async () => {
  const { db, newId, roomCode } = await import("../src/lib/db");
  const d = db();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "export") {
    const room = d.prepare("SELECT * FROM rooms WHERE code = ?").get(String(arg).toUpperCase()) as Row | undefined;
    if (!room) throw new Error("room not found");
    const rid = String(room.id);
    const members = d.prepare("SELECT * FROM members WHERE room_id = ? ORDER BY created_at").all(rid) as Row[];
    const swipes = d.prepare("SELECT * FROM swipes WHERE room_id = ? ORDER BY id").all(rid) as Row[];
    const events = d.prepare("SELECT * FROM plan_events WHERE room_id = ? ORDER BY id").all(rid) as Row[];
    const plan = d.prepare("SELECT json FROM plans WHERE room_id = ?").get(rid) as { json: string } | undefined;
    const out = { room, members, swipes, events, plan: plan ? JSON.parse(plan.json) : null };
    writeFileSync("seed/golden-room.json", JSON.stringify(out, null, 1));
    console.log(`exported ${room.code}: ${members.length} members, ${swipes.length} swipes, ${events.length} events, plan=${!!plan}`);
  } else if (cmd === "import") {
    const g = JSON.parse(readFileSync(arg ?? "seed/golden-room.json", "utf8"));
    const roomId = newId();
    let code = roomCode();
    while (d.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code)) code = roomCode();
    const r = g.room;
    d.prepare("INSERT INTO rooms (id, code, destination, dest_key, origin_city, start_date, nights, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      roomId, code, r.destination, r.dest_key ?? null, r.origin_city, r.start_date, r.nights, g.plan ? "done" : "swiping",
    );
    const idMap = new Map<string, string>();
    for (const m of g.members) {
      const id = newId();
      idMap.set(m.id, id);
      d.prepare("INSERT INTO members (id, room_id, name, is_host, done_swiping) VALUES (?, ?, ?, ?, ?)").run(id, roomId, m.name, m.is_host, m.done_swiping);
    }
    for (const s of g.swipes) {
      d.prepare("INSERT INTO swipes (room_id, member_id, left_card, right_card, chosen_card) VALUES (?, ?, ?, ?, ?)").run(
        roomId, idMap.get(s.member_id) ?? "", s.left_card, s.right_card, s.chosen_card,
      );
    }
    for (const e of g.events) {
      d.prepare("INSERT INTO plan_events (room_id, kind, tool, summary) VALUES (?, ?, ?, ?)").run(roomId, e.kind, e.tool, e.summary);
    }
    if (g.plan) d.prepare("INSERT INTO plans (room_id, json) VALUES (?, ?)").run(roomId, JSON.stringify(g.plan));
    const host = g.members.find((m: Row) => m.is_host) ?? g.members[0];
    console.log(`imported as room ${code}`);
    console.log(`host member id: ${idMap.get(host.id)}`);
    console.log(`In the browser console on localhost:3000 run: localStorage.setItem('wander:${code}', '${idMap.get(host.id)}')`);
  } else {
    console.log("usage: golden-room.ts export CODE | import [file]");
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
