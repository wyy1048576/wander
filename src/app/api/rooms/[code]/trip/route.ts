import { getRoom, members } from "@/lib/rooms";
import { listTrip, seedExpensesFromPlan } from "@/lib/trip";
import { db } from "@/lib/db";
import { normalizePlan, type Plan } from "@/lib/plan-schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "no such trip" }, { status: 404 });
  const ms = members(room.id).map((m) => ({ id: m.id, name: m.name }));
  const planRow = db().prepare("SELECT json FROM plans WHERE room_id = ?").get(room.id) as { json: string } | undefined;
  if (planRow) seedExpensesFromPlan(room.id, normalizePlan(JSON.parse(planRow.json) as Plan));
  return Response.json({ ...listTrip(room.id), members: ms, startDate: room.start_date, destination: room.destination });
}
