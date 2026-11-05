import { getRoom, members } from "@/lib/rooms";
import { listTrip } from "@/lib/trip";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = getRoom(code);
  if (!room) return Response.json({ error: "no such trip" }, { status: 404 });
  const ms = members(room.id).map((m) => ({ id: m.id, name: m.name }));
  return Response.json({ ...listTrip(room.id), members: ms, startDate: room.start_date, destination: room.destination });
}
