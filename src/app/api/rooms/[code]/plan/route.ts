import { after } from "next/server";
import { getRoom, members, roomState } from "@/lib/rooms";
import { buildPlan } from "@/lib/agent";
import { db } from "@/lib/db";

/** Host kicks off planning. The agent runs after the response is sent; the client polls for events. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "No trip with that code" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const ms = members(room.id);
  const me = ms.find((m) => m.id === body.memberId);
  if (!me) return Response.json({ error: "Not a member" }, { status: 403 });
  if (room.status === "planning") return Response.json(roomState(code, me.id));
  const notDone = ms.filter((m) => !m.done_swiping).map((m) => m.name);
  if (notDone.length && !body.force) {
    return Response.json({ error: `Still swiping: ${notDone.join(", ")}` }, { status: 409 });
  }
  db().prepare("UPDATE rooms SET status = 'planning' WHERE id = ?").run(room.id);
  after(() => buildPlan(room.id));
  return Response.json(roomState(code, me.id));
}
