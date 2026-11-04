import { db, newId, roomCode } from "./db";
import { computePreferences, describePrefs, memberSwipes, pairsForRoom, tensions, PAIRS_PER_ROOM, type Card } from "./game";
import type { Plan } from "./plan-schema";

export type RoomRow = {
  id: string;
  code: string;
  destination: string;
  origin_city: string;
  start_date: string;
  nights: number;
  status: "swiping" | "planning" | "done" | "error";
  created_at: string;
};
export type MemberRow = {
  id: string;
  room_id: string;
  name: string;
  is_host: number;
  done_swiping: number;
  created_at: string;
};

export function createRoom(input: { hostName: string; originCity: string; startDate: string; nights: number }) {
  const d = db();
  let code = roomCode();
  while (d.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code)) code = roomCode();
  const roomId = newId();
  const memberId = newId();
  d.prepare(
    "INSERT INTO rooms (id, code, destination, origin_city, start_date, nights) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(roomId, code, "Japan: Tokyo, Kyoto & Osaka", input.originCity, input.startDate, input.nights);
  d.prepare("INSERT INTO members (id, room_id, name, is_host) VALUES (?, ?, ?, 1)").run(memberId, roomId, input.hostName);
  return { code, memberId, roomId };
}

export function getRoom(code: string): RoomRow | undefined {
  return db().prepare("SELECT * FROM rooms WHERE code = ?").get(code.toUpperCase()) as RoomRow | undefined;
}

export function joinRoom(code: string, name: string) {
  const room = getRoom(code);
  if (!room) return undefined;
  if (room.status !== "swiping") return { error: "This trip is already being planned" as const };
  const count = (db().prepare("SELECT COUNT(*) c FROM members WHERE room_id = ?").get(room.id) as { c: number }).c;
  if (count >= 4) return { error: "Room is full (max 4)" as const };
  const memberId = newId();
  db().prepare("INSERT INTO members (id, room_id, name) VALUES (?, ?, ?)").run(memberId, room.id, name);
  return { memberId, roomId: room.id };
}

export function members(roomId: string): MemberRow[] {
  return db().prepare("SELECT * FROM members WHERE room_id = ? ORDER BY created_at").all(roomId) as MemberRow[];
}

export function recordSwipe(roomId: string, memberId: string, left: string, right: string, chosen: string) {
  if (chosen !== left && chosen !== right) throw new Error("chosen card must be one of the pair");
  const n = (db().prepare("SELECT COUNT(*) c FROM swipes WHERE member_id = ?").get(memberId) as { c: number }).c;
  if (n >= PAIRS_PER_ROOM) return n;
  db()
    .prepare("INSERT INTO swipes (room_id, member_id, left_card, right_card, chosen_card) VALUES (?, ?, ?, ?, ?)")
    .run(roomId, memberId, left, right, chosen);
  if (n + 1 >= PAIRS_PER_ROOM) db().prepare("UPDATE members SET done_swiping = 1 WHERE id = ?").run(memberId);
  return n + 1;
}

export function markDone(memberId: string) {
  db().prepare("UPDATE members SET done_swiping = 1 WHERE id = ?").run(memberId);
}

export type RoomState = {
  room: { code: string; destination: string; originCity: string; startDate: string; nights: number; status: RoomRow["status"] };
  members: { id: string; name: string; isHost: boolean; done: boolean; swipes: number; summary: string; topTags: string[]; picks: string[] }[];
  me?: { id: string; name: string; isHost: boolean; done: boolean; swipes: number };
  totalPairs: number;
  nextPair: [Card, Card] | null;
  tensions: string[];
  events: { id: number; kind: string; tool: string | null; summary: string; at: string }[];
  plan: Plan | null;
};

export function roomState(code: string, memberId?: string): RoomState | undefined {
  const room = getRoom(code);
  if (!room) return undefined;
  const d = db();
  const ms = members(room.id);
  const pairs = pairsForRoom(room.id);
  const prefs = ms.map((m) => computePreferences(m.name, memberSwipes(m.id)));
  const memberViews = ms.map((m, i) => ({
    id: m.id,
    name: m.name,
    isHost: !!m.is_host,
    done: !!m.done_swiping,
    swipes: prefs[i].picks.length,
    summary: describePrefs(prefs[i]),
    topTags: prefs[i].topTags,
    picks: prefs[i].picks,
  }));
  const me = memberViews.find((m) => m.id === memberId);
  const nextPair = me && !me.done && me.swipes < pairs.length ? pairs[me.swipes] : null;
  const events = d
    .prepare("SELECT id, kind, tool, summary, created_at at FROM plan_events WHERE room_id = ? ORDER BY id DESC LIMIT 40")
    .all(room.id) as RoomState["events"];
  const planRow = d.prepare("SELECT json FROM plans WHERE room_id = ?").get(room.id) as { json: string } | undefined;
  return {
    room: {
      code: room.code,
      destination: room.destination,
      originCity: room.origin_city,
      startDate: room.start_date,
      nights: room.nights,
      status: room.status,
    },
    members: memberViews,
    me: me ? { id: me.id, name: me.name, isHost: me.isHost, done: me.done, swipes: me.swipes } : undefined,
    totalPairs: pairs.length,
    nextPair,
    tensions: prefs.length >= 2 ? tensions(prefs[0], prefs[1]) : [],
    events: events.reverse(),
    plan: planRow ? (JSON.parse(planRow.json) as Plan) : null,
  };
}
